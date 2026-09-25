# Como integrar a base de conhecimento nos prompts

Plano da Frente R (25/09/2026). Esta frente só criou arquivos novos; a ligação nos agentes é trabalho de quem edita o código de cada função. Nada aqui foi publicado.

## 1. O que existe

| Arquivo | Conteúdo | Tamanho aproximado |
|---|---|---|
| `supabase/functions/_shared/conhecimento-ads.ts` | Base da Mesa Ads (já integrada). `CONHECIMENTO_ESTRATEGISTA_ADS` sozinho tem cerca de 41.600 caracteres, uns 12.000 tokens | já em uso |
| `supabase/functions/_shared/conhecimento-design.ts` | Base do diretor de arte (já integrada no estúdio) | já em uso |
| `supabase/functions/_shared/conhecimento-especialistas-ads.ts` | Pedro Sobral e Natália Torres: 56 princípios com fonte e data, blocos prontos por uso | ver tabela abaixo |
| `supabase/functions/_shared/conhecimento-marketing.ts` | Skills de marketing, vendas, design e roteiro destiladas | de 3.300 a 7.700 caracteres por agente |

Tamanhos medidos em 25/09/2026 (caracteres):

| Constante | Módulo | Tamanho |
|---|---|---|
| `ESPECIALISTAS_ADS_PARA_ESTRATEGISTA` (ganchos, criativo Natália, estrutura, plano de teste, corte e escala) | especialistas | 7.139 |
| `REGRAS_DE_CORTE_E_ESCALA` | especialistas | 1.868 |
| `ESTRUTURA_DE_CONTA` | especialistas | 1.428 |
| `CRIATIVO_NATALIA` | especialistas | 1.270 |
| `PLANO_DE_TESTE` | especialistas | 1.246 |
| `ORCAMENTO_INICIAL` | especialistas | 1.048 |
| `GANCHOS_DOS_ESPECIALISTAS` | especialistas | 1.044 |
| `ERROS_COMUNS_TRAFEGO` | especialistas | 990 |
| `CHECKLIST_CRIATIVO_POR_OBJETIVO[objetivo]` | especialistas | de 290 a 589 cada |
| `textoDosPrincipios(PRINCIPIOS_ESPECIALISTAS)` (todos os princípios) | especialistas | 13.055: **não mandar inteiro**; filtrar com `principiosDos({ tema })` |
| `conhecimentoMarketingPara("calendario")` | marketing | 7.391 |
| `conhecimentoMarketingPara("estudio")` | marketing | 7.646 |
| `conhecimentoMarketingPara("mesa_ads")` | marketing | 6.440 |
| `conhecimentoMarketingPara("mesa_foto")` | marketing | 3.340 |
| `conhecimentoMarketingPara("contexto")` | marketing | 6.416 |
| `conhecimentoMarketingPara("dossie")` | marketing | 7.026 |
| `docs/conhecimento/pedro-sobral.md`, `natalia-torres.md` | Pesquisa completa com fontes (humano lê; não vai para o prompt) | |
| `docs/conhecimento/SKILLS-NO-SISTEMA.md` | Lista de skills, o que foi trazido e onde usar | |

Conta de tokens usada aqui: português fica perto de 1 token para cada 3,5 caracteres. 10.000 caracteres são uns 2.900 tokens.

## 2. Regras de ouro da integração

