import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Frente SPV (revisão de 30/09): o worker do motor rodando de verdade, com a
 * fila em arquivos (filaLocal) e o git de verdade. Só o que sai da máquina
 * fica falso: o opencode (a passada escreve a seção como o agente faria), o
 * npm (install e build) e a revisão de UX.
 *  - "conteudo": pacote, marca.css e ponte no projeto, um commit, sem modelo,
 *    sem build e sem zip;
 *  - "construir" de 2 seções: o andamento (secao_atual e secoes) é gravado a
 *    cada seção, para a prévia marcar construindo, pronta e na fila.
 */

const estado = vi.hoisted(() => ({ pasta: "" }));

vi.mock("../../workers/motor-codigo/lib/opencode.ts", () => ({
  subirOpencode: vi.fn(async (pasta: string) => {
    estado.pasta = pasta;
    return { modo: "nativo", limpos: [], fechar: () => undefined };
  }),
  rodarPassada: vi.fn(async (_s: unknown, p: { titulo: string }) => {
    // A passada do agente: escreve a seção pedida (o motor faz o commit e o build).
    const secao = p.titulo.split(" ")[1];
    const { mkdirSync: mk, writeFileSync: escrever } = await import("node:fs");
    const { join: juntar } = await import("node:path");
    mk(juntar(estado.pasta, "src", "secoes"), { recursive: true });
    escrever(juntar(estado.pasta, "src", "secoes", `${secao}.tsx`), `export default function S() { return <section data-secao="${secao}">${secao}</section>; }\n`);
    return { ok: true, motivo: "feito", erro: null, custo: { custo_usd: 0.01, tokens_entrada: 100, tokens_saida: 50, tokens_cache: 0 }, resposta: "", marcas: (await import("../../workers/motor-codigo/lib/marcas-da-resposta")).lerMarcasDaResposta(""), sessao: "s" };
  }),
}));
vi.mock("../../workers/motor-codigo/lib/projeto.ts", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  instalarSePrecisar: vi.fn(async () => null),
  construirSite: vi.fn(async (pasta: string) => {
    const { mkdirSync: mk, writeFileSync: escrever } = await import("node:fs");
    const { join: juntar } = await import("node:path");
    mk(juntar(pasta, "dist"), { recursive: true });
    escrever(juntar(pasta, "dist", "index.html"), '<!doctype html><html lang="pt-BR"><head><title>Landing</title><meta name="description" content="d"><meta name="viewport" content="width=device-width"></head><body><main><h1>Landing</h1></main></body></html>');
    return { ok: true, log: "" };
  }),
}));
vi.mock("../../workers/motor-codigo/lib/design-system.ts", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  prepararDesignSystem: vi.fn(async () => ({ acao: "manter", ok: true, consulta: "", master: null, motivo: null, evento: null })),
}));
vi.mock("../../workers/motor-codigo/lib/revisao-ux.ts", () => ({ revisaoDeUx: vi.fn(async () => ({ avisos: [], paginas: ["index"], agente: null })) }));
// A frente MTR faz o worker falhar logo sem a chave do provedor; aqui o worker simulado tem a chave.
vi.stubEnv("ANTHROPIC_API_KEY", "chave-de-teste");

import { executarTrabalho } from "../../workers/motor-codigo/lib/executar";
import { filaLocal, type LinhaDaFila } from "../../workers/motor-codigo/lib/fila";

const raiz = mkdtempSync(join(tmpdir(), "spv-worker-"));
afterAll(() => {
  try {
    rmSync(raiz, { recursive: true, force: true });
  } catch {
    /* o Windows segura o .git por um instante: a pasta temporária fica */
  }
});

const PROJETO = "landing-33333333";
const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const pastaDoProjeto = join(raiz, "projetos", PROJETO);
const cfg = { pastaProjetos: join(raiz, "projetos"), prazoPorPassadaMs: 60_000, comPrevia: false };
mkdirSync(cfg.pastaProjetos, { recursive: true });
const fila = filaLocal(join(raiz, "fila"));
// Cada gravação do resultado, na ordem (o andamento por seção).
const resultados: Array<{ id: string; resultado: Record<string, unknown> }> = [];
const atualizarDeVerdade = fila.atualizar.bind(fila);
fila.atualizar = async (id, campos) => {
  if (campos.resultado) resultados.push({ id, resultado: JSON.parse(JSON.stringify(campos.resultado)) });
  return atualizarDeVerdade(id, campos);
};

const pacote = (headline: string) => ({
  cliente: "Landing",
  marca: { nome: "Landing" },
  copy: { conceito: "c", headline, subtitulo: "Sub", cta: "Pedir", secoes: [{ id: "hero", titulo: "Abertura", texto: "T", itens: [] }], faq: [{ pergunta: "P?", resposta: "R." }], seo: { titulo: "t", descricao: "d", palavras: [] } },
  paleta: [{ hex: "#ff5500", papel: "destaque" }],
  fontes: [{ nome: "Fraunces", papel: "titulo" }],
  dna: null,
  direcao: {},
  imagens: [],
  fotos_reais: [],
  logo: null,
  secoes: ["hero", "faq"],
  arquivos: [],
});

