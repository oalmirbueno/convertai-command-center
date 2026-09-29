/**
 * Frente AG3 (29/09): "deixe todos os agentes ainda mais inteligentes,
 * funcionais, agênticos e completos" e "todos têm que aprender com cada
 * ajuste". Confere:
 * 1. aprender: a regra é criada (Jev diz duradoura), pedido de uma vez só não
 *    vira regra, incerto vira "Guardar?", escopo do dono, sem sinal nem
 *    pergunta ao Jev, regra repetida é reforçada (cérebro de verdade);
 * 2. obedecer: EVITAR primeiro, regra de outro agente fica de fora, apelido
 *    inventado não vira "Segui";
 * 3. esquecer: tira a regra; não mexe em regra de outro dono nem na que não
 *    veio de conversa;
 * 4. lançador: mover de coluna e mudar prioridade com Desfazer, concluir
 *    grava kanban_status, a trava do banco chega com o motivo;
 * 5. conversa do lançador: data com dia da semana e histórico com teto.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  aprenderDoPedido,
  blocoDasRegras,
  esquecerRegra,
  fonteDaRegra,
  guardarRegraDoDono,
  lerDecisaoDoAprendizado,
  type NovaRegra,
  regraDoTrecho,
  regrasDoAgente,
  regrasSeguidas,
  temSinalDeAprendizado,
  trechosDoPedido,
} from "../../supabase/functions/_shared/aprender-com-o-dono";
import { registrarAprendizado } from "../../supabase/functions/_shared/cerebro-do-cliente";
import {
  colunaDoKanban,
  executarItemDoLancador,
  motivoDoBanco,
  normalizarAcoesDoLancador,
  alvosDoLancador,
  reverterItemDoLancador,
} from "../../supabase/functions/voice-assistant-agent/acoes-do-lancador";
import { blocoDoHistorico, historicoSeguro, linhaDeHoje, MAX_TROCAS_NO_HISTORICO } from "../../supabase/functions/voice-assistant-agent/conversa-do-lancador";

const U = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const CLIENTE = U(900);
const DONO = U(901);

type Linha = Record<string, unknown>;

/** Banco falso encadeável (select/eq/in/order/limit/maybeSingle/single/insert/update). */
function bancoFalso(tabelas: Record<string, Linha[]>) {
  const log: Array<{ tabela: string; op: string; dados?: unknown }> = [];
  let seq = 0;
  const from = (tabela: string) => {
    const filtros: Array<[string, unknown, "eq" | "in"]> = [];
    let op: "select" | "insert" | "update" = "select";
    let dados: Linha | null = null;
    const linhas = () => (tabelas[tabela] || []).filter((l) => filtros.every(([c, v, t]) => (t === "in" ? (v as unknown[]).indexOf(l[c]) >= 0 : l[c] === v)));
    const executar = () => {
      log.push({ tabela, op, dados });
      if (op === "insert") {
        const nova = { id: U(500 + ++seq), ativa: true, reforcos: 1, ...(dados as Linha) };
        (tabelas[tabela] = tabelas[tabela] || []).push(nova);
        return { data: [nova], error: null };
      }
      if (op === "update") {
        const alvo = linhas();
        for (const l of alvo) Object.assign(l, dados);
        return { data: alvo, error: null };
      }
      return { data: linhas(), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push([c, v, "eq"]), q),
      in: (c: string, v: unknown[]) => (filtros.push([c, v, "in"]), q),
      order: () => q,
      limit: () => q,
      insert: (d: Linha) => ((op = "insert"), (dados = d), q),
      update: (d: Linha) => ((op = "update"), (dados = d), q),
      maybeSingle: async () => {
        const r = executar();
        return { data: (r.data as Linha[])[0] ?? null, error: null };
      },
      single: async () => {
        const r = executar();
        return { data: (r.data as Linha[])[0] ?? null, error: null };
      },
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro),
    };
    return q;
  };
  return { db: { from }, log, tabelas };
}

