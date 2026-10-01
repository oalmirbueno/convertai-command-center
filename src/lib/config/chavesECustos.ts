import { supabase } from "@/integrations/supabase/client";
import type { EstadoDaChave, GastoDoCliente, LinhaDaChave, NumerosDoProvedor, QuadroDasChaves } from "../../../supabase/functions/chaves-admin/modulos/catalogo";

/**
 * Configurações › Chaves e custos na tela (frente CHV, 01/10/2026): chama a
 * função chaves-admin (só admin) e escreve os números de forma curta. A chave
 * só sai do navegador no "Salvar" da janela; nunca volta (só os 4 últimos).
 */

export type { EstadoDaChave, GastoDoCliente, LinhaDaChave, NumerosDoProvedor, QuadroDasChaves };
export { PROVEDORES, ROTULO_DO_GRUPO, SALDO_MINIMO_PADRAO_USD, provedorPorId } from "../../../supabase/functions/chaves-admin/modulos/catalogo";

export const CHAVE_DAS_CHAVES = ["config", "chaves", "quadro"] as const;

export const ROTULO_DO_ESTADO: Record<EstadoDaChave, string> = {
  valida: "Válida",
  invalida: "Inválida",
  sem_chave: "Sem chave",
  nao_testada: "Não testada",
};

/** Cor da bolinha e do rótulo (tokens do sistema). */
export const COR_DO_ESTADO: Record<EstadoDaChave, { ponto: string; texto: string }> = {
  valida: { ponto: "bg-primary", texto: "text-primary" },
  invalida: { ponto: "bg-destructive", texto: "text-destructive" },
  sem_chave: { ponto: "bg-muted-foreground/40", texto: "text-muted-foreground" },
  nao_testada: { ponto: "bg-warning", texto: "text-warning" },
};

