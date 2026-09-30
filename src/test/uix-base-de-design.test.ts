import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lerCsv, objetosDoCsv } from "../../supabase/functions/_shared/uiux/csv";
import * as estilos from "../../supabase/functions/_shared/uiux/dados/estilos";
import * as produtos from "../../supabase/functions/_shared/uiux/dados/produtos";
import * as paletas from "../../supabase/functions/_shared/uiux/dados/paletas";
import * as raciocinio from "../../supabase/functions/_shared/uiux/dados/raciocinio";
import * as pares from "../../supabase/functions/_shared/uiux/dados/pares";
import * as landing from "../../supabase/functions/_shared/uiux/dados/landing";
import * as ux from "../../supabase/functions/_shared/uiux/dados/ux";
import * as graficos from "../../supabase/functions/_shared/uiux/dados/graficos";
import { FONTES_DA_BASE } from "../../supabase/functions/_shared/uiux/dados/fontes";
import { VERSAO_DA_BASE } from "../../supabase/functions/_shared/uiux/dados/versao";
import * as leve from "../../src/lib/uiux/dados/indice-leve";
import { ESTILO_EM_PORTUGUES, REGRA_DE_UX_EM_PORTUGUES, ROTULO_DO_PADRAO, ROTULO_DO_PRODUTO } from "../../supabase/functions/_shared/uiux/pt";
import { modoDaRegra, PADROES_POR_TIPO, PRESET_DO_ESTILO, REGRAS_POR_CODIGO, secoesDaOrdem } from "../../supabase/functions/_shared/uiux/mapeamentos";
import { BASE_COMPLETA } from "../../supabase/functions/_shared/uiux/base-completa";
import { estilosDoProduto, padraoDoProduto, paletaDoSetor } from "../../supabase/functions/_shared/uiux/consultas";
import { ATRIBUTOS_DO_DNA } from "../../supabase/functions/_shared/site-metodo";
import { ehSecaoDaBiblioteca, PRESETS_DE_ESTILO } from "../../supabase/functions/_shared/site-biblioteca";
import { ARQUIVO_DO_INDICE_LEVE, BASES as BASES_DO_GERADOR, conferir, PASTA_DA_BASE, PASTA_DOS_DADOS } from "../../scripts/uiux/importar-base.mjs";

/**
 * Frente UXM (30/09/2026): a base UI UX Pro Max 2.15.0 entra como TS gerado
 * por script, não como tabela. Este teste prova que o que está no código é o
 * que está nos CSV fixados na cópia do motor (workers/motor-codigo/vendor,
 * uma cópia só no repositório; dois leitores de CSV independentes com toEqual,
 * SHA-256 de cada arquivo, contagens contra o catalog-summary.json), que as
 * tabelas escritas à mão cobrem a base inteira, que nada da base vira código
 * executável e que a base cabe no limite da publicação das funções.
 */

const raiz = process.cwd();
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8").replace(/\r\n?/g, "\n");
const daBase = (arquivo: string) => ler(`${PASTA_DA_BASE}/${arquivo}`);
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

const BASES: Array<[string, { COLUNAS: Record<string, string> }, unknown[]]> = [
  ["styles.csv", estilos, estilos.ESTILOS_DA_BASE],
  ["products.csv", produtos, produtos.PRODUTOS_DA_BASE],
  ["colors.csv", paletas, paletas.PALETAS_DA_BASE],
  ["ui-reasoning.csv", raciocinio, raciocinio.RACIOCINIO_DA_BASE],
  ["typography.csv", pares, pares.PARES_DA_BASE],
  ["landing.csv", landing, landing.PADROES_DA_BASE],
  ["ux-guidelines.csv", ux, ux.REGRAS_DE_UX_DA_BASE],
  ["charts.csv", graficos, graficos.GRAFICOS_DA_BASE],
];

