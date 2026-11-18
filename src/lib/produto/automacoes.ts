import { supabase } from "@/integrations/supabase/client";
import { ErroDoProduto } from "./api";
import { ETAPAS_DO_FUNIL, NOME_PADRAO_DA_ETAPA, type EtapaId } from "./nichos";

/**
 * Automações do CRM da empresa: "quando acontece isto, se for assim, faça aquilo".
 * Contrato do banco: supabase/migrations/20261113200000_crm_cargos_campos_e_automacoes.sql, seção 4.
 * O motor roda no banco (gatilho no negócio e uma rodada por hora para negócio parado);
 * a tela só cadastra. Admin e gerente gravam, vendedor só lê, e a empresa da linha
 * vem do banco: a tela nunca manda `conta_id`.
 */

// As tabelas do produto ainda não estão nos tipos gerados do banco.
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as unknown as { from: (t: string) => any };

export type GatilhoDaAutomacao = "negocio_criado" | "etapa_mudou" | "negocio_ganho" | "negocio_perdido" | "negocio_parado";
export type AcaoDaAutomacao = "criar_tarefa" | "atribuir_rodizio" | "atribuir_membro" | "mover_etapa" | "avisar";
export type TipoDeTarefa = "ligacao" | "reuniao" | "whatsapp" | "email" | "proposta" | "tarefa";
export type EtapaAberta = "novo" | "contato" | "diagnostico" | "proposta" | "negociacao";
export type QuemAvisar = "dono" | "gerente" | "admin";

export const GATILHOS: GatilhoDaAutomacao[] = ["negocio_criado", "etapa_mudou", "negocio_ganho", "negocio_perdido", "negocio_parado"];
export const ACOES: AcaoDaAutomacao[] = ["criar_tarefa", "atribuir_rodizio", "atribuir_membro", "mover_etapa", "avisar"];
export const TIPOS_DE_TAREFA: TipoDeTarefa[] = ["ligacao", "reuniao", "whatsapp", "email", "proposta", "tarefa"];
export const ETAPAS_ABERTAS: EtapaAberta[] = ["novo", "contato", "diagnostico", "proposta", "negociacao"];
export const QUEM_AVISAR: QuemAvisar[] = ["dono", "gerente", "admin"];

/** O banco recusa a 31ª automação da empresa. */
export const LIMITE_DE_AUTOMACOES = 30;
/** Os limites que o motor aplica: a tela corta antes para a frase bater com o que acontece. */
export const DIAS_PARADO = { minimo: 1, maximo: 180, padrao: 5 } as const;
export const PRAZO_DA_TAREFA = { minimo: 0, maximo: 90, padrao: 1 } as const;

export const NOME_DO_GATILHO: Record<GatilhoDaAutomacao, string> = {
  negocio_criado: "Um negócio é criado",
  etapa_mudou: "Um negócio muda de etapa",
  negocio_ganho: "Um negócio é ganho",
  negocio_perdido: "Um negócio é perdido",
  negocio_parado: "Um negócio fica parado",
};

export const NOME_DA_ACAO: Record<AcaoDaAutomacao, string> = {
  criar_tarefa: "Criar uma tarefa",
  atribuir_rodizio: "Distribuir no rodízio da equipe",
  atribuir_membro: "Passar para uma pessoa",
  mover_etapa: "Mover de etapa",
  avisar: "Avisar alguém",
};

export const NOME_DO_TIPO: Record<TipoDeTarefa, string> = {
  ligacao: "Ligação",
  reuniao: "Reunião",
  whatsapp: "WhatsApp",
  email: "E-mail",
  proposta: "Proposta",
  tarefa: "Tarefa",
};

export const NOME_DE_QUEM: Record<QuemAvisar, string> = {
  dono: "O responsável pelo negócio",
  gerente: "O gerente do responsável",
  admin: "Quem administra a empresa",
};

