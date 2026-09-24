# Mesa Foto: pesquisa da biblioteca de prompts e referências

Frente D (pesquisa e curadoria). Data: 2026-09-24. Tudo abaixo foi aberto e conferido nesta data (GitHub API, arquivos LICENSE, chamadas reais à API do Openverse e do Wikimedia Commons). Complementa `docs/mesa-foto/pesquisa/` (que cobriu modelos e ferramentas, não coleções de prompts nem bancos de imagem).

Arquivos desta pasta:

| Arquivo | O que é |
| --- | --- |
| `biblioteca.json` | Fonte da verdade: 138 prompts com PT, EN, negativo, tags, fonte, licença, uso, destaque |
| `montar_biblioteca.py` | Script que escreve o `biblioteca.json` (conteúdo e validações: título único, 20 destaques, sem travessão) |
| `gerar_seed.py` | Lê o JSON e gera o `seed.sql` (`python -B gerar_seed.py`) |
| `seed.sql` | Insere os prompts em `public.foto_biblioteca`, idempotente. Testado em Postgres local (PGlite): 1a execução 138 linhas, 2a execução 0 novas, com e sem a coluna `uso` |

## 1. Regra de licença que adotamos

Todos os 138 prompts são **texto próprio da Aceleriq**. Nenhum prompt foi copiado literalmente de coleção de terceiros. O campo `fonte_nome`/`fonte_url` registra de onde veio a técnica e `licenca` registra a situação da fonte.

Motivo: as coleções "awesome" juntam prompts escritos por criadores no X. A licença do repositório (MIT, CC BY) cobre a curadoria, mas não prova que cada autor cedeu o texto. O próprio repositório `youart-open-source/awesome-gpt-image-2-5-prompts` diz isso no LICENSE: os prompts "não são nossos para dar" e a cadeia de direitos não foi verificada. Além disso, há divergência entre o LICENSE e o README em vários repositórios (tabela abaixo). Por isso: técnica sim, texto literal não.

Única exceção de modelo adaptado: `JeremyGDM/awesome-ai-product-photography-prompts` é CC0 1.0 (LICENSE confirmado, "free to copy, adapt, and use commercially without attribution"). Mesmo assim reescrevemos em português e no padrão da casa.

## 2. Repositórios de prompts avaliados

Metadados pela GitHub API em 2026-09-24. "LICENSE" é o arquivo do repositório; "README" é o que o texto declara.

