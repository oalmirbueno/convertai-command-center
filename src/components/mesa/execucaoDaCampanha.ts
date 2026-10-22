import { useSyncExternalStore } from "react";
import type { PassoDaCampanha } from "./regrasDaCampanha";

/**
 * "Gerar campanha completa" (21/10/2026): roda os passos em sequência (campanha, selo, cada peça), com
 * pausar, continuar e cancelar. Mora fora dos componentes (como o pedido em curso do agente): criar a
 * campanha troca a tela da Nova para a campanha aberta, e o andamento segue à vista.
 *
 * Regras:
 * - falha na campanha para tudo (sem campanha não há peças);
 * - falha no selo ou numa peça vira erro naquele passo e o resto segue;
 * - pausa e cancelamento valem entre um passo e o próximo (a chamada em curso já foi paga e termina);
 * - o que cada passo grava fica no servidor: reabrir a campanha recalcula o que falta (passosQueFaltam).
 */

export type SituacaoDoPasso = "fila" | "rodando" | "feito" | "erro" | "pulado";
export type SituacaoDaExecucao = "rodando" | "pausada" | "cancelada" | "concluida" | "falhou";

export interface PassoEmCurso extends PassoDaCampanha {
  situacao: SituacaoDoPasso;
  erro?: string;
}

export interface Execucao {
  chave: string;
  campanhaId: string | null;
  situacao: SituacaoDaExecucao;
  passos: PassoEmCurso[];
  desde: number;
  erro?: string;
}

export interface DepsDaExecucao {
  /** Cria a campanha e devolve o id e os passos das peças (o selo é decidido aqui). */
  criarCampanha: () => Promise<{ campanhaId: string; passos: PassoDaCampanha[] }>;
  gerarSelo: (campanhaId: string) => Promise<void>;
  /** Cria a direção da peça no Estúdio e já pede as lâminas ao gerador. */
  prepararPeca: (campanhaId: string, passo: PassoDaCampanha) => Promise<void>;
  /** Pede ao gerador as lâminas que faltam. */
  gerarPeca: (campanhaId: string, passo: PassoDaCampanha) => Promise<void>;
  /** Stories pela aba Stories (contrato gerarStoriesDaCampanha). */
  gerarStory?: (campanhaId: string, passo: PassoDaCampanha) => Promise<void>;
  /** Cancelado: tira da fila o que esta execução pediu e ainda não começou. */
  aoCancelar?: (campanhaId: string | null) => Promise<void>;
  aoMudar?: (e: Execucao) => void;
}

const execucoes: Record<string, Execucao> = {};
const controles: Record<string, { pausada: boolean; cancelada: boolean; acordar: (() => void) | null }> = {};
const ouvintes: (() => void)[] = [];

function avisar() {
  ouvintes.slice().forEach((f) => f());
}

function gravar(e: Execucao, deps?: DepsDaExecucao) {
  execucoes[e.chave] = e;
  avisar();
  if (deps && deps.aoMudar) deps.aoMudar(e);
}

function ouvir(f: () => void) {
  ouvintes.push(f);
  return () => {
    const i = ouvintes.indexOf(f);
    if (i >= 0) ouvintes.splice(i, 1);
  };
}

/** A execução desta chave ou desta campanha (a Nova vira a campanha ao ser criada). */
export function execucaoDe(chaveOuCampanha: string | null | undefined): Execucao | null {
  if (!chaveOuCampanha) return null;
  if (execucoes[chaveOuCampanha]) return execucoes[chaveOuCampanha];
  const ks = Object.keys(execucoes);
  for (let i = 0; i < ks.length; i++) if (execucoes[ks[i]].campanhaId === chaveOuCampanha) return execucoes[ks[i]];
  return null;
}

export function useExecucao(chaveOuCampanha: string | null | undefined): Execucao | null {
  return useSyncExternalStore(ouvir, () => execucaoDe(chaveOuCampanha));
}

export const emAndamento = (e: Execucao | null) => !!e && (e.situacao === "rodando" || e.situacao === "pausada");

export function pausar(chave: string) {
  const c = controles[chave];
  const e = execucoes[chave];
  if (!c || !e || c.pausada || c.cancelada || !emAndamento(e)) return;
  c.pausada = true;
  gravar({ ...e, situacao: "pausada" });
}

export function continuar(chave: string) {
  const c = controles[chave];
  const e = execucoes[chave];
  if (!c || !e || !c.pausada || !emAndamento(e)) return;
  c.pausada = false;
  gravar({ ...e, situacao: "rodando" });
  if (c.acordar) c.acordar();
}

