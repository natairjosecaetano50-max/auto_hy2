#!/bin/bash

# Проверка на root-права
if [ "$EUID" -ne 0 ]; then
  echo "❌ Ошибка: Пожалуйста, запустите скрипт от имени root (sudo bash auto_hy2.sh)"
  exit
fi

echo "===================================================="
echo "🚀 Автоматическая установка Hysteria 2"
echo "===================================================="

# Запрашиваем пароль у пользователя
read -p "Введите желаемый пароль для подключения (без пробелов): " HY2_PASSWORD
if [ -z "$HY2_PASSWORD" ]; then
    echo "❌ Ошибка: Пароль не может быть пустым. Запустите скрипт заново."
    exit 1
fi

echo " "
echo "🧹 Шаг 1: Поиск и удаление 3X-UI (если установлен)..."
systemctl stop x-ui 2>/dev/null
systemctl disable x-ui 2>/dev/null
rm -rf /usr/local/x-ui/ /etc/x-ui/ /etc/systemd/system/x-ui.service
systemctl daemon-reload
echo "✅ 3X-UI удален (или не был установлен)."

echo " "
echo "📥 Шаг 2: Установка Hysteria 2..."
apt-get update -y -q > /dev/null
apt-get install -y -q curl openssl > /dev/null
bash <(curl -fsSL https://get.hy2.sh/)

echo " "
echo "🔐 Шаг 3: Генерация локального сертификата..."
mkdir -p /etc/hysteria
SERVER_IP=$(curl -s https://api.ipify.org)

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout /etc/hysteria/server.key \
  -out /etc/hysteria/server.crt \
  -days 3650 \
  -subj "/CN=$SERVER_IP" 2>/dev/null

chown hysteria:hysteria /etc/hysteria/server.key /etc/hysteria/server.crt

echo " "
echo "⚙️ Шаг 4: Настройка конфигурации Hysteria 2..."
cat > /etc/hysteria/config.yaml <<EOF
listen: :443

tls:
  cert: /etc/hysteria/server.crt
  key: /etc/hysteria/server.key

auth:
  type: password
  password: $HY2_PASSWORD

masquerade:
  type: proxy
  proxy:
    url: https://www.bing.com
    rewriteHost: true

ignore_client_bandwidth: true

quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnReceiveWindow: 20971520
  maxConnReceiveWindow: 20971520
EOF

echo " "
echo "🟢 Шаг 5: Запуск службы..."
systemctl daemon-reload
systemctl enable --now hysteria-server.service
sleep 2 # Ждем пару секунд для инициализации

if systemctl is-active --quiet hysteria-server.service; then
    echo "===================================================="
    echo "🎉 ВСЁ ГОТОВО! Hysteria 2 успешно установлена и работает."
    echo "===================================================="
    echo " "
    echo "📌 Твоя ссылка для подключения (скопируй целиком):"
    echo " "
    echo "hysteria2://$HY2_PASSWORD@$SERVER_IP:443/?insecure=1&sni=$SERVER_IP#Hysteria2_Auto"
    echo " "
    echo "Просто скопируй её и вставь в NekoBox, v2rayN или Hiddify (Import from Clipboard)."
else
    echo "❌ Ошибка: Служба Hysteria не запустилась. Проверьте логи: systemctl status hysteria-server.service"
fi
