import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 18/11/2026: tela /grupos. Quem espera resposta vem primeiro, com o que o
 * cliente disse; clicar abre o resumo do dia e a conversa (áudio transcrito e
 * imagem descrita). A tela só lê `grupos_ao_vivo`.
 */

const haMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
let resposta: { data: unknown; error: { message: string } | null };
const rpc = vi.fn(async () => resposta);

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...(a as [])) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, profile: { role: "admin" } }) }));
vi.mock("@/components/admin/LogoDoCliente", () => ({ default: ({ nome }: { nome: string }) => h("span", { "data-logo": nome }), useIdentidadesDosClientes: () => ({ data: new Map() }) }));

import GruposAoVivo from "@/pages/GruposAoVivo";

const leitura = () => ({
  disponivel: true,
  gerado_em: haMin(0),
  saude: { ultima_mensagem: haMin(5), ultimo_resumo: haMin(1500), resumos_com_falha: 12, midias_24h: 4, midias_entendidas_24h: 4 },
  clientes: [
    { client_id: "a", cliente: "Acerbi", conversas: 13, respondidas: 13, mediana_resposta_min: 1, esperando_desde: null, mensagens_hoje: 5, ultima_da_agencia: haMin(30), ultima_do_cliente: haMin(31), tarefas_abertas: 2, mensagens: [] },
    {
      client_id: "m", cliente: "Mirante", conversas: 11, respondidas: 10, mediana_resposta_min: 7, esperando_desde: haMin(240), esperando_mensagens: 1, esperando_texto: "Pq estou longe",
      esperando_quem: "Simone", mensagens_hoje: 8, tarefas_abertas: 8, resumo_falhou_hoje: true,
      resumo: { dia: "2026-11-17", gerado_em: haMin(1500), no_dossie: true, resumo: null, sugestoes: ["Cobrar a Simone sobre o Natal"],
        itens: [{ tipo: "feito_agencia", texto: "A agência subiu o anúncio novo." }, { tipo: "pedido_cliente", texto: "Pediu a arte do feriado.", veio_de_audio: true }] },
      mensagens: [
        { id: "1", quando: haMin(250), papel: "agencia", nome: "Almir", tipo: "texto", texto: "Consegue mandar hoje?" },
        { id: "2", quando: haMin(240), papel: "cliente_equipe", nome: "Simone", tipo: "texto", texto: "Pq estou longe" },
        { id: "3", quando: haMin(239), papel: "cliente_equipe", nome: "Simone", tipo: "imagem", texto: null, descricao: "Print de conversa com o hóspede." },
        { id: "4", quando: haMin(600), papel: "bot", tipo: "texto", texto: "Post novo no ar" },
      ] },
  ],
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(GruposAoVivo))));
}

afterEach(() => { cleanup(); rpc.mockClear(); });

describe("Grupos dos clientes (tela)", () => {
  it("quem espera resposta vem primeiro, com o que o cliente disse; números no topo e resumo parado à vista", async () => {
    resposta = { data: leitura(), error: null };
    montar();
    const lista = await screen.findByRole("list", { name: "Grupos dos clientes" });
    const linhas = within(lista).getAllByRole("button");
    expect(linhas.map((l) => l.getAttribute("title"))).toEqual(["Abrir o grupo de Mirante", "Abrir o grupo de Acerbi"]);
    expect(linhas[0].textContent).toContain("Simone: Pq estou longe");
    expect(linhas[0].textContent).toContain("espera há 4 h");
    expect(linhas[1].textContent).toContain("Respondido");
    expect(rpc).toHaveBeenCalledWith("grupos_ao_vivo");
    expect(screen.getByText("1 grupo esperando resposta", { exact: false })).toBeTruthy();
    expect(screen.getByText("Parado")).toBeTruthy();
    expect(screen.getByText("23 de 24 conversas na semana")).toBeTruthy();
  });

  it("abrir o grupo que espera resposta cai na conversa; o resumo fica na outra aba; aviso automático não polui", async () => {
    resposta = { data: leitura(), error: null };
    montar();
    fireEvent.click(await screen.findByTitle("Abrir o grupo de Mirante"));
    const conversa = await screen.findByRole("list", { name: "Conversa dos últimos 3 dias" });
    expect(conversa.textContent).toContain("Consegue mandar hoje?");
    expect(conversa.textContent).toContain("Print de conversa com o hóspede.");
    expect(conversa.textContent).not.toContain("Post novo no ar");
    fireEvent.click(screen.getByRole("tab", { name: "Resumo" }));
    expect(await screen.findByText("Pediu a arte do feriado.")).toBeTruthy();
    expect(screen.getByText("Pedidos do cliente")).toBeTruthy();
    expect(screen.getByText("Cobrar a Simone sobre o Natal")).toBeTruthy();
    expect(screen.getByText(/O resumo de hoje ainda não saiu/)).toBeTruthy();
  });

  it("erro do banco e ambiente sem leitura têm estado próprio", async () => {
    resposta = { data: null, error: { message: "Somente a equipe vê os grupos." } };
    montar();
    expect(await screen.findByText("Não foi possível ler os grupos.")).toBeTruthy();
    cleanup();
    resposta = { data: { disponivel: false }, error: null };
    montar();
    expect(await screen.findByText("A leitura dos grupos não está ligada neste ambiente.")).toBeTruthy();
  });
});
