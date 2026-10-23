import type { ImagemDoAcervo } from "../SeletorDoAcervo";
import type { CardDaDirecao } from "../useItensDoMes";

export interface FonteProfile {
  caminho: string;
  bucket: string;
  nome: string;
  origem: string;
  url?: string;
  licenca?: string;
  autor?: string;
  exata?: boolean;
  /** Identidade autorizada pelo card, independente do bucket de armazenamento. */
  acervo_id?: string;
  /** De onde veio (21/10): do gerador da casa, da internet (com licença) ou do cliente (Fotos e acervo). */
  grupo: GrupoDaFonte;
}

export type GrupoDaFonte = "gerada" | "internet" | "cliente";
export const ROTULO_DO_GRUPO: Record<GrupoDaFonte, string> = { gerada: "Gerada no Estúdio", internet: "Da internet", cliente: "Do cliente" };

export interface ReferenciaProfile { imagem_caminho?: string; imagem_acervo_id?: string }

export const chaveDaFonteProfile = (fonte: FonteProfile): string => fonte.acervo_id ? `acervo:${fonte.acervo_id}` : fonte.caminho;
export const referenciaDaFonteProfile = (fonte?: FonteProfile): ReferenciaProfile => ({ imagem_acervo_id: fonte?.acervo_id, imagem_caminho: !fonte?.acervo_id && fonte?.bucket === "mesa" ? fonte.caminho : undefined });
export function resolverFonteProfile(fontes: FonteProfile[], referencia?: ReferenciaProfile): FonteProfile | undefined {
  if (referencia?.imagem_acervo_id) return fontes.find((f) => f.acervo_id === referencia.imagem_acervo_id);
  if (referencia?.imagem_caminho) return fontes.find((f) => f.bucket === "mesa" && f.caminho === referencia.imagem_caminho);
  return fontes[0];
}

type CardComFontes = Omit<CardDaDirecao, "vitrine_de_logos"> & {
  vitrine_de_logos?: Array<{ caminho: string; nome?: string; url_origem?: string }>;
  vitrine_tipo?: string;
  fontes_reais?: Array<{ caminho: string; nome: string; fonte_url: string; licenca: string; autor: string | null; tipo: "imagem" | "logo"; banco?: "wikimedia" | "openverse" | "noticias" | "pexels" }>;
  /** Fotos do post feitas pelo gerador da casa no Template (sem texto dentro). */
  imagens_do_template?: Array<{ caminho: string; descricao?: string; proporcao?: string; criado_em?: string }>;
};
export type { CardComFontes };
/** Banco de onde veio a imagem real pesquisada, pelo endereço da página da licença. */
function origemDaPesquisa(url: string, tipo: "imagem" | "logo", f?: { banco?: string; autor?: string | null }): string {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  // 23/10: foto de matéria mostra o veículo ("Notícia · Forbes Brasil"); Pexels pelo nome.
  if (f && f.banco === "noticias") return `Notícia · ${f.autor || host.replace(/^www\./, "")}`;
  const banco = f && f.banco === "pexels" || /pexels\.com$/.test(host) ? "Pexels" : /wikimedia\.org$|wikipedia\.org$/.test(host) ? "Wikimedia" : /openverse\.org$/.test(host) ? "Openverse" : host.replace(/^www\./, "");
  if (tipo === "logo") return banco ? `Logo real · ${banco}` : "Logo real da pesquisa";
  return banco ? `Imagem real · ${banco}` : "Imagem real da pesquisa";
}

export function urlDaFonteProfile(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  try { const u = new URL(valor); return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
}

/** Escolhas reais já ligadas à lâmina; fotos da equipe têm prioridade sobre a pesquisa. */
export function fontesDoProfile(card: CardComFontes, acervo: ImagemDoAcervo[], clientId?: string): FonteProfile[] {
  const saida: FonteProfile[] = [];
  const adicionar = (f: FonteProfile) => {
    if (!f.caminho || /(^|\/)\.\.(\/|$)|[\\?#%]/.test(f.caminho)) return;
    if (clientId && f.bucket === "mesa" && !f.caminho.startsWith(`${clientId}/`)) return;
    if (!saida.some((s) => s.caminho === f.caminho && s.bucket === f.bucket && s.acervo_id === f.acervo_id)) saida.push(f);
  };
  const fotos = card.fotos_livres || [];
  const ordenadas = [...fotos.filter((f) => f.papel === "fundo" && f.uso !== "rosto"), ...fotos.filter((f) => f.uso !== "rosto"), ...fotos];
  ordenadas.forEach((f) => adicionar({ caminho: f.caminho, bucket: "mesa", nome: f.nota || f.caminho.split("/").pop() || "Foto da lâmina", origem: "Fotos da lâmina", exata: f.uso !== "rosto", grupo: "cliente" }));
  (card.imagens_ids || []).forEach((id) => { const i = acervo.find((a) => a.id === id); if (i) adicionar({ caminho: i.storage_path, bucket: i.storage_bucket || "mesa", nome: i.nome, origem: "Acervo do cliente", url: urlDaFonteProfile(i.origem), exata: card.uso_do_acervo !== "rosto", acervo_id: i.id, grupo: "cliente" }); });
  const tipo = card.vitrine_tipo || "";
  const origem = tipo.startsWith("pagina_real") ? "Captura real da pesquisa" : tipo === "marca_real" ? "Logo real da pesquisa" : tipo === "pessoa_real" ? "Foto real da pesquisa" : "Imagem real da direção";
  (card.vitrine_de_logos || []).forEach((f) => adicionar({ caminho: f.caminho, bucket: "mesa", nome: f.nome || "Imagem real", origem, url: urlDaFonteProfile(f.url_origem) || urlDaFonteProfile(f.nome), exata: true, grupo: "internet" }));
  (card.fontes_reais || []).forEach((f) => adicionar({ caminho: f.caminho, bucket: "mesa", nome: f.nome, origem: origemDaPesquisa(f.fonte_url, f.tipo, f), url: urlDaFonteProfile(f.fonte_url), licenca: f.licenca || undefined, autor: f.autor || undefined, exata: true, grupo: "internet" }));
  // As geradas por último na lista, mas a mais nova primeiro entre elas.
  [...(card.imagens_do_template || [])].reverse().forEach((f) => adicionar({ caminho: f.caminho, bucket: "mesa", nome: f.descricao ? f.descricao.slice(0, 80) : "Foto gerada", origem: "Foto sem texto", exata: false, grupo: "gerada" }));
  return saida;
}

/** Compatibilidade com a escolha anterior; a preferência só pode apontar para uma fonte existente. */
export function fonteDoProfile(card: CardComFontes, acervo: ImagemDoAcervo[], preferida?: string, clientId?: string): { caminho: string; bucket: string } | null {
  const fontes = fontesDoProfile(card, acervo, clientId);
  const f = fontes.find((s) => s.caminho === preferida) || fontes[0];
  return f ? { caminho: f.caminho, bucket: f.bucket } : null;
}

/** Coordenadas do clique no PNG, relativas aos pixels da imagem inteira (exclui letterbox). */
export function pontoNaImagemProfile(x: number, y: number, imagem: { x: number; y: number; largura: number; altura: number } | null | undefined): { x: number; y: number } | null {
  if (!imagem || !Number.isFinite(x) || !Number.isFinite(y) || imagem.largura <= 0 || imagem.altura <= 0) return null;
  const px = (x - imagem.x) / imagem.largura, py = (y - imagem.y) / imagem.altura;
  return px >= 0 && px <= 1 && py >= 0 && py <= 1 ? { x: px, y: py } : null;
}
