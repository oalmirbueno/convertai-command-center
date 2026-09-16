import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { completarProximoPasso, proximoPassoDoTexto } from "@/lib/ritualTexto";
import { applyCentralAiDraft } from "@/lib/centralReviewSource";

/**
 * O ritual escrito pela IA trazia o proximo passo DENTRO do texto e o campo
 * next_steps vazio; a revisao travava em "Proximo passo ausente" e o dono
 * nao conseguia aprovar. Agora o passo sai do proprio texto quando a IA nao
 * manda o campo, e a Central ganha o caminho curto (aprimorar, copiar,
 * registrar envio) sem a burocracia de preparar/decidir para cada mensagem.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const TEXTO = [
  "Boa tarde, Priscila. Chegamos ao meio da semana.",
  "",
  "*Onde estamos*: A campanha para o WhatsApp está ativa.",
  "",
  "*O que vem agora*: Seguimos acompanhando o desempenho da campanha e revisando os conteúdos do feed.",
  "• O foco é transformar as conversas em orçamentos reais.",
  "",
  "*Precisamos de você*: Validando até amanhã as condições dos próximos posts, as publicações entram no ar conforme o planejado.",
  "",
  "Qualquer dúvida, estamos à disposição. Tudo detalhado no painel: aceleriq.online.",
].join("\n");

describe("próximo passo extraído do texto do ritual", () => {
  it("junta os blocos 'O que vem agora' e 'Precisamos de você' e ignora o resto", () => {
    const passo = proximoPassoDoTexto(TEXTO);
    expect(passo).toContain("Seguimos acompanhando o desempenho da campanha");
    expect(passo).toContain("transformar as conversas em orçamentos reais");
    expect(passo).toContain("Validando até amanhã");
    expect(passo).not.toContain("Onde estamos");
    expect(passo).not.toContain("aceleriq.online");
  });

  it("devolve vazio quando o texto não tem bloco de próximo passo, e preserva o campo já preenchido", () => {
    expect(proximoPassoDoTexto("Só uma linha sem blocos.")).toBe("");
    expect(proximoPassoDoTexto(null)).toBe("");
    expect(completarProximoPasso("Já combinado: aprovar as artes.", TEXTO)).toBe("Já combinado: aprovar as artes.");
    expect(completarProximoPasso("   ", TEXTO)).toContain("Seguimos acompanhando");
  });

  it("o rascunho da IA nunca nasce sem próximo passo quando o texto o contém", () => {
    const draft = { summary: "", next_steps: "", title: "t", metrics: {} as Record<string, unknown> };
    const aplicado = applyCentralAiDraft(draft, { body: TEXTO, title: "Meio da semana" });
    expect(aplicado.next_steps).toContain("Seguimos acompanhando");
    expect(aplicado.metrics?.central_review_next_steps_required).toBe(false);
    const explicito = applyCentralAiDraft(draft, { body: TEXTO, next_steps: "Aprovar até quarta." });
    expect(explicito.next_steps).toBe("Aprovar até quarta.");
  });
});

describe("a Central encurta o caminho e o Hermes fica com a revisão formal", () => {
  const central = ler("src/pages/AdminExperience.tsx");
  const escritor = ler("supabase/functions/ritual-writer/index.ts");
  const migracao = ler("supabase/migrations/20260916150000_acoes_feitas_entram_no_dossie.sql");

  it("a fila da Central lista todos os rascunhos e oferece aprimorar, copiar, registrar envio e publicar", () => {
    expect(central).not.toContain("draftReports.filter((r) => !r.metrics?.central_review_source");
    expect(central).toContain("Aprimorar com IA");
    expect(central).toContain("Copiar para o grupo");
    expect(central).toContain("Enviei no grupo");
    expect(central).toContain("Publicar no portal");
    expect(central).toContain('publishDraft(r, "grupo")');
  });

  it("a revisão formal só aparece na Central por link de pedido; a área do Hermes é Ciclo › Revisão", () => {
    expect(central).toContain('(cycleReview || new URLSearchParams(location.search).has("review")) && (');
  });

  it("o escritor aceita o texto atual para aprimorar e devolve next_steps separado", () => {
    expect(escritor).toContain("body?.improve");
    expect(escritor).toContain("TEXTO ATUAL (aprimorar e complementar");
    expect(escritor).toContain('"next_steps":"..."');
    expect(escritor).toContain("next_steps: nextSteps");
  });

  it("o cartão dos rituais não é esticado no celular", () => {
    expect(central).toContain("lista-longa grid gap-4 lg:auto-rows-fr lg:grid-cols-2");
    expect(central).not.toContain("lista-longa grid gap-4 auto-rows-fr");
  });

  it("ação feita entra no diário e no dossiê; ritual enviado marca o Ciclo", () => {
    expect(migracao).toContain("AFTER UPDATE OF status ON public.tasks");
    expect(migracao).toContain("'acao', 'ciclo'");
    expect(migracao).toContain("PERFORM public.dossie_registrar_avancos(_client);");
    expect(migracao).toContain("**Ações feitas na esteira e no ciclo:**");
    expect(migracao).toContain("AFTER UPDATE OF executed_at ON public.operator_approvals");
    expect(migracao).toContain("INSERT INTO public.cycle_rituals");
    expect(migracao).toContain("WHEN 'rota_semana' THEN 'segunda' WHEN 'meio_semana' THEN 'quarta' WHEN 'prova_movimento' THEN 'sexta'");
  });
});
