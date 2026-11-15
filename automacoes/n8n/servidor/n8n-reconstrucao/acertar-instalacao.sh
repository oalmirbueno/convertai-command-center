#!/bin/bash
# Acerta a instalação do n8n no VPS do Hermes (projeto /docker/n8n-recovery).
# - chave de criptografia explícita (lida do volume, nunca impressa) em .env 600 e cópia em /root/backups/n8n
# - N8N_PROXY_HOPS=1 (o n8n fica atrás do Traefik)
# - imagem fixada na versão que já está rodando (sem :latest)
# Não toca em Hermes, Traefik nem Paperclip. Pode rodar de novo sem efeito colateral.
# Uso: bash acertar-instalacao.sh [host-extra]   (host-extra = endereço estável adicional, opcional)
set -euo pipefail
umask 077
P=/docker/n8n-recovery
B=/root/backups/n8n
VOL=n8n-recovery_n8n_data
C=n8n-recovery-n8n-1
HOST_EXTRA="${1:-}"
mkdir -p "$B"

VERSAO=$(docker exec "$C" n8n --version | tr -d '[:space:]')
echo "versão em uso: $VERSAO"

CHAVE=$(docker run --rm -v "$VOL":/d:ro alpine cat /d/config | python3 -c 'import json,sys; print(json.load(sys.stdin)["encryptionKey"])')
if [ "${#CHAVE}" -lt 16 ]; then echo "chave de criptografia não encontrada no volume"; exit 1; fi
if [ -f "$B/encryption-key.txt" ] && [ "$(cat "$B/encryption-key.txt")" != "$CHAVE" ]; then
  echo "ATENÇÃO: a chave guardada em $B/encryption-key.txt é diferente da do volume; parando sem mexer."; exit 1
fi
printf '%s\n' "$CHAVE" > "$B/encryption-key.txt"
printf 'N8N_ENCRYPTION_KEY=%s\n' "$CHAVE" > "$P/.env"
chmod 600 "$B/encryption-key.txt" "$P/.env"
unset CHAVE
echo "chave guardada (${B}/encryption-key.txt e ${P}/.env, modo 600)"

cp -p "$P/docker-compose.yml" "$B/docker-compose.yml.antes-$(date +%Y%m%d-%H%M%S)"
VERSAO="$VERSAO" HOST_EXTRA="$HOST_EXTRA" python3 - "$P/docker-compose.yml" <<'PY'
import os, re, sys
p = sys.argv[1]
t = open(p, encoding='utf-8').read()
versao, extra = os.environ['VERSAO'], os.environ.get('HOST_EXTRA', '')
t = re.sub(r'image: n8nio/n8n:\S+', 'image: n8nio/n8n:' + versao, t)
def poe(t, linha):
    nome = linha.split('=')[0]
    if re.search(r'^\s*- ' + re.escape(nome) + '=', t, re.M):
        return re.sub(r'^(\s*- )' + re.escape(nome) + r'=.*$', lambda m: m.group(1) + linha, t, flags=re.M)
    return re.sub(r'^(\s*- )(N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=.*)$', lambda m: m.group(0) + '\n' + m.group(1) + linha, t, count=1, flags=re.M)
t = poe(t, 'N8N_PROXY_HOPS=1')
t = poe(t, 'N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY:?falta N8N_ENCRYPTION_KEY no .env}')
if extra:
    atual = re.search(r'rule=(.*)$', t, re.M).group(1)
    if extra not in atual:
        t = re.sub(r'(rule=)(.*)$', lambda m: m.group(1) + m.group(2) + ' || Host(`' + extra + '`)', t, count=1, flags=re.M)
    for nome in ('N8N_HOST',):
        t = poe(t, nome + '=' + extra)
    for nome in ('WEBHOOK_URL', 'N8N_EDITOR_BASE_URL'):
        t = poe(t, nome + '=https://' + extra + '/')
open(p, 'w', encoding='utf-8', newline='\n').write(t)
PY

cd "$P"
docker compose config -q
docker compose up -d
for i in $(seq 1 40); do
  if curl -fsS -m 5 http://127.0.0.1:5678/healthz >/dev/null 2>&1; then break; fi
  sleep 3
done
curl -fsS -m 5 http://127.0.0.1:5678/healthz; echo
docker ps --filter name="$C" --format '{{.Names}} {{.Image}} {{.Status}}'
docker exec "$C" sh -c 'echo "PROXY_HOPS=$N8N_PROXY_HOPS; chave no ambiente: $( [ -n "$N8N_ENCRYPTION_KEY" ] && echo sim || echo nao )"'
