/**
 * Esteira de producao: o Ciclo deixa de sortear etapas genericas e passa a
 * derivar, item por item, o que existe de verdade na operacao de cada
 * cliente. Cada item nasce de um fato (um post no seu estagio, uma tarefa,
 * uma campanha, um item de checklist, um marco, um passo de onboarding) e
 * carrega o NOME daquele fato. Se o fato nao existe, o item nao existe.
 */

export type Frente = "social" | "trafego" | "geral";

export type Fonte =
  | "onboarding"
  | "post"
  | "agenda"
  | "anuncio"
  | "tarefa"
  | "checklist"
  | "marco";

export type Gravidade = "urgente" | "atencao" | "normal";

export type EstadoHumano = "done" | "snoozed" | "ignored";

export interface EsteiraItem {
  /** Estavel entre recargas: nasce do id do fato, nunca do texto. */
  key: string;
  clientId: string;
  frente: Frente;
  fonte: Fonte;
  /** O nome do item real: titulo do post, da campanha, da tarefa. */
  titulo: string;
  /** O proximo elo que falta, no vocabulario do dono. */
  passo: string;
  gravidade: Gravidade;
  /** Evidencias curtas que sustentam o item (datas, contagens). */
  fatos: string[];
  /** Tela onde se resolve. */
  rota?: string;
  /** Quando depende de outro item ainda aberto (onboarding). */
  bloqueadoPor?: string;
  /** Data limite, quando o fato tem uma. ISO yyyy-mm-dd. */
  vencimento?: string;
  /** Marcacao desta semana, se houver. `auto` = o painel provou sozinho
      (post publicado, tarefa concluida); nao se desfaz com o dedo. */
  estado?: { status: EstadoHumano; note?: string | null; doneAt?: string | null; auto?: boolean };
  /** Posicao fixa dentro da fonte (onboarding usa a ordem do catalogo). */
  ordem?: number;
}

export interface Insight {
  key: string;
  clientId: string;
  frente: Frente;
  titulo: string;
  atual: number | null;
  anteriores: number[];
  /** Variacao percentual contra o periodo imediatamente anterior. */
  variacao: number | null;
  tendencia: "sobe" | "cai" | "igual" | "sem-base";
  texto: string;
}

export type RitualKey = "segunda" | "quarta" | "sexta";

export interface RitualDaSemana {
  key: RitualKey;
  rotulo: string;
  feito: boolean;
  fonte?: "manual" | "central";
  doneAt?: string | null;
}

export interface EsteiraDoCliente {
  clientId: string;
  itens: EsteiraItem[];
  /** Itens marcados como feitos nesta semana (ficam visiveis, riscados). */
  feitos: EsteiraItem[];
  insights: Insight[];
  rituais: RitualDaSemana[];
  onboardingCompleto: boolean;
  resumo: { urgentes: number; atencao: number; normais: number; total: number };
}

/* ── Fatos item a item ── */

export interface PublicacaoFato {
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
}

export interface PostFato {
  id: string;
  titulo: string;
  productionStatus: string | null;
  criadoEm: string | null;
  temArte: boolean;
  aprovCliente: string | null;
  aprovAgencia: string | null;
  aprovPedidaEm: string | null;
  temLegenda: boolean;
  publicacoes: PublicacaoFato[];
}

export interface TarefaFato {
  id: string;
  titulo: string;
  status: string | null;
  dueDate: string | null;
  assignedTo: string | null;
  source: string | null;
  /** Ultima mexida; e como sabemos que foi concluida NESTA semana. */
  updatedAt: string | null;
}

export interface CampanhaDiaFato {
  day: string;
  spend: number;
  leads: number;
  frequency: number | null;
}

export interface CampanhaFato {
  id: string;
  nome: string;
  ativa: boolean;
  diario: CampanhaDiaFato[];
}

export interface ChecklistFato {
  memId: string;
  titulo: string;
  itens: Array<{ idx: number; texto: string; done: boolean }>;
}

export interface MarcoFato {
  id: string;
  titulo: string;
  status: string | null;
  targetDate: string | null;
}

export interface ConexaoFato {
  provider: string;
  status: string | null;
}

export interface MetricaSemanaFato {
  accountId: string;
  weekStart: string;
  reach: number | null;
  followers: number | null;
  interactions: number | null;
}

export interface FatosDoCliente {
  clientId: string;
  criadoEm: string | null;
  servicos: { social: boolean; trafego: boolean };
  posts: PostFato[];
  tarefas: TarefaFato[];
  campanhas: CampanhaFato[];
  saldoVerba: number | null;
  checklists: ChecklistFato[];
  marcos: MarcoFato[];
  conexoes: ConexaoFato[];
  metricas: MetricaSemanaFato[];
  briefingRespondido: boolean;
  dossieResumo: string | null;
  /** O que o cliente ja tem, marcado a mao (chave de onboarding -> true/false). */
  onboardingHas: Record<string, boolean>;
  /** Marcacao humana desta semana por chave de item. */
  estados: Record<string, { status: EstadoHumano; note: string | null; doneAt: string | null }>;
  /** Rituais ja marcados nesta semana. */
  rituais: Array<{ key: RitualKey; source: "manual" | "central"; doneAt: string | null }>;
  /** Frentes em que o cliente esta oculto, e ate quando (null = sempre). */
  oculto: { areas: string[]; ate: string | null };
}
