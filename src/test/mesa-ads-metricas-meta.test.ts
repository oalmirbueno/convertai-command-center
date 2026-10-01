import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avisosDoNumero,
  caminhoDosInsights,
  classificacaoDaCampanha,
  classificacaoDosConjuntos,
  classificar,
  contagensDaColeta,
  diaDaSemana,
  faixasDoTempo,
  horaDaLinha,
  itemDaLinha,
  linhasDaColeta,
  melhorHorario,
  METRICAS,
  numerosDaLinha,
  OBJETIVOS,
  paginaDosInsights,
  somarNumeros,
  textoDaJanela,
  totaisPorObjetivo,
  valorDaAcao,
} from "../../supabase/functions/mesa-ads/modulos/metricas-meta";
import { metricasCompletas, mixDeObjetivos, tipoDoResultado, tiposPorAnuncio, TIPOS_DE_RESULTADO } from "../../supabase/functions/_shared/evolucao";
import { somarMetricas } from "../../supabase/functions/mesa-ads/calculos";
import { alternarColuna, colunasPadrao, colunasValidas, formatar, lerMetricas, lerNoTempo } from "@/components/mesa-ads/metricasMetaApi";

/**
 * Frente ADM (01/10/2026). Pedido do dono: "na Conta da Mesa Ads os números não estão marcando correto:
 * está engajamento 5, mas só chegou 1 mensagem". As fixtures são respostas REAIS da Graph API (só leitura,
 * sem token) e linhas reais da coleta (ads_creative_daily), lidas em 01/10/2026.
 */

const pasta = resolve(__dirname, "fixtures/meta-insights");
const ler = (nome: string): Record<string, any>[] => JSON.parse(readFileSync(resolve(pasta, `${nome}.json`), "utf8")).data;
const coletaStop = (): Record<string, any>[] => JSON.parse(readFileSync(resolve(pasta, "stop-coleta-setembro.json"), "utf8"));

describe("a causa do 5 x 1 (Stop Informática, 25/09 a 01/10)", () => {
  const coleta = coletaStop().filter((l) => l.day >= "2026-09-25" && l.day <= "2026-10-01");

  it("a Meta devolve o conjunto de WhatsApp como REPLIES nos insights", () => {
    expect(ler("stop-campanha-7d").map((l) => l.optimization_goal)).toEqual(["REPLIES", "REPLIES"]);
  });

  it("antes: o anúncio sem conversa virava engajamento e somava curtida e clique (5)", () => {
    // A regra antiga: optimization_goal desconhecido + OUTCOME_ENGAGEMENT decidia pela presença de mensagem.
    const engajamentoDosSemConversa = coleta
      .filter((l) => !coleta.some((x) => x.ad_id === l.ad_id && valorDaAcao(x.actions, ["onsite_conversion.messaging_conversation_started_7d"])))
      .reduce((s, l) => s + (valorDaAcao(l.actions, ["post_engagement"]) || 0), 0);
    expect(engajamentoDosSemConversa).toBe(5);
    expect(coleta.reduce((s, l) => s + (valorDaAcao(l.actions, ["onsite_conversion.messaging_conversation_started_7d"]) || 0), 0)).toBe(1);
  });

  it("depois: REPLIES é mensagem; o resultado da conta é Conversas iniciadas, nunca engajamento", () => {
    expect(tipoDoResultado("OUTCOME_ENGAGEMENT", "REPLIES", [{ action_type: "post_engagement", value: "3" }])).toBe("mensagens");
    const tipos = tiposPorAnuncio(coleta as any);
    expect([...tipos.values()].every((t) => t === "mensagens")).toBe(true);
    const m = metricasCompletas(coleta as any, tipos);
    expect(m.resultado_rotulo).toBe("Conversas iniciadas");
    expect(m.resultados).toBe(1);
    const porAd = new Map<string, any[]>();
    coleta.forEach((l) => porAd.set(l.ad_id, (porAd.get(l.ad_id) || []).concat([l])));
    const mix = mixDeObjetivos([...porAd].map(([ad, ls]) => {
      const x = metricasCompletas(ls, tipos.get(ad) ?? null);
      return { tipo: x.resultado_tipo, gasto: x.gasto, resultados: x.resultados };
    }));
    expect(mix.por_grupo.map((g) => g.grupo)).toEqual(["mensagem"]);
    expect(mix.alertas).toEqual([]);
  });

  it("a Meta ao vivo já mostra 2 conversas no período (a coleta tinha 1): o aviso diz a diferença", () => {
    const conta = numerosDaLinha(ler("stop-conta-7d")[0], { objetivo: null, resultado: null });
    expect(conta.conversas).toBe(2);
    const avisos = avisosDoNumero({ fim: "2026-10-01", hoje: "2026-10-01", fonte: "meta_ao_vivo", aoVivo: { conversas: conta.conversas || 0, leads: 0, compras: 0, gasto: conta.gasto || 0 }, coleta: contagensDaColeta(coleta) });
    expect(avisos.join(" ")).toMatch(/inclui hoje/);
    expect(avisos.join(" ")).toMatch(/2 conversas na Meta e 1 na coleta/);
  });
});

