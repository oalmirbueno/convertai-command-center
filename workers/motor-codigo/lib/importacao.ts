/**
 * Importar site existente no worker (Gravyx, 19/10/2026). O trabalho é do
 * tipo "textos" (máquina, sem IA, sem custo) com `pacote.importacao`:
 *
 * 1. `prepararImportacao` (ANTES do rascunho abrir): baixa o zip que a tela
 *    subiu, abre, e passa pela MESMA análise da tela com o conteúdo de
 *    verdade (segredo, limite, caminho, só estático, framework). Recusou:
 *    o trabalho falha com o motivo e o projeto não muda.
 * 2. `aplicarImportacao` (já no rascunho, origem "importação"): troca os
 *    arquivos do projeto pelos importados (o .git e as dependências ficam),
 *    grava .aceleriq/importado.json (o motor deixa a casca da casa de fora),
 *    o montar.mjs (o build do motor: roda o build original e leva a saída
 *    para dist/), o package.json com o build do motor, .gitignore e AGENTS.md.
 * 3. `instalarImportado`: npm install SEM scripts de instalação (código de
 *    fora não roda na instalação) e a marca de instalado, para o
 *    instalarSePrecisar do motor não instalar de novo com scripts.
 *
 * Depois disso o fluxo é o de sempre: commit, prévia (servidor estático do
 * dist), build, tipos, conferência no navegador e zip.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  agentesDoImportado,
  analisarImportacao,
  type AnaliseDaImportacao,
  type ArquivoDaImportacao,
  ehTexto,
  gitignoreDoImportado,
  LIMITES_DA_IMPORTACAO,
  normalizarCaminho,
  type OrigemDaImportacao,
  packageJsonDoImportado,
  registroDaImportacao,
  type RegistroDaImportacao,
} from "../../../supabase/functions/mesa-site/modulos/importacao-do-site.ts";
import { deszipar } from "./deszipar.ts";
import type { Fila } from "./fila.ts";
import { ambienteSemSegredos } from "./config-opencode.ts";
import { rodar } from "./processos.ts";

export const MONTAR_DO_IMPORTADO = resolve(import.meta.dirname, "importado", "montar.mjs");
const ARQUIVO_DO_REGISTRO = join(".aceleriq", "importado.json");

export type PedidoDeImportacao = { bucket: string; path: string; origem: OrigemDaImportacao; nome: string | null };
export type ImportacaoPronta = { pedido: PedidoDeImportacao; analise: AnaliseDaImportacao; bytes: Map<string, Uint8Array> };

/** O pedido de importação que veio no pacote (null = não é importação). */
export function importacaoDoPedido(v: unknown): PedidoDeImportacao | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const origem = o.origem === "zip" || o.origem === "pasta" || o.origem === "html" ? o.origem : null;
  if (o.bucket !== "mesa" || typeof o.path !== "string" || !/\/site\/importacao\/[a-z0-9-]{8,64}\.zip$/.test(o.path) || !origem) return null;
  return { bucket: "mesa", path: o.path, origem, nome: typeof o.nome === "string" ? o.nome.slice(0, 160) : null };
}

/** O projeto veio de fora (não é do modelo da casa: a casca não entra). */
export const projetoImportado = (pasta: string) => existsSync(join(pasta, ARQUIVO_DO_REGISTRO));

export function lerRegistroDaImportacao(pasta: string): RegistroDaImportacao | null {
  try {
    return JSON.parse(readFileSync(join(pasta, ARQUIVO_DO_REGISTRO), "utf8")) as RegistroDaImportacao;
  } catch {
    return null;
  }
}

const decodificar = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

/** Os arquivos do zip no formato da análise (texto só nos de texto pequenos). */
export function arquivosDoZip(entradas: Array<{ caminho: string; bytes: Uint8Array }>): ArquivoDaImportacao[] {
  return entradas.map((e) => ({
    caminho: e.caminho,
    bytes: e.bytes.length,
    texto: ehTexto(e.caminho.split("\\").join("/")) && e.bytes.length <= LIMITES_DA_IMPORTACAO.textoVarridoBytes ? decodificar.decode(e.bytes) : null,
  }));
}