export interface CondicaoDaAutomacao {
  etapa?: EtapaId;
  dias?: number;
  sem_dono?: true;
}

export type ParametrosDaAutomacao = Record<string, string | number>;

/** O que a tela manda ao banco (sem empresa, sem contadores). */
export interface LinhaDeAutomacao {
  nome: string;
  gatilho: GatilhoDaAutomacao;
  condicao: CondicaoDaAutomacao;
  acao: AcaoDaAutomacao;
  parametros: ParametrosDaAutomacao;
  ativa: boolean;
}

export interface Automacao extends LinhaDeAutomacao {
  id: string;
  execucoes: number;
  ultima_em: string | null;
  criado_em: string;
}

/** Uma pessoa da equipe, só com o que a frase e o criador precisam. */
export interface PessoaDaEquipe {
  user_id: string | null;
  nome: string;
  estado?: string;
}

/** O formulário do criador: tudo solto, do jeito que a pessoa preenche. */
export interface RascunhoDeAutomacao {
  nome: string;
  gatilho: GatilhoDaAutomacao;
  /** Vazio = qualquer etapa. */
  etapa: EtapaId | "";
  dias: number;
  semDono: boolean;
  acao: AcaoDaAutomacao;
  titulo: string;
  emDias: number;
  tipo: TipoDeTarefa;
  userId: string;
  para: EtapaAberta;
  quem: QuemAvisar;
  texto: string;
}

export const RASCUNHO_VAZIO: RascunhoDeAutomacao = {
  nome: "",
  gatilho: "etapa_mudou",
  etapa: "",
  dias: DIAS_PARADO.padrao,
  semDono: false,
  acao: "criar_tarefa",
  titulo: "",
  emDias: PRAZO_DA_TAREFA.padrao,
  tipo: "tarefa",
  userId: "",
  para: "contato",
  quem: "gerente",
  texto: "",
};

const inteiro = (v: unknown, minimo: number, maximo: number, padrao: number): number => {
  const n = Math.round(Number(v));
  if (!isFinite(n) || v === "" || v === null || v === undefined) return padrao;
  return Math.min(Math.max(n, minimo), maximo);
};

const contem = <T extends string>(lista: readonly T[], v: unknown): v is T => typeof v === "string" && (lista as readonly string[]).indexOf(v) >= 0;

/**
 * As etapas que fazem sentido como condição de cada gatilho. Ganho e perdido já
 * dizem a etapa; negócio parado é sempre negócio aberto.
 */
export function etapasDoGatilho(gatilho: GatilhoDaAutomacao): EtapaId[] {
  if (gatilho === "negocio_ganho" || gatilho === "negocio_perdido") return [];
  if (gatilho === "etapa_mudou") return ETAPAS_DO_FUNIL.slice();
  return ETAPAS_ABERTAS.slice();
}

/** "Só sem responsável" vale para o que acontece na hora; a rodada de negócio parado não olha isso. */
export const aceitaSemDono = (gatilho: GatilhoDaAutomacao) => gatilho !== "negocio_parado";

/** A condição que vai ao banco: só o que vale para o gatilho, sem chave vazia. */
export function montarCondicao(r: Pick<RascunhoDeAutomacao, "gatilho" | "etapa" | "dias" | "semDono">): CondicaoDaAutomacao {
  const c: CondicaoDaAutomacao = {};
  if (r.etapa && etapasDoGatilho(r.gatilho).indexOf(r.etapa) >= 0) c.etapa = r.etapa;
  if (r.gatilho === "negocio_parado") c.dias = inteiro(r.dias, DIAS_PARADO.minimo, DIAS_PARADO.maximo, DIAS_PARADO.padrao);
  if (r.semDono && aceitaSemDono(r.gatilho)) c.sem_dono = true;
  return c;
}

