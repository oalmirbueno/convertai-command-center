import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ancorasPorDia, temPlanoVivo } from "@/lib/agendaPermanencia";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const pagina = ler("src/pages/EditorialCalendar.tsx");
const views = ler("src/components/editorial/EditorialCalendarViews.tsx");

/**
 * O relato: agendar um conteúdo pronto fazia aparecer OUTRO card no
 * calendário, em vez de o mesmo mudar de dia.
 *
 * Não havia duplicata no banco — conferido. A tela é que desenhava o mesmo
 * conteúdo duas vezes: agendar trocava a URL e NÃO relia o calendário, então
 * a cópia em cache seguia sem publicação e continuava ancorada no prazo da
 * tarefa, enquanto o agendamento novo aparecia no dia marcado.
 */

const post = (id: string, publicacoes: Array<{ scheduled_at: string | null; status: string }>) => ({
  id,
  publications: publicacoes.map((publication) => ({ publication })),
});

describe("agendado sai da âncora e vira dia de verdade", () => {
  it("publicação agendada tira o conteúdo da âncora", () => {
    const agendado = post("p1", [{ scheduled_at: "2026-08-25T10:00:00Z", status: "scheduled" }]);
    expect(temPlanoVivo(agendado)).toBe(true);
    const porDia = ancorasPorDia({
      posts: [agendado],
      tarefas: [{ id: "t1", due_date: "2026-08-20" }],
      postIdPorTarefa: { t1: "p1" },
    });
    // Ancorado E agendado seria o mesmo conteúdo em dois dias.
    expect(porDia.size).toBe(0);
  });

  it("publicado também sai da âncora", () => {
    const publicado = post("p1", [{ scheduled_at: "2026-08-18T10:00:00Z", status: "published" }]);
    expect(temPlanoVivo(publicado)).toBe(true);
  });

  it("sem publicação viva, segue ancorado", () => {
    const semPlano = post("p1", [{ scheduled_at: "2026-08-25T10:00:00Z", status: "cancelled" }]);
    expect(temPlanoVivo(semPlano)).toBe(false);
  });
});

describe("agendar relê o que decide a posição do card", () => {
  it("as três fontes são invalidadas juntas", () => {
    // Relendo só uma, a duplicata sobrevive na que ficou para trás: o
    // calendário traz as publicações, os vínculos dizem o que é âncora, e as
    // tarefas dão o dia herdado.
    const trecho = pagina.slice(pagina.indexOf("onScheduled={({"));
    for (const chave of ["editorial-calendar", "editorial-linked-task-ids", "tasks"]) {
      expect(trecho, `faltou invalidar ${chave}`).toContain(`["${chave}"]`);
    }
  });

  it("a invalidação acontece antes de mexer na URL", () => {
    const trecho = pagina.slice(pagina.indexOf("onScheduled={({"));
    expect(trecho.indexOf("invalidateQueries")).toBeLessThan(
      trecho.indexOf("new URLSearchParams"),
    );
  });
});

describe("o card conta a etapa real, não a anterior", () => {
  it("a etapa do card ancorado considera as publicações", () => {
    // Só com production_status, conteúdo já publicado seguia exibido como
    // "Pronto".
    const card = views.slice(
      views.indexOf("function AnchoredPostPill"),
      views.indexOf("function TaskSchedulePill"),
    );
    expect(card).toContain("aggregateEditorialStatus(");
    expect(card).toContain("agregado,");
  });

  it("publicado deixa de dizer que não tem agendamento", () => {
    const card = views.slice(
      views.indexOf("function AnchoredPostPill"),
      views.indexOf("function TaskSchedulePill"),
    );
    expect(card).toContain("Já publicado");
  });
});
