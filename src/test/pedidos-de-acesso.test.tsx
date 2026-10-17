import { createElement as h, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pedidos de acesso dos agentes (17/10/2026): a janela abre por ?acesso=<id>
 * em qualquer tela, cada tipo chama a RPC certa, a senha some ao fechar, a
 * lista só aparece com pedido aberto e o selo do cofre chama a RPC.
 * Banco falso: tabelas em memória e rpc espiã.
 */

const banco = vi.hoisted(() => ({
  tabelas: {} as Record<string, Array<Record<string, unknown>>>,
  rpc: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
  papel: "admin",
}));
const avisos = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: avisos }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-dono" }, profile: { role: banco.papel } }),
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { vi: v } = await import("vitest");
  banco.rpc = v.fn(async () => ({ data: "cofre-1", error: null }));
  const consulta = (tabela: string) => {
    let linhas = (banco.tabelas[tabela] || []).slice();
    const b: Record<string, unknown> = {};
    b.select = (colunas: string) => {
      // O front nunca pede `*` nem `codigo` na tabela de pedidos.
      if (tabela === "pedidos_de_acesso" && (colunas.indexOf("*") >= 0 || /(^|[\s,])codigo([\s,]|$)/.test(colunas))) throw new Error("coluna proibida");
      return b;
    };
    b.eq = (c: string, val: unknown) => {
      linhas = linhas.filter((l) => l[c] === val);
      return b;
    };
    b.in = (c: string, vals: unknown[]) => {
      linhas = linhas.filter((l) => vals.indexOf(l[c]) >= 0);
      return b;
    };
    for (const m of ["is", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: linhas[0] || null, error: null });
    b.then = (ok: (v: unknown) => unknown, f: (e: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok, f);
    return b;
  };
  const canal: Record<string, unknown> = {};
  canal.on = () => canal;
  canal.subscribe = () => canal;
  return {
    supabase: {
      from: consulta,
      rpc: (...a: unknown[]) => banco.rpc(...a),
      channel: () => canal,
      removeChannel: () => Promise.resolve(),
      storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://arquivos.test/${p}` }, error: null }) }) },
    },
  };
});

import { PedidoDeAcessoPelaUrl, linkSeguro } from "@/components/acesso/JanelaDoPedidoDeAcesso";
import PedidosDeAcesso from "@/components/acesso/PedidosDeAcesso";
import ClientVault from "@/components/vault/ClientVault";

// O interruptor (Radix Switch) mede o tamanho; o jsdom não tem ResizeObserver.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== "function") {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const ACELERIQ = "22222222-2222-4222-8222-222222222222";

function pedido(extra: Record<string, unknown>) {
  return {
    id: "p1",
    created_at: new Date().toISOString(),
    operador_slug: "hermes",
    client_id: CLIENTE,
    kanban_task_id: null,
    tipo: "senha",
    site: "Hostinger",
    url: "https://hpanel.hostinger.com/login",
    conta: "contato@cliente.com",
    mensagem: "A Hostinger pediu login para publicar o site.",
    link_para_conectar: null,
    print_path: "p1/tela.png",
    status: "aberto",
    vault_item_id: null,
    expira_em: null,
    respondido_por: null,
    respondido_em: null,
    usado_em: null,
    ...extra,
  };
}

function Onde() {
  const l = useLocation();
  return h("output", { "data-testid": "onde" }, `${l.pathname}${l.search}`);
}
function Reabrir() {
  const ir = useNavigate();
  return h("button", { type: "button", onClick: () => ir("/clientes?acesso=p1") }, "reabrir");
}

function montar(filho: ReactNode, url = "/clientes?aba=x&acesso=p1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [url] }, filho, h(Onde), h(Reabrir))),
  );
}

beforeEach(() => {
  banco.papel = "admin";
  banco.rpc.mockClear();
  avisos.success.mockClear();
  avisos.error.mockClear();
  banco.tabelas = {
    pedidos_de_acesso: [pedido({})],
    internal_operators: [{ slug: "hermes", display_name: "Hermes" }],
    user_roles: [{ user_id: CLIENTE, role: "client" }, { user_id: ACELERIQ, role: "client" }],
    profiles: [
      { id: CLIENTE, full_name: "Ana", company_name: "Padaria Sol" },
      { id: ACELERIQ, full_name: "Almir", company_name: "Aceleriq" },
    ],
    client_vault: [],
  };
});

