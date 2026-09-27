/**
 * Rotina de monitoramento do tráfego pago (pedido do dono em 27/09/2026:
 * "ativar uma rotina de monitorar a campanha de forma super inteligente,
 * identificando o que está gastando sem resultado e pausando, montando
 * estratégias quando necessário, e só avisa quando fez tal coisa").
 *
 * Regras do dono logo depois ("autônomo, mas de forma inteligente pra não
 * cometer loucuras; acompanhamento humano; sempre trazer provas"):
 * - trava dura em código, que o modelo não pula: teto diário de verba,
 *   subida máxima por passo, gasto mínimo antes de julgar, fase de
 *   aprendizado, N ações por rodada e por dia, nunca pausar a última coisa
 *   ativa sem motivo forte, nunca agir com dado velho, e parar e avisar
 *   quando algo parece fora do normal;
 * - o julgamento de cada caso (pausar, manter, observar, trocar criativo,
 *   subir verba) passa pelo Jev com a evidência calculada aqui; a regra fixa
 *   escolhe os candidatos e o Jev decide o caso;
 * - sem prova (números com fonte e hora, estado lido antes, veredito do Jev)
 *   a ação não acontece.
 *
 * Aqui só o que é puro (sem Deno, sem banco, sem rede): testado no Vitest.
 * Quem lê a conta, fala com a Meta e grava é rotina-rodada.ts.
 */

export type NivelDaRotina = "campanha" | "conjunto" | "anuncio";
export type AcaoDaRotina = "pausar" | "subir_verba" | "trocar_criativo";

/** Travas fixas (o dono ajusta dentro destes limites, nunca fora). */
export const PADROES_DA_ROTINA = {
  /** Subida de verba por passo no vencedor (%), padrão e teto absoluto. */
  subida_padrao_pct: 20,
  subida_teto_pct: 30,
  /** Intervalo mínimo entre duas mudanças de verba no mesmo item (h). */
  intervalo_de_verba_h: 72,
  max_acoes_rodada: 3,
  max_acoes_dia: 6,
  /** Acima disso a rotina relê o item na Meta antes de agir (min). */
  sincronia_para_reler_min: 45,
  /** Acima disso a rotina nem começa: o coletor parou (h). */
  sincronia_parada_h: 6,
  /** Janela de julgamento (dias). */
  janela_dias: 7,
  /** Probabilidade mínima que o Jev dá à ação para a rotina agir. */
  limiar_jev_pausar: 0.6,
  limiar_jev_subir: 0.7,
  /** O Jev acha a conta fora do normal: a rotina para e avisa. */
  limiar_fora_do_normal: 0.6,
  /** Não mexe de novo no mesmo item dentro deste prazo (h). */
  mesma_coisa_h: 24,
  /** Número da conta que dispara a parada por gasto (x a média diária). */
  gasto_disparado_multiplo: 3,
  /** A regra mandaria pausar esta fração dos anúncios ativos ou mais: não pausa em massa. */
  pausa_em_massa_fracao: 0.6,
  /** Mais de uma rodada por hora não traz dado novo (a coleta é a cada 10 min). */
  intervalo_entre_rodadas_min: 55,
} as const;

/** Limites de julgamento (editáveis pelo dono na tela; padrão sensato por nicho e objetivo). */
export type Limites = {
  /** Custo por resultado que o negócio aceita (R$). Sem ele, a regra usa o gasto mínimo em dobro. */
  custo_alvo_brl: number | null;
  /** Pausar quando gastou X vezes o custo-alvo sem nenhum resultado. */
  multiplo_sem_resultado: number;
  /** Nunca julga antes deste gasto no item (R$). */
  gasto_minimo_brl: number;
  /** Pausar quando o custo por resultado passa X vezes o alvo, com volume. */
  multiplo_custo_alto: number;
  /** Resultados mínimos para julgar custo alto. */
  resultados_min_para_custo: number;
  /** CTR de link abaixo disso (%), com impressões mínimas: o criativo não chama atenção. */
  ctr_minimo_pct: number;
  impressoes_minimas: number;
  /** Frequência de 7 dias a partir da qual a fadiga é provável. */
  frequencia_maxima: number;
  /** Dias com entrega antes de julgar custo (fase de aprendizado). */
  dias_aprendizado: number;
};

export type FonteDoLimite = "dono" | "plano" | "briefing" | "conta" | "nicho" | "padrao";

export const LIMITES_PADRAO: Limites = {
  custo_alvo_brl: null,
  multiplo_sem_resultado: 2,
  gasto_minimo_brl: 15,
  multiplo_custo_alto: 2,
  resultados_min_para_custo: 3,
  ctr_minimo_pct: 0.5,
  impressoes_minimas: 1000,
  frequencia_maxima: 3.5,
  dias_aprendizado: 3,
};

/** Faixas aceitas para o que o dono edita (o resto é recusado e volta ao padrão). */
const FAIXAS: Record<keyof Omit<Limites, "custo_alvo_brl">, [number, number]> = {
  multiplo_sem_resultado: [1, 5],
  gasto_minimo_brl: [5, 500],
  multiplo_custo_alto: [1.2, 5],
  resultados_min_para_custo: [1, 50],
  ctr_minimo_pct: [0.1, 5],
  impressoes_minimas: [300, 50000],
  frequencia_maxima: [1.5, 10],
  dias_aprendizado: [1, 14],
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;
const reais = (v: number | null | undefined) => (v == null ? "sem valor" : `R$ ${v.toFixed(2).replace(".", ",")}`);
const pct = (v: number | null | undefined) => (v == null ? "sem dado" : `${String(arred(v, 2)).replace(".", ",")}%`);
/** Travessão (U+2013 e U+2014) vira vírgula; montado pelo código do caractere para o arquivo não ter o sinal. */
const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]", "g");
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(TRAVESSAO, ",").trim().slice(0, max) : "");

/** Só os limites que o dono mandou e que cabem na faixa; o resto some (volta ao padrão). */
export function limitesDoDono(bruto: unknown): Partial<Limites> {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const r: Partial<Limites> = {};
  const alvo = num(o.custo_alvo_brl);
  if (alvo !== null && alvo > 0 && alvo <= 100000) r.custo_alvo_brl = arred(alvo);
  for (const k of Object.keys(FAIXAS) as (keyof typeof FAIXAS)[]) {
    const v = num(o[k]);
    if (v !== null && v >= FAIXAS[k][0] && v <= FAIXAS[k][1]) (r as Record<string, number>)[k] = arred(v, 2);
  }
  return r;
}

/**
 * Referência do nicho para o objetivo (conhecimento-trafego.ts): custo típico
 * por resultado no Brasil, CTR mínimo e frequência de alerta. Tudo opcional.
 */
