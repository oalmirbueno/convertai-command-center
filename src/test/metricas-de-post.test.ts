import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * As métricas de post paravam por três dias.
 *
 * O robô roda de 10 em 10 minutos, mas só buscava os posts de uma conta
 * se ela não tivesse NENHUM post colhido nos últimos três dias. Colheu às
 * 13:10 de hoje? A próxima coleta daquela conta era dia 31.
 *
 * Medido em produção antes do conserto: social_metrics_tick() devolvia
 * dispatched 0 com doze contas ativas, e zero posts colhidos na última
 * meia hora. Não havia falha: o robô rodava, olhava, decidia que estava
 * tudo fresco e voltava a dormir.
 */

const raiz = resolve(__dirname, "../..");
const sql = readFileSync(
  resolve(raiz, "supabase/migrations/20260828070000_metricas_de_post_a_cada_meia_hora.sql"), "utf8",
);
const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("coleta de posts a cada meia hora", () => {
  it("troca a carencia de tres dias por meia hora", () => {
    // O SQL escapa a aspa (E'...\'...'), entao a comparacao literal aqui
    // erra por um caractere. O que importa e a SUBSTITUICAO: sai 3 days,
    // entra 30 minutes, no mesmo trecho de captured_at.
    expect(codigo).toMatch(/_velho\s*:=.*captured_at.*3 days/);
    expect(codigo).toMatch(/_novo\s*:=.*captured_at.*30 minutes/);
  });

  it("o patch e VERIFICADO: trecho ausente aborta em vez de sobrescrever", () => {
    // Substituicao contada falha alto se a versao em producao mudou, em
    // vez de gravar por cima de uma funcao diferente da que eu li.
    expect(codigo).toContain("position(_velho IN _fonte) = 0");
    expect(codigo).toContain("RAISE EXCEPTION");
    expect(codigo).toContain("nada foi alterado");
  });

  it("rodar de novo com o patch aplicado nao faz nada", () => {
    expect(codigo).toContain("position(_novo IN _fonte) > 0");
    expect(codigo).toContain("nada a fazer");
  });

  it("meia hora e escolha justificada, nao chute", () => {
    // O robo de anuncios desta mesma casa ja usa 30 minutos: a excecao
    // eram os tres dias, nao o contrario. E o alarme de atraso so fala
    // aos 90 minutos, entao meia hora da tres coletas de folga antes de
    // qualquer acusacao. Ir a dez minutos gastaria cota do Graph para
    // adiantar um dado que ninguem le antes de 90 minutos.
    expect(sql).toContain("24 chamadas por hora");
    expect(sql).toContain("tres coletas de folga");
  });

  it("nao mexe em mais nada da funcao", () => {
    // Uma unica substituicao, de um unico trecho.
    expect((codigo.match(/replace\(_fonte, _velho, _novo\)/g) ?? []).length).toBe(1);
    expect(codigo).not.toMatch(/CREATE OR REPLACE FUNCTION public\.social_metrics_tick/);
  });
});

describe("seguidores do dia de hoje", () => {
  const sql = readFileSync(
    resolve(raiz, "supabase/migrations/20260828080000_seguidores_do_dia_de_hoje.sql"), "utf8",
  );
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("mira a semana CORRENTE, nao a fechada", () => {
    // O robo antigo mirava date_trunc('week', now) - 7. Numero de
    // seguidores e um valor de agora, e nunca era buscado para a semana
    // em curso: os doze clientes exibiam o retrato de 24/08 no dia 28.
    expect(codigo).toContain("date_trunc(\n    'week', (now() at time zone 'America/Sao_Paulo')::date::timestamp\n  )::date;");
    expect(codigo).not.toContain(")::date - 7");
  });

  it("perfil a cada 30 minutos, alcance a cada 3 horas", () => {
    expect(codigo).toContain("_kind = 'profile' and _idade < interval '30 minutes'");
    expect(codigo).toContain("_kind <> 'profile' and _idade < interval '3 hours'");
  });

  it("o until da consulta nunca cai no futuro", () => {
    // Semana corrente termina no domingo que ainda nao chegou. Pedir
    // insight ate uma data futura e pedir dado que nao existe: o Graph
    // recusa e a linha termina com erro gravado.
    expect(codigo).toContain("least(_fim, (now() at time zone 'America/Sao_Paulo')::date)");
    expect(codigo).toContain("_inicio, _fim_consulta)");
  });

  it("mas o week_end gravado continua sendo o domingo de verdade", () => {
    // Senao a linha mentiria sobre qual semana ela representa.
    expect(codigo).toContain("values (_acct.id, _acct.client_id, _kind, _rid, _inicio, _fim)");
  });

  it("nao despacha dois pedidos iguais em voo", () => {
    expect(codigo).toContain("and r.kind = _kind");
    expect(codigo).toContain("continue;");
  });

  it("conta sem token e pulada, nao e erro", () => {
    expect(codigo).toContain("if _token is null then continue; end if;");
  });

  it("quem grava continua sendo o parse de sempre", () => {
    // Caminho paralelo de escrita e o que um dia diverge do original.
    // Esta funcao SO despacha: nao escreve em social_metrics_weekly.
    expect(codigo).not.toMatch(/insert into public\.social_metrics_weekly/i);
    expect(codigo).not.toMatch(/update public\.social_metrics_weekly/i);
    expect(codigo).toContain("public.social_metrics_tick()");
  });

  it("a semana ja fechada nao e reescrita", () => {
    // Numero de periodo encerrado nao muda, e reescrever seria apagar
    // historico. Nenhum delete ou update em metricas antigas.
    expect(codigo).not.toMatch(/delete from public\.social_metrics_weekly/i);
  });

  it("o cron passa a chamar o ciclo completo", () => {
    expect(codigo).toContain("social_metrics_ciclo()");
    expect(codigo).toContain("'social-metrics', '*/10 * * * *'");
  });
});
