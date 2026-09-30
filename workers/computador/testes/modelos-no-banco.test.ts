/**
 * Catálogo de modelos no banco (frente MOD): as migrations 20260930220000
 * (recursos e diretos novos) e 20260930220100 (o melhor modelo por papel)
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
import { RECOMENDACOES_POR_PAPEL } from "../../../supabase/functions/_shared/modelo-por-papel.ts";

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

async function linha(id: string, ativo: boolean, padrao: string[] = [], tipo = "texto") {
  const prov = id.split(":")[0];
  await db.query(
    "INSERT INTO public.ia_modelos (id, provedor, modelo_api, tipo, rotulo, ativo, padrao_para) VALUES ($1, $2, $3, $4, $1, $5, $6) ON CONFLICT (id) DO UPDATE SET ativo = EXCLUDED.ativo, padrao_para = EXCLUDED.padrao_para",
    [id, prov, id.split(":")[1], tipo, ativo, padrao],
  );
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

describe("recursos e diretos novos (20260930220000)", () => {
  it("roda duas vezes; a sincronização grava recursos e não apaga com linha sem recursos", async () => {
    await linha("anthropic:claude-opus-5-5", false);
    await db.exec(ler("20260930220000_modelos_e_recursos.sql"));
    await db.exec(ler("20260930220000_modelos_e_recursos.sql"));
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

describe("o melhor modelo por papel (20260930220100)", () => {
  it("a lista da migration é a mesma do modelo-por-papel.ts", () => {
    const sql = ler("20260930220100_modelo_por_papel.sql");
    for (const r of RECOMENDACOES_POR_PAPEL) {
      const linha = `('${r.papel}', '${r.tipo}', ARRAY[${r.candidatos.map((c) => `'${c}'`).join(", ")}]::text[])`;
      assert.ok(sql.indexOf(linha) >= 0, `papel ${r.papel} diferente na migration`);
    }
    assert.equal((sql.match(/\('[a-z_]+', '(texto|imagem)', ARRAY\[/g) || []).length, RECOMENDACOES_POR_PAPEL.length);
  });

  it("só modelo que existe e está ligado; papel sem candidato ligado fica; idempotente", async () => {
    await db.exec("DELETE FROM public.ia_modelos");
    // Como estava em 29/09: Opus 5.5 e Luna ligados; Sonnet 5.5 e GPT-6.1 Sol existem desligados.
    await linha("openrouter:openai/gpt-6-sol", true, ["estrategista", "diretor_arte"]);
    await linha("openrouter:openai/gpt-6-luna", true, ["leitura", "contexto", "briefing", "conselho"]);
    await linha("openrouter:anthropic/claude-opus-5.5", true, ["proposta", "contrato", "site", "documento", "identidade", "naming", "motion"]);
    await linha("openrouter:anthropic/claude-sonnet-5.5", false);
    await linha("openrouter:openai/gpt-6.1-sol", false);
    await linha("openrouter:openai/gpt-image-2.5-sunburst", true, ["imagem"], "imagem");
    await linha("openrouter:google/gemini-3.8-flash", false, ["estrategista_rapido"]);
    const sql = ler("20260930220100_modelo_por_papel.sql");
    await db.exec(sql);
    const p = await padroes();
    // Sonnet 5.5 desligado: a estratégia vai para o próximo candidato ligado (Opus 5.5).
    assert.equal(p.estrategista, "openrouter:anthropic/claude-opus-5.5");
    assert.equal(p.proposta, "openrouter:anthropic/claude-opus-5.5");
    assert.equal(p.site, "openrouter:anthropic/claude-opus-5.5");
    assert.equal(p.leitura, "openrouter:openai/gpt-6-luna");
    assert.equal(p.imagem, "openrouter:openai/gpt-image-2.5-sunburst");
    // Conselho: GPT-6.1 Sol e Sonnet desligados; o GPT-6 Sol está ligado.
    assert.equal(p.conselho, "openrouter:openai/gpt-6-sol");
    // estrategista_rapido: Luna ligado passa na frente do Gemini (desligado mas com o papel).
    assert.equal(p.estrategista_rapido, "openrouter:openai/gpt-6-luna");
    const antes = JSON.stringify(p);
    await db.exec(sql);
    assert.equal(JSON.stringify(await padroes()), antes);
  });

  it("com Sonnet 5.5 e GPT-6.1 Sol ligados, a recomendação inteira vale", async () => {
    await linha("openrouter:anthropic/claude-sonnet-5.5", true);
    await linha("openrouter:openai/gpt-6.1-sol", true);
    await db.exec(ler("20260930220100_modelo_por_papel.sql"));
    const p = await padroes();
    assert.equal(p.estrategista, "openrouter:anthropic/claude-sonnet-5.5");
    assert.equal(p.diretor_arte, "openrouter:anthropic/claude-sonnet-5.5");
    assert.equal(p.documento, "openrouter:anthropic/claude-sonnet-5.5");
    assert.equal(p.briefing, "openrouter:anthropic/claude-sonnet-5.5");
    assert.equal(p.conselho, "openrouter:openai/gpt-6.1-sol");
    assert.equal(p.contrato, "openrouter:anthropic/claude-opus-5.5");
    assert.equal(p.motion, "openrouter:anthropic/claude-opus-5.5");
    assert.equal(p.leitura, "openrouter:openai/gpt-6-luna");
  });
});
