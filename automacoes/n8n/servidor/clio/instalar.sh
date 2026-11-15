#!/usr/bin/env bash
# Instala a agente Clio no Hermes do VPS (perfil próprio, skill, script da fila e rotina diária).
# Uso: bash instalar.sh perfil | rotina | estado
# Não reinicia o gateway nem toca em outro perfil. Rodar de novo não duplica nada.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
P=/root/.hermes/profiles/clio
SKILL=clio-conversas-dos-grupos
ROTINA="Clio | Conversas dos grupos → tarefas internas"
ROTINA_MAT="Clio | Guardar no painel o material que o cliente mandou no grupo"

perfil() {
  if [ ! -d "$P" ]; then
    hermes profile create clio --clone-from radar --no-alias \
      --description "Clio, Conversas dos Clientes da Aceleriq — transforma pedidos e pendências dos grupos de WhatsApp em tarefas internas com dono e prazo, sem duplicar, e registra no cérebro do cliente o que ele ensinou."
  fi
  rm -rf "$P/skills/radar-estrategico-carteira"
  install -d -m 700 "$P/skills/$SKILL" "$P/scripts"
  install -m 600 "$AQUI/SOUL.md" "$P/SOUL.md"
  install -m 600 "$AQUI/skills/$SKILL/SKILL.md" "$P/skills/$SKILL/SKILL.md"
  install -m 700 "$AQUI/clio_fila_conversas.py" "$P/scripts/clio_fila_conversas.py"
  install -m 700 "$AQUI/clio_guardar_materiais.py" "$P/scripts/clio_guardar_materiais.py"
  python3 "$AQUI/ajustar_config.py" "$P"
  echo "perfil pronto em $P"
}

rotina() {
  if hermes -p clio cron list 2>/dev/null | grep -qF "$ROTINA"; then echo "rotina já existe"; return 0; fi
  hermes -p clio cron create "45 11,15,20 * * *" "$(cat "$AQUI/rotina.txt")" \
    --name "$ROTINA | 11h45, 15h45 e 20h45" --skill "$SKILL" --script clio_fila_conversas.py \
    --deliver bot-chat:clio --failure-deliver bot-chat:clio --continuity --catch-up on
}

# Rotina mecânica: o script sobe os arquivos e manda a agente não acordar (não gasta modelo).
materiais() {
  if hermes -p clio cron list 2>/dev/null | grep -qF "$ROTINA_MAT"; then echo "rotina de materiais já existe"; return 0; fi
  hermes -p clio cron create "*/20 7-21 * * *" "O script desta rotina já guardou no painel os arquivos que os clientes mandaram nos grupos. Se você foi acordada, algo saiu do esperado: responda só com uma frase dizendo isso." \
    --name "$ROTINA_MAT | a cada 20 min" --script clio_guardar_materiais.py \
    --deliver bot-chat:clio --failure-deliver bot-chat:clio
}

estado() {
  hermes profile show clio 2>&1 | head -20 || true
  hermes -p clio cron status 2>&1 | head -8 || true
  hermes -p clio cron list 2>&1 | grep -E "Name:|Schedule:|Next run:|Last run:|Skills:|Script:|Deliver:" || true
}

case "${1:-}" in
  perfil) perfil ;;
  rotina) rotina ;;
  materiais) materiais ;;
  estado) estado ;;
  *) echo "uso: bash instalar.sh perfil | rotina | estado"; exit 1 ;;
esac
