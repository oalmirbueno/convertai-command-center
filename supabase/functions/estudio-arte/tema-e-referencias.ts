/**
 * Referência é estilo, o tema manda no conteúdo (29/10/2026).
 *
 * Pedido do dono: "quando eu mando uma referência ele tem que ler bem e entender que pode apagar aquele elemento
 * e trocar por um que faz sentido com o nicho, mesmo seguindo idêntico; tudo tem que estar dentro do tema do
 * conteúdo. A referência é o estilo, mas ele troca com base no conteúdo. A continuidade da capa tem que seguir o
 * mesmo tema, por mais que não repetido, e ambientar o carrossel até o fim. As fontes e a tipografia são as da
 * empresa adaptadas às da referência. Buscar elementos, objetos, logos reais e componentes da internet; nunca
 * copiar e colar, e sim adaptar. Ler a segunda referência e combinar, tirar o melhor das duas. O rosto fiel, mas
 * sem repetir o ângulo nem o estilo da foto: de lado se for de lado, só a cara se for só a cara."
 *
 * COMPLEMENTO dos blocos que já existem (nada deles muda):
 * - referencia-adapta-copy.ts troca o assunto da referência 1 quando o Jev diz que ele não serve à copy;
 *   aqui a regra vale para cada elemento, em qualquer fidelidade, e para todas as referências.
 * - promptDoReplicar (_shared/direcao-arte.ts) usa a referência 2 só como acabamento; aqui ela também pode dar
 *   os elementos de destaque, sem mexer na grade da referência 1.
 * - serie-da-capa.ts herda a identidade da capa e proíbe repetir a cena; aqui o MUNDO TEMÁTICO da capa continua.
 * - tipografia-do-cliente.ts fixa a família do kit; aqui a referência dá só o tratamento da letra.
 * - rosto-na-geracao.ts já diz que a pose segue a arte; aqui proíbe repetir o ângulo e escolhe o enquadramento
 *   pelo espaço do layout.
 *
 * Puro (sem Deno nem npm). Sem travessão. Sem lookbehind, propriedade Unicode ou grupo nomeado (Safari 11).
 */

const limpo = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** O tema do conteúdo, para os blocos: conceito e fio visual do trabalho. */
export function temaDoConteudo(direcao: { conceito?: unknown; fio_visual?: unknown } | null | undefined): string {
  if (!direcao) return "";
  return [limpo(direcao.conceito, 280), limpo(direcao.fio_visual, 200)].filter(Boolean).join(" / ");
}

/**
 * Cada elemento da referência que é do assunto DELA sai e entra um equivalente do tema e do nicho, na mesma
 * posição, escala e função. Vale em qualquer fidelidade (Idêntica é idêntica na estética, não no assunto).
 */
export function blocoDaTrocaPeloTema(e: { tema: string; cliente: string; temCopy: boolean }): string {
  if (!e.temCopy && !e.tema) return "";
  const tema = e.tema ? `o tema desta peça (${e.tema})` : "o tema do texto desta lâmina";
  return [
    "A REFERÊNCIA É O ESTILO; O CONTEÚDO É DO TEMA",
    `- Leia cada elemento da referência (objeto, produto, cenário, ícone, ilustração, foto, pessoa, interface). O que é do assunto DELA e não de ${tema} e do negócio de ${e.cliente || "este cliente"}: apague e troque por um equivalente do nicho, na mesma posição, escala, ângulo, luz e função na composição. O que já serve ao tema fica.`,
    "- FIDELIDADE À REFERÊNCIA: a composição, a grade, as proporções e a posição de cada bloco, a hierarquia, a paleta aplicada, a luz, o recorte, o ritmo e o acabamento ficam iguais aos dela. Troque só o assunto que não é do tema, no mesmo lugar, no mesmo tamanho e na mesma forma; o resto da peça continua a referência.",
    "- A NAVEGAÇÃO DO CARROSSEL não é elemento da referência e nunca sai: o indicador de arrastar para o lado na capa e no meio (e os ícones da última) fica sempre, como pede o bloco de navegação.",
    "- Prefira elementos REAIS e reconhecíveis do nicho: produtos, objetos, materiais e ambientes de verdade, e componentes reais da internet (botões, cards, notificações, telas de app, gráficos) recriados com os rótulos do conteúdo. Marca real só quando o conteúdo cita: a logo dela entra pelo anexo, nunca desenhada de memória.",
    "- Nunca copie e cole a referência nem pedaços dela: adapte. O resultado tem a mesma qualidade e a mesma pegada, com tudo dentro do tema.",
  ].join("\n");
}

