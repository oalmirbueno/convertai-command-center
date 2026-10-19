import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tipoDoConteudo, planoDaSincronizacao } from "../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import { CHAVES_DOS_MOLDES, ESQUEMA_DO_PLANO } from "../../supabase/functions/mesa-stories/modulos/moldes-de-stories";
import { caminhoDoAdesivo } from "../../supabase/functions/mesa-stories/modulos/regras-dos-stories";

/**
 * Stories da Mesa (20/10/2026): contrato do servidor (docs/mesa/STORIES.md).
 * Banco (migration 20261020120000), a função mesa-stories, o motor publicando
 * story em vídeo e a arte stories_9x16 do Estúdio entrando como story.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const sql = ler("supabase/migrations/20261020120000_stories_da_mesa.sql");
const funcao = ler("supabase/functions/mesa-stories/index.ts");
const regras = ler("supabase/functions/mesa-stories/modulos/regras-dos-stories.ts");

const corpoDa = (texto: string, nome: string) => {
  const ini = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}()`);
  expect(ini, nome).toBeGreaterThanOrEqual(0);
  return texto.slice(ini, texto.indexOf("$function$;", ini));
};

describe("banco dos Stories", () => {
  it("tabelas idempotentes, RLS de leitura só para a equipe com acesso ao cliente e escrita só pela função", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.cliente_stories_sequencias (");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.cliente_stories (");
    expect(sql).toContain("USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));");
    expect(sql).toContain("REVOKE ALL ON public.cliente_stories_sequencias, public.cliente_stories FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT SELECT ON public.cliente_stories_sequencias, public.cliente_stories TO authenticated;");
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
  });

  it("as colunas do contrato e a regra da plataforma no banco: tem adesivo = pelo app", () => {
    for (const c of ["ordem", "molde", "titulo", "texto_na_tela", "adesivo", "fundo", "horario", "caminho", "destaque_id", "file_id", "editorial_post_id", "publicacao_id", "situacao", "roteiro_do_adesivo", "motivo", "aviso_em", "avisado_em"]) {
      expect(sql, c).toMatch(new RegExp(`\\n  ${c} [a-z]`));
    }
    expect(sql).toContain("CHECK ((adesivo->>'tipo' = 'nenhum') = (caminho = 'automatico'))");
    expect(sql).toContain("CHECK (situacao IN ('rascunho', 'arte_pronta', 'agendado', 'postar_pelo_app', 'publicado', 'falhou'))");
    expect(sql).toContain("CHECK (objetivo IN ('engajar', 'vender', 'lancar', 'relacionamento', 'bastidor'))");
  });

  it("cron a cada minuto avisa a equipe do cliente 5 minutos antes, uma vez, com o link da agenda dos stories", () => {
    const aviso = corpoDa(sql, "stories_avisar_pelo_app");
    expect(aviso).toContain("s.caminho = 'pelo_app'");
    expect(aviso).toContain("s.situacao = 'postar_pelo_app'");
    expect(aviso).toContain("s.avisado_em IS NULL");
    expect(aviso).toContain("COALESCE(s.aviso_em, s.horario - interval '5 minutes') <= now()");
    expect(aviso).toContain("UPDATE public.cliente_stories SET avisado_em = now() WHERE id = _s.id;");
    expect(aviso).toContain("public.avisar_equipe_do_cliente(");
    expect(aviso).toContain("'stories_pelo_app'");
    expect(aviso).toContain("'/mesa?client=' || _s.client_id::text || '&aba=stories&bloco=agenda'");
    expect(sql).toContain("PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'stories-aviso-pelo-app';");
    expect(sql).toContain("PERFORM cron.schedule('stories-aviso-pelo-app', '* * * * *', $cron$select public.stories_avisar_pelo_app();$cron$);");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.stories_avisar_pelo_app() TO service_role;");
  });

  it("o motor publica story em vídeo com STORIES e video_url; o resto do corpo é o vigente byte a byte", () => {
    const antigo = corpoDa(ler("supabase/migrations/20260912213638_secure_publication_cancellation_dispatch.sql"), "editorial_autopublish_tick");
    const novo = corpoDa(sql, "editorial_autopublish_tick");
    expect(novo).toContain("ELSIF _kind = 'story' AND _story_video THEN");
    expect(novo).toContain("|| '&video_url=' || social_private.autopublish_urlencode(_urls[1])");
    expect(novo).toContain("IF _kind = 'video' OR (_kind = 'story' AND _story_video) THEN");
    expect(novo).toContain("lower(file_row.mime_type) LIKE 'video/%'");
    expect(novo).toMatch(/SECURITY DEFINER\nSET search_path = ''/);
    // A versão vigente com só as 4 mudanças do story em vídeo; nada mais muda.
    const deteccao = [
      "",
      "      -- 20/10 (Stories): story em video vai como STORIES com video_url e espera o",
      "      -- processamento do video, como o reel. Story em imagem segue igual.",
      "      _story_video := false;",
      "      IF _kind = 'story' THEN",
      "        SELECT COALESCE(lower(file_row.mime_type) LIKE 'video/%', false)",
      "            OR lower(COALESCE(file_row.extension, '')) IN ('mp4', 'mov', 'm4v')",
      "          INTO _story_video",
      "          FROM public.files AS file_row",
      "         WHERE file_row.id = _pub.file_id;",
      "        _story_video := COALESCE(_story_video, false);",
      "      END IF;",
      "",
    ].join("\n");
    const despachoDaImagem = "          ELSIF _kind = 'story' THEN";
    const despachoDoVideo = [
      "          ELSIF _kind = 'story' AND _story_video THEN",
      "            _payload := _graph || '/' || _token.resource_id || '/media'",
      "              || '?media_type=STORIES'",
      "              || '&video_url=' || social_private.autopublish_urlencode(_urls[1])",
      "              || '&access_token=' || _token.access_token;",
      despachoDaImagem,
    ].join("\n");
    expect(antigo.split(despachoDaImagem).length).toBe(2);
    const esperado = antigo
      .replace("  _kind text;\n", "  _kind text;\n  _story_video boolean := false;\n")
      .replace("        ELSE 'image'\n      END;\n", `        ELSE 'image'\n      END;\n${deteccao}`)
      .replace("            IF _kind = 'video' THEN", "            IF _kind = 'video' OR (_kind = 'story' AND _story_video) THEN")
      .replace(despachoDaImagem, despachoDoVideo);
    expect(novo).toBe(esperado);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role;");
  });

  it("o agendador da Mesa põe arte stories_9x16 de uma lâmina como story, e só isso muda", () => {
    const antigo = ler("supabase/migrations/20261002110000_avisos_com_cliente.sql");
    const ini = antigo.indexOf("CREATE OR REPLACE FUNCTION public.mesa_agendar_aprovados()");
    const vigente = antigo.slice(ini, antigo.indexOf("$function$;", ini));
    const novo = corpoDa(sql, "mesa_agendar_aprovados");
    expect(novo).toContain("WHEN _t.direcao->>'formato' = 'stories_9x16' THEN 'story'");
    const trocado = vigente.replace(
      "        _tipo := CASE WHEN cardinality(_t.file_ids) > 1 THEN 'carousel' ELSE 'static' END;\n",
      "        -- 20/10 (Stories): arte de uma lâmina no formato stories_9x16 entra como story.\n        _tipo := CASE\n          WHEN cardinality(_t.file_ids) > 1 THEN 'carousel'\n          WHEN _t.direcao->>'formato' = 'stories_9x16' THEN 'story'\n          ELSE 'static'\n        END;\n",
    );
    expect(novo).toBe(trocado);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mesa_agendar_aprovados() TO service_role;");
  });
});

describe("Estúdio: arte stories_9x16 vira story na Agenda", () => {
  it("tipoDoConteudo: uma lâmina 9:16 é story; mais de uma segue carrossel; sem formato, estático", () => {
    expect(tipoDoConteudo(["a"], "stories_9x16")).toBe("story");
    expect(tipoDoConteudo(["a", "b"], "stories_9x16")).toBe("carousel");
    expect(tipoDoConteudo(["a"], "feed_4x5")).toBe("static");
    expect(tipoDoConteudo(["a"])).toBe("static");
  });

  it("a entrega leva o formato da direção até o post da Agenda", async () => {
    const plano = await planoDaSincronizacao(
      { trabalhoId: "t1", clientId: "c1", projectId: "p1", taskId: "k1", titulo: "Story", fileIds: ["f1"], legenda: null, rodada: 1, formato: "stories_9x16" },
      null,
      { conta: { id: "a1", platform: "instagram" }, arquivoAtualEditavel: false },
    );
    expect(plano.payload?.content_type).toBe("story");
    expect(ler("supabase/functions/estudio-arte/agenda-da-entrega.ts")).toContain('formato: typeof t.direcao?.formato === "string" ? t.direcao.formato : null,');
  });
});

describe("função mesa-stories", () => {
  it("as ações do contrato, com as longas respondendo com fôlego", () => {
    for (const a of ["painel", "planejar_sequencia: planejarSequencia", "adaptar_molde: adaptarMolde", "salvar_story: salvarStory", "apagar_story: apagarStory", "registrar_arte: registrarArte", "agendar", "marcar_postado: marcarPostado", "conversar"]) {
      expect(funcao, a).toContain(`  ${a},`);
    }
    expect(funcao).toContain('const ACOES_LONGAS = new Set(["planejar_sequencia", "adaptar_molde", "conversar"]);');
    expect(funcao).toContain("respostaComFolego(rodar, corsHeaders)");
  });

  it("identifica a equipe e confere o acesso ao cliente antes de tudo", () => {
    expect(funcao).toContain('servico().rpc("is_staff", { _user_id: userId })');
    expect(funcao).toContain('ch.doChamador.rpc("can_access_client", { _client_id: clientId })');
    expect(funcao.match(/const c = await abrir\(ch, corpo\);/g)?.length).toBe(9);
  });

  it("modelo do motor com raciocínio low ou medium (nunca max), carteira do cliente e base do roteirista", () => {
    expect(funcao).toContain('raciocinio: e.raciocinio === "medium" ? "medium" : "low"');
    expect(funcao).not.toMatch(/raciocinio:\s*"(max|xhigh|high)"/);
    expect(funcao).toContain('agente: "stories.roteirista"');
    expect(funcao).toContain('from "../_shared/base-do-agente.ts"');
    expect(funcao).toContain("contextoCompletoParaPrompt(servico(), c.clientId, c.marca");
    expect(funcao).toContain('from("mesa_hypes")');
  });

  it("sem repetição: lê os últimos 7 dias, gera 2 versões em paralelo e o Jev escolhe por novidade e clareza", () => {
    expect(funcao).toContain(".gte(\"data\", somarDias(data, -DIAS_SEM_REPETIR))");
    expect(funcao).toContain("await Promise.allSettled([umaVersao(\"\"), umaVersao(ANGULO_DA_VERSAO_B)])");
    expect(funcao).toContain("questions[`novidade_${i}`]");
    expect(funcao).toContain("questions[`clareza_${i}`]");
    expect(funcao).toContain("await cobrarJev(r,");
    expect(funcao).toContain("pontosDoPlano(p, recentes, notas?.[i])");
    expect(funcao).toContain("JÁ USADO NA SEMANA (não repetir)");
  });

  it("agendar: Agenda com o JWT de quem chamou, só admin ou gestor no automático, story nunca com dois caminhos", () => {
    expect(funcao).toContain('ch.doChamador.rpc("save_editorial_post", { p_payload: payload, p_expected_version: null })');
    expect(funcao).toContain("Só admin ou gestor agenda publicação automática.");
    expect(funcao).not.toContain("transition_editorial_publication_unlocked");
    expect(funcao).not.toMatch(/autopublish_jobs|media_publish|graph\.facebook\.com/);
    expect(regras).toContain('content_type: "story"');
    expect(regras).toContain("Cancele por lá antes de mandar pelo app.");
    expect(regras).toContain('publicacao.delivery_mode = e.conta.automatica && e.shaValido ? "automatic" : "manual";');
  });

  it("conversa no padrão das mesas: pedido gravado antes, núcleo, método e resposta guardada", () => {
    for (const t of ["gravarPedidoAntes(servico()", "prepararNucleo(servico()", "fecharNucleo(servico()", 'superpoderesPara(servico(), { agente: "stories.agente"', "fecharComMetodo(servico()", "gravarResposta(servico()", 'referencia_tipo: REF_CONVERSA', 'const REF_CONVERSA = "stories_do_cliente";']) {
      expect(funcao, t).toContain(t);
    }
  });

  it("moldes e esquema: os 11 moldes; o caminho sai do adesivo", () => {
    expect(CHAVES_DOS_MOLDES).toHaveLength(11);
    expect(Object.keys(ESQUEMA_DO_PLANO.schema.properties)).toEqual(["titulo", "gancho_de_amanha", "stories"]);
    expect(caminhoDoAdesivo({ tipo: "enquete" })).toBe("pelo_app");
    expect(caminhoDoAdesivo({ tipo: "nenhum" })).toBe("automatico");
  });

  it("registro: config com JWT, índice dos motores e catálogo dos superpoderes", () => {
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.mesa-stories\]\s+verify_jwt = true/);
    const motores = ler("supabase/indice/motores.ts");
    expect(motores).toContain('"stories.agente": { ligacao: { arquivo: F("mesa-stories")');
    expect(motores).toContain('"stories.roteiro": { ligacao: { arquivo: F("mesa-stories")');
    const catalogo = ler("supabase/functions/_shared/superpoderes-catalogo.ts");
    expect(catalogo).toContain('id: "stories.agente", mesa: "instagram"');
    expect(catalogo).toContain('id: "stories.roteiro", mesa: "instagram"');
  });

  it("sem travessão nos arquivos novos", () => {
    for (const p of ["supabase/functions/mesa-stories/index.ts", "supabase/functions/mesa-stories/modulos/moldes-de-stories.ts", "supabase/functions/mesa-stories/modulos/regras-dos-stories.ts", "supabase/migrations/20261020120000_stories_da_mesa.sql"]) {
      expect(ler(p), p).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
