/**
 * Foto exata ou só o rosto (frente RO, 29/09/2026).
 *
 * Queixa do dono: "eu coloco uma imagem do rosto na arte e ele faz exatamente
 * aquela foto, em vez de aproveitar as características do rosto e fazer junto
 * da imagem. Tem que ser feito pelo gerador, e não a mesma pose; tudo tem que
 * fazer sentido com o tema e a composição. Mas tem imagens que eu quero que
 * sejam exatamente elas."
 *
 * Causa: toda foto com rosto que chegava à lâmina (base da lâmina, Arte rápida,
 * diretor) caía no caminho "foto real intacta": a foto é a base, o original é
 * devolvido alinhado e o gerador só escreve o texto e a logo. Mesma pose.
 *
 * Agora cada foto tem um USO, escolhido por imagem:
 * - "exata" (Foto exata, o padrão e o de sempre): a foto fica intacta,
 *   alinhada, sem mudar pose nem expressão;
 * - "rosto" (Usar o rosto): a foto vira só a IDENTIDADE da pessoa. O gerador
 *   cria uma cena nova pela direção de arte (pose, ângulo, roupa se o tema
 *   pedir, luz e enquadramento), com a mesma pessoa. Nada é colado.
 *
 * Onde fica gravado: `fotos_livres[].uso` (foto trazida pela equipe) e
 * `uso_do_acervo` na lâmina (a foto do acervo, imagens_ids). Sem o campo:
 * exata (byte a byte o de hoje). `*_por` diz quem escolheu (equipe, Jev ou a
 * regra), para a tela mostrar e deixar trocar.
 *
 * Automático: o Jev (Choice) decide pelo pedido, com confiança mínima; abaixo
 * dela, a regra de palavras ("essa foto", "igual", "exatamente" = exata;
 * "só o rosto", "outra pose", cena ou tema novo = rosto); sem regra, exata
 * (o de sempre) com aviso para a equipe trocar.
 *
 * Sem import de Deno nem de npm: a tela, as funções e os testes leem o mesmo
 * arquivo. Sem lookbehind, propriedade Unicode ou grupo nomeado (Safari 11).
 */

export type UsoDaFoto = "exata" | "rosto";
export type QuemEscolheuOUso = "equipe" | "jev" | "regra";

export const USOS_DA_FOTO: UsoDaFoto[] = ["exata", "rosto"];

export const ROTULO_DO_USO: Record<UsoDaFoto, string> = {
  exata: "Foto exata",
  rosto: "Usar o rosto",
};

export const DICA_DO_USO: Record<UsoDaFoto, string> = {
  exata: "A foto entra como está: mesma pose, mesma expressão, só o texto e a logo em volta.",
  rosto: "Só a identidade da pessoa: o gerador cria uma cena nova com ela, na pose, luz e composição da direção de arte.",
};

/** Explicação do "?" (seletor compacto na base da lâmina e na Arte rápida). */
export const AJUDA_DO_USO =
  "Foto exata: a foto fica intacta e alinhada, sem mudar pose nem expressão; o gerador só escreve o texto e a logo. " +
  "Usar o rosto: o gerador cria uma cena nova, coerente com o tema e a composição da lâmina, com a mesma pessoa " +
  "(traços do rosto, tom de pele, cabelo, idade, óculos e barba se houver). Pose, ângulo, roupa, luz e enquadramento vêm da direção de arte. " +
  "Depois de gerar, a conferência avisa se a pessoa não parecer a mesma ou se a pose ficou igual à da foto.";

/** Confiança mínima do Jev para aceitar o uso que ele escolheu (abaixo: a regra, e depois exata com aviso). */
export const CONFIANCA_MINIMA_DO_USO = 0.7;

/** A frase que o prompt ao gerador sempre leva no modo rosto (pedido do dono, 29/09). */
export const FRASE_DA_IDENTIDADE =
  "mantenha a identidade da pessoa da imagem de referência; crie nova pose e composição conforme a direção; não copie a foto";

export function lerUso(v: unknown): UsoDaFoto | null {
  return v === "exata" || v === "rosto" ? v : null;
}

export function lerQuemEscolheu(v: unknown): QuemEscolheuOUso | null {
  return v === "equipe" || v === "jev" || v === "regra" ? v : null;
}

/** O uso gravado de uma foto trazida (sem campo: exata). */
export function usoDaFotoLivre(f: { uso?: unknown } | null | undefined): UsoDaFoto {
  return f && f.uso === "rosto" ? "rosto" : "exata";
}

/** O uso gravado da foto do acervo da lâmina (sem campo: exata). */
export function usoDoAcervo(card: { uso_do_acervo?: unknown } | null | undefined): UsoDaFoto {
  return card && card.uso_do_acervo === "rosto" ? "rosto" : "exata";
}

/** A foto trazida é logo (nota da Arte rápida) ou recorte sem fundo: não tem seletor de uso. */
export function fotoSemUso(f: { nota?: unknown; recortada?: unknown }): boolean {
  if (f.recortada === true) return true;
  return typeof f.nota === "string" && /^logo/i.test(f.nota.trim());
}

