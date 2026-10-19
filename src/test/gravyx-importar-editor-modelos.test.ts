// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { analisarImportacao, conferirManifesto, detectarFramework, packageJsonDoImportado, segredoNoTexto, type ArquivoDaImportacao } from "../../supabase/functions/mesa-site/modulos/importacao-do-site";
import { arvoreDosArquivos, buscarNosArquivos, conflitoDoArquivo, motivoDeProtecao, validarEdicaoDeCodigo } from "../../supabase/functions/mesa-site/modulos/editor-de-codigo";
import { camposDoModelo, mapaDoModelo, MODELOS_DE_PAGINA, modeloDePagina, nomeDoSiteDoModelo } from "../../supabase/functions/mesa-site/modulos/modelos-de-pagina";
import { presetDeEstilo, secaoDaBiblioteca } from "../../supabase/functions/_shared/site-biblioteca";

vi.mock("../../supabase/functions/_shared/mcp-audit.ts", () => ({ auditLog: vi.fn(async () => undefined) }));
import { caminhoDaImportacaoValido, rotasDoCodigoEModelos, type ContextoDoCodigo } from "../../supabase/functions/mesa-site/codigo-e-modelos";

/**
 * Mesa Site igual ao Gravyx (19/10/2026), os três que faltavam: importar site
 * existente (detecção do framework, só estático, limites e recusa de
 * segredo), editor de código (o que se edita, a trava de concorrência) e a
 * galeria de modelos de página (o site nasce do modelo com a marca aberta).
 * Puro, mais as rotas da função com um banco falso.
 */

