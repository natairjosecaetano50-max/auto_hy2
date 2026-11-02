#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Запустите скрипт от имени root: sudo bash $0"
  exit 1
fi

SERVER_IP=$(curl -s4 https://api.ipify.org || curl -s4 https://icanhazip.com)
HOP_START=20000
HOP_END=50000
MAIN_PORT=443

echo "=== Установка Hysteria 2 (RFC 9000 / Let's Encrypt / Port Hopping) ==="
echo "IP сервера: $SERVER_IP"
echo ""

echo "=== Настройка домена DuckDNS ==="
echo "1. Откройте https://www.duckdns.org и войдите в аккаунт."
echo "2. Создайте домен, вставьте IP вашего сервера ($SERVER_IP) в 'current ip' и нажмите 'update ip'."
echo "3. Скопируйте имя домена и Token из шапки сайта."
echo "================================="
echo ""

read -p "Введите имя домена (например, myserver или myserver.duckdns.org): " RAW_DOMAIN
if [ -z "$RAW_DOMAIN" ]; then
    echo "[ERROR] Домен не указан. Выход."
    exit 1
fi

# Форматирование домена и извлечение сабдомена для API DuckDNS
if [[ "$RAW_DOMAIN" != *.* ]]; then
    USER_DOMAIN="${RAW_DOMAIN}.duckdns.org"
    DUCK_SUBDOMAIN="$RAW_DOMAIN"
else
    USER_DOMAIN="$RAW_DOMAIN"
    DUCK_SUBDOMAIN="${RAW_DOMAIN%%.*}"
fi

read -p "Введите DuckDNS Token (или нажмите Enter, если используете другой DNS): " DUCK_TOKEN

read -p "Введите пароль Hysteria 2 (Enter для авто-генерации): " HY2_PASSWORD
if [ -z "$HY2_PASSWORD" ]; then
    HY2_PASSWORD=$(openssl rand -hex 16)
fi

echo "[INFO] 1/6 Очистка старых служб и правил iptables..."
systemctl stop hysteria-server.service nginx caddy x-ui 2>/dev/null
systemctl disable hysteria-server.service x-ui 2>/dev/null
rm -rf /etc/hysteria

iptables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    iptables -t nat $rule 2>/dev/null
done
ip6tables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    ip6tables -t nat $rule 2>/dev/null
done
while iptables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null; do :; done
while ip6tables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null; do :; done

echo "[INFO] 2/6 Установка зависимостей, настройка BBR и Port Hopping..."
apt-get update -y -q > /dev/null
apt-get install -y -q curl openssl iproute2 iptables ethtool dnsutils nginx certbot cron > /dev/null

# Привязка IP через API DuckDNS и добавление в cron
if [ -n "$DUCK_TOKEN" ]; then
    echo "[INFO] Обновление IP в базе DuckDNS..."
    DUCK_RESP=$(curl -s "https://www.duckdns.org/update?domains=${DUCK_SUBDOMAIN}&token=${DUCK_TOKEN}&ip=${SERVER_IP}")
    if [ "$DUCK_RESP" != "OK" ]; then
        echo "[WARN] Ответ DuckDNS API: $DUCK_RESP. Проверьте правильность токена и домена."
    fi
    mkdir -p /opt/duckdns
    echo "curl -s \"https://www.duckdns.org/update?domains=${DUCK_SUBDOMAIN}&token=${DUCK_TOKEN}&ip=\" >/dev/null 2>&1" > /opt/duckdns/duck.sh
    chmod 700 /opt/duckdns/duck.sh
    (crontab -l 2>/dev/null | grep -v "/opt/duckdns/duck.sh"; echo "*/5 * * * * /opt/duckdns/duck.sh") | crontab -
fi

cat << 'EOF' > /etc/sysctl.d/99-hysteria-anti-dpi.conf
net.core.rmem_max=16777216
net.core.wmem_max=16777216
net.core.rmem_default=262144
net.core.wmem_default=262144
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl --system >/dev/null 2>&1

NET_IF=$(ip route get 8.8.8.8 | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')
ethtool -K "$NET_IF" tso off gso off gro off 2>/dev/null || true

iptables -t nat -A PREROUTING -i "$NET_IF" -p udp --dport ${HOP_START}:${HOP_END} -m comment --comment "HY2_HOPPING" -j REDIRECT --to-ports $MAIN_PORT
ip6tables -t nat -A PREROUTING -i "$NET_IF" -p udp --dport ${HOP_START}:${HOP_END} -m comment --comment "HY2_HOPPING" -j REDIRECT --to-ports $MAIN_PORT

ETHTool_BIN=$(command -v ethtool || echo "/sbin/ethtool")
IPT_BIN=$(command -v iptables || echo "/sbin/iptables")
IP6T_BIN=$(command -v ip6tables || echo "/sbin/ip6tables")

cat << EOF > /etc/systemd/system/hy2-net-tune.service
[Unit]
Description=Hysteria 2 Network Tuning and Port Hopping
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=-$ETHTool_BIN -K $NET_IF tso off gso off gro off
ExecStart=/bin/sh -c '$IPT_BIN -t nat -C PREROUTING -i $NET_IF -p udp --dport ${HOP_START}:${HOP_END} -m comment --comment "HY2_HOPPING" -j REDIRECT --to-ports $MAIN_PORT 2>/dev/null || $IPT_BIN -t nat -A PREROUTING -i $NET_IF -p udp --dport ${HOP_START}:${HOP_END} -m comment --comment "HY2_HOPPING" -j REDIRECT --to-ports $MAIN_PORT'
ExecStart=/bin/sh -c '$IP6T_BIN -t nat -C PREROUTING -i $NET_IF -p udp --dport ${HOP_START}:${HOP_END} -m comment --comment "HY2_HOPPING" -j REDIRECT --to-ports $MAIN_PORT 2>/dev/null || $IP6T_BIN -t nat -A PREROUTING -i $NET_IF -p udp --dport ${HOP_START}:${HOP_END} -m comment --comment "HY2_HOPPING" -j REDIRECT --to-ports $MAIN_PORT'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable hy2-net-tune.service >/dev/null 2>&1

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw allow 443/udp >/dev/null
    ufw allow ${HOP_START}:${HOP_END}/udp >/dev/null
fi

echo "[INFO] 3/6 Выпуск сертификата Let's Encrypt для $USER_DOMAIN..."
systemctl stop nginx 2>/dev/null
certbot certonly --standalone -d "$USER_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email

if [ ! -f "/etc/letsencrypt/live/$USER_DOMAIN/fullchain.pem" ]; then
    echo "[ERROR] Не удалось получить сертификат Let's Encrypt для $USER_DOMAIN."
    echo "[ERROR] Убедитесь, что DNS A-запись указывает на $SERVER_IP и порт 80/TCP открыт."
    exit 1
fi

echo "[INFO] 4/6 Установка Hysteria 2 и настройка прав доступа к сертификатам..."
bash <(curl -fsSL https://get.hy2.sh/) >/dev/null 2>&1
mkdir -p /etc/hysteria

cp "/etc/letsencrypt/live/$USER_DOMAIN/fullchain.pem" /etc/hysteria/server.crt
cp "/etc/letsencrypt/live/$USER_DOMAIN/privkey.pem" /etc/hysteria/server.key
chown -R hysteria:hysteria /etc/hysteria
chmod 600 /etc/hysteria/server.key

# Deploy-хук для автоматического обновления сертификатов каждые 90 дней
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat << EOF > /etc/letsencrypt/renewal-hooks/deploy/hysteria-sync.sh
#!/bin/bash
cp "/etc/letsencrypt/live/$USER_DOMAIN/fullchain.pem" /etc/hysteria/server.crt
cp "/etc/letsencrypt/live/$USER_DOMAIN/privkey.pem" /etc/hysteria/server.key
chown -R hysteria:hysteria /etc/hysteria
chmod 600 /etc/hysteria/server.key
systemctl reload nginx
systemctl restart hysteria-server.service
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/hysteria-sync.sh

echo "[INFO] 5/6 Конфигурация Nginx (TCP 443 + Alt-Svc) и Hysteria 2 (UDP 443)..."
mkdir -p /var/www/html
cat << 'EOF' > /var/www/html/index.html
<!DOCTYPE html>
<html>
<head><title>200 OK</title></head>
<body><p>Service operational.</p></body>
</html>
EOF

cat << EOF > /etc/nginx/sites-available/default
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $USER_DOMAIN _;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name $USER_DOMAIN _;

    ssl_certificate /etc/hysteria/server.crt;
    ssl_certificate_key /etc/hysteria/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Alt-Svc 'h3=":443"; ma=86400' always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    root /var/www/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }
}

server {
    listen 127.0.0.1:8080;
    root /var/www/html;
    index index.html;
    add_header Alt-Svc 'h3=":443"; ma=86400' always;
}
EOF

cat <<EOF > /etc/hysteria/config.yaml
listen: :$MAIN_PORT

tls:
  cert: /etc/hysteria/server.crt
  key: /etc/hysteria/server.key

auth:
  type: password
  password: $HY2_PASSWORD

ignoreClientBandwidth: true

quic:
  initStreamReceiveWindow: 524288
  maxStreamReceiveWindow: 2097152
  initConnReceiveWindow: 1048576
  maxConnReceiveWindow: 4194304
  maxIdleTimeout: 30s
  maxUdpPayloadSize: 1350

masquerade:
  type: proxy
  proxy:
    url: http://127.0.0.1:8080
    rewriteHost: true
EOF

echo "[INFO] 6/6 Запуск служб..."
systemctl daemon-reload
systemctl enable --now nginx >/dev/null 2>&1
systemctl restart nginx
systemctl enable --now hysteria-server.service >/dev/null 2>&1
systemctl restart hysteria-server.service
sleep 2

if systemctl is-active --quiet hysteria-server.service; then
    echo ""
    echo "=== УСТАНОВКА ЗАВЕРШЕНА ==="
    echo "Домен (SNI):   $USER_DOMAIN"
    echo "IP сервера:    $SERVER_IP"
    echo "Основной порт: $MAIN_PORT (TCP/UDP)"
    echo "Port Hopping:  ${HOP_START}-${HOP_END} (UDP)"
    echo "Пароль:        $HY2_PASSWORD"
    echo ""
    echo "--- URI для NekoBox / Hiddify / v2rayN ---"
    echo "hysteria2://${HY2_PASSWORD}@${USER_DOMAIN}:${HOP_START}-${HOP_END}/?insecure=0&sni=${USER_DOMAIN}&mport=${HOP_START}-${HOP_END}#${USER_DOMAIN}"
    echo ""
    echo "--- Конфигурация Outbound для sing-box ---"
    cat <<JSON
{
  "type": "hysteria2",
  "tag": "hy2-out",
  "server": "$USER_DOMAIN",
  "server_ports": [
    "${HOP_START}:${HOP_END}"
  ],
  "hop_interval": "25s",
  "up_mbps": 100,
  "down_mbps": 300,
  "password": "$HY2_PASSWORD",
  "tls": {
    "enabled": true,
    "server_name": "$USER_DOMAIN",
    "insecure": false,
    "alpn": ["h3"]
  },
  "disable_chrome_parrot": false
}
JSON
    echo "==========================="
else
    echo "[ERROR] Служба hysteria-server не запустилась. Лог ошибок:"
    journalctl -u hysteria-server.service -n 20 --no-pager
    exit 1
fi
