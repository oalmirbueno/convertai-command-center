import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { chamarFuncao, type ModeloIa, type ParteDaEstimativa, type Qualidade } from "@/lib/mesa/api";
import { normalizarFoto, semearUrl, type FotoDoAcervo } from "./fotoApi";

/**
 * Book (pedido do dono, 26/09): o estúdio fotográfico do produto ou da
 * pessoa dentro da Mesa Foto. Escolhe o assunto (produto do kit, persona
 * sintética, clone autorizado ou foto do acervo), usa o arsenal de prompts da
 * biblioteca, conversa com o diretor que monta os pedidos, gera em lote com o
 * custo antes, seleciona as boas e fecha o book em ordem (baixar em alta,
 * aprovação, Arquivos). Leitura e escrita pela função mesa-foto (book.ts;
 * tabela da migration 05), com o erro já traduzido.
 */

export type TipoDoAssunto = "produto" | "persona" | "clone" | "foto";

export const TIPOS_DO_ASSUNTO: { valor: TipoDoAssunto; rotulo: string; dica: string }[] = [
  { valor: "produto", rotulo: "Produto", dica: "Um produto identificado (kit): as fotos dele são a verdade." },
  { valor: "persona", rotulo: "Persona", dica: "Pessoa sintética de Modelos, com a âncora escolhida." },
  { valor: "clone", rotulo: "Pessoa real (clone)", dica: "Clone com a autorização registrada." },
  { valor: "foto", rotulo: "Foto do acervo", dica: "O assunto de uma foto do acervo." },
];

export const FORMATOS_DO_BOOK = ["4:5", "1:1", "9:16", "16:9", "3:4"];
export const MAX_ESTILO_POR_FOTO = 3;

export interface PedidoDoBook {
  id: string;
  titulo: string;
  prompt: string;
  formato: string;
  origem: { tipo: "biblioteca" | "diretor" | "livre"; id: string | null };
  /** Referências de estilo só deste pedido (ids do book); vazio = as primeiras do book. */
  referencias: string[];
}

export interface ReferenciaDoBook {
  tipo: "acervo" | "biblioteca";
  id: string;
  titulo: string;
  storage_path: string | null;
  url: string | null;
}

export interface MensagemDoBook {
  papel: "equipe" | "diretor";
  texto: string;
  em: string;
}

export interface Book {
  id: string;
  client_id: string;
  nome: string;
  assunto: { tipo: TipoDoAssunto; id: string; nome: string };
  referencias: { tipo: "acervo" | "biblioteca"; id: string }[];
  pedidos: PedidoDoBook[];
  selecao: string[];
  conversa: MensagemDoBook[];
  status: "aberto" | "entregue" | "arquivado";
  custo_usd: number;
  atualizado_em: string;
}

export interface ResumoDoAssunto {
  tipo: TipoDoAssunto;
  id: string;
  nome: string;
  capa_url: string | null;
  detalhe: string;
  categorias: string[];
  aviso: string | null;
}

export interface BookAberto {
  book: Book;
  assunto: ResumoDoAssunto;
  resultados: FotoDoAcervo[];
  referencias: ReferenciaDoBook[];
}

const texto = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(texto).filter(Boolean) : []);
const tipoDoAssunto = (v: unknown): TipoDoAssunto => (v === "persona" || v === "clone" || v === "foto" ? v : "produto");

let contador = 0;
export const novoIdDePedido = () => `p${Date.now().toString(36)}${(contador++).toString(36)}`.slice(0, 30);

export function normalizarPedido(v: any): PedidoDoBook | null {
  if (!v || typeof v !== "object") return null;
  const prompt = texto(v.prompt).trim();
  if (!prompt) return null;
  const o = v.origem && typeof v.origem === "object" ? v.origem : {};
  return {
    id: texto(v.id) || novoIdDePedido(),
    titulo: texto(v.titulo) || prompt.slice(0, 60),
    prompt,
    formato: FORMATOS_DO_BOOK.indexOf(texto(v.formato)) >= 0 ? texto(v.formato) : "4:5",
    origem: { tipo: o.tipo === "biblioteca" || o.tipo === "diretor" ? o.tipo : "livre", id: texto(o.id) || null },
    referencias: lista(v.referencias).slice(0, MAX_ESTILO_POR_FOTO),
  };
}

