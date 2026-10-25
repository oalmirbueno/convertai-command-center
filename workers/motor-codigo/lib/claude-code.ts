/**
 * Executor Claude Code do motor de código (frente MCC, 25/10/2026). O
 * `claude` (npm @anthropic-ai/claude-code, versão fixa no package.json do
 * worker, sem instalação global) roda em modo não interativo, uma vez por
 * passada (uma seção ou um ajuste), dentro da pasta do site, com o modelo pela
 * OpenRouter (Anthropic Messages em https://openrouter.ai/api).
 *
 * Como fica fechado na pasta do site:
 * - `--restricted`: as ferramentas de arquivo só alcançam a pasta de trabalho;
 *   os arquivos de configuração do usuário e do projeto são ignorados; Bash e
 *   WebFetch saem, a não ser que `--tools` os nomeie (Bash entra, WebFetch não);
 * - `--permission-mode dontAsk` e `--permission-prompts none`: o que não está
 *   em `--allowedTools` é negado na hora (não há ninguém para responder);
 * - `--allowedTools`: ler, escrever e editar na pasta, as skills e só os
 *   comandos da casa (npm run checar, npm run build, conferir, uiux, git
 *   status/diff, ls, mkdir da prova de UX); `--disallowedTools`: internet,
 *   subagente e a edição da casca, do pacote, da logo e da configuração;
 * - `--strict-mcp-config` sem `--mcp-config` (nenhum MCP) e
 *   `--no-session-persistence`;
 * - CLAUDE_CONFIG_DIR numa pasta vazia desta passada: o ~/.claude do dono
 *   (CLAUDE.md, skills, plugins, login) não entra;
 * - o ambiente sai da lista de permissão (`ambienteSemSegredos`): nada de
 *   SUPABASE_*, VERCEL_*, MOTOR_* nem chave de provedor. A chave da OpenRouter
 *   fica SÓ no medidor (lib/medidor.ts), que o Claude Code chama em
 *   127.0.0.1 com um token local de uso único; o medidor confere o token, põe
 *   a chave, abre só /api/v1/messages e soma o custo real (`usage.cost`).
 *
 * As skills entram como plugin (`--plugin-dir`): as da casa (skills-claude/
 * skills, no worker, em português: copy-de-site, prova-honesta, humanizar-texto,
 * clonar-referencia e partir-de-modelo-pronto) e a ui-ux-pro-max (só o
 * SKILL.md; a busca roda por `node scripts/uiux.mjs`). O AGENTS.md do modelo e
 * a abertura do Claude Code vão por `--append-system-prompt-file`; o pedido da
 * passada vai pela entrada padrão (sem o limite de 32 mil caracteres da linha
 * de comando do Windows).
 *
 * O teto do trabalho vale pelo custo real do medidor (o Claude Code não
 * conhece o preço dos modelos da OpenRouter): passou do teto, o processo
 * morre. Parar e prazo também matam o processo (taskkill /T no Windows).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type EventoResumido, type ModeloDoMotor, passouDoTeto } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { ambienteSemSegredos, arquivosDaCasca, BUSCADOR_DA_UIUX, PASTA_DO_WORKER, SKILL_DA_UIUX } from "./config-opencode.ts";
import { lerMarcasDaResposta, type MarcasDaResposta } from "./marcas-da-resposta.ts";
import { matar } from "./processos.ts";
import type { ResultadoDaPassada } from "./opencode.ts";

export const VERSAO_DO_CLAUDE_CODE = "2.1.310";

/** O binário do pacote npm (o postinstall põe o nativo da plataforma em bin/). */
export function binarioDoClaude(base: string = PASTA_DO_WORKER): string {
  const pasta = resolve(base, "node_modules", "@anthropic-ai", "claude-code", "bin");
  const exe = join(pasta, "claude.exe");
  return existsSync(exe) || process.platform === "win32" ? exe : join(pasta, "claude");
}

export const temClaudeCode = () => existsSync(binarioDoClaude());

