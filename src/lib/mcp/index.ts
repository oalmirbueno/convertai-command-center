import { auth, defineMcp } from "@lovable.dev/mcp-js";
import healthTool from "./tools/health";
import listClientsTool from "./tools/list-clients";
import listProjectsTool from "./tools/list-projects";
import listTasksTool from "./tools/list-tasks";
import createTaskTool from "./tools/create-task";
import createEditorialItemTool from "./tools/create-editorial-item";
import listEditorialCalendarTool from "./tools/list-editorial-calendar";
import listContractsTool from "./tools/list-contracts";
import getClientMetricsTool from "./tools/get-client-metrics";
import registerClientUpdateTool from "./tools/register-client-update";
import getClientJournalTool from "./tools/get-client-journal";
import createProjectTool from "./tools/create-project";
import updateProjectTool from "./tools/update-project";
import updateTaskTool from "./tools/update-task";
import completeTaskTool from "./tools/complete-task";

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const authIssuer = `${supabaseUrl}/auth/v1`;

export default defineMcp({
  name: "aceleriq-os",
  title: "Aceleriq OS",
  version: "1.5.0",
  instructions:
    "Servidor MCP oficial do Aceleriq Performance OS. Ferramentas de leitura e escrita operam como o usuário autenticado (RLS aplicado). Use `health` para verificar conectividade, `list_clients`/`list_projects`/`list_tasks`/`list_contracts` para contexto, `get_client_metrics` para as METRICAS REAIS do Instagram do cliente (semanas com seguidores, alcance e interacoes + desempenho por publicacao) sempre que for analisar resultados ou dar direcionamento - cite os numeros e a variacao, nunca invente, `list_editorial_calendar` para o calendário filtrado de artes, carrosséis e vídeos e `create_editorial_item` para adicionar uma pauta editorial sem aprovar, agendar ou publicar. Use `create_task` somente para trabalho operacional geral do Kanban, `update_task` para corrigir e `complete_task` ao terminar. Use `create_project` para abrir projeto operacional (cobranca e valores so no painel) e `update_project` para status, datas, progresso e escopo. Use `get_client_journal` para puxar o contexto vivo de um cliente e `register_client_update` para registrar no Diario do Trabalho o que foi feito (o cliente ve a acao em tempo real). ORGANIZACAO DE ARQUIVOS: toda pasta do cliente e uma destas: materiais (artes das redes), criativos (pecas de anuncio), identidade (logo, manual da marca, fontes), base (fotos e videos brutos do cliente), entregas, estrategicos, operacionais, relatorios, contratos. Dentro da pasta o tipo e um destes: carrossel, post, story, video, logo, foto, documento, contrato, relatorio, estrategico, briefing, outro. Sempre escolha a pasta E o tipo corretos ao arquivar algo, porque o cliente filtra por eles na tela dele. ESCRITA VOLTADA AO CLIENTE: qualquer texto que o cliente le deve ser em portugues claro, sem jargao e SEM TRAVESSAO (use ' - ' ou ' . ').",
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
    getClientMetricsTool,
    createTaskTool,
    createEditorialItemTool,
    registerClientUpdateTool,
    getClientJournalTool,
    createProjectTool,
    updateProjectTool,
    updateTaskTool,
    completeTaskTool,
  ],
});
