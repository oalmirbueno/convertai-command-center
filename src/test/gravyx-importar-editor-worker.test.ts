// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * O worker do motor de verdade (fila em arquivos e git de verdade) com os
 * dois trabalhos novos de 19/10/2026, os dois do tipo "textos" (máquina, sem
 * IA, sem custo):
 *  - importar: o zip de um site estático vira o projeto NO RASCUNHO, com o
 *    registro da importação e o build do motor (o montar.mjs de verdade
 *    roda); o Salvar grava a versão com origem "importação". Zip com .env é
 *    recusado antes do rascunho abrir.
 *  - editor de código: o Salvar do editor grava no rascunho, recompila e
 *    guarda o zip; com a marca (sha256) velha, recusa e nada muda.
 * Só fica falso o que sai da máquina ou depende de navegador: o build roda o
 * montar.mjs direto (sem npm), a conferência no navegador e a revisão de UX.
 */

// Nenhum trabalho aqui chama o agente (são "textos" e "salvar"): o opencode nem sobe.
vi.mock("../../workers/motor-codigo/lib/opencode.ts", () => ({
  subirOpencode: vi.fn(async () => {
    throw new Error("o agente não roda neste teste");
  }),
  rodarPassada: vi.fn(async () => {
    throw new Error("o agente não roda neste teste");
  }),
}));
vi.mock("../../workers/motor-codigo/lib/projeto.ts", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  instalarSePrecisar: vi.fn(async () => null),
  construirSite: vi.fn(async (pasta: string) => {
    const { execFileSync: rodarNode } = await import("node:child_process");
    const { existsSync: existe } = await import("node:fs");
    const { join: juntar } = await import("node:path");
    // O site importado compila pelo montar.mjs de verdade; o da casa não entra neste teste.
    if (!existe(juntar(pasta, ".aceleriq", "montar.mjs"))) return { ok: false, log: "Error: sem montar.mjs" };
    try {
      rodarNode(process.execPath, [".aceleriq/montar.mjs"], { cwd: pasta, encoding: "utf8" });
      return { ok: true, log: "" };
    } catch (e) {
      return { ok: false, log: String((e as { stderr?: string }).stderr || e) };
    }
  }),
}));
vi.mock("../../workers/motor-codigo/lib/conferencia-no-navegador.ts", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  conferirNoNavegador: vi.fn(async () => ({ estado: "sem_ambiente", motivo: "teste sem navegador", em: "2026-10-19T12:00:00Z", paginas: [], problemas: [], graves: 0, capa: null })),
}));
vi.mock("../../workers/motor-codigo/lib/revisao-ux.ts", () => ({ revisaoDeUx: vi.fn(async () => ({ avisos: [], paginas: ["index"], agente: null })) }));
vi.stubEnv("VERCEL_TOKEN", "");

import { executarTrabalho } from "../../workers/motor-codigo/lib/executar";
import { filaLocal, type LinhaDaFila } from "../../workers/motor-codigo/lib/fila";
import { zipar } from "../../workers/motor-codigo/lib/zip";
import { sha256 } from "../../workers/motor-codigo/lib/edicao-de-codigo";
import { deszipar } from "../../workers/motor-codigo/lib/deszipar";
import { estadoDoRascunho, versoesSalvas } from "../../supabase/functions/mesa-site/modulos/obra-do-site";
import { normalizarTrabalho, type TrabalhoDoMotor } from "../../supabase/functions/_shared/motor-codigo";

const raiz = mkdtempSync(join(tmpdir(), "gravyx-importar-"));
afterAll(() => {
  try {
    rmSync(raiz, { recursive: true, force: true });
  } catch {
    /* o Windows segura o .git por um instante */
  }
});

const PROJETO = "antigo-44444444";
const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "44444444-4444-4444-8444-444444444444";
const pasta = join(raiz, "projetos", PROJETO);
const cfg = { pastaProjetos: join(raiz, "projetos"), prazoPorPassadaMs: 60_000, comPrevia: false };
mkdirSync(cfg.pastaProjetos, { recursive: true });
const fila = filaLocal(join(raiz, "fila"));
const ordem: string[] = [];

