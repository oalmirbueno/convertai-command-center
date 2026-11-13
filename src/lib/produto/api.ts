import { supabase } from "@/integrations/supabase/client";
import { limitesDoPlano, type LimitesDoPlano } from "@/lib/comercial/escopo";
import { lerAparencia, type AparenciaDaEmpresa } from "./aparencia";
import { lerPerfil, type PerfilDaEmpresa } from "./nichos";

/**
 * Produto CRM e E-mail: o que a tela lê e pede.
 * Contrato do banco: supabase/migrations/20261113120000_produto_crm_e_email.sql.
 * O que precisa do Asaas ou de chave de serviço passa pela função `produto`.
 */

// As tabelas do produto ainda não estão nos tipos gerados do banco: o que volta
// dele é lido como `any` e convertido, campo a campo, nas funções abaixo.
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { message: string; code?: string } | null }>;
};

export type EstadoDaConta = "teste" | "ativa" | "atrasada" | "suspensa" | "cancelada" | "cortesia";
export type PapelNaConta = "admin" | "usuario";

export interface MembroDaConta {
  id: string;
  user_id: string | null;
  nome: string;
  email: string | null;
  papel: PapelNaConta;
  estado: "convidado" | "ativo" | "removido";
  entrou_em: string | null;
}

export interface ItemDaMensalidade {
  chave: string;
  nome: string;
  quantidade: number;
  unitario: number;
  total: number;
}

export interface AssinaturaDaConta {
  troca_agendada: { plano_id: string; usuarios: number; valor: number } | null;
  estado: "sem" | "aguardando" | "ativa" | "atrasada" | "cancelada";
  valor_mensal: number;
  proximo_vencimento: string | null;
  cartao_final: string | null;
  cartao_bandeira: string | null;
  itens: ItemDaMensalidade[];
  checkout_link: string | null;
}

export interface EstadoDoProduto {
  conta: {
    id: string;
    nome: string;
    estado: EstadoDaConta;
    plano_id: string;
    usuarios_contratados: number;
    crm_ativo: boolean;
    email_ativo: boolean;
    email_caixas_contratadas: number;
    teste_ate: string | null;
    atrasada_desde: string | null;
    acesso_ate: string | null;
    visibilidade: "todos" | "proprios";
    aparencia: AparenciaDaEmpresa;
    perfil: PerfilDaEmpresa;
    documento: string | null;
    email_cobranca: string | null;
    telefone: string | null;
  } | null;
  eu: { membro_id: string; papel: PapelNaConta; nome: string; email: string } | null;
  plano: { id: string; nome: string; preco_usuario: number; limites: LimitesDoPlano; email_caixas_incluidas: number } | null;
  liberada: boolean;
  crm: boolean;
  email: boolean;
  dono_da_casa: boolean;
  pagamentos_ativos: boolean;
  tolerancia_dias: number;
  teste_dias: number;
  equipe: MembroDaConta[];
  maquina_no_mes: number;
  assinatura: AssinaturaDaConta | null;
  convite: { conta: string; papel: PapelNaConta } | null;
}

export interface PlanoDoProduto {
  id: string;
  nome: string;
  resumo: string;
  preco_usuario: number;
  minimo_usuarios: number;
  recursos: string[];
  limites: LimitesDoPlano;
  email_caixas_incluidas: number;
  destaque: boolean;
  ativo: boolean;
  ordem: number;
}

export interface ConfigDoProduto {
  pagamentos_ativos: boolean;
  teste_dias: number;
  tolerancia_dias: number;
  email_migracao: number;
  email_mensal: number;
  email_caixas_no_mensal: number;
  email_caixa_extra: number;
  custo_fixo_mensal: number;
  custo_email_caixa_extra: number;
  custo_lugar_google_usd: number;
  dolar: number;
  imposto_pct: number;
}

export class ErroDoProduto extends Error {
  codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroDoProduto";
    this.codigo = codigo;
  }
}

