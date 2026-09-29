/**
 * Decupagem do briefing respondido (frente BRF, 30/09/2026).
 *
 * "Decupar" é grifar o que importa nas respostas: palavras-chave, dores,
 * público, restrições, referências, tom e objetivos. Isso alimenta a
 * proposta, a identidade, o site e o motion, e vira sugestão para o contexto
 * do cliente (com Confirmar e Desfazer).
 *
 * Divisão do trabalho (regra global: julgamento é do Jev, o resto é código):
 * - Regra fixa do modelo (sem julgamento): o campo que já diz a categoria
 *   (`decupa`) entra direto; referência, escala e escolha também.
 * - Jev, Choice: cada trecho de resposta aberta sem categoria recebe uma
 *   (ou "nenhuma"). O Jev escolhe, nunca escreve.
 * - Jev, Noul: cada termo candidato (achado no código, nas próprias
 *   respostas) é ou não palavra-chave da marca.
 * - Jev, Choice: o tom de voz entre uma lista fechada.
 * Tudo numa chamada só (as perguntas rodam em paralelo no Jev).
 *
 * Puro: sem Deno e sem npm. A tela e os testes (vitest) leem o mesmo
 * arquivo; o executor com banco e Jev mora em briefing-decupar.ts.
 */

import {
  type AnexoDoBriefing,
  type CategoriaDaDecupagem,
  type CampoDoBriefing,
  type ModeloDeBriefing,
  type Respostas,
  camposDoModelo,
  campoRespondido,
  campoVisivel,
  chaveDoOutro,
  referenciasValidas,
  textoDaResposta,
} from "./briefing-modelos.ts";

// ------------------------------------------------------------------ tipos

export type ItemDecupado = {
  id: string;
  categoria: CategoriaDaDecupagem;
  texto: string;
  /** Chave do campo de onde saiu. */
  campo: string;
  fonte: "regra" | "jev";
  confianca?: number | null;
};

export type Trecho = { id: string; campo: string; pergunta: string; texto: string };

export type EntradaDaDecupagem = {
  regra: ItemDecupado[];
  trechos: Trecho[];
  termos: string[];
};

export type Decupagem = {
  itens: ItemDecupado[];
  /** Tom escolhido pelo Jev (rótulo da lista TONS) ou null. */
  tom_de_voz: string | null;
  tom_confianca: number | null;
};

/** Pergunta no formato do Jev (mesmo contrato de _shared/jev.ts, sem importar Deno). */
export type PerguntaDaDecupagem =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };
export type RespostaDaDecupagem = { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number };

export const MAX_TRECHOS = 24;
export const MAX_TERMOS = 24;
export const MAX_PALAVRAS_CHAVE = 12;
const MIN_TRECHO = 12;
const MAX_TRECHO = 320;

export const ROTULO_DA_CATEGORIA_DECUPADA: Record<CategoriaDaDecupagem, string> = {
  palavra_chave: "Palavras-chave",
  dor: "Dores",
  publico: "Público",
  restricao: "Restrições",
  referencia: "Referências",
  tom: "Tom",
  objetivo: "Objetivos",
};

export const ORDEM_DAS_CATEGORIAS: CategoriaDaDecupagem[] = ["palavra_chave", "dor", "publico", "objetivo", "restricao", "referencia", "tom"];

/** Tons de voz possíveis (lista fechada para o Choice). */
export const TONS: Record<string, string> = {
  proximo: "Próximo e descontraído: conversa de igual para igual, leve, com humor na medida",
  direto: "Profissional e direto: claro, objetivo, confiável, sem enfeite",
  sofisticado: "Sofisticado e sóbrio: elegante, poucas palavras, sensação premium",
  didatico: "Técnico e didático: explica, ensina, mostra autoridade com clareza",
  inspirador: "Inspirador e enérgico: entusiasmo, movimento, convite à ação",
  acolhedor: "Acolhedor e cuidadoso: gentil, empático, transmite segurança",
};

export const ROTULO_DO_TOM: Record<string, string> = {
  proximo: "Próximo e descontraído",
  direto: "Profissional e direto",
  sofisticado: "Sofisticado e sóbrio",
  didatico: "Técnico e didático",
  inspirador: "Inspirador e enérgico",
  acolhedor: "Acolhedor e cuidadoso",
};

