import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { avisoDaPauta, BotaoDeTrocarAngulo, SeloDaPauta } from "@/components/mesa/MemoriaEditorialNoMes";

/**
 * Frente AP (27/09): o selo discreto da memória editorial no cartão da pauta
 * e o "Trocar ângulo" só na pauta repetida. Sem checagem, nada aparece.
 */

const repeticao = {
  tipo: "repeticao",
  angulo: null,
  de: { chave: "task:1", data: "2026-09-12", tema: "Como escolher protetor solar", angulo: null, origem: "publicado" },
  frase: 'repete o post de 12/09 sobre "Como escolher protetor solar"',
  aviso: "Parece repetir o post de 12/09 (mesmo tema e ângulo). Troque o ângulo desta pauta.",
  jev: { checado: true, probabilidade: 0.82 },
};
const angulo = { ...repeticao, tipo: "novo_angulo", angulo: "erro comum", aviso: null, frase: 'continua o post de 12/09 sobre "Como escolher protetor solar": agora erro comum' };

describe("selo da memória editorial no cartão", () => {
  it("repetição: selo de aviso, a frase no aviso e Trocar ângulo chama só esta pauta", async () => {
    const trocar = vi.fn(async () => undefined);
    render(<SeloDaPauta evolucao={repeticao} onTrocarAngulo={trocar} />);
    expect(screen.getByText("repete 12/09")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Trocar ângulo/ }));
    await waitFor(() => expect(trocar).toHaveBeenCalledTimes(1));
    expect(avisoDaPauta(repeticao)).toContain("Parece repetir o post de 12/09");
  });

  it("ângulo novo e tema novo: só o selo, sem botão", () => {
    const { rerender, container } = render(<SeloDaPauta evolucao={angulo} onTrocarAngulo={async () => undefined} />);
    expect(screen.getByText("novo ângulo de 12/09")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<SeloDaPauta evolucao={{ tipo: "tema_novo", angulo: null, de: null, frase: "tema novo", aviso: null, jev: { checado: false, probabilidade: null } }} />);
    expect(screen.getByText("tema novo")).toBeTruthy();
    rerender(<SeloDaPauta evolucao={undefined} />);
    expect(container.textContent).toBe("");
    expect(avisoDaPauta(angulo)).toBeNull();
  });

  it("o botão sozinho some fora da repetição", () => {
    const { container } = render(<BotaoDeTrocarAngulo evolucao={angulo} onTrocarAngulo={async () => undefined} />);
    expect(container.textContent).toBe("");
  });
});
