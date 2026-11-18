/**
 * O CRM é vendido para empresas de ramos diferentes. O nicho escolhido na
 * chegada dá ao funil os nomes que aquele ramo usa (a imobiliária tem "Visita",
 * a clínica tem "Avaliação") e ajusta os exemplos da tela. As sete etapas são
 * sempre as mesmas por dentro: o que muda é o nome que a equipe lê, e a
 * empresa pode trocar cada um depois, em Conta, Funil.
 * O banco só aceita nicho e objetivo destas listas (produto_perfil_valido).
 */

export type NichoId = "imobiliaria" | "consorcio" | "saude" | "servicos" | "varejo" | "agencia" | "educacao" | "b2b" | "outro";
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
  /** Como o ramo chama o que vende: muda o rótulo dos valores do negócio. */
  valores?: { avulso: string; mensal: string };
  /** Os campos que este ramo costuma pedir no negócio (a empresa liga com um clique e edita depois). */
  campos?: CampoDoRamo[];
}

export type TipoDeCampo = "texto" | "numero" | "dinheiro" | "porcentagem" | "data" | "lista" | "sim_nao";

export interface CampoDoRamo {
  chave: string;
  rotulo: string;
  tipo: TipoDeCampo;
  opcoes?: string[];
  grupo?: string;
  no_cartao?: boolean;
}

export const ROTULO_DO_TIPO_DE_CAMPO: Record<TipoDeCampo, string> = {
  texto: "Texto", numero: "Número", dinheiro: "Valor em reais", porcentagem: "Porcentagem", data: "Data", lista: "Lista de opções", sim_nao: "Sim ou não",
};