export function cancelar(chave: string) {
  const c = controles[chave];
  const e = execucoes[chave];
  if (!c || !e || !emAndamento(e)) return;
  c.cancelada = true;
  c.pausada = false;
  if (c.acordar) c.acordar();
}

/** Tira a execução terminada da tela. */
export function esquecer(chave: string) {
  const e = execucoes[chave];
  if (e && emAndamento(e)) return;
  delete execucoes[chave];
  delete controles[chave];
  avisar();
}

const texto = (e: unknown) => (e instanceof Error && e.message ? e.message : "Não deu certo.");

/** Roda os passos. Uma execução por chave: chamar de novo com outra em andamento devolve a de agora. */
export async function executarCampanha(chave: string, campanhaId: string | null, passosIniciais: PassoDaCampanha[], deps: DepsDaExecucao): Promise<Execucao> {
  const atual = execucoes[chave];
  if (atual && emAndamento(atual)) return atual;
  const controle = { pausada: false, cancelada: false, acordar: null as (() => void) | null };
  controles[chave] = controle;
  let e: Execucao = {
    chave,
    campanhaId,
    situacao: "rodando",
    passos: passosIniciais.map((p) => ({ ...p, situacao: "fila" as SituacaoDoPasso })),
    desde: Date.now(),
  };
  gravar(e, deps);

  // A pausa pedida no meio de um passo vale para o que a tela mostra (o passo em curso termina).
  const mudarPasso = (id: string, mudanca: Partial<PassoEmCurso>) => {
    e = { ...e, situacao: controle.pausada ? "pausada" : "rodando", passos: e.passos.map((p) => (p.id === id ? { ...p, ...mudanca } : p)) };
    gravar(e, deps);
  };

  const esperarSePausada = async () => {
    while (controle.pausada && !controle.cancelada) {
      await new Promise<void>((ok) => {
        controle.acordar = () => {
          controle.acordar = null;
          ok();
        };
      });
    }
  };

  for (let i = 0; i < e.passos.length; i++) {
    await esperarSePausada();
    if (controle.cancelada) break;
    const passo = e.passos[i];
    if (passo.situacao !== "fila") continue;
    mudarPasso(passo.id, { situacao: "rodando" });
    try {
      if (passo.tipo === "campanha") {
        const r = await deps.criarCampanha();
        // As peças previstas dão lugar às peças de verdade da série criada.
        const feitos = e.passos.filter((p) => p.id === passo.id).map((p) => ({ ...p, situacao: "feito" as SituacaoDoPasso }));
        e = { ...e, campanhaId: r.campanhaId, passos: feitos.concat(r.passos.map((p) => ({ ...p, situacao: "fila" as SituacaoDoPasso }))) };
        gravar(e, deps);
        i = 0;
        continue;
      }
      if (!e.campanhaId) throw new Error("Campanha ainda não criada.");
      if (passo.tipo === "selo") await deps.gerarSelo(e.campanhaId);
      else if (passo.tipo === "preparar") await deps.prepararPeca(e.campanhaId, passo);
      else if (passo.tipo === "story") {
        if (!deps.gerarStory) throw new Error("Os stories ainda não estão ligados à aba Stories.");
        await deps.gerarStory(e.campanhaId, passo);
      }
      else await deps.gerarPeca(e.campanhaId, passo);
      mudarPasso(passo.id, { situacao: "feito" });
    } catch (erro) {
      mudarPasso(passo.id, { situacao: "erro", erro: texto(erro) });
      if (passo.tipo === "campanha") {
        e = { ...e, situacao: "falhou", erro: texto(erro), passos: e.passos.map((p) => (p.situacao === "fila" ? { ...p, situacao: "pulado" as SituacaoDoPasso } : p)) };
        gravar(e, deps);
        return e;
      }
    }
  }

  if (controle.cancelada) {
    e = { ...e, situacao: "cancelada", passos: e.passos.map((p) => (p.situacao === "fila" ? { ...p, situacao: "pulado" as SituacaoDoPasso } : p)) };
    gravar(e, deps);
    if (deps.aoCancelar) await deps.aoCancelar(e.campanhaId).catch(() => undefined);
    return e;
  }
  e = { ...e, situacao: "concluida" };
  gravar(e, deps);
  return e;
}

/** Só para os testes. */
export function limparExecucoes() {
  Object.keys(execucoes).forEach((k) => delete execucoes[k]);
  Object.keys(controles).forEach((k) => delete controles[k]);
  avisar();
}
