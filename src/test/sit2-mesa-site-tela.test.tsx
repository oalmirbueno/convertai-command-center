import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const mock = vi.hoisted(() => ({ invoke: vi.fn(), aviso: vi.fn(), sucesso: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => mock.sucesso(...a), error: vi.fn(), info: vi.fn(), warning: (...a: unknown[]) => mock.aviso(...a) } }));

import EtapaComBarra from "@/components/mesa-site/BarraDaEtapa";
import EtapaDirecao from "@/components/mesa-site/EtapaDirecao";
import ChecklistDeLancamento from "@/components/mesa-site/ChecklistDeLancamento";
import { escalaDoAparelho } from "@/components/mesa-site/PreviaNosAparelhos";
import { mapaPadrao, presetDeEstilo, secoesDoMapa } from "../../supabase/functions/_shared/site-biblioteca";
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
const ordem = () => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-site").map((c: any[]) => c[1].body.acao);
const seguir = () => document.querySelector("[data-seguir-etapa]") as HTMLButtonElement;

/** A etapa Direção com a barra (o Salvar e o Seguir moram nela desde a UXS, 30/09). */
function montarDirecao(s: LinhaDoSite) {
  const irPara = vi.fn();
  montar(h(EtapaComBarra, { etapa: "direcao", onIrPara: irPara, children: h(EtapaDirecao, { site: s }) }));
  return irPara;
}

beforeEach(() => {
  mock.invoke.mockReset();
  mock.aviso.mockReset();
  mock.sucesso.mockReset();
  window.localStorage.clear();
});

