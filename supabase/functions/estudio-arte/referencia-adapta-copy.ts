/**
 * Estética da referência, conteúdo da copy (frente R, 26/09/2026).
 *
 * Pedido do dono: na leitura da referência, mesmo em Idêntica e Próxima, o
 * sistema copia o ESTILO (estratégia, layout, estética), mas monta a imagem
 * com o CONTEXTO DA COPY e do roteiro da lâmina, não com o conteúdo da
 * referência. Muitas vezes o assunto da referência não tem nada a ver: o que
 * a equipe queria era a estética. A imagem tem que reforçar a mensagem do
 * texto. É COMPLEMENTO: não muda o que já funciona.
 *
 * Como (uma leitura, um julgamento, uma cena; sem laço de correção):
 * 1. Leitura por visão da referência 1, uma vez, guardada em
 *    <cliente>/estudio/leituras/conteudo-<ref>.json: ESTÉTICA (layout,
 *    tipografia, cor, luz, tratamento, composição, enquadramento, elementos,
 *    gancho) separada do CONTEÚDO (assunto, objetos, pessoas, cenário, texto
 *    escrito e sentido). O molde (layout medido) continua como está.
 * 2. Jev: Noul "o assunto da referência serve para transmitir esta lâmina?" e
 *    Choice do que aproveitar (tudo, estética e tipo de cena, só a estética),
 *    com o estado em campos nomeados. Serve quando a probabilidade de sim é
 *    LIMIAR_SERVE ou mais; em dúvida (meio) adapta, que é o pedido do dono,
 *    mantendo a composição.
 * 3. Não serve: o diretor de arte (modelo padrão diretor_arte do catálogo)
 *    escreve UMA cena equivalente que transmite a copy, na mesma composição,
 *    e ela entra como bloco curto ADITIVO logo depois do promptDoReplicar.
 * 4. Serve, sem copy, com foto do cliente, interruptor desligado ou qualquer
 *    falha: nenhum bloco, e o prompt é byte a byte o de hoje.
 * O julgamento e a cena ficam guardados por referência e texto
 * (adapta-<ref>-<chave>.json): refazer a lâmina não paga de novo.
 */

import type { MoldeDaReferencia } from "../_shared/direcao-arte.ts";
import type { FidelidadeDaReferencia } from "../_shared/fidelidade-da-referencia.ts";
import type { PerguntaJev, RespostaJev, ResultadoJev } from "../_shared/jev.ts";
import { type KitDaTrava, neutralizarMarcaDaReferencia } from "../_shared/trava-da-marca.ts";
// Frente FS (29/09): o que falha aqui continua opcional (vale o prompt de hoje), mas fica no log com o motivo.
import { nuloComLog, registrarFalha } from "../_shared/falha-registrada.ts";

export const VERSAO_DA_LEITURA_DO_CONTEUDO = 1;
export const VERSAO_DA_ADAPTACAO = 1;
/**
 * Probabilidade de "serve" a partir da qual o conteúdo da referência fica.
 * Alta de propósito: manter um assunto que não conversa com a copy é
 * exatamente a queixa do dono; na dúvida (entre 0,25 e 0,75, por exemplo) a
 * lâmina adapta, mantendo a composição da referência.
 */
export const LIMIAR_SERVE = 0.75;
export const TETO_DA_CENA = 360;
export const TETO_DO_BLOCO_ADAPTAR = 1200;

export type Aproveitar = "tudo" | "estetica_e_tipo_de_cena" | "so_estetica";
export const APROVEITAR: Aproveitar[] = ["tudo", "estetica_e_tipo_de_cena", "so_estetica"];

const CAMPOS_DA_ESTETICA = ["layout", "tipografia", "cores", "luz", "tratamento_de_foto", "composicao", "enquadramento", "elementos_graficos", "estrategia_do_gancho"] as const;
const CAMPOS_DO_CONTEUDO = ["assunto", "objetos", "pessoas", "cenario", "texto_escrito", "sentido"] as const;