describe("conversa iniciada é só messaging_conversation_started_7d (igual à coluna Resultados)", () => {
  it("a conexão de mensagem não entra nem como reserva (setembro: Stop 4, Verzelo 13, Mirante 116 na Meta)", () => {
    for (const [nome, esperado] of [["stop-conta-0902-0930", 4], ["verzelo-conta-0902-0930", 13], ["mirante-conta-0902-0930", 116]] as const) {
      const linha = ler(nome)[0];
      expect(numerosDaLinha(linha, classificar("OUTCOME_ENGAGEMENT", "REPLIES")).conversas).toBe(esperado);
    }
    // Na coleta da Stop em setembro: 4 iniciadas e 8 conexões; a regra antiga (conexão no dia sem conversa) dava 7.
    const setembro = coletaStop().filter((l) => l.day <= "2026-09-30");
    expect(contagensDaColeta(setembro).conversas).toBe(4);
    expect(metricasCompletas(setembro as any, "mensagens").resultados).toBe(4);
    expect(somarMetricas(setembro as any).resultados_por_tipo.mensagens).toBe(4);
    expect(TIPOS_DE_RESULTADO.filter((t) => t.tipo === "mensagens")[0].acoes).toEqual(["onsite_conversion.messaging_conversation_started_7d"]);
  });

  it("conexão de mensagem é outra métrica, com nome próprio", () => {
    const linha = ler("stop-conta-0902-0930")[0];
    const n = numerosDaLinha(linha, classificar("OUTCOME_ENGAGEMENT", "REPLIES"));
    expect(n.conexoes_mensagem).toBe(8);
    expect(n.resultados).toBe(4);
    expect(METRICAS.filter((m) => m.id === "conexoes_mensagem")[0].rotulo).toBe("Contatos por mensagem");
  });
});

