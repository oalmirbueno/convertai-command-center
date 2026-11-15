// Importa os fluxos gerados (build/gerar.mjs --saida <pasta>) no n8n do VPS pelo CLI do container,
// sem depender da tela nem do MCP da instância. Mantém os ids do gerador (as chamadas entre fluxos e as
// credenciais já apontam para eles) e troca o nome pelo nome humano (NOME_REMOTO do importador).
// Tudo entra DESLIGADO; ligar é passo separado (publicar.sh), um fluxo por vez.
// Uso: node importar-pelo-cli.mjs --pasta <pasta> [--somente ACQ-03-Post-No-Ar,ACQ-04-...]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const PASTA = path.resolve(arg('pasta', ''));
const SOMENTE = arg('somente', '') ? arg('somente').split(',').map((s) => s.trim()) : null;
const SSH = process.env.N8N_SSH || 'root@ssh.aceleriq.com.br';
const CONTAINER = process.env.N8N_CONTAINER || 'n8n-recovery-n8n-1';

const fonte = fs.readFileSync(new URL('../../tools/importar-homologacao.mjs', import.meta.url), 'utf8');
const NOME_REMOTO = Function('return ' + fonte.match(/const NOME_REMOTO = (\{[\s\S]*?\});/)[1])();

const itens = [];
for (const f of fs.readdirSync(PASTA).filter((f) => f.endsWith('.json')).sort()) {
  const chave = f.replace(/\.json$/, '');
  if (SOMENTE && !SOMENTE.includes(chave)) continue;
  const wf = JSON.parse(fs.readFileSync(path.join(PASTA, f), 'utf8'));
  if (!NOME_REMOTO[chave]) throw new Error('sem nome humano para ' + chave);
  wf.name = NOME_REMOTO[chave];
  wf.active = false;
  itens.push({ arquivo: wf.id + '.json', chave, id: wf.id, nome: wf.name, json: JSON.stringify(wf) });
}
if (!itens.length) throw new Error('nenhum fluxo em ' + PASTA);

// Um único envio: linhas "arquivo<TAB>base64" lidas dentro do container.
const carga = itens.map((i) => i.arquivo + '\t' + Buffer.from(i.json).toString('base64')).join('\n') + '\n';
const remoto = `docker exec -i ${CONTAINER} sh -c 'd=/tmp/acq-wf-$$; mkdir -p $d; while IFS="	" read -r a b; do echo "$b" | base64 -d > "$d/$a"; done; n8n import:workflow --separate --input=$d; s=$?; rm -rf $d; exit $s'`;
const r = spawnSync('ssh', ['-o', 'BatchMode=yes', SSH, remoto], { input: carga, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
console.log((r.stdout || '').trim());
if (r.status !== 0) { console.error((r.stderr || '').trim().slice(0, 1500)); process.exit(1); }
for (const i of itens) console.log('importado (desligado):', i.chave, '→', i.id, '|', i.nome);
