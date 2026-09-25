# Agentes das mesas, cérebro do cliente e dossiê bidirecional

Frente F, 25/09/2026 (MCP 2.3). Este documento é o mapa: quem é cada agente, onde mora o prompt, o que ele lê, o que ele grava e onde o cérebro do cliente e o dossiê entram. As outras frentes reforçam os prompts; aqui fica o endereço de cada um e o ponto de integração.

Números de linha valem para o commit de 25/09 e andam quando o arquivo muda: procure pelo nome da constante.

## 1. Mapa dos agentes

| Agente | Onde roda | Prompt (sistema) | Memória que lê (agente_memoria.agente) | Dossiê e contexto |
|---|---|---|---|---|
| Estrategista do calendário (agente do mês) | `supabase/functions/agente-calendario/index.ts`, ações `planejar_mes`, `propor_temas`, `detalhar`, `pedido_livre`, `conversar`, `completar_itens` | Prompt mestre no banco: `agente_prompts` com `agente = 'estrategista'` (global, semente em `supabase/migrations/20260922120000_mesa_do_cliente_base.sql`, perto da linha 858) mais complemento por cliente. No código: `REGRAS_DE_SAIDA`, `REGRAS_DOS_ITENS`, montagem em `montarContexto` e `contextoEmTexto` | `estrategista` (até 60 ativas, e os "Plano do mês AAAA-MM") | Lê o dossiê geral (`client_dossiers`) e `movimentos_do_cliente` de 60 dias: já é bidirecional |
| Estrategista de campanha | mesmo arquivo, ações `campanha_criar`, `campanha_ajustar`, `campanha_conversar`, `campanha_salvar`, `campanha_plano_imagens`, `campanha_selo` | Mesmo prompt do estrategista; regras próprias em `REGRAS_DO_PLANO_DE_IMAGENS`, `normalizarIdentidade`, `normalizarBriefing` | `estrategista` | Mesmo `montarContexto` (dossiê e movimentos) |
| Diretor de arte (Estúdio) | `supabase/functions/estudio-arte/index.ts` (+ `conversa-do-diretor.ts`, `autocorrecao.ts`) | Prompt mestre no banco: `agente_prompts` com `agente = 'diretor_arte'` (semente na mesma migration, perto da linha 1014), lido em `promptDoDiretor`. Conversa: `INSTRUCOES_CONVERSA` em `conversa-do-diretor.ts`. Leitura de referência: `SISTEMA_LER`. Regras de quadro e tipografia: `_shared/direcao-arte.ts`, `_shared/conhecimento-design.ts` | `diretor_arte` (`memoriaDoDiretor`, 30 ativas). Grava ajuste pedido (`origem = 'ajuste'`) e o gatilho da entrega grava reprovação com motivo (`origem = 'aprovacao'`) | Lê `lerContextoConsolidado` (kit e contexto da marca). **Não lê o dossiê**: ponto de integração 3.1 |
| Diretor de fotografia (Mesa Foto) | `supabase/functions/mesa-foto/index.ts` (+ `modelos.ts`, `canvas.ts`, `campanhas.ts`) | `SISTEMA_DIRETOR`, `SISTEMA_AGENTE` (pop-up), `SISTEMA_VARIACOES`, `SISTEMA_CAMPANHA`, `SISTEMA_KITS`, `SISTEMA_CONFERENCIA`, `REGRAS_DA_CASA`; contexto em `contextoDoCliente` | `diretor_arte` (`AGENTE_DIRETOR`, 20 ativas) | Lê dossiê atual (2 mais recentes), contexto consolidado, briefing de ads, último plano de ads e campanhas: já é bidirecional |
| Agente de oferta (Mesa Ads) | `supabase/functions/mesa-ads/index.ts`, ações `oferta_conversar`, `oferta_do_contexto`, `briefing_sugerir` | `sistemaDoEstrategista()` = `CONHECIMENTO_ESTRATEGISTA_ADS` (`_shared/conhecimento-ads.ts`, inclui `CONHECIMENTO_OFERTA`, `CONHECIMENTO_AGRESSIVO`, `REGRAS_DE_HONESTIDADE`, `POLITICAS_META`) + `REGRAS_DA_EXECUCAO` | `estrategista_ads` (40 ativas) e `ads_aprendizados` | `montarContextoAds`: dossiê geral, contexto consolidado, anúncios de 90 dias, campanhas do mês, brief respondido, documentos de marca: já é bidirecional |
| Estrategista de anúncios (plano e ângulos) | mesmo arquivo, `plano_gerar`, `plano_conversar`, `criativos_produzir` | mesmo sistema; níveis do Jev em `NIVEIS_PARADA`, `NIVEIS_DIFERENCIACAO`, `NIVEIS_FORCA_OFERTA` | `estrategista_ads` | `montarContextoAds` |
| Copy | Mesa Ads: `copy_variar`, `copy_pacote` (`CONHECIMENTO_COPY_PACOTE`, `ESTRUTURAS_DE_COPY`, `TIPOS_DE_GANCHO`). Post: `legenda` do Estúdio e a legenda de cada item do estrategista do calendário (`REGRAS_DOS_ITENS`) | ver colunas ao lado | `estrategista_ads` (anúncio) e `estrategista` (post) | como o agente de origem |
| Conta (leitura da conta de anúncios) | Mesa Ads: `conta_analisar`, `resultados_ler`, `aprendizado_registrar` | `CONHECIMENTO_CONTA`, `DIAGNOSTICO`, `ROTINA_DE_TESTE`; números sempre do código | `estrategista_ads`; grava E3/E4 em `ads_aprendizados` e em `agente_memoria` | `montarContextoAds` |
| Agente de contexto (marca) | `supabase/functions/agente-contexto/index.ts` | `SISTEMA_CONTEXTO`, `SISTEMA_CONVERSA`, `SISTEMA_LEITURA`, `SISTEMA_ACERVO` | lê TODAS as memórias ativas (30) e grava memória manual para `estrategista` e `diretor_arte` | Lê o dossiê (`lerDossie`) |

