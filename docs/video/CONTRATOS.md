# Contratos do gerador de vídeo (Mesa Vídeos, frente V-A, 26/09/2026)

Tudo passa pela função `mesa-videos` (POST, `supabase.functions.invoke("mesa-videos", { body })`),
só equipe com acesso ao cliente. Erro sempre volta com `{ error, mensagem }` (códigos abaixo).
Código: `supabase/functions/mesa-videos/geracao.ts` e `diretor.ts`; regras puras em
`supabase/functions/mesa-videos/modulos/modelos-de-video.ts`, `video-executor.ts`, `video-angulo.ts`,
`video-kits.ts` e `diretor-de-video.ts`.

## Regras que valem para toda geração

- **Custo antes.** Toda ação que gasta pede `custo_confirmado_usd` (o valor que a pessoa viu).
  Sem ele: `409 confirmar_custo` com `custo_estimado: { usd, detalhe }` (a tela mostra e a pessoa
  confirma). Se o servidor calcular mais que o confirmado: `409 custo_mudou`. Motor sem preço
  conferido: `409 sem_cotacao` (não gera).
- **Carteira.** Saldo conferido antes (`402 saldo_insuficiente`). Cobrança por variação pronta,
  uma vez só, pela RPC `ia_registrar_uso` (modelo `video:<motor>`, provedor `fal`, chave da agência).
  Erro do provedor e prazo vencido não são cobrados.
- **Idempotência.** `uid` (gerado pela tela a cada clique) vira a chave do pedido: o mesmo `uid`
  nunca gera duas vezes (devolve o pedido que já existe, `ja_existia: true`).
- **Sem laço.** Envio: uma chamada por variação, sem nova tentativa. Consulta de andamento só
  quando alguém pede (`gerar_status` ou `gerar_status_cliente`), com 15 s de intervalo mínimo por
  pedido (trava no banco) e prazo por motor (passou: vira erro registrado, sem cobrança).
- **Arquivos de entrada.** Caminhos do Storage do cliente no bucket `mesa`, começando por
  `<client_id>/`. Outro caminho: `400 <campo>_invalido`.
- **Resultado.** Vídeo em `<cliente>/video/gerados/<pedido>-<n>.mp4` e imagem de ângulo em
  `<cliente>/video/angulos/<pedido>-<n>.png`, registrados em `video_arquivos` (tipo `gerado` ou
  `angulo`, com `pedido_id`, `cena_ref` = plano e `origem` com motor, endpoint e variação).
  O arquivo nunca entra inteiro na memória da função (`_shared/video-armazenar.ts`): com
  tamanho conhecido, upload resumível do Storage (TUS) em partes de 6 MB lidas aos poucos do
  provedor; sem tamanho, o corpo do provedor vai transmitido direto para o Storage
  (`duplex: "half"`). Link do provedor vencido vira erro registrado ("Baixar de novo" pede outra vez).
  Miniatura própria `<caminho>.mini.jpg` (nunca transformação do Storage): imagem reduzida no
  servidor; vídeo com miniatura pronta do provedor (HeyGen) usa ela; vídeo com quadro inicial usa a
  **cópia leve** do quadro (640 px, `.mini.jpg` ou `.media.jpg`, pedida à função `copias-leves`
  quando falta), lida uma vez por consulta do pedido e nunca o original grande aberto na função;
  vídeo sem nada disso ganha a miniatura no navegador (primeiro quadro) quando os Resultados abrem.
- **Leitura leve (frente V-C, pedido da AB).** `diretor_avaliar` lê a miniatura própria do vídeo
  (nunca baixa o vídeo) e a cópia leve da imagem; `antes_depois_imagem` manda ao modelo a cópia de
  até 2048 px e, sem cópia, o original só até 8 MB (`413 foto_grande_demais` acima). Regras puras em
  `_shared/video-armazenar.ts` (`leituraParaAVisao`, `LEITURA_DA_MINIATURA_DO_QUADRO`,
  `fotoParaEditar`).
