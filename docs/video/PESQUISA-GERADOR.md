# Pesquisa do gerador de vídeo (setembro de 2026)

Frente V-A, conferido em 26/09/2026 nas páginas públicas dos provedores (sem chamada paga).
Resumo próprio; os números vão para o catálogo em código
(`supabase/functions/mesa-videos/modulos/modelos-de-video.ts`, com fonte e data em cada motor).
Legenda: **C** = conferido na página do provedor; **T** = só em fonte de terceiro ou página que
diverge (no catálogo fica `incerto: true` e a tela mostra "~").

## 1. O que mudou e pesa na decisão

- **Seedance 2.5 existe** (ByteDance, anunciado em junho, liberado em julho de 2026) e já está no
  fal em três rotas: texto, imagem e referência (`bytedance/seedance-2.5/...`). Faz até 30 s por
  chamada e aceita dezenas de referências; a extensão é a própria rota de referência com
  `task: "extension"`. Preço por tokens de vídeo: cerca de US$ 0,22/s em 480p e 0,47/s em 720p,
  com áudio incluso (C). [fal](https://fal.ai/models/bytedance/seedance-2.5/image-to-video) ·
  [anúncio](https://technode.com/2026/07/31/bytedance-launches-seedance-2-5-video-generation-model/)
- **A API do Sora 2 foi encerrada em 24/09/2026** (a OpenAI avisou em março). Fica no catálogo
  como "encerrado". [OpenAI](https://developers.openai.com/api/docs/deprecations)
- **Novos de 2026** que entraram no catálogo: Wan 3.0, MiniMax H3 Max e H3 Max Turbo, Kling 3.0 e
  O3 (Omni), Veo 3.1 Lite, Gemini Omni Flash 1.1, HappyHorse 1.0, FLUX 3 vídeo, Grok Imagine 1.5,
  PixVerse C1 e LTX-2.3.
- **Fila do fal (REST)**: enviar com `POST https://queue.fal.run/<endpoint>` e `Authorization: Key`,
  receber `request_id`, `status_url` e `response_url`; consultar o status (`IN_QUEUE`,
  `IN_PROGRESS`, `COMPLETED`) e buscar o resultado, quase sempre `{ video: { url } }`. Usar as URLs
  que voltam (endpoint com subcaminho monta a URL de status diferente) (C).
  [docs](https://fal.ai/docs/documentation/model-apis/inference/queue)
- **Lista pública de modelos do fal**: `GET https://api.fal.ai/v1/models` com `category`, `status`,
  `cursor` e `limit`; cada item traz `endpoint_id` e `metadata.status` (`active` ou `deprecated`).
  Não há rota pública de preço documentada: preço novo precisa de conferência humana (C).
  [docs](https://fal.ai/docs/platform-apis/v1/models)

## 2. Motores de vídeo (preço por segundo, fal, salvo nota)

| Motor | Rotas | Preço | Durações | Quadro inicial / final | Referências | Extensão | Áudio |
|---|---|---|---|---|---|---|---|
| Seedance 2.5 (Top) | texto, imagem, referência | 480p 0,22 · 720p 0,47 (C) | 4 a 30 s | sim / sim | até ~50 no total | sim (task extension) | nativo |
| Seedance 2.0 Fast | imagem, referência | 720p 0,24 (T) | 4 a 15 s | sim / sim | 9 imagens | não | sim |
| Kling 3.0 Pro (Top) | texto, imagem | 0,112 sem áudio · 0,168 com (T: páginas divergem) | 3 a 15 s | sim / sim | elements, até 4 | não | sim |
| Kling O3 Standard | texto, imagem, referência, vídeo-para-vídeo | 0,084 · 0,112 com áudio (C) | 3 a 15 s | sim / sim | elements, até 4 | próximo plano com continuidade | sim |
| Kling 2.6 Pro | imagem | 0,07 · 0,14 com áudio (C) | 5 ou 10 s | sim / sim | não | não | sim |
| Veo 3.1 (Top) | texto, imagem, primeiro+último, referência, extensão | 0,20 · 0,40 com áudio (C) | 4, 6, 8 s | sim / sim | 3 | sim (até 8 s) | nativo, fala em PT |
| Veo 3.1 Fast | texto, imagem, primeiro+último | 0,10 · 0,15 com áudio (C) | 4, 6, 8 s | sim / sim | não | não | sim |
| Veo 3.1 Lite (Rápido) | texto, imagem, primeiro+último | 720p 0,03 · 0,05 com áudio (C) | 4, 6, 8 s | sim / sim | não | não | opcional |
| Gemini Omni Flash 1.1 | texto, imagem, referência | 360p 0,03 · 720p 0,10 · 1080p 0,15 (C) | 8 s | sim / sim | 3 imagens | não no fal | sempre ligado |
| Wan 3.0 (Top) | texto, imagem, referência | 480p 0,05 · 720p 0,10 · 1080p 0,20 (C) | 2 a 30 s | sim / sim | até 10 imagens | não | sim |
| MiniMax H3 Max (Top) | texto, imagem, extensão | 768p 0,08 · 1080p 0,16 (C) | até 15 s | sim / sim | (não usado) | sim | estéreo |
| H3 Max Turbo (Rápido) | texto, imagem | 480p 0,025 · 768p 0,04 · 1080p 0,08 (C) | até 15 s | sim / sim | não | não | sim |
| Hailuo 2.3 Pro | imagem | ~0,49 por vídeo (T) | 6 ou 10 s | sim / não | não | não | não |
| HappyHorse 1.0 | texto, imagem | 720p 0,14 · 1080p 0,28 (C) | 3 a 15 s | sim / ? | ? | ? | sem PT no lip sync |
| FLUX 3 vídeo | imagem, quadros-chave, extensão | 720p 0,17 · 1080p 0,29 (C) | 5 a 20 s | sim / sim (quadros-chave) | não | sim | sim |
| Grok Imagine 1.5 | imagem, extensão (v1) | 480p 0,08 · 720p 0,14 · 1080p 0,25; +0,01 por referência (C) | até ~15 s | sim / ? | 1 a 7 | sim | sim |
| PixVerse C1 | texto, imagem | 720p 0,05 · 0,065 com áudio (C) | 1 a 15 s | sim / ? | não | ? | opcional |
| LTX-2.3 Pro / Fast | texto, imagem, extensão | 1080p 0,06 / Fast 0,04 (C); extensão 0,10 | 6 a 20 s (pares) | sim / sim | não | sim | sim |
| Hunyuan 1.5 | texto, imagem | ~0,075 (T) | ~5 s, 480p | sim / não | não | não | não |
| Runway Gen-4.5 | API da Runway (seção 9.1, executor próprio) | 0,12 (C, créditos a US$ 0,01) | 2 a 10 s | sim / só primeiro | não | não | não |
| Runway Gen-4 Turbo | API da Runway (seção 9.1) | 0,05 (C) | 2 a 10 s | só primeiro | não | não | não |
| Higgsfield Cinema Studio 4.0 | API da Higgsfield (seção 9.2, executor próprio) | ~0,2057 (promocional) | 4 a 30 s | imagem como referência | até 30 | não | sim |
| HeyGen Avatar IV | API da HeyGen (seção 9.3): roteiro vira pessoa falando | ~0,05 foto / ~0,0667 estoque | pela fala | foto ou avatar | não | não | voz |
| Sora 2 | **encerrado** | | | | | | |

Fontes principais: páginas `https://fal.ai/models/<endpoint>` de cada linha acima (link em cada
motor do catálogo), [preços da Runway](https://docs.dev.runwayml.com/guides/pricing/),
[preços do Gemini](https://ai.google.dev/gemini-api/docs/pricing),
[blog da Higgsfield](https://higgsfield.ai/blog/higgsfield-api).

**Pontos em aberto** (conferir numa chamada de teste antes de confiar no valor): preço do Kling
3.0 Pro (duas páginas do fal com valores diferentes), H3 Max em 480p (0,025 ou 0,05), Seedance
2.5 em 1080p (o esquema aceita; a página de preço só fala de 480p e 720p), preço da extensão do
Veo, do H3 Max e do FLUX 3 (o catálogo usa o preço por segundo do próprio motor como estimativa).

## 3. Troca de ângulo de câmera (mesma pessoa, outro ponto de vista)

| Motor | Rota | Preço | Controle |
|---|---|---|---|
| **Qwen Image Edit 2511 Multiple Angles** (Top) | `fal-ai/qwen-image-edit-2511-multiple-angles` | US$ 0,035 por megapixel (C) | `horizontal_angle` 0 a 360 (0 frente, 90 direita, 180 costas, 270 esquerda), `vertical_angle` -30 a 90, `zoom` 0 a 10; LoRA aberta (Apache 2.0) treinada em 96 poses |
| FLUX 2 Multiple Angles | `fal-ai/flux-2-lora-gallery/multiple-angles` | US$ 0,021 por megapixel (C) | azimute 0 a 360, elevação 0 a 60, zoom 0 a 10 (nomes dos campos a conferir) |
| Qwen Edit 2509 LoRA gallery | `fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles` | ? | girar, aproximar, vertical |
| Nano Banana 2 edit, Seedream 5 edit | edição pelo texto | ~0,07 a 0,08 por imagem (T) | sem parâmetro de câmera |
| H3 Max Camera Controls | `minimax/h3-max/camera-controls` | ? | vídeo com a câmera em quadros-chave e o mundo parado; dá para tirar o último quadro como foto |

Kling não expõe controle de câmera por parâmetro na API (só pelo texto do prompt). A Higgsfield
expõe, no Cinema Studio 4.0, 33 movimentos prontos por parâmetro (`camera_movement`, seção 9.2):
a ferramenta Ângulo usa esses movimentos quando a Higgsfield é escolhida (vídeo, não imagem).
[Qwen 2511 no fal](https://fal.ai/models/fal-ai/qwen-image-edit-2511-multiple-angles/api) ·
[LoRA aberta](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA)

## 4. Tempo real e prévia rápida

| Opção | Como funciona | Preço | Uso aqui |
|---|---|---|---|
| **H3 Max Turbo** (fila) | 5 s em 768p em cerca de 1,6 s no teste publicado pelo fal | 0,04/s em 768p | **motor "Rápido"**: prévia antes do motor caro. Já no catálogo. |
| Veo 3.1 Lite, LTX-2.3 Fast | fila normal, baratos | 0,03 a 0,04/s | também no nível Rápido |
| Seedance 2.5 `draft` | rascunho em 480p que depois é concluído pelo `draft_id` (7 dias) | tarifa 480p | encaixe pronto no dialeto (campo `draft` a ligar) |
| H3 Max Director (e o Krea Realtime Director) | sessão **WebRTC**, 24 fps, blocos de 10 s, roteiro por segundo | 0,08/s, mínimo US$ 1,20 por sessão (C) | a função só abriria a sessão; quem assiste o stream é o navegador. Documentado, **não ligado**: pede um componente de WebRTC e cobrança por sessão. |
| Decart Lucy 2.5 realtime | WebRTC, só vídeo para vídeo (edita um stream que já existe) | 0,02/s (C) | não gera do zero; fica de fora |
| Odyssey-2 Pro | API própria experimental, 720p a 22 fps | preço não publicado (T) | fora |
| Krea Realtime 14B | pesos abertos, WebSocket de demonstração | ? | referência técnica |

Conclusão: o "gera enquanto conversa" viável hoje por servidor é o **nível Rápido na fila**
(H3 Max Turbo, Veo Lite, LTX Fast): em segundos, centavos por clipe, pela mesma cobrança. A sessão
ao vivo (H3 Max Director) fica documentada com o encaixe: um motor da família "tempo real" com
`sessao_abrir` no servidor (chave só lá) e o player WebRTC na tela.
[artigo do fal](https://fal.ai/learn/tools/fastest-ai-video-generation-models) ·
[H3 Max Director](https://fal.ai/models/minimax/h3-max/director) · [Decart no fal](https://fal.ai/explore/decart)

## 5. Continuar e emendar

- Extensão nativa: Veo 3.1 (`extend-video`, vídeo de até 8 s), H3 Max (`extend-video`, com
  `output: continuation`), LTX-2.3 (`extend-video`, a US$ 0,10/s), FLUX 3 (`extend-video`), Grok
  (`extend-video`, a partir do último quadro), Seedance 2.5 (`task: extension`), Kling O3
  (próximo plano com continuidade). Kling 3.0, Wan 3.0 e Runway: sem extensão.
- Sem extensão: último quadro do vídeo (tirado no navegador) como primeiro quadro do próximo.
- Transição A para B: primeiro quadro = último de A e último quadro = primeiro de B, num motor
  com primeiro e último quadro (Kling 2.6, Veo, Wan 3.0, LTX, FLUX 3 quadros-chave).
- No fal também existe `fal-ai/ffmpeg-api/extract-frame` (primeiro, meio ou último quadro) caso
  a extração precise ir para o servidor.

## 6. Consistência de personagem e cenário (o que o diretor aplica)

1. **Folha do personagem**: frente, 3/4, perfil e costas a partir de uma foto, com a troca de
   ângulo; depois a folha entra como referência (Kling elements, Seedance `@Image1`, Wan
   "Image 1", Veo até 3 referências).
2. **Quadro âncora por cenário** e encadeamento: o último quadro do plano vira o primeiro do
   próximo; primeiro e último quadro fecham o corte.
3. **Referência por elemento** fixa aparência (e voz, no Kling 3.0) em vários planos.
4. **Vários planos numa geração** (Kling `multi_prompt`, Seedance 2.5 e Wan 3.0 com até 30 s)
   evitam deriva entre chamadas.
5. **Mesma semente, mesmas palavras** para lente, luz e paleta em todos os prompts; o sujeito
   descrito sempre com o mesmo trecho no começo.
6. **Rascunho barato antes** (nível Rápido) e só depois o motor Top.

Fontes: [Veo 3.1 ingredients](https://blog.google/innovation-and-ai/technology/ai/veo-3-1-ingredients-to-video/) ·
[guia de prompts do Veo 3.1](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1) ·
[Kling 3.0 subject binding](https://kling.ai/blog/kling-3-subject-binding-character-consistency) ·
[guia do Kling 3.0 Omni](https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide) ·
[guia do fal para o Kling 3.0](https://blog.fal.ai/kling-3-0-prompting-guide/) ·
[Runway Gen-4 References](https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References) ·
[como usar a Seedance 2.0](https://fal.ai/learn/tools/how-to-use-seedance-2-0)

## 7. Repositórios abertos úteis

- [fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA): a LoRA de ângulos, com workflow do ComfyUI.
- [Comfy-Org/workflow_templates, Wan VACE primeiro e último quadro](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_wan_vace_flf2v.json) e o [Wan 2.2 14B FLF2V](https://comfy.org/workflows/video_wan2_2_14B_flf2v-7016f027bcf1/): transição entre dois quadros localmente.
- [Wan-AI/Wan2.1-VACE-14B](https://huggingface.co/Wan-AI/Wan2.1-VACE-14B): edição, pose e referência com pesos abertos.
- [krea-ai/realtime-video](https://github.com/krea-ai/realtime-video) e [fal-ai-community/realtime-krea-wan](https://github.com/fal-ai-community/realtime-krea-wan): vídeo em tempo real por WebSocket.
- [rishidandu/cutagent](https://github.com/rishidandu/cutagent) (MIT): editor que começa pelo storyboard (Next.js, Supabase, fal), cada cena no modelo mais adequado; boa referência de arquitetura.
- [Anil-matcha/Open-AI-Micro-Drama-Generator](https://github.com/Anil-matcha/Open-AI-Micro-Drama-Generator): roteiro, storyboard, quadros e vídeo com retratos de referência.
- [SainathPattipati/ai-video-generation-pipeline](https://github.com/SainathPattipati/ai-video-generation-pipeline): roteiro, storyboard e personagens consistentes.

## 8. Custos por kit (estimativa do código, 1 variação, resolução padrão)

Calculado por `custoDoMotor` com o motor que o papel de cada cena escolhe hoje
(`motorDoPapel`); a tela do Kit mostra o valor atual (muda sozinho quando um motor novo vira Top).
Valores de 26/09/2026, sem áudio (com fala no Veo, o plano dobra):

| Kit | Cenas | Vídeo | Custo estimado |
|---|---|---|---|
| Móveis planejados: construir e revelar | 5 | 20 s | US$ 6,18 |
| Antes e depois | 5 | 18 s | US$ 4,38 |
| UGC | 4 | 17 s | US$ 5,86 |
| Produto: still e packshot | 4 | 9 s | US$ 4,26 + 2 imagens do modelo do painel |
| Imobiliário: tour | 5 | 21 s | US$ 6,55 |
| Gastronomia | 4 | 15 s | US$ 4,38 |
| Estética e clínica | 4 | 16 s | US$ 6,48 |
| Automotivo | 4 | 17 s | US$ 4,54 |
| Esporte e futebol | 3 | 12 s | US$ 2,60 |
| Filme curto com personagem | 5 | 24 s | US$ 11,35 |
| Jardinagem e paisagismo | 3 | 12 s | US$ 2,39 |
| Jurídico | 3 | 13 s | US$ 3,24 |
| Informática e assistência técnica | 3 | 11 s | US$ 0,86 |
| Games e keys | 3 | 11 s | US$ 2,84 |
| Moda: lookbook | 3 | 12 s | US$ 5,68 |

O que mais pesa é o Seedance 2.5 no papel "hero" e "consistência" (US$ 0,47/s em 720p). Trocar o
nível do plano para Normal (Wan 3.0 a 0,10/s, Kling O3 a 0,084/s) corta o custo em 3 a 5 vezes;
o rascunho no nível Rápido custa centavos.

## 9. Runway, Higgsfield e HeyGen (frente V-C, 26/09/2026)

Pedido do dono: "vamos integrar o Higgsfield e o Runway, e o HeyGen também". Conferido nas docs
oficiais em 26/09/2026, sem chamada paga. Resumo próprio; os números estão no catálogo em código
com fonte e data. Os três ficam como **escolha manual**: aparecem nas listas de motor, mas nunca
viram a sugestão automática de um nível ou papel (o que já estava pronto no fal continua igual).

### 9.1 Runway (API de desenvolvedor)

- **Acesso**: `https://api.dev.runwayml.com/v1/...`, cabeçalhos `Authorization: Bearer <chave>` e
  `X-Runway-Version: 2024-11-06` (obrigatório). Segredo na função: **`RUNWAYML_API_SECRET`** (o nome
  que o SDK oficial lê). A chave sai do portal de desenvolvedor (dev.runwayml.com), que é conta
  separada do app da Runway. Primeira compra mínima de US$ 10 em créditos.
- **Modelos de vídeo hoje**: `gen4.5` (texto e imagem, 2 a 10 s, só o primeiro quadro, sem áudio),
  `gen4_turbo` (só imagem, 2 a 10 s), `veo3.1` e `veo3.1_fast` (primeiro e último quadro, áudio),
  `aleph2` (vídeo para vídeo: edita um vídeo de 2 a 30 s com texto e quadros-chave), `act_two`
  (atuação: um vídeo de referência move o personagem de uma imagem), `seedance2`, `seedance2_5` e
  outros de terceiros. `gen4_aleph` e `gen3a_turbo` saíram em 30/07/2026.
- **Proporções** (largura:altura): imagem para vídeo `720:1280`, `1280:720`, `960:960`, `832:1104`,
  `1104:832`, `1584:672`; o texto para vídeo do Gen-4.5 só `720:1280` e `1280:720`.
- **Preço**: 1 crédito = US$ 0,01. Gen-4.5 12 créditos/s (US$ 0,12/s), Gen-4 Turbo 5/s, Act-Two
  5/s, Veo 3.1 20/s sem áudio e 40/s com, Aleph 2 28/s (mínimo 56 por geração), Seedance 2.5 de
  20 a 68/s conforme a resolução.
- **Tarefa**: o envio devolve `{ id }`; `GET /v1/tasks/{id}` diz `PENDING`, `THROTTLED` (na fila da
  conta), `RUNNING` (com `progress`), `SUCCEEDED` (`output[]`), `FAILED` (`failureCode`) ou
  `CANCELLED`; `DELETE /v1/tasks/{id}` cancela (ou apaga a que já terminou). Consulta no máximo a
  cada 5 s (a mesa usa 15 s). O link do vídeo vence em 24 a 48 h: a mesa busca a tarefa de novo e
  guarda no Storage na hora.
- **Entrada**: URL HTTPS com resposta a HEAD, `Content-Type` e `Content-Length` certos, sem
  redirecionamento, em até 10 s; imagem até 16 MB por URL (5 MB por data URI), JPEG, PNG ou WebP,
  proporção entre 0,5 e 2. A mesa manda o link assinado do Storage (uma hora).
- **Erros**: 400 com `issues`, 401, 429 (limite de gerações ao mesmo tempo ou do dia), 5xx.
  Falta de crédito não tem código documentado (a mesa reconhece 402, 412 ou "credit" no texto).
  Falha de moderação (`SAFETY.*`) **é cobrada pela Runway** e não é reembolsada; o cliente não paga
  (a carteira só cobra vídeo pronto). Tier 1 da conta: 1 geração por vez e 50 por dia.
- Fontes: [OpenAPI](https://docs.dev.runwayml.com/openapi.json),
  [modelos](https://docs.dev.runwayml.com/guides/models/),
  [preços](https://docs.dev.runwayml.com/guides/pricing/),
  [entradas](https://docs.dev.runwayml.com/assets/inputs/),
  [saídas](https://docs.dev.runwayml.com/assets/outputs/),
  [falhas](https://docs.dev.runwayml.com/errors/task-failures/),
  [limites por tier](https://docs.dev.runwayml.com/usage/tiers/),
  [mudanças](https://docs.dev.runwayml.com/api-details/api_changelog/).

### 9.2 Higgsfield

- **Acesso**: API atual em `https://api.higgsfield.ai` (por `request_id`), cabeçalho
  `Authorization: Key <id da chave>:<segredo da chave>`: a chave é um **par**. Segredos na função:
  **`HIGGSFIELD_API_KEY`** (o id) e **`HIGGSFIELD_API_SECRET`** (o segredo). Nas docs os exemplos
  usam `HF_API_KEY_ID` e `HF_API_KEY_SECRET`, e o SDK Python lê `HF_API_KEY` e `HF_API_SECRET`: na
  mesa valem os dois nomes acima. O par sai do console (console.higgsfield.ai).
- **Câmera**: o DoP com a lista `/v1/motions` (ids por conta) ficou só na API v1 antiga. Na API
  atual o controle de câmera por parâmetro é o **Cinema Studio 4.0**
  (`POST /higgsfield/cinema-studio/4.0`): `camera_movement` com 33 movimentos (dolly in e out,
  dolly zoom, zoom brusco, grua, tilt, pedestal, pan, whip pan, arco, lateral, slider, tracking,
  órbita de drone, afastar pelo alto, helicóptero, bullet time, snorricam, braço robótico, troca de
  foco, POV, na mão, parada), duração de 4 a 30 s, 480p ou 720p, proporções 16:9, 4:3, 1:1, 3:4,
  9:16 e 21:9, áudio ligado por padrão e `image_urls` (até 30) como **referência**, não como quadro
  exato.
- **Soul** (imagem, `POST /higgsfield-ai/soul/standard`, com personagem treinado pelo Soul ID) e
  **Speak/lipsync** (só na v1 antiga) não entram agora.
- **Assíncrono**: o envio devolve `{ status: "queued", request_id, status_url, cancel_url }`;
  `GET /requests/{id}/status` diz `queued`, `in_progress`, `completed` (`video.url`), `failed`,
  `nsfw` ou `canceled`; `POST /requests/{id}/cancel` só cancela na fila (202; 400 quando já começou).
  Há webhook (`?hf_webhook=`), não usado (a mesa consulta quando a tela pede). Saída guardada por 7 dias.
- **Preço**: cerca de US$ 0,0625 por crédito; Cinema Studio 4.0 a US$ 0,2057/s no console
  (preço promocional, muda). Falha e `nsfw` não são cobrados. Existe `POST /estimate/{modelo}` que
  devolve créditos e dólares (não usado; o catálogo marca o preço como estimado, "~").
- **Erros**: 400 (e "concurrent": no máximo 4 pedidos ao mesmo tempo), 401, **403 = sem crédito**,
  404, 422, 423 (modelo bloqueado por um tempo), 503. Não há 402, 429 nem chave de idempotência:
  reenviar depois de um prazo vencido pode cobrar duas vezes (a mesa nunca reenvia sozinha).
- Fontes: [autenticação](https://docs.higgsfield.ai/docs/authentication),
  [pedidos](https://docs.higgsfield.ai/docs/concepts/requests),
  [Cinema Studio 4.0](https://docs.higgsfield.ai/docs/models/cinema-studio-4/generate),
  [modelos](https://docs.higgsfield.ai/docs/models),
  [cobrança](https://docs.higgsfield.ai/docs/concepts/billing-and-retention),
  [erros](https://docs.higgsfield.ai/docs/concepts/errors),
  [console](https://console.higgsfield.ai/explore),
  [SDK v1 antigo](https://github.com/higgsfield-ai/higgsfield-js).

### 9.3 HeyGen (avatar falando)

- **Versão**: usar a **v3**. A v1 e a v2 saem do ar em 31/10/2026.
- **Acesso**: `https://api.heygen.com`, cabeçalho `X-Api-Key`. Segredo na função:
  **`HEYGEN_API_KEY`** (o mesmo nome das docs). A chave sai de app.heygen.com, em Settings, API.
  Escopos: `videos:write`, `videos:read`, `avatars:read` e `voices:read`.
- **Gerar**: `POST /v3/videos` com `type: "avatar"` (`avatar_id` = id do "look", `script`,
  `voice_id`, `voice_settings { speed, locale }`, `engine { type: "avatar_iv" }`) ou
  `type: "image"` (uma foto por URL vira a pessoa falando, sem criar avatar). `resolution` 720p ou
  1080p (4K suspenso), `aspect_ratio` 9:16, 16:9, 1:1, 4:5 ou 5:4, `caption { file_format: "srt",
  style }` grava a legenda no vídeo (o `.srt` volta sempre). Aceita `Idempotency-Key`. Não há modo de
  teste: toda chamada gasta.
- **Listas grátis**: `GET /v3/avatars/looks?avatar_type=studio_avatar&ownership=public` e
  `GET /v3/voices?type=public&language=Portuguese` (o filtro por `pt-BR` não está confirmado: a mesa
  lista português e põe as vozes do Brasil primeiro).
- **Status**: `GET /v3/videos/{id}` diz `pending`, `processing`, `completed` ou `failed` (e
  `waiting` logo depois do envio), com `video_url`, `captioned_video_url`, `thumbnail_url`,
  `duration`, `failure_code` e `failure_message`. Os links são assinados e vencem: a mesa guarda no
  Storage. **Sem cancelar** pela API (`DELETE /v3/videos/{id}` apaga e a doc não diz se para a geração).
- **Preço**: pagamento por uso em dólar (mínimo US$ 5, créditos valem 12 meses, 10 vídeos ao mesmo
  tempo, sem crédito grátis desde fevereiro de 2026). Tabela oficial (Enterprise, 1 crédito =
  US$ 0,50): Avatar IV 0,1 crédito/s = **US$ 0,05/s (cerca de US$ 3 por minuto)**. Fonte de terceiro
  para o plano sem contrato: foto que fala US$ 0,05/s; avatar de estoque ou gêmeo digital
  US$ 0,0667/s em 1080p. O catálogo usa 0,05 (foto) e 0,0667 (estoque), marcados "~", e **cobra pela
  duração real do vídeo, nunca mais que o valor confirmado**.
- **Limites**: roteiro até 5.000 letras por cena (a mesa limita a 3.000 para o custo caber na
  confirmação), 25 quadros por segundo.
- **Pessoa real**: gêmeo digital pede consentimento gravado pela própria API
  (`POST /v3/avatars/{grupo}/consent`); a foto que fala não tem esse passo, mas a política da HeyGen
  exige o consentimento explícito da pessoa retratada e ela pode pedir a remoção a qualquer momento.
  Na mesa, **a foto só vem de um clone da Mesa Foto com a autorização de imagem válida** (confirmada,
  sem revogação, dentro da validade, pessoa adulta e ciente de que é IA) e com a confirmação, no
  clique, de que a autorização cobre vídeo com voz gerada por IA. Sem isso: bloqueado com o motivo.
- **Erros** (`{ error: { code, message } }`): 401 `unauthorized`; 402 `insufficient_credit`; 403
  escopo da chave; 400 `content_policy_violation`, `avatar_not_usable`, `voice_unavailable`,
  `download_failed`; 409 pedido igual em andamento; 429 `rate_limit_exceeded`.
- Fontes: [criar vídeo](https://developers.heygen.com/reference/create-video),
  [status](https://developers.heygen.com/reference/get-video),
  [foto para vídeo](https://developers.heygen.com/image-to-video),
  [looks](https://developers.heygen.com/reference/list-avatar-looks),
  [vozes](https://developers.heygen.com/reference/list-voices),
  [chave](https://developers.heygen.com/docs/api-key),
  [erros](https://developers.heygen.com/docs/error-codes),
  [limites](https://developers.heygen.com/docs/usage-limits),
  [preço Enterprise](https://developers.heygen.com/docs/enterprise-pricing),
  [preço da API](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained),
  [consentimento](https://developers.heygen.com/docs/avatar-consent),
  [política](https://www.heygen.com/moderation-policy),
  [mudanças](https://developers.heygen.com/changelog).

### 9.4 Como ficou na mesa

| Motor (id) | Onde aparece | Preço | Capacidades |
|---|---|---|---|
| Runway Gen-4.5 (`runway-gen4.5`, Top da linha) | Cena do roteiro, Livre, Continuar (pelo último quadro), plano do roteiro | US$ 0,12/s | texto (9:16 e 16:9) e primeiro quadro; 2 a 10 s; sem áudio |
| Runway Gen-4 Turbo (`runway-gen4-turbo`, Rápido) | os mesmos, a partir de imagem | US$ 0,05/s | primeiro quadro; 2 a 10 s |
| Higgsfield Cinema Studio 4.0 (`higgsfield-cinema-4`) | Cena do roteiro e Livre (com a câmera pronta), Continuar, e a ferramenta Ângulo vira "câmera em vídeo" quando escolhida | ~US$ 0,2057/s | texto, imagem de referência, 33 movimentos, áudio; 4 a 15 s na mesa |
| HeyGen avatar de estoque (`heygen-avatar-iv`) | Gerar, modo "Avatar falando"; Kit UGC ("Avatar falando") | ~US$ 0,0667/s | roteiro, voz em português, legenda, 4 formatos |
| HeyGen foto falando (`heygen-foto`) | o mesmo modo, com um clone autorizado | ~US$ 0,05/s | pessoa real com autorização |

Transição (primeiro e último quadro) não aparece para eles: nenhum dos cinco aceita o último quadro
pela API usada aqui.

### 9.5 Riscos e pontos em aberto

- Preço da Higgsfield é promocional e o da HeyGen sem contrato vem de fonte de terceiro: conferir
  na primeira geração de teste (o custo real aparece na conta do provedor).
- A Runway cobra a tentativa recusada pela moderação e a Higgsfield não tem idempotência: nada
  aqui reenvia sozinho, mas a conta da agência pode pagar uma recusa sem cobrar do cliente.
- Na Higgsfield a imagem é referência, não quadro exato: para continuidade rígida, o Gen-4.5 ou os
  motores do fal com primeiro quadro seguram melhor.
- HeyGen: vídeo de pessoa real falando com voz sintética é o caso mais sensível. A autorização do
  clone precisa citar vídeo e voz por IA na finalidade; a HeyGen pode derrubar o vídeo se a pessoa
  pedir. v1 e v2 saem do ar em 31/10/2026 (a mesa já usa a v3).
- Sem chave: os cinco aparecem como "Precisa de chave" com o nome do segredo que falta.
