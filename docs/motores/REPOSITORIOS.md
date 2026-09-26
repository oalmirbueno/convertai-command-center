# Motores do painel: repositórios, skills e bases

Frente W, 25/09/2026. Pedido do dono: "reforce todos os motores internos; instale todos os repositórios que eu já tinha pedido, assim como skills. Ele tem que entender skills, tem que entender repositórios, porque são bases que vão se conversando... só que sem esses bugs bobos."

O painel roda em Edge Functions do Supabase. Um repositório do GitHub ou uma skill não "roda" lá dentro: instalar, aqui, é **ler o repositório, tirar o método útil e escrever em português um bloco curto que entra no prompt do agente certo**, escolhido por tarefa e com teto de tamanho. Nenhum servidor novo foi instalado em produção.

Onde está cada peça:

| Arquivo | Papel |
|---|---|
| `supabase/functions/_shared/conhecimento-repositorios.ts` | Os 13 blocos novos destilados dos repositórios (texto próprio, fonte citada em cada bloco) |
| `supabase/functions/_shared/conhecimento-dos-agentes.ts` | Escolhe os blocos por agente e tarefa, com teto e ordem de corte (já existia; ganhou os blocos novos e o agente sênior) |
| `supabase/functions/_shared/motores.ts` | **Índice único**: por motor, que blocos recebe, de qual skill ou repositório veio cada bloco, onde está a ligação no código e o que fica sem base de propósito |
| `src/test/motores.test.ts` | Cobra a promessa do índice: cada motor recebe os blocos prometidos com qualquer objetivo, a função da mesa chama a montagem, toda skill e todo repositório integrado chega a algum prompt |
| `docs/conhecimento/SKILLS-NO-SISTEMA.md` | Skills da máquina (plugins da Anthropic, skills de design) que já tinham sido destiladas antes |

## 1. Repositórios pedidos pelo dono

Licença conferida no arquivo LICENSE (ou no aviso de dados) de cada repositório em 25/09/2026. "Antes" é o que a auditoria achou no código hoje, antes desta frente.

