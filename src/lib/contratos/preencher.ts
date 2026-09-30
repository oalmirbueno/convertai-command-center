import type { CampoParaPreencher } from "@/components/sistema";
import type { ClausulaMontada, Valores, VariavelDoModelo } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * "Preencher com IA" nos contratos (frente CON2, 30/09): as variáveis do
 * contrato viram campos da peça comum (PreencherComIA, papel "contrato").
 *
 * Regra dura: o agente não inventa valor, prazo, data nem cláusula. Os campos
 * de número e data levam a dica de só usar o que está escrito na proposta, no
 * briefing ou na conversa (a função preencher-ia ainda esvazia o que tiver
 * número sem fonte). As cláusulas extras são decisão do dono: não entram.
 * Cláusula sugerida nunca é gravada direto: a tela mostra a diferença e pede
 * Confirmar.
 */

const DICA_DE_NUMERO = "Só o valor exato que está na proposta, no briefing ou na conversa. Sem fonte, deixe vazio: nunca invente valor, prazo nem data.";

export const GRUPOS_QUE_A_IA_PREENCHE = ["aditivo", "cliente", "quadro", "servico"];

export function tipoDoCampo(v: VariavelDoModelo): CampoParaPreencher["tipo"] {
  if (v.tipo === "textoLongo") return "texto_longo";
  if (v.tipo === "escolha") return "escolha";
  if (v.tipo === "moeda" || v.tipo === "inteiro" || v.tipo === "percentual") return "numero";
  return "texto";
}

function dicaDe(v: VariavelDoModelo): string {
  const partes: string[] = [];
  if (v.tipo === "moeda") partes.push(`Valor em reais, só o número (ex.: 3500 ou 3500.50). ${DICA_DE_NUMERO}`);
  else if (v.tipo === "inteiro" || v.tipo === "percentual") partes.push(`Só o número. ${DICA_DE_NUMERO}`);
  else if (v.tipo === "data") partes.push(`Data no formato AAAA-MM-DD. ${DICA_DE_NUMERO}`);
  else if (v.tipo === "escolha") partes.push(`Uma destas opções: ${(v.opcoes || []).map((o) => `${o.valor} (${o.rotulo})`).join(", ")}.`);
  else if (v.grupo === "cliente") partes.push("Só dado escrito nas fontes (nome, documento, endereço, e-mail). Nunca invente.");
  else partes.push("Com as palavras da proposta ou do briefing, em frase curta, sem prometer resultado.");
  if (v.ajuda) partes.push(v.ajuda);
  return partes.join(" ").slice(0, 400);
}

/** Campos da peça comum para um grupo de variáveis (só os grupos que a IA pode preencher). */
export function camposDasVariaveis(variaveis: VariavelDoModelo[], valores: Valores): CampoParaPreencher[] {
  return variaveis
    .filter((v) => GRUPOS_QUE_A_IA_PREENCHE.indexOf(v.grupo || "quadro") >= 0)
    .map((v) => ({
      chave: v.nome,
      rotulo: v.rotulo,
      tipo: tipoDoCampo(v),
      ...(v.tipo === "escolha" ? { opcoes: (v.opcoes || []).map((o) => o.valor) } : {}),
      valorAtual: valores[v.nome] || "",
      dica: dicaDe(v),
      maximo: v.tipo === "textoLongo" ? 1200 : 300,
    }));
}

/** O que a IA devolveu, no formato que o contrato guarda (número como texto, escolha só se for opção). */
export function valoresDaIA(variaveis: VariavelDoModelo[], valores: Record<string, unknown>): Valores {
  const saida: Valores = {};
  const porNome: Record<string, VariavelDoModelo> = {};
  variaveis.forEach((v) => (porNome[v.nome] = v));
  Object.keys(valores).forEach((k) => {
    const v = porNome[k];
    const bruto = valores[k];
    if (!v || bruto === null || bruto === undefined) return;
    const t = String(bruto).trim();
    if (!t) return;
    if (v.tipo === "escolha" && !(v.opcoes || []).some((o) => o.valor === t)) return;
    saida[k] = t;
  });
  return saida;
}

/** Campo da cláusula para "Sugerir texto": só com "substituir", e a tela mostra a diferença antes de gravar. */
export function campoDaClausula(c: Pick<ClausulaMontada, "chave" | "numero" | "titulo">, atual: string): CampoParaPreencher {
  return {
    chave: c.chave,
    rotulo: `Cláusula ${c.numero} ${c.titulo}`,
    tipo: "texto_longo",
    valorAtual: atual,
    maximo: 6000,
    dica: "Reescreva só o que o briefing, a proposta ou a conversa pedem. Mantenha as {{variáveis}} como estão. Nunca crie obrigação, valor, prazo ou multa que não esteja nas fontes. Sem travessão.",
  };
}
