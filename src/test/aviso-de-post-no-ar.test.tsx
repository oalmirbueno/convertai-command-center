import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Aviso de post no ar na Revisão do Ciclo (14/10/2026): preparar → o dono decide → quem envia registra.
 * O fluxo do banco foi exercitado num Postgres local (44 verificações); aqui ficam as garantias que não
 * podem voltar atrás e a tela.
 */
const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

const estado = vi.hoisted(() => ({ avisos: [] as Record<string, unknown>[], erro: null as string | null, chamadas: [] as { nome: string; args: Record<string, unknown> }[] }));

vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.order = () => q;
  q.limit = async () => (estado.erro ? { data: null, error: { message: estado.erro } } : { data: estado.avisos, error: null });
  return {
    supabase: {
      from: () => q,
      rpc: async (nome: string, args: Record<string, unknown>) => { estado.chamadas.push({ nome, args }); return { data: { ok: true }, error: null }; },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AvisosDePublicacao from "@/components/central/AvisosDePublicacao";
import { erroDoAviso, faseDoAviso, type AvisoDePublicacao } from "@/lib/avisoDePublicacao";

const AGORA = Date.parse("2026-10-14T15:00:00Z");
const aviso = (extra: Partial<AvisoDePublicacao> = {}): AvisoDePublicacao => ({
  id: "a-1", client_id: "c-1", publication_id: "p-1", mensagem: "Seu reel está no ar: https://instagram.com/p/x",
  destino: { channel: "whatsapp", recipient: "Mirante | Aceleriq" },
  payload: { publication: { title: "Reel do mirante", platform: "instagram", permalink: "https://instagram.com/p/x", published_at: "2026-10-14T13:00:00Z" } },
  payload_hash: "h1", status: "pendente", preparado_via: "agente:default", valid_until: "2026-10-17T13:00:00Z",
  decided_at: null, decision_note: null, executed_at: null, execution_evidence: null, created_at: "2026-10-14T13:05:00Z",
  client: { company_name: "Mirante Luz", full_name: null },
  ...extra,
});

describe("fase do aviso", () => {
  it("pendente no prazo pede decisão; vencido não", () => {
    expect(faseDoAviso(aviso(), AGORA)).toBe("decidir");
    expect(faseDoAviso(aviso({ valid_until: "2026-10-14T14:59:00Z" }), AGORA)).toBe("historico");
  });
  it("aprovado sem envio pede envio; enviado vira histórico e some depois de 7 dias", () => {
    expect(faseDoAviso(aviso({ status: "aprovado", decided_at: "2026-10-14T14:00:00Z" }), AGORA)).toBe("enviar");
    expect(faseDoAviso(aviso({ status: "aprovado", executed_at: "2026-10-14T14:30:00Z" }), AGORA)).toBe("historico");
    expect(faseDoAviso(aviso({ status: "aprovado", executed_at: "2026-10-01T14:30:00Z" }), AGORA)).toBe("oculto");
  });
  it("erros do banco viram frases", () => {
    expect(erroDoAviso(new Error("AVISO_JA_DECIDIDO: está como aprovado"))).toMatch(/Atualize a revisão/);
    expect(erroDoAviso(new Error("AVISO_COMENTARIO_OBRIGATORIO"))).toMatch(/motivo/);
  });
});

function montar(isAdmin = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={qc}><AvisosDePublicacao isAdmin={isAdmin} /></QueryClientProvider></MemoryRouter>);
}

describe("a seção na Revisão do Ciclo", () => {
  it("aprovar exige conferir e manda o hash do que foi preparado", async () => {
    estado.avisos = [aviso({ valid_until: "2099-01-01T00:00:00Z" })];
    estado.chamadas = [];
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Reel do mirante/ }));
    expect(screen.getByText(/Mirante \| Aceleriq/)).toBeTruthy();
    const aprovar = screen.getByRole("button", { name: "Aprovar aviso" }) as HTMLButtonElement;
    expect(aprovar.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(aprovar);
    await waitFor(() => expect(estado.chamadas.length).toBe(1));
    expect(estado.chamadas[0].nome).toBe("aviso_publicacao_decidir");
    expect(estado.chamadas[0].args).toMatchObject({ _aviso_id: "a-1", _expected_payload_hash: "h1", _decision: "aprovado" });
  });

  it("aprovado mostra o envio, que exige evidência", async () => {
    estado.avisos = [aviso({ status: "aprovado", decided_at: new Date().toISOString() })];
    estado.chamadas = [];
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Reel do mirante/ }));
    const marcar = screen.getByRole("button", { name: "Marcar como enviado" }) as HTMLButtonElement;
    expect(marcar.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/enviado no grupo/), { target: { value: "grupo Mirante 10h15" } });
    fireEvent.click(marcar);
    await waitFor(() => expect(estado.chamadas[0]?.nome).toBe("aviso_publicacao_marcar_enviado"));
    expect(estado.chamadas[0].args).toMatchObject({ _aviso_id: "a-1", _evidence: "grupo Mirante 10h15" });
  });

  it("sem aviso nada aparece; quem não é administrador não vê", async () => {
    estado.avisos = [];
    const { container } = montar();
    await waitFor(() => expect(container.textContent).toBe(""));
    estado.avisos = [aviso({ valid_until: "2099-01-01T00:00:00Z" })];
    const outro = montar(false);
    expect(outro.container.textContent).toBe("");
  });

  it("antes da migration (tabela inexistente) a seção não aparece; outro erro aparece", async () => {
    estado.erro = "Could not find the table 'public.aviso_publicacao' in the schema cache (PGRST205)";
    const semTabela = montar();
    await new Promise((r) => setTimeout(r, 300));
    expect(semTabela.container.textContent).toBe("");
    semTabela.unmount();
    estado.erro = "permission denied";
    montar();
    await screen.findByText("Não foi possível carregar os avisos.");
    estado.erro = null;
  });
});

