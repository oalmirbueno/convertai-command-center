/**
 * Publicação do site na Vercel da agência (frente SIT, 30/09/2026; prévia na
 * nuvem e publicação por versão em 20/10/2026). Só funciona com a chave
 * VERCEL_TOKEN (e VERCEL_TEAM_ID, se a conta for de time): no worker (deploy
 * da prévia e da produção, onde o build está) e no servidor (domínio, DNS e
 * tirar do ar). Sem a chave, a tela oferece "Baixar o site (zip)".
 *
 * Um projeto Vercel por site; as páginas do site são caminhos do mesmo deploy
 * (/, /obrigado/, /captura/). Cada versão salva vira um deploy de PRÉVIA (sem
 * produção) com um endereço próprio, que não depende da máquina nem do túnel
 * (a Vercel guarda o deploy de prévia que tem apelido). Publicar cria o
 * deploy de produção; tirar do ar remove os endereços dele.
 *
 * Sem Deno e sem npm: o `fetch` chega por parâmetro (worker em Node 24,
 * função em Deno e testes com fetch falso). O token só vai no cabeçalho
 * Authorization: nunca em mensagem de erro, evento ou log.
 */

import type { ConfigDaVercel } from "./dns-do-site.ts";

export const VERCEL_API = "https://api.vercel.com";

export class ErroDaVercel extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroDaVercel";
    this.status = status;
    this.codigo = codigo;
  }
}

/** Ligada só com a chave (o valor nunca sai daqui nem vai para log). */
export const vercelLigada = (token: string | null | undefined) => typeof token === "string" && token.trim().length >= 20;

export type ApiDaVercel = (metodo: string, caminho: string, corpo?: unknown, extra?: { cabecalhos?: Record<string, string>; bruto?: Uint8Array }) => Promise<Record<string, unknown>>;

export function criarApiDaVercel(c: { token: string; teamId?: string | null; fetch: typeof fetch }): ApiDaVercel {
  return async (metodo, caminho, corpo, extra) => {
    const sep = caminho.indexOf("?") >= 0 ? "&" : "?";
    const url = `${VERCEL_API}${caminho}${c.teamId ? `${sep}teamId=${encodeURIComponent(c.teamId)}` : ""}`;
    const cabecalhos: Record<string, string> = { Authorization: `Bearer ${c.token}`, ...(extra && extra.cabecalhos ? extra.cabecalhos : {}) };
    let body: BodyInit | undefined;
    if (extra && extra.bruto) {
      body = extra.bruto as unknown as BodyInit;
      cabecalhos["Content-Type"] = "application/octet-stream";
    } else if (corpo !== undefined) {
      body = JSON.stringify(corpo);
      cabecalhos["Content-Type"] = "application/json";
    }
    const r = await c.fetch(url, { method: metodo, headers: cabecalhos, body });
    const texto = await r.text();
    let json: Record<string, unknown> = {};
    try {
      json = texto ? JSON.parse(texto) : {};
    } catch {
      json = {};
    }
    if (!r.ok) {
      const e = (json.error || {}) as { code?: string; message?: string };
      throw new ErroDaVercel(r.status, String(e.code || `vercel_${r.status}`), semToken(String(e.message || `A Vercel respondeu ${r.status}.`), c.token).slice(0, 300));
    }
    return json;
  };
}

/** Por garantia: se a resposta da Vercel ecoar o token, ele sai da mensagem. */
const semToken = (msg: string, token: string) => (token && token.length >= 8 ? msg.split(token).join("[chave]") : msg);

/**
 * Cria o projeto (sem framework: o build já sai pronto do worker) ou lê o que
 * já existe com o nome. Com `semProtecao`, desliga o login da Vercel nos
 * deploys de prévia (o link é para a equipe e o cliente abrirem sem conta na
 * Vercel); se a Vercel recusar, `protecao` volta "ligada" e a tela avisa.
 */
