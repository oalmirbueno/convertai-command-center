import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_DE_QUALIFICACAO,
  CLASSES_DO_LEAD,
  METRICAS,
  leadQualificado,
  realizadoDoMes,
  rotuloDaClasse,
  type Lead,
} from "@/lib/comercial";

/**
 * A classe e a qualificação da oportunidade.
 *
 * O pedido veio com réguas explícitas: exatamente três classes, campo vazio
 * significa "não confirmado" (nunca "zero" ou "não existe"), nenhum registro
 * inventado no backfill, e o realizado de clientes recorrentes lido do
 * Financeiro em vez de estimado pelo funil. Cada régua vira um teste aqui,
 * porque cada uma delas quebraria em silêncio num refactor.
 */

const leadDe = (extra: Partial<Lead>): Lead => ({
  id: "l1",
  name: "Lead",
  company: null,
  email: null,
  whatsapp: null,
  origin: "manual",
  campaign_id: null,
  quiz_submission_id: null,
  stage: "novo",
  monthly_value: 0,
  one_off_value: 0,
  owner_id: null,
  next_action: null,
  next_action_at: null,
  notes: null,
  lost_reason: null,
  won_client_id: null,
  closed_at: null,
  created_at: "2026-08-01T00:00:00Z",
  expected_close_date: null,
  organization_id: null,
  contact_id: null,
  classe: null,
  qualificacao: {},
  ...extra,
});

describe("as três classes da oportunidade", () => {
  it("são exatamente cliente atual, upsell e novo prospect", () => {
    expect(CLASSES_DO_LEAD.map((c) => c.id)).toEqual([
      "cliente_atual",
      "upsell",
      "novo_prospect",
    ]);
  });

  it("classe ausente se apresenta como não confirmado, nunca como erro", () => {
    expect(rotuloDaClasse(null)).toBe("não confirmado");
    expect(rotuloDaClasse("cliente_atual")).toBe("Cliente atual");
    expect(rotuloDaClasse("qualquer_coisa")).toBe("não confirmado");
  });

  it("a migration não inventa classe nem altera linha existente", () => {
    const sql = readFileSync(
      "supabase/migrations/20260825120000_comercial_classe_qualificacao.sql",
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS classe");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS qualificacao");
    expect(sql).toContain("'cliente_atual', 'upsell', 'novo_prospect'");
    // Idempotente e sem backfill: rodar duas vezes não muda nada, e nenhum
    // UPDATE preenche classe em massa — chute em massa parece resposta.
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).toContain("IF NOT EXISTS (");
  });
});

describe("os campos de qualificação", () => {
  it("são os do pedido, na ordem da conversa", () => {
    expect(CAMPOS_DE_QUALIFICACAO.map((c) => c.id)).toEqual([
      "aderencia_icp",
      "problema",
      "orcamento",
      "autoridade",
      "urgencia",
      "recorrencia",
      "aprovacao",
    ]);
  });

  it("o editor mostra o vazio como não confirmado e nunca pré-preenche", () => {
    const editor = readFileSync("src/pages/AdminComercial.tsx", "utf8");
    expect(editor).toContain("vazio significa não confirmado");
    expect(editor).toContain('SelectItem value="nao_confirmado"');
    // O estado inicial parte do que o lead JÁ tem; nada de default esperto.
    expect(editor).toContain('classe: lead?.classe || ""');
  });
});

describe("qualificada de verdade: classe, dono e próximo passo", () => {
  it("exige as três coisas ao mesmo tempo", () => {
    const completo = leadDe({ classe: "novo_prospect", owner_id: "u1" });
    expect(leadQualificado(completo, true)).toBe(true);
    expect(leadQualificado(completo, false)).toBe(false);
    expect(leadQualificado(leadDe({ owner_id: "u1" }), true)).toBe(false);
    expect(leadQualificado(leadDe({ classe: "upsell" }), true)).toBe(false);
  });

  it("o funil separa por classe e mostra o placar por etapa", () => {
    const funil = readFileSync("src/components/comercial/FunilKanban.tsx", "utf8");
    expect(funil).toContain("Sem classe");
    expect(funil).toContain("qualificadas");
    expect(funil).toContain("rotuloDaClasse(lead.classe)");
  });
});

describe("meta de clientes recorrentes lida do Financeiro", () => {
  it("existe como métrica editável, com a fonte dita na tela", () => {
    const metrica = METRICAS.find((m) => m.id === "clientes_recorrentes");
    expect(metrica?.fonte).toContain("Financeiro");
    expect(metrica?.dinheiro).toBe(false);
  });

  it("o realizado é a contagem do Financeiro, não uma conta sobre o funil", () => {
    // Dez leads ganhos no funil não mudam o número: só a contagem passada,
    // que vem de financial_entries, vale.
    const leads = Array.from({ length: 10 }, (_, i) =>
      leadDe({ id: `l${i}`, stage: "ganho", closed_at: "2026-08-10T00:00:00Z" }),
    );
    const feito = realizadoDoMes({
      metrica: "clientes_recorrentes",
      leads,
      periodo: "2026-08-01",
      receitaFinanceiro: 99999,
      clientesRecorrentes: 3,
    });
    expect(feito).toBe(3);
  });

  it("a leitura no banco exige regra de recorrência e cliente, sem cancelados", () => {
    const lib = readFileSync("src/lib/comercial.ts", "utf8");
    expect(lib).toContain('.not("recurring_rule_id", "is", null)');
    expect(lib).toContain('.not("client_id", "is", null)');
    const trecho = lib.slice(lib.indexOf("clientesRecorrentesDoMes"));
    expect(trecho).toContain('.is("cancelled_at", null)');
  });
});