| Repositório | LICENSE | README declara | Estrelas | Último push | O que entrega | Como usamos |
| --- | --- | --- | --- | --- | --- | --- |
| [JeremyGDM/awesome-ai-product-photography-prompts](https://github.com/JeremyGDM/awesome-ai-product-photography-prompts) | CC0-1.0 | CC0 1.0 | 3 | 2026-08-09 | 122 pares imagem+prompt e modelos com `[colchetes]` para fundo branco, detalhe, lifestyle, pôster, alimento, imagem para vídeo; dicas "verdade do produto primeiro, uma tarefa por imagem" | Base estrutural de produto, alimento e composição (27 itens citam) |
| [EvoLinkAI/awesome-gpt-image-2-API-and-Prompts](https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts) | CC0-1.0 | CC0 1.0 | 17.240 | 2026-07-18 | Galeria grande de prompts GPT Image 2 e exemplos de API | Inspiração de cenas de produto (água, splash, flutuante) |
| [YouMind-OpenLab/awesome-nano-banana-pro-prompts](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts) | CC BY 4.0 (texto) | CC BY 4.0 | 13.482 | 2026-09-24 | Mais de 10 mil prompts Nano Banana Pro em 16 idiomas, com prévias | Inspiração de estilos (tropical, luxo discreto, retrô, natural) |
| [YouMind-OpenLab/ai-image-prompts-skill](https://github.com/YouMind-OpenLab/ai-image-prompts-skill) | MIT | MIT | 1.133 | 2026-09-24 | Skill de agente que busca na coleção acima | Referência de como expor a coleção a um agente |
| [ZeroLu/awesome-gpt-image](https://github.com/ZeroLu/awesome-gpt-image) | MIT | CC BY 4.0 (divergente) | 2.225 | 2026-09-24 | Prompts GPT Image 2 e 2.5 de criadores no X | Inspiração de estilo UGC e bastidores |
| [ZeroLu/awesome-nanobanana-pro](https://github.com/ZeroLu/awesome-nanobanana-pro) | MIT | CC BY 4.0 (divergente) | 10.323 | 2026-09-24 | Prompts Nano Banana Pro | Consulta; nada copiado |
| [PicoTrex/Awesome-Nano-Banana-images](https://github.com/PicoTrex/Awesome-Nano-Banana-images) | Apache-2.0 | CC BY 4.0 (divergente) | 23.784 | 2026-09-03 | Casos de edição com Nano Banana (troca de fundo, luz, ângulo) | Consulta para modos Preservar e Novo cenário |
| [jamez-bondos/awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images) | CC BY 4.0 com exceções (NOTICE) | idem | 8.153 | 2025-05-26 | Casos GPT-4o e gpt-image-1 | Consulta; parado desde 2025 |
| [JimmyLv/awesome-nano-banana](https://github.com/JimmyLv/awesome-nano-banana) | CC BY 4.0 com exceções (mesmo NOTICE do anterior) | idem | 8.808 | 2025-09-08 | Casos Nano Banana 1 | Consulta; parado |
| [ImgEdify/Awesome-GPT4o-Image-Prompts](https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts) | MIT | MIT | 586 | 2025-05-15 | Dicionário de prompts GPT-4o | Consulta; parado |
| [devanshug2307/Awesome-AI-Image-Prompts](https://github.com/devanshug2307/Awesome-AI-Image-Prompts) | MIT | MIT | 268 | 2026-08-08 | Mais de mil prompts, vários em JSON, inclui produto e retrato | Consulta do formato JSON estruturado |
| [youart-open-source/awesome-gpt-image-2-5-prompts](https://github.com/youart-open-source/awesome-gpt-image-2-5-prompts) | Scripts MIT; prompts NÃO licenciados | idem | 146 | 2026-09-11 | 150 prompts creditados por autor | Não usar texto; serve de alerta de licença |
| cliprise/awesome-ai-product-photography-prompts | sem licença | CC0 citado em artigo externo, não no repositório | 8 | 2026-04-28 | Modelos de e-commerce | Não usar (sem LICENSE) |
| AIGC-Hackers/awesome-ai-image-prompts-claude | sem licença na API | README cita MIT + CC BY | 1 | 2025-12-16 | 1.268 prompts | Não usar |

## 3. Guias técnicos (luz, câmera, composição)

| Fonte | Licença do texto | O que tiramos |
| --- | --- | --- |
| [OpenAI Cookbook: GPT Image prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide) (repositório `openai/openai-cookbook` MIT) | MIT | Linguagem fotográfica (lente, luz, enquadramento), "mude só X, mantenha o resto", repetir a lista do que preservar a cada iteração, fundo transparente com PNG/WebP |
| [Google Developers Blog: prompts para Gemini Image](https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/) | Termos do Google | Modelo "foto realista de [tomada] de [assunto] em [ambiente], luz [x], clima [y]"; composição com várias imagens; "negativo semântico" (descrever o desejado em vez de negar) |
| [Black Forest Labs: Prompt Reference](https://docs.bfl.ai/guides/prompting_unified_reference) e [Technical Parameters](https://docs.bfl.ai/guides/prompting_unified_technical) | Documentação; skills oficiais em [black-forest-labs/skills](https://github.com/black-forest-labs/skills) (MIT) | Tabela de abertura e lente (f/1.4 a f/16, 24 a 135 mm), palavras de luz; **a maioria dos modelos FLUX não aceita prompt negativo**: trocar "sem X" pelo que deve ocupar o espaço; cor por HEX |
| [Midjourney: parâmetro --no](https://docs.midjourney.com/hc/en-us/articles/32173351982093-No) | Documentação | `--no` equivale a peso -0.5; cada palavra é lida isolada pela moderação, então usar poucas palavras |
| [BytePlus ModelArk: guia do Seedream 4.x](https://docs.byteplus.com/en/docs/ModelArk/1829186) | Documentação | Linguagem natural "assunto + ação + ambiente", conciso vence empilhar adjetivos |
| [Shopify: fotografia de produto](https://help.shopify.com/en/manual/products/product-media/product-photography) e [alimentos](https://www.shopify.com/blog/food-photography-tips) | Termos Shopify | Consistência de série, escala, luz natural, ângulos para comida |
| [Adobe: fotografia de produto](https://www.adobe.com/uk/creativecloud/photography/discover/product-photography.html) | Termos Adobe | Tenda de luz, fundo infinito, frontal ortográfico |
| Wikipedia (Three-point lighting, Rembrandt, Butterfly, High-key, Gobo, Softbox, Rule of thirds, Leading lines, Depth of field, Food photography, Architectural photography etc.) | CC BY-SA 4.0 | Só o conceito técnico; nenhum texto copiado |

Regra sobre o campo `negativo` da semente: está em português, como lista. Na hora de gerar: GPT Image e Gemini aceitam como frase "Evite: ..." no fim; FLUX deve reescrever em positivo (ex. "rótulo reto e legível" em vez de "sem rótulo torto"); Midjourney usa `--no` com poucas palavras.

## 4. Bancos de imagens de referência

### Openverse (recomendado, sem chave)

Conferido na documentação OpenAPI (`https://api.openverse.org/v1/schema/`) e com chamadas reais.

- Endpoint: `GET https://api.openverse.org/v1/images/`
- Parâmetros úteis: `q` (até 200 caracteres), `license_type` (`all`, `all-cc`, `commercial`, `modification`, separados por vírgula), `license` (`by`, `by-sa`, `by-nd`, `by-nc`, `by-nc-sa`, `by-nc-nd`, `cc0`, `pdm`, `sampling+`, `nc-sampling+`), `category` (`photograph`, `illustration`, `digitized_artwork`), `aspect_ratio` (`square`, `tall`, `wide`), `size` (`small`, `medium`, `large`), `source` e `excluded_source` (lista em `/v1/images/stats/`), `extension`, `mature`, `filter_dead`, `page`, `page_size`. `tags`/`title`/`creator` não combinam com `q`.
- Campos devolvidos por item: `id`, `title`, `url`, `thumbnail` (proxy `.../v1/images/{id}/thumb/`), `foreign_landing_url`, `creator`, `creator_url`, `license`, `license_version`, `license_url`, `attribution` (texto pronto de crédito), `provider`, `source`, `category`, `width`, `height`, `tags`, `mature`, `detail_url`, `related_url`. Topo: `result_count`, `page_count`, `page_size`, `page`.
- Limites anônimos medidos nos cabeçalhos: **20 requisições por minuto e 200 por dia** (`x-ratelimit-limit-anon_burst`, `anon_sustained`); **`page_size` no máximo 20**; **profundidade máxima 240 resultados** (com 20 por página, página 12 é a última; página 13 devolve erro "pagination depth may not exceed 240"). Com registro OAuth (`POST /v1/auth_tokens/register/` e depois `/v1/auth_tokens/token/` com client_credentials, `Authorization: Bearer`) o limite sobe um pouco e a página pode ser maior; a profundidade continua 240. Os termos proíbem raspagem.
- Maiores fontes: Flickr (536 mi), iNaturalist, Wikimedia Commons (89 mi), Europeana, Rawpixel (1,2 mi), StockSnap (40 mil, CC0 e com boa foto de produto e comida), WP Photo Directory (CC0).
- Teste real: `q=food photography&license_type=commercial,modification&category=photograph` trouxe foto CC0 do StockSnap 3000x1997 em primeiro lugar.

### Wikimedia Commons (sem chave)

`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=<termo> filetype:bitmap&gsrnamespace=6&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=960&format=json`. Licença e autor vêm por arquivo em `extmetadata` (`LicenseShortName`, `Artist`, `UsageTerms`). Exige `User-Agent` identificando o app e um contato (usar e-mail de contato da agência, não de pessoa). O Openverse já indexa o Commons, então só vale chamar direto se precisar do metadado completo.

### Exigem chave (cadastro do dono, chave só no servidor)

| Banco | Chave | Limite | Regras que pesam para a Mesa Foto |
| --- | --- | --- | --- |
| [Unsplash API](https://unsplash.com/documentation) | Access Key (Client-ID) | 50 req/h em demonstração, 1.000 req/h após aprovação | Obriga hotlink das URLs devolvidas, chamar `/photos/:id/download` a cada download e creditar fotógrafo e Unsplash; `per_page` até 30 |
| [Pexels API](https://www.pexels.com/api/documentation/) | Header `Authorization` | 200 req/h e 20 mil/mês | Link visível para o Pexels e crédito ao fotógrafo; `locale=pt-BR`; `per_page` até 80 |
| [Pixabay API](https://pixabay.com/api/docs/) | Parâmetro `key` | 100 req por 60 s | Cache obrigatório de 24 h; proibido hotlink permanente (baixar para o próprio bucket); `lang=pt`, `image_type=photo`, `per_page` até 200 |

### Paletas

- [The Color API](https://www.thecolorapi.com/docs): sem chave (testado: `/scheme?hex=880516&mode=analogic&count=5`), mas a documentação não declara termos nem limite.
- Colormind: a própria página diz que a API é gratuita só para uso pessoal e não comercial. **Não usar.**
- Recomendação: gerar paleta no código a partir das fotos aprovadas e do HEX da marca (cálculo, sem IA e sem terceiro).

## 5. Como integrar

1. **Prompts**: aplicar `seed.sql` depois da migration da `foto_biblioteca` (frente A). Itens da agência ficam com `client_id` nulo; "salvar como meu" cria cópia do cliente (já previsto em `biblioteca_salvar`).
2. **Busca de referências (Openverse)** na função `mesa-foto` (`referencias_buscar`), já esboçada em `supabase/functions/mesa-foto/calculos.ts` (`urlDoOpenverse`, `itensDoOpenverse`). Ajustes recomendados na seção 7.
3. **Filtro de licença por uso**:
   - Só olhar como moodboard: `license_type=commercial`.
   - Anexar a imagem como referência de estilo na geração: `license_type=commercial,modification` (exclui ND e NC). Preferir `license=cc0,pdm,by`; `by-sa` obriga a compartilhar o derivado sob a mesma licença, então só com decisão da equipe.
   - Referência de terceiro **nunca** é referência de identidade (regra do contrato).
4. **Importar**: baixar a imagem para o bucket (não depender do hotlink), gravar `fonte_nome`, `fonte_url` (`foreign_landing_url`), `licenca` com versão, `autor`, e guardar o texto de `attribution` do Openverse para crédito.
5. **Unsplash, Pexels e Pixabay**: só depois que o dono criar as contas; chave em segredo da função, nunca no front. Unsplash conflita com "baixar para o bucket" (exige hotlink), então é o último da fila.
6. **Julgamento**: se um dia a mesa precisar ranquear resultados do Openverse contra o briefing do cliente, isso é passo de julgamento e deve usar o Jev (Score), conforme a regra da casa; a busca em si é chamada exata e fica no código.

## 6. As 10 melhores recomendações

1. Aplicar a semente como está e começar a medir quais prompts a equipe usa (os 20 destaques cobrem os pedidos mais comuns: packshot branco, lifestyle, prato a 45 graus, retrato corporativo, interior).
2. Openverse como busca padrão de referências, com `category=photograph` e `license_type=commercial,modification` por padrão.
3. Priorizar as fontes CC0 do Openverse (StockSnap, WP Photo Directory) com `source=stocksnap,wordpress` num botão "só livres de crédito".
4. Tratar o `negativo` por modelo (frase "Evite" em GPT/Gemini, positivo em FLUX, `--no` curto em Midjourney) no montador de prompt da função.
5. Sempre anexar as fotos do kit antes do prompt e manter o trecho de identidade ("mantenha forma, proporções, cor, material e texto do rótulo") que já vem em quase todos os prompts de produto.
6. Nunca gerar texto de preço, nome ou aviso legal dentro da foto; título entra depois na Mesa (técnica do repositório CC0 e da OpenAI).
7. Usar os prompts de "série consistente" para cardápios e catálogos com muitos itens (mesmo ângulo, luz e fundo).
8. Pessoas: usar só os prompts da categoria `pessoa`, que já trazem a trava de rosto, idade e corpo; "Tratar luz e cor" e "Trocar o fundo" mapeiam os modos Tratar luz e cor e Preservar.
9. Registrar OAuth do Openverse para a função (limite um pouco maior) e guardar cache de 24 h por termo para não estourar 200 buscas por dia.
10. Revisar a biblioteca a cada trimestre olhando as coleções CC0 (JeremyGDM, EvoLinkAI) e os guias oficiais (OpenAI, BFL, Google) para novas técnicas, sempre reescrevendo com texto próprio.

## 7. Achados para as outras frentes

- **Frente A, Openverse, profundidade**: `urlDoOpenverse` aceita `pagina` até 20 com `page_size=20`; sem autenticação a profundidade máxima é 240, então páginas 13 a 20 falham. Limitar a 12 (ou `ceil(240 / page_size)`).
- **Frente A e B, miniatura**: o servidor devolve `thumb`; o front (`normalizarEncontrada` em `src/components/mesa-foto/fotoApi.ts`) lê `miniatura_url` ou `thumbnail`, então cai na imagem cheia. Alinhar o nome do campo.
- **Frente A e B, chave e autor**: o servidor não devolve `id` nem `autor_url`; o front gera `achada-N` e deixa o link do autor vazio. Incluir `id` e `creator_url`.
- **Frente A e B, licença**: o servidor já formata "CC BY 4.0" e o front aplica `toUpperCase`, o que vira "DOMÍNIO PÚBLICO (PDM)". Formatar num lado só.
- **Frente B, categorias**: `CATEGORIAS_DA_BIBLIOTECA` só tem estilo, composição, luz, cenário. A semente usa também produto, alimento, bebida, cosmetico, moda, tecnologia, pessoa, ambiente; sem rótulo, a tela mostra o valor cru ("cosmetico" sem acento).
- **Frente A, coluna `uso`**: proposta `alter table public.foto_biblioteca add column uso text;`. O `seed.sql` preenche automaticamente se a coluna existir. Se houver `check` em `categoria`, incluir as 11 categorias acima.