const CRITERIOS_DO_TRECHO: Record<string, string> = {
  dor: "Um problema, dificuldade, medo ou frustração do cliente final ou da empresa",
  publico: "Quem é o público: perfil, idade, região, comportamento ou necessidade",
  objetivo: "Um objetivo, meta ou resultado que a empresa quer alcançar",
  restricao: "Algo que a marca não quer, proíbe ou precisa evitar",
  tom: "Como a marca fala ou quer ser percebida: personalidade, estilo, atitude",
  palavra_chave: "Um diferencial, valor ou ideia central que define a marca ou a oferta",
  nenhum: "Informação de contexto (história, dado operacional, detalhe) que não entra em nenhuma das outras",
};

// ------------------------------------------------------------------ texto

const limpar = (s: string) => String(s || "").replace(/\s+/g, " ").trim();

/** Divide uma resposta longa em trechos (frases), sem cortar no meio da ideia. */
export function dividirEmTrechos(texto: string): string[] {
  const t = limpar(texto);
  if (!t) return [];
  const partes = t
    .split(/(?:[.!?;]+\s+|\n+|\s+-\s+)/)
    .map((p) => limpar(p).replace(/[.!?;]+$/, ""))
    .filter((p) => p.length >= MIN_TRECHO);
  const saida: string[] = [];
  partes.forEach((p) => {
    if (p.length <= MAX_TRECHO) saida.push(p);
    else saida.push(p.slice(0, MAX_TRECHO).replace(/\s+\S*$/, ""));
  });
  if (!saida.length && t.length >= 3) saida.push(t.slice(0, MAX_TRECHO));
  return saida;
}

const PARADAS = new Set((
  "a o as os um uma uns umas de da do das dos e ou que em no na nos nas para pra por com sem sobre entre mais menos muito muita muitos muitas " +
  "é ser são está estão foi era tem ter temos têm há isso isto esse essa esses essas este esta estes estas aquele aquela seu sua seus suas " +
  "meu minha meus minhas nosso nossa nossos nossas eles elas ele ela nós você vocês qual quais quando como onde porque pois também já ainda " +
  "cada todo toda todos todas outro outra outros outras mesmo mesma bem hoje sempre nunca aqui ali então assim até após desde dentro fora " +
  "empresa empresas cliente clientes pessoa pessoas coisa coisas forma vezes anos ano dia dias trabalho trabalhamos fazemos fazer faz feito " +
  "quero queremos precisa precisamos acho gostaria gosto algo alguma algum alguns algumas nada tudo cerca sobre através principal principais"
).split(/\s+/));

function normalizarTermo(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9áàâãéêíóôõúüç\- ]/gi, "").replace(/\s+/g, " ").trim();
}

/**
 * Termos candidatos a palavra-chave, achados no código nas próprias
 * respostas: palavras de 4 letras ou mais fora da lista de paradas e pares
 * de palavras que se repetem. O Jev só diz sim ou não para cada um.
 */
export function termosCandidatos(textos: string[], max = MAX_TERMOS): string[] {
  const conta = new Map<string, number>();
  const pares = new Map<string, number>();
  textos.forEach((texto) => {
    const palavras = limpar(texto).split(/[\s,.;:!?()"'/]+/).map(normalizarTermo).filter(Boolean);
    palavras.forEach((p, i) => {
      if (p.length >= 4 && !PARADAS.has(p) && !/^\d+$/.test(p)) conta.set(p, (conta.get(p) || 0) + 1);
      const q = palavras[i + 1];
      if (q && p.length >= 3 && q.length >= 3 && !PARADAS.has(p) && !PARADAS.has(q)) {
        const par = `${p} ${q}`;
        pares.set(par, (pares.get(par) || 0) + 1);
      }
    });
  });
  const lista: Array<[string, number]> = [];
  pares.forEach((n, t) => { if (n >= 2) lista.push([t, n + 0.5]); });
  conta.forEach((n, t) => lista.push([t, n]));
  lista.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1));
  const saida: string[] = [];
  for (const [t] of lista) {
    if (saida.length >= max) break;
    if (saida.some((s) => s === t || s.indexOf(`${t} `) === 0 || s.indexOf(` ${t}`) > 0)) continue;
    saida.push(t);
  }
  return saida;
}

