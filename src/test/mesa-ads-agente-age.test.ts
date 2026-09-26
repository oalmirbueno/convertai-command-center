import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alvosComApelido,
  blocoDosAlvos,
  calcularOrcamento,
  criativosComApelido,
  desfazerNaMeta,
  estadoLido,
  executarNaMeta,
  fotografar,
  grafoDaMeta,
  type GrafoMeta,
  mudouDesdeAProposta,
  normalizarAcoesDaConta,
  permissaoDeGestao,
  planoDeTesteDaEstrategia,
  specComNovaArte,
  temReverso,
  CacheCurto,
  conferenciaValida,
  escoposConcedidos,
  gestaoDosEscopos,
  marcarEnsaio,
} from "../../supabase/functions/mesa-ads/acoes-conta";
import { buildFacebookLoginUrl, META_ESCOPOS_DE_GESTAO } from "../../supabase/functions/social-meta-oauth/meta";
import { canalDoDestino, itemDaAgendaDoKit, normalizarKit, objecoesDoBriefing, pedidoDoKit } from "../../supabase/functions/mesa-ads/kit-recepcao";
import { normalizarEstrategia, tarefaDoAgenteSenior } from "../../supabase/functions/mesa-ads/agente-senior";

/**
 * Agente sênior que age (pedido do dono em 25/09 à noite): apelido para id da
 * Meta, teto de orçamento, recusa quando o estado mudou, desfazer, permissão
 * de gestão, plano de teste já preenchido e kit de recepção do ângulo. Nada
 * aqui escreve na Meta de verdade: o grafo é falso.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const conta = {
  campanhas: [
    { campaign_id: "120000000000001", nome: "Mensagens WhatsApp", status: "ACTIVE", orcamento_diario: 100 },
    { campaign_id: "120000000000002", nome: "Engajamento", status: "PAUSED", orcamento_diario: null },
  ],
  conjuntos: [{ adset_id: "130000000000001", nome: "Raio 5 km", campanha: "Mensagens WhatsApp" }],
  anuncios: [
    { ad_id: "140000000000001", nome: "Chama no WhatsApp", status: "ACTIVE", campanha: "Mensagens WhatsApp" },
    { ad_id: "140000000000002", nome: "Post antigo", status: "PAUSED", campanha: "Engajamento" },
  ],
};
const alvos = alvosComApelido(conta);
const criativos = criativosComApelido([
  { id: "11111111-1111-1111-1111-111111111111", nome: "Espera | V1", formato: "feed_4x5", ad_id: null, tem_arte: true },
  { id: "22222222-2222-2222-2222-222222222222", nome: "Rascunho", formato: "feed_4x5", ad_id: null, tem_arte: false },
]);

/** Grafo falso: guarda o estado de cada objeto e as escritas feitas. */
function grafoFalso(estado: Record<string, Record<string, unknown>>) {
  const escritas: { caminho: string; params: Record<string, string> }[] = [];
  const g: GrafoMeta = {
    async ler(caminho) {
      return estado[caminho] ? { id: caminho, ...estado[caminho] } : null;
    },
    async escrever(caminho, params) {
      escritas.push({ caminho, params });
      if (estado[caminho]) {
        if (params.status) estado[caminho].status = params.status;
        if (params.daily_budget) estado[caminho].daily_budget = params.daily_budget;
        if (params.name) estado[caminho].name = params.name;
      }
      if (caminho.endsWith("/copies") && caminho.startsWith("13")) return { copied_adset_id: "139999999999999" };
      if (caminho.endsWith("/copies")) return { copied_ad_id: "149999999999999" };
      if (caminho.endsWith("/adimages")) return { images: { bytes: { hash: "abc123", url: "https://x" } } };
      if (caminho.endsWith("/adcreatives")) return { id: "150000000000001" };
      if (caminho.endsWith("/ads")) return { id: "160000000000001" };
      return { success: true };
    },
  };
  return { g, escritas };
}