export type LeituraDoConteudo = {
  estetica: Record<(typeof CAMPOS_DA_ESTETICA)[number], string>;
  conteudo: Record<(typeof CAMPOS_DO_CONTEUDO)[number], string>;
  tipo_de_cena: string;
  tem_assunto_visual: boolean;
};

const campoTexto = { type: "string" } as const;

/** Esquema da leitura por visão (modelo de leitura do catálogo). */
export const ESQUEMA_LEITURA_DO_CONTEUDO = {
  nome: "estetica_e_conteudo_da_referencia",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["estetica", "conteudo", "tipo_de_cena", "tem_assunto_visual"],
    properties: {
      estetica: {
        type: "object",
        additionalProperties: false,
        required: [...CAMPOS_DA_ESTETICA],
        properties: Object.fromEntries(CAMPOS_DA_ESTETICA.map((c) => [c, campoTexto])),
      },
      conteudo: {
        type: "object",
        additionalProperties: false,
        required: [...CAMPOS_DO_CONTEUDO],
        properties: Object.fromEntries(CAMPOS_DO_CONTEUDO.map((c) => [c, campoTexto])),
      },
      tipo_de_cena: campoTexto,
      tem_assunto_visual: { type: "boolean" },
    },
  },
};

export const SISTEMA_LEITURA_DO_CONTEUDO = `Você lê uma arte de referência de post ou anúncio e separa duas coisas:
ESTÉTICA (o jeito, que pode ser copiado para outro tema): layout e grade, hierarquia da tipografia, função de cada cor, luz, tratamento da foto, composição, enquadramento e ângulo da câmera, elementos gráficos e a estratégia visual do gancho (o que faz a pessoa parar).
CONTEÚDO (o assunto, que é daquela marca e daquele tema): assunto principal, objetos, pessoas (sem identificar ninguém), cenário, o texto escrito na arte e o sentido da mensagem.
Também diga o tipo_de_cena em poucas palavras (por exemplo: retrato de pessoa em estúdio, produto em mesa, ambiente interno, só tipografia) e se a arte tem assunto visual (foto, ilustração ou objeto em cena; false quando é só texto, fundo e formas).
Frases curtas e concretas, em português do Brasil, sem travessão. Campo sem nada: string vazia.`;

const limpar = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "").replace(/[—–]/g, ",").replace(/\s+/g, " ").trim().slice(0, max);

/** Leitura guardada ou devolvida pelo modelo, lida com cuidado. Sem assunto nem sentido: null. */
export function normalizarLeituraDoConteudo(v: unknown): LeituraDoConteudo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const e = (o.estetica && typeof o.estetica === "object" ? o.estetica : {}) as Record<string, unknown>;
  const c = (o.conteudo && typeof o.conteudo === "object" ? o.conteudo : {}) as Record<string, unknown>;
  const estetica = Object.fromEntries(CAMPOS_DA_ESTETICA.map((k) => [k, limpar(e[k], 300)])) as LeituraDoConteudo["estetica"];
  const conteudo = Object.fromEntries(CAMPOS_DO_CONTEUDO.map((k) => [k, limpar(c[k], 400)])) as LeituraDoConteudo["conteudo"];
  if (!conteudo.assunto && !conteudo.sentido && !conteudo.texto_escrito) return null;
  return { estetica, conteudo, tipo_de_cena: limpar(o.tipo_de_cena, 120), tem_assunto_visual: o.tem_assunto_visual !== false };
}

// ------------------------------------------------------------------ quando tenta

/** Interruptor "Adaptar conteúdo à copy", por trabalho: ligado por padrão; só false desliga. */
export function adaptarConteudoLigado(direcao: unknown): boolean {
  return !(direcao && typeof direcao === "object" && (direcao as Record<string, unknown>).adaptar_conteudo_a_copy === false);
}

