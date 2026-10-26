// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import * as zod from "zod";
import * as seguranca from "../../supabase/functions/_shared/mcp-security";
import * as guardaDoCliente from "../../supabase/functions/_shared/mcp-client-id-guard";
import {
  calendarioDoCliente,
  escolherEspacos,
  horaNaJanela,
  impedimento,
  localParaIso,
  noFuso,
  type PecaSemData,
  postsNaSemana,
  proximoEspaco,
} from "../../supabase/functions/agente-calendario/modulos/agenda-sozinha";
import { separarTarefasDoRitual, tarefaVaga } from "../../supabase/functions/ritual-writer/modulos/tarefa-concreta";
import { normalizarTarefas } from "../../supabase/functions/ritual-writer/escritor";
import { tarefasSugeridas } from "@/components/central/ritualAvisos";
import { type BoletimMinimo, boletimMinimo, excecoesDoDia, type FatosDoBoletim } from "../../supabase/functions/mesa-ads/modulos/boletim-minimo";

type Gravado = Extract<BoletimMinimo, { pular: false }>;

/**
 * Automações de 27/10/2026. Diagnóstico de 26/10: 11 aprovados sem data; "publicar ao aprovar" em 2 de 132;
 * 597 tarefas de agente em 30 dias contra 2 entregas com prova; 538 tarefas abertas sem dono; tarefas de
 * ritual quase nunca fecham (18 de 137); ads_boletins com 0 linhas.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

// ─── 1. Aprovou, agenda sozinho ─────────────────────────────────

const CLIENTE = "33333333-3333-4333-8333-333333333333";
const OUTRO = "55555555-5555-4555-8555-555555555555";
/** Segunda-feira 26/10/2026, 10h em São Paulo (13h UTC). */
const SEGUNDA_10H = new Date("2026-10-26T13:00:00Z");

function peca(extra: Partial<PecaSemData> = {}): PecaSemData {
  return {
    trabalho_id: "t1", client_id: CLIENTE, cliente: "Cliente", titulo: "Peça", aprovado_em: "2026-10-26T12:00:00Z",
    ligado: true, desfeito: false, dispensada: false, cliente_ativo: true, tarefa_ok: true,
    post_id: "p1", publicacao_id: "pub1", publicacao_status: "planned", publicacao_tem_data: false, conta: true, liberada: true,
    hora: "11:00", fuso: "America/Sao_Paulo", fim_de_semana: false, posts_por_mes: null, ocupados: [],
    ...extra,
  };
}

