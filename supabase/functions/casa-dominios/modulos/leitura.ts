/**
 * Central de domínios e sites (19/11/2026): o que a função lê lá fora, separado da rede para ter teste.
 * Tudo aqui é leitura: Cloudflare só por GET, RDAP (vencimento e registrador) e a resposta dos sites.
 * Sem import de pacote: roda na função (Deno) e no vitest.
 */
import type { ZonaDaCloudflare } from "../../produto-email/modulos/cloudflare.ts";

type Busca = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://api.cloudflare.com/client/v4";
const semPonto = (t: string) => String(t || "").toLowerCase().trim().replace(/\.+$/, "");

// ------------------------------------------------------------------ RDAP

/** Onde perguntar: o Registro.br responde pelo .br; o rdap.org encaminha o resto. */
export function urlDoRdap(dominio: string): string {
  const d = semPonto(dominio);
  return /\.br$/.test(d) ? `https://rdap.registro.br/domain/${encodeURIComponent(d)}` : `https://rdap.org/domain/${encodeURIComponent(d)}`;
}

export interface LeituraDoRdap {
  vence_em: string | null;
  registrador: string | null;
  titular: string | null;
  nameservers: string[];
}

type Vcard = [string, Record<string, unknown>, string, unknown];
interface EntidadeRdap {
  roles?: string[];
  vcardArray?: [string, Vcard[]];
  publicIds?: Array<{ type?: string; identifier?: string }>;
  handle?: string;
  entities?: EntidadeRdap[];
}

function nomeDoVcard(e: EntidadeRdap): string | null {
  const linhas = e.vcardArray && Array.isArray(e.vcardArray[1]) ? e.vcardArray[1] : [];
  const fn = linhas.filter((l) => Array.isArray(l) && l[0] === "fn")[0];
  const nome = fn ? String(fn[3] || "").trim() : "";
  return nome || null;
}

function acharPapel(entidades: EntidadeRdap[] | undefined, papel: string): EntidadeRdap | null {
  for (const e of entidades || []) {
    if ((e.roles || []).indexOf(papel) >= 0) return e;
    const dentro = acharPapel(e.entities, papel);
    if (dentro) return dentro;
  }
  return null;
}

/** Lê a resposta RDAP: vencimento, registrador, titular e nameservers. */
export function lerRdap(corpo: unknown, dominio: string): LeituraDoRdap {
  const r = (corpo || {}) as { events?: Array<{ eventAction?: string; eventDate?: string }>; entities?: EntidadeRdap[]; nameservers?: Array<{ ldhName?: string }>; port43?: string };
  const venc = (r.events || []).filter((e) => e && e.eventAction === "expiration")[0];
  const vence_em = venc && /^\d{4}-\d{2}-\d{2}/.test(String(venc.eventDate || "")) ? String(venc.eventDate).slice(0, 10) : null;
  const reg = acharPapel(r.entities, "registrar");
  // No .br quem registra é o próprio Registro.br (não vem entidade "registrar").
  const registrador = reg ? nomeDoVcard(reg) || reg.handle || null : /\.br$/.test(semPonto(dominio)) ? "Registro.br" : null;
  const tit = acharPapel(r.entities, "registrant");
  const titular = tit ? nomeDoVcard(tit) : null;
  const nameservers = (r.nameservers || []).map((n) => semPonto(String((n && n.ldhName) || ""))).filter(Boolean);
  return { vence_em, registrador, titular, nameservers };
}

export async function consultarRdap(busca: Busca, dominio: string): Promise<LeituraDoRdap> {
  const r = await busca(urlDoRdap(dominio), { headers: { accept: "application/rdap+json, application/json" }, redirect: "follow" });
  if (r.status === 404) throw new Error("O RDAP não achou o domínio.");
  if (r.status === 429) throw new Error("O RDAP pediu para esperar (muitas consultas).");
  if (!r.ok) throw new Error(`O RDAP respondeu ${r.status}.`);
  return lerRdap(await r.json(), dominio);
}

// ------------------------------------------------------------------ Cloudflare (só GET)

export interface ScriptDoWorker {
  id: string;
  modified_on?: string;
  created_on?: string;
}
export interface DominioDoWorker {
  hostname: string;
  service: string;
  zone_name?: string;
}
export interface RotaDoWorker {
  pattern: string;
  script?: string | null;
}
export interface ProjetoDoPages {
  name: string;
  subdomain?: string;
  domains?: string[];
  latest_deployment?: { created_on?: string; url?: string } | null;
}
export interface ZonaDaConta extends ZonaDaCloudflare {
  original_registrar?: string | null;
}

