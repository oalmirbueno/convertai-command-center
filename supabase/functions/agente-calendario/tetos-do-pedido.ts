/**
 * Tetos do agente do Mês e das campanhas (anti-bug 26/09, frente AB2).
 *
 * Funções puras (sem Deno e sem npm): o index.ts usa e os testes (vitest)
 * leem o mesmo arquivo.
 * - Imagens da chamada: foto do acervo e anexo do pedido nunca abrem o
 *   original grande dentro da função (2 s de CPU e 256 MB); vem a cópia leve
 *   (_shared/imagem-reduzida.ts com pedirCopia) e o total fica no teto de 24 MB
 *   de base64 por chamada ao modelo. O que não cabe fica de fora COM aviso.
 * - Período da campanha: campanha curta fica no período real dela (antes era
 *   esticada para 14 dias e os conteúdos caíam depois do fim).
 * - Quantidade da campanha: o teto de 8 por vez avisa quantos ficaram de fora.
 */
import { tamanhoEmBase64, TETO_BASE64_DAS_IMAGENS } from "../_shared/capacidades-imagem.ts";

// ------------------------------------------------------------------ imagens

/** Lado maior da foto do acervo que o modelo lê. A miniatura do painel (640) já cabe. */
export const LADO_DA_FOTO_LIDA = 768;
/** Foto maior que isto (e fora da caixa) não abre na função: vem a cópia leve. Mesmo teto do agente-contexto. */
export const MAX_PIXELS_FOTO_NA_FUNCAO = 700_000;
/** Maior foto reduzida que vai ao modelo. */
export const MAX_BYTES_FOTO_LIDA = 3 * 1024 * 1024;

/** Anexo do pedido (print, foto): lado maior 2048 com folga de 25%, e o print de celular vai inteiro e legível. */
export const LADO_DO_ANEXO = 2048;
export const FOLGA_DO_ANEXO = 1.25;
/** Anexo maior que isto (e fora da caixa) não abre na função: vem a cópia leve. */
export const MAX_PIXELS_ANEXO_NA_FUNCAO = 1_500_000;
/** Maior arquivo que vai ao modelo por anexo (o mesmo teto de antes). */
export const MAX_BYTES_ANEXO = 12 * 1024 * 1024;
/** Maior original baixado para achar a cópia (o mesmo das fotos). */
export const MAX_BYTES_ORIGINAL = 30 * 1024 * 1024;

/** Imagens lidas ao mesmo tempo: cada original pode ter até 30 MB, e 12 juntas passavam dos 256 MB da função. */
export const IMAGENS_LIDAS_AO_MESMO_TEMPO = 3;

export type ImagensNoTeto = {
  /** Índices (na lista lida) das imagens que vão ao modelo, em ordem. */
  ficam: number[];
  /** Não deu para ler (sem cópia leve, arquivo que não é imagem ou grande demais). */
  ilegiveis: number;
  /** Lidas, mas o total passava do teto da chamada. */
  acimaDoTeto: number;
};

/**
 * Quais imagens lidas (em ordem; null = não deu para ler) vão ao modelo sem
 * passar do teto de base64 da chamada. `jaNaChamada`: base64 que a mesma
 * mensagem já leva (as fotos da campanha vêm antes dos anexos). A partir da
 * primeira que não cabe, as seguintes também ficam de fora: a ordem que a
 * equipe anexou não muda.
 */
export function imagensNoTetoDaChamada(
  lidas: Array<{ bytes: Uint8Array } | null>,
  jaNaChamada = 0,
  teto = TETO_BASE64_DAS_IMAGENS,
): ImagensNoTeto {
  const ficam: number[] = [];
  let ilegiveis = 0;
  let acimaDoTeto = 0;
  let usado = Math.max(0, jaNaChamada);
  let cheio = false;
  lidas.forEach((img, i) => {
    if (!img) {
      ilegiveis++;
      return;
    }
    const t = tamanhoEmBase64(img.bytes.byteLength);
    if (cheio || usado + t > teto) {
      cheio = true;
      acimaDoTeto++;
      return;
    }
    usado += t;
    ficam.push(i);
  });
  return { ficam, ilegiveis, acimaDoTeto };
}

/** Base64 que uma lista de imagens ocupa na chamada. */
export const base64DasImagens = (imagens: Array<{ bytes: Uint8Array }>) => imagens.reduce((s, i) => s + tamanhoEmBase64(i.bytes.byteLength), 0);

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);
const MB_DO_TETO = Math.round(TETO_BASE64_DAS_IMAGENS / (1024 * 1024));

