import { describe, expect, it } from "vitest";
import {
  clienteDaPergunta,
  conferirContraAFicha,
  contagemDoRecorte,
  conversaDoRecorte,
  estadoDaTarefa,
  fontesDosAnexos,
  MAX_CHARS_DOS_ANEXOS,
  montarFicha,
  periodoDaPergunta,
  respostaDoMotor,
  type EntradaDaFicha,
} from "../../supabase/functions/gestor-aceleriq/modulos/ficha";
import { aplicarConferencia, perguntasDeConferencia } from "../../supabase/functions/gestor-aceleriq/modulos/conferencia";
import { calcularIndicadores, divergenciaDoVinculo, resultadoVerificado } from "@/lib/centralAutonomia";

// Quinta, 08/10/2026 10:00 em São Paulo (13:00 UTC).
const AGORA = new Date("2026-10-08T13:00:00Z");

describe("Gestor Aceleriq: período e cliente", () => {
  it("'nesta semana' vai de segunda 00:00 (SP) até o fim de hoje, com a semana anterior do mesmo tamanho", () => {
    const p = periodoDaPergunta("O que aconteceu com a Acerbi nesta semana?", AGORA);
    expect(p.desde).toBe("2026-10-05T03:00:00.000Z");
    expect(p.ate).toBe("2026-10-09T03:00:00.000Z");
    expect(p.anterior.desde).toBe("2026-09-28T03:00:00.000Z");
    expect(p.anterior.ate).toBe("2026-10-02T03:00:00.000Z");
    expect(p.rotulo).toContain("esta semana");
  });

  it("sem período na frase vale últimos 7 dias; 'últimos 10 dias' e 'ontem' são lidos", () => {
    expect(periodoDaPergunta("como está a operação?", AGORA).rotulo).toBe("últimos 7 dias");
    expect(periodoDaPergunta("o que rodou nos últimos 10 dias", AGORA).rotulo).toBe("últimos 10 dias");
    const ontem = periodoDaPergunta("e ontem?", AGORA);
    expect(ontem.desde).toBe("2026-10-07T03:00:00.000Z");
    expect(ontem.ate).toBe("2026-10-08T03:00:00.000Z");
  });

  const clientes = [
    { id: "acerbi", nome: "Acerbi" },
    { id: "acerbi", nome: "CME", projetoId: "proj-cme", marca: "CME" },
    { id: "parasi", nome: "Para Si Ótica" },
    { id: "verzelo", nome: "Verzelo Paisagismo" },
    { id: "verzelo2", nome: "Verzelo Jardins" },
  ];

  it("acha o cliente pelo nome exato, sem acento, e a marca secundária restringe ao projeto dela", () => {
    expect(clienteDaPergunta("O que aconteceu com a Acerbi nesta semana?", clientes)).toEqual({ tipo: "um", cliente: clientes[0] });
    expect(clienteDaPergunta("e a para si otica?", clientes)).toEqual({ tipo: "um", cliente: clientes[2] });
    const cme = clienteDaPergunta("como foi a CME?", clientes);
    expect(cme.tipo === "um" && cme.cliente.projetoId).toBe("proj-cme");
  });

  it("nome inteiro vence pedaço de nome, e palavra comum ('evento') não acha cliente sozinha", () => {
    const lista = [{ id: "acerbi", nome: "Acerbi" }, { id: "sub", nome: "Evento Subaftertuor" }];
    expect(clienteDaPergunta("Ata da reunião com a Acerbi sobre o evento Reforma Tributária", lista)).toEqual({ tipo: "um", cliente: lista[0] });
    expect(clienteDaPergunta("como foi o evento de ontem?", lista)).toEqual({ tipo: "nenhum" });
  });

  it("dois clientes com o mesmo trecho: pergunta de volta, sem palpite; nenhum nome: geral", () => {
    const r = clienteDaPergunta("e a Verzelo?", clientes);
    expect(r.tipo).toBe("ambiguo");
    expect(clienteDaPergunta("o que está bloqueado agora?", clientes)).toEqual({ tipo: "nenhum" });
  });
});

