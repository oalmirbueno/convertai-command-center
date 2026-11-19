#!/usr/bin/env bash
# Troca o nome de um grupo já liberado na lista da ponte (o grupo foi renomeado no WhatsApp; o chat_id não muda).
# Uso: bash renomear-grupo.sh "<chat_id>" "<nome novo exato>" [--reiniciar]
# Sem --reiniciar só grava a lista e confere com a trava; a ponte continua com o nome antigo na memória até reiniciar.
# Se a trava não ler a mesma quantidade de grupos, a lista antiga volta.
set -euo pipefail
CHAT="$1"; NOME="$2"; REINICIAR="${3:-}"
LISTA=/etc/mercurio-pilot/allowed-groups.json
NODE=/opt/mercurio-pilot/node
SELO=$(date +%Y%m%d%H%M%S)
cp -p "$LISTA" "$LISTA.antes-$SELO"
ANTES=$($NODE -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(d.groups.length)' "$LISTA")
$NODE -e '
const fs=require("fs");const [arq,chat,nome]=process.argv.slice(1);const d=JSON.parse(fs.readFileSync(arq,"utf8"));
const g=d.groups.find((x)=>x.chat_id===chat);if(!g){console.error("grupo nao esta na lista");process.exit(2);}
const antigo=g.group_name;g.group_name=nome;
d.autorizacao=String(d.autorizacao||"")+" | "+new Date().toISOString().slice(0,10)+": Almir informou que o grupo \""+antigo+"\" passou a se chamar \""+nome+"\"";
fs.writeFileSync(arq,JSON.stringify(d,null,2)+"\n");console.log("de: "+antigo+" | para: "+nome);' "$LISTA" "$CHAT" "$NOME"
chown root:mercurio-token "$LISTA"; chmod 640 "$LISTA"
CONFERE=$(cd /opt/mercurio-pilot/release-v1 && $NODE --input-type=module -e 'import {loadAllowedGroups} from "./pilot_guard.mjs";console.log(loadAllowedGroups().size)' 2>/dev/null | tail -1)
if [ "$CONFERE" != "$ANTES" ]; then
  cp -p "$LISTA.antes-$SELO" "$LISTA"
  echo "FALHOU: a trava leu $CONFERE grupos, esperado $ANTES. Lista antiga restaurada."; exit 1
fi
echo "lista com $ANTES grupos conferida pela trava (copia: $LISTA.antes-$SELO)"
if [ "$REINICIAR" = "--reiniciar" ]; then
  systemctl restart mercurio-pilot-bridge.service
  sleep 10
  echo "ponte: $(systemctl is-active mercurio-pilot-bridge.service)"
else
  echo "ponte NAO reiniciada: o nome novo so vale depois de reiniciar"
fi
