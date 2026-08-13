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

describe("regras de elegibilidade preservadas", () => {
  it("mantém o duplo gate de aprovação e a carência de 1 hora", () => {
    expect(v3).toContain("editorial_file_is_publishable");
    expect(v3).toContain("interval '1 hour'");
  });

  it("remove o content_type inválido 'design' da lista", () => {
    expect(v3).not.toMatch(/content_type IN \([^)]*'design'/);
  });
});
