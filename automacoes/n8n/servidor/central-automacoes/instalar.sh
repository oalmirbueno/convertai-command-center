#!/bin/sh
# Instala o coletor da Central de Automações no VPS (rodar como root, na pasta com os arquivos).
# Gera a chave do coletor se ainda não existir e imprime SÓ o sha256 dela (vai para o segredo
# AUTOMACOES_COLETOR_SHA256 da função automacoes-n8n). A chave nunca sai do servidor.
set -eu
install -d -m 755 /opt/aceleriq-automacoes /var/lib/aceleriq-automacoes
install -d -m 700 /etc/aceleriq-automacoes
install -m 755 coletor.py /opt/aceleriq-automacoes/coletor.py
install -m 644 aceleriq-automacoes-coletor.service aceleriq-automacoes-coletor.timer /etc/systemd/system/
if [ ! -s /etc/aceleriq-automacoes/chave ]; then
  python3 -c "import secrets;print(secrets.token_hex(32))" > /etc/aceleriq-automacoes/chave
  chmod 600 /etc/aceleriq-automacoes/chave
fi
if [ ! -s /etc/aceleriq-automacoes/coletor.json ]; then
  printf '{"url": "https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/automacoes-n8n", "arquivo_da_chave": "/etc/aceleriq-automacoes/chave"}\n' > /etc/aceleriq-automacoes/coletor.json
  chmod 600 /etc/aceleriq-automacoes/coletor.json
fi
systemctl daemon-reload
printf 'sha256 da chave: '; tr -d '\n' < /etc/aceleriq-automacoes/chave | sha256sum | cut -d' ' -f1
echo "Ligar depois do segredo publicado: systemctl enable --now aceleriq-automacoes-coletor.timer"