describe("apelido para id da Meta", () => {
  it("campanha c, conjunto g, anúncio n e criativo k; o bloco do prompt não leva id", () => {
    expect(alvos.map((a) => a.ref)).toEqual(["c1", "c2", "g1", "n1", "n2"]);
    expect(criativos.map((c) => c.ref)).toEqual(["k1", "k2"]);
    const bloco = blocoDosAlvos(alvos, criativos);
    expect(bloco).toContain("n1 | anúncio | Chama no WhatsApp");
    expect(bloco).not.toContain("140000000000001");
    expect(bloco).not.toContain("11111111-1111");
  });

  it("traduz apelido em id no servidor e ignora o inventado, o repetido e o sem sentido", () => {
    const a = normalizarAcoesDaConta([
      { tipo: "pausar", ref: "N1", motivo: "R$ 30 sem conversa" },
      { tipo: "pausar", ref: "n9", motivo: "inventado" },
      { tipo: "ativar", ref: "n1", motivo: "conflito" },
      { tipo: "pausar", ref: "n2", motivo: "já pausado" },
      { tipo: "orcamento", ref: "c1", variacao_pct: 50, motivo: "vencedor" },
      { tipo: "orcamento", ref: "n1", variacao_pct: 10, motivo: "anúncio não tem verba" },
      { tipo: "trocar_criativo", ref: "n1", criativo_ref: "k2", motivo: "sem arte" },
      { tipo: "vincular_criativo", ref: "n1", criativo_ref: "k1", motivo: "mesma arte" },
      { tipo: "renomear", ref: "c1", texto: "Mensagens | Raio 5 km", motivo: "padrão" },
      { tipo: "tarefa_equipe", texto: "Conferir o WhatsApp", motivo: "atendimento demora" },
      { tipo: "plano_de_teste", motivo: "testar 3 ângulos" },
      { tipo: "plano_de_teste", motivo: "repetido" },
      { tipo: "apagar_tudo", ref: "c1" },
      { tipo: "pausar", ref: "140000000000001", motivo: "id transcrito" },
    ], alvos, criativos, "Pausar o que gasta sem conversa.");
    expect(a).not.toBeNull();
    const itens = a!.itens;
    expect(itens.map((i) => `${i.tipo}:${i.alvo ? i.alvo.meta_id : "-"}`)).toEqual([
      "pausar:140000000000001",
      "orcamento:120000000000001",
      "vincular_criativo:140000000000001",
      "renomear:120000000000001",
      "tarefa_equipe:-",
      "plano_de_teste:-",
    ]);
    expect(itens[0].para).toEqual({ status: "PAUSED" });
    expect(itens[1]).toMatchObject({ variacao_pct: 30, limitado: true, para: { orcamento_diario_brl: 130 } });
    expect(itens[2].criativo && itens[2].criativo.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(a!.ignorados.length).toBe(8);
    expect(a!.resumo).toBe("Pausar o que gasta sem conversa.");
    expect(normalizarAcoesDaConta([], alvos, criativos)).toBeNull();
  });
});

describe("teto de orçamento", () => {
  it("no máximo 30% por confirmação, para cima e para baixo, e nunca abaixo do mínimo", () => {
    expect(calcularOrcamento(100, 20)).toEqual({ para: 120, variacao_pct: 20, limitado: false });
    expect(calcularOrcamento(100, 80)).toEqual({ para: 130, variacao_pct: 30, limitado: true });
    expect(calcularOrcamento(100, -90)).toEqual({ para: 70, variacao_pct: -30, limitado: true });
    expect(calcularOrcamento(6, -30)).toMatchObject({ para: 5, limitado: true });
    expect(calcularOrcamento(null, 20)).toBeNull();
    expect(calcularOrcamento(100, 0)).toBeNull();
  });

  it("a fotografia recalcula sobre o orçamento real lido na Meta", () => {
    const [item] = normalizarAcoesDaConta([{ tipo: "orcamento", ref: "g1", variacao_pct: 25, motivo: "x" }], alvos, criativos)!.itens;
    expect(item.para).toBeNull();
    const f = fotografar(item, estadoLido({ id: "130000000000001", status: "ACTIVE", daily_budget: "4000", name: "Raio 5 km" }));
    expect(f.de).toMatchObject({ orcamento_diario_brl: 40, status: "ACTIVE" });
    expect(f.para).toEqual({ orcamento_diario_brl: 50 });
    expect(f.indisponivel).toBeNull();
    const semVerba = fotografar(item, estadoLido({ id: "130000000000001", status: "ACTIVE", name: "Raio 5 km" }));
    expect(semVerba.indisponivel).toMatch(/não tem orçamento diário próprio/);
  });
});

describe("executar e desfazer na Meta (grafo falso)", () => {
  const preparar = (tipo: string, ref: string, extra: Record<string, unknown> = {}) => {
    const estado: Record<string, Record<string, unknown>> = {
      "120000000000001": { status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "10000", name: "Mensagens WhatsApp" },
      "140000000000001": { status: "ACTIVE", effective_status: "ACTIVE", name: "Chama no WhatsApp", adset_id: "130000000000001", account_id: "act_555" },
    };
    const [bruto] = normalizarAcoesDaConta([{ tipo, ref, motivo: "teste", ...extra }], alvos, criativos)!.itens;
    const item = fotografar(bruto, estadoLido({ id: bruto.alvo!.meta_id, ...estado[bruto.alvo!.meta_id] }));
    return { estado, item };
  };

  it("pausa com a releitura igual e desfaz voltando ao ativo", async () => {
    const { estado, item } = preparar("pausar", "n1");
    const { g, escritas } = grafoFalso(estado);
    const r = await executarNaMeta(item, g);
    expect(r.ok).toBe(true);
    expect(escritas).toEqual([{ caminho: "140000000000001", params: { status: "PAUSED" } }]);
    const feito = { ...item, resultado: r };
    expect(temReverso(feito)).toBe(true);
    expect(await desfazerNaMeta(feito, g)).toEqual({ ok: true });
    expect(estado["140000000000001"].status).toBe("ACTIVE");
  });

  it("recusa quando o estado mudou na Meta desde a proposta (nada é escrito)", async () => {
    const { estado, item } = preparar("orcamento", "c1", { variacao_pct: 20 });
    estado["120000000000001"].daily_budget = "15000";
    const { g, escritas } = grafoFalso(estado);
    const r = await executarNaMeta(item, g);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/Mudou na Meta desde a proposta/);
    expect(r.motivo).toMatch(/Peça nova análise/);
    expect(escritas).toEqual([]);
    expect(mudouDesdeAProposta(item, estadoLido({ id: "1", status: "PAUSED", daily_budget: "10000", name: "Mensagens WhatsApp" }))).toMatch(/status era ACTIVE e agora é PAUSED/);
  });

  it("orçamento vai em centavos e o desfazer só volta se ninguém mexeu depois", async () => {
    const { estado, item } = preparar("orcamento", "c1", { variacao_pct: 20 });
    const { g, escritas } = grafoFalso(estado);
    const r = await executarNaMeta(item, g);
    expect(r.ok).toBe(true);
    expect(escritas[0]).toEqual({ caminho: "120000000000001", params: { daily_budget: "12000" } });
    estado["120000000000001"].daily_budget = "9000";
    const d = await desfazerNaMeta({ ...item, resultado: r }, g);
    expect(d.ok).toBe(false);
    expect(d.motivo).toMatch(/mudou depois/);
  });

  it("duplica em conjunto novo pausado e sobe o criativo da Mesa como anúncio novo pausado", async () => {
    const dup = preparar("duplicar_anuncio", "n1");
    const f1 = grafoFalso(dup.estado);
    const r1 = await executarNaMeta(dup.item, f1.g);
    expect(r1).toMatchObject({ ok: true, criado: { conjunto_id: "139999999999999", anuncio_id: "149999999999999" } });
    expect(f1.escritas.map((e) => e.params.status_option)).toEqual(["PAUSED", "PAUSED"]);

    const troca = preparar("trocar_criativo", "n1", { criativo_ref: "k1" });
    troca.estado["140000000000001"].creative = { id: "1", object_story_spec: { page_id: "777", instagram_user_id: "888", link_data: { link: "https://wa.me/55", message: "antigo", picture: "https://velha", call_to_action: { type: "WHATSAPP_MESSAGE" } } } };
    const f2 = grafoFalso(troca.estado);
    const r2 = await executarNaMeta(troca.item, f2.g, { nome: "Espera | V1", copy: { texto_principal: "Chega de fila" }, imagemBase64: async () => "QUJD" });
    expect(r2).toMatchObject({ ok: true, criado: { anuncio_id: "160000000000001", creative_id: "150000000000001" } });
    const ad = f2.escritas.find((e) => e.caminho === "act_555/ads")!;
    expect(ad.params.status).toBe("PAUSED");
    const spec = JSON.parse(f2.escritas.find((e) => e.caminho === "act_555/adcreatives")!.params.object_story_spec);
    expect(spec).toEqual({ page_id: "777", instagram_user_id: "888", link_data: { link: "https://wa.me/55", message: "Chega de fila", image_hash: "abc123", call_to_action: { type: "WHATSAPP_MESSAGE" } } });
    expect(temReverso({ ...troca.item, resultado: r2 })).toBe(false);
    expect(specComNovaArte({ page_id: "1", link_data: { image_url: "x" } }, "h", {})).toEqual({ page_id: "1", link_data: { image_hash: "h" } });
  });

  it("recusa alvo de conta que não é do cliente (lista editada na conversa) e segue na conta certa", async () => {
    const { estado, item } = preparar("pausar", "n1");
    estado["140000000000001"].account_id = "act_999";
    const f1 = grafoFalso(estado);
    const r = await executarNaMeta(item, f1.g, null, new Set(["555"]));
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/não é de uma conta de anúncios ligada a este cliente/);
    expect(f1.escritas).toEqual([]);
    estado["140000000000001"].account_id = "act_555";
    const f2 = grafoFalso(estado);
    expect((await executarNaMeta(item, f2.g, null, new Set(["555"]))).ok).toBe(true);
  });

  it("item indisponível não escreve e responde com o motivo", async () => {
    const { estado, item } = preparar("pausar", "n1");
    const { g, escritas } = grafoFalso(estado);
    const r = await executarNaMeta({ ...item, indisponivel: "Só leitura." }, g);
    expect(r).toEqual({ ok: false, motivo: "Só leitura." });
    expect(escritas).toEqual([]);
  });

  it("grafo real manda o token no corpo do POST e o erro da Meta volta sem token", async () => {
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const falso = (async (url: string | URL, init?: RequestInit) => {
      chamadas.push({ url: String(url), init });
      return new Response(JSON.stringify({ error: { code: 200, message: "Requires ads_management access_token=SEGREDO" } }), { status: 400 });
    }) as typeof fetch;
    const g = grafoDaMeta("SEGREDO", "v21.0", falso);
    await expect(g.escrever("120000000000001", { status: "PAUSED" })).rejects.toThrow("não tem permissão de gestão");
    expect(chamadas[0].url).toBe("https://graph.facebook.com/v21.0/120000000000001");
    expect(String(chamadas[0].init && chamadas[0].init.body)).toContain("status=PAUSED");
  });
});

