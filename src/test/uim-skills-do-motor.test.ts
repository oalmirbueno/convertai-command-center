// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { acaoDoPedido, ambienteDoOpencode, casaCuringa, COMANDOS_LIBERADOS, configDoOpencode, ferramentaLigada, negarPrimeiro, PASTA_CASA_DO_OPENCODE, SKILLS_DA_CASA } from "../../workers/motor-codigo/lib/config-opencode";
import { atualizarCasca, copiaDoModelo, lerCasca, MODELO_DO_SITE, pastaDaCascaValida } from "../../workers/motor-codigo/lib/projeto";
import { consultaDaSecao, eventoDaConsulta, idsDasRegrasDeUx, lerCsv, lerLogDaBase, lerProvaDeUx, normalizarProvaDeUx, resumoDaBaseNaEntrega, totalDaBase } from "../../workers/motor-codigo/lib/prova-da-base";
import { acharPython, buscar, cortarSaida, opcaoCompleta, prepararArgumentos, SEM_PYTHON } from "../../workers/motor-codigo/modelo-site/scripts/uiux.mjs";
import { conferirManifesto, foraDaCopia, IRMAS, problemasDoSkillMd } from "../../workers/motor-codigo/scripts/instalar-ui-ux-pro-max.mjs";
import { linksDasFontes, montarPagina, urlDasFontes } from "../../workers/motor-codigo/modelo-site/scripts/seo.mjs";

/**
 * Frente UIM (30/09): a skill ui-ux-pro-max no motor de código, ao lado das
 * skills do superpowers, com o agente isolado (só as skills da casa), o bash
 * ligado de verdade (a ÚLTIMA regra que casa vence no opencode), o embrulho
 * do buscador e a prova de consulta que o worker publica.
 */

const raiz = resolve(__dirname, "../..");
const MODELO = resolve(raiz, "workers/motor-codigo/modelo-site");
const SKILLS = resolve(MODELO, ".opencode/skills");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const MODELO_FALSO = { id: "m", provedor: "openrouter", modelo_api: "deepseek/deepseek-v4-flash", preco_entrada_1m: 0.0763, preco_saida_1m: 0.1526, preco_cache_1m: 0.01526, contexto_tokens: 1_000_000 };
const temp = (nome: string) => mkdtempSync(join(tmpdir(), `uim-${nome}-`));

describe("permissões do opencode: a última regra que casa vence", () => {
  it("bash e skill com \"*\": \"deny\" em PRIMEIRO lugar; o liberado vem depois", () => {
    const c = configDoOpencode(MODELO_FALSO) as any;
    expect(Object.keys(c.permission.bash)[0]).toBe("*");
    expect(c.permission.bash["*"]).toBe("deny");
    expect(c.permission.bash["npm run checar"]).toBe("allow");
    expect(c.permission.bash["node scripts/uiux.mjs *"]).toBe("allow");
    expect(Object.keys(c.permission.skill)[0]).toBe("*");
    expect(c.permission.skill["*"]).toBe("deny");
    SKILLS_DA_CASA.forEach((s) => expect(c.permission.skill[s]).toBe("allow"));
    expect(c.permission.webfetch).toBe("deny");
    expect(c.permission.external_directory).toBe("deny");
    expect(c.watcher.ignore).toContain(".opencode/**");
  });

  it("ferramentaLigada imita o opencode: \"*\" no fim desliga a ferramenta inteira (o bug que o teste antigo deixou passar)", () => {
    const c = configDoOpencode(MODELO_FALSO) as any;
    expect(ferramentaLigada(c.permission.bash)).toBe(true);
    expect(ferramentaLigada(c.permission.skill)).toBe(true);
    const antiga: Record<string, "allow" | "deny"> = {};
    COMANDOS_LIBERADOS.forEach((x) => (antiga[x] = "allow"));
    antiga["*"] = "deny";
    expect(ferramentaLigada(antiga)).toBe(false);
    expect(ferramentaLigada({ "ui-ux-pro-max": "allow", "*": "deny" })).toBe(false);
    expect(ferramentaLigada("deny")).toBe(false);
    expect(ferramentaLigada("allow")).toBe(true);
    expect(ferramentaLigada(undefined)).toBe(true);
    expect(negarPrimeiro(["a", "*", "b"])).toEqual({ "*": "deny", a: "allow", b: "allow" });
  });

  it("cada pedido cai na regra certa (curinga do opencode 1.18)", () => {
    const c = configDoOpencode(MODELO_FALSO) as any;
    expect(acaoDoPedido(c.permission.bash, "npm run checar")).toBe("allow");
    expect(acaoDoPedido(c.permission.bash, 'node scripts/uiux.mjs "law firm" --domain ux -n 3')).toBe("allow");
    expect(acaoDoPedido(c.permission.bash, "node scripts\\uiux.mjs x")).toBe("allow");
    expect(acaoDoPedido(c.permission.bash, "python3 .opencode/skills/ui-ux-pro-max/scripts/search.py x")).toBe("deny");
    expect(acaoDoPedido(c.permission.bash, "npm install left-pad")).toBe("deny");
    expect(acaoDoPedido(c.permission.bash, "curl https://x")).toBe("deny");
    expect(acaoDoPedido(c.permission.skill, "ui-ux-pro-max")).toBe("allow");
    expect(acaoDoPedido(c.permission.skill, "customize-opencode")).toBe("deny");
    expect(acaoDoPedido(c.permission.skill, "hyperframes")).toBe("deny");
    expect(casaCuringa("node scripts/uiux.mjs", "node scripts/uiux.mjs *")).toBe(true);
    expect(casaCuringa("node scripts/uiux.mjsX", "node scripts/uiux.mjs *")).toBe(false);
    expect(casaCuringa("git status --short", "git status*")).toBe(true);
  });
});