- **Queda da função.** Na tela, resposta cortada no meio, 546 (CPU ou memória) e 504 (tempo) viram
  `funcao_interrompida` ("A função parou no meio..."); 404 e rede antes de responder continuam
  `funcao_indisponivel` (`src/components/mesa-videos/videosApi.ts`, `erroDaChamada`).
- **Motor sem chave.** `409 motor_precisa_chave` (a tela mostra "Precisa de chave" e o nome do
  segredo, nunca o valor; no par da Higgsfield, `chave` traz os nomes que faltam). Provedor sem
  executor: `409 motor_a_integrar`. Sora: `motor_encerrado`.
- **Provedores (frente V-C).** fal, Runway, Higgsfield e HeyGen passam pelo mesmo núcleo
  (`_shared/video-executor.ts`, `executorDoProvedor`; cada um em `_shared/video-provedor-*.ts`). A
  cobrança registra o provedor certo em `ia_registrar_uso` (`_provedor`: `fal`, `runway`,
  `higgsfield` ou `heygen`). Erro do provedor vira frase clara (sem crédito, chave inválida, conteúdo
  recusado, limite de uso, parâmetros) e nunca é tentado de novo.
- **Sem o SQL V-01**: `503 banco_sem_gerador` antes de gastar qualquer coisa.

## `angulo_gerar` (a V-B chama do editor)

Entrada:

```json
{
  "acao": "angulo_gerar",
  "client_id": "uuid",
  "imagem_path": "<cliente>/.../foto.png",
  "angulo": { "azimute": -180..180, "elevacao": -30..60, "distancia": "perto" | "medio" | "longe" },
  "variacoes": 1..4,
  "modelo": "qwen-angulos-2511" | "flux-2-angulos",
  "manter": "personagem" | "cenario" | "ambos",
  "prompt": "texto extra opcional",
  "uid": "id do clique",
  "custo_confirmado_usd": 0.074,
  "so_estimar": false
}
```

- `azimute` 0 = de frente; 90 = perfil com a câmera à direita da pessoa; -90 = o outro perfil;
  180 = costas. `elevacao` positiva = câmera de cima. `modelo` omitido = o Top de ângulo.
- `so_estimar: true` não gasta: devolve `{ ok, pedido_id: null, custo_estimado }`.
- Saída: `{ ok: true, pedido_id, custo_estimado: { usd, detalhe, incerto, motor, confirmado_usd, por_variacao } }`.
- O resultado aparece nos pedidos (`video_pedidos.tipo = "angulo"`, `resultado.envios[]`) e nos
  arquivos (`video_arquivos.tipo = "angulo"`), depois de `gerar_status { pedido_id }`.
- Tradução para o motor (Qwen Edit 2511 Multiple Angles): `horizontal_angle` = azimute em 0..360
  no sentido horário, `vertical_angle` = elevação, `zoom` 8/5/2 para perto/médio/longe
  (`_shared/video-angulo.ts`).

## `cena_gerar` e `gerar_video`

`cena_gerar` é o mesmo núcleo do `gerar_video`, com `modo` padrão `primeiro_quadro`.

```json
{
  "acao": "gerar_video",
  "client_id": "uuid",
  "motor": "seedance-2.5",
  "modo": "texto" | "primeiro_quadro" | "primeiro_ultimo" | "referencia" | "estender",
  "tipo": "gerar_livre" | "gerar_plano",
  "prompt": "...", "negativo": "...",
  "duracao_s": 5, "formato": "9:16", "resolucao": "720p", "audio": true, "seed": 1,
  "quadro_inicial_path": "...", "quadro_final_path": "...", "referencias_paths": ["..."],
  "video_arquivo_id": "uuid (estender)",
  "variacoes": 1..4, "projeto_id": "uuid", "plano_ref": "p3", "titulo": "...",
  "uid": "...", "custo_confirmado_usd": 1.2
}
```

Saída: `{ ok, pedido_id, custo_estimado, enviados }`. Duração e resolução são presas ao que o
motor aceita (o custo segue a duração presa).