export function normalizarBook(v: any): Book | null {
  if (!v || typeof v !== "object" || !v.id) return null;
  const a = v.assunto && typeof v.assunto === "object" ? v.assunto : {};
  return {
    id: String(v.id),
    client_id: texto(v.client_id),
    nome: texto(v.nome) || "Book",
    assunto: { tipo: tipoDoAssunto(a.tipo), id: texto(a.id), nome: texto(a.nome) },
    referencias: (Array.isArray(v.referencias) ? v.referencias : [])
      .filter((r: any) => r && (r.tipo === "acervo" || r.tipo === "biblioteca") && r.id)
      .map((r: any) => ({ tipo: r.tipo, id: String(r.id) })),
    pedidos: (Array.isArray(v.pedidos) ? v.pedidos : []).map(normalizarPedido).filter(Boolean) as PedidoDoBook[],
    selecao: lista(v.selecao),
    conversa: (Array.isArray(v.conversa) ? v.conversa : [])
      .filter((m: any) => m && texto(m.texto))
      .map((m: any) => ({ papel: m.papel === "diretor" ? "diretor" : "equipe", texto: texto(m.texto), em: texto(m.em) })),
    status: v.status === "entregue" || v.status === "arquivado" ? v.status : "aberto",
    custo_usd: Number(v.custo_usd) || 0,
    atualizado_em: texto(v.atualizado_em),
  };
}

function normalizarResumo(v: any, book: Book): ResumoDoAssunto {
  const r = v && typeof v === "object" ? v : {};
  return {
    tipo: tipoDoAssunto(r.tipo || book.assunto.tipo),
    id: texto(r.id) || book.assunto.id,
    nome: texto(r.nome) || book.assunto.nome || "Assunto",
    capa_url: texto(r.capa_url) || null,
    detalhe: texto(r.detalhe),
    categorias: lista(r.categorias),
    aviso: texto(r.aviso) || null,
  };
}

export function normalizarBookAberto(data: any): BookAberto | null {
  const book = normalizarBook(data && data.book);
  if (!book) return null;
  return {
    book,
    assunto: normalizarResumo(data.assunto, book),
    resultados: (Array.isArray(data.resultados) ? data.resultados : []).map((i: any) => normalizarFoto(i)).filter(Boolean) as FotoDoAcervo[],
    referencias: (Array.isArray(data.referencias) ? data.referencias : [])
      .filter((r: any) => r && r.id)
      .map((r: any) => ({ tipo: r.tipo === "biblioteca" ? "biblioteca" : "acervo", id: String(r.id), titulo: texto(r.titulo) || "Referência", storage_path: texto(r.storage_path) || null, url: texto(r.url) || null })),
  };
}

export const chaveDosBooks = (clientId: string) => ["mesa-foto", "books", clientId];
export const chaveDoBook = (id: string) => ["mesa-foto", "book", id];

export function useBooks(clientId: string) {
  return useQuery({
    queryKey: chaveDosBooks(clientId),
    enabled: !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<Book[]> => {
      const data = await chamarFuncao<any>("mesa-foto", { acao: "books_listar", client_id: clientId });
      return (data && Array.isArray(data.books) ? data.books : []).map(normalizarBook).filter(Boolean) as Book[];
    },
  });
}

export function useBookAberto(id: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: chaveDoBook(id || ""),
    enabled: !!id,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<BookAberto | null> => {
      const data = await chamarFuncao<any>("mesa-foto", { acao: "book_ler", book_id: id });
      // As URLs que a função já assinou vão para o cache: as fotos aparecem sem outra ida ao Storage.
      semearUrlsDoBook(queryClient, data);
      return normalizarBookAberto(data);
    },
  });
}

/** Semeia as URLs da leitura do book (resultados e referências) no cache das imagens. */
export function semearUrlsDoBook(queryClient: QueryClient, data: any) {
  (Array.isArray(data && data.resultados) ? data.resultados : []).forEach((i: any) => semearUrl(queryClient, i && i.storage_bucket, i && i.storage_path, i && i.url));
}

/** Muda o book aberto no cache (seleção, pedidos, resultado novo) antes da função responder. */
export function mudarBookAberto(queryClient: QueryClient, id: string, mudar: (b: BookAberto) => BookAberto) {
  queryClient.setQueryData<BookAberto | null>(chaveDoBook(id), (b) => (b ? mudar(b) : b));
}

export function guardarBookNaLista(queryClient: QueryClient, clientId: string, b: Book) {
  queryClient.setQueryData<Book[]>(chaveDosBooks(clientId), (l) => {
    const atual = l || [];
    return atual.some((x) => x.id === b.id) ? atual.map((x) => (x.id === b.id ? b : x)) : [b].concat(atual);
  });
}

