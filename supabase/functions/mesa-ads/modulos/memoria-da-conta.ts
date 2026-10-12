/**
 * Memória da conta de tráfego em 8 camadas (12/10/2026, skill memoria-de-conta-ads).
 *
 * Puro: sem Deno, sem banco, sem rede (testado no Vitest). Quem lê e grava é o index.ts.
 *
 * O que a equipe preenche (tabela ads_memoria_da_conta, versionada):
 *   00 comportamento, 01 finanças, 03 confiabilidade dos dados, 06 mercado e calendário, 07 fonte que prevalece.
 * O que o código monta das tabelas que já existem (nada duplicado):
 *   02 mapa e histórico (campanhas, pausados, o que foi feito), 04 regras de decisão (limites da rotina
 *   com a fonte de cada um), 05 biblioteca de criativos (ads_aprendizados + vencedores e perdedores da
 *   conta), 07 atualidade dos dados (última coleta).
 *
 * Regra da casa: CPA máximo e ROAS de equilíbrio são calculados aqui, nunca pela IA.
 *   venda: CPA máximo = ticket médio x margem de contribuição; ROAS de equilíbrio = 1 / margem.
 *   lead:  custo máximo por lead = ticket x margem x taxa de fechamento.
 */

export type TipoDeConversao = "venda" | "lead";

export type CamadasPreenchidas = {
  comportamento: { observacoes: string };
  financas: {
    ticket_medio_brl: number | null;
    /** Margem de contribuição (%) depois de custo do produto, impostos e taxas; sem o anúncio. */
    margem_pct: number | null;
    conversao: TipoDeConversao;
    /** Só para lead: quantos leads em 100 viram venda. */
    taxa_fechamento_pct: number | null;
    /** Compras do mesmo cliente em 12 meses (para o valor do cliente no tempo). */
    compras_no_ano: number | null;
    observacoes: string;
  };
  confiabilidade: {
    pixel: "ok" | "com_problema" | "nao_tem" | "nao_sei";
    api_de_conversoes: "ok" | "com_problema" | "nao_tem" | "nao_sei";
    evento_principal: string;
    janela_de_atribuicao: string;
    armadilhas: string;
  };
  mercado: {
    sazonalidade: string;
    ciclo_de_compra_dias: number | null;
    datas: { dia: string; nome: string }[];
  };
  dados: {
    /** Quando a Meta e as vendas registradas discordam, qual vale. */
    fonte_que_prevalece: "meta" | "vendas_registradas" | "crm" | "nao_definido";
    observacoes: string;
  };
};

export const CAMADAS_VAZIAS: CamadasPreenchidas = {
  comportamento: { observacoes: "" },
  financas: { ticket_medio_brl: null, margem_pct: null, conversao: "venda", taxa_fechamento_pct: null, compras_no_ano: null, observacoes: "" },
  confiabilidade: { pixel: "nao_sei", api_de_conversoes: "nao_sei", evento_principal: "", janela_de_atribuicao: "", armadilhas: "" },
  mercado: { sazonalidade: "", ciclo_de_compra_dias: null, datas: [] },
  dados: { fonte_que_prevalece: "nao_definido", observacoes: "" },
};

