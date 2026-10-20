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
  materiais_total?: number;
  materiais_concluidos?: number;
  tipo_produto?: "curso" | "material" | "comunidade";
  landing_url?: string | null;
  landing_embutida?: boolean;
  checkout_embutido?: boolean;
  em_venda?: boolean;
  cta?: string;
  comunidade_ativa?: boolean;
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
  modulo_id?: string | null;
  aula_id?: string | null;
  estado?: "rascunho" | "publicado" | "arquivado";
};
export type Modulo = {
  id: string;
  produto_id: string;
  titulo: string;
  descricao: string;
  ordem: number;
  estado: "rascunho" | "publicado" | "arquivado";
};
export type PassoFunil = {
  id: string;
  produto_origem: string;
  produto_destino: string;
  momento: "sempre" | "concluiu";
  titulo: string;
  ordem: number;
  ativo: boolean;
};
export function semTravessoes(s: string): string {
  return s.replace(/\s*[\u2013\u2014]\s*/g, ": ");
}
export function limparProduto(p: Produto): Produto {
  return {
    ...p,
    cta: p.cta ? semTravessoes(p.cta) : p.cta,
    titulo: semTravessoes(p.titulo),
    descricao: semTravessoes(p.descricao),
    condicoes: semTravessoes(p.condicoes),
    formato: semTravessoes(p.formato),
    categoria: semTravessoes(p.categoria),
  };
}
export function limparMaterial(m: Material): Material {
  return {
    ...m,
    titulo: semTravessoes(m.titulo),
    texto: semTravessoes(m.texto),
  };
}
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
  jornada?: {
    materiais: number;
    concluidos: number;
    produtos_concluidos: number;
    em_andamento: number;
  };
};
export type TesteCliente = { teste: true; bloqueado: boolean };

export function podeAbrir(p: Produto): boolean {
  return p.origens.length > 0;
}
export function rotuloDoAcesso(p: Produto): string {
  if (p.origens.includes("compra")) return "Adquirido";
  if (p.origens.includes("plano")) return "Incluído no plano";
  if (p.origens.includes("manual")) return "Acesso concedido";
  if (p.origens.includes("gratuito")) return "Gratuito";
  if (p.origens.includes("administracao")) return "Administração";
  return p.em_venda === false
    ? "Aguardando liberação"
    : "Disponível para compra";
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