/**
 * O plugin da casa (as skills do Claude Code). Mora no WORKER, nunca dentro do
 * projeto do cliente (o mesmo contrato das skills do opencode: o zip e o site
 * do cliente não levam o método da casa, e o --restricted ignora a .claude do
 * projeto de qualquer jeito).
 */
export const PLUGIN_DA_CASA = resolve(PASTA_DO_WORKER, "skills-claude");
export const AGENTS_DO_MODELO = resolve(PASTA_DO_WORKER, "modelo-site", "AGENTS.md");
export const ABERTURA_DO_CLAUDE = resolve(PASTA_DO_WORKER, "superpoderes", "ABERTURA-CLAUDE.md");

// ------------------------------------------------------------------ permissões

/** Ferramentas que existem na sessão (o resto nem aparece para o modelo). */
export const FERRAMENTAS_DO_CLAUDE = ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "Skill", "TodoWrite"] as const;

/** Os mesmos comandos do opencode (COMANDOS_LIBERADOS), na sintaxe do Claude Code. */
export const COMANDOS_DO_CLAUDE: readonly string[] = [
  "npm run checar",
  "npm run checar *",
  "npm run build",
  "node scripts/conferir.mjs *",
  "node scripts/uiux.mjs *",
  "git status",
  "git status *",
  "git diff",
  "git diff *",
  "ls",
  "ls *",
  "mkdir -p .aceleriq/ux",
];

/** O que o agente nunca edita: o que roda na máquina, a casca, o pacote, a marca e a configuração dos agentes. */
export const EDICAO_NEGADA_NO_CLAUDE: readonly string[] = [
  ".git/**",
  ".claude/**",
  ".opencode/**",
  "CLAUDE.md",
  "CLAUDE.local.md",
  ".mcp.json",
  "opencode.json",
  "opencode.jsonc",
  "node_modules/**",
  "package.json",
  "package-lock.json",
  "vite.config.*",
  "scripts/**",
  "src/marca.css",
  "public/marca/**",
  ".aceleriq/pacote.json",
  ".aceleriq/casca.json",
  ".aceleriq/ponte.js",
  ".aceleriq/uiux-*",
  "design-system/**",
  "referencias/**",
];

export function regrasDoClaude(casca: string[] = arquivosDaCasca()): { permitidas: string[]; negadas: string[] } {
  const permitidas = ["Read", "Glob", "Grep", "TodoWrite", "Skill", "Edit", "Write"].concat(COMANDOS_DO_CLAUDE.map((c) => `Bash(${c})`));
  const negadas = ["WebFetch", "WebSearch", "Task", "Agent", "NotebookEdit"];
  const caminhos = EDICAO_NEGADA_NO_CLAUDE.concat(casca.filter((a) => a && a.indexOf("..") < 0));
  for (const p of caminhos) negadas.push(`Edit(./${p})`);
  return { permitidas, negadas };
}

export type OpcoesDoClaude = { modelo: string; pluginDirs: string[]; sistema: string; esforco?: string | null; casca?: string[] };

/** Os argumentos do `claude` (o pedido vai pela entrada padrão). */
export function argumentosDoClaude(o: OpcoesDoClaude): string[] {
  const r = regrasDoClaude(o.casca);
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    o.modelo,
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--restricted",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--tools",
    FERRAMENTAS_DO_CLAUDE.join(","),
    "--allowedTools",
    ...r.permitidas,
    "--disallowedTools",
    ...r.negadas,
    "--append-system-prompt-file",
    o.sistema,
  ];
  for (const p of o.pluginDirs) args.push("--plugin-dir", p);
  if (o.esforco && /^(low|medium|high|xhigh|max)$/.test(o.esforco)) args.push("--effort", o.esforco);
  return args;
}

// ------------------------------------------------------------------ ambiente