describe("igualdade com a base fixada (a cópia do motor, npm 2.15.0)", () => {
  it("cada base: o outro leitor de CSV, com o mesmo mapa de colunas, dá o mesmo array (toEqual)", () => {
    for (const [arquivo, modulo, gerado] of BASES) {
      expect(objetosDoCsv(daBase(arquivo), modulo.COLUNAS), arquivo).toEqual(gerado);
    }
  });

  it("o leitor do teste entende aspas, vírgula e quebra de linha dentro do campo, e BOM", () => {
    expect(lerCsv('﻿a,"b ""x"", c\nd",e\r\n1,,3\n')).toEqual([["a", 'b "x", c\nd', "e"], ["1", "", "3"]]);
  });

  it("fontes: as famílias dos pares com categoria, pesos, licença e latin, derivadas de novo aqui", () => {
    const gf: Record<string, Record<string, string>> = {};
    const [cab, ...linhas] = lerCsv(daBase("google-fonts.csv"));
    for (const l of linhas) {
      const o: Record<string, string> = {};
      cab.forEach((c, i) => (o[c] = l[i]));
      gf[o.Family] = o;
    }
    const lic: Record<string, string> = {};
    for (const f of JSON.parse(daBase("google-font-licenses.json")).families as Array<{ name: string; license: string }>) lic[f.name] = f.license;
    const familias: string[] = [];
    for (const p of pares.PARES_DA_BASE) for (const f of [p.titulo, p.texto]) if (familias.indexOf(f) < 0) familias.push(f);
    const esperado = familias.map((f) => {
      const estilosDaFamilia = gf[f].Styles.split("|").map((x) => x.trim()).filter(Boolean);
      return {
        familia: f,
        categoria: gf[f].Category,
        pesos: estilosDaFamilia.filter((x) => /^\d+$/.test(x)).map(Number).sort((a, b) => a - b),
        italico: estilosDaFamilia.some((x) => /^\d+i$/.test(x)),
        licenca: lic[f] === "APACHE2" ? "Apache" : lic[f],
        latin: gf[f].Subsets.split("|").map((x) => x.trim()).indexOf("latin") >= 0,
      };
    });
    expect(FONTES_DA_BASE).toEqual(esperado);
  });

  it("o índice leve da tela é a projeção exata das bases completas", () => {
    const proj = <T extends Record<string, string>>(l: T[], campos: string[], filtro?: (r: T) => boolean) => l.filter((r) => (filtro ? filtro(r) : true)).map((r) => campos.reduce((o: Record<string, string>, c) => ((o[c] = r[c]), o), {}));
    expect(leve.ESTILOS_LEVES).toEqual(proj(estilos.ESTILOS_DA_BASE, Object.keys(leve.ESTILOS_LEVES[0])));
    expect(leve.PRODUTOS_LEVES).toEqual(proj(produtos.PRODUTOS_DA_BASE, ["no", "nome", "estiloPrincipal", "estilosSecundarios", "padrao"]));
    expect(leve.RACIOCINIO_LEVE).toEqual(proj(raciocinio.RACIOCINIO_DA_BASE, ["no", "categoria", "padrao", "humorDeTipo"]));
    expect(leve.PADROES_LEVES).toEqual(proj(landing.PADROES_DA_BASE, ["no", "id", "nome", "apelidos", "ordem", "cta"]));
    expect(leve.REGRAS_DE_UX_LEVES).toEqual(proj(ux.REGRAS_DE_UX_DA_BASE, ["no", "categoria", "problema", "plataforma", "severidade", "codigoBom"], (r) => r.plataforma === "Web" || r.plataforma === "All"));
  });

  it("SHA-256 de cada arquivo (em LF) igual ao registrado: CSV trocado sem gerar de novo quebra", () => {
    const registrados = VERSAO_DA_BASE.sha256 as Record<string, string>;
    expect(Object.keys(registrados).sort()).toEqual(["charts.csv", "colors.csv", "google-font-licenses.json", "google-fonts.csv", "landing.csv", "products.csv", "styles.csv", "typography.csv", "ui-reasoning.csv", "ux-guidelines.csv"]);
    for (const arquivo of Object.keys(registrados)) expect(sha(daBase(arquivo)), arquivo).toBe(registrados[arquivo]);
    expect(VERSAO_DA_BASE.versao).toBe("2.15.0");
    expect(VERSAO_DA_BASE.integridade).toBe("sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==");
    expect(VERSAO_DA_BASE.gitHead).toBe("a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5");
  });

  it("contagens iguais às do catalog-summary.json da própria base (oráculo independente)", () => {
    const resumo = JSON.parse(daBase("catalog-summary.json"));
    expect(estilos.ESTILOS_DA_BASE.length).toBe(resumo.counts.styles.total);
    expect(estilos.ESTILOS_DA_BASE.filter((e) => e.status === "active").length).toBe(resumo.counts.styles.active);
    expect(produtos.PRODUTOS_DA_BASE.length).toBe(resumo.counts.products);
    expect(paletas.PALETAS_DA_BASE.length).toBe(resumo.counts.palettes);
    expect(raciocinio.RACIOCINIO_DA_BASE.length).toBe(resumo.counts.reasoningProfiles);
    expect(pares.PARES_DA_BASE.length).toBe(resumo.counts.fontPairings);
    expect(ux.REGRAS_DE_UX_DA_BASE.length).toBe(resumo.counts.uxGuidelines);
    expect(graficos.GRAFICOS_DA_BASE.length).toBe(resumo.counts.chartTypes);
    expect(landing.PADROES_DA_BASE.length).toBe(34);
    expect(sha(daBase("google-fonts.csv"))).toBe(resumo.snapshots["google-fonts.csv"].sha256);
    expect(sha(daBase("google-font-licenses.json"))).toBe(resumo.snapshots["google-font-licenses.json"].sha256);
    expect(VERSAO_DA_BASE.contagens).toMatchObject({ estilos: 88, estilosAtivos: 50, produtos: 192, paletas: 192, raciocinio: 192, pares: 74, fontes: 91, padroes: 34, ux: 119, uxWeb: 109, graficos: 25 });
  });

  it("o gerador com --conferir não acha diferença entre o que ele produz e o disco", () => {
    expect(conferir(raiz)).toEqual([]);
  });

  it("licença e origem ao lado da base (o pacote npm não traz o LICENSE)", () => {
    expect(ler("workers/motor-codigo/vendor/ui-ux-pro-max/LICENSE")).toMatch(/Copyright \(c\) 2024 Next Level Builder/);
    expect(ler("workers/motor-codigo/vendor/ui-ux-pro-max/ORIGEM.md")).toMatch(/ui-ux-pro-max-cli/);
    expect(ler("docs/licencas/ui-ux-pro-max-MIT.txt")).toMatch(/Next Level Builder/);
    expect(ler("docs/motores/REPOSITORIOS.md")).toMatch(/nextlevelbuilder\/ui-ux-pro-max-skill/);
  });

  it("uma cópia só da base no repositório: o gerador lê a do motor, e a pasta vendor/ da raiz não volta", () => {
    expect(PASTA_DA_BASE).toBe("workers/motor-codigo/vendor/ui-ux-pro-max/data");
    for (const arquivo of Object.keys(VERSAO_DA_BASE.sha256)) expect(existsSync(resolve(raiz, PASTA_DA_BASE, arquivo)), arquivo).toBe(true);
    expect(existsSync(resolve(raiz, "vendor/ui-ux-pro-max"))).toBe(false);
  });
});

