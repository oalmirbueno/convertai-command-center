# PROGRESS — MCP 2.38.0 (carrossel de Arquivos)
Branch: infra/mcp-2.38.0-carrossel-de-arquivos (base origin/main 57473056). Prompt: /workspace/mcp-238/prompt-claude.md
Retomar: `git log --oneline origin/main..HEAD` + este arquivo.

- [x] Investigação do modelo real (banco, somente leitura) — ver prompt
- [x] Tool 1 aceleriq_arquivos_agrupar_carrossel (commit "MCP 2.38.0: agrupar carrossel")
- [x] Tool 2 aceleriq_agenda_criar_post_de_arquivo (commit "MCP 2.38.0: post da Agenda de arquivo")
- [ ] Tool 3 aceleriq_arquivos_enviar_para_aprovacao
- [ ] Versão 2.38.0, contagem de tools em mcp_test.ts (226 -> 229), guia
- [ ] (Almir) PR, merge, bundle, deploy, prova — fora deste executor

## Decisões
- Regras puras em `supabase/functions/_shared/carrossel-de-arquivos.ts` (sem import): Deno e vitest leem o mesmo arquivo.
  A ordem é cópia fiel de `src/lib/editorialMedia.ts`; `src/test/mcp-carrossel-de-arquivos.test.ts` compara as duas.
- Agrupar: escrita com db() (service role), UPDATE por linha com todos os filtros de estado na cláusula
  (id, client_id, project_id/null, parent_file_id null, internal, not_requested, none, locked_at null, archived_at null)
  e contagem = 1; filhos primeiro, raiz por último; falhou = desfaz as já alteradas. Depois confere que nenhum filho
  ganhou neto. Nomes antigos vão na resposta e numa linha própria de auditoria (`aceleriq_arquivos_agrupar_carrossel.antes`).
- Nomes: raiz = nome sem sufixo "(i/N)" (mantém extensão se tinha); filhos = "<nome da raiz sem sufixo e sem extensão> (i/N)".
- Ordem: confere com a regra do painel depois do rename; se o número no início do nome no storage contradiz o pedido, recusa (não move blob).
- Leitores resolvem por linha: CarouselSlider lê filhos por parent_file_id e assina storage_bucket/storage_path de cada um;
  a política do storage casa objeto com a linha de files pelo caminho (migration 20260727132145).
- Recusa revisão (revision_of_file_id) como filho (regra do INSERT do files_secure_guard).
- Escrita não leva `operator`: não entra na auditoria de assinaturas da 2.37 (deveAuditar só para escrita assinada).

## Post da Agenda a partir de arquivo (formato descoberto, sem migration)
- Fluxo do painel: `EditorialCalendar.openCreate` -> `EditorialEditor`; ao escolher mídia de Arquivos (`selectApprovedMedia`):
  title = file_name da raiz, content_type = `buildApprovedMediaAssets` (static | carousel | video), production_status 'ready',
  objective = description da raiz, default_caption = caption da raiz; arquivo sem projeto é adotado (`adotarArquivoNoProjeto`:
  UPDATE files SET project_id WHERE id IN (raiz+filhos) AND project_id IS NULL) antes de `save_editorial_post`.
- Item editorial = tarefa (`tasks`, due_date, delivery_type, status backlog) pelo escritor `createEditorialItem`
  (o mesmo do Estúdio em `arte-rapida-na-agenda.ts`); depois o post com task_id (editorial_post_internal) pelo
  `save_editorial_post` como a pessoa (o mesmo de `sincronizarPecaNaAgenda` do Estúdio). Tabelas: tasks, editorial_posts,
  editorial_post_internal (via RPC). Nenhuma editorial_publications nasce (publications = []).
- Banco exige raiz legível do mesmo cliente e projeto (`editorial files must be readable root files ...`), por isso a adoção.
- Título padrão: nome da raiz sem "(i/N)" e sem extensão (o painel usa file_name.trim(); tirei a extensão porque upload do MCP traz `.png`).
- Chave do item: `mcp-post-de-arquivo:<raiz>:<hash(projeto|data|título)>`; falha no save deixa o item criado e a repetição com a mesma entrada o reaproveita.
- `ja_existia`: post com primary_file_id = raiz, mesmo cliente, archived_at nulo.

## Testes
- `deno test --no-lock --allow-env --allow-read --allow-net <arquivos>` (o deno.lock do repo dá conflito de integridade no esm.sh; --no-lock contorna; baseline mcp_test.ts: 91 ok).
- agrupar: 12 ok. post de arquivo: 9 ok. vitest mcp-carrossel-de-arquivos: 4 ok.
