// Recria no n8n do VPS as credenciais que os fluxos ACQ pedem, com os MESMOS ids e nomes do gerador.
// Os valores saem das variáveis de usuário do Windows (ou do ambiente) e vão direto para o container
// pela entrada padrão do ssh: nada é impresso, nada fica em arquivo deste computador.
// Uso: node criar-credenciais.mjs <quais...>   quais = openrouter typesafe whatsapp recibos postgres mcp
//   postgres: exige ACQ_PG_SENHA no ambiente (senha nova do papel acq_n8n_worker)
//   mcp:      exige ACQ_MCP_CHAVE no ambiente (chave do painel "N8N Almir")
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const SSH = process.env.N8N_SSH || 'root@ssh.aceleriq.com.br';
const CONTAINER = process.env.N8N_CONTAINER || 'n8n-recovery-n8n-1';
const REF = 'jjjtkowvxemvituvywvf';

function env(n, obrigatoria = true) {
  let v = process.env[n];
  if (!v) v = execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${n}','User')`], { encoding: 'utf8' }).trim();
  if (!v && obrigatoria) throw new Error('variável ausente: ' + n);
  return v;
}
async function confere(rotulo, url, token) {
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
  console.log(`  conferência ${rotulo}: HTTP ${r.status}`);
  if (!r.ok) throw new Error(rotulo + ' recusou a chave (HTTP ' + r.status + '); credencial não criada.');
}

const FABRICA = {
  async openrouter() {
    const token = env('OPENROUTER_API_KEY');
    await confere('OpenRouter', 'https://openrouter.ai/api/v1/key', token);
    return { id: 'AcqCredLlm000001', name: 'ACQ OpenRouter (Mercúrio)', type: 'httpBearerAuth', data: { token } };
  },
  async typesafe() {
    return { id: 'AcqCredTs0000001', name: 'TypeSafe Jev (servidor)', type: 'httpBearerAuth', data: { token: env('TYPESAFE_API_KEY') } };
  },
  async whatsapp() {
    const token = env('WHATSAPP_AGENTES_TOKEN');
    await confere('Meta (número 2161)', 'https://graph.facebook.com/v21.0/1382841941586124?fields=id', token);
    return { id: 'AcqCredMeta00001', name: 'ACQ WhatsApp Cloud API (Meta)', type: 'httpBearerAuth', data: { token } };
  },
  async recibos() {
    // ACQ-02 fica desligado (o Hermes já faz); segredo novo só para a credencial existir.
    return { id: 'AcqCredWh0200001', name: 'ACQ Webhook recibos (segredo)', type: 'httpHeaderAuth', data: { name: 'x-acq-segredo', value: crypto.randomBytes(32).toString('hex') } };
  },
  async postgres() {
    return {
      id: 'AcqCredPg0000001', name: 'ACQ Estado (Postgres acq_n8n)', type: 'postgres',
      data: {
        host: process.env.ACQ_PG_HOST || 'aws-0-sa-east-1.pooler.supabase.com', port: Number(process.env.ACQ_PG_PORTA || 5432), database: 'postgres',
        user: 'acq_n8n_worker.' + REF, password: env('ACQ_PG_SENHA'), ssl: 'require', allowUnauthorizedCerts: true, maxConnections: 5,
      },
    };
  },
  async google() {
    // Casca vazia com o id que o ACQ-07 espera; o dono abre a credencial na tela, preenche e faz o login do Google.
    return { id: 'AcqCredGoogle001', name: 'ACQ Google Agenda', type: 'googleCalendarOAuth2Api', data: {} };
  },
  async mcp() {
    return { id: 'AcqCredMcp000001', name: 'ACQ MCP Aceleriq (máquina n8n)', type: 'httpBearerAuth', data: { token: env('ACQ_MCP_CHAVE') } };
  },
};

const quais = process.argv.slice(2);
if (!quais.length) throw new Error('diga quais: ' + Object.keys(FABRICA).join(' '));
const lista = [];
for (const q of quais) {
  if (!FABRICA[q]) throw new Error('credencial desconhecida: ' + q);
  console.log('preparando ' + q);
  lista.push(await FABRICA[q]());
}
const remoto = `docker exec -i ${CONTAINER} sh -c 'umask 077; f=/tmp/acq-cred-$$.json; cat > $f; n8n import:credentials --input=$f; s=$?; rm -f $f; exit $s'`;
const r = spawnSync('ssh', ['-o', 'BatchMode=yes', SSH, remoto], { input: JSON.stringify(lista), encoding: 'utf8' });
console.log((r.stdout || '').trim());
if (r.status !== 0) { console.error((r.stderr || '').trim().slice(0, 800)); process.exit(1); }
console.log('criadas: ' + lista.map((c) => c.name).join(' | '));
