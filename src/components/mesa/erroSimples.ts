/**
 * Erro em linguagem simples (16/10/2026, dono: "a parte de erros parece
 * poluída, dá para deixar mais bonito e organizado"). Mensagem curta e sem
 * jargão fica como está. Mensagem com cara de técnica (código_com_traço,
 * "status 400", endereço, JSON, "Error") vira uma frase curta, e o texto
 * inteiro fica para o "Detalhe técnico" recolhido. Sem regex que navegador antigo não entende
 * (Safari 11 / Chrome 64).
 *
 * Arquivo próprio (sem React): o aviso da geração e o Custo.tsx usam o mesmo.
 */
const MARCA_TECNICA = /\b[a-z]+_[a-z0-9_]+\b|\b(status|http|respondeu|code)\s*:?\s*[45]\d\d\b|https?:\/\/|[{}[\]]|\b[A-Za-z]*Error\b|\bat [\w.]+ \(/i;
const LIMITE_DO_RESUMO = 160;

export function erroEmPartes(texto: string): { resumo: string; detalhe: string | null } {
  const limpo = (texto || "").replace(/\s+/g, " ").trim();
  if (!limpo) return { resumo: "Não foi possível concluir. Tente de novo.", detalhe: null };
  const marca = MARCA_TECNICA.exec(limpo);
  if (!marca && limpo.length <= LIMITE_DO_RESUMO) return { resumo: limpo, detalhe: null };
  // Corta antes da parte técnica (e do "(" ou ":" que a apresenta).
  let resumo = limpo.slice(0, marca ? marca.index : LIMITE_DO_RESUMO).replace(/[\s(:;,-]+$/, "").trim();
  if (resumo.length > LIMITE_DO_RESUMO) {
    const corte = resumo.lastIndexOf(" ", LIMITE_DO_RESUMO);
    resumo = resumo.slice(0, corte > 40 ? corte : LIMITE_DO_RESUMO).trim();
  }
  if (resumo.length < 12) resumo = "O serviço falhou neste passo. Tente de novo.";
  else if (!/[.!?]$/.test(resumo)) resumo += ".";
  return { resumo, detalhe: limpo };
}
