# Modelos de IA do painel: o que há de novo e o melhor por papel

Frente MOD, 30/09/2026. Pedido do dono: atualizar o painel com os lançamentos da Anthropic e da OpenAI, escolher os melhores modelos, ligar o computer use pela API e conectar tudo ao painel.

Os fatos foram conferidos em 29/09/2026 nas páginas oficiais e na lista pública do OpenRouter (`GET https://openrouter.ai/api/v1/models`, 464 modelos) e de novo ao vivo em 30/09/2026 à tarde pela frente MOD2 (mesma lista, a página de modelos da Anthropic, a da OpenAI e o calendário de lançamentos de setembro). Preços em dólar por 1 milhão de tokens (entrada / saída).

## 0. O que a MOD2 mudou (30/09 e 01/10)

- **O lote novo entra LIGADO.** Em 30/09 o catálogo já tinha todos os lançamentos sincronizados, mas desligados, e o seletor das mesas só mostra modelo ligado: nenhum aparecia. A migration `20260930320100_modelo_por_papel.sql` liga 8 modelos de texto e 4 de imagem (lista `MODELOS_DO_LOTE_NOVO` em `src/lib/mesa/modelo-por-papel.ts`).
- **O padrão de papel em uso NÃO muda sozinho.** A migration só preenche papel que está sem padrão ligado (em 30/09, só o "Conteúdo rápido"). Trocar o padrão de um papel em uso muda o custo de todas as mesas, então fica para o dono em Modelos de IA › "Aplicar a recomendação": a prévia mostra cada troca, o preço de antes e de depois e quantas vezes o preço por token sobe, e só grava no Confirmar.
- **Todo seletor mostra os novos:** o `SeletorDeModelo` das mesas (só ligados) e o seletor próprio da Central (lista fixa, agora com GPT-6.1 Sol, Claude Sonnet 5.5 e Claude Opus 5.5).
- **Anthropic direta:** busca web na versão que o modelo aceita (`web_search_20260209`, com filtro dinâmico, nos Opus 4.6 a 5.5 e Sonnet 4.6 a 5.5; a básica nos demais) e `fallbacks: "default"` nos modelos com classificador de segurança (Opus 5 e 5.5, Sonnet 5.5, Fable 5.1): a recusa volta respondida por outro Claude em vez de erro.
- **Computer use:** laço só-acrescenta (os Claude 5.5 invalidam o pensamento se o cliente apaga print antigo); a limpeza dos prints é do servidor. Detalhes em `COMPUTADOR-DO-AGENTE.md`.

| Entrou ligado | Por quê |
|---|---|
| Claude Sonnet 5.5 | índice 56 (o Opus 5.5 tem 57,6) pela metade do preço; recomendado para estratégia, direção de arte, contexto, briefing e documentos (troca pelo dono) |
| GPT-6.1 Sol | índice 51,8 a US$ 2/10, lançado 29/09; recomendado para o conselho (segunda opinião de outra casa); faz computer use |
| Claude Fable 5.1 | o mais capaz da Anthropic (53,4 no índice, mas o mais forte em raciocínio longo); só na hora, US$ 10/50 |
| GPT-6 Astra | o mais capaz da OpenAI; só na hora, US$ 10/50 |
| Gemini 3.8 Flash | lê vídeo e áudio (Mesa Vídeos, Motion, Edição); US$ 0,75/3,75 |
| MiMo V2.6 Pro | índice 46,3 a US$ 0,44/0,87 e lê vídeo e áudio: o mais forte por dólar da lista |
| DeepSeek V4.1 Flash | índice 39,5 a US$ 0,02/0,40, JSON estrito e ferramentas: o mais barato que presta |
| Grok 4.7 | índice 46,4, 500 mil de contexto e 450 mil de saída: texto muito longo |

Ficaram de fora de propósito: GPT-6.1 Sol Pro, GPT-6 Sol Pro, GPT-6 Luna Pro e GPT-6 Astra Pro (o mesmo modelo com `reasoning.mode = pro`, que gasta muito mais tokens por resposta; o dono liga em Modelos de IA se quiser), as variantes `:batch` e os apelidos `~...-latest`.

