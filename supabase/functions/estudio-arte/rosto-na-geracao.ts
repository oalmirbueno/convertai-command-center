/**
 * Rosto escolhido na referência (frente R, acréscimo do dono, 26/09/2026).
 *
 * Quando a referência tem uma pessoa, a equipe pode escolher o ROSTO de quem
 * vai aparecer: o do cliente ou o do dono e da equipe (rostos autorizados do
 * contexto, cliente_rostos, e clones da Mesa Foto, foto_modelos com origem
 * clone_de_foto_real e autorização válida) ou fotos escolhidas na hora. A
 * geração recria a arte na pegada da referência e do design, com o conteúdo
 * da copy, e a pessoa com o rosto escolhido muito fiel; pose, ângulo,
 * expressão e enquadramento seguem a arte, não a foto.
 *
 * ADITIVO: sem rosto escolhido (direcao.rosto ausente) lerRostoDoTrabalho
 * devolve null, nada é lido e o prompt e as imagens de entrada são byte a
 * byte os de hoje. Com rosto: até 2 fotos entram DEPOIS dos anexos da lâmina
 * (antes das do estilo do cliente), cada uma com o papel nomeado, e um bloco
 * curto ROSTO ESCOLHIDO entra logo depois do bloco da copy. Foto nunca é
 * escurecida.
 *
 * Frente R2 (26/09, pedido do dono: "posso buscar qualquer foto que tiver
 * pessoas, abrir a pasta, o clone já gerado; detalhar sorrindo, assim; e ele
 * varia e compõe com a imagem"):
 * - fonte "escolhidas": 1 a 3 fotos de qualquer pasta do cliente (acervo
 *   "i:", Workspace "w:", Arquivos "a:") ou de um clone ("k:<clone>:<foto>",
 *   foto de origem, variação gerada ou vista da folha), sempre conferidas de
 *   novo na geração (clone só com autorização válida).
 * - `como`: como a pessoa aparece (sorrindo, de perfil...), instrução de pose
 *   e expressão no bloco, mantendo a identidade.
 * - O bloco pede para recriar a pessoa DENTRO da arte, integrada na luz da
 *   arte (cor, direção, dureza, sombra de contato), nunca a luz da foto.
 * - Lâmina normal (sem referência): o rosto vale quando a direção da lâmina
 *   pede pessoa (Noul do Jev, LIMIAR_PEDE_PESSOA). Sem rosto: o de hoje.
 * - Conferência depois de gerar: só aviso (leitura por visão + Noul do Jev),
 *   sem laço de regerar.
 */

import { linhasDaIdentidadeDaFoto } from "../_shared/uso-da-foto.ts";

export type FonteDoRosto = "cliente" | "equipe" | "fotos" | "escolhidas";
export const FONTES_DO_ROSTO: FonteDoRosto[] = ["cliente", "equipe", "fotos", "escolhidas"];
export const MAX_FOTOS_DO_ROSTO = 2;
/** Frente R2: fotos escolhidas nas pastas ou nos clones (1 a 3). */
export const MAX_FOTOS_ESCOLHIDAS = 3;
export const MAX_COMO_DO_ROSTO = 160;

export type RostoEscolhido = {
  fonte: FonteDoRosto;
  /** cliente e equipe: "r:<uuid>" (rosto do contexto) ou "c:<uuid>" (clone da Mesa Foto). */
  id?: string;
  /** fotos: caminhos no bucket mesa, na pasta do cliente (até 2). */
  fotos?: string[];
  /** escolhidas: "i:<uuid>" acervo, "w:<uuid>" Workspace, "a:<uuid>" Arquivos, "k:<clone>:<foto>" clone (até 3). */
  itens?: string[];
  /** Como a pessoa aparece (pose e expressão), texto curto da equipe. */
  como?: string;
  /** Rosto em evidência na composição. */
  destacar?: boolean;
};

