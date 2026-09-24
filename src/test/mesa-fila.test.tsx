import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fila de prioridades da Mesa (pedido do dono em 24/09): simples e direcional,
 * agrupada por cliente, o mais urgente primeiro, com o motivo e o botão que
 * leva para a aba certa. Fixa a ordem, os textos, a mensagem de cobrança e a
 * entrada da Mesa sem cliente.
 */

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mock.rpc, from: mock.from, functions: { invoke: vi.fn() }, storage: { from: vi.fn() } },
}));
const aviso = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: aviso }));
const papel = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: papel.role }, user: { id: "u-1" } }) }));

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";

vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [
      { id: A, company_name: "Padaria São João" },
      { id: B, company_name: "Ótica Visão" },
      { id: C, company_name: "Academia Força" },
      { id: D, company_name: "Doceria Lua" },
    ],
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/mesa/MesaContexto", async (original) => ({
  ...(await original<typeof import("@/components/mesa/MesaContexto")>()),
  useCatalogo: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/components/mesa/AbaContexto", () => ({ default: () => <p>aba contexto</p> }));
vi.mock("@/components/mesa/AbaMes", () => ({ default: () => <p>aba mês</p> }));
vi.mock("@/components/mesa/AbaCampanhas", () => ({ default: () => <p>aba campanhas</p> }));
vi.mock("@/components/mesa/AbaEstudio", () => ({ default: () => <p>aba estúdio</p> }));
vi.mock("@/components/mesa/AbaEntrega", () => ({ default: () => <p>aba entrega</p> }));

import {
  acoesDoCliente,
  diasEntre,
  lerFila,
  mensagemDeCobranca,
  montarFila,
  nivelDosPontos,
  normalizarFila,
  pontosDoMesVazio,
  pontosDoPrazo,
  type ClienteDaFila,
  type RespostaDaFila,
} from "@/lib/mesa/fila";
import FilaDePrioridades from "@/components/mesa/FilaDePrioridades";
import MesaDoCliente from "@/pages/MesaDoCliente";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const HOJE = "2026-09-24";

const cliente = (extra: Partial<ClienteDaFila>): ClienteDaFila => ({
  client_id: A,
  nome: "Padaria São João",
  ultimo_acesso: null,
  posts_por_mes: null,
  aprovacao_pendentes: 0,
  aprovacao_desde: null,
  revisao_pendentes: 0,
  revisao_desde: null,
  reprovados: 0,
  prontas_para_enviar: 0,
  precisam_atencao: 0,
  meses: [
    { mes: "2026-09-01", itens: 8, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false },
    { mes: "2026-10-01", itens: 8, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false },
  ],
  ...extra,
});

const resposta = (clientes: ClienteDaFila[], acesso = true): RespostaDaFila => ({ versao: 1, hoje: HOJE, acesso_conhecido: acesso, clientes, origem: "banco" });

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  papel.role = "admin";
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

// ------------------------------------------------------------------ regras

