/**
 * "Cada nó tem inteligência e se complementa" (21/10): o que um nó criativo
 * está usando das entradas (saida.usou depois de rodar; antes, as entradas
 * ligadas), as entradas úteis que faltam (sugestão "+ Ligar Copy") e o pacote
 * que chega ao fim do fluxo (Pôr no ar). Funções puras.
 */
import { TIPOS_DE_NO, ancestraisDe, entradasDoNo, type CanvasDoLab, type NoDoLab, type TipoDeNo } from "./nos";
import type { ExecucaoDoLab, ImagemDoLab } from "./api";

export interface ItemUsado {
  rotulo: string;
  /** Pronto para entrar (estático, ou a execução da entrada ficou pronta). */
  pronto: boolean;
  no_id: string;
  /** Como a entrada foi usada (saida.usou[].como). */
  como?: string;
}

/** Nome curto de cada tipo de entrada nos chips. */
const ROTULO_DA_ENTRADA: Partial<Record<TipoDeNo, string>> = {
  midia: "Foto",
  config: "Configuração",
  gravity: "Base comum",
  imagem: "Imagem",
};

const titulo = (n: NoDoLab) => (typeof n.dados.titulo === "string" && n.dados.titulo.trim() ? n.dados.titulo.trim() : ROTULO_DA_ENTRADA[n.tipo] || TIPOS_DE_NO[n.tipo].rotulo);

/** O que o nó usa: saida.usou da última execução; antes de rodar, as entradas ligadas. */
export function usandoDoNo(canvas: CanvasDoLab, execucoes: Record<string, ExecucaoDoLab | undefined>, noId: string): ItemUsado[] {
  const ex = execucoes[noId];
  if (ex && ex.saida.usou && ex.saida.usou.length) return ex.saida.usou.map((u) => ({ rotulo: u.rotulo, pronto: true, no_id: u.no_id, ...(u.como ? { como: u.como } : {}) }));
  return entradasDoNo(canvas, noId).map((n) => {
    const def = TIPOS_DE_NO[n.tipo];
    const e = execucoes[n.id];
    return { rotulo: titulo(n), pronto: !def || !def.roda || (!!e && e.status === "pronto"), no_id: n.id };
  });
}

/** As entradas úteis de cada tipo criativo, na ordem de importância. */
export const ENTRADAS_UTEIS: Partial<Record<TipoDeNo, TipoDeNo[]>> = {
  imagem: ["marca", "midia", "config", "referencias"],
  carrossel: ["copy", "marca", "config"],
  anuncio: ["copy", "imagem", "marca", "oferta"],
  template_designer: ["marca", "midia"],
  influenciador: ["referencias", "midia"],
  ugc: ["produto", "copy", "avatar"],
  logo: ["marca", "contexto", "referencias"],
  landing: ["copy", "marca", "imagem"],
  por_no_ar: ["anuncio", "landing"],
};

/** O que falta ligar (só tipos que o nó aceita e que ainda não estão ligados), no máximo `max`. */
export function sugestoesDoNo(canvas: CanvasDoLab, noId: string, max = 2): TipoDeNo[] {
  const no = canvas.nos.find((n) => n.id === noId);
  if (!no) return [];
  const uteis = ENTRADAS_UTEIS[no.tipo] || [];
  const aceitas = TIPOS_DE_NO[no.tipo].entradas;
  const ligados = entradasDoNo(canvas, noId).map((n) => n.tipo);
  return uteis.filter((t) => !!TIPOS_DE_NO[t] && aceitas.indexOf(t) >= 0 && ligados.indexOf(t) < 0).slice(0, max);
}

export interface PecaDoPacote {
  no_id: string;
  tipo: TipoDeNo;
  rotulo: string;
  imagem: ImagemDoLab | null;
  texto: string;
  pronto: boolean;
}

const curto = (t: unknown, max = 90) => {
  const s = typeof t === "string" ? t.trim().replace(/\s+/g, " ") : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Tudo o que chega ao nó (todos os nós antes dele), com a miniatura e o texto de cada peça. */
export function pacoteDoNo(canvas: CanvasDoLab, execucoes: Record<string, ExecucaoDoLab | undefined>, noId: string): PecaDoPacote[] {
  return ancestraisDe(canvas, noId)
    .map((id) => canvas.nos.find((n) => n.id === id))
    .filter((n): n is NoDoLab => !!n && !!TIPOS_DE_NO[n.tipo])
    .filter((n) => n.tipo !== "config" && n.tipo !== "gravity")
    .map((n) => {
      const def = TIPOS_DE_NO[n.tipo];
      const e = execucoes[n.id];
      const s = e ? e.saida : null;
      const principal = typeof n.dados.principal === "number" ? n.dados.principal : s && s.escolha ? s.escolha.indice : 0;
      const midia = Array.isArray(n.dados.midias) ? (n.dados.midias as Array<Record<string, unknown>>).find((m) => m && m.tipo !== "video") : null;
      const imagem: ImagemDoLab | null =
        s && s.imagens.length ? s.imagens[Math.min(principal, s.imagens.length - 1)] : midia ? { path: String(midia.path || ""), url: String(midia.url || "") } : null;
      const textoDoNo = s ? s.texto || (s.json && typeof s.json === "object" ? curto((s.json as Record<string, unknown>).titulo || (s.json as Record<string, unknown>).promessa) : "") : "";
      const dadoEscrito = curto(n.dados.texto || n.dados.instrucao || n.dados.prompt || n.dados.objetivo || n.dados.foco || n.dados.tom);
      return {
        no_id: n.id,
        tipo: n.tipo,
        rotulo: titulo(n),
        imagem,
        texto: curto(textoDoNo) || (def.roda ? "" : dadoEscrito),
        pronto: !def.roda || (!!e && e.status === "pronto"),
      };
    });
}