// ------------------------------------------------------------------ regra de palavras

const EXATA_FORTE = /exatamente|igualzinh|(^|[^a-zà-ú])igual([^a-zà-ú]|$)|como (ela |ele )?est[aá]|do jeito que (ela |ele )?est[aá]|sem mudar (a )?(foto|pose)|foto original|a pr[oó]pria foto|mesma foto|(ess|est|ness|nest)a (mesma )?foto|(essa|esta|a) foto (inteira|toda)|coloc[a-z]* (a |essa |esta )?foto/;
const ROSTO_FORTE = /s[oó] o rosto|us[a-z]* (s[oó] )?o rosto|o rosto d[eao]|rosto del[ea]|outra pose|nova pose|pose diferente|outra posi[cç][aã]o|n[aã]o (copi|cole|use a mesma foto|a mesma pose|igual)|identidade|caracter[ií]sticas do rosto|tra[cç]os do rosto/;
const CENA_NOVA = /falando (sobre|de|do|da)|apresentando|explicando|segurando|numa cena|em uma cena|cria[a-z]* (uma )?cena|cen[aá]rio|como se estivesse|vestid[oa] de|de terno|de jaleco|no palco|no escrit[oó]rio|na cozinha|na loja|em a[cç][aã]o|fazendo|tema|campanha de|com ele|com ela/;

/**
 * Uso pelas palavras do pedido (a regra fixa, sem o Jev), ou null quando o
 * pedido não diz. Pedido de "só o rosto" ou "outra pose" vence; depois
 * "essa foto", "igual", "exatamente"; depois cena ou tema novo.
 */
export function usoPelaRegra(pedido: string): UsoDaFoto | null {
  const p = String(pedido || "").toLowerCase();
  if (!p.trim()) return null;
  if (ROSTO_FORTE.test(p)) return "rosto";
  if (EXATA_FORTE.test(p)) return "exata";
  if (CENA_NOVA.test(p)) return "rosto";
  return null;
}

/**
 * Só as palavras fortes ("só o rosto", "outra pose", "essa foto", "igual",
 * "exatamente"), sem as de cena ou tema: na conversa com o diretor, um pedido
 * de cena não é pedido de trocar o uso da foto.
 */
export function usoForteNoPedido(pedido: string): UsoDaFoto | null {
  const p = String(pedido || "").toLowerCase();
  if (ROSTO_FORTE.test(p)) return "rosto";
  if (EXATA_FORTE.test(p)) return "exata";
  return null;
}

// ------------------------------------------------------------------ Jev

export interface PerguntaDoUso {
  type: "choice";
  instructions: unknown;
  criteria: Record<string, unknown>;
}

/**
 * Pergunta ao Jev (Choice) sobre o uso de UMA foto. O estado precisa ter o
 * pedido em `pedido`; `caminhoDaFoto` diz onde a foto está no estado (ex.:
 * "arquivos[0]") para a pergunta citar.
 */
export function perguntaDoUso(e: { caminhoDaFoto?: string; nome?: string; nenhum?: boolean } = {}): PerguntaDoUso {
  const alvo = e.caminhoDaFoto ? `a foto em \`${e.caminhoDaFoto}\`${e.nome ? ` ("${e.nome}")` : ""}` : "a foto com a pessoa";
  return {
    type: "choice",
    instructions: [
      `A equipe de uma agência pediu uma arte (texto em \`pedido\`). Pelo que o pedido diz, ${alvo} deve entrar na arte EXATAMENTE como está (a mesma foto, mesma pose e expressão, com o texto em volta), ou deve servir só como o ROSTO da pessoa, para o gerador criar uma cena nova com ela?`,
      "Pense no que a pessoa quer ver pronta: a própria foto dela com um título, ou a pessoa numa cena nova ligada ao tema.",
    ],
    criteria: {
      exata: {
        what: "Usar a própria foto como está: a pessoa quer aquela foto na arte, sem mudar pose, roupa ou fundo.",
        examples: ["coloca essa foto com o título", "usa a foto exatamente como está", "arte do palestrante com esta foto", "quero essa foto igual, só põe o texto", "põe a foto dele no post do evento"],
        not_for: "Pedidos que descrevem uma cena, uma pose, uma roupa ou uma ação nova para a pessoa.",
      },
      rosto: {
        what: "Usar só o rosto (a identidade) da pessoa: o gerador cria uma cena nova com ela, em outra pose, coerente com o tema.",
        examples: ["faz uma arte com ele falando sobre investimentos", "usa só o rosto dela, em outra pose", "coloca ele no palco apresentando o evento", "ela de jaleco explicando o tratamento", "cria uma cena dele na loja segurando o produto"],
        not_for: "Pedidos que querem a foto enviada como ela é.",
      },
      // Na conversa com o diretor a mensagem pode nem falar de como a foto entra.
      ...(e.nenhum
        ? {
          nenhum: {
            what: "A mensagem não fala de como a foto entra: pede outra coisa (trocar a foto por outra, cor, texto, logo, tamanho, cenário sem citar a pessoa).",
            examples: ["troca a foto pela segunda", "muda a cor do título", "tira o preço", "deixa a logo maior"],
          },
        }
        : {}),
    },
  };
}

