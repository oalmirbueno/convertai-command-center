import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** 05/11/2026 (dono): o ganho do CRM pede e-mail e WhatsApp, monta o cadastro e envia o convite, igual ao Novo cliente. */
const banco = vi.hoisted(() => ({ perfil: null as null | { id: string }, invocar: vi.fn(), rpc: vi.fn(), ilike: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
    from: () => ({
      select: () => ({ ilike: (_c: string, v: string) => { banco.ilike(v); return { maybeSingle: async () => ({ data: banco.perfil, error: null }) }; } }),
    }),
    functions: { invoke: banco.invocar },
    rpc: banco.rpc,
  },
}));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: vi.fn(), webhooks: { onboardClient: "x" } }));
vi.mock("@/components/admin/CreateClientModal", () => ({ generatePassword: () => "senha-de-teste" }));

import { cadastrarNoGanho } from "@/lib/ganhoDoLead";
import JanelaDoGanho, { mesmoDiaNoProximoMes } from "@/components/comercial/JanelaDoGanho";
import type { Lead } from "@/lib/comercial";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261105170000_crm_ganho_cadastra_cliente.sql"), "utf8");
const dados = { lead: { id: "l1" }, nome: " Ana ", empresa: "Ana Doces", email: " ANA@doces.com ", whatsapp: "41999", fechamento: { entrada_recebida: 500, entrada_parcelas: 2, mensalidade_inicio: "2026-12-01" }, mensalidadeVencimento: "2026-12-05", mensalidadePaga: false };

beforeEach(() => {
  cleanup();
  banco.perfil = null;
  banco.invocar.mockReset();
  banco.rpc.mockReset();
  banco.ilike.mockReset();
  banco.invocar.mockImplementation(async (nome: string) => (nome === "manage-team" ? { data: { user_id: "c1" }, error: null } : { data: {}, error: null }));
  banco.rpc.mockImplementation(async (nome: string) => (nome === "crm_ganho_cadastrar" ? { data: { client_id: "c1", vinculado: false }, error: null } : { data: { token: "a".repeat(64) }, error: null }));
});

describe("cadastro no ganho", () => {
  it("conta nova: cria a conta, grava tudo no banco e envia o convite, nessa ordem", async () => {
    const r = await cadastrarNoGanho(dados);
    expect(banco.invocar.mock.calls[0][0]).toBe("manage-team");
    expect(banco.invocar.mock.calls[0][1].body).toMatchObject({ action: "create", email: "ana@doces.com", full_name: "Ana", role: "client" });
    expect(banco.rpc.mock.calls[0][0]).toBe("crm_ganho_cadastrar");
    expect(banco.rpc.mock.calls[0][1]).toMatchObject({ p_lead_id: "l1", p_client_id: "c1", p_entrada_recebida: 500, p_entrada_parcelas: 2, p_mensalidade_vencimento: "2026-12-05" });
    expect(banco.rpc.mock.calls[1][0]).toBe("issue_first_access_token");
    expect(banco.invocar.mock.calls[1][0]).toBe("send-transactional-email");
    expect(banco.invocar.mock.calls[1][1].body).toMatchObject({ templateName: "client-welcome", recipientEmail: "ana@doces.com", idempotencyKey: "client-welcome-c1" });
    expect(r).toMatchObject({ clientId: "c1", contaNova: true, conviteEnviado: true });
  });

  it("e-mail que já tem conta: não cria outra nem manda convite (repetir depois de falha também cai aqui)", async () => {
    banco.perfil = { id: "c9" };
    const r = await cadastrarNoGanho(dados);
    expect(banco.invocar).not.toHaveBeenCalled();
    expect(banco.rpc).toHaveBeenCalledTimes(1);
    expect(banco.rpc.mock.calls[0][1]).toMatchObject({ p_client_id: "c9" });
    expect(r).toMatchObject({ contaNova: false, conviteEnviado: false });
  });

  it("curinga no e-mail não casa com outra pessoa", async () => {
    await cadastrarNoGanho({ ...dados, email: "ana_x%@doces.com" });
    expect(banco.ilike).toHaveBeenCalledWith("ana\\_x\\%@doces.com");
  });

  it("banco recusou: nada de convite, e a tela mostra o motivo", async () => {
    banco.rpc.mockResolvedValueOnce({ data: null, error: { message: "Só o admin cadastra cliente pelo ganho" } });
    await expect(cadastrarNoGanho(dados)).rejects.toThrow("Só o admin");
    expect(banco.invocar.mock.calls.map((c) => c[0])).toEqual(["manage-team"]);
  });

  it("e-mail que falhou não desfaz o ganho e deixa o link para copiar", async () => {
    banco.invocar.mockImplementation(async (nome: string) => (nome === "manage-team" ? { data: { user_id: "c1" }, error: null } : { data: null, error: new Error("fora") }));
    const r = await cadastrarNoGanho(dados);
    expect(r.conviteEnviado).toBe(false);
    expect(r.linkDoConvite).toContain("/primeiro-acesso?token=");
  });
});

