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

describe("o painel aprende que o post ja saiu", () => {
  const rec = readFileSync(
    resolve(raiz, "supabase/migrations/20260828050000_o_painel_aprende_o_que_ja_saiu.sql"), "utf8",
  );
  const codigo = rec.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("olha os posts REAIS da conta, nao adivinha", () => {
    // O painel ja colhe media_id, permalink e hora de cada post publicado.
    // Reconciliar e cruzar agendamento vencido com essa realidade.
    expect(codigo).toContain("from public.social_post_metrics m");
    expect(codigo).toContain("m.external_account_id = _pub.external_account_id");
  });

  it("a janela e apertada: meia hora antes, seis horas depois", () => {
    // Publicados 3 a 4 minutos depois do horario marcado, no caso real.
    // Janela larga demais alcancaria o post do dia seguinte.
    expect(codigo).toContain("_pub.scheduled_at - interval '30 minutes'");
    expect(codigo).toContain("_pub.scheduled_at + interval '6 hours'");
  });

  it("DUVIDA NAO VIRA ESCRITA: dois candidatos e nao mexe", () => {
    // Chutar qual post pertence a qual agendamento gravaria o link errado
    // no historico do cliente. E registro publicado e imutavel: sem volta.
    expect(codigo).toContain("if _quantos > 1 then");
    expect(codigo).toContain("_ambiguos := _ambiguos + 1;");
    expect(codigo).toContain("continue;");
  });

  it("post ja reivindicado por outro agendamento nao conta duas vezes", () => {
    expect(codigo).toContain("q.permalink = m.permalink");
  });

  it("sem endereco publico valido nao ha baixa", () => {
    expect(codigo).toContain("'^https?://[^[:space:]]+$'");
  });

  it("status, endereco e hora vao juntos: publicado e imutavel", () => {
    const upd = codigo.slice(codigo.indexOf("update public.editorial_publications"));
    expect(upd.slice(0, 260)).toContain("status = 'published'");
    expect(upd.slice(0, 260)).toContain("permalink =");
    expect(upd.slice(0, 260)).toContain("published_at =");
  });

  it("o aviso sai pelo recibo de sempre, nao por um caminho paralelo", () => {
    // Caminho paralelo e o que um dia diverge do original e passa a mentir.
    expect(codigo).toContain("update public.editorial_publication_internal");
    expect(codigo).toContain("set published_by = _quem");
  });

  it("reconcilia ANTES de alarmar, senao o alarme mente e nao se repete", () => {
    const ordem = codigo.indexOf("editorial_reconciliar_publicados()");
    const alarme = codigo.lastIndexOf("editorial_alerta_agendamento_atrasado()");
    expect(ordem).toBeGreaterThan(-1);
    expect(alarme).toBeGreaterThan(ordem);
    expect(codigo).toContain("editorial_conferir_agendamentos");
  });

  it("o alarme afirma que o painel CONFERIU a conta", () => {
    expect(codigo).toContain("o painel conferiu a conta e nao achou nenhum post");
    expect(codigo).toContain("MAIS DE UM post na conta nessa janela");
  });

  it("continua sem ligar automacao de ninguem", () => {
    expect(codigo).not.toMatch(/automation_enabled\s*=\s*true/i);
    expect(codigo).not.toMatch(/delivery_mode\s*=\s*'automatic'/i);
  });
});
