/**
 * Agenda inteligente (17/10/2026, dono: "nunca agendar uma arte de um padrão
 * que já tem no mesmo dia, não sendo hype, para não ficar muito poluída; de
 * vez em quando ele posta 50 artes tudo no mesmo dia, sendo que poderia
 * dividir na semana; o hype pode até ficar no mesmo dia de uma arte, só que
 * em horários diferentes; todos os hypes com base nas datas atuais, nunca
 * jogar lá para dezembro").
 *
 * Regras, por cliente (mesa_cliente_config; sem linha, a padrão):
 * - no máximo `porDia` posts comuns por dia (padrão 1);
 * - no máximo `hypesPorDia` posts de hype a mais no mesmo dia (padrão 1);
 * - entre dois posts do mesmo dia, pelo menos `horasEntre` horas (padrão 3);
 * - só de segunda a sexta (a regra de sempre do painel); 24/10: o cliente com
 *   postar_fim_de_semana = true libera o sábado e o domingo (`fimDeSemana`);
 * - o hype fica dentro da janela dele (no máximo 3 semanas a partir de hoje).
 *
 * Data escolhida pela equipe é respeitada: aqui só sai o aviso e a sugestão
 * do próximo espaço livre; quem move é quem decide.
 *
 * Arquivo puro (a tela e as funções importam o mesmo): sem import, sem
 * lookbehind, sem classe Unicode e sem grupo nomeado (Safari 11). Sem travessão.
 */

export type RegraDoDia = { porDia: number; hypesPorDia: number; horasEntre: number; fimDeSemana: boolean };

export const REGRA_PADRAO: RegraDoDia = { porDia: 1, hypesPorDia: 1, horasEntre: 3, fimDeSemana: false };

/** Janela máxima de um hype a partir de hoje (o que passa disso não é mais hype). */
export const DIAS_MAXIMOS_DO_HYPE = 21;
/** Faixa de horário em que um post pode sair. */
export const PRIMEIRA_HORA = 8;
export const ULTIMA_HORA = 21;

/** Um post já marcado (ou já escolhido nesta mesma leva): o dia, a hora (se houver) e se é de hype. */
export type Ocupacao = { data: string; hora: string | null; hype: boolean };

const DIA_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function regraDoCliente(linha: unknown): RegraDoDia {
  const o = (linha && typeof linha === "object" ? linha : {}) as Record<string, unknown>;
  const n = (v: unknown, min: number, max: number, padrao: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= min && x <= max ? Math.round(x) : padrao;
  };
  return {
    porDia: n(o.posts_por_dia, 1, 5, REGRA_PADRAO.porDia),
    hypesPorDia: n(o.hypes_por_dia, 0, 3, REGRA_PADRAO.hypesPorDia),
    horasEntre: n(o.horas_entre_posts, 1, 12, REGRA_PADRAO.horasEntre),
    fimDeSemana: o.postar_fim_de_semana === true,
  };
}