const numero = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};
const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** A frase que o banco mandou quando a regra recusou; senão, a frase padrão. */
export function fraseDoErro(e: unknown, padrao = "Não foi possível concluir. Tente de novo."): string {
  if (e instanceof ErroDoProduto) return e.message;
  const m = e && typeof (e as { message?: unknown }).message === "string" ? String((e as { message: string }).message) : "";
  const codigo = e ? String((e as { code?: unknown }).code || "") : "";
  if (m && (codigo === "P0001" || codigo === "42501")) return m;
  if (/row-level security|permission denied/i.test(m)) return "Você não tem permissão para esta ação.";
  return padrao;
}

export const chaveDoProduto = ["produto", "estado"] as const;

function lerEstado(d: any): EstadoDoProduto {
  const conta = d && d.conta ? d.conta : null;
  const ass = d && d.assinatura ? d.assinatura : null;
  return {
    conta: conta
      ? {
          ...conta,
          usuarios_contratados: numero(conta.usuarios_contratados),
          email_caixas_contratadas: numero(conta.email_caixas_contratadas),
          aparencia: lerAparencia(conta.aparencia),
          perfil: lerPerfil(conta.perfil),
        }
      : null,
    eu: d && d.eu ? d.eu : null,
    plano: d && d.plano
      ? { id: String(d.plano.id), nome: String(d.plano.nome), preco_usuario: numero(d.plano.preco_usuario), limites: limitesDoPlano(d.plano.limites), email_caixas_incluidas: numero(d.plano.email_caixas_incluidas) }
      : null,
    liberada: !!(d && d.liberada),
    crm: !!(d && d.crm),
    email: !!(d && d.email),
    dono_da_casa: !!(d && d.dono_da_casa),
    pagamentos_ativos: !!(d && d.pagamentos_ativos),
    tolerancia_dias: numero(d && d.tolerancia_dias),
    teste_dias: numero(d && d.teste_dias),
    equipe: lista<MembroDaConta>(d && d.equipe),
    maquina_no_mes: numero(d && d.maquina_no_mes),
    assinatura: ass
      ? {
          estado: ass.estado || "sem",
          valor_mensal: numero(ass.valor_mensal),
          proximo_vencimento: ass.proximo_vencimento || null,
          cartao_final: ass.cartao_final || null,
          cartao_bandeira: ass.cartao_bandeira || null,
          itens: lista<ItemDaMensalidade>(ass.itens),
          checkout_link: ass.checkout_link || null,
          troca_agendada: ass.troca_agendada && typeof ass.troca_agendada === "object" ? { plano_id: String(ass.troca_agendada.plano_id || ""), usuarios: numero(ass.troca_agendada.usuarios), valor: numero(ass.troca_agendada.valor) } : null,
        }
      : null,
    convite: d && d.convite ? d.convite : null,
  };
}

/**
 * O estado do produto para quem está logado. Quem foi convidado e ainda não
 * entrou é colocado na empresa aqui (o banco confere o e-mail confirmado).
 */
export async function carregarProduto(): Promise<EstadoDoProduto> {
  const { data, error } = await db.rpc("produto_estado");
  if (error) throw error;
  return lerEstado(data);
}

/** A pessoa convidada aceita e entra na empresa (o banco confere o e-mail confirmado). */
export async function aceitarConvite(): Promise<void> {
  const { error } = await db.rpc("produto_aceitar_convite");
  if (error) throw error;
}

/** A pessoa convidada recusa: o lugar volta para a empresa. */
export async function recusarConvite(): Promise<void> {
  const { error } = await db.rpc("produto_recusar_convite");
  if (error) throw error;
}

/** Sair da empresa por conta própria. */
export async function sairDaEmpresa(): Promise<void> {
  const { error } = await db.rpc("produto_sair");
  if (error) throw error;
}

/** Só a pergunta "esta pessoa tem empresa no produto?", para o login decidir aonde levar. */
export async function temContaNoProduto(): Promise<boolean> {
  try {
    const estado = await carregarProduto();
    return !!estado.conta;
  } catch {
    return false;
  }
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("produto", { body: corpo });
  if (error) {
    let resposta: { error?: string; mensagem?: string } | null = null;
    try {
      const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context;
      resposta = ctx && typeof ctx.clone === "function" ? ((await ctx.clone().json()) as { error?: string; mensagem?: string }) : null;
    } catch {
      resposta = null;
    }
    if (resposta && resposta.mensagem) throw new ErroDoProduto(String(resposta.error || "erro"), resposta.mensagem);
    throw new ErroDoProduto("servico_indisponivel", "O serviço não respondeu agora. Tente de novo em instantes.");
  }
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    throw new ErroDoProduto(String((data as { error: string }).error), String((data as { mensagem?: string }).mensagem || "Não foi possível concluir."));
  }
  return data as T;
}

