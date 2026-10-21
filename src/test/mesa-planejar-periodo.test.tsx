import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { corpoDoPedidoLivre } from "@/components/mesa/mesaV4Api";
import {
  fimDoMesDoPeriodo, inicioPadraoDoPeriodo, intervaloDoCalendario, pedidoDoCalendario,
  TIPOS_DO_PERIODO, TIPOS_INICIAIS_DO_PERIODO,
} from "@/components/mesa/pedidoDoPeriodo";
import { conferirDatasDoPeriodo, janelaDoPedidoComLimite } from "../../supabase/functions/agente-calendario/modulos/periodo-do-pedido";
import { janelaDoPedidoLivre } from "../../supabase/functions/agente-calendario/acoes-agenda";
import { corpoDoLoteRefeito, linhasDaPropostaAntiga, periodoGuardadoDaProposta } from "../../supabase/functions/agente-calendario/modulos/refazer-interno";

const estado = vi.hoisted(() => ({ clientId: "cliente-a", marcaId: "marca-a", pedido: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({
  useMesa: () => ({ clientId: estado.clientId, clientName: estado.clientId, catalogo: [] }),
  useMarcaDaMesa: () => ({ marca: { id: estado.marcaId } }),
}));
vi.mock("@/components/mesa/Custo", () => ({ BotaoComCusto: ({ rotulo, executar, disabled }: { rotulo: string; executar: () => Promise<unknown>; disabled: boolean }) => <button disabled={disabled} onClick={() => void executar()}>{rotulo}</button> }));
vi.mock("@/components/mesa/mesaV4Api", async (original) => ({
  ...await original<typeof import("@/components/mesa/mesaV4Api")>(),
  hojeIso: () => "2026-10-21",
  pedidoLivre: (pedido: unknown) => estado.pedido(pedido),
}));

import PlanejarPeriodo from "@/components/mesa/PlanejarPeriodo";

const escolhas = { clientId: "cliente-a", mes: "2026-11-01", inicio: "2026-11-02", dias: 7, tema: "", tipos: TIPOS_INICIAIS_DO_PERIODO };
beforeEach(() => { estado.clientId = "cliente-a"; estado.marcaId = "marca-a"; estado.pedido.mockReset().mockResolvedValue({ proposta: { id: "proposta", status: "pronta" } }); });

describe("Novo calendário usa período explícito", () => {
  it("limita 7, 14 e 30 dias ao mês selecionado, inclusive em fevereiro bissexto", () => {
    expect(intervaloDoCalendario("2026-11-01", "2026-11-02", 7)).toEqual({ inicio: "2026-11-02", fim: "2026-11-08", dias: 7, limitadoAoMes: false });
    expect(intervaloDoCalendario("2026-11-01", "2026-11-20", 14)).toEqual({ inicio: "2026-11-20", fim: "2026-11-30", dias: 11, limitadoAoMes: true });
    expect(intervaloDoCalendario("2028-02-01", "2028-02-01", 30).fim).toBe("2028-02-29");
    expect(fimDoMesDoPeriodo("2027-02-01")).toBe("2027-02-28");
    expect(inicioPadraoDoPeriodo("2026-11-01", "2026-10-21")).toBe("2026-11-01");
    expect(inicioPadraoDoPeriodo("2026-10-01", "2026-10-21")).toBe("2026-10-21");
  });

  it("valida datas reais, mês, período, tema e tipos antes de chamar IA", () => {
    expect(() => pedidoDoCalendario({ ...escolhas, inicio: "2026-10-21" })).toThrow("mês selecionado");
    expect(() => pedidoDoCalendario({ ...escolhas, mes: "2026-13-01" })).toThrow("mês válido");
    expect(() => pedidoDoCalendario({ ...escolhas, inicio: "2026-11-31" })).toThrow("mês selecionado");
    expect(() => pedidoDoCalendario({ ...escolhas, dias: 8 })).toThrow("7, 14 ou 30");
    expect(() => pedidoDoCalendario({ ...escolhas, tipos: [] })).toThrow("pelo menos um tipo");
    expect(() => pedidoDoCalendario({ ...escolhas, tipos: ["inventado"] })).toThrow("tipo de conteúdo válido");
    expect(() => pedidoDoCalendario({ ...escolhas, tema: "x".repeat(501) })).toThrow("500 caracteres");
    expect(TIPOS_DO_PERIODO).toHaveLength(12);
    expect(TIPOS_INICIAIS_DO_PERIODO).toEqual(["educativo", "engajamento", "vendas", "dica_rapida"]);
  });

  it("prepara só pedido_livre no cliente e mês corretos, preservando a agenda e a revisão humana", () => {
    const pedido = pedidoDoCalendario({ ...escolhas, tema: "Presentes de Natal", dias: 30 });
    const corpo = corpoDoPedidoLivre(pedido);
    expect(corpo).toMatchObject({ acao: "pedido_livre", client_id: "cliente-a", mes: "2026-11", data_inicio: "2026-11-02", data_fim: "2026-11-30" });
    expect(corpo).not.toHaveProperty("rotear");
    expect(corpo).not.toHaveProperty("pecas");
    expect(pedido.mensagem).toContain("Nicho/tema solicitado: Presentes de Natal");
    expect(pedido.mensagem).toContain("preserve integralmente pautas, datas, arquivos e aprovações");
    expect(pedido.mensagem).toContain("Não grave tarefas na agenda");
    expect(pedido.mensagem).toContain("no máximo 12 nesta proposta");
    expect(corpoDoPedidoLivre({ clientId: "antigo", mensagem: "Prepare um conteúdo" })).toEqual({ acao: "pedido_livre", client_id: "antigo", mensagem: "Prepare um conteúdo" });
  });

  it("mantém a janela legada de pelo menos 30 dias e só restringe quando há data_fim", () => {
    const mensagem = "Prepare conteúdos até 2026-12-10";
    expect(janelaDoPedidoComLimite("2026-11-02", mensagem, undefined)).toEqual(janelaDoPedidoLivre("2026-11-02", mensagem));
    expect(janelaDoPedidoComLimite("2026-11-02", "", undefined).fim).toBe("2026-12-02");
    const curta = janelaDoPedidoComLimite("2026-11-02", mensagem, "2026-11-08", "2026-11");
    expect(curta.fim).toBe("2026-11-08");
    expect(curta.uteis).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(janelaDoPedidoComLimite("2026-11-20", "", "2026-11-30").uteis.slice(-1)[0]).toBe("2026-11-30");
  });

  it.each(["2026-11-31", "2026-10-31", "2026-12-01", "amanhã", null])("servidor recusa fim inválido %s", (fim) => {
    expect(() => janelaDoPedidoComLimite("2026-11-02", "", fim, "2026-11")).toThrow();
  });

  it("recusa mês divergente e datas da proposta fora da janela, sem alargar o calendário", () => {
    expect(() => janelaDoPedidoComLimite("2026-11-02", "", "2026-11-08", "2026-12")).toThrow("mês selecionado");
    expect(() => janelaDoPedidoComLimite("2026-10-31", "", "2026-10-31", "2026-10")).toThrow("dias úteis");
    expect(() => conferirDatasDoPeriodo([{ data: "2026-12-01" }], "2026-11-02", "2026-11-30")).toThrow("fora do período");
    expect(() => conferirDatasDoPeriodo([{ data: "2026-11-30" }], "2026-11-02", "2026-11-30")).not.toThrow();
  });
});

describe("Formulário Novo calendário", () => {
  it("abre a conversa com uma proposta e não chama a gravação da agenda", async () => {
    const qc = new QueryClient();
    const iniciar = vi.fn(), fim = vi.fn(), fechar = vi.fn();
    const { unmount } = render(<QueryClientProvider client={qc}><PlanejarPeriodo aberto onAbertoChange={fechar} mes="2026-11-01" onPedidoInicio={iniciar} onPedidoFim={fim} /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Nicho ou tema do calendário"), { target: { value: "Vitrine de Natal" } });
    fireEvent.change(screen.getByLabelText("Período do calendário"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar proposta" }));
    await waitFor(() => expect(fim).toHaveBeenCalledOnce());
    expect(estado.pedido).toHaveBeenCalledOnce();
    expect(estado.pedido.mock.calls[0][0]).toMatchObject({ clientId: "cliente-a", mes: "2026-11", dataInicio: "2026-11-01", dataFim: "2026-11-30" });
    expect(iniciar.mock.calls[0][0].mensagem).toContain("Vitrine de Natal");
    expect(fechar).toHaveBeenCalledWith(false);
    const fonte = readFileSync(resolve("src/components/mesa/PlanejarPeriodo.tsx"), "utf8");
    expect(fonte).not.toMatch(/gravarProposta|gravarSelecionados|conteudoRapido|from\("tasks"\)|atualizarAgenda/);
    unmount(); qc.clear();
  });

  it("trocar de cliente ou marca reinicia o rascunho e o pedido mantém somente o cliente atual", async () => {
    const qc = new QueryClient();
    const props = { aberto: true, onAbertoChange: vi.fn(), mes: "2026-11-01", onPedidoInicio: vi.fn(), onPedidoFim: vi.fn() };
    const arvore = () => <QueryClientProvider client={qc}><PlanejarPeriodo {...props} /></QueryClientProvider>;
    const { rerender, unmount } = render(arvore());
    fireEvent.change(screen.getByLabelText("Nicho ou tema do calendário"), { target: { value: "Tema do cliente A" } });
    estado.clientId = "cliente-b"; estado.marcaId = "marca-b";
    rerender(arvore());
    expect((screen.getByLabelText("Nicho ou tema do calendário") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Gerar proposta" }));
    await waitFor(() => expect(estado.pedido).toHaveBeenCalledOnce());
    expect(estado.pedido.mock.calls[0][0].clientId).toBe("cliente-b");
    expect(estado.pedido.mock.calls[0][0].mensagem).not.toContain("Tema do cliente A");
    unmount(); qc.clear();
  });
});

describe("Refazer preserva o período do Novo calendário", () => {
  it("repassa o intervalo congelado para cada lote e mantém a janela do pedido refeito em sete dias", () => {
    const antiga = { client_id: "cliente-a", project_id: "projeto-a", parametros: { origem: "pedido_livre", periodo_pedido: { inicio: "2026-11-20", fim: "2026-11-26" } } };
    const linhas = linhasDaPropostaAntiga([{ data: "2026-11-23", formato: "carrossel", tema: "Vitrine" }, { data: "2026-11-25", formato: "estatico", tema: "Oferta" }]);
    const guardado = periodoGuardadoDaProposta(antiga.parametros);
    expect(guardado).toEqual({ inicio: "2026-11-20", fim: "2026-11-26", mes: "2026-11" });
    const corpo = corpoDoLoteRefeito(antiga, "Refaça sem mudar datas. Referência histórica: 2026-12-10", linhas);
    expect(corpo).toMatchObject({ client_id: "cliente-a", project_id: "projeto-a", data_inicio: "2026-11-20", data_fim: "2026-11-26", mes: "2026-11", pecas: linhas });
    expect(janelaDoPedidoComLimite(String(corpo.data_inicio), String(corpo.mensagem), corpo.data_fim, corpo.mes)).toEqual({ fim: "2026-11-26", uteis: ["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"] });
  });

  it("não acrescenta limites ao refazer uma proposta legada", () => {
    const antiga = { client_id: "cliente-antigo", project_id: null, parametros: { origem: "pedido_livre" } };
    const linhas = linhasDaPropostaAntiga([{ data: "2026-11-23", tema: "Conteúdo antigo" }]);
    expect(periodoGuardadoDaProposta(antiga.parametros)).toBeNull();
    expect(corpoDoLoteRefeito(antiga, "Refazer", linhas)).toEqual({ acao: "pedido_livre", client_id: "cliente-antigo", mensagem: "Refazer", pecas: linhas });
  });

  it("recusa marcador inválido e lote fora da janela em vez de expandir para o mês inteiro", () => {
    expect(() => periodoGuardadoDaProposta({ periodo_pedido: null })).toThrow("inválido");
    expect(() => periodoGuardadoDaProposta({ periodo_pedido: { inicio: "2026-11-20" } })).toThrow("incompleto");
    expect(() => periodoGuardadoDaProposta({ periodo_pedido: { inicio: "2026-11-20", fim: "2026-12-01" } })).toThrow("mesmo mês");
    const antiga = { client_id: "cliente-a", project_id: null, parametros: { periodo_pedido: { inicio: "2026-11-20", fim: "2026-11-26" } } };
    const fora = linhasDaPropostaAntiga([{ data: "2026-11-30", tema: "Não cabe" }]);
    expect(() => corpoDoLoteRefeito(antiga, "Refazer", fora)).toThrow("fora do período");
  });
});