const pj = (o: Record<string, unknown>) => ({ caminho: "package.json", bytes: 200, texto: JSON.stringify(o) });
const arq = (caminho: string, texto: string | null = "x", bytes = 10): ArquivoDaImportacao => ({ caminho, bytes, texto });
// Montadas por partes: o texto de uma chave de verdade nunca fica inteiro no repositório.
const CHAVE_STRIPE = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");
const jwt = (payload: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64").split("=").join("").split("+").join("-").split("/").join("_")}.c2lnbmF0dXJlLWZhbHNh`;

describe("importar site: o framework", () => {
  it("Vite + React compila com o build do projeto e a saída em dist", () => {
    const a = analisarImportacao([pj({ scripts: { build: "vite build" }, dependencies: { react: "18" }, devDependencies: { vite: "5" } }), arq("index.html"), arq("src/main.tsx")], "pasta");
    expect(a.ok).toBe(true);
    expect(a.framework).toEqual({ id: "vite", rotulo: "Vite + React", build: "build", saida: "dist" });
  });

  it("Next só com exportação estática; com servidor é recusado com o motivo", () => {
    const base = [pj({ scripts: { build: "next build" }, dependencies: { next: "14", react: "18" } }), arq("app/page.tsx")];
    const estatico = analisarImportacao([...base, arq("next.config.mjs", "export default { output: 'export' }")], "zip");
    expect(estatico.framework).toMatchObject({ id: "next", saida: "out" });
    const servidor = analisarImportacao([...base, arq("next.config.mjs", "export default { images: {} }")], "zip");
    expect(servidor.ok).toBe(false);
    expect(servidor.codigo).toBe("next_com_servidor");
    expect(servidor.motivo).toMatch(/só site estático/);
  });

  it("Astro estático passa; Astro com adapter de servidor é recusado", () => {
    expect(detectarFramework([pj({ scripts: { build: "astro build" }, dependencies: { astro: "4" } }), arq("astro.config.mjs", "export default {}")], "zip")).toEqual({ framework: { id: "astro", rotulo: "Astro", build: "build", saida: "dist" } });
    const s = detectarFramework([pj({ scripts: { build: "astro build" }, dependencies: { astro: "4", "@astrojs/node": "8" } })], "zip");
    expect("recusa" in s && s.recusa.codigo).toBe("astro_com_servidor");
  });

  it("HTML puro (pasta com index.html) e um HTML só, que vira index.html", () => {
    const pasta = analisarImportacao([arq("meu-site/index.html", "<h1>oi</h1>"), arq("meu-site/css/a.css"), arq("meu-site/img/logo.png", null, 2000)], "pasta");
    expect(pasta.ok).toBe(true);
    expect(pasta.raiz).toBe("meu-site/");
    expect(pasta.framework && pasta.framework.id).toBe("estatico");
    expect(pasta.arquivos.map((x) => x.caminho)).toEqual(["index.html", "css/a.css", "img/logo.png"]);
    const um = analisarImportacao([arq("landing-final.html", "<h1>oi</h1>")], "html");
    expect(um.framework && um.framework.id).toBe("html");
    expect(um.arquivos.map((x) => x.caminho)).toEqual(["index.html"]);
  });

  it("CRA, Gatsby, SvelteKit estático; Remix, monorepo e servidor Node são recusados", () => {
    const f = (o: Record<string, unknown>, extra: ArquivoDaImportacao[] = []) => detectarFramework([pj(o), ...extra], "zip");
    expect(f({ scripts: { build: "react-scripts build" }, dependencies: { "react-scripts": "5" } })).toMatchObject({ framework: { id: "cra", saida: "build" } });
    expect(f({ scripts: { build: "gatsby build" }, dependencies: { gatsby: "5" } })).toMatchObject({ framework: { id: "gatsby", saida: "public" } });
    expect(f({ scripts: { build: "vite build" }, devDependencies: { "@sveltejs/kit": "2", "@sveltejs/adapter-static": "3" } })).toMatchObject({ framework: { id: "sveltekit" } });
    expect(f({ scripts: { build: "remix build" }, dependencies: { "@remix-run/react": "2" } })).toMatchObject({ recusa: { codigo: "remix" } });
    expect(f({ workspaces: ["apps/*"] })).toMatchObject({ recusa: { codigo: "monorepo" } });
    expect(detectarFramework([arq("pnpm-workspace.yaml"), pj({})], "zip")).toMatchObject({ recusa: { codigo: "monorepo" } });
    expect(f({ scripts: { start: "node server.js" }, dependencies: { express: "4" } })).toMatchObject({ recusa: { codigo: "servidor_node" } });
  });

  it("dependências, cache, .git e a saída de build (em projeto que compila) ficam de fora; lock de outro gerenciador vira aviso", () => {
    const a = analisarImportacao([pj({ scripts: { build: "vite build" }, devDependencies: { vite: "5" } }), arq("index.html"), arq("node_modules/vite/index.js"), arq(".git/HEAD"), arq("dist/index.html"), arq("yarn.lock"), arq(".DS_Store")], "zip");
    expect(a.ok).toBe(true);
    expect(a.arquivos.map((x) => x.caminho).sort()).toEqual(["index.html", "package.json"]);
    // O .DS_Store sai antes (lixo do sistema), sem contar.
    expect(a.ignorados.total).toBe(4);
    expect(a.avisos.join(" ")).toMatch(/npm/);
  });

  it("o package.json do importado: build e checar do motor, o original em build:importado; HTML puro ganha um mínimo", () => {
    const p = JSON.parse(packageJsonDoImportado(JSON.stringify({ name: "x", scripts: { build: "vite build", dev: "vite" } }), "proj", { id: "vite", rotulo: "Vite", build: "build", saida: "dist" }));
    expect(p.scripts).toEqual({ build: "node .aceleriq/montar.mjs", dev: "vite", "build:importado": "vite build", checar: "node .aceleriq/montar.mjs" });
    const m = JSON.parse(packageJsonDoImportado(null, "proj", { id: "estatico", rotulo: "Site estático", build: null, saida: null }));
    expect(m).toMatchObject({ name: "proj", private: true, scripts: { build: "node .aceleriq/montar.mjs" } });
  });
});

describe("importar site: segredo, tamanho e caminho recusam a importação inteira", () => {
  it(".env recusa (pelo nome); .env.example sem valor passa", () => {
    const a = analisarImportacao([arq("index.html"), arq(".env", "API=1")], "pasta");
    expect(a.ok).toBe(false);
    expect(a.codigo).toBe("segredo");
    expect(a.segredos).toEqual([{ arquivo: ".env", motivo: "arquivo .env (variáveis e chaves)" }]);
    expect(a.motivo).toMatch(/Tire do projeto/);
    expect(analisarImportacao([arq("index.html"), arq(".env.example", "VITE_SUPABASE_URL=\nVITE_API_KEY=")], "pasta").ok).toBe(true);
    expect(analisarImportacao([arq("index.html"), arq("certs/servidor.pem", "x")], "pasta").codigo).toBe("segredo");
  });

  it("chave escrita no código recusa (com o arquivo); a chave anon do Supabase é pública e passa; a service_role não", () => {
    const comChave = analisarImportacao([arq("index.html"), arq("src/pagar.js", `const k = "${CHAVE_STRIPE}";`)], "pasta");
    expect(comChave.ok).toBe(false);
    expect(comChave.segredos[0]).toEqual({ arquivo: "src/pagar.js", motivo: "chave secreta do Stripe" });
    expect(segredoNoTexto(`createClient(url, "${jwt({ role: "anon", iss: "supabase" })}")`)).toBeNull();
    expect(segredoNoTexto(`const s = "${jwt({ role: "service_role", iss: "supabase" })}"`)).toBe("chave service_role do Supabase");
    expect(segredoNoTexto("-----BEGIN RSA PRIVATE KEY-----\nabc")).toBe("chave privada");
    expect(segredoNoTexto("//registry.npmjs.org/:_authToken=npm_abcdefghijklmnop")).toBe("token do npm");
  });

  it("arquivo grande, site grande, arquivos demais e caminho inseguro", () => {
    expect(analisarImportacao([arq("index.html"), arq("video.mp4", null, 30 * 1024 * 1024)], "pasta").codigo).toBe("arquivo_grande");
    const muitos = Array.from({ length: 9 }, (_, i) => arq(`img/${i}.jpg`, null, 24 * 1024 * 1024));
    expect(analisarImportacao([arq("index.html"), ...muitos], "pasta").codigo).toBe("grande_demais");
    expect(analisarImportacao([arq("index.html"), ...Array.from({ length: 4001 }, (_, i) => arq(`a/${i}.txt`))], "pasta").codigo).toBe("arquivos_demais");
    expect(analisarImportacao([arq("../fora.html"), arq("index.html")], "zip").codigo).toBe("caminho_invalido");
    expect(analisarImportacao([arq("C:/Windows/x.html")], "zip").codigo).toBe("caminho_invalido");
  });

  it("o manifesto da função (só nomes e tamanhos) também recusa .env, caminho e tamanho", () => {
    expect(conferirManifesto([{ caminho: "index.html", bytes: 10 }])).toMatchObject({ ok: true, arquivos: 1 });
    expect(conferirManifesto([{ caminho: "index.html", bytes: 10 }, { caminho: "app/.env.local", bytes: 5 }])).toMatchObject({ ok: false, codigo: "segredo" });
    expect(conferirManifesto([{ caminho: "../x", bytes: 1 }])).toMatchObject({ ok: false, codigo: "caminho_invalido" });
    expect(conferirManifesto([{ caminho: "v.mp4", bytes: 26 * 1024 * 1024 }])).toMatchObject({ ok: false, codigo: "arquivo_grande" });
  });
});

describe("editor de código: o que se edita e a trava de concorrência", () => {
  const sha = "a".repeat(64);
  it("arquivos do motor, da casca, de segredo e binários são só leitura", () => {
    expect(motivoDeProtecao("src/secoes/Hero.tsx")).toBeNull();
    expect(motivoDeProtecao("index.html")).toBeNull();
    expect(motivoDeProtecao("package.json")).toMatch(/motor/);
    expect(motivoDeProtecao(".aceleriq/pacote.json")).toMatch(/motor/);
    expect(motivoDeProtecao("src/marca.css")).toMatch(/motor/);
    expect(motivoDeProtecao("src/App.tsx", ["src/App.tsx"])).toMatch(/casca/);
    expect(motivoDeProtecao(".env.local")).toMatch(/segredo/);
    expect(motivoDeProtecao("public/logo.png")).toMatch(/binário/);
  });

  it("o Salvar recusa protegido, segredo no conteúdo, repetido e marca inválida; aceita o resto", () => {
    expect(validarEdicaoDeCodigo({ arquivos: [{ caminho: "src/a.tsx", conteudo: "x", sha_antes: sha }] })).toMatchObject({ ok: true, edicao: { arquivos: [{ caminho: "src/a.tsx" }] } });
    expect(validarEdicaoDeCodigo({ arquivos: [{ caminho: "package.json", conteudo: "{}", sha_antes: sha }] })).toMatchObject({ ok: false, codigo: "protegido" });
    expect(validarEdicaoDeCodigo({ arquivos: [{ caminho: "src/a.ts", conteudo: `const k = "${CHAVE_STRIPE}"`, sha_antes: sha }] })).toMatchObject({ ok: false, codigo: "segredo" });
    expect(validarEdicaoDeCodigo({ arquivos: [{ caminho: "a.css", conteudo: "", sha_antes: sha }, { caminho: "./a.css", conteudo: "", sha_antes: sha }] })).toMatchObject({ ok: false, codigo: "repetido" });
    expect(validarEdicaoDeCodigo({ arquivos: [{ caminho: "a.css", conteudo: "", sha_antes: "abc" }] })).toMatchObject({ ok: false, codigo: "sha_invalido" });
    expect(validarEdicaoDeCodigo({ arquivos: [] })).toMatchObject({ ok: false, codigo: "nada_mudou" });
  });

  it("conflito: o arquivo mudou (ou sumiu, ou apareceu) depois da leitura", () => {
    const a = { caminho: "src/a.tsx", conteudo: "x", sha_antes: sha };
    expect(conflitoDoArquivo(a, sha)).toBeNull();
    expect(conflitoDoArquivo(a, "b".repeat(64))).toMatch(/mudou em outra edição/);
    expect(conflitoDoArquivo(a, null)).toMatch(/não existe mais/);
    expect(conflitoDoArquivo({ ...a, sha_antes: null }, sha)).toMatch(/já existe/);
  });

  it("árvore (pastas primeiro) e busca sem diferença de maiúscula", () => {
    const arv = arvoreDosArquivos(["src/secoes/Hero.tsx", "index.html", "src/App.tsx"]);
    expect(arv.map((n) => n.nome)).toEqual(["src", "index.html"]);
    expect(arv[0].filhos.map((n) => n.nome)).toEqual(["secoes", "App.tsx"]);
    expect(buscarNosArquivos([{ caminho: "a.tsx", conteudo: "linha 1\nCompre AGORA\n" }], "agora")).toEqual([{ caminho: "a.tsx", linha: 2, trecho: "Compre AGORA" }]);
  });
});

describe("galeria de modelos de página", () => {
  it("os cinco modelos pedidos, cada seção da biblioteca, preset que existe e nada some no mapa", () => {
    expect(MODELOS_DE_PAGINA.map((m) => m.id)).toEqual(["captura", "vendas", "obrigado", "bio", "institucional_curto"]);
    for (const m of MODELOS_DE_PAGINA) {
      expect(presetDeEstilo(m.preset)).not.toBeNull();
      m.paginas.forEach((p) => p.secoes.forEach((s) => expect(secaoDaBiblioteca(s.tipo)).not.toBeNull()));
      const mapa = mapaDoModelo(m);
      expect(mapa.tipo).toBe(m.tipo);
      expect(mapa.paginas[0].secoes.map((s) => s.tipo)).toEqual(m.paginas[0].secoes.map((s) => s.tipo));
      expect(mapa.paginas[0].secoes.every((s) => !!s.nota)).toBe(true);
    }
  });

  it("os campos do site novo: tipo, mapa, seções do motor, estilo e objetivo, guardando a base de design da marca", () => {
    const m = modeloDePagina("captura")!;
    const c = camposDoModelo(m, { direcao: { secoes: ["hero"], base_de_design: { produto: "x" } }, briefing: {}, estilo: {} });
    expect(c.tipo).toBe("landing");
    expect(c.direcao).toMatchObject({ base_de_design: { produto: "x" }, modelo_de_pagina: { id: "captura", nome: "Página de captura" } });
    expect(c.direcao.secoes).toEqual(["hero_dividido", "bento", "prova", "contato", "faq", "rodape"]);
    expect(c.estilo.preset).toBe("saas_limpo");
    expect(c.briefing.respostas).toMatchObject({ objetivo: m.objetivo, acao: m.acao });
    // O que a equipe já respondeu não é trocado pelo modelo.
    expect(camposDoModelo(m, { briefing: { respostas: { objetivo: "Vender pão" } } }).briefing.respostas.objetivo).toBe("Vender pão");
    expect(nomeDoSiteDoModelo(m, "Padaria", ["Página de captura Padaria"])).toBe("Página de captura Padaria 2");
  });
});

// ------------------------------------------------------------------ as rotas da função (banco falso)

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

function montarCtx(o: { trabalhos?: Array<Record<string, unknown>>; zipNoStorage?: boolean } = {}) {
  const sites: Array<Record<string, any>> = [];
  const pedidos: Array<{ pedido: Record<string, unknown>; pacote?: Record<string, unknown>; site: string }> = [];
  const db = {
    from: (_t: string) => {
      const q: any = {
        select: () => q, eq: () => q, neq: () => q, not: () => q, order: () => q, limit: () => q,
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: o.trabalhos || [], error: null }).then(ok),
      };
      return q;
    },
    storage: {
      from: () => ({
        list: async () => ({ data: o.zipNoStorage === false ? [] : [{ name: "0f0e0d0c-1111-4222-8333-444455556666.zip", metadata: { size: 1000 } }], error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: "https://x/zip" }, error: null }),
      }),
    },
  };
  const erro = (status: number, codigo: string, mensagem: string) => Object.assign(new Error(mensagem), { status, codigo });
  const ctx = {
    servico: () => db,
    json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    erro,
    garantirAcesso: async () => undefined,
    lerSite: async () => sites[0] || { id: SITE, client_id: CLIENTE, projeto: "p", nome: "S", direcao: {}, marca_id: null },
    atualizarSite: async (id: string, campos: Record<string, unknown>) => {
      const s = sites.find((x) => x.id === id)!;
      Object.assign(s, campos);
      return s;
    },
    criarSite: async (_ch: unknown, c: Record<string, unknown>) => {
      const s = { id: SITE, client_id: c.client_id, nome: c.nome, tipo: c.tipo || null, projeto: "p-33333333", direcao: { secoes: ["hero"], base_de_design: { produto: "b" } }, briefing: {}, estilo: {}, marca_id: c.marca_id || null };
      sites.push(s);
      return s;
    },
    pedirTrabalho: async (_ch: unknown, s: { id: string }, pedido: Record<string, unknown>, pacote?: Record<string, unknown>) => {
      pedidos.push({ pedido, pacote, site: s.id });
      return { id: "t-1", tipo: pedido.tipo, teto_usd: 0 };
    },
  } as unknown as ContextoDoCodigo;
  return { rotas: rotasDoCodigoEModelos(ctx), sites, pedidos };
}