### Imagem (01/10, `GET https://openrouter.ai/api/v1/images/models`, 55 modelos)

Critério: edita com referência (as mesas mandam logo, produto e foto real como referência), até US$ 0,08 por imagem e algo que o ligado ainda não cobre. O padrão do papel "imagem" continua no GPT Image 2.5 Sunburst (US$ 0,0103 por imagem média, 16 referências). GPT Image 2.5 Flare e Sunburst (09/09) e MAI-Image 2.6 (04/09) já estavam ligados.

| Entrou ligado | Preço por imagem (média, 1K) | Referências | Por quê |
|---|---|---|---|
| MAI-Image 2.6 Flash (04/09) | US$ 0,021 | 5 | mesma família do 2.6 pela metade do preço |
| Qwen Image 3 (05/08) | US$ 0,03 | 4 | texto pequeno nítido dentro da imagem (até 10 px) |
| Grok Imagine Image 2.0 (11/08) | US$ 0,04 | 3 | outra casa para comparar, edita com referência |
| FLUX.2 [max] | US$ 0,07 por megapixel | 8 | o topo da Black Forest Labs, com semente |

Ficaram de fora: Recraft V4.1 Flash (23/09, US$ 0,007, mas não aceita referência), Ming Image 0.1 Design e Design Layer (22 e 23/09, preço publicado zero: o custo na carteira não fecharia), Muse Image da Meta (26/08, sem provedor no OpenRouter), as variantes vetoriais e "pro" da Recraft (US$ 0,21 a 0,30 por imagem, 1 referência) e o Seedream 5.0 Lite (o Pro, ligado, custa só US$ 0,01 a mais).

### Custo da troca recomendada (o dono decide)

Uso real de 24 a 30/09 (`ia_usos`, só leitura) e o preço do Sonnet 5.5 (US$ 2/10, leitura de cache a US$ 0,20), sem contar os tokens de raciocínio, que o Sonnet 5.5 sempre gasta:

| Papel | Chamadas na semana | Hoje (GPT-6 Luna) | No Sonnet 5.5 |
|---|---|---|---|
| Estratégia | 212 | US$ 2,05 | US$ 16,33 |
| Direção de arte | 335 | US$ 0,34 | US$ 5,92 |
| Contexto | 63 | US$ 0,11 | US$ 1,71 |
| Briefing e conselho | 0 | US$ 0 | US$ 0 |
| **Total** | | **US$ 2,50 por semana** | **cerca de US$ 24 por semana** (+US$ 21,5, uns US$ 93 por mês) |

As chamadas também ficam mais lentas (raciocínio obrigatório), com risco de chegar ao teto de 150 s das funções.

## 1. Lançamentos que entraram

| Modelo | Id no OpenRouter | Id direto | Lançado | Preço | Contexto | Destaques |
|---|---|---|---|---|---|---|
| Claude Opus 5.5 | `anthropic/claude-opus-5.5` | `claude-opus-5-5` | 22/09 | 4 / 20 | 1M | índice AA 57,6 (o maior do catálogo); 1º no Design Arena em componentes e SVG, 2º em sites |
| Claude Sonnet 5.5 | `anthropic/claude-sonnet-5.5` | `claude-sonnet-5-5` | 28/09 | 2 / 10 | 1M | índice 56 pela metade do preço do Opus |
| Claude Fable 5.1 | `anthropic/claude-fable-5.1` | `claude-fable-5-1` | 01/09 | 10 / 50 | 1M | índice 53,4; caro para o que entrega aqui |
| GPT-6.1 Sol | `openai/gpt-6.1-sol` | `gpt-6.1-sol` | 29/09 | 2 / 10 | 1,05M | índice 51,8; raciocínio sempre ligado; faz computer use |
| GPT-6 Astra | `openai/gpt-6-astra` | `gpt-6-astra` | 03/09 | 10 / 50 | 1,05M | o maior da OpenAI; índice 52,7 |
| GPT-6 Luna | `openai/gpt-6-luna` | `gpt-6-luna` | 22/09 | 0,10 / 0,50 | 1,05M | o mais barato com visão, ferramentas e JSON |
| Gemini 3.8 Flash | `google/gemini-3.8-flash` | (sem conta direta) | 02/09 | 0,75 / 3,75 | 1M | lê áudio e vídeo |
| GPT Image 2.5 Sunburst | `openai/gpt-image-2.5-sunburst` | `gpt-image-2.5-sunburst` | 08/09 | US$ 0,0103 por imagem média, 0,041 alta | | segue o gerador de imagem mais novo da OpenAI |