function linha(id: string, tipo: string, pedido: Record<string, unknown>): LinhaDaFila {
  return { id, client_id: CLIENTE, marca_id: null, mesa: "site", projeto: PROJETO, referencia_tipo: "site", referencia_id: SITE, tipo, estado: "executando", modelo: null, instrucao: tipo === "conteudo" ? "Edição pela prévia" : "Construir", pedido, teto_usd: tipo === "construir" ? 0.9 : 0, estimativa_usd: 0, custo_usd: 0, criado_por: "u-1" };
}

async function rodar(t: LinhaDaFila) {
  fila.enfileirar({ ...t, estado: "na_fila" });
  const pego = await fila.pegar("teste");
  expect(pego && pego.id).toBe(t.id);
  return await executarTrabalho(pego!, fila, cfg);
}

const gitLog = () => execFileSync("git", ["log", "--format=%s"], { cwd: pastaDoProjeto, encoding: "utf8" }).trim().split("\n");
const zips = () => {
  const d = join(raiz, "fila", "armazem", "mesa");
  if (!existsSync(d)) return [] as string[];
  const achados: string[] = [];
  const andar = (p: string) => readdirSync(p, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? andar(join(p, e.name)) : achados.push(e.name)));
  andar(d);
  return achados;
};

describe("worker do motor: a edição da prévia e o andamento por seção", () => {
  it("'conteudo' antes do primeiro commit cria o projeto e grava pacote, marca e ponte num commit, sem modelo, build ou zip", async () => {
    const r = await rodar(linha("k1", "conteudo", { pacote: pacote("Editado na prévia") }));
    expect(r).toEqual({ estado: "feito", custo: 0 });
    const t = fila.ler("k1");
    expect(t).toMatchObject({ estado: "feito", custo_usd: 0, erro: null });
    expect(t.zip_path).toBeUndefined();
    expect(typeof t.commit).toBe("string");
    expect(JSON.parse(readFileSync(join(pastaDoProjeto, ".aceleriq", "pacote.json"), "utf8"))).toMatchObject({ cliente: "Landing", copy: { headline: "Editado na prévia" } });
    expect(readFileSync(join(pastaDoProjeto, ".aceleriq", "ponte.js"), "utf8")).toContain("__aqPonte");
    expect(readFileSync(join(pastaDoProjeto, "src", "marca.css"), "utf8")).toContain("#ff5500");
    expect(gitLog()[0]).toBe("Edição pela prévia");
    expect(zips()).toEqual([]);
    expect((t.resultado as Record<string, unknown>).secoes).toBeUndefined();
    expect(fila.eventos("k1").map((e) => e.tipo)).toContain("commit");
  }, 180_000);

  it("'construir' de 2 seções grava a seção da vez e as prontas a cada passo; termina com as duas, build e zip", async () => {
    const modelo = { id: "m-1", provedor: "anthropic", modelo_api: "claude-x", preco_entrada_1m: 1, preco_saida_1m: 4, preco_cache_1m: 0.1 };
    const r = await rodar(linha("b1", "construir", { secoes: ["hero", "faq"], modelo, pacote: pacote("Editado na prévia") }));
    expect({ estado: r.estado, erro: fila.ler("b1").erro }).toEqual({ estado: "feito", erro: null });
    const passos = resultados.filter((x) => x.id === "b1").map((x) => x.resultado);
    const andamento = passos.filter((x) => "secao_atual" in x).map((x) => ({ secao_atual: x.secao_atual, secoes: x.secoes }));
    expect(andamento).toEqual([
      { secao_atual: "hero", secoes: [] },
      { secao_atual: null, secoes: ["hero"] },
      { secao_atual: "faq", secoes: ["hero"] },
      { secao_atual: null, secoes: ["hero", "faq"] },
    ]);
    passos.filter((x) => "secao_atual" in x).forEach((x) => expect(x.secoes_pedidas).toEqual(["hero", "faq"]));
    const t = fila.ler("b1");
    expect(t.resultado).toMatchObject({ secoes_pedidas: ["hero", "faq"], secoes: ["hero", "faq"], build: { ok: true } });
    expect(String(t.zip_path)).toMatch(/codigo\/landing-33333333-[0-9a-f]{8}\.zip$/);
    const log = gitLog();
    expect(log[0]).toMatch(/^Seção: /);
    expect(log.filter((s) => /^Seção: /.test(s)).length).toBe(2);
  }, 180_000);

  it("um segundo 'conteudo' com o mesmo pacote não muda nada e diz isso; zip continua só o do construir", async () => {
    const antes = zips().length;
    const r = await rodar(linha("k2", "conteudo", { pacote: pacote("Editado na prévia") }));
    expect(r.estado).toBe("feito");
    expect(fila.eventos("k2").some((e) => e.resumo === "O projeto já estava com esta edição")).toBe(true);
    expect(zips().length).toBe(antes);
    // Texto novo: commit novo, o pacote do projeto muda.
    await rodar(linha("k3", "conteudo", { pacote: pacote("Outra edição") }));
    expect(JSON.parse(readFileSync(join(pastaDoProjeto, ".aceleriq", "pacote.json"), "utf8")).copy.headline).toBe("Outra edição");
    expect(gitLog()[0]).toBe("Edição pela prévia");
    expect(zips().length).toBe(antes);
  }, 180_000);
});