/** Baixa, abre e confere. Recusa com Error (a mensagem vai para a tela). */
export async function prepararImportacao(fila: Pick<Fila, "baixar">, pedido: PedidoDeImportacao): Promise<ImportacaoPronta> {
  const zip = await fila.baixar(pedido.bucket, pedido.path);
  if (!zip) throw new Error("Importação: o pacote não foi achado no Storage (subiu?)");
  if (zip.length > LIMITES_DA_IMPORTACAO.zipBytes) throw new Error("Importação recusada: o pacote passa de 50 MB");
  let entradas: Array<{ caminho: string; bytes: Uint8Array }>;
  try {
    entradas = deszipar(zip, { arquivoBytes: LIMITES_DA_IMPORTACAO.arquivoBytes, totalBytes: LIMITES_DA_IMPORTACAO.totalBytes * 2, arquivos: LIMITES_DA_IMPORTACAO.arquivos * 3 });
  } catch (e) {
    throw new Error(`Importação recusada: ${e instanceof Error ? e.message : "o zip não abriu"}`);
  }
  // A tela já tirou dependências e cache e montou o zip; aqui a análise roda de novo com o conteúdo de verdade.
  const analise = analisarImportacao(arquivosDoZip(entradas), pedido.origem);
  if (!analise.ok) throw new Error(`Importação recusada: ${analise.motivo}`);
  const bytes = new Map<string, Uint8Array>();
  // HTML único: a análise já chama de index.html, qualquer que seja o nome que veio.
  if (pedido.origem === "html" && entradas.length === 1) bytes.set("index.html", entradas[0].bytes);
  else for (const e of entradas) {
    const c = normalizarCaminho(e.caminho);
    if (!c) continue;
    const semRaiz = analise.raiz && c.indexOf(analise.raiz) === 0 ? c.slice(analise.raiz.length) : c;
    bytes.set(semRaiz, e.bytes);
  }
  return { pedido, analise, bytes };
}

/** Apaga o que o projeto tinha (menos .git e dependências) para receber o importado. */
function limparProjeto(pasta: string) {
  for (const nome of readdirSync(pasta)) {
    if (nome === ".git") continue;
    const caminho = join(pasta, nome);
    if (nome === "node_modules") {
      // A junção para a _base (dependências do modelo) sai; uma pasta própria fica (o install confere).
      if (lstatSync(caminho).isSymbolicLink()) unlinkSync(caminho);
      continue;
    }
    rmSync(caminho, { recursive: true, force: true });
  }
}

/** Escreve o importado no projeto (já no rascunho). Devolve o registro gravado. */
export function aplicarImportacao(pasta: string, pronta: ImportacaoPronta, projeto: string, agora = new Date().toISOString()): RegistroDaImportacao {
  const { analise } = pronta;
  const f = analise.framework;
  if (!f) throw new Error("Importação sem framework detectado");
  limparProjeto(pasta);
  for (const a of analise.arquivos) {
    const conteudo = pronta.bytes.get(a.caminho);
    if (!conteudo) continue;
    const alvo = join(pasta, a.caminho);
    if (!resolve(alvo).startsWith(resolve(pasta))) continue;
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  mkdirSync(join(pasta, ".aceleriq"), { recursive: true });
  const registro = registroDaImportacao(analise, pronta.pedido.origem, agora);
  writeFileSync(join(pasta, ARQUIVO_DO_REGISTRO), `${JSON.stringify(registro, null, 2)}\n`);
  copyFileSync(MONTAR_DO_IMPORTADO, join(pasta, ".aceleriq", "montar.mjs"));
  const pj = join(pasta, "package.json");
  writeFileSync(pj, packageJsonDoImportado(existsSync(pj) ? readFileSync(pj, "utf8") : null, projeto, f));
  const gi = join(pasta, ".gitignore");
  writeFileSync(gi, gitignoreDoImportado(existsSync(gi) ? readFileSync(gi, "utf8") : null));
  if (!existsSync(join(pasta, "AGENTS.md"))) writeFileSync(join(pasta, "AGENTS.md"), agentesDoImportado(f));
  return registro;
}

const PRAZO_DA_INSTALACAO_MS = 25 * 60_000;

/**
 * Dependências do importado: npm install com --ignore-scripts (o código de
 * fora não roda na instalação) e a marca que o instalarSePrecisar do motor lê.
 * Sem dependência nenhuma, nem chama o npm.
 */
export async function instalarImportado(pasta: string): Promise<"sem_dependencias" | "instalado"> {
  const pkg = readFileSync(join(pasta, "package.json"), "utf8");
  const nm = join(pasta, "node_modules");
  if (existsSync(nm) && lstatSync(nm).isSymbolicLink()) unlinkSync(nm);
  let deps = 0;
  try {
    const p = JSON.parse(pkg) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    deps = Object.keys(p.dependencies || {}).length + Object.keys(p.devDependencies || {}).length;
  } catch {
    deps = 0;
  }
  let feito: "sem_dependencias" | "instalado" = "sem_dependencias";
  if (deps > 0) {
    const r = await rodar("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: pasta, prazoMs: PRAZO_DA_INSTALACAO_MS, env: ambienteSemSegredos() });
    if (r.codigo !== 0) throw new Error(`npm install do site importado${r.estourou ? " passou do prazo" : ""}: ${(r.erro || r.saida).trim().slice(-400)}`);
    feito = "instalado";
  }
  mkdirSync(nm, { recursive: true });
  writeFileSync(join(nm, ".instalado"), pkg);
  return feito;
}