/** Travessão vira vírgula; montado pelo código do caractere para o arquivo não ter o sinal. */
const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]", "g");
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.replace(TRAVESSAO, ",").replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
const numero = (v: unknown): number | null => {
  // "1.234,56" (com vírgula) tira o ponto de milhar; "12.5" (sem vírgula) fica como está.
  const s = typeof v === "string" ? v.trim().replace(/^R\$\s*/i, "").replace(/%$/, "") : "";
  const n = typeof v === "number" ? v : s ? Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) : NaN;
  return Number.isFinite(n) ? n : null;
};
const naFaixa = (v: unknown, min: number, max: number): number | null => {
  const n = numero(v);
  return n !== null && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
};
const umDe = <T extends string>(v: unknown, aceitos: readonly T[], padrao: T): T => (aceitos.includes(v as T) ? (v as T) : padrao);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** O que veio da tela vira camadas válidas: número fora da faixa some, texto é aparado, enum fora da lista volta ao padrão. */
export function normalizarCamadas(bruto: unknown): CamadasPreenchidas {
  const b = obj(bruto);
  const c = obj(b.comportamento), f = obj(b.financas), q = obj(b.confiabilidade), m = obj(b.mercado), d = obj(b.dados);
  const SITUACAO = ["ok", "com_problema", "nao_tem", "nao_sei"] as const;
  const datas = Array.isArray(m.datas) ? m.datas : [];
  return {
    comportamento: { observacoes: texto(c.observacoes, 1500) },
    financas: {
      ticket_medio_brl: naFaixa(f.ticket_medio_brl, 0.01, 10_000_000),
      margem_pct: naFaixa(f.margem_pct, 0.1, 100),
      conversao: umDe(f.conversao, ["venda", "lead"] as const, "venda"),
      taxa_fechamento_pct: naFaixa(f.taxa_fechamento_pct, 0.1, 100),
      compras_no_ano: naFaixa(f.compras_no_ano, 1, 365),
      observacoes: texto(f.observacoes, 800),
    },
    confiabilidade: {
      pixel: umDe(q.pixel, SITUACAO, "nao_sei"),
      api_de_conversoes: umDe(q.api_de_conversoes, SITUACAO, "nao_sei"),
      evento_principal: texto(q.evento_principal, 120),
      janela_de_atribuicao: texto(q.janela_de_atribuicao, 120),
      armadilhas: texto(q.armadilhas, 1200),
    },
    mercado: {
      sazonalidade: texto(m.sazonalidade, 1200),
      ciclo_de_compra_dias: naFaixa(m.ciclo_de_compra_dias, 0, 3650),
      datas: datas
        .map((x) => obj(x))
        .map((x) => ({ dia: texto(x.dia, 10), nome: texto(x.nome, 80) }))
        .filter((x) => /^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}$/.test(x.dia) && x.nome)
        .slice(0, 24),
    },
    dados: {
      fonte_que_prevalece: umDe(d.fonte_que_prevalece, ["meta", "vendas_registradas", "crm", "nao_definido"] as const, "nao_definido"),
      observacoes: texto(d.observacoes, 800),
    },
  };
}

export type Financas = {
  /** Custo máximo por resultado que ainda empata (R$): por compra na venda, por lead no lead. */
  custo_maximo_brl: number | null;
  /** O resultado ao qual o custo máximo se refere. */
  por: "compra" | "lead" | null;
  roas_de_equilibrio: number | null;
  /** Contribuição de um cliente em 12 meses (R$). */
  valor_do_cliente_no_ano_brl: number | null;
  /** O que falta preencher para cada número sair. */
  faltando: string[];
  /** Como cada número foi calculado (para a tela e para o agente citar). */
  contas: string[];
};

const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/** As contas da camada 01 (código, nunca a IA). Denominador zero ou dado ausente: o número fica nulo e diz o que falta. */
export function calcularFinancas(f: CamadasPreenchidas["financas"]): Financas {
  const faltando: string[] = [];
  const contas: string[] = [];
  if (f.ticket_medio_brl === null) faltando.push("ticket médio");
  if (f.margem_pct === null) faltando.push("margem de contribuição");
  if (f.conversao === "lead" && f.taxa_fechamento_pct === null) faltando.push("taxa de fechamento dos leads");
  const margem = f.margem_pct !== null ? f.margem_pct / 100 : null;
  const contribuicao = f.ticket_medio_brl !== null && margem !== null ? f.ticket_medio_brl * margem : null;
  let custo: number | null = null;
  if (contribuicao !== null) {
    if (f.conversao === "venda") {
      custo = contribuicao;
      contas.push(`CPA máximo = ticket ${reais(f.ticket_medio_brl as number)} x margem ${f.margem_pct}% = ${reais(custo)} por compra.`);
    } else if (f.taxa_fechamento_pct !== null) {
      custo = contribuicao * (f.taxa_fechamento_pct / 100);
      contas.push(`Custo máximo por lead = ticket ${reais(f.ticket_medio_brl as number)} x margem ${f.margem_pct}% x fechamento ${f.taxa_fechamento_pct}% = ${reais(custo)}.`);
    }
  }
  const roas = margem !== null && margem > 0 ? Math.round((1 / margem) * 100) / 100 : null;
  if (roas !== null) contas.push(`ROAS de equilíbrio = 1 / margem ${f.margem_pct}% = ${String(roas).replace(".", ",")}. Abaixo disso o anúncio dá prejuízo na primeira compra.`);
  const valor = contribuicao !== null && f.compras_no_ano !== null ? contribuicao * f.compras_no_ano : null;
  if (valor !== null) contas.push(`Valor do cliente no ano = contribuição ${reais(contribuicao as number)} x ${f.compras_no_ano} compras = ${reais(valor)}.`);
  return {
    custo_maximo_brl: custo !== null ? Math.round(custo * 100) / 100 : null,
    por: custo !== null ? (f.conversao === "venda" ? "compra" : "lead") : null,
    roas_de_equilibrio: roas,
    valor_do_cliente_no_ano_brl: valor !== null ? Math.round(valor * 100) / 100 : null,
    faltando,
    contas,
  };
}