Leitores sem memória de cliente (não precisam do cérebro): leitor de referência da Mesa Ads (`SISTEMA_DO_LEITOR`), leitor de artes do Estúdio (`SISTEMA_LEITURA`), leitor e conferente da Mesa Foto (`SISTEMA_LEITOR`, `SISTEMA_CONFERENCIA`), identificador de produto (`SISTEMA_IDENTIFICAR`).

## 2. Cérebro do cliente

Código: `supabase/functions/_shared/cerebro-do-cliente.ts` (puro, sem Deno e sem banco fixo). Serviço do MCP: `_shared/mcp-cerebro-services.ts`. SQL: `docs/cerebro/01_cerebro_memoria.sql`.

- **Fontes que já existiam, juntadas**: `agente_memoria` (preferências, evitar, ajustes do Estúdio, reprovações que o gatilho da entrega grava), `ads_aprendizados` (E3/E4, com gasto e resultado), `file_approval_events` com `client_rejected`/`agency_rejected` e comentário (120 dias), `social_metrics_weekly` (evolução de alcance e seguidores) e `social_post_metrics` (as publicações que mais geraram interação).
- **Áreas**: `geral`, `calendario`, `campanha`, `copy` (lidas pelo estrategista), `arte`, `foto` (diretor de arte e Mesa Foto), `ads`, `conta` (estrategista de anúncios). `AGENTE_DA_AREA` diz em qual `agente_memoria.agente` cada área é gravada: por isso o que o MCP registra já chega ao prompt dos agentes atuais, sem mudar as mesas.
- **Categorias**: `preferencia`, `evitar`, `ajuste`, `reprovado` (com motivo), `performou` (com evidência), `aprendizado`.
- **Resumo compacto** (`resumoParaPrompt`): EVITAR primeiro, depois preferências e ajustes, o que performou e o resto; mais reforçado antes; teto padrão de 1800 caracteres (máximo 6000), nunca corta linha no meio, avisa quantos ficaram de fora.
- **Deduplicação**: texto normalizado igual vira reforço (`reforcos + 1`); com o Jev (duas perguntas Choice no mesmo pedido, `repete` e `contradiz`, com saída `nenhum`), o que diz o mesmo com outras palavras também vira reforço (corte 0,75) e o que contradiz aposenta o antigo (corte 0,80, `ativa = false`, `substituida_por`). Jev fora do ar vira aviso e a gravação segue só com a regra do texto igual.
- **Validade**: preferência, evitar e ajuste não vencem; performou 180 dias; reprovado e aprendizado 365. O cron `cerebro-vencidos-diario` (SQL 01) desliga o vencido; a leitura também filtra.

## 3. Pontos de integração para as outras frentes

As funções estão prontas em `_shared`; nenhuma mesa foi editada por esta frente.

1. **Estúdio (diretor de arte) passa a ler o dossiê e o cérebro.** Em `estudio-arte/index.ts`, onde o sistema do diretor é montado (junto de `memoriaDoDiretor` e `marcaDoCliente`):
   ```ts
   import { contextoParaAgente } from "../_shared/cerebro-do-cliente.ts";
   const extra = await contextoParaAgente(servico(), clientId, "arte", { limiteCerebro: 1500, limiteDossie: 3000 });
   // acrescentar extra.texto ao sistema; extra.avisos só para log sem dado de cliente
   ```
   Com isso a lista crua de `memoriaDoDiretor` pode ser trocada pelo resumo (ou mantida, o resumo já deduplica).