describe("ambiente isolado do opencode serve", () => {
  it("desliga skills externas e o CLAUDE.md, fixa a pasta global do worker e não herda OPENCODE_* de fora", () => {
    const base = { PATH: "/usr/bin", OPENROUTER_API_KEY: "chave-falsa-de-teste-123", OPENCODE_PERMISSION: '{"bash":"allow"}', OPENCODE_CONFIG_DIR: "C:/Users/x/.cfg", opencode_config: "/x.json", XDG_CONFIG_HOME: "/home/x/.config", OPENCODE_GIT_BASH_PATH: "C:/Git/bin/bash.exe" };
    const config = configDoOpencode(MODELO_FALSO);
    const env = ambienteDoOpencode(base, config);
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1");
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect(env.XDG_CONFIG_HOME).toBe(PASTA_CASA_DO_OPENCODE);
    expect(relative(resolve(raiz, "workers/motor-codigo"), env.XDG_CONFIG_HOME).indexOf("..")).not.toBe(0);
    expect(env.OPENCODE_PERMISSION).toBeUndefined();
    expect(env.OPENCODE_CONFIG_DIR).toBeUndefined();
    expect(env.opencode_config).toBeUndefined();
    expect(env.OPENCODE_GIT_BASH_PATH).toBe("C:/Git/bin/bash.exe");
    expect(env.PATH).toBe("/usr/bin");
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toEqual(JSON.parse(JSON.stringify(config)));
    expect(env.OPENCODE_CONFIG_CONTENT).not.toMatch(/chave-falsa/);
    expect(env.OPENROUTER_API_KEY).toBe("chave-falsa-de-teste-123");
    expect(env.OPENCODE_CONFIG_CONTENT).toMatch(/\{env:OPENROUTER_API_KEY\}/);
    // A pasta do worker fica fora do git e o opencode.ts usa o ambiente.
    expect(ler("workers/motor-codigo/.gitignore")).toMatch(/^\.opencode-casa\/$/m);
    expect(ler("workers/motor-codigo/lib/opencode.ts")).toMatch(/env: ambienteDoOpencode\(process\.env, configDoOpencode\(m, medidorUrl\)\)/);
  });
});

