import assert from "node:assert/strict";
import { test } from "node:test";
import { entradaDoPython, eventoDaLinha, linhaDoCandidato, semSegredo } from "../regras.ts";

test("só linha JSON de evento conta; log do Python é ignorado", () => {
  assert.equal(eventoDaLinha("[2026-10-25] INFO: Fetched (200)"), null);
  assert.equal(eventoDaLinha("{quebrado"), null);
  assert.deepEqual(eventoDaLinha('{"tipo":"progresso","etapa":"Lendo","feitos":2,"total":5}'), { tipo: "progresso", etapa: "Lendo", feitos: 2, total: 5 });
  assert.deepEqual(eventoDaLinha('{"tipo":"fim","encontrados":3}'), { tipo: "fim", encontrados: 3 });
  assert.equal(eventoDaLinha('{"tipo":"erro","mensagem":"x"}')!.tipo, "erro");
});

test("candidato vira a linha da tabela, com as evidências e o CNPJ nelas", () => {
  const l = linhaDoCandidato("b1", {
    nome: "Pizzaria X", chave: "pizzariax:99887766", telefone: "+5541999887766", cnpj: "11222333000181", site: "https://x.com.br",
    fonte: "osm", fonte_url: "https://www.openstreetmap.org/node/1", extra: "não vai",
    evidencias: [{ campo: "telefone", valor: "+5541999887766", fonte: "osm", url: "https://www.openstreetmap.org/node/1" }],
  })!;
  assert.equal(l.busca_id, "b1");
  assert.equal(l.whatsapp, null);
  assert.equal((l as Record<string, unknown>).extra, undefined);
  assert.equal((l.evidencias as unknown[]).length, 2);
  assert.equal(linhaDoCandidato("b1", { nome: "", chave: "x" }), null);
});

test("a entrada do Python tem teto e nada além do que ele lê", () => {
  const e = entradaDoPython({ id: "1", nicho: "pet shop", cidade: "Curitiba", limite: 9999, fontes: ["osm"], segredo: "x" });
  assert.equal(e.limite, 300);
  assert.equal((e as Record<string, unknown>).segredo, undefined);
});

test("mensagem de erro sai sem chave", () => {
  assert.equal(semSegredo("apikey: eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcdefghijklmnop falhou").indexOf("eyJ"), -1);
});
