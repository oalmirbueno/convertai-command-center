# Pesquisa v2: fontes, ferramentas e práticas para criativo de anúncio

Frente D da Mesa Ads v2. Pesquisa feita em 24/09/2026 com busca na web e abertura das páginas (WebSearch e WebFetch). Complementa o DOSSIE-CRIATIVOS.md (23/09/2026). O que virou regra está em `supabase/functions/_shared/conhecimento-ads.ts` (versão 2026-09-24.2) e a semente de padrões em `docs/mesa-ads/v2/biblioteca-padroes.json`.

Legenda de verificação:
- **Oficial aberto**: página da própria plataforma ou do órgão aberta e lida nesta rodada.
- **Terceiro aberto**: página de terceiro aberta e lida; a afirmação é do terceiro.
- **Só busca**: aparece no resumo do buscador, página não aberta ou não carregou. Tratar como não verificado.

## 1. Resposta curta e recomendação

1. **A API da Biblioteca de Anúncios da Meta não serve para anúncio comercial veiculado só no Brasil.** Confirmado na documentação oficial do endpoint `ads_archive`: com `ad_type=ALL`, "anúncios que não alcançaram nenhum local da UE só voltam se forem sobre temas sociais, eleições ou política". O Brasil aparece em `ad_reached_countries`, mas para comercial só volta o que também rodou na UE. Não integrar para pesquisa de concorrente brasileiro.
2. **A Biblioteca de Anúncios pela interface mostra todos os anúncios ativos de qualquer país, sem login.** É o caminho legal para referência de concorrente: a equipe abre, copia o link e o painel importa por URL (ação `referencia_importar_url` da frente A). Automatizar a coleta da interface (scraper) esbarra nos Termos de Coleta Automatizada de Dados da Meta, que proíbem coleta sem permissão.
3. **O servidor MCP oficial da Meta (mcp.facebook.com/ads, lançado em 29/04/2026) é para a conta do anunciante**: relatórios, criação e gestão de campanhas, catálogos, sinais, testes A/B e registro de atividade. A documentação oficial não menciona busca na Biblioteca. Útil para a "conta ao vivo" no futuro; hoje o painel já coleta pela API de Marketing.
4. **Andromeda é oficial; "entity ID" é leitura de mercado.** A Meta publicou (Engineering, 02/12/2024) o Andromeda como sistema de recuperação de anúncios e, no blog de negócios, recomenda diversificação criativa: temas, mensagens e visuais realmente diferentes para motivações diferentes, distinguindo isso de iteração. A ideia de que anúncios parecidos são agrupados num só "entity ID" vem de agências e ferramentas, não de documento oficial aberto nesta rodada.
5. **Consequência prática para o plano**: cada ângulo precisa de estilo visual, situação e prova diferentes. Por isso entraram 22 estilos visuais com risco de política honesto e os níveis de parada e diferenciação para o Jev.
6. **Alternativas pagas com API e MCP de verdade**: Foreplay (Workflow a US$ 175/mês com MCP e API, 10 mil créditos/mês, biblioteca comunitária de 200 milhões+ de anúncios) e Atria (Core a US$ 159/mês, API e MCP em todos os planos, 25 milhões+ de anúncios Meta e TikTok). Cobertura de anúncios brasileiros não confirmada em nenhuma das duas. MagicBrief anunciou encerramento em 31/07/2026 (fontes de terceiros).
7. **TikTok e Google têm API comercial só para Europa**: a Commercial Content API do TikTok cobre só dados da UE nesta fase (oficial aberto); o conjunto público do Google Ads Transparency Center no BigQuery cobre anúncios comerciais do EEE. As interfaces (TikTok Creative Center e Google Ads Transparency Center, com filtro Brasil) continuam úteis para pesquisa manual por link.
8. **Políticas que mais derrubam criativo agressivo** (oficial aberto): atributo pessoal (exemplos oficiais: "Você tem diabetes?" proibido, "Aconselhamento para depressão" permitido), saúde e bem-estar (antes e depois de procedimento cosmético só para 18+, sem declaração de inferioridade sobre aparência, sem pinçar gordura), práticas comerciais inaceitáveis e conteúdo sensacionalista.
9. **Conselhos profissionais no Brasil mudam o que é "agressivo"**: CFM 2.336/2023 (antes e depois médico só educativo, com evoluções insatisfatórias e complicações), CFO 196/2019 (antes e depois só de caso próprio, com consentimento, nome e CRO), OAB Provimento 205/2021 (anúncio pago permitido só informativo, sem captação, sem promessa, sem preço). Entraram em NICHOS.
10. **Repositórios úteis são de método, não de prova**: `coreyhaines31/marketingskills` (skills ad-creative e offers, 51,4 mil estrelas) e `TheMattBerman/meta-ads-kit` (328 estrelas, limiares de fadiga) foram os mais aproveitáveis. Nenhum repositório traz anúncios com resultado comprovado.

