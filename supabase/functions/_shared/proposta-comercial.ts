/**
 * Proposta comercial, frente PRO2 (30/09/2026): o que um diretor comercial de
 * agência usa no dia a dia e a primeira versão da Mesa Proposta não tinha.
 * Funções puras, sem import de Deno nem de npm: rodam na função
 * mesa-proposta, na proposta-biblioteca, na tela e nos testes.
 *
 * - Biblioteca de serviços da agência (preço, unidade, horas, entregáveis).
 * - Calculadora de hora técnica ligada aos custos do Financeiro.
 * - Três pacotes (essencial, recomendado, completo) por nível de item.
 * - Condições de pagamento (à vista com desconto, parcelado, mensal).
 * - Cases e depoimentos com autorização (só autorizado entra).
 * - Modelos visuais (tema) e a identidade do cliente na capa.
 * - Cronograma visual (semanas lidas do texto do marco).
 * - Anexos (link de portfólio e PDF no Storage).
 * - Follow-up: proposta vista e sem resposta, com a mensagem pronta.
 * - Comparar versões e "Preencher com IA" (campos por bloco, prévia e aplicar).
 *
 * Regra de ouro que continua: o preço sai só dos itens (código), nunca do
 * modelo de IA; número sem fonte não entra. Sem lookbehind, grupo nomeado,
 * \p{} nem .at(): a tela roda no Safari 11.
 */
import {
  blocoDoTipo,
  comBloco,
  dataCurta,
  diaValido,
  normalizarConteudo,
  normalizarItens,
  reais,
  ROTULO_DO_BLOCO,
  semNumeroInventado,
  textoLimpo,
  TIPOS_DE_BLOCO,
  totaisDosItens,
  type Bloco,
  type ConteudoDaProposta,
  type ItemDaProposta,
  type TipoDeBloco,
  type Totais,
} from "./proposta-modelo.ts";

const centavos = (v: number) => Math.round(v * 100) / 100;
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_OK = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

// ------------------------------------------------------------------ biblioteca de serviços

export const UNIDADES_DO_SERVICO = ["projeto", "mes", "hora", "peca", "pagina", "video", "diaria", "campanha"] as const;
export type UnidadeDoServico = (typeof UNIDADES_DO_SERVICO)[number];
export const ROTULO_DA_UNIDADE: Record<UnidadeDoServico, string> = {
  projeto: "por projeto",
  mes: "por mês",
  hora: "por hora",
  peca: "por peça",
  pagina: "por página",
  video: "por vídeo",
  diaria: "por diária",
  campanha: "por campanha",
};

export type ServicoDaBiblioteca = {
  id: string;
  nome: string;
  categoria: string;
  descricao: string;
  unidade: UnidadeDoServico;
  preco: number;
  recorrencia: "unico" | "mensal";
  /** Horas de trabalho por unidade (a calculadora usa). */
  horas: number | null;
  entregaveis: string[];
  arquivado: boolean;
};

export function normalizarServico(bruto: unknown): ServicoDaBiblioteca | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const nome = textoLimpo(o.nome, 120);
  const preco = numero(o.preco);
  if (!nome || preco === null || preco < 0 || preco > 10_000_000) return null;
  const unidade = (UNIDADES_DO_SERVICO as readonly string[]).indexOf(String(o.unidade)) >= 0 ? (o.unidade as UnidadeDoServico) : "projeto";
  const horas = numero(o.horas);
  return {
    id: typeof o.id === "string" ? o.id : "",
    nome,
    categoria: textoLimpo(o.categoria, 60),
    descricao: textoLimpo(o.descricao, 400),
    unidade,
    preco: centavos(preco),
    recorrencia: o.recorrencia === "mensal" || unidade === "mes" ? "mensal" : "unico",
    horas: horas !== null && horas > 0 && horas <= 10_000 ? centavos(horas) : null,
    entregaveis: (Array.isArray(o.entregaveis) ? o.entregaveis : []).map((x) => textoLimpo(x, 160)).filter(Boolean).slice(0, 12),
    arquivado: !!o.arquivado_em || o.arquivado === true,
  };
}

