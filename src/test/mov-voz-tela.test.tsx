import { createElement as h, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente MOV (30/09): a narração na tela da Mesa Motion. Sem a chave da
 * ElevenLabs a seção diz o que falta e nada que gasta fica clicável; com a
 * chave e a voz, "Gerar a narração" mostra o custo e pede o Confirmar; a
 * tag de emoção entra na fala; a janela dos poucos cliques pula o que já
 * está feito e explica o que falta.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia: Record<string, unknown> = {};
  ["select", "eq", "in", "order", "limit", "is", "not", "gte", "lt", "maybeSingle", "single"].forEach((k) => (cadeia[k] = () => cadeia));
  (cadeia as { then: unknown }).then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn(() => cadeia),
      storage: { from: vi.fn(() => ({ upload: vi.fn(async () => ({ error: null })) })) },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import VozDoFilme from "@/components/mesa-motion/VozDoFilme";
import PoucosCliques from "@/components/mesa-motion/PoucosCliques";
import JanelaDasVozes from "@/components/mesa-motion/JanelaDasVozes";
import { EfeitosSobMedida } from "@/components/mesa-motion/SomGerado";
import { cenaDaLinha, normalizarFilme } from "../../supabase/functions/mesa-motion/modulos/motion-metodo";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const FILME = "33333333-3333-4333-8333-333333333333";
const cena1 = cenaDaLinha({ ordem: 1, id: "c1", titulo: "Gancho", peca: "abertura", params: { titulo: "Oi" }, duracao_s: 4 }).cena;
const cena2 = cenaDaLinha({ ordem: 2, id: "c2", titulo: "Marca", peca: "cartao_final", params: { chamada: "Fale com a gente" }, duracao_s: 4 }).cena;

const bruto = (som: Record<string, unknown> = {}) => ({
  id: FILME,
  client_id: CLIENTE,
  marca_id: null,
  nome: "Filme AcelerIQ",
  tipo: "apresentacao",
  etapa: "som",
  formatos: ["9:16"],
  insumos: {},
  entrevista: { duracao: "15" },
  brand: { essencia: "Método", publico: "", promessa: "Marketing com método", tom: "confiante", provas: [], evitar: "", movimento: "", regras: "", beats: [] },
  storyboards: [{ conceito: "A", resumo: "r", cenas: [cena1], avisos: [] }],
  storyboard_escolhido: 0,
  cenas: [cena1, cena2],
  renders: [],
  critica: {},
  som,
  montagem: {},
  entrega: {},
  modelo: null,
  custo_usd: 0,
  arquivado_em: null,
  criado_em: "",
  atualizado_em: "",
});

const valor = {
  clientId: CLIENTE,
  clientName: "AcelerIQ",
  userId: "u1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [{ id: "openrouter:anthropic/claude-opus-5.5", provedor: "openrouter", modelo_api: "anthropic/claude-opus-5.5", tipo: "texto", rotulo: "Claude Opus 5.5", preco_entrada_1m: 4, preco_saida_1m: 20, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: ["motion"], ativo: true }],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
  versaoCarteira: 0,
  marcas: [],
  marca: null,
} as unknown as MesaValor;

function montar(no: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [`/mesa-motion?client=${CLIENTE}&filme=${FILME}&etapa=som`] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor }, no))));
}

type Corpo = Record<string, unknown>;
const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c) => (c[1] as { body: { acao: string } }).body.acao === acao).map((c) => (c[1] as { body: Corpo }).body);

