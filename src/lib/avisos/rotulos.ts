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
  | "anuncios"
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
  commercial_caixa: "comercial",
  // 26/10: um aviso por boletim do Hermes (frente SERVIDOR), com link para /anuncios/hoje.
  ads_boletim: "anuncios",
};

/** O nome de alguns tipos (aparece no title do ícone do aviso). */
const ROTULO_DO_TIPO: Record<string, string> = {
  commercial: "Comercial",
  commercial_caixa: "Caixa do comercial",
};

export function rotuloDoTipoDoAviso(tipo: string | null | undefined): string {
  return (tipo && ROTULO_DO_TIPO[tipo]) || "";
}

export function categoriaDoAviso(tipo: string | null | undefined): CategoriaDoAviso {
  return (tipo && CATEGORIA[tipo]) || "geral";
}

/** Rota interna -> texto do link. A primeira que casar vence. */
const ROTULOS_DAS_ROTAS: Array<[string, string]> = [
  ["/anuncios/hoje", "Abrir Anúncios hoje"],
  ["/central/mensagens", "Abrir Mensagens da semana"],
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
  ["/comercial/caixa", "Abrir na Caixa do comercial"],
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

/**
 * Sino agrupado (26/10/2026): ~1.200 não lidos de ruído escondiam o que pede
 * decisão. Os avisos vêm em grupos por tipo, cada grupo com "Marcar todos como
 * lidos", e só o que pede decisão do dono ganha destaque.
 */
const PEDEM_DECISAO = new Set(["approval", "aprovacao_necessaria", "central_review_pendente", "operator_insumo", "operator_pronto"]);

/** Todos os tipos conhecidos de uma categoria (o grupo marca como lido também os que não estão na lista carregada). */
export function tiposDaCategoria(categoria: CategoriaDoAviso): string[] {
  return Object.keys(CATEGORIA).filter((t) => CATEGORIA[t] === categoria);
}

export function avisoPedeDecisao(tipo: string | null | undefined): boolean {
  return !!tipo && PEDEM_DECISAO.has(tipo);
}

export const NOME_DO_GRUPO: Record<CategoriaDoAviso, string> = {
  decisao: "Decisões e aprovações",
  pedido: "Pedidos de clientes",
  projeto: "Projetos",
  cobranca: "Cobrança",
  tarefa: "Tarefas",
  relatorio: "Relatórios",
  publicacao: "Publicações",
  entrega: "Entregas",
  alerta: "Alertas",
  agente: "Agentes",
  comercial: "Comercial",
  anuncios: "Anúncios",
  geral: "Outros avisos",
};

export interface GrupoDeAvisos<T> {
  categoria: CategoriaDoAviso;
  nome: string;
  itens: T[];
  naoLidos: number;
  /** Algum aviso do grupo pede decisão do dono (fica no topo e em destaque). */
  pedeDecisao: boolean;
  /** Os tipos do grupo (para marcar todos como lidos no banco). */
  tipos: string[];
}

/** Agrupa por tipo: primeiro o que pede decisão, depois os grupos com não lidos, depois o resto (mais novo antes). */
export function agruparAvisos<T extends { notification_type?: string | null; read?: boolean | null; created_at?: string | null }>(avisos: readonly T[]): Array<GrupoDeAvisos<T>> {
  const mapa = new Map<CategoriaDoAviso, GrupoDeAvisos<T>>();
  for (const a of avisos) {
    const cat = categoriaDoAviso(a.notification_type);
    let g = mapa.get(cat);
    if (!g) {
      g = { categoria: cat, nome: NOME_DO_GRUPO[cat], itens: [], naoLidos: 0, pedeDecisao: false, tipos: [] };
      mapa.set(cat, g);
    }
    g.itens.push(a);
    if (!a.read) g.naoLidos += 1;
    if (!a.read && avisoPedeDecisao(a.notification_type)) g.pedeDecisao = true;
    const tipo = a.notification_type || "";
    if (tipo && g.tipos.indexOf(tipo) < 0) g.tipos.push(tipo);
  }
  const maisNovo = (g: GrupoDeAvisos<T>) => g.itens.reduce((m, a) => ((a.created_at || "") > m ? a.created_at || "" : m), "");
  return Array.from(mapa.values()).sort((x, y) =>
    Number(y.pedeDecisao) - Number(x.pedeDecisao)
    || Number(y.naoLidos > 0) - Number(x.naoLidos > 0)
    || maisNovo(y).localeCompare(maisNovo(x)));
}
