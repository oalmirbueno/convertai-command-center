import { supabase } from "@/integrations/supabase/client";
import {
  lerRegras,
  notaMaxima,
  pontuar,
  regrasDoRamo,
  type Criterio,
  type Faixa,
  type RegrasDePontuacao,
  type ResultadoDaPontuacao,
} from "../../../supabase/functions/_shared/pontuacao-do-crm";
import { templatesNecessarios } from "../../../supabase/functions/_shared/whatsapp-do-crm";

/**
 * Leads da Meta e WhatsApp do CRM da empresa (14/11/2026, rodada 3): o que a
 * tela do gestor lê e pede. Contrato do banco:
 * supabase/migrations/20261114100000_crm_meta_leads_e_whatsapp.sql.
 * As regras da pontuação moram em supabase/functions/_shared/pontuacao-do-crm.ts,
 * onde o servidor usa as mesmas.
 *
 * O segredo (token, segredo do app) entra por `salvarIntegracao` e nunca volta:
 * a leitura traz só "tem" e os 4 últimos caracteres.
 */
export { REGRAS_DO_CONSORCIO, REGRAS_GERAIS, faltamResponder, lerRegras, notaMaxima, pontuar, regrasDoRamo } from "../../../supabase/functions/_shared/pontuacao-do-crm";
export type { Criterio, CriterioDeFaixa, CriterioDeOpcao, Faixa, RegrasDePontuacao, ResultadoDaPontuacao } from "../../../supabase/functions/_shared/pontuacao-do-crm";

// As tabelas do produto ainda não estão nos tipos gerados do banco.
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as unknown as { rpc: (f: string, a?: unknown) => any };

const numero = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};
const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const textoOuNulo = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

// ------------------------------------------------------------------ a conexão

export type ModoDaIntegracao = "teste" | "real";
export const TEMPLATES = ["lead", "vendedor", "followup", "nutricao"] as const;
export type ChaveDoTemplate = (typeof TEMPLATES)[number];
export type NomesDosTemplates = Partial<Record<ChaveDoTemplate, string>>;

export interface NumerosDaIntegracao {
  leads_7_dias: number;
  na_fila: number;
  em_nutricao: number;
  envios_pendentes: number;
  envios_com_erro: number;
}

export interface Integracao {
  /** A empresa já abriu a conexão (antes disso não há endereço nem token de verificação). */
  existe: boolean;
  ativo: boolean;
  modo: ModoDaIntegracao;
  webhook_chave: string | null;
  verify_token: string | null;
  pagina_id: string | null;
  formularios: string[];
  tem_app_secret: boolean;
  tem_token: boolean;
  token_final: string | null;
  wa_phone_id: string | null;
  wa_waba_id: string | null;
  wa_numero: string | null;
  tem_wa_token: boolean;
  wa_token_final: string | null;
  templates: NomesDosTemplates;
  idioma: string;
  /** Como veio do banco. Vazio = padrão do ramo. Leia com `lerRegras`. */
  pontuacao: unknown;
  followup_horas: number[];
  ultimo_erro: string | null;
  numeros: NumerosDaIntegracao;
}

/** O que a tela pode mandar. Segredo só vai quando a pessoa colou um novo. */
export type MudancaDaIntegracao = Partial<{
  ativo: boolean;
  modo: ModoDaIntegracao;
  pagina_id: string;
  formularios: string[];
  app_secret: string;
  token: string;
  wa_phone_id: string;
  wa_waba_id: string;
  wa_numero: string;
  wa_token: string;
  templates: NomesDosTemplates;
  idioma: string;
  pontuacao: RegrasDePontuacao | Record<string, never>;
  followup_horas: number[];
}>;

