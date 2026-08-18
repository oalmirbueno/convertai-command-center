import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MEMORY_LABELS } from "@/lib/clientMemory";

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");

const feed = ler("src/hooks/useRecentActivity.ts");
const dashboard = ler("src/pages/AdminDashboard.tsx");
const layout = ler("src/components/AppLayout.tsx");
const studio = ler("src/components/workspace/StudioPanel.tsx");
const central = ler("src/pages/AdminExperience.tsx");
const servicos = ler("supabase/functions/_shared/aceleriq-read-services.ts");
const mcp = ler("supabase/functions/_shared/mcp-tools.ts");

/**
 * O pedido era que as áreas parassem de ser ilhas: o que acontece numa
 * precisa aparecer nas outras, senão informação se perde. Estes testes
 * guardam cada ponte construída.
 */

describe("as atualizações recentes enxergam o painel inteiro", () => {
  it("lê as duas fontes: updates de projeto e memória do cliente", () => {
    // Só os updates apareciam; ritual, entrega, avulso e decisão ficavam
    // invisíveis, e o painel mostrava menos movimento do que houve.
    expect(feed).toContain('.from("updates")');
    expect(feed).toContain('.from("project_memory")');
  });

  it("uma fonte com erro não derruba o feed inteiro", () => {
    expect(feed).toContain("Promise.all");
    expect(feed).toContain("updatesRes.data || []");
  });

  it("ordena tudo pelo relógio, não por fonte", () => {
    expect(feed).toContain("localeCompare");
  });

  it("registro sem título não vira linha vazia no feed", () => {
    expect(feed).toMatch(/filter\(\(m: any\) => String\(m\.title \|\| ""\)\.trim\(\)\)/);
  });

  it("o dashboard passou a usar o feed unificado", () => {
    expect(dashboard).toContain("useRecentActivity");
    expect(dashboard).toContain("loadingActivity");
  });

  it("o alinhamento do mobile foi corrigido na linha longa", () => {
    // O ponto colorido desalinhava quando o texto quebrava em duas linhas.
    expect(dashboard).toContain("mt-[7px] h-1.5 w-1.5 shrink-0");
    expect(dashboard).toContain("break-words");
  });

  it("cada tipo de registro tem nome em português", () => {
    for (const kind of ["avulso", "entrega", "ritual", "second_brain", "checklist"]) {
      expect(MEMORY_LABELS[kind]).toBeTruthy();
    }
  });
});

describe("o menu ficou organizado", () => {
  it("os itens do admin viraram grupos por tema", () => {
    expect(layout).toContain("adminMoreGroups");
    for (const grupo of ["Operação da semana", "Resultados", "Gestão", "Sistema"]) {
      expect(layout).toContain(grupo);
    }
  });

  it("o Quiz saiu do menu sem a rota morrer", () => {
    expect(layout).not.toContain("Quiz Submissions");
    expect(ler("src/App.tsx")).toContain('path="/admin/quiz"');
  });

  it("a lista plana continua existindo para o menu do celular", () => {
    expect(layout).toContain("adminMoreNav: NavItem[] = adminMoreGroups.flatMap");
  });
});

describe("o Studio deixou de ser ilha", () => {
  it("publicar documento entra na história do cliente", () => {
    expect(studio).toContain("recordMemory");
    expect(studio).toContain('source: "studio"');
  });

  it("só a publicação vira memória, não cada tecla digitada", () => {
    // Gravar a cada letra encheria a história de ruído.
    expect(studio).toMatch(/async function togglePublish[\s\S]{0,2600}recordMemory/);
  });
});

describe("a Central lê tudo que existe", () => {
  it("puxa a memória de todos os clientes ao vivo", () => {
    expect(central).toContain('queryKey: ["exp-memory"]');
    expect(central).toContain('.from("project_memory")');
  });

  it("puxa as campanhas reais para falar de anúncio com número", () => {
    expect(central).toContain("useAdsDaily");
    expect(central).toContain("useAdsCampaigns");
  });

  it("a mensagem do grupo delega para a biblioteca testada", () => {
    expect(central).toContain("buildGroupMessageText");
    // E não sobrou a montagem antiga, que dava o mesmo corpo aos três momentos.
    expect(central).not.toContain("Passando para contar como está a semana");
  });

  it("usa o avulso e a etapa do ciclo daquela semana", () => {
    expect(central).toContain("avulsosFeitos");
    expect(central).toContain("stepLabelsForWeek");
  });
});

describe("o dossiê do MCP entrega resultado, não só trabalho", () => {
  it("inclui Instagram, publicações e campanhas", () => {
    expect(servicos).toContain("instagram: await listSocialMetrics");
    expect(servicos).toContain("instagram_posts: await listSocialPosts");
    expect(servicos).toContain("ads: await listAdsPerformance");
  });

  it("uma métrica indisponível não derruba o dossiê inteiro", () => {
    expect(servicos).toMatch(/listSocialMetrics\([\s\S]{0,80}\.catch\(\(\) => null\)/);
    expect(servicos).toMatch(/listAdsPerformance\([\s\S]{0,200}\.catch\(\(\) => null\)/);
  });

  it("a descrição avisa o agente que os números estão lá", () => {
    expect(mcp).toContain("NÚMEROS REAIS do Instagram");
  });

  it("a versão subiu nos dois lugares", () => {
    expect(mcp).toMatch(/version: '1\.14\.\d+'/);
    expect(ler("supabase/functions/mcp-oauth-metadata/index.ts")).toMatch(/1\.14\.\d+/);
  });
});