function subirZip(nome: string, arquivos: Record<string, string>) {
  const bytes = zipar(Object.keys(arquivos).map((k) => ({ nome: k, bytes: new Uint8Array(Buffer.from(arquivos[k], "utf8")) })));
  const path = `${CLIENTE}/site/importacao/${nome}.zip`;
  const f = join(raiz, "fila", "armazem", "mesa", path);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, bytes);
  return path;
}

function linha(id: string, pedido: Record<string, unknown>, tipo = "textos", instrucao = "Importar"): LinhaDaFila {
  return { id, client_id: CLIENTE, marca_id: null, mesa: "site", projeto: PROJETO, referencia_tipo: "site", referencia_id: SITE, tipo, estado: "executando", modelo: null, instrucao, pedido, teto_usd: 0, estimativa_usd: 0, custo_usd: 0, criado_por: "u-1" };
}

async function rodar(t: LinhaDaFila) {
  fila.enfileirar({ ...t, estado: "na_fila" });
  const pego = await fila.pegar("teste");
  expect(pego && pego.id).toBe(t.id);
  ordem.unshift(t.id);
  return await executarTrabalho(pego!, fila, cfg);
}

/** Os trabalhos como a tela lê (mais novo primeiro). */
const trabalhos = (): TrabalhoDoMotor[] => ordem.map((id) => normalizarTrabalho({ ...fila.ler(id), criado_em: fila.ler(id).criado_em, terminado_em: fila.ler(id).terminado_em || null })).filter((t): t is TrabalhoDoMotor => !!t);
const ramo = () => execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: pasta, encoding: "utf8" }).trim();
const resultadoDe = (id: string) => fila.ler(id).resultado as Record<string, any>;

const SITE_ANTIGO = {
  "site-antigo/index.html": "<!doctype html><html lang=\"pt-BR\"><head><title>Padaria</title><link rel=\"stylesheet\" href=\"css/estilo.css\"></head><body><main><h1>Pão quente toda hora</h1></main></body></html>\n",
  "site-antigo/css/estilo.css": "h1 { color: #b45309; }\n",
  "site-antigo/node_modules/lixo/index.js": "module.exports = 1;\n",
};

