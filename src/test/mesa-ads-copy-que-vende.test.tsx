import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Copy que vende a ideia (dono, 22/10/2026: "os ganchos e copy dos criativos
 * têm que ser muito melhores, porque os criativos são pra vender a ideia").
 * Frameworks no prompt, ganchos do banco como exemplo (com e sem tabela),
 * variações e Jev, política, nada inventado, humanizer e a tela das variações.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "order", "limit", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn(), from: (t: string) => consulta(t) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { modeloRecomendadoParaCopy, resolverModeloDaCopy, ESTRUTURAS_DE_COPY, ROTULO_DO_ANGULO_DE_VENDA } from "@/components/mesa-ads/adsApi";
import { useModeloDaCopy } from "@/components/mesa-ads/ModeloDaCopy";
import VariacoesDaCopy, { avisosDoCartao, linhaDoJev, type VariacaoDoRefino } from "@/components/mesa-ads/VariacoesDaCopy";
import { NICHOS } from "../../supabase/functions/_shared/conhecimento-ads";
import { FRAMEWORKS_IDS } from "../../supabase/functions/mesa-ads/modulos/conhecimento-criativo";
import { escolherMelhores, notaDaCopy, porqueDaCopy } from "../../supabase/functions/mesa-ads/melhores-criativos";
import {
  ANGULOS_DE_VENDA,
  ANGULOS_DE_VENDA_IDS,
  angulosParaVariacoes,
  avisosDaVenda,
  blocoDaVenda,
  blocoDeRespostaDireta,
  conferirAnuncio,
  fatosDaOferta,
  FRAMEWORKS_DE_RESPOSTA_DIRETA,
  ganchosParaACopy,
  humanizarAnuncio,
  motivosDePolitica,
  NIVEIS_VENDE_A_IDEIA,
  ousadiaDoPedido,
  perguntasDeVenda,
  semFonte,
  type VendaDaCopy,
} from "../../supabase/functions/mesa-ads/modulos/copy-de-resposta";

const raiz = resolve(__dirname, "../..");
const indexAds = readFileSync(resolve(raiz, "supabase/functions/mesa-ads/index.ts"), "utf8").replace(/\r\n/g, "\n");
const TRAVESSAO = /—|^[ \t]*–|[ \t]–[ \t]/m;

const OFERTA = {
  nome: "Limpeza de sofá a seco em Curitiba",
  para_quem: "famílias com pet e criança",
  promessa: "sofá seco no mesmo dia",
  entregaveis: ["higienização com extratora", "impermeabilização opcional"],
  ancoragem: "R$ 189 o sofá de 3 lugares",
  garantia: "refazemos em 7 dias se a mancha voltar",
  cta: "Chame no WhatsApp",
};
const FATOS = fatosDaOferta(OFERTA, null);
const ESTETICA = NICHOS.find((n) => n.id === "estetica")!;
const VENDA: VendaDaCopy = {
  nicho: { id: ESTETICA.id, nome: ESTETICA.nome, dores: ESTETICA.dores, desejos: ESTETICA.desejos, ganchos: ESTETICA.ganchos, riscos_de_politica: ESTETICA.riscos_de_politica },
  ganchos: [{ texto: "Natural é técnica, não sorte", gatilho: "contrário", nicho: "estetica" }],
};

// ------------------------------------------------------------------ prompt

describe("motor de copy de anúncio: frameworks, ângulos e nicho no prompt", () => {
  it("o bloco traz os 6 frameworks de resposta direta, a primeira linha, título, CTA, voz humana e nada inventado", () => {
    const b = blocoDeRespostaDireta({ fatos: FATOS, angulos: ["dor", "contrario", "identidade"], venda: VENDA });
    for (const f of ["PAS", "AIDA", "antes, depois e ponte", "prova, oferta e urgência", "objeção e resposta", "\"porque\" com razão real"]) expect(b).toContain(f);
    expect(b).toContain("VENDER A IDEIA");
    expect(b).toContain("Primeira linha que para o dedo");
    expect(b).toContain("Título (até 40 caracteres)");
    expect(b).toContain("Voz humana");
    expect(b).toContain("Nada inventado");
    expect(b).toContain("variação 2: Contrário");
    expect(b).toContain("variação 3: Identidade");
    expect(b).toContain("nicho: Estética");
    expect(b).toContain("Natural é técnica, não sorte");
    expect(TRAVESSAO.test(b)).toBe(false);
    // Os ids citados existem como estrutura (o esquema aceita) e a tela tem o rótulo de cada um.
    for (const f of FRAMEWORKS_DE_RESPOSTA_DIRETA) {
      expect(FRAMEWORKS_IDS).toContain(f.id);
      expect(ESTRUTURAS_DE_COPY[f.id]).toBeTruthy();
    }
  });

  it("3 a 5 variações saem em ângulos distintos; contrário e identidade têm rótulo na tela", () => {
    for (const n of [3, 4, 5]) {
      const a = angulosParaVariacoes(n, { temProva: true, temUrgencia: true });
      expect(new Set(a).size).toBe(n);
    }
    for (const id of ANGULOS_DE_VENDA_IDS) expect(ROTULO_DO_ANGULO_DE_VENDA[id]).toBe(ANGULOS_DE_VENDA[id].rotulo);
    // Identidade nunca por atributo pessoal.
    expect(ANGULOS_DE_VENDA.identidade.instrucao).toContain("nunca por atributo pessoal");
  });
});

// ------------------------------------------------------------------ ganchos do banco

describe("ganchos_vencedores como exemplo (com e sem tabela)", () => {
  const linhas = [
    { gancho: "Ninguém te conta isso antes da agulha", nicho: "estetica", formato: "anuncio", gatilho: "curiosidade", nota: 9 },
    { gancho: "Seu carro fala antes de quebrar", nicho: "automotivo", formato: "anuncio", gatilho: "dor", nota: 10 },
    { gancho: "Gancho de reel, não de anúncio", nicho: "estetica", formato: "reels", nota: 10 },
    { texto: "Três perguntas antes de pagar", nicho: "geral", formato: "anuncio", nota: 5 },
    { gancho: "Desligado", nicho: "estetica", formato: "anuncio", ativo: false },
  ];

  it("do nicho primeiro, depois os gerais; outro nicho, outro formato e inativo ficam de fora", () => {
    const g = ganchosParaACopy(linhas, { id: "estetica", nome: ESTETICA.nome });
    expect(g.map((x) => x.texto)).toEqual(["Ninguém te conta isso antes da agulha", "Três perguntas antes de pagar"]);
    expect(g[0].gatilho).toBe("curiosidade");
  });

  it("sem tabela (ou erro), sem exemplos e sem quebrar; o bloco some quando não há nicho nem gancho", () => {
    expect(ganchosParaACopy(null, null)).toEqual([]);
    expect(ganchosParaACopy(undefined, { id: "x", nome: "x" })).toEqual([]);
    expect(blocoDaVenda({ nicho: null, ganchos: [] })).toBe("");
    const b = blocoDeRespostaDireta({ fatos: FATOS, angulos: ["dor"], venda: { nicho: null, ganchos: [] } });
    expect(b).not.toContain("GANCHOS QUE JÁ VENDERAM");
    expect(blocoDaVenda(VENDA)).toContain("nunca copie a frase");
  });

  it("o servidor lê a tabela formato anuncio de forma tolerante e avisa quando não tem", () => {
    const i = indexAds.indexOf("async function vendaDaCopy(");
    const corpo = indexAds.slice(i, indexAds.indexOf("\n}\n", i));
    expect(corpo).toContain('from("ganchos_vencedores")');
    expect(corpo).toContain('.eq("formato", "anuncio")');
    expect(corpo).toContain("catch");
    expect(corpo).toContain("sem os exemplos");
    // As três escritas de copy de anúncio recebem o nicho e os ganchos, e o Jev mede a venda.
    expect(indexAds.split("blocoDeRespostaDireta({ fatos, angulos: angulosDeVenda, venda })").length - 1).toBe(3);
    expect(indexAds.split("venda: { nicho: venda.nicho, fatos: fatos.linhas }").length - 1).toBe(3);
  });
});

// ------------------------------------------------------------------ Jev: variações escolhidas pela venda

describe("variações e Jev: vende a ideia, nicho e prova real", () => {
  it("três Score de 5 níveis por copy, com o nicho e os fatos no estado", () => {
    const q = perguntasDeVenda("`copies[0]`");
    expect(q.vende.type).toBe("score");
    expect(q.vende.criteria).toBe(NIVEIS_VENDE_A_IDEIA);
    expect(q.nicho.criteria).toHaveLength(5);
    expect(q.prova.criteria[0]).toContain("não está nos fatos");
    expect(q.vende.instructions).toContain("`copies[0]`");
    expect(indexAds).toContain('questions[`vende_${i}`] = q.vende;');
    expect(indexAds).toContain("state.fatos = opcoes.venda.fatos");
  });

  it("a que vende mais vence, mesmo com a mesma clareza; política continua sendo trava", () => {
    const fraca = { clareza: 8, parada: 7, vende: 3, nicho: 4, prova_real: 5 };
    const forte = { clareza: 8, parada: 7, vende: 9, nicho: 8, prova_real: 7 };
    const arriscada = { clareza: 9, parada: 9, vende: 10, nicho: 10, prova_real: 10, alerta_politica: true };
    expect(notaDaCopy(forte)!).toBeGreaterThan(notaDaCopy(fraca)!);
    expect(escolherMelhores([fraca, arriscada, forte], 1).escolhidos).toEqual([2]);
    // Nota antiga (sem as de venda) dá o mesmo de antes.
    expect(notaDaCopy({ clareza: 8, parada: 6, prob_generico: 0.2, tom: 7 })).toBe(7.4);
    expect(porqueDaCopy(forte, "pas", 1, 4)).toContain("vende 9");
  });

  it("a nota vira aviso, nunca reescrita", () => {
    expect(avisosDaVenda({ vende: 4.5, nicho: 8, prova_real: 2 })).toEqual([
      "Vende pouco a ideia pelo Jev (nota 4,5).",
      "O Jev viu prova que não está nos fatos: confira número, resultado e depoimento.",
    ]);
    expect(avisosDaVenda({ vende: 8, nicho: 7, prova_real: 6 })).toEqual([]);
    expect(avisosDaVenda(null)).toEqual([]);
  });
});

// ------------------------------------------------------------------ política, nada inventado e humanizer

describe("política da Meta, nada inventado e humanizer", () => {
  const anuncio = (texto_principal: string, extra: Record<string, string> = {}) => ({ texto_principal, texto_principal_longo: `${texto_principal} Chame no WhatsApp.`, titulo: "Sofá seco no mesmo dia", ...extra });

  it("atributo pessoal e ganho ou cura garantidos reprovam como política", () => {
    const a = conferirAnuncio(anuncio("Você está endividado e sem saída? Limpeza de sofá a seco resolve."), FATOS);
    expect(a.motivos.some((m) => m.tipo === "atributo_pessoal")).toBe(true);
    const b = conferirAnuncio(anuncio("Lucro garantido com a limpeza de sofá a seco."), FATOS);
    expect(motivosDePolitica(b).map((m) => m.tipo)).toContain("promessa");
  });

  it("preço, desconto e prazo só com fonte; o que está na oferta passa", () => {
    expect(semFonte("Sofá por R$ 189 e garantia de 7 dias", FATOS.linhas)).toEqual([]);
    expect(semFonte("Só hoje R$ 99 com 30% de desconto em 2 horas", FATOS.linhas)).toEqual(["r$ 99", "30%", "2 horas", "desconto"]);
    expect(semFonte("Frete grátis", FATOS.linhas)).toEqual(["frete grátis"]);
    const c = conferirAnuncio(anuncio("Sofá de família com pet por R$ 99: limpeza de sofá a seco hoje."), FATOS);
    expect(c.motivos.find((m) => m.tipo === "inventado")!.texto).toContain("r$ 99");
    // Sem as linhas dos fatos (chamada antiga), a conferência não inventa reprovação.
    expect(conferirAnuncio(anuncio("Sofá por R$ 99 com limpeza de sofá a seco."), { termos: FATOS.termos }).motivos.some((m) => m.tipo === "inventado")).toBe(false);
  });

  it("humanizer em código: pontuação repetida, emoji em excesso e espaço antes da pontuação", () => {
    const r = humanizarAnuncio("Seu sofá limpo hoje!!! 😍😍😍😍 Chame já ??");
    expect(r.texto).toBe("Seu sofá limpo hoje! 😍😍 Chame já?");
    expect(r.ajustes.length).toBeGreaterThan(0);
    expect(humanizarAnuncio("Texto normal.").ajustes).toEqual([]);
    expect(indexAds).toContain('humanizarAnuncio(limparCopy(v, "anuncio", { cortar: false }).texto).texto');
  });

  it("mais ousada e mais segura viram tom e pedido prontos", () => {
    expect(ousadiaDoPedido("ousada")).toMatchObject({ tom: "agressivo" });
    expect(ousadiaDoPedido("segura")!.pedido).toContain("nada que a Meta possa reprovar");
    expect(ousadiaDoPedido("outra")).toBeNull();
    expect(indexAds).toContain("if (!ousadia && pedeRefazerTudo(pedidoEquipe))");
  });
});

// ------------------------------------------------------------------ modelo

const LUNA: ModeloIa = {
  id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", tipo: "texto", rotulo: "OpenAI: GPT-6 Luna",
  preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: null, preco_imagem: null,
  raciocinio: ["low", "medium", "high"], padrao_para: ["estrategista"], ativo: true,
};
const OPUS: ModeloIa = { ...LUNA, id: "anthropic:claude-opus-5", provedor: "anthropic", modelo_api: "claude-opus-5", rotulo: "Claude Opus 5", preco_entrada_1m: 5, preco_saida_1m: 25, padrao_para: [] };

describe("modelo da copy: o melhor para copy como padrão", () => {
  it("papel copy no catálogo, senão Claude Opus, senão o estrategista; a escolha guardada vale", () => {
    expect(modeloRecomendadoParaCopy([LUNA])!.id).toBe(LUNA.id);
    expect(modeloRecomendadoParaCopy([LUNA, OPUS])!.id).toBe(OPUS.id);
    expect(modeloRecomendadoParaCopy([LUNA, OPUS, { ...LUNA, id: "x:copy", padrao_para: ["copy"] }])!.id).toBe("x:copy");
    expect(modeloRecomendadoParaCopy([LUNA, { ...OPUS, disponivel: false }])!.id).toBe(LUNA.id);
    expect(resolverModeloDaCopy([LUNA, OPUS], null).modelo!.id).toBe(OPUS.id);
    expect(resolverModeloDaCopy([LUNA, OPUS], { modelo: LUNA.id, raciocinio: "low" })).toMatchObject({ modelo: LUNA, raciocinio: "low" });
  });
});

// ------------------------------------------------------------------ tela

const valorDaMesa = (): MesaValor => ({
  clientId: "c-1", clientName: "Sofá Limpo", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: [LUNA], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

const VARIACOES: VariacaoDoRefino[] = [
  { texto_principal: "Pet subiu no sofá de novo? Seco no mesmo dia.", titulo: "Sofá seco no mesmo dia", cta_meta: "SEND_MESSAGE", framework: "pas", angulo_de_venda: "dor", melhor: true, jev: { vende: 8.5, clareza: 8, nicho: 7, prova_real: 6, parada: 7 } as never, porque: "Melhor de 3 pela conferência do Jev." },
  { texto_principal: "Lavar sofá não é jogar água.", titulo: "Limpeza a seco", cta_meta: "SEND_MESSAGE", framework: "porque_razao_real", angulo_de_venda: "contrario", jev: { vende: 4, clareza: 7, alerta_politica: true } as never, avisos_venda: ["Vende pouco a ideia pelo Jev (nota 4)."] },
];

function Tela(props: { onMudar: any; onUsar: any; onNovas: any }) {
  const modelo = useModeloDaCopy();
  return h(VariacoesDaCopy, { variacoes: VARIACOES, criativoId: "cr-1", modelo, ...props });
}

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("tela das variações: lado a lado, ângulo, Jev como aviso, editar, escolher e ousadia em um clique", () => {
  it("mostra cada variação com o ângulo, a estrutura, as notas e os avisos; editar e usar chamam a tela", async () => {
    const onMudar = vi.fn();
    const onUsar = vi.fn();
    const onNovas = vi.fn();
    mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
      body.acao === "copy_variar" ? { data: { variacoes: [{ texto_principal: "Nova ousada", ousadia: "ousada" }], avisos: [], custo_usd: 0.01 }, error: null } : { data: {}, error: null },
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(Tela, { onMudar, onUsar, onNovas }) }))));
    expect(container.querySelector("[data-variacoes-lado-a-lado]")).toBeTruthy();
    expect(container.querySelectorAll("[data-variacao-da-copy]")).toHaveLength(2);
    expect(Array.from(container.querySelectorAll("[data-angulo-da-variacao]")).map((e) => e.textContent)).toEqual(["ÂnguloDor", "ÂnguloContrário"]);
    expect(screen.getByText("Contrário")).toBeTruthy();
    expect(screen.getByText("Porque (razão real)")).toBeTruthy();
    expect(screen.getByText("Jev: vende 8,5 · clareza 8 · nicho 7 · prova 6 · parada 7")).toBeTruthy();
    expect(screen.getByText("Vende pouco a ideia pelo Jev (nota 4).")).toBeTruthy();
    expect(screen.getByText("Risco de política pelo Jev: revise antes de subir.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Título da variação 1"), { target: { value: "Sofá seco hoje" } });
    expect(onMudar).toHaveBeenCalledWith(0, { titulo: "Sofá seco hoje" });
    fireEvent.click(screen.getAllByRole("button", { name: "Usar esta" })[1]);
    expect(onUsar.mock.calls[0][0].angulo_de_venda).toBe("contrario");

    fireEvent.click(screen.getAllByRole("button", { name: /Mais ousada/ })[0]);
    await waitFor(() => expect(mock.invoke.mock.calls.some((c: any[]) => c[1] && c[1].body && c[1].body.acao === "copy_variar")).toBe(true));
    const corpo = mock.invoke.mock.calls.map((c: any[]) => c[1].body).find((b: any) => b.acao === "copy_variar");
    expect(corpo).toMatchObject({ criativo_id: "cr-1", ousadia: "ousada", quantidade: 2, base: { angulo_de_venda: "dor", framework: "pas" }, modelo_id: LUNA.id });
    await waitFor(() => expect(onNovas).toHaveBeenCalled());
    expect(onNovas.mock.calls[0][0]).toBe(0);
  });

  it("linha do Jev e avisos do cartão em código", () => {
    expect(linhaDoJev(null)).toBe("");
    expect(avisosDoCartao({ texto_principal: "x", jev: { generico: true } as never })).toEqual(["Genérica pelo Jev: serviria a qualquer concorrente."]);
  });
});
