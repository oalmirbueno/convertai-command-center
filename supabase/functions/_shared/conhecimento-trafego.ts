/**
 * Base de conhecimento de gestão de tráfego pago na Meta (frente TR,
 * 27/09/2026), usada pelo agente sênior da Mesa Ads (no sistema) e pela
 * rotina de monitoramento (limites padrão e referência do nicho).
 *
 * Pesquisa feita em 27/09/2026 e resumida com as palavras da agência (nada
 * copiado). Cada bloco cita a fonte em comentário. Legenda: OFICIAL = Meta;
 * PRÁTICA = consenso de gestores e ferramentas; FRACA = blog sem metodologia.
 * Número de custo por nicho no Brasil só existe em fonte fraca: por isso ele
 * é o ÚLTIMO recurso do custo-alvo (depois do dono, do plano, do briefing e
 * da própria conta), e a tela mostra a fonte.
 */
import type { ReferenciaDoNicho } from "../mesa-ads/rotina-trafego.ts";

/*
 * Fontes principais (acesso em 27/09/2026):
 * - Andromeda: https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/ (OFICIAL, 2024)
 * - "Diversificar criativo é a nova segmentação": https://pubcast.jonloomer.com/creative-diversification-is-the-new-targeting/ (PRÁTICA, 2025)
 * - Advantage+ unificado (29/05/2025): https://ppc.land/meta-launches-unified-api-structure-for-advantage-campaigns/
 * - Changelog v24.0 (folga de 75% no gasto diário; is_adset_budget_sharing_enabled): https://developers.facebook.com/docs/marketing-api/marketing-api-changelog/version24.0/ (OFICIAL)
 * - Fase de aprendizado (cerca de 50 eventos em 7 dias): https://www.facebook.com/business/help/112167992830700 (OFICIAL)
 * - Edição significativa: https://www.facebook.com/business/help/316478108955072 (OFICIAL; a Meta não publica percentual de orçamento)
 * - Quando cortar um anúncio (2,3x a 3x o CPA sem conversão; atraso de 48 a 72 h; CTR de link < 0,5%): https://admanage.ai/blog/when-to-kill-a-facebook-ad (PRÁTICA, 2026)
 * - Automação e regras (gasto mínimo antes de julgar, limiares separados de pausar e religar): https://bir.ch/blog/facebook-ads-automation (PRÁTICA, 2026)
 * - Árvore de decisão Meta (corte em 3x, +20% a cada 5 dias, frequência 2,5 a 4): https://github.com/coreyhaines31/marketingskills/blob/main/skills/ads/references/meta-decision-system.md (PRÁTICA)
 * - Fadiga (frequência de 7 dias, queda de CTR de 20% ou mais, dois sinais juntos): https://www.adsights.ai/blog/topics/creative-strategy/creative-fatigue-in-meta-ads-detection-and-management-strategies (PRÁTICA, 2026)
 * - Mensagens (conversas, leads com mensagem, compras por mensagem): https://www.facebook.com/business/ads/click-to-message-ads/purchases-through-messaging e https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-messaging (OFICIAL)
 * - Conversions API para mensagens (ctwa_clid, QualifiedLead, Purchase): https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging (OFICIAL)
 * - Conversa por mensagem iniciada (7 dias sem mensagem antes): https://www.facebook.com/business/help/2038363993156008 (OFICIAL)
 * - Preço do WhatsApp (janela grátis de 72 h do anúncio clique para WhatsApp): https://developers.facebook.com/docs/whatsapp/pricing (OFICIAL)
 * - Impostos na fatura da Meta desde 01/01/2026 (cerca de 12,15%): https://www.reformatributaria.com/wp-content/uploads/2025/09/Comunicado-oficial-Meta.pdf (OFICIAL)
 * - Regras automáticas da Meta (a cada meia hora, limite de execuções e intervalo mínimo): https://developers.facebook.com/docs/marketing-api/ad-rules/overview/execution-spec (OFICIAL)
 * - Modelo de segurança para agente que escreve (diff antes e depois, aprovação dentro de tetos, idempotência, janela de volta): https://github.com/AgriciDaniel/claude-ads (PRÁTICA)
 * - Servidor MCP oficial da Meta (tudo nasce PAUSADO): https://www.facebook.com/business/news/meta-ads-ai-connectors (OFICIAL, 2026)
 * - Referência de desenho (confirmação em cada escrita): https://github.com/pipeboard-co/meta-ads-mcp
 * - Custos no Brasil por nicho (FRACA): custo por conversa https://www.messagecentral.com/blog/click-to-whatsapp-ads-brasil ; custo por lead https://www.intentmarketing.com.br/blog/post-quanto-custa-meta-ads ; academia https://blog.sistemapacto.com.br/meta-ads-para-academia/ ; CPM https://trafius.com.br/blog/cpm-medio-facebook-ads-brasil-2026
 * - Referência dos EUA (FORTE, só para ordem de grandeza): https://localiq.com/blog/facebook-advertising-benchmarks/
 */