/** Os parâmetros que vão ao banco: só os da ação escolhida. */
export function montarParametros(r: Pick<RascunhoDeAutomacao, "acao" | "titulo" | "emDias" | "tipo" | "userId" | "para" | "quem" | "texto">): ParametrosDaAutomacao {
  if (r.acao === "criar_tarefa") {
    return {
      titulo: r.titulo.trim().slice(0, 160),
      em_dias: inteiro(r.emDias, PRAZO_DA_TAREFA.minimo, PRAZO_DA_TAREFA.maximo, PRAZO_DA_TAREFA.padrao),
      tipo: contem(TIPOS_DE_TAREFA, r.tipo) ? r.tipo : "tarefa",
    };
  }
  if (r.acao === "atribuir_membro") return { user_id: r.userId };
  if (r.acao === "mover_etapa") return { para: contem(ETAPAS_ABERTAS, r.para) ? r.para : "contato" };
  if (r.acao === "avisar") return { quem: contem(QUEM_AVISAR, r.quem) ? r.quem : "gerente", texto: r.texto.trim().slice(0, 280) };
  return {};
}

/** A automação cai em negócio já fechado? O motor não move negócio ganho nem perdido. */
const fechaNoGatilho = (gatilho: GatilhoDaAutomacao, etapa: EtapaId | "") =>
  gatilho === "negocio_ganho" || gatilho === "negocio_perdido" || etapa === "ganho" || etapa === "perdido";

/** O que falta ou não fecha no rascunho, numa frase. Nulo quando pode salvar. */
export function erroDoRascunho(r: RascunhoDeAutomacao): string | null {
  const condicao = montarCondicao(r);
  if (r.acao === "criar_tarefa" && r.titulo.trim().length < 2) return "Escreva o título da tarefa.";
  if (r.acao === "atribuir_membro" && !r.userId) return "Escolha a pessoa que recebe o negócio.";
  if (r.acao === "mover_etapa") {
    if (fechaNoGatilho(r.gatilho, condicao.etapa || "")) return "Negócio ganho ou perdido não muda de etapa sozinho.";
    if (condicao.etapa === r.para) return "O negócio já está nessa etapa. Escolha outra.";
  }
  if (r.acao === "avisar" && r.quem === "dono" && condicao.sem_dono) return "Sem responsável, não há quem avisar. Escolha o gerente ou quem administra.";
  const nome = r.nome.trim();
  if (nome.length > 0 && nome.length < 2) return "O nome precisa de pelo menos 2 letras.";
  return null;
}

const nomeDaPessoa = (equipe: PessoaDaEquipe[] | undefined, userId: unknown): string => {
  const p = (equipe || []).filter((m) => m.user_id && m.user_id === userId)[0];
  return p && p.nome.trim() ? p.nome.trim() : "";
};

const prazoLegivel = (dias: number) => (dias <= 0 ? "no mesmo dia" : dias === 1 ? "em 1 dia" : `em ${dias} dias`);
const diasLegiveis = (dias: number) => (dias === 1 ? "1 dia" : `${dias} dias`);

type Nomes = Partial<Record<EtapaId, string>>;
const nomeDaEtapa = (nomes: Nomes | undefined, id: unknown): string =>
  contem(ETAPAS_DO_FUNIL, id) ? (nomes && nomes[id]) || NOME_PADRAO_DA_ETAPA[id] : "";

/** A metade "Quando..." da frase. */
export function fraseDoGatilho(a: Pick<LinhaDeAutomacao, "gatilho" | "condicao">, nomes?: Nomes): string {
  const c = a.condicao || {};
  const etapa = nomeDaEtapa(nomes, c.etapa);
  const semDono = c.sem_dono === true && aceitaSemDono(a.gatilho) ? " sem responsável" : "";
  if (a.gatilho === "negocio_criado") return `Quando um negócio${semDono} é criado${etapa ? ` em ${etapa}` : ""}`;
  if (a.gatilho === "etapa_mudou") return `Quando um negócio${semDono} ${etapa ? `entra em ${etapa}` : "muda de etapa"}`;
  if (a.gatilho === "negocio_ganho") return `Quando um negócio${semDono} é ganho`;
  if (a.gatilho === "negocio_perdido") return `Quando um negócio${semDono} é perdido`;
  const dias = inteiro(c.dias, DIAS_PARADO.minimo, DIAS_PARADO.maximo, DIAS_PARADO.padrao);
  return `Quando um negócio fica parado há ${diasLegiveis(dias)}${etapa ? ` em ${etapa}` : ""}`;
}

