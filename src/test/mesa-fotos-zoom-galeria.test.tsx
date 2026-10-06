import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ImagemComZoom from "@/components/mesa/ImagemComZoom";
import GaleriaDeFotos, { type FotoNaGaleria } from "@/components/mesa-foto/GaleriaDeFotos";
import { historicoDaComposicao } from "@/components/mesa-foto/organizacaoDasFotos";
import type { FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import type { Canvas } from "@/components/mesa-foto/canvasApi";

vi.mock("@/components/mesa/MesaContexto", () => ({ ImagemDaMesa: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("@/components/mesa/Ampliar", () => ({ Ampliar: () => null }));

describe("Inspeção da foto", () => {
  it("amplia pela roda e pelos botões, move no teclado e reseta ao trocar a imagem", () => {
    const v = render(<ImagemComZoom src="/a.jpg" alt="Foto A" largura={400} altura={500} onProporcao={vi.fn()} />);
    const quadro = screen.getByRole("region");
    fireEvent.click(screen.getByRole("button", { name: "Aumentar zoom" }));
    expect(screen.getByLabelText("Nível de zoom")).toHaveTextContent("125%");
    fireEvent.wheel(quadro, { deltaY: -1, clientX: 200, clientY: 250 });
    expect(screen.getByLabelText("Nível de zoom")).toHaveTextContent("150%");
    fireEvent.keyDown(quadro, { key: "ArrowLeft" });
    expect(screen.getByAltText("Foto A").style.transform).not.toContain("translate(0px, 0px)");
    fireEvent.click(screen.getByRole("button", { name: "Ajustar imagem à janela" }));
    expect(screen.getByAltText("Foto A").style.transform).toBe("translate(0px, 0px) scale(1)");
    fireEvent.doubleClick(quadro);
    expect(screen.getByLabelText("Nível de zoom")).toHaveTextContent("200%");
    v.rerender(<ImagemComZoom src="/b.jpg" alt="Foto B" largura={400} altura={500} onProporcao={vi.fn()} />);
    expect(screen.getByLabelText("Nível de zoom")).toHaveTextContent("100%");
  });

  it("permite arrastar e usar pinça, sem sair dos limites da imagem", () => {
    const anterior = window.PointerEvent;
    window.PointerEvent = class extends MouseEvent { pointerId: number; constructor(t: string, p: PointerEventInit) { super(t, p); this.pointerId = p.pointerId || 0; } } as typeof PointerEvent;
    try {
      render(<ImagemComZoom src="/a.jpg" alt="Foto" largura={400} altura={500} onProporcao={vi.fn()} />);
      const q = screen.getByRole("region");
      fireEvent.pointerDown(q, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerDown(q, { pointerId: 2, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(q, { pointerId: 2, clientX: 300, clientY: 100 });
      expect(screen.getByLabelText("Nível de zoom")).toHaveTextContent("200%");
      fireEvent.pointerUp(q, { pointerId: 2 });
      fireEvent.pointerMove(q, { pointerId: 1, clientX: 900, clientY: 100 });
      expect(screen.getByAltText("Foto").style.transform).toBe("translate(200px, 0px) scale(2)");
    } finally { window.PointerEvent = anterior; }
  });
});

const fotos: FotoNaGaleria[] = Array.from({ length: 42 }, (_, i) => ({ id: `${i}`, caminho: `${i}.jpg`, titulo: `Foto ${i}`, grupo: i === 0 ? "Original" : "Versões", aprovada: i === 41 }));
describe("Galeria sem versões escondidas", () => {
  it("libera o palco ao recolher, mantendo seleção e acesso às versões distantes", () => {
    const selecionar = vi.fn();
    render(<GaleriaDeFotos recolhivel titulo="Versões" fotos={fotos} atualId="41" onSelecionar={selecionar} />);
    const alternar = screen.getByRole("button", { name: "Versões · 42" });
    expect(alternar).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Abrir Foto 41" })).not.toBeInTheDocument();
    fireEvent.click(alternar);
    expect(screen.getByRole("button", { name: "Abrir Foto 41" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Abrir Foto 40" }));
    expect(selecionar).toHaveBeenCalledWith("40");
    fireEvent.click(alternar);
    fireEvent.click(screen.getByRole("button", { name: "Organizar fotos" }));
    expect(screen.getByRole("textbox", { name: "Buscar nas fotos" })).toBeInTheDocument();
  });
  it("acessa a foto 42 por busca e mantém a ordem escolhida para o carrossel", () => {
    const usar = vi.fn();
    render(<GaleriaDeFotos titulo="Fotos do produto" fotos={fotos} atualId="0" onSelecionar={vi.fn()} onUsar={usar} />);
    fireEvent.click(screen.getByRole("button", { name: "Organizar fotos" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar nas fotos" }), { target: { value: "Foto 41" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Foto 41 para o post" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar nas fotos" }), { target: { value: "Foto 20" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Foto 20 para o post" }));
    fireEvent.click(screen.getByRole("button", { name: "Preparar carrossel na Agenda" }));
    expect(usar).toHaveBeenCalledWith(["41", "20"]);
  });
  it("a faixa acompanha uma versão distante e permite navegar até as anteriores", () => {
    render(<GaleriaDeFotos titulo="Fotos" fotos={fotos} atualId="41" onSelecionar={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Abrir Foto 41" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Fotos anteriores" }));
    expect(screen.getByRole("button", { name: "Abrir Foto 30" })).toBeInTheDocument();
  });
});

it("recupera a composição salva e derivados sem misturar produto, pessoa nem cliente", () => {
  const canvas = { id: "c1", client_id: "cliente", nome: "Composição · Produto", nos: [{ tipo: "produto", dados: { kit_id: "kit" } }, { tipo: "modelo", dados: { modelo_id: "modelo" } }] } as Canvas;
  const fs = [
    { id: "base", tags: ["canvas:c1"] }, { id: "versao", derivada_de: "base" },
    { id: "outra", tags: ["canvas:c2"] }, { id: "outro-cliente", tags: ["canvas:c1"], client_id: "outro" },
  ].map((f) => ({ ativa: true, client_id: "cliente", ...f })) as FotoDoAcervo[];
  expect(historicoDaComposicao(fs, [canvas], "cliente", ["kit"], { tipo: "persona", id: "modelo" }).map((f) => f.id)).toEqual(["base", "versao"]);
  expect(historicoDaComposicao(fs, [canvas], "cliente", ["kit"], null)).toEqual([]);
  expect(historicoDaComposicao(fs, [canvas], "cliente", ["outro-kit"], { tipo: "persona", id: "modelo" })).toEqual([]);
});
