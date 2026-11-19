/*
 * Central de Automações (19/11/2026): regras puras da tela /automacoes.
 * A leitura vem de public.automacoes_painel() (retrato do coletor do VPS, a cada minuto) e
 * public.automacoes_fluxo(id) (desenho e execuções de um fluxo).
 */

export type EstadoDeSaude = "ok" | "atencao" | "falha";

export interface Gatilho { tipo: string; descricao: string }
export interface UltimaExecucao { id: number; status: string; inicio: string | null; fim: string | null; modo: string | null }

export interface Fluxo {
  id: string;
  nome: string;
  grupo: string;
  ativo: boolean;
  gatilhos: Gatilho[];
  proximaExecucao: string | null;
  total24h: number;
  erros24h: number;
  ultima: UltimaExecucao | null;
  qtdNos: number;
  efeitoNoCliente: boolean;
  /** Fluxo feito para um cliente (automacao_fluxo_cliente). Sem cliente, o fluxo é da Aceleriq. */
  clientId: string | null;
  cliente: string | null;
}

export interface ItemDeSaude { chave: string; nome: string; estado: EstadoDeSaude; detalhe: string; info: Record<string, unknown> }
export interface AcaoRegistrada { fluxoId: string; fluxoNome: string; acao: "ligar" | "desligar"; quem: string; via: string; resultado: string; erro: string | null; quando: string }

export interface Painel {
  disponivel: boolean;
  coletadoEm: string | null;
  atrasada: boolean;
  podeLigar: boolean;
  fluxos: Fluxo[];
  saude: ItemDeSaude[];
  acoes: AcaoRegistrada[];
}

export interface PassoDoCaminho { no: string; estado: string; vezes: number }
export interface Execucao { id: number; modo: string | null; status: string; inicio: string | null; fim: string | null; caminho: PassoDoCaminho[]; parouEm: string | null; erro: string | null; erroNo: string | null; grande: boolean }
export interface NoDoDesenho { nome: string; tipo: string; x: number; y: number; desligado: boolean }
export interface LigacaoDoDesenho { de: string; para: string; saida: number; tipo: string }
export interface DetalheDoFluxo extends Fluxo { desenho: { nos: NoDoDesenho[]; ligacoes: LigacaoDoDesenho[] }; execucoes: Execucao[]; acoes: AcaoRegistrada[] }

export const ORDEM_DOS_GRUPOS = ["Clientes", "Comercial", "Instagram", "Grupos DK", "Apoio", "Desligado: o Hermes já faz", "Outros", "Temporários"];
export const ROTULO_DO_GRUPO: Record<string, string> = {
  Comercial: "Comercial (Rafael)",
  Apoio: "Apoio (não desligar)",
};

const t = (v: unknown, padrao = "") => (typeof v === "string" ? v : v == null ? padrao : String(v));
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function ultimaDe(v: unknown): UltimaExecucao | null {
  if (!v || typeof v !== "object") return null;
  const o = obj(v);
  return { id: n(o.id), status: t(o.status), inicio: (o.inicio as string) ?? null, fim: (o.fim as string) ?? null, modo: (o.modo as string) ?? null };
}

export function normalizarFluxo(v: unknown): Fluxo {
  const o = obj(v);
  return {
    id: t(o.id),
    nome: t(o.nome, t(o.id)),
    grupo: t(o.grupo, "Outros"),
    ativo: o.ativo === true,
    gatilhos: arr(o.gatilhos).map((g) => ({ tipo: t(obj(g).tipo), descricao: t(obj(g).descricao) })),
    proximaExecucao: (o.proxima_execucao as string) ?? null,
    total24h: n(o.total_24h),
    erros24h: n(o.erros_24h),
    ultima: ultimaDe(o.ultima_execucao),
    qtdNos: n(o.qtd_nos),
    efeitoNoCliente: o.efeito_no_cliente === true,
    clientId: typeof o.client_id === "string" && o.client_id ? o.client_id : null,
    cliente: typeof o.cliente === "string" && o.cliente ? o.cliente : null,
  };
}

function acaoDe(v: unknown): AcaoRegistrada {
  const o = obj(v);
  return {
    fluxoId: t(o.fluxo_id), fluxoNome: t(o.fluxo_nome), acao: o.acao === "ligar" ? "ligar" : "desligar",
    quem: t(o.pedido_por_nome, "?"), via: t(o.via), resultado: t(o.resultado), erro: (o.erro as string) ?? null, quando: t(o.created_at),
  };
}

export function normalizarPainel(v: unknown): Painel {
  if (!v || typeof v !== "object") return { disponivel: false, coletadoEm: null, atrasada: false, podeLigar: false, fluxos: [], saude: [], acoes: [] };
  const o = obj(v);
  const coleta = o.coleta ? obj(o.coleta) : null;
  return {
    disponivel: Boolean(coleta),
    coletadoEm: coleta ? t(coleta.coletado_em) || null : null,
    atrasada: coleta ? coleta.atrasada === true : false,
    podeLigar: o.pode_ligar === true,
    fluxos: arr(o.fluxos).map(normalizarFluxo).filter((f) => f.id),
    saude: arr(o.saude).map((s) => {
      const x = obj(s);
      const estado = (["ok", "atencao", "falha"].includes(t(x.estado)) ? x.estado : "atencao") as EstadoDeSaude;
      return { chave: t(x.chave), nome: t(x.nome), estado, detalhe: t(x.detalhe), info: obj(x.info) };
    }),
    acoes: arr(o.acoes).map(acaoDe),
  };
}

