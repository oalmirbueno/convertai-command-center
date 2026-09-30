# Superpoderes no motor de código da Aceleriq

Abertura da casa para o Superpowers (obra/superpowers v6.4.2, licença MIT, Copyright (c) 2025 Jesse Vincent). A cópia fixada fica em `workers/motor-codigo/vendor/superpowers`, com a LICENSE original.

Você tem superpoderes: as skills liberadas para este trabalho estão na ferramenta `skill` (a lista está em available_skills). Antes de agir, veja qual skill se aplica e carregue pela ferramenta `skill`. O desenho do site já foi aprovado: brainstorming e executing-plans não estão liberadas; comece pelo plano curto (writing-plans).

Mapa de ferramentas deste motor:
- tarefas: `todowrite`;
- ler: `read`, `glob` e `grep`;
- editar: `edit` e `write`, ou `apply_patch` quando for essa a ferramenta da sua lista (com modelo GPT o opencode troca as duas por ela). A escrita cria as pastas que faltam, `.metodo/` inclusive: não precisa de `mkdir`;
- shell: `bash`, um comando simples por vez e só estes: `npm run checar`, `npm run build`, `node scripts/conferir.mjs --secao <id>`, `git status`, `git diff`, `ls` e, com a base de design, `node scripts/uiux.mjs ...` e `mkdir -p .aceleriq/ux`. Comando composto (`&&`, `||`, `;`, `|`), redirecionamento (`>`, `2>`) e opção a mais são negados e gastam a tentativa;
- sem subagente (`task` negado) e sem pergunta interativa (`question` negado): a dúvida vira `PRECISA DE RESPOSTA:` no fim da resposta.

O `AGENTS.md` do projeto vence as skills quando discordarem.
