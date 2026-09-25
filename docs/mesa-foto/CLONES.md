# Mesa Foto: Clones, Tirar fundo, biblioteca pelo próprio prompt e diretor atual

Data: 2026-09-25. Continua `CONTRATO.md`, `CONTRATO-V2.md` e `MODELOS-E-CANVAS.md`; as regras duras de lá continuam valendo. Nada foi publicado: sem commit, sem deploy, sem SQL em produção. A migration nova é `migrations/04_clones.sql` (NÃO aplicada).

## Pedidos do dono (fala de 25/09)

1. "Montar foto com modelo com base nas fotos REAIS dos clientes: vamos fazer mais variações dessa pessoa aqui."
2. "Área de CLONES: pegar uma foto de uma pessoa e criar vários clones idênticos com outras opções. Depois vamos ter uma mesa de vídeos e criar clones de vídeos hiper-realistas; essa parte tem que ser muito boa."
3. "Nas fotos, a edição de remover fundo para preparar melhor."
4. "As fotos da biblioteca de prompt não têm nada a ver com o prompt."
5. Modelos: "ocupe os espaços, está tudo muito para baixo; o Detalhar em 4K poderia estar do lado."
6. Diretor de fotografia: "está muito antigo; quero mais atual: as cores, ambientes diferentes."

---

## 1. Pesquisa (resumo, conferida em 25/09/2026)

### 1.1 Consistência de identidade sem treinar LoRA

- **Referências:** 3 a 5 por pessoa rendem mais que muitas; com referência demais o modelo faz uma "média" dos rostos e a identidade deriva. Só a frente faz o modelo inventar o perfil; a 3/4 é a vista que mais ajuda. Por isso o clone aceita de 1 a 4 fotos reais e manda ao gerador no máximo 5 imagens de identidade.
- **Foto de referência boa:** rosto de frente, luz plana e uniforme, expressão neutra, fundo liso, sem filtro, rosto grande no quadro (o Runway indica cerca de 1024 px; foto torta ou borrada derruba a consistência em cerca de 30%). Óculos escuros e chapéu escondem traço, e o que está escondido o modelo inventa.
- **Folha única x imagens separadas:** para os geradores de imagem, vistas separadas a partir do mesmo retrato mestre funcionam melhor que um quadro com a grade (o modelo tenta copiar a grade). A folha do clone é uma imagem por vista.
- **Prompt:** citar por índice ("Imagem 1 é a foto real, a verdade sobre o rosto"), repetir a mesma descrição dos traços em toda chamada, pedir "editar, não recriar", separar o que muda do que fica.
- **O que mais deriva:** mudança grande de pose e de ponto de vista (o pior em todos os modelos), edições encadeadas (cai depois de 3 ou 4), rosto pequeno no quadro, várias pessoas na cena, tatuagem e pinta espelhadas no perfil, acessórios e proporção do corpo. Rostos idosos e pele escura sofrem mais (estudo de set/2026).
- **Âncora limpa primeiro:** gerar um retrato mestre limpo, aprovar e usar como fonte das próximas. No clone, a frente aprovada vira a âncora e as vistas aprovadas entram como identidade depois das fotos reais.

### 1.2 Geradores no OpenRouter e limites

| Modelo | Referências | Saída | Preço | Uso no clone |
| --- | --- | --- | --- | --- |
| `google/gemini-3-pro-image` (Nano Banana Pro) | 14 (até 5 pessoas + 6 objetos) | 1K, 2K, 4K | US$ 0,134 (1K/2K), 0,24 (4K) | **Padrão.** Melhor preservação de rosto nos estudos independentes; grava SynthID; o Google exige direito sobre as fotos enviadas. |
| `openai/gpt-image-2.5-sunburst` | 16 | até 3840 px | por token (cerca de 0,05 a 0,21) | Segundo. 1º em edição no ranking cego, mas o classificador da OpenAI marca pessoa real e pode recusar. |
| `google/gemini-3.1-flash-image` (Nano Banana 2) | 14 (até 4 pessoas) | 512 a 4K | US$ 0,067 (1K) | Rascunho barato. |
| `bytedance-seed/seedream-5-0-pro` e 4.5 | 14 | 1K a 4K | 0,045 a 0,09 | **Fora do clone:** BytePlus não aceita rosto de pessoa real no fluxo padrão. |
| `black-forest-labs/flux.2-*` | 8 | auto | 0,03 a 0,07 por MP | Não recomendado (abaixo no ranking de edição). |
| `x-ai/grok-imagine-image-2.0` | 3 | 1K, 2K | 0,04 a 0,08 | Poucas referências. |
| `qwen/qwen-image-3-pro` | 4 | 1K, 2K | 0,04 a 0,075 | Secundário. |
| `microsoft/mai-image-2.6` | 5 | auto | cerca de 0,04 | Ótimo custo; usado nos exemplos da biblioteca. |

