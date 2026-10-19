-- Gravyx (19/10/2026): a obra do site no motor de código (Mesa Site).
-- Regras puras: supabase/functions/mesa-site/modulos/obra-do-site.ts; worker: workers/motor-codigo/.
--
-- motor_trabalhos ganha quatro tipos:
--  salvar    o rascunho do motor vira a versão salva (máquina, sem custo);
--  descartar o rascunho sai e a prévia volta à versão salva (máquina, sem custo);
--  corrigir  UMA passada do agente sobre o que a conferência no navegador achou
--            (custo com teto, pedida no botão; nunca em laço, nunca duas vezes);
--  textos    troca literal de texto escrito no código, sem IA (máquina, sem custo).
--
-- Só amplia a CHECK, idempotente. Sem tabela nova: a fase vai em
-- motor_eventos.dados.fase; o ramo, a versão salva e a conferência vão em
-- motor_trabalhos.resultado (ramo, versao, conferencia, conferencia_de).
-- Não aplicar direto: o dono aplica na integração.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.motor_trabalhos DROP CONSTRAINT IF EXISTS motor_trabalhos_tipo_check;
ALTER TABLE public.motor_trabalhos
  ADD CONSTRAINT motor_trabalhos_tipo_check
  CHECK (tipo IN ('construir', 'ajustar', 'desfazer', 'revisar', 'publicar', 'zip', 'conteudo', 'salvar', 'descartar', 'corrigir', 'textos'));

COMMENT ON CONSTRAINT motor_trabalhos_tipo_check ON public.motor_trabalhos IS
  'Gravyx 19/10: salvar e descartar (rascunho x versão salva), corrigir (uma passada sobre a conferência no navegador) e textos (troca de texto no código sem IA), além dos tipos de 30/09.';
