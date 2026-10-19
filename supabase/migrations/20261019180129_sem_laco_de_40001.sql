-- 19/10/2026 (dono: "o aprovar está demorando demais e não aprova").
-- Conflito de versão, fonte desatualizada e "já decidido" são erros determinísticos:
-- repetir nunca resolve. Com ERRCODE 40001 (serialization_failure) o PostgREST repete a
-- transação sem parar: três cliques em Aprovar (14:22, 14:22 e 16:41) viraram laços de
-- ~100 erros CENTRAL_SOURCE_STALE por segundo, por horas, e a tela recebia 504.
-- Mesmo erro, mesma mensagem (a tela lê a mensagem), código que não repete: P0001.
DO $$
DECLARE
  f record;
  def text;
  novo text;
BEGIN
  FOR f IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname IN (
         'central_review_decide', 'central_review_decidir_por_agente', 'central_review_preparar_por_agente',
         'central_review_prepare', 'aviso_publicacao_decidir', 'archive_editorial_post_unlocked',
         'save_approved_editorial_post_unlocked', 'save_editorial_post_unlocked',
         'transition_editorial_publication_unlocked')
  LOOP
    def := pg_get_functiondef(f.oid);
    novo := regexp_replace(def, 'ERRCODE\s*=\s*''40001''', 'ERRCODE = ''P0001''', 'gi');
    IF novo <> def THEN
      EXECUTE novo;
    END IF;
  END LOOP;
END
$$;
