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