/**
 * O custo máximo só vira custo-alvo da rotina quando o tipo de resultado da conta bate com o que a
 * conta mede (compra com compra, lead com lead). Senão, comparar dá decisão errada: fica nulo.
 */
export function custoAlvoDasFinancas(fin: Financas, resultadoDaConta: string | null): number | null {
  if (fin.custo_maximo_brl === null || !resultadoDaConta) return null;
  const r = resultadoDaConta.toLowerCase();
  const ehCompra = /purchase|compra|venda/.test(r);
  const ehLead = /lead|cadastro|formul|contato|mensag|conversa/.test(r);
  if (fin.por === "compra" && ehCompra) return fin.custo_maximo_brl;
  if (fin.por === "lead" && ehLead) return fin.custo_maximo_brl;
  return null;
}

// ------------------------------------------------------------------ as 8 camadas montadas

export type CamadaMontada = { id: string; titulo: string; fonte: "equipe" | "calculado" | "conta" | "regra fixa"; linhas: string[] };

export type EntradaDaMemoria = {
  preenchidas: CamadasPreenchidas;
  financas: Financas;
  /** Camada 02 (da conta). */
  mapa: { campanhas_ativas: string[]; pausados_recentes: string[]; feito_recente: string[]; ofertas_arquivadas: string[] };
  /** Camada 04: os limites que valem hoje, com a fonte de cada um, e as regras ensinadas. */
  regras: { limites: { nome: string; valor: string; fonte: string }[]; ensinadas: string[] };
  /** Camada 05. */
  biblioteca: { aprendizados: string[]; vencedores: string[]; perdedores: string[] };
  /** Camada 07 (da conta). */
  atualidade: { ultima_coleta: string | null; horas_desde_a_coleta: number | null; contas_conectadas: number };
};

const ROTULO_SITUACAO: Record<string, string> = { ok: "funcionando", com_problema: "com problema", nao_tem: "não instalado", nao_sei: "não conferido" };
const ROTULO_FONTE: Record<string, string> = { meta: "a Meta", vendas_registradas: "as vendas registradas no painel", crm: "o CRM do cliente", nao_definido: "não definido" };

/** Comportamento fixo da camada 00 (o que vale para todo agente de tráfego, antes do que a equipe acrescenta). */
export const COMPORTAMENTO_FIXO = [
  "Não inventar certeza: separar o que foi medido do que é hipótese.",
  "Avisar quando falta dado para decidir, e dizer qual.",
  "Citar a camada da memória (C01, C04...) em toda decisão.",
  "Nada é aplicado na conta sem a lista exata e o Confirmar da equipe.",
];