describe("janela do pedido de acesso", () => {
  it("abre por ?acesso= em qualquer tela, com o agente, o site, a mensagem e o print", async () => {
    montar(h(PedidoDeAcessoPelaUrl));
    expect(await screen.findByText("O Hermes precisa de você em Hostinger")).toBeTruthy();
    expect(screen.getByText("A Hostinger pediu login para publicar o site.")).toBeTruthy();
    const print = (await screen.findByAltText("Print da tela de Hostinger")) as HTMLImageElement;
    expect(print.src).toBe("https://arquivos.test/p1/tela.png");
  });

  it("não abre para quem não é admin nem gestor", async () => {
    banco.papel = "design";
    montar(h(PedidoDeAcessoPelaUrl));
    await act(async () => {});
    expect(screen.queryByText(/precisa de você/)).toBeNull();
  });

  it("senha: chama a RPC com lembrar ligado por padrão, avisa, fecha e tira só o ?acesso", async () => {
    montar(h(PedidoDeAcessoPelaUrl));
    const usuario = (await screen.findByLabelText("E-mail ou usuário")) as HTMLInputElement;
    expect(usuario.value).toBe("contato@cliente.com");
    expect(usuario.getAttribute("autocomplete")).toBe("username");
    const senha = screen.getByLabelText("Senha") as HTMLInputElement;
    expect(senha.getAttribute("autocomplete")).toBe("current-password");
    expect(senha.type).toBe("password");
    expect((screen.getByRole("switch") as HTMLElement).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar a senha" }));
    expect(senha.type).toBe("text");
    fireEvent.change(senha, { target: { value: "s3cr3t!" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e liberar" }));
    await waitFor(() => expect(banco.rpc).toHaveBeenCalledTimes(1));
    expect(banco.rpc).toHaveBeenCalledWith("pedido_acesso_responder_senha", {
      p_pedido: "p1",
      p_client_id: CLIENTE,
      p_titulo: "Hostinger",
      p_usuario: "contato@cliente.com",
      p_senha: "s3cr3t!",
      p_lembrar: true,
    });
    await waitFor(() => expect(screen.getByTestId("onde").textContent).toBe("/clientes?aba=x"));
    expect(avisos.success).toHaveBeenCalledWith("Pronto, o Hermes já pode seguir");
  });

  it("senha: fechar com 'Não agora' limpa o campo (ao reabrir vem vazio) e não chama nada", async () => {
    montar(h(PedidoDeAcessoPelaUrl));
    const senha = (await screen.findByLabelText("Senha")) as HTMLInputElement;
    fireEvent.change(senha, { target: { value: "nao-pode-ficar" } });
    fireEvent.click(screen.getByRole("button", { name: "Não agora" }));
    await waitFor(() => expect(screen.queryByLabelText("Senha")).toBeNull());
    fireEvent.click(screen.getByText("reabrir"));
    const deNovo = (await screen.findByLabelText("Senha")) as HTMLInputElement;
    expect(deNovo.value).toBe("");
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("senha sem cliente no pedido: seletor com busca, Aceleriq (interno) incluída, lembrar desligado vai como false", async () => {
    banco.tabelas.pedidos_de_acesso = [pedido({ client_id: null })];
    montar(h(PedidoDeAcessoPelaUrl));
    await screen.findByRole("option", { name: /Aceleriq/ });
    fireEvent.change(screen.getByLabelText("Buscar cliente"), { target: { value: "acel" } });
    expect(screen.queryByRole("option", { name: /Padaria Sol/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Aceleriq/ }));
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar e liberar" }));
    await waitFor(() => expect(banco.rpc).toHaveBeenCalledTimes(1));
    expect(banco.rpc.mock.calls[0][1]).toMatchObject({ p_client_id: ACELERIQ, p_lembrar: false });
  });

  it("código: um campo com one-time-code, aceita letras e manda sem espaços", async () => {
    banco.tabelas.pedidos_de_acesso = [pedido({ tipo: "codigo" })];
    montar(h(PedidoDeAcessoPelaUrl));
    const campo = (await screen.findByLabelText("Código")) as HTMLInputElement;
    expect(campo.getAttribute("autocomplete")).toBe("one-time-code");
    expect(campo.getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByText("O código vale por 10 minutos.")).toBeTruthy();
    expect(screen.queryByLabelText("Senha")).toBeNull();
    fireEvent.change(campo, { target: { value: "12 ab 56" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await waitFor(() => expect(banco.rpc).toHaveBeenCalledWith("pedido_acesso_responder_codigo", { p_pedido: "p1", p_codigo: "12ab56" }));
  });

  it("conectar: botão abre o link oficial em nova aba e 'Já conectei' marca feito", async () => {
    banco.tabelas.pedidos_de_acesso = [pedido({ tipo: "conectar", site: "Facebook", link_para_conectar: "https://www.facebook.com/dialog/oauth?x=1" })];
    montar(h(PedidoDeAcessoPelaUrl));
    const link = (await screen.findByRole("link", { name: /Conectar Facebook/ })) as HTMLAnchorElement;
    expect(link.href).toBe("https://www.facebook.com/dialog/oauth?x=1");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(screen.queryByLabelText("Senha")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Já conectei" }));
    await waitFor(() => expect(banco.rpc).toHaveBeenCalledWith("pedido_acesso_marcar_feito", { p_pedido: "p1" }));
  });

  it("conectar: link que não é https não vira botão", () => {
    expect(linkSeguro("javascript:alert(1)")).toBeNull();
    expect(linkSeguro("http://accounts.google.com")).toBeNull();
    expect(linkSeguro("https://accounts.google.com/o/oauth2")).toBe("https://accounts.google.com/o/oauth2");
  });

  it("outro: mostra a mensagem e 'Já fiz' marca feito", async () => {
    banco.tabelas.pedidos_de_acesso = [pedido({ tipo: "outro", mensagem: "Aprove o login no app do celular." })];
    montar(h(PedidoDeAcessoPelaUrl));
    expect(await screen.findByText("Aprove o login no app do celular.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Já fiz" }));
    await waitFor(() => expect(banco.rpc).toHaveBeenCalledWith("pedido_acesso_marcar_feito", { p_pedido: "p1" }));
  });

  it("pedido já respondido não mostra formulário", async () => {
    banco.tabelas.pedidos_de_acesso = [pedido({ status: "respondido" })];
    montar(h(PedidoDeAcessoPelaUrl));
    expect(await screen.findByText("Este pedido já foi resolvido.")).toBeTruthy();
    expect(screen.queryByLabelText("Senha")).toBeNull();
  });
});

describe("lista de pedidos em 'Precisa de você'", () => {
  it("sem pedido aberto não desenha nada", async () => {
    banco.tabelas.pedidos_de_acesso = [pedido({ status: "respondido" }), pedido({ id: "p2", expira_em: "2000-01-01T00:00:00Z" })];
    const { container } = montar(h(PedidosDeAcesso), "/execucao");
    await act(async () => {});
    expect(container.querySelector("[data-pedidos-de-acesso]")).toBeNull();
  });

  it("com pedidos mostra agente, site e tipo; tocar abre ?acesso=<id>", async () => {
    banco.tabelas.pedidos_de_acesso = [pedido({}), pedido({ id: "p2", tipo: "codigo", site: "Registro.br" })];
    montar(h(PedidosDeAcesso), "/execucao?aba=decisoes");
    const linha = await screen.findByRole("button", { name: "Hermes precisa de você em Registro.br: Pede código" });
    expect(screen.getByRole("button", { name: "Hermes precisa de você em Hostinger: Pede senha" })).toBeTruthy();
    fireEvent.click(linha);
    expect(screen.getByTestId("onde").textContent).toBe("/execucao?aba=decisoes&acesso=p2");
  });
});

describe("cofre: agentes podem usar", () => {
  const item = { id: "v1", client_id: CLIENTE, category: "password", title: "Hostinger", url: null, username: "a", password: "b", notes: null, icon_url: null, created_at: "2026-10-17", agentes_podem_usar: false };

  it("admin liga o selo pela RPC", async () => {
    banco.tabelas.client_vault = [item];
    montar(h(ClientVault, { clientId: CLIENTE, canManage: true }), "/cofre");
    const botao = await screen.findByRole("button", { name: "Agentes podem usar Hostinger" });
    expect(botao.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(botao);
    await waitFor(() => expect(banco.rpc).toHaveBeenCalledWith("cofre_agentes_podem_usar", { p_item: "v1", p_pode: true }));
  });

  it("item com o selo mostra o robô; design não vê o interruptor", async () => {
    banco.papel = "design";
    banco.tabelas.client_vault = [{ ...item, agentes_podem_usar: true }];
    montar(h(ClientVault, { clientId: CLIENTE, canManage: true }), "/cofre");
    expect(await screen.findByRole("img", { name: "Os agentes podem usar este acesso" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agentes podem usar Hostinger" })).toBeNull();
  });
});
