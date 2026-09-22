# Mesa do cliente: especificação de engenharia

Data: 2026-09-22. Dono: Almir. Piloto: Terra Flor.

Objetivo: trazer para dentro do painel o que hoje é feito fora (calendário pelo ChatGPT Work e arte pelo ChatGPT com GPT Image), sem mudar nada do que existe. Tudo complementa: agenda, aprovação, arquivos, publicação automática e portal continuam como estão.

Regras da casa que valem para todas as peças:
- Nunca quebrar o que existe; só acrescentar.
- Agente age com ordem de alguém e deixa rastro (quem pediu, o que fez, quanto custou).
- Nenhuma chave de API no navegador. Toda IA é chamada por função de borda.
- Não misturar clientes. Toda linha nova tem `client_id` e RLS de equipe (`is_staff` + `can_access_client`). Cliente final não lê nada destas tabelas.
- Português do Brasil na interface e nos comentários, sem travessões.
- Compatibilidade do front: Safari 11 / Chrome 64 (sem lookbehind, `\p{}`, grupo nomeado). Ver `src/test/compatibilidade-iphone-antigo.test.ts`.
- Migrations: validar em `begin; ... rollback;` e aplicar com execute_sql (projeto `jjjtkowvxemvituvywvf`), depois `node scripts/registrar-migrations-no-manifesto.mjs` e ajustar `src/test/production-migration-view.test.ts`.

## 1. Fluxo

Mesa do cliente (rota `/mesa`, equipe) com quatro abas em sequência e uma barra de custo no topo:

1. **Contexto**: kit de marca (paleta, logo, estilo), kit de fontes, referências (workspace + Pinterest + upload), rosto autorizado, prompt do agente por cliente e memória do agente.
2. **Mês**: o estrategista propõe os temas do período; o humano escolhe; o estrategista detalha cada item (gancho, copy, roteiro de cada card, ilustração, estilo, carrossel infinito); conversa lateral para ajustar; "Gravar na agenda" cria os itens editoriais pelo mesmo serviço que o MCP usa (`createEditorialItem`).
3. **Estúdio**: abre um item da agenda; o diretor de arte escreve a direção de cada card; o gerador de imagem faz a lâmina inteira, texto incluído (NUNCA texto em camada por cima); ajustes são edição dentro do gerador; conferência de ortografia (leitura do texto da imagem) e de identidade (Jev); "Entregar" salva os cards em Arquivos já ligados ao item.
4. **Entrega**: lista do mês com as artes; "Enviar tudo para aprovação" usa o caminho de aprovação que já existe; quando o cliente aprova, o post entra agendado sozinho (segunda a sexta), pelo caminho de agendamento que já existe.

Barra de custo: saldo da carteira do cliente, gasto do mês por modelo e tarefa, preço estimado antes de cada geração. Recarga só por admin e manager. (Posts por plano e reserva entram depois.)

## 2. Banco (migration `20260922120000_mesa_do_cliente_base.sql`)

Tabelas (todas com RLS; leitura e escrita da equipe com acesso ao cliente, salvo onde indicado):