/** O serviço vira item da proposta com o preço da biblioteca (nada inventado). */
export function itemDoServico(s: ServicoDaBiblioteca, quantidade = 1, id?: string): ItemDaProposta {
  const itens = normalizarItens([
    {
      id: id || `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      nome: s.nome,
      descricao: s.descricao,
      quantidade,
      valor_unitario: s.preco,
      recorrencia: s.recorrencia,
      origem: "servico",
      servico: null,
      plano_id: null,
      horas: s.horas === null ? undefined : s.horas,
      biblioteca_id: UUID.test(s.id) ? s.id : undefined,
    },
  ]);
  return itens[0];
}

// ------------------------------------------------------------------ calculadora de hora técnica

export type ParametrosDaHora = {
  /** Custos fixos do mês (aluguel, ferramentas, salários fora o pró-labore). */
  custos_fixos_mes: number;
  pro_labore_mes: number;
  /** Horas vendáveis no mês (a equipe inteira, descontado o tempo não faturável). */
  horas_produtivas_mes: number;
  /** Impostos sobre a nota, em % (0 a 60). */
  impostos_pct: number;
  /** Margem de lucro desejada, em % (0 a 80). */
  margem_pct: number;
};

export const PARAMETROS_INICIAIS: ParametrosDaHora = { custos_fixos_mes: 0, pro_labore_mes: 0, horas_produtivas_mes: 120, impostos_pct: 6, margem_pct: 25 };

export function normalizarParametros(bruto: unknown): ParametrosDaHora {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const n = (k: keyof ParametrosDaHora, min: number, max: number) => {
    const v = numero(o[k]);
    return v === null ? PARAMETROS_INICIAIS[k] : centavos(entre(v, min, max));
  };
  return {
    custos_fixos_mes: n("custos_fixos_mes", 0, 10_000_000),
    pro_labore_mes: n("pro_labore_mes", 0, 10_000_000),
    horas_produtivas_mes: Math.max(1, n("horas_produtivas_mes", 1, 20_000)),
    impostos_pct: n("impostos_pct", 0, 60),
    margem_pct: n("margem_pct", 0, 80),
  };
}

/** Regra recorrente do Financeiro (financial_recurring_rules), no mínimo que a calculadora lê. */
export type RegraDoFinanceiro = { direction?: unknown; direcao?: unknown; kind?: unknown; amount?: unknown; frequency?: unknown; is_active?: unknown; isActive?: unknown; ends_on?: unknown; endsOn?: unknown };

const MESES_DA_FREQUENCIA: Record<string, number> = { monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12 };

/**
 * Custos do mês pelo Financeiro: regras de saída ativas, cada uma no valor
 * mensal (anual / 12...). Pró-labore em separado; o resto vira custo fixo.
 */
export function custosDoFinanceiro(regras: RegraDoFinanceiro[], hoje: string): { custos_fixos_mes: number; pro_labore_mes: number; regras: number } {
  let fixos = 0;
  let pro = 0;
  let contadas = 0;
  for (const r of regras || []) {
    const direcao = String(r.direction ?? r.direcao ?? "");
    if (direcao !== "expense") continue;
    const ativa = r.is_active ?? r.isActive;
    if (ativa === false) continue;
    const fim = diaValido(String(r.ends_on ?? r.endsOn ?? ""));
    if (fim && fim < hoje) continue;
    const valor = numero(r.amount);
    if (valor === null || valor <= 0) continue;
    const meses = MESES_DA_FREQUENCIA[String(r.frequency || "monthly")] || 1;
    const mensal = valor / meses;
    if (String(r.kind || "") === "pro_labore") pro += mensal;
    else fixos += mensal;
    contadas += 1;
  }
  return { custos_fixos_mes: centavos(fixos), pro_labore_mes: centavos(pro), regras: contadas };
}

/**
 * Parâmetros com o Financeiro por cima: custo fixo do Financeiro quando há
 * regra ativa; pró-labore do Financeiro só quando ele tem regra de pró-labore
 * (senão fica o digitado).
 */
export function parametrosComFinanceiro(p: ParametrosDaHora, f: { custos_fixos_mes: number; pro_labore_mes: number; regras: number } | null): ParametrosDaHora {
  if (!f || f.regras <= 0) return p;
  return { ...p, custos_fixos_mes: f.custos_fixos_mes, pro_labore_mes: f.pro_labore_mes > 0 ? f.pro_labore_mes : p.pro_labore_mes };
}

/** Quanto custa uma hora de trabalho da agência. */
export function custoDaHora(p: ParametrosDaHora): number {
  return centavos((p.custos_fixos_mes + p.pro_labore_mes) / Math.max(1, p.horas_produtivas_mes));
}

/** Divisor do preço: o que sobra depois de imposto e margem (nunca menos de 5%). */
function divisor(impostosPct: number, margemPct: number): number {
  return Math.max(0.05, 1 - impostosPct / 100 - margemPct / 100);
}

/** Preço de venda da hora (custo / (1 - impostos - margem)). */
export function precoDaHora(p: ParametrosDaHora, margemPct = p.margem_pct): number {
  return centavos(custoDaHora(p) / divisor(p.impostos_pct, margemPct));
}

/** Arredonda preço sugerido para cima, de 10 em 10 reais. */
export function arredondarPreco(v: number): number {
  return v <= 0 ? 0 : Math.ceil(v / 10) * 10;
}

/** Preço sugerido para um trabalho de `horas` horas. */
export function precoPorHoras(horas: number, p: ParametrosDaHora, margemPct = p.margem_pct): number {
  return arredondarPreco(horas * precoDaHora(p, margemPct));
}

/** Margem real de um item (valor por unidade e horas por unidade), em %; null sem horas ou sem custo. */
export function margemDoItem(valorUnitario: number, horas: number | undefined | null, p: ParametrosDaHora): number | null {
  if (!horas || valorUnitario <= 0) return null;
  const custo = custoDaHora(p) * horas;
  if (custo <= 0) return null;
  return Math.round((1 - p.impostos_pct / 100 - custo / valorUnitario) * 1000) / 10;
}

/** Margem da proposta inteira (só os itens com horas contam). */
export function margemDosItens(itens: ItemDaProposta[], p: ParametrosDaHora): { margem_pct: number | null; itens_com_horas: number; itens_sem_horas: number } {
  let receita = 0;
  let custo = 0;
  let com = 0;
  let sem = 0;
  for (const it of itens) {
    if (!it.horas) {
      sem += 1;
      continue;
    }
    com += 1;
    receita += it.valor_unitario * it.quantidade;
    custo += custoDaHora(p) * it.horas * it.quantidade;
  }
  if (!com || receita <= 0 || custo <= 0) return { margem_pct: null, itens_com_horas: com, itens_sem_horas: sem };
  return { margem_pct: Math.round((1 - p.impostos_pct / 100 - custo / receita) * 1000) / 10, itens_com_horas: com, itens_sem_horas: sem };
}

/**
 * Ajusta o preço dos itens com horas para chegar na margem pedida. Item sem
 * horas fica como está (e volta em `sem_horas`). O valor sai da conta, não
 * de palpite.
 */
export function ajustarPelaMargem(itens: ItemDaProposta[], p: ParametrosDaHora, margemPct: number): { itens: ItemDaProposta[]; mudados: Array<{ id: string; nome: string; antes: number; depois: number }>; sem_horas: string[] } {
  const alvo = entre(margemPct, 0, 80);
  const mudados: Array<{ id: string; nome: string; antes: number; depois: number }> = [];
  const semHoras: string[] = [];
  if (custoDaHora(p) <= 0) return { itens, mudados, sem_horas: itens.map((i) => i.nome) };
  const novos = itens.map((it) => {
    if (!it.horas) {
      semHoras.push(it.nome);
      return it;
    }
    const depois = precoPorHoras(it.horas, p, alvo);
    if (depois !== it.valor_unitario) mudados.push({ id: it.id, nome: it.nome, antes: it.valor_unitario, depois });
    return { ...it, valor_unitario: depois };
  });
  return { itens: normalizarItens(novos), mudados, sem_horas: semHoras };
}

/** "30%", "margem de 35", "0,4" -> 30, 35, 40 (null se não der para ler). */
export function lerMargem(v: unknown): number | null {
  const m = /(\d+([.,]\d+)?)/.exec(String(v == null ? "" : v));
  if (!m) return null;
  let n = Number(m[1].replace(",", "."));
  if (n > 0 && n < 1 && String(v).indexOf("%") < 0) n = n * 100;
  return Number.isFinite(n) && n >= 0 && n <= 80 ? Math.round(n * 10) / 10 : null;
}

// ------------------------------------------------------------------ pacotes

export const NIVEIS_DO_PACOTE = ["essencial", "recomendado", "completo"] as const;
export type NivelDoPacote = (typeof NIVEIS_DO_PACOTE)[number];
export const ROTULO_DO_NIVEL: Record<NivelDoPacote, string> = { essencial: "Essencial", recomendado: "Recomendado", completo: "Completo" };
const ORDEM_DO_NIVEL: Record<NivelDoPacote, number> = { essencial: 1, recomendado: 2, completo: 3 };
export const ehNivel = (v: unknown): v is NivelDoPacote => typeof v === "string" && (NIVEIS_DO_PACOTE as readonly string[]).indexOf(v) >= 0;

/**
 * Três pacotes cumulativos: cada item tem o nível a partir do qual entra
 * (essencial entra nos três; completo só no completo). O banco guarda só
 * isso; os preços saem dos itens.
 */
export type Pacotes = {
  ativo: boolean;
  destaque: NivelDoPacote;
  /** Nível de cada item (id do item -> nível). Item sem nível entra no essencial. */
  niveis: Record<string, NivelDoPacote>;
  nomes: Record<NivelDoPacote, string>;
  descricoes: Record<NivelDoPacote, string>;
};

export const PACOTES_VAZIOS: Pacotes = {
  ativo: false,
  destaque: "recomendado",
  niveis: {},
  nomes: { essencial: "Essencial", recomendado: "Recomendado", completo: "Completo" },
  descricoes: { essencial: "", recomendado: "", completo: "" },
};

export function normalizarPacotes(bruto: unknown, itens?: ItemDaProposta[]): Pacotes {
  const o = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const niveisBrutos = (o.niveis && typeof o.niveis === "object" ? o.niveis : {}) as Record<string, unknown>;
  const ids = itens ? itens.map((i) => i.id) : Object.keys(niveisBrutos);
  const niveis: Record<string, NivelDoPacote> = {};
  for (const id of ids) niveis[id] = ehNivel(niveisBrutos[id]) ? (niveisBrutos[id] as NivelDoPacote) : "essencial";
  const nomes = (o.nomes && typeof o.nomes === "object" ? o.nomes : {}) as Record<string, unknown>;
  const descricoes = (o.descricoes && typeof o.descricoes === "object" ? o.descricoes : {}) as Record<string, unknown>;
  return {
    ativo: o.ativo === true,
    destaque: ehNivel(o.destaque) ? o.destaque : "recomendado",
    niveis,
    nomes: { essencial: textoLimpo(nomes.essencial, 40) || "Essencial", recomendado: textoLimpo(nomes.recomendado, 40) || "Recomendado", completo: textoLimpo(nomes.completo, 40) || "Completo" },
    descricoes: { essencial: textoLimpo(descricoes.essencial, 240), recomendado: textoLimpo(descricoes.recomendado, 240), completo: textoLimpo(descricoes.completo, 240) },
  };
}

/** Itens de um pacote (cumulativo). */
export function itensDoPacote(itens: ItemDaProposta[], pacotes: Pacotes, nivel: NivelDoPacote): ItemDaProposta[] {
  return itens.filter((i) => ORDEM_DO_NIVEL[pacotes.niveis[i.id] || "essencial"] <= ORDEM_DO_NIVEL[nivel]);
}

export type ResumoDoPacote = { nivel: NivelDoPacote; nome: string; descricao: string; destaque: boolean; itens: ItemDaProposta[]; totais: Totais };

/** Os três pacotes prontos para mostrar (vazio quando os pacotes estão desligados). */
export function resumoDosPacotes(itens: ItemDaProposta[], bruto: unknown): ResumoDoPacote[] {
  const p = normalizarPacotes(bruto, itens);
  if (!p.ativo || !itens.length) return [];
  return NIVEIS_DO_PACOTE.map((nivel) => {
    const lista = itensDoPacote(itens, p, nivel);
    return { nivel, nome: p.nomes[nivel], descricao: p.descricoes[nivel], destaque: p.destaque === nivel, itens: lista, totais: totaisDosItens(lista) };
  });
}

/** Linhas do comparativo: cada item e em quais pacotes ele entra. */
export function comparativoDosPacotes(itens: ItemDaProposta[], bruto: unknown): Array<{ id: string; nome: string; em: Record<NivelDoPacote, boolean> }> {
  const p = normalizarPacotes(bruto, itens);
  return itens.map((i) => {
    const n = ORDEM_DO_NIVEL[p.niveis[i.id] || "essencial"];
    return { id: i.id, nome: i.quantidade > 1 ? `${i.quantidade} x ${i.nome}` : i.nome, em: { essencial: n <= 1, recomendado: n <= 2, completo: n <= 3 } };
  });
}

/** Pacotes ligados que não diferenciam (dois pacotes com os mesmos itens): aviso. */
export function avisosDosPacotes(itens: ItemDaProposta[], bruto: unknown): string[] {
  const r = resumoDosPacotes(itens, bruto);
  if (!r.length) return [];
  const avisos: string[] = [];
  if (r[0].itens.length === 0) avisos.push("O Essencial está sem item.");
  if (r[0].itens.length === r[1].itens.length) avisos.push("Essencial e Recomendado têm os mesmos itens.");
  if (r[1].itens.length === r[2].itens.length) avisos.push("Recomendado e Completo têm os mesmos itens.");
  return avisos;
}

/** O que o hash e o link levam dos pacotes (desligado: nada). */
export function pacotesParaGravar(bruto: unknown, itens: ItemDaProposta[]): Pacotes | Record<string, never> {
  const p = normalizarPacotes(bruto, itens);
  return p.ativo ? p : {};
}

/**
 * Montar os pacotes com o Jev (Choice por serviço, em lote sobre o mesmo
 * estado): para cada candidato, em qual pacote ele entra para ESTE cliente,
 * ou fora. O código monta os pacotes e o preço vem da biblioteca.
 */
export type CandidatoAoPacote = { id: string; nome: string; descricao: string; preco: number; recorrencia: "unico" | "mensal"; unidade?: string };

export function perguntasDosPacotes(candidatos: CandidatoAoPacote[], contexto: { cliente: string; objetivo: string; material: string; orientacao?: string }) {
  const questions: Record<string, { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }> = {};
  candidatos.slice(0, 40).forEach((c, i) => {
    questions[`s${i}`] = {
      type: "choice",
      instructions: [
        `Uma agência de marketing monta três pacotes cumulativos para o cliente \`cliente\` (Essencial < Recomendado < Completo), a partir do que o cliente disse em \`material\` e do objetivo em \`objetivo\`${contexto.orientacao ? ` e da orientação da equipe em \`orientacao\`` : ""}.`,
        `Decida a partir de qual pacote o serviço \`servicos[${i}]\` deve entrar para este cliente.`,
      ],
      criteria: {
        essencial: "Resolve o problema central que o cliente descreveu; sem ele a proposta não entrega o que foi pedido.",
        recomendado: "Não é o mínimo, mas acelera o resultado que o cliente quer e combina com o que ele contou.",
        completo: "Amplia o escopo; faz sentido para quem quer ir além, mas o cliente não pediu nem precisa agora.",
        fora: "Não tem relação com o que o cliente precisa; não deve entrar em nenhum pacote.",
      },
    };
  });
  return {
    state: {
      cliente: contexto.cliente,
      objetivo: contexto.objetivo.slice(0, 1500),
      material: contexto.material.slice(0, 6000),
      ...(contexto.orientacao ? { orientacao: contexto.orientacao.slice(0, 400) } : {}),
      servicos: candidatos.slice(0, 40).map((c) => ({ nome: c.nome, descricao: c.descricao, preco: reais(c.preco), cobranca: c.recorrencia === "mensal" ? "mensal" : "única" })),
    },
    questions,
  };
}