/** A metade "fazer isto" da frase, em minúscula para emendar depois da vírgula. */
export function fraseDaAcao(a: Pick<LinhaDeAutomacao, "acao" | "parametros">, nomes?: Nomes, equipe?: PessoaDaEquipe[]): string {
  const p = a.parametros || {};
  if (a.acao === "criar_tarefa") {
    const titulo = String(p.titulo || "").trim() || "Dar o próximo passo";
    return `criar a tarefa ${titulo} ${prazoLegivel(inteiro(p.em_dias, PRAZO_DA_TAREFA.minimo, PRAZO_DA_TAREFA.maximo, PRAZO_DA_TAREFA.padrao))}`;
  }
  if (a.acao === "atribuir_rodizio") return "distribuir no rodízio da equipe";
  if (a.acao === "atribuir_membro") return `passar para ${nomeDaPessoa(equipe, p.user_id) || "uma pessoa da equipe"}`;
  if (a.acao === "mover_etapa") return `mover para ${nomeDaEtapa(nomes, p.para) || "outra etapa"}`;
  const quem = contem(QUEM_AVISAR, p.quem) ? p.quem : "gerente";
  const alvo = quem === "dono" ? "o responsável" : quem === "admin" ? "quem administra a empresa" : "o gerente";
  const recado = String(p.texto || "").trim().replace(/[.\s]+$/, "");
  return `avisar ${alvo}${recado ? `: ${recado}` : ""}`;
}

/**
 * A automação numa frase que qualquer pessoa lê:
 * "Quando um negócio entra em Proposta, criar a tarefa Ligar em 2 dias".
 * `nomes` são as etapas com as palavras da empresa (nomesDasEtapas do perfil).
 */
export function fraseDaAutomacao(a: Pick<LinhaDeAutomacao, "gatilho" | "condicao" | "acao" | "parametros">, nomes?: Nomes, equipe?: PessoaDaEquipe[]): string {
  return `${fraseDoGatilho(a, nomes)}, ${fraseDaAcao(a, nomes, equipe)}`;
}

/** O nome que a automação ganha quando a pessoa não escreve um. Ele é o título do aviso que a equipe recebe. */
export function nomeSugerido(r: RascunhoDeAutomacao, nomes?: Nomes, equipe?: PessoaDaEquipe[]): string {
  let nome = "";
  if (r.acao === "criar_tarefa") nome = `Tarefa: ${r.titulo.trim() || "próximo passo"}`;
  else if (r.acao === "atribuir_rodizio") nome = "Rodízio da equipe";
  else if (r.acao === "atribuir_membro") nome = `Negócios para ${nomeDaPessoa(equipe, r.userId) || "uma pessoa"}`;
  else if (r.acao === "mover_etapa") nome = `Mover para ${nomeDaEtapa(nomes, r.para)}`;
  else if (r.gatilho === "negocio_parado") nome = "Negócio parado";
  else if (r.gatilho === "negocio_ganho") nome = "Negócio ganho";
  else if (r.gatilho === "negocio_perdido") nome = "Negócio perdido";
  else if (r.gatilho === "negocio_criado") nome = "Negócio novo";
  else nome = "Negócio mudou de etapa";
  return nome.slice(0, 80).trim();
}