export type ReferenciaDoNicho = { custo_tipico_brl: number | null; ctr_minimo_pct?: number | null; frequencia_maxima?: number | null; fonte: string };

/**
 * Limites que valem na rodada, com a fonte de cada um. Custo-alvo, nesta
 * ordem: o dono, o critério do plano de teste, o custo tolerável do
 * briefing, a média da própria conta (com volume) e a referência do nicho.
 */
export function limitesEfetivos(e: {
  dono?: Partial<Limites> | null;
  custoDoPlano?: number | null;
  custoDoBriefing?: number | null;
  custoMedioDaConta?: number | null;
  resultadosDaConta?: number | null;
  referencia?: ReferenciaDoNicho | null;
}): { limites: Limites; fontes: Record<keyof Limites, FonteDoLimite> } {
  const dono = e.dono ?? {};
  const limites: Limites = { ...LIMITES_PADRAO };
  const fontes = Object.keys(LIMITES_PADRAO).reduce((acc, k) => ({ ...acc, [k]: "padrao" }), {} as Record<keyof Limites, FonteDoLimite>);
  const positivo = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (e.referencia) {
    if (positivo(e.referencia.ctr_minimo_pct)) {
      limites.ctr_minimo_pct = e.referencia.ctr_minimo_pct as number;
      fontes.ctr_minimo_pct = "nicho";
    }
    if (positivo(e.referencia.frequencia_maxima)) {
      limites.frequencia_maxima = e.referencia.frequencia_maxima as number;
      fontes.frequencia_maxima = "nicho";
    }
  }
  const alvos: [number | null | undefined, FonteDoLimite][] = [
    [dono.custo_alvo_brl, "dono"],
    [e.custoDoPlano, "plano"],
    [e.custoDoBriefing, "briefing"],
    [(e.resultadosDaConta ?? 0) >= 10 ? e.custoMedioDaConta : null, "conta"],
    [e.referencia ? e.referencia.custo_tipico_brl : null, "nicho"],
  ];
  const escolhido = alvos.find(([v]) => positivo(v));
  if (escolhido) {
    limites.custo_alvo_brl = arred(escolhido[0] as number);
    fontes.custo_alvo_brl = escolhido[1];
  }
  for (const k of Object.keys(dono) as (keyof Limites)[]) {
    if (k === "custo_alvo_brl") continue;
    const v = dono[k];
    if (typeof v === "number") {
      (limites as Record<string, number | null>)[k] = v;
      fontes[k] = "dono";
    }
  }
  return { limites, fontes };
}

// ------------------------------------------------------------------ retrato da conta

/** Um item da conta como a rotina e o agente leem (números do código, janela de 7 dias). */
export type ItemDaConta = {
  nivel: NivelDaRotina;
  meta_id: string;
  nome: string;
  status: string | null;
  campanha_id: string | null;
  campanha: string | null;
  conjunto_id: string | null;
  conjunto: string | null;
  resultado_tipo: string | null;
  resultado_rotulo: string;
  orcamento_diario_brl: number | null;
  gasto: number;
  impressoes: number;
  resultados: number;
  custo_por_resultado: number | null;
  ctr_link_pct: number | null;
  cpm: number | null;
  frequencia: number | null;
  /** Dias com entrega dentro da janela. */
  dias_com_gasto: number;
  /** Primeiro dia com entrega dentro da janela (AAAA-MM-DD). */
  primeiro_dia: string | null;
  /** Variação da segunda metade da janela contra a primeira (%). */
  ctr_var_pct: number | null;
  custo_var_pct: number | null;
};

export type PontoDoDia = { dia: string; gasto: number; resultados: number };

export type RetratoDaConta = {
  periodo: { inicio: string; fim: string; dias: number };
  /** Hora da última coleta da Meta que o painel tem. */
  sincronizado_em: string | null;
  objetivo_tipo: string | null;
  resultado_rotulo: string;
  itens: ItemDaConta[];
  /** Série diária da conta (gasto e resultados por dia), para a parada por anomalia. */
  serie: PontoDoDia[];
  totais: { gasto: number; resultados: number; custo_por_resultado: number | null };
  /** Soma dos orçamentos diários ativos que o painel conhece (campanhas com orçamento). */
  orcamento_ativo_brl: number | null;
};

export type Sinal = "queimando" | "custo_alto" | "sem_clique" | "fadiga" | "vencedor" | "aprendizado" | "cedo" | "ok" | "parado";

export type Avaliacao = {
  item: ItemDaConta;
  sinal: Sinal;
  /** Ação que a regra propõe (null = nada a fazer). */
  acao: AcaoDaRotina | null;
  /** Motivo forte (gasto muito acima do limite): permite pausar a última coisa ativa. */
  forte: boolean;
  /** Frase curta da regra, com os números. */
  regra: string;
};

/**
 * Regra fixa de cada item (sem IA). Pausar e fadiga olham anúncios; subir
 * verba olha quem tem orçamento (campanha ou conjunto).
 */