describe("Gestor Aceleriq: estado da tarefa lida com a execução", () => {
  it("separa tarefa e execução e nunca chama revisão de feito", () => {
    expect(estadoDaTarefa({ status: "done" }, { status: "done", last_evidence: "Diário 8dea0967" })).toBe("feito_com_prova");
    expect(estadoDaTarefa({ status: "done" }, null)).toBe("concluido_sem_prova");
    expect(estadoDaTarefa({ status: "review" }, { status: "done", last_evidence: "prova" })).toBe("execucao_feita_entrega_em_revisao");
    expect(estadoDaTarefa({ status: "doing" }, { status: "blocked", last_evidence: null })).toBe("divergente");
    expect(estadoDaTarefa({ status: "todo" }, { status: "blocked", last_evidence: null })).toBe("bloqueado");
    expect(estadoDaTarefa({ status: "review" }, { status: "review", last_evidence: "x" })).toBe("em_revisao");
    expect(estadoDaTarefa({ status: "doing" }, null)).toBe("em_andamento");
  });
});

/** O cenário real de 07/10 (dados do banco reduzidos): conciliação do Atlas concluída; vídeos ainda em edição. */
function cenarioAcerbi(): EntradaDaFicha {
  const periodo = periodoDaPergunta("O que aconteceu com a Acerbi nesta semana?", AGORA);
  return {
    periodo,
    tarefas: [
      { id: "250c19a0", title: "Conciliar publicações confirmadas com o histórico de posts e identificar vínculos ou permalinks ausentes", status: "done", updated_at: "2026-10-08T01:35:54Z", cliente: "Acerbi" },
      { id: "802f13b4", title: "Edição dos vídeos do evento Reforma Tributária", status: "doing", updated_at: "2026-09-25T12:00:00Z", cliente: "Acerbi", description: "Captação 19/08 concluída; vídeos ainda em edição." },
      { id: "045c27a1", title: "Registrar desempenho dos posts agendados", status: "review", updated_at: "2026-10-07T21:13:29Z", cliente: "Acerbi" },
    ],
    vinculos: [
      { id: "4d586b2e", status: "done", operator_id: "atlas", kanban_task_id: "250c19a0", painel_task_id: null, last_action: "Core verificou aceite original e concluiu a conciliação interna institucional: cinco publicações associadas e duas lacunas documentadas, CME separado.", last_evidence: "Diário entrada 8dea0967, artefato aceite-conciliacao-v2.json relido.", next_step: "Conciliação interna encerrada no recorte 28/09–07/10.", block_reason: null, updated_at: "2026-10-08T01:35:37Z" },
      { id: "b275f92f", status: "review", operator_id: "augusto", kanban_task_id: "045c27a1", painel_task_id: null, last_action: "Organização documental aplicada; entrega não concluída.", last_evidence: "changes-manifest.json", next_step: "Almir revisar escopo/janela.", block_reason: null, updated_at: "2026-10-07T21:13:29Z" },
    ],
    runs: [{ id: "run1", operator_id: "atlas", run_key: "atlas-etapa1-250c19a0", task_link_id: "4d586b2e", status: "done", started_at: "2026-10-08T01:01:20Z", finished_at: "2026-10-08T01:35:37Z", heartbeat_at: "2026-10-08T01:35:37Z", error: null }],
    diario: [{ id: "8dea0967", task_link_id: "4d586b2e", entry_type: "evidencia", title: "Aceite da conciliação interna v2", body: "5 publicações com permalink exato; tarefa de edição 802f13b4 doing e post null: vídeos ainda em edição, sem publicação associada.", author_kind: "operador", operator_id: "atlas", created_at: "2026-10-08T01:33:39Z" }],
    publicacoes: [{ id: "pub-oficina", post_id: "be672d6e", status: "scheduled", published_at: null, scheduled_at: "2026-10-08T15:00:00Z", permalink: null, platform: "instagram", titulo: "Oficina Gestão do tempo", cliente: "Acerbi" }],
    entregas: [],
    aprovacoes: [],
    nomeDoAgente: (id) => (id === "atlas" ? "Atlas" : id === "augusto" ? "Augusto" : null),
  };
}