// ------------------------------------------------------------------ entrada

let seq = 0;
const novoId = (p: string) => `${p}${++seq}`;

/**
 * Separa o que a regra do modelo já resolve do que vai para o Jev. Só
 * campos visíveis e respondidos entram.
 */
export function entradaDaDecupagem(modelo: ModeloDeBriefing, respostas: Respostas, anexos: AnexoDoBriefing[] = []): EntradaDaDecupagem {
  seq = 0;
  const regra: ItemDecupado[] = [];
  const trechos: Trecho[] = [];
  const textosParaTermos: string[] = [];
  const add = (categoria: CategoriaDaDecupagem, texto: string, campo: CampoDoBriefing) => {
    const t = limpar(texto).slice(0, MAX_TRECHO);
    if (!t) return;
    if (regra.some((r) => r.categoria === categoria && r.texto.toLowerCase() === t.toLowerCase())) return;
    regra.push({ id: novoId("r"), categoria, texto: t, campo: campo.key, fonte: "regra" });
  };

  camposDoModelo(modelo).forEach((c) => {
    if (!campoVisivel(c, respostas) || !campoRespondido(c, respostas, anexos)) return;
    const v = respostas[c.key];
    switch (c.tipo) {
      case "reference":
        referenciasValidas(v).forEach((r) => {
          const alvo = r.link || (anexos.find((a) => a.id === r.anexo_id)?.nome ?? "imagem anexada");
          add("referencia", r.nota ? `${alvo} (${limpar(r.nota)})` : alvo, c);
        });
        return;
      case "url":
        if (c.key === "concorrentes" || /concorr/i.test(c.pergunta)) {
          textoDaResposta(c, respostas, anexos).split(/,\s*/).forEach((u) => add("referencia", `Concorrente: ${u}`, c));
        }
        return;
      case "scale":
        add("tom", textoDaResposta(c, respostas, anexos), c);
        return;
      case "single-chip":
      case "multi-chip": {
        if (!c.decupa) return;
        const lista = Array.isArray(v) ? (v as unknown[]).map(String) : typeof v === "string" ? [v] : [];
        const outro = limpar(String(respostas[chaveDoOutro(c.key)] || ""));
        lista.filter((x) => x && x !== "Outro").forEach((x) => add(c.decupa as CategoriaDaDecupagem, x, c));
        if (outro) add(c.decupa, outro, c);
        return;
      }
      case "text":
      case "textarea": {
        const texto = typeof v === "string" ? v : "";
        textosParaTermos.push(texto);
        if (c.decupa === "palavra_chave" && c.tipo === "text") {
          texto.split(/[,;\n]+/).map(limpar).filter((x) => x.length >= 2).slice(0, 10).forEach((x) => add("palavra_chave", x, c));
          return;
        }
        if (c.decupa && c.decupa !== "palavra_chave") {
          dividirEmTrechos(texto).slice(0, 3).forEach((x) => add(c.decupa as CategoriaDaDecupagem, x, c));
          return;
        }
        // Sem categoria no modelo (ou palavra-chave em texto longo): o Jev escolhe trecho a trecho.
        dividirEmTrechos(texto).forEach((x) => {
          if (trechos.length < MAX_TRECHOS) trechos.push({ id: novoId("t"), campo: c.key, pergunta: c.pergunta, texto: x });
        });
        return;
      }
      case "confirm": {
        const texto = typeof v === "string" ? v : "";
        if (c.origem === "negocio" || c.origem === "oferta" || c.origem === "publico" || c.origem === "diferenciais") textosParaTermos.push(texto);
        return;
      }
      default:
        return;
    }
  });

  const termosDaRegra = new Set(regra.filter((r) => r.categoria === "palavra_chave").map((r) => r.texto.toLowerCase()));
  const termos = termosCandidatos(textosParaTermos).filter((t) => !termosDaRegra.has(t));
  return { regra, trechos, termos };
}

// ------------------------------------------------------------------ perguntas ao Jev

export type EstadoDaDecupagem = {
  briefing: { modelo: string; respostas: Array<{ pergunta: string; resposta: string }> };
  trechos: Array<{ pergunta: string; texto: string }>;
  termos: string[];
};

