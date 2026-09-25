import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Clientes de cada mesa (pedido do dono, 25/09): Mesa e Mesa Foto mostram
 * quem tem plano mensal ativo; Mesa Ads, quem tem o Ads marcado. A equipe
 * inclui ou retira qualquer um (escolha no banco, por mesa). Ordem alfabética.
 */

const mock = vi.hoisted(() => ({ escolhas: [] as unknown[], rpc: vi.fn(), erroNaLeitura: false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: any = {};
      b.select = () => b;
      b.eq = () => Promise.resolve(mock.erroNaLeitura ? { data: null, error: { message: 'relation "mesa_cliente_escolhas" does not exist' } } : { data: mock.escolhas, error: null });
      return b;
    },
    rpc: mock.rpc,
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import {
  entraPeloPadrao,
  filtrarPorBusca,
  modoParaGravar,
  montarClientesDaMesa,
  normalizarEscolhas,
  type ClienteBruto,
} from "@/components/mesa/clientesDaMesa";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";

const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;

const CARTEIRA: ClienteBruto[] = [
  { id: id(1), company_name: "Terra Flor", plan_status: "active", client_type: "hybrid", services_config: { social: true, trafego: true } },
  { id: id(2), company_name: "Ótica Visão", plan_status: "active", client_type: "recurring", services_config: { social: true } },
  { id: id(3), company_name: "GS Gesso", plan_status: "active", client_type: "one_off", services_config: {} },
  { id: id(4), company_name: "Atelier da Rose", plan_status: "inactive", client_type: "one_off", services_config: {} },
  { id: id(5), company_name: "Vivideo", plan_status: "standby", client_type: "recurring", services_config: { social: false } },
  { id: id(6), company_name: "acerbi", plan_status: "active", client_type: "hybrid", services_config: { trafego: true } },
  { id: id(7), company_name: "Apagada", plan_status: "active", client_type: "recurring", services_config: { trafego: true }, deleted_at: "2026-09-01" },
];

describe("padrão de clientes por mesa", () => {
  it("Mesa e Mesa Foto: plano mensal ativo; fora avulso, inativo, em pausa e apagado", () => {
    for (const mesa of ["organica", "foto"] as const) {
      const r = montarClientesDaMesa(mesa, CARTEIRA, []);
      expect(r.visiveis.map((c) => c.nome)).toEqual(["acerbi", "Ótica Visão", "Terra Flor"]);
      expect(r.mostrandoTodos).toBe(false);
    }
    expect(entraPeloPadrao("organica", CARTEIRA[2])).toEqual({ entra: false, motivo: "Trabalho avulso" });
    expect(entraPeloPadrao("organica", CARTEIRA[3]).motivo).toBe("Sem plano ativo");
    expect(entraPeloPadrao("organica", CARTEIRA[4]).motivo).toBe("Plano em pausa");
    expect(entraPeloPadrao("organica", CARTEIRA[6]).motivo).toBe("Cliente apagado");
  });

  it("Mesa Ads: só quem tem o Ads marcado (services_config.trafego) e plano ativo", () => {
    const r = montarClientesDaMesa("ads", CARTEIRA, []);
    expect(r.visiveis.map((c) => c.nome)).toEqual(["acerbi", "Terra Flor"]);
    expect(r.todos.find((c) => c.nome === "Ótica Visão")!.motivo).toBe("Sem Ads marcado");
  });

  it("a escolha da equipe vale por cima do padrão, em cada mesa", () => {
    const escolhas = normalizarEscolhas([
      { client_id: id(3), modo: "incluir" },
      { client_id: id(1), modo: "retirar" },
      { client_id: "nao-e-uuid", modo: "incluir" },
      { client_id: id(2), modo: "qualquer" },
    ]);
    expect(escolhas).toHaveLength(2);
    const r = montarClientesDaMesa("ads", CARTEIRA, escolhas);
    expect(r.visiveis.map((c) => c.nome)).toEqual(["acerbi", "GS Gesso"]);
    expect(r.todos.find((c) => c.id === id(3))).toMatchObject({ naMesa: true, padrao: false, escolha: "incluir", motivo: "Incluído pela equipe" });
    expect(r.todos.find((c) => c.id === id(1))).toMatchObject({ naMesa: false, padrao: true, escolha: "retirar", motivo: "Retirado pela equipe" });
  });

  it("ordem alfabética estável, sem acento e sem diferença de maiúscula", () => {
    const r = montarClientesDaMesa("organica", CARTEIRA, [{ client_id: id(3), modo: "incluir" }, { client_id: id(4), modo: "incluir" }]);
    expect(r.visiveis.map((c) => c.nome)).toEqual(["acerbi", "Atelier da Rose", "GS Gesso", "Ótica Visão", "Terra Flor"]);
    // A mesma entrada em outra ordem dá a mesma lista.
    const r2 = montarClientesDaMesa("organica", CARTEIRA.slice().reverse(), [{ client_id: id(4), modo: "incluir" }, { client_id: id(3), modo: "incluir" }]);
    expect(r2.visiveis.map((c) => c.id)).toEqual(r.visiveis.map((c) => c.id));
  });

  it("ninguém no padrão: mostra todos para não travar a equipe", () => {
    const semPlano: ClienteBruto[] = [{ id: id(8), company_name: "Zeta" }, { id: id(9), company_name: "Alfa" }];
    const r = montarClientesDaMesa("ads", semPlano, []);
    expect(r.mostrandoTodos).toBe(true);
    expect(r.visiveis.map((c) => c.nome)).toEqual(["Alfa", "Zeta"]);
  });

  it("incluir ou retirar igual ao padrão apaga a escolha; busca sem acento", () => {
    expect(modoParaGravar(true, true)).toBeNull();
    expect(modoParaGravar(false, false)).toBeNull();
    expect(modoParaGravar(false, true)).toBe("incluir");
    expect(modoParaGravar(true, false)).toBe("retirar");
    expect(filtrarPorBusca([{ nome: "Ótica Visão" }, { nome: "Padaria São João" }], "sao").map((c) => c.nome)).toEqual(["Padaria São João", "Ótica Visão"]);
  });
});

function montar(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("seletor de clientes da mesa", () => {
  beforeEach(() => {
    mock.escolhas = [];
    mock.erroNaLeitura = false;
    mock.rpc.mockReset();
    // O banco guarda a escolha: a releitura depois de gravar devolve a linha.
    mock.rpc.mockImplementation(async (_fn: string, a: { _client_id: string; _modo: string | null }) => {
      mock.escolhas = a._modo ? [{ client_id: a._client_id, modo: a._modo }] : [];
      return { data: null, error: null };
    });
  });

  it("lista só os clientes da mesa; o aberto fora da mesa aparece com a nota", async () => {
    const escolher = vi.fn();
    montar(<SeletorDeClientesDaMesa mesa="ads" clientesBrutos={CARTEIRA} valor={id(2)} nome="Ótica Visão" carregando={false} onEscolher={escolher} />);
    fireEvent.click(screen.getByRole("combobox", { name: /Cliente: Ótica Visão/ }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["acerbi", "Ótica Visãofora desta mesa", "Terra Flor"]);
    fireEvent.click(screen.getByRole("button", { name: "Terra Flor" }));
    expect(escolher).toHaveBeenCalledWith(id(1));
  });

  it("Gerenciar clientes: incluir grava pela RPC, por mesa", async () => {
    montar(<SeletorDeClientesDaMesa mesa="foto" clientesBrutos={CARTEIRA} valor="" nome="" carregando={false} onEscolher={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Escolher o cliente" }));
    fireEvent.click(await screen.findByRole("button", { name: /Gerenciar clientes/ }));
    const fora = screen.getByRole("list", { name: "Clientes fora da mesa" });
    fireEvent.click(within(fora).getByRole("button", { name: "Incluir GS Gesso" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("mesa_escolher_cliente", { _mesa: "foto", _client_id: id(3), _modo: "incluir" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Clientes na mesa" })).getByText("GS Gesso")).toBeTruthy());
  });

  it("sem a tabela no banco, vale o padrão", async () => {
    mock.erroNaLeitura = true;
    montar(<SeletorDeClientesDaMesa mesa="organica" clientesBrutos={CARTEIRA} valor="" nome="" carregando={false} onEscolher={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Escolher o cliente" }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
  });
});
