import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prévia do carrossel (EX-02, 30/09). Quem chama (Agenda, seletor,
 * Workspace, Arquivos) monta `parent` e `initialChildren` de novo a cada
 * desenho; a Agenda relê a cada 15 e 30 s. Antes, cada desenho do chamador
 * levava o slider de volta à 1ª lâmina e refazia a pré-carga de todas as
 * lâminas (29/09: a lâmina 1 de um carrossel assinada 93 vezes em 20 min).
 */

const prefetch = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), storage: { from: () => ({ createSignedUrl: vi.fn() }) } },
}));

vi.mock("@/components/shared/FilePreviewContent", () => ({
  default: ({ fileName }: { fileName: string }) => <p data-testid="lamina-aberta">{fileName}</p>,
  prefetchImages: prefetch,
}));

import CarouselSlider from "@/components/shared/CarouselSlider";

type Lamina = { id: string; file_name: string; file_url: string; storage_bucket: string; storage_path: string; mime_type: string; created_at: string };

const lamina = (n: number, grupo = "g"): Lamina => ({
  id: `${grupo}-${n}`,
  file_name: `Arte (${n}/5)`,
  file_url: `files://c/${grupo}/v1/${n}-arte.png`,
  storage_bucket: "files",
  storage_path: `c/${grupo}/v1/${n}-arte.png`,
  mime_type: "image/png",
  created_at: "2026-09-29T13:40:00Z",
});

let redesenhar: () => void = () => undefined;
let trocar: (grupo: string, n: number) => void = () => undefined;

/** Chamador como a Agenda: objetos novos a cada desenho, com o mesmo conteúdo. */
function Chamador() {
  const [, setVersao] = useState(0);
  const [grupo, setGrupo] = useState("g");
  const [quantas, setQuantas] = useState(5);
  redesenhar = () => setVersao((v) => v + 1);
  trocar = (g, n) => {
    setGrupo(g);
    setQuantas(n);
  };
  const todas = Array.from({ length: quantas }, (_, i) => lamina(i + 1, grupo));
  return <CarouselSlider parent={{ ...todas[0] }} initialChildren={todas.slice(1).map((f) => ({ ...f }))} />;
}

beforeEach(() => {
  prefetch.mockClear();
});

describe("prévia do carrossel estável", () => {
  it("o desenho do chamador não volta para a 1ª lâmina nem refaz a pré-carga", () => {
    render(<Chamador />);
    expect(screen.getByText("1/5")).toBeTruthy();
    expect(prefetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Abrir item 3"));
    expect(screen.getByText("3/5")).toBeTruthy();
    for (let i = 0; i < 4; i++) act(() => redesenhar());
    // eslint-disable-next-line no-console
    console.log(`[EX-02] depois de 4 releituras do chamador: lâmina=${screen.getByTestId("lamina-aberta").textContent} pré-cargas=${prefetch.mock.calls.length}`);
    expect(screen.getByText("3/5")).toBeTruthy();
    expect(screen.getByTestId("lamina-aberta").textContent).toBe("Arte (3/5)");
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("outro carrossel volta para a 1ª lâmina e pré-carrega o novo", () => {
    render(<Chamador />);
    fireEvent.click(screen.getByLabelText("Abrir item 4"));
    expect(screen.getByText("4/5")).toBeTruthy();
    act(() => trocar("h", 5));
    expect(screen.getByText("1/5")).toBeTruthy();
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("lâmina removida: a prévia não some e volta para a 1ª", () => {
    render(<Chamador />);
    fireEvent.click(screen.getByLabelText("Abrir item 5"));
    expect(screen.getByText("5/5")).toBeTruthy();
    act(() => trocar("g", 4));
    expect(screen.getByTestId("lamina-aberta")).toBeTruthy();
    expect(screen.getByText("1/4")).toBeTruthy();
  });
});
