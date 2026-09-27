/**
 * Ponte Ops aposentada, para as duas funções que o NAVEGADOR chamava
 * (notify-ops e portal-to-ops).
 *
 * As outras funções da ponte respondem 503 (opsBridgeRetiredResponse, em
 * ops-config.ts): quem chama é servidor ou auditoria, e 503 diz "desligada,
 * reversível". Estas duas eram chamadas pelo painel a cada projeto, etapa,
 * tarefa e perfil salvo; o 503 virava `sync_status = 'sync_error'` no
 * registro (src/lib/opsSync.ts), um erro falso gravado no banco para uma
 * integração desligada de propósito.
 *
 * O painel novo não chama mais (VITE_OPS_LEGACY_BRIDGE_ENABLED). Para os
 * bundles antigos ainda em cache, a resposta é 200 sem `ok: false`: o
 * registro fica como está, sem erro.
 */
export function respostaDePonteAposentada(headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({
      aposentada: true,
      enviado: false,
      code: "ops_bridge_retired",
      message:
        "A ponte com o Ops foi aposentada. Nada foi enviado e não há nada a fazer. "
        + "Para religar, defina OPS_LEGACY_BRIDGE_ENABLED=true e as URLs do Ops.",
    }),
    { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
  );
}