export function lerIntegracaoDoBanco(d: any): Integracao {
  const o = d && typeof d === "object" ? d : {};
  const n = o.numeros && typeof o.numeros === "object" ? o.numeros : {};
  const t = o.templates && typeof o.templates === "object" ? o.templates : {};
  const templates: NomesDosTemplates = {};
  TEMPLATES.forEach((k) => {
    if (typeof t[k] === "string" && t[k]) templates[k] = t[k];
  });
  return {
    existe: !!o.existe,
    ativo: !!o.ativo,
    modo: o.modo === "real" ? "real" : "teste",
    webhook_chave: textoOuNulo(o.webhook_chave),
    verify_token: textoOuNulo(o.verify_token),
    pagina_id: textoOuNulo(o.pagina_id),
    formularios: lista<unknown>(o.formularios).map(String),
    tem_app_secret: !!o.tem_app_secret,
    tem_token: !!o.tem_token,
    token_final: textoOuNulo(o.token_final),
    wa_phone_id: textoOuNulo(o.wa_phone_id),
    wa_waba_id: textoOuNulo(o.wa_waba_id),
    wa_numero: textoOuNulo(o.wa_numero),
    tem_wa_token: !!o.tem_wa_token,
    wa_token_final: textoOuNulo(o.wa_token_final),
    templates,
    idioma: typeof o.idioma === "string" && o.idioma ? o.idioma : "pt_BR",
    pontuacao: o.pontuacao && typeof o.pontuacao === "object" ? o.pontuacao : {},
    followup_horas: lista<unknown>(o.followup_horas).map(numero).filter((h) => h > 0),
    ultimo_erro: textoOuNulo(o.ultimo_erro),
    numeros: {
      leads_7_dias: numero(n.leads_7_dias),
      na_fila: numero(n.na_fila),
      em_nutricao: numero(n.em_nutricao),
      envios_pendentes: numero(n.envios_pendentes),
      envios_com_erro: numero(n.envios_com_erro),
    },
  };
}

export const chaveDaIntegracao = ["produto", "integracao"] as const;
export const chaveDosVendedores = ["produto", "integracao", "vendedores"] as const;
export const chaveDaAtividade = ["produto", "integracao", "atividade"] as const;

export async function lerIntegracao(): Promise<Integracao> {
  const { data, error } = await db.rpc("crm_integracao_ler");
  if (error) throw error;
  return lerIntegracaoDoBanco(data);
}

/** Salva só o que veio. Com `{}` abre a conexão (cria o endereço e o token de verificação). */
export async function salvarIntegracao(dados: MudancaDaIntegracao): Promise<Integracao> {
  const { data, error } = await db.rpc("crm_integracao_salvar", { _dados: dados });
  if (error) throw error;
  return lerIntegracaoDoBanco(data);
}

// ------------------------------------------------------------------ vendedores

/** 1 = segunda ... 7 = domingo. Sem `inicio` e `fim` (objeto vazio) = sempre. */
export interface Expediente {
  dias?: number[];
  inicio?: string;
  fim?: string;
}

export interface Vendedor {
  membro_id: string;
  user_id: string | null;
  nome: string;
  papel: "admin" | "gerente" | "usuario";
  cargo: string;
  estado: "convidado" | "ativo" | "removido";
  recebe_leads: boolean;
  /** Vazio = atende qualquer bem. */
  bens: string[];
  expediente: Expediente;
  whatsapp: string | null;
  no_expediente: boolean;
  ultimo_lead_em: string | null;
}

const HORA = /^[0-2][0-9]:[0-5][0-9]$/;

export function lerExpediente(v: unknown): Expediente {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const inicio = typeof o.inicio === "string" && HORA.test(o.inicio) ? o.inicio : "";
  const fim = typeof o.fim === "string" && HORA.test(o.fim) ? o.fim : "";
  if (!inicio || !fim) return {};
  const dias = lista<unknown>(o.dias).map(numero).filter((d, i, todos) => d >= 1 && d <= 7 && todos.indexOf(d) === i).sort((a, b) => a - b);
  return { dias, inicio, fim };
}

export async function lerVendedores(): Promise<Vendedor[]> {
  const { data, error } = await db.rpc("crm_vendedores_ler");
  if (error) throw error;
  return lista<any>(data).map((v) => ({
    membro_id: String(v.membro_id),
    user_id: v.user_id || null,
    nome: String(v.nome || "Sem nome"),
    papel: v.papel === "admin" || v.papel === "gerente" ? v.papel : "usuario",
    cargo: String(v.cargo || ""),
    estado: v.estado === "convidado" ? "convidado" : v.estado === "removido" ? "removido" : "ativo",
    recebe_leads: v.recebe_leads !== false,
    bens: lista<unknown>(v.bens).map(String),
    expediente: lerExpediente(v.expediente),
    whatsapp: textoOuNulo(v.whatsapp),
    no_expediente: v.no_expediente !== false,
    ultimo_lead_em: v.ultimo_lead_em || null,
  }));
}

