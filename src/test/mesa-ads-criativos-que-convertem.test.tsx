import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente CR (27/09/2026): criativo que converte, sempre os melhores, copy de
 * resposta direta, modelo da copy escolhido e a tela em um clique com Parar.
 * Pedido do dono: "os criativos também não estão muito com cara de
 * resultados ... sempre trazer os melhores ... eu escolher o modelo ali no
 * plano de teste ... e também refinar com o modelo que eu escolher" e, logo
 * depois, "mais simples e mais direto ... acompanhamento meu observando as
 * ações de forma clara e poder parar ou interferir ... sempre trazer provas".
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

import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { ESTILOS_VISUAIS, NICHOS, regrasDoCriativo } from "../../supabase/functions/_shared/conhecimento-ads";
import {
  CONHECIMENTO_CRIATIVO_QUE_CONVERTE,
  FORMATOS_PADRAO,
  FORMATOS_QUE_CONVERTEM,
  formatoDoEstilo,
  FRAMEWORKS_DE_COPY,
  REQUISITOS_DO_ESTILO,
} from "../../supabase/functions/_shared/conhecimento-criativo";
import {
  copyArriscada,
  custoMedio,
  desempenhoPorEstilo,
  escolherMelhores,
  notaDaCopy,
  porqueDaCopy,
  porqueDoEstilo,
  rankearEstilos,
  rankingParaOPrompt,
  sinaisDaOferta,
  type DesempenhoDoEstilo,
  type SinaisDaOferta,
} from "../../supabase/functions/mesa-ads/melhores-criativos";
import {
  corpoDoModelo,
  ESTRUTURAS_DE_COPY,
  formatosAutomaticos,
  melhoresDoAngulo,
  ordenarParaOCriativo,
  partesDaCriacao,
  porqueDoCriativo,
  raciocinioMaximo,
  resolverModeloDaCopy,
  type CriativoAds,
  type PlanoAds,
  type ReferenciaAds,
} from "@/components/mesa-ads/adsApi";
import { arteDoPlanoPedida, pedirArteDoPlano, pegarArteDoPlano, produzirLamina } from "@/components/mesa-ads/loteDoEstudio";
import ProducaoDoPlano from "@/components/mesa-ads/ProducaoDoPlano";
import PainelDaCopy from "@/components/mesa-ads/PainelDaCopy";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const indexAds = ler("supabase/functions/mesa-ads/index.ts");
const corpoDe = (texto: string, nome: string) => {
  const i = texto.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const fins = [texto.indexOf("\nasync function ", i + 10), texto.indexOf("\nfunction ", i + 10), texto.indexOf("\nconst ACOES", i + 10)].filter((x) => x > 0);
  return texto.slice(i, Math.min.apply(null, fins));
};

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const LUNA: ModeloIa = {
  id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", tipo: "texto", rotulo: "OpenAI: GPT-6 Luna",
  preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: null, preco_imagem: null,
  raciocinio: ["none", "low", "medium", "high", "xhigh", "max"], padrao_para: ["estrategista", "leitura", "diretor_arte"], ativo: true,
};
const SOL: ModeloIa = { ...LUNA, id: "openrouter:openai/gpt-6-sol", modelo_api: "openai/gpt-6-sol", rotulo: "OpenAI: GPT-6 Sol", preco_entrada_1m: 2, preco_saida_1m: 10, padrao_para: [] };
const IMAGEM: ModeloIa = {
  id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
  preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 }, raciocinio: [], padrao_para: ["imagem"], ativo: true,
};
const CATALOGO = [LUNA, SOL, IMAGEM];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Clínica Sintética", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: CATALOGO, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
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
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5 }, error: null });
  mock.invoke.mockImplementation(async () => ({ data: { ok: true, custo_usd: 0.01 }, error: null }));
});

// ------------------------------------------------------------------ base de conhecimento

