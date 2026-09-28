/**
 * Pedido de trocar um conteúdo que já está na agenda (frente AM, 28/09).
 *
 * O caso real (Mirante Luz Floripa, conversa fa6a5bab, 28/09 13:54 a 14:14):
 * o dono pediu seis vezes, no modo "Criar conteúdos", "mude os temas dos
 * conteúdos que falam de quartos", "mude todos esses também", "corrija".
 * Nenhuma dessas frases casava com a lista de palavras da tela
 * (ehPedidoNaAgenda), então todas foram para o pedido livre, que só sabe
 * CRIAR: nasceram 15 pautas novas, nenhuma peça mudou, o agente repetiu "não é
 * uma atualização feita no painel" e a memória editorial marcou as novas como
 * "parece repetir um post já feito" (a pauta nova parecia a velha porque era a
 * substituta dela). O duplicado era efeito, não motivo.
 *
 * O que este módulo faz (puro, sem Deno nem banco, testado no Vitest):
 * - roteamento: o Jev (Choice) diz se a mensagem pede para MUDAR conteúdos
 *   gravados ou para CRIAR novos; mudar vai para o agente que planeja o mês,
 *   que tem editar_textos, refazer, datas e formatos com Confirmar e Desfazer;
 * - peça citada: o código pré-seleciona candidatas (aspas, título contido na
 *   mensagem, palavras em comum com título e roteiro) e o Jev escolhe qual a
 *   mensagem cita, com "várias" e "nenhuma" como saída;
 * - duas parecidas (título igual, ou o Jev dividido entre duas): o cartão
 *   pergunta "Qual delas?" com as opções, como na Mesa Ads; um clique escolhe
 *   e só essa muda;
 * - duplicado vira aviso no cartão, nunca motivo para não fazer.
 */
import type { PerguntaJev, RespostaJev } from "../_shared/jev.ts";
import type { AcaoNaAgenda, ItemDaAcao, PecaComApelido } from "./acoes-agenda.ts";
import { nomeDoFormato } from "./acoes-agenda.ts";

