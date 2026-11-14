import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ErroSeguro,
  LIMITE_LOGS,
  LOGS_SQL,
  checarSaturacao,
  detectarPicos,
  escaparLike,
  filtrarJaAvisados,
  literalSql,
  mascararEmail,
  mensagemDeErro,
  mensagemParaLog,
  montarInsertSql,
  montarMensagem,
  parsearEvento,
  parsearRespostaLogs,
  rodarSql,
} from "./alerta-senha-errada.mjs";

const REF = "abcdefghijklmnopqrst";

function linha({ ts, ip = "104.28.207.234", code = "invalid_credentials", grant = "password", email } = {}) {
  const msg = {
    component: "api",
    error_code: code,
    grant_type: grant,
    level: "info",
    method: "POST",
    msg: "request completed",
    path: "/token",
    remote_addr: ip,
    status: 400,
  };
  if (email) msg.email = email;
  return {
    timestamp: ts,
    identifier: REF,
    event_message: JSON.stringify(msg),
    log_attributes: { error_code: code, grant_type: grant, path: "/" },
  };
}

const eventos = (linhas) => linhas.map(parsearEvento);
const aPartirDe = (iniIso, passosSeg, extra = {}) => {
  const base = Date.parse(iniIso);
  return passosSeg.map((s) => linha({ ts: new Date(base + s * 1000).toISOString(), ...extra }));
};

const INCIDENTE_14_11 = [
  "2026-11-14T20:23:42Z",
  "2026-11-14T20:24:04Z",
  "2026-11-14T20:24:33Z",
  "2026-11-14T20:24:51Z",
  "2026-11-14T20:25:08Z",
].map((ts) => linha({ ts }));

test("incidente real de 14/11: 5 falhas do mesmo IP em <10 min dispara", () => {
  const picos = detectarPicos(eventos(INCIDENTE_14_11));
  assert.equal(picos.length, 1);
  assert.equal(picos[0].tipo, "ip");
  assert.equal(picos[0].valor, "104.28.207.234");
  assert.equal(picos[0].total, 5);
  assert.match(montarMensagem(picos[0]), /errou a senha do painel 5 vezes em 10 minutos.*\(IP 104\.28\.207\.234\).*não foi bloqueada/);
});

test("timestamp em microssegundos (formato ClickHouse) também conta", () => {
  const linhas = INCIDENTE_14_11.map((l) => ({ ...l, timestamp: Date.parse(l.timestamp) * 1000 }));
  assert.equal(detectarPicos(eventos(linhas)).length, 1);
});

test("4 falhas no mesmo IP não dispara", () => {
  assert.equal(detectarPicos(eventos(INCIDENTE_14_11.slice(0, 4))).length, 0);
});

test("5 falhas espalhadas em 15 minutos não dispara", () => {
  const linhas = aPartirDe("2026-11-14T20:00:00Z", [0, 225, 450, 675, 900]);
  assert.equal(detectarPicos(eventos(linhas)).length, 0);
});

test("5 refresh_token_not_found em 2 min não dispara", () => {
  const linhas = aPartirDe("2026-11-14T20:00:00Z", [0, 30, 60, 90, 120], {
    code: "refresh_token_not_found",
    grant: "refresh_token",
  });
  assert.equal(detectarPicos(eventos(linhas)).length, 0);
});

test("invalid_credentials com grant diferente de password não conta", () => {
  const linhas = aPartirDe("2026-11-14T20:00:00Z", [0, 30, 60, 90, 120], { grant: "refresh_token" });
  assert.equal(detectarPicos(eventos(linhas)).length, 0);
});

test("dois IPs com 3 falhas cada não dispara", () => {
  const linhas = [
    ...aPartirDe("2026-11-14T20:00:00Z", [0, 20, 40], { ip: "203.0.113.10" }),
    ...aPartirDe("2026-11-14T20:00:00Z", [10, 30, 50], { ip: "198.51.100.7" }),
  ];
  assert.equal(detectarPicos(eventos(linhas)).length, 0);
});