describe("base: formatos que convertem, estruturas de copy e fontes", () => {
  it("cada formato usa estilos que existem; requisitos e estruturas batem com a tela", () => {
    const ids = new Set(ESTILOS_VISUAIS.map((e) => e.id));
    for (const f of FORMATOS_QUE_CONVERTEM) for (const e of f.estilos) expect(ids.has(e), `${f.id}: ${e}`).toBe(true);
    for (const k of Object.keys(REQUISITOS_DO_ESTILO)) expect(ids.has(k)).toBe(true);
    // Os formatos pedidos pelo dono estão na base.
    for (const id of ["problema_solucao", "antes_depois", "prova_social", "oferta_empilhada", "comparacao", "demonstracao", "numero_no_gancho", "historia_do_dono", "foto_nativa", "lista", "objecao_e_quebra"]) {
      expect(FORMATOS_QUE_CONVERTEM.some((f) => f.id === id), id).toBe(true);
    }
    expect(formatoDoEstilo("antes_depois")?.id).toBe("antes_depois");
    expect(formatoDoEstilo("pilha_de_oferta")?.id).toBe("oferta_empilhada");
    // A tela espelha as estruturas do servidor.
    expect(Object.keys(ESTRUTURAS_DE_COPY).sort()).toEqual(FRAMEWORKS_DE_COPY.map((f) => f.id).sort());
    for (const f of ["pas", "aida", "gancho_historia_oferta", "objecao_e_quebra", "prova_primeiro"]) expect(ESTRUTURAS_DE_COPY[f]).toBeTruthy();
  });

  it("o método tem zona segura unificada, densidade de texto, fadiga e copy de resposta direta, com as fontes citadas", () => {
    const k = CONHECIMENTO_CRIATIVO_QUE_CONVERTE;
    expect(k).toMatch(/14% de cima/);
    expect(k).toMatch(/35% de baixo em Reels/);
    expect(k).toMatch(/até 7 palavras/);
    expect(k).toMatch(/Frequência/);
    expect(k).toMatch(/4U/);
    expect(k).toMatch(/Reversão de risco/);
    expect(k).toMatch(/nunca "Saiba mais"/);
    const fonte = ler("supabase/functions/_shared/conhecimento-criativo.ts");
    for (const url of ["https://adrio.ai/", "https://blog.adnabu.com/", "https://www.tryatria.com/", "https://github.com/coreyhaines31/marketingskills", "https://www.facebook.com/business/help/"]) expect(fonte).toContain(url);
    // O layout que converte chega à arte pela direção do anúncio (o prompt do Estúdio fica byte a byte o mesmo).
    const layout = corpoDe(indexAds, "layoutDoAnuncio");
    expect(layout).toMatch(/no Reels a interface cobre até 35% de baixo: manchete e CTA no miolo/);
    expect(layout).toMatch(/uma manchete curta e no máximo uma linha de apoio na arte/);
    expect(regrasDoCriativo("stories_9x16")).not.toMatch(/Layout que converte/);
    // Formatos que a Mesa escolhe sozinha: os mesmos da base.
    expect(formatosAutomaticos({ formatos: [] })).toEqual([...FORMATOS_PADRAO]);
  });

  it("nenhum travessão nem regex incompatível nos arquivos novos da frente CR", () => {
    for (const a of [
      "supabase/functions/_shared/conhecimento-criativo.ts",
      "supabase/functions/mesa-ads/melhores-criativos.ts",
      "src/components/mesa-ads/ModeloDaCopy.tsx",
      "src/components/mesa-ads/ProducaoDoPlano.tsx",
      "src/components/mesa-ads/ProgressoComParada.tsx",
    ]) {
      const t = ler(a);
      expect(t, a).not.toMatch(/[—–]/);
      expect(t, a).not.toMatch(/\(\?<[=!a-zA-Z]/);
      expect(t, a).not.toMatch(/\\p\{/);
    }
  });
});

// ------------------------------------------------------------------ ordem dos estilos

const PAISAGISMO = NICHOS.find((n) => n.id === "paisagismo_jardim")!;
const SEM_PROVA: SinaisDaOferta = { depoimento_autorizado: false, numero_real: false, transformacao_visivel: true, itens_da_oferta: false };
const dado = (estilo: string, gasto: number, resultados: number, impressoes = 5000, anuncios = 2, origem: "cliente" | "carteira" = "cliente"): DesempenhoDoEstilo => ({
  estilo, origem, anuncios, gasto, resultados, impressoes, custo_por_resultado: resultados ? Math.round((gasto / resultados) * 100) / 100 : null, inicio: "2026-08-01", fim: "2026-09-20",
});

describe("sempre os melhores: estilos pelo resultado real, sem inventar número", () => {
  it("sem dado real, o padrão do nicho manda e o porquê diz isso, sem número", () => {
    const r = rankearEstilos({ nicho: PAISAGISMO, objetivo: "mensagens", sinais: SEM_PROVA, cliente: [], carteira: [], mediaConta: null, mediaCarteira: null });
    expect(r[0].estilo).toBe("antes_depois");
    expect(r[0].fonte).toBe("nicho");
    expect(r[0].porque).toBe("Antes e depois: padrão do nicho paisagismo e jardinagem; ainda sem dado real seu");
    for (const x of r) {
      if (x.fonte === "nicho" || x.fonte === "base") expect(x.porque).not.toMatch(/R\$|\d+%/);
    }
    expect(rankingParaOPrompt(r)).toMatch(/sem dado real ainda/);
  });

  it("estilo que pede prova que a oferta não tem desce e diz o que falta", () => {
    const r = rankearEstilos({ nicho: { id: "x", nome: "Teste", estilos_que_funcionam: ["numero_em_destaque", "lista_checklist"] }, objetivo: null, sinais: SEM_PROVA, cliente: [], carteira: [], mediaConta: null, mediaCarteira: null });
    expect(r[0].estilo).toBe("lista_checklist");
    const numero = r.find((x) => x.estilo === "numero_em_destaque")!;
    expect(numero.falta).toEqual(["numero_real"]);
    expect(numero.porque).toMatch(/Precisa de número real/);
    const comNumero = rankearEstilos({ nicho: { id: "x", nome: "Teste", estilos_que_funcionam: ["numero_em_destaque", "lista_checklist"] }, objetivo: null, sinais: { ...SEM_PROVA, numero_real: true }, cliente: [], carteira: [], mediaConta: null, mediaCarteira: null });
    expect(comNumero[0].estilo).toBe("numero_em_destaque");
  });

  it("dado do cliente com volume sobe o estilo e o porquê traz o número real contra a média da conta", () => {
    const r = rankearEstilos({ nicho: PAISAGISMO, objetivo: "mensagens", sinais: SEM_PROVA, cliente: [dado("bastidor_real", 120, 10)], carteira: [], mediaConta: 20, mediaCarteira: null });
    expect(r[0].estilo).toBe("bastidor_real");
    expect(r[0].fonte).toBe("cliente");
    expect(r[0].diferenca_pct).toBe(40);
    expect(r[0].porque).toBe("Bastidor real: custo por conversa 40% menor que a média da sua conta (R$ 12,00 contra R$ 20,00, 2 anúncios, 01/08 a 20/09)");
  });

  it("pouco volume não conta; custo alto desce; gasto sem resultado vira sinal contra", () => {
    const pouco = rankearEstilos({ nicho: PAISAGISMO, objetivo: null, sinais: SEM_PROVA, cliente: [dado("bastidor_real", 10, 5, 400)], carteira: [], mediaConta: 20, mediaCarteira: null });
    expect(pouco.find((x) => x.estilo === "bastidor_real")!.fonte).toBe("base");
    const caro = rankearEstilos({ nicho: PAISAGISMO, objetivo: null, sinais: SEM_PROVA, cliente: [dado("antes_depois", 300, 10)], carteira: [], mediaConta: 20, mediaCarteira: null });
    const antes = caro.find((x) => x.estilo === "antes_depois")!;
    expect(antes.porque).toMatch(/50% maior que a média da sua conta/);
    expect(caro[0].estilo).not.toBe("antes_depois");
    const semResultado = rankearEstilos({ nicho: PAISAGISMO, objetivo: null, sinais: SEM_PROVA, cliente: [dado("close_extremo", 60, 0)], carteira: [], mediaConta: 20, mediaCarteira: null });
    expect(semResultado.find((x) => x.estilo === "close_extremo")!.porque).toMatch(/R\$ 60,00 gastos sem resultado/);
  });

  it("sem dado do cliente, a carteira do nicho entra com metade do peso e sem nome de cliente", () => {
    const r = rankearEstilos({ nicho: PAISAGISMO, objetivo: null, sinais: SEM_PROVA, cliente: [], carteira: [dado("demonstracao_etapas", 90, 10, 8000, 4, "carteira")], mediaConta: null, mediaCarteira: 15 });
    const d = r.find((x) => x.estilo === "demonstracao_etapas")!;
    expect(d.fonte).toBe("carteira");
    expect(d.porque).toMatch(/40% menor que a média da carteira no nicho paisagismo e jardinagem \(R\$ 9,00 contra R\$ 15,00, 4 anúncios de outros clientes\)/);
  });

  it("soma por estilo sem contar anúncio duas vezes; sinais da oferta só com o que está escrito", () => {
    const d = desempenhoPorEstilo([
      { ad_id: "1", estilo: "antes_depois", gasto: 50, impressoes: 1000, resultados: 5 },
      { ad_id: "1", estilo: "antes_depois", gasto: 50, impressoes: 1000, resultados: 5 },
      { ad_id: "2", estilo: "antes_depois", gasto: 30, impressoes: 500, resultados: 1 },
      { ad_id: "3", estilo: "estilo_que_nao_existe", gasto: 30, impressoes: 500, resultados: 1 },
    ], "cliente");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ anuncios: 2, gasto: 80, resultados: 6, custo_por_resultado: 13.33 });
    expect(custoMedio(d)).toBe(13.33);
    const s = sinaisDaOferta({ oferta: { preco_confirmado: "R$ 190" }, provas: [{ tipo: "depoimento", texto: "Ótimo", autorizado: false }] }, { entregaveis: ["Poda"], bonus: [] }, PAISAGISMO);
    expect(s).toEqual({ depoimento_autorizado: false, numero_real: true, transformacao_visivel: true, itens_da_oferta: false });
    expect(sinaisDaOferta({ oferta: {}, provas: [{ tipo: "depoimento", texto: "Ótimo", autorizado: true }] }, null, null).depoimento_autorizado).toBe(true);
  });

  it("o porquê do estilo do ângulo sai da ordem; fora dela, diz que foi escolha do estrategista", () => {
    const r = rankearEstilos({ nicho: PAISAGISMO, objetivo: null, sinais: SEM_PROVA, cliente: [], carteira: [], mediaConta: null, mediaCarteira: null });
    expect(porqueDoEstilo("antes_depois", r)!.fonte).toBe("nicho");
    expect(porqueDoEstilo("humor_situacao", [])!.porque).toMatch(/escolha do estrategista para este ângulo; ainda sem dado real seu/);
    expect(porqueDoEstilo(null, r)).toBeNull();
  });
});