/**
 * Lê as respostas do Jev: nível de cada candidato (fora sai). Resposta que
 * falta ou tem confiança baixa segue a opção mais provável, e a tela mostra a
 * confiança como aviso (sem laço de correção).
 */
export function lerPacotesDoJev(candidatos: CandidatoAoPacote[], answers: Record<string, { choice?: string; confidence?: number }> | null): { escolhas: Array<{ candidato: CandidatoAoPacote; nivel: NivelDoPacote | "fora"; confianca: number | null }>; sem_resposta: number } {
  let semResposta = 0;
  const escolhas = candidatos.slice(0, 40).map((c, i) => {
    const r = answers ? answers[`s${i}`] : undefined;
    const escolha = r && (ehNivel(r.choice) || r.choice === "fora") ? (r.choice as NivelDoPacote | "fora") : null;
    if (!escolha) semResposta += 1;
    return { candidato: c, nivel: escolha || "fora", confianca: r && typeof r.confidence === "number" ? r.confidence : null };
  });
  return { escolhas, sem_resposta: semResposta };
}

/**
 * Pacotes a partir das escolhas: os itens atuais continuam (com o nível
 * escolhido quando vieram da biblioteca) e os serviços que entraram viram
 * itens com o preço da biblioteca. Garante que cada pacote acrescenta algo.
 */