Ranking de edição (Artificial Analysis, Elo cego, edição em geral, não identidade): Sunburst 1181, Flare 1162, MAI-2.6 1135, Nano Banana 2 1108, Seedream 5 Pro 1107, Grok 2.0 1106, Nano Banana Pro 1098. Não há benchmark público de similaridade facial (tipo ArcFace) com esta geração de modelos; a medida certa é com as fotos do próprio cliente. Um motor por clone: o primeiro que gerar fica preso (trocar aumenta a deriva).

### 1.3 Conferir semelhança sem biometria

- A visão descreve cada traço (formato do rosto, olhos, sobrancelhas, nariz, lábios, pele e marcas, cabelo, idade, corpo) nas fotos reais e na gerada, **sem identificar a pessoa**; o Jev (TypeSafe) faz um **Choice por traço** (igual, pequena diferença, diferente, não dá para ver) tratando a foto real como evidência, e dois **Noul** ("é outra pessoa?", "saiu espelhada?"). O código soma com pesos e mostra alertas. É só aviso: a equipe decide, sem refazer automático.
- APIs de comparação facial (AWS Rekognition CompareFaces, Azure Face) geram **dado biométrico** (LGPD art. 5º II e art. 11: consentimento específico e destacado; biometria está no mapa de fiscalização da ANPD 2026/2027). Por isso não foram usadas.

### 1.4 Jurídico e rotulagem

- Direito de imagem (CF art. 5º X; Código Civil art. 20): o termo diz quem, quando, para quê, onde e até quando, e a pessoa pode revogar. O clone grava tudo isso e exige que a pessoa **saiba que as fotos serão recriadas por IA** e que é adulta.
- Rótulo de IA: Meta exige declarar conteúdo fotorrealista gerado (e lê C2PA/IPTC); AI Act art. 50 vale desde 02/08/2026 para público europeu; o PL 2338/2023 ainda está na Câmara. A tela lembra de ligar o rótulo ao publicar.

### 1.5 O que a futura mesa de vídeo vai pedir

- **Veo 3.1:** até 3 imagens de referência (asset), 16:9 ou 9:16, só `allow_adult`.
- **Kling 3.0 Elements:** 2 a 4 imagens, uma de frente como principal (frente, lado, costas, detalhe), mínimo 300 px.
- **Runway Gen-4:** 1 a 3 referências; proíbe menor e personificação.
- **Seedance 2.0:** não aceita foto de pessoa real no fluxo padrão.
- Prática: retrato mestre de frente em alta, vistas 3/4 e perfil em imagens próprias, corpo inteiro vertical 9:16, fundo neutro; no prompt do vídeo descrever só ação e câmera (o rosto vem das referências); clipes de 5 a 10 s derivam menos.

### Fontes

- OpenRouter, modelos e endpoints de imagem: https://openrouter.ai/api/v1/images/models e `/images/models/{id}/endpoints`
- Google, geração de imagem (5 pessoas, direitos, SynthID) e preços: https://ai.google.dev/gemini-api/docs/image-generation , https://ai.google.dev/gemini-api/docs/pricing
- Guia de prompt do Nano Banana Pro (Google): https://dev.to/googleai/nano-banana-pro-prompting-guide-strategies-1h9n
- OpenAI, geração de imagem: https://developers.openai.com/api/docs/guides/image-generation
- Artificial Analysis, ranking de edição: https://artificialanalysis.ai/image/leaderboard/editing
- Estudos de preservação de identidade: https://arxiv.org/html/2608.28802 e https://arxiv.org/abs/2609.04151
- Consistência de personagem: https://astorie.ai/workflows/character-consistency , https://www.screenweaver.ai/blog/character-drift-ai-video-consistency , https://invideo.io/faq/should-you-create-character-reference-sheets-before/ , https://flick.art/blog/img2img-consistent-character , https://help.scenario.com/articles/6803483730-runway-gen-4-references
- Vídeo: https://ai.google.dev/gemini-api/docs/veo , https://kling.ai/quickstart/klingai-element-library-3-user-guide , https://runway.com/safety/usage-policy , https://aividpipeline.com/blog/seedance-real-human-face-rules-2026
- LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm ; AI Act art. 50: https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act ; Meta: https://coinis.com/blog/meta-ai-content-labeling-facebook-instagram-ads-2026
- AWS Rekognition (referência, não usado): https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html
- TypeSafe (Noul, Choice, verificação contra evidência): https://docs.typesafe.ai/llms.txt , https://docs.typesafe.ai/primitives/noul.md , https://docs.typesafe.ai/cookbooks/citation_check.md

