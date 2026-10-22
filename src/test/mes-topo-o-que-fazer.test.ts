import { describe, expect, it } from "vitest";
import { datasDasProximasSemanas, separarPeloNicho } from "@/components/mesa/datasDoHype";
import { diasSemPost, nichoCurto, resumoDoMes, sugestaoDasDatas, sugestoesDoMes } from "@/components/mesa/oQueFazerAgora";

const HOJE = "2026-10-21";
const principais = separarPeloNicho(datasDasProximasSemanas(HOJE), null, "Odontologia").principais;

describe("O que fazer agora (montado do que já existe, com a fonte)", () => {
  it("Datas: a data do nicho aquecendo vira 'crie a campanha', com a data junto para a semente", () => {
    const s = sugestaoDasDatas(principais, HOJE)!;
    expect(s.fonte).toBe("datas");
    expect(s.acao).toBe("campanha");
    // Dia do Dentista (pico 25/10) aquece desde 18/10 e é do nicho de Odontologia; o mês temático em andamento não conta.
    expect(s.texto).toBe("Dia do Dentista já está aquecendo (pico 25/10): crie a campanha");
    expect(s.data!.id).toBe("dia-do-dentista");
  });

  it("Datas: sem nada aquecendo, a que começa a aquecer em até 7 dias", () => {
    const s = sugestaoDasDatas(separarPeloNicho(datasDasProximasSemanas("2026-10-26"), null, "Moda").principais.filter((d) => d.id !== "halloween" && d.id !== "novembro-azul"), "2026-10-26")!;
    expect(s.texto).toBe("Black Friday aquece em 2 dias: crie a campanha");
  });

  it("Calendário: dias úteis sem post na próxima semana, só dentro do mês", () => {
    expect(diasSemPost(["2026-10-26", "2026-10-28"], "2026-10-01", HOJE)).toEqual(["2026-10-27", "2026-10-29", "2026-10-30"]);
    expect(diasSemPost([], "2026-09-01", HOJE)).toEqual([]);
    // Mês futuro: a 1ª semana cheia do mês.
    expect(diasSemPost([], "2026-11-01", HOJE)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  });

  it("até 3 sugestões, uma por fonte, cada uma com a ação direta", () => {
    const s = sugestoesDoMes({ hoje: HOJE, mes: "2026-10-01", principais, noticiasQueServem: 2, emAltaNoNicho: 4, leituraDaSemana: true, datasComPost: ["2026-10-26"] });
    expect(s.map((x) => x.fonte)).toEqual(["datas", "em-alta", "calendario"]);
    expect(s[1].texto).toBe("2 notícias do nicho servem agora");
    expect(s[2].texto).toBe("4 dias úteis sem post na próxima semana");
    // Sem notícias buscadas: o que a leitura da semana achou no nicho.
    const t = sugestoesDoMes({ hoje: HOJE, mes: "2026-10-01", principais: [], noticiasQueServem: null, emAltaNoNicho: 3, leituraDaSemana: true, datasComPost: null });
    expect(t.map((x) => x.texto)).toEqual(["3 assuntos em alta no nicho esta semana"]);
    // Sem leitura da semana: convida a buscar.
    expect(sugestoesDoMes({ hoje: HOJE, mes: "2026-10-01", principais: [], noticiasQueServem: null, emAltaNoNicho: 0, leituraDaSemana: false, datasComPost: null })[0].acao).toBe("abrir-semana");
  });

  it("resumo de uma linha e o nicho curto", () => {
    expect(resumoDoMes({ posts: 12, datas: 3, emAlta: 5 })).toBe("12 posts planejados · 3 datas no radar · 5 em alta no nicho");
    expect(resumoDoMes({ posts: null, datas: 1, emAlta: 0 })).toBe("1 data no radar");
    expect(nichoCurto("Odontologia", "Clínica")).toBe("Odontologia");
    expect(nichoCurto(null, "Clínica odontológica de estética em Curitiba, com foco em lentes")).toBe("Clínica odontológica de estética");
    expect(nichoCurto(null, null)).toBe("");
  });
});