test("dois IPs com 5 falhas cada na mesma janela: um aviso por IP", () => {
  const linhas = [
    ...aPartirDe("2026-11-14T20:00:00Z", [0, 20, 40, 60, 80], { ip: "203.0.113.10" }),
    ...aPartirDe("2026-11-14T20:00:00Z", [10, 30, 50, 70, 90], { ip: "2001:db8::1" }),
  ];
  const picos = detectarPicos(eventos(linhas));
  assert.equal(picos.length, 2);
  assert.deepEqual(picos.map((p) => p.valor).sort(), ["2001:db8::1", "203.0.113.10"]);
});

test("dedup: aviso recente do mesmo IP impede nova gravação; IP diferente passa", () => {
  const picos = detectarPicos(eventos(INCIDENTE_14_11));
  const agora = Date.parse("2026-11-14T20:30:00Z");
  const recente = [{ message: montarMensagem(picos[0]), created_at: "2026-11-14T20:26:00Z" }];
  assert.equal(filtrarJaAvisados(picos, recente, agora).length, 0);

  const antigo = [{ message: montarMensagem(picos[0]), created_at: "2026-11-14T19:00:00Z" }];
  assert.equal(filtrarJaAvisados(picos, antigo, agora).length, 1);

  const outroIp = [{ message: "… (IP 104.28.207.23) …", created_at: "2026-11-14T20:26:00Z" }];
  assert.equal(filtrarJaAvisados(picos, outroIp, agora).length, 1);
});

test("path '/' no log_attributes e '/token' só no event_message JSON ainda conta", () => {
  const ev = parsearEvento(INCIDENTE_14_11[0]);
  assert.equal(ev.path, "/token");
  assert.equal(ev.ip, "104.28.207.234");
  assert.equal(detectarPicos(eventos(INCIDENTE_14_11)).length, 1);
});

test("e-mail no log agrupa pela conta e é mascarado no stdout", () => {
  const linhas = aPartirDe("2026-11-14T20:00:00Z", [0, 20, 40, 60, 80], {
    ip: "203.0.113.10",
    email: "Almir.Teste@exemplo.com",
  });
  const picos = detectarPicos(eventos(linhas));
  const porConta = picos.find((p) => p.tipo === "email");
  assert.ok(porConta);
  assert.match(montarMensagem(porConta), /\(conta almir\.teste@exemplo\.com\)/);
  const log = mensagemParaLog(porConta);
  assert.ok(!log.includes("almir.teste@"));
  assert.match(log, /a\*\*\*@exemplo\.com/);
  assert.equal(mascararEmail("x@y.com"), "x***@y.com");
});