describe("ações de cada cliente", () => {
  it("cliente em dia não tem ação", () => {
    expect(acoesDoCliente(cliente({}), HOJE, true)).toEqual([]);
  });

  it("mês seguinte vazio a 7 dias de começar: gerar o mês, agora", () => {
    const [a] = acoesDoCliente(cliente({ meses: [{ mes: "2026-09-01", itens: 5, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false }, { mes: "2026-10-01", itens: 0, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false }] }), HOJE, true);
    expect(a.tipo).toBe("gerar_mes");
    expect(a.titulo).toBe("Gerar o mês");
    expect(a.motivo).toBe("O calendário de outubro está vazio");
    expect(a.pontos).toBe(80);
    expect(a.nivel).toBe("agora");
    expect(a.aba).toBe("mes");
    expect(a.mes).toBe("2026-10-01");
  });

  it("mês corrente vazio pesa mais; proposta começada vira 'Terminar o mês'", () => {
    const acoes = acoesDoCliente(
      cliente({ meses: [{ mes: "2026-09-01", itens: 0, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false }, { mes: "2026-10-01", itens: 0, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: true }] }),
      HOJE,
      true,
    );
    expect(acoes.map((a) => [a.titulo, a.pontos, a.mes])).toEqual([
      ["Gerar o mês", 88, "2026-09-01"],
      ["Terminar o mês", 80, "2026-10-01"],
    ]);
    expect(acoes[1].motivo).toBe("Outubro tem proposta começada, falta gravar no calendário");
  });

  it("artes: um aviso só, pelo item mais próximo, com quantos em cada mês", () => {
    const [a] = acoesDoCliente(
      cliente({
        meses: [
          { mes: "2026-09-01", itens: 8, sem_arte: 2, proximo_sem_arte: "2026-09-25", proposta_aberta: false },
          { mes: "2026-10-01", itens: 9, sem_arte: 9, proximo_sem_arte: "2026-10-01", proposta_aberta: false },
        ],
      }),
      HOJE,
      true,
    );
    expect(a.tipo).toBe("gerar_artes");
    expect(a.quantidade).toBe(11);
    expect(a.motivo).toBe("11 itens sem arte (2 em setembro, 9 em outubro); o próximo sai amanhã, 25/09");
    expect(a.pontos).toBe(85);
    expect(a.aba).toBe("estudio");
    expect(a.mes).toBe("2026-09-01");
  });

  it("prazo das artes e do mês vazio em faixas", () => {
    expect([0, 2, 3, 7, 8, 14, 15].map(pontosDoPrazo)).toEqual([85, 85, 72, 72, 55, 55, 38]);
    expect([7, 8, 14, 15].map(pontosDoMesVazio)).toEqual([80, 65, 65, 45]);
    expect([nivelDosPontos(80), nivelDosPontos(79), nivelDosPontos(55), nivelDosPontos(54)]).toEqual(["agora", "semana", "semana", "depois"]);
  });

  it("cobrar: dias de espera e último acesso; quem não entrou depois do pedido sobe", () => {
    const base = { aprovacao_pendentes: 3, aprovacao_desde: "2026-09-19T15:00:00Z" };
    const viu = acoesDoCliente(cliente({ ...base, ultimo_acesso: "2026-09-22T12:00:00Z" }), HOJE, true)[0];
    expect(viu.tipo).toBe("cobrar");
    expect(viu.motivo).toBe("3 posts esperando aprovação há 5 dias; último acesso há 2 dias");
    expect(viu.pontos).toBe(60);
    expect(viu.aba).toBe("entrega");
    const naoViu = acoesDoCliente(cliente({ ...base, ultimo_acesso: "2026-09-01T12:00:00Z" }), HOJE, true)[0];
    expect(naoViu.pontos).toBe(65);
    const nunca = acoesDoCliente(cliente({ ...base, ultimo_acesso: null }), HOJE, true)[0];
    expect(nunca.motivo).toContain("nunca entrou no painel");
    // Sem a RPC o acesso é desconhecido: não diz "nunca entrou".
    const semAcesso = acoesDoCliente(cliente({ ...base }), HOJE, false)[0];
    expect(semAcesso.motivo).toBe("3 posts esperando aprovação há 5 dias");
    const velho = acoesDoCliente(cliente({ aprovacao_pendentes: 1, aprovacao_desde: "2026-06-09T12:00:00Z", ultimo_acesso: "2026-06-09T13:00:00Z" }), HOJE, true)[0];
    expect(velho.pontos).toBe(90);
    expect(velho.nivel).toBe("agora");
  });

  it("entrega: resolver, ajustar, entregar e revisar com o destino certo", () => {
    const acoes = acoesDoCliente(
      cliente({ precisam_atencao: 1, reprovados: 2, prontas_para_enviar: 3, revisao_pendentes: 1, revisao_desde: "2026-09-21T12:00:00Z" }),
      HOJE,
      true,
    );
    expect(acoes.map((a) => [a.tipo, a.pontos, a.aba])).toEqual([
      ["resolver", 90, "entrega"],
      ["ajustar", 70, "estudio"],
      ["revisar", 63, "entrega"],
      ["entregar", 62, "entrega"],
    ]);
    expect(acoes[0].motivo).toBe("1 arte aprovada não entrou sozinha na Agenda");
    expect(acoes[3].motivo).toBe("3 artes prontas sem enviar para aprovação");
  });

  it("plano: mês com menos itens que o contratado pede para completar", () => {
    const acoes = acoesDoCliente(cliente({ posts_por_mes: 12 }), HOJE, true);
    expect(acoes.map((a) => [a.tipo, a.pontos, a.mes])).toEqual([
      ["completar_mes", 50, "2026-10-01"],
      ["completar_mes", 40, "2026-09-01"],
    ]);
    expect(acoes[0].motivo).toBe("Outubro tem 8 de 12 posts do plano");
  });
});

