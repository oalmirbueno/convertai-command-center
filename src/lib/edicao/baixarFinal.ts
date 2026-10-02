import { supabase } from "@/integrations/supabase/client";
import { chamarMesaVideos } from "@/components/mesa-videos/videosApi";

/**
 * Baixar o vídeo pronto (Mesa Edição, 02/10): no computador, um link assinado
 * com o nome do arquivo (o navegador salva em Downloads); no celular, o
 * compartilhamento do sistema com o arquivo (dá para "Salvar vídeo" na
 * galeria) e, sem ele, o mesmo download. E o "Abrir no Workspace", que põe o
 * vídeo em "Vídeos / <título> / Finais" pelo servidor e abre a pasta.
 */

/** Preferência "Baixar sozinho ao terminar" (ligada por padrão), a mesma no editor e nos Finais. */
export const CHAVE_DO_BAIXAR_SOZINHO = "edicao:baixar-sozinho";
export const ROTA_DO_BAIXAR_SOZINHO = "/mesa-edicao";
export const LINK_DE_BAIXAR_S = 3600;

/** "Depoimento v2 (render 9:16)" -> "Depoimento v2 (final 9x16).mp4" (o Windows não aceita ":" no nome). */
export function nomeParaBaixar(nome: string, extensao = "mp4"): string {
  const base = String(nome || "Vídeo")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\(render( [^)]*)?\)\s*$/i, "(final$1)")
    .replace(/(\d):(\d)/g, "$1x$2")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
  return `${base || "Vídeo"}.${extensao.replace(/^\./, "")}`;
}

/** Link de uma hora que já baixa com o nome certo (Content-Disposition do Storage). */
export async function linkParaBaixar(bucket: string, caminho: string, nome: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket || "mesa").createSignedUrl(caminho, LINK_DE_BAIXAR_S, { download: nome });
  if (error || !data || !data.signedUrl) throw new Error("Não foi possível abrir o arquivo agora.");
  return data.signedUrl;
}

/** Baixa pelo link (sem abrir aba: o Storage manda como anexo). */
export function baixarPeloLink(url: string, nome: string, doc: Document = document): void {
  const a = doc.createElement("a");
  a.href = url;
  a.download = nome;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
}

type NavegadorComShare = Pick<Navigator, "userAgent"> & {
  share?: (d: ShareData) => Promise<void>;
  canShare?: (d: ShareData) => boolean;
  userAgentData?: { mobile?: boolean };
};

export function ehCelular(nav: NavegadorComShare = navigator): boolean {
  if (nav.userAgentData && typeof nav.userAgentData.mobile === "boolean" && nav.userAgentData.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || "");
}

/** O botão "Salvar no celular" aparece no celular com o compartilhamento de arquivos. */
export const podeSalvarNoCelular = (nav: NavegadorComShare = navigator) => ehCelular(nav) && typeof nav.share === "function" && typeof nav.canShare === "function";

export type ResultadoDoSalvar = { resultado: "compartilhado" | "baixado" | "cancelado" | "precisa_toque"; arquivo?: File };

/**
 * Salvar no celular: o arquivo inteiro vem para a memória e vai para o
 * compartilhamento do sistema. O navegador só aceita o compartilhamento logo
 * depois de um toque: se a espera do download passou do tempo, devolve
 * "precisa_toque" com o arquivo pronto e o próximo toque compartilha.
 * Sem compartilhamento de arquivo: baixa pelo link.
 */
