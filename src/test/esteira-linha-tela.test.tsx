import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { PecaFato } from "@/lib/esteiraLinha/esteiraLinha";
import { LINHAS_DO_DONO_VAZIAS, type LinhasDoDono } from "@/lib/esteiraLinha/precisaDeVoce";

/**
 * A tela da Esteira em linha do tempo com dados simulados (sem rede): faixas
 * por cliente ativo, cartões no dia certo, destaque e alerta do dia
 * prioritário, troca de semana e de período, avisos recolhidos, o painel da
 * peça aberto na própria tela e a rolagem por coluna (pedidos do Almir de
 * 14/11/2026, 21h53 a 21h55).
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

const leituras: Array<{ ids: string[]; segunda: string; dias: number }> = [];
// O que muda de um teste para outro: o papel de quem está logado e o que a caixa do dono lê.
const sessao = vi.hoisted(() => ({ papel: "admin", doDono: null as unknown, fontesComErro: [] as string[], pecasExtras: [] as unknown[], detalhes: [] as Array<{ postId: string | null; clientId: string | null }>, tarefasPedidas: [] as unknown[] }));

vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: CLIENTES, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
  useProjects: () => ({ data: [{ id: "pr1", name: "Conteúdo mensal" }] }),
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { role: sessao.papel } }) }));
vi.mock("@/lib/diaPrioritarioApi", () => ({ useDiasPrioritarios: () => ({ data: DIAS, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/lib/esteiraLinha/esteiraLinhaFatos", () => ({
  lerPecasDaEsteiraLinha: async (ids: string[], segunda: string, dias: number) => {
    leituras.push({ ids, segunda, dias });
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

// O painel da peça reaproveita a ficha da Agenda e a janela da tarefa: aqui, versões
// simples que mostram o que receberam (as de verdade têm testes próprios).
interface PropsDaFicha {
  post: { post: { id: string } } | null;
  mesaHref?: string | null;
  clientName: string;
  projectName: string;
  canEdit: boolean;
  onOpenChange: (aberto: boolean) => void;
  onEdit: (post: unknown) => void;
  onArchived: () => void;
}
interface PropsDaJanela { task: { id: string }; onClose: () => void; readOnly?: boolean }
vi.mock("@/hooks/useEditorialCalendar", () => ({
  useEditorialPostDetail: (postId: string | null, clientId: string | null) => {
    sessao.detalhes.push({ postId, clientId });
    return {
      isSuccess: true, isError: false,
      data: { posts: [{ post: { id: postId, client_id: clientId, project_id: "pr1" }, internal: { task_id: "t1", responsible_id: null }, publications: [] }] },
    };
  },
}));
vi.mock("@/components/editorial/EditorialDetailSheet", () => ({
  default: (props: PropsDaFicha) => (
    <div role="dialog" aria-label="Ficha da peça" data-ficha-da-agenda={props.post?.post.id} data-mesa={props.mesaHref ?? ""} data-cliente={props.clientName} data-projeto={props.projectName} data-pode-editar={String(props.canEdit)}>
      <button type="button" onClick={() => props.onOpenChange(false)}>Fechar ficha</button>
      <button type="button" onClick={() => props.onEdit(props.post)}>Editar</button>
      <button type="button" onClick={() => props.onArchived()}>Arquivar</button>
    </div>
  ),
}));
vi.mock("@/components/execucao/TarefaDaExecucao", () => ({
  default: ({ tarefa, desenhar }: { tarefa: { id: string; title?: unknown }; desenhar: (t: Record<string, unknown>) => ReactNode }) => {
    sessao.tarefasPedidas.push(tarefa);
    return <>{desenhar({ id: tarefa.id, title: "Reel do bastidor (lido inteiro)" })}</>;
  },
}));
vi.mock("@/components/admin/TaskDetailDrawer", () => ({
  default: ({ task, onClose, readOnly }: PropsDaJanela) => (
    <div role="dialog" aria-label="Janela da tarefa" data-janela-da-tarefa={task.id} data-somente-leitura={String(readOnly)}>
      <button type="button" onClick={onClose}>Fechar janela</button>
    </div>
  ),
}));

import EsteiraLinhaDoTempo from "@/pages/EsteiraLinhaDoTempo";

/** Onde a tela está: o clique no cartão não pode mudar isto. */
function Endereco() {
  const local = useLocation();
  return <output data-endereco="">{`${local.pathname}${local.search}`}</output>;
}

