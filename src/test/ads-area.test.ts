import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ler = (caminho: string) =>
  readFileSync(resolve(__dirname, "../..", caminho), "utf8");

const migration = ler("supabase/migrations/20260817200000_meta_ads_campanhas.sql");
const hook = ler("src/hooks/useAdsMetrics.ts");
const telaAdmin = ler("src/pages/AdminAds.tsx");
const blocoCliente = ler("src/components/reports/ClientLiveCampaigns.tsx");
const relatoriosCliente = ler("src/pages/ClientReports.tsx");
const app = ler("src/App.tsx");
const menu = ler("src/components/AppLayout.tsx");

/**
 * A área de anúncios puxa dinheiro real de campanha real. Estes testes guardam
 * o que não pode escorregar: quem enxerga o quê, o token fora do alcance, e a
 * promessa de que o cliente nunca lê jargão da Meta.
 */

describe("a coleta no banco", () => {
  it("cada tabela tem RLS ligada e leitura separada por dono", () => {
    for (const tabela of ["ads_campaigns", "ads_campaign_daily"]) {
      expect(migration).toContain(`ALTER TABLE public.${tabela} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`${tabela}_staff_read`);
      expect(migration).toContain(`${tabela}_client_read`);
    }
  });

  it("o cliente só enxerga a própria conta", () => {
    expect(migration).toMatch(/ads_campaign_daily_client_read[\s\S]*?client_id = auth\.uid\(\)/);
  });

  it("a equipe só enxerga cliente da carteira dela", () => {
    expect(migration).toMatch(
      /ads_campaigns_staff_read[\s\S]*?is_staff\(auth\.uid\(\)\)[\s\S]*?can_access_client/,
    );
  });

  it("ninguém escreve nessas tabelas pelo aplicativo", () => {
    // Só o coletor grava. Escrita pelo painel abriria porta para número forjado.
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.ads_campaigns FROM anon, authenticated");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.ads_campaign_daily FROM anon, authenticated");
  });

  it("o token vai para o cofre e nunca volta em consulta", () => {
    expect(migration).toContain("vault.create_secret");
    // A função de situação devolve rótulo e data, nunca o segredo.
    expect(migration).toMatch(/meta_ads_connection_status[\s\S]*?SELECT label, saved_at/);
    expect(migration).not.toMatch(/decrypted_secret[\s\S]{0,400}meta_ads_connection_status/);
  });

  it("só administrador guarda token; só a equipe dispara coleta", () => {
    expect(migration).toMatch(/save_meta_ads_token[\s\S]*?has_role\(auth\.uid\(\), 'admin'/);
    expect(migration).toMatch(/collect_ads_metrics_now[\s\S]*?is_staff\(auth\.uid\(\)\)/);
  });

  it("a URL da próxima página não é guardada, só o cursor", () => {
    // O 'paging.next' da Meta vem com o token embutido: guardá-lo colocaria o
    // segredo numa tabela comum, fora do cofre.
    expect(migration).toContain("after_cursor");
    expect(migration).toContain("paging,cursors,after");
    expect(migration).not.toMatch(/INSERT[\s\S]{0,200}paging,next/);
  });

  it("guarda o dia de cada campanha, não só o total do período", () => {
    // Com o dia guardado dá para somar qualquer período depois; o contrário
    // não existe, total do mês não se divide em semanas.
    expect(migration).toContain("time_increment=1");
    expect(migration).toContain("UNIQUE (external_account_id, campaign_id, day)");
  });

  it("reaproveita o cadastro de contas que já existe", () => {
    // Sem tabela paralela: a conta de anúncio entra junto de Instagram e
    // Facebook, herdando permissão e telas.
    expect(migration).toContain("platform = 'meta_ads'");
    expect(migration).not.toMatch(/CREATE TABLE[\s\S]{0,80}public\.ads_accounts/);
  });

  it("a coleta se repete sozinha", () => {
    expect(migration).toContain("cron.schedule");
    expect(migration).toContain("ads_metrics_tick");
  });
});

describe("a área da equipe", () => {
  it("entra como rota e item de menu próprios, sem mexer nas outras", () => {
    expect(app).toContain('path="/anuncios"');
    expect(app).toContain('lazy(() => import("@/pages/AdminAds"))');
    expect(menu).toContain('{ title: "Anúncios", url: "/anuncios", icon: Megaphone }');
    // A área de métricas do Instagram continua onde estava.
    expect(app).toContain('path="/metricas"');
    expect(menu).toContain('{ title: "Métricas", url: "/metricas", icon: BarChart3 }');
  });

  it("é só da equipe", () => {
    expect(app).toMatch(/path="\/anuncios"[\s\S]{0,120}StaffRoute/);
  });

  it("mostra as duas leituras da mesma campanha", () => {
    // Ver o texto do cliente ao lado dos números de operar é o que evita o
    // relatório bonito que esconde campanha cara.
    expect(telaAdmin).toContain("Como o cliente lê");
    expect(telaAdmin).toContain("clientCampaignSentence");
    expect(telaAdmin).toContain("teamCampaignLine");
  });

  it("o campo do token não mostra o que foi digitado", () => {
    expect(telaAdmin).toMatch(/type="password"[\s\S]{0,200}setToken/);
  });

  it("só oferece cliente que contratou tráfego", () => {
    expect(telaAdmin).toContain('hasService(client, "trafego")');
  });
});

describe("o bloco do cliente", () => {
  it("entra junto dos relatórios, sem substituir", () => {
    expect(relatoriosCliente).toContain("<ClientLiveCampaigns");
    // A lista de relatórios publicados continua.
    expect(relatoriosCliente).toContain("ClientReportsGrouped");
  });

  it("some sozinho quando não há campanha, em vez de anunciar vazio", () => {
    expect(blocoCliente).toContain("if (porCampanha.length === 0) return null");
  });

  it("nenhuma sigla da Meta aparece na tela do cliente", () => {
    // O texto visível não pode conter CTR, CPC, CPM nem "impressões".
    const visivel = blocoCliente
      .split("\n")
      .filter((linha) => !linha.trim().startsWith("*") && !linha.trim().startsWith("//"))
      .join("\n");
    expect(visivel).not.toMatch(/>[^<]*\b(CTR|CPC|CPM)\b/);
    expect(visivel).not.toMatch(/Impress(ões|oes)/i);
  });

  it("cada número vem com o que ele quer dizer", () => {
    expect(blocoCliente).toContain("EXPLICACOES.investido");
    expect(blocoCliente).toContain("EXPLICACOES.alcance");
  });
});

describe("o hook de dados", () => {
  it("pede a janela que o banco realmente guarda", () => {
    // Pedir mais de 30 dias voltaria vazio e pareceria erro de conexão.
    expect(hook).toContain("dias = 30");
  });

  it("normaliza o act_ que a pessoa cola do Gerenciador", () => {
    expect(hook).toContain('replace(/^act_/i, "")');
    expect(hook).toContain("/^\\d{5,}$/");
  });
});