export async function salvarVendedor(membroId: string, dados: Partial<{ recebe_leads: boolean; bens: string[]; expediente: Expediente; whatsapp: string }>): Promise<void> {
  const { error } = await db.rpc("crm_vendedor_salvar", { _membro: membroId, _dados: dados });
  if (error) throw error;
}

// ------------------------------------------------------------------ atividade

export interface LeadDaAtividade {
  id: string;
  leadgen_id: string;
  form_id: string | null;
  situacao: "recebido" | "criado" | "repetido" | "ignorado" | "erro";
  de_teste: boolean;
  erro: string | null;
  criado_em: string;
  lead_id: string | null;
  nome: string | null;
  faixa: Faixa | null;
  nota: number | null;
  fila_desde: string | null;
  nutricao: boolean;
  vendedor: string | null;
  campanha: string | null;
}

export interface EnvioDaAtividade {
  id: string;
  destino: "lead" | "vendedor";
  situacao: "pendente" | "enviado" | "simulado" | "erro";
  erro: string | null;
  criado_em: string;
  enviado_em: string | null;
  lead_id: string | null;
  tipo: string | null;
  resumo: string | null;
}

export async function lerAtividade(limite = 30): Promise<{ leads: LeadDaAtividade[]; envios: EnvioDaAtividade[] }> {
  const { data, error } = await db.rpc("crm_integracao_atividade", { _limite: limite });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  return {
    leads: lista<any>(d.leads).map((l) => ({
      id: String(l.id),
      leadgen_id: String(l.leadgen_id || ""),
      form_id: textoOuNulo(l.form_id),
      situacao: ["criado", "repetido", "ignorado", "erro"].indexOf(l.situacao) >= 0 ? l.situacao : "recebido",
      de_teste: !!l.de_teste,
      erro: textoOuNulo(l.erro),
      criado_em: String(l.criado_em || ""),
      lead_id: l.lead_id || null,
      nome: textoOuNulo(l.nome),
      faixa: l.faixa === "quente" || l.faixa === "morno" || l.faixa === "frio" ? l.faixa : null,
      nota: l.nota === null || l.nota === undefined ? null : numero(l.nota),
      fila_desde: l.fila_desde || null,
      nutricao: !!l.nutricao,
      vendedor: textoOuNulo(l.vendedor),
      campanha: textoOuNulo(l.campanha),
    })),
    envios: lista<any>(d.envios).map((e) => ({
      id: String(e.id),
      destino: e.destino === "vendedor" ? "vendedor" : "lead",
      situacao: ["enviado", "simulado", "erro"].indexOf(e.situacao) >= 0 ? e.situacao : "pendente",
      erro: textoOuNulo(e.erro),
      criado_em: String(e.criado_em || ""),
      enviado_em: e.enviado_em || null,
      lead_id: e.lead_id || null,
      tipo: textoOuNulo(e.tipo),
      resumo: textoOuNulo(e.resumo),
    })),
  };
}

// ------------------------------------------------------------------ endereços e simulador

/** A base das funções do servidor (o mesmo servidor do painel). */
export function enderecoDasFuncoes(): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  return `${base}/functions/v1`;
}

/** O endereço que a empresa cola no Webhooks do app dela na Meta. Vazio enquanto a conexão não foi aberta. */
export function enderecoDoWebhook(chave: string | null | undefined, base = enderecoDasFuncoes()): string {
  return chave && /^[0-9a-f]{32}$/.test(chave) ? `${base}/produto-meta/${chave}` : "";
}

export class ErroDoSimulador extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDoSimulador";
  }
}

export interface ResultadoDaSimulacao {
  nome: string | null;
  nota: number | null;
  faixa: Faixa | null;
  vendedor: string | null;
  na_fila: boolean;
  nutricao: boolean;
}