/**
 * Duas ou mais referências: combinar, tirando o melhor de cada uma. A grade continua a da referência 1 (o
 * promptDoReplicar manda nisso); a 2 em diante entra com os elementos de destaque, não só com o acabamento.
 */
export function blocoDaCombinacao(e: { indices: number[] }): string {
  const idx = (e.indices || []).filter((n) => Number.isFinite(n) && n > 0);
  if (idx.length < 2) return "";
  const [primeira, ...outras] = idx;
  const nomes = outras.map((n) => `imagem ${n}`).join(" e ");
  return [
    `COMBINE AS REFERÊNCIAS (imagem ${primeira} e ${nomes}): leia todas, não só a primeira.`,
    `- A estrutura (grade, posição e escala dos blocos, hierarquia) é a da imagem ${primeira}.`,
    `- Da ${nomes} venha também o que for melhor que a primeira: o tratamento do título (recorte, contorno, sombra, ênfase), molduras, selos, ícones, componentes, o jeito de compor o objeto ou a pessoa, a textura e a luz. Escolha peça por peça a melhor solução das duas, sem quebrar a estrutura.`,
    `- O resultado continua com a cara da imagem ${primeira} (fiel a ela), melhorado com o melhor das outras, no mesmo nível de acabamento e tudo dentro do tema.`,
  ].join("\n");
}

/** A letra: família do kit da empresa, tratamento da referência. */
export const LINHA_DO_TRATAMENTO_DA_LETRA =
  "LETRA: a família é sempre a da empresa (bloco de tipografia). Da referência vem só o TRATAMENTO, adaptado a essa família: peso relativo, caixa alta ou baixa, compressão, entrelinha, espaçamento, contraste entre título e apoio, palavra de ênfase, posição e alinhamento. Nunca troque a fonte da empresa pela da referência.";

/**
 * Lâmina 2 em diante: o mundo temático aberto pela capa continua até o fim, com elementos novos. Não repete a
 * cena da capa (regra da série que já existe); muda o objeto, o canto do ambiente, o detalhe.
 */
export function linhaDoMundoTematico(e: { ordem: number; total: number; tema: string }): string {
  if (e.total < 2 || e.ordem < 2) return "";
  const tema = e.tema ? ` (${e.tema})` : "";
  const final = e.ordem === e.total;
  return [
    `MUNDO TEMÁTICO DA SÉRIE (lâmina ${e.ordem} de ${e.total}): a capa abriu um tema${tema} e esta lâmina continua dentro dele.`,
    "- O mesmo ambiente ou a mesma família de cenários, a mesma época e clima, a mesma luz e o mesmo tipo de objeto do tema, ambientados a partir da capa. Com elementos NOVOS: outro objeto, outro canto do ambiente, outro detalhe que mostra o que o texto desta lâmina diz.",
    "- Nada de lâmina genérica fora do tema, e nada repetido da capa.",
    final ? "- Fechamento: termine o tema, ainda dentro do mesmo mundo, com o CTA em destaque." : "",
  ].filter(Boolean).join("\n");
}

/** Rosto: nunca a mesma foto; o enquadramento sai do espaço que o layout dá à pessoa. */
export function linhasDoEnquadramentoDoRosto(comoPedido: boolean): string[] {
  return [
    "- CRIAÇÃO NOVA, NÃO A MESMA FOTO: nunca repita o ângulo, a pose, a expressão, o enquadramento, a roupa, o fundo, a luz nem o estilo (cor, filtro, grão) da foto enviada. Só o rosto é fiel.",
    comoPedido
      ? "- O enquadramento segue o COMO pedido pela equipe; dentro dele, ajuste ao espaço do layout."
      : "- ENQUADRAMENTO PELO ESPAÇO DO LAYOUT: área lateral ou estreita, de lado ou em três quartos, voltada para o texto; espaço central pequeno ou círculo, só o rosto em close; espaço alto e vertical, meio corpo ou corpo inteiro; faixa larga na base, busto. O layout manda, não a foto.",
  ];
}
