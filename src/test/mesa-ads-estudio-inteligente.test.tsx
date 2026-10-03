import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estúdio Ads mais inteligente (pedido do dono em 02/10/2026), tela e
 * ligação no servidor: o pedido "muda todo o conteúdo" vira a troca no lugar
 * (antes e depois, Confirmar, Desfazer), sem acrescentar variação; o refino
 * mostra o ângulo de venda e leva a referência com a Fidelidade; o servidor
 * usa a resposta direta, a reescrita única, a leitura do texto da imagem com
 * o leitor barato, a pesquisa web e os logos reais. Função e tabelas simuladas.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ upload: vi.fn(), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import PainelDaCopy from "@/components/mesa-ads/PainelDaCopy";
import { variacoesDaTroca } from "@/components/mesa-ads/TrocaDeConteudo";
import { caixaDoLogo, chavesAds, pedeRefazerTudo, trocaGuardada, type CriativoAds } from "@/components/mesa-ads/adsApi";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const indexAds = ler("supabase/functions/mesa-ads/index.ts");
const corpoDe = (texto: string, nome: string) => {
  const i = texto.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const fins = [texto.indexOf("\nasync function ", i + 10), texto.indexOf("\nfunction ", i + 10), texto.indexOf("\nconst ACOES", i + 10)].filter((x) => x > 0);
  return texto.slice(i, Math.min.apply(null, fins));
};
const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const LUNA: ModeloIa = {
  id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", tipo: "texto", rotulo: "OpenAI: GPT-6 Luna",
  preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: null, preco_imagem: null,
  raciocinio: ["low", "medium", "high"], padrao_para: ["estrategista", "leitura"], ativo: true,
};
const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Sofá Limpo Sintético", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: [LUNA], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

const criativo = (id: string, extra: Record<string, unknown> = {}, formato = "feed_4x5"): CriativoAds => ({
  id, client_id: CLIENTE, plano_id: "p-1", angulo_id: "a1", trabalho_id: `t-${id}`, nome: `Sofá | V1 | ${formato}`, formato: formato as CriativoAds["formato"],
  copy: { texto_principal: "Copy antiga", titulo: "Título antigo", cta_meta: "SEND_MESSAGE", variacao: 1, ...extra },
  status: "rascunho", ad_id: null, evidencia: "E0", criado_em: "2026-10-01T10:00:00Z", atualizado_em: "2026-10-01T10:00:00Z",
});

function montar(filho: any, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
}
const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

const PROPOSTA = (id: string, formato: string) => ({
  criativo_id: id, nome: `Sofá | V1 | ${formato}`, formato, variacao: 1, angulo_de_venda: "dor",
  antes: { texto_principal: "Copy antiga", titulo: "Título antigo", headline_arte: "Velha", cta_meta: "SEND_MESSAGE", angulo_de_venda: null },
  depois: { texto_principal: "Xixi do cachorro no sofá? Seco no mesmo dia em Curitiba.", titulo: "Sofá seco hoje", headline_arte: "Seco no mesmo dia", cta_meta: "SEND_MESSAGE", angulo_de_venda: "dor" },
});

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
  mock.tabelas = {};
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5 }, error: null });
  mock.invoke.mockImplementation(async () => ({ data: { ok: true, custo_usd: 0.01 }, error: null }));
});

