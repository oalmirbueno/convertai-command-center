import { useEffect } from "react";

/**
 * Área reservada para botão flutuante (docs/design/SISTEMA.md, "Área de
 * trabalho e rolagem").
 *
 * No celular e no tablet (< 1024 px) algumas telas ainda têm um botão que
 * flutua sobre o conteúdo, acima da barra de baixo (o agente da mesa em
 * gaveta, o Agente do mês, a barra de seleção do Acervo). Rolando até o fim,
 * o último pedaço da página ficava por baixo dele. Enquanto o botão está na
 * tela, este hook reserva no fim do conteúdo do painel uma faixa vazia da
 * altura pedida (src/index.css: body[data-reserva-flutuante] no
 * [data-casca="conteudo"]::after), e assim tudo pode rolar para cima dele.
 *
 * Várias reservas ao mesmo tempo valem pela maior. De 1024 px para cima o CSS
 * não reserva nada (lá o agente é a lateral fixa).
 */

const reservas: number[] = [];

function aplicar() {
  try {
    const body = document.body;
    if (!reservas.length) {
      body.removeAttribute("data-reserva-flutuante");
      body.style.removeProperty("--reserva-flutuante");
      return;
    }
    const maior = Math.max.apply(null, reservas);
    body.setAttribute("data-reserva-flutuante", "");
    body.style.setProperty("--reserva-flutuante", `${Math.round(maior)}px`);
  } catch {
    /* sem documento */
  }
}

/** Reserva `altura` px no fim do conteúdo enquanto `ativo` (padrão 72 px: um botão de 44 a 48 px e respiro). */
export function useReservaFlutuante(ativo: boolean, altura = 72) {
  useEffect(() => {
    if (!ativo) return;
    reservas.push(altura);
    aplicar();
    return () => {
      const i = reservas.indexOf(altura);
      if (i >= 0) reservas.splice(i, 1);
      aplicar();
    };
  }, [ativo, altura]);
}

export default useReservaFlutuante;