describe("aprovou, agenda sozinho: o espaço certo", () => {
  it("hora local vira o instante certo em São Paulo (UTC-3) e volta igual", () => {
    expect(localParaIso("2026-10-27", "11:00")).toBe("2026-10-27T14:00:00.000Z");
    expect(noFuso(new Date("2026-10-27T14:00:00Z"))).toEqual({ dia: "2026-10-27", hora: "11:00" });
  });

  it("horário do cliente fica entre 9h e 20h", () => {
    expect(horaNaJanela("08:00")).toBe("09:00");
    expect(horaNaJanela("21:30")).toBe("20:00");
    expect(horaNaJanela("17:00")).toBe("17:00");
    expect(horaNaJanela(null)).toBe("09:00");
  });

  it("dia livre hoje com o horário ainda à frente: agenda hoje", () => {
    const [d] = escolherEspacos([peca()], SEGUNDA_10H);
    expect(d).toMatchObject({ acao: "agendar", dia: "2026-10-26", hora: "11:00", quando: "2026-10-26T14:00:00.000Z" });
  });

  it("horário de hoje já passou (ou falta menos de 30 min): vai para o próximo dia útil", () => {
    const [d] = escolherEspacos([peca({ hora: "10:20" })], SEGUNDA_10H);
    expect(d).toMatchObject({ acao: "agendar", dia: "2026-10-27", hora: "10:20" });
  });

  it("não colide: pula o dia que já tem post e duas peças do mesmo cliente caem em dias diferentes", () => {
    const ocupados = [{ dia: "2026-10-26", n: 1 }];
    const ds = escolherEspacos([
      peca({ trabalho_id: "a", aprovado_em: "2026-10-26T10:00:00Z", ocupados }),
      peca({ trabalho_id: "b", aprovado_em: "2026-10-26T11:00:00Z", ocupados }),
    ], SEGUNDA_10H);
    expect(ds.map((d) => d.acao === "agendar" && d.dia)).toEqual(["2026-10-27", "2026-10-28"]);
  });

  it("respeita a meta da semana (3 por semana sem plano): semana cheia vai para a próxima segunda", () => {
    const ocupados = [{ dia: "2026-10-27", n: 1 }, { dia: "2026-10-28", n: 1 }, { dia: "2026-10-29", n: 1 }];
    const cal = calendarioDoCliente({ ocupados, posts_por_mes: null });
    expect(postsNaSemana(cal, "2026-10-26")).toBe(3);
    const [d] = escolherEspacos([peca({ ocupados })], SEGUNDA_10H);
    expect(d).toMatchObject({ acao: "agendar", dia: "2026-11-02" });
  });

  it("meta do plano (posts_por_mes 30 = 7 por semana) deixa usar a semana toda, sem fim de semana para quem não posta", () => {
    const ocupados = [{ dia: "2026-10-27", n: 1 }, { dia: "2026-10-28", n: 1 }, { dia: "2026-10-29", n: 1 }];
    const [d] = escolherEspacos([peca({ hora: "09:00", ocupados, posts_por_mes: 30 })], SEGUNDA_10H);
    expect(d).toMatchObject({ acao: "agendar", dia: "2026-10-30" });
    const sexta = proximoEspaco(calendarioDoCliente({ ocupados: [{ dia: "2026-10-30", n: 1 }], posts_por_mes: 30 }),
      { hoje: "2026-10-30", agoraHora: "08:00", hora: "10:00", fimDeSemana: false });
    expect(sexta).toEqual({ dia: "2026-11-02", hora: "10:00" });
    const comFds = proximoEspaco(calendarioDoCliente({ ocupados: [{ dia: "2026-10-30", n: 1 }], posts_por_mes: 30 }),
      { hoje: "2026-10-30", agoraHora: "08:00", hora: "10:00", fimDeSemana: true });
    expect(comFds).toEqual({ dia: "2026-10-31", hora: "10:00" });
  });

  it("clientes diferentes não se atrapalham", () => {
    const ds = escolherEspacos([peca({ trabalho_id: "a" }), peca({ trabalho_id: "b", client_id: OUTRO })], SEGUNDA_10H);
    expect(ds.every((d) => d.acao === "agendar" && d.dia === "2026-10-26")).toBe(true);
  });

  it("não agenda sem aprovação, com o switch desligado, dispensada, sem post, com data ou antiga", () => {
    expect(impedimento(peca({ liberada: false }), SEGUNDA_10H)).toMatch(/aprovação/);
    expect(impedimento(peca({ ligado: false }), SEGUNDA_10H)).toMatch(/desligado/);
    expect(impedimento(peca({ dispensada: true }), SEGUNDA_10H)).toMatch(/não vai ser postada/);
    expect(impedimento(peca({ desfeito: true }), SEGUNDA_10H)).toMatch(/tirou a data/);
    expect(impedimento(peca({ post_id: null }), SEGUNDA_10H)).toMatch(/sem post/);
    expect(impedimento(peca({ tarefa_ok: false }), SEGUNDA_10H)).toMatch(/apagado/);
    expect(impedimento(peca({ publicacao_tem_data: true }), SEGUNDA_10H)).toMatch(/já tem data/);
    expect(impedimento(peca({ conta: false }), SEGUNDA_10H)).toMatch(/conta/);
    expect(impedimento(peca({ aprovado_em: "2026-09-01T12:00:00Z" }), SEGUNDA_10H)).toMatch(/aprovada há/);
    expect(impedimento(peca({ aprovado_em: "2026-09-01T12:00:00Z" }), SEGUNDA_10H, { incluirAntigas: true })).toBeNull();
    const [d] = escolherEspacos([peca({ liberada: false })], SEGUNDA_10H);
    expect(d.acao).toBe("pular");
  });

  it("o banco confere de novo antes de agendar: aprovação, dia livre, 9h às 20h, fim de semana, switch, transição oficial", () => {
    const sql = ler("supabase/migrations/20261027090000_aprovou_agenda_sozinho.sql");
    const aplicar = sql.slice(sql.indexOf("create or replace function public.agenda_sozinha_aplicar"));
    expect(aplicar).toContain("editorial_file_is_publishable");
    expect(aplicar).toContain("'dia_ocupado'");
    expect(aplicar).toContain("'fora_das_9h_as_20h'");
    expect(aplicar).toContain("'cliente_nao_posta_no_fim_de_semana'");
    expect(aplicar).toContain("'desligado_para_o_cliente'");
    expect(aplicar).toContain("transition_editorial_publication_unlocked(_pub.id, 'schedule'");
    expect(aplicar).toContain("capture_editorial_asset_snapshots");
    expect(aplicar).toContain("mesa_publicacao_segurada");
    expect(sql).toContain("grant execute on function public.agenda_sozinha_aplicar(uuid, timestamptz) to service_role;");
    expect(sql).toContain("cron.schedule('agenda-sozinha'");
    expect(sql).toContain("'acao', 'agenda_sozinha_interno'");
    // Sem linha de configuração = ligado (o switch já existia e vem ligado).
    expect(sql).toContain("'ligado', coalesce(x.agendar_ao_aprovar, true)");
  });

  it("a função recebe a ação interna e só grava fora da simulação", () => {
    const fn = ler("supabase/functions/agente-calendario/index.ts");
    expect(fn).toContain('acao === "agenda_sozinha_interno"');
    const corpo = fn.slice(fn.indexOf("async function agendaSozinhaInterno"), fn.indexOf("// ------------------------------------------ vigia do calendário (26/10"));
    expect(corpo).toContain('servico.rpc("agenda_sozinha_fatos")');
    expect(corpo).toContain('if (d.acao !== "agendar" || simular)');
    expect(corpo).toContain('servico.rpc("agenda_sozinha_aplicar"');
  });
});

