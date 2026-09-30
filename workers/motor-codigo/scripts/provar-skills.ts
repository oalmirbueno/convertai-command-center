/**
 * Prova local de que a skill ui-ux-pro-max carrega no motor e que o agente só
 * vê as skills da casa (frente UIM, 30/09/2026). Manual: não roda no CI.
 *
 *   node --env-file-if-exists=.env scripts/provar-skills.ts               Etapa A (sem gasto)
 *   node --env-file-if-exists=.env scripts/provar-skills.ts --com-gasto   Etapas A e B (até US$ 0,20)
 *
 * Opções: --pasta <onde guardar as provas> (padrão C:\AI\motor-codigo\provas)
 *         --modelo <id do OpenRouter> (só sem o catálogo do banco; padrão deepseek/deepseek-v4-flash)
 *
 * Etapa A, sem modelo: cria um projeto do modelo da casa e roda
 *   1. `opencode debug skill --pure` com o ambiente e a configuração do worker:
 *      a lista tem de ser SKILLS_DA_CASA + a embutida customize-opencode;
 *   2. `opencode debug agent build --pure`: bash, skill e read ligados, webfetch
 *      desligado (e a configuração antiga, com "*" no fim, mostra bash desligado);
 *   3. `node scripts/uiux.mjs "law firm legal services" --design-system -f markdown`.
 * Etapa B, com o modelo mais barato do catálogo e o medidor do custo real:
 * uma sessão pede para carregar a skill, rodar o buscador e responder SKILL_OK.
 * Para sozinha em US$ 0,15 (teto da passada) e reprova acima de US$ 0,20.
 *
 * As provas vão para <pasta>/uiux-<data>/prova.json (com as saídas brutas ao lado).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ambienteDoOpencode, COMANDOS_LIBERADOS, configDoOpencode, ferramentaLigada, SKILLS_DA_CASA, temChave } from "../lib/config-opencode.ts";
import { garantirProjeto, git } from "../lib/projeto.ts";
import { acharPython } from "../modelo-site/scripts/uiux.mjs";
import { conferirManifesto } from "./instalar-ui-ux-pro-max.mjs";
import type { ModeloDoMotor } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { presetsDoMotor, type ModeloParaPreset } from "../../../supabase/functions/_shared/site-biblioteca.ts";

const arg = (nome: string, padrao: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const COM_GASTO = process.argv.indexOf("--com-gasto") >= 0;
const PARADA_USD = 0.15;
const TETO_USD = 0.2;
const RAIZ = resolve(arg("pasta", process.platform === "win32" ? "C:\\AI\\motor-codigo\\provas" : join(process.cwd(), "provas")));
const CARIMBO = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SAIDA = join(RAIZ, `uiux-${CARIMBO}`);
const PROJETO = join(SAIDA, "projeto");
const BINARIO = resolve(import.meta.dirname, "..", "node_modules", "opencode-ai", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
/** Skills pessoais que já apareceram no agente (prova do vazamento, seção 2 do desenho). */
const PESSOAIS_CONHECIDAS = ["hyperframes", "design-taste-frontend", "taste-skill", "obsidian", "watch", "yt-pipeline", "typesafe-ai"];
const PEDIDO = [
  "Teste de carregamento.",
  "1) Carregue a skill ui-ux-pro-max com a ferramenta skill.",
  '2) Rode exatamente: node scripts/uiux.mjs "accessible ethical" --domain style -n 1',
  "3) Responda numa linha: SKILL_OK e o nome do estilo devolvido.",
  "Não edite nenhum arquivo.",
].join("\n");

type Checagem = { nome: string; ok: boolean; detalhe?: unknown };
const checagens: Checagem[] = [];
const checar = (nome: string, ok: boolean, detalhe?: unknown) => {
  checagens.push({ nome, ok, detalhe });
  console.log(`[prova] ${ok ? "ok  " : "FALHOU"} ${nome}`);
};
const guardar = (nome: string, conteudo: string) => writeFileSync(join(SAIDA, nome), conteudo);

