import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montarMensagens, prazoEmPalavras } from "@/lib/mensagensDaSemana";

/**
 * 26/10/2026: as mensagens dos rituais da semana numa tela só. Aprovar uma,
 * aprovar todas e pular passam pelo fluxo que já existe (central_review_decide,
 * prepare com o mesmo destino, envio do Hermes / publicação no portal).
 */

const AGORA = Date.now();
const hojeCedo = new Date(AGORA - 60_000).toISOString();
const daquiA4h = new Date(AGORA + 4 * 3_600_000).toISOString();
const ha1h = new Date(AGORA - 3_600_000).toISOString();

function relatorio(id: string, cliente: string, texto: string) {
  return { id, client_id: cliente, title: `Ritual ${id}`, summary: texto, next_steps: "Na quarta, o novo criativo.", status: "draft", review_version: 1, created_at: hojeCedo, period_start: null, period_end: null, metrics: { central_review_source: { v: 1 }, ritual_type: "rota_semana" } };
}
function pedido(id: string, report: string, cliente: string, extra: Record<string, unknown> = {}) {
  return { id, report_id: report, client_id: cliente, payload_version: 1, payload_hash: `h-${id}`, status: "pendente", created_at: hojeCedo, valid_until: daquiA4h, executed_at: null, payload: { report: relatorio(report, cliente, "x"), destination: { channel: "whatsapp", recipient: "Grupo Casa" } }, ...extra };
}

const estado = vi.hoisted(() => ({ reports: [] as unknown[], approvals: [] as unknown[] }));
const rpc = vi.hoisted(() => vi.fn());
const preparar = vi.hoisted(() => vi.fn());
const salvar = vi.hoisted(() => vi.fn());
const publicar = vi.hoisted(() => vi.fn());
const reescrever = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, profile: { role: "admin" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "c1", company_name: "Casa dos Assados" }, { id: "c2", company_name: "Stop" }] }) }));
vi.mock("@/hooks/useMensagensDaSemana", () => ({ useRascunhosDaSemana: () => ({ data: estado.reports, isLoading: false, isFetching: false, error: null }) }));
vi.mock("@/hooks/useCentralReviews", () => ({
  useCentralReviews: () => ({ data: estado.approvals, isLoading: false, isFetching: false, error: null }),
  callReviewRpc: rpc,
  prepareCentralReview: preparar,
  saveCentralReviewDraft: salvar,
}));
vi.mock("@/components/central/agenteCentralApi", () => ({ salvarEPublicarRitual: publicar, reescreverRitual: reescrever }));

vi.mock("@/components/admin/LogoDoCliente", async (orig) => ({ ...(await orig<any>()), useIdentidadesDosClientes: () => ({ data: new Map() }) }));

import MensagensDaSemana from "@/pages/MensagensDaSemana";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MensagensDaSemana))));
}

beforeEach(() => {
  estado.reports = [relatorio("r1", "c1", "Bom dia! A semana começa com o novo anúncio."), relatorio("r2", "c2", "Bom dia, Stop! O site novo foi ao ar.")];
  estado.approvals = [pedido("a1", "r1", "c1"), pedido("a2", "r2", "c2")];
  rpc.mockReset().mockResolvedValue({ ok: true });
  preparar.mockReset();
  salvar.mockReset();
  publicar.mockReset().mockResolvedValue({ reportId: "r", publicado: true, avisos: [] });
  reescrever.mockReset();
});
afterEach(() => cleanup());

const decisoes = () => rpc.mock.calls.filter((c) => c[0] === "central_review_decide").map((c) => c[1] as Record<string, unknown>);

