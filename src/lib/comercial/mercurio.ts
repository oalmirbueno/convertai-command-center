import { supabase } from "@/integrations/supabase/client";

/**
 * O comercial com o Mercúrio (25/10/2026). Contrato do banco:
 * supabase/migrations/20261025130000_comercial_mercurio_e_maquina_de_leads.sql.
 *
 * - Caixa do comercial (commercial_handoffs): o Mercúrio avisa só quem avançou ou fechou, com o resumo, o
 *   próximo passo, o telefone e os dados. A equipe assume e conclui.
 * - Conversa do lead (commercial_lead_messages): o que entrou e saiu, de quem e quando.
 * - Fatos com prova (commercial_facts): o que tem prova forte já está gravado; a sugestão espera a equipe.
 * - Mercúrio no lead (agente_slug) e na campanha (mercurio_ativo e as campanhas da Meta ligadas).
 * Grava direto pelo supabase; o RLS deixa só admin e manager. Sem lookbehind, sem classe Unicode.
 */

export const SLUG_DO_MERCURIO = "mercurio";

const db = supabase as unknown as { from: (t: string) => any; auth: typeof supabase.auth };

export class ErroDoComercial extends Error {
  constructor(oQue: string, causa?: unknown) {
    super(oQue);
    this.name = "ErroDoComercial";
    (this as unknown as { causa?: unknown }).causa = causa;
  }
}

async function eu(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return (data && data.user && data.user.id) || null;
  } catch {
    return null;
  }
}

/* ─────────────────────────── WhatsApp e telefone ─────────────────────────── */

/** Só os dígitos, com o DDI 55 quando o número é brasileiro sem DDI (10 ou 11 dígitos). Vazio sem número. */
export function numeroParaWhatsapp(telefone: string | null | undefined): string {
  let d = String(telefone || "").replace(/\D+/g, "");
  if (d.indexOf("00") === 0) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : "";
}

/** O link do WhatsApp com uma mensagem curta de continuidade (vazio sem número válido). */
export function linkDoWhatsapp(telefone: string | null | undefined, mensagem?: string): string {
  const n = numeroParaWhatsapp(telefone);
  if (!n) return "";
  return `https://wa.me/${n}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ""}`;
}

/** O link de ligar (tel:) com o número limpo. */
export function linkDeLigar(telefone: string | null | undefined): string {
  const n = numeroParaWhatsapp(telefone);
  return n ? `tel:+${n}` : "";
}

/** A primeira mensagem de quem continua a conversa que o Mercúrio começou. */
export function mensagemDeContinuidade(nome: string | null | undefined): string {
  const primeiro = String(nome || "").trim().split(/\s+/)[0] || "";
  return `Oi${primeiro ? `, ${primeiro}` : ""}! Aqui é da Aceleriq, dando sequência à nossa conversa.`;
}

/* ─────────────────────────────── Caixa ────────────────────────────────── */

export type TipoDaCaixa = "avancou" | "fechou";
export type SituacaoDaCaixa = "nova" | "assumida" | "concluida";

export interface ItemDaCaixa {
  id: string;
  lead_id: string;
  tipo: TipoDaCaixa;
  resumo: string;
  proximo_passo: string | null;
  telefone: string | null;
  dados: Record<string, unknown>;
  operador_slug: string;
  situacao: SituacaoDaCaixa;
  assumida_por: string | null;
  assumida_em: string | null;
  concluida_em: string | null;
  created_at: string;
  lead: { id: string; name: string; company: string | null; whatsapp: string | null; stage: string } | null;
}

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function normalizarItemDaCaixa(linha: Record<string, unknown>): ItemDaCaixa {
  const lead = objeto(linha.lead);
  return {
    id: String(linha.id),
    lead_id: String(linha.lead_id),
    tipo: linha.tipo === "fechou" ? "fechou" : "avancou",
    resumo: String(linha.resumo || ""),
    proximo_passo: typeof linha.proximo_passo === "string" && linha.proximo_passo ? linha.proximo_passo : null,
    telefone: typeof linha.telefone === "string" && linha.telefone ? linha.telefone : null,
    dados: objeto(linha.dados),
    operador_slug: String(linha.operador_slug || SLUG_DO_MERCURIO),
    situacao: linha.situacao === "assumida" || linha.situacao === "concluida" ? linha.situacao : "nova",
    assumida_por: (linha.assumida_por as string) || null,
    assumida_em: (linha.assumida_em as string) || null,
    concluida_em: (linha.concluida_em as string) || null,
    created_at: String(linha.created_at || ""),
    lead: lead.id
      ? { id: String(lead.id), name: String(lead.name || "Lead"), company: (lead.company as string) || null, whatsapp: (lead.whatsapp as string) || null, stage: String(lead.stage || "") }
      : null,
  };
}

