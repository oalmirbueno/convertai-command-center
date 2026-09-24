# Mesa Foto: áreas "Modelos" e "Canvas" (pesquisa e desenho técnico)

Data: 2026-09-24. Continuação de `CONTRATO.md` e `CONTRATO-V2.md` (as regras duras continuam valendo). Documento de desenho: nada aqui foi implementado, nenhuma migration foi aplicada.

Pedido do dono:

1. **Modelos**: criar pessoas sintéticas hiper-realistas a partir de uma referência que ele manda, com upscale e detalhamento para ficar o mais real possível; gerar com vários modelos de imagem lado a lado para escolher o mais real; guardar as personas para reutilizar.
2. **Canvas**: quadro onde ele arrasta cartões (produto do kit, modelo/pessoa, ambiente, estilo, prompt), liga com linhas e gera a imagem combinando tudo ("tenho esse óculos, quero com esse modelo nesse ambiente").

---

## 1. Resumo das decisões

| Tema | Recomendação |
| --- | --- |
| Persona do zero, lado a lado | 4 motores por padrão: **GPT Image 2.5 Sunburst**, **Nano Banana Pro**, **Seedream 5.0 Pro**, **MAI-Image-2.6**. Opcionais: FLUX.2 Max, Grok Imagine Image 2.0, Krea 2 Large, Nano Banana 2 (rascunho barato). Todos no OpenRouter, sem chave nova. Rodada de 4 fica em torno de US$ 0,30 a 0,40. |
| Folha da persona (mesma pessoa em várias vistas) | O motor que gerou a âncora escolhida, com preferência por Nano Banana Pro (até 5 imagens de pessoa + 6 de objeto) ou GPT Image 2.5 Sunburst (até 16 referências). Uma vista por chamada, imagens separadas (não uma folha única). |
| Produto + persona + ambiente (Canvas) | Padrão **GPT Image 2.5 Sunburst** (líder em edição, 16 referências). Segundo: **Nano Banana Pro** (fidelidade de objeto, 4K). Terceiro: **Seedream 5.0 Pro** (14 referências, rótulo legível). Barato: FLUX.2 Pro. |
| Upscale sem chave nova | "Detalhar em 4K" por re-renderização no OpenRouter: Nano Banana Pro 4K (US$ 0,24) para pessoa; Seedream 4.5 4K (US$ 0,04) ou Riverflow V2.5 Pro 4K (US$ 0,17) para produto. É generativo: vira versão nova, marcada, com comparação antes e depois. |
| Upscale fiel (pixel a pixel) | Exige conta nova: **fal.ai** (Topaz Precision, Crystal Upscaler, SeedVR2) ou Replicate (Real-ESRGAN). Fase 2, só se o dono cadastrar. |
| Canvas no navegador | **@xyflow/react 12** (React Flow, MIT), carregado só na aba Canvas (cerca de 62 KB gzip), com as configurações da seção 7 para Safari 11 / Chrome 64. Plano B: implementação própria com eventos de mouse e toque + SVG. |
| Julgamento "qual é mais real" | Nunca automático. Visão lê cada candidata e escreve observações; o Jev dá notas (Score) sobre esse texto como **aviso**; o dono escolhe. |
| Motor de imagem | Mudança necessária em `ia-motor.ts`: mandar todo modelo de imagem do OpenRouter pela API dedicada `/api/v1/images` com `resolution`, `aspect_ratio`, `seed` e `input_references` conforme as capacidades de cada modelo. Hoje só o GPT Image vai por ela, e nenhum modelo recebe resolução (tudo sai em 1K). |

---

## 2. O que já existe e as lacunas encontradas no código

Lido em `supabase/functions/_shared/ia-motor.ts`, `supabase/functions/mesa-foto/index.ts`, `calculos.ts`, `receitas.ts`, `src/lib/mesa/api.ts`, `src/components/mesa/Seletores.tsx`, `src/polyfills.ts`, `package.json`.

**Já serve:**

- `chamarImagem` faz uma imagem por chamada, com carteira, `ia_usos`, custo real (`usage.cost` do OpenRouter), reserva por crédito e `referencias: ImagemEntrada[]` em ordem (a editada primeiro, depois as referências).
- Catálogo `ia_modelos` com `ativo`, `padrao_para`, `preco_imagem`; a tela lista com `modelosAtivos(catalogo, "imagem")` e mostra preço com `precoDoModelo`; `SeletorDeModelo` já é o componente de escolha. O padrão de imagem hoje é `openrouter:openai/gpt-image-2.5-sunburst` (migration `20260924012047`).
- `tomada_gerar` já monta as fontes em ordem de papel (identidade primeiro) e respeita `limiteDeFontesDoMotor`; `respostaComFolego` para ações longas; conferência por visão + Jev como aviso, sem laço.

**Lacunas que as duas áreas expõem:**

