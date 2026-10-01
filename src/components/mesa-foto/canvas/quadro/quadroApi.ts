import { useMemo } from "react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useKitDaMesa } from "@/components/mesa/kitDaMesa";
import { chamarFuncao, type ParteDaEstimativa } from "@/lib/mesa/api";
import {
  aplicarModelo,
  lerMidia,
  marcaDoQuadro,
  modeloPorId,
  type ConteudoDoQuadro,
  type FormatoDoQuadro,
  type MarcaDoQuadro,
  type MidiaDaCamada,
  type ModeloDoQuadro,
  type QuadroAnimado,
} from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";

/**
 * Chamadas e leituras do Quadro animado na tela (frente CNV, 30/09).
 * - Marca do quadro: a paleta e a logo do kit da marca aberta no topo (a
 *   marca que não é a principal nunca herda da outra: useKitDaMesa).
 * - Montar com IA: canvas_quadro_montar (conteúdo pela IA do papel motion,
 *   layout pelo código, ordem das opções pelo Jev). Nada é gravado sem a
 *   pessoa ver: a tela mostra as opções, aplica e oferece o Desfazer.
 */

/** Marca do quadro pela marca aberta (cores e logo reais; logo entra pelo código). */
export function useMarcaDoQuadro(): MarcaDoQuadro {
  const { clientName } = useMesa();
  const kit = useKitDaMesa();
  const k = kit.data || null;
  const nome = kit.marca ? kit.marca.nome : clientName;
  return useMemo(() => {
    const logo = k && k.logo_path ? lerMidia({ bucket: "mesa", caminho: k.logo_path, nome: "Logo da marca" }) : null;
    return marcaDoQuadro({ nome, paleta: k && Array.isArray(k.paleta) ? (k.paleta as { hex?: string; papel?: string }[]) : null, logo });
  }, [k, nome]);
}

export interface OpcaoDeLayout {
  modelo: ModeloDoQuadro;
  quadro: QuadroAnimado;
  /** Probabilidade do Jev (null = sem o Jev agora). */
  probabilidade: number | null;
  recomendado: boolean;
}

export interface RespostaDaMontagem {
  resposta: string;
  conteudo: Omit<ConteudoDoQuadro, "midias">;
  duracao_s: number;
  animacao: "suave" | "dinamica" | "elegante";
  opcoes: { modelo: string; probabilidade: number | null }[];
  recomendado: string;
  custo_usd: number | null;
  avisos: string[];
}

type Solto = Record<string, unknown>;
const objeto = (v: unknown): Solto => (v && typeof v === "object" && !Array.isArray(v) ? (v as Solto) : {});
const textoDe = (v: unknown) => (typeof v === "string" ? v : "");
const numeroOuNulo = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);

/** Opções de layout que vieram da função (só modelos conhecidos). */
function opcoesDe(v: unknown): { modelo: string; probabilidade: number | null }[] {
  return (Array.isArray(v) ? v : []).map((x) => ({ modelo: textoDe(objeto(x).modelo), probabilidade: numeroOuNulo(objeto(x).probabilidade) })).filter((x) => !!modeloPorId(x.modelo));
}

function normalizarResposta(d: unknown): RespostaDaMontagem {
  const o = objeto(d);
  const c = objeto(o.conteudo);
  const opcoes = opcoesDe(o.opcoes);
  const modelo = textoDe(o.modelo);
  if (!opcoes.length && modeloPorId(modelo)) opcoes.push({ modelo, probabilidade: null });
  return {
    resposta: textoDe(o.resposta),
    conteudo: { titulo: textoDe(c.titulo), subtitulo: textoDe(c.subtitulo), cta: textoDe(c.cta), selo: textoDe(c.selo), topicos: Array.isArray(c.topicos) ? c.topicos.map(textoDe).filter(Boolean).slice(0, 3) : [] },
    duracao_s: Number(o.duracao_s) > 0 ? Number(o.duracao_s) : 6,
    animacao: o.animacao === "dinamica" || o.animacao === "elegante" ? o.animacao : "suave",
    opcoes,
    recomendado: textoDe(o.recomendado) || (opcoes[0] ? opcoes[0].modelo : "titulo_forte"),
    custo_usd: numeroOuNulo(o.custo_usd),
    avisos: Array.isArray(o.avisos) ? o.avisos.map(textoDe).filter(Boolean) : [],
  };
}

