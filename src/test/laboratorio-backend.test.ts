import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATES_OFICIAIS, TEMPLATES_OFICIAIS_V2, TEMPLATES_OFICIAIS_V3 } from "../../supabase/functions/laboratorio/modulos/templates";
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
  // v2 (ESPEC-LABORATORIO-v2.md)
  "filme_escolher", "no_acompanhar",
  // v3 (clickmax-rea.md): perguntas guiadas e a regra contra invenção
  "perguntas_do_pedido", "bloco_resolver",
  // 21/10: excluir projeto (execuções e projeto; os arquivos ficam)
  "projeto_excluir",
  // 20/10: créditos do Laboratório (carteira própria)
  "creditos", "creditos_carregar", "creditos_limite",
  // 20/10: nós inteligentes (inteligencia.ts)
  "fontes_do_cliente", "no_preencher", "ler_documento", "projeto_config",
  // 20/10: motor da casa (salvar, ajustar e variar a imagem do nó)
  "salvar_nos_arquivos", "no_ajustar", "no_variar",
  // Continuidade da confirmação original e fontes nativas, sem publicação ou licença automática.
  "rodada_cancelar", "conexoes_da_casa",
];

/** Os tipos de nó da v1 (o CHECK da 20261019180000); a v2 amplia na 20261019233000. */
const TIPOS_DA_V1 = ["contexto", "midia", "config", "gravity", "agente", "copy", "imagem", "carrossel", "logo", "landing", "anuncio", "agente_externo"];

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
    // Os tipos de execução da v1 (a v2 amplia o CHECK na migration nova).
    const tipos = /tipo text NOT NULL CHECK \(tipo IN \(([^)]*)\)\)/.exec(semComentario)![1].split(",").map((t) => t.trim().replace(/'/g, ""));
    expect(tipos).toEqual(TIPOS_DA_V1);
    expect(TIPOS_DE_NO.slice(0, TIPOS_DA_V1.length)).toEqual(TIPOS_DA_V1);
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

/**
 * Laboratório v2 (Aceleriq-Laboratorio/ESPEC-LABORATORIO-v2.md): a migration 20261019233000 amplia o CHECK
 * dos tipos, semeia os 4 templates novos e liga o Pôr no ar ao mecanismo de aprovações dos operadores.
 */
describe("laboratorio v2: migration", () => {
  const NOME_V2 = "20261019233000_laboratorio_v2.sql";
  const CAMINHO_V2 = `supabase/migrations/${NOME_V2}`;
  const sqlV2 = ler(CAMINHO_V2);
  const v2 = sqlV2.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("é a última migration e vem depois da do Laboratório (sem colisão de timestamp)", () => {
    const todas = readdirSync(resolve(raiz, "supabase/migrations")).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
    expect(todas.filter((f) => f.slice(0, 14) === NOME_V2.slice(0, 14))).toEqual([NOME_V2]);
    expect(todas.indexOf(NOME_V2)).toBeGreaterThan(todas.indexOf(NOME));
  });

  it("o CHECK de lab_execucoes.tipo passa a ter exatamente os tipos de nó da função (com os 5 novos)", () => {
    expect(v2).toContain("ALTER TABLE public.lab_execucoes DROP CONSTRAINT IF EXISTS lab_execucoes_tipo_check;");
    const tipos = /ADD CONSTRAINT lab_execucoes_tipo_check CHECK \(tipo IN \(([^)]*)\)\)/.exec(v2)![1].split(",").map((t) => t.trim().replace(/'/g, ""));
    // A v2 tinha os 17 primeiros (a v3 amplia na 20261020010000).
    expect(tipos).toEqual([...TIPOS_DE_NO].slice(0, 17));
    for (const t of ["pesquisa", "oferta", "funil", "filme", "por_no_ar"]) expect(tipos).toContain(t);
  });

  it("semeia os 4 templates oficiais da v2 iguais ao módulo da função, todos válidos", () => {
    expect(TEMPLATES_OFICIAIS_V2.map((t) => t.nome)).toEqual(["Produto low ticket do zero", "Funil de vendas completo", "Montar empresa / marca do zero", "Filme da marca"]);
    const semente = v2.slice(v2.indexOf("INSERT INTO public.lab_templates"));
    expect(semente).toContain("ON CONFLICT (id) DO UPDATE");
    const ids = new Set([...TEMPLATES_OFICIAIS, ...TEMPLATES_OFICIAIS_V2].map((t) => t.id));
    expect(ids.size).toBe(10);
    for (const t of TEMPLATES_OFICIAIS_V2) {
      expect(semente, t.nome).toContain(`('${t.id}'::uuid, '${t.nome}'`);
      expect(semente, t.nome).toContain(`'${JSON.stringify(t.canvas).replace(/'/g, "''")}'::jsonb, true)`);
      expect(errosDoCanvas(normalizarCanvas(t.canvas)), t.nome).toEqual([]);
    }
    // Sem cifrão solto no SQL (o separador de comandos do CLI lê $ como início de bloco).
    expect(semente).not.toMatch(/\$/);
  });

  it("Pôr no ar: o gatilho só entrega ao operador DEPOIS do sim do dono, e nunca trava a decisão", () => {
    expect(v2).toContain("CREATE TRIGGER zz_lab_no_ar_decisao");
    expect(v2).toMatch(/BEFORE UPDATE ON public\.operator_approvals\s+FOR EACH ROW\s+WHEN \(NEW\.payload ->> 'origem' = 'laboratorio'\)/);
    const fn = v2.slice(v2.indexOf("CREATE OR REPLACE FUNCTION public.lab_no_ar_decisao()"), v2.indexOf("$fn$;") + 5);
    expect(fn).toContain("SECURITY DEFINER");
    // Entrega pela fila existente, só na virada para 'aprovado' e só uma vez.
    expect(fn).toMatch(/IF NEW\.status = 'aprovado' AND OLD\.status IS DISTINCT FROM 'aprovado'\s+AND NEW\.task_link_id IS NULL/);
    expect(fn).toContain("public.operator_assign_task(_slug, NEW.kanban_task_id, 'laboratorio:aprovado'");
    expect(fn).toContain("EXCEPTION WHEN OTHERS THEN");
    // Estado do nó (aguardando aprovação → com o agente → feito, ou recusado) em lab_execucoes.
    for (const e of ["'aguardando_aprovacao'", "'com_agente'", "'feito'", "'recusado'"]) expect(fn).toContain(e);
    expect(fn).toContain("WHERE id = _exec AND tipo = 'por_no_ar'");
    // Nada de ação no mundo aqui: só a fila e o diário.
    expect(fn).not.toMatch(/operator_ordem_executada\(|graph\.facebook|net\.http|http_post|pg_net/);
    expect(v2).toContain("REVOKE ALL ON FUNCTION public.lab_no_ar_decisao() FROM PUBLIC, anon, authenticated;");
  });

  it("está no manifesto e na baseline de produção com o hash do arquivo", () => {
    const hash = createHash("sha256").update(sqlV2, "utf8").digest("hex");
    expect(ler("supabase/migration-manifest.sha256")).toContain(`${hash}  ${CAMINHO_V2}`);
    const baseline = JSON.parse(ler("supabase/production-migration-baseline.json")) as { forward_migrations: Array<{ version: string; path: string; local_sha256: string; remote_name: string; remote_hash_mode: string }> };
    const entrada = baseline.forward_migrations.find((m) => m.path === CAMINHO_V2);
    expect(entrada).toBeTruthy();
    expect(entrada!.version).toBe("20261019233000");
    expect(entrada!.local_sha256).toBe(hash);
    expect(entrada!.remote_name).toBe("laboratorio_v2");
    expect(entrada!.remote_hash_mode).toBe("supabase_cli_split");
  });
});

describe("laboratorio v2: função de borda", () => {
  const executar = ler("supabase/functions/laboratorio/executar.ts");
  const noAr = ler("supabase/functions/laboratorio/no-ar.ts");
  const filme = ler("supabase/functions/laboratorio/filme.ts");

  it("Pôr no ar só cria o pedido de aprovação (sem rede, sem entregar ao agente antes do sim)", () => {
    expect(noAr).not.toMatch(/fetch\(|graph\.facebook|meta_create|chamarTexto|chamarImagem/);
    const pedir = noAr.slice(noAr.indexOf("export async function pedirNoAr"), noAr.indexOf("// ------------------------------------------------------------------ acompanhar"));
    expect(pedir).toContain("porta.criarAprovacao(");
    expect(pedir).toContain('status: "pendente"');
    expect(pedir).not.toContain("entregarAoOperador");
    expect(executar).toContain('db.from("operator_approvals").insert(a)');
    // Anúncio sobe pausado; action_kind do vocabulário fechado.
    expect(ler("supabase/functions/laboratorio/modulos/regras.ts")).toMatch(/subir_anuncio_pausado: "publicar"/);
    expect(noAr).toContain("PAUSADO");
  });

  it("Filme chama a mesa-motion com a sessão de quem pediu (as ações que já existem)", () => {
    expect(filme).toContain("/functions/v1/mesa-motion");
    expect(filme).toContain("Authorization: `Bearer ${token}`");
    for (const acao of ["filme_criar", "filme_salvar", "storyboards_gerar", "storyboard_escolher", "cena_pedir", "filme_ler", "montar", "render_status"]) {
      expect(filme, acao).toContain(`"${acao}"`);
    }
    const motion = ler("supabase/functions/mesa-motion/index.ts");
    for (const acao of ["filme_criar", "filme_salvar", "filme_arquivar", "storyboards_gerar", "storyboard_escolher", "cena_pedir", "filme_ler", "montar: montarAcao", "render_status"]) {
      expect(motion, acao).toContain(acao);
    }
  });
});

/**
 * Laboratório v3 (Aceleriq-Laboratorio/clickmax-rea.md): a migration 20261020010000 amplia o CHECK com os 8
 * especialistas de criação e semeia os 3 templates por arquétipo (high ticket, lançamento, webinar).
 */
describe("laboratorio v3: migration", () => {
  const NOME_V3 = "20261020010000_laboratorio_v3.sql";
  const CAMINHO_V3 = `supabase/migrations/${NOME_V3}`;
  const sqlV3 = ler(CAMINHO_V3);
  const v3 = sqlV3.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("vem depois da v2 e da obra do site, sem colisão de timestamp", () => {
    const todas = readdirSync(resolve(raiz, "supabase/migrations")).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
    expect(todas.filter((f) => f.slice(0, 14) === NOME_V3.slice(0, 14))).toEqual([NOME_V3]);
    expect(todas.indexOf(NOME_V3)).toBeGreaterThan(todas.indexOf("20261019234500_obra_do_site.sql"));
    expect(NOME_V3.slice(0, 14) > "20261019233000").toBe(true);
  });

  it("o CHECK de lab_execucoes.tipo passa a ter exatamente os tipos de nó da função (com os 8 especialistas)", () => {
    expect(v3).toContain("ALTER TABLE public.lab_execucoes DROP CONSTRAINT IF EXISTS lab_execucoes_tipo_check;");
    const tipos = /ADD CONSTRAINT lab_execucoes_tipo_check CHECK \(tipo IN \(([^)]*)\)\)/.exec(v3)![1].split(",").map((t) => t.trim().replace(/'/g, ""));
    // A v3 tinha os 25 primeiros (a v4 amplia na 20261020060000).
    expect(tipos).toEqual([...TIPOS_DE_NO].slice(0, 25));
    for (const t of ["avatar", "order_bump", "upsell", "downsell", "sequencia_ofertas", "secoes_pagina", "sequencia_mensagens", "refino_tom"]) expect(tipos).toContain(t);
  });

  it("semeia os 3 templates oficiais da v3 iguais ao módulo da função, todos válidos", () => {
    expect(TEMPLATES_OFICIAIS_V3.map((t) => t.nome)).toEqual(["High ticket com aplicação", "Lançamento", "Webinar"]);
    const semente = v3.slice(v3.indexOf("INSERT INTO public.lab_templates"));
    expect(semente).toContain("ON CONFLICT (id) DO UPDATE");
    const ids = new Set([...TEMPLATES_OFICIAIS, ...TEMPLATES_OFICIAIS_V2, ...TEMPLATES_OFICIAIS_V3].map((t) => t.id));
    expect(ids.size).toBe(13);
    for (const t of TEMPLATES_OFICIAIS_V3) {
      expect(semente, t.nome).toContain(`('${t.id}'::uuid, '${t.nome}'`);
      expect(semente, t.nome).toContain(`'${JSON.stringify(t.canvas).replace(/'/g, "''")}'::jsonb, true)`);
      expect(errosDoCanvas(normalizarCanvas(t.canvas)), t.nome).toEqual([]);
    }
    expect(semente).not.toMatch(/\$/);
    // Só amplia: nada é apagado.
    expect(v3).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
  });

  it("está no manifesto e na baseline de produção com o hash do arquivo", () => {
    const hash = createHash("sha256").update(sqlV3, "utf8").digest("hex");
    expect(ler("supabase/migration-manifest.sha256")).toContain(`${hash}  ${CAMINHO_V3}`);
    const baseline = JSON.parse(ler("supabase/production-migration-baseline.json")) as { forward_migrations: Array<{ version: string; path: string; local_sha256: string; remote_name: string; remote_hash_mode: string }> };
    const entrada = baseline.forward_migrations.find((m) => m.path === CAMINHO_V3);
    expect(entrada).toBeTruthy();
    expect(entrada!.version).toBe("20261020010000");
    expect(entrada!.local_sha256).toBe(hash);
    expect(entrada!.remote_name).toBe("laboratorio_v3");
    expect(entrada!.remote_hash_mode).toBe("supabase_cli_split");
  });
});

describe("laboratorio v3: função de borda", () => {
  const acoes = ler("supabase/functions/laboratorio/acoes.ts");
  const executar = ler("supabase/functions/laboratorio/executar.ts");

  it("Pôr no ar trava por bloco sem fonte antes de criar o pedido; as perguntas usam o Jev (Noul) e caem na pista sem ele", () => {
    const porNoAr = executar.slice(executar.indexOf("async function noPorNoAr"), executar.indexOf("const EXECUTORES"));
    expect(porNoAr.indexOf("travaDoNoAr(")).toBeGreaterThan(0);
    expect(porNoAr.indexOf("travaDoNoAr(")).toBeLessThan(porNoAr.indexOf("pedirNoAr("));
    expect(porNoAr).toContain('"rascunho_sem_fonte"');
    expect(executar).toContain("r.saida.rascunho_sem_fonte = blocosSemFonte(");
    const perguntas = ler("supabase/functions/laboratorio/perguntas.ts");
    expect(perguntas).toContain("jevPerguntar(");
    expect(perguntas).toContain("perguntasQueFaltam(todoTexto, null)");
    // Pergunta antes de chamar o modelo do planejar (nada é montado sem o essencial).
    const planejar = acoes.slice(acoes.indexOf("export const planejar"), acoes.indexOf("export const pedidoInicio"));
    expect(planejar.indexOf("perguntasAntes(")).toBeLessThan(planejar.indexOf("chamarPlanejar("));
    expect(planejar).toContain("operacoes: []");
  });
});
