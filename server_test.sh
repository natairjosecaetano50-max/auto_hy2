#!/usr/bin/env bash

# ==============================================================================
# Скрипт диагностики сети и блокировок ТСПУ/DPI (Серверная часть)
# Запускать с правами root: sudo bash server_diag.sh
# ==============================================================================

if [ "$EUID" -ne 0 ]; then
    echo "[!] ОШИБКА: Запустите скрипт с правами root (например: sudo bash $0)"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "[*] Python3 не найден. Устанавливаю..."
    if command -v apt-get &> /dev/null; then
        apt-get update -y && apt-get install -y python3
    elif command -v yum &> /dev/null; then
        yum install -y python3
    fi
fi

# Запускаем встроенный код диагностики, передавая все управление сигналами
python3 - << 'EOF'
import socket
import subprocess
import threading
import time
import json
import sys
import signal
from datetime import datetime

CONTROL_PORT = 48999
TCP_PORTS = [80, 443, 5222, 8080, 8443, 2053, 45678]
UDP_PORTS = [53, 123, 443, 500, 1194, 4500, 51820, 45679]

CHAIN_NAME = "VPN_DIAG_TEMP"
running = True

server_stats = {
    "start_time": datetime.now().isoformat(),
    "tcp_received": {str(p): 0 for p in TCP_PORTS},
    "udp_received": {str(p): 0 for p in UDP_PORTS},
    "mtu_max_tcp_received": 0,
    "mtu_max_udp_received": 0,
    "sni_seen": [],
    "patterns_received": {},
    "client_ips": set()
}
stats_lock = threading.Lock()


def run_cmd(cmd):
    return subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def setup_firewall():
    print("[*] Открытие тестовых портов во временной цепочке iptables...")
    run_cmd(f"iptables -N {CHAIN_NAME} 2>/dev/null")
    run_cmd(f"iptables -F {CHAIN_NAME}")
    run_cmd(f"iptables -I INPUT 1 -j {CHAIN_NAME}")

    for p in TCP_PORTS + [CONTROL_PORT]:
        run_cmd(f"iptables -A {CHAIN_NAME} -p tcp --dport {p} -j ACCEPT")
    for p in UDP_PORTS:
        run_cmd(f"iptables -A {CHAIN_NAME} -p udp --dport {p} -j ACCEPT")
    print(f"[+] Временные порты открыты (цепочка {CHAIN_NAME}).")


def cleanup_firewall():
    print("\n[*] Восстановление исходного состояния файрвола...")
    while run_cmd(f"iptables -D INPUT -j {CHAIN_NAME} 2>/dev/null").returncode == 0:
        pass
    run_cmd(f"iptables -F {CHAIN_NAME} 2>/dev/null")
    run_cmd(f"iptables -X {CHAIN_NAME} 2>/dev/null")
    print("[+] Все временные правила удалены. Порты возвращены в исходное состояние.")


def parse_sni(data):
    try:
        if len(data) < 43 or data[0] != 0x16 or data[5] != 0x01:
            return None
        idx = 43
        session_id_len = data[idx]
        idx += 1 + session_id_len
        cipher_len = int.from_bytes(data[idx:idx+2], 'big')
        idx += 2 + cipher_len
        comp_len = data[idx]
        idx += 1 + comp_len
        ext_total_len = int.from_bytes(data[idx:idx+2], 'big')
        idx += 2
        end = idx + ext_total_len
        while idx + 4 <= end and idx + 4 <= len(data):
            ext_type = int.from_bytes(data[idx:idx+2], 'big')
            ext_len = int.from_bytes(data[idx+2:idx+4], 'big')
            idx += 4
            if ext_type == 0x0000:
                name_len = int.from_bytes(data[idx+3:idx+5], 'big')
                return data[idx+5:idx+5+name_len].decode('utf-8', errors='ignore')
            idx += ext_len
    except Exception:
        return None
    return None


