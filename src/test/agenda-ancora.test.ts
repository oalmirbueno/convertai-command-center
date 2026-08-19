import { describe, expect, it } from "vitest";
import { ancorasPorDia, idsAncorados, temPlanoVivo } from "@/lib/agendaPermanencia";

/**
 * Os cinco conteúdos que o dono viu sumir, com os dados reais do banco:
 * arte vinculada, production_status "ready", ligados a uma tarefa com prazo,
 * e ZERO publicações. Sem publicação não há scheduled_at, e sem scheduled_at
 * o post não tem dia nenhum na grade — ele desaparecia no instante em que
 * ganhava a arte.
 */
const REAIS = [
  { post: "5faff526", task: "3aa32098", due: "2026-08-25", titulo: "Do Olhar ao Acabamento" },
  { post: "12f213ec", task: "afe635a8", due: "2026-08-21", titulo: "Poda em Curitiba" },
  { post: "872dee32", task: "6c98e9df", due: "2026-08-18", titulo: "Manutenção/Revitalização" },
  { post: "fb67215d", task: "66c44463", due: "2026-08-14", titulo: "Sua área externa" },
  { post: "2bd4da90", task: "f565286a", due: "2026-08-20", titulo: "Seu vizinho vai agradecer" },
];

const semPublicacao = (id: string) => ({ id, publications: [] });
const postIdPorTarefa = Object.fromEntries(REAIS.map((r) => [r.task, r.post]));
const tarefas = REAIS.map((r) => ({ id: r.task, due_date: r.due }));
const posts = REAIS.map((r) => semPublicacao(r.post));

describe("os cinco que sumiram voltam para o dia deles", () => {
  it("cada um cai no prazo da tarefa de origem", () => {
    const porDia = ancorasPorDia({ posts, tarefas, postIdPorTarefa });
    for (const r of REAIS) {
      expect(porDia.get(r.due), `${r.titulo} deveria estar em ${r.due}`).toContain(r.post);
    }
    expect(idsAncorados(porDia).size).toBe(5);
  });

  it("prazo com horário junto ainda cai no dia certo", () => {
    const porDia = ancorasPorDia({
      posts: [semPublicacao("p1")],
      tarefas: [{ id: "t1", due_date: "2026-08-20T14:30:00Z" }],
      postIdPorTarefa: { t1: "p1" },
    });
    expect(porDia.get("2026-08-20")).toEqual(["p1"]);
  });
});

describe("o que já tem dia próprio não é ancorado de novo", () => {
  it("publicação agendada e viva manda no dia", () => {
    const comPlano = {
      id: "p1",
      publications: [{ publication: { scheduled_at: "2026-08-30T10:00:00Z", status: "scheduled" } }],
    };
    expect(temPlanoVivo(comPlano)).toBe(true);
    const porDia = ancorasPorDia({
      posts: [comPlano],
      tarefas: [{ id: "t1", due_date: "2026-08-20" }],
      postIdPorTarefa: { t1: "p1" },
    });
    // Ancorar aqui desenharia o MESMO conteúdo em dois dias diferentes.
    expect(porDia.size).toBe(0);
  });

  it("plano só com publicação cancelada volta a ser ancorado", () => {
    // Cancelar um agendamento não pode fazer o conteúdo sumir da tela.
    const soCancelada = {
      id: "p1",
      publications: [{ publication: { scheduled_at: "2026-08-30T10:00:00Z", status: "cancelled" } }],
    };
    expect(temPlanoVivo(soCancelada)).toBe(false);
    const porDia = ancorasPorDia({
      posts: [soCancelada],
      tarefas: [{ id: "t1", due_date: "2026-08-20" }],
      postIdPorTarefa: { t1: "p1" },
    });
    expect(porDia.get("2026-08-20")).toEqual(["p1"]);
  });

  it("publicação sem data não conta como plano vivo", () => {
    const semData = {
      id: "p1",
      publications: [{ publication: { scheduled_at: null, status: "scheduled" } }],
    };
    expect(temPlanoVivo(semData)).toBe(false);
  });
});

describe("a âncora não passa por cima do que a tela decidiu esconder", () => {
  it("post filtrado da tela não volta pelas costas do filtro", () => {
    // Se o conteúdo foi cortado por formato, status ou busca, ancorá-lo aqui
    // o traria de volta contrariando o filtro que a pessoa escolheu.
    const porDia = ancorasPorDia({
      posts: [],
      tarefas: [{ id: "t1", due_date: "2026-08-20" }],
      postIdPorTarefa: { t1: "p-invisivel" },
    });
    expect(porDia.size).toBe(0);
  });

  it("tarefa sem prazo válido não inventa dia", () => {
    for (const due of [null, "", "amanhã", "2026-13-45x"]) {
      const porDia = ancorasPorDia({
        posts: [semPublicacao("p1")],
        tarefas: [{ id: "t1", due_date: due as string | null }],
        postIdPorTarefa: { t1: "p1" },
      });
      expect(porDia.size, `due_date ${JSON.stringify(due)}`).toBe(0);
    }
  });

  it("duas tarefas para o mesmo conteúdo não o desenham duas vezes", () => {
    const porDia = ancorasPorDia({
      posts: [semPublicacao("p1")],
      tarefas: [
        { id: "t1", due_date: "2026-08-20" },
        { id: "t2", due_date: "2026-08-20" },
      ],
      postIdPorTarefa: { t1: "p1", t2: "p1" },
    });
    expect(porDia.get("2026-08-20")).toEqual(["p1"]);
  });

  it("conteúdo sem tarefa nenhuma não ganha dia inventado", () => {
    const porDia = ancorasPorDia({
      posts: [semPublicacao("orfao")],
      tarefas: [],
      postIdPorTarefa: {},
    });
    expect(porDia.size).toBe(0);
  });
});