describe("editor do mapa", () => {
  it("site antigo abre com o mapa de uma página; trocar o tipo põe o mapa padrão; o Salvar da etapa manda o mapa e o Seguir espera 3 atributos", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "mapa_salvar" ? { site: site({ tipo: body.tipo, mapa: body.mapa }), custo_usd: 0 } : {}, error: null }));
    const irPara = montarDirecao(site());
    const linhas = () => Array.from(document.querySelectorAll("[data-secao-do-mapa]")).map((x) => x.getAttribute("data-secao-do-mapa"));
    expect(linhas()).toEqual(["hero", "faq"]);
    // Tipo: landing (padrão) -> portfólio.
    fireEvent.click(screen.getByRole("button", { name: /Tipo de site:/ }));
    fireEvent.click(within(await screen.findByRole("listbox", { name: "Tipo de site" })).getByRole("option", { name: /Portfólio/ }));
    expect(document.querySelectorAll("[data-pagina-do-mapa]").length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Tirar Portfólio e cases" }));
    // Sem DNA, o Seguir espera e a barra diz o motivo (visível, não só no title).
    await waitFor(() => expect(document.querySelector("[data-estado-da-etapa]")!.textContent).toMatch(/Escolha um estilo ou 3 atributos/));
    expect(seguir().disabled).toBe(true);
    fireEvent.click(document.querySelector("[data-salvar-etapa]") as HTMLElement);
    await waitFor(() => expect(corpos("mapa_salvar").length).toBe(1));
    const enviado = corpos("mapa_salvar")[0];
    expect(enviado.tipo).toBe("portfolio");
    expect(secoesDoMapa(enviado.mapa)).not.toContain("portfolio");
    expect(secoesDoMapa(enviado.mapa)[0]).toBe("topo");
    // Salvar não troca de etapa, e o estilo e a direção (sem mudança) não foram gravados.
    expect(irPara).not.toHaveBeenCalled();
    expect(corpos("estilo_salvar").length).toBe(0);
    expect(corpos("site_salvar").length).toBe(0);
  });

  it("Montar com o Jev é prévia (não grava) e diz o que entrou e quanto custou", async () => {
    const doJev = { ...mapaPadrao("institucional"), fonte: "jev" };
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "mapa_gerar" ? { mapa: doJev, incluidas: [{ id: "depoimentos", prob: 0.82 }], aviso: null, custo_usd: 0.0001 } : {}, error: null }));
    montarDirecao(site({ tipo: "institucional", mapa: mapaPadrao("institucional") }));
    fireEvent.click(document.querySelector("[data-montar-mapa]") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-previa-do-mapa]")).not.toBeNull());
    expect(document.querySelector("[data-previa-do-mapa]")!.textContent).toMatch(/Depoimentos 82%/);
    expect(corpos("mapa_salvar").length).toBe(0);
  });

  it("trocar o tipo e Desfazer volta o mapa anterior", async () => {
    mock.invoke.mockResolvedValue({ data: {}, error: null });
    montarDirecao(site());
    const linhas = () => Array.from(document.querySelectorAll("[data-secao-do-mapa]")).map((x) => x.getAttribute("data-secao-do-mapa"));
    fireEvent.click(screen.getByRole("button", { name: /Tipo de site:/ }));
    fireEvent.click(within(await screen.findByRole("listbox", { name: "Tipo de site" })).getByRole("option", { name: /Portfólio/ }));
    expect(document.querySelectorAll("[data-pagina-do-mapa]").length).toBe(3);
    const aviso = mock.sucesso.mock.calls.find((c: any[]) => c[0] === "Mapa trocado");
    expect(aviso).toBeTruthy();
    act(() => aviso![1].action.onClick());
    expect(document.querySelectorAll("[data-pagina-do-mapa]").length).toBe(1);
    expect(linhas()).toEqual(["hero", "faq"]);
  });

  it("preset trocado e Seguir: o estilo vai sem reaplicar o DNA e o site_salvar leva os atributos do preset", async () => {
    mock.invoke.mockImplementation(() => Promise.resolve({ data: { site: site({ tipo: "institucional", mapa: mapaPadrao("institucional") }), custo_usd: 0 }, error: null }));
    const irPara = montarDirecao(site({ tipo: "institucional", mapa: mapaPadrao("institucional") }));
    // Sem DNA, o Seguir espera; escolher o preset já põe o DNA dele na etapa.
    await waitFor(() => expect(seguir().disabled).toBe(true));
    fireEvent.click(document.querySelector('[data-preset="saas_limpo"]') as HTMLElement);
    await waitFor(() => expect(seguir().disabled).toBe(false));
    fireEvent.click(seguir());
    await waitFor(() => expect(irPara).toHaveBeenCalledWith("conteudo"));
    // Mapa sem mudança não é gravado; o estilo vem antes da direção.
    expect(corpos("mapa_salvar").length).toBe(0);
    expect(ordem()).toEqual(["estilo_salvar", "site_salvar"]);
    expect(corpos("estilo_salvar")[0]).toMatchObject({ preset: "saas_limpo", aplicar_dna: false });
    const direcao = corpos("site_salvar")[0];
    expect(direcao.etapa).toBe("conteudo");
    expect(direcao.dna.atributos).toEqual(presetDeEstilo("saas_limpo")!.atributos);
    expect(direcao.dna).toMatchObject({ movimento: "sutil", nivel: "saas", nicho: "servico_local" });
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

  it("SEO salvo vazio com o conteúdo escolhido conta como pronto (a mesma regra do pacote do site)", () => {
    const base = { briefingSalvo: true, temMapa: true, secoes: ["hero"], construidas: [], preset: false, copyEscolhida: true, slotsVazios: 0, buildOk: null, avisosDeQa: 0, seo: normalizarSeo({}), temOgImagem: false, temLogo: true, integracoes: normalizarIntegracoes({}), secoesComFormulario: false, secoesComMapa: false, dominio: null, dominioVerificado: false, construidoDepoisDasMudancas: true };
    expect(checklistDeLancamento(base).find((i) => i.id === "seo_titulo")!.ok).toBe(false);
    const comConteudo = checklistDeLancamento({ ...base, seoDoConteudo: { titulo: "Café X em Curitiba", descricao: "Café especial torrado na hora, com entrega no bairro. Peça pelo WhatsApp e receba hoje." } });
    expect(comConteudo.find((i) => i.id === "seo_titulo")!.ok).toBe(true);
  });
});

describe("prévia nos aparelhos", () => {
  it("o aparelho encolhe para caber e nunca aumenta", () => {
    expect(escalaDoAparelho(640, 1280)).toBe(0.5);
    expect(escalaDoAparelho(900, 375)).toBe(1);
    expect(escalaDoAparelho(0, 375)).toBe(1);
  });
});
