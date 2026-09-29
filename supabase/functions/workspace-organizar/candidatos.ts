/**
 * Quais arquivos entram na organização (frente OR, 29/09/2026).
 *
 * Padrão: os arquivos soltos no nível onde a pessoa está e os que estão numa
 * pasta de nome genérico logo abaixo ("Nova pasta", "Sem título", "Uploads").
 * O que a pessoa já pôs numa pasta com nome próprio fica onde está.
 * "Reorganizar tudo": todos os arquivos do nível para baixo.
 *
 * Nunca entram: pasta (só arquivo se move), Arquivados, a pasta que recebe
 * arquivos do cliente e o que ainda está em verificação.
 *
 * Puro (vitest e Deno).
 */

import { type NoDoIndice, travaDoNo } from "./aplicar.ts";
import type { Situacao } from "./organizador.ts";

export type NoCompleto = NoDoIndice & {
  mime: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  duration_sec: number | null;
  created_at: string;
  sent_for_approval_file_id: string | null;
};

export type ArquivoCandidato = {
  id: string;
  nome: string;
  mime: string | null;
  tamanho: number | null;
  duracao: number | null;
  storage_path: string | null;
  criado_em: string;
  caminho: string[];
  /** O que a leitura faz com ele: imagem lida por visão, vídeo pelo quadro, o resto pelo nome. */
  leitura: "imagem" | "video" | "nome";
  vinculo_file_id: string | null;
  situacao: Situacao;
};

/** Pasta de nome genérico: o que está nela conta como solto. */
export const PASTA_GENERICA = /^(nova pasta|nova pasta \(\d+\)|new folder|sem t[ií]tulo|sem nome|untitled|novos?|uploads?|diversos|bagun[cç]a|outros|geral|temp|tmp|download(s)?|fotos novas|arquivos)$/i;

const EXT_IMAGEM = /\.(jpe?g|png|webp|jfif)$/i;
const EXT_VIDEO = /\.(mp4|mov|m4v|webm)$/i;

export function modoDeLeitura(n: Pick<NoCompleto, "name" | "mime">): ArquivoCandidato["leitura"] {
  const m = String(n.mime || "").toLowerCase();
  if (m === "image/jpeg" || m === "image/png" || m === "image/webp" || (!m && EXT_IMAGEM.test(n.name)) || (m.indexOf("image/") === 0 && EXT_IMAGEM.test(n.name))) return "imagem";
  if (m.indexOf("video/") === 0 || EXT_VIDEO.test(n.name)) return "video";
  return "nome";
}

/**
 * Chamadas de leitura (listas de ids, até `max` cada) que não partem uma
 * rajada de envio: arquivos da mesma pasta enviados um a um, de 1 s a 3 min
 * entre um e o seguinte. Rajada maior que `max` é dividida em partes de `max`.
 * A entrada já vem na ordem (pasta e envio).
 */
export function chamadasPorRajada(cands: Array<Pick<ArquivoCandidato, "id" | "caminho" | "criado_em">>, max = 8): string[][] {
  const rajadas: string[][] = [];
  let atual: string[] = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const antes = cands[i - 1];
    const gap = antes ? (Date.parse(c.criado_em) - Date.parse(antes.criado_em)) / 1000 : NaN;
    const junto = !!antes && antes.caminho.join("/") === c.caminho.join("/") && gap >= 1 && gap <= 180;
    if (!junto && atual.length) {
      rajadas.push(atual);
      atual = [];
    }
    atual.push(c.id);
  }
  if (atual.length) rajadas.push(atual);
  const chamadas: string[][] = [];
  let chamada: string[] = [];
  for (const r of rajadas) {
    if (r.length > max) {
      if (chamada.length) chamadas.push(chamada);
      chamada = [];
      for (let i = 0; i < r.length; i += max) chamadas.push(r.slice(i, i + max));
      continue;
    }
    if (chamada.length + r.length > max) {
      chamadas.push(chamada);
      chamada = [];
    }
    chamada.push(...r);
  }
  if (chamada.length) chamadas.push(chamada);
  return chamadas;
}

/** Os arquivos que entram, com o caminho relativo ao nível (["Nova pasta"] ou []). */
export function arquivosParaOrganizar(indice: NoCompleto[], parentId: string | null, tudo: boolean, max = 400): ArquivoCandidato[] {
  const porId = new Map(indice.map((n) => [n.id, n as NoDoIndice]));
  const filhos = new Map<string, NoCompleto[]>();
  for (const n of indice) {
    const k = n.parent_id || "raiz";
    filhos.set(k, [...(filhos.get(k) || []), n]);
  }
  const saida: ArquivoCandidato[] = [];
  const visitar = (pasta: string | null, caminho: string[], profundo: boolean) => {
    for (const n of filhos.get(pasta || "raiz") || []) {
      if (saida.length >= max) return;
      if (n.kind === "folder") {
        if (n.inbox_token) continue;
        if (!n.parent_id && n.name === "Arquivados") continue;
        if (profundo) visitar(n.id, [...caminho, n.name], true);
        else if (caminho.length === 0 && PASTA_GENERICA.test(n.name.trim())) visitar(n.id, [n.name], false);
        continue;
      }
      if (travaDoNo(n, porId)) continue;
      if (!n.storage_path) continue;
      saida.push({
        id: n.id,
        nome: n.name,
        mime: n.mime,
        tamanho: n.size_bytes,
        duracao: n.duration_sec === null || n.duration_sec === undefined ? null : Number(n.duration_sec),
        storage_path: n.storage_path,
        criado_em: n.created_at,
        caminho,
        leitura: modoDeLeitura(n),
        vinculo_file_id: n.sent_for_approval_file_id,
        situacao: null,
      });
    }
  };
  visitar(parentId, [], tudo);
  // Pasta por pasta, na ordem de envio: a leitura em lotes vê juntas as lâminas enviadas juntas.
  return saida.sort((a, b) => a.caminho.join("/").localeCompare(b.caminho.join("/")) || a.criado_em.localeCompare(b.criado_em) || a.nome.localeCompare(b.nome));
}
