#!/usr/bin/env bash
# The members contracts bootstrap their own schema; they are not pgTAP files.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${CI:-}" == true ]] || {
  echo 'Members SQL contracts require disposable GitHub CI.' >&2
  exit 1
}
cd "$(dirname "${BASH_SOURCE[0]}")/.."
container_id=''
cleanup() {
  if [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] &&
     [[ "$(docker inspect --format '{{ index .Config.Labels "io.aceleriq.test" }}' "$container_id" 2>/dev/null)" == members-sql ]]; then
    docker rm --force "$container_id" >/dev/null
  fi
}
trap cleanup EXIT
container_id="$(docker run --detach --rm --network none --cpus 1 --memory 512m \
  --label io.aceleriq.test=members-sql \
  --env POSTGRES_DB=membros_test --env POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:17.6)"
[[ "$container_id" =~ ^[a-f0-9]{64}$ ]]
wait_ready() {
  # The image's temporary init server only accepts Unix sockets. TCP confirms
  # that initialization has finished, including after the persistence restart.
  for attempt in {1..30}; do
    if docker exec "$container_id" pg_isready --host 127.0.0.1 --username postgres --dbname membros_test >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo 'Members SQL database did not start.' >&2
  return 1
}
wait_ready
run_sql() {
  echo "Members SQL: $1"
  docker exec --interactive "$container_id" psql --no-psqlrc --quiet \
    --username postgres --dbname membros_test --set ON_ERROR_STOP=1 < "$1"
}
for source in \
  supabase/tests/membros/bootstrap.sql \
  supabase/migrations/20261020150633_area_membros_biblioteca.sql \
  supabase/tests/membros/permissoes.sql \
  supabase/migrations/20261020180000_membros_previa_admin_pagamentos_pausados.sql \
  supabase/migrations/20261020180001_membros_experiencia_cliente.sql \
  supabase/tests/membros/previa.sql \
  supabase/tests/membros/teste_cliente.sql \
  supabase/migrations/20261020180352_membros_cursos_comunidade_funil.sql \
  supabase/tests/membros/previa.sql \
  supabase/tests/membros/cursos_comunidade.sql \
  supabase/migrations/20261020190625_membros_estudo_ferramentas.sql \
  supabase/tests/membros/ferramentas.sql \
  supabase/migrations/20261021130623_membros_crm_suspensao_licenca.sql \
  supabase/tests/membros/crm_suspensao.sql; do
  run_sql "$source"
done
# A real server restart verifies that progress and access were persisted.
docker restart --time 10 "$container_id" >/dev/null
wait_ready
run_sql supabase/tests/membros/persistencia.sql
echo 'Members SQL permissions, previews, tools, CRM suspension and restart persistence passed.'
