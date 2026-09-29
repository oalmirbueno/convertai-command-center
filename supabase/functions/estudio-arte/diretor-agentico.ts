/**
 * Diretor do Estúdio que executa (frente RO, fase 2, 29/09/2026).
 *
 * Pedido do dono: "o agente diretor do Estúdio tem que ser agêntico e completo
 * com base no que converso com ele, e o de ajuste mais inteligente. Eu
 * converso, ele entende, mas não está fazendo. Tem que ser agêntico."
 *
 * Três partes, sem caminho novo de geração (cada passo usa o que já existe):
 *
 * 1. ENTENDER (Jev, uma chamada com duas perguntas em paralelo, junto com o
 *    diretor): o pedido é uma ordem clara, uma pergunta ou opinião, ou
 *    ambíguo? E de qual lâmina fala ("a segunda", "a capa", "a do café",
 *    "todas", "essa aqui")? Na dúvida real, uma pergunta curta com opções
 *    clicáveis, e nada muda. Sem o Jev, regras de palavras.
 * 2. FAZER O QUE NÃO CUSTA: numa ordem clara, as mudanças da conversa (texto,
 *    cor, cena, foto, uso do rosto) e as ações sem custo (trocar texto,
 *    ordem, formato, qualidade, logo, referência, tirar ou duplicar lâmina)
 *    são feitas na hora pelo contrato de ../_shared/acoes-do-agente.ts
 *    (executarDireto): o cartão chega "Feito", com antes e depois e Desfazer.
 * 3. PLANO DO QUE CUSTA: ajustar o texto na arte, refazer, variações,
 *    entregar e agendar viram passos com o custo antes. A pessoa confirma
 *    com um clique; a tela executa passo a passo pelo caminho de sempre
 *    (gerar e conferir, ajustar_texto, entregar, Agendar do Estúdio), com
 *    andamento, Parar e a prova no fim (miniaturas de antes e depois). Só o
 *    ajuste de texto de custo pequeno numa ordem clara roda sem clique.
 *
 * Puro (sem Deno nem banco): o vitest lê este arquivo.
 */

import { pareceOrdem, type ItemDaAcaoDoAgente } from "../_shared/acoes-do-agente.ts";

/**
 * A mudança da conversa, só no que este módulo lê (o tipo completo é o
 * MudancaProposta de conversa-do-diretor.ts, compatível). Declarada aqui para
 * a tela importar este módulo sem puxar direcao-arte.ts (que chega ao Jev).
 */
export type MudancaProposta = {
  id: string;
  alvo: "conjunto" | "lamina";
  ordem: number | null;
  titulo: string;
  motivo: string;
  campos: Partial<Record<string, string>>;
  regerar: number[];
  antes?: Partial<Record<string, string>>;
  rotulos?: Partial<Record<string, string>>;
};

/** Mesma regra de mudancaSoDeTexto (conversa-do-diretor.ts): só texto e cor numa lâmina. */
const CAMPOS_SO_DE_TEXTO = ["texto_exato", "cor_texto", "cor_destaque"];
function mudancaSoDeTexto(m: Pick<MudancaProposta, "alvo" | "campos">): boolean {
  if (m.alvo !== "lamina") return false;
  const chaves = Object.keys(m.campos);
  return chaves.length > 0 && chaves.every((c) => CAMPOS_SO_DE_TEXTO.indexOf(c) >= 0);
}

// ------------------------------------------------------------------ 1. entender

/** Confiança mínima do Jev para tratar o pedido como ordem clara (faz direto). */
export const LIMIAR_DO_PEDIDO = 0.7;
/** Confiança mínima do Jev na lâmina citada. */
export const LIMIAR_DA_LAMINA = 0.6;
/** Discordância entre o diretor e o Jev sobre a lâmina: só pergunta quando o Jev tem esta certeza. */
export const LIMIAR_DA_DISCORDANCIA = 0.8;

export type LaminaParaEntender = { ordem: number; funcao?: string | null; texto?: string | null; cena?: string | null; foto?: string | null };

