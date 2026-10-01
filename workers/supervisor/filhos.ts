/**
 * Um worker como filho do Aceleriq Motores (frente SUP, 01/10/2026).
 *
 * - Sobe SEM janela (windowsHide, saída por cano, canal IPC) e com
 *   ACELERIQ_SUPERVISOR=1: o worker avisa "ocupado"/"ocioso" e atende "parar".
 * - Caiu sem ninguém pedir: sobe de novo com espera crescente (2 s, 4 s, 8 s...
 *   até 5 min). Ficou de pé mais que `estavel`, a contagem zera.
 * - Parada limpa: manda "parar" e espera o worker terminar o que faz. Nunca
 *   mata um worker ocupado (um "construir" do motor de código, um render).
 *   Ocioso que não sai no prazo é encerrado com a árvore de processos.
 * - Toda a saída vai para o registro do motor, sem chave (registros.ts).
 */

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { emLinhas, type Registro } from "./registros.ts";

export type SituacaoDoFilho = "desligado" | "subindo" | "ligado" | "ocupado" | "parando" | "esperando";

export interface Espera {
  /** Primeira espera depois de uma queda (ms). */
  base: number;
  /** Maior espera (ms). */
  teto: number;
  /** De pé por mais que isso, a próxima queda volta para a espera base (ms). */
  estavel: number;
}

export const ESPERA_PADRAO: Espera = { base: 2_000, teto: 300_000, estavel: 120_000 };

/** Espera antes de subir de novo, pela quantidade de quedas seguidas (1 = primeira). */
export function esperaDoReinicio(quedasSeguidas: number, e: Pick<Espera, "base" | "teto"> = ESPERA_PADRAO): number {
  const n = Math.max(1, Math.floor(quedasSeguidas));
  return Math.min(e.teto, e.base * Math.pow(2, Math.min(n - 1, 20)));
}

export type Lancar = (comando: string, args: string[], opcoes: SpawnOptions) => ChildProcess;

export interface OpcoesDoFilho {
  id: string;
  /** Pasta do worker (cwd). */
  pasta: () => string;
  /** Argumentos do node: opções e o arquivo de entrada. */
  args: string[];
  /** Ambiente de cada subida (lido na hora: chaves novas do cofre valem na próxima subida). */
  ambiente: () => NodeJS.ProcessEnv;
  registro: Registro;
  espera?: Espera;
  /** Prazo para um worker OCIOSO sair depois do "parar" antes de ser encerrado (ms). */
  prazoOcioso?: number;
  lancar?: Lancar;
  /** Executável do node (padrão: o mesmo do supervisor). */
  node?: string;
  aoMudar?: (f: Filho) => void;
  /** Encerra a árvore de processos (padrão: taskkill /T /F no Windows). */
  matarArvore?: (pid: number) => void;
}

export function matarArvorePadrao(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {});
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    /* já saiu */
  }
}

