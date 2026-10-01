/**
 * Catálogo de modelos no banco (frente MOD): as migrations 20260930320000
 * (recursos e diretos novos) e 20260930320100 (o melhor modelo por papel)
 * num Postgres em memória. Mora aqui porque este worker já traz o PGlite.
 *
 *   node --test testes/modelos-no-banco.test.ts
 */

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { MODELOS_DE_IMAGEM_DO_LOTE_NOVO, MODELOS_DO_LOTE_NOVO, RECOMENDACOES_POR_PAPEL } from "../../../src/lib/mesa/modelo-por-papel.ts";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ler = (arq: string) => readFileSync(path.join(RAIZ, "supabase", "migrations", arq), "utf8").replace(/NOTIFY pgrst[^;]*;/g, "");

const PAPEIS = [
  "estrategista", "diretor_arte", "imagem", "leitura", "contexto", "estrategista_rapido",
  "proposta", "contrato", "briefing", "conselho", "identidade", "naming", "site", "motion", "documento",
];

const ESQUELETO = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE OR REPLACE FUNCTION app_private.rpc_trusted_backend() RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE TABLE public.ia_modelos (
  id text PRIMARY KEY,
  provedor text NOT NULL CHECK (provedor IN ('openai', 'anthropic', 'openrouter')),
  modelo_api text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('texto', 'imagem')),
  rotulo text NOT NULL,
  preco_entrada_1m numeric, preco_saida_1m numeric, preco_cache_1m numeric, preco_imagem jsonb,
  raciocinio text[] NOT NULL DEFAULT '{}'::text[],
  padrao_para text[] NOT NULL DEFAULT '{}'::text[],
  ativo boolean NOT NULL DEFAULT true,
  fonte_preco text, conferido_em timestamptz,
  novo boolean NOT NULL DEFAULT true, disponivel boolean NOT NULL DEFAULT true,
  contexto_tokens integer, modalidades jsonb, sincronizado_em timestamptz, capacidades jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ia_modelos_padrao_para_check CHECK (padrao_para <@ ARRAY[${PAPEIS.map((p) => `'${p}'`).join(", ")}]::text[])
);
`;

let db: PGlite;

async function linha(id: string, ativo: boolean, padrao: string[] = [], tipo = "texto", disponivel = true) {
  const prov = id.split(":")[0];
  await db.query(
    "INSERT INTO public.ia_modelos (id, provedor, modelo_api, tipo, rotulo, ativo, padrao_para, disponivel) VALUES ($1, $2, $3, $4, $1, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET ativo = EXCLUDED.ativo, padrao_para = EXCLUDED.padrao_para, disponivel = EXCLUDED.disponivel",
    [id, prov, id.split(":")[1], tipo, ativo, padrao, disponivel],
  );
}

async function ligados(): Promise<string[]> {
  const r = await db.query<{ id: string }>("SELECT id FROM public.ia_modelos WHERE ativo ORDER BY id");
  return r.rows.map((x) => x.id);
}

async function padroes(): Promise<Record<string, string>> {
  const r = await db.query<{ papel: string; id: string }>("SELECT unnest(padrao_para) AS papel, id FROM public.ia_modelos");
  const m: Record<string, string> = {};
  for (const x of r.rows) {
    assert.equal(m[x.papel], undefined, `papel ${x.papel} em dois modelos`);
    m[x.papel] = x.id;
  }
  return m;
}

before(async () => {
  db = new PGlite();
  await db.exec(ESQUELETO);
});

describe("recursos e diretos novos (20260930320000)", () => {
  it("roda duas vezes; a sincronização grava recursos e não apaga com linha sem recursos", async () => {
    await linha("anthropic:claude-opus-5-5", false);
    await db.exec(ler("20260930320000_modelos_e_recursos.sql"));
    await db.exec(ler("20260930320000_modelos_e_recursos.sql"));
    const diretos = await db.query<{ id: string; ativo: boolean; novo: boolean; lancado: string }>(
      "SELECT id, ativo, novo, recursos->>'lancado_em' AS lancado FROM public.ia_modelos WHERE provedor <> 'openrouter' ORDER BY id",
    );
    assert.deepEqual(diretos.rows.map((r) => r.id), ["anthropic:claude-fable-5-1", "anthropic:claude-opus-5-5", "anthropic:claude-sonnet-5-5", "openai:gpt-6-astra", "openai:gpt-6.1-sol"]);
    assert.ok(diretos.rows.every((r) => r.ativo === false), "nenhum modelo é ligado pela migration");
    assert.equal(diretos.rows.find((r) => r.id === "anthropic:claude-opus-5-5")?.lancado, "2026-09-22");

    const recursos = { ferramentas: true, json: true, visao: true, raciocinio_padrao: "high", lancado_em: "2026-09-28", fonte: "openrouter" };
    const lista = [{ id: "openrouter:anthropic/claude-sonnet-5.5", modelo_api: "anthropic/claude-sonnet-5.5", tipo: "texto", rotulo: "Sonnet 5.5", preco_entrada_1m: 2, preco_saida_1m: 10, raciocinio: ["low", "high"], recursos }];
    await db.query("SELECT public.ia_modelos_sincronizar('openrouter', $1::jsonb, false)", [JSON.stringify(lista)]);
    await db.query("SELECT public.ia_modelos_sincronizar('openrouter', $1::jsonb, false)", [JSON.stringify([{ ...lista[0], recursos: null }])]);
    const r = await db.query<{ ativo: boolean; novo: boolean; recursos: Record<string, unknown> }>("SELECT ativo, novo, recursos FROM public.ia_modelos WHERE id = 'openrouter:anthropic/claude-sonnet-5.5'");
    assert.equal(r.rows[0].ativo, false);
    assert.equal(r.rows[0].novo, true);
    assert.equal(r.rows[0].recursos.ferramentas, true);
    assert.equal(r.rows[0].recursos.lancado_em, "2026-09-28");
  });
});

describe("o melhor modelo por papel (20260930320100)", () => {
  it("a lista da migration é a mesma do modelo-por-papel.ts", () => {
    const sql = ler("20260930320100_modelo_por_papel.sql");
    for (const r of RECOMENDACOES_POR_PAPEL) {
      const linha = `('${r.papel}', '${r.tipo}', ARRAY[${r.candidatos.map((c) => `'${c}'`).join(", ")}]::text[])`;
      assert.ok(sql.indexOf(linha) >= 0, `papel ${r.papel} diferente na migration`);
    }
    assert.equal((sql.match(/\('[a-z_]+', '(texto|imagem)', ARRAY\[/g) || []).length, RECOMENDACOES_POR_PAPEL.length);
  });

  it("o lote novo da migration é o mesmo do modelo-por-papel.ts", () => {
    const sql = ler("20260930320100_modelo_por_papel.sql");
    assert.ok(sql.indexOf(`ARRAY[${MODELOS_DO_LOTE_NOVO.map((c) => `'${c}'`).join(", ")}]::text[]`) >= 0, "lote novo diferente na migration");
  });

  it("como estava em 30/09: liga o lote novo (texto e imagem) e NÃO troca papel que já tem padrão ligado; idempotente", async () => {
    await db.exec("DELETE FROM public.ia_modelos");
    // Catálogo real lido em 30/09 e 01/10 (SELECT): Opus 5.5 e Luna ligados com os papéis; o lote novo sincronizado e desligado.
    await linha("openrouter:openai/gpt-6-sol", true);
    await linha("openrouter:openai/gpt-6-luna", true, ["leitura", "estrategista", "contexto", "diretor_arte", "conselho", "briefing"]);
    await linha("openrouter:anthropic/claude-opus-5.5", true, ["proposta", "contrato", "site", "documento", "identidade", "naming", "motion"]);
    await linha("openrouter:openai/gpt-image-2.5-sunburst", true, ["imagem"], "imagem");
    for (const id of MODELOS_DO_LOTE_NOVO) await linha(id, false, [], MODELOS_DE_IMAGEM_DO_LOTE_NOVO.indexOf(id) >= 0 ? "imagem" : "texto");
    // Um do lote que o provedor tirou do ar não liga.
    await linha("openrouter:x-ai/grok-4.7", false, [], "texto", false);
    // Modelo fora do lote continua desligado.
    await linha("openrouter:openai/gpt-6.1-sol-pro", false);
    await linha("openrouter:recraft/recraft-v4.1-flash", false, [], "imagem");
    const antes = await padroes();
    const sql = ler("20260930320100_modelo_por_papel.sql");
    await db.exec(sql);
    const agora = await ligados();
    for (const id of MODELOS_DO_LOTE_NOVO.filter((x) => x !== "openrouter:x-ai/grok-4.7")) assert.ok(agora.indexOf(id) >= 0, `${id} devia ligar`);
    assert.ok(agora.indexOf("openrouter:x-ai/grok-4.7") < 0, "indisponível não liga");
    assert.ok(agora.indexOf("openrouter:openai/gpt-6.1-sol-pro") < 0, "fora do lote não liga");
    assert.ok(agora.indexOf("openrouter:recraft/recraft-v4.1-flash") < 0, "imagem fora do lote não liga");
    const p = await padroes();
    // Todo papel que já tinha padrão ligado fica onde estava (a troca é do dono, com prévia e Confirmar).
    for (const papel of Object.keys(antes)) assert.equal(p[papel], antes[papel], `papel ${papel} não devia mudar`);
    assert.equal(p.estrategista, "openrouter:openai/gpt-6-luna");
    assert.equal(p.diretor_arte, "openrouter:openai/gpt-6-luna");
    assert.equal(p.conselho, "openrouter:openai/gpt-6-luna");
    assert.equal(p.proposta, "openrouter:anthropic/claude-opus-5.5");
    assert.equal(p.imagem, "openrouter:openai/gpt-image-2.5-sunburst");
    // O único sem padrão em 30/09 ganha o primeiro candidato ligado.
    assert.equal(p.estrategista_rapido, "openrouter:openai/gpt-6-luna");
    const depois = JSON.stringify(p);
    await db.exec(sql);
    assert.equal(JSON.stringify(await padroes()), depois);
  });

  it("papel com padrão desligado ou indisponível recebe o candidato ligado", async () => {
    await db.exec("DELETE FROM public.ia_modelos");
    await linha("openrouter:anthropic/claude-sonnet-5.5", true);
    await linha("openrouter:openai/gpt-6-sol", false, ["estrategista"]);
    await linha("openrouter:openai/gpt-6-luna", true, [], "texto", true);
    await linha("openrouter:openai/gpt-6.1-sol", true, ["conselho"], "texto", false);
    await db.exec(ler("20260930320100_modelo_por_papel.sql"));
    const p = await padroes();
    assert.equal(p.estrategista, "openrouter:anthropic/claude-sonnet-5.5");
    assert.equal(p.conselho, "openrouter:anthropic/claude-sonnet-5.5");
  });

  it("papel sem candidato ligado fica como está (catálogo sem o lote novo)", async () => {
    await db.exec("DELETE FROM public.ia_modelos");
    await linha("openrouter:openai/gpt-6-luna", true, ["conselho"]);
    await linha("openrouter:anthropic/claude-opus-5.5", false, ["proposta"]);
    await db.exec(ler("20260930320100_modelo_por_papel.sql"));
    const p = await padroes();
    // Conselho: nenhum dos 4 primeiros existe; Luna está na lista e ligada.
    assert.equal(p.conselho, "openrouter:openai/gpt-6-luna");
    // Proposta: nenhum candidato ligado; o papel fica onde estava.
    assert.equal(p.proposta, "openrouter:anthropic/claude-opus-5.5");
  });
});