describe("cada métrica pelo action_type oficial e o resultado pelo objetivo", () => {
  it("classifica pelo optimization_goal e, sem ele, pelo objetivo da campanha (nunca pela presença de ação)", () => {
    expect(classificar("OUTCOME_ENGAGEMENT", "REPLIES")).toEqual({ objetivo: "mensagens", resultado: "conversas" });
    expect(classificar("OUTCOME_ENGAGEMENT", "CONVERSATIONS")).toEqual({ objetivo: "mensagens", resultado: "conversas" });
    expect(classificar("OUTCOME_LEADS", "OFFSITE_CONVERSIONS")).toEqual({ objetivo: "leads", resultado: "leads" });
    expect(classificar("OUTCOME_LEADS", "Unknown Optimization Goal")).toEqual({ objetivo: "leads", resultado: "leads" });
    expect(classificar("OUTCOME_SALES", "OFFSITE_CONVERSIONS")).toEqual({ objetivo: "vendas", resultado: "compras" });
    expect(classificar("LINK_CLICKS", "PROFILE_VISIT")).toEqual({ objetivo: "trafego", resultado: "visitas_perfil" });
    expect(classificar("LINK_CLICKS", "NONE")).toEqual({ objetivo: "trafego", resultado: "cliques_link" });
    expect(classificar("OUTCOME_TRAFFIC", "LANDING_PAGE_VIEWS")).toEqual({ objetivo: "trafego", resultado: "visitas_pagina" });
    expect(classificar("OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT")).toEqual({ objetivo: "engajamento", resultado: "engajamento" });
    expect(classificar("OUTCOME_ENGAGEMENT", "PROFILE_AND_PAGE_ENGAGEMENT")).toEqual({ objetivo: "seguidores", resultado: "seguidores" });
    expect(classificar("OUTCOME_AWARENESS", "REACH")).toEqual({ objetivo: "reconhecimento", resultado: "alcance" });
    expect(classificar("OUTCOME_ENGAGEMENT", "THRUPLAY")).toEqual({ objetivo: "video", resultado: "thruplay" });
    expect(classificar("OUTCOME_ENGAGEMENT", null)).toEqual({ objetivo: "engajamento", resultado: "engajamento" });
    expect(classificar(null, null)).toEqual({ objetivo: null, resultado: null });
  });

  it("todo objetivo do seletor existe e as colunas prontas são do catálogo", () => {
    expect(OBJETIVOS.map((o) => o.id)).toEqual(["mensagens", "leads", "trafego", "engajamento", "vendas", "reconhecimento", "video", "seguidores"]);
    const ids = METRICAS.map((m) => m.id);
    for (const o of OBJETIVOS) for (const c of o.colunas) expect(ids).toContain(c);
    for (const m of METRICAS) {
      expect(m.ajuda.length).toBeGreaterThan(10);
      expect(m.rotulo + m.ajuda).not.toMatch(/[–—]/);
    }
  });

  it("Stop (conta, 7 dias): todos os números da linha real da Meta", () => {
    const linha = ler("stop-conta-7d")[0];
    const gasto = Number(linha.spend);
    const imp = Number(linha.impressions);
    const n = numerosDaLinha(linha, { objetivo: "mensagens", resultado: "conversas" });
    expect(n).toMatchObject({ gasto, impressoes: imp, alcance: Number(linha.reach), conversas: 2, primeira_resposta: 2, engajamento: 8, cliques_link: 3, resultados: 2 });
    expect(n.custo_por_resultado).toBeCloseTo(gasto / 2, 2);
    expect(n.frequencia).toBeCloseTo(Number(linha.frequency), 2);
    expect(n.ctr_link).toBeCloseTo((3 / imp) * 100, 2);
    expect(n.cpm).toBeCloseTo((gasto / imp) * 1000, 2);
  });

  it("Ajenda (leads, 30 dias): lead e lead do pixel não somam (44, não 88)", () => {
    const l = ler("ajenda-campanha-30d")[0];
    const c = classificar(l.objective, l.optimization_goal);
    const n = numerosDaLinha(l, c);
    expect(c.resultado).toBe("leads");
    expect(n.leads).toBe(44);
    expect(n.resultados).toBe(44);
    expect(n.visitas_pagina).toBe(280);
    expect(n.thruplay).toBe(230);
    expect(n.video_3s).toBe(590);
  });

  it("Preserva (30 dias): alcance, visita ao perfil e seguidores cada um no seu objetivo", () => {
    const itens = ler("preserva-campanha-30d").map((l) => itemDaLinha("campanha", l, classificacaoDosConjuntos([]))!);
    expect(itens.map((i) => i.objetivo).sort()).toEqual(["reconhecimento", "seguidores", "trafego"]);
    const alcance = itens.filter((i) => i.objetivo === "reconhecimento")[0];
    expect(alcance.resultado_rotulo).toBe("Alcance");
    expect(alcance.numeros.resultados).toBe(1058);
  });
});