describe("Gestor Aceleriq: ficha e resposta sem IA no cenário real da Acerbi", () => {
  const ficha = montarFicha(cenarioAcerbi());
  const porTarefa = (id: string) => ficha.fontes.find((f) => f.tipo === "tarefa" && f.ids.tarefa === id)!;

  it("a conciliação do Atlas entra como feita com prova, com a evidência no texto da fonte", () => {
    const f = porTarefa("250c19a0");
    expect(f.estado).toBe("feito_com_prova");
    expect(f.texto).toContain("8dea0967");
    expect(f.agente).toBe("Atlas");
  });

  it("os vídeos em edição entram (tarefa aberta fora do período) e não como feitos", () => {
    const f = porTarefa("802f13b4");
    expect(f.estado).toBe("em_andamento");
    expect(f.texto).toContain("ainda em edição");
  });

  it("revisão é revisão; publicação agendada não é publicada", () => {
    expect(porTarefa("045c27a1").estado).toBe("em_revisao");
    expect(ficha.fontes.find((f) => f.tipo === "publicacao")!.estado).toBe("agendado");
  });

  it("tarefa concluída sem prova + publicação com link do mesmo título viram uma fonte só, feita com prova", () => {
    const e = cenarioAcerbi();
    e.tarefas.push({ id: "post1", title: "[EXTRA | 05/10] Post estático: Pequena empresa, impacto grande", status: "done", updated_at: "2026-10-05T19:04:00Z", cliente: "Acerbi" });
    e.tarefas.push({ id: "post2", title: "[ENCERRADA | LIMPEZA 09/09] Carrossel sem publicação", status: "done", updated_at: "2026-10-06T19:05:00Z", cliente: "Acerbi" });
    e.publicacoes.push({ id: "pub1", post_id: "p1", status: "published", published_at: "2026-10-05T19:00:00Z", scheduled_at: null, permalink: "https://www.instagram.com/p/DeH6WM6lYDs/", platform: "instagram", titulo: "[EXTRA | 05/10] Post estático: Pequena empresa, impacto grande", cliente: "Acerbi" });
    const f = montarFicha(e).fontes;
    const post = f.filter((x) => x.titulo.includes("Pequena empresa"));
    expect(post).toHaveLength(1);
    expect(post[0]).toMatchObject({ tipo: "tarefa", estado: "feito_com_prova", link: "https://www.instagram.com/p/DeH6WM6lYDs/" });
    expect(f.find((x) => x.ids.tarefa === "post2")!.estado).toBe("concluido_sem_prova");
  });

  it("a resposta do motor só põe em 'feito' o que tem prova", () => {
    const itens = respostaDoMotor(ficha.fontes);
    const feitos = itens.filter((i) => i.secao === "feito").map((i) => i.texto).join(" | ");
    expect(feitos).toContain("Conciliar publicações");
    expect(feitos).not.toMatch(/vídeo|Oficina|desempenho/i);
    expect(itens.some((i) => i.secao === "em_revisao" && i.texto.includes("desempenho"))).toBe(true);
    expect(contagemDoRecorte(ficha.fontes).feito).toBe(1);
  });

  it("barreira 1: recusa item sem fonte, com fonte inventada ou 'feito' citando o que está em revisão ou em edição", () => {
    const video = porTarefa("802f13b4").apelido;
    const revisao = porTarefa("045c27a1").apelido;
    const concil = porTarefa("250c19a0").apelido;
    const { aceitos, recusados } = conferirContraAFicha([
      { secao: "feito", texto: "Os vídeos do evento foram publicados", fontes: [video] },
      { secao: "feito", texto: "Desempenho registrado", fontes: [revisao] },
      { secao: "feito", texto: "Algo sem prova", fontes: [] },
      { secao: "feito", texto: "Algo inventado", fontes: ["F99"] },
      { secao: "feito", texto: "Conciliação concluída com 5 publicações associadas", fontes: [concil.toLowerCase()] },
      { secao: "lacuna", texto: "Vídeos ainda em edição, sem publicação", fontes: [video] },
    ], ficha.fontes);
    expect(recusados.map((r) => r.motivo)).toEqual(["estado_incompativel", "estado_incompativel", "sem_fonte", "fonte_inexistente"]);
    expect(aceitos.map((a) => a.texto)).toEqual(["Conciliação concluída com 5 publicações associadas", "Vídeos ainda em edição, sem publicação"]);
  });

  it("barreira 2 (Jev): uma pergunta Choice por afirmação; 'contradiz' sai, 'sustenta' forte vira conferido", () => {
    const itens = [
      { secao: "feito" as const, texto: "Conciliação concluída", fontes: [porTarefa("250c19a0").apelido] },
      { secao: "lacuna" as const, texto: "Vídeos publicados no feed", fontes: [porTarefa("802f13b4").apelido] },
    ];
    const { state, questions } = perguntasDeConferencia(itens, ficha.fontes);
    expect(Object.keys(questions)).toEqual(["a0", "a1"]);
    expect(questions.a1.type).toBe("choice");
    expect(state.afirmacoes[1].fontes[0].texto).toContain("ainda em edição");
    const r = aplicarConferencia(itens, {
      a0: { choice: "sustenta", probabilities: { sustenta: 0.93, contradiz: 0.02, nao_diz: 0.05 } },
      a1: { choice: "contradiz", probabilities: { sustenta: 0.05, contradiz: 0.9, nao_diz: 0.05 } },
    });
    expect(r.ficam).toEqual([{ ...itens[0], conferido: "jev" }]);
    expect(r.sairam[0].veredito).toBe("contradiz");
    expect(aplicarConferencia(itens, null).ficam).toEqual(itens);
  });
});

