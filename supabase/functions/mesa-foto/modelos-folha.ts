/**
 * Folha das 6 vistas e identidade travada (dono, 02/10: "a criação do modelo
 * segue a folha das 6 vistas e mantém a pessoa EXATAMENTE igual; a folha volta
 * como referência em TODA geração seguinte com esse modelo").
 *
 * Arquivo sem dependência nenhuma (sem rede, sem banco, sem Deno, sem import):
 * personas.ts usa nos prompts da folha e do detalhe, o index usa na Foto com
 * modelo (tomadaGerar) e o teste do painel importa direto.
 */

/** As 6 vistas da folha, na ordem: rosto em 4 ângulos e o corpo em 2 distâncias. */
export const FOLHA_DAS_6_VISTAS = ["frente", "tres_quartos_esq", "tres_quartos_dir", "perfil_esq", "meio_corpo", "corpo_inteiro"] as const;

/** Rótulo curto de cada vista da folha (o mesmo da tela). */
export const ROTULO_DA_VISTA_DA_FOLHA: Record<(typeof FOLHA_DAS_6_VISTAS)[number], string> = {
  frente: "Frente",
  tres_quartos_esq: "3/4 esquerda",
  tres_quartos_dir: "3/4 direita",
  perfil_esq: "Perfil",
  meio_corpo: "Meio corpo",
  corpo_inteiro: "Corpo inteiro",
};

/** O que nunca muda na pessoa, em qualquer foto (persona sintética ou clone). */
export const REGRAS_DE_IDENTIDADE_COMUNS = [
  "a MESMA pessoa em todas as imagens, idêntica às imagens de identidade anexadas",
  "mesma geometria do rosto: formato do rosto, testa, maçãs, mandíbula e queixo nas mesmas proporções",
  "mesmos olhos (formato, cor, distância entre eles e pálpebras), mesmas sobrancelhas, mesmo nariz, mesma boca e mesmos lábios, mesmas orelhas",
  "mesmo tom e subtom de pele, com as mesmas marcas, pintas e sardas nos mesmos lugares",
  "mesmo cabelo: mesma cor, mesmo comprimento, mesma textura, mesmo corte e mesma linha do cabelo",
  "mesmas proporções do corpo, mesma altura aparente e mesma idade aparente",
  "nada de embelezar, rejuvenescer, afinar o rosto, mudar o peso nem trocar traços; sem filtro de beleza",
];

export const REGRA_DA_PERSONA_SINTETICA = "pessoa adulta sintética (gerada, não existe), sem semelhança com nenhuma pessoa real";
export const REGRA_DO_CLONE = "pessoa real adulta, com autorização registrada: as fotos reais e a folha aprovada são a verdade sobre o rosto; não invente nem corrija traço nenhum";

/** Regras de identidade da persona sintética (folha, detalhe 4K). */
export const REGRAS_DE_IDENTIDADE = [...REGRAS_DE_IDENTIDADE_COMUNS, REGRA_DA_PERSONA_SINTETICA];

/** Só na folha: o que fica igual entre as 6 vistas para elas servirem de referência depois. */
export const REGRAS_DA_FOLHA = [
  "só o ângulo e a distância da câmera mudam entre as vistas",
  "mesma roupa simples da âncora, mesma expressão neutra e serena, boca fechada",
  "mesmo fundo neutro liso claro e mesma luz natural suave e difusa em todas as vistas",
  "rosto inteiro visível: sem óculos escuros, chapéu, máscara ou mão no rosto; cabelo sem cobrir os olhos",
  "UMA foto de UMA pessoa: nada de grade, colagem, várias poses no mesmo quadro ou texto",
];

/** Frase curta de identidade que acompanha a ficha nas gerações com a persona (Canvas, Book). */
export const IDENTIDADE_EM_UMA_FRASE =
  "Identidade travada: sempre esta mesma pessoa das imagens de identidade, com o mesmo rosto, olhos, nariz, boca, mandíbula, pele, marcas, cabelo, corpo e idade; só muda o que o pedido manda; sem embelezar.";

const semTravessao = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");
const nomeLimpo = (nome: unknown) => semTravessao(String(nome ?? "").replace(/["\n\r]/g, " ").trim()).slice(0, 80) || "sem nome";

/** As regras de identidade da persona sintética num bloco só, para o prompt. */
export function regrasDeIdentidade(p: { nome: string }): string {
  return `IDENTIDADE TRAVADA da persona "${nomeLimpo(p.nome)}" (obrigatório): ${REGRAS_DE_IDENTIDADE.join("; ")}.`;
}

/**
 * Texto de identidade travada para QUALQUER geração com uma pessoa escolhida
 * (Foto com modelo, campanha, ensaio): vai no fim do prompt, junto com as
 * imagens de identidade (âncora e folha aprovada da persona; fotos reais e
 * folha aprovada do clone). Só pose, cena e roupa da tomada mudam.
 */
export function textoDeIdentidadeParaGeracao(p: { nome: string; invariantes: string[]; tipo: "persona" | "clone" }): string {
  const linhas: string[] = [];
  const quem = p.tipo === "clone" ? `a pessoa real "${nomeLimpo(p.nome)}"` : `a persona sintética "${nomeLimpo(p.nome)}"`;
  linhas.push(`IDENTIDADE TRAVADA (obrigatório): a pessoa desta foto é ${quem}, a mesma das imagens de identidade anexadas (folha das 6 vistas aprovada).`);
  linhas.push(`NUNCA MUDA: ${REGRAS_DE_IDENTIDADE_COMUNS.join("; ")}; ${p.tipo === "clone" ? REGRA_DO_CLONE : REGRA_DA_PERSONA_SINTETICA}.`);
  const invariantes = (Array.isArray(p.invariantes) ? p.invariantes : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 12);
  if (invariantes.length) linhas.push(`TRAÇOS QUE NÃO MUDAM: ${invariantes.join("; ")}.`);
  linhas.push("SÓ MUDA o que a tomada pede: pose, gesto, expressão leve, roupa, cenário, luz e enquadramento. Mãos com cinco dedos; sem sexualização.");
  return semTravessao(linhas.join("\n"));
}
