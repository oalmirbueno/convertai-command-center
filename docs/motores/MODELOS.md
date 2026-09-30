# Modelos de IA do painel: o que há de novo e o melhor por papel

Frente MOD, 30/09/2026. Pedido do dono: atualizar o painel com os lançamentos da Anthropic e da OpenAI, escolher os melhores modelos, ligar o computer use pela API e conectar tudo ao painel.

Os fatos foram conferidos em 29/09/2026 nas páginas oficiais e na lista pública do OpenRouter (`GET https://openrouter.ai/api/v1/models`, 464 modelos). Preços em dólar por 1 milhão de tokens (entrada / saída).

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

Lista em `supabase/functions/_shared/modelo-por-papel.ts`; a migration `20260930220100_modelo_por_papel.sql` grava a mesma lista. Vale o primeiro candidato que existe e está **ligado**. A migration não liga nem desliga nada: com Sonnet 5.5 e GPT-6.1 Sol ainda desligados, os papéis deles caem no próximo candidato ligado. Depois de ligar, o dono usa Modelos de IA › "Aplicar a recomendação" (mostra o que muda e só grava no Confirmar).

Custo por chamada típica: estimativa própria, com os tamanhos de cada tarefa e o preço da tabela, sem cache.

| Papel | Recomendado | Chamada típica (entrada / saída) | Custo | Alternativa e por que não |
|---|---|---|---|---|
| Estratégia | Sonnet 5.5 | 30k / 8k | US$ 0,14 | Opus 5.5 custaria US$ 0,28 por um ganho pequeno (57,6 contra 56) |
| Diretor de arte | Sonnet 5.5 | 8k com imagem / 2k | US$ 0,04 | muitas lâminas por campanha; Opus dobra o custo |
| Gerador de imagem | GPT Image 2.5 Sunburst | 1 imagem | US$ 0,01 (média) a 0,04 (alta) | segue o mais novo da OpenAI |
| Leitura de imagem | GPT-6 Luna | 3k / 1k | US$ 0,001 | Gemini 3.8 Flash lê melhor, mas custa 7 vezes mais |
| Agente de contexto | Sonnet 5.5 | 40k / 4k | US$ 0,12 (US$ 0,05 com cache) | o contexto alimenta todos os agentes |
| Conteúdo rápido | GPT-6 Luna | 5k / 1k | US$ 0,001 | volume alto e resposta curta |
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
| Busca web | `web_search_20250305` (direta), `allowed_domains`, local BR; citações | `web_search` com `filters.allowed_domains`, local BR e as fontes consultadas | ferramenta `openrouter:web_search` (engine auto = busca nativa do provedor); `:online` e o plugin `web` estão obsoletos |

O custo da escrita de cache entra pelo preço publicado (`recursos.cache_escrita_1m`, `cache_escrita_1h_1m`) ou por 1,25x e 2x a entrada. A busca web cobra pelo preço publicado do modelo. As páginas citadas voltam em `SaidaTexto.fontes` (o "Preencher com IA" já mostra como fonte).

Na tela, o `SeletorDeModelo` mostra "novo", visão, ferramentas, raciocínio e o preço por 1M. O `SeletorDeRaciocinio` marca o nível padrão e troca sozinho o nível que o modelo não aceita (ex.: "Sem raciocínio" no Claude 5.5 ou no GPT-6.1 Sol).

## 5. Fontes

- Anthropic: [modelos](https://platform.claude.com/docs/en/about-claude/models/overview), [preços](https://platform.claude.com/docs/en/about-claude/pricing), [effort](https://platform.claude.com/docs/en/build-with-claude/effort), [thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool), [Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5).
- OpenAI: [modelos](https://developers.openai.com/api/docs/models), [preços](https://developers.openai.com/api/docs/pricing), [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [web search](https://developers.openai.com/api/docs/guides/tools-web-search), [computer use](https://developers.openai.com/api/docs/guides/tools-computer-use), [changelog](https://developers.openai.com/api/docs/changelog).
- OpenRouter: [lista de modelos](https://openrouter.ai/api/v1/models) e [o que cada campo quer dizer](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [raciocínio](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [web search](https://openrouter.ai/docs/guides/features/server-tools/web-search), [variantes](https://openrouter.ai/docs/guides/routing/model-variants/overview), [cache](https://openrouter.ai/docs/guides/best-practices/prompt-caching).
- Google: [modelos Gemini](https://ai.google.dev/gemini-api/docs/models), [preços](https://ai.google.dev/gemini-api/docs/pricing).
