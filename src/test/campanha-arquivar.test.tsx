import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mock = vi.hoisted(() => ({ chamar: vi.fn() }));

vi.mock("@/lib/mesa/api", async (original) => {
  const real = await original<typeof import("@/lib/mesa/api")>();
  return { ...real, chamarFuncao: (...args: unknown[]) => mock.chamar(...args) };
});
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "cliente-1" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import {
  AVISO_DA_LINHA_DO_TEMPO,
  campanhaArquivada,
  camposDoArquivo,
  faltaColunaDoArquivo,
  temLinhaDoTempo,
  validarPeriodoDaCampanha,
} from "../../supabase/functions/_shared/arquivo-da-campanha";
import { marcarCampanhaDoMes, type LinhaCampanhaDaMesa } from "../../supabase/functions/mesa-foto/campanhas";
import { corpoDoArquivar, corpoDoPeriodo, separarPorArquivo } from "@/components/mesa/arquivoDaCampanha";
import MenuDaCampanha, { JanelaDoPeriodo } from "@/components/mesa/CampanhaArquivo";
import type { Campanha } from "@/components/mesa/mesaV4Api";

const campanha = (extra: Partial<Campanha> = {}): Campanha => ({
  id: "camp-1",
  client_id: "cliente-1",
  nome: "Black Friday",
  pedido: null,
  objetivo: null,
  periodo_inicio: "2026-11-20",
  periodo_fim: "2026-11-30",
  conceito: null,
  identidade: null,
  referencias_ids: null,
  selo_path: null,
  proposta_id: null,
  status: "planejada",
  custo_usd: 0,
  criado_em: "2026-11-01T00:00:00Z",
  ...extra,
});

function montar(ui: JSX.Element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => mock.chamar.mockReset());

describe("período da campanha (regra única do servidor, do MCP e da tela)", () => {
  it("aceita AAAA-MM-DD com fim no mesmo dia ou depois, até 62 dias contando os dois", () => {
    expect(validarPeriodoDaCampanha("2026-11-20", "2026-11-20")).toEqual({ ok: true, inicio: "2026-11-20", fim: "2026-11-20", dias: 1 });
    expect(validarPeriodoDaCampanha("2026-11-01", "2027-01-01")).toMatchObject({ ok: true, dias: 62 });
  });

  it("recusa vazio, formato errado, data que não existe, fim antes do início e mais de 62 dias", () => {
    expect(validarPeriodoDaCampanha("", "2026-11-20")).toMatchObject({ ok: false, codigo: "periodo_incompleto" });
    expect(validarPeriodoDaCampanha(undefined, undefined)).toMatchObject({ ok: false, codigo: "periodo_incompleto" });
    expect(validarPeriodoDaCampanha("20/11/2026", "2026-11-30")).toMatchObject({ ok: false, codigo: "data_invalida" });
    expect(validarPeriodoDaCampanha("2026-02-30", "2026-03-10")).toMatchObject({ ok: false, codigo: "data_invalida" });
    expect(validarPeriodoDaCampanha("2026-11-20", "2026-11-19")).toMatchObject({ ok: false, codigo: "periodo_invalido" });
    expect(validarPeriodoDaCampanha("2026-11-01", "2027-01-02")).toMatchObject({ ok: false, codigo: "periodo_longo" });
  });

  it("linha do tempo gravada pede Reorganizar (o período não recalcula as fases)", () => {
    expect(temLinhaDoTempo({ linha_do_tempo: { evento: "2026-11-27" } })).toBe(true);
    expect(temLinhaDoTempo({})).toBe(false);
    expect(temLinhaDoTempo(null)).toBe(false);
    expect(AVISO_DA_LINHA_DO_TEMPO).toContain("Reorganizar");
  });
});

describe("arquivo da campanha", () => {
  it("arquivar grava data e autor; desarquivar limpa os dois; status não entra", () => {
    const agora = new Date("2026-11-16T15:00:00Z");
    expect(camposDoArquivo(true, "u-1", agora)).toEqual({ arquivada_em: "2026-11-16T15:00:00.000Z", arquivada_por: "u-1" });
    expect(camposDoArquivo(false, "u-1", agora)).toEqual({ arquivada_em: null, arquivada_por: null });
    expect(Object.keys(camposDoArquivo(true, "u-1"))).not.toContain("status");
  });

  it("reconhece arquivada e o erro de coluna que ainda não existe", () => {
    expect(campanhaArquivada({ arquivada_em: "2026-11-16T15:00:00Z" })).toBe(true);
    expect(campanhaArquivada({ arquivada_em: null })).toBe(false);
    expect(campanhaArquivada({})).toBe(false);
    expect(faltaColunaDoArquivo({ code: "42703", message: "column mesa_campanhas.arquivada_em does not exist" })).toBe(true);
    expect(faltaColunaDoArquivo({ code: "23514", message: "check" })).toBe(false);
  });

  it("separa ativas e arquivadas (a arquivada mais recente primeiro)", () => {
    const r = separarPorArquivo([
      { id: "a", arquivada_em: null },
      { id: "b", arquivada_em: "2026-11-10T00:00:00Z" },
      { id: "c" },
      { id: "d", arquivada_em: "2026-11-15T00:00:00Z" },
    ]);
    expect(r.ativas.map((c) => c.id)).toEqual(["a", "c"]);
    expect(r.arquivadas.map((c) => c.id)).toEqual(["d", "b"]);
  });

  it("corpos das ações para o agente-calendario", () => {
    expect(corpoDoArquivar("camp-1", true)).toEqual({ acao: "campanha_arquivar", campanha_id: "camp-1", arquivar: true });
    expect(corpoDoArquivar("camp-1", false)).toEqual({ acao: "campanha_arquivar", campanha_id: "camp-1", arquivar: false });
    expect(corpoDoPeriodo("camp-1", "2026-11-20", "2026-12-01")).toEqual({ acao: "campanha_periodo", campanha_id: "camp-1", periodo_inicio: "2026-11-20", periodo_fim: "2026-12-01" });
  });
});

