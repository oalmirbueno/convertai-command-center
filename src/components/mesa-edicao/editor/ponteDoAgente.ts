import { useEffect, useState } from "react";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import type { ControleDePropostas } from "./PainelDeSkills";

/**
 * Ponte entre o editor de vídeo (etapa Editar, região principal) e o agente
 * editor (lateral fixa da Mesa Edição, frente Q, 26/09). O editor publica aqui
 * o projeto aberto e o jeito de aplicar/desfazer; a lateral lê e mostra o
 * AgenteEditor com o mesmo projeto. Sem editor aberto, a lateral mostra o
 * seletor de modelo e diz o que falta.
 *
 * Também guarda um pedido deixado pelo agente de edição das outras etapas
 * ("pode editar ele" em Organizar): a lateral do Editar põe o pedido no campo
 * (nada roda nem gasta sem o clique do dono).
 */

export interface PonteDoAgenteEditor {
  clientId: string;
  versaoId: string;
  projeto: ProjetoDeEdicao;
  controle: ControleDePropostas;
  aplicarProjeto: (p: ProjetoDeEdicao, rotulo: string) => void;
  urls: Record<string, string>;
}

let atual: PonteDoAgenteEditor | null = null;
const pendentes: Record<string, string> = {};
const ouvintes: Array<() => void> = [];

function avisar() {
  ouvintes.slice().forEach((f) => f());
}

/** O editor aberto publica (a cada mudança do projeto). */
export function publicarNaPonte(p: PonteDoAgenteEditor) {
  atual = p;
  avisar();
}

/** O editor saiu da tela: só tira se ainda é ele que está na ponte. */
export function tirarDaPonte(versaoId: string) {
  if (atual && atual.versaoId === versaoId) {
    atual = null;
    avisar();
  }
}

export const lerPonte = (clientId: string): PonteDoAgenteEditor | null => (atual && atual.clientId === clientId ? atual : null);

/** A lateral: redesenha quando o editor publica. */
export function usePonteDoAgente(clientId: string): PonteDoAgenteEditor | null {
  const [, setVersao] = useState(0);
  useEffect(() => {
    const f = () => setVersao((v) => v + 1);
    ouvintes.push(f);
    return () => {
      const i = ouvintes.indexOf(f);
      if (i >= 0) ouvintes.splice(i, 1);
    };
  }, []);
  return lerPonte(clientId);
}

/** O agente das outras etapas deixa o pedido para o agente editor. */
export function deixarPedidoParaOEditor(clientId: string, texto: string) {
  const t = String(texto || "").trim().slice(0, 1500);
  if (!clientId || !t) return;
  pendentes[clientId] = t;
  avisar();
}

/** O agente editor pega (e consome) o pedido deixado. */
export function pegarPedidoPendente(clientId: string): string | null {
  const t = pendentes[clientId] || null;
  if (t) delete pendentes[clientId];
  return t;
}

export const temPedidoPendente = (clientId: string) => !!pendentes[clientId];
