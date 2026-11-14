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

  it("imagem ou vídeo vale pela mídia efetiva de cada publicação viva, não só pelo arquivo principal", () => {
    const inicio = f.indexOf("count(*) FILTER (WHERE NOT midia.encontrada)");
    const recusaSemArquivo = f.indexOf("IF _midias_sem_arquivo > 0 THEN");
    expect(inicio).toBeGreaterThan(0);
    expect(recusaSemArquivo).toBeGreaterThan(inicio);
    const checagem = f.slice(inicio, recusaSemArquivo);

    // O principal e o arquivo efetivo de cada publicação não cancelada, sem repetir arquivo.
    expect(checagem).toContain(
      "SELECT _post.primary_file_id AS file_id\n      UNION\n      SELECT COALESCE(publication.file_id, _post.primary_file_id)\n      FROM public.editorial_publications AS publication",
    );
    expect(checagem).toContain("publication.post_id = _post.id");
    expect(checagem).toContain("publication.status <> 'cancelled'");
    expect(checagem).toContain("LEFT JOIN public.files AS arquivo\n      ON arquivo.id = efetiva.file_id");
    expect(checagem).toContain("arquivo.id IS NOT NULL AS encontrada");
    expect(checagem).toContain("INTO _midias_sem_arquivo, _midias_video, _midias_imagem");
    // A mesma régua de vídeo de sempre, agora aplicada a cada arquivo.
    expect(checagem).toContain("lower(COALESCE(arquivo.mime_type, '')) LIKE 'video/%'");
    expect(checagem).toContain("lower(COALESCE(arquivo.extension, '')) IN ('mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi')");
    expect(checagem).toContain("lower(COALESCE(arquivo.file_type, '')) IN ('video', 'vídeo')");
    // A leitura antiga, que só olhava o arquivo principal, saiu.
    expect(f).not.toContain("WHERE id = _post.primary_file_id");
    expect(f).not.toContain("_e_video");
    expect(f).not.toContain("_arquivo public.files%ROWTYPE");

    // Um vídeo em qualquer conta impede static; uma imagem em qualquer conta impede reel e video.
    const regras = f.slice(recusaSemArquivo, f.indexOf("IF _formato_antes = _formato THEN"));
    expect(regras).toContain("O arquivo deste conteúdo não foi encontrado.");
    expect(regras).toContain("IF _midias_video > 0 AND _formato = 'static' THEN");
    expect(regras).toContain("IF _midias_imagem > 0 AND _formato IN ('reel', 'video') THEN");
    // Mistura (imagem numa conta, vídeo em outra): a mensagem diz o que há e aponta o Story.
    expect(regras).toContain("Há vídeo em uma das contas deste conteúdo e imagem em outra: Post estático não serve para o vídeo. Escolha Story, que vale para as duas.");
    expect(regras).toContain("Há imagem em uma das contas deste conteúdo e vídeo em outra: Reel e Vídeo não servem para a imagem. Escolha Story, que vale para as duas.");
    // Story nunca é recusado por tipo de mídia: vale para imagem, vídeo e mistura.
    expect(regras).not.toContain("'story'");
  });

  it("a recusa por mídia vem antes de qualquer gravação (tarefa, post, impressão digital, evento)", () => {
    const gravacoes = ["UPDATE public.", "INSERT INTO", "set_config("].map((g) => f.indexOf(g));
    for (const posicao of gravacoes) expect(posicao).toBeGreaterThan(0);
    const primeiraGravacao = Math.min(...gravacoes);
    for (const recusa of [
      "INTO _midias_sem_arquivo, _midias_video, _midias_imagem",
      "O arquivo deste conteúdo não foi encontrado.",
      "Este conteúdo é um vídeo. Escolha Story, Reel ou Vídeo.",
      "Este conteúdo é uma imagem. Escolha Post estático ou Story.",
      "Post estático não serve para o vídeo.",
      "Reel e Vídeo não servem para a imagem.",
      "Carrossel não vira Story: o Story precisa de uma peça só.",
    ]) {
      expect(f.indexOf(recusa), recusa).toBeGreaterThan(0);
      expect(f.indexOf(recusa), recusa).toBeLessThan(primeiraGravacao);
    }
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

  it("save sem horário: scheduledAtIso null grava as publicações planejadas, sem scheduled_at", () => {
    const [asset] = buildApprovedMediaAssets([imagem]);
    const base = {
      clientId: "c1",
      projectId: "p1",
      asset,
      publicationTargets: [
        { accountId: "a1", idempotencyKey: "k1" },
        { accountId: "a2", idempotencyKey: "k2" },
      ],
      timezone: "America/Sao_Paulo",
      postIdempotencyKey: "pk",
      mutationId: "m1",
      contentType: "story",
    };
    const semHorario = buildEditorialSchedulePayload({ ...base, scheduledAtIso: null });
    expect(semHorario.id).toBeNull();
    expect(semHorario.publications).toHaveLength(2);
    for (const publicacao of semHorario.publications) expect(publicacao.scheduled_at).toBeNull();
    const comHorario = buildEditorialSchedulePayload({ ...base, scheduledAtIso: "2026-11-20T15:00:00.000Z" });
    for (const publicacao of comHorario.publications) expect(publicacao.scheduled_at).toBe("2026-11-20T15:00:00.000Z");
  });

  it("o formato muda ANTES de qualquer save com horário; post novo em outro formato nasce planejado, ajusta e só então agenda", () => {
    const dialogo = ler("src/components/editorial/EditorialScheduleDialog.tsx");
    const fn = dialogo.slice(dialogo.indexOf("const handleSchedule = async"), dialogo.indexOf("const readySteps"));
    const inicioDoFluxo = fn.indexOf("    try {\n      if (attempt.prepared)");
    const fluxo = fn.slice(inicioDoFluxo);

    // Ordem do fluxo: (1) post novo em formato diferente do da mídia nasce planejado, (2) ajuste, (3) o
    // único save com horário, que usa a versão que o ajuste devolveu. No post que já existe só (2) e (3).
    const nasce = fluxo.indexOf("completePost = await nascerPlanejado();");
    const ajuste = fluxo.indexOf("await ajustarFormatoAntesDeAgendar(completePost)");
    const horario = fluxo.indexOf("payload: montarPayload(completePost, scheduledAtIso, attempt.mutationId),");
    const agenda = fluxo.indexOf("await savePost.mutateAsync(attempt.prepared)", ajuste);
    expect(nasce).toBeGreaterThan(0);
    expect(ajuste).toBeGreaterThan(nasce);
    expect(horario).toBeGreaterThan(ajuste);
    expect(agenda).toBeGreaterThan(horario);
    expect(fluxo.slice(ajuste, agenda)).toContain("expectedVersion: versaoParaAgendar,");
    expect(fluxo.slice(0, nasce)).toContain(
      "} else if (\n        formatoPedido !== null &&\n        formatoPedido !== selectedAsset.contentType\n      ) {",
    );
    // Nenhum outro save com horário: scheduledAtIso só entra no payload final, depois do ajuste.
    expect(fluxo.match(/montarPayload\(/g)).toHaveLength(1);
    expect(fn.match(/montarPayload\([^)]*scheduledAtIso/g)).toHaveLength(1);

    // (1) O post novo nasce com scheduled_at null: o banco cria planejado e não agenda.
    const montar = fn.slice(fn.indexOf("const montarPayload"), fn.indexOf("const nascerPlanejado"));
    expect(montar).toContain("horarioIso: string | null,");
    expect(montar).toContain("scheduledAtIso: horarioIso,");
    expect(montar).not.toMatch(/scheduledAtIso,/);
    const nascer = fn.slice(fn.indexOf("const nascerPlanejado"), fn.indexOf("const finishSchedule"));
    expect(nascer).toContain("payload: montarPayload(null, null, mutationId),");
    expect(nascer).not.toContain("scheduledAtIso");
    expect(nascer).not.toContain("attempt.prepared");
    expect(nascer).not.toContain("toast.");
    expect(nascer).not.toContain("finishSchedule");
    expect(nascer).not.toMatch(/catch \([^)]*\) \{\s*\}/);
    // Novo clique da mesma tentativa não cria outro post: reusa o save e as chaves (resposta perdida) ou o
    // post que já nasceu, e lê do banco se o formato já foi ajustado.
    expect(nascer).toContain("if (!attempt.nascimento) {");
    expect(nascer).toContain("if (!nascimento.postNascidoId) {");
    expect(nascer).toContain("payload: nascimento.payload,");
    expect(nascer).toContain("nascimento.postNascidoId = nascido.post_id;");
    expect(nascer.match(/savePost\.mutateAsync\(/g)).toHaveLength(1);
    expect(nascer.indexOf("savePost.mutateAsync(")).toBeGreaterThan(nascer.indexOf("if (!nascimento.postNascidoId) {"));
    expect(nascer).toContain("nascimento.formatoAjustado = post.post.content_type === formatoPedido;");
    expect(nascer).toContain("Nada foi agendado");
    expect(dialogo).toContain("postNascidoId: string | null;");
    expect(dialogo).toContain("versao: number | null;");
    expect(dialogo).toContain("formatoAjustado: boolean;");

    // (2) O ajuste não engole erro: ele sobe e o save com horário não roda. Formato já certo não é refeito.
    const antes = fn.slice(fn.indexOf("const ajustarFormatoAntesDeAgendar"), fn.indexOf("const montarPayload"));
    expect(antes).toContain("if (!formatoPedido || post.post.content_type === formatoPedido) {\n        return post.post.version;");
    expect(antes).toContain("ajustarFormatoAprovado.mutateAsync");
    expect(antes).toContain("throw new Error(");
    expect(antes).toContain(
      "Nada foi agendado: o conteúdo ficou planejado, sem horário, no formato da mídia. Toque em Agendar de novo para repetir só a troca de formato.",
    );
    expect(antes).toContain("Nada foi agendado: o formato não mudou para ${nomeDoFormato}.");
    expect(antes).toContain("nascimento.formatoAjustado = true;");
    expect(antes).not.toContain("toast.");
    expect(antes).not.toContain("savePost");
    expect(antes).not.toMatch(/catch \([^)]*\) \{\s*\}/);
    expect(fn.match(/ajustarFormatoAprovado\.mutateAsync\(/g)).toHaveLength(1);

    // (3) Sucesso e fechamento só depois do save com horário, já no formato certo.
    const fim = fn.slice(fn.indexOf("const finishSchedule"), inicioDoFluxo);
    expect(fim).toContain("toast.success(");
    expect(fim).toContain("onOpenChange(false);");
    expect(fn.match(/toast\.success\(/g)).toHaveLength(1);
    expect(fn.match(/onOpenChange\(false\)/g)).toHaveLength(1);
    const chamadas = [...fluxo.matchAll(/finishSchedule\(/g)].map((m) => m.index!);
    expect(chamadas).toHaveLength(2);
    for (const chamada of chamadas) {
      expect(fluxo.slice(0, chamada).trimEnd().split("\n").at(-1)).toContain("await savePost.mutateAsync(attempt.prepared);");
    }
    expect(fluxo.indexOf("finishSchedule(result.post_id);")).toBeGreaterThan(agenda);

    // O fluxo inseguro saiu: nada de agendar no formato da mídia e conferir depois.
    for (const antigo of [
      "FormatoNaoConfirmadoError",
      "conferirFormatoDepois",
      "confirmarFormato",
      "Agendado, mas",
      "entrou na agenda, mas",
      "toast.warning(",
    ]) {
      expect(dialogo, antigo).not.toContain(antigo);
    }
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