2. **Mesa Foto**: trocar a leitura crua de `agente_memoria` (20 ativas) em `contextoDoCliente` por `contextoParaAgente(servico(), clientId, "foto")`, ou só `lerCerebro` + `resumoParaPrompt(fatos, { areas: ["foto", "arte"] })` se o dossiê continuar vindo pelo caminho atual.
3. **Calendário**: em `montarContexto`, trocar as 60 memórias cruas por `resumoParaPrompt(fatos, { areas: ["calendario", "campanha", "copy"], limite: 2000 })`. Mantém os "Plano do mês" (que não são aprendizado) no caminho atual.
4. **Mesa Ads**: em `montarContextoAds`, `resumoParaPrompt(fatos, { areas: ["ads", "conta", "copy"] })` no lugar das 40 memórias cruas e dos 20 `ads_aprendizados` soltos (o cérebro já inclui os dois, deduplicados).
5. **Gravar pelo cérebro em vez de insert solto**: nos três lugares que fazem `insert` direto em `agente_memoria` (ajuste do Estúdio, mudança aplicada na conversa do Estúdio, `aprendizado_registrar` da Mesa Ads, conversa do agente de contexto), chamar `registrarAprendizado(servico, {...}, { julgar })` para ganhar reforço, validade e aposentadoria do contraditório. O `julgar` com o Jev está em `mcp-cerebro-services.ts` (`julgarComJev`); copie o padrão ou exporte-o.
6. **Painel**: uma aba "Cérebro" na Mesa pode ler `aceleriq_cerebro_do_cliente` (mesmo formato: `resumo_por_area`, `fatos`, `totais`).

## 4. Dossiê bidirecional

- **Mesas para o painel** (SQL 02): gatilhos em `mesa_campanhas` (criada e alterada), `calendario_propostas` (conteúdo gravado no mês), `ads_briefings`, `ads_ofertas` (salva e escolhida), `ads_planos`, `ads_criativos`, `ads_aprendizados`, `cliente_imagens` (foto aprovada na Mesa Foto, com a coluna nova `aprovada_em`) e `agente_memoria` (aprendizado novo) **só enfileiram** em `app_private.dossie_fila`. A leitura `app_private.movimentos_das_mesas` entra na porta `public.movimentos_do_cliente`, que o texto do dossiê já usa; todas as linhas das mesas são `[interno]`. Arte entregue, enviada para aprovação, aprovada e reprovada já entravam pelos gatilhos de `files` e `file_approval_events` e continuam iguais.
- **Painel para as mesas**: calendário, Mesa Ads, Mesa Foto e agente de contexto já leem o dossiê. O Estúdio não lê: ponto 3.1 acima, com `contextoParaAgente` pronto.

## 5. MCP 2.3: ações nas mesas

Arquivos: `_shared/mcp-mesas-acoes.ts` (chamadas), `_shared/mcp-mesas-ponte.ts` (regras puras), catálogo em `_shared/mcp-tools.ts`.

- Cada ação chama a **função da mesa** (`agente-calendario`, `mesa-ads`, `estudio-arte`) ou a RPC `mesa_enviar_para_aprovacao` com o **token OAuth da própria pessoa**. A mesa confere equipe, acesso ao cliente e regra como na tela, e grava `criado_por` = a pessoa. Lista fechada de ações em `ACOES_DA_PONTE`.
- **Chave de API (`mcp_live_*`) não age**: recebe a recusa explicada. Para abrir no futuro, a ponte de serviço seria: as mesas aceitarem `x-cron-secret` + `x-mcp-ator` com o id da pessoa dona da chave (como `ia-gateway` e `materiais-classificar` já aceitam o segredo de cron) e trocarem as checagens com o JWT por `can_access_client` com o ator. Isso mexe nas mesas: fica para a frente dona delas.
- Escopo `mesas:write` (incluído em `aceleriq:write` e na lista concedível a staff). Custo de IA exige `confirmar_custo = true`; efeito no cliente exige `confirmar = true` e `motivo`. Toda ação pede `idempotency_key` (24 h, por credencial).
- Ações longas (IA, entrega) respondem com fôlego no MCP (`folegoResponse` em `mcp-response.ts`): espaços no JSON ou comentários no SSE a cada 10 s, para a plataforma não derrubar com 504 aos 150 s.

## 6. Ordem de aplicação

1. **SQL 01** `docs/cerebro/01_cerebro_memoria.sql` (colunas do cérebro, agente `geral`, índice de chave ativa, cron de validade). Antes dele o MCP já funciona: grava no formato antigo e recusa só a área `geral` com a explicação.
2. **SQL 02** `docs/cerebro/02_dossie_eventos_das_mesas.sql` (depende da fila de 21/09 e da porta `movimentos_do_cliente` de 21/09, que já estão no banco; o gatilho em `agente_memoria` usa `area` do SQL 01). Aplicar depois da migration da Mesa Foto (`20260924165938_mesa_foto.sql`) para o gatilho de foto aprovada nascer; sem ela o arquivo pula essa parte com aviso.
3. **SQL 03** `docs/cerebro/03_conferir_sem_alterar.sql` com um cliente real: tudo em transação com ROLLBACK, resultado em SELECT.
4. **Publicar** `mcp-server` e `mcp-oauth-metadata` juntos (versão 2.3.0 nas duas pontas), da cópia LF verificada, e conferir `initialize` (serverInfo.version e o total de tools) e `tools/list`. O servidor do MCP precisa de `SUPABASE_ANON_KEY` no ambiente (padrão das Edge Functions do Supabase).
5. Reconectar os conectores (ChatGPT, Claude) para o catálogo novo aparecer: o cliente guarda a lista antiga em cache.
