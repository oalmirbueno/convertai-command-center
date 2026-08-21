import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Atividade,
  type Lead,
  agendaDoLead,
  previsaoDoMes,
  resumoDoFunil,
} from "@/lib/comercial";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const migration = ler("supabase/migrations/20260821210000_crm_atividades_e_previsao.sql");
const lib = ler("src/lib/comercial.ts");
const kanban = ler("src/components/comercial/FunilKanban.tsx");
const agenda = ler("src/components/comercial/AgendaComercial.tsx");
const atividadesDoLead = ler("src/components/comercial/AtividadesDoLead.tsx");

const lead = (parcial: Partial<Lead>): Lead => ({
  id: parcial.id || "l1",
  name: "Lead",
  company: null,
  email: null,
  whatsapp: null,
  origin: "manual",
  campaign_id: null,
  quiz_submission_id: null,
  stage: "novo",
  monthly_value: 0,
  one_off_value: 0,
  owner_id: null,
  next_action: null,
  next_action_at: null,
  notes: null,
  lost_reason: null,
  won_client_id: null,
  closed_at: null,
  created_at: "2026-08-10T12:00:00Z",
  expected_close_date: null,
  organization_id: null,
  contact_id: null,
  ...parcial,
});

const atividade = (parcial: Partial<Atividade>): Atividade => ({
  id: parcial.id || "a1",
  lead_id: "l1",
  kind: "ligacao",
  title: "Ligar",
  due_at: "2026-08-20T14:00:00Z",
  done_at: null,
  owner_id: null,
  notes: null,
  ...parcial,
});

/**
 * O funil movia o lead de coluna, mas isso é o quadro — não é o CRM. O que
 * faltava é o que um comercial faz ENTRE uma coluna e outra: a ligação de
 * terça, a reunião de quinta, a proposta de sexta. O lead tinha um único
 * campo de texto para isso, e marcar a ligação como feita apagava a reunião.
 */

describe("o lead tem agenda, não um campo de texto", () => {
  it("a próxima é a aberta mais próxima, não a última criada", () => {
    const resultado = agendaDoLead(
      [
        atividade({ id: "a", due_at: "2026-08-25T10:00:00Z" }),
        atividade({ id: "b", due_at: "2026-08-21T10:00:00Z" }),
        atividade({ id: "c", due_at: "2026-08-19T10:00:00Z", done_at: "2026-08-19T11:00:00Z" }),
      ],
      "l1",
      "2026-08-20T12:00:00Z",
    );
    expect(resultado.proxima?.id).toBe("b");
    expect(resultado.abertas).toBe(2);
  });

  it("atrasada é medida pelo relógio, não por data solta", () => {
    const resultado = agendaDoLead(
      [
        atividade({ id: "a", due_at: "2026-08-20T09:00:00Z" }),
        atividade({ id: "b", due_at: "2026-08-20T18:00:00Z" }),
      ],
      "l1",
      "2026-08-20T12:00:00Z",
    );
    expect(resultado.atrasadas).toBe(1);
  });

  it("concluída sai da conta de aberto", () => {
    const resultado = agendaDoLead(
      [atividade({ done_at: "2026-08-20T15:00:00Z" })],
      "l1",
      "2026-08-21T12:00:00Z",
    );
    expect(resultado.abertas).toBe(0);
    expect(resultado.atrasadas).toBe(0);
    expect(resultado.proxima).toBeNull();
  });

  it("a agenda de um lead não contamina a de outro", () => {
    const resultado = agendaDoLead(
      [atividade({ lead_id: "outro", due_at: "2026-08-01T10:00:00Z" })],
      "l1",
      "2026-08-20T12:00:00Z",
    );
    expect(resultado.abertas).toBe(0);
  });

  it("o resumo do funil passou a ler a agenda", () => {
    // Antes lia next_action_at: um texto que ninguém atualizava quando o
    // combinado mudava.
    const leads = [lead({ id: "l1", stage: "proposta" }), lead({ id: "l2", stage: "contato" })];
    const resumo = resumoDoFunil(leads, "2026-08-01", "2026-08-20T12:00:00Z", [
      atividade({ lead_id: "l1", due_at: "2026-08-19T10:00:00Z" }),
    ]);
    expect(resumo.atrasados).toBe(1);
    expect(resumo.semProximoPasso).toBe(1);
  });

  it("concluir empurra a linha para a história do lead", () => {
    // É o que responde "o que já tentaram aqui" quando outra pessoa pega a
    // conversa na semana seguinte.
    expect(lib).toContain('kind: "atividade"');
  });
});