/** O que o botão "Montar com IA" vai gastar (o texto do papel motion; o Jev é centavo de centavo). */
export function partesDaMontagem(modeloId: string | null | undefined): ParteDaEstimativa[] {
  return [{ modeloId, tipo: "texto", tokensEntrada: 9000, tokensSaida: 1200 }];
}

export async function montarQuadroComIA(p: { clientId: string; canvasId: string | null; pedido: string; formato: FormatoDoQuadro; midias: MidiaDaCamada[]; modeloId: string | null; conteudoAtual?: Partial<ConteudoDoQuadro> | null }): Promise<RespostaDaMontagem> {
  const corpo: Record<string, unknown> = {
    acao: "canvas_quadro_montar",
    client_id: p.clientId,
    pedido: p.pedido.trim().slice(0, 1500),
    formato: p.formato,
    midias: p.midias.map((m) => ({ nome: m.nome, tipo: /\.(mp4|mov|webm|m4v)$/i.test(m.caminho) ? "video" : "imagem" })),
  };
  if (p.canvasId) corpo.canvas_id = p.canvasId;
  if (p.modeloId) corpo.modelo_id = p.modeloId;
  if (p.conteudoAtual) corpo.conteudo_atual = p.conteudoAtual;
  return normalizarResposta(await chamarFuncao<unknown>("mesa-foto", corpo));
}

/** Preço do Jev por milhão de tokens de entrada (o mesmo de _shared/ia-motor.ts, JEV_PRECO_ENTRADA_1M). */
export const JEV_PRECO_ENTRADA_1M_NA_TELA = 0.042;

/**
 * Custo estimado do "Ordenar" (custo antes): o texto que vai ao Jev (pedido,
 * conteúdo, a descrição de cada layout) em tokens, com folga para as
 * instruções da pergunta. Arredonda para cima: a cobrança real sai do uso.
 */
export function estimativaDoOrdenar(p: { pedido: string; conteudo: Partial<ConteudoDoQuadro>; modelos: string[] }): number {
  const texto = p.pedido.slice(0, 1500) + JSON.stringify({ titulo: p.conteudo.titulo || "", subtitulo: p.conteudo.subtitulo || "", cta: p.conteudo.cta || "", selo: p.conteudo.selo || "" });
  const candidatos = Math.min(6, p.modelos.length);
  const tokens = Math.ceil(texto.length / 3) + candidatos * 120 + 2500;
  return (tokens * JEV_PRECO_ENTRADA_1M_NA_TELA) / 1e6;
}

/** Ordem das sugestões pelo Jev (sem modelo de texto). Sem Jev, volta a ordem dada. */
export async function ordenarLayoutsPeloJev(p: { clientId: string; pedido: string; conteudo: Partial<ConteudoDoQuadro>; modelos: string[]; midias: number }): Promise<{ opcoes: { modelo: string; probabilidade: number | null }[]; avisos: string[]; custo_usd: number | null }> {
  const d = objeto(await chamarFuncao<unknown>("mesa-foto", {
    acao: "canvas_quadro_ordenar",
    client_id: p.clientId,
    pedido: p.pedido.slice(0, 1500),
    conteudo: { titulo: p.conteudo.titulo || "", subtitulo: p.conteudo.subtitulo || "", cta: p.conteudo.cta || "", selo: p.conteudo.selo || "" },
    modelos: p.modelos,
    midias: p.midias,
  }));
  return { opcoes: opcoesDe(d.opcoes), avisos: Array.isArray(d.avisos) ? d.avisos.map(textoDe).filter(Boolean) : [], custo_usd: numeroOuNulo(d.custo_usd) };
}

/** As opções da montagem como quadros prontos para a prévia (a recomendada primeiro). */
export function opcoesDaMontagem(r: RespostaDaMontagem, marca: MarcaDoQuadro, midias: MidiaDaCamada[], formato: FormatoDoQuadro): OpcaoDeLayout[] {
  const conteudo: ConteudoDoQuadro = { ...r.conteudo, midias };
  return r.opcoes
    .map((o) => {
      const modelo = modeloPorId(o.modelo);
      return modelo ? { modelo, quadro: aplicarModelo(modelo.id, conteudo, marca, formato, r.duracao_s, r.animacao), probabilidade: o.probabilidade, recomendado: o.modelo === r.recomendado } : null;
    })
    .filter((x): x is OpcaoDeLayout => !!x);
}
