#!/usr/bin/env bash
# Libera 3 grupos novos para o aviso de post no ar (Softy, Casa dos Assados, Skyfleet) e liga a rotina de envio.
# Pedido do Almir em 09/11/2026. Pode rodar mais de uma vez: não duplica grupo. Se a lista nova não passar na
# conferência da trava, os arquivos antigos voltam e a ponte não é reiniciada.
set -euo pipefail
LISTA=/etc/mercurio-pilot/allowed-groups.json
GUARDA=/opt/mercurio-pilot/release-v1/pilot_guard.mjs
NODE=/opt/mercurio-pilot/node
SELO=$(date +%Y%m%d%H%M%S)

cp -p "$LISTA" "$LISTA.antes-$SELO"
cp -p "$GUARDA" "$GUARDA.antes-$SELO"

TOTAL=$($NODE -e '
const fs=require("fs");const arq=process.argv[1];const d=JSON.parse(fs.readFileSync(arq,"utf8"));
const novos=[
 {chat_id:"120363430155631136@g.us",group_name:"Softy - MKT - Aceleriq",client_id:"3d08338c-0c3b-453f-a64f-79a55c5711e8",client_name:"Softy Móveis"},
 {chat_id:"120363413077517896@g.us",group_name:"Casa dos Assados - MKT - Aceleriq",client_id:"d3dacbac-0da6-49eb-8322-31ae22bd79b4",client_name:"Casa dos Assados"},
 {chat_id:"120363431505782128@g.us",group_name:"Skyfleet - MKT - Aceleriq",client_id:"213848fc-5a01-400b-8896-ddde03ba33ec",client_name:"Skyfleet"}];
for(const g of novos) if(!d.groups.some(x=>x.chat_id===g.chat_id)) d.groups.push(g);
d.autorizacao=String(d.autorizacao||"")+" | 09/11/2026: Almir liberou tambem Softy, Casa dos Assados e Skyfleet para o aviso de post no ar";
fs.writeFileSync(arq,JSON.stringify(d,null,2)+"\n");
console.log(d.groups.length);' "$LISTA")
chown root:mercurio-token "$LISTA"; chmod 640 "$LISTA"
sed -i -E "s/^const ALLOWED_GROUP_COUNT=[0-9]+;/const ALLOWED_GROUP_COUNT=$TOTAL;/" "$GUARDA"

CONFERE=$(cd /opt/mercurio-pilot/release-v1 && $NODE --input-type=module -e 'import {loadAllowedGroups} from "./pilot_guard.mjs";console.log(loadAllowedGroups().size)' 2>/dev/null | tail -1)
if [ "$CONFERE" != "$TOTAL" ]; then
  cp -p "$LISTA.antes-$SELO" "$LISTA"; cp -p "$GUARDA.antes-$SELO" "$GUARDA"
  echo "FALHOU: a trava leu $CONFERE grupos, esperado $TOTAL. Arquivos antigos restaurados, ponte nao reiniciada."; exit 1
fi
echo "lista com $TOTAL grupos conferida pela trava"

systemctl restart mercurio-pilot-bridge.service
sleep 10
echo "ponte: $(systemctl is-active mercurio-pilot-bridge.service)"
curl -s -m 10 -H "authorization: Bearer $(cat /etc/mercurio-pilot/bridge.token)" http://127.0.0.1:3049/health | cut -c1-90; echo

# rotina de envio a cada 3 minutos, no modo real
sed -E 's/^Environment=POST_NO_AR_MODO=.*/Environment=POST_NO_AR_MODO=grupos/' /opt/aceleriq-post-no-ar/aceleriq-post-no-ar.service > /etc/systemd/system/aceleriq-post-no-ar.service
cp /opt/aceleriq-post-no-ar/aceleriq-post-no-ar.timer /etc/systemd/system/aceleriq-post-no-ar.timer
systemctl daemon-reload
systemctl enable --now aceleriq-post-no-ar.timer
echo "rotina: $(systemctl is-active aceleriq-post-no-ar.timer)"
