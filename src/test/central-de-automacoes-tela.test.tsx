import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 19/11/2026: tela /automacoes. Abre sem travar, lista por grupo, abre o fluxo com o desenho e as execuções,
 * e o botão pede confirmação dizendo que o fluxo fala com cliente antes de chamar a função.
 */

const haMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const painel = {
  coleta: { coletado_em: haMin(1), recebido_em: haMin(1), atrasada: false },
  pode_ligar: true,
  fluxos: [
    { id: "AcqF00Ferramenta", nome: "Apoio: ponte com o painel", grupo: "Apoio", ativo: true, total_24h: 8634, erros_24h: 0, gatilhos: [{ tipo: "subfluxo", descricao: "chamado por outro fluxo" }], efeito_no_cliente: false, ultima_execucao: { id: 9, status: "success", inicio: haMin(1), fim: haMin(1) } },
    { id: "Acq11MensagemSem", nome: "Clientes: mensagem da semana no grupo (seg, qua, sex)", grupo: "Clientes", ativo: true, total_24h: 2, erros_24h: 0, proxima_execucao: new Date(Date.now() + 3600_000 * 30).toISOString(), gatilhos: [{ tipo: "agenda", descricao: "seg às 07h20" }], efeito_no_cliente: true, ultima_execucao: { id: 8, status: "success", inicio: haMin(900), fim: haMin(899) } },
  ],
  saude: [{ chave: "n8n", nome: "n8n no ar", estado: "ok", detalhe: "respondeu em 45 ms", info: {} }],
  acoes: [],
};
const detalhe = {
  ...painel.fluxos[1],
  desenho: { nos: [{ nome: "Segunda 07h20", tipo: "scheduleTrigger", x: 0, y: 0 }, { nome: "Escrever", tipo: "code", x: 220, y: 0 }], ligacoes: [{ de: "Segunda 07h20", para: "Escrever", saida: 0, tipo: "main" }] },
  execucoes: [{ id: 8, modo: "trigger", status: "success", inicio: haMin(900), fim: haMin(899), caminho: [{ no: "Segunda 07h20", estado: "success", vezes: 1 }, { no: "Escrever", estado: "success", vezes: 1 }], parou_em: "Escrever" }],
  acoes: [],
};

const rpc = vi.fn(async (nome: string) => ({ data: nome === "automacoes_painel" ? painel : detalhe, error: null }));
const invoke = vi.fn(async () => ({ data: { ok: true, ativo: false }, error: null }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "c-dk", company_name: "Vip DK" }] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...(a as [string])), functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) } } }));

import CentralDeAutomacoes from "@/pages/CentralDeAutomacoes";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(CentralDeAutomacoes))));
}

afterEach(() => { cleanup(); rpc.mockClear(); invoke.mockClear(); });

describe("Central de Automações (tela)", () => {
  async function abrirPasta(titulo: string) {
    const pastas = await screen.findByRole("list", { name: "Pastas" }, { timeout: 5000 });
    fireEvent.click(within(pastas).getByTitle(`Abrir a pasta ${titulo}`));
    return screen.findByRole("list", { name: titulo }, { timeout: 5000 });
  }

  it("abre em pastas da Aceleriq; a pasta abre os fluxos no centro", async () => {
    montar();
    const pastas = await screen.findByRole("list", { name: "Pastas" }, { timeout: 5000 });
    expect(within(pastas).getByTitle("Abrir a pasta Clientes")).toBeTruthy();
    expect(within(pastas).getByTitle("Abrir a pasta Apoio (não desligar)")).toBeTruthy();
    const lista = await abrirPasta("Clientes");
    expect(lista.textContent).toContain("Mensagem da semana no grupo");
    expect(lista.textContent).toContain("fala com cliente");
  });

  it("abre o fluxo com desenho, execuções e o dono escolhe de quem é", async () => {
    montar();
    const lista = await abrirPasta("Clientes");
    fireEvent.click(within(lista).getByTitle(/Abrir Clientes: mensagem/));
    expect(await screen.findByRole("img", { name: /Desenho do fluxo/ }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/Parou em "Escrever"/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "De quem é este fluxo" })).toBeTruthy();
  });

  it("desligar pede confirmação com o aviso do cliente e só então chama a função", async () => {
    montar();
    const lista = await abrirPasta("Clientes");
    fireEvent.click(within(lista).getByRole("switch"));
    expect(await screen.findByText(/fala com cliente ou lead/)).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Desligar" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("automacoes-n8n", { body: { acao: "desligar", fluxo_id: "Acq11MensagemSem", confirmar: true } }));
  });
});
