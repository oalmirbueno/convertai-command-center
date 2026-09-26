import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pedido do dono (26/09): "tem essas bolinhas flutuantes, a de ajuda e a
 * outra. Organize e coloque tudo dentro de um só clique. Para o cliente só a
 * interrogação. Sem cobrir as coisas. O Aceleriq (o agente) com os clientes
 * disponíveis para selecionar e o serviço para selecionar também."
 *
 * 1. Um lançador só: a equipe vê agente, ajuda, tour e atalhos; o cliente só a ajuda.
 * 2. O agente manda cliente e serviço no pré-contexto.
 * 3. Nada flutua sobre o conteúdo: o lançador mora na barra do topo (768 px para cima) e na
 *    barra de baixo (celular). Rodada 2: a detecção "o que está embaixo" não pegava conteúdo
 *    que passa depois nas regiões que rolam por dentro (Kanban, Dashboard).
 * 4. O agente continua com tudo o que fazia (voz, anexos, IA, confirmação, desfazer).
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const CLIENTE = "11111111-2222-3333-4444-555555555555";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "order", "limit", "match", "insert", "update", "delete"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ upload: vi.fn() }) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, profile: { id: "admin-1", role: "admin", full_name: "Almir" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import Lancador, { MENU_DO_LANCADOR, varianteAtiva } from "@/components/lancador/Lancador";
import VoiceAssistant, { CLASSES_DO_PAINEL_DO_AGENTE } from "@/components/admin/VoiceAssistant";
import {
  clienteDaRota,
  ehAtalhoDoAgente,
  enderecoDoNovoContrato,
  opcoesDoLancador,
  preContextoDoAgente,
  servicosParaEscolha,
  SERVICOS_DO_AGENTE,
} from "@/lib/lancador";

/** Simula a largura: `largo` = 768 px para cima (barra do topo). */
function largura(largo: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*768px/.test(query) ? largo : false,
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.clearAllMocks();
  largura(true);
  mock.tabelas = {
    user_roles: [{ user_id: CLIENTE }],
    profiles: [{ id: CLIENTE, company_name: "Mirante", full_name: "Ana", email: "ana@mirante.test", services_config: { trafego: true, internal_company: true } }],
    projects: [],
  };
  mock.invoke.mockImplementation(async (_nome: string, { body }: { body: Record<string, unknown> }) => {
    if (body.fetchOnly) return { data: { documents: [] }, error: null };
    if (body.modo === "conversa") return { data: { resposta: "Mirante contratou tráfego. Nada atrasado.", passos: [] }, error: null };
    return { data: { intent: { kind: "unknown", raw: "" }, narrative: "Entendi o pedido.", confidence: 0.6, suggestedClientIds: [] }, error: null };
  });
});

