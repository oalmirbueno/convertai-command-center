import { createElement as h, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * A obra do site na tela (Gravyx, 19/10/2026): as fases do trabalho, o
 * rascunho com Salvar versão e Descartar, e o Publicar travado pela
 * conferência no navegador até marcar "publicar mesmo assim". Função falsa;
 * nada sai para o Supabase real.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => {
      const q: any = { select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q, in: () => q, maybeSingle: async () => ({ data: null, error: null }), then: (r: (v: unknown) => unknown) => r({ data: [], error: null }) };
      return q;
    },
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: vi.fn(),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://x/capa.jpg" }, error: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/agentes/NavegadorDoAgente", () => ({ BotaoDoNavegador: () => null, TarefasDoNavegador: () => null }));

import FasesDoTrabalho from "@/components/mesa-site/FasesDoTrabalho";
import RascunhoDoSite from "@/components/mesa-site/RascunhoDoSite";
import EtapaPublicacao from "@/components/mesa-site/EtapaPublicacao";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";
import { mapaPadrao } from "../../supabase/functions/_shared/site-biblioteca";
import type { TrabalhoDoMotor } from "../../supabase/functions/_shared/motor-codigo";

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

const site = (): LinhaDoSite =>
  ({ id: SITE, client_id: CLIENTE, marca_id: null, nome: "Site do café", projeto: "site-do-cafe-33333333", etapa: "publicacao", briefing: {}, referencias: [], dna: {}, direcao: {}, conteudo: {}, imagens: [], revisao: {}, publicacao: { dominio: "cafe.com.br" }, modelo: null, tipo: "landing", mapa: mapaPadrao("landing"), estilo: {}, integracoes: {}, seo: {}, arquivado_em: null, atualizado_em: "2026-10-19T10:00:00Z" }) as LinhaDoSite;

let n = 0;
const trabalho = (o: Partial<TrabalhoDoMotor>): TrabalhoDoMotor =>
  ({ id: `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, "0")}`, client_id: CLIENTE, marca_id: null, mesa: "site", projeto: "site-do-cafe-33333333", referencia_id: SITE, tipo: "construir", estado: "feito", modelo: null, instrucao: "", teto_usd: 0, estimativa_usd: null, custo_usd: 0, preview_url: null, commit: "b".repeat(40), commit_anterior: "a".repeat(40), zip_path: null, resultado: {}, erro: null, criado_em: "2026-10-19T10:00:00Z", terminado_em: "2026-10-19T10:05:00Z", ...o }) as TrabalhoDoMotor;

function montar(filho: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

const corpos = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1].body.acao === acao).map((c: any[]) => c[1].body);

beforeEach(() => {
  mock.invoke.mockReset();
});

describe("fases do trabalho na tela", () => {
  it("mostra a fase de agora e as feitas", () => {
    const { container } = montar(h(FasesDoTrabalho, { trabalho: { tipo: "ajustar", estado: "executando" }, eventos: [{ tipo: "passo", resumo: "Ajustando Hero", dados: { fase: "escrevendo" } }] }));
    const ol = container.querySelector("[data-fases-do-trabalho]")!;
    expect(ol.getAttribute("data-fases-do-trabalho")).toBe("escrevendo");
    expect(container.querySelector('[data-fase="entendendo"]')!.getAttribute("data-estado")).toBe("feita");
    expect(container.querySelector('[data-fase="escrevendo"]')!.getAttribute("aria-current")).toBe("step");
    expect(container.querySelector('[data-fase="pronto"]')!.getAttribute("data-estado")).toBe("falta");
    expect(screen.getByText("Entendendo o pedido")).toBeTruthy();
  });

  it("zip e publicar não têm fases", () => {
    const { container } = montar(h(FasesDoTrabalho, { trabalho: { tipo: "zip", estado: "executando" }, eventos: [] }));
    expect(container.querySelector("[data-fases-do-trabalho]")).toBeNull();
  });
});

