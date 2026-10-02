import { apelidosDoProjeto } from "../apelidos";
import { acharDuplicados, idsRepetidos, opsDeRemoverDuplicados, textoDosDuplicados } from "../duplicados";
import { Montador, type Skill } from "./tipos";

/**
 * Tirar takes repetidos (02/10): o mesmo take duas vezes na trilha de vídeo
 * (mesma mídia, mesmo trecho) sai; fica o primeiro. Regra fixa, de graça, sem
 * fala. Com "Puxar o resto", a trilha encosta.
 */
export const SKILL_REMOVER_DUPLICADOS: Skill = {
  id: "remover_duplicados",
  rotulo: "Tirar takes repetidos",
  descricao: "Tira o mesmo take que aparece duas vezes; fica o primeiro.",
  referencia: "regra fixa (mesma mídia e mesmo trecho)",
  precisaDeFala: false,
  parametros: [{ chave: "ondular", rotulo: "Puxar o resto", tipo: "sim_nao", padrao: true }],
  propor(p, ctx, params) {
    const grupos = acharDuplicados(p, ctx.assinaturas || null);
    const m = new Montador(p);
    const a = apelidosDoProjeto(p);
    const ids = idsRepetidos(grupos);
    if (!ids.length) return m.proposta("remover_duplicados", "Tirar takes repetidos", "Nenhum take repetido na trilha de vídeo.");
    opsDeRemoverDuplicados(grupos, params.ondular !== false).forEach((o) => m.aplicar(o));
    m.aplicar({ op: "registrar_skill", skill: "remover_duplicados", resumo: `${ids.length} repetidos`, em: ctx.agora });
    return m.proposta("remover_duplicados", "Tirar takes repetidos", `${ids.length} ${ids.length === 1 ? "take repetido sai" : "takes repetidos saem"}: ${textoDosDuplicados(grupos, a.porId)}`);
  },
};
