// Carrega os arquivos de lib/ do mesmo jeito que o gerador os embute nos nós Code:
// concatenados, num escopo de função, sem require.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function carregarLib(...nomes) {
  const fonte = nomes.map((n) => fs.readFileSync(path.join(raiz, 'lib', n + '.js'), 'utf8')).join('\n;\n');
  const nomesFn = [...fonte.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
  const nomesVar = [...fonte.matchAll(/^var (\w+)/gm)].map((m) => m[1]);
  return new Function(fonte + '\nreturn {' + [...nomesFn, ...nomesVar].join(',') + '};')();
}
export const lerJson = (rel) => JSON.parse(fs.readFileSync(path.join(raiz, rel), 'utf8'));
export { raiz };