Ficam de fora do catálogo, de propósito:
- **variante `:batch`** (preço de lote, servida só pela Batch API; não vale em chamada normal);
- **apelidos `~.../...-latest`** (apontam para outro modelo e mudam sozinhos de modelo e de preço).

## 2. O que o catálogo passou a ler (coluna `ia_modelos.recursos`)

`supabase/functions/_shared/recursos-dos-modelos.ts`, gravado pela sincronização diária (`ia-gateway`, `sincronizar_catalogo`, 06:17):

- ferramentas (`tools`), JSON e esquema estrito (`response_format`, `structured_outputs`);
- visão, PDF, áudio e vídeo de entrada;
- raciocínio obrigatório e nível padrão (`reasoning.mandatory`, `reasoning.default_effort`), além dos níveis que já entravam;
- preço da busca web, da escrita de cache de 5 min e de 1 h;
- saída máxima, data de lançamento, data de desligamento e o índice de inteligência da Artificial Analysis.

Modelo novo continua entrando **desligado e marcado como novo**. O dono liga em Modelos de IA.

## 3. O melhor modelo por papel

Lista em `src/lib/mesa/modelo-por-papel.ts`; a migration `20260930320100_modelo_por_papel.sql` traz a mesma lista. Vale o primeiro candidato que existe e está **ligado**. A migration liga o lote novo (seção 0), nunca desliga nada e só preenche papel sem padrão ligado. Trocar o padrão de um papel em uso é do dono, em Modelos de IA › "Aplicar a recomendação" (mostra o que muda, o preço de antes e de depois, e só grava no Confirmar).

Custo por chamada típica: estimativa própria, com os tamanhos de cada tarefa e o preço da tabela, sem cache.

| Papel | Recomendado | Chamada típica (entrada / saída) | Custo | Alternativa e por que não |
|---|---|---|---|---|
| Estratégia | Sonnet 5.5 | 30k / 8k | US$ 0,14 | Opus 5.5 custaria US$ 0,28 por um ganho pequeno (57,6 contra 56) |
| Diretor de arte | Sonnet 5.5 | 8k com imagem / 2k | US$ 0,04 | muitas lâminas por campanha; Opus dobra o custo |
| Gerador de imagem | GPT Image 2.5 Sunburst | 1 imagem | US$ 0,01 (média) a 0,04 (alta) | segue o mais novo da OpenAI |
| Leitura de imagem | GPT-6 Luna | 3k / 1k | US$ 0,001 | Gemini 3.8 Flash lê melhor, mas custa 7 vezes mais; MiMo V2.6 Pro é a terceira opção (lê vídeo) |
| Agente de contexto | Sonnet 5.5 | 40k / 4k | US$ 0,12 (US$ 0,05 com cache) | o contexto alimenta todos os agentes |
| Conteúdo rápido | GPT-6 Luna | 5k / 1k | US$ 0,001 | volume alto e resposta curta; DeepSeek V4.1 Flash é a reserva (mais barato, índice maior, sem visão de vídeo) |
| Proposta | Opus 5.5 | 25k / 10k | US$ 0,30 | texto que vende; o mais forte vale os centavos |
| Contrato | Opus 5.5 | 20k / 12k | US$ 0,32 | precisão jurídica |
| Briefing | Sonnet 5.5 | 10k / 2k por turno | US$ 0,04 | Luna (US$ 0,002) entende menos a conversa longa |
| Conselho | GPT-6.1 Sol | 30k / 4k | US$ 0,10 | outra casa (OpenAI) dá a segunda opinião; mesmo preço do Sonnet |
| Identidade visual | Opus 5.5 | 20k / 8k | US$ 0,24 | 1º no Design Arena (SVG e componentes) |
| Naming | Opus 5.5 | 8k / 3k | US$ 0,09 | criatividade barata em poucos tokens |
| Site | Opus 5.5 | 30k / 16k | US$ 0,44 | 1º em componentes, 2º em sites |
| Motion | Opus 5.5 | 20k / 12k | US$ 0,32 | código visual (Remotion, HyperFrames) |
| Documento | Sonnet 5.5 | 20k / 8k | US$ 0,12 | escreve bem pela metade do Opus |

