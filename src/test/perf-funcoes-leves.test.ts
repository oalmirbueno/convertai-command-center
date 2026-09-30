import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORIGINAIS, WASM } from "../../scripts/gerar-imagescript-vendor.mjs";
import { PREFLIGHT_CACHE } from "../../supabase/functions/_shared/cors";
import { leituraGravadaRecente } from "../../supabase/functions/mesa-ads/guarda-do-gerenciador";
import {
  CODIGO_DO_RECORTE_OU_AREA,
  comRecusaNosIrmaos,
  comResultadoDoItem,
  ehArquivoJpeg,
  FRASE_DO_RECORTE_OU_AREA,
  lerFoco,
  montarPacote,
  normalizarGeracoesDoDiretor,
  pedeNovoCenario,
  pedidoDoItem,
  type EntradaDoPacote,
} from "../../supabase/functions/mesa-foto/diretor-agentico";
import { executarItemAItem, type ItemDaAcaoDoAgente } from "../../supabase/functions/_shared/acoes-do-agente";

/**
 * Frente PERF-funcoes (30/09/2026): as Edge Functions sobem e respondem mais
 * rápido sem mudar o que devolvem.
 * - FN-01: nenhuma função chamada pela tela carrega o imagescript na partida.
 * - FN-08: o imagescript é a cópia local (sem baixar 7 .wasm de deno.land).
 * - FN-02: o navegador guarda o pré-voo CORS (Access-Control-Max-Age).
 * - FN-04, FN-05, FN-06, FN-09, FN-10, FN-11, FN-12, FN-13: guardas no banco,
 *   recusa que não se repete, fôlego, erro no log, 3 chamadas ao GitHub, cron
 *   só com trabalho, ping sem banco e prazo no TypeSafe.
 */

const RAIZ = resolve(__dirname, "../..");
const FUNCOES = join(RAIZ, "supabase", "functions");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");

// ------------------------------------------------------------------ grafo de imports estáticos

/** Specifiers importados de forma estática (ignora `import type`, `export type` e import dinâmico). */
function importsEstaticos(fonte: string): string[] {
  const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const saida: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(semComentario))) {
    const clausula = m[2].trim();
    if (/^type\s/.test(clausula)) continue;
    const chaves = /^\{([\s\S]*)\}$/.exec(clausula);
    if (chaves) {
      const partes = chaves[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (partes.length && partes.every((p) => /^type\s/.test(p))) continue;
    }
    saida.push(m[3]);
  }
  // import "x"; (efeito colateral)
  const soEfeito = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  while ((m = soEfeito.exec(semComentario))) saida.push(m[1]);
  return saida;
}

function caminhoAte(arquivo: string, alvo: (spec: string) => boolean, visitados = new Set<string>()): string[] | null {
  if (visitados.has(arquivo)) return null;
  visitados.add(arquivo);
  if (!existsSync(arquivo)) return null;
  for (const spec of importsEstaticos(readFileSync(arquivo, "utf8"))) {
    if (alvo(spec)) return [relative(FUNCOES, arquivo), spec];
    if (!spec.startsWith(".")) continue;
    const r = caminhoAte(resolve(dirname(arquivo), spec), alvo, visitados);
    if (r) return [relative(FUNCOES, arquivo)].concat(r);
  }
  return null;
}

const ehImagescript = (spec: string) => /imagescript/i.test(spec);
const funcoes = readdirSync(FUNCOES).filter((d) => !d.startsWith("_") && existsSync(join(FUNCOES, d, "index.ts")));

