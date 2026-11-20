# PROGRESS — MCP 2.38.0 (carrossel de Arquivos)
Branch: infra/mcp-2.38.0-carrossel-de-arquivos (base origin/main 57473056). Prompt: /workspace/mcp-238/prompt-claude.md
Retomar: `git log --oneline origin/main..HEAD` + este arquivo.

- [x] Investigação do modelo real (banco, somente leitura) — ver prompt
- [x] Tool 1 aceleriq_arquivos_agrupar_carrossel (commit "MCP 2.38.0: agrupar carrossel")
- [x] Tool 2 aceleriq_agenda_criar_post_de_arquivo (commit "MCP 2.38.0: post da Agenda de arquivo")
- [x] Tool 3 aceleriq_arquivos_enviar_para_aprovacao (commit "MCP 2.38.0: enviar arquivo para aprovação")
- [x] Versão 2.38.0, contagem de tools em mcp_test.ts (226 -> 229), guia (commit "MCP 2.38.0: versão")
- [x] P1-A (revisão Codex): simulação com idempotency_key virava replay da chamada confirmada (commit "MCP 2.38.0: P1-A")
- [x] P1-B (revisão Codex): agrupar sem mudança de metadado na raiz não revalidava a raiz antes de vincular os filhos (commit "MCP 2.38.0: P1-B")
- [ ] (Almir) PR, merge, bundle, deploy, prova — fora deste executor

## Decisões
- Regras puras em `supabase/functions/mcp-server/modulos/carrossel-de-arquivos.ts` (sem import): Deno e vitest leem o mesmo arquivo.
  A ordem é cópia fiel de `src/lib/editorialMedia.ts`; `src/test/mcp-carrossel-de-arquivos.test.ts` compara as duas.
- Agrupar: escrita com db() (service role), UPDATE por linha com todos os filtros de estado na cláusula
  (id, client_id, project_id/null, parent_file_id null, internal, not_requested, none, locked_at null, archived_at null)
  e contagem = 1; RAIZ PRIMEIRO (desde o P1-B), depois os filhos; falhou = desfaz as já alteradas. Depois confere que nenhum filho
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

## Envio de Arquivos para aprovação
- Papel lido em user_roles do principalUserId (OAuth = a pessoa; chave = o dono): admin/manager -> admin_release_file_now(raiz,'approval')
  (aguardando_cliente); design/traffic -> request_file_agency_review(raiz) (aguardando_agencia); outro papel = recusa. Mesma regra da RPC
  mesa_enviar_para_aprovacao. As duas RPCs entraram em RPCS_DA_PONTE (_shared/mcp-mesas-ponte.ts); os testes não fixam a lista inteira.
- Recusa de estado fica DENTRO do umaVez: repetir a chave de um envio que deu certo volta replay, não "já em aprovação".
- aceleriq_mesa_enviar_para_aprovacao: só a descrição ganhou a frase apontando para a tool irmã.

## Testes (20/11/2026, rodados neste worktree)
Obs.: o deno.lock do repo dá conflito de integridade no esm.sh; usei `--no-lock`.
- `deno test --no-lock --allow-env --allow-read --allow-net supabase/functions/mcp-server/mcp_test.ts` -> 92 ok (baseline 91 + teste 2.38).
- módulos novos: agrupar 12 ok, post de arquivo 9 ok, enviar 8 ok.
- `deno test ... supabase/functions/mcp-server/` -> 279 ok, 2 falhas JÁ existentes em origin/main (painel_test.ts: espera versão 2.23.0;
  _shared > 4 MB, baseline 4.290.567 bytes). As regras do carrossel foram para mcp-server/modulos para não engordar _shared.
- vitest (src/test/mcp-* + production-migration-view + mesa-entrega + entrega-na-agenda + reagendar + editar-legenda + comercial/mercurio +
  painel-conversa + centro-de-comando + ritual + pedidos-de-acesso + ciclo-extras): 24 falhas idênticas ao baseline origin/main
  (testes antigos que fixam versão 2.36.0/2.23/2.13, migrations do production-migration-view, z.number em mcp-erros-que-ensinam);
  534 ok (baseline 530 + 4 novos de src/test/mcp-carrossel-de-arquivos.test.ts).
- `npm run typecheck`: 1 erro já existente (_shared/cores/oklch.ts:223), igual ao baseline. `git diff --check` ok.
- `npm --prefix integrations/lovable-mcp-compat run verify`: não roda aqui (dependência @lovable.dev/mcp-js não instalada); não toquei nessa pasta.

## Falta / riscos (para o Almir)
- Nada de migration: tudo cabe no schema atual (files, tasks, editorial_posts via save_editorial_post, RPCs existentes).
- Smoke no Preview depois do deploy (sem Deno local contra banco real): simular agrupar com os 5 cards da Stop/Thainá
  (hoje em aprovação -> a simulação deve recusar e mandar retirar), retirar, agrupar, criar post e enviar; conferir "Carrossel · 5" no portal.
- Agrupar escreve com a chave de serviço (não há RPC de agrupar); a guarda do banco ainda barra linha fora do estado interno.
- Post de arquivo: se o save_editorial_post falhar depois do item criado, fica a tarefa sem post (repetir com a mesma entrada reaproveita).

