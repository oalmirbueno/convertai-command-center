-- Frente PERF-banco (30/09/2026), achado B04: leitura de files sem reler a
-- própria linha.
--
-- O problema: files_secure_select era can_read_file(id). Para cada linha, a
-- função faz um novo SELECT em files pelo mesmo id (a linha é relida só para
-- conferir as próprias colunas), 4 has_role e can_access_client; no caso do
-- cliente ainda cai em can_client_read_file, que faz um self-join. Entregas
-- do cliente (dashboardHelpers.ts) e arquivos da equipe (AdminExperience.tsx)
-- pagavam isso em toda leitura.
--
-- A correção: a mesma regra de can_read_file, lendo as colunas da linha:
--   (is_staff AND can_access_client(client_id))      -> ramo da equipe, com a
--       forma de conjunto do B03 (ajudantes app_private.eh_admin_atual e
--       app_private.clientes_da_equipe_atual, criados na 20260930296100)
--   OR (client_id = uid AND can_client_read_file(id)) -> ramo do cliente; o
--       pré-filtro client_id = uid não muda o resultado (can_client_read_file
--       já exige root.client_id = auth.uid() e f.client_id = root.client_id)
--       e evita a chamada nas linhas de outros clientes.
-- is_staff (admin, manager, design, traffic) é o mesmo conjunto de papéis do
-- ramo da equipe de can_read_file.
--
-- O que NÃO muda: zz_admin_leitura_rapida, can_read_file (segue usada por
-- storage_object_read_allowed, file_root_state, file_guard_state e pelas RPCs
-- da Agenda), can_client_read_file, can_access_client e as políticas de
-- INSERT, UPDATE e DELETE. Nome e papéis da política ficam iguais.
--
-- Dois efeitos fora do SELECT, registrados de propósito:
--   * INSERT ... RETURNING feito por manager ou design deixa de falhar: a
--     política antiga relia a linha pelo id e não enxergava a linha recém-
--     inserida (reviewToApproval.ts). O admin já passava pelo zz_.
--   * UPDATE ... RETURNING que mova um arquivo para um cliente sem acesso
--     passa a ser barrado (a política antiga conferia a versão antiga).
--
-- Equivalência conferida em 30/09 (só leitura): antiga × nova linha a linha
-- em files (1.716 linhas) para os 25 usuários de user_roles, anon e um uid
-- inexistente: 0 divergências.
-- Medido (predicado novo embutido, mesmas linhas, md5 igual): entregas do
-- cliente 39ebda82 (dashboardHelpers) 126 -> 21 ms; arquivos liberados em 60
-- dias (AdminExperience): gerente 606 -> 1,6 ms, design 874 -> 1,6 ms,
-- cliente 463 -> 8 ms.
--
-- Idempotente (ALTER POLICY). Depende da 20260930296100 (ajudantes).
-- Não aplicar direto: o dono aplica na integração (SQL Editor).

SET LOCAL lock_timeout = '5s';

ALTER POLICY files_secure_select ON public.files
  USING (
    (
      (SELECT public.is_staff((SELECT auth.uid())))
      AND (
        (SELECT app_private.eh_admin_atual())
        OR (client_id = (SELECT auth.uid())
            AND (SELECT public.has_role((SELECT auth.uid()), 'client'::public.app_role)))
        OR client_id = ANY ((SELECT app_private.clientes_da_equipe_atual())::uuid[])
      )
    )
    OR (client_id = (SELECT auth.uid()) AND public.can_client_read_file(id))
  );

RESET lock_timeout;

-- Voltar atrás: ALTER POLICY files_secure_select ON public.files USING (public.can_read_file(id));
