import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Os 14 "incidentes" que nunca foram incidentes, e o Kanban parado.
 *
 * O mapa de eventos era `... when 'blocked' then 'blocked' else 'progress'`.
 * `review` e `awaiting_input` caiam no else e viravam `progress` — "ainda
 * executando" — e quinze minutos depois o expirador matava como timeout.
 * Todos os 14 de 29/08 sao isso: agentes que TERMINARAM e ficaram
 * esperando um humano. Alarme que grita onde deu certo esconde a falha
 * de verdade.
 *
 * E `operator_report_event` nunca tocava em tarefas, entao o card ficava
 * parado enquanto o agente ja trabalhava nele.
 */

const raiz = resolve(__dirname, "../..");
const migracao = readFileSync(
  resolve(raiz, "supabase/migrations/20260901010000_agente_termina_e_o_kanban_anda.sql"), "utf8");

describe("esperar humano nao e executar", () => {
  it("review e awaiting_input viram estados do run", () => {
    expect(migracao).toContain("when 'review' then 'review'");
    expect(migracao).toContain("when 'awaiting_input' then 'awaiting_input'");
  });

  it("o CHECK aceita os dois estados novos", () => {
    expect(migracao).toContain("'review','awaiting_input'");
  });

  it("so repara o timeout que era falso", () => {
    // Timeout de verdade (vinculo em in_progress) fica como esta: apagar
    // isso seria reescrever historia.
    expect(migracao).toContain("and l.status in ('review', 'awaiting_input')");
    expect(migracao).toContain("and r.error = 'timeout: sem heartbeat dentro do prazo'");
  });
});

describe("o card anda, mas so ate a revisao", () => {
  it("started tira da fila", () => {
    expect(migracao).toContain("when _event = 'started' and _status_atual in ('backlog','todo') then 'doing'");
  });

  it("done nunca leva o card alem de review", () => {
    // Se o agente pudesse fechar, "concluido" deixaria de significar
    // "alguem conferiu".
    const fn = migracao.slice(migracao.indexOf("operator_status_do_card"));
    const corpo = fn.slice(0, fn.indexOf("$$;"));
    expect(corpo).not.toMatch(/'(done|approved)'\s*$/m);
    expect(corpo).toContain("then 'review' else null end");
  });

  it("bloqueio e espera NAO movem o card", () => {
    // O trabalho continua sendo daquela coluna.
    const fn = migracao.slice(migracao.indexOf("operator_status_do_card"));
    const corpo = fn.slice(0, fn.indexOf("$$;"));
    expect(corpo).toContain("else null");
    expect(corpo).not.toContain("'blocked'");
  });

  it("assigned_to nao e ESCRITO", () => {
    // O comentário do bloco cita assigned_to para dizer que não o toca —
    // procurar a palavra reprovaria a própria explicação. O que não pode
    // existir é a ESCRITA: mover a coluna diz em que pé está o trabalho;
    // dizer de quem ele é continua sendo decisão humana.
    const escritas = migracao.match(/assigned_to\s*=/g) ?? [];
    expect(escritas).toHaveLength(0);
    expect(migracao).not.toMatch(/update\s+public\.tasks\s+set\s+assigned_to/i);
  });

  it("mover o card nao derruba o relato", () => {
    // O trabalho aconteceu; se o Kanban recusar, vira nota na trilha.
    expect(migracao).toContain("card NAO moveu: ");
  });
});

describe("o patch e cirurgico e aborta se a forma mudou", () => {
  it("usa a definicao viva, nao reescreve o corpo inteiro", () => {
    expect(migracao).toContain("pg_get_functiondef(_oid)");
    expect(migracao).toContain("execute _def;");
  });

  it("duas ancoras, e excecao se faltar qualquer uma", () => {
    expect((migracao.match(/patch_ancora_nao_encontrada/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("desativar quem tem historico, em vez de recusar", () => {
  const fn = readFileSync(resolve(raiz, "supabase/functions/manage-team/index.ts"), "utf8");
  const tela = readFileSync(resolve(raiz, "src/pages/Team.tsx"), "utf8");

  it("as acoes existem", () => {
    expect(fn).toContain('action === "deactivate" || action === "reactivate"');
  });

  it("o acesso cai de verdade, e nao so some da lista", () => {
    expect(fn).toContain("ban_duration");
  });

  it("nunca deixa a casa sem administrador", () => {
    expect(fn).toContain("Rebaixe o administrador antes de desativar");
  });

  it("a tela cai para desativacao quando a exclusao recusa por historico", () => {
    expect(tela).toContain("editorial_history_conflict");
    expect(tela).toContain('action: "deactivate"');
  });

  it("desativado sai da equipe ativa", () => {
    const hook = readFileSync(resolve(raiz, "src/hooks/useSupabaseData.ts"), "utf8");
    expect(hook).toContain('.is("deleted_at", null)');
  });
});
