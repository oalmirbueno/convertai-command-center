-- ============================================================================
-- Aceleriq OS - agendou e aprovou, publica. Sem depender de marcação interna.
-- ============================================================================
--
-- O caso real: um post foi agendado, o horário passou e nada saiu. Motivo: o
-- registro nasceu com a marcação interna de entrega "manual" (dois caminhos de
-- agendamento do painel nem enviavam a marcação, e tudo que já existia também
-- estava assim). O motor só olhava para "automatic", então ignorava o post,
-- sem erro e sem aviso.
--
-- Decisão de produto: no Aceleriq OS, agendamento de Instagram aprovado É para
-- publicar sozinho. Este patch remove a marcação da regra de entrada do motor.
-- Todas as outras travas continuam exatamente iguais: precisa estar
-- 'scheduled', no horário, com material aprovado pelo duplo gate e respeitando
-- a carência de 1 hora pós-aprovação.
--
-- ATENÇÃO: ao rodar, agendamentos vencidos e APROVADOS que estavam presos pela
-- marcação passam a ser publicados no próximo minuto. Se houver algum
-- agendamento antigo que não deve mais sair, cancele antes de rodar.
--
-- Técnica: mesmo padrão do patch 20260812190000 - reescreve a função atual
-- trocando só a linha da condição, preservando o restante do corpo v3.
-- ============================================================================

DO $$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef('public.editorial_autopublish_tick()'::regprocedure)
  INTO _def;

  IF _def IS NULL THEN
    RAISE EXCEPTION 'editorial_autopublish_tick nao encontrada';
  END IF;

  IF position('publication.delivery_mode = ''automatic''' IN _def) = 0 THEN
    RAISE NOTICE 'Patch ja aplicado: a marcacao de entrega nao e mais uma trava.';
    RETURN;
  END IF;

  _def := replace(
    _def,
    'AND publication.delivery_mode = ''automatic''',
    'AND publication.delivery_mode IN (''manual'', ''automatic'')'
  );

  EXECUTE _def;
  RAISE NOTICE 'Motor atualizado: todo agendamento aprovado de Instagram publica sozinho.';
END;
$$;
