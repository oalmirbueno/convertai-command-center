import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RadarIdea } from "@/lib/radarIdeas";

/**
 * Radar de ideias da Central (16/10/2026): chips de cliente filtram, carrossel
 * com setas e indicador, "Levar ao cliente", e a conversa para evoluir a ideia
 * (edge function radar-ideas com action "evoluir", aqui mockada).
 */

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

import RadarDeIdeias, { ideiaDoServidor, ideiaParaServidor, reelsDoServidor, variacoesDoServidor } from "@/components/central/RadarDeIdeias";

function ideia(id: string, titulo: string, extra: Partial<RadarIdea> = {}): RadarIdea {
  return {
    id,
    lens: "essencia",
    title: titulo,
    pitch: `Descrição de ${titulo}`,
    moment: "",
    whyNow: `Por que agora ${titulo}`,
    moves: ["Passo um", "Passo dois"],
    signal: `Sinal de ${titulo}`,
    internal: { offer: "Série de vídeos", range: [1200, 2400], effort: "medio" },
    score: 80,
    ...extra,
  };
}

const IDEIAS: RadarIdea[] = [
  ideia("a:bastidor", "Alfa Peças: mostrar o processo"),
  ideia("b:duvida", "Beta Loja: responder a dúvida"),
  ideia("a:prova", "Alfa Peças: resultado em prova", { lens: "prova" }),
];

const CLIENTES = [
  { id: "a", nome: "Alfa Peças", foto: null },
  { id: "b", nome: "Beta Loja", foto: null },
];

function montar(extra: Partial<Parameters<typeof RadarDeIdeias>[0]> = {}) {
  const props = {
    ideias: IDEIAS,
    clientes: CLIENTES,
    imagensPorCliente: { a: ["https://img.exemplo/a1.jpg"] },
    controles: <button type="button">Gerar ideias com IA</button>,
    onLevarAoCliente: vi.fn(),
    onAbrirPerfil: vi.fn(),
    onIdeiaEvoluida: vi.fn(),
    onNovasIdeias: vi.fn(),
    ...extra,
  };
  const tela = render(<RadarDeIdeias {...props} />);
  return { ...tela, props };
}

const cartoes = () => Array.from(document.querySelectorAll("[data-ideia]")) as HTMLElement[];
const indicador = () => (document.querySelector("[data-indicador]") as HTMLElement).textContent || "";

beforeEach(() => invoke.mockReset());

