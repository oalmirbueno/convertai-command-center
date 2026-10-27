// Testa o Aceleriq de Bolso no banco do projeto SEM deixar nada gravado.
//
// Monta: BEGIN; migration (sem o próprio BEGIN/COMMIT); cenários; e termina com
// um erro proposital que carrega os resultados. O erro aborta a transação
// inteira: a migration, os usuários sintéticos e os dados de teste somem.
// Nada é confirmado (não existe COMMIT no arquivo montado).
//
// Uso: node scripts/bolso-testar-banco.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const MIGRATION = "supabase/migrations/20261026230000_aceleriq_de_bolso.sql";
const CENARIOS = "supabase/testes/bolso_cenarios.sql";
const PROJETO = "jjjtkowvxemvituvywvf";

let migracao = readFileSync(MIGRATION, "utf8");
const inicio = migracao.indexOf("\nBEGIN;\n");
const fim = migracao.lastIndexOf("\nCOMMIT;");
if (inicio < 0 || fim < 0) throw new Error("A migration precisa ter BEGIN; e COMMIT; em linhas próprias.");
migracao = migracao.slice(inicio + "\nBEGIN;\n".length, fim);
if (/\bCOMMIT\b/i.test(migracao)) throw new Error("COMMIT a mais na migration: abortado para não gravar nada.");

let cenarios = readFileSync(CENARIOS, "utf8");
if (/\bCOMMIT\b/i.test(cenarios)) throw new Error("COMMIT nos cenários: abortado.");
// A última consulta vira o erro proposital com os resultados.
cenarios = cenarios.replace(
  /SELECT n, ok, teste, left\(detalhe, 160\) AS detalhe FROM pg_temp\.r ORDER BY n;\s*$/,
  `DO $fim$ BEGIN RAISE EXCEPTION 'RESULTADO_BOLSO %', (SELECT json_agg(json_build_object('n', n, 'ok', ok, 'teste', teste, 'detalhe', left(detalhe, 160)) ORDER BY n) FROM pg_temp.r); END $fim$;\n`,
);
if (!cenarios.includes("RESULTADO_BOLSO")) throw new Error("Não achei a consulta final dos cenários.");

const dir = mkdtempSync(join(tmpdir(), "bolso-teste-"));
const arquivo = join(dir, "bolso.sql");
writeFileSync(arquivo, `BEGIN;\n${migracao}\n${cenarios}`, "utf8");

const r = spawnSync("npx", ["--yes", "supabase@2.117.0", "db", "query", "--linked", "--project-ref", PROJETO, "-f", arquivo], {
  encoding: "utf8",
  shell: true,
  maxBuffer: 64 * 1024 * 1024,
});
const saida = `${r.stdout || ""}\n${r.stderr || ""}`;
// A CLI devolve {"_tag":"Error","error":{"message":"unexpected status 400: {\"message\":\"... RESULTADO_BOLSO [...]\"}"}}.
function mensagemDoBanco(texto) {
  for (const linha of texto.split("\n")) {
    if (!linha.trim().startsWith("{")) continue;
    try {
      const fora = JSON.parse(linha);
      const msg = fora && fora.error && fora.error.message ? String(fora.error.message) : "";
      const i = msg.indexOf("{");
      if (i < 0) return msg;
      const dentro = JSON.parse(msg.slice(i));
      return String(dentro.message || msg);
    } catch {
      /* linha que não é JSON */
    }
  }
  return texto;
}
const msg = mensagemDoBanco(saida);
const iniRes = msg.indexOf("RESULTADO_BOLSO [");
const fimRes = msg.lastIndexOf("]");
if (iniRes < 0 || fimRes < iniRes) {
  console.error("Sem resultado dos cenários. Saída do banco:\n" + msg.slice(0, 4000));
  process.exit(2);
}
let lista;
try {
  lista = JSON.parse(msg.slice(iniRes + "RESULTADO_BOLSO ".length, fimRes + 1));
} catch {
  console.error("Resultado ilegível:\n" + msg.slice(0, 4000));
  process.exit(2);
}
let falhas = 0;
for (const t of lista) {
  if (!t.ok) falhas++;
  console.log(`${t.ok ? "ok   " : "FALHA"} ${String(t.n).padStart(3)} ${t.teste}${t.ok ? "" : `  →  ${t.detalhe}`}`);
}
console.log(`\n${lista.length - falhas} de ${lista.length} cenários passaram. Nada foi gravado (transação abortada de propósito).`);
process.exit(falhas ? 1 : 0);
