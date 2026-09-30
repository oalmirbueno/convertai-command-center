import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement as h } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogoDoConselho, SessaoDoConselho } from "@/lib/conselho/api";

/**
 * Frente BRF2: convocar o conselho com preset por tema, modo rápido, todos
 * com o mesmo modelo, pauta e elenco salvo. O custo estimado usa o modo e o
 * pedido de convocação leva o modo, os critérios do preset e a pauta.
 *
 * Frente UXS (simplificação): à vista só pergunta, especialistas e rodapé;
 * o resto em "Ajustes" (recolhido). A mesa com preset já abre com ele (sem
 * passar por cima do rascunho do dono). O rodapé diz por que o Convocar
 * trava, com "Ajustar". A estimativa tem respiro (vários cliques, uma
 * chamada) e o Convocar nunca vai com o custo de outro elenco. A lista de
 * arquivos só é lida com a pauta aberta.
 */

const estimar = vi.fn();
const convocar = vi.fn();
const salvar = vi.fn();
let sessoesDoCliente: SessaoDoConselho[] = [];

const arquivos = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", file_name: "briefing-site.pdf", folder: "operacionais", created_at: "2026-09-29T10:00:00Z" }];
vi.mock("@/integrations/supabase/client", () => {
  const cadeia: Record<string, unknown> = {};
  ["select", "eq", "is", "order", "limit"].forEach((k) => (cadeia[k] = () => cadeia));
  (cadeia as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: arquivos, error: null }).then(ok);
  return { supabase: { from: vi.fn(() => cadeia), channel: vi.fn(), removeChannel: vi.fn(), functions: { invoke: vi.fn() } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/mesa/MesaContexto", () => ({
  useCatalogo: () => ({ data: ["m1", "m2"].map((id) => ({ id, ativo: true, tipo: "texto", provedor: "openai", modelo_api: id, rotulo: id, padrao_para: id === "m1" ? ["conselho"] : [] })), isLoading: false }),
}));
vi.mock("@/components/mesa/Seletores", () => ({
  SeletorDeModelo: ({ valor, onChange, rotulo }: { valor: string; onChange: (v: string) => void; rotulo: string }) =>
    h("select", { "aria-label": rotulo, value: valor, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, h("option", { value: "" }, "-"), h("option", { value: "m1" }, "M1"), h("option", { value: "m2" }, "M2")),
}));

const PRESET_CRISE = { id: "crise", nome: "Crise", origem: "painel-crise", especialistas: ["gestao_crise", "estrategista_marca", "copywriter", "comercial", "cetico"], criterios: ["protege a confiança", "responde rápido", "tom humano"], modo: "rapido", rodadas: 2, tema: "Resposta à crise", pergunta: "O que a marca deve fazer agora?" };
const PRESET_PROPOSTA = { id: "proposta", nome: "Proposta", origem: "mesa-proposta", especialistas: ["comercial", "estrategista_marca", "copywriter", "cetico"], criterios: ["resolve a dor", "escopo claro"], modo: "padrao", rodadas: 3, tema: "Estratégia da proposta", pergunta: "Como montar a proposta para este cliente?" };

function catalogo(presets: unknown[]): CatalogoDoConselho {
  return {
    especialistas: [
      { id: "estrategista_marca", nome: "Estrategista de marca", area: "Marca", visao: "", criterio: "" },
      { id: "copywriter", nome: "Copywriter", area: "Texto", visao: "", criterio: "" },
      { id: "comercial", nome: "Comercial", area: "Venda", visao: "", criterio: "" },
      { id: "cetico", nome: "Cético", area: "Advogado do diabo", visao: "", criterio: "" },
      { id: "gestao_crise", nome: "Gestão de crise", area: "Reputação", visao: "", criterio: "" },
    ],
    padrao: ["comercial", "estrategista_marca", "copywriter", "cetico"],
    criterios: ["responde à pergunta", "viável", "coerente"],
    limites: { min_especialistas: 2, max_especialistas: 6, min_rodadas: 2, max_rodadas: 4, teto_maximo_usd: 50 },
    modelo_padrao: "m1",
    presets: presets as CatalogoDoConselho["presets"],
    modos: [{ id: "rapido", rotulo: "Rápido", rodadas: 2 }, { id: "padrao", rotulo: "Padrão", rodadas: null }, { id: "profundo", rotulo: "Profundo", rodadas: 4 }],
  };
}
// O primeiro teste é o da BRF2: só o preset de crise, sem origem (nenhum entra sozinho).
let catalogoAtual: CatalogoDoConselho = catalogo([{ ...PRESET_CRISE, origem: undefined }]);

vi.mock("@/lib/conselho/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/conselho/api")>();
  return {
    ...real,
    lerCatalogoDoConselho: async () => catalogoAtual,
    estimarConselho: (p: unknown) => estimar(p),
    convocarConselho: (p: unknown) => convocar(p),
    listarElencos: async () => [],
    salvarElenco: (p: unknown) => salvar(p),
    useSessoesDoConselho: () => ({ data: sessoesDoCliente, refetch: vi.fn() }),
  };
});