---

## 2. Clones

### 2.1 Fluxo na tela (aba Clones, ferramentas de apoio)

1. **Novo clone:** nome, 1 a 4 fotos reais (do acervo ou subindo; a estrela marca a principal), traços que nunca mudam e a **autorização** (quem, data, finalidade, forma, validade, "a pessoa sabe que é IA", "tem 18 anos ou mais", "confirmo"). Sem tudo isso o botão não cria (a função confere de novo).
2. **Folha de identidade:** 6 vistas (frente, 3/4 esquerda, 3/4 direita, perfil, meio corpo, corpo inteiro em 9:16), uma imagem por chamada, fundo cinza claro liso, luz uniforme, expressão neutra, camiseta lisa. Aprovar a frente e mais 2 deixa o clone **pronto**.
3. **Variações:** variações prontas (retrato editorial, na rua, no trabalho, café, em casa, close sorrindo, corpo inteiro em estúdio, UGC) ou roupa, cenário, pose e expressão escritos; formato 4:5, 1:1, 9:16 ou 16:9; 1, 2 ou 4 por vez, custo total antes. Cada variação entra no acervo (`modo: clone`, `gerada`, tags `clone:<id>` e `pessoa_real_autorizada`) e segue o aprovar e usar de sempre.
4. **Conferir** em cada imagem: semelhança em % e alertas (aviso).
5. **Pacote para vídeo:** copia o pacote `aceleriq.clone.v1` (seção 2.4).
6. **Arquivar** (e revogar autorização pela função): nada novo sai.

"**Variações desta pessoa**": no acervo, em toda foto original (não gerada, não da internet), o botão e o menu levam à aba Clones com a foto; se um clone já usa a foto, ele abre; senão abre o clone novo com ela escolhida.

No computador: clones à esquerda, o clone aberto à direita com a folha e as variações lado a lado; no celular, tudo em uma coluna.

### 2.2 Regras duras (em `clones-regras.ts`, testadas)

- Sem autorização completa e válida (não vencida, não revogada) nada é criado nem gerado.
- Clone só de foto real: foto gerada ou referência da internet é recusada como identidade (`foto_nao_e_real`).
- Adulto (18+). Texto que muda identidade ("mais jovem", "afinar o nariz", "clarear a pele", "emagrecer"...) é recusado; sósia, nome de pessoa conhecida, menor e sexualização também (a palavra "clone" é liberada).
- Prompt: fotos reais primeiro (verdade do rosto), vistas aprovadas depois, invariantes repetidas, "nunca espelhe", pele real sem filtro, estética atual, nunca escurecer a foto.
- Motor preso ao primeiro que gerou; `mesmoModelo: true` (sem reserva silenciosa para outro gerador).
- Persona sintética e clone não se misturam: a galeria de Modelos filtra os clones; as ações de persona sintética recusam clone (`e_um_clone`).

### 2.3 Banco (migration 04, não aplicada)

`foto_modelos` ganha `origem` (`sintetica` | `clone_de_foto_real`), `autorizacao jsonb` e `identidade_real jsonb` (1 a 4 fotos reais). As checagens de ficha e ética passam a valer por origem (clone: 18+, `clone_de_pessoa_real` e `autorizada`; sintética: como antes). Clone sempre com `client_id`, autorização confirmada e 1 a 4 fotos. `cliente_imagens.modo` aceita `clone`. A folha usa `foto_modelo_imagens` (papel `vista`). Até a migration entrar, as ações de Clones respondem "a migration 04 foi aplicada?".

### 2.4 Pacote para a futura mesa de vídeo (`clone_pacote`)

