-- Frente PERF-banco (30/09/2026), achado B07: a vista do motor de
-- autopublicação passa a ser só de leitura para o painel.
--
-- O problema: public.autopublish_status_secure (dono postgres, sem
-- security_invoker, security_barrier) lê social_private.autopublish_jobs. É
-- uma vista de uma tabela só, então o Postgres a torna atualizável
-- (pg_relation_is_updatable = 28: INSERT, UPDATE e DELETE), e o papel
-- authenticated tinha todos os privilégios nela (arwdDxtm). Como a vista roda
-- com os direitos do dono, que ignora a RLS, qualquer pessoa da equipe com
-- acesso ao cliente conseguia apagar ou alterar linhas do motor de
-- publicação por DELETE ou PATCH em /rest/v1/autopublish_status_secure. Fere
-- a regra apagar = arquivar e o próprio motor.
--
-- A correção: tirar tudo de PUBLIC, anon e authenticated e devolver só o
-- SELECT a authenticated. O painel só lê a vista
-- (src/hooks/useAutopublishStatus.ts). service_role fica como está.
--
-- O que NÃO muda: a vista, o filtro is_staff/can_access_client dela, o
-- security_barrier e o fato de ser definer de propósito (authenticated não
-- tem USAGE em social_private; ligar security_invoker quebraria a leitura da
-- tela). O aviso security_definer_view do advisor continua, e é esperado.
--
-- Idempotente (REVOKE/GRANT). Não aplicar direto: o dono aplica na
-- integração (SQL Editor).

DO $$
BEGIN
  IF to_regclass('public.autopublish_status_secure') IS NULL THEN
    RETURN;
  END IF;
  REVOKE ALL ON public.autopublish_status_secure FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON public.autopublish_status_secure TO authenticated;
END
$$;

-- Conferência depois de aplicar (só leitura; esperado f, f, f, t):
-- select has_table_privilege('authenticated', 'public.autopublish_status_secure', 'INSERT'),
--        has_table_privilege('authenticated', 'public.autopublish_status_secure', 'UPDATE'),
--        has_table_privilege('authenticated', 'public.autopublish_status_secure', 'DELETE'),
--        has_table_privilege('authenticated', 'public.autopublish_status_secure', 'SELECT');
-- Na tela: abrir uma peça agendada ou com falha na Mesa e ver o estado do motor.