/** A copy da lâmina (o texto exato), limpa. */
export function copyDaLamina(card: { texto_exato?: unknown } | null | undefined): string {
  return limpar(card ? card.texto_exato : "", 1200);
}

/**
 * Só tenta no modo replicar referência, com o interruptor ligado, com copy e
 * sem foto do cliente na lâmina (com foto, o assunto já é do cliente).
 */
export function tentaAdaptar(e: { replicar: boolean; direcao: unknown; copy: string; fotosDoCliente: number; temImagemDaReferencia: boolean }): boolean {
  return e.replicar && adaptarConteudoLigado(e.direcao) && !!e.copy && e.fotosDoCliente === 0 && e.temImagemDaReferencia;
}

// ------------------------------------------------------------------ Jev

export type ContextoDaLamina = {
  copy: string;
  funcao: string;
  ordem: number;
  total: number;
  conceito: string;
  roteiro: string;
  ideia_da_imagem: string;
  cliente: { nome: string; negocio: string; publico: string; oferta: string };
};

/** Estado do Jev em campos nomeados: a lâmina, o post, o cliente e o conteúdo da referência. */
export function estadoDoJev(ctx: ContextoDaLamina, leitura: LeituraDoConteudo): Record<string, unknown> {
  return {
    lamina: {
      copy: ctx.copy,
      funcao: ctx.funcao || null,
      posicao: ctx.total > 1 ? `lâmina ${ctx.ordem} de ${ctx.total}` : "post de uma imagem",
    },
    post: {
      conceito: ctx.conceito || null,
      roteiro_e_objetivo: ctx.roteiro || null,
      ideia_do_diretor_para_a_imagem: ctx.ideia_da_imagem || null,
    },
    cliente: {
      nome: ctx.cliente.nome || null,
      negocio: ctx.cliente.negocio || null,
      publico: ctx.cliente.publico || null,
      oferta: ctx.cliente.oferta || null,
    },
    referencia: {
      assunto: leitura.conteudo.assunto || null,
      objetos: leitura.conteudo.objetos || null,
      pessoas: leitura.conteudo.pessoas || null,
      cenario: leitura.conteudo.cenario || null,
      texto_escrito: leitura.conteudo.texto_escrito || null,
      sentido: leitura.conteudo.sentido || null,
      tipo_de_cena: leitura.tipo_de_cena || null,
    },
  };
}

export const PERGUNTAS_DA_ADAPTACAO: Record<"serve" | "aproveitar", PerguntaJev> = {
  serve: {
    type: "noul",
    instructions:
      "A equipe escolheu a imagem de referência (`referencia`) para uma lâmina de post. O assunto mostrado nela (pessoas, objetos, cenário) serve, do jeito que está, para transmitir a mensagem desta lâmina (`lamina.copy`), dentro do objetivo do post (`post`) e do negócio do cliente (`cliente`)?",
    criteria: {
      true: "Serve: o assunto, os objetos e o cenário da referência são do mesmo tema da copy e combinam com o negócio do cliente; quem vê essa imagem com esse texto entende a mesma mensagem.",
      false: "Não serve: o assunto da referência é de outro tema, outro ramo ou outra mensagem (por exemplo, a referência mostra um carro e a lâmina fala de dente); a referência foi escolhida pela estética e a imagem precisa de outro assunto para transmitir a copy.",
    },
  },
  aproveitar: {
    type: "choice",
    instructions:
      "Para a nova imagem desta lâmina transmitir a copy (`lamina.copy`) no contexto do post e do cliente, o que ela deve aproveitar da referência (`referencia`)? A estética (layout, tipografia, cor, luz, tratamento) é sempre aproveitada.",
    criteria: {
      tudo: "A estética e o próprio assunto da referência: o assunto já transmite a copy.",
      estetica_e_tipo_de_cena: "A estética e o tipo de cena (o mesmo tipo de plano, por exemplo retrato de pessoa, produto em mesa ou ambiente), trocando o assunto concreto por um ligado à copy.",
      so_estetica: "Só a estética: o assunto e o tipo de cena mudam para transmitir a copy, porque o tipo de cena da referência não combina com a mensagem.",
    },
  },
};