describe("FN-01: nenhuma função sobe carregando o imagescript", () => {
  it("só a copias-leves (que sempre abre imagem) alcança o imagescript por import estático", () => {
    const alcancam = funcoes
      .map((f) => ({ f, caminho: caminhoAte(join(FUNCOES, f, "index.ts"), ehImagescript) }))
      .filter((x) => x.caminho)
      .map((x) => `${x.f}: ${(x.caminho as string[]).join(" -> ")}`);
    expect(alcancam).toEqual([expect.stringMatching(/^copias-leves: /)]);
  });

  it("as funções que liam só o cabeçalho continuam no ar e usam o módulo sem pixel", () => {
    for (const f of ["estudio-arte", "mesa-foto", "agente-contexto", "agente-calendario", "perfis-instagram", "mesa-videos", "mesa-ads", "documentos", "workspace-organizar"]) {
      expect(funcoes, f).toContain(f);
    }
    expect(importsEstaticos(ler("supabase/functions/_shared/imagem-cabecalho.ts"))).toEqual([]);
    const sob = ler("supabase/functions/_shared/imagem-sob-demanda.ts");
    expect(importsEstaticos(sob).sort()).toEqual(["./falha-registrada.ts", "./imagem-cabecalho.ts"]);
    expect(sob).toContain('import("./imagem-local.ts")');
    expect(sob).toContain('import("./imagescript.ts")');
    // imagem-local segue exportando o que se movia (quem importava de lá segue igual).
    const local = ler("supabase/functions/_shared/imagem-local.ts");
    for (const nome of ["dimensoesDoCabecalho", "mimeDaImagem", "caixaNoQuadroCentral", "ampliar", "normalizarAreas", "uniaoDasAreas", "tamanhoDoTrecho", "LARGURA_LAMINA", "ALTURA_LAMINA", "IDENTIDADE"]) {
      expect(local, nome).toMatch(new RegExp(`export \\{[^}]*\\b${nome}\\b[^}]*\\} from "\\./imagem-cabecalho\\.ts"`));
    }
  });

  it("as contas sem pixel dão o mesmo resultado de antes", async () => {
    const c = await import("../../supabase/functions/_shared/imagem-cabecalho");
    const png = new Uint8Array(40);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 1200);
    new DataView(png.buffer).setUint32(20, 900);
    expect(c.dimensoesDoCabecalho(png)).toEqual({ largura: 1200, altura: 900 });
    expect(c.mimeDaImagem(png)).toBe("image/png");
    expect(c.tamanhoDoTrecho(3)).toBe("3264x1360");
    const a = c.ampliar({ x0: 0.01, y0: 0.5, x1: 0.99, y1: 0.6 }, 0.03);
    expect([a.x0, a.x1]).toEqual([0, 1]);
    expect(a.y0).toBeCloseTo(0.47, 10);
    expect(a.y1).toBeCloseTo(0.63, 10);
    const q = c.caixaNoQuadroCentral({ x0: 0, y0: 0, x1: 1, y1: 1 }, 1024, 1536, 0.8);
    expect([q.x0, q.x1]).toEqual([0, 1]);
    expect(q.y0).toBeCloseTo(1 / 12, 10);
    expect(q.y1).toBeCloseTo(11 / 12, 10);
    expect(c.caixaNoQuadroCentral({ x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 }, 1088, 1360, 0.8)).toEqual({ x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 });
    expect(c.normalizarAreas([{ x0: 0.9, x1: 0.1, y0: 0.2, y1: 0.8 }, { x0: 0, x1: 0.01, y0: 0, y1: 1 }])).toEqual([{ x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }]);
    expect(c.uniaoDasAreas([{ x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 }, { x0: 0.5, y0: 0.1, x1: 0.6, y1: 0.9 }])).toEqual({ x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.9 });
  });
});

// ------------------------------------------------------------------ FN-08

describe("FN-08: imagescript local, sem downloads", () => {
  const VENDOR = "supabase/functions/copias-leves/modulos/imagescript";

  it("nenhuma função importa o imagescript de deno.land", () => {
    const achados: string[] = [];
    const andar = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (relative(FUNCOES, p).replace(/\\/g, "/") !== "copias-leves/modulos/imagescript") andar(p);
        } else if (/\.(ts|js|mjs)$/.test(e.name) && readFileSync(p, "utf8").indexOf("deno.land/x/imagescript") >= 0) {
          achados.push(relative(FUNCOES, p));
        }
      }
    };
    andar(FUNCOES);
    expect(achados).toEqual([]);
  });

  it("o JS copiado é o original byte a byte e os .wasm embutidos batem com o SHA-256 oficial", () => {
    const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");
    for (const [rel, esperado] of Object.entries(ORIGINAIS as Record<string, string | null>)) {
      if (!esperado || /^utils\/wasm\/\w+\.(js|wasm)$/.test(rel)) continue;
      expect(sha(readFileSync(join(RAIZ, VENDOR, rel))), rel).toBe(esperado);
    }
    for (const nome of WASM as string[]) {
      const modulo = readFileSync(join(RAIZ, VENDOR, "utils", "wasm", `${nome}.wasm.js`), "utf8");
      const b64 = /const B64 = "([A-Za-z0-9+/=]+)";/.exec(modulo);
      expect(b64, nome).not.toBeNull();
      expect(sha(Buffer.from((b64 as RegExpExecArray)[1], "base64")), nome).toBe((ORIGINAIS as Record<string, string>)[`utils/wasm/${nome}.wasm`]);
      const carregador = readFileSync(join(RAIZ, VENDOR, "utils", "wasm", `${nome}.js`), "utf8");
      expect(carregador, nome).not.toMatch(/fetch\(|Deno\.readFile|import\.meta\.url/);
      expect(carregador, nome).toContain(`import { bytesDoWasm } from './${nome}.wasm.js';`);
      expect(carregador, nome).toContain("new WebAssembly.Instance(wasm_mod ??= new WebAssembly.Module(bytesDoWasm())");
    }
    expect(ler(`${VENDOR}/LICENSE.MIT`)).toContain("Permission is hereby granted, free of charge");
    expect(ler("supabase/functions/_shared/imagescript.ts")).toContain('export * from "../copias-leves/modulos/imagescript/mod.ts";');
  });
});