export type TipoDoPedido = "executar" | "opiniao" | "ambiguo";

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

const NOME_DA_FUNCAO: Record<string, string> = { capa: "capa", conteudo: "conteúdo", cta: "fechamento" };
export const rotuloDaLamina = (l: Pick<LaminaParaEntender, "ordem" | "funcao">) => `Lâmina ${l.ordem}${l.funcao && NOME_DA_FUNCAO[l.funcao] ? ` (${NOME_DA_FUNCAO[l.funcao]})` : ""}`;

/**
 * As perguntas ao Jev, numa chamada: o tipo do pedido e, com mais de uma
 * lâmina, qual lâmina (com o texto e a cena de cada uma, para "a do café").
 */
export function perguntasDoEntendimento(e: { mensagem: string; laminas: LaminaParaEntender[]; emFoco: number | null }) {
  const laminas = e.laminas.slice().sort((a, b) => a.ordem - b.ordem).slice(0, 12);
  const state = {
    pedido: umaLinha(e.mensagem, 1500),
    laminas: laminas.map((l) => ({ ref: `l${l.ordem}`, lamina: rotuloDaLamina(l), texto: umaLinha(l.texto, 240), cena: umaLinha(l.cena, 200), foto: umaLinha(l.foto, 120) || null })),
    lamina_aberta_na_tela: e.emFoco ? `l${e.emFoco}` : null,
  };
  const questions: Record<string, { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }> = {
    pedido: {
      type: "choice",
      instructions: [
        "A pessoa da equipe escreveu `pedido` ao diretor de arte de um carrossel ou arte (as lâminas estão em `laminas`). O que ela quer agora?",
        "Pense no verbo e no alvo: ordem para fazer uma mudança concreta, pergunta ou pedido de opinião, ou pedido de ação que não dá para executar sem perguntar.",
      ],
      criteria: {
        executar: {
          what: "Ordem clara para fazer agora uma mudança concreta (texto, cor, tamanho, posição, foto, rosto, ordem, formato, refazer, entregar), com o alvo dedutível.",
          examples: ["muda o título da capa para Promoção de Setembro", "tira o preço da segunda", "troca a cor do título para o verde da marca em todas", "refaz a capa com fundo de madeira", "usa só o rosto dele em outra pose", "manda para a entrega"],
        },
        opiniao: {
          what: "Pergunta, pedido de opinião, sugestão ou conversa: não manda fazer nada ainda.",
          examples: ["o que você mudaria?", "está bom assim?", "que cenário combina mais?", "tem alguma ideia melhor para a capa?"],
        },
        ambiguo: {
          what: "Pede para fazer algo, mas não dá para saber o quê ou onde sem perguntar (vago, contraditório ou com palavra sem sentido).",
          not_for: "Pedidos de estilo como \"mais minimalista\" ou \"mais elegante\" com o alvo claro: esses são executar.",
          examples: ["arruma aquilo", "muda aquele negócio", "deixa melhor", "troca"],
        },
      },
    },
  };
  if (laminas.length > 1) {
    const criteria: Record<string, unknown> = {};
    for (const l of laminas) {
      criteria[`l${l.ordem}`] = `${rotuloDaLamina(l)}: "${umaLinha(l.texto, 120)}"${l.cena ? `; cena: ${umaLinha(l.cena, 100)}` : ""}`;
    }
    criteria.todas = "Todas as lâminas (\"em todas\", \"em cada lâmina\", \"no carrossel inteiro\").";
    if (e.emFoco) criteria.em_foco = "A lâmina aberta na tela (\"essa aqui\", \"nesta\", \"aqui\"), sem citar outra.";
    criteria.trabalho = "O trabalho inteiro, não uma lâmina (formato, qualidade, ordem das lâminas, conceito, entregar, agendar) ou uma pergunta geral.";
    criteria.nao_diz = "Pede mudança numa lâmina, mas não dá para saber qual.";
    questions.lamina = {
      type: "choice",
      instructions: "De qual lâmina o `pedido` fala? Use a ordem (\"a segunda\", \"a capa\" = a primeira, \"a última\"), o conteúdo (\"a do café\" = a lâmina cujo texto ou cena fala de café) e `lamina_aberta_na_tela` para \"essa aqui\".",
      criteria,
    };
  }
  return { state, questions };
}

