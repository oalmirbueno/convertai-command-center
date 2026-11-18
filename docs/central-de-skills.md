# Central de Skills e segundo cérebro (18/11/2026)

Um catálogo único das skills de todos os agentes (Claude Code, Codex, Hermes,
plugins e as da casa), com instalação em um comando e sincronização automática,
mais o segundo cérebro para ler e editar em tempo real.

## Peças

| Peça | Onde |
|---|---|
| Banco | `supabase/migrations/20261118150000_central_de_skills.sql` (`central_skills`, `central_skill_versoes`, `central_conectores`, `central_maquinas`, bucket privado `central-skills`) |
| Regras e banco | `supabase/functions/central-skills/modulos/nucleo.ts` |
| REST (painel, instalador, agentes sem MCP) | `supabase/functions/central-skills/index.ts` |
| MCP 2.32.0 | `supabase/functions/mcp-server/modulos/central-de-skills.ts` |
| Segundo cérebro (árvore e edição) | `listTree` e `writeNote` em `_shared/second-brain-github.ts` |
| Cliente das máquinas | `scripts/central/central.py` (publicado em `central-skills/cliente/central.py`) |
| Tela | `/skills` (menu Agentes > Skills e cérebro), `src/pages/CentralDeSkills.tsx` |

## Como funciona

- `central.py sync` lê as skills de `~/.claude/skills`, `~/.codex/skills`,
  `~/.hermes/skills`, `~/.agents/skills` e dos plugins do Claude. A mesma skill
  em vários agentes vira um slug só (pelo `name` do frontmatter).
- Sobe a cópia mais nova de cada slug (zip no Storage, SKILL.md no banco);
  conteúdo igual não gera versão. Depois baixa para cada agente o que falta ou
  está velho. Vence a mais nova; versões antigas ficam em `central_skill_versoes`.
- Fica de fora: `node_modules`, `.git`, `.env*`, chaves, arquivos acima de
  15 MB e qualquer texto com cara de token. Pacote máximo 44 MB.
- No Claude, skill que vem de plugin instalado não é copiada (vem pelo plugin).
  No Hermes, skill nova entra em `~/.hermes/skills/central-<categoria>/<slug>`.
- `central.py instalar` também liga a tarefa a cada 30 min (Windows) ou cron
  (Linux), o hook `SessionStart` do Claude Code e o aviso em
  `~/.claude/CLAUDE.md` e `~/.codex/AGENTS.md`.
- Conectores: plugins e servidores MCP de cada máquina entram só com nome, como
  instalar e os NOMES das variáveis que pedem.

## Chave

Credencial MCP com `memory:read` (ou `aceleriq:read`) para ler e `memory:write`
para publicar. Na máquina fica em `ACELERIQ_CENTRAL_TOKEN` (Linux: também
`~/.aceleriq/token`, 600).

## Segundo cérebro

`aceleriq_cerebro_arvore` lista, `memory_fetch` lê, `aceleriq_cerebro_salvar_nota`
cria ou edita (com o sha lido; cada gravação é um commit com o nome do agente).
Memória consolidada (MEMORY.md, now, decisions, lessons, pending, projects/,
context/, AGENTS.md) segue a revisão diária: agente usa `memory_propose_update`.
Admin no painel edita tudo, menos `scripts/`, `.github/` e `claude-code/`.