| Repositório | O que dá | Onde entra agora (motor e bloco) | Antes | Agora | Licença | Como usamos |
|---|---|---|---|---|---|---|
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | 50 skills de marketing para agentes (criativo, anúncios, oferta, copy, pesquisa, conteúdo, lançamento) | Mesa Ads (ângulos, copy, pacote, oferta, conta, sênior), Mês (escrita, temas, campanha), Estúdio (direção, legenda), contexto. Blocos: `matriz_de_ganchos`, `portfolio_de_estaticos`, `fontes_do_criativo`, `meta_na_pratica`, `psicologia_do_comprador`, `revisao_em_sete_passadas`, `briefing_antes_de_criar`, `contexto_de_marketing`, `pesquisa_de_cliente`, `lancamento_e_isca`, `estrategia_de_conteudo`, `imagem_e_titulo` | faltando (só citado no dossiê da Mesa Ads e como linha de catálogo em `ads_referencias`) | integrado (13 skills; mapa completo na seção 3) | MIT | Resumo próprio em português, adaptado às regras da casa; nada copiado |
| [gntrs/swipefile](https://github.com/gntrs/swipefile) | App de biblioteca de anúncios: veredito (venceu, perdeu, testando, incerto), banco de ganchos, comparação | Mesa Ads (copy) em `fontes_do_criativo`: veredito da equipe manda, tempo no ar é pista | faltando (só catálogo) | parcial | MIT | Só o método. O app (CRM, chat, importadores) não se aplica: a Mesa Ads já tem biblioteca e ficha de referência |
| [nothingbutcici/product-swipefile](https://github.com/nothingbutcici/product-swipefile) | Método de pesquisa de produto com inventário de fatos | Contexto em `pesquisa_de_cliente`: estado de cada fato (verificado, incerto, inferido, estimado), "não consultado" não é "não existe", fronteira do concorrente | faltando (só catálogo) | integrado | MIT | Método resumido (o original é em chinês) |
| [nord342/ad-whisperer](https://github.com/nord342/ad-whisperer) | Transcrição local de vídeo e extração de gancho, CTA, estrutura e gatilhos | Mesa Ads (copy) em `fontes_do_criativo`: campos da decomposição de referência | faltando (só catálogo) | parcial | MIT | Só os campos. A ferramenta (Whisper, yt-dlp) não roda em Edge Function e o painel não produz vídeo |
| [no-chili/awesome-gpt-image-2-prompts](https://github.com/no-chili/awesome-gpt-image-2-prompts) | 1.642 prompts de GPT Image 2 (pôster, retrato, produto) | nenhum | faltando (só catálogo) | não se aplica | CC BY 4.0 só na curadoria e nos metadados; **os prompts são de terceiros e ficam fora da licença** (DATA_LICENSE.md) | Nenhum texto. A técnica de produto e pôster já vem das coleções CC0 abaixo |
| [EvoLinkAI/awesome-gpt-image-2-API-and-Prompts](https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts) | Galeria grande de prompts GPT Image 2 | Biblioteca da Mesa Foto (4 prompts citam) e `foto_de_produto_com_verdade` (diretor, variações, agente e campanha da Mesa Foto) | parcial (biblioteca como dado; a técnica não chegava ao diretor) | integrado | CC0 1.0 | Técnica reescrita |
| [YouMind-OpenLab/awesome-nano-banana-pro-prompts](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts) | Mais de 10 mil prompts Nano Banana Pro | Biblioteca da Mesa Foto (11 prompts citam como inspiração de estilo) | integrado (como dado da biblioteca) | integrado (como dado) | Texto declara CC BY 4.0; a API do GitHub hoje mostra NOASSERTION; prompts de criadores | Só inspiração; texto próprio. Nenhum bloco de prompt novo (licença não é limpa o bastante) |
| [JeremyGDM/awesome-ai-product-photography-prompts](https://github.com/JeremyGDM/awesome-ai-product-photography-prompts) | 122 modelos de foto de produto e as dicas "verdade do produto primeiro, uma tarefa por imagem" | Biblioteca da Mesa Foto (27 prompts) e `foto_de_produto_com_verdade`, `imagem_e_titulo` | parcial (biblioteca como dado; a técnica não chegava ao diretor) | integrado | CC0 1.0 | Modelos adaptados e dicas reescritas |
| [charlesdove977/advertising-ops](https://github.com/charlesdove977/advertising-ops) | Pipeline de mídia: raspar vencedores, decompor vídeo, briefing de diretor de marketing, gerar variações | Mesa Ads (oferta) em `briefing_antes_de_criar` (tipo, CTA único, oferta concreta, empurrar de volta a oferta vaga); `fontes_do_criativo` | faltando (só catálogo) | integrado | MIT | Método. A raspagem (Apify) e a geração (Higgsfield) não entram |
| [cenoura/awesome-ads](https://github.com/cenoura/awesome-ads) | Lista de ad tech e mídia programática | nenhum | faltando (só catálogo) | não se aplica | CC BY 4.0 | Parada desde 2023; nada de criativo nem de Meta para negócio local |
| [minimaxir/facebook-ad-library-scraper](https://github.com/minimaxir/facebook-ad-library-scraper) | Script de 2019 para a API oficial da Biblioteca (anúncios políticos) | nenhum | faltando (só catálogo) | não se aplica | MIT | A Mesa Ads já chama a mesma API (`ads_archive`) direto no código |
| [proxy-intell/facebook-ads-library-mcp](https://github.com/proxy-intell/facebook-ads-library-mcp) | Servidor MCP: anúncios de uma página pela ScrapeCreators, análise de imagem e vídeo pelo Gemini | nenhum (ver seção 5) | faltando (só catálogo) | avaliado, não instalado | MIT | Recomendação na seção 5 |
| [RamsesAguirre777/facebook-ads-library-mcp](https://github.com/RamsesAguirre777/facebook-ads-library-mcp) | Servidor MCP que raspa a página pública da Biblioteca com navegador, sem conta | nenhum (ver seção 5) | faltando (só catálogo) | avaliado, não instalado | MIT | Recomendação na seção 5 |

Regra de licença (a mesma da biblioteca da Mesa Foto): **técnica sim, texto literal não**. Mesmo nos repositórios MIT e CC0 os blocos são resumo próprio, com a fonte no comentário de cada bloco em `conhecimento-repositorios.ts`.

## 2. Bases da casa que já existiam

| Base | Arquivo | Motor que recebe | Estado |
|---|---|---|---|
| Pedro Sobral e Natália Torres | `_shared/conhecimento-especialistas-ads.ts` | Mesa Ads (todas as tarefas), agente sênior, Mesa Foto (agente e campanha: `criativo_natalia`) | integrado |
| Técnicas de design (diretor de arte) | `_shared/conhecimento-design.ts` e `_shared/direcao-arte.ts` (`PADRAO_DA_LAMINA`) | Estúdio: diretor (sistema) e gerador (prompt da lâmina) | integrado |
| Marketing (skills da Anthropic e de design destiladas) | `_shared/conhecimento-marketing.ts` | Mês, Estúdio, Mesa Ads, Mesa Foto, contexto | integrado; `conhecimentoMarketingPara("dossie")` existe mas **não está ligado** (Central e rituais, frentes R e S) |
| Conteúdo (tipos e frameworks) | `_shared/conhecimento-conteudo.ts` | Mês (base do estrategista, estrutura de cada pauta) | integrado |
| Social media | `_shared/conhecimento-social.ts` | Mês (escrita, temas, diagnóstico) | integrado |
| Ads | `_shared/conhecimento-ads.ts` | Mesa Ads e agente sênior (base inteira); Estúdio no modo anúncio (anatomia do estático, políticas da Meta, honestidade) | integrado |
| Biblioteca de prompts da Mesa Foto (138) | `docs/mesa-foto/biblioteca/`, `mesa-foto/biblioteca-semente.ts`, tabela `foto_biblioteca` | Mesa Foto: a equipe escolhe o prompt (guia "biblioteca" vira direção de estilo) e o agente vê os títulos no contexto | integrado como dado |
| Edição de vídeo: método Brabo (pacote público 2.0 de Fernando Araújo / Brabo Space, sem arquivo de licença: só o método, em palavras próprias) e o kit audiovisual V2 da casa | `_shared/conhecimento-edicao.ts` (índice em `motores.ts`: `mesa_videos.direcao_de_edicao`) | Mesa Vídeos: direção do Pacote para editar (aba Edição) | integrado (frente V2, 25/09). Computador do agente (Cua): avaliado, não instalado, desenho em `docs/motores/COMPUTADOR-DO-AGENTE.md` |

## 3. Skills do marketingskills no painel

O mapa completo (50 skills, com o motivo de cada uma) está em `SKILLS_MARKETINGSKILLS` de `motores.ts`; o teste exige que toda skill "integrada" tenha bloco prometido por algum motor.

| Skill | Bloco | Motor e tarefa que carrega |
|---|---|---|
| ad-creative | `matriz_de_ganchos`, `portfolio_de_estaticos`, `fontes_do_criativo`, `imagem_e_titulo` | Mesa Ads ângulos, copy e pacote; agente sênior; Estúdio direção |
| ads | `meta_na_pratica` | Mesa Ads pacote e conta; agente sênior |
| marketing-psychology | `psicologia_do_comprador` | Mesa Ads copy e oferta |
| copy-editing, copywriting | `revisao_em_sete_passadas` | Mesa Ads copy; Mês escrita; Estúdio legenda |
| offers | `briefing_antes_de_criar` (a equação de valor já estava em `CONHECIMENTO_OFERTA`) | Mesa Ads oferta |
| product-marketing | `contexto_de_marketing` | Contexto (montar e conversar) |
| customer-research, competitor-profiling | `pesquisa_de_cliente` | Contexto |
| launch, lead-magnets | `lancamento_e_isca` | Mês campanha |
| content-strategy, social | `estrategia_de_conteudo` | Mês temas |

Cobertas pela base que já existia (sem bloco novo): ab-testing, attribution, marketing-plan, marketing-ideas, emails, seo-audit. Não se aplicam (site, app, SaaS, B2B, vídeo, escolha de ferramenta): as outras 31, cada uma com o motivo no índice.

## 4. Motores e o que cada um recebe

Números em caracteres dos blocos (sem a frase de prioridade de cerca de 500), com objetivo "vendas" quando a tarefa aceita.

| Motor | Função | Blocos novos (Frente W) | Antes | Agora | Teto |
|---|---|---|---|---|---|
| Estúdio, direção | estudio-arte | `imagem_e_titulo` | 5.905 | 6.426 | 6.700 |
| Estúdio, legenda | estudio-arte | `revisao_em_sete_passadas` | 3.268 | 4.293 | 4.700 |
| Mês, escrita | agente-calendario | `revisao_em_sete_passadas` | 10.819 | 11.844 | 12.100 |
| Mês, temas | agente-calendario | `estrategia_de_conteudo` | 11.685 | 12.702 | 13.900 |
| Mês, diagnóstico | agente-calendario | nenhum | 10.556 | 10.556 | 11.000 |
| Mês, campanha | agente-calendario | `lancamento_e_isca` | 7.163 | 8.223 | 8.900 |
| Mesa Ads, ângulos | mesa-ads | `matriz_de_ganchos`, `portfolio_de_estaticos` | 11.856 | 14.505 | 14.900 |
| Mesa Ads, copy | mesa-ads | `matriz_de_ganchos`, `fontes_do_criativo`, `psicologia_do_comprador`, `revisao_em_sete_passadas` | 7.493 | 12.066 | 12.500 |
| Mesa Ads, pacote | mesa-ads | `portfolio_de_estaticos`, `meta_na_pratica` | 11.856 | 14.862 | 14.900 |
| Mesa Ads, oferta | mesa-ads | `briefing_antes_de_criar`, `psicologia_do_comprador` | 4.681 | 7.085 | 7.700 |
| Mesa Ads, conta | mesa-ads | `meta_na_pratica` | 4.290 | 5.684 | 6.000 |
| Mesa Ads, agente sênior | mesa-ads | `meta_na_pratica`, `portfolio_de_estaticos` | até 13.000 | 14.626 | 15.900 |
| Mesa Foto, agente e campanha | mesa-foto | `foto_de_produto_com_verdade` | 4.612 | 5.939 | 6.300 |
| Mesa Foto, diretor e variações | mesa-foto | `foto_de_produto_com_verdade` (antes não recebia nada) | 0 | 1.325 | 1.800 |
| Contexto | agente-contexto | `contexto_de_marketing`, `pesquisa_de_cliente` | 6.416 | 9.226 | 9.700 |

O sistema inteiro do estrategista da Mesa Ads fica abaixo de 58.000 caracteres (era abaixo de 56.000); o do diretor do Estúdio abaixo de 53.300 (era 52.500). Os testes antigos foram ajustados só nesses limites.

Ordem de prioridade (vai no começo de cada bloco): dado real do cliente e kit da marca > base principal do agente > especialistas (Sobral e Natália) > marketing (skills e repositórios). Os blocos dos repositórios são os primeiros a sair quando o teto aperta, depois dos de marketing, antes dos especialistas.

Sem base de propósito (está escrito em `SEM_BASE_DE_PROPOSITO`, para ninguém "consertar"):

- Texto ao gerador de imagem do Estúdio (`promptDaLamina`, `promptDoReplicar`): o gerador entende posição, escala e cor, não método de marketing. Não foi tocado; o Estúdio foi aprovado pelo dono em 3 gerações reais hoje.
- Mesa Foto: leitor, kits, conferência e identificação.
- Contexto: leitura e acervo.
- Central e rituais: frentes R e S.
- MCP: não tem prompt próprio; as ações de mesa passam pela ponte (`mcp-mesas-ponte.ts`) e chamam as funções acima, que já montam o conhecimento.

## 5. MCPs da Biblioteca de Anúncios da Meta: vale como fonte do agente sênior?

Situação atual: o agente sênior (`mesa-ads`, `pesquisarBibliotecaMeta`) já chama a API oficial `ads_archive` com o token do cofre (`ads_token_para_biblioteca`), só leitura. **No Brasil essa API devolve só anúncios de tema social, eleitoral ou político**; anúncio comercial do nicho fica na pesquisa web. O código já diz isso ao agente.

| Opção | Como funciona | Custo e risco | Recomendação |
|---|---|---|---|
| API oficial (atual) | `graph.facebook.com/v21.0/ads_archive` com o token do cofre | Grátis; pouco útil para comercial no Brasil (só UE e Reino Unido têm todos os tipos) | **Manter** como está |
| proxy-intell/facebook-ads-library-mcp | MCP em Python; busca a página de uma marca e os anúncios dela pela ScrapeCreators (`x-api-key`), analisa vídeo pelo Gemini | Pago por crédito (ScrapeCreators) e chave do Gemini; é servidor MCP (Python, cache em disco), não roda em Edge Function; busca por marca, não por palavra | **Não instalar.** Se o dono quiser anúncios comerciais de concorrentes conhecidos, o caminho mais simples é a Edge Function chamar a API da ScrapeCreators direto (sem MCP), por página de concorrente cadastrada no contexto, chave só em `Deno.env`, cache de uma semana por concorrente, desligado por padrão e com o resultado marcado como E2 (tempo no ar é pista, não prova). Precisa da decisão e da conta do dono |
| RamsesAguirre777/facebook-ads-library-mcp | MCP que abre a página pública com navegador headless (crawl4ai, Playwright) e lê os cartões | Grátis, mas raspa a Biblioteca sem conta (os termos da Meta proíbem coleta automatizada), quebra quando o layout muda, o próprio autor diz que não tem cache nem controle de limite; navegador não roda em Edge Function | **Não usar** em produção |
| minimaxir/facebook-ad-library-scraper | Script da API oficial | Mesmo limite da API oficial | Não se aplica (já temos) |
| Equipe, fora do painel | A página pública da Biblioteca e, no Claude Code desta máquina, o MCP `meta` (`meta_search_ad_library`) | Uso humano, caso a caso | Bom para a equipe pesquisar e salvar a referência na biblioteca da Mesa Ads (ficha com veredito) |

## 6. Como acrescentar um repositório ou uma skill

1. Ler o repositório e conferir a licença (LICENSE e aviso de dados). Sem licença de uso do texto: só técnica, nunca frase.
2. Escrever o bloco em `conhecimento-repositorios.ts`: curto, em português, com as regras da casa e a fonte no comentário. Nada de número de resultado inventado.
3. Registrar o id em `ORIGEM_DOS_BLOCOS` (e a skill em `SKILLS_MARKETINGSKILLS`, se for do marketingskills) e a fonte em `FONTES`, em `motores.ts`.
4. Pôr o bloco na tarefa certa em `conhecimento-dos-agentes.ts`, com uma ordem de corte menor que a dos especialistas, e subir o teto só o necessário.
5. Pôr o id em `promete` do motor em `motores.ts`.
6. Rodar `npx vitest run src/test/motores.test.ts src/test/conhecimento-dos-agentes.test.ts` e `deno check` na função. Se o teste reclamar de teto, o bloco está grande demais ou a tarefa errada.

## 7. O que ficou de fora

- Estúdio no modo anúncio: `docs/conhecimento/COMO-INTEGRAR.md` pede o checklist de criativo do objetivo na direção; não foi ligado (mexeria no código do Estúdio, que acabou de ser aprovado). Candidato para uma rodada própria.
- Dossiê, esteira, coach e rituais: `conhecimentoMarketingPara("dossie")` continua sem ligação (frentes R e S).
- Leitor de referências da Mesa Ads (`SISTEMA_DO_LEITOR`): continua com a ficha própria; os campos de decomposição dos repositórios estão no copy e podem entrar no leitor numa rodada da Mesa Ads.
- Nada foi instalado como servidor; nenhuma migration, nenhuma chave nova.
