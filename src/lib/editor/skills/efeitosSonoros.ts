import { porEfeitos } from "../motion/aplicar";
import { Montador, parametrosComPadrao, type Skill } from "./tipos";

/**
 * Efeitos sonoros casados (frente EDT, F3): um som da biblioteca CC0 em cada
 * peça de motion, com o pico medido do som no quadro do auge do movimento e
 * 0,65 s entre um e outro. Refazer tira os efeitos que a skill pôs antes.
 */
export const SKILL_EFEITOS_SONOROS: Skill = {
  id: "efeitos_sonoros",
  rotulo: "Efeitos sonoros",
  descricao: "Um efeito CC0 em cada animação, com o pico do som no quadro do movimento e 0,65 s entre eles.",
  referencia: "EDIT IA PRO (plano de sons), reescrito; sons CC0 com comprovante em public/editor/sons/licencas",
  precisaDeFala: false,
  parametros: [
    {
      chave: "modo",
      rotulo: "Quantos",
      tipo: "escolha",
      padrao: "casados",
      opcoes: [
        { valor: "casados", rotulo: "Um por animação" },
        { valor: "poucos", rotulo: "Poucos (só os fortes)" },
      ],
    },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_EFEITOS_SONOROS, dados);
    const m = new Montador(p);
    const n = porEfeitos(m, params.modo === "poucos" ? "poucos" : "casados");
    if (!n) m.avisar("Sem animação na linha do tempo: os efeitos entram no pico das peças de motion.");
    if (n) m.aplicar({ op: "registrar_skill", skill: "efeitos_sonoros", resumo: `${n} efeitos`, em: ctx.agora });
    return m.proposta("efeitos_sonoros", "Efeitos sonoros", n ? `${n} ${n === 1 ? "efeito" : "efeitos"} no pico das animações.` : "Nenhum efeito para pôr.");
  },
};
