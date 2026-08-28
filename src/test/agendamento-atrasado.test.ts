import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O agendamento que passou da hora e não saiu.
 *
 * A auditoria do relato "quando publica alguns clientes não avisa" achou
 * outra coisa: publicações agendadas, vencidas, com a arte aprovada pela
 * agência E pelo cliente, que simplesmente não foram ao ar — porque estão
 * em delivery_mode manual e o publicador automático só olha para
 * automatic. Sem falha, sem erro, sem fila, e sem aviso.
 */

const raiz = resolve(__dirname, "../..");
const sql = readFileSync(
  resolve(raiz, "supabase/migrations/20260828040000_agendamento_que_nao_saiu.sql"), "utf8",
);
const semComentario = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("atraso de publicacao deixa de ser silencioso", () => {
  it("pega agendada, vencida, e ainda parada", () => {
    expect(semComentario).toContain("p.status = 'scheduled'");
    expect(semComentario).toContain("p.scheduled_at < now() - interval '15 minutes'");
  });

  it("a carencia existe para nao gritar em publicacao normal", () => {
    // O publicador roda de minuto em minuto e a entrega leva segundos:
    // avisar no segundo seguinte ao horario daria alarme falso sempre.
    expect(sql).toContain("Carencia de 15 minutos");
  });

  it("avisa uma vez por publicacao, senao vira metronomo", () => {
    expect(semComentario).toContain("not exists (");
    expect(semComentario).toContain("n.notification_type = 'agendamento_atrasado'");
  });

  it("a mensagem diz o que fazer, e o motivo certo para cada caso", () => {
    // Aviso sem saida so gera aflicao. Cada causa tem uma acao diferente.
    expect(semComentario).toContain("a conta esta em modo manual");
    expect(semComentario).toContain("ligue a automacao dessa conta");
    expect(semComentario).toContain("nao esta aprovada dos dois lados");
    expect(semComentario).toContain("verifique a conexao da conta");
  });

  it("NAO liga a automacao de ninguem por efeito colateral", () => {
    // Publicar sozinho na conta de um cliente e decisao do dono, conta
    // por conta. Migration que liga isso sozinha publica em nome de
    // terceiro sem ninguem ter escolhido.
    expect(semComentario).not.toMatch(/update\s+public\.external_account_connections/i);
    expect(semComentario).not.toMatch(/automation_enabled\s*=\s*true/i);
    expect(semComentario).not.toMatch(/delivery_mode\s*=\s*'automatic'/i);
  });

  it("nao publica nada: so escreve notificacao", () => {
    const escritas = semComentario.match(/(?:insert into|update|delete from)\s+public\.(\w+)/gi) ?? [];
    expect(escritas.length).toBeGreaterThan(0);
    for (const e of escritas) {
      expect(e, `escreve fora de notifications: ${e}`).toMatch(/notifications/i);
    }
  });

  it("o horario sai no fuso de quem le, nao em UTC", () => {
    expect(semComentario).toContain("America/Sao_Paulo");
  });

  it("roda sozinho, de 15 em 15 minutos", () => {
    expect(semComentario).toContain("editorial-agendamento-atrasado");
    expect(semComentario).toContain("*/15 * * * *");
  });
});
