/**
 * Gera a migration da Biblioteca da casa a partir de biblioteca-da-casa.ts.
 *   deno run --allow-read --allow-write supabase/functions/base-dos-agentes/gerar-seed-da-biblioteca.ts
 * O teste supabase/testes-deno/base-do-agente_test.ts confere que o arquivo gravado é igual ao que sai daqui.
 * Não entra no bundle da função (o index.ts não importa).
 */
import { BIBLIOTECA_DA_CASA, NOME_DA_FONTE_DA_CASA, urlDoDocumento, VERSAO_DA_BIBLIOTECA } from "./biblioteca-da-casa.ts";

export const ARQUIVO_DA_MIGRATION = "supabase/migrations/20261023110000_biblioteca_da_casa.sql";

const q = (t: string) => `'${t.replace(/'/g, "''")}'`;

export function sqlDaBiblioteca(): string {
  const agentes = Object.keys(BIBLIOTECA_DA_CASA);
  const linhas: string[] = [];
  for (const agente of agentes) {
    for (const d of BIBLIOTECA_DA_CASA[agente]) {
      linhas.push(`  (${[agente, urlDoDocumento(agente, d.slug), d.titulo, d.tecnica, d.quando_usar, d.exemplo].map(q).join(", ")})`);
    }
  }
  return `-- 23/10/2026: Biblioteca da casa (versão ${VERSAO_DA_BIBLIOTECA}). Dono: "carregue de documentos e informações
-- relevantes todos os agentes para evoluir". Documentos curtos e originais da agência para cada agente da Base
-- (copy e ganchos, viral, anúncios, campanhas comerciais, composição e estratégia por nicho), como fichas gerais.
--
-- GERADO por supabase/functions/base-dos-agentes/gerar-seed-da-biblioteca.ts a partir de biblioteca-da-casa.ts.
-- Não edite à mão: mude o módulo e gere de novo.
--
-- - Uma fonte por agente: tipo 'documento', nome ${q(NOME_DA_FONTE_DA_CASA)}.
-- - Cada documento é uma ficha geral (client_id NULL), fonte_url 'biblioteca:<versão>/<agente>/<slug>'.
-- - Idempotente: rodar de novo não duplica (fonte pelo nome, ficha pelo fonte_url).
-- - Na geração (_shared/base-do-agente.ts) entram no máximo 3 documentos da casa por pedido, escolhidos pelo
--   Jev, e nunca mais da metade do teto da base.
-- - A tela /base-dos-agentes marca "Biblioteca da casa" e desliga por agente: arquivada_por 'casa_desligada'.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.agente_base_fichas'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%arquivada_por%'
  LOOP
    EXECUTE format('ALTER TABLE public.agente_base_fichas DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.agente_base_fichas ADD CONSTRAINT agente_base_fichas_arquivada_por_check
  CHECK (arquivada_por IS NULL OR arquivada_por IN ('sem_uso', 'repetida', 'casa_desligada'));

INSERT INTO public.agente_base_fontes (agente, client_id, tipo, nome, url, status, fichas)
SELECT a, NULL, 'documento', ${q(NOME_DA_FONTE_DA_CASA)}, NULL, 'pronta', 0
FROM unnest(ARRAY[${agentes.map(q).join(", ")}]::text[]) AS a
WHERE NOT EXISTS (
  SELECT 1 FROM public.agente_base_fontes f WHERE f.agente = a AND f.client_id IS NULL AND f.nome = ${q(NOME_DA_FONTE_DA_CASA)}
);

INSERT INTO public.agente_base_fichas (fonte_id, agente, client_id, titulo, tecnica, quando_usar, exemplo, fonte_url)
SELECT f.id, d.agente, NULL, d.titulo, d.tecnica, d.quando_usar, d.exemplo, d.fonte_url
FROM (VALUES
${linhas.join(",\n")}
) AS d (agente, fonte_url, titulo, tecnica, quando_usar, exemplo)
JOIN public.agente_base_fontes f ON f.agente = d.agente AND f.client_id IS NULL AND f.nome = ${q(NOME_DA_FONTE_DA_CASA)}
WHERE NOT EXISTS (SELECT 1 FROM public.agente_base_fichas x WHERE x.agente = d.agente AND x.fonte_url = d.fonte_url);

UPDATE public.agente_base_fontes f
SET fichas = (SELECT count(*) FROM public.agente_base_fichas x WHERE x.fonte_id = f.id)
WHERE f.client_id IS NULL AND f.nome = ${q(NOME_DA_FONTE_DA_CASA)};
`;
}

if (import.meta.main) {
  await Deno.writeTextFile(ARQUIVO_DA_MIGRATION, sqlDaBiblioteca());
  console.log(`gravado ${ARQUIVO_DA_MIGRATION}`);
}
