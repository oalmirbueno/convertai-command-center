import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/mesa/MesaContexto", () => ({ ImagemDaMesa: ({ alt }: { alt: string }) => <img alt={alt} data-arte-do-carrossel="" /> }));
import EstudioLaminaGrande from "@/components/mesa/EstudioLaminaGrande";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("Template · X reaproveita o Estúdio (rodada 4)", () => {
  it("a lâmina grande do Estúdio recebe o desenho do post no quadro, com o mesmo título, versões e ampliar", () => {
    render(<EstudioLaminaGrande card={{ ordem: 1, texto_exato: "Capa" }} total={3} versoes={[{ ordem: 1, versao: 1, storage_path: "a.png" }, { ordem: 1, versao: 2, storage_path: "b.png" }] as never} versaoVista={null} onVersaoVista={vi.fn()} desenhandoAreas={false} areas={[]} onAreas={vi.fn()} ocupado={false} onAmpliar={vi.fn()} soPelaLargura faixa={<p>faixa do template</p>} conteudo={() => <canvas aria-label="Post do X no quadro" />} />);
    expect(screen.getByText("Lâmina 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver grande" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima versão" })).toBeInTheDocument();
    expect(screen.getByText("faixa do template")).toBeInTheDocument();
    expect(document.querySelector("[data-arte-do-carrossel]")).toBeNull();
  });
  it("no modo Template o AbaEstudio usa a EstudioLaminaGrande e o Template não recria barra, zoom, setas nem sair", () => {
    const estudio = ler("src/components/mesa/AbaEstudio.tsx");
    expect(estudio).toContain("moldura={({ faixa, conteudo }) => (\n          <EstudioLaminaGrande");
    expect(estudio).not.toContain("onSair=");
    const editor = ler("src/components/mesa/profile/TemplateProfileEditor.tsx");
    for (const recriado of ['aria-label="Sair do Template"', 'aria-label="Aumentar o post"', 'aria-label="Próxima lâmina"', 'aria-label="Baixar PNG"', 'aria-label="Ver prévia grande"', "JanelaCentral"]) expect(editor).not.toContain(recriado);
  });
});
