/**
 * Teste ponta a ponta do instalador do Aceleriq Motores (frente SUP, 01/10/2026),
 * numa pasta temporária, com pareamento falso. Só Windows.
 *
 *   node workers/instalador/testes/ponta-a-ponta.ts [--motores render] [--sem-npm] [--provas <pasta>]
 *
 * O que faz, de verdade:
 * 1. monta o pacote dos workers do índice do git (o que está staged) e o .cmd
 *    que o painel baixa (o mesmo montarInstaladorDe da tela);
 * 2. sobe um servidor falso em 127.0.0.1 (motores-parear, o pacote, a batida da
 *    máquina e o resto do PostgREST respondendo vazio);
 * 3. roda o .cmd adulterado (tem que recusar) e o .cmd certo, com o código;
 * 4. confere: cofre DPAPI sem a chave em texto, maquina.json, atual.json, deps,
 *    atalho da pasta Inicializar (conhost --headless), supervisor ligado pelo
 *    controle local, batida com a chave certa, worker de verdade de pé, NENHUMA
 *    janela visível na árvore, nenhuma chave nos registros;
 * 5. o mesmo código de novo é recusado pelo instalador;
 * 6. "Remover máquina": a batida responde revogada, o supervisor para e apaga o cofre;
 * 7. desinstalar tira o atalho.
 * Nada é instalado no perfil de verdade: pasta, atalho e controle são da pasta temporária.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { montarInstaladorDe } from "../../../src/lib/motores/montarInstalador.ts";
import { montarPacote } from "../../supervisor/pacote.ts";
import { cofreDoWindows } from "../../supervisor/segredos.ts";

const args = process.argv.slice(2);
const valor = (f: string) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MOTORES = (valor("--motores") ?? "render").split(",").filter(Boolean);
const SEM_NPM = args.indexOf("--sem-npm") >= 0;
const CHAVE = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.chave-falsa-do-ponta-a-ponta-sup";
const MAQUINA = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const CODIGO = "ABCD-EFGH";

if (process.platform !== "win32") {
  console.log("Só no Windows.");
  process.exit(0);
}

let falhas = 0;
const ok = (cond: unknown, t: string) => {
  console.log(`${cond ? "  ok   " : "  FALHA"} ${t}`);
  if (!cond) falhas++;
};
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(path.join(os.tmpdir(), "aceleriq-instalador-e2e-"));
const raiz = path.join(tmp, "Motores");
const inicializar = path.join(tmp, "Inicializar");
const provas = valor("--provas");
if (provas) mkdirSync(provas, { recursive: true });
console.log(`Pasta temporária: ${tmp}`);

// 1) Pacote e instalador.
const zip = path.join(tmp, "pacote.zip");
const p = montarPacote(REPO, zip, "indice");
console.log(`Pacote: versão ${p.versao}, ${(p.tamanho / 1024 / 1024).toFixed(1)} MB`);

// 2) Servidor falso.
let usado = false;
let revogar = false;
const sinais: Array<{ apikey: string; corpo: Record<string, unknown> }> = [];
const outros: string[] = [];
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (d) => (corpo += d));
  req.on("end", () => {
    const url = req.url || "";
    const json = (status: number, d: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(d));
    };
    if (req.method === "POST" && url === "/functions/v1/motores-parear") {
      const b = JSON.parse(corpo || "{}") as { acao?: string; codigo?: string };
      const cod = String(b.codigo || "").toUpperCase().replace(/[\s-]/g, "");
      if (b.acao === "trocar" && cod === CODIGO.replace("-", "") && !usado) {
        usado = true;
        return json(200, {
          ok: true,
          supabase_url: base,
          chave_de_servico: CHAVE,
          maquina: { id: MAQUINA, nome: "PC-E2E", motores: MOTORES },
          pacote: { versao: p.versao, sha256: p.sha256, tamanho: p.tamanho, url: `${base}/pacote.zip` },
        });
      }
      return json(404, { error: "ja_usado", mensagem: "Código inválido, vencido ou já usado. Gere um novo no painel (Configurações › Estado dos motores)." });
    }
    if (req.method === "GET" && url === "/pacote.zip") {
      res.writeHead(200, { "Content-Type": "application/zip" });
      return res.end(readFileSync(zip));
    }
    if (url === "/rest/v1/rpc/motores_maquina_sinal") {
      sinais.push({ apikey: String(req.headers.apikey || ""), corpo: JSON.parse(corpo || "{}") });
      if (revogar) return json(200, { maquina_id: MAQUINA, revogada: true });
      return json(200, { maquina_id: MAQUINA, revogada: false, nome: "PC-E2E", motores: MOTORES, versao_alvo: null });
    }
    if (url === "/rest/v1/rpc/chaves_do_cofre") return json(200, {});
    outros.push(`${req.method} ${url.split("?")[0]}`);
    if (url.startsWith("/rest/v1/rpc/")) return json(200, []);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end("[]");
  });
});
await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;

const script = readFileSync(path.join(REPO, "workers", "instalador", "instalar-motores.ps1"), "utf8");
const inst = await montarInstaladorDe(script, { supabaseUrl: "https://exemplo.supabase.co", chavePublica: "sb_publishable_teste", painelUrl: "https://aceleriq.online" });
// O endereço do projeto fica fora do trecho conferido por hash: o teste aponta para o servidor falso.
const cmdCerto = inst.conteudo.replace('set "ACELERIQ_URL=https://exemplo.supabase.co"', `set "ACELERIQ_URL=${base}"`);
const arqCerto = path.join(tmp, "instalar-aceleriq-motores.cmd");
writeFileSync(arqCerto, cmdCerto);
const arqAdulterado = path.join(tmp, "adulterado.cmd");
writeFileSync(arqAdulterado, cmdCerto.replace("Aceleriq Motores: instalador (frente SUP", "Aceleriq Motores: instalador (frente XXX"));

const ambiente = {
  ...process.env,
  // O supervisor do teste nunca abre navegador nem pasta (nem por clique).
  ACELERIQ_SEM_NAVEGADOR: "1",
  ACELERIQ_MOTORES_PASTA: raiz,
  ACELERIQ_PASTA_INICIALIZAR: inicializar,
  ACELERIQ_CODIGO: CODIGO.toLowerCase(),
  ACELERIQ_SEM_DEPENDENCIAS: "1",
  ACELERIQ_MOTORES: MOTORES.join(","),
  ...(SEM_NPM ? { ACELERIQ_SEM_NPM: "1" } : {}),
};

function rodarCmd(arq: string, extra: Record<string, string> = {}): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolver) => {
    const c = spawn("cmd.exe", ["/d", "/c", arq], { env: { ...ambiente, ...extra }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let saida = "";
    c.stdout.on("data", (d) => (saida += d));
    c.stderr.on("data", (d) => (saida += d));
    c.stdin.end("\r\n\r\n");
    c.on("exit", (codigo) => resolver({ codigo: codigo ?? -1, saida }));
  });
}

const lancador = () => path.join(raiz, "lancador.mjs");
const comando = (c: string) => {
  const r = spawnSync(process.execPath, [lancador(), "--pasta", raiz, "--comando", c], { encoding: "utf8", windowsHide: true });
  try {
    return JSON.parse(r.stdout) as { ok: boolean; resposta?: { motores?: Record<string, { situacao?: string; versao_do_worker?: string | null }> } };
  } catch {
    return { ok: false };
  }
};

/** PIDs da árvore dos motores desta pasta (conhost --headless, lançador, supervisor, workers, bandeja) e os que têm janela visível. */
function arvoreEJanelas(): { nomes: string[]; comJanela: string[] } {
  const ps = `
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class J2 { public delegate bool F(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(F f, IntPtr l);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 public static List<uint> V() { var r = new List<uint>(); EnumWindows((h,l) => { if (IsWindowVisible(h)) { uint p; GetWindowThreadProcessId(h, out p); r.Add(p); } return true; }, IntPtr.Zero); return r; } }
"@
$todos = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
$s = New-Object System.Collections.Generic.HashSet[uint32]
foreach ($p in $todos) { if ($p.CommandLine -and $p.CommandLine.Contains($env:RAIZ)) { [void]$s.Add([uint32]$p.ProcessId) } }
do { $n = $s.Count; foreach ($p in $todos) { if ($s.Contains([uint32]$p.ParentProcessId)) { [void]$s.Add([uint32]$p.ProcessId) } } } while ($s.Count -ne $n)
$v = [J2]::V()
@{ nomes = @($todos | ? { $s.Contains([uint32]$_.ProcessId) } | % { $_.Name }); comJanela = @($todos | ? { $s.Contains([uint32]$_.ProcessId) -and $v.Contains([uint32]$_.ProcessId) } | % { $_.Name }) } | ConvertTo-Json -Compress`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, RAIZ: raiz }, encoding: "utf8", windowsHide: true });
  const j = JSON.parse(r.stdout.trim() || "{}") as { nomes?: string[] | string; comJanela?: string[] | string };
  return { nomes: ([] as string[]).concat(j.nomes || []), comJanela: ([] as string[]).concat(j.comJanela || []) };
}

