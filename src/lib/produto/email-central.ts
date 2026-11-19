import { supabase } from "@/integrations/supabase/client";
import { ErroDoProduto } from "./api";

/**
 * Central de e-mail (18/11/2026): a saúde do e-mail de cada cliente numa leitura só, e o correio
 * (cada pessoa com a própria caixa, o master com todas). Contrato do banco:
 * supabase/migrations/20261118200000_produto_email_central_e_correio.sql. A nota de saúde é calculada
 * aqui, em regra pura, para ter teste e para a tela e o agente lerem a mesma coisa.
 */

const db = supabase as unknown as {
  rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { message: string; code?: string } | null }>;
};

export interface DominioNaCentral {
  id: string;
  dominio: string;
  provedor: string;
  estado: string;
  dns_pronto: boolean | null;
  dns_faltas: number;
  checado_em: string | null;
  zoho_plano: string | null;
  zoho_conectado: boolean;
  cloudflare: boolean;
  dominio_vence_em: string | null;
  provedor_vence_em: string | null;
  provedor_custo_mensal: number | null;
  correio_provedor: "nenhum" | "zoho" | "migadu" | "imap";
  correio_ligado: boolean;
  etapas_feitas: number;
  etapas_total: number;
}

export interface ClienteNaCentral {
  conta_id: string;
  empresa: string;
  estado_da_conta: string;
  client_id: string | null;
  email_ativo: boolean;
  liberado: boolean;
  caixas_contratadas: number;
  caixas: number;
  apelidos: number;
  caixas_pedidas: number;
  caixas_sem_dono: number;
  dominios: DominioNaCentral[];
  pedido: { id: string; estado: string; tipo: string; pago_em: string | null; criado_em: string; valor_mensal: number; extra_id: string | null } | null;
  cobranca: { por: "extra"; mensal: number; proximo_vencimento: string | null; em_atraso: number } | null;
  assinatura: { estado: string; proximo_vencimento: string | null; valor_mensal: number } | null;
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export function lerCliente(x: any): ClienteNaCentral {
  return {
    ...x,
    caixas_contratadas: n(x.caixas_contratadas),
    caixas: n(x.caixas),
    apelidos: n(x.apelidos),
    caixas_pedidas: n(x.caixas_pedidas),
    caixas_sem_dono: n(x.caixas_sem_dono),
    dominios: (Array.isArray(x.dominios) ? x.dominios : []).map((d: any) => ({
      ...d,
      dns_faltas: n(d.dns_faltas),
      etapas_feitas: n(d.etapas_feitas),
      etapas_total: n(d.etapas_total),
      provedor_custo_mensal: d.provedor_custo_mensal == null ? null : n(d.provedor_custo_mensal),
    })),
    pedido: x.pedido ? { ...x.pedido, valor_mensal: n(x.pedido.valor_mensal) } : null,
    cobranca: x.cobranca ? { ...x.cobranca, mensal: n(x.cobranca.mensal), em_atraso: n(x.cobranca.em_atraso) } : null,
    assinatura: x.assinatura ? { ...x.assinatura, valor_mensal: n(x.assinatura.valor_mensal) } : null,
  } as ClienteNaCentral;
}

export async function carregarCentral(): Promise<ClienteNaCentral[]> {
  const { data, error } = await db.rpc("produto_email_central");
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(lerCliente);
}

// ------------------------------------------------------------------ saúde

export type Gravidade = "critico" | "atencao" | "info";
export interface Aviso {
  gravidade: Gravidade;
  texto: string;
}
export type Saude = "saudavel" | "atencao" | "critico" | "migrando" | "aguardando";

export const ROTULO_DA_SAUDE: Record<Saude, string> = { saudavel: "Saudável", atencao: "Atenção", critico: "Crítico", migrando: "Migrando", aguardando: "Aguardando pagamento" };

/** Dias inteiros de hoje até a data (negativo = já passou). Datas "AAAA-MM-DD", sem fuso. */
export function diasAteODia(dia: string | null | undefined, hoje: string): number | null {
  if (!dia || !/^\d{4}-\d{2}-\d{2}/.test(dia)) return null;
  const [a, m, d] = dia.slice(0, 10).split("-").map(Number);
  const [ha, hm, hd] = hoje.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86400000);
}

