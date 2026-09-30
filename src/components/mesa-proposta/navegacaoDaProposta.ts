import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useConfirm } from "@/components/shared/confirmDialog";
import { tiraOLink } from "../../../supabase/functions/_shared/proposta-comercial";
import { useProvas, type Proposta } from "./propostaApi";

/**
 * Mesa Proposta, frente UXS (30/09): peças pequenas de navegação e de aviso
 * que as etapas dividem.
 *
 * - useConfirmarTirarOLink: numa proposta enviada, vista ou recusada, gravar
 *   o que o cliente vê tira o link dele. A pergunta vem antes, com o rótulo da
 *   ação (Salvar, Aplicar, Anexar, Tirar, Restaurar). Salvar só notas,
 *   transcrição, material ou lead não pergunta nada (não tira o link).
 * - useIrParaEtapa: troca só a etapa (e o `foco`, que vale uma vez), mantendo
 *   cliente e proposta no endereço. Os filhos não recebem o `mudar` da página.
 * - useFocoDeChegada: quem chega lê o `foco` uma vez e tira do endereço (não
 *   entra no "onde parou").
 */

export const TEXTO_DO_LINK = "O link que ele tem para de abrir. Depois é só Enviar de novo.";

export function useConfirmarTirarOLink() {
  const confirmar = useConfirm();
  return async (status: string, campos: string[], rotulo = "Salvar"): Promise<boolean> => {
    if (!tiraOLink(status, campos)) return true;
    return confirmar({ title: `${rotulo} e tirar o link do cliente?`, description: TEXTO_DO_LINK, confirmLabel: rotulo });
  };
}

export function useIrParaEtapa() {
  const [, setParams] = useSearchParams();
  return (etapa: string, foco?: string | null) => {
    setParams((antes) => {
      const proximo = new URLSearchParams(antes);
      proximo.set("etapa", etapa);
      if (foco) proximo.set("foco", foco);
      else proximo.delete("foco");
      return proximo;
    });
  };
}

/**
 * "Resolver" de uma pendência (Revisão e Envio): leva ao lugar que conserta.
 * Itens e validade: Investimento; reunião: Reunião; capa, desafio e mercado:
 * o bloco no Rascunho, aberto e em foco; provas: o bloco, ou a Biblioteca na
 * aba das provas quando a agência ainda não tem case nem depoimento.
 * Proposta aceita não muda: sem Resolver (null).
 */
export function useResolverPendencia(proposta: Proposta | null): ((chave: string) => void) | null {
  const irPara = useIrParaEtapa();
  const precisaDasProvas = !!proposta && proposta.pendencias.some((p) => p.chave === "provas");
  const provas = useProvas(precisaDasProvas);
  if (!proposta || proposta.status === "aceita") return null;
  const temProva = !!provas.data && provas.data.lista.some((p) => !p.arquivado);
  return (chave: string) => {
    if (chave === "itens" || chave === "validade") irPara("contexto", "investimento");
    else if (chave === "reuniao") irPara("contexto", "reuniao");
    else if (chave === "headline") irPara("rascunho", "capa");
    else if (chave === "provas") irPara(temProva ? "rascunho" : "contexto", "provas");
    else irPara("rascunho", chave);
  };
}

/** O `foco` do endereço no momento em que a etapa montou (e ele sai do endereço logo depois). */
export function useFocoDeChegada(): string | null {
  const [params, setParams] = useSearchParams();
  const foco = useRef<string | null | undefined>(undefined);
  if (foco.current === undefined) foco.current = params.get("foco");
  useEffect(() => {
    if (!foco.current) return;
    setParams(
      (antes) => {
        const proximo = new URLSearchParams(antes);
        proximo.delete("foco");
        return proximo;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return foco.current;
}

/**
 * Rola até o elemento depois que a região da etapa devolveu a posição guardada
 * (RegiaoRolavel devolve na montagem e de novo em 120 ms). Sem animação: a
 * região relê a posição a cada mudança da tela.
 */
export function rolarAte(seletor: string, atraso = 200) {
  window.setTimeout(() => {
    const el = document.querySelector(seletor) as HTMLElement | null;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, atraso);
}