export type Entendimento = {
  tipo: TipoDoPedido;
  /** Ordem clara com certeza: o que é sem custo vai direto. */
  claro: boolean;
  confianca: number | null;
  /** A lâmina do pedido: número, todas, o trabalho, ou null (não diz). */
  alvo: number | "todas" | "trabalho" | null;
  /** O Jev disse com certeza que o pedido não diz a lâmina. */
  alvoIncerto: boolean;
  confiancaDoAlvo: number | null;
  por: "jev" | "regra";
};

type RespostaDeEscolha = { choice?: string; confidence?: number; probabilities?: Record<string, number> };

const conf = (r: RespostaDeEscolha | undefined) => (r && typeof r.confidence === "number" && isFinite(r.confidence) ? r.confidence : null);

/** Ordem clara sem o Jev: verbo de ordem no começo (o do contrato e os do Estúdio). */
export function pareceOrdemDoEstudio(texto: unknown): boolean {
  const t = String(texto == null ? "" : texto).trim().toLowerCase();
  if (!t || /\?\s*$/.test(t)) return false;
  return pareceOrdem(t) || /^(por favor,?\s+)?(faz|fa[cç]a|tira|tire|aplica|aplique|deixa|deixe|p[oõ]e|ponha|refaz|refa[cç]a|gera|gere|duplica|duplique|remove|remova|apaga|apague|usa|use|sobe|suba|desce|des[cç]a|aumenta|aumente|diminui|diminua|entrega|entregue)\b/.test(t);
}

const ORDINAIS: Record<string, number> = { primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6, "sétima": 7, setima: 7, oitava: 8, nona: 9, "décima": 10, decima: 10 };

/** A lâmina pelas palavras (sem o Jev): "todas", "a capa", "a segunda", "lâmina 3", "essa aqui", "a última". */
export function alvoPelaRegra(mensagem: string, laminas: LaminaParaEntender[], emFoco: number | null): number | "todas" | null {
  const t = String(mensagem || "").toLowerCase();
  const ordens = laminas.map((l) => l.ordem).sort((a, b) => a - b);
  if (!ordens.length) return null;
  if (/\b(todas|todos os cards|cada l[aâ]mina|carrossel inteiro|em tudo)\b/.test(t)) return "todas";
  const n = /\b(?:l[aâ]mina|card|slide)\s*(\d{1,2})\b/.exec(t);
  if (n && ordens.indexOf(Number(n[1])) >= 0) return Number(n[1]);
  if (/\bcapa\b/.test(t)) return ordens[0];
  // \b não enxerga letra acentuada ("última"): a borda da palavra é feita à mão.
  const palavra = (p: string) => new RegExp(`(^|[^a-zà-ú])${p}([^a-zà-ú]|$)`).test(t);
  if (palavra("[uú]ltima")) return ordens[ordens.length - 1];
  for (const o of Object.keys(ORDINAIS)) {
    if (palavra(o) && ordens.indexOf(ORDINAIS[o]) >= 0) return ORDINAIS[o];
  }
  if (emFoco && /\b(ess[ae]|est[ae]|nessa|nesta|aqui)\b/.test(t)) return emFoco;
  if (ordens.length === 1) return ordens[0];
  return null;
}