describe("a fila", () => {
  it("o mais urgente primeiro; empate pela soma e depois pelo nome; em dia à parte", () => {
    const fila = montarFila(
      resposta([
        cliente({ client_id: A, nome: "Padaria", aprovacao_pendentes: 1, aprovacao_desde: "2026-09-23T12:00:00Z", ultimo_acesso: "2026-09-23T13:00:00Z" }),
        cliente({ client_id: B, nome: "Ótica", precisam_atencao: 1 }),
        cliente({ client_id: C, nome: "Academia" }),
        cliente({ client_id: D, nome: "Doceria", precisam_atencao: 1, reprovados: 1 }),
      ]),
    );
    expect(fila.grupos.map((g) => g.nome)).toEqual(["Doceria", "Ótica", "Padaria"]);
    expect(fila.grupos[0].nivel).toBe("agora");
    expect(fila.emDia.map((c) => c.nome)).toEqual(["Academia"]);
    expect(fila.resumo).toEqual({ agora: 2, semana: 1, depois: 1 });
  });

  it("normaliza o que o banco devolver; lixo não quebra", () => {
    expect(normalizarFila(null).clientes).toEqual([]);
    expect(normalizarFila({ clientes: [{ nome: "sem id" }] }).clientes).toEqual([]);
    const r = normalizarFila({ hoje: HOJE, acesso_conhecido: true, clientes: [{ client_id: A, nome: "Padaria", aprovacao_pendentes: "2", meses: [{ mes: "2026-10-01", itens: 0 }] }] });
    expect(r.clientes[0].aprovacao_pendentes).toBe(2);
    expect(r.clientes[0].meses[0]).toEqual({ mes: "2026-10-01", itens: 0, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false });
    expect(r.acesso_conhecido).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(diasEntre("2026-09-24", "2026-10-01")).toBe(7);
  });

  it("mensagem de cobrança curta, sem travessão, com o link de aprovações", () => {
    const m = mensagemDeCobranca("Padaria São João", 3, 5, "https://app.aceleriq.com/aprovacoes");
    expect(m).toBe(
      "Oi, Padaria São João! Tudo bem? Você tem 3 posts esperando aprovação no painel da Aceleriq, o primeiro enviado há 5 dias. Consegue dar uma olhada hoje? É só entrar em https://app.aceleriq.com/aprovacoes e aprovar ou pedir ajuste em cada um. Assim a gente já deixa tudo agendado. Obrigado!",
    );
    expect(mensagemDeCobranca("Ótica", 1, 0, "x")).toContain("Você tem 1 post esperando aprovação no painel da Aceleriq. ");
    expect(m).not.toContain("—");
    expect(m).not.toContain("–");
  });

  it("lê pela RPC; sem ela no banco, pelas tabelas (sem o último acesso)", async () => {
    mock.rpc.mockResolvedValue({ data: resposta([cliente({})]), error: null });
    const r = await lerFila([]);
    expect(mock.rpc).toHaveBeenCalledWith("mesa_fila_prioridades");
    expect(r.origem).toBe("banco");

    mock.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const vazio = () => {
      const q: any = {};
      for (const m of ["select", "in", "is", "eq", "gte", "lt", "order", "limit", "neq"]) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, erro);
      return q;
    };
    mock.from.mockImplementation(vazio);
    const direto = await lerFila([{ id: A, nome: "Padaria" }]);
    expect(direto.origem).toBe("direto");
    expect(direto.acesso_conhecido).toBe(false);
    expect(mock.from).toHaveBeenCalledWith("projects");
  });
});

// ------------------------------------------------------------------ tela

function montar(el: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
}

const dadosDaTela = resposta([
  cliente({ client_id: A, nome: "Padaria São João", aprovacao_pendentes: 2, aprovacao_desde: "2026-09-20T12:00:00Z", ultimo_acesso: "2026-09-10T12:00:00Z" }),
  cliente({
    client_id: B,
    nome: "Ótica Visão",
    meses: [
      { mes: "2026-09-01", itens: 4, sem_arte: 1, proximo_sem_arte: "2026-09-25", proposta_aberta: false },
      { mes: "2026-10-01", itens: 0, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false },
    ],
  }),
  cliente({ client_id: C, nome: "Academia Força" }),
]);

