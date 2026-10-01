/**
 * Publicação do site na Vercel (frente SIT, 30/09/2026), a partir de
 * plano/p4-motores.md §3. PREPARADA E DESLIGADA: só funciona com a chave
 * VERCEL_TOKEN (e VERCEL_TEAM_ID, se a conta for de time) no cofre do servidor
 * e no ambiente do worker. Sem a chave, a tela oferece "Baixar o site (zip)".
 *
 * O deploy (subir os arquivos do build) roda no worker, onde o build está; a
 * função mesa-site só lê o estado do domínio (config e verify). Publicar é
 * sempre com Confirmar na tela.
 *
 * Sem Deno e sem npm: o `fetch` chega por parâmetro (worker em Node 24,
 * função em Deno e testes com fetch falso).
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
      throw new ErroDaVercel(r.status, String(e.code || `vercel_${r.status}`), String(e.message || `A Vercel respondeu ${r.status}.`).slice(0, 300));
    }
    return json;
  };
}

/** Cria o projeto (sem framework: o build já sai pronto do worker) ou lê o que já existe com o nome. */
export async function garantirProjeto(api: ApiDaVercel, nome: string): Promise<{ id: string; nome: string }> {
  try {
    const p = await api("POST", "/v11/projects", { name: nome, framework: null });
    return { id: String(p.id), nome: String(p.name || nome) };
  } catch (e) {
    if (!(e instanceof ErroDaVercel) || e.status !== 409) throw e;
    const p = await api("GET", `/v9/projects/${encodeURIComponent(nome)}`);
    return { id: String(p.id), nome: String(p.name || nome) };
  }
}

export type ArquivoDoBuild = { caminho: string; bytes: Uint8Array; sha: string };

/** Sobe cada arquivo pelo SHA1 (a Vercel ignora o que já tem) e cria o deploy de produção. */
export async function publicarArquivos(api: ApiDaVercel, projeto: { id: string; nome: string }, arquivos: ArquivoDoBuild[]): Promise<{ id: string; url: string; estado: string }> {
  for (const a of arquivos) {
    await api("POST", "/v2/files", undefined, { cabecalhos: { "x-vercel-digest": a.sha, "Content-Length": String(a.bytes.length) }, bruto: a.bytes });
  }
  const d = await api("POST", "/v13/deployments", {
    name: projeto.nome,
    project: projeto.id,
    target: "production",
    files: arquivos.map((a) => ({ file: a.caminho, sha: a.sha, size: a.bytes.length })),
    projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
  });
  return { id: String(d.id), url: `https://${String(d.url || "")}`, estado: String(d.readyState || d.status || "QUEUED") };
}

export async function estadoDoDeploy(api: ApiDaVercel, id: string): Promise<string> {
  const d = await api("GET", `/v13/deployments/${encodeURIComponent(id)}`);
  return String(d.readyState || d.status || "");
}

/** Liga o domínio (e o www com redirecionamento para ele). */
export async function ligarDominio(api: ApiDaVercel, projetoId: string, dominio: string, www: string | null): Promise<{ verificado: boolean; verification: ConfigDaVercel["verification"] }> {
  const d = await api("POST", `/v10/projects/${encodeURIComponent(projetoId)}/domains`, { name: dominio });
  if (www) {
    try {
      await api("POST", `/v10/projects/${encodeURIComponent(projetoId)}/domains`, { name: www, redirect: dominio });
    } catch (e) {
      if (!(e instanceof ErroDaVercel) || e.status !== 409) throw e;
    }
  }
  return { verificado: d.verified === true, verification: (d.verification as ConfigDaVercel["verification"]) || null };
}

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
