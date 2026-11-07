#!/usr/bin/env bash
set -euo pipefail

# Установка облачной «Структуры» на Ubuntu/Debian VPS.
# Запуск из корня репозитория:
#   sudo bash deploy/install.sh cloud.example.ru

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: sudo bash deploy/install.sh <domain>" >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

echo "== Проверка Docker =="
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker не найден. Устанавливаю..."
  . /etc/os-release
  if [ "${ID:-}" != "ubuntu" ] && [ "${ID:-}" != "debian" ]; then
    echo "Поддерживаются Ubuntu/Debian; установите Docker вручную." >&2
    exit 1
  fi
  apt-get update -y
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "Docker уже установлен."
fi

echo "== Настройка домена =="
echo "DOMAIN=$DOMAIN" > deploy/.env
mkdir -p data

echo "== Сборка и запуск =="
docker compose -f deploy/docker-compose.prod.yml up -d --build

echo "== Ожидание сертификата Caddy =="
for i in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/login" >/dev/null 2>&1; then
    echo "HTTPS работает: https://$DOMAIN/login"
    break
  fi
  sleep 3
done

echo
echo "Демо-входы:"
echo "  owner@demo.ru / demo1234"
echo "  partner@demo.ru / demo1234"
echo
echo "Для боевого контура:"
echo "  1) смените пароли и удалите demo-аккаунты;"
echo "  2) уберите /demo/owner и /demo/partner из server/server.js;"
echo "  3) сделайте бэкап data/db.json."
echo
echo "Проверка: curl -I https://$DOMAIN/login"