/** Jev falso: devolve as escolhas pedidas com probabilidade. */
function jevQueResponde(r: { duracao: string; tipo?: string; trecho?: string; escopo?: string; p?: number }) {
  return vi.fn(async (_state: unknown, questions: Record<string, unknown>) => {
    const p = r.p ?? 0.92;
    const res: Record<string, { choice: string; probabilities: Record<string, number> }> = {
      duracao: { choice: r.duracao, probabilities: { [r.duracao]: p } },
      tipo: { choice: r.tipo ?? "evitar", probabilities: { [r.tipo ?? "evitar"]: 0.9 } },
      trecho: { choice: r.trecho ?? "s1", probabilities: { [r.trecho ?? "s1"]: 0.9 } },
    };
    if (questions.escopo) res.escopo = { choice: r.escopo ?? "cliente", probabilities: { [r.escopo ?? "cliente"]: 0.9 } };
    return res;
  });
}

const gravacaoOk = (id = U(70)) => vi.fn(async (_n: NovaRegra) => ({ gravada: true, situacao: "criado" as const, id, reforcos: 1, substituidos: [], erro: null }));

// ------------------------------------------------------------------ 1. aprender

describe("aprender com o dono", () => {
  it("filtro barato: sem sinal não pergunta ao Jev", async () => {
    expect(temSinalDeAprendizado("Crie uma tarefa de revisar artes para sexta")).toBe(false);
    expect(temSinalDeAprendizado("Não gostei do tom, nunca mande resumo longo")).toBe(true);
    expect(temSinalDeAprendizado("A partir de agora sempre marque as tarefas com prazo")).toBe(true);
    const perguntar = jevQueResponde({ duracao: "preferencia_duradoura" });
    const gravar = gravacaoOk();
    const r = await aprenderDoPedido({ texto: "Crie a tarefa de revisar artes", agente: "geral", clientId: CLIENTE, donoId: DONO, perguntar, gravar });
    expect(r.aprendi).toBeNull();
    expect(r.decisao).toMatchObject({ vira_regra: false, motivo: "sem_sinal" });
    expect(perguntar).not.toHaveBeenCalled();
    expect(gravar).not.toHaveBeenCalled();
  });

  it("duradoura vira regra EVITAR com a frase do próprio pedido, no lugar certo do cérebro", async () => {
    const perguntar = jevQueResponde({ duracao: "preferencia_duradoura", tipo: "evitar", trecho: "s2" });
    const gravar = gravacaoOk();
    const texto = "Refaz o ritual. Nunca prometa prazo de entrega para este cliente.";
    const r = await aprenderDoPedido({ texto, agente: "central", clientId: CLIENTE, donoId: DONO, perguntar, gravar });
    expect(r.aprendi).toMatchObject({ tipo: "aprendizado_do_agente", id: U(70), texto: "Nunca prometa prazo de entrega para este cliente.", categoria: "evitar", decisao: "preferencia_duradoura", escopo: "cliente" });
    const nova = gravar.mock.calls[0][0];
    expect(nova).toMatchObject({ client_id: CLIENTE, area: "geral", agente: "geral", categoria: "evitar", fonte: "aprendeu:central", criado_por: DONO });
    // O texto da regra é copiado do pedido (selecionar, não gerar).
    expect(texto).toContain(nova.texto.replace(/\.$/, ""));
  });

  it("tráfego grava na área da conta, com o agente de ads", async () => {
    const gravar = gravacaoOk();
    await aprenderDoPedido({ texto: "Nunca suba verba na sexta-feira.", agente: "trafego", clientId: CLIENTE, donoId: DONO, perguntar: jevQueResponde({ duracao: "preferencia_duradoura" }), gravar });
    expect(gravar.mock.calls[0][0]).toMatchObject({ area: "conta", agente: "estrategista_ads", fonte: "aprendeu:trafego" });
  });

  it("pedido de uma vez só não vira regra", async () => {
    const gravar = gravacaoOk();
    const r = await aprenderDoPedido({ texto: "Não gostei desse título, troca por outro.", agente: "central", clientId: CLIENTE, donoId: DONO, perguntar: jevQueResponde({ duracao: "so_desta_vez" }), gravar });
    expect(r.aprendi).toBeNull();
    expect(r.decisao).toMatchObject({ vira_regra: false, motivo: "so_desta_vez" });
    expect(gravar).not.toHaveBeenCalled();
  });

  it("duradoura com pouca certeza fica incerta: nada gravado, a tela oferece Guardar", async () => {
    const gravar = gravacaoOk();
    const r = await aprenderDoPedido({ texto: "Prefiro mensagens mais curtas.", agente: "geral", clientId: CLIENTE, donoId: DONO, perguntar: jevQueResponde({ duracao: "preferencia_duradoura", tipo: "preferencia", p: 0.45 }), gravar });
    expect(gravar).not.toHaveBeenCalled();
    expect(r.aprendi).toMatchObject({ id: null, decisao: "incerto", texto: "Prefiro mensagens mais curtas.", categoria: "preferencia" });
    const g = await guardarRegraDoDono({ texto: r.aprendi!.texto, categoria: "preferencia", escopo: "cliente", agente: "geral", clientId: CLIENTE, donoId: DONO, gravar });
    expect(g.aprendi).toMatchObject({ id: U(70), decisao: "preferencia_duradoura" });
    expect(gravar.mock.calls[0][0]).toMatchObject({ client_id: CLIENTE, categoria: "preferencia", fonte: "aprendeu:geral" });
  });

  it("no assistente geral, regra do jeito do dono vai para o escopo do dono", async () => {
    const perguntar = jevQueResponde({ duracao: "preferencia_duradoura", tipo: "evitar", escopo: "dono" });
    const gravar = gravacaoOk();
    const r = await aprenderDoPedido({ texto: "Não me mande resumo longo, nunca.", agente: "geral", clientId: CLIENTE, donoId: DONO, perguntar, gravar });
    expect(Object.keys(perguntar.mock.calls[0][1])).toEqual(expect.arrayContaining(["duracao", "tipo", "trecho", "escopo"]));
    expect(gravar.mock.calls[0][0]).toMatchObject({ client_id: DONO, agente: "geral", area: "geral", fonte: fonteDaRegra("geral") });
    expect(r.aprendi).toMatchObject({ escopo: "dono" });
  });

  it("Jev fora do ar: não grava e devolve o motivo", async () => {
    const gravar = gravacaoOk();
    const r = await aprenderDoPedido({ texto: "Nunca use emoji.", agente: "workspace", clientId: CLIENTE, donoId: DONO, perguntar: async () => { throw new Error("jev_timeout"); }, gravar });
    expect(r).toMatchObject({ aprendi: null, erro: "jev_timeout", decisao: { motivo: "jev_falhou" } });
    expect(gravar).not.toHaveBeenCalled();
  });

  it("regra repetida é reforçada no cérebro, sem duplicar", async () => {
    const f = bancoFalso({ agente_memoria: [] });
    const gravar = async (n: NovaRegra) => {
      const r = await registrarAprendizado(f.db as never, { ...n, valido_dias: null });
      return { gravada: true, situacao: r.situacao, id: r.id, reforcos: r.reforcos, substituidos: r.substituidos, erro: null };
    };
    const perguntar = jevQueResponde({ duracao: "preferencia_duradoura" });
    const a = await aprenderDoPedido({ texto: "Nunca marque tarefa na segunda.", agente: "geral", clientId: CLIENTE, donoId: DONO, perguntar, gravar });
    const b = await aprenderDoPedido({ texto: "Nunca marque tarefa na segunda.", agente: "geral", clientId: CLIENTE, donoId: DONO, perguntar, gravar });
    expect(a.aprendi).toMatchObject({ situacao: "criado" });
    expect(b.aprendi).toMatchObject({ situacao: "reforcado", id: a.aprendi!.id, reforcos: 2 });
    expect(f.tabelas.agente_memoria.length).toBe(1);
  });

  it("frases e política: corta a frase certa e lê o Jev pelo corte", () => {
    expect(trechosDoPedido("Muda o prazo. Nunca use caixa alta!\nE sempre cite o cliente pelo nome")).toEqual([
      "Muda o prazo.", "Nunca use caixa alta!", "E sempre cite o cliente pelo nome",
    ]);
    expect(regraDoTrecho("e sempre cite o cliente pelo nome")).toBe("Sempre cite o cliente pelo nome.");
    const trechos = ["Muda o prazo.", "Nunca use caixa alta!"];
    expect(lerDecisaoDoAprendizado({ duracao: { choice: "preferencia_duradoura", probabilities: { preferencia_duradoura: 0.8 } }, trecho: { choice: "nenhum", probabilities: { nenhum: 0.9 } } }, trechos))
      .toMatchObject({ vira_regra: false, motivo: "sem_trecho" });
    expect(lerDecisaoDoAprendizado({ duracao: { choice: "preferencia_duradoura", probabilities: { preferencia_duradoura: 0.8 } }, trecho: { choice: "s9", probabilities: { s9: 0.9 } } }, trechos))
      .toMatchObject({ vira_regra: false });
  });
});

