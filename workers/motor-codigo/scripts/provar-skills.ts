/**
 * Prova local de que a skill ui-ux-pro-max carrega no motor, de que o agente
 * só vê as skills da casa e de quanto uma seção custa com ela (frente UIM,
 * 30/09/2026). Manual: não roda no CI.
 *
 *   node --env-file-if-exists=.env scripts/provar-skills.ts                 Etapa A (sem gasto)
 *   node --env-file-if-exists=.env scripts/provar-skills.ts --com-gasto     Etapas A e B (até US$ 0,20)
 *   node --env-file-if-exists=.env scripts/provar-skills.ts --secao hero    Etapas A e C (até US$ 0,20)
 *
 * Opções: --pasta <onde guardar as provas> (padrão C:\AI\motor-codigo\provas)
 *         --modelo <id do OpenRouter> (só sem o catálogo do banco; padrão deepseek/deepseek-v4-flash)
 *         --projetos <pasta dos projetos da etapa C> (padrão C:\AI\motor-codigo\teste-e2e\projetos,
 *                    que já tem a _base com as dependências do modelo)
 *         --pacote <pacote.json> (etapa C; padrão o do projeto do teste de ponta a ponta)
 *
 * Etapa A, sem modelo: cria um projeto do modelo da casa e roda
 *   1. `opencode debug skill --pure` com o ambiente e a configuração do worker:
 *      a lista tem de ser SKILLS_DA_CASA + a embutida customize-opencode, com a
 *      ui-ux-pro-max vinda da pasta do worker (vendor), nunca do projeto;
 *   2. `opencode debug agent build --pure`: bash, skill e read ligados, webfetch
 *      desligado (e a configuração antiga, com "*" no fim, mostra bash desligado);
 *   3. `node scripts/uiux.mjs "law firm legal services" --design-system -f markdown`;
 *   4. manifesto da skill do worker e o projeto sem pasta .opencode;
 *   5. o design system do motor: gera pela consulta, refaz quando ela muda e
 *      sai quando ela fica vazia.
 * Etapa B, com o modelo mais barato do catálogo e o medidor do custo real:
 * uma sessão pede para carregar a skill, rodar o buscador e responder SKILL_OK.
 * Etapa C: constrói UMA seção inteira pelo executarTrabalho (skill, buscas,
 * design system e `npm run checar`), mede os tokens e compara com a
 * estimativa do painel (TOKENS_POR_SECAO + TOKENS_DA_SKILL).
 * B e C param sozinhas em US$ 0,15 (teto do trabalho) e reprovam acima de US$ 0,20.
 *
 * As provas vão para <pasta>/uiux-<data>/prova.json (com as saídas brutas ao lado).
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ambienteDoOpencode, BUSCADOR_DA_UIUX, COMANDOS_LIBERADOS, configDoOpencode, ferramentaLigada, PASTA_CASA_DO_OPENCODE, SKILL_DA_UIUX, SKILLS_DA_CASA, temChave } from "../lib/config-opencode.ts";
import { commitar, garantirProjeto, git } from "../lib/projeto.ts";
import { lerConsultaGravada, masterDoProjeto, prepararDesignSystem } from "../lib/design-system.ts";
import { acharPython, buscar } from "../modelo-site/scripts/uiux.mjs";
import { conferirManifesto } from "./instalar-ui-ux-pro-max.mjs";
import { estimarTrabalho, type ModeloDoMotor, nomeDoProjeto, TOKENS_DA_BASE, TOKENS_DA_SKILL, TOKENS_POR_SECAO } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { presetsDoMotor, type ModeloParaPreset } from "../../../supabase/functions/_shared/site-biblioteca.ts";

const arg = (nome: string, padrao: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const COM_GASTO = process.argv.indexOf("--com-gasto") >= 0;
const SECAO = arg("secao", "");
const PARADA_USD = 0.15;
const TETO_USD = 0.2;
const WIN = process.platform === "win32";
const RAIZ = resolve(arg("pasta", WIN ? "C:\\AI\\motor-codigo\\provas" : join(process.cwd(), "provas")));
const CARIMBO = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SAIDA = join(RAIZ, `uiux-${CARIMBO}`);
const PROJETO = join(SAIDA, "projeto");
const BINARIO = resolve(import.meta.dirname, "..", "node_modules", "opencode-ai", "bin", WIN ? "opencode.exe" : "opencode");
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

/** Pastas __pycache__ dentro da skill do worker (o embrulho desliga o cache do Python). */
function pycacheNaSkill(): string[] {
  const achados: string[] = [];
  (function andar(d: string) {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const c = join(d, n);
      if (statSync(c).isDirectory()) {
        if (n === "__pycache__") achados.push(c);
        else andar(c);
      }
    }
  })(SKILL_DA_UIUX);
  return achados;
}