describe("Radar de ideias", () => {
  it("mostra um cartão por ideia, título sem o nome do cliente, capa com imagem real quando há", () => {
    montar();
    expect(cartoes()).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "mostrar o processo" })).toBeInTheDocument();
    expect(screen.getByText("Gerar ideias com IA")).toBeInTheDocument();
    const [primeiro, segundo] = cartoes();
    expect(primeiro.querySelector("[data-capa]")?.getAttribute("data-capa")).toBe("imagem");
    expect(segundo.querySelector("[data-capa]")?.getAttribute("data-capa")).toBe("gradiente");
    // Leitura interna recolhida em "Só a equipe".
    expect(within(primeiro).getByText("Só a equipe").closest("details")).not.toHaveAttribute("open");
  });

  it("os chips filtram por cliente e Todos volta", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Beta Loja, 1 ideia" }));
    expect(cartoes().map((c) => c.getAttribute("data-ideia"))).toEqual(["b:duvida"]);
    expect(screen.getByRole("button", { name: "Beta Loja, 1 ideia" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Alfa Peças, 2 ideias" }));
    expect(cartoes().map((c) => c.getAttribute("data-ideia"))).toEqual(["a:bastidor", "a:prova"]);

    fireEvent.click(screen.getByRole("button", { name: /^Todos/ }));
    expect(cartoes()).toHaveLength(3);
  });

  it("as setas e os pontos andam no carrossel e o indicador acompanha", () => {
    montar();
    expect(indicador()).toContain("1 de 3");
    expect(screen.getByRole("button", { name: "Ideia anterior" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Próxima ideia" }));
    expect(indicador()).toContain("2 de 3");
    expect(screen.getByRole("button", { name: "Ir para a ideia 2" })).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("button", { name: "Ir para a ideia 3" }));
    expect(indicador()).toContain("3 de 3");
    expect(screen.getByRole("button", { name: "Próxima ideia" })).toBeDisabled();

    // Teclado no carrossel.
    fireEvent.keyDown(screen.getByRole("region", { name: "Ideias do radar" }), { key: "ArrowLeft" });
    expect(indicador()).toContain("2 de 3");

    // Trocar de cliente volta para o primeiro cartão.
    fireEvent.click(screen.getByRole("button", { name: "Alfa Peças, 2 ideias" }));
    expect(indicador()).toContain("1 de 2");
  });

  it("Levar ao cliente e o perfil passam a ideia e o cliente certos", () => {
    const { props } = montar();
    const segundo = cartoes()[1];
    fireEvent.click(within(segundo).getByRole("button", { name: /Levar ao cliente/ }));
    expect(props.onLevarAoCliente).toHaveBeenCalledWith(IDEIAS[1]);
    fireEvent.click(within(segundo).getByRole("button", { name: "Ver perfil de Beta Loja" }));
    expect(props.onAbrirPerfil).toHaveBeenCalledWith("b");
  });

  it("Por que agora e Sinal abrem recolhidos no cartão", () => {
    montar();
    const primeiro = cartoes()[0];
    expect(within(primeiro).queryByText("Sinal de Alfa Peças: mostrar o processo")).not.toBeInTheDocument();
    fireEvent.click(within(primeiro).getByRole("button", { name: /Sinal/ }));
    expect(within(primeiro).getByText("Sinal de Alfa Peças: mostrar o processo")).toBeInTheDocument();
    fireEvent.click(within(primeiro).getByRole("button", { name: /Por que agora/ }));
    expect(within(primeiro).getByText("Por que agora Alfa Peças: mostrar o processo")).toBeInTheDocument();
  });

  it("a conversa evolui a ideia com o agente e aplica a versão nova", async () => {
    invoke.mockResolvedValue({
      data: {
        resposta: "Deixei a ideia em vídeo curto.",
        ideia: {
          titulo: "o processo em vídeo curto",
          descricao: "Série de Reels mostrando o processo.",
          por_que_agora: "O vídeo curto é o que mais entrega agora.",
          passos: ["Gravar na oficina", "Editar 4 Reels", "Publicar em duas semanas"],
          sinal: "Salvamentos",
          interno_oferta: "Série de 4 Reels",
          interno_faixa_min: 1500,
          interno_faixa_max: 2800,
          interno_esforco: "alto",
        },
      },
      error: null,
    });
    const { props } = montar();
    fireEvent.click(within(cartoes()[0]).getByRole("button", { name: "Evoluir com o agente" }));

    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Ideia atual")).toBeInTheDocument();
    expect(within(janela).getByText("mostrar o processo")).toBeInTheDocument();
    const aplicar = within(janela).getByRole("button", { name: /Aplicar esta versão/ });
    expect(aplicar).toBeDisabled();

    fireEvent.change(within(janela).getByLabelText("Mensagem para o agente"), { target: { value: "Faz em vídeo" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Enviar" }));

    expect(await within(janela).findByText("Deixei a ideia em vídeo curto.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
    const [nome, opcoes] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(nome).toBe("radar-ideas");
    expect(opcoes.body.action).toBe("evoluir");
    expect(opcoes.body.client_id).toBe("a");
    expect((opcoes.body.ideia as { titulo: string }).titulo).toBe("mostrar o processo");
    expect(opcoes.body.mensagens).toEqual([{ papel: "usuario", texto: "Faz em vídeo" }]);

    expect(within(janela).getByText("Nova versão")).toBeInTheDocument();
    expect(within(janela).getByText("o processo em vídeo curto")).toBeInTheDocument();
    await waitFor(() => expect(aplicar).not.toBeDisabled());
    fireEvent.click(aplicar);

    expect(props.onIdeiaEvoluida).toHaveBeenCalledTimes(1);
    const [antiga, nova] = props.onIdeiaEvoluida.mock.calls[0] as [RadarIdea, RadarIdea];
    expect(antiga).toBe(IDEIAS[0]);
    expect(nova.id).toBe("a:bastidor");
    expect(nova.title).toBe("Alfa Peças: o processo em vídeo curto");
    expect(nova.pitch).toBe("Série de Reels mostrando o processo.");
    expect(nova.moves).toEqual(["Gravar na oficina", "Editar 4 Reels", "Publicar em duas semanas"]);
    expect(nova.internal).toEqual({ offer: "Série de 4 Reels", range: [1500, 2800], effort: "alto" });
    expect(nova.source).toBe("ia");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("erro do agente aparece na conversa e não aplica nada", async () => {
    invoke.mockResolvedValue({ data: { error: "O agente do Radar não respondeu (502)." }, error: null });
    montar();
    fireEvent.click(within(cartoes()[1]).getByRole("button", { name: "Evoluir com o agente" }));
    const janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("button", { name: "Mais ousada" }));
    expect(await within(janela).findByRole("alert")).toHaveTextContent("O agente do Radar não respondeu (502).");
    expect(within(janela).getByRole("button", { name: /Aplicar esta versão/ })).toBeDisabled();
  });

  it("tela cheia liga e desliga o modo foco do painel (botão, Esc e ao sair da aba)", () => {
    const { unmount } = montar();
    expect(document.body.hasAttribute("data-modo-foco")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(document.body.getAttribute("data-modo-foco")).toBe("radar-de-ideias");
    const sair = screen.getByRole("button", { name: "Sair da tela cheia" });
    expect(sair).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(sair);
    expect(document.body.hasAttribute("data-modo-foco")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.hasAttribute("data-modo-foco")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(document.body.getAttribute("data-modo-foco")).toBe("radar-de-ideias");
    unmount();
    expect(document.body.hasAttribute("data-modo-foco")).toBe(false);
  });

  it("tocar no cartão abre a ideia grande com tudo dela e os dois atalhos", async () => {
    montar();
    fireEvent.click(cartoes()[0]);
    const janela = await screen.findByRole("dialog");
    expect(janela).toHaveAttribute("data-ideia-aberta");
    expect(within(janela).getByText("Ideia atual")).toBeInTheDocument();
    expect(within(janela).getByText("mostrar o processo")).toBeInTheDocument();
    expect(within(janela).getByText("Descrição de Alfa Peças: mostrar o processo")).toBeInTheDocument();
    expect(within(janela).getByText("Sinal de Alfa Peças: mostrar o processo")).toBeInTheDocument();
    expect(within(janela).getByRole("button", { name: /Mais ideias como esta/ })).toBeInTheDocument();
    expect(within(janela).getByRole("button", { name: /Ideias de Reels/ })).toBeInTheDocument();
    expect(within(janela).getByLabelText("Mensagem para o agente")).toBeInTheDocument();
    // Os controles do cartão continuam fazendo só o deles.
    fireEvent.click(within(janela).getAllByRole("button", { name: "Fechar" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(within(cartoes()[1]).getByRole("button", { name: /Sinal/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Mais ideias como esta pede variações e o + põe a variação no radar", async () => {
    invoke.mockResolvedValue({
      data: {
        resposta: "Três ângulos diferentes.",
        ideia: ideiaParaServidor(IDEIAS[0], "Alfa Peças"),
        variacoes: [
          { titulo: "bastidor ao vivo", descricao: "Live curta na oficina.", passos: ["Marcar a live"], interno_esforco: "baixo" },
          { titulo: "antes e depois", descricao: "Carrossel de antes e depois." },
          { titulo: "", descricao: "sem título, fica de fora" },
        ],
      },
      error: null,
    });
    const { props } = montar();
    fireEvent.click(cartoes()[0]);
    const janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("button", { name: /Mais ideias como esta/ }));

    expect(await within(janela).findByText("Três ângulos diferentes.")).toBeInTheDocument();
    const [, opcoes] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(opcoes.body.action).toBe("evoluir");
    expect(opcoes.body.pedido).toBe("variacoes");
    expect(opcoes.body.mensagens).toEqual([{ papel: "usuario", texto: "Mais ideias como esta" }]);
    expect(within(janela).getByText("bastidor ao vivo")).toBeInTheDocument();
    expect(within(janela).getByText("antes e depois")).toBeInTheDocument();
    expect(within(janela).queryByText("sem título, fica de fora")).not.toBeInTheDocument();
    // Pedido não reescreve a ideia: nada para aplicar.
    expect(within(janela).getByText("Ideia atual")).toBeInTheDocument();
    expect(within(janela).getByRole("button", { name: /Aplicar esta versão/ })).toBeDisabled();

    fireEvent.click(within(janela).getByRole("button", { name: "Adicionar ao radar: bastidor ao vivo" }));
    expect(props.onNovasIdeias).toHaveBeenCalledTimes(1);
    const [clienteId, novas] = props.onNovasIdeias.mock.calls[0] as [string, RadarIdea[]];
    expect(clienteId).toBe("a");
    expect(novas).toHaveLength(1);
    expect(novas[0].id).toMatch(/^a:var-\d+-0$/);
    expect(novas[0].title).toBe("Alfa Peças: bastidor ao vivo");
    expect(novas[0].pitch).toBe("Live curta na oficina.");
    expect(novas[0].internal.effort).toBe("baixo");
    expect(novas[0].lens).toBe("essencia");
    expect(within(janela).getByRole("button", { name: "bastidor ao vivo já está no radar" })).toBeDisabled();
  });

  it("Ideias de Reels pede Reels e mostra gancho, cena e legenda na conversa", async () => {
    invoke.mockResolvedValue({
      data: {
        resposta: "Reels curtos na oficina.",
        ideia: ideiaParaServidor(IDEIAS[1], "Beta Loja"),
        reels: [
          { gancho: "Você sabia que...", cena: "Mão abrindo a peça", legenda: "O detalhe que ninguém vê." },
          { gancho: "Sem cena", cena: "" },
        ],
      },
      error: null,
    });
    montar();
    fireEvent.click(cartoes()[1]);
    const janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("button", { name: /Ideias de Reels/ }));
    expect(await within(janela).findByText("Reels curtos na oficina.")).toBeInTheDocument();
    const [, opcoes] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(opcoes.body.pedido).toBe("reels");
    expect(opcoes.body.client_id).toBe("b");
    const lista = within(janela).getByRole("list", { name: "Ideias de Reels" });
    expect(within(lista).getByText("Você sabia que...")).toBeInTheDocument();
    expect(within(lista).getByText("Mão abrindo a peça")).toBeInTheDocument();
    expect(within(lista).getByText("O detalhe que ninguém vê.")).toBeInTheDocument();
    expect(within(lista).queryByText("Sem cena")).not.toBeInTheDocument();
  });

  it("variacoesDoServidor e reelsDoServidor limitam a 3 e 4", () => {
    const brutas = Array.from({ length: 5 }, (_, i) => ({ titulo: `v${i}`, descricao: `d${i}` }));
    const v = variacoesDoServidor(brutas, IDEIAS[0], "Alfa Peças", 7);
    expect(v.map((x) => x.id)).toEqual(["a:var-7-0", "a:var-7-1", "a:var-7-2"]);
    expect(variacoesDoServidor("x", IDEIAS[0])).toEqual([]);
    const r = reelsDoServidor(Array.from({ length: 6 }, (_, i) => ({ gancho: `g${i}`, cena: `c${i}` })));
    expect(r).toHaveLength(4);
    expect(r[0]).toEqual({ gancho: "g0", cena: "c0", legenda: "" });
  });

  it("sem ideias, o estado vazio com os controles", () => {
    montar({ ideias: [] });
    expect(screen.getByText("Nenhuma ideia no radar agora.")).toBeInTheDocument();
    expect(screen.getByText("Gerar ideias com IA")).toBeInTheDocument();
  });

  it("conversão de ida e volta com o servidor preserva id, lente e o prefixo do cliente", () => {
    const base = IDEIAS[2];
    const ida = ideiaParaServidor(base, "Alfa Peças");
    expect(ida.titulo).toBe("resultado em prova");
    expect(ida.interno_faixa_min).toBe(1200);
    const volta = ideiaDoServidor({ ...ida, descricao: "Nova" }, base, "Alfa Peças");
    expect(volta?.id).toBe("a:prova");
    expect(volta?.lens).toBe("prova");
    expect(volta?.title).toBe("Alfa Peças: resultado em prova");
    expect(ideiaDoServidor({ titulo: "x" }, base, "Alfa Peças")).toBeNull();
  });
});
