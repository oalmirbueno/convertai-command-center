import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Erros do Estúdio (16/11/2026): o botão "Ver erros (N)" da faixa e a lista com o motivo.

const C1 = "00000000-0000-0000-0000-0000000000c1";
const T1 = "00000000-0000-0000-0000-0000000000a1";

const estado = vi.hoisted(() => ({
  isAdmin: false,
  erros: [] as Record<string, unknown>[],
  feitos: [] as Record<string, unknown>[],
  chamadas: [] as { tabela: string; filtros: [string, unknown[]][] }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (tabela: string) => {
    const c = { tabela, filtros: [] as [string, unknown[]][] };
    estado.chamadas.push(c);
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "in", "order", "limit"]) q[m] = (...a: unknown[]) => { c.filtros.push([m, a]); return q; };
    q.then = (ok: (r: unknown) => unknown) => {
      const status = c.filtros.find(([n, a]) => n === "eq" && a[0] === "status")?.[1][1];
      let data: unknown[] = [];
      if (tabela === "estudio_fila") data = status === "erro" ? estado.erros : estado.feitos;
      if (tabela === "estudio_trabalhos") data = [{ id: T1, client_id: C1, tipo: "carrossel", legenda: "Promo de verão", conceito: null }];
      if (tabela === "profiles") data = [{ id: C1, company_name: "Loja Um" }];
      return Promise.resolve({ data, error: null }).then(ok);
    };
    return q;
  };
  return { supabase: { from } };
});
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: C1, isAdmin: estado.isAdmin }) }));

import ErrosDoEstudio, { detalheDoErro } from "@/components/mesa/ErrosDoEstudio";
import { traduzirErroDoEstudio } from "@/lib/mesa/errosDoEstudio";

const agora = Date.now();
const iso = (minutosAtras: number) => new Date(agora - minutosAtras * 60_000).toISOString();

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ErrosDoEstudio /></QueryClientProvider>);
}

beforeEach(() => {
  estado.isAdmin = false;
  estado.chamadas = [];
  estado.erros = [
    { id: "e1", client_id: C1, trabalho_id: T1, ordem: 2, etapa: "gerar", tentativas: 3, erro_codigo: "tentativas_esgotadas", erro_mensagem: "x", criado_em: iso(120) },
    { id: "e2", client_id: C1, trabalho_id: T1, ordem: 3, etapa: "gerar", tentativas: 0, erro_codigo: "saldo_insuficiente", erro_mensagem: "sem saldo", criado_em: iso(30) },
  ];
  estado.feitos = [{ trabalho_id: T1, criado_em: iso(60) }];
});

describe("Erros do Estúdio na faixa", () => {
  it("sem erro em 7 dias, fica só o ícone e ainda abre os 30 dias", async () => {
    estado.erros = [];
    montar();
    await waitFor(() => expect(estado.chamadas.length).toBeGreaterThan(0));
    expect(screen.queryByText(/Ver erros/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver erros (0)" }));
    expect(await screen.findByText("Nenhum erro nesta janela.")).toBeTruthy();
    estado.chamadas = [];
    fireEvent.click(screen.getByRole("button", { name: "30 dias" }));
    await waitFor(() => expect(estado.chamadas.some((c) => c.tabela === "estudio_fila")).toBe(true));
  });

  it("mostra Ver erros (N), lê só erros deste cliente e abre a lista com o motivo e o já resolvido", async () => {
    montar();
    const abrir = await screen.findByRole("button", { name: "Ver erros (2)" });
    const erros = estado.chamadas.find((c) => c.tabela === "estudio_fila")!;
    expect(erros.filtros).toContainEqual(["eq", ["status", "erro"]]);
    expect(erros.filtros).toContainEqual(["eq", ["client_id", C1]]);
    fireEvent.click(abrir);
    // Abre em Pendentes: só o e2 (o e1 foi resolvido por um feito posterior).
    expect(await screen.findByText(/carteira de IA do cliente ficou sem saldo/)).toBeTruthy();
    expect(screen.queryByText(/todas as tentativas automáticas/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(await screen.findByText(/todas as tentativas automáticas/)).toBeTruthy();
    expect(screen.getByText("Já resolvido")).toBeTruthy();
    expect(screen.getByText("Pendente")).toBeTruthy();
    expect(screen.getAllByText("Promo de verão").length).toBe(2);
    // Sem admin, não há "Todos os clientes".
    expect(screen.queryByRole("button", { name: "Todos os clientes" })).toBeNull();
  });

  it("admin escolhe todos os clientes: a leitura sai sem filtro de cliente", async () => {
    estado.isAdmin = true;
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Ver erros (2)" }));
    estado.chamadas = [];
    fireEvent.click(screen.getByRole("button", { name: "Todos os clientes" }));
    await waitFor(() => expect(estado.chamadas.some((c) => c.tabela === "estudio_fila")).toBe(true));
    const erros = estado.chamadas.find((c) => c.tabela === "estudio_fila")!;
    expect(erros.filtros.some(([n, a]) => n === "eq" && a[0] === "client_id")).toBe(false);
    expect(await screen.findAllByText(/Loja Um/)).toBeTruthy();
  });

  it("tradução e linha de detalhe em pt-BR", () => {
    expect(traduzirErroDoEstudio("abandonado", null)).toMatch(/parada tempo demais/);
    expect(traduzirErroDoEstudio("zzz", "content policy violation")).toMatch(/política de conteúdo/);
    const linha = detalheDoErro({ ordem: 2, etapa: "conferir", tentativas: 1, criado_em: "2026-11-15T13:00:00Z" } as any);
    expect(linha).toBe("lâmina 2 · etapa conferir · 1 tentativa · 15/11, 10:00");
  });
});