/** O que existe em .opencode dentro de uma pasta (a skill fora do projeto não pode fazer o opencode instalar nada ali). */
function opencodeNoProjeto(pasta: string): string[] {
  const d = join(pasta, ".opencode");
  return existsSync(d) ? readdirSync(d) : [];
}

/** O modelo das etapas com gasto: o "Rápido e barato" do catálogo (OpenRouter, pelo medidor); sem banco, o --modelo com o preço público. */
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
  const config = configDoOpencode(modelo, null, { tipo: "construir" });
  const env = ambienteDoOpencode(config, "nativo");
  mkdirSync(PASTA_CASA_DO_OPENCODE, { recursive: true });
  const versao = opencode(["--version"], env).saida.trim();

  // 1. Só as skills da casa, e a da UIUX vem da pasta do worker.
  const skills = opencode(["debug", "skill", "--pure"], env);
  guardar("a1-debug-skill.json", skills.saida);
  const achadas = json<Array<{ name: string; location?: string }>>(skills.saida) || [];
  const lista = achadas.map((s) => s.name).sort();
  const esperada = [...SKILLS_DA_CASA, "customize-opencode"].sort();
  checar("A1 debug skill: só as skills da casa e a embutida", JSON.stringify(lista) === JSON.stringify(esperada), { lista, esperada });
  const daUiux = achadas.find((s) => s.name === "ui-ux-pro-max");
  const local = daUiux && daUiux.location ? resolve(daUiux.location).toLowerCase() : "";
  checar("A1 a ui-ux-pro-max vem do worker (vendor), não do projeto", !!local && local.indexOf(SKILL_DA_UIUX.toLowerCase()) === 0, daUiux ? daUiux.location : null);
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
  const agenteAntigo = opencode(["debug", "agent", "build", "--pure"], ambienteDoOpencode(antiga, "nativo"));
  guardar("a2-debug-agent-build-config-antiga.json", agenteAntigo.saida);
  const toolsAntigas = (json<{ tools?: Record<string, boolean> }>(agenteAntigo.saida) || {}).tools || {};
  checar("A2 prova do conserto: a configuração antiga deixa o bash desligado", toolsAntigas.bash === false, { bash_antes: toolsAntigas.bash, bash_agora: tools.bash });

  // 3. A busca direta pelo embrulho, com o buscador do worker (UIUX_BUSCADOR do ambiente).
  const antesPy = pycacheNaSkill().length;
  const busca = spawnSync(process.execPath, ["scripts/uiux.mjs", "law firm legal services", "--design-system", "-f", "markdown"], { cwd: PROJETO, env, encoding: "utf8", timeout: 60_000, windowsHide: true });
  guardar("a3-busca.md", String(busca.stdout || "") + (busca.stderr ? `\n[stderr]\n${busca.stderr}` : ""));
  checar("A3 node scripts/uiux.mjs devolve o design system", busca.status === 0 && /Accessible & Ethical/.test(String(busca.stdout || "")), { codigo: busca.status });
  checar("A3 sem __pycache__ novo na skill", pycacheNaSkill().length === antesPy, { antes: antesPy, depois: pycacheNaSkill().length });
  const persist = spawnSync(process.execPath, ["scripts/uiux.mjs", "law firm", "--design-system", "--persist", "-p", "X"], { cwd: PROJETO, env, encoding: "utf8", timeout: 60_000, windowsHide: true });
  checar("A3 o agente não consegue gravar o design system (--persist recusado)", persist.status === 2 && !existsSync(join(PROJETO, "design-system")), { codigo: persist.status });

  // 4. A skill do worker é a instalada (manifesto) e o projeto não tem pasta .opencode.
  const manifesto = conferirManifesto(SKILL_DA_UIUX) as { ok: boolean; arquivos: number; problemas: string[] };
  checar("A4 manifesto da skill do worker confere", manifesto.ok, manifesto);
  checar("A4 o projeto novo não tem pasta .opencode", opencodeNoProjeto(PROJETO).length === 0, opencodeNoProjeto(PROJETO));
  const binario = readFileSync(BINARIO);
  checar("A4 o opencode lê OPENCODE_DISABLE_CLAUDE_CODE (desliga o ~/.claude/CLAUDE.md)", binario.indexOf("OPENCODE_DISABLE_CLAUDE_CODE") >= 0 && binario.indexOf("disableClaudeCodePrompt") >= 0);

  // 5. Design system do motor: gera pela consulta, refaz quando ela muda e sai sem ela.
  const deps = { buscar: buscar as never, commitar, buscador: BUSCADOR_DA_UIUX };
  const p1 = { cliente: "Prova Advocacia", base_de_design: { versao: "uupm-2.15.0", consulta: "Legal Services Accessible & Ethical", regras_ux: [] } };
  const g1 = await prepararDesignSystem(PROJETO, p1, deps);
  const m1 = masterDoProjeto(PROJETO);
  const texto1 = m1 ? readFileSync(join(PROJETO, m1), "utf8") : "";
  checar("A5 o motor gera o MASTER.md pela consulta do pacote", g1.acao === "gerar" && g1.ok && !!m1 && /Accessible/i.test(texto1), { acao: g1.acao, master: m1, motivo: g1.motivo });
  const g2 = await prepararDesignSystem(PROJETO, p1, deps);
  checar("A5 mesma consulta: nada muda", g2.acao === "manter", g2.acao);
  const p2 = { ...p1, base_de_design: { ...p1.base_de_design, consulta: "Marketing Agency Dark Mode OLED" } };
  const g3 = await prepararDesignSystem(PROJETO, p2, deps);
  const texto3 = g3.master ? readFileSync(join(PROJETO, g3.master), "utf8") : "";
  checar("A5 consulta nova: o MASTER.md é refeito", g3.acao === "gerar" && g3.ok && texto3 !== texto1 && (lerConsultaGravada(PROJETO) || { consulta: "" }).consulta === "Marketing Agency Dark Mode OLED", { acao: g3.acao, master: g3.master });
  const g4 = await prepararDesignSystem(PROJETO, { cliente: "Prova Advocacia", base_de_design: { versao: "uupm-2.15.0", consulta: "", regras_ux: [] } }, deps);
  checar("A5 consulta vazia: o design system sai do projeto", g4.acao === "apagar" && !existsSync(join(PROJETO, "design-system")), g4.acao);
  const log = await git(PROJETO, ["log", "--format=%s", "-4"]);
  guardar("a5-git-log.txt", log);
  return {
    opencode: versao,
    skills: lista,
    local_da_skill: daUiux ? daUiux.location : null,
    sem_isolamento: { total: listaSolta.length, vazariam: vazariam.length },
    tools,
    tools_config_antiga: { bash: toolsAntigas.bash, skill: toolsAntigas.skill },
    manifesto_sha256: createHash("sha256").update(readFileSync(join(SKILL_DA_UIUX, "manifesto.json"))).digest("hex"),
    design_system: { gerar: g1.acao, manter: g2.acao, refazer: g3.acao, apagar: g4.acao, commits: log.split("\n") },
  };
}

