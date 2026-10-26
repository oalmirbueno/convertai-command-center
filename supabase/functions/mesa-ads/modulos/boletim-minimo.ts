/**
 * Boletim de anúncios que sempre chega (27/10/2026). Diagnóstico de 26/10: ads_boletins com 0 linhas. O
 * Gestor do Paperclip foi instruído a gravar às 9h e 17h, mas a rodada das 17h usou um OAuth só com
 * clients:read (não escreve) e o único boletim tentado (Hermes, 17h47) foi recusado por nivel "medio".
 *
 * Às 9h15 BRT dos dias úteis, se nenhum boletim do dia foi gravado, o painel grava um boletim mínimo com os
 * dados que já coleta (ads_campaigns, ads_campaign_daily, ads_account_snapshot). Só exceções, regras fixas,
 * sem IA:
 *   custo_alto        custo por resultado dos últimos 7 dias acima de 2x a média do cliente em 30 dias
 *   gasto_sem_resultado  R$ 50 ou mais gastos desde o último resultado (campanha de resultado)
 *   sem_gasto         campanha ativa sem gastar há 3 dias ou mais
 *   saldo_curto       saldo pré-pago para menos de 3 dias no ritmo dos últimos 7 dias
 *   terminando        campanha ativa que termina nos próximos 2 dias
 * Um aviso no sino (ads_boletim_registrar toca uma vez por boletim novo). Se o agente já gravou qualquer
 * boletim no dia, não grava nada.
 *
 * Puro (sem Deno, banco ou rede): a função mesa-ads e o Vitest importam direto. Sem travessão.
 */
import { type Diaria, somarMetricas } from "../calculos.ts";

export const PERIODO_DO_BOLETIM_MINIMO = "09h";
export const PRINCIPAL_DO_BOLETIM_MINIMO = "painel:boletim-minimo";
export const LIMITES_DO_BOLETIM = {
  custo_vezes_a_media: 2,
  resultados_minimos_da_media: 3,
  gasto_sem_resultado_brl: 50,
  dias_sem_gasto: 3,
  dias_de_saldo: 3,
  dias_para_terminar: 2,
} as const;

export type NivelDoBoletim = "info" | "atencao" | "critico";
export type TipoDaExcecao = "custo_alto" | "gasto_sem_resultado" | "sem_gasto" | "saldo_curto" | "terminando";

export type DiaDaCampanha = { day: string; spend: number | string | null; actions?: unknown };
export type CampanhaDoBoletim = {
  client_id: string;
  cliente: string;
  external_account_id?: string | null;
  campaign_id: string;
  nome: string;
  effective_status?: string | null;
  objective?: string | null;
  start_time?: string | null;
  stop_time?: string | null;
  dias: DiaDaCampanha[];
};
export type ContaDoBoletim = {
  client_id: string;
  cliente: string;
  external_account_id?: string | null;
  saldo_disponivel?: number | string | null;
  is_prepay_account?: boolean | null;
};
export type FatosDoBoletim = {
  hoje: string;
  boletins_hoje: Array<{ periodo: string; criado_em?: string | null; principal?: string | null; operator_slug?: string | null }>;
  campanhas: CampanhaDoBoletim[];
  contas: ContaDoBoletim[];
};
export type Excecao = { client_id: string; cliente: string; nivel: NivelDoBoletim; tipo: TipoDaExcecao; texto: string };
export type BoletimMinimo =
  | { pular: true; motivo: string }
  | { pular: false; periodo: string; resumo: string; alertas: Array<{ client_id: string; nivel: NivelDoBoletim; texto: string }>; por_cliente: Array<{ client_id: string; gasto: number; resultado: number; observacao: string }>; texto_completo: string; excecoes: Excecao[] };

// ------------------------------------------------------------------ apoio