/** Junta a resposta do Jev (ou a regra, sem ele) num entendimento. */
export function lerEntendimento(
  respostas: Record<string, RespostaDeEscolha> | null | undefined,
  e: { mensagem: string; laminas: LaminaParaEntender[]; emFoco: number | null },
): Entendimento {
  const regraAlvo = alvoPelaRegra(e.mensagem, e.laminas, e.emFoco);
  const r = respostas || null;
  const p = r ? r.pedido : undefined;
  if (!p || (p.choice !== "executar" && p.choice !== "opiniao" && p.choice !== "ambiguo")) {
    const claro = pareceOrdemDoEstudio(e.mensagem);
    return { tipo: claro ? "executar" : "opiniao", claro, confianca: null, alvo: regraAlvo, alvoIncerto: false, confiancaDoAlvo: null, por: "regra" };
  }
  const c = conf(p);
  const tipo = p.choice as TipoDoPedido;
  let alvo: Entendimento["alvo"] = regraAlvo;
  let alvoIncerto = false;
  let confiancaDoAlvo: number | null = null;
  const l = r ? r.lamina : undefined;
  if (e.laminas.length <= 1) {
    alvo = e.laminas.length ? e.laminas[0].ordem : null;
  } else if (l && typeof l.choice === "string") {
    confiancaDoAlvo = conf(l);
    const certo = confiancaDoAlvo !== null && confiancaDoAlvo >= LIMIAR_DA_LAMINA;
    const m = /^l(\d+)$/.exec(l.choice);
    if (certo) {
      if (m) alvo = Number(m[1]);
      else if (l.choice === "todas") alvo = "todas";
      else if (l.choice === "em_foco") alvo = e.emFoco;
      else if (l.choice === "trabalho") alvo = "trabalho";
      else if (l.choice === "nao_diz") {
        alvoIncerto = regraAlvo == null;
        alvo = regraAlvo;
      }
    }
  }
  return { tipo, claro: tipo === "executar" && c !== null && c >= LIMIAR_DO_PEDIDO, confianca: c, alvo, alvoIncerto, confiancaDoAlvo, por: "jev" };
}

/** Palavra de "todas" no pedido: a mudança de uma lâmina vale em cada lâmina. */
export const pedeTodas = (ent: Pick<Entendimento, "alvo">) => ent.alvo === "todas";

/**
 * Precisa perguntar antes de fazer? Ambíguo com certeza; lâmina que o
 * pedido não diz (mais de uma lâmina, nenhuma aberta); ou o diretor e o Jev
 * discordam da lâmina com certeza. Pergunta ou opinião nunca pergunta de volta.
 */
export function precisaPerguntar(ent: Entendimento, e: { total: number; emFoco: number | null; ordensDasMudancas: number[] }): { perguntar: boolean; motivo: "ambiguo" | "qual_lamina" | "discordancia" | null } {
  if (ent.tipo === "opiniao") return { perguntar: false, motivo: null };
  if (ent.tipo === "ambiguo" && (ent.confianca === null || ent.confianca >= 0.6)) return { perguntar: true, motivo: "ambiguo" };
  if (e.total > 1 && ent.alvoIncerto && !e.emFoco && e.ordensDasMudancas.length) return { perguntar: true, motivo: "qual_lamina" };
  if (
    typeof ent.alvo === "number" && ent.confiancaDoAlvo !== null && ent.confiancaDoAlvo >= LIMIAR_DA_DISCORDANCIA &&
    e.ordensDasMudancas.length > 0 && e.ordensDasMudancas.every((o) => o !== ent.alvo)
  ) return { perguntar: true, motivo: "discordancia" };
  return { perguntar: false, motivo: null };
}

export const TIPO_DA_PERGUNTA = "pergunta_do_diretor";

export type OpcaoDaPergunta = { rotulo: string; mensagem: string };
export type PerguntaDoDiretor = { tipo: typeof TIPO_DA_PERGUNTA; pergunta: string; opcoes: OpcaoDaPergunta[]; motivo: string };