export async function garantirProjeto(api: ApiDaVercel, nome: string, op: { semProtecao?: boolean } = {}): Promise<{ id: string; nome: string; protecao?: "desligada" | "ligada" }> {
  let projeto: { id: string; nome: string };
  try {
    const p = await api("POST", "/v11/projects", { name: nome, framework: null });
    projeto = { id: String(p.id), nome: String(p.name || nome) };
  } catch (e) {
    if (!(e instanceof ErroDaVercel) || e.status !== 409) throw e;
    const p = await api("GET", `/v9/projects/${encodeURIComponent(nome)}`);
    projeto = { id: String(p.id), nome: String(p.name || nome) };
  }
  if (!op.semProtecao) return projeto;
  try {
    await api("PATCH", `/v9/projects/${encodeURIComponent(projeto.id)}`, { ssoProtection: null, passwordProtection: null });
    return { ...projeto, protecao: "desligada" };
  } catch (e) {
    if (!(e instanceof ErroDaVercel)) throw e;
    return { ...projeto, protecao: "ligada" };
  }
}

export type ArquivoDoBuild = { caminho: string; bytes: Uint8Array; sha: string };

/**
 * Sobe cada arquivo pelo SHA1 (a Vercel ignora o que já tem) e cria o deploy.
 * `alvo` "producao" (padrão, o Publicar) ou "previa" (deploy sem produção:
 * não mexe no domínio nem no endereço principal do projeto).
 */
export async function publicarArquivos(api: ApiDaVercel, projeto: { id: string; nome: string }, arquivos: ArquivoDoBuild[], op: { alvo?: "producao" | "previa"; meta?: Record<string, string> } = {}): Promise<{ id: string; url: string; estado: string }> {
  for (const a of arquivos) {
    await api("POST", "/v2/files", undefined, { cabecalhos: { "x-vercel-digest": a.sha, "Content-Length": String(a.bytes.length) }, bruto: a.bytes });
  }
  const corpo: Record<string, unknown> = {
    name: projeto.nome,
    project: projeto.id,
    files: arquivos.map((a) => ({ file: a.caminho, sha: a.sha, size: a.bytes.length })),
    projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
  };
  if (op.alvo !== "previa") corpo.target = "production";
  if (op.meta) corpo.meta = op.meta;
  const d = await api("POST", "/v13/deployments", corpo);
  return { id: String(d.id), url: `https://${String(d.url || "")}`, estado: String(d.readyState || d.status || "QUEUED") };
}

export async function estadoDoDeploy(api: ApiDaVercel, id: string): Promise<string> {
  const d = await api("GET", `/v13/deployments/${encodeURIComponent(id)}`);
  return String(d.readyState || d.status || "");
}

/** Espera o deploy ficar pronto (site estático: segundos). ERROR ou CANCELED lançam; no prazo, devolve o último estado. */
export async function esperarDeploy(api: ApiDaVercel, id: string, op: { tentativas?: number; esperar?: (ms: number) => Promise<void> } = {}): Promise<string> {
  const esperar = op.esperar || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let estado = "";
  for (let i = 0; i < (op.tentativas ?? 45); i++) {
    estado = await estadoDoDeploy(api, id);
    if (estado === "READY") return estado;
    if (estado === "ERROR" || estado === "CANCELED") throw new ErroDaVercel(409, `deploy_${estado.toLowerCase()}`, `O deploy terminou como ${estado}.`);
    await esperar(2000);
  }
  return estado;
}

/** Dá ao deploy um endereço fixo (ex.: site-x-v1a2b3c4.vercel.app). */
export async function apelidar(api: ApiDaVercel, deployId: string, alias: string): Promise<string> {
  const r = await api("POST", `/v2/deployments/${encodeURIComponent(deployId)}/aliases`, { alias });
  return String(r.alias || alias);
}

/** Os endereços que apontam para um deploy (o da produção: o .vercel.app do projeto e os domínios). */
export async function apelidosDoDeploy(api: ApiDaVercel, deployId: string): Promise<Array<{ uid: string; alias: string }>> {
  const r = await api("GET", `/v2/deployments/${encodeURIComponent(deployId)}/aliases`);
  const lista = Array.isArray(r.aliases) ? (r.aliases as Array<Record<string, unknown>>) : [];
  return lista.map((a) => ({ uid: String(a.uid || a.alias || ""), alias: String(a.alias || "") })).filter((a) => a.uid && a.alias);
}