- `ia_modelos`: catálogo. `id text pk` (ex. `openai:gpt-image-2`), `provedor text` (`openai`, `anthropic`, `openrouter`), `modelo_api text`, `tipo text` (`texto`, `imagem`), `rotulo text`, `preco_entrada_1m numeric`, `preco_saida_1m numeric`, `preco_cache_1m numeric`, `preco_imagem jsonb` (`{"baixa":..,"media":..,"alta":..}` por imagem 1024x1536), `raciocinio text[]` (níveis aceitos), `padrao_para text[]` (`estrategista`, `diretor_arte`, `imagem`, `leitura`), `ativo bool`, `fonte_preco text`, `conferido_em timestamptz`. Leitura equipe; escrita admin.
- `ia_carteiras`: `client_id pk`, `saldo_usd numeric not null default 0`, `atualizado_em`.
- `ia_carteira_movimentos`: `id`, `client_id`, `tipo` (`recarga`, `debito`, `estorno`, `ajuste`), `valor_usd numeric` (positivo recarga, negativo débito), `uso_id uuid`, `observacao`, `criado_por`, `criado_em`. Só escrito por RPC.
- `ia_usos`: `id`, `client_id`, `tarefa` (`calendario`, `estudio`, `conversa`, `leitura_referencia`, `verificacao`), `agente` (`estrategista`, `diretor_arte`, `gerador_imagem`, `leitor`, `jev`), `modelo_id`, `provedor`, `tokens_entrada`, `tokens_saida`, `tokens_cache`, `imagens int`, `qualidade text`, `custo_usd numeric`, `custo_fonte` (`provedor`, `tabela`), `referencia_tipo`, `referencia_id uuid`, `criado_por`, `criado_em`. Só escrito por RPC.
- `cliente_kit_marca`: `client_id pk`, `paleta jsonb` (`[{nome,hex,papel}]`), `logo_file_id uuid`, `logo_alt_file_id uuid`, `estilo text` (descrição escrita a partir das referências), `regras text` (faça/não faça da marca), `atualizado_em`, `atualizado_por`.
- `cliente_fontes`: `id`, `client_id`, `nome`, `papel` (`titulo`, `texto`, `destaque`), `storage_path` (arquivo da fonte), `amostra_path` (PNG gerado no navegador com a fonte), `criado_em`.
- `cliente_referencias`: `id`, `client_id`, `origem` (`workspace`, `pinterest`, `upload`), `workspace_node_id uuid`, `url_origem`, `storage_path`, `leitura text` (o que o leitor viu: composição, hierarquia, tipografia, luz), `tags text[]`, `ativa bool default true`, `criado_em`. Único por `(client_id, workspace_node_id)` e por `(client_id, url_origem)`.
- `cliente_rostos`: `id`, `client_id`, `pessoa`, `storage_path`, `autorizacao_registrada_em timestamptz not null`, `autorizado_por text not null`, `ativa bool`, `criado_em`.
- `agente_prompts`: `id`, `agente` (`estrategista`, `diretor_arte`), `client_id uuid null` (null = global), `versao int`, `conteudo text`, `ativo bool`, `criado_por`, `criado_em`. O prompt efetivo = global ativo + complemento ativo do cliente. Semear os dois globais v1 com o conteúdo de `docs/mesa-do-cliente/prompts/`.
- `agente_memoria`: `id`, `client_id`, `agente`, `tipo` (`aprendizado`, `preferencia`, `evitar`), `texto`, `origem` (`aprovacao`, `ajuste`, `metrica`, `manual`), `referencia_id`, `ativa bool`, `criado_em`.
- `agente_conversas` (`id`, `client_id`, `agente`, `referencia_tipo`, `referencia_id`, `criado_por`, `criado_em`) e `agente_mensagens` (`id`, `conversa_id`, `papel` `usuario|agente|sistema`, `conteudo`, `anexos jsonb`, `uso_id`, `criado_em`).
- `calendario_propostas`: `id`, `client_id`, `project_id`, `periodo_inicio date`, `periodo_fim date`, `parametros jsonb` (frequência, objetivo, oferta, região, modelo, raciocínio), `status` (`temas`, `detalhando`, `pronta`, `gravada`, `descartada`), `diagnostico text`, `temas jsonb` (`[{id,tema,pilar,fase,objetivo,por_que,jev:{aderencia,potencial}, escolhido}]`), `itens jsonb` (um por publicação, com todos os campos do prompt do estrategista mais `cards:[{ordem,funcao,texto,ilustracao,estilo}]`, `carrossel_infinito bool`, `data`, `formato`), `conversa_id`, `task_ids uuid[]`, `criado_por`, `criado_em`, `gravada_em`.
- `estudio_trabalhos`: `id`, `client_id`, `task_id uuid` (item editorial), `status` (`rascunho`, `dirigido`, `gerando`, `pronto`, `entregue`, `erro`), `direcao jsonb` (`{conceito, carrossel_infinito, cards:[{ordem, funcao, texto_exato, composicao, ilustracao, prompt_imagem}]}`), `modelo_imagem_id`, `qualidade`, `cards jsonb` (`[{ordem, versao, storage_path, verificacao:{texto_lido, ortografia_ok, identidade}}]`), `legenda text`, `file_ids uuid[]`, `custo_usd numeric default 0`, `conversa_id`, `criado_por`, `criado_em`, `atualizado_em`.
- Bucket privado `mesa` para fontes, amostras, referências baixadas e rascunhos de cards.

### 2.1 Chaves de API por cliente e cotas (pedido do dono em 2026-09-22)

Cada cliente pode ter a própria chave de cada provedor, para o custo sair na conta certa e a recarga ser por cliente, nunca geral.