export async function listarCaixa(): Promise<ItemDaCaixa[]> {
  const { data, error } = await db
    .from("commercial_handoffs")
    .select("*, lead:commercial_leads(id, name, company, whatsapp, stage)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new ErroDoComercial("Não foi possível ler a Caixa do comercial.", error);
  return ((data || []) as Array<Record<string, unknown>>).map(normalizarItemDaCaixa);
}

export async function mudarSituacaoDaCaixa(id: string, situacao: SituacaoDaCaixa): Promise<void> {
  const agora = new Date().toISOString();
  const corpo: Record<string, unknown> = { situacao };
  if (situacao === "assumida") {
    corpo.assumida_por = await eu();
    corpo.assumida_em = agora;
    corpo.concluida_em = null;
  } else if (situacao === "concluida") {
    corpo.concluida_em = agora;
  } else {
    corpo.assumida_por = null;
    corpo.assumida_em = null;
    corpo.concluida_em = null;
  }
  const { error } = await db.from("commercial_handoffs").update(corpo).eq("id", id);
  if (error) throw new ErroDoComercial("Não foi possível mudar o item da Caixa.", error);
}

/* ─────────────────── Mercúrio até o contrato (MCP 2.23, 28/10/2026) ─────────────────── */

/** O pedido do Aceleriq de Bolso que este item da Caixa carrega (o Mercúrio registrou), ou null. */
export function pedidoDoBolsoNaCaixa(dados: Record<string, unknown> | null | undefined): string | null {
  const id = dados ? dados.bolso_pedido_id : null;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** O caminho da Mesa Proposta que o pedido de proposta deixou na Caixa, ou null. */
export function linkDaPropostaNaCaixa(dados: Record<string, unknown> | null | undefined): string | null {
  const link = dados ? dados.link : null;
  return typeof link === "string" && link.indexOf("/mesa-proposta?") === 0 ? link : null;
}

export type LiberacaoDoBolso = { liberado: boolean; ja_liberado?: boolean; motivo?: string; email?: string };

/**
 * A administração confirma que viu o dinheiro do Aceleriq de Bolso (extrato, Pix ou gateway) e o acesso é
 * liberado na hora quando a conta já existe. Comprovante em imagem não vale: a nota diz onde foi conferido.
 */
export async function confirmarPagamentoDoBolso(pedidoId: string, nota: string): Promise<LiberacaoDoBolso> {
  const { data, error } = await (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> })
    .rpc("comercial_bolso_confirmar_pagamento", { _pedido: pedidoId, _nota: nota });
  if (error) throw new ErroDoComercial((error as { message?: string }).message || "Não foi possível confirmar o pagamento.", error);
  return (data || { liberado: false }) as LiberacaoDoBolso;
}

/** "valor_mensal" -> "Valor mensal"; valores de lista e objeto viram texto curto. */
export function dadosLegiveis(dados: Record<string, unknown>): Array<{ chave: string; valor: string }> {
  const saida: Array<{ chave: string; valor: string }> = [];
  for (const k of Object.keys(dados)) {
    const v = dados[k];
    if (v === null || v === undefined || v === "") continue;
    let valor: string;
    if (Array.isArray(v)) valor = v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
    else if (typeof v === "object") valor = Object.keys(v as Record<string, unknown>).map((c) => `${c}: ${String((v as Record<string, unknown>)[c])}`).join(", ");
    else if (typeof v === "boolean") valor = v ? "sim" : "não";
    else valor = String(v);
    const chave = k.replace(/[_-]+/g, " ").trim();
    saida.push({ chave: chave.charAt(0).toUpperCase() + chave.slice(1), valor: valor.slice(0, 400) });
  }
  return saida;
}

/* ─────────────────────────────── Conversa ─────────────────────────────── */

export interface MensagemDoLead {
  id: string;
  lead_id: string;
  direcao: "entrada" | "saida";
  canal: string;
  texto: string;
  enviada_em: string;
  operador_slug: string | null;
  autor_id: string | null;
}

export const CANAIS_DA_CONVERSA = ["whatsapp", "instagram", "email", "telefone", "site", "outro"] as const;

export async function listarMensagens(leadId: string): Promise<MensagemDoLead[]> {
  const { data, error } = await db
    .from("commercial_lead_messages")
    .select("id, lead_id, direcao, canal, texto, enviada_em, operador_slug, autor_id")
    .eq("lead_id", leadId)
    .order("enviada_em", { ascending: true })
    .limit(500);
  if (error) throw new ErroDoComercial("Não foi possível ler a conversa.", error);
  return (data || []) as MensagemDoLead[];
}

export async function registrarMensagem(p: { leadId: string; direcao: "entrada" | "saida"; canal: string; texto: string }): Promise<void> {
  const texto = p.texto.trim();
  if (!texto) throw new ErroDoComercial("Escreva a mensagem.");
  const autor = p.direcao === "saida" ? await eu() : null;
  const canal = (CANAIS_DA_CONVERSA as readonly string[]).indexOf(p.canal) >= 0 ? p.canal : "whatsapp";
  const { error } = await db.from("commercial_lead_messages").insert({ lead_id: p.leadId, direcao: p.direcao, canal, texto: texto.slice(0, 8000), autor_id: autor });
  if (error) throw new ErroDoComercial("Não foi possível registrar a mensagem.", error);
}

/* ─────────────────────────────── Fatos ────────────────────────────────── */

export interface FatoDoLead {
  id: string;
  lead_id: string | null;
  organization_id: string | null;
  campo: string;
  valor: string;
  evidencia: string;
  detalhe: string | null;
  fonte_url: string | null;
  situacao: "gravado" | "sugestao" | "descartado";
  operador_slug: string | null;
  created_at: string;
}

export async function listarFatos(leadId: string, organizationId: string | null): Promise<FatoDoLead[]> {
  let q = db.from("commercial_facts").select("*");
  q = organizationId ? q.or(`lead_id.eq.${leadId},organization_id.eq.${organizationId}`) : q.eq("lead_id", leadId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) throw new ErroDoComercial("Não foi possível ler o que o agente levantou.", error);
  return (data || []) as FatoDoLead[];
}

/** Onde cada campo do fato mora: no lead, na ficha da empresa ou na qualificação do lead. */
const CAMPOS_DO_LEAD = ["whatsapp", "email", "company", "name"];
const CAMPOS_DA_EMPRESA = ["instagram", "phone", "address", "cnpj", "size", "site", "city", "segment"];

export type DestinoDoFato = { tabela: "commercial_leads"; coluna: string } | { tabela: "commercial_organizations"; coluna: string } | { tabela: "qualificacao"; chave: string } | null;

export function destinoDoFato(campo: string): DestinoDoFato {
  const c = String(campo || "").trim();
  if (CAMPOS_DO_LEAD.indexOf(c) >= 0) return { tabela: "commercial_leads", coluna: c };
  if (CAMPOS_DA_EMPRESA.indexOf(c) >= 0) return { tabela: "commercial_organizations", coluna: c };
  if (c.indexOf("qualificacao.") === 0 && c.length > "qualificacao.".length) return { tabela: "qualificacao", chave: c.slice("qualificacao.".length) };
  return null;
}

const ROTULO_DO_CAMPO: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
  company: "Empresa",
  name: "Nome",
  instagram: "Instagram",
  phone: "Telefone",
  address: "Endereço",
  cnpj: "CNPJ",
  size: "Porte",
  site: "Site",
  city: "Cidade",
  segment: "Ramo",
};