describe("permissão de gestão", () => {
  it("ads_management libera; só ads_read pede para conectar com gestão", () => {
    expect(permissaoDeGestao({ data: [{ permission: "ads_read", status: "granted" }, { permission: "ads_management", status: "granted" }] })).toEqual({ disponivel: true, motivo: null });
    const leitura = permissaoDeGestao({ data: [{ permission: "ads_read", status: "granted" }, { permission: "ads_management", status: "declined" }] });
    expect(leitura.disponivel).toBe(false);
    expect(leitura.motivo).toMatch(/conecte com permissão de gestão/);
    expect(permissaoDeGestao(null).disponivel).toBe(false);
  });
});

describe("plano de teste já preenchido", () => {
  const estrategia = {
    reestruturacao: { objetivo: "mensagens", campanhas: [{ orcamento_diario_brl: 60, conjuntos: [{ publico: "Mulheres 25 a 45, raio 5 km", orcamento_diario_brl: 40 }] }], verba_total_diaria_brl: 60 },
    proximos_criativos: [
      { titulo: "Relógio", angulo: "Cansou de esperar", gancho_verbal: "Sem fila", gancho_visual: "relógio", formato: "feed_4x5", estilo_visual: null, objetivo: "mensagens", cta_meta: "Enviar mensagem", porque: "O anúncio da espera teve o menor custo por conversa" },
      { titulo: "Antes da consulta", angulo: "Medo", gancho_verbal: "Sem susto", gancho_visual: "cadeira", formato: "formato_inventado", estilo_visual: null, objetivo: null, cta_meta: "Enviar mensagem", porque: "" },
    ],
    plano_de_teste: { hipotese: "O gancho da espera traz conversa mais barata que o do preço.", variavel: "", publico: "", orcamento_diario_brl: null, duracao_dias: 7, metrica_decisao: "", criterio_vitoria: "" },
  };

  it("preenche hipótese, variável, criativos, público, verba, duração, métrica e critério sem formulário vazio", () => {
    const p = planoDeTesteDaEstrategia(estrategia, { objetivoDoBriefing: null, publicoDoBriefing: null, custoToleravel: 12, custoMedioConta: 9, gastoMedioDiario: 80, hoje: "2026-09-25" });
    const t = p.estrutura.teste;
    expect(t.hipotese).toBe("O gancho da espera traz conversa mais barata que o do preço.");
    expect(t.variavel).toMatch(/ângulo/);
    expect(t.publico).toBe("Mulheres 25 a 45, raio 5 km");
    expect(t.orcamento_diario_brl).toBe(40);
    expect(t.duracao_dias).toBe(7);
    expect(t.metrica_decisao).toMatch(/conversa/);
    expect(t.criterio_vitoria).toContain("R$ 12,00");
    expect(p.lacunas).toEqual([]);
    expect(p.angulos.map((a) => [a.id, a.nome, a.formatos[0], a.objetivo])).toEqual([["a1", "Relógio", "feed_4x5", "mensagens"], ["a2", "Antes da consulta", "feed_4x5", "mensagens"]]);
    expect(p.estrutura.conjuntos[0].angulo_ids).toEqual(["a1", "a2"]);
    expect(p.nome).toBe("Teste do agente sênior 25/09/2026");
    expect(JSON.stringify(p)).not.toMatch(TRAVESSAO);
  });

  it("sem base, deixa a lacuna à vista em vez de inventar", () => {
    const p = planoDeTesteDaEstrategia({ reestruturacao: { objetivo: null, campanhas: [], verba_total_diaria_brl: null }, proximos_criativos: [] }, { objetivoDoBriefing: null, publicoDoBriefing: null, custoToleravel: null, custoMedioConta: null, gastoMedioDiario: null, hoje: "2026-09-25" });
    expect(p.estrutura.teste.orcamento_diario_brl).toBeNull();
    expect(p.lacunas.join(" ")).toMatch(/Verba diária/);
    expect(p.lacunas.join(" ")).toMatch(/Público/);
    expect(p.lacunas.join(" ")).toMatch(/Hipótese/);
  });

  it("o agente devolve o plano_de_teste estruturado e o pedido explica as ações com apelido", () => {
    const e = normalizarEstrategia({ plano_de_teste: { hipotese: "x", orcamento_diario_brl: -3, duracao_dias: 40, criterio_vitoria: "y" } }, new Map());
    expect(e.plano_de_teste).toMatchObject({ hipotese: "x", orcamento_diario_brl: null, duracao_dias: 30 });
    expect(normalizarEstrategia({}, new Map()).plano_de_teste).toBeNull();
    const t = tarefaDoAgenteSenior({ pesquisaWeb: false, bibliotecaConsultada: false, temPlano: false, modoAgir: true });
    expect(t).toContain("MODO AGIR");
    expect(t).toContain("ALVOS_DAS_ACOES");
    expect(t).toMatch(/nunca escreva número de id/);
  });
});

