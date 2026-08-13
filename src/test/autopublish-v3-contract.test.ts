import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrato do motor de publicação v3.
 *
 * As fragilidades que a auditoria encontrou não podem voltar em silêncio:
 * post duplicado por timeout, carrossel fora de ordem, falha invisível e job
 * morto sem retry. Cada teste aqui trava uma dessas garantias no SQL.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const v3 = read("supabase/migrations/20260813210000_autopublish_v3_hardening.sql");
const publishAll = read(
  "supabase/migrations/20260813220000_autopublish_publish_all_scheduled.sql",
);
const v4 = read("supabase/migrations/20260813230000_autopublish_v4_signed_urls.sql");
const v5 = read("supabase/migrations/20260814000000_autopublish_v5_fast_routes.sql");
const captionFix = read(
  "supabase/migrations/20260814010000_autopublish_fix_caption_encoding.sql",
);

describe("publicação nunca duplica", () => {
  it("o passo de publicação registra que foi despachado", () => {
    expect(v3).toContain("publish_dispatched = true");
  });

  it("em erro ou resposta perdida no publish, vai para verificação, nunca reenvia às cegas", () => {
    expect(v3).toMatch(/WHEN stage = 'publish' AND publish_dispatched THEN 'verify'/);
    // As duas rotas de dúvida: resposta perdida e erro/timeout.
    const matches = v3.match(/publish_dispatched THEN 'verify'/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("verificação só reenvia quando o Instagram confirma FINISHED (não publicado)", () => {
    expect(v3).toContain("_status_code = 'PUBLISHED'");
    expect(v3).toContain("_status_code = 'FINISHED'");
    expect(v3).toContain("'recover'");
  });

  it("o retry de job despachado recomeça pela verificação", () => {
    expect(v3).toMatch(/WHEN _job\.publish_dispatched AND _job\.container_id IS NOT NULL THEN 'verify'/);
  });
});

describe("carrossel na ordem aprovada", () => {
  it("a ordem congelada do agendamento manda; o nome do arquivo é só reserva", () => {
    expect(v3).toContain("social_private.editorial_publication_assets");
    expect(v3).toContain("ORDER BY asset.position");
    expect(v3).toContain("autopublish_ordered_urls(_pub.id, _pub.file_id)");
    // O fallback continua existindo para agendamentos antigos.
    expect(v3).toContain("social_private.autopublish_carousel_urls(_root_file_id)");
  });
});

describe("falha visível e recuperável", () => {
  it("toda falha definitiva baixa a publicação oficial (transition fail)", () => {
    expect(v3).toContain("p_action => 'fail'");
    expect(v3).toContain("autopublish_mark_failed");
  });

  it("a baixa oficial roda em bloco próprio e não desfaz o done", () => {
    expect(v3).toMatch(/Post no ar; baixa oficial falhou/);
  });

  it("existe retry para a equipe, com trava de acesso por cliente", () => {
    expect(v3).toContain("FUNCTION public.retry_autopublish");
    expect(v3).toContain("public.is_staff(_actor)");
    expect(v3).toContain("public.can_access_client(_job.client_id)");
  });
});

describe("robustez de rede", () => {
  it("timeouts explícitos: 20s para escrever, 10s para ler", () => {
    expect(v3).toContain("timeout_milliseconds := 20000");
    expect(v3).toContain("timeout_milliseconds := 10000");
  });

  it("resposta perdida é retomada depois de 10 minutos, não esperada para sempre", () => {
    expect(v3).toContain("interval '10 minutes'");
    expect(v3).toContain("Resposta da Meta perdida");
  });

  it("tentativas são contadas por passo, com limite próprio", () => {
    expect(v3).toContain("step_attempts");
    expect(v3).toMatch(/_step_limit constant smallint := 4/);
  });

  it("story vai para stories, não para o feed", () => {
    expect(v3).toContain("media_type=STORIES");
  });
});

describe("agendou e aprovou, publica", () => {
  it("a marcacao interna de entrega deixa de ser trava de entrada", () => {
    // O caso real: post agendado ficou preso porque nasceu 'manual' (dois
    // caminhos do painel nem enviavam a marcacao). Decisao de produto:
    // agendamento de Instagram aprovado E para publicar sozinho.
    expect(publishAll).toContain("delivery_mode IN (''manual'', ''automatic'')");
    expect(publishAll).toContain("pg_get_functiondef");
    // Patch idempotente: rodar duas vezes nao quebra.
    expect(publishAll).toContain("Patch ja aplicado");
  });
});

describe("midia com link assinado (v4)", () => {
  it("a Meta recebe link ASSINADO, nunca o link publico de bucket privado", () => {
    // O erro real de producao: "Falha ao baixar midia... /object/public/files".
    // O bucket e privado; o motor agora assina antes de criar o container.
    expect(v4).toContain("/storage/v1/object/sign/files");
    expect(v4).toContain("'expiresIn', 21600");
    expect(v4).toContain("autopublish_service_key");
    expect(v4).toContain("email_queue_service_role_key");
  });

  it("assinatura em lote, na ordem congelada, com fallback por nome e por URL externa", () => {
    expect(v4).toContain("autopublish_storage_paths");
    expect(v4).toContain("ORDER BY asset.position");
    expect(v4).toContain("parent_file_id = _root_file_id");
    // Arquivo sem storage_path (link externo) continua publicavel.
    expect(v4).toContain("Sem storage_path (link externo http)");
  });

  it("mantem as garantias da v3: verify, retry por passo e falha oficial", () => {
    expect(v4).toContain("publish_dispatched THEN 'verify'");
    expect(v4).toContain("_step_limit constant smallint := 4");
    expect(v4).toContain("autopublish_mark_failed");
    expect(v4).toContain("delivery_mode IN ('manual', 'automatic')");
  });
});

describe("rota rapida (v5) e legenda intacta", () => {
  it("cartoes do carrossel saem em paralelo e o passo emenda na mesma rodada", () => {
    expect(v5).toContain("child_request_ids");
    expect(v5).toContain("FOR _pass IN 1..3 LOOP");
    // Cartao que falha e refeito individualmente, nao derruba o lote.
    expect(v5).toContain("Cartao ' || _idx || ' refeito");
  });

  it("legenda codifica um %XX por BYTE: acento e emoji chegam intactos", () => {
    // O bug real: 'e com acento' virava %C3A9 (bytes colados) e o Instagram
    // publicava a legenda cheia de caracteres quebrados.
    expect(captionFix).toContain("'(..)', '%\\1', 'g'");
    expect(captionFix).toContain("'%C3%A9'");
  });
});

describe("regras de elegibilidade preservadas", () => {
  it("mantém o duplo gate de aprovação e a carência de 1 hora", () => {
    expect(v3).toContain("editorial_file_is_publishable");
    expect(v3).toContain("interval '1 hour'");
  });

  it("remove o content_type inválido 'design' da lista", () => {
    expect(v3).not.toMatch(/content_type IN \([^)]*'design'/);
  });
});
