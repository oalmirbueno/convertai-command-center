import { supabase } from "@/integrations/supabase/client";
import { ErroDoProduto } from "./api";
import { diasAteODia } from "./email-central";

/**
 * Central de domínios e sites da casa (19/11/2026). Contrato do banco:
 * supabase/migrations/20261119120000_casa_dominios_e_sites.sql; leitura lá fora: supabase/functions/casa-dominios.
 * A saúde de cada domínio e site é calculada aqui, em regra pura, para ter teste.
 */

const db = supabase as unknown as {
  rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { message: string; code?: string } | null }>;
};

export type Periodo = "mensal" | "anual";

export interface ItemDoDns {
  chave: string;
  estado?: "certo" | "atencao" | "falta";
  situacao?: "ok" | "alerta" | "falta";
  achado?: string[];
}

export interface DominioDaCasa {
  id: string | null;
  dominio: string;
  origem: "manual" | "cloudflare" | "email";
  cliente: string | null;
  cliente_nome: string | null;
  registrador: string | null;
  titular: string | null;
  nameservers: string[];
  cloudflare_zona_id: string | null;
  cloudflare_status: string | null;
  na_cloudflare_da_casa: boolean;
  vence_em: string | null;
  vencimento_fonte: "rdap" | "manual" | null;
  rdap_lido_em: string | null;
  rdap_erro: string | null;
  dns_email: { pronto?: boolean; itens?: ItemDoDns[] } | null;
  dns_conferido_em: string | null;
  email: { dominio_id: string; provedor: string; estado: string } | null;
  custo_valor: number | null;
  custo_periodo: Periodo;
  preco_valor: number | null;
  preco_periodo: Periodo;
  observacao: string | null;
  arquivado: boolean;
}

export interface SiteDaCasa {
  id: string;
  nome: string;
  endereco: string | null;
  origem: "manual" | "cloudflare";
  cf_tipo: "worker" | "pages" | null;
  cf_nome: string | null;
  hospedagem: string | null;
  dominios_personalizados: string[];
  cliente: string | null;
  cliente_nome: string | null;
  cliente_herdado: boolean;
  dominio_id: string | null;
  dominio: string | null;
  ultima_publicacao: string | null;
  http_status: number | null;
  ssl_ok: boolean | null;
  resposta_ms: number | null;
  erro: string | null;
  conferido_em: string | null;
  custo_valor: number | null;
  custo_periodo: Periodo;
  preco_valor: number | null;
  preco_periodo: Periodo;
  observacao: string | null;
  arquivado: boolean;
}

export interface CentralDeDominios {
  dominios: DominioDaCasa[];
  sites: SiteDaCasa[];
  clientes: Array<{ valor: string; nome: string }>;
  leitura: { dominios_em: string | null; cloudflare_em: string | null; sites_em: string | null };
}

const valor = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const periodo = (v: unknown, padrao: Periodo): Periodo => (v === "mensal" || v === "anual" ? v : padrao);
const textos = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export function lerCentral(d: any): CentralDeDominios {
  const x = d || {};
  return {
    dominios: (Array.isArray(x.dominios) ? x.dominios : []).map((r: any) => ({
      ...r,
      nameservers: textos(r.nameservers),
      na_cloudflare_da_casa: r.na_cloudflare_da_casa === true,
      custo_valor: valor(r.custo_valor),
      preco_valor: valor(r.preco_valor),
      custo_periodo: periodo(r.custo_periodo, "anual"),
      preco_periodo: periodo(r.preco_periodo, "mensal"),
      arquivado: r.arquivado === true,
    })),
    sites: (Array.isArray(x.sites) ? x.sites : []).map((r: any) => ({
      ...r,
      dominios_personalizados: textos(r.dominios_personalizados),
      cliente_herdado: r.cliente_herdado === true,
      http_status: r.http_status == null ? null : Number(r.http_status),
      resposta_ms: r.resposta_ms == null ? null : Number(r.resposta_ms),
      custo_valor: valor(r.custo_valor),
      preco_valor: valor(r.preco_valor),
      custo_periodo: periodo(r.custo_periodo, "mensal"),
      preco_periodo: periodo(r.preco_periodo, "mensal"),
      arquivado: r.arquivado === true,
    })),
    clientes: Array.isArray(x.clientes) ? x.clientes : [],
    leitura: x.leitura || { dominios_em: null, cloudflare_em: null, sites_em: null },
  };
}

