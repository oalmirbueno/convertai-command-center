/**
 * Story natural (22/10/2026). Pedido do dono, depois de ver a tela da Thainá
 * com "Quem mora com você conta?" em título de cartaz, serifa grande vermelha
 * sobre a foto: "a geração de imagens do story tem que ser mais realista, mais
 * natural de story, e não gerando imagem [de arte] ... simular já imagens de
 * fundo como se fosse natural, do momento cotidiano de story, humanizado".
 *
 * O caminho escolhido (o que fica mais real): o gerador da casa faz SÓ a foto
 * do momento, como se tirada no celular por alguém do perfil, sem nenhum texto
 * dentro; o texto do story é a camada de texto nativo do Instagram, desenhada
 * pelo código como o próprio app desenha (Clássico, Moderno, Máquina de
 * escrever, Forte, com caixa opcional). Texto que o gerador escreve na foto
 * sempre sai com cara de cartaz (foi o que o dono viu); o texto nativo é o
 * que um story de verdade tem. Nada de imagem colada por cima de outra.
 *
 * E a capa de destaque a partir de uma tela (estilo Destaque, designer), com
 * a imagem da tela como referência.
 *
 * Módulo puro: a função, a tela e o vitest leem o mesmo arquivo. Sem travessão.
 */

import { type EstiloDoTextoNativo, limpar, type PosicaoDoTexto } from "./regras-dos-stories.ts";

/** O momento do dia que cada papel pede (a cena da foto quando o roteiro não trouxe uma). */
export const MOMENTO_DO_PAPEL: Record<string, string> = {
  gancho: "um detalhe do momento que faz parar o dedo, visto de perto",
  problema_ou_desejo: "a situação do dia a dia do público, sem drama",
  prova: "o trabalho acontecendo de verdade, bastidor real",
  oferta: "o produto ou o atendimento no lugar de verdade",
  cta: "a pessoa do perfil no ambiente dela, à vontade, como quem convida",
  desenvolvimento: "a continuação do momento, outro ângulo do mesmo lugar",
  interacao: "um momento simples que puxa conversa",
  valor_ou_prova: "o detalhe do trabalho bem feito",
  convite: "o ambiente pronto para receber",
  gancho_de_amanha: "um pedaço do que vem amanhã, sem revelar",
};

/** O texto nativo que cada papel usa quando ninguém escolheu (como a equipe faria no app). */
export function textoNativoPadrao(papel: string | null | undefined, temAdesivo: boolean): { estilo_texto: EstiloDoTextoNativo; caixa: boolean; posicao: PosicaoDoTexto } {
  if (papel === "gancho") return { estilo_texto: "forte", caixa: false, posicao: "topo" };
  if (papel === "problema_ou_desejo") return { estilo_texto: "maquina", caixa: true, posicao: "topo" };
  if (papel === "oferta") return { estilo_texto: "classico", caixa: true, posicao: temAdesivo ? "topo" : "meio" };
  if (papel === "cta") return { estilo_texto: "classico", caixa: true, posicao: "topo" };
  return { estilo_texto: "moderno", caixa: false, posicao: temAdesivo ? "topo" : "meio" };
}

export const REGRA_DA_FOTO_NATURAL =
  "SEM NENHUM TEXTO na imagem: nada de letra, palavra, número, título, legenda, logo, marca d'água, moldura, cartaz ou interface de app. O texto do story entra depois, pela camada de texto do próprio Instagram.";

/**
 * O prompt da foto natural: um momento cotidiano do perfil, fotografado no
 * celular, vertical, com luz real e leve imperfeição; nada de anúncio, nada de
 * texto. Com fotos reais do cliente, elas valem como referência da pessoa e do
 * lugar (a foto nova é outra cena, nunca a mesma foto).
 */
