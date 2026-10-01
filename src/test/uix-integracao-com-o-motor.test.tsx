// @vitest-environment node
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import Grafico, { pontosValidos } from "../../workers/motor-codigo/modelo-site/src/lib/Grafico";
import { apoioDoPacote, cssDaMarca, lerCasca, MODELO_DO_SITE } from "../../workers/motor-codigo/lib/projeto";
import { arquivosDaSecao, ordemNoGit, paginasDoBuild, provaFresca, revisaoDeUx, secoesDoPacote, slugsDoPacote } from "../../workers/motor-codigo/lib/revisao-ux";
import { apoioDaPaleta, coresDoSite, corDoPapel, variaveisDoApoio } from "../../supabase/functions/_shared/uiux/apoio-da-paleta";
import { contraste, textoSobre } from "../../supabase/functions/_shared/cores-da-marca";
import { BASE_COMPLETA, apoioDoProduto, pacoteDaBaseDeDesign } from "../../supabase/functions/_shared/uiux/base-completa";
import { baseHerdada, direcaoParaOAgente, graficoParaDados, lerBaseDeDesign, type SerieReal } from "../../supabase/functions/_shared/uiux/consultas";
import { GRAFICO_DA_FORMA, PRESET_DO_ESTILO, ROTULO_DO_GRAFICO } from "../../supabase/functions/_shared/uiux/mapeamentos";
import { itensDoChecklistDeUx, lerTokensDoCss, REGRAS_DE_PAGINA, revisarUx, revisarUxDasPaginas } from "../../supabase/functions/_shared/uiux/revisao-ux";
import { perguntasDaBase, perguntasDoRerank } from "../../supabase/functions/_shared/uiux/jev-da-base";
import { REGRAS_DE_UX_DA_BASE } from "../../supabase/functions/_shared/uiux/dados/ux";
import { ATRIBUTOS_DO_DNA, MAX_ATRIBUTOS, promptDaSecao, type PacoteDoSite } from "../../supabase/functions/_shared/site-metodo";
import { camposDoEstilo } from "../../supabase/functions/mesa-site/estrutura-pura";
import type { LinhaDoSite } from "../../supabase/functions/_shared/pacote-do-site";
import { TETO_DO_BLOCO_DO_DIRETOR } from "../../supabase/functions/_shared/uiux/citar";