/** Bloco do sistema do agente sênior (entra depois dos especialistas, antes das regras da execução). */
export const CONHECIMENTO_TRAFEGO = `GESTÃO DE TRÁFEGO NA META HOJE (síntese da agência, 2025 e 2026; números da Meta quando oficiais, o resto é prática de gestor)
Como a entrega funciona agora
- O Andromeda (sistema de recuperação da Meta, fim de 2024) escolhe quais anúncios entram no leilão para cada pessoa. Na prática, o criativo virou a principal segmentação: conceitos realmente diferentes (persona, ângulo, formato) abrem públicos novos; variações cosméticas do mesmo anúncio disputam como se fossem um só.
- Estrutura para negócio local (R$ 30 a 150 por dia): uma campanha, um conjunto amplo e consolidado com raio e idade mínima, 3 a 6 conceitos diferentes. Muitos conjuntos pequenos ficam em "Aprendizado limitado" para sempre.
- Advantage+ vem ligado por padrão em Vendas, Cadastros e App desde maio de 2025. No público Advantage+, só local, idioma, idade mínima e exclusões são rígidos; idade e gênero viram sugestão. Lead barato e ruim costuma vir da Audience Network: excluir e qualificar no formulário ou na conversa.
- O gasto de um dia pode passar do orçamento diário em até 75% (a Meta compensa na semana). Gasto do dia acima do orçamento não é erro; três vezes a média é.
- A fatura da Meta tem cerca de 12% de impostos desde 2026; o gasto que a API mostra é sem imposto. Diga qual dos dois está usando quando falar de custo.
Fase de aprendizado
- Oficial: cerca de 50 eventos de otimização em 7 dias por conjunto, contados desde a última edição significativa (pausar, trocar evento, público, criativo; orçamento e lance só quando a mudança é grande, sem percentual publicado). Pausa de 7 dias ou mais reinicia ao voltar.
- Negócio local quase nunca chega a 50 por semana: "Aprendizado limitado" é normal e pede consolidar ou otimizar para um evento mais frequente, não mexer todo dia.
Quando cortar (anúncio)
- A conversão chega com atraso de 24 a 72 h: não julgue custo por resultado antes de 3 dias de entrega.
- Sem nenhum resultado: um anúncio bom mostra zero resultado depois de gastar 1 vez o custo-alvo em 37% das vezes, 2 vezes em 14% e 3 vezes em 5% (conta de probabilidade). Por isso: candidato a pausar em 2 vezes o custo-alvo sem resultado; pausa firme em 3 vezes. Com 1 resultado, esperar até cerca de 4,5 vezes.
- Custo por resultado mais de 2 vezes o alvo, com 3 resultados ou mais e passado o aprendizado: pausar ou trocar o criativo.
- CTR de link abaixo de 0,8% é alerta; abaixo de 0,5% com 2.000 impressões ou mais e custo ruim, o criativo não conversa com o público. Nunca pausar por CTR baixo quando o custo por resultado está bom.
- Gasto mínimo antes de julgar qualquer coisa, e nunca pausar a última peça ativa sem motivo forte.
Quando escalar
- Só quem tem resultado estável: custo abaixo do alvo por pelo menos 3 dias, frequência abaixo de 2,5, fora do aprendizado, e criativo de reposição pronto.
- Subir no máximo 20% por vez e esperar 72 h (5 dias se ainda aprende). Mais que 30% de uma vez faz a Meta reexplorar o leilão. Escala horizontal: duplicar o conjunto vencedor. Voltar atrás se o custo passar de 1,5 vez o alvo.
Fadiga de criativo
- Frequência de 7 dias em público frio: até 2 saudável, 2 a 3,5 observar, acima de 3,5 a 4 agir; remarketing aguenta 5 a 8.
- Agir com dois sinais juntos: frequência alta e CTR caindo 20% ou mais, ou custo e CPM subindo 20 a 30% sem motivo sazonal.
- Raio pequeno cansa rápido: vigiar frequência mais do que a idade do criativo; ter 1 criativo novo por mês no mínimo.
Mensagens (WhatsApp, Direct, Messenger)
- Três caminhos: Engajamento com apps de mensagem otimizando conversas (padrão quando a venda não é medida); Cadastros com mensagem (o lead conta quando a pessoa termina as perguntas no chat; até 6 perguntas); Vendas com compras por mensagem (exige ao menos 5 compras enviadas em 30 dias).
- "Conversa iniciada" é a conversa aberta depois de 7 dias sem mensagem, atribuída ao anúncio. Custo por conversa sozinho engana: o que decide é quantas conversas viram orçamento, agendamento ou venda.
- Quando o atendimento marcar lead qualificado ou venda e devolver pela API de Conversões de mensagens (com o ctwa_clid, exige API do WhatsApp), migrar a otimização para lead qualificado ou compra por mensagem. Nunca usar o objetivo Tráfego para levar ao WhatsApp: ele otimiza clique.
- O anúncio clique para WhatsApp abre uma janela grátis de 72 h de mensagens.
Referência de custo no Brasil (fonte fraca, só ordem de grandeza; a própria conta e o briefing valem mais)
- Custo por conversa: clínicas e estética R$ 10 a 30; moda e beleza R$ 3 a 8; imóveis R$ 15 a 40; educação R$ 5 a 15.
- Custo por lead: saúde e clínicas R$ 20 a 60; advocacia R$ 40 a 120; imóveis R$ 30 a 100; cursos R$ 8 a 30; academia R$ 8 a 25; e-commerce R$ 15 a 50.
- CPM de feed: serviços locais R$ 10 a 22; saúde e clínicas R$ 28 a 50; imóveis R$ 25 a 45; delivery R$ 8 a 18. CPM médio do Brasil subiu cerca de 68% em 12 meses (2025 a 2026).
Agente que mexe na conta (segurança)
- Tudo o que é criado nasce pausado; ativar é decisão da pessoa. Antes de escrever, reler o estado; depois, reler e guardar o antes e o depois. Um teto diário de verba que nada ultrapassa, no máximo uma mudança de verba por item a cada 72 h, e um limite de ações por dia.
- Pausar é o reversível; arquivar é só para o que morreu (arquivado não volta a rodar).`;