**Recomendação de integração**

| Item | Decisão | Por quê |
| --- | --- | --- |
| Importar referência por link (Ad Library, TikTok, Google, Pinterest, Behance, Instagram) | **Integrar agora** (frente A, `referencia_importar_url`) | Legal, grátis, cobre o Brasil pela interface; a equipe escolhe e o painel enriquece |
| Semente de padrões por nicho (E0) | **Integrar agora** (este pacote) | Biblioteca grande sem risco legal, sem prova inventada |
| Estilos visuais, níveis novos do Jev, oferta, conta e copy | **Integrar agora** (conhecimento-ads.ts) | Base do laço de qualidade da v2 |
| API `ads_archive` da Meta para concorrente brasileiro | **Não** | Só devolve comercial que rodou na UE |
| Scraper da Biblioteca (Apify, MCPs de scraping) | **Não** | Termos de Coleta Automatizada da Meta; frágil a mudança de layout |
| MCP oficial Meta Ads (mcp.facebook.com/ads) | **Depois** | Serve para a conta do cliente; avaliar quando a "conta ao vivo" pedir escrita ou A/B pela IA |
| Foreplay ou Atria (API e MCP) | **Depois, com teste de 1 mês** | Pago; conferir cobertura de anúncios brasileiros antes de assinar |
| Datasets abertos (Hugging Face) | **Não** para criativo | Programático em inglês, sem rótulo de CTR; CGL v2 só para layout |
| Listas de prompts (nano banana, gpt-image) | **Depois, como estudo** | Úteis para direção de arte; licença das imagens de exemplo não verificada |

## 2. Bibliotecas de anúncios e APIs

### Meta Ad Library (interface)
- Link: https://www.facebook.com/ads/library/ (Central de Ajuda: https://www.facebook.com/help/259468828226154)
- Entrega: todos os anúncios **ativos** em Facebook, Instagram, Messenger, Threads, WhatsApp e Audience Network, de qualquer país, sem login. Inativos só para política e temas sociais (7 anos) e para UE (1 ano). **Só busca** para a frase exata da Central de Ajuda; a página de ferramentas oficial foi aberta (ver abaixo).
- Integra no painel? Sim, por link: a equipe cola a URL do anúncio e o servidor enriquece (imagem, texto visível). Custo zero.
- Risco legal: baixo para uso manual e referência de mecanismo (não copiar peça). Alto para coleta automatizada (ver Termos).

### Meta Ad Library API (`ads_archive`)
- Links: https://developers.facebook.com/docs/graph-api/reference/ads_archive/ (**oficial aberto**) e https://transparency.meta.com/researchtools/ad-library-tools/ (**oficial aberto**).
- Entrega: busca programática de anúncios sobre temas sociais, eleições e política no mundo, e de anúncios entregues na UE e territórios associados. `ad_type` aceita ALL, EMPLOYMENT_ADS, FINANCIAL_PRODUCTS_AND_SERVICES_ADS, HOUSING_ADS e POLITICAL_AND_ISSUE_ADS. Regra oficial: com ALL, anúncio que não alcançou a UE só volta se for político ou de tema social.
- Integra no painel? **Não** para concorrente comercial brasileiro. Exige conta verificada e app. A página https://www.facebook.com/ads/library/api não carregou nesta rodada (erro de conexão).
- Observação: o ambiente do Almir tem um MCP "meta" com `meta_search_ad_library`; ele usa a mesma API e deve ter o mesmo limite (não testado).

### Termos de Coleta Automatizada da Meta
- Link: https://www.facebook.com/legal/automated_data_collection_terms (**só busca**).
- Entrega: define coleta automatizada (scrapers, bots, crawlers) e exige permissão prévia; prevê revogação, exclusão de dados e encerramento de acesso. Base para **não** usar scraper da Biblioteca no painel.