## Correções da revisão cruzada do Codex (20/11/2026)
- P1-A: executarFerramenta audita a simulação como sucesso com o input cru (idempotency_key inclusa) e umaVez casava
  por `sanitized_input @> {__principal?, idempotency_key, escopo}`. Correção: o escopo das 3 tools inclui `confirmar: true`
  (EscopoDeIdempotencia agora aceita boolean; tipo só alargado, as outras tools não mudam). Só chamada confirmada vira replay.
  Achado junto: o agrupar usava escopo `{ root_file_id }`, que nunca existe no input auditado (só file_ids) -> o replay dele
  nunca casava. Agora `{ confirmar: true }` (chave + ferramenta + principal, como as tools sem escopo).
  Teste: `trilhaDeAuditoria()` (banco-falso util) grava com buildAuditInput, procura com filtroDeIdempotencia + `@>` do jsonb
  e roda pelo executarFerramenta real. Sem a correção os 3 testes P1-A falham; com ela passam.
- P1-B: o `continue` pulava o UPDATE da raiz quando nada mudava nela, e o files_secure_guard do UPDATE do filho olha a raiz
  antiga do filho, não o novo parent_file_id. Agora: a raiz vai PRIMEIRO e SEMPRE leva um UPDATE condicional com os filtros
  de estado (grava nome/tipo/pasta finais, iguais aos atuais quando nada muda; legenda se pedida) e contagem = 1; depois os
  filhos; depois da conferência de netos, um SELECT da raiz com os mesmos filtros (1 linha). Falhou = desfaz na ordem inversa
  (filhos soltos primeiro, raiz por último, com os valores originais). Janela que sobra: entre o último filho e o SELECT final
  (detectada e desfeita, não evitada; sem transação no PostgREST).
  Teste: `antesDoUpdate` no banco falso muda a raiz para aprovação (a) antes do UPDATE da raiz -> nenhuma escrita;
  (b) antes do último filho -> conferência acusa, filhos desfeitos. Os dois falham no código anterior.
- Testes depois das correções: modulos/ + mcp_test.ts 233 ok; pasta mcp-server 284 ok + as 2 falhas antigas (painel_test 2.23.0;
  _shared 4.292.714 bytes, já acima do limite antes; este lote soma ~300 bytes de tipo/comentário no _shared);
  vitest src/test/mcp-carrossel-de-arquivos.test.ts 4 ok; git diff --check ok.

## Revisão do Codex (20/11)
- 1ª rodada: 2 P1 (replay após simulação; raiz sem revalidação) — corrigidos (cf12b0bd, 760d5b45).
- 2ª rodada: 1 P1 residual: sem transação, há janela curta entre os UPDATEs em que alguém libere a MESMA raiz pelo painel; a conferência final detecta e desfaz, mas o desfazer pode ser recusado pela guarda se a raiz já estiver em aprovação. Correção definitiva = RPC SECURITY DEFINER com FOR UPDATE na raiz (migration; exige autorização do Almir, AGENTS.md). NÃO feita; risco aceito e informado.

## 2.38.1 (20/11/2026): nome do carrossel com extensão
- Bug do teste real da 2.38.0: cards "[teste] carrossel (1/3).png", "(2/3).png", "(3/3).png" viraram raiz
  "[teste] carrossel (1/3).png" e filhos "[teste] carrossel (1/3) (2/3)" / "(1/3) (3/3)". Causa: o sufixo "(i/N)" era tirado
  antes da extensão (com extensão ele não está no fim). O painel (editorialMedia.ts numericOrderFromName) lê a PRIMEIRA "(a/b)",
  então os dois filhos liam 1 e a ordem saía do created_at por acaso.
- Correção (carrossel-de-arquivos.ts): nomeSemSufixo/baseDoCarrossel/nomeDoCard/tituloDoArquivo tiram PRIMEIRO a extensão
  (.png/.jpg/.jpeg/.webp, qualquer caixa), DEPOIS todos os " (i/N)" do fim (tolera repetido). Raiz "<base>", filhos
  "<base> (i/N)", sem extensão. Sem extensão e caso Stop "... (carrossel) (1/5)": igual à 2.38.0.
- ordem_confere só é true se a ordem sai dos números (storage primeiro, depois a primeira "(a/b)" do nome), sem o desempate
  por created_at/id (ordemSemDesempate). Se bate só pelo desempate: ordem_confere false + aviso (não bloqueia); se não bate:
  problema, como antes. Base com "(a/b)" no meio ganha dica de renomear a raiz.
- Mudança visível: a raiz agrupada perde a extensão no file_name ("card-01.png" -> "card-01"); teste ajustado.
- Versão 2.38.1 (mcp-release.ts com changelog; mcp_test.ts). 3 vitest presos em "2.36.0" (já falhavam desde a 2.37) subiram para 2.38.1.
  Tools continuam 229.
- Testes: deno mcp_test.ts + agrupar/agenda/enviar 128 ok; vitest carrossel 5 ok (compara com editorialMedia.ts nos casos:
  com/sem extensão, Stop, "(1/3)" repetido, jpg/webp/jpeg, created_at invertido); git diff --check ok.
- Falha antiga fora do lote: src/test/mcp-precisa-de-voce.test.ts "versão, catálogo..." espera um trecho em mcp-tools.ts
  que não existe mais (antes escondida pela asserção de versão).
- Dados já gravados pela 2.38.0 com nome errado: não mexidos (sem escrita em produção). Re-agrupar não renomeia raiz já
  agrupada (jaAgrupado); corrigir esses nomes exige update manual ou retirar e agrupar de novo.
