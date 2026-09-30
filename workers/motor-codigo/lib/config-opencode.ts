/**
 * Configuração do opencode para um trabalho (sem o SDK: os testes do painel
 * leem este arquivo sem instalar o worker). Um modelo só, com o preço do
 * catálogo, a chave pela variável de ambiente, permissões fechadas e o
 * ambiente isolado (só as skills da casa, nada da pasta pessoal).
 */
import { resolve } from "node:path";
import { modeloParaOpencode, type ModeloDoMotor } from "../../../supabase/functions/_shared/motor-codigo.ts";

/** Variável de ambiente da chave de cada provedor (só no worker). */
export const CHAVE_DO_PROVEDOR: Record<string, string> = { openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export function temChave(provedor: string): boolean {
  const v = process.env[CHAVE_DO_PROVEDOR[provedor] || ""];
  return typeof v === "string" && v.trim().length > 10;
}

/**
 * Skills da casa: as únicas que o agente do site do cliente vê e carrega.
 * Lista ÚNICA, compartilhada com a frente superpowers (ela acrescenta as
 * dela aqui). Toda pasta de modelo-site/.opencode/skills precisa estar nesta
 * lista, e nenhum nome se repete (o teste uim-skills-do-motor confere).
 */
export const SKILLS_DA_CASA: readonly string[] = ["ui-ux-pro-max"];

/** Comandos que o agente pode rodar no projeto; todo o resto é negado. */
export const COMANDOS_LIBERADOS: readonly string[] = ["npm run checar", "npm run build", "git status*", "git diff*", "ls*", "dir*", "node scripts/uiux.mjs *"];

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

/** Configuração do opencode para um trabalho: um modelo, com preço, e permissões fechadas. */
export function configDoOpencode(m: ModeloDoMotor, medidorUrl?: string | null) {
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
    // O agente escreve no projeto e roda só os scripts do projeto; nada de internet nem de pasta de fora.
    // "*": "deny" vem PRIMEIRO (a última regra que casa vence): assim o bash e a skill ficam ligados
    // só para o que está liberado. A embutida customize-opencode fica negada.
    permission: {
      edit: "allow" as Acao,
      webfetch: "deny" as Acao,
      external_directory: "deny" as Acao,
      doom_loop: "deny" as Acao,
      bash: negarPrimeiro(COMANDOS_LIBERADOS),
      skill: negarPrimeiro(SKILLS_DA_CASA),
    },
    watcher: { ignore: ["node_modules/**", "dist/**", "dist-ssr/**", ".git/**", ".opencode/**"] },
  };
}

/** Pasta de configuração global do opencode que é SÓ do worker (vazia de skills). */
export const PASTA_CASA_DO_OPENCODE = resolve(import.meta.dirname, "..", ".opencode-casa");

/** Variáveis OPENCODE_* que podem vir do ambiente da máquina; as outras (OPENCODE_CONFIG, _DIR, _PERMISSION...) nunca passam. */
const OPENCODE_HERDAVEIS = ["OPENCODE_GIT_BASH_PATH"];

/**
 * Ambiente do `opencode serve`: o da máquina menos qualquer OPENCODE_*
 * herdado (configuração, permissão e pasta extra de fora), mais o isolamento
 * provado na frente UIM:
 *  - OPENCODE_DISABLE_EXTERNAL_SKILLS=1: tira ~/.claude/skills e ~/.agents/skills;
 *  - OPENCODE_DISABLE_CLAUDE_CODE=1: tira o ~/.claude/CLAUDE.md e o CLAUDE.md do projeto;
 *  - XDG_CONFIG_HOME próprio: a pasta global do opencode (~/.config/opencode, com
 *    skills e AGENTS.md pessoais) passa a ser a do worker, vazia.
 * A chave do provedor continua só pelo {env:...} da configuração.
 */
export function ambienteDoOpencode(base: Record<string, string | undefined>, config: unknown, pastaCasa: string = PASTA_CASA_DO_OPENCODE): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of Object.keys(base)) {
    const v = base[k];
    if (typeof v !== "string") continue;
    if (/^OPENCODE_/i.test(k) && OPENCODE_HERDAVEIS.indexOf(k.toUpperCase()) < 0) continue;
    if (/^XDG_CONFIG_HOME$/i.test(k)) continue;
    env[k] = v;
  }
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  env.OPENCODE_DISABLE_EXTERNAL_SKILLS = "1";
  env.OPENCODE_DISABLE_CLAUDE_CODE = "1";
  env.XDG_CONFIG_HOME = pastaCasa;
  env.NO_COLOR = "1";
  return env;
}