/** Minúsculas, sem acento, aspas retas, pontuação vira espaço. */
export function normalizarTexto(t: unknown): string {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[“”«»"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9"' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Título sem o rótulo de formato que algumas peças antigas levam ("Carrossel | ..."). */
export function tituloBase(t: unknown): string {
  const cru = String(t ?? "").replace(/^\s*(carrossel|carousel|est[áa]tico|static|reels?|story|v[íi]deo|post)\s*\|\s*/i, "");
  return normalizarTexto(cru).replace(/["']/g, "").trim();
}

/** Trechos entre aspas (retas, curvas ou simples), na ordem em que aparecem. */
export function trechosEntreAspas(mensagem: string): string[] {
  const saida: string[] = [];
  const re = /"([^"]{3,260})"|“([^”]{3,260})”|'([^']{3,260})'|‘([^’]{3,260})’/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(mensagem || "")))) {
    const t = (m[1] || m[2] || m[3] || m[4] || "").trim();
    if (t) saida.push(t);
  }
  return saida;
}

const VAZIAS = new Set(
  ("a o as os um uma uns umas de da do das dos em no na nos nas por para pra pro com sem que se e ou mas mais menos muito muita " +
    "este esta esse essa isso isto aquele aquela eles elas ele ela voce voces seu sua seus suas meu minha nosso nossa " +
    "conteudo conteudos post posts pauta pautas peca pecas carrossel carrosseis arte artes agenda calendario tema temas " +
    "quero queria gostaria mude mudar muda troque trocar troca corrija corrigir altere alterar atualize atualizar faca fazer " +
    "todos todas tudo tambem ainda aqui ali la ja nao sim ta esta estao fala falam falando sobre como qual quais dia hoje")
    .split(" "),
);

/** Palavras de conteúdo, no singular simples ("quartos" casa com "Quarto 06"). */
function palavras(t: unknown): string[] {
  return normalizarTexto(t)
    .replace(/["']/g, " ")
    .split(" ")
    .filter((p) => (p.length >= 3 || /^[0-9]{2,}$/.test(p)) && !VAZIAS.has(p))
    .map((p) => (p.length > 4 && p.endsWith("s") ? p.slice(0, -1) : p));
}

export type PecaCandidata = PecaComApelido & { pontos: number };

/** Máximo de títulos que vão ao Jev como opção (as peças iguais a um título vão juntas, numa opção só). */
export const MAX_CANDIDATAS = 8;

/**
 * Pré-seleção em código das peças que a mensagem pode estar citando. Trecho
 * entre aspas contido no título ou no roteiro vale mais; depois, o título
 * inteiro dentro da mensagem; depois, palavras em comum. Peças de título igual
 * a uma candidata entram juntas (é assim que o "Qual delas?" aparece).
 */
export function candidatasDoPedido(mensagem: string, pecas: PecaComApelido[], max = MAX_CANDIDATAS): PecaCandidata[] {
  const msg = normalizarTexto(mensagem).replace(/["']/g, "");
  const aspas = trechosEntreAspas(mensagem).map((t) => normalizarTexto(t).replace(/["']/g, "")).filter((t) => t.length >= 3);
  const doPedido = new Set(palavras(mensagem));
  const pontuadas: PecaCandidata[] = [];
  for (const p of pecas) {
    const base = tituloBase(p.title);
    const detalhe = normalizarTexto(p.detalhe || "").replace(/["']/g, "");
    let pontos = 0;
    for (const a of aspas) {
      if (base && (base.includes(a) || (a.length >= 12 && a.includes(base)))) pontos += 100;
      else if (detalhe && detalhe.includes(a)) pontos += 60;
    }
    if (base.length >= 12 && msg.includes(base)) pontos += 80;
    const doTitulo = palavras(p.title);
    if (doTitulo.length && doPedido.size) {
      const comuns = doTitulo.filter((w) => doPedido.has(w)).length;
      pontos += (comuns / doTitulo.length) * 10 + comuns;
    }
    if (detalhe && doPedido.size) {
      const doDetalhe = new Set(palavras(detalhe));
      let comuns = 0;
      for (const w of doPedido) if (doDetalhe.has(w)) comuns++;
      pontos += Math.min(4, comuns * 0.5);
    }
    if (pontos > 0) pontuadas.push({ ...p, pontos });
  }
  pontuadas.sort((a, b) => b.pontos - a.pontos || String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")));
  const escolhidas: PecaCandidata[] = [];
  const vistas = new Set<string>();
  const grupos = gruposDeIguais(pecas);
  let titulos = 0;
  for (const c of pontuadas) {
    // O teto conta títulos (uma opção do Jev cada), não cópias: a agenda tem peças repetidas 4 vezes.
    if (titulos >= max) break;
    if (vistas.has(c.id)) continue;
    titulos++;
    const iguais = grupos.get(tituloBase(c.title)) || [c];
    for (const g of iguais) {
      if (vistas.has(g.id)) continue;
      vistas.add(g.id);
      escolhidas.push({ ...g, pontos: c.pontos });
    }
  }
  return escolhidas;
}

/** Peças de título igual (sem o rótulo de formato), por título. */
export function gruposDeIguais(pecas: PecaComApelido[]): Map<string, PecaComApelido[]> {
  const m = new Map<string, PecaComApelido[]>();
  for (const p of pecas) {
    const k = tituloBase(p.title);
    if (!k) continue;
    const l = m.get(k) || [];
    l.push(p);
    m.set(k, l);
  }
  return m;
}

/** As outras peças de mesmo título na agenda (vazio quando é única). */
export function iguaisA(peca: { id: string; title: string }, pecas: PecaComApelido[]): PecaComApelido[] {
  const k = tituloBase(peca.title);
  return k ? pecas.filter((p) => p.id !== peca.id && tituloBase(p.title) === k) : [];
}

// ------------------------------------------------------------ perguntas ao Jev

export const INTENCAO = {
  mudar_existente:
    "A equipe pede para mexer em conteúdos que JÁ ESTÃO na agenda: mudar, trocar, substituir, corrigir, reescrever, atualizar, revisar, refazer, apagar ou mudar data ou formato de peças gravadas (inclusive 'mude os que falam de X', 'troque esse post', 'atualize todos os conteúdos', 'estão repetidos, corrija').",
  criar_novo:
    "A equipe pede conteúdos NOVOS para acrescentar à agenda (um post para hoje, 3 conteúdos para uma campanha, uma arte com estes prints), sem mexer nos que já existem.",
  outro: "Pergunta ou conversa que não pede nem mexer em conteúdos gravados nem criar conteúdos novos.",
} as const;

export type Intencao = keyof typeof INTENCAO;

/** Probabilidade mínima de "mudar_existente" para o pedido ir ao agente que mexe na agenda. */
export const LIMIAR_DE_MUDAR = 0.5;
/** Probabilidade mínima para a peça escolhida pelo Jev valer sozinha. */
export const LIMIAR_DO_ALVO = 0.55;
/** Segunda opção com pelo menos esta probabilidade entra no "Qual delas?". */
export const LIMIAR_DA_PARECIDA = 0.2;
/** Quando o Jev diz que a mensagem não aponta uma peça só (alvo_claro < 0,5), a segunda opção entra com menos. */
export const LIMIAR_DA_PARECIDA_SE_AMBIGUA = 0.03;
/** "Uma peça só" com esta certeza e o Jev sem saber qual: pergunta entre as mais prováveis. */
export const LIMIAR_DA_UNICA = 0.6;

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Pergunta de roteamento (a mensagem pede mudar o que existe ou criar novo). */
export function perguntaDaIntencao(): PerguntaJev {
  return {
    type: "choice",
    instructions:
      "Leia `mensagem`, escrita pela equipe de uma agência para o agente que cuida da agenda de conteúdos de um cliente. O que a mensagem pede?",
    criteria: { ...INTENCAO },
  };
}

/**
 * Opções do Jev: uma por título. Peças de título igual viram UMA opção (o Jev
 * não tem como escolher entre duas iguais e respondia "várias"); a escolha
 * entre elas é da equipe, no "Qual delas?".
 */
export function opcoesDoAlvo(candidatas: PecaComApelido[]): Array<{ ref: string; pecas: PecaComApelido[] }> {
  const porTitulo = new Map<string, PecaComApelido[]>();
  const ordem: string[] = [];
  for (const c of candidatas) {
    const k = tituloBase(c.title) || c.ref;
    if (!porTitulo.has(k)) {
      porTitulo.set(k, []);
      ordem.push(k);
    }
    (porTitulo.get(k) as PecaComApelido[]).push(c);
  }
  return ordem.map((k) => {
    const pecas = (porTitulo.get(k) as PecaComApelido[]).slice().sort(porData);
    return { ref: pecas[0].ref, pecas };
  });
}

/** Pergunta de qual peça gravada a mensagem cita (opções = um apelido por título, mais "varias" e "nenhuma"). */
export function perguntaDoAlvo(candidatas: PecaComApelido[]): PerguntaJev | null {
  if (!candidatas.length) return null;
  const criteria: Record<string, string> = {};
  for (const o of opcoesDoAlvo(candidatas)) {
    const c = o.pecas[0];
    const vezes = o.pecas.length > 1 ? `; está ${o.pecas.length} vezes na agenda` : "";
    criteria[o.ref] = `A mensagem fala desta peça: "${umaLinha(c.title, 160)}" (${c.due_date ?? "sem data"}, ${nomeDoFormato(c.delivery_type)}${vezes}).`;
  }
  criteria.varias = "A mensagem vale para várias peças diferentes ou um grupo (todas as que falam de um assunto, todos do mês, o calendário inteiro), não para uma só.";
  criteria.nenhuma = "A mensagem não cita nenhuma destas peças.";
  return {
    type: "choice",
    instructions:
      "Leia `mensagem` e compare com `pecas_candidatas` (título, data e roteiro de cada peça já gravada na agenda). Qual peça a mensagem cita pelo texto, pelo título ou pelo assunto?",
    criteria,
  };
}

/** A mensagem aponta uma peça só, sem confusão com outra parecida de assunto diferente? */
export function perguntaDoAlvoClaro(): PerguntaJev {
  return {
    type: "noul",
    instructions:
      "Leia `mensagem` e `pecas_candidatas`. A mensagem identifica UMA peça sem ambiguidade? Peças de título idêntico contam como a mesma peça.",
    criteria: {
      true: "Só uma peça (ou só um título) combina com o que a mensagem descreve.",
      false: "Duas ou mais peças de títulos diferentes combinam com o que a mensagem descreve (por exemplo, dois posts sobre o mesmo assunto), e não dá para saber qual é.",
    },
  };
}

/** A mensagem pede a mudança numa peça só (singular), e não num grupo? */
export function perguntaDaUnica(): PerguntaJev {
  return {
    type: "noul",
    instructions: "Leia `mensagem`. Ela pede para mudar UMA peça específica da agenda (um post, um carrossel, \"esse conteúdo\", \"aquele post\")?",
    criteria: {
      true: "Pede a mudança numa peça só, citada pelo título, pelo texto ou pelo assunto.",
      false: "Pede a mudança em várias peças, em todas as que tratam de um assunto, no mês ou no calendário inteiro, ou não pede mudança em peça nenhuma.",
    },
  };
}

/** Estado das perguntas: a mensagem inteira e as candidatas com o roteiro curto (uma por título). */
export function estadoDoPedido(mensagem: string, candidatas: PecaComApelido[]) {
  return {
    mensagem: String(mensagem || "").slice(0, 4000),
    pecas_candidatas: opcoesDoAlvo(candidatas).map((o) => ({
      apelido: o.ref,
      data: o.pecas.map((c) => c.due_date ?? "sem data").join(", "),
      formato: nomeDoFormato(o.pecas[0].delivery_type),
      titulo: umaLinha(o.pecas[0].title, 200),
      vezes_na_agenda: o.pecas.length,
      roteiro: umaLinha(o.pecas[0].detalhe || "", 400),
    })),
  };
}

export function perguntasDoPedido(mensagem: string, candidatas: PecaComApelido[]): { state: unknown; questions: Record<string, PerguntaJev> } {
  const questions: Record<string, PerguntaJev> = { intencao: perguntaDaIntencao() };
  const alvo = perguntaDoAlvo(candidatas);
  if (alvo) {
    questions.alvo = alvo;
    questions.alvo_claro = perguntaDoAlvoClaro();
    questions.uma_so = perguntaDaUnica();
  }
  return { state: estadoDoPedido(mensagem, candidatas), questions };
}

/**
 * Reserva quando o Jev não responde: verbo de troca e menção a conteúdo que já
 * existe. Só decide o caminho; quem escolhe as peças é o agente e a equipe confirma.
 */
const VERBO_DE_TROCA = /\b(mud[ae]\w*|troqu\w*|troca\w*|corrij\w*|corrig\w*|atualiz\w*|substitu\w*|alter[ae]\w*|reescrev\w*|refa[cç]a|refazer|revis[ae]\w*|apag\w*|remov\w*|exclu\w*|tir[ae] )/;
const CONTEUDO_QUE_EXISTE = /\b(conteudos?|posts?|pautas?|carross\w*|artes?|pecas?|agenda|calendario|esse|essa|esses|essas|este|esta|aquele|aquela|os que|as que|todos|todas|que fala\w*)\b/;
export function pareceTroca(mensagem: string): boolean {
  const t = normalizarTexto(mensagem);
  return VERBO_DE_TROCA.test(t) && CONTEUDO_QUE_EXISTE.test(t);
}

export type DecisaoDoRoteamento = { mudar: boolean; por: "jev" | "reserva"; prob: number | null };

/** Lê a resposta do Jev (ou a falta dela) e decide se o pedido vai ao agente que mexe na agenda. */
export function decidirRoteamento(resposta: RespostaJev | undefined | null, mensagem: string): DecisaoDoRoteamento {
  const p = resposta && resposta.probabilities ? Number(resposta.probabilities.mudar_existente) : NaN;
  if (Number.isFinite(p)) return { mudar: p >= LIMIAR_DE_MUDAR, por: "jev", prob: Math.round(p * 1000) / 1000 };
  return { mudar: pareceTroca(mensagem), por: "reserva", prob: null };
}

// ------------------------------------------------------------ qual peça

export type AlvoDoPedido =
  | { tipo: "um"; peca: PecaComApelido; prob: number }
  | { tipo: "qual"; opcoes: PecaComApelido[]; motivo: "iguais" | "parecidas" }
  | { tipo: "varias" }
  | { tipo: "nenhum" };

/**
 * Da resposta do Jev à peça: título escolhido com folga, único na agenda e
 * claro = "um"; título com iguais na agenda, ou mensagem que serve para duas
 * peças parecidas (alvo_claro baixo, ou o Jev dividido) = "qual" (a tela
 * pergunta); "varias" e "nenhuma" deixam o agente seguir como pedido amplo.
 */
export function resolverAlvo(
  resposta: RespostaJev | undefined | null,
  candidatas: PecaComApelido[],
  pecas: PecaComApelido[],
  claro?: RespostaJev | null,
  umaSo?: RespostaJev | null,
): AlvoDoPedido {
  const probs = resposta && resposta.probabilities ? resposta.probabilities : null;
  if (!probs || !candidatas.length) return { tipo: "nenhum" };
  const ordem = Object.keys(probs).map((k) => ({ k, p: Number(probs[k]) || 0 })).sort((a, b) => b.p - a.p);
  const topo = ordem[0];
  // Pedido de grupo ("todos os que falam de quartos") nunca vira escolha de uma peça.
  const pUmaSo = umaSo && typeof umaSo.noul === "number" ? umaSo.noul : null;
  if (pUmaSo !== null && pUmaSo < 0.5) return topo && topo.k === "nenhuma" ? { tipo: "nenhum" } : { tipo: "varias" };
  const porRef = new Map(candidatas.map((c) => [c.ref, c]));
  if (topo && topo.k === "varias" && pUmaSo !== null && pUmaSo >= LIMIAR_DA_UNICA) {
    // Uma peça só, mas o Jev não sabe qual ("daquele post do congresso"): as mais prováveis viram opções.
    const opcoes = ordem.filter((o) => porRef.has(o.k) && o.p >= LIMIAR_DA_PARECIDA_SE_AMBIGUA).slice(0, 6).map((o) => porRef.get(o.k) as PecaComApelido);
    if (opcoes.length >= 2) return { tipo: "qual", opcoes: opcoes.sort(porData), motivo: "parecidas" };
    if (opcoes.length === 1) {
      const iguais = iguaisA(opcoes[0], pecas);
      if (iguais.length) return { tipo: "qual", opcoes: [opcoes[0], ...iguais].sort(porData), motivo: "iguais" };
    }
  }
  if (!topo || topo.k === "nenhuma") return { tipo: "nenhum" };
  if (topo.k === "varias") return { tipo: "varias" };
  const escolhida = porRef.get(topo.k);
  if (!escolhida) return { tipo: "nenhum" };
  const iguais = iguaisA(escolhida, pecas);
  if (iguais.length) return { tipo: "qual", opcoes: [escolhida, ...iguais].sort(porData), motivo: "iguais" };
  const pClaro = claro && typeof claro.noul === "number" ? claro.noul : null;
  const limiteDaParecida = pClaro !== null && pClaro < 0.5 ? LIMIAR_DA_PARECIDA_SE_AMBIGUA : LIMIAR_DA_PARECIDA;
  const parecidas = ordem
    .slice(1)
    .filter((o) => o.p >= limiteDaParecida && porRef.has(o.k))
    .map((o) => porRef.get(o.k) as PecaComApelido);
  if (parecidas.length) return { tipo: "qual", opcoes: [escolhida, ...parecidas].slice(0, 6).sort(porData), motivo: "parecidas" };
  if (topo.p >= LIMIAR_DO_ALVO) return { tipo: "um", peca: escolhida, prob: Math.round(topo.p * 1000) / 1000 };
  return { tipo: "nenhum" };
}

const porData = (a: PecaComApelido, b: PecaComApelido) =>
  String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")) || a.ref.localeCompare(b.ref);

/** Trecho do prompt do agente: qual peça a mensagem cita, para ele preparar a troca nela. */
export function blocoDoAlvo(alvo: AlvoDoPedido): string {
  const linha = (p: PecaComApelido) => `${p.ref} (${p.due_date ?? "sem data"}, "${umaLinha(p.title, 140)}")`;
  if (alvo.tipo === "um") {
    return `\nPEÇA CITADA PELA EQUIPE: ${linha(alvo.peca)}. Prepare a troca pedida NESSA peça em acoes_na_agenda (editar_textos quando a peça muda de texto; refazer quando o tema inteiro muda). Não crie conteúdo novo no lugar dela.\n`;
  }
  if (alvo.tipo === "qual") {
    return `\nPEÇA CITADA PELA EQUIPE: uma destas ${alvo.opcoes.length} peças ${alvo.motivo === "iguais" ? "de título igual" : "parecidas"}: ${alvo.opcoes.map(linha).join("; ")}. Prepare a troca pedida em ${alvo.opcoes[0].ref}; o painel pergunta à equipe qual delas antes de fazer. Peça repetida é só aviso, nunca motivo para não fazer.\n`;
  }
  return "";
}

// ------------------------------------------------------------ cartão com "Qual delas?"

export type OpcaoDaEscolha = ItemDaAcao & { status: string | null; detalhe: string };
export type EscolhaDoAlvo = { task_ids: string[]; opcoes: OpcaoDaEscolha[]; motivo: "iguais" | "parecidas" };

/** Ação na agenda com o "Qual delas?" e os avisos (o tipo de acoes-agenda.ts, mais estes campos). */
export type AcaoComAlvo = AcaoNaAgenda & { escolher_um?: EscolhaDoAlvo; avisos?: string[]; alvo_por?: "jev" | "agente" };

const itemDaPeca = (p: PecaComApelido): ItemDaAcao => ({
  task_id: p.id,
  titulo: String(p.title || "sem título").slice(0, 200),
  data: p.due_date,
  formato: nomeDoFormato(p.delivery_type),
});

const ROTULO_DO_STATUS: Record<string, string> = { backlog: "a fazer", todo: "a fazer", doing: "em produção", review: "em revisão", done: "feita" };

function detalheDaOpcao(p: PecaComApelido): string {
  const partes = [`${p.due_date ?? "sem data"}`, nomeDoFormato(p.delivery_type)];
  if (p.status) partes.push(ROTULO_DO_STATUS[p.status] || p.status);
  partes.push(`id final ${p.id.slice(-6)}`);
  const d = umaLinha(p.detalhe || "", 160);
  if (d) partes.push(d);
  return partes.join(" · ");
}

function datasCurtas(l: PecaComApelido[]): string {
  return l.map((p) => (p.due_date ? `${p.due_date.slice(8, 10)}/${p.due_date.slice(5, 7)}` : "sem data")).join(", ");
}

type Listas = Pick<AcaoNaAgenda, "apagar" | "refazer" | "mudar_data" | "mudar_formato" | "editar_textos">;
const LISTAS: Array<keyof Listas> = ["editar_textos", "refazer", "mudar_data", "mudar_formato", "apagar"];

/**
 * Junta a peça citada à ação que o agente devolveu:
 * - "qual": a mesma mudança vale para cada opção e o cartão pergunta qual
 *   (só a escolhida muda ao confirmar);
 * - "um" sem a peça na ação (o agente não mexeu nela): a troca vira "refazer"
 *   da peça citada, na mesma data e formato, com o custo antes de confirmar;
 * - sempre: peça com iguais na agenda ganha o aviso, sem travar nada.
 * Só chamar quando o pedido é de mudar o que existe (decidirRoteamento).
 */
export function juntarAlvoNaAcao(
  acao: AcaoNaAgenda | null,
  alvo: AlvoDoPedido,
  pecas: PecaComApelido[],
  mensagem: string,
): AcaoComAlvo | null {
  let saida: AcaoComAlvo | null = acao ? { ...acao } : null;
  const vazia = (): AcaoComAlvo => ({
    tipo: "acao_agenda", resumo: "", apagar: [], mudar_data: [], mudar_formato: [], refazer: [], editar_campanhas: [], editar_textos: [], ignorados: [],
  });

  if (alvo.tipo === "um") {
    const tocada = saida && LISTAS.some((k) => (saida![k] as ItemDaAcao[]).some((i) => i.task_id === alvo.peca.id));
    if (!tocada) {
      saida = saida || vazia();
      saida.refazer = saida.refazer.concat([itemDaPeca(alvo.peca)]);
      saida.resumo = umaLinha(`${saida.resumo ? `${saida.resumo} ` : ""}Troco "${umaLinha(alvo.peca.title, 100)}" (${alvo.peca.due_date ?? "sem data"}) por um conteúdo novo na mesma data e formato, seguindo o seu pedido.`, 600);
      saida.alvo_por = "jev";
    }
  }

  if (alvo.tipo === "qual") {
    const ids = alvo.opcoes.map((o) => o.id);
    saida = saida || vazia();
    const base = saida;
    let algum = false;
    for (const k of LISTAS) {
      const lista = base[k] as Array<ItemDaAcao & Record<string, unknown>>;
      const modelo = lista.find((i) => ids.indexOf(i.task_id) >= 0);
      if (!modelo) continue;
      algum = true;
      const fora = lista.filter((i) => ids.indexOf(i.task_id) < 0);
      const copias = alvo.opcoes.map((o) => ({ ...modelo, ...itemDaPeca(o) }));
      (base as unknown as Record<string, unknown>)[k] = fora.concat(copias);
    }
    if (!algum) {
      // O agente não preparou a troca em nenhuma delas: a troca vira refazer da escolhida.
      base.refazer = base.refazer.concat(alvo.opcoes.map(itemDaPeca));
      base.resumo = umaLinha(`${base.resumo ? `${base.resumo} ` : ""}Troco a peça escolhida por um conteúdo novo na mesma data e formato, seguindo o seu pedido.`, 600);
      base.alvo_por = "jev";
    }
    base.escolher_um = {
      task_ids: ids,
      opcoes: alvo.opcoes.map((o) => ({ ...itemDaPeca(o), status: o.status, detalhe: detalheDaOpcao(o) })),
      motivo: alvo.motivo,
    };
  }

  if (!saida) return null;
  // Duplicado é aviso: a peça tocada que tem iguais na agenda aparece no cartão, e a troca segue.
  const avisos: string[] = [];
  const vistos = new Set<string>();
  for (const k of LISTAS) {
    for (const i of saida[k] as ItemDaAcao[]) {
      const p = pecas.find((x) => x.id === i.task_id);
      if (!p) continue;
      const chave = tituloBase(p.title);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const iguais = iguaisA(p, pecas);
      if (iguais.length) {
        avisos.push(`Aviso: "${umaLinha(p.title, 100)}" aparece ${iguais.length + 1} vezes na agenda (${datasCurtas([p, ...iguais])}). ${saida.escolher_um ? "Escolha qual muda." : "Só a peça da lista muda."}`);
      }
    }
  }
  if (avisos.length) saida.avisos = avisos.slice(0, 6);
  void mensagem;
  return saida;
}

/**
 * Na execução: com "Qual delas?", só a opção escolhida fica na ação (as
 * outras iguais saem de todas as listas). Escolha fora das opções é recusada.
 */
export function acaoComEscolha<T extends AcaoComAlvo>(acao: T, escolha: unknown): { ok: true; acao: T } | { ok: false; motivo: string } {
  const e = acao.escolher_um;
  if (!e || !Array.isArray(e.task_ids) || !e.task_ids.length) return { ok: true, acao };
  const id = typeof escolha === "string" ? escolha : "";
  if (!id) return { ok: false, motivo: "Escolha qual das peças muda antes de confirmar." };
  if (e.task_ids.indexOf(id) < 0) return { ok: false, motivo: "Esta peça não está entre as opções do cartão." };
  const saida = { ...acao } as T & Record<string, unknown>;
  for (const k of LISTAS) {
    const lista = (Array.isArray(acao[k]) ? acao[k] : []) as ItemDaAcao[];
    saida[k] = lista.filter((i) => e.task_ids.indexOf(i.task_id) < 0 || i.task_id === id) as never;
  }
  (saida as Record<string, unknown>).escolhida = id;
  return { ok: true, acao: saida as T };
}