export function pacotesDasEscolhas(
  itensAtuais: ItemDaProposta[],
  escolhas: Array<{ candidato: CandidatoAoPacote; nivel: NivelDoPacote | "fora" }>,
  pacotesAtuais: unknown,
): { itens: ItemDaProposta[]; pacotes: Pacotes; entraram: string[]; ficaram_de_fora: string[] } {
  const atual = normalizarPacotes(pacotesAtuais, itensAtuais);
  const itens = itensAtuais.slice();
  const niveis: Record<string, NivelDoPacote> = { ...atual.niveis };
  const entraram: string[] = [];
  const fora: string[] = [];
  for (const e of escolhas) {
    const jaTem = itens.find((i) => i.id === e.candidato.id || (i.biblioteca_id && i.biblioteca_id === e.candidato.id));
    if (e.nivel === "fora") {
      fora.push(e.candidato.nome);
      continue;
    }
    if (jaTem) {
      niveis[jaTem.id] = e.nivel;
      continue;
    }
    const novo = normalizarItens([{ id: `p${itens.length + 1}${e.candidato.id.slice(0, 6)}`, nome: e.candidato.nome, descricao: e.candidato.descricao, quantidade: 1, valor_unitario: e.candidato.preco, recorrencia: e.candidato.recorrencia, origem: "servico", biblioteca_id: UUID.test(e.candidato.id) ? e.candidato.id : undefined }])[0];
    if (!novo) continue;
    itens.push(novo);
    niveis[novo.id] = e.nivel;
    entraram.push(novo.nome);
  }
  const pacotes = normalizarPacotes({ ...atual, ativo: true, niveis }, normalizarItens(itens));
  return { itens: normalizarItens(itens), pacotes, entraram, ficaram_de_fora: fora };
}

// ------------------------------------------------------------------ pagamento

export const TIPOS_DE_PAGAMENTO = ["a_vista", "parcelado", "mensal"] as const;
export type TipoDePagamento = (typeof TIPOS_DE_PAGAMENTO)[number];
export type OpcaoDePagamento = { id: string; tipo: TipoDePagamento; desconto_pct: number; parcelas: number; entrada_pct: number; observacao: string };
export type Pagamento = { opcoes: OpcaoDePagamento[] };

export const PAGAMENTO_SUGERIDO: Pagamento = {
  opcoes: [
    { id: "a_vista", tipo: "a_vista", desconto_pct: 5, parcelas: 1, entrada_pct: 100, observacao: "PIX ou boleto na aprovação." },
    { id: "parcelado", tipo: "parcelado", desconto_pct: 0, parcelas: 3, entrada_pct: 0, observacao: "Boleto ou PIX, a primeira na aprovação." },
  ],
};

export function normalizarPagamento(bruto: unknown): Pagamento {
  const o = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const vistos = new Set<string>();
  const opcoes = (Array.isArray(o.opcoes) ? o.opcoes : [])
    .map((x, i): OpcaoDePagamento | null => {
      const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const tipo = (TIPOS_DE_PAGAMENTO as readonly string[]).indexOf(String(r.tipo)) >= 0 ? (r.tipo as TipoDePagamento) : null;
      if (!tipo) return null;
      let id = textoLimpo(r.id, 30) || `${tipo}${i}`;
      while (vistos.has(id)) id = `${id}-${i}`;
      vistos.add(id);
      const desconto = numero(r.desconto_pct);
      const parcelas = numero(r.parcelas);
      const entrada = numero(r.entrada_pct);
      return {
        id,
        tipo,
        desconto_pct: desconto === null ? 0 : centavos(entre(desconto, 0, 50)),
        parcelas: tipo === "parcelado" ? Math.round(entre(parcelas === null ? 3 : parcelas, 2, 24)) : 1,
        entrada_pct: tipo === "parcelado" ? centavos(entre(entrada === null ? 0 : entrada, 0, 90)) : tipo === "a_vista" ? 100 : 0,
        observacao: textoLimpo(r.observacao, 200),
      };
    })
    .filter((x): x is OpcaoDePagamento => !!x)
    .slice(0, 4);
  return { opcoes };
}

/** O que a opção cobra do total (desconto só no único; o mensal segue mensal). */
export function valorDaOpcao(op: OpcaoDePagamento, t: Totais): { total_unico: number; entrada: number; parcela: number; parcelas: number; mensal: number } {
  const unico = centavos(t.unico * (1 - op.desconto_pct / 100));
  if (op.tipo === "parcelado") {
    const entrada = centavos(unico * (op.entrada_pct / 100));
    const resto = unico - entrada;
    const parcelas = entrada > 0 ? op.parcelas - 1 : op.parcelas;
    return { total_unico: unico, entrada, parcela: parcelas > 0 ? centavos(resto / parcelas) : 0, parcelas: Math.max(0, parcelas), mensal: t.mensal };
  }
  if (op.tipo === "mensal") return { total_unico: unico, entrada: 0, parcela: 0, parcelas: 0, mensal: t.mensal };
  return { total_unico: unico, entrada: unico, parcela: 0, parcelas: 0, mensal: t.mensal };
}

/** Frase da opção: "À vista com 5% de desconto: R$ 4.275,00". */
export function textoDaOpcao(op: OpcaoDePagamento, t: Totais): string {
  const v = valorDaOpcao(op, t);
  const mensal = t.mensal > 0 ? ` + ${reais(t.mensal)} por mês` : "";
  if (op.tipo === "a_vista") return `À vista${op.desconto_pct > 0 ? ` com ${op.desconto_pct}% de desconto` : ""}: ${reais(v.total_unico)}${mensal}`;
  if (op.tipo === "parcelado") {
    const entrada = v.entrada > 0 ? `entrada de ${reais(v.entrada)} + ` : "";
    return `Parcelado: ${entrada}${v.parcelas}x de ${reais(v.parcela)}${op.desconto_pct > 0 ? ` (${op.desconto_pct}% de desconto)` : ""}${mensal}`;
  }
  return t.mensal > 0 ? `Mensal: ${reais(t.mensal)} por mês${t.unico > 0 ? `, com ${reais(v.total_unico)} na implantação` : ""}` : `Mensal: ${reais(v.total_unico)}`;
}

export const ROTULO_DO_PAGAMENTO: Record<TipoDePagamento, string> = { a_vista: "À vista", parcelado: "Parcelado", mensal: "Mensal" };

// ------------------------------------------------------------------ provas (cases e depoimentos)

export type ProvaDaAgencia = {
  id: string;
  tipo: "case" | "depoimento";
  titulo: string;
  texto: string;
  nome: string;
  cargo: string;
  empresa: string;
  link: string;
  nicho: string;
  autorizado: boolean;
  autorizacao: string;
  autorizado_em: string | null;
  arquivado: boolean;
};