export function rotuloDoCampoDoFato(campo: string): string {
  if (ROTULO_DO_CAMPO[campo]) return ROTULO_DO_CAMPO[campo];
  const limpo = campo.replace(/^qualificacao\./, "").replace(/[_-]+/g, " ");
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/** Confirmar a sugestão: grava o valor no campo do lead, da empresa ou da qualificação e marca o fato. */
export async function confirmarFato(fato: FatoDoLead, leadId: string): Promise<void> {
  const destino = destinoDoFato(fato.campo);
  if (destino && destino.tabela === "commercial_leads") {
    const { error } = await db.from("commercial_leads").update({ [destino.coluna]: fato.valor }).eq("id", leadId);
    if (error) throw new ErroDoComercial("Não foi possível gravar no lead.", error);
  } else if (destino && destino.tabela === "commercial_organizations") {
    let org = fato.organization_id;
    if (!org) {
      const { data } = await db.from("commercial_leads").select("organization_id").eq("id", leadId).maybeSingle();
      org = (data && (data as { organization_id?: string | null }).organization_id) || null;
    }
    if (!org) throw new ErroDoComercial("Este lead ainda não tem a ficha da empresa. Preencha a Empresa no lead.");
    const { error } = await db.from("commercial_organizations").update({ [destino.coluna]: fato.valor }).eq("id", org);
    if (error) throw new ErroDoComercial("Não foi possível gravar na empresa.", error);
  } else if (destino && destino.tabela === "qualificacao") {
    const { data, error: erroLer } = await db.from("commercial_leads").select("qualificacao").eq("id", leadId).maybeSingle();
    if (erroLer) throw new ErroDoComercial("Não foi possível ler a qualificação.", erroLer);
    const atual = objeto(data && (data as { qualificacao?: unknown }).qualificacao);
    const { error } = await db.from("commercial_leads").update({ qualificacao: { ...atual, [destino.chave]: fato.valor } }).eq("id", leadId);
    if (error) throw new ErroDoComercial("Não foi possível gravar na qualificação.", error);
  }
  await decidirFato(fato.id, "gravado");
}

export async function decidirFato(id: string, situacao: "gravado" | "descartado"): Promise<void> {
  const { error } = await db.from("commercial_facts").update({ situacao, decidido_por: await eu(), decidido_em: new Date().toISOString() }).eq("id", id);
  if (error) throw new ErroDoComercial("Não foi possível decidir a sugestão.", error);
}

/* ──────────────────────────── Mercúrio no lead ────────────────────────── */

export async function mercurioNoLead(leadId: string, atende: boolean): Promise<void> {
  const { error } = await db.from("commercial_leads").update({ agente_slug: atende ? SLUG_DO_MERCURIO : null }).eq("id", leadId);
  if (error) throw new ErroDoComercial("Não foi possível mudar quem atende o lead.", error);
}

export interface EventoDoAgente {
  id: string;
  note: string | null;
  created_at: string;
}

export async function historiaDoAgente(leadId: string): Promise<EventoDoAgente[]> {
  const { data, error } = await db
    .from("commercial_lead_events")
    .select("id, note, created_at")
    .eq("lead_id", leadId)
    .eq("kind", "agente")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new ErroDoComercial("Não foi possível ler a história do agente.", error);
  return (data || []) as EventoDoAgente[];
}

/** O lead como o editor recebe (com os campos novos, que a lista lê com select *). */
export interface LeadComAgente {
  agente_slug?: string | null;
  agente_desde?: string | null;
  ads_campaign_id?: string | null;
}

export const atendidoPeloMercurio = (lead: LeadComAgente | null | undefined) => !!lead && lead.agente_slug === SLUG_DO_MERCURIO;

/* ─────────────────────────── Configuração ─────────────────────────────── */

export interface ConfigDoAgente {
  slug: string;
  ativo: boolean;
  limite_primeiros_contatos_dia: number;
  horario_inicio: string;
  horario_fim: string;
  orientacoes: string | null;
}

export const CONFIG_PADRAO: ConfigDoAgente = { slug: SLUG_DO_MERCURIO, ativo: true, limite_primeiros_contatos_dia: 20, horario_inicio: "09:00", horario_fim: "18:00", orientacoes: null };

export async function lerConfigDoMercurio(): Promise<ConfigDoAgente> {
  const { data, error } = await db.from("commercial_agente_config").select("*").eq("slug", SLUG_DO_MERCURIO).maybeSingle();
  if (error) throw new ErroDoComercial("Não foi possível ler a configuração do Mercúrio.", error);
  if (!data) return CONFIG_PADRAO;
  const d = data as Record<string, unknown>;
  return {
    slug: SLUG_DO_MERCURIO,
    ativo: d.ativo !== false,
    limite_primeiros_contatos_dia: Number(d.limite_primeiros_contatos_dia) || 0,
    horario_inicio: String(d.horario_inicio || "09:00").slice(0, 5),
    horario_fim: String(d.horario_fim || "18:00").slice(0, 5),
    orientacoes: typeof d.orientacoes === "string" ? d.orientacoes : null,
  };
}

export async function salvarConfigDoMercurio(c: Omit<ConfigDoAgente, "slug">): Promise<void> {
  const limite = Math.max(0, Math.min(500, Math.round(Number(c.limite_primeiros_contatos_dia) || 0)));
  const { error } = await db.from("commercial_agente_config").upsert({
    slug: SLUG_DO_MERCURIO,
    ativo: !!c.ativo,
    limite_primeiros_contatos_dia: limite,
    horario_inicio: c.horario_inicio || "09:00",
    horario_fim: c.horario_fim || "18:00",
    orientacoes: (c.orientacoes || "").trim() || null,
    updated_at: new Date().toISOString(),
    updated_by: await eu(),
  });
  if (error) throw new ErroDoComercial("Não foi possível salvar a configuração do Mercúrio.", error);
}

/* ───────────────────────── Campanhas da Meta ──────────────────────────── */

export interface CampanhaDaMeta {
  campaign_id: string;
  nome: string;
  status: string;
  cliente: string;
}

export async function listarCampanhasDaMeta(): Promise<CampanhaDaMeta[]> {
  const { data, error } = await db
    .from("ads_campaigns")
    .select("campaign_id, name, effective_status, status, client_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new ErroDoComercial("Não foi possível ler as campanhas da Meta.", error);
  const linhas = (data || []) as Array<Record<string, unknown>>;
  const ids = Array.from(new Set(linhas.map((l) => String(l.client_id || "")).filter(Boolean)));
  const nomes: Record<string, string> = {};
  if (ids.length) {
    const { data: perfis } = await db.from("profiles").select("id, company_name, full_name").in("id", ids);
    for (const p of (perfis || []) as Array<Record<string, unknown>>) nomes[String(p.id)] = String(p.company_name || p.full_name || "Cliente");
  }
  const vistas: Record<string, true> = {};
  const saida: CampanhaDaMeta[] = [];
  for (const l of linhas) {
    const id = String(l.campaign_id || "");
    if (!id || vistas[id]) continue;
    vistas[id] = true;
    saida.push({ campaign_id: id, nome: String(l.name || id), status: String(l.effective_status || l.status || ""), cliente: nomes[String(l.client_id || "")] || "" });
  }
  return saida;
}

export const ROTULO_DO_STATUS_DA_META: Record<string, string> = {
  ACTIVE: "ativa",
  PAUSED: "pausada",
  CAMPAIGN_PAUSED: "pausada",
  ARCHIVED: "arquivada",
  DELETED: "apagada",
  IN_PROCESS: "em análise",
  WITH_ISSUES: "com problema",
};

export const rotuloDoStatusDaMeta = (s: string) => ROTULO_DO_STATUS_DA_META[String(s || "").toUpperCase()] || (s ? s.toLowerCase() : "");

/** As campanhas da Meta e a chave do Mercúrio de uma campanha da casa. */
export async function salvarMetaDaCampanha(campanhaId: string, p: { meta_campaign_ids: string[]; mercurio_ativo: boolean }): Promise<void> {
  const ids = Array.from(new Set(p.meta_campaign_ids.map((x) => String(x).trim()).filter(Boolean))).slice(0, 100);
  const { error } = await db.from("commercial_campaigns").update({ meta_campaign_ids: ids, mercurio_ativo: !!p.mercurio_ativo }).eq("id", campanhaId);
  if (error) throw new ErroDoComercial("Não foi possível ligar as campanhas da Meta.", error);
}

/** O nome da campanha da Meta do lead (vazio quando não acha). */
export async function nomeDaCampanhaDaMeta(campaignId: string): Promise<string> {
  const { data } = await db.from("ads_campaigns").select("name").eq("campaign_id", campaignId).limit(1);
  const linha = ((data || []) as Array<{ name?: string | null }>)[0];
  return (linha && linha.name) || "";
}