describe("rascunho: Salvar versão e Descartar", () => {
  const noRascunho = () => [trabalho({ tipo: "ajustar", resultado: { ramo: "rascunho", rascunho: { aberto: true, base: "a".repeat(40) } } })];

  it("sem rascunho, nada aparece", () => {
    const { container } = montar(h(RascunhoDoSite, { site: site(), trabalhos: [trabalho({ tipo: "salvar", resultado: { ramo: "main" } })] }));
    expect(container.querySelector("[data-rascunho-do-site]")).toBeNull();
  });

  it("Salvar versão pede o trabalho salvar (sem custo)", async () => {
    mock.invoke.mockResolvedValue({ data: { trabalho: { id: "t" } }, error: null });
    const { container } = montar(h(RascunhoDoSite, { site: site(), trabalhos: noRascunho() }));
    expect(container.querySelector("[data-rascunho-do-site]")!.getAttribute("data-rascunho-do-site")).toBe("aberto");
    fireEvent.click(container.querySelector("[data-salvar-versao]")!);
    await waitFor(() => expect(corpos("motor-codigo", "pedir")).toHaveLength(1));
    expect(corpos("motor-codigo", "pedir")[0]).toMatchObject({ tipo: "salvar", site_id: SITE, client_id: CLIENTE });
  });

  it("Descartar pede confirmação e depois o trabalho descartar", async () => {
    mock.invoke.mockResolvedValue({ data: { trabalho: { id: "t" } }, error: null });
    const { container } = montar(h(RascunhoDoSite, { site: site(), trabalhos: noRascunho() }));
    fireEvent.click(container.querySelector("[data-descartar-rascunho]")!);
    expect(corpos("motor-codigo", "pedir")).toHaveLength(0);
    fireEvent.click(await screen.findByText("Descartar"));
    await waitFor(() => expect(corpos("motor-codigo", "pedir")).toHaveLength(1));
    expect(corpos("motor-codigo", "pedir")[0].tipo).toBe("descartar");
  });

  it("com o motor escrevendo no rascunho, os dois esperam", () => {
    const { container } = montar(h(RascunhoDoSite, { site: site(), trabalhos: [trabalho({ tipo: "construir", estado: "executando", commit: null })] }));
    expect(container.querySelector("[data-rascunho-do-site]")!.getAttribute("data-rascunho-do-site")).toBe("em_andamento");
    expect((container.querySelector("[data-salvar-versao]") as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector("[data-descartar-rascunho]") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Publicar travado pela conferência no navegador", () => {
  const conferencia = { estado: "pronto", motivo: null, em: "2026-10-19T10:06:00Z", paginas: ["/"], problemas: [{ tipo: "vazando", grave: true, texto: "A página fica 40px mais larga que a tela no celular (rolagem para o lado).", aparelho: "celular", pagina: "/", caminho: null, secao: null }], graves: 1, capa: { bucket: "mesa", path: "c/site/s/conferencia/x.jpg" } };

  const responder = (trabalhos: TrabalhoDoMotor[]) =>
    mock.invoke.mockImplementation((f: string, { body }: any) => {
      if (f === "motor-codigo" && body.acao === "listar") return Promise.resolve({ data: { trabalhos, executor: null, executor_vivo: true }, error: null });
      if (f === "mesa-site" && body.acao === "publicacao_estado") return Promise.resolve({ data: { vercel_ligada: true, faltas: [], dominio: "cafe.com.br", registrador: "registro_br", cartao: null, estado: "sem_dominio", deploy_url: null, zip: null }, error: null });
      if (f === "mesa-site" && body.acao === "publicar") return Promise.resolve({ data: { trabalho: { id: "p" } }, error: null });
      if (f === "mesa-site" && body.acao === "previa_dados") return Promise.resolve({ data: null, error: { message: "fora do ar" } });
      return Promise.resolve({ data: {}, error: null });
    });

  it("problema grave: o Confirmar só libera com 'publicar mesmo assim', que vai ao servidor", async () => {
    responder([trabalho({ tipo: "revisar", resultado: { ramo: "main", build: { ok: true }, conferencia } })]);
    const { container } = montar(h(EtapaPublicacao, { site: site() }));
    await waitFor(() => expect(container.querySelector("[data-trava-da-publicacao]")!.getAttribute("data-trava-da-publicacao")).toBe("conferencia_com_problemas"));
    expect(container.querySelector("[data-conferencia-do-motor]")!.getAttribute("data-graves-do-motor")).toBe("1");
    expect(container.querySelector("[data-corrigir-conferencia]")).toBeTruthy();
    const publicar = container.querySelector("[data-publicar]") as HTMLButtonElement;
    await waitFor(() => expect(publicar.disabled).toBe(false));
    fireEvent.click(publicar);
    const confirmar = (await screen.findByText("Publicar mesmo assim")).closest("button") as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.click(document.querySelector("[data-publicar-mesmo-assim] input")!);
    expect(confirmar.disabled).toBe(false);
    fireEvent.click(confirmar);
    await waitFor(() => expect(corpos("mesa-site", "publicar")).toHaveLength(1));
    expect(corpos("mesa-site", "publicar")[0]).toMatchObject({ confirmar: true, mesmo_assim: true });
  });

  it("rascunho sem salvar: Publicar fica travado com o motivo à vista", async () => {
    responder([trabalho({ tipo: "ajustar", resultado: { ramo: "rascunho", build: { ok: true }, conferencia: { ...conferencia, problemas: [], graves: 0 } } })]);
    const { container } = montar(h(EtapaPublicacao, { site: site() }));
    await waitFor(() => expect(container.querySelector("[data-trava-da-publicacao]")!.getAttribute("data-trava-da-publicacao")).toBe("rascunho_aberto"));
    expect((container.querySelector("[data-publicar]") as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-motivo-da-trava="rascunho_aberto"]')!.textContent).toMatch(/Salve a versão/);
  });

  it("a correção já pedida para esta conferência deixa o botão de corrigir desligado, com o motivo", async () => {
    const conferida = trabalho({ tipo: "revisar", resultado: { ramo: "main", build: { ok: true }, conferencia } });
    responder([trabalho({ tipo: "corrigir", estado: "falhou", commit: null, resultado: { conferencia_de: conferida.id } }), conferida]);
    const { container } = montar(h(EtapaPublicacao, { site: site() }));
    await waitFor(() => expect(container.querySelector("[data-corrigir-conferencia]")).toBeTruthy());
    const b = container.querySelector("[data-corrigir-conferencia]") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("title")).toMatch(/já foi pedida uma vez/);
  });
});
