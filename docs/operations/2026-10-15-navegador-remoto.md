# Navegador remoto: revisão de persistência e abas

Estado em 15/10/2026: correção preparada para revisão na PR #79, sem publicação em produção.
Base conferida: `main` em `b4ee182aa8c8baf76aca564e22f6eec2c2f7f31c`.

## Comportamento corrigido

- A URL da visualização fica fixada por cliente, sessão e ID da aba. O polling não troca o iframe quando o provedor renova a URL de debug.
- Ampliar e reduzir muda o CSS do mesmo contêiner. O iframe permanece montado, sem mudança de portal ou de instância React.
- As páginas expõem o ID estável fornecido pelo Browserbase. A seleção não depende da URL nem da ordem da lista.
- Ativar uma aba exige `sessao_id` e `aba_id`. Aba removida ou sessão substituída retorna erro sem ativar outro alvo.
- Criar aba a partir da Central exige a sessão esperada. Uma sessão expirada não abre outra em silêncio.
- Respostas atrasadas não alteram o cliente, a sessão ou a visualização atual.
- Falha transitória de leitura do provedor não comprova encerramento da sessão.
- O Cofre oficial abre sob permissão administrativa, acima do navegador ampliado. A pessoa consulta ou copia o acesso; preenchimento automático não faz parte desta alteração.

Nenhuma migration, conta Meta, campanha, senha ou perfil persistente foi alterado. Chamadas antigas que não usam a seleção de aba por ID continuam compatíveis.

## Verificação realizada

| Verificação | Resultado |
| --- | --- |
| Deno: `navegador-remoto/persistencia_test.ts` | 9 testes passaram, com provedor, banco e CDP falsos |
| Regressões de interface e provedor | 16 casos preparados; Vitest iniciou, mas o runtime Node não concluiu |
| Typecheck da aplicação e Node | Sem conclusão ou diagnóstico útil; tentativas canceladas ou encerradas por timeout |
| Build e typecheck dos testes | Não executados após o bloqueio do runtime |
| Compatibilidade MCP: generate | Passou; artefato gerado equivale ao existente, sem alteração necessária |
| Compatibilidade MCP: verify | Bloqueado pelo SDK `@lovable.dev/mcp-js` ausente no ambiente |
| Deno check do endpoint e MCP | Bloqueado por DNS nos imports legados de `esm.sh` |
| Revisão estática e diff | Sem outro bloqueante conhecido, sem marcadores de conflito ou novos espaços finais |

Os testes de interface cobrem polling equivalente a 45 segundos, ampliação, abas com URL igual, reordenação, respostas atrasadas e permissão do Cofre. Não foram declarados aprovados. A revisão estática não substitui o teste no Preview.

## Pendências para publicação

1. Concluir os testes direcionados, tipos, build e compatibilidade em um runtime funcional e verificar o novo CI da PR.
2. No Preview autenticado, abrir o navegador da Casa dos Assados, observar polling por mais de 30 segundos, alternar abas, criar outra, ampliar/reduzir e abrir o Cofre e seu editor sem perder a visualização.
3. Confirmar encerramento/reabertura no mesmo perfil, preservando login quando o provedor o tiver salvo. Login humano permanece necessário quando a conta estiver deslogada.
4. Fazer revisão humana antes do merge, conforme `AGENTS.md`.
5. Publicar o backend que incorpora o motor e o provedor antes do frontend que envia os novos IDs; expor a alteração do MCP pelo fluxo oficial correspondente.

Rollback: reverter primeiro o frontend e depois as funções afetadas pelo fluxo oficial, preservando os contextos e as sessões existentes. Não há rollback de banco.

Referência do contrato de páginas: https://docs.browserbase.com/reference/api/session-live-urls