describe("níveis e totais por objetivo", () => {
  it("anúncios da Stop: cada um com Conversas iniciadas, inclusive o que não trouxe conversa (0, não engajamento)", () => {
    const linhas = ler("stop-anuncio-7d");
    const conjuntos = classificacaoDosConjuntos(linhas);
    const itens = linhas.map((l) => itemDaLinha("anuncio", l, conjuntos)!);
    expect(itens.map((i) => i.resultado_rotulo)).toEqual(["Conversas iniciadas", "Conversas iniciadas", "Conversas iniciadas"]);
    expect(itens.map((i) => i.numeros.resultados)).toEqual([1, 0, 1]);
    const totais = totaisPorObjetivo(linhas.map((l) => itemDaLinha("conjunto", l, conjuntos)!));
    expect(totais).toHaveLength(1);
    expect(totais[0]).toMatchObject({ objetivo: "mensagens", resultado: "conversas", resultado_rotulo: "Conversas iniciadas", campanhas: 2 });
    expect(totais[0].numeros.resultados).toBe(2);
  });

  it("a campanha herda o resultado do conjunto com mais gasto (a campanha da Meta pode vir com NONE)", () => {
    const conjuntos = classificacaoDosConjuntos([{ adset_id: "1", campaign_id: "9", objective: "LINK_CLICKS", optimization_goal: "PROFILE_VISIT", spend: "30" }]);
    expect(classificacaoDaCampanha("9", "LINK_CLICKS", "NONE", conjuntos)).toEqual({ objetivo: "trafego", resultado: "visitas_perfil" });
  });

  it("alcance não soma entre linhas e resultados de tipos diferentes não somam", () => {
    const a = numerosDaLinha({ spend: "10", impressions: "100", reach: "80", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "2" }] }, { objetivo: "mensagens", resultado: "conversas" });
    const b = numerosDaLinha({ spend: "5", impressions: "50", reach: "40", actions: [{ action_type: "lead", value: "3" }] }, { objetivo: "leads", resultado: "leads" });
    const s = somarNumeros([{ numeros: a, resultado: "conversas" }, { numeros: b, resultado: "leads" }]);
    expect(s.misto).toBe(true);
    expect(s.numeros.resultados).toBeNull();
    expect(s.numeros.alcance).toBeNull();
    expect(somarNumeros([{ numeros: a, resultado: "conversas" }], 75).numeros).toMatchObject({ alcance: 75, resultados: 2, frequencia: 1.33 });
  });

  it("sem Meta, a coleta vira linhas do mesmo formato (Stop, setembro)", () => {
    const linhas = linhasDaColeta(coletaStop(), "campanha", { campanhas: new Map(), anuncios: new Map() });
    const conjuntos = classificacaoDosConjuntos(linhasDaColeta(coletaStop(), "conjunto", { campanhas: new Map(), anuncios: new Map() }));
    const itens = linhas.map((l) => itemDaLinha("campanha", l, conjuntos)!);
    expect(itens.every((i) => i.resultado === "conversas")).toBe(true);
    expect(itens.reduce((s, i) => s + (i.numeros.conversas || 0), 0)).toBe(contagensDaColeta(coletaStop()).conversas);
  });
});

describe("por horário (quebra hourly_stats_aggregated_by_advertiser_time_zone)", () => {
  it("lê a hora e o dia da semana", () => {
    expect(horaDaLinha("13:00:00 - 13:59:59")).toBe(13);
    expect(horaDaLinha("x")).toBeNull();
    expect(diaDaSemana("2026-09-28")).toBe(1);
    expect(diaDaSemana("2026-10-04")).toBe(0);
  });

  it("Stop, 30 dias: 24 horas e 7 dias que somam as mesmas conversas, com o melhor horário", () => {
    const horas = ler("stop-hora-30d");
    const dias = ler("stop-dia-30d");
    const classe = (l: Record<string, unknown>) => classificar(String(l.objective), String(l.optimization_goal));
    const h = faixasDoTempo(horas, "hora", classe);
    const d = faixasDoTempo(dias, "dia_da_semana", classe);
    expect(h.faixas).toHaveLength(24);
    expect(d.faixas).toHaveLength(7);
    expect(h.resultado).toBe("conversas");
    const soma = (f: { conversas: number }[]) => f.reduce((s, x) => s + x.conversas, 0);
    expect(soma(h.faixas)).toBe(soma(d.faixas));
    expect(soma(h.faixas)).toBeGreaterThan(0);
    const gastoHoras = h.faixas.reduce((s, x) => s + x.gasto, 0);
    const gastoDias = d.faixas.reduce((s, x) => s + x.gasto, 0);
    expect(Math.abs(gastoHoras - gastoDias)).toBeLessThan(0.05);
    const m = melhorHorario(h.faixas, "resultados", "hora");
    expect(m.melhor).not.toBeNull();
    expect(h.faixas[m.melhor!.indice].resultados).toBe(Math.max(...h.faixas.map((f) => f.resultados || 0)));
    expect(m.faixa!.rotulo).toMatch(/^das \d{2}h às \d{2}h$/);
  });

  it("filtra pelo objetivo e não aponta melhor horário sem resultado", () => {
    const horas = ler("stop-hora-30d");
    const so = faixasDoTempo(horas, "hora", (l) => classificar(String(l.objective), String(l.optimization_goal)), (c) => c.objetivo === "leads");
    expect(so.faixas.every((f) => f.gasto === 0)).toBe(true);
    expect(melhorHorario(so.faixas, "conversas", "hora")).toEqual({ melhor: null, faixa: null, pouco_volume: true });
  });
});

