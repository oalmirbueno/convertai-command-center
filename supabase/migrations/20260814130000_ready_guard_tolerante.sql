-- "file must be ready before review": arquivos com o objeto salvo (upload
-- concluido) ficavam presos com status antigo e nao podiam ser liberados ao
-- cliente. Duas frentes:
--   1. Guarda tolerante: arquivo com storage_path/file_url preenchido conta
--      como pronto, mesmo se o status ficou para tras.
--   2. Normaliza os arquivos ja presos (apenas os em estado editavel).

DO $patch$
DECLARE
  r record;
  def text;
  newdef text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind = 'f' AND n.nspname = 'public'
      AND pg_get_functiondef(p.oid) LIKE '%file must be ready before review%'
  LOOP
    def := pg_get_functiondef(r.oid);
    newdef := replace(
      def,
      $a$COALESCE(_file.status, 'ready') <> 'ready' THEN
    RAISE EXCEPTION 'file must be ready before review';$a$,
      $b$COALESCE(_file.status, 'ready') <> 'ready'
    AND COALESCE(_file.storage_path, _file.file_url) IS NULL THEN
    RAISE EXCEPTION 'file must be ready before review';$b$
    );
    IF newdef <> def THEN
      EXECUTE newdef;
      RAISE NOTICE 'guarda ready relaxada em %', r.oid::regprocedure;
    ELSE
      RAISE NOTICE 'padrao nao encontrado em % (formatacao diferente)', r.oid::regprocedure;
    END IF;
  END LOOP;
END
$patch$;

-- Destrava os arquivos existentes (so os que ainda estao em estado editavel,
-- para nao esbarrar nas travas de imutabilidade).
UPDATE public.files
SET status = 'ready'
WHERE COALESCE(status, 'ready') <> 'ready'
  AND archived_at IS NULL
  AND parent_file_id IS NULL
  AND locked_at IS NULL
  AND visibility = 'internal'
  AND agency_approval_status = 'not_requested'
  AND approval_status = 'none'
  AND COALESCE(storage_path, file_url) IS NOT NULL;
