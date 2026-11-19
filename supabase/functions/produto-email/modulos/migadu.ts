/**
 * Migadu, o correio da Aceleriq (19/11/2026). Uma conta só para todos os clientes: domínios e caixas
 * ilimitados, preço por conta e não por usuário.
 *
 * API de administração (https://migadu.com/api/, em beta): https://api.migadu.com/v1/, autenticação
 * básica com o e-mail da conta Migadu e uma chave de API. Os dois ficam só nos segredos da função
 * (MIGADU_USUARIO e MIGADU_API_KEY), nunca no banco, no front ou num arquivo.
 *
 * As caixas nascem por CONVITE: o Migadu manda para o e-mail de recuperação o link para a pessoa
 * criar a própria senha. Exceção (19/11/2026, central de acessos): a casa pode criar a caixa ou trocar a
 * senha com uma senha escolhida por ela, que vai direto para o Migadu e para o Vault (nunca para log).
 *
 * Sem import: roda na função (Deno) e no vitest. A rede chega de fora (`buscar`).
 */

type Buscar = (url: string, init: RequestInit) => Promise<Response>;

export const API_DO_MIGADU = "https://api.migadu.com/v1";
export const SERVIDORES_DO_MIGADU = { imap: { host: "imap.migadu.com", porta: 993 }, smtp: { host: "smtp.migadu.com", porta: 465 }, webmail: "https://webmail.migadu.com" };

export interface CredencialDoMigadu {
  usuario: string;
  chave: string;
}

export class ErroDoMigadu extends Error {
  constructor(public etapa: string, public status: number, mensagem: string) {
    super(mensagem);
  }
}

const DOMINIO = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const PARTE_LOCAL = /^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$/;
const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

/** A credencial dos segredos, só se estiver inteira. */
export function credencialValida(usuario: string, chave: string): CredencialDoMigadu | null {
  const u = String(usuario || "").trim();
  const c = String(chave || "").trim();
  return EMAIL.test(u) && c.length >= 16 ? { usuario: u, chave: c } : null;
}

const basico = (c: CredencialDoMigadu) => {
  const texto = `${c.usuario}:${c.chave}`;
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
};

