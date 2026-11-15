#!/usr/bin/env bash
# Instala o leitor dos grupos de clientes (só leitura) no servidor do Hermes. Pedido do Almir em 09/11/2026.
# Não toca na ponte do comercial (mercurio-pilot-bridge), não reinicia nada que já roda e pode rodar de novo.
#
# Uso (como root, na pasta onde os arquivos foram copiados):
#   bash instalar.sh preparar                 -> usuário, pastas, Whisper e teste de transcrição (não conecta nada)
#   bash instalar.sh segredo                  -> pede o segredo do webhook do n8n (digitado escondido)
#   bash instalar.sh tudo                     -> faz tudo de uma vez: preparar, QR code na tela e ligar
#   bash instalar.sh qr                       -> mostra o QR code para ler com o celular do número da equipe
#   bash instalar.sh parear 5541XXXXXXXXX     -> alternativa ao QR: código para digitar no celular
#   bash instalar.sh ligar                    -> liga o serviço e mostra o estado
#   bash instalar.sh estado                   -> mostra se está conectado, última mensagem e fila
#   bash instalar.sh desligar                 -> para o serviço (não apaga nada)
set -euo pipefail
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/aceleriq-leitor-grupos
DADOS=/var/lib/aceleriq-leitor-grupos
CONF=/etc/aceleriq-leitor-grupos
NODE=/opt/mercurio-pilot/node
MODULOS=/usr/local/lib/hermes-agent/scripts/whatsapp-bridge/node_modules
USUARIO=aceleriq-leitor
WEBHOOK_PADRAO="https://blue-fly-822772.hostingersite.com/webhook/acq04-mensagens"

como_leitor() { runuser -u "$USUARIO" -- env HOME="$DADOS" HF_HOME="$DADOS/modelos" LEITOR_DIR="$DADOS" LEITOR_GRUPOS="$CONF/grupos.json" "$@"; }

case "${1:-}" in
preparar)
  id "$USUARIO" >/dev/null 2>&1 || useradd --system --home-dir "$DADOS" --shell /usr/sbin/nologin "$USUARIO"
  install -d -m 755 "$APP"
  install -d -m 700 -o "$USUARIO" -g "$USUARIO" "$DADOS" "$DADOS/modelos"
  install -d -m 750 -o root -g "$USUARIO" "$CONF"
  install -m 644 "$ORIGEM/leitor.mjs" "$ORIGEM/leitor.test.mjs" "$ORIGEM/transcrever.py" "$ORIGEM/aceleriq-leitor-grupos.service" "$APP/"
  ln -sfn "$MODULOS" "$APP/node_modules"
  # Cópia própria da lista de grupos (a original só a ponte lê). Rodar "preparar" de novo atualiza a cópia.
  install -m 640 -o root -g "$USUARIO" /etc/mercurio-pilot/allowed-groups.json "$CONF/grupos.json"
  if [ ! -f "$CONF/leitor.env" ]; then
    cat > "$CONF/leitor.env" <<EOF