// ------------------------------------------------------------------ 2. obedecer

describe("obedecer as regras", () => {
  const memoria = () => [
    { id: U(1), client_id: CLIENTE, ativa: true, tipo: "preferencia", area: "geral", fonte: "aprendeu:central", texto: "Sempre cite o combinado da semana.", reforcos: 3 },
    { id: U(2), client_id: CLIENTE, ativa: true, tipo: "evitar", area: "geral", fonte: "aprendeu:geral", texto: "Nunca prometa prazo.", reforcos: 1 },
    { id: U(3), client_id: CLIENTE, ativa: true, tipo: "evitar", area: "geral", fonte: "aprendeu:workspace", texto: "Não arquive contratos.", reforcos: 1 },
    { id: U(4), client_id: CLIENTE, ativa: true, tipo: "evitar", area: "arte", fonte: "estudio", texto: "Sem fundo vermelho.", reforcos: 2 },
    { id: U(5), client_id: CLIENTE, ativa: false, tipo: "evitar", area: "geral", fonte: "aprendeu:central", texto: "Regra esquecida.", reforcos: 1 },
    { id: U(6), client_id: DONO, ativa: true, tipo: "evitar", area: "geral", fonte: "aprendeu:geral", texto: "Não me mande resumo longo.", reforcos: 1 },
  ];

  it("a Central lê as dela e as gerais, EVITAR primeiro; regra de outro agente, de outra área e esquecida ficam de fora", async () => {
    const f = bancoFalso({ agente_memoria: memoria() });
    const regras = await regrasDoAgente(f.db as never, { agente: "central", clientId: CLIENTE, donoId: DONO });
    expect(regras.map((r) => r.texto)).toEqual(["Nunca prometa prazo.", "Sempre cite o combinado da semana."]);
    expect(regras.map((r) => r.ref)).toEqual(["r1", "r2"]);
    const bloco = blocoDasRegras(regras);
    expect(bloco).toContain("EVITAR manda sobre tudo");
    expect(bloco.indexOf("r1: Nunca prometa prazo.")).toBeLessThan(bloco.indexOf("r2: Sempre cite"));
    expect(bloco).toContain('"regras_seguidas"');
  });

  it("o assistente geral lê também as regras do dono", async () => {
    const f = bancoFalso({ agente_memoria: memoria() });
    const regras = await regrasDoAgente(f.db as never, { agente: "geral", clientId: CLIENTE, donoId: DONO });
    expect(regras.map((r) => r.texto)).toEqual(expect.arrayContaining(["Não me mande resumo longo.", "Nunca prometa prazo."]));
    expect(regras.find((r) => r.texto === "Não me mande resumo longo.")!.escopo).toBe("dono");
    expect(regras.some((r) => r.texto === "Sempre cite o combinado da semana.")).toBe(false);
  });

  it("Segui traduz o apelido e ignora o inventado", async () => {
    const f = bancoFalso({ agente_memoria: memoria() });
    const regras = await regrasDoAgente(f.db as never, { agente: "central", clientId: CLIENTE });
    expect(regrasSeguidas(["r1", "r9", "R1"], regras)).toEqual({ tipo: "regras_seguidas", regras: [{ id: U(2), tipo: "evitar", texto: "Nunca prometa prazo." }] });
    expect(regrasSeguidas([], regras)).toBeNull();
    expect(blocoDasRegras([])).toBe("");
  });
});