describe("previsão: soma pesada, e o que ela não enxerga", () => {
  it("pondera pela chance do estágio", () => {
    // Previsão que trata primeiro contato e proposta enviada como a mesma
    // coisa não é previsão — é soma.
    const previsao = previsaoDoMes(
      [
        lead({ id: "a", stage: "proposta", monthly_value: 1000, expected_close_date: "2026-08-15" }),
        lead({ id: "b", stage: "novo", monthly_value: 1000, expected_close_date: "2026-08-20" }),
      ],
      "2026-08-01",
    );
    expect(previsao.bruto).toBe(24000);
    // 12000 × 0,6 + 12000 × 0,1
    expect(previsao.ponderado).toBeCloseTo(8400, 5);
    expect(previsao.leads).toBe(2);
  });

  it("diz quantos ficaram de fora por não ter data", () => {
    // Previsão só sobre quem tem data parece precisa e esconde metade do
    // funil; sem este número ela vira promessa.
    const previsao = previsaoDoMes(
      [
        lead({ id: "a", stage: "proposta", expected_close_date: "2026-08-15" }),
        lead({ id: "b", stage: "proposta" }),
        lead({ id: "c", stage: "contato" }),
      ],
      "2026-08-01",
    );
    expect(previsao.semData).toBe(2);
  });

  it("lead já fechado não entra na previsão", () => {
    const previsao = previsaoDoMes(
      [lead({ stage: "ganho", monthly_value: 5000, expected_close_date: "2026-08-10" })],
      "2026-08-01",
    );
    expect(previsao.leads).toBe(0);
    expect(previsao.bruto).toBe(0);
  });

  it("o mês seguinte fica fora da conta do mês", () => {
    const previsao = previsaoDoMes(
      [lead({ stage: "proposta", monthly_value: 1000, expected_close_date: "2026-09-01" })],
      "2026-08-01",
    );
    expect(previsao.leads).toBe(0);
  });
});

describe("a agenda cobra pelo sininho do painel", () => {
  it("o robô grava na mesma tabela de notificações do resto do painel", () => {
    expect(migration).toContain("insert into public.notifications");
    expect(migration).toContain("'/comercial'");
  });

  it("avisa uma vez por dia, não a cada rodada", () => {
    // Sem isto o sininho vira ruído que ninguém abre.
    expect(migration).toContain("reminded_on date");
    expect(migration).toContain("atividade.reminded_on < _hoje");
    expect(migration).toContain("set reminded_on = _hoje");
  });

  it("atividade sem dono avisa os admins — é a que ninguém está olhando", () => {
    expect(migration).toContain("coalesce(atividade.owner_id, papel.user_id)");
  });

  it("o robô NÃO é security definer, e a API não pode chamá-lo", () => {
    // Quem chama é o cron, que já passa por cima do RLS; dar poder de
    // definer a uma função que escreve notificação seria abrir uma porta
    // que ninguém precisa.
    const funcao = migration.slice(
      migration.indexOf("create or replace function public.commercial_activity_reminders"),
      migration.indexOf("revoke all on function"),
    );
    expect(funcao.length).toBeGreaterThan(500);
    expect(funcao).not.toContain("security definer");
    expect(migration).toContain(
      "revoke execute on function public.commercial_activity_reminders() from authenticated",
    );
  });

  it("os ids saem antes, para marcar exatamente quem gerou aviso", () => {
    // Um CTE não sobrevive de um comando para o outro: a primeira versão
    // marcava "já avisei" com um SELECT que o UPDATE não enxergava.
    expect(migration).toContain("select array_agg(escolhidas.id) into _ids");
    expect(migration).toContain("where id = any(_ids)");
  });

  it("roda uma vez por dia, de manhã", () => {
    // Lembrete de madrugada some antes de alguém abrir o painel; de hora em
    // hora vira ruído.
    expect(migration).toContain("'0 11 * * *'");
    expect(migration).toContain("comercial-lembretes");
  });

  it("a tabela de atividades também é só de admin e manager", () => {
    expect(migration).toContain(
      "alter table public.commercial_activities enable row level security",
    );
    expect(migration).toContain("revoke all on public.commercial_activities from anon");
    expect(migration).toContain("public.has_role(auth.uid(), 'manager'::public.app_role)");
  });
});

describe("a agenda do dia existe como tela", () => {
  it("virou calendario de mes, e nao mais tres listas", () => {
    // A lista respondia "o que faco agora"; o calendario responde "como
    // esta minha semana", que e a pergunta de quem vai marcar reuniao.
    expect(agenda).toContain("grid-cols-7");
    expect(agenda).not.toContain('titulo: "Atrasadas"');
  });

  it("o que passou da hora continua gritando", () => {
    expect(agenda).toContain("compromissos passaram da hora");
  });

  it("dá para concluir sem abrir o lead", () => {
    expect(agenda).toContain("concluirAtividade(atividade, !feita)");
  });

  it("o lead abre a partir da atividade", () => {
    expect(agenda).toContain("onAbrirLead(lead)");
  });

  it("aberta antes de concluída na lista do lead", () => {
    // Concluída no topo empurraria o compromisso de hoje para baixo
    // justamente quando ele importa.
    expect(atividadesDoLead).toContain("const abertaA = a.done_at ? 1 : 0;");
  });
});

describe("dono e previsão entram no cadastro do lead", () => {
  it("o lead grava dono e data prevista", () => {
    expect(lib).toContain("expected_close_date: lead.expected_close_date || null");
    expect(lib).toContain("owner_id: lead.owner_id || null");
  });

  it("o cartão do funil mostra o compromisso, não uma anotação", () => {
    expect(kanban).toContain("agenda.proxima");
    expect(kanban).toContain("sem próximo passo");
    expect(kanban).not.toContain("lead.next_action &&");
  });

  it("o índice do banco existe para as duas consultas novas", () => {
    expect(migration).toContain("commercial_leads_por_previsao");
    expect(migration).toContain("commercial_activities_abertas");
  });
});
