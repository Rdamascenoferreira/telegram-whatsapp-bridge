#!/usr/bin/env bash

set -euo pipefail

log_step() {
  echo
  echo "==> $1"
}

APP_DIR="${APP_DIR:?APP_DIR is required}"
RELEASE_ARCHIVE="${RELEASE_ARCHIVE:?RELEASE_ARCHIVE is required}"
PM2_APP_NAME="${PM2_APP_NAME:-telegram-whatsapp-bridge}"
PM2_FRONTEND_APP_NAME="${PM2_FRONTEND_APP_NAME:-portal-afiliado-web}"

# Faz shell remoto enxergar Node/npm/pm2 instalados via nvm
export NVM_DIR="${HOME}/.nvm"
if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "${NVM_DIR}/nvm.sh" >/dev/null 2>&1 || true
fi

if command -v node >/dev/null 2>&1; then
  export PATH="$(dirname "$(command -v node)"):${PATH}"
fi

if [[ ! -f "$RELEASE_ARCHIVE" ]]; then
  echo "Release archive not found: $RELEASE_ARCHIVE" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required on the server." >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required on the server." >&2
  exit 1
fi

mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/data" "$APP_DIR/.wwebjs_auth" "$APP_DIR/.wwebjs_cache"

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "Arquivo .env nao encontrado em $APP_DIR. Crie o .env no servidor antes do deploy." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
  rm -f "$RELEASE_ARCHIVE"
}
trap cleanup EXIT

tar -xzf "$RELEASE_ARCHIVE" -C "$TMP_DIR"

log_step "Parando processos antes da sincronizacao"
pm2 stop "$PM2_APP_NAME" >/dev/null 2>&1 || true
pm2 stop "$PM2_FRONTEND_APP_NAME" >/dev/null 2>&1 || true

log_step "Limpando dependencias e build anteriores"
rm -rf "$APP_DIR/node_modules" "$APP_DIR/web/node_modules" "$APP_DIR/web/.next"

log_step "Sincronizando release em $APP_DIR"
rsync -a --delete \
  --exclude '.env' \
  --exclude 'data' \
  --exclude '.wwebjs_auth' \
  --exclude '.wwebjs_cache' \
  --exclude '.git' \
  "$TMP_DIR"/ "$APP_DIR"/

cd "$APP_DIR"
mkdir -p data .wwebjs_auth .wwebjs_cache

export PM2_APP_NAME
export PM2_BACKEND_APP_NAME="$PM2_APP_NAME"
export PM2_FRONTEND_APP_NAME
log_step "Recarregando processos no PM2"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null || true

log_step "Deploy concluido em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
