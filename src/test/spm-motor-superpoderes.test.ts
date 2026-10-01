import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  ABERTURA_DA_CASA,
  AMBIENTE_ISOLADO,
  ambienteDoOpencode,
  ambienteSemSegredos,
  arquivosDaCasca,
  BASH_LIBERADO,
  BOOTSTRAP_DO_VENDOR,
  CAMINHOS_DAS_SKILLS,
  configDoOpencode,
  modoDoSuperpowers,
  permissaoDeEdicao,
  permitidasDoTrabalho,
  SKILL_DA_UIUX,
  SKILLS_DA_CASA,
  SKILLS_DO_SUPERPOWERS,
  SKILLS_DO_VENDOR,
  SKILLS_NEGADAS_NO_MOTOR,
  SKILLS_POR_TRABALHO,
  VENDOR_DO_SUPERPOWERS,
  VERSAO_DO_SUPERPOWERS,
} from "../../workers/motor-codigo/lib/config-opencode";
import { eventoDaSkill, eventosDasMarcas, lerMarcasDaResposta, prontoSemProva } from "../../workers/motor-codigo/lib/marcas-da-resposta";
import { conferirSecaoDoProjeto, limparConfiguracaoDoSite, MODELO_DO_SITE, reporCasca } from "../../workers/motor-codigo/lib/projeto";
import { TIPOS_QUE_GASTAM } from "../../supabase/functions/_shared/motor-codigo";
import { SKILLS_DO_SUPERPOWERS as CATALOGO_DAS_SKILLS, SKILLS_LIBERADAS_NO_MOTOR } from "../../supabase/functions/_shared/superpoderes-catalogo";
import { arquivosDoProjeto, FORA_DO_ZIP } from "../../workers/motor-codigo/lib/zip";
import { conferirPagina, conferirSecao, mioloDaSecao, secaoDosArgumentos } from "../../workers/motor-codigo/modelo-site/scripts/conferir.mjs";
import {
  causaDoRender,
  conferirEscrita,
  dadosDaCenaSobMedida,
  escritaAnteriorDaTela,
  LIMITE_DA_ESCRITA_ANTERIOR,
  MARCA_DA_ESCRITA_ANTERIOR,
  textoDaEscritaAnterior,
  TOKENS_DA_ESCRITA_ANTERIOR,
  tokensDeEntradaDaCena,
  LIMITE_DO_PEDIDO_DA_CENA,
  MARCA_DA_FALHA_ANTERIOR,
  METODO_DA_CENA,
  pedidoComACausa,
  provaDoRender,
  separarFalhaAnterior,
  SISTEMA_DA_CENA,
  type CenaDoFilme,
  type MarcaDaCena,
} from "../../supabase/functions/mesa-motion/modulos/cena-hf";

/**
 * Frente SPM (30/09/2026): o Superpowers original (obra/superpowers v6.4.2,
 * MIT) no motor de código, com isolamento do que é pessoal, lista de skills
 * por tipo de trabalho, o método no AGENTS.md do modelo de site, as marcas
 * PROVA/DECIDI/PRECISA DE RESPOSTA e o método do escritor de cenas.
 * O teste que sobe o opencode de verdade (sem gasto) é
 * workers/motor-codigo/teste-superpoderes.ts.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const MODELO = { id: "m", provedor: "openrouter", modelo_api: "deepseek/deepseek-v4-flash", preco_entrada_1m: 0.0763, preco_saida_1m: 0.1526, preco_cache_1m: 0.01526, contexto_tokens: 1_000_000 };
const TRAVESSAO = /[–—]/;

/** O casamento de padrão do opencode 1.18.33 (Wildcard.match): barras normalizadas, "*" é qualquer coisa, sem caixa. */
function casa(texto: string, padrao: string): boolean {
  const t = texto.split("\\").join("/");
  let re = padrao.split("\\").join("/").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  if (re.slice(-3) === " .*") re = `${re.slice(0, -3)}( .*)?`;
  return new RegExp(`^${re}$`, "si").test(t);
}
/** A decisão do opencode: a ÚLTIMA regra que casa vence (Permission.evaluate); sem regra, pergunta. */
function decide(regras: Record<string, string> | string, pedido: string): string {
  if (typeof regras === "string") return regras;
  const chaves = Object.keys(regras);
  for (let i = chaves.length - 1; i >= 0; i--) if (casa(pedido, chaves[i])) return regras[chaves[i]];
  return "ask";
}

