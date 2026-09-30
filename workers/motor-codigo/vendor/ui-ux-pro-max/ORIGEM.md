# Origem da skill ui-ux-pro-max

Instalada pelo script `workers/motor-codigo/scripts/instalar-ui-ux-pro-max.mjs` (Aceleriq). Não edite à mão: rode o script de novo.

| Item | Valor |
|---|---|
| Pacote | `ui-ux-pro-max-cli` (npm) |
| Versão | 2.15.0 |
| Integridade npm | `sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==` |
| gitHead | `a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5` |
| Repositório | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill |
| Licença | MIT, Copyright (c) 2024 Next Level Builder (arquivo LICENSE ao lado) |
| Comando | `npx --yes ui-ux-pro-max-cli@2.15.0 init --ai opencode`, numa pasta temporária |
| Data | 2026-09-30 |
| Arquivos | 48 (com LICENSE, ORIGEM.md e manifesto.json) |

## O que ficou de fora e por quê
- As skills irmãs que o instalador traz junto: `banner-design`, `brand`, `design`, `design-system`, `slides`, `ui-styling`. A `design` chama APIs externas com chave e a `ui-styling` tem outra licença (Apache 2.0); o motor usa só a `ui-ux-pro-max`.
- `scripts/tests/`: testes da própria skill, sem uso no motor.
- `__pycache__/`: cache do Python.

## O que a casa acrescentou
- `LICENSE`: o texto MIT do repositório (o pacote npm 2.15.0 não traz o arquivo, e a MIT pede o aviso junto da cópia).
- `ORIGEM.md` (este arquivo) e `manifesto.json` (SHA-256 de cada arquivo; `--conferir` refaz a conta sem rede).

## Como a casa usa
- A skill fica no worker (`workers/motor-codigo/vendor/ui-ux-pro-max`) e entra no opencode por `skills.paths`. O projeto do cliente não recebe cópia: nada dela vai para o zip do código nem para o site publicado.
- O agente de código carrega a skill pela ferramenta `skill` e roda o buscador por `node scripts/uiux.mjs` (o embrulho acha este `scripts/search.py` por UIUX_BUSCADOR, acha o Python certo e grava a prova em `.aceleriq/uiux-log.jsonl` do projeto).
- O design system do projeto (`design-system/<cliente>/MASTER.md`) é o worker que gera, pela consulta do pacote, e refaz quando a consulta muda.
- O `AGENTS.md` do projeto vence a skill: paleta, fontes, logo e copy vêm do pacote do cliente.