describe("kit de recepção do ângulo", () => {
  const briefing = {
    oferta: { produto: "Clareamento" },
    objecoes: [{ texto: "É caro", resposta: "Parcelamos em 10 vezes", fonte: "atendimento" }, { texto: "", resposta: "x" }],
    destino: { tipo: "whatsapp", primeira_mensagem: "Quero saber do clareamento" },
  };

  it("o pedido leva as objeções do briefing, o canal e a primeira mensagem do anúncio", () => {
    expect(objecoesDoBriefing(briefing)).toEqual([{ objecao: "É caro", resposta: "Parcelamos em 10 vezes" }]);
    expect(canalDoDestino(briefing)).toBe("WhatsApp");
    expect(canalDoDestino({ destino: { tipo: "direct" } })).toBe("Direct do Instagram");
    const p = pedidoDoKit({ nome: "Espera", gancho_verbal: "Sem fila" }, briefing, { promessa: "Sem fila" }, "Clínica X");
    expect(p).toContain("Parcelamos em 10 vezes");
    expect(p).toContain("Quero saber do clareamento");
    expect(p).toContain("primeira_resposta");
    expect(p).toContain("follow_up");
  });

  it("normaliza o kit e monta o post para a agenda com formato e chave válidos", () => {
    const kit = normalizarKit({
      promessa_do_anuncio: "Clareamento sem fila " + String.fromCharCode(0x2014) + " hora marcada",
      post: { formato: "carrossel", titulo: "Por que aqui não tem fila", gancho: "Cansou de esperar?", roteiro: [{ texto: "Card 1", visual: "relógio" }, { texto: "", visual: "" }], legenda: "Legenda", cta: "Chama no WhatsApp", por_que_recebe: "confirma a promessa" },
      perfil: ["Bio com hora marcada"],
      comercial: { canal: "WhatsApp", primeira_resposta: "Oi!", perguntas_qualificacao: ["Já fez clareamento?"], objecoes: [{ objecao: "É caro", resposta: "Parcelamos", fonte: "briefing" }, { objecao: "Dói?", resposta: "Não", fonte: "outra" }], oferta_e_fechamento: "Avaliação", follow_up: [{ quando: "no dia seguinte", mensagem: "Conseguiu ver?" }] },
      lacunas: [],
    });
    expect(kit).not.toBeNull();
    expect(kit!.promessa_do_anuncio).not.toMatch(TRAVESSAO);
    expect(kit!.post.roteiro).toEqual([{ ordem: 1, texto: "Card 1", visual: "relógio" }]);
    expect(kit!.comercial.objecoes[1].fonte).toBe("sugestao");
    const item = itemDaAgendaDoKit(kit!, { nome: "Espera" }, { plano_id: "33333333-3333-3333-3333-333333333333", angulo_id: "a1", versao: 2 });
    expect(item.format).toBe("carousel");
    expect(item.idempotency_key).toBe("mesa-ads-kit:33333333-3333-3333-3333-333333333333:a1:v2");
    expect(/^[A-Za-z0-9._:-]{8,128}$/.test(item.idempotency_key)).toBe(true);
    expect(item.description).toContain("Roteiro dos cards:");
    expect(item.description).toContain("Legenda (copy):");
    expect(normalizarKit({})).toBeNull();
  });
});