test("SQL gerado: literais fechados, sem aspas soltas, padrão de dedup estável", () => {
  const [pico] = detectarPicos(eventos(INCIDENTE_14_11));
  const sql = montarInsertSql(pico);
  assert.match(sql, /'login_senha_errada'/);
  assert.match(sql, /like '%\(IP 104\.28\.207\.234\)%'/);
  assert.match(sql, /ur\.role = 'admin'/);
  assert.match(sql, /not ilike 'n8n@%'/);
  // Sem conteúdo dos literais, o número de aspas tem que ser par.
  assert.equal((sql.match(/'/g) ?? []).length % 2, 0);
  assert.equal(literalSql("it's"), "'it''s'");
  assert.throws(() => literalSql("a\\b"));
});

test("IP ou e-mail inválido é recusado antes do SQL", () => {
  assert.throws(() => montarInsertSql({ tipo: "ip", valor: "1.2.3.4'); drop table x;--", total: 5 }));
  assert.throws(() => montarInsertSql({ tipo: "ip", valor: "999.1.1.1", total: 5 }));
  assert.throws(() => montarInsertSql({ tipo: "email", valor: "a'b@x.com", total: 5 }));
  assert.throws(() => montarInsertSql({ tipo: "outro", valor: "x", total: 5 }));
  // IP malformado no log nem vira grupo.
  const linhas = aPartirDe("2026-11-14T20:00:00Z", [0, 10, 20, 30, 40], { ip: "1.2.3.4' or 1=1" });
  assert.equal(detectarPicos(eventos(linhas)).length, 0);
});

test("resposta da API: result, erro e formato inesperado", () => {
  assert.deepEqual(parsearRespostaLogs({ result: [1] }), [1]);
  // O texto do erro da API não vai para o log (pode ecoar o SQL).
  assert.throws(
    () => parsearRespostaLogs({ error: { message: "bad sql: select ... a@b.com" } }),
    (err) => err instanceof ErroSeguro && err.message === "API de logs respondeu erro",
  );
  assert.throws(() => parsearRespostaLogs({ foo: 1 }));
});

test("CLI com --fixture em dry-run: imprime o aviso, sai 0, sem rede", () => {
  const dir = mkdtempSync(join(tmpdir(), "alerta-senha-"));
  const arq = join(dir, "fixture.json");
  writeFileSync(arq, JSON.stringify({ result: INCIDENTE_14_11 }));
  const script = fileURLToPath(new URL("./alerta-senha-errada.mjs", import.meta.url));
  const out = execFileSync(process.execPath, [script, "--fixture", arq], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.match(out, /Picos: 1/);
  assert.match(out, /\[dry-run\] Gravaria: .*\(IP 104\.28\.207\.234\)/);

  writeFileSync(arq, JSON.stringify({ result: INCIDENTE_14_11.slice(0, 4) }));
  const vazio = execFileSync(process.execPath, [script, "--fixture", arq], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.match(vazio, /Nenhum pico/);
});

test("CLI sem fixture e sem secrets falha claro, sem despejar env", () => {
  const script = fileURLToPath(new URL("./alerta-senha-errada.mjs", import.meta.url));
  try {
    execFileSync(process.execPath, [script, "--dry-run"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, SUPABASE_PROJECT_ID: REF },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("deveria falhar");
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr, /SUPABASE_ACCESS_TOKEN ausente/);
    assert.ok(!err.stderr.includes("PATH"));
  }
});

// ---------- regressões do review do Codex ----------

/** Emula `x like 'padrão' escape '!'` do Postgres para conferir o padrão gerado. */
function likeComEscape(sql) {
  const m = /like '((?:[^']|'')*)' escape '!'/.exec(sql);
  assert.ok(m, "LIKE com ESCAPE '!' esperado no SQL");
  const padrao = m[1].replace(/''/g, "'");
  let re = "";
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i];
    if (c === "!") re += padrao[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") re += "[\\s\\S]*";
    else if (c === "_") re += "[\\s\\S]";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

test("e-mail com _ ou % no local: INSERT com ESCAPE '!', sem barra, sem lançar", () => {
  const picoUnder = { tipo: "email", valor: "a_b@example.com", total: 5, inicio: 0, fim: 0 };
  const picoPct = { tipo: "email", valor: "a%b@example.com", total: 5, inicio: 0, fim: 0 };

  const sqlUnder = montarInsertSql(picoUnder);
  const sqlPct = montarInsertSql(picoPct);
  for (const sql of [sqlUnder, sqlPct]) {
    assert.match(sql, /like '%\(conta [^']*\)%' escape '!'/);
    assert.ok(!sql.includes("\\"));
    assert.equal((sql.match(/'/g) ?? []).length % 2, 0);
  }
  assert.match(sqlUnder, /a!_b@example\.com/);
  assert.match(sqlPct, /a!%b@example\.com/);

  const reUnder = likeComEscape(sqlUnder);
  assert.ok(reUnder.test(montarMensagem(picoUnder)));
  assert.ok(!reUnder.test(montarMensagem({ ...picoUnder, valor: "axb@example.com" })));

  const rePct = likeComEscape(sqlPct);
  assert.ok(rePct.test(montarMensagem(picoPct)));
  assert.ok(!rePct.test(montarMensagem({ ...picoPct, valor: "axyzb@example.com" })));

  assert.equal(escaparLike("!%_x"), "!!!%!_x");
});

test("CLI dry-run com e-mail a_b@example.com no pico não derruba o lote", () => {
  const dir = mkdtempSync(join(tmpdir(), "alerta-senha-"));
  const arq = join(dir, "fixture.json");
  const linhas = aPartirDe("2026-11-14T20:00:00Z", [0, 20, 40, 60, 80], {
    ip: "203.0.113.10",
    email: "a_b@example.com",
  });
  writeFileSync(arq, JSON.stringify({ result: linhas }));
  const script = fileURLToPath(new URL("./alerta-senha-errada.mjs", import.meta.url));
  const out = execFileSync(process.execPath, [script, "--fixture", arq], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.match(out, /Picos: 2/);
  assert.match(out, /\(conta a\*\*\*@example\.com\)/);
  assert.ok(!out.includes("a_b@"));
});

test("leitura de logs pede as mais recentes e falha se saturar o limit", () => {
  assert.match(LOGS_SQL, /order by timestamp desc/);
  assert.match(LOGS_SQL, new RegExp(`limit ${LIMITE_LOGS}$`));
  assert.equal(LIMITE_LOGS, 5000);

  const quase = new Array(LIMITE_LOGS - 1).fill({});
  assert.equal(checarSaturacao(quase), quase);
  assert.throws(
    () => checarSaturacao(new Array(LIMITE_LOGS).fill({})),
    (err) => err instanceof ErroSeguro && /Leitura incompleta/.test(err.message),
  );
  assert.throws(() => checarSaturacao([1, 2, 3], 3), /Leitura incompleta/);
});

test("CLI: 5000 linhas saturadas sai 1, mensagem clara, nada gravado", () => {
  const dir = mkdtempSync(join(tmpdir(), "alerta-senha-"));
  const arq = join(dir, "fixture.json");
  const cheio = Array.from({ length: LIMITE_LOGS }, (_, i) => INCIDENTE_14_11[i % 5]);
  writeFileSync(arq, JSON.stringify({ result: cheio }));
  const script = fileURLToPath(new URL("./alerta-senha-errada.mjs", import.meta.url));
  try {
    execFileSync(process.execPath, [script, "--fixture", arq], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("deveria falhar");
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr, /Leitura incompleta/);
    assert.ok(!err.stdout.includes("Gravaria"));
  }
});

test("falha do supabase vira mensagem curta: sem comando, SQL, stderr nem e-mail", () => {
  const sql = montarInsertSql({ tipo: "email", valor: "fulano.secreto@example.com", total: 5 });
  const exec = () => {
    const e = new Error(`Command failed: supabase db query --linked ${sql}`);
    e.stderr = `ERROR: syntax error at or near ... fulano.secreto@example.com`;
    throw e;
  };
  for (const rotulo of ["falha ao consultar avisos", "falha ao gravar aviso"]) {
    assert.throws(
      () => rodarSql(sql, rotulo, exec),
      (err) => {
        assert.ok(err instanceof ErroSeguro);
        assert.equal(err.message, rotulo);
        assert.equal(mensagemDeErro(err), rotulo);
        return true;
      },
    );
  }
  assert.equal(rodarSql("select 1", "x", () => "[]"), "[]");
});

test("erro inesperado no main não ecoa a mensagem crua", () => {
  const cru = new Error("insert into public.notifications ... fulano.secreto@example.com");
  assert.equal(mensagemDeErro(cru), "erro inesperado");
  assert.equal(mensagemDeErro(undefined), "erro inesperado");
  assert.equal(mensagemDeErro(new ErroSeguro("API de logs falhou com HTTP 503")), "API de logs falhou com HTTP 503");
});