// ------------------------------------------------------------------ melhor copy

describe("melhor copy: escrever a mais e o Jev escolher (sem laço)", () => {
  it("nota composta, política como trava e o porquê em uma linha", () => {
    const notas = [
      { clareza: 6, parada: 5, prob_generico: 0.7, risco_politica: 9, alerta_politica: false },
      { clareza: 9, parada: 8, prob_generico: 0.1, risco_politica: 2, alerta_politica: true },
      { clareza: 8, parada: 8, prob_generico: 0.2, risco_politica: 9, alerta_politica: false },
      null,
    ];
    expect(notaDaCopy(notas[2])).toBe(8);
    expect(copyArriscada(notas[1])).toBe(true);
    const e = escolherMelhores(notas, 2);
    expect(e.escolhidos).toEqual([2, 0]);
    expect(e.descartados).toEqual([3, 1]);
    expect(porqueDaCopy(notas[2], "pas", 1, 4)).toBe("Melhor de 4 pela conferência do Jev (nota 8: clareza 8, parada 8, específica). Estrutura: Problema, agitação e solução.");
    expect(porqueDaCopy(null, null, 1, 3)).toMatch(/Sem nota do Jev/);
    expect(porqueDaCopy(notas[1], null, 2, 4)).toMatch(/risco de política/);
  });

  it("o servidor escreve a mais numa chamada só, pergunta a parada ao Jev e guarda o porquê em cada criativo", () => {
    const p = corpoDe(indexAds, "criativosProduzir");
    expect(p.match(/chamarTexto\(/g) || []).toHaveLength(1);
    expect(p).toMatch(/const escrever = a\.variacoes \+ extras;/);
    expect(p).toMatch(/\{ parada: true \}/);
    expect(p).toMatch(/escolherMelhores\(conferencia\.notas, a\.variacoes\)/);
    expect(p).toMatch(/porque_do_estilo: /);
    expect(p).toMatch(/escolha: \{ posicao: i \+ 1, de: escritas, nota: notaDaCopy\(nota\), porque: porqueDaCopy\(/);
    expect(p).toMatch(/copyQueConverteParaOPrompt\(\{ comLayout: true \}\)/);
    expect(indexAds).toMatch(/const MAX_COPIES_A_MAIS = 2;/);
    const v = corpoDe(indexAds, "copyVariar");
    expect(v).toMatch(/\{ parada: true \}/);
    expect(v).toMatch(/melhor: i === 0 && copies\.length > 1/);
    const c = corpoDe(indexAds, "conferirCopiesComJev");
    expect(c).toMatch(/criteria: NIVEIS_PARADA/);
  });

  it("o plano ordena os estilos pelo resultado real (grátis, sem IA) e guarda o porquê", () => {
    const d = corpoDe(indexAds, "desempenhoDosEstilos");
    expect(d).not.toMatch(/chamarTexto|jevPerguntar/);
    expect(d).toMatch(/from\("ads_creative_daily"\)/);
    expect(d).toMatch(/eq\("estrutura->>nicho", nichoId\)/);
    const g = corpoDe(indexAds, "planoGerar");
    expect(g).toMatch(/rankearEstilos\(\{/);
    expect(g).toMatch(/rankingParaOPrompt\(ranking\)/);
    expect(g).toMatch(/formatosParaOPlano\(\)/);
    expect(g).toMatch(/estilos_que_convertem: ranking\.map/);
    expect(g).toMatch(/caminho: caminhoDaMesaAds\("Criar os criativos deste plano"/);
    expect(indexAds).toMatch(/estilo_visual: Snulo\(ESTILOS_VISUAIS_IDS\),\n  \}\),\n\};/);
    expect(corpoDe(indexAds, "referenciaLer")).toMatch(/ficha\.estilo_visual = estiloConhecido\(r\.estilo_visual\)/);
    expect(corpoDe(indexAds, "copyPacote")).toMatch(/caminho: pacotes\.length \? caminhoDaMesaAds\("Abrir o pacote da copy"/);
  });
});

// ------------------------------------------------------------------ modelo da copy

describe("modelo da copy: GPT-6 Luna Max por padrão, a escolha respeitada", () => {
  it("padrão do estrategista no raciocínio máximo; escolha guardada vale; modelo que saiu cai no padrão", () => {
    expect(raciocinioMaximo(["low", "max", "medium"])).toBe("max");
    expect(raciocinioMaximo([])).toBeNull();
    const padrao = resolverModeloDaCopy(CATALOGO, null);
    expect(padrao.modelo!.id).toBe("openrouter:openai/gpt-6-luna");
    expect(padrao.raciocinio).toBe("max");
    expect(corpoDoModelo(padrao)).toEqual({ modelo_id: "openrouter:openai/gpt-6-luna", raciocinio: "max" });
    expect(resolverModeloDaCopy(CATALOGO, { modelo: SOL.id, raciocinio: "high" })).toMatchObject({ modelo: SOL, raciocinio: "high" });
    expect(resolverModeloDaCopy(CATALOGO, { modelo: SOL.id, raciocinio: "inventado" }).raciocinio).toBe("max");
    expect(resolverModeloDaCopy(CATALOGO, { modelo: "saiu:do-catalogo", raciocinio: "low" }).modelo!.id).toBe(LUNA.id);
  });

  it("formatos automáticos (4:5 e 9:16, carrossel quando o ângulo pediu) e a estimativa conta as lâminas", () => {
    expect(formatosAutomaticos({ formatos: ["quadrado_1x1"] })).toEqual(["feed_4x5", "stories_9x16"]);
    expect(formatosAutomaticos({ formatos: ["carrossel"] })).toEqual(["carrossel", "stories_9x16"]);
    const m = resolverModeloDaCopy(CATALOGO, null);
    const partes = partesDaCriacao(CATALOGO, m, [{ variacoes: 2, formatos: ["carrossel"] }], formatosAutomaticos, true);
    expect(partes[0].modeloId).toBe(LUNA.id);
    // Carrossel conta 4 lâminas e o stories 1, vezes 2 variações.
    expect(partes.find((p) => p.tipo === "imagem")!.vezes).toBe(10);
    expect(partesDaCriacao(CATALOGO, m, [{ variacoes: 1, formatos: [] }], formatosAutomaticos, false)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ tela: criar em um clique, acompanhar e parar

const planoDeTeste = (): PlanoAds => ({
  id: "22222222-2222-2222-2222-222222222222",
  client_id: CLIENTE,
  briefing_id: "b-1",
  nome: "Plano de outubro",
  status: "rascunho",
  angulos: [
    { id: "a1", nome: "Jardim que morre", formatos: ["feed_4x5"], variacoes: 1, aprovado: true, porque_do_estilo: "Antes e depois: padrão do nicho paisagismo e jardinagem; ainda sem dado real seu" },
    { id: "a2", nome: "Manutenção sem dor", formatos: ["carrossel"], variacoes: 1, aprovado: true },
  ],
  estrutura: { tom: "direto" },
  pedido: null,
  conversa_id: null,
  custo_usd: 0,
  criado_em: "2026-09-27T12:00:00Z",
  atualizado_em: "2026-09-27T12:00:00Z",
});

describe("tela: criar criativos em um clique, com andamento e Parar", () => {
  it("um ângulo por chamada com o modelo escolhido; ao fim pede a arte e abre o Estúdio", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
      body.acao === "criativos_produzir"
        ? { data: { criativos: [{ id: `c-${body.angulo_ids[0]}`, angulo_id: body.angulo_ids[0] }], custo_usd: 0.02 }, error: null }
        : { data: { ok: true }, error: null },
    );
    const onProduzido = vi.fn();
    const plano = planoDeTeste();
    montar(h(ProducaoDoPlano, { plano, marcados: ["a1", "a2"], onProduzido }));
    expect(screen.getByText(/copy no OpenAI: GPT-6 Luna · Máximo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Criar criativos/ }));
    await waitFor(() => expect(onProduzido).toHaveBeenCalledWith(plano.id));
    expect(chamadasDe("criativos_produzir")).toEqual([
      { acao: "criativos_produzir", plano_id: plano.id, angulo_ids: ["a1"], formatos: ["feed_4x5", "stories_9x16"], modelo_id: LUNA.id, raciocinio: "max" },
      { acao: "criativos_produzir", plano_id: plano.id, angulo_ids: ["a2"], formatos: ["stories_9x16", "carrossel"], modelo_id: LUNA.id, raciocinio: "max" },
    ]);
    // A arte fica pedida para o Estúdio começar sozinho (uma vez só).
    expect(pegarArteDoPlano(plano.id)).toEqual(["c-a1", "c-a2"]);
    expect(pegarArteDoPlano(plano.id)).toBeNull();
  });

  it("Parar no meio: o que saiu fica, o resto não é chamado nem cobrado, e o caminho para o Estúdio aparece", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    mock.invoke.mockImplementation((_f: string, { body }: any) =>
      body.acao === "criativos_produzir"
        ? new Promise((r) => {
            soltar = r;
          })
        : Promise.resolve({ data: { ok: true }, error: null }),
    );
    const onProduzido = vi.fn();
    const plano = planoDeTeste();
    montar(h(ProducaoDoPlano, { plano, marcados: ["a1", "a2"], onProduzido }));
    fireEvent.click(screen.getByRole("button", { name: /Criar criativos/ }));
    const parar = await screen.findByRole("button", { name: "Parar o lote" });
    expect(screen.getByRole("status", { name: /Escrevendo a copy: 0 de 2 ângulos/ })).toBeTruthy();
    fireEvent.click(parar);
    expect(await screen.findByText(/O que já está saindo termina e fica/)).toBeTruthy();
    soltar({ data: { criativos: [{ id: "c-1", angulo_id: "a1" }], custo_usd: 0.02, caminho: { rotulo: "Abrir no Estúdio Ads", destino: `/mesa-ads?client=${CLIENTE}&etapa=estudio&plano=${plano.id}` } }, error: null });
    expect(await screen.findByText(/Parado em 1 de 2 ângulos: 1 criativo\(s\) prontos para a arte\./)).toBeTruthy();
    expect(chamadasDe("criativos_produzir")).toHaveLength(1);
    expect(onProduzido).not.toHaveBeenCalled();
    expect(arteDoPlanoPedida(plano.id)).toBeNull();
    expect((toast.info as any).mock.calls[0][0]).toBe("Criação parada");
    // O caminho do contrato dos agentes (CaminhoPronto) leva ao Estúdio no lote deste plano.
    expect(screen.getByRole("button", { name: /Abrir no Estúdio Ads/ })).toBeTruthy();
  });

  it("trocar é simples: formatos, tom, modelo e o que vai junto, sem formulário", () => {
    montar(h(ProducaoDoPlano, { plano: planoDeTeste(), marcados: ["a1"], onProduzido: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Trocar" }));
    fireEvent.click(screen.getByRole("button", { name: /Quadrado 1:1/ }));
    expect(screen.getByText("3 criativos")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Modelo da copy"), { target: { value: SOL.id } });
    expect((screen.getByLabelText("Raciocínio da copy") as HTMLSelectElement).value).toBe("max");
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(screen.getByText(/copy no OpenAI: GPT-6 Sol · Máximo/)).toBeTruthy();
  });
});

// ------------------------------------------------------------------ tela: provas e organização

const criativo = (id: string, variacao: number | null, formato: CriativoAds["formato"], extra: Partial<CriativoAds["copy"]> = {}): CriativoAds => ({
  id, client_id: CLIENTE, plano_id: "p-1", angulo_id: "a1", trabalho_id: `t-${id}`, nome: null, formato,
  copy: { texto_principal: "Base", variacao, ...extra } as CriativoAds["copy"], status: "rascunho", ad_id: null, evidencia: "E0", criado_em: "", atualizado_em: "",
});

describe("tela: o melhor primeiro, o resto recolhido, e o porquê de cada um", () => {
  it("melhor variação à vista com os formatos dela; o resto recolhido; sem variação, tudo à vista", () => {
    const r = melhoresDoAngulo([criativo("c3", 2, "feed_4x5"), criativo("c2", 1, "stories_9x16"), criativo("c1", 1, "feed_4x5")]);
    expect(r.melhores.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(r.outros.map((c) => c.id)).toEqual(["c3"]);
    expect(melhoresDoAngulo([criativo("x", null, "feed_4x5")]).outros).toEqual([]);
  });

  it("porquê do criativo: estilo com o dado e a nota do Jev; criativo antigo sem porquê não inventa", () => {
    const c = criativo("c1", 1, "feed_4x5", { porque_do_estilo: "Antes e depois: custo por conversa 40% menor que a média da sua conta (R$ 12,00 contra R$ 20,00, 2 anúncios)", escolha: { posicao: 1, de: 3, nota: 7.8, porque: "Melhor de 3" } });
    expect(porqueDoCriativo(c)).toBe("Antes e depois: custo por conversa 40% menor que a média da sua conta (R$ 12,00 contra R$ 20,00, 2 anúncios) · melhor de 3 copies, Jev 7,8");
    expect(porqueDoCriativo(criativo("velho", null, "feed_4x5"))).toBe("");
    expect(porqueDoCriativo(criativo("so-angulo", null, "feed_4x5"), { porque_do_estilo: "Lista: padrão do nicho x; ainda sem dado real seu" })).toBe("Lista: padrão do nicho x; ainda sem dado real seu");
  });

  it("o painel da copy mostra por que esta copy e o refino traz a melhor marcada", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
      body.acao === "copy_variar"
        ? { data: { variacoes: [{ texto_principal: "Primeira", titulo: "T1", cta_meta: "SEND_MESSAGE", framework: "pas", melhor: true, porque: "Melhor de 3 pela conferência do Jev (nota 8)." }, { texto_principal: "Segunda", framework: "aida" }], custo_usd: 0.01 }, error: null }
        : { data: { ok: true }, error: null },
    );
    montar(h(PainelDaCopy, { criativo: criativo("c1", 1, "feed_4x5", { escolha: { posicao: 1, de: 4, nota: 8, porque: "Melhor de 4 pela conferência do Jev (nota 8: clareza 8)." } }), caminhoDaArte: null }));
    expect(screen.getByText("Melhor de 4 pela conferência do Jev (nota 8: clareza 8).")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Refinar copy/ }));
    await waitFor(() => expect(chamadasDe("copy_variar")).toHaveLength(1));
    expect(chamadasDe("copy_variar")[0]).toMatchObject({ modelo_id: LUNA.id, raciocinio: "max" });
    expect(await screen.findByText("Melhor")).toBeTruthy();
    expect(screen.getByText("Problema, agitação e solução")).toBeTruthy();
    expect(screen.getByText("Melhor de 3 pela conferência do Jev (nota 8).")).toBeTruthy();
  });

  it("referências do banco: destaque, depois as do mesmo estilo do criativo, depois evidência forte", () => {
    const ref = (id: string, estilo: string, evidencia: ReferenciaAds["evidencia"], destaque = false): ReferenciaAds => ({
      id, client_id: null, titulo: id, url: null, origem: "padrao", storage_path: null, ad_id: null, plataforma: null, formato: null, evidencia,
      metricas: {}, ficha: { estilo_visual: estilo }, mecanismo: null, tags: [], destaque, criado_em: "2026-09-01",
    });
    const r = ordenarParaOCriativo([ref("forte", "lista_checklist", "E3"), ref("mesmo", "antes_depois", "E0"), ref("destaque", "tipografia_gigante", "E0", true)], "antes_depois");
    expect(r.map((x) => x.id)).toEqual(["destaque", "mesmo", "forte"]);
  });
});

// ------------------------------------------------------------------ lote do Estúdio

describe("lote do Estúdio: pedido de arte e parar", () => {
  it("o pedido de arte do plano vale uma vez e vence em 10 minutos", () => {
    pedirArteDoPlano("p-9", ["c1"], 1000);
    expect(arteDoPlanoPedida("p-9", 1000 + 60_000)).toEqual(["c1"]);
    expect(arteDoPlanoPedida("p-9", 1000 + 11 * 60_000)).toBeNull();
    pedirArteDoPlano("p-9", ["c1", "c2"], 5000);
    expect(pegarArteDoPlano("p-9", 6000)).toEqual(["c1", "c2"]);
    expect(pegarArteDoPlano("p-9", 6000)).toBeNull();
  });

  it("parado, a lâmina que estava saindo termina e nenhuma correção nova começa", async () => {
    const chamar = vi.fn(async (corpo: Record<string, unknown>) =>
      corpo.acao === "conferir_card" ? { autocorrecao: { precisa: true, motivos: ["Palavra faltando"] } } : { custo_usd: 0.04 },
    );
    const r = await produzirLamina(chamar, "t-1", 1, () => undefined, 1, () => true);
    expect(chamar.mock.calls.map((c) => c[0].acao)).toEqual(["gerar_card", "conferir_card"]);
    expect(r.pendencias).toEqual(["Palavra faltando"]);
  });

  it("o Estúdio mostra o andamento com Parar e começa sozinho o lote pedido pelo Plano", () => {
    const f = ler("src/components/mesa-ads/AbaEstudioAds.tsx");
    expect(f).toMatch(/<ProgressoComParada/);
    expect(f).toMatch(/pegarArteDoPlano\(planoId\);/);
    expect(f).toMatch(/produzirLamina\(\(corpo\) => chamarFuncao<any>\("estudio-arte", corpo\), t\.id, ordem, \(e\) => marcar\(t\.id, e\), 1, \(\) => pararLote\.current\)/);
    expect(f).toMatch(/Outras variações \(/);
    expect(f).toMatch(/Por que este: /);
  });
});