export function promptDaFotoNatural(e: {
  cena?: string | null;
  papel?: string | null;
  texto?: string | null;
  negocio?: string | null;
  publico?: string | null;
  comReferencia: boolean;
  pedido?: string | null;
  /** O padrão da campanha no Natural: só o tom e a paleta (sem imagem de referência, sem forçar arte). */
  campanha?: { tom?: string | null; paleta?: string[]; tratamento?: string | null } | null;
}): string {
  const cores = e.campanha && e.campanha.paleta ? e.campanha.paleta.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4) : [];
  const cena = limpar(e.cena, 400) || `${MOMENTO_DO_PAPEL[String(e.papel || "")] || "um momento comum do dia de quem faz o perfil"}${e.texto ? `, combinando com a fala "${limpar(e.texto, 120)}"` : ""}`;
  return [
    "Foto vertical 9:16 de um story do Instagram, tirada com o celular na mão por alguém do próprio perfil, num momento real do dia.",
    `Cena: ${cena}.`,
    e.negocio ? `Quem é o perfil: ${limpar(e.negocio, 300)}. A cena é coerente com esse dia a dia (lugar, objetos, roupas e gente de verdade desse trabalho).` : "",
    e.publico ? `Para quem: ${limpar(e.publico, 200)}.` : "",
    "Jeito de foto de story: luz real do ambiente (janela, luminária, fim de tarde), enquadramento vertical de celular, um pouco fora do eixo, foco natural com leve granulado, cores sem tratamento pesado. Pessoas brasileiras comuns, roupa do dia, expressão natural, nada de pose de banco de imagem.",
    "Nada de cara de anúncio, estúdio, fundo infinito, produto flutuando, iluminação de catálogo ou composição de cartaz.",
    "Deixe o terço de cima mais calmo (parede, céu, mesa desfocada) para o texto do story ficar legível; nada importante nos 14% de cima nem nos 20% de baixo.",
    e.comReferencia ? "As fotos anexadas são do cliente de verdade: use como referência da pessoa e do ambiente (mesma pessoa, mesmo tipo de lugar), numa cena nova; não copie a foto e não cole nada dela." : "",
    e.pedido ? `Ajuste pedido pela equipe: ${limpar(e.pedido, 300)}.` : "",
    e.campanha && (e.campanha.tom || cores.length || e.campanha.tratamento)
      ? `Clima da campanha, só no tom da foto (sem virar arte nem anúncio): ${[e.campanha.tom ? `tom ${limpar(e.campanha.tom, 160)}` : "", cores.length ? `cores que aparecem naturalmente no ambiente (objeto, roupa, parede) perto de ${cores.join(", ")}` : "", e.campanha.tratamento ? `luz e cor ${limpar(e.campanha.tratamento, 160)}` : ""].filter(Boolean).join("; ")}.`
      : "",
    REGRA_DA_FOTO_NATURAL,
  ].filter(Boolean).join("\n");
}

/** A capa de destaque a partir de uma tela: estilo Destaque (designer), com a imagem da tela como referência. */
export function promptDaCapaDoStory(e: { nome: string; cena?: string | null; paleta: string[]; comSelo: boolean }): string {
  const cores = e.paleta.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4);
  return [
    `Capa de destaque do Instagram para o destaque "${limpar(e.nome, 15)}": um ícone ou ilustração simples, centralizado, que cabe no círculo do perfil.`,
    "Estilo Destaque (designer): forma limpa, traço ou volume simples, fundo liso ou degradê suave, muito respiro em volta; legível bem pequeno.",
    cores.length ? `Só as cores da marca: ${cores.join(", ")}.` : "Cores sóbrias e harmônicas.",
    `A imagem anexada é a tela do story que vira o destaque: tire dela o assunto${e.cena ? ` (${limpar(e.cena, 200)})` : ""} e transforme em ícone; não copie a foto nem recorte nada dela.`,
    e.comSelo ? "O selo da campanha anexado é referência de forma e cor; o ícone conversa com ele, sem colar." : "",
    "Sem texto, letra ou número na capa (o nome aparece embaixo, pelo Instagram). Quadrado 1:1.",
  ].filter(Boolean).join("\n");
}

/** Nome do destaque: até 15 caracteres (limite do Instagram). */
export function nomeDoDestaqueDoStory(v: unknown, reserva: string): string {
  const n = limpar(v, 40) || limpar(reserva, 40) || "Destaque";
  return n.slice(0, 15).trim() || "Destaque";
}
