-- Corrige o erro visto no celular ao agendar uma publicacao:
--   "the editorial primary file is already under review; create a revision"
--
-- A guarda barrava ANEXAR/agendar um post cujo material ainda esta em revisao.
-- Anexar nao altera o arquivo em nada: as travas que importam continuam em pe
-- (arquivo precisa ser legivel, do mesmo cliente e projeto; e aprovar ou
-- publicar o post continua exigindo o material com o duplo gate aprovado, na
-- transicao). Portanto a guarda de anexo vira no-op: agendar nunca mais trava
-- por causa de revisao em andamento.
--
-- A outra guarda ("the approved editorial version is immutable") permanece:
-- trocar a arte de um post ja aprovado continua exigindo revisao.
--
-- Forward-only, aditiva e idempotente: reescreve a funcao a partir da
-- definicao vigente no banco (funciona com ou sem o patch 20260812120000).

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_raise text;
  new_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_editorial_post_unlocked';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION 'save_editorial_post_unlocked nao encontrada; nada a aplicar';
  END IF;

  new_body := $b$NULL; -- anexar material em revisao e permitido; a aprovacao segue exigida na hora de aprovar/publicar$b$;

  IF position(new_body IN original_definition) > 0 THEN
    RAISE NOTICE 'anexo de material em revisao ja liberado; nada a fazer';
    RETURN;
  END IF;

  old_raise := $a$RAISE EXCEPTION 'the editorial primary file is already under review; create a revision';$a$;

  IF position(old_raise IN original_definition) = 0 THEN
    RAISE EXCEPTION 'guarda do arquivo principal nao encontrada; nada foi alterado';
  END IF;

  patched_definition := replace(original_definition, old_raise, new_body);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION 'nenhuma alteracao produzida; nada foi aplicado';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE 'agendamento com material em revisao liberado com sucesso';
END
$patch$;

-- A funcao interna nunca e chamada direto pelo cliente: quem expoe e o wrapper
-- public.save_editorial_post, cujas permissoes permanecem intactas.
REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role;
