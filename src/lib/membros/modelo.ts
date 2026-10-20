export type OrigemDoAcesso =
  "compra" | "manual" | "plano" | "gratuito" | "administracao";
export type Produto = {
  id: string;
  titulo: string;
  descricao: string;
  categoria: string;
  formato: string;
  capa_url: string | null;
  estado: "rascunho" | "publicado" | "arquivado";
  gratuito: boolean;
  destaque: boolean;
  checkout_url: string | null;
  condicoes: string;
  ordem: number;
  origens: OrigemDoAcesso[];
  progresso: number;
  ultimo_material: string | null;
};
export type Material = {
  id: string;
  produto_id: string;
  titulo: string;
  tipo: "texto" | "video" | "audio" | "pdf" | "arquivo";
  texto: string;
  arquivo: string | null;
  permite_download: boolean;
  ordem: number;
};
export type Progresso = {
  material_id: string;
  posicao: number;
  duracao: number;
  concluido: boolean;
  atualizado_em: string;
};
export type ItemChecklist = {
  chave: string;
  estado: "pendente" | "em_andamento" | "bloqueado" | "concluido";
  observacao: string;
  evidencia: string;
  atualizado_em: string;
  atualizado_por: string | null;
  autor_nome?: string;
};
export type Catalogo = {
  produtos: Produto[];
  pendentes: { produto_id: string; estado: string }[];
};

export function podeAbrir(p: Produto): boolean {
  return p.origens.length > 0;
}
export function rotuloDoAcesso(p: Produto): string {
  if (p.origens.includes("compra")) return "Adquirido";
  if (p.origens.includes("plano")) return "Incluído no plano";
  if (p.origens.includes("manual")) return "Acesso concedido";
  if (p.origens.includes("gratuito")) return "Gratuito";
  if (p.origens.includes("administracao")) return "Administração";
  return "Disponível para compra";
}
export function urlHttps(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function buscarProdutos(
  produtos: Produto[],
  busca: string,
  categoria: string,
): Produto[] {
  const normalizar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const q = normalizar(busca.trim());
  return produtos.filter(
    (p) =>
      (!categoria || p.categoria === categoria) &&
      (!q ||
        normalizar(`${p.titulo} ${p.descricao} ${p.categoria}`).includes(q)),
  );
}
export function trilhos(produtos: Produto[]) {
  return [
    {
      titulo: "Continue de onde parou",
      produtos: produtos.filter(
        (p) =>
          podeAbrir(p) &&
          p.progresso > 0 &&
          p.progresso < 100 &&
          p.ultimo_material,
      ),
    },
    {
      titulo: "Minha biblioteca",
      produtos: produtos.filter(
        (p) => podeAbrir(p) && !p.origens.includes("gratuito"),
      ),
    },
    {
      titulo: "Incluídos no seu plano",
      produtos: produtos.filter((p) => p.origens.includes("plano")),
    },
    { titulo: "Gratuitos", produtos: produtos.filter((p) => p.gratuito) },
    {
      titulo: "Explorar produtos",
      produtos: produtos.filter((p) => !podeAbrir(p)),
    },
  ].filter((t) => t.produtos.length);
}
export function destinoOperacional(papel: string | undefined): string {
  return ["admin", "client", "design", "traffic", "manager"].includes(
    papel || "",
  )
    ? "/dashboard"
    : "/solucoes";
}