describe('tela: "muda todo o conteúdo" troca no lugar, com Confirmar e Desfazer', () => {
  it("o pedido de trocar tudo chama criativos_reescrever (não copy_variar), mostra antes e depois e não acrescenta variação", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "criativos_reescrever") return { data: { refazer_tudo: true, lote_id: "33333333-3333-3333-3333-333333333333", propostas: [PROPOSTA("c1", "feed_4x5"), PROPOSTA("c2", "stories_9x16")], avisos: ["Variação 1: ficou parecida com o conteúdo atual."], custo_usd: 0.02 }, error: null };
      if (body.acao === "criativos_reescrever_confirmar") return { data: { aplicados: 2, aviso: "Conteúdo trocado no lugar.", custo_usd: 0 }, error: null };
      if (body.acao === "criativos_reescrever_desfazer") return { data: { desfeitos: 2, custo_usd: 0 }, error: null };
      return { data: { ok: true }, error: null };
    });
    montar(h(PainelDaCopy, { criativo: criativo("c1"), caminhoDaArte: null }));
    fireEvent.change(screen.getByLabelText("Pedido para refinar a copy"), { target: { value: "muda todo o conteúdo" } });
    const botao = await screen.findByRole("button", { name: /Refazer tudo/ });
    fireEvent.click(botao);
    await waitFor(() => expect(chamadasDe("criativos_reescrever")).toHaveLength(1));
    expect(chamadasDe("copy_variar")).toHaveLength(0);
    expect(chamadasDe("criativos_reescrever")[0]).toMatchObject({ criativo_id: "c1", pedido: "muda todo o conteúdo" });
    expect(await screen.findByText("Conteúdo novo para 2 criativos")).toBeTruthy();
    expect(screen.getByText("Xixi do cachorro no sofá? Seco no mesmo dia em Curitiba.")).toBeTruthy();
    expect(screen.getByText("Copy antiga", { selector: ".line-through" })).toBeTruthy();
    expect(screen.queryByLabelText("Variações de copy")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar troca/ }));
    await waitFor(() => expect(chamadasDe("criativos_reescrever_confirmar")).toHaveLength(1));
    expect(chamadasDe("criativos_reescrever_confirmar")[0]).toMatchObject({ client_id: CLIENTE, lote_id: "33333333-3333-3333-3333-333333333333", criativo_ids: ["c1", "c2"] });
    fireEvent.click(await screen.findByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(chamadasDe("criativos_reescrever_desfazer")).toHaveLength(1));
    expect(await screen.findByText("Troca desfeita")).toBeTruthy();
  });

  it("a troca pendente volta ao abrir o criativo de novo (lida do cache dos criativos)", async () => {
    const pendente = { lote: "L-9", pedido: "refaz tudo", depois: { texto_principal: "Texto novo guardado", angulo_de_venda: "prova" }, criado_em: "2026-10-02" };
    const c1 = criativo("c1", { reescrita_pendente: pendente });
    const c2 = criativo("c2", { reescrita_pendente: pendente }, "stories_9x16");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chavesAds.criativos(CLIENTE), [c1, c2]);
    const t = trocaGuardada(c1, [c1, c2])!;
    expect(t.tipo).toBe("pendente");
    expect(t.ids).toEqual(["c1", "c2"]);
    expect(variacoesDaTroca(t.propostas)).toHaveLength(1);
    montar(h(PainelDaCopy, { criativo: c1, caminhoDaArte: null }), qc);
    expect(await screen.findByText("Texto novo guardado")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Confirmar troca/ })).toBeTruthy();
  });

  it("o refino pontual continua em copy_variar, leva a referência com a Fidelidade e mostra o ângulo de venda", async () => {
    mock.tabelas = { ads_referencias: [{ id: "44444444-4444-4444-4444-444444444444", client_id: CLIENTE, titulo: "Anúncio do concorrente", origem: "link", evidencia: "E0", ficha: {}, tags: [], destaque: false, storage_path: "x.png" }] };
    mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
      body.acao === "copy_variar"
        ? { data: { variacoes: [{ texto_principal: "Sofá com cheiro de xixi?", angulo_de_venda: "dor", framework: "pas", melhor: true }, { texto_principal: "1.200 sofás desde 2019", angulo_de_venda: "prova" }], avisos: [], custo_usd: 0.01 }, error: null }
        : { data: { ok: true }, error: null },
    );
    montar(h(PainelDaCopy, { criativo: criativo("c1", { angulo_de_venda: "desejo" }), caminhoDaArte: null }));
    expect(screen.getByText("Ângulo: Desejo")).toBeTruthy();
    const seletor = (await screen.findByLabelText("Seguir referência")) as HTMLSelectElement;
    await waitFor(() => expect(seletor.options.length).toBe(2));
    fireEvent.change(seletor, { target: { value: "44444444-4444-4444-4444-444444444444" } });
    fireEvent.click(screen.getByRole("radio", { name: "Idêntico" }));
    fireEvent.change(screen.getByLabelText("Pedido para refinar a copy"), { target: { value: "mais curto" } });
    fireEvent.click(screen.getByRole("button", { name: /Refinar copy/ }));
    await waitFor(() => expect(chamadasDe("copy_variar")).toHaveLength(1));
    expect(chamadasDe("copy_variar")[0]).toMatchObject({ criativo_id: "c1", pedido: "mais curto", referencia_id: "44444444-4444-4444-4444-444444444444", fidelidade: "identico" });
    expect(await screen.findByText("Dor")).toBeTruthy();
    expect(screen.getByText("Prova")).toBeTruthy();
  });

  it("o mesmo detector de 'trocar tudo' na tela e no servidor", () => {
    expect(pedeRefazerTudo("Muda todo o conteúdo")).toBe(true);
    expect(pedeRefazerTudo("troca o CTA")).toBe(false);
  });

  it("o logo real entra na arte numa caixa proporcional, com margem e fora da interface do Stories", () => {
    const feed = caixaDoLogo("inf_dir", { largura: 1080, altura: 1350 }, { largura: 200, altura: 100 });
    expect(feed.w).toBe(151);
    expect(feed.h).toBe(76);
    expect(feed.x + feed.w).toBeLessThanOrEqual(1080 - 54 + 1);
    expect(feed.y + feed.h).toBeLessThanOrEqual(1350 - 54 + 1);
    const alto = caixaDoLogo("sup_esq", { largura: 1080, altura: 1350 }, { largura: 100, altura: 400 });
    expect(alto.h).toBe(122);
    expect(alto.w).toBe(30);
    const stories = caixaDoLogo("inf_esq", { largura: 1080, altura: 1920 }, { largura: 100, altura: 100 }, true);
    expect(stories.y + stories.h).toBeLessThanOrEqual(1920 * 0.8);
    const storiesTopo = caixaDoLogo("sup_dir", { largura: 1080, altura: 1920 }, { largura: 100, altura: 100 }, true);
    expect(storiesTopo.y).toBeGreaterThanOrEqual(1920 * 0.14);
  });
});