export type Decisao = { serve: boolean; probabilidade: number; aproveitar: Aproveitar; confianca: number | null };

/** Lê as respostas: sem a probabilidade do Noul, null (a lâmina segue como hoje). */
export function decidirAdaptacao(answers: Record<string, RespostaJev> | null | undefined): Decisao | null {
  const r = answers ? answers.serve : undefined;
  const p = r && typeof r.noul === "number" && isFinite(r.noul) ? Math.max(0, Math.min(1, r.noul)) : null;
  if (p === null) return null;
  const a = answers ? answers.aproveitar : undefined;
  const escolha = a && APROVEITAR.indexOf(a.choice as Aproveitar) >= 0 ? (a.choice as Aproveitar) : null;
  const serve = p >= LIMIAR_SERVE;
  // Adaptando, "tudo" (ou sem resposta) vira a troca mais conservadora: mesmo tipo de cena.
  const aproveitar: Aproveitar = serve ? "tudo" : escolha === "so_estetica" ? "so_estetica" : "estetica_e_tipo_de_cena";
  return { serve, probabilidade: Math.round(p * 1000) / 1000, aproveitar, confianca: a && typeof a.confidence === "number" ? a.confidence : null };
}

// ------------------------------------------------------------------ cena do diretor

export const ESQUEMA_DA_CENA = {
  nome: "cena_que_transmite_a_copy",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["cena"],
    properties: { cena: { type: "string" } },
  },
};

export const SISTEMA_DA_CENA = `Você é o diretor de arte do Estúdio. A equipe escolheu uma referência pela ESTÉTICA, mas o assunto dela não transmite a mensagem desta lâmina. Escreva UMA cena para a imagem desta lâmina que transmita a copy, no contexto do post e do negócio do cliente, e que caiba na MESMA composição da referência: o assunto no mesmo lugar e na mesma escala, o mesmo enquadramento, o mesmo ângulo de câmera, a mesma luz e o mesmo tratamento. É troca de assunto, não de estética.
Regras:
- Uma ou duas frases concretas e visuais (quem ou o que aparece, fazendo o quê, onde), até 300 caracteres.
- Com aproveitar = estetica_e_tipo_de_cena, mantenha o tipo de cena da referência (retrato continua retrato, produto em mesa continua produto em mesa) e troque o assunto concreto. Com so_estetica, o tipo de cena pode mudar.
- Se houver ideia do diretor para a imagem desta lâmina, parta dela.
- Pessoa, se houver, é adulta e genérica (nunca a da referência nem pessoa conhecida), com roupa sem marca.
- Nada de texto, logo, marca ou tela com palavras na cena: o texto da lâmina entra à parte.
- Não fale de cor da marca, fonte nem layout: só a cena.
- Português do Brasil, sem travessão.`;

/** Pedido ao diretor, em JSON (o sistema é fixo e fica no cache do provedor). */
export function pedidoDaCena(ctx: ContextoDaLamina, leitura: LeituraDoConteudo, molde: MoldeDaReferencia | null, aproveitar: Aproveitar): string {
  const assuntoNoMolde = molde && molde.assunto
    ? { tipo: molde.assunto.tipo, descricao: molde.assunto.descricao, enquadramento: molde.assunto.enquadramento, caixa_em_porcentagem: { x0: molde.assunto.x0, y0: molde.assunto.y0, x1: molde.assunto.x1, y1: molde.assunto.y1 } }
    : null;
  return `Escreva a cena. Contexto em JSON:\n${JSON.stringify({
    aproveitar,
    lamina: { copy: ctx.copy, funcao: ctx.funcao, posicao: `${ctx.ordem} de ${ctx.total}` },
    post: { conceito: ctx.conceito || null, roteiro_e_objetivo: ctx.roteiro || null, ideia_do_diretor_para_a_imagem: ctx.ideia_da_imagem || null },
    cliente: ctx.cliente,
    // Letra e cor da referência não vão ao diretor (são do kit do cliente, regra dura do dono).
    estetica_da_referencia: esteticaSemMarca(leitura),
    assunto_da_referencia_no_layout: assuntoNoMolde,
    conteudo_da_referencia_que_sai: leitura.conteudo,
  })}`;
}