// ------------------------------------------------------------------ 3. esquecer

describe("esquecer", () => {
  it("Esquecer tira a regra aprendida; não mexe em regra de outro dono nem na que não veio de conversa", async () => {
    const f = bancoFalso({
      agente_memoria: [
        { id: U(1), client_id: CLIENTE, ativa: true, fonte: "aprendeu:central" },
        { id: U(2), client_id: U(777), ativa: true, fonte: "aprendeu:central" },
        { id: U(3), client_id: CLIENTE, ativa: true, fonte: "estudio" },
      ],
    });
    expect(await esquecerRegra(f.db as never, { id: U(1), donosPermitidos: [CLIENTE] })).toEqual({ ok: true, motivo: null });
    expect(f.tabelas.agente_memoria[0].ativa).toBe(false);
    expect((await esquecerRegra(f.db as never, { id: U(2), donosPermitidos: [CLIENTE] })).ok).toBe(false);
    expect(f.tabelas.agente_memoria[1].ativa).toBe(true);
    expect((await esquecerRegra(f.db as never, { id: U(3), donosPermitidos: [CLIENTE] })).ok).toBe(false);
    expect((await esquecerRegra(f.db as never, { id: "inventado", donosPermitidos: [CLIENTE] })).ok).toBe(false);
  });

  it("depois de esquecer, a regra não é mais lida", async () => {
    const f = bancoFalso({ agente_memoria: [{ id: U(1), client_id: CLIENTE, ativa: true, tipo: "evitar", area: "geral", fonte: "aprendeu:geral", texto: "Nunca use emoji.", reforcos: 1 }] });
    expect((await regrasDoAgente(f.db as never, { agente: "workspace", clientId: CLIENTE })).length).toBe(1);
    await esquecerRegra(f.db as never, { id: U(1), donosPermitidos: [CLIENTE] });
    expect((await regrasDoAgente(f.db as never, { agente: "workspace", clientId: CLIENTE })).length).toBe(0);
  });
});

