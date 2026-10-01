import { supabase } from "@/integrations/supabase/client";

/**
 * Máquinas do Aceleriq Motores na tela (frente SUP, 01/10/2026): Configurações ›
 * Estado dos motores, só para o admin. Lê tudo numa RPC (motores_admin_painel),
 * gera o código de pareamento pela função motores-parear e muda motores,
 * remove máquina e revoga código pelas RPCs motores_admin_*.
 */

export type IdDoMotorNaMaquina = "render" | "codigo" | "navegador";
export const MOTORES_DA_MAQUINA: IdDoMotorNaMaquina[] = ["render", "codigo", "navegador"];
export const NOME_CURTO_DO_MOTOR: Record<IdDoMotorNaMaquina, string> = { render: "Render", codigo: "Código", navegador: "Navegador" };
export const NOME_DO_MOTOR_NA_MAQUINA: Record<IdDoMotorNaMaquina, string> = {
  render: "Render (Motion e Edição)",
  codigo: "Motor de código (Site)",
  navegador: "Navegador do agente",
};

export interface EstadoDoMotorNaMaquina {
  situacao?: string;
  ocupado?: boolean;
  trabalho?: string | null;
  reinicios?: number;
  ultimo_erro?: string | null;
  versao_do_worker?: string | null;
}

export interface MaquinaDosMotores {
  id: string;
  nome: string;
  hostname: string | null;
  sistema: string;
  motores: IdDoMotorNaMaquina[];
  estado: {
    motores?: Partial<Record<IdDoMotorNaMaquina, EstadoDoMotorNaMaquina>>;
    pausado?: boolean;
    desligado?: boolean;
    atualizacao?: { etapa?: string; versao?: string | null; erro?: string | null } | null;
    chaves_do_painel?: string;
  };
  versao: string | null;
  ultimo_sinal: string | null;
  origem: string;
  criada_em: string;
  criada_por_nome: string | null;
}

export interface CodigoAberto {
  id: string;
  nome_sugerido: string | null;
  motores: IdDoMotorNaMaquina[];
  criado_em: string;
  expira_em: string;
  criado_por_nome: string | null;
}

export interface PainelDasMaquinas {
  maquinas: MaquinaDosMotores[];
  codigos: CodigoAberto[];
  versao: { versao: string; publicada_em: string | null } | null;
  auditoria: Array<{ em: string; acao: string; maquina_id: string | null; detalhes: Record<string, unknown>; ator_nome: string | null }>;
}

export interface CodigoGerado {
  codigo: string;
  id: string;
  expira_em: string;
  motores: IdDoMotorNaMaquina[];
}

export const CHAVE_DAS_MAQUINAS = ["config", "motores", "maquinas"] as const;

/** Sem sinal há mais que isso: a máquina está desligada (o supervisor bate a cada 30 s). */
export const SINAL_VELHO_MS = 3 * 60_000;

type RespostaDaRpc = { data: unknown; error: { message?: string } | null };
const rpc = async (nome: string, args?: Record<string, unknown>): Promise<RespostaDaRpc> =>
  ((await (supabase as unknown as { rpc: (n: string, a?: Record<string, unknown>) => Promise<RespostaDaRpc | undefined> }).rpc(nome, args)) || { data: null, error: null });

function traduzir(e: { message?: string } | null, padrao: string): string {
  const m = String(e?.message || "");
  if (/MOTORES_SO_ADMIN/.test(m)) return "Só o admin cuida das máquinas dos motores.";
  if (/MOTORES_MAQUINA_NAO_ENCONTRADA/.test(m)) return "Esta máquina já foi removida.";
  if (/MOTORES_CODIGO_NAO_ENCONTRADO/.test(m)) return "Este código já foi usado, venceu ou foi revogado.";
  if (/function .* does not exist|PGRST202/.test(m)) return "As máquinas dos motores ainda não foram publicadas no banco (migration 20260930326000).";
  return padrao;
}

const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export async function lerMaquinas(): Promise<PainelDasMaquinas> {
  const { data, error } = await rpc("motores_admin_painel");
  if (error) throw new Error(traduzir(error, "Não foi possível ler as máquinas agora."));
  const d = (data || {}) as Partial<PainelDasMaquinas>;
  return {
    maquinas: lista<MaquinaDosMotores>(d.maquinas).map((m) => ({ ...m, motores: lista<IdDoMotorNaMaquina>(m.motores), estado: m.estado && typeof m.estado === "object" ? m.estado : {} })),
    codigos: lista<CodigoAberto>(d.codigos),
    versao: d.versao && typeof d.versao === "object" && (d.versao as { versao?: string }).versao ? (d.versao as PainelDasMaquinas["versao"]) : null,
    auditoria: lista(d.auditoria),
  };
}