function lerAtalho(arq: string): { alvo: string; args: string } {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `$l=(New-Object -ComObject WScript.Shell).CreateShortcut($env:ATALHO); @{alvo=$l.TargetPath; args=$l.Arguments} | ConvertTo-Json -Compress`], { env: { ...process.env, ATALHO: arq }, encoding: "utf8", windowsHide: true });
  return JSON.parse(r.stdout.trim()) as { alvo: string; args: string };
}

const todosOsRegistros = () => {
  const dir = path.join(raiz, "logs");
  return existsSync(dir) ? readdirSync(dir).map((a) => readFileSync(path.join(dir, a), "utf8")).join("\n") : "";
};

try {
  console.log("\n3) Instalador adulterado");
  const ad = await rodarCmd(arqAdulterado);
  ok(ad.codigo === 9 && /alterado no caminho/.test(ad.saida), `o .cmd adulterado recusa rodar (código ${ad.codigo})`);
  ok(!existsSync(raiz), "nada foi instalado pelo adulterado");

  console.log(`\n3) Instalador certo (motores: ${MOTORES.join(", ") || "nenhum"}${SEM_NPM ? ", sem npm" : ", npm ci de verdade"})`);
  const t0 = Date.now();
  const r = await rodarCmd(arqCerto);
  if (provas) writeFileSync(path.join(provas, "instalador-saida.txt"), r.saida);
  ok(r.codigo === 0 && /Pronto\. Os motores desta máquina rodam sem janela/.test(r.saida), `instalador terminou (código ${r.codigo}, ${Math.round((Date.now() - t0) / 1000)} s)`);
  ok(r.saida.indexOf(CHAVE) < 0, "a chave não aparece na tela do instalador");

  console.log("\n4) O que ficou na máquina");
  const cofre = path.join(raiz, "cofre.dat");
  const bytes = existsSync(cofre) ? readFileSync(cofre) : Buffer.alloc(0);
  ok(bytes.length > 0, "cofre.dat gravado");
  ok(bytes.indexOf(Buffer.from(CHAVE)) < 0 && bytes.indexOf(Buffer.from(Buffer.from(CHAVE).toString("base64"))) < 0, "o cofre não tem a chave em texto nem em base64");
  ok((await cofreDoWindows(cofre).ler()).SUPABASE_SERVICE_ROLE_KEY === CHAVE, "o DPAPI devolve a chave para este usuário");
  const maq = JSON.parse(readFileSync(path.join(raiz, "maquina.json"), "utf8")) as { maquina_id: string; motores: string[]; supabase_url: string };
  ok(maq.maquina_id === MAQUINA && maq.supabase_url === base, "maquina.json com o id do pareamento e o endereço do projeto");
  ok(JSON.stringify(maq).indexOf(CHAVE) < 0, "maquina.json sem chave");
  const atual = JSON.parse(readFileSync(path.join(raiz, "atual.json"), "utf8")) as { versao: string };
  ok(atual.versao === p.versao, `atual.json na versão ${atual.versao}`);
  ok(existsSync(lancador()), "lançador estável copiado para a raiz");
  for (const m of MOTORES) {
    const pasta = { render: "render", codigo: "motor-codigo", navegador: "computador" }[m] as string;
    ok(existsSync(path.join(raiz, "versoes", p.versao, "workers", pasta, "node_modules")), `dependências de ${m} ligadas`);
  }
  const atalho = path.join(inicializar, "Aceleriq Motores.lnk");
  ok(existsSync(atalho), "atalho na pasta Inicializar (temporária)");
  if (existsSync(atalho)) {
    const a = lerAtalho(atalho);
    ok(/conhost\.exe$/i.test(a.alvo) && /--headless/.test(a.args) && a.args.indexOf("lancador.mjs") > 0 && a.args.indexOf(raiz) > 0, `atalho: ${path.basename(a.alvo)} ${a.args.replace(raiz, "<raiz>")}`);
  }

  console.log("\n5) Ligado, invisível e batendo ponto");
  let e = comando("estado");
  for (let i = 0; i < 30 && !(e.ok && MOTORES.every((m) => e.resposta?.motores?.[m]?.situacao === "ligado")); i++) {
    await dormir(1000);
    e = comando("estado");
  }
  ok(e.ok, "o supervisor responde pelo controle local");
  for (const m of MOTORES) ok(e.resposta?.motores?.[m]?.situacao === "ligado", `${m}: ${e.resposta?.motores?.[m]?.situacao} (${e.resposta?.motores?.[m]?.versao_do_worker || "sem canal"})`);
  ok(sinais.length >= 1 && sinais.every((s) => s.apikey === CHAVE), `batida da máquina com a chave do cofre (${sinais.length} batida(s))`);
  ok(sinais.some((s) => s.corpo._maquina === MAQUINA && s.corpo._versao === p.versao), "a batida leva o id da máquina e a versão");
  const j = arvoreEJanelas();
  ok(j.nomes.indexOf("conhost.exe") >= 0 && j.nomes.filter((n) => n === "node.exe").length >= 2, `árvore: ${j.nomes.join(", ")}`);
  ok(j.comJanela.length === 0, `nenhuma janela visível na árvore${j.comJanela.length ? ` (com janela: ${j.comJanela.join(", ")})` : ""}`);
  if (provas) writeFileSync(path.join(provas, "arvore-e-janelas.json"), JSON.stringify({ ...j, sinais: sinais.length, outros: Array.from(new Set(outros)) }, null, 2));

  console.log("\n6) O mesmo código de novo");
  const r2 = await rodarCmd(arqCerto);
  ok(r2.codigo !== 0 && /inválido, vencido ou já usado/.test(r2.saida), `o instalador recusa o código já usado (código ${r2.codigo})`);
  ok(comando("estado").ok, "o supervisor que já roda não foi afetado");

  console.log("\n7) Remover máquina no painel");
  revogar = true;
  let parou = false;
  for (let i = 0; i < 70 && !parou; i++) {
    await dormir(1000);
    parou = !comando("estado").ok;
  }
  ok(parou, "o supervisor parou ao receber revogada");
  ok(!existsSync(cofre), "o cofre local foi apagado");
  const maq2 = JSON.parse(readFileSync(path.join(raiz, "maquina.json"), "utf8")) as { revogada?: boolean };
  ok(maq2.revogada === true, "maquina.json marcada como removida (não liga mais)");

  const regs = todosOsRegistros();
  ok(regs.length > 0 && regs.indexOf(CHAVE) < 0, "nenhuma chave nos registros");
  if (provas) {
    for (const a of readdirSync(path.join(raiz, "logs"))) copyFileSync(path.join(raiz, "logs", a), path.join(provas, `log-${a}`));
  }

  console.log("\n8) Desinstalar");
  const d = await rodarCmd(arqCerto, { ACELERIQ_MODO: "desinstalar" });
  ok(d.codigo === 0 && !existsSync(atalho), "desinstalar tira o atalho");
} finally {
  comando("sair-agora");
  servidor.close();
}

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