/** O rascunho pronto para o banco. Chame `erroDoRascunho` antes. */
export function linhaDoRascunho(r: RascunhoDeAutomacao, nomes?: Nomes, equipe?: PessoaDaEquipe[], ativa = true): LinhaDeAutomacao {
  const nome = r.nome.trim().slice(0, 80);
  return {
    nome: nome.length >= 2 ? nome : nomeSugerido(r, nomes, equipe),
    gatilho: r.gatilho,
    condicao: montarCondicao(r),
    acao: r.acao,
    parametros: montarParametros(r),
    ativa,
  };
}

/** Uma automação que já existe de volta ao formulário, para editar. */
export function rascunhoDaAutomacao(a: LinhaDeAutomacao): RascunhoDeAutomacao {
  const c = a.condicao || {};
  const p = a.parametros || {};
  return {
    ...RASCUNHO_VAZIO,
    nome: a.nome,
    gatilho: a.gatilho,
    etapa: contem(ETAPAS_DO_FUNIL, c.etapa) ? c.etapa : "",
    dias: inteiro(c.dias, DIAS_PARADO.minimo, DIAS_PARADO.maximo, DIAS_PARADO.padrao),
    semDono: c.sem_dono === true,
    acao: a.acao,
    titulo: a.acao === "criar_tarefa" ? String(p.titulo || "") : "",
    emDias: inteiro(p.em_dias, PRAZO_DA_TAREFA.minimo, PRAZO_DA_TAREFA.maximo, PRAZO_DA_TAREFA.padrao),
    tipo: contem(TIPOS_DE_TAREFA, p.tipo) ? p.tipo : "tarefa",
    userId: a.acao === "atribuir_membro" ? String(p.user_id || "") : "",
    para: contem(ETAPAS_ABERTAS, p.para) ? p.para : RASCUNHO_VAZIO.para,
    quem: contem(QUEM_AVISAR, p.quem) ? p.quem : "gerente",
    texto: a.acao === "avisar" ? String(p.texto || "") : "",
  };
}

/**
 * O que faz duas automações serem a mesma regra: gatilho, condição, ação e o
 * alvo da ação. O nome e o texto livre (título da tarefa, recado) ficam de fora:
 * quem ligou uma receita e reescreveu o recado continua com a receita ligada.
 */
export function assinaturaDaAutomacao(a: Pick<LinhaDeAutomacao, "gatilho" | "condicao" | "acao" | "parametros">): string {
  const c = a.condicao || {};
  const p = a.parametros || {};
  const condicao = [c.etapa || "", a.gatilho === "negocio_parado" ? inteiro(c.dias, DIAS_PARADO.minimo, DIAS_PARADO.maximo, DIAS_PARADO.padrao) : "", c.sem_dono === true ? "sem_dono" : ""].join(",");
  let alvo = "";
  if (a.acao === "criar_tarefa") alvo = String(inteiro(p.em_dias, PRAZO_DA_TAREFA.minimo, PRAZO_DA_TAREFA.maximo, PRAZO_DA_TAREFA.padrao));
  else if (a.acao === "atribuir_membro") alvo = String(p.user_id || "");
  else if (a.acao === "mover_etapa") alvo = String(p.para || "");
  else if (a.acao === "avisar") alvo = String(p.quem || "gerente");
  return [a.gatilho, condicao, a.acao, alvo].join("|");
}

// ---------------------------------------------------------------------------
// Receitas prontas
// ---------------------------------------------------------------------------

export interface ReceitaDeAutomacao {
  id: string;
  nome: string;
  /** O que ela resolve, numa linha. */
  linha: string;
  gatilho: GatilhoDaAutomacao;
  condicao: CondicaoDaAutomacao;
  acao: AcaoDaAutomacao;
  parametros: ParametrosDaAutomacao;
}