describe("pedido à Meta (só leitura) e janela de atribuição", () => {
  it("o caminho usa a janela do Gerenciador, a quebra por hora e o filtro de campanhas, sem token", () => {
    const c = caminhoDosInsights("act_123", { nivel: "conjunto", inicio: "2026-09-25", fim: "2026-10-01", quebra: "hora" });
    expect(c.indexOf("act_123/insights?")).toBe(0);
    expect(c).toContain("level=adset");
    expect(c).toContain("use_unified_attribution_setting=true");
    expect(c).toContain("breakdowns=hourly_stats_aggregated_by_advertiser_time_zone");
    expect(decodeURIComponent(c)).toContain('{"since":"2026-09-25","until":"2026-10-01"}');
    expect(c).not.toMatch(/access_token/);
    const f = decodeURIComponent(caminhoDosInsights("123", { nivel: "conta", inicio: "2026-09-01", fim: "2026-09-30", campanhas: ["1", "2"], depois: "abc" }));
    expect(f).toContain('"field":"campaign.id","operator":"IN","value":["1","2"]');
    expect(f).toContain("after=abc");
    expect(paginaDosInsights({ data: [{ a: 1 }], paging: { cursors: { after: "x" }, next: "https://..." } })).toEqual({ linhas: [{ a: 1 }], depois: "x" });
    expect(paginaDosInsights({ data: [], paging: { cursors: { after: "x" } } }).depois).toBeNull();
  });

  it("a janela em português, como o conjunto está no Gerenciador", () => {
    expect(textoDaJanela([[{ event_type: "CLICK_THROUGH", window_days: 7 }]])).toBe("7 dias após o clique");
    expect(textoDaJanela([[{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }]])).toBe("7 dias após o clique ou 1 dia após ver");
    expect(textoDaJanela([])).toMatch(/padrão da Meta/);
    expect(textoDaJanela([[{ event_type: "CLICK_THROUGH", window_days: 1 }], [{ event_type: "CLICK_THROUGH", window_days: 7 }]])).toMatch(/^varia por conjunto/);
  });
});

describe("tela: leitura, colunas e formato", () => {
  const resposta = {
    fonte: "meta_ao_vivo",
    janela: "7 dias após o clique",
    total: { numeros: { conversas: 2, resultados: 2, gasto: 23.7 }, resultado: "conversas", resultado_rotulo: "Conversas iniciadas", misto: false, por_resultado: [] },
    objetivos: [{ objetivo: "mensagens", rotulo: "Mensagens", campanhas: 2, resultado: "conversas", resultado_rotulo: "Conversas iniciadas", por_resultado: [], numeros: { resultados: 2 } }, { objetivo: "outro", rotulo: "X" }],
    itens: [{ nivel: "campanha", id: "1", nome: "STOP", objetivo: "mensagens", resultado: "conversas", resultado_rotulo: "Conversas iniciadas", numeros: { conversas: "1" } }],
    catalogo: METRICAS,
    definicoes_de_objetivo: OBJETIVOS,
    colunas_de_todos: ["gasto", "conversas"],
    avisos: ["a"],
  };
  it("normaliza a resposta e descarta objetivo desconhecido", () => {
    const l = lerMetricas(resposta);
    expect(l.objetivos.map((o) => o.objetivo)).toEqual(["mensagens"]);
    expect(l.itens[0].numeros.conversas).toBe(1);
    expect(l.catalogo.length).toBe(METRICAS.length);
    expect(lerMetricas(null).itens).toEqual([]);
  });
  it("colunas prontas por objetivo, escolha válida e alternar sem mudar a ordem", () => {
    const l = lerMetricas(resposta);
    expect(colunasPadrao(l, "mensagens")[0]).toBe("conversas");
    expect(colunasPadrao(l, "")).toEqual(["gasto", "conversas"]);
    expect(colunasValidas(["xyz", "cpm", "cpm"], l.catalogo, ["gasto"])).toEqual(["cpm"]);
    expect(colunasValidas([], l.catalogo, ["gasto"])).toEqual(["gasto"]);
    expect(alternarColuna(["a", "b"], "a")).toEqual(["b"]);
    expect(alternarColuna(["a"], "c")).toEqual(["a", "c"]);
    expect(formatar(11.85, "brl")).toBe("R$ 11,85");
    expect(formatar(null, "inteiro")).toBe("-");
  });
  it("horário: exige 24 horas e 7 dias", () => {
    const t = lerNoTempo({ medida: { chave: "conversas", rotulo: "Conversas iniciadas" }, hora: { faixas: [{ indice: 0 }] }, dia_da_semana: { faixas: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ indice: i, rotulo: "d" })) } });
    expect(t.hora).toBeNull();
    expect(t.diaDaSemana!.faixas).toHaveLength(7);
    expect(t.medida.chave).toBe("conversas");
  });
});
