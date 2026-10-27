import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BotaoAparenciaMembros, ProviderAparenciaMembros } from "@/components/membros/AparenciaMembros";

const CHAVE_MEMBROS = "aceleriq_membros_aparencia";
const CHAVE_PAINEL = "aceleriq_theme";
let classeAnterior: string;
let atributoAnterior: string | null;
let preferenciaMembrosAnterior: string | null;
let preferenciaPainelAnterior: string | null;

function montar() {
  return render(<ProviderAparenciaMembros><BotaoAparenciaMembros /></ProviderAparenciaMembros>);
}

beforeEach(() => {
  classeAnterior = document.documentElement.className;
  atributoAnterior = document.documentElement.getAttribute("data-membros-tema");
  preferenciaMembrosAnterior = localStorage.getItem(CHAVE_MEMBROS);
  preferenciaPainelAnterior = localStorage.getItem(CHAVE_PAINEL);
  document.documentElement.removeAttribute("data-membros-tema");
  localStorage.removeItem(CHAVE_MEMBROS);
});

afterEach(() => {
  cleanup();
  document.documentElement.className = classeAnterior;
  if (atributoAnterior === null) document.documentElement.removeAttribute("data-membros-tema");
  else document.documentElement.setAttribute("data-membros-tema", atributoAnterior);
  for (const [chave, valor] of [[CHAVE_MEMBROS, preferenciaMembrosAnterior], [CHAVE_PAINEL, preferenciaPainelAnterior]] as const) {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  }
});

describe("aparência da área de membros", () => {
  it("começa clara sem substituir o tema escuro do painel", () => {
    document.documentElement.className = "dark";
    localStorage.setItem(CHAVE_PAINEL, "dark");
    montar();

    expect(screen.getByRole("button", { name: "Usar tema claro" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-membros-tema", "claro");
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem(CHAVE_PAINEL)).toBe("dark");
  });

  it("lembra a escolha do membro após sair e entrar novamente", () => {
    const primeira = montar();
    fireEvent.click(screen.getByRole("button", { name: "Usar tema escuro" }));
    expect(document.documentElement).toHaveAttribute("data-membros-tema", "escuro");
    expect(localStorage.getItem(CHAVE_MEMBROS)).toBe("escuro");

    primeira.unmount();
    expect(document.documentElement).not.toHaveAttribute("data-membros-tema");
    montar();
    expect(screen.getByRole("button", { name: "Usar tema escuro" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Usar tema claro" }));
    expect(localStorage.getItem(CHAVE_MEMBROS)).toBe("claro");
    expect(document.documentElement).toHaveAttribute("data-membros-tema", "claro");
  });

  it("restaura a aparência anterior ao desmontar, inclusive depois de alternar", () => {
    document.documentElement.setAttribute("data-membros-tema", "escuro");
    const tela = montar();
    expect(document.documentElement).toHaveAttribute("data-membros-tema", "claro");
    fireEvent.click(screen.getByRole("button", { name: "Usar tema escuro" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar tema claro" }));
    tela.unmount();
    expect(document.documentElement).toHaveAttribute("data-membros-tema", "escuro");
  });
});
