/**
 * Configuração do opencode para um trabalho (sem o SDK: os testes do painel
 * leem este arquivo sem instalar o worker). Um modelo só, com o preço do
 * catálogo, a chave pela variável de ambiente e permissões fechadas.
 */
import { modeloParaOpencode, type ModeloDoMotor } from "../../../supabase/functions/_shared/motor-codigo.ts";

/** Variável de ambiente da chave de cada provedor (só no worker). */
export const CHAVE_DO_PROVEDOR: Record<string, string> = { openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export function temChave(provedor: string): boolean {
  const v = process.env[CHAVE_DO_PROVEDOR[provedor] || ""];
  return typeof v === "string" && v.trim().length > 10;
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
    permission: {
      edit: "allow",
      webfetch: "deny",
      external_directory: "deny",
      doom_loop: "deny",
      bash: { "npm run checar": "allow", "npm run build": "allow", "git status*": "allow", "git diff*": "allow", "ls*": "allow", "dir*": "allow", "*": "deny" },
    },
    watcher: { ignore: ["node_modules/**", "dist/**", "dist-ssr/**", ".git/**"] },
  };
}
