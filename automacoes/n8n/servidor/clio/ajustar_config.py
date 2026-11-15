#!/usr/bin/env python3
"""Ajusta o perfil clonado para a Clio: ferramentas do painel que ela pode usar e a apresentação no Hermes.

Não lê nem imprime a chave do painel: só troca a lista de ferramentas permitidas. Guarda uma cópia do config antes.
"""
import shutil
import sys
import time
from pathlib import Path

import yaml

FERRAMENTAS = [
    # leitura (enxuta: tarefas abertas e projetos já vêm na fila do n8n)
    "aceleriq_health",
    "aceleriq_panorama_do_cliente",
    "aceleriq_get_project",
    "aceleriq_cerebro_do_cliente",
    "aceleriq_dia_prioritario",
    # escrita interna (tarefa com dono e prazo; aprendizado do cliente)
    "aceleriq_create_task",
    "aceleriq_cerebro_registrar",
]

perfil = Path(sys.argv[1])
cfg_path = perfil / "config.yaml"
copia = perfil / "backups" / f"config.yaml.antes-clio-{time.strftime('%Y%m%d-%H%M%S')}"
copia.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(cfg_path, copia)

cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
painel = cfg["mcp_servers"]["aceleriq"]
painel.setdefault("tools", {})["include"] = FERRAMENTAS
cfg["tools"] = {"enabled_toolsets": ["skills"]}
# O gateway guarda a lista de ferramentas do perfil clonado; sem isto o /reload-mcp pede confirmação que
# ninguém responde numa rodada sem gente. Só vale para este perfil e só para a recarga da lista.
cfg.setdefault("approvals", {})["mcp_reload_confirm"] = False
cfg["platform_toolsets"] ={"cli": ["aceleriq", "skills"], "cron": ["skills", "aceleriq"]}
cfg_path.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")
cfg_path.chmod(0o600)

meta_path = perfil / "profile.yaml"
meta = yaml.safe_load(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
meta = meta or {}
meta["description"] = (
    "Clio, Conversas dos Clientes da Aceleriq — transforma pedidos e pendências dos grupos de WhatsApp em tarefas "
    "internas com dono e prazo, sem duplicar, e registra no cérebro do cliente o que ele ensinou."
)
meta["description_auto"] = False
bots = meta.setdefault("ui_meta", {}).setdefault("hermes-bots", {})
bots.update({"title": "CLIO", "group": "Operação e Entrega", "groups": ["Operação e Entrega", "Aceleriq | Conselho Operacional"], "color": "#14b8a6"})
bots.setdefault("created", int(time.time() * 1000))
meta_path.write_text(yaml.safe_dump(meta, allow_unicode=True, sort_keys=False), encoding="utf-8")

print("ferramentas do painel liberadas:", len(FERRAMENTAS))
print("apresentação:", bots["title"], "/", bots["group"])
