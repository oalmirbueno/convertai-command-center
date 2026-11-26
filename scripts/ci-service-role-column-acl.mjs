// Column-level privileges of service_role on fixed tables in the disposable CI stack.
//
// Why: in PostgreSQL, `REVOKE SELECT ON TABLE t FROM r` also revokes SELECT from r on every
// column of t. A harness that temporarily adds a table-level SELECT and revokes it afterwards
// therefore erases tracked column grants, e.g. `GRANT SELECT (slug, status) ON
// public.internal_operators TO service_role` (20261125202100_mcp_project_grants.sql). A table-only
// probe (has_table_privilege) cannot see that loss. Callers snapshot the column ACL before the
// temporary GRANT, re-grant exactly the SELECT entries the REVOKE removed, and require the final
// snapshot to equal the first one. Catalog identifiers only; never input-derived, never printed.

const TABLE = /^public\.[a-z_][a-z0-9_]{0,62}$/;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']);

function checkTables(tables) {
  if (!Array.isArray(tables) || tables.length === 0 || tables.some((t) => !TABLE.test(t)) || new Set(tables).size !== tables.length) {
    throw new Error('column privilege probe: unexpected table list.');
  }
}

/** One line: `public.t|column|PRIVILEGE|grantable|grantor` entries joined by commas, sorted. */
export function columnAclProbe(tables) {
  checkTables(tables);
  return `SELECT coalesce(string_agg(format('%I.%I|%I|%s|%s|%I', n.nspname, c.relname, a.attname, x.privilege_type,
    x.is_grantable::text, g.rolname), ',' ORDER BY n.nspname, c.relname, a.attname, x.privilege_type, g.rolname, x.is_grantable), '')
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
  JOIN pg_catalog.pg_roles g ON g.oid = x.grantor
  WHERE a.attrelid = ANY (ARRAY[${tables.map((t) => "'" + t + "'").join(', ')}]::regclass[])
    AND a.attnum > 0 AND NOT a.attisdropped
    AND x.grantee = 'service_role'::regrole;`;
}

/** Returns the parsed entries, or null when the output is not exactly the expected shape. */
export function parseColumnAcl(text, tables) {
  checkTables(tables);
  const raw = String(text).trim();
  if (raw === '') return [];
  const entries = [];
  for (const entry of raw.split(',')) {
    const parts = entry.split('|');
    if (parts.length !== 5) return null;
    const [table, column, privilege, grantable, grantor] = parts;
    if (!tables.includes(table) || !IDENT.test(column) || !PRIVILEGES.has(privilege) ||
        !/^(true|false)$/.test(grantable) || !IDENT.test(grantor)) return null;
    entries.push({ table, column, privilege, grantable: grantable === 'true', grantor });
  }
  const keys = entries.map(columnAclKey);
  if (new Set(keys).size !== keys.length) return null;
  return entries;
}

export function columnAclKey(e) {
  return [e.table, e.column, e.privilege, e.grantable, e.grantor].join('|');
}

export function sameColumnAcl(a, b) {
  const left = a.map(columnAclKey).sort();
  const right = b.map(columnAclKey).sort();
  return left.length === right.length && left.every((key, i) => key === right[i]);
}

/**
 * GRANT statements for the SELECT column entries of `tables` present in `before` and missing in
 * `after` (what a table-level REVOKE SELECT removed). Same grantable flag as the original entry.
 */
export function columnSelectRegrants(before, after, tables) {
  checkTables(tables);
  const present = new Set(after.map(columnAclKey));
  const groups = new Map();
  for (const e of before) {
    if (e.privilege !== 'SELECT' || !tables.includes(e.table) || present.has(columnAclKey(e))) continue;
    if (!TABLE.test(e.table) || !IDENT.test(e.column)) throw new Error('column privilege restore: unexpected identifier.');
    const group = e.table + '|' + e.grantable;
    if (!groups.has(group)) groups.set(group, { table: e.table, grantable: e.grantable, columns: new Set() });
    groups.get(group).columns.add(e.column);
  }
  return [...groups.values()].map(({ table, grantable, columns }) =>
    `GRANT SELECT (${[...columns].sort().map((c) => '"' + c + '"').join(', ')}) ON TABLE ${table} TO service_role` +
    (grantable ? ' WITH GRANT OPTION;' : ';'));
}

/** Offline checks shared by both harness self-tests. Throws on any drift. */
export function selfTestColumnAcl() {
  const tables = ['public.internal_operators', 'public.tasks'];
  const probe = columnAclProbe(tables);
  if (!probe.includes("x.grantee = 'service_role'::regrole") || !probe.includes('aclexplode(a.attacl)') ||
      !probe.includes("ARRAY['public.internal_operators', 'public.tasks']::regclass[]")) {
    throw new Error('column privilege probe drifted.');
  }
  for (const bad of [[], ['internal_operators'], ["public.x'; DROP"], ['public.a', 'public.a']]) {
    let threw = false;
    try { columnAclProbe(bad); } catch { threw = true; }
    if (!threw) throw new Error('column privilege probe accepted a bad table list.');
  }
  const migration = 'public.internal_operators|slug|SELECT|false|postgres,public.internal_operators|status|SELECT|false|postgres';
  const before = parseColumnAcl(migration, tables);
  if (before?.length !== 2) throw new Error('column privilege parser rejected the migration grant.');
  if (parseColumnAcl('', tables)?.length !== 0) throw new Error('column privilege parser rejected an empty ACL.');
  for (const bad of ['public.api_keys|id|SELECT|false|postgres', 'public.tasks|id|SELECT|false', 'public.tasks|Id|SELECT|false|postgres',
    'public.tasks|id|DELETE|false|postgres', 'public.tasks|id|SELECT|yes|postgres', 'public.tasks|"x"|SELECT|false|postgres',
    'public.tasks|id|SELECT|false|postgres,public.tasks|id|SELECT|false|postgres', 'ERROR']) {
    if (parseColumnAcl(bad, tables) !== null) throw new Error('column privilege parser accepted unexpected output.');
  }
  // What the table-level REVOKE does to the tracked column grant, and its exact restoration.
  const regrants = columnSelectRegrants(before, [], tables);
  if (regrants.length !== 1 || regrants[0] !== 'GRANT SELECT ("slug", "status") ON TABLE public.internal_operators TO service_role;') {
    throw new Error('column privilege restore drifted.');
  }
  if (columnSelectRegrants(before, before, tables).length !== 0) throw new Error('column privilege restore re-granted present entries.');
  if (columnSelectRegrants(before, [], ['public.tasks']).length !== 0) throw new Error('column privilege restore crossed tables.');
  const withOption = parseColumnAcl('public.tasks|id|SELECT|true|postgres,public.tasks|title|UPDATE|false|postgres', tables);
  const optionRegrants = columnSelectRegrants(withOption, [], tables);
  if (optionRegrants.length !== 1 || !optionRegrants[0].endsWith('("id") ON TABLE public.tasks TO service_role WITH GRANT OPTION;')) {
    throw new Error('column privilege restore lost the grant option or touched a non-SELECT privilege.');
  }
  if (!sameColumnAcl(before, [...before].reverse()) || sameColumnAcl(before, before.slice(1)) ||
      sameColumnAcl(before, [{ ...before[0], grantor: 'supabase_admin' }, before[1]])) {
    throw new Error('column privilege comparison drifted.');
  }
}
