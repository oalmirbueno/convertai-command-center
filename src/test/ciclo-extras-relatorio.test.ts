import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extraAreas, inCycle } from "@/lib/cycleExtras";

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");

const extras = ler("src/lib/cycleExtras.ts");
const ciclo = ler("src/pages/AdminCiclo.tsx");
const folha = ler("src/components/ciclo/ClientCycleSheet.tsx");
const criarRelatorio = ler("src/pages/AdminReportCreate.tsx");
const listaRelatorios = ler("src/pages/AdminReports.tsx");
const anuncios = ler("src/pages/AdminAds.tsx");
const servicos = ler("supabase/functions/_shared/aceleriq-read-services.ts");
const mcp = ler("supabase/functions/_shared/mcp-tools.ts");

/**
 * Quatro pedidos deste lote, e o que cada teste guarda:
 * incluir cliente sem mexer no contrato, avulsos entrando na história,
 * relatório conversando com a Central, e o de anúncios nascendo em Anúncios.
 */

describe("incluir cliente no ciclo sem mexer no contrato", () => {
  const contratou = (client: unknown, area: "social" | "trafego") =>
    (client as { services_config?: Record<string, unknown> })?.services_config?.[area] === true;

  it("quem contratou continua entrando", () => {
    expect(inCycle({ services_config: { social: true } }, "social", contratou)).toBe(true);
  });

  it("quem foi incluído à mão entra sem ter contratado", () => {
    const cliente = { services_config: { ciclo_extra: ["trafego"] } };
    expect(inCycle(cliente, "trafego", contratou)).toBe(true);
    // E continua fora da frente que ninguém pediu.
    expect(inCycle(cliente, "social", contratou)).toBe(false);
  });

  it("a inclusão é separada do serviço contratado", () => {
    // Marcar o serviço no cadastro para ver o cliente no ciclo mexeria em
    // cobrança, ritual e MRR. Por isso a chave é outra.
    expect(extras).toContain("ciclo_extra");
    expect(extras).toMatch(/sem tocar no serviço contratado/i);
  });

  it("gravar preserva o resto da configuração do cliente", () => {
    // services_config guarda caixas do financeiro e histórico de pulso:
    // sobrescrever o objeto apagaria o que não é nosso.
    expect(extras).toContain("...config,");
    expect(extras).toContain('.select("services_config")');
  });

  it("lida com cadastro sem a chave e com valor inválido", () => {
    expect(extraAreas(null)).toEqual([]);
    expect(extraAreas({ services_config: { ciclo_extra: "social" } })).toEqual([]);
    expect(extraAreas({ services_config: { ciclo_extra: ["social", "xpto"] } })).toEqual(["social"]);
  });

  it("os nomes de quem está fora só entram na tela quando o painel abre", () => {
    // Soltos, se misturariam com a lista do ciclo e dariam a impressão de que
    // o cliente já está na frente.
    expect(ciclo).toContain("abrirInclusao &&");
  });
});

describe("avulsos da semana", () => {
  it("são por cliente, frente e semana", () => {
    // O que foi feito de tráfego numa semana não pode aparecer no social da
    // seguinte.
    expect(extras).toContain('.eq("metadata->>area", area)');
    expect(extras).toContain('.eq("metadata->>week_start", weekStart)');
  });

  it("nascem na história do cliente, que é o que a Central lê", () => {
    expect(extras).toContain('from("project_memory")');
    expect(extras).toContain('kind: KIND');
  });

  it("marcar reescreve o corpo, não só a marcação", () => {
    // É o corpo que a IA lê: só mudar a marcação deixaria o histórico dizendo
    // que o trabalho não aconteceu.
    expect(extras).toMatch(/content: done\s*\?/);
  });

  it("ficam internos: bastidor de operação não é material para o cliente", () => {
    expect(extras).toContain("client_visible: false");
  });

  it("entram na mensagem que o cliente recebe", () => {
    expect(folha).toContain("avulsosFeitos: avulsos.filter((item) => item.done)");
  });

  it("a folha recarrega a história ao somar um avulso", () => {
    expect(folha).toContain("recarregarHistoria()");
  });
});

