/**
 * Atualização sozinha (frente SUP, 01/10/2026).
 *
 * A batida da máquina devolve a versão publicada no painel. Se for outra:
 * 1. baixa o pacote por URL assinada (Storage privado) e confere o sha256;
 * 2. extrai em versoes\<nova> e prepara as dependências dos motores desta máquina
 *    (os motores seguem trabalhando na versão atual enquanto isso);
 * 3. fica "pronta" e o supervisor espera TODOS os motores ociosos para trocar
 *    (nunca no meio de um construir, render ou tarefa do navegador);
 * 4. a troca é: atual.json aponta para a nova (em teste) e o supervisor sai com 75;
 *    o lançador sobe a nova. Se a nova cair ao subir, volta para a anterior e
 *    marca a nova como recusada (não tenta de novo).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Banco, VersaoPublicada } from "./banco.ts";
import { type Atual, type Caminhos, gravarJson, type IdDoMotor, lerAtual, pastaDaVersao, versaoInstalada } from "./config.ts";
import { extrairPacote, FORMATO_DA_VERSAO, prepararDependencias, type Rodar, sha256 } from "./pacote.ts";
import type { Registro } from "./registros.ts";

export const CODIGO_DE_TROCA = 75;

export type EtapaDaAtualizacao = "baixando" | "preparando" | "pronta" | "falhou";

export interface OpcoesDoAtualizador {
  c: Caminhos;
  registro: Registro;
  rodar?: Rodar;
  semNpm?: boolean;
  /** Espera depois de uma falha antes de tentar a mesma versão de novo (ms). */
  esperaDepoisDaFalha?: number;
}

export class Atualizador {
  etapa: EtapaDaAtualizacao | null = null;
  alvo: VersaoPublicada | null = null;
  erro: string | null = null;
  private falhouEm = 0;
  private emCurso: Promise<void> | null = null;
  private readonly o: OpcoesDoAtualizador;

  constructor(o: OpcoesDoAtualizador) {
    this.o = o;
  }

  /** Vale a pena buscar esta versão? (outra, válida, não recusada, não em falha recente) */
  quer(alvo: VersaoPublicada | null, atual: string | null): boolean {
    if (!alvo || !FORMATO_DA_VERSAO.test(alvo.versao) || !/^[0-9a-f]{64}$/.test(alvo.sha256)) return false;
    if (alvo.versao === atual) return false;
    if (lerAtual(this.o.c).recusadas.indexOf(alvo.versao) >= 0) return false;
    if (this.alvo?.versao === alvo.versao && (this.etapa === "pronta" || this.emCurso)) return false;
    if (this.alvo?.versao === alvo.versao && this.etapa === "falhou" && Date.now() - this.falhouEm < (this.o.esperaDepoisDaFalha ?? 30 * 60_000)) return false;
    return true;
  }

  /** Baixa e prepara em segundo plano. Uma de cada vez. */
  preparar(alvo: VersaoPublicada, banco: Banco, motores: IdDoMotor[]): Promise<void> {
    if (this.emCurso) return this.emCurso;
    this.alvo = alvo;
    this.erro = null;
    this.emCurso = this.fazer(alvo, banco, motores)
      .then(
        () => {
          this.etapa = "pronta";
          this.o.registro.linha(`[atualização] versão ${alvo.versao} pronta; troco quando todos os motores estiverem ociosos`);
        },
        (e) => {
          this.etapa = "falhou";
          this.falhouEm = Date.now();
          this.erro = e instanceof Error ? e.message : String(e);
          this.o.registro.linha(`[atualização] a versão ${alvo.versao} não ficou pronta: ${this.erro}`);
        },
      )
      .finally(() => {
        this.emCurso = null;
      });
    return this.emCurso;
  }

  private async fazer(alvo: VersaoPublicada, banco: Banco, motores: IdDoMotor[]): Promise<void> {
    const { c, registro } = this.o;
    const destino = pastaDaVersao(c, alvo.versao);
    if (!versaoInstalada(c, alvo.versao)) {
      this.etapa = "baixando";
      registro.linha(`[atualização] baixando a versão ${alvo.versao}`);
      const url = await banco.urlDoPacote(alvo.caminho);
      const bytes = await banco.baixar(url);
      const hash = sha256(bytes);
      if (hash !== alvo.sha256) throw new Error(`o pacote baixado não confere (sha256 ${hash.slice(0, 12)}… em vez de ${alvo.sha256.slice(0, 12)}…)`);
      mkdirSync(c.baixados, { recursive: true });
      const zip = path.join(c.baixados, `${alvo.versao}.zip`);
      writeFileSync(zip, bytes);
      this.etapa = "preparando";
      await extrairPacote(zip, destino, registro, this.o.rodar);
      rmSync(zip, { force: true });
    }
    this.etapa = "preparando";
    for (const m of motores) await prepararDependencias(destino, c.deps, m, { registro, rodar: this.o.rodar, semNpm: this.o.semNpm });
  }
}

/** Troca para a versão nova (em teste). O supervisor sai com CODIGO_DE_TROCA logo depois. */
export function trocarPara(c: Caminhos, nova: string): Atual {
  const a = lerAtual(c);
  const proxima: Atual = { versao: nova, anterior: a.versao, em_teste: true, desde: new Date().toISOString(), recusadas: a.recusadas || [] };
  gravarJson(c.atual, proxima);
  return proxima;
}

/** A versão em teste não se firmou: volta para a anterior e recusa a nova. */
export function voltarVersao(c: Caminhos, motivo: string, registro?: Registro): Atual {
  const a = lerAtual(c);
  if (!a.anterior || !versaoInstalada(c, a.anterior)) {
    // Sem anterior instalada não há para onde voltar: fica na atual, sem teste.
    const fica: Atual = { ...a, em_teste: false };
    gravarJson(c.atual, fica);
    registro?.linha(`[atualização] a versão ${a.versao} falhou (${motivo}), mas não há versão anterior para voltar`);
    return fica;
  }
  const recusadas = Array.from(new Set([...(a.recusadas || []), ...(a.versao ? [a.versao] : [])])).slice(-20);
  const volta: Atual = { versao: a.anterior, anterior: null, em_teste: false, desde: new Date().toISOString(), recusadas };
  gravarJson(c.atual, volta);
  registro?.linha(`[atualização] voltei para a versão ${a.anterior}: a ${a.versao} ${motivo}`);
  return volta;
}

/** A versão em teste se firmou. */
export function confirmarVersao(c: Caminhos): Atual {
  const a = lerAtual(c);
  const ok: Atual = { ...a, em_teste: false };
  gravarJson(c.atual, ok);
  return ok;
}