### MCP oficial da Meta (Ads AI Connectors)
- Links: https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-overview (**oficial aberto**) e https://www.facebook.com/business/news/meta-ads-ai-connectors (**só busca**).
- Entrega: servidor remoto em mcp.facebook.com/ads, lançado em 29/04/2026, com 7 categorias de ferramentas (relatórios, criação e gestão de anúncios, catálogo, sinais e datasets, ajuda, testes A/B e estudos de lift, registro de atividade). Autenticação, custo e regiões não aparecem no trecho aberto. Sem menção a Biblioteca de Anúncios.
- Integra? **Depois**. Pode substituir parte da coleta própria quando a conta ao vivo precisar de escrita (pausar, subir criativo) pela IA, com aprovação humana.

### MCPs e ferramentas abertas de Meta Ads no GitHub
| Repositório | O que entrega | Verificação | Decisão |
| --- | --- | --- | --- |
| https://github.com/khaphanspace/meta-ads-mcp (fork de byadsco/meta-ads-mcp) | 142 ferramentas sobre a API de Marketing (campanhas, criativos, públicos, relatórios, comentários, WhatsApp); Biblioteca de Anúncios via ator do Apify (cerca de US$ 0,75 por mil anúncios, links de imagem expiram em cerca de 4 dias); MIT; v4.0.0 em 18/09/2026 | Terceiro aberto | Não para a Biblioteca (scraping). Referência de desenho de ferramentas |
| https://github.com/attainmentlabs/meta-ads-mcp | MCP independente de campanhas, publicado em fev/2026 | Só busca | Não |
| https://github.com/mikusnuz/meta-ads-mcp | 135 ferramentas, API de Marketing v25.0 | Só busca | Não |
| https://github.com/serkanhaslak/meta-mcp | 77 ferramentas, ciclo completo de campanha | Só busca | Não |
| https://github.com/RamsesAguirre777/facebook-ads-library-mcp | Scraper da Biblioteca pública sem token, qualquer país (já no dossiê) | Só busca nesta rodada | Não (Termos) |
| https://github.com/TheMattBerman/meta-ads-kit | Kit aberto de gestão: relatório diário, monitor de fadiga, otimizador de verba, copy, upload com travas, auditoria de pixel/CAPI. Limiares: frequência máxima 3,5; CTR mínimo 1,0%; alerta de fadiga com queda de 20% no CTR; CPC máximo US$ 2,50; MIT; 328 estrelas | Terceiro aberto | Aproveitado como referência de limiar em CONHECIMENTO_CONTA (marcado como mercado, não Meta) |

### TikTok
- Commercial Content API: https://developers.tiktok.com/products/commercial-content-api (**oficial aberto**). Nesta fase, "somente dados de países da UE"; pedido com aprovação em cerca de 2 dias úteis. **Não** serve para o Brasil.
- Creative Center Top Ads (interface): https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en (do dossiê). Útil para linguagem de vídeo por link. Scrapers no Apify existem (terceiros); **não** integrar.

### Google Ads Transparency Center
- Interface: https://adstransparency.google.com/?region=BR (**só busca**). Arquivo público de anúncios de anunciantes verificados em Pesquisa, Shopping, Display, YouTube, Maps e Play, com filtro de país (Brasil incluso). Uso por link: **integrar agora** via importação por URL.
- Conjunto no BigQuery `bigquery-public-data.google_ads_transparency_center`: cobre anúncios comerciais do EEE (DSA), segundo fóruns do Google e terceiros (**só busca**). **Não** para o Brasil.

### Pinterest Ads Repository
- https://ads.pinterest.com/ads-repository/ (**oficial aberto, mas a página não renderizou conteúdo**). Terceiros (atores do Apify) dizem que o repositório filtra UE27 + Brasil + Turquia. **Não verificado.** Se confirmado, é a única biblioteca oficial com anúncio comercial brasileiro em repositório de transparência; uso por link. Decisão: conferir manualmente no navegador antes de qualquer integração.