export function avaliarItem(i: ItemDaConta, L: Limites): Avaliacao {
  const base = { item: i, forte: false };
  if (String(i.status ?? "").toUpperCase() !== "ACTIVE") return { ...base, sinal: "parado", acao: null, regra: "Não está ativo." };
  const alvo = L.custo_alvo_brl;
  const limiarSemResultado = alvo ? Math.max(L.gasto_minimo_brl, arred(alvo * L.multiplo_sem_resultado)) : arred(L.gasto_minimo_brl * 2);
  const noComeco = i.dias_com_gasto < L.dias_aprendizado;
  if (i.resultados <= 0) {
    if (i.gasto >= limiarSemResultado) {
      // No começo (fase de aprendizado), só com queima grave: 1,5 vez o limite.
      if (noComeco && i.gasto < limiarSemResultado * 1.5) {
        return { ...base, sinal: "aprendizado", acao: null, regra: `Gastou ${reais(i.gasto)} sem ${i.resultado_rotulo.toLowerCase()}, mas está no começo (${i.dias_com_gasto} ${i.dias_com_gasto === 1 ? "dia" : "dias"} de entrega). Espera a fase de aprendizado.` };
      }
      if (i.nivel !== "anuncio") return { ...base, sinal: "queimando", acao: null, regra: `Gastou ${reais(i.gasto)} sem ${i.resultado_rotulo.toLowerCase()} (limite ${reais(limiarSemResultado)}). A rotina pausa pelos anúncios.` };
      return {
        ...base,
        sinal: "queimando",
        acao: "pausar",
        forte: i.gasto >= limiarSemResultado * 1.5,
        regra: `Gastou ${reais(i.gasto)} em ${i.dias_com_gasto} ${i.dias_com_gasto === 1 ? "dia" : "dias"} sem nenhuma ${singular(i.resultado_rotulo)} (limite ${reais(limiarSemResultado)}${alvo ? `, ${String(L.multiplo_sem_resultado).replace(".", ",")} vezes o custo-alvo de ${reais(alvo)}` : ""}).`,
      };
    }
    if (i.nivel === "anuncio" && i.impressoes >= L.impressoes_minimas && i.ctr_link_pct !== null && i.ctr_link_pct < L.ctr_minimo_pct && i.gasto >= L.gasto_minimo_brl) {
      return { ...base, sinal: "sem_clique", acao: "trocar_criativo", regra: `CTR de link ${pct(i.ctr_link_pct)} em ${i.impressoes.toLocaleString("pt-BR")} impressões (mínimo ${pct(L.ctr_minimo_pct)}): o criativo não chama atenção.` };
    }
    return { ...base, sinal: "cedo", acao: null, regra: `Gastou ${reais(i.gasto)} sem resultado ainda; julga a partir de ${reais(limiarSemResultado)}.` };
  }
  const cpr = i.custo_por_resultado;
  if (alvo && cpr !== null && i.resultados >= L.resultados_min_para_custo && cpr > alvo * L.multiplo_custo_alto && !noComeco) {
    if (i.nivel !== "anuncio") return { ...base, sinal: "custo_alto", acao: null, regra: `Custo por resultado ${reais(cpr)}, acima de ${String(L.multiplo_custo_alto).replace(".", ",")} vezes o alvo (${reais(alvo)}).` };
    return {
      ...base,
      sinal: "custo_alto",
      acao: "pausar",
      forte: cpr > alvo * L.multiplo_custo_alto * 1.5,
      regra: `${i.resultados} ${i.resultado_rotulo.toLowerCase()} a ${reais(cpr)} cada, acima de ${String(L.multiplo_custo_alto).replace(".", ",")} vezes o custo-alvo de ${reais(alvo)}.`,
    };
  }
  const fadiga = i.frequencia !== null && i.frequencia >= L.frequencia_maxima && ((i.ctr_var_pct !== null && i.ctr_var_pct <= -20) || (i.custo_var_pct !== null && i.custo_var_pct >= 20));
  if (fadiga && i.nivel === "anuncio") {
    return { ...base, sinal: "fadiga", acao: "trocar_criativo", regra: `Frequência ${String(i.frequencia).replace(".", ",")} em 7 dias${i.ctr_var_pct !== null ? `, CTR ${i.ctr_var_pct > 0 ? "+" : ""}${pct(i.ctr_var_pct)}` : ""}${i.custo_var_pct !== null ? `, custo ${i.custo_var_pct > 0 ? "+" : ""}${pct(i.custo_var_pct)}` : ""}: o público cansou do criativo.` };
  }
  const podeEscalar = i.nivel !== "anuncio" && alvo && cpr !== null && i.resultados >= 5 && cpr <= alvo * 0.8 && (i.frequencia ?? 0) < 2.5 && !noComeco && !(i.custo_var_pct !== null && i.custo_var_pct >= 20);
  if (podeEscalar) {
    return { ...base, sinal: "vencedor", acao: "subir_verba", regra: `${i.resultados} ${i.resultado_rotulo.toLowerCase()} a ${reais(cpr)} cada (alvo ${reais(alvo)}), frequência ${String(i.frequencia ?? 0).replace(".", ",")}: há espaço para crescer.` };
  }
  if (noComeco) return { ...base, sinal: "aprendizado", acao: null, regra: `No começo (${i.dias_com_gasto} ${i.dias_com_gasto === 1 ? "dia" : "dias"} de entrega): a Meta ainda está aprendendo.` };
  return { ...base, sinal: "ok", acao: null, regra: cpr !== null ? `${i.resultados} ${i.resultado_rotulo.toLowerCase()} a ${reais(cpr)} cada.` : "Sem alerta." };
}

function singular(rotulo: string): string {
  const r = rotulo.toLowerCase();
  if (r.indexOf("conversa") >= 0) return "conversa";
  if (r.indexOf("cadastro") >= 0 || r.indexOf("lead") >= 0) return "cadastro";
  if (r.indexOf("compra") >= 0) return "compra";
  if (r.indexOf("visita") >= 0) return "visita";
  return "resultado";
}

/**
 * Sinais de que algo está fora do normal: a rotina para, avisa uma vez e
 * não mexe (dado velho, gasto disparado, resultado zerado de repente, a
 * regra mandando pausar quase tudo).
 */
export function foraDoNormal(r: RetratoDaConta, avaliacoes: Avaliacao[], agoraMs: number, tetoBrl: number | null = null): { parar: string[]; sem_subir: string[] } {
  const P = PADROES_DA_ROTINA;
  const motivos: string[] = [];
  const semSubir: string[] = [];
  const sinc = r.sincronizado_em ? Date.parse(r.sincronizado_em) : NaN;
  if (!Number.isFinite(sinc)) motivos.push("Não sei quando a conta foi lida pela última vez. Não mexo sem saber a idade dos números.");
  else if (agoraMs - sinc > P.sincronia_parada_h * 3600_000) {
    motivos.push(`Os números da conta não são atualizados há ${Math.round((agoraMs - sinc) / 3600_000)} horas (a coleta da Meta parou). Não mexo com dado velho.`);
  }
  const dias = r.serie.slice().sort((a, b) => (a.dia < b.dia ? -1 : 1));
  if (dias.length >= 3) {
    const hoje = dias[dias.length - 1];
    const anteriores = dias.slice(0, -1);
    const media = anteriores.reduce((s, d) => s + d.gasto, 0) / anteriores.length;
    if (media > 0 && hoje.gasto > media * P.gasto_disparado_multiplo && hoje.gasto > 30) {
      motivos.push(`O gasto de hoje (${reais(hoje.gasto)}) está mais de ${P.gasto_disparado_multiplo} vezes acima da média dos dias anteriores (${reais(arred(media))}). Alguém mudou a conta ou a Meta está entregando diferente.`);
    }
    const ontem = dias[dias.length - 2];
    const antes = dias.slice(0, -2);
    const mediaResultados = antes.length ? antes.reduce((s, d) => s + d.resultados, 0) / antes.length : 0;
    const mediaGasto = antes.length ? antes.reduce((s, d) => s + d.gasto, 0) / antes.length : 0;
    if (mediaResultados >= 3 && ontem.resultados === 0 && hoje.resultados === 0 && ontem.gasto >= mediaGasto * 0.5 && mediaGasto > 0) {
      motivos.push(`Nenhum resultado ontem e hoje com gasto normal, depois de uma média de ${arred(mediaResultados, 1)} por dia. Pode ser rastreio quebrado ou o WhatsApp fora do ar: confira antes de eu mexer.`);
    }
  }
  const ativos = avaliacoes.filter((a) => a.item.nivel === "anuncio" && a.sinal !== "parado");
  const pausar = ativos.filter((a) => a.acao === "pausar");
  if (ativos.length >= 3 && pausar.length / ativos.length >= P.pausa_em_massa_fracao) {
    motivos.push(`A regra mandaria pausar ${pausar.length} de ${ativos.length} anúncios ativos. Pausa em massa não é rotina: prefiro que você olhe.`);
  }
  if (tetoBrl !== null && r.orcamento_ativo_brl !== null && r.orcamento_ativo_brl > tetoBrl) {
    // Não para a rotina (pausar o que queima continua valendo); só trava a subida.
    semSubir.push(`O orçamento ativo (${reais(r.orcamento_ativo_brl)} por dia) já passa do teto que você definiu (${reais(tetoBrl)}): não subo verba até voltar ao teto.`);
  }
  return { parar: motivos, sem_subir: semSubir };
}

