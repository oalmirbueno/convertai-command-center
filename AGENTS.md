# Aceleriq OS — instruções para agentes de código

## Contexto obrigatório

Antes de planejar ou editar, leia `docs/architecture/ACELERIQ-CONTEXTO-CANONICO.md` e confirme o estado atual no código. Use o MCP do Aceleriq OS somente para estado operacional vivo autorizado; o painel é a fonte da verdade dos dados e o Git é a fonte da verdade do código e da arquitetura versionada.

## Ambiente canônico

- Repositório: `oalmirbueno/convertai-command-center`.
- Aplicação: Aceleriq Comando OS, construída com Lovable.
- Backend: o mesmo Lovable Cloud/Postgres do projeto `gicbrgagstyvbaaumprj`.
- Nunca criar outro projeto Lovable, Cloud, banco ou repositório como atalho.
- Antes de começar, atualizar a partir do `main` remoto real. Não usar mirrors antigos.

## Forma de trabalho

- Um lote pequeno e verificável por vez.
- Criar branch `codex/<lote-curto>`; nunca editar ou fazer push direto em `main`.
- Codex e Lovable não podem editar os mesmos arquivos simultaneamente. Há um único escritor por lote.
- Abrir draft PR com resumo, riscos, testes e checklist de Preview.
- Merge só após revisão humana. Publish no Lovable é uma etapa manual e separada.
- Preservar mudanças existentes e rotas legadas. Mudanças novas de API são versionadas e compatíveis.

## Guardrails

- Não expor secrets, tokens, PII ou credenciais em código, logs, prompts ou PRs.
- Credenciais ficam no servidor. Frontend nunca recebe segredo compartilhado.
- Respeitar RLS, isolamento por cliente e menor privilégio.
- Agentes não aprovam conteúdo nem publicam diretamente.
- Double-Gate: agência aprova, depois cliente aprova; a versão aprovada é imutável.
- Mudança de schema exige plano separado, SQL incremental no mesmo banco, preflight, rollback lógico e autorização explícita.
- Não executar Publish, migração, exclusão, rotação de segredo ou alteração destrutiva sem aprovação explícita.

## Verificação mínima

Execute, quando aplicável:

```bash
npm test -- --run
npx tsc --noEmit
npm run build
npx lovable-mcp-extract-manifest
git diff --check
```

O lint global possui dívida técnica antiga; reporte baseline versus erros introduzidos pelo lote. Edge Functions precisam de smoke test no Preview quando Deno não estiver disponível localmente.

## Definição de pronto

- Escopo solicitado implementado sem regressão conhecida.
- Build, tipos e testes relevantes executados.
- Diff revisado, sem secrets nem SQL inesperado.
- Compatibilidade com Lovable Cloud e fluxos atuais confirmada.
- Instruções de Preview e rollback registradas no PR.
- Resposta final em português do Brasil, começando pelo resultado.