Frente V-C: campo opcional `"camera"` (um dos 33 movimentos da Higgsfield, por exemplo
`"dolly-in"`, `"drone-orbit"`, `"bullet-time"`; lista em `_shared/video-provedor-higgsfield.ts`,
`MOVIMENTOS_DA_HIGGSFIELD`). Só vale para motor com `cap.camera` (hoje `higgsfield-cinema-4`); em
outro motor, `400 entrada_incompleta`. Motores novos: `runway-gen4.5` (texto em 9:16 ou 16:9, ou
primeiro quadro), `runway-gen4-turbo` (primeiro quadro) e `higgsfield-cinema-4` (texto, imagem de
referência e câmera pronta).

## `continuar_video` (a V-B chama do editor)

```json
{ "acao": "continuar_video", "client_id": "uuid", "arquivo_id": "uuid do vídeo", "quadro_path": "<cliente>/video/quadros/....png",
  "usar_extensao": true, "prompt": "o que acontece depois", "motor": "veo-3.1", "duracao_s": 6, "formato": "9:16",
  "variacoes": 1, "uid": "...", "custo_confirmado_usd": 1.2 }
```

- Motor com extensão nativa (Veo 3.1, Seedance 2.5, H3 Max, LTX-2.3, FLUX 3, Grok, Kling O3) e
  `usar_extensao` diferente de `false`: usa a extensão do motor com o vídeo.
- Senão: o último quadro vira o primeiro quadro do clipe novo (`quadro_path` obrigatório).
- **Último quadro, como é tirado:** no navegador (`src/lib/mesa-videos/quadros.ts`,
  `quadroDoVideoNoStorage(clientId, bucket, caminho, "ultimo")`), sempre no tempo
  `duração - 0,017 s` (meio quadro a 30 fps; o seek na duração exata devolve preto no Safari),
  PNG sem perda em `<cliente>/video/quadros/`. Determinístico: o mesmo vídeo dá o mesmo quadro.
  Opcional: `quadro_registrar` guarda o quadro no acervo (tipo `quadro`). Se a V-B preferir o
  servidor, o fal tem `fal-ai/ffmpeg-api/extract-frame` (pago, não usado aqui).
- Saída: `{ ok, pedido_id, custo_estimado, via: "extensao_nativa" | "ultimo_quadro" }`.

## `transicao_gerar` (a V-B chama do editor)

```json
{ "acao": "transicao_gerar", "client_id": "uuid", "quadro_a_path": "último quadro de A", "quadro_b_path": "primeiro quadro de B",
  "prompt": "opcional", "motor": "kling-2.6-pro", "duracao_s": 5, "formato": "9:16", "variacoes": 1, "uid": "...", "custo_confirmado_usd": 0.35 }
```

Primeiro quadro = fim de A, último quadro = começo de B. Motor sem último quadro:
`400 motor_sem_ultimo_quadro`. Os dois quadros saem do navegador como acima (`"ultimo"` de A,
`"primeiro"` de B).

## `antes_depois_imagem` e `antes_depois_para_editor`

- `antes_depois_imagem { client_id, imagem_path, direcao: "antes" | "depois", descricao, formato }`:
  a outra versão da foto com o **modelo de imagem padrão do painel** (ia_modelos, padrão
  `imagem`), pelo ia-motor e a carteira (mesma câmera, luz e enquadramento). Saída:
  `{ arquivo, storage_path, custo_usd, saldo_usd }` (tipo `quadro`).
- `antes_depois_para_editor { client_id, antes_arquivo_id, depois_arquivo_id, layout, formato, titulo }`
  grava uma versão rascunho com o projeto de edição (formato de `_shared/projeto-de-edicao.ts`,
  sem campo novo):
  - `lado_a_lado` e `cortina`: duas trilhas de vídeo (`video-1` antes, `video-2` depois), os dois
    clipes começando em 0 e cortados na menor duração; cada clipe leva no `estilo` livre
    `{ layout: "lado_a_lado" | "cortina", par: "antes" | "depois", lado: "esquerda" | "direita" }`.
  - `sequencia`: uma trilha, o antes e depois o depois, `estilo: { layout: "sequencia", par }`.
  - **Para a V-B:** o editor desenha o layout lendo `clipe.estilo.layout` (lado a lado divide a
    tela; cortina usa a alavanca do comparador no tempo, a posição pode ir em
    `estilo.cortina_posicao` 0..1 se precisar).

