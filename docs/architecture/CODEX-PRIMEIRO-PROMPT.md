# Primeiro prompt para o Codex

Use este prompt depois que `AGENTS.md` e o documento canônico estiverem no repositório:

```text
Abra o repositório `oalmirbueno/convertai-command-center` e confirme que está no `main` remoto mais recente.

Antes de propor alterações:
1. leia integralmente `AGENTS.md`;
2. leia `docs/architecture/ACELERIQ-CONTEXTO-CANONICO.md`;
3. inspecione o código e as migrations atuais;
4. consulte o MCP do Aceleriq OS apenas em leitura para confirmar o estado vivo relevante;
5. reporte qualquer divergência entre documentação, GitHub, Lovable e painel.

Trabalharemos por lotes. Para cada lote:
- apresente primeiro objetivo, arquivos, riscos e critério de aceite;
- crie uma branch `codex/<nome-do-lote>` a partir do main atualizado;
- nunca faça push direto em main;
- não publique no Lovable;
- não execute SQL, migration, exclusão ou alteração de secrets sem autorização explícita;
- preserve rotas e fluxos existentes;
- rode testes, TypeScript, build e revisão do diff;
- abra draft PR e entregue checklist de Preview e rollback.

Neste primeiro contato, não altere código. Apenas confirme o contexto recuperado e proponha a divisão dos próximos três lotes, começando pelo menor lote que entregue valor sem risco para clientes atuais.
```

Depois desse primeiro contato, os prompts podem ser curtos: objetivo do lote, limites e critério de aceite. O restante será carregado pelo `AGENTS.md` e pelo documento canônico.
