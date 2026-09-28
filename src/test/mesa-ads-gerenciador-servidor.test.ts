import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  arvoreCompacta,
  campanhasDaMeta,
  centavosEmReais,
  conjuntosDaMeta,
  anunciosDaMeta,
  entregaDoNo,
  hojeDaMeta,
  linkDaCobranca,
  linkDoGerenciador,
  listaCortada,
  marcasDasAcoes,
  montarArvore,
  pedidoDaEquipeInvalido,
  resumoDaArvore,
  revisaoDe,
  situacaoDaConta,
  type MetricasDoNo,
} from "../../supabase/functions/mesa-ads/gerenciador";
import {
  candidatosDaOrdem,
  decidirOrdem,
  nomeNovoDaMensagem,
  pareceOrdemDireta,
  perguntasDaOrdem,
  trechosEntreAspas,
  valorDaMensagem,
} from "../../supabase/functions/mesa-ads/ordem-direta";
import { estadoLido, executarNaMeta, fotografar, respostaCurta, type GrafoMeta, type ItemDaAcaoNaConta } from "../../supabase/functions/mesa-ads/acoes-conta";

/**
 * Frente AD (28/09): o Gerenciador ao vivo (árvore da Meta com a entrega
 * real e o motivo), a prova da escrita (releitura e resposta da Meta) e a
 * ordem direta ao agente sem o modelo pesado (teste real do dono na
 * Verzelo: 6 minutos e provedor_timeout para renomear uma campanha).
 * Tudo com dados sintéticos e um grafo da Meta falso: nada sai para a Meta.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const AGORA = Date.parse("2026-09-28T15:00:00Z");

const metrica = (gasto: number, resultados: number): MetricasDoNo => ({
  gasto, impressoes: gasto * 100, resultados, resultado_rotulo: "Conversas iniciadas", custo_por_resultado: resultados ? gasto / resultados : null, ctr_link: 1.2, cpm: 20, frequencia: 1.4, cliques_link: 10,
});

describe("entrega como o dono entende", () => {
  const base = { nivel: "anuncio" as const, status: "ACTIVE", efetivo: "ACTIVE", hojeImpressoes: 120, filhosAtivos: null, fim: null, problemas: [], revisao: [] };
  it("ativo com impressão hoje entrega; sem impressão, diz o porquê provável; sem leitura de hoje, só Ativo", () => {
    expect(entregaDoNo(base, null, AGORA).estado).toBe("entregando");
    const sem = entregaDoNo({ ...base, hojeImpressoes: 0 }, null, AGORA);
    expect(sem.estado).toBe("ativo_sem_entrega");
    expect(sem.motivo).toMatch(/Nenhuma impressão hoje/);
    expect(entregaDoNo({ ...base, hojeImpressoes: null }, null, AGORA)).toMatchObject({ estado: "ativo", rotulo: "Ativo" });
  });

  it("conta com saldo em aberto (account_status 3): ativo na Meta, mas não entrega, com o motivo e o que fazer", () => {
    const s = situacaoDaConta(3);
    expect(s).toMatchObject({ codigo: 3, rotulo: "Saldo em aberto", travada: true });
    expect(s.motivo).toMatch(/pagamento pendente/);
    expect(s.o_que_fazer).toMatch(/Cobrança e pagamentos/);
    const e = entregaDoNo(base, s, AGORA);
    expect(e).toMatchObject({ estado: "conta_travada", rotulo: "Não entrega" });
    expect(e.motivo).toMatch(/saldo em aberto/);
    expect(situacaoDaConta(1)).toMatchObject({ travada: false, rotulo: "Ativa", motivo: null });
    expect(situacaoDaConta(9).travada).toBe(false);
    expect(situacaoDaConta(null).rotulo).toBe("Sem leitura");
  });

  it("pausado por quem, em análise, reprovado com o motivo da Meta, com problema, encerrado e data final passada", () => {
    expect(entregaDoNo({ ...base, efetivo: "CAMPAIGN_PAUSED" }, null, AGORA).rotulo).toBe("Pausado pela campanha");
    expect(entregaDoNo({ ...base, efetivo: "ADSET_PAUSED" }, null, AGORA).rotulo).toBe("Pausado pelo conjunto");
    expect(entregaDoNo({ ...base, status: "PAUSED", efetivo: "PAUSED" }, null, AGORA).estado).toBe("pausado");
    expect(entregaDoNo({ ...base, efetivo: "PENDING_REVIEW" }, null, AGORA).estado).toBe("em_analise");
    const rep = entregaDoNo({ ...base, efetivo: "DISAPPROVED", revisao: revisaoDe({ global: { "Promessa de resultado": "O anúncio promete resultado garantido." } }) }, null, AGORA);
    expect(rep.estado).toBe("reprovado");
    expect(rep.motivo).toMatch(/resultado garantido/);
    expect(entregaDoNo({ ...base, efetivo: "WITH_ISSUES", problemas: ["Forma de pagamento recusada"] }, null, AGORA).motivo).toBe("Forma de pagamento recusada");
    expect(entregaDoNo({ ...base, efetivo: "ARCHIVED" }, null, AGORA).rotulo).toBe("Arquivado");
    expect(entregaDoNo({ ...base, nivel: "campanha", fim: "2026-09-20T23:59:00-0300" }, null, AGORA)).toMatchObject({ estado: "encerrado", rotulo: "Terminou" });
    expect(entregaDoNo({ ...base, nivel: "campanha", filhosAtivos: 0 }, null, AGORA).motivo).toBe("Nenhum conjunto ativo nesta campanha.");
  });
});

describe("árvore do gerenciador", () => {
  const campanhas = campanhasDaMeta({
    data: [
      { id: "120000000000001", name: "Mensagens | WhatsApp", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", daily_budget: "4000" },
      { id: "120000000000002", name: "Antiga", status: "PAUSED", effective_status: "PAUSED", lifetime_budget: "50000" },
    ],
    paging: { next: "https://graph.facebook.com/..." },
  });
  const conjuntos = conjuntosDaMeta({ data: [{ id: "130000000000001", name: "Raio 5 km", campaign_id: "120000000000001", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "0" }] });
  const anuncios = anunciosDaMeta({
    data: [
      { id: "140000000000001", name: "Relógio", campaign_id: "120000000000001", adset_id: "130000000000001", status: "ACTIVE", effective_status: "ACTIVE" },
      { id: "140000000000002", name: "Carrossel", campaign_id: "120000000000001", adset_id: "130000000000001", status: "PAUSED", effective_status: "PAUSED" },
      { id: "140000000000009", name: "Órfão", campaign_id: "129999999999999", adset_id: "139999999999999", status: "ACTIVE", effective_status: "ACTIVE" },
    ],
  });

  it("lê a Graph (orçamento em centavos, lista cortada, gasto de hoje) e monta campanha, conjunto e anúncio", () => {
    expect(campanhas[0].orcamento_diario_brl).toBe(40);
    expect(campanhas[1].orcamento_total_brl).toBe(500);
    expect(conjuntos[0].orcamento_diario_brl).toBeNull();
    expect(listaCortada({ data: [], paging: { next: "x" } })).toBe(true);
    expect(centavosEmReais("1486")).toBe(14.86);
    expect(centavosEmReais("0")).toBe(0);
    const hoje = hojeDaMeta({ data: [{ ad_id: "140000000000001", spend: "12.30", impressions: "800" }] });
    const marcas = marcasDasAcoes([
      { id: "a-2", origem: "agente", tipo: "renomear", estado: "feita", alvo: { nivel: "campanha", meta_id: "120000000000001", nome: "Mensagens | WhatsApp" }, resumo: "Renomeei a campanha.", criado_em: "2026-09-28T13:32:00Z", desfazer: { mensagem_id: "m", item_id: "i1" }, prova: {} },
      { id: "a-1", origem: "agente", tipo: "pausar", estado: "feita", alvo: { nivel: "campanha", meta_id: "120000000000001" }, resumo: "Antes.", criado_em: "2026-09-28T10:00:00Z", desfazer: null, prova: {} },
      { id: "a-3", origem: "agente", tipo: "pausar", estado: "falhou", alvo: { nivel: "anuncio", meta_id: "140000000000002" }, resumo: "Tentativa de pausar o anúncio Carrossel: não feito.", criado_em: "2026-09-28T13:40:00Z", desfazer: null, prova: { pela_equipe: true } },
    ]);
    const m = { campanha: new Map([["120000000000001", metrica(300, 20)]]), conjunto: new Map(), anuncio: new Map([["140000000000001", metrica(300, 20)]]) };
    const { campanhas: arvore, sem_pai } = montarArvore({ conta: "1871637719955892", situacao: situacaoDaConta(1), campanhas, conjuntos, anuncios, hoje, metricas: m, marcas, agoraMs: AGORA });
    expect(sem_pai).toBe(1);
    expect(arvore.map((c) => c.id)).toEqual(["120000000000001", "120000000000002"]);
    const c = arvore[0];
    expect(c.entrega.estado).toBe("entregando");
    expect(c.hoje).toEqual({ gasto: 12.3, impressoes: 800 });
    expect(c.filhos[0].filhos.map((a) => [a.nome, a.entrega.estado])).toEqual([["Relógio", "entregando"], ["Carrossel", "pausado"]]);
    // A marca é a última ação do item; a da equipe sai como "equipe" mesmo gravada como agente (sem o SQL AD-01).
    expect(c.marca).toMatchObject({ acao_id: "a-2", pode_desfazer: true, origem: "agente" });
    expect(c.filhos[0].filhos[1].marca).toMatchObject({ estado: "falhou", origem: "equipe", pode_desfazer: false });
    expect(c.link_meta).toBe("https://business.facebook.com/adsmanager/manage/campaigns?act=1871637719955892&selected_campaign_ids=120000000000001");
    expect(c.filhos[0].filhos[0].link_meta).toContain("adsmanager/manage/ads?act=1871637719955892&selected_campaign_ids=120000000000001&selected_adset_ids=130000000000001&selected_ad_ids=140000000000001");
    const r = resumoDaArvore(arvore, []);
    expect(r).toMatchObject({ campanhas: 2, campanhas_ativas: 1, campanhas_entregando: 1, anuncios_entregando: 1, gasto_hoje: 12.3, gasto_periodo: 300 });
    // Para a Central: sem link e sem marca, com a entrega e os números.
    const compacta = arvoreCompacta(arvore);
    expect(compacta[0]).toMatchObject({ id: "120000000000001", entrega: "entregando", metricas: { gasto: 300, resultados: 20 } });
    expect(JSON.stringify(compacta)).not.toContain("business.facebook.com");
  });

  it("com a conta travada, tudo o que está ativo aparece como Não entrega, e o alerta vem no resumo", () => {
    const s = situacaoDaConta(3);
    const { campanhas: arvore } = montarArvore({ conta: "1", situacao: s, campanhas, conjuntos, anuncios, hoje: new Map(), metricas: { campanha: new Map(), conjunto: new Map(), anuncio: new Map() }, marcas: new Map(), agoraMs: AGORA });
    expect(arvore[0].entrega.estado).toBe("conta_travada");
    expect(arvore[0].filhos[0].filhos[0].entrega.rotulo).toBe("Não entrega");
    const r = resumoDaArvore(arvore, [{ id: "1", nome: "Conta 01", moeda: "BRL", situacao: s, saldo_a_pagar_brl: 14.86, gasto_total_brl: 100, link_meta: linkDoGerenciador("1"), link_cobranca: linkDaCobranca("1"), fonte: "meta_ao_vivo", lido_em: null, aviso: null }]);
    expect(r.alertas[0]).toMatch(/^Conta 01: A conta tem pagamento pendente/);
    expect(r.campanhas_entregando).toBe(0);
    expect(linkDaCobranca("act_1871637719955892")).toBe("https://business.facebook.com/billing_hub/accounts/details?asset_id=1871637719955892");
  });

  it("pedido da equipe: só pausar, ativar, verba e nome; anúncio não tem verba", () => {
    expect(pedidoDaEquipeInvalido({ tipo: "excluir", nivel: "campanha", meta_id: "120000000000001" })).toMatch(/Ação desconhecida/);
    expect(pedidoDaEquipeInvalido({ tipo: "orcamento", nivel: "anuncio", meta_id: "140000000000001", orcamento_diario_brl: 30 })).toMatch(/Anúncio não tem verba/);
    expect(pedidoDaEquipeInvalido({ tipo: "renomear", nivel: "campanha", meta_id: "120000000000001", nome: "  " })).toMatch(/nome novo/);
    expect(pedidoDaEquipeInvalido({ tipo: "pausar", nivel: "campanha", meta_id: "act_1" })).toMatch(/inválido/);
    expect(pedidoDaEquipeInvalido({ tipo: "pausar", nivel: "conjunto", meta_id: "130000000000001" })).toBeNull();
  });
});

describe("prova da escrita (acoes-conta)", () => {
  it("renomear: relê antes, escreve, relê depois; a prova traz a hora da releitura e a resposta da Meta, sem segredo", async () => {
    const estado: Record<string, Record<string, unknown>> = { "120000000000001": { name: "Velho", status: "PAUSED", effective_status: "PAUSED", account_id: "555" } };
    const escritas: Record<string, string>[] = [];
    const g: GrafoMeta = {
      async ler(c) {
        return estado[c] ? { id: c, ...estado[c] } : null;
      },
      async escrever(c, p) {
        escritas.push(p);
        if (p.name) estado[c].name = p.name;
        return { success: true, access_token: "nao-deve-voltar" };
      },
    };
    const item: ItemDaAcaoNaConta = {
      id: "i1", tipo: "renomear", na_meta: true, alvo: { ref: "direto", nivel: "campanha", meta_id: "120000000000001", nome: "Velho" }, criativo: null,
      texto: "Velho (teste painel)", variacao_pct: null, motivo: "ordem", de: null, para: { nome: "Velho (teste painel)" }, limitado: false, indisponivel: null,
    };
    const lido = estadoLido({ id: "120000000000001", ...estado["120000000000001"] });
    const r = await executarNaMeta(fotografar(item, lido), g, null, new Set(["555"]));
    expect(r.ok).toBe(true);
    expect(escritas).toEqual([{ name: "Velho (teste painel)" }]);
    expect(r.depois).toMatchObject({ nome: "Velho (teste painel)", status: "PAUSED" });
    expect(typeof r.relido_em).toBe("string");
    expect(r.resposta).toEqual({ success: true });
    expect(respostaCurta({ id: "abc", success: false, token: "x" })).toEqual({ success: false });
  });
});

describe("ordem direta sem o modelo pesado", () => {
  const MSG = "Faz agora: renomeie a campanha '[NÃO ATIVAR] Tentativa técnica incompleta | Reel Direct | 15 SET' para '... (teste painel)'. Só essa ação";
  const conta = {
    campanhas: [
      { id: "120000000000001", nome: "[NÃO ATIVAR] Tentativa técnica incompleta | Reel Direct | 15 SET", status: "PAUSED" },
      { id: "120000000000002", nome: "Reel Direct | Setembro", status: "ACTIVE" },
    ],
    conjuntos: [{ id: "130000000000001", nome: "Público aberto 25 a 45", campanha: "Reel Direct | Setembro" }],
    anuncios: [{ id: "140000000000001", nome: "Reel 1", status: "ACTIVE", campanha: "Reel Direct | Setembro" }],
  };

  it("o filtro barato só deixa passar o que tem cara de ordem", () => {
    expect(pareceOrdemDireta(MSG)).toBe(true);
    expect(pareceOrdemDireta("pausa o conjunto Público aberto 25 a 45")).toBe(true);
    expect(pareceOrdemDireta("sobe a verba da campanha Setembro para R$ 50")).toBe(true);
    expect(pareceOrdemDireta("analisa a conta e me diz o que cortar")).toBe(false);
    expect(pareceOrdemDireta("qual o orçamento ideal?")).toBe(false);
  });

  it("o caso real da Verzelo: acha a campanha pelo nome entre aspas e monta o nome novo a partir do atual", () => {
    expect(trechosEntreAspas(MSG)).toHaveLength(2);
    const { candidatos, direto } = candidatosDaOrdem(MSG, conta);
    expect(direto).toMatchObject({ ref: "c1", nivel: "campanha", meta_id: "120000000000001" });
    // A palavra "campanha" restringe os candidatos ao nível citado.
    expect(candidatos.every((c) => c.nivel === "campanha")).toBe(true);
    expect(nomeNovoDaMensagem(MSG, direto!.nome)).toBe("[NÃO ATIVAR] Tentativa técnica incompleta | Reel Direct | 15 SET (teste painel)");
    const d = decidirOrdem(MSG, { ordem: { choice: "renomear", probabilities: { renomear: 0.97, outra: 0.03 } } }, candidatos, direto);
    expect("ordem" in d && d.ordem).toMatchObject({ tipo: "renomear", alvo_por: "nome", nome_novo: "[NÃO ATIVAR] Tentativa técnica incompleta | Reel Direct | 15 SET (teste painel)" });
    // Com o nome casado sozinho, o Jev só confirma a ordem (uma pergunta).
    expect(Object.keys(perguntasDaOrdem(candidatos, false))).toEqual(["ordem"]);
  });

  it("sem nome casado, o Jev escolhe o item (Choice com nenhum); incerto ou outra coisa vai para o modelo", () => {
    const msg = "pausa aquele conjunto aberto do reel";
    const { candidatos, direto } = candidatosDaOrdem(msg, conta);
    expect(direto).toBeNull();
    const q = perguntasDaOrdem(candidatos, true);
    expect(Object.keys(q)).toEqual(["ordem", "alvo"]);
    expect(Object.keys((q.alvo as { criteria: Record<string, string> }).criteria)).toContain("nenhum");
    const ok = decidirOrdem(msg, { ordem: { choice: "pausar", probabilities: { pausar: 0.95 } }, alvo: { choice: "g1", probabilities: { g1: 0.9 } } }, candidatos, null);
    expect("ordem" in ok && ok.ordem).toMatchObject({ tipo: "pausar", alvo_por: "jev", alvo: { meta_id: "130000000000001" } });
    expect(decidirOrdem(msg, { ordem: { choice: "pausar", probabilities: { pausar: 0.6 } } }, candidatos, null)).toEqual({ motivo: "ordem incerta (60%)" });
    expect(decidirOrdem(msg, { ordem: { choice: "pausar", probabilities: { pausar: 0.95 } }, alvo: { choice: "nenhum", probabilities: { nenhum: 0.8 } } }, candidatos, null)).toEqual({ motivo: "item não identificado" });
    expect(decidirOrdem(msg, { ordem: { choice: "outra", probabilities: { outra: 0.9 } } }, candidatos, null)).toEqual({ motivo: "não é uma ordem direta única" });
  });

  it("verba: valor em reais em código (nunca inventado); sem valor, vai para o modelo", () => {
    expect(valorDaMensagem("muda a verba da campanha X para R$ 1.234,50")).toBe(1234.5);
    expect(valorDaMensagem("coloca a verba do conjunto em 40 reais")).toBe(40);
    expect(valorDaMensagem("aumenta a verba")).toBeNull();
    const { candidatos, direto } = candidatosDaOrdem("aumenta a verba da campanha Reel Direct | Setembro", conta);
    expect(decidirOrdem("aumenta a verba da campanha Reel Direct | Setembro", { ordem: { choice: "mudar_verba", probabilities: { mudar_verba: 0.9 } } }, candidatos, direto)).toEqual({ motivo: "valor da verba não encontrado na mensagem" });
  });

  it("decidir é instantâneo (a parte em código da ordem direta leva milissegundos)", () => {
    const grande = { campanhas: Array.from({ length: 200 }, (_, i) => ({ id: `12000000000${String(i).padStart(4, "0")}`, nome: `Campanha ${i} | Reel`, status: "ACTIVE" })), conjuntos: [], anuncios: [] };
    const t0 = Date.now();
    for (let k = 0; k < 20; k++) candidatosDaOrdem("pausa a campanha Campanha 150 | Reel", grande);
    expect((Date.now() - t0) / 20).toBeLessThan(50);
  });
});

describe("fonte do servidor", () => {
  const fonte = ler("supabase/functions/mesa-ads/index.ts");
  it("gerenciador_ler e gerenciador_acao registrados e longos; a ação da equipe vai pelo acoes-conta e fica registrada", () => {
    expect(fonte).toContain("gerenciador_ler: gerenciadorLer,");
    expect(fonte).toContain("gerenciador_acao: gerenciadorAcao,");
    const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("]);", fonte.indexOf("const ACOES_LONGAS")));
    expect(longas).toContain('"gerenciador_ler"');
    expect(longas).toContain('"gerenciador_acao"');
    const acao = fonte.slice(fonte.indexOf("async function gerenciadorAcao("), fonte.indexOf("async function executarPedidoNaConta("));
    expect(acao).toContain("exigirAcessoAoCliente(chamador, clientId)");
    expect(acao).toContain("executarPedidoNaConta(");
    expect(acao).toContain("registrarDaEquipe(");
    expect(acao).toContain("auditLog(");
    const pedido = fonte.slice(fonte.indexOf("async function executarPedidoNaConta("), fonte.indexOf("/** Clientes por chamada do cron"));
    expect(pedido).toContain("acessoDeGestao(servico, clientId, { conferir: true })");
    expect(pedido).toContain("foraDasContas(bruto, contas)");
    expect(pedido).toContain("executarNaMeta(item, acesso.grafo, null, contas)");
    expect(pedido).toContain("TETO_DE_ORCAMENTO");
  });

  it("conta_conversar: a mensagem do dono é gravada antes de ler a conta e de chamar o modelo; falha fica na conversa", () => {
    const i = fonte.indexOf("async function contaConversar(");
    const corpo = fonte.slice(i, fonte.indexOf("\nasync function contaConversaLer(", i));
    const gravar = corpo.indexOf('registrarMensagens(servico, conversaId, clientId, [{ id: pedidoId, papel: "usuario"');
    expect(gravar).toBeGreaterThan(0);
    expect(gravar).toBeLessThan(corpo.indexOf("contextoDoAgenteSenior(servico, clientId, corpo)"));
    expect(gravar).toBeLessThan(corpo.indexOf("chamarComTetoDeTempo("));
    expect(corpo).toContain("tentarOrdemDireta(");
    expect(corpo).toContain("Não consegui responder:");
    // A mensagem do usuário não é gravada de novo no fim.
    expect(corpo).not.toContain('{ papel: "usuario", conteudo: mensagem },');
    const teto = fonte.slice(fonte.indexOf("async function chamarComTetoDeTempo("), fonte.indexOf("const horaDeSaoPaulo"));
    expect(teto).toContain('e.codigo === "provedor_timeout"');
    expect(teto).toContain("pesquisaWeb: false");
    expect(fonte).toContain("const TETO_DO_MODELO_MS = 150_000;");
    const direta = fonte.slice(fonte.indexOf("async function tentarOrdemDireta("), fonte.indexOf("/**\n * pacote_otimizacao_dados"));
    expect(direta).toContain("jevPerguntar(");
    expect(direta).toContain("soSeSeguro: true");
    expect(direta).toContain("registrarFeitosDoAgente(");
  });

  it("o que o agente tentou e não deu também fica em O que foi feito (falhou, sem Desfazer, fora do dossiê)", () => {
    const reg = fonte.slice(fonte.indexOf("async function registrarFeitosDoAgente("), fonte.indexOf("/** Marca em \"O que foi feito\" o que voltou"));
    expect(reg).toContain('estado: ok ? "feita" : "falhou"');
    expect(reg).toContain("desfazer: ok && temReverso(i)");
    expect(reg).toContain("if (!ok) continue;");
    expect(reg).toContain("relido_na_meta_em");
  });

  it("SQL AD-01: tabela das leituras com RLS da equipe e origem equipe; dry termina em ROLLBACK", () => {
    const pasta = "C:/Users/Usuario/AppData/Local/Temp/claude/C--Users-Usuario-Desktop-Projeto-Aceleriq-Claude-Videos/7913a31b-9042-484a-9a14-4fd46c5f26cb/scratchpad";
    let sql = "";
    let dry = "";
    try {
      sql = readFileSync(`${pasta}/AD-01-gerenciador-ao-vivo.sql`, "utf8");
      dry = readFileSync(`${pasta}/AD-01-gerenciador-ao-vivo.dry.sql`, "utf8");
    } catch {
      return; // fora da máquina que gerou o SQL
    }
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ads_gerenciador_leituras");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).toContain("'equipe'");
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.can_access_client/i);
    expect(dry.trim().split("\n").pop()).toMatch(/ROLLBACK;/);
  });
});
