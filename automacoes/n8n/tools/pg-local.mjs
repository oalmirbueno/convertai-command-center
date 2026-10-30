// Postgres local persistente para os testes e para o n8n local (homologação na máquina).
// Uso: node tools/pg-local.mjs  (fica rodando; Ctrl+C para parar). Porta 54329, só 127.0.0.1.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
const dir = process.env.ACQ_PG_DIR || 'C:/AI/n8n-local/pg-dados';
const porta = Number(process.env.ACQ_PG_PORTA || 54329);
const novo = !fs.existsSync(dir + '/PG_VERSION');
const pgEmb = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'teste-local', port: porta, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--no-locale'], onLog: () => {}, onError: (e) => console.error(String(e)) });
if (novo) await pgEmb.initialise();
await pgEmb.start();
console.log('pg-local pronto na porta', porta, novo ? '(criado)' : '(reaproveitado)');
const parar = async () => { await pgEmb.stop(); process.exit(0); };
process.on('SIGINT', parar); process.on('SIGTERM', parar);
setInterval(() => {}, 1 << 30);