function montar(agora: Date = QUARTA) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/esteira"]}>
      <QueryClientProvider client={qc}>
        <Endereco />
        <EsteiraLinhaDoTempo agora={agora} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const endereco = () => document.querySelector("[data-endereco]")!.textContent;

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

beforeAll(() => {
  // Popover e menu (Radix) medem o tamanho com ResizeObserver, que o jsdom não tem.
  const global = globalThis as { ResizeObserver?: unknown };
  if (!global.ResizeObserver) global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

beforeEach(() => {
  window.localStorage.clear();
  leituras.length = 0;
  sessao.papel = "admin";
  sessao.doDono = LINHAS_DO_DONO_VAZIAS;
  sessao.fontesComErro = [];
  sessao.pecasExtras = [];
  sessao.detalhes = [];
  sessao.tarefasPedidas = [];
});

const celula = (tela: HTMLElement, cliente: string, dia: string) =>
  tela.querySelector(`[data-faixa-da-esteira="${cliente}"] [data-dia="${dia}"]`) as HTMLElement;
/** O botão do cartão (o clique que abre o painel). */
const cartaoEm = (tela: HTMLElement, cliente: string, dia: string) => within(celula(tela, cliente, dia)).getByRole("button", { name: /Ver detalhes$/ });
/** Abre o menu "…" de um cartão (o Radix abre no pointerdown e no Enter). */
async function abrirMenuDoCartao(tela: HTMLElement, cliente: string, dia: string) {
  const botao = within(celula(tela, cliente, dia)).getByRole("button", { name: /^Mais ações:/ });
  fireEvent.pointerDown(botao, { button: 0, ctrlKey: false });
  fireEvent.keyDown(botao, { key: "Enter" });
  return screen.findByRole("menu");
}

describe("tela da Esteira em linha do tempo", () => {
  it("mostra os dias, uma faixa por cliente ativo, os cartões limpos, o destaque e o alerta", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");

    expect(screen.getByRole("heading", { name: "Esteira" })).toBeTruthy();
    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual(["Cliente", "Seg 16", "Ter 17", "Qua 18Hoje", "Qui 19", "Sex 20", "Sáb 21", "Dom 22"]);

    // Só os ativos, e a leitura das peças é uma só para a carteira inteira, de uma semana.
    expect(screen.getAllByRole("rowheader").map((th) => th.textContent)).toEqual([
      // As iniciais são a logo sem foto (fallback honesto do LogoDoCliente).
      "ACAlfa ComércioDia prioritário: terça-feira",
      "BLBeta LojaDia prioritário: quinta-feiraAprovação do cliente dispensada",
      "RARd Ar Climatização",
    ]);
    expect(leituras).toEqual([{ ids: ["52f2efb6-9928-4074-b8e2-bc972baf1f6a", "c1", "c2"], segunda: "2026-11-16", dias: 7 }]);
    // RD AR (pausa operacional): a faixa fica, a terça não destaca nem alerta.
    const tercaDaRdAr = celula(container, "52f2efb6-9928-4074-b8e2-bc972baf1f6a", "2026-11-17");
    expect(tercaDaRdAr.getAttribute("data-prioritario")).toBeNull();
    expect(tercaDaRdAr.getAttribute("data-alerta")).toBeNull();

    // Alfa: a peça caiu na terça (dia prioritário), com destaque e sem alerta.
    const tercaDaAlfa = celula(container, "c1", "2026-11-17");
    expect(tercaDaAlfa.getAttribute("data-prioritario")).toBe("sim");
    expect(tercaDaAlfa.getAttribute("data-alerta")).toBeNull();
    // O cartão é um botão (não um link) e mostra só o título e a etapa: o formato sai da vista.
    expect(within(tercaDaAlfa).queryByRole("link")).toBeNull();
    const cartao = cartaoEm(container, "c1", "2026-11-17");
    expect(cartao.tagName).toBe("BUTTON");
    expect(cartao.textContent).toBe("Promoção de sextaAgendado");
    expect(cartao.getAttribute("aria-label")).toBe("Promoção de sexta. Carrossel. Agendado. Ver detalhes");
    expect(cartao.getAttribute("title")).toContain("Carrossel");
    // Um só selo de etapa: a cor é o ponto, sem fundo colorido empilhado.
    expect(cartao.querySelectorAll(".rounded-full")).toHaveLength(1);

    // Beta: a peça está na sexta; a quinta (dia prioritário) está vazia.
    const quintaDaBeta = celula(container, "c2", "2026-11-19");
    expect(quintaDaBeta.getAttribute("data-alerta")).toBe("sim");
    expect(quintaDaBeta.textContent).toBe("Dia prioritário sem peça");
    expect(cartaoEm(container, "c2", "2026-11-20").textContent).toContain("Arte");
    expect(container.querySelectorAll('[data-alerta="sim"]')).toHaveLength(1);

    // Sem rodapé de legenda: ela mora no "?" ao lado do título.
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.queryByRole("list", { name: "Legenda das etapas" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "O que é isto?" }));
    const legenda = await screen.findByRole("list", { name: "Legenda das etapas" });
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

  it("Precisa de você nasce recolhida, só com o contador, e abre no clique com o link de onde se resolve", async () => {
    sessao.doDono = DO_DONO;
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const caixa = await screen.findByRole("region", { name: /Precisa de você/ });
    // A caixa vem antes da grade e começa recolhida: só o contador, nenhum item.
    expect(caixa.compareDocumentPosition(container.querySelector("[data-grade-da-esteira]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(caixa.getAttribute("data-aviso-recolhido")).toBe("sim");
    const alternar = within(caixa).getByRole("button", { name: /3 itens precisam de você/ });
    expect(alternar.getAttribute("aria-expanded")).toBe("false");
    expect(caixa.querySelectorAll("[data-pedido-do-dono]")).toHaveLength(0);

    fireEvent.click(alternar);
    expect(alternar.getAttribute("aria-expanded")).toBe("true");
    expect(caixa.getAttribute("data-aviso-recolhido")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("aceleriq:esteira:avisos")!)).toEqual({ v: 1, precisaDeVoce: true });
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
    // A lista rola por dentro, com teto; a caixa só aponta o caminho: nenhum botão de aprovar ou recusar.
    const lista = caixa.querySelector("[data-rolagem-do-aviso]")!;
    expect(lista.className).toMatch(/\bmax-h-\[/);
    expect(lista.className).toContain("overflow-y-auto");
    expect(within(lista as HTMLElement).queryAllByRole("button")).toEqual([]);
    expect(caixa.textContent).not.toMatch(/Aprovar|Recusar|Rejeitar/);
  });

  it("o estado aberto da caixa fica lembrado no aparelho, e fechar volta ao padrão recolhido", async () => {
    sessao.doDono = DO_DONO;
    window.localStorage.setItem("aceleriq:esteira:avisos", JSON.stringify({ v: 1, precisaDeVoce: true }));
    const primeira = montar();
    const caixa = await screen.findByRole("region", { name: /Precisa de você/ });
    expect(caixa.getAttribute("data-aviso-recolhido")).toBeNull();
    expect(caixa.querySelectorAll("[data-pedido-do-dono]")).toHaveLength(3);
    fireEvent.click(within(caixa).getByRole("button", { name: /3 itens precisam de você/ }));
    expect(JSON.parse(window.localStorage.getItem("aceleriq:esteira:avisos")!)).toEqual({ v: 1, precisaDeVoce: false });
    primeira.unmount();

    window.localStorage.setItem("aceleriq:esteira:avisos", "{quebrado");
    montar();
    expect((await screen.findByRole("region", { name: /Precisa de você/ })).getAttribute("data-aviso-recolhido")).toBe("sim");
  });

  it("sem pedido a caixa não ocupa espaço; com fonte fora do ar, sobra só uma linha discreta", async () => {
    const primeira = montar();
    await screen.findByText("Promoção de sexta");
    expect(screen.queryByText("Nada esperando você.")).toBeNull();
    expect(primeira.container.querySelector("[data-precisa-de-voce]")).toBeNull();
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
    expect(cartaoEm(container, "c2", "2026-11-20").textContent).toContain("Arte");
  });

  it("tráfego não é mandado para o Estúdio: a página completa é a Agenda do cliente", async () => {
    sessao.papel = "traffic";
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const menu = await abrirMenuDoCartao(container, "c2", "2026-11-20");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Abrir na página completa"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Abrir na página completa" }));
    await waitFor(() => expect(endereco()).toBe("/calendario?client=c2"));
  });
});

/*
 * O clique no cartão abre a peça ali mesmo (pedido do Almir, 14/11/2026,
 * 21h54 e 21h55): nada de ir para a Agenda.
 */
describe("Esteira: o clique abre o painel da peça na mesma tela", () => {
  it("peça com post: abre a ficha da Agenda aqui, sem navegar, e fechar recarrega a grade", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    expect(leituras).toHaveLength(1);
    fireEvent.click(cartaoEm(container, "c1", "2026-11-17"));

    const ficha = await screen.findByRole("dialog", { name: "Ficha da peça" });
    expect(endereco()).toBe("/esteira");
    expect(container.querySelector('[data-painel-da-peca="post:p1"]')).not.toBeNull();
    expect(sessao.detalhes.at(-1)).toEqual({ postId: "p1", clientId: "c1" });
    expect(ficha.getAttribute("data-ficha-da-agenda")).toBe("p1");
    expect(ficha.getAttribute("data-cliente")).toBe("Alfa Comércio");
    expect(ficha.getAttribute("data-projeto")).toBe("Conteúdo mensal");
    expect(ficha.getAttribute("data-pode-editar")).toBe("true");
    // Admin abre o Estúdio pela ficha (a regra da Agenda).
    expect(ficha.getAttribute("data-mesa")).toBe("/mesa?client=c1&aba=estudio&task=t1");

    fireEvent.click(within(ficha).getByRole("button", { name: "Fechar ficha" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ficha da peça" })).toBeNull());
    expect(endereco()).toBe("/esteira");
    await waitFor(() => expect(leituras.length).toBeGreaterThan(1));
  });

  it("arquivar fecha o painel e recarrega; Editar leva à Agenda já aberta na peça (ação explícita)", async () => {
    const primeira = montar();
    await screen.findByText("Promoção de sexta");
    fireEvent.click(cartaoEm(primeira.container, "c1", "2026-11-17"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Ficha da peça" })).getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ficha da peça" })).toBeNull());
    await waitFor(() => expect(leituras.length).toBeGreaterThan(1));
    primeira.unmount();

    const segunda = montar();
    await screen.findByText("Promoção de sexta");
    fireEvent.click(cartaoEm(segunda.container, "c1", "2026-11-17"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Ficha da peça" })).getByRole("button", { name: "Editar" }));
    await waitFor(() => expect(endereco()).toBe("/calendario?client=c1&content=p1"));
  });

  it("tarefa sem post: abre a janela da tarefa aqui; tráfego não abre o Estúdio pela ficha", async () => {
    const { container } = montar();
    await screen.findByText("Reel do bastidor");
    fireEvent.click(cartaoEm(container, "c2", "2026-11-20"));
    const janela = await screen.findByRole("dialog", { name: "Janela da tarefa" });
    expect(endereco()).toBe("/esteira");
    expect(janela.getAttribute("data-janela-da-tarefa")).toBe("t9");
    // Só o id: sem a tarefa inteira a janela não abre com dados parciais (salvar apagaria campos).
    expect(sessao.tarefasPedidas).toEqual([{ id: "t9" }]);
    expect(janela.getAttribute("data-somente-leitura")).toBe("false");
    fireEvent.click(within(janela).getByRole("button", { name: "Fechar janela" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Janela da tarefa" })).toBeNull());
  });

  it("o menu … não abre o painel e leva à página completa; a peça do Estúdio leva a /mesa", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const menu = await abrirMenuDoCartao(container, "c1", "2026-11-17");
    expect(container.querySelector("[data-painel-da-peca]")).toBeNull();
    // Peça com post: a página completa é a Agenda; sem trabalho do Estúdio, nada de "Abrir no Estúdio".
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Abrir na página completa"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Abrir na página completa" }));
    await waitFor(() => expect(endereco()).toBe("/calendario?client=c1&content=p1"));
    expect(container.querySelector("[data-painel-da-peca]")).toBeNull();
  });

  it("peça com post e trabalho do Estúdio: o menu tem a página completa (Agenda) e o Estúdio", async () => {
    sessao.pecasExtras = [peca({
      chave: "post:p5", clientId: "c1", titulo: "Post com arte",
      post: { id: "p5", production_status: "production", archived_at: null, temArquivo: true },
      tarefa: { id: "t5", status: "todo", due_date: "2026-11-19" },
      trabalho: { status: "pronto", entrega_status: null, temArquivo: true },
    })];
    const { container } = montar();
    await screen.findByText("Post com arte");
    const menu = await abrirMenuDoCartao(container, "c1", "2026-11-19");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Abrir na página completa", "Abrir no Estúdio"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Abrir no Estúdio" }));
    await waitFor(() => expect(endereco()).toBe("/mesa?client=c1&aba=estudio&task=t5"));
  });
});