function responder(situacao: Record<string, unknown>, extra: (b: Corpo) => unknown = () => undefined) {
  mock.invoke.mockImplementation(async (_f: string, { body }: { body: Corpo }) => {
    const proprio = extra(body);
    if (proprio !== undefined) return { data: proprio, error: null };
    if (body.acao === "voz_situacao") return { data: { tem_chave: false, aviso_chave: "A narração precisa da chave da ElevenLabs no servidor (ELEVENLABS_API_KEY).", vozes: [], padrao: null, indisponivel: false, aviso: null, ...situacao }, error: null };
    if (body.acao === "filme_salvar") return { data: { filme: { ...bruto(), som: body.som || {} } }, error: null };
    return { data: {}, error: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
});

describe("narração na etapa Voz e som", () => {
  it("sem a chave no servidor: diz o que falta e não deixa gerar", async () => {
    responder({});
    const filme = normalizarFilme(bruto({ narracao: { ligada: true, falas: { c1: "Oi, marca" } } }))!;
    montar(h(VozDoFilme, { filme, links: {} }));
    expect(await screen.findByText(/ELEVENLABS_API_KEY/)).toBeTruthy();
    const gerar = document.querySelector("[data-gerar-narracao]") as HTMLButtonElement;
    expect(gerar.disabled).toBe(true);
    // Escrever as falas não depende da chave (é o modelo de texto).
    expect((document.querySelector("[data-escrever-falas]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("com a chave e a voz: o custo aparece antes e o Confirmar gera o roteiro inteiro", async () => {
    const voz = { id: "v1", voice_id: "abcdEFGH1234", nome: "Clara", descricao: null, origem: "biblioteca", padrao: true, previa_url: null };
    responder({ tem_chave: true, aviso_chave: null, vozes: [voz], padrao: voz }, (b) => (b.acao === "narracao_gerar" ? { filme: bruto(), links: {}, custo_usd: 0.003, avisos: [] } : undefined));
    const filme = normalizarFilme(bruto({ narracao: { ligada: true, voz: { voice_id: "abcdEFGH1234", nome: "Clara", origem: "biblioteca" }, falas: { c1: "[warmly] Seu marketing sem plano?", c2: "Fale com a gente." } } }))!;
    montar(h(VozDoFilme, { filme, links: {} }));
    const gerar = await waitFor(() => {
      const b = document.querySelector("[data-gerar-narracao]") as HTMLButtonElement;
      expect(b.disabled).toBe(false);
      return b;
    });
    expect(gerar.textContent).toMatch(/US\$/);
    fireEvent.click(gerar);
    expect(await screen.findByText(/2 cenas numa leitura só/)).toBeTruthy();
    fireEvent.click(document.querySelector("[data-confirmar-narracao]") as HTMLButtonElement);
    await waitFor(() => expect(chamadas("narracao_gerar")[0]).toMatchObject({ filme_id: FILME, modo: "roteiro" }));
  });

  it("a tag de emoção entra na fala e salva", async () => {
    responder({ tem_chave: true, aviso_chave: null });
    const filme = normalizarFilme(bruto({ narracao: { ligada: true, falas: { c1: "Oi" } } }))!;
    montar(h(VozDoFilme, { filme, links: {} }));
    const botoes = await screen.findAllByRole("button", { name: "Acolhedor" });
    fireEvent.click(botoes[0]);
    await waitFor(() => expect(chamadas("filme_salvar")[0]).toBeTruthy());
    const narracao = (chamadas("filme_salvar")[0].som as { narracao: { falas: Record<string, string> } }).narracao;
    expect(narracao.falas.c1).toContain("[warmly]");
  });
});

describe("filme em poucos cliques", () => {
  it("pula o que já está feito e diz por que a narração não entra", async () => {
    responder({});
    const filme = normalizarFilme(bruto())!;
    montar(h(PoucosCliques, { filme }));
    fireEvent.click(document.querySelector("[data-poucos-cliques]") as HTMLButtonElement);
    expect(await screen.findByText("Filme em poucos cliques")).toBeTruthy();
    const marcado = (id: string) => (document.querySelector(`[data-passo="${id}"] input`) as HTMLInputElement).checked;
    expect(marcado("brand")).toBe(false);
    expect(marcado("storyboards")).toBe(false);
    expect(marcado("escolher")).toBe(false);
    expect(marcado("falas")).toBe(true);
    await waitFor(() => expect(screen.getByText("Falta a chave da ElevenLabs no servidor.")).toBeTruthy());
    expect((document.querySelector('[data-passo="narracao"] input') as HTMLInputElement).disabled).toBe(true);
  });
});

describe("correções da revisão (MOV)", () => {
  it("poucos cliques num filme adiantado: direção, encaixe e stills já feitos vêm desmarcados; reaplicar avisa que invalida o aprovado", async () => {
    responder({});
    const c1 = { ...cena1, still_aprovado: true };
    const c2 = { ...cena2, still_aprovado: true };
    const filme = normalizarFilme({ ...bruto(), entrevista: { duracao: "15", acabamento: "grao" }, cenas: [c1, c2] })!;
    montar(h(PoucosCliques, { filme }));
    fireEvent.click(document.querySelector("[data-poucos-cliques]") as HTMLButtonElement);
    expect(await screen.findByText("Filme em poucos cliques")).toBeTruthy();
    const caixa = (id: string) => document.querySelector(`[data-passo="${id}"] input`) as HTMLInputElement;
    expect(caixa("direcao").checked).toBe(false);
    expect(caixa("stills").checked).toBe(false);
    expect(document.querySelector("[data-aviso-invalida]")).toBeNull();
    fireEvent.click(caixa("direcao"));
    expect(caixa("direcao").checked).toBe(true);
    expect((document.querySelector("[data-aviso-invalida]") as HTMLElement).textContent).toMatch(/2 stills já foram aprovados/);
  });

  it("poucos cliques: o Jev falhou na escolha do storyboard, fica o 1 e a tela avisa", async () => {
    responder({}, (b) => {
      if (b.acao === "storyboard_sugerir") throw new Error("O Jev não respondeu agora.");
      if (b.acao === "storyboard_escolher") return { filme: { ...bruto(), storyboard_escolhido: 0 } };
      return undefined;
    });
    const filme = normalizarFilme({ ...bruto(), storyboards: [{ conceito: "A", resumo: "r", cenas: [cena1], avisos: [] }, { conceito: "B", resumo: "r", cenas: [cena2], avisos: [] }], storyboard_escolhido: null, cenas: [] })!;
    montar(h(PoucosCliques, { filme }));
    fireEvent.click(document.querySelector("[data-poucos-cliques]") as HTMLButtonElement);
    await screen.findByText("Filme em poucos cliques");
    ["falas", "direcao", "stills", "encaixar"].forEach((id) => {
      const c = document.querySelector(`[data-passo="${id}"] input`) as HTMLInputElement;
      if (c.checked && !c.disabled) fireEvent.click(c);
    });
    fireEvent.click(document.querySelector("[data-fazer-poucos-cliques]") as HTMLButtonElement);
    await waitFor(() => expect(chamadas("storyboard_escolher")[0]).toMatchObject({ indice: 0 }));
    expect(await screen.findByText(/O Jev não respondeu .*ficou o storyboard 1/)).toBeTruthy();
  });

  it("biblioteca: a Voice Library em português do Brasil, a voz entra na conta ao usar e o desenho pede Confirmar", async () => {
    const publica = { voice_id: "pubVOZ12345", public_owner_id: "dono1234567", nome: "Ana Paula", categoria: "professional", descricao: "Narradora brasileira", previa_url: "https://x/p.mp3", previa_pt: null, idiomas: ["pt"], rotulos: {}, locale: "pt-BR" };
    responder({ tem_chave: true, aviso_chave: null }, (b) => {
      if (b.acao === "vozes_compartilhadas") return { vozes: [publica], proxima: 1 };
      if (b.acao === "voz_escolher") return { voz_id: "v9", voice_id: "contaVOZ999", vozes: [] };
      if (b.acao === "voz_desenhar") return { previas: [], custo_usd: 0.1 };
      return undefined;
    });
    const usar = vi.fn();
    const filme = normalizarFilme(bruto())!;
    montar(h(JanelaDasVozes, { aberta: true, onFechar: () => {}, filme, temChave: true, onUsar: usar }));
    fireEvent.click(await screen.findByRole("tab", { name: "Biblioteca" }));
    expect(await screen.findByText("Ana Paula")).toBeTruthy();
    expect(chamadas("vozes_compartilhadas")[0]).toMatchObject({ locale: "pt-BR", pagina: 0 });
    expect(screen.getByText("PT-BR")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Usar/ }));
    await waitFor(() => expect(chamadas("voz_escolher")[0]).toMatchObject({ voice_id: "pubVOZ12345", public_owner_id: "dono1234567" }));
    await waitFor(() => expect(usar).toHaveBeenCalledWith({ voice_id: "contaVOZ999", nome: "Ana Paula", origem: "biblioteca" }));

    fireEvent.click(screen.getByRole("tab", { name: "Desenhar" }));
    fireEvent.change(screen.getByLabelText("Descrição da voz"), { target: { value: "mulher brasileira de 35 anos, voz quente e confiante" } });
    fireEvent.click(document.querySelector("[data-desenhar-voz]") as HTMLButtonElement);
    expect(chamadas("voz_desenhar")).toHaveLength(0);
    expect(await screen.findByText(/Saldo da carteira/)).toBeTruthy();
    fireEvent.click(document.querySelector("[data-confirmar-desenho]") as HTMLButtonElement);
    await waitFor(() => expect(chamadas("voz_desenhar")).toHaveLength(1));
  });

  it("efeito sob medida: trocou o storyboard, o pedido vai com a cena que existe", async () => {
    responder({ tem_chave: true, aviso_chave: null }, (b) => (b.acao === "efeito_gerar" ? { filme: bruto(), links: {}, custo_usd: 0.02 } : undefined));
    const filme = normalizarFilme(bruto())!;
    const r = montar(h(EfeitosSobMedida, { filme, links: {}, temChave: true }));
    const nova = { ...cena2, id: "n1", titulo: "Nova" };
    const trocado = normalizarFilme({ ...bruto(), cenas: [nova] })!;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    r.rerender(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor }, h(EfeitosSobMedida, { filme: trocado, links: {}, temChave: true })))));
    fireEvent.click(document.querySelector("[data-novo-efeito]") as HTMLButtonElement);
    fireEvent.change(await screen.findByPlaceholderText(/porta de vidro/), { target: { value: "porta de vidro abrindo" } });
    fireEvent.click(screen.getByRole("button", { name: /Gerar ·/ }));
    await waitFor(() => expect(chamadas("efeito_gerar")[0]).toMatchObject({ cena_id: "n1" }));
  });
});