describe("garantias da migration e do MCP", () => {
  const sql = ler("supabase/migrations/20261014210000_aviso_de_post_no_ar_na_revisao.sql");
  const tools = ler("supabase/functions/_shared/mcp-tools.ts");

  it("tabela própria: não mexe em operator_approvals nem nas funções da revisão", () => {
    const codigo = sql.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(/ALTER TABLE public\.operator_approvals|CREATE OR REPLACE FUNCTION public\.central_review/);
    expect(codigo).toContain("CREATE TABLE public.aviso_publicacao");
  });
  it("um aviso vivo por post, só post publicado, preparado imutável", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX aviso_publicacao_um_vivo_por_post ON public.aviso_publicacao (publication_id) WHERE status IN ('pendente', 'aprovado')");
    expect(sql).toContain("_e.status IS DISTINCT FROM 'published'");
    expect(sql).toContain("AVISO_IMUTAVEL");
    expect(sql).toContain("CONSTRAINT aviso_publicacao_envio_so_aprovado CHECK (executed_at IS NULL OR status = 'aprovado')");
  });
  it("mesmas portas da revisão: administrador no painel, Hermes só pelo service_role com evidência", () => {
    expect(sql.match(/PERFORM app_private\.central_review_admin\(\);/g)?.length).toBe(3);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.aviso_publicacao_decidir_por_agente(text, uuid, text, text, text, text) TO service_role;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.aviso_publicacao_decidir_por_agente(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON public.aviso_publicacao FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("'[via Hermes '");
  });
  it("quatro ferramentas MCP registradas", () => {
    for (const nome of ["fila", "preparar", "decidir", "marcar_enviado"]) expect(tools).toContain(`name: 'aceleriq_aviso_publicacao_${nome}'`);
    expect(tools).toContain("  avisoPublicacaoMarcarEnviadoTool,\n");
  });
});
