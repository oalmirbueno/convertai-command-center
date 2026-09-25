import { chamarFuncao, ErroDaMesa } from "@/lib/mesa/api";

/**
 * Ferramentas profissionais de imagem (26/09): Ampliar (upscale fiel ou
 * criativo, 2x ou 4x) e Tirar fundo (pro), pela função mesa-foto
 * (ferramentas-pro.ts), que chama a fal.ai no servidor. O navegador nunca vê
 * chave: só manda a ordem, recebe a estimativa, o andamento e a derivada.
 *
 * Pedido que passa do prazo de uma chamada volta com uma ficha; aqui ele é
 * retomado sozinho (sem cobrar de novo) até ficar pronto ou até o limite.
 */

export type ModoDoUpscale = "fiel" | "criativo";
export type ConteudoDaImagem = "foto" | "texto" | "arte";
export type ChaveDaOpcao = "upscale_2x_fiel" | "upscale_4x_fiel" | "upscale_2x_criativo" | "upscale_4x_criativo" | "remover_fundo";

export interface OpcaoDaFerramenta {
  chave: ChaveDaOpcao;
  tarefa: "upscale" | "remover_fundo";
  rotuloDoMotor: string;
  fator: number | null;
  fatorEfetivo: number | null;
  modo: ModoDoUpscale | null;
  saida: { largura: number; altura: number } | null;
  estimativaUsd: number | null;
  avisos: string[];
  impedimento: { codigo: string; mensagem: string } | null;
  jaExiste: string | null;
}

export interface EstimativaDasFerramentas {
  configurada: boolean;
  segredo: string;
  provedor: string;
  aviso: string | null;
  imagem: { id: string; largura: number; altura: number } | null;
  saldoUsd: number | null;
  opcoes: OpcaoDaFerramenta[];
}

export interface ResultadoDaFerramenta {
  situacao: "pronto";
  /** Linha do acervo (cliente_imagens) com url assinada. */
  imagem: { id: string; storage_bucket: string; storage_path: string; nome: string; tags: string[]; largura: number | null; altura: number | null; url: string | null; [k: string]: unknown };
  url: string | null;
  custoUsd: number;
  saldoUsd: number | null;
  jaExistia: boolean;
  cobrado: boolean;
  avisos: string[];
}

export type EstadoDoAndamento = { etapa: "enviando" | "na_fila" | "processando" | "retomando"; posicao: number | null; tentativa: number };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const dim = (v: any): { largura: number; altura: number } | null =>
  v && num(v.largura) !== null && num(v.altura) !== null ? { largura: Number(v.largura), altura: Number(v.altura) } : null;

export function normalizarOpcao(o: any): OpcaoDaFerramenta | null {
  if (!o || typeof o !== "object" || typeof o.chave !== "string") return null;
  const chave = o.chave as ChaveDaOpcao;
  return {
    chave,
    tarefa: chave === "remover_fundo" ? "remover_fundo" : "upscale",
    rotuloDoMotor: o.motor && typeof o.motor.rotulo === "string" ? o.motor.rotulo : "",
    fator: num(o.fator),
    fatorEfetivo: num(o.fator_efetivo),
    modo: o.modo === "fiel" || o.modo === "criativo" ? o.modo : null,
    saida: dim(o.saida),
    estimativaUsd: num(o.estimativa_usd),
    avisos: textos(o.avisos),
    impedimento: o.impedimento && typeof o.impedimento === "object"
      ? { codigo: String(o.impedimento.codigo || "indisponivel"), mensagem: String(o.impedimento.mensagem || "Indisponível para esta foto.") }
      : null,
    jaExiste: typeof o.ja_existe === "string" ? o.ja_existe : null,
  };
}

export function normalizarEstimativa(d: any): EstimativaDasFerramentas {
  const opcoes: OpcaoDaFerramenta[] = [];
  const brutas = d && Array.isArray(d.opcoes) ? d.opcoes : [];
  for (const o of brutas) {
    const n = normalizarOpcao(o);
    if (n) opcoes.push(n);
  }
  return {
    configurada: !!(d && d.configurada),
    segredo: d && typeof d.segredo === "string" ? d.segredo : "FAL_KEY",
    provedor: d && typeof d.provedor === "string" ? d.provedor : "fal.ai",
    aviso: d && typeof d.aviso === "string" ? d.aviso : null,
    imagem: d && d.imagem && typeof d.imagem.id === "string" && dim(d.imagem) ? { id: d.imagem.id, largura: Number(d.imagem.largura), altura: Number(d.imagem.altura) } : null,
    saldoUsd: d ? num(d.saldo_usd) : null,
    opcoes,
  };
}

export function normalizarResultado(d: any): ResultadoDaFerramenta {
  const img = d && d.imagem && typeof d.imagem === "object" ? d.imagem : null;
  if (!img || typeof img.id !== "string") throw new Error("A imagem pronta não voltou. Tente de novo.");
  return {
    situacao: "pronto",
    imagem: { ...img, tags: textos(img.tags), url: typeof img.url === "string" ? img.url : null },
    url: typeof d.url === "string" ? d.url : null,
    custoUsd: num(d.custo_usd) || 0,
    saldoUsd: num(d.saldo_usd),
    jaExistia: !!d.ja_existia,
    cobrado: !!d.cobrado,
    avisos: textos(d.avisos),
  };
}

