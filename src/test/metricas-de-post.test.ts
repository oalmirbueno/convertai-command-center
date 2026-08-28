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