// ------------------------------------------------------------------ regras do dono (interferir)

export const TIPOS_DE_REGRA = ["nao_mexer", "nao_pausar", "segurar_verba", "so_avisar", "outra"] as const;
export type TipoDeRegra = (typeof TIPOS_DE_REGRA)[number];

export const ROTULO_DA_REGRA: Record<TipoDeRegra, string> = {
  nao_mexer: "Não mexer",
  nao_pausar: "Não pausar",
  segurar_verba: "Segurar a verba",
  so_avisar: "Só avisar, sem agir",
  outra: "Orientação",
};

export type AlvoDaRegra = { nivel: NivelDaRotina; meta_id: string; nome: string };

export type RegraDoDono = {
  id: string;
  texto: string;
  tipo: TipoDeRegra;
  /** Vazio = a conta toda. */
  alvos: AlvoDaRegra[];
  /** Vale até este dia, inclusive (AAAA-MM-DD). Null = sem prazo. */
  ate: string | null;
  criada_em: string;
  criada_por: string | null;
  ativa: boolean;
};

export function normalizarRegras(bruto: unknown): RegraDoDono[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  return lista.map((x) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const tipo = (TIPOS_DE_REGRA as readonly string[]).indexOf(String(o.tipo)) >= 0 ? (o.tipo as TipoDeRegra) : "outra";
    const alvos = (Array.isArray(o.alvos) ? o.alvos : []).map((a) => {
      const q = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      const nivel = q.nivel === "campanha" || q.nivel === "conjunto" || q.nivel === "anuncio" ? q.nivel : null;
      const id = typeof q.meta_id === "string" && /^[0-9]{3,30}$/.test(q.meta_id) ? q.meta_id : null;
      return nivel && id ? { nivel, meta_id: id, nome: limpo(q.nome, 160) || id } : null;
    }).filter((a): a is AlvoDaRegra => !!a).slice(0, 10);
    const ate = typeof o.ate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.ate) ? o.ate : null;
    return {
      id: limpo(o.id, 40) || "",
      texto: limpo(o.texto, 400),
      tipo,
      alvos,
      ate,
      criada_em: typeof o.criada_em === "string" ? o.criada_em : "",
      criada_por: typeof o.criada_por === "string" ? o.criada_por : null,
      ativa: o.ativa !== false,
    };
  }).filter((r) => !!r.id && !!r.texto).slice(0, 30);
}

/** Regras que valem hoje (ativas e dentro do prazo). */
export const regrasQueValem = (regras: RegraDoDono[], hoje: string) => regras.filter((r) => r.ativa && (!r.ate || r.ate >= hoje));

/** O item cai na regra? (alvo direto, a campanha ou o conjunto dele; sem alvo, a conta toda). */
function cobre(r: RegraDoDono, i: Pick<ItemDaConta, "meta_id" | "campanha_id" | "conjunto_id">): boolean {
  if (!r.alvos.length) return true;
  return r.alvos.some((a) => a.meta_id === i.meta_id || a.meta_id === i.campanha_id || a.meta_id === i.conjunto_id);
}

/**
 * A regra do dono que barra esta ação neste item (null = pode). "ajustar" é
 * qualquer outra mudança (renomear, baixar verba): só "não mexer" e "só
 * avisar" barram.
 */
export function regraQueBarra(acao: AcaoDaRotina | "ajustar", i: Pick<ItemDaConta, "meta_id" | "campanha_id" | "conjunto_id">, regras: RegraDoDono[]): RegraDoDono | null {
  for (const r of regras) {
    if (!cobre(r, i)) continue;
    if (r.tipo === "nao_mexer" || r.tipo === "so_avisar") return r;
    if (r.tipo === "nao_pausar" && acao === "pausar") return r;
    if (r.tipo === "segurar_verba" && acao === "subir_verba") return r;
  }
  return null;
}

/** Datas que o Jev escolhe para "até quando" (calculadas aqui; o Jev só escolhe). */
export function opcoesDePrazo(hoje: string): Record<string, { data: string | null; rotulo: string }> {
  const d = new Date(`${hoje}T12:00:00.000Z`);
  const dia = (n: number) => {
    const x = new Date(d.getTime());
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const semana = d.getUTCDay(); // 0 domingo
  const ate = (alvo: number) => dia(((alvo - semana) + 7) % 7 || 7);
  const fimDoMes = (() => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
    return x.toISOString().slice(0, 10);
  })();
  return {
    sem_prazo: { data: null, rotulo: "Sem prazo: vale até eu tirar a regra." },
    hoje: { data: hoje, rotulo: "Só hoje." },
    amanha: { data: dia(1), rotulo: "Até amanhã." },
    segunda: { data: ate(1), rotulo: "Até a próxima segunda-feira." },
    terca: { data: ate(2), rotulo: "Até a próxima terça-feira." },
    quarta: { data: ate(3), rotulo: "Até a próxima quarta-feira." },
    quinta: { data: ate(4), rotulo: "Até a próxima quinta-feira." },
    sexta: { data: ate(5), rotulo: "Até a próxima sexta-feira." },
    sabado: { data: ate(6), rotulo: "Até o próximo sábado." },
    domingo: { data: ate(0), rotulo: "Até o próximo domingo." },
    uma_semana: { data: dia(7), rotulo: "Por uma semana." },
    fim_do_mes: { data: fimDoMes, rotulo: "Até o fim do mês." },
  };
}