export interface LidoDaCloudflare {
  zonas: ZonaDaConta[];
  scripts: ScriptDoWorker[];
  dominiosDosWorkers: DominioDoWorker[];
  rotas: RotaDoWorker[];
  subdominioWorkers: string | null;
  projetos: ProjetoDoPages[];
  avisos: string[];
}

interface Corpo<T> {
  success?: boolean;
  result?: T;
  result_info?: { page?: number; total_pages?: number };
  errors?: Array<{ message?: string }>;
}

async function pedir<T>(token: string, busca: Busca, caminho: string): Promise<Corpo<T>> {
  const r = await busca(`${API}${caminho}`, { method: "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const corpo = (await r.json().catch(() => null)) as Corpo<T> | null;
  if (!r.ok || !corpo || corpo.success === false) {
    const m = corpo && corpo.errors && corpo.errors[0] && corpo.errors[0].message ? corpo.errors[0].message : `HTTP ${r.status}`;
    throw new Error(`A Cloudflare recusou ${caminho.split("?")[0]}: ${String(m).slice(0, 160)}`);
  }
  return corpo;
}

async function todasAsPaginas<T>(token: string, busca: Busca, caminho: string, porPagina: number): Promise<T[]> {
  const lista: T[] = [];
  for (let pagina = 1; pagina <= 40; pagina++) {
    const sep = caminho.indexOf("?") >= 0 ? "&" : "?";
    const c = await pedir<T[]>(token, busca, `${caminho}${sep}page=${pagina}&per_page=${porPagina}`);
    const itens = Array.isArray(c.result) ? c.result : [];
    lista.push(...itens);
    const total = c.result_info && c.result_info.total_pages ? c.result_info.total_pages : 1;
    if (pagina >= total || itens.length === 0) break;
  }
  return lista;
}

/**
 * Lê a conta inteira: zonas, Workers (scripts, domínios personalizados, rotas, workers.dev) e Pages.
 * Uma parte que falhar (token sem a permissão) vira aviso; o resto segue.
 */
export async function lerConta(token: string, busca: Busca, contaId: string): Promise<LidoDaCloudflare> {
  const conta = encodeURIComponent(contaId);
  const avisos: string[] = [];
  const tentar = async <T>(oQue: string, f: () => Promise<T>, vazio: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      avisos.push(`${oQue}: ${e instanceof Error ? e.message : "falhou"}`);
      return vazio;
    }
  };
  const zonas = await todasAsPaginas<ZonaDaConta>(token, busca, `/zones?account.id=${conta}`, 50);
  const [scripts, dominiosDosWorkers, subdominio, projetos] = await Promise.all([
    tentar("Workers", () => pedir<ScriptDoWorker[]>(token, busca, `/accounts/${conta}/workers/scripts`).then((c) => c.result || []), [] as ScriptDoWorker[]),
    tentar("Domínios dos Workers", () => todasAsPaginas<DominioDoWorker>(token, busca, `/accounts/${conta}/workers/domains`, 100), [] as DominioDoWorker[]),
    tentar("workers.dev", () => pedir<{ subdomain?: string }>(token, busca, `/accounts/${conta}/workers/subdomain`).then((c) => (c.result && c.result.subdomain) || null), null as string | null),
    tentar("Pages", () => todasAsPaginas<ProjetoDoPages>(token, busca, `/accounts/${conta}/pages/projects`, 10), [] as ProjetoDoPages[]),
  ]);
  const rotas: RotaDoWorker[] = [];
  for (const z of zonas) {
    const r = await tentar(`Rotas de ${z.name}`, () => pedir<RotaDoWorker[]>(token, busca, `/zones/${encodeURIComponent(z.id)}/workers/routes`).then((c) => c.result || []), [] as RotaDoWorker[]);
    rotas.push(...r.filter((x) => x && x.script));
  }
  return { zonas, scripts, dominiosDosWorkers, rotas, subdominioWorkers: subdominio, projetos, avisos: avisos.slice(0, 10) };
}

/** O host de uma rota ("*.empresa.com.br/*" vira "empresa.com.br"; "www.x.com/*" vira "www.x.com"). */
export function hostDaRota(padrao: string): string | null {
  const h = semPonto(String(padrao || "").replace(/^https?:\/\//, "").split("/")[0].replace(/^\*\.?/, ""));
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(h) ? h : null;
}

/** Escolhe o endereço principal: o domínio próprio (o mais curto, sem wildcard) e, sem ele, o .dev. */
export function enderecoPrincipal(proprios: string[], reserva: string | null): string | null {
  const limpos = proprios.map(semPonto).filter((h) => /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(h));
  limpos.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return limpos[0] || (reserva ? semPonto(reserva) : null);
}

export interface DominioLido {
  dominio: string;
  origem: "cloudflare";
  nameservers: string[];
  cloudflare_zona_id: string;
  cloudflare_status: string;
  na_cloudflare_da_casa: true;
  registrador?: string;
}
export interface SiteLido {
  cf_tipo: "worker" | "pages";
  cf_nome: string;
  nome: string;
  endereco: string | null;
  dominios_personalizados: string[];
  ultima_publicacao: string | null;
}

/** Transforma o que a Cloudflare devolveu nas linhas que a central grava. */
export function montarLeitura(l: LidoDaCloudflare): { dominios: DominioLido[]; sites: SiteLido[] } {
  const dominios: DominioLido[] = l.zonas.map((z) => {
    const d: DominioLido = {
      dominio: semPonto(z.name),
      origem: "cloudflare",
      nameservers: (z.name_servers || []).map(semPonto),
      cloudflare_zona_id: z.id,
      cloudflare_status: z.status,
      na_cloudflare_da_casa: true,
    };
    if (z.original_registrar) d.registrador = String(z.original_registrar).split("(")[0].trim().slice(0, 80);
    return d;
  });

  const porScript: Record<string, string[]> = {};
  for (const d of l.dominiosDosWorkers) (porScript[d.service] ||= []).push(d.hostname);
  for (const r of l.rotas) {
    const h = r.script ? hostDaRota(r.pattern) : null;
    if (h && r.script) (porScript[r.script] ||= []).push(h);
  }
  const unicos = (xs: string[]) => xs.map(semPonto).filter((x, i, a) => x && a.indexOf(x) === i);

  const sites: SiteLido[] = [];
  for (const s of l.scripts) {
    const proprios = unicos(porScript[s.id] || []);
    sites.push({
      cf_tipo: "worker",
      cf_nome: s.id,
      nome: s.id,
      endereco: enderecoPrincipal(proprios, l.subdominioWorkers ? `${s.id}.${l.subdominioWorkers}.workers.dev` : null),
      dominios_personalizados: proprios,
      ultima_publicacao: s.modified_on || s.created_on || null,
    });
  }
  for (const p of l.projetos) {
    const proprios = unicos((p.domains || []).filter((d) => !/\.pages\.dev$/.test(d)));
    sites.push({
      cf_tipo: "pages",
      cf_nome: p.name,
      nome: p.name,
      endereco: enderecoPrincipal(proprios, p.subdomain || `${p.name}.pages.dev`),
      dominios_personalizados: proprios,
      ultima_publicacao: (p.latest_deployment && p.latest_deployment.created_on) || null,
    });
  }
  return { dominios, sites };
}

// ------------------------------------------------------------------ sites

export interface SaudeDoSiteLida {
  http_status: number | null;
  ssl_ok: boolean | null;
  resposta_ms: number | null;
  erro: string | null;
}

/** Abre o site por HTTPS e anota o código, o tempo e se o certificado passou. */
export async function conferirSite(busca: Busca, endereco: string, tempoMs = 8000, relogio: () => number = Date.now): Promise<SaudeDoSiteLida> {
  const url = `https://${String(endereco).replace(/^https?:\/\//, "")}`;
  const ctl = new AbortController();
  const corte = setTimeout(() => ctl.abort(), tempoMs);
  const inicio = relogio();
  try {
    const r = await busca(url, { method: "GET", redirect: "follow", signal: ctl.signal, headers: { "user-agent": "AceleriqCentral/1.0 (conferencia de site)" } });
    try {
      await r.body?.cancel();
    } catch {
      /* corpo já fechado */
    }
    return { http_status: r.status, ssl_ok: true, resposta_ms: Math.max(0, Math.round(relogio() - inicio)), erro: null };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const abortado = (e instanceof Error && e.name === "AbortError") || /abort/i.test(m);
    const certificado = /certificate|tls|ssl|handshake|cert/i.test(m);
    return {
      http_status: null,
      ssl_ok: certificado ? false : null,
      resposta_ms: null,
      erro: abortado ? `Não respondeu em ${Math.round(tempoMs / 1000)} segundos.` : certificado ? "Certificado SSL recusado." : `Não abriu: ${m.slice(0, 160)}`,
    };
  } finally {
    clearTimeout(corte);
  }
}

/** Roda as tarefas com no máximo N ao mesmo tempo. */
export async function emLotes<T, R>(itens: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await f(itens[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, itens.length)) }, trabalhador));
  return saida;
}