// ─── 2. Torneira das tarefas ────────────────────────────────────

type Consulta = { tabela: string; op: string; valor?: unknown; filtros: Array<[string, string, unknown]> };
type Resposta = { data: unknown; error: unknown };

function bancoFalso(responder: (q: Consulta) => Resposta) {
  const consultas: Consulta[] = [];
  const from = (tabela: string) => {
    const q: Consulta = { tabela, op: "", filtros: [] };
    consultas.push(q);
    const b: Record<string, unknown> = {};
    const filtro = (nome: string) => (col: string, v?: unknown) => { q.filtros.push([nome, col, v]); return b; };
    Object.assign(b, {
      select: () => { if (!q.op) q.op = "select"; return b; },
      insert: (v: unknown) => { q.op = "insert"; q.valor = v; return b; },
      update: (v: unknown) => { q.op = "update"; q.valor = v; return b; },
      eq: filtro("eq"), neq: filtro("neq"), in: filtro("in"), is: filtro("is"), gte: filtro("gte"), gt: filtro("gt"), lt: filtro("lt"),
      contains: filtro("contains"), not: (c: string, o: string, v: unknown) => { q.filtros.push(["not", c, [o, v]]); return b; },
      order: () => b, limit: () => b, maybeSingle: () => b, single: () => b,
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(responder(q)).then(ok, erro),
    });
    return b;
  };
  return { consultas, banco: { from, rpc: async () => ({ data: null, error: null }) } };
}

