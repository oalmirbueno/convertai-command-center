import { readdirSync, readFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { vercelFalsa } from "./vercel-falsa";

/**
 * Vercel da agência no worker (20/10/2026), rodando o trabalho de verdade
 * (fila em arquivos e git de verdade). Falsos: o opencode, o npm, a revisão
 * de UX, a conferência no navegador, o tsc e a API da Vercel.
 *  - salvar sobe a prévia na nuvem daquela versão e guarda o link no resultado;
 *  - publicar leva só a versão salva pedida e grava o que foi ao ar (páginas e
 *    mapa de arquivos) para a próxima comparação; versão que não é a salva falha;
 *  - prévia pedida sem a chave no worker vira aviso, sem derrubar o trabalho;
 *  - o token não aparece em nenhum arquivo da fila (eventos, resultado, publicação).
 */

const estado = vi.hoisted(() => ({ pasta: "" }));
const TOKEN = vi.hoisted(() => "vcp_tokenfalsodoworker_0123456789abcdef");

vi.mock("../../workers/motor-codigo/lib/opencode.ts", () => ({
  subirOpencode: vi.fn(async (pasta: string) => {
    estado.pasta = pasta;
    return { modo: "nativo", limpos: [], fechar: () => undefined };
  }),
  rodarPassada: vi.fn(async (_s: unknown, p: { titulo: string }) => {
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
    const { mkdirSync: mk, writeFileSync: escrever, existsSync: existe } = await import("node:fs");
    const { join: juntar } = await import("node:path");
    mk(juntar(pasta, "dist", "obrigado"), { recursive: true });
    const secoes = existe(juntar(pasta, "src", "secoes")) ? "com-secoes" : "sem-secoes";
    escrever(juntar(pasta, "dist", "index.html"), `<!doctype html><html lang="pt-BR"><head><title>Café</title><meta name="description" content="d"><meta name="viewport" content="width=device-width"></head><body><main><h1>Café ${secoes}</h1></main></body></html>`);
    escrever(juntar(pasta, "dist", "obrigado", "index.html"), '<!doctype html><html lang="pt-BR"><head><title>Obrigado</title></head><body><main><h1>Obrigado</h1></main></body></html>');
    return { ok: true, log: "" };
  }),
}));
vi.mock("../../workers/motor-codigo/lib/design-system.ts", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  prepararDesignSystem: vi.fn(async () => ({ acao: "manter", ok: true, consulta: "", master: null, motivo: null, evento: null })),
}));
vi.mock("../../workers/motor-codigo/lib/revisao-ux.ts", () => ({ revisaoDeUx: vi.fn(async () => ({ avisos: [], paginas: ["index"], agente: null })) }));
vi.mock("../../workers/motor-codigo/lib/conferencia-no-navegador.ts", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  conferirNoNavegador: vi.fn(async () => ({ estado: "pronto", motivo: null, em: "2026-10-20T10:00:00Z", paginas: ["/", "/obrigado/"], problemas: [], graves: 0, capa: null })),
}));
vi.mock("../../workers/motor-codigo/lib/tipos.ts", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  conferirTipos: vi.fn(async () => ({ rodou: false, ok: true, erros: [], total: 0, motivo: "sem tsc no teste" })),
}));
vi.stubEnv("ANTHROPIC_API_KEY", "chave-de-teste");

import { executarTrabalho } from "../../workers/motor-codigo/lib/executar";
import { filaLocal, type LinhaDaFila } from "../../workers/motor-codigo/lib/fila";

const raiz = mkdtempSync(join(tmpdir(), "vercel-worker-"));
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  try {
    rmSync(raiz, { recursive: true, force: true });
  } catch {
    /* o Windows segura o .git por um instante */
  }
});

const PROJETO = "site-do-cafe-33333333";
const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const cfg = { pastaProjetos: join(raiz, "projetos"), prazoPorPassadaMs: 60_000, comPrevia: false };
mkdirSync(cfg.pastaProjetos, { recursive: true });
const pastaDaFila = join(raiz, "fila");
const fila = filaLocal(pastaDaFila);

const pacote = {
  cliente: "Café",
  marca: { nome: "Café" },
  copy: { conceito: "c", headline: "Café bom", subtitulo: "Sub", cta: "Pedir", secoes: [{ id: "hero", titulo: "Abertura", texto: "T", itens: [] }], faq: [], seo: { titulo: "t", descricao: "d", palavras: [] } },
  paleta: [{ hex: "#ff5500", papel: "destaque" }],
  fontes: [{ nome: "Fraunces", papel: "titulo" }],
  dna: null,
  direcao: {},
  imagens: [],
  fotos_reais: [],
  logo: null,
  secoes: ["hero"],
  arquivos: [],
};
const modelo = { id: "m-1", provedor: "anthropic", modelo_api: "claude-x", preco_entrada_1m: 1, preco_saida_1m: 4, preco_cache_1m: 0.1 };

function linha(id: string, tipo: string, pedido: Record<string, unknown>, instrucao = tipo): LinhaDaFila {
  return { id, client_id: CLIENTE, marca_id: null, mesa: "site", projeto: PROJETO, referencia_tipo: "site", referencia_id: SITE, tipo, estado: "executando", modelo: null, instrucao, pedido, teto_usd: tipo === "construir" ? 0.9 : 0, estimativa_usd: 0, custo_usd: 0, criado_por: "u-1" };
}