const ch = { userId: "u-1" };
const PATH = `${CLIENTE}/site/importacao/0f0e0d0c-1111-4222-8333-444455556666.zip`;

describe("rotas da função mesa-site: importar, código e modelo", () => {
  it("site_importar: cria o site na Construção e põe o trabalho sem IA com o pacote da importação", async () => {
    const { rotas, sites, pedidos } = montarCtx();
    const r = await rotas.site_importar(ch, { client_id: CLIENTE, nome: "Site antigo", origem: "zip", path: PATH, framework: "Vite + React", manifesto: [{ caminho: "index.html", bytes: 10 }, { caminho: "package.json", bytes: 5 }] });
    expect(r.status).toBe(200);
    expect(sites[0]).toMatchObject({ nome: "Site antigo", etapa: "construcao", direcao: { importacao: { origem: "zip", framework: "Vite + React", arquivos: 2 } } });
    expect(pedidos).toEqual([{ site: SITE, pedido: { tipo: "textos", instrucao: "Importar o site (Vite + React, 2 arquivos)" }, pacote: { importacao: { bucket: "mesa", path: PATH, origem: "zip", nome: null } } }]);
  });

  it("site_importar recusa .env no manifesto, caminho de outro cliente e pacote que não subiu (sem criar site)", async () => {
    const um = montarCtx();
    await expect(um.rotas.site_importar(ch, { client_id: CLIENTE, origem: "pasta", path: PATH, manifesto: [{ caminho: "index.html", bytes: 1 }, { caminho: ".env", bytes: 1 }] })).rejects.toMatchObject({ codigo: "segredo" });
    await expect(um.rotas.site_importar(ch, { client_id: CLIENTE, origem: "zip", path: PATH.replace(CLIENTE, "99999999-9999-4999-8999-999999999999"), manifesto: [{ caminho: "index.html", bytes: 1 }] })).rejects.toMatchObject({ codigo: "caminho_invalido" });
    const sem = montarCtx({ zipNoStorage: false });
    await expect(sem.rotas.site_importar(ch, { client_id: CLIENTE, origem: "zip", path: PATH, manifesto: [{ caminho: "index.html", bytes: 1 }] })).rejects.toMatchObject({ codigo: "pacote_inexistente" });
    expect(um.sites.length + sem.sites.length).toBe(0);
    expect(caminhoDaImportacaoValido(CLIENTE, `${CLIENTE}/site/importacao/../x.zip`)).toBe(false);
  });

  it("codigo_salvar: vira trabalho sem IA com a edição; recusa arquivo do motor e o motor mexendo no site", async () => {
    const sha = "c".repeat(64);
    const { rotas, pedidos } = montarCtx();
    const r = await rotas.codigo_salvar(ch, { site_id: SITE, arquivos: [{ caminho: "src/secoes/Hero.tsx", conteudo: "export default 1", sha_antes: sha }], de: "abc1234" });
    expect(r.status).toBe(200);
    expect(pedidos[0]).toEqual({ site: SITE, pedido: { tipo: "textos", instrucao: "Editar o código: src/secoes/Hero.tsx" }, pacote: { edicao_de_codigo: { arquivos: [{ caminho: "src/secoes/Hero.tsx", conteudo: "export default 1", sha_antes: sha }], de: "abc1234" } } });
    await expect(rotas.codigo_salvar(ch, { site_id: SITE, arquivos: [{ caminho: "package.json", conteudo: "{}", sha_antes: sha }] })).rejects.toMatchObject({ codigo: "protegido" });
    const ocupado = montarCtx({ trabalhos: [{ id: "00000000-0000-4000-8000-000000000001", client_id: CLIENTE, marca_id: null, mesa: "site", projeto: "p", referencia_tipo: "site", referencia_id: SITE, tipo: "ajustar", estado: "executando", modelo: null, instrucao: "x", teto_usd: 1, estimativa_usd: 0, custo_usd: 0, preview_url: null, commit: null, commit_anterior: null, zip_path: null, resultado: {}, erro: null, criado_em: "2026-10-19T10:00:00Z", terminado_em: null }] });
    await expect(ocupado.rotas.codigo_salvar(ch, { site_id: SITE, arquivos: [{ caminho: "a.css", conteudo: "", sha_antes: sha }] })).rejects.toMatchObject({ codigo: "motor_mexendo" });
    expect(ocupado.pedidos).toEqual([]);
  });

  it("site_do_modelo: o site nasce com o mapa e o estilo do modelo, a base da marca e abre no Briefing", async () => {
    const { rotas, sites } = montarCtx();
    const r = await rotas.site_do_modelo(ch, { client_id: CLIENTE, modelo: "vendas", nome: "Página de vendas Padaria" });
    const d = (await r.json()) as { site: Record<string, any> };
    expect(d.site).toMatchObject({ nome: "Página de vendas Padaria", tipo: "landing", etapa: "briefing", estilo: { preset: "cinema_noturno" }, direcao: { base_de_design: { produto: "b" }, modelo_de_pagina: { id: "vendas" } } });
    expect(sites[0].mapa.paginas[0].secoes.map((s: { tipo: string }) => s.tipo)).toEqual(["hero", "problema", "bento", "processo", "prova", "pricing", "faq", "chamada"]);
    await expect(rotas.site_do_modelo(ch, { client_id: CLIENTE, modelo: "nao-existe" })).rejects.toMatchObject({ codigo: "modelo_inexistente" });
  });
});
