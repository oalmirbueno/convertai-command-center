/**
 * Atalhos da Central de Autonomia (08/10/2026; 09/10: design, dossiê e
 * diário): as Mesas e ferramentas do painel com o cliente (e o projeto,
 * quando a rota aceita) da conversa. Rotas e parâmetros reais (App.tsx e as
 * páginas): ?client= em todas, project= no Kanban, Calendário e Arquivos,
 * aba= na Mesa do Cliente.
 *
 * Abrem num pop-up interno grande (padrão), na lateral ou na área maior, em
 * modo embutido (?embutido=1: sem a casca do painel e sem o seletor de mesa e
 * de cliente, que vêm da conversa). Objetos (tarefa, memória, aprovação,
 * arquivo...) não passam por aqui: abrem na lateral nativa.
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
    { id: "workspace", rotulo: "Workspace", descricao: "Pastas e arquivos do cliente", caminho: comParams("/workspace", { client }), precisaCliente: false },
    { id: "arquivos", rotulo: "Arquivos", descricao: "Materiais, entregas e versões", caminho: comParams("/arquivos", { client, project }), precisaCliente: false },
    { id: "mesa-ads", rotulo: "Mesa Ads", descricao: "Oferta, plano, criativos e campanhas", caminho: comParams("/mesa-ads", { client }), precisaCliente: true },
    { id: "mesa", rotulo: "Mesa do Cliente", descricao: "Instagram, mês, campanhas, estúdio e entrega", caminho: comParams("/mesa", { client }), precisaCliente: true },
    { id: "design", rotulo: "Design", descricao: "Identidade, mockups e naming", caminho: comParams("/mesa-identidade", { client }), precisaCliente: true },
    { id: "calendario", rotulo: "Calendário", descricao: "Posts, datas e aprovações", caminho: comParams("/calendario", { client, project }), precisaCliente: false },
    { id: "projetos", rotulo: "Projetos", descricao: "Ficha do cliente, projetos e contas", caminho: client ? comParams("/clientes", { client, project }) : "/projetos", precisaCliente: false },
    { id: "dossie", rotulo: "Dossiê", descricao: "Segundo cérebro e dossiê do cliente", caminho: comParams("/mesa", { client, aba: client ? "contexto" : null }), precisaCliente: true },
    { id: "kanban", rotulo: "Kanban", descricao: "Tarefas do cliente e do projeto", caminho: comParams("/kanban", { client, project }), precisaCliente: false },
    { id: "mesa-foto", rotulo: "Fotos", descricao: "Acervo, kits, ensaios e canvas", caminho: comParams("/mesa-foto", { client }), precisaCliente: true },
    { id: "mesa-videos", rotulo: "Vídeos", descricao: "Roteiros, geração e resultados", caminho: comParams("/mesa-videos", { client }), precisaCliente: true },
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