// ------------------------------------------------------------------ FN-02

describe("FN-02: o navegador guarda o pré-voo", () => {
  it("7200 s, só o cabeçalho de cache (as listas de cada função não mudam)", () => {
    expect(PREFLIGHT_CACHE).toEqual({ "Access-Control-Max-Age": "7200" });
  });

  it("toda função chamada pela tela espalha PREFLIGHT_CACHE no próprio corsHeaders", () => {
    const comLista: Array<[string, string]> = [
      ["estudio-arte/index.ts", "corsHeaders"], ["mesa-foto/index.ts", "corsHeaders"], ["agente-contexto/index.ts", "corsHeaders"],
      ["agente-calendario/index.ts", "corsHeaders"], ["agente-estilo/index.ts", "corsHeaders"], ["mesa-ads/index.ts", "corsHeaders"],
      ["perfis-instagram/index.ts", "corsHeaders"], ["mesa-instagram/index.ts", "corsHeaders"], ["editor-video/index.ts", "corsHeaders"],
      ["documentos/index.ts", "corsHeaders"], ["mesa-identidade/comum.ts", "corsHeaders"], ["mesa-site/index.ts", "corsHeaders"],
      ["mesa-proposta/index.ts", "corsHeaders"], ["mesa-motion/index.ts", "corsHeaders"], ["mesa-videos/index.ts", "corsHeaders"],
      ["mesa-roteiros/index.ts", "corsHeaders"], ["mesa-mockups/index.ts", "corsHeaders"], ["mesa-publicidade/index.ts", "corsHeaders"],
      ["motor-codigo/index.ts", "corsHeaders"], ["preencher-ia/index.ts", "corsHeaders"], ["proposta-biblioteca/index.ts", "corsHeaders"],
      ["ia-gateway/index.ts", "corsHeaders"], ["contract-public/index.ts", "corsHeaders"], ["notify-admin/index.ts", "corsHeaders"],
      ["client-first-access/index.ts", "corsHeaders"], ["submit-quiz/index.ts", "cors"],
    ];
    for (const [arq, nome] of comLista) {
      const f = ler(`supabase/functions/${arq}`);
      const bloco = new RegExp(`const ${nome} = \\{[^}]*\\.\\.\\.PREFLIGHT_CACHE,\\n\\};`).exec(f);
      expect(bloco, arq).not.toBeNull();
      expect(f, arq).toContain('import { PREFLIGHT_CACHE } from "../_shared/cors.ts";');
    }
    for (const arq of ["cycle-client-pulse/index.ts", "journey-narrative/index.ts"]) {
      expect(ler(`supabase/functions/${arq}`), arq).toContain("const corsHeaders = { ...corsDoSupabase, ...PREFLIGHT_CACHE };");
    }
    const pulso = ler("supabase/functions/second-brain-pulse/index.ts");
    expect(pulso).toContain("const cors = { ...corsHeaders, ...PREFLIGHT_CACHE };");
    expect(pulso).toContain("if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });");
    // Quem já tinha o cabeçalho, ou tem lista própria de origem, fica como estava.
    for (const arq of ["site-formulario/index.ts", "social-meta-oauth/index.ts"]) {
      expect(ler(`supabase/functions/${arq}`), arq).not.toContain("PREFLIGHT_CACHE");
    }
  });
});

