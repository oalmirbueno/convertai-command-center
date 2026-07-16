import { auth, defineMcp } from "@lovable.dev/mcp-js";
import healthTool from "./tools/health";
import listClientsTool from "./tools/list-clients";
import listProjectsTool from "./tools/list-projects";
import listTasksTool from "./tools/list-tasks";
import createTaskTool from "./tools/create-task";
import listContractsTool from "./tools/list-contracts";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "aceleriq-os",
  title: "Aceleriq OS",
  version: "1.0.0",
  instructions:
    "Servidor MCP oficial do Aceleriq Performance OS. Ferramentas de leitura e escrita operam como o usuário autenticado (RLS aplicado). Use `health` para verificar conectividade, `list_clients`/`list_projects`/`list_tasks`/`list_contracts` para contexto e `create_task` para inserir trabalho no Kanban.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    healthTool,
    listClientsTool,
    listProjectsTool,
    listTasksTool,
    listContractsTool,
    createTaskTool,
  ],
});
