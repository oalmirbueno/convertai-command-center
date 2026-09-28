/**
 * Metas de seguidores (frente CE, 28/09/2026).
 *
 * O dono: "quando bater a meta, a mensagem reconhece (batemos a meta,
 * parabéns, a próxima é X) e a próxima meta segue o que estiver cadastrado".
 *
 * As metas ficam em public.social_metas_seguidores (SQL CE-01), uma linha por
 * degrau (1.000, 1.500, 2.000...). Aqui mora só a conta, pura: a série de
 * seguidores da conta principal (social_metrics_weekly) contra os degraus
 * cadastrados. Sem Deno, sem banco: a tela (Ciclo), o ritual-writer e o Vitest
 * usam o mesmo código.
 *
 * Regras:
 * - meta batida = algum ponto da série, depois de a meta existir, com
 *   seguidores >= meta. Batida não "desbate" se o número cair depois.
 * - a próxima meta é a MENOR meta aberta acima do número atual, na ordem do
 *   cadastro; sem meta cadastrada acima, não há próxima (nunca inventamos).
 * - a comemoração acontece UMA vez: a meta já reconhecida numa mensagem
 *   enviada vira contexto ("já comemorada em dd/mm"), não notícia de novo.
 * - previsão só com ritmo positivo de pelo menos duas medições; sem ritmo,
 *   não há data (nada de prometer).
 */

export interface MetaDeSeguidores {
  id: string;
  meta: number;
  /** Data alvo combinada (yyyy-mm-dd), quando existe. */
  prazo: string | null;
  criado_em: string;
  /** Arquivada não conta (deletar = arquivar). */
  arquivada_em?: string | null;
  nota?: string | null;
}

export interface PontoDeSeguidores {
  /** Fim da semana medida (ou o começo, sem o fim). */
  quando: string;
  seguidores: number;
}

export interface MetaBatida {
  id: string;
  meta: number;
  /** Quando a série passou da meta pela primeira vez. */
  quando: string;
  /** Já comemorada numa mensagem enviada. */
  reconhecida: boolean;
  /** A série estava abaixo da meta antes: conquista de verdade. */
  cruzou: boolean;
}

export interface ProximaMeta {
  id: string;
  meta: number;
  faltam: number;
  /** 0 a 100, do degrau anterior (ou do começo da série) até a meta. */
  progresso: number;
  prazo: string | null;
  /** Seguidores por semana nas últimas medições (null sem base). */
  ritmoSemanal: number | null;
  /** Data provável no ritmo atual (yyyy-mm-dd) ou null. */
  previsao: string | null;
  /** Com prazo e ritmo: chega a tempo? */
  noPrazo: boolean | null;
}

export interface SituacaoDasMetas {
  atual: number | null;
  medidoEm: string | null;
  batidas: MetaBatida[];
  /** Batidas ainda não comemoradas: a mensagem de hoje reconhece estas. */
  paraComemorar: MetaBatida[];
  proxima: ProximaMeta | null;
  /** Há meta cadastrada? Sem nenhuma, a mensagem não fala de meta. */
  temMeta: boolean;
}

const DIA = 86_400_000;

const soData = (iso: string) => String(iso ?? "").slice(0, 10);