type Faixa = [number, number];

/** Referências por nicho (ids de NICHOS em conhecimento-ads.ts). Todas de fonte fraca: último recurso do custo-alvo. */
const REFERENCIAS: Record<string, { mensagem?: Faixa; lead?: Faixa; cpm?: Faixa; fonte: string }> = {
  estetica: { mensagem: [10, 30], lead: [20, 60], cpm: [28, 50], fonte: "messagecentral.com e intentmarketing.com.br (2026, fonte fraca)" },
  odontologia: { mensagem: [10, 30], lead: [20, 60], cpm: [28, 50], fonte: "messagecentral.com e intentmarketing.com.br (2026, fonte fraca)" },
  saude_clinica: { mensagem: [10, 30], lead: [20, 60], cpm: [28, 50], fonte: "messagecentral.com e intentmarketing.com.br (2026, fonte fraca)" },
  advocacia: { lead: [40, 120], cpm: [10, 22], fonte: "intentmarketing.com.br e trafius.com.br (2026, fonte fraca)" },
  imobiliaria: { mensagem: [15, 40], lead: [30, 100], cpm: [25, 45], fonte: "messagecentral.com, intentmarketing.com.br e trafius.com.br (2026, fonte fraca)" },
  restaurante_delivery: { cpm: [8, 18], fonte: "trafius.com.br (2026, fonte fraca)" },
  academia: { lead: [8, 25], cpm: [10, 22], fonte: "blog.sistemapacto.com.br e trafius.com.br (2026, fonte fraca)" },
  moda: { mensagem: [3, 8], fonte: "messagecentral.com (2026, fonte fraca)" },
  beleza_salao: { mensagem: [3, 8], cpm: [10, 22], fonte: "messagecentral.com e trafius.com.br (2026, fonte fraca)" },
  cursos_infoproduto: { mensagem: [5, 15], lead: [8, 30], fonte: "messagecentral.com e intentmarketing.com.br (2026, fonte fraca)" },
  ecommerce_geral: { lead: [15, 50], fonte: "intentmarketing.com.br (2026, fonte fraca)" },
  automotivo_oficina: { cpm: [10, 22], fonte: "trafius.com.br (2026, fonte fraca)" },
  informatica_assistencia: { cpm: [10, 22], fonte: "trafius.com.br (2026, fonte fraca)" },
  construcao_reforma: { cpm: [10, 22], fonte: "trafius.com.br (2026, fonte fraca)" },
  paisagismo_jardim: { cpm: [10, 22], fonte: "trafius.com.br (2026, fonte fraca)" },
  pet: { cpm: [10, 22], fonte: "trafius.com.br (2026, fonte fraca)" },
  eventos_festas: { cpm: [10, 22], fonte: "trafius.com.br (2026, fonte fraca)" },
};

