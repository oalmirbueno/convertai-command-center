#!/bin/bash
# Reaponta o webhook do WhatsApp (app AceleriQ Whats 923847673362091, campo messages) para o n8n novo.
# Os segredos (app_secret e verify_token) são lidos pelo próprio n8n em acq_n8n.cursores e não saem do servidor.
# Só rodar com o ok do Almir e com o fluxo "Comercial: respostas no WhatsApp" (ACQ-07) JÁ publicado,
# porque a Meta chama o endereço na hora para conferir.
# Uso: bash reapontar-meta.sh https://n8n.aceleriq.com.br
set -euo pipefail
BASE="${1:?diga o endereço, ex.: https://n8n.aceleriq.com.br}"
BASE="${BASE%/}"
C=n8n-recovery-n8n-1
APP=923847673362091
ATIVOS=$(docker exec "$C" n8n list:workflow --active=true 2>/dev/null || true)
case "$ATIVOS" in *"Acq07ComercialRs|"*) ;; *) echo "ACQ-07 não está publicado; nada alterado"; exit 1;; esac
curl -fsS -m 20 "$BASE/healthz" >/dev/null || { echo "$BASE/healthz não respondeu; nada alterado"; exit 1; }
T=$(mktemp)
BASE="$BASE" APP="$APP" python3 - > "$T" <<'PY'
import json, os
base, app = os.environ['BASE'], os.environ['APP']
pg = {"postgres": {"id": "AcqCredPg0000001", "name": "ACQ Estado (Postgres acq_n8n)"}}
wf = {
  "id": "AcqMetaReapontar1", "name": "Apoio: reapontar webhook da Meta (uso único)", "active": False,
  "nodes": [
    {"id": "m1", "name": "Rodar", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "parameters": {}},
    {"id": "m2", "name": "Segredos", "type": "n8n-nodes-base.postgres", "typeVersion": 2.7, "position": [240, 0], "credentials": pg,
     "parameters": {"operation": "executeQuery", "query": "select valor->>'app_secret' as s, valor->>'verify_token' as v from acq_n8n.cursores where workflow_id='ACQ-07' and chave='segredos_webhook'", "options": {}}},
    {"id": "m3", "name": "Meta", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.5, "position": [480, 0], "onError": "continueRegularOutput",
     "parameters": {"method": "POST", "url": "https://graph.facebook.com/v21.0/" + app + "/subscriptions", "sendBody": True, "contentType": "form-urlencoded",
       "bodyParameters": {"parameters": [
         {"name": "object", "value": "whatsapp_business_account"}, {"name": "callback_url", "value": base + "/webhook/acq07-whatsapp"},
         {"name": "fields", "value": "messages"}, {"name": "include_values", "value": "true"},
         {"name": "verify_token", "value": "={{ $json.v }}"}, {"name": "access_token", "value": "={{ '" + app + "|' + $json.s }}"}]},
       "options": {"timeout": 60000, "response": {"response": {"fullResponse": True, "neverError": True}}}}},
    {"id": "m4", "name": "Resultado", "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": [720, 0],
     "parameters": {"assignments": {"assignments": [
        {"id": "a", "name": "http", "type": "number", "value": "={{ $json.statusCode }}"},
        {"id": "b", "name": "resposta", "type": "string", "value": "={{ JSON.stringify($json.body).replace(/[A-Za-z0-9_|-]{30,}/g, '<oculto>').slice(0, 300) }}"}]}, "options": {}}}
  ],
  "connections": {"Rodar": {"main": [[{"node": "Segredos", "type": "main", "index": 0}]]}, "Segredos": {"main": [[{"node": "Meta", "type": "main", "index": 0}]]}, "Meta": {"main": [[{"node": "Resultado", "type": "main", "index": 0}]]}},
  "settings": {"executionOrder": "v1", "saveManualExecutions": False, "saveDataErrorExecution": "none", "saveDataSuccessExecution": "none"}, "pinData": {}
}
print(json.dumps(wf))
PY
docker cp "$T" "$C":/tmp/meta-reapontar.json
rm -f "$T"
docker exec -u root "$C" chmod 644 /tmp/meta-reapontar.json
docker exec "$C" n8n import:workflow --input=/tmp/meta-reapontar.json 2>&1 | grep -v license
docker exec -u root "$C" rm -f /tmp/meta-reapontar.json
docker exec -e N8N_RUNNERS_BROKER_PORT=5690 -e N8N_RUNNERS_ENABLED=false "$C" n8n execute --id=AcqMetaReapontar1 --rawOutput 2>&1 | python3 -c '
import sys, json
t = sys.stdin.read()
try:
    j = json.loads(t[t.index("{\"data\""):] if "{\"data\"" in t else t[t.index("{"):])
    r = j["data"]["resultData"]["runData"].get("Resultado")
    print("Meta respondeu:", json.dumps(r[0]["data"]["main"][0][0]["json"], ensure_ascii=False) if r else "sem resultado (ver execução)")
except Exception as e:
    print("não consegui ler a saída:", str(e)[:200])
'
