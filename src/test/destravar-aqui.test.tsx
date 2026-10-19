import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * 19/10/2026 (dono, com o print do cartão "Verzelo: conjunto contínuo travado por acesso à Meta":
 * "ter uma área que destrava tudo por ali, eu respondo e já resolvo ali mesmo sem precisar ir para
 * outro lugar, qualquer ação"). A execução travada ganha "Destravar aqui": responder, pode seguir,
 * concluir ou encerrar. Execução sem tarefa (51 de 65 travadas) ganha o vínculo na hora, para a
 * resposta chegar ao agente pela fila e pelo diário.
 */

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import DestravarAqui, { falaDaMeta } from "@/components/execucao/DestravarAqui";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const comCliente = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const MOTIVO_META = "Só o Almir resolve: reautorizar a conexão Meta Ads do Gestor (Composio) ou concluir a verificação em duas etapas do login do Hermes.";

describe("Destravar aqui", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { ok: true, link_id: "l1", link_status: "queued" }, error: null }); });

  it("responder: escreve (ou toca numa sugestão) e envia; a execução sai do travado", async () => {
    const aoResolver = vi.fn();
    comCliente(<DestravarAqui runId="run-1" motivo={MOTIVO_META} aoResolver={aoResolver} />);
    const enviar = screen.getByRole("button", { name: /Enviar resposta/ }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Já liberei o acesso, pode tentar de novo" }));
    expect(enviar.disabled).toBe(false);
    await act(async () => { fireEvent.click(enviar); });
    expect(rpc).toHaveBeenCalledWith("operator_destravar_execucao", { _run_id: "run-1", _acao: "responder", _texto: "Já liberei o acesso, pode tentar de novo" });
    await waitFor(() => expect(aoResolver).toHaveBeenCalled());
    expect(screen.getByText(/Resposta enviada/)).toBeTruthy();
  });

  it("um toque: Pode seguir, Concluir e Encerrar chamam a mesma função com a ação", async () => {
    for (const [botao, acao] of [["Pode seguir", "pode_seguir"], ["Concluir", "concluir"], ["Encerrar", "encerrar"]] as const) {
      rpc.mockClear();
      const { unmount } = comCliente(<DestravarAqui runId="run-2" motivo="Faltou a prova." />);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${botao}`) })); });
      expect(rpc).toHaveBeenCalledWith("operator_destravar_execucao", { _run_id: "run-2", _acao: acao, _texto: null });
      unmount();
    }
  });

  it("acesso na Meta: mostra o atalho para o Gerenciador de Negócios; outros motivos, não", () => {
    expect(falaDaMeta(MOTIVO_META)).toBe(true);
    expect(falaDaMeta("A conta de anúncios da Softy não deu permissão para a nossa conexão")).toBe(true);
    expect(falaDaMeta("Faltou a prova da entrega.")).toBe(false);
    comCliente(<DestravarAqui runId="run-3" motivo={MOTIVO_META} />);
    const atalho = screen.getByRole("link", { name: /Gerenciador de Negócios/ }) as HTMLAnchorElement;
    expect(atalho.href).toBe("https://business.facebook.com/settings");
    expect(atalho.target).toBe("_blank");
  });

  it("falhou no servidor: avisa e o painel continua para tentar de novo", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "not_allowed" } });
    comCliente(<DestravarAqui runId="run-4" motivo="x" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Pode seguir/ })); });
    expect(screen.queryByText(/Resposta enviada|Liberado/)).toBeNull();
    expect((screen.getByRole("button", { name: /^Pode seguir/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("onde aparece", () => {
  it("execução travada, esperando ou em revisão em Execuções externas", () => {
    const fonte = ler("src/components/execucao/ExecucoesRecentes.tsx");
    expect(fonte).toContain("<DestravarAqui");
    expect(fonte).toMatch(/PRECISA_DE_DESTRAVE\s*=\s*\[[^\]]*"blocked"[^\]]*"awaiting_input"/);
  });

  it("no Precisa de você, o travado responde no próprio cartão (sem abrir o diário)", () => {
    const pagina = ler("src/pages/AdminExecucao.tsx");
    expect(pagina).toMatch(/podeAjuste: emRevisao \|\| travada/);
    expect(pagina).toContain("const responderVinculo = async");
    expect(pagina).toContain('entry_type: "resposta_insumo"');
  });

  it("o banco: vínculo na hora para execução sem tarefa, só o admin, rodada fechada, sem 40001", () => {
    const sql = ler("supabase/migrations/20261019185453_destravar_execucao.sql");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.operator_destravar_execucao(_run_id uuid, _acao text, _texto text DEFAULT NULL)");
    expect(sql).toContain("INSERT INTO public.operator_task_links");
    expect(sql).toContain("public.operator_human_action(");
    expect(sql).toMatch(/has_role\(auth\.uid\(\), 'admin'/);
    expect(sql).toContain("'destravado'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.operator_destravar_execucao(uuid, text, text) FROM PUBLIC, anon");
    expect(sql).not.toMatch(/40001/);
  });
});