describe("cobertura das tabelas escritas à mão", () => {
  it("todo produto tem rótulo em português e paleta com o mesmo tipo de produto", () => {
    for (const p of produtos.PRODUTOS_DA_BASE) {
      expect(ROTULO_DO_PRODUTO[p.no], p.nome).toBeTruthy();
      expect(paletaDoSetor(BASE_COMPLETA, p.no), p.nome).not.toBeNull();
    }
    expect(Object.keys(ROTULO_DO_PRODUTO).length).toBe(192);
  });

  it("todo estilo ativo tem texto em português, preset da casa válido e atributos do DNA válidos", () => {
    const ativos = estilos.ESTILOS_DA_BASE.filter((e) => e.status === "active");
    const presets = PRESETS_DE_ESTILO.map((p) => p.id);
    const atributos = ATRIBUTOS_DO_DNA.map((a) => a.id);
    for (const e of ativos) {
      expect(ESTILO_EM_PORTUGUES[e.id], e.id).toBeTruthy();
      expect(presets, e.id).toContain(PRESET_DO_ESTILO[e.id].preset);
      for (const a of PRESET_DO_ESTILO[e.id].dna) expect(atributos, `${e.id}: ${a}`).toContain(a);
    }
    expect(Object.keys(ESTILO_EM_PORTUGUES).sort()).toEqual(ativos.map((e) => e.id).sort());
    expect(Object.keys(PRESET_DO_ESTILO).sort()).toEqual(ativos.map((e) => e.id).sort());
  });

  it("todo padrão tem rótulo e resolve para pelo menos 3 seções da biblioteca (o resto fica listado)", () => {
    for (const p of landing.PADROES_DA_BASE) {
      expect(ROTULO_DO_PADRAO[p.id], p.id).toBeTruthy();
      const r = secoesDaOrdem(p.ordem);
      expect(r.secoes.length, p.id).toBeGreaterThanOrEqual(3);
      for (const s of r.secoes) expect(ehSecaoDaBiblioteca(s), `${p.id}: ${s}`).toBe(true);
    }
    const permitidos = Object.values(PADROES_POR_TIPO).reduce((a: string[], l) => a.concat(l), []);
    for (const id of permitidos) expect(landing.PADROES_DA_BASE.some((p) => p.id === id), id).toBe(true);
    for (const p of landing.PADROES_DA_BASE) expect(permitidos, p.id).toContain(p.id);
  });

  it("toda regra de UX da web tem título, como corrigir e modo; cerca de 20 são por código", () => {
    const web = ux.REGRAS_DE_UX_DA_BASE.filter((r) => r.plataforma === "Web" || r.plataforma === "All");
    expect(web.length).toBe(109);
    for (const r of web) {
      expect(REGRA_DE_UX_EM_PORTUGUES[r.no], r.no).toBeTruthy();
      expect(REGRA_DE_UX_EM_PORTUGUES[r.no].titulo.length, r.no).toBeGreaterThan(3);
      expect(REGRA_DE_UX_EM_PORTUGUES[r.no].corrigir.length, r.no).toBeGreaterThan(10);
      expect(["codigo", "agente", "manual", "nao_se_aplica"], r.no).toContain(modoDaRegra(r.no).modo);
    }
    expect(Object.keys(REGRA_DE_UX_EM_PORTUGUES).length).toBe(109);
    expect(REGRAS_POR_CODIGO.length).toBeGreaterThanOrEqual(18);
    expect(REGRAS_POR_CODIGO.length).toBeLessThanOrEqual(24);
    for (const n of REGRAS_POR_CODIGO) expect(web.some((r) => r.no === n), n).toBe(true);
  });

  it("todo par tem as duas famílias nas fontes da base, com OFL ou Apache e o subconjunto latin", () => {
    for (const p of pares.PARES_DA_BASE) {
      for (const f of [p.titulo, p.texto]) {
        const fonte = FONTES_DA_BASE.filter((x) => x.familia === f)[0];
        expect(fonte, `${p.nome}: ${f}`).toBeTruthy();
        expect(["OFL", "Apache"]).toContain(fonte.licenca);
        expect(fonte.latin, f).toBe(true);
      }
    }
    expect(FONTES_DA_BASE.length).toBe(91);
  });

  it("todo produto chega a estilo ativo e a padrão de landing pelas buscas exatas", () => {
    for (const p of produtos.PRODUTOS_DA_BASE) {
      expect(estilosDoProduto(BASE_COMPLETA, p).principais.length, p.nome).toBeGreaterThan(0);
      expect(padraoDoProduto(BASE_COMPLETA, p), p.nome).not.toBeNull();
    }
  });
});

