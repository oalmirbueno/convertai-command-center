import { describe, expect, it } from "vitest";
import { estadoRealComoTexto, lerEstadoReal, tendenciaDoConteudo } from "../../supabase/functions/_shared/estado-real-do-cliente";

/**
 * Rituais de 16/10 diziam "sem dado de alcance do Instagram na semana" com o
 * número no banco. A coleta do meio da semana grava a semana em andamento só
 * com seguidores; ela vinha primeiro e apagava a semana fechada. Aqui o estado
 * real precisa trazer os números da última semana fechada, com as datas, e os
 * do anúncio (gasto, conversas, custo, impressões e cliques) na semana e na anterior.
 */

function bancoFalso(tabelas: Record<string, unknown[]>) {
  const construtor = (tabela: string) => {
    const resposta = () => ({ data: tabelas[tabela] ?? [], error: null });
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "lt", "neq", "in", "is", "order", "limit", "or", "contains"]) q[m] = () => q;
    q.range = () => Promise.resolve(resposta());
    q.maybeSingle = () => Promise.resolve({ data: (resposta().data as unknown[])[0] ?? null, error: null });
    q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, erro);
    return q;
  };
  return { from: construtor };
}

const conta = "67588009-db0f-4433-b66c-3b3b72d04504";
const conversa = (n: number) => [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: String(n) }, { action_type: "post_engagement", value: "11" }];

const tabelas = {
  profiles: [{ id: "c1", company_name: "Mirante Luz Floripa", created_at: "2026-06-01T00:00:00Z", services_config: { social: true, trafego: true } }],
  social_metrics_weekly: [
    // Semana em andamento: a coleta de hoje só trouxe seguidores e posts.
    { external_account_id: conta, week_start: "2026-10-19", week_end: "2026-10-25", captured_at: "2026-10-19T13:06:00Z", followers: 390, media_count: 34, reach: null, profile_views: null, accounts_engaged: null, total_interactions: null },
    { external_account_id: conta, week_start: "2026-10-12", week_end: "2026-10-18", captured_at: "2026-10-19T03:16:00Z", followers: 386, media_count: 34, reach: 4147, profile_views: 114, accounts_engaged: 30, total_interactions: 63 },
    { external_account_id: conta, week_start: "2026-10-05", week_end: "2026-10-11", captured_at: "2026-10-12T03:16:00Z", followers: 350, media_count: 30, reach: 4234, profile_views: 103, accounts_engaged: 44, total_interactions: 56 },
    { external_account_id: conta, week_start: "2026-09-28", week_end: "2026-10-04", captured_at: "2026-10-05T03:16:00Z", followers: 315, media_count: 28, reach: 4854, profile_views: 132, accounts_engaged: 50, total_interactions: 73 },
  ],
  ads_campaigns: [{ name: "MLF | IG DIRECT | QUARTO 01", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", daily_budget: 15 }],
  ads_campaign_daily: [
    { campaign_id: "k1", campaign_name: "MLF | IG DIRECT | QUARTO 01", objective: "OUTCOME_ENGAGEMENT", day: "2026-10-18", spend: "80", impressions: 3000, clicks: 90, actions: conversa(8) },
    { campaign_id: "k1", campaign_name: "MLF | IG DIRECT | QUARTO 01", objective: "OUTCOME_ENGAGEMENT", day: "2026-10-14", spend: "78", impressions: 2800, clicks: 70, actions: conversa(5) },
    { campaign_id: "k1", campaign_name: "MLF | IG DIRECT | QUARTO 01", objective: "OUTCOME_ENGAGEMENT", day: "2026-10-08", spend: "189", impressions: 7000, clicks: 150, actions: conversa(9) },
  ],
};

describe("estado real traz os números atuais do Instagram e dos anúncios", () => {
  const agora = new Date("2026-10-19T15:00:00Z");

  it("semana em andamento sem alcance não apaga a última semana fechada", async () => {
    const e = await lerEstadoReal(bancoFalso(tabelas), "c1", { agora });
    expect(e.organico.semanas[0]).toMatchObject({ de: "2026-10-12", ate: "2026-10-18", seguidores: 386, alcance: 4147, visitasAoPerfil: 114, contasQueInteragiram: 30, interacoes: 63, postsNoPerfil: 4 });
    expect(e.organico.semanas[1]).toMatchObject({ de: "2026-10-05", alcance: 4234, postsNoPerfil: 2 });
    expect(e.organico.agora).toMatchObject({ de: "2026-10-19", seguidores: 390 });
    expect(tendenciaDoConteudo(e)).toBe("igual");
    expect(e.pago.semana).toMatchObject({ gasto: 158, contatos: 13, impressoes: 5800, cliques: 160, resultados: 13, rotuloDoResultado: "Conversas iniciadas" });
    expect(e.pago.semana.custoPorResultado).toBeCloseTo(12.15, 2);
    expect(e.pago.semanaAnterior).toMatchObject({ gasto: 189, contatos: 9, impressoes: 7000, cliques: 150 });

    const txt = estadoRealComoTexto(e, { ritual: "prova_movimento" });
    expect(txt).toContain("PERÍODOS: semana = 13/10 a 19/10; semana anterior = 06/10 a 12/10");
    expect(txt).toContain("Instagram, última semana fechada 12/10 a 18/10, comparada com 05/10 a 11/10: 386 seguidores (+36 na semana); 4.147 pessoas alcançadas (-2%); 114 visitas ao perfil (+11%); 30 contas que interagiram (-32%); 63 interações (+13%); 4 post(s) novos no perfil (anterior 2).");
    expect(txt).toContain("Agora (semana em andamento desde 19/10, lido em 19/10): 390 seguidores");
    expect(txt).not.toContain("alcance sem dado");
    expect(txt).toContain("- Semana 13/10 a 19/10: R$ 158 investidos, 13 contatos (custo por contato R$ 12); 5.800 impressões e 160 cliques.");
    expect(txt).toContain("- Semana anterior 06/10 a 12/10: R$ 189 investidos, 9 contatos (custo por contato R$ 21); 7.000 impressões e 150 cliques.");
  });

  it("campanha de engajamento mostra o resultado pelo objetivo e o custo por resultado", async () => {
    const e = await lerEstadoReal(bancoFalso({
      ...tabelas,
      ads_campaign_daily: [{ campaign_id: "k2", campaign_name: "Alcance do perfil", objective: "OUTCOME_ENGAGEMENT", day: "2026-10-17", spend: "40", impressions: 4000, clicks: 30, actions: [{ action_type: "post_engagement", value: "200" }] }],
    }), "c1", { agora });
    const txt = estadoRealComoTexto(e, { ritual: "prova_movimento" });
    expect(txt).toContain("R$ 40 investidos, 0 contatos; resultado pelo objetivo: 200 engajamentos (custo por resultado R$ 0,20); 4.000 impressões e 30 cliques.");
  });

  it("só a semana em andamento: mostra os seguidores de agora, sem inventar alcance", async () => {
    const e = await lerEstadoReal(bancoFalso({ ...tabelas, social_metrics_weekly: [tabelas.social_metrics_weekly[0]] }), "c1", { agora });
    expect(e.organico.semanas).toEqual([]);
    const txt = estadoRealComoTexto(e, { ritual: "prova_movimento" });
    expect(txt).toContain("Instagram agora (lido em 19/10): 390 seguidores");
  });
});