/** Git Bash (o Claude Code no Windows usa o bash do Git). */
export function gitBashDaMaquina(env: Record<string, string | undefined> = process.env): string | null {
  const candidatos = [env.CLAUDE_CODE_GIT_BASH_PATH, env.OPENCODE_GIT_BASH_PATH, "C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"];
  for (const c of candidatos) if (c && existsSync(c)) return c;
  return null;
}

/**
 * Ambiente do `claude`, por lista de permissão. A chave NÃO entra: o token é
 * local (vale só no medidor desta passada). Todo papel de modelo (principal,
 * rápido, subagente) aponta para o mesmo modelo do trabalho.
 */
export function ambienteDoClaude(p: { base: string; tokenLocal: string; modelo: string; pastaDeConfig: string }, base: Record<string, string | undefined> = process.env): Record<string, string> {
  const bash = process.platform === "win32" ? gitBashDaMaquina(base) : null;
  return ambienteSemSegredos(base, {
    CLAUDE_CONFIG_DIR: p.pastaDeConfig,
    ANTHROPIC_BASE_URL: p.base,
    ANTHROPIC_AUTH_TOKEN: p.tokenLocal,
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: p.modelo,
    ANTHROPIC_DEFAULT_OPUS_MODEL: p.modelo,
    ANTHROPIC_DEFAULT_SONNET_MODEL: p.modelo,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: p.modelo,
    ANTHROPIC_SMALL_FAST_MODEL: p.modelo,
    CLAUDE_CODE_SUBAGENT_MODEL: p.modelo,
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_BUG_COMMAND: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    ...(bash ? { CLAUDE_CODE_GIT_BASH_PATH: bash } : {}),
    UIUX_BUSCADOR: BUSCADOR_DA_UIUX,
    NO_COLOR: "1",
  });
}

// ------------------------------------------------------------------ a pasta da subida

/** Configuração, sistema e o plugin da ui-ux-pro-max desta subida (apagados no fechar). */
export function montarPastaDaSubida(): { raiz: string; config: string; sistema: string; pluginUiux: string } {
  const raiz = mkdtempSync(join(tmpdir(), "aceleriq-claude-"));
  const config = join(raiz, "config");
  mkdirSync(config, { recursive: true });
  // O plugin da ui-ux-pro-max: só o SKILL.md (a busca roda por `node scripts/uiux.mjs`, com UIUX_BUSCADOR).
  const pluginUiux = join(raiz, "plugin-uiux");
  mkdirSync(join(pluginUiux, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pluginUiux, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "base-de-design", version: "2.15.0", description: "UI UX Pro Max 2.15.0 (MIT, Next Level Builder), a base de design do motor" }, null, 2));
  mkdirSync(join(pluginUiux, "skills", "ui-ux-pro-max"), { recursive: true });
  if (existsSync(join(SKILL_DA_UIUX, "SKILL.md"))) cpSync(join(SKILL_DA_UIUX, "SKILL.md"), join(pluginUiux, "skills", "ui-ux-pro-max", "SKILL.md"));
  const sistema = join(raiz, "sistema.md");
  const partes = [ABERTURA_DO_CLAUDE, AGENTS_DO_MODELO].filter((f) => existsSync(f)).map((f) => readFileSync(f, "utf8"));
  writeFileSync(sistema, partes.join("\n\n---\n\n"));
  return { raiz, config, sistema, pluginUiux };
}

/**
 * Antes de cada passada: o que um agente possa ter plantado para a próxima
 * (CLAUDE.md, .mcp.json, .claude/settings*) sai, e a .claude do projeto volta
 * a ser a do modelo. Devolve o que apagou.
 */
export function limparConfiguracaoDoClaude(pasta: string): string[] {
  const apagados: string[] = [];
  for (const n of ["CLAUDE.md", "CLAUDE.local.md", ".mcp.json"]) {
    if (existsSync(join(pasta, n))) {
      rmSync(join(pasta, n), { force: true });
      apagados.push(n);
    }
  }
  const dentro = join(pasta, ".claude");
  if (existsSync(dentro)) {
    for (const n of readdirSync(dentro)) {
      if (n === "skills" || n === ".claude-plugin") continue;
      rmSync(join(dentro, n), { recursive: true, force: true });
      apagados.push(`.claude/${n}`);
    }
  }
  return apagados;
}

