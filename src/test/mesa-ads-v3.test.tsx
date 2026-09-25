import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Ads v3 (pedido do dono em 25/09/2026; sem SQL novo):
 * oferta montada do contexto, referência mandada e escolhida no criativo,
 * tom agressivo de verdade (sóbrio, direto, agressivo), ajuste que vale para
 * os formatos irmãos e foco em resultado (ordem de teste e corte). As regras
 * em código rodam de verdade; a função e as tabelas são simuladas na tela.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

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
      storage: {
        from: () => ({
          upload: mock.upload,
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import AbaOferta from "@/components/mesa-ads/AbaOferta";
import AbaPlano, { corpoDaProducao } from "@/components/mesa-ads/AbaPlano";
import { instrucaoParaIrmao, irmaosComArte } from "@/components/mesa-ads/ArteDoCriativo";
import { juntarReferencia, MAX_REFERENCIAS_DO_CRIATIVO } from "@/components/mesa-ads/ReferenciasDoCriativo";
import { vereditoDoCorte } from "@/components/mesa-ads/ResultadoDoCriativo";
import {
  ARTE_DO_TOM_AGRESSIVO,
  corpoDoPlano,
  instrucaoComTom,
  irmaosDoCriativo,
  normalizarPlano,
  testarPrimeiroDoPlano,
  tomDoPedido as tomDoPedidoDaTela,
  type CriativoAds,
  type PlanoAds,
} from "@/components/mesa-ads/adsApi";
import {
  TONS,
  tomDoPedido,
  regrasDoTomParaCopy,
  regrasDoTomParaAngulos,
  direcaoDoTomParaArte,
  VERSAO_CONHECIMENTO_ADS,
  CONHECIMENTO_ESTRATEGISTA_ADS,
} from "../../supabase/functions/_shared/conhecimento-ads";
import {
  anguloGenerico,
  avisosDeTom,
  clichesNoTexto,
  motivosDoAngulo,
  numerosReais,
  ofertaDoContextoEmCodigo,
  ordemDeTeste,
  pontuacaoDoAngulo,
  regraDeCorte,
  type NotasAngulo,
} from "../../supabase/functions/mesa-ads/calculos";

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8").replace(/\r\n/g, "\n");
const fonte = ler("supabase/functions/mesa-ads/index.ts");
const CLIENTE = "11111111-1111-1111-1111-111111111111";

/** Corpo de uma função do servidor (até a próxima função de topo). */
const corpoDe = (nome: string) => {
  const i = fonte.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const fins = ["\nasync function ", "\nfunction ", "\nconst ACOES"].map((m) => fonte.indexOf(m, i + 10)).filter((x) => x > 0);
  return fonte.slice(i, Math.min.apply(null, fins));
};

const notas = (o: Partial<NotasAngulo> = {}): NotasAngulo => ({
  clareza: 8, relevancia: 8, prova: 5, risco_politica: 10, parada: 7, diferenciacao: 7, alerta_politica: false, ...o,
});

// ------------------------------------------------------------------ regras em código

describe("tom do criativo: sóbrio, direto e agressivo com regras concretas", () => {
  it("o pedido livre decide o tom; 'menos agressivo' e 'sóbrio' vencem", () => {
    expect(tomDoPedido("deixa mais agressivo")).toBe("agressivo");
    expect(tomDoPedido("quero algo sem dó, mais forte")).toBe("agressivo");
    expect(tomDoPedido("menos agressivo, por favor")).toBe("sobrio");
    expect(tomDoPedido("versão elegante e institucional")).toBe("sobrio");
    expect(tomDoPedido("troque a foto")).toBe("direto");
    expect(tomDoPedido("", "agressivo")).toBe("agressivo");
    // A tela usa a mesma regra (sem padrão: null).
    for (const t of ["deixa mais agressivo", "menos agressivo", "mais impactante", "troque a foto"]) {
      expect(tomDoPedidoDaTela(t) || "direto").toBe(tomDoPedido(t));
    }
  });

  it("agressivo: headline curta, número real, contraste máximo, escala gigante, urgência real e CTA imperativo", () => {
    const a = TONS.agressivo;
    expect(a.headline_max_palavras).toBeLessThanOrEqual(5);
    expect(a.headline_max_palavras).toBeLessThan(TONS.direto.headline_max_palavras);
    expect(TONS.direto.headline_max_palavras).toBeLessThan(TONS.sobrio.headline_max_palavras);
    const copy = regrasDoTomParaCopy("agressivo");
    expect(copy).toMatch(/NÚMERO REAL/);
    expect(copy).toMatch(/nunca invente número/i);
    expect(copy).toMatch(/Urgência só real/);
    expect(copy).toMatch(/CTA imperativo/);
    expect(copy).toMatch(/qualidade, excelência, soluções, confira/);
    const arte = direcaoDoTomParaArte("agressivo");
    expect(arte).toMatch(/Contraste máximo/);
    expect(arte).toMatch(/35% a 50% da altura/);
    expect(arte).toMatch(/Nunca escurecer a foto/);
    expect(regrasDoTomParaAngulos("agressivo")).toMatch(/no máximo 5 palavras/);
    // Cinco níveis do pior ao melhor para o Jev em cada tom.
    for (const t of Object.values(TONS)) expect(t.niveis_jev).toHaveLength(5);
    expect(VERSAO_CONHECIMENTO_ADS).toBe("2026-09-25.1");
    expect(CONHECIMENTO_ESTRATEGISTA_ADS).toMatch(/FOCO EM RESULTADO/);
  });

  it("o ajuste 'mais agressivo' no Estúdio leva as regras do servidor (a tela espelha TONS.agressivo.arte)", () => {
    expect(ARTE_DO_TOM_AGRESSIVO).toEqual(TONS.agressivo.arte);
    const ajuste = instrucaoComTom("deixa mais agressivo");
    expect(ajuste).toMatch(/TOM AGRESSIVO DE VERDADE/);
    expect(ajuste).toMatch(/Contraste máximo/);
    expect(instrucaoComTom("troque o fundo por azul")).toBe("troque o fundo por azul");
  });

  it("tom medido pelo Jev entra na aprovação e na pontuação; genérico sai das notas", () => {
    expect(motivosDoAngulo(notas({ tom: 4 })).join(" ")).toMatch(/Abaixo do tom pedido: nota 4/);
    expect(motivosDoAngulo(notas({ tom: 8 }))).toEqual([]);
    expect(motivosDoAngulo(notas())).toEqual([]);
    expect(pontuacaoDoAngulo(notas({ tom: 2 }))!).toBeLessThan(pontuacaoDoAngulo(notas({ tom: 10 }))!);
    expect(anguloGenerico(notas({ diferenciacao: 2.5 }))).toBe(true);
    expect(anguloGenerico(notas({ relevancia: 2.5 }))).toBe(true);
    expect(anguloGenerico(notas())).toBe(false);
  });

  it("avisos de tom em código: headline longa, clichê e falta de número real no agressivo", () => {
    expect(clichesNoTexto("Qualidade e EXCELÊNCIA, confira!")).toEqual(["qualidade", "excelência", "confira"]);
    const avisos = avisosDeTom(
      { headline: "A melhor qualidade em poda de árvores da cidade", texto_principal: "Confira nossas soluções." },
      TONS.agressivo,
      numerosReais(["R$ 150 à vista", "Garantia de 90 dias"]),
    );
    expect(avisos.join(" ")).toMatch(/Headline com 9 palavras/);
    expect(avisos.join(" ")).toMatch(/Genérico: usa "qualidade", "soluções", "confira"/);
    expect(avisos.join(" ")).toMatch(/Sem número: a oferta tem R\$ 150, 90 dias/);
    expect(avisosDeTom({ headline: "Árvore no chão hoje", texto_principal: "Poda por R$ 150." }, TONS.agressivo, ["R$ 150"])).toEqual([]);
    expect(avisos.join(" ")).not.toMatch(/[—–]/);
  });
});

describe("foco em resultado: ordem de teste e corte com número real", () => {
  it("corte pelo custo tolerável do briefing; sem ele, pela média da conta; sem nada, diz o que falta", () => {
    const c = regraDeCorte({ metrica: "conversa no WhatsApp", custoToleravel: 30, custoMedioConta: 12, janelaDias: 7 });
    expect(c).toMatchObject({ limite_brl: 30, gasto_sem_resultado_brl: 75, fonte: "briefing", impressoes_minimas: 1000, dias_minimos: 7 });
    expect(c.texto).toMatch(/R\$ 75,00 sem nenhum resultado/);
    expect(c.texto).toMatch(/custo tolerável do briefing/);
    const m = regraDeCorte({ custoMedioConta: 12.4 });
    expect(m.fonte).toBe("media_da_conta");
    expect(m.limite_brl).toBe(12.4);
    const nada = regraDeCorte({});
    expect(nada.limite_brl).toBeNull();
    expect(nada.texto).toMatch(/defina o custo tolerável/);
  });

  it("ordem de teste: aprovados primeiro, depois pontuação e prova", () => {
    const ordem = ordemDeTeste([
      { id: "a1", aprovado: false, reprovado: true, pontuacao: 9, jev: { prova: 10 } },
      { id: "a2", aprovado: true, pontuacao: 7, jev: { prova: 2 } },
      { id: "a3", aprovado: true, pontuacao: 7, jev: { prova: 8 } },
      { id: "a4", aprovado: true, pontuacao: 8.5, jev: null },
    ]);
    expect([ordem.get("a4"), ordem.get("a3"), ordem.get("a2"), ordem.get("a1")]).toEqual([1, 2, 3, 4]);
  });

  it("o plano mostra Testar primeiro com o porquê, a métrica e o corte (e o plano antigo usa a ordem dos ângulos)", () => {
    const p = normalizarPlano({
      id: "p1", nome: "Plano", status: "rascunho",
      angulos: [
        { id: "a1", nome: "Árvore no chão hoje", ordem_teste: 2, porque_testar_primeiro: "Abre território novo", hipotese: "H1", corte: { texto: "Pausar se...", metrica: "conversa" } },
        { id: "a2", nome: "Poda com laudo", ordem_teste: 1, porque_testar_primeiro: "Prova real do briefing", hipotese: "H2", corte: { texto: "Pausar se gastar R$ 75,00", metrica: "conversa" } },
      ],
      estrutura: { tom: "agressivo", base_da_conta: { periodo_dias: 90, gasto: 300, resultados: 20, custo_por_resultado: 15 } },
    });
    const t = testarPrimeiroDoPlano(p);
    expect(t.itens.map((x) => x.angulo_id)).toEqual(["a2", "a1"]);
    expect(t.itens[0]).toMatchObject({ porque: "Prova real do briefing", corte: "Pausar se gastar R$ 75,00" });
    expect(t.base && t.base.custo_por_resultado).toBe(15);
    expect(t.tom).toBe("agressivo");
    expect(p.angulos[1].corte && p.angulos[1].corte.limite_brl).toBeNull();
  });

  it("veredito do criativo ligado: dentro, acima, sem volume e passou do corte sem resultado", () => {
    const angulo: any = { id: "a1", nome: "x", corte: { metrica: "conversa", limite_brl: 30, gasto_sem_resultado_brl: 75, impressoes_minimas: 1000, dias_minimos: 3, fonte: "briefing", texto: "t" } };
    const anuncio = (m: Record<string, number | null>): any => ({ metricas: { gasto: 0, impressoes: 0, resultados: 0, custo_por_resultado: null, ...m } });
    expect(vereditoDoCorte(anuncio({ gasto: 80, impressoes: 5000, resultados: 0 }), angulo)).toMatch(/Passou do corte/);
    expect(vereditoDoCorte(anuncio({ gasto: 10, impressoes: 300 }), angulo)).toMatch(/sem volume/);
    expect(vereditoDoCorte(anuncio({ gasto: 200, impressoes: 9000, resultados: 5, custo_por_resultado: 40 }), angulo)).toMatch(/Acima do corte/);
    expect(vereditoDoCorte(anuncio({ gasto: 200, impressoes: 9000, resultados: 10, custo_por_resultado: 20 }), angulo)).toMatch(/Dentro da meta/);
    expect(vereditoDoCorte(null, angulo)).toBeNull();
  });
});

describe("oferta montada do contexto (sem IA)", () => {
  it("cada campo vem de uma fonte real; urgência só com data de campanha; o que falta vira lacuna", () => {
    const r = ofertaDoContextoEmCodigo({
      cliente: "Verde Poda",
      briefing: {
        oferta: { produto: "Poda de árvores", promessa: "", condicao: "Visita em até 48 horas", preco_confirmado: "a partir de R$ 150", garantia: null },
        publico: { quem: "" },
        destino: { tipo: "whatsapp" },
        provas: [],
      },
      consolidado: { publico: "Moradores de casa com quintal em Curitiba", oferta: "Poda e remoção de árvores com laudo.", diferenciais: ["Equipe com NR35", "Recolhe todo o resíduo"] },
      brief: { "Qual a garantia?": "Retorno sem custo em 30 dias" },
      campanhas: [{ nome: "Primavera sem galho", objetivo: "mensagens", conceito: "Quintal pronto para a primavera.", periodo_fim: "2026-09-30" }],
      melhorAnuncio: { nome: "Poda 1", titulo: "Galho no telhado?", custo_por_resultado: 12.5, resultados: 18 },
    });
    expect(r.campos.nome).toBe("Primavera sem galho");
    expect(r.campos.para_quem).toBe("Moradores de casa com quintal em Curitiba");
    expect(r.fontes.para_quem).toMatch(/contexto consolidado/);
    expect(r.campos.promessa).toBe("Quintal pronto para a primavera");
    expect(r.fontes.promessa).toMatch(/campanha do mês/);
    expect(r.campos.mecanismo).toBe("Equipe com NR35; Recolhe todo o resíduo");
    expect(r.campos.entregaveis).toEqual(["Poda de árvores", "Visita em até 48 horas"]);
    expect(r.campos.garantia).toBe("Retorno sem custo em 30 dias");
    expect(r.fontes.garantia).toMatch(/brief do cliente/);
    expect(r.campos.ancoragem).toBe("Preço confirmado: a partir de R$ 150");
    expect(r.campos.urgencia_real).toBe("Primavera sem galho vai até 30/09");
    expect(r.campos.cta).toBe("Chame no WhatsApp");
    expect(r.campos.bonus).toEqual([]);
    expect(r.campos.riscos.join(" ")).toMatch(/18 resultado\(s\).*R\$ 12,50/);
    expect(r.lacunas.join(" ")).toMatch(/Bônus/);
    expect(JSON.stringify(r)).not.toMatch(/[—–]/);
  });

  it("sem contexto nenhum: nada inventado, tudo vira lacuna", () => {
    const r = ofertaDoContextoEmCodigo({ cliente: "Cliente X", briefing: null, consolidado: null, brief: null, campanhas: [], melhorAnuncio: null });
    expect(r.campos.nome).toBe("Oferta Cliente X");
    expect(r.campos.promessa).toBe("");
    expect(r.campos.urgencia_real).toBeNull();
    expect(r.campos.ancoragem).toBeNull();
    expect(r.lacunas.length).toBeGreaterThanOrEqual(6);
  });
});

describe("formatos irmãos e referências no criativo", () => {
  const criativo = (id: string, formato: string, extra: Partial<CriativoAds> = {}): CriativoAds => ({
    id, client_id: CLIENTE, plano_id: "p1", angulo_id: "a1", trabalho_id: `t-${id}`, nome: `Árvore | V1 | ${formato}`,
    formato: formato as any, copy: {} as any, status: "rascunho", ad_id: null, evidencia: "E0", criado_em: "", atualizado_em: "", ...extra,
  });

  it("irmãos: mesmo plano, ângulo e variação, outro formato, com trabalho", () => {
    const quadrado = criativo("c1", "quadrado_1x1");
    const todos = [
      quadrado,
      criativo("c2", "stories_9x16"),
      criativo("c3", "feed_4x5", { copy: { variacao: 1 } as any, nome: null }),
      criativo("c4", "stories_9x16", { nome: "Árvore | V2 | stories_9x16" }),
      criativo("c5", "feed_4x5", { angulo_id: "a2" }),
      criativo("c6", "feed_4x5", { trabalho_id: null }),
    ];
    expect(irmaosDoCriativo(quadrado, todos).map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("o ajuste só vai para o irmão que já tem a arte daquela lâmina; área marcada vira 'elemento equivalente'", () => {
    const comArte: any = { id: "t1", status: "pronto", direcao: { cards: [{ ordem: 1 }] }, cards: [{ ordem: 1, versao: 1, storage_path: "x.png" }] };
    const semArte: any = { id: "t2", status: "dirigido", direcao: { cards: [{ ordem: 1 }] }, cards: [] };
    const entregue: any = { ...comArte, id: "t3", status: "entregue" };
    const irmaos = [comArte, semArte, entregue].map((t, i) => ({ criativo: { id: `c${i}` } as any, trabalho: t }));
    expect(irmaosComArte(irmaos, 1).map((i) => i.trabalho.id)).toEqual(["t1"]);
    expect(instrucaoParaIrmao("aumente a logo", "Quadrado 1:1", true)).toMatch(/elemento equivalente/);
    expect(instrucaoParaIrmao("mais agressivo", "Quadrado 1:1", false)).toMatch(/TOM AGRESSIVO DE VERDADE/);
  });

  it("referência escolhida entra primeiro e o criativo guarda no máximo 4", () => {
    expect(MAX_REFERENCIAS_DO_CRIATIVO).toBe(4);
    expect(juntarReferencia(["a", "b", "c", "d"], "e")).toEqual(["e", "a", "b", "c"]);
    expect(juntarReferencia(["a", "b"], "b")).toEqual(["b", "a"]);
  });
});

// ------------------------------------------------------------------ contratos da função

describe("contratos v3 da função mesa-ads (fonte)", () => {
  it("ações novas no mapa; oferta_do_contexto e referencia_para_estudio sem IA", () => {
    expect(fonte).toMatch(/oferta_do_contexto: ofertaDoContexto/);
    expect(fonte).toMatch(/referencia_para_estudio: referenciaParaEstudio/);
    const doContexto = corpoDe("ofertaDoContexto");
    expect(doContexto).not.toMatch(/chamarTexto|jevPerguntar/);
    expect(doContexto).toMatch(/origem: "contexto"/);
    expect(doContexto).toMatch(/custo_usd: 0/);
    const ponte = corpoDe("referenciaParaEstudio");
    expect(ponte).not.toMatch(/chamarTexto|jevPerguntar/);
    expect(ponte).toMatch(/from\("cliente_referencias"\)/);
    expect(ponte).toMatch(/papel: "tecnica"/);
  });

  it("o contexto do estrategista lê a Mesa principal: campanhas do mês, brief e documentos", () => {
    const ctx = corpoDe("montarContextoAds");
    expect(ctx).toMatch(/from\("mesa_campanhas"\)/);
    expect(ctx).toMatch(/from\("briefings"\)/);
    expect(ctx).toMatch(/lerDocumentosDeMarca/);
    expect(ctx).toMatch(/campanhas_do_mes/);
  });

  it("o tom chega aos ângulos, à copy e à direção de arte; o Jev confere genérico (Noul) e tom como aviso", () => {
    expect(corpoDe("planoGerar")).toMatch(/regrasDoTomParaAngulos\(tom\)/);
    expect(corpoDe("planoGerar")).toMatch(/comFocoEmResultado/);
    expect(corpoDe("planoGerar")).toMatch(/testar_primeiro: testarPrimeiro\(principais\)/);
    expect(corpoDe("planoConversar")).toMatch(/tomDoPedido\(mensagem, tomAnterior\)/);
    const produzir = corpoDe("criativosProduzir");
    expect(produzir).toMatch(/regrasDoTomParaCopy\(tom\)/);
    expect(produzir).toMatch(/avisosDeTom/);
    expect(produzir).toMatch(/headline_max_caracteres/);
    expect(produzir).toMatch(/\n\s+tom,\n\s+\}\);/);
    expect(corpoDe("copyVariar")).toMatch(/regrasDoTomParaCopy\(tom\)/);
    const direcao = corpoDe("direcaoDoAnuncio");
    expect(direcao).toMatch(/direcaoDoTomParaArte\(tom\)/);
    expect(direcao).toMatch(/tratamentoDoTom\(tom\)/);
    const conferir = corpoDe("conferirCopiesComJev");
    expect(conferir).toMatch(/type: "noul"/);
    expect(conferir).toMatch(/CRITERIOS_GENERICO/);
    // Sem laço: a conferência só avisa (nenhuma reescrita chamada dentro da produção por genérico).
    expect(produzir.match(/chamarTexto\(/g) || []).toHaveLength(1);
  });

  it("toda chamada de texto usa timeoutMs de 300 s e as ações longas respondem com fôlego", () => {
    const chamadas = (fonte.match(/chamarTexto\(\{/g) || []).length;
    const comTempo = (fonte.match(/chamarTexto\(\{\n\s+timeoutMs: TIMEOUT_TEXTO_ADS_MS,/g) || []).length;
    expect(comTempo).toBe(chamadas);
    expect(fonte).toMatch(/TIMEOUT_TEXTO_ADS_MS = 300_000/);
    expect(fonte).toMatch(/"referencia_para_estudio",\n\]\);/);
  });

  it("oferta em foco no agente e a oferta do contexto guarda origem, fontes e lacunas ao editar", () => {
    expect(corpoDe("ofertaConversar")).toMatch(/OFERTA EM FOCO/);
    expect(corpoDe("ofertaSalvar")).toMatch(/origem: o\.origem/);
  });

  it("nenhum travessão nos arquivos novos da v3", () => {
    for (const a of [
      "src/components/mesa-ads/ReferenciasDoCriativo.tsx",
      "src/components/mesa-ads/ResultadoDoCriativo.tsx",
      "supabase/functions/_shared/conhecimento-ads.ts",
    ]) {
      expect(ler(a), a).not.toMatch(/[—–]/);
    }
  });
});

// ------------------------------------------------------------------ telas

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Verde Poda",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function responder(mapa: Record<string, unknown>) {
  mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
    Object.prototype.hasOwnProperty.call(mapa, body.acao) ? { data: mapa[body.acao], error: null } : { data: { ok: true, custo_usd: 0.001 }, error: null },
  );
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
  mock.tabelas = {};
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5 }, error: null });
  responder({});
});

const OFERTA_DO_CONTEXTO = {
  id: "of-ctx",
  client_id: CLIENTE,
  nome: "Primavera sem galho",
  oferta: {
    para_quem: "Moradores de casa com quintal",
    promessa: "Quintal pronto para a primavera",
    mecanismo: "Equipe com NR35",
    entregaveis: ["Poda de árvores"],
    bonus: [],
    garantia: null,
    urgencia_real: "Primavera sem galho vai até 30/09",
    ancoragem: null,
    cta: "Chame no WhatsApp",
    provas_necessarias: [],
    riscos: [],
    origem: "contexto",
    fontes: { promessa: "campanha do mês na Mesa (conceito)", cta: "briefing de performance (destino)" },
    lacunas: ["Preço: sem preço confirmado."],
  },
  jev: null,
  status: "rascunho",
  conversa_id: null,
  criado_em: "2026-09-25",
};

describe("tela: oferta já vem do contexto e o agente lapida", () => {
  it("sem oferta em uso, monta do contexto uma vez (grátis); Lapidar leva o pedido e a oferta em foco ao agente", async () => {
    responder({
      oferta_do_contexto: { rascunho: {}, fontes: {}, lacunas: ["Preço: sem preço confirmado."], contexto: { tem_briefing: true, campanhas: [] }, oferta: OFERTA_DO_CONTEXTO, criada: true, custo_usd: 0 },
      oferta_conversar: { conversa_id: "c0ffee00-0000-4000-8000-000000000009", resposta: "Lapidei.", ofertas: [], ideias: [], custo_usd: 0.02 },
    });
    montar(h(AbaOferta, { onCriarCriativos: vi.fn() }));
    await waitFor(() => expect(chamadasDe("oferta_do_contexto")).toHaveLength(1));
    expect(chamadasDe("oferta_do_contexto")[0]).toMatchObject({ acao: "oferta_do_contexto", client_id: CLIENTE, gravar: true });
    const cartao = await screen.findByRole("article", { name: "Oferta Primavera sem galho" });
    expect(within(cartao).getByText("Do contexto")).toBeTruthy();
    expect(screen.getByLabelText("Oferta do contexto").textContent).toMatch(/sem IA/);

    fireEvent.click(within(cartao).getByRole("button", { name: /Lapidar com o agente/ }));
    const campo = screen.getByLabelText("Mensagem ao agente de oferta") as HTMLTextAreaElement;
    expect(campo.value).toMatch(/Lapide a oferta "Primavera sem galho" que veio do contexto/);
    expect(screen.getByText("Primavera sem galho", { selector: "span.font-medium" })).toBeTruthy();
    fireEvent.click(within(screen.getByLabelText("Agente de oferta")).getByRole("button", { name: /Enviar/ }));
    await waitFor(() => expect(chamadasDe("oferta_conversar")).toHaveLength(1));
    expect(chamadasDe("oferta_conversar")[0]).toMatchObject({ oferta_id: "of-ctx", client_id: CLIENTE });
    // Não monta de novo sozinho.
    expect(chamadasDe("oferta_do_contexto")).toHaveLength(1);
  });

  it("com oferta em uso, não monta sozinho; Remontar do contexto pede forcar", async () => {
    mock.tabelas.ads_ofertas = [OFERTA_DO_CONTEXTO];
    responder({ oferta_do_contexto: { oferta: OFERTA_DO_CONTEXTO, lacunas: [], fontes: {}, contexto: {}, criada: false, custo_usd: 0 } });
    montar(h(AbaOferta, { onCriarCriativos: vi.fn() }));
    await screen.findByRole("article", { name: "Oferta Primavera sem galho" });
    expect(chamadasDe("oferta_do_contexto")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Remontar do contexto/ }));
    await waitFor(() => expect(chamadasDe("oferta_do_contexto")).toHaveLength(1));
    expect(chamadasDe("oferta_do_contexto")[0]).toMatchObject({ gravar: true, forcar: true });
  });
});

