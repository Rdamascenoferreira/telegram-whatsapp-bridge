#!/usr/bin/env bash

set -euo pipefail

log_step() {
  echo
  echo "==> $1"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-40}"
  local delay_seconds="${4:-3}"

  for attempt in $(seq 1 "$attempts"); do
    if curl --fail --show-error --silent "$url" >/dev/null; then
      echo "$name respondeu em $url"
      return 0
    fi

    echo "Aguardando $name em $url ($attempt/$attempts)"
    sleep "$delay_seconds"
  done

  echo "$name nao respondeu em $url" >&2
  pm2 status || true
  pm2 logs "$PM2_APP_NAME" --lines 80 --nostream || true
  pm2 logs "$PM2_FRONTEND_APP_NAME" --lines 80 --nostream || true
  return 1
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
if ! pm2 startOrReload ecosystem.config.cjs --update-env; then
  log_step "Reload falhou, restaurando ambiente com start limpo"
  pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
  pm2 delete "$PM2_FRONTEND_APP_NAME" >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs --update-env
fi

log_step "Salvando estado do PM2"
pm2 save --force >/dev/null

log_step "Aguardando processos estabilizarem"
pm2 status
wait_for_http "Backend" "http://127.0.0.1:3100/api/health" 40 3
wait_for_http "Frontend" "http://127.0.0.1:3000" 40 3

log_step "Deploy concluido em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