## Comparador (V-B)

A tela usa `src/components/comparar/ComparadorAntesDepois.tsx` quando o arquivo existir (entra
sozinho por `import.meta.glob`), com as props
`{ antes: string (URL), depois: string (URL), tipo: "imagem" | "video", rotulo?: string }` e
`export default`. Até lá vale o comparador simples de `src/components/mesa-videos/AntesEDepois.tsx`.

## Diretor

- `diretor_conversar { client_id, projeto, texto, fase, conversa? }` (resposta com fôlego) ->
  `{ projeto, gravado, resposta, perguntas, avisos, continuidade, custo_roteiro, custo_usd, saldo_usd, mensagem_id, acao, pedido_do_editor }`.
  GPT-6 Luna (`openrouter:openai/gpt-6-luna`), raciocínio `max`, busca na web na fase `pesquisa`
  (ou quando o pedido fala de região, lugar, época). Registro de uso: tarefa `conversa`, agente
  `diretor_arte` (valores que o banco aceita hoje).
- `diretor_salvar { client_id, projeto, versao_lida }` (trava otimista; `409 projeto_mudou`).
- `diretor_propor_gerar { client_id, projeto, planos: ["p1"], variacoes }` -> proposta do contrato
  comum (`acoes-do-agente.ts`) em `video_acoes`; `executar_acao_agente` gera item a item com a
  entrada mostrada (`acao.contexto.entradas`); `sem_desfazer: true`; `custo_estimado_usd` somado.
- `diretor_avaliar { client_id, projeto, plano_ref, arquivo_ids }` -> visão descreve cada quadro
  (miniatura própria), o Jev julga: Noul "mesmo personagem da folha?" por personagem, Noul "mesmo
  cenário e luz?" e Choice "qual variação segue melhor". Saída
  `{ variacoes: [{ id, personagens, cenario, nota, ok }], melhor, confianca, custo_usd }`. Nada é
  refeito sozinho.
- `diretor_para_editor { client_id, projeto, titulo? }` -> versão rascunho com o projeto de edição:
  os planos na ordem do roteiro com o resultado escolhido (`plano.escolhido`), inteiros e em
  sequência; texto na tela vira clipe da trilha de texto no tempo do plano; `faltando` lista os
  planos sem resultado. `diretor_editor_desfazer { versao_id }` volta (a versão vira rejeitada;
  só rascunho e só a versão com a nota "Montado pelo diretor").
- AG2 (29/09): a conversa do diretor mora em `agente_conversas` (agente `diretor_arte`,
  `referencia_tipo` `mesa_videos`, `referencia_id` = id do projeto) e `agente_mensagens`; a tela relê
  de lá. O modelo recebe o histórico (12 últimas), o ESTADO REAL do roteiro (pronto ou motivo,
  gerando, prontos, escolhido, custo por variação), a referência do pedido ("a segunda" = p2, Jev) e
  as regras ensinadas (`aprendizado-das-mesas.ts`, mesa `video`). `acao.tipo`: `gerar`, `refazer`
  (roteiro volta com a composição nova) ou `mandar_ao_editor`; `variacoes` 1 a 4. O cartão mora na
  mensagem do agente (`executar_acao_agente`/`desfazer_acao_agente` acham em `video_acoes` ou em
  `agente_mensagens`). Gerar: `contexto.custos[ref]` é o teto confirmado de cada plano (o executor
  usa o catálogo em uso e recusa se o preço subiu). Mandar ao editor: sem custo e com Desfazer;
  ordem clara vai na hora (proposta guardada antes). A resposta traz `anexos` ("Aprendi", "Segui") e
  `aviso_registro` quando a conversa não foi guardada.