describe("servidor: a ligação das peças novas na mesa-ads", () => {
  it("as ações novas estão registradas e as que chamam IA respondem com fôlego", () => {
    for (const acao of ["criativos_reescrever", "criativos_reescrever_confirmar", "criativos_reescrever_desfazer", "criativos_reescrever_descartar", "referencia_ler_texto", "mundo_real_ler"]) {
      expect(indexAds).toContain(`  ${acao}: `);
    }
    const longas = indexAds.slice(indexAds.indexOf("const ACOES_LONGAS"), indexAds.indexOf("Deno.serve("));
    for (const acao of ["criativos_reescrever", "referencia_ler_texto", "mundo_real_ler"]) expect(longas).toContain(`"${acao}"`);
  });

  it("copy_variar desvia o 'trocar tudo' para a troca no lugar ANTES de chamar o modelo", () => {
    const corpo = corpoDe(indexAds, "copyVariar");
    const desvio = corpo.indexOf("if (pedeRefazerTudo(pedidoEquipe)) return await criativosReescrever(");
    expect(desvio).toBeGreaterThan(0);
    expect(desvio).toBeLessThan(corpo.indexOf("chamarTexto("));
    expect(corpo).toContain("blocoDeRespostaDireta(");
    expect(corpo).toContain("reescreverReprovadas(");
    expect(corpo).toContain("replicacaoDaReferencia(");
  });

  it("a produção usa a oferta, os ângulos de venda, a reescrita única, a referência, o mundo real e os logos", () => {
    const corpo = corpoDe(indexAds, "criativosProduzir");
    for (const peca of ["fatosDoPlano(", "angulosParaVariacoes(", "blocoDeRespostaDireta(", "reescreverReprovadas(", "replicacaoDaReferencia(", "mundoRealDoAssunto(", "logosDoTexto(", "angulo_de_venda: anguloVenda", "conferencia_casa:", "direcao.logos_reais = logos"]) {
      expect(corpo, peca).toContain(peca);
    }
    // Uma reescrita só: reescreverReprovadas uma vez por ângulo, sem laço.
    expect(corpo.split("reescreverReprovadas(").length - 1).toBe(1);
    const esquema = indexAds.slice(indexAds.indexOf("const ESQUEMA_COPIES"), indexAds.indexOf("const ESQUEMA_VARIAR"));
    expect(esquema).toContain("angulo_de_venda: S(\"string\", { enum: [...ANGULOS_DE_VENDA_IDS] })");
  });

  it("o texto da imagem da referência é lido pelo leitor barato (leitura, raciocínio baixo), com custo e gravado na ficha", () => {
    const corpo = corpoDe(indexAds, "textoLidoDaReferenciaAds");
    expect(corpo).toContain('resolverModelo(undefined, undefined, "leitura", "low")');
    expect(corpo).toContain("agente: AGENTE_LEITOR");
    expect(corpo).toContain("texto_lido: r.lido");
    expect(corpo).toContain("custo: r.custoUsd");
    expect(corpo).toContain("textoLidoDaFicha(ficha)");
  });

  it("a pesquisa do mundo real usa a busca web e não derruba a produção quando falha", () => {
    const corpo = corpoDe(indexAds, "mundoRealDoAssunto");
    expect(corpo).toContain("pesquisaWeb: true");
    expect(corpo).toContain("precisaPesquisar(assunto)");
    expect(corpo).toContain("registrarFalha(");
    expect(corpoDe(indexAds, "mundoRealLer")).toContain("corpo.pesquisar === true");
  });

  it("a troca é no lugar: Confirmar só atualiza (nunca insere card ou trabalho) e guarda o antes; nada escreve na Meta", () => {
    const confirmar = corpoDe(indexAds, "criativosReescreverConfirmar");
    expect(confirmar).not.toContain(".insert(");
    expect(confirmar).toContain("cardsComTextoNovo(");
    expect(confirmar).toContain("copyConfirmada(");
    const reescrever = corpoDe(indexAds, "criativosReescrever");
    expect(reescrever).not.toContain(".insert(");
    expect(reescrever).toContain("copyComProposta(");
    expect(reescrever).toContain("!c.ad_id");
    for (const nome of ["criativosReescrever", "criativosReescreverConfirmar", "criativosReescreverDesfazer", "mundoRealLer", "referenciaLerTexto"]) {
      const c = corpoDe(indexAds, nome);
      expect(c, nome).not.toMatch(/grafoDaMeta|executarNaMeta|graph\.facebook/);
    }
  });

  it("os módulos novos e a tela nova não usam travessão", () => {
    for (const arq of [
      "supabase/functions/mesa-ads/modulos/copy-de-resposta.ts",
      "supabase/functions/mesa-ads/modulos/replicar-referencia.ts",
      "supabase/functions/mesa-ads/modulos/mundo-real.ts",
      "supabase/functions/mesa-ads/modulos/conteudo-do-estudio.ts",
      "src/components/mesa-ads/TrocaDeConteudo.tsx",
      "src/components/mesa-ads/LogosReais.tsx",
    ]) {
      expect(TRAVESSAO.test(ler(arq)), arq).toBe(false);
    }
  });
});