describe("campanha do mês: arquivada nunca é a do mês", () => {
  const agora = new Date("2026-11-16T15:00:00Z");
  const linha = (id: string, extra: Partial<LinhaCampanhaDaMesa> = {}): LinhaCampanhaDaMesa => ({
    id, nome: id, pedido: null, objetivo: null, conceito: null, periodo_inicio: null, periodo_fim: null, status: "planejada",
    identidade: null, referencias_ids: null, proposta_id: null, criado_em: "2026-11-01T00:00:00Z", ...extra,
  });

  it("a arquivada sai da lista padrão, mesmo acontecendo hoje", () => {
    const r = marcarCampanhaDoMes([
      linha("arq", { periodo_inicio: "2026-11-10", periodo_fim: "2026-11-30", arquivada_em: "2026-11-15T00:00:00Z" }),
      linha("viva", { periodo_inicio: "2026-11-25", periodo_fim: "2026-11-30" }),
    ], [], agora);
    expect(r.campanhas.map((c) => c.id)).toEqual(["viva"]);
    expect(r.campanha_do_mes_id).toBe("viva");
  });

  it("com incluirArquivadas ela vem no fim, marcada, e mesmo assim não é a do mês", () => {
    const r = marcarCampanhaDoMes([
      linha("arq", { periodo_inicio: "2026-11-10", periodo_fim: "2026-11-30", arquivada_em: "2026-11-15T00:00:00Z" }),
    ], [], agora, { incluirArquivadas: true });
    expect(r.campanha_do_mes_id).toBeNull();
    expect(r.campanhas[0]).toMatchObject({ id: "arq", arquivada: true, do_mes: false, acontecendo_hoje: false, motivo: "Campanha arquivada." });
  });
});

describe("tela: Editar período e Arquivar campanha", () => {
  it("o período inválido não sai para o servidor e mostra o motivo", async () => {
    montar(<JanelaDoPeriodo campanha={campanha()} aberta onMudar={() => {}} />);
    const janela = await screen.findByRole("dialog", { name: "Editar período" });
    fireEvent.change(within(janela).getByLabelText("Início"), { target: { value: "2026-11-20" } });
    fireEvent.change(within(janela).getByLabelText("Fim"), { target: { value: "2026-11-10" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar período" }));
    expect(await within(janela).findByRole("alert")).toHaveTextContent("O fim da campanha vem antes do início.");
    expect(mock.chamar).not.toHaveBeenCalled();
  });

  it("o período válido vai como campanha_periodo e fecha a janela", async () => {
    mock.chamar.mockResolvedValue({ campanha: campanha({ periodo_fim: "2026-12-05" }), avisos: [], linha_do_tempo_desatualizada: false, custo_usd: 0 });
    const onMudar = vi.fn();
    montar(<JanelaDoPeriodo campanha={campanha()} aberta onMudar={onMudar} />);
    const janela = await screen.findByRole("dialog", { name: "Editar período" });
    fireEvent.change(within(janela).getByLabelText("Fim"), { target: { value: "2026-12-05" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar período" }));
    await waitFor(() => expect(onMudar).toHaveBeenCalledWith(false));
    expect(mock.chamar).toHaveBeenCalledWith("agente-calendario", { acao: "campanha_periodo", campanha_id: "camp-1", periodo_inicio: "2026-11-20", periodo_fim: "2026-12-05" });
  });

  it("Arquivar pede confirmação antes de chamar o servidor", async () => {
    mock.chamar.mockResolvedValue({ campanha: campanha({ arquivada_em: "2026-11-16T15:00:00Z" }), arquivada: true, custo_usd: 0 });
    montar(<MenuDaCampanha campanha={campanha()} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Mais ações de Black Friday" }), { key: "Enter" });
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Arquivar campanha" }));
    const confirmar = await screen.findByRole("alertdialog", { name: "Arquivar campanha?" });
    expect(mock.chamar).not.toHaveBeenCalled();
    fireEvent.click(within(confirmar).getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(mock.chamar).toHaveBeenCalledWith("agente-calendario", { acao: "campanha_arquivar", campanha_id: "camp-1", arquivar: true }));
  });

  it("campanha arquivada mostra Desarquivar no menu, sem confirmação", async () => {
    mock.chamar.mockResolvedValue({ campanha: campanha(), arquivada: false, custo_usd: 0 });
    montar(<MenuDaCampanha campanha={campanha({ arquivada_em: "2026-11-16T15:00:00Z" })} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Mais ações de Black Friday" }), { key: "Enter" });
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Desarquivar campanha" }));
    await waitFor(() => expect(mock.chamar).toHaveBeenCalledWith("agente-calendario", { acao: "campanha_arquivar", campanha_id: "camp-1", arquivar: false }));
  });
});