export function normalizarDetalhe(v: unknown): DetalheDoFluxo | null {
  if (!v || typeof v !== "object") return null;
  const o = obj(v);
  const d = obj(o.desenho);
  return {
    ...normalizarFluxo(o),
    desenho: {
      nos: arr(d.nos).map((x) => { const k = obj(x); return { nome: t(k.nome), tipo: t(k.tipo), x: n(k.x), y: n(k.y), desligado: k.desligado === true }; }),
      ligacoes: arr(d.ligacoes).map((x) => { const k = obj(x); return { de: t(k.de), para: t(k.para), saida: n(k.saida), tipo: t(k.tipo) }; }),
    },
    execucoes: arr(o.execucoes).map((x) => {
      const k = obj(x);
      return {
        id: n(k.id), modo: (k.modo as string) ?? null, status: t(k.status), inicio: (k.inicio as string) ?? null, fim: (k.fim as string) ?? null,
        caminho: arr(k.caminho).map((p) => ({ no: t(obj(p).no), estado: t(obj(p).estado), vezes: n(obj(p).vezes) || 1 })),
        parouEm: (k.parou_em as string) ?? null, erro: (k.erro as string) ?? null, erroNo: (k.erro_no as string) ?? null, grande: k.grande === true,
      };
    }),
    acoes: arr(o.acoes).map(acaoDe),
  };
}

export type Filtro = "todos" | "ligados" | "desligados" | "com_erro";

export function agruparFluxos(fluxos: Fluxo[], op: { filtro?: Filtro; busca?: string } = {}) {
  const busca = (op.busca ?? "").trim().toLowerCase();
  const filtrados = fluxos.filter((f) => {
    if (op.filtro === "ligados" && !f.ativo) return false;
    if (op.filtro === "desligados" && f.ativo) return false;
    if (op.filtro === "com_erro" && f.erros24h === 0) return false;
    if (busca && !`${f.nome} ${f.grupo} ${f.id}`.toLowerCase().includes(busca)) return false;
    return true;
  });
  const mapa = new Map<string, Fluxo[]>();
  for (const f of filtrados) mapa.set(f.grupo, [...(mapa.get(f.grupo) ?? []), f]);
  const pos = (g: string) => { const i = ORDEM_DOS_GRUPOS.indexOf(g); return i < 0 ? ORDEM_DOS_GRUPOS.length - 2 : i; };
  return [...mapa.entries()]
    .sort((a, b) => pos(a[0]) - pos(b[0]) || a[0].localeCompare(b[0]))
    .map(([grupo, lista]) => ({
      grupo,
      rotulo: ROTULO_DO_GRUPO[grupo] ?? grupo,
      ligados: lista.filter((f) => f.ativo).length,
      fluxos: [...lista].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome)),
    }));
}

export function numerosDoPainel(p: Painel) {
  return {
    total: p.fluxos.length,
    ligados: p.fluxos.filter((f) => f.ativo).length,
    rodadas24h: p.fluxos.reduce((s, f) => s + f.total24h, 0),
    erros24h: p.fluxos.reduce((s, f) => s + f.erros24h, 0),
    saudeOk: p.saude.filter((s) => s.estado === "ok").length,
    saudeTotal: p.saude.length,
    piorSaude: p.saude.find((s) => s.estado === "falha") ?? p.saude.find((s) => s.estado === "atencao") ?? null,
  };
}

/** "Clientes: aviso de post no ar" → "Aviso de post no ar" (o grupo já está no título da seção). */
export function nomeCurto(f: { nome: string; grupo: string }): string {
  const prefixos = [`${f.grupo}: `, `${f.grupo} · `, "TMP: "];
  for (const p of prefixos) {
    if (f.nome.startsWith(p)) {
      const resto = f.nome.slice(p.length);
      return resto.charAt(0).toUpperCase() + resto.slice(1);
    }
  }
  return f.nome;
}

// ---------------------------------------------------------------- desenho
export const NO_LARGURA = 168;
export const NO_ALTURA = 44;
const MARGEM = 24;

