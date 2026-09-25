import { useEffect } from "react";

/**
 * Modo foco da casca do painel (dono, 25/09: "quando abre o canvas, tirar as
 * bolinhas flutuantes e a parte de cima, para ficar só o canvas").
 *
 * Sinal simples e sem contexto: enquanto alguma tela pede foco, o body ganha
 * o atributo data-modo-foco="<quem pediu>". O CSS da casca (src/index.css,
 * bloco "Modo foco") esconde o que tem data-casca="topo" (barra de cima, só
 * de 768 px para cima) e data-casca="flutuante" (botão de ajuda e assistente
 * de voz), e tira o recuo de cima do data-casca="conteudo". Quem marca esses
 * atributos é o AppLayout; quem pede foco hoje é só o Canvas da Mesa Foto.
 * Ao sair da tela (ou desligar), o atributo some e a casca volta igual.
 */

const pedidos: string[] = [];

function aplicar() {
  try {
    if (pedidos.length) document.body.setAttribute("data-modo-foco", pedidos[pedidos.length - 1]);
    else document.body.removeAttribute("data-modo-foco");
  } catch {
    /* sem documento (teste sem DOM): nada a esconder */
  }
}

export function ligarModoFoco(quem: string) {
  pedidos.push(quem);
  aplicar();
  return () => {
    const i = pedidos.lastIndexOf(quem);
    if (i >= 0) pedidos.splice(i, 1);
    aplicar();
  };
}

/** Liga o modo foco enquanto a tela está montada e `ativo` é verdadeiro. */
export function useModoFoco(quem: string, ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    return ligarModoFoco(quem);
  }, [quem, ativo]);
}
