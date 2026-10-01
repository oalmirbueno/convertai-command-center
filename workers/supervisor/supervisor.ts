/**
 * Aceleriq Motores: o supervisor (frente SUP, 01/10/2026).
 *
 * Pedido do dono: "sempre que eu abrir o painel, dê para instalar as
 * dependências em qualquer computador... e este tem que abrir junto, mas sem
 * ficar com os terminais abertos. Algo mais bonito e invisível, mas funcionando."
 *
 * Um processo Node que:
 * - sobe os workers desta máquina (render, motor de código, navegador) como
 *   filhos sem janela e sobe de novo quem cair, com espera crescente;
 * - lê a chave de serviço do cofre DPAPI (cofre.dat) e as chaves dos provedores
 *   do cofre do painel (chaves_do_cofre), caindo nas locais quando faltar;
 * - bate ponto da máquina (motores_maquina_sinal) a cada 30 s: o painel mostra
 *   máquina, motores, versão e último sinal; de volta vêm os motores desta
 *   máquina, a remoção e a versão publicada;
 * - atualiza sozinho só com todos os motores ociosos e volta se a nova falhar;
 * - mostra o ícone na bandeja (verde, amarelo, vermelho) com o menu.
 *
 * Toda dependência entra pelo construtor (os testes trocam banco, cofre,
 * bandeja, relógio e o lançador de processos).
 */

import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import type { Banco } from "./banco.ts";
import type { AcaoDaBandeja, Bandeja, CorDaBandeja, EstadoDaBandeja } from "./bandeja.ts";
import { Atualizador, CODIGO_DE_TROCA, confirmarVersao, trocarPara, voltarVersao } from "./atualizar.ts";
import { type Caminhos, type ConfigDaMaquina, ENTRADA_DO_MOTOR, gravarJson, type IdDoMotor, lerAtual, MOTORES, NOME_DO_MOTOR } from "./config.ts";
import type { ComandoDeControle } from "./controle.ts";
import { type Espera, Filho, type Lancar } from "./filhos.ts";
import { limparAntigas, prepararDependencias, type Rodar } from "./pacote.ts";
import { esquecerSegredos, registrarSegredo, type Registro } from "./registros.ts";
import type { Cofre } from "./segredos.ts";

/** Chaves de provedor que os workers usam (o resto do cofre do painel não desce para a máquina). */
export const CHAVES_DOS_WORKERS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "VERCEL_TOKEN"];
export const VERSAO_DO_SUPERVISOR = "sup-1.0";
/** No máximo uma abertura de navegador ou pasta a cada 10 s, e só por clique no menu. */
export const FREIO_DE_ABERTURA_MS = 10_000;

export interface OpcoesDoSupervisor {
  c: Caminhos;
  maquina: ConfigDaMaquina;
  /** Versão em uso (null: rodando de um clone, sem atualização sozinha). */
  versao: string | null;
  /** Raiz do código em uso (contém workers/). */
  raizDoCodigo: string;
  cofre: Cofre;
  criarBanco: (url: string, chave: () => string) => Banco;
  criarBandeja: (aoAgir: (a: AcaoDaBandeja) => void) => Bandeja;
  registro: Registro;
  registroDe: (motor: IdDoMotor) => Registro;
  sair: (codigo: number) => void;
  abrir: (alvo: string) => void;
  ambiente?: NodeJS.ProcessEnv;
  lancar?: Lancar;
  rodar?: Rodar;
  espera?: Espera;
  prazoOcioso?: number;
  intervaloDoSinal?: number;
  intervaloDasChaves?: number;
  /** Janela da prova de uma versão nova: dentro dela, 3 quedas de um motor = volta de versão (ms). */
  janelaDaProva?: number;
  semNpm?: boolean;
  hostname?: string;
}

export type SituacaoNaMaquina = "ligado" | "trabalhando" | "subindo" | "reiniciando" | "parando" | "falhando" | "pausado" | "fora" | "parado";

export class Supervisor {
  readonly filhos = new Map<IdDoMotor, Filho>();
  readonly atualizador: Atualizador;
  maquina: ConfigDaMaquina;
  segredosLocais: Record<string, string> = {};
  chavesDoPainel: Record<string, string> = {};
  chavesDoPainelOk: boolean | null = null;
  ultimoSinalOk = 0;
  ultimoErroDoSinal: string | null = null;
  saindo = false;
  private banco: Banco | null = null;
  private bandeja: Bandeja | null = null;
  private relogios: Array<ReturnType<typeof setInterval>> = [];
  private provaAte = 0;
  private trocando = false;
  private avisoPendente: ReturnType<typeof setTimeout> | null = null;
  private readonly o: OpcoesDoSupervisor;
  private readonly hostname: string;

