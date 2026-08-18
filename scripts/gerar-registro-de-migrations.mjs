/**
 * Gera o SQL que registra no ledger de produção as migrations que já foram
 * aplicadas ao banco mas nunca foram anotadas.
 *
 * Por que isto existe: o painel tem 29 migrations depois do corte do ledger
 * (20260810150000). Os efeitos delas ESTÃO no banco — as tabelas existem —, mas
 * `supabase_migrations.schema_migrations` não tem linha nenhuma para elas.
 * Enquanto isso durar, o `supabase db push` do workflow tenta reaplicar todas,
 * e 7 delas quebram (ADD CONSTRAINT, índice único sem IF NOT EXISTS). O CI
 * também fica vermelho, o que bloqueia o deploy do MCP.
 *
 * A anotação usa exatamente a impressão digital que a consulta oficial lê:
 *   sha256( array_to_string(statements, chr(30)) )
 * com `statements` sendo a divisão do arquivo pelo mesmo separador que o CLI do
 * Supabase usa. Por isso o script reaproveita splitSupabaseStatements do
 * projeto, em vez de inventar um formato próprio: registro com hash diferente
 * seria pior que registro nenhum — passaria a mentir na verificação seguinte.
 *
 * O conteúdo é lido do GIT, não do disco: no Windows o disco vem com CRLF e o
 * hash sairia diferente do que a esteira (Linux, LF) calcula.
 *
 * Uso:  node scripts/gerar-registro-de-migrations.mjs > saida.sql
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { splitSupabaseStatements } from './prepare-production-migration-view.mjs';

const CORTE = '20260810150000';

/** O arquivo como o git o guarda (LF), que é o que a esteira Linux enxerga. */
function conteudoDoGit(caminho) {
  return execFileSync('git', ['show', `HEAD:${caminho}`], {
    encoding: 'utf8',
    maxBuffer: 1e8,
  });
}

function textoSql(valor) {
  return `'${String(valor).replace(/'/g, "''")}'`;
}

/**
 * A única migration posterior ao corte que ainda NÃO está no banco.
 *
 * As outras já tiveram os efeitos aplicados por fora (as tabelas existem) e só
 * faltava a anotação. Esta aqui é nova, então o arquivo gerado a APLICA antes
 * de registrar — registrar sem aplicar seria mentira, e pior: faria o deploy
 * pular para sempre uma migration que nunca rodou.
 */
const AINDA_NAO_APLICADA = '20260817200000';

const arquivos = readdirSync('supabase/migrations')
  .filter((nome) => /^\d{14}_.+\.sql$/.test(nome))
  .filter((nome) => nome.slice(0, 14) > CORTE)
  .sort();

const linhas = [];
for (const arquivo of arquivos) {
  const version = arquivo.slice(0, 14);
  const name = arquivo.slice(15).replace(/\.sql$/, '');
  const sql = conteudoDoGit(`supabase/migrations/${arquivo}`);
  const statements = splitSupabaseStatements(sql);
  if (statements.length === 0) throw new Error(`sem comandos: ${arquivo}`);
  linhas.push({ version, name, statements });
}

const novas = linhas.filter((linha) => linha.version === AINDA_NAO_APLICADA);

const saida = [];
saida.push('-- PARA RODAR NO SQL EDITOR DO LOVABLE CLOUD (Backend -> SQL).');
saida.push('-- Cole o arquivo inteiro e execute uma vez. Rodar de novo não faz mal.');
saida.push('--');
saida.push('-- Duas coisas acontecem aqui, nesta ordem:');
saida.push('--');
saida.push('--   1) Aplica a coleta de campanhas do Meta Ads (tabelas, coletor e cron).');
saida.push('--   2) Anota no diário de bordo do Supabase as migrations que já estavam');
saida.push('--      aplicadas no banco mas nunca foram registradas. Isto NÃO altera');
saida.push('--      schema nenhum: só registra o que já foi feito. Sem a anotação, o');
saida.push('--      deploy automático tenta reaplicar tudo e 7 delas quebram por já');
saida.push('--      existirem (ADD CONSTRAINT, índice único sem IF NOT EXISTS).');
saida.push('--');
saida.push(`-- Gerado de ${linhas.length} arquivos posteriores a ${CORTE}.`);
saida.push('');
saida.push('BEGIN;');
saida.push('');

for (const nova of novas) {
  saida.push(`-- ═══ 1) Migration nova: ${nova.name} ═══`);
  saida.push(conteudoDoGit(`supabase/migrations/${nova.version}_${nova.name}.sql`).trimEnd());
  saida.push('');
}

saida.push('-- ═══ 2) Registro no diário de bordo ═══');
saida.push('INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES');

const valores = linhas.map(({ version, name, statements }) => {
  const arr = statements.map(textoSql).join(',\n    ');
  return `  (${textoSql(version)}, ${textoSql(name)}, ARRAY[\n    ${arr}\n  ]::text[])`;
});

saida.push(valores.join(',\n'));
saida.push('ON CONFLICT (version) DO NOTHING;');
saida.push('');
saida.push('COMMIT;');
saida.push('');
saida.push(`-- Conferência: deve listar ${linhas.length} linhas.`);
saida.push(
  `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version > '${CORTE}' ORDER BY version;`,
);

process.stdout.write(`${saida.join('\n')}\n`);
