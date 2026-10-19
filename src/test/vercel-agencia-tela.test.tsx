import { createElement as h, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * Vercel da agência na tela (20/10/2026): "Abrir prévia" por versão e o
 * pedido da prévia na nuvem; no Publicar, a versão salva que sobe, o que
 * entra, muda e sai do ar, o commit mandado ao servidor, tirar do ar e ligar
 * o domínio. Função falsa; nada sai para o Supabase nem para a Vercel.
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

import EtapaPublicacao from "@/components/mesa-site/EtapaPublicacao";
import Versoes from "@/components/mesa-site/Versoes";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";
import { mapaPadrao } from "../../supabase/functions/_shared/site-biblioteca";
import type { TrabalhoDoMotor } from "../../supabase/functions/_shared/motor-codigo";

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const COMMIT = "b".repeat(40);
const PREVIA = "https://site-do-cafe-33333333-vbbbbbbbb.vercel.app";

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

const site = (): LinhaDoSite =>
  ({ id: SITE, client_id: CLIENTE, marca_id: null, nome: "Site do café", projeto: "site-do-cafe-33333333", etapa: "publicacao", briefing: {}, referencias: [], dna: {}, direcao: {}, conteudo: {}, imagens: [], revisao: {}, publicacao: { dominio: "cafe.com.br" }, modelo: null, tipo: "landing", mapa: mapaPadrao("landing"), estilo: {}, integracoes: {}, seo: {}, arquivado_em: null, atualizado_em: "2026-10-20T10:00:00Z" }) as LinhaDoSite;

const salvo = (): TrabalhoDoMotor =>
  ({ id: "aaaaaaaa-0000-4000-8000-000000000001", client_id: CLIENTE, marca_id: null, mesa: "site", projeto: "site-do-cafe-33333333", referencia_id: SITE, tipo: "salvar", estado: "feito", modelo: null, instrucao: "Salvar", teto_usd: 0, estimativa_usd: null, custo_usd: 0, preview_url: null, commit: COMMIT, commit_anterior: "a".repeat(40), zip_path: null, criado_em: "2026-10-20T09:00:00Z", terminado_em: "2026-10-20T09:01:00Z", erro: null, resultado: { ramo: "main", build: { ok: true }, versao: { commit: COMMIT, de: null, origem: "edicao", modelos: [], trabalhos: [], em: "2026-10-20T09:01:00Z" }, previa_nuvem: { url: PREVIA, deploy_id: "dpl_2", projeto_vercel: "prj_1", commit: COMMIT, ramo: "main", paginas: ["/", "/obrigado/"], arquivos: { "index.html": "h2" }, em: "2026-10-20T09:01:00Z" } } }) as TrabalhoDoMotor;

function montar(filho: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

const corpos = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1].body.acao === acao).map((c: any[]) => c[1].body);

const ESTADO = {
  vercel_ligada: true,
  vercel_no_servidor: true,
  vercel_no_motor: true,
  faltas: [],
  dominio: "cafe.com.br",
  dominio_ligado: false,
  registrador: "registro_br",
  cartao: null,
  estado: "aguardando_dns",
  deploy_url: "https://site-do-cafe-33333333.vercel.app",
  zip: null,
  versao: { commit: COMMIT, em: "2026-10-20T09:01:00Z", previa_url: PREVIA },
  publicado: { deploy_url: "https://site-do-cafe-33333333.vercel.app", commit: "a".repeat(40), paginas: ["/", "/sobre/"], publicado_em: "2026-10-19T12:00:00Z", no_ar: true, tirado_em: null },
  comparacao: { primeira: false, entra: ["/obrigado/"], muda: ["/"], sai: ["/sobre/"], igual: [], estimada: false, arquivos: { novos: 1, trocados: 1, removidos: 1 }, mesma_versao: false },
};