// ------------------------------------------------------------------ FN-04

type Linha = { lido_em: string; forcada: boolean; client_id: string };
function bancoFalso(linhas: Linha[], falha?: { code: string; message: string }) {
  const consultas: Array<Record<string, unknown>> = [];
  return {
    consultas,
    from(tabela: string) {
      const filtros: Record<string, unknown> = { tabela };
      const q = {
        select() { return q; },
        eq(c: string, v: unknown) { filtros[c] = v; return q; },
        order() { return q; },
        limit() { return q; },
        async maybeSingle() {
          consultas.push({ ...filtros });
          if (falha) return { data: null, error: falha };
          const achadas = linhas
            .filter((l) => l.client_id === filtros.client_id && (filtros.forcada === undefined || l.forcada === filtros.forcada))
            .sort((a, b) => Date.parse(b.lido_em) - Date.parse(a.lido_em));
          return { data: achadas[0] ? { lido_em: achadas[0].lido_em } : null, error: null };
        },
      };
      return q;
    },
  };
}

describe("FN-04: as guardas do Gerenciador ao vivo valem entre instâncias", () => {
  const C = "11111111-1111-4111-8111-111111111111";
  const AGORA = Date.parse("2026-09-30T12:00:00Z");
  const DEZ_MIN = 10 * 60_000;

  it("não grava se o banco tem leitura do cliente com menos de 10 min; grava depois disso", async () => {
    const db = bancoFalso([{ client_id: C, lido_em: "2026-09-30T11:58:00Z", forcada: false }]);
    expect(await leituraGravadaRecente(db as never, C, DEZ_MIN, AGORA)).toEqual({ recente: true, erro: null });
    expect(await leituraGravadaRecente(db as never, C, DEZ_MIN, AGORA + 9 * 60_000)).toEqual({ recente: false, erro: null });
    expect(db.consultas[0]).toMatchObject({ tabela: "ads_gerenciador_leituras", client_id: C });
    // Outro cliente não conta.
    expect((await leituraGravadaRecente(db as never, "outro", DEZ_MIN, AGORA)).recente).toBe(false);
  });

  it("o limite de 15 s do forçado olha só as leituras forçadas", async () => {
    const db = bancoFalso([
      { client_id: C, lido_em: "2026-09-30T11:59:55Z", forcada: false },
      { client_id: C, lido_em: "2026-09-30T11:59:30Z", forcada: true },
    ]);
    expect((await leituraGravadaRecente(db as never, C, 15_000, AGORA, true)).recente).toBe(false);
    expect(db.consultas[0]).toMatchObject({ forcada: true });
    const perto = bancoFalso([{ client_id: C, lido_em: "2026-09-30T11:59:50Z", forcada: true }]);
    expect((await leituraGravadaRecente(perto as never, C, 15_000, AGORA, true)).recente).toBe(true);
  });

  it("consulta que falha segue gravando (como antes) e devolve o erro para o log", async () => {
    const db = bancoFalso([], { code: "XX000", message: "caiu" });
    expect(await leituraGravadaRecente(db as never, C, DEZ_MIN, AGORA)).toEqual({ recente: false, erro: { code: "XX000", message: "caiu" } });
    const quebra = { from() { throw new Error("sem rede"); } };
    expect(await leituraGravadaRecente(quebra as never, C, DEZ_MIN, AGORA)).toEqual({ recente: false, erro: { message: "sem rede" } });
  });

  it("a mesa-ads pergunta ao banco antes de gravar e antes de marcar a leitura como forçada", () => {
    const f = ler("supabase/functions/mesa-ads/index.ts");
    const gravar = f.slice(f.indexOf("async function gravarLeituraDoGerenciador("), f.indexOf("async function gerenciadorLer("));
    expect(gravar.indexOf("await leituraRecenteNoBanco(servico, clientId, GRAVAR_LEITURA_A_CADA_MS)")).toBeGreaterThan(0);
    expect(gravar.indexOf("await leituraRecenteNoBanco(servico, clientId, GRAVAR_LEITURA_A_CADA_MS)")).toBeLessThan(gravar.indexOf('.from("ads_gerenciador_leituras").insert('));
    const ler_ = f.slice(f.indexOf("async function gerenciadorLer("));
    expect(ler_).toContain("!(await leituraRecenteNoBanco(servico, clientId, RELEITURA_FORCADA_MIN_MS, true))");
    // A resposta da tela continua a leitura inteira da Meta (nunca a linha enxuta do banco).
    expect(ler_).toContain("return json({ ...leitura, forcada, gravada_em: gravadaEm, tempo_ms: Date.now() - inicioDoPedido, custo_usd: 0 });");
  });
});