Fable 5.1 e GPT-6 Astra (US$ 10 / 50) ficam fora dos padrões: custam 2,5 vezes o Opus 5.5 e têm índice menor. Continuam no catálogo para quem quiser escolher na hora.

## 4. Parâmetros no motor (`ia-motor` + `corpo-dos-provedores.ts`)

| Recurso | Anthropic direta | OpenAI direta | OpenRouter |
|---|---|---|---|
| Raciocínio | `thinking: {type: "adaptive"}` + `output_config.effort` (low a max) | `reasoning.effort` (none a max, conforme o modelo) | `reasoning.effort` |
| Esquema JSON | `output_config.format` json_schema | `text.format` json_schema estrito | `response_format` json_schema + `provider.require_parameters` |
| Cache de prompt | `cache_control` no system (5 min; "1h" quando pedido), liga sozinho com prompt grande | automático | `cache_control` no system dos modelos Claude |
| Busca web | `web_search_20260209` nos Opus/Sonnet 4.6 a 5.5, `web_search_20250305` nos demais; `allowed_domains`, local BR; citações | `web_search` com `filters.allowed_domains`, local BR e as fontes consultadas | ferramenta `openrouter:web_search` (engine auto = busca nativa do provedor); `:online` e o plugin `web` estão obsoletos |

O custo da escrita de cache entra pelo preço publicado (`recursos.cache_escrita_1m`, `cache_escrita_1h_1m`) ou por 1,25x e 2x a entrada. A busca web cobra pelo preço publicado do modelo. As páginas citadas voltam em `SaidaTexto.fontes` (o "Preencher com IA" já mostra como fonte).

Na tela, o `SeletorDeModelo` mostra "novo", visão, ferramentas, raciocínio e o preço por 1M. O `SeletorDeRaciocinio` marca o nível padrão e troca sozinho o nível que o modelo não aceita (ex.: "Sem raciocínio" no Claude 5.5 ou no GPT-6.1 Sol).

## 5. Fontes

- Anthropic: [computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) e [context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) (limpeza de prints no servidor), [modelos](https://platform.claude.com/docs/en/about-claude/models/overview), [preços](https://platform.claude.com/docs/en/about-claude/pricing), [effort](https://platform.claude.com/docs/en/build-with-claude/effort), [thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool), [Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5).
- OpenAI: [modelos](https://developers.openai.com/api/docs/models), [preços](https://developers.openai.com/api/docs/pricing), [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [web search](https://developers.openai.com/api/docs/guides/tools-web-search), [computer use](https://developers.openai.com/api/docs/guides/tools-computer-use), [changelog](https://developers.openai.com/api/docs/changelog).
- OpenRouter: [lista de modelos](https://openrouter.ai/api/v1/models) e [o que cada campo quer dizer](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [raciocínio](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [web search](https://openrouter.ai/docs/guides/features/server-tools/web-search), [variantes](https://openrouter.ai/docs/guides/routing/model-variants/overview), [cache](https://openrouter.ai/docs/guides/best-practices/prompt-caching).
- Lançamentos de setembro: [linha do tempo](https://llmgateway.io/timeline) (GPT-6.1 Sol 29/09, Sonnet 5.5 28/09, Opus 5.5 e GPT-6 Sol/Luna 22/09, MiMo V2.6 22/09, Grok 4.7 21/09).
- Google: [modelos Gemini](https://ai.google.dev/gemini-api/docs/models), [preços](https://ai.google.dev/gemini-api/docs/pricing).