function tempo(iso: string): number {
  const s = String(iso ?? "");
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`).getTime() : new Date(s).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** Série limpa: um ponto por data, em ordem crescente, só números válidos. */
export function serieOrdenada(pontos: readonly PontoDeSeguidores[]): PontoDeSeguidores[] {
  const porData = new Map<string, number>();
  for (const p of pontos) {
    const n = Number(p?.seguidores);
    const d = soData(p?.quando);
    if (!d || !Number.isFinite(n) || n < 0) continue;
    porData.set(d, Math.max(n, porData.get(d) ?? 0));
  }
  return [...porData.entries()].map(([quando, seguidores]) => ({ quando, seguidores })).sort((a, b) => a.quando.localeCompare(b.quando));
}

/** Seguidores por semana, pela média das últimas até 4 variações. */
export function ritmoSemanal(serie: readonly PontoDeSeguidores[]): number | null {
  const s = serie.slice(-5);
  if (s.length < 2) return null;
  const primeiro = s[0];
  const ultimo = s[s.length - 1];
  const semanas = (tempo(ultimo.quando) - tempo(primeiro.quando)) / (7 * DIA);
  if (!Number.isFinite(semanas) || semanas <= 0) return null;
  return Math.round(((ultimo.seguidores - primeiro.seguidores) / semanas) * 10) / 10;
}

export function situacaoDasMetas(
  metas: readonly MetaDeSeguidores[],
  pontos: readonly PontoDeSeguidores[],
  opcoes: { agora?: Date; reconhecidas?: readonly string[] } = {},
): SituacaoDasMetas {
  const agora = opcoes.agora ?? new Date();
  const reconhecidas = new Set(opcoes.reconhecidas ?? []);
  const serie = serieOrdenada(pontos);
  const ultimo = serie[serie.length - 1] ?? null;
  const validas = metas
    .filter((m) => m && !m.arquivada_em && Number.isFinite(Number(m.meta)) && Number(m.meta) > 0)
    .map((m) => ({ ...m, meta: Math.round(Number(m.meta)) }))
    .sort((a, b) => a.meta - b.meta);
  const vazio: SituacaoDasMetas = { atual: ultimo?.seguidores ?? null, medidoEm: ultimo?.quando ?? null, batidas: [], paraComemorar: [], proxima: null, temMeta: validas.length > 0 };
  if (!validas.length) return vazio;

  const batidas: MetaBatida[] = [];
  for (const m of validas) {
    // A meta cadastrada depois de o número já estar acima dela conta como
    // batida no primeiro ponto medido depois do cadastro (nada de retroativo).
    const desde = tempo(m.criado_em);
    const indice = serie.findIndex((p) => p.seguidores >= m.meta && (!Number.isFinite(desde) || tempo(p.quando) + 7 * DIA >= desde));
    if (indice < 0) continue;
    // Conquista é cruzar a linha: meta cadastrada abaixo de um número que já
    // estava acima (sem nenhum ponto anterior abaixo dela) conta como batida,
    // mas não vira comemoração.
    const cruzou = serie.slice(0, indice).some((p) => p.seguidores < m.meta);
    batidas.push({ id: m.id, meta: m.meta, quando: serie[indice].quando, reconhecida: reconhecidas.has(m.id), cruzou });
  }
  const idsBatidas = new Set(batidas.map((b) => b.id));
  const atual = ultimo?.seguidores ?? null;
  const aberta = validas.find((m) => !idsBatidas.has(m.id) && (atual === null || m.meta > atual)) ?? null;

  let proxima: ProximaMeta | null = null;
  if (aberta) {
    const ritmo = ritmoSemanal(serie);
    const faltam = atual === null ? aberta.meta : Math.max(0, aberta.meta - atual);
    const degrauAnterior = [...batidas].sort((a, b) => b.meta - a.meta)[0]?.meta ?? serie[0]?.seguidores ?? 0;
    const base = Math.min(degrauAnterior, atual ?? degrauAnterior);
    const progresso = atual === null || aberta.meta <= base ? 0 : Math.max(0, Math.min(100, Math.round(((atual - base) / (aberta.meta - base)) * 100)));
    let previsao: string | null = null;
    if (ritmo !== null && ritmo > 0 && ultimo) {
      const semanas = faltam / ritmo;
      const t = tempo(ultimo.quando) + semanas * 7 * DIA;
      // Mais de dois anos no ritmo atual não é previsão útil.
      if (Number.isFinite(t) && semanas <= 104) previsao = new Date(t).toISOString().slice(0, 10);
    }
    const noPrazo = aberta.prazo && previsao ? previsao <= aberta.prazo : aberta.prazo && ritmo !== null && ritmo <= 0 ? false : null;
    proxima = { id: aberta.id, meta: aberta.meta, faltam, progresso, prazo: aberta.prazo ?? null, ritmoSemanal: ritmo, previsao, noPrazo };
  }

  // Comemora a batida recente (até 21 dias) que ainda não foi reconhecida.
  const limite = agora.getTime() - 21 * DIA;
  const paraComemorar = batidas.filter((b) => b.cruzou && !b.reconhecida && tempo(b.quando) >= limite);
  return { atual, medidoEm: ultimo?.quando ?? null, batidas, paraComemorar, proxima, temMeta: true };
}

const milhar = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const diaMes = (iso: string) => {
  const s = soData(iso);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s;
};

/** O bloco que vai para o escritor. Vazio quando não há meta cadastrada. */
export function metasComoTexto(s: SituacaoDasMetas): string {
  if (!s.temMeta) return "";
  const linhas: string[] = [];
  const medida = s.atual !== null ? `${milhar(s.atual)} seguidores (medido na semana até ${diaMes(s.medidoEm ?? "")})` : "sem medição de seguidores";
  linhas.push(`METAS DE SEGUIDORES (cadastradas no painel; Instagram principal): hoje ${medida}.`);
  for (const b of s.paraComemorar) {
    linhas.push(`- META BATIDA E AINDA NÃO COMEMORADA: ${milhar(b.meta)} seguidores (passou na semana até ${diaMes(b.quando)}). Reconheça com naturalidade e dê o mérito ao trabalho conjunto, uma vez só.`);
  }
  const jaComemoradas = s.batidas.filter((b) => b.reconhecida && b.cruzou).slice(-2);
  for (const b of jaComemoradas) linhas.push(`- Meta de ${milhar(b.meta)} já comemorada em mensagem anterior: não repita a comemoração.`);
  if (s.proxima) {
    const p = s.proxima;
    const ritmo = p.ritmoSemanal !== null ? `ritmo de ${p.ritmoSemanal > 0 ? "+" : ""}${p.ritmoSemanal} por semana` : "ritmo ainda sem base";
    const quando = p.previsao ? `; nesse ritmo chega perto de ${diaMes(p.previsao)}` : "";
    const prazo = p.prazo ? `; prazo combinado ${diaMes(p.prazo)}${p.noPrazo === false ? " (no ritmo atual NÃO chega a tempo: diga o que muda para acelerar)" : p.noPrazo ? " (no ritmo, chega a tempo)" : ""}` : "";
    linhas.push(`- PRÓXIMA META (a cadastrada): ${milhar(p.meta)} seguidores; faltam ${milhar(p.faltam)} (${p.progresso}% do caminho); ${ritmo}${quando}${prazo}.`);
  } else if (s.batidas.length) {
    linhas.push("- Todas as metas cadastradas foram batidas e não há próxima cadastrada: NÃO invente um número; diga que a próxima meta será combinada.");
  }
  return linhas.join("\n");
}