```json
{
  "formato": "aceleriq.clone.v1",
  "clone": { "id", "client_id", "nome", "versao", "status", "pronto" },
  "autorizacao": { "quem", "data", "forma", "finalidade", "escopo", "validade", "sabe_que_e_ia", "adulta", "valida": { "ok", "motivo" } },
  "identidade": {
    "fotos_reais": [{ "imagem_id", "principal", "largura", "altura", "url" }],
    "ancora": "id da frente aprovada",
    "folha": [{ "imagem_id", "vista", "largura", "altura", "motor_id", "url" }],
    "invariantes": ["..."],
    "motor_preferido_id": "openrouter:google/gemini-3-pro-image"
  },
  "video": {
    "referencias_sugeridas": ["frente", "3/4 esq", "3/4 dir", "corpo inteiro (ids)"],
    "limites_por_motor": { "veo_3_1": 3, "kling_3_elements": 4, "runway_gen4": 3, "seedance_2": "não aceita rosto de pessoa real" },
    "orientacao": "prompt do vídeo só com ação e câmera; clipes de 5 a 10 s"
  },
  "rotulo_de_ia": "..."
}
```

URLs assinadas por 1 hora. A mesa de vídeo lê o pacote, confere `autorizacao.valida.ok` antes de gerar e respeita a finalidade.

### 2.5 Contrato das ações (POST `mesa-foto`)

| Ação | Entrada | Saída | IA |
| --- | --- | --- | --- |
| `clones_listar` | `{ client_id }` | `{ clones: [{ ...linha, capa_url, capa_e_real, autorizacao_valida }] }` | não |
| `clone_criar` | `{ client_id, nome, imagem_ids[1..4], principal_id?, autorizacao, invariantes?, descricao?, idade_aparente?, kit_id? }` | `{ clone, estimativa_folha_usd, estimativa_variacao_usd, modelo_imagem_id }` | não |
| `clone_ler` | `{ modelo_id }` | `{ clone, reais, imagens, folha, variacoes, motores, presets, formatos, autorizacao_valida }` | não |
| `clone_editar` | `{ modelo_id, nome?, invariantes?, autorizacao?, revogar_autorizacao?, arquivar? }` | `{ clone, avisos }` | não |
| `clone_folha_gerar` | `{ modelo_id, vista, modelo_imagem_id?, qualidade?, resolucao?, seed? }` | `{ imagem, url, clone, folha, custo_usd, saldo_usd, avisos }` | 1 imagem |
| `clone_imagem_decidir` | `{ imagem_id, decisao: aprovar|rejeitar, motivo? }` | `{ imagem, clone, folha }` | não |
| `clone_variacao_gerar` | `{ modelo_id, pedido: { preset?, roupa?, cenario?, pose?, expressao?, luz?, enquadramento?, livre? }, formato?, modelo_imagem_id?, qualidade?, resolucao?, seed? }` | `{ imagem (acervo), url, clone, pedido, custo_usd, saldo_usd }` | 1 imagem |
| `clone_conferir` | `{ modelo_id, imagem_id, origem?: folha|acervo }` | `{ conferencia: { leitura, tracos, outra_pessoa, espelhada, semelhanca, alertas, conferir, aviso }, custo_usd }` | visão + Jev (aviso) |
| `clone_pacote` | `{ modelo_id }` | `{ pacote }` | não |
| `estimar` | `acao_alvo: clone_folha | clone_variacao | clone_conferir`, `modelo_id?`, `quantidade?` | `{ estimativa_usd, por_imagem_usd }` | não |

---

## 3. Tirar fundo (preparar `fundo_transparente`)

Contrato mantido para o Estúdio: `preparar { client_id, imagem_id, modo: 'fundo_transparente' } -> { imagem, custo_usd }` (a resposta ganhou `recorte` e `aviso`, opcionais).

- O GPT Image recebe a tela de trabalho com `background: transparent`; do resultado **só o canal alfa** é usado. A máscara é **alinhada** à foto original (escala e deslocamento, busca em três níveis comparando a luminância só nos pixels do assunto) e levada para a **foto original inteira** (até 1600 px no lado maior, inclusive a faixa que a tela de trabalho cortava). A cor de cada pixel é sempre a original (`recorte.ts`, que importa `decodificar`, `cobrir` e o tipo `Alinhamento` de `_shared/imagem-local.ts` sem editá-lo).
- Erros explícitos, nada gravado e a chamada já cobrada: `fundo_nao_veio_transparente`, `recorte_vazio`, `recorte_desalinhado` (o gerador redesenhou o assunto). Entre 14 e 24 de desvio o recorte sai com aviso "confira as bordas".
- Derivada no acervo com tag `sem_fundo`, descrição "pixels originais do assunto", selo "sem fundo" na tela. Botão **Tirar fundo** no detalhe da foto do acervo, no menu da foto e no Preparar.
- **CPU (Deno 2.8 local, foto de 1536 x 2048 em JPEG):** decodificar o JPEG é o passo mais caro (cerca de 0,6 s em 2048 px, 0,4 s em 1600 px). Fluxo inteiro fora a chamada ao gerador: 1,25 a 1,5 s em 2048 px; **0,9 a 1,1 s em 1600 px** (escolhido, folga para o limite de 2 s). Alinhamento sozinho: 0,11 a 0,16 s de busca. Scripts: `scratchpad/teste-recorte*.ts` e `teste-fluxo2.ts`.