describe("texto e código seguros", () => {
  const UIUX = "supabase/functions/_shared/uiux";
  const aMao = ["pt.ts", "mapeamentos.ts", "consultas.ts", "jev-da-base.ts", "apoio-da-paleta.ts", "revisao-ux.ts", "checklist-de-ux.ts", "citar.ts", "csv.ts", "base-completa.ts"].map((f) => `${UIUX}/${f}`).concat(["supabase/functions/_shared/site-variantes.ts", "supabase/functions/mesa-site/base-de-design.ts", "supabase/functions/mesa-identidade/base-acoes.ts"]);

  it("nenhum texto escrito à mão com travessão", () => {
    for (const p of aMao) expect(ler(p), p).not.toMatch(/[—–]/);
  });

  it("as regras de decisão da base nem entram no painel, e nada da base vira código (eval, Function)", () => {
    for (const f of readdirSync(resolve(raiz, UIUX)).filter((x) => /\.ts$/.test(x))) {
      const t = ler(`${UIUX}/${f}`);
      expect(t, f).not.toMatch(/\beval\s*\(|new Function|\bFunction\s*\(/);
      expect(t, f).not.toMatch(/regrasDeDecisao|Decision_Rules/);
    }
    expect(ler(`${UIUX}/dados/raciocinio.ts`)).not.toMatch(/Decision_Rules/);
  });

  it("dados gerados só em ASCII (Safari 11: nada de U+2028 cru) e sem recurso de regex novo nos arquivos à mão", () => {
    for (const f of readdirSync(resolve(raiz, `${UIUX}/dados`))) {
      // Comentário pode ter acento; o que vira dado (literais) não.
      const codigo = ler(`${UIUX}/dados/${f}`).split("\n").filter((l) => !/^\s*(\/\*\*|\*|\/\/)/.test(l));
      expect(codigo.join("\n"), f).not.toMatch(/[^\x00-\x7e]/);
    }
    const semComentario = (t: string) => t.split("\n").filter((l) => !/^\s*(\/\*\*|\*|\/\/)/.test(l)).join("\n");
    for (const p of aMao) expect(semComentario(ler(p)), p).not.toMatch(/\(\?<[=!]|\\p\{|\(\?<[a-z]|\.at\(/i);
  });
});

describe("a base cabe na publicação das funções (limite do Lovable)", () => {
  // Tudo o que fica em supabase/functions fora das pastas de função sobe com o App MCP do Lovable, que recusa
  // acima de ~4,4 MB (guarda do main em 4 MB, compartilhados-no-limite-do-lovable.test.ts). A base leva só as
  // colunas que o servidor usa, em linhas compactas; o índice leve da tela fica em src/.
  const tamanho = (p: string): number => (statSync(p).isFile() ? statSync(p).size : readdirSync(p).reduce((t, n) => t + tamanho(join(p, n)), 0));

  it("a base nas funções fica no orçamento (dados até 320 KB, pasta uiux até 480 KB)", () => {
    expect(tamanho(resolve(raiz, PASTA_DOS_DADOS))).toBeLessThan(320_000);
    expect(tamanho(resolve(raiz, "supabase/functions/_shared/uiux"))).toBeLessThan(480_000);
  });

  it("o índice leve da tela mora em src/, fora das funções", () => {
    expect(ARQUIVO_DO_INDICE_LEVE.indexOf("src/")).toBe(0);
    expect(existsSync(resolve(raiz, ARQUIVO_DO_INDICE_LEVE))).toBe(true);
    expect(existsSync(resolve(raiz, PASTA_DOS_DADOS, "indice-leve.ts"))).toBe(false);
  });

  it("só as colunas que o código usa: nada das colunas pesadas que ninguém lê", () => {
    const colunas = BASES_DO_GERADOR.reduce((l: string[], b: { colunas: Record<string, string> }) => l.concat(Object.values(b.colunas)), []);
    for (const pesada of ["AI Prompt Keywords", "CSS/Technical Keywords", "Decision_Rules", "Key Considerations", "Tailwind Config", "CSS Import", "Code Example Bad", "Conversion Optimization"]) {
      expect(colunas, pesada).not.toContain(pesada);
    }
  });
});