describe("tela: plano com tom e Testar primeiro", () => {
  const PLANO = {
    id: "p-1", client_id: CLIENTE, briefing_id: "b-1", nome: "Plano agressivo", status: "rascunho", pedido: null, conversa_id: null, custo_usd: 0.05,
    criado_em: "2026-09-25", atualizado_em: "2026-09-25",
    angulos: [
      {
        id: "a1", nome: "Galho no telhado", situacao: "s", mecanismo: "m", hipotese: "Acreditamos que...", metrica: "conversa", gancho_verbal: "Tire o galho hoje",
        formatos: ["quadrado_1x1"], variacoes: 1, aprovado: true, pontuacao: 8.2, tom: "agressivo", generico: true, ordem_teste: 1,
        porque_testar_primeiro: "O anúncio de galho já trouxe 18 conversas", corte: { texto: "Pausar se gastar R$ 75,00 sem nenhum resultado", metrica: "conversa" },
        jev: { clareza: 8, relevancia: 8, prova: 5, risco_politica: 10, parada: 7, diferenciacao: 4, tom: 7.5 },
      },
    ],
    estrutura: { tom: "agressivo", testar_primeiro: [{ angulo_id: "a1", ordem: 1, nome: "Galho no telhado", porque: "O anúncio de galho já trouxe 18 conversas", hipotese: "H", metrica: "conversa", corte: "Pausar se gastar R$ 75,00 sem nenhum resultado" }], base_da_conta: { periodo_dias: 90, gasto: 225, resultados: 18, custo_por_resultado: 12.5 } },
  };

  it("mostra Testar primeiro, o corte, o selo genérico e a nota do tom; tom escolhido vai no plano_gerar", async () => {
    mock.tabelas.ads_planos = [PLANO];
    mock.tabelas.ads_briefings = [{ id: "b-1", versao: 2, oferta: {}, publico: {}, objecoes: [], provas: [], destino: {}, objetivo: {}, restricoes: null, criado_em: "2026-09-20" }];
    montar(h(AbaPlano, { planoId: "p-1", onPlano: vi.fn(), onProduzido: vi.fn() }));
    const testar = await screen.findByRole("region", { name: "Testar primeiro" });
    expect(testar.textContent).toMatch(/O anúncio de galho já trouxe 18 conversas/);
    expect(testar.textContent).toMatch(/R\$ 75,00/);
    expect(testar.textContent).toMatch(/R\$\s12,50 por resultado/);
    const cartao = screen.getByRole("article", { name: /Galho no telhado/ });
    expect(within(cartao).getByText("Genérico")).toBeTruthy();
    expect(within(cartao).getByText("Testar 1º")).toBeTruthy();
    expect(within(cartao).getByText("Regra de corte")).toBeTruthy();

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Tom do plano" })).getByRole("radio", { name: "Agressivo" }));
    fireEvent.click(screen.getByRole("button", { name: /Gerar plano/ }));
    const confirmar = await screen.findByRole("button", { name: /Confirmar|Gerar/ });
    fireEvent.click(confirmar);
    await waitFor(() => expect(chamadasDe("plano_gerar").length).toBeGreaterThanOrEqual(1));
    expect(chamadasDe("plano_gerar")[0].tom).toBe("agressivo");
  });

  it("corpos: tom só vai quando foi escolhido", () => {
    const p = normalizarPlano(PLANO) as PlanoAds;
    expect(corpoDaProducao(p, ["a1"], ["quadrado_1x1"])).toEqual({ plano_id: "p-1", angulo_ids: ["a1"], formatos: ["quadrado_1x1"] });
    expect(corpoDaProducao(p, ["a1"], ["quadrado_1x1"], "sobrio").tom).toBe("sobrio");
    expect(corpoDoPlano({ client_id: CLIENTE, quantidade_angulos: 4 })).toEqual({ client_id: CLIENTE, quantidade_angulos: 4 });
    expect(corpoDoPlano({ client_id: CLIENTE, quantidade_angulos: 4, tom: "agressivo" }).tom).toBe("agressivo");
  });
});