type Parte = { type?: string; tool?: string; text?: string; state?: { status?: string; input?: Record<string, unknown>; output?: string } };

async function etapaB(modelo: ModeloDoMotor, origem: string) {
  console.log(`[prova] etapa B com ${modelo.modelo_api} (${origem}); parada em US$ ${PARADA_USD}, teto US$ ${TETO_USD}`);
  const { abrirMedidor } = await import("../lib/medidor.ts");
  const { rodarPassada, subirOpencode } = await import("../lib/opencode.ts");
  const medidor = await abrirMedidor();
  const casaAntes = existsSync(PASTA_CASA_DO_OPENCODE) ? readdirSync(PASTA_CASA_DO_OPENCODE) : [];
  const servidor = await subirOpencode(PROJETO, modelo, medidor.url, { tipo: "construir" });
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
  checar("B a sessão carregou a skill ui-ux-pro-max (da pasta do worker)", !!skill);
  checar("B rodou node scripts/uiux.mjs e a busca devolveu um estilo", !!bash && /Style Category|Accessible & Ethical/.test(String((bash.state && bash.state.output) || "")), bash ? { comando: (bash.state && bash.state.input) || null } : null);
  checar("B respondeu SKILL_OK", /^\W*SKILL_OK/.test(texto), texto.slice(0, 200));
  checar("B não editou arquivo", edicoes.length === 0, edicoes.map((p) => p.tool));
  checar("B git status só com o log da base", mudados.length === 1 && mudados[0] === ".aceleriq/uiux-log.jsonl", mudados);
  checar("B o opencode não criou .opencode (nem node_modules) no projeto", opencodeNoProjeto(PROJETO).length === 0, opencodeNoProjeto(PROJETO));
  checar(`B custo real até US$ ${TETO_USD}`, custo <= TETO_USD, custo);
  guardar("b-partes.json", JSON.stringify(partes.map((p) => ({ type: p.type, tool: p.tool, status: p.state && p.state.status, input: p.state && p.state.input, output: p.state && typeof p.state.output === "string" ? p.state.output.slice(0, 1500) : undefined, text: p.text ? String(p.text).slice(0, 500) : undefined })), null, 2));
  const casaDepois = existsSync(PASTA_CASA_DO_OPENCODE) ? readdirSync(PASTA_CASA_DO_OPENCODE) : [];
  return { rodou: true, modelo: modelo.modelo_api, origem_do_modelo: origem, custo_real_usd: custo, custo_tabela_usd: r ? r.custo.custo_usd : null, motivo: r ? r.motivo : null, tokens: r ? r.custo : null, resposta: texto.slice(0, 300), mudados, eventos: eventos.length, pasta_casa: { antes: casaAntes, depois: casaDepois } };
}