def handle_tcp_client(conn, addr, port):
    with stats_lock:
        server_stats["tcp_received"][str(port)] += 1
        server_stats["client_ips"].add(addr[0])
    try:
        conn.settimeout(3.0)
        data = conn.recv(65535)
        if not data:
            return

        sni = parse_sni(data)
        if sni:
            with stats_lock:
                if sni not in server_stats["sni_seen"]:
                    server_stats["sni_seen"].append(sni)
            conn.sendall(f"SNI_OK:{sni}".encode())
            return

        if data.startswith(b"MTU_TEST:"):
            size = len(data)
            with stats_lock:
                if size > server_stats["mtu_max_tcp_received"]:
                    server_stats["mtu_max_tcp_received"] = size
            conn.sendall(f"MTU_OK:{size}".encode())
            return

        if data.startswith(b"PATTERN:"):
            ptype = data.split(b":", 2)[1].decode('utf-8', errors='ignore')
            with stats_lock:
                server_stats["patterns_received"][ptype] = server_stats["patterns_received"].get(ptype, 0) + 1
            conn.sendall(f"PATTERN_OK:{ptype}".encode())
            return

        conn.sendall(f"TCP_PONG:{port}:LEN={len(data)}".encode())
    except Exception:
        pass
    finally:
        conn.close()


def tcp_worker(port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("0.0.0.0", port))
        sock.listen(50)
        sock.settimeout(1.0)
    except Exception as e:
        print(f"[!] Порт TCP {port} уже занят другим сервисом ({e}) — пропускаем.")
        return

    while running:
        try:
            conn, addr = sock.accept()
            threading.Thread(target=handle_tcp_client, args=(conn, addr, port), daemon=True).start()
        except socket.timeout:
            continue
        except Exception:
            break
    sock.close()


def udp_worker(port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("0.0.0.0", port))
        sock.settimeout(1.0)
    except Exception as e:
        print(f"[!] Порт UDP {port} уже занят другим сервисом ({e}) — пропускаем.")
        return

    while running:
        try:
            data, addr = sock.recvfrom(65535)
            with stats_lock:
                server_stats["udp_received"][str(port)] += 1
                server_stats["client_ips"].add(addr[0])
                if data.startswith(b"MTU_UDP:") and len(data) > server_stats["mtu_max_udp_received"]:
                    server_stats["mtu_max_udp_received"] = len(data)
            sock.sendto(f"UDP_PONG:{port}:LEN={len(data)}".encode(), addr)
        except socket.timeout:
            continue
        except Exception:
            break
    sock.close()


def control_worker():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("0.0.0.0", CONTROL_PORT))
        sock.listen(5)
        sock.settimeout(1.0)
    except Exception as e:
        print(f"[!] Не удалось открыть контрольный порт {CONTROL_PORT}: {e}")
        return

    while running:
        try:
            conn, addr = sock.accept()
            with stats_lock:
                payload = dict(server_stats)
                payload["client_ips"] = list(server_stats["client_ips"])
            conn.sendall(json.dumps(payload, indent=2).encode())
            conn.close()
        except socket.timeout:
            continue
        except Exception:
            break
    sock.close()


def print_server_report():
    with stats_lock:
        report = dict(server_stats)
        report["client_ips"] = list(server_stats["client_ips"])

    print("\n" + "=" * 60)
    print(" ОТЧЕТ СЕРВЕРА (ЧТО РЕАЛЬНО ДОШЛО ДО СЕРВЕРА)")
    print("=" * 60)
    print(f"IP клиентов: {', '.join(report['client_ips']) if report['client_ips'] else 'Ни одного пакета не получено!'}")
    print("\n[Принятые соединения по TCP портам]:")
    for p, count in report["tcp_received"].items():
        print(f"  Порт {p:>5}: {count} пакетов")
    print("\n[Принятые пакеты по UDP портам]:")
    for p, count in report["udp_received"].items():
        print(f"  Порт {p:>5}: {count} пакетов")
    print(f"\n[Макс. размер пакета (MTU)]: TCP = {report['mtu_max_tcp_received']} байт | UDP = {report['mtu_max_udp_received']} байт")
    print(f"[Увиденные TLS SNI домены]: {', '.join(report['sni_seen']) if report['sni_seen'] else 'Нет'}")
    print(f"[Паттерны трафика]: {report['patterns_received']}")
    print("=" * 60)

    with open("server_diag_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print("[+] Полный отчет сохранен в файл: server_diag_report.json")


def signal_handler(sig, frame):
    global running
    running = False


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

setup_firewall()
try:
    for p in TCP_PORTS:
        threading.Thread(target=tcp_worker, args=(p,), daemon=True).start()
    for p in UDP_PORTS:
        threading.Thread(target=udp_worker, args=(p,), daemon=True).start()
    threading.Thread(target=control_worker, daemon=True).start()

    print("\n[*] Сервер готов к тестированию! Запустите client_diag.py на ПК.")
    print("[*] Для завершения теста и закрытия портов нажмите Ctrl+C...\n")

    while running:
        time.sleep(0.5)
finally:
    print_server_report()
    cleanup_firewall()
EOF