import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aprendizadosDoOrganico,
  chaveDaMemoria,
  julgarAnuncio,
  julgarPosts,
  lerDesempenhoDoCliente,
  lerEvolucao,
  metricasCompletas,
  periodoDoPedido,
  saldoDoTexto,
  serieDaConta,
  textoDaMemoria,
  tipoDoBriefing,
  tipoDoResultado,
  tiposPorAnuncio,
  type AnuncioParaEvolucao,
  type LinhaDiariaAds,
  type PostParaEvolucao,
} from "../../supabase/functions/_shared/evolucao";

/**
 * Frente E (25/09/2026): contas de anúncio, métricas e evolução.
 * O módulo de regras (_shared/evolucao.ts) é puro e roda aqui direto; a
 * função, o SQL (não aplicado) e a conexão com a Meta são conferidos pela fonte.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const TRAVESSAO = /[\u2014\u2013]/;

const dia = (d: string, o: Partial<LinhaDiariaAds> = {}): LinhaDiariaAds => ({
  ad_id: "a1",
  campaign_id: "c1",
  day: d,
  spend: 10,
  impressions: 1000,
  clicks: 30,
  link_clicks: 20,
  frequency: 1.25,
  actions: [],
  ...o,
});

const acao = (tipo: string, valor: number) => ({ action_type: tipo, value: String(valor) });

// ------------------------------------------------------------------ resultado pelo objetivo

describe("resultado certo para o objetivo da campanha", () => {
  it("tráfego conta visita (ou clique), alcance conta pessoas, engajamento com conversa conta mensagem", () => {
    expect(tipoDoResultado("OUTCOME_TRAFFIC", null, [acao("landing_page_view", 5)])).toBe("visitas");
    expect(tipoDoResultado("OUTCOME_TRAFFIC", null, [acao("link_click", 5)])).toBe("cliques_link");
    expect(tipoDoResultado("OUTCOME_AWARENESS", null, [])).toBe("alcance");
    expect(tipoDoResultado("OUTCOME_ENGAGEMENT", null, [acao("onsite_conversion.messaging_conversation_started_7d", 2)])).toBe("mensagens");
    expect(tipoDoResultado("OUTCOME_ENGAGEMENT", null, [acao("post_engagement", 9)])).toBe("engajamento");
    expect(tipoDoResultado("OUTCOME_SALES", null, [acao("purchase", 1)])).toBe("compras");
    expect(tipoDoResultado("OUTCOME_LEADS", null, [acao("lead", 1)])).toBe("leads");
    // A meta de otimização do conjunto vale mais que o objetivo.
    expect(tipoDoResultado("OUTCOME_ENGAGEMENT", "LANDING_PAGE_VIEWS", [])).toBe("visitas");
    expect(tipoDoResultado(null, null, [acao("lead", 1)])).toBe("leads");
    expect(tipoDoResultado(null, null, [])).toBeNull();
  });

  it("campanha de tráfego deixa de aparecer com zero resultado", () => {
    const linhas = [dia("2026-09-01", { actions: [acao("landing_page_view", 8), acao("link_click", 20)] }), dia("2026-09-02", { actions: [acao("landing_page_view", 12)] })];
    const objetivos = new Map([["c1", "OUTCOME_TRAFFIC"]]);
    const m = metricasCompletas(linhas, tiposPorAnuncio(linhas, objetivos), objetivos);
    expect(m.resultado_tipo).toBe("visitas");
    expect(m.resultados).toBe(20);
    expect(m.custo_por_resultado).toBe(1);
    expect(m.resultado_rotulo).toBe("Visitas à página");
  });

  it("um dia sem mensagem não troca o objetivo do anúncio naquele dia", () => {
    const linhas = [
      dia("2026-09-01", { actions: [acao("onsite_conversion.messaging_conversation_started_7d", 3), acao("post_engagement", 40)] }),
      dia("2026-09-02", { actions: [acao("post_engagement", 50)] }),
    ];
    const objetivos = new Map([["c1", "OUTCOME_ENGAGEMENT"]]);
    const tipos = tiposPorAnuncio(linhas, objetivos);
    expect(tipos.get("a1")).toBe("mensagens");
    const m = metricasCompletas(linhas, tipos, objetivos);
    expect(m.resultados).toBe(3);
    expect(m.acoes.engajamento).toBe(90);
  });

  it("CTR, CPC, CPM, frequência, alcance aproximado, valor de conversão e ROAS", () => {
    const linhas = [
      dia("2026-09-01", { spend: 50, impressions: 2000, clicks: 60, link_clicks: 40, frequency: 1.6, actions: [acao("purchase", 2)], action_values: [acao("purchase", 300)] }),
      dia("2026-09-02", { spend: 50, impressions: 2000, clicks: 40, link_clicks: 10, frequency: 1.6, actions: [acao("purchase", 1)], action_values: [acao("purchase", 150)] }),
    ];
    const m = metricasCompletas(linhas, "compras");
    expect(m.gasto).toBe(100);
    expect(m.ctr).toBe(2.5);
    expect(m.ctr_link).toBe(1.25);
    expect(m.cpc_link).toBe(2);
    expect(m.cpm).toBe(25);
    expect(m.frequencia).toBe(1.6);
    expect(m.alcance_aprox).toBe(2500);
    expect(m.custo_por_resultado).toBe(33.33);
    expect(m.valor_conversao).toBe(450);
    expect(m.roas).toBe(4.5);
    expect(m.dias).toBe(2);
  });

  it("série diária da conta e tipo do briefing", () => {
    const s = serieDaConta([dia("2026-09-02", { ad_id: "b" }), dia("2026-09-01"), dia("2026-09-01", { ad_id: "b" })]);
    expect(s.map((p) => [p.dia, p.gasto])).toEqual([["2026-09-01", 20], ["2026-09-02", 10]]);
    expect(tipoDoBriefing("vendas")).toBe("compras");
    expect(tipoDoBriefing("agendamento")).toBe("mensagens");
    expect(tipoDoBriefing("seguidores")).toBeNull();
  });
});

// ------------------------------------------------------------------ saldo e período

describe("saldo da conta e período", () => {
  it("lê o saldo do texto do meio de pagamento (pré-paga)", () => {
    expect(saldoDoTexto("Saldo disponível (R$ 1.234,56 BRL)")).toBe(1234.56);
    expect(saldoDoTexto("Available balance ($12.50 USD)")).toBe(12.5);
    expect(saldoDoTexto("Visa final 1234")).toBeNull();
    expect(saldoDoTexto(null)).toBeNull();
  });

  it("período por dias permitidos ou inicio/fim, com teto de 180 dias", () => {
    expect(periodoDoPedido({ dias: 90 }, [7, 14, 30, 60, 90], 14, "2026-09-25")).toEqual({ inicio: "2026-06-28", fim: "2026-09-25", dias: 90 });
    expect(periodoDoPedido({ dias: 45 }, [7, 14, 30, 60, 90], 14, "2026-09-25").dias).toBe(14);
    expect(periodoDoPedido({ inicio: "2026-09-01", fim: "2026-09-10" }, [7], 7, "2026-09-25")).toEqual({ inicio: "2026-09-01", fim: "2026-09-10", dias: 10 });
    expect(periodoDoPedido({ inicio: "2025-01-01", fim: "2026-09-10" }, [7], 7, "2026-09-25").dias).toBe(180);
  });
});

// ------------------------------------------------------------------ regras de evolução

const anuncio = (id: string, gasto: number, resultados: number, extra: Partial<AnuncioParaEvolucao["metricas"]> = {}, ctrVar: number | null = null): AnuncioParaEvolucao => ({
  ad_id: id,
  nome: `Anúncio ${id}`,
  campanha: "Campanha",
  imagem_url: null,
  formato: "imagem",
  cta: null,
  ctr_var_pct: ctrVar,
  metricas: {
    ...metricasCompletas([], "mensagens"),
    gasto,
    impressoes: 5000,
    resultados,
    custo_por_resultado: resultados > 0 ? Math.round((gasto / resultados) * 100) / 100 : null,
    resultado_tipo: "mensagens",
    resultado_rotulo: "Conversas iniciadas",
    ctr_link: 1.2,
    frequencia: 1.5,
    ...extra,
  },
});

describe("julgar anúncios contra a média da conta", () => {
  it("vencedor, manter, descartar e observar, cada um com motivo e número", () => {
    expect(julgarAnuncio(anuncio("v", 100, 20), 10, 1.2).grupo).toBe("vencedores");
    const v = julgarAnuncio(anuncio("v", 100, 20), 10, 1.2).item;
    expect(v.motivo).toContain("R$ 5,00");
    expect(v.motivo).toContain("50% abaixo da média");
    expect(v.numeros.custo_por_resultado).toBe(5);
    expect(julgarAnuncio(anuncio("m", 100, 10), 10, 1.2).grupo).toBe("manter");
    expect(julgarAnuncio(anuncio("d", 150, 8), 10, 1.2).grupo).toBe("descartar");
    const semResultado = julgarAnuncio(anuncio("z", 40, 0), 10, 1.2);
    expect(semResultado.grupo).toBe("descartar");
    expect(semResultado.item.motivo).toContain("sem nenhum(a) conversa");
    // Pouco gasto ainda: observar, nunca matar cedo.
    expect(julgarAnuncio(anuncio("o", 12, 0), 10, 1.2).grupo).toBe("observar");
    expect(julgarAnuncio(anuncio("i", 100, 5, { impressoes: 400 }), 10, 1.2).grupo).toBe("observar");
  });

  it("fadiga vira aviso de renovar no vencedor e no manter", () => {
    const cansado = anuncio("f", 100, 10, { frequencia: 3.4 }, -30);
    const j = julgarAnuncio(cansado, 10, 1.2);
    expect(j.grupo).toBe("manter");
    expect(j.item.motivo).toContain("cansou");
  });
});

const post = (id: string, reach: number, o: Partial<PostParaEvolucao> = {}): PostParaEvolucao => ({
  media_id: id,
  media_type: "IMAGE",
  caption: `Legenda ${id}`,
  permalink: `https://instagram.test/${id}`,
  imagem_url: null,
  posted_at: "2026-09-01T12:00:00Z",
  reach,
  like_count: Math.round(reach * 0.05),
  comments_count: 1,
  saved: 1,
  shares: 0,
  total_interactions: null,
  ...o,
});

describe("julgar posts contra a média do perfil", () => {
  const agora = new Date("2026-09-25T12:00:00Z").getTime();

  it("destaque, abaixo e 'pouca curtida, muito comentário'", () => {
    const posts = [post("a", 100), post("b", 110), post("c", 90), post("top", 400), post("fraco", 30, { like_count: 0, comments_count: 0, saved: 0 }), post("conversa", 100, { like_count: 4, comments_count: 9 })];
    const r = julgarPosts(posts, agora);
    expect(r.base.avaliados).toBe(6);
    expect(r.destaques.map((d) => d.id)).toContain("top");
    expect(r.abaixo.map((d) => d.id)).toContain("fraco");
    expect(r.abaixo[0].motivo).toContain("Não funcionou");
    const conversa = r.sinais.find((s) => s.id === "conversa");
    expect(conversa && conversa.motivo).toContain("Pouca curtida e muito comentário");
  });

  it("post com menos de 24 horas ou sem alcance não entra na média", () => {
    const r = julgarPosts([post("novo", 500, { posted_at: "2026-09-25T06:00:00Z" }), post("sem", 0, { reach: null })], agora);
    expect(r.base.avaliados).toBe(0);
    expect(r.base.alcance_medio).toBeNull();
  });

  it("formato que alcança mais vira aprendizado de repetir, o pior de evitar", () => {
    const r = julgarPosts([post("v1", 400, { media_type: "VIDEO" }), post("v2", 380, { media_type: "VIDEO" }), post("c1", 90, { media_type: "CAROUSEL_ALBUM" }), post("c2", 80, { media_type: "CAROUSEL_ALBUM" })], agora);
    const aps = aprendizadosDoOrganico(r.medidos);
    expect(aps.find((a) => a.tipo === "repetir")!.texto).toContain("vídeo (Reels)");
    expect(aps.find((a) => a.tipo === "evitar")!.texto).toContain("carrossel");
  });
});

describe("leitura completa de evolução", () => {
  it("junta anúncios e orgânico, sugere testes, grava aprendizados com chave e sem travessão", () => {
    const l = lerEvolucao({
      periodo: { inicio: "2026-08-27", fim: "2026-09-25" },
      anuncios: [anuncio("v", 100, 20), anuncio("m", 100, 10), anuncio("d", 200, 8), anuncio("o", 10, 0)],
      posts: [post("a", 100), post("b", 110), post("c", 90), post("top", 400)],
      agora: new Date("2026-09-25T12:00:00Z").getTime(),
    });
    expect(l.vencedores.map((i) => i.id)).toEqual(["v"]);
    expect(l.descartar.map((i) => i.id)).toEqual(["d"]);
    expect(l.observar.map((i) => i.id)).toEqual(["o"]);
    expect(l.conteudo.destaques.map((i) => i.id)).toEqual(["top"]);
    expect(l.proximos_testes.length).toBeGreaterThan(0);
    expect(l.proximos_testes[0].criterio).toContain("R$");
    expect(l.aprendizados.some((a) => a.canal === "anuncios" && a.tipo === "repetir")).toBe(true);
    expect(l.aprendizados.some((a) => a.canal === "anuncios" && a.tipo === "evitar")).toBe(true);
    expect(JSON.stringify(l)).not.toMatch(TRAVESSAO);
    const texto = textoDaMemoria(l.aprendizados[0], l.periodo);
    expect(texto.indexOf("Evolução 27/08 a 25/09 [")).toBe(0);
    expect(chaveDaMemoria(texto)).toBe(l.aprendizados[0].chave);
  });

  it("o custo tolerável do briefing vale só para o mesmo tipo de resultado", () => {
    const l = lerEvolucao({ periodo: { inicio: "2026-09-01", fim: "2026-09-25" }, anuncios: [anuncio("x", 100, 10)], posts: [], custoToleravel: 20, tipoToleravel: "mensagens" });
    expect(l.vencedores[0].numeros.custo_referencia_fonte).toBe("briefing");
    const outro = lerEvolucao({ periodo: { inicio: "2026-09-01", fim: "2026-09-25" }, anuncios: [anuncio("x", 100, 10)], posts: [], custoToleravel: 20, tipoToleravel: "leads" });
    expect(outro.vencedores).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ leitura do banco

/** Banco falso no formato do supabase-js (encadeável e "thenable"). */
function bancoFalso(tabelas: Record<string, unknown[]>, opcoes: { semColunasNovas?: boolean } = {}) {
  const pedidos: { tabela: string; colunas: string }[] = [];
  return {
    pedidos,
    from(tabela: string) {
      let colunas = "";
      const q: any = {};
      for (const m of ["eq", "gte", "lte", "order", "limit", "in", "like", "not", "neq"]) q[m] = () => q;
      q.select = (c: string) => {
        colunas = c;
        pedidos.push({ tabela, colunas: c });
        return q;
      };
      q.range = () => q;
      q.then = (ok: any, erro: any) => {
        if (opcoes.semColunasNovas && tabela === "ads_creative_daily" && colunas.indexOf("optimization_goal") >= 0) {
          return Promise.resolve({ data: null, error: { code: "42703", message: "column ads_creative_daily.adset_id does not exist" } }).then(ok, erro);
        }
        if (opcoes.semColunasNovas && tabela === "ads_account_snapshot") {
          return Promise.resolve({ data: null, error: { code: "42P01", message: "relation does not exist" } }).then(ok, erro);
        }
        return Promise.resolve({ data: tabelas[tabela] || [], error: null }).then(ok, erro);
      };
      return q;
    },
  };
}

