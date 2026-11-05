#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Запустите скрипт от имени root: sudo bash $0"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

SERVER_IP=$(curl -s4 https://api.ipify.org || curl -s4 https://icanhazip.com)
MAIN_PORT=443
FALLBACK_PORT=8443

echo "=================================================================="
echo "=== Развертывание VLESS + XHTTP (packet-up) + Reality Self-Steal ==="
echo "=================================================================="
echo "IP сервера: $SERVER_IP"
echo ""

read -p "Введите имя вашего домена (например, myserver или myserver.duckdns.org): " RAW_DOMAIN
if [ -z "$RAW_DOMAIN" ]; then
    echo "[ERROR] Домен не указан. Выход."
    exit 1
fi

if [[ "$RAW_DOMAIN" != *.* ]]; then
    USER_DOMAIN="${RAW_DOMAIN}.duckdns.org"
    DUCK_SUBDOMAIN="$RAW_DOMAIN"
else
    USER_DOMAIN="$RAW_DOMAIN"
    DUCK_SUBDOMAIN="${RAW_DOMAIN%%.*}"
fi

read -p "Введите DuckDNS Token (или нажмите Enter, если домен уже привязан к IP): " DUCK_TOKEN

echo ""
echo "[INFO] 1/6 Полное удаление Hysteria 2, старых служб и правил Port Hopping..."
systemctl stop hysteria-server.service hy2-net-tune.service xray nginx apache2 caddy x-ui 2>/dev/null || true
systemctl disable hysteria-server.service hy2-net-tune.service apache2 caddy x-ui 2>/dev/null || true

rm -rf /etc/hysteria /usr/local/bin/hysteria
rm -f /etc/systemd/system/hysteria-server.service
rm -f /etc/systemd/system/hy2-net-tune.service
rm -f /etc/sysctl.d/99-hysteria-anti-dpi.conf

# Очистка правил iptables и ip6tables от старого Port Hopping
iptables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    iptables -t nat $rule 2>/dev/null || true
done
ip6tables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    ip6tables -t nat $rule 2>/dev/null || true
done
while iptables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null; do :; done
while ip6tables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null; do :; done

# Закрытие UDP-портов в UFW, если он активен
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw delete allow 20000:50000/udp >/dev/null 2>&1 || true
    ufw delete allow 443/udp >/dev/null 2>&1 || true
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
fi

systemctl daemon-reload

echo "[INFO] 2/6 Установка пакетов и оптимизация сетевого стека TCP/BBR..."
apt-get update -y -q >/dev/null 2>&1
apt-get install -y -q -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" \
    curl openssl iproute2 iptables dnsutils nginx cron socat jq unzip uuid-runtime >/dev/null 2>&1

if [ -n "$DUCK_TOKEN" ]; then
    echo "[INFO] Обновление IP ($SERVER_IP) в базе DuckDNS..."
    DUCK_RESP=$(curl -s "https://www.duckdns.org/update?domains=${DUCK_SUBDOMAIN}&token=${DUCK_TOKEN}&ip=${SERVER_IP}")
    if [ "$DUCK_RESP" != "OK" ]; then
        echo "[WARN] Ответ DuckDNS API: $DUCK_RESP. Проверьте токен."
    fi
    mkdir -p /opt/duckdns
    echo "curl -s \"https://www.duckdns.org/update?domains=${DUCK_SUBDOMAIN}&token=${DUCK_TOKEN}&ip=${SERVER_IP}\" >/dev/null 2>&1" > /opt/duckdns/duck.sh
    chmod 700 /opt/duckdns/duck.sh
    (crontab -l 2>/dev/null | grep -v "/opt/duckdns/duck.sh"; echo "*/5 * * * * /opt/duckdns/duck.sh") | crontab -
fi

cat << 'EOF' > /etc/sysctl.d/99-xray-tcp-bbr.conf
net.core.rmem_max=16777216
net.core.wmem_max=16777216
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
net.ipv4.tcp_fastopen=3
net.ipv4.tcp_slow_start_after_idle=0
EOF
sysctl --system >/dev/null 2>&1

echo "[INFO] 3/6 Выпуск сертификата Let's Encrypt для $USER_DOMAIN..."
systemctl stop nginx 2>/dev/null || true
fuser -k 80/tcp 2>/dev/null || true
fuser -k 443/tcp 2>/dev/null || true

if [ ! -f "/root/.acme.sh/acme.sh" ]; then
    curl -fsSL https://get.acme.sh | sh -s email=admin@${USER_DOMAIN} >/dev/null 2>&1
fi

/root/.acme.sh/acme.sh --set-default-ca --server letsencrypt >/dev/null 2>&1

CERT_ISSUED=0
if [ -n "$DUCK_TOKEN" ]; then
    export DuckDNS_Token="$DUCK_TOKEN"
    /root/.acme.sh/acme.sh --issue --dns dns_duckdns -d "$USER_DOMAIN" --keylength ec-256 --force && CERT_ISSUED=1
fi

if [ "$CERT_ISSUED" -eq 0 ]; then
    /root/.acme.sh/acme.sh --issue --standalone -d "$USER_DOMAIN" --keylength ec-256 --force && CERT_ISSUED=1
fi

if [ "$CERT_ISSUED" -eq 0 ]; then
    echo "[ERROR] Не удалось выпустить сертификат для $USER_DOMAIN."
    exit 1
fi

mkdir -p /etc/nginx/ssl
/root/.acme.sh/acme.sh --install-cert -d "$USER_DOMAIN" --ecc \
    --fullchain-file /etc/nginx/ssl/server.crt \
    --key-file /etc/nginx/ssl/server.key \
    --reloadcmd "systemctl reload nginx 2>/dev/null || true"

chmod 600 /etc/nginx/ssl/server.key

echo "[INFO] 4/6 Настройка маскировочного сайта Nginx (Self-Steal на 127.0.0.1:$FALLBACK_PORT)..."
mkdir -p /var/www/html
cat << 'EOF' > /var/www/html/index.html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloud Edge Node</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .box { background: #1e293b; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); max-width: 420px; text-align: center; border: 1px solid #334155; }
        h1 { font-size: 1.4rem; margin-top: 0; color: #38bdf8; }
        p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
        .badge { display: inline-block; margin-top: 1rem; padding: 0.35rem 0.85rem; background: rgba(34, 197, 94, 0.15); color: #4ade80; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    </style>
</head>
<body>
    <div class="box">
        <h1>Telemetry & Sync Node</h1>
        <p>This endpoint handles automated telemetry synchronization. Direct interactive access is restricted.</p>
        <div class="badge">● System Operational (HTTP/2 TLS 1.3)</div>
    </div>
</body>
</html>
EOF

rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default
cat << EOF > /etc/nginx/sites-available/default
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $USER_DOMAIN _;
    return 301 https://\$host\$request_uri;
}

server {
    listen 127.0.0.1:$FALLBACK_PORT ssl http2 default_server;
    server_name $USER_DOMAIN;

    ssl_certificate /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;

    root /var/www/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF
ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
systemctl enable --now nginx >/dev/null 2>&1
systemctl restart nginx

echo "[INFO] 5/6 Установка свежего ядра Xray-core и генерация ключей Reality..."
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install >/dev/null 2>&1

XRAY_BIN="/usr/local/bin/xray"
UUID=$($XRAY_BIN uuid)
KEYS=$($XRAY_BIN x25519)
PRIVATE_KEY=$(echo "$KEYS" | grep -i "Private" | awk -F': ' '{print $2}' | tr -d ' \r\n')
PUBLIC_KEY=$(echo "$KEYS" | grep -i -E "Public|Password" | awk -F': ' '{print $2}' | tr -d ' \r\n')
SHORT_ID=$(openssl rand -hex 8)
XHTTP_PATH="/$(openssl rand -hex 4)"

cat << EOF > /usr/local/etc/xray/config.json
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": $MAIN_PORT,
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "$UUID",
            "flow": ""
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "xhttp",
        "xhttpSettings": {
          "path": "$XHTTP_PATH",
          "mode": "auto",
          "extra": {
            "xPaddingBytes": "100-1000"
          }
        },
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "127.0.0.1:$FALLBACK_PORT",
          "xver": 0,
          "serverNames": [
            "$USER_DOMAIN"
          ],
          "privateKey": "$PRIVATE_KEY",
          "shortIds": [
            "$SHORT_ID"
          ]
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": [
          "http",
          "tls",
          "quic"
        ]
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom",
      "tag": "direct"
    },
    {
      "protocol": "blackhole",
      "tag": "block"
    }
  ]
}
EOF