export async function carregarCentralDeDominios(): Promise<CentralDeDominios> {
  const { data, error } = await db.rpc("casa_dominios_sites_central");
  if (error) throw error;
  return lerCentral(data);
}

async function rpc<T>(f: string, a: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(f, a);
  if (error) throw error;
  return data as T;
}

export interface DadosDoDominio {
  dominio?: string;
  email_dominio_id?: string;
  cliente?: string;
  registrador?: string;
  titular?: string;
  vence_em?: string;
  custo_valor?: string;
  custo_periodo?: Periodo;
  preco_valor?: string;
  preco_periodo?: Periodo;
  observacao?: string;
}
export interface DadosDoSite {
  nome?: string;
  endereco?: string;
  cliente?: string;
  dominio_id?: string;
  hospedagem?: string;
  custo_valor?: string;
  custo_periodo?: Periodo;
  preco_valor?: string;
  preco_periodo?: Periodo;
  observacao?: string;
}

export const salvarDominio = (id: string | null, dados: DadosDoDominio) => rpc<{ id: string; dominio: string }>("casa_dominio_salvar", { _id: id, _dados: dados });
export const salvarSite = (id: string | null, dados: DadosDoSite) => rpc<{ id: string; nome: string }>("casa_site_salvar", { _id: id, _dados: dados });
export const arquivar = (tipo: "dominio" | "site", id: string, sim = true) => rpc<boolean>("casa_dominios_sites_arquivar", { _tipo: tipo, _id: id, _arquivar: sim });

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("casa-dominios", { body: corpo });
  if (error) {
    let resposta: { error?: string; mensagem?: string } | null = null;
    try {
      const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context;
      resposta = ctx && typeof ctx.clone === "function" ? ((await ctx.clone().json()) as { error?: string; mensagem?: string }) : null;
    } catch {
      resposta = null;
    }
    if (resposta && resposta.mensagem) throw new ErroDoProduto(String(resposta.error || "erro"), resposta.mensagem);
    throw new ErroDoProduto("servico_indisponivel", "A função casa-dominios não respondeu. Ela já foi publicada?");
  }
  return data as T;
}

/** Se o segredo da Cloudflare está colado. Função fora do ar conta como desligada. */
export const estadoDaLeitura = () => chamar<{ cloudflare: boolean }>({ acao: "estado" }).then((r) => ({ cloudflare: r.cloudflare === true, publicada: true })).catch(() => ({ cloudflare: false, publicada: false }));
export const lerCloudflare = () => chamar<{ dominios: number; sites: number; avisos: string[] }>({ acao: "ler_cloudflare" });
export const conferirAgora = (parte: "dominios" | "sites" | "tudo" = "tudo") => chamar<{ dominios: number; saude_sites: number }>({ acao: "conferir", parte });

// ------------------------------------------------------------------ regras

/** O valor em reais por mês (anual dividido por 12). */
export function porMes(v: number | null, p: Periodo): number {
  if (v === null || !isFinite(v)) return 0;
  return Math.round((p === "anual" ? v / 12 : v) * 100) / 100;
}

const DNS_DE: Array<[RegExp, string]> = [
  [/\.ns\.cloudflare\.com$/, "Cloudflare"],
  [/(dns-parking\.com|hostinger)/, "Hostinger"],
  [/\.dns\.br$/, "Registro.br"],
  [/locaweb/, "Locaweb"],
  [/(uolhost|\.uol\.com\.br)/, "UOL Host"],
  [/domaincontrol\.com$/, "GoDaddy"],
  [/kinghost/, "KingHost"],
  [/(hostgator|websitewelcome)/, "HostGator"],
  [/(awsdns|amazonaws)/, "AWS"],
  [/(googledomains|google\.com$)/, "Google"],
  [/(vercel-dns|vercel)/, "Vercel"],
];