/** As opções de subida de um worker: sem janela, saída por cano e canal IPC. */
export function opcoesDeSubida(pasta: string, env: NodeJS.ProcessEnv): SpawnOptions {
  return {
    cwd: pasta,
    env: { ...env, ACELERIQ_SUPERVISOR: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  };
}

export class Filho {
  readonly id: string;
  situacao: SituacaoDoFilho = "desligado";
  ocupadoCom: string | null = null;
  /** O worker se apresentou pelo canal (sabe avisar "ocupado" e atender "parar"). */
  comCanal = false;
  versaoDoWorker: string | null = null;
  reinicios = 0;
  quedasSeguidas = 0;
  ultimoErro: string | null = null;
  pid: number | null = null;
  subiuEm = 0;
  /** Quedas desde `marcarProva()` (a prova de uma versão nova). */
  quedasNaProva = 0;
  /** As últimas esperas marcadas antes de subir de novo (ms), para o painel e os testes. */
  esperas: number[] = [];
  private proc: ChildProcess | null = null;
  private relogio: ReturnType<typeof setTimeout> | null = null;
  private querLigado = false;
  private saida: Promise<void> | null = null;
  private resolverSaida: (() => void) | null = null;
  private ultimaLinhaDeErro: string | null = null;
  private readonly o: OpcoesDoFilho;
  private readonly espera: Espera;

  constructor(o: OpcoesDoFilho) {
    this.o = o;
    this.id = o.id;
    this.espera = o.espera || ESPERA_PADRAO;
  }

  get ligadoOuSubindo(): boolean {
    return this.proc !== null || this.relogio !== null;
  }

  get ocupado(): boolean {
    return this.ocupadoCom !== null || this.situacao === "ocupado";
  }

  private mudar(s: SituacaoDoFilho) {
    this.situacao = s;
    this.o.aoMudar?.(this);
  }

  marcarProva(): void {
    this.quedasNaProva = 0;
  }

  /** Liga (ou mantém ligado). Idempotente. */
  ligar(): void {
    this.querLigado = true;
    if (this.proc || this.relogio) return;
    this.subir();
  }

  private subir(): void {
    this.relogio = null;
    if (!this.querLigado) return;
    const lancar: Lancar = this.o.lancar || spawn;
    const opcoes = opcoesDeSubida(this.o.pasta(), this.o.ambiente());
    this.ultimaLinhaDeErro = null;
    this.comCanal = false;
    this.ocupadoCom = null;
    this.mudar("subindo");
    let p: ChildProcess;
    try {
      p = lancar(this.o.node || process.execPath, this.o.args, opcoes);
    } catch (e) {
      this.ultimoErro = `não subiu: ${e instanceof Error ? e.message : String(e)}`;
      this.o.registro.linha(`[supervisor] ${this.ultimoErro}`);
      this.depoisDaQueda();
      return;
    }
    this.proc = p;
    this.pid = p.pid ?? null;
    this.subiuEm = Date.now();
    this.saida = new Promise<void>((r) => (this.resolverSaida = r));
    this.o.registro.linha(`[supervisor] ${this.id} subiu (pid ${this.pid ?? "?"})`);
    const out = emLinhas((l) => this.o.registro.linha(l));
    const err = emLinhas((l) => {
      this.o.registro.linha(`[erro] ${l}`);
      if (l.trim()) this.ultimaLinhaDeErro = l.trim().slice(0, 300);
    });
    p.stdout?.on("data", (d) => out.escrever(d));
    p.stderr?.on("data", (d) => err.escrever(d));
    p.on("message", (m: unknown) => this.aoReceber(m));
    p.on("error", (e) => {
      this.ultimoErro = `falha ao subir: ${e.message}`;
      this.o.registro.linha(`[supervisor] ${this.ultimoErro}`);
    });
    p.on("exit", (codigo, sinal) => {
      out.fechar();
      err.fechar();
      this.aoSair(codigo, sinal);
    });
    this.mudar("ligado");
  }

  private aoReceber(m: unknown): void {
    if (!m || typeof m !== "object") return;
    const msg = m as { tipo?: string; id?: unknown; versao?: unknown };
    if (msg.tipo === "pronto") {
      this.comCanal = true;
      this.versaoDoWorker = typeof msg.versao === "string" ? msg.versao.slice(0, 60) : null;
      this.o.aoMudar?.(this);
    } else if (msg.tipo === "ocupado") {
      this.comCanal = true;
      this.ocupadoCom = typeof msg.id === "string" ? msg.id.slice(0, 80) : "trabalho";
      if (this.situacao !== "parando") this.mudar("ocupado");
      else this.o.aoMudar?.(this);
    } else if (msg.tipo === "ocioso") {
      this.ocupadoCom = null;
      if (this.situacao !== "parando") this.mudar("ligado");
      else this.o.aoMudar?.(this);
    }
  }

  private aoSair(codigo: number | null, sinal: NodeJS.Signals | null): void {
    const durou = Date.now() - this.subiuEm;
    this.proc = null;
    this.pid = null;
    this.ocupadoCom = null;
    this.o.registro.linha(`[supervisor] ${this.id} saiu (código ${codigo ?? "-"}${sinal ? `, sinal ${sinal}` : ""}, ${Math.round(durou / 1000)} s de pé)`);
    const r = this.resolverSaida;
    this.resolverSaida = null;
    this.saida = null;
    if (this.querLigado) {
      this.ultimoErro = this.ultimaLinhaDeErro || `saiu com código ${codigo ?? sinal ?? "?"}`;
      if (durou >= this.espera.estavel) this.quedasSeguidas = 0;
      this.depoisDaQueda();
    } else {
      this.mudar("desligado");
    }
    r?.();
  }

  private depoisDaQueda(): void {
    this.quedasSeguidas++;
    this.quedasNaProva++;
    this.reinicios++;
    const ms = esperaDoReinicio(this.quedasSeguidas, this.espera);
    this.esperas = [...this.esperas, ms].slice(-10);
    this.o.registro.linha(`[supervisor] ${this.id} caiu (${this.quedasSeguidas}ª seguida); sobe de novo em ${Math.round(ms / 1000)} s`);
    this.relogio = setTimeout(() => this.subir(), ms);
    this.mudar("esperando");
  }

  /**
   * Parada limpa. Manda "parar" e espera sair. Ocupado: espera o trabalho
   * acabar, sem prazo (a não ser `forcar`). Ocioso que não sai no prazo:
   * encerra a árvore. Resolve quando o processo saiu.
   */
  async desligar(opcoes: { forcar?: boolean } = {}): Promise<void> {
    this.querLigado = false;
    if (this.relogio) {
      clearTimeout(this.relogio);
      this.relogio = null;
    }
    const p = this.proc;
    if (!p) {
      this.mudar("desligado");
      return;
    }
    const saida = this.saida;
    this.mudar("parando");
    this.o.registro.linha(`[supervisor] pedindo parada limpa a ${this.id}${this.ocupadoCom ? ` (ocupado com ${this.ocupadoCom}: espero terminar)` : ""}`);
    try {
      if (p.connected) p.send({ tipo: "parar" });
    } catch {
      /* canal fechado */
    }
    if (opcoes.forcar) {
      this.matar("pedido de saída forçada");
      await saida;
      return;
    }
    const prazo = this.o.prazoOcioso ?? 60_000;
    let ociosoDesde = this.ocupado ? 0 : Date.now();
    const vigia = setInterval(() => {
      if (!this.proc) return;
      if (this.ocupado) {
        ociosoDesde = 0;
        return;
      }
      if (!ociosoDesde) ociosoDesde = Date.now();
      if (Date.now() - ociosoDesde >= prazo) this.matar(`ocioso e não saiu em ${Math.round(prazo / 1000)} s`);
    }, Math.min(1000, Math.max(50, Math.floor(prazo / 4))));
    try {
      await saida;
    } finally {
      clearInterval(vigia);
    }
  }

  private matar(motivo: string): void {
    const pid = this.proc?.pid;
    if (!pid) return;
    this.o.registro.linha(`[supervisor] encerrando ${this.id} (pid ${pid}): ${motivo}`);
    (this.o.matarArvore || matarArvorePadrao)(pid);
  }

  /** Desliga com calma e liga de novo (Reiniciar do menu, chaves novas, versão nova). */
  async reiniciar(): Promise<void> {
    await this.desligar();
    this.quedasSeguidas = 0;
    this.ligar();
  }

  resumo() {
    return {
      situacao: this.situacao,
      ocupado: this.ocupado,
      trabalho: this.ocupadoCom,
      reinicios: this.reinicios,
      quedas_seguidas: this.quedasSeguidas,
      ultimo_erro: this.ultimoErro,
      pid: this.pid,
      versao_do_worker: this.versaoDoWorker,
      desde: this.subiuEm ? new Date(this.subiuEm).toISOString() : null,
    };
  }
}
