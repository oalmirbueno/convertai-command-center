import { beforeAll, describe, expect, it, vi } from "vitest";
import { webcrypto, createHash } from "node:crypto";
import type { DossieDoCliente } from "@/lib/dossieGeral";
import {
  applyCentralAiDraft, assertCentralReviewSource, captureCentralReviewSource,
  centralFactsProvenance, parseCentralReviewSource, readCentralReviewSource,
  persistCentralReviewDraft,
  readCentralReportPage,
  captureCentralGenerationContext, centralGenerationFacts, centralCachedPlanFacts,
  type CentralReviewSource,
  type CentralGenerationScope,
} from "@/lib/centralReviewSource";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
beforeAll(() => { vi.stubGlobal("crypto", webcrypto); });

const source: CentralReviewSource = {
  dossier_id: "dossier-a", dossier_version: 2,
  dossier_updated_at: "2026-09-14T15:00:00Z", scope_hash: "a".repeat(64),
};
const dossier: DossieDoCliente = {
  geral: { id: "dossier-a", client_id: "client-a", project_id: null, dossier_type: "contexto", version: 2,
    summary: "Resumo interno", content: "Contexto privado atualizado", updated_at: source.dossier_updated_at },
  anterior: null, outros: [], mudancas: [], substituto: false,
};
const draft = { title: "Ritual", summary: "Mensagem de reserva", next_steps: "Passo do template", metrics: { ritual_type: "rota_semana" } };
const scope: CentralGenerationScope = {
  client: { id: "client-a", full_name: "Cliente Sintético", company_name: "Empresa Sintética", created_at: "2026-09-01T00:00:00Z", deleted_at: null,
    plan_name: "Plano atual", plan_status: "active", services_config: { social: true, trafego: true } },
  projects: [{ id: "project-a", client_id: "client-a", name: "Projeto atual", status: "in_progress", project_type: "traffic",
    scope: "Campanha regional", objectives: "Objetivo atual", description: "Contexto atual do projeto", updated_at: "2026-09-14T15:00:00Z", deleted_at: null }],
};