- `agente_agir { client_id, mesa, texto, ordem?, selecionados?, ultima_resposta? }` (agente da
  mesa): entende e age em `enviar_para_edicao`, `arquivar`, `vincular` (ligar à cena) e `organizar`,
  com os vídeos que o pedido aponta (r1..rN na ordem da tela). Sem custo e com Desfazer: ordem clara
  vai na hora; dúvida volta como `pergunta`. `aprendizado_esquecer` e `aprendizado_guardar` (mesa
  `video`, ou `edicao` com `mesa: "edicao"`).
- `template_salvar { client_id, projeto, nome, da_agencia }` e
  `template_arquivar { template_id, arquivar }` (arquivar, nunca apagar).

## `avatar_gerar` (frente V-C: HeyGen, avatar falando)

```json
{ "acao": "avatar_gerar", "client_id": "uuid", "fonte": "estoque" | "clone",
  "avatar_id": "id do look da HeyGen (estoque)", "clone_id": "uuid do clone da Mesa Foto (clone)",
  "confirma_uso_em_video": true, "voz_id": "...", "locale": "pt-BR" | null,
  "roteiro": "texto falado (até 3.000 letras)", "formato": "9:16" | "16:9" | "1:1" | "4:5",
  "resolucao": "720p" | "1080p", "legendas": true, "velocidade": 0.5..1.5, "titulo": "...",
  "uid": "...", "custo_confirmado_usd": 0.3 }
```

- Motor: `heygen-avatar-iv` (estoque) ou `heygen-foto` (clone). Custo antes pela duração estimada
  da fala (`duracaoEstimadaDaFala`); na hora de cobrar, vale a duração real do vídeo, nunca mais que
  o confirmado (`custoDaVariacaoPronta`).
- Clone: `422 autorizacao_invalida` sem a autorização de imagem válida (mesma regra da Mesa Foto:
  confirmada, sem revogação, na validade, adulta e ciente de IA; clone do cliente e não arquivado);
  `422 confirmar_uso_em_video` sem a confirmação; `409 clone_sem_foto` sem foto real principal. A foto
  vai por link assinado de uma hora; no pedido fica só o caminho.
- O pedido é `tipo: "gerar_livre"` com `alvo.modo: "avatar"` (sem SQL novo) e
  `parametros.avatar` (fonte, avatar_id, clone_id, foto_path, voz_id, legendas, velocidade,
  duracao_estimada_s). Com `legendas`, o arquivo guardado é a versão com a legenda gravada.
- Saída: `{ ok, pedido_id, custo_estimado }`. O resultado entra em `video_arquivos` (tipo `gerado`),
  aparece nos Resultados e vai para a Edição pelo Aprovar.

## `heygen_catalogo` e `gerar_cancelar` (frente V-C)

- `heygen_catalogo { tipo: "avatares" | "vozes", token? }` -> `{ tipo, itens, proximo }`. Avatares
  de estoque que o Avatar IV aceita (`{ id, nome, genero, previa, voz_padrao, orientacao }`) ou
  vozes em português, Brasil primeiro (`{ id, nome, genero, idioma, previa, aceita_locale, brasil }`).
  Listas grátis; sem a chave, `409 motor_precisa_chave`.
- `gerar_cancelar { pedido_id }` -> `{ pedidos, cancelados }`. Uma chamada por variação na fila ou
  gerando; só Runway (`DELETE /v1/tasks/{id}`) e Higgsfield (só na fila). Outro provedor:
  `409 cancelar_indisponivel`. O que foi cancelado não é cobrado; tudo cancelado vira
  `estado: "cancelado"`.

## Catálogo

- `motores_estado` -> `{ motores: [{ id, estado, estado_rotulo, nivel, nivel_rotulo, novo, rotulo, linha, versao, chave, custo_5s }], sugestao: { top, normal, rapido } }`.
- `custo_estimar { motor, duracao_s, resolucao?, audio?, variacoes?, referencias? }` -> `{ custo }`.
- `motores_sincronizar` (admin, ou o cron semanal desligado) lê `GET https://api.fal.ai/v1/models`
  e grava versões novas em `video_motores` como "novo, sem preço".
- `gerar_status { pedido_id }`, `gerar_status_cliente { client_id }` (até 6 em andamento),
  `quadro_registrar { client_id, storage_path, origem_arquivo_id?, posicao? }`.
