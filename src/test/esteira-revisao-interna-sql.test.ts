import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A migration da fase 2 da Esteira, lida como texto: o que ela cria e, mais
 * importante, o que ela não pode fazer (aprovar pelo cliente, agendar,
 * publicar, mexer em outro cliente além da Softy).
 */

const sql = readFileSync("supabase/migrations/20261114210000_esteira_revisao_interna_e_modo_aprovacao.sql", "utf8");
/** Só o que executa: sem os comentários de linha. */
const codigo = sql.split("\n").filter((linha) => !linha.trim().startsWith("--")).join("\n");
const funcao = codigo.slice(codigo.indexOf("CREATE OR REPLACE FUNCTION public.revisar_trabalho_interno"), codigo.indexOf("$function$;"));

describe("migration: regra de aprovação do cliente no cadastro", () => {
  it("coluna com padrão portal, check de dois valores, comentário e leitura na lista de colunas", () => {
    expect(codigo).toContain("ADD COLUMN IF NOT EXISTS modo_aprovacao_do_cliente text NOT NULL DEFAULT 'portal'");
    expect(codigo).toContain("CHECK (modo_aprovacao_do_cliente IN ('portal', 'dispensada'))");
    expect(codigo).toContain("COMMENT ON COLUMN public.profiles.modo_aprovacao_do_cliente IS");
    expect(codigo).toContain("GRANT SELECT (modo_aprovacao_do_cliente) ON public.profiles TO authenticated;");
  });

  it("só a Softy Móveis vira dispensada: um único UPDATE, preso ao id dela", () => {
    const updatesDeCadastro = codigo.match(/UPDATE public\.profiles[\s\S]*?;/g) ?? [];
    expect(updatesDeCadastro).toHaveLength(1);
    expect(updatesDeCadastro[0]).toContain("SET modo_aprovacao_do_cliente = 'dispensada'");
    expect(updatesDeCadastro[0]).toContain("WHERE id = '3d08338c-0c3b-453f-a64f-79a55c5711e8'");
  });

  it("não afrouxa Auth nem RLS: nenhuma política, nenhum grant de escrita, nenhuma tabela nova", () => {
    expect(codigo).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY|DISABLE ROW LEVEL SECURITY/i);
    expect(codigo).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)/i);
    expect(codigo).not.toMatch(/CREATE TABLE|DROP TABLE|TRUNCATE|DELETE FROM/i);
    expect(codigo).not.toMatch(/\bauth\.users\b/);
  });
});

describe("migration: carimbo da revisão interna na peça", () => {
  it("colunas do carimbo em estudio_trabalhos, com check da decisão e comentários", () => {
    expect(codigo).toContain("ADD COLUMN IF NOT EXISTS revisado_por uuid REFERENCES public.profiles(id)");
    for (const coluna of ["revisado_em timestamptz", "revisao_decisao text", "revisao_nota text", "revisao_arquivo_id uuid"]) expect(codigo).toContain(`ADD COLUMN IF NOT EXISTS ${coluna}`);
    expect(codigo).toContain("CHECK (revisao_decisao IS NULL OR revisao_decisao IN ('aprovado', 'ajuste'))");
    for (const coluna of ["revisado_por", "revisado_em", "revisao_decisao", "revisao_nota", "revisao_arquivo_id"]) expect(codigo).toContain(`COMMENT ON COLUMN public.estudio_trabalhos.${coluna} IS`);
  });
});

describe("migration: revisar_trabalho_interno", () => {
  it("SECURITY DEFINER com search_path vazio, só para authenticated, sem anon", () => {
    expect(funcao).toContain("SECURITY DEFINER");
    expect(funcao).toContain("SET search_path TO ''");
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.revisar_trabalho_interno(uuid, text, text) FROM PUBLIC, anon;");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION public.revisar_trabalho_interno(uuid, text, text) TO authenticated;");
    expect(codigo).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.revisar_trabalho_interno[^;]*\banon\b/);
  });

  it("só a equipe autenticada, com acesso ao cliente; o ator é auth.uid()", () => {
    expect(funcao).toContain("_ator uuid := auth.uid();");
    expect(funcao).toContain("IF _ator IS NULL OR NOT (");
    for (const papel of ["admin", "manager", "design", "traffic"]) expect(funcao).toContain(`public.has_role(_ator, '${papel}'::public.app_role)`);
    expect(funcao).not.toContain("'client'::public.app_role");
    expect(funcao).toContain("NOT public.can_access_client(_t.client_id)");
    expect(funcao).toContain("revisado_por = _ator");
    expect(funcao).toContain("revisado_em = now()");
  });

  it("espelha o portão da agência pelas funções de sempre e nunca decide pelo cliente", () => {
    expect(funcao).toContain("PERFORM public.request_file_agency_review(_arquivo_id);");
    expect(funcao).toContain("PERFORM public.review_file_agency(");
    // O portão do arquivo só é decidido por quem já podia decidir (gestor do cliente).
    expect(funcao).toContain("_gestor := public.can_manage_client(_t.client_id);");
    expect(funcao).toMatch(/IF _gestor THEN\s+PERFORM public\.review_file_agency\(/);
    // Nada que seja do cliente, da agenda ou da publicação.
    for (const proibido of [
      "decide_file_approval", "aprovar_pelo_cliente", "record_offline_client_approval", "admin_release_file_now", "release_file",
      "client_approved", "client_rejected", "released_for_approval", "mesa_agendamento_fila", "editorial_publications", "editorial_posts",
      "INSERT INTO public.file_approval_events", "UPDATE public.files",
    ]) expect(funcao).not.toContain(proibido);
    expect(funcao).not.toMatch(/\bapproval_status\s*=/);
    // A única tabela que a função escreve direto é o carimbo da própria peça.
    expect(funcao.match(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+public\.\w+/g)).toEqual(["UPDATE public.estudio_trabalhos"]);
  });

  it("o modo dispensada só é informado na resposta: nenhuma decisão depende dele", () => {
    expect(funcao.match(/modo_aprovacao_do_cliente/g)).toHaveLength(2);
    expect(funcao).toContain("'modo_aprovacao_do_cliente', (");
    expect(funcao).not.toMatch(/IF[^;]*modo_aprovacao_do_cliente/);
    expect(funcao).not.toContain("dispensada");
  });

  it("recusa com erro claro o que não pode ser revisado e é idempotente para a mesma arte", () => {
    expect(funcao).toContain("IF _t.entrega_status IN ('aguardando_cliente', 'aprovado', 'agendado') THEN");
    expect(funcao).toContain("IF _t.status NOT IN ('pronto', 'entregue') THEN");
    expect(funcao).toContain("IF p_decisao = 'ajuste' AND COALESCE(length(_nota), 0) < 10 THEN");
    expect(funcao).toContain("AND _t.revisao_arquivo_id IS NOT DISTINCT FROM _arquivo_id THEN");
    expect(funcao).toContain("'ja_registrado', _repetido");
  });

  it("na repetição ainda tenta reconciliar o portão pendente da agência, sem regravar o carimbo", () => {
    const marca = funcao.indexOf("_repetido := true");
    const update = funcao.indexOf("UPDATE public.estudio_trabalhos");
    const fechaIdempotencia = funcao.indexOf("END IF;", update);
    const espelho = funcao.indexOf("PERFORM public.review_file_agency(");
    expect(marca).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThan(marca);
    expect(espelho).toBeGreaterThan(fechaIdempotencia);
    expect(sql).toContain("Esta reconciliação roda também na repetição");
  });
});
