/**
 * Frente SUP: nenhuma janela (só roda no Windows).
 * Sobe um worker falso pelo Filho (que abre um neto cmd + ping SEM windowsHide,
 * como um pacote de terceiro faria) e o ícone da bandeja, e confere com a API
 * do Windows (EnumWindows) que nenhum processo da árvore tem janela visível.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Filho } from "../filhos.ts";
import { abrirBandeja } from "../bandeja.ts";
import { criarWorkerFalso, dormir, esperarAte, eventos, pastaTemp, registroEmMemoria } from "./apoio.ts";

const noWindows = process.platform === "win32";
// Nenhum teste abre navegador: a bandeja aqui tem ação vazia e a abertura fica desligada.
process.env.ACELERIQ_SEM_NAVEGADOR = "1";

/** PIDs com janela visível de nível superior, e a árvore de processos a partir de um PID. */
const SCRIPT = `
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class JanelasAceleriq {
  public delegate bool F(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(F f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static List<uint> Visiveis() { var r = new List<uint>(); EnumWindows((h, l) => { if (IsWindowVisible(h)) { uint p; GetWindowThreadProcessId(h, out p); r.Add(p); } return true; }, IntPtr.Zero); return r; }
}
"@
$todos = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
$arvore = New-Object System.Collections.Generic.HashSet[uint32]
[void]$arvore.Add([uint32]$env:RAIZ_PID)
do { $n = $arvore.Count; foreach ($p in $todos) { if ($arvore.Contains([uint32]$p.ParentProcessId)) { [void]$arvore.Add([uint32]$p.ProcessId) } } } while ($arvore.Count -ne $n)
$vis = [JanelasAceleriq]::Visiveis()
$nomes = @($todos | Where-Object { $arvore.Contains([uint32]$_.ProcessId) } | ForEach-Object { $_.Name })
$com = @($vis | Where-Object { $arvore.Contains($_) })
@{ arvore = $nomes; comJanela = $com } | ConvertTo-Json -Compress
`;

function conferir(raizPid: number): { arvore: string[]; comJanela: number[] } {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], { env: { ...process.env, RAIZ_PID: String(raizPid) }, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout.trim()) as { arvore: string[] | string; comJanela: number[] | number | null };
  return { arvore: ([] as string[]).concat(j.arvore || []), comJanela: ([] as number[]).concat(j.comJanela ?? []) };
}

describe("sem janela", { skip: !noWindows && "só no Windows" }, () => {
  it("worker, neto de terceiro e ícone da bandeja não abrem janela", async () => {
    const raiz = pastaTemp();
    const dir = criarWorkerFalso(raiz, "render", "principal.ts", { modo: "normal", neto: true });
    const registro = registroEmMemoria();
    const f = new Filho({ id: "render", pasta: () => dir, args: ["principal.ts"], ambiente: () => ({ ...process.env }), registro, prazoOcioso: 2_000 });
    f.ligar();
    await esperarAte(() => eventos(dir).some((e) => e.texto.startsWith("neto")), 10_000);
    const bandeja = abrirBandeja(() => {}, registro);
    bandeja.mostrar({ cor: "verde", titulo: "Aceleriq Motores", dica: "Teste sem janela", pausado: false, painel: "https://aceleriq.online", motores: [] });
    await dormir(2_500);
    const r = conferir(process.pid);
    assert.ok(r.arvore.indexOf("PING.EXE") >= 0 || r.arvore.indexOf("cmd.exe") >= 0, `o neto devia estar na árvore: ${r.arvore.join(", ")}`);
    assert.ok(r.arvore.indexOf("powershell.exe") >= 0, "o ícone da bandeja devia estar na árvore");
    assert.deepEqual(r.comJanela, [], `processos com janela visível: ${r.comJanela.join(", ")} (árvore: ${r.arvore.join(", ")})`);
    bandeja.fechar();
    await f.desligar({ forcar: true });
    // O neto (ping) sai junto com a árvore encerrada.
    await dormir(300);
  });
});
