import { chaveDaFonte, midiaDaFonte, type FonteDoProjeto, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, fimDoClipe, trilhaPrincipal, type Operacao } from "./operacoes";
import { noQuadro } from "./tempo";

/**
 * Biblioteca do editor (frente V-B): o que o cliente tem (vídeos enviados e
 * gerados, imagens das gerações) vira fonte do projeto e clipe na linha do
 * tempo, sempre por operações (desfaz com Ctrl+Z).
 */

export interface ItemDaBiblioteca {
  /** Id do arquivo (video_arquivos) ou caminho, quando veio de um pedido. */
  id: string;
  arquivo_id: string | null;
  nome: string;
  tipo: string;
  storage_bucket: string;
  storage_path: string;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  origem: "enviado" | "gerado" | "pedido";
}

export const DURACAO_DA_IMAGEM_S = 3;

/** Chave da fonte deste item no projeto (reaproveita se já está lá). */
export function chaveNoProjeto(p: ProjetoDeEdicao, item: ItemDaBiblioteca): { chave: string; nova: boolean } {
  const ja = Object.keys(p.fontes).find((k) => (item.arquivo_id && p.fontes[k].arquivo_id === item.arquivo_id) || p.fontes[k].storage_path === item.storage_path);
  if (ja) return { chave: ja, nova: false };
  let chave = chaveDaFonte(item.nome);
  let n = 2;
  while (p.fontes[chave]) chave = `${chaveDaFonte(item.nome).slice(0, 36)}-${n++}`;
  return { chave, nova: true };
}

export function fonteDoItem(chave: string, item: ItemDaBiblioteca): FonteDoProjeto {
  return {
    chave,
    arquivo_id: item.arquivo_id,
    nome: item.nome,
    tipo: item.tipo,
    storage_bucket: item.storage_bucket,
    storage_path: item.storage_path,
    duracao_s: item.duracao_s,
    largura: item.largura,
    altura: item.altura,
    midia: midiaDaFonte(item.tipo, item.nome, item.storage_path),
  };
}

/**
 * Operações para pôr o item na linha do tempo: no fim da trilha certa
 * (vídeo/imagem na principal, áudio na de áudio) ou no cursor (empurrando o
 * que vem depois). Vídeo sem duração lida não entra (não dá para cortar sem
 * saber o fim).
 */
export function opsParaInserir(p: ProjetoDeEdicao, item: ItemDaBiblioteca, onde: "fim" | "cursor" | { depoisDe: string }, cursor = 0, origem?: { tipo: "angulo" | "continuar" | "transicao" | "cena" | "manual"; ref: string | null }): Operacao[] {
  const { chave, nova } = chaveNoProjeto(p, item);
  const fonte = fonteDoItem(chave, item);
  const ops: Operacao[] = [];
  if (nova) ops.push({ op: "fonte", fonte });
  let dur = fonte.midia === "imagem" ? DURACAO_DA_IMAGEM_S : fonte.duracao_s;
  if (!dur || dur <= 0) throw new Error("Essa mídia ainda não tem duração lida. Abra na Entrada para ler a duração.");
  dur = Math.round(dur * 100) / 100;
  let trilha = fonte.midia === "audio" ? p.trilhas.find((t) => t.tipo === "audio") : trilhaPrincipal(p);
  if (!trilha) {
    ops.push({ op: "trilha_nova", tipo: fonte.midia === "audio" ? "audio" : "video" });
    trilha = { id: `${fonte.midia === "audio" ? "audio" : "video"}-1`, tipo: fonte.midia === "audio" ? "audio" : "video", nome: "", muda: false, oculta: false, clipes: [] };
  }
  let inicio = 0;
  let empurrar = false;
  if (onde === "fim") inicio = trilha.clipes.reduce((m, c) => Math.max(m, fimDoClipe(c)), 0);
  else if (onde === "cursor") {
    inicio = cursor;
    empurrar = true;
    // Cursor no meio de um clipe: entra depois dele.
    const embaixo = trilha.clipes.find((c) => c.inicio_s < cursor - 1e-6 && fimDoClipe(c) > cursor + 1e-6);
    if (embaixo) inicio = fimDoClipe(embaixo);
  } else {
    const ref = trilha.clipes.find((c) => c.id === onde.depoisDe);
    inicio = ref ? fimDoClipe(ref) : trilha.clipes.reduce((m, c) => Math.max(m, fimDoClipe(c)), 0);
    empurrar = true;
  }
  ops.push({ op: "inserir", trilha: trilha.id, empurrar, clipe: { fonte: chave, inicio_s: noQuadro(inicio, p.fps), entrada_s: 0, saida_s: dur, origem: origem || { tipo: "manual", ref: null } } });
  return ops;
}