export function somarDias(data: string, n: number): string {
  return new Date(Date.parse(`${data}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
}

export function diaUtil(data: string): boolean {
  const d = new Date(`${data}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}

/** "Gancho do momento: Hype: ..." ou "Nicho: ..." na pauta: é post de hype. */
export function ehHype(gancho: unknown): boolean {
  const t = String(gancho || "").trim().toLowerCase();
  return t.indexOf("hype") === 0 || t.indexOf("nicho") === 0;
}

const paraMinutos = (hora: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const paraHora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Quantos comuns e quantos hypes o dia já tem, e as horas marcadas. */
export function doDia(ocupacao: Ocupacao[], data: string): { comuns: number; hypes: number; horas: string[] } {
  const doDia = ocupacao.filter((o) => o.data === data);
  return {
    comuns: doDia.filter((o) => !o.hype).length,
    hypes: doDia.filter((o) => o.hype).length,
    horas: doDia.map((o) => o.hora).filter((h): h is string => !!h),
  };
}

/** O dia é de postar para esta regra? Segunda a sexta sempre; sábado e domingo só com `fimDeSemana`. */
export function diaDePostar(data: string, regra: RegraDoDia = REGRA_PADRAO): boolean {
  return ISO.test(data) && (regra.fimDeSemana === true || diaUtil(data));
}

/** O dia ainda aceita um post deste tipo? (fim de semana nunca, salvo o cliente que posta no fim de semana) */
export function cabeNoDia(ocupacao: Ocupacao[], data: string, hype: boolean, regra: RegraDoDia = REGRA_PADRAO): boolean {
  if (!diaDePostar(data, regra)) return false;
  const d = doDia(ocupacao, data);
  return hype ? d.hypes < regra.hypesPorDia : d.comuns < regra.porDia;
}

/**
 * Uma hora livre no dia: a preferida se estiver a `horasEntre` horas das outras; senão a mais perto dela
 * (andando de 30 em 30 minutos para os dois lados), entre 8h e 21h. Sem nenhuma: null.
 */
export function horaLivre(ocupacao: Ocupacao[], data: string, preferida: string, regra: RegraDoDia = REGRA_PADRAO): string | null {
  const marcadas = doDia(ocupacao, data).horas.map(paraMinutos).filter((m): m is number => m !== null);
  const base = paraMinutos(preferida) ?? 12 * 60;
  const distancia = regra.horasEntre * 60;
  const serve = (m: number) => m >= PRIMEIRA_HORA * 60 && m <= ULTIMA_HORA * 60 && marcadas.every((x) => Math.abs(x - m) >= distancia);
  for (let passo = 0; passo <= 26; passo++) {
    for (const m of passo === 0 ? [base] : [base + passo * 30, base - passo * 30]) {
      if (serve(m)) return paraHora(m);
    }
  }
  return null;
}

/** O próximo espaço livre a partir de `desde` (inclusive) até `ate`: o dia que cabe e a hora com distância. */
export function proximoEspaco(
  ocupacao: Ocupacao[],
  e: { desde: string; ate: string; hype: boolean; horaPreferida: string; regra?: RegraDoDia },
): { data: string; hora: string } | null {
  const regra = e.regra ?? REGRA_PADRAO;
  for (let d = e.desde; d <= e.ate; d = somarDias(d, 1)) {
    if (!cabeNoDia(ocupacao, d, e.hype, regra)) continue;
    const hora = horaLivre(ocupacao, d, e.horaPreferida, regra);
    if (hora) return { data: d, hora };
  }
  return null;
}

/**
 * Encaixa uma leva de posts na agenda sem empilhar: cada um fica na data pedida se ela couber (e estiver na
 * janela); senão vai para o próximo espaço livre da janela; os escolhidos entram na ocupação para os próximos.
 * Hype nunca passa de `DIAS_MAXIMOS_DO_HYPE` a partir de `hoje`. Sem espaço na janela, fica a data pedida
 * (ou o fim da janela) com o aviso: nada some.
 */
export function encaixarNaAgenda(
  itens: Array<{ data: string | null; hype: boolean; fixa?: boolean }>,
  ocupacao: Ocupacao[],
  e: { hoje: string; inicio: string; fim: string; horaPreferida?: string; regra?: RegraDoDia },
): Array<{ data: string; hora: string | null; mudou: boolean; aviso: string | null }> {
  const regra = e.regra ?? REGRA_PADRAO;
  const usada = ocupacao.slice();
  const inicio = e.inicio < e.hoje ? e.hoje : e.inicio;
  return itens.map((it) => {
    const fim = it.hype ? minData(e.fim, somarDias(e.hoje, DIAS_MAXIMOS_DO_HYPE)) : e.fim;
    const pedida = it.data && ISO.test(it.data) ? it.data : null;
    const preferida = e.horaPreferida || "12:00";
    // Data que a equipe escolheu: fica, com hora espaçada e o aviso se o dia passar do limite.
    if (it.fixa && pedida) {
      const cabe = cabeNoDia(usada, pedida, it.hype, regra);
      const hora = horaLivre(usada, pedida, preferida, regra);
      usada.push({ data: pedida, hora, hype: it.hype });
      return { data: pedida, hora, mudou: false, aviso: cabe ? null : avisoDoDia(usada.slice(0, -1), pedida, it.hype, regra) };
    }
    if (pedida && pedida >= inicio && pedida <= fim && cabeNoDia(usada, pedida, it.hype, regra)) {
      const hora = horaLivre(usada, pedida, preferida, regra);
      if (hora) {
        usada.push({ data: pedida, hora, hype: it.hype });
        return { data: pedida, hora, mudou: false, aviso: null };
      }
    }
    const desde = pedida && pedida > inicio && pedida <= fim ? pedida : inicio;
    const vaga = proximoEspaco(usada, { desde, ate: fim, hype: it.hype, horaPreferida: preferida, regra })
      ?? (desde > inicio ? proximoEspaco(usada, { desde: inicio, ate: fim, hype: it.hype, horaPreferida: preferida, regra }) : null);
    if (vaga) {
      usada.push({ data: vaga.data, hora: vaga.hora, hype: it.hype });
      return { data: vaga.data, hora: vaga.hora, mudou: vaga.data !== pedida, aviso: null };
    }
    const data = pedida && pedida <= fim ? pedida : fim;
    usada.push({ data, hora: null, hype: it.hype });
    return { data, hora: null, mudou: data !== pedida, aviso: `Não coube no período sem passar de ${regra.porDia} ${regra.porDia === 1 ? "post" : "posts"} por dia: ficou em ${dataBr(data)}. Aumente o período ou o limite do cliente.` };
  });
}

/** O aviso de dia cheio (vazio quando cabe). */
export function avisoDoDia(ocupacao: Ocupacao[], data: string, hype: boolean, regra: RegraDoDia = REGRA_PADRAO): string | null {
  if (!ISO.test(data)) return null;
  if (!diaDePostar(data, regra)) return `${dataBr(data)} cai no fim de semana; o painel publica de segunda a sexta.`;
  if (cabeNoDia(ocupacao, data, hype, regra)) return null;
  const d = doDia(ocupacao, data);
  return hype
    ? `${dataBr(data)} já tem ${d.hypes} ${d.hypes === 1 ? "post de hype" : "posts de hype"} (limite ${regra.hypesPorDia}).`
    : `${dataBr(data)} já tem ${d.comuns} ${d.comuns === 1 ? "post" : "posts"} (limite ${regra.porDia} por dia).`;
}

const minData = (a: string, b: string) => (a < b ? a : b);
export const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
