import { createElement as h, useState, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 24/10/2026, telas do Mês. Dono: "Só entram Story e vídeos com roteiro ou IA para selecionar quando eu for
 * preparar; e também ter o poder de trocar conteúdos se eu quiser e não gostar da esteira que tem pronta".
 * Chips de formato (Novo calendário), Trocar uma peça (3 opções, o Jev recomenda, Confirmar e Desfazer),
 * Trocar várias (lista com as protegidas) e a peça de Stories que abre na aba Stories já com o tema.
 */

const mock = vi.hoisted(() => ({ tabelas: {} as Record<string, unknown>, invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lt", "lte", "gt", "overlaps", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x.png" }, error: null }) }) },
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u-1" } } }), getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AgendaDoMes from "@/components/mesa/AgendaDoMes";
import EscolhaDeFormatos from "@/components/mesa/EscolhaDeFormatos";
import PlanejarPeriodo from "@/components/mesa/PlanejarPeriodo";
import TrocarPeca from "@/components/mesa/TrocarPeca";
import type { OpcaoDoMes } from "../../supabase/functions/agente-calendario/modulos/escolha-do-mes";

const CLIENTE = "44444444-4444-4444-4444-444444444444";
const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: ReactNode, url = "/mesa?client=c&mes=2026-11-01") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [url] }, h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho })))));
}

const corpos = () => mock.invoke.mock.calls.map((c) => (c[1] as { body: Record<string, unknown> }).body);
const chamadasDe = (acao: string) => corpos().filter((b) => b.acao === acao);
/** O botão de custo pede o segundo clique quando não há estimativa (catálogo vazio no teste). */
async function clicarComCusto(nome: RegExp) {
  const botao = await screen.findByRole("button", { name: nome });
  fireEvent.click(botao);
  const armado = screen.queryByRole("button", { name: /clique de novo/i });
  if (armado) fireEvent.click(armado);
}

