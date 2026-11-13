/**
 * O CRM é vendido para empresas de ramos diferentes. O nicho escolhido na
 * chegada dá ao funil os nomes que aquele ramo usa (a imobiliária tem "Visita",
 * a clínica tem "Avaliação") e ajusta os exemplos da tela. As sete etapas são
 * sempre as mesmas por dentro: o que muda é o nome que a equipe lê, e a
 * empresa pode trocar cada um depois, em Conta, Funil.
 * O banco só aceita nicho e objetivo destas listas (produto_perfil_valido).
 */

export type NichoId = "imobiliaria" | "saude" | "servicos" | "varejo" | "agencia" | "educacao" | "b2b" | "outro";
export type ObjetivoId = "organizar" | "prospectar" | "equipe" | "pos_venda";
export type EtapaId = "novo" | "contato" | "diagnostico" | "proposta" | "negociacao" | "ganho" | "perdido";

export const ETAPAS_DO_FUNIL: EtapaId[] = ["novo", "contato", "diagnostico", "proposta", "negociacao", "ganho", "perdido"];

export const NOME_PADRAO_DA_ETAPA: Record<EtapaId, string> = {
  novo: "Novo",
  contato: "Em contato",
  diagnostico: "Diagnóstico",
  proposta: "Proposta",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
};

export interface Nicho {
  id: NichoId;
  nome: string;
  exemplo: string;
  /** Só as etapas que mudam de nome neste ramo. */
  etapas: Partial<Record<EtapaId, string>>;
  /** O que a Máquina de leads pode buscar para este ramo. */
  buscaSugerida: string;
}

export const NICHOS: Nicho[] = [
  { id: "imobiliaria", nome: "Imobiliária", exemplo: "Venda e locação de imóveis", etapas: { novo: "Interessado", contato: "Atendimento", diagnostico: "Visita", negociacao: "Documentação", ganho: "Fechado" }, buscaSugerida: "construtoras e condomínios" },
  { id: "saude", nome: "Saúde e estética", exemplo: "Clínica, consultório, estética", etapas: { novo: "Contato novo", contato: "Triagem", diagnostico: "Avaliação", proposta: "Orçamento", negociacao: "Agendamento", ganho: "Paciente" }, buscaSugerida: "empresas para convênio" },
  { id: "servicos", nome: "Serviços", exemplo: "Manutenção, obras, consultoria", etapas: { novo: "Pedido", contato: "Atendimento", diagnostico: "Visita técnica", proposta: "Orçamento" }, buscaSugerida: "condomínios e empresas da região" },
  { id: "varejo", nome: "Loja e varejo", exemplo: "Loja física ou online", etapas: { novo: "Interessado", contato: "Atendimento", diagnostico: "Demonstração", proposta: "Orçamento", negociacao: "Pagamento", ganho: "Vendido" }, buscaSugerida: "revendas e lojistas" },
  { id: "agencia", nome: "Agência e marketing", exemplo: "Agência, estúdio, freela", etapas: {}, buscaSugerida: "negócios locais sem presença digital" },
  { id: "educacao", nome: "Educação", exemplo: "Escola, curso, treinamento", etapas: { novo: "Interessado", contato: "Atendimento", diagnostico: "Aula experimental", negociacao: "Matrícula", ganho: "Aluno" }, buscaSugerida: "empresas para treinamento" },
  { id: "b2b", nome: "Indústria e B2B", exemplo: "Venda para outras empresas", etapas: { novo: "Lead", contato: "Qualificação", diagnostico: "Reunião", negociacao: "Fechamento" }, buscaSugerida: "distribuidores e indústrias" },
  { id: "outro", nome: "Outro ramo", exemplo: "Monto do meu jeito", etapas: {}, buscaSugerida: "empresas do seu ramo na cidade" },
];

export const OBJETIVOS: Array<{ id: ObjetivoId; nome: string; linha: string; para: string }> = [
  { id: "organizar", nome: "Organizar as vendas", linha: "Parar de perder negócio no WhatsApp e na planilha", para: "/app/crm/crm" },
  { id: "prospectar", nome: "Achar clientes novos", linha: "Buscar empresas e ir atrás todo dia", para: "/app/crm/leads" },
  { id: "equipe", nome: "Acompanhar a equipe", linha: "Saber o que cada vendedor está tocando", para: "/app/crm" },
  { id: "pos_venda", nome: "Cuidar de quem já comprou", linha: "Retorno, renovação e nova venda", para: "/app/crm/agenda" },
];

export interface PerfilDaEmpresa {
  nicho?: NichoId;
  objetivo?: ObjetivoId;
  etapas?: Partial<Record<EtapaId, string>>;
}

/** Lê o perfil como veio do banco, sem confiar no formato. */
export function lerPerfil(bruto: unknown): PerfilDaEmpresa {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const nicho = NICHOS.filter((n) => n.id === o.nicho)[0];
  const objetivo = OBJETIVOS.filter((x) => x.id === o.objetivo)[0];
  const etapas: Partial<Record<EtapaId, string>> = {};
  const brutas = (o.etapas && typeof o.etapas === "object" ? o.etapas : {}) as Record<string, unknown>;
  ETAPAS_DO_FUNIL.forEach((id) => {
    const v = typeof brutas[id] === "string" ? String(brutas[id]).trim().slice(0, 24) : "";
    if (v.length >= 2) etapas[id] = v;
  });
  return { ...(nicho ? { nicho: nicho.id } : {}), ...(objetivo ? { objetivo: objetivo.id } : {}), ...(Object.keys(etapas).length ? { etapas } : {}) };
}

/** O perfil com que a empresa nasce: o nicho, o objetivo e os nomes de etapa daquele ramo. */
export function perfilDoNicho(nicho: NichoId, objetivo?: ObjetivoId): PerfilDaEmpresa {
  const n = NICHOS.filter((x) => x.id === nicho)[0];
  return { nicho, ...(objetivo ? { objetivo } : {}), ...(n && Object.keys(n.etapas).length ? { etapas: { ...n.etapas } } : {}) };
}

/** O nome que a empresa lê para cada etapa: o dela, senão o padrão. */
export function nomesDasEtapas(perfil: PerfilDaEmpresa): Record<EtapaId, string> {
  const nomes = { ...NOME_PADRAO_DA_ETAPA };
  ETAPAS_DO_FUNIL.forEach((id) => {
    const proprio = perfil.etapas && perfil.etapas[id];
    if (proprio) nomes[id] = proprio;
  });
  return nomes;
}
