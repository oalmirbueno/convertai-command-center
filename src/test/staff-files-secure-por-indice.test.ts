import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EX-04 (30/09): staff_files_secure deixa de ler de uma função SECURITY
 * DEFINER (que percorria files inteira antes do filtro) e passa a ler de uma
 * view privada com security_barrier, que usa os índices. A regra de acesso é
 * a mesma (conferido no banco, só leitura: count e md5 iguais para admin,
 * gerente, design e cliente). Este teste trava o formato da migration.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const nova = ler("supabase/migrations/20260930296000_staff_files_secure_por_indice.sql");
const antiga = ler("supabase/migrations/20260809040741_0b76125d-0af9-4129-9310-c1988a116141.sql");

const semComentarios = (sql: string) => sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const colunas = (sql: string) => {
  const ini = sql.indexOf("CREATE OR REPLACE VIEW public.staff_files_secure");
  const fim = sql.indexOf("FROM app_private.", ini);
  return (sql.slice(ini, fim).match(/file_row\.[a-z_]+|AS [a-z_]+/g) || []).join(",");
};

describe("staff_files_secure pelo índice", () => {
  const sql = semComentarios(nova);

  it("a fonte é a view privada, dona postgres, com barreira e sem security_invoker (lê files como a função fazia)", () => {
    expect(sql).toContain("CREATE OR REPLACE VIEW app_private.staff_files_rows\nWITH (security_barrier = true) AS");
    expect(sql).toContain("ALTER VIEW app_private.staff_files_rows OWNER TO postgres;");
    expect(sql).toContain("FROM app_private.staff_files_rows file_row");
    expect(sql).not.toContain("staff_files_secure_rows()");
  });

  it("a view privada só abre para authenticated e service_role, nunca para anon", () => {
    expect(sql).toContain("REVOKE ALL ON TABLE app_private.staff_files_rows FROM PUBLIC;");
    expect(sql).toContain("REVOKE ALL ON TABLE app_private.staff_files_rows FROM anon;");
    expect(sql).toContain("GRANT SELECT ON TABLE app_private.staff_files_rows TO authenticated;");
    expect(sql).not.toMatch(/GRANT [A-Z ,]+ ON TABLE app_private\.staff_files_rows TO anon/);
    expect(sql).not.toMatch(/GRANT USAGE ON SCHEMA app_private/);
  });

  it("a regra continua nos dois lugares: equipe e can_access_client (uma vez por cliente), com o atalho do admin", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE VIEW app_private.staff_clientes_acessiveis\nWITH (security_barrier = true) AS\n  SELECT p.id\n  FROM public.profiles AS p\n  WHERE public.can_access_client(p.id);",
    );
    expect(sql).toContain("ALTER VIEW app_private.staff_clientes_acessiveis OWNER TO postgres;");
    expect(sql).toContain("REVOKE ALL ON TABLE app_private.staff_clientes_acessiveis FROM anon;");
    expect(sql).not.toMatch(/GRANT [A-Z ,]+ ON TABLE app_private\.staff_clientes_acessiveis TO anon/);
    const equipe = "(SELECT public.is_staff((SELECT auth.uid())))\n    AND (\n      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))\n      OR ";
    expect(sql.split(equipe).length - 1).toBe(2);
    expect(sql).toContain("OR f.client_id IN (SELECT a.id FROM app_private.staff_clientes_acessiveis AS a)");
    expect(sql).toContain("OR file_row.client_id IN (SELECT a.id FROM app_private.staff_clientes_acessiveis AS a)");
  });

  it("a view pública continua security_invoker, com as mesmas colunas na mesma ordem e os mesmos privilégios", () => {
    expect(sql).toContain("CREATE OR REPLACE VIEW public.staff_files_secure\nWITH (security_barrier = true, security_invoker = true) AS");
    expect(colunas(sql)).toBe(colunas(antiga));
    expect(colunas(sql).split(",").length).toBe(49);
    expect(sql).toContain("REVOKE ALL ON TABLE public.staff_files_secure FROM anon;");
    expect(sql).toContain("GRANT SELECT ON TABLE public.staff_files_secure TO authenticated;");
  });

  it("idempotente e sem CONCURRENTLY", () => {
    expect(sql).not.toMatch(/CONCURRENTLY/i);
    expect(sql).not.toMatch(/^\s*CREATE VIEW/m);
    expect(sql).not.toMatch(/DROP /);
  });
});