describe("skill ui-ux-pro-max no modelo de site", () => {
  it("SKILL.md oficial, LICENSE MIT, ORIGEM e manifesto que bate com os arquivos", () => {
    const skill = readFileSync(join(SKILLS, "ui-ux-pro-max", "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: ui-ux-pro-max\n/);
    expect(skill).toContain(".opencode/skills/ui-ux-pro-max/scripts/search.py");
    expect(skill).not.toContain("{{");
    expect(problemasDoSkillMd(skill)).toEqual([]);
    expect(readFileSync(join(SKILLS, "ui-ux-pro-max", "LICENSE"), "utf8")).toMatch(/MIT License\s+Copyright \(c\) 2024 Next Level Builder/);
    const origem = readFileSync(join(SKILLS, "ui-ux-pro-max", "ORIGEM.md"), "utf8");
    expect(origem).toContain("ui-ux-pro-max-cli");
    expect(origem).toContain("2.15.0");
    expect(origem).toContain("sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==");
    const c = conferirManifesto(join(SKILLS, "ui-ux-pro-max"));
    expect(c.problemas).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.arquivos).toBeGreaterThan(40);
  });

  it("sem as 6 skills irmãs, sem testes e sem cache do Python; o --conferir recusa arquivo mexido", () => {
    IRMAS.forEach((s) => expect(existsSync(join(SKILLS, s))).toBe(false));
    const pastas: string[] = [];
    (function andar(d: string) {
      for (const n of readdirSync(d)) if (statSync(join(d, n)).isDirectory()) (pastas.push(relative(SKILLS, join(d, n)).split("\\").join("/")), andar(join(d, n)));
    })(SKILLS);
    expect(pastas.filter((p) => /(^|\/)(tests|__pycache__)$/.test(p))).toEqual([]);
    expect(foraDaCopia("scripts/tests/test_core.py")).toBe(true);
    expect(foraDaCopia("scripts/__pycache__/core.cpython-312.pyc")).toBe(true);
    expect(foraDaCopia("scripts/search.py")).toBe(false);
    // Cópia mexida: o manifesto acusa.
    const copia = temp("skill");
    const alvo = join(copia, "skills", "ui-ux-pro-max");
    mkdirSync(join(alvo, "data"), { recursive: true });
    ["SKILL.md", "LICENSE", "ORIGEM.md", "manifesto.json"].forEach((f) => copyFileSync(join(SKILLS, "ui-ux-pro-max", f), join(alvo, f)));
    const r = conferirManifesto(alvo);
    expect(r.ok).toBe(false);
    expect(r.problemas.some((p: string) => /faltando: data\/styles\.csv/.test(p))).toBe(true);
    mkdirSync(join(copia, "skills", "design"), { recursive: true });
    expect(conferirManifesto(alvo).problemas).toContain("skill irmã não pode ficar no motor: design");
    rmSync(copia, { recursive: true, force: true });
  });

  it("toda pasta de .opencode/skills é uma skill da casa, com o nome certo e sem repetir (vale para o superpowers também)", () => {
    expect(SKILLS_DA_CASA.length).toBe(new Set(SKILLS_DA_CASA).size);
    const nomes = readdirSync(SKILLS).filter((n) => statSync(join(SKILLS, n)).isDirectory());
    expect(nomes.length).toBeGreaterThan(0);
    nomes.forEach((n) => {
      const md = readFileSync(join(SKILLS, n, "SKILL.md"), "utf8");
      const nome = (/^name:\s*"?([^"\n]+)"?\s*$/m.exec(md) || [])[1];
      expect(nome).toBe(n);
      expect(SKILLS_DA_CASA).toContain(nome);
    });
    SKILLS_DA_CASA.forEach((s) => expect(nomes).toContain(s));
  });
});

