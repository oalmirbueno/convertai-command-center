import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 30/10/2026 (dono: "está muito agendamento falhando, não pode ficar falhando toda hora"). As falhas medidas eram
 * "Cartao N do carrossel falhou: Timeout of 20000 ms reached ... TCP/SSL handshake": tropeço de rede com a Meta,
 * que esgotava as 4 tentativas em poucos minutos.
 */
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261030100000_agendamento_resiste_a_rede.sql"), "utf8");

describe("motor de publicação resiste a tropeço de rede", () => {
  it("erro de rede (tempo esgotado, sem resposta, 5xx, 429) tem 12 tentativas, por cartão no carrossel", () => {
    expect(sql).toContain("_limite_transitorio constant smallint := 12;");
    expect(sql).toContain("_transitorio := _response.timed_out OR _response.status_code IS NULL OR _response.status_code >= 500 OR _response.status_code = 429;");
    expect(sql).toContain("IF _job.step_attempts >= (CASE WHEN _transitorio THEN _limite_transitorio * _cartoes ELSE _step_limit END) THEN");
  });

  it("espera crescente antes de tentar de novo (30 s a 5 min), nos cartões e no passo comum", () => {
    expect(sql.split("make_interval(secs => least(300, 30 * greatest(1,").length - 1).toBe(2);
    expect(sql).toContain("'[rede] '");
    expect(sql).toContain("IF _job.step_attempts >= (CASE WHEN COALESCE(_job.last_error, '') LIKE '[rede]%' THEN _limite_transitorio ELSE _step_limit END) THEN");
  });

  it("recusa de verdade da Meta mantém o limite de 4; espera da chamada de 20 s para 40 s", () => {
    expect(sql).toContain("_step_limit constant smallint := 4;");
    expect(sql).not.toContain("timeout_milliseconds := 20000");
    expect(sql).toContain("timeout_milliseconds := 40000");
  });

  it("é a função inteira, com delimitador que a CLI aplica", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.editorial_autopublish_tick()");
    expect(sql).not.toContain("$function$");
    expect(sql.trim().endsWith("$$;")).toBe(true);
  });
});