describe("desempenho do cliente: orgânico e anúncios juntos", () => {
  const tabelas = {
    ads_creative_daily: [
      { ad_id: "a1", campaign_id: "c1", day: "2026-09-20", spend: 30, impressions: 3000, reach: 2000, clicks: 50, link_clicks: 30, frequency: 1.5, actions: [acao("landing_page_view", 15)] },
    ],
    ads_creatives: [{ ad_id: "a1", ad_name: "Peça 1", campaign_id: "c1", thumbnail_url: "https://meta.test/t.jpg", image_url: null, video_id: null, updated_at: "2026-09-25T10:00:00Z" }],
    ads_campaigns: [{ campaign_id: "c1", name: "Tráfego", objective: "OUTCOME_TRAFFIC" }],
    external_accounts: [{ id: "ig1", handle: "@cliente", display_name: "Cliente", status: "active" }],
    social_metrics_weekly: [
      { external_account_id: "ig1", week_start: "2026-09-08", followers: 100, reach: 500, total_interactions: 20, profile_views: 5, accounts_engaged: 4 },
      { external_account_id: "ig1", week_start: "2026-09-15", followers: 110, reach: 700, total_interactions: 30, profile_views: 9, accounts_engaged: 6 },
    ],
    social_post_metrics: [{ media_id: "p1", media_type: "VIDEO", caption: "Oi", permalink: "https://ig/p1", thumbnail_url: "https://ig/t.jpg", posted_at: "2026-09-18T12:00:00Z", like_count: 10, comments_count: 2, reach: 300, saved: 3, shares: 1, total_interactions: 16 }],
  };

  it("soma o que faz sentido e diz como, com o resultado de tráfego contado", async () => {
    const banco = bancoFalso(tabelas);
    const d = await lerDesempenhoDoCliente(banco, "cli", { inicio: "2026-09-12", fim: "2026-09-25", dias: 14 });
    expect(d.anuncios.totais.resultado_tipo).toBe("visitas");
    expect(d.anuncios.totais.resultados).toBe(15);
    expect(d.anuncios.totais.alcance_aprox).toBe(2000);
    expect(d.organico.totais.interacoes).toBe(16);
    expect(d.organico.contas[0].seguidores).toBe(110);
    expect(d.organico.contas[0].seguidores_variacao).toBe(10);
    expect(d.somado.alcance_aprox).toBe(2700);
    expect(d.somado.investimento).toBe(30);
    expect(d.somado.explicacao).toContain("pode contar a mesma pessoa duas vezes");
    expect(d._anuncios[0].formato).toBe("imagem");
  });

  it("antes do SQL novo (colunas e tabela ainda não existem) cai nas colunas antigas sem erro", async () => {
    const banco = bancoFalso(tabelas, { semColunasNovas: true });
    const d = await lerDesempenhoDoCliente(banco, "cli", { inicio: "2026-09-12", fim: "2026-09-25", dias: 14 });
    expect(d.anuncios.totais.gasto).toBe(30);
    const diarias = banco.pedidos.filter((p) => p.tabela === "ads_creative_daily").map((p) => p.colunas);
    expect(diarias.some((c) => c.indexOf("optimization_goal") >= 0)).toBe(true);
    expect(diarias.some((c) => c.indexOf("optimization_goal") < 0)).toBe(true);
  });
});