/** Servem para qualquer ramo: nenhuma cita produto, e as etapas aparecem com o nome que a empresa deu. */
export const RECEITAS: ReceitaDeAutomacao[] = [
  {
    id: "rodizio",
    nome: "Rodízio dos negócios novos",
    linha: "Negócio que chega sem responsável vai para quem tem menos em aberto",
    gatilho: "negocio_criado",
    condicao: { sem_dono: true },
    acao: "atribuir_rodizio",
    parametros: {},
  },
  {
    id: "primeira_ligacao",
    nome: "Primeira ligação",
    linha: "Todo negócio novo nasce com a ligação do dia marcada",
    gatilho: "negocio_criado",
    condicao: {},
    acao: "criar_tarefa",
    parametros: { titulo: "Fazer a primeira ligação", em_dias: 0, tipo: "ligacao" },
  },
  {
    id: "retorno_da_proposta",
    nome: "Retorno da proposta",
    linha: "Dois dias depois da proposta, a equipe cobra a resposta",
    gatilho: "etapa_mudou",
    condicao: { etapa: "proposta" },
    acao: "criar_tarefa",
    parametros: { titulo: "Cobrar o retorno da proposta", em_dias: 2, tipo: "whatsapp" },
  },
  {
    id: "documentacao",
    nome: "Cobrar a documentação",
    linha: "Na reta final, ninguém esquece a papelada",
    gatilho: "etapa_mudou",
    condicao: { etapa: "negociacao" },
    acao: "criar_tarefa",
    parametros: { titulo: "Cobrar a documentação", em_dias: 1, tipo: "tarefa" },
  },
  {
    id: "parado_5_dias",
    nome: "Negócio parado há 5 dias",
    linha: "O gerente fica sabendo antes de o negócio esfriar",
    gatilho: "negocio_parado",
    condicao: { dias: 5 },
    acao: "avisar",
    parametros: { quem: "gerente", texto: "Parado há 5 dias, sem próximo passo marcado" },
  },
  {
    id: "proposta_sem_resposta",
    nome: "Proposta sem resposta",
    linha: "Três dias sem andar depois da proposta, o responsável é lembrado",
    gatilho: "negocio_parado",
    condicao: { etapa: "proposta", dias: 3 },
    acao: "avisar",
    parametros: { quem: "dono", texto: "Proposta sem resposta há 3 dias" },
  },
  {
    id: "reativar_15_dias",
    nome: "Reativar negócio parado",
    linha: "Quinze dias sem movimento viram uma tarefa de retomada",
    gatilho: "negocio_parado",
    condicao: { dias: 15 },
    acao: "criar_tarefa",
    parametros: { titulo: "Retomar o contato", em_dias: 1, tipo: "whatsapp" },
  },
  {
    id: "boas_vindas",
    nome: "Boas-vindas ao ganhar",
    linha: "Quem fechou recebe a mensagem de boas-vindas no dia seguinte",
    gatilho: "negocio_ganho",
    condicao: {},
    acao: "criar_tarefa",
    parametros: { titulo: "Dar as boas-vindas e combinar os próximos passos", em_dias: 1, tipo: "whatsapp" },
  },
  {
    id: "pos_venda_30_dias",
    nome: "Pós-venda de 30 dias",
    linha: "Um mês depois, saber como o cliente está e pedir indicação",
    gatilho: "negocio_ganho",
    condicao: {},
    acao: "criar_tarefa",
    parametros: { titulo: "Ver como o cliente está e pedir indicação", em_dias: 30, tipo: "ligacao" },
  },
  {
    id: "perdido",
    nome: "Negócio perdido",
    linha: "Quem administra vê cada perda e o motivo registrado",
    gatilho: "negocio_perdido",
    condicao: {},
    acao: "avisar",
    parametros: { quem: "admin", texto: "Negócio perdido. Veja o motivo registrado" },
  },
];

/** A receita como linha do banco, já ligada. */
export function linhaDaReceita(r: ReceitaDeAutomacao): LinhaDeAutomacao {
  return { nome: r.nome, gatilho: r.gatilho, condicao: { ...r.condicao }, acao: r.acao, parametros: { ...r.parametros }, ativa: true };
}

