import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 04/11/2026 (dono: "tentando reagendar esse vídeo e está com esse aviso; deixe fluido").
 * O banco comparava o post com o nome e a legenda do ARQUIVO; o vídeo da Mesa tem legenda só no post.
 */
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261104130000_reagendar_post_aprovado_sem_trava.sql"), "utf8");

describe("reagendar post aprovado", () => {
  it("post existente usa o próprio texto; o post novo segue nascendo do arquivo", () => {
    const doArquivo = sql.indexOf("_canonical_caption := NULLIF(btrim(_primary_file.caption), '');");
    const doPost = sql.indexOf("INTO _canonical_title, _canonical_objective, _canonical_caption, _canonical_content_type");
    expect(doArquivo).toBeGreaterThan(0);
    expect(doPost).toBeGreaterThan(doArquivo);
    expect(sql).toContain("IF _post_id IS NOT NULL THEN");
  });

  it("post mudado depois da aprovação continua recusado", () => {
    expect(sql).toContain("_post_internal.approval_fingerprint IS DISTINCT FROM");
    expect(sql).toContain("RAISE EXCEPTION 'approved editorial copy is immutable; create a revision';");
    expect(sql).toContain("_existing_post.production_status <> 'ready'");
  });

  it("reagendar não apaga o texto da publicação", () => {
    expect(sql).toContain("caption = COALESCE(_existing_publication.caption, _canonical_caption),");
    expect(sql).toContain("first_comment = _existing_publication.first_comment,");
    expect(sql).toContain("alt_text = _existing_publication.alt_text,");
  });

  it("é a função inteira, com delimitador que a CLI aplica", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.save_approved_editorial_post_unlocked(");
    expect(sql).not.toContain("$function$");
    expect(sql.trim().endsWith("$$;")).toBe(true);
  });
});