const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;

function avisoDeVencimento(oQue: string, dia: string | null, hoje: string, janela: number): Aviso | null {
  const dias = diasAteODia(dia, hoje);
  if (dias === null) return null;
  if (dias < 0) return { gravidade: "critico", texto: `${oQue} venceu há ${plural(-dias, "dia", "dias")}.` };
  if (dias <= 7) return { gravidade: "critico", texto: dias === 0 ? `${oQue} vence hoje.` : `${oQue} vence em ${plural(dias, "dia", "dias")}.` };
  if (dias <= janela) return { gravidade: "atencao", texto: `${oQue} vence em ${dias} dias.` };
  return null;
}

/**
 * A saúde do e-mail de um cliente: os avisos, do mais grave para o mais leve, e o estado geral.
 * Regras (todas com teste): pagamento, vencimentos (domínio e plano do provedor), DNS, limite de
 * caixas do plano gratuito, pedidos de caixa parados e conferência velha.
 */
export function saudeDoCliente(c: ClienteNaCentral, hoje: string): { estado: Saude; avisos: Aviso[] } {
  const avisos: Aviso[] = [];
  const pedidoAberto = c.pedido && (c.pedido.estado === "novo" || c.pedido.estado === "aguardando_pagamento");
  const migrando = c.dominios.some((d) => d.estado !== "concluido" && d.estado !== "pausado") && c.dominios.length > 0;

  if (c.cobranca && c.cobranca.em_atraso > 0) avisos.push({ gravidade: "critico", texto: `${plural(c.cobranca.em_atraso, "cobrança em atraso", "cobranças em atraso")} no extra de e-mail.` });
  if (c.assinatura && c.assinatura.estado === "atrasada") avisos.push({ gravidade: "critico", texto: "Assinatura em atraso." });
  if (c.email_ativo && !c.liberado) avisos.push({ gravidade: "critico", texto: "E-mail contratado, mas o acesso do cliente está fechado." });

  for (const d of c.dominios) {
    const a1 = avisoDeVencimento(`O registro de ${d.dominio}`, d.dominio_vence_em, hoje, 45);
    if (a1) avisos.push(a1);
    const a2 = avisoDeVencimento(`O plano de e-mail de ${d.dominio}`, d.provedor_vence_em, hoje, 30);
    if (a2) avisos.push(a2);
    const noAr = d.estado === "concluido" || d.estado === "virada";
    if (noAr && d.dns_pronto === false) avisos.push({ gravidade: d.dns_faltas > 0 ? "critico" : "atencao", texto: `DNS de ${d.dominio} com ${d.dns_faltas > 0 ? plural(d.dns_faltas, "item faltando", "itens faltando") : "pontos de atenção"}.` });
    if (noAr && d.dns_pronto === null) avisos.push({ gravidade: "atencao", texto: `DNS de ${d.dominio} nunca foi conferido.` });
    const idade = d.checado_em ? diasAteODia(d.checado_em.slice(0, 10), hoje) : null;
    if (noAr && d.dns_pronto !== null && idade !== null && idade < -30) avisos.push({ gravidade: "info", texto: `Última conferência do DNS de ${d.dominio} há ${-idade} dias.` });
    if (noAr && !d.dominio_vence_em) avisos.push({ gravidade: "info", texto: `Falta anotar quando vence o registro de ${d.dominio}.` });
  }

  const gratuito = c.dominios.some((d) => d.provedor === "zoho" && (!d.zoho_plano || d.zoho_plano === "gratuito"));
  if (gratuito && c.caixas > 5) avisos.push({ gravidade: "critico", texto: `${c.caixas} caixas no Zoho gratuito, que aceita 5. As excedentes têm que virar apelido ou plano pago.` });
  else if (gratuito && c.caixas === 5) avisos.push({ gravidade: "info", texto: "Zoho gratuito no limite de 5 caixas. A próxima pessoa entra como apelido." });
  if (c.caixas_contratadas > 0 && c.caixas > c.caixas_contratadas) avisos.push({ gravidade: "atencao", texto: `${c.caixas} caixas em uso e ${c.caixas_contratadas} contratadas: ajuste a cobrança.` });
  if (c.caixas_pedidas > 0) avisos.push({ gravidade: "atencao", texto: `${plural(c.caixas_pedidas, "caixa pedida", "caixas pedidas")} pelo cliente esperando.` });

  const ordem: Record<Gravidade, number> = { critico: 0, atencao: 1, info: 2 };
  avisos.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
  const estado: Saude = avisos.some((a) => a.gravidade === "critico")
    ? "critico"
    : pedidoAberto
      ? "aguardando"
      : migrando
        ? "migrando"
        : avisos.some((a) => a.gravidade === "atencao")
          ? "atencao"
          : "saudavel";
  return { estado, avisos };
}