/** A pergunta curta com opções clicáveis (cada opção manda a mensagem já com a lâmina). */
export function perguntaDeEsclarecimento(e: { mensagem: string; laminas: LaminaParaEntender[]; motivo: "ambiguo" | "qual_lamina" | "discordancia" }): PerguntaDoDiretor {
  const pedido = umaLinha(e.mensagem, 400).replace(/[.!\s]+$/, "");
  const laminas = e.laminas.slice().sort((a, b) => a.ordem - b.ordem);
  if (e.motivo === "ambiguo") {
    return {
      tipo: TIPO_DA_PERGUNTA,
      motivo: e.motivo,
      pergunta: "Não entendi o que mudar. O que você quer?",
      opcoes: [
        { rotulo: "Mudar o texto", mensagem: `${pedido}: mudar o texto` },
        { rotulo: "Mudar as cores", mensagem: `${pedido}: mudar as cores` },
        { rotulo: "Outro cenário", mensagem: `${pedido}: outro cenário` },
        { rotulo: "Refazer a lâmina", mensagem: `${pedido}: refazer a lâmina` },
        { rotulo: "Me dê sugestões", mensagem: "O que você mudaria nesta arte?" },
      ],
    };
  }
  const opcoes: OpcaoDaPergunta[] = laminas.slice(0, 8).map((l) => ({ rotulo: rotuloDaLamina(l), mensagem: `Na lâmina ${l.ordem}: ${pedido}` }));
  if (laminas.length > 1) opcoes.push({ rotulo: "Todas", mensagem: `Em todas as lâminas: ${pedido}` });
  return { tipo: TIPO_DA_PERGUNTA, motivo: e.motivo, pergunta: e.motivo === "discordancia" ? "Fiquei em dúvida sobre a lâmina. Em qual?" : "Em qual lâmina?", opcoes };
}

/** Papéis de uma imagem anexada na conversa (a pergunta quando ela vem sem texto). */
export function perguntaSobreImagens(e: { quantas: number; emFoco: number | null }): PerguntaDoDiretor {
  const onde = e.emFoco ? ` na lâmina ${e.emFoco}` : "";
  const esta = e.quantas === 1 ? "esta imagem" : "estas imagens";
  return {
    tipo: TIPO_DA_PERGUNTA,
    motivo: "imagem_sem_texto",
    pergunta: `O que faço com ${esta}?`,
    opcoes: [
      { rotulo: "Referência de estilo", mensagem: `Deixa${onde} com a cara de ${esta} (referência de estilo).` },
      { rotulo: "Usar a foto exata", mensagem: `Usa ${esta}${onde} como está, foto exata.` },
      { rotulo: "Usar o rosto", mensagem: `Usa só o rosto da pessoa de ${esta}${onde}, em outra pose.` },
      { rotulo: "Inserir como elemento", mensagem: `Põe o que está em ${esta}${onde} como elemento na arte.` },
      { rotulo: "É um print do erro", mensagem: `Olha o que está errado em ${esta} e corrige${onde}.` },
    ],
  };
}

/** Campos que valem em cada lâmina quando o pedido diz "todas" (foto, texto e uso do rosto são de uma lâmina só). */
const CAMPOS_QUE_REPETEM = ["imagem", "ponto_focal", "fundo", "tratamento", "zona_texto", "alinhamento", "cor_fundo", "cor_texto", "cor_destaque", "evitar"];

/**
 * "Todas": a mudança que o diretor escreveu para uma lâmina vira a mesma
 * mudança em cada lâmina (novos ids), quando os campos repetem. Mudança do
 * conjunto e as de texto, foto ou rosto ficam como estão.
 */
export function expandirParaTodas<M extends MudancaProposta>(mudancas: M[], ordens: number[]): M[] {
  const daLamina = mudancas.filter((m) => m.alvo === "lamina" && m.ordem !== null);
  const jaEmTodas = ordens.every((o) => daLamina.some((m) => m.ordem === o));
  if (!daLamina.length || jaEmTodas) return mudancas;
  const saida = mudancas.slice();
  let n = mudancas.length;
  for (const m of daLamina) {
    const chaves = Object.keys(m.campos);
    if (!chaves.length || !chaves.every((k) => CAMPOS_QUE_REPETEM.indexOf(k) >= 0)) continue;
    for (const o of ordens) {
      if (saida.some((x) => x.alvo === "lamina" && x.ordem === o && JSON.stringify(x.campos) === JSON.stringify(m.campos))) continue;
      n += 1;
      saida.push({ ...m, id: `m${n}`, ordem: o, regerar: m.regerar.length ? [o] : [], antes: undefined, titulo: `${m.titulo} (lâmina ${o})`.slice(0, 120) });
    }
  }
  return saida;
}