/** Aviso das imagens que ficaram de fora (para a equipe e para o modelo); null quando nada ficou. */
export function avisoDasImagensDeFora(q: { ilegiveis: number; acimaDoTeto: number }, tipo: "anexo" | "foto"): string | null {
  const nome = (n: number) => (tipo === "anexo" ? plural(n, "imagem anexada", "imagens anexadas") : plural(n, "foto da campanha", "fotos da campanha"));
  const partes: string[] = [];
  if (q.ilegiveis > 0) {
    partes.push(`${q.ilegiveis} ${nome(q.ilegiveis)} ${plural(q.ilegiveis, "ficou", "ficaram")} de fora: não deu para abrir agora. Tente de novo em instantes.`);
  }
  if (q.acimaDoTeto > 0) {
    partes.push(`${q.acimaDoTeto} ${nome(q.acimaDoTeto)} ${plural(q.acimaDoTeto, "ficou", "ficaram")} de fora: as imagens juntas passavam de ${MB_DO_TETO} MB, o limite por pedido.`);
  }
  return partes.length ? partes.join(" ") : null;
}

/** A resposta do agente com os avisos no fim (a equipe lê na conversa). */
export function respostaComAvisos(resposta: string, avisos: Array<string | null | undefined>): string {
  const lista = avisos.filter((a): a is string => !!a && !!a.trim());
  if (!lista.length) return resposta;
  return resposta.trim() ? `${resposta}\n\n${lista.join("\n")}` : lista.join("\n");
}

// ------------------------------------------------------------------ campanha

/** Conteúdos de campanha gerados de uma vez (lotes paralelos cabem no tempo da função). */
export const MAX_CONTEUDOS_POR_VEZ = 8;

/**
 * Quantos conteúdos a campanha gera nesta vez. Sem pedido: 5 (3 quando a
 * campanha já tem conteúdos). Acima do teto: gera o teto e avisa quantos
 * ficaram de fora (antes cortava calado).
 */
export function quantidadeDaCampanha(pedido: unknown, existentes: number): { quantidade: number; ignorados: number; aviso: string | null } {
  const n = Math.round(Number(pedido));
  if (!Number.isFinite(n) || n < 1) return { quantidade: existentes > 0 ? 3 : 5, ignorados: 0, aviso: null };
  if (n <= MAX_CONTEUDOS_POR_VEZ) return { quantidade: n, ignorados: 0, aviso: null };
  const ignorados = n - MAX_CONTEUDOS_POR_VEZ;
  return {
    quantidade: MAX_CONTEUDOS_POR_VEZ,
    ignorados,
    aviso: `Foram pedidos ${n} conteúdos e o máximo por vez é ${MAX_CONTEUDOS_POR_VEZ}: ${ignorados} ${plural(ignorados, "ficou", "ficaram")} de fora. Gere de novo para completar.`,
  };
}

/** AAAA-MM-DD para DD/MM (texto para a equipe). */
export const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

const somarDias = (data: string, n: number) => {
  const d = new Date(`${data}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Período dos conteúdos da campanha: de hoje (ou do início, se ainda não
 * começou) até o fim REAL da campanha. Sem fim, ou já encerrada: 21 dias a
 * partir do início, como sempre foi. Antes, campanha com menos de 5 dias era
 * esticada para 14 e os conteúdos caíam depois do fim dela.
 */
export function periodoDosConteudosDaCampanha(
  inicioDaCampanha: string | null | undefined,
  fimDaCampanha: string | null | undefined,
  hoje: string,
): { inicio: string; fim: string } {
  const inicio = inicioDaCampanha && inicioDaCampanha > hoje ? inicioDaCampanha : hoje;
  const fim = fimDaCampanha && fimDaCampanha >= inicio ? fimDaCampanha : somarDias(inicio, 21);
  return { inicio, fim };
}

/** Campanha curta com mais conteúdos que dias úteis: avisa que alguns dividem o dia. */
export function avisoDoPeriodoCurto(diasUteis: number, quantidade: number): string | null {
  if (diasUteis <= 0 || quantidade <= diasUteis) return null;
  return `A campanha tem ${diasUteis} ${plural(diasUteis, "dia útil", "dias úteis")} até o fim: alguns conteúdos ficaram no mesmo dia.`;
}
