import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aprovadosDoFiltro,
  confirmacaoDeAgendarAprovados,
  formatosPermitidos,
  horarioDoAgendamentoEmLote,
  legendaEditadaAposAprovacao,
  opcoesDeFormatoNoAgendamento,
  precisaAjustarParaStory,
  resumoPorCliente,
} from "@/lib/editorialAjustesAprovados";
import { buildApprovedMediaAssets, inferEditorialMediaContentType } from "@/lib/editorialMedia";
import { buildEditorialSchedulePayload } from "@/lib/editorialScheduler";
import { FERRAMENTAS_POR_AREA } from "../../supabase/functions/mcp-server/modulos/guia-do-painel";
import { RPCS_DA_PONTE } from "../../supabase/functions/_shared/mcp-mesas-ponte";

const ler = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");
const sql = ler("supabase/migrations/20261114180000_editar_legenda_e_formato_aprovados.sql");

/** Corpo de uma função da migration, do CREATE até o fim do $function$. */
function corpo(nome: string) {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, nome).toBeGreaterThanOrEqual(0);
  const abre = sql.indexOf("AS $function$", inicio);
  const fecha = sql.indexOf("$function$;", abre + 13);
  return sql.slice(inicio, fecha);
}

describe("RPC editar_legenda_publicacao_aprovada", () => {
  const f = corpo("editar_legenda_publicacao_aprovada");
  const updates = f.match(/UPDATE public\.[a-z_]+\s+SET[\s\S]*?WHERE/g) || [];

  it("é SECURITY DEFINER, search_path vazio e usa o lock da casa", () => {
    expect(f).toContain("SECURITY DEFINER");
    expect(f).toContain("SET search_path TO ''");
    expect(f).toContain("PERFORM public.editorial_lock_task_sync();");
    expect(f).toContain("_actor uuid := auth.uid();");
  });

  it("só admin ou gestor do cliente; o cliente do portal nunca", () => {
    expect(f).toContain("NOT public.editorial_can_publish_client(_pub.client_id)");
    expect(f).toContain("_actor = _pub.client_id");
    expect(f).not.toContain("editorial_staff_can_access_client");
  });

  it("recusa publicada, com falha e cancelada", () => {
    expect(f).toContain("IF _pub.status NOT IN ('planned', 'scheduled') THEN");
    expect(f).toMatch(/Publicada, com falha ou cancelada não muda por aqui/);
  });

  it("optimistic lock pela versão da publicação", () => {
    expect(f).toContain("_pub.version IS DISTINCT FROM p_expected_version");
    expect(f).toContain("Esta publicação mudou desde que a tela carregou.");
  });

  it("exige a aprovação intacta e recusa envio em andamento", () => {
    expect(f).toContain("_post_internal.approval_fingerprint IS DISTINCT FROM\n      public.editorial_compute_approval_fingerprint(_post.id)");
    expect(f).toContain("NOT _pub_internal.included_in_approval_snapshot");
    expect(f).toContain("social_private.autopublish_jobs");
  });

  it("outra conta do mesmo post em envio recusa a edição inteira, antes de qualquer gravação", () => {
    // A legenda base e a impressão digital são do post: mudar com outra conta
    // em envio derrubaria o envio dela.
    const recusa = f.indexOf("Outra conta deste conteúdo está com o envio em andamento.");
    expect(recusa).toBeGreaterThan(0);
    const checagem = f.slice(f.lastIndexOf("IF EXISTS (", recusa), recusa);
    expect(checagem).toContain("FROM public.editorial_publications AS irma");
    expect(checagem).toContain("JOIN social_private.autopublish_jobs AS job\n      ON job.publication_id = irma.id");
    expect(checagem).toContain("irma.post_id = _post.id");
    expect(checagem).toContain("irma.id <> _pub.id");
    expect(checagem).toContain("job.stage NOT IN ('done', 'failed', 'cancelled')");
    // Nenhuma gravação antes da recusa: nem legenda, nem legenda base, nem impressão digital, nem evento.
    const antes = f.slice(0, recusa);
    expect(antes).not.toMatch(/UPDATE public\./);
    expect(antes).not.toContain("INSERT INTO");
    for (const gravacao of [
      "SET caption = _depois",
      "SET default_caption = _depois",
      "approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id)",
      "INSERT INTO public.editorial_events",
    ]) {
      expect(f.indexOf(gravacao), gravacao).toBeGreaterThan(recusa);
    }
    // Não sobra o filtro antigo que só pulava a conta em envio e seguia com o resto.
    expect(f.match(/social_private\.autopublish_jobs/g)).toHaveLength(2);
  });

  it("atualiza a legenda da publicação e a legenda base do post", () => {
    expect(f).toMatch(/UPDATE public\.editorial_publications\s+SET caption = _depois/);
    expect(f).toMatch(/UPDATE public\.editorial_posts\s+SET default_caption = _depois/);
  });

  it("não derruba a aprovação: só caption, default_caption e a impressão digital mudam", () => {
    expect(updates.length).toBe(3);
    const setados = updates.join("\n");
    for (const proibido of [
      "status =",
      "scheduled_at",
      "delivery_mode",
      "content_type",
      "production_status",
      "included_in_approval_snapshot =",
      "locked_at",
      "approval_status",
      "client_decided_at",
    ]) {
      expect(setados, proibido).not.toContain(proibido);
    }
    expect(f).not.toMatch(/UPDATE public\.files\b/);
    expect(f).not.toMatch(/UPDATE public\.editorial_publication_internal\b/);
    expect(f).not.toContain("transition_editorial_publication");
    // A impressão digital é refeita, senão o envio recusaria.
    expect(f).toContain("approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id)");
  });

  it("grava auditoria com quem editou e a legenda antes e depois", () => {
    expect(f).toContain("'caption_edited_after_approval'");
    expect(f).toContain("'caption_antes', _alvo.caption");
    expect(f).toContain("'caption_depois', _depois");
    expect(f).toMatch(/INSERT INTO public\.editorial_events \([\s\S]*actor_id[\s\S]*\) VALUES \([\s\S]*_actor,/);
  });

  it("legenda vazia e acima do limite do Instagram não passam", () => {
    expect(f).toContain("A legenda não pode ficar vazia.");
    expect(f).toContain("char_length(_depois) > 2200");
  });
});

describe("RPC ajustar_formato_publicacao_aprovada", () => {
  const f = corpo("ajustar_formato_publicacao_aprovada");

  it("mesmo recorte de permissão, lock e versão", () => {
    expect(f).toContain("SECURITY DEFINER");
    expect(f).toContain("SET search_path TO ''");
    expect(f).toContain("PERFORM public.editorial_lock_task_sync();");
    expect(f).toContain("NOT public.editorial_can_publish_client(_post.client_id)");
    expect(f).toContain("_actor = _post.client_id");
    expect(f).toContain("_post.version IS DISTINCT FROM p_expected_version");
  });

  it("só peça única; carrossel não vira story; imagem e vídeo com formatos próprios", () => {
    expect(f).toContain("_formato NOT IN ('static', 'story', 'reel', 'video')");
    expect(f).toContain("Carrossel não vira Story: o Story precisa de uma peça só.");
    expect(f).toContain("Este conteúdo é um vídeo. Escolha Story, Reel ou Vídeo.");
    expect(f).toContain("Este conteúdo é uma imagem. Escolha Post estático ou Story.");
    expect(f).toContain("publication.status NOT IN ('planned', 'scheduled', 'cancelled')");
  });

  it("não usa o save aprovado que recusa content_type e não mexe em status nem horário", () => {
    expect(f).not.toContain("save_approved_editorial_post");
    expect(f).not.toMatch(/UPDATE public\.editorial_publications\b/);
    expect(f).toMatch(/UPDATE public\.editorial_posts\s+SET content_type = _formato/);
    expect(f).toContain("approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id)");
  });

  it("audita formato antes e depois e alinha a tarefa vinculada", () => {
    expect(f).toContain("'content_type_adjusted_after_approval'");
    expect(f).toContain("'formato_antes', _formato_antes");
    expect(f).toContain("'formato_depois', _formato");
    expect(f).toContain("set_config('app.editorial_ajuste_formato_post', _post.id::text, true)");
    expect(f).toContain("set_config('app.editorial_ajuste_formato_post', '', true)");
  });

  it("a guarda da tarefa só abre para o post que a própria RPC ajusta", () => {
    const guarda = corpo("editorial_task_delivery_type_guard");
    expect(guarda).toContain("current_setting('app.editorial_ajuste_formato_post', true), '') = _post_id::text");
    // A marca vem depois da regra de tipo publicável: ela continua valendo.
    expect(guarda.indexOf("precisa manter um tipo publicável")).toBeLessThan(
      guarda.indexOf("app.editorial_ajuste_formato_post"),
    );
    expect(guarda).toContain("app.purge_in_progress");
  });
});

describe("grants", () => {
  it("authenticated executa; PUBLIC e anon não", () => {
    for (const assinatura of [
      "public.editar_legenda_publicacao_aprovada(uuid, integer, text)",
      "public.ajustar_formato_publicacao_aprovada(uuid, integer, text)",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${assinatura}\n  FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${assinatura}\n  TO authenticated;`);
    }
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/);
    expect(sql).not.toMatch(/\bDELETE FROM\b|\bDROP\b|\bTRUNCATE\b/);
  });
});

describe("tipos do Supabase", () => {
  it("as duas RPCs novas estão em types.ts", () => {
    const tipos = ler("src/integrations/supabase/types.ts");
    expect(tipos).toContain("editar_legenda_publicacao_aprovada: {");
    expect(tipos).toContain("ajustar_formato_publicacao_aprovada: {");
  });
});

describe("formato: story escolhível, nunca inferido", () => {
  const imagem = {
    id: "r1",
    file_name: "story-9x16.png",
    mime_type: "image/png",
    approval_status: "approved",
    visibility: "client_shared",
    locked_at: "2026-11-01",
  };

  it("inferEditorialMediaContentType continua sem story: estático 9:16 segue static", () => {
    expect(inferEditorialMediaContentType(imagem, [])).toBe("static");
    const [asset] = buildApprovedMediaAssets([imagem]);
    expect(asset.contentType).toBe("static");
    const fonte = ler("src/lib/editorialMedia.ts");
    expect(fonte).toContain('export type EditorialMediaContentType = "static" | "carousel" | "video";');
  });

  it("o agendamento oferece Story para imagem e vídeo, e não para carrossel", () => {
    expect(opcoesDeFormatoNoAgendamento("static").map((o) => o.value)).toEqual(["static", "story"]);
    expect(opcoesDeFormatoNoAgendamento("video").map((o) => o.value)).toEqual(["video", "story"]);
    expect(opcoesDeFormatoNoAgendamento("carousel")).toEqual([]);
    expect(opcoesDeFormatoNoAgendamento("static").find((o) => o.value === "story")?.label).toBe("Story");
  });

  it("story escolhido entra no payload e o diálogo confirma pela RPC de ajuste", () => {
    const [asset] = buildApprovedMediaAssets([imagem]);
    const payload = buildEditorialSchedulePayload({
      clientId: "c1",
      projectId: "p1",
      asset,
      publicationTargets: [{ accountId: "a1", idempotencyKey: "k1" }],
      scheduledAtIso: "2026-11-20T15:00:00.000Z",
      timezone: "America/Sao_Paulo",
      postIdempotencyKey: "pk",
      mutationId: "m1",
      contentType: "story",
    });
    expect(payload.content_type).toBe("story");
    const semEscolha = buildEditorialSchedulePayload({
      clientId: "c1",
      projectId: "p1",
      asset,
      publicationTargets: [{ accountId: "a1", idempotencyKey: "k1" }],
      scheduledAtIso: "2026-11-20T15:00:00.000Z",
      timezone: "America/Sao_Paulo",
      postIdempotencyKey: "pk",
      mutationId: "m1",
    });
    expect(semEscolha.content_type).toBe("static");
    expect(precisaAjustarParaStory("story", "static")).toBe(true);
    expect(precisaAjustarParaStory("story", "story")).toBe(false);
    expect(precisaAjustarParaStory("static", "static")).toBe(false);

    const dialogo = ler("src/components/editorial/EditorialScheduleDialog.tsx");
    expect(dialogo).toContain("opcoesDeFormatoNoAgendamento(selectedAsset.contentType)");
    expect(dialogo).toContain("ajustarFormatoAprovado.mutateAsync");
  });

  it("o formato muda ANTES de agendar; se o ajuste falha, não agenda e não mostra sucesso", () => {
    const dialogo = ler("src/components/editorial/EditorialScheduleDialog.tsx");
    const fn = dialogo.slice(dialogo.indexOf("const handleSchedule = async"), dialogo.indexOf("const readySteps"));
    const fluxo = fn.slice(fn.indexOf("    try {\n      if (attempt.prepared)"));

    // No post que já existe, o ajuste vem antes do save que agenda, e o save usa a versão que o ajuste devolveu.
    const ajuste = fluxo.indexOf("await ajustarFormatoAntesDeAgendar(completePost)");
    const agenda = fluxo.indexOf("await savePost.mutateAsync(attempt.prepared)", ajuste);
    expect(ajuste).toBeGreaterThan(0);
    expect(agenda).toBeGreaterThan(ajuste);
    expect(fluxo.slice(ajuste, agenda)).toContain("expectedVersion: versaoParaAgendar,");

    // O ajuste anterior não engole erro: ele sobe e o save não roda.
    const antes = fn.slice(fn.indexOf("const ajustarFormatoAntesDeAgendar"), fn.indexOf("const confirmarFormato"));
    expect(antes).toContain("ajustarFormatoAprovado.mutateAsync");
    expect(antes).toContain("throw new Error(");
    expect(antes).toContain("Nada foi agendado");
    expect(antes).not.toContain("toast.");

    // A conferência depois do save também não mascara: erro, sem sucesso. Ela só existe para o post que
    // nasce no agendamento com formato diferente do da mídia; o post que já existe nunca depende dela.
    const depois = fn.slice(fn.indexOf("const confirmarFormato"), fn.indexOf("const finishSchedule"));
    expect(depois.match(/throw new FormatoNaoConfirmadoError\(/g)).toHaveLength(2);
    expect(depois).not.toContain("toast.");
    expect(depois).not.toMatch(/catch \([^)]*\) \{\s*\}/);
    const fim = fn.slice(fn.indexOf("const finishSchedule"), fn.indexOf("    try {\n      if (attempt.prepared)"));
    const confere = fim.indexOf("if (attempt.conferirFormatoDepois) await confirmarFormato(postId);");
    expect(confere).toBeGreaterThan(0);
    expect(fim.indexOf("toast.success(")).toBeGreaterThan(confere);
    expect(fluxo).toContain("attempt.conferirFormatoDepois =\n        !completePost &&\n        formatoPedido !== null &&\n        formatoPedido !== selectedAsset.contentType;");

    // O aviso antigo, que dizia "Agendado" com o formato errado, saiu.
    expect(dialogo).not.toContain("Agendado, mas");
    expect(dialogo).not.toContain("toast.warning(");
    const erro = fn.slice(fn.indexOf("if (error instanceof FormatoNaoConfirmadoError)"));
    expect(erro.slice(0, erro.indexOf("return;"))).toContain("toast.error(");
    expect(erro.slice(0, erro.indexOf("return;"))).not.toContain("onOpenChange(false)");
  });

  it("ajuste de formato na ficha: peça única troca, carrossel não", () => {
    expect(formatosPermitidos({ formatoAtual: "static", ehVideo: false, temLaminas: false }).map((o) => o.value)).toEqual(["static", "story"]);
    expect(formatosPermitidos({ formatoAtual: "story", ehVideo: true, temLaminas: false }).map((o) => o.value)).toEqual(["reel", "video", "story"]);
    expect(formatosPermitidos({ formatoAtual: "carousel", ehVideo: false, temLaminas: true })).toEqual([]);
    expect(formatosPermitidos({ formatoAtual: "static", ehVideo: false, temLaminas: true })).toEqual([]);
  });
});

describe("ficha: editar legenda sem criar revisão", () => {
  const ficha = ler("src/components/editorial/EditorialDetailSheet.tsx");

  it("salva pela RPC nova, mostra o aviso e não abre Criar revisão", () => {
    expect(ficha).toContain("editarLegendaAprovada.mutateAsync");
    expect(ficha).toContain("Legenda editada após aprovação");
    expect(ficha).toContain('chave: "legenda"');
    const salvar = ficha.slice(ficha.indexOf("const salvarLegenda"), ficha.indexOf("const abrirMudancaDeFormato"));
    expect(salvar).not.toContain("onCreateRevision");
    expect(salvar).not.toContain("savePost");
  });

  it("textos novos sem travessão", () => {
    const novos = [
      ler("src/lib/editorialAjustesAprovados.ts"),
      sql,
      ler("supabase/functions/mcp-server/modulos/editar-legenda-publicacao.ts"),
    ];
    for (const fonte of novos) expect(fonte).not.toContain("—");
  });

  it("o aviso vem do evento mais recente da publicação", () => {
    const eventos = [
      { event_type: "publication_scheduled", created_at: "2026-11-10T10:00:00Z" },
      { event_type: "caption_edited_after_approval", created_at: "2026-11-12T10:00:00Z", actor_name: "Almir", publication_id: "p1" },
      { event_type: "caption_edited_after_approval", created_at: "2026-11-13T10:00:00Z", actor_name: "Ana", publication_id: "p2" },
    ];
    expect(legendaEditadaAposAprovacao(eventos)).toEqual({ quando: "2026-11-13T10:00:00Z", quem: "Ana" });
    expect(legendaEditadaAposAprovacao(eventos, "p1")).toEqual({ quando: "2026-11-12T10:00:00Z", quem: "Almir" });
    expect(legendaEditadaAposAprovacao(eventos.slice(0, 1))).toBeNull();
  });
});

describe("Agendar aprovados: confirmação e cliente filtrado", () => {
  const itens = [
    { clientId: "mirante", publicationId: "1", version: 1, scheduledAt: "2026-11-20T12:00:00Z" },
    { clientId: "mirante", publicationId: "2", version: 1, scheduledAt: "2026-11-21T12:00:00Z" },
    { clientId: "casa", publicationId: "3", version: 4, scheduledAt: "2026-11-22T12:00:00Z" },
  ];
  const nomes: Record<string, string> = { mirante: "Mirante", casa: "Casa dos Assados" };

  it("com cliente filtrado, não inclui outros clientes", () => {
    expect(aprovadosDoFiltro(itens, "casa").map((i) => i.publicationId)).toEqual(["3"]);
    expect(aprovadosDoFiltro(itens, "all")).toHaveLength(3);
    expect(aprovadosDoFiltro(itens, "")).toHaveLength(3);
  });

  it("o diálogo diz quantos posts e de quais clientes", () => {
    const todos = confirmacaoDeAgendarAprovados(resumoPorCliente(itens, (id) => nomes[id]), true);
    expect(todos.title).toBe("Agendar 3 posts aprovados?");
    expect(todos.description).toContain("todos os clientes");
    expect(todos.description).toContain("Mirante: 2 posts");
    expect(todos.description).toContain("Casa dos Assados: 1 post");
    const um = confirmacaoDeAgendarAprovados(resumoPorCliente(aprovadosDoFiltro(itens, "casa"), (id) => nomes[id]), false);
    expect(um.title).toBe("Agendar 1 post aprovado?");
    expect(um.description).toContain("Casa dos Assados");
    expect(um.description).not.toContain("Mirante");
    for (const texto of [todos.title, todos.description, um.description]) expect(texto).not.toContain("—");
  });

  it("mantém a regra de horário: planejado no futuro fica; passado vai para +1 hora", () => {
    const agora = Date.parse("2026-11-14T12:00:00Z");
    expect(horarioDoAgendamentoEmLote("2026-11-15T09:00:00Z", agora)).toBe("2026-11-15T09:00:00Z");
    expect(horarioDoAgendamentoEmLote("2026-11-13T09:00:00Z", agora)).toBe("2026-11-14T13:00:00.000Z");
  });

  it("não dispara sem confirmação: o diálogo vem antes da transição e o cancelar sai", () => {
    const pagina = ler("src/pages/EditorialCalendar.tsx");
    const inicio = pagina.indexOf("const scheduleApprovedNow = useCallback");
    const fn = pagina.slice(inicio, pagina.indexOf("}, [approvedReadyToSchedule", inicio));
    const confirma = fn.indexOf("await confirmDialog(");
    expect(confirma).toBeGreaterThan(0);
    expect(fn.indexOf("if (!confirmou) return;")).toBeGreaterThan(confirma);
    expect(fn.indexOf("transitionPublication.mutateAsync")).toBeGreaterThan(fn.indexOf("if (!confirmou) return;"));
    expect(fn).toContain("aprovadosDoFiltro(approvedReadyToSchedule, forcedClientId || requestedClientId)");
    expect(fn).toContain("for (const item of lote)");
    expect(pagina).toContain('import { useConfirm } from "@/components/shared/confirmDialog";');
  });
});

describe("MCP: aceleriq_ajustar_formato_publicacao", () => {
  const tools = ler("supabase/functions/_shared/mcp-tools.ts");
  const modulo = ler("supabase/functions/mcp-server/modulos/editar-legenda-publicacao.ts");
  const ferramenta = modulo.slice(modulo.indexOf("export const ajustarFormatoSchema"));

  it("no catálogo, com editorial:write, na área da Agenda e chamando a RPC como a pessoa", () => {
    expect(tools).toContain("  aceleriq_ajustar_formato_publicacao: 'editorial:write',");
    expect(tools).toContain("  ...FERRAMENTA_DE_AJUSTAR_FORMATO,");
    expect(FERRAMENTAS_POR_AREA.calendario).toContain("aceleriq_ajustar_formato_publicacao");
    expect(RPCS_DA_PONTE).toContain("ajustar_formato_publicacao_aprovada");
    expect(ferramenta).toContain("name: 'aceleriq_ajustar_formato_publicacao'");
    expect(ferramenta).toContain("rpcComoPessoa('ajustar_formato_publicacao_aprovada'");
    expect(ferramenta).toContain("dataScopeAllowsClient(ctx.dataScope, post.client_id)");
    expect(ferramenta).toContain("umaVez('aceleriq_ajustar_formato_publicacao'");
    expect(ler("supabase/functions/_shared/mcp-security.ts")).toContain("'aceleriq_ajustar_formato_publicacao',");
  });

  it("schema: confirmar=true, idempotency_key, post_id, expected_version, content_type de peça única", () => {
    expect(ferramenta).toContain("required: ['post_id', 'expected_version', 'content_type', 'confirmar', 'idempotency_key']");
    expect(modulo).toContain("export const FORMATOS_DE_PECA_UNICA = ['static', 'story', 'reel', 'video'] as const;");
    expect(ferramenta).toContain("content_type: z.enum(FORMATOS_DE_PECA_UNICA)");
    expect(ferramenta).toContain("confirmar: z.literal(true)");
    expect(ferramenta).toContain("idempotency_key: z.string().trim().min(8).max(120)");
    expect(ferramenta).toContain("}).strict();");
    expect(ferramenta).toContain("scopes: ['editorial:write']");
  });

  it("o agente não mexe na tarefa nem no post por fora: só a RPC atômica troca os dois", () => {
    // As guardas da tarefa e do post se travam uma na outra; quem destrava é a
    // marca local da RPC, na mesma transação. O módulo só lê e chama a RPC.
    expect(ferramenta).not.toMatch(/\.update\(|\.insert\(|\.delete\(|\.upsert\(/);
    expect(ferramenta).not.toContain("delivery_type");
    const rpc = corpo("ajustar_formato_publicacao_aprovada");
    const marca = rpc.indexOf("set_config('app.editorial_ajuste_formato_post', _post.id::text, true)");
    const tarefa = rpc.indexOf("UPDATE public.tasks");
    const desmarca = rpc.indexOf("set_config('app.editorial_ajuste_formato_post', '', true)");
    const post = rpc.indexOf("UPDATE public.editorial_posts");
    expect(marca).toBeGreaterThan(0);
    expect(tarefa).toBeGreaterThan(marca);
    expect(desmarca).toBeGreaterThan(tarefa);
    expect(post).toBeGreaterThan(desmarca);
  });
});

describe("MCP: aceleriq_editar_legenda_publicacao", () => {
  const tools = ler("supabase/functions/_shared/mcp-tools.ts");
  const modulo = ler("supabase/functions/mcp-server/modulos/editar-legenda-publicacao.ts");

  it("no catálogo, com editorial:write, na área da Agenda e chamando a RPC como a pessoa", () => {
    expect(tools).toContain("  aceleriq_editar_legenda_publicacao: 'editorial:write',");
    expect(tools).toContain("  ...FERRAMENTA_DE_EDITAR_LEGENDA,");
    expect(FERRAMENTAS_POR_AREA.calendario).toContain("aceleriq_editar_legenda_publicacao");
    expect(RPCS_DA_PONTE).toContain("editar_legenda_publicacao_aprovada");
    expect(modulo).toContain("rpcComoPessoa('editar_legenda_publicacao_aprovada'");
    expect(modulo).toContain("dataScopeAllowsClient(ctx.dataScope, pub.client_id)");
    expect(modulo).toContain("umaVez('aceleriq_editar_legenda_publicacao'");
    expect(ler("supabase/functions/_shared/mcp-security.ts")).toContain("'aceleriq_editar_legenda_publicacao',");
  });

  it("schema: confirmar=true, idempotency_key, publication_id, expected_version, caption", () => {
    expect(modulo).toContain("required: ['publication_id', 'expected_version', 'caption', 'confirmar', 'idempotency_key']");
    expect(modulo).toContain("confirmar: z.literal(true)");
    expect(modulo).toContain("idempotency_key: z.string().trim().min(8).max(120)");
    expect(modulo).toContain("}).strict();");
    expect(modulo).toContain("scopes: ['editorial:write']");
  });
});