function carregar(caminho: string, deps: Record<string, unknown>) {
  const js = transpileModule(ler(caminho), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const exp: Record<string, unknown> = {};
  new Function("exports", "require", "Deno", js)(exp, (n: string) => {
    if (!(n in deps)) throw new Error(`Unexpected dependency: ${n}`);
    return deps[n];
  }, { env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://x.supabase.co" : k === "SUPABASE_SERVICE_ROLE_KEY" ? "chave" : undefined) } });
  return exp as Record<string, any>;
}

const PROJETO = "44444444-4444-4444-8444-444444444444";
const DONO = "66666666-6666-4666-8666-666666666666";
const CHAVE_DO_PAPERCLIP = { keyId: "31aa8b16-36a4-4525-b095-04c70611caeb", origin: "mcp", correlationId: "c1", dataScope: { unrestricted: true, clientIds: [], principalUserId: null, source: "api_key" } };
const OAUTH_DO_DONO = { keyId: "oauth:06848537", origin: "oauth:claude-code:06848537", correlationId: "c2", dataScope: { unrestricted: true, clientIds: [], principalUserId: null, source: "oauth" } };

function servicoDeEscrita(agente: boolean) {
  const falso = bancoFalso((q) => {
    if (q.tabela === "operator_key_bindings") return { data: agente ? [{ operator_slug: "gestor-trafego" }] : [], error: null };
    if (q.tabela === "projects") return { data: { id: PROJETO, client_id: CLIENTE, deleted_at: null }, error: null };
    if (q.tabela === "profiles") return { data: { company_name: "Verzelo" }, error: null };
    if (q.tabela === "user_roles") return { data: [{ role: "manager" }], error: null };
    if (q.tabela === "tasks" && q.op === "insert") return { data: { id: "t-nova", ...(q.valor as object) }, error: null };
    return { data: [], error: null };
  });
  const mod = carregar("supabase/functions/_shared/mcp-write-services.ts", {
    "https://esm.sh/@supabase/supabase-js@2.45.4": { createClient: () => falso.banco },
    "https://esm.sh/zod@3.23.8": zod,
    "./mcp-security.ts": seguranca,
    "./mcp-client-id-guard.ts": guardaDoCliente,
  });
  return { ...falso, mod };
}

describe("create_task: torneira das tarefas de agente", () => {
  it("o que falta é dito item a item", async () => {
    const { mod } = servicoDeEscrita(true);
    expect(mod.faltaNaTarefaDeAgente({ client_id: CLIENTE, assigned_to: null, due_date: null })).toEqual(["dono (assigned_to)", "prazo (due_date)"]);
    expect(mod.faltaNaTarefaDeAgente({ client_id: null, assigned_to: DONO, due_date: "2026-10-30" })).toEqual(["cliente (projeto de um cliente)"]);
    expect(mod.principalDaEscrita(CHAVE_DO_PAPERCLIP)).toBe("key:31aa8b16-36a4-4525-b095-04c70611caeb");
    expect(mod.principalDaEscrita(OAUTH_DO_DONO)).toBe("oauth:claude-code");
  });

  it("agente sem dono e prazo é recusado com a mensagem clara e nada é criado", async () => {
    const { mod, consultas } = servicoDeEscrita(true);
    const input = mod.createTaskSchema.parse({ project_id: PROJETO, title: "Acompanhar anúncios", idempotency_key: "chave-agente-1" });
    await expect(mod.createTask(input, CHAVE_DO_PAPERCLIP)).rejects.toThrow(/tarefa de agente precisa de cliente, dono e prazo; prefira diário\/pedido ao dono/);
    expect(consultas.find((q) => q.tabela === "tasks" && q.op === "insert")).toBeUndefined();
    const vinculo = consultas.find((q) => q.tabela === "operator_key_bindings")!;
    expect(vinculo.filtros).toContainEqual(["eq", "principal", "key:31aa8b16-36a4-4525-b095-04c70611caeb"]);
  });

  it("agente com cliente, dono e prazo cria (no padrão Cliente · Área · assunto)", async () => {
    const { mod, consultas } = servicoDeEscrita(true);
    const input = mod.createTaskSchema.parse({ project_id: PROJETO, title: "Pausar anúncio com custo alto", idempotency_key: "chave-agente-2", assigned_to: DONO, due_date: "2026-10-30" });
    const r = await mod.createTask(input, CHAVE_DO_PAPERCLIP);
    expect(r).toMatchObject({ replayed: false, record: { id: "t-nova" } });
    const linha = consultas.find((q) => q.tabela === "tasks" && q.op === "insert")!.valor as Record<string, unknown>;
    expect(linha).toMatchObject({ assigned_to: DONO, due_date: "2026-10-30", title: "Verzelo · Tráfego · Pausar anúncio com custo alto" });
  });

  it("gente (credencial sem operador ligado) cria sem dono e sem prazo, como antes", async () => {
    const { mod, consultas } = servicoDeEscrita(false);
    const r = await mod.createTask(mod.createTaskSchema.parse({ project_id: PROJETO, title: "Ligar para o cliente", idempotency_key: "chave-dono-1" }), OAUTH_DO_DONO);
    expect(r).toMatchObject({ replayed: false, record: { id: "t-nova" } });
    expect(consultas.find((q) => q.tabela === "tasks" && q.op === "insert")).toBeDefined();
  });

  it("o MCP descreve a torneira e o guia avisa os agentes", () => {
    expect(ler("supabase/functions/_shared/mcp-tools.ts")).toContain("TORNEIRA (2.22): credencial de agente só cria tarefa com cliente, dono (assigned_to) e prazo (due_date)");
    expect(ler("supabase/functions/mcp-server/modulos/guia-do-painel.ts")).toContain("Torneira das tarefas (2.22)");
  });
});

describe("ritual: só ação concreta vira tarefa; o resto fica no resumo", () => {
  it("verbo de olhar, publicar post e título sem o quê ficam no resumo", () => {
    expect(tarefaVaga("Acompanhar anúncios")?.motivo).toBe("verbo_vago");
    expect(tarefaVaga("Revisar formatos")?.motivo).toBe("verbo_vago");
    expect(tarefaVaga("Comparar formatos de post e anúncio")?.motivo).toBe("verbo_vago");
    expect(tarefaVaga("Conferir destino e atendimento dos anúncios")?.motivo).toBe("verbo_vago");
    expect(tarefaVaga("Publicar post 10 | Sol, sombra ou meia-sombra")?.motivo).toBe("vai_pela_agenda");
    expect(tarefaVaga("Agendar posts das três peças prontas")?.motivo).toBe("vai_pela_agenda");
    expect(tarefaVaga("Subir verba")?.motivo).toBe("sem_o_que");
  });

  it("ação concreta com o quê vira tarefa", () => {
    expect(tarefaVaga("Ativar campanha de anúncios SOFTY | DIRECT")).toBeNull();
    expect(tarefaVaga("Produzir vídeo de antes e depois de móvel restaurado")).toBeNull();
    expect(tarefaVaga("Enviar relatório mensal de setembro")).toBeNull();
    const { tarefas, no_resumo } = separarTarefasDoRitual([{ titulo: "Editar os dois vídeos de outubro" }, { titulo: "Monitorar mensagens no Direct" }]);
    expect(tarefas.map((t) => t.titulo)).toEqual(["Editar os dois vídeos de outubro"]);
    expect(no_resumo[0]).toMatchObject({ titulo: "Monitorar mensagens no Direct" });
  });

  it("o escritor e a Central marcam a vaga (no_resumo) e a Central não cria tarefa dela", () => {
    const servidor = normalizarTarefas([{ titulo: "Acompanhar anúncios da semana", prazo_dias: 3 }, { titulo: "Gravar o vídeo da oferta de novembro", prazo_dias: 2 }]);
    expect(servidor[0].no_resumo).toMatch(/fica no resumo/);
    expect(servidor[1].no_resumo).toBeUndefined();
    const tela = tarefasSugeridas({ tarefas_sugeridas: [{ titulo: "Revisar formatos dos posts" }, { titulo: "Trocar o criativo da campanha de leads" }] });
    expect(tela[0].no_resumo).toBeTruthy();
    expect(tela[1].no_resumo).toBeUndefined();
    const api = ler("src/components/central/agenteCentralApi.ts");
    expect(api).toContain('if (tarefaVaga(input.tarefa.titulo)) return "vaga";');
    expect(ler("src/components/central/AgenteDaCentral.tsx")).toContain("Fica no resumo");
  });
});

describe("pauta nasce com dono e o arquivamento semanal nunca mexe em pauta", () => {
  it("pauta sem dono pega a pessoa da equipe ligada ao cliente", () => {
    const sv = ler("supabase/functions/_shared/mcp-write-services.ts");
    expect(sv).toContain("assigned_to: input.assigned_to ?? await donoPadraoDaPauta(input.client_id)");
    expect(sv).toContain(".from('team_client_assignments').select('user_id').eq('client_id', clientId)");
  });

  it("arquiva tarefa de agente sem dono há 14 dias, restaurável, toda segunda; nunca pauta nem pedido do cliente", () => {
    const sql = ler("supabase/migrations/20261027090100_arquivar_tarefas_sem_dono_de_agente.sql");
    const candidatos = sql.slice(sql.indexOf("-- [candidatos]"), sql.indexOf("-- [/candidatos]"));
    expect(candidatos).toContain("t.assigned_to is null");
    expect(candidatos).toContain("t.created_at < now() - interval '14 days'");
    expect(candidatos).toContain("not like 'mcp:editorial:%'");
    expect(candidatos).toContain("not like 'client_request:%'");
    expect(candidatos).toContain("<> 'vigia:calendario'");
    expect(candidatos).toContain("from public.estudio_trabalhos e where e.task_id = t.id");
    expect(sql).toContain("insert into app_private.arquivo_limpeza (lote, tabela, acao, linha)");
    expect(sql).toContain("update public.tasks t set deleted_at = now()");
    expect(sql).not.toMatch(/delete\s+from\s+public\.tasks/i);
    expect(sql).toContain("create or replace function public.arquivo_de_tarefas_restaurar(_lote text)");
    expect(sql).toContain("cron.schedule('arquivar-tarefas-sem-dono', '30 10 * * 1'");
    // O pg_cron (sem JWT) passa; gente logada só se for admin.
    expect(sql).toContain("if coalesce(auth.role(), '') = 'authenticated' and not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then");
  });
});

// ─── 3. Boletim de anúncios que sempre chega ────────────────────

const AGORA = new Date("2026-10-27T12:15:00Z"); // terça 9h15 em São Paulo
const conversa = (n: number) => [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: String(n) }];
const dias = (de: number, ate: number, f: (i: number) => { spend: number; actions?: unknown }) =>
  Array.from({ length: ate - de + 1 }, (_, k) => {
    const i = de + k;
    return { day: new Date(Date.UTC(2026, 9, 27 - i)).toISOString().slice(0, 10), ...f(i) };
  });

function fatos(extra: Partial<FatosDoBoletim> = {}): FatosDoBoletim {
  return {
    hoje: "2026-10-27",
    boletins_hoje: [],
    campanhas: [{
      client_id: CLIENTE, cliente: "Verzelo", campaign_id: "c-boa", nome: "VERZELO | Direct | boa", effective_status: "ACTIVE",
      start_time: "2026-09-01T00:00:00Z", stop_time: null,
      dias: dias(1, 30, () => ({ spend: 10, actions: conversa(1) })),
    }],
    contas: [{ client_id: CLIENTE, cliente: "Verzelo", saldo_disponivel: 500, is_prepay_account: true }],
    ...extra,
  };
}

describe("boletim mínimo: só exceções, sem duplicar", () => {
  it("conta saudável não gera exceção e o resumo diz isso", () => {
    expect(excecoesDoDia(fatos(), AGORA)).toEqual([]);
    const b = boletimMinimo(fatos(), AGORA);
    expect(b).toMatchObject({ pular: false, periodo: "09h", alertas: [] });
    expect((b as Gravado).resumo).toMatch(/nenhuma exceção/);
  });

  it("não grava quando o agente já gravou o boletim do dia", () => {
    const b = boletimMinimo(fatos({ boletins_hoje: [{ periodo: "09h", principal: "key:31aa8b16", operator_slug: "gestor-trafego" }] }), AGORA);
    expect(b).toEqual({ pular: true, motivo: expect.stringMatching(/já existe boletim de hoje/) });
  });

  it("acha cada exceção pela regra fixa", () => {
    const f = fatos({
      campanhas: [
        // Média do cliente: R$ 10 por conversa.
        ...fatos().campanhas,
        // Custo por resultado 7 dias = R$ 50 (mais de 2x a média do cliente, ~R$ 19,50).
        { client_id: CLIENTE, cliente: "Verzelo", campaign_id: "c-cara", nome: "Cara", effective_status: "ACTIVE", start_time: "2026-09-01T00:00:00Z", dias: dias(1, 7, () => ({ spend: 50, actions: conversa(1) })) },
        // R$ 60 sem resultado desde a última conversa.
        { client_id: CLIENTE, cliente: "Verzelo", campaign_id: "c-seca", nome: "Seca | WhatsApp", effective_status: "ACTIVE", start_time: "2026-09-01T00:00:00Z", dias: [...dias(5, 5, () => ({ spend: 5, actions: conversa(1) })), ...dias(1, 4, () => ({ spend: 15 }))] },
        // Ativa, sem gasto há 4 dias.
        { client_id: CLIENTE, cliente: "Verzelo", campaign_id: "c-parada", nome: "Parada", effective_status: "ACTIVE", start_time: "2026-09-01T00:00:00Z", dias: dias(5, 10, () => ({ spend: 4 })) },
        // Termina amanhã.
        { client_id: CLIENTE, cliente: "Verzelo", campaign_id: "c-fim", nome: "Fim", effective_status: "ACTIVE", start_time: "2026-09-01T00:00:00Z", stop_time: "2026-10-28T23:00:00Z", dias: dias(1, 3, () => ({ spend: 1 })) },
      ],
      contas: [{ client_id: CLIENTE, cliente: "Verzelo", saldo_disponivel: 50, is_prepay_account: true }],
    });
    const tipos = excecoesDoDia(f, AGORA).map((e) => `${e.tipo}:${e.texto.split(":")[0]}`);
    expect(tipos).toEqual(expect.arrayContaining(["custo_alto:Cara", "gasto_sem_resultado:Seca | WhatsApp", "sem_gasto:Parada", "terminando:Fim"]));
    expect(tipos.some((t) => t.startsWith("saldo_curto"))).toBe(true);
    expect(tipos.some((t) => t.endsWith(":VERZELO | Direct | boa"))).toBe(false);
    const b = boletimMinimo(f, AGORA);
    expect(b.pular).toBe(false);
    const g = b as Gravado;
    expect(g.alertas.every((a) => ["info", "atencao", "critico"].includes(a.nivel))).toBe(true);
    expect(g.alertas[0].nivel).toBe("critico");
    expect(g.por_cliente).toEqual([expect.objectContaining({ client_id: CLIENTE })]);
  });

  it("o cron grava pelo ads_boletim_registrar (um aviso) às 9h15 dos dias úteis", () => {
    const fn = ler("supabase/functions/mesa-ads/index.ts");
    expect(fn).toContain('if (acaoDoCron === "boletim_minimo_cron") return await boletimMinimoCron(servico, doCron.simular === true);');
    expect(fn).toContain('servico.rpc("ads_boletim_registrar"');
    const sql = ler("supabase/migrations/20261027090200_boletim_minimo_de_anuncios.sql");
    expect(sql).toContain("cron.schedule('ads-boletim-minimo', '15 12 * * 1-5'");
    expect(sql).toContain("'boletins_hoje'");
    expect(sql).toContain("grant execute on function public.ads_boletim_minimo_fatos() to service_role;");
  });

  it("o MCP aceita nivel medio/baixo/alto no boletim (o que derrubou o do Hermes em 26/10)", () => {
    const mod = carregar("supabase/functions/mcp-server/modulos/anuncios-registro.ts", {
      "https://esm.sh/zod@3.23.8": zod,
      "../../_shared/aceleriq-read-services.ts": { db: () => null },
      "../../_shared/mcp-security.ts": seguranca,
      "./autoria.ts": { principalDaChamada: () => "key:x" },
    });
    const ok = mod.boletimSchema.parse({ periodo: "17h30", resumo: "ok", alertas: [{ nivel: "medio", texto: "a" }, { nivel: "Alto", texto: "b" }, { nivel: "baixo", texto: "c" }] });
    expect(ok.alertas.map((a: { nivel: string }) => a.nivel)).toEqual(["atencao", "critico", "info"]);
    expect(() => mod.boletimSchema.parse({ periodo: "09h", resumo: "x", alertas: [{ nivel: "talvez", texto: "a" }] })).toThrow(/use info, atencao ou critico/);
  });
});
