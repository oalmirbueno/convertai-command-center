-- Frente IDV3 (30/09/2026): "Completar marca existente" na Mesa Identidade (/mesa-identidade). Pedido do dono:
-- "na identidade visual, também criar o material completo usando tudo para marcas existentes que só têm logo
-- e nome, e deixar completa e profissional".
--
-- Só amplia e é idempotente. Nada de mexer em RLS existente nem em can_access_client: as tabelas idv_* seguem
-- com a equipe lendo (is_staff + can_access_client) e só a função (service_role) gravando.
--
-- 1. Modo novo do projeto: 'completar' (marca existente: logo e nome; sem Pesquisa, Naming e Conceito).
--    O CHECK de idv_projetos.modo ganha o valor (lista lida em 30/09: 'zero', 'rebranding').
-- 2. Eventos novos para o documento de entrega: 'marca_completada' (fim da rodada do "Completar tudo", com os
--    passos e o custo) e 'video_da_marca' (filme criado na Mesa Motion a partir do projeto).
--
-- Os dados novos (leitura da logo, versões, rodada do completar, vídeos) moram em idv_projetos.dados (jsonb):
-- nenhuma coluna nova.

-- ─── 1) Modo novo ─────────────────────────────────────────────────────────────
DO $migration$
BEGIN
  IF to_regclass('public.idv_projetos') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.idv_projetos DROP CONSTRAINT IF EXISTS idv_projetos_modo_check;
  ALTER TABLE public.idv_projetos
    ADD CONSTRAINT idv_projetos_modo_check
    CHECK (modo IN ('zero', 'rebranding', 'completar'));
END
$migration$;

-- ─── 2) Eventos novos ─────────────────────────────────────────────────────────
DO $migration$
BEGIN
  IF to_regclass('public.idv_eventos') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.idv_eventos DROP CONSTRAINT IF EXISTS idv_eventos_tipo_check;
  ALTER TABLE public.idv_eventos
    ADD CONSTRAINT idv_eventos_tipo_check
    CHECK (tipo IN ('naming_enviado', 'naming_grupo', 'naming_escolhido', 'brandbook_enviado', 'brandbook_publicado', 'brandbook_revogado', 'kit_aplicado', 'projeto_entregue',
                    'estrategia_montada', 'votacao_aberta', 'votacao_fechada',
                    'marca_completada', 'video_da_marca'));
END
$migration$;

-- Conferência (leitura, depois de aplicar):
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('idv_projetos_modo_check', 'idv_eventos_tipo_check');
