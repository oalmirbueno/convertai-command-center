# Mesa do cliente, versão 3: contratos entre tela e backend (23/09/2026)

Todas as chamadas de função usam `chamarFuncao(nome, { acao, ... })` de `src/lib/mesa/api.ts`. Erros chegam como exceção (`ErroDaMesa`, use `useAvisarErro`). Toda ação que gasta usa o `BotaoComCusto` (agora sem janela: preço ao lado, executa no clique).

## Banco (leitura direta pela tela, RLS da equipe)

- `cliente_imagens` (acervo de imagens reais do cliente): `id, client_id, origem ('workspace'|'arquivo'|'upload'), workspace_node_id, file_id, storage_bucket, storage_path, nome, pasta, categoria, tags text[], descricao, ativa, criado_em, atualizado_em`. Categorias sugeridas: `ambiente`, `produto`, `pessoa`, `antes_depois`, `equipe`, `detalhe`, `fachada`, `logo`, `arte`, `outro`. A equipe pode dar `update` em `nome, categoria, tags, descricao, ativa`. URL assinada: bucket `storage_bucket` + `storage_path` (use `useUrlDaMesa(caminho, bucket)` de MesaContexto).
- `referencias_globais`: banco da agência (Pinterest do dono, mais de 1.300), `id, titulo, leitura, tags, storage_path (bucket mesa)`.
- `cliente_referencias`: referências do cliente (`papel` identidade ou tecnica; `origem` workspace, pinterest, upload, arquivo).
- `estudio_trabalhos.direcao` ganha: `referencias_ids: string[]` (referências escolhidas para o conjunto, ids de cliente_referencias ou referencias_globais, prefixo `g:` para global), `carrossel_infinito: boolean`. Cada card ganha `imagens_ids: string[]` (ids de cliente_imagens: foto real usada naquela lâmina), `referencias_ids: string[]` (sobrepõe as do conjunto) e `imagem_anterior`: descrição.
- `estudio_trabalhos.hashtags: text[]`.
- `cliente_kit_marca.logo_path`, `logo_alt_path` (bucket mesa): logo escolhida de qualquer pasta.
- `mesa_cliente_config.horario_automatico boolean` (padrão verdadeiro).

## estudio-arte

- `configurar { trabalho_id, conjunto?: { referencias_ids?: string[], carrossel_infinito?: boolean }, card?: { ordem, imagens_ids?: string[], referencias_ids?: string[], texto_exato?: string } }` sem custo. Devolve `{ trabalho }`.
- `gerar_card { trabalho_id, ordem }` igual. Novidades no servidor: carrossel contínuo gera a lâmina N como continuação real da N-1 (pintura da metade direita de uma tela dupla, na mesma chamada); lâmina com `imagens_ids` usa a FOTO REAL como base (só a área do texto é desenhada); referências escolhidas na tela têm prioridade sobre a escolha automática.
- `ajustar_card { trabalho_id, ordem, instrucao, areas?: [{x0,y0,x1,y1}] (0 a 1, relativo à lâmina), tipo?: 'livre'|'fundo', imagem_id?: string (acervo, para trocar o fundo) }`. Com `areas`, só essas áreas mudam (máscara). Com `tipo: 'fundo'`, troca só o fundo mantendo texto e primeiro plano.
- `preparar { task_id, modo: 'roteiro'|'diretor', instrucao?: string, trabalho_id?: string }`. Com `instrucao` e `trabalho_id`, o diretor refaz a direção do conjunto a partir do pedido (conversa com o diretor) e atualiza o mesmo trabalho, mantendo as versões.
- `legenda { trabalho_id }` devolve `{ legenda, hashtags: string[] }` (4 a 5 hashtags escolhidas pelo Jev entre candidatas) e grava as duas.

## agente-contexto

- `acervo_sincronizar { client_id }` sem custo: traz para `cliente_imagens` as imagens de TODAS as pastas do workspace e de Arquivos (fora a pasta de materiais entregues), com o nome da pasta. Devolve `{ novas, total }`.
- `acervo_classificar { client_id, ids?: string[] }` custa centavos: lê em lote (modelo de leitura) e preenche `descricao`, `categoria` e `tags`. Devolve `{ classificadas, custo_usd }`.
- `definir_logo { client_id, origem: 'arquivo'|'workspace'|'acervo', id, alternativa?: boolean }` sem custo: copia a imagem para `mesa/<client>/marca/` e grava `logo_path` (ou `logo_alt_path`).
- `montar { client_id, forcar?, atualizar? }`: roda uma vez. Sem fonte nova desde a última montagem (documentos, dossiê, artes), devolve `{ kit, ja_atualizado: true, custo_usd: 0 }` sem gastar; `atualizar: true` refaz mesmo assim. A leitura das referências pendentes corre junto com a montagem. Modelo: papel `contexto` do catálogo (sem ele, o de leitura). Também sincroniza o acervo.
- `ler`, `conversar`, `historico`, `fontes_da_biblioteca` como antes (conversar usa o papel `contexto`).

## agente-calendario

- `propor_temas` agora aceita período de até 31 dias por chamada (acima disso, 400 `periodo_longo`); para vários meses, a tela chama mês a mês. Tempo esgotado, inclusive no meio da resposta, vira erro claro (`provedor_timeout`, 504), nunca mais "falha inesperada".
- `completar_itens` como antes, com mais contexto (posts recentes, continuidade, sem repetir).
- Planejamento automático na tela: para cada mês do período: `propor_temas` → escolher os melhores temas pela nota do Jev (quantidade = frequência) com `escolher_temas` → `detalhar` → `gravar`.

## RPC

- `mesa_melhores_horarios(_client_id uuid)` devolve `{ por_tipo: { carousel: 'HH:MM', static: 'HH:MM', ... }, fonte: 'historico'|'padrao', amostra: number }`: melhores horários pelo alcance dos posts publicados; sem histórico, horários padrão do nicho.

## Como o estúdio usa as escolhas (servidor, 23/09)

- Foto real (`imagens_ids`): a foto é recortada em 4:5, o gerador edita só a área do texto e da logo (máscara) e o servidor devolve os pixels originais da foto em todo o resto, com pena de 28 px na emenda. A foto nunca é refeita.
- Carrossel contínuo: com a lâmina anterior pronta e modelo da OpenAI, a lâmina N é pintada na metade direita de uma tela 2176 x 1360 cuja metade esquerda é a N-1; sai o recorte da direita. Outro provedor ou tamanho recusado: modo normal com a anterior como referência. A versão grava `modo` (`foto_real`, `continuo`, `normal`).
- Ajuste por área: máscara nas áreas (ampliadas 2%) e devolução dos pixels originais fora delas (pena 16 px). A versão grava `tipo_ajuste` (`area`, `fundo`, `livre`) e `areas`.
- Referências: as escolhidas na tela (lâmina, senão conjunto) vão direto, sem Jev; sem escolha, o Jev pontua as do cliente e até 20 do banco global pré-filtradas por busca de texto na leitura.
- Direção: o diretor recebe o acervo (até 40 fotos com descrição) e escolhe `imagem_acervo` por lâmina, nunca a mesma foto duas vezes; o prompt de cada lâmina lista as imagens das anteriores para não repetir; capa sempre escura e travada; nome da marca nunca escrito na arte.
- Entrega: a legenda vai ao ar com as hashtags numa linha própria no fim; no trabalho, `legenda` e `hashtags` seguem separadas.