// ------------------------------------------------------------------ fontes: SQL, função e conexão

describe("SQL da v4 (docs, não aplicado)", () => {
  const sql = ler("docs/mesa-ads/v4/migrations/01_contas_metricas_evolucao.sql");

  it("não fica em supabase/migrations (não aplica sozinho) e não tem travessão", () => {
    expect(sql).toContain("NÃO APLICADO");
    expect(sql).not.toMatch(TRAVESSAO);
  });

  it("conta: ficha com saldo, gasto total e limite; pedido 'saldo' separado; leitura marcada pela ficha, não pela linha diária", () => {
    expect(sql).toContain("create table if not exists public.ads_account_snapshot");
    expect(sql).toContain(",amount_spent,balance,spend_cap,is_prepay_account,timezone_name");
    expect(sql).toContain("?fields=funding_source_details,business{id,name}");
    expect(sql).toContain("NULLIF(_body->>'amount_spent', '')::numeric / 100");
    expect(sql).toContain("s.tentado_em > now() - interval '1 hour'");
    expect(sql).toContain("check (kind = any (array['account', 'saldo', 'campaigns', 'insights']))");
    expect(sql).toMatch(/create policy ads_account_snapshot_staff_read[\s\S]*?can_access_client\(client_id\)/);
  });

  it("filas: órfão com 3 tentativas sai da fila (a Preserva Eco parou em 31/08 por isso)", () => {
    expect(sql).toContain("delete from social_private.ads_creatives_requests\n   where request_id is null and attempts >= 3;");
    expect(sql).toContain("DELETE FROM social_private.ads_metrics_requests\n   WHERE request_id IS NULL AND attempts >= 3;");
  });

  it("anúncios: conjunto, objetivo, otimização, valor e ROAS; histórico de 90 dias uma vez por dia", () => {
    expect(sql).toContain(",objective,optimization_goal,spend,impressions,reach");
    expect(sql).toContain(",cost_per_action_type,action_values,purchase_roas,date_start");
    expect(sql).toContain(",adset{name,optimization_goal}");
    expect(sql).toContain("_since_acct := _until - 89;");
  });

  it("token por perfil da Meta: trocar de perfil não derruba o outro; o que enxerga a conta tem prioridade", () => {
    expect(sql).toContain("coalesce(meta_user_id, '') = coalesce(_meta_user_id, '')");
    expect(sql).toContain("(not (account.external_id = any (coalesce(token.contas, '{}'::text[])))),");
    expect(sql).toContain("grant execute on function public.save_meta_ads_token_from_login(text, text, text, text[]) to service_role;");
    expect(sql).toContain("revoke execute on function public.save_meta_ads_token_from_login(text, text, text, text[]) from public, anon, authenticated;");
  });

  it("Instagram: sem token no banco, vazio não vira zero, posts relidos e semana corrente até ontem", () => {
    expect(sql).toContain("jsonb_build_object('reach', _body - 'paging')");
    expect(sql).toContain("jsonb_build_object('engage', _body - 'paging')");
    expect(sql).toContain("SET reach = COALESCE(EXCLUDED.reach, w.reach),");
    expect(sql).toContain("SELECT SUM(NULLIF(v->>'value', '')::bigint) INTO _sum");
    expect(sql).toContain("OR (p.posted_at > now() - interval '7 days' AND p.insights_captured_at < now() - interval '6 hours')");
    expect(sql).toContain("_fim_consulta := least(_fim, (now() at time zone 'America/Sao_Paulo')::date - 1);");
    expect(sql).toContain("where w.raw::text like '%access_token=%';");
  });

  it("aprendizados: histórico da leitura só para a equipe com acesso ao cliente", () => {
    expect(sql).toContain("create table if not exists public.evolucao_leituras");
    expect(sql).toMatch(/evolucao_leituras_staff_read[\s\S]*?can_access_client\(client_id\)/);
  });
});