/**
 * Perguntas do Jev para transformar a instrução do dono em regra: o tipo, o
 * alvo (escolhido entre os itens reais da conta ou "a conta toda") e o prazo
 * (entre datas calculadas aqui). Selecionar em vez de gerar.
 */
export function perguntasDaRegra(texto: string, alvos: AlvoDaRegra[], hoje: string) {
  const prazos = opcoesDePrazo(hoje);
  const criteriaAlvo: Record<string, string> = { conta_toda: "A instrução vale para a conta toda, sem citar campanha, conjunto ou anúncio específico." };
  alvos.slice(0, 60).forEach((a, k) => {
    criteriaAlvo[`a${k + 1}`] = `${a.nivel === "campanha" ? "Campanha" : a.nivel === "conjunto" ? "Conjunto" : "Anúncio"} "${a.nome}".`;
  });
  const criteriaPrazo: Record<string, string> = {};
  for (const k of Object.keys(prazos)) criteriaPrazo[k] = prazos[k].rotulo;
  return {
    state: { hoje, instrucao_do_dono: texto, itens_da_conta: alvos.slice(0, 60).map((a, k) => ({ ref: `a${k + 1}`, nivel: a.nivel, nome: a.nome })) },
    questions: {
      tipo: {
        type: "choice" as const,
        instructions: "O dono escreveu `instrucao_do_dono` para a rotina que cuida dos anúncios dele. Que tipo de regra é essa?",
        criteria: {
          nao_mexer: { what: "Não mexer de jeito nenhum no item citado (nem pausar, nem mudar verba).", examples: ["não mexe no conjunto X", "deixa a campanha Y quieta"] },
          nao_pausar: { what: "Pode ajustar, mas não pausar o item citado.", examples: ["não pausa o anúncio do vídeo", "mantém o X rodando"] },
          segurar_verba: { what: "Não aumentar a verba (pode pausar o que queima).", examples: ["segura a verba até sexta", "não sobe orçamento"] },
          so_avisar: { what: "A rotina não deve agir sozinha: só mostrar o que faria e avisar.", examples: ["só me avisa antes", "não faz nada sozinho"] },
          outra: { what: "Uma orientação de estratégia que não trava ação específica.", examples: ["foca em mensagem", "prioriza o público de mulheres"] },
        },
      },
      alvo: {
        type: "choice" as const,
        instructions: "A `instrucao_do_dono` fala de qual item de `itens_da_conta`? Compare os nomes (o dono pode abreviar). Se não cita nenhum, é a conta toda.",
        criteria: criteriaAlvo,
      },
      prazo: {
        type: "choice" as const,
        instructions: `Hoje é ${hoje}. Até quando vale a \`instrucao_do_dono\`? Sem prazo dito, é sem prazo.`,
        criteria: criteriaPrazo,
      },
    },
    prazos,
  };
}

/** Lê as respostas do Jev e monta a regra (sem confiança suficiente no alvo, vale para a conta toda). */
export function regraDasRespostas(
  texto: string,
  alvos: AlvoDaRegra[],
  hoje: string,
  answers: Record<string, { choice?: string; confidence?: number } | undefined> | null,
  meta: { id: string; criada_em: string; criada_por: string | null },
): RegraDoDono {
  const prazos = opcoesDePrazo(hoje);
  const a = answers ?? {};
  const tipo = a.tipo && (TIPOS_DE_REGRA as readonly string[]).indexOf(String(a.tipo.choice)) >= 0 && (a.tipo.confidence ?? 0) >= 0.35 ? (a.tipo.choice as TipoDeRegra) : "outra";
  const escolha = a.alvo && typeof a.alvo.choice === "string" && /^a\d+$/.test(a.alvo.choice) && (a.alvo.confidence ?? 0) >= 0.35 ? alvos[Number(a.alvo.choice.slice(1)) - 1] ?? null : null;
  const prazo = a.prazo && typeof a.prazo.choice === "string" && prazos[a.prazo.choice] ? prazos[a.prazo.choice].data : null;
  return { id: meta.id, texto: limpo(texto, 400), tipo, alvos: escolha ? [escolha] : [], ate: prazo, criada_em: meta.criada_em, criada_por: meta.criada_por, ativa: true };
}

/** A regra em uma frase para a tela ("Não pausar: conjunto Raio 5 km, até 03/10"). */
export function regraEmTexto(r: RegraDoDono): string {
  const alvo = r.alvos.length ? r.alvos.map((a) => `${a.nivel === "campanha" ? "campanha" : a.nivel === "conjunto" ? "conjunto" : "anúncio"} ${a.nome}`).join(", ") : "a conta toda";
  const ate = r.ate ? `, até ${r.ate.slice(8, 10)}/${r.ate.slice(5, 7)}` : "";
  return `${ROTULO_DA_REGRA[r.tipo]}: ${alvo}${ate}`;
}

// ------------------------------------------------------------------ Jev: o caso de julgamento

export type Candidato = { ref: string; avaliacao: Avaliacao; opcoes: string[] };

const OPCOES_DO_JEV: Record<string, { what: string; not_for: string }> = {
  pausar: {
    what: "Parar este anúncio agora: gastou o suficiente para concluir e não traz o resultado que o objetivo pede, ou traz caro demais para o negócio.",
    not_for: "Anúncio com pouco gasto, no começo da entrega, ou com resultado dentro do alvo.",
  },
  subir_verba: {
    what: "Subir a verba aos poucos: vencedor estável, custo abaixo do alvo, frequência baixa e fora da fase de aprendizado.",
    not_for: "Resultado recente ou pouco volume, custo subindo, frequência alta.",
  },
  trocar_criativo: {
    what: "O público e a verba estão certos, mas o criativo cansou ou não chama atenção: manter rodando e preparar criativo novo.",
    not_for: "Anúncio que simplesmente não traz resultado nenhum com gasto alto (esse é pausar).",
  },
  observar: {
    what: "Ainda é cedo ou os números são poucos ou contraditórios: esperar a próxima rodada antes de mexer.",
    not_for: "Casos em que os números já bastam para decidir.",
  },
  manter: {
    what: "Deixar como está: o resultado está dentro do esperado para o objetivo e o nicho.",
    not_for: "Item que queima dinheiro sem resultado.",
  },
};

/** Opções do Jev para a ação que a regra propôs (a regra nunca fica sem saída de "não mexer"). */
export function opcoesDoCaso(acao: AcaoDaRotina): string[] {
  if (acao === "pausar") return ["pausar", "trocar_criativo", "observar", "manter"];
  if (acao === "subir_verba") return ["subir_verba", "manter", "observar"];
  return ["trocar_criativo", "pausar", "observar", "manter"];
}