beforeEach(() => {
  mock.invoke.mockReset();
  mock.invoke.mockImplementation((f: string, { body }: any) => {
    if (f === "motor-codigo" && body.acao === "listar") return Promise.resolve({ data: { trabalhos: [salvo()], executor: null, executor_vivo: true }, error: null });
    if (f === "mesa-site" && body.acao === "publicacao_estado") return Promise.resolve({ data: ESTADO, error: null });
    if (f === "mesa-site" && body.acao === "versoes_listar") return Promise.resolve({ data: { versoes: [], aviso: null }, error: null });
    if (f === "mesa-site" && body.acao === "previa_dados") return Promise.resolve({ data: null, error: { message: "fora do ar" } });
    if (f === "mesa-site" && body.acao === "publicacao_tirar_do_ar") return Promise.resolve({ data: { site: { ...site(), publicacao: { dominio: "cafe.com.br", no_ar: false } }, removidos: ["cafe.com.br"] }, error: null });
    if (f === "mesa-site" && body.acao === "dominio_ligar") return Promise.resolve({ data: { site: site(), verificado: false, estado: "aguardando_dns" }, error: null });
    return Promise.resolve({ data: { trabalho: { id: "t" } }, error: null });
  });
});

describe("Versões: prévia na nuvem por versão", () => {
  it("a versão salva tem 'Abrir prévia' com o link da Vercel; o botão de cima pede a prévia do estado atual", async () => {
    const { container } = montar(h(Versoes, { site: site(), trabalhos: [salvo()] }));
    const link = container.querySelector("[data-abrir-previa-nuvem]") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(PREVIA);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("title")).toMatch(/^Abrir prévia/);
    fireEvent.click(container.querySelector("[data-pedir-previa-nuvem]")!);
    await waitFor(() => expect(corpos("mesa-site", "previa_nuvem_pedir")).toEqual([{ acao: "previa_nuvem_pedir", site_id: SITE }]));
  });
});

describe("Publicação na Vercel da agência", () => {
  it("o Confirmar mostra o que entra, muda e sai do ar, e manda o commit da versão salva", async () => {
    const { container } = montar(h(EtapaPublicacao, { site: site() }));
    await waitFor(() => expect(container.querySelector("[data-versao-a-publicar]")!.getAttribute("data-versao-a-publicar")).toBe("bbbbbbbb"));
    expect(container.querySelector("[data-publicado]")!.getAttribute("data-publicado")).toBe("no_ar");
    const publicar = container.querySelector("[data-publicar]") as HTMLButtonElement;
    await waitFor(() => expect(publicar.disabled).toBe(false));
    fireEvent.click(publicar);
    await waitFor(() => expect(document.querySelector("[data-comparacao-com-o-ar]")).not.toBeNull());
    const lista = document.querySelector("[data-comparacao-com-o-ar]")!;
    expect(Array.from(lista.querySelectorAll("li")).map((l) => l.textContent)).toEqual(["Entra: /obrigado/.", "Muda: /.", "Sai do ar: /sobre/."]);
    fireEvent.click(document.querySelector("[data-confirmar-publicar]")!);
    await waitFor(() => expect(corpos("mesa-site", "publicar")).toHaveLength(1));
    expect(corpos("mesa-site", "publicar")[0]).toMatchObject({ confirmar: true, versao: COMMIT });
  });

  it("tirar do ar pede Confirmar e chama o servidor; ligar o domínio é um ícone com nome no title", async () => {
    const { container } = montar(h(EtapaPublicacao, { site: site() }));
    await waitFor(() => expect(container.querySelector("[data-tirar-do-ar]")).not.toBeNull());
    const tirar = container.querySelector("[data-tirar-do-ar]") as HTMLButtonElement;
    expect(tirar.getAttribute("title")).toBe("Tirar do ar");
    fireEvent.click(tirar);
    expect(corpos("mesa-site", "publicacao_tirar_do_ar")).toHaveLength(0);
    fireEvent.click(await screen.findByText("Confirmar e tirar do ar"));
    await waitFor(() => expect(corpos("mesa-site", "publicacao_tirar_do_ar")).toEqual([{ acao: "publicacao_tirar_do_ar", site_id: SITE, confirmar: true }]));
    const ligar = container.querySelector("[data-ligar-dominio]") as HTMLButtonElement;
    expect(ligar.getAttribute("title")).toMatch(/Ligar o domínio na Vercel/);
    expect(ligar.textContent).toBe("");
    fireEvent.click(ligar);
    await waitFor(() => expect(corpos("mesa-site", "dominio_ligar")).toHaveLength(1));
  });
});
