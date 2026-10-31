#!/bin/bash

# Проверка на root-права
if [ "$EUID" -ne 0 ]; then
  echo "❌ Ошибка: Пожалуйста, запустите скрипт от имени root (sudo bash auto_hy2_2026.sh)"
  exit 1
fi

echo "============================================================"
echo "🚀 Авто-установка Hysteria 2 (Anti-TSPU 2026 v2.1: Ideal)"
echo "============================================================"

read -p "Введите пароль для подключения (или нажмите Enter для авто-генерации): " HY2_PASSWORD
if [ -z "$HY2_PASSWORD" ]; then
    HY2_PASSWORD=$(openssl rand -hex 16)
    echo "🔑 Сгенерирован надежный пароль: $HY2_PASSWORD"
fi

OBFS_PASSWORD=$(openssl rand -hex 16)

echo " "
echo "🧹 Шаг 1: Очистка старых служб и демаскирующих правил Port Hopping..."
systemctl stop x-ui 2>/dev/null
systemctl disable x-ui 2>/dev/null
rm -rf /usr/local/x-ui/ /etc/x-ui/ /etc/systemd/system/x-ui.service

systemctl stop hysteria-server.service 2>/dev/null
systemctl disable hysteria-server.service 2>/dev/null
bash <(curl -fsSL https://get.hy2.sh/) --remove >/dev/null 2>&1
rm -rf /etc/hysteria /usr/local/bin/hysteria

# Удаляем старые правила HY2_HOPPING и дубли MSS Clamping (IPv4 + IPv6)
iptables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    iptables -t nat $rule 2>/dev/null
done
ip6tables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    ip6tables -t nat $rule 2>/dev/null
done
while iptables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null; do :; done
while ip6tables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null; do :; done

systemctl daemon-reload
echo "✅ Старые службы и прыжки по портам удалены."

echo " "
echo "🛡️ Шаг 2: Оптимизация ядра Linux под требования ТСПУ (BBR, буферы, ethtool, MSS)..."
apt-get update -y -q > /dev/null
apt-get install -y -q curl openssl iproute2 iptables ethtool dnsutils jq whois > /dev/null

# 1. Настраиваем буферы ядра и включаем BBR
cat << 'EOF' > /etc/sysctl.d/99-hysteria-anti-dpi.conf
net.core.rmem_max=26214400
net.core.wmem_max=26214400
net.core.rmem_default=262144
net.core.wmem_default=262144
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl --system >/dev/null 2>&1

# 2. Находим сетевой интерфейс и отключаем аппаратную склейку пакетов (TSO/GSO/GRO)
NET_IF=$(ip route get 8.8.8.8 | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')
ethtool -K "$NET_IF" tso off gso off gro off 2>/dev/null || true

# 3. Задаем жесткий MSS Clamping (1160 байт) для IPv4 и IPv6 без дублей
iptables -t mangle -C POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null || \
iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160

ip6tables -t mangle -C POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null || \
ip6tables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160

# 4. Делаем сохранение ethtool и iptables идемпотентным после перезагрузки
ETHTool_BIN=$(command -v ethtool || echo "/sbin/ethtool")
IPT_BIN=$(command -v iptables || echo "/sbin/iptables")
IP6T_BIN=$(command -v ip6tables || echo "/sbin/ip6tables")

cat << EOF > /etc/systemd/system/hy2-net-tune.service
[Unit]
Description=Hysteria 2 Anti-DPI Network Tuning (MSS & Ethtool)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=-$ETHTool_BIN -K $NET_IF tso off gso off gro off
ExecStart=/bin/sh -c '$IPT_BIN -t mangle -C POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null || $IPT_BIN -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160'
ExecStart=/bin/sh -c '$IP6T_BIN -t mangle -C POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null || $IP6T_BIN -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable hy2-net-tune.service >/dev/null 2>&1
echo "✅ Ядро переведено на BBR, склейка пакетов отключена, защита от фрагментации активна."

echo " "
echo "🔍 Шаг 3: Подбор порта (приоритет 443) и точное определение SNI по BGP ASN..."
if ss -tuln | awk '{print $5}' | grep -qE ":443$"; then
    MAIN_PORT=8443
    echo "⚠️ Порт 443 занят другой службой, выбран резервный порт: $MAIN_PORT"
else
    MAIN_PORT=443
    echo "✅ Выбран идеальный порт под HTTP/3: $MAIN_PORT"
fi

SERVER_IP=$(curl -s4 https://api.ipify.org || curl -s4 https://icanhazip.com)

# 1. Пытаемся взять PTR-запись
PTR_DOMAIN=$(dig +short -x "$SERVER_IP" | sed 's/\.$//' | head -n 1)

# 2. Если PTR нет, достаем точный домен владельца IP из abuse-контакта WHOIS (100% совпадение с ASN)
WHOIS_DOMAIN=$(whois "$SERVER_IP" 2>/dev/null | grep -iE "abuse-mailbox|OrgAbuseEmail|e-mail" | head -n 1 | grep -oE '@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' | sed 's/@//' | tr '[:upper:]' '[:lower:]')

if [[ -n "$PTR_DOMAIN" && "$PTR_DOMAIN" == *.* && ! "$PTR_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    CERT_CN="$PTR_DOMAIN"
    SNI_PARAM="&sni=${PTR_DOMAIN}"
    echo "✅ Найден родной PTR-хостнейм вашего сервера (совпадает с ASN): $CERT_CN"
elif [[ -n "$WHOIS_DOMAIN" ]]; then
    CERT_CN="$WHOIS_DOMAIN"
    SNI_PARAM="&sni=${WHOIS_DOMAIN}"
    echo "✅ PTR пуст, из базы WHOIS ASN извлечен родной домен хостера: $CERT_CN"
else
    # В стандарт TLS SNI запрещено передавать голый IP-адрес, поэтому генерируем нейтральный CN
    CERT_CN="localhost"
    SNI_PARAM=""
    echo "ℹ️ Домен хостера не найден, используем подключение без внешнего SNI."
fi

echo " "
echo "📥 Шаг 4: Установка свежей версии Hysteria 2 и генерация сертификата..."
bash <(curl -fsSL https://get.hy2.sh/)

mkdir -p /etc/hysteria
openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout /etc/hysteria/server.key \
  -out /etc/hysteria/server.crt \
  -days 3650 \
  -subj "/CN=$CERT_CN" 2>/dev/null

chown -R hysteria:hysteria /etc/hysteria
chmod 600 /etc/hysteria/server.key

echo " "
echo "⚙️ Шаг 5: Запись защищенного конфига (Salamander + BBR + аутентичный Nginx)..."
cat <<EOF > /etc/hysteria/config.yaml
listen: :$MAIN_PORT

tls:
  cert: /etc/hysteria/server.crt
  key: /etc/hysteria/server.key

auth:
  type: password
  password: $HY2_PASSWORD

obfs:
  type: salamander
  salamander:
    password: $OBFS_PASSWORD

# Отключает Brutal и принудительно включает BBR
ignoreClientBandwidth: true

quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnReceiveWindow: 20971520
  maxConnReceiveWindow: 20971520
  maxIdleTimeout: 60s
  maxUdpPayloadSize: 1200
  disablePathMTUDiscovery: true

# Аутентичный HTML-ответ Nginx (не палится активными зондами как Go-сервер)
masquerade:
  type: string
  string:
    content: "<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n"
    headers:
      Server: nginx
      Content-Type: text/html
    statusCode: 404
EOF

# Открываем порт в UFW, если файрвол активен
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow "$MAIN_PORT"/udp >/dev/null
    ufw allow "$MAIN_PORT"/tcp >/dev/null
    echo "✅ Порт $MAIN_PORT открыт в UFW."
fi

echo " "
echo "🟢 Шаг 6: Запуск службы Hysteria 2..."
systemctl daemon-reload
systemctl enable --now hysteria-server.service
sleep 2

if systemctl is-active --quiet hysteria-server.service; then
    echo "============================================================"
    echo "🎉 ВСЁ ГОТОВО! Hysteria 2 (Anti-TSPU 2026 v2.1) запущена."
    echo "============================================================"
    echo "   • IP сервера:       $SERVER_IP"
    echo "   • Порт:             $MAIN_PORT"
    echo "   • Режим контроля:   BBR (Brutal отключен)"
    echo "   • Пароль:           $HY2_PASSWORD"
    echo "   • Ключ Salamander:  $OBFS_PASSWORD"
    echo "   • Родной SNI (ASN): $CERT_CN"
    echo " "
    echo "📌 ССЫЛКА ДЛЯ ИМПОРТА В NEKOBOX (скопируй и нажми Ctrl+V в NekoBox):"
    echo "hysteria2://${HY2_PASSWORD}@${SERVER_IP}:${MAIN_PORT}/?insecure=1${SNI_PARAM}&obfs=salamander&obfs-password=${OBFS_PASSWORD}#Hysteria2_AntiDPI_v2.1"
    echo "============================================================"
else
    echo "❌ Ошибка: Служба не запустилась. Проверь журнал: journalctl -u hysteria-server.service -n 30"
fi