const UUID_TXT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_TXT}$`, "i");
const ID_DO_ROSTO = new RegExp(`^[rc]:${UUID_TXT}$`, "i");
const ITEM_ESCOLHIDO = new RegExp(`^(?:[iwa]:${UUID_TXT}|k:${UUID_TXT}:${UUID_TXT})$`, "i");

export const ehIdDoRosto = (v: unknown): v is string => typeof v === "string" && ID_DO_ROSTO.test(v);
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const ehItemEscolhido = (v: unknown): v is string => typeof v === "string" && ITEM_ESCOLHIDO.test(v);

export type TipoDoItem = "acervo" | "workspace" | "arquivo" | "clone";

/** O item escolhido desmontado: de onde vem e os ids. Inválido: null. */
export function lerItemEscolhido(id: string): { tipo: TipoDoItem; id: string; clone?: string } | null {
  if (!ehItemEscolhido(id)) return null;
  const s = id.toLowerCase();
  if (s.indexOf("k:") === 0) return { tipo: "clone", clone: s.slice(2, 38), id: s.slice(39) };
  const tipo: TipoDoItem = s[0] === "i" ? "acervo" : s[0] === "w" ? "workspace" : "arquivo";
  return { tipo, id: s.slice(2) };
}

/** Texto do "como a pessoa aparece": uma linha, sem travessão, até MAX_COMO_DO_ROSTO. */
export function lerComoDoRosto(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[—–]/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COMO_DO_ROSTO)
    .trim();
}

/**
 * Lê o rosto do trabalho (JSON do banco ou do configurar). Inválido ou
 * incompleto vira null (sem rosto). `clientId`: as fotos na hora só valem na
 * pasta deste cliente.
 */
export function normalizarRosto(v: unknown, clientId: string): RostoEscolhido | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const fonte = FONTES_DO_ROSTO.indexOf(o.fonte as FonteDoRosto) >= 0 ? (o.fonte as FonteDoRosto) : null;
  if (!fonte) return null;
  const destacar = o.destacar === true;
  const como = lerComoDoRosto(o.como);
  const extras = { ...(como ? { como } : {}), ...(destacar ? { destacar } : {}) };
  if (fonte === "fotos") {
    const fotos = (Array.isArray(o.fotos) ? o.fotos : [])
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((c) => !!c && c.indexOf(`${clientId}/`) === 0 && c.indexOf("..") < 0 && c.length <= 300)
      .filter((c, i, l) => l.indexOf(c) === i)
      .slice(0, MAX_FOTOS_DO_ROSTO);
    return fotos.length ? { fonte, fotos, ...extras } : null;
  }
  if (fonte === "escolhidas") {
    const itens = (Array.isArray(o.itens) ? o.itens : [])
      .filter(ehItemEscolhido)
      .map((x) => x.toLowerCase())
      .filter((c, i, l) => l.indexOf(c) === i)
      .slice(0, MAX_FOTOS_ESCOLHIDAS);
    return itens.length ? { fonte, itens, ...extras } : null;
  }
  return ehIdDoRosto(o.id) ? { fonte, id: String(o.id).toLowerCase(), ...extras } : null;
}

/** O rosto que vale no trabalho: direcao.rosto normalizado, ou null (o de hoje). */
export function lerRostoDoTrabalho(direcao: unknown, clientId: string): RostoEscolhido | null {
  if (!direcao || typeof direcao !== "object") return null;
  return normalizarRosto((direcao as Record<string, unknown>).rosto, clientId);
}

/** Quantas fotos o rosto pode pedir: 3 nas escolhidas, 2 nas outras fontes. */
export const maxFotosDoRosto = (r: Pick<RostoEscolhido, "fonte"> | null | undefined): number =>
  r && r.fonte === "escolhidas" ? MAX_FOTOS_ESCOLHIDAS : MAX_FOTOS_DO_ROSTO;

/**
 * Espelho de autorizacaoValida (mesa-foto/clones-regras.ts): confirmada, sem
 * revogação e dentro da validade. Sem ela o clone não entra na lâmina.
 */
export function autorizacaoDoCloneValida(a: unknown, hoje: string = new Date().toISOString().slice(0, 10)): boolean {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  if (x.confirmada !== true) return false;
  if (x.revogada_em) return false;
  if (typeof x.validade === "string" && x.validade && x.validade < hoje) return false;
  return true;
}

/** Espelho de vistaArquivada (mesa-foto/clones-edicao.ts): vista da folha apagada não entra. */
export function vistaDoCloneArquivada(v: { arquivada_em?: unknown; avisos?: unknown } | null | undefined): boolean {
  if (!v) return true;
  if (v.arquivada_em) return true;
  return (Array.isArray(v.avisos) ? v.avisos : []).some((a) => String(a).indexOf("arquivada_em:") === 0);
}

/** O clone pode dar rosto: é clone, não está arquivado e a autorização vale. */
export function cloneUsavel(c: { origem?: unknown; status?: unknown; autorizacao?: unknown } | null | undefined, hoje?: string): boolean {
  return !!c && c.origem === "clone_de_foto_real" && c.status !== "arquivada" && autorizacaoDoCloneValida(c.autorizacao, hoje);
}

/**
 * Foto do acervo ligada a clones (variação com a tag clone:<id> ou foto de
 * origem de algum clone): só entra se ao menos um desses clones ainda vale.
 * Sem clone ligado: foto comum do cliente (a equipe confirmou a autorização).
 */
export function fotoDoAcervoLiberada(clonesLigados: { origem?: unknown; status?: unknown; autorizacao?: unknown }[], hoje?: string): boolean {
  if (!clonesLigados.length) return true;
  return clonesLigados.some((c) => cloneUsavel(c, hoje));
}

/** Ids de clone nas tags de uma foto do acervo (clone:<uuid>). */
export function clonesNasTags(tags: unknown): string[] {
  return (Array.isArray(tags) ? tags : [])
    .map((t) => String(t))
    .filter((t) => t.indexOf("clone:") === 0 && ehUuid(t.slice(6)))
    .map((t) => t.slice(6).toLowerCase());
}

/**
 * Quantas fotos do rosto cabem: até 2 (ou `max`), dentro do limite de imagens
 * de entrada do modelo. Ordem de prioridade (dono): os anexos da lâmina (com a
 * referência) já estão na conta; depois o rosto; o estilo do cliente fica com
 * o que sobrar.
 */
export function vagasDoRosto(e: { usadas: number; limiteDoModelo: number; pedidas: number; max?: number }): number {
  const limite = Math.max(0, Math.floor(e.limiteDoModelo));
  const teto = typeof e.max === "number" && e.max > 0 ? Math.floor(e.max) : MAX_FOTOS_DO_ROSTO;
  return Math.max(0, Math.min(teto, e.pedidas, limite - e.usadas));
}

/**
 * Lâmina normal com rosto (frente R2): a referência automática da marca
 * (anexo "identidade") cede a vaga quando não sobra lugar para as fotos do
 * rosto. Ordem do dono: lâmina, rosto, referência, estilo e template.
 */
export function referenciaCedeAoRosto(e: { anexos: number; limiteDoModelo: number; pedidas: number }): boolean {
  return e.pedidas > 0 && Math.floor(e.limiteDoModelo) - e.anexos < e.pedidas;
}

export const ROTULO_DA_FOTO_DO_ROSTO =
  "identidade do rosto escolhido pela equipe: manter os traços desta pessoa; não copiar a pose, o fundo, a roupa nem a luz desta foto";

/** Pílulas de "como a pessoa aparece" (a tela mostra; o texto vai como está). */
export const SUGESTOES_DO_COMO = ["sorrindo", "séria confiante", "apontando para o título", "de perfil", "meio corpo", "rosto em destaque"];

/**
 * Bloco curto do prompt. `indices`: números das imagens com o rosto;
 * `pessoaNaReferencia`: o molde leu uma pessoa como assunto da referência.
 * `modo`: "replicar" (padrão, com referência) ou "lamina" (lâmina normal).
 * `como`: pose e expressão pedidas pela equipe.
 */
export function blocoDoRosto(e: { indices: number[]; destacar: boolean; pessoaNaReferencia: boolean; como?: string; modo?: "replicar" | "lamina"; daFoto?: boolean }): string {
  if (!e.indices.length) return "";
  const imgs = e.indices.length === 1 ? `imagem ${e.indices[0]}` : `imagens ${e.indices.slice(0, -1).join(", ")} e ${e.indices[e.indices.length - 1]}`;
  const lamina = e.modo === "lamina";
  const como = lerComoDoRosto(e.como);
  return [
    "ROSTO ESCOLHIDO PELA EQUIPE (identidade da pessoa desta lâmina)",
    `- A pessoa desta lâmina é a ${e.indices.length === 1 ? "da" : "das"} ${imgs}: o mesmo rosto, feições, olhos, nariz, boca, sobrancelhas, tom de pele, cabelo e idade, muito fiel. É ela, não alguém parecido.`,
    `- Dessas fotos vem só a identidade. A pose, o ângulo, a expressão, o enquadramento, a roupa, o fundo e a luz seguem a arte (${lamina ? "a direção desta lâmina" : "a referência e a cena desta lâmina"}), não as fotos.`,
    como
      ? `- COMO ELA APARECE (pedido da equipe): ${como}. Faça essa pose e essa expressão com naturalidade; o rosto continua o das fotos.`
      : "",
    "- RECRIE a pessoa dentro da composição, nunca a foto recortada e colada: pose, gesto, direção do olhar e enquadramento escolhidos para combinar com o layout e deixar o texto livre e legível.",
    // Frente RO (29/09): foto da lâmina no modo "Usar o rosto": a frase do dono e a cena nova pela direção.
    ...(e.daFoto ? linhasDaIdentidadeDaFoto() : []),
    lamina
      ? "- Ela é a pessoa da cena desta lâmina, no lugar e na escala que a direção pede para a pessoa."
      : e.pessoaNaReferencia
      ? "- Ela entra no lugar da pessoa da referência, no mesmo espaço e na mesma escala; a pessoa da referência nunca aparece."
      : "- Ela é a pessoa em cena, no lugar e na escala do assunto da referência.",
    "- INTEGRADA NA LUZ DA ARTE, não na da foto: a mesma cor, direção e dureza da luz do cenário no rosto, no cabelo e na roupa, reflexos coerentes, sombra de contato onde ela encosta ou pousa, e a mesma nitidez, grão e tratamento de cor da arte. Sem contorno, halo ou cara de recorte.",
    "- Luz da cena no rosto, sem escurecer a foto e sem filtro que mude o rosto; uma pessoa só com este rosto.",
    e.destacar
      ? "- ROSTO EM EVIDÊNCIA: o rosto dela é o ponto focal da lâmina, grande e nítido, sem texto nem elemento por cima dele."
      : "",
  ].filter(Boolean).join("\n");
}

// ------------------------------------------------ lâmina normal: pede pessoa?

/** Probabilidade de "sim" do Jev a partir da qual a lâmina normal leva o rosto. */
export const LIMIAR_PEDE_PESSOA = 0.5;

/** Estado nomeado para o Jev: a direção da lâmina (sem o rosto, que é só identidade). */
export function estadoDaPessoaNaLamina(e: { funcao?: string | null; texto_exato?: string | null; composicao?: string | null; imagem?: string | null; ilustracao?: string | null; ponto_focal?: string | null; conceito?: string | null; destacar?: boolean; como?: string | null }) {
  const t = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  return {
    lamina: {
      funcao: t(e.funcao, 60),
      texto: t(e.texto_exato, 600),
      composicao: t(e.composicao, 600),
      imagem: t(e.imagem, 400),
      ilustracao: t(e.ilustracao, 400),
      ponto_focal: t(e.ponto_focal, 200),
    },
    conceito: t(e.conceito, 400),
    pedido_da_equipe: { rosto_em_destaque: !!e.destacar, como_a_pessoa_aparece: t(e.como, MAX_COMO_DO_ROSTO) },
  };
}

export const PERGUNTA_PEDE_PESSOA = {
  type: "noul" as const,
  instructions:
    "Pela direção da lâmina em `lamina` (composição, imagem, ilustração e ponto focal) e pelo `conceito`, a cena desta lâmina tem uma pessoa em cena (retrato, pessoa fazendo algo, rosto, meio corpo), ou a equipe pediu o rosto em destaque ou uma pose em `pedido_da_equipe`?",
  criteria: {
    true: "Sim: a imagem pede uma pessoa (ou a equipe pediu rosto em destaque ou uma pose da pessoa).",
    false: "Não: a lâmina é só texto, fundo, objeto, produto, ambiente sem gente, gráfico ou ícone.",
  },
};

/** Decisão do código sobre a probabilidade do Jev (null = falhou: fica como hoje, sem rosto). */
export const laminaPedePessoa = (p: number | null): boolean => p != null && p >= LIMIAR_PEDE_PESSOA;

// ------------------------------------------------ leitura "tem pessoa" (pastas)

export const MAX_FOTOS_POR_LEITURA = 12;
export const VERSAO_DA_LEITURA_DE_PESSOAS = 1;

export type LeituraDePessoa = { pessoa: boolean; rosto: boolean; lido_em?: string };

export const ESQUEMA_PESSOAS_NAS_FOTOS = {
  nome: "pessoas_nas_fotos",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["fotos"],
    properties: {
      fotos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["imagem", "pessoa", "rosto_visivel"],
          properties: {
            imagem: { type: "integer" },
            pessoa: { type: "boolean" },
            rosto_visivel: { type: "boolean" },
          },
        },
      },
    },
  },
};

export const SISTEMA_PESSOAS_NAS_FOTOS = `Você olha fotos de um cliente e marca, para cada imagem (numeradas na ordem, a partir de 1):
- pessoa: se aparece uma pessoa de verdade (foto), mesmo pequena ou de costas. Ilustração, desenho, manequim e logo não contam.
- rosto_visivel: se o rosto de alguma pessoa aparece nítido o bastante para reconhecer os traços (de frente ou três quartos).
Não identifique ninguém e não descreva as pessoas. Responda só com o JSON pedido.`;

/** Normaliza a resposta da leitura em ids (a ordem das imagens enviadas). */
export function leiturasDePessoas(bruto: unknown, ids: string[], agora: string): Record<string, LeituraDePessoa> {
  const saida: Record<string, LeituraDePessoa> = {};
  const fotos = bruto && typeof bruto === "object" && Array.isArray((bruto as { fotos?: unknown }).fotos) ? (bruto as { fotos: unknown[] }).fotos : [];
  for (const f of fotos) {
    if (!f || typeof f !== "object") continue;
    const x = f as Record<string, unknown>;
    const n = Number(x.imagem);
    if (!Number.isInteger(n) || n < 1 || n > ids.length) continue;
    const pessoa = x.pessoa === true;
    saida[ids[n - 1]] = { pessoa, rosto: pessoa && x.rosto_visivel === true, lido_em: agora };
  }
  return saida;
}

// ------------------------------------------------ conferência (só aviso)

/** Probabilidade de "outra pessoa" a partir da qual a tela avisa. Só aviso: nada é refeito. */
export const LIMIAR_AVISO_DO_ROSTO = 0.5;

export const ESQUEMA_CONFERENCIA_DO_ROSTO = {
  nome: "conferencia_do_rosto",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["pessoa_na_arte", "nas_fotos", "na_arte", "impressao_geral"],
    properties: {
      pessoa_na_arte: { type: "boolean" },
      nas_fotos: { type: "string" },
      na_arte: { type: "string" },
      impressao_geral: { type: "string" },
    },
  },
};

export const SISTEMA_CONFERENCIA_DO_ROSTO = `Você confere a identidade numa arte. A PRIMEIRA imagem é a arte gerada; as OUTRAS são fotos reais da pessoa que devia aparecer nela (são a verdade).
Não identifique a pessoa e não diga quem ela é. Diga:
- pessoa_na_arte: se a arte tem uma pessoa com o rosto visível.
- nas_fotos: formato do rosto, olhos, nariz, boca, sobrancelhas, tom de pele, cabelo e idade aparente nas fotos reais, em frases curtas.
- na_arte: os mesmos traços da pessoa da arte.
- impressao_geral: se parece a mesma pessoa ou outra, e por quê (pose, luz, expressão e roupa diferentes são esperadas e não contam).
Português do Brasil, sem travessão. Só o JSON pedido.`;

/**
 * Frente RO (29/09): no modo "Usar o rosto" (foto da lâmina) a mesma leitura
 * também diz se a pose, o ângulo e o enquadramento ficaram iguais aos da foto
 * (a foto colada). Só aviso; fora desse modo o esquema de sempre.
 */
export const ESQUEMA_CONFERENCIA_DO_ROSTO_COM_POSE = {
  nome: "conferencia_do_rosto_com_pose",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["pessoa_na_arte", "nas_fotos", "na_arte", "impressao_geral", "pose_igual_a_foto"],
    properties: {
      pessoa_na_arte: { type: "boolean" },
      nas_fotos: { type: "string" },
      na_arte: { type: "string" },
      impressao_geral: { type: "string" },
      pose_igual_a_foto: { type: "boolean" },
    },
  },
};

export const SISTEMA_CONFERENCIA_DO_ROSTO_COM_POSE = `${SISTEMA_CONFERENCIA_DO_ROSTO.replace("Português do Brasil, sem travessão. Só o JSON pedido.", "")}- pose_igual_a_foto: verdadeiro se a pessoa da arte está na MESMA pose, ângulo da cabeça, expressão e enquadramento da primeira foto real, como se a foto tivesse sido recortada e colada na arte; falso se a pose ou o enquadramento mudaram.
Português do Brasil, sem travessão. Só o JSON pedido.`;

export const PERGUNTA_OUTRA_PESSOA = {
  type: "noul" as const,
  instructions:
    "Pelas descrições em `conferencia` (traços nas fotos reais em `nas_fotos`, que são a verdade, e na arte em `na_arte`, mais a `impressao_geral`), a arte mostra OUTRA pessoa, e não a pessoa das fotos reais?",
  criteria: {
    true: "Sim: traços centrais (formato do rosto, olhos, nariz, boca) diferem ou a impressão geral diz que é outra pessoa.",
    false: "Não: é a mesma pessoa, com diferenças de pose, luz, expressão, roupa ou cabelo arrumado de outro jeito.",
  },
};

export type ConferenciaDoRosto = {
  outra_pessoa: number | null;
  aviso: boolean;
  /** Frente RO: modo "Usar o rosto" com a pose igual à da foto (só aviso). */
  pose_copiada?: boolean;
  /** Frente RO: erro do alinhamento entre a arte e a foto (baixo = pixels colados). */
  erro_da_pose?: number | null;
  sem_pessoa?: boolean;
  resumo: string;
  conferida_em: string;
  custo_usd: number;
  erro?: string | null;
};

/** O que a tela mostra, só aviso: sem pessoa na arte, ou outra pessoa pelo Jev. */
export function avisoDaConferencia(e: { pessoaNaArte: boolean | null; outraPessoa: number | null }): { aviso: boolean; texto: string } {
  if (e.pessoaNaArte === false) return { aviso: true, texto: "A arte saiu sem a pessoa escolhida. Confira antes de aprovar." };
  if (e.outraPessoa != null && e.outraPessoa >= LIMIAR_AVISO_DO_ROSTO) return { aviso: true, texto: "O rosto pode não ser o da pessoa escolhida. Confira antes de aprovar." };
  if (e.outraPessoa == null) return { aviso: false, texto: "Conferência do rosto indisponível. Confira a olho." };
  return { aviso: false, texto: "Rosto conferido: parece a mesma pessoa." };
}
