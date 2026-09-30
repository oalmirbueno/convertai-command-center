import dados from "../../.aceleriq/pacote.json";

export type SecaoDaCopy = { id: string; titulo: string; texto: string; itens: string[]; cta?: string };
export type Copy = {
  headline: string;
  subtitulo: string;
  cta: string;
  secoes: SecaoDaCopy[];
  faq: Array<{ pergunta: string; resposta: string }>;
  seo: { titulo: string; descricao: string; palavras: string[] };
};
export type PaginaDoSite = { id: string; slug: string; titulo: string; secoes: string[] };
export type Integracoes = {
  whatsapp: { numero: string; mensagem: string; link: string } | null;
  formulario: { endpoint: string; chave: string; campos: string[]; agradecimento: string } | null;
  pixel_meta: string | null;
  ga4: string | null;
  mapa: { endereco: string; embed: string } | null;
  cookies: { politica_url: string | null } | null;
};
export type Pacote = {
  cliente: string;
  marca: { nome: string; negocio?: string; publico?: string; oferta?: string; tom?: string; diferenciais?: string[] };
  paleta: Array<{ hex: string; nome?: string; papel?: string }>;
  fontes: Array<{ nome: string; papel: string }>;
  copy: Copy | null;
  imagens: Array<{ slot: string; arquivo: string; alt: string; secao?: string | null }>;
  fotos_reais: Array<{ arquivo: string; alt: string; secao?: string | null }>;
  logo: string | null;
  secoes: string[];
  regras_da_equipe?: string[];
  /** Multipágina (Mesa Site SIT2). Pacote antigo não tem: o site é de uma página. */
  paginas?: PaginaDoSite[];
  globais?: string[];
  integracoes?: Integracoes | null;
  seo?: { titulo?: string; descricao?: string; url?: string | null; og_imagem?: string | null; indexar?: boolean; robots?: string; schema?: Record<string, unknown> | null } | null;
};

/** O pacote do cliente (marca, copy, imagens, logo, páginas, integrações). Só leitura. */
export const pacote = dados as unknown as Pacote;

/** Texto de uma seção da copy escolhida (ou null). */
export const copyDa = (id: string): SecaoDaCopy | null => (pacote.copy ? pacote.copy.secoes.find((s) => s.id === id) || null : null);

/** Imagem gerada de um slot (hero, secao, fundo, detalhe), ou null. Com a seção, prefere a imagem dela. */
export const imagemDo = (slot: string, secao?: string) =>
  (secao ? pacote.imagens.find((i) => i.slot === slot && i.secao === secao) : null) || pacote.imagens.find((i) => i.slot === slot && !i.secao) || pacote.imagens.find((i) => i.slot === slot) || null;

/** Todas as imagens (geradas) de uma seção, na ordem. */
export const imagensDaSecao = (secao: string) => pacote.imagens.filter((i) => i.secao === secao);

/** Fotos reais de uma seção (ou todas, sem a seção). */
export const fotosReais = (secao?: string) => (secao ? pacote.fotos_reais.filter((f) => f.secao === secao) : pacote.fotos_reais);

/** As páginas do site (uma só no pacote antigo). */
export const paginas = (): PaginaDoSite[] => (pacote.paginas && pacote.paginas.length ? pacote.paginas : []);

/** Endereço de uma página ("/" na inicial, "/sobre/" nas outras). */
export const caminhoDa = (p: Pick<PaginaDoSite, "slug">) => (p.slug ? `/${p.slug}/` : "/");

/** A página de um endereço (a inicial quando nenhuma casa). */
export function paginaPeloCaminho(caminho: string): PaginaDoSite | null {
  const lista = paginas();
  if (!lista.length) return null;
  const slug = String(caminho || "/").replace(/^\/+|\/+$/g, "").split("/")[0] || "";
  return lista.find((p) => p.slug === slug) || lista[0];
}
