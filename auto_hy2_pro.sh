#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Запустите скрипт от имени root: sudo bash $0"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

SERVER_IP=$(curl -s4 --max-time 5 https://api.ipify.org || curl -s4 --max-time 5 https://icanhazip.com)
MAIN_PORT=443
FALLBACK_PORT=8443

clear
echo "========================================================================"
echo "=== Развертывание VLESS + XHTTP (packet-up) + Reality Self-Steal PRO ==="
echo "========================================================================"
echo "Внешний IPv4 сервера: $SERVER_IP"
echo ""

# 1. Запрос и валидация собственного домена
read -p "Введите ваш домен (например, example.com или sub.example.com): " USER_DOMAIN
USER_DOMAIN=$(echo "$USER_DOMAIN" | tr -d ' \r\n' | tr '[:upper:]' '[:lower:]')

if [ -z "$USER_DOMAIN" ] || [[ "$USER_DOMAIN" != *.* ]]; then
    echo "[ERROR] Указан некорректный домен. Выход."
    exit 1
fi

read -p "Введите ваш порт SSH (нажмите Enter, если стандартный 22): " SSH_PORT
SSH_PORT=${SSH_PORT:-22}

read -p "Установить Tailscale и скрыть порт SSH от внешнего мира? [y/N]: " INSTALL_TS
INSTALL_TS=$(echo "$INSTALL_TS" | tr '[:upper:]' '[:lower:]')

echo ""
echo "[INFO] 1/7 Установка системных утилит и проверка DNS-записей..."
apt-get update -y -q >/dev/null 2>&1
apt-get install -y -q -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" \
    curl openssl iproute2 iptables dnsutils nginx cron socat jq unzip uuid-runtime ufw >/dev/null 2>&1

DOMAIN_IP=$(dig +short A "$USER_DOMAIN" @1.1.1.1 | tail -n1)
PTR_RECORD=$(dig +short -x "$SERVER_IP" @1.1.1.1 | sed 's/\.$//')

if [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
    echo "[WARN] Внимание! Домен $USER_DOMAIN сейчас указывает на '$DOMAIN_IP', а IP сервера — '$SERVER_IP'."
    echo "Убедитесь, что A-запись настроена, а проксирование Cloudflare (оранжевое облако) ОТКЛЮЧЕНО."
    read -p "Все равно продолжить? [y/N]: " FORCE_CONTINUE
    if [[ "$FORCE_CONTINUE" != "y" && "$FORCE_CONTINUE" != "Y" ]]; then
        exit 1
    fi
else
    echo "[OK] A-запись домена $USER_DOMAIN корректно указывает на $SERVER_IP."
fi

if [ -z "$PTR_RECORD" ]; then
    echo "[WARN] У вашего IP нет обратной PTR-записи (rDNS). Рекомендуется прописать $USER_DOMAIN в панели VPS."
else
    echo "[INFO] Текущая PTR-запись сервера: $PTR_RECORD"
fi

echo "[INFO] 2/7 Очистка старых служб, правил DPI/Port Hopping и оптимизация TCP BBR..."
systemctl stop hysteria-server.service hy2-net-tune.service xray nginx apache2 caddy x-ui 2>/dev/null || true
systemctl disable hysteria-server.service hy2-net-tune.service apache2 caddy x-ui 2>/dev/null || true

rm -rf /etc/hysteria /usr/local/bin/hysteria
rm -f /etc/systemd/system/hysteria-server.service /etc/systemd/system/hy2-net-tune.service /etc/sysctl.d/99-hysteria-anti-dpi.conf

iptables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    iptables -t nat $rule 2>/dev/null || true
done
ip6tables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    ip6tables -t nat $rule 2>/dev/null || true
done
while iptables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null; do :; done
while ip6tables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null; do :; done

systemctl daemon-reload

cat << 'EOF' > /etc/sysctl.d/99-xray-tcp-bbr.conf
net.core.rmem_max=33554432
net.core.wmem_max=33554432
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
net.ipv4.tcp_fastopen=3
net.ipv4.tcp_slow_start_after_idle=0
net.ipv4.tcp_mtu_probing=1
EOF
sysctl --system >/dev/null 2>&1

echo "[INFO] 3/7 Выпуск TLS-сертификата Let's Encrypt для $USER_DOMAIN..."
fuser -k 80/tcp 2>/dev/null || true
fuser -k 443/tcp 2>/dev/null || true

if [ ! -f "/root/.acme.sh/acme.sh" ]; then
    curl -fsSL https://get.acme.sh | sh -s email="admin@${USER_DOMAIN}" >/dev/null 2>&1
fi

/root/.acme.sh/acme.sh --set-default-ca --server letsencrypt >/dev/null 2>&1
/root/.acme.sh/acme.sh --issue --standalone -d "$USER_DOMAIN" --keylength ec-256 --force

if [ $? -ne 0 ]; then
    echo "[ERROR] Не удалось выпустить сертификат для $USER_DOMAIN. Проверьте A-запись и доступность порта 80."
    exit 1
fi

mkdir -p /etc/nginx/ssl
/root/.acme.sh/acme.sh --install-cert -d "$USER_DOMAIN" --ecc \
    --fullchain-file /etc/nginx/ssl/server.crt \
    --key-file /etc/nginx/ssl/server.key \
    --reloadcmd "systemctl reload nginx 2>/dev/null || true"

chmod 600 /etc/nginx/ssl/server.key

echo "[INFO] 4/7 Генерация полиморфного сайта-прикрытия и настройка Nginx (PROXY protocol)..."
mkdir -p /var/www/html

# Генерация уникальных параметров для защиты от сигнатурного поиска Censys/Active Probing
BUILD_HASH=$(openssl rand -hex 6)
CSS_CLASS="c-$(openssl rand -hex 3)"
ACCENT_COLORS=("#38bdf8" "#818cf8" "#34d399" "#fbbf24" "#f472b6" "#a78bfa")
RANDOM_COLOR=${ACCENT_COLORS[$RANDOM % ${#ACCENT_COLORS[@]}]}
RAND_PADDING=$((20 + RANDOM % 25))

cat << EOF > /var/www/html/index.html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="generator" content="StaticCore/${BUILD_HASH}">
    <title>${USER_DOMAIN} — Gateway Service</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #0b0f19; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .${CSS_CLASS} { background: #111827; padding: ${RAND_PADDING}px; border-radius: 10px; max-width: 460px; width: 90%; border: 1px solid #1f2937; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        h2 { margin-top: 0; color: ${RANDOM_COLOR}; font-size: 1.25rem; font-weight: 600; }
        p { color: #9ca3af; font-size: 0.9rem; line-height: 1.6; }
        .meta { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #1f2937; font-family: monospace; font-size: 0.75rem; color: #6b7280; display: flex; justify-content: space-between; }
    </style>
</head>
<body>
    <div class="${CSS_CLASS}">
        <h2>Service Endpoint: ${USER_DOMAIN}</h2>
        <p>This host operates as an authenticated routing and API distribution node. Public directory listing and unauthenticated RPC requests are disabled by policy.</p>
        <div class="meta">
            <span>Node ID: ${BUILD_HASH}</span>
            <span>Protocol: h2 / TLS 1.3</span>
        </div>
    </div>
</body>
</html>
EOF

cat << 'EOF' > /var/www/html/robots.txt
User-agent: *
Disallow: /
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
    listen 127.0.0.1:$FALLBACK_PORT ssl http2 proxy_protocol default_server;
    server_name $USER_DOMAIN;

    server_tokens off;

    ssl_certificate /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    set_real_ip_from 127.0.0.1;
    real_ip_header proxy_protocol;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;

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

echo "[INFO] 5/7 Установка Xray-core и настройка жесткого профиля XHTTP (packet-up)..."
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install >/dev/null 2>&1

XRAY_BIN="/usr/local/bin/xray"
UUID=$($XRAY_BIN uuid)
KEYS=$($XRAY_BIN x25519)
PRIVATE_KEY=$(echo "$KEYS" | grep -i "Private" | awk -F': ' '{print $2}' | tr -d ' \r\n')
PUBLIC_KEY=$(echo "$KEYS" | grep -i -E "Public|Password" | awk -F': ' '{print $2}' | tr -d ' \r\n')
SHORT_ID=$(openssl rand -hex 8)
XHTTP_PATH="/api/v1/$(openssl rand -hex 4)"

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
          "mode": "packet-up",
          "extra": {
            "xPaddingBytes": "100-1000"
          }
        },
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "127.0.0.1:$FALLBACK_PORT",
          "xver": 1,
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
        ],
        "routeOnly": true
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
  ],
  "routing": {
    "domainStrategy": "AsIs",
    "rules": [
      {
        "type": "field",
        "ip": [
          "geoip:private"
        ],
        "outboundTag": "block"
      },
      {
        "type": "field",
        "protocol": [
          "bittorrent"
        ],
        "outboundTag": "block"
      }
    ]
  }
}
EOF

echo "[INFO] 6/7 Настройка межсетевого экрана (UFW) и изоляция от Active Probing..."
ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1
ufw allow 80/tcp >/dev/null 2>&1
ufw allow ${MAIN_PORT}/tcp >/dev/null 2>&1

SSH_HIDDEN=0
if [[ "$INSTALL_TS" == "y" ]]; then
    echo "[INFO] Установка Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1
    systemctl enable --now tailscaled >/dev/null 2>&1
    echo ""
    echo ">>> АВТОРИЗУЙТЕ СЕРВЕР В TAILSCALE ПО ССЫЛКЕ НИЖЕ <<<"
    tailscale up
    TS_IP=$(tailscale ip -4 2>/dev/null | head -n1)
    if [ -n "$TS_IP" ]; then
        ufw allow in on tailscale0 to any port "$SSH_PORT" proto tcp >/dev/null 2>&1
        SSH_HIDDEN=1
        echo "[OK] Tailscale активен (IP: $TS_IP). Внешний порт SSH ($SSH_PORT) закрыт от интернета!"
    else
        ufw allow "${SSH_PORT}/tcp" >/dev/null 2>&1
        echo "[WARN] Не удалось получить IP Tailscale. Порт SSH ($SSH_PORT) оставлен открытым."
    fi
else
    ufw allow "${SSH_PORT}/tcp" >/dev/null 2>&1
fi

ufw --force enable >/dev/null 2>&1

echo "[INFO] 7/7 Запуск службы Xray..."
systemctl daemon-reload
systemctl enable --now xray >/dev/null 2>&1
systemctl restart xray
sleep 2

ENC_PATH=$(echo -n "$XHTTP_PATH" | jq -sRr @uri)
EXTRA_JSON='{"xPaddingBytes":"100-1000"}'
ENC_EXTRA=$(echo -n "$EXTRA_JSON" | jq -sRr @uri)
VLESS_URI="vless://${UUID}@${USER_DOMAIN}:${MAIN_PORT}?encryption=none&security=reality&sni=${USER_DOMAIN}&fp=chrome&pbk=${PUBLIC_KEY}&sid=${SHORT_ID}&type=xhttp&path=${ENC_PATH}&mode=packet-up&extra=${ENC_EXTRA}#${USER_DOMAIN}-XHTTP"

if systemctl is-active --quiet xray && systemctl is-active --quiet nginx; then
    cat << EOF > /root/vless_credentials.txt
========================================================================
=== ДАННЫЕ ПОДКЛЮЧЕНИЯ (VLESS + XHTTP + REALITY SELF-STEAL) ===
========================================================================
Домен (SNI):   $USER_DOMAIN
IP сервера:    $SERVER_IP
Порт:          $MAIN_PORT (только TCP)
UUID:          $UUID
Public Key:    $PUBLIC_KEY
Short ID:      $SHORT_ID
XHTTP Path:    $XHTTP_PATH
Режим XHTTP:   packet-up (xPaddingBytes: 100-1000)

--- Ссылка VLESS (v2rayN / v2rayNG / Hiddify / Streisand / Nekobox) ---
$VLESS_URI

--- Готовый клиентский Outbound для Xray-core (JSON) ---
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
========================================================================
EOF
    chmod 600 /root/vless_credentials.txt
    echo ""
    cat /root/vless_credentials.txt
    echo ""
    echo "[INFO] Все данные подключения также сохранены в файл: /root/vless_credentials.txt"
    if [ "$SSH_HIDDEN" -eq 1 ]; then
        echo "[ВАЖНО] Внешний порт SSH закрыт! Подключайтесь к серверу по SSH только через IP Tailscale: $TS_IP"
    fi
else
    echo "[ERROR] Ошибка запуска служб! Проверьте логи:"
    journalctl -u xray -n 15 --no-pager
    journalctl -u nginx -n 15 --no-pager
    exit 1
fi