describe("fonte do servidor", () => {
  const fonte = ler("supabase/functions/mesa-ads/index.ts");
  it("ações registradas, longas com fôlego, auditLog em cada escrita e token só no servidor", () => {
    for (const a of ["conta_acao_executar: contaAcaoExecutar", "conta_acao_desfazer: contaAcaoDesfazer", "plano_do_agente: planoDoAgente", "kit_recepcao_gerar: kitRecepcaoGerar", "kit_agenda: kitAgenda"]) expect(fonte).toContain(a);
    const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("]);", fonte.indexOf("const ACOES_LONGAS")));
    for (const a of ["conta_acao_executar", "conta_acao_desfazer", "kit_recepcao_gerar"]) expect(longas).toContain(`"${a}"`);
    const executar = fonte.slice(fonte.indexOf("async function contaAcaoExecutar("), fonte.indexOf("async function contaAcaoDesfazer("));
    expect(executar).toContain("executarNaMeta(");
    expect(executar).toContain("auditLog(");
    expect(executar).toContain("acesso.gestao.disponivel");
    const conversar = fonte.slice(fonte.indexOf("async function contaConversar("), fonte.indexOf("\nasync function contaConversaLer("));
    expect(conversar).toContain("blocoDosAlvos(alvos, criativosComRef)");
    expect(conversar).toContain("prepararAcoesDaConta(");
    expect(fonte).not.toMatch(/tokenDeAnuncios\([^)]*\)[^;\n]*json\(/);
  });
});