/** O estado que o Jev lê: o briefing em texto (curto) mais os trechos e termos. */
export function estadoDaDecupagem(modelo: ModeloDeBriefing, respostas: Respostas, entrada: EntradaDaDecupagem, anexos: AnexoDoBriefing[] = []): EstadoDaDecupagem {
  const lista: Array<{ pergunta: string; resposta: string }> = [];
  let total = 0;
  for (const c of camposDoModelo(modelo)) {
    if (!campoVisivel(c, respostas)) continue;
    const r = textoDaResposta(c, respostas, anexos).slice(0, 500);
    if (!r) continue;
    total += r.length;
    if (total > 9000) break;
    lista.push({ pergunta: c.pergunta, resposta: r });
  }
  return {
    briefing: { modelo: modelo.titulo, respostas: lista },
    trechos: entrada.trechos.map((t) => ({ pergunta: t.pergunta, texto: t.texto })),
    termos: entrada.termos,
  };
}

/** Perguntas da decupagem por id (t0..tN: trechos; k0..kN: termos; tom). */
export function perguntasDaDecupagem(entrada: EntradaDaDecupagem): Record<string, PerguntaDaDecupagem> {
  const q: Record<string, PerguntaDaDecupagem> = {};
  entrada.trechos.forEach((_, i) => {
    q[`t${i}`] = {
      type: "choice",
      instructions: `Na decupagem deste briefing de agência de marketing, em qual categoria entra o trecho \`trechos[${i}].texto\`, que responde à pergunta \`trechos[${i}].pergunta\`? Leve em conta o briefing inteiro em \`briefing\`.`,
      criteria: CRITERIOS_DO_TRECHO,
    };
  });
  entrada.termos.forEach((_, i) => {
    q[`k${i}`] = {
      type: "noul",
      instructions: `O termo \`termos[${i}]\` é uma palavra-chave que descreve bem esta marca, o que ela oferece ou o seu público, a ponto de valer usar em textos, anúncios e busca? Termos genéricos, que serviriam para qualquer empresa, não contam.`,
    };
  });
  if (entrada.trechos.length || entrada.termos.length) {
    q.tom = {
      type: "choice",
      instructions: "Pelo que o briefing em `briefing` mostra (personalidade, atributos, público e jeito de escrever), qual tom de voz combina melhor com esta marca?",
      criteria: TONS,
    };
  }
  return q;
}

/** Limiar de sim para palavra-chave e de confiança mínima para aceitar a categoria do trecho. */
export const LIMIAR_PALAVRA_CHAVE = 0.6;
export const LIMIAR_TRECHO = 0.4;

/** Junta a regra com as respostas do Jev (null: Jev indisponível, fica só a regra). */
export function lerDecupagem(entrada: EntradaDaDecupagem, respostas: Record<string, RespostaDaDecupagem> | null): Decupagem {
  const itens: ItemDecupado[] = entrada.regra.slice();
  if (respostas) {
    entrada.trechos.forEach((t, i) => {
      const r = respostas[`t${i}`];
      const escolha = r?.choice;
      if (!escolha || escolha === "nenhum" || !(escolha in CRITERIOS_DO_TRECHO)) return;
      const prob = typeof r?.probabilities?.[escolha] === "number" ? r.probabilities[escolha] : typeof r?.confidence === "number" ? r.confidence : 1;
      if (prob < LIMIAR_TRECHO) return;
      itens.push({ id: t.id, categoria: escolha as CategoriaDaDecupagem, texto: t.texto, campo: t.campo, fonte: "jev", confianca: arred(prob) });
    });
    const escolhidos = entrada.termos
      .map((t, i) => ({ t, p: typeof respostas[`k${i}`]?.noul === "number" ? (respostas[`k${i}`].noul as number) : 0 }))
      .filter((x) => x.p >= LIMIAR_PALAVRA_CHAVE)
      .sort((a, b) => b.p - a.p);
    const jaTem = new Set(itens.filter((x) => x.categoria === "palavra_chave").map((x) => x.texto.toLowerCase()));
    escolhidos.forEach((x, i) => {
      if (jaTem.has(x.t) || itens.filter((y) => y.categoria === "palavra_chave").length >= MAX_PALAVRAS_CHAVE) return;
      itens.push({ id: `k${i + 1}`, categoria: "palavra_chave", texto: x.t, campo: "", fonte: "jev", confianca: arred(x.p) });
    });
  }
  const tom = respostas?.tom?.choice && ROTULO_DO_TOM[respostas.tom.choice] ? ROTULO_DO_TOM[respostas.tom.choice] : null;
  const tomConf = tom && typeof respostas?.tom?.confidence === "number" ? arred(respostas.tom.confidence) : null;
  return { itens, tom_de_voz: tom, tom_confianca: tomConf };
}