/** Lê a resposta do simulador sem confiar no formato (a função é de outro lote). */
export function lerSimulacao(d: unknown): ResultadoDaSimulacao {
  const o = (d && typeof d === "object" ? d : {}) as Record<string, any>;
  const r = o.resultado && typeof o.resultado === "object" ? o.resultado : o;
  const v = r.vendedor;
  return {
    nome: textoOuNulo(r.nome) || textoOuNulo(o.nome),
    nota: r.nota === null || r.nota === undefined || !isFinite(Number(r.nota)) ? null : Number(r.nota),
    faixa: r.faixa === "quente" || r.faixa === "morno" || r.faixa === "frio" ? r.faixa : null,
    vendedor: typeof v === "string" ? v || null : v && typeof v === "object" ? textoOuNulo(v.nome) : null,
    na_fila: !!r.na_fila,
    nutricao: !!r.nutricao,
  };
}

/** A frase do aviso depois de simular ("Lead quente, nota 82. Foi para Ana."). */
export function fraseDaSimulacao(r: ResultadoDaSimulacao): string {
  const cabeca = r.faixa ? `Lead ${r.faixa}${r.nota !== null ? `, nota ${r.nota}` : ""}.` : "Lead de teste criado.";
  const destino = r.nutricao ? " Foi para a nutrição." : r.na_fila ? " Ninguém no expediente: ficou na fila." : r.vendedor ? ` Foi para ${r.vendedor}.` : "";
  return cabeca + destino;
}

/**
 * Cria um lead de teste pelo mesmo caminho do lead de verdade (nota, rodízio,
 * mensagens simuladas). Nada sai para a Meta nem para o WhatsApp.
 */
export async function simularLead(p: { faixa?: Faixa; bem?: string } = {}): Promise<ResultadoDaSimulacao> {
  const { data } = await supabase.auth.getSession();
  const jwt = data && data.session ? data.session.access_token : "";
  if (!jwt) throw new ErroDoSimulador("Sua sessão expirou. Entre de novo para simular.");
  const corpo: Record<string, string> = {};
  if (p.faixa) corpo.faixa = p.faixa;
  if (p.bem) corpo.bem = p.bem;
  let resposta: Response;
  try {
    resposta = await fetch(`${enderecoDasFuncoes()}/produto-meta/simular`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "") },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new ErroDoSimulador("O simulador não respondeu. Confira a internet e tente de novo.");
  }
  let lido: unknown = null;
  try {
    lido = await resposta.json();
  } catch {
    lido = null;
  }
  const o = (lido && typeof lido === "object" ? lido : {}) as Record<string, unknown>;
  if (!resposta.ok || typeof o.error === "string") {
    if (typeof o.mensagem === "string" && o.mensagem) throw new ErroDoSimulador(o.mensagem);
    if (resposta.status === 404) throw new ErroDoSimulador("O simulador ainda não está no ar. Tente de novo mais tarde.");
    if (resposta.status === 401 || resposta.status === 403) throw new ErroDoSimulador("Só o gerente ou quem administra a empresa simula um lead.");
    throw new ErroDoSimulador("Não foi possível simular agora. Tente de novo em instantes.");
  }
  return lerSimulacao(lido);
}

// ------------------------------------------------------------------ contas puras (testadas)

export type ParteDaIntegracao = "visao" | "meta" | "whatsapp" | "pontuacao" | "vendedores";

export interface ItemDaConferencia {
  chave: string;
  rotulo: string;
  feito: boolean;
  /** Sem isto o banco não deixa ligar de verdade. */
  obrigatorio: boolean;
  parte: ParteDaIntegracao;
}

/**
 * O que falta conectar. Os três primeiros são a regra do banco para ligar de
 * verdade (Página, token e segredo do app); o resto é o que o WhatsApp e o
 * rodízio precisam para o lead ser atendido. `vendedores` nulo = ainda não leu.
 */