// ------------------------------------------------------------------ a empresa

export async function criarConta(p: { nome: string; documento?: string; telefone?: string; plano?: string; usuarios?: number; perfil?: PerfilDaEmpresa }): Promise<string> {
  const { data, error } = await db.rpc("produto_criar_conta", {
    _nome: p.nome,
    _documento: p.documento || null,
    _telefone: p.telefone || null,
    _plano: p.plano || "starter",
    _usuarios: p.usuarios || 1,
    _perfil: p.perfil || {},
  });
  if (error) throw error;
  return String(data);
}

export async function salvarConta(dados: Partial<{ nome: string; documento: string; telefone: string; email_cobranca: string; visibilidade: "todos" | "proprios"; aparencia: AparenciaDaEmpresa; perfil: PerfilDaEmpresa }>): Promise<void> {
  const { error } = await db.rpc("produto_conta_salvar", { _dados: dados });
  if (error) throw error;
}

export const convidar = (p: { email: string; nome?: string; papel?: PapelNaConta }) =>
  chamar<{ membro_id: string; enviado: boolean }>({ acao: "convidar", ...p });
export const reenviarConvite = (membroId: string) => chamar<{ enviado: boolean }>({ acao: "reenviar_convite", membro_id: membroId });

export async function mudarMembro(membroId: string, p: { papel?: PapelNaConta; remover?: boolean }): Promise<void> {
  const { error } = await db.rpc("produto_membro_mudar", { _membro: membroId, _papel: p.papel || null, _remover: !!p.remover });
  if (error) throw error;
}

/** Assina (abre o checkout) ou, em teste e cortesia, só guarda o plano e os usuários (`so_guardar`). */
export const assinar = (p: { plano_id: string; usuarios: number; so_guardar?: boolean }) => chamar<{ link?: string; atualizado?: boolean; agendado?: boolean; a_partir_de?: string | null; valor?: number }>({ acao: "assinar", ...p });
export const cancelarAssinatura = () => chamar<{ cancelada: boolean; acesso_ate: string }>({ acao: "cancelar" });
export const pedirEmail = (p: { dominio?: string; caixas?: number; observacao?: string }) => chamar<{ ok: boolean }>({ acao: "pedir_email", ...p });

// ------------------------------------------------------------------ conexões (API, Claude, ChatGPT)

export interface ChaveDeApi {
  id: string;
  nome: string;
  prefixo: string;
  criado_em: string;
  ultimo_uso_em: string | null;
  revogada_em: string | null;
}

export async function listarChaves(): Promise<ChaveDeApi[]> {
  const { data, error } = await db.from("produto_chaves_api").select("id, nome, prefixo, criado_em, ultimo_uso_em, revogada_em").order("criado_em", { ascending: false });
  if (error) throw error;
  return lista<ChaveDeApi>(data);
}

/** Cria a chave. O texto dela só existe nesta resposta: no banco fica o resumo. */
export async function criarChave(nome: string): Promise<{ id: string; chave: string }> {
  const { data, error } = await db.rpc("produto_chave_criar", { _nome: nome });
  if (error) throw error;
  return { id: String(data.id), chave: String(data.chave) };
}

export async function revogarChave(id: string): Promise<void> {
  const { error } = await db.rpc("produto_chave_revogar", { _id: id });
  if (error) throw error;
}

/** O endereço da API do CRM (o mesmo servidor do painel). */
export function enderecoDaApi(): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  return `${base}/functions/v1/produto-api`;
}

// ------------------------------------------------------------------ catálogo

