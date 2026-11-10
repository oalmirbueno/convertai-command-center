-- A rotina de avanços não pode apagar "Conversas do grupo de WhatsApp".
-- Roda no banco descartável do `supabase test db`, depois de todas as migrations.
-- Não grava nada fora da transação: o ROLLBACK final desfaz o cliente de teste.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT * FROM no_plan();

SELECT is(
  has_function_privilege('anon', 'public.dossie_registrar_avancos_interno(uuid)', 'EXECUTE'),
  false,
  'anon continua sem executar a rotina interna'
);

SELECT is(
  has_function_privilege('anon', 'app_private.dossie_recompor_avancos(text, text)', 'EXECUTE'),
  false,
  'anon não executa a recomposição do dossiê'
);

SELECT ok(
  pg_get_functiondef('public.dossie_registrar_avancos_interno(uuid)'::regprocedure) LIKE '%dossie_recompor_avancos%',
  'a rotina grava pelo texto recomposto, não pelo corte antigo'
);

SELECT is(
  app_private.dossie_recompor_avancos(
    E'# Contexto\n\n## 1. Plano\nPoda.\n\n## Avanços recentes (automático, 09/11/2026)\nvelho\n\n## Notas do grupo\numa nota\n\n## Conversas do grupo de WhatsApp\n- poda',
    E'## Avanços recentes (automático, 10/11/2026)\nnovo'
  ),
  E'# Contexto\n\n## 1. Plano\nPoda.\n\n## Notas do grupo\numa nota\n\n## Conversas do grupo de WhatsApp\n- poda\n\n## Avanços recentes (automático, 10/11/2026)\nnovo',
  'seções depois do marcador passam para antes dos avanços'
);

SELECT is(
  app_private.dossie_recompor_avancos(
    app_private.dossie_recompor_avancos(
      E'# Contexto\n\n## Avanços recentes (automático, 09/11/2026)\nvelho\n\n## Conversas do grupo de WhatsApp\n- poda',
      E'## Avanços recentes (automático, 10/11/2026)\nnovo'
    ),
    E'## Avanços recentes (automático, 10/11/2026)\nnovo'
  ),
  app_private.dossie_recompor_avancos(
    E'# Contexto\n\n## Avanços recentes (automático, 09/11/2026)\nvelho\n\n## Conversas do grupo de WhatsApp\n- poda',
    E'## Avanços recentes (automático, 10/11/2026)\nnovo'
  ),
  'recompor duas vezes não duplica a seção'
);

SELECT is(
  app_private.dossie_recompor_avancos(
    E'# Contexto\n\n## Conversas do grupo de WhatsApp\n- antiga\n\n## Avanços recentes (automático, 09/11/2026)\nvelho\n\n## Conversas do grupo de WhatsApp (10/11/2026)\n- nova',
    E'## Avanços recentes (automático, 10/11/2026)\nnovo'
  ),
  E'# Contexto\n\n## Conversas do grupo de WhatsApp (10/11/2026)\n- nova\n\n## Avanços recentes (automático, 10/11/2026)\nnovo',
  'a conversa mais nova, com data no título, substitui a antiga'
);

SELECT is(
  app_private.dossie_tem_cauda_externa(
    E'# Contexto\n\n## Avanços recentes (automático, 10/11/2026)\nnovo\n\n## Conversas do grupo de WhatsApp\n- poda'
  ),
  true,
  'há seção externa depois do bloco automático'
);

SELECT is(
  app_private.dossie_tem_cauda_externa(
    E'# Contexto\n\n## Conversas do grupo de WhatsApp\n- poda\n\n## Avanços recentes (automático, 10/11/2026)\nnovo'
  ),
  false,
  'WhatsApp antes do marcador não é cauda'
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  'd0551e00-0000-4000-8000-000000000001',
  'dossie-whatsapp@example.invalid',
  '{"full_name":"Dossiê WhatsApp"}'::jsonb
);

INSERT INTO public.client_dossiers (client_id, dossier_type, project_id, version, content, is_current, summary, tags, metadata)
VALUES (
  'd0551e00-0000-4000-8000-000000000001',
  'contexto',
  NULL,
  1,
  E'# Contexto operacional — SKC\n## 1. Plano\nPoda e jardins.\n\n## Leitura da Central (agente, 01/11/2026)\n**Onde estamos:** campanha no ar.\n\n## Confirmado pelo dono (agente da Central)\n- 01/11/2026 · Verba de 30 por dia.\n\n## Avanços recentes (automático, 09/11/2026)\nRegistro velho.\n\n## Conversas do grupo de WhatsApp\n- Cliente pediu orçamento da poda.',
  true,
  'resumo',
  '{}',
  '{}'::jsonb
);

SELECT is(
  public.dossie_registrar_avancos_interno('d0551e00-0000-4000-8000-000000000001'),
  true,
  'a primeira passagem do dia reescreve e guarda a conversa'
);

SELECT ok(
  (
    SELECT position('## Conversas do grupo de WhatsApp' IN content)
         < position('## Avanços recentes (automático' IN content)
       AND content LIKE '%## 1. Plano%'
       AND content LIKE '%## Leitura da Central (agente, 01/11/2026)%'
       AND content LIKE '%Verba de 30 por dia.%'
       AND content LIKE '%- Cliente pediu orçamento da poda.%'
       AND content NOT LIKE '%Registro velho.%'
       AND (length(content) - length(replace(content, '## Conversas do grupo de WhatsApp', '')))
           / length('## Conversas do grupo de WhatsApp') = 1
    FROM public.client_dossiers
    WHERE client_id = 'd0551e00-0000-4000-8000-000000000001' AND is_current
  ),
  'depois da rotina a conversa está inteira, uma vez, antes dos avanços'
);

SELECT is(
  public.dossie_registrar_avancos_interno('d0551e00-0000-4000-8000-000000000001'),
  false,
  'a segunda passagem seguida não grava de novo'
);

SELECT is(
  (SELECT count(*)::int FROM public.client_dossiers WHERE client_id = 'd0551e00-0000-4000-8000-000000000001'),
  2,
  'duas chamadas criam uma única versão automática'
);

UPDATE public.client_dossiers
   SET content = content || E'\n\n## Conversas do grupo de WhatsApp\n- Mensagem nova das 20:30.'
 WHERE client_id = 'd0551e00-0000-4000-8000-000000000001' AND is_current;

SELECT is(
  public.dossie_registrar_avancos_interno('d0551e00-0000-4000-8000-000000000001'),
  true,
  'no mesmo dia a rotina ainda recolhe a conversa que o n8n anexou depois do marcador'
);

SELECT ok(
  (
    SELECT content LIKE '%- Mensagem nova das 20:30.%'
       AND content NOT LIKE '%orçamento da poda.%'
       AND content LIKE '%## 1. Plano%'
       AND position('## Conversas do grupo de WhatsApp' IN content)
           < position('## Avanços recentes (automático' IN content)
       AND (length(content) - length(replace(content, '## Conversas do grupo de WhatsApp', '')))
           / length('## Conversas do grupo de WhatsApp') = 1
    FROM public.client_dossiers
    WHERE client_id = 'd0551e00-0000-4000-8000-000000000001' AND is_current
  ),
  'fica a conversa nova, sem duplicar e sem apagar o texto da equipe'
);

SELECT is(
  public.dossie_registrar_avancos_interno('d0551e00-0000-4000-8000-000000000001'),
  false,
  'outra passagem, já sem cauda, não mexe no dossiê'
);

SELECT * FROM finish();

ROLLBACK;