// ------------------------------------------------------------------ FN-05

const CL = "11111111-1111-4111-8111-111111111111";
const F_JPG = "aaaaaaaa-0000-4000-8000-000000000001";
const F_PNG = "aaaaaaaa-0000-4000-8000-000000000002";
function entradaDasFotos(): EntradaDoPacote {
  return {
    clientId: CL,
    cliente: "Loja",
    foco: lerFoco({ etapa: "biblioteca" }),
    imagens: [
      { id: F_JPG, nome: "mesa.jpg", tags: [], ativa: true, gerada: false, origem: "upload", criado_em: "2026-09-22", storage_bucket: "mesa", storage_path: `${CL}/fotos/mesa.JPG` },
      { id: F_PNG, nome: "recorte.png", tags: [], ativa: true, gerada: false, origem: "upload", criado_em: "2026-09-23", storage_bucket: "mesa", storage_path: `${CL}/fotos/recorte.png` },
    ],
    clones: [],
    prompts: [],
    books: [],
    kits: [],
    personas: [],
    campanhas: [],
    leituras: {},
    lidasNoStorage: [],
  };
}
const linha = (ref: string, operacao: string, extra: Record<string, unknown> = {}) => ({ operacao, ref, quantidade: 1, cenario: "bancada de mármore", pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null, ...extra });