/** Onde está o DNS, pelos nameservers. */
export function ondeEstaODns(nameservers: string[]): string | null {
  if (!nameservers.length) return null;
  const ns = nameservers[0].toLowerCase();
  for (const [re, nome] of DNS_DE) if (re.test(ns)) return nome;
  return "Outro";
}

/** O domínio tem e-mail? Com e-mail da Aceleriq ou com MX publicado. */
export function temEmail(d: DominioDaCasa): boolean {
  if (d.email) return true;
  const mx = d.dns_email && d.dns_email.itens ? d.dns_email.itens.filter((i) => i.chave === "mx")[0] : null;
  return !!(mx && mx.achado && mx.achado.length);
}

/** Quantos itens do DNS de e-mail faltam (nulo = nunca conferido). */
export function faltasNoDns(d: DominioDaCasa): number | null {
  if (!d.dns_email || !Array.isArray(d.dns_email.itens)) return null;
  return d.dns_email.itens.filter((i) => i.estado === "falta" || i.situacao === "falta").length;
}

export type Gravidade = "critico" | "atencao" | "info";
export interface Aviso {
  gravidade: Gravidade;
  texto: string;
}
export type Saude = "critico" | "atencao" | "ok";
export const ROTULO_DA_SAUDE: Record<Saude, string> = { critico: "Crítico", atencao: "Atenção", ok: "Em dia" };

const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;
const ordem: Record<Gravidade, number> = { critico: 0, atencao: 1, info: 2 };
const ordenar = (a: Aviso[]) => a.sort((x, y) => ordem[x.gravidade] - ordem[y.gravidade]);

export function avisosDoDominio(d: DominioDaCasa, hoje: string): Aviso[] {
  const avisos: Aviso[] = [];
  const dias = diasAteODia(d.vence_em, hoje);
  if (dias !== null) {
    if (dias < 0) avisos.push({ gravidade: "critico", texto: `Venceu há ${plural(-dias, "dia", "dias")}.` });
    else if (dias <= 7) avisos.push({ gravidade: "critico", texto: dias === 0 ? "Vence hoje." : `Vence em ${plural(dias, "dia", "dias")}.` });
    else if (dias <= 30) avisos.push({ gravidade: "atencao", texto: `Vence em ${dias} dias.` });
  } else {
    avisos.push({ gravidade: "info", texto: d.rdap_erro ? `Vencimento não lido: ${d.rdap_erro}` : "Vencimento ainda não lido." });
  }
  const faltas = faltasNoDns(d);
  if (temEmail(d) && faltas !== null && faltas > 0) avisos.push({ gravidade: "critico", texto: `DNS do e-mail com ${plural(faltas, "item faltando", "itens faltando")}.` });
  if (d.email && faltas === null) avisos.push({ gravidade: "atencao", texto: "DNS do e-mail nunca conferido." });
  if (d.na_cloudflare_da_casa && d.cloudflare_status && d.cloudflare_status !== "active") avisos.push({ gravidade: "atencao", texto: "Zona na Cloudflare ainda não ativa: troque os nameservers no registrador." });
  if (!d.cliente) avisos.push({ gravidade: "info", texto: "Sem cliente ligado." });
  if (d.cliente && d.preco_valor === null) avisos.push({ gravidade: "info", texto: "Sem preço anotado." });
  return ordenar(avisos);
}

/** Fora do ar: não abriu ou respondeu erro do servidor. */
export function foraDoAr(s: SiteDaCasa): boolean {
  if (!s.conferido_em) return false;
  return s.http_status === null || s.http_status >= 500;
}