/** A estética para a cena: sem tipografia nem cores (do kit), e o resto sem fonte, hex ou nome de cor da referência. */
export function esteticaSemMarca(leitura: LeituraDoConteudo): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const k of CAMPOS_DA_ESTETICA) {
    if (k === "tipografia" || k === "cores") continue;
    const v = neutralizarMarcaDaReferencia(leitura.estetica[k]);
    if (v) saida[k] = v;
  }
  if (leitura.tipo_de_cena) saida.tipo_de_cena = neutralizarMarcaDaReferencia(leitura.tipo_de_cena);
  return saida;
}

/** A cena devolvida pelo diretor, curta e sem travessão; vazia vira null. */
export function normalizarCena(v: unknown): string | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const c = limpar(o.cena, TETO_DA_CENA * 2);
  if (c.length < 12) return null;
  if (c.length <= TETO_DA_CENA) return c;
  const corte = c.slice(0, TETO_DA_CENA);
  const fim = corte.lastIndexOf(". ");
  return (fim > 120 ? corte.slice(0, fim + 1) : corte).trim();
}

// ------------------------------------------------------------------ bloco do prompt

/**
 * Bloco curto e aditivo, logo depois do promptDoReplicar. `indice`: número da
 * imagem da referência 1 no pedido ao gerador. Idêntica: composição quase
 * exata com o assunto trocado; Próxima: composição parecida; Inspirada e
 * Criativa já têm liberdade (o bloco só reforça que a imagem transmite a copy).
 */
export function blocoAdaptarConteudo(e: { fidelidade: FidelidadeDaReferencia; indice: number; cena: string; aproveitar: Aproveitar; kit?: KitDaTrava }): string {
  // Trava da marca: a cena nunca leva fonte, hex ou nome de cor que não sejam do kit do cliente.
  const cena = limpar(neutralizarMarcaDaReferencia(e.cena, e.kit ?? null), TETO_DA_CENA);
  if (!cena) return "";
  const img = `imagem ${e.indice}`;
  const solta = e.fidelidade === "inspirada" || e.fidelidade === "criativa";
  const tipo = e.aproveitar === "so_estetica"
    ? "- O tipo de cena pode mudar; o lugar, a escala e a luz do assunto ficam."
    : "- Mesmo tipo de cena da referência; muda só o que aparece nela.";
  const linhas = solta
    ? [
      "ADAPTAR O CONTEÚDO À MENSAGEM (a imagem desta lâmina transmite o texto dela)",
      e.fidelidade === "inspirada"
        ? `- Da ${img} ficam a família visual e o tratamento; a composição já é nova, como acima.`
        : `- Da ${img} fica só o clima; a ideia e a composição já são novas, como acima.`,
      `- Assunto desta lâmina: ${cena}`,
      "- Isto vale no lugar do assunto do item 4. Nada do assunto da referência entra.",
      "- A imagem transmite a mensagem do texto da lâmina sozinha; o texto exato, a marca e a logo seguem as regras acima.",
    ]
    : [
      "ADAPTAR O CONTEÚDO À MENSAGEM (a referência foi escolhida pela estética; o assunto dela não transmite o texto desta lâmina)",
      e.fidelidade === "proxima"
        ? `- Mantenha a estética da ${img} e uma composição parecida: a mesma grade, o assunto no mesmo espaço, a mesma luz e o mesmo tratamento; pose e enquadramento podem mudar.`
        : `- Mantenha a estética e a composição da ${img} quase exatas: a grade, o lugar e a escala do assunto, o enquadramento, o ângulo da câmera, a luz, o tratamento da foto, a função de cada cor, os elementos gráficos e o espaço vazio.`,
      `- Troque o assunto por: ${cena}`,
      tipo,
      "- Isto vale no lugar do assunto descrito no layout e no item 4. Objetos da cena da referência que não servem à mensagem saem ou viram objetos da cena nova, no mesmo lugar e escala.",
      "- A imagem transmite a mensagem do texto da lâmina sozinha; o texto exato, a marca e a logo seguem as regras acima.",
    ];
  return linhas.join("\n").slice(0, TETO_DO_BLOCO_ADAPTAR);
}

