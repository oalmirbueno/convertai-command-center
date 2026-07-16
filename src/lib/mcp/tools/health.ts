import { defineTool } from "@lovable.dev/mcp-js";

export default defineTool({
  name: "health",
  title: "Health check",
  description: "Verifica se o MCP do Aceleriq OS está online e retorna o usuário autenticado.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: (_input, ctx) => {
    const authed = ctx.isAuthenticated();
    return {
      content: [{
        type: "text",
        text: authed
          ? `ok — autenticado como ${ctx.getUserEmail() ?? ctx.getUserId()}`
          : "ok — sem autenticação",
      }],
      structuredContent: {
        status: "ok",
        authenticated: authed,
        user_id: authed ? ctx.getUserId() : null,
        user_email: authed ? ctx.getUserEmail() : null,
        server: "aceleriq-os",
      },
    };
  },
});
