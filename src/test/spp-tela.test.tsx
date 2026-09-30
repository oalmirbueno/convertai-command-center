import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente SPP (30/09/2026), a tela:
 * - "Método: brainstorm, plano, verificação" embaixo da resposta (anexo
 *   metodo_usado), nos componentes que já mostram "Aprendi" e "Segui";
 * - Configurações, Superpoderes: 8 métodos, a chave por mesa (só o admin
 *   grava; a verificação travada), o motor de código e o uso em 30 dias, com
 *   carga preguiçosa pela linha da lista.
 */

const { lerSuperpoderes, gravarChave, resumoDoUso, papel } = vi.hoisted(() => ({
  lerSuperpoderes: vi.fn(),
  gravarChave: vi.fn(),
  resumoDoUso: vi.fn(),
  papel: { valor: "admin" },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: papel.valor }, user: { id: "u-1" } }) }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/components/agencia/DadosDaAgencia", () => ({ default: () => null }));
vi.mock("@/components/NotificationsPanel", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/superpoderes/api", async (original) => {
  const real = await original<typeof import("@/lib/superpoderes/api")>();
  return {
    ...real,
    lerSuperpoderes: (...a: unknown[]) => lerSuperpoderes(...a),
    gravarChave: (...a: unknown[]) => gravarChave(...a),
    resumoDoUso: (...a: unknown[]) => resumoDoUso(...a),
  };
});

import MetodoDoAgente, { metodoUsadoDosAnexos, rotulosDoMetodo } from "@/components/agentes/MetodoDoAgente";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import SuperpoderesDasMesas from "@/components/config/SuperpoderesDasMesas";
import SettingsPage from "@/pages/SettingsPage";
import { IDS_DOS_METODOS, ROTULOS_DOS_METODOS, TEXTOS_DOS_METODOS } from "../../supabase/functions/_shared/superpoderes-catalogo";

const anexo = (extra: Record<string, unknown> = {}) => ({ tipo: "metodo_usado", ids: ["prova", "entender", "plano"], fonte: "declarado", caminho: "grande", prova: "ok", versao: "v", ...extra });
const comQuery = (el: ReturnType<typeof h>) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, el));
};

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  lerSuperpoderes.mockReset().mockResolvedValue([]);
  gravarChave.mockReset().mockResolvedValue(undefined);
  resumoDoUso.mockReset().mockResolvedValue([]);
  papel.valor = "admin";
});

