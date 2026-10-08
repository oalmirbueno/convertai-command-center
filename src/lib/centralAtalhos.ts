/**
 * Atalhos da Central de Autonomia (08/10/2026): as Mesas e ferramentas do
 * painel com o cliente (e o projeto, quando a rota aceita) da conversa.
 * Rotas e parâmetros reais (App.tsx e as páginas): ?client= em todas,
 * project= no Kanban, Calendário e Arquivos, aba= na Mesa do Cliente.
 */

export type Atalho = { id: string; rotulo: string; descricao: string; caminho: string; precisaCliente: boolean };

export type ContextoDoAtalho = { clientId?: string | null; projectId?: string | null };

const comParams = (base: string, params: Record<string, string | null | undefined>) => {
  const q = Object.entries(params).filter(([, v]) => !!v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return q ? `${base}?${q}` : base;
};

export function atalhosDaCentral(c: ContextoDoAtalho): Atalho[] {
  const client = c.clientId || null;
  const project = c.projectId || null;
  return [
    { id: "mesa", rotulo: "Mesa do Cliente", descricao: "Contexto, Instagram, mês, campanhas, estúdio e entrega", caminho: comParams("/mesa", { client, aba: client ? "contexto" : null }), precisaCliente: true },
    { id: "mesa-ads", rotulo: "Mesa Ads", descricao: "Oferta, plano, criativos e campanhas", caminho: comParams("/mesa-ads", { client }), precisaCliente: true },
    { id: "mesa-foto", rotulo: "Produção de fotos", descricao: "Acervo, kits, ensaios e canvas", caminho: comParams("/mesa-foto", { client }), precisaCliente: true },
    { id: "mesa-videos", rotulo: "Produção de vídeos", descricao: "Roteiros, geração e resultados", caminho: comParams("/mesa-videos", { client }), precisaCliente: true },
    { id: "calendario", rotulo: "Calendário editorial", descricao: "Posts, datas e aprovações", caminho: comParams("/calendario", { client, project }), precisaCliente: false },
    { id: "workspace", rotulo: "Workspace", descricao: "Pastas e arquivos do cliente", caminho: comParams("/workspace", { client }), precisaCliente: false },
    { id: "arquivos", rotulo: "Arquivos e documentos", descricao: "Materiais, entregas e versões", caminho: comParams("/arquivos", { client, project }), precisaCliente: false },
    { id: "kanban", rotulo: "Kanban", descricao: "Tarefas do cliente e do projeto", caminho: comParams("/kanban", { client, project }), precisaCliente: false },
    { id: "projetos", rotulo: "Projetos e dossiê", descricao: "Ficha do cliente, projetos e contas", caminho: client ? comParams("/clientes", { client, project }) : "/projetos", precisaCliente: false },
    { id: "execucao", rotulo: "Execução dos agentes", descricao: "Trabalho, diário e decisões", caminho: "/execucao?aba=trabalho", precisaCliente: false },
    { id: "crm", rotulo: "CRM", descricao: "Oportunidades e agenda comercial", caminho: "/comercial/crm", precisaCliente: false },
  ];
}

/** Rota do painel para abrir DENTRO da Central (sem o menu do app). Só caminhos internos. */
export function caminhoEmbutido(caminho: string): string | null {
  if (!caminho.startsWith("/") || caminho.startsWith("//")) return null;
  return `${caminho}${caminho.includes("?") ? "&" : "?"}embutido=1`;
}

/** Endereço externo aceito no navegador integrado (só http/https, sem credencial na URL). */
export function enderecoExterno(bruto: string): string | null {
  let t = String(bruto || "").trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
