/**
 * Rota do modelo no worker (frente MTR, 30/09/2026).
 *
 * O painel grava no trabalho o modelo escolhido (ex.: "openai:gpt-6-luna",
 * direto na OpenAI). A chave desse provedor precisa estar no ambiente DESTA
 * máquina; a do servidor (segredo do Supabase) não chega aqui. Diagnóstico de
 * 30/09: o trabalho do site pedia a OpenAI direta e a máquina da agência só
 * tinha OPENROUTER_API_KEY, então o motor morreria na subida do agente, depois
 * de montar projeto, dependências e prévia.
 *
 * Regra: sem a chave do provedor direto e com a do OpenRouter, o motor procura
 * no catálogo (ia_modelos) o MESMO modelo servido pelo OpenRouter e segue por
 * ele, com um aviso na tela. Sem rota nenhuma, o trabalho falha logo no começo,
 * dizendo o nome da chave que falta (nunca o valor).
 *
 * Módulo puro: o teste roda no vitest.
 */
import type { ModeloDoMotor } from "../../../supabase/functions/_shared/motor-codigo.ts";

export const CHAVES_DOS_PROVEDORES: Record<string, string> = { openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

/** Provedor como o opencode fala (o que não é anthropic nem openai vai pelo OpenRouter). */
export const provedorDoOpencode = (m: Pick<ModeloDoMotor, "provedor">) => (m.provedor === "anthropic" || m.provedor === "openai" ? m.provedor : "openrouter");

/**
 * Ids que o MESMO modelo tem no catálogo do OpenRouter.
 * "openai" + "gpt-6-luna" -> "openrouter:openai/gpt-6-luna";
 * "anthropic" + "claude-opus-5-5" -> também "openrouter:anthropic/claude-opus-5.5"
 * (a Anthropic usa hífen na versão; o OpenRouter, ponto).
 */
export function idsNoOpenrouter(m: Pick<ModeloDoMotor, "provedor" | "modelo_api">): string[] {
  const p = provedorDoOpencode(m);
  if (p === "openrouter") return [];
  const api = String(m.modelo_api || "").trim().replace(/^[a-z-]+\//, "");
  if (!api) return [];
  const ids = [`openrouter:${p}/${api}`];
  // Versão com hífen no fim (5-5, 4-6) vira ponto (5.5, 4.6); tira o sufixo de data (-20260101).
  const semData = api.replace(/-\d{8}$/, "");
  const comPonto = semData.replace(/-(\d{1,2})-(\d{1,2})$/, "-$1.$2");
  [semData, comPonto].forEach((v) => {
    const id = `openrouter:${p}/${v}`;
    if (ids.indexOf(id) < 0) ids.push(id);
  });
  return ids;
}

/** Forma plana (o painel compila sem strict: união discriminada por booleano não estreita). */
export type RotaDoModelo = { ok: boolean; modelo: ModeloDoMotor | null; aviso: string | null; motivo: string | null; chave: string | null };

/**
 * Decide por onde o modelo vai. `temChave(provedor)` olha o ambiente;
 * `alternativo` é o que o catálogo achou pelos ids de `idsNoOpenrouter` (ou null).
 */
export function escolherRota(m: ModeloDoMotor, temChave: (provedor: string) => boolean, alternativo: ModeloDoMotor | null): RotaDoModelo {
  const p = provedorDoOpencode(m);
  if (temChave(p)) return { ok: true, modelo: m, aviso: null, motivo: null, chave: null };
  const chave = CHAVES_DOS_PROVEDORES[p] || p;
  if (p !== "openrouter" && temChave("openrouter") && alternativo && alternativo.provedor === "openrouter") {
    return {
      ok: true,
      modelo: alternativo,
      aviso: `Esta máquina não tem ${chave}: o motor seguiu pelo OpenRouter com o mesmo modelo (${alternativo.modelo_api}).`,
      motivo: null,
      chave: null,
    };
  }
  const semRota = p !== "openrouter" && temChave("openrouter") ? ` e o modelo ${m.modelo_api} não tem rota pelo OpenRouter no catálogo` : "";
  return {
    ok: false,
    modelo: null,
    aviso: null,
    chave,
    motivo: `O worker não tem a chave ${chave} no ambiente${semRota}. Ponha a chave no ambiente da máquina do motor (docs/motores/LIGAR-OS-MOTORES.md) ou escolha outro modelo na Mesa Site.`,
  };
}

// ------------------------------------------------------------------ MCC (25/10/2026): o motor do trabalho e a rota do Claude Code

export type MotorDoTrabalho = "claude_code" | "opencode";

/**
 * Padrão do worker quando a tela não escolhe: MOTOR_PADRAO do ambiente
 * (claude_code ou opencode) ou, sem ele, o PADRAO_DO_MOTOR abaixo. Medido no
 * teste de ponta a ponta de 25/10 (modelo pronto e referência pelo Claude
 * Code com o Haiku 5.5 pela OpenRouter).
 */
export const PADRAO_DO_MOTOR: MotorDoTrabalho = "claude_code";

/** O motor do trabalho: o escolhido na tela; senão o padrão; o Claude Code sem binário cai para o opencode (com aviso). */
export function motorDoTrabalho(escolhido: unknown, temClaude: boolean, padrao: string | undefined = process.env.MOTOR_PADRAO): { motor: MotorDoTrabalho; aviso: string | null } {
  const base: MotorDoTrabalho = padrao === "opencode" || padrao === "claude_code" ? padrao : PADRAO_DO_MOTOR;
  const pedido: MotorDoTrabalho = escolhido === "opencode" || escolhido === "claude_code" ? escolhido : base;
  if (pedido === "claude_code" && !temClaude) return { motor: "opencode", aviso: "O Claude Code não está instalado neste worker (npm install em workers/motor-codigo): o trabalho seguiu no OpenCode." };
  return { motor: pedido, aviso: null };
}

/**
 * O Claude Code fala o protocolo da Anthropic e vai SEMPRE pela OpenRouter
 * (a chave fica no medidor). Modelo do OpenRouter vai direto; modelo direto da
 * Anthropic ou da OpenAI vai pelo MESMO modelo no catálogo da OpenRouter
 * (`alternativo`, achado por idsNoOpenrouter). Sem chave da OpenRouter ou sem
 * rota: não ok (o worker volta para o opencode com aviso).
 */
export function rotaDoClaudeCode(m: ModeloDoMotor, temChave: (provedor: string) => boolean, alternativo: ModeloDoMotor | null): RotaDoModelo {
  if (!temChave("openrouter")) return { ok: false, modelo: null, aviso: null, chave: "OPENROUTER_API_KEY", motivo: "O Claude Code do motor vai pela OpenRouter e esta máquina não tem OPENROUTER_API_KEY." };
  if (provedorDoOpencode(m) === "openrouter") return { ok: true, modelo: m, aviso: null, motivo: null, chave: null };
  if (alternativo && alternativo.provedor === "openrouter") return { ok: true, modelo: alternativo, aviso: `O Claude Code seguiu pela OpenRouter com o mesmo modelo (${alternativo.modelo_api}).`, motivo: null, chave: null };
  return { ok: false, modelo: null, aviso: null, chave: null, motivo: `O modelo ${m.modelo_api} não tem rota pela OpenRouter no catálogo para o Claude Code.` };
}