/** CTR de link mínimo e frequência de alerta gerais (AdManage 2026; adsights 2026; marketingskills). */
export const CTR_LINK_MINIMO_PCT = 0.5;
export const FREQUENCIA_DE_ALERTA = 3.5;

const meio = (f?: Faixa) => (f ? Math.round(((f[0] + f[1]) / 2) * 100) / 100 : null);

/**
 * Referência do nicho para o tipo de resultado (mensagens, leads...): custo
 * típico (meio da faixa), CTR mínimo e frequência de alerta, com a fonte.
 * Null quando o nicho não é conhecido.
 */
export function referenciaDoNicho(nichoId: string | null | undefined, tipoResultado: string | null | undefined): ReferenciaDoNicho | null {
  const r = nichoId ? REFERENCIAS[nichoId] : undefined;
  if (!r) return null;
  const faixa = tipoResultado === "mensagens" ? r.mensagem : tipoResultado === "leads" ? r.lead : undefined;
  return {
    custo_tipico_brl: meio(faixa),
    ctr_minimo_pct: CTR_LINK_MINIMO_PCT,
    frequencia_maxima: FREQUENCIA_DE_ALERTA,
    fonte: faixa ? `${r.fonte}: R$ ${faixa[0]} a R$ ${faixa[1]} por ${tipoResultado === "mensagens" ? "conversa" : "lead"}` : r.fonte,
  };
}

/** A faixa de CPM do nicho (para o retrato do agente comparar), ou null. */
export function cpmDoNicho(nichoId: string | null | undefined): Faixa | null {
  const r = nichoId ? REFERENCIAS[nichoId] : undefined;
  return r && r.cpm ? r.cpm : null;
}