/*
 * Organização (21h08) e limpeza (21h53 a 21h55): uma barra só no topo
 * (clientes, período e navegação), faixa por cliente e rolagem por coluna.
 */
const QUINTA = new Date("2026-11-19T15:00:00Z");
const DOMINGO = new Date("2026-11-22T15:00:00Z");
const CHAVE = "aceleriq:esteira:filtro-clientes";
const faixasNaTela = (tela: HTMLElement) => Array.from(tela.querySelectorAll("[data-faixa-da-esteira]")).map((f) => f.getAttribute("data-faixa-da-esteira"));
const chip = (nome: string | RegExp) => screen.getByRole("button", { name: nome });
const RDAR = "52f2efb6-9928-4074-b8e2-bc972baf1f6a";
/** O seletor de clientes é um botão da barra que abre a escolha. */
async function abrirSeletor() {
  fireEvent.click(screen.getByRole("button", { name: /^Clientes da Esteira:/ }));
  return screen.findByRole("region", { name: "Clientes da Esteira" });
}

describe("Esteira organizada: barra única, seletor de clientes e faixas", () => {
  it("clientes, período e navegação ficam numa barra só, no topo, antes dos avisos e da grade", async () => {
    sessao.doDono = DO_DONO;
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const barra = container.querySelector("[data-barra-da-esteira]") as HTMLElement;
    const acoes = barra.querySelector("[data-acoes-do-cabecalho]") as HTMLElement;
    expect(within(acoes).getByRole("button", { name: "Clientes da Esteira: Todos os clientes" })).toBeTruthy();
    expect(within(acoes).getByRole("tablist", { name: "Período" })).toBeTruthy();
    expect(within(acoes).getByRole("button", { name: "Semana atual" })).toBeTruthy();
    expect(within(acoes).getByRole("button", { name: "Atualizar" })).toBeTruthy();
    // Título curto com o período e a ajuda recolhida (nada de parágrafo longo na tela).
    expect(within(barra).getByRole("heading", { name: "Esteira" })).toBeTruthy();
    expect(within(barra).getAllByText("16 a 22 de novembro de 2026").length).toBeGreaterThan(0);
    const caixa = container.querySelector("[data-precisa-de-voce]")!;
    const grade = container.querySelector("[data-grade-da-esteira]")!;
    expect(barra.compareDocumentPosition(caixa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(caixa.compareDocumentPosition(grade) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const seletor = await abrirSeletor();
    expect(within(seletor).getByRole("group", { name: "Clientes da Esteira" })).toBeTruthy();
    expect(chip("Todos").getAttribute("aria-pressed")).toBe("true");
    expect(chip(/Só prioritários hoje/).getAttribute("aria-pressed")).toBe("false");
    expect(within(seletor).getByRole("searchbox", { name: "Buscar cliente na Esteira" })).toBeTruthy();
    expect(faixasNaTela(container)).toEqual(["c1", "c2", RDAR]);
  });

  it("escolher um cliente esconde as outras faixas; o segundo soma; tirar todos volta para Todos", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    await abrirSeletor();
    fireEvent.click(chip("Beta Loja"));
    expect(faixasNaTela(container)).toEqual(["c2"]);
    expect(chip("Beta Loja").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Todos").getAttribute("aria-pressed")).toBe("false");
    // O botão da barra diz quem está à vista.
    expect(screen.getByRole("button", { name: "Clientes da Esteira: Beta Loja" })).toBeTruthy();
    expect(within(container.querySelector('[data-faixa-da-esteira="c2"]') as HTMLElement).getByText("Beta Loja")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(CHAVE)!)).toEqual({ v: 1, modo: "clientes", ids: ["c2"] });

    // A ordem continua a alfabética, não a do clique.
    fireEvent.click(chip("Alfa Comércio"));
    expect(faixasNaTela(container)).toEqual(["c1", "c2"]);
    expect(screen.getByRole("button", { name: "Clientes da Esteira: 2 clientes" })).toBeTruthy();

    fireEvent.click(chip("Alfa Comércio"));
    fireEvent.click(chip("Beta Loja"));
    expect(faixasNaTela(container)).toEqual(["c1", "c2", RDAR]);
    expect(chip("Todos").getAttribute("aria-pressed")).toBe("true");
  });

  it("Todos limpa a seleção individual", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    await abrirSeletor();
    fireEvent.click(chip("Beta Loja"));
    fireEvent.click(chip("Todos"));
    expect(faixasNaTela(container)).toHaveLength(3);
    expect(chip("Beta Loja").getAttribute("aria-pressed")).toBe("false");
    expect(JSON.parse(window.localStorage.getItem(CHAVE)!)).toEqual({ v: 1, modo: "todos", ids: [] });
  });

  it("a busca filtra os clientes pelo nome, sem ligar para acento", async () => {
    montar();
    await screen.findByText("Promoção de sexta");
    await abrirSeletor();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar cliente na Esteira" }), { target: { value: "comercio" } });
    expect(screen.queryByRole("button", { name: "Beta Loja" })).toBeNull();
    expect(chip("Alfa Comércio")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar cliente na Esteira" }), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhum cliente com esse nome.")).toBeTruthy();
  });

  it("Só prioritários hoje: na quinta, só a Beta", async () => {
    const { container } = montar(QUINTA);
    await screen.findByText("Promoção de sexta");
    await abrirSeletor();
    fireEvent.click(chip(/Só prioritários hoje/));
    expect(faixasNaTela(container)).toEqual(["c2"]);
    expect(chip(/Só prioritários hoje/).getAttribute("aria-pressed")).toBe("true");
  });

  it("Só prioritários hoje no domingo: estado vazio claro e um toque volta para Todos", async () => {
    const { container } = montar(DOMINGO);
    await screen.findByText("Promoção de sexta");
    await abrirSeletor();
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
    await abrirSeletor();
    expect(chip("Todos").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Esteira: período de uma ou duas semanas", () => {
  it("2 semanas mostra 14 dias, lê 14 dias, anda de 14 em 14 e fica lembrado", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    expect(screen.getByRole("tab", { name: "1 semana" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "2 semanas" }));
    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(15));
    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos[1]).toBe("Seg 16");
    expect(cabecalhos[8]).toBe("Seg 23");
    expect(cabecalhos[14]).toBe("Dom 29");
    await waitFor(() => expect(leituras.at(-1)).toEqual({ ids: ["52f2efb6-9928-4074-b8e2-bc972baf1f6a", "c1", "c2"], segunda: "2026-11-16", dias: 14 }));
    expect(JSON.parse(window.localStorage.getItem("aceleriq:esteira:periodo")!)).toEqual({ v: 1, dias: 14 });
    expect(within(container.querySelector("[data-barra-da-esteira]") as HTMLElement).getAllByText("16 a 29 de novembro de 2026").length).toBeGreaterThan(0);
    // As duas tabelas (dias e faixas) ficam mais largas juntas, para as colunas baterem.
    for (const t of Array.from(container.querySelectorAll("[data-grade-da-esteira] table"))) expect(t.className).toMatch(/min-w-\[1540px\].*sm:min-w-\[1860px\]/);
    // Os dois dias prioritários da segunda semana também aparecem (sem peça, alertam).
    await screen.findByText("Promoção de sexta");
    expect(celula(container, "c1", "2026-11-24").getAttribute("data-alerta")).toBe("sim");
    expect(celula(container, "c2", "2026-11-26").getAttribute("data-alerta")).toBe("sim");

    fireEvent.click(screen.getByRole("button", { name: "Próximas duas semanas" }));
    await waitFor(() => expect(screen.getAllByRole("columnheader")[1].textContent).toBe("Seg 30"));
    fireEvent.click(screen.getByRole("button", { name: "Semana atual" }));
    await waitFor(() => expect(screen.getAllByRole("columnheader")[1].textContent).toBe("Seg 16"));
    fireEvent.click(screen.getByRole("button", { name: "Duas semanas antes" }));
    await waitFor(() => expect(screen.getAllByRole("columnheader")[1].textContent).toBe("Seg 2"));
  });

  it("abre com o período guardado e volta para uma semana com valor estranho", async () => {
    window.localStorage.setItem("aceleriq:esteira:periodo", JSON.stringify({ v: 1, dias: 14 }));
    const primeira = montar();
    await screen.findByText("Promoção de sexta");
    expect(screen.getAllByRole("columnheader")).toHaveLength(15);
    expect(leituras[0].dias).toBe(14);
    primeira.unmount();

    window.localStorage.setItem("aceleriq:esteira:periodo", JSON.stringify({ v: 1, dias: 30 }));
    montar();
    await screen.findByText("Promoção de sexta");
    expect(screen.getAllByRole("columnheader")).toHaveLength(8);
  });
});