// ------------------------------------------------------------------ 3. plano do que custa

/** Até este custo (US$) o ajuste de texto numa ordem clara roda sem clique. */
export const LIMITE_DO_CUSTO_PEQUENO_USD = 0.06;
/** Até quantas lâminas o ajuste de texto roda sem clique. */
export const MAX_AUTOMATICOS = 2;

export const TIPO_DO_PLANO = "plano_do_diretor";
export type OperacaoDoPlano = "ajustar_texto" | "refazer" | "variacoes" | "entregar" | "agendar";
export type EstadoDoPasso = "pendente" | "executando" | "feito" | "falhou" | "parado";

export type PassoDoPlano = {
  id: string;
  operacao: OperacaoDoPlano;
  ordem: number | null;
  /** Variações: quantas versões novas. */
  n?: number;
  rotulo: string;
  estado: EstadoDoPasso;
  motivo?: string | null;
  /** A versão atual da lâmina antes do passo e as que nasceram nele (a prova). */
  versao_antes?: number | null;
  versoes_depois?: number[];
  custo_usd?: number | null;
};

export type PlanoDoDiretor = {
  tipo: typeof TIPO_DO_PLANO;
  id: string;
  passos: PassoDoPlano[];
  /** Custo pequeno numa ordem clara: a tela executa sem clique. */
  automatico: boolean;
  criado_em: string;
  confirmado_em?: string | null;
  terminado_em?: string | null;
  parado_em?: string | null;
  descartado_em?: string | null;
  custo_usd?: number | null;
};

const PESO_DO_PASSO: Record<OperacaoDoPlano, number> = { ajustar_texto: 0, refazer: 1, variacoes: 2, entregar: 3, agendar: 4 };

export function rotuloDoPasso(p: Pick<PassoDoPlano, "operacao" | "ordem" | "n">): string {
  const l = p.ordem ? `lâmina ${p.ordem}` : "lâmina";
  switch (p.operacao) {
    case "ajustar_texto": return `Ajustar o texto na arte da ${l}`;
    case "refazer": return `Refazer a ${l}`;
    case "variacoes": return `${p.n && p.n > 1 ? `${p.n} variações` : "1 variação"} da ${l}`;
    case "entregar": return "Mandar para a entrega";
    case "agendar": return "Agendar";
  }
  return "Passo";
}

/**
 * Monta o plano dos passos com custo: os que o diretor pediu (refazer,
 * variações, ajustar o texto, entregar, agendar) e os que as mudanças FEITAS
 * pedem para a arte mostrar: só texto e cor numa lâmina com arte = ajustar o
 * texto (custo pequeno); cena, foto ou rosto = refazer. Refazer vale sobre o
 * ajuste de texto da mesma lâmina. Null quando não há passo.
 */