describe("tela do ganho", () => {
  const lead = { id: "l1", name: "Ana", company: "Ana Doces", email: "ana@doces.com", whatsapp: "41999", stage: "proposta", monthly_value: 300, one_off_value: 1000, closed_at: null, won_client_id: null } as unknown as Lead;
  const abrir = (onConcluido = vi.fn()) => render(
    <QueryClientProvider client={new QueryClient()}>
      <JanelaDoGanho lead={lead} clientes={[{ id: "c5", nome: "Cliente Velho" }]} onCancelar={vi.fn()} onConcluido={onConcluido} />
    </QueryClientProvider>,
  );

  it("já vem preenchida com o que o lead tem e pede o que falta", () => {
    abrir();
    expect((screen.getByDisplayValue("ana@doces.com") as HTMLInputElement).type).toBe("email");
    expect(screen.getByDisplayValue("41999")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar e cadastrar" })).toBeTruthy();
  });

  it("confirma, cadastra e mostra o resultado com o convite", async () => {
    abrir();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e cadastrar" }));
    await waitFor(() => expect(screen.getByText(/Cliente cadastrado e lançado no Financeiro/)).toBeTruthy());
    expect(screen.getByText(/Convite de primeiro acesso enviado para ana@doces.com/)).toBeTruthy();
    expect(banco.rpc.mock.calls[0][1]).toMatchObject({ p_entrada_recebida: null, p_mensalidade_paga: false });
  });

  it("sem e-mail válido não cria nada", async () => {
    abrir();
    fireEvent.change(screen.getByDisplayValue("ana@doces.com"), { target: { value: "sem-arroba" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e cadastrar" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(banco.invocar).not.toHaveBeenCalled();
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("vencimento no próximo mês não passa do último dia dele", () => {
    expect(mesmoDiaNoProximoMes("2026-11-05")).toBe("2026-12-05");
    expect(mesmoDiaNoProximoMes("2027-01-31")).toBe("2027-02-28");
    expect(mesmoDiaNoProximoMes("2026-12-15")).toBe("2027-01-15");
  });
});

describe("no banco", () => {
  it("só admin, repetir não duplica e quem já tem financeiro só ganha o vínculo", () => {
    expect(sql).toContain("has_role(auth.uid(), 'admin'::public.app_role)");
    expect(sql).toContain("IF v_lead.stage = 'ganho' AND v_lead.won_client_id = p_client_id THEN");
    expect(sql).toContain("IF NOT v_ja_tem_financeiro THEN");
    expect(sql).toContain("FROM public.commercial_leads WHERE id = p_lead_id AND archived_at IS NULL FOR UPDATE");
  });

  it("mensalidade paga passa por pending para o gatilho gerar a próxima; e-mail de equipe é recusado", () => {
    expect(sql).toContain("'Mensalidade · ' || v_nome, 'pending')");
    expect(sql).toContain("UPDATE public.billing SET status = 'paid', paid_date = v_hoje, paid_amount = v_lead.monthly_value WHERE id = v_billing_id;");
    expect(sql).toContain("has_role(p_client_id, 'client'::public.app_role)");
  });

  it("fecha o acesso a anônimo", () => {
    expect(sql).toContain("FROM PUBLIC, anon;");
    expect(sql.trim().endsWith("TO authenticated;")).toBe(true);
  });
});
