import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Teste A/B na Mesa Ads (dono, 18/10/2026): "cada ângulo sai com duas versões de
 * criativo para teste (A e B). O resultado do teste alimenta o aprendizado
 * sozinho." Cada versão é o seu ads_criativo (o aprendizado lê o resultado real
 * de cada linha pelo ad_id); o par fica em copy.teste_ab { grupo, versao }.
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
import { escolherMelhores, versoesDiferentes, versoesDoAngulo as versoesNoServidor, versoesParecidas } from "../../supabase/functions/mesa-ads/melhores-criativos";
import {
  arteSobDemanda,
  formatosAutomaticos,
  melhoresDoAngulo,
  partesDaCriacao,
  resolverModeloDaCopy,
  versaoDoTeste,
  versoesDoAngulo,
  type CriativoAds,
  type PlanoAds,
} from "@/components/mesa-ads/adsApi";
import { pegarArteDoPlano } from "@/components/mesa-ads/loteDoEstudio";
import ProducaoDoPlano from "@/components/mesa-ads/ProducaoDoPlano";
import { SeloDaVersao } from "@/components/mesa-ads/Comuns";

const raiz = resolve(__dirname, "../..");
const indexAds = readFileSync(resolve(raiz, "supabase/functions/mesa-ads/index.ts"), "utf8").replace(/\r\n/g, "\n");
const corpoDe = (texto: string, nome: string) => {
  const i = texto.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const fins = [texto.indexOf("\nasync function ", i + 10), texto.indexOf("\nfunction ", i + 10)].filter((x) => x > 0);
  return texto.slice(i, Math.min.apply(null, fins));
};

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const LUNA: ModeloIa = {
  id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", tipo: "texto", rotulo: "OpenAI: GPT-6 Luna",
  preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: null, preco_imagem: null,
  raciocinio: ["none", "low", "medium", "high", "xhigh", "max"], padrao_para: ["estrategista", "leitura", "diretor_arte"], ativo: true,
};
const IMAGEM: ModeloIa = {
  id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
  preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 }, raciocinio: [], padrao_para: ["imagem"], ativo: true,
};
const CATALOGO = [LUNA, IMAGEM];

function montar(filho: any) {
  const valor: MesaValor = {
    clientId: CLIENTE, clientName: "Clínica Sintética", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
    catalogo: CATALOGO, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor, children: filho }))));
}
const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

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
});

const criativo = (id: string, variacao: number, teste: Record<string, unknown> | null): CriativoAds => ({
  id, client_id: CLIENTE, plano_id: "p-1", angulo_id: "a1", trabalho_id: `t-${id}`, nome: null, formato: "feed_4x5",
  copy: { texto_principal: "Base", variacao, ...(teste ? { teste_ab: teste } : {}) } as CriativoAds["copy"], status: "rascunho", ad_id: null, evidencia: "E0", criado_em: "", atualizado_em: "",
});