function opencode(args: string[], env: Record<string, string>) {
  const r = spawnSync(BINARIO, args, { cwd: PROJETO, env, encoding: "utf8", timeout: 120_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { codigo: r.status, saida: String(r.stdout || ""), erro: String(r.stderr || "") };
}

function json<T>(texto: string): T | null {
  const i = texto.search(/[[{]/);
  if (i < 0) return null;
  try {
    return JSON.parse(texto.slice(i)) as T;
  } catch {
    return null;
  }
}

function pycacheNaSkill(): string[] {
  const achados: string[] = [];
  const base = join(PROJETO, ".opencode", "skills");
  (function andar(d: string) {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const c = join(d, n);
      if (statSync(c).isDirectory()) {
        if (n === "__pycache__") achados.push(c);
        else andar(c);
      }
    }
  })(base);
  return achados;
}

/** O modelo da Etapa B: o "Rápido e barato" do catálogo (OpenRouter, pelo medidor); sem banco, o --modelo com o preço público. */
async function modeloMaisBarato(): Promise<{ modelo: ModeloDoMotor; origem: string }> {
  const url = process.env.SUPABASE_URL || "";
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (url && chave) {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from("ia_modelos").select("id, provedor, modelo_api, tipo, ativo, rotulo, preco_entrada_1m, preco_saida_1m, preco_cache_1m, contexto_tokens, padrao_para").eq("ativo", true).eq("provedor", "openrouter");
    if (!error && Array.isArray(data)) {
      const { rapido } = presetsDoMotor(data as ModeloParaPreset[]);
      if (rapido) return { modelo: rapido as ModeloDoMotor, origem: "catálogo (presetsDoMotor: rápido e barato)" };
    }
  }
  const id = arg("modelo", "deepseek/deepseek-v4-flash");
  const r = await fetch("https://openrouter.ai/api/v1/models");
  const j = (await r.json()) as { data: Array<{ id: string; context_length: number; pricing: Record<string, string> }> };
  const m = j.data.find((x) => x.id === id);
  if (!m) throw new Error(`modelo ${id} não está no OpenRouter`);
  const por1m = (v?: string) => (v ? Number(v) * 1e6 : null);
  return { modelo: { id: `openrouter:${id}`, provedor: "openrouter", modelo_api: id, preco_entrada_1m: por1m(m.pricing.prompt), preco_saida_1m: por1m(m.pricing.completion), preco_cache_1m: por1m(m.pricing.input_cache_read), contexto_tokens: m.context_length }, origem: "--modelo com o preço público do OpenRouter" };
}

async function etapaA(modelo: ModeloDoMotor) {
  const config = configDoOpencode(modelo);
  const env = ambienteDoOpencode(process.env, config);
  const versao = opencode(["--version"], env).saida.trim();

  // 1. Só as skills da casa.
  const skills = opencode(["debug", "skill", "--pure"], env);
  guardar("a1-debug-skill.json", skills.saida);
  const lista = (json<Array<{ name: string; location?: string }>>(skills.saida) || []).map((s) => s.name).sort();
  const esperada = [...SKILLS_DA_CASA, "customize-opencode"].sort();
  checar("A1 debug skill: só as skills da casa e a embutida", JSON.stringify(lista) === JSON.stringify(esperada), { lista, esperada });
  // Para comparar: o mesmo comando sem o isolamento (só a configuração).
  const solto = opencode(["debug", "skill", "--pure"], { ...(process.env as Record<string, string>), OPENCODE_CONFIG_CONTENT: JSON.stringify(config) });
  const listaSolta = (json<Array<{ name: string }>>(solto.saida) || []).map((s) => s.name).sort();
  const vazariam = listaSolta.filter((n) => esperada.indexOf(n) < 0);
  checar("A1 nenhuma skill pessoal com o isolamento", !lista.some((n) => PESSOAIS_CONHECIDAS.indexOf(n) >= 0), { sem_isolamento_vazariam: vazariam.length, exemplos: vazariam.slice(0, 12) });

  // 2. Ferramentas ligadas: bash (npm run checar, node scripts/uiux.mjs) e skill.
  const agente = opencode(["debug", "agent", "build", "--pure"], env);
  guardar("a2-debug-agent-build.json", agente.saida);
  const tools = (json<{ tools?: Record<string, boolean> }>(agente.saida) || {}).tools || {};
  checar("A2 bash, skill e read ligados; webfetch desligado", tools.bash === true && tools.skill === true && tools.read === true && tools.webfetch === false, tools);
  checar("A2 a conta local bate com o opencode", ferramentaLigada(config.permission.bash) === tools.bash && ferramentaLigada(config.permission.skill) === tools.skill);
  // A configuração antiga (antes da UIM): "*" no fim desligava o bash inteiro.
  const antigaBash: Record<string, "allow" | "deny"> = {};
  COMANDOS_LIBERADOS.filter((c) => c !== "node scripts/uiux.mjs *").forEach((c) => (antigaBash[c] = "allow"));
  antigaBash["*"] = "deny";
  const antiga = { ...config, permission: { edit: "allow", webfetch: "deny", external_directory: "deny", doom_loop: "deny", bash: antigaBash } };
  const agenteAntigo = opencode(["debug", "agent", "build", "--pure"], ambienteDoOpencode(process.env, antiga));
  guardar("a2-debug-agent-build-config-antiga.json", agenteAntigo.saida);
  const toolsAntigas = (json<{ tools?: Record<string, boolean> }>(agenteAntigo.saida) || {}).tools || {};
  checar("A2 prova do conserto: a configuração antiga deixa o bash desligado", toolsAntigas.bash === false, { bash_antes: toolsAntigas.bash, bash_agora: tools.bash });

  // 3. A busca direta pelo embrulho.
  const antesPy = pycacheNaSkill().length;
  const busca = spawnSync(process.execPath, ["scripts/uiux.mjs", "law firm legal services", "--design-system", "-f", "markdown"], { cwd: PROJETO, env, encoding: "utf8", timeout: 60_000, windowsHide: true });
  guardar("a3-busca.md", String(busca.stdout || "") + (busca.stderr ? `\n[stderr]\n${busca.stderr}` : ""));
  checar("A3 node scripts/uiux.mjs devolve o design system", busca.status === 0 && /Accessible & Ethical/.test(String(busca.stdout || "")), { codigo: busca.status });
  checar("A3 sem __pycache__ novo na skill", pycacheNaSkill().length === antesPy, { antes: antesPy, depois: pycacheNaSkill().length });

  // 4. A skill do projeto é a instalada (manifesto) e o binário conhece o desligamento do CLAUDE.md.
  const pastaSkill = join(PROJETO, ".opencode", "skills", "ui-ux-pro-max");
  const manifesto = conferirManifesto(pastaSkill) as { ok: boolean; arquivos: number; problemas: string[] };
  checar("A4 manifesto da skill confere no projeto", manifesto.ok, manifesto);
  const binario = readFileSync(BINARIO);
  checar("A4 o opencode lê OPENCODE_DISABLE_CLAUDE_CODE (desliga o ~/.claude/CLAUDE.md)", binario.indexOf("OPENCODE_DISABLE_CLAUDE_CODE") >= 0 && binario.indexOf("disableClaudeCodePrompt") >= 0);
  return {
    opencode: versao,
    skills: lista,
    sem_isolamento: { total: listaSolta.length, vazariam: vazariam.length },
    tools,
    tools_config_antiga: { bash: toolsAntigas.bash, skill: toolsAntigas.skill },
    manifesto_sha256: createHash("sha256").update(readFileSync(join(pastaSkill, "manifesto.json"))).digest("hex"),
  };
}

type Parte = { type?: string; tool?: string; text?: string; state?: { status?: string; input?: Record<string, unknown>; output?: string } };

async function etapaB() {
  if (!temChave("openrouter")) {
    checar("B sem OPENROUTER_API_KEY no ambiente: etapa B não rodou", false);
    return { rodou: false };
  }
  const { modelo, origem } = await modeloMaisBarato();
  console.log(`[prova] etapa B com ${modelo.modelo_api} (${origem}); parada em US$ ${PARADA_USD}, teto US$ ${TETO_USD}`);
  const { abrirMedidor } = await import("../lib/medidor.ts");
  const { rodarPassada, subirOpencode } = await import("../lib/opencode.ts");
  const medidor = await abrirMedidor();
  const servidor = await subirOpencode(PROJETO, modelo, medidor.url);
  const eventos: unknown[] = [];
  let partes: Parte[] = [];
  let r: Awaited<ReturnType<typeof rodarPassada>> | null = null;
  try {
    r = await rodarPassada(servidor, {
      titulo: "prova-skills-uiux",
      pedido: PEDIDO,
      modelo,
      tetoUsd: PARADA_USD,
      jaGasto: 0,
      prazoMs: 5 * 60_000,
      aoEvento: (ev) => eventos.push(ev),
      aoCusto: () => {},
      deveParar: async () => medidor.total() >= PARADA_USD,
      custoReal: medidor.total,
    });
    const sessoes = await servidor.cliente.session.list();
    const lista = (Array.isArray(sessoes.data) ? sessoes.data : []) as Array<{ id: string; title?: string; time?: { created?: number } }>;
    const sessao = lista.filter((s) => s.title === "prova-skills-uiux").sort((a, b) => ((b.time && b.time.created) || 0) - ((a.time && a.time.created) || 0))[0];
    if (sessao) {
      const msgs = await servidor.cliente.session.messages({ path: { id: sessao.id } });
      const todas = (Array.isArray(msgs.data) ? msgs.data : []) as Array<{ info?: { role?: string }; parts?: Parte[] }>;
      partes = todas.filter((m) => m.info && m.info.role === "assistant").flatMap((m) => m.parts || []);
    }
  } finally {
    servidor.fechar();
  }
  const custo = medidor.total();
  await medidor.fechar();
  const ferramentas = partes.filter((p) => p.type === "tool");
  const skill = ferramentas.find((p) => p.tool === "skill" && p.state && p.state.status === "completed" && p.state.input && p.state.input.name === "ui-ux-pro-max");
  const bash = ferramentas.find((p) => p.tool === "bash" && p.state && p.state.status === "completed" && /^node scripts[\\/]uiux\.mjs/.test(String((p.state.input || {}).command || "")));
  const texto = partes.filter((p) => p.type === "text" && p.text).map((p) => String(p.text)).join("\n").trim();
  const edicoes = ferramentas.filter((p) => ["edit", "write", "patch", "multiedit", "apply_patch"].indexOf(String(p.tool)) >= 0);
  const status = await git(PROJETO, ["status", "--porcelain"]);
  const mudados = status.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
  checar("B a sessão carregou a skill ui-ux-pro-max", !!skill);
  checar("B rodou node scripts/uiux.mjs e a busca devolveu um estilo", !!bash && /Style Category|Accessible & Ethical/.test(String((bash.state && bash.state.output) || "")), bash ? { comando: (bash.state && bash.state.input) || null } : null);
  checar("B respondeu SKILL_OK", /^\W*SKILL_OK/.test(texto), texto.slice(0, 200));
  checar("B não editou arquivo", edicoes.length === 0, edicoes.map((p) => p.tool));
  checar("B git status só com o log da base", mudados.every((m) => m === ".aceleriq/uiux-log.jsonl" || m.indexOf(".opencode/") === 0) && mudados.indexOf(".aceleriq/uiux-log.jsonl") >= 0, mudados);
  checar(`B custo real até US$ ${TETO_USD}`, custo <= TETO_USD, custo);
  guardar("b-partes.json", JSON.stringify(partes.map((p) => ({ type: p.type, tool: p.tool, status: p.state && p.state.status, input: p.state && p.state.input, output: p.state && typeof p.state.output === "string" ? p.state.output.slice(0, 1500) : undefined, text: p.text ? String(p.text).slice(0, 500) : undefined })), null, 2));
  return { rodou: true, modelo: modelo.modelo_api, origem_do_modelo: origem, custo_real_usd: custo, custo_tabela_usd: r ? r.custo.custo_usd : null, motivo: r ? r.motivo : null, tokens: r ? r.custo : null, resposta: texto.slice(0, 300), mudados, eventos: eventos.length };
}

async function principal() {
  mkdirSync(SAIDA, { recursive: true });
  const python = acharPython(process.env) as string | null;
  if (python) process.env.UIUX_PYTHON = python;
  checar("Python 3.8+ para a busca da base", !!python, python);
  await garantirProjeto(PROJETO);
  const placeholder: ModeloDoMotor = { id: "openrouter:deepseek/deepseek-v4-flash", provedor: "openrouter", modelo_api: "deepseek/deepseek-v4-flash", preco_entrada_1m: 0.0763, preco_saida_1m: 0.1526, preco_cache_1m: 0.01526, contexto_tokens: 1_000_000 };
  const a = await etapaA(placeholder);
  const b = COM_GASTO ? await etapaB() : { rodou: false, motivo: "rode com --com-gasto (até US$ 0,20)" };
  const prova = { quando: new Date().toISOString(), pasta: SAIDA, projeto: PROJETO, skills_da_casa: SKILLS_DA_CASA, python, etapa_a: a, etapa_b: b, checagens, passou: checagens.every((c) => c.ok) };
  writeFileSync(join(SAIDA, "prova.json"), JSON.stringify(prova, null, 2));
  console.log(`[prova] ${prova.passou ? "PASSOU" : "REPROVADA"}: ${checagens.filter((c) => c.ok).length}/${checagens.length} checagens; prova em ${join(SAIDA, "prova.json")}`);
  if (!prova.passou) process.exitCode = 1;
}

await principal().catch((e) => {
  console.error("[prova] falhou:", e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