/** Sem a chave da fal.ai no servidor: a tela mostra o aviso em vez de erro genérico. */
export const ehSemChave = (err: unknown) => err instanceof ErroDaMesa && err.codigo === "ferramenta_sem_chave";

/** Erros depois do envio que podem ser retomados pela ficha sem cobrar de novo. */
export const ERROS_RETOMAVEIS = ["resultado_indisponivel", "provedor_inalcancavel", "uso_nao_registrado", "gravacao_falhou", "carteira_indisponivel", "provedor_ocupado"];

/** Quantas vezes a tela retoma um pedido lento (cada retomada espera até ~200 s no servidor). */
export const MAX_RETOMADAS = 3;

export async function estimarFerramentas(clientId: string, imagemId: string): Promise<EstimativaDasFerramentas> {
  return normalizarEstimativa(await chamarFuncao("mesa-foto", { acao: "ferramentas_estimar", client_id: clientId, imagem_id: imagemId }));
}

export function retomarFerramenta(clientId: string, ficha: string): Promise<any> {
  return chamarFuncao("mesa-foto", { acao: "ferramenta_retomar", client_id: clientId, ficha });
}

/** Roda a ação e retoma pela ficha enquanto o provedor ainda trabalha (ou se a gravação falhou depois de pronto). */
async function rodarAteFicarPronto(corpo: Record<string, unknown>, aoAndar?: (e: EstadoDoAndamento) => void): Promise<ResultadoDaFerramenta> {
  const clientId = String(corpo.client_id || "");
  if (aoAndar) aoAndar({ etapa: "enviando", posicao: null, tentativa: 0 });
  let resposta: any;
  let ficha: string | null = null;
  try {
    resposta = await chamarFuncao("mesa-foto", corpo);
  } catch (e) {
    const f = e instanceof ErroDaMesa && typeof e.detalhes.ficha === "string" ? String(e.detalhes.ficha) : null;
    if (!f || ERROS_RETOMAVEIS.indexOf((e as ErroDaMesa).codigo) < 0) throw e;
    ficha = f;
    resposta = { situacao: "em_andamento", ficha: f, andamento: "retomando" };
  }
  for (let tentativa = 1; resposta && resposta.situacao === "em_andamento"; tentativa++) {
    if (tentativa > MAX_RETOMADAS) {
      throw new ErroDaMesa("ferramenta_demorou", "O provedor ainda não terminou. Tente de novo em alguns minutos: o pedido não será cobrado duas vezes.", { ficha: resposta.ficha || ficha });
    }
    ficha = typeof resposta.ficha === "string" ? resposta.ficha : ficha;
    if (!ficha) throw new Error("O pedido ficou sem ficha para acompanhar. Tente de novo.");
    if (aoAndar) {
      const etapa = resposta.andamento === "processando" ? "processando" : resposta.andamento === "retomando" ? "retomando" : "na_fila";
      aoAndar({ etapa, posicao: num(resposta.posicao), tentativa });
    }
    try {
      resposta = await retomarFerramenta(clientId, ficha);
    } catch (e) {
      if (!(e instanceof ErroDaMesa) || ERROS_RETOMAVEIS.indexOf(e.codigo) < 0 || tentativa >= MAX_RETOMADAS) throw e;
      resposta = { situacao: "em_andamento", ficha, andamento: "retomando" };
    }
  }
  return normalizarResultado(resposta);
}

export function ampliarImagem(
  p: { clientId: string; imagemId: string; fator: 2 | 4; modo: ModoDoUpscale; motor?: string; conteudo?: ConteudoDaImagem; refazer?: boolean },
  aoAndar?: (e: EstadoDoAndamento) => void,
): Promise<ResultadoDaFerramenta> {
  const corpo: Record<string, unknown> = { acao: "upscale", client_id: p.clientId, imagem_id: p.imagemId, fator: p.fator, modo: p.modo };
  if (p.motor) corpo.motor = p.motor;
  if (p.conteudo) corpo.conteudo = p.conteudo;
  if (p.refazer) corpo.refazer = true;
  return rodarAteFicarPronto(corpo, aoAndar);
}

export function tirarFundoPro(
  p: { clientId: string; imagemId: string; motor?: "bria" | "birefnet"; refazer?: boolean },
  aoAndar?: (e: EstadoDoAndamento) => void,
): Promise<ResultadoDaFerramenta> {
  const corpo: Record<string, unknown> = { acao: "remover_fundo", client_id: p.clientId, imagem_id: p.imagemId };
  if (p.motor) corpo.motor = p.motor;
  if (p.refazer) corpo.refazer = true;
  return rodarAteFicarPronto(corpo, aoAndar);
}

/** Frase do andamento para a tela. */
export function textoDoAndamento(e: EstadoDoAndamento | null, segundos: number): string {
  const s = segundos > 0 ? ` (${segundos} s)` : "";
  if (!e || e.etapa === "enviando") return `Enviando ao provedor${s}`;
  if (e.etapa === "na_fila") return `Na fila do provedor${e.posicao !== null ? `, posição ${e.posicao}` : ""}${s}`;
  if (e.etapa === "retomando") return `Retomando o pedido, sem cobrar de novo${s}`;
  return `Processando${s}`;
}