// ------------------------------------------------------------------ orquestração

export type RegistroDaAdaptacao = {
  versao: number;
  adaptou: boolean;
  /** serve, sem_leitura, sem_assunto, jev_falhou, sem_cena, erro */
  motivo: string;
  serve?: number | null;
  aproveitar?: Aproveitar;
  cena?: string;
  guardada?: boolean;
};

export type DepsDaAdaptacao = {
  /** Pasta das leituras do cliente (bucket mesa). */
  pasta: string;
  lerGuardado: (caminho: string) => Promise<Record<string, unknown> | null>;
  guardar: (caminho: string, valor: unknown) => Promise<void>;
  /** Chamada de visão (modelo de leitura) com ESQUEMA_LEITURA_DO_CONTEUDO; devolve o JSON cru. */
  lerPorVisao: () => Promise<unknown>;
  perguntarJev: (state: unknown, questions: Record<string, PerguntaJev>) => Promise<ResultadoJev>;
  /** Registra o gasto do Jev na carteira (não derruba). */
  cobrarJev: (r: ResultadoJev) => Promise<unknown>;
  /** Chamada ao diretor de arte com SISTEMA_DA_CENA e ESQUEMA_DA_CENA; devolve o JSON cru. */
  escreverCena: (pedido: string) => Promise<unknown>;
};

const seguro = (id: string) => id.replace(/[^0-9a-z-]/gi, "-").slice(0, 90);

/** Chave curta e estável (FNV-1a em dois sentidos): não é segurança, é nome de arquivo do cache. */
export function chaveDoTexto(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ s.charCodeAt(s.length - 1 - i), 0x811c9dc5) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

export const caminhoDaLeituraDoConteudo = (pasta: string, refId: string) => `${pasta}/conteudo-${seguro(refId)}.json`;
export const caminhoDaAdaptacao = (pasta: string, refId: string, ctx: ContextoDaLamina) =>
  `${pasta}/adapta-${seguro(refId)}-${chaveDoTexto(`${VERSAO_DA_ADAPTACAO}|${ctx.copy}|${ctx.ideia_da_imagem}|${ctx.conceito}`)}.json`;

/** Leitura da referência (estética e conteúdo), guardada uma vez por referência. Falha: null. */
export async function leituraDoConteudo(refId: string, deps: Pick<DepsDaAdaptacao, "pasta" | "lerGuardado" | "guardar" | "lerPorVisao">): Promise<LeituraDoConteudo | null> {
  try {
    const caminho = caminhoDaLeituraDoConteudo(deps.pasta, refId);
    const guardada = await deps.lerGuardado(caminho);
    if (guardada && guardada.versao === VERSAO_DA_LEITURA_DO_CONTEUDO) return normalizarLeituraDoConteudo(guardada.leitura);
    const bruto = await deps.lerPorVisao();
    const leitura = normalizarLeituraDoConteudo(bruto);
    if (leitura) await deps.guardar(caminho, { versao: VERSAO_DA_LEITURA_DO_CONTEUDO, referencia_id: refId, lido_em: new Date().toISOString(), leitura });
    return leitura;
  } catch (e) {
    registrarFalha("estudio-arte: leitura do conteúdo da referência falhou", e, { referencia_id: refId });
    return null;
  }
}