// ------------------------------------------------------------------ a saída (stream-json)

const umaLinha = (s: unknown, n: number) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const nomeCurto = (caminho: unknown) => {
  const s = String(caminho || "").split(/[\\/]/).filter(Boolean);
  const i = s.lastIndexOf("src");
  return (i >= 0 ? s.slice(i) : s.slice(-2)).join("/").slice(0, 120);
};

/**
 * Tradutor do stream-json para a tela: o pedido de ferramenta fica guardado
 * pelo id e só vira evento quando o resultado chega (feito = passo; negado
 * pela permissão = aviso "Negado"). Assim a tela não mostra como feito o que
 * a trava da pasta recusou.
 */
export function criarTradutorDoClaude() {
  const pendentes = new Map<string, EventoResumido>();
  return {
    traduzir(linha: Record<string, unknown>): EventoResumido[] {
      if (linha.type === "user") {
        const msg = (linha.message || {}) as { content?: unknown };
        const saida: EventoResumido[] = [];
        for (const b of Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : []) {
          if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
          const ev = pendentes.get(b.tool_use_id);
          pendentes.delete(b.tool_use_id);
          if (!ev) continue;
          const texto = typeof b.content === "string" ? b.content : JSON.stringify(b.content || "");
          if (b.is_error && /denied|negad|permission|not allowed|outside/i.test(texto)) saida.push({ tipo: "aviso", resumo: umaLinha(`Negado pela trava da pasta: ${ev.resumo.replace(/^(Rodou|Escreveu|Alterou): ?/, "")}`, 200) });
          else if (!b.is_error) saida.push(ev);
        }
        return saida;
      }
      if (linha.type === "assistant") {
        const msg = (linha.message || {}) as { content?: Array<Record<string, unknown>> };
        for (const b of Array.isArray(msg.content) ? msg.content : []) {
          if (b.type !== "tool_use" || typeof b.id !== "string") continue;
          const ev = eventoDoClaude({ type: "assistant", message: { content: [b] } });
          if (ev) pendentes.set(b.id, ev);
        }
        return [];
      }
      const ev = eventoDoClaude(linha);
      return ev ? [ev] : [];
    },
  };
}

/** Uma linha do stream-json vira evento curto para a tela (ou null: ruído). */
export function eventoDoClaude(linha: Record<string, unknown>): EventoResumido | null {
  if (linha.type === "system" && linha.subtype === "init") {
    const skills = Array.isArray(linha.skills) ? (linha.skills as string[]).filter((s) => /^(casa-aceleriq|base-de-design):/.test(s)) : [];
    return { tipo: "passo", resumo: umaLinha(`Claude Code ${String(linha.claude_code_version || VERSAO_DO_CLAUDE_CODE)} com ${String(linha.model || "")} (${skills.length} skills da casa)`, 200), dados: { skills } };
  }
  if (linha.type !== "assistant") return null;
  const msg = (linha.message || {}) as { content?: Array<Record<string, unknown>> };
  for (const b of Array.isArray(msg.content) ? msg.content : []) {
    if (b.type !== "tool_use") continue;
    const e = (b.input || {}) as Record<string, unknown>;
    if (b.name === "Write" || b.name === "Edit") {
      const arquivo = nomeCurto(e.file_path);
      return { tipo: "arquivo", resumo: `${b.name === "Write" ? "Escreveu" : "Alterou"} ${arquivo}`, dados: { arquivo } };
    }
    if (b.name === "Bash") return { tipo: "comando", resumo: umaLinha(`Rodou: ${e.command || "comando"}`, 200) };
    if (b.name === "Skill") return { tipo: "passo", resumo: umaLinha(`Carregou a skill ${e.skill || e.name || ""}`, 120), dados: { skill: String(e.skill || e.name || "") } };
    if (b.name === "TodoWrite") return { tipo: "passo", resumo: "Organizou os próximos passos" };
  }
  return null;
}

