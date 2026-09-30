import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A biblioteca de zip (cerca de 30 KB comprimidos) só é usada quando alguém
 * clica para baixar um pacote. Um único import no topo de um arquivo a torna
 * dependência fixa da tela: foi assim que o Kanban e a Execução passaram a
 * baixá-la ao abrir, pelo TaskDetailDrawer (PERF-B09, 30/09/2026). Todo uso
 * no painel é por `await import("jszip")`, dentro da ação.
 */

const raiz = resolve(__dirname, "..");

function arquivosDoPainel(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === "test" || nome === "node_modules") continue;
      saida.push(...arquivosDoPainel(caminho));
    } else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.(ts|tsx)$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
}

describe("jszip só sob demanda", () => {
  const fontes = arquivosDoPainel(raiz).map((caminho) => ({
    caminho: relative(raiz, caminho),
    fonte: readFileSync(caminho, "utf8"),
  }));

  it("nenhum arquivo do painel importa o jszip no topo", () => {
    const estaticos = fontes
      .filter(({ fonte }) => /^\s*import\s[^;]*from\s*["']jszip["']/m.test(fonte))
      .map(({ caminho }) => caminho);
    expect(estaticos).toEqual([]);
  });

  it("o drawer da tarefa gera o zip com import() dentro da ação", () => {
    const drawer = fontes.find(({ caminho }) => caminho.split("\\").join("/") === "components/admin/TaskDetailDrawer.tsx");
    expect(drawer?.fonte).toContain('await import("jszip")');
  });
});
