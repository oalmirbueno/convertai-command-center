// n8n LOCAL de teste (2.42.7, C:/AI/n8n-local): pasta própria, SQLite, credenciais de teste que só
// apontam para 127.0.0.1. Nada aqui fala com a Hostinger nem com produção.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const N8N_DIR = process.env.ACQ_N8N_LOCAL || 'C:/AI/n8n-local2';
const BIN = path.join(N8N_DIR, 'node_modules/n8n/bin/n8n');
export const ENV = {
  ...process.env,
  N8N_USER_FOLDER: path.join(N8N_DIR, 'dados'),
  N8N_ENCRYPTION_KEY: 'chave-local-de-teste-acq-n8n-0001',
  N8N_DIAGNOSTICS_ENABLED: 'false', N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', N8N_TEMPLATES_ENABLED: 'false',
  N8N_PERSONALIZATION_ENABLED: 'false', GENERIC_TIMEZONE: 'America/Sao_Paulo', TZ: 'America/Sao_Paulo',
  // Banco interno do n8n no Postgres local (o driver SQLite nativo não vem na instalação pelo bun).
  DB_TYPE: 'postgresdb', DB_POSTGRESDB_HOST: '127.0.0.1', DB_POSTGRESDB_PORT: '54329', DB_POSTGRESDB_DATABASE: 'n8n_interno',
  DB_POSTGRESDB_USER: 'postgres', DB_POSTGRESDB_PASSWORD: 'teste-local',
  // Sem servidor rodando, a fila de publicação (outbox) nunca é processada; ler a versão publicada direto.
  N8N_USE_WORKFLOW_PUBLICATION_SERVICE: 'false',
  // Runner de Code sobe sob demanda; nesta máquina a partida a frio pode passar de 60 s.
  N8N_RUNNERS_TASK_REQUEST_TIMEOUT: '300', N8N_RUNNERS_TASK_TIMEOUT: '600', N8N_RUNNERS_GRANT_TOKEN_TTL: '300',
  N8N_LOG_LEVEL: 'warn', N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true', EXECUTIONS_TIMEOUT: '600', N8N_RUNNERS_ENABLED: 'true',
};

export function n8n(args, { timeout = 900000 } = {}) {
  return new Promise((ok) => {
    execFile(process.execPath, [BIN, ...args], { env: ENV, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => ok({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

export function credenciaisDeTeste(dbName) {
  return [
    { id: 'AcqCredPg0000001', name: 'ACQ Estado (Postgres acq_n8n)', type: 'postgres', data: { host: '127.0.0.1', port: 54329, database: dbName, user: 'postgres', password: 'teste-local', ssl: 'disable', allowUnauthorizedCerts: false } },
    { id: 'AcqCredMcp000001', name: 'ACQ MCP Aceleriq (máquina n8n)', type: 'httpBearerAuth', data: { token: 'teste-local-mcp' } },
    { id: 'AcqCredTs0000001', name: 'TypeSafe Jev (servidor)', type: 'httpBearerAuth', data: { token: 'teste-local-jev' } },
    { id: 'AcqCredWh0400001', name: 'ACQ Webhook mensagens (segredo)', type: 'httpHeaderAuth', data: { name: 'x-acq-segredo', value: 'teste-local-wh04' } },
    { id: 'AcqCredWh0200001', name: 'ACQ Webhook recibos (segredo)', type: 'httpHeaderAuth', data: { name: 'x-acq-segredo', value: 'teste-local-wh02' } },
  ];
}

export async function importar(pastaWorkflows, dbName) {
  const tmp = path.join(N8N_DIR, 'tmp-import');
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'credenciais.json'), JSON.stringify(credenciaisDeTeste(dbName)));
  const c = await n8n(['import:credentials', '--input=' + path.join(tmp, 'credenciais.json')]);
  if (c.code) throw new Error('import:credentials ' + c.stderr.slice(-800) + c.stdout.slice(-400));
  const w = await n8n(['import:workflow', '--separate', '--input=' + pastaWorkflows]);
  if (w.code) throw new Error('import:workflow ' + w.stderr.slice(-800) + w.stdout.slice(-400));
  return { credenciais: c.stdout.trim().split('\n').pop(), workflows: w.stdout.trim().split('\n').pop() };
}

// Executa um workflow pelo CLI e devolve os dados da execução (runData por nó).
export async function executar(id) {
  const t0 = Date.now();
  const r = await n8n(['execute', '--id=' + id, '--rawOutput']);
  const ms = Date.now() - t0;
  const txt = r.stdout;
  const i = txt.indexOf('{');
  let dados = null;
  try { dados = JSON.parse(txt.slice(i)); } catch { /* saída não-JSON (erro) */ }
  return { code: r.code, ms, dados, bruto: dados ? null : (txt + '\n' + r.stderr).slice(-3000) };
}

// n8n 2.x só executa sub-workflow PUBLICADO fora do modo manual (o CLI roda em modo 'cli').
// Publica apenas na instância LOCAL de teste; sem `n8n start` nenhum gatilho de agenda/webhook roda.
export async function publicarLocal(ids) {
  for (const id of ids) {
    const r = await n8n(['publish:workflow', '--id=' + id]);
    if (r.code) throw new Error('publish:workflow ' + id + ' ' + (r.stderr || r.stdout).slice(-400));
  }
}