// ------------------------------------------------------------------ ações

export async function criarBook(clientId: string, assunto: { tipo: TipoDoAssunto; id: string }, nome?: string): Promise<{ book: Book | null; assunto: ResumoDoAssunto | null }> {
  const corpo: Record<string, unknown> = { acao: "book_criar", client_id: clientId, assunto };
  if (nome && nome.trim()) corpo.nome = nome.trim();
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const book = normalizarBook(data && data.book);
  return { book, assunto: book ? normalizarResumo(data.assunto, book) : null };
}

/** Grava partes do book (nome, referências, pedidos, seleção, status). */
export async function salvarBook(bookId: string, campos: { nome?: string; referencias?: Book["referencias"]; pedidos?: PedidoDoBook[]; selecao?: string[]; status?: Book["status"] }): Promise<Book | null> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "book_salvar", book_id: bookId, ...campos });
  return normalizarBook(data && data.book);
}

export async function conversarNoBook(p: { bookId: string; mensagem: string; promptIds: string[]; quantidade: number }) {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "book_diretor", book_id: p.bookId, mensagem: p.mensagem, prompt_ids: p.promptIds, quantidade: p.quantidade });
  return {
    resposta: texto(data && data.resposta),
    pedidos: (Array.isArray(data && data.pedidos) ? data.pedidos : []).map(normalizarPedido).filter(Boolean) as PedidoDoBook[],
    conversa: (Array.isArray(data && data.conversa) ? data.conversa : []).map((m: any) => ({ papel: m && m.papel === "diretor" ? "diretor" : "equipe", texto: texto(m && m.texto), em: texto(m && m.em) })) as MensagemDoBook[],
    avisos: lista(data && data.avisos),
    custo_usd: data && data.custo_usd,
  };
}

/** Uma foto do book (UMA por chamada; a tela roda o lote e mostra cada uma assim que sai). */
export async function gerarNoBook(p: { bookId: string; pedido: PedidoDoBook; qualidade: Qualidade }): Promise<{ imagem: FotoDoAcervo | null; url: string | null; custo_usd?: number; avisos: string[] }> {
  const data = await chamarFuncao<any>("mesa-foto", {
    acao: "book_gerar",
    book_id: p.bookId,
    pedido: { titulo: p.pedido.titulo, prompt: p.pedido.prompt, formato: p.pedido.formato, referencias: p.pedido.referencias, origem: p.pedido.origem },
    qualidade: p.qualidade,
  });
  const url = data && data.imagem && typeof data.imagem.url === "string" ? data.imagem.url : data && typeof data.url === "string" ? data.url : null;
  return { imagem: normalizarFoto(data && data.imagem), url, custo_usd: data && data.custo_usd, avisos: lista(data && data.avisos) };
}

// ------------------------------------------------------------------ custo (conta local de reserva; a função dá o preço certo)

export function partesDoBook(motorId: string | null, qualidade: Qualidade, referencias: number, vezes: number): ParteDaEstimativa[] {
  return [{ modeloId: motorId, tipo: "imagem", imagens: 1, qualidade, tokensEntrada: 2500 + Math.max(1, referencias) * 1600, vezes: Math.max(1, vezes) }];
}

export function partesDoDiretorDoBook(diretor: ModeloIa | null): ParteDaEstimativa[] {
  return [{ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: 12000, tokensSaida: 2500 }];
}

/** Move um item da seleção (o book final tem ordem). */
export function moverNaSelecao(selecao: string[], id: string, passo: -1 | 1): string[] {
  const i = selecao.indexOf(id);
  const j = i + passo;
  if (i < 0 || j < 0 || j >= selecao.length) return selecao;
  const nova = selecao.slice();
  nova[i] = selecao[j];
  nova[j] = id;
  return nova;
}

/** Pedido novo a partir de um prompt da biblioteca (o texto em português primeiro). */
export function pedidoDaBiblioteca(item: { id: string; titulo: string; prompt_pt: string; prompt_en: string }, formato = "4:5"): PedidoDoBook | null {
  const prompt = (item.prompt_pt || item.prompt_en || "").trim();
  if (!prompt) return null;
  return { id: novoIdDePedido(), titulo: item.titulo, prompt, formato, origem: { tipo: "biblioteca", id: item.id }, referencias: [] };
}