export function candidatosDaRodada(avaliacoes: Avaliacao[], max = 8): Candidato[] {
  const ordem: Record<string, number> = { queimando: 0, custo_alto: 1, fadiga: 2, sem_clique: 3, vencedor: 4 };
  return avaliacoes
    .filter((a) => !!a.acao)
    .sort((a, b) => (ordem[a.sinal] ?? 9) - (ordem[b.sinal] ?? 9) || b.item.gasto - a.item.gasto)
    .slice(0, max)
    .map((a, k) => ({ ref: `k${k + 1}`, avaliacao: a, opcoes: opcoesDoCaso(a.acao as AcaoDaRotina) }));
}

export type ContextoDoJulgamento = {
  nicho: string | null;
  objetivo: string | null;
  estrategia: string | null;
  limites: Limites;
  regras_do_dono: string[];
  conta: { gasto_7d: number; resultados_7d: number; custo_por_resultado: number | null; anuncios_ativos: number };
};

/** Estado e perguntas do Jev da rodada: uma Choice por caso e um Noul de "fora do normal". */
export function perguntasDaRodada(candidatos: Candidato[], ctx: ContextoDoJulgamento) {
  const casos = candidatos.map((c) => {
    const i = c.avaliacao.item;
    return {
      ref: c.ref,
      nivel: i.nivel,
      nome: i.nome,
      campanha: i.campanha,
      conjunto: i.conjunto,
      o_que_a_regra_viu: c.avaliacao.regra,
      acao_que_a_regra_propoe: c.avaliacao.acao,
      numeros_7_dias: {
        gasto_brl: i.gasto,
        impressoes: i.impressoes,
        resultado: i.resultado_rotulo,
        resultados: i.resultados,
        custo_por_resultado_brl: i.custo_por_resultado,
        ctr_link_pct: i.ctr_link_pct,
        cpm_brl: i.cpm,
        frequencia: i.frequencia,
        dias_com_entrega: i.dias_com_gasto,
        variacao_ctr_pct: i.ctr_var_pct,
        variacao_custo_pct: i.custo_var_pct,
      },
    };
  });
  const state = {
    negocio: { nicho: ctx.nicho, objetivo_principal: ctx.objetivo, estrategia_do_plano: ctx.estrategia },
    limites_da_agencia: { custo_alvo_brl: ctx.limites.custo_alvo_brl, gasto_minimo_para_julgar_brl: ctx.limites.gasto_minimo_brl, dias_de_aprendizado: ctx.limites.dias_aprendizado, frequencia_de_alerta: ctx.limites.frequencia_maxima },
    conta_7_dias: ctx.conta,
    regras_do_dono: ctx.regras_do_dono,
    casos,
  };
  const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, unknown> } | { type: "noul"; instructions: string; criteria: { true: string; false: string } }> = {};
  candidatos.forEach((c, k) => {
    const criteria: Record<string, unknown> = {};
    for (const o of c.opcoes) criteria[o] = OPCOES_DO_JEV[o];
    questions[`caso_${k}`] = {
      type: "choice",
      instructions: `Você é o gestor de tráfego sênior deste negócio (\`negocio\`). Olhando \`casos[${k}]\` (números de 7 dias calculados pelo painel), os \`limites_da_agencia\` e as \`regras_do_dono\`, o que fazer com este item agora? Pense no nicho e no objetivo: o que importa é o resultado que vende, não curtida.`,
      criteria,
    };
  });
  questions.fora_do_normal = {
    type: "noul",
    instructions: "Pelos números de `conta_7_dias` e dos `casos`, algo parece fora do normal a ponto de ser mais seguro NÃO mexer em nada agora (rastreio quebrado, números incoerentes entre si, gasto que não bate)?",
    criteria: { true: "Sim: algo parece errado nos dados; melhor uma pessoa olhar antes.", false: "Não: os números são coerentes e dá para decidir." },
  };
  return { state, questions };
}

export type Veredito = {
  ref: string;
  escolha: string | null;
  probabilidade: number | null;
  confianca: number | null;
  probabilidades: Record<string, number> | null;
};

export type Decisao = {
  candidato: Candidato;
  veredito: Veredito;
  /** A rotina age? Só quando o Jev escolhe a mesma ação da regra com probabilidade suficiente. */
  agir: boolean;
  /** O Jev pediu criativo novo: vira proposta (Confirmar), nunca ação sozinha. */
  proposta: boolean;
  motivo: string;
};

type RespostaJev = { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number };

/** Junta regra e Jev: a rotina só age quando os dois concordam (Jev acima do limiar). Sem Jev, não age. */
export function decidirComJev(candidatos: Candidato[], answers: Record<string, RespostaJev | undefined> | null): { decisoes: Decisao[]; fora_do_normal: number | null } {
  const P = PADROES_DA_ROTINA;
  const decisoes = candidatos.map((c, k) => {
    const r = answers ? answers[`caso_${k}`] : undefined;
    const escolha = r && typeof r.choice === "string" ? r.choice : null;
    const probs = r && r.probabilities && typeof r.probabilities === "object" ? r.probabilities : null;
    const acao = c.avaliacao.acao as AcaoDaRotina;
    const prob = probs && typeof probs[acao] === "number" ? probs[acao] : escolha === acao && typeof r?.confidence === "number" ? r.confidence : null;
    const veredito: Veredito = { ref: c.ref, escolha, probabilidade: prob, confianca: typeof r?.confidence === "number" ? r.confidence : null, probabilidades: probs };
    if (!r || !escolha) return { candidato: c, veredito, agir: false, proposta: false, motivo: "O Jev não respondeu: sem julgamento, não agi." };
    const limiar = acao === "subir_verba" ? P.limiar_jev_subir : P.limiar_jev_pausar;
    if (acao === "trocar_criativo" || escolha === "trocar_criativo") {
      return { candidato: c, veredito, agir: false, proposta: escolha === "trocar_criativo", motivo: escolha === "trocar_criativo" ? "O Jev concorda: o criativo precisa de troca. Preparei a proposta para você confirmar." : `O Jev preferiu ${escolha}.` };
    }
    if (escolha === acao && prob !== null && prob >= limiar) {
      return { candidato: c, veredito, agir: true, proposta: false, motivo: `Regra e Jev concordam (${Math.round(prob * 100)}% para ${acao === "pausar" ? "pausar" : "subir a verba"}).` };
    }
    return { candidato: c, veredito, agir: false, proposta: false, motivo: escolha === acao ? `O Jev concorda, mas sem certeza suficiente (${prob !== null ? Math.round(prob * 100) : 0}%, mínimo ${Math.round(limiar * 100)}%): observo na próxima rodada.` : `O Jev preferiu ${escolha === "observar" ? "observar" : escolha === "manter" ? "manter" : escolha}: não mexi.` };
  });
  const noul = answers && answers.fora_do_normal && typeof answers.fora_do_normal.noul === "number" ? answers.fora_do_normal.noul : null;
  return { decisoes, fora_do_normal: noul };
}

