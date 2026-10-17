import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import OrganogramaAgentes, { haQuanto, type NoDoOrganograma } from "@/components/execucao/OrganogramaAgentes";

// 17/10 (dono): "ver eles trabalhando, o que está acontecendo", mais movimento,
// zoom no computador e nada cortado para os lados.
const AGORA = Date.now();
const iso = (minAtras: number) => new Date(AGORA - minAtras * 60_000).toISOString();

const coordenadores: NoDoOrganograma[] = Array.from({ length: 7 }, (_, i) => ({
  id: `c${i}`, nome: `Coord ${i}`, papel: "coordena", nivel: "coordenador", ativo: true, area: "Paperclip",
}));
const nos: NoDoOrganograma[] = [
  ...coordenadores,
  { id: "o1", nome: "Rafa Ads", papel: "tráfego", nivel: "operador", ativo: true, area: "Marketing", emAndamento: 1, agora: "Subindo a campanha da CME", agoraDesde: iso(4) },
  { id: "o2", nome: "Lia", papel: "dados", nivel: "operador", ativo: true, area: "Dados", ultimaVez: iso(120) },
];

describe("hierarquia ao vivo", () => {
  it("quem trabalha mostra o que faz agora, há quanto tempo, e pulsa", () => {
    render(h(OrganogramaAgentes, { nos, nomeDoDono: "Almir", aoAbrir: () => undefined }));
    expect(screen.getByText("Subindo a campanha da CME")).toBeTruthy();
    expect(screen.getByText("trabalhando · há 4 min")).toBeTruthy();
    expect(document.querySelectorAll("[data-trabalhando]").length).toBe(1);
    expect(screen.getByText(/livre · última vez há 2 h/)).toBeTruthy();
  });

  it("a faixa de movimentação lista e abre o agente", () => {
    const aoAbrir = vi.fn();
    render(h(OrganogramaAgentes, {
      nos, nomeDoDono: "Almir", aoAbrir,
      movimentos: [{ id: "run:1", agenteId: "o1", agente: "Rafa Ads", texto: "Campanha publicada", quando: iso(1), tom: "feito" }],
    }));
    expect(screen.getByText("Movimentação agora")).toBeTruthy();
    fireEvent.click(screen.getByText("Campanha publicada"));
    expect(aoAbrir).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }));
  });

  it("os coordenadores quebram linha em vez de vazar para os lados", () => {
    render(h(OrganogramaAgentes, { nos, nomeDoDono: "Almir", aoAbrir: () => undefined }));
    const grupo = document.querySelector("[data-coordenadores]")!;
    expect(grupo.className).toContain("flex-wrap");
    expect(grupo.children.length).toBe(7);
    const fonte = readFileSync(resolve(__dirname, "../components/execucao/OrganogramaAgentes.tsx"), "utf8");
    expect(fonte).not.toContain("sm:grid-flow-col");
  });

  it("zoom do computador vai de 50% a 150%", () => {
    render(h(OrganogramaAgentes, { nos, nomeDoDono: "Almir", aoAbrir: () => undefined }));
    expect(screen.getByRole("toolbar", { name: "Zoom da hierarquia" })).toBeTruthy();
    const mais = screen.getByRole("button", { name: "Aumentar o zoom" });
    fireEvent.click(mais);
    expect(screen.getByRole("button", { name: "Voltar ao tamanho normal" }).textContent).toBe("110%");
    for (let i = 0; i < 10; i += 1) fireEvent.click(mais);
    expect(screen.getByRole("button", { name: "Voltar ao tamanho normal" }).textContent).toBe("150%");
    expect(screen.getByRole("button", { name: "Tela cheia" })).toBeTruthy();
  });

  it("o tempo relativo fala como gente", () => {
    expect(haQuanto(iso(0), AGORA)).toBe("agora");
    expect(haQuanto(iso(30), AGORA)).toBe("há 30 min");
    expect(haQuanto(iso(180), AGORA)).toBe("há 3 h");
    expect(haQuanto(iso(60 * 72), AGORA)).toBe("há 3 d");
    expect(haQuanto(null, AGORA)).toBe("");
  });
});
