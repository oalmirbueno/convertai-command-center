/**
 * Agente sênior de tráfego da Mesa Ads (pedido do dono em 26/09/2026:
 * "conversar com um agente com toda a experiência, técnica e o conhecimento
 * que pegamos para melhorar a campanha; foco na mensagem e em vendas; como
 * otimizar os anúncios").
 *
 * Aqui fica o que é puro (sem Deno, sem banco), testado no Vitest:
 * - o esquema JSON da resposta (saída estrita);
 * - o pedido ao agente, com o contexto montado pela função;
 * - a normalização da saída: só ad_id que existe, escalar só com resultado
 *   real, números nunca negativos, sem travessão;
 * - o Markdown da estratégia (vai na conversa e no pacote do agente externo).
 *
 * Os números da conta vêm do código; o agente decide e explica, sem laço de
 * correção (uma chamada por mensagem).
 */
import { CTAS_META, ESTILOS_VISUAIS_IDS } from "../_shared/conhecimento-ads.ts";
import { semTravessao } from "./calculos.ts";
import { REGRA_DAS_ACOES_DA_CONTA, TIPOS_DE_ACAO } from "./acoes-conta.ts";

export const OBJETIVOS_SENIOR = ["vendas", "mensagens", "leads", "seguidores", "agendamento", "trafego", "reconhecimento"] as const;
export const FORMATOS_SENIOR = ["feed_4x5", "quadrado_1x1", "stories_9x16", "carrossel"] as const;
export const GRAVIDADES = ["alta", "media", "baixa"] as const;

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const lista = (items: unknown) => ({ type: "array", items });
const enumOuNulo = (l: readonly string[]) => ({ type: ["string", "null"], enum: [...l, null] });

const ESQUEMA_CONJUNTO = obj({
  nome: S("string"),
  publico: S("string"),
  orcamento_diario_brl: S(["number", "null"]),
  anuncios: lista(S("string")),
});

export const ESQUEMA_AGENTE_SENIOR = {
  nome: "estrategia_do_agente_senior",
  schema: obj({
    resposta: S("string"),
    diagnostico: lista(obj({ titulo: S("string"), detalhe: S("string"), gravidade: S("string", { enum: [...GRAVIDADES] }) })),
    manter: lista(obj({ ad_id: S("string"), porque: S("string") })),
    cortar: lista(obj({ ad_id: S("string"), porque: S("string") })),
    escalar: lista(obj({ ad_id: S("string"), porque: S("string"), como: S("string") })),
    reestruturacao: obj({
      objetivo: enumOuNulo(OBJETIVOS_SENIOR),
      porque: S("string"),
      evento_otimizacao: S("string"),
      campanhas: lista(obj({
        nome: S("string"),
        objetivo: enumOuNulo(OBJETIVOS_SENIOR),
        orcamento_diario_brl: S(["number", "null"]),
        conjuntos: lista(ESQUEMA_CONJUNTO),
      })),
      verba_total_diaria_brl: S(["number", "null"]),
      passos: lista(S("string")),
    }),
    proximos_criativos: lista(obj({
      titulo: S("string"),
      angulo: S("string"),
      gancho_verbal: S("string"),
      gancho_visual: S("string"),
      formato: S("string", { enum: [...FORMATOS_SENIOR] }),
      estilo_visual: enumOuNulo(ESTILOS_VISUAIS_IDS),
      objetivo: enumOuNulo(OBJETIVOS_SENIOR),
      cta_meta: S("string", { enum: [...CTAS_META] }),
      base_ad_id: S(["string", "null"]),
      porque: S("string"),
    })),
    pesquisa: lista(obj({ achado: S("string"), fonte: S("string") })),
    perguntas: lista(S("string")),
    // Ações que o agente faria na conta (a equipe confirma; acoes-conta.ts traduz os apelidos).
    resumo_das_acoes: S("string"),
    acoes: lista(obj({
      tipo: S("string", { enum: [...TIPOS_DE_ACAO] }),
      ref: S(["string", "null"]),
      criativo_ref: S(["string", "null"]),
      texto: S(["string", "null"]),
      variacao_pct: S(["number", "null"]),
      motivo: S("string"),
    })),
    // O plano de teste já preenchido (o botão "Levar ao Plano de teste" cria sem formulário vazio).
    plano_de_teste: obj({
      hipotese: S("string"),
      variavel: S("string"),
      publico: S("string"),
      orcamento_diario_brl: S(["number", "null"]),
      duracao_dias: S(["integer", "null"]),
      metrica_decisao: S("string"),
      criterio_vitoria: S("string"),
    }),
  }),
};

