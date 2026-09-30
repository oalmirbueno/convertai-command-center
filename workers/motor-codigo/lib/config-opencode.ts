/**
 * Configuração do opencode para um trabalho (sem o SDK: os testes do painel
 * leem este arquivo sem instalar o worker). Um modelo só, com o preço do
 * catálogo, a chave pela variável de ambiente, permissões fechadas e o
 * ambiente isolado (só as skills da casa, nada da pasta pessoal).
 *
 * Contrato único com a frente superpowers (SPM), fechado na correção da UIM
 * de 30/09/2026:
 * - as skills moram no WORKER, nunca dentro do projeto do cliente, e entram
 *   por `skills.paths` (CAMINHOS_DAS_SKILLS). Uma pasta `.opencode` dentro do
 *   projeto faz o opencode instalar pacotes do npm em cada projeto novo;
 * - `permission.skill` = {"*": "deny", ...as do tipo de trabalho,
 *   ...SKILLS_DA_CASA} (permitidasDoTrabalho): a ui-ux-pro-max vale em todo
 *   tipo, e a frente superpowers liga a lista dela em SKILLS_POR_TRABALHO;
 * - `permission.bash` = BASH_LIBERADO, a união dos comandos das duas frentes;
 * - um só ambienteDoOpencode(config, modo), com XDG_CONFIG_HOME do worker.
 */
import { resolve } from "node:path";
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

/**
 * Pastas de skills que o opencode lê (`skills.paths`; ele acha cada SKILL.md
 * dentro delas). A frente superpowers acrescenta a dela (vendor/superpowers/skills).
 */
export const CAMINHOS_DAS_SKILLS: readonly string[] = [SKILL_DA_UIUX];

/**
 * Skills a mais por tipo de trabalho, além das da casa. Vazio até a frente
 * superpowers entrar no main: ela liga aqui a lista por tipo dela.
 */
export const SKILLS_POR_TRABALHO: Record<string, readonly string[]> = {};

export type Acao = "allow" | "deny" | "ask";
export type Regras = Acao | Record<string, Acao>;

/**
 * Regras com "*": "deny" em PRIMEIRO lugar. No opencode a ÚLTIMA regra que
 * casa vence; com o "*" no fim, ele vence tudo e a ferramenta inteira some
 * (foi o que desligou o bash do motor até a frente UIM).
 */
export function negarPrimeiro(liberados: readonly string[]): Record<string, Acao> {
  const r: Record<string, Acao> = { "*": "deny" };
  for (const c of liberados) if (c !== "*") r[c] = "allow";
  return r;
}

/** `permission.skill` do tipo: "*" negado primeiro, as do tipo e as da casa liberadas. */
export function permitidasDoTrabalho(tipo?: string | null, porTrabalho: Record<string, readonly string[]> = SKILLS_POR_TRABALHO): Record<string, Acao> {
  const doTipo = porTrabalho[tipo || "construir"] || [];
  return negarPrimeiro(doTipo.concat(SKILLS_DA_CASA));
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

// ------------------------------------------------------------------ configuração

/** nativo: skills por `skills.paths` e `--pure` (o padrão); plugin: a frente superpowers sobe o plugin oficial. */
export type ModoDoOpencode = "nativo" | "plugin";

export type OpcoesDaConfig = { tipo?: string | null; modo?: ModoDoOpencode };

/** Configuração do opencode para um trabalho: um modelo, com preço, permissões fechadas e as skills do tipo. */
export function configDoOpencode(m: ModeloDoMotor, medidorUrl?: string | null, opcoes: OpcoesDaConfig = {}) {
  const o = modeloParaOpencode(m);
  const cost: Record<string, number> = { input: o.entrada1m, output: o.saida1m };
  if (o.cache1m !== null) cost.cache_read = o.cache1m;
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
    // As skills da casa ficam no worker (fora do projeto do cliente).
    skills: { paths: CAMINHOS_DAS_SKILLS.slice() },
    // O agente escreve no projeto e roda só os scripts do projeto; nada de internet nem de pasta de fora.
    // "*": "deny" vem PRIMEIRO (a última regra que casa vence): assim o bash e a skill ficam ligados
    // só para o que está liberado. A embutida customize-opencode fica negada.
    permission: {
      edit: "allow" as Acao,
      webfetch: "deny" as Acao,
      external_directory: "deny" as Acao,
      doom_loop: "deny" as Acao,
      // Sessão sem tela: uma pergunta travaria a passada até o prazo. A dúvida vai na resposta.
      question: "deny" as Acao,
      // Sem subagente: uma seção por passada, custo previsível.
      task: "deny" as Acao,
      skill: permitidasDoTrabalho(opcoes.tipo),
      bash: { ...BASH_LIBERADO },
    },
    watcher: { ignore: ["node_modules/**", "dist/**", "dist-ssr/**", ".git/**", ".opencode/**", "design-system/**"] },
  };
}

// ------------------------------------------------------------------ ambiente

/** Pasta de configuração global do opencode que é SÓ do worker (vazia de skills). */
export const PASTA_CASA_DO_OPENCODE = resolve(PASTA_DO_WORKER, ".opencode-casa");

/** Variáveis OPENCODE_* que podem vir do ambiente da máquina; as outras (OPENCODE_CONFIG, _DIR, _PERMISSION...) nunca passam. */
const OPENCODE_HERDAVEIS = ["OPENCODE_GIT_BASH_PATH"];

/**
 * O que isola o agente do site do que é pessoal desta máquina: sem isso, o
 * opencode lê as skills de ~/.claude/skills e ~/.agents/skills e o
 * ~/.claude/CLAUDE.md do dono, e tudo entra no pedido de cada passada.
 */
export const AMBIENTE_ISOLADO: Record<string, string> = {
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
};

/**
 * Ambiente do `opencode serve` (o único; a frente superpowers usa este): o da
 * máquina menos qualquer OPENCODE_* herdado (configuração, permissão e pasta
 * extra de fora), mais o isolamento provado na frente UIM:
 *  - AMBIENTE_ISOLADO: sem ~/.claude/skills, ~/.agents/skills e CLAUDE.md;
 *  - XDG_CONFIG_HOME próprio: a pasta global do opencode (~/.config/opencode, com
 *    skills e AGENTS.md pessoais) passa a ser a do worker, vazia;
 *  - no modo plugin, OPENCODE_DISABLE_DEFAULT_PLUGINS (só o plugin da casa sobe);
 *  - UIUX_BUSCADOR: onde o embrulho do projeto acha o buscador da skill.
 * A chave do provedor continua só pelo {env:...} da configuração.
 */
export function ambienteDoOpencode(config: unknown, modo: ModoDoOpencode = "nativo", base: Record<string, string | undefined> = process.env, pastaCasa: string = PASTA_CASA_DO_OPENCODE): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of Object.keys(base)) {
    const v = base[k];
    if (typeof v !== "string") continue;
    if (/^OPENCODE_/i.test(k) && OPENCODE_HERDAVEIS.indexOf(k.toUpperCase()) < 0) continue;
    if (/^XDG_CONFIG_HOME$/i.test(k)) continue;
    env[k] = v;
  }
  for (const k of Object.keys(AMBIENTE_ISOLADO)) env[k] = AMBIENTE_ISOLADO[k];
  if (modo === "plugin") env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1";
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  env.XDG_CONFIG_HOME = pastaCasa;
  env.UIUX_BUSCADOR = BUSCADOR_DA_UIUX;
  env.NO_COLOR = "1";
  return env;
}
