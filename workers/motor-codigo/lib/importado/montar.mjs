/**
 * O build do motor para um site IMPORTADO na Mesa Site (o worker copia este
 * arquivo para .aceleriq/montar.mjs do projeto; o package.json do projeto
 * aponta "build" e "checar" para ele). Roda o build original
 * ("build:importado") e leva a saída para dist/, que é o que o motor confere,
 * mostra na prévia e publica. Site estático (sem build): copia os arquivos do
 * site para dist/. Erro sai com "Error:" (o motor mostra a primeira linha).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const raiz = process.cwd();
const dist = join(raiz, "dist");
const FORA = new Set(["node_modules", ".git", ".aceleriq", "dist", "package.json", "package-lock.json", "AGENTS.md", ".gitignore", ".opencode", "opencode.json", "referencias", ".metodo"]);

function falhar(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

let registro;
try {
  registro = JSON.parse(readFileSync(join(raiz, ".aceleriq", "importado.json"), "utf8"));
} catch {
  falhar("falta o .aceleriq/importado.json (o projeto não veio da importação)");
}

const ehPasta = (d) => existsSync(d) && statSync(d).isDirectory();
/** A pasta com o index.html: a própria ou até 2 níveis abaixo (Angular põe em dist/<app>/browser). */
function acharIndex(d, nivel = 0) {
  if (!ehPasta(d)) return null;
  if (existsSync(join(d, "index.html"))) return d;
  if (nivel >= 2) return null;
  for (const n of readdirSync(d)) {
    const a = acharIndex(join(d, n), nivel + 1);
    if (a) return a;
  }
  return null;
}

if (registro.build) {
  const r = spawnSync("npm run build:importado", { cwd: raiz, stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) falhar(`o build do projeto (${registro.rotulo}) falhou`);
  const candidatas = [registro.saida, "dist", "build", "out", ".output/public", "public", "_site"].filter((x, i, l) => !!x && l.indexOf(x) === i);
  let achada = null;
  for (const c of candidatas) {
    achada = acharIndex(join(raiz, c));
    if (achada) break;
  }
  if (!achada) falhar(`o build terminou sem index.html (procurei em ${candidatas.join(", ")})`);
  if (resolve(achada) !== resolve(dist)) {
    const tmp = join(raiz, ".aceleriq", "saida-tmp");
    rmSync(tmp, { recursive: true, force: true });
    cpSync(achada, tmp, { recursive: true });
    rmSync(dist, { recursive: true, force: true });
    cpSync(tmp, dist, { recursive: true });
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  for (const n of readdirSync(raiz)) {
    if (FORA.has(n)) continue;
    cpSync(join(raiz, n), join(dist, n), { recursive: true });
  }
  if (!existsSync(join(dist, "index.html"))) falhar("falta o index.html na raiz do site");
}
console.log(`dist pronto (${registro.rotulo})`);
