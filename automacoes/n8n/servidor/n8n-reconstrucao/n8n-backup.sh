#!/bin/bash
# Cópia diária do n8n (banco SQLite pela API de backup, que é consistente com o n8n ligado,
# mais config, compose e .env). Guarda 14 dias em /root/backups/n8n. Instalado em /usr/local/sbin.
set -euo pipefail
umask 077
B=/root/backups/n8n
P=/docker/n8n-recovery
DADOS=$(docker volume inspect n8n-recovery_n8n_data --format '{{.Mountpoint}}')
T=$(mktemp -d)
trap 'rm -f "$T"/* 2>/dev/null; rmdir "$T" 2>/dev/null || true' EXIT
python3 - "$DADOS/database.sqlite" "$T/database.sqlite" <<'PY'
import sqlite3, sys
o = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
d = sqlite3.connect(sys.argv[2])
o.backup(d)
ok = d.execute('pragma integrity_check').fetchone()[0]
d.close(); o.close()
if ok != 'ok':
    sys.exit('banco copiado com erro: ' + ok)
PY
cp -p "$DADOS/config" "$T/config"
cp -p "$P/docker-compose.yml" "$T/docker-compose.yml"
cp -p "$P/.env" "$T/env"
F="$B/n8n-diario-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$F" -C "$T" .
chmod 600 "$F"
find "$B" -maxdepth 1 -name 'n8n-diario-*.tar.gz' -mtime +14 -delete
echo "ok $F $(du -h "$F" | cut -f1)"
