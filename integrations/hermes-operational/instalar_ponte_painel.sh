#!/usr/bin/env bash
# Instala a ponte painel -> sessões reais do Hermes (Central de Autonomia, 08/10/2026).
# RODAR NO SERVIDOR DO HERMES (srv1769409) como root, SÓ com autorização do Almir.
#
# Aditivo: não toca no gateway, na ponte MCP nem no dashboard. O único efeito
# colateral é reiniciar o container do proxy (aceleriq-hermes-dashboard-proxy),
# porque o Traefik dele roda com watch=false: 1 a 2 s fora do ar em
# hermes.aceleriq.com.br.
#
# Uso:  bash instalar_ponte_painel.sh <arquivo-com-o-token>
#   O token (64 hex) é o MESMO que vai para o segredo HERMES_PAINEL_TOKEN das
#   funções do Supabase. Ele não aparece na tela nem no log.
#
# Rollback: systemctl disable --now hermes-painel-ponte; restaurar
#   /etc/aceleriq-hermes-native-dashboard/proxy-dynamic.yml.antes-painel-ponte
#   e reiniciar o container do proxy; apagar /etc/credstore.encrypted/aceleriq-painel-ponte-token.cred.
set -Eeuo pipefail
umask 077
TOKEN_FILE="${1:?informe o arquivo com o token}"
[[ $(tr -d '\n' < "$TOKEN_FILE" | wc -c) -ge 32 ]] || { echo "token curto" >&2; exit 1; }
AQUI="$(cd "$(dirname "$0")" && pwd)"

install -d -m 0755 /opt/aceleriq-hermes-painel
install -m 0644 "$AQUI/painel_ponte.mjs" /opt/aceleriq-hermes-painel/painel_ponte.mjs
tr -d '\n' < "$TOKEN_FILE" | systemd-creds encrypt --name=painel-token - /etc/credstore.encrypted/aceleriq-painel-ponte-token.cred
install -m 0644 "$AQUI/hermes-painel-ponte.service" /etc/systemd/system/hermes-painel-ponte.service
systemctl daemon-reload
systemctl enable --now hermes-painel-ponte
sleep 2
systemctl is-active hermes-painel-ponte

DYN=/etc/aceleriq-hermes-native-dashboard/proxy-dynamic.yml
if ! grep -q "painel-api" "$DYN"; then
  cp -p "$DYN" "$DYN.antes-painel-ponte"
  python3 - "$DYN" <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace("  routers:\n", """  routers:
    painel-api:
      entryPoints: [bridge]
      rule: "PathPrefix(`/painel-api/`)"
      priority: 200
      middlewares: [public-forwarded]
      service: painel-api
""", 1)
s = s.replace("  services:\n", """  services:
    painel-api:
      loadBalancer:
        passHostHeader: false
        servers:
          - url: "http://172.16.0.1:9121"
""", 1)
open(p, "w").write(s)   # mesmo inode (o arquivo é montado no container)
EOF
  docker restart aceleriq-hermes-dashboard-proxy >/dev/null
fi
sleep 3
echo "saúde sem token (espera 401): $(curl -s -o /dev/null -w '%{http_code}' https://hermes.aceleriq.com.br/painel-api/saude)"
echo "dashboard (espera 302): $(curl -s -o /dev/null -w '%{http_code}' https://hermes.aceleriq.com.br/)"
