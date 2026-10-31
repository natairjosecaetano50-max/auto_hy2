#!/bin/bash

# Проверка на root-права
if [ "$EUID" -ne 0 ]; then
  echo "❌ Ошибка: Пожалуйста, запустите скрипт от имени root (sudo bash auto_hy2_2026.sh)"
  exit 1
fi

echo "============================================================"
echo "🚀 Авто-установка Hysteria 2 (Anti-TSPU 2026: BBR + Salamander)"
echo "============================================================"

# Запрашиваем пароль (если нажать Enter — сгенерируется автоматически)
read -p "Введите пароль для подключения (или нажмите Enter для авто-генерации): " HY2_PASSWORD
if [ -z "$HY2_PASSWORD" ]; then
    HY2_PASSWORD=$(openssl rand -hex 16)
    echo "🔑 Сгенерирован надежный пароль: $HY2_PASSWORD"
fi

# Автоматическая генерация ключа обфускации Salamander
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

# Удаляем старые правила HY2_HOPPING и дубли MSS Clamping
iptables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    iptables -t nat $rule 2>/dev/null
done
ip6tables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    ip6tables -t nat $rule 2>/dev/null
done
iptables -t mangle -D POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160 2>/dev/null

systemctl daemon-reload
echo "✅ Старые службы и прыжки по портам удалены."

echo " "
echo "🛡️ Шаг 2: Оптимизация ядра Linux под требования ТСПУ (BBR, буферы, ethtool, MSS)..."
apt-get update -y -q > /dev/null
apt-get install -y -q curl openssl iproute2 iptables ethtool dnsutils > /dev/null

# 1. Настраиваем буферы ядра (25 МБ) и включаем BBR
cat << 'EOF' > /etc/sysctl.d/99-hysteria-anti-dpi.conf
net.core.rmem_max=26214400
net.core.wmem_max=26214400
net.core.rmem_default=26214400
net.core.wmem_default=26214400
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl --system >/dev/null 2>&1

# 2. Находим сетевой интерфейс и отключаем аппаратную склейку пакетов (TSO/GSO/GRO)
NET_IF=$(ip route get 8.8.8.8 | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')
ethtool -K "$NET_IF" tso off gso off gro off 2>/dev/null

# 3. Задаем жесткий MSS Clamping (1160 байт)
iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160

# 4. Делаем сохранение ethtool и iptables автоматическим после перезагрузки через systemd
cat << EOF > /etc/systemd/system/hy2-net-tune.service
[Unit]
Description=Hysteria 2 Anti-DPI Network Tuning (MSS & Ethtool)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/sbin/ethtool -K $NET_IF tso off gso off gro off
ExecStart=/sbin/iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1160
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable hy2-net-tune.service >/dev/null 2>&1
echo "✅ Ядро переведено на BBR, склейка пакетов отключена, защита от фрагментации активна."

echo " "
echo "🔍 Шаг 3: Подбор порта (приоритет 443) и определение родного SNI по ASN..."
# Проверяем, свободен ли стандартный порт 443 (имитация обычного HTTP/3)
if ss -tuln | awk '{print $5}' | grep -qE ":443$"; then
    MAIN_PORT=8443
    echo "⚠️ Порт 443 занят другой службой, выбран резервный стандартный порт: $MAIN_PORT"
else
    MAIN_PORT=443
    echo "✅ Выбран идеальный порт под HTTP/3: $MAIN_PORT"
fi

SERVER_IP=$(curl -s4 https://api.ipify.org || curl -s https://icanhazip.com)

# Определяем PTR-запись сервера, чтобы SNI совпадал с ASN дата-центра (защита от проверки ТСПУ)
PTR_DOMAIN=$(dig +short -x "$SERVER_IP" | sed 's/\.$//' | head -n 1)
if [[ -n "$PTR_DOMAIN" && "$PTR_DOMAIN" == *.* ]]; then
    SNI_DOMAIN="$PTR_DOMAIN"
    echo "✅ Найден родной хостнейм вашего дата-центра (совпадает с ASN): $SNI_DOMAIN"
else
    SNI_DOMAIN="speedtest.net"
    echo "ℹ️ PTR-запись не найдена, установлен нейтральный SNI: $SNI_DOMAIN"
fi

echo " "
echo "📥 Шаг 4: Установка свежей версии Hysteria 2 и генерация сертификата..."
bash <(curl -fsSL https://get.hy2.sh/)

mkdir -p /etc/hysteria
openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout /etc/hysteria/server.key \
  -out /etc/hysteria/server.crt \
  -days 3650 \
  -subj "/CN=$SNI_DOMAIN" 2>/dev/null

chown -R hysteria:hysteria /etc/hysteria
chmod 600 /etc/hysteria/server.key

echo " "
echo "⚙️ Шаг 5: Запись защищенного конфига (Salamander + принудительный BBR + Anti-Fragmentation)..."
cat > /etc/hysteria/config.yaml <<EOF
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

# КРИТИЧЕСКИ ВАЖНО: true отключает Brutal и принудительно включает BBR!
ignoreClientBandwidth: true

quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnReceiveWindow: 20971520
  maxConnReceiveWindow: 20971520
  maxIdleTimeout: 30s
  keepAlivePeriod: 10s
  # Защита от UDP-фрагментации на уровне протокола QUIC
  maxUdpPayloadSize: 1200
  disablePathMTUDiscovery: true

masquerade:
  type: proxy
  proxy:
    url: https://speed.cloudflare.com/
    rewriteHost: true
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
    echo "🎉 ВСЁ ГОТОВО! Hysteria 2 (Anti-TSPU 2026) успешно запущена."
    echo "============================================================"
    echo " "
    echo "📊 Параметры для проверки:"
    echo "   • IP сервера:       $SERVER_IP"
    echo "   • Порт:             $MAIN_PORT (без палевного Port Hopping)"
    echo "   • Режим контроля:   BBR (Brutal принудительно отключен)"
    echo "   • Пароль:           $HY2_PASSWORD"
    echo "   • Ключ Salamander:  $OBFS_PASSWORD"
    echo "   • Родной SNI (ASN): $SNI_DOMAIN"
    echo " "
    echo "📌 ССЫЛКА ДЛЯ ИМПОРТА В NEKOBOX (скопируй и нажми Ctrl+V в NekoBox):"
    echo "hysteria2://${HY2_PASSWORD}@${SERVER_IP}:${MAIN_PORT}/?insecure=1&sni=${SNI_DOMAIN}&obfs=salamander&obfs-password=${OBFS_PASSWORD}#Hysteria2_AntiDPI_BBR"
    echo "============================================================"
else
    echo "❌ Ошибка: Служба не запустилась. Проверь журнал: journalctl -u hysteria-server.service -n 30"
fi
