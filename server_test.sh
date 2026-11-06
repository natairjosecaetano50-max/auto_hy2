#!/usr/bin/env bash

if [ "$EUID" -ne 0 ]; then
    echo "[!] Запустите скрипт с правами root: sudo bash $0"
    exit 1
fi

echo "[*] Временная остановка xray и nginx для освобождения портов 80 и 443..."
systemctl stop xray nginx 2>/dev/null || true

python3 - << 'EOF'
import socket
import subprocess
import threading
import time
import json
import signal
from datetime import datetime

CONTROL_PORT = 48999
TCP_PORTS = [80, 443, 8443, 2053]
UDP_PORTS = [443, 53, 123]

CHAIN_NAME = "VPN_DIAG_TEMP"
running = True

# Пытаемся прочитать ваш домен из сохраненного файла конфигурации
user_domain = "unknown.domain"
try:
    with open("/usr/local/etc/xray/config.json", "r") as f:
        cfg = json.load(f)
        user_domain = cfg["inbounds"][0]["streamSettings"]["realitySettings"]["serverNames"][0]
except Exception:
    pass

server_stats = {
    "configured_domain": user_domain,
    "tcp_received": {str(p): 0 for p in TCP_PORTS},
    "udp_received": {str(p): 0 for p in UDP_PORTS},
    "mtu_max_tcp_received": 0,
    "sni_seen": [],
    "xhttp_post_ok": 0,
    "client_ips": set()
}
stats_lock = threading.Lock()

def run_cmd(cmd):
    return subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

def setup_firewall():
    print(f"[*] Домен из конфига Xray: {user_domain}")
    print("[*] Открытие портов во временной цепочке iptables...")
    run_cmd(f"iptables -N {CHAIN_NAME} 2>/dev/null")
    run_cmd(f"iptables -F {CHAIN_NAME}")
    run_cmd(f"iptables -I INPUT 1 -j {CHAIN_NAME}")
    for p in TCP_PORTS + [CONTROL_PORT]:
        run_cmd(f"iptables -A {CHAIN_NAME} -p tcp --dport {p} -j ACCEPT")
    for p in UDP_PORTS:
        run_cmd(f"iptables -A {CHAIN_NAME} -p udp --dport {p} -j ACCEPT")

def cleanup_firewall():
    print("\n[*] Удаление временных правил iptables...")
    while run_cmd(f"iptables -D INPUT -j {CHAIN_NAME} 2>/dev/null").returncode == 0:
        pass
    run_cmd(f"iptables -F {CHAIN_NAME} 2>/dev/null")
    run_cmd(f"iptables -X {CHAIN_NAME} 2>/dev/null")

def parse_sni(data):
    try:
        if len(data) < 43 or data[0] != 0x16 or data[5] != 0x01:
            return None
        idx = 43
        idx += 1 + data[idx]
        idx += 2 + int.from_bytes(data[idx:idx+2], 'big')
        idx += 1 + data[idx]
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

def handle_tcp(conn, addr, port):
    with stats_lock:
        server_stats["tcp_received"][str(port)] += 1
        server_stats["client_ips"].add(addr[0])
    try:
        conn.settimeout(3.0)
        data = conn.recv(65535)
        if not data:
            return
        if data == b"GET_DOMAIN":
            conn.sendall(user_domain.encode())
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
        if data.startswith(b"POST /api/v1/"):
            with stats_lock:
                server_stats["xhttp_post_ok"] += 1
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nXHTTP_OK")
            return
        conn.sendall(f"TCP_PONG:{port}".encode())
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
        print(f"[!] Порт TCP {port} занят: {e}")
        return
    while running:
        try:
            conn, addr = sock.accept()
            threading.Thread(target=handle_tcp, args=(conn, addr, port), daemon=True).start()
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
    except Exception:
        return
    while running:
        try:
            data, addr = sock.recvfrom(65535)
            with stats_lock:
                server_stats["udp_received"][str(port)] += 1
            sock.sendto(f"UDP_PONG:{port}".encode(), addr)
        except Exception:
            continue
    sock.close()

def control_worker():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("0.0.0.0", CONTROL_PORT))
        sock.listen(5)
        sock.settimeout(1.0)
    except Exception:
        return
    while running:
        try:
            conn, _ = sock.accept()
            with stats_lock:
                payload = dict(server_stats)
                payload["client_ips"] = list(server_stats["client_ips"])
            conn.sendall(json.dumps(payload).encode())
            conn.close()
        except Exception:
            continue
    sock.close()

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

    print("\n[+] Порты 80 и 443 свободны и готовы к проверке! Запустите скрипт на ПК.")
    print("[*] Нажмите Ctrl+C после завершения теста на ПК...\n")
    while running:
        time.sleep(0.5)
finally:
    with stats_lock:
        print("\n" + "="*60)
        print(" ОТЧЕТ СЕРВЕРА:")
        print("="*60)
        print(f"IP клиента: {list(server_stats['client_ips'])}")
        print(f"TCP пакеты: {server_stats['tcp_received']}")
        print(f"UDP пакеты: {server_stats['udp_received']}")
        print(f"Макс. MTU TCP: {server_stats['mtu_max_tcp_received']} байт")
        print(f"Прошедшие SNI: {server_stats['sni_seen']}")
        print(f"Пакеты XHTTP (packet-up): {server_stats['xhttp_post_ok']}/20")
        print("="*60)
    cleanup_firewall()
EOF

echo "[*] Возвращаем nginx и xray в исходное рабочее состояние..."
systemctl start nginx xray
echo "[+] Службы nginx и xray снова запущены!"