describe("Central de Autonomia: tarefa e execução separadas", () => {
  it("resultado verificado: revisão nunca é concluída; concluída exige tarefa done e prova", () => {
    expect(resultadoVerificado({ status: "done" }, { status: "done", last_evidence: "prova" }, "review")).toBe("execucao_concluida_entrega_em_revisao");
    expect(resultadoVerificado({ status: "done" }, { status: "done", last_evidence: "prova" }, "done")).toBe("concluida_com_prova");
    expect(resultadoVerificado({ status: "done" }, { status: "done", last_evidence: null }, "done")).toBe("concluida_sem_prova");
    expect(resultadoVerificado({ status: "review" }, { status: "review", last_evidence: "x" }, "review")).toBe("em_revisao");
    expect(resultadoVerificado({ status: "timeout" }, null, null)).toBe("sem_sinal");
    expect(resultadoVerificado({ status: "blocked" }, { status: "blocked", last_evidence: null }, "doing")).toBe("bloqueada");
  });

  it("divergência: os casos reais do operator_report", () => {
    expect(divergenciaDoVinculo({ status: "blocked" }, "doing")).toMatch(/parada/);
    expect(divergenciaDoVinculo({ status: "done" }, "doing")).toMatch(/não chegou à revisão/);
    expect(divergenciaDoVinculo({ status: "done" }, "review")).toBeNull();
    expect(divergenciaDoVinculo({ status: "blocked" }, "todo")).toBeNull();
    expect(divergenciaDoVinculo({ status: "blocked" }, "done")).toBeNull();
  });

  it("indicadores contam tarefas, execuções, revisão, incidentes e agentes, com o período anterior", () => {
    const p = periodoDaPergunta("", AGORA, "semana");
    const status = new Map([["t1", "doing"], ["t2", "review"], ["t3", "doing"]]);
    const ind = calcularIndicadores({
      periodo: p, anterior: p.anterior,
      tarefasAbertas: [{ id: "t1", status: "doing", updated_at: "" }, { id: "t2", status: "review", updated_at: "" }, { id: "t3", status: "doing", updated_at: "" }, { id: "t4", status: "backlog", updated_at: "" }],
      concluidasPeriodo: 5, concluidasAnterior: 3,
      execucoes: [
        { id: "r1", operator_id: "atlas", task_link_id: "l1", status: "done", started_at: "2026-10-08T01:00:00Z", finished_at: "2026-10-08T01:30:00Z", heartbeat_at: "2026-10-08T01:30:00Z" },
        { id: "r2", operator_id: "helena", task_link_id: "l3", status: "timeout", started_at: "2026-10-07T20:00:00Z", finished_at: "2026-10-07T22:47:00Z", heartbeat_at: "2026-10-07T20:10:00Z" },
        { id: "r3", operator_id: "augusto", task_link_id: null, status: "failed", started_at: "2026-09-30T10:00:00Z", finished_at: "2026-09-30T10:05:00Z", heartbeat_at: "2026-09-30T10:05:00Z" },
      ],
      vinculos: [
        { id: "l1", status: "done", operator_id: "atlas", kanban_task_id: "t2", painel_task_id: null, last_evidence: "x", updated_at: "" },
        { id: "l2", status: "blocked", operator_id: "core", kanban_task_id: "t1", painel_task_id: null, last_evidence: null, updated_at: "" },
        { id: "l3", status: "in_progress", operator_id: "helena", kanban_task_id: "t3", painel_task_id: null, last_evidence: null, updated_at: "" },
      ],
      statusDaTarefa: (id) => (id ? status.get(id) ?? null : null),
      aprovacoesPendentes: 2,
      agentes: [{ id: "atlas", status: "active", display_name: "Atlas" }, { id: "helena", status: "active", display_name: "Helena" }, { id: "x", status: "paused", display_name: "X" }],
    });
    expect(ind.tarefasAbertas).toEqual({ total: 4, backlog: 1, todo: 0, doing: 2, review: 1 });
    expect(ind.tarefasConcluidas).toEqual({ periodo: 5, anterior: 3 });
    expect(ind.execucoes).toMatchObject({ periodo: 2, anterior: 1, emAndamento: 1, bloqueadas: 1, concluidas: 1, concluidasAnterior: 0 });
    expect(ind.entregasEmRevisao).toBe(1);
    expect(ind.incidentes).toMatchObject({ falhas: 0, semSinal: 1, divergencias: 1, periodo: 2, anterior: 1 });
    expect(ind.agentesAtivos).toEqual({ periodo: 2, anterior: 1, cadastrados: 2 });
  });
});