export function montarCamadas(e: EntradaDaMemoria): CamadaMontada[] {
  const p = e.preenchidas;
  const f = e.financas;
  const vazio = (l: string[], msg: string) => (l.length ? l : [msg]);
  const c01: string[] = [];
  if (p.financas.ticket_medio_brl !== null) c01.push(`Ticket médio: ${reais(p.financas.ticket_medio_brl)}.`);
  if (p.financas.margem_pct !== null) c01.push(`Margem de contribuição: ${p.financas.margem_pct}%.`);
  c01.push(`Resultado que paga a conta: ${p.financas.conversao === "venda" ? "venda" : `lead${p.financas.taxa_fechamento_pct !== null ? ` (${p.financas.taxa_fechamento_pct}% viram venda)` : ""}`}.`);
  c01.push(...f.contas);
  if (f.faltando.length) c01.push(`Falta preencher: ${f.faltando.join(", ")}. Sem isso o agente não sabe o custo máximo.`);
  if (p.financas.observacoes) c01.push(p.financas.observacoes);

  const c03 = [
    `Pixel: ${ROTULO_SITUACAO[p.confiabilidade.pixel]}. API de Conversões: ${ROTULO_SITUACAO[p.confiabilidade.api_de_conversoes]}.`,
    p.confiabilidade.evento_principal ? `Evento principal: ${p.confiabilidade.evento_principal}.` : "Evento principal não informado.",
    p.confiabilidade.janela_de_atribuicao ? `Janela de atribuição: ${p.confiabilidade.janela_de_atribuicao}.` : "",
    p.confiabilidade.armadilhas,
  ].filter(Boolean);

  const c06 = [
    p.mercado.sazonalidade,
    p.mercado.ciclo_de_compra_dias !== null ? `Ciclo de compra: cerca de ${p.mercado.ciclo_de_compra_dias} dias entre o primeiro contato e a compra.` : "",
    ...p.mercado.datas.map((d) => `${d.dia}: ${d.nome}.`),
  ].filter(Boolean);

  const a = e.atualidade;
  const c07 = [
    a.ultima_coleta ? `Última coleta da Meta: ${a.ultima_coleta}${a.horas_desde_a_coleta !== null ? ` (há ${a.horas_desde_a_coleta} h)` : ""}.` : "Nenhuma coleta da Meta registrada.",
    `${a.contas_conectadas} ${a.contas_conectadas === 1 ? "conta de anúncio conectada" : "contas de anúncio conectadas"}.`,
    `Quando a Meta e outra fonte discordam, vale ${ROTULO_FONTE[p.dados.fonte_que_prevalece]}.`,
    p.dados.observacoes,
  ].filter(Boolean);
  if (a.horas_desde_a_coleta !== null && a.horas_desde_a_coleta > 6) c07.push("A coleta está parada há mais de 6 h: não decidir com estes números antes de sincronizar.");

  return [
    { id: "C00", titulo: "Comportamento", fonte: "regra fixa", linhas: [...COMPORTAMENTO_FIXO, ...(p.comportamento.observacoes ? [p.comportamento.observacoes] : [])] },
    { id: "C01", titulo: "Finanças", fonte: f.contas.length ? "calculado" : "equipe", linhas: c01 },
    { id: "C02", titulo: "Mapa e histórico", fonte: "conta", linhas: vazio([
      ...(e.mapa.campanhas_ativas.length ? [`Campanhas ativas: ${e.mapa.campanhas_ativas.join("; ")}.`] : []),
      ...(e.mapa.pausados_recentes.length ? [`Pausados recentes: ${e.mapa.pausados_recentes.join("; ")}.`] : []),
      ...e.mapa.feito_recente.map((x) => `Feito: ${x}`),
      ...(e.mapa.ofertas_arquivadas.length ? [`Ofertas arquivadas: ${e.mapa.ofertas_arquivadas.join("; ")}.`] : []),
    ], "Sem campanha nem histórico registrado ainda.") },
    { id: "C03", titulo: "Confiabilidade dos dados", fonte: "equipe", linhas: c03 },
    { id: "C04", titulo: "Regras de decisão", fonte: "conta", linhas: vazio([
      ...e.regras.limites.map((l) => `${l.nome}: ${l.valor} (fonte: ${l.fonte}).`),
      ...e.regras.ensinadas.map((r) => `Regra do dono: ${r}`),
    ], "Nenhum limite definido: valem os padrões da rotina.") },
    { id: "C05", titulo: "Biblioteca de criativos", fonte: "conta", linhas: vazio([
      ...e.biblioteca.vencedores.map((x) => `Vencedor: ${x}`),
      ...e.biblioteca.perdedores.map((x) => `Perdedor: ${x}`),
      ...e.biblioteca.aprendizados.map((x) => `Aprendizado: ${x}`),
    ], "Nenhum criativo com dado suficiente ainda.") },
    { id: "C06", titulo: "Mercado e calendário", fonte: "equipe", linhas: vazio(c06, "Sazonalidade e datas do nicho não informadas.") },
    { id: "C07", titulo: "Dados atualizados", fonte: "conta", linhas: c07 },
  ];
}

/** O bloco que o agente de tráfego lê em toda conversa (com teto de tamanho). */
export function blocoDaMemoria(camadas: CamadaMontada[], teto = 6000): string {
  const partes = camadas.map((c) => `${c.id} ${c.titulo.toUpperCase()} (${c.fonte}):\n${c.linhas.map((l) => `- ${l}`).join("\n")}`);
  let saida = `MEMÓRIA DA CONTA (8 camadas; cite a camada, por exemplo C01, em toda decisão; números de C01 são do código e não se recalculam):\n${partes.join("\n\n")}`;
  if (saida.length > teto) saida = saida.slice(0, teto - 40) + "\n[memória cortada no teto]";
  return saida;
}
