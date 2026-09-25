# Skills da máquina dentro do painel

Levantamento de 25/09/2026 (Frente R). Pedido do dono: "todas as skills que a gente tem aqui (marketing, designer, várias) têm que estar lá dentro do sistema; se não tiver, puxar para instalar e funcionar dentro do sistema".

O painel Aceleriq é uma aplicação web com agentes em Edge Functions do Supabase. Uma skill do Claude Code ou do Claude Desktop não roda dentro de uma Edge Function: ela é um arquivo de instruções que o Claude lê na máquina. Por isso "instalar no sistema" aqui quer dizer **destilar o conhecimento útil de cada skill em texto que entra no prompt dos agentes do painel**. Esse texto está em:

- `supabase/functions/_shared/conhecimento-marketing.ts` (skills de marketing, vendas, design e roteiro);
- `supabase/functions/_shared/conhecimento-especialistas-ads.ts` (Pedro Sobral e Natália Torres, que não são skills, mas completam a Mesa Ads);
- já existiam `_shared/conhecimento-ads.ts` (Mesa Ads) e `_shared/conhecimento-design.ts` (diretor de arte), que continuam valendo e têm prioridade quando houver conflito.

Nenhum arquivo de skill foi copiado para o repositório. O texto dos módulos é resumo próprio, em português, adaptado às regras da casa (sem inventar dado, sem travessão, política da Meta, kit da marca manda).

## 1. Onde as skills estão nesta máquina