export function conferir(i: Integracao, vendedores: Vendedor[] | null = null): ItemDaConferencia[] {
  const itens: ItemDaConferencia[] = [
    { chave: "pagina", rotulo: "ID da Página", feito: !!i.pagina_id, obrigatorio: true, parte: "meta" },
    { chave: "token", rotulo: "Token do usuário do sistema", feito: i.tem_token, obrigatorio: true, parte: "meta" },
    { chave: "segredo", rotulo: "Segredo do app", feito: i.tem_app_secret, obrigatorio: true, parte: "meta" },
    { chave: "wa_numero", rotulo: "Número do WhatsApp", feito: !!i.wa_phone_id && !!i.wa_waba_id, obrigatorio: false, parte: "whatsapp" },
    { chave: "wa_token", rotulo: "Token do WhatsApp", feito: i.tem_wa_token || i.tem_token, obrigatorio: false, parte: "whatsapp" },
    { chave: "template", rotulo: "Templates de boas-vindas e de aviso", feito: !!i.templates.lead && !!i.templates.vendedor, obrigatorio: false, parte: "whatsapp" },
  ];
  if (vendedores) {
    const ativos = vendedores.filter((v) => v.estado === "ativo" && v.user_id && v.recebe_leads);
    itens.push({ chave: "vendedor", rotulo: "Alguém recebendo leads", feito: ativos.length > 0, obrigatorio: false, parte: "vendedores" });
    itens.push({ chave: "aviso", rotulo: "WhatsApp de quem recebe", feito: ativos.length > 0 && ativos.every((v) => !!v.whatsapp), obrigatorio: false, parte: "vendedores" });
  }
  return itens;
}

/** O que impede ligar de verdade (a mesma regra do banco). Vazio = pode. */
export const faltaParaLigarDeVerdade = (i: Integracao): ItemDaConferencia[] => conferir(i).filter((x) => x.obrigatorio && !x.feito);

export type SituacaoDaIntegracao = "desligada" | "teste" | "real";
export const situacaoDaIntegracao = (i: Pick<Integracao, "ativo" | "modo">): SituacaoDaIntegracao => (!i.ativo ? "desligada" : i.modo === "real" ? "real" : "teste");

/** A linha que explica o modo, uma frase só. */
export const LINHA_DO_MODO: Record<ModoDaIntegracao, string> = {
  teste: "Registra tudo e simula as mensagens. Nada sai para fora.",
  real: "Busca o lead na Meta e manda as mensagens pelo WhatsApp.",
};

/** "salvo, termina em XXXX": o que a tela mostra no lugar de um segredo guardado. */
export function linhaDoSegredo(tem: boolean, final?: string | null): string {
  if (!tem) return "";
  return final ? `Salvo, termina em ${final}` : "Salvo no cofre";
}

/** O valor colado tem cara de token ou segredo (a mesma conferência do banco). */
export const segredoPareceValido = (v: string): boolean => /^[A-Za-z0-9_.|-]{16,600}$/.test(v.trim());

/** IDs da Meta têm só números (5 a 25). Vazio também vale (limpa o campo). */
export const idDaMetaValido = (v: string): boolean => v.trim() === "" || /^[0-9]{5,25}$/.test(v.replace(/\s/g, ""));

/** Lê IDs de formulário digitados com vírgula, espaço ou linha. Só números, sem repetir, no máximo 50. */
export function lerFormularios(texto: string): string[] {
  const vistos: string[] = [];
  texto.split(/[\s,;]+/).forEach((p) => {
    if (/^[0-9]{5,25}$/.test(p) && vistos.indexOf(p) < 0) vistos.push(p);
  });
  return vistos.slice(0, 50);
}

/** Prazos de follow-up: inteiros de 1 a 240 horas, em ordem, sem repetir, no máximo 3. */
export function lerPrazos(valores: Array<string | number>): number[] {
  const horas: number[] = [];
  valores.forEach((v) => {
    const n = Math.round(Number(String(v).trim()));
    if (String(v).trim() !== "" && isFinite(n) && n >= 1 && n <= 240 && horas.indexOf(n) < 0) horas.push(n);
  });
  return horas.sort((a, b) => a - b).slice(0, 3);
}

/** "24 h" ou "3 dias" para o prazo em horas. */
export function prazoLegivel(horas: number): string {
  if (horas >= 48 && horas % 24 === 0) return `${horas / 24} dias`;
  return `${horas} h`;
}

/** O nome de template que o WhatsApp aceita: minúsculas, números e sublinhado. */
export const nomeDeTemplateValido = (v: string): boolean => v.trim() === "" || /^[a-z0-9_]{1,120}$/.test(v.trim());

