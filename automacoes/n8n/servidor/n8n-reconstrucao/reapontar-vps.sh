#!/bin/bash
# Aponta o leitor dos grupos e a Clio para o n8n novo. Pode rodar de novo com outro endereço.
# Uso: bash reapontar-vps.sh https://n8n.aceleriq.com.br
# Guarda cópia de cada arquivo alterado (.antes-<data>). Reinicia só o leitor dos grupos.
set -euo pipefail
BASE="${1:?diga o endereço, ex.: https://n8n.aceleriq.com.br}"
BASE="${BASE%/}"
case "$BASE" in https://*) ;; *) echo "o endereço precisa começar com https://"; exit 1;; esac
curl -fsS -m 20 "$BASE/healthz" >/dev/null || { echo "$BASE/healthz não respondeu; nada alterado"; exit 1; }
D=$(date +%Y%m%d-%H%M%S)
ARQS="/etc/aceleriq-leitor-grupos/leitor.env
/opt/aceleriq-clio/clio_fila_conversas.py
/opt/aceleriq-clio/clio_guardar_materiais.py
/root/.hermes/profiles/clio/scripts/clio_fila_conversas.py
/root/.hermes/profiles/clio/scripts/clio_guardar_materiais.py"
for f in $ARQS; do
  [ -f "$f" ] || { echo "não existe: $f"; continue; }
  if grep -qE "https://[^/\"' ]+/webhook/(acq04-mensagens|acq10-fila-conversas|acq12-midia)" "$f"; then
    cp -p "$f" "$f.antes-$D"
    sed -i -E "s#https://[^/\"' ]+/webhook/(acq04-mensagens|acq10-fila-conversas|acq12-midia)#$BASE/webhook/\1#g" "$f"
    echo "ok: $f -> $(grep -oE "https://[^/\"' ]+/webhook/[a-z0-9-]+" "$f" | sort -u | tr '\n' ' ')"
  else
    echo "sem endereço de webhook: $f"
  fi
done
systemctl restart aceleriq-leitor-grupos
sleep 25
systemctl is-active aceleriq-leitor-grupos
journalctl -u aceleriq-leitor-grupos --since "-40s" --no-pager -o cat | cut -c1-200 | tail -12
echo "fila: $(ls /var/lib/aceleriq-leitor-grupos/fila | wc -l) mensagens, $(ls /var/lib/aceleriq-leitor-grupos/fila-midia | wc -l) mídias"