describe("FN-05: novo cenário sem recorte não vira 4 falhas iguais", () => {
  it("a frase e o código são os mesmos da recusa do Preparar", () => {
    const f = ler("supabase/functions/mesa-foto/index.ts");
    expect(f).toContain(`throw new ErroHttp(409, "${CODIGO_DO_RECORTE_OU_AREA}", "${FRASE_DO_RECORTE_OU_AREA}");`);
  });

  it("a proposta já recusa o JPEG (sem alfa) em novo cenário, com a mesma frase; PNG segue", () => {
    expect(ehArquivoJpeg("a/b/foto.JPEG")).toBe(true);
    expect(ehArquivoJpeg("a/b/foto.png")).toBe(false);
    expect(ehArquivoJpeg(null)).toBe(false);
    const p = montarPacote(entradaDasFotos());
    const refJpg = p.imagens.find((i) => i.id === F_JPG)!.ref;
    const refPng = p.imagens.find((i) => i.id === F_PNG)!.ref;
    const acao = normalizarGeracoesDoDiretor(
      [linha(refJpg, "variar_imagem", { quantidade: 4 }), linha(refJpg, "melhorar_foto", { modo: "cenario" }), linha(refPng, "variar_imagem", { quantidade: 2 }), linha(refJpg, "melhorar_foto", { modo: "luz_cor", cenario: null })],
      p,
    )!;
    expect(acao.recusados).toEqual([
      expect.objectContaining({ ref: refJpg, operacao: "variar_imagem", motivo: FRASE_DO_RECORTE_OU_AREA }),
      expect.objectContaining({ ref: refJpg, operacao: "melhorar_foto", motivo: FRASE_DO_RECORTE_OU_AREA }),
    ]);
    // O PNG (pode ser recorte) e o melhorar em luz e cor continuam na lista.
    expect(acao.itens.map((i) => i.operacao)).toEqual(["variar_imagem", "variar_imagem", "melhorar_foto"]);
    // O dado novo é só do código: não vai ao modelo.
    expect(JSON.stringify(p.imagens.map((i) => i.detalhe))).not.toContain("jpeg");
  });

  it("na execução, a recusa de um item vale para os outros da mesma foto e da mesma rota; o resto segue", () => {
    const p = montarPacote(entradaDasFotos());
    const refPng = p.imagens.find((i) => i.id === F_PNG)!.ref;
    const refJpg = p.imagens.find((i) => i.id === F_JPG)!.ref;
    const acao = normalizarGeracoesDoDiretor([linha(refPng, "variar_imagem", { quantidade: 3 }), linha(refPng, "melhorar_foto", { modo: "cenario" }), linha(refPng, "melhorar_foto", { modo: "luz_cor", cenario: null }), linha(refJpg, "melhorar_foto", { modo: "limpar", cenario: null })], p)!;
    expect(acao.itens.map((i) => i.ref)).toEqual(["g1", "g2", "g3", "g4", "g5", "g6"]);
    expect(pedeNovoCenario(pedidoDoItem(acao, "g1"))).toBe(true);
    expect(pedeNovoCenario(pedidoDoItem(acao, "g4"))).toBe(true);
    expect(pedeNovoCenario(pedidoDoItem(acao, "g5"))).toBe(false);
    const falhou = { ref: "g1", alvo_id: acao.itens[0].alvo_id, titulo: acao.itens[0].titulo, operacao: "variar_imagem", ok: false, motivo: FRASE_DO_RECORTE_OU_AREA };
    const depois = comRecusaNosIrmaos(comResultadoDoItem(acao, falhou, "u1", "2026-09-30T12:00:00Z"), falhou, "u1", "2026-09-30T12:00:00Z");
    const porRef = new Map((depois.resultados || []).map((r) => [r.ref, r]));
    expect(Array.from(porRef.keys()).sort()).toEqual(["g1", "g2", "g3", "g4"]);
    for (const r of ["g2", "g3", "g4"]) expect(porRef.get(r)).toMatchObject({ ok: false, motivo: FRASE_DO_RECORTE_OU_AREA });
    // Luz e cor da mesma foto e a outra foto seguem pendentes; a proposta não fecha.
    expect(depois.executada_em).toBeFalsy();
    // Item que deu certo não espalha nada.
    const deuCerto = { ...falhou, ok: true, motivo: undefined };
    expect(comRecusaNosIrmaos(acao, deuCerto, "u1")).toBe(acao);
  });

  it("o diretor guarda o código da recusa e grava a auditoria com código e motivo", () => {
    const d = ler("supabase/functions/mesa-foto/diretor.ts");
    expect(d).toContain("falha.codigo = codigoDaAcaoInterna(e);");
    expect(d).toContain("comResultado = comRecusaNosIrmaos(comResultado, resultado, ch.userId);");
    expect(d).toContain('errorCode: resultado.ok ? null : falha.codigo || "item_falhou",');
    const i = ler("supabase/functions/mesa-foto/index.ts");
    expect(i).toContain("throw new ErroDaAcaoInterna(");
    expect(i).toContain("errorCode: e.errorCode ?? null, errorMessage: e.errorMessage ?? null,");
  });
});

// ------------------------------------------------------------------ FN-09

describe("FN-09: item de ação do agente que falha vai para o log", () => {
  afterEach(() => vi.restoreAllMocks());
  const item = (ref: string): ItemDaAcaoDoAgente => ({ ref, alvo_id: `id-${ref}`, titulo: "Título secreto", detalhe: null, operacao: "arquivar", rotulo: "arquivar", para: null });

  it("recusa de regra (4xx) vira aviso; o resto vira falha; o resultado não muda", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await executarItemAItem([item("a1"), item("a2"), item("a3")], async (it) => {
      if (it.ref === "a1") throw Object.assign(new Error("Esta foto já está sem fundo."), { status: 409 });
      if (it.ref === "a2") throw new Error("A foto não voltou do gerador.");
    });
    expect(r).toEqual([
      { ref: "a1", alvo_id: "id-a1", titulo: "Título secreto", operacao: "arquivar", ok: false, motivo: "Esta foto já está sem fundo." },
      { ref: "a2", alvo_id: "id-a2", titulo: "Título secreto", operacao: "arquivar", ok: false, motivo: "A foto não voltou do gerador." },
      { ref: "a3", alvo_id: "id-a3", titulo: "Título secreto", operacao: "arquivar", ok: true },
    ]);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso.mock.calls[0][1]).toEqual({ ref: "a1", operacao: "arquivar", alvo_id: "id-a1", motivo: "Esta foto já está sem fundo." });
    expect(erro).toHaveBeenCalledTimes(1);
    expect(erro.mock.calls[0][0]).toBe("acoes-do-agente: item falhou");
    expect(JSON.stringify([aviso.mock.calls, erro.mock.calls])).not.toContain("Título secreto");
  });
});

