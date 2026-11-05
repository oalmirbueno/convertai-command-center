import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** 05/11/2026 (dono): o ganho do CRM pede os detalhes, cria o cliente e dá o link, igual ao Novo cliente. */
const banco = vi.hoisted(() => ({ perfil: null as null | { id: string }, invocar: vi.fn(), rpc: vi.fn(), ilike: vi.fn(), erro: vi.fn() }));

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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: banco.erro, message: vi.fn() } }));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: vi.fn(), webhooks: { onboardClient: "x" } }));
vi.mock("@/components/admin/CreateClientModal", () => ({ generatePassword: () => "senha-de-teste", SERVICES: [{ key: "site", label: "Site" }] }));
vi.mock("@/hooks/useFinanceV2", () => ({ useFinancePlans: () => ({ data: [] }) }));

import { cadastrarNoGanho } from "@/lib/ganhoDoLead";
import JanelaDoGanho, { mesmoDiaNoProximoMes, tipoDoLead } from "@/components/comercial/JanelaDoGanho";
import type { Lead } from "@/lib/comercial";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261105180000_crm_ganho_exige_cliente.sql"), "utf8");
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");
const dados = {
  lead: { id: "l1" }, tipo: "hybrid" as const, mensalidade: 39.9, valorDoProjeto: 597, nome: " Ana ", empresa: "Ana Doces", email: " ANA@doces.com ", whatsapp: "41999",
  fechamento: { entrada_recebida: 298.5, entrada_parcelas: 1, mensalidade_inicio: "2026-12-01" }, proximaParcela: "2026-12-05", mensalidadeVencimento: "2026-12-05", mensalidadePaga: false,
};

beforeEach(() => {
  cleanup();
  banco.perfil = null;
  for (const f of [banco.invocar, banco.rpc, banco.ilike, banco.erro]) f.mockReset();
  banco.invocar.mockImplementation(async (nome: string) => (nome === "manage-team" ? { data: { user_id: "c1" }, error: null } : { data: {}, error: null }));
  banco.rpc.mockImplementation(async (nome: string) => (nome === "crm_ganho_cadastrar" ? { data: { client_id: "c1", vinculado: false }, error: null } : { data: { token: "a".repeat(64) }, error: null }));
});

