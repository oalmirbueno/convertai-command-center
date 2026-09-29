import dados from "../../.aceleriq/pacote.json";

export type SecaoDaCopy = { id: string; titulo: string; texto: string; itens: string[] };
export type Copy = {
  headline: string;
  subtitulo: string;
  cta: string;
  secoes: SecaoDaCopy[];
  faq: Array<{ pergunta: string; resposta: string }>;
  seo: { titulo: string; descricao: string; palavras: string[] };
};
export type Pacote = {
  cliente: string;
  marca: { nome: string; negocio?: string; publico?: string; oferta?: string; tom?: string; diferenciais?: string[] };
  paleta: Array<{ hex: string; nome?: string; papel?: string }>;
  fontes: Array<{ nome: string; papel: string }>;
  copy: Copy | null;
  imagens: Array<{ slot: string; arquivo: string; alt: string }>;
  fotos_reais: Array<{ arquivo: string; alt: string }>;
  logo: string | null;
  secoes: string[];
  regras_da_equipe?: string[];
};

/** O pacote do cliente (marca, copy, imagens, logo). Só leitura. */
export const pacote = dados as unknown as Pacote;

/** Texto de uma seção da copy escolhida (ou null). */
export const copyDa = (id: string): SecaoDaCopy | null => (pacote.copy ? pacote.copy.secoes.find((s) => s.id === id) || null : null);

/** Imagem gerada de um slot (hero, secao, fundo, detalhe), ou null. */
export const imagemDo = (slot: string) => pacote.imagens.find((i) => i.slot === slot) || null;
