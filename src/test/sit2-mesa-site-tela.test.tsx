import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * Frente SIT2 (30/09): as telas novas da Mesa Site. O editor do mapa (tipo,
 * seções da biblioteca, Jev como prévia e Salvar), o checklist de lançamento
 * (o que falta leva à etapa) e a escala da prévia nos aparelhos. Função falsa;
 * nada sai para o Supabase real.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), aviso: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: (...a: unknown[]) => mock.aviso(...a) } }));

import EditorDoMapa from "@/components/mesa-site/EditorDoMapa";
import ChecklistDeLancamento from "@/components/mesa-site/ChecklistDeLancamento";
import { escalaDoAparelho } from "@/components/mesa-site/PreviaNosAparelhos";
import { mapaPadrao, secoesDoMapa } from "../../supabase/functions/_shared/site-biblioteca";
import { checklistDeLancamento, normalizarIntegracoes, normalizarSeo } from "../../supabase/functions/_shared/site-lancamento";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

const site = (extra: Partial<LinhaDoSite> = {}): LinhaDoSite =>
  ({ id: SITE, client_id: CLIENTE, marca_id: null, nome: "Site do café", projeto: "site-do-cafe-33333333", etapa: "direcao", briefing: {}, referencias: [], dna: {}, direcao: { secoes: ["topo", "hero", "faq", "rodape"] }, conteudo: {}, imagens: [], revisao: {}, publicacao: {}, modelo: null, tipo: null, mapa: {}, estilo: {}, integracoes: {}, seo: {}, arquivado_em: null, atualizado_em: "2026-09-30T10:00:00Z", ...extra }) as LinhaDoSite;

function montar(filho: ReturnType<typeof h>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

const corpos = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-site" && c[1].body.acao === acao).map((c: any[]) => c[1].body);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.aviso.mockReset();
});

describe("editor do mapa", () => {
  it("site antigo abre com o mapa de uma página; trocar o tipo põe o mapa padrão e Salvar manda o mapa", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "mapa_salvar" ? { site: site({ tipo: body.tipo, mapa: body.mapa }), custo_usd: 0 } : {}, error: null }));
    montar(h(EditorDoMapa, { site: site() }));
    const linhas = () => Array.from(document.querySelectorAll("[data-secao-do-mapa]")).map((x) => x.getAttribute("data-secao-do-mapa"));
    expect(linhas()).toEqual(["hero", "faq"]);
    // Tipo: landing (padrão) -> portfólio.
    fireEvent.click(screen.getByRole("button", { name: /Tipo de site:/ }));
    fireEvent.click(within(await screen.findByRole("listbox", { name: "Tipo de site" })).getByRole("option", { name: /Portfólio/ }));
    expect(document.querySelectorAll("[data-pagina-do-mapa]").length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Tirar Portfólio e cases" }));
    fireEvent.click(document.querySelector("[data-salvar-mapa]") as HTMLElement);
    await waitFor(() => expect(corpos("mapa_salvar").length).toBe(1));
    const enviado = corpos("mapa_salvar")[0];
    expect(enviado.tipo).toBe("portfolio");
    expect(secoesDoMapa(enviado.mapa)).not.toContain("portfolio");
    expect(secoesDoMapa(enviado.mapa)[0]).toBe("topo");
  });

  it("Montar com o Jev é prévia (não grava) e diz o que entrou e quanto custou", async () => {
    const doJev = { ...mapaPadrao("institucional"), fonte: "jev" };
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "mapa_gerar" ? { mapa: doJev, incluidas: [{ id: "depoimentos", prob: 0.82 }], aviso: null, custo_usd: 0.0001 } : {}, error: null }));
    montar(h(EditorDoMapa, { site: site({ tipo: "institucional", mapa: mapaPadrao("institucional") }) }));
    fireEvent.click(document.querySelector("[data-montar-mapa]") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-previa-do-mapa]")).not.toBeNull());
    expect(document.querySelector("[data-previa-do-mapa]")!.textContent).toMatch(/Depoimentos 82%/);
    expect(corpos("mapa_salvar").length).toBe(0);
  });
});

describe("checklist de lançamento na tela", () => {
  it("mostra o obrigatório que falta e leva para a etapa dele", () => {
    const itens = checklistDeLancamento({ briefingSalvo: true, temMapa: true, secoes: ["hero"], construidas: [], preset: false, copyEscolhida: true, slotsVazios: 2, buildOk: null, avisosDeQa: 0, seo: normalizarSeo({}), temOgImagem: false, temLogo: true, integracoes: normalizarIntegracoes({}), secoesComFormulario: false, secoesComMapa: false, dominio: null, dominioVerificado: false, construidoDepoisDasMudancas: true });
    const irPara = vi.fn();
    const qc = new QueryClient();
    render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(ChecklistDeLancamento, { itens, onIrPara: irPara }))));
    const linha = document.querySelector('[data-item-do-checklist="construido"]') as HTMLElement;
    expect(linha.getAttribute("data-ok")).toBe("nao");
    expect(within(linha).getByText("obrigatório")).toBeTruthy();
    fireEvent.click(within(linha).getByRole("button", { name: "Construção" }));
    expect(irPara).toHaveBeenCalledWith("construcao");
    expect(document.querySelector('[data-item-do-checklist="briefing"]')!.getAttribute("data-ok")).toBe("sim");
  });
});

describe("prévia nos aparelhos", () => {
  it("o aparelho encolhe para caber e nunca aumenta", () => {
    expect(escalaDoAparelho(640, 1280)).toBe(0.5);
    expect(escalaDoAparelho(900, 375)).toBe(1);
    expect(escalaDoAparelho(0, 375)).toBe(1);
  });
});