/**
 * Julga e, se o conteúdo não serve, escreve a cena. Devolve o bloco (vazio =
 * o prompt de hoje) e o registro para a versão. Nunca lança.
 */
export async function adaptacaoDaReferencia(
  e: { refId: string; fidelidade: FidelidadeDaReferencia; indice: number; ctx: ContextoDaLamina; molde: MoldeDaReferencia | null; leitura: LeituraDoConteudo | null; kit?: KitDaTrava },
  deps: DepsDaAdaptacao,
): Promise<{ bloco: string; registro: RegistroDaAdaptacao }> {
  const nada = (motivo: string, extra: Partial<RegistroDaAdaptacao> = {}) => ({ bloco: "", registro: { versao: VERSAO_DA_ADAPTACAO, adaptou: false, motivo, ...extra } });
  try {
    if (!e.leitura) return nada("sem_leitura");
    if (!e.leitura.tem_assunto_visual) return nada("sem_assunto");
    const caminho = caminhoDaAdaptacao(deps.pasta, e.refId, e.ctx);
    const guardada = await deps.lerGuardado(caminho);
    let decisao: Decisao | null = null;
    let cena: string | null = null;
    let deGuardada = false;
    if (guardada && guardada.versao === VERSAO_DA_ADAPTACAO && typeof guardada.serve === "number") {
      decisao = {
        serve: guardada.serve >= LIMIAR_SERVE,
        probabilidade: guardada.serve,
        aproveitar: APROVEITAR.indexOf(guardada.aproveitar as Aproveitar) >= 0 ? guardada.aproveitar as Aproveitar : "estetica_e_tipo_de_cena",
        confianca: null,
      };
      cena = typeof guardada.cena === "string" ? normalizarCena({ cena: guardada.cena }) : null;
      deGuardada = true;
    } else {
      let res: ResultadoJev;
      try {
        res = await deps.perguntarJev(estadoDoJev(e.ctx, e.leitura), PERGUNTAS_DA_ADAPTACAO);
      } catch (err) {
        registrarFalha("estudio-arte: jev da adaptação falhou", err, { referencia_id: e.refId });
        return nada("jev_falhou");
      }
      await deps.cobrarJev(res).catch(() => null);
      decisao = decidirAdaptacao(res.answers);
      if (!decisao) return nada("jev_falhou");
      if (!decisao.serve) cena = normalizarCena(await deps.escreverCena(pedidoDaCena(e.ctx, e.leitura, e.molde, decisao.aproveitar)).catch(nuloComLog("estudio-arte: cena da adaptação não escrita", { referencia_id: e.refId })));
      // Guarda o julgamento (e a cena, quando há): a mesma lâmina com o mesmo texto não paga de novo.
      if (decisao.serve || cena) {
        await deps.guardar(caminho, { versao: VERSAO_DA_ADAPTACAO, referencia_id: e.refId, em: new Date().toISOString(), serve: decisao.probabilidade, aproveitar: decisao.aproveitar, cena });
      }
    }
    if (decisao.serve) return nada("serve", { serve: decisao.probabilidade, guardada: deGuardada });
    if (!cena) return nada("sem_cena", { serve: decisao.probabilidade, aproveitar: decisao.aproveitar });
    const bloco = blocoAdaptarConteudo({ fidelidade: e.fidelidade, indice: e.indice, cena, aproveitar: decisao.aproveitar, kit: e.kit ?? null });
    return {
      bloco,
      registro: { versao: VERSAO_DA_ADAPTACAO, adaptou: !!bloco, motivo: bloco ? "adaptou" : "sem_cena", serve: decisao.probabilidade, aproveitar: decisao.aproveitar, cena, guardada: deGuardada },
    };
  } catch (err) {
    registrarFalha("estudio-arte: adaptação da referência falhou", err, { referencia_id: e.refId });
    return nada("erro");
  }
}
