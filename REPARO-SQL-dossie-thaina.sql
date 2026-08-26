-- PARA RODAR NO SQL EDITOR DO LOVABLE CLOUD (Backend -> SQL).
-- Cole o arquivo inteiro e execute uma vez. Rodar de novo nao faz mal.
--
-- O que isto conserta: um agente gravou o dossie geral da Thaina Rosa
-- Advogada com o tipo "context" (ingles) em vez de "contexto". Nasceu um
-- balde PARALELO — dois dossies gerais "atuais" ao mesmo tempo — e o do
-- balde errado e justamente o MAIS NOVO (26/08 19:02, com as respostas do
-- Almir as lacunas), invisivel para quem le "contexto".
--
-- O reparo DOBRA o balde errado para dentro do certo, sem apagar nada:
-- o registro "context" vira a versao 4 de "contexto" (e o mais novo, entao
-- e ele que deve valer), e a v3 antiga registra que foi superada por ele.
-- O codigo ja foi corrigido para normalizar o tipo na escrita e na
-- leitura, entao esse balde nao volta a nascer.

BEGIN;

-- 1) A v3 de "contexto" deixa de ser a atual, superada pelo registro novo.
UPDATE public.client_dossiers
SET is_current = false,
    superseded_at = now(),
    superseded_by = '435be9df-f35e-475f-94c6-ae15a7ca2dd3'
WHERE id = '3e264a9b-a7e9-433a-b704-acb278974890'
  AND is_current = true;

-- 2) O registro do balde "context" entra na linhagem de "contexto" como v4.
UPDATE public.client_dossiers
SET dossier_type = 'contexto',
    version = 4,
    prior_version_id = '3e264a9b-a7e9-433a-b704-acb278974890',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'reparo_de_tipo', jsonb_build_object(
        'motivo', 'gravado como "context" (ingles); dobrado para "contexto" como v4',
        'tipo_original', 'context',
        'corrigido_em', now()
      )
    )
WHERE id = '435be9df-f35e-475f-94c6-ae15a7ca2dd3'
  AND dossier_type = 'context';

COMMIT;

-- Conferencia: deve responder 1 atual, versao 4, e zero do tipo antigo.
SELECT
  (SELECT count(*) FROM public.client_dossiers
    WHERE client_id = '3ba9540c-bc09-4026-b575-05fd0df4195f'
      AND dossier_type = 'contexto' AND project_id IS NULL
      AND is_current) AS atuais_do_geral_deve_ser_1,
  (SELECT max(version) FROM public.client_dossiers
    WHERE client_id = '3ba9540c-bc09-4026-b575-05fd0df4195f'
      AND dossier_type = 'contexto' AND project_id IS NULL) AS versao_atual_deve_ser_4,
  (SELECT count(*) FROM public.client_dossiers
    WHERE dossier_type = 'context') AS tipo_errado_deve_ser_0;