export function desenharFluxo(d: { nos: NoDoDesenho[]; ligacoes: LigacaoDoDesenho[] }) {
  if (!d.nos.length) return { nos: [], ligacoes: [], largura: 0, altura: 0 };
  const minX = Math.min(...d.nos.map((x) => x.x));
  const minY = Math.min(...d.nos.map((x) => x.y));
  const nos = d.nos.map((x) => ({ ...x, x: x.x - minX + MARGEM, y: x.y - minY + MARGEM }));
  const porNome = new Map(nos.map((x) => [x.nome, x]));
  const ligacoes = d.ligacoes
    .filter((l) => porNome.has(l.de) && porNome.has(l.para))
    .map((l) => {
      const a = porNome.get(l.de)!;
      const b = porNome.get(l.para)!;
      const x1 = a.x + NO_LARGURA;
      const y1 = a.y + NO_ALTURA / 2;
      const x2 = b.x;
      const y2 = b.y + NO_ALTURA / 2;
      const meio = Math.max(40, Math.abs(x2 - x1) / 2);
      return { ...l, caminho: `M${x1} ${y1} C${x1 + meio} ${y1}, ${x2 - meio} ${y2}, ${x2} ${y2}` };
    });
  const largura = Math.max(...nos.map((x) => x.x)) + NO_LARGURA + MARGEM;
  const altura = Math.max(...nos.map((x) => x.y)) + NO_ALTURA + MARGEM;
  return { nos, ligacoes, largura, altura };
}

export function caminhoPorNo(caminho: PassoDoCaminho[]) {
  const m = new Map<string, { estado: string; ordem: number; vezes: number }>();
  caminho.forEach((p, i) => {
    const antes = m.get(p.no);
    m.set(p.no, { estado: p.estado === "error" || antes?.estado === "error" ? "error" : p.estado, ordem: antes?.ordem ?? i + 1, vezes: (antes?.vezes ?? 0) + p.vezes });
  });
  return m;
}

export function tomDoStatus(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === "success") return "success";
  if (["error", "crashed", "failed"].includes(status)) return "danger";
  if (["running", "waiting", "new", "canceled"].includes(status)) return "warning";
  return "neutral";
}

export const ROTULO_DO_STATUS: Record<string, string> = {
  success: "ok", error: "erro", crashed: "caiu", canceled: "cancelada", running: "rodando", waiting: "esperando", new: "na fila",
};

export const ROTULO_DO_MODO: Record<string, string> = {
  trigger: "agenda", webhook: "webhook", integrated: "chamado por outro fluxo", manual: "à mão", cli: "pelo servidor", error: "falha de outro fluxo", retry: "nova tentativa",
};

export function haQuanto(iso: string | null, agoraMs: number): string {
  if (!iso) return "";
  const ms = agoraMs - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 0) return emQuanto(iso, agoraMs);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} d`;
}

export function emQuanto(iso: string | null, agoraMs: number): string {
  if (!iso) return "";
  const min = Math.round((new Date(iso).getTime() - agoraMs) / 60000);
  if (!Number.isFinite(min)) return "";
  if (min <= 0) return "agora";
  if (min < 60) return `em ${min} min`;
  const d = new Date(iso);
  const hoje = new Date(agoraMs);
  const hh = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoje.toDateString()) return `hoje ${hh}`;
  return `${d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")} ${hh}`;
}

// ---------------------------------------------------------------- pastas
export interface Pasta {
  chave: string;
  titulo: string;
  tipo: "aceleriq" | "cliente";
  clientId: string | null;
  fluxos: Fluxo[];
  ligados: number;
  erros24h: number;
  rodadas24h: number;
  ultimaEm: string | null;
  falaComCliente: boolean;
}

function montarPasta(chave: string, titulo: string, tipo: Pasta["tipo"], clientId: string | null, fluxos: Fluxo[]): Pasta {
  const ordenados = [...fluxos].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));
  const ultimas = fluxos.map((f) => f.ultima?.inicio).filter((x): x is string => Boolean(x)).sort();
  return {
    chave, titulo, tipo, clientId, fluxos: ordenados,
    ligados: fluxos.filter((f) => f.ativo).length,
    erros24h: fluxos.reduce((n, f) => n + f.erros24h, 0),
    rodadas24h: fluxos.reduce((n, f) => n + f.total24h, 0),
    ultimaEm: ultimas.at(-1) ?? null,
    falaComCliente: fluxos.some((f) => f.efeitoNoCliente && f.ativo),
  };
}

/** Pastas da Aceleriq: os grupos do n8n, só com os fluxos que não são de um cliente. */
export function pastasDaAceleriq(fluxos: Fluxo[]): Pasta[] {
  return agruparFluxos(fluxos.filter((f) => !f.clientId)).map((g) => montarPasta(`aceleriq:${g.grupo}`, g.rotulo, "aceleriq", null, g.fluxos));
}

/** Uma pasta por cliente, em ordem alfabética. */
export function pastasDeClientes(fluxos: Fluxo[]): Pasta[] {
  const mapa = new Map<string, Fluxo[]>();
  for (const f of fluxos) if (f.clientId) mapa.set(f.clientId, [...(mapa.get(f.clientId) ?? []), f]);
  return [...mapa.entries()]
    .map(([id, lista]) => montarPasta(`cliente:${id}`, lista[0].cliente ?? "Cliente", "cliente", id, lista))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
}

export function fluxosDoCliente(fluxos: Fluxo[], clientId: string): Fluxo[] {
  return fluxos.filter((f) => f.clientId === clientId).sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));
}