/** Regras de UX do tipo "agente" e as do hero, como o painel manda (ids da base 2.15.0). */
const REGRAS_DA_PROVA = [
  ["19", "alta", "Rolagem suave sem travar"],
  ["66", "alta", "Alvo de toque com 44 px"],
  ["69", "alta", "Sem rolagem lateral no celular"],
  ["100", "media", "Contraste do texto sobre a imagem"],
  ["9", "alta", "Movimento reduzido respeitado"],
  ["96", "media", "Vídeo sem som e com controle"],
  ["110", "media", "Texto do hero legível"],
  ["20", "media", "Animação curta"],
].map(([no, severidade, titulo]) => ({ id: `uupm:ux:${no}`, severidade, titulo, modo: "agente" }));

async function etapaC(modelo: ModeloDoMotor, origem: string) {
  const secoes = SECAO.split(",").map((s) => s.trim()).filter(Boolean);
  const e2e = WIN ? "C:\\AI\\motor-codigo\\teste-e2e" : join(process.cwd(), "teste-e2e");
  const pastaProjetos = resolve(arg("projetos", join(e2e, "projetos")));
  const arquivoDoPacote = arg("pacote", join(e2e, "projetos", "aceleriq-site-3d53c55f", ".aceleriq", "pacote.json"));
  if (!existsSync(arquivoDoPacote)) {
    checar(`C sem o pacote de exemplo (${arquivoDoPacote}): etapa C não rodou`, false);
    return { rodou: false };
  }
  const base = JSON.parse(readFileSync(arquivoDoPacote, "utf8")) as Record<string, unknown>;
  const pacote = {
    ...base,
    secoes,
    arquivos: [],
    base_de_design: { versao: "uupm-2.15.0", consulta: "Marketing Agency Dark Mode OLED", estilo: { id: "dark-mode-oled", nome: "Dark Mode (OLED)" }, regras_ux: REGRAS_DA_PROVA },
  };
  const est = estimarTrabalho(modelo, "construir", secoes.length);
  console.log(`[prova] etapa C: ${secoes.join(", ")} com ${modelo.modelo_api} (${origem}); estimativa do painel US$ ${est.estimativa_usd}; parada em US$ ${PARADA_USD}`);
  const { filaLocal } = await import("../lib/fila.ts");
  const { executarTrabalho } = await import("../lib/executar.ts");
  const fila = filaLocal(join(SAIDA, "fila"));
  const siteId = randomUUID();
  const projeto = nomeDoProjeto("uiux prova secao", siteId);
  const t = {
    id: randomUUID(), client_id: "00000000-0000-0000-0000-000000000000", marca_id: null, mesa: "site", projeto, referencia_tipo: "site", referencia_id: siteId, tipo: "construir", estado: "na_fila",
    modelo: modelo.id, instrucao: "Construir o site de uma página", pedido: { secoes, secao: null, modelo, pacote }, teto_usd: PARADA_USD, estimativa_usd: est.estimativa_usd, custo_usd: 0, criado_por: null,
  };
  fila.enfileirar(t as never);
  const pego = await fila.pegar("prova-uiux");
  if (!pego) throw new Error("a fila local não devolveu o trabalho");
  const inicio = Date.now();
  const r = await executarTrabalho(pego, fila, { pastaProjetos, prazoPorPassadaMs: 12 * 60_000, comPrevia: false });
  const final = fila.ler(t.id) as Record<string, unknown>;
  const resultado = (final.resultado || {}) as Record<string, unknown>;
  const tokens = (resultado.tokens || {}) as { entrada?: number; saida?: number; cache?: number };
  const chamadas = Number(resultado.chamadas_ao_modelo) || 0;
  const pasta = join(pastaProjetos, projeto);
  const eventos = fila.eventos(t.id);
  guardar("c-eventos.json", JSON.stringify(eventos, null, 2));
  const log = existsSync(join(pasta, ".aceleriq", "uiux-log.jsonl")) ? readFileSync(join(pasta, ".aceleriq", "uiux-log.jsonl"), "utf8") : "";
  guardar("c-uiux-log.jsonl", log);
  const custo = Number(resultado.custo_real_usd ?? r.custo) || 0;
  // Por seção que passou pelo agente (feita ou desfeita pelo build); sem nenhuma, pelas pedidas.
  const passadas = (Array.isArray(resultado.secoes) ? (resultado.secoes as string[]).length : 0) + (Array.isArray(resultado.secoes_desfeitas) ? (resultado.secoes_desfeitas as unknown[]).length : 0) || secoes.length;
  const porSecao = passadas ? Math.round((Number(tokens.entrada || 0) - TOKENS_DA_BASE.entrada) / passadas) : 0;
  const previsto = TOKENS_POR_SECAO.entrada + TOKENS_DA_SKILL.entrada;
  checar("C a seção foi feita", r.estado === "feito" && Array.isArray(resultado.secoes) && (resultado.secoes as string[]).length === secoes.length, { estado: r.estado, secoes: resultado.secoes, erro: final.erro });
  checar("C o motor gerou o design system antes da passada", !!masterDoProjeto(pasta) && eventos.some((e) => /Design system da base/.test(e.resumo)), masterDoProjeto(pasta));
  checar("C o agente consultou a base", eventos.some((e) => /Consultou a base/.test(e.resumo)), eventos.filter((e) => /base/i.test(e.resumo)).map((e) => e.resumo));
  checar("C o projeto não tem pasta .opencode", opencodeNoProjeto(pasta).length === 0, opencodeNoProjeto(pasta));
  checar(`C tokens de entrada por seção dentro da estimativa (${previsto})`, porSecao > 0 && porSecao <= previsto, { por_secao: porSecao, previsto, tokens });
  checar(`C custo real até US$ ${TETO_USD}`, custo <= TETO_USD, custo);
  return {
    rodou: true,
    modelo: modelo.modelo_api,
    origem_do_modelo: origem,
    projeto: pasta,
    minutos: Math.round((Date.now() - inicio) / 6000) / 10,
    estado: r.estado,
    custo_real_usd: custo,
    custo_tabela_usd: resultado.custo_tabela_usd ?? null,
    estimativa_usd: est.estimativa_usd,
    tokens,
    chamadas_ao_modelo: chamadas,
    tokens_de_entrada_por_secao: porSecao,
    tokens_de_entrada_por_chamada: chamadas ? Math.round(Number(tokens.entrada || 0) / chamadas) : null,
    base_de_design: resultado.base_de_design || null,
    buscas_no_log: log.split("\n").filter(Boolean).length,
  };
}