echo "[INFO] 6/6 Запуск службы Xray..."
systemctl daemon-reload
systemctl enable --now xray >/dev/null 2>&1
systemctl restart xray
sleep 2

# Кодирование параметров для URI
ENC_PATH=$(echo -n "$XHTTP_PATH" | jq -sRr @uri)
EXTRA_JSON='{"xPaddingBytes":"100-1000"}'
ENC_EXTRA=$(echo -n "$EXTRA_JSON" | jq -sRr @uri)

if systemctl is-active --quiet xray && systemctl is-active --quiet nginx; then
    echo ""
    echo "=================================================================="
    echo "=== УСТАНОВКА УСПЕШНО ЗАВЕРШЕНА ==="
    echo "=================================================================="
    echo "Домен (SNI):   $USER_DOMAIN (Self-Steal через локальный Nginx)"
    echo "IP сервера:    $SERVER_IP"
    echo "Порт:          $MAIN_PORT (только TCP)"
    echo "UUID:          $UUID"
    echo "Public Key:    $PUBLIC_KEY"
    echo "Short ID:      $SHORT_ID"
    echo "XHTTP Path:    $XHTTP_PATH"
    echo "Режим XHTTP:   packet-up (xPaddingBytes: 100-1000)"
    echo ""
    echo "--- Ссылка VLESS (для v2rayN / v2rayNG / Hiddify / Streisand) ---"
    echo "vless://${UUID}@${USER_DOMAIN}:${MAIN_PORT}?encryption=none&security=reality&sni=${USER_DOMAIN}&fp=chrome&pbk=${PUBLIC_KEY}&sid=${SHORT_ID}&type=xhttp&path=${ENC_PATH}&mode=packet-up&extra=${ENC_EXTRA}#${USER_DOMAIN}-XHTTP"
    echo ""
    echo "--- Готовый клиентский Outbound для Xray-core (JSON) ---"
    cat <<JSON
{
  "protocol": "vless",
  "tag": "proxy",
  "settings": {
    "vnext": [
      {
        "address": "$USER_DOMAIN",
        "port": $MAIN_PORT,
        "users": [
          {
            "id": "$UUID",
            "encryption": "none"
          }
        ]
      }
    ]
  },
  "streamSettings": {
    "network": "xhttp",
    "security": "reality",
    "realitySettings": {
      "serverName": "$USER_DOMAIN",
      "fingerprint": "chrome",
      "publicKey": "$PUBLIC_KEY",
      "shortId": "$SHORT_ID",
      "spiderX": "/"
    },
    "xhttpSettings": {
      "path": "$XHTTP_PATH",
      "mode": "packet-up",
      "extra": {
        "xPaddingBytes": "100-1000"
      }
    }
  },
  "mux": {
    "enabled": true,
    "concurrency": 8,
    "xudpConcurrency": 16,
    "xudpProxyUDP443": "reject"
  }
}
JSON
    echo "=================================================================="
else
    echo "[ERROR] Ошибка запуска служб! Проверьте логи:"
    journalctl -u xray -n 15 --no-pager
    journalctl -u nginx -n 15 --no-pager
    exit 1
fi
