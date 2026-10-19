import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATES_OFICIAIS } from "../../supabase/functions/laboratorio/modulos/templates";
import { errosDoCanvas, normalizarCanvas, TIPOS_DE_NO } from "../../supabase/functions/laboratorio/modulos/regras";

/**
 * Laboratório (19/10/2026): contrato do banco e da função de borda com a tela
 * (Aceleriq-Laboratorio/ESPEC-LABORATORIO.md). Confere tabelas, RLS só equipe, a origem do Estúdio,
 * 'laboratorio' em ia_usos.tarefa, os 6 templates semeados, manifesto/baseline e as ações da função.
 */
const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const NOME = "20261019180000_laboratorio.sql";
const CAMINHO = `supabase/migrations/${NOME}`;
const sql = ler(CAMINHO);
const semComentario = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const ACOES_DO_CONTRATO = [
  "projetos_listar", "projeto_criar", "projeto_ler", "projeto_salvar", "projeto_arquivar",
  "templates_listar", "template_usar", "template_salvar",
  "estimar", "no_executar", "rodar_tudo", "execucoes_ler",
  "planejar", "logo_gerar", "pedido_inicio",
];

describe("laboratorio: migration", () => {
  it("cria as três tabelas com as colunas do contrato", () => {
    for (const trecho of [
      "CREATE TABLE IF NOT EXISTS public.lab_projetos",
      "client_id uuid REFERENCES public.profiles(id)",
      "canvas jsonb NOT NULL",
      "versao integer NOT NULL DEFAULT 1",
      "status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'arquivado'))",
      "template_de uuid",
      "jsonb_array_length(COALESCE(canvas -> 'nos', '[]'::jsonb)) <= 80",
      "jsonb_array_length(COALESCE(canvas -> 'ligacoes', '[]'::jsonb)) <= 160",
      "CREATE TABLE IF NOT EXISTS public.lab_execucoes",
      "projeto_id uuid NOT NULL REFERENCES public.lab_projetos(id) ON DELETE CASCADE",
      "no_id text NOT NULL",
      "status text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'rodando', 'pronto', 'erro', 'aguardando'))",
      "entrada jsonb", "saida jsonb", "custo_usd numeric", "uso_id uuid", "erro text", "operador_slug text", "rodada_id uuid", "finished_at timestamptz",
      "CREATE TABLE IF NOT EXISTS public.lab_templates",
      "oficial boolean NOT NULL DEFAULT false",
    ]) {
      expect(semComentario, trecho).toContain(trecho);
    }
    // Os tipos de execução são os tipos de nó da especificação.
    const tipos = /tipo text NOT NULL CHECK \(tipo IN \(([^)]*)\)\)/.exec(semComentario)![1].split(",").map((t) => t.trim().replace(/'/g, ""));
    expect(tipos).toEqual([...TIPOS_DE_NO]);
  });

  it("RLS ligada; equipe só lê (is_staff e acesso ao cliente); escrita só pela função", () => {
    for (const t of ["lab_projetos", "lab_execucoes", "lab_templates"]) {
      expect(semComentario).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(semComentario).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(semComentario).toContain(`GRANT SELECT ON public.${t} TO authenticated;`);
      expect(semComentario).toContain(`GRANT ALL ON public.${t} TO service_role;`);
      expect(semComentario).not.toMatch(new RegExp(`CREATE POLICY[^;]*ON public\\.${t}\\s+FOR (INSERT|UPDATE|DELETE|ALL)`));
    }
    const politica = semComentario.slice(semComentario.indexOf("CREATE POLICY lab_projetos_equipe_le"));
    expect(politica).toMatch(/FOR SELECT TO authenticated/);
    expect(politica).toContain("public.is_staff((select auth.uid()))");
    expect(politica).toContain("client_id IS NULL OR COALESCE(public.can_access_client(client_id), false)");
  });

  it("estudio_trabalhos.origem nasce 'mesa' e aceita só mesa e laboratorio", () => {
    expect(semComentario).toContain("ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'mesa'");
    expect(semComentario).toContain("CHECK (origem IN ('mesa', 'laboratorio'))");
  });

  it("ia_usos.tarefa aceita 'laboratorio' sem estreitar a lista (padrão da 20260930320200)", () => {
    expect(semComentario).toContain("('ia_usos', 'tarefa', 'ia_usos_tarefa_check')");
    expect(semComentario).toContain("ARRAY['laboratorio']");
    expect(semComentario).toContain("laboratorio(''|\\}|,)");
  });

  it("semeia os 6 templates oficiais iguais ao módulo da função, todos válidos", () => {
    expect(TEMPLATES_OFICIAIS.map((t) => t.nome)).toEqual(["Carrossel", "Criativos de anúncio", "Logo", "Landing page", "Post + legenda", "Variação de criativos"]);
    const semente = semComentario.slice(semComentario.indexOf("INSERT INTO public.lab_templates"));
    expect(semente).toContain("ON CONFLICT (id) DO UPDATE");
    for (const t of TEMPLATES_OFICIAIS) {
      const canvasSql = `'${JSON.stringify(t.canvas).replace(/'/g, "''")}'::jsonb, true)`;
      expect(semente, t.nome).toContain(`('${t.id}'::uuid, '${t.nome}'`);
      expect(semente, t.nome).toContain(canvasSql);
      expect(errosDoCanvas(normalizarCanvas(t.canvas)), t.nome).toEqual([]);
    }
  });

  it("está no manifesto e na baseline de produção com o hash do arquivo", () => {
    const hash = createHash("sha256").update(sql, "utf8").digest("hex");
    expect(ler("supabase/migration-manifest.sha256")).toContain(`${hash}  ${CAMINHO}`);
    const baseline = JSON.parse(ler("supabase/production-migration-baseline.json")) as { forward_migrations: Array<{ version: string; path: string; local_sha256: string; remote_name: string; remote_hash_mode: string }> };
    const entrada = baseline.forward_migrations.find((m) => m.path === CAMINHO);
    expect(entrada).toBeTruthy();
    expect(entrada!.version).toBe("20261019180000");
    expect(entrada!.local_sha256).toBe(hash);
    expect(entrada!.remote_name).toBe("laboratorio");
    expect(entrada!.remote_hash_mode).toBe("supabase_cli_split");
  });
});

describe("laboratorio: função de borda", () => {
  const acoes = ler("supabase/functions/laboratorio/acoes.ts");
  const mapa = acoes.slice(acoes.indexOf("export const ACOES: Record<string, Acao> = {"));
  const corpo = mapa.slice(0, mapa.indexOf("};"));

  it("exporta todas as ações do contrato (e só elas)", () => {
    const chaves = corpo
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/[:,].*$/, ""));
    expect(chaves.sort()).toEqual([...ACOES_DO_CONTRATO].sort());
  });

  it("index usa o mapa de ações, lê o JWT e exige admin, manager ou design", () => {
    const index = ler("supabase/functions/laboratorio/index.ts");
    expect(index).toContain('import { ACOES, ACOES_LONGAS } from "./acoes.ts";');
    const comum = ler("supabase/functions/laboratorio/comum.ts");
    expect(comum).toContain('export const PAPEIS_DO_LABORATORIO = ["admin", "manager", "design"];');
    expect(comum).toContain("auth.getUser(token)");
    expect(comum).toContain('export const TAREFA = "laboratorio"');
    expect(ler("supabase/config.toml")).toContain("[functions.laboratorio]\n    verify_jwt = true");
  });

  it("gerar só com confirmação; anúncio nunca publica; agente externo vai pela fila do operador", () => {
    expect(acoes).toContain('"confirmacao_necessaria"');
    const executar = ler("supabase/functions/laboratorio/executar.ts");
    expect(executar).toContain('status: "pausado"');
    expect(executar).toContain("publicado: false");
    expect(executar).not.toMatch(/graph\.facebook\.com|meta_create_ad|\/ads\b/);
    expect(executar).toContain('db.rpc("operator_assign_task"');
    expect(executar).toContain("OPERADOR_HERMES");
  });
});
