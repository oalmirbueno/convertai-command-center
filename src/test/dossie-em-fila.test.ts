import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 2026-09-21: agendar um post no calendário estourava "statement timeout".
 * O gatilho reescrevia o dossiê dentro da transação de quem agendava e o
 * cron de 15 min segurava o lock dos 19 dossiês por até 22 s. Regras:
 * gatilho só enfileira; a fila é processada por minuto, poucos por vez,
 * depois de 90 s sem movimento novo; a leitura de movimentos só calcula
 * rótulo dos arquivos do período; e "o que é aquele arquivo" ganha um
 * julgamento tipado (TypeSafe/Jev) gravado como dado.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const migracao = ler("supabase/migrations/20260921120000_dossie_em_fila_sem_travar.sql");
const funcao = ler("supabase/functions/materiais-classificar/index.ts");

describe("o dossiê acompanha o movimento sem travar quem trabalha", () => {
  it("gatilhos só enfileiram; nada reescreve o dossiê na transação de quem agenda ou aprova", () => {
    expect(migracao).toContain("CREATE TABLE IF NOT EXISTS app_private.dossie_fila (");
    expect(migracao).toContain("PERFORM public.dossie_enfileirar(_client, TG_TABLE_NAME);");
    expect(migracao).toContain("PERFORM public.dossie_enfileirar(_client, 'tasks');");
    expect(migracao).toContain("CREATE TRIGGER movimento_atualiza_dossie AFTER INSERT ON public.files");
    // Só o processador e a varredura chamam a reescrita.
    const chamadas = migracao.split("dossie_registrar_avancos_interno(").length - 1;
    expect(chamadas).toBe(1);
    expect(migracao).not.toContain("PERFORM public.dossie_registrar_avancos(_client);");
  });

  it("a fila roda por minuto, poucos por vez, só depois de 90 s de calmaria, e tolera erro sem loop", () => {
    expect(migracao).toContain("_max integer DEFAULT 5, _quieto interval DEFAULT interval '90 seconds'");
    expect(migracao).toContain("FOR UPDATE SKIP LOCKED");
    expect(migracao).toContain("SET tentativas = tentativas + 1, ultimo_erro = left(SQLERRM, 300)");
    expect(migracao).toContain("f.tentativas < 5");
    expect(migracao).toContain("cron.schedule('dossie-fila-1min', '* * * * *', $cron$select public.dossie_processar_fila(5);$cron$)");
    expect(migracao).toContain("WHERE jobname IN ('dossie-movimentos-15min', 'dossie-fila-1min', 'materiais-classificar-30min')");
    // A varredura de sexta passa a só enfileirar.
    expect(migracao).toContain("PERFORM public.dossie_enfileirar(_c.client_id, 'varredura');");
  });

  it("a leitura de movimentos calcula rótulo só dos arquivos do período e ganha índices", () => {
    expect(migracao).toContain("capa_base AS (");
    expect(migracao).toContain("OR f.id IN (SELECT e.file_id FROM eventos e))");
    expect(migracao).toContain("WHERE c.parent_file_id IN (SELECT b.id FROM capa_base b)");
    for (const idx of ["file_approval_events_client_created_idx", "client_requests_client_created_idx", "tasks_project_status_idx", "files_client_capa_created_idx"]) {
      expect(migracao).toContain(`CREATE INDEX IF NOT EXISTS ${idx}`);
    }
  });
});

describe("TypeSafe (Jev) decide o que é o material e o resultado vira dado", () => {
  it("uma Choice por arquivo, na taxonomia do painel, com corte de confiança e limite de tentativas", () => {
    expect(funcao).toContain('const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";');
    expect(funcao).toContain('const MODELO = "jev-latest";');
    expect(funcao).toContain("const CORTE_DE_CONFIANCA = 0.6;");
    expect(funcao).toContain("const MAX_TENTATIVAS = 3;");
    expect(funcao).toContain('type: "choice"');
    for (const tipo of ["carrossel", "post", "story", "video", "logo", "foto", "documento", "contrato", "relatorio", "estrategico", "briefing", "outro"]) {
      expect(funcao).toContain(`  ${tipo}: "`);
    }
    expect(funcao).toContain('j.tipo !== "outro" && j.confianca >= CORTE_DE_CONFIANCA');
    expect(funcao).toContain("if (gravar) patch.file_type = j.tipo;");
  });

  it("sem chave não muda nada; cron e equipe autorizam; a chave fica no servidor", () => {
    expect(funcao).toContain('if (!chave) return json({ ok: true, skipped: "sem TYPESAFE_API_KEY" });');
    expect(funcao).toContain('req.headers.get("x-cron-secret")?.trim() === cronSecret');
    expect(funcao).toContain('admin.rpc("is_staff", { _user_id: user.user.id })');
    expect(migracao).toContain("cron.schedule('materiais-classificar-30min', '*/30 * * * *'");
    expect(ler("src/lib/movimentos.ts")).not.toContain("typesafe");
  });
});

describe("o cliente nunca escolhe ver o histórico interno (auditoria 2026-09-21)", () => {
  const guarda = ler("supabase/migrations/20260921130000_movimentos_do_cliente_sem_vazar_interno.sql");
  it("a leitura completa mora em app_private e a porta pública força só visível para o próprio cliente", () => {
    expect(guarda).toContain("SET SCHEMA app_private;");
    expect(guarda).toContain("ELSIF NOT coalesce(public.is_staff(auth.uid()), false) THEN");
    expect(guarda).toContain("_so_visiveis := true;");
    expect(guarda).toContain("RETURN QUERY SELECT * FROM app_private.movimentos_do_cliente_bruto(_client_id, _desde, _ate, _so_visiveis);");
    expect(guarda).toContain("REVOKE EXECUTE ON FUNCTION public.dossie_avancos_texto(uuid, integer) FROM PUBLIC, anon, authenticated;");
  });
});