describe("servidor: o par A/B por ângulo", () => {
  it("versões por ângulo: o par por padrão, a 3ª do plano fica, versoes 1 produz uma só", () => {
    expect(versoesNoServidor(1, undefined)).toBe(2);
    expect(versoesNoServidor(2, undefined)).toBe(2);
    expect(versoesNoServidor(3, undefined)).toBe(3);
    expect(versoesNoServidor(3, 1)).toBe(1);
    expect(versoesNoServidor(Number.NaN, "2")).toBe(2);
    // O espelho da tela dá o mesmo número.
    expect([1, 2, 3].map((v) => versoesDoAngulo({ variacoes: v }))).toEqual([2, 2, 3]);
    expect(versoesDoAngulo({ variacoes: 2 }, 1)).toBe(1);
  });

  it("A é a melhor do Jev; B é a próxima que traz outra ideia, sem passar risco de política na frente", () => {
    const notas = [
      { clareza: 9, parada: 9, prob_generico: 0.1 },
      { clareza: 8, parada: 8, prob_generico: 0.1 },
      { clareza: 6, parada: 6, prob_generico: 0.3 },
      { clareza: 7, parada: 7, prob_generico: 0.2, alerta_politica: true },
    ];
    const assinaturas = [
      { framework: "pas", angulo_de_venda: "dor", gancho: "Seu jardim morre em 15 dias" },
      { framework: "aida", angulo_de_venda: "ganho", gancho: "Seu jardim MORRE em 15 dias!" },
      { framework: "bab", angulo_de_venda: "ganho", gancho: "Antes: mato. Depois: gramado" },
      { framework: "prova_primeiro", angulo_de_venda: "prova", gancho: "Outra ideia arriscada" },
    ];
    // A 2ª da ordem repete o gancho da A: a B vira a 3ª (outra ideia); a arriscada não passa na frente.
    const e = versoesDiferentes(escolherMelhores(notas, 2), assinaturas, notas);
    expect(e.escolhidos).toEqual([0, 2]);
    expect(e.descartados).toEqual([1, 3]);
    // Sem candidata diferente, fica a ordem do Jev.
    const iguais = assinaturas.map(() => ({ gancho: "mesmo gancho" }));
    expect(versoesDiferentes(escolherMelhores(notas, 2), iguais, notas).escolhidos).toEqual([0, 1]);
    // Uma versão só: nada muda.
    expect(versoesDiferentes(escolherMelhores(notas, 1), assinaturas, notas).escolhidos).toEqual([0]);
    expect(versoesParecidas({ framework: "pas", angulo_de_venda: "dor", gancho: "a" }, { framework: "pas", angulo_de_venda: "dor", gancho: "b" })).toBe(true);
    expect(versoesParecidas({ framework: "pas", angulo_de_venda: "dor", gancho: "a" }, { framework: "aida", angulo_de_venda: "dor", gancho: "b" })).toBe(false);
  });

  it("criativos_produzir grava cada versão como o seu criativo, com o par em copy.teste_ab e a B extra sem arte automática", () => {
    const p = corpoDe(indexAds, "criativosProduzir");
    expect(p.match(/chamarTexto\(/g) || []).toHaveLength(1);
    expect(p).toMatch(/variacoes: versoesDoAngulo\(a\.variacoes, corpo\.versoes\)/);
    expect(p).toMatch(/versoesDiferentes\(escolherMelhores\(conferencia\.notas, a\.variacoes\), assinaturas, conferencia\.notas\)/);
    expect(p).toMatch(/teste_ab: \{ grupo: grupoDoTeste, versao: LETRAS_DO_TESTE\[i\]/);
    expect(p).toMatch(/arte_sob_demanda: true/);
    expect(p).toMatch(/nome: `\$\{a\.nome\}\$\{grupoDoTeste \? ` · \$\{LETRAS_DO_TESTE\[i\]\}` : ""\} \| V\$\{i \+ 1\} \| \$\{formato\}`/);
    // Sem coluna nova: o par mora no jsonb copy.
    expect(p).not.toMatch(/teste_ab_grupo|versao_ab/);
  });
});

describe("tela: o par à vista, com a letra, e a arte da B extra sob demanda", () => {
  it("versão e arte sob demanda lidas do copy; o par fica à vista lado a lado", () => {
    const a = criativo("a", 1, { grupo: "g1", versao: "A" });
    const b = criativo("b", 2, { grupo: "g1", versao: "B", arte_sob_demanda: true });
    expect(versaoDoTeste(a)).toBe("A");
    expect(versaoDoTeste(criativo("x", 1, null))).toBeNull();
    expect(arteSobDemanda(b)).toBe(true);
    expect(arteSobDemanda(a)).toBe(false);
    expect(melhoresDoAngulo([b, a]).melhores.map((c) => c.id)).toEqual(["a", "b"]);
    // Fora de teste, a 2ª variação segue recolhida (como antes).
    expect(melhoresDoAngulo([criativo("v2", 2, null), criativo("v1", 1, null)]).outros.map((c) => c.id)).toEqual(["v2"]);
    render(h(SeloDaVersao, { criativo: b }));
    expect(screen.getByLabelText("Versão B do teste A/B").textContent).toBe("B");
  });

  it("estimativa: copy das duas versões; arte automática só da que o plano pediu", () => {
    const m = resolverModeloDaCopy(CATALOGO, null);
    const ab = partesDaCriacao(CATALOGO, m, [{ variacoes: 1, formatos: [] }], formatosAutomaticos, true);
    const uma = partesDaCriacao(CATALOGO, m, [{ variacoes: 1, formatos: [] }], formatosAutomaticos, true, 1);
    // 4:5 e 9:16 da A; a B extra fica para gerar no Estúdio.
    expect(ab.find((p) => p.tipo === "imagem")!.vezes).toBe(2);
    expect(uma.find((p) => p.tipo === "imagem")!.vezes).toBe(2);
    // Versão única com plano de 2 variações: uma arte por formato.
    expect(partesDaCriacao(CATALOGO, m, [{ variacoes: 2, formatos: [] }], formatosAutomaticos, true, 1).find((p) => p.tipo === "imagem")!.vezes).toBe(2);
  });

  const plano = (): PlanoAds => ({
    id: "22222222-2222-2222-2222-222222222222", client_id: CLIENTE, briefing_id: "b-1", nome: "Plano de outubro", status: "rascunho",
    angulos: [{ id: "a1", nome: "Jardim que morre", formatos: ["feed_4x5"], variacoes: 1, aprovado: true }],
    estrutura: { tom: "direto" }, pedido: null, conversa_id: null, custo_usd: 0, criado_em: "2026-10-18T12:00:00Z", atualizado_em: "2026-10-18T12:00:00Z",
  } as unknown as PlanoAds);

  it("criar: o par sai por padrão, a arte automática pula a B extra e sem o teste vai versoes 1", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
      body.acao === "criativos_produzir"
        ? {
            data: {
              criativos: [
                { id: "c-a", angulo_id: "a1", copy: { teste_ab: { grupo: "g", versao: "A" } } },
                { id: "c-b", angulo_id: "a1", copy: { teste_ab: { grupo: "g", versao: "B", arte_sob_demanda: true } } },
              ],
              custo_usd: 0.02,
            },
            error: null,
          }
        : { data: { ok: true }, error: null },
    );
    const p = plano();
    const onProduzido = vi.fn();
    const tela = montar(h(ProducaoDoPlano, { plano: p, marcados: ["a1"], onProduzido }));
    // 1 ângulo x 2 versões x 2 formatos automáticos.
    expect(screen.getByText("4 criativos")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Criar criativos/ }));
    await waitFor(() => expect(onProduzido).toHaveBeenCalledWith(p.id));
    expect(chamadasDe("criativos_produzir")[0].versoes).toBeUndefined();
    expect(pegarArteDoPlano(p.id)).toEqual(["c-a"]);
    tela.unmount();

    mock.invoke.mockClear();
    montar(h(ProducaoDoPlano, { plano: p, marcados: ["a1"], onProduzido: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Trocar" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Teste A/B" }));
    expect(screen.getByText("2 criativos")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    fireEvent.click(screen.getByRole("button", { name: /Criar criativos/ }));
    await waitFor(() => expect(chamadasDe("criativos_produzir")).toHaveLength(1));
    expect(chamadasDe("criativos_produzir")[0].versoes).toBe(1);
  });
});