describe("casca v3: a pasta de skills vai para os projetos antigos", () => {
  it("casca.json com pastas válidas e o embrulho e o gráfico na lista", () => {
    const casca = lerCasca(MODELO_DO_SITE)!;
    expect(casca.versao).toBeGreaterThanOrEqual(3);
    expect(casca.pastas).toEqual([".opencode/skills"]);
    (casca.pastas || []).forEach((p) => {
      expect(pastaDaCascaValida(p)).toBe(true);
      expect(existsSync(join(MODELO, p))).toBe(true);
    });
    expect(casca.arquivos).toContain("scripts/uiux.mjs");
    expect(casca.arquivos).toContain("src/lib/Grafico.tsx");
    expect(pastaDaCascaValida(".opencode/skills/ui-ux-pro-max")).toBe(true);
    ["../x", ".opencode", "src", ".opencode/skills/../x", "/.opencode/skills", "C:/.opencode/skills", ".opencode/skillsX"].forEach((p) => expect(pastaDaCascaValida(p)).toBe(false));
    expect(copiaDoModelo(join(MODELO, ".opencode", "skills", "ui-ux-pro-max", "SKILL.md"))).toBe(true);
    expect(copiaDoModelo(join(MODELO, ".opencode", "skills", "ui-ux-pro-max", "scripts", "__pycache__"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, ".aceleriq", "uiux-log.jsonl"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, "design-system"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, ".aceleriq", "pacote.json"))).toBe(true);
  });

  it("projeto da casca v2 ganha a skill num commit, e a pasta velha de skills é trocada inteira", async () => {
    const pasta = temp("casca");
    const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...a], { cwd: pasta, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    mkdirSync(join(pasta, ".aceleriq"), { recursive: true });
    writeFileSync(join(pasta, ".aceleriq", "casca.json"), JSON.stringify({ versao: 2, arquivos: ["AGENTS.md"] }));
    mkdirSync(join(pasta, ".opencode", "skills", "velha"), { recursive: true });
    writeFileSync(join(pasta, ".opencode", "skills", "velha", "SKILL.md"), "---\nname: velha\n---\n");
    git("add", "-A");
    git("commit", "-q", "-m", "antes");
    const versao = await atualizarCasca(pasta);
    expect(versao).toBe(lerCasca(MODELO_DO_SITE)!.versao);
    expect(existsSync(join(pasta, ".opencode", "skills", "ui-ux-pro-max", "SKILL.md"))).toBe(true);
    expect(existsSync(join(pasta, ".opencode", "skills", "velha"))).toBe(false);
    expect(existsSync(join(pasta, "scripts", "uiux.mjs"))).toBe(true);
    expect(existsSync(join(pasta, "src", "lib", "Grafico.tsx"))).toBe(true);
    expect(conferirManifesto(join(pasta, ".opencode", "skills", "ui-ux-pro-max")).ok).toBe(true);
    expect(git("log", "-1", "--format=%s").stdout.trim()).toBe(`Casca da casa v${versao}`);
    expect(await atualizarCasca(pasta)).toBeNull();
    rmSync(pasta, { recursive: true, force: true });
  }, 60_000);
});

