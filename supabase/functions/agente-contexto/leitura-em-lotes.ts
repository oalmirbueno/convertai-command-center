/**
 * Leitura das referências em lotes (frente LR, 29/09/2026).
 *
 * Por que existe: o "Ler as pendentes" mandava as 12 referências numa chamada
 * só. No Rd Ar Climatização uma delas (PNG cortado no envio, 96 KB sem o fim
 * do arquivo) fazia o provedor recusar o pedido inteiro ("The image data you
 * provided does not represent a valid image", HTTP 400). O erro era engolido
 * (`{ lidas: 0, custo: 0 }` sem log) e a tela dizia "Custo real: US$ 0,00"
 * como se tivesse lido. Como a fila sai sempre na mesma ordem, a mesma imagem
 * travava todas as tentativas.
 *
 * Regras daqui:
 * - Arquivo quebrado é pego ANTES de gastar (defeitoDaImagem): sai da fila com
 *   o motivo e não trava as outras.
 * - Lotes pequenos (até 4 imagens e 12 MB em base64), longe do teto de 30 MB do
 *   provedor; um lote que falha não derruba os outros.
 * - Provedor recusou a imagem num lote de várias: cada uma vai sozinha, para
 *   achar a quebrada (só acontece quando falha; recusa não é cobrada).
 * - Tempo total com teto: o que não coube fica pendente e volta em `restantes`.
 * - Nada termina em silêncio: toda falha tem motivo e vai para o log.
 *
 * Módulo puro (sem Supabase nem provedor): index.ts injeta as dependências e
 * o teste roda no vitest.
 */

import { defeitoDaImagem } from "../_shared/defeito-da-imagem.ts";

export { defeitoDaImagem };

export const MAX_IMAGENS_POR_LOTE = 4;
export const MAX_BASE64_POR_LOTE = 12 * 1024 * 1024;
/** Tempo total da leitura numa chamada, contando a abertura das imagens (a função tem 150 s de parede). */
export const PRAZO_DA_LEITURA_MS = 100_000;
export const LOTES_AO_MESMO_TEMPO = 2;

export const tamanhoEmBase64 = (bytes: number) => Math.ceil(Math.max(0, bytes) / 3) * 4;

/** Motivos com texto para a pessoa (tags gravadas na referência que sai da fila). */
export const MOTIVOS: Record<string, string> = {
  arquivo_indisponivel: "o arquivo não foi encontrado no armazenamento",
  arquivo_vazio: "o arquivo está vazio",
  png_truncado: "o PNG está cortado (o envio não terminou)",
  jpeg_truncado: "o JPEG está cortado (o envio não terminou)",
  webp_truncado: "o WebP está cortado (o envio não terminou)",
  formato_nao_suportado: "o formato não é lido pelo leitor (use PNG, JPEG ou WebP)",
  grande_demais: "o arquivo passa do tamanho que o leitor aceita",
  imagem_recusada: "o provedor de IA recusou a imagem como inválida",
};

export const textoDoMotivo = (codigo: string) => MOTIVOS[codigo] ?? codigo;

type ComImagem = { imagem: { bytes: Uint8Array } };

