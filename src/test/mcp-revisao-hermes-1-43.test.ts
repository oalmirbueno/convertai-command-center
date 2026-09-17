import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { reviewLane } from "@/lib/centralReview";
import type { CentralApproval, ReviewReport } from "@/lib/centralReview";

/**
 * Versão 1.43.0: a Revisão do Ciclo vira área de trabalho do Hermes.
 *
 * Regra do dono (2026-09-16): essa tela É a aprovação. O Hermes lê a fila,
 * prepara o pedido, registra a decisão que o dono deu no WhatsApp (com a
 * mensagem como evidência) e registra o envio. Os testes pinam as REGRAS
 * que não podem escorregar: o agente só chega pelas funções *_por_agente
 * (service_role), toda decisão dele carrega "[via Hermes]" e evidência, e
 * o envio é um registro à parte, nunca implícito na aprovação.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const servicos = ler("supabase/functions/_shared/aceleriq-operators-services.ts");
const migracao = ler("supabase/migrations/20260916120000_revisao_do_ciclo_com_hermes.sql");
const fila = ler("src/components/central/CentralReviewQueue.tsx");
const release = ler("supabase/functions/_shared/mcp-release.ts");

const NOVAS = [
  "aceleriq_central_review_fila",
  "aceleriq_central_review_preparar",
  "aceleriq_central_review_decidir",
  "aceleriq_central_review_marcar_enviado",
] as const;

const registro = tools.slice(
  tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["),
  tools.indexOf("export const TOOLS: readonly ToolDefinition[]"),
);

describe("as quatro tools da Revisão do Ciclo existem na 1.43.0", () => {
  it("cada nome está definido, entra na lista RAW_TOOLS e fecha o inputSchema", () => {
    for (const nome of NOVAS) {
      expect(tools).toContain(`'${nome}'`);
      const inicio = tools.indexOf(`name: '${nome}'`);
      const trecho = tools.slice(inicio, inicio + 5000);
      expect(trecho.slice(0, trecho.indexOf("handler:"))).toContain("additionalProperties: false");
    }
    for (const variavel of ["centralReviewFilaTool", "centralReviewPrepararTool", "centralReviewDecidirTool", "centralReviewMarcarEnviadoTool"]) {
      expect(tools).toContain(`const ${variavel}`);
      expect(registro).toContain(`  ${variavel},`);
    }
  });

  it("a fila é leitura; preparar, decidir e marcar enviado são escrita idempotente e nunca destrutiva", () => {
    const de = (nome: string) => { const i = tools.indexOf(`name: '${nome}'`); return tools.slice(i, i + 1500); };
    expect(de("aceleriq_central_review_fila")).toContain("scopes: READ");
    expect(de("aceleriq_central_review_fila")).toContain("annotations: READ_ANNOTATIONS");
    for (const nome of NOVAS.slice(1)) {
      expect(de(nome)).toContain("scopes: WRITE");
      expect(de(nome)).toContain("idempotentHint: true");
      expect(de(nome)).toContain("destructiveHint: false");
    }
  });

  it("decidir e marcar enviado exigem evidência e chave de idempotência no schema", () => {
    const decidir = tools.slice(tools.indexOf("name: 'aceleriq_central_review_decidir'"), tools.indexOf("name: 'aceleriq_central_review_marcar_enviado'"));
    expect(decidir).toContain("required: ['operator', 'approval_id', 'decision', 'evidence', 'idempotency_key']");
    expect(decidir).toContain("evidence: z.string().min(3).max(2000)");
    const enviado = tools.slice(tools.indexOf("name: 'aceleriq_central_review_marcar_enviado'"), tools.indexOf("const RAW_TOOLS"));
    expect(enviado).toContain("required: ['operator', 'approval_id', 'evidence', 'idempotency_key']");
  });

  it("o mapa do painel ensina ao agente onde a área mora", () => {
    expect(tools).toContain("rota: '/ciclo/revisao'");
    expect(tools).toContain("Esta area E a aprovacao; nao existe outra fila.");
  });

  it("a versão é 1.43.0 ou posterior", () => {
    const versao = release.match(/MCP_VERSION = '(\d+)\.(\d+)\.(\d+)'/);
    expect(versao).toBeTruthy();
    expect(Number(versao![1]) * 1000 + Number(versao![2])).toBeGreaterThanOrEqual(1043);
  });
});

describe("o serviço chama só as funções *_por_agente do banco", () => {
  it("cada wrapper aponta para o RPC do agente, nunca para o RPC do painel", () => {
    expect(servicos).toContain(".rpc('central_review_fila_para_agente'");
    expect(servicos).toContain(".rpc('central_review_preparar_por_agente'");
    expect(servicos).toContain(".rpc('central_review_decidir_por_agente'");
    expect(servicos).toContain(".rpc('central_review_marcar_enviado_por_agente'");
    expect(servicos).not.toContain(".rpc('central_review_decide'");
    expect(servicos).not.toContain(".rpc('central_review_prepare'");
  });

  it("no WhatsApp o destinatário é obrigatório; no portal o banco resolve o cliente", () => {
    const fn = servicos.slice(servicos.indexOf("export async function centralReviewPreparar("));
    expect(fn).toContain("if (input.channel === 'whatsapp' && !recipient)");
    expect(migracao).toContain("IF _destination->>'channel' = 'portal' THEN");
    expect(migracao).toContain("jsonb_build_object('channel', 'portal', 'recipient', _r.client_id::text)");
  });
});

describe("a migração fecha as portas certas", () => {
  it("as funções do agente só existem para service_role", () => {
    for (const assinatura of [
      "public.central_review_fila_para_agente(text)",
      "public.central_review_preparar_por_agente(text, uuid, jsonb, text, text, text)",
      "public.central_review_decidir_por_agente(text, uuid, text, text, text, text)",
      "public.central_review_marcar_enviado_por_agente(text, uuid, text, text)",
    ]) {
      expect(migracao).toContain(`REVOKE ALL ON FUNCTION ${assinatura} FROM PUBLIC, anon, authenticated;`);
      expect(migracao).toContain(`GRANT EXECUTE ON FUNCTION ${assinatura} TO service_role;`);
    }
    // Marcar enviado tambem serve a pessoa no painel.
    expect(migracao).toContain("GRANT EXECUTE ON FUNCTION public.central_review_marcar_enviado(uuid, text, text) TO authenticated, service_role;");
  });

  it("assumir o administrador exige operador ativo e configuração explícita, só na transação", () => {
    const fn = migracao.slice(migracao.indexOf("CREATE OR REPLACE FUNCTION app_private.agente_assume_admin"), migracao.indexOf("-- 1) A fila"));
    expect(fn).toContain("IF _op.status <> 'active' THEN RAISE EXCEPTION 'operator_paused");
    expect(fn).toContain("WHERE key = 'central_review_admin'");
    expect(fn).toContain("set_config('request.jwt.claims', json_build_object('sub', _admin, 'role', 'authenticated')::text, true)");
    expect(fn).toContain("set_config('app.agent_actor', _op.slug, true)");
  });

  it("toda decisão do agente carrega quem foi e a evidência; sem evidência não decide", () => {
    const fn = migracao.slice(migracao.indexOf("-- 3) Decidir"), migracao.indexOf("-- 4) Marcar"));
    expect(fn).toContain("CENTRAL_EVIDENCE_REQUIRED");
    expect(fn).toContain("'[via Hermes ' || lower(btrim(_operator_slug)) || ']'");
    expect(fn).toContain("' | evidência: ' || btrim(_evidence)");
    expect(fn).toContain("RETURN public.central_review_decide(_a.id, _a.client_id, _a.payload_version, _a.payload_hash, _decision, _nota, _idempotency_key)");
  });

  it("marcar enviado só aceita aprovado, é idempotente pela chave e avisa o dono", () => {
    const fn = migracao.slice(migracao.indexOf("-- 4) Marcar"), migracao.indexOf("CREATE OR REPLACE FUNCTION public.central_review_marcar_enviado_por_agente"));
    expect(fn).toContain("PERFORM app_private.central_review_admin();");
    expect(fn).toContain("IF _a.status <> 'aprovado' THEN RAISE EXCEPTION 'CENTRAL_NOT_APPROVED");
    expect(fn).toContain("IF _a.execution_run_key = _idempotency_key THEN");
    expect(fn).toContain("SET status = 'enviado', updated_at = now() WHERE approval_id = _a.id");
    expect(fn).toContain("'central_review_enviada'");
    expect(fn).toContain("/ciclo/revisao?client=");
  });

  it("o aviso de ordem executada dos operadores ignora pedido central (o envio central tem aviso próprio)", () => {
    const fn = migracao.slice(migracao.indexOf("CREATE OR REPLACE FUNCTION public.operator_avisar_ordem_executada"));
    expect(fn).toContain("IF new.origin = 'central' THEN\n    RETURN new;");
  });
});

describe("a tela reflete os dois lados", () => {
  it("tem a faixa Enviados, o registro de envio pela pessoa e o pedido pronto para o Hermes", () => {
    expect(fila).toContain('{ value: "enviado", label: "Enviados" }');
    expect(fila).toContain('callReviewRpc("central_review_marcar_enviado"');
    expect(fila).toContain("Marcar como enviado");
    expect(fila).toContain("Copiar pedido para o Hermes");
    expect(fila).toContain("aceleriq_central_review_marcar_enviado");
  });

  it("a mensagem para enviar é a congelada no pedido, não o rascunho editado depois", () => {
    expect(fila).toContain("approval.payload.report.summary");
    expect(fila).not.toContain("currentReport?.summary ?? \"\", approval");
  });

  it("um pedido enviado cai na faixa Enviados antes de qualquer outra regra", () => {
    const report: ReviewReport = { id: "r", client_id: "c", title: "t", created_at: "2026-09-16T00:00:00Z", review_version: 2, summary: "m", next_steps: "p", metrics: { central_review_source: {} } };
    const base = { id: "a", report_id: "r", client_id: "c", payload_version: 2, payload_hash: "h", status: "aprovado", created_at: "2026-09-16T00:00:00Z", payload: { report, destination: { channel: "whatsapp", recipient: "g" } } } as CentralApproval;
    expect(reviewLane(report, base)).toBe("aguardando");
    expect(reviewLane(report, { ...base, executed_at: "2026-09-16T10:00:00Z" })).toBe("enviado");
    // Enviado com versao diferente continua enviado: o que foi ao cliente foi o congelado.
    expect(reviewLane({ ...report, review_version: 3 }, { ...base, executed_at: "2026-09-16T10:00:00Z" })).toBe("enviado");
  });
});