describe("AGENTS.md, atribuições e conferência do modelo", () => {
  it("o AGENTS.md manda carregar a skill, usar o embrulho, nunca --force e deixar a prova de UX", () => {
    const agents = ler("workers/motor-codigo/modelo-site/AGENTS.md");
    expect(agents).toContain("## Inteligência de design (skill ui-ux-pro-max)");
    expect(agents).toContain("ui-ux-pro-max");
    expect(agents).toContain("node scripts/uiux.mjs");
    expect(agents).toContain("--force");
    expect(agents).toContain(".aceleriq/ux/");
    expect(agents).toContain("O pacote vence a base");
    expect(agents).toContain("src/lib/Grafico.tsx");
    expect(agents).toMatch(/rode `npm run checar`/);
    expect(agents).not.toMatch(/[\u2014\u2013]/);
    expect(agents.indexOf("## Inteligência de design")).toBeGreaterThan(agents.indexOf("## Regras duras"));
  });

  it("ATRIBUICOES.md e .gitignore do modelo", () => {
    expect(ler("workers/motor-codigo/modelo-site/ATRIBUICOES.md")).toMatch(/\| UI UX Pro Max 2\.15\.0 \| MIT \(Next Level Builder\) \|.*\.opencode\/skills\/ui-ux-pro-max/);
    expect(ler("workers/motor-codigo/modelo-site/.gitignore")).toMatch(/^__pycache__\/$/m);
  });

  it("as fontes do pacote entram no HTML só de fonts.googleapis.com e sempre com display=swap", () => {
    expect(urlDasFontes({ fontes_url: "https://fonts.googleapis.com/css2?family=Lato:wght@400" })).toBe("https://fonts.googleapis.com/css2?family=Lato:wght@400&display=swap");
    expect(urlDasFontes({ fontes_url: "https://fonts.googleapis.com/css2?family=Lato&display=block" })).toBe("https://fonts.googleapis.com/css2?family=Lato&display=swap");
    expect(urlDasFontes({ fontes_url: "https://evil.example/css2?family=Lato" })).toBeNull();
    expect(urlDasFontes({ fontes_url: 'https://fonts.googleapis.com/css2?family=a"><script>' })).toBeNull();
    expect(urlDasFontes({})).toBeNull();
    expect(linksDasFontes({})).toEqual([]);
    const base = '<html lang="pt-BR"><head><title>Site</title><meta name="description" content="" /></head><body><div id="root"><!--app--></div></body></html>';
    const html = montarPagina(base, "<main></main>", { cliente: "X", fontes_url: "https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&family=Lato&display=swap" }, { id: "inicio", slug: "", titulo: "Início" });
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
    expect(html).toContain('href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&amp;family=Lato&amp;display=swap" data-fontes');
    expect(montarPagina(base, "", { cliente: "X" }, { id: "inicio", slug: "", titulo: "Início" })).not.toMatch(/fonts\.googleapis/);
  });

  it("conferir.mjs acusa CSS sem movimento reduzido ou sem foco visível e fonte sem swap", () => {
    const pasta = temp("conferir");
    mkdirSync(join(pasta, "scripts"), { recursive: true });
    mkdirSync(join(pasta, "dist", "assets"), { recursive: true });
    mkdirSync(join(pasta, ".aceleriq"), { recursive: true });
    ["conferir.mjs", "seo.mjs"].forEach((f) => copyFileSync(join(MODELO, "scripts", f), join(pasta, "scripts", f)));
    const rodar = () => spawnSync(process.execPath, [join(pasta, "scripts", "conferir.mjs")], { encoding: "utf8" });
    writeFileSync(join(pasta, ".aceleriq", "pacote.json"), JSON.stringify({ fontes_url: "https://fonts.googleapis.com/css2?family=Lato" }));
    writeFileSync(join(pasta, "dist", "index.html"), '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato&amp;display=swap" data-fontes /></head><body><h1>Oi</h1></body></html>');
    writeFileSync(join(pasta, "dist", "assets", "index-1.css"), ":focus-visible{outline:2px solid red}@media (prefers-reduced-motion:reduce){*{animation:none}}");
    expect(rodar().status).toBe(0);
    writeFileSync(join(pasta, "dist", "assets", "index-1.css"), "body{color:red}");
    const semUx = rodar();
    expect(semUx.status).toBe(1);
    expect(semUx.stderr).toMatch(/prefers-reduced-motion/);
    expect(semUx.stderr).toMatch(/:focus-visible/);
    writeFileSync(join(pasta, "dist", "assets", "index-1.css"), ":focus-visible{}@media (prefers-reduced-motion:reduce){}");
    writeFileSync(join(pasta, "dist", "index.html"), "<html><head></head><body></body></html>");
    expect(rodar().stderr).toMatch(/as fontes do pacote não entraram no HTML/);
    writeFileSync(join(pasta, "dist", "index.html"), '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato" /></head><body></body></html>');
    expect(rodar().stderr).toMatch(/fonte sem display=swap/);
    rmSync(pasta, { recursive: true, force: true });
  });
});