/** As receitas que a empresa ainda não tem (ligada ou desligada, tanto faz: já está na lista dela). */
export function receitasQueFaltam(existentes: Array<Pick<LinhaDeAutomacao, "gatilho" | "condicao" | "acao" | "parametros">>): ReceitaDeAutomacao[] {
  const tem: Record<string, true> = {};
  existentes.forEach((a) => {
    tem[assinaturaDaAutomacao(a)] = true;
  });
  return RECEITAS.filter((r) => !tem[assinaturaDaAutomacao(r)]);
}

/**
 * A linha tem o formato que o banco aceita? (as mesmas listas e limites dos
 * `check` da tabela e do motor). Devolve o que está errado, ou lista vazia.
 */
export function problemasDaLinha(l: LinhaDeAutomacao): string[] {
  const erros: string[] = [];
  const nome = (l.nome || "").trim();
  if (nome.length < 2 || nome.length > 80) erros.push("nome");
  if (!contem(GATILHOS, l.gatilho)) erros.push("gatilho");
  if (!contem(ACOES, l.acao)) erros.push("acao");
  const c = l.condicao || {};
  const chavesDaCondicao = Object.keys(c);
  if (chavesDaCondicao.some((k) => k !== "etapa" && k !== "dias" && k !== "sem_dono")) erros.push("condicao: chave desconhecida");
  if ("etapa" in c && etapasDoGatilho(l.gatilho).indexOf(c.etapa as EtapaId) < 0) erros.push("condicao.etapa");
  if (l.gatilho === "negocio_parado") {
    if (typeof c.dias !== "number" || c.dias !== Math.round(c.dias) || c.dias < DIAS_PARADO.minimo || c.dias > DIAS_PARADO.maximo) erros.push("condicao.dias");
  } else if ("dias" in c) erros.push("condicao.dias fora de negocio_parado");
  if ("sem_dono" in c && (c.sem_dono !== true || !aceitaSemDono(l.gatilho))) erros.push("condicao.sem_dono");
  const p = l.parametros || {};
  const chaves = Object.keys(p).sort().join(",");
  if (l.acao === "criar_tarefa") {
    if (chaves !== "em_dias,tipo,titulo") erros.push("parametros de criar_tarefa");
    const titulo = String(p.titulo || "");
    if (titulo.trim().length < 2 || titulo.length > 160) erros.push("parametros.titulo");
    if (typeof p.em_dias !== "number" || p.em_dias !== Math.round(p.em_dias) || p.em_dias < PRAZO_DA_TAREFA.minimo || p.em_dias > PRAZO_DA_TAREFA.maximo) erros.push("parametros.em_dias");
    if (!contem(TIPOS_DE_TAREFA, p.tipo)) erros.push("parametros.tipo");
  } else if (l.acao === "atribuir_rodizio") {
    if (chaves !== "") erros.push("parametros de atribuir_rodizio");
  } else if (l.acao === "atribuir_membro") {
    if (chaves !== "user_id" || !String(p.user_id || "")) erros.push("parametros.user_id");
  } else if (l.acao === "mover_etapa") {
    if (chaves !== "para" || !contem(ETAPAS_ABERTAS, p.para)) erros.push("parametros.para");
    if (fechaNoGatilho(l.gatilho, c.etapa || "")) erros.push("mover_etapa em negócio fechado");
    if (c.etapa && c.etapa === p.para) erros.push("mover_etapa para a mesma etapa");
  } else if (l.acao === "avisar") {
    if (chaves !== "quem,texto") erros.push("parametros de avisar");
    if (!contem(QUEM_AVISAR, p.quem)) erros.push("parametros.quem");
    if (typeof p.texto !== "string" || p.texto.length > 280) erros.push("parametros.texto");
    if (p.quem === "dono" && c.sem_dono === true) erros.push("avisar o dono de negócio sem dono");
  }
  if (JSON.stringify(c).length > 2000 || JSON.stringify(p).length > 4000) erros.push("tamanho");
  return erros;
}

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------

