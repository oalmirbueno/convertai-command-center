// Banco descartável por arquivo de teste, num Postgres real local (tools/pg-local.mjs).
// Se o servidor local não estiver de pé, sobe um temporário. Nada sai da máquina.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = path.join(raiz, 'migrations', '20261014120000_acq_n8n_estado.sql');
const base = { host: '127.0.0.1', port: Number(process.env.ACQ_PG_PORTA || 54329), user: 'postgres', password: 'teste-local' };

async function servidorNoAr() {
  const c = new pg.Client({ ...base, database: 'postgres', connectionTimeoutMillis: 1500 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

export async function subirPostgres() {
  let temporario = null;
  let cfgBase = base;
  if (!(await servidorNoAr())) {
    const porta = 55400 + Math.floor(Math.random() * 400);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-n8n-pg-'));
    temporario = { pgEmb: new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'teste-local', port: porta, persistent: false,
      initdbFlags: ['--encoding=UTF8', '--no-locale'], onLog: () => {}, onError: () => {} }), dir };
    await temporario.pgEmb.initialise();
    await temporario.pgEmb.start();
    cfgBase = { ...base, port: porta };
  }
  const nome = 'acq_t_' + process.pid + '_' + Math.floor(Math.random() * 1e6);
  const root = new pg.Client({ ...cfgBase, database: 'postgres' });
  await root.connect();
  await root.query(`create database ${nome} encoding 'UTF8' template template0`);
  const cfg = { ...cfgBase, database: nome };
  const admin = new pg.Client(cfg);
  await admin.connect();
  await admin.query(fs.readFileSync(MIGRATION, 'utf8'));
  const clientes = [];
  return {
    cfg,
    admin,
    novoCliente: async () => { const c = new pg.Client(cfg); await c.connect(); clientes.push(c); return c; },
    parar: async () => {
      for (const c of clientes) await c.end().catch(() => {});
      await admin.end().catch(() => {});
      await root.query(`drop database if exists ${nome} with (force)`).catch(() => {});
      await root.end().catch(() => {});
      if (temporario) { await temporario.pgEmb.stop(); fs.rmSync(temporario.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
    },
  };
}
