// Gera segredos novos SEM exibir, cria a credencial no n8n e escreve num arquivo só o que o banco precisa
// (derivados que não revelam o segredo). Autorizado pelo Almir em 14/11/2026.
//   postgres: senha nova do papel acq_n8n_worker  → arquivo com o verificador SCRAM-SHA-256 (para ALTER ROLE)
//   mcp:      valor novo da chave "N8N Almir"      → arquivo com o sha256 e a prévia (para UPDATE em api_keys)
// Uso: node rotacionar-segredos.mjs <postgres|mcp> <arquivo-de-saida>
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [qual, saida] = process.argv.slice(2);
if (!['postgres', 'mcp'].includes(qual) || !saida) throw new Error('uso: rotacionar-segredos.mjs <postgres|mcp> <arquivo>');
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const criar = (extra) => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./criar-credenciais.mjs', import.meta.url)), qual], { env: { ...process.env, ...extra }, encoding: 'utf8' });
  console.log((r.stdout || '').trim());
  if (r.status !== 0) { console.error((r.stderr || '').trim().slice(0, 800)); process.exit(1); }
};

if (qual === 'postgres') {
  const senha = b64url(crypto.randomBytes(30));
  const sal = crypto.randomBytes(16), iter = 4096;
  const salted = crypto.pbkdf2Sync(senha, sal, iter, 32, 'sha256');
  const clientKey = crypto.createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const serverKey = crypto.createHmac('sha256', salted).update('Server Key').digest();
  const verificador = `SCRAM-SHA-256$${iter}:${sal.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
  criar({ ACQ_PG_SENHA: senha });
  fs.writeFileSync(saida, verificador + '\n');
} else {
  const chave = 'mcp_live_' + b64url(crypto.randomBytes(32));
  criar({ ACQ_MCP_CHAVE: chave });
  fs.writeFileSync(saida, JSON.stringify({ key_hash: crypto.createHash('sha256').update(chave).digest('hex'), key_preview: chave.slice(0, 12) + '…' }) + '\n');
}
console.log('derivado gravado em ' + saida);
