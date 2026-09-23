import { useEffect, useRef, useState } from "react";
import { enviarParaAprovacao, type ResultadoDoEnvio } from "@/lib/mesa/api";

/**
 * Pequenas utilidades do Estúdio: estado que sobrevive à troca de aba da Mesa
 * (sessionStorage, sempre dentro de try/catch porque o Safari em modo privado
 * recusa gravar), cópia de texto com reserva para navegador antigo, o corpo
 * do "preparar" e o envio de uma arte para aprovação.
 */

/** Quantidades de lâminas que a tela oferece antes da direção (Automático = o diretor decide). */
export const QUANTIDADES_DE_LAMINAS = [3, 4, 5, 6, 7, 8];

export interface EscolhasDoPreparo {
  /** "roteiro": direção do roteiro do estrategista, sem custo. "diretor": diretor de arte, com custo. */
  modo: "roteiro" | "diretor";
  /** Quantidade de lâminas; null = automático (o diretor decide pelo conteúdo). */
  laminas: number | null;
  /** Carrossel contínuo decidido no começo (a cena atravessa as lâminas). */
  continuo: boolean;
  /** Pedido livre para o diretor (ex.: use fotos reais, capa centralizada). */
  pedido: string;
}

/**
 * Corpo da ação "preparar" do estudio-arte. Post de uma lâmina só não leva
 * quantidade nem contínuo. Quantidade e pedido só valem para o diretor: no
 * roteiro, as lâminas são as do estrategista (e um pedido viraria diretor, com custo).
 */
export function corpoDoPreparar(
  taskId: string,
  e: EscolhasDoPreparo,
  extra: { postUnico: boolean; modeloImagemId?: string; qualidade?: string; trabalhoId?: string } = { postUnico: false },
): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "preparar", task_id: taskId, modo: e.modo };
  if (extra.modeloImagemId) corpo.modelo_imagem_id = extra.modeloImagemId;
  if (extra.qualidade) corpo.qualidade = extra.qualidade;
  if (extra.trabalhoId) corpo.trabalho_id = extra.trabalhoId;
  if (!extra.postUnico) {
    corpo.carrossel_infinito = !!e.continuo;
    const n = Number(e.laminas);
    if (e.modo === "diretor" && e.laminas !== null && Number.isInteger(n) && n >= 1 && n <= 10) corpo.laminas = n;
  }
  const pedido = (e.pedido || "").trim();
  if (e.modo === "diretor" && pedido) corpo.instrucao = pedido.slice(0, 2000);
  return corpo;
}

/**
 * Envia uma arte entregue para aprovação (mesmo caminho da aba Entrega) e
 * confere o resultado dela: a RPC responde 200 mesmo quando a arte não foi.
 */
export async function enviarUmParaAprovacao(trabalhoId: string): Promise<ResultadoDoEnvio> {
  const resultados = await enviarParaAprovacao([trabalhoId]);
  const r = resultados[0];
  if (!r) throw new Error("O envio não voltou resposta. Confira na aba Entrega.");
  if (!r.ok) throw new Error(r.erro || "Não foi possível enviar para aprovação.");
  return r;
}

function lerDaSessao<T>(chave: string, inicial: T): T {
  try {
    const bruto = window.sessionStorage.getItem(chave);
    if (bruto === null) return inicial;
    const valor = JSON.parse(bruto);
    return valor === null || valor === undefined ? inicial : (valor as T);
  } catch {
    return inicial;
  }
}

function gravarNaSessao(chave: string, valor: unknown) {
  try {
    window.sessionStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem sessionStorage: o estado vale só enquanto a tela estiver aberta */
  }
}

/**
 * useState que também guarda o valor na sessão do navegador, pela chave.
 * Trocar de aba da Mesa desmonta o Estúdio; na volta, o valor é relido.
 */
export function useEstadoGuardado<T>(chave: string, inicial: T): [T, (v: T | ((anterior: T) => T)) => void] {
  const [valor, setValor] = useState<T>(() => lerDaSessao(chave, inicial));
  const chaveAtual = useRef(chave);
  useEffect(() => {
    if (chaveAtual.current !== chave) {
      chaveAtual.current = chave;
      setValor(lerDaSessao(chave, inicial));
    }
    // a chave muda quando muda o item; o inicial é só o padrão
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  const definir = (v: T | ((anterior: T) => T)) => {
    setValor((anterior) => {
      const novo = typeof v === "function" ? (v as (a: T) => T)(anterior) : v;
      gravarNaSessao(chaveAtual.current, novo);
      return novo;
    });
  };
  return [valor, definir];
}

/** Copia texto: API moderna quando existe, senão textarea escondido e execCommand. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai na reserva */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, texto.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Hashtags limpas, cada uma com um # só. */
export function normalizarHashtags(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  const saida: string[] = [];
  for (const bruto of lista) {
    let t = String(bruto || "").trim();
    while (t.charAt(0) === "#") t = t.slice(1);
    t = t.split(" ").join("");
    if (t && saida.indexOf(`#${t}`) < 0) saida.push(`#${t}`);
  }
  return saida;
}

/** Legenda pronta para colar: legenda, uma linha em branco e as hashtags. */
export function legendaParaCopiar(legenda: string, hashtags: string[]): string {
  const corpo = (legenda || "").trim();
  const tags = hashtags.join(" ").trim();
  if (!tags) return corpo;
  if (!corpo) return tags;
  return `${corpo}\n\n${tags}`;
}

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const limitar = (v: number) => Math.max(0, Math.min(1, v));
const tres = (v: number) => Math.round(v * 1000) / 1000;

/** Retângulo normalizado (x0 < x1, y0 < y1), dentro de 0 a 1, com 3 casas. */
export function normalizarArea(a: Area): Area {
  return {
    x0: tres(limitar(Math.min(a.x0, a.x1))),
    y0: tres(limitar(Math.min(a.y0, a.y1))),
    x1: tres(limitar(Math.max(a.x0, a.x1))),
    y1: tres(limitar(Math.max(a.y0, a.y1))),
  };
}