/** O próximo vencimento do cliente (o mais perto entre cobrança, domínio e plano do provedor). */
export function proximoVencimento(c: ClienteNaCentral): { dia: string; oQue: string } | null {
  const lista: Array<{ dia: string; oQue: string }> = [];
  if (c.cobranca && c.cobranca.proximo_vencimento) lista.push({ dia: c.cobranca.proximo_vencimento, oQue: "Mensalidade" });
  else if (c.assinatura && c.assinatura.proximo_vencimento && c.assinatura.estado !== "sem") lista.push({ dia: c.assinatura.proximo_vencimento, oQue: "Assinatura" });
  for (const d of c.dominios) {
    if (d.dominio_vence_em) lista.push({ dia: d.dominio_vence_em, oQue: "Domínio" });
    if (d.provedor_vence_em) lista.push({ dia: d.provedor_vence_em, oQue: "Plano de e-mail" });
  }
  lista.sort((a, b) => a.dia.localeCompare(b.dia));
  return lista[0] || null;
}

/** Os números do topo da central. */
export function resumoDaCentral(clientes: ClienteNaCentral[], hoje: string) {
  let caixas = 0;
  let receita = 0;
  let custo = 0;
  const por: Record<Saude, number> = { saudavel: 0, atencao: 0, critico: 0, migrando: 0, aguardando: 0 };
  let vencendo = 0;
  for (const c of clientes) {
    caixas += c.caixas;
    receita += c.cobranca ? c.cobranca.mensal : c.pedido && c.pedido.pago_em ? c.pedido.valor_mensal : 0;
    for (const d of c.dominios) custo += d.provedor_custo_mensal || 0;
    por[saudeDoCliente(c, hoje).estado] += 1;
    const v = proximoVencimento(c);
    const dias = v ? diasAteODia(v.dia, hoje) : null;
    if (dias !== null && dias <= 30) vencendo += 1;
  }
  const dinheiro = (v: number) => Math.round(v * 100) / 100;
  return { clientes: clientes.length, caixas, receita: dinheiro(receita), custo: dinheiro(custo), margem: dinheiro(receita - custo), por, vencendo };
}

// ------------------------------------------------------------------ correio

export interface CaixaDoCorreio {
  id: string;
  endereco: string;
  pessoa: string;
  minha: boolean;
  dono: string | null;
  dominio: string;
  provedor: string;
  ligado: boolean;
}

export interface MinhasCaixas {
  conta: { id: string; nome: string } | null;
  master: boolean;
  liberado: boolean;
  caixas: CaixaDoCorreio[];
}

export async function carregarMinhasCaixas(): Promise<MinhasCaixas> {
  const { data, error } = await db.rpc("produto_email_minhas_caixas");
  if (error) throw error;
  const d = data || {};
  return { conta: d.conta || null, master: d.master === true, liberado: d.liberado === true, caixas: Array.isArray(d.caixas) ? d.caixas : [] };
}

export interface ResumoDaMensagem {
  id: string;
  mensagem_id?: string | null;
  de: string;
  para: string;
  assunto: string;
  resumo: string;
  recebida_em: string | null;
  lida: boolean;
  tem_anexo: boolean;
}
export interface MensagemAberta extends ResumoDaMensagem {
  texto: string;
  anexos: Array<{ nome: string; tamanho: number }>;
}

