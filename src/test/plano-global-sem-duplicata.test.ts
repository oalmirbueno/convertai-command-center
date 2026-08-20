import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const hook = ler("src/hooks/useEditorialCalendar.ts");
const pagina = ler("src/pages/EditorialCalendar.tsx");
const views = ler("src/components/editorial/EditorialCalendarViews.tsx");

/**
 * O card em DUAS datas, explicado: a tela carrega só as publicações do mês
 * visível. Um conteúdo agendado para OUTRO mês parecia "sem plano" — seguia
 * ancorado no prazo da tarefa (e no backlog) e ainda aparecia no dia
 * agendado quando aquele mês era aberto. O publicado fora do recorte seguia
 * pintado de "Pronto". A decisão "tem plano? já saiu?" agora vem do plano
 * INTEIRO, sem recorte.
 */

describe("o estado do plano é global, não do mês visível", () => {
  it("a consulta de presença carrega status e data", () => {
    expect(hook).toContain('select("id, post_id, status, scheduled_at")');
  });

  it("o bundle expõe os dois fatos que as telas precisam", () => {
    expect(hook).toContain("temPlanoVivoGlobal: boolean;");
    expect(hook).toContain("publicadoGlobal: boolean;");
  });

  it("sem recorte (quadro, detalhe), o local É o global", () => {
    // Board e detalhe carregam tudo; cair no set global vazio os quebraria.
    expect(hook).toContain("? postIdsComPlanoVivoGlobal.has(post.id)");
    expect(hook).toContain(": vivoLocal");
  });
});

describe("agendado aparece numa data só", () => {
  it("a âncora corta pelo estado global", () => {
    expect(pagina).toContain(".filter((bundle) => !bundle.temPlanoVivoGlobal)");
  });

  it("o backlog não lê publicação de outro mês como plano inexistente", () => {
    expect(views).toContain("if (post.temPlanoVivoGlobal) return [];");
  });
});