| Local | O que tem |
|---|---|
| `C:\Users\Usuario\AppData\Roaming\Claude\local-agent-mode-sessions\...\rpm\plugin_*` | Plugins do Claude Desktop (Cowork): marketing, sales, product-management, operations, cowork-plugin-management. São da Anthropic, licença Apache 2.0, publicados em github.com/anthropics/knowledge-work-plugins |
| `C:\Users\Usuario\.claude\skills\` | Skills pessoais do Claude Code: design (brandkit, taste, soft, minimalist, brutalist, redesign, stitch, gpt-taste, image-to-code, imagegen-frontend-web e mobile), vídeo (hyperframes e família, media-use, video-use), pesquisa (watch, yt-search, yt-pipeline), memória (obsidian, fechar-sessao), output-skill |
| `C:\Users\Usuario\.claude\plugins\` | Plugins instalados no Claude Code: claude-code-setup, claude-mem, typesafe. O catálogo `claude-plugins-official` está baixado, mas os plugins dele (frontend-design, skill-creator e outros) não estão instalados |

## 2. Lista de skills e o que foi trazido

Legenda da coluna "Trazido": **sim** (virou bloco em `conhecimento-marketing.ts`), **parcial** (só a parte útil para o painel), **não** (motivo na última coluna).

### Marketing (plugin "marketing" 1.2.0, Anthropic)

| Skill | Trazido | Bloco no módulo | Observação |
|---|---|---|---|
| brand-review | sim | `VOZ_DE_MARCA`, `REVISAO_DE_MARCA` | Documento de voz em 7 partes, espectros de atributo, tom por situação e canal, bandeiras legais com gravidade. Adaptado a CDC e CONAR |
| campaign-plan | sim | `PLANO_DE_CAMPANHA`, `CALENDARIO_EDITORIAL` | Cinco partes (objetivo, público, mensagem, canal, medida), processo de calendário, prazos de produção, renovação de criativo |
| content-creation | sim | `FORMULAS_DE_TITULO`, `CTA_PRINCIPIOS`, `ESTRUTURAS_DE_CONTEUDO` | Fórmulas reescritas em português; exemplos em inglês não foram trazidos |
| draft-content | parcial | `ESTRUTURAS_DE_CONTEUDO`, `VOZ_DE_MARCA` | O fluxo de perguntas ao usuário não se aplica; o painel já tem o contexto do cliente |
| competitive-brief | sim | `POSICIONAMENTO_E_CONCORRENCIA` | Promessa, prova, mecanismo, exclusividade; vilão e herói; declaração de posicionamento; armadilhas |
| email-sequence | sim | `SEQUENCIAS_DE_MENSAGEM` | Adaptado a e-mail e WhatsApp com opt-in; benchmarks americanos de abertura não foram trazidos (não valem para o Brasil sem fonte) |
| performance-report | sim | `ANALISE_DE_DESEMPENHO` | Estrutura de relatório, sintoma por etapa do funil, teste, atribuição, previsão em faixa. Benchmarks numéricos genéricos ficaram de fora de propósito |
| seo-audit | parcial | `SEO_ESSENCIAL` | Só o essencial de página e negócio local. A auditoria completa depende de conectores (Ahrefs, Similarweb) que não estão autorizados |

### Vendas (plugin "sales" 2.0.1, Anthropic)

| Skill | Trazido | Bloco | Observação |
|---|---|---|---|
| handle-objection | sim | `OBJECOES_E_VOZ_DO_CLIENTE` | Classificação da objeção, objeção x negociação, estrutura de resposta, o que costuma perder |
| customer-voice | sim | `OBJECOES_E_VOZ_DO_CLIENTE` | Citação literal com fonte, nunca paráfrase apresentada como fala |
| draft-outreach, competitive-intelligence, win-loss-review | não | | Dependem de CRM e gravador de chamadas conectados; o painel tem CRM próprio. Candidatas para uma rodada futura do CRM |
| demais 30 skills de vendas | não | | Operação comercial de conta e pipeline; fora do escopo dos agentes de conteúdo |

### Design e marca (skills pessoais)

| Skill | Trazido | Bloco | Observação |
|---|---|---|---|
| brandkit | sim | `IDENTIDADE_DE_MARCA` | Cinco perguntas, estratégia antes do desenho, cinco caminhos de conceito de símbolo, ritmo de prancha |
| redesign-skill | parcial | `ANTI_GENERICO` | Clichês de copy de IA e anti-padrões visuais, traduzidos de interface web para peça social |
| minimalist-skill, soft-skill, taste-skill, taste-skill-v1 | parcial | `ANTI_GENERICO` | São regras de código de interface (fontes web, Tailwind, animação). Só o princípio transferível foi trazido |
| brutalist-skill, stitch-skill, gpt-tasteskill | não | | Estéticas de site; não se aplicam a post, anúncio ou foto |
| image-to-code-skill, imagegen-frontend-web, imagegen-frontend-mobile | não | | Geração de telas de site e app. Úteis se o painel passar a fazer página de destino |

A base principal de design dos agentes continua sendo `conhecimento-design.ts` (Gestalt, tipografia, cor e grade em 1080 x 1350), mais específica que qualquer skill instalada.

### Vídeo

| Skill | Trazido | Bloco | Observação |
|---|---|---|---|
| hyperframes-creative (story-spine, narration) | parcial | `ROTEIRO_DE_VIDEO` | Ritmo de 2,5 palavras por segundo, valor antes da evidência, tipos de gancho |
| hyperframes, hyperframes-core, -animation, -audio, -cli, -keyframes, -registry, -studio, media-use, video-use, embedded-captions e fluxos de vídeo | não | | São ferramentas de renderização local (CLI, ffmpeg, navegador). Não rodam numa Edge Function. O painel hoje não produz vídeo (o calendário só aceita carrossel e estático) |

### Pesquisa, memória e produtividade

| Skill | Trazido | Observação |
|---|---|---|
| watch, yt-search, yt-pipeline | não | Dependem de yt-dlp, ffmpeg e NotebookLM locais. Úteis para a equipe pesquisar referências fora do painel |
| obsidian, fechar-sessao, claude-mem, output-skill | não | Memória e sessão do Claude na máquina; o painel tem memória própria (`agente_memoria`, dossiê) |
| product-management (8), operations (9), cowork-plugin-management | não | Gestão de produto e processos internos; fora do escopo dos agentes de conteúdo. `synthesize-research` pode servir ao dossiê numa rodada futura |
| typesafe-ai | já integrado | O Jev já é usado pelo painel (`_shared/jev.ts`) |

## 3. Onde cada agente usa

| Agente do painel | Função no código | Blocos de `conhecimento-marketing.ts` | Blocos de `conhecimento-especialistas-ads.ts` |
|---|---|---|---|
| Calendário (estrategista do mês) | `agente-calendario` | `conhecimentoMarketingPara("calendario")`: calendário editorial, plano de campanha, títulos, CTA, estruturas, anti-genérico | nenhum (orgânico) |
| Designer e estúdio | `estudio-arte` | `conhecimentoMarketingPara("estudio")`: anti-genérico, voz, revisão de marca, CTA, identidade | `CHECKLIST_CRIATIVO_POR_OBJETIVO` só no modo anúncio |
| Mesa Ads | `mesa-ads` | `conhecimentoMarketingPara("mesa_ads")`: objeções, posicionamento, revisão, anti-genérico, roteiro | bloco completo (`ESPECIALISTAS_ADS_PARA_ESTRATEGISTA`) e, na leitura de conta, `REGRAS_DE_CORTE_E_ESCALA` |
| Mesa Foto | `mesa-foto` | `conhecimentoMarketingPara("mesa_foto")`: anti-genérico, identidade | `CRIATIVO_NATALIA` (situação real, mapa do clichê) no agente de campanha |
| Contexto do cliente | `agente-contexto` | `conhecimentoMarketingPara("contexto")`: voz, posicionamento, objeções, identidade | nenhum |
| Dossiê, esteira e resumo do mês | `esteira-semana`, `cycle-coach`, `journey-narrative`, `ritual-writer` | `conhecimentoMarketingPara("dossie")`: análise de desempenho, plano de campanha, objeções, sequências, busca | `ERROS_COMUNS_TRAFEGO` quando o cliente tem tráfego pago |

Detalhes de cada ponto de entrada, tetos de tamanho e ordem de prioridade: `docs/conhecimento/COMO-INTEGRAR.md`.

## 4. Skills úteis que não estão instaladas

Atualização de 25/09/2026 (Frente W): o marketingskills foi destilado e está nos prompts (`_shared/conhecimento-repositorios.ts`), junto com os outros repositórios pedidos pelo dono. Índice único de quem recebe o quê: `_shared/motores.ts`; tabela com licença e estado: `docs/motores/REPOSITORIOS.md`. O item 1 abaixo fica como registro histórico.

Nada foi instalado nesta rodada (regra da frente). Se o dono quiser trazer mais conhecimento:

1. **coreyhaines31/marketingskills** (licença MIT), já apontado como melhor repositório de método no dossiê da Mesa Ads (`docs/mesa-ads/pesquisa/DOSSIE-CRIATIVOS.md`). Skills mais úteis para o painel: `copywriting`, `copy-editing`, `ad-creative`, `ads`, `offers`, `marketing-psychology`, `content-strategy`, `social`, `customer-research`, `launch`, `lead-magnets`, `cro`, `ab-testing`. Onde achar: https://github.com/coreyhaines31/marketingskills. Instalação na máquina: `npx skills add coreyhaines31/marketingskills`. Para o painel, o caminho é o mesmo desta rodada: ler e destilar em `_shared`.
2. **frontend-design** (catálogo oficial `claude-plugins-official`, já baixado em `~/.claude/plugins/marketplaces`, não instalado). Só vale se o painel passar a gerar páginas de destino.
3. **Conectores do plugin de marketing** (Ahrefs, Canva, HubSpot, Klaviyo, Similarweb, Supermetrics): aparecem como "precisam de autorização" nesta sessão. Sem eles, a auditoria de SEO e o relatório de desempenho do plugin trabalham só com dado colado. No painel, os números já vêm do banco (Meta e Instagram), então não são necessários para os agentes.
4. **Plugins de outros domínios da Anthropic** (customer-support, data): não estão instalados; `data` poderia ajudar em análise de métricas, mas o painel já calcula os números em código.
