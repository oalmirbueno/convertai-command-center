import { gravarEstadoDaTela, lerEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { gravarNaSessao } from "./sessao";

/**
 * Escolhas que atravessam as etapas da Mesa Foto (02/10, dono: "a Mesa Foto
 * está muito bagunçada"): o modelo (persona ou clone) escolhido para a foto
 * com modelo, o preenchimento que o diretor deixa para a ferramenta de gerar
 * e o pedido de levar fotos ao Canvas ou ao Arsenal de prompts.
 *
 * Tudo fica no navegador, por cliente (useEstadoDaTela e sessão), sem banco:
 * Modelos grava "Usar como modelo", a Foto com modelo lê; o diretor grava o
 * preenchimento, Fotos do produto e Foto com modelo leem.
 */

export type TipoDoModelo = "persona" | "clone";

export interface ModeloEscolhido {
  tipo: TipoDoModelo;
  id: string;
  nome: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehModeloEscolhido(v: unknown): v is ModeloEscolhido {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (m.tipo === "persona" || m.tipo === "clone") && typeof m.id === "string" && UUID.test(m.id) && typeof m.nome === "string";
}

export const chaveDoModeloEscolhido = (clientId: string) => `mesa-foto:modelo-escolhido:${clientId}`;

/** O modelo escolhido para a foto com modelo (null: a IA cria uma pessoa nova pelo perfil). */
export function useModeloEscolhido(clientId: string) {
  return useEstadoDaTela<ModeloEscolhido | null>(chaveDoModeloEscolhido(clientId), null, { validar: (v) => v === null || ehModeloEscolhido(v) });
}

export function gravarModeloEscolhido(clientId: string, m: ModeloEscolhido | null) {
  gravarEstadoDaTela(chaveDoModeloEscolhido(clientId), m);
}

export function lerModeloEscolhido(clientId: string): ModeloEscolhido | null {
  const v = lerEstadoDaTela<ModeloEscolhido | null>(chaveDoModeloEscolhido(clientId), null, (x) => x === null || ehModeloEscolhido(x));
  return ehModeloEscolhido(v) ? v : null;
}

/**
 * O que o diretor (ou o Diretor do book) deixa pronto para a ferramenta de
 * gerar: a ferramenta abre já preenchida e a pessoa só confere e confirma.
 */
export interface PreenchimentoDaLinha {
  /** Ferramenta de destino. */
  objetivo: "variacoes" | "modelo";
  kitId: string | null;
  modelo: ModeloEscolhido | null;
  angulos: string[];
  cenas: string[];
  luz: string | null;
  quantidade: number | null;
  /** O pedido em palavras (vai como direção do lote). */
  texto: string;
  /** Quando foi gravado (ms): a ferramenta aplica uma vez cada preenchimento. */
  em: number;
}

const listaDeTextos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && !!x.trim()).map((x) => String(x).trim().slice(0, 80)).slice(0, 12) : []);

export function normalizarPreenchimento(v: unknown): PreenchimentoDaLinha | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (p.objetivo !== "variacoes" && p.objetivo !== "modelo") return null;
  const qtd = typeof p.quantidade === "number" && isFinite(p.quantidade) ? Math.max(1, Math.min(16, Math.round(p.quantidade))) : null;
  return {
    objetivo: p.objetivo,
    kitId: typeof p.kitId === "string" && UUID.test(p.kitId) ? p.kitId : null,
    modelo: ehModeloEscolhido(p.modelo) ? p.modelo : null,
    angulos: listaDeTextos(p.angulos),
    cenas: listaDeTextos(p.cenas),
    luz: typeof p.luz === "string" && p.luz.trim() ? p.luz.trim().slice(0, 80) : null,
    quantidade: qtd,
    texto: typeof p.texto === "string" ? p.texto.slice(0, 1500) : "",
    em: typeof p.em === "number" && isFinite(p.em) ? p.em : 0,
  };
}

export const chaveDoPreenchimento = (clientId: string) => `mesa-foto:preenchimento:${clientId}`;

export function usePreenchimentoDaLinha(clientId: string) {
  return useEstadoDaTela<PreenchimentoDaLinha | null>(chaveDoPreenchimento(clientId), null, { validar: (v) => v === null || !!normalizarPreenchimento(v) });
}

export function gravarPreenchimento(clientId: string, p: PreenchimentoDaLinha | null) {
  gravarEstadoDaTela(chaveDoPreenchimento(clientId), p ? normalizarPreenchimento(p) : null);
}

/** Direção em texto do preenchimento (vai no campo "direção" do lote). */
export function direcaoDoPreenchimento(p: PreenchimentoDaLinha): string {
  const partes: string[] = [];
  if (p.texto.trim()) partes.push(p.texto.trim());
  if (p.angulos.length) partes.push(`Ângulos: ${p.angulos.join(", ")}.`);
  if (p.cenas.length) partes.push(`Cenas: ${p.cenas.join(", ")}.`);
  if (p.luz) partes.push(`Luz: ${p.luz}.`);
  return partes.join(" ").slice(0, 1500);
}

/**
 * Levar fotos ao Canvas ou ao Arsenal (Biblioteca): grava as fotos na sessão
 * e avisa a página por um evento. Quem abre o Canvas lê a sessão
 * ("canvas-entrada"); o Arsenal lê "arsenal-entrada". Sem editar o Canvas.
 */
export const EVENTO_LEVAR_AO_CANVAS = "mesa-foto:levar-ao-canvas";
export const EVENTO_LEVAR_AO_ARSENAL = "mesa-foto:levar-ao-arsenal";
export const SESSAO_DO_CANVAS = "canvas-entrada";
export const SESSAO_DO_ARSENAL = "arsenal-entrada";

export function levarAoCanvas(clientId: string, imagemIds: string[]) {
  const ids = imagemIds.filter((id) => UUID.test(id)).slice(0, 12);
  if (!ids.length) return;
  gravarNaSessao(clientId, SESSAO_DO_CANVAS, ids);
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_LEVAR_AO_CANVAS, { detail: { clientId, imagemIds: ids } }));
  } catch {
    /* navegador sem CustomEvent: a sessão já basta */
  }
}

export function levarAoArsenal(clientId: string, imagemIds: string[], prompt?: string) {
  const ids = imagemIds.filter((id) => UUID.test(id)).slice(0, 12);
  if (!ids.length) return;
  gravarNaSessao(clientId, SESSAO_DO_ARSENAL, { imagemIds: ids, prompt: (prompt || "").slice(0, 1500) });
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_LEVAR_AO_ARSENAL, { detail: { clientId, imagemIds: ids } }));
  } catch {
    /* idem */
  }
}