// ------------------------------------------------------------------ travas duras

export type AcaoRecente = { meta_id: string; tipo: string; criado_em: string; origem: string };

export type ContextoDasTravas = {
  agoraMs: number;
  hoje: string;
  regras: RegraDoDono[];
  /** Ações feitas nas últimas 72 h (rotina e agente), para os limites por dia e por item. */
  recentes: AcaoRecente[];
  max_rodada: number;
  max_dia: number;
  /** Anúncios ativos da conta agora (para nunca zerar a conta sem motivo forte). */
  anuncios_ativos: number;
  teto_diario_brl: number | null;
};

export type Barrado = { decisao: Decisao; motivo: string };

/** Aplica as travas em código; o que passar pode ser feito (ainda relido na Meta antes). */
export function aplicarTravas(decisoes: Decisao[], c: ContextoDasTravas): { fazer: Decisao[]; barrados: Barrado[] } {
  const P = PADROES_DA_ROTINA;
  const fazer: Decisao[] = [];
  const barrados: Barrado[] = [];
  const hojeFeitas = c.recentes.filter((r) => r.criado_em.slice(0, 10) === c.hoje && (r.tipo === "pausar" || r.tipo === "orcamento" || r.tipo === "ativar")).length;
  let ativos = c.anuncios_ativos;
  const regras = regrasQueValem(c.regras, c.hoje);
  for (const d of decisoes) {
    if (!d.agir) continue;
    const i = d.candidato.avaliacao.item;
    const acao = d.candidato.avaliacao.acao as AcaoDaRotina;
    const regra = regraQueBarra(acao, i, regras);
    if (regra) {
      barrados.push({ decisao: d, motivo: `Regra sua: "${regra.texto}".` });
      continue;
    }
    const mexido = c.recentes.find((r) => r.meta_id === i.meta_id && c.agoraMs - Date.parse(r.criado_em) < (acao === "subir_verba" ? P.intervalo_de_verba_h : P.mesma_coisa_h) * 3600_000);
    if (mexido) {
      barrados.push({ decisao: d, motivo: acao === "subir_verba" ? `A verba deste item mudou há menos de ${P.intervalo_de_verba_h} h: espero a Meta se ajustar.` : `Já mexi neste item há menos de ${P.mesma_coisa_h} h.` });
      continue;
    }
    if (fazer.length >= c.max_rodada) {
      barrados.push({ decisao: d, motivo: `Limite de ${c.max_rodada} ${c.max_rodada === 1 ? "ação" : "ações"} por rodada: fica para a próxima.` });
      continue;
    }
    if (hojeFeitas + fazer.length >= c.max_dia) {
      barrados.push({ decisao: d, motivo: `Limite de ${c.max_dia} ações por dia: fica para amanhã.` });
      continue;
    }
    if (acao === "pausar") {
      if (ativos <= 1 && !d.candidato.avaliacao.forte) {
        barrados.push({ decisao: d, motivo: "É o último anúncio ativo da conta e o motivo não é forte o bastante para deixar o cliente sem anúncio." });
        continue;
      }
      ativos--;
    }
    if (acao === "subir_verba" && c.teto_diario_brl === null) {
      barrados.push({ decisao: d, motivo: "Sem teto diário definido: a rotina não sobe verba sozinha." });
      continue;
    }
    fazer.push(d);
  }
  return { fazer, barrados };
}

/**
 * Nova verba do vencedor: sobe no máximo a subida por passo (20 a 30%) e
 * nunca deixa a soma dos orçamentos ativos passar do teto diário. Null quando
 * não há espaço (ou o item não tem orçamento próprio).
 */
export function novaVerba(atualBrl: number | null, subidaPct: number, tetoBrl: number | null, somaAtivaBrl: number | null): { para: number; variacao_pct: number; motivo: string } | null {
  if (atualBrl === null || !(atualBrl > 0) || tetoBrl === null || !(tetoBrl > 0)) return null;
  const passo = Math.max(5, Math.min(PADROES_DA_ROTINA.subida_teto_pct, subidaPct));
  const soma = somaAtivaBrl !== null && somaAtivaBrl >= atualBrl ? somaAtivaBrl : atualBrl;
  const espaco = arred(tetoBrl - soma);
  if (espaco < 1) return null;
  const desejado = arred(atualBrl * (1 + passo / 100));
  const para = arred(Math.min(desejado, atualBrl + espaco));
  if (para - atualBrl < 1) return null;
  const variacao = arred(((para - atualBrl) / atualBrl) * 100, 1);
  return { para, variacao_pct: variacao, motivo: para < desejado ? `Subi ${String(variacao).replace(".", ",")}% (o teto diário de ${reais(tetoBrl)} não deixa mais).` : `Subi ${String(variacao).replace(".", ",")}%, o passo máximo por vez.` };
}

// ------------------------------------------------------------------ prova

export type EstadoLidoNaMeta = { status: string | null; efetivo: string | null; orcamento_diario_brl: number | null; nome: string | null; aprendizado?: string | null };

export type Prova = {
  numeros: {
    periodo: { inicio: string; fim: string; dias: number };
    gasto: number;
    impressoes: number;
    resultados: number;
    resultado_rotulo: string;
    custo_por_resultado: number | null;
    ctr_link_pct: number | null;
    cpm: number | null;
    frequencia: number | null;
  };
  fonte: string;
  sincronizado_em: string | null;
  /** Releitura dos números na Meta logo antes de agir (quando a coleta passou do prazo). */
  relido_na_meta_em: string | null;
  regra: string;
  limites: { custo_alvo_brl: number | null; fonte_do_alvo: FonteDoLimite; gasto_minimo_brl: number };
  antes: EstadoLidoNaMeta | null;
  depois: EstadoLidoNaMeta | null;
  jev: { escolha: string | null; probabilidade: number | null; confianca: number | null; probabilidades: Record<string, number> | null } | null;
};

/** Sem prova, a ação não acontece: números com período, fonte e hora, estado lido antes e o Jev. */
export function provaSuficiente(p: Pick<Prova, "numeros" | "fonte" | "sincronizado_em" | "antes" | "jev" | "relido_na_meta_em">, exigeJev = true): string | null {
  if (!p.numeros || !p.numeros.periodo || !p.numeros.periodo.inicio) return "Sem os números do período.";
  if (!p.fonte) return "Sem a fonte dos números.";
  if (!p.sincronizado_em && !p.relido_na_meta_em) return "Sem a hora da leitura dos números.";
  if (!p.antes) return "Sem o estado lido na Meta antes de mexer.";
  if (exigeJev && (!p.jev || !p.jev.escolha)) return "Sem o veredito do Jev.";
  return null;
}