- `ia_chaves_cliente`: `id`, `client_id`, `provedor` (`openai`, `anthropic`, `openrouter`), `rotulo`, `vault_secret_id uuid` (a chave mora no Supabase Vault, nunca em coluna), `final_chave text` (últimos 4 caracteres, só para exibir), `cota_mensal_usd numeric null` (null = sem teto), `ativa bool`, `criado_por`, `criado_em`, `atualizado_em`. Único por `(client_id, provedor)` ativo. RLS: leitura só admin e manager, e nunca expõe o segredo.
- `ia_clientes_config`: `client_id pk`, `usar_chave_agencia bool default true` (enquanto o cliente não tem chave própria, usa a da agência; desligado, o cliente sem chave fica bloqueado), `observacao`.
- `ia_usos` ganha `chave_origem text` (`cliente` ou `agencia`) e `chave_id uuid`.
- RPCs só admin ou manager: `ia_chave_salvar(_client_id, _provedor, _chave text, _rotulo, _cota_mensal_usd)` (cria ou troca o segredo no Vault, guarda só o final), `ia_chave_cota(_chave_id, _cota_mensal_usd)`, `ia_chave_desativar(_chave_id)`, `ia_chaves_listar(_client_id)` (sem o segredo, com gasto do mês de cada chave), `ia_cliente_config_salvar(_client_id, _usar_chave_agencia)`.
- RPC só backend: `ia_chave_resolver(_client_id, _provedor)` devolve `{chave_id, segredo, cota_mensal_usd, gasto_mes_usd}` da chave ativa do cliente, ou vazio.
- Motor: para cada chamada, usa a chave do cliente daquele provedor se existir; se a cota do mês acabar, erro `cota_da_chave_esgotada`; sem chave do cliente, usa a da agência se `usar_chave_agencia`, senão erro `cliente_sem_chave`. Registra `chave_origem` e `chave_id` no uso.
- Interface (etapa final): no admin, por cliente, a seção "Chaves de IA e cotas" com provedor, rótulo, final da chave, cota do mês, gasto do mês, trocar, desativar, e o interruptor "usar chave da agência enquanto não houver própria".

RPCs:
- `ia_carteira_recarregar(_client_id uuid, _valor_usd numeric, _observacao text)`: só admin ou manager; valor > 0; grava movimento e atualiza saldo; devolve saldo.
- `ia_registrar_uso(_client_id, _tarefa, _agente, _modelo_id, _provedor, _tokens_entrada, _tokens_saida, _tokens_cache, _imagens, _qualidade, _custo_usd, _custo_fonte, _referencia_tipo, _referencia_id, _criado_por)`: só backend (`rpc_trusted_backend`); insere uso, debita a carteira (pode ficar negativa por um uso; a checagem prévia é da função), devolve `{uso_id, saldo_usd}`.
- `ia_consumo_cliente(_client_id uuid, _mes date)`: equipe; totais do mês por modelo e por tarefa, saldo atual.
- `ia_saldo(_client_id)`: equipe.

## 3. Motor de modelos (`supabase/functions/_shared/ia-motor.ts` + função `ia-gateway`)

Único lugar que fala com provedores. Chaves: `OPENAI_API_KEY` (existe), `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` (ainda não existem; provedor sem chave responde erro claro `provedor_sem_chave`).

API do módulo:
- `chamarTexto({ clientId, tarefa, agente, modeloId, sistema, mensagens, raciocinio?, pesquisaWeb?, esquemaJson?, referencia?, criadoPor? })` devolve `{ texto, json?, usoId, custoUsd, saldoUsd }`.
- `chamarImagem({ clientId, modeloId, prompt, referencias: {bytes, mime, nome}[], qualidade, tamanho: '1024x1536', editar?: {bytes, mascara?}, referencia?, criadoPor? })` devolve `{ png: Uint8Array, usoId, custoUsd, saldoUsd }`.
- `estimar({ modeloId, tipo, tokensEntrada?, tokensSaida?, imagens?, qualidade? })` devolve `custoUsd` pela tabela do catálogo.
- Antes de chamar: carteira precisa ter saldo >= estimativa; senão erro `saldo_insuficiente` com o valor que falta.
- Depois de chamar: custo real (OpenRouter devolve custo; OpenAI e Anthropic calculados por tokens e pela tabela) e `ia_registrar_uso`.
- OpenAI texto pela Responses API (com ferramenta `web_search` quando `pesquisaWeb`), imagem pela Images API (geração e edição com imagens de referência). Anthropic Messages API. OpenRouter Chat Completions (imagem pelos modelos com saída de imagem).
- Timeout em toda chamada externa.

Função `ia-gateway` (equipe): ações `catalogo`, `estimar`, `consumo` (client, mês), `recarregar` (repassa à RPC), `modelos_do_provedor` (só admin; lista os ids reais de cada provedor com chave, para conferir o catálogo).

Ajudante `supabase/functions/_shared/jev.ts`: `jevPerguntar({ state, questions })` com `TYPESAFE_API_KEY`, modelo `jev-latest`, timeout, devolve `answers`. Score usa `criteria` como lista ordenada; Noul devolve `noul`.

## 4. Estrategista (função `agente-calendario`)