/**
 * Minha caixa (19/11/2026): a casa entra numa caixa com a senha dela para ver o correio como o cliente
 * vê. A senha fica só na memória desta aba (nunca em armazenamento, nunca em log), vai junto de cada
 * pedido para a função produto-correio e some ao sair da caixa ou recarregar a página.
 */
const senhasDaCasa: Record<string, string> = {};
export const abertaPelaCasa = (caixaId: string) => Object.prototype.hasOwnProperty.call(senhasDaCasa, caixaId);
export async function entrarPelaCasa(caixaId: string, senha: string): Promise<{ endereco: string }> {
  const r = await chamarCorreio<{ ok: boolean; endereco: string }>({ acao: "entrar_pela_casa", caixa_id: caixaId, senha_da_casa: senha });
  senhasDaCasa[caixaId] = senha;
  return { endereco: r.endereco };
}
export function sairPelaCasa(caixaId?: string): void {
  Object.keys(senhasDaCasa).forEach((id) => {
    if (!caixaId || id === caixaId) delete senhasDaCasa[id];
  });
}

async function chamarCorreio<T>(pedido: Record<string, unknown>): Promise<T> {
  const id = typeof pedido.caixa_id === "string" ? pedido.caixa_id : "";
  const corpo = id && abertaPelaCasa(id) && !pedido.senha_da_casa ? { ...pedido, senha_da_casa: senhasDaCasa[id] } : pedido;
  const { data, error } = await supabase.functions.invoke("produto-correio", { body: corpo });
  if (error) {
    let resposta: { error?: string; mensagem?: string } | null = null;
    try {
      const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context;
      resposta = ctx && typeof ctx.clone === "function" ? ((await ctx.clone().json()) as { error?: string; mensagem?: string }) : null;
    } catch {
      resposta = null;
    }
    if (resposta && resposta.mensagem) throw new ErroDoProduto(String(resposta.error || "erro"), resposta.mensagem);
    throw new ErroDoProduto("correio_desligado", "O correio ainda não foi ligado.");
  }
  return data as T;
}

export const correio = {
  pastas: (caixaId: string) => chamarCorreio<{ pastas: Array<{ id: string; nome: string; nao_lidas: number }> }>({ acao: "pastas", caixa_id: caixaId }).then((r) => r.pastas),
  listar: (caixaId: string, pasta: string, busca?: string, pagina = 1) => chamarCorreio<{ mensagens: ResumoDaMensagem[] }>({ acao: "listar", caixa_id: caixaId, pasta, busca, pagina }).then((r) => r.mensagens),
  ler: (caixaId: string, pasta: string, id: string) => chamarCorreio<{ mensagem: MensagemAberta }>({ acao: "ler", caixa_id: caixaId, pasta, id }).then((r) => r.mensagem),
  enviar: (caixaId: string, envio: { para: string; assunto: string; texto: string; em_resposta_a?: string | null }) => chamarCorreio<{ id: string }>({ acao: "enviar", caixa_id: caixaId, ...envio }),
  guardarSegredo: (caixaId: string, segredo: string) => chamarCorreio<{ guardado: boolean }>({ acao: "guardar_segredo", caixa_id: caixaId, segredo }).then((r) => r.guardado),
};

export const correioDesligado = (e: unknown) => e instanceof ErroDoProduto && e.codigo === "correio_desligado";

/** A senha foi confirmada nesta sessão do navegador? O correio pede de novo ao abrir. */
const CHAVE_DA_PORTA = "aceleriq:correio:porta";
export function portaAberta(usuarioId: string, agora = Date.now()): boolean {
  try {
    const bruto = JSON.parse(sessionStorage.getItem(CHAVE_DA_PORTA) || "null");
    return !!bruto && bruto.u === usuarioId && typeof bruto.ate === "number" && bruto.ate > agora;
  } catch {
    return false;
  }
}
export function abrirPorta(usuarioId: string, agora = Date.now()): void {
  try {
    sessionStorage.setItem(CHAVE_DA_PORTA, JSON.stringify({ u: usuarioId, ate: agora + 8 * 3600 * 1000 }));
  } catch {
    /* sem armazenamento: vale só nesta tela */
  }
}
