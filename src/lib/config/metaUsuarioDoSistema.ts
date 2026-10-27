import { supabase } from "@/integrations/supabase/client";

/**
 * Tela "Meta pelo usuário do sistema" (27/10/2026). Fala só com a função de
 * borda meta-usuario-do-sistema; o token vai no POST "guardar" e nunca volta.
 */

export interface ConferenciaPublica {
  valido: boolean;
  tipo: string | null;
  usuario_do_sistema: boolean;
  app_id: string | null;
  app_confere: boolean;
  meta_user_id: string | null;
  expira_em: string | null;
  acesso_aos_dados_expira_em: string | null;
  nunca_vence: boolean;
  escopos: string[];
  faltando: string[];
  recomendados_faltando: string[];
  aprovado: boolean;
  problemas: string[];
}

export interface LoteAplicado {
  lote_id: string;
  aplicado_em: string;
  contas: number;
  ativas: number;
  desfeitas: number;
}

export interface EstadoDoUsuarioDoSistema {
  guardado: boolean;
  meta_user_id: string | null;
  app_id: string | null;
  business_id: string | null;
  escopos: string[];
  token_expira_em: string | null;
  acesso_aos_dados_expira_em: string | null;
  guardado_em: string | null;
  conferido_em: string | null;
  lotes: LoteAplicado[];
}

export interface PaginaVista {
  page_id: string;
  nome: string;
  tem_token_de_pagina: boolean;
  instagram: { id: string; username: string | null } | null;
  origens: string[];
}

export interface ItemDaPrevia {
  external_account_id: string;
  client_id: string;
  cliente: string | null;
  plataforma: "facebook" | "instagram";
  perfil: string;
  external_id: string | null;
  encontrada: boolean;
  page_id: string | null;
  concessao_atual: { origem: string | null; vence_em: string | null; dias_para_vencer: number | null; vencida: boolean };
  pode_aplicar: boolean;
  motivo: "casa" | "nao_encontrada" | "sem_token_de_pagina" | "ja_no_usuario_do_sistema" | "sem_projeto";
}

export interface ResultadoPorConta {
  external_account_id?: string;
  aplicado?: boolean;
  desfeito?: boolean;
  motivo: string | null;
}

export class ErroDoUsuarioDoSistema extends Error {
  codigo: string;
  conferencia?: ConferenciaPublica;
  constructor(codigo: string, mensagem: string, conferencia?: ConferenciaPublica) {
    super(mensagem);
    this.name = "ErroDoUsuarioDoSistema";
    this.codigo = codigo;
    this.conferencia = conferencia;
  }
}

async function erroDaResposta(error: unknown): Promise<ErroDoUsuarioDoSistema> {
  const ctx = (error as { context?: { status?: number; clone?: () => Response; json?: () => Promise<unknown> } } | null)?.context;
  try {
    const corpo = ctx && typeof ctx.clone === "function" ? await ctx.clone().json() : ctx && typeof ctx.json === "function" ? await ctx.json() : null;
    const c = corpo && typeof corpo === "object" ? (corpo as { error?: unknown; mensagem?: unknown; conferencia?: ConferenciaPublica; guardado?: unknown }) : null;
    if (c && c.guardado === false && c.conferencia) {
      return new ErroDoUsuarioDoSistema("token_recusado", "O token não passou na conferência. Nada foi guardado.", c.conferencia);
    }
    if (c && typeof c.mensagem === "string") return new ErroDoUsuarioDoSistema(String(c.error || "erro"), c.mensagem, c.conferencia);
  } catch {
    /* sem corpo legível */
  }
  if (ctx && ctx.status === 404) return new ErroDoUsuarioDoSistema("funcao_ausente", "A função meta-usuario-do-sistema ainda não foi publicada no servidor.");
  if (ctx && ctx.status === 403) return new ErroDoUsuarioDoSistema("somente_admin", "Só o admin mexe no token do usuário do sistema.");
  return new ErroDoUsuarioDoSistema("erro", "Não foi possível falar com o servidor agora. Tente de novo.");
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("meta-usuario-do-sistema", { body: corpo });
  if (error) throw await erroDaResposta(error);
  return data as T;
}

export const lerEstado = () => chamar<{ estado: EstadoDoUsuarioDoSistema }>({ acao: "estado" });
export const guardarToken = (token: string) =>
  chamar<{ guardado: true; conferencia: ConferenciaPublica; estado: EstadoDoUsuarioDoSistema }>({ acao: "guardar", token });
export const conferirToken = () =>
  chamar<{ conferencia: ConferenciaPublica; paginas: PaginaVista[]; avisos: string[] }>({ acao: "conferir" });
export const casarContas = () =>
  chamar<{ conferencia: ConferenciaPublica; itens: ItemDaPrevia[]; resumo: { contas: number; casadas: number; ja_no_usuario_do_sistema: number; nao_encontradas: number }; avisos: string[] }>({ acao: "casar" });
export const aplicarContas = (externalAccountIds?: string[]) =>
  chamar<{ resultado: { lote_id: string; aplicadas: number; contas: ResultadoPorConta[] } }>({
    acao: "aplicar",
    ...(externalAccountIds && externalAccountIds.length ? { external_account_ids: externalAccountIds } : {}),
  });
export const desfazerLote = (loteId: string) =>
  chamar<{ resultado: { desfeitas: number; contas: ResultadoPorConta[] } }>({ acao: "desfazer", lote_id: loteId });

export const ROTULO_DO_MOTIVO: Record<string, string> = {
  casa: "Pronta para trocar",
  nao_encontrada: "O token não enxerga esta conta",
  sem_token_de_pagina: "A página não deu token (confira a atribuição na BM)",
  ja_no_usuario_do_sistema: "Já usa o usuário do sistema",
  sem_projeto: "Cliente sem projeto no painel",
  ligada_a_outra_conta: "O mesmo perfil está ligado a outro cliente",
  conta_indisponivel: "Conta arquivada ou inexistente",
  nao_casa: "A conta não bate com a página",
  item_invalido: "Item inválido",
  mudou_depois: "Mudou depois da troca; não desfeita",
  concessao_antiga_vencida: "A conexão antiga já venceu; não desfeita",
};

/**
 * Conexão vencida para o aviso do painel. Prazo nulo é "não vence" (é o caso
 * da conexão pelo usuário do sistema): nunca avisa.
 */
export function conexaoVencida(
  c: { expires_at?: string | null; data_access_expires_at?: string | null } | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!c) return false;
  return [c.expires_at, c.data_access_expires_at].some((p) => {
    if (!p) return false;
    const t = Date.parse(p);
    return Number.isFinite(t) && t <= agora.getTime();
  });
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** "vence em 8 dias", "venceu", "não vence". */
export function textoDoPrazo(venceEm: string | null, agora: Date = new Date()): string {
  if (!venceEm) return "não vence";
  const t = Date.parse(venceEm);
  if (!Number.isFinite(t)) return "não vence";
  const dias = Math.floor((t - agora.getTime()) / DIA_MS);
  const data = new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (t <= agora.getTime()) return `venceu em ${data}`;
  if (dias === 0) return `vence hoje (${data})`;
  return `vence em ${dias} ${dias === 1 ? "dia" : "dias"} (${data})`;
}
