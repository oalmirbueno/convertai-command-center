import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 16/10 (dono): Contexto em abas de ícone (uma parte por vez, sem rolar até a
 * seção) e o Mês agendando o conteúdo que ainda não tem post, pela mesma
 * janela das aprovadas sem data.
 */

const mock = vi.hoisted(() => ({ from: vi.fn(), info: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: vi.fn(), functions: { invoke: vi.fn() }, storage: { from: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: mock.info } }));
vi.mock("@/components/mesa/AprovadasSemData", () => ({
  JanelaDaAprovada: ({ titulo, peca }: { titulo?: string; peca: { id: string; file_ids: string[] } }) => (
    <div role="dialog" aria-label={titulo}>
      {peca.id}:{peca.file_ids.join(",")}
    </div>
  ),
}));

import { AgendarNoMes } from "@/components/mesa/AgendaDoMes";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ItemDaAgenda, TrabalhoDaAgenda } from "@/components/mesa/useAgendaDoMes";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const valor = (podeRecarregar = true): MesaValor => ({
  clientId: "c-1",
  clientName: "Padaria",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar,
  saldoUsd: 10,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function comMesa(filho: ReactNode, podeRecarregar = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MesaProvider valor={valor(podeRecarregar)}>{filho}</MesaProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function consulta(linha: unknown) {
  const cadeia: any = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) cadeia[m] = () => cadeia;
  cadeia.maybeSingle = async () => ({ data: linha, error: null });
  return cadeia;
}

const item: ItemDaAgenda = { id: "t-1", title: "Promoção de sexta", description: null, due_date: "2026-10-20", delivery_type: "static", status: "todo", project_id: "p-1" };
const trabalho = (status: TrabalhoDaAgenda["status"]): TrabalhoDaAgenda => ({ id: "w-1", task_id: "t-1", status, cards: [], direcao: null, entrega_status: null, atualizado_em: "" });

describe("agendar pelo Mês", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.from.mockImplementation(() => consulta({ id: "w-1", task_id: "t-1", tipo: "post", status: "entregue", file_ids: ["f-1", "f-2"], post_id: null, aprovado_em: null, publicar_em: null, entrega_aviso: null }));
  });

  it("conteúdo entregue e ainda sem post: o ícone Agendar abre a janela das aprovadas com a peça", async () => {
    comMesa(<AgendarNoMes item={item} trabalho={trabalho("entregue")} agendado={false} />);
    const botao = screen.getByRole("button", { name: "Agendar" });
    await waitFor(() => expect(botao.getAttribute("aria-disabled")).toBeNull());
    expect(botao.textContent).toBe("");
    fireEvent.click(botao);
    expect(screen.getByRole("dialog", { name: "Agendar" }).textContent).toBe("w-1:f-1,f-2");
    expect(mock.from).toHaveBeenCalledWith("estudio_trabalhos");
  });

  it("já agendado ou quem não agenda: sem ícone", () => {
    const { unmount } = comMesa(<AgendarNoMes item={item} trabalho={trabalho("entregue")} agendado />);
    expect(screen.queryByRole("button", { name: "Agendar" })).toBeNull();
    unmount();
    comMesa(<AgendarNoMes item={item} trabalho={trabalho("entregue")} agendado={false} />, false);
    expect(screen.queryByRole("button", { name: "Agendar" })).toBeNull();
  });

  it("sem arte entregue: o ícone fica apagado e explica o porquê (nada é agendado)", () => {
    comMesa(<AgendarNoMes item={item} trabalho={trabalho("pronto")} agendado={false} />);
    const botao = screen.getByRole("button", { name: "Agendar" });
    expect(botao.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(botao);
    expect(mock.info).toHaveBeenCalledWith("entregue a arte no Estúdio primeiro");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mock.from).not.toHaveBeenCalled();
  });
});

describe("Contexto em abas e Mês com menos texto (fonte)", () => {
  it("o Contexto troca de aba sem rolar a página até a seção; cada aba guarda a própria rolagem", () => {
    const aba = ler("src/components/mesa/AbaContexto.tsx");
    const coluna = ler("src/components/mesa/ContextoAutomatico.tsx");
    for (const f of [aba, coluna]) {
      expect(f).not.toContain("scrollIntoView");
      expect(f).not.toContain("useHubsAbertos");
    }
    expect(aba).toContain("memoriaDaRolagem={`mesa:contexto:${clientId}:${abaAberta}`}");
    expect(aba).toContain('setAba("ctx-detalhes")');
  });

  it("ações do Mês só em ícone, com o nome no aria-label", () => {
    const mes = ler("src/components/mesa/AbaMes.tsx");
    for (const nome of ["Conteúdo rápido", "Criar conteúdos", "Abrir o Agente do mês"]) expect(mes).toContain(`aria-label="${nome}"`);
    expect(mes).not.toContain('<span className="truncate">Agente do mês</span>');
    const agenda = ler("src/components/mesa/AgendaDoMes.tsx");
    expect(agenda).toContain('aria-label="Limpar a seleção"');
    expect(agenda).not.toContain('<span className="mr-1 text-[12px] text-muted-foreground">Apagar da agenda</span>');
  });

  it("arquivos desta rodada: sem lookbehind, \\p{}, grupo nomeado, .at() nem travessão", () => {
    for (const rel of [
      "src/components/mesa/AbaContexto.tsx",
      "src/components/mesa/ContextoAutomatico.tsx",
      "src/components/mesa/ContextoFotos.tsx",
      "src/components/mesa/ContextoImagens.tsx",
      "src/components/mesa/CerebroDoCliente.tsx",
      "src/components/mesa/AbaMes.tsx",
      "src/components/mesa/AgendaDoMes.tsx",
      "src/components/mesa/MesConteudoRapido.tsx",
    ]) {
      const t = ler(rel);
      expect(t, rel).not.toContain("(?<");
      expect(t, rel).not.toMatch(/\\p\{/);
      expect(t, rel).not.toContain(".at(");
      expect(t, rel).not.toMatch(/[—–]/);
    }
  });
});
