import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 18/11/2026: aba Regras do Escritório. A equipe vê as regras, os limites, os
 * usos e o que sempre sobe. Só o dono (admin) liga, desliga, ajusta os limites
 * e limpa a fila, sempre pelos RPCs do banco.
 */

const haMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
type Linha = Record<string, any>;

let papel = "admin";
let tabelas: Record<string, Linha[]> = {};
let fila: Linha = { total: 0, aplicado: false, itens: [] };
const leiturasFeitas: string[] = [];
const rpc = vi.fn(async (nome: string, args?: Linha): Promise<{ data: unknown; error: { message: string } | null }> => {
  if (nome === "regras_permanentes_limpar_fila") return { data: { ...fila, aplicado: Boolean(args?._aplicar) }, error: null };
  return { data: { ok: true }, error: null };
});

/** Banco de mentira: ler com igualdade, "desde" (gte) e limite. */
function consulta(tabela: string) {
  const iguais: Record<string, unknown> = {};
  const desde: Record<string, string> = {};
  let limite = Infinity;
  const q: any = {
    select: () => q,
    order: () => q,
    limit: (n: number) => { limite = n; return q; },
    eq: (c: string, v: unknown) => { iguais[c] = v; return q; },
    gte: (c: string, v: string) => { desde[c] = v; return q; },
    then: (ok: (r: unknown) => unknown) => {
      leiturasFeitas.push(tabela);
      const linhas = (tabelas[tabela] ?? [])
        .filter((l) => Object.keys(iguais).every((c) => (l[c] ?? null) === iguais[c]))
        .filter((l) => Object.keys(desde).every((c) => String(l[c]) >= desde[c]))
        .slice(0, limite);
      return Promise.resolve(ok({ data: linhas, error: null }));
    },
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (tabela: string) => consulta(tabela), rpc: (nome: string, args?: Linha) => rpc(nome, args) },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, profile: { id: "u-1", role: papel, full_name: "Almir" } }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import AdminEscritorio from "@/pages/AdminEscritorio";

const TRAVESSAO = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);
const agente = (id: string, slug: string, nome: string) => ({
  id, slug, display_name: nome, role: "Tráfego pago", scope: null, status: "active", area: "Tráfego", parent_slug: null,
  display_order: 10, origem: "hermes", is_coordinator: false, last_run_at: null, hermes_profile_ref: null, grau: "executor",
});
const modelos = (texto: string) => ({
  mensalidade_vencida: { nome: "Mensalidade vencida", texto },
  lembrete_aprovacao: { nome: "Lembrete de aprovação", texto },
  pedido_material: { nome: "Pedido de material", texto },
});
const MENSAGENS = { hora_inicio: 9, hora_fim: 18, max_por_assunto: 2, intervalo_dias: 6 };

function banco(): Record<string, Linha[]> {
  return {
    internal_operators: [agente("1", "trafe", "Trafe"), agente("2", "lia", "Lia")],
    escritorio_presenca: [],
    regras_permanentes: [
      { chave: "conteudo_revisado", nome: "Conteúdo revisado", area: "Conteúdo", descricao: "Publica a peça que o revisor aprovou.", ligada: false, acoes: ["publicar_peca"], operadores: [], limites: { max_rejeicoes: 1 }, atualizado_em: haMin(600) },
      { chave: "mensagens_de_rotina", nome: "Mensagens de rotina", area: "Clientes", descricao: "Manda os lembretes de rotina ao cliente.", ligada: false, acoes: ["mensagem_cliente"], operadores: [], limites: { ...MENSAGENS, modelos: modelos("") }, atualizado_em: haMin(600) },
      { chave: "trafego_ate_o_teto", nome: "Tráfego até o teto", area: "Tráfego", descricao: "Ajusta a verba dos anúncios até o teto da semana.", ligada: true, acoes: ["ajustar_verba"], operadores: ["trafe"], limites: { teto_semana_brl: 120, dias_sem_coleta: 3 }, atualizado_em: haMin(600) },
    ],
    regras_permanentes_usos: [
      { id: "u1", regra: "trafego_ate_o_teto", operator_slug: "trafe", client_id: "c1", action_kind: "ajustar_verba", valor: 35.5, assunto: null, usado_em: new Date().toISOString() },
      { id: "u2", regra: "trafego_ate_o_teto", operator_slug: "trafe", client_id: "c1", action_kind: "pausar_anuncio", valor: null, assunto: null, usado_em: haMin(8 * 1440) },
    ],
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: ["/escritorio"] }, h(AdminEscritorio))));
}
const abrirRegras = async () => {
  fireEvent.click(await screen.findByRole("tab", { name: "Regras" }));
  await screen.findByRole("region", { name: "Tráfego até o teto" });
};
const bloco = (chave: string) => document.querySelector(`[data-regra="${chave}"]`) as HTMLElement;
const chaveDe = (nome: string) => screen.getByRole("switch", { name: `Regra ${nome}` }) as HTMLButtonElement;
const livre = async (pegar: () => HTMLElement) => waitFor(() => expect((pegar() as HTMLButtonElement).disabled).toBe(false));