/** Tirar do ar: remove os endereços do deploy de produção (domínio e .vercel.app). As prévias por versão continuam. */
export async function tirarDoAr(api: ApiDaVercel, deployId: string): Promise<string[]> {
  const removidos: string[] = [];
  for (const a of await apelidosDoDeploy(api, deployId)) {
    try {
      await api("DELETE", `/v2/aliases/${encodeURIComponent(a.uid)}`);
      removidos.push(a.alias);
    } catch (e) {
      if (!(e instanceof ErroDaVercel) || e.status !== 404) throw e;
    }
  }
  return removidos;
}

/** O domínio como está no projeto (verificado e o TXT pedido), ou null se não está nele. */
export async function dominioNoProjeto(api: ApiDaVercel, projetoId: string, dominio: string): Promise<{ verificado: boolean; verification: ConfigDaVercel["verification"] } | null> {
  try {
    const d = await api("GET", `/v9/projects/${encodeURIComponent(projetoId)}/domains/${encodeURIComponent(dominio)}`);
    return { verificado: d.verified === true, verification: (d.verification as ConfigDaVercel["verification"]) || null };
  } catch (e) {
    if (e instanceof ErroDaVercel && e.status === 404) return null;
    throw e;
  }
}

/**
 * Liga o domínio (e o www com redirecionamento para ele). Já ligado neste
 * projeto (409): lê como está. Ligado em outra conta: o erro da Vercel sobe.
 */
export async function ligarDominio(api: ApiDaVercel, projetoId: string, dominio: string, www: string | null): Promise<{ verificado: boolean; verification: ConfigDaVercel["verification"] }> {
  let d: { verificado: boolean; verification: ConfigDaVercel["verification"] };
  try {
    const r = await api("POST", `/v10/projects/${encodeURIComponent(projetoId)}/domains`, { name: dominio });
    d = { verificado: r.verified === true, verification: (r.verification as ConfigDaVercel["verification"]) || null };
  } catch (e) {
    if (!(e instanceof ErroDaVercel) || e.status !== 409) throw e;
    const atual = await dominioNoProjeto(api, projetoId, dominio);
    if (!atual) throw e;
    d = atual;
  }
  if (www) {
    try {
      await api("POST", `/v10/projects/${encodeURIComponent(projetoId)}/domains`, { name: www, redirect: dominio });
    } catch (e) {
      if (!(e instanceof ErroDaVercel) || e.status !== 409) throw e;
    }
  }
  return d;
}

/** O www do domínio (o próprio www não ganha outro). */
export const wwwDe = (dominio: string) => (dominio.indexOf("www.") === 0 ? null : `www.${dominio}`);

/** O que o cliente precisa criar e se o DNS já está certo (misconfigured=false). */
export async function configDoDominio(api: ApiDaVercel, dominio: string, projeto: string): Promise<ConfigDaVercel> {
  const c = await api("GET", `/v6/domains/${encodeURIComponent(dominio)}/config?projectIdOrName=${encodeURIComponent(projeto)}`);
  return {
    recommendedIPv4: (c.recommendedIPv4 as ConfigDaVercel["recommendedIPv4"]) || null,
    recommendedCNAME: (c.recommendedCNAME as ConfigDaVercel["recommendedCNAME"]) || null,
    misconfigured: c.misconfigured === true ? true : c.misconfigured === false ? false : undefined,
  };
}

export async function verificarDominio(api: ApiDaVercel, projetoId: string, dominio: string): Promise<{ verificado: boolean; verification: ConfigDaVercel["verification"] }> {
  const d = await api("POST", `/v9/projects/${encodeURIComponent(projetoId)}/domains/${encodeURIComponent(dominio)}/verify`);
  return { verificado: d.verified === true, verification: (d.verification as ConfigDaVercel["verification"]) || null };
}

/** O que falta para publicar pelo painel (a tela explica isso ao lado do "Baixar o site"). */
export function faltasParaPublicar(c: { vercelLigada: boolean; temBuild: boolean; dominio: string | null }): string[] {
  const f: string[] = [];
  if (!c.vercelLigada) f.push("a conta Vercel da agência (chave VERCEL_TOKEN no cofre do servidor e no worker)");
  if (!c.temBuild) f.push("um site construído e revisado");
  if (!c.dominio) f.push("o domínio do cliente");
  return f;
}