describe("configuração do opencode com os superpoderes", () => {
  it("modo nativo: skills.paths e instructions apontam para arquivos que existem", () => {
    const c = configDoOpencode(MODELO as never, null, { tipo: "construir" }) as any;
    // Integração com a UIM: a skill da casa (ui-ux-pro-max) e as do superpowers, as duas no worker.
    expect(c.skills.paths).toEqual([SKILL_DA_UIUX, SKILLS_DO_VENDOR]);
    expect(c.skills.paths).toEqual(CAMINHOS_DAS_SKILLS);
    expect(c.instructions).toEqual([BOOTSTRAP_DO_VENDOR, ABERTURA_DA_CASA]);
    c.skills.paths.concat(c.instructions).forEach((p: string) => expect(existsSync(p)).toBe(true));
    expect(c.plugin).toBeUndefined();
    expect(BOOTSTRAP_DO_VENDOR.replace(/\\/g, "/")).toMatch(/vendor\/superpowers\/skills\/using-superpowers\/SKILL\.md$/);
  });

  it("modo plugin: a pasta do vendor (index.js e package.json); skills.paths só com a skill da casa", () => {
    const c = configDoOpencode(MODELO as never, null, { tipo: "construir", modo: "plugin" }) as any;
    expect(c.plugin).toEqual([VENDOR_DO_SUPERPOWERS]);
    expect(existsSync(join(VENDOR_DO_SUPERPOWERS, "index.js"))).toBe(true);
    expect(existsSync(join(VENDOR_DO_SUPERPOWERS, "package.json"))).toBe(true);
    // Integração com a UIM: as do superpowers vêm pelo plugin; a ui-ux-pro-max continua por skills.paths.
    expect(c.skills.paths).toEqual([SKILL_DA_UIUX]);
    expect(c.instructions).toEqual([ABERTURA_DA_CASA]);
    expect(modoDoSuperpowers(undefined)).toBe("nativo");
    expect(modoDoSuperpowers("PLUGIN")).toBe("plugin");
    expect(modoDoSuperpowers("qualquer")).toBe("nativo");
  });

  it("permission.skill: \"*\" negado primeiro e exatamente as liberadas de cada tipo", () => {
    // Revisão da SPM: o construir não carrega brainstorming nem executing-plans (o pacote aprovado é o desenho),
    // e o revisar não passa pelo modelo, então não libera nada.
    const esperado: Record<string, string[]> = {
      construir: ["using-superpowers", "writing-plans", "test-driven-development", "systematic-debugging", "verification-before-completion"],
      ajustar: ["using-superpowers", "receiving-code-review", "systematic-debugging", "test-driven-development", "verification-before-completion"],
      revisar: [],
      desfazer: [],
      publicar: [],
      zip: [],
    };
    Object.keys(esperado).forEach((tipo) => {
      const s = (configDoOpencode(MODELO as never, null, { tipo }) as any).permission.skill as Record<string, string>;
      expect(Object.keys(s)[0]).toBe("*");
      expect(s["*"]).toBe("deny");
      // Integração com a UIM: as skills da casa (ui-ux-pro-max) entram em todo tipo, somadas às do tipo.
      expect(Object.keys(s).slice(1).sort()).toEqual(esperado[tipo].concat(SKILLS_DA_CASA).sort());
      Object.keys(s).slice(1).forEach((k) => expect(s[k]).toBe("allow"));
    });
    // Sem tipo, vale o construir (compatível com a chamada antiga).
    expect(permitidasDoTrabalho(undefined)).toEqual(permitidasDoTrabalho("construir"));
    // 6 liberadas em algum tipo + 9 sempre negadas = as 15 da v6.4.2.
    const liberadas = Array.from(new Set(Object.keys(SKILLS_POR_TRABALHO).flatMap((t) => SKILLS_POR_TRABALHO[t])));
    expect(liberadas.length).toBe(6);
    expect(Object.keys(SKILLS_NEGADAS_NO_MOTOR).length).toBe(9);
    expect((liberadas as string[]).concat(Object.keys(SKILLS_NEGADAS_NO_MOTOR)).sort()).toEqual((SKILLS_DO_SUPERPOWERS as readonly string[]).slice().sort());
    ["brainstorming", "executing-plans", "requesting-code-review"].forEach((n) => expect(SKILLS_NEGADAS_NO_MOTOR[n]).toBeTruthy());
    // As skills da casa de outra frente (UIUX) entram somadas às do tipo, sem tirar o "*" do começo.
    const comExtras = permitidasDoTrabalho("construir", ["ui-ux-pro-max"]);
    expect(Object.keys(comExtras)[0]).toBe("*");
    expect(comExtras["ui-ux-pro-max"]).toBe("allow");
    expect(comExtras["writing-plans"]).toBe("allow");
  });

  it("só os tipos que passam pelo modelo liberam skill, e o worker só sobe o opencode para eles", () => {
    const comSkill = Object.keys(SKILLS_POR_TRABALHO).filter((t) => SKILLS_POR_TRABALHO[t].length);
    expect(comSkill.sort()).toEqual((TIPOS_QUE_GASTAM as string[]).slice().sort());
    const ex = ler("workers/motor-codigo/lib/executar.ts");
    const guarda = ex.indexOf("if (TIPOS_QUE_GASTAM.indexOf(t.tipo");
    expect(guarda).toBeGreaterThan(0);
    expect(ex.split("subirOpencode(").length - 1).toBe(1);
    expect(ex.indexOf("subirOpencode(")).toBeGreaterThan(guarda);
    // O revisar só roda o build e as regras fixas (revisarHtml), sem modelo.
    expect(ex).not.toMatch(/if \(t\.tipo === "construir" \|\| t\.tipo === "ajustar"\)/);
  });

  it("question e task negados; bash com \"*\" primeiro libera node scripts/conferir.mjs*; .metodo fora do watcher", () => {
    const c = configDoOpencode(MODELO as never, "http://127.0.0.1:9/api/v1", { tipo: "ajustar" }) as any;
    expect(c.permission.question).toBe("deny");
    expect(c.permission.task).toBe("deny");
    // No 1.18.33 a última regra que casa vence: com "*" no fim, o bash some inteiro (medido).
    expect(Object.keys(c.permission.bash)[0]).toBe("*");
    expect(c.permission.bash["*"]).toBe("deny");
    expect(c.permission.bash["node scripts/conferir.mjs*"]).toBe("allow");
    expect(c.permission.bash["npm run checar"]).toBe("allow");
    expect(c.permission.bash).toEqual(BASH_LIBERADO);
    expect(c.watcher.ignore).toContain(".metodo/**");
    expect(JSON.stringify(c)).not.toMatch(/sk-or-|sk-ant-/);
  });

  it("edit liberado com a casca e o que roda na máquina negados; a ferramenta continua ligada", () => {
    const e = (configDoOpencode(MODELO as never, null, { tipo: "construir" }) as any).permission.edit as Record<string, string>;
    expect(Object.keys(e)[0]).toBe("*");
    expect(e["*"]).toBe("allow");
    expect(e).toEqual(permissaoDeEdicao());
    // O opencode tira a ferramenta inteira só quando a última regra é "*": "deny".
    expect(Object.keys(e)[Object.keys(e).length - 1]).not.toBe("*");
    ["scripts/conferir.mjs", "scripts\\prerender.mjs", "package.json", "vite.config.ts", ".git/config", ".git/hooks/post-commit", ".opencode/plugins/x.js", ".opencode/tool/y.ts", "opencode.json", ".aceleriq/pacote.json", "AGENTS.md", "src/App.tsx", "src/lib/pacote.ts", "src/marca.css", "public/marca/logo.png", "node_modules/x/index.js"].forEach((a) =>
      expect(decide(e, a), a).toBe("deny"),
    );
    ["src/secoes/Hero.tsx", "src/secoes/index.ts", "src/tema.css", ".metodo/hero.md", "src/lib/Marquee.tsx", "ATRIBUICOES.md", "public/imagens/nova.png"].forEach((a) => expect(decide(e, a), a).toBe("allow"));
    // Integração com a UIM: a prova de UX da seção (.aceleriq/ux/<seção>.json) é o agente que escreve; o resto de .aceleriq fica negado.
    expect(decide(e, ".aceleriq/ux/hero.json")).toBe("allow");
    [".aceleriq/pacote.json", ".aceleriq/casca.json", ".aceleriq/uiux-consulta.json"].forEach((a) => expect(decide(e, a), a).toBe("deny"));
    // A casca inteira do modelo fica negada (inclusive o vite.config.ts, que o build roda).
    arquivosDaCasca().forEach((a) => expect(decide(e, a), a).toBe("deny"));
    expect(arquivosDaCasca()).toContain("vite.config.ts");
  });

  it("external_directory: \"*\" negado primeiro e só a pasta das skills do vendor liberada", () => {
    const x = (configDoOpencode(MODELO as never, null, { tipo: "construir" }) as any).permission.external_directory as Record<string, string>;
    expect(Object.keys(x)[0]).toBe("*");
    expect(x["*"]).toBe("deny");
    // O opencode pede o padrão "<pasta do arquivo>/*" com o caminho real.
    const anexo = join(realpathSync.native(SKILLS_DO_VENDOR), "test-driven-development", "*");
    expect(existsSync(join(SKILLS_DO_VENDOR, "test-driven-development", "writing-good-tests.md"))).toBe(true);
    expect(decide(x, anexo)).toBe("allow");
    expect(decide(x, join(realpathSync.native(SKILLS_DO_VENDOR), "systematic-debugging", "*"))).toBe("allow");
    expect(decide(x, join(tmpdir(), "*"))).toBe("deny");
    expect(decide(x, join(VENDOR_DO_SUPERPOWERS, ".opencode", "plugins", "*"))).toBe("deny");
  });

  it("ambiente por lista de permissão: nada de SUPABASE, VERCEL, MOTOR nem chave de outro provedor", () => {
    const base = {
      Path: "C:\\Windows",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\x",
      APPDATA: "C:\\Users\\x\\AppData\\Roaming",
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "segredo-supabase",
      VERCEL_TOKEN: "segredo-vercel",
      VERCEL_TEAM_ID: "time",
      MOTOR_EXECUTOR: "maquina",
      OPENROUTER_API_KEY: "chave-openrouter",
      ANTHROPIC_API_KEY: "chave-anthropic",
      OPENAI_API_KEY: "chave-openai",
      OPENCODE_CONFIG: "C:\\pessoal\\opencode.json",
      OPENCODE_CONFIG_DIR: "C:\\pessoal",
      OPENCODE_PERMISSION: '{"bash":"allow"}',
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      xdg_config_home: "C:\\pessoal\\config",
      NODE_OPTIONS: "--require x",
      npm_config__auth: "segredo-npm",
    };
    const semSegredo = ambienteSemSegredos(base);
    expect(Object.keys(semSegredo).sort()).toEqual(["APPDATA", "OPENCODE_DISABLE_AUTOUPDATE", "Path", "SystemRoot", "USERPROFILE", "xdg_config_home"].sort());
    const cfg = configDoOpencode(MODELO as never, null, { tipo: "construir" });
    const nativo = ambienteDoOpencode(cfg, "nativo", { provedor: "openrouter", pastaDeConfig: "C:\\tmp\\vazia" }, base);
    expect(nativo.OPENROUTER_API_KEY).toBe("chave-openrouter");
    ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL_TOKEN", "VERCEL_TEAM_ID", "MOTOR_EXECUTOR", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_PERMISSION", "NODE_OPTIONS", "npm_config__auth", "xdg_config_home"].forEach((k) => expect(nativo[k], k).toBeUndefined());
    expect(JSON.stringify(nativo)).not.toMatch(/segredo-/);
    // Nativo: a pasta global do opencode é a pasta vazia do trabalho (a pessoal, em qualquer caixa, sai).
    expect(nativo.XDG_CONFIG_HOME).toBe("C:\\tmp\\vazia");
    Object.keys(AMBIENTE_ISOLADO).forEach((k) => expect(nativo[k]).toBe("1"));
    expect(JSON.parse(nativo.OPENCODE_CONFIG_CONTENT).model).toBe("openrouter/deepseek/deepseek-v4-flash");
    // Plugin: sobe sem a pasta isolada (o plugin trava com ela) e com os plugins padrão desligados.
    const plugin = ambienteDoOpencode(cfg, "plugin", { provedor: "anthropic", pastaDeConfig: "C:\\tmp\\vazia" }, base);
    expect(plugin.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("1");
    expect(plugin.XDG_CONFIG_HOME).toBeUndefined();
    expect(plugin.ANTHROPIC_API_KEY).toBe("chave-anthropic");
    expect(plugin.OPENROUTER_API_KEY).toBeUndefined();
    // Nenhum spawn do worker herda o ambiente inteiro.
    const oc = ler("workers/motor-codigo/lib/opencode.ts");
    expect(oc).not.toMatch(/\.\.\.process\.env/);
    expect(ler("workers/motor-codigo/lib/config-opencode.ts")).not.toMatch(/\.\.\.process\.env/);
    expect(ler("workers/motor-codigo/lib/previa.ts")).not.toMatch(/\.\.\.process\.env/);
    const pj = ler("workers/motor-codigo/lib/projeto.ts");
    expect(pj.match(/env: ambienteSemSegredos\(\)/g)!.length).toBe(3);
    expect(pj).toMatch(/core\.hooksPath=/);
    expect(pj).toMatch(/"core\.fsmonitor=false"/);
  });

  it("o opencode sobe isolado: sem skills pessoais, sem CLAUDE.md e sem telemetria", () => {
    expect(AMBIENTE_ISOLADO).toEqual({ OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", SUPERPOWERS_DISABLE_TELEMETRY: "1" });
    const oc = ler("workers/motor-codigo/lib/opencode.ts");
    expect(ler("workers/motor-codigo/lib/config-opencode.ts")).toMatch(/\.\.\.AMBIENTE_ISOLADO/);
    expect(oc).toMatch(/mkdtempSync\(join\(tmpdir\(\), "aceleriq-opencode-config-"\)\)/);
    expect(oc).toMatch(/const limpos = limparConfiguracaoDoSite\(pasta\)/);
    expect(oc).toMatch(/modo === "plugin" \? \[\] : \["--pure"\]/);
    expect(oc).toMatch(/registrarFalha\("motor: plugin do superpowers não subiu"/);
    expect(oc).toMatch(/PRAZO_DA_SUBIDA_MS = 45_000/);
    const ex = ler("workers/motor-codigo/lib/executar.ts");
    expect(ex).toMatch(/subirOpencode\(pasta, modelo, medidor \? medidor\.url : null, \{ tipo: t\.tipo/);
    expect(ex).toMatch(/eventosDasMarcas\(r\.marcas, \{ secao, rotulo: rotuloDaSecao\(secao\), motivo: r\.motivo, conferencia \}\)/);
    // A conferência de verdade roda depois do build do motor, e as marcas saem depois dela.
    expect(ex.indexOf("conferencia = conferirSecaoDoProjeto(pasta, secao)")).toBeGreaterThan(ex.indexOf("const b = await construirSite(pasta);"));
    expect(ex.indexOf("eventosDasMarcas(r.marcas")).toBeGreaterThan(ex.indexOf("conferencia = conferirSecaoDoProjeto(pasta, secao)"));
    // A casca volta antes do commit da seção (e antes do build do motor).
    expect(ex.indexOf("const mexidos = reporCasca(pasta)")).toBeLessThan(ex.indexOf("let c = await commitar(pasta, `${t.tipo === \"construir\""));
  });
});

describe("vendor fixado do Superpowers", () => {
  const versao = JSON.parse(ler("workers/motor-codigo/superpoderes/versao.json")) as { tag: string; commit: string; arvore: string; data: string; origem: string; skills: Array<{ nome: string; arquivo: string; sha256: string }> };

  it("versao.json bate com a tag e o commit, e o sha256 de cada SKILL.md confere", () => {
    expect(versao.tag).toBe("v6.4.2");
    expect(versao.commit).toBe("8ca22dba9a94f28898bbce59f2537ff4d87c747d");
    // Hash da árvore da tag v6.4.2 (git rev-parse v6.4.2^{tree} no repositório original).
    expect(versao.arvore).toBe("a29cb0f1f5600c82888f61eb6832025b3d9d3677");
    expect(VERSAO_DO_SUPERPOWERS).toEqual({ tag: versao.tag, commit: versao.commit });
    expect(versao.origem).toBe("https://github.com/obra/superpowers");
    expect(versao.skills.map((s) => s.nome)).toEqual((SKILLS_DO_SUPERPOWERS as readonly string[]).slice().sort());
    versao.skills.forEach((s) => {
      const bytes = readFileSync(join(VENDOR_DO_SUPERPOWERS, s.arquivo));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(s.sha256);
    });
    const pastas = readdirSync(SKILLS_DO_VENDOR).filter((n) => existsSync(join(SKILLS_DO_VENDOR, n, "SKILL.md")));
    expect(pastas.sort()).toEqual(versao.skills.map((s) => s.nome));
  });

  it("a árvore do vendor, CALCULADA dos arquivos como estão, é a da tag (qualquer arquivo mudado, a mais ou a menos falha)", () => {
    // Um índice temporário copiado do índice do repositório (para herdar os modos 100755 do patch),
    // com o vendor adicionado como está no disco; write-tree dá o hash da árvore.
    const git = (args: string[], env?: NodeJS.ProcessEnv) => execFileSync("git", args, { cwd: raiz, env: env || process.env, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    const dirGit = resolve(raiz, git(["rev-parse", "--git-dir"]));
    const indice = join(mkdtempSync(join(tmpdir(), "spm-indice-")), "index");
    try {
      copyFileSync(join(dirGit, "index"), indice);
      const env = { ...process.env, GIT_INDEX_FILE: indice };
      const pasta = "workers/motor-codigo/vendor/superpowers";
      git(["add", "-A", "-f", "--", pasta], env);
      const arvore = git(["write-tree", `--prefix=${pasta}/`], env);
      expect(arvore, "a árvore do vendor não bate com a da tag: arquivo mudado, a mais ou sem o modo do patch (aplique com git apply --index)").toBe(versao.arvore);
    } finally {
      rmSync(dirname(indice), { recursive: true, force: true });
    }
  }, 60_000);

  it("versao.json guarda o sha256 do que roda (plugin, index.js, hooks e scripts das skills) e confere", () => {
    const executaveis = (versao as unknown as { executaveis?: Array<{ arquivo: string; sha256: string }> }).executaveis || [];
    const nomes = executaveis.map((e) => e.arquivo);
    [".opencode/plugins/superpowers.js", "index.js"].forEach((a) => expect(nomes).toContain(a));
    expect(nomes.some((n) => /^hooks\//.test(n))).toBe(true);
    expect(nomes.some((n) => /^skills\/[^/]+\/scripts\//.test(n))).toBe(true);
    expect(executaveis.length).toBeGreaterThanOrEqual(40);
    executaveis.forEach((e) => {
      // Numa cópia de trabalho com core.autocrlf=true, .py e .cmd podem sair com CRLF: compara em LF (como na tag).
      const bytes = Buffer.from(readFileSync(join(VENDOR_DO_SUPERPOWERS, e.arquivo)).toString("latin1").split("\r\n").join("\n"), "latin1");
      expect(createHash("sha256").update(bytes).digest("hex"), e.arquivo).toBe(e.sha256);
    });
  });

  it("LICENSE MIT original dentro do vendor; arquivos com fim de linha LF", () => {
    const licenca = readFileSync(join(VENDOR_DO_SUPERPOWERS, "LICENSE"), "utf8");
    expect(licenca).toMatch(/MIT License/);
    expect(licenca).toMatch(/Jesse Vincent/);
    expect(licenca).not.toMatch(/\r\n/);
    expect(JSON.parse(readFileSync(join(VENDOR_DO_SUPERPOWERS, "package.json"), "utf8")).version).toBe("6.4.2");
    expect(existsSync(join(VENDOR_DO_SUPERPOWERS, ".git"))).toBe(false);
  });

  it("a abertura da casa é nossa, curta, sem travessão, e diz que o AGENTS.md vence", () => {
    const a = readFileSync(ABERTURA_DA_CASA, "utf8");
    expect(a.length).toBeLessThan(1_500);
    // Revisão da SPM: a escrita cria a pasta (sem mkdir), só comando simples, e o apply_patch dos modelos GPT.
    expect(a).toMatch(/cria as pastas que faltam/);
    expect(a).toMatch(/Comando composto \(`&&`, `\|\|`, `;`, `\|`\), redirecionamento/);
    expect(a).toMatch(/`apply_patch`/);
    expect(a).toMatch(/brainstorming e executing-plans não estão liberadas/);
    expect(a).toMatch(/obra\/superpowers v6\.4\.2/);
    expect(a).toMatch(/licença MIT/);
    expect(a).toMatch(/`AGENTS\.md` do projeto vence as skills/);
    expect(a).toMatch(/PRECISA DE RESPOSTA:/);
    expect(a).not.toMatch(TRAVESSAO);
  });

  it("o script de atualização só aceita tag conferida no GitHub e nunca main", () => {
    const s = ler("workers/motor-codigo/scripts/atualizar-superpowers.mjs");
    expect(s).toMatch(/TAG_VALIDA = \/\^v\\d\+\\\.\\d\+\\\.\\d\+\$\//);
    expect(s).toMatch(/ls-remote/);
    expect(s).toMatch(/--aplicar/);
    expect(s).toMatch(/git", \["diff", "--no-index"/);
  });
});

describe("modelo de site: método no AGENTS.md, casca 3, conferir --secao e .metodo fora do zip", () => {
  it("AGENTS.md tem a seção do método com as 8 regras, depois das regras duras", () => {
    const a = ler("workers/motor-codigo/modelo-site/AGENTS.md");
    const i = a.indexOf("## Método (Superpowers, obra/superpowers v6.4.2, licença MIT)");
    expect(i).toBeGreaterThan(a.indexOf("## Regras duras"));
    const secao = a.slice(i, a.indexOf("\n## ", i + 5));
    const regras = secao.split("\n").filter((l) => /^\d\. /.test(l));
    expect(regras.map((l) => l.slice(0, 2))).toEqual(["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8."]);
    expect(secao).toMatch(/PRECISA DE RESPOSTA: <pergunta>/);
    expect(secao).toMatch(/\.metodo\/<id-da-seção>\.md/);
    expect(secao).toMatch(/node scripts\/conferir\.mjs --secao <id>/);
    // RED sem build e uma rodada só do checar (o GREEN); o revisar não passa pelo agente.
    expect(secao).toMatch(/RED: rode ANTES de escrever e sem build/);
    expect(secao).toMatch(/Não rode `npm run build` nem `npm run checar` só para o RED/);
    expect(secao).toMatch(/rode `npm run checar` uma vez/);
    expect(secao).not.toMatch(/No "revisar", aponte/);
    expect(secao).toMatch(/cria a pasta sozinha/);
    expect(secao).toMatch(/data-secao="<id>"/);
    expect(secao).toMatch(/PROVA:/);
    expect(secao).toMatch(/3 tentativas/);
    expect(secao).toMatch(/DECIDI: o quê, porque/);
    Object.keys(SKILLS_NEGADAS_NO_MOTOR).forEach((s) => expect(secao).toContain(s));
    expect(a).not.toMatch(TRAVESSAO);
  });

  it("casca na versão 4 (união com a UIM) com AGENTS.md, conferir.mjs, vite.config.ts e .gitignore (que tira .metodo do git)", () => {
    const casca = JSON.parse(ler("workers/motor-codigo/modelo-site/.aceleriq/casca.json")) as { versao: number; arquivos: string[] };
    // As duas frentes subiram para a v3 com listas diferentes; a integração sobe para a v4 com a união.
    expect(casca.versao).toBeGreaterThanOrEqual(4);
    ["scripts/uiux.mjs", "src/lib/Grafico.tsx"].forEach((a) => expect(casca.arquivos).toContain(a));
    ["AGENTS.md", "scripts/conferir.mjs", ".gitignore", "vite.config.ts"].forEach((a) => expect(casca.arquivos).toContain(a));
    expect(ler("workers/motor-codigo/modelo-site/.gitignore").split(/\r?\n/)).toContain(".metodo");
  });

  it(".metodo fica fora do zip", () => {
    expect(FORA_DO_ZIP.has(".metodo")).toBe(true);
    const d = mkdtempSync(join(tmpdir(), "spm-zip-"));
    try {
      mkdirSync(join(d, ".metodo"), { recursive: true });
      mkdirSync(join(d, "src"), { recursive: true });
      writeFileSync(join(d, ".metodo", "hero.md"), "plano");
      writeFileSync(join(d, "src", "a.ts"), "x");
      const nomes = arquivosDoProjeto(d).map((c) => c.replace(/\\/g, "/"));
      expect(nomes.some((n) => /\/src\/a\.ts$/.test(n))).toBe(true);
      expect(nomes.some((n) => /\.metodo/.test(n))).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("conferir --secao: RED sem a seção, GREEN com data-secao e conteúdo, em qualquer página", () => {
    expect(secaoDosArgumentos(["--secao", "hero"])).toBe("hero");
    expect(secaoDosArgumentos(["--secao=sobre-equipe"])).toBe("sobre-equipe");
    expect(secaoDosArgumentos([])).toBeNull();
    const d = mkdtempSync(join(tmpdir(), "spm-dist-"));
    try {
      const pagina = (nome: string, html: string) => {
        mkdirSync(join(d, nome), { recursive: true });
        writeFileSync(join(d, nome, "index.html"), `<html><body><div id="root">${html}</div></body></html>`);
        return { caminho: join(d, nome, "index.html"), nome: `${nome}/index.html` };
      };
      // RED sem build: sem dist já é a falha, e a mensagem diz para não construir só para o RED.
      expect(conferirSecao([], "hero").problemas[0]).toMatch(/a seção hero ainda não está no build \(não há dist\/index\.html\)\. No RED isso basta: não rode build antes de escrever/);
      const sem = pagina("a", "<main><section><h1>Oi</h1></section></main>");
      expect(conferirSecao([sem], "hero").problemas[0]).toMatch(/não há elemento com data-secao="hero"/);
      const vazia = pagina("b", '<section data-secao="hero"><div></div></section>');
      expect(conferirSecao([vazia], "hero").problemas[0]).toMatch(/quase vazia/);
      const boa = pagina("c", '<section class="x" data-secao="hero"><div><h1>Café coado sem pressa</h1><div><p>Grãos torrados na semana.</p></div></div></section><section data-secao="faq">faq</section>');
      const r = conferirSecao([sem, boa], "hero");
      expect(r.problemas).toEqual([]);
      expect(r.onde).toMatchObject({ pagina: "c/index.html" });
      // O miolo fecha na tag certa, com divs aninhadas; a seção vizinha fica de fora.
      expect(mioloDaSecao(readFileSync(boa.caminho, "utf8"), "hero")).not.toMatch(/faq/);
      const img = pagina("d", '<div data-secao="galeria"><img src="/x.png"></div>');
      expect(conferirSecao([img], "galeria").problemas.join(" ")).toMatch(/sem alt/);
      const traco = pagina("e", '<div data-secao="sobre">Um texto longo o bastante — com travessão</div>');
      expect(conferirSecao([traco], "sobre").problemas.join(" ")).toMatch(/travessão/);
      expect(conferirSecao([boa], "../x").problemas[0]).toMatch(/inválido/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
    // Sem --secao, a conferência de sempre.
    expect(conferirPagina('<h1>a</h1><h1>b</h1><img src="x">')).toEqual(["2 h1 na página (o certo é um, no hero)", "imagem sem alt", "imagem sem width e height"]);
    expect(conferirPagina("<h1>ok</h1>")).toEqual([]);
  });
});

describe("o worker protege a casca e confere a seção com o código do modelo", () => {
  const copiarModelo = () => {
    const d = mkdtempSync(join(tmpdir(), "spm-casca-"));
    cpSync(MODELO_DO_SITE, d, { recursive: true, filter: (o) => !/[\\/](node_modules|dist|dist-ssr)([\\/]|$)/.test(o) });
    return d;
  };

  it("reporCasca: na mesma versão, o que o agente mexeu na casca e nos scripts do package.json volta ao original", () => {
    const d = copiarModelo();
    try {
      expect(reporCasca(d)).toEqual([]);
      writeFileSync(join(d, "scripts", "conferir.mjs"), "console.log(process.env.SUPABASE_SERVICE_ROLE_KEY)");
      writeFileSync(join(d, "vite.config.ts"), "fetch('https://exemplo.invalid')");
      const pkg = JSON.parse(readFileSync(join(d, "package.json"), "utf8"));
      pkg.scripts.checar = "node -e \"console.log(process.env)\"";
      writeFileSync(join(d, "package.json"), JSON.stringify(pkg));
      writeFileSync(join(d, "src", "secoes", "Hero.tsx"), "export default function Hero() { return null; }");
      const repostos = reporCasca(d);
      expect(repostos.sort()).toEqual(["package.json (scripts)", "scripts/conferir.mjs", "vite.config.ts"]);
      expect(readFileSync(join(d, "scripts", "conferir.mjs"), "utf8")).toBe(readFileSync(join(MODELO_DO_SITE, "scripts", "conferir.mjs"), "utf8"));
      expect(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).scripts).toEqual(JSON.parse(readFileSync(join(MODELO_DO_SITE, "package.json"), "utf8")).scripts);
      // A seção do agente não é casca e fica como está.
      expect(readFileSync(join(d, "src", "secoes", "Hero.tsx"), "utf8")).toMatch(/Hero/);
      // Casca de outra versão: quem cuida é o atualizarCasca (nada muda aqui).
      const casca = JSON.parse(readFileSync(join(d, ".aceleriq", "casca.json"), "utf8"));
      writeFileSync(join(d, ".aceleriq", "casca.json"), JSON.stringify({ ...casca, versao: casca.versao + 1 }));
      writeFileSync(join(d, "scripts", "conferir.mjs"), "mexido");
      expect(reporCasca(d)).toEqual([]);
      // Mesma versão com a lista de outra frente: a lista e os arquivos vêm do modelo.
      writeFileSync(join(d, ".aceleriq", "casca.json"), JSON.stringify({ versao: casca.versao, arquivos: ["AGENTS.md"] }));
      expect(reporCasca(d)).toEqual(expect.arrayContaining(["scripts/conferir.mjs", ".aceleriq/casca.json"]));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("conferirSecaoDoProjeto usa o conferir do modelo nas páginas prontas, e sem build diz que não está no build", () => {
    const d = mkdtempSync(join(tmpdir(), "spm-conf-"));
    try {
      const semBuild = conferirSecaoDoProjeto(d, "hero");
      expect(semBuild).toMatchObject({ rodou: true, ok: false });
      expect(semBuild.problemas[0]).toMatch(/ainda não está no build/);
      mkdirSync(join(d, "dist", "sobre"), { recursive: true });
      writeFileSync(join(d, "dist", "index.html"), '<main><section data-secao="hero"><h1>Café coado sem pressa</h1><p>Grãos torrados na semana.</p></section></main>');
      writeFileSync(join(d, "dist", "sobre", "index.html"), "<main><h1>Sobre</h1></main>");
      expect(conferirSecaoDoProjeto(d, "hero")).toMatchObject({ rodou: true, ok: true, problemas: [], onde: { pagina: "dist/index.html" } });
      const falta = conferirSecaoDoProjeto(d, "faq");
      expect(falta.ok).toBe(false);
      expect(falta.problemas[0]).toMatch(/não há elemento com data-secao="faq"/);
      // Mesmo que o projeto tenha trocado o scripts/conferir.mjs, a conferência é a do modelo.
      mkdirSync(join(d, "scripts"), { recursive: true });
      writeFileSync(join(d, "scripts", "conferir.mjs"), "export function conferirSecao() { return { problemas: [], onde: null }; }");
      expect(conferirSecaoDoProjeto(d, "faq").ok).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("limparConfiguracaoDoSite apaga opencode.json e o que houver em .opencode/ fora de skills/", () => {
    const d = mkdtempSync(join(tmpdir(), "spm-oc-"));
    try {
      mkdirSync(join(d, ".opencode", "plugins"), { recursive: true });
      mkdirSync(join(d, ".opencode", "tool"), { recursive: true });
      mkdirSync(join(d, ".opencode", "skills", "ui-ux-pro-max"), { recursive: true });
      writeFileSync(join(d, ".opencode", "plugins", "x.js"), "export default async () => ({})");
      writeFileSync(join(d, ".opencode", "tool", "y.ts"), "x");
      writeFileSync(join(d, ".opencode", "opencode.json"), "{}");
      writeFileSync(join(d, ".opencode", "skills", "ui-ux-pro-max", "SKILL.md"), "# da casa");
      writeFileSync(join(d, "opencode.json"), '{"permission":{"bash":"allow"}}');
      expect(limparConfiguracaoDoSite(d).sort()).toEqual([".opencode/opencode.json", ".opencode/plugins", ".opencode/tool", "opencode.json"]);
      expect(existsSync(join(d, "opencode.json"))).toBe(false);
      expect(existsSync(join(d, ".opencode", "plugins"))).toBe(false);
      expect(existsSync(join(d, ".opencode", "skills", "ui-ux-pro-max", "SKILL.md"))).toBe(true);
      expect(limparConfiguracaoDoSite(d)).toEqual([]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("marcas da passada: PROVA, DECIDI e PRECISA DE RESPOSTA", () => {
  it("lê as marcas no fim da resposta (com negrito, bloco de código e limites)", () => {
    const r = lerMarcasDaResposta(
      [
        "Construí a seção hero.",
        "- DECIDI: fundo claro, porque o preset é editorial",
        "**DECIDI:** CTA para o WhatsApp, porque não há formulário",
        "PROVA:",
        "```",
        "> npm run checar",
        "conferir ok",
        "conferir --secao hero ok (dist/index.html: 312 caracteres de texto, 1 imagem(ns))",
        "```",
      ].join("\n"),
    );
    expect(r.decisoes).toEqual(["fundo claro, porque o preset é editorial", "CTA para o WhatsApp, porque não há formulário"]);
    expect(r.prova).toMatch(/^> npm run checar \| conferir ok \| conferir --secao hero ok/);
    expect(r.pergunta).toBeNull();
    expect(r.afirma_pronto).toBe(true);
    const muitas = lerMarcasDaResposta(Array.from({ length: 8 }, (_, i) => `DECIDI: escolha ${i}, porque sim`).join("\n") + `\nPROVA: ${"x".repeat(900)}`);
    expect(muitas.decisoes.length).toBe(5);
    expect(muitas.prova!.length).toBe(400);
    const p = lerMarcasDaResposta("Parei aqui.\nPRECISA DE RESPOSTA: o endereço da loja entra no rodapé?\n");
    expect(p.pergunta).toBe("o endereço da loja entra no rodapé?");
    expect(lerMarcasDaResposta("")).toEqual({ prova: null, decisoes: [], pergunta: null, afirma_pronto: false });
    expect(lerMarcasDaResposta("Decidi seguir o pacote e provei o build.").decisoes).toEqual([]);
  });

  it("pronto sem prova vira aviso; com prova vira passo; pergunta vira aviso", () => {
    const semProva = lerMarcasDaResposta("Concluí a seção.");
    expect(prontoSemProva(semProva, "feito")).toBe(true);
    expect(prontoSemProva(semProva, "teto")).toBe(false);
    const ev = eventosDasMarcas(semProva, { secao: "hero", rotulo: "Hero", motivo: "feito" });
    expect(ev).toHaveLength(1);
    expect(ev[0].tipo).toBe("aviso");
    expect(ev[0].resumo).toMatch(/sem PROVA/);
    expect(ev[0].dados).toMatchObject({ sem_prova: true, secao: "hero" });
    const ok = eventosDasMarcas(lerMarcasDaResposta("DECIDI: a, porque b\nPROVA: conferir ok"), { secao: "faq", rotulo: "FAQ", motivo: "feito" });
    expect(ok.map((e) => e.tipo)).toEqual(["passo", "passo"]);
    expect(ok[0].resumo).toBe("Prova declarada de FAQ: conferir ok");
    expect(ok[1].resumo).toBe("Decidi (FAQ): a, porque b");
    const perg = eventosDasMarcas(lerMarcasDaResposta("PRECISA DE RESPOSTA: qual foto?"), { secao: "sobre", rotulo: "Sobre", motivo: "feito" });
    expect(perg.map((e) => e.tipo)).toEqual(["aviso"]);
    expect(perg[0].dados).toMatchObject({ pergunta: "qual foto?", sem_prova: false });
    expect(eventosDasMarcas(lerMarcasDaResposta("Parado."), { secao: "x", rotulo: "X", motivo: "parado" })).toEqual([]);
    ok.concat(ev, perg).forEach((e) => expect(e.resumo.length).toBeLessThanOrEqual(300));
  });

  it("a PROVA é a declarada: a conferência do motor confirma, desmente ou diz que não conferiu", () => {
    const declarada = lerMarcasDaResposta("Pronto.\nPROVA: conferir --secao hero ok (teste)");
    // Falsa: o motor rodou e falhou.
    const falsa = eventosDasMarcas(declarada, { secao: "hero", rotulo: "Hero", motivo: "feito", conferencia: { rodou: true, ok: false, problemas: ['não há elemento com data-secao="hero" em nenhuma página'], onde: null } });
    expect(falsa.map((e) => e.tipo)).toEqual(["passo", "aviso"]);
    expect(falsa[0].resumo).toBe("Prova declarada de Hero: conferir --secao hero ok (teste)");
    expect(falsa[1].resumo).toMatch(/^Prova declarada não confere \(Hero\): o motor rodou conferir --secao hero e falhou: não há elemento/);
    expect(falsa[1].dados).toMatchObject({ confere: false, prova_declarada: "conferir --secao hero ok (teste)" });
    expect(falsa[0].dados).toMatchObject({ prova_declarada: "conferir --secao hero ok (teste)", confere: false });
    // Verdadeira: o motor confere.
    const boa = eventosDasMarcas(declarada, { secao: "hero", rotulo: "Hero", motivo: "feito", conferencia: { rodou: true, ok: true, problemas: [], onde: { pagina: "dist/index.html", caracteres: 91, imagens: 0 } } });
    expect(boa.map((e) => e.tipo)).toEqual(["passo", "passo"]);
    expect(boa[1].resumo).toBe("Conferido pelo motor (Hero): conferir --secao hero ok (dist/index.html, 91 caracteres, 0 imagem(ns))");
    // Não rodou (build quebrou): a prova fica como declarada, com o porquê.
    const semBuild = eventosDasMarcas(declarada, { secao: "hero", rotulo: "Hero", motivo: "feito", conferencia: { rodou: false, ok: false, problemas: [], onde: null, motivo: "o build falhou e a seção foi desfeita" } });
    expect(semBuild).toHaveLength(1);
    expect(semBuild[0].resumo).toMatch(/^Prova declarada de Hero \(o motor não conferiu: o build falhou e a seção foi desfeita\)/);
    // Sem PROVA e a conferência falhou: aviso da conferência além do "sem prova".
    const nada = eventosDasMarcas(lerMarcasDaResposta("Concluí."), { secao: "faq", rotulo: "FAQ", motivo: "feito", conferencia: { rodou: true, ok: false, problemas: ["a seção faq está quase vazia"], onde: null } });
    expect(nada.map((e) => e.resumo)).toEqual(["FAQ: dada como pronta sem PROVA (aviso; nada foi refeito)", "Conferência do motor falhou (FAQ): a seção faq está quase vazia"]);
  });

  it("skill carregada vira passo; recusada vira aviso", () => {
    const parte = (status: string, extra: Record<string, unknown> = {}) => ({ type: "message.part.updated", properties: { part: { type: "tool", tool: "skill", state: { status, input: { name: "brainstorming" }, ...extra } } } });
    expect(eventoDaSkill(parte("completed"))).toEqual({ tipo: "passo", resumo: "Carregou a skill brainstorming (Superpowers)", dados: { skill: "brainstorming" } });
    expect(eventoDaSkill(parte("error", { error: "regra nega" }))!.tipo).toBe("aviso");
    expect(eventoDaSkill(parte("running"))).toBeNull();
    expect(eventoDaSkill({ type: "message.part.updated", properties: { part: { type: "tool", tool: "bash", state: { status: "completed" } } } })).toBeNull();
  });
});

describe("escritor de cenas: método, falha anterior e prova do worker", () => {
  const MARCA: MarcaDaCena = { nome: "Aceleriq", cores: { primaria: "#00d52b", fundo: "#0b0b0c", texto: "#f5f5f3", apoio: "#a3a3a3", claro: "#ffffff" }, fonte_titulo: "Inter-ExtraBold.ttf", fonte_texto: "Inter-Regular.ttf", tem_logo: true } as unknown as MarcaDaCena;
  const CENA = { id: "c1", ordem: 1, titulo: "Abertura", duracao_s: 4, modo: "sob_medida", peca: null, params: {}, escrita: null, fundo: "marca", tema: "escuro", ideia: "Logo entra", movimento: "", still_aprovado: false } as unknown as CenaDoFilme;

  it("SISTEMA_DA_CENA termina com o método e cabe em 3.200 caracteres", () => {
    expect(SISTEMA_DA_CENA.endsWith(METODO_DA_CENA)).toBe(true);
    expect(SISTEMA_DA_CENA.length).toBeLessThanOrEqual(3_200);
    expect(METODO_DA_CENA.length).toBeGreaterThan(500);
    expect(METODO_DA_CENA.length).toBeLessThan(900);
    expect(METODO_DA_CENA).toMatch(/obra\/superpowers, licença MIT/);
    expect(METODO_DA_CENA).toMatch(/storyboard aprovado é o desenho/);
    expect(METODO_DA_CENA).toMatch(/3 checagens/);
    expect(METODO_DA_CENA).toMatch(/FALHA ANTERIOR/);
    expect(METODO_DA_CENA).toMatch(/lint e do check do worker/);
    expect(METODO_DA_CENA).not.toMatch(TRAVESSAO);
  });

  it("FALHA ANTERIOR vira uma linha própria nos DADOS (pelo campo ou dentro do pedido)", () => {
    const pelo = dadosDaCenaSobMedida({ cena: CENA, marca: MARCA, formato: "9:16", provas: [], brand_md: "# B", imagens: [], falha_anterior: "lint: gsap_css_transform_conflict" });
    expect(pelo).toMatch(/\nFALHA ANTERIOR: lint: gsap_css_transform_conflict\n/);
    const pedido = pedidoComACausa("Logo entra devagar", ["proibido: relógio", "lint: seletor sem elemento"]);
    expect(pedido.length).toBeLessThanOrEqual(LIMITE_DO_PEDIDO_DA_CENA);
    expect(pedido).toBe("Logo entra devagar\n\nFALHA ANTERIOR: proibido: relógio; lint: seletor sem elemento");
    expect(separarFalhaAnterior(pedido)).toEqual({ pedido: "Logo entra devagar", falha: "proibido: relógio; lint: seletor sem elemento" });
    const dentro = dadosDaCenaSobMedida({ cena: CENA, marca: MARCA, formato: "9:16", provas: [], brand_md: "# B", imagens: [], pedido });
    expect(dentro).toContain('"pedido_da_equipe":"Logo entra devagar"');
    expect(dentro).toContain(`${MARCA_DA_FALHA_ANTERIOR} proibido: relógio; lint: seletor sem elemento`);
    const semFalha = dadosDaCenaSobMedida({ cena: CENA, marca: MARCA, formato: "9:16", provas: [], brand_md: "# B", imagens: [], pedido: "só a ideia" });
    expect(semFalha).not.toMatch(/FALHA ANTERIOR/);
    expect(semFalha).toContain('"pedido_da_equipe":"só a ideia"');
    const longo = pedidoComACausa("x".repeat(900), ["y".repeat(900)]);
    expect(longo.length).toBeLessThanOrEqual(LIMITE_DO_PEDIDO_DA_CENA);
    expect(separarFalhaAnterior(longo).falha!.length).toBeLessThanOrEqual(600);
  });

  it("na reescrita com a causa, a ESCRITA ANTERIOR vai nos DADOS (a recusada da tela ou a guardada na cena)", () => {
    const comEscrita = { ...CENA, escrita: { html: '<div id="c-a">Oi</div>', css: "#c-a{opacity:0}", js: "tl.to('#c-a', { opacity: 1 }, 0);", picos: [], resumo: "Logo" } } as unknown as CenaDoFilme;
    const pedido = pedidoComACausa("Logo entra devagar", ["lint: gsap_css_transform_conflict"]);
    const doRender = dadosDaCenaSobMedida({ cena: comEscrita, marca: MARCA, formato: "9:16", provas: [], brand_md: "# B", imagens: [], pedido });
    expect(doRender).toContain(`${MARCA_DA_ESCRITA_ANTERIOR} (a que falhou; corrija a causa nela, sem refazer do zero):\nHTML:\n<div id="c-a">Oi</div>\n\nCSS:\n#c-a{opacity:0}\n\nJS:\ntl.to('#c-a', { opacity: 1 }, 0);`);
    expect(doRender.indexOf("FALHA ANTERIOR:")).toBeLessThan(doRender.indexOf(MARCA_DA_ESCRITA_ANTERIOR));
    // A recusada (que a tela devolve) vence a guardada.
    const daTela = dadosDaCenaSobMedida({ cena: comEscrita, marca: MARCA, formato: "9:16", provas: [], brand_md: "# B", imagens: [], pedido, escrita_anterior: { html: "<p>recusada</p>", css: "", js: "Math.random()" } });
    expect(daTela).toContain("HTML:\n<p>recusada</p>\n\nJS:\nMath.random()");
    expect(daTela).not.toContain('<div id="c-a">');
    // Sem falha, a escrita anterior não vai (é só a escrita normal).
    expect(dadosDaCenaSobMedida({ cena: comEscrita, marca: MARCA, formato: "9:16", provas: [], brand_md: "# B", imagens: [], pedido: "só a ideia" })).not.toContain(MARCA_DA_ESCRITA_ANTERIOR);
    // Corte em 6 mil caracteres, na proporção, com o aviso de corte.
    const grande = textoDaEscritaAnterior({ html: "h".repeat(9_000), css: "c".repeat(3_000), js: "j".repeat(9_000) })!;
    expect(grande.length).toBeLessThanOrEqual(LIMITE_DA_ESCRITA_ANTERIOR);
    expect(grande).toMatch(/\[cortado\]/);
    expect(grande).toMatch(/^HTML:\n/);
    expect(grande).toMatch(/\n\nJS:\nj/);
    expect(textoDaEscritaAnterior({ html: "", css: " ", js: "" })).toBeNull();
    expect(escritaAnteriorDaTela({ html: "x".repeat(9_000), css: 3, js: "y" })).toEqual({ html: "x".repeat(LIMITE_DA_ESCRITA_ANTERIOR), css: "", js: "y" });
    expect(escritaAnteriorDaTela("nada")).toBeNull();
    // A estimativa soma os tokens da escrita anterior.
    expect(tokensDeEntradaDaCena(5_500, true)).toBe(5_500 + TOKENS_DA_ESCRITA_ANTERIOR);
    expect(tokensDeEntradaDaCena(5_500, false)).toBe(5_500);
    expect(METODO_DA_CENA).toMatch(/parta da ESCRITA ANTERIOR/);
  });

  it("causa do render só para lint e check; prova do worker só com o check lido", () => {
    expect(causaDoRender("A cena não passou no lint do HyperFrames: gsap_x: conflito; y: z")).toBe("lint: gsap_x: conflito; y: z");
    expect(causaDoRender("A cena deu erro ao rodar no navegador: ReferenceError: a is not defined")).toBe("check: ReferenceError: a is not defined");
    expect(causaDoRender("O worker caiu")).toBeNull();
    expect(causaDoRender(null)).toBeNull();
    expect(provaDoRender({ lido: true, ok: true, layout: { errorCount: 0, warningCount: 0 }, contrast: { errorCount: 0, warningCount: 0 } })).toBe("Prova: lint ok, check ok");
    expect(provaDoRender({ lido: true, ok: true, layout: { errorCount: 0, warningCount: 2 }, contrast: { errorCount: 1 } })).toBe("Prova: lint ok, check com 3 avisos");
    expect(provaDoRender({ lido: false })).toBe("Prova: lint ok, check não lido");
    expect(provaDoRender({})).toBeNull();
    expect(provaDoRender(null)).toBeNull();
  });

  it("a conferência da escrita continua igual; a mesa-motion não muda; o cartão tem o botão sob pedido", () => {
    expect(conferirEscrita({ html: '<div id="c-a">Oi</div>', css: "", js: "tl.to('#c-a', { opacity: 1 }, 0);" }).ok).toBe(true);
    expect(conferirEscrita({ html: "<div>x</div>", css: "", js: "Math.random()" }).problemas.join(" ")).toMatch(/sorteio/);
    // A escreverCena da mesa-motion não muda: o método entra pelo SISTEMA_DA_CENA, nunca por `metodo` (a camada da SPP).
    const idx = ler("supabase/functions/mesa-motion/index.ts");
    const escrever = idx.slice(idx.indexOf("async function escreverCena("), idx.indexOf("async function cenaEscrever("));
    expect(escrever.length).toBeGreaterThan(500);
    expect(escrever).toMatch(/sistema: `\$\{SISTEMA_DA_CENA\}/);
    expect(escrever).not.toMatch(/metodo|superpoderes|METODO_DA_CENA/);
    // A reescrita com a causa leva a escrita anterior, soma os tokens dela na estimativa e devolve a recusada.
    expect(escrever).toMatch(/escritaAnteriorDaTela\(p\.escritaAnterior\) \|\| cena\.escrita/);
    expect(escrever).toMatch(/tokensDeEntradaDaCena\(TAMANHOS_DO_MOTION\.cena\.entrada, !!escritaAnterior\)/);
    expect(escrever).toMatch(/escrita_anterior: escritaAnterior/);
    expect(escrever).toMatch(/escrita_recusada: recusadaEscrita/);
    expect(idx).toMatch(/escrita_recusada: r\.escrita_recusada \|\| null/);
    const tela = ler("src/components/mesa-motion/EtapaConstrucao.tsx");
    expect(tela).toMatch(/Reescrever com a causa/);
    expect(tela).toMatch(/pedidoComACausa\(pedido, comCausa\)/);
    expect(tela).toMatch(/causaDoRender\(ultimo\.erro_mensagem\)/);
    expect(tela).not.toMatch(/setInterval|useEffect\([^)]*escrever/);
    expect(ler("src/components/mesa-motion/CenaNaFila.tsx")).toMatch(/provaDoRender\(pronto\.check\)/);
  });
});

describe("integração SPP + SPM + UIM: o catálogo do painel é o que o worker libera", () => {
  it("catálogo igual a permitidasDoTrabalho em cada tipo de trabalho (tirando as skills da casa)", () => {
    for (const tipo of Object.keys(SKILLS_POR_TRABALHO)) {
      const doWorker = Object.keys(permitidasDoTrabalho(tipo)).filter((k) => k !== "*" && SKILLS_DA_CASA.indexOf(k) < 0);
      const doCatalogo = (SKILLS_LIBERADAS_NO_MOTOR as Record<string, string[]>)[tipo] || [];
      expect(doCatalogo.slice().sort(), tipo).toEqual(doWorker.sort());
    }
    // Todo tipo do catálogo existe no worker.
    Object.keys(SKILLS_LIBERADAS_NO_MOTOR).forEach((t) => expect(SKILLS_POR_TRABALHO[t], t).toBeDefined());
  });

  it("as mesmas 15 skills; negada no catálogo é negada no worker, com o mesmo motivo", () => {
    expect(Object.keys(CATALOGO_DAS_SKILLS).sort()).toEqual((SKILLS_DO_SUPERPOWERS as readonly string[]).slice().sort());
    for (const nome of Object.keys(CATALOGO_DAS_SKILLS)) {
      const s = CATALOGO_DAS_SKILLS[nome];
      if (s.motor === "negada") {
        expect(SKILLS_NEGADAS_NO_MOTOR[nome], nome).toBeTruthy();
        expect(s.motivo_no_motor, nome).toBe(SKILLS_NEGADAS_NO_MOTOR[nome]);
      } else {
        expect(SKILLS_NEGADAS_NO_MOTOR[nome], nome).toBeUndefined();
      }
    }
  });
});