export type Gravidade = (typeof GRAVIDADES)[number];

export type EstrategiaSenior = {
  resposta: string;
  diagnostico: { titulo: string; detalhe: string; gravidade: Gravidade }[];
  manter: { ad_id: string; porque: string }[];
  cortar: { ad_id: string; porque: string }[];
  escalar: { ad_id: string; porque: string; como: string }[];
  reestruturacao: {
    objetivo: string | null;
    porque: string;
    evento_otimizacao: string;
    campanhas: { nome: string; objetivo: string | null; orcamento_diario_brl: number | null; conjuntos: { nome: string; publico: string; orcamento_diario_brl: number | null; anuncios: string[] }[] }[];
    verba_total_diaria_brl: number | null;
    passos: string[];
  };
  proximos_criativos: {
    titulo: string;
    angulo: string;
    gancho_verbal: string;
    gancho_visual: string;
    formato: string;
    estilo_visual: string | null;
    objetivo: string | null;
    cta_meta: string;
    base_ad_id: string | null;
    porque: string;
  }[];
  pesquisa: { achado: string; fonte: string }[];
  perguntas: string[];
  plano_de_teste: {
    hipotese: string;
    variavel: string;
    publico: string;
    orcamento_diario_brl: number | null;
    duracao_dias: number | null;
    metrica_decisao: string;
    criterio_vitoria: string;
  } | null;
};

const txt = (v: unknown, max = 2000) => (typeof v === "string" ? semTravessao(v.trim()).slice(0, max) : "");
const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
const doEnum = <T extends string>(v: unknown, l: readonly T[]): T | null => ((l as readonly string[]).indexOf(String(v)) >= 0 ? (v as T) : null);
const valor = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

/**
 * Normaliza a saída do agente. `ads` = anúncios que o agente recebeu com o
 * número de resultados de cada um: ad_id fora da lista sai; escalar só com
 * resultado real (regra da honestidade).
 */
export function normalizarEstrategia(bruto: unknown, ads: Map<string, { resultados: number }>): EstrategiaSenior {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const conhecido = (x: Record<string, unknown>) => ads.has(String(x.ad_id));
  const re = (r.reestruturacao && typeof r.reestruturacao === "object" ? r.reestruturacao : {}) as Record<string, unknown>;
  const vistos = new Set<string>();
  const unico = (id: string) => (vistos.has(id) ? false : (vistos.add(id), true));
  return {
    resposta: txt(r.resposta, 6000),
    diagnostico: arr(r.diagnostico).map((d) => ({ titulo: txt(d.titulo, 200), detalhe: txt(d.detalhe, 1500), gravidade: doEnum(d.gravidade, GRAVIDADES) ?? "media" })).filter((d) => d.titulo).slice(0, 10),
    // Um anúncio fica em um grupo só: cortar vence (o mais conservador), depois escalar, depois manter.
    cortar: arr(r.cortar).filter(conhecido).map((x) => ({ ad_id: String(x.ad_id), porque: txt(x.porque, 800) })).filter((x) => unico(x.ad_id)).slice(0, 30),
    escalar: arr(r.escalar)
      .filter((x) => conhecido(x) && (ads.get(String(x.ad_id))?.resultados ?? 0) > 0)
      .map((x) => ({ ad_id: String(x.ad_id), porque: txt(x.porque, 800), como: txt(x.como, 600) }))
      .filter((x) => unico(x.ad_id))
      .slice(0, 20),
    manter: arr(r.manter).filter(conhecido).map((x) => ({ ad_id: String(x.ad_id), porque: txt(x.porque, 800) })).filter((x) => unico(x.ad_id)).slice(0, 30),
    reestruturacao: {
      objetivo: doEnum(re.objetivo, OBJETIVOS_SENIOR),
      porque: txt(re.porque, 2000),
      evento_otimizacao: txt(re.evento_otimizacao, 300),
      campanhas: arr(re.campanhas).slice(0, 6).map((c) => ({
        nome: txt(c.nome, 160),
        objetivo: doEnum(c.objetivo, OBJETIVOS_SENIOR),
        orcamento_diario_brl: valor(c.orcamento_diario_brl),
        conjuntos: arr(c.conjuntos).slice(0, 8).map((j) => ({
          nome: txt(j.nome, 160),
          publico: txt(j.publico, 800),
          orcamento_diario_brl: valor(j.orcamento_diario_brl),
          anuncios: (Array.isArray(j.anuncios) ? j.anuncios : []).map((a) => txt(a, 200)).filter(Boolean).slice(0, 12),
        })).filter((j) => j.nome),
      })).filter((c) => c.nome),
      verba_total_diaria_brl: valor(re.verba_total_diaria_brl),
      passos: (Array.isArray(re.passos) ? re.passos : []).map((p) => txt(p, 600)).filter(Boolean).slice(0, 12),
    },
    proximos_criativos: arr(r.proximos_criativos).slice(0, 10).map((c) => ({
      titulo: txt(c.titulo, 160),
      angulo: txt(c.angulo, 800),
      gancho_verbal: txt(c.gancho_verbal, 300),
      gancho_visual: txt(c.gancho_visual, 600),
      formato: doEnum(c.formato, FORMATOS_SENIOR) ?? "feed_4x5",
      estilo_visual: doEnum(c.estilo_visual, ESTILOS_VISUAIS_IDS),
      objetivo: doEnum(c.objetivo, OBJETIVOS_SENIOR),
      cta_meta: doEnum(c.cta_meta, CTAS_META) ?? "Saiba mais",
      base_ad_id: c.base_ad_id && ads.has(String(c.base_ad_id)) ? String(c.base_ad_id) : null,
      porque: txt(c.porque, 800),
    })).filter((c) => c.titulo),
    pesquisa: arr(r.pesquisa).map((p) => ({ achado: txt(p.achado, 800), fonte: txt(p.fonte, 500) })).filter((p) => p.achado).slice(0, 12),
    perguntas: (Array.isArray(r.perguntas) ? r.perguntas : []).map((p) => txt(p, 400)).filter(Boolean).slice(0, 6),
    plano_de_teste: planoDeTesteBruto(r.plano_de_teste),
  };
}

