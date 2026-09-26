import type { ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { assinaturaDoProjeto } from "./operacoes";

/**
 * Salvamento automático do editor (frente V-B), sem laço:
 * - salva só quando o CONTEÚDO muda (assinatura sem revisão e data);
 * - espera `esperaMs` sem mudança (respiro) antes de gravar;
 * - um salvamento por vez: mudança durante a gravação espera a volta e grava
 *   uma vez só, com o estado mais novo;
 * - erro não tenta sozinho de novo (sem laço de correção): fica "erro" até a
 *   próxima mudança ou o "Tentar de novo";
 * - conflito (outra pessoa salvou: revisão diferente) para tudo e pede para
 *   recarregar, nada se perde calado.
 */

export type EstadoDoSalvamento = "salvo" | "pendente" | "salvando" | "erro" | "conflito";

export interface RespostaDoSalvar {
  revisao: number;
}

export interface OpcoesDoSalvador {
  salvar: (projeto: ProjetoDeEdicao, revisaoLida: number) => Promise<RespostaDoSalvar>;
  revisaoInicial: number;
  projetoInicial: ProjetoDeEdicao;
  esperaMs?: number;
  aoMudar?: (estado: EstadoDoSalvamento, detalhe: string | null) => void;
  ehConflito?: (erro: unknown) => boolean;
  textoDoErro?: (erro: unknown) => string;
}

export interface Salvador {
  mudou: (projeto: ProjetoDeEdicao) => void;
  agora: () => Promise<void>;
  tentarDeNovo: () => void;
  parar: () => void;
  estado: () => EstadoDoSalvamento;
  revisao: () => number;
}

export function criarSalvador(o: OpcoesDoSalvador): Salvador {
  const espera = o.esperaMs === undefined ? 1500 : o.esperaMs;
  let revisao = o.revisaoInicial;
  let ultimoSalvo = assinaturaDoProjeto(o.projetoInicial);
  let maisNovo: ProjetoDeEdicao = o.projetoInicial;
  let estado: EstadoDoSalvamento = "salvo";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let emVoo: Promise<void> | null = null;
  let parado = false;

  const mudarEstado = (e: EstadoDoSalvamento, detalhe: string | null = null) => {
    estado = e;
    if (o.aoMudar) o.aoMudar(e, detalhe);
  };
  const limpar = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const gravar = async (): Promise<void> => {
    limpar();
    if (parado || estado === "conflito") return;
    if (emVoo) return; // a volta do que está em voo confere se ainda falta algo
    const alvo = maisNovo;
    const assinatura = assinaturaDoProjeto(alvo);
    if (assinatura === ultimoSalvo) {
      mudarEstado("salvo");
      return;
    }
    mudarEstado("salvando");
    emVoo = (async () => {
      try {
        const r = await o.salvar(alvo, revisao);
        revisao = r.revisao;
        ultimoSalvo = assinatura;
        emVoo = null;
        if (parado) return;
        if (assinaturaDoProjeto(maisNovo) !== ultimoSalvo) {
          // Mudou enquanto gravava: grava de novo UMA vez, depois do respiro.
          mudarEstado("pendente");
          timer = setTimeout(() => void gravar(), espera);
        } else mudarEstado("salvo");
      } catch (e) {
        emVoo = null;
        if (o.ehConflito && o.ehConflito(e)) mudarEstado("conflito", o.textoDoErro ? o.textoDoErro(e) : null);
        else mudarEstado("erro", o.textoDoErro ? o.textoDoErro(e) : null);
      }
    })();
    return emVoo;
  };

  return {
    mudou(projeto) {
      if (parado || estado === "conflito") return;
      maisNovo = projeto;
      if (assinaturaDoProjeto(projeto) === ultimoSalvo) {
        limpar();
        if (!emVoo) mudarEstado("salvo");
        return;
      }
      if (emVoo) return; // a volta decide
      mudarEstado("pendente");
      limpar();
      timer = setTimeout(() => void gravar(), espera);
    },
    agora: () => gravar(),
    tentarDeNovo() {
      if (estado === "erro") void gravar();
    },
    parar() {
      parado = true;
      limpar();
    },
    estado: () => estado,
    revisao: () => revisao,
  };
}
