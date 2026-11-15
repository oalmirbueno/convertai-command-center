import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { PecaFato } from "@/lib/esteiraLinha/esteiraLinha";
import { LINHAS_DO_DONO_VAZIAS, type LinhasDoDono } from "@/lib/esteiraLinha/precisaDeVoce";

/**
 * A tela da Esteira em linha do tempo com dados simulados (sem rede): faixas
 * por cliente ativo, cartões no dia certo, destaque e alerta do dia
 * prioritário, link do cartão e troca de semana.
 */

// Quarta-feira, 18/11/2026, meio-dia em São Paulo. Semana de 16 a 22/11.
const QUARTA = new Date("2026-11-18T15:00:00Z");

const CLIENTES = [
  { id: "c1", company_name: "Alfa Comércio", plan_status: "active", deleted_at: null },
  { id: "c2", company_name: null, full_name: "Beta Loja", plan_status: "active", deleted_at: null },
  { id: "c3", company_name: "Pausado Ltda", plan_status: "paused", deleted_at: null },
  { id: "c4", company_name: "Apagado Ltda", plan_status: "active", deleted_at: "2026-10-01T00:00:00Z" },
  // Na lista temporária de pausa operacional (RD AR): plano active, mas sem dia prioritário na Esteira.
  { id: "52f2efb6-9928-4074-b8e2-bc972baf1f6a", company_name: "Rd Ar Climatização", plan_status: "active", deleted_at: null },
];

const DIAS = [
  { client_id: "c1", dia: 2, situacao: "confirmado" },
  { client_id: "c2", dia: 4, situacao: "confirmado" },
  { client_id: "52f2efb6-9928-4074-b8e2-bc972baf1f6a", dia: 2, situacao: "confirmado" },
];

const peca = (extra: Partial<PecaFato>): PecaFato => ({
  chave: "post:p1",
  clientId: "c1",
  titulo: "Peça",
  contentType: "static",
  post: null,
  publicacoes: [],
  tarefa: null,
  trabalho: null,
  arquivos: [],
  ...extra,
});

const PECAS: PecaFato[] = [
  peca({
    chave: "post:p1", titulo: "Promoção de sexta", contentType: "carousel",
    post: { id: "p1", production_status: "ready", archived_at: null, temArquivo: true },
    // 01:30 UTC de quarta ainda é terça em São Paulo: cai no dia prioritário da Alfa.
    publicacoes: [{ status: "scheduled", scheduled_at: "2026-11-18T01:30:00Z", published_at: null }],
  }),
  peca({
    chave: "task:t9", clientId: "c2", titulo: "Reel do bastidor", contentType: "reel",
    tarefa: { id: "t9", status: "todo", due_date: "2026-11-20" },
    trabalho: { status: "gerando", entrega_status: null, temArquivo: false },
  }),
];

const leituras: Array<{ ids: string[]; segunda: string }> = [];
// O que muda de um teste para outro: o papel de quem está logado e o que a caixa do dono lê.
const sessao = vi.hoisted(() => ({ papel: "admin", doDono: null as unknown, fontesComErro: [] as string[], pecasExtras: [] as unknown[] }));

vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: CLIENTES, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { role: sessao.papel } }) }));
vi.mock("@/lib/diaPrioritarioApi", () => ({ useDiasPrioritarios: () => ({ data: DIAS, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/lib/esteiraLinha/esteiraLinhaFatos", () => ({
  lerPecasDaEsteiraLinha: async (ids: string[], segunda: string) => {
    leituras.push({ ids, segunda });
    return segunda === "2026-11-16" ? [...PECAS, ...(sessao.pecasExtras as PecaFato[])] : [];
  },
  // A regra do cadastro: só a Beta dispensa a aprovação do cliente (o papel da Softy neste teste).
  lerModosDeAprovacao: async () => ({ c2: "dispensada" }),
}));
vi.mock("@/lib/esteiraLinha/precisaDeVoceFatos", () => ({
  lerLinhasDoDono: async () => ({ linhas: sessao.doDono, fontesComErro: sessao.fontesComErro }),
}));

// Logo: uma leitura em lote para a grade toda; aqui sem rede, então cai nas iniciais.
vi.mock("@/components/admin/LogoDoCliente", async (orig) => ({ ...(await orig<any>()), useIdentidadesDosClientes: () => ({ data: new Map() }) }));
vi.mock("@/hooks/useFotosDosClientes", () => ({ useFotosDosClientes: () => ({ fotosDe: () => null }) }));

import EsteiraLinhaDoTempo from "@/pages/EsteiraLinhaDoTempo";

function montar(agora: Date = QUARTA) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <EsteiraLinhaDoTempo agora={agora} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const DO_DONO: LinhasDoDono = {
  ...LINHAS_DO_DONO_VAZIAS,
  aprovacoes: [
    { id: "a1", status: "pendente", action_kind: "gastar", o_que: "Recarregar a conta de anúncios", por_que: "O saldo acaba amanhã.", custo_previsto: 150, client_id: "c1", task_link_id: null, created_at: "2026-11-17T12:00:00Z" },
    { id: "a2", status: "pendente", action_kind: "mudar_estrategia", o_que: "Trocar o foco da campanha", por_que: "O público esgotou.", custo_previsto: null, client_id: "c2", task_link_id: null, created_at: "2026-11-17T11:00:00Z" },
  ],
  trabalhos: [{
    id: "w1", client_id: "c1", task_id: "t1", post_id: "p7", entrega_status: "reprovado", file_ids: ["f9"], titulo: "Carrossel de sexta",
    ajustes_do_cliente: [{ evento_id: "e1", file_id: "f1", decisao: "ajuste", texto: "Mudar a cor", pedido_em: "2026-11-10T10:00:00Z" }, { evento_id: "e2", file_id: "f2", decisao: "ajuste", texto: "Mudar a foto", pedido_em: "2026-11-12T10:00:00Z" }],
  }],
};

beforeEach(() => {
  window.localStorage.clear();
  sessao.papel = "admin";
  sessao.doDono = LINHAS_DO_DONO_VAZIAS;
  sessao.fontesComErro = [];
  sessao.pecasExtras = [];
});

const celula = (tela: HTMLElement, cliente: string, dia: string) =>
  tela.querySelector(`[data-faixa-da-esteira="${cliente}"] [data-dia="${dia}"]`) as HTMLElement;

describe("tela da Esteira em linha do tempo", () => {
  it("mostra os dias, uma faixa por cliente ativo, os cartões, o destaque, o alerta e o link", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");

    expect(screen.getByRole("heading", { name: "Esteira" })).toBeTruthy();
    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual(["Cliente", "Seg 16", "Ter 17", "Qua 18Hoje", "Qui 19", "Sex 20", "Sáb 21", "Dom 22"]);

    // Só os ativos, e a leitura das peças é uma só para a carteira inteira.
    expect(screen.getAllByRole("rowheader").map((th) => th.textContent)).toEqual([
      // As iniciais são a logo sem foto (fallback honesto do LogoDoCliente).
      "ACAlfa ComércioDia prioritário: terça-feira",
      "BLBeta LojaDia prioritário: quinta-feiraAprovação do cliente dispensada",
      "RARd Ar Climatização",
    ]);
    expect(leituras).toEqual([{ ids: ["52f2efb6-9928-4074-b8e2-bc972baf1f6a", "c1", "c2"], segunda: "2026-11-16" }]);
    // RD AR (pausa operacional): a faixa fica, a terça não destaca nem alerta.
    const tercaDaRdAr = celula(container, "52f2efb6-9928-4074-b8e2-bc972baf1f6a", "2026-11-17");
    expect(tercaDaRdAr.getAttribute("data-prioritario")).toBeNull();
    expect(tercaDaRdAr.getAttribute("data-alerta")).toBeNull();

    // Alfa: a peça caiu na terça (dia prioritário), com destaque e sem alerta.
    const tercaDaAlfa = celula(container, "c1", "2026-11-17");
    expect(tercaDaAlfa.getAttribute("data-prioritario")).toBe("sim");
    expect(tercaDaAlfa.getAttribute("data-alerta")).toBeNull();
    const cartao = within(tercaDaAlfa).getByRole("link");
    expect(cartao.getAttribute("href")).toBe("/calendario?client=c1&content=p1");
    expect(cartao.textContent).toContain("Carrossel");
    expect(cartao.textContent).toContain("Agendado");
    expect(cartao.getAttribute("aria-label")).toContain("Abrir na Agenda");

    // Beta: a peça está na sexta e leva ao Estúdio; a quinta (dia prioritário) está vazia.
    const quintaDaBeta = celula(container, "c2", "2026-11-19");
    expect(quintaDaBeta.getAttribute("data-alerta")).toBe("sim");
    expect(quintaDaBeta.textContent).toBe("Dia prioritário sem peça");
    const doEstudio = within(celula(container, "c2", "2026-11-20")).getByRole("link");
    expect(doEstudio.getAttribute("href")).toBe("/mesa?client=c2&aba=estudio&task=t9");
    expect(doEstudio.textContent).toContain("Arte");
    expect(container.querySelectorAll('[data-alerta="sim"]')).toHaveLength(1);

    // Legenda no rodapé, e nenhuma ação além de navegar e atualizar.
    const legenda = screen.getByRole("contentinfo", { name: "Legenda das etapas" });
    for (const etapa of ["Pauta", "Arte", "Revisão", "Aprovação", "Agendado", "No ar"]) expect(within(legenda).getByText(etapa)).toBeTruthy();
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent)).toEqual(
      expect.arrayContaining(["Semana anterior", "Semana atual", "Próxima semana", "Atualizar"]),
    );
  });

  it("troca de semana e volta para a atual", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    expect((screen.getByRole("button", { name: "Semana atual" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Próxima semana" }));
    await waitFor(() => expect(screen.getAllByRole("columnheader")[1].textContent).toBe("Seg 23"));
    await waitFor(() => expect(screen.queryByText("Promoção de sexta")).toBeNull());
    // Semana sem peça: as faixas continuam e os dois dias prioritários alertam.
    await waitFor(() => expect(container.querySelectorAll('[data-alerta="sim"]')).toHaveLength(2));
    expect(screen.getAllByRole("rowheader")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Semana atual" }));
    await screen.findByText("Promoção de sexta");
    fireEvent.click(screen.getByRole("button", { name: "Semana anterior" }));
    await waitFor(() => expect(screen.getAllByRole("columnheader")[1].textContent).toBe("Seg 9"));
  });

  it("Precisa de você: no topo, só o que depende do dono, com o link de onde se resolve", async () => {
    sessao.doDono = DO_DONO;
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const caixa = await screen.findByRole("region", { name: /Precisa de você/ });
    // A caixa vem antes da grade.
    expect(caixa.compareDocumentPosition(container.querySelector("[data-grade-da-esteira]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const itens = Array.from(caixa.querySelectorAll("[data-pedido-do-dono]"));
    expect(itens.map((li) => `${li.getAttribute("data-tipo")}:${li.getAttribute("data-pedido-do-dono")}`)).toEqual([
      "dinheiro:aprovacao:a1", "rejeicao_repetida:rejeicao:trabalho:w1", "decisao_de_agente:aprovacao:a2",
    ]);
    const dinheiro = within(itens[0] as HTMLElement);
    expect(dinheiro.getByText("Dinheiro e verba")).toBeTruthy();
    expect(dinheiro.getByText("Alfa Comércio")).toBeTruthy();
    expect(dinheiro.getByText("Recarregar a conta de anúncios")).toBeTruthy();
    expect(dinheiro.getByText(/O saldo acaba amanhã\. Custo previsto: R\$\s?150,00\./)).toBeTruthy();
    expect(dinheiro.getByRole("link").getAttribute("href")).toBe("/execucao?aprovacao=a1");
    expect(within(itens[1] as HTMLElement).getByRole("link").getAttribute("href")).toBe("/calendario?client=c1&content=p7");
    expect(within(itens[2] as HTMLElement).getByRole("link").getAttribute("href")).toBe("/execucao?aprovacao=a2");
    // A caixa só aponta o caminho: nenhum botão de aprovar ou recusar.
    expect(within(caixa).queryAllByRole("button")).toEqual([]);
    expect(caixa.textContent).not.toMatch(/Aprovar|Recusar|Rejeitar/);
  });

  it("sem pedido a caixa vira uma linha discreta; com fonte fora do ar, avisa que a lista pode estar incompleta", async () => {
    const primeira = montar();
    await screen.findByText("Promoção de sexta");
    expect((await screen.findByText("Nada esperando você.")).getAttribute("data-precisa-de-voce")).toBe("vazia");
    expect(screen.queryByRole("region", { name: /Precisa de você/ })).toBeNull();
    primeira.unmount();

    sessao.fontesComErro = ["aprovacoes"];
    montar();
    expect(await screen.findByText("Precisa de você: parte da lista não pôde ser lida agora.")).toBeTruthy();
  });

  it("a regra do cadastro aparece na faixa do cliente e não muda a etapa das peças", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const avisos = container.querySelectorAll("[data-aprovacao-dispensada]");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].closest("[data-faixa-da-esteira]")?.getAttribute("data-faixa-da-esteira")).toBe("c2");
    expect(avisos[0].getAttribute("title")).toContain("revisão interna da agência basta");
    expect(within(celula(container, "c2", "2026-11-20")).getByRole("link").textContent).toContain("Arte");
  });

  it("tráfego não é mandado para o Estúdio: o cartão abre a Agenda do cliente e diz isso", async () => {
    sessao.papel = "traffic";
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const cartao = within(celula(container, "c2", "2026-11-20")).getByRole("link");
    expect(cartao.getAttribute("href")).toBe("/calendario?client=c2");
    expect(cartao.getAttribute("aria-label")).toContain("Abrir na Agenda");
    expect(cartao.getAttribute("title")).toContain("Abrir na Agenda");
    expect(cartao.getAttribute("title")).not.toContain("Estúdio");
  });
});

/*
 * Organização (pedido do Almir, 14/11/2026, 21h08): seletor de clientes no
 * topo, faixa por cliente, "+N" na célula cheia e nada de rolagem por dentro.
 */
const QUINTA = new Date("2026-11-19T15:00:00Z");
const DOMINGO = new Date("2026-11-22T15:00:00Z");
const CHAVE = "aceleriq:esteira:filtro-clientes";
const faixasNaTela = (tela: HTMLElement) => Array.from(tela.querySelectorAll("[data-faixa-da-esteira]")).map((f) => f.getAttribute("data-faixa-da-esteira"));
const chip = (nome: string | RegExp) => screen.getByRole("button", { name: nome });
const RDAR = "52f2efb6-9928-4074-b8e2-bc972baf1f6a";

describe("Esteira organizada: seletor de clientes, faixas e +N", () => {
  it("o seletor aparece entre a caixa Precisa de você e a grade, com Todos ligado", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const seletor = screen.getByRole("region", { name: "Clientes da Esteira" });
    const caixa = container.querySelector("[data-precisa-de-voce]")!;
    const grade = container.querySelector("[data-grade-da-esteira]")!;
    expect(caixa.compareDocumentPosition(seletor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(seletor.compareDocumentPosition(grade) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(seletor).getByRole("group", { name: "Clientes da Esteira" })).toBeTruthy();
    expect(chip("Todos").getAttribute("aria-pressed")).toBe("true");
    expect(chip(/Só prioritários hoje/).getAttribute("aria-pressed")).toBe("false");
    expect(within(seletor).getByRole("searchbox", { name: "Buscar cliente na Esteira" })).toBeTruthy();
    expect(faixasNaTela(container)).toEqual(["c1", "c2", RDAR]);
  });

  it("escolher um cliente esconde as outras faixas; o segundo soma; tirar todos volta para Todos", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    fireEvent.click(chip("Beta Loja"));
    expect(faixasNaTela(container)).toEqual(["c2"]);
    expect(chip("Beta Loja").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Todos").getAttribute("aria-pressed")).toBe("false");
    expect(within(container.querySelector('[data-faixa-da-esteira="c2"]') as HTMLElement).getByText("Beta Loja")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(CHAVE)!)).toEqual({ v: 1, modo: "clientes", ids: ["c2"] });

    // A ordem continua a alfabética, não a do clique.
    fireEvent.click(chip("Alfa Comércio"));
    expect(faixasNaTela(container)).toEqual(["c1", "c2"]);

    fireEvent.click(chip("Alfa Comércio"));
    fireEvent.click(chip("Beta Loja"));
    expect(faixasNaTela(container)).toEqual(["c1", "c2", RDAR]);
    expect(chip("Todos").getAttribute("aria-pressed")).toBe("true");
    // A legenda continua no rodapé.
    expect(screen.getByRole("contentinfo", { name: "Legenda das etapas" })).toBeTruthy();
  });

  it("Todos limpa a seleção individual", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    fireEvent.click(chip("Beta Loja"));
    fireEvent.click(chip("Todos"));
    expect(faixasNaTela(container)).toHaveLength(3);
    expect(chip("Beta Loja").getAttribute("aria-pressed")).toBe("false");
    expect(JSON.parse(window.localStorage.getItem(CHAVE)!)).toEqual({ v: 1, modo: "todos", ids: [] });
  });

  it("a busca filtra os chips pelo nome, sem ligar para acento", async () => {
    montar();
    await screen.findByText("Promoção de sexta");
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar cliente na Esteira" }), { target: { value: "comercio" } });
    expect(screen.queryByRole("button", { name: "Beta Loja" })).toBeNull();
    expect(chip("Alfa Comércio")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar cliente na Esteira" }), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhum cliente com esse nome.")).toBeTruthy();
  });

  it("Só prioritários hoje: na quinta, só a Beta", async () => {
    const { container } = montar(QUINTA);
    await screen.findByText("Promoção de sexta");
    fireEvent.click(chip(/Só prioritários hoje/));
    expect(faixasNaTela(container)).toEqual(["c2"]);
    expect(chip(/Só prioritários hoje/).getAttribute("aria-pressed")).toBe("true");
  });

  it("Só prioritários hoje no domingo: estado vazio claro e um toque volta para Todos", async () => {
    const { container } = montar(DOMINGO);
    await screen.findByText("Promoção de sexta");
    fireEvent.click(chip(/Só prioritários hoje/));
    expect(container.querySelector("[data-grade-da-esteira]")).toBeNull();
    expect(screen.getByText("Nenhum cliente tem dia prioritário hoje")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver todos os clientes" }));
    expect(faixasNaTela(container)).toHaveLength(3);
  });

  it("restaura a seleção guardada, ignora id que saiu da carteira e cai em Todos com JSON quebrado", async () => {
    window.localStorage.setItem(CHAVE, JSON.stringify({ v: 1, modo: "clientes", ids: ["sumiu", "c2"] }));
    const primeira = montar();
    await screen.findByText("Reel do bastidor");
    expect(faixasNaTela(primeira.container)).toEqual(["c2"]);
    primeira.unmount();

    window.localStorage.setItem(CHAVE, "{isso não é json");
    const segunda = montar();
    await screen.findByText("Promoção de sexta");
    expect(faixasNaTela(segunda.container)).toHaveLength(3);
    expect(chip("Todos").getAttribute("aria-pressed")).toBe("true");
  });

  it("célula com 5 peças mostra 3 e +2; expande e recolhe; célula com até 3 não tem o controle", async () => {
    sessao.pecasExtras = ["A", "B", "C", "D", "E"].map((l, i) => peca({
      chave: `task:x${i}`, clientId: "c1", titulo: `Peça ${l}`,
      tarefa: { id: `x${i}`, status: "todo", due_date: "2026-11-19" },
    }));
    const { container } = montar();
    await screen.findByText("Peça A");
    const quinta = celula(container, "c1", "2026-11-19");
    expect(within(quinta).getAllByRole("link").map((a) => a.textContent?.slice(0, 6))).toEqual(["Peça A", "Peça B", "Peça C"]);
    const mais = within(quinta).getByRole("button", { name: "Mostrar mais 2 peças" });
    expect(mais.textContent).toBe("+2");
    expect(mais.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(mais);
    expect(within(quinta).getAllByRole("link")).toHaveLength(5);
    const menos = within(quinta).getByRole("button", { name: "Mostrar menos" });
    expect(menos.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(menos);
    expect(within(quinta).getAllByRole("link")).toHaveLength(3);

    // A terça da Alfa tem 1 peça: nada de +N.
    expect(within(celula(container, "c1", "2026-11-17")).queryByRole("button")).toBeNull();
  });

  it("nenhuma célula nem faixa tem rolagem vertical própria; o cabeçalho dos dias gruda e o canto fica por cima", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const presos = container.querySelectorAll("[data-grade-da-esteira] *");
    for (const el of Array.from(presos)) {
      const c = el.getAttribute("class") ?? "";
      expect(c).not.toMatch(/overflow-y-|max-h-|overflow-auto|overflow-scroll/);
    }
    const rolagem = container.querySelector("[data-rolagem-das-datas]")!;
    expect(rolagem.className).toContain("overflow-x-auto");
    const topo = container.querySelector("[data-cabecalho-dos-dias]")!;
    expect(topo.className).toMatch(/\bsticky\b/);
    expect(topo.className).toContain("-top-4");
    expect(topo.className).toContain("md:top-[calc(env(safe-area-inset-top)+80px)]");
    expect(topo.className).toContain("z-30");
    expect(topo.getAttribute("aria-hidden")).toBe("true");
    const canto = container.querySelector("[data-canto-cliente]")!;
    expect(canto.className).toMatch(/sticky left-0 z-20/);
    // Coluna do cliente presa à esquerda, abaixo do canto.
    for (const th of Array.from(container.querySelectorAll("[data-cabecalho-da-faixa]"))) expect(th.className).toMatch(/sticky left-0 z-10/);
  });
});

describe("Esteira organizada no celular e no desktop", () => {
  const larguraOriginal = window.innerWidth;
  const largura = (px: number) => Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: px });
  afterEach(() => largura(larguraOriginal));

  it.each([375, 1280])("em %ipx: seletor, grade, legenda e só a grade rola na horizontal", async (px) => {
    largura(px);
    window.dispatchEvent(new Event("resize"));
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const pagina = container.querySelector("[data-esteira-linha]")!;
    // A página não ganha largura mínima: só a tabela da grade tem.
    expect(pagina.className).not.toMatch(/min-w-\[/);
    expect(pagina.className).toContain("min-w-0");
    const chips = container.querySelector("[data-chips-de-clientes]")!;
    // Celular: os chips rolam na horizontal numa linha; de 640 px para cima, quebram linha.
    expect(chips.className).toMatch(/flex-nowrap/);
    expect(chips.className).toMatch(/overflow-x-auto/);
    expect(chips.className).toMatch(/sm:flex-wrap/);
    for (const b of within(chips as HTMLElement).getAllByRole("button")) expect(b.className).toMatch(/\bh-8\b/);
    const tabelas = container.querySelectorAll("[data-grade-da-esteira] table");
    expect(tabelas).toHaveLength(2);
    for (const t of Array.from(tabelas)) expect(t.className).toMatch(/min-w-\[860px\].*sm:min-w-\[1040px\]/);
    expect(container.querySelector("[data-rolagem-das-datas]")!.className).toContain("overflow-x-auto");
    expect(screen.getByRole("contentinfo", { name: "Legenda das etapas" })).toBeTruthy();
    expect(screen.getAllByRole("rowheader")).toHaveLength(3);
  });
});
