import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import OpcoesDaCopy, { AvisosDoTexto } from "@/components/sistema/OpcoesDaCopy";
import { CartaoDoConteudo } from "@/components/mesa/ConteudosPropostos";

/**
 * Frente CPY (revisão): os avisos da legenda do Mês e das Campanhas
 * (avisos_de_texto, gravados por normalizarItem) aparecem no cartão, e a
 * lista de outras opções segue o padrão visual (lista aberta, sem caixa por linha).
 */
describe("motor de copy: avisos do texto na tela do Mês e das Campanhas", () => {
  it("o cartão do conteúdo mostra quantos avisos o texto tem e abre a lista", () => {
    render(
      <CartaoDoConteudo
        item={{
          tema_id: "t1",
          data: "2026-10-06",
          formato: "estatico",
          tema: "Troca de óleo",
          gancho: "Seu carro pede atenção",
          copy: "Legenda longa",
          avisos_de_texto: ["Legenda: Primeira linha longa (164 caracteres): o gancho some antes do \"mais\".", "Legenda: Clichê de IA: jornada."],
        }}
      />,
    );
    expect(screen.queryByText(/Primeira linha longa/)).toBeNull();
    fireEvent.click(screen.getByText("2 avisos no texto"));
    expect(screen.getByText(/Primeira linha longa \(164 caracteres\)/)).toBeTruthy();
    expect(screen.getByText("Legenda: Clichê de IA: jornada.")).toBeTruthy();
  });

  it("sem aviso, nada aparece", () => {
    const { container } = render(<AvisosDoTexto avisos={[]} />);
    expect(container.innerHTML).toBe("");
    const { container: c2 } = render(<AvisosDoTexto avisos={undefined} />);
    expect(c2.innerHTML).toBe("");
    render(<AvisosDoTexto avisos={["Legenda: Sem CTA claro (verbo de ação no fim)."]} />);
    expect(screen.getByText("1 aviso no texto")).toBeTruthy();
  });

  it("as outras opções são uma lista aberta: divisória entre linhas e nenhuma caixa por linha", () => {
    const { container } = render(<OpcoesDaCopy opcoes={[{ texto: "A", nota: 90 }, { texto: "B", nota: 80 }, { texto: "C", nota: 70 }]} atual="A" onUsar={() => {}} />);
    fireEvent.click(screen.getByText("Outras 2 opções escritas junto"));
    const lista = container.querySelector("ol") as HTMLElement;
    expect(lista.className).toContain("divide-y");
    const linhas = Array.prototype.slice.call(lista.querySelectorAll("li")) as HTMLElement[];
    expect(linhas).toHaveLength(2);
    for (const li of linhas) expect(li.className).not.toMatch(/(^|\s)border(\s|$)/);
    expect((container.firstChild as HTMLElement).className).not.toMatch(/(^|\s)border(\s|$)/);
    expect(container.innerHTML).not.toContain("overflow-wrap:anywhere");
  });
});