/** Os números do item para a prova (o que motivou a ação). */
export function numerosDaProva(i: ItemDaConta, periodo: { inicio: string; fim: string; dias: number }): Prova["numeros"] {
  return {
    periodo,
    gasto: i.gasto,
    impressoes: i.impressoes,
    resultados: i.resultados,
    resultado_rotulo: i.resultado_rotulo,
    custo_por_resultado: i.custo_por_resultado,
    ctr_link_pct: i.ctr_link_pct,
    cpm: i.cpm,
    frequencia: i.frequencia,
  };
}

/**
 * Números lidos agora na Meta (insights do item), no formato do item. Conta
 * o resultado pelos tipos de ação do objetivo (o primeiro presente vale).
 */
export function numerosDaMeta(bruto: unknown, tiposDeAcao: string[]): { gasto: number; impressoes: number; resultados: number; ctr_link_pct: number | null; frequencia: number | null } | null {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as Record<string, unknown>).data) ? (bruto as { data: Record<string, unknown>[] }).data : null;
  if (!lista) return null;
  let gasto = 0, impressoes = 0, cliques = 0, resultados = 0, freqPeso = 0;
  for (const l of lista) {
    const imp = num(l.impressions) ?? 0;
    gasto += num(l.spend) ?? 0;
    impressoes += imp;
    cliques += num(l.inline_link_clicks) ?? 0;
    const f = num(l.frequency);
    if (f !== null && imp > 0) freqPeso += f * imp;
    const acoes = Array.isArray(l.actions) ? (l.actions as Record<string, unknown>[]) : [];
    for (const t of tiposDeAcao) {
      const a = acoes.find((x) => x && x.action_type === t);
      if (a) {
        resultados += num(a.value) ?? 0;
        break;
      }
    }
  }
  return {
    gasto: arred(gasto),
    impressoes,
    resultados,
    ctr_link_pct: impressoes > 0 ? arred((cliques / impressoes) * 100) : null,
    frequencia: impressoes > 0 && freqPeso > 0 ? arred(freqPeso / impressoes) : null,
  };
}

/** A regra ainda vale com os números relidos? (a rotina nunca age sobre número que mudou) */
export function reavaliarComMeta(i: ItemDaConta, relido: NonNullable<ReturnType<typeof numerosDaMeta>>, L: Limites): Avaliacao {
  const resultados = relido.resultados;
  return avaliarItem({
    ...i,
    gasto: relido.gasto,
    impressoes: relido.impressoes,
    resultados,
    custo_por_resultado: resultados > 0 ? arred(relido.gasto / resultados) : null,
    ctr_link_pct: relido.ctr_link_pct ?? i.ctr_link_pct,
    frequencia: relido.frequencia ?? i.frequencia,
  }, L);
}

// ------------------------------------------------------------------ estratégia (proposta)

/** Proposta de estratégia quando o criativo cansou ou não chama atenção (vira cartão com Confirmar). */
export function propostaDeCriativo(i: ItemDaConta, vencedores: ItemDaConta[]): { titulo: string; texto: string; pedido_ao_agente: string } {
  const base = vencedores.find((v) => v.meta_id !== i.meta_id && v.nivel === "anuncio" && v.resultados > 0) ?? null;
  const titulo = `Criativo novo para ${i.nome}`;
  const texto = base
    ? `O anúncio ${i.nome} precisa de criativo novo. Proposta: 3 variações partindo do ${base.nome} (${base.resultados} ${base.resultado_rotulo.toLowerCase()} a ${reais(base.custo_por_resultado)}), mudando só o gancho, no mesmo público e verba.`
    : `O anúncio ${i.nome} precisa de criativo novo. Proposta: 3 ângulos novos para o mesmo público e verba, mudando um gancho por vez.`;
  const pedido = `${texto} Monte o plano de teste com os criativos e deixe tudo pronto para eu confirmar.`;
  return { titulo, texto, pedido_ao_agente: pedido };
}

// ------------------------------------------------------------------ retrato para o agente sênior

/**
 * Retrato da campanha para o agente sênior (antes de responder): cada nível
 * com os números da janela, a fase, o sinal da regra e a comparação com o
 * custo-alvo e a referência do nicho, mais o histórico do que já foi feito.
 */
export function retratoParaOAgente(r: RetratoDaConta, avaliacoes: Avaliacao[], L: Limites, fontes: Record<keyof Limites, FonteDoLimite>, feito: { quando: string; resumo: string; porque: string }[], referencia: ReferenciaDoNicho | null) {
  const porNivel = (nivel: NivelDaRotina) => avaliacoes.filter((a) => a.item.nivel === nivel && a.sinal !== "parado").slice(0, nivel === "anuncio" ? 25 : 12).map((a) => ({
    nome: a.item.nome,
    campanha: a.item.campanha,
    conjunto: a.item.conjunto,
    orcamento_diario_brl: a.item.orcamento_diario_brl,
    gasto: a.item.gasto,
    resultados: a.item.resultados,
    custo_por_resultado: a.item.custo_por_resultado,
    ctr_link_pct: a.item.ctr_link_pct,
    cpm: a.item.cpm,
    frequencia: a.item.frequencia,
    dias_com_entrega: a.item.dias_com_gasto,
    fase: a.item.dias_com_gasto < L.dias_aprendizado ? "aprendizado provável" : "estável",
    sinal_da_regra: a.sinal,
    o_que_a_regra_viu: a.regra,
  }));
  return {
    janela: r.periodo,
    sincronizado_em: r.sincronizado_em,
    resultado_principal: r.resultado_rotulo,
    totais_7_dias: r.totais,
    orcamento_ativo_diario_brl: r.orcamento_ativo_brl,
    custo_alvo: { valor: L.custo_alvo_brl, fonte: fontes.custo_alvo_brl },
    referencia_do_nicho: referencia,
    limites_da_rotina: { gasto_minimo_brl: L.gasto_minimo_brl, multiplo_sem_resultado: L.multiplo_sem_resultado, multiplo_custo_alto: L.multiplo_custo_alto, ctr_minimo_pct: L.ctr_minimo_pct, frequencia_maxima: L.frequencia_maxima, dias_aprendizado: L.dias_aprendizado },
    campanhas: porNivel("campanha"),
    conjuntos: porNivel("conjunto"),
    anuncios: porNivel("anuncio"),
    ja_foi_feito: feito.slice(0, 12),
  };
}