export function montarPlano(e: {
  id: string;
  itens: ItemDaAcaoDoAgente[];
  mudancasFeitas: MudancaProposta[];
  comArte: Set<number> | number[];
  claro: boolean;
  agora?: string;
}): PlanoDoDiretor | null {
  const comArte = Array.isArray(e.comArte) ? new Set(e.comArte) : e.comArte;
  const passos: PassoDoPlano[] = [];
  const tem = (op: OperacaoDoPlano, ordem: number | null) => passos.some((p) => p.operacao === op && p.ordem === ordem);
  const por = (op: OperacaoDoPlano, ordem: number | null, n?: number) => {
    if (op !== "variacoes" && tem(op, ordem)) return;
    const p: PassoDoPlano = { id: `p${passos.length + 1}`, operacao: op, ordem, rotulo: "", estado: "pendente" };
    if (op === "variacoes") p.n = Math.max(1, Math.min(3, n || 2));
    p.rotulo = rotuloDoPasso(p);
    passos.push(p);
  };
  for (const i of e.itens) {
    const ordem = /^\d+$/.test(String(i.alvo_id)) ? Number(i.alvo_id) : null;
    if (i.operacao === "refazer" && ordem) por("refazer", ordem);
    else if (i.operacao === "ajustar_texto" && ordem) por("ajustar_texto", ordem);
    else if (i.operacao === "variacoes" && ordem) por("variacoes", ordem, Number(i.para) || 2);
    else if (i.operacao === "entregar") por("entregar", null);
    else if (i.operacao === "agendar") por("agendar", null);
  }
  for (const m of e.mudancasFeitas) {
    const ordens = m.alvo === "lamina" && m.ordem !== null ? [m.ordem] : m.regerar;
    for (const o of ordens) {
      if (!comArte.has(o)) continue;
      if (m.alvo === "lamina" && mudancaSoDeTexto(m)) por("ajustar_texto", o);
      else if (m.regerar.indexOf(o) >= 0) por("refazer", o);
    }
  }
  // Refazer a lâmina já mostra o texto novo: o ajuste de texto dela sai.
  const refeitas = new Set(passos.filter((p) => p.operacao === "refazer").map((p) => p.ordem));
  const finais = passos
    .filter((p) => !(p.operacao === "ajustar_texto" && refeitas.has(p.ordem)))
    .sort((a, b) => PESO_DO_PASSO[a.operacao] - PESO_DO_PASSO[b.operacao] || (a.ordem || 0) - (b.ordem || 0))
    .map((p, i) => ({ ...p, id: `p${i + 1}` }));
  if (!finais.length) return null;
  const automatico = e.claro && finais.length <= MAX_AUTOMATICOS && finais.every((p) => p.operacao === "ajustar_texto");
  return { tipo: TIPO_DO_PLANO, id: e.id, passos: finais, automatico, criado_em: e.agora || new Date().toISOString() };
}

/** O plano de um anexo (a tela usa o mesmo). Null quando não é um. */
export function planoDoAnexo(a: unknown): PlanoDoDiretor | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  if (o.tipo !== TIPO_DO_PLANO || !Array.isArray(o.passos)) return null;
  const ops: OperacaoDoPlano[] = ["ajustar_texto", "refazer", "variacoes", "entregar", "agendar"];
  const estados: EstadoDoPasso[] = ["pendente", "executando", "feito", "falhou", "parado"];
  const passos = (o.passos as Record<string, unknown>[])
    .filter((p) => p && ops.indexOf(p.operacao as OperacaoDoPlano) >= 0)
    .map((p, i) => ({
      id: String(p.id || `p${i + 1}`),
      operacao: p.operacao as OperacaoDoPlano,
      ordem: typeof p.ordem === "number" ? p.ordem : null,
      ...(typeof p.n === "number" ? { n: p.n } : {}),
      rotulo: umaLinha(p.rotulo, 120) || rotuloDoPasso({ operacao: p.operacao as OperacaoDoPlano, ordem: typeof p.ordem === "number" ? p.ordem : null, n: typeof p.n === "number" ? p.n : undefined }),
      estado: estados.indexOf(p.estado as EstadoDoPasso) >= 0 ? (p.estado as EstadoDoPasso) : "pendente",
      motivo: typeof p.motivo === "string" ? umaLinha(p.motivo, 300) : null,
      versao_antes: typeof p.versao_antes === "number" ? p.versao_antes : null,
      versoes_depois: Array.isArray(p.versoes_depois) ? (p.versoes_depois as unknown[]).map(Number).filter((n) => Number.isInteger(n)) : [],
      custo_usd: typeof p.custo_usd === "number" ? p.custo_usd : null,
    }));
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    tipo: TIPO_DO_PLANO,
    id: String(o.id || "plano"),
    passos,
    automatico: o.automatico === true,
    criado_em: s(o.criado_em) || "",
    confirmado_em: s(o.confirmado_em),
    terminado_em: s(o.terminado_em),
    parado_em: s(o.parado_em),
    descartado_em: s(o.descartado_em),
    custo_usd: typeof o.custo_usd === "number" ? o.custo_usd : null,
  };
}