HOME=$DADOS
HF_HOME=$DADOS/modelos
LEITOR_DIR=$DADOS
LEITOR_GRUPOS=$CONF/grupos.json
LEITOR_WEBHOOK_URL=$WEBHOOK_PADRAO
LEITOR_WEBHOOK_CABECALHO=x-acq-segredo
LEITOR_WEBHOOK_SEGREDO_ARQUIVO=$CONF/webhook.segredo
LEITOR_WHISPER_MODELO=small
LEITOR_WHISPER_THREADS=2
LEITOR_DIAS_AUDIO=7
EOF
    chown root:"$USUARIO" "$CONF/leitor.env"; chmod 640 "$CONF/leitor.env"
  fi
  [ -x "$APP/venv/bin/python" ] || python3 -m venv "$APP/venv"
  "$APP/venv/bin/pip" install --quiet --upgrade pip
  "$APP/venv/bin/pip" install --quiet "faster-whisper>=1.0,<2"
  echo "== teste do leitor (funções e trava de só leitura)"
  (cd "$APP" && como_leitor "$NODE" --test leitor.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)")
  echo "== teste de transcrição (baixa o modelo na primeira vez, ~500 MB)"
  TESTE=$(mktemp --suffix=.ogg -p "$DADOS"); chown "$USUARIO" "$TESTE"
  ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=440:duration=2" -c:a libopus "$TESTE"
  como_leitor "$APP/venv/bin/python" "$APP/transcrever.py" "$TESTE" || true
  rm -f "$TESTE"
  echo "(tom sem fala: o esperado acima é {\"ok\": false, \"motivo\": \"sem_fala\"})"
  cp "$APP/aceleriq-leitor-grupos.service" /etc/systemd/system/aceleriq-leitor-grupos.service
  systemctl daemon-reload
  echo "preparado. Grupos na lista: $(como_leitor "$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.LEITOR_GRUPOS,"utf8")).groups.length)')"
  echo "ponte do comercial: $(systemctl is-active mercurio-pilot-bridge.service) (não foi tocada)"
  ;;
segredo)
  read -r -s -p "Cole o segredo do webhook (credencial 'ACQ Webhook mensagens (segredo)' do n8n) e Enter: " S; echo
  [ ${#S} -ge 16 ] || { echo "segredo curto demais (mínimo 16 caracteres)"; exit 1; }
  umask 077; printf '%s' "$S" > "$CONF/webhook.segredo"; chown root:"$USUARIO" "$CONF/webhook.segredo"; chmod 640 "$CONF/webhook.segredo"
  echo "segredo gravado em $CONF/webhook.segredo"
  ;;
parear)
  NUM="${2:-}"; [[ "$NUM" =~ ^55[0-9]{10,11}$ ]] || { echo "informe o número com 55 e DDD, só dígitos"; exit 1; }
  systemctl stop aceleriq-leitor-grupos.service 2>/dev/null || true
  (cd "$APP" && como_leitor "$NODE" leitor.mjs --parear "$NUM")
  ;;
qr)
  systemctl stop aceleriq-leitor-grupos.service 2>/dev/null || true
  (cd "$APP" && como_leitor "$NODE" leitor.mjs --qr)
  ;;
tudo)
  bash "$0" preparar
  bash "$0" qr
  bash "$0" ligar
  ;;
ligar)
  [ -s "$CONF/webhook.segredo" ] || echo "AVISO: sem segredo do webhook; o leitor guarda as mensagens na fila e entrega quando houver."
  systemctl enable --now aceleriq-leitor-grupos.service
  sleep 12
  bash "$0" estado
  ;;
estado)
  echo "serviço: $(systemctl is-active aceleriq-leitor-grupos.service || true)"
  [ -f "$DADOS/estado.json" ] && cat "$DADOS/estado.json" && echo
  echo "na fila para o n8n: $(ls "$DADOS/fila" 2>/dev/null | wc -l) | recusadas: $(ls "$DADOS/recusadas" 2>/dev/null | wc -l) | áudios guardados: $(ls "$DADOS/audio" 2>/dev/null | wc -l)"
  echo "mensagens de hoje: $(cat "$DADOS/diario/$(date -u +%F).jsonl" 2>/dev/null | wc -l)"
  echo "ponte do comercial: $(systemctl is-active mercurio-pilot-bridge.service)"
  journalctl -u aceleriq-leitor-grupos.service --no-pager -n 8 -o cat 2>/dev/null || true
  ;;
desligar)
  systemctl disable --now aceleriq-leitor-grupos.service
  echo "leitor parado. Para tirar o aparelho: WhatsApp > Aparelhos conectados > Chrome (Ubuntu) > Desconectar."
  ;;
*) sed -n 2,14p "$0"; exit 1 ;;
esac