beforeEach(() => { papel = "admin"; tabelas = banco(); fila = { total: 0, aplicado: false, itens: [] }; });
afterEach(() => {
  cleanup();
  rpc.mockClear();
  for (const f of Object.values(toast)) f.mockClear();
  leiturasFeitas.length = 0;
  window.localStorage.clear();
});

describe("Escritório: aba Regras", () => {
  it("mostra a frase de abertura, cada regra com área, quem usa, os usos da semana, os últimos usos e a lista do que sempre sobe", async () => {
    montar();
    await abrirRegras();
    expect(screen.getByText("Dentro da regra, o agente faz sozinho e fica registrado. Fora dela, sobe para você.")).toBeTruthy();

    const trafego = bloco("trafego_ate_o_teto");
    expect(trafego.textContent).toContain("Tráfego · usada 1 vez nesta semana");
    expect(trafego.textContent).toContain("Ajusta a verba dos anúncios até o teto da semana.");
    expect(trafego.querySelector("[data-quem]")?.textContent).toBe("Quem usa: Trafe");
    expect(bloco("conteudo_revisado").querySelector("[data-quem]")?.textContent).toBe("Quem usa: qualquer agente");
    expect(bloco("conteudo_revisado").textContent).toContain("Conteúdo · usada 0 vezes nesta semana");
    expect(bloco("conteudo_revisado").textContent).toContain("Nenhum uso registrado ainda.");

    // Os últimos usos ficam recolhidos; abertos, mostram agente, ação, valor em reais e há quanto tempo.
    expect(within(trafego).queryByRole("list", { name: "Últimos usos de Tráfego até o teto" })).toBeNull();
    fireEvent.click(within(trafego).getByRole("button", { name: "Últimos 2 usos" }));
    const usos = within(within(trafego).getByRole("list", { name: "Últimos usos de Tráfego até o teto" })).getAllByRole("listitem");
    expect(usos).toHaveLength(2);
    expect(usos[0].textContent).toContain("Trafe");
    expect(usos[0].textContent).toContain("ajustar verba");
    expect(usos[0].textContent?.replace(/\s/g, " ")).toContain("R$ 35,50");
    expect(usos[0].textContent).toContain("agora");
    expect(usos[1].textContent).toContain("pausar anuncio");
    expect(usos[1].textContent).not.toContain("R$");
    expect(usos[1].textContent).toContain("há 8 d");

    const fixa = screen.getByRole("list", { name: "Sempre sobe para você" });
    expect(within(fixa).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Gasto acima do teto ou recarga", "Cliente novo", "Preço e negociação", "Reclamação", "Peça rejeitada mais de uma vez", "Mudança de rumo", "Financeiro, permissões e exclusão de dados",
    ]);
    expect(within(fixa).queryByRole("button")).toBeNull();
    expect(within(fixa).queryByRole("textbox")).toBeNull();
    expect(TRAVESSAO.test(document.body.textContent ?? "")).toBe(false);
  });

  it("ligar pede confirmação dizendo o que o agente passa a fazer; desligar vai direto; os dois pelo RPC", async () => {
    montar();
    await abrirRegras();
    expect(chaveDe("Conteúdo revisado").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(chaveDe("Conteúdo revisado"));
    const janela = await screen.findByRole("dialog");
    expect(janela.textContent).toContain("Com a regra ligada, qualquer agente passa a fazer isto sem pedir:");
    expect(janela.textContent).toContain("Publica a peça que o revisor aprovou.");
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(within(janela).getByRole("button", { name: "Sim, ligar" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("regra_permanente_ajustar", { _chave: "conteudo_revisado", _ligada: true, _limites: null }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Conteúdo revisado: ligada.");

    await livre(() => chaveDe("Tráfego até o teto"));
    expect(chaveDe("Tráfego até o teto").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(chaveDe("Tráfego até o teto"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("regra_permanente_ajustar", { _chave: "trafego_ate_o_teto", _ligada: false, _limites: null }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("desistir na confirmação não liga nada", async () => {
    montar();
    await abrirRegras();
    fireEvent.click(chaveDe("Conteúdo revisado"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Não ligar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(rpc).not.toHaveBeenCalled();
  });

  it("mensagens com texto de modelo vazio não liga: chave travada e o aviso; com os textos colados, liga", async () => {
    montar();
    await abrirRegras();
    expect(chaveDe("Mensagens de rotina").disabled).toBe(true);
    expect(bloco("mensagens_de_rotina").querySelector("[data-falta]")?.textContent).toBe("Falta colar o texto dos modelos.");
    fireEvent.click(chaveDe("Mensagens de rotina"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(bloco("conteudo_revisado").querySelector("[data-falta]")).toBeNull();
    cleanup();

    tabelas.regras_permanentes[1].limites = { ...MENSAGENS, modelos: modelos("Oi, [nome do cliente].") };
    montar();
    await abrirRegras();
    expect(chaveDe("Mensagens de rotina").disabled).toBe(false);
    expect(bloco("mensagens_de_rotina").querySelector("[data-falta]")).toBeNull();
  });

  it("limites: confere antes de mandar, mostra o erro no campo e salva o objeto inteiro pelo RPC", async () => {
    montar();
    await abrirRegras();
    const trafego = bloco("trafego_ate_o_teto");
    const salvar = () => within(trafego).getByRole("button", { name: "Salvar limites de Tráfego até o teto" }) as HTMLButtonElement;
    const teto = within(trafego).getByLabelText(/Teto por semana/) as HTMLInputElement;
    expect(teto.value).toBe("120");
    expect(salvar().disabled).toBe(true);

    fireEvent.change(teto, { target: { value: "200000" } });
    fireEvent.click(salvar());
    expect(trafego.textContent).toContain("Use um número de 0 a 100000.");
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.change(teto, { target: { value: "150,5" } });
    fireEvent.change(within(trafego).getByLabelText(/Dias sem coleta/), { target: { value: "5" } });
    fireEvent.click(salvar());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("regra_permanente_ajustar", { _chave: "trafego_ate_o_teto", _ligada: null, _limites: { teto_semana_brl: 150.5, dias_sem_coleta: 5 } }));
    expect(trafego.textContent).not.toContain("Use um número de 0 a 100000.");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Limites de Tráfego até o teto salvos."));
  });

  it("mensagens: início antes do fim, um campo de texto por modelo com a dica dos colchetes, e o texto colado vai no RPC", async () => {
    montar();
    await abrirRegras();
    const mensagens = bloco("mensagens_de_rotina");
    const textos = within(mensagens).getAllByRole("textbox").filter((c) => c.tagName === "TEXTAREA");
    expect(textos).toHaveLength(3);
    expect(mensagens.textContent?.split("O agente só pode trocar o que está entre colchetes, como [nome do cliente].").length).toBe(4);

    fireEvent.change(within(mensagens).getByLabelText(/Hora de início/), { target: { value: "19" } });
    fireEvent.click(within(mensagens).getByRole("button", { name: "Salvar limites de Mensagens de rotina" }));
    expect(mensagens.textContent).toContain("A hora de fim precisa ser depois da hora de início.");
    expect(rpc).not.toHaveBeenCalled();

    fireEvent.change(within(mensagens).getByLabelText(/Hora de início/), { target: { value: "8" } });
    fireEvent.change(within(mensagens).getByLabelText(/Texto: Mensalidade vencida/), { target: { value: " Oi, [nome do cliente]. A mensalidade venceu. " } });
    fireEvent.click(within(mensagens).getByRole("button", { name: "Salvar limites de Mensagens de rotina" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("regra_permanente_ajustar", {
      _chave: "mensagens_de_rotina",
      _ligada: null,
      _limites: {
        hora_inicio: 8, hora_fim: 18, max_por_assunto: 2, intervalo_dias: 6,
        modelos: { ...modelos(""), mensalidade_vencida: { nome: "Mensalidade vencida", texto: "Oi, [nome do cliente]. A mensalidade venceu." } },
      },
    }));
  });

  it("limpar a fila: primeiro mostra o que sairia, depois tira com confirmação e relê", async () => {
    fila = {
      total: 2,
      aplicado: false,
      itens: [
        { approval_id: "a1", regra: "trafego_ate_o_teto", operador: "trafe", acao: "ajustar_verba", o_que: "Subir a verba da Acerbi em R$ 20", criado_em: haMin(120) },
        { approval_id: "a2", regra: "conteudo_revisado", operador: "lia", acao: "publicar_peca", o_que: "Publicar o carrossel de terça", criado_em: haMin(30) },
      ],
    };
    montar();
    await abrirRegras();
    expect(screen.queryByRole("button", { name: /Tirar/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver o que sairia da caixa" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("regras_permanentes_limpar_fila", { _aplicar: false }));
    const tabela = await screen.findByRole("table", { name: "Pedidos que sairiam da caixa" });
    const linha = tabela.querySelector('[data-pedido="a1"]') as HTMLElement;
    expect(Array.from(linha.querySelectorAll("td")).map((td) => td.textContent)).toEqual(["Tráfego até o teto", "Trafe", "ajustar verba", "Subir a verba da Acerbi em R$ 20", "há 2 h"]);
    expect(tabela.querySelector('[data-pedido="a2"]')?.textContent).toContain("Lia");

    await livre(() => screen.getByRole("button", { name: "Tirar estes 2 da caixa" }));
    fireEvent.click(screen.getByRole("button", { name: "Tirar estes 2 da caixa" }));
    const janela = await screen.findByRole("dialog");
    expect(rpc).not.toHaveBeenCalledWith("regras_permanentes_limpar_fila", { _aplicar: true });
    const antes = leiturasFeitas.filter((t) => t === "regras_permanentes").length;
    fireEvent.click(within(janela).getByRole("button", { name: "Sim, tirar" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("regras_permanentes_limpar_fila", { _aplicar: true }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 pedidos saíram da caixa."));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("table", { name: "Pedidos que sairiam da caixa" })).toBeNull();
    await waitFor(() => expect(leiturasFeitas.filter((t) => t === "regras_permanentes").length).toBeGreaterThan(antes));
  });

  it("limpar a fila sem nada para tirar mostra o texto combinado e nenhum botão de tirar", async () => {
    montar();
    await abrirRegras();
    fireEvent.click(screen.getByRole("button", { name: "Ver o que sairia da caixa" }));
    expect(await screen.findByText("Nenhum pedido antigo cabe nas regras de hoje.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tirar/ })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("quem é da equipe e não é admin vê tudo e não mexe em nada", async () => {
    papel = "manager";
    montar();
    await abrirRegras();
    const aba = document.querySelector("[data-regras-do-escritorio]") as HTMLElement;
    expect(within(aba).queryByRole("switch")).toBeNull();
    expect(within(aba).queryByRole("textbox")).toBeNull();
    expect(within(aba).queryByRole("button", { name: /Salvar/ })).toBeNull();
    expect(within(aba).queryByRole("button", { name: "Ver o que sairia da caixa" })).toBeNull();
    expect(screen.getByText("Só o dono limpa a fila.")).toBeTruthy();

    const trafego = bloco("trafego_ate_o_teto");
    expect(trafego.textContent).toContain("Ligada");
    expect(trafego.querySelector("[data-limites]")?.textContent).toContain("Teto por semana (R$)120");
    expect(trafego.querySelector("[data-limites]")?.textContent).toContain("Dias sem coleta3");
    const mensagens = bloco("mensagens_de_rotina");
    expect(mensagens.textContent).toContain("Desligada");
    expect(mensagens.textContent).toContain("Falta colar o texto dos modelos.");
    expect(mensagens.textContent).toContain("Texto: Pedido de materialSem texto ainda");
    // Os últimos usos e a lista fixa continuam à vista.
    fireEvent.click(within(trafego).getByRole("button", { name: "Últimos 2 usos" }));
    expect(within(trafego).getByRole("list", { name: "Últimos usos de Tráfego até o teto" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Sempre sobe para você" })).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});
