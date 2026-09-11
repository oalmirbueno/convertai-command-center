/**
 * Anota no manifesto (supabase/migration-manifest.sha256) e na baseline
 * (supabase/production-migration-baseline.json) as migrations que ja estao
 * no repo mas ainda nao foram declaradas. Sem isto o contrato de
 * production-migration-view fica vermelho a cada migration nova.
 *
 * O conteudo e lido do GIT (LF), como a esteira Linux enxerga; no Windows o
 * disco vem com CRLF e o hash sairia diferente. Por isso: commite a migration
 * antes de rodar este script.
 *
 * Uso:  node scripts/registrar-migrations-no-manifesto.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { splitSupabaseStatements, supabaseStatementsSha256 } from './prepare-production-migration-view.mjs';

const MANIFESTO = 'supabase/migration-manifest.sha256';
const BASELINE = 'supabase/production-migration-baseline.json';

function conteudoDoGit(caminho) {
  return execFileSync('git', ['show', `HEAD:${caminho}`], { encoding: 'utf8', maxBuffer: 1e8 });
}

const sha256 = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex');

const manifesto = readFileSync(MANIFESTO, 'utf8');
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
// Ja declaradas: forward, canonicas com alias e os arquivos-sombra dos aliases.
const declaradas = new Set([
  ...baseline.forward_migrations.map((m) => m.path),
  ...baseline.applied_forward_aliases.map((a) => a.canonical_path),
  ...baseline.applied_forward_aliases.map((a) => a.shadow_path),
]);
const corte = String(baseline.cutoff_version);

const pendentes = readdirSync('supabase/migrations')
  .filter((nome) => /^\d{14}_.+\.sql$/.test(nome))
  .filter((nome) => nome.slice(0, 14) > corte)
  .map((nome) => `supabase/migrations/${nome}`)
  .filter((caminho) => !declaradas.has(caminho))
  .sort();

if (pendentes.length === 0) {
  console.log('Nada a registrar: todas as migrations ja estao declaradas.');
  process.exit(0);
}

const linhasManifesto = [];
for (const caminho of pendentes) {
  const sql = conteudoDoGit(caminho);
  const statements = splitSupabaseStatements(sql);
  if (statements.length === 0) throw new Error(`sem comandos: ${caminho}`);
  const nome = caminho.slice('supabase/migrations/'.length);
  const entrada = {
    version: nome.slice(0, 14),
    path: caminho,
    local_sha256: sha256(sql),
    remote_name: nome.slice(15).replace(/\.sql$/, ''),
    remote_statements_sha256: supabaseStatementsSha256(sql),
    remote_hash_mode: 'supabase_cli_split',
  };
  baseline.forward_migrations.push(entrada);
  linhasManifesto.push(`${entrada.local_sha256}  ${caminho}`);
  console.log(`registrada ${nome}`);
}

writeFileSync(MANIFESTO, manifesto.replace(/\s*$/, '\n') + linhasManifesto.join('\n') + '\n', 'utf8');
writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
console.log(`${pendentes.length} migration(s) anotada(s). Ajuste os totais em src/test/production-migration-view.test.ts.`);
