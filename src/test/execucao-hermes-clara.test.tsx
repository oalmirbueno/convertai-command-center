import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { comandoDaAprovacao, contagensDasAbas, destinoDaEvidencia } from "@/lib/execucaoApresentacao";
import { progressDetail } from "../../supabase/functions/_shared/operator-progress-detail";
import { destinoOperacional } from "@/components/execucao/ContextoDoAviso";
import ExecucoesRecentes from "@/components/execucao/ExecucoesRecentes";
import { filtrarArea } from "@/hooks/useAvisosPorArea";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "teste" } }) }));

describe("Aprovação encaminhada ao contrato correto", () => {
  const a = { id: "a", origin: "central", report_id: "r", client_id: "c", payload_hash: "versao", payload_version: 3, status: "pendente", payload: { report: { summary: "Texto real", next_steps: "Conferir amanhã" } } };
  it("preserva identidade e versão da Central e a mesma chave no retry", () => {
    const cmd = comandoDaAprovacao(a, "aprovado", "", "repetivel");
    expect(cmd.rpc).toBe("central_review_decide");
    expect(cmd.args).toMatchObject({ _expected_client_id: "c", _expected_payload_hash: "versao", _expected_version: 3, _idempotency_key: "repetivel" });
    expect(comandoDaAprovacao(a, "aprovado", "", "repetivel")).toEqual(cmd);
  });
  it("impede relatório incompleto e decisão sem justificativa", () => {
    expect(() => comandoDaAprovacao({ ...a, payload: { report: {} } }, "aprovado", "", "key")).toThrow(/mensagem/);
    expect(() => comandoDaAprovacao(a, "alteracoes_pedidas", "", "key")).toThrow(/comentário/);
    expect(() => comandoDaAprovacao(a, "adiado", "", "key")).toThrow();
  });
  it("mantém o contrato de aprovações próprias do operador", () => {
    expect(comandoDaAprovacao({ id: "op", origin: "operator" }, "adiado", "amanhã", "key")).toEqual({ rpc: "operator_approval_decidir", args: { _approval_id: "op", _decisao: "adiado", _nota: "amanhã" } });
  });
});
describe("Contagem e abertura sem perder o contexto", () => {
  it("não soma novamente uma tarefa por aparecer em quadro e concluídas", () => {
    expect(contagensDasAbas([{ id: "1", status: "done" }, { id: "1", status: "done" }], 14).trabalho).toBe(1);
    expect(contagensDasAbas([], 14).trabalho).toBe(0);
  });
  it("abre a conversa da tarefa e conserva a execução específica", () => {
    expect(destinoOperacional("/execucao?vinculo=v&run=r")).toBe("/execucao?vinculo=v&run=r&aba=diario");
    expect(destinoOperacional("/execucao?aprovacao=a&vinculo=v")).toBe("/execucao?aprovacao=a&vinculo=v");
    expect(destinoOperacional("/mesa?client=c")).toBe("/mesa?client=c");
  });
  it("mostra execução externa sem vínculo e não inventa tarefa", () => {
    const conversar = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><ExecucoesRecentes runs={[{ id: "r", operator_id: "o", status: "review", heartbeat_at: "2026-10-07T12:00:00Z", detail: { title: "Conferência do anúncio", summary: "Página consultada e registrada" } }]} agentes={[{ id: "o", display_name: "Helena", area: "Marketing" }]} vinculos={[]} tarefas={new Map()} aoConversar={conversar} /></QueryClientProvider>);
    fireEvent.click(screen.getByText("Conferência do anúncio"));
    expect(screen.getByText(/ainda não vinculou/)).toBeInTheDocument();
    expect(screen.getByText("Página consultada e registrada")).toBeInTheDocument();
    expect(conversar).not.toHaveBeenCalled();
  });
});
describe("Comprovações e isolamento das notificações", () => {
  it("aceita print privado e recusa credencial e script em URL", () => {
    const url = "files://task-attachments/00000000-0000-0000-0000-000000000001/execucao/print.png";
    expect(progressDetail({ attachments: [{ name: "Resultado", url }] }).attachments).toEqual([{ name: "Resultado", url }]);
    expect(() => progressDetail({ page_url: "https://example.com/?api_key=nao-real" })).toThrow(/credenciais/);
    expect(() => progressDetail({ page_url: "javascript:alert(1)" })).toThrow();
    expect(destinoDaEvidencia("javascript:alert(1)")).toBeNull();
    expect(destinoDaEvidencia("files://task-attachments/../outro.png")).toBeNull();
  });
  it("a marcação em lote usa o recorte da aba", () => {
    const q = { or: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis() };
    filtrarArea(q, "agentes");
    expect(q.or).toHaveBeenCalledWith("notification_type.like.operator%,link.like./execucao%");
    filtrarArea(q, "painel");
    expect(q.not).toHaveBeenCalledWith("notification_type", "like", "operator%");
    expect(q.or).toHaveBeenCalledWith("link.is.null,link.not.like./execucao%");
  });
});