async function principal() {
  mkdirSync(SAIDA, { recursive: true });
  const python = acharPython(process.env) as string | null;
  if (python) process.env.UIUX_PYTHON = python;
  checar("Python 3.8+ para a busca da base", !!python, python);
  await garantirProjeto(PROJETO);
  const placeholder: ModeloDoMotor = { id: "openrouter:deepseek/deepseek-v4-flash", provedor: "openrouter", modelo_api: "deepseek/deepseek-v4-flash", preco_entrada_1m: 0.0763, preco_saida_1m: 0.1526, preco_cache_1m: 0.01526, contexto_tokens: 1_000_000 };
  const a = await etapaA(placeholder);
  const gasta = COM_GASTO || !!SECAO;
  if (gasta && !temChave("openrouter")) checar("sem OPENROUTER_API_KEY no ambiente: as etapas com gasto não rodaram", false);
  const escolhido = gasta && temChave("openrouter") ? await modeloMaisBarato() : null;
  const b = COM_GASTO && escolhido ? await etapaB(escolhido.modelo, escolhido.origem) : { rodou: false, motivo: "rode com --com-gasto (até US$ 0,20)" };
  const c = SECAO && escolhido ? await etapaC(escolhido.modelo, escolhido.origem) : { rodou: false, motivo: "rode com --secao hero (até US$ 0,20)" };
  const prova = { quando: new Date().toISOString(), pasta: SAIDA, projeto: PROJETO, skills_da_casa: SKILLS_DA_CASA, python, etapa_a: a, etapa_b: b, etapa_c: c, checagens, passou: checagens.every((x) => x.ok) };
  writeFileSync(join(SAIDA, "prova.json"), JSON.stringify(prova, null, 2));
  console.log(`[prova] ${prova.passou ? "PASSOU" : "REPROVADA"}: ${checagens.filter((x) => x.ok).length}/${checagens.length} checagens; prova em ${join(SAIDA, "prova.json")}`);
  if (!prova.passou) process.exitCode = 1;
}

await principal().catch((e) => {
  console.error("[prova] falhou:", e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