const DIA_MS = 86_400_000;
const meio = (d: string) => Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`);
const somarDias = (d: string, n: number) => new Date(meio(d) + n * DIA_MS).toISOString().slice(0, 10);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
export const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const ativa = (c: CampanhaDoBoletim) => String(c.effective_status ?? "").toUpperCase() === "ACTIVE";

function metricas(c: CampanhaDoBoletim, de: string, ate: string) {
  const linhas: Diaria[] = (c.dias ?? [])
    .filter((d) => d && d.day && String(d.day).slice(0, 10) >= de && String(d.day).slice(0, 10) <= ate)
    .map((d) => ({ ad_id: c.campaign_id, campaign_id: c.campaign_id, day: String(d.day).slice(0, 10), spend: d.spend, impressions: 0, clicks: 0, link_clicks: 0, frequency: 0, actions: d.actions ?? null }));
  return somarMetricas(linhas);
}

/** Campanha que busca resultado (mensagem, lead, venda): pelo objetivo, pelo nome ou porque já teve resultado. */
export function campanhaDeResultado(c: CampanhaDoBoletim, resultados30: number): boolean {
  if (resultados30 > 0) return true;
  const objetivo = String(c.objective ?? "").toUpperCase();
  if (/LEAD|SALES|CONVERSION|MESSAGE/.test(objetivo)) return true;
  return /whats|direct|mensag|lead|venda|compra|or[cç]amento/i.test(String(c.nome ?? ""));
}

/** O agente (ou qualquer um) já gravou boletim hoje? */
export function boletimDoDiaJaExiste(f: Pick<FatosDoBoletim, "boletins_hoje">): boolean {
  return (f.boletins_hoje ?? []).length > 0;
}

// ------------------------------------------------------------------ exceções

export function excecoesDoDia(f: FatosDoBoletim, agora: Date): Excecao[] {
  const L = LIMITES_DO_BOLETIM;
  const ontem = somarDias(f.hoje, -1);
  const de7 = somarDias(f.hoje, -7);
  const de30 = somarDias(f.hoje, -30);
  const saida: Excecao[] = [];
  const campanhas = (f.campanhas ?? []).filter((c) => c && c.client_id && c.campaign_id);

  // Média do cliente em 30 dias (custo por resultado), só com resultados suficientes.
  const mediaDoCliente = new Map<string, number | null>();
  for (const id of new Set(campanhas.map((c) => c.client_id))) {
    let gasto = 0, resultados = 0;
    for (const c of campanhas.filter((x) => x.client_id === id)) {
      const m = metricas(c, de30, ontem);
      gasto += m.gasto;
      resultados += m.resultados;
    }
    mediaDoCliente.set(id, resultados >= L.resultados_minimos_da_media ? gasto / resultados : null);
  }

  for (const c of campanhas) {
    const base = { client_id: c.client_id, cliente: c.cliente };
    const m7 = metricas(c, de7, ontem);
    const m30 = metricas(c, de30, ontem);
    const media = mediaDoCliente.get(c.client_id) ?? null;

    if (m7.resultados >= 1 && m7.custo_por_resultado !== null && media !== null && m7.custo_por_resultado > L.custo_vezes_a_media * media) {
      saida.push({ ...base, nivel: "atencao", tipo: "custo_alto", texto: `${c.nome}: custo por resultado de ${reais(m7.custo_por_resultado)} nos últimos 7 dias, mais de 2x a média do cliente (${reais(media)}).` });
    }

    if (campanhaDeResultado(c, m30.resultados)) {
      // Gasto desde o último dia com resultado (nos 30 dias).
      const dias = (c.dias ?? []).filter((d) => d && String(d.day).slice(0, 10) >= de30 && String(d.day).slice(0, 10) <= ontem)
        .sort((a, b) => String(a.day).localeCompare(String(b.day)));
      let desde = 0;
      for (const d of dias) {
        const r = metricas({ ...c, dias: [d] }, String(d.day).slice(0, 10), String(d.day).slice(0, 10)).resultados;
        desde = r > 0 ? 0 : desde + num(d.spend);
      }
      if (desde >= L.gasto_sem_resultado_brl) {
        saida.push({ ...base, nivel: "critico", tipo: "gasto_sem_resultado", texto: `${c.nome}: ${reais(desde)} gastos desde o último resultado.` });
      }
    }

    if (ativa(c)) {
      const comecou = c.start_time ? Date.parse(c.start_time) : NaN;
      const terminou = c.stop_time ? Date.parse(c.stop_time) <= agora.getTime() : false;
      const velha = !Number.isFinite(comecou) || agora.getTime() - comecou >= L.dias_sem_gasto * DIA_MS;
      const gastoRecente = metricas(c, somarDias(f.hoje, -L.dias_sem_gasto), ontem).gasto;
      if (!terminou && velha && gastoRecente <= 0) {
        saida.push({ ...base, nivel: "atencao", tipo: "sem_gasto", texto: `${c.nome}: ativa e sem gastar há ${L.dias_sem_gasto} dias ou mais (confira saldo, aprovação do anúncio e público).` });
      }
      if (c.stop_time) {
        const falta = Date.parse(c.stop_time) - agora.getTime();
        if (falta > 0 && falta <= L.dias_para_terminar * DIA_MS) {
          saida.push({ ...base, nivel: "info", tipo: "terminando", texto: `${c.nome}: termina em ${ddmm(new Date(Date.parse(c.stop_time) - 3 * 3_600_000).toISOString())}.` });
        }
      }
    }
  }

  // Saldo pré-pago: só conta com campanha ativa e gasto nos últimos 7 dias.
  for (const conta of f.contas ?? []) {
    if (!conta || !conta.client_id || conta.is_prepay_account !== true || conta.saldo_disponivel === null || conta.saldo_disponivel === undefined) continue;
    const daConta = campanhas.filter((c) => c.client_id === conta.client_id && (!conta.external_account_id || !c.external_account_id || c.external_account_id === conta.external_account_id));
    if (!daConta.some(ativa)) continue;
    const gasto7 = daConta.reduce((s, c) => s + metricas(c, de7, ontem).gasto, 0);
    const porDia = gasto7 / 7;
    if (porDia <= 0) continue;
    const saldo = num(conta.saldo_disponivel);
    const dias = saldo / porDia;
    if (dias < LIMITES_DO_BOLETIM.dias_de_saldo) {
      saida.push({
        client_id: conta.client_id, cliente: conta.cliente, nivel: dias < 1 ? "critico" : "atencao", tipo: "saldo_curto",
        texto: saldo <= 0
          ? `Sem saldo na conta de anúncios (gasta cerca de ${reais(porDia)} por dia): as campanhas param.`
          : `Saldo de ${reais(saldo)} dá para ${dias < 1 ? "menos de 1 dia" : `cerca de ${dias.toFixed(1).replace(".", ",")} dias`} no ritmo de ${reais(porDia)} por dia.`,
      });
    }
  }

  const peso: Record<NivelDoBoletim, number> = { critico: 0, atencao: 1, info: 2 };
  return saida.sort((a, b) => peso[a.nivel] - peso[b.nivel] || a.cliente.localeCompare(b.cliente));
}

// ------------------------------------------------------------------ o boletim

export function boletimMinimo(f: FatosDoBoletim, agora: Date): BoletimMinimo {
  if (boletimDoDiaJaExiste(f)) return { pular: true, motivo: "já existe boletim de hoje (o agente gravou): nada a fazer" };
  const excecoes = excecoesDoDia(f, agora);
  const ativas = (f.campanhas ?? []).filter(ativa).length;
  const clientes = new Set(excecoes.map((e) => e.client_id));
  const criticas = excecoes.filter((e) => e.nivel === "critico").length;
  const resumo = excecoes.length
    ? `Boletim mínimo do painel (o agente não gravou até 9h15): ${excecoes.length} ${excecoes.length === 1 ? "exceção" : "exceções"} em ${clientes.size} ${clientes.size === 1 ? "cliente" : "clientes"}${criticas ? `, ${criticas} ${criticas === 1 ? "crítica" : "críticas"}` : ""}.`
    : `Boletim mínimo do painel (o agente não gravou até 9h15): nenhuma exceção nas ${ativas} ${ativas === 1 ? "campanha ativa" : "campanhas ativas"}.`;
  const ontem = somarDias(f.hoje, -1);
  const de7 = somarDias(f.hoje, -7);
  const porCliente = [...clientes].map((id) => {
    const doCliente = (f.campanhas ?? []).filter((c) => c.client_id === id);
    const m = doCliente.reduce((acc, c) => {
      const x = metricas(c, de7, ontem);
      return { gasto: acc.gasto + x.gasto, resultado: acc.resultado + x.resultados };
    }, { gasto: 0, resultado: 0 });
    return { client_id: id, gasto: Math.round(m.gasto * 100) / 100, resultado: m.resultado, observacao: "últimos 7 dias" };
  });
  const linhas = excecoes.map((e) => `- [${e.nivel}] ${e.cliente}: ${e.texto}`);
  return {
    pular: false,
    periodo: PERIODO_DO_BOLETIM_MINIMO,
    resumo: resumo.slice(0, 2000),
    alertas: excecoes.slice(0, 60).map((e) => ({ client_id: e.client_id, nivel: e.nivel, texto: `${e.cliente}: ${e.texto}`.slice(0, 600) })),
    por_cliente: porCliente.slice(0, 80),
    texto_completo: [resumo, "", ...(linhas.length ? linhas : ["- Nada fora do normal pelas regras fixas."]), "", "Regras: custo por resultado acima de 2x a média do cliente; R$ 50 sem resultado; ativa sem gastar há 3 dias; saldo para menos de 3 dias; termina em 2 dias. Sem IA."].join("\n").slice(0, 40000),
    excecoes,
  };
}
