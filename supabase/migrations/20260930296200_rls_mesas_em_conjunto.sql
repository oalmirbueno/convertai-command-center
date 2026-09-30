-- Frente PERF-banco (30/09/2026), achado B03: RLS por cliente das mesas em
-- forma de conjunto, e auth.uid() em InitPlan em todas as políticas do public.
--
-- O problema:
--   * 131 políticas (96 tabelas: mesas, IA, métricas, aprovações...) têm a
--     forma is_staff(auth.uid()) AND can_access_client(client_id). O
--     can_access_client roda uma vez por LINHA (até 9 has_role e um EXISTS).
--     social_post_metrics lida inteira: admin 457 ms, gerente 1.098 ms.
--   * 203 políticas do public chamam auth.uid()/auth.role() sem (SELECT ...):
--     o JWT é lido e convertido uma vez por linha (advisor auth_rls_initplan).
--
-- A correção, em duas partes, sem mudar quem vê o quê:
--   1) Com os ajudantes definer criados na 20260930296100 (calculados uma vez
--      por consulta, em InitPlan):
--        app_private.eh_admin_atual()           = has_role(auth.uid(), 'admin')
--        app_private.clientes_da_equipe_atual() = client_id das atribuições da
--          pessoa quando ela é manager, design ou traffic (senão, vazio)
--      "is_staff(uid) AND can_access_client(client_id)" vira
--        (SELECT is_staff(uid)) AND ((SELECT eh_admin) OR
--          (client_id = uid AND (SELECT has_role(uid,'client'))) OR
--          client_id = ANY((SELECT clientes_da_equipe)::uuid[]))
--      que é can_access_client escrito em conjunto, inclusive com client_id
--      nulo ou órfão (o admin continua vendo). O ::uuid[] é obrigatório: sem
--      ele o Postgres lê ANY(subconsulta) e compara uuid com uuid[].
--   2) Em toda política do public, auth.uid() e auth.role() viram
--      ( SELECT auth.uid() ) e ( SELECT auth.role() ): mesmo valor, lido uma
--      vez por consulta. realtime.messages fica de fora.
--
-- Só troca o TEXTO EXATO do padrão (USING e WITH CHECK). Políticas de formato
-- próprio (file_content_chunks, file_processing_jobs, file_approval_events,
-- workspace_nodes, roteiro_modelos, as de "client_id IS NULL OR ..." e as
-- editorial_*) ficam como estão nesta leva (só ganham o item 2). Expressão com
-- NOT não recebe o item 1. Nome, comando, papéis e tipo de cada política
-- ficam iguais: ALTER POLICY só troca a expressão.
--
-- A troca é feita lendo pg_policy NA HORA de aplicar (texto com esquema, via
-- search_path vazio): se outra frente mexer numa política antes, a mudança
-- dela é preservada e só o padrão é trocado. Rodar de novo não muda nada.
--
-- Conferido em 30/09, só leitura (transação read only, a MESMA troca de texto
-- deste bloco feita em memória, sem ALTER):
--   * 317 políticas mudam (as 203 do advisor + 114 do padrão que já tinham o
--     auth.uid() embrulhado); 152 expressões ganham a forma de conjunto;
--   * os 213 textos finais sem ajudante são SQL válido na própria tabela;
--   * antiga × nova linha a linha, 1.186 comparações (admin, gerente, design,
--     cliente e uid inexistente nas de conjunto; gerente e cliente nas demais):
--     0 divergências;
--   * can_access_client × forma de conjunto para os 25 usuários, anon e um
--     uid inexistente, contra todo client_id existente e nulo: 0 divergências.
-- Medido (predicado novo embutido, mesmas linhas, md5 igual):
-- social_post_metrics inteira: admin 451 -> 1,6 ms; gerente 1.095 -> 2,3 ms;
-- design 1.438 -> 1,9 ms; cliente 48 -> 1,3 ms.
-- Roteiro de conferência periódica: scripts/conferir-rls-por-linha.sql.
--
-- can_access_client continua intacta como fonte de verdade das RPCs.
-- Depende da 20260930296100 (ajudantes). Idempotente.
-- Não aplicar direto: o dono aplica na integração (SQL Editor).

SET LOCAL lock_timeout = '5s';

-- ─── Reescrita das políticas ────────────────────────────────────────