/** "US$ 12,34" (centavos sempre; abaixo de 1 centavo, "US$ 0,00"). */
export function dolar(v: number | null | undefined): string {
  const n = Number(v || 0);
  const arred = Math.round(n * 100) / 100;
  const [inteiro, cent] = Math.abs(arred).toFixed(2).split(".");
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${arred < 0 ? "-" : ""}US$ ${milhar},${cent}`;
}

/** 12000 -> "12.000". */
export function inteiro(v: number): string {
  return String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Uso relevante em uma linha: "Caracteres 12.000 de 100.000". */
export function textoDoUso(uso: NumerosDoProvedor["uso"]): string | null {
  if (!uso) return null;
  const valor = (v: number) => (uso.unidade === "usd" ? dolar(v) : inteiro(v));
  if (uso.limite !== null && uso.limite !== undefined) return `${uso.rotulo} ${valor(uso.usado)} de ${valor(uso.limite)}`;
  return `${uso.rotulo} ${valor(uso.usado)}`;
}

/**
 * A linha de números embaixo do provedor, em pedaços:
 * ["Este mês US$ 50,35", "Saldo US$ 0,45", "Caracteres 12.000 de 100.000"].
 * O saldo só aparece quando o provedor informa; sem ele, "sem saldo pela API".
 */
export function numerosDaLinha(l: Pick<LinhaDaChave, "estado" | "mes_usd" | "numeros">): string[] {
  const partes = [`Este mês ${dolar(l.mes_usd)}`];
  if (l.estado === "sem_chave") return partes;
  const n = l.numeros || {};
  if (typeof n.saldo_usd === "number") partes.push(`Saldo ${dolar(n.saldo_usd)}${n.saldo_texto ? ` (${n.saldo_texto})` : ""}`);
  else if (n.saldo_texto) partes.push(`Saldo ${n.saldo_texto}`);
  else if (n.sem_saldo_pela_api) partes.push("sem saldo pela API");
  const uso = textoDoUso(n.uso);
  if (uso) partes.push(uso);
  if (n.conta) partes.push(n.conta);
  return partes;
}

/** "agora", "há 5 min", "há 2 h", "há 3 dias". */
export function haQuanto(iso: string | null | undefined, agora = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  const min = Math.max(0, Math.round((agora - t) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** Saldo abaixo do aviso do provedor (começa em US$ 10; o admin ajusta). */
export const saldoBaixo = (l: Pick<LinhaDaChave, "saldo_baixo">) => !!l.saldo_baixo;

/** Ordem: o que precisa de ação primeiro (inválida, sem chave nos essenciais), depois a ordem do catálogo. */
export function resumoDoQuadro(q: QuadroDasChaves): string {
  const validas = q.linhas.filter((l) => l.estado === "valida").length;
  const invalidas = q.linhas.filter((l) => l.estado === "invalida").length;
  const partes = [`${validas} de ${q.linhas.length} válidas`];
  if (invalidas) partes.push(invalidas === 1 ? "1 inválida" : `${invalidas} inválidas`);
  return partes.join(" · ");
}

/** "Maior: Acerbi US$ 3,20" (o cliente que mais gastou no mês). */
export function maiorCliente(lista: GastoDoCliente[]): string | null {
  const m = lista[0];
  return m && m.mes_usd > 0 ? `Maior: ${m.nome} ${dolar(m.mes_usd)}` : null;
}

/** "Carteira US$ 6,80" ou "sem carteira". */
export const textoDaCarteira = (c: GastoDoCliente) => (c.carteira_usd === null ? "sem carteira" : `carteira ${dolar(c.carteira_usd)}`);

// ------------------------------------------------------------------ servidor

export class ErroDasChaves extends Error {
  codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroDasChaves";
    this.codigo = codigo;
  }
}

async function erroDaResposta(error: unknown): Promise<ErroDasChaves> {
  const ctx = (error as { context?: { status?: number; clone?: () => Response; json?: () => Promise<unknown> } } | null)?.context;
  try {
    const corpo = ctx && typeof ctx.clone === "function" ? await ctx.clone().json() : ctx && typeof ctx.json === "function" ? await ctx.json() : null;
    const c = corpo && typeof corpo === "object" ? (corpo as { error?: unknown; mensagem?: unknown }) : null;
    if (c && typeof c.mensagem === "string") return new ErroDasChaves(String(c.error || "erro"), c.mensagem);
  } catch {
    /* sem corpo legível */
  }
  if (ctx && ctx.status === 404) return new ErroDasChaves("funcao_ausente", "A tela das chaves ainda não foi publicada no servidor (função chaves-admin).");
  if (ctx && ctx.status === 403) return new ErroDasChaves("somente_admin", "Só o admin cadastra e testa as chaves.");
  return new ErroDasChaves("erro", "Não foi possível falar com o servidor agora. Tente de novo.");
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("chaves-admin", { body: corpo });
  if (error) throw await erroDaResposta(error);
  const d = (data || {}) as { error?: unknown; mensagem?: unknown };
  if (typeof d.error === "string") throw new ErroDasChaves(d.error, typeof d.mensagem === "string" ? d.mensagem : "Não foi possível concluir.");
  return data as T;
}

export interface RespostaDoTeste {
  teste: { estado: "valida" | "invalida" | "nao_testada"; mensagem: string; numeros: NumerosDoProvedor };
  linha: LinhaDaChave | null;
  quadro: QuadroDasChaves;
}

export interface RespostaDoSalvar {
  salva: boolean;
  precisa_confirmar?: boolean;
  teste: RespostaDoTeste["teste"];
  aviso?: string | null;
  linha?: LinhaDaChave | null;
  quadro?: QuadroDasChaves;
}

export const lerChaves = () => chamar<QuadroDasChaves>({ acao: "listar" });
export const testarChave = (provedor: string) => chamar<RespostaDoTeste>({ acao: "testar", provedor });
export const salvarChave = (provedor: string, valores: Record<string, string>, confirmar = false) => chamar<RespostaDoSalvar>({ acao: "salvar", provedor, valores, confirmar });
export const removerChave = (provedor: string) => chamar<{ removida: boolean; quadro: QuadroDasChaves }>({ acao: "remover", provedor, confirmar: true });
export const salvarAlerta = (provedor: string, saldo_minimo_usd: number) => chamar<{ quadro: QuadroDasChaves }>({ acao: "alerta", provedor, saldo_minimo_usd });

/** Uso dos últimos 7 dias por agente (Modelos de IA: custo estimado por semana). */
export interface UsoDoAgente {
  agente: string;
  chamadas: number;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache: number;
  imagens: number;
  custo_usd: number;
}
export const lerUsoDaSemana = () => chamar<{ agentes: UsoDoAgente[]; desde_dias: number }>({ acao: "uso_semana" });
