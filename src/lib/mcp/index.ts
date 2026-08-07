import { auth, defineMcp } from "@lovable.dev/mcp-js";
import healthTool from "./tools/health";
import listClientsTool from "./tools/list-clients";
import listProjectsTool from "./tools/list-projects";
import listTasksTool from "./tools/list-tasks";
import createTaskTool from "./tools/create-task";
import createEditorialItemTool from "./tools/create-editorial-item";
import listEditorialCalendarTool from "./tools/list-editorial-calendar";
import listContractsTool from "./tools/list-contracts";

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const authIssuer = `${supabaseUrl}/auth/v1`;

export default defineMcp({
  name: "aceleriq-os",
  title: "Aceleriq OS",
  version: "1.1.0",
  instructions:
    "Servidor MCP oficial do Aceleriq Performance OS. Ferramentas de leitura e escrita operam como o usuário autenticado (RLS aplicado). Use `health` para verificar conectividade, `list_clients`/`list_projects`/`list_tasks`/`list_contracts` para contexto, `list_editorial_calendar` para o calendário filtrado de artes, carrosséis e vídeos e `create_editorial_item` para adicionar uma pauta editorial sem aprovar, agendar ou publicar. Use `create_task` somente para trabalho operacional geral do Kanban.",
  auth: auth.oauth.issuer({
    issuer: authIssuer,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    healthTool,
    listClientsTool,
    listProjectsTool,
    listTasksTool,
    listEditorialCalendarTool,
    listContractsTool,
    createTaskTool,
    createEditorialItemTool,
  ],
});