describe("worker: importar site existente e o editor de código", () => {
  it("zip com .env é recusado antes do rascunho: o trabalho falha com o motivo e o projeto segue sem rascunho", async () => {
    const path = subirZip("0a0b0c0d-0000-4000-8000-000000000001", { ...SITE_ANTIGO, "site-antigo/.env": "SEGREDO=1\n" });
    const r = await rodar(linha("imp-0", { pacote: { importacao: { bucket: "mesa", path, origem: "zip", nome: "antigo.zip" } } }));
    expect(r.estado).toBe("falhou");
    expect(String(fila.ler("imp-0").erro)).toMatch(/Importação recusada: .*\.env/);
    expect(ramo()).toBe("main");
    expect(existsSync(join(pasta, ".aceleriq", "importado.json"))).toBe(false);
  }, 180_000);

  it("o site estático vira o projeto no rascunho (origem importação), compila pelo montar.mjs e guarda o zip", async () => {
    const path = subirZip("0a0b0c0d-0000-4000-8000-000000000002", SITE_ANTIGO);
    const r = await rodar(linha("imp-1", { pacote: { importacao: { bucket: "mesa", path, origem: "zip", nome: "antigo.zip" } } }));
    expect({ estado: r.estado, erro: fila.ler("imp-1").erro }).toEqual({ estado: "feito", erro: null });
    expect(ramo()).toBe("rascunho");
    const reg = JSON.parse(readFileSync(join(pasta, ".aceleriq", "importado.json"), "utf8"));
    expect(reg).toMatchObject({ framework: "estatico", build: null, origem: "zip", arquivos: 2 });
    expect(JSON.parse(readFileSync(join(pasta, "package.json"), "utf8")).scripts.build).toBe("node .aceleriq/montar.mjs");
    // A raiz única do zip saiu, a dependência não entrou e a casca da casa não ficou.
    expect(readFileSync(join(pasta, "index.html"), "utf8")).toContain("Pão quente");
    expect(existsSync(join(pasta, "node_modules", "lixo"))).toBe(false);
    expect(existsSync(join(pasta, "src", "App.tsx"))).toBe(false);
    // O build do motor (montar.mjs) deixou o dist com o site.
    expect(readFileSync(join(pasta, "dist", "css", "estilo.css"), "utf8")).toContain("#b45309");
    expect(resultadoDe("imp-1")).toMatchObject({ importacao: { framework: "estatico", origem: "zip" }, build: { ok: true }, ramo: "rascunho" });
    expect(typeof fila.ler("imp-1").zip_path).toBe("string");
    const e = estadoDoRascunho(trabalhos());
    expect({ aberto: e.aberto, trabalhos: e.trabalhos.map((t) => t.id) }).toEqual({ aberto: true, trabalhos: ["imp-1"] });
  }, 180_000);

  it("Salvar versão: a versão sai com origem importação e o descartar não é preciso", async () => {
    const r = await rodar(linha("sv-1", { pacote: {} }, "salvar", "Salvar a versão"));
    expect(r.estado).toBe("feito");
    expect(ramo()).toBe("main");
    const v = versoesSalvas(trabalhos());
    expect(v[0]).toMatchObject({ origem: "importacao", trabalhos: ["imp-1"] });
    expect(estadoDoRascunho(trabalhos()).aberto).toBe(false);
  }, 180_000);

  it("editor: o Salvar grava no rascunho sem IA, recompila e guarda o zip com o arquivo novo", async () => {
    const antes = readFileSync(join(pasta, "css", "estilo.css"));
    const novo = "h1 { color: #166534; }\n";
    const r = await rodar(linha("ed-1", { pacote: { edicao_de_codigo: { arquivos: [{ caminho: "css/estilo.css", conteudo: novo, sha_antes: sha256(antes) }], de: null } } }, "textos", "Editar o código: css/estilo.css"));
    expect({ estado: r.estado, erro: fila.ler("ed-1").erro, custo: r.custo }).toEqual({ estado: "feito", erro: null, custo: 0 });
    expect(ramo()).toBe("rascunho");
    expect(readFileSync(join(pasta, "css", "estilo.css"), "utf8")).toBe(novo);
    expect(readFileSync(join(pasta, "dist", "css", "estilo.css"), "utf8")).toBe(novo);
    expect(resultadoDe("ed-1")).toMatchObject({ edicao_de_codigo: { arquivos: ["css/estilo.css"] }, build: { ok: true } });
    expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: pasta, encoding: "utf8" }).trim()).toBe("Código: css/estilo.css");
    // O zip guardado (o que o editor abre) já tem o arquivo novo, sob a pasta do projeto.
    const zip = readFileSync(join(raiz, "fila", "armazem", "mesa", String(fila.ler("ed-1").zip_path)));
    const css = deszipar(new Uint8Array(zip), { arquivoBytes: 1e7, totalBytes: 1e8, arquivos: 1000 }).find((x) => x.caminho === `${PROJETO}/css/estilo.css`);
    expect(css && Buffer.from(css.bytes).toString("utf8")).toBe(novo);
    expect(estadoDoRascunho(trabalhos()).trabalhos.map((t) => t.id)).toEqual(["ed-1"]);
  }, 180_000);

  it("editor: com a marca velha (o arquivo mudou depois de aberto) recusa e nada muda; arquivo do motor também", async () => {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pasta, encoding: "utf8" }).trim();
    const velho = sha256(Buffer.from("h1 { color: #b45309; }\n", "utf8"));
    const r = await rodar(linha("ed-2", { pacote: { edicao_de_codigo: { arquivos: [{ caminho: "css/estilo.css", conteudo: "h1{}", sha_antes: velho }] } } }, "textos", "Editar o código: css/estilo.css"));
    expect(r.estado).toBe("falhou");
    expect(String(fila.ler("ed-2").erro)).toMatch(/mudou em outra edição/);
    expect(readFileSync(join(pasta, "css", "estilo.css"), "utf8")).toBe("h1 { color: #166534; }\n");
    const r2 = await rodar(linha("ed-3", { pacote: { edicao_de_codigo: { arquivos: [{ caminho: ".aceleriq/importado.json", conteudo: "{}", sha_antes: velho }] } } }, "textos", "Editar"));
    expect(r2.estado).toBe("falhou");
    expect(String(fila.ler("ed-3").erro)).toMatch(/arquivo do motor/);
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: pasta, encoding: "utf8" }).trim()).toBe(commit);
  }, 180_000);
});