// ------------------------------------------------------------------ FN-06, FN-11, FN-12, FN-13

describe("FN-06: montar e importar brand book respondem com fôlego", () => {
  it("o fôlego fica no Deno.serve e o mapa de ações não muda", () => {
    const f = ler("supabase/functions/agente-contexto/index.ts");
    expect(f).toContain('const COM_FOLEGO = new Set(["montar", "importar_brand_book"]);');
    expect(f).toContain("return respostaComFolego(() => executar(quem, corpo).catch((e) => respostaDoErro(e, acao)), corsHeaders);");
    expect(f).toContain("importar_brand_book: importarBrandBook");
    expect(f).toContain("sugerir_kit_da_marca: sugerirKitDaMarca");
  });
});

describe("FN-11: o cron da fila de arquivos só chama quando há trabalho", () => {
  const m = ler("supabase/migrations/20260930292000_mcp_files_worker_so_com_trabalho.sql");
  it("mesma condição do worker, mesmos cabeçalhos do cofre, idempotente", () => {
    expect(m).toContain("PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mcp-files-worker-drain';");
    expect(m).toContain("PERFORM cron.schedule('mcp-files-worker-drain', '* * * * *', $job$");
    expect(m).toContain("where status in ('pending', 'failed') and attempts < 3");
    expect(m).toContain("where name = 'email_queue_service_role_key'");
    expect(m).toContain("where name = 'cron_secret'");
    expect(m).not.toMatch(/Bearer [A-Za-z0-9_\-.]{20,}/);
    const w = ler("supabase/functions/mcp-files-worker/index.ts");
    expect(w).toContain(".in('status', ['pending', 'failed'])");
    expect(w).toContain(".lt('attempts', MAX_ATTEMPTS)");
    expect(w).toContain("Number(Deno.env.get('MCP_FILE_MAX_ATTEMPTS') ?? 3)");
  });
});

describe("FN-12: ping do MCP sem ir ao banco", () => {
  it("responde antes de validar a credencial, e o resto do POST segue igual", () => {
    const f = ler("supabase/functions/mcp-server/index.ts");
    const ping = f.indexOf('if (message.method === "ping") {');
    expect(ping).toBeGreaterThan(0);
    expect(ping).toBeLessThan(f.indexOf("const auth = await authenticate(req);"));
    expect(f).toContain("const pong = await dispatch(message, { ok: true, ctx: publicAuthContext() });");
  });
});

describe("FN-13: TypeSafe da classificação de materiais com prazo", () => {
  it("fetch com AbortSignal.timeout e falha no log com o motivo", () => {
    const f = ler("supabase/functions/materiais-classificar/index.ts");
    expect(f).toContain("signal: AbortSignal.timeout(JEV_TIMEOUT_MS),");
    expect(f).toContain('registrarFalha("materiais-classificar: typesafe falhou", err);');
    expect(f).toContain('return json({ ok: false, error: "typesafe_indisponivel", classificados, incertos }, 502);');
  });
});

// ------------------------------------------------------------------ FN-10