DO $rls$
DECLARE
  -- Forma com que o Postgres devolve (SELECT auth.uid()) já embrulhado.
  _uid  CONSTANT text := '( SELECT auth.uid() AS uid)';
  _role CONSTANT text := '( SELECT auth.role() AS role)';
  -- Padrões exatos (texto de pg_get_expr com search_path vazio, depois do
  -- embrulho de auth.uid()).
  _antigos CONSTANT text[] := ARRAY[
    'public.is_staff(( SELECT auth.uid() AS uid)) AND public.can_access_client(client_id)',
    'COALESCE(public.is_staff(( SELECT auth.uid() AS uid)), false) AND public.can_access_client(client_id)'
  ];
  _novo CONSTANT text :=
    '((SELECT public.is_staff((SELECT auth.uid()))) AND ('
    || '(SELECT app_private.eh_admin_atual())'
    || ' OR ((client_id = (SELECT auth.uid())) AND (SELECT public.has_role((SELECT auth.uid()), ''client''::public.app_role)))'
    || ' OR (client_id = ANY ((SELECT app_private.clientes_da_equipe_atual())::uuid[]))))';
  _r record;
  _expr text[];
  _novas text[];
  _e text;
  _antigo text;
  _i int;
  _sql text;
  _alteradas int := 0;
  _em_conjunto int := 0;
  _search_path CONSTANT text := current_setting('search_path');
BEGIN
  -- Texto sempre com esquema: o mesmo que for lido é o que volta a ser lido.
  -- (Volta ao search_path de antes no fim do bloco.)
  PERFORM set_config('search_path', '', true);

  FOR _r IN
    SELECT n.nspname, c.relname, pol.polname,
           pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS q,
           pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS c
      FROM pg_catalog.pg_policy AS pol
      JOIN pg_catalog.pg_class AS c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
     ORDER BY c.relname, pol.polname
  LOOP
    _expr := ARRAY[_r.q, _r.c];
    _novas := ARRAY[_r.q, _r.c];
    FOR _i IN 1..2 LOOP
      _e := _expr[_i];
      CONTINUE WHEN _e IS NULL;

      -- 2a) auth.uid() / auth.role() em InitPlan (o que já está embrulhado
      --     é protegido antes e devolvido depois).
      _e := replace(_e, _uid, chr(1));
      _e := replace(_e, 'auth.uid()', _uid);
      _e := replace(_e, chr(1), _uid);
      _e := replace(_e, _role, chr(2));
      _e := replace(_e, 'auth.role()', _role);
      _e := replace(_e, chr(2), _role);

      -- 2b) is_staff AND can_access_client(client_id) em forma de conjunto.
      IF position('(NOT ' IN _e) = 0 THEN
        FOREACH _antigo IN ARRAY _antigos LOOP
          IF position(_antigo IN _e) > 0 THEN
            _e := replace(_e, _antigo, _novo);
            _em_conjunto := _em_conjunto + 1;
          END IF;
        END LOOP;
      END IF;

      _novas[_i] := _e;
    END LOOP;

    CONTINUE WHEN _novas[1] IS NOT DISTINCT FROM _r.q
              AND _novas[2] IS NOT DISTINCT FROM _r.c;

    _sql := format('ALTER POLICY %I ON %I.%I', _r.polname, _r.nspname, _r.relname);
    IF _novas[1] IS DISTINCT FROM _r.q THEN
      _sql := _sql || ' USING (' || _novas[1] || ')';
    END IF;
    IF _novas[2] IS DISTINCT FROM _r.c THEN
      _sql := _sql || ' WITH CHECK (' || _novas[2] || ')';
    END IF;
    EXECUTE _sql;
    _alteradas := _alteradas + 1;
  END LOOP;

  PERFORM set_config('search_path', _search_path, true);
  RAISE NOTICE 'rls em conjunto: % politicas alteradas, % expressoes com can_access_client em conjunto',
    _alteradas, _em_conjunto;
END
$rls$;

RESET lock_timeout;

-- Conferência depois de aplicar (só leitura):
-- 1) nenhuma política do public com auth.uid() fora de (SELECT ...) (esperado 0):
--    select count(*) from pg_policies where schemaname = 'public'
--      and (replace(qual, '( SELECT auth.uid() AS uid)', '') like '%auth.uid()%'
--        or replace(with_check, '( SELECT auth.uid() AS uid)', '') like '%auth.uid()%');
-- 2) o padrão antigo sumiu (esperado 0):
--    select count(*) from pg_policies where schemaname = 'public'
--      and (qual like '%is_staff(( SELECT auth.uid() AS uid)) AND can_access_client(client_id)%'
--        or with_check like '%is_staff(( SELECT auth.uid() AS uid)) AND can_access_client(client_id)%');
-- 3) get_advisors performance: auth_rls_initplan só com realtime.messages.
-- Roteiro completo de equivalência: scripts/conferir-rls-por-linha.sql.
