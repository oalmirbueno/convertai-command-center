import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement as h, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * IDV2: as telas novas e as que mudaram abrem sem quebrar (banco e função
 * falsos): Pesquisa com moodboard, Sistema com gerador de paleta, tipografia
 * e padrões, Naming com slogans, Aplicações, Guideline e Apresentação.
 */

// O jsdom não desenha canvas: sem contexto, a peça só não pinta (o desenho real é conferido no navegador).
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];

vi.mock("@/integrations/supabase/client", () => {
  const resposta = { data: [], error: null };
  const q: any = new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok) : () => q),
    apply: () => q,
  });
  const bucket = { createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: null }), download: async () => ({ data: null, error: new Error("sem arquivo") }), upload: async () => ({ data: null, error: null }) };
  return { supabase: { from: () => q, rpc: () => q, storage: { from: () => bucket }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});

const chamar = vi.fn(async (_f: string, corpo: Record<string, unknown>) => {
  if (corpo.acao === "briefing_montar") return { briefing: { campos: {}, origem: { respondido: false, briefing_id: null } } };
  if (corpo.acao === "naming_votos") return { votos: [], resumo: {}, votacao: null };
  return {};
});
vi.mock("@/lib/mesa/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/mesa/api")>("@/lib/mesa/api");
  return { ...real, chamarFuncao: (f: string, c: Record<string, unknown>) => chamar(f, c) };
});
vi.mock("@/lib/mockups/api", () => ({
  lerCatalogoDeMockups: vi.fn(async () => ({ itens: [], semBanco: false })),
  lerTexturas: vi.fn(async () => []),
  lerAplicacoes: vi.fn(async () => []),
  urlAssinada: vi.fn(async () => "blob:x"),
  carregarImagem: vi.fn(async () => {
    throw new Error("sem imagem");
  }),
  sugerirMockups: vi.fn(),
  salvarAplicacao: vi.fn(),
  arquivarAplicacao: vi.fn(),
  enviarParaArquivos: vi.fn(),
  copiaParaBrandbook: vi.fn(),
  ondeEstaALogo: vi.fn(async () => null),
}));

import { MesaProvider } from "@/components/mesa/MesaContexto";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import { ProjetoProvider, type ProjetoDaMesa } from "@/components/mesa-identidade/Comuns";
import EtapaPesquisa from "@/components/mesa-identidade/EtapaPesquisa";
import EtapaSistema from "@/components/mesa-identidade/EtapaSistema";
import EtapaNaming from "@/components/mesa-identidade/EtapaNaming";
import EtapaMockups from "@/components/mesa-identidade/EtapaMockups";
import EtapaApresentacao from "@/components/mesa-identidade/EtapaApresentacao";
import EtapaBriefing from "@/components/mesa-identidade/EtapaBriefing";
import EtapaEntrega from "@/components/mesa-identidade/EtapaEntrega";

const C = "11111111-1111-4111-8111-111111111111";
const P = "33333333-3333-4333-8333-333333333333";

const projeto = {
  id: P,
  client_id: C,
  marca_id: null,
  modo: "zero",
  com_naming: true,
  titulo: "Forno",
  etapa: "sistema",
  concluidas: ["inicio", "briefing", "pesquisa", "estrategia", "naming", "conceito"],
  dados: {
    briefing: { negocio: "Padaria", publico: "Bairro", personalidade: ["calorosa"] },
    pesquisa: { resumo: "Todo mundo usa trigo e rústico.", moodboard: [{ id: "m1", titulo: "Textura", origem: "web", url: "https://x.org/a.jpg", fonte_url: "https://x.org", licenca: "CC0" }] },
    estrategia: { proposito: "Pão de verdade", arquetipo: { principal: "cuidador" }, posicionamento: { declaracao: "Para o bairro, Forno é a padaria que faz na sua frente." }, tom: { atributos: ["calorosa"], fala_assim: ["Seu pão sai às 7h."] } },
    naming: { nome: "Forno Vivo", slogans: [{ id: "s1", texto: "Pão de verdade", tipo: "tagline", por_que: "direto", nota: 0.8 }] },
    conceito: { caminhos: [{ id: "c1", nome: "Forno", ideia: "calor", palavras: ["calor"], arquetipo: "cuidador", paleta: [], tipografia: { titulo: "Fraunces", texto: "Work Sans" }, grafismos: "", tom: [], referencias_visuais: [], riscos: "" }], escolhido: "c1" },
    sistema: { cores: [{ nome: "Verde", papel: "primaria", hex: "#157330" }, { nome: "Papel", papel: "neutra", hex: "#F4F6F4" }], tipografia: [{ familia: "Fraunces", uso: "titulo", pesos: [], licenca: "", alternativa: "" }], propostas_de_paleta: [{ id: "pl1", nome: "Bosque", ideia: "verde", cores: [{ nome: "Verde", papel: "primaria", hex: "#157330" }], avisos: [] }] },
  },
  versao: 5,
  estado: "ativo",
  custo_usd: 0,
  criado_em: "",
  atualizado_em: "",
};

