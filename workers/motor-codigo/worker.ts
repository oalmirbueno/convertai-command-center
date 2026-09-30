/**
 * Worker do motor de código (frente SIT, 30/09/2026). PILOTO na máquina da
 * agência: puxa a fila motor_trabalhos, roda o opencode com o modelo
 * escolhido, abre a prévia (Vite + cloudflared), faz commit por passo, guarda
 * o zip no Storage e registra o custo real na carteira.
 *
 * Como ligar (Node 24; nada roda no painel):
 *   cd workers/motor-codigo
 *   npm install
 *   copie as variáveis abaixo para um arquivo .env nesta pasta (fica fora do git)
 *   npm run iniciar            (fica rodando; Ctrl+C para)
 *   npm run uma-vez            (pega um trabalho, faz e sai)
 *
 * Variáveis (.env ou ambiente do Windows; nunca no código nem no commit):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   a fila e o Storage (service_role)
 *   OPENROUTER_API_KEY                        modelos pelo OpenRouter (opcional: ANTHROPIC_API_KEY, OPENAI_API_KEY)
 *   MOTOR_PASTA          onde ficam os projetos (padrão C:\AI\motor-codigo\projetos)
 *   UIUX_PYTHON          Python 3.8+ da busca da base de design (opcional: o worker acha sozinho;
 *                        a skill ui-ux-pro-max fica em vendor/ui-ux-pro-max, fora dos projetos)
 *   MOTOR_EXECUTOR       nome deste worker (padrão o nome da máquina)
 *   MOTOR_TUNEL=nao      desliga o túnel (a prévia fica só nesta máquina)
 *   MOTOR_PREVIA_MINUTOS prévia parada desliga depois disso (padrão 60)
 *   MOTOR_PRAZO_MIN      prazo de cada passada do agente (padrão 15)
 *   VERCEL_TOKEN, VERCEL_TEAM_ID   publicação (desligada sem elas)
 */
import { hostname } from "node:os";
import { join } from "node:path";
import { filaSupabase, type Fila } from "./lib/fila.ts";
import { executarTrabalho } from "./lib/executar.ts";
import { acharPython } from "./modelo-site/scripts/uiux.mjs";
import { desligarTodas, limparPrevias, temCloudflared } from "./lib/previa.ts";
import { temChave } from "./lib/opencode.ts";
import { esperar } from "./lib/processos.ts";

const VERSAO = "motor-codigo 0.1.0 (opencode 1.18.33)";

export function configDoAmbiente() {
  return {
    pastaProjetos: process.env.MOTOR_PASTA || (process.platform === "win32" ? "C:\\AI\\motor-codigo\\projetos" : join(process.cwd(), "projetos")),
    prazoPorPassadaMs: Math.max(2, Number(process.env.MOTOR_PRAZO_MIN || 15)) * 60_000,
    comPrevia: process.env.MOTOR_PREVIA !== "nao",
    executor: (process.env.MOTOR_EXECUTOR || `agencia-${hostname()}`).slice(0, 80),
  };
}

/**
 * Python da busca da base de design (skill ui-ux-pro-max): acha uma vez na
 * partida e deixa em UIUX_PYTHON, que o opencode e o `node scripts/uiux.mjs`
 * herdam. Sem Python, avisa uma vez e o motor segue só com o pacote.
 * Depois de um git pull com mudança no worker, reinicie (Ctrl+C e npm run iniciar).
 */
export function prepararPythonDaBase(): string | null {
  const python = acharPython(process.env) as string | null;
  if (python) process.env.UIUX_PYTHON = python;
  else {
    delete process.env.UIUX_PYTHON;
    console.warn("[motor] sem Python 3.8+ nesta máquina: a busca da base de design (ui-ux-pro-max 2.15.0) fica desligada e o agente segue só com o pacote.");
  }
  return python;
}

async function capacidades(python: string | null = null) {
  return {
    uiux: !!python,
    tunel: await temCloudflared(),
    openrouter: temChave("openrouter"),
    anthropic: temChave("anthropic"),
    openai: temChave("openai"),
    vercel: !!(process.env.VERCEL_TOKEN || "").trim(),
  };
}

export async function laco(fila: Fila, opcoes: { umaVez?: boolean } = {}) {
  const cfg = configDoAmbiente();
  const python = prepararPythonDaBase();
  const caps = await capacidades(python);
  console.log(`[motor] ${VERSAO} · executor ${cfg.executor} · fila ${fila.nome} · projetos em ${cfg.pastaProjetos} · túnel ${caps.tunel ? "sim" : "não"} · base de design ${python ? "com Python" : "sem Python"}`);
  let parar = false;
  process.on("SIGINT", () => {
    parar = true;
    desligarTodas();
    process.exit(0);
  });
  let ultimaBatida = 0;
  while (!parar) {
    if (Date.now() - ultimaBatida > 30_000) {
      await fila.batida(cfg.executor, { versao: VERSAO, capacidades: caps, trabalho_id: null });
      ultimaBatida = Date.now();
    }
    limparPrevias();
    let t = null;
    try {
      t = await fila.pegar(cfg.executor);
    } catch (e) {
      console.error("[motor] fila indisponível:", e instanceof Error ? e.message : e);
    }
    if (!t) {
      if (opcoes.umaVez) break;
      await esperar(3000);
      continue;
    }
    console.log(`[motor] trabalho ${t.id} (${t.tipo}) do projeto ${t.projeto}`);
    await fila.batida(cfg.executor, { versao: VERSAO, capacidades: caps, trabalho_id: t.id });
    const batendo = setInterval(() => void fila.batida(cfg.executor, { versao: VERSAO, capacidades: caps, trabalho_id: t!.id }), 30_000);
    try {
      const r = await executarTrabalho(t, fila, cfg);
      console.log(`[motor] ${t.id}: ${r.estado}, US$ ${r.custo.toFixed(4)}`);
    } finally {
      clearInterval(batendo);
      ultimaBatida = 0;
    }
    if (opcoes.umaVez) break;
  }
}

// Rodando direto (npm run iniciar / uma-vez).
if (process.argv[1] && /worker\.ts$/.test(process.argv[1])) {
  const url = process.env.SUPABASE_URL || "";
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !chave) {
    console.error("[motor] faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (arquivo .env desta pasta).");
    process.exit(1);
  }
  const fila = await filaSupabase(url, chave);
  await laco(fila, { umaVez: process.argv.indexOf("--uma-vez") >= 0 });
  desligarTodas();
}
