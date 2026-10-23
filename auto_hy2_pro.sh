#!/bin/bash

# Проверка на root-права
if [ "$EUID" -ne 0 ]; then
  echo "❌ Ошибка: Пожалуйста, запустите скрипт от имени root (sudo bash auto_hy2_pro.sh)"
  exit 1
fi

echo "============================================================"
echo "🚀 Авто-установка Hysteria 2 PRO (Anti-DPI + Port Hopping)"
echo "============================================================"

# Запрашиваем пароль (если нажать Enter — сгенерируется автоматически)
read -p "Введите пароль для подключения (или нажмите Enter для авто-генерации): " HY2_PASSWORD
if [ -z "$HY2_PASSWORD" ]; then
    HY2_PASSWORD=$(openssl rand -hex 12)
    echo "🔑 Сгенерирован надежный пароль: $HY2_PASSWORD"
fi

# Автоматическая генерация ключа обфускации Salamander
OBFS_PASSWORD=$(openssl rand -hex 16)
MASQ_DOMAIN="www.bing.com"

echo " "
echo "🧹 Шаг 1: Полная очистка старой Hysteria 2 и 3X-UI..."
# Удаление 3X-UI
systemctl stop x-ui 2>/dev/null
systemctl disable x-ui 2>/dev/null
rm -rf /usr/local/x-ui/ /etc/x-ui/ /etc/systemd/system/x-ui.service

# Удаление старой Hysteria 2
systemctl stop hysteria-server.service 2>/dev/null
systemctl disable hysteria-server.service 2>/dev/null
bash <(curl -fsSL https://get.hy2.sh/) --remove >/dev/null 2>&1
rm -rf /etc/hysteria /usr/local/bin/hysteria

# Очистка старых правил Port Hopping в iptables/ip6tables
iptables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    iptables -t nat $rule 2>/dev/null
done
ip6tables -t nat -S PREROUTING 2>/dev/null | grep "HY2_HOPPING" | sed 's/-A /-D /' | while read -r rule; do
    ip6tables -t nat $rule 2>/dev/null
done

systemctl daemon-reload
echo "✅ Старые службы, конфиги и правила очищены."

echo " "
echo "🎲 Шаг 2: Подбор свободных случайных портов без пересечений..."
apt-get update -y -q > /dev/null
apt-get install -y -q curl openssl iproute2 iptables > /dev/null

# Функция проверки: свободен ли порт (проверяет и TCP, и UDP)
is_port_free() {
    local port=$1
    if ss -tuln | awk '{print $5}' | grep -qE ":${port}$"; then
        return 1
    else
        return 0
    fi
}

# Подбираем основной порт в безопасном диапазоне 15000-29999
while true; do
    MAIN_PORT=$(shuf -i 15000-29999 -n 1)
    if is_port_free "$MAIN_PORT"; then
        break
    fi
done

# Подбираем непересекающийся диапазон для Port Hopping (2000 портов в районе 35000-55000)
HOP_START=$(shuf -i 35000-52000 -n 1)
HOP_END=$((HOP_START + 2000))

echo "✅ Основной порт: $MAIN_PORT (проверен, свободен)"
echo "✅ Диапазон для прыжков (Port Hopping): $HOP_START-$HOP_END"

echo " "
echo "📥 Шаг 3: Чистая установка свежей версии Hysteria 2..."
bash <(curl -fsSL https://get.hy2.sh/)

echo " "
echo "🔐 Шаг 4: Генерация TLS-сертификата под маскировочный домен..."
mkdir -p /etc/hysteria
SERVER_IP=$(curl -s4 https://api.ipify.org || curl -s https://icanhazip.com)

openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout /etc/hysteria/server.key \
  -out /etc/hysteria/server.crt \
  -days 3650 \
  -subj "/CN=$MASQ_DOMAIN" 2>/dev/null

chown -R hysteria:hysteria /etc/hysteria
chmod 600 /etc/hysteria/server.key

echo " "
echo "⚙️ Шаг 5: Создание улучшенного конфига (Salamander + BBR/QUIC)..."
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

masquerade:
  type: proxy
  proxy:
    url: https://$MASQ_DOMAIN
    rewriteHost: true

ignoreClientBandwidth: false

quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnReceiveWindow: 20971520
  maxConnReceiveWindow: 20971520
  maxIdleTimeout: 30s
  keepAlivePeriod: 10s
EOF

echo " "
echo "🔀 Шаг 6: Настройка Port Hopping и файрвола..."
NET_IF=$(ip route get 8.8.8.8 | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')

# Добавляем переадресацию диапазона портов на основной порт с меткой HY2_HOPPING
iptables -t nat -A PREROUTING -i "$NET_IF" -p udp --dport "${HOP_START}:${HOP_END}" -m comment --comment "HY2_HOPPING" -j REDIRECT --to-ports "$MAIN_PORT"
ip6tables -t nat -A PREROUTING -i "$NET_IF" -p udp --dport "${HOP_START}:${HOP_END}" -m comment --comment "HY2_HOPPING" -j REDIRECT --to-ports "$MAIN_PORT" 2>/dev/null

# Если на сервере активен UFW — открываем сгенерированные порты автоматически
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow "$MAIN_PORT"/udp >/dev/null
    ufw allow "$MAIN_PORT"/tcp >/dev/null
    ufw allow "${HOP_START}:${HOP_END}"/udp >/dev/null
    echo "✅ Порты автоматически открыты в UFW."
fi

echo " "
echo "🟢 Шаг 7: Запуск службы Hysteria 2..."
systemctl daemon-reload
systemctl enable --now hysteria-server.service
sleep 2

if systemctl is-active --quiet hysteria-server.service; then
    echo "============================================================"
    echo "🎉 ВСЁ ГОТОВО! Улучшенная Hysteria 2 запущена."
    echo "============================================================"
    echo " "
    echo "📊 Параметры твоего сервера:"
    echo "   • IP сервера:       $SERVER_IP"
    echo "   • Основной порт:    $MAIN_PORT"
    echo "   • Прыжки по портам: $HOP_START-$HOP_END"
    echo "   • Пароль:           $HY2_PASSWORD"
    echo "   • Ключ Salamander:  $OBFS_PASSWORD"
    echo "   • Маскировка (SNI): $MASQ_DOMAIN"
    echo " "
    echo "📌 ССЫЛКА №1 — С прыжками по портам (Port Hopping) [РЕКОМЕНДУЕТСЯ]:"
    echo "hysteria2://${HY2_PASSWORD}@${SERVER_IP}:${MAIN_PORT}/?insecure=1&sni=${MASQ_DOMAIN}&obfs=salamander&obfs-password=${OBFS_PASSWORD}&mport=${HOP_START}-${HOP_END}#Hysteria2_Pro_Hopping"
    echo " "
    echo "📌 ССЫЛКА №2 — Обычная (если старый клиент не понимает mport):"
    echo "hysteria2://${HY2_PASSWORD}@${SERVER_IP}:${MAIN_PORT}/?insecure=1&sni=${MASQ_DOMAIN}&obfs=salamander&obfs-password=${OBFS_PASSWORD}#Hysteria2_Pro_Direct"
    echo " "
    echo "Скопируй Ссылку №1 и добавь её в Hiddify, NekoBox, v2rayN или Streisand."
else
    echo "❌ Ошибка: Служба не запустилась. Проверь журнал: journalctl -u hysteria-server.service -n 30"
fi