### Ferramentas pagas de inteligência de anúncios
| Ferramenta | Preço (consultado) | API / MCP | Verificação | Decisão |
| --- | --- | --- | --- | --- |
| Foreplay (https://www.foreplay.co/pricing) | Basic US$ 59/mês; Workflow US$ 175/mês; Agency US$ 459/mês; anual com cerca de 15% de desconto. Créditos de API: 10 mil/mês inclusos (20 mil no anual); pacotes extras de 100 mil por US$ 99/mês | MCP e API no Workflow e Agency; Discovery com 200 milhões+ de anúncios da comunidade; Spyder (acompanha marcas) | Terceiro aberto (página de preços) | Depois: testar 1 mês e medir quantos anúncios brasileiros do nicho aparecem |
| Atria (https://www.tryatria.com/pricing, https://www.tryatria.com/mcp) | Core US$ 159/mês (US$ 129 anual), Plus US$ 329/mês (valores de mar/2026 citados por terceiros) | REST API e MCP em todos os planos; 25 milhões+ de anúncios Meta e TikTok | Só busca | Depois, mesma condição do Foreplay |
| MagicBrief | A partir de US$ 249/mês por cotação | Sem API pública | Só busca: vários terceiros dizem que encerrou em 31/07/2026 e parte foi para o Canva | Não |
| Swiped.co, Black Box Ads | Ver dossiê | Sem API | Dossiê | Uso manual, por link |

Nenhuma dessas bibliotecas prova resultado: longevidade, "vencedores" e curadoria continuam E1 ou E2 no máximo (escala do dossiê).

## 3. Repositórios de método, prompts e datasets

| Fonte | O que entrega | Verificação | Uso |
| --- | --- | --- | --- |
| https://github.com/coreyhaines31/marketingskills (skills `ad-creative` e `offers`) | ad-creative: 4 modos (do zero, iterar por dados, lotes de estáticos, laço de estratégia), 8 categorias de ângulo (dor, resultado, prova social, curiosidade, comparação, urgência, identidade, contrário), modelos de estático (nós x eles, número, card de avaliação, antes e depois, mensagem do fundador, FAQ, grade), limites da Meta (125 visíveis / 40), 1.000+ impressões antes de julgar e regra de só gerar com base em material real. offers: equação de valor, 6 componentes (entrega, bônus, garantia, escassez, nome, preço), diagnóstico por alavanca, o que não fazer (contador falso, garantia exagerada, bônus inflado, palavras de golpe) | Terceiro aberto (SKILL.md) | Base de CONHECIMENTO_OFERTA e parte dos estilos. 51,4 mil estrelas; MIT |
| https://github.com/baozai12300/facebook-ad-creative-skill | Skill aberta que separa motores de público, ângulo, cena, estilo e layout, com adaptadores de prompt para GPT Image 2 e Nano Banana e um "portão de qualidade" por peça e por lote (diversidade de ângulo e layout) | Terceiro aberto; 0 estrelas; MIT | Ideia do portão de diversidade reforça os níveis de diferenciação; nada copiado |
| https://github.com/GroupX-ai/ad-creative | Pasta de peças prontas com conceito, ângulo e prompt exato; banners em GPT Image 2 via fal (cerca de US$ 0,20 por imagem); regra "nenhuma alegação inventada" e conferência do texto palavra por palavra | Terceiro aberto; sem licença | Confirma a autocorreção da frente B (conferir texto antes de entregar) |
| https://github.com/gntrs/swipefile | Biblioteca própria com mídia, tags, veredito, comparação, banco de ganchos; React + Postgres com RLS; schema em `db-setup.sql` | Terceiro aberto; 6 estrelas; MIT | Referência de modelo de dados; já temos `ads_referencias` |
| Listas de prompts Nano Banana: https://github.com/ZeroLu/awesome-nanobanana-pro, https://github.com/cmd8/awesome-nano-banana-pro-prompts, https://github.com/ych-chen/awesome-nano-banana-prompts, https://github.com/PicoTrex/Awesome-Nano-Banana-images | Coleções de prompts e exemplos (produto, pôster, texto na imagem) | Só busca | Estudo de direção de arte; licença dos exemplos não verificada; não integrar |
| Hugging Face: https://huggingface.co/datasets/PeterBrendan/AdImageNet (9.003 criativos programáticos com texto extraído), https://huggingface.co/datasets/PeterBrendan/Ads_Creative_Ad_Copy_Programmatic (7.097), CGL-Dataset v2 (60 mil pôsteres para layout) | Datasets abertos de anúncio | Só busca | Não: banner programático em inglês, sem métrica de resultado |

## 4. Práticas 2025/2026 de estático que converte

### Era Andromeda e diversificação criativa
- https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/ (**oficial aberto**): Andromeda é o sistema de recuperação que escolhe candidatos entre dezenas de milhões de anúncios; +6% de recall e +8% de qualidade de anúncio em segmentos selecionados; índice hierárquico para lidar com o volume de criativos gerado por IA.
- https://www.facebook.com/business/news/the-creative-advantage-unlocking-the-power-of-diversification-with-meta-andromeda e https://www.facebook.com/business/news/demystifying-creative-diversification (**oficial aberto**): diversificação é criar peças com temas, mensagens e visuais diferentes para segmentos e motivações diferentes; iteração (mesmo visual, outro CTA) não é diversificação. A Meta cita ganhos de ferramentas de IA (geração de imagem: +11% CTR e +7,6% taxa de conversão) e não fixa um número universal de criativos.
- https://www.tryatria.com/blog/andromeda-meta-ads (**terceiro aberto**): anúncios parecidos viram um só "entity ID"; 5 a 10 conceitos distintos por campanha; renovar a cada 2 a 3 semanas. **Leitura de mercado, não Meta.** Outros terceiros citam limiar de 60% de similaridade e 10 a 15 entity IDs (**só busca, não verificado**).
- Uso no conhecimento: CONHECIMENTO_CONTA separa o que é oficial do que é leitura de mercado.

### Estilos de estático
Terceiros (adrio.ai, sovran.ai, dataslayer.ai, **só busca**) listam como formatos fortes: problema e solução, antes e depois, avaliação/depoimento, comparação, fundador, pilha de oferta e advertorial; e afirmam que criativo com cara nativa (UGC, bastidor, gente real) tende a vencer o "com cara de anúncio". A skill ad-creative (aberta) traz nós x eles, número em destaque, card de avaliação, FAQ e grade. Nenhum número de desempenho desses guias foi verificado. Os 22 estilos de ESTILOS_VISUAIS consolidam isso com o dossiê (metáfora, objeto inesperado, contraste emocional) e com o risco de política de cada um.

### Copy e limites
- https://socialrails.com/blog/facebook-ad-character-limits (**terceiro aberto**, conferido contra o Guia de Anúncios da Meta): recomendações por posicionamento, por exemplo feed do Facebook com título de cerca de 27 caracteres, Stories com texto principal de 125 e título de 40, Reels com cerca de 40 no texto principal, Marketplace e busca com descrição de 30. A Meta não publica limite máximo rígido; texto maior é cortado, não reprovado.
- Regra dos 20% de texto na imagem foi removida; a Meta ainda recomenda pouco texto na imagem (**só busca**; a afirmação de que o algoritmo "penaliza" texto é de terceiros e não foi verificada).

### Oferta
- Equação de valor de Alex Hormozi (livro $100M Offers, Acquisition.com): resultado desejado x probabilidade percebida, dividido por tempo x esforço (**só busca**, várias fontes secundárias concordam; livro não aberto). Método aberto na skill `offers` do marketingskills.
- Honestidade de preço no Brasil: "de/por" só com preço anterior praticado (Código de Defesa do Consumidor, art. 37, publicidade enganosa; **conhecimento geral, texto da lei não reaberto nesta rodada**).

### Objetivos de campanha
- Seis objetivos do Gerenciador (ODAX): Reconhecimento, Tráfego, Engajamento, Cadastros, Promoção do app, Vendas; local de conversão e meta de desempenho definem a otimização (**só busca**, várias fontes concordam).
- Seguidores: não há otimização por seguir. Usa-se Tráfego com local de conversão Perfil do Instagram (visitas ao perfil). A métrica de seguidores atribuídos existe só em relatório desde 07/07/2025, em contas selecionadas (https://ppc.land/meta-introduces-instagram-follows-metric-for-ads-reporting/, **terceiro aberto**). A página oficial de ajuda sobre visitas ao perfil não carregou o conteúdo.
- Fase de aprendizado: cerca de 50 eventos de otimização por semana por conjunto (referência amplamente citada da Meta; página oficial não aberta nesta rodada).

### Leitura de conta e fadiga
- Guias de 2025/2026 (goodmorningco.com, theoptimizer.io, adamigo.ai, **só busca**) e o meta-ads-kit (**aberto**) convergem: frequência de 2,0 a 2,5 é alerta, acima de 3,0 a 3,5 é hora de renovar, 4+ pausar; queda de 15% a 25% no CTR em relação ao pico indica fadiga; público frio pede criativo novo a cada 1 a 4 semanas. **Nada disso é regra oficial da Meta.** Em CONHECIMENTO_CONTA os limiares entram como referência, e a régua do cliente (custo tolerável) manda. O `sinal` da conta ao vivo continua em código (calculos.ts, frente A).

## 5. Políticas e regras do Brasil que limitam o "agressivo"

| Fonte | Regra | Verificação |
| --- | --- | --- |
| https://transparency.meta.com/policies/ad-standards/objectionable-content/privacy-violations-personal-attributes/ | Não afirmar nem insinuar atributo pessoal (raça, religião, idade, orientação, deficiência, saúde física ou mental, situação financeira, antecedentes, nome). Permitido: "Aconselhamento para depressão", "Conheça solteiros cristãos". Proibido: "Você tem diabetes?", "Você é cristão?" | Oficial aberto |
| https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness/ | Antes e depois de produto, procedimento ou cirurgia cosmética permitido para 18+; emagrecimento e suplemento só 18+; proibido pinçar gordura em close e declarar inferioridade da aparência | Oficial aberto |
| https://transparency.meta.com/policies/ad-standards/fraud-scams/unacceptable-business-practices/ | Sem práticas enganosas; categorias visadas por golpistas podem exigir verificação | Só busca |
| https://transparency.meta.com/policies/ad-standards/objectionable-content/sensational-content | Sem conteúdo chocante, sangrento ou sensacionalista | Só busca |
| https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2023/2336_2023.pdf | Resolução CFM 2.336/2023 (vigente desde 11/03/2024): antes e depois permitido com caráter educativo, autorização do paciente, mostrando evoluções satisfatórias, insatisfatórias e complicações possíveis, sem sensacionalismo nem promessa | Só busca (resumos do CFM e de CRMs) |
| https://website.cfo.org.br/resolucao-cfo-196-2019/ | Resolução CFO 196/2019: antes e depois só do próprio profissional, com consentimento (TCLE), com nome e CRO em todas as imagens | Só busca |
| https://www.oab.org.br/leisnormas/legislacao/provimentos/205-2021 | Provimento 205/2021: anúncio pago permitido se informativo e discreto; vedados captação, promessa de resultado, mercantilização, ostentação e uso de caso concreto | Só busca |

Regras de divulgação de preço e promoção do Código de Ética Odontológica **não foram verificadas**; o nicho odontologia manda conferir antes de anunciar valor.

## 6. O que não consegui verificar

- A página https://www.facebook.com/ads/library/api (erro de conexão) e a página oficial de ajuda sobre anúncios de visita ao perfil (conteúdo não carregou). A conclusão sobre a API vem da referência oficial do `ads_archive`.
- Se o Pinterest Ads Repository inclui o Brasil (só terceiros afirmam).
- Cobertura de anúncios brasileiros no Foreplay e no Atria; preços do Atria (só por terceiros).
- Encerramento do MagicBrief (só terceiros).
- Números de desempenho de guias de mercado (entity ID, 60% de similaridade, "estático gera 60% a 70% das conversões", queda de CTR por dia): nenhum veio de fonte oficial.
- Se o MCP "meta" instalado no ambiente consegue buscar anúncios comerciais brasileiros (não testado; pela API oficial, não deveria).
- Se a Meta exige categoria especial de Moradia para imobiliária no Brasil (conferir no Gerenciador).
- Nenhum repositório foi instalado ou executado; nenhuma ferramenta paga foi assinada.

## 7. O que esta pesquisa virou no painel

- `supabase/functions/_shared/conhecimento-ads.ts` (versão 2026-09-24.2): ESTILOS_VISUAIS (22, com risco de política), NIVEIS_PARADA, NIVEIS_DIFERENCIACAO, NIVEIS_FORCA_OFERTA, OBJETIVOS_DE_CAMPANHA (7), NICHOS (19), CONHECIMENTO_OFERTA, CONHECIMENTO_AGRESSIVO, CONHECIMENTO_CONTA, CONHECIMENTO_COPY_PACOTE, PARAR_A_ROLAGEM; estrategista e regrasDoCriativo mais fortes.
- `docs/mesa-ads/v2/biblioteca-padroes.json` e `docs/mesa-ads/v2/migrations/seed_biblioteca_padroes.sql`: 98 padrões E0 em 19 nichos, gerados por `docs/mesa-ads/pesquisa/ferramentas/gerar_biblioteca.py`.
- Próximo passo sugerido: quando a equipe importar anúncios reais por link e os próprios vencedores subirem para E3/E4, os padrões E0 viram só ponto de partida; a biblioteca passa a ser guiada pelo que funciona na conta do cliente.