1. **Prioridade quando duas bases discordam**: dado real do cliente e régua do briefing (custo tolerável, kit da marca) > `conhecimento-ads.ts` e `conhecimento-design.ts` > `conhecimento-especialistas-ads.ts` > `conhecimento-marketing.ts`. Escrever essa frase uma vez no sistema do agente que recebe mais de uma base.
2. **Prefixo fixo**: o conhecimento entra no começo do sistema, sempre na mesma ordem, e o dado do cliente vem depois. O motor (`_shared/ia-motor.ts`) hoje não usa `cache_control`, mas provedores com cache automático de prefixo (OpenRouter para OpenAI e Gemini) aproveitam prefixo idêntico. Não intercalar texto variável no meio da base.
3. **Blocos inteiros**: cortar por bloco, nunca no meio de um bloco. `conhecimentoMarketingPara(agente, teto)` já faz isso e segue a ordem de prioridade de `BLOCOS_POR_AGENTE`.
4. **Números vêm do código**: regras de corte e escala dos especialistas são referência para o texto da IA. A decisão numérica (pausar, escalar) continua calculada em código com a régua do cliente, como `FOCO_EM_RESULTADO` já determina.
5. **Atribuição**: quando o agente citar o método de alguém, usa o nome do especialista só se o princípio estiver marcado com ele no módulo. O módulo separa "fala do especialista" de "síntese da agência".
6. **Versão**: cada módulo tem uma constante de versão (`VERSAO_CONHECIMENTO_MARKETING`, `VERSAO_ESPECIALISTAS_ADS`). Registrar a versão usada no log da execução, como a Mesa Ads já faz com `VERSAO_CONHECIMENTO_ADS`.

## 3. Por agente

### Mesa Ads (`supabase/functions/mesa-ads/index.ts`)

Hoje o sistema do estrategista sai de `sistemaDoEstrategista()`, que devolve `${CONHECIMENTO_ESTRATEGISTA_ADS}\n\n${REGRAS_DA_EXECUCAO}` (perto da linha 993). O ponto de ligação é essa função: todas as ações do estrategista passam por ela. É o agente mais pesado, então o acréscimo é contido.

| Momento | O que acrescentar | Teto sugerido |
|---|---|---|
| Plano de ângulos e copy (estrategista) | `ESPECIALISTAS_ADS_PARA_ESTRATEGISTA` depois de `CONHECIMENTO_ESTRATEGISTA_ADS` e antes de `REGRAS_DA_EXECUCAO`; e `conhecimentoMarketingPara("mesa_ads", 5000)` (com teto de 5.000 entram objeções, posicionamento e revisão de marca) | até 12.500 caracteres somados (cerca de 3.600 tokens) |
| Leitura de conta e recomendação de verba | `REGRAS_DE_CORTE_E_ESCALA` e `ESTRUTURA_DE_CONTA` | até 5.000 caracteres |
| Pacote para o gestor (plano de teste) | `PLANO_DE_TESTE` e `ORCAMENTO_INICIAL` | até 4.000 caracteres |
| Conferência pelo Jev | nenhum texto longo; usar as perguntas curtas já existentes. Se quiser um aviso novo, `CHECKLIST_CRIATIVO_POR_OBJETIVO[objetivo]` vira critério de uma pergunta Noul | 600 caracteres por pergunta |

Com o acréscimo, o sistema do estrategista fica perto de 55.000 caracteres (uns 16.000 tokens). Se o modelo em uso tiver janela curta ou o custo pesar, a ordem de corte é: `ROTEIRO_DE_VIDEO`, `POSICIONAMENTO_E_CONCORRENCIA`, depois os princípios de Natália (já cobertos em parte pelas técnicas da base), e por último Pedro Sobral.

### Designer e estúdio (`supabase/functions/estudio-arte/index.ts`)

| Momento | O que acrescentar | Teto |
|---|---|---|
| Direção de arte de post e carrossel (sistema montado perto da linha 1435: `${CONHECIMENTO_DIRETOR}\n\n${prompt}\n\n${INSTRUCOES_DIRECAO}`) | `conhecimentoMarketingPara("estudio", 6000)` logo depois de `CONHECIMENTO_DIRETOR` | 6.000 caracteres |
| Legenda final (`INSTRUCOES_LEGENDA`, sistema perto da linha 3131) | `FORMULAS_DE_TITULO`, `CTA_PRINCIPIOS` e `ANTI_GENERICO` | 3.500 caracteres |
| Peça no modo anúncio | `CHECKLIST_CRIATIVO_POR_OBJETIVO[objetivo]` do objetivo escolhido | 1.200 caracteres |