export async function gerarCodigoDePareamento(nome: string | null, motores: IdDoMotorNaMaquina[]): Promise<CodigoGerado> {
  const { data, error } = await supabase.functions.invoke("motores-parear", { body: { acao: "gerar", nome: nome || null, motores } });
  const d = (data || {}) as Partial<CodigoGerado> & { mensagem?: string; error?: string };
  if (error || d.error || !d.codigo) {
    let msg = d.mensagem;
    const ctx = (error as { context?: { clone?: () => Response; status?: number } } | null)?.context;
    try {
      if (!msg && ctx && typeof ctx.clone === "function") msg = ((await ctx.clone().json()) as { mensagem?: string }).mensagem;
    } catch {
      /* sem corpo */
    }
    if (!msg && ctx && ctx.status === 404) msg = "A função de pareamento ainda não foi publicada (motores-parear).";
    throw new Error(msg || "Não foi possível gerar o código agora.");
  }
  return { codigo: String(d.codigo), id: String(d.id), expira_em: String(d.expira_em), motores: lista<IdDoMotorNaMaquina>(d.motores) };
}

export async function revogarCodigo(id: string): Promise<void> {
  const { error } = await rpc("motores_admin_pareamento_revogar", { _id: id });
  if (error) throw new Error(traduzir(error, "Não foi possível revogar o código."));
}

export async function trocarMotoresDaMaquina(id: string, motores: IdDoMotorNaMaquina[]): Promise<void> {
  const { error } = await rpc("motores_admin_maquina_motores", { _maquina: id, _motores: motores });
  if (error) throw new Error(traduzir(error, "Não foi possível mudar os motores desta máquina."));
}

export async function removerMaquina(id: string): Promise<void> {
  const { error } = await rpc("motores_admin_maquina_remover", { _maquina: id });
  if (error) throw new Error(traduzir(error, "Não foi possível remover a máquina."));
}

export type SituacaoDaMaquina = "ok" | "atencao" | "parado";

export interface LeituraDaMaquina {
  situacao: SituacaoDaMaquina;
  rotulo: string;
  resumo: string;
  desatualizada: boolean;
}

const SITUACAO_DO_MOTOR: Record<string, string> = {
  ligado: "ligado",
  trabalhando: "trabalhando",
  subindo: "subindo",
  reiniciando: "reiniciando",
  parando: "terminando para parar",
  falhando: "caindo ao subir",
  pausado: "pausado",
  fora: "não roda aqui",
  parado: "parado",
};

export const textoDoMotor = (s?: string) => (s ? SITUACAO_DO_MOTOR[s] || s : "sem notícia");

export function tempoDesde(iso: string | null, agora: number): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000));
  if (s < 60) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/** A linha da máquina: situação (ponto e rótulo), o resumo e se está desatualizada. */
export function lerMaquina(m: MaquinaDosMotores, agora: number, versaoPublicada: string | null): LeituraDaMaquina {
  const desatualizada = !!versaoPublicada && !!m.versao && m.versao !== versaoPublicada;
  const sinal = m.ultimo_sinal ? agora - Date.parse(m.ultimo_sinal) : Infinity;
  const motores = m.motores.map((id) => ({ id, s: m.estado.motores?.[id]?.situacao }));
  const base = `${m.hostname && m.hostname !== m.nome ? `${m.hostname} · ` : ""}${m.versao ? `versão ${m.versao}` : "versão do clone"} · sinal ${tempoDesde(m.ultimo_sinal, agora)}`;
  if (!m.ultimo_sinal) return { situacao: "parado", rotulo: "Sem sinal", resumo: `${base} · ainda não ligou`, desatualizada };
  if (m.estado.desligado || sinal > SINAL_VELHO_MS) return { situacao: "parado", rotulo: "Desligada", resumo: base, desatualizada };
  const falhando = motores.find((x) => x.s === "falhando" || x.s === "parado");
  if (falhando) return { situacao: "parado", rotulo: "Parado", resumo: `${base} · ${NOME_CURTO_DO_MOTOR[falhando.id].toLowerCase()} ${textoDoMotor(falhando.s)}`, desatualizada };
  if (m.estado.pausado) return { situacao: "atencao", rotulo: "Pausada", resumo: base, desatualizada };
  const instavel = motores.find((x) => x.s === "reiniciando" || x.s === "subindo" || x.s === "parando");
  if (instavel) return { situacao: "atencao", rotulo: "Atenção", resumo: `${base} · ${NOME_CURTO_DO_MOTOR[instavel.id].toLowerCase()} ${textoDoMotor(instavel.s)}`, desatualizada };
  if (m.estado.atualizacao?.etapa === "falhou") return { situacao: "atencao", rotulo: "Atenção", resumo: `${base} · a atualização falhou`, desatualizada };
  if (!m.motores.length) return { situacao: "atencao", rotulo: "Sem motor", resumo: `${base} · nenhum motor marcado`, desatualizada };
  const trabalhando = motores.filter((x) => x.s === "trabalhando").map((x) => NOME_CURTO_DO_MOTOR[x.id].toLowerCase());
  return { situacao: "ok", rotulo: "Ligada", resumo: trabalhando.length ? `${base} · trabalhando: ${trabalhando.join(", ")}` : base, desatualizada };
}

/** Segundos que faltam para o código vencer (0 = venceu). */
export const segundosAte = (iso: string, agora: number) => Math.max(0, Math.floor((Date.parse(iso) - agora) / 1000));
export const relogio = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