---

## 4. Biblioteca: exemplo pelo próprio prompt

- `promptDoExemplo` agora manda o **próprio prompt** do item com as lacunas preenchidas por valores concretos e genéricos (`preencherLacunasDoPrompt`: exemplo dado na lacuna vence, cor vira cor da paleta, assunto vira o genérico da categoria, sem marca).
- Ações de admin (`biblioteca-lote.ts`):
  - `biblioteca_limpar_exemplos { modo?: openverse|nao_batem, confirmar?, client_id? } -> { encontrados, a_limpar, limpos, itens[{ id, titulo, bate }], confirmado, aviso, custo_usd }`. Sem `confirmar`, só prévia. `nao_batem` pergunta ao Jev (Noul por item, em blocos de 25) se o título e a busca da foto mostram o que o prompt descreve; cobra centavos no `client_id`. Limpar devolve o crédito original do prompt.
  - `biblioteca_exemplos_estimar { client_id?, modelo_imagem_id?, qualidade?, refazer_gerados? } -> { pendentes, por_imagem_usd, total_usd, modelo_imagem_id, rotulo, qualidade }`.
  - `biblioteca_exemplo_proximo { client_id, item_id?, modelo_imagem_id?, qualidade?, refazer_gerados? } -> { item, url, pendentes, acabou, custo_usd, saldo_usd }` (UMA imagem por chamada; a tela repete com andamento e botão Parar).
- Gerador: MAI-Image-2.6 (3º no ranking cego de texto para imagem, cerca de US$ 0,04), reserva Seedream 4.5 (US$ 0,04), depois o padrão de imagem.
- **Custo estimado para os 138 prompts** (preços do catálogo da migration 03, qualidade média, prompt real de cada item): **MAI-Image-2.6: US$ 6,14 (cerca de US$ 0,044 cada)**; Seedream 4.5: US$ 5,52. Mais centavos se usar "conferir quais não batem". **Não foi rodado**: fica para o ok do dono.

## 5. Modelos (layout)

No computador: coluna da esquerda com a persona aberta (âncora grande, ficha curta, folha x de 6, "Usar no Canvas") e a galeria compacta; à direita a rodada lado a lado e, embaixo, **Folha e Detalhar em 4K lado a lado** (xl). No celular, uma coluna. Nada de espaço vazio.

## 6. Diretor de fotografia atual

`ESTETICA_ATUAL` entra no `PADRAO_PUBLICITARIO` (diretor, agente, variações e campanha): editorial limpo, luz natural suave com direção, paletas atuais (neutros quentes, sálvia, oliva, terracota suave, acento da marca), cenários contemporâneos (travertino, microcimento, linho, papel de cor sólida, acrílico com sombra, arquitetura com sombra de janela), UGC autêntico, exemplos de direção e a lista a evitar (degradê, vinheta, HDR, bokeh exagerado, acrílico preto espelhado, fumaça, neon sem motivo, saturação, banco de imagem). O pedido ao gerador (`promptDaTomada` e `promptDaCampanha`) ganhou a linha `ESTETICA_NO_PROMPT`; as receitas trocaram "fundo com gradiente" por fundo de cor sólida. As regras da casa não mudaram.

## 7. Limites e pendências

- A migration 04 precisa ser aplicada (com begin/rollback antes) para Clones funcionar.
- O Canvas (outra frente) lista `foto_modelos` direto: precisa filtrar `origem = 'clone_de_foto_real'` ou tratar o clone como pessoa real autorizada.
- GPT Image pode recusar editar rosto de pessoa real; o Nano Banana Pro é o padrão por isso. Semelhança é aviso por descrição, não biometria.
- "Tirar fundo" depende do GPT Image devolver fundo transparente; foto em que o assunto se confunde com o fundo pode sair `recorte_desalinhado` ou `recorte_vazio` (erro explícito, sem laço).
- A geração da biblioteca roda enquanto a aba estiver aberta (uma por chamada); o que saiu fica salvo.