export async function listarPlanos(todos = false): Promise<PlanoDoProduto[]> {
  let q = db.from("produto_planos").select("*").order("ordem", { ascending: true });
  if (!todos) q = q.eq("ativo", true);
  const { data, error } = await q;
  if (error) throw error;
  return lista<any>(data).map((p) => ({
    id: String(p.id),
    nome: String(p.nome),
    resumo: String(p.resumo || ""),
    preco_usuario: numero(p.preco_usuario),
    minimo_usuarios: Math.max(1, numero(p.minimo_usuarios)),
    recursos: lista<unknown>(p.recursos).map(String),
    limites: limitesDoPlano(p.limites),
    email_caixas_incluidas: numero(p.email_caixas_incluidas),
    destaque: !!p.destaque,
    ativo: !!p.ativo,
    ordem: numero(p.ordem),
  }));
}

/** Os preços que a empresa vê (sem os custos da casa, que ficam só para o admin). */
export async function lerPrecos(): Promise<ConfigDoProduto> {
  const { data, error } = await db.rpc("produto_precos");
  if (error) throw error;
  const c = data || {};
  return {
    pagamentos_ativos: !!c.pagamentos_ativos,
    teste_dias: numero(c.teste_dias),
    tolerancia_dias: numero(c.tolerancia_dias),
    email_migracao: numero(c.email_migracao),
    email_mensal: numero(c.email_mensal),
    email_caixas_no_mensal: numero(c.email_caixas_no_mensal),
    email_caixa_extra: numero(c.email_caixa_extra),
    custo_fixo_mensal: 0,
    custo_email_caixa_extra: 0,
    custo_lugar_google_usd: 0,
    dolar: 0,
    imposto_pct: 0,
  };
}

/** A configuração inteira, com os custos da casa: só o admin da Aceleriq lê. */
export async function lerConfig(): Promise<ConfigDoProduto> {
  const { data, error } = await db.from("produto_config").select("*").maybeSingle();
  if (error) throw error;
  const c = data || {};
  return {
    pagamentos_ativos: !!c.pagamentos_ativos,
    teste_dias: numero(c.teste_dias),
    tolerancia_dias: numero(c.tolerancia_dias),
    email_migracao: numero(c.email_migracao),
    email_mensal: numero(c.email_mensal),
    email_caixas_no_mensal: numero(c.email_caixas_no_mensal),
    email_caixa_extra: numero(c.email_caixa_extra),
    custo_fixo_mensal: numero(c.custo_fixo_mensal),
    custo_email_caixa_extra: numero(c.custo_email_caixa_extra),
    custo_lugar_google_usd: numero(c.custo_lugar_google_usd),
    dolar: numero(c.dolar),
    imposto_pct: numero(c.imposto_pct),
  };
}

// ------------------------------------------------------------------ cobranças

export interface CobrancaDoProduto {
  id: string;
  conta_id: string;
  tipo: "mensalidade" | "migracao" | "avulsa";
  descricao: string;
  valor: number;
  valor_liquido: number | null;
  vencimento: string | null;
  estado: "aberta" | "paga" | "atrasada" | "estornada" | "cancelada";
  pago_em: string | null;
  forma: string | null;
  link: string | null;
}

export async function listarCobrancas(contaId?: string, limite = 24): Promise<CobrancaDoProduto[]> {
  let q = db.from("produto_cobrancas").select("id, conta_id, tipo, descricao, valor, valor_liquido, vencimento, estado, pago_em, forma, link").order("vencimento", { ascending: false }).limit(limite);
  if (contaId) q = q.eq("conta_id", contaId);
  const { data, error } = await q;
  if (error) throw error;
  return lista<any>(data).map((c) => ({ ...c, valor: numero(c.valor), valor_liquido: c.valor_liquido == null ? null : numero(c.valor_liquido) }));
}

// ------------------------------------------------------------------ e-mail

export type EstadoDoDominio = "levantamento" | "preparando" | "virada" | "concluido" | "pausado";
export type ProvedorDeEmail = "zoho" | "google" | "microsoft" | "outro";

export interface ItemDaChecagem {
  chave: "mx" | "spf" | "dkim" | "dmarc";
  titulo: string;
  estado: "certo" | "atencao" | "falta";
  achado: string[];
  esperado: string;
  explicacao: string;
}

export interface ChecagemDoDominio {
  dominio: string;
  itens: ItemDaChecagem[];
  pronto: boolean;
  conferido_em: string;
}

