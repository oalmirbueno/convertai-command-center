import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MARCADOR_AVANCOS,
  MARCADOR_CONFIRMADO,
  MARCADOR_LEITURA,
  MAX_CONFIRMACOES,
  clienteEntraNoAgente,
  comporDossie,
  fatosDoAgente,
  linhasDeConfirmacao,
  normalizarLeitura,
  normalizarPerguntas,
  secaoDaLeitura,
} from "../../supabase/functions/agente-central/regras";
import { avisoDeRepeticao, avisosDoRitual, extrasDoRitual, tarefasSugeridas } from "@/components/central/ritualAvisos";

const HUMANO = "# Contexto operacional — Verzelo\n## 1. Plano\nPoda e jardins.\n## 2. Estado atual\nCampanha rodando.";
const AVANCOS = `${MARCADOR_AVANCOS}, 25/09/2026)\n**Sexta, 25/09**\n- 10:00 · Cliente aprovou: arte`;
const leitura = normalizarLeitura({
  onde_estamos: "Campanha de primavera no ar — calendário montado.",
  fase: { nome: "Executar", motivo: "70 dias de casa", proximo_degrau: "quatro semanas fechadas" },
  o_que_andou: ["Campanha no ar"],
  pendencias: ["Três artes esperando aval"],
  proximos: [{ frente: "social", passo: "Gravar dois vídeos curtos" }, { frente: "xyz", passo: "Revisar verba" }, "Ligar para o cliente"],
  lacunas: [],
});

describe("dossiê do agente: o texto da equipe nunca se perde", () => {
  it("põe a leitura antes dos avanços automáticos, que continuam por último", () => {
    const novo = comporDossie(`${HUMANO}\n\n${AVANCOS}`, { leitura: secaoDaLeitura(leitura, new Date("2026-09-25T15:00:00Z")) });
    expect(novo.startsWith(HUMANO)).toBe(true);
    expect(novo.indexOf(MARCADOR_LEITURA)).toBeGreaterThan(novo.indexOf("Campanha rodando."));
    expect(novo.indexOf(MARCADOR_AVANCOS)).toBeGreaterThan(novo.indexOf(MARCADOR_LEITURA));
    expect(novo.trim().endsWith("Cliente aprovou: arte")).toBe(true);
    expect(novo).toContain("**Fase do método Acelera:** Executar (70 dias de casa)");
  });

  it("a leitura nova substitui a antiga e as confirmações acumulam sem repetir, até 12", () => {
    const d1 = comporDossie(`${HUMANO}\n\n${AVANCOS}`, {
      leitura: secaoDaLeitura(leitura, new Date("2026-09-18T15:00:00Z")),
      confirmacoes: linhasDeConfirmacao(new Date("2026-09-18T15:00:00Z"), ["Verba de R$ 30 por dia até 10/10."]),
    });
    const d2 = comporDossie(d1, {
      leitura: secaoDaLeitura({ ...leitura, onde_estamos: "Semana nova." }, new Date("2026-09-25T15:00:00Z")),
      confirmacoes: linhasDeConfirmacao(new Date("2026-09-25T15:00:00Z"), ["Cliente quer vídeo com a equipe."]),
    });
    expect(d2.split(MARCADOR_LEITURA).length).toBe(2);
    expect(d2).toContain("Semana nova.");
    expect(d2).not.toContain("Campanha de primavera no ar");
    expect(d2.split(MARCADOR_CONFIRMADO).length).toBe(2);
    expect(d2.indexOf("Cliente quer vídeo")).toBeLessThan(d2.indexOf("Verba de R$ 30"));
    expect(d2.startsWith(HUMANO)).toBe(true);
    expect(d2.trim().endsWith("Cliente aprovou: arte")).toBe(true);

    let d = d2;
    for (let i = 0; i < 20; i += 1) d = comporDossie(d, { confirmacoes: linhasDeConfirmacao(new Date(2026, 9, 1 + i), [`Fato ${i}.`]) });
    const linhas = d.split(MARCADOR_CONFIRMADO)[1].split(MARCADOR_AVANCOS)[0].split("\n").filter((l) => l.startsWith("- "));
    expect(linhas.length).toBe(MAX_CONFIRMACOES);
    // Sem leitura nova, a antiga fica.
    expect(d).toContain("Semana nova.");
  });

  it("dossiê sem seção de avanços também funciona", () => {
    const novo = comporDossie(HUMANO, { leitura: secaoDaLeitura(leitura, new Date()) });
    expect(novo.startsWith(HUMANO)).toBe(true);
    expect(novo).toContain(MARCADOR_LEITURA);
  });

  it("a leitura sai sem travessão e com frente fechada", () => {
    expect(leitura.onde_estamos).not.toContain("—");
    expect(leitura.proximos.map((p) => p.frente)).toEqual(["social", "geral", "geral"]);
  });
});