describe("gestão preparada (rodada 2)", () => {
  it("lê os escopos concedidos e diz exatamente o que falta", () => {
    expect(escoposConcedidos({ data: [{ permission: "ads_read", status: "granted" }, { permission: "ads_management", status: "declined" }, { permission: "ads_read", status: "granted" }] })).toEqual(["ads_read"]);
    expect(escoposConcedidos("nada")).toBeNull();
    expect(gestaoDosEscopos(["ads_read"])).toMatchObject({ disponivel: false, faltam: ["ads_management"] });
    expect(gestaoDosEscopos(["ads_management", "ads_read", "business_management"])).toEqual({ disponivel: true, motivo: null, faltam: [] });
    expect(gestaoDosEscopos([]).faltam).toEqual(["ads_read", "ads_management"]);
    expect(gestaoDosEscopos(null).disponivel).toBe(false);
  });

  it("a conferência guardada vale pelo prazo (a tela não pergunta à Meta a cada abertura)", () => {
    const agora = Date.parse("2026-09-26T12:00:00Z");
    expect(conferenciaValida("2026-09-26T09:00:00Z", agora, 6 * 3600_000)).toBe(true);
    expect(conferenciaValida("2026-09-26T05:00:00Z", agora, 6 * 3600_000)).toBe(false);
    expect(conferenciaValida(null, agora, 6 * 3600_000)).toBe(false);
    expect(conferenciaValida("2026-09-27T05:00:00Z", agora, 6 * 3600_000)).toBe(false);
  });

  it("modo ensaio: sem gestão, os itens da Meta ficam na lista marcados, e os do painel seguem reais", () => {
    const a = normalizarAcoesDaConta([{ tipo: "pausar", ref: "n1", motivo: "x" }, { tipo: "tarefa_equipe", texto: "Conferir", motivo: "y" }], alvos, criativos)!;
    const ensaio = marcarEnsaio(a, { disponivel: false, motivo: "só leitura" });
    expect(ensaio.modo).toBe("ensaio");
    expect(ensaio.itens.map((i) => !!i.ensaio)).toEqual([true, false]);
    expect(ensaio.itens[0].indisponivel).toBeNull();
    const real = marcarEnsaio(a, { disponivel: true, motivo: null });
    expect(real.modo).toBe("real");
    expect(real.itens.some((i) => i.ensaio)).toBe(false);
  });

  it("cache curto reaproveita a leitura no prazo, junta chamadas iguais e esquece por cliente", async () => {
    let agora = 0;
    let leituras = 0;
    const c = new CacheCurto<number>(1000, 10, () => agora);
    const ler = async () => ++leituras;
    const [a, b] = await Promise.all([c.obter("cli-1|30", ler), c.obter("cli-1|30", ler)]);
    expect([a, b, leituras]).toEqual([1, 1, 1]);
    agora = 500;
    expect(await c.obter("cli-1|30", ler)).toBe(1);
    agora = 1500;
    expect(await c.obter("cli-1|30", ler)).toBe(2);
    c.esquecer("cli-1|");
    expect(await c.obter("cli-1|30", ler)).toBe(3);
    await expect(c.obter("erro", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await c.obter("erro", async () => 9)).toBe(9);
  });

  it("login de anúncios com gestão pede ads_management a mais; o do Instagram não muda", () => {
    const base = { appId: "1", configId: "2", graphVersion: "v21.0", redirectUri: "https://aceleriq.online/oauth/meta/callback", state: "s" };
    const normal = new URL(buildFacebookLoginUrl(base)).searchParams.get("scope") || "";
    const gestao = new URL(buildFacebookLoginUrl({ ...base, extraScopes: META_ESCOPOS_DE_GESTAO })).searchParams.get("scope") || "";
    expect(normal).not.toContain("ads_management");
    expect(gestao).toBe(`${normal},ads_management`);
  });

  it("fonte: gestao_status e conta_numeros registrados, execução confere na hora e recusa item de ensaio", () => {
    const fonte = ler("supabase/functions/mesa-ads/index.ts");
    expect(fonte).toContain("gestao_status: gestaoStatus");
    expect(fonte).toContain("conta_numeros: contaNumeros");
    const executar = fonte.slice(fonte.indexOf("async function contaAcaoExecutar("), fonte.indexOf("async function contaAcaoDesfazer("));
    expect(executar).toContain("acessoDeGestao(servico, m.client_id, { conferir: true })");
    expect(executar).toMatch(/i\.na_meta && i\.ensaio/);
    expect(fonte).toContain('servico.rpc("ads_token_registrar_escopos"');
    expect(fonte).toContain("esquecerContextoDoCliente(clientId);");
    const oauth = ler("supabase/functions/social-meta-oauth/index.ts");
    expect(oauth).toContain("handleAdsStart(config, caller, admin, body.gestao === true)");
  });
});