describe("geração usa o cliente inteiro da fonte atual", () => {
  it("relê perfil e projetos dentro da janela de fonte estável", async () => {
    const calls: string[] = [];
    const captured = await captureCentralGenerationContext("client-a", {
      readSource: async () => { calls.push("source"); return source; },
      readDossier: async () => { calls.push("dossier"); return dossier; },
      readScope: async () => { calls.push("scope"); return scope; },
    });
    expect(calls).toEqual(["source", "dossier", "source", "scope", "source"]);
    expect(captured.client.services_config).toEqual({ social: true, trafego: true });
    expect(captured.projects[0].scope).toBe("Campanha regional");
  });

  it("recusa mudança de escopo/projeto durante a leitura em vez de rotular dados antigos", async () => {
    await expect(captureCentralGenerationContext("client-a", {
      readSource: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, scope_hash: "b".repeat(64) }),
      readDossier: async () => dossier, readScope: async () => scope,
    })).rejects.toThrow("nova prévia");
  });

  it("erro de leitura do escopo não usa cadastro antigo como reserva", async () => {
    await expect(captureCentralGenerationContext("client-a", {
      readSource: async () => source, readDossier: async () => dossier,
      readScope: async () => { throw new Error("escopo indisponível"); },
    })).rejects.toThrow("escopo indisponível");
  });

  it("recusa projetos ou dossiês complementares de outro cliente", async () => {
    await expect(captureCentralGenerationContext("client-a", {
      readSource: async () => source, readDossier: async () => dossier,
      readScope: async () => ({ ...scope, projects: [{ ...scope.projects[0], client_id: "client-b" }] }),
    })).rejects.toThrow("fora do cliente");
    await expect(captureCentralGenerationContext("client-a", {
      readSource: async () => source, readScope: async () => scope,
      readDossier: async () => ({ ...dossier, outros: [{ ...dossier.geral!, id: "other-b", client_id: "client-b" }] }),
    })).rejects.toThrow("fora do cliente");
  });

  it("inclui escopo e contexto dos projetos com prioridade do dossiê geral", () => {
    const captured = { source, ...scope, dossier: { ...dossier, outros: [{ ...dossier.geral!, id: "other-a", project_id: "project-a", content: "Complemento atualizado" }] } };
    const facts = centralGenerationFacts(captured, "Números do painel", "Decisão anterior", "Anotação histórica");
    expect(facts).toContain("Plano contratado atual: Plano atual");
    expect(facts).toContain("Campanha regional");
    expect(facts).toContain("Objetivo atual");
    expect(facts).toContain("Complemento atualizado");
    expect(facts.indexOf("Contexto privado atualizado")).toBeLessThan(facts.indexOf("Complemento atualizado"));
    expect(facts.indexOf("Contexto privado atualizado")).toBeLessThan(facts.indexOf("Números do painel"));
    expect(facts).toContain("não redefinem o escopo atual");
  });

  it("não injeta promessas do plano antigo sem versão na geração capturada", () => {
    const oldPlan = { foco: "Prioridade antiga", feito: ["Entrega antiga"], proximos: [{ titulo: "Escopo antigo", passo: "Promessa desatualizada" }] };
    const panelFacts = centralCachedPlanFacts(oldPlan, source);
    const facts = centralGenerationFacts({ source, ...scope, dossier }, panelFacts);
    expect(facts).not.toContain("Promessa desatualizada");
    expect(facts).not.toContain("Prioridade antiga");
    expect(centralCachedPlanFacts(oldPlan)).toContain("Promessa desatualizada");
  });

  it("o corte12k preserva a prioridade canônica e metadados não carregam conteúdo interno", async () => {
    const facts = centralGenerationFacts({ source, ...scope, dossier }, "Número operacional ".repeat(1000));
    const result = await centralFactsProvenance(facts);
    expect(result.facts).toContain("Contexto privado atualizado");
    expect(result.facts.length).toBe(12000);
    expect(result.metadata.facts_truncated).toBe(true);
    expect(result.metadata.facts_sha256).toBe(createHash("sha256").update(facts.slice(0, 12000)).digest("hex"));
    expect(JSON.stringify(result.metadata)).not.toContain("Contexto privado atualizado");
    expect(JSON.stringify(result.metadata)).not.toContain("Empresa Sintética");
  });
});

