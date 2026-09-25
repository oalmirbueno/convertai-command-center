-- ═══════════════════════════════════════════════════════════════════════
-- MESA DO CLIENTE: PAPEL "estrategista_rapido" NO CATÁLOGO DE MODELOS
--
-- Pedido do dono (25/09): "no mês, uma ação rápida para colocar um conteúdo
-- rápido: eu converso, ele prepara o conteúdo". O conteudo_rapido do
-- agente-calendario usa o modelo marcado como padrão do papel
-- "estrategista_rapido" com raciocínio baixo; sem nenhum modelo marcado, usa
-- o padrão do estrategista (também com raciocínio baixo). Este SQL só libera o
-- papel na restrição da coluna padrao_para: nada muda até alguém marcar um
-- modelo com ele.
--
-- Não aplicado em produção por este trabalho. Aplicar pelo SQL Editor (validar
-- antes com BEGIN ... ROLLBACK).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.ia_modelos DROP CONSTRAINT IF EXISTS ia_modelos_padrao_para_check;
ALTER TABLE public.ia_modelos
  ADD CONSTRAINT ia_modelos_padrao_para_check
  CHECK (padrao_para <@ ARRAY['estrategista', 'diretor_arte', 'imagem', 'leitura', 'contexto', 'estrategista_rapido']::text[]);

COMMIT;

-- Para ligar um modelo rápido (exemplo, rode só se quiser trocar):
-- UPDATE public.ia_modelos SET padrao_para = array_remove(padrao_para, 'estrategista_rapido')
--   WHERE 'estrategista_rapido' = ANY(padrao_para);
-- UPDATE public.ia_modelos SET padrao_para = array_append(padrao_para, 'estrategista_rapido')
--   WHERE id = 'openrouter:openai/gpt-6-sol';