describe("cadastro no ganho", () => {
  it("conta nova: cria a conta, grava tudo no banco e envia o convite, nessa ordem", async () => {
    const r = await cadastrarNoGanho(dados);
    expect(banco.invocar.mock.calls[0][0]).toBe("manage-team");
    expect(banco.invocar.mock.calls[0][1].body).toMatchObject({ action: "create", email: "ana@doces.com", full_name: "Ana", role: "client" });
    expect(banco.rpc.mock.calls[0][0]).toBe("crm_ganho_cadastrar");
    expect(banco.rpc.mock.calls[0][1]).toMatchObject({ p_lead_id: "l1", p_client_id: "c1", p_tipo: "hybrid", p_mensalidade: 39.9, p_valor_projeto: 597, p_entrada_recebida: 298.5, p_entrada_parcelas: 1, p_proxima_parcela: "2026-12-05", p_mensalidade_vencimento: "2026-12-05" });
    expect(banco.rpc.mock.calls[1][0]).toBe("issue_first_access_token");
    expect(banco.invocar.mock.calls[1][0]).toBe("send-transactional-email");
    expect(banco.invocar.mock.calls[1][1].body).toMatchObject({ templateName: "client-welcome", recipientEmail: "ana@doces.com", idempotencyKey: "client-welcome-c1" });
    expect(r).toMatchObject({ clientId: "c1", contaNova: true, conviteEnviado: true });
    expect(r.linkDoConvite).toContain("/primeiro-acesso?token=");
  });

  it("e-mail que já tem conta: não cria outra nem manda convite sozinho", async () => {
    banco.perfil = { id: "c9" };
    const r = await cadastrarNoGanho(dados);
    expect(banco.invocar).not.toHaveBeenCalled();
    expect(banco.rpc).toHaveBeenCalledTimes(1);
    expect(banco.rpc.mock.calls[0][1]).toMatchObject({ p_client_id: "c9" });
    expect(r).toMatchObject({ contaNova: false, conviteEnviado: false });
  });

  it("cliente escolhido na janela não busca por e-mail", async () => {
    await cadastrarNoGanho({ ...dados, clienteExistente: "c5" });
    expect(banco.ilike).not.toHaveBeenCalled();
    expect(banco.rpc.mock.calls[0][1]).toMatchObject({ p_client_id: "c5" });
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
  const lead = { id: "l1", name: "Imobiliária Prix", company: "Imobiliária Prix", email: "prix@x.com", whatsapp: "41999", stage: "proposta", monthly_value: 39.9, one_off_value: 597, closed_at: null, won_client_id: null } as unknown as Lead;
  const abrir = (l: Lead = lead) => render(
    <QueryClientProvider client={new QueryClient()}>
      <JanelaDoGanho lead={l} clientes={[{ id: "c5", nome: "Cliente Velho" }]} onCancelar={vi.fn()} onConcluido={vi.fn()} />
    </QueryClientProvider>,
  );
  const CONFIRMAR = "Criar cliente e marcar ganho";

  it("sem a opção de marcar ganho sem cliente", () => {
    abrir();
    // "Depois" só existe na marca, nunca no cadastro.
    expect(screen.getAllByText("Depois")).toHaveLength(1);
    expect(screen.getByText("Novo cliente")).toBeTruthy();
    expect(screen.getByText("Já é cliente")).toBeTruthy();
  });

  it("o tipo vem dos valores do lead; sem valor, precisa escolher antes de criar", async () => {
    expect(tipoDoLead(lead)).toBe("hybrid");
    expect(tipoDoLead({ monthly_value: 0, one_off_value: 100 })).toBe("one_off");
    expect(tipoDoLead({ monthly_value: 100, one_off_value: 0 })).toBe("recurring");
    abrir({ ...lead, monthly_value: 0, one_off_value: 0 });
    fireEvent.click(screen.getByRole("button", { name: CONFIRMAR }));
    await waitFor(() => expect(banco.erro).toHaveBeenCalledWith("Escolha se o cliente é recorrente, avulso ou híbrido."));
    expect(banco.invocar).not.toHaveBeenCalled();
  });

  it("o caso da Prix: R$ 597 em 2x, metade agora, e a mensalidade de 39,90 no próximo mês", async () => {
    abrir();
    fireEvent.click(screen.getByText("Parcelado"));
    expect((screen.getByLabelText(/Em quantas vezes/) as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText(/Já entrou/) as HTMLInputElement).value).toBe("298.5");
    fireEvent.click(screen.getByText(/Próximo mês/));
    fireEvent.click(screen.getByRole("button", { name: CONFIRMAR }));
    await waitFor(() => expect(screen.getByText("Cliente criado")).toBeTruthy());
    const args = banco.rpc.mock.calls[0][1];
    expect(args).toMatchObject({ p_tipo: "hybrid", p_mensalidade: 39.9, p_valor_projeto: 597, p_entrada_recebida: 298.5, p_entrada_parcelas: 1, p_mensalidade_paga: false });
    expect(args.p_proxima_parcela).toBeTruthy();
    expect(args.p_mensalidade_vencimento >= args.p_mensalidade_inicio).toBe(true);
  });

  it("o resultado é o do Novo cliente: cliente criado, convite enviado e o link para o grupo", async () => {
    abrir();
    fireEvent.click(screen.getByRole("button", { name: CONFIRMAR }));
    await waitFor(() => expect(screen.getByText("Cliente criado")).toBeTruthy());
    expect(screen.getByText("Já está em Clientes e no Financeiro.")).toBeTruthy();
    expect(screen.getByText("Convite de primeiro acesso")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeTruthy();
    expect(document.querySelector("[data-link-do-convite]")?.textContent).toContain("/primeiro-acesso?token=");
  });

  it("sem e-mail válido não cria nada", async () => {
    abrir();
    fireEvent.change(screen.getByDisplayValue("prix@x.com"), { target: { value: "sem-arroba" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRMAR }));
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
  it("nenhum caminho vira ganho sem cliente; o ganho antigo sem cliente continua editável", () => {
    expect(sql).toContain("IF NEW.stage = 'ganho' AND NEW.won_client_id IS NULL AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'ganho') THEN");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF stage ON public.commercial_leads");
  });

  it("o MCP recusa antes e explica o caminho", () => {
    const s = ler("supabase/functions/_shared/aceleriq-commercial-services.ts");
    expect(s).toContain("if (para === 'ganho' && !input.won_client_id) {");
  });

  it("só admin, tipo obrigatório, repetir não duplica e quem já tem financeiro só ganha o vínculo", () => {
    expect(sql).toContain("has_role(auth.uid(), 'admin'::public.app_role)");
    expect(sql).toContain("Escolha se o cliente é recorrente, avulso ou híbrido.");
    expect(sql).toContain("IF v_lead.stage = 'ganho' AND v_lead.won_client_id = p_client_id THEN");
    expect(sql).toContain("IF NOT v_ja_tem_financeiro THEN");
  });

  it("mensalidade paga passa por pending para o gatilho gerar a próxima; e-mail de equipe é recusado; anônimo fora", () => {
    expect(sql).toContain("'Mensalidade · ' || v_nome, 'pending')");
    expect(sql).toContain("UPDATE public.billing SET status = 'paid', paid_date = v_hoje, paid_amount = v_mensal WHERE id = v_billing_id;");
    expect(sql).toContain("has_role(p_client_id, 'client'::public.app_role)");
    expect(sql).toContain("FROM PUBLIC, anon;");
    expect(sql.trim().endsWith("TO authenticated;")).toBe(true);
  });
});