const COLUNAS = "id, nome, gatilho, condicao, acao, parametros, ativa, execucoes, ultima_em, criado_em";

/** Lê uma linha do banco sem confiar no formato. */
export function lerAutomacao(d: any): Automacao {
  const c = d && d.condicao && typeof d.condicao === "object" ? d.condicao : {};
  const p = d && d.parametros && typeof d.parametros === "object" ? d.parametros : {};
  const condicao: CondicaoDaAutomacao = {};
  if (contem(ETAPAS_DO_FUNIL, c.etapa)) condicao.etapa = c.etapa;
  if (c.dias !== undefined && c.dias !== null && c.dias !== "") condicao.dias = inteiro(c.dias, DIAS_PARADO.minimo, DIAS_PARADO.maximo, DIAS_PARADO.padrao);
  if (c.sem_dono === true || c.sem_dono === "true") condicao.sem_dono = true;
  const parametros: ParametrosDaAutomacao = {};
  Object.keys(p).forEach((k) => {
    if (typeof p[k] === "string" || typeof p[k] === "number") parametros[k] = p[k];
  });
  return {
    id: String((d && d.id) || ""),
    nome: String((d && d.nome) || ""),
    gatilho: contem(GATILHOS, d && d.gatilho) ? d.gatilho : "etapa_mudou",
    condicao,
    acao: contem(ACOES, d && d.acao) ? d.acao : "avisar",
    parametros,
    ativa: !!(d && d.ativa),
    execucoes: Math.max(0, Math.round(Number(d && d.execucoes) || 0)),
    ultima_em: d && d.ultima_em ? String(d.ultima_em) : null,
    criado_em: String((d && d.criado_em) || ""),
  };
}

export const chaveDasAutomacoes = ["produto", "automacoes"] as const;

export async function listarAutomacoes(): Promise<Automacao[]> {
  const { data, error } = await db.from("crm_automacoes").select(COLUNAS).order("criado_em", { ascending: true });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(lerAutomacao);
}

/** O que vai na gravação: só as colunas da tela. `conta_id` e os contadores são do banco. */
const paraOBanco = (l: LinhaDeAutomacao) => ({ nome: l.nome, gatilho: l.gatilho, condicao: l.condicao, acao: l.acao, parametros: l.parametros, ativa: l.ativa });

export async function criarAutomacao(linha: LinhaDeAutomacao): Promise<Automacao> {
  const { data, error } = await db.from("crm_automacoes").insert(paraOBanco(linha)).select(COLUNAS).single();
  if (error) throw error;
  return lerAutomacao(data);
}

/** Vendedor não grava: o banco não devolve erro, só não mexe em linha nenhuma. */
const conferirQueGravou = (data: unknown) => {
  if (!Array.isArray(data) || data.length === 0) throw new ErroDoProduto("sem_permissao", "Só o gerente ou quem administra a empresa mexe nas automações.");
};

export async function salvarAutomacao(id: string, linha: LinhaDeAutomacao): Promise<void> {
  const { data, error } = await db.from("crm_automacoes").update(paraOBanco(linha)).eq("id", id).select("id");
  if (error) throw error;
  conferirQueGravou(data);
}

export async function ligarAutomacao(id: string, ativa: boolean): Promise<void> {
  const { data, error } = await db.from("crm_automacoes").update({ ativa }).eq("id", id).select("id");
  if (error) throw error;
  conferirQueGravou(data);
}

export async function excluirAutomacao(id: string): Promise<void> {
  const { data, error } = await db.from("crm_automacoes").delete().eq("id", id).select("id");
  if (error) throw error;
  conferirQueGravou(data);
}