`PADRAO_NA_IMAGEM` (texto que vai ao gerador de imagem) não recebe nada desta frente: o gerador entende posição, escala e cor, não método de marketing.

### Calendário (`supabase/functions/agente-calendario/index.ts`)

O prompt global vem da tabela `agente_prompts` (linha 665) e as regras de saída são fixas (`REGRAS_DE_SAIDA`). Duas opções:

1. **Código** (recomendada): montar `sistema: \`${ctx.prompt}\n\n${conhecimentoMarketingPara("calendario", 7500)}\n${REGRAS_DE_SAIDA}\`` nas chamadas que planejam o mês. Assim a base versiona junto com o código.
2. **Banco**: colar o texto no prompt global em `agente_prompts`. Mais fácil de ajustar sem deploy, mas perde a versão e se desatualiza.

Atenção: `REGRAS_DE_SAIDA` proíbe vídeo no calendário; por isso `ROTEIRO_DE_VIDEO` não entra no calendário.

### Mesa Foto (`supabase/functions/mesa-foto/index.ts`)

| Sistema | O que acrescentar | Teto |
|---|---|---|
| `SISTEMA_CAMPANHA` e `SISTEMA_AGENTE` | `conhecimentoMarketingPara("mesa_foto", 3500)` e `CRIATIVO_NATALIA` | 5.000 caracteres |
| `SISTEMA_LEITOR`, `SISTEMA_KITS`, `SISTEMA_CONFERENCIA`, `SISTEMA_IDENTIFICAR` | nada: são tarefas de descrição e conferência; conhecimento de marketing só atrapalha | 0 |

### Contexto do cliente (`supabase/functions/agente-contexto/index.ts`)

`SISTEMA_CONTEXTO` e `SISTEMA_CONVERSA` recebem `conhecimentoMarketingPara("contexto", 6500)`. Uso esperado: quando faltar guia de voz, posicionamento ou lista de objeções, o agente propõe um rascunho com os campos de `VOZ_DE_MARCA` e `POSICIONAMENTO_E_CONCORRENCIA`, marcado como proposta. `SISTEMA_LEITURA` e `SISTEMA_ACERVO` não recebem nada.

### Dossiê, esteira e resumo do mês

| Função | O que acrescentar | Teto |
|---|---|---|
| `esteira-semana` (cérebro operacional sobre o dossiê) | `conhecimentoMarketingPara("dossie", 6000)` | 6.000 |
| `cycle-coach` (coach do dono) | `ANALISE_DE_DESEMPENHO` e, se o cliente tem tráfego, `ERROS_COMUNS_TRAFEGO` | 4.000 |
| `journey-narrative` (resumo do mês para o cliente leigo) | só a parte "Estrutura do relatório" de `ANALISE_DE_DESEMPENHO` (o leitor é leigo: sem jargão) | 2.000 |
| `ritual-writer` | nada por enquanto | 0 |

## 4. Passo a passo para quem for ligar

1. Importar do módulo, por exemplo: `import { conhecimentoMarketingPara, VERSAO_CONHECIMENTO_MARKETING } from "../_shared/conhecimento-marketing.ts";`.
2. Montar o sistema com a base antes do dado do cliente, respeitando o teto da tabela.
3. Registrar a versão no log da execução.
4. `deno check` na função alterada.
5. Rodar a suíte na cópia de verificação (lembrete da memória do projeto: a suíte confiável é a de `C:\AI\lf-verify`).
6. Testar um caso real por agente e comparar com a saída anterior: o texto novo tem que ficar mais específico, não mais longo.
7. Só então publicar a função (fora do escopo desta frente).

## 5. Manutenção

- Atualizar os especialistas: nova fonte entra primeiro no `.md` da pessoa (com URL e data) e só depois vira princípio no `.ts`, com a mesma fonte.
- Não duplicar: antes de acrescentar um princípio, procurar em `conhecimento-ads.ts` se já existe; se existir, complementar lá ou citar a origem nova no comentário.
- Revisar a cada trimestre os números de mercado (frequência, fadiga, orçamento), porque a Meta muda a entrega com frequência.