export interface DominioDeEmail {
  id: string;
  conta_id: string;
  dominio: string;
  provedor: ProvedorDeEmail;
  provedor_antigo: string | null;
  dns_em: string | null;
  registro_em: string | null;
  webmail_url: string | null;
  dkim_seletor: string | null;
  estado: EstadoDoDominio;
  checagem: ChecagemDoDominio | null;
  checado_em: string | null;
  observacao: string | null;
}

export interface CaixaDeEmail {
  id: string;
  dominio_id: string;
  conta_id: string;
  endereco: string;
  pessoa: string;
  tipo: "caixa" | "apelido" | "grupo";
  estado: "pedida" | "criada" | "copiando" | "ativa" | "removida";
  tamanho_origem: string | null;
  observacao: string | null;
}

export interface EtapaDaMigracao {
  id: string;
  dominio_id: string;
  ordem: number;
  chave: string;
  titulo: string;
  ajuda: string;
  feito_em: string | null;
  nota: string | null;
}

export const ROTULO_DO_PROVEDOR: Record<ProvedorDeEmail, string> = { zoho: "Zoho Mail", google: "Google Workspace", microsoft: "Microsoft 365", outro: "Outro provedor" };
export const WEBMAIL_DO_PROVEDOR: Record<ProvedorDeEmail, string> = { zoho: "https://mail.zoho.com", google: "https://mail.google.com", microsoft: "https://outlook.office.com/mail", outro: "" };
export const ROTULO_DO_ESTADO_DO_DOMINIO: Record<EstadoDoDominio, string> = {
  levantamento: "Levantamento",
  preparando: "Preparando",
  virada: "Em virada",
  concluido: "No ar",
  pausado: "Pausado",
};

const checagemValida = (c: unknown): ChecagemDoDominio | null =>
  c && typeof c === "object" && Array.isArray((c as { itens?: unknown }).itens) ? (c as ChecagemDoDominio) : null;

/** O e-mail da própria empresa, como ela pode ver (sem as anotações internas da casa). */
export async function carregarEmailDaEmpresa(): Promise<{ dominios: DominioDeEmail[]; caixas: CaixaDeEmail[]; etapas: EtapaDaMigracao[] }> {
  const { data, error } = await db.rpc("produto_email_da_conta");
  if (error) throw error;
  const d = data || {};
  const vazio = { provedor_antigo: null, dns_em: null, registro_em: null, dkim_seletor: null, observacao: null };
  return {
    dominios: lista<any>(d.dominios).map((x) => ({ ...vazio, ...x, checagem: checagemValida(x.checagem) })),
    caixas: lista<any>(d.caixas).map((c) => ({ tamanho_origem: null, observacao: null, ...c })),
    etapas: lista<any>(d.etapas).map((e) => ({ ajuda: "", nota: null, ...e })),
  };
}

/** A casa lê tudo, de todas as empresas ou de uma. */
export async function carregarEmail(contaId?: string): Promise<{ dominios: DominioDeEmail[]; caixas: CaixaDeEmail[]; etapas: EtapaDaMigracao[] }> {
  let d = db.from("produto_email_dominios").select("*").order("criado_em", { ascending: true });
  let c = db.from("produto_email_caixas").select("*").neq("estado", "removida").order("endereco", { ascending: true });
  let e = db.from("produto_email_etapas").select("*").order("ordem", { ascending: true });
  if (contaId) {
    d = d.eq("conta_id", contaId);
    c = c.eq("conta_id", contaId);
    e = e.eq("conta_id", contaId);
  }
  const [dominios, caixas, etapas] = await Promise.all([d, c, e]);
  if (dominios.error) throw dominios.error;
  if (caixas.error) throw caixas.error;
  if (etapas.error) throw etapas.error;
  return {
    dominios: lista<any>(dominios.data).map((x) => ({ ...x, checagem: checagemValida(x.checagem) })),
    caixas: lista<CaixaDeEmail>(caixas.data),
    etapas: lista<EtapaDaMigracao>(etapas.data),
  };
}

export async function pedirCaixa(endereco: string, pessoa: string): Promise<void> {
  const { error } = await db.rpc("produto_email_pedir_caixa", { _endereco: endereco, _pessoa: pessoa });
  if (error) throw error;
}

export const conferirDns = (dominioId: string) => chamar<{ checagem: ChecagemDoDominio }>({ acao: "dns", dominio_id: dominioId }).then((r) => r.checagem);