describe("Mensagens da semana", () => {
  it("cartões em grade com a prévia em balão de WhatsApp, o prazo e uma ação principal", () => {
    montar();
    expect(document.querySelectorAll('[data-mensagem="pronta"]').length).toBe(2);
    expect(screen.getByRole("list", { name: "Para aprovar" }).className).toContain("grid");
    const cartao = document.querySelector('[data-mensagem="pronta"]') as HTMLElement;
    expect(cartao.querySelector('[data-balao="whatsapp"]')!.textContent).toContain("Bom dia! A semana começa com o novo anúncio.");
    expect(cartao.querySelectorAll("button").length).toBe(3);
    expect(cartao.querySelector("textarea")).toBeNull();
    expect(screen.getByText("Casa dos Assados")).toBeTruthy();
    expect(screen.getByText("Stop")).toBeTruthy();
    expect(document.querySelector("[data-prazo]")!.textContent).toMatch(/^vence/);
  });

  it("aprova uma: decisão registrada (aprovado, versão e hash do pedido); WhatsApp fica com o Hermes", async () => {
    montar();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Aprovar e enviar/ })[0]); });
    await waitFor(() => expect(decisoes()).toHaveLength(1));
    expect(decisoes()[0]).toMatchObject({ _approval_id: "a1", _decision: "aprovado", _expected_payload_hash: "h-a1", _expected_version: 1 });
    expect(rpc.mock.calls.some((c) => c[0] === "central_review_marcar_enviado")).toBe(false);
    expect(publicar).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelectorAll('[data-mensagem="pronta"]').length).toBe(1));
  });

  it("texto editado: salva o rascunho, prepara de novo com o mesmo destino e aprova o pedido novo", async () => {
    salvar.mockResolvedValue({ ...relatorio("r1", "c1", "Texto novo"), review_version: 2 });
    preparar.mockResolvedValue(pedido("a1b", "r1", "c1", { payload_version: 2 }));
    montar();
    // A edição abre numa janela no centro.
    fireEvent.click(screen.getByRole("button", { name: "Editar a mensagem de Casa dos Assados" }));
    fireEvent.change(await screen.findByLabelText(/Texto da mensagem para Casa dos Assados/), { target: { value: "Texto novo" } });
    expect(document.querySelector("[data-edicao] [data-balao]")!.textContent).toContain("Texto novo");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Aprovar e enviar a mensagem de Casa dos Assados" })); });
    await waitFor(() => expect(decisoes()).toHaveLength(1));
    expect(salvar.mock.calls[0][1]).toMatchObject({ summary: "Texto novo" });
    expect(preparar.mock.calls[0][2]).toEqual({ channel: "whatsapp", recipient: "Grupo Casa" });
    expect(decisoes()[0]).toMatchObject({ _approval_id: "a1b", _decision: "aprovado" });
  });

  it("aprovar todas pede confirmação e aprova cada uma, uma de cada vez", async () => {
    montar();
    const botao = screen.getByRole("button", { name: /Aprovar todas \(2\)/ });
    await act(async () => { fireEvent.click(botao); });
    expect(decisoes()).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Confirmar: aprovar 2/ })); });
    await waitFor(() => expect(decisoes()).toHaveLength(2));
    expect(decisoes().map((d) => d._approval_id)).toEqual(["a1", "a2"]);
    expect(decisoes().every((d) => d._decision === "aprovado")).toBe(true);
  });

  it("portal: registra o envio e publica pelo caminho da Central", async () => {
    estado.approvals = [pedido("a1", "r1", "c1", { payload: { report: relatorio("r1", "c1", "x"), destination: { channel: "portal", recipient: "c1" } } })];
    montar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Aprovar e enviar/ })); });
    await waitFor(() => expect(publicar).toHaveBeenCalledTimes(1));
    const ordem = rpc.mock.calls.map((c) => c[0]);
    expect(ordem).toEqual(["central_review_decide", "central_review_marcar_enviado"]);
    expect(publicar.mock.calls[0][0]).toMatchObject({ reportId: "r1", publicar: true, canal: "portal" });
  });

  it("pular registra que não vai (rejeitado com o motivo)", async () => {
    montar();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Pular/ })[0]); });
    await waitFor(() => expect(decisoes()).toHaveLength(1));
    expect(decisoes()[0]).toMatchObject({ _approval_id: "a1", _decision: "rejeitado" });
    expect(String(decisoes()[0]._comment)).toContain("Pulada");
  });

  it("situação por cor: vencida em vermelho, aprovada em verde (recolhida)", () => {
    estado.approvals = [pedido("a1", "r1", "c1", { valid_until: ha1h }), pedido("a2", "r2", "c2", { status: "aprovado" })];
    montar();
    const vencida = document.querySelector('[data-mensagem="venceu"] [data-prazo]') as HTMLElement;
    expect(vencida.className).toContain("text-destructive");
    expect(vencida.textContent).toMatch(/^venceu/);
    expect(screen.getByText("Aprovadas, o Hermes envia")).toBeTruthy();
  });

  it("pedido vencido vira 'venceu' e o prazo diz quando", () => {
    const lista = montarMensagens([relatorio("r1", "c1", "x") as never], [pedido("a1", "r1", "c1", { valid_until: ha1h }) as never], AGORA);
    expect(lista[0].situacao).toBe("venceu");
    expect(prazoEmPalavras(ha1h, AGORA)).toMatch(/^venceu/);
    const enviada = montarMensagens([relatorio("r1", "c1", "x") as never], [pedido("a1", "r1", "c1", { executed_at: ha1h }) as never], AGORA);
    expect(enviada).toHaveLength(0);
  });

  it("a Central tem o atalho e o menu tem o contador", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const central = readFileSync(resolve(__dirname, "../..", "src/pages/AdminExperience.tsx"), "utf8");
    expect(central).toContain('to="/central/mensagens"');
    expect(central).toContain("useContagemDeMensagensProntas()");
    const menu = readFileSync(resolve(__dirname, "../..", "src/components/AppLayout.tsx"), "utf8");
    expect(menu).toContain('url: "/central/mensagens"');
    expect(menu).toContain("contador: mensagensProntas");
  });
});