export const DIAS_DA_SEMANA: Array<{ dia: number; curto: string; nome: string }> = [
  { dia: 1, curto: "Seg", nome: "Segunda" },
  { dia: 2, curto: "Ter", nome: "Terça" },
  { dia: 3, curto: "Qua", nome: "Quarta" },
  { dia: 4, curto: "Qui", nome: "Quinta" },
  { dia: 5, curto: "Sex", nome: "Sexta" },
  { dia: 6, curto: "Sáb", nome: "Sábado" },
  { dia: 7, curto: "Dom", nome: "Domingo" },
];

const juntarComE = (itens: string[]): string => (itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`);

/** "Sempre", "Seg a sex, 09:00 às 18:00", "Seg, qua e sáb, 08:00 às 12:00". Sem dias marcados = todos os dias. */
export function formatarExpediente(e: Expediente | null | undefined): string {
  const exp = lerExpediente(e);
  if (!exp.inicio || !exp.fim) return "Sempre";
  const dias = exp.dias || [];
  const horario = `${exp.inicio} às ${exp.fim}`;
  if (dias.length === 0 || dias.length === 7) return `Todos os dias, ${horario}`;
  const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  const curto = (d: number) => DIAS_DA_SEMANA[d - 1].curto;
  const nomes = seguidos && dias.length >= 3 ? `${curto(dias[0])} a ${curto(dias[dias.length - 1]).toLowerCase()}` : juntarComE(dias.map((d, i) => (i === 0 ? curto(d) : curto(d).toLowerCase())));
  return `${nomes}, ${horario}`;
}

/** O que impede salvar o expediente (a mesma regra do banco). Nulo = pode. */
export function erroDoExpediente(e: Expediente): string | null {
  if (!e.inicio && !e.fim) return null;
  if (!HORA.test(e.inicio || "") || !HORA.test(e.fim || "")) return "Diga o início e o fim, como 09:00 e 18:00.";
  if ((e.inicio as string) >= (e.fim as string)) return "O fim precisa ser depois do início.";
  return null;
}

/** A mesma conta do banco (crm_no_expediente), no fuso de São Paulo: para a tela mostrar antes de salvar. */
export function noExpediente(e: Expediente | null | undefined, quando: Date = new Date()): boolean {
  const exp = lerExpediente(e);
  if (!exp.inicio || !exp.fim) return true;
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(quando);
  const de = (tipo: string) => (partes.filter((p) => p.type === tipo)[0] || { value: "" }).value;
  const dia = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(de("weekday")) + 1;
  const hora = `${de("hour") === "24" ? "00" : de("hour")}:${de("minute")}`;
  if (exp.dias && exp.dias.length > 0 && exp.dias.indexOf(dia) < 0) return false;
  return hora >= exp.inicio && hora < exp.fim;
}

/** Só números, com país e DDD. Número brasileiro digitado sem o 55 ganha o 55. */
export function limparWhatsapp(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}
export const whatsappValido = (v: string): boolean => v.trim() === "" || /^[0-9]{10,15}$/.test(limparWhatsapp(v));

/** "+55 41 99999-0000" para ler; devolve o que veio quando não é número brasileiro. */
export function whatsappLegivel(v: string | null | undefined): string {
  const d = (v || "").replace(/\D/g, "");
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d ? `+${d}` : "";
}

// ------------------------------------------------------------------ pontuação

const NOMES_DE_OPCAO: Record<string, string> = {
  imovel: "Imóvel",
  carro: "Carro",
  moto: "Moto",
  pesados: "Pesados",
  servicos: "Serviços",
  outros: "Outros",
  sim: "Sim",
  nao: "Não",
  agora: "Agora",
  este_mes: "Este mês",
  sem_pressa: "Sem pressa",
};

/** "menos_de_3_meses" vira "Menos de 3 meses"; os conhecidos ganham acento. */
export function nomeDaOpcao(chave: string): string {
  if (NOMES_DE_OPCAO[chave]) return NOMES_DE_OPCAO[chave];
  const t = chave.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : chave;
}

/** A chave de uma opção ou critério a partir do que a pessoa escreveu (o formato que `lerRegras` aceita). */
export function chaveDoTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Os bens que as regras conhecem (as opções do critério "bem"): viram as etiquetas do vendedor. */
export function bensDasRegras(regras: RegrasDePontuacao): string[] {
  const c = regras.criterios.filter((x) => x.campo === "bem" || x.campo === "tipo_de_bem")[0];
  return c && c.tipo === "opcao" ? Object.keys(c.pontos) : [];
}

/** O rótulo de uma faixa de valor: "Até 40.000", "De 40.001 a 150.000", "Acima de 150.000". */
export function nomeDaFaixaDeValor(faixas: Array<{ ate?: number }>, i: number): string {
  const n = (v: number) => v.toLocaleString("pt-BR");
  const f = faixas[i];
  const antes = i > 0 ? faixas[i - 1].ate : undefined;
  if (f.ate === undefined) return antes === undefined ? "Qualquer valor" : `Acima de ${n(antes)}`;
  return antes === undefined ? `Até ${n(f.ate)}` : `De ${n(antes + 1)} a ${n(f.ate)}`;
}

export interface NotaSimulada extends ResultadoDaPontuacao {
  /** A soma máxima das regras (a nota é proporcional a ela). */
  maximo: number;
  /** Critérios ainda sem resposta. */
  semResposta: string[];
}

/** A nota de um conjunto de respostas com as regras que estão na tela (ainda não salvas). */
export function simularNota(respostas: Record<string, unknown>, regras: RegrasDePontuacao): NotaSimulada {
  const r = pontuar(respostas, regras);
  const semResposta = regras.criterios.filter((c) => respostas[c.campo] === undefined || respostas[c.campo] === null || respostas[c.campo] === "").map((c) => c.rotulo);
  return { ...r, maximo: notaMaxima(regras), semResposta };
}

/** Respostas de exemplo que caem na faixa pedida (para preencher o simulador de uma vez). */
export function respostasDeExemplo(regras: RegrasDePontuacao, faixa: Faixa): Record<string, string | number> {
  const escolher = (c: Criterio, melhor: boolean): string | number => {
    if (c.tipo === "faixa") {
      const ordenadas = c.faixas.map((f, i) => ({ f, i })).sort((a, b) => (melhor ? b.f.pontos - a.f.pontos : a.f.pontos - b.f.pontos));
      const { f, i } = ordenadas[0];
      return f.ate !== undefined ? f.ate : (i > 0 && c.faixas[i - 1].ate !== undefined ? (c.faixas[i - 1].ate as number) : 0) + 1;
    }
    const semNutricao = Object.keys(c.pontos).filter((k) => !(c.nutricao && c.nutricao.indexOf(k) >= 0));
    const chaves = (semNutricao.length ? semNutricao : Object.keys(c.pontos)).sort((a, b) => (melhor ? c.pontos[b] - c.pontos[a] : c.pontos[a] - c.pontos[b]));
    return chaves[0];
  };
  const todas = (ate: number): Record<string, string | number> => {
    const r: Record<string, string | number> = {};
    regras.criterios.forEach((c, i) => {
      r[c.campo] = escolher(c, i < ate);
    });
    return r;
  };
  // Do melhor para o pior, trocando um critério por vez, até cair na faixa pedida.
  for (let n = regras.criterios.length; n >= 0; n -= 1) {
    const r = todas(n);
    if (pontuar(r, regras).faixa === faixa) return r;
  }
  return todas(faixa === "quente" ? regras.criterios.length : 0);
}

/** As regras da tela são as mesmas do padrão do ramo (salvar vazio para acompanhar o padrão). */
export const ehOPadrao = (regras: RegrasDePontuacao, nicho?: string | null): boolean => JSON.stringify(lerRegras(regras, nicho)) === JSON.stringify(lerRegras(regrasDoRamo(nicho), nicho));

/** Os cortes sempre coerentes: quente de 1 a 100 e morno abaixo dele. */
export function ajustarCortes(cortes: { quente: number; morno: number }, mudou: "quente" | "morno"): { quente: number; morno: number } {
  let quente = Math.max(1, Math.min(100, Math.round(cortes.quente)));
  let morno = Math.max(0, Math.min(99, Math.round(cortes.morno)));
  if (morno >= quente) {
    if (mudou === "quente") morno = quente - 1;
    else quente = morno + 1;
  }
  return { quente, morno };
}

/** O que impede salvar as regras. Nulo = pode. */
export function erroDasRegras(regras: RegrasDePontuacao): string | null {
  if (!regras.criterios.length) return "Deixe pelo menos um critério.";
  if (regras.criterios.length > 12) return "No máximo 12 critérios.";
  const campos = regras.criterios.map((c) => c.campo);
  if (campos.some((c, i) => !c || campos.indexOf(c) !== i)) return "Cada critério precisa de um nome diferente.";
  if (regras.criterios.some((c) => (c.tipo === "opcao" ? Object.keys(c.pontos).length === 0 : c.faixas.length === 0))) return "Cada critério precisa de pelo menos uma opção.";
  if (notaMaxima(regras) <= 0) return "Dê pontos a pelo menos uma resposta.";
  return null;
}

// ------------------------------------------------------------------ atividade e templates

export const NOME_DA_FAIXA: Record<Faixa, string> = { quente: "Quente", morno: "Morno", frio: "Frio" };

/** Para onde o lead foi, numa expressão curta. */
export function destinoDoLead(l: Pick<LeadDaAtividade, "situacao" | "vendedor" | "fila_desde" | "nutricao" | "erro">): string {
  if (l.situacao === "erro") return l.erro || "Não entrou";
  if (l.situacao === "ignorado") return "Ignorado";
  if (l.situacao === "recebido") return "Chegando";
  if (l.nutricao) return "Nutrição";
  if (l.fila_desde) return "Na fila";
  if (l.vendedor) return l.vendedor;
  return l.situacao === "repetido" ? "Já estava no funil" : "Sem vendedor";
}

export const NOME_DO_ENVIO: Record<EnvioDaAtividade["situacao"], string> = { pendente: "Na fila", enviado: "Enviada", simulado: "Simulada", erro: "Erro" };

export interface TemplateSugerido {
  chave: ChaveDoTemplate;
  rotulo: string;
  /** O nome para criar no Gerenciador do WhatsApp. */
  nome: string;
  categoria: "Utilidade" | "Marketing";
  texto: string;
  /** O que entra em cada {{n}}, na ordem. */
  variaveis: string[];
  /** Botões de resposta rápida, na ordem (o servidor conta com eles). */
  botoes: string[];
  /** Sem ele o caminho principal não anda (boas-vindas e aviso ao vendedor). */
  obrigatorio: boolean;
  observacao: string;
}

/**
 * Os templates que a empresa cria no WhatsApp dela. A lista é a do servidor
 * (templatesNecessarios em supabase/functions/_shared/whatsapp-do-crm.ts): o
 * mesmo nome, texto, variáveis e botões que o robô usa na hora de enviar. Para
 * mudar um texto, mude lá.
 */
export const TEMPLATES_SUGERIDOS: TemplateSugerido[] = templatesNecessarios().map((t) => ({
  chave: t.chave,
  rotulo: t.titulo,
  nome: t.nome,
  categoria: t.categoria === "UTILITY" ? "Utilidade" : "Marketing",
  texto: t.corpo,
  variaveis: t.variaveis.slice().sort((a, b) => a.numero - b.numero).map((v) => v.o_que_e),
  botoes: t.botoes.slice(),
  obrigatorio: t.obrigatorio,
  observacao: t.observacao,
}));

/** Os passos do modo manual, na ordem em que a empresa faz na Meta. */
export const PASSOS_DA_META: string[] = [
  "No Gerenciador de Negócios da sua empresa, crie um app do tipo Empresa (developers.facebook.com, Meus apps, Criar app) e copie a Chave secreta em Configurações do app, Básico.",
  "No app, adicione o produto Webhooks, escolha Página, cole o endereço e o token de verificação abaixo, verifique e assine o campo leadgen.",
  "Nas Configurações do negócio, crie um usuário do sistema, dê a ele a Página (controle total) e o app, e gere um token sem expiração com leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata e ads_management.",
  "Instale o app na Página: no Explorador da Graph API, com o token da Página, envie POST /ID_DA_PAGINA/subscribed_apps?subscribed_fields=leadgen. Sem este passo nenhum lead chega.",
  "Em Configurações do negócio, Integrações, Acesso a leads, confira que o app e o usuário do sistema têm acesso aos leads da Página, e ponha o app em modo Ao vivo.",
  "Cole aqui o ID da Página, o token e a chave secreta do app e salve.",
  "Teste em três degraus: Simular um lead aqui; depois ligar em modo teste e mandar um lead pela ferramenta de teste de anúncios de cadastro da Meta; por fim, passar para De verdade.",
];