import ConvocarConselho from "@/components/conselho/ConvocarConselho";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { supabase } from "@/integrations/supabase/client";

function montar(props: Partial<Parameters<typeof ConvocarConselho>[0]> = {}) {
  const abrir = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(h(QueryClientProvider, { client: qc }, h(ConvocarConselho, { clientId: "c1", origem: "mesa-proposta", temaInicial: "Proposta da Acerbi", onAbrir: abrir, ...props })));
  return { abrir };
}

const rodape = () => document.querySelector("[data-estimativa-do-conselho]") as HTMLElement;
const abrirAjustes = () => fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
const esperar = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

beforeEach(() => {
  estimar.mockReset();
  convocar.mockReset();
  salvar.mockReset();
  (supabase.from as ReturnType<typeof vi.fn>).mockClear();
  // Custo cresce com o elenco (rápido é fixo e barato).
  estimar.mockImplementation(async (p: { modo: string; especialistas: string[] }) => {
    const total = p.modo === "rapido" ? 0.05 : Math.round(p.especialistas.length * 10) / 100;
    return { estimativa: { por_rodada: [], total_usd: total }, teto_sugerido_usd: p.modo === "rapido" ? 0.07 : Math.round(total * 130) / 100 };
  });
  convocar.mockResolvedValue({ sessao: { id: "s9" }, estimativa: { total_usd: 0.05 } });
  salvar.mockResolvedValue({ id: "e1" });
  sessoesDoCliente = [];
  catalogoAtual = catalogo([{ ...PRESET_CRISE, origem: undefined }]);
  localStorage.clear();
});

describe("convocar o conselho (frente BRF2)", () => {
  it("preset de crise: elenco, modo rápido (2 rodadas) e a pergunta modelo; convocar leva modo, critérios e pauta", async () => {
    const { abrir } = montar();
    fireEvent.click(await screen.findByRole("button", { name: "Crise" }));
    expect(screen.getByRole("button", { name: /Gestão de crise/ })).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByLabelText("Pergunta") as HTMLTextAreaElement).value).toBe("O que a marca deve fazer agora?");
    abrirAjustes();
    expect((screen.getByLabelText("Tema") as HTMLInputElement).value).toBe("Resposta à crise: Proposta da Acerbi");
    await waitFor(() => expect(estimar).toHaveBeenLastCalledWith(expect.objectContaining({ modo: "rapido", rodadas: 2 })));
    await screen.findByText("Custo estimado US$ 0,05");
    // Todos com o mesmo modelo.
    fireEvent.change(screen.getByLabelText("Todos com o mesmo modelo"), { target: { value: "m2" } });
    await waitFor(() => expect(estimar).toHaveBeenLastCalledWith(expect.objectContaining({ modelos: { gestao_crise: "m2", estrategista_marca: "m2", copywriter: "m2", comercial: "m2", cetico: "m2" } })));
    // Pauta com um item e um anexo do cliente.
    fireEvent.click(screen.getByRole("button", { name: /Pauta e anexos/ }));
    fireEvent.change(screen.getByLabelText("Itens da pauta"), { target: { value: "O post apagado\nResposta nos comentários" } });
    fireEvent.click(await screen.findByLabelText(/briefing-site\.pdf/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Convocar o conselho/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Convocar o conselho/ }));
    await waitFor(() => expect(convocar).toHaveBeenCalledTimes(1));
    expect(convocar.mock.calls[0][0]).toMatchObject({
      modo: "rapido",
      rodadas: 2,
      criterios: ["protege a confiança", "responde rápido", "tom humano"],
      pauta: { itens: ["O post apagado", "Resposta nos comentários"], anexos: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] },
      especialistas: ["gestao_crise", "estrategista_marca", "copywriter", "comercial", "cetico"],
    });
    expect(abrir).toHaveBeenCalledWith("s9");
  });

  it("salvar o elenco (pelo botão da linha dos presets) leva quem entra, os modelos, o modo e se é da agência", async () => {
    montar({ temaInicial: "Proposta" });
    await screen.findByRole("button", { name: /Comercial/ });
    fireEvent.click(screen.getByRole("button", { name: "Salvar elenco" }));
    const janela = await screen.findByLabelText("Nome do elenco para salvar");
    fireEvent.change(janela, { target: { value: "Time comercial" } });
    fireEvent.click(screen.getByLabelText("Para a agência toda"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1", nome: "Time comercial", especialistas: ["comercial", "estrategista_marca", "copywriter", "cetico"], modo: "padrao", rodadas: 4, daAgencia: true })));
    // Salvou: fecha e limpa.
    await waitFor(() => expect(screen.queryByLabelText("Nome do elenco para salvar")).toBeNull());
  });
});

