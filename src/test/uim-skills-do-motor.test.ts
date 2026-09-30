// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  acaoDoPedido,
  AMBIENTE_ISOLADO,
  ambienteDoOpencode,
  BASH_LIBERADO,
  BUSCADOR_DA_UIUX,
  CAMINHOS_DAS_SKILLS,
  casaCuringa,
  COMANDOS_LIBERADOS,
  COMANDOS_NEGADOS,
  configDoOpencode,
  ferramentaLigada,
  negarPrimeiro,
  PASTA_CASA_DO_OPENCODE,
  permitidasDoTrabalho,
  SKILL_DA_UIUX,
  SKILLS_DA_CASA,
  SKILLS_POR_TRABALHO,
} from "../../workers/motor-codigo/lib/config-opencode";
import { atualizarCasca, commitar, copiaDoModelo, lerCasca, MODELO_DO_SITE } from "../../workers/motor-codigo/lib/projeto";
import { apagarArquivosReservados, arquivosReservados, NOME_RESERVADO } from "../../workers/motor-codigo/lib/nomes-reservados";
import { consultaDaSecao, CSV_DAS_REGRAS_DE_UX, eventoDaConsulta, idsDasRegrasDeUx, lerCsv, lerLogDaBase, lerProvaDeUx, normalizarProvaDeUx, resumoDaBaseNaEntrega, totalDaBase } from "../../workers/motor-codigo/lib/prova-da-base";
import { ajustarPromptDaBase, CONSULTA_GRAVADA, consultaDoPacote, decidirDesignSystem, lerConsultaGravada, masterDoProjeto, prepararDesignSystem } from "../../workers/motor-codigo/lib/design-system";
import { acharBuscador, acharPython, buscar, cortarSaida, opcaoCompleta, prepararArgumentos, SEM_PYTHON } from "../../workers/motor-codigo/modelo-site/scripts/uiux.mjs";
import { conferirManifesto, foraDaCopia, IRMAS, problemasDoSkillMd } from "../../workers/motor-codigo/scripts/instalar-ui-ux-pro-max.mjs";
import { linksDasFontes, montarPagina, urlDasFontes } from "../../workers/motor-codigo/modelo-site/scripts/seo.mjs";
import { BYTES_DO_SKILL_MD, BYTES_POR_TOKEN, CHAMADAS_POR_SECAO, estimarTrabalho, TIPOS_DE_TRABALHO, TOKENS_DA_BASE, TOKENS_DA_SKILL, TOKENS_POR_AJUSTE, TOKENS_POR_SECAO } from "../../supabase/functions/_shared/motor-codigo";

/**
 * Frente UIM (30/09, corrigida): a skill ui-ux-pro-max no motor de código.
 * A skill mora no WORKER (vendor/ui-ux-pro-max) e entra pelo `skills.paths`,
 * como as do superpowers; o projeto do cliente não tem pasta .opencode (com
 * ela, o opencode instalava pacotes do npm em cada projeto). O agente fica
 * isolado (só as skills da casa), com o bash ligado de verdade (a ÚLTIMA regra
 * que casa vence no opencode), e o design system da base é o MOTOR que gera,
 * pela consulta do pacote, refazendo quando a Direção muda.
 */

const raiz = resolve(__dirname, "../..");
const MODELO = resolve(raiz, "workers/motor-codigo/modelo-site");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const MODELO_FALSO = { id: "m", provedor: "openrouter", modelo_api: "deepseek/deepseek-v4-flash", preco_entrada_1m: 0.0763, preco_saida_1m: 0.1526, preco_cache_1m: 0.01526, contexto_tokens: 1_000_000 };
const temp = (nome: string) => mkdtempSync(join(tmpdir(), `uim-${nome}-`));
const gitEm = (pasta: string) => (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...a], { cwd: pasta, encoding: "utf8" });