const arred = (n: number) => Math.round(n * 100) / 100;

/** Agrupa por categoria, na ordem de leitura. */
export function porCategoria(itens: ItemDecupado[]): Array<{ categoria: CategoriaDaDecupagem; rotulo: string; itens: ItemDecupado[] }> {
  return ORDEM_DAS_CATEGORIAS
    .map((cat) => ({ categoria: cat, rotulo: ROTULO_DA_CATEGORIA_DECUPADA[cat], itens: itens.filter((i) => i.categoria === cat) }))
    .filter((g) => g.itens.length > 0);
}

// ------------------------------------------------------------------ sugestões para o contexto

export type CampoSugerido = "negocio" | "publico" | "oferta" | "diferenciais" | "tom_de_voz" | "decupagem_do_briefing";

export type SugestaoDoContexto = {
  id: string;
  campo: CampoSugerido;
  rotulo: string;
  valor: unknown;
  antes: unknown;
  /** preencher: estava vazio; juntar: soma à lista; substituir: troca o que havia. */
  modo: "preencher" | "juntar" | "substituir";
  /** Vem marcada na tela (preencher e juntar sim; substituir não). */
  padrao: boolean;
};

export const ROTULO_DO_CAMPO_SUGERIDO: Record<CampoSugerido, string> = {
  negocio: "Negócio",
  publico: "Público",
  oferta: "Oferta",
  diferenciais: "Diferenciais",
  tom_de_voz: "Tom de voz",
  decupagem_do_briefing: "Pontos do briefing",
};

const vazio = (v: unknown): boolean =>
  v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * O que a decupagem sugere gravar no contexto (do cliente ou da marca).
 * Campos de texto vêm das respostas dos campos que os alimentam (regra do
 * modelo); a lista de diferenciais soma sem repetir; os pontos decupados vão
 * num campo próprio (decupagem_do_briefing) para não misturar com o resto.
 */
