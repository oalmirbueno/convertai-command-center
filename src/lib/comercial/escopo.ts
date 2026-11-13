/**
 * De quem é o CRM que está na tela.
 *
 * O Comercial da casa e o CRM que o cliente assina são as mesmas telas e as
 * mesmas regras. O que muda é onde o dado mora: a casa usa as tabelas
 * `commercial_*`; a empresa cliente usa as `crm_*`, que têm a mesma estrutura
 * mais o `conta_id`, e o banco só entrega as linhas da empresa de quem está
 * logado. Por isso o front não manda `conta_id` em lugar nenhum: troca o nome
 * da tabela e pronto.
 *
 * O escopo é definido pela casca que monta a tela (o produto define "conta";
 * o painel da casa não define nada e fica em "casa").
 */

export type EscopoDoCrm =
  | { modo: "casa" }
  | {
      modo: "conta";
      contaId: string;
      /** Endereço base das abas do CRM dentro do produto. */
      base: string;
      /** Quem pode ser dono de um negócio: a equipe da empresa. */
      equipe: Array<{ id: string; nome: string }>;
      /** O que o plano da empresa libera. */
      limites: LimitesDoPlano;
      maquinaNoMes: number;
    };

export interface LimitesDoPlano {
  maquina_buscas_mes: number;
  maquina_google_maps: boolean;
  maquina_limite_por_busca: number;
  privacidade_por_vendedor: boolean;
  campanhas: boolean;
}

export const LIMITES_PADRAO: LimitesDoPlano = {
  maquina_buscas_mes: 0,
  maquina_google_maps: false,
  maquina_limite_por_busca: 50,
  privacidade_por_vendedor: false,
  campanhas: false,
};

/** Lê os limites do plano como vieram do banco, sem confiar no formato. */
export function limitesDoPlano(bruto: unknown): LimitesDoPlano {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const numero = (v: unknown, padrao: number) => (typeof v === "number" && isFinite(v) && v >= 0 ? Math.floor(v) : padrao);
  return {
    maquina_buscas_mes: numero(o.maquina_buscas_mes, LIMITES_PADRAO.maquina_buscas_mes),
    maquina_google_maps: o.maquina_google_maps === true,
    maquina_limite_por_busca: Math.max(1, numero(o.maquina_limite_por_busca, LIMITES_PADRAO.maquina_limite_por_busca)),
    privacidade_por_vendedor: o.privacidade_por_vendedor === true,
    campanhas: o.campanhas === true,
  };
}

const CASA: EscopoDoCrm = { modo: "casa" };
let atual: EscopoDoCrm = CASA;

export const escopoDoCrm = (): EscopoDoCrm => atual;
export const naConta = (): boolean => atual.modo === "conta";

export function definirEscopoDoCrm(escopo: EscopoDoCrm | null): void {
  atual = escopo || CASA;
}

/** As tabelas do Comercial da casa e as gêmeas do CRM da empresa. */
const TABELAS_DA_CONTA: Record<string, string> = {
  commercial_leads: "crm_leads",
  commercial_organizations: "crm_organizations",
  commercial_contacts: "crm_contacts",
  commercial_activities: "crm_activities",
  commercial_lead_events: "crm_lead_events",
  commercial_campaigns: "crm_campaigns",
  commercial_goals: "crm_goals",
  commercial_lead_messages: "crm_lead_messages",
};

export type TabelaDoCrm = keyof typeof TABELAS_DA_CONTA;

/**
 * O nome da tabela para o escopo de agora. Tabela que só existe na casa
 * (Caixa, fatos, configuração do agente) não tem gêmea: pedir uma delas dentro
 * de uma conta é erro de programação, e falha alto em vez de ler dado da casa.
 */
export function tabelaDoCrm(nome: string): string {
  if (atual.modo === "casa") return nome;
  const gemea = TABELAS_DA_CONTA[nome];
  if (!gemea) throw new Error(`"${nome}" não existe no CRM da empresa.`);
  return gemea;
}

/** Chave de cache: o mesmo navegador pode abrir o CRM da casa e o de uma conta. */
export const chaveDoEscopo = (): string => (atual.modo === "conta" ? `conta:${atual.contaId}` : "casa");