export function normalizarProva(bruto: unknown): ProvaDaAgencia | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const tipo = o.tipo === "depoimento" ? "depoimento" : o.tipo === "case" ? "case" : null;
  if (!tipo) return null;
  const titulo = textoLimpo(o.titulo, 120);
  const texto = textoLimpo(o.texto, 800);
  const nome = textoLimpo(o.nome, 80);
  if (tipo === "case" && !titulo) return null;
  if (tipo === "depoimento" && (!nome || !texto)) return null;
  const link = textoLimpo(o.link, 600);
  return {
    id: typeof o.id === "string" ? o.id : "",
    tipo,
    titulo,
    texto,
    nome,
    cargo: textoLimpo(o.cargo, 80),
    empresa: textoLimpo(o.empresa, 120),
    link: URL_OK.test(link) ? link : "",
    nicho: textoLimpo(o.nicho, 60),
    autorizado: o.autorizado === true,
    autorizacao: textoLimpo(o.autorizacao, 300),
    autorizado_em: diaValido(o.autorizado_em),
    arquivado: !!o.arquivado_em || o.arquivado === true,
  };
}

/** Só entra na proposta o que tem autorização registrada (quem autorizou e como). */
export function provaPodeEntrar(p: ProvaDaAgencia | null): boolean {
  return !!p && p.autorizado && p.autorizacao.length >= 3 && !p.arquivado;
}

/** Bloco de provas a partir das escolhidas (as sem autorização ficam de fora e voltam contadas). */
export function blocoDasProvas(provas: Array<ProvaDaAgencia | null>): { dados: { cases: Array<{ titulo: string; texto: string; link: string }>; depoimentos: Array<{ nome: string; texto: string }> }; sem_autorizacao: number } {
  const cases: Array<{ titulo: string; texto: string; link: string }> = [];
  const depoimentos: Array<{ nome: string; texto: string }> = [];
  let sem = 0;
  for (const p of provas) {
    if (!p) continue;
    if (!provaPodeEntrar(p)) {
      sem += 1;
      continue;
    }
    if (p.tipo === "case" && cases.length < 4) cases.push({ titulo: p.titulo, texto: p.texto, link: p.link });
    if (p.tipo === "depoimento" && depoimentos.length < 4) depoimentos.push({ nome: [p.nome, [p.cargo, p.empresa].filter(Boolean).join(", ")].filter(Boolean).join(", "), texto: p.texto });
  }
  return { dados: { cases, depoimentos }, sem_autorizacao: sem };
}

// ------------------------------------------------------------------ visual (modelos e identidade do cliente)

export const TEMAS_DA_PROPOSTA = [
  { id: "aceleriq", nome: "Aceleriq", descricao: "Escuro e claro alternados, verde da agência" },
  { id: "claro", nome: "Claro", descricao: "Tudo claro, leve para ler no celular" },
  { id: "editorial", nome: "Editorial", descricao: "Serifa nos títulos, papel creme" },
  { id: "cliente", nome: "Cores do cliente", descricao: "Capa e destaques na cor da marca do cliente" },
] as const;
export type TemaDaProposta = (typeof TEMAS_DA_PROPOSTA)[number]["id"];
export type VisualDaProposta = { tema: TemaDaProposta; cores: string[] };

const HEX = /^#[0-9a-f]{6}$/i;