export function sugestoesParaOContexto(p: {
  modelo: ModeloDeBriefing;
  respostas: Respostas;
  decupagem: Decupagem;
  contexto: Record<string, unknown>;
  briefingId: string;
  recebidoEm?: string | null;
  anexos?: AnexoDoBriefing[];
}): SugestaoDoContexto[] {
  const { modelo, respostas, decupagem, contexto } = p;
  const saida: SugestaoDoContexto[] = [];
  const doCampo = (alvo: string) =>
    camposDoModelo(modelo)
      .filter((c) => c.alimenta === alvo && campoVisivel(c, respostas))
      .map((c) => textoDaResposta(c, respostas, p.anexos || []))
      .filter(Boolean)
      .join(" ")
      .slice(0, 1500);

  const texto = (campo: "negocio" | "publico" | "oferta", valor: string) => {
    const v = limpar(valor);
    if (!v) return;
    const antes = contexto[campo];
    if (typeof antes === "string" && limpar(antes) === v) return;
    const modo = vazio(antes) ? "preencher" : "substituir";
    saida.push({ id: campo, campo, rotulo: ROTULO_DO_CAMPO_SUGERIDO[campo], valor: v, antes: antes ?? null, modo, padrao: modo === "preencher" });
  };
  texto("negocio", doCampo("negocio"));
  texto("publico", doCampo("publico"));
  texto("oferta", doCampo("oferta"));

  const difTexto = doCampo("diferenciais");
  if (difTexto) {
    const antes = Array.isArray(contexto.diferenciais) ? (contexto.diferenciais as unknown[]).map(String) : [];
    const novos = dividirEmTrechos(difTexto.replace(/,\s+/g, ". ")).slice(0, 8);
    const soma = antes.slice();
    novos.forEach((n) => { if (!soma.some((a) => a.toLowerCase() === n.toLowerCase())) soma.push(n); });
    if (soma.length > antes.length) {
      saida.push({ id: "diferenciais", campo: "diferenciais", rotulo: ROTULO_DO_CAMPO_SUGERIDO.diferenciais, valor: soma, antes: antes.length ? antes : null, modo: antes.length ? "juntar" : "preencher", padrao: true });
    }
  }

  if (decupagem.tom_de_voz) {
    const atributos = decupagem.itens.filter((i) => i.categoria === "tom" && i.fonte === "regra" && i.campo === "atributos").map((i) => i.texto.toLowerCase());
    const tom = atributos.length ? `${decupagem.tom_de_voz}. Atributos: ${atributos.join(", ")}.` : `${decupagem.tom_de_voz}.`;
    const antes = contexto.tom_de_voz;
    if (!(typeof antes === "string" && limpar(antes) === tom)) {
      const modo = vazio(antes) ? "preencher" : "substituir";
      saida.push({ id: "tom_de_voz", campo: "tom_de_voz", rotulo: ROTULO_DO_CAMPO_SUGERIDO.tom_de_voz, valor: tom, antes: antes ?? null, modo, padrao: modo === "preencher" });
    }
  }

  const grupo = (cat: CategoriaDaDecupagem) => decupagem.itens.filter((i) => i.categoria === cat).map((i) => i.texto);
  const pontos = {
    briefing_id: p.briefingId,
    modelo: modelo.slug,
    recebido_em: p.recebidoEm ?? null,
    palavras_chave: grupo("palavra_chave"),
    dores: grupo("dor"),
    publico: grupo("publico"),
    objetivos: grupo("objetivo"),
    restricoes: grupo("restricao"),
    referencias: grupo("referencia"),
    tom: grupo("tom"),
  };
  const temPontos = [pontos.palavras_chave, pontos.dores, pontos.publico, pontos.objetivos, pontos.restricoes, pontos.referencias, pontos.tom].some((l) => l.length > 0);
  if (temPontos) {
    const antes = contexto.decupagem_do_briefing;
    saida.push({ id: "decupagem_do_briefing", campo: "decupagem_do_briefing", rotulo: ROTULO_DO_CAMPO_SUGERIDO.decupagem_do_briefing, valor: pontos, antes: antes ?? null, modo: vazio(antes) ? "preencher" : "substituir", padrao: true });
  }
  return saida;
}

export type Aplicada = { campo: CampoSugerido; antes: unknown; depois: unknown };

/** Aplica as sugestões escolhidas no contexto. Devolve o novo e o que precisa para Desfazer. */
export function aplicarNoContexto(contexto: Record<string, unknown>, sugestoes: SugestaoDoContexto[]): { novo: Record<string, unknown>; aplicadas: Aplicada[] } {
  const novo: Record<string, unknown> = { ...contexto };
  const aplicadas: Aplicada[] = [];
  sugestoes.forEach((s) => {
    const antes = contexto[s.campo] ?? null;
    novo[s.campo] = s.valor;
    aplicadas.push({ campo: s.campo, antes, depois: s.valor });
  });
  return { novo, aplicadas };
}

/**
 * Desfaz o que foi aplicado, campo a campo: só volta o campo que ainda está
 * como ficou (se alguém mudou depois, fica, com o motivo).
 */
export function desfazerNoContexto(atual: Record<string, unknown>, aplicadas: Aplicada[]): { novo: Record<string, unknown>; voltaram: CampoSugerido[]; mantidos: Array<{ campo: CampoSugerido; motivo: string }> } {
  const novo: Record<string, unknown> = { ...atual };
  const voltaram: CampoSugerido[] = [];
  const mantidos: Array<{ campo: CampoSugerido; motivo: string }> = [];
  aplicadas.forEach((a) => {
    if (!igual(atual[a.campo], a.depois)) {
      mantidos.push({ campo: a.campo, motivo: "Mudou depois da confirmação; ficou como está." });
      return;
    }
    if (a.antes == null) delete novo[a.campo];
    else novo[a.campo] = a.antes;
    voltaram.push(a.campo);
  });
  return { novo, voltaram, mantidos };
}
