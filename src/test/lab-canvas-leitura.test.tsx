import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { LEITURA_PADRAO, OPACIDADE_DAS_LIGACOES, caminhoArredondado, lerLeituraDoQuadro, mostrarLigacao, rotaSemCartoes } from "@/components/laboratorio/no/visualDoQuadro";
import { OpcoesDeLeitura } from "@/components/laboratorio/no/ControlesDoQuadro";
import CamposDoNo, { camposPrincipais } from "@/components/laboratorio/CamposDoNo";
import type { ModeloIa } from "@/lib/mesa/api";

vi.mock("@/lib/mesa/api", async (original) => ({ ...(await original<typeof import("@/lib/mesa/api")>()), lerCatalogo: async () => [] }));

describe("Canvas: conexões discretas e leitura sem alterar o fluxo", () => {
  it("abre com linhas discretas e trata preferências inválidas sem quebrar o canvas", () => {
    expect(lerLeituraDoQuadro(null)).toEqual(LEITURA_PADRAO);
    expect(lerLeituraDoQuadro("{ quebrado")).toEqual(LEITURA_PADRAO);
    expect(lerLeituraDoQuadro('{"foco":"apagar_tudo","intensidade":999}')).toEqual(LEITURA_PADRAO);
    expect(OPACIDADE_DAS_LIGACOES.suave).toBeLessThan(OPACIDADE_DAS_LIGACOES.discreta);
    expect(OPACIDADE_DAS_LIGACOES.discreta).toBeLessThan(0.3);
  });

  it("foco mostra entradas e saídas só do nó selecionado; ocultar não remove conexões", () => {
    expect(mostrarLigacao("selecionado", "copy", "copy", "pagina")).toBe(true);
    expect(mostrarLigacao("selecionado", "copy", "contexto", "copy")).toBe(true);
    expect(mostrarLigacao("selecionado", "copy", "pagina", "checkout")).toBe(false);
    expect(mostrarLigacao("selecionado", null, "copy", "pagina")).toBe(false);
    expect(mostrarLigacao("ocultas", "copy", "copy", "pagina")).toBe(false);
    expect(mostrarLigacao("todas", null, "copy", "pagina")).toBe(true);
  });

  it("controles permitem escolher transparência e foco com rótulos claros", () => {
    const mudar = vi.fn();
    render(<OpcoesDeLeitura leitura={LEITURA_PADRAO} onLeitura={mudar} temSelecao={false} />);
    fireEvent.change(screen.getByLabelText("Intensidade das linhas"), { target: { value: "suave" } });
    expect(mudar).toHaveBeenLastCalledWith({ foco: "todas", intensidade: "suave" });
    fireEvent.change(screen.getByLabelText("Conexões"), { target: { value: "selecionado" } });
    expect(mudar).toHaveBeenLastCalledWith({ foco: "selecionado", intensidade: "discreta" });
  });

  it("fio desvia de cartão entre origem e destino e conserva as pontas", () => {
    const rota = rotaSemCartoes({ x: 336, y: 180 }, { x: 1200, y: 180 }, [
      { x: 0, y: 0, largura: 336, altura: 360 },
      { x: 550, y: 70, largura: 336, altura: 300 },
      { x: 1200, y: 0, largura: 336, altura: 360 },
    ]);
    expect(rota).not.toBeNull();
    expect(rota![0]).toEqual({ x: 336, y: 180 });
    expect(rota![rota!.length - 1]).toEqual({ x: 1200, y: 180 });
    expect(rota![2].y < 52 || rota![2].y > 388).toBe(true);
    const caminho = caminhoArredondado(rota!);
    expect(caminho).toContain(" Q ");
    expect(caminho).not.toMatch(/NaN|Infinity/);
  });

  it("caminho reto não gera cantos inválidos com pontos repetidos", () => {
    expect(caminhoArredondado([{ x: 0, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 10 }, { x: 300, y: 10 }])).toBe("M 0 10 L 300 10");
    expect(rotaSemCartoes({ x: 0, y: 0 }, { x: 400, y: 0 }, [{ x: -100, y: -100, largura: 1000, altura: 1000 }])).toBeNull();
  });
});

describe("Canvas: escolha real de modelo no próprio nó", () => {
  it("seletores dos campos existentes aparecem também no nó recolhido", () => {
    expect(camposPrincipais("pagina").some((c) => c.chave === "modelo_id")).toBe(true);
    expect(camposPrincipais("ugc").filter((c) => c.tipo === "modelo" || c.tipo === "motor").map((c) => c.chave)).toEqual(["modelo_id", "motor"]);
    expect(camposPrincipais("config").some((c) => c.chave === "motor")).toBe(true);
    expect(camposPrincipais("crm").some((c) => c.tipo === "modelo")).toBe(false);
  });

  it("oferece só modelos ativos da modalidade certa e salva o id selecionado", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const modelo = (id: string, rotulo: string, tipo: "texto" | "imagem", ativo = true, disponivel = true): ModeloIa => ({ id, rotulo, tipo, ativo, disponivel, provedor: "provedor-real", modelo_api: id, preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: null });
    qc.setQueryData(["mesa", "catalogo"], [modelo("opus-real", "Opus cadastrado", "texto"), modelo("gpt-real", "GPT cadastrado", "texto"), modelo("imagem-real", "Imagem cadastrada", "imagem"), modelo("inativo", "Desligado", "texto", false), modelo("fora", "Indisponível", "texto", true, false)]);
    const mudar = vi.fn();
    render(<QueryClientProvider client={qc}><CamposDoNo no={{ id: "ugc1", tipo: "ugc", x: 0, y: 0, dados: {} }} projetoId="p" onMudarDados={mudar} lugar="no" todos={false} /></QueryClientProvider>);
    const texto = await screen.findByLabelText("Modelo");
    const imagem = screen.getByLabelText("Motor de imagem");
    expect(within(texto).getByRole("option", { name: "Opus cadastrado" })).toBeInTheDocument();
    expect(within(texto).queryByRole("option", { name: "Imagem cadastrada" })).toBeNull();
    expect(within(texto).queryByRole("option", { name: "Desligado" })).toBeNull();
    expect(within(texto).queryByRole("option", { name: "Indisponível" })).toBeNull();
    expect(within(imagem).queryByRole("option", { name: "Opus cadastrado" })).toBeNull();
    fireEvent.change(texto, { target: { value: "gpt-real" } });
    expect(mudar).toHaveBeenLastCalledWith({ modelo_id: "gpt-real" });
    fireEvent.change(imagem, { target: { value: "imagem-real" } });
    expect(mudar).toHaveBeenLastCalledWith({ motor: "imagem-real" });
  });

  it("catálogo vazio mantém o padrão em vez de inventar modelos disponíveis", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(["mesa", "catalogo"], []);
    render(<QueryClientProvider client={qc}><CamposDoNo no={{ id: "pg", tipo: "pagina", x: 0, y: 0, dados: {} }} projetoId="p" onMudarDados={() => undefined} lugar="no" todos={false} /></QueryClientProvider>);
    await waitFor(() => expect(within(screen.getByLabelText("Modelo")).getAllByRole("option")).toHaveLength(1));
    expect(within(screen.getByLabelText("Modelo")).getByRole("option").textContent).toBe("Padrão do Laboratório");
  });
});