describe("Gestor Aceleriq: conversa", () => {
  it("abertura, fechamento e sugestões saem das contagens (sem fato novo)", () => {
    const base = { feito: 1, concluido_sem_prova: 0, em_revisao: 2, em_andamento: 3, bloqueado: 1, decisao: 1, lacuna: 0, proximo: 0 };
    const c = conversaDoRecorte({ nome: "Acerbi", periodo: "esta semana (05/10 a 08/10)", contagem: base, totalDeFontes: 8, temCliente: true });
    expect(c.abertura).toBe("Dei uma olhada em Acerbi (esta semana (05/10 a 08/10)). Achei 8 registros no OS; vou te contar o que importa.");
    expect(c.fechamento).toBe("Tem 1 decisão esperando você. Quer ver agora?");
    expect(c.sugestoes).toEqual(["O que está bloqueado e por quê?", "O que espera a minha decisão?", "O que está em revisão?", "E Acerbi nos últimos 30 dias?"]);
    const vazio = conversaDoRecorte({ nome: "Todos os clientes", periodo: "hoje", contagem: { ...base, feito: 0, em_revisao: 0, em_andamento: 0, bloqueado: 0, decisao: 0 }, totalDeFontes: 0, temCliente: false });
    expect(vazio.abertura).toContain("não achei nada registrado");
    expect(vazio.fechamento).toBeNull();
  });
});

describe("Gestor Aceleriq: anexos do dono", () => {
  it("arquivos e imagens viram fontes A1..An, separadas do OS e fora das contagens", () => {
    const { fontes, cortados } = fontesDosAnexos(
      [{ nome: "ata.txt", tipo: "texto", texto: "A Acerbi pediu 2 vídeos." }, { nome: "vazio.txt", tipo: "texto", texto: "   " }],
      [{ nome: "print.png" }],
    );
    expect(fontes.map((f) => [f.apelido, f.tipo, f.estado])).toEqual([["A1", "anexo", "material_do_dono"], ["A2", "anexo_imagem", "material_do_dono"]]);
    expect(cortados).toEqual([]);
    expect(contagemDoRecorte(fontes)).toMatchObject({ feito: 0, anexo: 0, lacuna: 0 });
  });

  it("o texto dos anexos tem teto por pergunta, com o corte avisado", () => {
    const grande = "x".repeat(MAX_CHARS_DOS_ANEXOS + 10);
    const { fontes, cortados } = fontesDosAnexos([{ nome: "a.txt", tipo: "texto", texto: grande }, { nome: "b.txt", tipo: "texto", texto: "y" }], []);
    expect(fontes).toHaveLength(1);
    expect(fontes[0].texto.length).toBe(MAX_CHARS_DOS_ANEXOS);
    expect(cortados).toEqual(["a.txt", "b.txt"]);
  });

  it("anexo nunca vira 'feito' do OS: só fala na seção do material, em pendência, próximo passo ou decisão", () => {
    const { fontes } = fontesDosAnexos([{ nome: "relatorio.pdf", tipo: "pdf", texto: "Post publicado ontem." }], []);
    const { aceitos, recusados } = conferirContraAFicha([
      { secao: "feito", texto: "O post foi publicado", fontes: ["A1"] },
      { secao: "anexo", texto: "O relatório diz que o post saiu ontem", fontes: ["A1"] },
      { secao: "proximo", texto: "Conferir no OS se o post saiu", fontes: ["A1"] },
    ], fontes);
    expect(recusados.map((r) => r.motivo)).toEqual(["estado_incompativel"]);
    expect(aceitos.map((a) => a.secao)).toEqual(["anexo", "proximo"]);
  });
});