// ------------------------------------------------------------------ 4. lançador

describe("lançador: mover, prioridade e concluir", () => {
  const dados = {
    cliente: { id: CLIENTE, nome: "Mirante" },
    projetos: [{ id: U(1), name: "Social", status: "active", deadline: null }],
    tarefas: [
      { id: U(11), title: "Revisar artes", status: "todo", due_date: "2026-10-02", priority: "medium", project_id: U(1), projeto: "Social" },
      { id: U(12), title: "Subir campanha", status: "doing", due_date: null, priority: "high", project_id: U(1), projeto: "Social" },
    ],
  };

  it("o modelo pede mover e prioridade com apelidos; coluna e prioridade inválidas ficam de fora", () => {
    const a = alvosDoLancador(dados);
    expect(a.tarefas[0].detalhe).toContain("A fazer");
    expect(a.tarefas[0].detalhe).toContain("prioridade média");
    const acao = normalizarAcoesDoLancador({
      resumo: "Organizar",
      itens: [
        { operacao: "mover_tarefa", ref: "t1", para: "fazendo" },
        { operacao: "mudar_prioridade", ref: "t1", para: "alta" },
        { operacao: "mover_tarefa", ref: "t2", para: "fazendo" },
        { operacao: "mover_tarefa", ref: "t1", para: "coluna inventada" },
      ],
    }, a, { clientId: CLIENTE, hoje: "2026-09-29" })!;
    expect(acao.itens.map((i) => `${i.operacao}:${i.ref}:${i.para}`)).toEqual(["mover_tarefa:t1:doing", "mudar_prioridade:t1:high"]);
    expect(colunaDoKanban("Em revisão")).toBe("review");
    expect(colunaDoKanban("feito")).toBeNull();
  });

  it("mover e mudar prioridade gravam status e kanban_status juntos e o Desfazer volta", async () => {
    const tabelas: Record<string, Linha[]> = {
      projects: [{ id: U(1), client_id: CLIENTE, deleted_at: null }],
      tasks: [{ id: U(11), project_id: U(1), status: "todo", kanban_status: null, priority: "medium", due_date: null, deleted_at: null }],
    };
    const f = bancoFalso(tabelas);
    const deps = { userId: DONO, gravarNota: vi.fn() };
    const mov = await executarItemDoLancador(f.db as never, CLIENTE, { operacao: "mover_tarefa", alvo_id: U(11), para: "doing", titulo: "Revisar" }, { contexto: {} }, deps as never);
    expect(tabelas.tasks[0]).toMatchObject({ status: "doing", kanban_status: "doing" });
    await reverterItemDoLancador(f.db as never, CLIENTE, { operacao: "mover_tarefa", desfazer: mov.desfazer }, {});
    expect(tabelas.tasks[0]).toMatchObject({ status: "todo", kanban_status: null });

    const pri = await executarItemDoLancador(f.db as never, CLIENTE, { operacao: "mudar_prioridade", alvo_id: U(11), para: "alta", titulo: "Revisar" }, { contexto: {} }, deps as never);
    expect(tabelas.tasks[0].priority).toBe("high");
    await reverterItemDoLancador(f.db as never, CLIENTE, { operacao: "mudar_prioridade", desfazer: pri.desfazer }, {});
    expect(tabelas.tasks[0].priority).toBe("medium");

    const fim = await executarItemDoLancador(f.db as never, CLIENTE, { operacao: "concluir_tarefa", alvo_id: U(11), para: null, titulo: "Revisar" }, { contexto: {} }, deps as never);
    expect(tabelas.tasks[0]).toMatchObject({ status: "done", kanban_status: "done" });
    await reverterItemDoLancador(f.db as never, CLIENTE, { operacao: "concluir_tarefa", desfazer: fim.desfazer }, {});
    expect(tabelas.tasks[0]).toMatchObject({ status: "todo", kanban_status: null });
  });

  it("a trava escrita pelo banco (P0001) chega com o motivo; erro técnico fica com a frase padrão", () => {
    expect(motivoDoBanco({ code: "P0001", message: "O conteúdo vinculado precisa estar publicado antes de concluir a tarefa." }, "x"))
      .toBe("O conteúdo vinculado precisa estar publicado antes de concluir a tarefa.");
    expect(motivoDoBanco({ code: "42501", message: "permission denied for table tasks" }, "Não foi possível concluir a tarefa.")).toBe("Não foi possível concluir a tarefa.");
  });
});