/** O plano_de_teste do modelo, sem número negativo; null quando veio vazio. */
function planoDeTesteBruto(v: unknown): EstrategiaSenior["plano_de_teste"] {
  const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const dias = valor(p.duracao_dias);
  const plano = {
    hipotese: txt(p.hipotese, 1200),
    variavel: txt(p.variavel, 300),
    publico: txt(p.publico, 600),
    orcamento_diario_brl: valor(p.orcamento_diario_brl),
    duracao_dias: dias === null ? null : Math.min(30, Math.max(1, Math.round(dias))),
    metrica_decisao: txt(p.metrica_decisao, 200),
    criterio_vitoria: txt(p.criterio_vitoria, 600),
  };
  return plano.hipotese || plano.criterio_vitoria || plano.publico ? plano : null;
}

const reais = (v: number | null) => (v == null ? "sem valor definido" : `R$ ${v.toFixed(2).replace(".", ",")}`);
const ROTULO_OBJETIVO: Record<string, string> = {
  vendas: "Vendas", mensagens: "Mensagens", leads: "Cadastros", seguidores: "Seguidores", agendamento: "Agendamento", trafego: "Tráfego", reconhecimento: "Reconhecimento",
};

/** A estratégia em Markdown (conversa, pacote do agente externo). nomeDe traduz ad_id em nome. */
export function estrategiaEmMarkdown(e: EstrategiaSenior, nomeDe: (adId: string) => string = (x) => x): string {
  const L: string[] = [];
  if (e.resposta) L.push(e.resposta, "");
  if (e.diagnostico.length) {
    L.push("## Diagnóstico", "");
    for (const d of e.diagnostico) L.push(`- [${d.gravidade}] ${d.titulo}: ${d.detalhe}`);
    L.push("");
  }
  const grupo = (titulo: string, itens: { ad_id: string; porque: string; como?: string }[]) => {
    if (!itens.length) return;
    L.push(`## ${titulo}`, "");
    for (const i of itens) L.push(`- ${nomeDe(i.ad_id)} (ad_id ${i.ad_id}): ${i.porque}${i.como ? ` Como: ${i.como}` : ""}`);
    L.push("");
  };
  grupo("Escalar", e.escalar);
  grupo("Manter", e.manter);
  grupo("Cortar", e.cortar);
  const re = e.reestruturacao;
  if (re.porque || re.campanhas.length) {
    L.push("## Reestruturação recomendada", "");
    if (re.objetivo) L.push(`- Objetivo principal: ${ROTULO_OBJETIVO[re.objetivo] ?? re.objetivo}`);
    if (re.evento_otimizacao) L.push(`- Evento de otimização: ${re.evento_otimizacao}`);
    if (re.porque) L.push(`- Por quê: ${re.porque}`);
    L.push(`- Verba diária total: ${reais(re.verba_total_diaria_brl)}`);
    for (const c of re.campanhas) {
      L.push("", `### Campanha: ${c.nome}${c.objetivo ? ` (${ROTULO_OBJETIVO[c.objetivo] ?? c.objetivo})` : ""}`, "");
      if (c.orcamento_diario_brl != null) L.push(`- Orçamento diário: ${reais(c.orcamento_diario_brl)}`);
      for (const j of c.conjuntos) {
        L.push(`- Conjunto ${j.nome}: ${j.publico}${j.orcamento_diario_brl != null ? `. Verba: ${reais(j.orcamento_diario_brl)} por dia` : ""}${j.anuncios.length ? `. Anúncios: ${j.anuncios.map((a) => nomeDe(a)).join("; ")}` : ""}`);
      }
    }
    if (re.passos.length) {
      L.push("", "Passos:", "");
      re.passos.forEach((p, i) => L.push(`${i + 1}. ${p}`));
    }
    L.push("");
  }
  if (e.proximos_criativos.length) {
    L.push("## Próximos criativos", "");
    e.proximos_criativos.forEach((c, i) => {
      L.push(`### ${i + 1}. ${c.titulo}`, "");
      L.push(`- Ângulo: ${c.angulo}`);
      L.push(`- Gancho verbal: ${c.gancho_verbal}`);
      L.push(`- Gancho visual: ${c.gancho_visual}`);
      L.push(`- Formato: ${c.formato}${c.estilo_visual ? `. Estilo: ${c.estilo_visual}` : ""}${c.objetivo ? `. Objetivo: ${ROTULO_OBJETIVO[c.objetivo] ?? c.objetivo}` : ""}. Botão: ${c.cta_meta}`);
      if (c.base_ad_id) L.push(`- Parte do anúncio: ${nomeDe(c.base_ad_id)} (ad_id ${c.base_ad_id})`);
      if (c.porque) L.push(`- Por quê: ${c.porque}`);
      L.push("");
    });
  }
  if (e.plano_de_teste) {
    const t = e.plano_de_teste;
    L.push("## Plano de teste", "");
    if (t.hipotese) L.push(`- Hipótese: ${t.hipotese}`);
    if (t.variavel) L.push(`- Variável testada: ${t.variavel}`);
    if (t.publico) L.push(`- Público: ${t.publico}`);
    L.push(`- Verba diária: ${reais(t.orcamento_diario_brl)}`);
    if (t.duracao_dias) L.push(`- Duração: ${t.duracao_dias} dias`);
    if (t.metrica_decisao) L.push(`- Métrica de decisão: ${t.metrica_decisao}`);
    if (t.criterio_vitoria) L.push(`- Critério de vitória: ${t.criterio_vitoria}`);
    L.push("");
  }
  if (e.pesquisa.length) {
    L.push("## O que a pesquisa mostrou", "");
    for (const p of e.pesquisa) L.push(`- ${p.achado}${p.fonte ? ` (fonte: ${p.fonte})` : ""}`);
    L.push("");
  }
  if (e.perguntas.length) {
    L.push("## Perguntas para a equipe", "");
    for (const p of e.perguntas) L.push(`- ${p}`);
    L.push("");
  }
  return semTravessao(L.join("\n").trim());
}