// ------------------------------------------------------------------ a casa

export interface ContaNaCasa {
  id: string;
  nome: string;
  documento: string | null;
  email_cobranca: string | null;
  telefone: string | null;
  client_id: string | null;
  plano_id: string;
  usuarios_contratados: number;
  crm_ativo: boolean;
  email_ativo: boolean;
  email_caixas_contratadas: number;
  estado: EstadoDaConta;
  teste_ate: string | null;
  atrasada_desde: string | null;
  acesso_ate: string | null;
  visibilidade: "todos" | "proprios";
  origem: "site" | "painel";
  observacao: string | null;
  criado_em: string;
  liberada: boolean;
  valor_mensal: number;
  itens: ItemDaMensalidade[];
  usuarios_ativos: number;
  convites: number;
  equipe: Array<{ id: string; nome: string; email: string; papel: PapelNaConta; estado: string; entrou_em: string | null }>;
  assinatura: { estado: AssinaturaDaConta["estado"]; valor_mensal: number; proximo_vencimento: string | null; cartao_final: string | null; asaas_assinatura_id: string | null } | null;
  dominios: number;
  negocios: number;
  ultimo_uso: string | null;
}

export async function listarContasDaCasa(): Promise<ContaNaCasa[]> {
  const { data, error } = await db.rpc("produto_admin_contas");
  if (error) throw error;
  return lista<any>(data).map((c) => ({
    ...c,
    usuarios_contratados: numero(c.usuarios_contratados),
    email_caixas_contratadas: numero(c.email_caixas_contratadas),
    valor_mensal: numero(c.valor_mensal),
    itens: lista<ItemDaMensalidade>(c.itens),
    usuarios_ativos: numero(c.usuarios_ativos),
    convites: numero(c.convites),
    equipe: lista(c.equipe),
    dominios: numero(c.dominios),
    negocios: numero(c.negocios),
  }));
}

export interface FaturamentoDoProduto {
  mes: string;
  mrr: number;
  recebido: number;
  recebido_liquido: number;
  taxas: number;
  a_receber: number;
  atrasado: number;
  imposto: number;
  custos_lancados: number;
  custo_fixo: number;
  custo_email: number;
  custo_total: number;
  contas: { ativas: number; teste: number; atrasadas: number; suspensas: number; canceladas: number; cortesia: number; usuarios_pagos: number; com_email: number };
  custos_por_tipo: Record<string, number>;
  serie: Array<{ mes: string; recebido: number; custos: number }>;
  por_conta: Array<{ conta_id: string; nome: string; estado: EstadoDaConta; plano_id: string; usuarios: number; mensal: number; recebido: number; aberto: number; custo: number }>;
}

export async function lerFaturamento(mes: string): Promise<FaturamentoDoProduto> {
  const { data, error } = await db.rpc("produto_faturamento", { _mes: mes });
  if (error) throw error;
  const d = data || {};
  const contas = d.contas || {};
  const tipos: Record<string, number> = {};
  Object.keys(d.custos_por_tipo || {}).forEach((k) => {
    tipos[k] = numero(d.custos_por_tipo[k]);
  });
  return {
    mes: String(d.mes || mes),
    mrr: numero(d.mrr),
    recebido: numero(d.recebido),
    recebido_liquido: numero(d.recebido_liquido),
    taxas: numero(d.taxas),
    a_receber: numero(d.a_receber),
    atrasado: numero(d.atrasado),
    imposto: numero(d.imposto),
    custos_lancados: numero(d.custos_lancados),
    custo_fixo: numero(d.custo_fixo),
    custo_email: numero(d.custo_email),
    custo_total: numero(d.custo_total),
    contas: {
      ativas: numero(contas.ativas), teste: numero(contas.teste), atrasadas: numero(contas.atrasadas), suspensas: numero(contas.suspensas),
      canceladas: numero(contas.canceladas), cortesia: numero(contas.cortesia), usuarios_pagos: numero(contas.usuarios_pagos), com_email: numero(contas.com_email),
    },
    custos_por_tipo: tipos,
    serie: lista<any>(d.serie).map((s) => ({ mes: String(s.mes), recebido: numero(s.recebido), custos: numero(s.custos) })),
    por_conta: lista<any>(d.por_conta).map((c) => ({ ...c, usuarios: numero(c.usuarios), mensal: numero(c.mensal), recebido: numero(c.recebido), aberto: numero(c.aberto), custo: numero(c.custo) })),
  };
}