export function normalizarVisual(bruto: unknown): VisualDaProposta {
  const o = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const tema = TEMAS_DA_PROPOSTA.some((t) => t.id === o.tema) ? (o.tema as TemaDaProposta) : "aceleriq";
  const cores = (Array.isArray(o.cores) ? o.cores : [])
    .map((c) => {
      const s = String(c && typeof c === "object" ? (c as Record<string, unknown>).hex : c).trim();
      if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s.charAt(1)}${s.charAt(1)}${s.charAt(2)}${s.charAt(2)}${s.charAt(3)}${s.charAt(3)}`.toLowerCase();
      return HEX.test(s) ? s.toLowerCase() : "";
    })
    .filter(Boolean)
    .slice(0, 3);
  return { tema: tema === "cliente" && !cores.length ? "aceleriq" : tema, cores };
}

/** Texto preto ou branco sobre a cor (contraste pela luminância). */
export function corDoTextoSobre(hex: string): "#ffffff" | "#0b0d0c" {
  if (!HEX.test(hex)) return "#ffffff";
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const l = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  return l > 0.45 ? "#0b0d0c" : "#ffffff";
}

// ------------------------------------------------------------------ link do cliente

/**
 * O que o cliente vê e aceita (frente UXS, 30/09). Numa proposta já enviada,
 * gravar qualquer um destes campos volta para rascunho e tira o link (o aceite
 * vale só para o texto enviado). O gravar da mesa-proposta e a tela usam a
 * mesma lista: notas, transcrição, materiais, resumo e lead não tiram o link.
 */
export const CAMPOS_QUE_TIRAM_O_LINK = ["titulo", "conteudo", "itens", "validade_ate", "pacotes", "pagamento", "anexos", "visual"] as const;

/** Gravar estes campos tira o link atual do cliente? Espelha o servidor: fora de rascunho e de aceita (enviada, vista, recusada). */
export function tiraOLink(status: string, campos: string[]): boolean {
  if (status === "rascunho" || status === "aceita") return false;
  return campos.some((c) => (CAMPOS_QUE_TIRAM_O_LINK as readonly string[]).indexOf(c) >= 0);
}

// ------------------------------------------------------------------ anexos

export type AnexoDaProposta = { id: string; tipo: "link" | "arquivo"; titulo: string; url: string; caminho: string };

/** Anexos em forma segura: link http(s) ou arquivo do Storage na pasta da proposta. */
export function normalizarAnexos(bruto: unknown, clientId?: string): AnexoDaProposta[] {
  const vistos = new Set<string>();
  return (Array.isArray(bruto) ? bruto : [])
    .map((x, i): AnexoDaProposta | null => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const titulo = textoLimpo(o.titulo, 120);
      if (o.tipo === "link") {
        const url = textoLimpo(o.url, 600);
        return URL_OK.test(url) ? { id: textoLimpo(o.id, 40) || `a${i + 1}`, tipo: "link", titulo: titulo || url.replace(/^https?:\/\//i, "").slice(0, 60), url, caminho: "" } : null;
      }
      if (o.tipo === "arquivo") {
        const caminho = textoLimpo(o.caminho, 400);
        if (!caminho || caminho.indexOf("..") >= 0) return null;
        if (clientId && caminho.indexOf(`${clientId}/propostas/`) !== 0) return null;
        return { id: textoLimpo(o.id, 40) || `a${i + 1}`, tipo: "arquivo", titulo: titulo || caminho.split("/").pop() || "Arquivo", url: "", caminho };
      }
      return null;
    })
    .filter((a): a is AnexoDaProposta => {
      if (!a || vistos.has(a.id)) return false;
      vistos.add(a.id);
      return true;
    })
    .slice(0, 8);
}

/** Nome de arquivo seguro para o Storage (sem acento, espaço nem barra). */
export function nomeSeguroDeArquivo(nome: string): string {
  const base = String(nome || "arquivo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return (base || "arquivo").slice(0, 80);
}

// ------------------------------------------------------------------ cronograma visual

/** "semana 1", "semanas 2 a 4", "semana 3-5", "sem 2" -> { inicio, fim } (null se não der). */
export function semanasDoMarco(quando: string): { inicio: number; fim: number } | null {
  const s = String(quando || "").toLowerCase();
  if (!/sem/.test(s)) return null;
  const m = /(\d{1,2})\s*(?:a|at[eé]|-|e)\s*(\d{1,2})/.exec(s) || /(\d{1,2})/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (!a || !b || a > 52 || b > 52) return null;
  return { inicio: Math.min(a, b), fim: Math.max(a, b) };
}

/** Barras do cronograma: posição e largura em % da linha do tempo. */
export function barrasDoCronograma(marcos: Array<{ titulo: string; quando: string }>): { total_semanas: number; barras: Array<{ titulo: string; quando: string; inicio: number; fim: number; esquerda: number; largura: number } | { titulo: string; quando: string; inicio: null; fim: null; esquerda: null; largura: null }> } {
  const lidos = marcos.map((m) => ({ m, s: semanasDoMarco(m.quando) }));
  const total = lidos.reduce((t, x) => (x.s ? Math.max(t, x.s.fim) : t), 0);
  return {
    total_semanas: total,
    barras: lidos.map(({ m, s }) =>
      s && total
        ? { titulo: m.titulo, quando: m.quando, inicio: s.inicio, fim: s.fim, esquerda: Math.round(((s.inicio - 1) / total) * 1000) / 10, largura: Math.round(((s.fim - s.inicio + 1) / total) * 1000) / 10 }
        : { titulo: m.titulo, quando: m.quando, inicio: null, fim: null, esquerda: null, largura: null },
    ),
  };
}

// ------------------------------------------------------------------ follow-up

export type SituacaoDoFollowup = "nao_abriu" | "viu_sem_resposta" | "vence_logo";
export type Followup = { situacao: SituacaoDoFollowup; dias: number; texto: string };

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400_000);

/**
 * Lembrete da proposta: enviada e não aberta há 2 dias, vista e sem resposta
 * há 2 dias, ou vencendo em até 2 dias. Depois de um follow-up registrado,
 * espera 3 dias para lembrar de novo. Aceita, recusada, expirada e rascunho:
 * nada.
 */
export function followupDaProposta(
  p: { status: string; enviada_em: string | null; vista_em: string | null; validade_ate: string | null; ultimo_followup_em?: string | null },
  hoje: string,
): Followup | null {
  if (p.status !== "enviada" && p.status !== "vista") return null;
  if (p.validade_ate && p.validade_ate < hoje) return null;
  const ultimo = p.ultimo_followup_em ? p.ultimo_followup_em.slice(0, 10) : null;
  if (ultimo && diasEntre(ultimo, hoje) < 3) return null;
  const faltam = p.validade_ate ? diasEntre(hoje, p.validade_ate) : null;
  if (faltam !== null && faltam <= 2) return { situacao: "vence_logo", dias: faltam, texto: faltam <= 0 ? "Vence hoje" : `Vence em ${faltam} dia${faltam === 1 ? "" : "s"}` };
  if (p.vista_em) {
    const d = diasEntre(p.vista_em.slice(0, 10), hoje);
    if (d >= 2) return { situacao: "viu_sem_resposta", dias: d, texto: `Vista há ${d} dias, sem resposta` };
    return null;
  }
  if (p.enviada_em) {
    const d = diasEntre(p.enviada_em.slice(0, 10), hoje);
    if (d >= 2) return { situacao: "nao_abriu", dias: d, texto: `Enviada há ${d} dias e ainda não aberta` };
  }
  return null;
}

/** Mensagem pronta do follow-up (curta, sem pressão, sem travessão). */
export function mensagemDoFollowup(p: { contato: string; titulo: string; link: string; validade: string | null; situacao: SituacaoDoFollowup }): string {
  const primeiro = textoLimpo(p.contato, 80).split(" ")[0] || "";
  const oi = primeiro ? `Oi, ${primeiro}. Tudo bem?` : "Oi. Tudo bem?";
  const titulo = textoLimpo(p.titulo, 120);
  const validade = p.validade ? dataCurta(p.validade) : "";
  if (p.situacao === "nao_abriu") return `${oi} Mandei a proposta de ${titulo} e queria saber se chegou certinho: ${p.link} Se preferir, te explico em 10 minutos por aqui ou numa ligação.`;
  if (p.situacao === "vence_logo") return `${oi} A proposta de ${titulo} vale até ${validade}. Quer que eu tire alguma dúvida antes? O link é este: ${p.link}`;
  return `${oi} Vi que você abriu a proposta de ${titulo}. Ficou alguma dúvida sobre escopo, prazo ou investimento? Se fizer sentido, ajusto com você. ${p.link}`;
}

// ------------------------------------------------------------------ comparar versões e preencher com IA

/** Campo que a IA pode preencher (mesmo formato de CampoParaPreencher, da peça PreencherComIA). */
export type CampoDoBloco = { chave: string; rotulo: string; tipo: "texto" | "texto_longo" | "lista"; valorAtual?: unknown; dica?: string; maximo?: number };

const PARES = "Um por item, no formato Título | texto";
const SEM_NUMERO = "Nunca invente número, prazo ou resultado";

/**
 * Campos de cada bloco para o "Preencher com IA". Mercado (só com fonte, pela
 * pesquisa), provas e quem somos (dados da agência) e o valor (itens) ficam de fora.
 */
export function camposDoBloco(b: Bloco): CampoDoBloco[] {
  const d = b.dados as Record<string, any>;
  const pares = (lista: Array<Record<string, string>>, a: string, c: string) => (lista || []).map((x) => (x[c] ? `${x[a]} | ${x[c]}` : x[a]));
  switch (b.tipo) {
    case "ja_tem":
      // PRO3: só o texto de abertura; serviços, plano e resultados vêm do painel. Proposta sem retrato (cliente novo): nada.
      if (!(d.servicos || []).length && !d.plano && !(d.resultados || []).length) return [];
      return [{ chave: "ja_tem.texto", rotulo: "Abertura", tipo: "texto_longo", valorAtual: d.texto, dica: `Duas frases sobre o caminho feito com o cliente até aqui. Número só dos resultados listados no bloco. ${SEM_NUMERO}`, maximo: 900 }];
    case "capa":
      return [
        { chave: "capa.headline", rotulo: "Headline", tipo: "texto", valorAtual: d.headline, dica: `Benefício para o cliente, até 12 palavras. ${SEM_NUMERO}`, maximo: 160 },
        { chave: "capa.subtitulo", rotulo: "Subtítulo", tipo: "texto", valorAtual: d.subtitulo, dica: "Uma linha", maximo: 240 },
        { chave: "capa.projeto", rotulo: "Projeto", tipo: "texto", valorAtual: d.projeto, dica: "Nome curto do projeto", maximo: 120 },
      ];
    case "desafio":
      return [
        { chave: "desafio.texto", rotulo: "Desafio", tipo: "texto_longo", valorAtual: d.texto, dica: `O desafio nas palavras do cliente. ${SEM_NUMERO}`, maximo: 1600 },
        { chave: "desafio.palavras_do_cliente", rotulo: "Palavras do cliente", tipo: "lista", valorAtual: d.palavras_do_cliente, dica: "Até 3 falas copiadas do material, nunca inventadas", maximo: 3 },
        { chave: "desafio.compromisso", rotulo: "Compromisso", tipo: "texto", valorAtual: d.compromisso, dica: "Uma frase", maximo: 400 },
      ];
    case "diagnostico":
      return [{ chave: "diagnostico.achados", rotulo: "Achados", tipo: "lista", valorAtual: pares(d.achados, "titulo", "texto"), dica: `${PARES}. ${SEM_NUMERO}`, maximo: 4 }];
    case "solucao":
      return [
        { chave: "solucao.texto", rotulo: "Solução", tipo: "texto_longo", valorAtual: d.texto, dica: SEM_NUMERO, maximo: 1000 },
        { chave: "solucao.frentes", rotulo: "Frentes", tipo: "lista", valorAtual: pares(d.frentes, "titulo", "texto"), dica: PARES, maximo: 4 },
      ];
    case "entregaveis":
      return [
        { chave: "entregaveis.itens", rotulo: "O que recebe", tipo: "lista", valorAtual: pares(d.itens, "nome", "detalhe"), dica: `${PARES}. Quantidade só se estiver nos itens`, maximo: 16 },
        { chave: "entregaveis.nao_inclui", rotulo: "Não inclui", tipo: "lista", valorAtual: d.nao_inclui, maximo: 8 },
      ];
    case "processo":
      return [{ chave: "processo.etapas", rotulo: "Etapas", tipo: "lista", valorAtual: pares(d.etapas, "titulo", "texto"), dica: `${PARES}, na ordem`, maximo: 8 }];
    case "cronograma":
      return [
        { chave: "cronograma.marcos", rotulo: "Marcos", tipo: "lista", valorAtual: (d.marcos || []).map((m: { quando: string; titulo: string }) => (m.quando ? `${m.quando} | ${m.titulo}` : m.titulo)), dica: "Um por item: Quando | marco. Quando em semanas a partir da aprovação (ex.: semana 1, semanas 2 a 3)", maximo: 10 },
        { chave: "cronograma.observacao", rotulo: "Observação", tipo: "texto", valorAtual: d.observacao, maximo: 300 },
      ];
    case "investimento":
      return [
        { chave: "investimento.intangiveis", rotulo: "Intangíveis", tipo: "lista", valorAtual: d.intangiveis, dica: "Pesquisa, conceito, estratégia... Sem preço: o valor sai dos itens", maximo: 10 },
        { chave: "investimento.condicoes", rotulo: "Condições", tipo: "texto", valorAtual: d.condicoes, dica: "Só condições que a equipe já usa; nunca um valor", maximo: 500 },
      ];
    case "proximos_passos":
      return [
        { chave: "proximos_passos.passos", rotulo: "Passos", tipo: "lista", valorAtual: d.passos, maximo: 6 },
        { chave: "proximos_passos.chamada", rotulo: "Chamada", tipo: "texto", valorAtual: d.chamada, maximo: 200 },
      ];
    default:
      return [];
  }
}

/** Todos os campos que a IA pode preencher, na ordem da proposta. */
export function camposDaProposta(c: ConteudoDaProposta): CampoDoBloco[] {
  return c.blocos.reduce((l, b) => l.concat(camposDoBloco(b)), [] as CampoDoBloco[]);
}

const deParesTexto = (v: unknown, a: string, b: string) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : [])
    .map((x) => String(x == null ? "" : x).trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("|");
      return i < 0 ? { [a]: l, [b]: "" } : { [a]: l.slice(0, i).trim(), [b]: l.slice(i + 1).trim() };
    });
const comoLista = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : []).map((x) => String(x == null ? "" : x).trim()).filter(Boolean);

/**
 * Aplica valores por chave ("capa.headline", "processo.etapas"...) no
 * conteúdo. Chave desconhecida é ignorada. Número sem origem sai (a mesma
 * régua da geração) quando `origem` vem; o que sai volta em `tiradas`.
 */
export function aplicarValoresNoConteudo(c: ConteudoDaProposta, valores: Record<string, unknown>, origem?: string): { conteudo: ConteudoDaProposta; tiradas: string[] } {
  let conteudo = c;
  const tiradas: string[] = [];
  const limpo = (t: unknown) => {
    const s = typeof t === "string" ? t : "";
    if (origem === undefined) return s;
    const r = semNumeroInventado(s, origem);
    tiradas.push(...r.tiradas);
    return r.texto;
  };
  for (const chave of Object.keys(valores || {})) {
    const ponto = chave.indexOf(".");
    if (ponto < 0) continue;
    const tipo = chave.slice(0, ponto) as TipoDeBloco;
    const campo = chave.slice(ponto + 1);
    if ((TIPOS_DE_BLOCO as readonly string[]).indexOf(tipo) < 0 || tipo === "mercado" || tipo === "provas" || tipo === "quem_somos") continue;
    const v = valores[chave];
    const b = blocoDoTipo(conteudo, tipo);
    const d = { ...(b.dados as Record<string, unknown>) };
    if (tipo === "diagnostico" && campo === "achados") d.achados = deParesTexto(v, "titulo", "texto").map((x) => ({ titulo: x.titulo, texto: limpo(x.texto), fonte: null }));
    else if ((tipo === "solucao" && campo === "frentes") || (tipo === "processo" && campo === "etapas")) d[campo] = deParesTexto(v, "titulo", "texto").map((x) => ({ titulo: x.titulo, texto: limpo(x.texto) }));
    else if (tipo === "entregaveis" && campo === "itens") d.itens = deParesTexto(v, "nome", "detalhe").map((x) => ({ nome: x.nome, detalhe: limpo(x.detalhe) }));
    else if (tipo === "cronograma" && campo === "marcos") d.marcos = deParesTexto(v, "quando", "titulo").map((x) => (x.titulo ? { quando: x.quando, titulo: x.titulo } : { quando: "", titulo: x.quando }));
    else if (["palavras_do_cliente", "nao_inclui", "intangiveis", "passos"].indexOf(campo) >= 0) d[campo] = comoLista(v).map(limpo).filter(Boolean);
    else if (campo in d) d[campo] = limpo(typeof v === "string" ? v : String(v == null ? "" : v));
    else continue;
    conteudo = comBloco(conteudo, tipo, { dados: d as Bloco["dados"] });
  }
  return { conteudo: normalizarConteudo(conteudo), tiradas };
}

/** Os valores de agora das chaves pedidas (para o Desfazer do Preencher com IA). */
export function valoresDasChaves(c: ConteudoDaProposta, chaves: string[]): Record<string, unknown> {
  const todos = camposDaProposta(c);
  const saida: Record<string, unknown> = {};
  for (const k of chaves) {
    const campo = todos.find((x) => x.chave === k);
    if (campo) saida[k] = campo.valorAtual === undefined ? "" : campo.valorAtual;
  }
  return saida;
}

const vazio = (v: unknown) => (Array.isArray(v) ? v.length === 0 : !String(v == null ? "" : v).trim());
const comoTexto = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).join("\n") : String(v == null ? "" : v));

export type Diferenca = { chave: string; bloco: string; rotulo: string; antes: string; depois: string; estava_vazio: boolean };

/** O que mudou entre dois conteúdos, campo a campo (Preencher tudo e comparar versões). */
export function diferencasDoConteudo(antes: ConteudoDaProposta, depois: ConteudoDaProposta): Diferenca[] {
  const a = camposDaProposta(antes);
  const d = camposDaProposta(depois);
  const saida: Diferenca[] = [];
  for (const campo of d) {
    const velho = a.find((x) => x.chave === campo.chave);
    const tAntes = comoTexto(velho ? velho.valorAtual : "");
    const tDepois = comoTexto(campo.valorAtual);
    if (tAntes === tDepois) continue;
    const tipo = campo.chave.split(".")[0] as TipoDeBloco;
    saida.push({ chave: campo.chave, bloco: ROTULO_DO_BLOCO[tipo] || tipo, rotulo: campo.rotulo, antes: tAntes, depois: tDepois, estava_vazio: vazio(velho ? velho.valorAtual : "") });
  }
  // Mercado, visível e título: comparados à parte (não são campos da IA).
  for (const b of depois.blocos) {
    const velho = blocoDoTipo(antes, b.tipo);
    if (velho.visivel !== b.visivel) saida.push({ chave: `${b.tipo}.visivel`, bloco: ROTULO_DO_BLOCO[b.tipo], rotulo: "Na página", antes: velho.visivel ? "visível" : "oculto", depois: b.visivel ? "visível" : "oculto", estava_vazio: false });
    if (velho.titulo !== b.titulo) saida.push({ chave: `${b.tipo}.titulo`, bloco: ROTULO_DO_BLOCO[b.tipo], rotulo: "Título da página", antes: velho.titulo, depois: b.titulo, estava_vazio: !velho.titulo });
    if (b.tipo === "mercado" && JSON.stringify(velho.dados) !== JSON.stringify(b.dados)) {
      const n = (x: Bloco) => {
        const m = x.dados as { dados: unknown[]; concorrentes: unknown[] };
        return `${m.dados.length} dado(s), ${m.concorrentes.length} concorrente(s)`;
      };
      saida.push({ chave: "mercado.pesquisa", bloco: ROTULO_DO_BLOCO.mercado, rotulo: "Pesquisa", antes: n(velho), depois: n(b), estava_vazio: false });
    }
  }
  return saida;
}

/**
 * Junta a proposta do modelo ao conteúdo atual só nas chaves escolhidas
 * (Aplicar campo a campo). Por padrão a tela escolhe as que estavam vazias.
 */
export function mesclarPorChaves(atual: ConteudoDaProposta, proposto: ConteudoDaProposta, chaves: string[]): ConteudoDaProposta {
  const valores: Record<string, unknown> = {};
  const campos = camposDaProposta(proposto);
  let conteudo = atual;
  for (const k of chaves) {
    if (k === "mercado.pesquisa") {
      conteudo = comBloco(conteudo, "mercado", { dados: blocoDoTipo(proposto, "mercado").dados });
      continue;
    }
    const campo = campos.find((x) => x.chave === k);
    if (campo) valores[k] = campo.valorAtual;
  }
  return aplicarValoresNoConteudo(conteudo, valores).conteudo;
}

/** Diferença dos itens entre duas versões. */
export function diferencasDosItens(antes: ItemDaProposta[], depois: ItemDaProposta[]): string[] {
  const saida: string[] = [];
  for (const d of depois) {
    const a = antes.find((x) => x.id === d.id) || antes.find((x) => x.nome === d.nome);
    if (!a) saida.push(`Entrou: ${d.nome} (${d.quantidade} x ${reais(d.valor_unitario)})`);
    else if (a.valor_unitario !== d.valor_unitario || a.quantidade !== d.quantidade || a.recorrencia !== d.recorrencia) saida.push(`Mudou: ${d.nome} (${a.quantidade} x ${reais(a.valor_unitario)} para ${d.quantidade} x ${reais(d.valor_unitario)})`);
  }
  for (const a of antes) if (!depois.some((x) => x.id === a.id || x.nome === a.nome)) saida.push(`Saiu: ${a.nome}`);
  return saida;
}

// ------------------------------------------------------------------ esquemas das ações de IA novas

export const ESQUEMA_DAS_HEADLINES = {
  nome: "headlines_da_proposta",
  schema: { type: "object", additionalProperties: false, required: ["opcoes"], properties: { opcoes: { type: "array", items: { type: "string" } } } },
} as const;

export const ESQUEMA_DO_RESUMO = {
  nome: "resumo_da_reuniao",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["objetivo", "dores", "pedidos", "prazos", "orcamento_citado", "decisores", "falas", "pendencias"],
    properties: {
      objetivo: { type: "string" },
      dores: { type: "array", items: { type: "string" } },
      pedidos: { type: "array", items: { type: "string" } },
      prazos: { type: "array", items: { type: "string" } },
      orcamento_citado: { type: "string" },
      decisores: { type: "array", items: { type: "string" } },
      falas: { type: "array", items: { type: "string" } },
      pendencias: { type: "array", items: { type: "string" } },
    },
  },
} as const;

/** Esquema do "tom da marca" a partir dos campos do bloco. */
export function esquemaDoTom(chaves: Array<{ chave: string; tipo: string }>) {
  const props: Record<string, unknown> = {};
  for (const c of chaves) {
    const nome = c.chave.split(".")[1];
    props[nome] = c.tipo === "lista" ? { type: "array", items: { type: "string" } } : { type: "string" };
  }
  return { nome: "bloco_no_tom_da_marca", schema: { type: "object", additionalProperties: false, required: Object.keys(props), properties: props } };
}

/** Resumo da reunião (JSON do modelo) em notas legíveis. Número só se estiver na transcrição. */
export function notasDoResumo(bruto: unknown, origem: string): { notas: string; tiradas: string[] } {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const tiradas: string[] = [];
  const limpo = (t: unknown) => {
    const r = semNumeroInventado(textoLimpo(t, 600), origem);
    tiradas.push(...r.tiradas);
    return r.texto;
  };
  const lista = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []).map(limpo).filter(Boolean).slice(0, 8);
  const partes: string[] = [];
  const objetivo = limpo(o.objetivo);
  if (objetivo) partes.push(`Objetivo: ${objetivo}`);
  const secao = (titulo: string, itens: string[]) => {
    if (itens.length) partes.push(`${titulo}:\n${itens.map((x) => `- ${x}`).join("\n")}`);
  };
  secao("Dores", lista("dores"));
  secao("O que pediu", lista("pedidos"));
  secao("Prazos", lista("prazos"));
  const orc = limpo(o.orcamento_citado);
  if (orc) partes.push(`Orçamento citado: ${orc}`);
  secao("Quem decide", lista("decisores"));
  secao("Falas do cliente", lista("falas"));
  secao("Falta saber", lista("pendencias"));
  return { notas: partes.join("\n\n").slice(0, 20_000), tiradas };
}

/** Headlines: até 3, sem número inventado, sem repetida. */
export function lerHeadlines(bruto: unknown, origem: string): string[] {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const vistas = new Set<string>();
  return (Array.isArray(o.opcoes) ? o.opcoes : [])
    .map((x) => textoLimpo(x, 160).replace(/[.!]+$/, ""))
    .filter((x) => x.length >= 6 && semNumeroInventado(x, origem).tiradas.length === 0)
    .filter((x) => {
      const k = x.toLowerCase();
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    })
    .slice(0, 3);
}