export type UsoDoClaude = { entrada: number; saida: number; cache: number; criacao: number };

/** Soma o uso por mensagem (a mesma mensagem chega uma vez por bloco; vale a última). */
export function criarSomaDeUso() {
  const porMensagem = new Map<string, UsoDoClaude>();
  return {
    registrar(linha: Record<string, unknown>) {
      if (linha.type !== "assistant") return;
      const m = (linha.message || {}) as { id?: string; usage?: Record<string, unknown> };
      if (!m.id || !m.usage) return;
      const u = m.usage;
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      porMensagem.set(m.id, { entrada: n(u.input_tokens), saida: n(u.output_tokens), cache: n(u.cache_read_input_tokens), criacao: n(u.cache_creation_input_tokens) });
    },
    total(): UsoDoClaude {
      const t = { entrada: 0, saida: 0, cache: 0, criacao: 0 };
      porMensagem.forEach((v) => {
        t.entrada += v.entrada;
        t.saida += v.saida;
        t.cache += v.cache;
        t.criacao += v.criacao;
      });
      return t;
    },
  };
}

/** Custo pela tabela do catálogo (o real vem do medidor; este é o piso quando o medidor falha). */
export function custoPelaTabela(u: UsoDoClaude, m: Pick<ModeloDoMotor, "preco_entrada_1m" | "preco_saida_1m" | "preco_cache_1m">): number {
  const pe = Number(m.preco_entrada_1m) || 0;
  const ps = Number(m.preco_saida_1m) || 0;
  const pc = m.preco_cache_1m == null ? pe : Number(m.preco_cache_1m) || 0;
  return Math.round((((u.entrada + u.criacao) * pe + u.cache * pc + u.saida * ps) / 1_000_000) * 1e8) / 1e8;
}

// ------------------------------------------------------------------ uma passada

export type ServidorDoClaude = {
  modo: "claude_code";
  limpos: string[];
  fechar: () => void;
  pasta: string;
  medidor: { base: string; total: () => number };
  tokenLocal: string;
  subida: ReturnType<typeof montarPastaDaSubida>;
};

/** Prepara a subida (não abre processo: cada passada é um `claude -p`). */
export function subirClaudeCode(pasta: string, medidor: { base: string; total: () => number }, tokenLocal: string): ServidorDoClaude {
  if (!temClaudeCode()) throw new Error(`o Claude Code não está instalado no worker (npm install em workers/motor-codigo; @anthropic-ai/claude-code ${VERSAO_DO_CLAUDE_CODE})`);
  if (process.platform === "win32" && !gitBashDaMaquina()) throw new Error("o Claude Code no Windows precisa do Git Bash (instale o Git for Windows ou ponha CLAUDE_CODE_GIT_BASH_PATH)");
  const limpos = limparConfiguracaoDoClaude(pasta);
  const subida = montarPastaDaSubida();
  return {
    modo: "claude_code",
    limpos,
    pasta,
    medidor,
    tokenLocal,
    subida,
    fechar: () => {
      setTimeout(() => {
        try {
          rmSync(subida.raiz, { recursive: true, force: true });
        } catch {
          /* o Windows solta depois; fica no temporário */
        }
      }, 1500);
    },
  };
}

export const novoTokenLocal = () => `local-${randomBytes(24).toString("hex")}`;

