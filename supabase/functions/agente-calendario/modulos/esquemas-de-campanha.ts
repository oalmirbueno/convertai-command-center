/**
 * Esquemas de campanha por tipo (22/10/2026, dono: "se for Black, na pegada Black, esquema Black; e pra todas as
 * campanhas, seja Natal, promocional da empresa etc."). Cada ocasião tem o seu roteiro comercial: os marcos da
 * janela, o que cada fase faz, os ganchos que funcionam e o que evitar. Versionado aqui: quem cria, ajusta e
 * conversa com a campanha usa o esquema da ocasião (pelo nome, pelo pedido e pelo tipo). Puro.
 */

export const VERSAO_DOS_ESQUEMAS = "2026-10-22";

export interface EsquemaDeCampanha {
  id: string;
  rotulo: string;
  /** Palavras que reconhecem a ocasião no nome, no pedido ou no hype (minúsculas, sem acento). */
  palavras: string[];
  marcos: string[];
  fases: { aquecimento: string; lancamento: string; urgencia: string; encerramento: string };
  ganchos: string[];
  evitar: string[];
}

export const ESQUEMAS_DE_CAMPANHA: EsquemaDeCampanha[] = [
  {
    id: "black_friday",
    rotulo: "Black Friday",
    palavras: ["black friday", "black week", "black november", "black"],
    marcos: ["Pré-Black (lista de desejos e aviso)", "Contagem regressiva", "Black Friday (o dia)", "Black Week", "Cyber Monday", "Última chamada"],
    fases: {
      aquecimento: "Pré-Black: lista de desejos, aviso da oferta que vem e cadastro para quem quer ser avisado primeiro.",
      lancamento: "Black Friday: o preço que só existe na Black, com a oferta clara e o produto na frente.",
      urgencia: "Black Week: contagem regressiva, estoque e vagas acabando, Cyber Monday como segunda chance.",
      encerramento: "Última chamada: o preço some à meia-noite.",
    },
    ganchos: ["Preço que só existe na Black", "Faltam X dias", "Lista de desejos liberada", "Cyber Monday: segunda chance", "Acaba à meia-noite"],
    evitar: ["Desconto falso (preço inflado antes)", "Oferta sem prazo", "Post só com 'Black Friday' sem produto"],
  },
  {
    id: "natal",
    rotulo: "Natal",
    palavras: ["natal", "natalin", "fim de ano", "papai noel"],
    marcos: ["Lista de presentes", "Guia de presentes por perfil", "Último dia para entrega antes do Natal", "Véspera", "Pós-Natal (troca e virada)"],
    fases: {
      aquecimento: "Guia de presentes: um presente para cada perfil, com preço e onde garantir.",
      lancamento: "Oferta de Natal: kit ou combo presenteável, embalagem e entrega no prazo.",
      urgencia: "Último dia para garantir a entrega antes do Natal.",
      encerramento: "Véspera e última chamada; depois, a virada do ano.",
    },
    ganchos: ["Presente certo para quem", "Chega antes do Natal", "Kit pronto para presentear", "Último dia para entrega"],
    evitar: ["Mensagem só de boas festas sem oferta", "Prazo de entrega impossível"],
  },
  {
    id: "halloween",
    rotulo: "Halloween",
    palavras: ["halloween", "dia das bruxas", "bruxa"],
    marcos: ["Aviso assustador", "Oferta do Halloween", "Últimas horas (31/10)"],
    fases: {
      aquecimento: "O problema do cliente vira o monstro (o PC assombrado, a pele sem vida...): curiosidade com a oferta anunciada.",
      lancamento: "A poção, o elixir ou o exorcismo: a solução com preço e prazo.",
      urgencia: "A meia-noite do dia 31: a oferta some como fantasma.",
      encerramento: "Última chamada antes de a magia acabar.",
    },
    ganchos: ["Seu X está assombrado?", "Exorcismo de Y por R$ Z", "Poção anti-W até 31/10"],
    evitar: ["Conteúdo só de curiosidade sobre a data", "Susto sem oferta"],
  },
  {
    id: "maes_pais_criancas",
    rotulo: "Dia das Mães, dos Pais ou das Crianças",
    palavras: ["dia das maes", "dia dos pais", "dia das criancas"],
    marcos: ["Ideias de presente", "Oferta da data", "Último dia para entrega", "Véspera"],
    fases: {
      aquecimento: "Ideias de presente para o perfil de quem recebe, com preço.",
      lancamento: "Oferta ou kit da data, pronto para presentear.",
      urgencia: "Último dia para garantir a entrega.",
      encerramento: "Véspera: compra rápida, retirada ou presente digital.",
    },
    ganchos: ["O presente que ela vai usar", "Chega antes do domingo", "Kit pronto"],
    evitar: ["Homenagem genérica sem produto"],
  },
  {
    id: "aniversario_da_empresa",
    rotulo: "Aniversário da empresa",
    palavras: ["aniversario", " anos de ", " anos da "],
    marcos: ["Anúncio do aniversário", "Oferta de aniversário", "Sorteio ou presente para cliente", "Última chamada"],
    fases: {
      aquecimento: "A história em uma frase e o presente que vem para o cliente.",
      lancamento: "Oferta de aniversário com número da idade (ex.: X% no X aniversário).",
      urgencia: "Só durante a semana do aniversário.",
      encerramento: "Última chamada e agradecimento com o próximo passo.",
    },
    ganchos: ["X anos, X% para você", "Quem faz a festa é você", "Só nesta semana"],
    evitar: ["Só agradecer sem oferta", "Linha do tempo longa sem CTA"],
  },
  {
    id: "promocional",
    rotulo: "Promoção da empresa",
    palavras: ["promo", "promocao", "liquida", "queima", "saldao", "oferta", "desconto", "cupom"],
    marcos: ["Anúncio da promoção", "Oferta aberta", "Estoque ou vagas acabando", "Último dia"],
    fases: {
      aquecimento: "O problema do cliente e o aviso da oferta que vem (data marcada).",
      lancamento: "Oferta clara: o que, quanto, até quando e como garantir.",
      urgencia: "Escassez real: vagas, estoque ou prazo.",
      encerramento: "Último dia, última chamada.",
    },
    ganchos: ["Só até dia X", "Últimas unidades", "Garanta o seu pelo WhatsApp"],
    evitar: ["Oferta sem prazo", "Desconto que não existe"],
  },
  {
    id: "lancamento",
    rotulo: "Lançamento",
    palavras: ["lancamento", "lancar", "novidade", "chegou", "estreia"],
    marcos: ["Teaser", "Revelação", "Condição de lançamento", "Fim da condição de lançamento"],
    fases: {
      aquecimento: "Teaser: o problema e o que vem para resolver, sem revelar tudo.",
      lancamento: "Revelação do produto com a condição de lançamento.",
      urgencia: "A condição de lançamento acaba (primeiros clientes, vagas, prazo).",
      encerramento: "Última chamada da condição de lançamento.",
    },
    ganchos: ["Vem aí", "Chegou: o novo X", "Condição de lançamento só para os primeiros"],
    evitar: ["Revelar sem condição especial", "Só falar do produto sem o problema do cliente"],
  },
  {
    id: "data_comemorativa",
    rotulo: "Data comemorativa",
    palavras: ["dia do", "dia da", "dia de", "semana do", "semana da"],
    marcos: ["Aviso da data", "Oferta da data", "Último dia"],
    fases: {
      aquecimento: "A data como gancho do problema do cliente, com a oferta anunciada.",
      lancamento: "Oferta da data, clara.",
      urgencia: "Só até a data.",
      encerramento: "Última chamada.",
    },
    ganchos: ["No dia X, Y para você", "Só até a data"],
    evitar: ["Post só de homenagem"],
  },
  {
    id: "institucional",
    rotulo: "Institucional",
    palavras: ["institucional", "marca", "valores", "manifesto"],
    marcos: ["Manifesto", "Prova (cliente real, bastidor)", "Convite"],
    fases: {
      aquecimento: "O que a marca acredita, ligado ao problema do cliente.",
      lancamento: "Prova real: cliente, bastidor, número.",
      urgencia: "Convite com prazo leve (agenda aberta, evento).",
      encerramento: "Convite final para conhecer ou conversar.",
    },
    ganchos: ["Por que fazemos assim", "Quem já viveu isso"],
    evitar: ["Texto longo sem convite"],
  },
];

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O esquema da campanha pela ocasião (nome, pedido, hype) e, sem achar, pelo tipo; padrão: promoção. */
export function esquemaDaCampanha(texto: string, tipo?: string | null): EsquemaDeCampanha {
  const t = ` ${semAcento(texto || "")} `;
  // As ocasiões com nome próprio vêm antes das genéricas (promoção, data comemorativa).
  for (const e of ESQUEMAS_DE_CAMPANHA) {
    if (e.id === "promocional" || e.id === "data_comemorativa" || e.id === "institucional" || e.id === "lancamento") continue;
    if (e.palavras.some((p) => t.indexOf(p) >= 0)) return e;
  }
  const porTipo: Record<string, string> = { lancamento: "lancamento", data_comemorativa: "data_comemorativa", institucional: "institucional", promocao: "promocional", sazonal: "promocional", evento: "promocional", prova_social: "promocional" };
  if (tipo && porTipo[tipo]) return ESQUEMAS_DE_CAMPANHA.filter((e) => e.id === porTipo[tipo])[0];
  for (const id of ["lancamento", "promocional", "data_comemorativa", "institucional"]) {
    const e = ESQUEMAS_DE_CAMPANHA.filter((x) => x.id === id)[0];
    if (e.palavras.some((p) => t.indexOf(p) >= 0)) return e;
  }
  return ESQUEMAS_DE_CAMPANHA.filter((e) => e.id === "promocional")[0];
}

/** O bloco do esquema no prompt (o agente usa o esquema da ocasião). */
export function blocoDoEsquema(e: EsquemaDeCampanha): string {
  return [
    `ESQUEMA DA CAMPANHA (${e.rotulo}, versão ${VERSAO_DOS_ESQUEMAS}): siga os marcos e o que cada fase faz.`,
    `- Marcos: ${e.marcos.join("; ")}.`,
    `- Aquecimento: ${e.fases.aquecimento}`,
    `- Lançamento: ${e.fases.lancamento}`,
    `- Urgência: ${e.fases.urgencia}`,
    `- Encerramento: ${e.fases.encerramento}`,
    `- Ganchos que funcionam (adapte ao cliente, sem copiar): ${e.ganchos.join("; ")}.`,
    `- Evite: ${e.evitar.join("; ")}.`,
  ].join("\n");
}