export function avisosDoSite(s: SiteDaCasa): Aviso[] {
  const avisos: Aviso[] = [];
  if (!s.endereco) avisos.push({ gravidade: "atencao", texto: "Sem endereço para conferir." });
  else if (!s.conferido_em) avisos.push({ gravidade: "info", texto: "Ainda não conferido." });
  else if (s.http_status === null) avisos.push({ gravidade: "critico", texto: s.erro || "Fora do ar." });
  else if (s.http_status >= 500) avisos.push({ gravidade: "critico", texto: `Fora do ar: respondeu ${s.http_status}.` });
  else if (s.http_status >= 400) avisos.push({ gravidade: "atencao", texto: `Respondeu ${s.http_status}.` });
  if (s.ssl_ok === false) avisos.push({ gravidade: "critico", texto: "Certificado SSL com problema." });
  if (s.resposta_ms !== null && s.resposta_ms > 3000) avisos.push({ gravidade: "atencao", texto: `Lento: ${(s.resposta_ms / 1000).toFixed(1).replace(".", ",")} s para responder.` });
  if (!s.cliente) avisos.push({ gravidade: "info", texto: "Sem cliente ligado." });
  if (s.cliente && s.preco_valor === null) avisos.push({ gravidade: "info", texto: "Sem preço anotado." });
  return ordenar(avisos);
}

export function saudeDosAvisos(avisos: Aviso[]): Saude {
  return avisos.some((a) => a.gravidade === "critico") ? "critico" : avisos.some((a) => a.gravidade === "atencao") ? "atencao" : "ok";
}

export type Filtro = "todos" | "vence30" | "dns" | "fora" | "problema" | "sem_cliente";

export function dominioNoFiltro(d: DominioDaCasa, f: Filtro, hoje: string): boolean {
  if (f === "todos") return true;
  if (f === "vence30") {
    const dias = diasAteODia(d.vence_em, hoje);
    return dias !== null && dias <= 30;
  }
  if (f === "dns") return temEmail(d) && (faltasNoDns(d) || 0) > 0;
  if (f === "sem_cliente") return !d.cliente;
  if (f === "problema") return saudeDosAvisos(avisosDoDominio(d, hoje)) !== "ok";
  return false;
}

export function siteNoFiltro(s: SiteDaCasa, f: Filtro): boolean {
  if (f === "todos") return true;
  if (f === "fora") return foraDoAr(s) || s.ssl_ok === false;
  if (f === "sem_cliente") return !s.cliente;
  if (f === "problema") return saudeDosAvisos(avisosDoSite(s)) !== "ok";
  return false;
}

/** Os números do topo: quantos, receita e custo por mês (só o que não está arquivado). */
export function resumoDaCentralDeDominios(c: CentralDeDominios, hoje: string) {
  const dominios = c.dominios.filter((d) => !d.arquivado);
  const sites = c.sites.filter((s) => !s.arquivado);
  let receita = 0;
  let custo = 0;
  for (const x of [...dominios, ...sites]) {
    receita += porMes(x.preco_valor, x.preco_periodo);
    custo += porMes(x.custo_valor, x.custo_periodo);
  }
  const dinheiro = (v: number) => Math.round(v * 100) / 100;
  return {
    dominios: dominios.length,
    naCasa: dominios.filter((d) => d.na_cloudflare_da_casa).length,
    sites: sites.length,
    vencendo: dominios.filter((d) => dominioNoFiltro(d, "vence30", hoje)).length,
    dnsComFalta: dominios.filter((d) => dominioNoFiltro(d, "dns", hoje)).length,
    foraDoAr: sites.filter((s) => siteNoFiltro(s, "fora")).length,
    precisam:
      dominios.filter((d) => saudeDosAvisos(avisosDoDominio(d, hoje)) !== "ok").length +
      sites.filter((s) => saudeDosAvisos(avisosDoSite(s)) !== "ok").length,
    receita: dinheiro(receita),
    custo: dinheiro(custo),
    margem: dinheiro(receita - custo),
  };
}