describe("FN-10: pulso do segundo cérebro com 3 chamadas ao GitHub (eram 7), mesma resposta", () => {
  const ENV: Record<string, string> = {
    SECOND_BRAIN_GITHUB_TOKEN: "ghp_token_falso_de_teste_com_tamanho",
    SECOND_BRAIN_GITHUB_OWNER: "dono",
    SECOND_BRAIN_GITHUB_REPO: "cerebro",
    SECOND_BRAIN_DEFAULT_BRANCH: "main",
  };
  const commits = Array.from({ length: 12 }, (_, i) => ({
    sha: `${i}`.padStart(40, "a"),
    html_url: `https://github.com/dono/cerebro/commit/${i}`,
    author: { login: `pessoa${i}` },
    commit: { message: `commit ${i}\n\ncorpo`, author: { name: `Pessoa ${i}`, date: `2026-09-30T0${i % 10}:00:00Z` } },
  }));
  const inbox = [
    { type: "file", name: "a.md", path: "memory/inbox/chatgpt/a.md", sha: "s1", size: 10 },
    { type: "file", name: "b.txt", path: "memory/inbox/chatgpt/b.txt", sha: "s2", size: 11 },
    { type: "dir", name: "c.md", path: "memory/inbox/chatgpt/c.md", sha: "s3", size: 0 },
    ...Array.from({ length: 9 }, (_, i) => ({ type: "file", name: `n${i}.MD`, path: `memory/inbox/chatgpt/n${i}.MD`, sha: `n${i}`, size: i })),
  ];

  function githubFalso(opcoes: { commitsStatus?: number; inboxStatus?: number } = {}) {
    const chamadas: string[] = [];
    const fetchFalso = vi.fn(async (u: string | URL) => {
      const url = new URL(String(u));
      chamadas.push(url.pathname);
      const responder = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
      if (url.pathname === "/repos/dono/cerebro/branches/main") return responder(200, { name: "main" });
      if (url.pathname === "/repos/dono/cerebro/commits") {
        if (opcoes.commitsStatus) return responder(opcoes.commitsStatus, { message: "erro" });
        return responder(200, commits.slice(0, Number(url.searchParams.get("per_page"))));
      }
      if (url.pathname === "/repos/dono/cerebro/contents/memory/inbox/chatgpt") {
        if (opcoes.inboxStatus) return responder(opcoes.inboxStatus, { message: "erro" });
        return responder(200, inbox);
      }
      return responder(404, { message: "Not Found" });
    });
    return { chamadas, fetchFalso };
  }

  async function moduloNovo() {
    vi.resetModules();
    return await import("../../supabase/functions/_shared/second-brain-github");
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const semRelogio = (p: Record<string, unknown>) => ({ ...p, fetched_at: "x", latency_ms: 0 });

  it("mesmo pulso, commits e inbox da composição antiga, com 3 chamadas", async () => {
    vi.stubGlobal("Deno", { env: { get: (k: string) => ENV[k] } });
    for (const limit of [1, 8, 20]) {
      const antigo = githubFalso();
      vi.stubGlobal("fetch", antigo.fetchFalso);
      const a = await moduloNovo();
      const [pulso, lista, pendentes] = await Promise.all([
        a.getBridgePulse(false),
        a.listRecentCommits(limit).catch(() => []),
        a.listInboxPending(limit).catch(() => []),
      ]);
      const novo = githubFalso();
      vi.stubGlobal("fetch", novo.fetchFalso);
      const b = await moduloNovo();
      const r = await b.lerPulsoCompleto(limit, false);
      expect(semRelogio(r.pulse as unknown as Record<string, unknown>)).toEqual(semRelogio(pulso as unknown as Record<string, unknown>));
      expect(r.commits).toEqual(lista);
      expect(r.inbox).toEqual(pendentes);
      // A composição antiga já ganha com a branch em voo compartilhada (7 chamadas no código de antes, 5 agora).
      expect(antigo.chamadas.length).toBe(5);
      expect(novo.chamadas.length).toBe(3);
      expect(novo.chamadas.filter((c) => c.endsWith("/branches/main")).length).toBe(1);
    }
  });

  it("erro nos commits: sobe (bridge_unavailable) quando é credencial; resposta de erro deixa head nulo e lista vazia; inbox que falha fica vazio", async () => {
    vi.stubGlobal("Deno", { env: { get: (k: string) => ENV[k] } });
    const g401 = githubFalso({ commitsStatus: 401 });
    vi.stubGlobal("fetch", g401.fetchFalso);
    await expect((await moduloNovo()).lerPulsoCompleto(8)).rejects.toMatchObject({ error: { kind: "unauthorized" } });
    const g409 = githubFalso({ commitsStatus: 409, inboxStatus: 404 });
    vi.stubGlobal("fetch", g409.fetchFalso);
    const r = await (await moduloNovo()).lerPulsoCompleto(8);
    expect(r.pulse).toMatchObject({ configured: true, branch: "main", head: null, inbox_pending: 0, cached: false });
    expect(r.commits).toEqual([]);
    expect(r.inbox).toEqual([]);
  });

  it("branch pedida em paralelo é consultada uma vez só", async () => {
    vi.stubGlobal("Deno", { env: { get: (k: string) => ENV[k] } });
    const g = githubFalso();
    vi.stubGlobal("fetch", g.fetchFalso);
    const m = await moduloNovo();
    await Promise.all([m.listRecentCommits(3), m.listInboxPending(3), m.listRecentCommits(5)]);
    expect(g.chamadas.filter((c) => c.endsWith("/branches/main")).length).toBe(1);
  });
});