1. **Resolução nunca é pedida.** `imagemOpenRouter` manda só `image_config.aspect_ratio`; sem `image_size`/`resolution`, Nano Banana Pro e Nano Banana 2 saem em 1K. Não existe 2K nem 4K hoje.
2. **Modelos só de imagem pelo chat.** Seedream, FLUX.2, Riverflow, MAI, Qwen, Grok e Krea têm saída só `image`. O motor manda qualquer modelo que não seja GPT Image para `/chat/completions` com `modalities: ["image","text"]`. A documentação do OpenRouter coloca todos os geradores na API unificada `POST /api/v1/images`; o caminho seguro é mandar todos por ela.
3. **Preço por imagem errado para modelo cobrado por imagem ou por megapixel.** `converterModeloOpenRouter` estima `image_output × 1.290 tokens`. Para Seedream 4.5 isso dá cerca de US$ 0,012, mas o preço real no endpoint é US$ 0,04 por imagem; FLUX.2 cobra por megapixel. O preço certo está em `GET /api/v1/images/models/{id}/endpoints` (campo `pricing` com `unit: image | megapixel | token` e `variant: 2k | 4k | high_resolution`).
4. **Limite de referências fixo.** `limiteDeFontesDoMotor` devolve 16 (GPT Image), 14 (Gemini) e 8 para o resto. Os limites reais variam: Seedream 14, Riverflow 10, FLUX.2 8, MAI 5, Qwen 4, Grok 3, Krea 1. Passar referência demais faz o provedor recusar.
5. **Metadados de procedência.** `emPng` re-codifica a saída. OpenAI grava C2PA e Google grava SynthID (marca d'água invisível, sobrevive) mas os metadados C2PA/IPTC somem na re-codificação. Para a Meta mostrar "Informações de IA" ela lê C2PA/IPTC. Ver riscos.

---

## 3. Modelos de imagem no OpenRouter hoje (conferido em 2026-09-24)

Fonte: `GET https://openrouter.ai/api/v1/images/models` e `.../endpoints` de cada modelo (lista pública, sem chave), preços oficiais do Google e ranking cego da Artificial Analysis (Elo de texto para imagem e de edição).

| Modelo (slug OpenRouter) | Refs máx. | Resolução | Preço no OpenRouter | Elo T2I / Edição | Observação para este uso |
| --- | --- | --- | --- | --- | --- |
| `openai/gpt-image-2.5-sunburst` | 16 | tamanhos 1024 a 1536; quality até `max` | US$ 30 por 1M tokens de saída; aprox. US$ 0,05 (high) a US$ 0,21 (max) por 1024x1024 + entrada | 1196 / 1181 (1º nos dois) | Melhor em edição precisa e preservação; fundo transparente; proporções sem 4:5 (usar `size` explícito ou 3:4 + recorte). Críticas: pele às vezes "limpa demais". |
| `openai/gpt-image-2.5-flare` | 16 | idem | mesmo preço por token | 1190 / 1163 | Mais rápido; bom para rascunho de composição. |
| `google/gemini-3-pro-image` (Nano Banana Pro) | 14 (até 6 objetos em alta fidelidade + 5 pessoas) | 1K, 2K, **4K** | US$ 0,134 (1K/2K), US$ 0,24 (4K) | 1101 / 1098 | Microdetalhe de retrato (poros, cabelo, reflexo no olho) e consistência de personagem; único com 4K e separação objeto/pessoa documentada. |
| `google/gemini-3.1-flash-image` (Nano Banana 2) | 14 (até 10 objetos + 4 pessoas) | 512, 1K, 2K, **4K** | US$ 0,067 (1K), 0,101 (2K), 0,151 (4K) | 1122 / 1108 | Rascunho barato com boa consistência de personagem; 4K barato. |
| `bytedance-seed/seedream-5-0-pro` | 14 | 1K, 2K | US$ 0,045 por imagem; 0,09 na variante de alta resolução; + US$ 0,003 por imagem de entrada | 1078 / 1109 | Retrato fechado muito fotográfico (poros, linhas finas); corpo inteiro às vezes com cara de "recortado". Rótulo de produto legível. |
| `bytedance-seed/seedream-5-0-lite` | 14 | 2K, **4K** | US$ 0,035 por imagem | 1057 (edição) | Barato em 4K. |
| `bytedance-seed/seedream-4.5` | 14 | 1K, 2K, **4K** | US$ 0,04 por imagem | abaixo do top 20 | Opção mais barata para re-render 4K. |
| `microsoft/mai-image-2.6` | 5 | proporções fixas | aprox. US$ 0,039 por imagem (token) | 1147 / 1135 | Custo baixo com qualidade de topo; bom 4º motor da rodada. |
| `x-ai/grok-imagine-image-2.0` | 3 | 1K, 2K | US$ 0,04 a 0,08 + US$ 0,01 por referência | 1154 / 1106 | Opcional na rodada de persona (poucas referências). |
| `black-forest-labs/flux.2-max` | 8 | proporções; `seed` | US$ 0,07 por megapixel de saída | não listado | Consistência multi-referência; parâmetros `steps`, `guidance`. |
| `black-forest-labs/flux.2-pro` | 8 | idem | US$ 0,03 por megapixel | não listado | Alternativa barata para composição. |
| `sourceful/riverflow-v2.5-pro` | 10 | 1K, 2K, **4K** | US$ 0,13 / 0,15 (2K) / 0,17 (4K) | não listado | Foco em produto e embalagem; fundo transparente; 4K. |
| `qwen/qwen-image-3-pro` | 4 | 1K, 2K | US$ 0,04 (1K), 0,075 (2K) + 0,003 por entrada | 1088 / 1078 | Texto pequeno nítido; secundário aqui. |
| `krea/krea-2-large` | 1 | 1K | não publicado no endpoint (conferir na 1ª chamada) | não listado | "Textura mais crua", bom contra o visual plastificado; só 1 referência, então só para persona do zero. |
| `meta/muse-image` | | | sem provedor ativo no OpenRouter hoje | 1112 / 1117 | Indisponível. |

Parâmetros comuns da API `/api/v1/images`: `model`, `prompt`, `input_references` (URL https ou data URL), `resolution` (`512 | 1K | 2K | 4K`), `aspect_ratio`, `size` (tier ou pixels), `quality`, `background`, `output_format`, `n`, `seed`, `provider` (roteamento). Cobrança "tudo ou nada": geração que falha não é cobrada. Máscara: nenhum modelo do OpenRouter expõe máscara nessa API; área travada continua sendo feita no código (`devolverOriginalForaDasAreas`).

Nota de realismo das fontes: os rankings cegos colocam o GPT Image 2.5 no topo, mas testes focados em retrato apontam pele "polida" no GPT e poros mais fotográficos no Seedream e no Nano Banana Pro. Por isso o lado a lado é a decisão certa: nenhum motor ganha em todo rosto.

---

## 4. Recomendação por tarefa

### 4.1 Persona hiper-realista do zero (rodada lado a lado)

- Padrão da rodada (4 motores, 1 imagem cada, retrato 4:5, meio corpo, luz natural suave, fundo neutro):
  1. `openai/gpt-image-2.5-sunburst`, quality `high` (aprox. US$ 0,05 a 0,10).
  2. `google/gemini-3-pro-image`, `resolution: 2K` (US$ 0,134).
  3. `bytedance-seed/seedream-5-0-pro`, 2K (US$ 0,09 + 0,003 por referência).
  4. `microsoft/mai-image-2.6` (aprox. US$ 0,04).
  - Total aproximado: US$ 0,30 a 0,40 por rodada, mais a leitura por visão de cada candidata (aprox. US$ 0,01 cada).
- Opcionais por chip: FLUX.2 Max, Grok Imagine 2.0, Krea 2 Large, Nano Banana 2.
- A tela deixa o dono ligar e desligar motores; o preço total aparece antes (padrão `BotaoComCusto`).

### 4.2 Mesma persona em novas fotos (folha e uso)

- Motor preferido da persona = o que gerou a âncora escolhida (trocar de motor entre fotos aumenta a deriva de rosto).
- Nano Banana Pro e GPT Image 2.5 Sunburst são os melhores para manter identidade com várias referências. Seedream 5.0 Pro é bom em close.
- Referências da persona por chamada: âncora + 2 a 4 vistas da folha (as mais próximas do ângulo pedido).

### 4.3 Produto + persona + ambiente (Canvas)

- Padrão: GPT Image 2.5 Sunburst (`quality: high`, 16 referências; o produto nunca é cortado por falta de espaço).
- Alternativas lado a lado no mesmo nó "Gerar": Nano Banana Pro 2K (objeto em alta fidelidade + pessoa separada) e Seedream 5.0 Pro.
- Rascunho barato: Nano Banana 2 1K (US$ 0,067) ou FLUX.2 Pro (aprox. US$ 0,045 em 1088x1360).
- Produto com texto/rótulo pequeno: GPT Image 2.5 (melhor texto) e conferência por visão do rótulo.

### 4.4 Upscale e detalhamento

| Caminho | Precisa de chave nova? | Custo | Fidelidade | Uso |
| --- | --- | --- | --- | --- |
| **Detalhar em 4K (re-render)** com Nano Banana Pro 4K, a imagem aprovada como 1ª referência + âncora e vistas da persona | Não (OpenRouter) | US$ 0,24 | Generativo: pode mexer em traço fino | Persona e fotos com pessoa |
| Detalhar 4K com Nano Banana 2 | Não | US$ 0,151 | Generativo | Versão barata |
| Detalhar 4K com Seedream 4.5 ou 5.0 Lite | Não | US$ 0,04 / 0,035 | Generativo | Produto e ambiente, custo mínimo |
| Detalhar 4K com Riverflow V2.5 Pro | Não | US$ 0,17 | Generativo, foco em produto, fundo transparente | Produto com embalagem |
| Topaz Upscale Precision (fal.ai `topaz/upscale/image/precision`) | **Sim, conta fal.ai** | US$ 0,08 por 24 MP | Fiel, com melhoria de rosto | Ampliação sem inventar |
| Crystal Upscaler (fal.ai `clarityai/crystal-upscaler`) | **Sim, fal.ai** | aprox. US$ 0,016 por MP | Voltado a retrato | Pele e rosto |
| SeedVR2 (fal.ai) | **Sim, fal.ai** | aprox. US$ 0,0025 por MP | Fiel, resolução alvo até 2160p | Volume, custo mínimo |
| Clarity Upscaler (fal.ai), estilo Magnific | **Sim, fal.ai** | US$ 0,03 por MP | Generativo guiado por prompt | "Criar detalhe" controlado |
| Real-ESRGAN (Replicate) | **Sim, conta Replicate** | aprox. US$ 0,002 por imagem | Fiel, pode alisar pele | Básico |
| SUPIR (Replicate) | **Sim, Replicate** | variável, lento (GPU, partida a frio) | Generativo forte | Não recomendado aqui |

Recomendação:

- **Fase 1 (sem chave nova):** botão "Detalhar em 4K" com Nano Banana Pro para pessoa e Seedream 4.5 para produto. Sempre gera **versão nova** (linhagem `derivada_de`, `modo: 'detalhe'`), nunca sobrescreve; a tela mostra antes e depois com cortina e a conferência por visão compara rosto e produto com as referências.
- **Fase 2 (se o dono criar conta na fal.ai e salvar `FAL_KEY` nos segredos do Supabase):** botão "Ampliar fiel" com Topaz Precision (padrão) e Crystal (retrato). Isso pede um módulo pequeno `_shared/ampliador.ts` (não mexer no tipo `Provedor` do motor) que registra em `ia_usos` com provedor `fal` e respeita a carteira.
- Ordem boa para pessoa: escolher a candidata em 1K/2K, aprovar, **depois** detalhar em 4K (não pagar 4K em candidata que vai ser descartada).

---

## 5. Consistência de persona sintética e prompt de hiper-realismo

### 5.1 Técnica (o que as fontes convergem)

- **Âncora primeiro, folha depois.** Escolher 1 imagem (a âncora) entre as candidatas; dela gerar vistas separadas: frente, 3/4 esquerda, 3/4 direita, perfil, meio corpo, corpo inteiro (e mãos, se o uso pedir). Rosto de perfil e de costas é onde a identidade mais deriva; por isso a folha precisa ter essas vistas.
- **Imagens separadas, não uma folha única.** Para os geradores de imagem, 3 a 4 referências separadas funcionam melhor que um "character sheet" em um quadro só (o modelo tenta copiar a grade).
- **Referência por índice e papel no prompt:** "Imagem 1: a pessoa (identidade, não mudar rosto, tom de pele, formato do rosto, cabelo). Imagem 2: o produto (não mudar formato, cor, logo). Imagem 3: ambiente (só clima e luz)". Guia da OpenAI: separar o que muda do que fica e repetir as invariantes a cada chamada.
- **Invariantes da persona em texto também** (ficha): idade aparente, tom de pele, formato do rosto, olhos, sobrancelhas, nariz, lábios, cabelo (cor, comprimento, textura), marcas (sardas, pintas, cicatriz), altura/corpo. O texto segura o que a imagem não mostra.
- **Um motor por persona.** Guardar `motor_preferido_id`; trocar de motor só com aviso.
- **Limites a aceitar:** mãos perto do rosto, dentes, brincos e óculos (acessório deriva mais que rosto), mudança grande de luz. Sem treinar LoRA, a consistência é "alta", não perfeita; a folha aprovada e a conferência por visão são a defesa.

### 5.2 Prompt de hiper-realismo sem plastificar

Estrutura do prompt (montada no servidor, igual ao `promptDaTomada`):

1. **Tipo de foto e finalidade:** "fotografia real, retrato editorial para Instagram, sem retoque de beleza".
2. **Câmera e lente:** retrato 85 mm f/2 (fundo desfocado natural); meio corpo 50 mm; ambiente 35 mm; altura dos olhos; foco no olho mais próximo.
3. **Luz com direção e fonte:** "luz de janela lateral à esquerda, fim de tarde, sombra suave sob o queixo", nunca "iluminação perfeita".
4. **Pele e microdetalhe:** poros visíveis nas bochechas e nariz, penugem fina contra a luz, leve variação de tom (vermelhidão no nariz, olheira suave), pequenas assimetrias, linhas naturais dos lábios, fios soltos no cabelo, textura do tecido.
5. **Proibições explícitas:** sem filtro de beleza, sem pele de porcelana, sem HDR, sem nitidez exagerada, sem simetria perfeita, sem maquiagem pesada (salvo pedido), sem texto, sem marca d'água, sem logo que não seja do produto.
6. **Grão e cor:** "grão fino de filme, cor natural, balanço de branco coerente com a luz".
7. **Invariantes da persona e do produto** (da ficha e do kit), repetidas a cada chamada.

Evitar palavras que puxam o visual de estúdio polido: "perfeito", "impecável", "flawless", "8K", "ultra detalhado", "obra-prima". A OpenAI recomenda linguagem de fotografia e pedir textura real (poros, rugas, desgaste, imperfeições) e evitar termos de polimento.

### 5.3 Ética e marcação (regras duras da área Modelos)

- **Só adulto:** idade aparente mínima 21 na ficha (campo obrigatório); o servidor recusa ficha abaixo disso e o prompt sempre diz "adulto de N anos".
- **Nunca parecer pessoa real:** referência do dono que mostra pessoa real entra só como **estilo, pose, luz ou roupa** (papel `estilo_ref`/`pose_ref`), nunca como identidade. Identidade só vem de imagem gerada da própria persona ou de pessoa do cliente com autorização (regra do contrato). Nome de celebridade ou "parecido com" no pedido: o servidor recusa. A conferência por visão pergunta se a imagem lembra pessoa pública conhecida (aviso; o dono decide).
- **Sem sexualização, sem menor, sem imitar marca de terceiros.**
- **Marcada como gerada:** `gerada = true` em toda imagem; declaração ética gravada na persona (quem marcou e quando); nome fictício.
- **Procedência:** gravar os bytes originais do provedor (que trazem C2PA quando a OpenAI gera) e, na versão PNG re-codificada, escrever o campo IPTC `DigitalSourceType = trainedAlgorithmicMedia`. A Meta usa C2PA/IPTC para pôr "Informações de IA", e exige o rótulo em imagem fotorrealista em anúncio. A lei da UE (AI Act, art. 50) vale desde 2026-08-02 para conteúdo sintético realista mostrado a público europeu. No Brasil, a orientação é marcar ao publicar (rótulo de IA do Instagram).
- A tela "Usar" lembra: "Pessoa sintética. Ao publicar, ligue o rótulo de IA."

---

## 6. Banco (SQL em `docs/mesa-foto/migrations/02_modelos_canvas.sql`, a escrever; não aplicar sem o dono)

### 6.1 `foto_modelos` (personas)

| Coluna | Tipo | Nota |
| --- | --- | --- |
| id | uuid pk | |
| client_id | uuid null | null = persona da agência (reutilizável em qualquer cliente); preenchido = persona exclusiva do cliente |
| nome | text | nome fictício |
| ficha | jsonb | `{ idade_aparente int (>= 21), genero_apresentado, tom_de_pele, rosto, olhos, sobrancelhas, nariz, labios, cabelo {cor, comprimento, textura}, marcas[], corpo, estilo, notas }` |
| invariantes | text[] | o que nunca muda (vai em todo prompt) |
| status | text | `rascunho | candidatos | ancora | folha | pronta | arquivada` |
| ancora_imagem_id | uuid null | fk `foto_modelo_imagens` |
| motor_preferido_id | text null | id de `ia_modelos` |
| versao | int default 1 | sobe quando a âncora ou a folha aprovada muda |
| etica | jsonb | `{ sintetica: true, adulta: true, sem_semelhanca: true, marcado_por, marcado_em }` (obrigatório para sair de rascunho) |
| clientes_permitidos | uuid[] null | se persona da agência for restrita a alguns clientes |
| custo_usd | numeric | soma |
| criado_por, criado_em, atualizado_em | | |

### 6.2 `foto_modelo_imagens` (imagens da persona, fora de `cliente_imagens` porque a persona pode não ter cliente)

| Coluna | Tipo | Nota |
| --- | --- | --- |
| id | uuid pk | |
| modelo_id | uuid fk | |
| rodada_id | uuid null fk | |
| papel | text | `referencia_dono | candidata | ancora | vista | detalhe` |
| vista | text null | `frente | tres_quartos_esq | tres_quartos_dir | perfil_esq | perfil_dir | meio_corpo | corpo_inteiro | maos` |
| uso_da_referencia | text null | para `referencia_dono`: `estilo | pose | luz | roupa` (nunca identidade) |
| storage_bucket, storage_path | text | `mesa/modelos/<modelo_id>/...` |
| largura, altura, sha256 | | |
| motor_id, qualidade, resolucao, seed | | reprodutibilidade |
| prompt | text | |
| fontes | uuid[] | imagens usadas como referência, em ordem |
| derivada_de | uuid null | linhagem (detalhe 4K aponta para a origem) |
| conferencia | jsonb | leitura por visão + notas do Jev (aviso) |
| aprovada | boolean null | null = não decidida |
| versao_modelo | int | versão da persona em que entrou |
| custo_usd, uso_id, criado_por, criado_em | | |

### 6.3 `foto_modelo_rodadas`

`id, modelo_id, tipo ('candidatos' | 'folha' | 'detalhe'), pedido jsonb { prompt_extra, formato, qualidade, resolucao, referencias[] }, motores text[], cega boolean (esconder o nome do motor até escolher), status ('aberta' | 'escolhida' | 'descartada'), estimativa_usd, custo_usd, criado_por, criado_em`.

### 6.4 `foto_canvas`

| Coluna | Tipo | Nota |
| --- | --- | --- |
| id | uuid pk | |
| client_id | uuid | canvas é sempre de um cliente |
| nome | text | |
| nos | jsonb | lista `[{ id, tipo, x, y, dados }]` (seção 6.6) |
| ligacoes | jsonb | lista `[{ id, de, para, entrada, ordem }]` |
| viewport | jsonb | `{ x, y, zoom }` |
| versao | int | concorrência otimista (salvar manda `versao_esperada`; diferente = 409) |
| status | text | `ativo | arquivado` |
| criado_por, criado_em, atualizado_em | | |

### 6.5 `foto_canvas_geracoes`

`id, canvas_id, no_gerar_id text, motor_id, qualidade, resolucao, formato, compilado jsonb { referencias: [{ ordem, papel, origem: {tipo, id}, imagem_id }], prompt, avisos[] }, status ('gerando' | 'gerada' | 'falhou'), ultimo_erro, imagem_id (fk cliente_imagens), conferencia jsonb, custo_usd, uso_id, criado_por, criado_em`. A imagem gerada entra em `cliente_imagens` com `gerada = true`, `modo = 'canvas'`, `kit_id` do produto e a persona registrada em `tags` (`persona:<id>`), para servir às três mesas.

### 6.6 Nós e ligações (formato do jsonb)

Tipos de nó e `dados`:

- `produto`: `{ kit_id, refs_escolhidas?: uuid[] }` (padrão: identidade do kit por prioridade).
- `modelo`: `{ modelo_id, versao }` (só persona `pronta`, ou `ancora` com aviso "folha incompleta").
- `ambiente`: `{ imagem_id? , biblioteca_id?, texto? }` (foto de lugar ou descrição).
- `estilo`: `{ imagem_ids[]?, guia? }` (print de perfil, moodboard, biblioteca, guia de estilo da campanha).
- `camera`: `{ azimute, elevacao, enquadramento, lente }` (os presets que a Mesa Foto já tem).
- `texto`: `{ texto, papel: 'pedido' | 'restricao' }`.
- `gerar`: `{ motores: string[], formato, qualidade, resolucao, variacoes: 1 }`.
- `resultado`: `{ geracao_id }` (criado pelo servidor, ligado ao `gerar`).

Ligação: `{ de: no_id, para: no_gerar_id, entrada: 'produto' | 'pessoa' | 'ambiente' | 'estilo' | 'camera' | 'texto', ordem }`. O nó `gerar` tem uma alça por entrada; a ordem das ligações na mesma entrada é a prioridade.

### 6.7 Outras mudanças

- `cliente_imagens.modo` aceita também `'canvas'` e `'detalhe'`.
- `ia_modelos` ganha `capacidades jsonb`: `{ refs_max, resolucoes[], proporcoes[], qualidades[], fundo_transparente, seed, precos: [{ unidade, variante, usd }] }`, preenchido pela sincronização a partir de `/api/v1/images/models` e `/endpoints`.
- RLS igual às tabelas da Mesa Foto: equipe com `is_staff` e, quando houver `client_id`, `can_access_client`; persona da agência (client_id null) legível por toda a equipe; escrita só pela função (chave de serviço).

---

## 7. Canvas no navegador: avaliação e escolha

Restrições do painel (`vite.config.ts` com alvo `safari11, chrome64`; `src/polyfills.ts`): sem `aspect-ratio` no CSS, sem `:has`, ResizeObserver só pela versão mínima do polyfill (mede ao observar e no resize da janela), sem Pointer Events no Safari 11/12 (chegaram no Safari 13), sem regex moderna. O repo já tem React 18.3, Vite 5.4 (esbuild 0.21.5), `@dnd-kit/core`, `framer-motion`, Tailwind 3.

| Opção | Licença | Tamanho (min+gzip, medido com o esbuild do repo, alvo do painel) | Entrada de ponteiro | Safari 11 | Veredito |
| --- | --- | --- | --- | --- | --- |
| **@xyflow/react 12.12.0** (React Flow) | MIT | aprox. 62 KB (inclui zustand, classcat, d3-zoom, d3-drag, d3-selection) | Pan, zoom e arrastar nó por d3 (eventos de mouse e toque); conectar por `onMouseDown`/`onTouchStart` e `connectOnClick`; só a caixa de seleção do painel usa Pointer Events | Funciona com os polyfills já existentes (ResizeObserver mínimo, `structuredClone`); a caixa de seleção não funciona (desligar) | **Escolhido** |
| rete 2 + area/react/connection plugins | MIT | aprox. 25 KB + styled-components (dependência extra) | Pointer Events em toda a área (`pointerdown/move/up`) | Não funciona sem polyfill de Pointer Events | Descartado |
| @projectstorm/react-diagrams 7 | MIT | 4 pacotes, projeto pouco ativo | mouse | incerto | Descartado |
| reaflow 5 | Apache-2.0 | pesado (elkjs, motion, reablocks) | gestos | incerto | Descartado |
| Próprio (mouse + touch + SVG) | nosso | aprox. 8 a 15 KB | o que escrevermos | total controle | Plano B |

**Por que React Flow:** resolve pan, zoom com pinça, arrastar, conectar, minimapa e acessibilidade de teclado, é MIT, muito usado e carregado só na aba Canvas (`lazy(() => import(...))`, como `ModelosDeIa`). A implementação própria só compensa se o React Flow falhar no iPhone antigo real.

**Configuração obrigatória para o piso do painel:**

- `selectionOnDrag={false}`, `selectionKeyCode={null}`, `multiSelectionKeyCode={null}`: a caixa de seleção depende de Pointer Events.
- `connectOnClick` ligado (tocar na alça de saída e depois na de entrada): conexão por toque sem arrastar.
- `panOnDrag`, `zoomOnPinch`, `zoomOnScroll` ligados; `preventScrolling` ligado só dentro do quadro.
- **Nó com tamanho fixo** (largura e altura explícitas em px) e miniatura com `padding-top` percentual no lugar de `aspect-ratio`. O ResizeObserver mínimo não percebe mudança de tamanho depois de montar (ex.: imagem que carregou); onde o tamanho mudar, chamar `useUpdateNodeInternals(id)` no `onLoad` da imagem.
- Sem `NodeResizer`, sem `NodeToolbar` (não fazem falta).
- Importar `@xyflow/react/dist/style.css` só no chunk do Canvas; conferir o CSS (usa variáveis CSS, que o Safari 11 aceita; não usa `aspect-ratio`, `:has` nem `inset`).
- Paleta de cartões: **tocar para adicionar** (cria no centro da vista) em todo aparelho; arrastar da paleta para o quadro só no desktop, com eventos de mouse (o arrastar HTML5 não funciona no iOS 11).
- Celular pequeno (< 768 px): além do quadro, um **modo lista** que mostra o mesmo grafo como formulário vertical (entradas do "Gerar" em ordem), porque ligar linhas com o dedo em tela de 375 px é ruim.
- Teste manual obrigatório num iPhone com iOS 11/12 ou emulação real (BrowserStack), e no Chrome 64 do Android, antes de publicar.

Dependência nova: `@xyflow/react@12.12.0` (peer `react >=17`). Registrar no `config/chunk-strategy.ts` para ficar fora do chunk principal.

---

## 8. Ações do servidor

Onde: arquivos novos `supabase/functions/mesa-foto/modelos.ts` e `canvas.ts`, registrados no mapa `ACOES` de `index.ts` (o `index.ts` já tem 118 KB; não crescer mais nele). Todas com `respostaComFolego` quando usam IA. Toda geração é **uma chamada por imagem**; o lado a lado é o front disparando uma chamada por motor (até 3 em paralelo), para não estourar o tempo da função e para o que já saiu ficar salvo se o dono sair da tela.

### 8.1 Motor (`_shared/ia-motor.ts`)

- `EntradaImagem` ganha `resolucao?: '512' | '1K' | '2K' | '4K'` e `seed?: number`.
- Todo modelo de imagem do OpenRouter vai por `POST /api/v1/images` (o GPT Image já vai). Corpo: `model, prompt, input_references, aspect_ratio` (ou `size` quando o modelo aceita pixels), `resolution`, `quality`, `background`, `seed`, `n: 1`, só com os parâmetros que `capacidades` diz que o modelo aceita. Referências cortadas no `refs_max` do modelo, **em ordem de papel**, com aviso na resposta quando alguma ficou de fora.
- `limiteDeFontesDoMotor` lê `capacidades.refs_max`.
- `sincronizar_catalogo` passa a ler `/api/v1/images/models` e `/endpoints` e grava `capacidades` e `preco_imagem` por variante (1K, 2K, 4K, por megapixel). A estimativa usa a variante pedida.
- Tempo limite de imagem 4K: medir; se passar de 280 s, subir só para `resolucao: '4K'`.
- Guardar os bytes originais do provedor antes de re-codificar (procedência).

### 8.2 Modelos (personas)

| Ação | Entrada | Saída | IA |
| --- | --- | --- | --- |
| `modelo_salvar` | `{ modelo: { id?, client_id?, nome, ficha, invariantes }, etica? }` | `{ modelo }` | não. Valida idade >= 21, nome sem celebridade (lista simples + recusa de "parecido com") |
| `modelo_referencia_registrar` | `{ modelo_id, caminhos[], uso: 'estilo' | 'pose' | 'luz' | 'roupa' }` | `{ imagens }` | não |
| `modelo_ficha_sugerir` | `{ modelo_id, pedido?, referencia_ids[] }` | `{ ficha, invariantes, avisos }` | visão lê as referências e propõe uma ficha **original** (direção, não cópia do rosto); não grava |
| `modelo_rodada_criar` | `{ modelo_id, tipo: 'candidatos', motores[], formato, qualidade, resolucao, prompt_extra?, cega? }` | `{ rodada, estimativa_usd, por_motor: [{ motor_id, estimativa_usd, avisos }] }` | não (só estimativa) |
| `modelo_candidata_gerar` | `{ rodada_id, motor_id, seed? }` | `{ imagem, url, custo_usd, saldo_usd }` | 1 imagem. Prompt da seção 5.2 + ficha + referências só de estilo |
| `modelo_candidata_ler` | `{ imagem_id }` | `{ conferencia: { observado: { pele, olhos, maos, cabelo, dentes, luz, fundo, artefatos[] }, notas_jev: { realismo_pele, anatomia, luz_coerente, lembra_pessoa_publica }, alertas[] } }` | visão descreve; Jev dá Score sobre o texto (aviso) |
| `modelo_escolher` | `{ modelo_id, imagem_id }` | `{ modelo }` | não. Vira âncora, grava `motor_preferido_id`, `versao++`, status `ancora` |
| `modelo_vista_gerar` | `{ modelo_id, vista, motor_id?, seed? }` | `{ imagem }` | 1 imagem. Referências: âncora + vistas já aprovadas; invariantes repetidas |
| `modelo_imagem_decidir` | `{ imagem_id, decisao: 'aprovar' | 'rejeitar', motivo? }` | `{ imagem, modelo }` | não. Com frente + 2 vistas aprovadas, status `pronta` |
| `imagem_detalhar` | `{ origem: { tipo: 'modelo_imagem' | 'cliente_imagem', id }, caminho: 'regenerar_4k' | 'ampliar_fiel', motor_id?, resolucao }` | `{ imagem (derivada nova), custo_usd }` | `regenerar_4k`: 1 imagem pelo OpenRouter; `ampliar_fiel`: só se `FAL_KEY` existir, senão erro explícito `ampliador_sem_chave` (sem cair calado para o generativo) |
| `modelo_arquivar` | `{ modelo_id }` | `{ modelo }` | não |

Leitura (lista, detalhe, imagens) pela RLS direto do front, como o catálogo.

### 8.3 Canvas

| Ação | Entrada | Saída | IA |
| --- | --- | --- | --- |
| `canvas_salvar` | `{ canvas: { id?, client_id, nome, nos, ligacoes, viewport }, versao_esperada? }` | `{ canvas }` ou 409 `canvas_mudou` com a versão atual | não. Valida tipos, ids que existem e pertencem ao cliente (regra da casa: validar id contra o banco em toda escrita) |
| `canvas_compilar` | `{ canvas_id, no_gerar_id, motor_id }` | `{ referencias: [{ ordem, papel, origem, imagem_id }], prompt, estimativa_usd, avisos[] }` | não. Mostra ao dono exatamente o que vai para o gerador |
| `canvas_gerar` | `{ canvas_id, no_gerar_id, motor_id, qualidade?, resolucao?, seed? }` | `{ geracao, imagem, url, custo_usd, saldo_usd }` | 1 imagem por motor. Front dispara uma por motor ligado no nó |
| `canvas_conferir` | `{ geracao_id }` | `{ conferencia }` | visão compara com o produto (formato, cor, logo, proporção) e com a âncora da persona (rosto, cabelo, tom de pele); Jev como aviso |
| `canvas_decidir` | `{ geracao_id, decisao, motivo? }` | `{ imagem }` | não. Aprovar marca `aprovada = true` no acervo |
| `canvas_montar_do_pedido` | `{ client_id, texto }` | `{ nos, ligacoes, escolhas: [{ papel, escolhido, alternativas, confianca }] }` | Jev **Choice** escolhe, entre os kits, personas e ambientes que o código listou, qual o texto cita (com opção "nenhum"); o código monta o grafo. Ex.: "esse óculos com a Marina na praia" |

**Compilação (regra, em código, sem IA):**

1. Ordem das referências: produto (identidade, vista mais próxima da câmera primeiro; detalhe; embalagem só se pedido) → pessoa (âncora; depois a vista mais próxima do ângulo da câmera) → ambiente → estilo. Imagem de estilo nunca como identidade.
2. Orçamento por papel dentro do `refs_max` do motor. Exemplo com 8: produto 3, pessoa 3, ambiente 1, estilo 1. Com 16: produto 5, pessoa 5, ambiente 2, estilo 4. Com 3 (Grok): produto 1, pessoa 1, ambiente 1, e aviso.
3. Prompt com índice: "Imagem 1 a 3: o produto [nome do kit] (não mudar formato, cor, logo, proporção; invariantes do kit). Imagem 4 a 6: a pessoa [nome da persona] (mesma pessoa; invariantes da ficha). Imagem 7: o ambiente (usar lugar, luz e clima; não copiar pessoas da foto). Imagem 8: estilo (só paleta, luz e enquadramento)". Depois câmera, luz, proibições (seção 5.2) e o texto livre.
4. Bloqueios: sem produto e sem pessoa = recusa; persona com status `rascunho`/`candidatos` = recusa; pessoa do acervo sem autorização = recusa (regra do contrato).

---

## 9. Desenho das telas

Novas etapas na barra da Mesa Foto: **Modelos** (depois de Kits) e **Canvas** (depois de Ensaio/Campanha). Mesma casca, seletor de cliente, carteira e custo.

### 9.1 Modelos

- **Coluna esquerda:** lista de personas (cartão com a âncora, nome, status, "da agência" ou "do cliente"), filtro e botão "Nova persona".
- **Passo 1, Ficha:** campos curtos (idade aparente, tom de pele, cabelo, traços, marcas, estilo) + área de soltar referências com o seletor "usar como: estilo, pose, luz, roupa". Botão "Sugerir ficha pelas referências". Caixa obrigatória de ética (sintética, adulta, sem semelhança com pessoa real).
- **Passo 2, Rodada lado a lado:** chips dos motores com preço, total antes ("Gerar 4 candidatas, ~US$ 0,34"). Grade de colunas (2 no celular, 4 no desktop), cada uma com a candidata, andamento por motor e erro por motor sem derrubar as outras. Opção "comparação às cegas" (nome do motor aparece só depois de escolher). **Lupa sincronizada:** tocar num ponto do rosto mostra o mesmo recorte em 100% em todas as candidatas (é assim que se vê poro e plástico). Etiquetas da leitura por visão ("mãos ok", "pele lisa demais") como aviso. Botões por candidata: "Escolher como âncora", "Refazer neste motor" (variação real, seed nova).
- **Passo 3, Folha:** 6 espaços (frente, 3/4 esq, 3/4 dir, perfil, meio corpo, corpo inteiro), cada um com "Gerar" e aprovar/rejeitar; progresso "3 de 6 aprovadas, pronta para usar".
- **Passo 4, Detalhar:** antes e depois com cortina (mouse e toque), "Detalhar em 4K (~US$ 0,24)"; "Ampliar fiel" aparece desabilitado com a dica "precisa da conta fal.ai" enquanto não houver chave.
- **Persona pronta:** "Usar no Canvas", "Usar na Campanha", "Duplicar como variação" (nova persona a partir desta, para irmãos/estilos).

### 9.2 Canvas

- **Topo:** nome do canvas, lista de canvases do cliente, "Modelos prontos" (ex.: "Produto + pessoa + ambiente", "Produto flutuando no estilo da marca"), campo "Descreva o que quer" que chama `canvas_montar_do_pedido`.
- **Paleta à esquerda:** Produto, Modelo, Ambiente, Estilo, Câmera, Texto, Gerar. Tocar adiciona; cada cartão abre um seletor (kits do cliente, personas, acervo, biblioteca, presets).
- **Cartões:** tamanho fixo, miniatura, título, cor por papel (a mesma cor na alça e na linha). O "Gerar" mostra as entradas numeradas na ordem em que vão ao gerador, os motores ligados, formato, resolução e o botão com total ("Gerar em 3 motores, ~US$ 0,42"). "Ver o que vai para o gerador" abre o resultado de `canvas_compilar`.
- **Resultados:** saem como cartões ligados à direita do "Gerar", um por motor, com andamento; tocar abre o visualizador com conferência, aprovar, rejeitar, refazer, detalhar em 4K, usar na Mesa/Mesa Ads/Arquivos.
- **Salvar:** automático com atraso de 1,5 s, com `versao_esperada`; conflito mostra "o canvas mudou em outra aba, recarregar". Rascunho local em `localStorage` (com try/catch).
- **Celular:** o quadro funciona (arrastar com um dedo, pinça para zoom, conectar tocando), e há o botão "Modo lista".

Visual: igual à Mesa (títulos pequenos, cartões limpos, sem poluição), português claro, sem travessão.

---

## 10. Onde entra o Jev (TypeSafe) e onde não entra

O Jev lê texto e estado em JSON (não lê imagem). Por isso:

- **Realismo das candidatas:** a visão descreve cada imagem em campos objetivos; o Jev dá **Score** separado por dimensão (pele natural x plastificada, anatomia de mãos e olhos, coerência de luz e sombra, "lembra pessoa pública"), e o código soma com pesos que o dono ajusta. É só ordenação sugerida e alerta; o dono escolhe (regra de 24/09: sem laço, sem escolha automática).
- **Conferência de identidade** (persona e produto): Noul por critério ("o rosto descrito bate com a ficha?", "a cor da armação bate com o kit?"), como aviso.
- **Montar o canvas por frase:** Choice entre candidatos que o código listou (kits, personas, ambientes), com opção "nenhum".
- **Não usar Jev:** ordem das referências, orçamento por motor, preço, validação de idade, bloqueios. Isso é regra fixa em código.

Antes de escrever a integração, ler os docs vivos em https://docs.typesafe.ai/llms.txt (páginas Score, Noul, Choice e o padrão "composite scoring"). A chave `TYPESAFE_API_KEY` fica só no servidor.

---

## 11. Riscos

1. **Re-render 4K muda o rosto.** É geração nova, não ampliação. Mitigação: versão derivada, antes e depois, conferência contra a âncora, e ampliação fiel na fase 2.
2. **Deriva de identidade** entre fotos e entre motores (perfil, costas, acessórios). Mitigação: folha aprovada, motor preferido, invariantes repetidas, aviso ao trocar de motor.
3. **Semelhança com pessoa real** (acidental ou por referência). Mitigação: referência de pessoa real só como estilo, recusa de nomes, alerta da visão, decisão humana registrada.
4. **Preço mal estimado** enquanto o catálogo usar o cálculo por token para modelo cobrado por imagem ou megapixel (Seedream subestimado em cerca de 3 vezes). Corrigir a sincronização antes de ligar esses motores.
5. **Modelo só de imagem pelo chat** pode falhar ou ser recusado; ligar Seedream, FLUX.2, MAI etc. só depois de passar o motor para `/api/v1/images`.
6. **Memória da função com 4K:** decodificar PNG 4K (dezenas de MB) na função de borda pode estourar memória. Não re-codificar 4K; gravar os bytes como vieram e gerar miniatura no navegador ou pela transformação de imagem do Storage.
7. **Tempo:** rodada de 4 a 8 motores leva minutos; por isso uma chamada por imagem, com andamento, e o que saiu fica salvo.
8. **Safari 11 / Chrome 64:** React Flow sem caixa de seleção; tamanho de nó que muda depois de montar desalinha as linhas (polyfill mínimo de ResizeObserver). Mitigação da seção 7 e teste em aparelho real. Se falhar, plano B próprio.
9. **Ferramenta de build:** o esbuild 0.28 (versão atual) recusa transformar desestruturação para `safari11`; o repo está no Vite 5 com esbuild 0.21.5, que aceita. Não subir Vite/esbuild sem rever o alvo (vale para o painel inteiro, não só para o Canvas).
10. **Procedência perdida** na re-codificação (C2PA/IPTC). Mitigação: bytes originais guardados e IPTC `DigitalSourceType` na cópia PNG; lembrar o rótulo de IA ao publicar.
11. **Disponibilidade no OpenRouter** muda (Muse Image está sem provedor hoje). A sincronização desliga modelo sem endpoint; a rodada mostra erro por motor sem derrubar as outras.
12. **Custo acumulado** de rodadas: total sempre antes, carteira, e sugestão de rascunho barato (Nano Banana 2, MAI) antes do 2K/4K.

---

## 12. Ordem sugerida de implementação

1. Motor: `/api/v1/images` para todos, `resolucao`, `seed`, `capacidades` e preço por variante na sincronização; testes.
2. Banco (migration 02) validada com begin/rollback; aplicar só com o dono.
3. Modelos: ficha, rodada lado a lado, escolher âncora, folha, detalhar 4K (sem chave nova).
4. Canvas: React Flow com a configuração da seção 7, salvar, compilar, gerar lado a lado, conferir, decidir; modo lista no celular.
5. Jev como aviso na rodada e na conferência; `canvas_montar_do_pedido`.
6. Fase 2 (se o dono cadastrar a fal.ai): "Ampliar fiel".

---

## 13. O que depende do dono

- **Nada novo para a fase 1:** tudo sai pelo OpenRouter que ele já paga (manter crédito; rodada de 4 motores por volta de US$ 0,35; 4K de pessoa US$ 0,24).
- **Ampliação fiel:** criar conta na **fal.ai** (ou Replicate), pôr cartão e salvar a chave como segredo `FAL_KEY` no Supabase. Sem isso, só existe o "Detalhar em 4K" generativo.
- **Decisões:** personas da agência (reutilizáveis em qualquer cliente) ou só por cliente; idade aparente mínima (proposta: 21); quais motores ligar por padrão na rodada; aplicar a migration 02 e publicar a função.

---

## Fontes consultadas

- OpenRouter, lista de modelos de imagem e capacidades: https://openrouter.ai/api/v1/images/models e `.../images/models/{id}/endpoints` (consultados em 2026-09-24); https://openrouter.ai/api/v1/models?output_modalities=image
- OpenRouter, guia de geração de imagem: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- OpenRouter, página do Krea 2 Large: https://openrouter.ai/krea/krea-2-large
- Google, preços do Gemini (Nano Banana Pro e 2): https://ai.google.dev/gemini-api/docs/pricing
- Google, geração de imagem (referências de objeto e de personagem, `image_size`, SynthID): https://ai.google.dev/gemini-api/docs/image-generation
- OpenAI, GPT Image 2.5 Sunburst: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
- OpenAI, guia de prompt para modelos de imagem: https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide
- Kanaries, GPT Image 2.5 Flare x Sunburst e custo por qualidade: https://docs.kanaries.net/articles/gpt-image-2-5
- Artificial Analysis, ranking texto para imagem: https://artificialanalysis.ai/image/leaderboard/text-to-image
- Artificial Analysis, ranking de edição: https://artificialanalysis.ai/image/leaderboard/editing
- VibeDex, ranking de retratos 2026: https://vibedex.ai/blog/best-ai-image-generator-portraits-2026
- CreateVision, Seedream 5 x Nano Banana 2 x GPT Image 2: https://createvision.ai/guides/seedream-5-vs-nano-banana-2-vs-gpt-image-2
- fal.ai, 10 upscalers de imagem (preços e endpoints): https://fal.ai/learn/tools/image-to-image-upscalers
- fal.ai, Crystal Upscaler: https://fal.ai/models/clarityai/crystal-upscaler
- Replicate, coleção de super-resolução: https://replicate.com/collections/super-resolution
- Flick, 5 métodos de consistência de personagem: https://flick.art/blog/img2img-consistent-character
- AI Act, artigo 50 (transparência, desde 2026-08-02): https://artificialintelligenceact.eu/transparency-rules-article-50/
- Meta, rotulagem de conteúdo gerado por IA: https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/ e https://coinis.com/blog/meta-ai-content-labeling-facebook-instagram-ads-2026
- React Flow (xyflow): pacote `@xyflow/react@12.12.0` e `@xyflow/system@0.0.83` baixados do npm e inspecionados (uso de ResizeObserver, Pointer Events, d3-zoom/d3-drag com mouse e toque); rete 2 e plugins inspecionados (Pointer Events); tamanhos medidos com o esbuild 0.21.5 do repo.
- TypeSafe: https://docs.typesafe.ai/llms.txt e https://docs.typesafe.ai/patterns/composite-scoring.md