/** Mídias que um pedido devolveu (formato combinado com a V-A; campos tolerantes). */
export function midiasDoPedido(pedido: { id: string; tipo?: string; resultado?: unknown; estado?: string }): ItemDaBiblioteca[] {
  const r = pedido.resultado && typeof pedido.resultado === "object" ? (pedido.resultado as Record<string, unknown>) : null;
  if (!r) return [];
  const brutos: unknown[] = []
    .concat(Array.isArray(r.arquivos) ? (r.arquivos as never[]) : [])
    .concat(Array.isArray(r.imagens) ? (r.imagens as never[]) : [])
    .concat(Array.isArray(r.videos) ? (r.videos as never[]) : [])
    .concat(r.storage_path ? [r as never] : []);
  return brutos
    .map((x, k): ItemDaBiblioteca | null => {
      const o = typeof x === "string" ? { storage_path: x } : x && typeof x === "object" ? (x as Record<string, unknown>) : null;
      const caminho = o ? String(o.storage_path || o.path || "") : "";
      if (!o || !caminho) return null;
      const nome = String(o.nome || caminho.split("/").pop() || `resultado-${k + 1}`);
      return {
        id: `${pedido.id}:${k}`,
        arquivo_id: o.arquivo_id ? String(o.arquivo_id) : null,
        nome,
        tipo: String(o.tipo || midiaDaFonte(null, nome, caminho)),
        storage_bucket: String(o.storage_bucket || o.bucket || "mesa"),
        storage_path: caminho,
        duracao_s: Number(o.duracao_s) > 0 ? Number(o.duracao_s) : null,
        largura: Number(o.largura) > 0 ? Number(o.largura) : null,
        altura: Number(o.altura) > 0 ? Number(o.altura) : null,
        origem: "pedido",
      };
    })
    .filter((x): x is ItemDaBiblioteca => !!x);
}

/** Clipes da trilha principal em ordem (lista de cortes do modo celular). */
export const listaDeCortes = (p: ProjetoDeEdicao) => {
  const t = trilhaPrincipal(p);
  return t ? emOrdem(t) : [];
};

/** O mínimo de um arquivo da Entrada (video_arquivos) que a Mídia do editor usa. */
export interface ArquivoParaABiblioteca {
  id: string;
  nome: string;
  tipo: string;
  estado?: string | null;
  storage_bucket: string;
  storage_path: string;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  sha256?: string | null;
  bytes?: number | null;
  so_no_storage?: boolean;
}

/** Arquivo da Entrada vira item da Mídia (o mesmo para a tela e para o agente). */
export function itemDoArquivo(a: ArquivoParaABiblioteca): ItemDaBiblioteca {
  return {
    id: a.id,
    arquivo_id: a.so_no_storage ? null : a.id,
    nome: a.nome,
    tipo: a.tipo,
    storage_bucket: a.storage_bucket,
    storage_path: a.storage_path,
    duracao_s: a.duracao_s,
    largura: a.largura,
    altura: a.altura,
    origem: a.tipo === "gerado" || a.tipo === "angulo" || a.tipo === "quadro" ? "gerado" : "enviado",
  };
}

/** A Mídia inteira: arquivos (menos os arquivados) e o que os pedidos devolveram, sem repetir caminho. */
export function itensDaBiblioteca(arquivos: ArquivoParaABiblioteca[], pedidos: { id: string; tipo?: string; resultado?: unknown; estado?: string }[] = []): ItemDaBiblioteca[] {
  const lista = arquivos.filter((a) => a.estado !== "arquivado").map(itemDoArquivo);
  const dosPedidos = pedidos.reduce((l, p) => l.concat(midiasDoPedido(p)), [] as ItemDaBiblioteca[]);
  const vistos: Record<string, boolean> = {};
  return lista.concat(dosPedidos).filter((i) => (vistos[i.storage_path] ? false : (vistos[i.storage_path] = true)));
}

/** Sha256 e tamanho por arquivo_id (acha o mesmo take subido duas vezes). */
export function assinaturasDosArquivos(arquivos: ArquivoParaABiblioteca[]): Record<string, { sha256: string | null; bytes: number | null }> {
  const saida: Record<string, { sha256: string | null; bytes: number | null }> = {};
  arquivos.forEach((a) => {
    if (a.sha256 || a.bytes) saida[a.id] = { sha256: a.sha256 || null, bytes: typeof a.bytes === "number" ? a.bytes : null };
  });
  return saida;
}