export async function salvarNoCelular(url: string, nome: string, o: { mime?: string; pronto?: File | null; nav?: NavegadorComShare; buscar?: typeof fetch; doc?: Document } = {}): Promise<ResultadoDoSalvar> {
  const nav = o.nav || (navigator as NavegadorComShare);
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
    baixarPeloLink(url, nome, o.doc);
    return { resultado: "baixado" };
  }
  let arquivo = o.pronto || null;
  if (!arquivo) {
    const r = await (o.buscar || fetch)(url);
    if (!r.ok) throw new Error("Não foi possível baixar o vídeo agora.");
    const blob = await r.blob();
    arquivo = new File([blob], nome, { type: o.mime || blob.type || "video/mp4" });
  }
  if (!nav.canShare({ files: [arquivo] })) {
    baixarPeloLink(url, nome, o.doc);
    return { resultado: "baixado" };
  }
  try {
    await nav.share({ files: [arquivo], title: nome });
    return { resultado: "compartilhado" };
  } catch (e) {
    const n = e && typeof e === "object" ? String((e as { name?: string }).name || "") : "";
    if (n === "AbortError") return { resultado: "cancelado" };
    if (n === "NotAllowedError") return { resultado: "precisa_toque", arquivo };
    baixarPeloLink(url, nome, o.doc);
    return { resultado: "baixado" };
  }
}

export interface FinalNoWorkspaceNaTela {
  estado: "pronto" | "ja_estava" | "em_andamento" | "pulado" | "erro";
  pasta_id: string | null;
  node_id: string | null;
  nome: string | null;
  caminho: string[];
  motivo?: string;
}

/** Põe o vídeo pronto no Workspace (idempotente). `automatico`: a tela viu o render pronto. */
export const finalParaOWorkspace = (arquivoId: string, automatico = false) =>
  chamarMesaVideos<{ workspace: FinalNoWorkspaceNaTela; client_id: string }>({ acao: "final_para_workspace", arquivo_id: arquivoId, automatico: automatico || undefined });

/** Endereço do Workspace na pasta do vídeo (sem pasta, a raiz do cliente). */
export const enderecoDoWorkspace = (clientId: string, pastaId: string | null | undefined) =>
  `/workspace?client=${encodeURIComponent(clientId)}${pastaId ? `&pasta=${encodeURIComponent(pastaId)}` : ""}`;

/** A pasta já anotada no arquivo (origem.workspace), sem chamar a função. */
export function pastaAnotada(origem: Record<string, unknown> | null | undefined): string | null {
  const w = origem && typeof origem.workspace === "object" && origem.workspace ? (origem.workspace as Record<string, unknown>) : null;
  return w && typeof w.pasta_id === "string" && typeof w.node_id === "string" ? w.pasta_id : null;
}

/** O que a barra do editor sabe do pedido pronto (PedidoNaFila). */
export interface PedidoParaBaixar {
  tipo: string;
  estado: string;
  saida_path?: string | null;
  url: string | null;
  entrada?: Record<string, unknown> | null;
}

/** Nome do MP4 do pedido: "<título> (final 9:16).mp4" ou "<título> (amostra).mp4". */
export function nomeDoPedido(titulo: string | null | undefined, p: Pick<PedidoParaBaixar, "tipo" | "entrada">): string {
  const formato = p.entrada && typeof p.entrada.formato === "string" ? ` ${p.entrada.formato}` : "";
  return nomeParaBaixar(`${(titulo || "Vídeo").trim() || "Vídeo"} (${p.tipo === "amostra" ? "amostra" : `render${formato}`})`);
}

/**
 * Download sozinho quando o vídeo inteiro fica pronto com o editor aberto
 * (preferência "Baixar sozinho ao terminar"). Amostra e onda não baixam.
 * Devolve se baixou.
 */
export async function baixarAoTerminar(p: PedidoParaBaixar, nome: string, ligado: boolean, o: { assinar?: typeof linkParaBaixar; baixar?: typeof baixarPeloLink } = {}): Promise<boolean> {
  if (!ligado || p.estado !== "pronto" || p.tipo !== "render_final") return false;
  const baixar = o.baixar || baixarPeloLink;
  if (p.saida_path) {
    try {
      baixar(await (o.assinar || linkParaBaixar)("mesa", p.saida_path, nome), nome);
      return true;
    } catch {
      /* sem o link com nome: usa o que a fila mandou */
    }
  }
  if (!p.url) return false;
  baixar(p.url, nome);
  return true;
}