describe("feed legado durante a implantação", () => {
  it.each(["42703", "PGRST204"])("coluna review_version ausente (%s) relê somente a projeção legada", async (code) => {
    const legacy = { data: [{ id: "legacy" }], error: null };
    const load = vi.fn().mockResolvedValueOnce({ data: null, error: { code, message: "reports.review_version does not exist" } }).mockResolvedValueOnce(legacy);
    await expect(readCentralReportPage(load)).resolves.toEqual(legacy);
    expect(load.mock.calls).toEqual([[true], [false]]);
  });
  it.each([
    { code: "42501", message: "permission denied review_version" },
    { code: "42703", message: "reports.other_column does not exist" },
    { code: "PGRST204", message: "another_column not found" },
  ])("não transforma outra falha em sucesso: $code $message", async (error) => {
    const result = { data: null, error };
    const load = vi.fn().mockResolvedValue(result);
    await expect(readCentralReportPage(load)).resolves.toEqual(result);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("mantém a versão quando a coluna existe", async () => {
    const result = { data: [{ id: "new", review_version: 3 }], error: null };
    const load = vi.fn().mockResolvedValue(result);
    await expect(readCentralReportPage(load)).resolves.toEqual(result);
    expect(load.mock.calls).toEqual([[true]]);
  });
});

describe("fonte persistida usada na geração", () => {
  it("lê pelo cliente exato e recusa ausência da migration sem fingir sucesso", async () => {
    rpc.mockResolvedValueOnce({ data: source, error: null });
    await expect(readCentralReviewSource("client-a")).resolves.toEqual(source);
    expect(rpc).toHaveBeenLastCalledWith("central_review_source", { _client_id: "client-a" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
    await expect(readCentralReviewSource("client-a")).rejects.toThrow("implantação");
  });

  it("retorna o dossiê fresco entre duas leituras estáveis da fonte", async () => {
    const order: string[] = [];
    const dependencies = {
      readSource: vi.fn(async () => { order.push("source"); return source; }),
      readDossier: vi.fn(async () => { order.push("dossier"); return dossier; }),
    };
    const captured = await captureCentralReviewSource("client-a", dependencies);
    expect(order).toEqual(["source", "dossier", "source"]);
    expect(captured.dossier.geral?.content).toBe("Contexto privado atualizado");
    expect(dependencies.readDossier).toHaveBeenCalledWith("client-a");
  });

  it("não atribui uma fonte nova ao dossiê antigo do cache", async () => {
    await expect(captureCentralReviewSource("client-a", {
      readSource: async () => source,
      readDossier: async () => ({ ...dossier, geral: { ...dossier.geral!, version: 1 } }),
    })).rejects.toThrow("contexto do cliente mudou");
  });

  it("recusa contexto de outro cliente mesmo com a mesma versão", async () => {
    await expect(captureCentralReviewSource("client-a", {
      readSource: async () => source,
      readDossier: async () => ({ ...dossier, geral: { ...dossier.geral!, client_id: "client-b" } }),
    })).rejects.toThrow("contexto do cliente mudou");
  });

  it("não apresenta progressão incompleta quando a leitura da versão anterior falha", async () => {
    await expect(captureCentralReviewSource("client-a", {
      readSource: async () => source,
      readDossier: async () => ({ ...dossier, geral: { ...dossier.geral!, prior_version_id: "previous-a" } }),
    })).rejects.toThrow("versão anterior");
  });

  it("bloqueia alteração do escopo durante a leitura ou geração", async () => {
    const changed = { ...source, scope_hash: "b".repeat(64) };
    await expect(captureCentralReviewSource("client-a", {
      readSource: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(changed),
      readDossier: async () => dossier,
    })).rejects.toThrow("contexto do cliente mudou");
    await expect(assertCentralReviewSource("client-a", source, async () => changed)).rejects.toThrow("nova prévia");
  });

  it("aceita timestamps equivalentes do Postgres e do PostgREST", async () => {
    const equivalent = { ...source, dossier_updated_at: "2026-09-14T15:00:00+00:00" };
    await expect(captureCentralReviewSource("client-a", {
      readSource: async () => equivalent, readDossier: async () => dossier,
    })).resolves.toMatchObject({ source: equivalent });
  });

  it("distingue ausência real de dossiê de erro de leitura", async () => {
    const empty = { ...source, dossier_id: null, dossier_version: null, dossier_updated_at: null };
    await expect(captureCentralReviewSource("client-a", {
      readSource: async () => empty,
      readDossier: async () => ({ geral: null, anterior: null, outros: [], mudancas: [], substituto: false }),
    })).resolves.toMatchObject({ source: empty });
    await expect(captureCentralReviewSource("client-a", {
      readSource: async () => empty, readDossier: async () => { throw new Error("offline"); },
    })).rejects.toThrow("offline");
  });

  it("allowlist descarta qualquer corpo interno devolvido por engano", () => {
    const safe = parseCentralReviewSource({ ...source, content: "PRIVADO", prompt: "INTERNO" });
    expect(Object.keys(safe).sort()).toEqual(["dossier_id", "dossier_updated_at", "dossier_version", "scope_hash"]);
    expect(JSON.stringify(safe)).not.toContain("PRIVADO");
    expect(() => parseCentralReviewSource({ ...source, scope_hash: "" })).toThrow();
  });
});

describe("persistência da prévia exata", () => {
  const pending = {
    ...draft, id: "preview-a", client_id: "client-a", project_id: "project-a",
    metrics: { central_review_source: { ...source } },
  };

  it("confere a fonte antes da gravação e não grava quando mudou", async () => {
    const storage = { insert: vi.fn(), find: vi.fn() };
    await expect(persistCentralReviewDraft(pending, {
      readSource: async () => ({ ...source, scope_hash: "b".repeat(64) }), storage,
    })).rejects.toThrow("nova prévia");
    expect(storage.insert).not.toHaveBeenCalled();
  });

  it("retry de resposta ambígua usa o mesmo UUID e reconhece apenas conteúdo idêntico", async () => {
    const storage = {
      insert: vi.fn().mockRejectedValueOnce(new Error("network interrupted"))
        .mockResolvedValueOnce({ error: { code: "23505" } }),
      find: vi.fn().mockResolvedValue({ data: pending, error: null }),
    };
    const dependencies = { readSource: async () => source, storage };
    await expect(persistCentralReviewDraft(pending, dependencies)).rejects.toThrow("network interrupted");
    await expect(persistCentralReviewDraft(pending, dependencies)).resolves.toBeUndefined();
    expect(storage.insert.mock.calls.map(([row]) => row.id)).toEqual(["preview-a", "preview-a"]);
    expect(storage.find).toHaveBeenCalledWith("preview-a");
  });

  it("não aceita o UUID de uma prévia com outro texto ou cliente", async () => {
    for (const different of [{ ...pending, summary: "Outra edição" }, { ...pending, client_id: "client-b" }]) {
      await expect(persistCentralReviewDraft(pending, {
        readSource: async () => source,
        storage: {
          insert: async () => ({ error: { code: "23505" } }),
          find: async () => ({ data: different, error: null }),
        },
      })).rejects.toThrow("outra edição");
    }
  });

  it("erro de persistência não vira sucesso e não repete a escrita automaticamente", async () => {
    const storage = {
      insert: vi.fn().mockResolvedValue({ error: { code: "42501" } }), find: vi.fn(),
    };
    await expect(persistCentralReviewDraft(pending, { readSource: async () => source, storage })).rejects.toThrow("prévia foi preservada");
    expect(storage.insert).toHaveBeenCalledTimes(1);
    expect(storage.find).not.toHaveBeenCalled();
  });
});

describe("proveniência dos fatos enviados e resposta do escritor", () => {
  it("hasheia somente o slice que ritual-writer recebe e registra truncamento", async () => {
    const text = "a".repeat(11999) + "ç" + "TRECHO NÃO ENVIADO";
    const result = await centralFactsProvenance(text);
    expect(result.facts.length).toBe(12000);
    expect(result.metadata.facts_sha256).toBe(createHash("sha256").update(text.slice(0, 12000)).digest("hex"));
    expect(result.metadata.facts_truncated).toBe(true);
    expect(result.metadata.facts_original_characters).toBe(text.length);
    expect(JSON.stringify(result.metadata)).not.toContain("TRECHO");
  });

  it("não alega truncamento quando todos os fatos cabem", async () => {
    expect((await centralFactsProvenance("Fato real")).metadata.facts_truncated).toBe(false);
  });

  it("não mistura body da IA com próxima etapa do template", () => {
    const result = applyCentralAiDraft(draft, { body: "Mensagem da IA", model: "gpt-4.1" });
    expect(result.summary).toBe("Mensagem da IA");
    expect(result.next_steps).toBe("");
    expect(result.metrics).toMatchObject({ central_review_next_steps_required: true, written_by: "ai" });
    expect(draft.next_steps).toBe("Passo do template");
  });

  it("usa a próxima etapa explícita se o escritor fornecer", () => {
    const result = applyCentralAiDraft(draft, { body: "Mensagem da IA", next_steps: "  Etapa nova  " });
    expect(result.next_steps).toBe("Etapa nova");
    expect(result.metrics).toMatchObject({ central_review_next_steps_required: false });
  });

  it("falha do escritor conserva o rascunho de reserva sem marcar como IA", () => {
    expect(applyCentralAiDraft(draft, { body: null })).toBe(draft);
  });
});
