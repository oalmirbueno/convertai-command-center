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

import RadarDeIdeias, { ideiaDoServidor, ideiaParaServidor } from "@/components/central/RadarDeIdeias";

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