async function pedir<T>(c: CredencialDoMigadu, buscar: Buscar, etapa: string, metodo: "GET" | "POST" | "PUT" | "PATCH", caminho: string, corpo?: unknown): Promise<T> {
  const r = await buscar(`${API_DO_MIGADU}${caminho}`, {
    method: metodo,
    headers: { Authorization: basico(c), Accept: "application/json", ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  const json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok) {
    const msg = json && (json.error || json.message) ? String(json.message || json.error) : `HTTP ${r.status}`;
    throw new ErroDoMigadu(etapa, r.status, `O Migadu recusou (${etapa}): ${msg.slice(0, 200)}`);
  }
  return (json || {}) as T;
}

export interface DominioNoMigadu {
  nome: string;
  estado: string;
  ativo: boolean;
  pode_enviar: boolean;
  pode_receber: boolean;
}

const lerDominio = (d: Record<string, unknown>): DominioNoMigadu => ({
  nome: String(d.name || ""),
  estado: String(d.state || ""),
  ativo: String(d.state || "") === "active" || !!d.activated_at,
  pode_enviar: d.can_send === true,
  pode_receber: d.can_receive === true,
});

/** O domínio no Migadu, ou null se ainda não existe lá. */
export async function dominioNoMigadu(c: CredencialDoMigadu, buscar: Buscar, dominio: string): Promise<DominioNoMigadu | null> {
  if (!DOMINIO.test(dominio)) throw new ErroDoMigadu("dominio", 400, "Domínio inválido.");
  try {
    return lerDominio(await pedir<Record<string, unknown>>(c, buscar, "dominio", "GET", `/domains/${encodeURIComponent(dominio)}`));
  } catch (e) {
    if (e instanceof ErroDoMigadu && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

/** Cria o domínio com DNS de fora (a zona fica na Cloudflare da Aceleriq) e sem endereços automáticos. */
export async function criarDominioNoMigadu(c: CredencialDoMigadu, buscar: Buscar, dominio: string): Promise<DominioNoMigadu> {
  if (!DOMINIO.test(dominio)) throw new ErroDoMigadu("dominio", 400, "Domínio inválido.");
  return lerDominio(await pedir<Record<string, unknown>>(c, buscar, "criar_dominio", "POST", "/domains", { name: dominio, hosted_dns: false, create_default_addresses: false }));
}

export interface RegistroDeDns {
  tipo: "MX" | "TXT" | "CNAME";
  /** Nome completo, já com o domínio (como a Cloudflare espera). */
  nome: string;
  valor: string;
  prioridade?: number;
  papel: "mx" | "spf" | "dkim" | "dmarc" | "verificacao";
}

/** "@" vira o domínio; "key1._domainkey" vira "key1._domainkey.dominio". */
const nomeCompleto = (nome: unknown, dominio: string) => {
  const n = String(nome || "@").trim().replace(/\.$/, "");
  if (!n || n === "@") return dominio;
  return n.endsWith(`.${dominio}`) || n === dominio ? n : `${n}.${dominio}`;
};

/** Os registros que o Migadu pede, lidos sem confiar no formato. */
export function registrosDoMigadu(bruto: unknown, dominio: string): RegistroDeDns[] {
  const r = (bruto || {}) as Record<string, unknown>;
  const saida: RegistroDeDns[] = [];
  const tipoDe = (t: unknown): RegistroDeDns["tipo"] | null => {
    const x = String(t || "").toUpperCase();
    return x === "MX" || x === "TXT" || x === "CNAME" ? x : null;
  };
  const somar = (x: unknown, papel: RegistroDeDns["papel"]) => {
    const o = (x || {}) as Record<string, unknown>;
    const tipo = tipoDe(o.type);
    const valor = String(o.value || "").trim();
    if (!tipo || !valor || valor.length > 2000) return;
    const prioridade = Number(o.priority);
    saida.push({ tipo, nome: nomeCompleto(o.name, dominio), valor, papel, ...(tipo === "MX" && isFinite(prioridade) ? { prioridade } : {}) });
  };
  for (const mx of Array.isArray(r.mx_records) ? r.mx_records : []) somar(mx, "mx");
  somar(r.spf, "spf");
  for (const k of Array.isArray(r.dkim) ? r.dkim : []) somar(k, "dkim");
  somar(r.dmarc, "dmarc");
  somar(r.dns_verification, "verificacao");
  return saida;
}

export async function registrosNoMigadu(c: CredencialDoMigadu, buscar: Buscar, dominio: string): Promise<RegistroDeDns[]> {
  return registrosDoMigadu(await pedir<Record<string, unknown>>(c, buscar, "registros", "GET", `/domains/${encodeURIComponent(dominio)}/records`), dominio);
}

/** Pede ao Migadu para conferir o DNS e ativar. Devolve false (com o motivo) se o DNS ainda não está certo. */
export async function ativarNoMigadu(c: CredencialDoMigadu, buscar: Buscar, dominio: string): Promise<{ ativo: boolean; motivo: string | null }> {
  try {
    const d = lerDominio(await pedir<Record<string, unknown>>(c, buscar, "ativar", "GET", `/domains/${encodeURIComponent(dominio)}/activate`));
    void d;
    return { ativo: true, motivo: null };
  } catch (e) {
    if (e instanceof ErroDoMigadu && e.status === 422) return { ativo: false, motivo: e.message };
    throw e;
  }
}

export interface CaixaNoMigadu {
  endereco: string;
  nome: string;
  ativa: boolean;
  espaco_gb: number | null;
}

const lerCaixa = (x: Record<string, unknown>): CaixaNoMigadu => ({
  endereco: String(x.address || "").toLowerCase(),
  nome: String(x.name || ""),
  ativa: x.is_active !== false,
  espaco_gb: isFinite(Number(x.storage_usage)) ? Number(x.storage_usage) : null,
});

export async function caixasNoMigadu(c: CredencialDoMigadu, buscar: Buscar, dominio: string): Promise<CaixaNoMigadu[]> {
  const r = await pedir<Record<string, unknown>>(c, buscar, "caixas", "GET", `/domains/${encodeURIComponent(dominio)}/mailboxes`);
  return (Array.isArray(r.mailboxes) ? (r.mailboxes as Array<Record<string, unknown>>) : []).map(lerCaixa).filter((x) => x.endereco);
}

/** A parte antes do @, se o endereço for do domínio. */
export function parteLocal(endereco: string, dominio: string): string | null {
  const e = String(endereco || "").trim().toLowerCase();
  const [local, dom] = e.split("@");
  return dom === dominio && PARTE_LOCAL.test(local || "") ? local : null;
}

/** Cria a caixa por convite: o Migadu manda o link de criar a senha para o e-mail de recuperação. */
export async function criarCaixaNoMigadu(c: CredencialDoMigadu, buscar: Buscar, p: { dominio: string; endereco: string; nome: string; recuperacao: string }): Promise<CaixaNoMigadu> {
  const local = parteLocal(p.endereco, p.dominio);
  if (!local) throw new ErroDoMigadu("caixa", 400, `Endereço fora do domínio: ${p.endereco}`);
  if (!EMAIL.test(p.recuperacao) || p.recuperacao.toLowerCase().endsWith(`@${p.dominio}`)) {
    throw new ErroDoMigadu("caixa", 400, "O convite precisa de um e-mail de fora do domínio (o de hoje da pessoa).");
  }
  return lerCaixa(await pedir<Record<string, unknown>>(c, buscar, "criar_caixa", "POST", `/domains/${encodeURIComponent(p.dominio)}/mailboxes`, {
    local_part: local,
    name: String(p.nome || local).slice(0, 80),
    password_method: "invitation",
    password_recovery_email: p.recuperacao,
  }));
}

/** Apelido (alias): entrega numa ou mais caixas do mesmo domínio. */
export async function criarApelidoNoMigadu(c: CredencialDoMigadu, buscar: Buscar, p: { dominio: string; endereco: string; destinos: string[] }): Promise<{ endereco: string }> {
  const local = parteLocal(p.endereco, p.dominio);
  const destinos = p.destinos.map((d) => d.trim().toLowerCase()).filter((d) => !!parteLocal(d, p.dominio));
  if (!local || !destinos.length) throw new ErroDoMigadu("apelido", 400, `Apelido inválido: ${p.endereco}`);
  const r = await pedir<Record<string, unknown>>(c, buscar, "criar_apelido", "POST", `/domains/${encodeURIComponent(p.dominio)}/aliases`, { local_part: local, destinations: destinos.join(",") });
  return { endereco: String(r.address || p.endereco).toLowerCase() };
}

export interface CaixaPedida {
  id: string;
  endereco: string;
  tipo: "caixa" | "apelido" | "grupo";
  pessoa: string | null;
  recuperacao: string | null;
  destinos?: string[];
}

export interface ResultadoDaMontagem {
  dominio: DominioNoMigadu;
  dominio_criado: boolean;
  registros: RegistroDeDns[];
  criadas: string[];
  ja_existiam: string[];
  pendentes: Array<{ id: string; endereco: string; motivo: string }>;
}

/**
 * Monta o domínio no Migadu: cria se não existe, cria as caixas que faltam (por convite) e os apelidos.
 * Pode rodar de novo: o que já existe fica como está. Devolve os registros de DNS para publicar.
 */
export async function montarNoMigadu(c: CredencialDoMigadu, buscar: Buscar, p: { dominio: string; caixas: CaixaPedida[] }): Promise<ResultadoDaMontagem> {
  let dominio = await dominioNoMigadu(c, buscar, p.dominio);
  const dominio_criado = !dominio;
  if (!dominio) dominio = await criarDominioNoMigadu(c, buscar, p.dominio);
  const existentes = new Set((await caixasNoMigadu(c, buscar, p.dominio)).map((x) => x.endereco));
  const criadas: string[] = [];
  const ja_existiam: string[] = [];
  const pendentes: ResultadoDaMontagem["pendentes"] = [];
  // Caixas antes dos apelidos: o apelido precisa da caixa de destino.
  const ordem = [...p.caixas.filter((x) => x.tipo === "caixa"), ...p.caixas.filter((x) => x.tipo !== "caixa")];
  for (const x of ordem) {
    const endereco = x.endereco.toLowerCase();
    if (existentes.has(endereco)) {
      ja_existiam.push(endereco);
      continue;
    }
    try {
      if (x.tipo === "caixa") {
        if (!x.recuperacao) {
          pendentes.push({ id: x.id, endereco, motivo: "Falta o e-mail de hoje da pessoa para mandar o convite." });
          continue;
        }
        await criarCaixaNoMigadu(c, buscar, { dominio: p.dominio, endereco, nome: x.pessoa || "", recuperacao: x.recuperacao });
      } else {
        if (!x.destinos || !x.destinos.length) {
          pendentes.push({ id: x.id, endereco, motivo: "Falta a caixa de destino do apelido." });
          continue;
        }
        await criarApelidoNoMigadu(c, buscar, { dominio: p.dominio, endereco, destinos: x.destinos });
      }
      criadas.push(endereco);
      existentes.add(endereco);
    } catch (e) {
      pendentes.push({ id: x.id, endereco, motivo: e instanceof Error ? e.message.slice(0, 200) : "Falha ao criar." });
    }
  }
  const registros = await registrosNoMigadu(c, buscar, p.dominio);
  return { dominio, dominio_criado, registros, criadas, ja_existiam, pendentes };
}

// ------------------------------------------------------------------ central de acessos (19/11/2026)

/**
 * Cria a caixa já com a senha que a casa escolheu (a central de acessos guarda a mesma senha no Vault).
 * A senha vai só no corpo do pedido ao Migadu; nunca no erro, no log ou na resposta.
 */
export async function criarCaixaComSenhaNoMigadu(c: CredencialDoMigadu, buscar: Buscar, p: { dominio: string; endereco: string; nome: string; senha: string }): Promise<CaixaNoMigadu> {
  const local = parteLocal(p.endereco, p.dominio);
  if (!local) throw new ErroDoMigadu("caixa", 400, `Endereço fora do domínio: ${p.endereco}`);
  return lerCaixa(await pedir<Record<string, unknown>>(c, buscar, "criar_caixa", "POST", `/domains/${encodeURIComponent(p.dominio)}/mailboxes`, {
    local_part: local,
    name: String(p.nome || local).slice(0, 80),
    password: p.senha,
  }));
}

/** Troca a senha da caixa no Migadu (PUT da caixa com `password`). */
export async function mudarSenhaNoMigadu(c: CredencialDoMigadu, buscar: Buscar, p: { dominio: string; endereco: string; senha: string }): Promise<void> {
  const local = parteLocal(p.endereco, p.dominio);
  if (!local) throw new ErroDoMigadu("senha", 400, `Endereço fora do domínio: ${p.endereco}`);
  await pedir<Record<string, unknown>>(c, buscar, "senha", "PUT", `/domains/${encodeURIComponent(p.dominio)}/mailboxes/${encodeURIComponent(local)}`, { password: p.senha });
}

/**
 * Desativa a caixa sem apagar as mensagens: a API do Migadu não deixa mudar `is_active`, então a caixa
 * deixa de enviar, receber e abrir por IMAP, POP3 e filtros. Reativar é ligar os mesmos campos de novo.
 */
export async function bloquearCaixaNoMigadu(c: CredencialDoMigadu, buscar: Buscar, p: { dominio: string; endereco: string }): Promise<void> {
  const local = parteLocal(p.endereco, p.dominio);
  if (!local) throw new ErroDoMigadu("desativar", 400, `Endereço fora do domínio: ${p.endereco}`);
  await pedir<Record<string, unknown>>(c, buscar, "desativar", "PUT", `/domains/${encodeURIComponent(p.dominio)}/mailboxes/${encodeURIComponent(local)}`, {
    may_send: false,
    may_receive: false,
    may_access_imap: false,
    may_access_pop3: false,
    may_access_managesieve: false,
  });
}
