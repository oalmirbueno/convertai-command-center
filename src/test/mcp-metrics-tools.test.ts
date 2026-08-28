import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");

const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const servicos = ler("supabase/functions/_shared/aceleriq-metrics-services.ts");
const seguranca = ler("supabase/functions/_shared/mcp-security.ts");

/**
 * O MCP conhecia o TRABALHO (projetos, tarefas, ciclo, arquivos) e não conhecia
 * o RESULTADO dele: um agente externo conseguia dizer o que a equipe fez na
 * semana e não conseguia dizer se funcionou. Estas quatro ferramentas fecham
 * isso — e estes testes guardam o que não pode escorregar junto.
 */

const NOVAS = [
  "aceleriq_get_social_metrics",
  "aceleriq_list_social_posts",
  "aceleriq_get_ads_campaigns",
  "aceleriq_get_ads_performance",
];

describe("as ferramentas de resultado existem e estão ligadas", () => {
  it("as quatro estão declaradas e registradas", () => {
    for (const nome of NOVAS) {
      expect(tools).toContain(`name: '${nome}'`);
    }
    for (const registro of [
      "getSocialMetricsTool",
      "listSocialPostsTool",
      "getAdsCampaignsTool",
      "getAdsPerformanceTool",
    ]) {
      // Declarar sem registrar é o erro silencioso: a ferramenta existe no
      // arquivo e nunca aparece em tools/list.
      expect(tools.split(registro).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("cada uma exige permissão de leitura de relatório", () => {
    for (const nome of NOVAS) {
      expect(tools).toContain(`${nome}: 'reports:read'`);
    }
  });

  it("cobrem social e ads, com histórico dos dois", () => {
    expect(servicos).toContain("social_metrics_weekly");
    expect(servicos).toContain("social_post_metrics");
    expect(servicos).toContain("ads_campaigns");
    expect(servicos).toContain("ads_campaign_daily");
  });

  it("a versão do servidor não regride abaixo da que trouxe estas ferramentas", () => {
    // Cliente MCP guarda a lista de ferramentas em cache; sem versão nova, o
    // conector continua mostrando as antigas. Fixar o número exato, porém, faz
    // este teste quebrar em toda entrega seguinte sem apontar defeito nenhum —
    // o que interessa é não voltar atrás de 1.12.0, quando elas nasceram.
    const declarada = tools.match(/version: '(\d+)\.(\d+)\.(\d+)'/);
    expect(declarada).toBeTruthy();
    const [maior, menor] = [Number(declarada![1]), Number(declarada![2])];
    expect(maior > 1 || (maior === 1 && menor >= 12)).toBe(true);
  });
});

describe("as contas que o agente erraria sozinho já vêm prontas", () => {
  it("a variação entre semanas é calculada aqui", () => {
    // A lista vem da mais recente para a mais antiga; calculada por fora, a
    // ordem se inverte e vira queda onde houve crescimento.
    expect(servicos).toContain("change_pct");
    expect(servicos).toMatch(/comValor\[1\]\[campo\]/);
  });

  it("alcance de campanha não é somado entre dias", () => {
    // A mesma pessoa alcançada em dois dias não são duas pessoas.
    expect(servicos).toContain("alcance = Math.max(alcance");
    expect(servicos).not.toMatch(/alcance \+= /);
  });

  it("o aviso sobre alcance está na descrição que o agente lê", () => {
    expect(tools).toMatch(/alcance NÃO se soma entre dias/);
  });

  it("o resultado por tipo vem cru, porque quem decide é o objetivo", () => {
    expect(servicos).toContain("results_by_type");
  });
});

describe("a fronteira entre clientes continua fechada", () => {
  it("as novas ferramentas NÃO entram na lista de acesso restrito", () => {
    // Elas aceitam client_id opcional: sem ele, leem a carteira inteira. Entrar
    // nesta lista abriria leitura entre clientes para um principal restrito.
    // Quem tem escopo irrestrito continua usando normalmente.
    for (const nome of NOVAS) {
      expect(seguranca).not.toContain(`'${nome}'`);
    }
  });

  it("a regra que nega por padrão continua de pé", () => {
    expect(seguranca).toContain("CLIENT_SCOPED_LEGACY_TOOL_SET.has(toolName)");
    expect(seguranca).toMatch(/denied by default/i);
  });

  it("client_id, quando vem, é validado como UUID", () => {
    // O número acompanha os serviços que aceitam client_id. Subiu para 5
    // quando entrou a leitura de criativos, que também valida. A regra que
    // este teste guarda não é o número: é que NENHUM serviço com client_id
    // fique sem validação. Por isso a contagem é comparada com quantos
    // realmente recebem o parâmetro, e não com um número solto.
    const queRecebem = servicos.match(/client_id\?:\s*string/g)?.length ?? 0;
    const queValidam = servicos.match(/client_id must be a UUID/g)?.length ?? 0;
    expect(queValidam).toBe(5);
    expect(queValidam).toBeGreaterThanOrEqual(queRecebem);
  });
});