/** Lotes em ordem, com até `maxImagens` e até `teto` bytes em base64 cada (uma imagem sozinha sempre forma lote). */
export function dividirEmLotes<T extends ComImagem>(itens: T[], maxImagens = MAX_IMAGENS_POR_LOTE, teto = MAX_BASE64_POR_LOTE): T[][] {
  const lotes: T[][] = [];
  let atual: T[] = [];
  let bytes = 0;
  for (const item of itens) {
    const t = tamanhoEmBase64(item.imagem.bytes.byteLength);
    if (atual.length && (atual.length >= maxImagens || bytes + t > teto)) {
      lotes.push(atual);
      atual = [];
      bytes = 0;
    }
    atual.push(item);
    bytes += t;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

export type LeituraDoModelo = { imagem: number; tecnica: string; tags: string[] };
export type FalhaDaLeitura = { id: string; motivo: string };

export type ResultadoDaLeitura = {
  /** Pendentes que entraram nesta rodada (já sem as que saíram da fila antes). */
  tentadas: number;
  lidas: number;
  custo: number;
  falharam: FalhaDaLeitura[];
  /** Ficaram pendentes sem tentar (tempo ou saldo): voltam no próximo clique. */
  restantes: number;
  /** Frase para a pessoa quando algo não foi lido; null quando leu tudo. */
  motivo: string | null;
  /** Erro do motor que parou a leitura (saldo, cota, chave), para a resposta virar 402/403. */
  erroQueParou?: unknown;
};

export type DependenciasDaLeitura<T> = {
  /** Uma chamada ao leitor com as imagens do lote, na ordem (imagem 1, 2...). */
  lerLote: (lote: T[]) => Promise<{ leituras: LeituraDoModelo[]; custo: number }>;
  /** Grava a leitura; false quando o banco não gravou. */
  gravar: (item: T, leitura: { tecnica: string; tags: string[] }) => Promise<boolean>;
  /** Tira da fila a referência que o provedor recusou como imagem inválida. */
  marcarInvalida: (item: T, motivo: string) => Promise<void>;
  /** Saldo, cota ou chave: parar tudo (nenhum lote seguinte vai passar). */
  erroQueParaTudo: (e: unknown) => boolean;
  /** Provedor recusou a imagem ou o tamanho do pedido: vale tentar uma por uma. */
  recusouImagem: (e: unknown) => boolean;
  descrever: (e: unknown) => string;
  log?: (mensagem: string, dados: Record<string, unknown>) => void;
  agora?: () => number;
  prazoMs?: number;
  paralelos?: number;
  maxImagens?: number;
  teto?: number;
};

const limpo = (v: unknown, max: number) => (v == null ? "" : String(v)).slice(0, max).trim();

/** Lê os itens em lotes. Nunca lança: toda falha vira motivo no resultado. */
export async function lerEmLotes<T extends ComImagem & { id: string }>(itens: T[], d: DependenciasDaLeitura<T>): Promise<ResultadoDaLeitura> {
  const agora = d.agora ?? (() => Date.now());
  const inicio = agora();
  const prazo = d.prazoMs ?? PRAZO_DA_LEITURA_MS;
  const log = d.log ?? ((m: string, dados: Record<string, unknown>) => console.error(m, dados));
  const fila = dividirEmLotes(itens, d.maxImagens, d.teto);
  const r: ResultadoDaLeitura = { tentadas: itens.length, lidas: 0, custo: 0, falharam: [], restantes: 0, motivo: null };
  let parou = false;
  let semTempo = false;
  const tentados = new Set<string>();

  const falhar = (lote: T[], motivo: string) => {
    for (const item of lote) r.falharam.push({ id: item.id, motivo });
  };

  const processar = async (lote: T[]): Promise<void> => {
    if (parou) return;
    if (agora() - inicio > prazo) {
      semTempo = true;
      return;
    }
    for (const item of lote) tentados.add(item.id);
    let resposta: { leituras: LeituraDoModelo[]; custo: number };
    try {
      resposta = await d.lerLote(lote);
    } catch (e) {
      if (d.erroQueParaTudo(e)) {
        parou = true;
        r.erroQueParou = e;
        for (const item of lote) tentados.delete(item.id);
        log("agente-contexto: leitura parada (saldo, cota ou chave)", { motivo: d.descrever(e), lote: lote.map((i) => i.id) });
        return;
      }
      if (d.recusouImagem(e) && lote.length > 1) {
        log("agente-contexto: provedor recusou o lote; lendo uma por uma", { motivo: d.descrever(e), lote: lote.map((i) => i.id) });
        for (const item of lote) tentados.delete(item.id);
        for (const item of lote) await processar([item]);
        return;
      }
      if (d.recusouImagem(e) && lote.length === 1) {
        log("agente-contexto: provedor recusou a imagem; sai da fila", { motivo: d.descrever(e), referencia: lote[0].id });
        try {
          await d.marcarInvalida(lote[0], "imagem_recusada");
        } catch (m) {
          log("agente-contexto: não marcou a referência recusada", { referencia: lote[0].id, erro: d.descrever(m) });
        }
        falhar(lote, textoDoMotivo("imagem_recusada"));
        return;
      }
      log("agente-contexto: lote de leitura falhou", { motivo: d.descrever(e), lote: lote.map((i) => i.id) });
      falhar(lote, d.descrever(e));
      return;
    }
    r.custo += Number(resposta.custo) || 0;
    const porIndice = new Map<number, LeituraDoModelo>();
    for (const l of Array.isArray(resposta.leituras) ? resposta.leituras : []) {
      const i = Math.round(Number(l?.imagem));
      if (Number.isFinite(i) && !porIndice.has(i)) porIndice.set(i, l);
    }
    for (let i = 0; i < lote.length; i++) {
      const l = porIndice.get(i + 1);
      const tecnica = limpo(l?.tecnica, 1500);
      if (!l || !tecnica) {
        falhar([lote[i]], "o leitor não devolveu a leitura desta imagem");
        continue;
      }
      const tags = Array.from(new Set((Array.isArray(l.tags) ? l.tags : []).map((t) => limpo(t, 40).toLowerCase()).filter(Boolean))).slice(0, 12);
      let gravou = false;
      try {
        gravou = await d.gravar(lote[i], { tecnica, tags });
      } catch (e) {
        log("agente-contexto: leitura não gravada", { referencia: lote[i].id, erro: d.descrever(e) });
      }
      if (gravou) r.lidas++;
      else falhar([lote[i]], "a leitura veio, mas não foi gravada");
    }
  };

  // Poucos lotes ao mesmo tempo: cada "trabalhador" pega o próximo da fila.
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < fila.length && !parou) {
      const lote = fila[proximo++];
      await processar(lote);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(d.paralelos ?? LOTES_AO_MESMO_TEMPO, fila.length)) }, trabalhador));

  r.restantes = itens.filter((i) => !tentados.has(i.id)).length;
  const partes: string[] = [];
  if (r.erroQueParou) partes.push(d.descrever(r.erroQueParou));
  if (r.falharam.length) {
    const motivos = Array.from(new Set(r.falharam.map((f) => f.motivo)));
    partes.push(`${r.falharam.length} ${r.falharam.length === 1 ? "referência não foi lida" : "referências não foram lidas"}: ${motivos.join("; ")}.`);
  }
  if (r.restantes && !r.erroQueParou) {
    partes.push(`${r.restantes} ${r.restantes === 1 ? "ficou" : "ficaram"} para a próxima leitura${semTempo ? " (o tempo da chamada acabou)" : ""}.`);
  }
  r.motivo = partes.length ? partes.join(" ") : null;
  return r;
}

/**
 * Campos da leitura que toda resposta do montar leva. `falhou`: nada foi lido
 * e havia o que ler (a tela mostra erro com o motivo). `parcial`: parte não foi
 * lida, ou a leitura falhou mas a ação principal (montar o contexto) foi feita.
 */
export function camposDaLeitura(l: ResultadoDaLeitura, opcoes: { principalFeito?: boolean } = {}) {
  const nadaLido = l.lidas === 0 && l.tentadas > 0 && (l.falharam.length > 0 || !!l.erroQueParou || !!l.motivo);
  const falhou = nadaLido && !opcoes.principalFeito;
  const parcial = !falhou && !!l.motivo;
  return {
    referencias_lidas: l.lidas,
    referencias_falharam: l.falharam.length,
    referencias_restantes: l.restantes,
    falhas_da_leitura: l.falharam.slice(0, 12),
    motivo: l.motivo,
    ...(falhou ? { falhou: true as const } : parcial ? { parcial: true as const } : {}),
  };
}
