import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { completarProximoPasso, estruturaDoRitual, proximoPassoDoTexto, resumoDoRitual } from "@/lib/ritualTexto";
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

describe("o portal do cliente mostra o ritual organizado, não o texto do WhatsApp", () => {
  it("separa abertura, blocos e despedida, e tira o 'tudo detalhado no painel'", () => {
    const e = estruturaDoRitual(TEXTO);
    expect(e.abertura).toBe("Boa tarde, Priscila. Chegamos ao meio da semana.");
    expect(e.blocos.map((b) => b.titulo)).toEqual(["Onde estamos", "O que vem agora", "Precisamos de você"]);
    expect(e.blocos[1].linhas).toHaveLength(2);
    expect(e.blocos[1].linhas[1]).toBe("O foco é transformar as conversas em orçamentos reais.");
    expect(e.fechamento).toBe("Qualquer dúvida, estamos à disposição.");
    expect(JSON.stringify(e)).not.toContain("*");
  });

  it("o resumo do cartão termina em palavra inteira e nunca traz asterisco", () => {
    const resumo = resumoDoRitual(TEXTO, 80);
    expect(resumo.length).toBeLessThanOrEqual(81);
    expect(resumo.endsWith("…")).toBe(true);
    expect(resumo).not.toContain("*");
    expect(resumo).toContain("Boa tarde, Priscila.");
    // Texto sem formato continua funcionando como antes.
    expect(estruturaDoRitual("Só uma linha.").blocos).toHaveLength(0);
    expect(estruturaDoRitual("Só uma linha.").abertura).toBe("Só uma linha.");
  });

  it("as três áreas do portal e o relatório completo usam o renderizador estruturado", () => {
    const atualizacoes = ler("src/pages/ClientJourneyUpdates.tsx");
    const painel = ler("src/components/client/ClientJourneyDashboard.tsx");
    const relatorio = ler("src/pages/ReportDetail.tsx");
    const leitura = ler("src/components/reports/ClientPlainSummary.tsx");
    expect(atualizacoes).toContain("<RitualEstruturado body={update.summary} nextSteps={update.next_steps} compact={!isLatest}");
    expect(atualizacoes).toContain("<RitualEstruturado body={entry.content} compact");
    expect(atualizacoes).not.toContain("entry.content.slice(0, 320)}...");
    expect(painel).toContain("resumoDoRitual(latestReport.summary, 260)");
    expect(painel).not.toContain("line-clamp-4 whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground\">{latestReport.summary}");
    expect(relatorio).toContain("<RitualEstruturado body={report.summary} nextSteps={report.next_steps} />");
    expect(leitura).toContain("RitualEstruturado");
  });
});

describe("a Central encurta o caminho e o Hermes fica com a revisão formal", () => {
  const central = ler("src/pages/AdminExperience.tsx");
  // O prompt mora em escritor.ts; o handler (improve, next_steps) em index.ts.
  const escritor = ler("supabase/functions/ritual-writer/index.ts") + "\n" + ler("supabase/functions/ritual-writer/escritor.ts");
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

  it("a IA fala com a pessoa pelo nome, em linguagem simples, e sempre mostra o avanço", () => {
    expect(escritor).toContain("15. NOME E PESSOA");
    expect(escritor).toContain("16. LINGUAGEM SIMPLES, SEM TERMO TÉCNICO");
    expect(escritor).toContain("17. AVANÇO SEMPRE VISÍVEL");
    expect(escritor).toContain("PESSOA DE CONTATO (abra a mensagem com este primeiro nome)");
    // O painel manda o primeiro nome da pessoa e a ultima mensagem enviada.
    expect(central).toContain("const nomeDoContato = (client: any): string =>");
    expect(central.match(/contact_name: nomeDoContato\(/g)?.length).toBe(3);
    expect(central).toContain("ÚLTIMA MENSAGEM ENVIADA AO CLIENTE (");
  });

  it("depois de gerar, a fila abre com a primeira mensagem expandida e dá para copiar da prévia", () => {
    expect(central).toContain('setActiveTab("fila");');
    expect(central).toContain("if (primeiroCriado) setExpandedDraft(primeiroCriado);");
    expect(central).toContain("Mensagem de ${preview.clientName} copiada.");
  });

  it("o escritor aceita o texto atual para aprimorar e devolve next_steps separado", () => {
    expect(escritor).toContain("body?.improve");
    expect(escritor).toContain("TEXTO ATUAL (aprimorar e complementar");
    expect(escritor).toContain('"next_steps":"..."');
    expect(escritor).toContain("next_steps: nextSteps");
  });

  it("o cartão dos rituais não é esticado no celular", () => {
    expect(central).toContain('className="grid gap-4 lg:auto-rows-fr lg:grid-cols-2 xl:gap-5"');
    expect(central).not.toContain("grid gap-4 auto-rows-fr");
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
