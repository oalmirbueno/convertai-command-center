import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aplicarTravas,
  avaliarItem,
  candidatosDaRodada,
  decidirComJev,
  foraDoNormal,
  LIMITES_PADRAO,
  limitesDoDono,
  limitesEfetivos,
  novaVerba,
  numerosDaMeta,
  opcoesDePrazo,
  PADROES_DA_ROTINA,
  perguntasDaRegra,
  perguntasDaRodada,
  provaSuficiente,
  regraDasRespostas,
  regraEmTexto,
  regraQueBarra,
  regrasQueValem,
  retratoParaOAgente,
  type ItemDaConta,
  type RegraDoDono,
  type RetratoDaConta,
} from "../../supabase/functions/mesa-ads/rotina-trafego";
import { configDaLinha, rodarRotina, retratoDaContaAoVivo, type DepsDaRodada, type LinhaDaRotina, type RegistroDaRotina } from "../../supabase/functions/mesa-ads/rotina-rodada";
import {
  acaoSemRisco,
  alvosComApelido,
  arquivarMontagem,
  ativarMontagem,
  completarMontagem,
  criativosComApelido,
  desfazerNaMeta,
  type GrafoMeta,
  itemDeMontagem,
  montarCampanhaNaMeta,
  normalizarAcoesDaConta,
  temReverso,
} from "../../supabase/functions/mesa-ads/acoes-conta";
import { CONHECIMENTO_TRAFEGO, referenciaDoNicho } from "../../supabase/functions/_shared/conhecimento-trafego";
import { tarefaDoAgenteSenior } from "../../supabase/functions/mesa-ads/agente-senior";