function montar(filho: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const valor: ProjetoDaMesa = { projeto: projeto as any, salvarParte: vi.fn(async () => projeto as any), concluir: vi.fn(), reabrir: vi.fn(), irPara: vi.fn(), guardar: vi.fn() };
  return render(
    h(MemoryRouter, null,
      h(QueryClientProvider, { client: qc },
        h(MesaProvider, { valor: { clientId: C, clientName: "Forno", userId: null, isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: () => undefined, abrirRecarga: () => undefined, abrirChaves: () => undefined, abrirModelos: () => undefined } },
          // IDV3: a Entrega ganhou o documento da entrega (frente DOC), que pede o Confirmar do topo do painel.
          h(ConfirmDialogProvider, null, h(ProjetoProvider, { valor }, filho))))),
  );
}

describe("IDV2: as telas abrem", () => {
  it("Briefing: cada campo e a seção têm o Preencher com IA", () => {
    montar(h(EtapaBriefing));
    expect(screen.getAllByRole("button", { name: /Preencher .* com IA|Preencher tudo/ }).length).toBeGreaterThan(5);
  });

  it("Pesquisa: moodboard com a fonte e o seletor de modelo", () => {
    const { container } = montar(h(EtapaPesquisa));
    expect(container.querySelector('[data-grade-do-moodboard]')).toBeTruthy();
    expect(container.querySelector('[data-seletor-de-modelo="identidade"]')).toBeTruthy();
    expect(screen.getByRole("link", { name: /Fonte de Textura/ }).getAttribute("href")).toBe("https://x.org");
  });

  it("Sistema: contraste, gerador de paleta, propostas do diretor, tipografia e padrões", () => {
    const { container } = montar(h(EtapaSistema));
    expect(container.querySelector("[data-contraste-da-paleta]")).toBeTruthy();
    expect(container.querySelector("[data-gerador-de-paleta]")).toBeTruthy();
    expect(container.querySelector('[data-paleta-proposta="pl1"]')).toBeTruthy();
    expect(container.querySelector("[data-tipografia-da-marca]")).toBeTruthy();
    expect(container.querySelectorAll("[data-par]").length).toBe(6);
    expect(container.querySelector("[data-grafismos-gerados] img")!.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  });

  it("Naming: criador com modelo, 16 técnicas e o slogan", () => {
    const { container } = montar(h(EtapaNaming));
    expect(container.querySelectorAll('[aria-label="Técnicas de naming"] button').length).toBe(16);
    expect(container.querySelector('[data-seletor-de-modelo="naming"]')).toBeTruthy();
    expect(container.querySelector('[data-slogan="s1"]')).toBeTruthy();
  });

  it("Aplicações: peças por código, assinatura escapada e o estúdio", () => {
    const { container } = montar(h(EtapaMockups));
    expect(container.querySelectorAll("[data-peca-da-marca]").length).toBe(5);
    expect(container.querySelector("[data-assinatura-html] table")).toBeTruthy();
  });

  it("Apresentação: roteiro com os slides e o palco", () => {
    const { container } = montar(h(EtapaApresentacao));
    expect(container.querySelector('[data-slide-do-roteiro="abertura"]')).toBeTruthy();
    expect(container.querySelector('[data-palco-da-apresentacao="abertura"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: /Escrever as falas/ })).toBeTruthy();
  });

  it("Entrega: estratégia e apresentação entram na lista", () => {
    montar(h(EtapaEntrega));
    expect(screen.getByText("Estratégia da marca")).toBeTruthy();
    expect(screen.getByText("Apresentação ao cliente")).toBeTruthy();
  });
});