  constructor(o: OpcoesDoSupervisor) {
    this.o = o;
    this.maquina = { ...o.maquina };
    this.hostname = (o.hostname || os.hostname()).slice(0, 80);
    this.atualizador = new Atualizador({ c: o.c, registro: o.registro, rodar: o.rodar, semNpm: o.semNpm });
    for (const m of MOTORES) {
      const e = ENTRADA_DO_MOTOR[m];
      this.filhos.set(
        m,
        new Filho({
          id: m,
          pasta: () => path.join(this.o.raizDoCodigo, "workers", e.pasta),
          args: [...e.args, e.arquivo],
          ambiente: () => this.ambienteDoWorker(),
          registro: o.registroDe(m),
          espera: o.espera,
          prazoOcioso: o.prazoOcioso,
          lancar: o.lancar,
          aoMudar: () => this.mudou(),
        }),
      );
    }
  }

  get chaveDeServico(): string {
    return this.segredosLocais.SUPABASE_SERVICE_ROLE_KEY || String(this.o.ambiente?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  }

  /** Nome de cada worker no banco (o mesmo que o worker usa sozinho). */
  executores(): Record<IdDoMotor, string> {
    const env = this.o.ambiente || process.env;
    return {
      render: String(env.RENDER_WORKER_NOME || `${this.hostname}-render`).slice(0, 80),
      codigo: String(env.MOTOR_EXECUTOR || `agencia-${this.hostname}`).slice(0, 80),
      navegador: String(env.COMPUTADOR_EXECUTOR || `${this.hostname}-navegador`).slice(0, 80),
    };
  }

  /**
   * Ambiente de cada worker: o do supervisor, mais as chaves dos provedores
   * (cofre do painel primeiro; sem ela, a local guardada no DPAPI; sem ela, a do
   * ambiente), a chave de serviço e o endereço do projeto. Só na memória do filho.
   */
  ambienteDoWorker(): NodeJS.ProcessEnv {
    const base = { ...(this.o.ambiente || process.env) };
    for (const n of CHAVES_DOS_WORKERS) {
      const v = this.chavesDoPainel[n] || this.segredosLocais[n] || String(base[n] || "").trim();
      if (v) base[n] = v;
      else delete base[n];
    }
    for (const n of Object.keys(this.segredosLocais)) if (CHAVES_DOS_WORKERS.indexOf(n) < 0 && n !== "SUPABASE_SERVICE_ROLE_KEY") base[n] = base[n] || this.segredosLocais[n];
    base.SUPABASE_URL = this.maquina.supabase_url;
    if (this.chaveDeServico) base.SUPABASE_SERVICE_ROLE_KEY = this.chaveDeServico;
    base.ACELERIQ_MOTORES_VERSAO = this.o.versao || "clone";
    return base;
  }

  async iniciar(): Promise<void> {
    const r = this.o.registro;
    r.linha(`[supervisor] Aceleriq Motores ${VERSAO_DO_SUPERVISOR} · versão dos workers ${this.o.versao || "do clone"} · máquina ${this.maquina.nome} (${this.hostname}) · motores: ${this.maquina.motores.join(", ") || "nenhum"}`);
    this.bandeja = this.o.criarBandeja((a) => void this.acaoDaBandeja(a));
    try {
      this.segredosLocais = await this.o.cofre.ler();
    } catch (e) {
      r.linha(`[supervisor] não consegui abrir o cofre desta máquina: ${e instanceof Error ? e.message : String(e)}`);
      this.segredosLocais = {};
    }
    for (const v of Object.values(this.segredosLocais)) registrarSegredo(v);
    registrarSegredo(this.o.ambiente?.SUPABASE_SERVICE_ROLE_KEY);
    if (!this.chaveDeServico) {
      r.linha("[supervisor] falta a chave de serviço nesta máquina: pareie de novo pelo painel (Configurações › Estado dos motores).");
      this.mudou();
      return;
    }
    this.banco = this.o.criarBanco(this.maquina.supabase_url, () => this.chaveDeServico);
    const atual = lerAtual(this.o.c);
    if (atual.em_teste && atual.versao === this.o.versao) {
      this.provaAte = Date.now() + (this.o.janelaDaProva ?? 180_000);
      r.linha(`[atualização] versão ${atual.versao} em prova até ${new Date(this.provaAte).toLocaleTimeString("pt-BR")}`);
    }
    await this.carregarChaves();
    if (this.maquina.revogada) {
      r.linha("[supervisor] esta máquina foi removida no painel: nada é ligado aqui.");
      this.mudou();
      return;
    }
    if (!this.maquina.pausado) this.ligarPermitidos();
    this.mudou();
    await this.sinal();
    const sinal = this.o.intervaloDoSinal ?? 30_000;
    this.relogios.push(setInterval(() => void this.sinal(), sinal));
    this.relogios.push(setInterval(() => void this.carregarChaves(true), this.o.intervaloDasChaves ?? 10 * 60_000));
    this.relogios.push(setInterval(() => void this.vigiar(), Math.min(5_000, sinal)));
  }

  private ligarPermitidos(): void {
    for (const m of MOTORES) {
      const f = this.filhos.get(m)!;
      if (this.maquina.motores.indexOf(m) >= 0) {
        if (!f.ligadoOuSubindo) {
          if (this.provaAte) f.marcarProva();
          void this.garantirDependencias(m).then((ok) => {
            if (ok && !this.saindo && !this.maquina.pausado && this.maquina.motores.indexOf(m) >= 0) f.ligar();
          });
        }
      } else if (f.ligadoOuSubindo) {
        void f.desligar();
      }
    }
  }

  /** Motor recém-permitido numa versão já instalada: instala as dependências dele antes de subir. */
  private async garantirDependencias(m: IdDoMotor): Promise<boolean> {
    if (!this.o.versao) return true;
    const pasta = path.join(this.o.raizDoCodigo, "workers", ENTRADA_DO_MOTOR[m].pasta, "node_modules");
    if (existsSync(pasta)) return true;
    try {
      await prepararDependencias(this.o.raizDoCodigo, this.o.c.deps, m, { registro: this.o.registro, rodar: this.o.rodar, semNpm: this.o.semNpm });
      return true;
    } catch (e) {
      const f = this.filhos.get(m)!;
      f.ultimoErro = `dependências: ${e instanceof Error ? e.message : String(e)}`;
      this.o.registro.linha(`[supervisor] ${m} sem dependências: ${f.ultimoErro}`);
      this.mudou();
      return false;
    }
  }

  async carregarChaves(atualizar = false): Promise<void> {
    if (!this.banco) return;
    const antes = JSON.stringify(this.chavesDoPainel);
    try {
      this.chavesDoPainel = await this.banco.chaves(CHAVES_DOS_WORKERS);
      this.chavesDoPainelOk = true;
      for (const v of Object.values(this.chavesDoPainel)) registrarSegredo(v);
    } catch (e) {
      // Sem o cofre do painel, segue com as locais (nunca derruba os motores).
      this.chavesDoPainelOk = false;
      this.o.registro.linha(`[supervisor] cofre do painel indisponível; sigo com as chaves locais (${e instanceof Error ? e.message.slice(0, 120) : "erro"})`);
      return;
    }
    if (atualizar && antes !== JSON.stringify(this.chavesDoPainel)) {
      this.o.registro.linha("[supervisor] as chaves do painel mudaram: cada motor reinicia quando estiver ocioso");
      for (const f of this.filhos.values()) if (f.ligadoOuSubindo) void this.reiniciarQuandoOcioso(f);
    }
  }

  private async reiniciarQuandoOcioso(f: Filho): Promise<void> {
    while (f.ocupado && !this.saindo) await new Promise((r) => setTimeout(r, 2000));
    if (!this.saindo && f.ligadoOuSubindo) await f.reiniciar();
  }

  /** Situação de cada motor nesta máquina, em palavras do painel. */
  situacao(m: IdDoMotor): SituacaoNaMaquina {
    const f = this.filhos.get(m)!;
    if (this.maquina.motores.indexOf(m) < 0) return "fora";
    if (this.maquina.pausado) return f.ligadoOuSubindo ? (f.ocupado ? "trabalhando" : "parando") : "pausado";
    if (f.ocupado) return "trabalhando";
    if (f.situacao === "esperando") return f.quedasSeguidas >= 3 ? "falhando" : "reiniciando";
    if (f.situacao === "subindo") return "subindo";
    if (f.situacao === "parando") return "parando";
    if (f.situacao === "ligado") return "ligado";
    return "parado";
  }

  estadoParaOPainel(): Record<string, unknown> {
    const motores: Record<string, unknown> = {};
    for (const m of MOTORES) motores[m] = { ...this.filhos.get(m)!.resumo(), situacao: this.situacao(m) };
    return {
      motores,
      pausado: !!this.maquina.pausado,
      supervisor: VERSAO_DO_SUPERVISOR,
      node: process.version,
      atualizacao: this.atualizador.etapa ? { etapa: this.atualizador.etapa, versao: this.atualizador.alvo?.versao || null, erro: this.atualizador.erro } : null,
      chaves_do_painel: this.chavesDoPainelOk === null ? "sem_leitura" : this.chavesDoPainelOk ? "ok" : "indisponivel",
    };
  }

  /** A cor e a dica do ícone. */
  estadoDaBandeja(): EstadoDaBandeja {
    const nomes = MOTORES.filter((m) => this.maquina.motores.indexOf(m) >= 0);
    const sit = nomes.map((m) => ({ m, s: this.situacao(m) }));
    const texto: Record<SituacaoNaMaquina, string> = {
      ligado: "ligado",
      trabalhando: "trabalhando",
      subindo: "subindo",
      reiniciando: "reiniciando",
      parando: "terminando o trabalho para parar",
      falhando: "caindo ao subir",
      pausado: "pausado",
      fora: "não roda aqui",
      parado: "parado",
    };
    let cor: CorDaBandeja = "verde";
    let dica = `Tudo ligado: ${nomes.length} ${nomes.length === 1 ? "motor" : "motores"}`;
    const trabalhando = sit.filter((x) => x.s === "trabalhando").map((x) => NOME_DO_MOTOR[x.m].split(" (")[0].toLowerCase());
    if (trabalhando.length) dica = `Trabalhando: ${trabalhando.join(", ")}`;
    if (!this.chaveDeServico) {
      cor = "vermelho";
      dica = "Parado: falta parear esta máquina no painel";
    } else if (this.maquina.revogada) {
      cor = "vermelho";
      dica = "Parado: máquina removida no painel";
    } else if (!nomes.length) {
      cor = "cinza";
      dica = "Nenhum motor marcado para esta máquina";
    } else if (sit.some((x) => x.s === "falhando" || x.s === "parado")) {
      cor = "vermelho";
      const ruim = sit.find((x) => x.s === "falhando" || x.s === "parado")!;
      dica = `Parado: ${NOME_DO_MOTOR[ruim.m].split(" (")[0].toLowerCase()} ${texto[ruim.s]}`;
    } else if (this.maquina.pausado) {
      cor = "amarelo";
      dica = "Pausado pelo menu";
    } else if (sit.some((x) => x.s === "reiniciando" || x.s === "subindo" || x.s === "parando")) {
      cor = "amarelo";
      const x = sit.find((y) => y.s === "reiniciando" || y.s === "subindo" || y.s === "parando")!;
      dica = `Atenção: ${NOME_DO_MOTOR[x.m].split(" (")[0].toLowerCase()} ${texto[x.s]}`;
    } else if (this.ultimoErroDoSinal && Date.now() - this.ultimoSinalOk > 120_000) {
      cor = "amarelo";
      dica = "Atenção: sem falar com o painel (internet?)";
    } else if (this.atualizador.etapa === "pronta" || this.trocando) {
      cor = "amarelo";
      dica = "Atualizando quando os motores ficarem livres";
    }
    return {
      cor,
      titulo: `Aceleriq Motores · ${this.maquina.nome}`.slice(0, 60),
      dica,
      pausado: !!this.maquina.pausado,
      painel: this.maquina.painel_url,
      motores: MOTORES.map((m) => ({ nome: NOME_DO_MOTOR[m], texto: texto[this.situacao(m)] })),
    };
  }

  private mudou(): void {
    if (this.avisoPendente) return;
    this.avisoPendente = setTimeout(() => {
      this.avisoPendente = null;
      this.bandeja?.mostrar(this.estadoDaBandeja());
    }, 150);
  }

  async sinal(): Promise<void> {
    if (!this.banco || this.saindo) return;
    try {
      const r = await this.banco.sinal({
        maquina_id: this.maquina.maquina_id,
        nome: this.maquina.nome,
        hostname: this.hostname,
        sistema: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
        versao: this.o.versao,
        estado: this.estadoParaOPainel(),
        executores: this.executores(),
      });
      this.ultimoSinalOk = Date.now();
      this.ultimoErroDoSinal = null;
      let mudouConfig = false;
      if (r.maquina_id && r.maquina_id !== this.maquina.maquina_id) {
        this.maquina.maquina_id = r.maquina_id;
        mudouConfig = true;
      }
      if (r.revogada) {
        await this.revogada();
        return;
      }
      if (r.nome && r.nome !== this.maquina.nome) {
        this.maquina.nome = r.nome;
        mudouConfig = true;
      }
      if (r.motores) {
        const novos = MOTORES.filter((m) => r.motores!.indexOf(m) >= 0);
        if (novos.join(",") !== this.maquina.motores.join(",")) {
          this.o.registro.linha(`[supervisor] o painel mudou os motores desta máquina: ${novos.join(", ") || "nenhum"}`);
          this.maquina.motores = novos;
          mudouConfig = true;
          if (!this.maquina.pausado) this.ligarPermitidos();
        }
      }
      if (mudouConfig) this.gravarMaquina();
      if (this.o.versao && this.atualizador.quer(r.versao_alvo, this.o.versao)) {
        void this.atualizador.preparar(r.versao_alvo!, this.banco, this.maquina.motores).then(() => this.mudou());
        this.mudou();
      }
    } catch (e) {
      this.ultimoErroDoSinal = e instanceof Error ? e.message : String(e);
      this.o.registro.linha(`[supervisor] a batida da máquina falhou: ${this.ultimoErroDoSinal.slice(0, 200)}`);
      this.mudou();
    }
  }

  /** A cada 5 s: prova da versão nova e troca quando todos estiverem ociosos. */
  async vigiar(): Promise<void> {
    if (this.saindo) return;
    if (this.provaAte) {
      const caindo = Array.from(this.filhos.values()).find((f) => this.maquina.motores.indexOf(f.id as IdDoMotor) >= 0 && f.quedasNaProva >= 3);
      if (caindo) {
        this.provaAte = 0;
        voltarVersao(this.o.c, `fez o ${caindo.id} cair ${caindo.quedasNaProva} vezes ao subir (${caindo.ultimoErro || "sem mensagem"})`, this.o.registro);
        this.bandeja?.avisar("Aceleriq Motores", "A versão nova não subiu bem. Voltei para a anterior.");
        await this.encerrar(CODIGO_DE_TROCA, { forcar: true });
        return;
      }
      if (Date.now() >= this.provaAte) {
        this.provaAte = 0;
        const a = confirmarVersao(this.o.c);
        const tirados = limparAntigas(this.o.c.versoes, this.o.c.deps, [a.versao, a.anterior, this.atualizador.alvo?.versao || null]);
        this.o.registro.linha(`[atualização] versão ${a.versao} firmada${tirados.length ? `; limpei ${tirados.join(", ")}` : ""}`);
      }
    }
    if (this.atualizador.etapa === "pronta" && this.atualizador.alvo && !this.trocando) {
      const ocupados = Array.from(this.filhos.values()).filter((f) => f.ocupado);
      if (ocupados.length) return;
      this.trocando = true;
      const nova = this.atualizador.alvo.versao;
      this.o.registro.linha(`[atualização] todos os motores ociosos: trocando para a versão ${nova}`);
      this.mudou();
      // Para com calma (todos ociosos agora; se um pegar trabalho no meio, a parada espera ele terminar).
      await Promise.all(Array.from(this.filhos.values()).map((f) => f.desligar()));
      trocarPara(this.o.c, nova);
      await this.encerrar(CODIGO_DE_TROCA);
    }
  }

  private async revogada(): Promise<void> {
    this.o.registro.linha("[supervisor] esta máquina foi removida no painel: paro os motores (com calma) e apago o cofre local.");
    this.maquina.revogada = true;
    this.gravarMaquina();
    this.mudou();
    this.bandeja?.avisar("Aceleriq Motores", "Esta máquina foi removida no painel. Os motores foram desligados.");
    await Promise.all(Array.from(this.filhos.values()).map((f) => f.desligar()));
    try {
      await this.o.cofre.apagar();
    } catch {
      /* segue */
    }
    this.segredosLocais = {};
    esquecerSegredos();
    await this.encerrar(0);
  }

  private gravarMaquina(): void {
    try {
      gravarJson(this.o.c.maquina, this.maquina);
    } catch (e) {
      this.o.registro.linha(`[supervisor] não gravei maquina.json: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Abre endereço ou pasta no programa padrão, SÓ por clique do dono no menu da
   * bandeja, e no máximo uma vez a cada 10 s (dois cliques seguidos, ou um ícone
   * que reabre, nunca viram uma fila de abas). Nunca no início, nunca pelo
   * controle local, nunca em laço.
   */
  private ultimaAbertura = -Infinity;
  abrirComFreio(alvo: string): boolean {
    const agora = Date.now();
    if (agora - this.ultimaAbertura < FREIO_DE_ABERTURA_MS) {
      this.o.registro.linha(`[supervisor] abertura ignorada (outra há menos de ${FREIO_DE_ABERTURA_MS / 1000} s): ${alvo.replace(/[?#].*$/, "")}`);
      return false;
    }
    this.ultimaAbertura = agora;
    this.o.abrir(alvo);
    return true;
  }

  /** Clique no menu da bandeja (a única origem de "abrir"). */
  async acaoDaBandeja(a: AcaoDaBandeja): Promise<void> {
    this.o.registro.linha(`[supervisor] menu da bandeja: ${a}`);
    if (a === "abrir") this.abrirComFreio(this.maquina.painel_url);
    else if (a === "ver-estado") this.abrirComFreio(`${this.maquina.painel_url.replace(/\/+$/, "")}/config?motores=1`);
    else if (a === "registros") this.abrirComFreio(this.o.c.logs);
    else await this.comando(a);
  }

  /**
   * Comando do controle local (instalador, testes, `lancador --comando`) e as
   * ações do menu que não abrem nada. "estado" só LÊ: nunca abre navegador.
   */
  async comando(c: ComandoDeControle): Promise<unknown> {
    if (c !== "estado") this.o.registro.linha(`[supervisor] pedido: ${c}`);
    if (c === "reiniciar") {
      this.maquina.pausado = false;
      this.gravarMaquina();
      await Promise.all(Array.from(this.filhos.values()).filter((f) => f.ligadoOuSubindo).map((f) => f.desligar()));
      for (const f of this.filhos.values()) f.quedasSeguidas = 0;
      this.ligarPermitidos();
      void this.sinal();
    } else if (c === "pausar") {
      this.maquina.pausado = true;
      this.gravarMaquina();
      this.mudou();
      await Promise.all(Array.from(this.filhos.values()).map((f) => f.desligar()));
      void this.sinal();
    } else if (c === "retomar") {
      this.maquina.pausado = false;
      this.gravarMaquina();
      this.ligarPermitidos();
      void this.sinal();
    } else if (c === "sair") {
      void this.encerrar(0);
    } else if (c === "sair-agora") {
      void this.encerrar(0, { forcar: true });
    } else if (c === "atualizar") {
      void this.sinal();
    }
    if (c !== "estado") this.mudou();
    return this.estadoParaOPainel();
  }

  /** Para tudo com calma (sem derrubar trabalho em curso, a não ser `forcar`) e sai. */
  async encerrar(codigo: number, opcoes: { forcar?: boolean } = {}): Promise<void> {
    if (this.saindo && !opcoes.forcar) return;
    this.saindo = true;
    for (const t of this.relogios) clearInterval(t);
    this.relogios = [];
    this.mudou();
    this.o.registro.linha(`[supervisor] saindo (código ${codigo})${Array.from(this.filhos.values()).some((f) => f.ocupado) && !opcoes.forcar ? ": espero os trabalhos em curso terminarem" : ""}`);
    await Promise.all(Array.from(this.filhos.values()).map((f) => f.desligar({ forcar: opcoes.forcar })));
    // Última batida (o painel vê "parado" na hora, sem esperar o sinal envelhecer).
    try {
      if (this.banco && codigo === 0 && !this.maquina.revogada) {
        await this.banco.sinal({
          maquina_id: this.maquina.maquina_id,
          nome: this.maquina.nome,
          hostname: this.hostname,
          sistema: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
          versao: this.o.versao,
          estado: { ...this.estadoParaOPainel(), desligado: true },
          executores: this.executores(),
        });
      }
    } catch {
      /* sem rede: o sinal envelhece sozinho */
    }
    if (this.avisoPendente) clearTimeout(this.avisoPendente);
    this.bandeja?.fechar();
    this.o.sair(codigo);
  }
}