async function rodar(t: LinhaDaFila) {
  fila.enfileirar({ ...t, estado: "na_fila" });
  const pego = await fila.pegar("teste");
  expect(pego && pego.id).toBe(t.id);
  return await executarTrabalho(pego!, fila, cfg);
}

const publicacoes = () => readFileSync(join(pastaDaFila, "publicacoes.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const tudoNaFila = () => {
  const textos: string[] = [];
  const andar = (p: string) => readdirSync(p).forEach((n) => (statSync(join(p, n)).isDirectory() ? andar(join(p, n)) : textos.push(readFileSync(join(p, n), "utf8"))));
  andar(pastaDaFila);
  return textos.join("\n");
};

describe("worker: prévia na nuvem por versão e publicação da versão salva", () => {
  const v = vercelFalsa({ token: TOKEN, dominio: "cafe.com.br" });
  let versaoSalva = "";

  it("construir no rascunho e salvar: a versão salva sobe a prévia na nuvem e guarda o link e as páginas", async () => {
    vi.stubEnv("VERCEL_TOKEN", TOKEN);
    vi.stubGlobal("fetch", v.fetch);
    expect((await rodar(linha("c1", "construir", { secoes: ["hero"], modelo, pacote }, "Construir hero"))).estado).toBe("feito");
    expect((fila.ler("c1").resultado as Record<string, unknown>).previa_nuvem).toBeUndefined();
    expect(v.chamadas).toHaveLength(0);
    expect((await rodar(linha("s1", "salvar", { pacote: {} }))).estado).toBe("feito");
    const t = fila.ler("s1");
    const r = t.resultado as Record<string, any>;
    versaoSalva = String(t.commit);
    expect(r.versao.commit).toBe(versaoSalva);
    expect(r.previa_nuvem).toMatchObject({ url: `https://${PROJETO}-v${versaoSalva.slice(0, 8)}.vercel.app`, commit: versaoSalva, ramo: "main", paginas: ["/", "/obrigado/"], projeto_vercel: "prj_1" });
    expect(Object.keys(r.previa_nuvem.arquivos)).toEqual(["index.html", "obrigado/index.html"]);
    expect(JSON.parse(v.de("POST", "/v13/deployments")[0].corpo).target).toBeUndefined();
    expect(fila.eventos("s1").some((e) => /Prévia na nuvem: https:/.test(e.resumo))).toBe(true);
  }, 180_000);

  it("publicar com a versão salva: deploy de produção, domínio e o que foi ao ar gravado para a próxima comparação", async () => {
    const r = await rodar(linha("p1", "publicar", { pacote: { ...pacote, dominio: "cafe.com.br", versao: versaoSalva } }, "Publicar em cafe.com.br"));
    expect({ estado: r.estado, erro: fila.ler("p1").erro }).toEqual({ estado: "feito", erro: null });
    const prod = v.de("POST", "/v13/deployments").map((c) => JSON.parse(c.corpo)).filter((c) => c.target === "production");
    expect(prod).toHaveLength(1);
    const pub = publicacoes()[0];
    expect(pub).toMatchObject({ site_id: SITE, projeto_vercel: "prj_1", deploy_id: "dpl_2", versao: versaoSalva, paginas: ["/", "/obrigado/"], no_ar: true, tirado_em: null });
    expect(Object.keys(pub.arquivos)).toEqual(["index.html", "obrigado/index.html"]);
    // O pacote.json do site não leva a versão nem a marca da prévia.
    const pacoteNoProjeto = JSON.parse(readFileSync(join(cfg.pastaProjetos, PROJETO, ".aceleriq", "pacote.json"), "utf8"));
    expect(pacoteNoProjeto.versao).toBeUndefined();
    expect(pacoteNoProjeto.dominio).toBe("cafe.com.br");
  }, 180_000);

  it("publicar uma versão que não é a salva falha antes de qualquer deploy", async () => {
    const antes = v.chamadas.length;
    const r = await rodar(linha("p2", "publicar", { pacote: { ...pacote, dominio: "cafe.com.br", versao: "deadbeefdeadbeef" } }));
    expect(r.estado).toBe("falhou");
    expect(String(fila.ler("p2").erro)).toMatch(/não é a versão salva/);
    expect(v.chamadas.length).toBe(antes);
  }, 180_000);

  it("prévia pedida sem a chave no worker: aviso no trabalho, que termina feito", async () => {
    vi.stubEnv("VERCEL_TOKEN", "");
    const r = await rodar(linha("r1", "revisar", { pacote: { previa_nuvem: true } }, "Prévia na nuvem"));
    expect(r.estado).toBe("feito");
    expect((fila.ler("r1").resultado as Record<string, unknown>).previa_nuvem_erro).toMatch(/VERCEL_TOKEN/);
    expect(fila.eventos("r1").some((e) => e.tipo === "aviso" && /Prévia na nuvem desligada/.test(e.resumo))).toBe(true);
    const pacoteNoProjeto = JSON.parse(readFileSync(join(cfg.pastaProjetos, PROJETO, ".aceleriq", "pacote.json"), "utf8"));
    expect(pacoteNoProjeto.previa_nuvem).toBeUndefined();
  }, 180_000);

  it("o token não aparece em nenhum arquivo da fila nem em URL da API", () => {
    expect(tudoNaFila()).not.toContain(TOKEN);
    expect(v.chamadas.every((c) => c.url.indexOf(TOKEN) < 0 && c.corpo.indexOf(TOKEN) < 0)).toBe(true);
  });
});
