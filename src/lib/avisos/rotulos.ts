import { safeInternalPath, safePublicPostUrl } from "@/lib/internalNavigation";

/**
 * Rótulos do sino: que cara tem cada tipo de aviso e o que diz o link.
 * Puro, para o teste. Tipo desconhecido cai no sino genérico (nunca some).
 */

export type CategoriaDoAviso =
  | "decisao"
  | "pedido"
  | "projeto"
  | "cobranca"
  | "tarefa"
  | "relatorio"
  | "publicacao"
  | "entrega"
  | "alerta"
  | "agente"
  | "comercial"
  | "geral";

const CATEGORIA: Record<string, CategoriaDoAviso> = {
  approval: "decisao",
  aprovacao_necessaria: "decisao",
  central_review_pendente: "decisao",
  central_review_decidida: "decisao",
  central_review_enviada: "decisao",
  request: "pedido",
  project: "projeto",
  update: "projeto",
  billing: "cobranca",
  task: "tarefa",
  responsavel_designado: "tarefa",
  responsavel_sugerido: "tarefa",
  report: "relatorio",
  publication: "publicacao",
  perfis_instagram: "publicacao",
  delivery: "entrega",
  agendamento_atrasado: "alerta",
  operator: "agente",
  operator_pronto: "agente",
  operator_insumo: "agente",
  operator_executou: "agente",
  commercial: "comercial",
};

export function categoriaDoAviso(tipo: string | null | undefined): CategoriaDoAviso {
  return (tipo && CATEGORIA[tipo]) || "geral";
}

/** Rota interna -> texto do link. A primeira que casar vence. */
const ROTULOS_DAS_ROTAS: Array<[string, string]> = [
  ["/ciclo/revisao", "Abrir a revisão"],
  ["/aprovacoes", "Ver Arquivo"],
  ["/calendario", "Abrir na Agenda"],
  ["/mesa", "Abrir na Mesa"],
  ["/execucao", "Abrir na Execução"],
  ["/clientes", "Ver cliente"],
  ["/documentos", "Ver entregas"],
  ["/onde-estamos", "Ver atualização"],
  ["/projetos", "Ver Projeto"],
  ["/dashboard", "Ver Projeto"],
  ["/relatorios", "Ver Relatório"],
  ["/financeiro", "Ver Financeiro"],
  ["/pedidos", "Ver Pedido"],
  ["/kanban", "Ver Tarefas"],
  ["/comercial", "Abrir o Comercial"],
];

export function rotuloDoLink(link: string | null | undefined): string {
  if (!link) return "Abrir";
  // O link do post publicado sai do painel: dizer para onde evita o clique
  // às cegas.
  if (safePublicPostUrl(link)) return "Ver publicação no Instagram";
  const interno = safeInternalPath(link);
  if (!interno) return "Abrir";
  const caminho = interno.split("?")[0];
  for (const [rota, rotulo] of ROTULOS_DAS_ROTAS) {
    if (caminho === rota || caminho.indexOf(rota + "/") === 0) return rotulo;
  }
  return "Abrir";
}
