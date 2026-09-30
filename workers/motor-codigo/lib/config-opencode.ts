/**
 * Configuração do opencode para um trabalho (sem o SDK: os testes do painel
 * leem este arquivo sem instalar o worker). Um modelo só, com o preço do
 * catálogo, a chave pela variável de ambiente, permissões fechadas e o
 * ambiente isolado (só as skills da casa e as do tipo, nada da pasta pessoal).
 *
 * Contrato único entre as frentes UIM (ui-ux-pro-max) e SPM (superpowers),
 * fechado na integração de 30/09/2026:
 * - as skills moram no WORKER, nunca dentro do projeto do cliente, e entram
 *   por `skills.paths` (CAMINHOS_DAS_SKILLS). Uma pasta `.opencode` dentro do
 *   projeto faz o opencode instalar pacotes do npm em cada projeto novo;
 * - `permission.skill` = {"*": "deny", ...as do tipo de trabalho (lista do
 *   superpowers), ...SKILLS_DA_CASA} (permitidasDoTrabalho): a ui-ux-pro-max
 *   vale em todo tipo;
 * - `permission.bash` = BASH_LIBERADO, a união dos comandos das duas frentes;
 * - um só ambienteDoOpencode(config, modo, opcoes, base), por lista de
 *   permissão, com XDG_CONFIG_HOME isolado no modo nativo.
 *
 * Superpoderes (frente SPM, 30/09/2026): o Superpowers original
 * (obra/superpowers v6.4.2, MIT, Copyright (c) 2025 Jesse Vincent) fica
 * vendorizado em `vendor/superpowers`, sem edição. Dois modos:
 * - nativo (padrão; o único que sobe no Windows com o opencode 1.18.33):
 *   `skills.paths` aponta para as skills do vendor e `instructions` carrega o
 *   `using-superpowers/SKILL.md` original mais a abertura da casa
 *   (`superpoderes/ABERTURA.md`). É o que o plugin oficial faz, pela
 *   configuração do próprio opencode;
 * - plugin (oficial; Linux, sandbox ou opencode V2): `plugin` com a pasta do
 *   vendor, sem `--pure`. Se não subir em 45 s, o worker volta ao nativo.
 *   As skills da casa (ui-ux-pro-max) continuam entrando por `skills.paths`.
 * Em qualquer modo, `permission.skill` libera só as skills do tipo de
 * trabalho e as da casa (o resto fica negado) e `question` e `task` ficam
 * negados: a sessão não tem tela para responder pergunta e não há subagente.
 *
 * Segurança (revisão da SPM, 30/09): o agente roda código do projeto pelo
 * bash (npm run checar, o conferir da seção) e o build do motor roda as
 * seções que ele escreveu. Por isso:
 * - o ambiente do opencode e de todo comando do site sai de uma LISTA DE
 *   PERMISSÃO (`ambienteSemSegredos`): SUPABASE_*, VERCEL_*, MOTOR_* e as
 *   outras chaves nunca entram; a chave do provedor entra só no opencode;
 * - a edição é negada na casca da casa e no que roda na máquina
 *   (package.json, vite.config, scripts/, .git/, .opencode/);
 * - no modo nativo, a pasta global do opencode (XDG_CONFIG_HOME) é uma pasta
 *   vazia do trabalho: o AGENTS.md e as skills pessoais de ~/.config/opencode
 *   não entram. O modo plugin não sobe com essa pasta isolada (medido: o
 *   plugin oficial trava com as pastas do opencode vazias), então ele não
 *   isola a pasta global: só para máquina sem configuração pessoal (sandbox).
 */
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { modeloParaOpencode, type ModeloDoMotor } from "../../../supabase/functions/_shared/motor-codigo.ts";