Ações (equipe):
- `propor_temas { client_id, periodo_inicio, periodo_fim, frequencia, objetivo?, oferta?, modelo_id?, raciocinio? }`: monta o contexto (dossiê geral atual, movimentos dos últimos 60 dias via `movimentos_do_cliente`, métricas de posts do Instagram, calendário já existente no período, kit de marca, memória do agente, prompt global + complemento do cliente), pesquisa na web, devolve `diagnostico` e 8 a 15 temas; Jev pontua aderência ao objetivo e potencial de salvamento/compartilhamento de cada tema. Cria `calendario_propostas` status `temas`.
- `escolher_temas { proposta_id, temas: string[] }`.
- `detalhar { proposta_id }`: para os temas escolhidos, gera os itens completos (todos os campos do prompt), com roteiro de cada card, ilustração e estilo, e marca carrossel infinito quando fizer sentido. Datas de segunda a sexta dentro do período. Status `pronta`.
- `conversar { proposta_id, mensagem }`: ajusta a proposta conforme o pedido e devolve a proposta atualizada e a resposta.
- `gravar { proposta_id, project_id }`: cria os itens na agenda com o mesmo serviço do MCP (`createEditorialItem` de `_shared/mcp-write-services.ts`, idempotente por proposta+item), preserva o que existe, guarda `task_ids`, status `gravada`, e registra memória (o que o humano escolheu e descartou).

Modelo padrão: o do catálogo com `padrao_para` contendo `estrategista` (GPT-5.6 Luna no raciocínio mais alto, a confirmar pelo id real).

## 5. Diretor de arte e gerador (função `estudio-arte`)

Ações (equipe). Uma lâmina por chamada, para não estourar o tempo da função.
- `preparar { task_id, modelo_imagem_id?, qualidade? }`: lê o item da agenda (roteiro dos cards), kit, fontes, referências (com `leitura`), artes anteriores do cliente (anti-repetição), prompt do diretor; escreve `direcao` com `texto_exato` e `prompt_imagem` de cada card. Cria `estudio_trabalhos`.
- `gerar_card { trabalho_id, ordem }`: chama o gerador com o `prompt_imagem`, a logo (capa e final), amostras das fontes, até 4 referências mais próximas (escolhidas pelo Jev) e o card anterior (continuidade do carrossel infinito); salva em `mesa`; lê o texto da imagem com um modelo de visão e compara com `texto_exato`; Jev confere identidade (Score). Grava a versão no card.
- `ajustar_card { trabalho_id, ordem, instrucao }`: o diretor transforma o pedido em instrução de edição; edição dentro do gerador sobre a versão atual; nova versão com verificação. Guarda na memória do agente o que foi pedido.
- `legenda { trabalho_id }`: legenda final a partir do item e da arte.
- `entregar { trabalho_id }`: cria os arquivos em Arquivos (pasta `materiais`, tipo `carrossel` ou `post`, carrossel com pai e filhos na ordem, legenda no arquivo), ligados ao cliente e ao projeto do item, pelo mesmo caminho de criação de arquivo que a tela de Arquivos usa; status `entregue`.
- `referencias` sub-ações: `importar_pinterest { client_id, url }` (baixa a imagem do pin pela meta og:image, salva e cria a referência), `sincronizar_workspace { client_id }` (liga as imagens das pastas de referências do workspace do cliente), `ler { referencia_id }` (modelo de visão descreve a técnica; custo na carteira do cliente).

## 6. Entrega (etapa 3 da construção)

- Envio em lote para aprovação usando as mesmas funções da tela de Arquivos (`request_file_agency_review`, `admin_release_file_now`).
- Agendamento automático na aprovação do cliente: depois de estudar o fluxo atual de mídia aprovada e publicação (`transition_editorial_publication`, evento `approved_media_adopted`), ligar o arquivo aprovado ao post do item e agendar na data do item (segunda a sexta, hora padrão do cliente, ajustável). Nada muda para itens que não vieram do estúdio.

## 7. Interface (`/mesa`)

- Seletor de cliente; abas Contexto, Mês, Estúdio, Entrega; barra de custo fixa no topo.
- Minimalista: uma coisa por vez, conversa lateral recolhível, preço antes de cada ação que gasta.
- Entradas: botão "Mesa" no card do cliente na Central e no item do Calendário (abre direto no Estúdio daquele item).
- Contexto: paleta, logo, fontes (upload, nome, papel; amostra PNG gerada no navegador com FontFace e canvas e enviada ao bucket), referências (grade com origem, colar link do Pinterest, sincronizar workspace, ler), rosto com registro de autorização, prompt do cliente (complemento, versões), memória (lista editável).
- Mês: período, frequência, objetivo, oferta, modelo e raciocínio; temas como cartões selecionáveis com nota do Jev; itens detalhados; conversa; gravar.
- Estúdio: itens da agenda do mês; direção por card; gerar card a card com custo estimado; ver versões; ajustar por conversa; legenda; entregar.
