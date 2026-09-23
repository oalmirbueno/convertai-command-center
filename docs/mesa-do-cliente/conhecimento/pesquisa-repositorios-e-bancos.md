# Pesquisa: repositórios, bancos de referência e técnicas para o estúdio de arte

- Data: 2026-09-23
- Pergunta do dono: as lâminas saem genéricas (texto sem alinhamento, sem enquadramento, sem hierarquia, sem técnica). O que existe de aberto, de documentação oficial e de prática da comunidade para chegar ao nível de um bom designer?
- Contexto técnico: React + Vite + TypeScript + Tailwind + shadcn no front (React 18.3); Supabase (Postgres + funções Deno) no back; diretor de arte (LLM) escreve a direção; gerador (GPT Image 2.5 pela OpenAI, Gemini Image pelo OpenRouter) desenha a lâmina inteira com o texto.
- Regra da casa respeitada neste relatório: a SPEC diz "o gerador de imagem faz a lâmina inteira, texto incluído (NUNCA texto em camada por cima)". Todas as recomendações da seção D cabem nessa regra. Quando a prática do mercado aponta o contrário (fundo sem texto + composição), isso aparece como informação, não como proposta.
- Método: estrelas, licença e última atividade lidas pela API pública do GitHub em 2026-09-23 (arredondadas). Peso de pacote pelo bundlephobia (minificado + gzip). Nada foi instalado no projeto.

---

## 0. Duas coisas que o código atual já mostra (antes de qualquer biblioteca)

**0.1 A lâmina é desenhada em 2:3 e cortada para 4:5.** Em `supabase/functions/estudio-arte/index.ts` o gerador trabalha em `TAMANHO_GERADOR = "1024x1536"` e o prompt manda deixar faixas de 128 px vazias no topo e na base, porque a peça é cortada pelo centro. No motor (`_shared/ia-motor.ts`), o caminho do OpenRouter manda `image_config.aspect_ratio` calculado a partir de `1024x1536`, ou seja, 2:3 também para o Gemini. Consequências diretas nas queixas do dono:

- o modelo compõe para uma tela que não é a que vai ao ar; o "enquadramento" que ele escolhe é desfeito pelo corte;
- a margem que o prompt descreve é relativa à tela errada, e 17% da altura é gasta com fundo que será jogado fora;
- o texto fica espremido numa área útil que o modelo não enxerga como borda real.

O que a documentação oficial permite hoje:

- GPT Image 2.5 (Sunburst e Flare) aceita tamanho livre: "Width and height must be multiples of 16, the aspect ratio must be between 1:3 and 3:1, and neither edge may exceed 3840 pixels", com total de pixels entre 655.360 e 8.294.400 ([OpenAI, Image generation](https://developers.openai.com/api/docs/guides/image-generation)). **1088 x 1360** é 4:5 exato, múltiplo de 16, 1,48 MP; reduzir para 1080 x 1350 perde 0,7%. **1280 x 1600** e **2048 x 2560** também servem se quiser mais detalhe para texto pequeno.
- Gemini Image (Nano Banana 2, Nano Banana Pro, Flash Lite) aceita **4:5 nativo** ([Gemini API, image generation](https://ai.google.dev/gemini-api/docs/image-generation); [Google Cloud, guia de prompt](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana)). O OpenRouter repassa `aspect_ratio: "4:5"` ([OpenRouter, image generation](https://openrouter.ai/docs/features/multimodal/image-generation)).

**0.2 A grade do perfil do Instagram corta a lâmina 4:5.** Desde 2025 o perfil mostra miniaturas 3:4; uma peça 1080 x 1350 perde cerca de 33 px de cada lado na grade ([Oktopost](https://www.oktopost.com/blog/instagram-grid-size-guide/); [wavegen](https://wavegen.ai/instagram-post-size)). Para a capa, a área segura horizontal real é ~1012 px de largura centralizada. No feed, guias de carrossel recomendam manter texto a pelo menos 60 px das laterais e mais folga em cima e embaixo por causa da interface sobreposta ([veeso](https://veeso.ai/blog/instagram-carousel-safe-zone-guide); [carouselmaker](https://carouselmaker.co/en/blog/instagram-carousel-size-aspect-ratio-guide)).

---

## A. Repositórios GitHub

Legenda da coluna "Uso": **APP** = integrar no painel; **PROMPT** = alimentar o conhecimento do diretor; **VERIF** = ferramenta de conferência automática; **REF** = só leitura/estudo.

### A1. Canvas e editor no navegador (pré-visualizar, arrumar, exportar PNG)

| Repositório | Estrelas | Licença | Última atividade | Peso (gzip) | Uso | Como usaríamos |
|---|---|---|---|---|---|---|
| [konvajs/konva](https://github.com/konvajs/konva) | 14,8 mil | MIT (o GitHub mostra "NOASSERTION" por causa do cabeçalho duplo de copyright; o arquivo é MIT) | 2026-09 | 53 KB | APP | Prancheta 1080 x 1350 com `Transformer` (redimensionar/girar), arrastar, camadas e exportação `stage.toDataURL({ pixelRatio })`. Tem exemplo oficial de guias e snap entre objetos ([Konva, Objects Snapping](https://konvajs.org/docs/sandbox/Objects_Snapping.html)). |
| [konvajs/react-konva](https://github.com/konvajs/react-konva) | 6,4 mil | MIT | 2026-09 | 43 KB | APP | Ligação oficial com React. Atenção: a linha 19.x exige React 19; o painel está em React 18.3, então seria a linha 18.x. |
| [fabricjs/fabric.js](https://github.com/fabricjs/fabric.js) | 31,5 mil | MIT | 2026-09 | 90 KB | APP | Melhor edição de texto dentro do canvas (IText) e filtros de imagem. Sem ligação oficial com React; guias de alinhamento vêm de extensão da comunidade ([discussão v6](https://github.com/fabricjs/fabric.js/discussions/10033); [fabric-guideline-plugin](https://www.npmjs.com/package/fabric-guideline-plugin)). |
| [leaferjs/leafer-ui](https://github.com/leaferjs/leafer-ui) | 4,4 mil | MIT | 2026-09 | 69 KB | REF | Motor de canvas rápido com plugin de editor; documentação majoritariamente em chinês. Alternativa se Konva não bastar. |
| [tldraw/tldraw](https://github.com/tldraw/tldraw) | 50,5 mil | Licença própria | 2026-09 | 512 KB | não | Uso comercial exige licença de US$ 6.000 por ano por equipe; sem ela, marca d'água ([tldraw, pricing](https://tldraw.dev/pricing); [licença](https://tldraw.dev/community/license)). Feito para quadro branco infinito, não para prancheta de post. |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | 132,7 mil | MIT | 2026-09 | 344 KB | não | Estética de rascunho à mão; ótimo para diagramas, errado para prancheta de arte. |
| Polotno SDK ([site](https://polotno.com/sdk/pricing)) | código fechado | Comercial: US$ 249 a 899 por mês; Enterprise sob consulta | ativo | alto (Konva + MobX + UI própria) | não agora | É um "Canva embutível" pronto, feito pelo autor do Konva ([licença](https://polotno.com/legal/license)). Só faria sentido se a regra "texto só pelo gerador" caísse e a agência quisesse edição manual completa. |
| [penpot/penpot](https://github.com/penpot/penpot) | 60,3 mil | MPL-2.0 | 2026-09 | aplicação inteira | REF | Figma aberto, auto-hospedável. Não é biblioteca para embutir. |
| [vercel/satori](https://github.com/vercel/satori) | 14,0 mil | MPL-2.0 | 2026-09 | 177 KB | APP (back) | Transforma JSX/HTML+CSS (subconjunto flexbox) em SVG sem navegador. A Supabase documenta exatamente esse uso em função de borda ([Supabase, OG images](https://supabase.com/docs/guides/functions/examples/og-image)). Uso aqui: desenhar a **imagem-guia de layout** (seção C3) no servidor. |
| [kane50613/takumi](https://github.com/kane50613/takumi) | 3,0 mil | Apache-2.0 | 2026-09 | WASM | APP (back) | Alternativa ao Satori em Rust/WASM, roda em Deno, aceita WOFF2, fontes variáveis e saída PNG/WebP direta ([docs](https://takumi.kane.tw/docs/)). |
| [thx/resvg-js](https://github.com/thx/resvg-js) | 2,0 mil | MPL-2.0 | 2026-06 | WASM | APP (back) | Converte o SVG do Satori em PNG. |

Leitura do bloco: para o que a regra da casa permite, o canvas não é "editor de texto por cima da arte"; ele serve para duas coisas: (1) a equipe **desenhar o esqueleto** da lâmina (caixas de título, apoio, imagem, logo sobre um grid com snap) que vira imagem-guia do gerador; (2) **mostrar a conferência** sobre a arte gerada (grid, margens, área segura 3:4, caixas lidas pelo leitor). Konva + react-konva 18 é a escolha: leve, MIT, React oficial, snap documentado. Antes de subir, conferir o `dist` contra o piso Safari 11 / Chrome 64 da casa (a tela é da equipe, mas o teste de compatibilidade varre `src/`).

### A2. Cor: contraste, harmonia, extração de paleta

| Repositório | Estrelas | Licença | Última atividade | Peso (gzip) | Uso | Como usaríamos |
|---|---|---|---|---|---|---|
| [Evercoder/culori](https://github.com/Evercoder/culori) | 1,2 mil | MIT | 2026-07 | 22 KB | VERIF + APP | OKLCH/OKLab, `wcagContrast`, diferença de cor (CIEDE2000). Serve em Deno pelo especificador `npm:`. Medir contraste do texto sobre o fundo na lâmina gerada e dizer se uma cor da arte está fora da paleta do kit. |
| [color-js/color.js](https://github.com/color-js/color.js) | 2,3 mil | MIT | 2026-09 | 32 KB | VERIF | Mesmo papel do culori, com vários algoritmos de contraste (WCAG 2.1, APCA, Delta Phi). Ver a ressalva do APCA abaixo. |
| [gka/chroma.js](https://github.com/gka/chroma.js) | 10,6 mil | BSD-3 | 2026-09 | 16 KB | APP | Escalas e interpolação de cor, `chroma.contrast`. Útil para gerar tons de apoio a partir da cor da marca. |
| [adobe/leonardo](https://github.com/adobe/leonardo) | 2,1 mil | Apache-2.0 | 2026-07 | 23 KB | APP + PROMPT | Gera cores **a partir de uma razão de contraste alvo** sobre um fundo. Ex.: "tom da cor da marca que dá 4,5:1 sobre este creme". O diretor recebe hex exatos em vez de "verde escuro". |
| [material-foundation/material-color-utilities](https://github.com/material-foundation/material-color-utilities) | 2,3 mil | Apache-2.0 | 2026-08 | pequeno | APP | Quantização + pontuação de cor de uma imagem (a mesma lógica do Material You), paletas tonais HCT e esquemas com contraste garantido. Bom para tirar a "cor fonte" de uma foto do cliente. |
| [lokesh/color-thief](https://github.com/lokesh/color-thief) | 13,6 mil | MIT | 2026-08 | 8 KB | APP | Paleta dominante de uma imagem (referência ou arte gerada). |
| [Vibrant-Colors/node-vibrant](https://github.com/Vibrant-Colors/node-vibrant) | 2,5 mil | MIT (no pacote) | 2026-01 | pequeno | APP | Paleta por papel (Vibrant, Muted, Dark, Light), prática para descrever referências. |
| [Myndex/apca-w3](https://github.com/Myndex/apca-w3) | 0,2 mil | Licença restrita | 2026-05 | 5 KB | não | O LICENSE diz que o código é licenciado ao W3C/AGWG "for use with WCAG accessibility guidelines for web-delivered and web-based content only, and not for any other use", e limita o uso do nome APCA. Arte de Instagram gerada por IA fica fora desse escopo. Usar WCAG 2 como régua dura. |

Observação de Deno: bibliotecas de cor puras funcionam em função de borda. Para ler pixels de PNG no Deno, a Supabase avisa que só bibliotecas WASM funcionam (sem Sharp) e aponta `magick-wasm` ([Supabase, Image Manipulation](https://supabase.com/docs/guides/functions/examples/image-manipulation)). A amostragem de pixels também pode ser feita no navegador (canvas) na hora da conferência.

### A3. Tipografia: escala, pareamento, métricas

| Repositório | Estrelas | Licença | Última atividade | Peso (gzip) | Uso | Como usaríamos |
|---|---|---|---|---|---|---|
| [seek-oss/capsize](https://github.com/seek-oss/capsize) | 1,7 mil | MIT | 2026-09 | 2 KB (core) | APP + PROMPT | Converte tamanho de fonte em **altura real de maiúscula** e vice-versa, com métricas prontas das fontes do Google (`@capsizecss/metrics`). O diretor passa a pensar "título com cap-height de 80 px" em vez de "fonte grande". |
| [opentypejs/opentype.js](https://github.com/opentypejs/opentype.js) | 5,0 mil | MIT | 2026-08 | 64 KB | APP | Lê as fontes que o cliente já sobe em `cliente_fontes` (unitsPerEm, capHeight, xHeight, larguras) para medir quanto um título ocupa. |
| [chenglou/pretext](https://github.com/chenglou/pretext) | 50,5 mil | MIT | 2026-09 | 16 KB | APP | Medição e quebra de linha de texto multilinha sem DOM ([site](https://www.pretext.cool/)). Uso: antes de gerar, calcular em quantas linhas o título cabe na coluna escolhida com a fonte do cliente e mandar ao gerador as quebras exatas. Versão 0.0.x: API ainda instável. |
| [foliojs/fontkit](https://github.com/foliojs/fontkit) | 1,7 mil | MIT | 2024-08 | 143 KB | não | Faz o mesmo que opentype.js, mais pesado e parado desde 2024. |
| [harfbuzz/harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) | 0,3 mil | MIT | 2026-09 | WASM | não agora | Shaping profissional. Exagero para medir títulos em português. |
| [fontsource/fontsource](https://github.com/fontsource/fontsource) | 6,1 mil | MIT (fontes OFL) | 2026-09 | por fonte | APP | Fontes abertas auto-hospedadas com metadados; útil para gerar amostras de fontes candidatas. |
| [google/fonts](https://github.com/google/fonts) | 20,5 mil | OFL/Apache por família | 2026-09 | dados | PROMPT | `METADATA.pb` de cada família (categoria, pesos, eixos). Base para um catálogo interno de fontes com classificação. |
| [Jack000/fontjoy](https://github.com/Jack000/fontjoy) | 1,4 mil | MIT | 2017-05 | n/a | REF | Pareamento de fontes por rede neural. Ideia boa, código abandonado. |

Base de pareamento: não existe base aberta boa e atual. O caminho legal é montar uma tabela própria curta (título + texto + motivo) usando como estudo o [Google Fonts Knowledge](https://fonts.google.com/knowledge) (licença CC BY-SA 4.0, ver A6) e consultas manuais a Fonts In Use e Typewolf (seção B), escrevendo a regra com palavras nossas.

Escala modular dispensa biblioteca: com base de corpo 34 px e razão 1,333, a escala dá 34 / 45 / 60 / 80 / 107 / 142. Os guias de carrossel convergem para título 60 a 90 px e corpo 28 a 36 px em 1080 de largura, e para testar a lâmina reduzida a 20% ([carouselmaker](https://carouselmaker.co/en/blog/instagram-carousel-size-aspect-ratio-guide); [contentdrips](https://contentdrips.com/blog/2026/05/instagram-carousel-size-format/)). O material local `pdf-tipografia-1.md` já traz os conceitos; falta transformar em números que o diretor escreve e o código confere.

### A4. Layout e composição: grid, saliência, área para texto, conferência automática

| Repositório | Estrelas | Licença | Última atividade | Uso | Como usaríamos |
|---|---|---|---|---|---|
| [CyberAgentAILab/Graphic-design-evaluation](https://github.com/CyberAgentAILab/Graphic-design-evaluation) | poucas | Apache-2.0 | 2025-02 | VERIF + PROMPT | Artigo SIGGRAPH Asia 2024 que compara avaliação por GPT com **métricas heurísticas de alinhamento, sobreposição e espaço em branco** e com 60 avaliadores humanos. Conclusão: o GPT correlaciona razoavelmente, mas "cannot distinguish small details" ([arXiv 2410.08885](https://arxiv.org/abs/2410.08885)). As heurísticas são simples de portar para TypeScript. |
| [CyberAgentAILab/OpenCOLE](https://github.com/CyberAgentAILab/OpenCOLE) | 0,1 mil | Apache-2.0 | arquivado 2025 | REF | Arquitetura aberta de design automático: plano de design, imagem de fundo, um modelo tipográfico que devolve JSON por elemento de texto (fonte, tamanho, cor, espaçamento, posição) e um renderizador ([artigo](https://arxiv.org/abs/2406.08232)). Serve de modelo para o **esquema de layout** que o diretor deveria emitir. |
| [microsoft/LayoutGeneration](https://github.com/microsoft/LayoutGeneration) (LayoutPrompter) | 0,2 mil | MIT | arquivado | REF | Mostra que um LLM gera layouts coerentes quando recebe **exemplos de layouts bons serializados em caixas**. Aqui: usar lâminas aprovadas da própria agência como exemplos no prompt do diretor. |
| [PKU-ICST-MIPL/PosterLayout-CVPR2023](https://github.com/PKU-ICST-MIPL/PosterLayout-CVPR2023) | 0,1 mil | não declarada | 2025-03 | REF | Layout de pôster consciente do conteúdo da imagem (onde cabe texto sem cobrir o sujeito). Pesquisa, não produto. |
| [diviz-mit/predimportance-public](https://github.com/diviz-mit/predimportance-public) (UMSI) | poucas | não declarada | 2020 | REF | Mapa de **importância visual em peças gráficas** (pôster, anúncio, infográfico) treinado no Imp1k ([projeto](https://predimportance.mit.edu/)). Ideia certa para "o olho vai primeiro no título?", código antigo em Keras. |
| [jwagner/smartcrop.js](https://github.com/jwagner/smartcrop.js) | 13,0 mil | MIT | 2024-03 | VERIF | Acha a região mais "interessante" de uma imagem. Usado ao contrário: confirmar que a área reservada para o título está calma (pouca borda e detalhe) antes de pedir o texto. |
| [naptha/tesseract.js](https://github.com/naptha/tesseract.js) | 38,7 mil | Apache-2.0 | 2026-05 | VERIF | OCR em WASM com caixas por palavra e linha; roda no navegador. Mais fraco em texto estilizado. |
| [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | 90,1 mil | Apache-2.0 | 2026-09 | VERIF (futuro) | OCR forte com caixas; exige servidor Python. |
| [huggingface/transformers.js](https://github.com/huggingface/transformers.js) | 16,3 mil | Apache-2.0 | 2026-09 | VERIF (futuro) | Roda modelos de segmentação e profundidade no navegador. A licença de **cada modelo** precisa ser conferida à parte. |
| [facebookresearch/sam2](https://github.com/facebookresearch/sam2) | 19,9 mil | Apache-2.0 | 2026-05 | não agora | Segmentação de sujeito (para "texto não pode cobrir o rosto"). Precisa de GPU. |
| [danielgatis/rembg](https://github.com/danielgatis/rembg) | 24,9 mil | MIT (modelos variam) | 2026-09 | não agora | Recorte de fundo em Python; alguns modelos embutidos são não comerciais. |
| [imgly/background-removal-js](https://github.com/imgly/background-removal-js) | 7,3 mil | AGPL-3.0 | 2025-07 | não | AGPL em SaaS fechado é risco. |

**Conferência geométrica sem biblioteca nova.** O leitor de visão que o Estúdio já chama para a ortografia pode devolver também as **caixas** de cada bloco de texto, da logo e de rostos. O Gemini documenta saída `box_2d` no formato `[ymin, xmin, ymax, xmax]` normalizado de 0 a 1000 ([Gemini API, image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)). Com as caixas, o código calcula (regras a calibrar com lâminas aprovadas):

- margem mínima: nenhum texto a menos de 64 px das laterais em 1080 (capa: somar os ~34 px do corte 3:4) e da base;
- alinhamento: bordas esquerdas dos blocos alinhados à esquerda dentro de ±6 px; centros dentro de ±6 px quando centralizado; sem mistura sem motivo;
- hierarquia: altura de linha do título pelo menos 2x a do texto de apoio; no máximo 3 ou 4 blocos de texto por lâmina;
- sobreposição: texto não cruza a caixa de rosto nem a logo;
- contraste: amostrar pixels dentro e em volta de cada caixa e exigir WCAG 4,5:1 no apoio e 3:1 no título grande (culori);
- cor da marca: cores dominantes da arte (color-thief) a uma distância CIEDE2000 aceitável da paleta do kit.

A falha vira instrução numérica de edição ("mova o bloco de apoio para alinhar em x = 88 px, mesma borda do título") em vez de "melhore o alinhamento".

### A5. Prompts e guias para gerar imagem com texto e design gráfico

Oficiais (fonte principal):

- [OpenAI, Image prompting](https://developers.openai.com/api/docs/guides/image-prompting): texto exigido entre aspas com posição e tipografia; soletrar nomes raros letra por letra; pedir "no extra text" e conferir; qualidade média ou alta para texto pequeno; prompt em seções rotuladas (cena, sujeito, detalhes, restrições); referências numeradas com papel ("Image 1 = produto, Image 2 = estilo"); em edição de precisão, "composite the approved edit into the original image instead of relying on prompting alone". Lista GPT Image 2.5 Flare (rápido) e Sunburst (qualidade), e as datas de desligamento do gpt-image-1 (2026-10-23) e 1.5 (2026-12-01).
- [OpenAI Cookbook, GPT Image prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide) (repositório [openai/openai-cookbook](https://github.com/openai/openai-cookbook), 76 mil estrelas, MIT): ordem "fundo, sujeito, detalhes, restrições"; peças de marketing escritas "like a creative brief"; posição explícita ("logo top-right", "negative space on left"); em edição, "change only X" + "keep everything else the same", repetindo a lista do que fica a cada rodada.
- [OpenAI, Image generation (limitações)](https://developers.openai.com/api/docs/guides/image-generation): o próprio fornecedor admite que o modelo "may have difficulty placing elements precisely in structured or layout-sensitive compositions" e que a máscara "is entirely prompt-based ... may not follow its exact shape".
- [Google Cloud, Ultimate prompting guide for Nano Banana](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana): aspas no texto, fonte descrita, até 14 referências, fórmula "[Referências] + [Relação] + [Cenário novo]" com o exemplo "Using the attached napkin sketch as the structure", e a dica de **conversar primeiro para fechar o texto e só depois pedir a imagem**.
- [Google, dicas de prompt do Nano Banana Pro](https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/) e [Gemini API, image generation](https://ai.google.dev/gemini-api/docs/image-generation) (modelos `gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-3.1-flash-lite-image`; raciocínio sempre ligado; edição em várias rodadas). Exemplos de código em [google-gemini/cookbook](https://github.com/google-gemini/cookbook) (17,8 mil, Apache-2.0).
- [Anúncio do GPT Images 2.5](https://community.openai.com/t/introducing-gpt-images-2-5-in-the-api-and-chatgpt/1395897) (2026-09-08): mais fidelidade a referências, edição mais precisa, consistência em várias rodadas; no ChatGPT surgiu o recurso Sketch (desenho como referência de layout).

Comunidade (estudar estrutura, não copiar):

| Repositório | Estrelas | Licença | Última atividade | Observação |
|---|---|---|---|---|
| [ZeroLu/awesome-nanobanana-pro](https://github.com/ZeroLu/awesome-nanobanana-pro) | 10,3 mil | MIT | 2026-09 | Maior coleção de prompts de Nano Banana Pro/2, com seções de pôster e infográfico. |
| [ZeroLu/awesome-gpt-image](https://github.com/ZeroLu/awesome-gpt-image) | 2,2 mil | MIT | 2026-09 | Prompts de GPT Image 2 e 2.5, com seção de tipografia. |
| [Transcendo/awesome-nanobanana-prompts](https://github.com/Transcendo/awesome-nanobanana-prompts) | poucas | não declarada | 2026-03 | Pôster, PPT, diagrama. |

Os prompts dessas listas vêm de autores no X; a licença MIT do repositório não garante licença sobre cada prompt. Uso correto: extrair os padrões (seções "Canvas / Layout / Text / Constraints", títulos entre aspas, marca em caixa alta) e reescrever. Guias de terceiros que resumem bem a prática de layout: [fal, GPT Image 2](https://fal.ai/learn/tools/prompting-gpt-image-2), [PixVerse, GPT Image 2.5](https://pixverse.ai/en/blog/gpt-image-2-5-review-and-prompt-guide), [10b.ai, layouts](https://10b.ai/blog/best-gpt-image-2-prompts-for-better-layouts).

### A6. Bases de princípios de design em texto aberto

| Fonte | Licença | Uso | Comentário |
|---|---|---|---|
| [Google Fonts Knowledge](https://fonts.google.com/knowledge) | CC BY-SA 4.0 ([confirmação](https://fonts.google.com/knowledge/glossary/licensing)) | PROMPT | A melhor base aberta de tipografia (hierarquia, pareamento, espaçamento, legibilidade). Exige atribuição; derivados distribuídos herdam a licença. |
| [Jolg42/awesome-typography](https://github.com/Jolg42/awesome-typography) | CC0 | REF | 1,5 mil estrelas; índice de ferramentas e leituras. |
| [alexpate/awesome-design-systems](https://github.com/alexpate/awesome-design-systems) | Unlicense | REF | 26 mil estrelas; índice de design systems (mais UI que peça social). |
| [bradtraversy/design-resources-for-developers](https://github.com/bradtraversy/design-resources-for-developers) | MIT | REF | 67 mil estrelas; índice amplo (fontes, cor, ícones). |
| [gztchan/awesome-design](https://github.com/gztchan/awesome-design) | sem licença | REF | 17,6 mil estrelas; só links, parado desde 2024. |
| [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | MIT | PROMPT (parcial) | Regras curtas e verificáveis; foco em interface, mas o estilo "regra que dá para conferir" é o modelo a seguir. |
| [anthropics/skills](https://github.com/anthropics/skills) | por skill | REF | Skills de design de interface; conferir o LICENSE de cada pasta. |
| [CyberAgent, avaliação por princípios](https://cyberagentailab.github.io/Graphic-design-evaluation/) | Apache-2.0 (código) | PROMPT + VERIF | Definições operacionais de alinhamento, sobreposição e espaço em branco. |
| [clagnut/webtypography](https://github.com/clagnut/webtypography) | não declarada no GitHub | REF | Bringhurst aplicado à web; tratar como leitura, não copiar. |
| Refactoring UI, Laws of UX, Practical Typography, Müller-Brockmann (Grid Systems) | direitos reservados | não ingerir | Ler e reescrever como regras próprias; nunca colar trechos no prompt. |

A pasta `conhecimento/` já tem `pdf-cores.md`, `pdf-gestalt.md`, `pdf-tipografia-1.md` e `pdf-tipografia-2.md`. O que falta não é mais teoria: é uma **cartilha operacional** curta, com números e com a mesma régua que o código confere (seção D, item 5).

### A7. Avaliação estética automática

| Repositório | Estrelas | Licença | Última atividade | Vale para lâmina? |
|---|---|---|---|---|
| [LAION-AI/aesthetic-predictor](https://github.com/LAION-AI/aesthetic-predictor) | 0,7 mil | MIT | 2022-08 | Não. CLIP + camada linear treinado para "beleza" de fotos e arte. |
| [christophschuhmann/improved-aesthetic-predictor](https://github.com/christophschuhmann/improved-aesthetic-predictor) | 1,3 mil | Apache-2.0 | 2024-07 | Não. Mesmo princípio (CLIP ViT-L/14 + MLP) com dados de fotos; não enxerga alinhamento, margem nem legibilidade. |
| [discus0434/aesthetic-predictor-v2-5](https://github.com/discus0434/aesthetic-predictor-v2-5) | 0,4 mil | AGPL-3.0 | 2024-12 | Não (AGPL e foco em foto). |
| [idealo/image-quality-assessment](https://github.com/idealo/image-quality-assessment) (NIMA) | 2,2 mil | Apache-2.0 | arquivado | Não. Qualidade técnica e estética de foto. |
| [chaofengc/IQA-PyTorch](https://github.com/chaofengc/IQA-PyTorch) | 3,4 mil | PolyForm Noncommercial | 2026-08 | Não. Licença proíbe uso comercial. |
| [Q-Future/Q-Align](https://github.com/Q-Future/Q-Align) | 0,6 mil | S-Lab (não comercial) | 2026-06 | Não. Licença não comercial. |
| [arctanxarc/AesEval-Bench](https://github.com/arctanxarc/AesEval-Bench) | poucas | não declarada | 2026-06 | Referência. Benchmark de 2026 (ICLR) específico de design gráfico: modelos de visão atuais têm "clear performance gaps" em julgamento estético, escolha de região e localização precisa ([arXiv 2603.01083](https://arxiv.org/abs/2603.01083)). |

Conclusão: nota estética pronta não resolve a queixa do dono, e as melhores têm licença não comercial. O que funciona para lâmina: **medidas determinísticas** (A4) + **juiz de visão com rubrica fechada** (perguntas de sim/não sobre a lâmina, de preferência comparando duas versões lado a lado) + as **aprovações e reprovações reais** do cliente como verdade, que o sistema já grava na memória do diretor.

Sobre o Jev: a documentação atual diz "Jev accepts text only ... Images, audio, and video are not supported (yet)" ([TypeSafe, State](https://docs.typesafe.ai/concepts/state.md)). Ele não olha a lâmina. Onde ele encaixa: sobre o **texto** do processo. Exemplos: Noul "o texto lido bate com `texto_exato`" (já previsto); Score "quão específica e verificável é a direção que o diretor escreveu" antes de gastar com imagem; Choice "qual referência lida combina com esta lâmina" (já previsto).

---

## B. Bancos de referência online: o que dá para usar legalmente

Princípio geral: pela Lei 9.610/98, a imagem de terceiros continua protegida mesmo publicada. Guardar **link + descrição da técnica escrita por nós** (o campo `leitura` de `cliente_referencias` já faz isso) é o caminho de menor risco. Baixar a imagem e mandá-la ao gerador como referência de estilo aproxima a peça de uma obra derivada; reservar referência por imagem para material do próprio cliente, licenciado ou em domínio público. Isto é análise técnica, não parecer jurídico.

| Banco | API oficial | Termos, em resumo | Uso recomendado |
|---|---|---|---|
| **Pinterest** | Sim, API v5, gratuita, níveis Trial e Standard, OAuth, `boards:read` e `pins:read` ([níveis de acesso](https://developers.pinterest.com/docs/getting-started/access-tiers/)) | Lê pastas e pins da conta autenticada. | Trocar o `importar_pinterest` que hoje baixa o `og:image` do pin pela API sobre as **pastas da própria agência**. Guardar link e leitura; imagem só em cache interno. |
| **Are.na** | Sim, API REST v3 pública ([developers](https://www.are.na/developers)) | Lê canais públicos e escreve nos seus. | Melhor opção para um **banco curado pela equipe**: um canal por cliente ou por técnica ("título sangrado", "grid suíço"), sincronizado para `cliente_referencias` como link + leitura. |
| **Savee** | Não | Licença limitada e revogável; proíbe copiar o serviço ([termos](https://savee.com/terms/)). | Só manual: a equipe cola o link e escreve a leitura. Sem raspagem. |
| **Cosmos** | Não há API oficial (só raspadores de terceiros) | | Só manual. |
| **Behance** | Fechada; o portal de desenvolvedor não emite chaves desde 2024 ([Adobe Community](https://experienceleaguecommunities.adobe.com/t5/adobe-developer-questions/where-can-i-find-behance-api/m-p/408771)) | | Só manual. |
| **Dribbble** | API v2 só devolve shots do usuário autenticado ([Shots](https://developer.dribbble.com/v2/shots/); [termos](https://developer.dribbble.com/terms/)) | | Manual para trabalho de terceiros. |
| **Fonts In Use** | Não | Proíbe reproduzir, compilar ou transmitir o conteúdo ([termos](https://fontsinuse.com/terms-and-conditions-of-use/)). | Excelente para estudar pareamento e hierarquia em peças reais; guardar link + nota nossa. |
| **Typewolf** | Não | Direitos reservados. | Manual, para pareamento de fontes. |
| **Awwwards** | Não | Direitos reservados. | Pouco útil para peça social; ignorar. |
| **Meta Ad Library** | Sim, mas no Brasil a API cobre só anúncios de tema social, eleitoral ou político | | Anúncios comerciais: consulta manual no site. O ambiente já tem a ferramenta `meta_search_ad_library` no MCP da Meta. |
| **Instagram Graph API (business discovery)** | Sim, oficial | Lê mídia pública de contas comerciais e de criador. | Benchmark de concorrentes do cliente pelo caminho oficial (metadados, métricas, link). |
| **Cooper Hewitt (Smithsonian)** | Sim, GraphQL ([docs](https://apidocs.cooperhewitt.org/api-home/)) | Metadados CC0; imagem CC0 só quando o registro traz `cc0: true`. | Pôsteres e peças gráficas históricas; ótimo para "aula de composição" com imagem liberada. |
| **Museum für Gestaltung Zürich (eMuseum)** | Consulta online; direitos por item ([pôsteres](https://museum-gestaltung.ch/en/poster)) | 380 mil pôsteres, maior acervo suíço. | Estudo manual de grid suíço; guardar link + leitura. |
| **The Met Open Access, Library of Congress, Europeana** | Sim ([Met](https://www.metmuseum.org/hubs/open-access); [LoC](https://www.loc.gov/apis/); [Europeana](https://pro.europeana.eu/page/apis)) | Muitos itens CC0 ou domínio público; filtrar por direito. | Fonte de pôsteres históricos que podem ir como imagem de referência sem risco. |

---

## C. Técnicas para o gerador respeitar grid, margens, alinhamento e hierarquia

**C1. Gerar na tela certa.** Ver 0.1. É a técnica de maior retorno e menor risco: o modelo passa a compor para a borda real. No prompt, descrever a tela como "vertical 4:5, 1080 x 1350" e as margens em relação a ela.

**C2. Layout descrito como especificação, não como adjetivo.** A documentação oficial pede prompts em seções e posição explícita; a comunidade converge para a estrutura Canvas / Layout (grid, colunas, alinhamento, margens) / Texto (palavras exatas por papel) / Restrições ([OpenAI Cookbook](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide); [fal](https://fal.ai/learn/tools/prompting-gpt-image-2); [10b.ai](https://10b.ai/blog/best-gpt-image-2-prompts-for-better-layouts)). Na prática:

- o diretor emite um JSON por lâmina: grid (ex.: 6 colunas, margem 88 px, calha 24 px), e para cada elemento `papel` (título, apoio, número, CTA, logo, imagem), caixa em percentuais, alinhamento, altura de maiúscula em px, peso, cor em hex, quebras de linha exatas;
- o código traduz o JSON para frases que o modelo entende bem: terços, percentuais e bordas nomeadas ("todo o texto alinhado à esquerda na mesma vertical, a 8% da borda esquerda; título ocupa de 12% a 38% da altura, em 2 linhas: 'LINHA UM' / 'LINHA DOIS'"). Coordenada em pixel exato não é seguida com precisão (a própria OpenAI admite a limitação), mas regiões e alinhamentos nomeados são;
- o mesmo JSON é a régua da conferência (A4). Direção e verificação passam a falar a mesma língua.

**C3. Imagem-guia de layout como referência.** Os dois fornecedores documentam referência estrutural: Google com "Using the attached napkin sketch as the structure" ([Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana)); OpenAI com referências numeradas e papel explícito, e o Sketch do ChatGPT Images 2.5 ([PixVerse](https://pixverse.ai/en/blog/gpt-image-2-5-review-and-prompt-guide)). Montagem:

- gerar do JSON um PNG 1080 x 1350 em cinza neutro: retângulos de texto com a altura real das linhas, área de imagem, área de logo, linhas de margem (Satori/Takumi na função de borda, ou Konva quando a equipe desenha à mão);
- enviar como **Imagem 1** com o papel "layout wireframe: use only positions, sizes and alignment; do not draw the boxes, lines, labels or grey color";
- risco conhecido: às vezes o modelo desenha as caixas. Testar A/B em 10 lâminas antes de ligar como padrão; se vazar, trocar caixas por manchas suaves ou mandar o guia como máscara de edição (C5).

**C4. Fundo sem texto + composição por código.** É o consenso do mercado para peça com texto em 2026 ([Krumzi](https://www.krumzi.com/blog/how-to-add-text-to-ai-images); [MindStudio](https://www.mindstudio.ai/blog/ai-image-generation-social-media-content)) e é a arquitetura do OpenCOLE. Dá alinhamento perfeito e fonte real do cliente. **Contraria a regra atual da SPEC**, por isso fica registrado como informação para o dono, não como proposta.

**C5. Duas passagens dentro do gerador (cabe na regra).** Passo 1: gerar a cena com a área de texto reservada e vazia, descrita pelo JSON. Conferir com código que a área está calma (variação baixa, smartcrop). Passo 2: edição no próprio gerador, "add only the headline 'X' inside the empty area at left, flush-left at 8%...; keep everything else the same", com máscara cobrindo só a área de texto. O texto continua sendo desenhado pelo gerador. Limites oficiais: na OpenAI a máscara é guia, não recorte exato ([Image generation](https://developers.openai.com/api/docs/guides/image-generation)); no Gemini a "máscara" é semântica, pelo texto do pedido ([Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana)). A OpenAI recomenda, quando a precisão importa, colar os pixels da edição aprovada sobre a original: continua sendo pixel do gerador, não camada de texto.

**C6. Regras de texto que os dois fornecedores repetem.** Copy entre aspas e com papel ("título", "apoio", "botão"); quebra de linha explícita; caixa alta para títulos curtos; soletrar marca e palavra rara; "no extra text"; qualidade alta (ou `xhigh`) quando houver texto pequeno; poucas palavras por lâmina; no Gemini, fechar o texto em conversa antes de pedir a imagem; uma edição importante por rodada, repetindo a lista do que não muda ([OpenAI](https://developers.openai.com/api/docs/guides/image-prompting); [Google](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana); [PixVerse](https://pixverse.ai/en/blog/gpt-image-2-5-review-and-prompt-guide)).

**C7. Fonte do cliente.** O gerador não usa o arquivo da fonte; ele imita a descrição e a amostra. Manter a amostra PNG (já prevista) como referência com papel "typography reference only: letterforms, weight, width", e descrever a fonte pela classificação e traços (grotesca condensada, serifa de alto contraste...), não só pelo nome.

**C8. Controle explícito de posição: Recraft V3.** É a única API encontrada com parâmetro de posição de texto: `text_layout`, lista de palavras com caixa de 4 pontos normalizada de 0 a 1, renderizada pelo próprio modelo, suportada só nos modelos V3 ([Recraft, endpoints](https://www.recraft.ai/docs/api-reference/endpoints); [prodia](https://docs.prodia.com/models/recraft-v4/)). O Recraft V3 aparece no OpenRouter ([página](https://openrouter.ai/recraft/recraft-v3)), mas o `text_layout` provavelmente só pela API direta. Vale um teste isolado para capas com título grande; não para trocar o gerador.

**C9. Laço de conferência com orçamento.** Gerar, medir (A4), e só então: aprovar; editar com instrução numérica; ou regenerar com o erro medido no prompt. Teto de tentativas por lâmina ligado à carteira do cliente. Variante mais cara: 2 ou 3 rascunhos em qualidade baixa (Flare), escolher o melhor pelas medidas e comparação lado a lado, e só a lâmina final em qualidade alta.

---

## D. Recomendação final

### Integrar agora (ganho grande, risco baixo)

1. **Tela nativa 4:5.** GPT Image 2.5 em `1088x1360` (reduzir para 1080 x 1350) e Gemini com `aspect_ratio: "4:5"`; tirar do prompt as faixas de 128 px e o corte pelo centro; somar à capa a área segura do grid 3:4. Mudança localizada em `TAMANHO_GERADOR`, na função `proporcao()` do motor e no texto do prompt. Nenhuma biblioteca nova.

2. **Direção em JSON de layout com números.** O diretor passa a emitir grid, margens, caixa em percentuais, alinhamento, altura de maiúscula e quebras de linha por elemento; o código traduz para o prompt. Medir o título com as métricas reais da fonte do cliente (opentype.js + capsize; pretext quando estabilizar) para mandar quebras que cabem. Padrões tirados do OpenCOLE e do LayoutPrompter, com lâminas aprovadas da agência como exemplos. Bibliotecas MIT e leves.

3. **Conferência geométrica automática.** Pedir ao leitor de visão que já existe as caixas `box_2d` de cada texto, logo e rosto; o código mede margem, alinhamento, hierarquia, sobreposição, contraste WCAG e distância da paleta (culori + color-thief), com as heurísticas do estudo da CyberAgent. Reprovação vira instrução numérica de edição. Jev fica nas perguntas de texto (ortografia, especificidade da direção, escolha de referência).

4. **Imagem-guia de layout como Imagem 1**, gerada do mesmo JSON por Satori ou Takumi na função de borda; teste A/B em 10 lâminas antes de ligar como padrão. Konva + react-konva 18 entra depois, como prancheta para a equipe desenhar o esqueleto à mão e para ver a conferência sobre a arte.

5. **Cartilha operacional + referências pelo caminho legal.** Uma página de regras numéricas (escala tipográfica para 1080, margens, número máximo de blocos, contraste, alinhamento, regras de capa, miolo e CTA) escrita a partir dos PDFs locais e do Google Fonts Knowledge (CC BY-SA, com atribuição), com a mesma régua da conferência. Nas referências: API do Pinterest nas pastas da agência e Are.na para curadoria, no lugar de baixar `og:image`; imagem de terceiros entra como leitura textual da técnica, não como imagem.

### Não vale a pena agora

- tldraw (US$ 6.000 por ano, 512 KB), Polotno (US$ 249 a 899 por mês), Excalidraw (estética errada), Penpot (é uma aplicação inteira);
- preditores estéticos (LAION, improved-aesthetic-predictor, NIMA, v2.5): medem beleza de foto, não design; IQA-PyTorch e Q-Align têm licença não comercial;
- código oficial do APCA (licença restrita ao uso WCAG na web): usar WCAG 2;
- raspar Savee, Cosmos, Behance, Dribbble ou Fonts In Use;
- treinar ou hospedar OpenCOLE, LayoutDM, UMSI, SAM2 ou rembg: arquivados ou exigem GPU e Python; usar só como fonte de ideias;
- fontkit (pesado e parado) e fontjoy (abandonado desde 2017);
- AGPL no produto (background-removal-js, aesthetic-predictor-v2-5).