/** Toda SKILL.md dentro de uma pasta (o opencode acha as skills assim, em qualquer nível). */
function skillsEm(pasta: string): Array<{ pasta: string; nome: string }> {
  const achadas: Array<{ pasta: string; nome: string }> = [];
  (function andar(d: string) {
    for (const n of readdirSync(d)) {
      const c = join(d, n);
      if (statSync(c).isDirectory()) andar(c);
      else if (n === "SKILL.md") achadas.push({ pasta: d, nome: (/^name:\s*"?([^"\n]+)"?\s*$/m.exec(readFileSync(c, "utf8")) || [])[1] || "" });
    }
  })(pasta);
  return achadas;
}

describe("permissões do opencode: a última regra que casa vence", () => {
  it("bash e skill com \"*\": \"deny\" em PRIMEIRO lugar; o liberado vem depois", () => {
    const c = configDoOpencode(MODELO_FALSO) as any;
    expect(Object.keys(c.permission.bash)[0]).toBe("*");
    expect(c.permission.bash["*"]).toBe("deny");
    COMANDOS_LIBERADOS.forEach((x) => expect(c.permission.bash[x]).toBe("allow"));
    COMANDOS_NEGADOS.forEach((x) => expect(c.permission.bash[x]).toBe("deny"));
    expect(c.permission.bash["npm run checar"]).toBe("allow");
    expect(c.permission.bash).toEqual(BASH_LIBERADO);
    expect(Object.keys(c.permission.skill)[0]).toBe("*");
    expect(c.permission.skill["*"]).toBe("deny");
    SKILLS_DA_CASA.forEach((s) => expect(c.permission.skill[s]).toBe("allow"));
    expect(c.permission.webfetch).toBe("deny");
    expect(c.permission.external_directory).toBe("deny");
    expect(c.permission.question).toBe("deny");
    expect(c.permission.task).toBe("deny");
    expect(c.watcher.ignore).toContain("design-system/**");
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
    expect(acaoDoPedido(c.permission.bash, "node scripts/conferir.mjs --secao hero")).toBe("allow");
    expect(acaoDoPedido(c.permission.bash, "python3 .opencode/skills/ui-ux-pro-max/scripts/search.py x")).toBe("deny");
    expect(acaoDoPedido(c.permission.bash, `python ${BUSCADOR_DA_UIUX} x`)).toBe("deny");
    expect(acaoDoPedido(c.permission.bash, "UIUX_BUSCADOR=/x node scripts/uiux.mjs x")).toBe("deny");
    expect(acaoDoPedido(c.permission.bash, "npm run checar 2>&1")).toBe("allow");
    expect(acaoDoPedido(c.permission.bash, "ls public/marca")).toBe("allow");
    // Achado da prova da seção inteira: `dir x 2>nul` no bash do Git criou o arquivo "nul" e quebrou o commit.
    expect(acaoDoPedido(c.permission.bash, "dir public\\marca /b 2>nul")).toBe("deny");
    expect(acaoDoPedido(c.permission.bash, "ls public 2> NUL")).toBe("deny");
    expect(acaoDoPedido(c.permission.bash, "ls public 2>/dev/null")).toBe("allow");
    expect(acaoDoPedido(c.permission.bash, "mkdir -p .aceleriq/ux")).toBe("allow");
    expect(acaoDoPedido(c.permission.bash, "mkdir -p src/x")).toBe("deny");
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

describe("contrato único com a frente superpowers", () => {
  it("em todo tipo de trabalho a ui-ux-pro-max fica liberada, o bash e a skill ligados e o buscador liberado", () => {
    for (const tipo of TIPOS_DE_TRABALHO) {
      const c = configDoOpencode(MODELO_FALSO, null, { tipo }) as any;
      expect(Object.keys(c.permission.skill)[0]).toBe("*");
      expect(acaoDoPedido(c.permission.skill, "ui-ux-pro-max")).toBe("allow");
      (SKILLS_POR_TRABALHO[tipo] || []).forEach((s) => expect(acaoDoPedido(c.permission.skill, s)).toBe("allow"));
      expect(acaoDoPedido(c.permission.skill, "customize-opencode")).toBe("deny");
      expect(ferramentaLigada(c.permission.skill)).toBe(true);
      expect(ferramentaLigada(c.permission.bash)).toBe(true);
      expect(acaoDoPedido(c.permission.bash, 'node scripts/uiux.mjs "x" --domain ux')).toBe("allow");
      expect(acaoDoPedido(c.permission.bash, "npm run checar")).toBe("allow");
      expect(c.skills.paths).toContain(SKILL_DA_UIUX);
    }
  });

  it("com a lista por tipo do superpowers, as skills do tipo e as da casa ficam liberadas juntas, com \"*\" primeiro", () => {
    const doSuperpowers = { construir: ["using-superpowers", "brainstorming", "verification-before-completion"], ajustar: ["using-superpowers"], revisar: [] };
    const r = permitidasDoTrabalho("construir", doSuperpowers);
    expect(Object.keys(r)[0]).toBe("*");
    ["using-superpowers", "brainstorming", "verification-before-completion", "ui-ux-pro-max"].forEach((s) => expect(acaoDoPedido(r, s)).toBe("allow"));
    expect(acaoDoPedido(r, "using-git-worktrees")).toBe("deny");
    expect(acaoDoPedido(permitidasDoTrabalho("revisar", doSuperpowers), "ui-ux-pro-max")).toBe("allow");
    expect(acaoDoPedido(permitidasDoTrabalho("zip", doSuperpowers), "brainstorming")).toBe("deny");
    expect(ferramentaLigada(r)).toBe(true);
  });

  it("toda skill que o opencode acha nos skills.paths tem o nome da pasta, sem nome repetido, e as da casa estão lá", () => {
    const todas = CAMINHOS_DAS_SKILLS.reduce((l, p) => l.concat(skillsEm(p)), [] as Array<{ pasta: string; nome: string }>);
    expect(todas.length).toBeGreaterThan(0);
    todas.forEach((s) => expect(s.nome).toBe(basename(s.pasta)));
    const nomes = todas.map((s) => s.nome);
    expect(nomes.length).toBe(new Set(nomes).size);
    SKILLS_DA_CASA.forEach((s) => expect(nomes).toContain(s));
    expect(SKILLS_DA_CASA.length).toBe(new Set(SKILLS_DA_CASA).size);
    // Nenhuma pasta de skills dentro do projeto do cliente (o modelo não tem .opencode nem SKILL.md).
    CAMINHOS_DAS_SKILLS.forEach((p) => expect(relative(MODELO, p).indexOf("..")).toBe(0));
    expect(existsSync(join(MODELO, ".opencode"))).toBe(false);
    expect(skillsEm(MODELO)).toEqual([]);
  });

  it("um ambiente só: isolado, com XDG_CONFIG_HOME do worker, o buscador da skill e os plugins padrão desligados no modo plugin", () => {
    const base = { PATH: "/usr/bin", OPENROUTER_API_KEY: "chave-falsa-de-teste-123", OPENCODE_PERMISSION: '{"bash":"allow"}', OPENCODE_CONFIG_DIR: "C:/Users/x/.cfg", opencode_config: "/x.json", XDG_CONFIG_HOME: "/home/x/.config", OPENCODE_GIT_BASH_PATH: "C:/Git/bin/bash.exe" };
    const config = configDoOpencode(MODELO_FALSO);
    const env = ambienteDoOpencode(config, "nativo", base);
    Object.keys(AMBIENTE_ISOLADO).forEach((k) => expect(env[k]).toBe("1"));
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1");
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    expect(env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBeUndefined();
    expect(ambienteDoOpencode(config, "plugin", base).OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("1");
    expect(env.XDG_CONFIG_HOME).toBe(PASTA_CASA_DO_OPENCODE);
    expect(relative(resolve(raiz, "workers/motor-codigo"), env.XDG_CONFIG_HOME).indexOf("..")).not.toBe(0);
    expect(env.UIUX_BUSCADOR).toBe(BUSCADOR_DA_UIUX);
    expect(existsSync(env.UIUX_BUSCADOR)).toBe(true);
    expect(env.OPENCODE_PERMISSION).toBeUndefined();
    expect(env.OPENCODE_CONFIG_DIR).toBeUndefined();
    expect(env.opencode_config).toBeUndefined();
    expect(env.OPENCODE_GIT_BASH_PATH).toBe("C:/Git/bin/bash.exe");
    expect(env.PATH).toBe("/usr/bin");
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toEqual(JSON.parse(JSON.stringify(config)));
    expect(env.OPENCODE_CONFIG_CONTENT).not.toMatch(/chave-falsa/);
    expect(env.OPENROUTER_API_KEY).toBe("chave-falsa-de-teste-123");
    expect(env.OPENCODE_CONFIG_CONTENT).toMatch(/\{env:OPENROUTER_API_KEY\}/);
    // A pasta do worker fica fora do git; o opencode.ts usa o ambiente e não define outro.
    expect(ler("workers/motor-codigo/.gitignore")).toMatch(/^\.opencode-casa\/$/m);
    const opencode = ler("workers/motor-codigo/lib/opencode.ts");
    expect(opencode).toMatch(/env: ambienteDoOpencode\(configDoOpencode\(m, medidorUrl, \{ tipo: opcoes\.tipo \}\), "nativo"\)/);
    expect(opencode).not.toMatch(/function ambienteDoOpencode/);
  });
});

describe("skill ui-ux-pro-max no worker", () => {
  it("SKILL.md oficial, LICENSE MIT, ORIGEM e manifesto que bate com os arquivos", () => {
    const skill = readFileSync(join(SKILL_DA_UIUX, "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: ui-ux-pro-max\n/);
    expect(skill).toContain(".opencode/skills/ui-ux-pro-max/scripts/search.py");
    expect(skill).not.toContain("{{");
    expect(problemasDoSkillMd(skill)).toEqual([]);
    expect(readFileSync(join(SKILL_DA_UIUX, "LICENSE"), "utf8")).toMatch(/MIT License\s+Copyright \(c\) 2024 Next Level Builder/);
    const origem = readFileSync(join(SKILL_DA_UIUX, "ORIGEM.md"), "utf8");
    expect(origem).toContain("ui-ux-pro-max-cli");
    expect(origem).toContain("2.15.0");
    expect(origem).toContain("sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==");
    expect(origem).toContain("workers/motor-codigo/vendor/ui-ux-pro-max");
    const c = conferirManifesto(SKILL_DA_UIUX);
    expect(c.problemas).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.arquivos).toBeGreaterThan(40);
    expect(BUSCADOR_DA_UIUX).toBe(join(SKILL_DA_UIUX, "scripts", "search.py"));
  });

  it("sem as 6 skills irmãs, sem testes e sem cache do Python; o --conferir recusa arquivo mexido", () => {
    IRMAS.forEach((s) => expect(existsSync(join(dirname(SKILL_DA_UIUX), s))).toBe(false));
    const pastas: string[] = [];
    (function andar(d: string) {
      for (const n of readdirSync(d)) if (statSync(join(d, n)).isDirectory()) (pastas.push(relative(SKILL_DA_UIUX, join(d, n)).split("\\").join("/")), andar(join(d, n)));
    })(SKILL_DA_UIUX);
    expect(pastas.filter((p) => /(^|\/)(tests|__pycache__)$/.test(p))).toEqual([]);
    expect(foraDaCopia("scripts/tests/test_core.py")).toBe(true);
    expect(foraDaCopia("scripts/__pycache__/core.cpython-312.pyc")).toBe(true);
    expect(foraDaCopia("scripts/search.py")).toBe(false);
    const copia = temp("skill");
    const alvo = join(copia, "vendor", "ui-ux-pro-max");
    mkdirSync(join(alvo, "data"), { recursive: true });
    ["SKILL.md", "LICENSE", "ORIGEM.md", "manifesto.json"].forEach((f) => copyFileSync(join(SKILL_DA_UIUX, f), join(alvo, f)));
    const r = conferirManifesto(alvo);
    expect(r.ok).toBe(false);
    expect(r.problemas.some((p: string) => /faltando: data\/styles\.csv/.test(p))).toBe(true);
    mkdirSync(join(copia, "vendor", "design"), { recursive: true });
    expect(conferirManifesto(alvo).problemas).toContain("skill irmã não pode ficar no motor: design");
    rmSync(copia, { recursive: true, force: true });
  });
});

describe("casca v3 e cópia do modelo: nada de .opencode no projeto", () => {
  it("casca.json sem pastas, com o embrulho e o gráfico na lista, e todos os arquivos existem", () => {
    const casca = lerCasca(MODELO_DO_SITE)!;
    expect(casca.versao).toBeGreaterThanOrEqual(3);
    expect((casca as { pastas?: unknown }).pastas).toBeUndefined();
    expect(casca.arquivos).toContain("scripts/uiux.mjs");
    expect(casca.arquivos).toContain("src/lib/Grafico.tsx");
    casca.arquivos.forEach((a) => expect(existsSync(join(MODELO, a))).toBe(true));
    expect(copiaDoModelo(join(MODELO, "scripts", "uiux.mjs"))).toBe(true);
    expect(copiaDoModelo(join(MODELO, ".aceleriq", "pacote.json"))).toBe(true);
    expect(copiaDoModelo(join(MODELO, ".opencode"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, ".opencode", "node_modules", "x"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, ".opencode", "package-lock.json"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, ".opencode", "bun.lock"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, "scripts", "__pycache__"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, ".aceleriq", "uiux-log.jsonl"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, ".aceleriq", "uiux-consulta.json"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, ".aceleriq", "ux"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, "design-system"))).toBe(false);
    expect(copiaDoModelo(join(MODELO, "node_modules"))).toBe(false);
  });

  it("projeto da casca v2 ganha o embrulho e o gráfico num commit, sem pasta .opencode", async () => {
    const pasta = temp("casca");
    const git = gitEm(pasta);
    git("init", "-q", "-b", "main");
    mkdirSync(join(pasta, ".aceleriq"), { recursive: true });
    writeFileSync(join(pasta, ".aceleriq", "casca.json"), JSON.stringify({ versao: 2, arquivos: ["AGENTS.md"] }));
    git("add", "-A");
    git("commit", "-q", "-m", "antes");
    const versao = await atualizarCasca(pasta);
    expect(versao).toBe(lerCasca(MODELO_DO_SITE)!.versao);
    expect(existsSync(join(pasta, "scripts", "uiux.mjs"))).toBe(true);
    expect(existsSync(join(pasta, "src", "lib", "Grafico.tsx"))).toBe(true);
    expect(existsSync(join(pasta, ".opencode"))).toBe(false);
    expect(git("log", "-1", "--format=%s").stdout.trim()).toBe(`Casca da casa v${versao}`);
    expect(await atualizarCasca(pasta)).toBeNull();
    rmSync(pasta, { recursive: true, force: true });
  }, 60_000);
});

describe("AGENTS.md, atribuições e conferência do modelo", () => {
  it("o AGENTS.md manda carregar a skill, usar o embrulho, ler o design system do motor e deixar a prova de UX", () => {
    const agents = ler("workers/motor-codigo/modelo-site/AGENTS.md");
    expect(agents).toContain("## Inteligência de design (skill ui-ux-pro-max)");
    expect(agents).toContain("node scripts/uiux.mjs");
    expect(agents).toContain("quem gera é o motor");
    expect(agents).toContain("--persist");
    expect(agents).toContain("--force");
    expect(agents).toContain("não invente uma consulta");
    expect(agents).toContain(".aceleriq/ux/");
    expect(agents).toContain("O pacote vence a base");
    expect(agents).toContain("src/lib/Grafico.tsx");
    expect(agents).toMatch(/"linha" \| "barras" \| "rosca"/);
    expect(agents).not.toMatch(/donut/);
    expect(agents).not.toMatch(/gere uma vez/);
    expect(agents).toMatch(/rode `npm run checar`/);
    expect(agents).not.toMatch(/[\u2014\u2013]/);
    expect(agents.indexOf("## Inteligência de design")).toBeGreaterThan(agents.indexOf("## Regras duras"));
  });

  it("ATRIBUICOES.md do modelo diz que a skill fica no motor", () => {
    expect(ler("workers/motor-codigo/modelo-site/ATRIBUICOES.md")).toMatch(/\| UI UX Pro Max 2\.15\.0 \| MIT \(Next Level Builder\) \|.*fica no motor/);
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
  it("recusa --force e --persist do agente; só a chamada do motor grava, presa no projeto", () => {
    const r = "/proj/site";
    expect(prepararArgumentos(["x", "--force"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "--forc"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "--for"], r)).toEqual({ ok: true, args: ["x", "--for"] });
    const agente = prepararArgumentos(["law firm", "--design-system", "--persist", "-p", "Cliente"], r);
    expect(agente.ok).toBe(false);
    expect(agente.motivo).toMatch(/o motor gera design-system/);
    expect(prepararArgumentos(["x", "--design-system", "--pers"], r).ok).toBe(false);
    const motor = { motor: true };
    expect(prepararArgumentos(["law firm", "--design-system", "--persist", "-p", "Cliente"], r, motor)).toEqual({ ok: true, args: ["law firm", "--design-system", "--persist", "-p", "Cliente", "--output-dir", "."] });
    expect(prepararArgumentos(["x", "--design-system", "--pers"], r, motor).args).toEqual(["x", "--design-system", "--persist", "--output-dir", "."]);
    expect(prepararArgumentos(["x", "--persist", "--force"], r, motor).ok).toBe(false);
    expect(prepararArgumentos(["x", "--persist", "--output-dir=design"], r, motor).args).toEqual(["x", "--persist", "--output-dir", "design"]);
    expect(prepararArgumentos(["x", "--output-dir", "../fora"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "-o../fora"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "--out", "/etc"], r).ok).toBe(false);
    expect(prepararArgumentos(["x", "--output-dir", resolve(r, "sub")], r).args).toEqual(["x", "--output-dir", "sub"]);
    expect(prepararArgumentos(["x", "--domain", "ux", "-n", "3"], r).args).toEqual(["x", "--domain", "ux", "-n", "3"]);
    expect(opcaoCompleta("--dom")).toBe("--domain");
    expect(opcaoCompleta("--p")).toBe("--p");
  });

  it("acha o buscador do worker por UIUX_BUSCADOR (a skill não está no projeto)", () => {
    const pasta = temp("achar");
    expect(acharBuscador(pasta, { UIUX_BUSCADOR: BUSCADOR_DA_UIUX })).toBe(resolve(BUSCADOR_DA_UIUX));
    expect(acharBuscador(pasta, {})).toBeNull();
    expect(acharBuscador(pasta, { UIUX_BUSCADOR: join(pasta, "nao-existe", "search.py") })).toBeNull();
    expect(acharBuscador(pasta, { UIUX_BUSCADOR: join(SKILL_DA_UIUX, "SKILL.md") })).toBeNull();
    rmSync(pasta, { recursive: true, force: true });
  });

  it("corta a saída longa com o aviso", () => {
    expect(cortarSaida("abc", 10)).toEqual({ texto: "abc", cortado: false });
    const c = cortarSaida("x".repeat(20), 10);
    expect(c.cortado).toBe(true);
    expect(c.texto).toMatch(/^x{10}\n\[cortado: use -n menor ou um --domain\]/);
  });

  it("com um Python falso: repassa os argumentos, grava o log (a chamada do motor com origem), corta e sai com 3 sem Python ou sem a skill", async () => {
    const pasta = temp("uiux");
    const fora = temp("skill-falsa");
    const falso = join(fora, "search.py");
    // "Python" falso: o node rodando um search.py que é JavaScript e ecoa o que recebeu.
    writeFileSync(falso, "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), semPyc: process.env.PYTHONDONTWRITEBYTECODE }) + 'y'.repeat(Number(process.env.TAMANHO || 0)));\n");
    const env = { ...process.env, TAMANHO: "0", UIUX_BUSCADOR: falso };
    const ok = await buscar(["law firm", "--domain", "ux", "-n", "3"], { raiz: pasta, python: process.execPath, env });
    expect(ok.codigo).toBe(0);
    const eco = JSON.parse(ok.saida);
    expect(eco.args).toEqual(["law firm", "--domain", "ux", "-n", "3"]);
    expect(resolve(eco.cwd)).toBe(resolve(pasta));
    expect(eco.semPyc).toBe("1");
    const doMotor = await buscar(["law firm", "--design-system", "--persist", "-p", "Café X"], { raiz: pasta, python: process.execPath, env, motor: true });
    expect(JSON.parse(doMotor.saida).args).toEqual(["law firm", "--design-system", "--persist", "-p", "Café X", "--output-dir", "."]);
    const longo = await buscar(["x"], { raiz: pasta, python: process.execPath, env: { ...env, TAMANHO: "20000" } });
    expect(longo.cortado).toBe(true);
    expect(longo.saida.length).toBeLessThan(12_200);
    expect(longo.saida).toMatch(/\[cortado: use -n menor ou um --domain\]/);
    const recusa = await buscar(["x", "--design-system", "--persist"], { raiz: pasta, python: process.execPath, env });
    expect(recusa.codigo).toBe(2);
    expect(recusa.erro).toMatch(/--persist não é aceito/);
    const semPython = await buscar(["x"], { raiz: pasta, python: null, env });
    expect(semPython.codigo).toBe(3);
    expect(semPython.erro).toContain(SEM_PYTHON);
    const semSkill = await buscar(["x"], { raiz: pasta, python: process.execPath, env: { ...process.env, UIUX_BUSCADOR: "" } });
    expect(semSkill.codigo).toBe(3);
    expect(semSkill.erro).toMatch(/UIUX_BUSCADOR/);
    const log = lerLogDaBase(pasta);
    expect(log.map((l) => l.codigo)).toEqual([0, 0, 0, 2, 3, 3]);
    expect(log[1].origem).toBe("motor");
    expect(log[0].origem).toBeUndefined();
    expect(log[0].bytes).toBeGreaterThan(10);
    expect(typeof log[0].ms).toBe("number");
    expect(log[2].cortado).toBe(true);
    expect(log[3].recusado).toMatch(/--persist/);
    expect(log[5].recusado).toBe("skill ausente");
    rmSync(pasta, { recursive: true, force: true });
    rmSync(fora, { recursive: true, force: true });
  }, 60_000);

  it("acharPython recusa o que não é Python 3.8+ (o atalho da Store, o node)", () => {
    expect(acharPython({ UIUX_PYTHON: process.execPath, PATH: "", Path: "" })).toBeNull();
  });
});

describe("design system da base: gerado pelo motor, refeito quando a consulta muda", () => {
  const pacote = (consulta: unknown) => ({ cliente: "Café X", base_de_design: { versao: "uupm-2.15.0", consulta, regras_ux: [] } });
  /** O buscador falso: escreve design-system/<slug>/MASTER.md com a consulta, como o search.py faz. */
  const falso = (codigo = 0) => {
    const chamadas: Array<{ args: string[]; motor: boolean }> = [];
    const buscarFalso = async (args: string[], o: { raiz: string; motor: true }) => {
      chamadas.push({ args, motor: o.motor });
      if (codigo !== 0) return { codigo, erro: "sem python" };
      const pasta = join(o.raiz, "design-system", "cafe-x");
      mkdirSync(pasta, { recursive: true });
      writeFileSync(join(pasta, "MASTER.md"), `# MASTER\nconsulta: ${args[0]}\n`);
      return { codigo: 0, saida: "ok" };
    };
    return { chamadas, buscarFalso };
  };
  const commitarNoGit = async (pasta: string, mensagem: string) => {
    const git = gitEm(pasta);
    git("add", "-A");
    const novo = !!git("status", "--porcelain").stdout.trim();
    if (novo) git("commit", "-q", "-m", mensagem);
    return { novo, commit: git("rev-parse", "HEAD").stdout.trim() };
  };

  it("decide pela consulta gravada e pelo MASTER.md", () => {
    const g = (consulta: string, master: string | null = "design-system/x/MASTER.md") => ({ consulta, cliente: "X", master, em: "" });
    expect(decidirDesignSystem("", null, null)).toBe("manter");
    expect(decidirDesignSystem("", null, "design-system/x/MASTER.md")).toBe("apagar");
    expect(decidirDesignSystem("", g("a"), null)).toBe("apagar");
    expect(decidirDesignSystem("", null, null, true)).toBe("apagar");
    expect(decidirDesignSystem("a", g("a"), "design-system/x/MASTER.md")).toBe("manter");
    expect(decidirDesignSystem("b", g("a"), "design-system/x/MASTER.md")).toBe("gerar");
    expect(decidirDesignSystem("a", g("a"), null)).toBe("gerar");
    // MASTER.md que o motor não gerou (o agente, antes da correção): refeito pela consulta do pacote.
    expect(decidirDesignSystem("a", null, "design-system/x/MASTER.md")).toBe("gerar");
    expect(consultaDoPacote({ base_de_design: { consulta: "  Legal   Services  " } })).toBe("Legal Services");
    expect(consultaDoPacote({ base_de_design: null })).toBe("");
    expect(consultaDoPacote({})).toBe("");
  });

  it("gera, mantém, refaz com a consulta nova, apaga sem consulta e tenta de novo quando a busca não rodou", async () => {
    const pasta = temp("ds");
    const git = gitEm(pasta);
    git("init", "-q", "-b", "main");
    writeFileSync(join(pasta, "a.txt"), "a");
    git("add", "-A");
    git("commit", "-q", "-m", "inicio");
    const f = falso();
    const deps = { buscar: f.buscarFalso as never, commitar: commitarNoGit };
    const r1 = await prepararDesignSystem(pasta, pacote("Legal Services Accessible & Ethical"), deps);
    expect(r1.acao).toBe("gerar");
    expect(r1.ok).toBe(true);
    expect(r1.master).toBe("design-system/cafe-x/MASTER.md");
    expect(f.chamadas[0]).toEqual({ args: ["Legal Services Accessible & Ethical", "--design-system", "--persist", "-p", "Café X"], motor: true });
    expect(lerConsultaGravada(pasta)!.consulta).toBe("Legal Services Accessible & Ethical");
    expect(r1.evento!.resumo).toMatch(/Design system da base gerado pela consulta do pacote/);
    expect(git("log", "-1", "--format=%s").stdout.trim()).toMatch(/^Base de design: design system da consulta/);
    const r2 = await prepararDesignSystem(pasta, pacote("Legal Services Accessible & Ethical"), deps);
    expect(r2.acao).toBe("manter");
    expect(r2.evento).toBeNull();
    expect(f.chamadas.length).toBe(1);
    // A Direção trocou o produto ou o estilo: o MASTER.md velho sai e o novo segue a consulta nova.
    writeFileSync(join(pasta, "design-system", "cafe-x", "pages.md"), "velho");
    const r3 = await prepararDesignSystem(pasta, pacote("Marketing Agency Dark Mode OLED"), deps);
    expect(r3.acao).toBe("gerar");
    expect(readFileSync(join(pasta, r3.master!), "utf8")).toContain("Marketing Agency Dark Mode OLED");
    expect(existsSync(join(pasta, "design-system", "cafe-x", "pages.md"))).toBe(false);
    expect(r3.evento!.resumo).toMatch(/refeito/);
    // Sem consulta: o design system sai (e o agente não improvisa outro).
    const r4 = await prepararDesignSystem(pasta, pacote(""), deps);
    expect(r4.acao).toBe("apagar");
    expect(existsSync(join(pasta, "design-system"))).toBe(false);
    expect(masterDoProjeto(pasta)).toBeNull();
    expect(git("log", "-1", "--format=%s").stdout.trim()).toBe("Base de design: sem consulta no pacote, design system removido");
    expect((await prepararDesignSystem(pasta, pacote(""), deps)).acao).toBe("manter");
    // Sem Python: aviso, a consulta fica gravada sem MASTER.md e a próxima passada tenta de novo.
    const semPython = falso(3);
    const r5 = await prepararDesignSystem(pasta, pacote("Beauty Spa"), { buscar: semPython.buscarFalso as never, commitar: commitarNoGit });
    expect(r5.ok).toBe(false);
    expect(r5.evento!.tipo).toBe("aviso");
    expect(r5.evento!.resumo).toMatch(/sem Python 3/);
    expect(lerConsultaGravada(pasta)).toMatchObject({ consulta: "Beauty Spa", master: null });
    expect(existsSync(join(pasta, CONSULTA_GRAVADA))).toBe(true);
    expect((await prepararDesignSystem(pasta, pacote("Beauty Spa"), deps)).acao).toBe("gerar");
    rmSync(pasta, { recursive: true, force: true });
  }, 60_000);

  it("o pedido da seção: sem consulta, sai o bloco BASE DE DESIGN; com o MASTER.md, o caminho vai antes do fim", () => {
    const texto = ["1. O QUÊ: a seção hero.", 'BASE DE DESIGN: se o projeto tiver a skill ui-ux-pro-max, consulte-a antes (a busca usa "a consulta do pacote").', "Ao terminar, rode `npm run checar`."].join("\n");
    const sem = ajustarPromptDaBase(texto, pacote(""), null);
    expect(sem).not.toMatch(/BASE DE DESIGN/);
    expect(sem).toMatch(/^1\. O QUÊ/);
    expect(sem).toMatch(/Ao terminar, rode/);
    const com = ajustarPromptDaBase(texto, pacote("Legal Services"), "design-system/cafe-x/MASTER.md").split("\n");
    expect(com[1]).toMatch(/^BASE DE DESIGN/);
    expect(com[2]).toBe("DESIGN SYSTEM: leia design-system/cafe-x/MASTER.md (o motor gerou da consulta do pacote). Use dele só o que o pacote não define: espaçamento, efeitos, estados e antipadrões.");
    expect(com[3]).toMatch(/^Ao terminar, rode/);
    expect(ajustarPromptDaBase("1. O QUÊ", pacote("x"), null)).toBe("1. O QUÊ");
  });
});

describe("prova de consulta que o worker publica", () => {
  const csv = readFileSync(CSV_DAS_REGRAS_DE_UX, "utf8");
  const nomes = idsDasRegrasDeUx(csv);

  it("a tabela de regras vem da skill do worker; leitor de CSV com aspas, vírgula e quebra dentro do campo", () => {
    expect(relative(SKILL_DA_UIUX, CSV_DAS_REGRAS_DE_UX).split("\\").join("/")).toBe("data/ux-guidelines.csv");
    expect(lerCsv('a,b\n"x, y","linha\nnova"\n"aspas ""dentro""",z\r\n')).toEqual([["a", "b"], ["x, y", "linha\nnova"], ['aspas "dentro"', "z"]]);
    const total = Array.from(nomes.values()).reduce((s, l) => s + l.length, 0);
    expect(total).toBe(119);
    expect(nomes.get("focus states")).toEqual(["uupm:ux:28"]);
    expect(nomes.get("font loading")).toEqual(["uupm:ux:50", "uupm:ux:75"]);
  });

  it("a prova aceita o id com a explicação que o agente põe junto (visto na prova da seção inteira)", () => {
    const p = normalizarProvaDeUx({ conferidas: ["uupm:ux:66 \u2014 Alvo de toque com 44 px", "Focus States: anel verde", "uupm:ux:9", "texto qualquer: x"], pendentes: [{ regra: "uupm:ux:19 (rolagem global)", motivo: "no Lenis" }] }, nomes)!;
    expect(p.conferidas).toEqual(["uupm:ux:66", "uupm:ux:28", "uupm:ux:9"]);
    expect(p.pendentes).toEqual([{ regra: "uupm:ux:19", motivo: "no Lenis" }]);
  });

  it("a prova aceita id ou nome da regra e descarta o inventado", () => {
    const p = normalizarProvaDeUx({ conferidas: ["uupm:ux:66", "Focus States", "Font Loading", "regra inventada", "uupm:ux:66"], pendentes: [{ regra: "uupm:ux:69", motivo: "  rola   de lado " }, { regra: "Focus States", motivo: "x" }, { regra: "nada", motivo: "y" }] }, nomes)!;
    expect(p.conferidas).toEqual(["uupm:ux:66", "uupm:ux:28", "uupm:ux:50", "uupm:ux:75"]);
    expect(p.pendentes).toEqual([{ regra: "uupm:ux:69", motivo: "rola de lado" }]);
    expect(normalizarProvaDeUx(null)).toBeNull();
  });

  it("lê a prova da seção só quando esta passada mexeu nela, com os nomes da skill do worker", () => {
    const pasta = temp("prova");
    mkdirSync(join(pasta, ".aceleriq", "ux"), { recursive: true });
    const arq = join(pasta, ".aceleriq", "ux", "hero.json");
    writeFileSync(arq, JSON.stringify({ conferidas: ["uupm:ux:9", "Focus States"] }));
    expect(lerProvaDeUx(pasta, "hero")!.conferidas).toEqual(["uupm:ux:9", "uupm:ux:28"]);
    const velho = (Date.now() - 60_000) / 1000;
    utimesSync(arq, velho, velho);
    expect(lerProvaDeUx(pasta, "hero", Date.now())).toBeNull();
    expect(lerProvaDeUx(pasta, "../fora")).toBeNull();
    rmSync(pasta, { recursive: true, force: true });
  });

  it("evento: consultou e conferiu; aviso quando a seção foi construída sem consulta ou sem Python; a chamada do motor não conta", () => {
    const ok = consultaDaSecao("hero", [{ codigo: 0, origem: "motor" }, { codigo: 0 }, { codigo: 0 }, { codigo: 2 }, { codigo: 0 }], { conferidas: ["uupm:ux:9", "uupm:ux:28"], pendentes: [{ regra: "uupm:ux:69", motivo: "m" }] });
    expect(ok.consultas).toBe(3);
    const ev = eventoDaConsulta(ok, "Hero");
    expect(ev.tipo).toBe("passo");
    expect(ev.resumo).toBe("Hero: Consultou a base 3 vezes; conferiu 2 regras; 1 pendente");
    expect(consultaDaSecao("faq", [{ codigo: 0, origem: "motor" }], null).consultas).toBe(0);
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

  it("o worker prepara o design system antes da passada, ajusta o pedido, liga a prova e acha o Python na partida", () => {
    const exec = ler("workers/motor-codigo/lib/executar.ts");
    expect(exec).toMatch(/prepararDesignSystem\(pasta, pacote, \{ buscar: buscarNaBase, commitar, buscador: BUSCADOR_DA_UIUX \}\)/);
    expect(exec.indexOf("prepararDesignSystem(pasta")).toBeLessThan(exec.indexOf("await subirOpencode("));
    expect(exec).toMatch(/ajustarPromptDaBase\(promptDaSecao\(/);
    expect(exec).toMatch(/lerLogDaBase\(pasta\)\.slice\(linhasDoLog\)/);
    expect(exec).toMatch(/await avisar\(eventoDaConsulta\(consulta, rotuloDaSecao\(secao\)\)\)/);
    expect(exec).toMatch(/resultado\.base_de_design = totalDaBase\(consultas\)/);
    expect(exec).toMatch(/base_de_design: resumoDaBaseNaEntrega\(resultado\.base_de_design\)/);
    const worker = ler("workers/motor-codigo/worker.ts");
    expect(worker).toMatch(/const python = prepararPythonDaBase\(\);/);
    expect(worker).toMatch(/process\.env\.UIUX_PYTHON = python/);
  });
});

describe("arquivo \"nul\" do bash do Git não derruba o commit", () => {
  it("acha os nomes reservados do Windows fora de node_modules, .git e build", () => {
    ["nul", "NUL", "con", "aux.txt", "com1", "lpt9.log"].forEach((n) => expect(NOME_RESERVADO.test(n)).toBe(true));
    ["null", "nula.ts", "console.ts", "com10", "Hero.tsx"].forEach((n) => expect(NOME_RESERVADO.test(n)).toBe(false));
    const pasta = temp("nul");
    mkdirSync(join(pasta, "node_modules"), { recursive: true });
    mkdirSync(join(pasta, "src"), { recursive: true });
    writeFileSync(join(pasta, "node_modules", "aux"), "x");
    writeFileSync(join(pasta, "src", "Hero.tsx"), "x");
    expect(arquivosReservados(pasta)).toEqual([]);
    rmSync(pasta, { recursive: true, force: true });
  });

  it("o commit do worker apaga o \"nul\" que o bash criou (no Windows, pelo caminho longo) e segue", async () => {
    const pasta = temp("nul-git");
    const git = gitEm(pasta);
    git("init", "-q", "-b", "main");
    writeFileSync(join(pasta, "a.txt"), "a");
    git("add", "-A");
    git("commit", "-q", "-m", "inicio");
    // Como o agente fez na prova: um redirecionamento para nul pelo bash do Git.
    const bash = spawnSync("bash", ["-c", "ls . 2>nul >nul"], { cwd: pasta, encoding: "utf8" });
    const criouPeloBash = bash.status === 0 && arquivosReservados(pasta).length === 1;
    if (!criouPeloBash) writeFileSync(process.platform === "win32" ? `\\\\?\\${join(pasta, "nul")}` : join(pasta, "nul"), "");
    expect(arquivosReservados(pasta).map((c) => basename(c))).toEqual(["nul"]);
    writeFileSync(join(pasta, "b.txt"), "b");
    const c = await commitar(pasta, "Seção: Hero");
    expect(c.novo).toBe(true);
    expect(arquivosReservados(pasta)).toEqual([]);
    expect(git("show", "--name-only", "--format=", "HEAD").stdout.trim()).toBe("b.txt");
    expect(apagarArquivosReservados(pasta)).toBe(0);
    rmSync(pasta, { recursive: true, force: true });
  }, 60_000);
});

describe("estimativa e teto contam a skill", () => {
  it("BYTES_DO_SKILL_MD é o tamanho do SKILL.md fixado e a parcela cobre o SKILL.md em cada chamada da seção", () => {
    const tamanho = statSync(join(SKILL_DA_UIUX, "SKILL.md")).size;
    expect(BYTES_DO_SKILL_MD).toBe(tamanho);
    expect(TOKENS_DA_SKILL.entrada).toBeGreaterThanOrEqual(Math.ceil(tamanho / BYTES_POR_TOKEN) * CHAMADAS_POR_SECAO);
    expect(TOKENS_DA_SKILL.saida).toBeGreaterThan(0);
    expect(TOKENS_DA_SKILL.cacheFracao).toBeGreaterThan(0);
    expect(TOKENS_DA_SKILL.cacheFracao).toBeLessThan(1);
  });

  it("construir e ajustar somam a parcela da skill por passada; o teto sugerido é o dobro", () => {
    const m = { ...MODELO_FALSO, preco_entrada_1m: 3, preco_saida_1m: 15, preco_cache_1m: 0.3 };
    const custo = (t: { entrada: number; saida: number; cacheFracao: number }) => ((t.entrada * (1 - t.cacheFracao)) * 3 + t.entrada * t.cacheFracao * 0.3 + t.saida * 15) / 1_000_000;
    const tres = estimarTrabalho(m, "construir", 3);
    expect(tres.estimativa_usd).toBeCloseTo(custo(TOKENS_DA_BASE) + 3 * (custo(TOKENS_POR_SECAO) + custo(TOKENS_DA_SKILL)), 5);
    const ajuste = estimarTrabalho(m, "ajustar", 1);
    expect(ajuste.estimativa_usd).toBeCloseTo(custo(TOKENS_DA_BASE) + custo(TOKENS_POR_AJUSTE) + custo(TOKENS_DA_SKILL), 5);
    expect(tres.teto_sugerido_usd).toBeGreaterThanOrEqual(tres.estimativa_usd * 2);
    expect(estimarTrabalho(m, "revisar", 3).estimativa_usd).toBe(0);
  });
});