// ------------------------------------------------------------------ 5. conversa do lançador

describe("conversa do lançador", () => {
  it("data com o dia da semana e histórico com teto de trocas e de tamanho", () => {
    expect(linhaDeHoje("2026-09-29")).toBe("Hoje: 2026-09-29 (terça-feira, horário de Brasília).");
    const muitas = Array.from({ length: 20 }, (_, i) => ({ papel: i % 2 ? "aceleriq" : "equipe", texto: `troca ${i} ${"x".repeat(900)}` }));
    const h = historicoSeguro([...muitas, { papel: "equipe", texto: "   " }, null]);
    expect(h.length).toBe(MAX_TROCAS_NO_HISTORICO);
    expect(h.every((x) => x.texto.length <= 600)).toBe(true);
    expect(historicoSeguro("lixo")).toEqual([]);
    expect(blocoDoHistorico([{ papel: "equipe", texto: "Cria a tarefa X" }, { papel: "aceleriq", texto: "Feito." }])).toContain("Equipe: Cria a tarefa X\nAceleriq: Feito.");
    expect(blocoDoHistorico([])).toBe("");
  });
});

// ------------------------------------------------------------------ 6. telas (fonte)

describe("telas devolvem o aprendizado e mandam a conversa", () => {
  const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("o assistente manda as últimas trocas e mostra Aprendi/Segui com Esquecer e Guardar", () => {
    const tela = ler("src/components/admin/VoiceAssistant.tsx");
    expect(tela).toContain("historico: opts?.silent ? [] : historicoRef.current,");
    expect(tela).toContain("historico: historicoRef.current,");
    expect((tela.match(/<AprendizadoDoAgente/g) || []).length).toBe(2);
    expect(tela).toContain('esquecerRegraAprendida("voice-assistant-agent"');
    const servidor = ler("supabase/functions/voice-assistant-agent/index.ts");
    expect(servidor).toContain("if (erroGravar) console.error");
    expect(servidor).toContain('console.error(`[assistente] erro interno:');
    expect(servidor).toContain("parsed.aviso_da_acao");
  });

  it("a Central, o tráfego e o Workspace mostram a mesma linha", () => {
    expect(ler("src/components/central/AgenteDaCentral.tsx")).toContain('esquecerRegraAprendida("agente-central"');
    expect(ler("src/components/mesa-ads/AgenteSenior.tsx")).toContain('esquecerRegraAprendida("mesa-ads"');
    expect(ler("src/components/mesa-ads/AgenteDaOferta.tsx")).toContain("<AprendizadoDoAgente");
    expect(ler("src/components/mesa-ads/ConversaDoPlano.tsx")).toContain("<AprendizadoDoAgente");
    expect(ler("src/components/workspace/StudioPanel.tsx")).toContain('esquecerRegraAprendida("workspace-agent"');
  });
});