describe("tela da fila", () => {
  it("agrupada por cliente, o mais urgente primeiro, e 'Abrir' leva à aba certa", async () => {
    mock.rpc.mockResolvedValue({ data: dadosDaTela, error: null });
    const onAbrir = vi.fn();
    montar(<FilaDePrioridades clientes={[]} clientesProntos onAbrir={onAbrir} />);
    const grupos = await screen.findAllByRole("heading", { level: 3 });
    expect(grupos.map((g) => g.textContent)).toEqual(["Ótica Visão", "Padaria São João"]);
    expect(screen.getByText("O calendário de outubro está vazio")).toBeTruthy();
    expect(screen.getByText("2 posts esperando aprovação há 4 dias; último acesso há 14 dias")).toBeTruthy();
    expect(screen.getByText("1 cliente em dia")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Gerar o mês: abrir Ótica Visão" }));
    expect(onAbrir).toHaveBeenCalledWith(B, "mes", "2026-10-01");
    fireEvent.click(screen.getByRole("button", { name: "Gerar artes: abrir Ótica Visão" }));
    expect(onAbrir).toHaveBeenLastCalledWith(B, "estudio", "2026-09-01");
  });

  it("copiar mensagem de cobrança vai para a área de transferência", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    mock.rpc.mockResolvedValue({ data: dadosDaTela, error: null });
    montar(<FilaDePrioridades clientes={[]} clientesProntos onAbrir={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copiar mensagem de cobrança para Padaria São João" }));
    await waitFor(() => expect(escrever).toHaveBeenCalled());
    expect(escrever.mock.calls[0][0]).toContain("Você tem 2 posts esperando aprovação");
    expect(escrever.mock.calls[0][0]).toContain("/aprovacoes");
    await waitFor(() => expect(aviso.success).toHaveBeenCalledWith("Mensagem copiada", expect.anything()));
  });

  it("filtro por tipo de ação mostra só o que interessa", async () => {
    mock.rpc.mockResolvedValue({ data: dadosDaTela, error: null });
    montar(<FilaDePrioridades clientes={[]} clientesProntos onAbrir={vi.fn()} />);
    await screen.findAllByRole("heading", { level: 3 });
    fireEvent.click(within(screen.getByRole("group", { name: "Filtrar por ação" })).getByRole("button", { name: /Cobrar aprovação/ }));
    const titulos = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titulos).toEqual(["Padaria São João"]);
  });

  it("tudo em dia: uma frase só", async () => {
    mock.rpc.mockResolvedValue({ data: resposta([cliente({})]), error: null });
    montar(<FilaDePrioridades clientes={[]} clientesProntos onAbrir={vi.fn()} />);
    expect(await screen.findByText("Tudo em dia. Nenhum cliente precisa de ação agora.")).toBeTruthy();
  });
});

// ------------------------------------------------------------------ página

function Endereco() {
  const loc = useLocation();
  return <output data-testid="endereco">{loc.search}</output>;
}

function montarPagina(inicial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[inicial]}>
        <MesaDoCliente />
        <Endereco />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rpcPorNome = (nome: string) => {
  if (nome === "mesa_fila_prioridades") return Promise.resolve({ data: dadosDaTela, error: null });
  if (nome === "mesa_custos_producao") return Promise.resolve({ data: { versao: 1, inicio: "2026-09-01", fim: "2026-10-01", linhas: [] }, error: null });
  return Promise.resolve({ data: { saldo_usd: 3, total_usd: 1, por_modelo: [], por_tarefa: [] }, error: null });
};

describe("Mesa: fila na entrada e botões no topo", () => {
  it("sem cliente, a Mesa abre na fila; 'Abrir' escolhe o cliente e a aba", async () => {
    mock.rpc.mockImplementation(rpcPorNome);
    montarPagina("/mesa");
    expect(screen.getByText("Escolha um cliente para abrir a mesa dele.")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "O que fazer agora" })).toBeTruthy();
    // O número do botão é o que está para agora.
    await waitFor(() => expect(screen.getByRole("button", { name: "Prioridades: 2 para agora" })).toBeTruthy());

    fireEvent.click(await screen.findByRole("button", { name: "Gerar o mês: abrir Ótica Visão" }));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain(`client=${B}`));
    const endereco = screen.getByTestId("endereco").textContent || "";
    expect(endereco).toContain("aba=mes");
    expect(endereco).toContain("mes=2026-10-01");
    expect(await screen.findByText("aba mês")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "O que fazer agora" })).toBeNull();
  });

  it("com cliente, Prioridades e Custos abrem no lugar da aba e voltam pela etapa", async () => {
    mock.rpc.mockImplementation(rpcPorNome);
    montarPagina(`/mesa?client=${A}&aba=estudio`);
    expect(await screen.findByText("aba estúdio")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Prioridades/ }));
    expect(await screen.findByRole("heading", { name: "O que fazer agora" })).toBeTruthy();
    expect(screen.getByTestId("endereco").textContent).toContain("painel=prioridades");

    fireEvent.click(screen.getByRole("button", { name: "Custos de produção" }));
    expect(await screen.findByRole("heading", { name: "Custos de produção" })).toBeTruthy();
    expect(screen.getByTestId("endereco").textContent).toContain("painel=custos");
    // Começa filtrado no cliente aberto.
    expect((screen.getByRole("combobox", { name: "Cliente" }) as HTMLSelectElement).value).toBe(A);

    const nav = screen.getByRole("navigation", { name: "Etapas da Mesa" });
    fireEvent.click(within(nav).getByRole("button", { name: /Entrega/ }));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).not.toContain("painel="));
    expect(await screen.findByText("aba entrega")).toBeTruthy();
  });

  it("design não vê o botão de Custos nem abre o painel pelo endereço", async () => {
    papel.role = "design";
    mock.rpc.mockImplementation(rpcPorNome);
    montarPagina(`/mesa?client=${A}&aba=mes&painel=custos`);
    expect(await screen.findByText("aba mês")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Custos de produção" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Custos de produção" })).toBeNull();
    expect(mock.rpc).not.toHaveBeenCalledWith("mesa_custos_producao", expect.anything());
  });

  it("a página continua com as duas leituras por cliente e a fila fora do cache de Map", () => {
    const pagina = ler("src/pages/MesaDoCliente.tsx");
    expect(pagina.match(/enabled: !!clientId,/g)?.length).toBe(2);
    expect(pagina).toContain('import("@/components/mesa/FilaDePrioridades")');
    expect(pagina).toContain('import("@/components/mesa/PainelDeCustos")');
    const fila = ler("src/lib/mesa/fila.ts");
    expect(fila).toContain('export const CHAVE_DA_FILA = ["mesa", "fila-de-prioridades"] as const;');
    expect(fila).not.toContain("new Map");
    expect(fila).not.toContain("new Set");
  });

  it("RPC da fila: equipe, security definer, último acesso só com a data", () => {
    const sql = ler("docs/mesa/v6/migrations/20260924180000_mesa_custos_e_fila.sql");
    const corpo = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.mesa_fila_prioridades"));
    expect(corpo).toContain("SECURITY DEFINER");
    expect(corpo).toContain("public.is_staff(_uid)");
    expect(corpo).toContain("public.can_access_client(p.id)");
    expect(corpo).toContain("au.last_sign_in_at");
    expect(corpo).not.toContain("au.email");
    expect(corpo).not.toContain("encrypted_password");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mesa_fila_prioridades() TO authenticated;");
  });
});

describe("cliente parado", () => {
  it("pendência antiga de cliente sem calendário e sem acesso vai para depois", async () => {
    const { acoesDoCliente } = await import("@/lib/mesa/fila");
    const acoes = acoesDoCliente(
      {
        client_id: "c1",
        nome: "Parado",
        ultimo_acesso: "2026-06-09T21:01:19Z",
        posts_por_mes: null,
        aprovacao_pendentes: 3,
        aprovacao_desde: "2026-06-09T21:08:29Z",
        revisao_pendentes: 0,
        revisao_desde: null,
        reprovados: 0,
        prontas_para_enviar: 0,
        precisam_atencao: 0,
        meses: [
          { mes: "2026-09-01", itens: 0, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false },
          { mes: "2026-10-01", itens: 0, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false },
        ],
      } as any,
      "2026-09-24",
      true,
    );
    expect(acoes.every((a) => a.nivel === "depois")).toBe(true);
    expect(acoes.find((a) => a.tipo === "cobrar")?.motivo).toContain("Cliente parado");
  });
});