describe("Esteira: rolagem por coluna e por área, e a página cabe na tela", () => {
  it("célula com 5 peças mostra as 5 numa rolagem com teto, sem +N", async () => {
    sessao.pecasExtras = ["A", "B", "C", "D", "E"].map((l, i) => peca({
      chave: `task:x${i}`, clientId: "c1", titulo: `Peça ${l}`,
      tarefa: { id: `x${i}`, status: "todo", due_date: "2026-11-19" },
    }));
    const { container } = montar();
    await screen.findByText("Peça A");
    const quinta = celula(container, "c1", "2026-11-19");
    expect(within(quinta).getAllByRole("button", { name: /Ver detalhes$/ }).map((b) => b.textContent?.slice(0, 6))).toEqual(["Peça A", "Peça B", "Peça C", "Peça D", "Peça E"]);
    expect(within(quinta).queryByRole("button", { name: /Mostrar mais/ })).toBeNull();
    expect(container.querySelector("[data-mais-da-celula]")).toBeNull();
    const rolagem = quinta.querySelector("[data-rolagem-da-celula]")!;
    expect(rolagem.className).toMatch(/\bmax-h-\[/);
    expect(rolagem.className).toContain("overflow-y-auto");
    expect(rolagem.className).toContain("overflow-x-hidden");
  });

  it("cada célula com peça rola por dentro, só na vertical; a área das faixas rola; datas e nome do cliente ficam fixos", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const celulas = Array.from(container.querySelectorAll("[data-rolagem-da-celula]"));
    expect(celulas.length).toBe(2);
    for (const c of celulas) {
      expect(c.className).toMatch(/\bmax-h-\[/);
      expect(c.className).toContain("overflow-y-auto");
      expect(c.className).not.toMatch(/overflow-x-auto|overflow-x-scroll/);
    }
    // A área das faixas ocupa o que sobra e rola nos dois eixos; o cabeçalho dos dias fica fora dela.
    const area = container.querySelector("[data-rolagem-das-datas]")!;
    expect(area.className).toMatch(/\boverflow-auto\b/);
    expect(area.className).toMatch(/\bflex-1\b/);
    expect(area.className).toMatch(/\bmin-h-0\b/);
    const topo = container.querySelector("[data-cabecalho-dos-dias]")!;
    expect(area.contains(topo)).toBe(false);
    expect(topo.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topo.className).toMatch(/\bsticky\b/);
    expect(topo.className).toContain("z-30");
    expect(topo.getAttribute("aria-hidden")).toBe("true");
    // O cabeçalho acompanha a rolagem horizontal da área (mesma tabela irmã de antes).
    (area as HTMLElement).scrollLeft = 120;
    fireEvent.scroll(area);
    expect((topo as HTMLElement).scrollLeft).toBe(120);
    const canto = container.querySelector("[data-canto-cliente]")!;
    expect(canto.className).toMatch(/sticky left-0 z-20/);
    // Coluna do cliente presa à esquerda e fora da rolagem das células: o nome não some.
    for (const th of Array.from(container.querySelectorAll("[data-cabecalho-da-faixa]"))) {
      expect(th.className).toMatch(/sticky left-0 z-10/);
      expect(th.querySelector("[data-rolagem-da-celula]")).toBeNull();
    }
    const grade = container.querySelector("[data-grade-da-esteira]")!;
    expect(grade.className).toMatch(/\bflex-1\b/);
    // Com teto mínimo: o aviso aberto numa janela baixa não espreme a grade a zero.
    expect(grade.className).toMatch(/\bmin-h-\[240px\]/);
  });
});

describe("Esteira no celular e no desktop", () => {
  const larguraOriginal = window.innerWidth;
  const largura = (px: number) => Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: px });
  afterEach(() => largura(larguraOriginal));

  it.each([375, 1280])("em %ipx: a página cabe na tela, a barra é uma linha só e só a área da grade rola", async (px) => {
    largura(px);
    window.dispatchEvent(new Event("resize"));
    sessao.doDono = DO_DONO;
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    const pagina = container.querySelector("[data-esteira-linha]") as HTMLElement;
    // A página não ganha largura mínima: só a tabela da grade tem.
    expect(pagina.className).not.toMatch(/min-w-\[/);
    expect(pagina.className).toContain("min-w-0");
    // Cabe na tela: altura medida da janela, em coluna, com a grade no que sobra.
    await waitFor(() => expect(pagina.getAttribute("data-cabe-na-tela")).toBe("sim"));
    expect(pagina.style.height).toMatch(/^\d+px$/);
    expect(pagina.className).toMatch(/\bflex\b/);
    expect(pagina.className).toMatch(/\bflex-col\b/);
    // A barra do topo: uma linha que rola por dentro no celular (padrão do CabecalhoDePagina).
    const acoes = container.querySelector("[data-barra-da-esteira] [data-acoes-do-cabecalho]")!;
    expect(acoes.className).toMatch(/flex-nowrap/);
    expect(acoes.className).toMatch(/overflow-x-auto/);
    for (const b of within(acoes as HTMLElement).getAllByRole("button")) expect(b.className).toMatch(/\bh-8\b|\bh-5\b/);
    // Avisos recolhidos: uma linha só.
    expect(container.querySelector("[data-precisa-de-voce]")!.getAttribute("data-aviso-recolhido")).toBe("sim");
    const tabelas = container.querySelectorAll("[data-grade-da-esteira] table");
    expect(tabelas).toHaveLength(2);
    for (const t of Array.from(tabelas)) expect(t.className).toMatch(/min-w-\[860px\].*sm:min-w-\[1040px\]/);
    expect(container.querySelector("[data-rolagem-das-datas]")!.className).toMatch(/\boverflow-auto\b/);
    expect(container.querySelectorAll("[data-rolagem-da-celula]").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("rowheader")).toHaveLength(3);
  });
});
