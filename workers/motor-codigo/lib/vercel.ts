/**
 * O dist/ do site na Vercel da agência (20/10/2026): a prévia na nuvem de
 * cada versão salva (e do rascunho, quando pedido) e a publicação. Um
 * projeto Vercel por site; as páginas são caminhos do mesmo deploy.
 *
 * O token vem só de process.env.VERCEL_TOKEN (o supervisor "Aceleriq
 * Motores" repassa do cofre) e só vai no cabeçalho da API: nunca em evento,
 * resultado, erro ou log.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { apelidar, type ApiDaVercel, type ArquivoDoBuild, criarApiDaVercel, ErroDaVercel, esperarDeploy, garantirProjeto, ligarDominio, publicarArquivos, vercelLigada, wwwDe } from "../../../supabase/functions/mesa-site/modulos/publicacao-vercel.ts";
import { apelidoDaPrevia, type MapaDeArquivos, nomeNaVercel, paginasDosArquivos, type PreviaNaNuvem } from "../../../supabase/functions/mesa-site/modulos/publicacao-nuvem.ts";

/** As páginas em /pagina/ (o pré-render grava dist/<slug>/index.html): a Vercel serve com a barra no fim. */
export const VERCEL_JSON = JSON.stringify({ trailingSlash: true }, null, 2) + "\n";

const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest("hex");

/** Os arquivos do dist/ (com o vercel.json da casa, se o site não tiver um). */
export function arquivosDoDist(pasta: string): ArquivoDoBuild[] {
  const dist = join(pasta, "dist");
  const arquivos: ArquivoDoBuild[] = [];
  (function andar(d: string) {
    for (const n of readdirSync(d)) {
      const c = join(d, n);
      if (statSync(c).isDirectory()) andar(c);
      else {
        const bytes = new Uint8Array(readFileSync(c));
        arquivos.push({ caminho: relative(dist, c).split(sep).join("/"), bytes, sha: sha1(bytes) });
      }
    }
  })(dist);
  if (!arquivos.some((a) => a.caminho === "vercel.json")) {
    const bytes = new Uint8Array(Buffer.from(VERCEL_JSON, "utf8"));
    arquivos.push({ caminho: "vercel.json", bytes, sha: sha1(bytes) });
  }
  return arquivos.sort((a, b) => (a.caminho < b.caminho ? -1 : 1));
}

export const mapaDosArquivos = (arquivos: ArquivoDoBuild[]): MapaDeArquivos => {
  const m: MapaDeArquivos = {};
  for (const a of arquivos) if (a.caminho !== "vercel.json") m[a.caminho] = a.sha;
  return m;
};

/** A API com a chave do ambiente (null sem a chave). Testes passam o fetch falso. */
export function apiDoAmbiente(f: typeof fetch = fetch): ApiDaVercel | null {
  const token = process.env.VERCEL_TOKEN || "";
  if (!vercelLigada(token)) return null;
  return criarApiDaVercel({ token: token.trim(), teamId: (process.env.VERCEL_TEAM_ID || "").trim() || null, fetch: f });
}

export const SEM_CHAVE_NO_WORKER = "a chave VERCEL_TOKEN não está no worker desta máquina";

/** Mensagem curta do erro (a da Vercel já sai sem o token). */
export const erroDaVercelEmTexto = (e: unknown) => (e instanceof ErroDaVercel ? `a Vercel respondeu ${e.status} (${e.codigo}): ${e.message}` : e instanceof Error ? e.message : "erro").slice(0, 300);

/**
 * Prévia na nuvem: deploy SEM produção do dist/ no projeto do site e um
 * endereço fixo por commit. Se o apelido não sair, o link do próprio deploy
 * vale (a Vercel guarda a prévia por 180 dias no Pro, e mais com apelido).
 */
export async function previaNaVercel(api: ApiDaVercel, c: { projeto: string; commit: string; ramo: "main" | "rascunho"; arquivos: ArquivoDoBuild[]; agora?: () => string; esperar?: (ms: number) => Promise<void> }): Promise<PreviaNaNuvem & { aviso: string | null }> {
  const projeto = await garantirProjeto(api, nomeNaVercel(c.projeto), { semProtecao: true });
  const deploy = await publicarArquivos(api, projeto, c.arquivos, { alvo: "previa", meta: { aceleriq_commit: c.commit.slice(0, 40), aceleriq_ramo: c.ramo } });
  const estado = await esperarDeploy(api, deploy.id, { esperar: c.esperar });
  let url = deploy.url;
  let aviso: string | null = estado === "READY" ? null : `o deploy da prévia ainda estava em ${estado || "fila"} quando o motor seguiu`;
  if (estado === "READY") {
    try {
      url = `https://${await apelidar(api, deploy.id, apelidoDaPrevia(projeto.nome, c.commit))}`;
    } catch (e) {
      aviso = `o endereço fixo da prévia não saiu (${erroDaVercelEmTexto(e)}); vale o link do deploy`;
    }
  }
  if (projeto.protecao === "ligada") aviso = `${aviso ? `${aviso}; ` : ""}a Vercel não deixou tirar o login das prévias: o link pede conta na Vercel`;
  const arquivos = mapaDosArquivos(c.arquivos);
  return {
    url,
    deploy_id: deploy.id,
    projeto_vercel: projeto.id,
    commit: c.commit,
    ramo: c.ramo,
    paginas: paginasDosArquivos(arquivos),
    arquivos,
    em: c.agora ? c.agora() : new Date().toISOString(),
    protecao: projeto.protecao || null,
    aviso,
  };
}

/** Publicar: deploy de PRODUÇÃO do dist/ e o domínio do cliente (com o www) no projeto do site. */
export async function producaoNaVercel(api: ApiDaVercel, c: { projeto: string; commit: string; arquivos: ArquivoDoBuild[]; dominio: string | null; esperar?: (ms: number) => Promise<void> }) {
  const projeto = await garantirProjeto(api, nomeNaVercel(c.projeto), { semProtecao: true });
  const deploy = await publicarArquivos(api, projeto, c.arquivos, { meta: { aceleriq_commit: c.commit.slice(0, 40) } });
  const estado = await esperarDeploy(api, deploy.id, { esperar: c.esperar });
  let verificacao: unknown = null;
  let verificado = false;
  if (c.dominio) {
    const d = await ligarDominio(api, projeto.id, c.dominio, wwwDe(c.dominio));
    verificacao = d.verification;
    verificado = d.verificado;
  }
  const arquivos = mapaDosArquivos(c.arquivos);
  return { projeto_vercel: projeto.id, deploy_url: deploy.url, deploy_id: deploy.id, estado, dominio: c.dominio, verificacao, verificado, commit: c.commit, paginas: paginasDosArquivos(arquivos), arquivos };
}