describe("convocar simplificado (frente UXS)", () => {
  it("à vista só pergunta, especialistas e rodapé; o resto em Ajustes, com o resumo", async () => {
    montar();
    await screen.findByLabelText("Pergunta");
    expect(screen.queryByLabelText("Tema")).toBeNull();
    expect(screen.queryByLabelText("Todos com o mesmo modelo")).toBeNull();
    expect(screen.queryByLabelText("Teto de custo da sessão em dólares")).toBeNull();
    await waitFor(() => expect(document.querySelector("[data-resumo-recolhido]")!.textContent).toBe("Padrão · 4 rodadas · 1 modelo · teto US$ 0,52"));
    abrirAjustes();
    expect((screen.getByLabelText("Tema") as HTMLInputElement).value).toBe("Proposta da Acerbi");
    expect(screen.getByLabelText("Todos com o mesmo modelo")).toBeTruthy();
    // Um modelo por especialista fica recolhido dentro de Ajustes.
    expect(screen.queryByLabelText("Comercial")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Um modelo por especialista/ }));
    expect(screen.getByLabelText("Comercial")).toBeTruthy();
    // Rodadas só no modo padrão.
    expect(screen.getByRole("tablist", { name: "Rodadas" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Rápido" }));
    expect(screen.queryByRole("tablist", { name: "Rodadas" })).toBeNull();
  });

  it("a mesa com preset abre com ele marcado: pergunta pronta e editável, tema da mesa intacto, 3 rodadas e uma estimativa só", async () => {
    catalogoAtual = catalogo([PRESET_PROPOSTA, PRESET_CRISE]);
    montar();
    const botaoDoPreset = await screen.findByRole("button", { name: "Proposta" });
    expect(botaoDoPreset).toHaveAttribute("aria-pressed", "true");
    const pergunta = screen.getByLabelText("Pergunta") as HTMLTextAreaElement;
    expect(pergunta.value).toBe("Como montar a proposta para este cliente?");
    fireEvent.change(pergunta, { target: { value: "Como montar a proposta com o pernil?" } });
    expect(pergunta.value).toBe("Como montar a proposta com o pernil?");
    await screen.findByText("Custo estimado US$ 0,40");
    expect(estimar).toHaveBeenCalledTimes(1);
    expect(estimar.mock.calls[0][0]).toMatchObject({ rodadas: 3, modo: "padrao", especialistas: ["comercial", "estrategista_marca", "copywriter", "cetico"] });
    abrirAjustes();
    expect((screen.getByLabelText("Tema") as HTMLInputElement).value).toBe("Proposta da Acerbi");
  });

  it("com rascunho do dono na pergunta, nada é sobrescrito", async () => {
    catalogoAtual = catalogo([PRESET_PROPOSTA, PRESET_CRISE]);
    gravarEstadoDaTela("conselho:mesa-proposta:c1:pergunta", "Minha pergunta de sempre");
    montar();
    const botaoDoPreset = await screen.findByRole("button", { name: "Proposta" });
    expect(botaoDoPreset).toHaveAttribute("aria-pressed", "false");
    expect((screen.getByLabelText("Pergunta") as HTMLTextAreaElement).value).toBe("Minha pergunta de sempre");
    await waitFor(() => expect(estimar).toHaveBeenCalled());
    expect(estimar.mock.calls[0][0]).toMatchObject({ rodadas: 4 });
  });

  it("trocar do preset automático para Crise troca a pergunta (ainda sem edição)", async () => {
    catalogoAtual = catalogo([PRESET_PROPOSTA, PRESET_CRISE]);
    montar();
    await screen.findByRole("button", { name: "Proposta" });
    fireEvent.click(screen.getByRole("button", { name: "Crise" }));
    expect((screen.getByLabelText("Pergunta") as HTMLTextAreaElement).value).toBe("O que a marca deve fazer agora?");
    expect(screen.getByRole("button", { name: "Crise" })).toHaveAttribute("aria-pressed", "true");
  });

  it("o botão travado diz o porquê; teto abaixo do custo com Ajustes recolhido tem 'Ajustar', que abre o bloco no teto", async () => {
    montar({ origem: "mesa-roteiros", temaInicial: "Roteiros da Acerbi" });
    await screen.findByLabelText("Pergunta");
    await waitFor(() => expect(rodape().textContent).toBe("Escreva a pergunta · custo estimado US$ 0,40"));
    expect(screen.getByRole("button", { name: /Convocar o conselho/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Pergunta"), { target: { value: "Qual série gravar?" } });
    await waitFor(() => expect(rodape().textContent).toBe("Custo estimado US$ 0,40"));
    // Teto mexido e Ajustes recolhido de novo.
    abrirAjustes();
    fireEvent.change(screen.getByLabelText("Teto de custo da sessão em dólares"), { target: { value: "0,41" } });
    abrirAjustes();
    expect(screen.queryByLabelText("Teto de custo da sessão em dólares")).toBeNull();
    // Entra mais um: o custo passa do teto.
    fireEvent.click(screen.getByRole("button", { name: /Gestão de crise/ }));
    await waitFor(() => expect(rodape().textContent).toBe("Teto abaixo do custo estimado (US$ 0,50)"));
    expect(screen.getByRole("button", { name: /Convocar o conselho/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Ajustar" }));
    const teto = await screen.findByLabelText("Teto de custo da sessão em dólares");
    await waitFor(() => expect(document.activeElement).toBe(teto));
  });

  it("três cliques rápidos nas pílulas viram uma chamada só ao estimar", async () => {
    montar();
    await waitFor(() => expect(estimar).toHaveBeenCalledTimes(1));
    await screen.findByText(/US\$ 0,40/);
    estimar.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Gestão de crise/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cético/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copywriter/ }));
    // Enquanto recalcula, o valor anterior fica à vista, com "~".
    expect(rodape().textContent).toContain("~US$ 0,40 recalculando");
    await esperar(700);
    expect(estimar).toHaveBeenCalledTimes(1);
    expect(estimar.mock.calls[0][0].especialistas).toEqual(["comercial", "estrategista_marca", "gestao_crise"]);
  });

  it("Convocar logo depois de pôr um especialista não vai com o total antigo", async () => {
    montar();
    fireEvent.change(await screen.findByLabelText("Pergunta"), { target: { value: "Qual proposta mandar?" } });
    const botaoConvocar = screen.getByRole("button", { name: /Convocar o conselho/ });
    await waitFor(() => expect(botaoConvocar).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Gestão de crise/ }));
    expect(botaoConvocar).toBeDisabled();
    fireEvent.click(botaoConvocar);
    expect(convocar).not.toHaveBeenCalled();
    await waitFor(() => expect(rodape().textContent).toBe("Custo estimado US$ 0,50"));
    await waitFor(() => expect(botaoConvocar).not.toBeDisabled());
    fireEvent.click(botaoConvocar);
    await waitFor(() => expect(convocar).toHaveBeenCalledTimes(1));
    expect(convocar.mock.calls[0][0].especialistas).toContain("gestao_crise");
  });

  it("estimativa com erro: 'Custo indisponível' e 'Tentar de novo', com o Convocar travado", async () => {
    estimar.mockRejectedValueOnce(new Error("A função não respondeu."));
    montar();
    fireEvent.change(await screen.findByLabelText("Pergunta"), { target: { value: "Qual proposta mandar?" } });
    await waitFor(() => expect(rodape().textContent).toBe("Custo indisponível: A função não respondeu."));
    expect(screen.getByRole("button", { name: /Convocar o conselho/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(rodape().textContent).toBe("Custo estimado US$ 0,40"));
  });

  it("a lista de arquivos só é lida com a pauta aberta", async () => {
    montar();
    await screen.findByLabelText("Pergunta");
    await waitFor(() => expect(estimar).toHaveBeenCalled());
    expect(supabase.from).not.toHaveBeenCalledWith("files");
    fireEvent.click(screen.getByRole("button", { name: /Pauta e anexos/ }));
    await screen.findByLabelText(/briefing-site\.pdf/);
    expect(supabase.from).toHaveBeenCalledWith("files");
  });

  it("sessão em debate aparece em cima, com Abrir; as sessões ficam antes do formulário", async () => {
    const base = { id: "s1", client_id: "c1", tema: "Proposta de outubro", status: "rodando", criado_em: "2026-09-30T13:00:00.000Z", custo_usd: 0.1, resultado: null, decisao: null } as unknown as SessaoDoConselho;
    sessoesDoCliente = [base, { ...base, id: "s2", tema: "Outra", status: "fila" }, { ...base, id: "s3", status: "concluida" }];
    const { abrir } = montar();
    const linha = await screen.findByText(/Proposta de outubro/, { selector: "p" });
    expect(linha.textContent).toBe("Em debate: Proposta de outubro +1");
    fireEvent.click(within(document.querySelector("[data-em-debate]") as HTMLElement).getByRole("button", { name: "Abrir" }));
    expect(abrir).toHaveBeenCalledWith("s1");
    const sessoes = screen.getByRole("button", { name: "Sessões" });
    const convocarTitulo = screen.getByRole("heading", { name: "Convocar" });
    expect(sessoes.compareDocumentPosition(convocarTitulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Recolhida de início, com a contagem.
    expect(document.querySelector("[data-sessao-anterior]")).toBeNull();
  });

  it("Convocar de novo (sessão no teto): volta tudo preenchido, teto acima do gasto e nada é convocado sozinho", async () => {
    const base = {
      id: "s7", client_id: "c1", origem: "mesa-proposta", tema: "Proposta antiga", pergunta: "Qual escopo?", contexto: "Contexto antigo", criterios: ["viável"],
      especialistas: [{ id: "comercial", nome: "Comercial", modelo_id: "m2" }, { id: "cetico", nome: "Cético", modelo_id: "m2" }, { id: "fora", nome: "Fora", modelo_id: "m1" }],
      rodadas: 3, rodadas_extras: 0, status: "teto", custo_usd: 0.4, teto_usd: 0.4, modo: "padrao", pauta: { itens: ["Preço"], anexos: [{ file_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nome: "x" }] }, referencia: null,
    } as unknown as SessaoDoConselho;
    gravarEstadoDaTela("conselho:mesa-proposta:c1:pergunta", "Rascunho velho");
    montar({ base });
    expect((await screen.findByLabelText("Pergunta") as HTMLTextAreaElement).value).toBe("Qual escopo?");
    expect(screen.getByRole("button", { name: /Comercial/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Cético/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Copywriter/ })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(estimar).toHaveBeenCalled());
    expect(estimar.mock.calls[0][0]).toMatchObject({ especialistas: ["comercial", "cetico"], modelos: { comercial: "m2", cetico: "m2" }, rodadas: 3 });
    abrirAjustes();
    expect((screen.getByLabelText("Tema") as HTMLInputElement).value).toBe("Proposta antiga");
    expect((screen.getByLabelText("Contexto da mesa") as HTMLTextAreaElement).value).toBe("Contexto antigo");
    // Teto: o maior entre o sugerido (0,26) e 1,5 vez o que a sessão gastou (0,60).
    await waitFor(() => expect((screen.getByLabelText("Teto de custo da sessão em dólares") as HTMLInputElement).value).toBe("0.6"));
    // A pauta volta junto (recolhida, com a contagem).
    expect(screen.getByText("1 item · 1 anexo")).toBeTruthy();
    expect(convocar).not.toHaveBeenCalled();
  });
});