export const NICHOS: Nicho[] = [
  { id: "imobiliaria", nome: "Imobiliária", exemplo: "Venda e locação de imóveis", etapas: { novo: "Interessado", contato: "Atendimento", diagnostico: "Visita", negociacao: "Documentação", ganho: "Fechado" }, buscaSugerida: "construtoras e condomínios",
    valores: { avulso: "Valor do imóvel", mensal: "Aluguel" },
    campos: [
      { chave: "finalidade", rotulo: "Finalidade", tipo: "lista", opcoes: ["Compra", "Locação", "Temporada"], grupo: "Imóvel", no_cartao: true },
      { chave: "tipo_de_imovel", rotulo: "Tipo de imóvel", tipo: "lista", opcoes: ["Apartamento", "Casa", "Terreno", "Comercial", "Rural"], grupo: "Imóvel" },
      { chave: "bairro", rotulo: "Bairro de interesse", tipo: "texto", grupo: "Imóvel", no_cartao: true },
      { chave: "quartos", rotulo: "Quartos", tipo: "numero", grupo: "Imóvel" },
      { chave: "financiamento", rotulo: "Vai financiar", tipo: "sim_nao", grupo: "Pagamento" },
      { chave: "codigo_do_imovel", rotulo: "Código do imóvel", tipo: "texto", grupo: "Imóvel" },
    ],
  },
  {
    id: "consorcio", nome: "Consórcio", exemplo: "Cartas de imóvel, auto e serviços",
    etapas: { novo: "Lead", contato: "Atendimento", diagnostico: "Simulação", negociacao: "Documentação", ganho: "Cota vendida" },
    buscaSugerida: "empresas com frota e construtoras",
    valores: { avulso: "Valor da carta", mensal: "Parcela" },
    campos: [
      { chave: "tipo_de_bem", rotulo: "Tipo de bem", tipo: "lista", opcoes: ["Imóvel", "Automóvel", "Moto", "Pesados", "Serviços"], grupo: "Carta", no_cartao: true },
      { chave: "administradora", rotulo: "Administradora", tipo: "texto", grupo: "Carta", no_cartao: true },
      { chave: "prazo_meses", rotulo: "Prazo em meses", tipo: "numero", grupo: "Carta" },
      { chave: "taxa_adm", rotulo: "Taxa de administração", tipo: "porcentagem", grupo: "Carta" },
      { chave: "lance", rotulo: "Lance pretendido", tipo: "dinheiro", grupo: "Carta" },
      { chave: "grupo", rotulo: "Grupo", tipo: "texto", grupo: "Cota" },
      { chave: "cota", rotulo: "Cota", tipo: "texto", grupo: "Cota" },
      { chave: "contemplada", rotulo: "Contemplada", tipo: "sim_nao", grupo: "Cota" },
      { chave: "assembleia", rotulo: "Próxima assembleia", tipo: "data", grupo: "Cota" },
    ],
  },
  { id: "saude", nome: "Saúde e estética", exemplo: "Clínica, consultório, estética", etapas: { novo: "Contato novo", contato: "Triagem", diagnostico: "Avaliação", proposta: "Orçamento", negociacao: "Agendamento", ganho: "Paciente" }, buscaSugerida: "empresas para convênio",
    valores: { avulso: "Valor do tratamento", mensal: "Plano mensal" },
    campos: [
      { chave: "procedimento", rotulo: "Procedimento de interesse", tipo: "texto", grupo: "Atendimento", no_cartao: true },
      { chave: "convenio", rotulo: "Convênio", tipo: "texto", grupo: "Atendimento" },
      { chave: "profissional", rotulo: "Profissional", tipo: "texto", grupo: "Atendimento" },
      { chave: "retorno", rotulo: "Data de retorno", tipo: "data", grupo: "Atendimento" },
    ],
  },
  { id: "servicos", nome: "Serviços", exemplo: "Manutenção, obras, consultoria", etapas: { novo: "Pedido", contato: "Atendimento", diagnostico: "Visita técnica", proposta: "Orçamento" }, buscaSugerida: "condomínios e empresas da região",
    valores: { avulso: "Valor do serviço", mensal: "Contrato mensal" },
    campos: [
      { chave: "servico", rotulo: "Serviço pedido", tipo: "texto", grupo: "Serviço", no_cartao: true },
      { chave: "endereco", rotulo: "Endereço do serviço", tipo: "texto", grupo: "Serviço" },
      { chave: "prazo", rotulo: "Prazo desejado", tipo: "data", grupo: "Serviço" },
    ],
  },
  { id: "varejo", nome: "Loja e varejo", exemplo: "Loja física ou online", etapas: { novo: "Interessado", contato: "Atendimento", diagnostico: "Demonstração", proposta: "Orçamento", negociacao: "Pagamento", ganho: "Vendido" }, buscaSugerida: "revendas e lojistas" },
  { id: "agencia", nome: "Agência e marketing", exemplo: "Agência, estúdio, freela", etapas: {}, buscaSugerida: "negócios locais sem presença digital" },
  { id: "educacao", nome: "Educação", exemplo: "Escola, curso, treinamento", etapas: { novo: "Interessado", contato: "Atendimento", diagnostico: "Aula experimental", negociacao: "Matrícula", ganho: "Aluno" }, buscaSugerida: "empresas para treinamento",
    valores: { avulso: "Matrícula", mensal: "Mensalidade" },
    campos: [
      { chave: "curso", rotulo: "Curso de interesse", tipo: "texto", grupo: "Matrícula", no_cartao: true },
      { chave: "turno", rotulo: "Turno", tipo: "lista", opcoes: ["Manhã", "Tarde", "Noite", "Online"], grupo: "Matrícula" },
      { chave: "responsavel", rotulo: "Responsável pelo aluno", tipo: "texto", grupo: "Matrícula" },
    ],
  },
  { id: "b2b", nome: "Indústria e B2B", exemplo: "Venda para outras empresas", etapas: { novo: "Lead", contato: "Qualificação", diagnostico: "Reunião", negociacao: "Fechamento" }, buscaSugerida: "distribuidores e indústrias",
    valores: { avulso: "Valor do pedido", mensal: "Recorrência mensal" },
    campos: [
      { chave: "segmento", rotulo: "Segmento", tipo: "texto", grupo: "Empresa", no_cartao: true },
      { chave: "porte", rotulo: "Porte", tipo: "lista", opcoes: ["Micro", "Pequena", "Média", "Grande"], grupo: "Empresa" },
      { chave: "decisor", rotulo: "Quem decide", tipo: "texto", grupo: "Empresa" },
      { chave: "concorrente", rotulo: "Concorrente atual", tipo: "texto", grupo: "Empresa" },
    ],
  },
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

export const nichoPorId = (id: NichoId | undefined): Nicho | undefined => NICHOS.filter((n) => n.id === id)[0];

/** Como este ramo chama os dois valores do negócio (o padrão serve a quem vende serviço recorrente). */
export function rotulosDeValor(perfil: PerfilDaEmpresa): { avulso: string; mensal: string } {
  const n = nichoPorId(perfil.nicho);
  return n && n.valores ? n.valores : { avulso: "Valor à vista", mensal: "Valor mensal" };
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
