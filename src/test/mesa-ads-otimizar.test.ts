import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AnuncioDaConta,
  candidatosDoAcervo,
  COPY_BOA,
  type CriativoDoAcervo,
  decidirOtimizacao,
  julgarAnuncio,
  julgarConta,
  MAX_TROCAS,
  NIVEIS_COPY,
  NIVEIS_SAUDE,
  pareceOtimizar,
  perguntasDoOtimizar,
  reguaDaConta,
  textoDoOtimizar,
} from "../../supabase/functions/mesa-ads/otimizar-conta";
import { LIMITES_PADRAO, limitesEfetivos } from "../../supabase/functions/mesa-ads/rotina-trafego";
import { desfazerNaMeta, estadoLido, executarNaMeta, fotografar, type GrafoMeta, type ItemDaAcaoNaConta, temReverso } from "../../supabase/functions/mesa-ads/acoes-conta";

/**
 * "Otimizar" da conta (frente AD4, pedido do dono em 28/09): a régua em
 * código decide bom, atenção, ruim ou cedo com os números; o Jev confirma a
 * saúde, escolhe o substituto no acervo e julga a copy; a troca na Meta é um
 * anúncio novo no mesmo conjunto e o antigo pausado, só no Confirmar, com
 * Desfazer. Nada aqui fala com a Meta de verdade: o grafo é falso.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const anuncio = (id: string, m: Partial<AnuncioDaConta["metricas"]> = {}, extra: Partial<AnuncioDaConta> = {}): AnuncioDaConta => ({
  ad_id: id,
  nome: `Anúncio ${id.slice(-2)}`,
  status: "ACTIVE",
  campanha: "Mensagens",
  conjunto: "Raio 5 km",
  conjunto_id: "130000000000001",
  formato: "imagem",
  metricas: {
    gasto: 60,
    impressoes: 6000,
    resultados: 6,
    custo_por_resultado: 10,
    ctr_saida_pct: 1.2,
    cpc: 1.5,
    cpm: 10,
    frequencia_media: 1.6,
    dias: 7,
    resultado_rotulo: "Conversas",
    ...m,
  },
  tendencia: { ctr_var_pct: 0, custo_resultado_var_pct: 0, frequencia: m.frequencia_media ?? 1.6 },
  titulo: "Árvore perto do telhado?",
  corpo: "Mande uma foto no Direct e receba a avaliação.",
  criativo: null,
  ...extra,
});

const { limites, fontes } = limitesEfetivos({ custoDoBriefing: 12, referencia: { custo_tipico_brl: 15, ctr_minimo_pct: 0.5, frequencia_maxima: 3.5, fonte: "nicho" } });

const acervo: CriativoDoAcervo[] = [
  { id: "c-1", nome: "Terreno limpo | V1 | quadrado_1x1", formato: "quadrado_1x1", status: "pronto", ad_id: null, tem_arte: true, angulo: { nome: "Terreno limpo", hipotese: "Mostrar o antes e depois", promessa: "Terreno para limpar?" }, plano: "Plano", copy: { texto_principal: "Antes e depois em 1 dia.", titulo: "Terreno limpo", descricao: null }, nota_copy: 8, melhor: true },
  { id: "c-2", nome: "Poda segura | V1 | feed_4x5", formato: "feed_4x5", status: "pronto", ad_id: null, tem_arte: true, angulo: { nome: "Poda segura", hipotese: null, promessa: null }, plano: "Plano", copy: { texto_principal: "Poda com segurança.", titulo: null, descricao: null }, nota_copy: 6, melhor: false },
  { id: "c-3", nome: "Rascunho", formato: "feed_4x5", status: "rascunho", ad_id: null, tem_arte: true, angulo: null, plano: null, copy: { texto_principal: null, titulo: null, descricao: null }, nota_copy: null, melhor: false },
  { id: "c-4", nome: "Carrossel", formato: "carrossel", status: "pronto", ad_id: null, tem_arte: true, angulo: null, plano: null, copy: { texto_principal: null, titulo: null, descricao: null }, nota_copy: null, melhor: false },
  { id: "c-5", nome: "Sem arte", formato: "feed_4x5", status: "pronto", ad_id: null, tem_arte: false, angulo: null, plano: null, copy: { texto_principal: null, titulo: null, descricao: null }, nota_copy: null, melhor: false },
  { id: "c-6", nome: "No ar", formato: "feed_4x5", status: "no_ar", ad_id: "140000000000009", tem_arte: true, angulo: null, plano: null, copy: { texto_principal: null, titulo: null, descricao: null }, nota_copy: null, melhor: false },
];

describe("régua em código", () => {
  const conta = [
    anuncio("140000000000001", { ctr_saida_pct: 0.3, cpc: 4.2, resultados: 3, custo_por_resultado: 45, gasto: 135 }),
    anuncio("140000000000002", { ctr_saida_pct: 1.4 }),
    anuncio("140000000000003", { ctr_saida_pct: 1.1, resultados: 0, custo_por_resultado: null, gasto: 40 }),
    anuncio("140000000000004", { impressoes: 420, gasto: 6, resultados: 0, custo_por_resultado: null, dias: 2 }),
    anuncio("140000000000005", { ctr_saida_pct: 1.3, frequencia_media: 4.1 }, { tendencia: { ctr_var_pct: -32, custo_resultado_var_pct: 10, frequencia: 4.1 } }),
    anuncio("140000000000006", { ctr_saida_pct: 1.2, resultados: 4, custo_por_resultado: 18 }),
  ];
  const regua = reguaDaConta(conta, limites, fontes);

  it("usa a régua da rotina (dono, plano, briefing, conta, nicho) e as medianas da conta com janela", () => {
    expect(regua.custo_alvo_brl).toBe(12);
    expect(regua.fonte_do_alvo).toBe("briefing");
    expect(regua.ctr_minimo_pct).toBe(0.5);
    expect(regua.ctr_mediana_pct).toBe(1.2);
    expect(regua.impressoes_minimas).toBe(LIMITES_PADRAO.impressoes_minimas);
    expect(regua.limiar_sem_resultado_brl).toBe(24);
  });

  it("cedo sem a janela mínima; ruim com CTR baixo, gasto sem resultado ou fadiga; atenção entre o alvo e o corte; bom sem nada", () => {
    const [ctr, bom, semResultado, cedo, fadiga, atencao] = conta.map((a) => julgarAnuncio(a, regua));
    expect(ctr).toMatchObject({ veredito: "ruim", onde: "os_dois" });
    expect(ctr.problemas).toEqual(["ctr_baixo", "custo_alto"]);
    expect(ctr.motivos[0]).toBe("CTR de link 0,3% em 6.000 impressões, abaixo do mínimo de 0,5%.");
    expect(ctr.motivos[1]).toMatch(/3 conversas a R\$ 45,00 cada/);
    expect(bom).toMatchObject({ veredito: "bom", problemas: [] });
    expect(bom.motivos[0]).toBe("6 conversas a R$ 10,00 (alvo R$ 12,00), CTR 1,4%.");
    expect(semResultado).toMatchObject({ veredito: "ruim", problemas: ["sem_resultado"], onde: "copy" });
    expect(semResultado.motivos[0]).toBe("R$ 40,00 gastos em 7 dias sem conversas (o limite é R$ 24,00).");
    expect(cedo.veredito).toBe("cedo");
    expect(cedo.motivos[0]).toBe("Pouco dado para julgar: 420 de 1.000 impressões, R$ 6,00 de R$ 15,00 gastos, 2 de 3 dias com entrega.");
    expect(fadiga).toMatchObject({ veredito: "ruim", problemas: ["fadiga"], onde: "criativo" });
    expect(atencao.veredito).toBe("atencao");
    expect(atencao.motivos[0]).toMatch(/R\$ 18,00 por conversa, acima do alvo de R\$ 12,00 mas abaixo do corte de R\$ 24,00/);
  });

  it("anúncio parado fica de fora e os de maior gasto vêm primeiro", () => {
    const j = julgarConta([anuncio("140000000000010", { gasto: 10 }), anuncio("140000000000011", { gasto: 90 }), anuncio("140000000000012", {}, { status: "PAUSED" })], regua);
    expect(j.map((x) => x.anuncio.ad_id)).toEqual(["140000000000011", "140000000000010"]);
  });

  it("candidatos: arte pronta, enviados para a conta, imagem única e fora do ar; o melhor do ângulo primeiro", () => {
    expect(candidatosDoAcervo(acervo, new Set(["140000000000009"])).map((c) => c.id)).toEqual(["c-1", "c-2"]);
  });
});

describe("Jev: perguntas e decisão", () => {
  const conta = [
    anuncio("140000000000001", { ctr_saida_pct: 0.3, resultados: 0, custo_por_resultado: null, gasto: 80 }),
    anuncio("140000000000002", { ctr_saida_pct: 1.4 }),
    anuncio("140000000000003", { impressoes: 300, gasto: 3, dias: 1 }),
    anuncio("140000000000004", { ctr_saida_pct: 0.2, gasto: 50 }, { formato: "video" }),
  ];
  const regua = reguaDaConta(conta, limites, fontes);
  const julgados = julgarConta(conta, regua);
  const candidatos = candidatosDoAcervo(acervo, new Set());
  const ctx = { nicho: "Jardinagem", objetivo: "mensagens", resultado_principal: "Conversas" };

  it("uma chamada: saúde (Score) de cada julgado; substituto (Choice com nenhum) e copy (Score) só dos ruins de imagem", () => {
    const p = perguntasDoOtimizar(julgados, candidatos, regua, ctx);
    expect(p.julgados.map((j) => j.anuncio.ad_id)).toEqual(["140000000000001", "140000000000002", "140000000000004"]);
    expect(Object.keys(p.questions).sort()).toEqual(["copy_0", "saude_0", "saude_1", "saude_2", "substituto_0"]);
    expect(p.questions.saude_0).toMatchObject({ type: "score", criteria: NIVEIS_SAUDE });
    expect(p.questions.copy_0).toMatchObject({ type: "score", criteria: NIVEIS_COPY });
    const escolha = p.questions.substituto_0 as { type: string; criteria: Record<string, unknown> };
    expect(escolha.type).toBe("choice");
    expect(Object.keys(escolha.criteria)).toEqual(["a1", "a2", "nenhum"]);
    expect((p.state as { acervo: { ref: string }[] }).acervo.map((a) => a.ref)).toEqual(["a1", "a2"]);
    expect(JSON.stringify(p.state)).not.toMatch(/140000000000001/);
  });

  it("troca só quando régua e Jev concordam; bom não mexe; cedo e vídeo não trocam", () => {
    const answers = {
      saude_0: { score: 0.6 },
      saude_1: { score: 3.2 },
      saude_2: { score: 0.4 },
      substituto_0: { choice: "a2", probabilities: { a2: 0.71, a1: 0.2, nenhum: 0.09 } },
      copy_0: { score: 1.2 },
    };
    const d = decidirOtimizacao(julgados, candidatos, answers);
    expect(d.trocas).toHaveLength(1);
    expect(d.trocas[0]).toMatchObject({ candidato: { id: "c-2" }, prob: 0.71, saude: 0.6, copy: "candidato" });
    expect(d.trocas[0].motivo).toMatch(/CTR de link 0,3%.*Jev: saúde 0,6 de 4\. Entra "Poda segura \| V1 \| feed_4x5" \(ângulo Poda segura\), 71% de preferência do Jev\. Copy do candidato \(a atual teve nota 1,2 de 4\)\./);
    expect(d.avaliados.map((a) => [a.ad_id.slice(-2), a.acao])).toEqual([["01", "trocar"], ["02", "nao_mexer"], ["04", "video"], ["03", "cedo"]]);
    const texto = textoDoOtimizar(d, { inicio: "2026-09-21", fim: "2026-09-27" }, regua);
    expect(texto).toMatch(/^Olhei 4 anúncios ativos \(7 dias, 21\/09 a 27\/09\)/);
    expect(texto).toMatch(/Trocar \(1, confirme no cartão\)/);
    expect(texto).toMatch(/Bons, não mexi \(1\)/);
    expect(texto).toMatch(/pausa o antigo \(criativo não se edita na Meta\)\. Não mexo em verba, não ativo campanha nem conjunto\./);
    expect(TRAVESSAO.test(texto)).toBe(false);
  });

  it("régua ruim e Jev saudável vira atenção (não troca); sem Jev não troca; nenhum e probabilidade baixa não trocam", () => {
    const base = { saude_1: { score: 3 }, saude_2: { score: 3 }, copy_0: { score: 2 } };
    expect(decidirOtimizacao(julgados, candidatos, { ...base, saude_0: { score: 2.4 }, substituto_0: { choice: "a1", probabilities: { a1: 0.9 } } }).avaliados[0]).toMatchObject({ acao: "atencao", veredito: "atencao" });
    const semJev = decidirOtimizacao(julgados, candidatos, null);
    expect(semJev.trocas).toEqual([]);
    expect(semJev.avaliados[0]).toMatchObject({ acao: "sem_jev" });
    expect(textoDoOtimizar(semJev, null, regua)).toMatch(/O Jev não respondeu agora/);
    expect(decidirOtimizacao(julgados, candidatos, { ...base, saude_0: { score: 0.5 }, substituto_0: { choice: "nenhum", probabilities: { nenhum: 0.8, a1: 0.2 } } }).avaliados[0].decisao).toMatch(/não achou no acervo/);
    expect(decidirOtimizacao(julgados, candidatos, { ...base, saude_0: { score: 0.5 }, substituto_0: { choice: "a1", probabilities: { a1: 0.3, a2: 0.3, nenhum: 0.4 } } }).trocas).toEqual([]);
    expect(decidirOtimizacao(julgados, [], { ...base, saude_0: { score: 0.5 } }).avaliados[0].decisao).toMatch(/Envie no Estúdio Ads > Acervo/);
  });

  it("regra do dono barra; cada candidato entra uma vez; copy boa com problema só de arte fica", () => {
    const dois = [anuncio("140000000000001", { ctr_saida_pct: 0.3 }), anuncio("140000000000002", { ctr_saida_pct: 0.2 })];
    const r = reguaDaConta(dois, limites, fontes);
    const j = julgarConta(dois, r);
    const ans = {
      saude_0: { score: 0.5 }, saude_1: { score: 0.5 },
      substituto_0: { choice: "a1", probabilities: { a1: 0.8, a2: 0.15 } },
      substituto_1: { choice: "a1", probabilities: { a1: 0.6, a2: 0.4 } },
      copy_0: { score: COPY_BOA + 0.2 }, copy_1: { score: 1 },
    };
    const d = decidirOtimizacao(j, candidatos, ans);
    expect(d.trocas.map((t) => [t.anuncio.ad_id.slice(-2), t.candidato.id, t.copy])).toEqual([["01", "c-1", "atual"], ["02", "c-2", "candidato"]]);
    const barrado = decidirOtimizacao(j, candidatos, ans, (a) => (a.ad_id.endsWith("01") ? "não mexe no 01" : null));
    expect(barrado.avaliados.find((x) => x.ad_id.endsWith("01"))).toMatchObject({ acao: "barrado" });
    expect(MAX_TROCAS).toBe(5);
  });

  it("\"otimizar\" curto vai para o caminho rápido; ordem misturada vai para o agente completo", () => {
    expect(pareceOtimizar("Otimize")).toBe(true);
    expect(pareceOtimizar("otimizar a conta")).toBe(true);
    expect(pareceOtimizar("otimize os anúncios ativos")).toBe(true);
    expect(pareceOtimizar("otimize e pausa o conjunto X")).toBe(false);
    expect(pareceOtimizar("otimize e sobe a verba")).toBe(false);
    expect(pareceOtimizar("qual anúncio está pior?")).toBe(false);
  });
});

// ------------------------------------------------------------------ troca na Meta (grafo falso)

type Escrita = { caminho: string; params: Record<string, string> };
function grafoFalso(estado: Record<string, Record<string, unknown>>, falhar: (e: Escrita) => boolean = () => false) {
  const escritas: Escrita[] = [];
  let seq = 0;
  const g: GrafoMeta = {
    async ler(caminho) {
      const o = estado[caminho];
      return o ? { id: caminho, ...o } : null;
    },
    async escrever(caminho, params) {
      const e = { caminho, params: { ...params } };
      if (falhar(e)) throw new Error("A Meta recusou: teste");
      escritas.push(e);
      if (caminho.endsWith("/adimages")) return { images: { x: { hash: "abc123" } } };
      if (caminho.endsWith("/adcreatives")) return { id: "150000000000001" };
      if (caminho.endsWith("/ads")) {
        seq += 1;
        const id = `16000000000000${seq}`;
        estado[id] = { status: params.status, effective_status: params.status, name: params.name, account_id: "act_555", adset_id: params.adset_id };
        return { id };
      }
      if (estado[caminho] && params.status) {
        estado[caminho].status = params.status;
        estado[caminho].effective_status = params.status;
      }
      return { success: true };
    },
  };
  return { g, escritas };
}

const ANTIGO = "140000000000001";
function preparar(copy: "candidato" | "atual" = "candidato", status = "ACTIVE", efetivo = "ACTIVE") {
  const estado: Record<string, Record<string, unknown>> = {
    [ANTIGO]: {
      status, effective_status: efetivo, name: "Árvore | Quadrado", adset_id: "130000000000001", account_id: "act_555",
      creative: { id: "1", object_story_spec: { page_id: "777", instagram_user_id: "888", link_data: { link: "https://ig.me/m/verzelo", message: "antigo", picture: "https://velha", call_to_action: { type: "INSTAGRAM_MESSAGE" } } } },
    },
  };
  const bruto: ItemDaAcaoNaConta = {
    id: "i1", tipo: "trocar_anuncio", na_meta: true,
    alvo: { ref: "n1", nivel: "anuncio", meta_id: ANTIGO, nome: "Árvore | Quadrado" },
    criativo: { ref: "a1", id: "c-2", nome: "Poda segura" },
    texto: null, variacao_pct: null, motivo: "CTR baixo", de: null, para: { status: "PAUSED" }, limitado: false, indisponivel: null,
    troca: {
      numeros: { periodo: null, gasto: 40, impressoes: 6000, resultados: 0, resultado_rotulo: "Conversas", custo_por_resultado: null, ctr_link_pct: 0.3, cpc: 2, frequencia: 1.5 },
      regua: { ctr_minimo_pct: 0.5, ctr_mediana_pct: 1.2, custo_alvo_brl: 12, fonte_do_alvo: "custo tolerável do briefing" },
      problemas: ["ctr_baixo"], jev: { saude: 0.6, prob_candidato: 0.71, nota_copy_atual: 3.4 },
      candidato: { id: "c-2", nome: "Poda segura", angulo: "Poda segura", formato: "feed_4x5" }, copy, sincronizado_em: null,
    },
  };
  const item = fotografar(bruto, estadoLido({ id: ANTIGO, ...estado[ANTIGO] }));
  const apoio = { nome: "Poda segura", copy: { texto_principal: "Poda com segurança.", titulo: "Poda segura" }, imagemBase64: async () => "QUJD" };
  return { estado, item, apoio };
}

describe("trocar_anuncio na Meta (grafo falso)", () => {
  it("cria o anúncio novo ATIVO no mesmo conjunto, pausa o antigo e relê os dois (prova)", async () => {
    const { estado, item, apoio } = preparar();
    const { g, escritas } = grafoFalso(estado);
    const r = await executarNaMeta(item, g, apoio, new Set(["555"]));
    expect(r).toMatchObject({ ok: true, criado: { anuncio_id: "160000000000001", creative_id: "150000000000001", anuncio_antigo_id: ANTIGO } });
    const ad = escritas.find((e) => e.caminho === "act_555/ads")!;
    expect(ad.params).toMatchObject({ adset_id: "130000000000001", status: "ACTIVE" });
    expect(escritas.map((e) => e.caminho)).toEqual(["act_555/adimages", "act_555/adcreatives", "act_555/ads", ANTIGO]);
    expect(escritas[3].params).toEqual({ status: "PAUSED" });
    expect(r.depois).toMatchObject({ status: "PAUSED" });
    expect(r.depois_novo).toMatchObject({ status: "ACTIVE" });
    const spec = JSON.parse(escritas[1].params.object_story_spec);
    expect(spec.link_data).toMatchObject({ message: "Poda com segurança.", name: "Poda segura", image_hash: "abc123", link: "https://ig.me/m/verzelo" });
    // Nunca mexe em orçamento, nunca ativa campanha nem conjunto.
    expect(escritas.some((e) => "daily_budget" in e.params || e.caminho === "130000000000001")).toBe(false);
    expect(temReverso({ ...item, resultado: r })).toBe(true);

    // Desfazer: pausa o novo e volta o antigo, só se ninguém mexeu.
    const d = await desfazerNaMeta({ ...item, resultado: r }, g, new Set(["555"]));
    expect(d).toEqual({ ok: true });
    expect(estado["160000000000001"].status).toBe("PAUSED");
    expect(estado[ANTIGO].status).toBe("ACTIVE");
  });

  it("copy atual mantida: só a arte muda (a mensagem do anúncio fica)", async () => {
    const { estado, item, apoio } = preparar("atual");
    const { g, escritas } = grafoFalso(estado);
    expect((await executarNaMeta(item, g, apoio)).ok).toBe(true);
    const spec = JSON.parse(escritas.find((e) => e.caminho === "act_555/adcreatives")!.params.object_story_spec);
    expect(spec.link_data.message).toBe("antigo");
    expect(spec.link_data.image_hash).toBe("abc123");
  });

  it("anúncio que não está entregando (conjunto pausado) não troca e nada é escrito", async () => {
    const { estado, item, apoio } = preparar("candidato", "ACTIVE", "ADSET_PAUSED");
    const { g, escritas } = grafoFalso(estado);
    const r = await executarNaMeta(item, g, apoio);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/não está entregando agora.*não ativei nada parado/);
    expect(escritas).toEqual([]);
  });

  it("se o antigo não pausar, o novo volta a pausado (nunca os dois rodando)", async () => {
    const { estado, item, apoio } = preparar();
    const { g } = grafoFalso(estado, (e) => e.caminho === ANTIGO);
    const r = await executarNaMeta(item, g, apoio);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/o antigo não pausou.*Pausei o novo/);
    expect(estado["160000000000001"].status).toBe("PAUSED");
  });

  it("desfazer recusa quando alguém mexeu depois da troca", async () => {
    const { estado, item, apoio } = preparar();
    const { g } = grafoFalso(estado);
    const r = await executarNaMeta(item, g, apoio);
    estado["160000000000001"].status = "PAUSED";
    const d = await desfazerNaMeta({ ...item, resultado: r }, g);
    expect(d.ok).toBe(false);
    expect(d.motivo).toMatch(/Mudou na Meta depois da troca/);
    expect(estado[ANTIGO].status).toBe("PAUSED");
  });
});

describe("fio no servidor", () => {
  const index = ler("supabase/functions/mesa-ads/index.ts");
  const modulo = ler("supabase/functions/mesa-ads/otimizar-conta.ts");

  it("otimizar na conversa: caminho rápido antes da ordem direta, só Jev, nada escrito sem o Confirmar", () => {
    expect(index).toMatch(/if \(!modoAssumir && \(corpo\.modo === "otimizar" \|\| pareceOtimizar\(mensagem\)\)\) \{\n\s+return await otimizarNaConversa\(/);
    const corpo = index.slice(index.indexOf("async function otimizarNaConversa"), index.indexOf("async function acessoDeGestao"));
    expect(corpo).toContain("jevPerguntar(");
    expect(corpo).not.toContain("chamarComTetoDeTempo(");
    expect(corpo).not.toContain("executarNaMeta(");
    expect(corpo).not.toContain("fazerOQueESeguro(");
    expect(corpo).toContain('tipo: "trocar_anuncio" as const');
    // A troca registra como troca de criativo (coluna com CHECK) e liga o criativo ao anúncio novo.
    expect(index).toContain('trocar_anuncio: "trocar_criativo",');
    expect(index).toContain('update({ ad_id: resultado.criado.anuncio_id, status: "no_ar" })');
    expect(index).toContain('update({ ad_id: null, status: "pronto" })');
  });

  it("sem travessão nos textos do módulo", () => {
    expect(TRAVESSAO.test(modulo)).toBe(false);
  });
});