/** Variável de ambiente da chave de cada provedor (só no worker). */
export const CHAVE_DO_PROVEDOR: Record<string, string> = { openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export function temChave(provedor: string): boolean {
  const v = process.env[CHAVE_DO_PROVEDOR[provedor] || ""];
  return typeof v === "string" && v.trim().length > 10;
}

// ------------------------------------------------------------------ skills

/** Pasta do worker (workers/motor-codigo). */
export const PASTA_DO_WORKER = resolve(import.meta.dirname, "..");

/**
 * A skill UI UX Pro Max fixada (scripts/instalar-ui-ux-pro-max.mjs, versão
 * 2.15.0 com manifesto SHA-256). Fica no worker: o projeto do cliente não
 * recebe cópia (nada de 3,3 MB por projeto nem de .opencode instalando npm).
 */
export const SKILL_DA_UIUX = resolve(PASTA_DO_WORKER, "vendor", "ui-ux-pro-max");
/** O buscador da skill. O embrulho do projeto (node scripts/uiux.mjs) acha por UIUX_BUSCADOR. */
export const BUSCADOR_DA_UIUX = resolve(SKILL_DA_UIUX, "scripts", "search.py");

/** Skills da casa: valem em TODO trabalho do agente, qualquer que seja o tipo. */
export const SKILLS_DA_CASA: readonly string[] = ["ui-ux-pro-max"];

/** A cópia fixada do Superpowers (tag e sha256 em superpoderes/versao.json). Nunca editar por dentro. */
export const VENDOR_DO_SUPERPOWERS = resolve(PASTA_DO_WORKER, "vendor", "superpowers");
export const SKILLS_DO_VENDOR = resolve(VENDOR_DO_SUPERPOWERS, "skills");
/** A abertura original (a regra dos 1%): o que o plugin oficial injeta no sistema. */
export const BOOTSTRAP_DO_VENDOR = resolve(SKILLS_DO_VENDOR, "using-superpowers", "SKILL.md");
/** Texto nosso: mapa de ferramentas deste motor e "o AGENTS.md vence". */
export const ABERTURA_DA_CASA = resolve(PASTA_DO_WORKER, "superpoderes", "ABERTURA.md");
export const VERSAO_DO_SUPERPOWERS = { tag: "v6.4.2", commit: "8ca22dba9a94f28898bbce59f2537ff4d87c747d" } as const;

/**
 * Pastas de skills que o opencode lê no modo nativo (`skills.paths`; ele
 * acha cada SKILL.md dentro delas): a da casa (ui-ux-pro-max) e as do
 * superpowers vendorizado. No modo plugin, as do superpowers vêm pelo plugin
 * oficial e só as da casa entram por aqui (CAMINHOS_DAS_SKILLS_DA_CASA).
 */
export const CAMINHOS_DAS_SKILLS_DA_CASA: readonly string[] = [SKILL_DA_UIUX];
export const CAMINHOS_DAS_SKILLS: readonly string[] = [SKILL_DA_UIUX, SKILLS_DO_VENDOR];

/** As 15 skills da v6.4.2 (a instalação é completa; a permissão decide o que vale). */
export const SKILLS_DO_SUPERPOWERS = [
  "brainstorming",
  "diagnosing-superpowers",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
] as const;
export type SkillDoSuperpowers = (typeof SKILLS_DO_SUPERPOWERS)[number];

/**
 * Skills do superpowers liberadas por tipo de trabalho, além das da casa. Só
 * construir e ajustar passam pelo modelo (TIPOS_QUE_GASTAM); revisar,
 * desfazer, publicar e zip são máquina (o revisar roda o build e as regras
 * fixas de revisarHtml), então não liberam nada do superpowers. O desenho do
 * site já vem aprovado no pacote: brainstorming e executing-plans ficam de
 * fora do construir (cada skill carregada volta ao contexto de todas as
 * chamadas da seção; a brainstorming tem 17,5 mil caracteres).
 */
export const SKILLS_POR_TRABALHO: Record<string, SkillDoSuperpowers[]> = {
  construir: ["using-superpowers", "writing-plans", "test-driven-development", "systematic-debugging", "verification-before-completion"],
  ajustar: ["using-superpowers", "receiving-code-review", "systematic-debugging", "test-driven-development", "verification-before-completion"],
  revisar: [],
  desfazer: [],
  publicar: [],
  zip: [],
};

/** Sempre negadas no motor, com o porquê (a tela das Configurações e o AGENTS.md repetem). */
export const SKILLS_NEGADAS_NO_MOTOR: Record<string, string> = {
  brainstorming: "o desenho do site já foi aprovado na Mesa Site (pacote.json); cada passada é uma seção, sem perguntas",
  "executing-plans": "o plano da seção é curto e sai na mesma passada (writing-plans basta)",
  "requesting-code-review": "o revisar não passa pelo modelo: o motor roda o build e as regras fixas de revisão",
  "using-git-worktrees": "o motor já isola uma pasta e um git por site",
  "finishing-a-development-branch": "quem integra e publica é o painel, com Confirmar",
  "subagent-driven-development": "sem subagente (task negado): uma seção por passada, custo previsível",
  "dispatching-parallel-agents": "sem subagente (task negado): uma seção por passada, custo previsível",
  "writing-skills": "não é trabalho de site",
  "diagnosing-superpowers": "não é trabalho de site",
};

export type Acao = "allow" | "deny" | "ask";
export type Regras = Acao | Record<string, Acao>;

/**
 * Regras com "*": "deny" em PRIMEIRO lugar. No opencode a ÚLTIMA regra que
 * casa vence; com o "*" no fim, ele vence tudo e a ferramenta inteira some
 * (foi o que desligou o bash do motor até a frente UIM).
 */
export function negarPrimeiro(liberados: readonly string[]): Record<string, Acao> {
  const r: Record<string, Acao> = { "*": "deny" };
  for (const c of liberados) if (c && c !== "*") r[c] = "allow";
  return r;
}

/**
 * `permission.skill` do tipo: "*" negado PRIMEIRO (a última regra que casa
 * vence), as do tipo (SKILLS_POR_TRABALHO), as da casa (SKILLS_DA_CASA, em
 * todo tipo) e `extras` liberadas depois. Sem tipo, vale o construir.
 */
export function permitidasDoTrabalho(tipo?: string | null, extras: readonly string[] = [], porTrabalho: Record<string, readonly string[]> = SKILLS_POR_TRABALHO): Record<string, Acao> {
  const doTipo = porTrabalho[tipo || "construir"] || [];
  return negarPrimeiro(doTipo.concat(SKILLS_DA_CASA, extras));
}

/** nativo: skills por `skills.paths` e `--pure` (o padrão); plugin: o plugin oficial do superpowers. */
export type ModoDoOpencode = "nativo" | "plugin";
export type ModoDoSuperpowers = ModoDoOpencode;

/** SUPERPOWERS_MODO=nativo|plugin (padrão nativo). */
export function modoDoSuperpowers(v: string | undefined = process.env.SUPERPOWERS_MODO): ModoDoSuperpowers {
  return String(v || "").trim().toLowerCase() === "plugin" ? "plugin" : "nativo";
}

// ------------------------------------------------------------------ bash

/**
 * Comandos que o agente pode rodar no projeto (a união das frentes SIT, SPM e
 * UIM); todo o resto é negado. O buscador da base só pelo embrulho da casa.
 */
export const COMANDOS_LIBERADOS: readonly string[] = ["npm run checar", "npm run checar *", "npm run build", "npm run build *", "node scripts/conferir.mjs*", "git status*", "git diff*", "ls*", "dir*", "node scripts/uiux.mjs *", "mkdir -p .aceleriq/ux", "mkdir .aceleriq/ux"];
/**
 * Negados mesmo dentro de um comando liberado (vêm DEPOIS, para vencer): o
 * bash do agente é o do Git, e `dir x 2>nul` (hábito do cmd) cria um arquivo
 * "nul" que quebra o commit. Achado na prova da seção inteira (30/09).
 */
export const COMANDOS_NEGADOS: readonly string[] = ["*>nul*", "*> nul*", "*>NUL*", "*> NUL*"];
/** `permission.bash`: "*" negado primeiro, os comandos liberados e, por último, os negados. */
export const BASH_LIBERADO: Record<string, Acao> = (() => {
  const r = negarPrimeiro(COMANDOS_LIBERADOS);
  for (const c of COMANDOS_NEGADOS) r[c] = "deny";
  return r;
})();

/** O casamento de padrão do opencode 1.18 (Wildcard.match): "*" é qualquer coisa, "?" um caractere, "cmd *" casa "cmd" sozinho. */
export function casaCuringa(texto: string, padrao: string): boolean {
  const t = String(texto).split("\\").join("/");
  let re = String(padrao).split("\\").join("/").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  if (re.slice(-3) === " .*") re = `${re.slice(0, -3)}( .*)?`;
  return new RegExp(`^${re}$`, "si").test(t);
}

const emLista = (regras: Regras): Array<{ padrao: string; acao: Acao }> => (typeof regras === "string" ? [{ padrao: "*", acao: regras }] : Object.keys(regras).map((padrao) => ({ padrao, acao: regras[padrao] })));

/** O que o opencode decide para um pedido (comando do bash, nome da skill): a última regra que casa; sem regra, pergunta. */
export function acaoDoPedido(regras: Regras, pedido: string): Acao {
  const lista = emLista(regras);
  for (let i = lista.length - 1; i >= 0; i--) if (casaCuringa(pedido, lista[i].padrao)) return lista[i].acao;
  return "ask";
}

/**
 * A ferramenta fica ligada? O opencode tira a ferramenta inteira quando a
 * última regra dela é "*": "deny" (Permission.disabled). É a conta que o
 * teste antigo não fazia.
 */
export function ferramentaLigada(regras: Regras | undefined): boolean {
  if (regras === undefined) return true;
  const lista = emLista(regras);
  const ultima = lista[lista.length - 1];
  return !(ultima && ultima.padrao === "*" && ultima.acao === "deny");
}

// ------------------------------------------------------------------ edição e pastas de fora

/** A pasta do modelo de site (a casca da casa sai daqui). */
export const MODELO_DO_SITE_NA_CONFIG = resolve(PASTA_DO_WORKER, "modelo-site");

/** Os arquivos da casca da casa (modelo-site/.aceleriq/casca.json). */
export function arquivosDaCasca(modelo: string = MODELO_DO_SITE_NA_CONFIG): string[] {
  try {
    const c = JSON.parse(readFileSync(join(modelo, ".aceleriq", "casca.json"), "utf8")) as { arquivos?: unknown };
    return Array.isArray(c.arquivos) ? c.arquivos.filter((a): a is string => typeof a === "string" && !!a && a.indexOf("..") < 0) : [];
  } catch {
    return [];
  }
}

/**
 * O que o agente não edita (edit, write e apply_patch pedem a mesma
 * permissão "edit", com o caminho relativo ao projeto): o que roda na máquina
 * quando ele chama `npm run checar` ou quando o motor constrói (package.json,
 * vite.config, scripts/), a configuração do git e do opencode (hooks,
 * fsmonitor, plugins, ferramentas), o pacote, a marca gerada e a logo real.
 */
export const EDICAO_NEGADA_FIXA = [
  ".git/*",
  ".opencode/*",
  "opencode.json",
  "opencode.jsonc",
  ".aceleriq/*",
  "node_modules/*",
  "package.json",
  "package-lock.json",
  "vite.config.*",
  "scripts/*",
  "src/marca.css",
  "public/marca/*",
];

/**
 * O que o agente escreve mesmo dentro de uma pasta negada (vem DEPOIS, para
 * vencer): a prova de UX da seção (.aceleriq/ux/<seção>.json, frente UIM),
 * que o motor lê depois da passada (lib/prova-da-base.ts).
 */
export const EDICAO_LIBERADA_NA_NEGADA = [".aceleriq/ux/*"];

/** `permission.edit`: "*" liberado primeiro, as negadas depois (a última regra que casa vence), com a casca inteira, e a prova de UX por último. */
export function permissaoDeEdicao(casca: string[] = arquivosDaCasca()): Record<string, "allow" | "deny"> {
  const regra: Record<string, "allow" | "deny"> = { "*": "allow" };
  for (const p of EDICAO_NEGADA_FIXA.concat(casca)) regra[p] = "deny";
  for (const p of EDICAO_LIBERADA_NA_NEGADA) regra[p] = "allow";
  return regra;
}

/** Caminho real (o opencode compara com o caminho real do arquivo pedido). */
function caminhoReal(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

/**
 * `permission.external_directory`: "*" negado primeiro e a pasta das skills
 * do vendor liberada depois. O "deny" puro apagava a liberação padrão das
 * pastas de skill, e a TDD e a systematic-debugging não liam os anexos que
 * elas mesmas mandam ler (writing-good-tests.md, root-cause-tracing.md).
 * A ui-ux-pro-max não precisa: o agente só a usa pelo embrulho
 * `node scripts/uiux.mjs` (o buscador vem por UIUX_BUSCADOR).
 */
export function pastasDeForaLiberadas(): Record<string, "allow" | "deny"> {
  return { "*": "deny", [join(caminhoReal(SKILLS_DO_VENDOR), "*")]: "allow" };
}

// ------------------------------------------------------------------ configuração

export type OpcoesDaConfig = { tipo?: string | null; modo?: ModoDoOpencode; skillsExtras?: readonly string[] };

/** Configuração do opencode para um trabalho: um modelo, com preço, permissões fechadas, as skills da casa e os superpoderes do tipo. */
export function configDoOpencode(m: ModeloDoMotor, medidorUrl?: string | null, opcoes: OpcoesDaConfig = {}) {
  const o = modeloParaOpencode(m);
  const cost: Record<string, number> = { input: o.entrada1m, output: o.saida1m };
  if (o.cache1m !== null) cost.cache_read = o.cache1m;
  const modo = opcoes.modo || "nativo";
  const superpoderes =
    modo === "plugin"
      ? // O plugin oficial registra as skills do superpowers e injeta a abertura; a nossa entra por instructions.
        { skills: { paths: CAMINHOS_DAS_SKILLS_DA_CASA.slice() }, plugin: [VENDOR_DO_SUPERPOWERS], instructions: [ABERTURA_DA_CASA] }
      : { skills: { paths: CAMINHOS_DAS_SKILLS.slice() }, instructions: [BOOTSTRAP_DO_VENDOR, ABERTURA_DA_CASA] };
  return {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    share: "disabled",
    snapshot: false,
    model: `${o.providerID}/${o.modelID}`,
    small_model: `${o.providerID}/${o.modelID}`,
    enabled_providers: [o.providerID],
    provider: {
      [o.providerID]: {
        options: { apiKey: `{env:${CHAVE_DO_PROVEDOR[o.providerID]}}`, ...(medidorUrl && o.providerID === "openrouter" ? { baseURL: medidorUrl } : {}) },
        models: { [o.modelID]: { name: o.modelID, tool_call: true, cost, limit: { context: Math.max(64_000, Number(m.contexto_tokens) || 200_000), output: 32_000 } } },
      },
    },
    // As skills ficam no worker (fora do projeto do cliente).
    ...superpoderes,
    // O agente escreve no projeto (menos a casca e o que roda na máquina) e roda só os comandos da lista;
    // nada de internet nem de pasta de fora (menos os anexos das skills do vendor).
    // "*": "deny" vem PRIMEIRO no bash e na skill (a última regra que casa vence): assim as ferramentas
    // ficam ligadas só para o que está liberado. A embutida customize-opencode fica negada.
    permission: {
      edit: permissaoDeEdicao(),
      webfetch: "deny" as Acao,
      external_directory: pastasDeForaLiberadas(),
      doom_loop: "deny" as Acao,
      // Sessão sem tela: uma pergunta travaria a passada até o prazo. A dúvida vira "PRECISA DE RESPOSTA:".
      question: "deny" as Acao,
      // Sem subagente: uma seção por passada, custo previsível.
      task: "deny" as Acao,
      skill: permitidasDoTrabalho(opcoes.tipo, opcoes.skillsExtras || []),
      bash: { ...BASH_LIBERADO },
    },
    watcher: { ignore: ["node_modules/**", "dist/**", "dist-ssr/**", ".git/**", ".opencode/**", "design-system/**", ".metodo/**"] },
  };
}

// ------------------------------------------------------------------ ambiente sem segredos

/** Pasta de configuração global do opencode que é SÓ do worker (vazia de skills): a padrão quando a subida não traz a própria. */
export const PASTA_CASA_DO_OPENCODE = resolve(PASTA_DO_WORKER, ".opencode-casa");

/**
 * Variáveis que isolam o agente do site do que é pessoal desta máquina: sem
 * elas, o opencode lê as skills de ~/.claude/skills e ~/.agents/skills e o
 * ~/.claude/CLAUDE.md do dono, e tudo isso entra no pedido de cada passada.
 * A pasta global do opencode (~/.config/opencode, com AGENTS.md e skills
 * próprias) fica de fora pelo XDG_CONFIG_HOME isolado do modo nativo.
 */
export const AMBIENTE_ISOLADO: Record<string, string> = {
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  SUPERPOWERS_DISABLE_TELEMETRY: "1",
};

/**
 * Variáveis que passam para o opencode e para os comandos do site (LISTA DE
 * PERMISSÃO; o resto fica de fora): o que o Windows, o Node, o npm e o git
 * precisam para rodar. SUPABASE_*, VERCEL_*, MOTOR_*, as chaves dos
 * provedores e qualquer outra variável do worker não entram. Do opencode, só
 * os desligamentos (OPENCODE_DISABLE_*) e o caminho do Git Bash: nada de
 * OPENCODE_CONFIG, OPENCODE_CONFIG_DIR ou OPENCODE_PERMISSION de fora.
 */
export const VARIAVEIS_DO_AMBIENTE = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "USERNAME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TERM",
  "TZ",
  "NO_COLOR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "OPENCODE_GIT_BASH_PATH",
];

/**
 * Prefixos que passam: locale, pastas XDG, os desligamentos do opencode, as
 * do Superpowers e as da base de design (UIUX_PYTHON, que o worker acha na
 * partida, e UIUX_BUSCADOR, que o `node scripts/uiux.mjs` do agente usa).
 */
export const PREFIXOS_DO_AMBIENTE = ["LC_", "XDG_", "OPENCODE_DISABLE_", "SUPERPOWERS_", "UIUX_"];

/** Ambiente sem segredos: só as variáveis da lista de permissão, mais `extra` (que vence). */
export function ambienteSemSegredos(base: Record<string, string | undefined> = process.env, extra: Record<string, string> = {}): Record<string, string> {
  const permitidas = new Set(VARIAVEIS_DO_AMBIENTE);
  const saida: Record<string, string> = {};
  for (const k of Object.keys(base)) {
    const v = base[k];
    if (typeof v !== "string") continue;
    const K = k.toUpperCase();
    if (permitidas.has(K) || PREFIXOS_DO_AMBIENTE.some((p) => K.indexOf(p) === 0)) saida[k] = v;
  }
  // A mesma variável com outra caixa (o Windows não diferencia): fica só a de `extra`.
  for (const k of Object.keys(extra)) {
    for (const j of Object.keys(saida)) if (j !== k && j.toUpperCase() === k.toUpperCase()) delete saida[j];
    saida[k] = extra[k];
  }
  return saida;
}

/** O provedor da configuração (o primeiro de enabled_providers), quando a chamada não diz. */
function provedorDaConfig(config: unknown): string | null {
  const p = config && typeof config === "object" ? (config as { enabled_providers?: unknown }).enabled_providers : null;
  return Array.isArray(p) && typeof p[0] === "string" ? p[0] : null;
}

/**
 * Ambiente do `opencode serve` (o único, para as frentes UIM e SPM), montado
 * por LISTA DE PERMISSÃO (nunca o ambiente inteiro do worker):
 *  - o sistema e só a chave do provedor do trabalho (`opcoes.provedor`, ou o
 *    da configuração);
 *  - AMBIENTE_ISOLADO: sem ~/.claude/skills, ~/.agents/skills e CLAUDE.md;
 *  - nativo: XDG_CONFIG_HOME = `opcoes.pastaDeConfig` (a subida do worker cria
 *    uma pasta vazia por subida) ou, sem ela, a pasta casa do worker. O
 *    AGENTS.md e as skills de ~/.config/opencode não entram;
 *  - plugin: OPENCODE_DISABLE_DEFAULT_PLUGINS e sem a pasta isolada (o plugin
 *    oficial trava com as pastas do opencode vazias);
 *  - UIUX_BUSCADOR: onde o embrulho do projeto acha o buscador da skill.
 * A chave vai só no ambiente; a configuração a lê por {env:...}.
 */
export function ambienteDoOpencode(
  config: unknown,
  modo: ModoDoOpencode = "nativo",
  opcoes: { provedor?: string | null; pastaDeConfig?: string | null } = {},
  base: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const provedor = opcoes.provedor || provedorDaConfig(config);
  const chave = provedor ? CHAVE_DO_PROVEDOR[provedor] : "";
  const valorDaChave = chave ? base[chave] : undefined;
  return ambienteSemSegredos(base, {
    ...(chave && typeof valorDaChave === "string" ? { [chave]: valorDaChave } : {}),
    ...AMBIENTE_ISOLADO,
    ...(modo === "plugin" ? { OPENCODE_DISABLE_DEFAULT_PLUGINS: "1" } : { XDG_CONFIG_HOME: opcoes.pastaDeConfig || PASTA_CASA_DO_OPENCODE }),
    UIUX_BUSCADOR: BUSCADOR_DA_UIUX,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    NO_COLOR: "1",
  });
}