describe("a linha 'Método:' embaixo da resposta", () => {
  it("aparece com o anexo, na ordem do trabalho, e some sem ele", () => {
    const { container, rerender } = render(h(MetodoDoAgente, { anexos: [anexo()] }));
    expect(container.textContent).toBe("Método: brainstorm, plano, verificação");
    expect(container.querySelector("[data-metodo-do-agente]")).not.toBeNull();
    rerender(h(MetodoDoAgente, { anexos: [{ tipo: "regras_seguidas", regras: [] }] }));
    expect(container.textContent).toBe("");
    rerender(h(MetodoDoAgente, { anexos: null as unknown as unknown[] }));
    expect(container.textContent).toBe("");
  });

  it("prova que faltou vira 'verificação pendente' com o '?' que explica", () => {
    render(h(MetodoDoAgente, { anexos: [anexo({ ids: ["receber"], prova: "faltou" })] }));
    expect(screen.getByText(/receber ajuste, verificação pendente/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Por que a verificação ficou pendente?" })).toBeTruthy();
  });

  it("lê só ids conhecidos e ignora anexo vazio", () => {
    expect(metodoUsadoDosAnexos([{ tipo: "metodo_usado", ids: ["xyz"], prova: "ok" }])).toBeNull();
    expect(rotulosDoMetodo(metodoUsadoDosAnexos([anexo({ ids: ["frentes", "causa"] })])!)).toEqual(["depuração", "frentes paralelas"]);
  });

  it("AprendizadoDoAgente ganha a terceira linha sem mexer em quem usa (só com o método também aparece)", () => {
    const { container } = render(h(AprendizadoDoAgente, { anexos: [anexo()] }));
    expect(container.querySelector("[data-aprendizado-do-agente]")).not.toBeNull();
    expect(screen.getByText("Método:")).toBeTruthy();
    const comTudo = render(h(AprendizadoDoAgente, { anexos: [{ tipo: "regras_seguidas", regras: [{ id: "g1", tipo: "evitar", texto: "Nada de emoji" }] }, anexo()] }));
    expect(comTudo.container.textContent).toContain("Segui:");
    expect(comTudo.container.textContent).toContain("Método: brainstorm, plano, verificação");
  });

  it("os componentes das mesas que mostram Aprendi e Segui ganham a linha pelo componente comum", () => {
    const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
    expect(ler("src/components/agentes/AprendizadoDoAgente.tsx")).toContain("{metodo && <MetodoDoAgente anexos={anexos} />}");
    expect(ler("src/components/agentes/AprendizadoNaConversa.tsx")).toContain("{metodo && <MetodoDoAgente anexos={anexos} />}");
    expect(ler("src/components/admin/VoiceAssistant.tsx")).toContain("[x.aprendi, x.segui, x.metodo]");
    expect(ler("src/components/mesa-edicao/editor/AgenteEditor.tsx")).toContain("[r.aprendido, r.seguidas, r.metodo]");
  });
});

describe("Configurações, Superpoderes", () => {
  const abrirMetodo = async (id: string) => {
    const secao = await waitFor(() => {
      const s = document.querySelector(`[data-metodo="${id}"]`);
      if (!s) throw new Error("sem a seção");
      return s as HTMLElement;
    });
    fireEvent.click(within(secao).getAllByRole("button")[0]);
    return secao;
  };

  it("lista os 8 métodos com o rótulo do dono, a atribuição e a licença", async () => {
    comQuery(h(SuperpoderesDasMesas));
    await waitFor(() => expect(document.querySelector("[data-metodos]")).not.toBeNull());
    expect(document.querySelector("[data-metodos]")!.getAttribute("data-metodos")).toBe("8");
    for (const id of IDS_DOS_METODOS) expect(document.querySelector(`[data-metodo="${id}"]`), id).not.toBeNull();
    for (const id of IDS_DOS_METODOS) expect(screen.getAllByText(ROTULOS_DOS_METODOS[id]).length, id).toBeGreaterThan(0);
    const atribuicao = document.querySelector("[data-atribuicao]")!;
    expect(atribuicao.textContent).toContain("obra/superpowers v6.4.2");
    expect(atribuicao.textContent).toContain("MIT (Copyright (c) 2025 Jesse Vincent)");
    expect(within(atribuicao as HTMLElement).getByRole("link", { name: "Licença" }).getAttribute("href")).toBe("https://github.com/obra/superpowers/blob/v6.4.2/LICENSE");
  });

  it("aberto, o método mostra o texto que o agente recebe e onde vale; a verificação fica travada", async () => {
    comQuery(h(SuperpoderesDasMesas));
    const prova = await abrirMetodo("prova");
    expect(prova.textContent).toContain(TEXTOS_DOS_METODOS.prova);
    expect(prova.querySelector("[data-prova-travada]")!.textContent).toContain("Sempre ligada: regra da casa");
    expect(within(prova).queryAllByRole("switch")).toHaveLength(0);
    const plano = await abrirMetodo("plano");
    expect(plano.textContent).toContain("Onde vale");
    expect(plano.textContent).toContain("Mesa Ads");
  });

  it("quem não é admin vê as chaves desabilitadas", async () => {
    papel.valor = "manager";
    comQuery(h(SuperpoderesDasMesas));
    const entender = await abrirMetodo("entender");
    const chaves = within(entender).getAllByRole("switch");
    expect(chaves.length).toBeGreaterThan(5);
    for (const c of chaves) expect(c).toBeDisabled();
    expect(entender.textContent).toContain("(só o admin muda)");
  });

  it("o admin liga e desliga por mesa (a chave grava na mesa certa) e a linha da mesa vale sobre a '*'", async () => {
    lerSuperpoderes.mockResolvedValue([{ mesa: "*", metodo: "frentes", ligado: false }, { mesa: "roteiros", metodo: "frentes", ligado: true }]);
    comQuery(h(SuperpoderesDasMesas));
    const frentes = await abrirMetodo("frentes");
    await waitFor(() => expect(frentes.querySelector('[data-chave-da-mesa="roteiros"]')).not.toBeNull());
    const roteiros = within(frentes.querySelector('[data-chave-da-mesa="roteiros"]') as HTMLElement).getByRole("switch");
    const ads = within(frentes.querySelector('[data-chave-da-mesa="ads"]') as HTMLElement).getByRole("switch");
    const todas = within(frentes.querySelector('[data-chave-da-mesa="*"]') as HTMLElement).getByRole("switch");
    expect(roteiros.getAttribute("aria-checked")).toBe("true");
    expect(ads.getAttribute("aria-checked")).toBe("false");
    expect(todas.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(ads);
    await waitFor(() => expect(gravarChave).toHaveBeenCalledWith("ads", "frentes", true));
  });

  it("o motor de código mostra as 15 skills e o uso em 30 dias vem da RPC", async () => {
    resumoDoUso.mockResolvedValue([
      { agente: "roteiros.agente", metodo: "prova", vezes: 12, pelo_jev: 10, pela_regra: 2, pelo_codigo: 0, provas_ok: 3, provas_faltaram: 2 },
      { agente: "roteiros.agente", metodo: "entender", vezes: 7, pelo_jev: 7, pela_regra: 0, pelo_codigo: 0, provas_ok: 0, provas_faltaram: 0 },
    ]);
    comQuery(h(SuperpoderesDasMesas));
    await waitFor(() => expect(document.querySelector("[data-metodos]")).not.toBeNull());
    const botoes = screen.getAllByRole("button");
    fireEvent.click(botoes.find((b) => /Motor de código/.test(b.textContent || ""))!);
    await waitFor(() => expect(document.querySelector("[data-skills-do-motor]")!.getAttribute("data-skills-do-motor")).toBe("15"));
    fireEvent.click(screen.getAllByRole("button").find((b) => /Uso em 30 dias/.test(b.textContent || ""))!);
    await waitFor(() => expect(document.querySelector('[data-uso-do-agente="roteiros.agente"]')).not.toBeNull());
    const linha = document.querySelector('[data-uso-do-agente="roteiros.agente"]')!.textContent || "";
    expect(linha).toContain("Mesa Roteiros: Roteiros: agente");
    expect(linha).toContain("brainstorm 7");
    expect(linha).toContain("verificação 12");
    expect(linha).toContain("2 pendentes");
    expect(resumoDoUso).toHaveBeenCalledWith(30);
  });

  it("a linha 'Superpoderes' da lista abre a seção sob demanda (carga preguiçosa)", async () => {
    render(h(MemoryRouter, null, h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, h(SettingsPage))));
    const linha = document.querySelector("[data-linha-superpoderes]") as HTMLButtonElement;
    expect(linha.textContent).toContain("Superpoderes");
    expect(linha.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-superpoderes]")).toBeNull();
    fireEvent.click(linha);
    expect(linha.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(document.querySelector("[data-superpoderes]")).not.toBeNull());
    const settings = readFileSync(resolve(process.cwd(), "src/pages/SettingsPage.tsx"), "utf8");
    expect(settings).toContain('lazy(() => import("@/components/config/SuperpoderesDasMesas"))');
  });
});