export const casa = {
  criarConta: (p: Record<string, unknown>) => chamar<{ conta_id: string; enviado: boolean }>({ acao: "admin_criar_conta", ...p }),
  convidar: (p: { conta_id: string; email: string; nome?: string; papel?: PapelNaConta }) => chamar<{ membro_id: string; enviado: boolean }>({ acao: "admin_convidar", ...p }),
  sincronizar: (contaId: string) => chamar<{ valor: number }>({ acao: "admin_sincronizar", conta_id: contaId }),
  cobrarMigracao: (contaId: string, valor?: number) => chamar<{ link: string | null; valor: number }>({ acao: "admin_cobrar_migracao", conta_id: contaId, valor }),
  async salvarConta(id: string, dados: Record<string, unknown>): Promise<void> {
    const { error } = await db.from("produto_contas").update({ ...dados, atualizado_em: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  },
  async salvarPlano(plano: Partial<PlanoDoProduto> & { id: string }): Promise<void> {
    const { error } = await db.from("produto_planos").upsert({ ...plano, atualizado_em: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw error;
  },
  async salvarConfig(dados: Partial<ConfigDoProduto>): Promise<void> {
    const { error } = await db.from("produto_config").update({ ...dados, atualizado_em: new Date().toISOString() }).eq("id", true);
    if (error) throw error;
  },
  async salvarDominio(dominio: Partial<DominioDeEmail> & { conta_id: string; dominio: string }): Promise<string> {
    const { checagem: _fora, checado_em: _fora2, ...resto } = dominio as DominioDeEmail;
    const linha = { ...resto, dominio: resto.dominio.trim().toLowerCase(), atualizado_em: new Date().toISOString() };
    const q = resto.id ? db.from("produto_email_dominios").update(linha).eq("id", resto.id).select("id").single() : db.from("produto_email_dominios").insert(linha).select("id").single();
    const { data, error } = await q;
    if (error) throw error;
    return String(data.id);
  },
  async salvarCaixa(caixa: Partial<CaixaDeEmail> & { dominio_id: string; conta_id: string; endereco: string }): Promise<void> {
    const linha = { ...caixa, endereco: caixa.endereco.trim().toLowerCase(), atualizado_em: new Date().toISOString() };
    const q = caixa.id ? db.from("produto_email_caixas").update(linha).eq("id", caixa.id) : db.from("produto_email_caixas").insert(linha);
    const { error } = await q;
    if (error) throw error;
  },
  async marcarEtapa(id: string, feita: boolean, nota?: string): Promise<void> {
    const { data } = await supabase.auth.getUser();
    const { error } = await db.from("produto_email_etapas").update({ feito_em: feita ? new Date().toISOString() : null, feito_por: feita && data && data.user ? data.user.id : null, ...(nota === undefined ? {} : { nota }) }).eq("id", id);
    if (error) throw error;
  },
  async lancarCusto(custo: { conta_id?: string | null; competencia: string; tipo: string; valor: number; descricao: string }): Promise<void> {
    const { error } = await db.from("produto_custos").insert({ ...custo, conta_id: custo.conta_id || null });
    if (error) throw error;
  },
  async listarCustos(mes: string): Promise<Array<{ id: string; conta_id: string | null; tipo: string; valor: number; descricao: string; estimado: boolean; criado_em: string }>> {
    const { data, error } = await db.from("produto_custos").select("id, conta_id, tipo, valor, descricao, estimado, criado_em").eq("competencia", mes).order("criado_em", { ascending: false }).limit(200);
    if (error) throw error;
    return lista<any>(data).map((c) => ({ ...c, valor: numero(c.valor) }));
  },
  async apagarCusto(id: string): Promise<void> {
    const { error } = await db.from("produto_custos").delete().eq("id", id);
    if (error) throw error;
  },
};

// ------------------------------------------------------------------ contas puras (testadas)

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "13/11" ou "13/11/2026" a partir de uma data do banco, no fuso de São Paulo. */
export function diaLegivel(iso: string | null | undefined, comAno = false): string {
  if (!iso) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00-03:00` : iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", ...(comAno ? { year: "numeric" } : {}) });
}

/** Dias inteiros que faltam até a data (0 quando é hoje ou já passou). */
export function diasAte(iso: string | null | undefined, agora = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : Math.max(0, Math.ceil((t - agora) / 86400000));
}

/**
 * A mensalidade de uma escolha, com as mesmas regras do banco
 * (produto_itens_da_conta): CRM por usuário, e o e-mail quando contratado.
 */
export function mensalidadePrevista(p: { plano: Pick<PlanoDoProduto, "nome" | "preco_usuario" | "email_caixas_incluidas">; usuarios: number; crm?: boolean; email?: boolean; caixas?: number; config?: Pick<ConfigDoProduto, "email_mensal" | "email_caixas_no_mensal" | "email_caixa_extra"> | null }): { itens: ItemDaMensalidade[]; total: number } {
  const itens: ItemDaMensalidade[] = [];
  const dinheiro = (v: number) => Math.round(v * 100) / 100;
  if (p.crm !== false && p.usuarios > 0) {
    itens.push({ chave: "crm", nome: `CRM ${p.plano.nome}`, quantidade: p.usuarios, unitario: p.plano.preco_usuario, total: dinheiro(p.usuarios * p.plano.preco_usuario) });
  }
  if (p.email && p.config) {
    const inclusas = p.plano.email_caixas_incluidas > 0 ? p.plano.email_caixas_incluidas : 0;
    if (inclusas === 0 && p.config.email_mensal > 0) itens.push({ chave: "email", nome: "E-mail profissional", quantidade: 1, unitario: p.config.email_mensal, total: dinheiro(p.config.email_mensal) });
    const extras = Math.max(0, (p.caixas || 0) - (inclusas > 0 ? inclusas : p.config.email_caixas_no_mensal));
    if (extras > 0 && p.config.email_caixa_extra > 0) itens.push({ chave: "email_caixa_extra", nome: "Caixa de e-mail adicional", quantidade: extras, unitario: p.config.email_caixa_extra, total: dinheiro(extras * p.config.email_caixa_extra) });
  }
  return { itens, total: dinheiro(itens.reduce((s, i) => s + i.total, 0)) };
}

export const ROTULO_DO_ESTADO: Record<EstadoDaConta, string> = {
  teste: "Em teste",
  ativa: "Ativa",
  atrasada: "Pagamento atrasado",
  suspensa: "Suspensa",
  cancelada: "Cancelada",
  cortesia: "Cortesia",
};

/** A frase de situação da conta, para o topo do produto. Nulo quando está tudo em dia. */
export function avisoDaConta(e: EstadoDoProduto, agora = Date.now()): { tom: "info" | "alerta" | "perigo"; texto: string; acao: string | null } | null {
  const c = e.conta;
  if (!c) return null;
  const admin = !!e.eu && e.eu.papel === "admin";
  if (c.estado === "teste") {
    const dias = diasAte(c.teste_ate, agora);
    if (!e.liberada) return { tom: "perigo", texto: "O período de teste terminou.", acao: admin ? "Assinar" : null };
    return { tom: dias <= 2 ? "alerta" : "info", texto: dias <= 1 ? "O teste termina hoje." : `Faltam ${dias} dias de teste.`, acao: admin ? "Assinar" : null };
  }
  if (c.estado === "atrasada") {
    return e.liberada
      ? { tom: "alerta", texto: "A mensalidade venceu. O acesso continua por poucos dias.", acao: admin ? "Regularizar" : null }
      : { tom: "perigo", texto: "O acesso foi pausado por falta de pagamento.", acao: admin ? "Regularizar" : null };
  }
  if (c.estado === "suspensa") return { tom: "perigo", texto: "O acesso da empresa está suspenso.", acao: null };
  if (c.estado === "cancelada") {
    return e.liberada
      ? { tom: "alerta", texto: `Assinatura cancelada. O acesso vai até ${diaLegivel(c.acesso_ate)}.`, acao: admin ? "Voltar a assinar" : null }
      : { tom: "perigo", texto: "A assinatura foi cancelada.", acao: admin ? "Voltar a assinar" : null };
  }
  return null;
}