describe("função mesa-ads: ações da frente E", () => {
  const fonte = ler("supabase/functions/mesa-ads/index.ts");
  const corpoDe = (nome: string) => {
    const i = fonte.indexOf(`async function ${nome}(`);
    expect(i, nome).toBeGreaterThan(-1);
    const fim = fonte.indexOf("\n}\n", i);
    return fonte.slice(i, fim);
  };

  it("registra desempenho_cliente e evolucao, com acesso conferido", () => {
    expect(fonte).toContain("  desempenho_cliente: desempenhoCliente,\n  evolucao,\n");
    expect(corpoDe("desempenhoCliente")).toContain("await exigirAcessoAoCliente(chamador, clientId);");
    expect(corpoDe("evolucao")).toContain("await exigirAcessoAoCliente(chamador, clientId);");
    expect(fonte).toContain('"evolucao", "desempenho_cliente",');
  });

  it("evolução: regra em código, IA só explica (uma chamada, 300 s), aprendizados vão à memória dos agentes", () => {
    const e = corpoDe("evolucao");
    expect(e).toContain("const leitura = lerEvolucao({");
    expect(e.match(/chamarTexto\(/g) || []).toHaveLength(1);
    expect(e).toContain("timeoutMs: TIMEOUT_TEXTO_ADS_MS,");
    expect(e).toContain('if (corpo.explicar === true)');
    expect(e).toContain("gravarAprendizados(servico, clientId, leitura)");
    const g = corpoDe("gravarAprendizados");
    expect(g).toContain('.from("agente_memoria")');
    expect(g).toContain('origem: "metrica"');
    expect(g).toContain("MAX_MEMORIAS_DE_EVOLUCAO");
  });

  it("conta ao vivo: 7 a 90 dias, saldo, comparação, série, conjuntos; raw só dos anúncios da tela", () => {
    const c = corpoDe("lerContaAoVivo");
    expect(fonte).toContain("const DIAS_CONTA = [7, 14, 30, 60, 90];");
    expect(c).toContain("lerSaldosDasContas(servico, clientId)");
    expect(c).toContain("comparacao: compararPeriodos(");
    expect(c).toContain("serie: serieDaConta(");
    expect(c).toContain("conjuntos,");
    expect(c).toContain("lerAnunciosDoCliente(servico, clientId, false)");
    expect(c).toContain("lerRawDosAnuncios(servico, clientId, alvo.map((a) => a.ad_id))");
    expect(c).toContain("const custoReferencia = referenciaDoTipo(metricas.resultado_tipo);");
  });
});

describe("conexão de anúncios (social-meta-oauth)", () => {
  const edge = ler("supabase/functions/social-meta-oauth/index.ts");

  it("lista todas as páginas de contas, com campos ricos e volta aos básicos se a Meta recusar", () => {
    expect(edge).toContain('const CAMPOS_DA_CONTA_RICOS = "id,account_id,name,account_status,currency,amount_spent,business{id,name}";');
    expect(edge).toContain('const CAMPOS_DA_CONTA_BASICOS = "id,name,account_status";');
    expect(edge).toContain('error.code === "META_PROVIDER_ERROR") return await ler(CAMPOS_DA_CONTA_BASICOS)');
    expect(edge).toContain("for (let pagina = 0; pagina < 10; pagina++)");
  });

  it("guarda o token por perfil e cai na versão antiga enquanto o SQL novo não estiver aplicado", () => {
    expect(edge).toContain("_meta_user_id: metaUserId,");
    expect(edge).toContain('const semVersaoNova = error.code === "PGRST202" || error.code === "42883";');
  });

  it("o navegador recebe número, nome e situação da conta; nunca o token", () => {
    const i = edge.indexOf("function contaDaMeta(");
    const bloco = edge.slice(i, edge.indexOf("\n}\n", i));
    expect(bloco).not.toMatch(/token/i);
    expect(bloco).toContain("utilizavel:");
  });
});