/**
 * Frente TR (27/09): rotina de monitoramento do tráfego e o agente sênior que
 * faz sozinho o que é seguro. Regras puras (sem banco, sem rede): candidatos
 * pela regra, Jev decide o caso, travas duras em código, prova obrigatória,
 * montagem da campanha do plano pausada. Nada aqui escreve na Meta de
 * verdade: o grafo e as dependências são falsos.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const anuncio = (extra: Partial<ItemDaConta> = {}): ItemDaConta => ({
  nivel: "anuncio",
  meta_id: "140000000000001",
  nome: "Chama no WhatsApp",
  status: "ACTIVE",
  campanha_id: "120000000000001",
  campanha: "Mensagens",
  conjunto_id: "130000000000001",
  conjunto: "Raio 5 km",
  resultado_tipo: "mensagens",
  resultado_rotulo: "Conversas iniciadas",
  orcamento_diario_brl: null,
  gasto: 0,
  impressoes: 0,
  resultados: 0,
  custo_por_resultado: null,
  ctr_link_pct: null,
  cpm: null,
  frequencia: null,
  dias_com_gasto: 5,
  primeiro_dia: "2026-09-20",
  ctr_var_pct: null,
  custo_var_pct: null,
  ...extra,
});

const L = { ...LIMITES_PADRAO, custo_alvo_brl: 12 };

describe("regra fixa de cada item (sem IA)", () => {
  it("R$ 10 a 15 por dia sem mensagem: candidato a pausar a partir de 2 vezes o custo-alvo; forte em 1,5 vez o limite", () => {
    const a = avaliarItem(anuncio({ gasto: 30, impressoes: 4000, dias_com_gasto: 3 }), L);
    expect(a).toMatchObject({ sinal: "queimando", acao: "pausar", forte: false });
    expect(a.regra).toMatch(/R\$ 30,00 em 3 dias sem nenhuma conversa \(limite R\$ 24,00/);
    expect(avaliarItem(anuncio({ gasto: 40, impressoes: 4000 }), L).forte).toBe(true);
    // Antes do limite: cedo, nada a fazer.
    expect(avaliarItem(anuncio({ gasto: 20, impressoes: 4000 }), L)).toMatchObject({ sinal: "cedo", acao: null });
  });

  it("fase de aprendizado: no começo só pausa com queima grave", () => {
    expect(avaliarItem(anuncio({ gasto: 30, impressoes: 3000, dias_com_gasto: 1 }), L)).toMatchObject({ sinal: "aprendizado", acao: null });
    expect(avaliarItem(anuncio({ gasto: 37, impressoes: 3000, dias_com_gasto: 1 }), L)).toMatchObject({ sinal: "queimando", acao: "pausar" });
  });

  it("gasto mínimo antes de julgar, sem custo-alvo (o dobro do mínimo)", () => {
    const semAlvo = { ...LIMITES_PADRAO };
    expect(avaliarItem(anuncio({ gasto: 25, impressoes: 3000 }), semAlvo).acao).toBeNull();
    expect(avaliarItem(anuncio({ gasto: 31, impressoes: 3000 }), semAlvo).acao).toBe("pausar");
  });

  it("custo alto com volume, fadiga, criativo que não chama atenção e vencedor", () => {
    expect(avaliarItem(anuncio({ gasto: 120, impressoes: 9000, resultados: 4, custo_por_resultado: 30 }), L)).toMatchObject({ sinal: "custo_alto", acao: "pausar" });
    expect(avaliarItem(anuncio({ gasto: 80, impressoes: 9000, resultados: 8, custo_por_resultado: 10, frequencia: 4.2, ctr_var_pct: -35 }), L)).toMatchObject({ sinal: "fadiga", acao: "trocar_criativo" });
    expect(avaliarItem(anuncio({ gasto: 16, impressoes: 5000, ctr_link_pct: 0.3 }), L)).toMatchObject({ sinal: "sem_clique", acao: "trocar_criativo" });
    const conjunto = anuncio({ nivel: "conjunto", meta_id: "130000000000001", gasto: 70, impressoes: 9000, resultados: 9, custo_por_resultado: 7.8, frequencia: 1.6 });
    expect(avaliarItem(conjunto, L)).toMatchObject({ sinal: "vencedor", acao: "subir_verba" });
    // Anúncio nunca sobe verba (ela mora no conjunto ou na campanha).
    expect(avaliarItem({ ...conjunto, nivel: "anuncio" }, L).acao).toBeNull();
    expect(avaliarItem(anuncio({ status: "PAUSED", gasto: 999 }), L)).toMatchObject({ sinal: "parado", acao: null });
  });
});

describe("limites: fonte do custo-alvo e o que o dono edita", () => {
  it("dono, plano, briefing, conta (com volume) e nicho, nesta ordem", () => {
    const ref = referenciaDoNicho("estetica", "mensagens");
    expect(ref && ref.custo_tipico_brl).toBe(20);
    expect(limitesEfetivos({ dono: { custo_alvo_brl: 9 }, custoDoPlano: 11, referencia: ref }).fontes.custo_alvo_brl).toBe("dono");
    expect(limitesEfetivos({ custoDoPlano: 11, custoDoBriefing: 14, referencia: ref }).limites.custo_alvo_brl).toBe(11);
    expect(limitesEfetivos({ custoMedioDaConta: 8, resultadosDaConta: 4, referencia: ref }).fontes.custo_alvo_brl).toBe("nicho");
    expect(limitesEfetivos({ custoMedioDaConta: 8, resultadosDaConta: 40, referencia: ref }).fontes.custo_alvo_brl).toBe("conta");
    expect(limitesEfetivos({}).limites.custo_alvo_brl).toBeNull();
  });

  it("o que o dono manda fora da faixa volta ao padrão", () => {
    expect(limitesDoDono({ custo_alvo_brl: "12,5", gasto_minimo_brl: 2, frequencia_maxima: 4, lixo: 9 })).toEqual({ custo_alvo_brl: 12.5, frequencia_maxima: 4 });
  });

  it("a configuração sempre dentro das travas (subida nunca passa de 30%)", () => {
    const c = configDaLinha({ ligada: true, teto_diario_brl: "80", subida_max_pct: 90, max_acoes_rodada: 99, max_acoes_dia: 0 });
    expect(c).toMatchObject({ ligada: true, teto_diario_brl: 80, subida_max_pct: 30, max_acoes_rodada: 10, max_acoes_dia: 1 });
    expect(configDaLinha(null)).toMatchObject({ ligada: false, teto_diario_brl: null, subida_max_pct: 20, max_acoes_rodada: 3, max_acoes_dia: 6 });
  });
});

const retrato = (itens: ItemDaConta[], extra: Partial<RetratoDaConta> = {}): RetratoDaConta => ({
  periodo: { inicio: "2026-09-21", fim: "2026-09-27", dias: 7 },
  sincronizado_em: "2026-09-27T14:40:00.000Z",
  objetivo_tipo: "mensagens",
  resultado_rotulo: "Conversas iniciadas",
  itens,
  serie: [
    { dia: "2026-09-24", gasto: 40, resultados: 4 },
    { dia: "2026-09-25", gasto: 42, resultados: 5 },
    { dia: "2026-09-26", gasto: 39, resultados: 4 },
    { dia: "2026-09-27", gasto: 20, resultados: 2 },
  ],
  totais: { gasto: 141, resultados: 15, custo_por_resultado: 9.4 },
  orcamento_ativo_brl: 60,
  ...extra,
});
const AGORA = Date.parse("2026-09-27T15:00:00.000Z");

describe("fora do normal: para e avisa, não mexe", () => {
  it("dado velho (coletor parado), gasto disparado, resultado zerado de repente e pausa em massa", () => {
    const itens = [anuncio({ gasto: 10, impressoes: 900 })];
    expect(foraDoNormal(retrato(itens, { sincronizado_em: "2026-09-27T05:00:00.000Z" }), [], AGORA).parar[0]).toMatch(/não são atualizados há 10 horas/);
    expect(foraDoNormal(retrato(itens, { serie: [{ dia: "2026-09-25", gasto: 30, resultados: 3 }, { dia: "2026-09-26", gasto: 30, resultados: 3 }, { dia: "2026-09-27", gasto: 120, resultados: 3 }] }), [], AGORA).parar[0]).toMatch(/mais de 3 vezes acima da média/);
    const zerado = retrato(itens, { serie: [{ dia: "2026-09-24", gasto: 40, resultados: 5 }, { dia: "2026-09-25", gasto: 40, resultados: 4 }, { dia: "2026-09-26", gasto: 38, resultados: 0 }, { dia: "2026-09-27", gasto: 35, resultados: 0 }] });
    expect(foraDoNormal(zerado, [], AGORA).parar.join(" ")).toMatch(/rastreio quebrado ou o WhatsApp fora do ar/);
    const queimando = [1, 2, 3].map((k) => avaliarItem(anuncio({ meta_id: `14000000000000${k}`, gasto: 60, impressoes: 5000 }), L));
    expect(foraDoNormal(retrato(itens), queimando, AGORA).parar.join(" ")).toMatch(/pausar 3 de 3 anúncios ativos/);
    // Orçamento ativo acima do teto: não para, só trava a subida.
    const r = foraDoNormal(retrato(itens, { orcamento_ativo_brl: 150 }), [], AGORA, 100);
    expect(r.parar).toEqual([]);
    expect(r.sem_subir[0]).toMatch(/não subo verba/);
    expect(foraDoNormal(retrato(itens), [], AGORA)).toEqual({ parar: [], sem_subir: [] });
  });
});

describe("Jev: o caso de julgamento", () => {
  const cands = candidatosDaRodada([
    avaliarItem(anuncio({ gasto: 40, impressoes: 5000 }), L),
    avaliarItem(anuncio({ nivel: "conjunto", meta_id: "130000000000001", gasto: 70, impressoes: 9000, resultados: 9, custo_por_resultado: 7.8, frequencia: 1.6 }), L),
    avaliarItem(anuncio({ meta_id: "140000000000009", gasto: 80, impressoes: 9000, resultados: 8, custo_por_resultado: 10, frequencia: 4.2, ctr_var_pct: -35 }), L),
  ]);

  it("uma Choice por caso (com saída de não mexer) e um Noul de fora do normal, numa chamada", () => {
    const { state, questions } = perguntasDaRodada(cands, { nicho: "Estética", objetivo: "mensagens", estrategia: null, limites: L, regras_do_dono: ["não mexe no Raio 5 km"], conta: { gasto_7d: 141, resultados_7d: 15, custo_por_resultado: 9.4, anuncios_ativos: 3 } });
    expect(Object.keys(questions)).toEqual(["caso_0", "caso_1", "caso_2", "fora_do_normal"]);
    expect(Object.keys((questions.caso_0 as { criteria: Record<string, unknown> }).criteria)).toEqual(["pausar", "trocar_criativo", "observar", "manter"]);
    expect(Object.keys((questions.caso_2 as { criteria: Record<string, unknown> }).criteria)).toEqual(["subir_verba", "manter", "observar"]);
    expect(questions.fora_do_normal.type).toBe("noul");
    expect(JSON.stringify(state)).toContain("não mexe no Raio 5 km");
  });

  it("age só quando regra e Jev concordam acima do limiar; sem Jev, não age; criativo novo vira proposta", () => {
    const d = decidirComJev(cands, {
      caso_0: { choice: "pausar", confidence: 0.8, probabilities: { pausar: 0.82, observar: 0.1, manter: 0.05, trocar_criativo: 0.03 } },
      caso_1: { choice: "trocar_criativo", confidence: 0.7, probabilities: { trocar_criativo: 0.75, pausar: 0.2 } },
      caso_2: { choice: "subir_verba", confidence: 0.5, probabilities: { subir_verba: 0.62, manter: 0.3 } },
      fora_do_normal: { noul: 0.1 },
    });
    expect(d.decisoes.map((x) => [x.agir, x.proposta])).toEqual([[true, false], [false, true], [false, false]]);
    expect(d.decisoes[2].motivo).toMatch(/sem certeza suficiente \(62%, mínimo 70%\)/);
    expect(d.fora_do_normal).toBe(0.1);
    expect(decidirComJev(cands, null).decisoes.every((x) => !x.agir && /não respondeu/.test(x.motivo))).toBe(true);
    expect(decidirComJev(cands, { caso_0: { choice: "observar", confidence: 0.9, probabilities: { observar: 0.9, pausar: 0.05 } } }).decisoes[0].agir).toBe(false);
  });
});

describe("travas duras (o modelo não pula)", () => {
  const regras: RegraDoDono[] = [
    { id: "r1", texto: "não pausa o anúncio do vídeo", tipo: "nao_pausar", alvos: [{ nivel: "anuncio", meta_id: "140000000000002", nome: "Vídeo" }], ate: "2026-10-03", criada_em: "", criada_por: null, ativa: true },
    { id: "r2", texto: "não mexe no conjunto Raio 5 km", tipo: "nao_mexer", alvos: [{ nivel: "conjunto", meta_id: "130000000000005", nome: "Raio" }], ate: null, criada_em: "", criada_por: null, ativa: true },
    { id: "r3", texto: "velha", tipo: "nao_mexer", alvos: [], ate: "2026-09-01", criada_em: "", criada_por: null, ativa: true },
  ];
  const decisao = (item: ItemDaConta, acao: "pausar" | "subir_verba" = "pausar", forte = false) => ({
    candidato: { ref: "k1", avaliacao: { item, sinal: "queimando" as const, acao, forte, regra: "x" }, opcoes: [] },
    veredito: { ref: "k1", escolha: acao, probabilidade: 0.9, confianca: 0.9, probabilidades: null },
    agir: true,
    proposta: false,
    motivo: "ok",
  });
  const base = { agoraMs: AGORA, hoje: "2026-09-27", regras, recentes: [], max_rodada: 3, max_dia: 6, anuncios_ativos: 5, teto_diario_brl: 100 };

  it("regras do dono barram (alvo direto, pelo conjunto, prazo vencido não vale)", () => {
    expect(regrasQueValem(regras, "2026-09-27").map((r) => r.id)).toEqual(["r1", "r2"]);
    const t = aplicarTravas([decisao(anuncio({ meta_id: "140000000000002" })), decisao(anuncio({ meta_id: "140000000000003", conjunto_id: "130000000000005" })), decisao(anuncio({ meta_id: "140000000000004" }))], base);
    expect(t.fazer.map((d) => d.candidato.avaliacao.item.meta_id)).toEqual(["140000000000004"]);
    expect(t.barrados.map((b) => b.motivo)).toEqual(['Regra sua: "não pausa o anúncio do vídeo".', 'Regra sua: "não mexe no conjunto Raio 5 km".']);
    // regraQueBarra recebe as regras que valem hoje (quem chama filtra pelo prazo).
    expect(regraQueBarra("ajustar", { meta_id: "140000000000002", campanha_id: null, conjunto_id: null }, regrasQueValem(regras, "2026-09-27"))).toBeNull();
    expect(regraEmTexto(regras[0])).toBe("Não pausar: anúncio Vídeo, até 03/10");
  });

  it("limite por rodada e por dia, mesmo item em 24 h, verba a cada 72 h, sem teto não sobe", () => {
    const muitas = [1, 2, 3, 4].map((k) => decisao(anuncio({ meta_id: `14000000000001${k}` })));
    expect(aplicarTravas(muitas, { ...base, regras: [] }).fazer).toHaveLength(3);
    const hoje = [1, 2, 3, 4, 5].map((k) => ({ meta_id: `x${k}`, tipo: "pausar", criado_em: "2026-09-27T10:00:00.000Z", origem: "rotina" }));
    expect(aplicarTravas(muitas, { ...base, regras: [], recentes: hoje }).fazer).toHaveLength(1);
    const mesmo = aplicarTravas([decisao(anuncio({ meta_id: "140000000000020" }))], { ...base, regras: [], recentes: [{ meta_id: "140000000000020", tipo: "pausar", criado_em: "2026-09-27T01:00:00.000Z", origem: "agente" }] });
    expect(mesmo.barrados[0].motivo).toMatch(/há menos de 24 h/);
    const verba = decisao(anuncio({ nivel: "conjunto", meta_id: "130000000000009" }), "subir_verba");
    expect(aplicarTravas([verba], { ...base, regras: [], recentes: [{ meta_id: "130000000000009", tipo: "orcamento", criado_em: "2026-09-25T15:00:00.000Z", origem: "rotina" }] }).barrados[0].motivo).toMatch(/há menos de 72 h/);
    expect(aplicarTravas([verba], { ...base, regras: [], teto_diario_brl: null }).barrados[0].motivo).toMatch(/Sem teto diário/);
  });

  it("nunca pausa o último anúncio ativo sem motivo forte", () => {
    const ultimo = { ...base, regras: [], anuncios_ativos: 1 };
    expect(aplicarTravas([decisao(anuncio())], ultimo).barrados[0].motivo).toMatch(/último anúncio ativo/);
    expect(aplicarTravas([decisao(anuncio(), "pausar", true)], ultimo).fazer).toHaveLength(1);
  });

  it("verba: no máximo o passo e nunca acima do teto diário", () => {
    expect(novaVerba(50, 20, 100, 70)).toMatchObject({ para: 60, variacao_pct: 20 });
    expect(novaVerba(50, 20, 100, 95)).toMatchObject({ para: 55, variacao_pct: 10 });
    expect(novaVerba(50, 80, 1000, 50)).toMatchObject({ para: 65, variacao_pct: 30 });
    expect(novaVerba(50, 20, 100, 100)).toBeNull();
    expect(novaVerba(50, 20, null, 50)).toBeNull();
    expect(novaVerba(null, 20, 100, 0)).toBeNull();
  });
});

describe("prova: sem ela, a ação não acontece", () => {
  const prova = {
    numeros: { periodo: { inicio: "2026-09-21", fim: "2026-09-27", dias: 7 }, gasto: 30, impressoes: 4000, resultados: 0, resultado_rotulo: "Conversas", custo_por_resultado: null, ctr_link_pct: 1, cpm: 20, frequencia: 1.2 },
    fonte: "Meta Ads, coletado pelo painel",
    sincronizado_em: "2026-09-27T14:40:00.000Z",
    relido_na_meta_em: null,
    antes: { status: "ACTIVE", efetivo: "ACTIVE", orcamento_diario_brl: null, nome: "x" },
    jev: { escolha: "pausar", probabilidade: 0.8, confianca: 0.8, probabilidades: null },
  };
  it("números com período, fonte, hora, estado lido antes e o Jev", () => {
    expect(provaSuficiente(prova)).toBeNull();
    expect(provaSuficiente({ ...prova, antes: null })).toMatch(/estado lido na Meta/);
    expect(provaSuficiente({ ...prova, jev: null })).toMatch(/veredito do Jev/);
    expect(provaSuficiente({ ...prova, sincronizado_em: null })).toMatch(/hora da leitura/);
    expect(provaSuficiente({ ...prova, jev: null }, false)).toBeNull();
  });
  it("números relidos na Meta contam o resultado do objetivo (o primeiro tipo presente)", () => {
    const n = numerosDaMeta({ data: [{ spend: "31.5", impressions: "4000", inline_link_clicks: "40", frequency: "1.5", actions: [{ action_type: "onsite_conversion.total_messaging_connection", value: "2" }, { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "1" }] }] }, ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"]);
    expect(n).toEqual({ gasto: 31.5, impressoes: 4000, resultados: 1, ctr_link_pct: 1, frequencia: 1.5 });
    expect(numerosDaMeta(null, [])).toBeNull();
  });
});

describe("interferir: a instrução do dono vira regra (o Jev escolhe, o código calcula)", () => {
  const alvos = [{ nivel: "conjunto" as const, meta_id: "130000000000005", nome: "Raio 5 km" }];
  it("prazos calculados aqui (sexta, fim do mês) e perguntas com a conta toda como saída", () => {
    const p = opcoesDePrazo("2026-09-27"); // domingo
    expect(p.sexta.data).toBe("2026-10-02");
    expect(p.amanha.data).toBe("2026-09-28");
    expect(p.fim_do_mes.data).toBe("2026-09-30");
    expect(p.sem_prazo.data).toBeNull();
    const q = perguntasDaRegra("segura a verba do raio até sexta", alvos, "2026-09-27");
    expect(Object.keys(q.questions.alvo.criteria)).toEqual(["conta_toda", "a1"]);
    expect(Object.keys(q.questions.tipo.criteria)).toContain("segurar_verba");
  });
  it("lê as respostas; sem confiança no alvo, vale para a conta toda", () => {
    const meta = { id: "abc", criada_em: "2026-09-27T12:00:00Z", criada_por: "u-1" };
    const r = regraDasRespostas("segura a verba do raio até sexta", alvos, "2026-09-27", { tipo: { choice: "segurar_verba", confidence: 0.9 }, alvo: { choice: "a1", confidence: 0.8 }, prazo: { choice: "sexta", confidence: 0.9 } }, meta);
    expect(r).toMatchObject({ tipo: "segurar_verba", alvos: alvos, ate: "2026-10-02", ativa: true });
    expect(regraDasRespostas("x", alvos, "2026-09-27", { tipo: { choice: "nao_mexer", confidence: 0.9 }, alvo: { choice: "a1", confidence: 0.1 } }, meta).alvos).toEqual([]);
  });
});

// ------------------------------------------------------------------ Meta falsa

function grafoFalso(estado: Record<string, Record<string, unknown>>, falhar: (caminho: string) => boolean = () => false) {
  const escritas: { caminho: string; params: Record<string, string> }[] = [];
  let seq = 0;
  const g: GrafoMeta = {
    async ler(caminho) {
      const id = caminho.split("?")[0];
      if (id.indexOf("/insights") > 0) return estado[id] ?? null;
      return estado[id] ? { id, ...estado[id] } : null;
    },
    async escrever(caminho, params) {
      if (falhar(caminho)) throw new Error("A Meta recusou: teste");
      escritas.push({ caminho, params });
      if (estado[caminho]) Object.assign(estado[caminho], params.status ? { status: params.status } : {}, params.daily_budget ? { daily_budget: params.daily_budget } : {});
      seq++;
      if (caminho.endsWith("/campaigns")) {
        const id = "120000000000900";
        estado[id] = { status: params.status, effective_status: params.status, daily_budget: params.daily_budget, name: params.name, account_id: "act_555" };
        return { id };
      }
      if (caminho.endsWith("/copies")) {
        estado["130000000000900"] = { status: "PAUSED", account_id: "act_555" };
        return { copied_adset_id: "130000000000900" };
      }
      if (caminho.endsWith("/adimages")) return { images: { bytes: { hash: `h${seq}` } } };
      if (caminho.endsWith("/adcreatives")) return { id: `15000000000090${seq}` };
      if (caminho.endsWith("/ads")) {
        const id = `16000000000090${seq}`;
        estado[id] = { status: "PAUSED", account_id: "act_555" };
        return { id };
      }
      return { success: true };
    },
  };
  return { g, escritas };
}

const estadoDaConta = () => ({
  "140000000000001": {
    status: "ACTIVE", effective_status: "ACTIVE", name: "Chama no WhatsApp", account_id: "act_555", adset_id: "130000000000001", campaign_id: "120000000000001",
    creative: { id: "1", object_story_spec: { page_id: "777", instagram_user_id: "888", link_data: { link: "https://wa.me/55", message: "antigo", picture: "https://velha", call_to_action: { type: "WHATSAPP_MESSAGE" } } } },
  },
  "120000000000001": { status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", special_ad_categories: [], bid_strategy: "LOWEST_COST_WITHOUT_CAP", account_id: "act_555" },
  "130000000000001": { status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "5000", name: "Raio 5 km", account_id: "act_555" },
} as Record<string, Record<string, unknown>>);

describe("montar a campanha do plano (tudo pausado)", () => {
  const plano = { id: "33333333-3333-3333-3333-333333333333", nome: "Teste da espera" };
  const apoio = (nome: string) => ({ nome, copy: { texto_principal: `Texto ${nome}` }, imagemBase64: async () => "QUJD" });
  const montagemPronta = () => {
    const i = itemDeMontagem(plano, "Plano mandado ao agente", "i1");
    return { ...i, montagem: completarMontagem(i.montagem!, { criativos: [{ id: "c1", nome: "Espera V1", tem_arte: true }, { id: "c2", nome: "Rascunho", tem_arte: false }], modelo: { ad_id: "140000000000001", nome: "Chama no WhatsApp" }, verba_diaria_brl: 40, objetivo: "mensagens", hoje: "2026-09-27" }) };
  };

  it("só com plano aberto; o que falta vira motivo (sem arte, sem modelo, sem verba, acima do teto)", () => {
    const alvos = alvosComApelido({ campanhas: [], conjuntos: [], anuncios: [] });
    expect(normalizarAcoesDaConta([{ tipo: "montar_campanha_do_plano", motivo: "x" }], alvos, criativosComApelido([]))).toBeNull();
    const a = normalizarAcoesDaConta([{ tipo: "montar_campanha_do_plano", motivo: "x" }, { tipo: "montar_campanha_do_plano", motivo: "y" }], alvos, criativosComApelido([]), null, plano)!;
    expect(a.itens).toHaveLength(1);
    expect(a.ignorados[0]).toMatch(/montagem repetida/);
    const m = montagemPronta().montagem!;
    expect(m).toMatchObject({ campanha_nome: "Teste da espera | Mesa Ads | 27/09", verba_diaria_brl: 40, criativos: [{ id: "c1", nome: "Espera V1" }], faltas: [] });
    const falta = completarMontagem(itemDeMontagem(plano, "", "i1").montagem!, { criativos: [], modelo: null, verba_diaria_brl: 200, objetivo: null, hoje: "2026-09-27", teto_diario_brl: 100 });
    expect(falta.faltas).toHaveLength(3);
    expect(falta.faltas.join(" ")).toMatch(/passa do teto diário da rotina/);
  });

  it("cria campanha, cópia do conjunto e anúncios, tudo PAUSED, com a verba no orçamento da campanha", async () => {
    const estado = estadoDaConta();
    const { g, escritas } = grafoFalso(estado);
    const r = await montarCampanhaNaMeta(montagemPronta(), g, [apoio("Espera V1")], new Set(["555"]));
    expect(r.ok).toBe(true);
    expect(r.criado).toEqual({ campanha_id: "120000000000900", conjunto_id: "130000000000900", anuncio_ids: expect.stringMatching(/^16/) });
    const campanha = escritas.find((e) => e.caminho === "act_555/campaigns")!;
    expect(campanha.params).toMatchObject({ objective: "OUTCOME_ENGAGEMENT", status: "PAUSED", daily_budget: "4000", special_ad_categories: "[]" });
    expect(escritas.find((e) => e.caminho === "130000000000001/copies")!.params).toMatchObject({ campaign_id: "120000000000900", status_option: "PAUSED", deep_copy: "false" });
    expect(escritas.find((e) => e.caminho === "act_555/ads")!.params.status).toBe("PAUSED");
    expect(escritas.every((e) => e.params.status !== "ACTIVE")).toBe(true);
    expect(r.depois).toMatchObject({ status: "PAUSED" });
    expect(temReverso({ ...montagemPronta(), resultado: r })).toBe(true);
  });

  it("parou no meio: arquiva o que criou (deletar = arquivar) e diz o motivo", async () => {
    const estado = estadoDaConta();
    const { g, escritas } = grafoFalso(estado, (c) => c.endsWith("/copies"));
    const r = await montarCampanhaNaMeta(montagemPronta(), g, [apoio("Espera V1")], new Set(["555"]));
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/campanha criada foi arquivada/);
    expect(escritas[escritas.length - 1]).toEqual({ caminho: "120000000000900", params: { status: "ARCHIVED" } });
  });

  it("modelo de outra conta não monta; ativar só o que ainda está pausado; desfazer arquiva", async () => {
    const estado = estadoDaConta();
    const f1 = grafoFalso(estado);
    expect((await montarCampanhaNaMeta(montagemPronta(), f1.g, [apoio("V1")], new Set(["999"]))).motivo).toMatch(/não é de uma conta de anúncios ligada/);
    const f2 = grafoFalso(estadoDaConta());
    const r = await montarCampanhaNaMeta(montagemPronta(), f2.g, [apoio("V1"), apoio("V2")], new Set(["555"]));
    const feito = { ...montagemPronta(), resultado: r };
    const ativa = await ativarMontagem(feito, f2.g, new Set(["555"]));
    expect(ativa.ok).toBe(true);
    const ativadas = f2.escritas.filter((e) => e.params.status === "ACTIVE").map((e) => e.caminho);
    expect(ativadas[ativadas.length - 1]).toBe("120000000000900");
    expect(ativadas).toContain("130000000000900");
    expect((await ativarMontagem({ ...feito, resultado: { ...r, ativada_em: "x" } }, f2.g)).motivo).toMatch(/já foi ativada/);
    expect(await desfazerNaMeta(feito, f2.g, new Set(["555"]))).toEqual({ ok: true });
    expect(f2.escritas[f2.escritas.length - 1]).toEqual({ caminho: "120000000000900", params: { status: "ARCHIVED" } });
    expect(await arquivarMontagem(feito, f2.g)).toEqual({ ok: true });
  });
});

describe("\"ele já vai fazendo\": o que é seguro", () => {
  it("pausar, baixar verba, renomear e ligar criativo; nunca ativar, subir verba, criar ou montar", () => {
    const i = (tipo: string, extra: Record<string, unknown> = {}) => ({ tipo, variacao_pct: null, para: null, de: null, ...extra }) as never;
    expect(acaoSemRisco(i("pausar"))).toBe(true);
    expect(acaoSemRisco(i("renomear"))).toBe(true);
    expect(acaoSemRisco(i("vincular_criativo"))).toBe(true);
    expect(acaoSemRisco(i("orcamento", { variacao_pct: -20 }))).toBe(true);
    expect(acaoSemRisco(i("orcamento", { de: { orcamento_diario_brl: 50 }, para: { orcamento_diario_brl: 60 }, variacao_pct: -5 }))).toBe(false);
    for (const t of ["ativar", "duplicar_anuncio", "trocar_criativo", "plano_de_teste", "tarefa_equipe", "montar_campanha_do_plano"]) expect(acaoSemRisco(i(t))).toBe(false);
  });
});

// ------------------------------------------------------------------ a rodada inteira (dependências falsas)

function depsFalsas(opcoes: { linha?: Partial<LinhaDaRotina>; itens?: ItemDaConta[]; jev?: DepsDaRodada["jev"]; acesso?: { disponivel: boolean; motivo: string | null }; pausarNoMeio?: boolean; sincronizado?: string } = {}) {
  const estado = estadoDaConta();
  estado["140000000000001/insights"] = { data: [] };
  const { g, escritas } = grafoFalso(estado);
  const registros: RegistroDaRotina[] = [];
  const avisos: string[] = [];
  const dossie: string[] = [];
  const salvos: unknown[] = [];
  let leituras = 0;
  const linha: LinhaDaRotina = { client_id: "c", ligada: true, teto_diario_brl: 100, subida_max_pct: 20, max_acoes_rodada: 3, max_acoes_dia: 6, limites: { custo_alvo_brl: 12 }, regras: [], estado: {}, ultima_rodada_em: null, ligada_por: "u-1", ...opcoes.linha };
  const itens = opcoes.itens ?? [
    anuncio({ gasto: 40, impressoes: 5000 }),
    anuncio({ meta_id: "140000000000002", nome: "Vídeo", gasto: 30, impressoes: 6000, resultados: 5, custo_por_resultado: 6 }),
    anuncio({ meta_id: "140000000000003", nome: "Carrossel", gasto: 20, impressoes: 3000, resultados: 2, custo_por_resultado: 10 }),
  ];
  const deps: DepsDaRodada = {
    agoraMs: () => AGORA,
    hoje: "2026-09-27",
    novoId: () => "rodada-1",
    nomeDoCliente: "Clínica X",
    lerRotina: async () => {
      leituras++;
      if (opcoes.pausarNoMeio && leituras > 1) return { ...linha, ligada: false };
      return linha;
    },
    lerRetrato: async () => ({ retrato: retrato(itens, opcoes.sincronizado ? { sincronizado_em: opcoes.sincronizado } : {}), nicho: { id: "estetica", nome: "Estética" }, objetivo: "mensagens", estrategia: null, custoDoPlano: null, custoDoBriefing: null, referencia: null, tiposDeAcao: () => ["onsite_conversion.messaging_conversation_started_7d"] }),
    acesso: async () => ({ grafo: g, disponivel: true, motivo: null, ...opcoes.acesso }),
    contas: async () => new Set(["555"]),
    recentes: async () => [],
    propostasAbertas: async () => new Set(),
    jev: opcoes.jev ?? (async () => ({ answers: { caso_0: { choice: "pausar", confidence: 0.85, probabilities: { pausar: 0.85, observar: 0.1 } }, fora_do_normal: { noul: 0.05 } } })),
    registrar: async (r) => {
      registros.push(r);
      return "id";
    },
    avisar: async (m) => {
      avisos.push(m);
    },
    dossie: async (t) => {
      dossie.push(t);
    },
    salvarEstado: async (e) => {
      salvos.push(e);
    },
    auditar: async () => undefined,
  };
  return { deps, escritas, registros, avisos, dossie, salvos, estado };
}

describe("a rodada da rotina", () => {
  it("pausa o que queima com prova completa, relê depois, registra, avisa uma vez e manda ao dossiê", async () => {
    const f = depsFalsas();
    const r = await rodarRotina(f.deps);
    expect(r).toMatchObject({ rodou: true, feitas: 1 });
    expect(f.escritas).toEqual([{ caminho: "140000000000001", params: { status: "PAUSED" } }]);
    const feito = f.registros.find((x) => x.estado === "feita")!;
    expect(feito.resumo).toBe("Pausei o anúncio Chama no WhatsApp.");
    const prova = feito.prova as Record<string, any>;
    expect(prova.numeros.periodo).toEqual({ inicio: "2026-09-21", fim: "2026-09-27", dias: 7 });
    expect(prova.antes.status).toBe("ACTIVE");
    expect(prova.depois.status).toBe("PAUSED");
    expect(prova.jev).toMatchObject({ escolha: "pausar", probabilidade: 0.85 });
    expect(prova.sincronizado_em).toBe("2026-09-27T14:40:00.000Z");
    expect(JSON.stringify(prova)).not.toMatch(/access_token/);
    expect(f.avisos).toHaveLength(1);
    expect(f.avisos[0]).toMatch(/Clínica X: Pausei o anúncio Chama no WhatsApp/);
    expect(f.dossie).toHaveLength(1);
    expect(r.estado!.fez).toEqual(["Pausei o anúncio Chama no WhatsApp."]);
    expect(r.estado!.olhando).toMatch(/3 anúncios ativos em 1 campanha/);
  });

  it("pausada pelo dono durante a rodada: para antes da próxima ação", async () => {
    const f = depsFalsas({ pausarNoMeio: true });
    const r = await rodarRotina(f.deps);
    expect(f.escritas).toEqual([]);
    expect(r.estado!.parou_por).toMatch(/pausou a rotina durante a rodada/);
  });

  it("conta travada na Meta: um aviso só (não repete em 24 h) e não age", async () => {
    const f = depsFalsas({ acesso: { disponivel: false, motivo: "A conta de anúncios Aceleriq está com pagamento pendente na Meta (saldo em aberto)." } });
    const r = await rodarRotina(f.deps);
    expect(f.escritas).toEqual([]);
    expect(f.avisos).toHaveLength(1);
    expect(r.estado!.bloqueio).toMatch(/pagamento pendente/);
    expect(r.estado!.planeja[0]).toMatch(/Quando a conta voltar: pausar Chama no WhatsApp/);
    const f2 = depsFalsas({ acesso: { disponivel: false, motivo: "A conta de anúncios Aceleriq está com pagamento pendente na Meta (saldo em aberto)." }, linha: { estado: r.estado } });
    await rodarRotina(f2.deps);
    expect(f2.avisos).toHaveLength(0);
  });

  it("sem o Jev, não age; Jev achou fora do normal, para e avisa", async () => {
    const semJev = depsFalsas({ jev: async () => { throw new Error("jev_timeout"); } });
    const r = await rodarRotina(semJev.deps);
    expect(semJev.escritas).toEqual([]);
    expect(r.motivo).toBe("jev_indisponivel");
    const estranho = depsFalsas({ jev: async () => ({ answers: { caso_0: { choice: "pausar", confidence: 0.9, probabilities: { pausar: 0.9 } }, fora_do_normal: { noul: 0.8 } } }) });
    const r2 = await rodarRotina(estranho.deps);
    expect(estranho.escritas).toEqual([]);
    expect(r2.estado!.parou_por).toMatch(/fora do normal \(80%\)/);
    expect(estranho.avisos).toHaveLength(1);
  });

  it("desligada não roda; regra do dono barra; coleta velha relê na Meta e não age se a regra não vale mais", async () => {
    expect((await rodarRotina(depsFalsas({ linha: { ligada: false } }).deps)).rodou).toBe(false);
    const regra = depsFalsas({ linha: { regras: [{ id: "r1", texto: "não mexe em nada hoje", tipo: "nao_mexer", alvos: [], ate: "2026-09-27", ativa: true }] } });
    await rodarRotina(regra.deps);
    expect(regra.escritas).toEqual([]);
    const velha = depsFalsas({ sincronizado: "2026-09-27T13:30:00.000Z" });
    velha.estado["140000000000001/insights"] = { data: [{ spend: "40", impressions: "5000", inline_link_clicks: "50", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "4" }] }] };
    const r = await rodarRotina(velha.deps);
    expect(velha.escritas).toEqual([]);
    expect(r.estado!.planeja.join(" ")).toMatch(/com os números relidos agora na Meta, a regra não pede mais isso/);
  });
});

describe("retrato da campanha para o agente e a conta ao vivo", () => {
  it("cada nível com números, fase, sinal da regra, custo-alvo com fonte e o que já foi feito", () => {
    const conta = {
      atualizado_em: "2026-09-27T14:40:00.000Z",
      periodo: { inicio: "2026-08-29", fim: "2026-09-27", dias: 30 },
      totais: { gasto: 300, resultados: 20, custo_por_resultado: 15, resultado_tipo: "mensagens", resultado_rotulo: "Conversas iniciadas" },
      serie: [{ dia: "2026-09-27", gasto: 10, resultados: 1 }],
      campanhas: [{ campaign_id: "120000000000001", nome: "Mensagens", status: "ACTIVE", orcamento_diario: 40, metricas: { gasto: 300, impressoes: 20000, resultados: 20, custo_por_resultado: 15, ctr_saida_pct: 1, cpm: 15, frequencia_media: 1.8, dias: 30, inicio: "2026-08-29" } }],
      conjuntos: [{ adset_id: "130000000000001", nome: "Raio 5 km", campaign_id: "120000000000001", campanha: "Mensagens", metricas: { gasto: 300, impressoes: 20000, resultados: 20, custo_por_resultado: 15, ctr_saida_pct: 1, cpm: 15, frequencia_media: 1.8, dias: 30, inicio: "2026-08-29" } }],
      anuncios: [{ ad_id: "140000000000001", nome: "Chama", status: "ACTIVE", campaign_id: "120000000000001", campanha: "Mensagens", conjunto: "Raio 5 km", conjunto_id: "130000000000001", metricas: { gasto: 60, impressoes: 5000, resultados: 0, custo_por_resultado: null, ctr_saida_pct: 0.8, cpm: 12, frequencia_media: 1.4, dias: 6, inicio: "2026-09-21" }, tendencia: { ctr_var_pct: null, custo_resultado_var_pct: null, frequencia: 1.4 } }],
    };
    const r = retratoDaContaAoVivo(conta);
    expect(r.itens.map((i) => `${i.nivel}:${i.status}`)).toEqual(["campanha:ACTIVE", "conjunto:ACTIVE", "anuncio:ACTIVE"]);
    expect(r.orcamento_ativo_brl).toBe(40);
    const { limites, fontes } = limitesEfetivos({ custoMedioDaConta: 15, resultadosDaConta: 20 });
    const p = retratoParaOAgente(r, r.itens.map((i) => avaliarItem(i, limites)), limites, fontes, [{ quando: "2026-09-26", resumo: "Pausei o anúncio X.", porque: "R$ 40 sem conversa" }], referenciaDoNicho("estetica", "mensagens"));
    expect(p.custo_alvo).toEqual({ valor: 15, fonte: "conta" });
    expect(p.anuncios[0]).toMatchObject({ sinal_da_regra: "queimando", fase: "estável" });
    expect(p.ja_foi_feito).toHaveLength(1);
    expect(p.referencia_do_nicho!.fonte).toMatch(/fonte fraca/);
  });
});

describe("conhecimento e pedido do agente", () => {
  it("base de tráfego com fonte, sem travessão, e o pedido pede o retrato e respeita as regras do dono", () => {
    expect(CONHECIMENTO_TRAFEGO).toMatch(/50 eventos de otimização em 7 dias/);
    expect(CONHECIMENTO_TRAFEGO).toMatch(/Andromeda/);
    expect(CONHECIMENTO_TRAFEGO).not.toMatch(TRAVESSAO);
    const fonte = ler("supabase/functions/_shared/conhecimento-trafego.ts");
    expect(fonte).toMatch(/https:\/\/www\.facebook\.com\/business\/help\/112167992830700/);
    expect(fonte).not.toMatch(TRAVESSAO);
    expect(referenciaDoNicho("nicho_inexistente", "mensagens")).toBeNull();
    const t = tarefaDoAgenteSenior({ pesquisaWeb: false, bibliotecaConsultada: false, temPlano: true, modoAgir: true, assumirPlano: true });
    expect(t).toContain("RETRATO_DA_CAMPANHA");
    expect(t).toContain("REGRAS_DO_DONO");
    expect(t).toContain("ASSUMIR O PLANO");
    expect(t).toContain("montar_campanha_do_plano");
    for (const arq of ["supabase/functions/mesa-ads/rotina-trafego.ts", "supabase/functions/mesa-ads/rotina-rodada.ts"]) expect(ler(arq)).not.toMatch(TRAVESSAO);
  });
});

describe("fonte do servidor (frente TR)", () => {
  const fonte = ler("supabase/functions/mesa-ads/index.ts");
  it("rotas novas, ações longas com fôlego e o cron só pela x-cron-secret", () => {
    for (const a of ["conta_montagem_ativar: contaMontagemAtivar", "rotina_ler: rotinaLer", "rotina_salvar: rotinaSalvar", "rotina_regra: rotinaRegra", "rotina_rodar: rotinaRodar", "rotina_desfazer: rotinaDesfazer", "rotina_proposta_descartar: rotinaPropostaDescartar"]) expect(fonte).toContain(a);
    const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("]);", fonte.indexOf("const ACOES_LONGAS")));
    for (const a of ["rotina_rodar", "rotina_regra", "conta_montagem_ativar", "rotina_desfazer"]) expect(longas).toContain(`"${a}"`);
    const serve = fonte.slice(fonte.indexOf("Deno.serve("));
    expect(serve.indexOf('req.headers.get("x-cron-secret")')).toBeLessThan(serve.indexOf("identificar(req, servico, inicioMs)"));
    expect(serve).toContain('!== "rotina_cron"');
    // rotina_cron não fica na tabela de ações (não abre para a equipe pelo navegador).
    expect(fonte.slice(fonte.indexOf("const ACOES: Record"), fonte.indexOf("const ACOES_LONGAS"))).not.toContain("rotina_cron");
  });

  it("agente: modelo padrão Luna no máximo, o seguro feito sozinho e o que foi feito no dossiê", () => {
    expect(fonte).toContain('const MODELO_DO_TRAFEGO = "openrouter:openai/gpt-6-luna";');
    expect(fonte).toContain('const RACIOCINIO_DO_TRAFEGO = "max";');
    const conversar = fonte.slice(fonte.indexOf("async function contaConversar("), fonte.indexOf("\nasync function contaConversaLer("));
    expect(conversar).toContain("modeloDoTrafego(corpo)");
    expect(conversar).toContain("fazerOQueESeguro(");
    expect(conversar).toContain("RETRATO_DA_CAMPANHA");
    const dossie = fonte.slice(fonte.indexOf("async function mandarAoDossie("), fonte.indexOf("/** Aviso para quem cuida do cliente"));
    expect(dossie).toContain('kind: "acao"');
    expect(dossie).toContain('rpc("dossie_enfileirar"');
    expect(dossie).not.toMatch(/dossie_registrar_avancos|client_dossiers/);
    expect(fonte).toContain('rpc("avisar_equipe_do_cliente"');
    expect(PADROES_DA_ROTINA.subida_teto_pct).toBe(30);
  });
});