describe("relatório conversa com a Central e o ciclo", () => {
  it("publicar pela tela de criação registra a entrega", () => {
    expect(criarRelatorio).toContain('kind: "entrega"');
    expect(criarRelatorio).toContain('source: "relatorio"');
  });

  it("publicar pela lista registra igual", () => {
    // São o mesmo fato; registrar só de um lado deixaria a Central escrevendo
    // o ritual sem saber que houve entrega.
    expect(listaRelatorios).toContain('kind: "entrega"');
    expect(listaRelatorios).toContain("recordMemory");
  });

  it("leva o combinado de próximos passos junto", () => {
    expect(criarRelatorio).toContain("Próximos passos combinados");
  });

  it("a memória do cliente é recarregada nos dois caminhos", () => {
    expect(criarRelatorio).toContain('queryKey: ["memoria-cliente"]');
    expect(listaRelatorios).toContain('queryKey: ["memoria-cliente"]');
  });
});

describe("o relatório de anúncios nasce em Anúncios", () => {
  it("a área de anúncios gera o relatório já preenchido", () => {
    expect(anuncios).toContain("gerarRelatorio");
    expect(anuncios).toContain("/relatorios/novo?");
  });

  it("os números vão nos nomes que o relatório entende", () => {
    expect(anuncios).toContain("ad_spend");
    expect(criarRelatorio).toContain('params.get("metricas")');
  });

  it("o resumo enviado é o texto do cliente, sem jargão", () => {
    expect(anuncios).toContain("clientCampaignLine");
  });

  it("Relatórios aponta para a área nova em vez de pedir planilha", () => {
    expect(listaRelatorios).toContain('navigate("/anuncios")');
    // E o de entrega continua sendo criado de lá.
    expect(listaRelatorios).toContain('navigate("/relatorios/novo")');
  });

  it("pré-preenchimento inválido não derruba a tela", () => {
    expect(criarRelatorio).toMatch(/catch\s*\{\s*return \{\};/);
  });
});

describe("o MCP enxerga o que foi criado", () => {
  it("o ciclo devolve os avulsos junto das etapas", () => {
    expect(servicos).toContain("extras:");
    expect(servicos).toContain("extras_done:");
    expect(servicos).toContain("'avulso'");
  });

  it("a descrição avisa o agente que os avulsos existem", () => {
    expect(mcp).toMatch(/avulsos \(extras\)/);
  });

  it("a memória aceita os tipos novos", () => {
    expect(mcp).toContain("'avulso','checklist'");
  });

  it("a versão não regride abaixo da que trouxe os avulsos, e os dois lugares batem", () => {
    // Fixar o número exato faz este teste quebrar em toda entrega seguinte sem
    // apontar defeito. O que importa: não voltar atrás de 1.13.0 e as duas
    // declarações da versão andarem juntas.
    const naFerramenta = mcp.match(/version: '(\d+)\.(\d+)\.(\d+)'/);
    const noMetadata = ler("supabase/functions/mcp-oauth-metadata/index.ts")
      .match(/MCP_VERSION = '(\d+\.\d+\.\d+)'/);
    expect(naFerramenta).toBeTruthy();
    expect(noMetadata).toBeTruthy();
    // As duas declarações da versão precisam andar juntas: quando divergiram,
    // o conector continuou anunciando ferramenta que já tinha mudado de forma.
    expect(noMetadata![1]).toBe(
      `${naFerramenta![1]}.${naFerramenta![2]}.${naFerramenta![3]}`,
    );
    const [maior, menor] = [Number(naFerramenta![1]), Number(naFerramenta![2])];
    expect(maior > 1 || (maior === 1 && menor >= 13)).toBe(true);
  });
});
