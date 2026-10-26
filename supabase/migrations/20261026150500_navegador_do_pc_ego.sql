-- Navegador do PC (26/10/2026): os agentes usam o Ego Lite do PC do dono, com os logins dele.
--
-- O agente pede pelo MCP (aceleriq_navegador_do_pc); a função grava a tarefa já 'aprovada' (a credencial
-- da equipe é a autorização, e clique que publica/envia/paga/salva só entra com operator_approvals aprovada,
-- marcado no passo); o worker do navegador da máquina do dono (workers/computador, executor que anuncia o
-- caso 'pc_ego') pega pela mesma fila e roda no Ego. Os passos vão na coluna passos (jsonb, já existia).
-- Regras em supabase/functions/computador-do-agente/modulos/navegador-do-pc.ts (MCP e worker).
--
-- Só amplia o CHECK de caso. Idempotente. Nada é apagado.

ALTER TABLE public.agente_computador_tarefas DROP CONSTRAINT IF EXISTS agente_computador_tarefas_caso_check;
ALTER TABLE public.agente_computador_tarefas
  ADD CONSTRAINT agente_computador_tarefas_caso_check
  CHECK (caso IS NULL OR caso IN ('captura_site', 'conferir_post', 'coleta_publica', 'conferir_site', 'capturar_referencia', 'perfil_publico', 'concorrentes_visuais', 'pc_ego'));

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'agente_computador_tarefas_caso_check';
-- select nome, visto_em, versao, casos from public.computador_executores where 'pc_ego' = any(casos);