export type MudancaDoPasso = {
  passo_id?: string;
  estado?: EstadoDoPasso;
  motivo?: string | null;
  versao_antes?: number | null;
  versoes_depois?: number[];
  custo_usd?: number | null;
  /** O plano todo: confirmar (começou), parar, descartar ou terminar. */
  plano?: "confirmar" | "parar" | "descartar" | "terminar";
};

/**
 * Grava o andamento de um passo (ou do plano) no anexo. Passo feito ou que
 * falhou não volta a pendente; plano parado ou descartado não anda mais.
 */
export function planoComPasso(plano: PlanoDoDiretor, m: MudancaDoPasso, agora = new Date().toISOString()): PlanoDoDiretor {
  const novo: PlanoDoDiretor = { ...plano, passos: plano.passos.map((p) => ({ ...p })) };
  if (m.plano === "descartar") {
    if (!novo.confirmado_em) novo.descartado_em = novo.descartado_em || agora;
    return novo;
  }
  if (novo.descartado_em) throw new Error("Este plano foi cancelado. Peça de novo ao diretor.");
  if (m.plano === "confirmar") novo.confirmado_em = novo.confirmado_em || agora;
  if (m.plano === "parar") {
    novo.parado_em = novo.parado_em || agora;
    novo.passos = novo.passos.map((p) => (p.estado === "pendente" || p.estado === "executando" ? { ...p, estado: "parado" as EstadoDoPasso } : p));
  }
  if (m.passo_id) {
    const i = novo.passos.findIndex((p) => p.id === m.passo_id);
    if (i < 0) throw new Error("Este passo não existe no plano.");
    const p = novo.passos[i];
    const fechado = p.estado === "feito" || p.estado === "falhou";
    if (novo.parado_em && m.estado === "executando") throw new Error("O plano foi parado.");
    if (!(fechado && (m.estado === "pendente" || m.estado === "executando"))) {
      if (m.estado) p.estado = m.estado;
      if (m.motivo !== undefined) p.motivo = m.motivo ? umaLinha(m.motivo, 300) : null;
      if (m.versao_antes !== undefined) p.versao_antes = m.versao_antes;
      if (m.versoes_depois) p.versoes_depois = m.versoes_depois.filter((n) => Number.isInteger(n)).slice(0, 6);
      if (typeof m.custo_usd === "number" && isFinite(m.custo_usd)) p.custo_usd = Math.round(m.custo_usd * 10000) / 10000;
    }
    novo.confirmado_em = novo.confirmado_em || agora;
  }
  const abertos = novo.passos.filter((p) => p.estado === "pendente" || p.estado === "executando").length;
  if (m.plano === "terminar" || (!abertos && novo.confirmado_em)) novo.terminado_em = novo.terminado_em || agora;
  const custo = novo.passos.reduce((s, p) => s + (typeof p.custo_usd === "number" ? p.custo_usd : 0), 0);
  novo.custo_usd = Math.round(custo * 10000) / 10000;
  return novo;
}

/** Resumo do plano para a conversa ("2 feitos, 1 falhou"). */
export function resumoDoPlano(plano: Pick<PlanoDoDiretor, "passos">): string {
  const feitos = plano.passos.filter((p) => p.estado === "feito").length;
  const falhas = plano.passos.filter((p) => p.estado === "falhou").length;
  const parados = plano.passos.filter((p) => p.estado === "parado").length;
  return [feitos ? `${feitos} ${feitos === 1 ? "feito" : "feitos"}` : "", falhas ? `${falhas} ${falhas === 1 ? "falhou" : "falharam"}` : "", parados ? `${parados} ${parados === 1 ? "parado" : "parados"}` : ""].filter(Boolean).join(", ") || "nada feito ainda";
}