export interface RespostaDoUso {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface DecisaoDoUso {
  uso: UsoDaFoto;
  por: QuemEscolheuOUso;
  confianca: number | null;
  /** O Jev ficou em dúvida e nenhuma regra decidiu: entrou exata; a equipe confere. */
  duvida: boolean;
}

/**
 * Decide o uso: o Jev com confiança mínima; abaixo dela (ou sem o Jev), a
 * regra de palavras; sem regra, exata (o de sempre) marcando a dúvida.
 */
export function decidirUso(resposta: RespostaDoUso | null | undefined, pedido: string): DecisaoDoUso {
  const doJev = resposta ? lerUso(resposta.choice) : null;
  const c = resposta && typeof resposta.confidence === "number" && isFinite(resposta.confidence) ? resposta.confidence : null;
  if (doJev && c !== null && c >= CONFIANCA_MINIMA_DO_USO) return { uso: doJev, por: "jev", confianca: c, duvida: false };
  const pelaRegra = usoPelaRegra(pedido);
  if (pelaRegra) return { uso: pelaRegra, por: "regra", confianca: c, duvida: false };
  return { uso: "exata", por: "regra", confianca: c, duvida: !!doJev };
}

// ------------------------------------------------------------------ geração

/** Rótulo da imagem de identidade no pedido ao gerador. */
export const ROTULO_DA_FOTO_DE_IDENTIDADE =
  "IDENTIDADE da pessoa (foto enviada pela equipe no modo Usar o rosto): mantenha os traços desta pessoa; não copie a pose, o ângulo, o enquadramento, o recorte, o fundo, a roupa nem a luz desta foto";

/**
 * Linhas extras do bloco do rosto no modo "Usar o rosto" (foto da lâmina):
 * a frase do dono, a cena pela direção e o que nunca vem da foto.
 */
export function linhasDaIdentidadeDaFoto(): string[] {
  return [
    `- USAR O ROSTO, NÃO A FOTO: ${FRASE_DA_IDENTIDADE}. A foto enviada é só a referência de identidade; nada dela é colado ou recortado para dentro da arte.`,
    "- Mesma pessoa: traços do rosto, tom de pele, cabelo, idade, e óculos, barba ou sinais marcantes quando houver.",
    "- A cena é NOVA e faz sentido com o tema, a campanha e a composição desta lâmina: pose, gesto, ângulo da cabeça, expressão, roupa (quando o tema pedir), luz e enquadramento vêm da direção de arte, nunca da foto. Nunca a mesma pose nem o mesmo recorte da foto.",
  ];
}

// ------------------------------------------------------------------ conferência

/**
 * Aviso de "foto colada" no modo rosto: a pose ficou idêntica à da foto
 * (leitura por visão) ou os pixels batem depois de alinhados (erro baixo,
 * medido em imagem-local). Só aviso: nada é refeito.
 */
export const LIMITE_POSE_COLADA = 16;

export function avisoDaPoseCopiada(e: { poseIgualNaLeitura: boolean | null; erroDoAlinhamento: number | null }): { aviso: boolean; texto: string | null } {
  const colada = e.erroDoAlinhamento != null && isFinite(e.erroDoAlinhamento) && e.erroDoAlinhamento <= LIMITE_POSE_COLADA;
  if (colada || e.poseIgualNaLeitura === true) {
    return { aviso: true, texto: "A pose ficou igual à da foto (parece a foto colada). No modo Usar o rosto a cena devia ser nova: gere de novo ou troque para Foto exata." };
  }
  return { aviso: false, texto: null };
}

// ------------------------------------------------------------------ conversa com o diretor

/**
 * Na conversa: a mensagem pede para trocar o uso da foto da lâmina em foco?
 * Vale o Jev com confiança mínima (e não "nenhum") ou as palavras fortes; o
 * uso de hoje igual ao pedido não muda nada. Devolve o uso novo ou null.
 */
export function usoPedidoNaConversa(e: { mensagem: string; usoAtual: UsoDaFoto | null; resposta: RespostaDoUso | null | undefined }): UsoDaFoto | null {
  if (!e.usoAtual) return null;
  const r = e.resposta;
  const c = r && typeof r.confidence === "number" && isFinite(r.confidence) ? r.confidence : null;
  const doJev = r ? lerUso(r.choice) : null;
  const jevDisseNenhum = !!r && r.choice === "nenhum" && c !== null && c >= CONFIANCA_MINIMA_DO_USO;
  const forte = usoForteNoPedido(e.mensagem);
  let pedido: UsoDaFoto | null = null;
  if (doJev && c !== null && c >= CONFIANCA_MINIMA_DO_USO) pedido = doJev;
  else if (!jevDisseNenhum && forte) pedido = forte;
  return pedido && pedido !== e.usoAtual ? pedido : null;
}

/** A mensagem pode falar do uso da foto (filtro barato antes de perguntar ao Jev). */
export function mensagemFalaDaFoto(mensagem: string): boolean {
  return /rosto|pose|foto|identidade|exatamente|igual/i.test(String(mensagem || ""));
}