/** Pedido de cada mensagem ao agente sênior (o contexto vai antes, em JSON). */
export function tarefaDoAgenteSenior(opcoes: { pesquisaWeb: boolean; bibliotecaConsultada: boolean; temPlano: boolean; modoAgir?: boolean }): string {
  const agir = opcoes.modoAgir
    ? "MODO AGIR: a equipe quer ação, não conversa. resposta em no máximo 2 frases; diagnostico com até 3 achados; entregue acoes concretas (com os apelidos) e o plano_de_teste preenchido.\n"
    : "";
  return `${agir}TAREFA: você é o gestor de tráfego sênior da agência, especialista no nicho deste cliente. Responda à MENSAGEM DA EQUIPE e devolva a estratégia estruturada.
Como pensar, nesta ordem:
1. Entenda o negócio pelo contexto (o que vende, para quem, onde a venda acontece: WhatsApp, Direct, site, loja) e o nicho.
2. Leia a conta: onde o dinheiro está por objetivo (MIX_DE_OBJETIVOS, calculado pelo painel), o que traz resultado de verdade e o que só gera curtida. Engajamento barato não paga conta: se o negócio vende por conversa, o objetivo que decide é mensagem; se vende no site com pixel, é compra.
3. Use os anúncios que já performaram como base dos próximos criativos (gancho, formato, oferta), mudando uma variável por vez.
4. ${opcoes.pesquisaWeb ? "Pesquise na web o que funciona no Brasil neste nicho (anúncios, ofertas, ganchos, concorrentes, a Biblioteca de Anúncios da Meta pelas páginas públicas) e registre em pesquisa cada achado com a fonte (endereço). Longevidade de anúncio é pista, não prova de retorno." : "Sem pesquisa web nesta mensagem: use só o contexto e o conhecimento da agência; pesquisa fica vazia."}${opcoes.bibliotecaConsultada ? " BIBLIOTECA_DE_ANUNCIOS traz anúncios ativos lidos pela API da Meta: use como exemplo do mercado, com o link." : ""}
5. ${opcoes.temPlano ? "PLANO_ABERTO é o plano de teste que a equipe está olhando: ajuste a recomendação a ele." : "Se houver planos de teste, considere os ângulos já planejados."}
Saída:
- resposta: a conversa com a equipe, direta, em português simples, até 12 frases, citando só números do contexto.
- diagnostico: de 2 a 6 achados (ex.: "tudo em engajamento sem objetivo de venda"), com gravidade.
- manter, cortar, escalar: ad_ids da lista ANUNCIOS com o porquê em números. O sinal_do_codigo é a régua da agência: discorde só com motivo claro. Escalar só quem tem resultado; "como" diz o jeito (verba aos poucos, duplicar, novo público).
- reestruturacao: objetivo principal, evento de otimização, campanhas com conjuntos (público e verba) e os anúncios de cada um (ad_ids existentes ou títulos dos próximos criativos), verba total e passos na ordem. Verba só a partir do gasto real do período ou da verba do briefing; sem base, null e diga na resposta.
- proximos_criativos: de 3 a 6 peças com ângulo, ganchos, formato, estilo, objetivo, botão e o anúncio base (base_ad_id) quando partir de um que performou.
- perguntas: o que falta saber para decidir melhor (no máximo 4).
- plano_de_teste: o teste que você rodaria com os proximos_criativos, já preenchido para a equipe só revisar: hipotese (uma frase), variavel (a única coisa que muda entre os anúncios), publico, orcamento_diario_brl (do gasto real ou da verba do briefing; sem base, null), duracao_dias, metrica_decisao e criterio_vitoria (com o número de corte quando houver custo de referência no contexto).
${REGRA_DAS_ACOES_DA_CONTA}
- resumo_das_acoes: uma frase dizendo o que as acoes fazem ("pausar 2 anúncios que gastam sem conversa e subir 20% da verba do vencedor"); vazio sem acoes. Na resposta, diga que a lista está pronta para confirmar e que nada muda na conta sem a confirmação.
Regras: nunca invente número, depoimento, preço ou resultado; política da Meta é regra dura; sem travessão; período curto ou pouco volume é inconclusivo, diga isso.`;
}