beforeEach(() => {
  mock.tabelas = {};
  mock.invoke.mockReset();
  mock.invoke.mockResolvedValue({ data: {}, error: null });
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("chips de formato da preparação", () => {
  function Escolha({ unico = false }: { unico?: boolean }) {
    const [v, setV] = useState<OpcaoDoMes[]>([]);
    return h(EscolhaDeFormatos, { valor: v, onMudar: setV, unico });
  }
  it("só ícones com nome no title; liga e desliga; a linha diz o que está escolhido", () => {
    montar(h(Escolha, {}));
    const grupo = screen.getByRole("group", { name: "Formatos" });
    const botoes = within(grupo).getAllByRole("button");
    expect(botoes.map((b) => b.getAttribute("aria-label"))).toEqual(["Carrossel", "Estático", "Foto", "Vídeo para gravar", "Vídeo com IA", "Stories"]);
    for (const b of botoes) {
      expect(b.getAttribute("title")).toBeTruthy();
      expect((b.textContent || "").trim()).toBe("");
    }
    expect(screen.getByText("Pelo nicho do cliente")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stories" }));
    fireEvent.click(screen.getByRole("button", { name: "Vídeo para gravar" }));
    expect(screen.getByRole("button", { name: "Stories" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-formatos-escolhidos]")!.textContent).toBe("Vídeo para gravar, Stories");
    fireEvent.click(screen.getByRole("button", { name: "Stories" }));
    expect(document.querySelector("[data-formatos-escolhidos]")!.textContent).toBe("Vídeo para gravar");
  });
  it("no modo de um só, escolher outro troca e clicar de novo solta", () => {
    montar(h(Escolha, { unico: true }));
    fireEvent.click(screen.getByRole("button", { name: "Foto" }));
    fireEvent.click(screen.getByRole("button", { name: "Vídeo com IA" }));
    expect(document.querySelector("[data-formatos-escolhidos]")!.textContent).toBe("Vídeo com IA");
    fireEvent.click(screen.getByRole("button", { name: "Vídeo com IA" }));
    expect(document.querySelector("[data-formatos-escolhidos]")!.textContent).toBe("Pelo nicho do cliente");
  });
});

describe("Novo calendário com Stories e vídeo", () => {
  it("os formatos escolhidos vão no pedido livre", async () => {
    mock.invoke.mockResolvedValue({ data: { proposta: { id: "p" }, resposta: "ok" }, error: null });
    montar(h(PlanejarPeriodo, { aberto: true, onAbertoChange: vi.fn(), mes: "2026-11-01", onPedidoInicio: vi.fn(), onPedidoFim: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Vídeo para gravar" }));
    fireEvent.click(screen.getByRole("button", { name: "Stories" }));
    await clicarComCusto(/Gerar proposta/);
    await waitFor(() => expect(chamadasDe("pedido_livre").length).toBe(1));
    const corpo = chamadasDe("pedido_livre")[0];
    expect(corpo.formatos).toEqual(["video_gravar", "stories"]);
    expect(String(corpo.mensagem)).toContain("Formatos escolhidos: Vídeo para gravar, Stories");
  });
});

describe("Trocar uma peça", () => {
  const OPCOES = [
    { opcao: "video_ia", rotulo: "Vídeo com IA", tema: "Antes e depois do jardim", gancho: "Olha esse quintal", resumo: "", cta: "", laminas: 0, por_que: "Mostra a transformação." },
    { opcao: "video_ia", rotulo: "Vídeo com IA", tema: "Poda em 15 segundos", gancho: "Pare de podar errado", resumo: "", cta: "", laminas: 0, por_que: "Gancho forte para o nicho." },
    { opcao: "video_ia", rotulo: "Vídeo com IA", tema: "Rega certa no calor", gancho: "", resumo: "", cta: "", laminas: 0, por_que: "" },
  ];
  it("3 opções com custo antes, o Jev recomenda, a equipe confirma e Desfazer volta", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: { body: Record<string, unknown> }) => {
      if (body.acao === "trocar_peca_opcoes") return Promise.resolve({ data: { mensagem_id: "m-1", opcoes: OPCOES, recomendada: 1, notas: [1.4, 2.8, 2.0], fonte_da_recomendacao: "jev", custo_usd: 0.01 }, error: null });
      if (body.acao === "trocar_peca_aplicar") return Promise.resolve({ data: { anexo: {}, task_id: "t1", titulo: "Poda em 15 segundos", opcao: "video_ia" }, error: null });
      if (body.acao === "trocar_peca_desfazer") return Promise.resolve({ data: { anexo: {}, task_id: "t1" }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    montar(h(TrocarPeca, { aberta: true, onMudar: vi.fn(), peca: { id: "t1", title: "Carrossel que não serviu", due_date: "2026-11-12" } }));
    fireEvent.click(screen.getByRole("button", { name: "Vídeo com IA" }));
    fireEvent.change(screen.getByLabelText("Pedido para a troca"), { target: { value: "algo de bastidor" } });
    // Nada muda antes de confirmar: só o pedido das opções.
    await clicarComCusto(/Ver 3 opções/);
    await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Opções para trocar" })).toBeTruthy());
    expect(chamadasDe("trocar_peca_opcoes")[0]).toEqual({ acao: "trocar_peca_opcoes", client_id: CLIENTE, task_id: "t1", opcao: "video_ia", pedido: "algo de bastidor" });
    expect(chamadasDe("trocar_peca_aplicar").length).toBe(0);
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBe(3);
    // A recomendada do Jev já vem marcada, com o ícone e o nível no title.
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    const jev = radios[1].querySelector("[data-recomendada]") as HTMLElement;
    expect(jev.getAttribute("title")).toContain("A melhor escolha para este dia");
    // A equipe escolhe outra e confirma.
    fireEvent.click(radios[0]);
    fireEvent.click(screen.getByRole("button", { name: /Trocar pela 1/ }));
    await waitFor(() => expect(chamadasDe("trocar_peca_aplicar").length).toBe(1));
    expect(chamadasDe("trocar_peca_aplicar")[0]).toEqual({ acao: "trocar_peca_aplicar", mensagem_id: "m-1", opcao: 0 });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Poda em 15 segundos"));
    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(chamadasDe("trocar_peca_desfazer").length).toBe(1));
    expect(chamadasDe("trocar_peca_desfazer")[0]).toEqual({ acao: "trocar_peca_desfazer", mensagem_id: "m-1" });
  });

  it("fechar sem escolher descarta as opções (nada muda na agenda)", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: { body: Record<string, unknown> }) =>
      Promise.resolve({ data: body.acao === "trocar_peca_opcoes" ? { mensagem_id: "m-2", opcoes: OPCOES, recomendada: 0, notas: [null, null, null], fonte_da_recomendacao: "ordem" } : {}, error: null }));
    const onMudar = vi.fn();
    montar(h(TrocarPeca, { aberta: true, onMudar, peca: { id: "t1", title: "X", due_date: null } }));
    await clicarComCusto(/Ver 3 opções/);
    await waitFor(() => expect(screen.getAllByRole("radio").length).toBe(3));
    expect(document.querySelector("[data-recomendada]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(chamadasDe("trocar_peca_aplicar").length).toBe(1));
    expect(chamadasDe("trocar_peca_aplicar")[0]).toEqual({ acao: "trocar_peca_aplicar", mensagem_id: "m-2", descartar: true });
    expect(onMudar).toHaveBeenCalledWith(false);
  });
});

describe("na Agenda do mês: Trocar, Trocar várias e Stories", () => {
  const tarefa = (id: string, title: string, delivery_type: string, due_date: string) => ({ id, title, description: null, due_date, delivery_type, status: "todo", project_id: "proj" });

  it("a peça marcada tem Trocar; a de Stories abre na aba Stories já com o tema e o dia", async () => {
    mock.tabelas.tasks = [tarefa("t1", "Carrossel da poda", "carousel", "2026-11-12"), tarefa("t2", "Stories: Rega certa", "story", "2099-11-13")];
    const { container } = montar(h(AgendaDoMes, {}), "/mesa?client=c&mes=2099-11-01");
    await waitFor(() => expect(container.querySelector('[data-dia="2099-11-13"] [data-cartao="item"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-dia="2099-11-13"] [data-cartao="item"]') as HTMLElement);
    expect(screen.getAllByRole("button", { name: /Trocar/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Abrir nos Stories: Stories: Rega certa" }));
    const guardados = Object.keys(window.localStorage).map((k) => [k, window.localStorage.getItem(k) || ""] as const);
    const nova = guardados.find(([k]) => k.indexOf(`mesa:stories:nova-v2:${CLIENTE}`) >= 0);
    expect(nova).toBeTruthy();
    const v = JSON.parse(nova![1]).v;
    expect(v.data).toBe("2099-11-13");
    expect(v.pedido).toContain("Rega certa");
    expect(guardados.some(([k, valor]) => k.indexOf(`mesa:stories:bloco:${CLIENTE}`) >= 0 && valor.indexOf("sequencia") >= 0)).toBe(true);
  });

  it("Trocar várias monta a lista sem custo e mostra as protegidas com o motivo", async () => {
    mock.tabelas.tasks = [tarefa("t1", "Carrossel da poda", "carousel", "2099-11-12"), tarefa("t2", "Foto do jardim", "carousel", "2099-11-13")];
    mock.invoke.mockImplementation((_f: string, { body }: { body: Record<string, unknown> }) => {
      if (body.acao === "propor_refazer_esteira") {
        return Promise.resolve({
          data: {
            mensagem_id: "m-9",
            refazer: 1,
            protegidas: [],
            acao: {
              tipo: "acao_agenda",
              resumo: "Refazer 1 peça de 11/2099, nas mesmas datas e formatos, com temas novos. 1 fica protegida.",
              apagar: [], mudar_data: [], mudar_formato: [], editar_campanhas: [], editar_textos: [], midia: [],
              refazer: [{ task_id: "t1", titulo: "Carrossel da poda", data: "2099-11-12", formato: "carrossel" }],
              protegidas: [{ task_id: "t2", titulo: "Foto do jardim", data: "2099-11-13", motivo: "Tem arte pronta no Estúdio." }],
              protecao_estrita: true,
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: {}, error: null });
    });
    const { container } = montar(h(AgendaDoMes, {}), "/mesa?client=c&mes=2099-11-01");
    await waitFor(() => expect(container.querySelector('[data-dia="2099-11-12"] [data-cartao="item"]')).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Trocar várias" }));
    const janela = await screen.findByRole("dialog", undefined, { timeout: 15000 });
    fireEvent.click(within(janela).getByRole("button", { name: /Montar a lista/ }));
    await waitFor(() => expect(chamadasDe("propor_refazer_esteira").length).toBe(1));
    expect(chamadasDe("propor_refazer_esteira")[0]).toMatchObject({ acao: "propor_refazer_esteira", client_id: CLIENTE, mes: "2099-11", so_nao_feitas: true });
    await waitFor(() => expect(janela.querySelector('[data-protegidas="1"]')).toBeTruthy());
    expect(janela.textContent).toContain("Tem arte pronta no Estúdio.");
    expect(janela.textContent).toContain("Carrossel da poda");
    // O refazer tem o custo antes e só acontece no Confirmar.
    expect(within(janela).getByRole("button", { name: /Confirmar e refazer 1/ })).toBeTruthy();
    expect(chamadasDe("executar_acao_agenda").length).toBe(0);
  });
});