/**
 * Frente UXM, correções de 30/09 (PARTE MESAS sobre a PARTE MOTOR): uma
 * integração só com o motor (um Grafico.tsx, um pacote.ts, uma casca v3, um
 * seo.mjs, o executar.ts chamando a revisão de UX e a prova da base), o apoio
 * da paleta com o mesmo destaque do site, a revisão de UX em todas as páginas,
 * a prova do agente por um leitor só (fresca e só do mapa), o DNA do estilo da
 * base e a sugestão do Jev fora do prompt do diretor.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8").replace(/\r\n/g, "\n");
const pastas: string[] = [];
const temp = (nome: string) => {
  const p = mkdtempSync(join(tmpdir(), `uix-${nome}-`));
  pastas.push(p);
  return p;
};
afterAll(() => {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});

// ------------------------------------------------------------------ uma integração só

describe("uma integração só com o motor", () => {
  const SERIES: Record<string, SerieReal> = {
    tempo: { pontos: [{ rotulo: "2023", valor: 10 }, { rotulo: "2024", valor: 14 }, { rotulo: "2025", valor: 21 }], eixo: "tempo", fonte: "briefing" },
    categorias: { pontos: [{ rotulo: "Curitiba", valor: 40 }, { rotulo: "Londrina", valor: 25 }], fonte: "dossiê" },
    parte_do_todo: { pontos: [{ rotulo: "Instagram", valor: 60 }, { rotulo: "Google", valor: 40 }], parte_do_todo: true, fonte: "arquivo" },
  };

  it("todo tipo de GRAFICO_DA_FORMA é aceito pelo Grafico do modelo, pelo pacote.ts e pelo AGENTS.md", () => {
    const pacoteTs = ler("workers/motor-codigo/modelo-site/src/lib/pacote.ts");
    const agents = ler("workers/motor-codigo/modelo-site/AGENTS.md");
    const linhaDoGrafico = pacoteTs.split("\n").filter((l) => /grafico\?: \{ tipo:/.test(l))[0] || "";
    for (const forma of Object.keys(GRAFICO_DA_FORMA) as Array<keyof typeof GRAFICO_DA_FORMA>) {
      const serie = SERIES[forma];
      const g = graficoParaDados(serie)!;
      expect(g, forma).not.toBeNull();
      expect(g.tipo).toBe(GRAFICO_DA_FORMA[forma].tipo);
      expect(pontosValidos(g.tipo, serie.pontos), forma).not.toBeNull();
      expect(renderToString(h(Grafico, { tipo: g.tipo, dados: serie.pontos, titulo: "Números", fonte: serie.fonte }))).toMatch(/<svg/);
      expect(linhaDoGrafico).toContain(`"${g.tipo}"`);
      expect(agents).toContain(`"${g.tipo}"`);
      expect(ROTULO_DO_GRAFICO[g.tipo].length).toBeGreaterThan(0);
    }
    expect(ROTULO_DO_GRAFICO.rosca).toBe("rosca");
    // O gráfico que o pacote leva é o mesmo tipo.
    const b = pacoteDaBaseDeDesign(null, { tipos: ["numeros"], kitTemFontes: true, serie: SERIES.parte_do_todo })!;
    expect(b.grafico).toMatchObject({ tipo: "rosca", regra: "uupm:chart:3" });
  });

  it("um pacote.ts, um seo.mjs e um Grafico.tsx: sem definição repetida", () => {
    const pacoteTs = ler("workers/motor-codigo/modelo-site/src/lib/pacote.ts");
    expect(pacoteTs.match(/export type BaseDeDesign\b/g) || []).toHaveLength(1);
    expect(pacoteTs.match(/base_de_design\?:/g) || []).toHaveLength(1);
    expect(pacoteTs.match(/fontes_url\?:/g) || []).toHaveLength(1);
    const seo = ler("workers/motor-codigo/modelo-site/scripts/seo.mjs");
    expect(seo.match(/export function urlDasFontes\b/g) || []).toHaveLength(1);
    expect(seo).not.toMatch(/<<<<<<<|>>>>>>>/);
    // Cada chave do que o painel manda em pacote.base_de_design existe no tipo do modelo.
    const apoio = apoioDaPaleta({ marca: [{ hex: "#880516", papel: "primária" }], fundo: "#FFFFFF", texto: "#111111", destaque: "#880516" });
    const variantes = { "hero-1": { id: "video-first-hero", rotulo: "Vídeo primeiro", padrao: "vídeo e CTA", origem: "uupm:landing:video-first-hero" } };
    const b = pacoteDaBaseDeDesign(lerBaseDeDesign({ produto: { id: "40", origem: "jev" }, estilo: { id: "accessible-and-ethical", origem: "jev" }, padrao: { id: "trust-authority-conversion", origem: "jev" }, par: { id: "1", origem: "jev" } }), { tipos: ["hero", "numeros"], kitTemFontes: false, serie: SERIES.tempo, apoio, variantes })!;
    expect(Object.keys(b).sort()).toEqual(["apoio", "consulta", "estilo", "grafico", "padrao", "par", "produto", "regras_ux", "variantes", "versao"]);
    const tipo = pacoteTs.slice(pacoteTs.indexOf("export type BaseDeDesign"), pacoteTs.indexOf("export type Integracoes"));
    for (const k of Object.keys(b)) expect(tipo, k).toMatch(new RegExp(`\\n\\s+${k}\\??:`));
  });

  it("uma casca v5 com a união das listas (embrulho da busca, Grafico, seo, o pacote com a base e, do superpowers, .gitignore e vite.config)", () => {
    const casca = lerCasca(MODELO_DO_SITE)!;
    // Integração UIM + SPM (30/09): as duas frentes subiram para a v3 com listas diferentes; a união é a v4.
    // SPV (30/09): a v5 leva a ponte da prévia editável no vite.config (só no desenvolvimento) aos projetos que já existem.
    expect(casca.versao).toBe(5);
    expect(ler("workers/motor-codigo/modelo-site/vite.config.ts")).toContain('apply: "serve"');
    expect(casca.arquivos).toEqual(expect.arrayContaining(["scripts/uiux.mjs", "src/lib/Grafico.tsx", "scripts/seo.mjs", "scripts/prerender.mjs", "src/lib/pacote.ts", ".gitignore", "vite.config.ts"]));
    expect(casca.arquivos.filter((a, i, l) => l.indexOf(a) !== i)).toEqual([]);
    // A casca das mesas não sobe outra versão por conta própria: é a mesma do motor.
    expect(ler("workers/motor-codigo/modelo-site/.aceleriq/casca.json").match(/"versao"/g) || []).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ apoio da paleta

describe("apoio da paleta: uma regra só para o destaque", () => {
  const BRANCO = { hex: "#FFFFFF", papel: "fundo" };

  it("primária antes do destaque: sobre-destaque, destaque para texto e anel saem do --cor-destaque do site", () => {
    const paleta = [{ hex: "#0B1F3A", papel: "primária" }, { hex: "#F5C518", papel: "destaque" }, BRANCO];
    const tokens = lerTokensDoCss(cssDaMarca({ paleta, dna: { atributos: [{ id: "claro_editorial" }] } }));
    expect(tokens["--cor-destaque"]).toBe("#0b1f3a");
    expect(tokens["--cor-sobre-destaque"]).toBe(textoSobre("#0b1f3a").toLowerCase());
    expect(contraste(tokens["--cor-sobre-destaque"], tokens["--cor-destaque"])).toBeGreaterThanOrEqual(4.5);
    expect(tokens["--cor-anel"]).toBe("#0b1f3a");
    expect(tokens["--cor-destaque-texto"]).toBe("#0b1f3a");
    // O revisarUx do mesmo build não acende mais a 36 (antes: 1,14:1 com o amarelo).
    const css = ":focus-visible{outline:2px solid var(--cor-anel)}@media (prefers-reduced-motion: reduce){*{animation:none}}";
    expect(revisarUx("<main></main><footer></footer>", css, tokens).map((a) => a.regra)).not.toContain("uupm:ux:36");
  });

  it("apoio que veio no pacote calculado para outro destaque é refeito no worker; o do painel já sai certo", () => {
    const paleta = [{ hex: "#0B1F3A", papel: "primária" }, { hex: "#F5C518", papel: "destaque" }, BRANCO];
    const doSite = coresDoSite({ paleta, dna: { atributos: [{ id: "claro_editorial" }] } });
    // Pacote antigo: o apoio do destaque da marca (amarelo), com o mesmo fundo.
    const velho = apoioDaPaleta({ marca: paleta, fundo: doSite.fundo, texto: doSite.texto });
    expect(corDoPapel(velho, "sobre_destaque")).toBe(textoSobre("#F5C518").toUpperCase());
    const pacote = { paleta, base_de_design: { apoio: velho.papeis } };
    const a = apoioDoPacote(pacote, doSite.destaque, doSite.fundo, doSite.texto);
    expect(corDoPapel(a, "sobre_destaque")).toBe(textoSobre("#0b1f3a").toUpperCase());
    expect(corDoPapel(a, "anel")).toBe("#0B1F3A");
    expect(corDoPapel(a, "borda")).toBe(corDoPapel(velho, "borda"));
    expect(a.papeis.filter((p) => p.papel === "anel")).toHaveLength(1);
    // O painel (pacote-do-site) passa o destaque do site: o apoio já nasce com ele.
    const doPainel = apoioDoProduto(paleta, "40", { fundo: doSite.fundo, texto: doSite.texto, destaque: doSite.destaque })!;
    expect(doPainel.destaque).toBe("#0B1F3A");
    expect(corDoPapel(doPainel, "sobre_destaque")).toBe(textoSobre("#0b1f3a").toUpperCase());
    expect(variaveisDoApoio(doPainel)["--cor-destaque-texto"]).toBe("#0b1f3a");
    expect(ler("supabase/functions/_shared/pacote-do-site.ts")).toContain("destaque: doSite.destaque");
  });

  it("destaque antes da primária: o site usa o amarelo e o apoio também (texto escuro no botão, tom que passa no link)", () => {
    const paleta = [{ hex: "#F5C518", papel: "destaque" }, { hex: "#0B1F3A", papel: "primária" }, BRANCO];
    const tokens = lerTokensDoCss(cssDaMarca({ paleta, dna: { atributos: [{ id: "claro_editorial" }] } }));
    expect(tokens["--cor-destaque"]).toBe("#f5c518");
    expect(contraste(tokens["--cor-sobre-destaque"], tokens["--cor-destaque"])).toBeGreaterThanOrEqual(4.5);
    expect(contraste(tokens["--cor-destaque-texto"], tokens["--cor-fundo"])).toBeGreaterThanOrEqual(4.5);
    expect(contraste(tokens["--cor-anel"], tokens["--cor-fundo"])).toBeGreaterThanOrEqual(3);
  });
});

// ------------------------------------------------------------------ todas as páginas

const PAGINA_BOA = `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><a href="#main">Pular para o conteúdo</a><nav>m</nav><main id="main"><h1>Oi</h1><img src="a.png" alt="a"></main><footer>f</footer></body></html>`;
const CONTATO_RUIM = PAGINA_BOA.replace("<h1>Oi</h1>", '<h1>Contato</h1><form><input name="email" type="text" placeholder="Seu e-mail"></form>');
const CSS = ":focus-visible{outline:2px solid red}@media (prefers-reduced-motion: reduce){*{animation:none}}";
const TOKENS = { "--cor-fundo": "#ffffff", "--cor-texto": "#111111", "--cor-destaque": "#880516", "--cor-sobre-destaque": "#ffffff" };

describe("revisão de UX em todas as páginas pré-renderizadas", () => {
  it("o aviso diz a página; o mesmo aviso em várias páginas vira um só; as páginas lidas voltam", () => {
    const r = revisarUxDasPaginas([{ caminho: "/", html: PAGINA_BOA }, { caminho: "/contato/", html: CONTATO_RUIM }], CSS, TOKENS);
    expect(r.paginas).toEqual(["/", "/contato/"]);
    const campo = r.avisos.filter((a) => a.regra === "uupm:ux:43")[0];
    expect(campo.paginas).toEqual(["/contato/"]);
    expect(campo.texto).toMatch(/\(em \/contato\/\)$/);
    expect(r.avisos.map((a) => a.regra)).toEqual(expect.arrayContaining(["uupm:ux:54", "uupm:ux:57", "uupm:ux:58"]));
    // Uma regra do site inteiro (CSS) acende uma vez só, com as duas páginas.
    const semFoco = revisarUxDasPaginas([{ caminho: "/", html: PAGINA_BOA }, { caminho: "/contato/", html: PAGINA_BOA }], "", TOKENS);
    const foco = semFoco.avisos.filter((a) => a.regra === "uupm:ux:28");
    expect(foco).toHaveLength(1);
    expect(foco[0].paginas).toEqual(["/", "/contato/"]);
    expect(foco[0].texto).not.toMatch(/\(em /);
  });

  it("a tela nunca prende a base de forma fixa: dado, textos e revisão só por import dinâmico (carregar.ts)", () => {
    const arquivos: string[] = [];
    (function andar(d: string) {
      for (const n of readdirSync(d)) {
        const c = join(d, n);
        if (statSync(c).isDirectory()) {
          if (n !== "test") andar(c);
        } else if (/\.tsx?$/.test(n)) arquivos.push(c);
      }
    })(resolve(raiz, "src"));
    const pesado = /^import\s+(?!type\b)[^;]*from\s+["'][^"']*(_shared\/uiux\/(dados\/|pt["']|revisao-ux["']|base-completa["']|fontes-do-site["'])|lib\/uiux\/dados\/|\.\/dados\/indice-leve)/m;
    const fixos = arquivos.filter((a) => pesado.test(readFileSync(a, "utf8"))).map((a) => a.slice(raiz.length + 1));
    expect(fixos).toEqual([]);
    // O checklist da Revisão é o leve (sem dado), com os textos que a tela carregou.
    expect(ler("src/components/mesa-site/ChecklistDeUx.tsx")).toContain("itensDoChecklist(base.base.ux,");
    expect(ler("supabase/functions/_shared/uiux/checklist-de-ux.ts")).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']\.\/(dados\/|pt\.ts)/m);
  });

  it("checklist: regra de página só fica ok com todas as páginas lidas; revisão antiga diz 'conferido só na página inicial'", () => {
    const por = (itens: ReturnType<typeof itensDoChecklistDeUx>, no: string) => itens.filter((i) => i.no === no)[0];
    expect(REGRAS_DE_PAGINA).toEqual(expect.arrayContaining(["38", "43", "47", "54", "57", "58"]));
    const antiga = itensDoChecklistDeUx(REGRAS_DE_UX_DA_BASE, { avisos: [], revisado: true, paginasDoSite: 2 });
    expect(por(antiga, "43")).toMatchObject({ estado: "pendente", origem: "conferido só na página inicial" });
    expect(por(antiga, "38")).toMatchObject({ estado: "pendente", origem: "conferido só na página inicial" });
    expect(por(antiga, "9")).toMatchObject({ estado: "ok", origem: "conferido no código" });
    const umaPagina = itensDoChecklistDeUx(REGRAS_DE_UX_DA_BASE, { avisos: [], revisado: true, paginasDoSite: 1 });
    expect(por(umaPagina, "43")).toMatchObject({ estado: "ok", origem: "conferido no código" });
    const metade = itensDoChecklistDeUx(REGRAS_DE_UX_DA_BASE, { avisos: [], revisado: true, paginas: ["/"], paginasDoSite: 2 });
    expect(por(metade, "43")).toMatchObject({ estado: "pendente", origem: "conferido em 1 de 2 páginas" });
    const todas = itensDoChecklistDeUx(REGRAS_DE_UX_DA_BASE, { avisos: [], revisado: true, paginas: ["/", "/contato/"], paginasDoSite: 2 });
    expect(por(todas, "43")).toMatchObject({ estado: "ok", origem: "conferido no código em 2 páginas" });
    const r = revisarUxDasPaginas([{ caminho: "/", html: PAGINA_BOA }, { caminho: "/contato/", html: CONTATO_RUIM }], CSS, TOKENS);
    const comFalha = itensDoChecklistDeUx(REGRAS_DE_UX_DA_BASE, { avisos: r.avisos, revisado: true, paginas: r.paginas, paginasDoSite: 2 });
    expect(por(comFalha, "43")).toMatchObject({ estado: "falhou" });
    expect(por(comFalha, "43").detalhe).toMatch(/\/contato\//);
    expect(ler("src/components/mesa-site/ChecklistDeUx.tsx")).toContain("paginas, paginasDoSite");
  });
});

// ------------------------------------------------------------------ worker: páginas e prova do agente

function git(pasta: string, ...args: string[]) {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], { cwd: pasta, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
const escrever = (pasta: string, caminho: string, texto: string) => {
  mkdirSync(dirname(join(pasta, caminho)), { recursive: true });
  writeFileSync(join(pasta, caminho), texto);
};

describe("worker: revisão de UX do projeto (páginas do mapa e prova por um leitor só)", () => {
  it("lê as páginas do mapa, a prova pelo nome da regra, e descarta a velha e a de seção fora do mapa", async () => {
    const pasta = temp("revisao");
    git(pasta, "init", "-q", "-b", "main");
    const pacote = { secoes: ["hero", "contato"], globais: ["topo"], paginas: [{ id: "inicio", slug: "", titulo: "Início", secoes: ["hero"] }, { id: "contato", slug: "contato", titulo: "Contato", secoes: ["contato"] }] };
    escrever(pasta, ".aceleriq/pacote.json", JSON.stringify(pacote));
    escrever(pasta, "src/marca.css", ":root {\n  --cor-destaque: #880516;\n  --cor-fundo: #ffffff;\n  --cor-texto: #111111;\n  --cor-sobre-destaque: #ffffff;\n}\n");
    // O mapa de nomes das regras vem da skill do worker (workers/motor-codigo/vendor), não do projeto.
    // Passada 1: hero e contato com prova (hero cita pelo NOME, como o AGENTS.md permite), e uma seção que saiu do mapa.
    escrever(pasta, "src/secoes/Hero.tsx", "export default 1;\n");
    escrever(pasta, "src/secoes/Contato.tsx", "export default 1;\n");
    escrever(pasta, "src/secoes/Antiga.tsx", "export default 1;\n");
    escrever(pasta, ".aceleriq/ux/hero.json", JSON.stringify({ conferidas: ["Focus States", "uupm:ux:69"], pendentes: [{ regra: "Touch Friendly", motivo: "botão com 32 px" }] }));
    escrever(pasta, ".aceleriq/ux/contato.json", JSON.stringify({ conferidas: ["uupm:ux:66"], pendentes: [] }));
    escrever(pasta, ".aceleriq/ux/antiga.json", JSON.stringify({ conferidas: ["uupm:ux:66"], pendentes: [] }));
    git(pasta, "add", "-A");
    git(pasta, "commit", "-q", "-m", "Seções");
    escrever(pasta, "dist/index.html", PAGINA_BOA);
    escrever(pasta, "dist/contato/index.html", CONTATO_RUIM);
    escrever(pasta, "dist/assets/index-a1.css", CSS);

    const r1 = await revisaoDeUx(pasta);
    expect(r1.paginas).toEqual(["/", "/contato/"]);
    expect(r1.avisos.filter((a) => a.regra === "uupm:ux:43")[0].paginas).toEqual(["/contato/"]);
    const hero = r1.agente.filter((p) => p.secao === "hero")[0];
    // O nome "Focus States" vira o id da base (o evento da passada e o checklist contam igual).
    expect(hero.conferidas).toEqual(["uupm:ux:28", "uupm:ux:69"]);
    expect(hero.pendentes).toEqual([{ regra: "uupm:ux:66", motivo: "botão com 32 px" }]);
    expect(r1.agente.map((p) => p.secao).sort()).toEqual(["contato", "hero"]);
    // O checklist conta o que o evento da passada contou: o 28 pelo nome entra, o 66 pendente vira falha.
    const antes = itensDoChecklistDeUx(REGRAS_DE_UX_DA_BASE, { avisos: r1.avisos, revisado: true, agente: r1.agente, paginas: r1.paginas, paginasDoSite: 2 });
    expect(antes.filter((i) => i.no === "69")[0]).toMatchObject({ estado: "ok", origem: "o agente conferiu", secao: "hero" });
    expect(antes.filter((i) => i.no === "66")[0]).toMatchObject({ estado: "falhou", detalhe: "botão com 32 px" });

    // Passada 2: o hero foi refeito sem prova nova. A prova velha deixa de contar; a do contato continua.
    escrever(pasta, "src/secoes/Hero.tsx", "export default 2;\n");
    git(pasta, "add", "-A");
    git(pasta, "commit", "-q", "-m", "Ajuste: hero");
    const r2 = await revisaoDeUx(pasta);
    expect(r2.agente.map((p) => p.secao)).toEqual(["contato"]);
    const itens = itensDoChecklistDeUx(REGRAS_DE_UX_DA_BASE, { avisos: r2.avisos, revisado: true, agente: r2.agente, paginas: r2.paginas, paginasDoSite: 2 });
    expect(itens.filter((i) => i.no === "69")[0]).toMatchObject({ estado: "pendente", origem: "o agente confere ao construir" });
    expect(itens.filter((i) => i.no === "66")[0]).toMatchObject({ estado: "ok", origem: "o agente conferiu", secao: "contato" });
    // A seção que saiu do mapa não aparece nunca.
    expect(r2.agente.some((p) => p.secao === "antiga")).toBe(false);

    // Passada 3: hero refeito COM prova nova (mesmo commit): volta a contar.
    escrever(pasta, "src/secoes/Hero.tsx", "export default 3;\n");
    escrever(pasta, ".aceleriq/ux/hero.json", JSON.stringify({ conferidas: ["uupm:ux:69"], pendentes: [] }));
    git(pasta, "add", "-A");
    git(pasta, "commit", "-q", "-m", "Ajuste: hero de novo");
    const r3 = await revisaoDeUx(pasta);
    expect(r3.agente.filter((p) => p.secao === "hero")[0].conferidas).toEqual(["uupm:ux:69"]);
  }, 60_000);

  it("peças puras: páginas e seções do pacote, ordem no git e frescor", () => {
    expect(slugsDoPacote({ paginas: [{ slug: "" }, { slug: "sobre" }, { slug: "../x" }, { slug: "sobre" }] })).toEqual(["", "sobre"]);
    expect(secoesDoPacote({ secoes: ["hero"], globais: ["topo"], paginas: [{ secoes: ["hero", "faq"] }] })).toEqual(["hero", "topo", "faq"]);
    const ordem = ordemNoGit("\u0001aaa\n\nsrc/secoes/Hero.tsx\n\n\u0001bbb\n\n.aceleriq/ux/hero.json\nsrc/secoes/Hero.tsx\n.aceleriq/ux/faq.json\nsrc/secoes/Faq.tsx\n");
    expect(ordem).toEqual({ "src/secoes/Hero.tsx": 0, ".aceleriq/ux/hero.json": 1, ".aceleriq/ux/faq.json": 1, "src/secoes/Faq.tsx": 1 });
    expect(provaFresca("hero", ordem)).toBe(false);
    expect(provaFresca("faq", ordem)).toBe(true);
    expect(provaFresca("topo", ordem)).toBe(false);
    expect(arquivosDaSecao("hero", { "src/secoes/Hero.tsx": 0, "src/secoes/HeroDividido.tsx": 0, "src/secoes/Hero/Fundo.tsx": 1 })).toEqual(["src/secoes/Hero.tsx", "src/secoes/Hero/Fundo.tsx"]);
    const vazia = temp("sem-dist");
    expect(paginasDoBuild(vazia, { paginas: [{ slug: "contato" }] })).toEqual([]);
  });
});

// ------------------------------------------------------------------ estilo da base

describe("o estilo da base muda o site (DNA do próprio estilo)", () => {
  const site = (extra: Partial<LinhaDoSite> = {}) => ({ id: "s", client_id: "c", estilo: { preset: "saas_limpo", motion: [] }, dna: { atributos: [{ id: "bento", prob: null }], movimento: "sutil", nivel: "saas", nicho: "servico_local", cores_das_referencias: [], observacoes: "", fonte: "manual" }, direcao: {}, ...extra }) as unknown as LinhaDoSite;

  it("todo DNA do mapa existe na casa e cabe no limite", () => {
    for (const id of Object.keys(PRESET_DO_ESTILO)) {
      const dna = PRESET_DO_ESTILO[id].dna;
      expect(dna.length, id).toBeGreaterThan(0);
      expect(dna.length, id).toBeLessThanOrEqual(MAX_ATRIBUTOS);
      for (const a of dna) expect(ATRIBUTOS_DO_DNA.some((x) => x.id === a), `${id}: ${a}`).toBe(true);
    }
  });

  it("escolher o estilo aplica o DNA dele mesmo com o preset igual; estilos do mesmo preset ficam diferentes", () => {
    const neu = camposDoEstilo(site(), { preset: PRESET_DO_ESTILO.neumorphism.preset, aplicarDna: true, atributos: PRESET_DO_ESTILO.neumorphism.dna });
    expect((neu.dna as { atributos: Array<{ id: string }> }).atributos.map((a) => a.id)).toEqual(["claro_editorial", "profundidade", "minimalista"]);
    const acessivel = camposDoEstilo(site(), { preset: "saas_limpo", aplicarDna: true, atributos: PRESET_DO_ESTILO["accessible-and-ethical"].dna });
    expect((acessivel.dna as { atributos: Array<{ id: string }> }).atributos.map((a) => a.id)).toEqual(["claro_editorial", "minimalista"]);
    // Sem o estilo (troca de preset pela pessoa): o comportamento de antes, DNA só quando o preset muda.
    expect(camposDoEstilo(site(), { preset: "saas_limpo" }).dna).toBeUndefined();
    const doSaas = Object.keys(PRESET_DO_ESTILO).filter((id) => PRESET_DO_ESTILO[id].preset === "saas_limpo").map((id) => PRESET_DO_ESTILO[id].dna.join(","));
    expect(doSaas.filter((d, i, l) => l.indexOf(d) === i).length).toBeGreaterThan(1);
    expect(ler("supabase/functions/mesa-site/base-de-design.ts")).toContain("atributos: lig.dna");
  });

  it("o bloco 3 do prompt da seção leva as variáveis e o checklist do estilo", () => {
    const base = pacoteDaBaseDeDesign(lerBaseDeDesign({ estilo: { id: "neumorphism", origem: "equipe" } }), { tipos: ["hero"], kitTemFontes: true })!;
    const pacote = { cliente: "X", marca: { nome: "X" }, paleta: [], fontes: [], dna: null, direcao: {}, copy: null, imagens: [], fotos_reais: [], logo: null, secoes: ["hero"], base_de_design: base } as unknown as PacoteDoSite;
    const bloco3 = promptDaSecao(pacote, "hero").split("\n").filter((l) => /^3\. ESTILO E DNA/.test(l))[0];
    expect(bloco3).toContain("Estilo da base: ");
    expect(bloco3).toContain(`Variáveis do estilo (medidas, raios, sombras; cor e fonte vêm do pacote): ${base.estilo!.variaveis}`);
    expect(bloco3).toContain(`Checklist do estilo: ${base.estilo!.checklist}`);
    expect(bloco3).toContain("A paleta e as fontes do pacote vencem");
  });
});

// ------------------------------------------------------------------ diretor de site

describe("diretor de site: a sugestão do Jev fica fora do prompt", () => {
  const cheia = () => {
    const perguntas = { ...perguntasDaBase(BASE_COMPLETA, { par: true }), ...perguntasDoRerank(BASE_COMPLETA, ["neumorphism", "accessible-and-ethical", "brutalism", "flat-design"]) };
    const probabilidades: Record<string, Record<string, number>> = {};
    for (const q of Object.keys(perguntas)) {
      const criterios = (perguntas[q] as { criteria?: unknown }).criteria;
      const chaves = Array.isArray(criterios) ? criterios.map((_, i) => String(i)) : Object.keys((criterios as Record<string, string>) || { sim: "", nao: "" });
      probabilidades[q] = {};
      for (const k of chaves) probabilidades[q][k] = Math.round(10000 / chaves.length) / 10000;
    }
    return lerBaseDeDesign({ produto: { id: "40", origem: "jev", rotulo: "Serviços jurídicos" }, estilo: { id: "accessible-and-ethical", origem: "jev" }, padrao: { id: "trust-authority-conversion", origem: "jev" }, par: null, ux: { "3": "ok", "21": "nao_se_aplica" }, sugestao: { em: "2026-09-30T10:00:00Z", probabilidades } });
  };

  it("a direção vai sem as probabilidades e sem as marcações de UX, dentro do teto do bloco da base", () => {
    const b = cheia();
    const direcao = { secoes: ["hero", "servicos", "contato"], nicho: "servico_local", base_de_design: b };
    const bruto = JSON.stringify(direcao).length;
    expect(bruto).toBeGreaterThan(5 * TETO_DO_BLOCO_DO_DIRETOR);
    const paraOAgente = direcaoParaOAgente(direcao);
    const tamanho = JSON.stringify(paraOAgente).length;
    expect(tamanho).toBeLessThan(TETO_DO_BLOCO_DO_DIRETOR);
    expect(JSON.stringify(paraOAgente)).not.toMatch(/sugestao|probabilidades|nao_se_aplica/);
    expect((paraOAgente.base_de_design as { produto: unknown }).produto).toEqual({ id: "40", origem: "jev", rotulo: "Serviços jurídicos" });
    expect(paraOAgente.secoes).toEqual(["hero", "servicos", "contato"]);
    expect(direcaoParaOAgente({ nicho: "x" })).toEqual({ nicho: "x" });
    expect(ler("supabase/functions/mesa-site/index.ts")).toContain("direcao: direcaoParaOAgente(s.direcao)");
  });

  it("site novo da mesma marca herda as escolhas, não a sugestão nem as marcações", () => {
    const h2 = baseHerdada(cheia());
    expect(h2.sugestao).toBeUndefined();
    expect(h2.ux).toEqual({});
    expect(h2.produto).toMatchObject({ id: "40" });
    expect(ler("supabase/functions/mesa-site/base-de-design.ts")).toContain("baseHerdada(validarBaseDeDesign(");
  });
});