// ------------------------------------------------------------------ Biblioteca de Anúncios (leitura)

export type AnuncioDaBiblioteca = { id: string; pagina: string; texto: string; titulo: string; inicio: string | null; link: string };

/** Resposta do ads_archive em forma curta, sem nenhum campo que carregue token (ad_snapshot_url leva o token na URL). */
export function anunciosDaBiblioteca(bruto: unknown): AnuncioDaBiblioteca[] {
  const data = bruto && typeof bruto === "object" && Array.isArray((bruto as Record<string, unknown>).data) ? (bruto as { data: Record<string, unknown>[] }).data : [];
  return data.map((a) => {
    const id = typeof a.id === "string" ? a.id : String(a.id ?? "");
    const bodies = Array.isArray(a.ad_creative_bodies) ? a.ad_creative_bodies : [];
    const titulos = Array.isArray(a.ad_creative_link_titles) ? a.ad_creative_link_titles : [];
    return {
      id,
      pagina: txt(a.page_name, 120),
      texto: txt(bodies[0], 600),
      titulo: txt(titulos[0], 120),
      inicio: typeof a.ad_delivery_start_time === "string" ? a.ad_delivery_start_time.slice(0, 10) : null,
      link: /^\d+$/.test(id) ? `https://www.facebook.com/ads/library/?id=${id}` : "",
    };
  }).filter((a) => a.id && (a.texto || a.titulo)).slice(0, 20);
}