describe("embrulho do buscador (scripts/uiux.mjs)", () => {
  it("recusa --force (e a abreviação), injeta --output-dir . e prende a saída no projeto", () => {
    const r = "/proj/site";
    expect(prepararArgumentos(["x", "--force"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "--forc"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "--for"], r)).toEqual({ ok: true, args: ["x", "--for"] });
    expect(prepararArgumentos(["law firm", "--design-system", "--persist", "-p", "Cliente"], r)).toEqual({ ok: true, args: ["law firm", "--design-system", "--persist", "-p", "Cliente", "--output-dir", "."] });
    expect(prepararArgumentos(["x", "--design-system", "--pers"], r).args).toEqual(["x", "--design-system", "--persist", "--output-dir", "."]);
    expect(prepararArgumentos(["x", "--persist", "--output-dir", "."], r).args).toEqual(["x", "--persist", "--output-dir", "."]);
    expect(prepararArgumentos(["x", "--persist", "--output-dir=design"], r).args).toEqual(["x", "--persist", "--output-dir", "design"]);
    expect(prepararArgumentos(["x", "--persist", "-o", "../fora"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "--persist", "-o../fora"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "--persist", "--out", "/etc"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "--persist", "--output-dir", resolve(r, "sub")], r).args).toEqual(["x", "--persist", "--output-dir", "sub"]);
    expect(prepararArgumentos(["x", "--domain", "ux", "-n", "3"], r).args).toEqual(["x", "--domain", "ux", "-n", "3"]);
    expect(opcaoCompleta("--dom")).toBe("--domain");
    expect(opcaoCompleta("--p")).toBe("--p");
  });

  it("corta a saída longa com o aviso", () => {
    expect(cortarSaida("abc", 10)).toEqual({ texto: "abc", cortado: false });
    const c = cortarSaida("x".repeat(20), 10);
    expect(c.cortado).toBe(true);
    expect(c.texto).toMatch(/^x{10}\n\[cortado: use -n menor ou um --domain\]/);
  });

  it("com um Python falso: repassa os argumentos, grava o log, corta e sai com 3 sem Python", async () => {
    const pasta = temp("uiux");
    const scripts = join(pasta, ".opencode", "skills", "ui-ux-pro-max", "scripts");
    mkdirSync(scripts, { recursive: true });
    // "Python" falso: o node rodando um search.py que é JavaScript e ecoa o que recebeu.
    writeFileSync(join(scripts, "search.py"), "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), semPyc: process.env.PYTHONDONTWRITEBYTECODE }) + 'y'.repeat(Number(process.env.TAMANHO || 0)));\n");
    const ok = await buscar(["law firm", "--design-system", "--persist", "-p", "Café X"], { raiz: pasta, python: process.execPath, env: { ...process.env, TAMANHO: "0" } });
    expect(ok.codigo).toBe(0);
    const eco = JSON.parse(ok.saida);
    expect(eco.args).toEqual(["law firm", "--design-system", "--persist", "-p", "Café X", "--output-dir", "."]);
    expect(resolve(eco.cwd)).toBe(resolve(pasta));
    expect(eco.semPyc).toBe("1");
    const longo = await buscar(["x"], { raiz: pasta, python: process.execPath, env: { ...process.env, TAMANHO: "20000" } });
    expect(longo.cortado).toBe(true);
    expect(longo.saida.length).toBeLessThan(12_200);
    expect(longo.saida).toMatch(/\[cortado: use -n menor ou um --domain\]/);
    const recusa = await buscar(["x", "--force"], { raiz: pasta, python: process.execPath });
    expect(recusa.codigo).toBe(2);
    expect(recusa.erro).toMatch(/--force não é aceito/);
    const sem = await buscar(["x"], { raiz: pasta, python: null });
    expect(sem.codigo).toBe(3);
    expect(sem.erro).toContain(SEM_PYTHON);
    const log = lerLogDaBase(pasta);
    expect(log.map((l) => l.codigo)).toEqual([0, 0, 2, 3]);
    expect(log[0].bytes).toBeGreaterThan(10);
    expect(typeof log[0].ms).toBe("number");
    expect(log[1].cortado).toBe(true);
    expect(log[2].recusado).toMatch(/--force/);
    rmSync(pasta, { recursive: true, force: true });
  }, 60_000);

  it("acharPython recusa o que não é Python 3.8+ (o atalho da Store, o node)", () => {
    expect(acharPython({ UIUX_PYTHON: process.execPath, PATH: "", Path: "" })).toBeNull();
  });
});