export async function rodarPassadaClaude(
  s: ServidorDoClaude,
  p: {
    titulo: string;
    pedido: string;
    modelo: ModeloDoMotor;
    tetoUsd: number;
    jaGasto: number;
    prazoMs: number;
    aoEvento: (ev: EventoResumido) => void;
    aoCusto: (totalDoTrabalho: number) => void;
    deveParar: () => Promise<boolean>;
    esforco?: string | null;
  },
): Promise<ResultadoDaPassada> {
  const sessao = `claude-${randomBytes(6).toString("hex")}`;
  limparConfiguracaoDoClaude(s.pasta);
  const modelo = p.modelo.modelo_api;
  const args = argumentosDoClaude({ modelo, pluginDirs: [PLUGIN_DA_CASA, s.subida.pluginUiux], sistema: s.subida.sistema, esforco: p.esforco ?? process.env.MOTOR_CLAUDE_ESFORCO ?? null });
  const env = ambienteDoClaude({ base: s.medidor.base, tokenLocal: s.tokenLocal, modelo, pastaDeConfig: s.subida.config });
  const soma = criarSomaDeUso();
  const tradutor = criarTradutorDoClaude();
  const inicioDoReal = s.medidor.total();
  let motivo: ResultadoDaPassada["motivo"] = "feito";
  let erro: string | null = null;
  let resposta = "";
  let resultado: Record<string, unknown> | null = null;
  let abortado = false;
  let proc: ChildProcess | null = null;
  const abortar = (m: ResultadoDaPassada["motivo"]) => {
    if (abortado) return;
    abortado = true;
    motivo = m;
    matar(proc);
  };
  const custoDaPassada = () => Math.max(custoPelaTabela(soma.total(), p.modelo), s.medidor.total() - inicioDoReal);
  const fim = new Promise<void>((ok) => {
    proc = spawn(binarioDoClaude(), args, { cwd: s.pasta, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let errBuf = "";
    proc.stdout?.on("data", (c: Buffer) => {
      buf += c.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const bruta = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!bruta) continue;
        let linha: Record<string, unknown>;
        try {
          linha = JSON.parse(bruta);
        } catch {
          continue;
        }
        soma.registrar(linha);
        for (const ev of tradutor.traduzir(linha)) p.aoEvento(ev);
        if (linha.type === "result") resultado = linha;
        if (linha.type === "assistant") {
          const total = p.jaGasto + custoDaPassada();
          p.aoCusto(total);
          if (passouDoTeto(total, p.tetoUsd)) abortar("teto");
        }
      }
    });
    proc.stderr?.on("data", (c: Buffer) => {
      errBuf = (errBuf + c.toString()).slice(-4000);
    });
    proc.on("error", (e) => {
      if (!abortado) erro = `o Claude Code não abriu: ${e.message}`.slice(0, 300);
      ok();
    });
    proc.on("close", (codigo) => {
      if (!abortado && !resultado && codigo !== 0) erro = `o Claude Code saiu com ${codigo}: ${errBuf.replace(/\s+/g, " ").trim().slice(-280)}`;
      ok();
    });
    // O pedido vai pela entrada padrão.
    proc.stdin?.end(p.pedido);
  });
  const vigia = setInterval(async () => {
    if (await p.deveParar().catch(() => false)) abortar("parado");
    const total = p.jaGasto + custoDaPassada();
    p.aoCusto(total);
    if (passouDoTeto(total, p.tetoUsd)) abortar("teto");
  }, 3000);
  const prazo = setTimeout(() => abortar("prazo"), p.prazoMs);
  try {
    await fim;
  } finally {
    clearInterval(vigia);
    clearTimeout(prazo);
  }
  let marcas: MarcasDaResposta = lerMarcasDaResposta("");
  const r = resultado as Record<string, unknown> | null;
  if (r) {
    const texto = typeof r.result === "string" ? r.result : "";
    marcas = lerMarcasDaResposta(texto);
    resposta = texto.slice(0, 2000);
    if (r.is_error && !abortado && !erro) erro = umaLinha(`${String(r.subtype || "erro")}: ${texto || ""}`, 300);
  }
  if (erro && motivo === "feito") motivo = "erro";
  const u = soma.total();
  return {
    ok: motivo === "feito",
    motivo,
    erro,
    custo: { custo_usd: custoPelaTabela(u, p.modelo), tokens_entrada: u.entrada + u.criacao + u.cache, tokens_saida: u.saida, tokens_cache: u.cache },
    resposta,
    marcas,
    sessao,
  };
}
