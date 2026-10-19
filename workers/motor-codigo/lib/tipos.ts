/**
 * Conferência de tipos na compilação (Gravyx, 19/10/2026: "conferindo os
 * tipos"). Quando o projeto é TypeScript (tsconfig.json na raiz), o motor
 * roda `tsc --noEmit` com o TypeScript do PRÓPRIO worker (o package.json do
 * site não muda: projetos antigos não ganham instalação nova) e traduz o erro
 * para a equipe. O Vite compila mesmo com erro de tipo, então o erro é aviso
 * na conferência, não trava o build.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ambienteSemSegredos } from "./config-opencode.ts";
import { rodar } from "./processos.ts";

export type ErroDeTipo = { arquivo: string; linha: number; codigo: string; mensagem: string; simples: string };
export type ConferenciaDeTipos = { rodou: boolean; ok: boolean; erros: ErroDeTipo[]; total: number; motivo: string | null };

/** Uma linha do tsc: `src/secoes/Hero.tsx(12,5): error TS2339: Property 'x' does not exist on type 'Y'.` */
const LINHA_DO_TSC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

const aspas = (m: string) => {
  const achados: string[] = [];
  const re = /'([^']{1,80})'/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(m))) achados.push(x[1]);
  return achados;
};

/** O erro do tsc em palavras da equipe (o código fica para quem for consertar). */
export function erroEmPalavras(codigo: string, mensagem: string): string {
  const a = aspas(mensagem);
  switch (codigo) {
    case "TS2339":
    case "TS2551":
      return `o código usa "${a[0] || "um campo"}", que não existe ${a[1] ? `em ${a[1]}` : "aqui"}`;
    case "TS2304":
    case "TS2552":
      return `o código usa "${a[0] || "um nome"}", que não foi declarado nem importado`;
    case "TS2307":
      return `o arquivo importa "${a[0] || "um módulo"}", que não foi achado`;
    case "TS2322":
    case "TS2345":
      return "um valor não combina com o tipo que o código espera";
    case "TS2741":
    case "TS2739":
      return `falta ${a[0] ? `"${a[0]}"` : "uma informação obrigatória"} num componente ou objeto`;
    case "TS2554":
      return "uma função foi chamada com a quantidade errada de argumentos";
    case "TS2305":
    case "TS2614":
      return `"${a[1] || a[0] || "algo"}" não é exportado ${a[0] && a[1] ? `por ${a[0]}` : "pelo arquivo importado"}`;
    case "TS7006":
    case "TS7031":
      return `o parâmetro "${a[0] || ""}" ficou sem tipo`;
    case "TS2531":
    case "TS2532":
    case "TS18047":
    case "TS18048":
      return "o código pode ler algo que ainda está vazio (nulo)";
    case "TS1005":
    case "TS1128":
    case "TS1109":
    case "TS17002":
      return "erro de escrita no código (sintaxe)";
    default:
      return `erro de tipo (${codigo})`;
  }
}

/** Lê a saída do tsc: os erros com arquivo, linha e a frase simples. */
export function errosDoTsc(saida: string): ErroDeTipo[] {
  const erros: ErroDeTipo[] = [];
  for (const bruta of String(saida || "").replace(/\u001b\[[0-9;]*m/g, "").split("\n")) {
    const l = bruta.trim();
    const m = LINHA_DO_TSC.exec(l);
    if (!m) continue;
    const arquivo = m[1].split("\\").join("/");
    erros.push({ arquivo, linha: Number(m[2]) || 0, codigo: m[4], mensagem: m[5].slice(0, 300), simples: erroEmPalavras(m[4], m[5]) });
  }
  return erros;
}

/** Uma linha para o evento e para o aviso da tela. */
export function resumoDosTipos(c: ConferenciaDeTipos): string {
  if (!c.rodou) return `Conferência de tipos não rodou${c.motivo ? `: ${c.motivo}` : ""}`;
  if (c.ok) return "Tipos conferidos: nenhum erro";
  const e = c.erros[0];
  const mais = c.total > 1 ? ` (e mais ${c.total - 1})` : "";
  return `Tipos: ${c.total} ${c.total === 1 ? "erro" : "erros"}. Em ${e.arquivo} linha ${e.linha}: ${e.simples}${mais}`.slice(0, 280);
}

/** O tsc do worker (dependência do worker, não do site). null = não instalado. */
export function caminhoDoTsc(): string | null {
  try {
    const req = createRequire(import.meta.url);
    return req.resolve("typescript/bin/tsc");
  } catch {
    return null;
  }
}

/** Roda a conferência de tipos no projeto (só quando há tsconfig.json). */
export async function conferirTipos(pasta: string, tsc: string | null = caminhoDoTsc()): Promise<ConferenciaDeTipos> {
  if (!existsSync(join(pasta, "tsconfig.json"))) return { rodou: false, ok: true, erros: [], total: 0, motivo: "o projeto não é TypeScript" };
  if (!tsc) return { rodou: false, ok: true, erros: [], total: 0, motivo: "o TypeScript não está instalado no worker (npm install em workers/motor-codigo)" };
  // Roda o código do projeto? Não: o tsc só lê. Mesmo assim, sem os segredos do worker.
  const r = await rodar(process.execPath, [tsc, "--noEmit", "-p", "tsconfig.json", "--pretty", "false"], { cwd: pasta, prazoMs: 3 * 60_000, env: ambienteSemSegredos() });
  if (r.estourou) return { rodou: false, ok: true, erros: [], total: 0, motivo: "passou do prazo de 3 minutos" };
  const erros = errosDoTsc(`${r.saida}\n${r.erro}`);
  if (r.codigo === 0) return { rodou: true, ok: true, erros: [], total: 0, motivo: null };
  if (!erros.length) return { rodou: false, ok: true, erros: [], total: 0, motivo: `o tsc saiu com ${r.codigo}: ${(r.erro || r.saida).trim().slice(0, 160)}` };
  return { rodou: true, ok: false, erros: erros.slice(0, 20), total: erros.length, motivo: null };
}