describe("prova de consulta que o worker publica", () => {
  const csv = readFileSync(join(SKILLS, "ui-ux-pro-max", "data", "ux-guidelines.csv"), "utf8");
  const nomes = idsDasRegrasDeUx(csv);

  it("leitor de CSV com aspas, vírgula e quebra dentro do campo; nomes das 119 regras viram ids", () => {
    expect(lerCsv('a,b\n"x, y","linha\nnova"\n"aspas ""dentro""",z\r\n')).toEqual([["a", "b"], ["x, y", "linha\nnova"], ['aspas "dentro"', "z"]]);
    const total = Array.from(nomes.values()).reduce((s, l) => s + l.length, 0);
    expect(total).toBe(119);
    expect(nomes.get("focus states")).toEqual(["uupm:ux:28"]);
    expect(nomes.get("font loading")).toEqual(["uupm:ux:50", "uupm:ux:75"]);
  });

  it("a prova aceita id ou nome da regra e descarta o inventado", () => {
    const p = normalizarProvaDeUx({ conferidas: ["uupm:ux:66", "Focus States", "Font Loading", "regra inventada", "uupm:ux:66"], pendentes: [{ regra: "uupm:ux:69", motivo: "  rola   de lado " }, { regra: "Focus States", motivo: "x" }, { regra: "nada", motivo: "y" }] }, nomes)!;
    expect(p.conferidas).toEqual(["uupm:ux:66", "uupm:ux:28", "uupm:ux:50", "uupm:ux:75"]);
    expect(p.pendentes).toEqual([{ regra: "uupm:ux:69", motivo: "rola de lado" }]);
    expect(normalizarProvaDeUx(null)).toBeNull();
  });

  it("lê a prova da seção só quando esta passada mexeu nela", () => {
    const pasta = temp("prova");
    mkdirSync(join(pasta, ".aceleriq", "ux"), { recursive: true });
    const arq = join(pasta, ".aceleriq", "ux", "hero.json");
    writeFileSync(arq, JSON.stringify({ conferidas: ["uupm:ux:9"] }));
    expect(lerProvaDeUx(pasta, "hero")!.conferidas).toEqual(["uupm:ux:9"]);
    const velho = (Date.now() - 60_000) / 1000;
    utimesSync(arq, velho, velho);
    expect(lerProvaDeUx(pasta, "hero", Date.now())).toBeNull();
    expect(lerProvaDeUx(pasta, "../fora")).toBeNull();
    rmSync(pasta, { recursive: true, force: true });
  });

  it("evento: consultou e conferiu; aviso quando a seção foi construída sem consulta ou sem Python", () => {
    const ok = consultaDaSecao("hero", [{ codigo: 0 }, { codigo: 0 }, { codigo: 2 }, { codigo: 0 }], { conferidas: ["uupm:ux:9", "uupm:ux:28"], pendentes: [{ regra: "uupm:ux:69", motivo: "m" }] });
    const ev = eventoDaConsulta(ok, "Hero");
    expect(ev.tipo).toBe("passo");
    expect(ev.resumo).toBe("Hero: Consultou a base 3 vezes; conferiu 2 regras; 1 pendente");
    const sem = eventoDaConsulta(consultaDaSecao("faq", [], null), "Perguntas frequentes");
    expect(sem.tipo).toBe("aviso");
    expect(sem.resumo).toMatch(/^A seção Perguntas frequentes foi construída sem consultar a base de design/);
    const semPython = eventoDaConsulta(consultaDaSecao("faq", [{ codigo: 3 }], null), "FAQ");
    expect(semPython.resumo).toMatch(/sem Python 3/);
    const semProva = eventoDaConsulta(consultaDaSecao("faq", [{ codigo: 0 }], null), "FAQ");
    expect(semProva.tipo).toBe("aviso");
    expect(semProva.resumo).toMatch(/sem a prova do checklist de UX/);
    const total = totalDaBase([ok, consultaDaSecao("faq", [], null)]);
    expect(resumoDaBaseNaEntrega(total)).toEqual({ consultas: 3, regras_conferidas: 2, pendentes: 1, sem_consulta: ["faq"] });
    expect(resumoDaBaseNaEntrega(undefined)).toBeNull();
  });

  it("o worker liga a prova depois de cada passada e acha o Python na partida", () => {
    const exec = ler("workers/motor-codigo/lib/executar.ts");
    expect(exec).toMatch(/lerLogDaBase\(pasta\)\.slice\(linhasDoLog\)/);
    expect(exec).toMatch(/await avisar\(eventoDaConsulta\(consulta, rotuloDaSecao\(secao\)\)\)/);
    expect(exec).toMatch(/resultado\.base_de_design = totalDaBase\(consultas\)/);
    expect(exec).toMatch(/base_de_design: resumoDaBaseNaEntrega\(resultado\.base_de_design\)/);
    const worker = ler("workers/motor-codigo/worker.ts");
    expect(worker).toMatch(/const python = prepararPythonDaBase\(\);/);
    expect(worker).toMatch(/process\.env\.UIUX_PYTHON = python/);
  });
});