describe("perguntas do agente", () => {
  it("devolve no máximo duas, sem repetir, sempre como pergunta", () => {
    const p = normalizarPerguntas([
      { pergunta: "A verba de outubro já foi reposta", por_que: "muda o plano de anúncios" },
      { pergunta: "A verba de outubro já foi reposta?" },
      "O cliente aprovou o vídeo com a equipe?",
      { pergunta: "Terceira pergunta que sobra?" },
      { pergunta: "curta" },
    ]);
    expect(p.map((x) => x.pergunta)).toEqual(["A verba de outubro já foi reposta?", "O cliente aprovou o vídeo com a equipe?"]);
  });
});

describe("quem entra no Atualizar todos (régua do Ciclo)", () => {
  it("plano ativo, recorrente, fora do grupo e com projeto", () => {
    expect(clienteEntraNoAgente({ id: "a", plan_status: "active" }, true)).toBe(true);
    expect(clienteEntraNoAgente({ id: "a", plan_status: null }, true)).toBe(true);
    expect(clienteEntraNoAgente({ id: "a", plan_status: "active" }, false)).toBe(false);
    expect(clienteEntraNoAgente({ id: "a", plan_status: "paused" }, true)).toBe(false);
    expect(clienteEntraNoAgente({ id: "a", client_type: "one_off" }, true)).toBe(false);
    expect(clienteEntraNoAgente({ id: "a", services_config: { internal_company: true } }, true)).toBe(false);
    expect(clienteEntraNoAgente({ id: "a", deleted_at: "2026-01-01" }, true)).toBe(false);
  });
});

describe("fatos que o agente manda ao escritor", () => {
  it("a resposta do dono vem antes do dossiê e pergunta sem resposta fica de fora", () => {
    const f = fatosDoAgente({
      nome: "Verzelo", servicos: ["Social", "Tráfego"], dossie: HUMANO, versao: 48, leitura,
      respostas: [{ pergunta: "A verba foi reposta?", resposta: "Sim, R$ 900 até 10/10." }, { pergunta: "E o vídeo?", resposta: "" }],
      contextoExtra: "Cliente viaja semana que vem.",
    });
    expect(f.indexOf("CONFIRMADO AGORA PELO DONO")).toBeLessThan(f.indexOf("DOSSIÊ GERAL ATUAL v48"));
    expect(f).toContain("Sim, R$ 900 até 10/10.");
    expect(f).not.toContain("E o vídeo?");
    expect(f).toContain("Cliente viaja semana que vem.");
  });
});

describe("avisos do ritual na tela", () => {
  const resposta = {
    alertas: ["sem número de Instagram"],
    repeticao: { indice: 0.42, acima_do_limite: true, motivos: ["O texto está 42% parecido com o ritual de 19/09."], frases_repetidas: [{ frase: "x" }], jev: { aviso: "O Jev leu repetição (81%). Vale ajustar antes de enviar." } },
    tarefas_sugeridas: [{ titulo: "Editar vídeos", passo: "20 s", frente: "social", prazo_dias: 30 }],
    contexto: { fase: "executar" },
  };

  it("a repetição entra primeiro nos alertas, com o aviso do Jev", () => {
    const a = avisosDoRitual(resposta);
    expect(a[0]).toMatch(/^Repetição: O texto está 42% parecido/);
    expect(a[0]).toContain("Jev leu repetição");
    expect(a[1]).toBe("sem número de Instagram");
  });

  it("sem repetição, só os alertas da IA", () => {
    expect(avisoDeRepeticao({ repeticao: { acima_do_limite: false, motivos: [] } })).toBeNull();
    expect(avisosDoRitual({ alertas: ["a"] })).toEqual(["a"]);
  });

  it("guarda tarefas, repetição e fase no rascunho", () => {
    const e = extrasDoRitual(resposta);
    expect(tarefasSugeridas(resposta)[0].prazo_dias).toBe(14);
    expect(e).toMatchObject({ fase_acelera: "executar" });
    expect((e.repeticao as { indice: number }).indice).toBe(0.42);
  });
});

describe("contratos com o resto do painel", () => {
  const raiz = process.cwd();
  const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

  it("a Central monta o agente numa linha e manda client_id ao escritor", () => {
    const central = ler("src/pages/AdminExperience.tsx");
    expect(central).toContain("{!cycleReview && <AgenteDaCentral />}");
    expect(central.match(/client_id: (report\.client_id|client\.id|c\.id), /g)?.length).toBeGreaterThanOrEqual(3);
    expect(central).toContain('action: "memorizar"');
  });

  it("o agente usa o RPC de sempre do dossiê, com versão esperada, e publica pelo fluxo da Central", () => {
    const fn = ler("supabase/functions/agente-central/index.ts");
    expect(fn).toContain('db.rpc("upsert_current_dossier"');
    expect(fn).toContain("_expected_version");
    expect(fn).toContain("respostaComFolego");
    const api = ler("src/components/central/agenteCentralApi.ts");
    expect(api).toContain("persistCentralReviewDraft");
    expect(api).toContain('aprovado_via: "agente_central"');
    expect(api).toContain("marcarRitual");
  });

  it("texto de interface sem travessão", () => {
    for (const arq of ["src/components/central/AgenteDaCentral.tsx", "src/components/central/agenteCentralApi.ts", "src/components/central/ritualAvisos.ts"]) {
      expect(ler(arq)).not.toContain("—");
    }
  });
});