describe("lançador único: opções certas para cada papel", () => {
  it("a equipe com o agente vê agente, ajuda, tour e atalhos; o cliente só ajuda e tour", () => {
    expect(opcoesDoLancador("equipe", { podeUsarAgente: true }).map((o) => o.chave)).toEqual(["agente", "ajuda", "tour", "atalhos"]);
    expect(opcoesDoLancador("equipe", { podeUsarAgente: false }).map((o) => o.chave)).toEqual(["ajuda", "tour", "atalhos"]);
    expect(opcoesDoLancador("cliente", { podeUsarAgente: true }).map((o) => o.chave)).toEqual(["ajuda", "tour"]);
  });

  it("equipe: um clique abre o menu com as opções e o agente abre por ele e pelo Alt+A", () => {
    const abrir = vi.fn();
    render(h(Lancador, {
      variante: "topo", papel: "equipe", podeUsarAgente: true, onAbrirAgente: abrir,
      passosDaTela: [{ title: "Filtre", description: "Use os filtros do topo." }], rotuloDaTela: "Projetos",
      onTourDaTela: vi.fn(), onTourCompleto: vi.fn(),
    }));
    // Um botão só no canto.
    expect(document.querySelectorAll("[data-botao-do-lancador]").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Aceleriq e ajuda" }));
    const itens = screen.getAllByRole("menuitem").map((b) => b.getAttribute("data-opcao"));
    expect(itens).toEqual(["agente", "ajuda", "tour", "atalhos"]);
    expect(screen.getByText("Aceleriq (voz e IA)")).toBeTruthy();
    expect(screen.getByText("Ajuda: como fazer nesta tela")).toBeTruthy();
    fireEvent.click(screen.getByText("Aceleriq (voz e IA)"));
    expect(abrir).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "a", code: "KeyA", altKey: true });
    expect(abrir).toHaveBeenCalledTimes(2);
  });

  it("equipe: a ajuda mostra o passo a passo da tela e o tour", () => {
    const tourDaTela = vi.fn();
    render(h(Lancador, {
      variante: "topo", papel: "equipe", podeUsarAgente: true, onAbrirAgente: vi.fn(),
      passosDaTela: [{ title: "Filtre", description: "Use os filtros do topo." }], rotuloDaTela: "Projetos",
      onTourDaTela: tourDaTela, onTourCompleto: vi.fn(),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Aceleriq e ajuda" }));
    fireEvent.click(screen.getByText("Ajuda: como fazer nesta tela"));
    expect(screen.getByText("Como fazer em Projetos")).toBeTruthy();
    expect(screen.getByText("Filtre")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar na tela" }));
    expect(tourDaTela).toHaveBeenCalled();
  });

  it("cliente: só o \"?\", que abre direto a ajuda, sem o agente", () => {
    const abrir = vi.fn();
    render(h(Lancador, {
      variante: "topo", papel: "cliente", podeUsarAgente: false, onAbrirAgente: abrir,
      passosDaTela: null, onTourDaTela: null, onTourCompleto: vi.fn(),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Ajuda: como fazer" }));
    expect(screen.getByText("Como fazer nesta tela")).toBeTruthy();
    expect(screen.queryByText("Aceleriq (voz e IA)")).toBeNull();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    fireEvent.keyDown(window, { key: "a", code: "KeyA", altKey: true });
    expect(abrir).not.toHaveBeenCalled();
  });

  it("no celular vira item da barra de baixo; o menu abre logo acima da barra; o teclado vale só na variante da largura", () => {
    largura(false);
    const abrirTopo = vi.fn();
    const abrirBarra = vi.fn();
    const props = { papel: "equipe" as const, podeUsarAgente: true, passosDaTela: null, onTourDaTela: null, onTourCompleto: vi.fn() };
    render(h("div", null,
      h(Lancador, { ...props, variante: "topo", onAbrirAgente: abrirTopo }),
      h("nav", null, h(Lancador, { ...props, variante: "barra", onAbrirAgente: abrirBarra })),
    ));
    expect(varianteAtiva("barra")).toBe(true);
    expect(varianteAtiva("topo")).toBe(false);
    fireEvent.keyDown(window, { key: "a", code: "KeyA", altKey: true });
    expect(abrirBarra).toHaveBeenCalledTimes(1);
    expect(abrirTopo).not.toHaveBeenCalled();
    const barra = document.querySelector('[data-variante="barra"]')!;
    expect(barra.textContent).toContain("Aceleriq");
    fireEvent.click(barra.querySelector("[data-botao-do-lancador]")!);
    const menu = barra.querySelector("[data-menu-do-lancador]")!;
    expect(menu.className).toContain("bottom-full");
    expect(menu.className).not.toMatch(/(^|\s)fixed(\s|$)/);
  });
});

describe("nada flutua sobre o conteúdo", () => {
  it("o lançador não é fixo na tela: o menu abre preso à barra (topo para baixo, barra de baixo para cima)", () => {
    const fonte = ler("src/components/lancador/Lancador.tsx");
    expect(fonte).not.toMatch(/className=\{?["`][^"`]*\bfixed\b/);
    expect(fonte).not.toContain("elementsFromPoint");
    expect(MENU_DO_LANCADOR.topo).toContain("top-full");
    expect(MENU_DO_LANCADOR.barra).toContain("bottom-full");
    for (const v of Object.values(MENU_DO_LANCADOR)) expect(v).not.toMatch(/(^|\s)fixed(\s|$)/);
  });

  it("o AppLayout põe o lançador na barra do topo (768 px para cima) e na barra de baixo; nada no canto flutuante", () => {
    const layout = ler("src/components/AppLayout.tsx");
    expect(layout).toContain('<Lancador variante="topo" className="hidden md:block" {...propsDoLancador} />');
    expect(layout).toContain('lancador={<Lancador variante="barra" {...propsDoLancador} />}');
    const flutuante = layout.slice(layout.indexOf('<div data-casca="flutuante">'));
    expect(flutuante).not.toContain("<Lancador");
    expect(layout).toContain('papel: (isAdminOrTeam ? "equipe" : "cliente")');
    const barra = ler("src/components/MobileBottomNav.tsx");
    expect(barra).toContain("{lancador}");
    expect(barra).toContain("md:hidden");
  });

  it("barra do topo de 768 a 1023: ordem e prioridade (avatar sempre; tema e links extras vão para os menus)", () => {
    const layout = ler("src/components/AppLayout.tsx");
    const inicio = layout.indexOf("{/* Right: Icons */}");
    const direita = layout.slice(inicio, layout.indexOf("{/* Mobile menu button */}", inicio));
    // Ordem da direita: indicador de gerações, busca (ícone), lançador, tema, sino, avatar.
    const ordem = ["<IndicadorDeGeracoes", 'aria-label="Buscar página', '<Lancador variante="topo"', 'data-prioridade-no-topo="tema"', 'data-tour="nav-notifications"', 'aria-label="Menu do perfil"'];
    const posicoes = ordem.map((t) => direita.indexOf(t));
    posicoes.forEach((p) => expect(p).toBeGreaterThan(-1));
    expect([...posicoes].sort((x, y) => x - y)).toEqual(posicoes);
    // O tema some da barra só de 768 a 1023 e aparece no menu do perfil nessa faixa.
    expect(direita).toContain('className="w-8 h-8 flex md:hidden lg:flex');
    expect(direita).toContain('className="hidden md:flex lg:hidden items-center');
    // Avatar nunca some.
    const avatar = direita.slice(direita.indexOf('data-tour="nav-user"') - 60, direita.indexOf('aria-label="Menu do perfil"'));
    expect(avatar).not.toMatch(/hidden/);
    // Links: 3 na faixa estreita, o resto no "..." (só nessa faixa).
    expect(layout).toContain("const LINKS_NO_TOPO_ESTREITO = 3;");
    expect(layout).toContain('indice >= LINKS_NO_TOPO_ESTREITO && "hidden lg:block"');
    expect(layout).toContain('className="mb-1 border-b border-border pb-1 lg:hidden" data-links-que-nao-couberam=""');
    expect(layout).toContain("whitespace-nowrap px-2 lg:px-3");
    expect(layout).toContain('<div className="hidden md:flex min-w-0 items-center gap-1 flex-1 justify-center">');
  });

  it("o AppLayout tem um lançador só: sem a bolinha da ajuda e sem a bolinha do agente", () => {
    const layout = ler("src/components/AppLayout.tsx");
    expect(layout).not.toContain("HelpButton");
    expect(layout).toContain("<VoiceAssistant aberto={agenteAberto} onAbertoChange={setAgenteAberto}");
    expect(layout).toContain('<div data-casca="flutuante">');
    const agente = ler("src/components/admin/VoiceAssistant.tsx");
    // A bolinha antiga do agente (canto esquerdo, pulsando) saiu.
    expect(agente).not.toContain("fixed left-4");
    expect(agente).not.toContain("animate-ping");
  });

  it("painel do agente: tela cheia no celular, coluna à direita no computador, abaixo da barra do topo", () => {
    expect(CLASSES_DO_PAINEL_DO_AGENTE).toContain("fixed inset-0");
    expect(CLASSES_DO_PAINEL_DO_AGENTE).toContain("md:w-[420px]");
    expect(CLASSES_DO_PAINEL_DO_AGENTE).toContain("md:top-[calc(env(safe-area-inset-top)+76px)]");
    expect(CLASSES_DO_PAINEL_DO_AGENTE).toContain("pb-[env(safe-area-inset-bottom)]");
  });
});

describe("pré-contexto do agente", () => {
  it("cliente da tela vem do ?client= ou de /clientes/<id>; serviço contratado vem primeiro; financeiro não é serviço do agente", () => {
    expect(clienteDaRota("/mesa", `?client=${CLIENTE}&aba=mes`)).toBe(CLIENTE);
    expect(clienteDaRota(`/clientes/${CLIENTE}`, "")).toBe(CLIENTE);
    expect(clienteDaRota("/mesa", "?client=nao-e-id")).toBeNull();
    const lista = servicosParaEscolha({ trafego: true, internal_company: true });
    expect(lista[0].chave).toBe("geral");
    expect(lista[1]).toMatchObject({ chave: "trafego", contratado: true });
    expect(SERVICOS_DO_AGENTE.map((s) => s.chave)).not.toContain("financeiro");
    expect(SERVICOS_DO_AGENTE.map((s) => s.chave)).toContain("contrato");
    expect(preContextoDoAgente({ clienteId: CLIENTE, servico: "trafego", tela: "/mesa" })).toMatchObject({ clientId: CLIENTE, servico: "trafego", servicoRotulo: "Tráfego" });
    expect(preContextoDoAgente({ clienteId: null, servico: "inventado", tela: "/" }).servico).toBe("geral");
    expect(enderecoDoNovoContrato(CLIENTE)).toBe(`/contratos?novo=1&client=${CLIENTE}`);
    expect(ehAtalhoDoAgente({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: "å", code: "KeyA", target: null })).toBe(true);
  });

  const montarAgente = (rota: string, onAbertoChange = vi.fn()) =>
    render(h(MemoryRouter, { initialEntries: [rota] }, h(VoiceAssistant, { aberto: true, onAbertoChange })));

  it("abre com o cliente da tela escolhido, sem gastar IA; a análise leva cliente, serviço e tela", async () => {
    montarAgente(`/mesa?client=${CLIENTE}`);
    await waitFor(() => expect(document.querySelector("[data-seletor-cliente]")!.textContent).toContain("Mirante"));
    // Só a leitura dos documentos (sem IA) aconteceu ao abrir.
    await waitFor(() => expect(mock.invoke).toHaveBeenCalled());
    expect(mock.invoke.mock.calls.every(([, o]) => (o as { body: Record<string, unknown> }).body.fetchOnly === true)).toBe(true);

    // Serviço: Tráfego (o contratado aparece marcado).
    fireEvent.click(document.querySelector("[data-seletor-servico] button")!);
    const trafego = document.querySelector('[data-servico="trafego"]') as HTMLElement;
    expect(trafego.textContent).toContain("contratado");
    fireEvent.click(trafego);
    expect(document.querySelector("[data-seletor-servico]")!.textContent).toContain("Tráfego");

    fireEvent.change(screen.getByLabelText("Pedido para o Aceleriq"), { target: { value: "organizar as campanhas do mês" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Analisar/ }));
    });
    const analise = mock.invoke.mock.calls.map(([, o]) => (o as { body: Record<string, unknown> }).body).find((b) => !b.fetchOnly && !b.modo);
    expect(analise).toMatchObject({ clientId: CLIENTE, servico: "trafego", tela: "/mesa", text: "organizar as campanhas do mês" });
  });

  it("atalho Resumo do cliente pergunta no modo conversa com o pré-contexto e mostra a resposta", async () => {
    montarAgente(`/clientes/${CLIENTE}`);
    await waitFor(() => expect(document.querySelector("[data-seletor-cliente]")!.textContent).toContain("Mirante"));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-atalho="resumo"]')!);
    });
    const conversa = mock.invoke.mock.calls.map(([, o]) => (o as { body: Record<string, unknown> }).body).find((b) => b.modo === "conversa");
    expect(conversa).toMatchObject({ pergunta: "resumo", clientId: CLIENTE, servico: "geral" });
    await waitFor(() => expect(screen.getByText("Mirante contratou tráfego. Nada atrasado.")).toBeTruthy());
  });

  it("sem cliente, os atalhos que precisam dele ficam apagados; Novo contrato continua", async () => {
    montarAgente("/dashboard");
    await waitFor(() => expect(document.querySelector("[data-atalhos-do-agente]")).toBeTruthy());
    expect((document.querySelector('[data-atalho="resumo"]') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('[data-atalho="novo_contrato"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("Esc fecha o agente; o microfone mostra o estado", async () => {
    const fechar = vi.fn();
    montarAgente("/dashboard", fechar);
    expect(document.querySelector("[data-microfone]")!.getAttribute("data-microfone")).toBe("parado");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(fechar).toHaveBeenCalledWith(false);
  });
});

describe("o agente continua com tudo o que fazia", () => {
  const agente = ler("src/components/admin/VoiceAssistant.tsx");
  const servidor = ler("supabase/functions/voice-assistant-agent/index.ts");

  it("voz, anexos, leitura de contratos, IA, confirmação, desfazer e registro seguem no mesmo componente", () => {
    for (const trecho of [
      "startListening(\"command\")",
      "startListening(\"refine\")",
      "handleAttach(dropped)",
      "fetchOnly: true",
      "skipSystemContractAutoLoad",
      "isForbiddenRequest",
      "stageCreateChecklists",
      "undoLastAction",
      "voice_command_log",
      "learnFromEdit",
      "execReportPending",
      "execUploadFile",
      "Reanalisar com ajuste",
      "file_url: `files://${path}`",
    ]) expect(agente).toContain(trecho);
    // Confirmação no padrão dos agentes (Confirmar, Cancelar, Desfazer).
    expect(agente).toContain("<CartaoDeAcao acao={acaoAberta} onPedido={onPedidoDaAcao}");
  });

  it("o servidor junta o pré-contexto (dossiê e memória pela leitura que já existe) e responde no modo conversa", () => {
    expect(servidor).toContain('import { contextoParaAgente, type AreaDoCerebro } from "../_shared/cerebro-do-cliente.ts";');
    expect(servidor).toContain('if (body.modo === "conversa")');
    expect(servidor).toContain("lerPreContexto(supabase, body.clientId || null, servico, tela)");
    expect(servidor).toContain("preContexto +");
    // Financeiro não entra como serviço (jurisdição proibida do agente).
    expect(servidor).not.toMatch(/\bfinanceiro: \{ rotulo/);
    // Chave só no servidor e acesso checado antes de ler o cliente.
    expect(servidor).toContain('caller.rpc(\n        "can_access_client"');
  });
});
