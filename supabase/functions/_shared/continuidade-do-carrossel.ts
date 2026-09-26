/**
 * Continuidade do carrossel (frente T, 26/09/2026). Puro: sem Deno, sem banco,
 * sem IA. Sem travessão.
 *
 * Pedido do dono: "quero carrossel nessa pegada, com essa continuidade". O
 * agente de estilo lê uma sequência de lâminas (várias imagens em ordem ou um
 * print com as lâminas lado a lado) e guarda num template de carrossel:
 * quantas lâminas, o papel de cada uma (capa, miolo, fechamento), o TIPO de
 * continuidade entre elas, o que cruza cada borda, a hierarquia de texto por
 * lâmina e o ritmo. Na geração, a lâmina N+1 recebe a continuação.
 *
 * Qual caminho dá mais certo com o gerador atual (avaliado em 26/09 contra o
 * código que já roda no Estúdio):
 * - FUNDO OU FOTO QUE ATRAVESSA (panorâmica): gerar a cena inteira UMA vez e
 *   fatiar em código. É o carrossel contínuo que já existe e já foi aprovado
 *   (direcao.carrossel_infinito, preparar_fundo, fatiarTrecho em
 *   imagem-local.ts): o corte é determinístico e a emenda bate no pixel. Só
 *   vale com o GPT Image (modeloFazPanorama) e no 4:5. Com ele ligado, o
 *   template não manda faixa de borda: o panorama já resolve.
 * - ELEMENTO QUE CRUZA A BORDA (fita, forma, seta, objeto recortado): a
 *   lâmina N+1 recebe como referência de encaixe a FAIXA DA BORDA DIREITA da
 *   versão atual da lâmina N (recorte determinístico, faixaDaBorda). O
 *   gerador desenha o texto da lâmina e continua o elemento a partir da borda
 *   esquerda. Panorama aqui não serve: o elemento é gráfico, nasce junto com o
 *   texto de cada lâmina, e a fatia do panorama é só fundo, sem texto.
 * - Panorâmica sem o carrossel contínuo (outro gerador ou outro formato): cai
 *   na faixa da borda, com a instrução de continuar a cena.
 * - Cor ou forma que se repete, linha guia, numeração e narrativa: só texto no
 *   bloco do template (não precisam de imagem da vizinha).
 */

export const TIPOS_DE_CONTINUIDADE = ["panoramica", "elemento_na_borda", "cor_forma_repete", "linha_guia", "numeracao", "narrativa"] as const;
export type TipoDeContinuidade = (typeof TIPOS_DE_CONTINUIDADE)[number];

export const ROTULOS_DA_CONTINUIDADE: Record<TipoDeContinuidade, string> = {
  panoramica: "fundo ou foto que atravessa as lâminas",
  elemento_na_borda: "elemento que cruza a borda e continua na próxima",
  cor_forma_repete: "cor ou forma que se repete",
  linha_guia: "linha ou seta que guia o olho",
  numeracao: "numeração ou barra de progresso",
  narrativa: "narrativa que puxa para a próxima",
};

export type PapelDaLamina = "capa" | "miolo" | "fechamento";
export const PAPEIS_DA_LAMINA: PapelDaLamina[] = ["capa", "miolo", "fechamento"];

/** Uma lâmina lida (ou do template): papel, função, hierarquia de texto e o que sai pela borda direita. */
export type LaminaDoCarrossel = {
  ordem: number;
  papel: PapelDaLamina;
  /** O que esta lâmina faz na sequência ("gancho", "dado", "passo 2"...). */
  funcao: string;
  /** Hierarquia de texto desta lâmina (título, apoio, quantas linhas, tamanho relativo). */
  hierarquia: string;
  /** O que cruza a borda direita e continua na próxima (vazio: nada cruza). */
  corte_direita: string;
  /** Faixa vertical do corte, em % da altura (0 no topo), quando algo cruza. */
  corte_y0: number | null;
  corte_y1: number | null;
};

export type LeituraDaContinuidade = {
  total: number;
  laminas: LaminaDoCarrossel[];
  tipos: TipoDeContinuidade[];
  /** Como a continuidade acontece, em até 2 frases. */
  descricao: string;
  /** Ritmo da sequência (alternância de peso, respiro, onde acelera). */
  ritmo: string;
};

export const MAX_LAMINAS_DO_CARROSSEL = 20;
/** Largura da faixa da borda que vai como referência de encaixe (fração da lâmina). */
export const FRACAO_DA_FAIXA = 0.12;

const umaLinha = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u2014\u2013]/g, ",").replace(/\s+/g, " ").trim().slice(0, max);

const pct = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
};

/** Papel pela posição: 1 é capa, a última é fechamento, o resto é miolo. Post único: capa. */
export function papelPelaOrdem(ordem: number, total: number): PapelDaLamina {
  if (ordem <= 1 || total <= 1) return "capa";
  return ordem >= total ? "fechamento" : "miolo";
}

function normalizarTipos(v: unknown): TipoDeContinuidade[] {
  const saida: TipoDeContinuidade[] = [];
  for (const x of Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;|]/) : []) {
    const s = String(x ?? "").trim().toLowerCase();
    const t = (TIPOS_DE_CONTINUIDADE as readonly string[]).indexOf(s) >= 0 ? (s as TipoDeContinuidade) : null;
    if (t && saida.indexOf(t) < 0) saida.push(t);
  }
  return saida;
}

export function normalizarLamina(v: unknown, ordemPadrao: number, total: number): LaminaDoCarrossel | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ordem = Number.isInteger(Number(o.ordem)) && Number(o.ordem) >= 1 ? Number(o.ordem) : ordemPadrao;
  const papel = PAPEIS_DA_LAMINA.indexOf(o.papel as PapelDaLamina) >= 0 ? (o.papel as PapelDaLamina) : papelPelaOrdem(ordem, total);
  const corte = umaLinha(o.corte_direita, 200);
  let y0 = pct(o.corte_y0);
  let y1 = pct(o.corte_y1);
  if (y0 !== null && y1 !== null && y1 < y0) [y0, y1] = [y1, y0];
  if (!corte || y0 === null || y1 === null || y1 - y0 < 2) {
    y0 = null;
    y1 = null;
  }
  return { ordem, papel, funcao: umaLinha(o.funcao, 160), hierarquia: umaLinha(o.hierarquia, 200), corte_direita: corte, corte_y0: y0, corte_y1: y1 };
}

/**
 * Leitura crua (do leitor por visão ou do template salvo) vira a leitura da
 * continuidade, decidida em código: ordem 1..N sem buraco, papéis coerentes
 * (a primeira é capa, a última fecha), tipos só os conhecidos. Menos de 2
 * lâminas: null (não é carrossel).
 */
export function normalizarContinuidade(bruto: unknown): LeituraDaContinuidade | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const cruas = Array.isArray(o.laminas) ? o.laminas.slice(0, MAX_LAMINAS_DO_CARROSSEL) : [];
  const totalPedido = Number.isInteger(Number(o.total)) ? Number(o.total) : cruas.length;
  const total = Math.max(cruas.length, Math.min(MAX_LAMINAS_DO_CARROSSEL, totalPedido > 0 ? totalPedido : 0));
  if (total < 2) return null;
  const lidas = cruas.map((l, i) => normalizarLamina(l, i + 1, total)).filter((l): l is LaminaDoCarrossel => !!l);
  // Ordem pela posição lida, renumerada 1..N (o leitor às vezes pula ou repete).
  lidas.sort((a, b) => a.ordem - b.ordem);
  const laminas: LaminaDoCarrossel[] = [];
  for (let i = 0; i < total; i++) {
    const base = lidas[i] || { ordem: i + 1, papel: papelPelaOrdem(i + 1, total), funcao: "", hierarquia: "", corte_direita: "", corte_y0: null, corte_y1: null };
    laminas.push({ ...base, ordem: i + 1 });
  }
  laminas[0].papel = "capa";
  laminas[total - 1].papel = "fechamento";
  for (let i = 1; i < total - 1; i++) if (laminas[i].papel !== "miolo") laminas[i].papel = "miolo";
  // A última não tem vizinha à direita.
  laminas[total - 1] = { ...laminas[total - 1], corte_direita: "", corte_y0: null, corte_y1: null };
  const tipos = normalizarTipos(o.tipos);
  // Alguma lâmina diz o que cruza a borda: é continuidade de borda, mesmo que o leitor não tenha marcado.
  if (laminas.some((l) => !!l.corte_direita) && tipos.indexOf("elemento_na_borda") < 0 && tipos.indexOf("panoramica") < 0) tipos.push("elemento_na_borda");
  return { total, laminas, tipos, descricao: umaLinha(o.descricao, 320), ritmo: umaLinha(o.ritmo, 240) };
}

/** A lâmina do template que vale para a posição pedida (mesmo total: pela ordem; senão pelo papel, ciclando o miolo). */
export function laminaParaAOrdem(c: LeituraDaContinuidade | null | undefined, ordem: number, total: number): LaminaDoCarrossel | null {
  if (!c || !c.laminas.length) return null;
  if (c.total === total && c.laminas[ordem - 1]) return c.laminas[ordem - 1];
  const papel = papelPelaOrdem(ordem, total);
  if (papel === "capa") return c.laminas[0];
  if (papel === "fechamento") return c.laminas[c.laminas.length - 1];
  const miolos = c.laminas.filter((l) => l.papel === "miolo");
  if (!miolos.length) return null;
  return miolos[(ordem - 2) % miolos.length];
}

export type EstrategiaDaContinuidade = "panorama_fatiado" | "faixa_da_borda" | "so_texto" | "nenhuma";

/**
 * Como a lâmina recebe a continuidade (ver o cabeçalho). O panorama só quando
 * o carrossel contínuo já está ligado no trabalho (ele é que gera e fatia);
 * senão, continuidade que cruza a borda vira faixa da borda da vizinha.
 */
export function estrategiaDaContinuidade(
  c: LeituraDaContinuidade | null | undefined,
  e: { ordem: number; total: number; panoramaLigado: boolean },
): EstrategiaDaContinuidade {
  if (!c || e.total < 2) return "nenhuma";
  const cruza = c.tipos.indexOf("panoramica") >= 0 || c.tipos.indexOf("elemento_na_borda") >= 0;
  // Com o contínuo ligado, o gerador só desenha texto e logo sobre a fatia: a faixa não serviria.
  if (cruza && e.panoramaLigado) return "panorama_fatiado";
  if (cruza && e.ordem > 1) {
    const anterior = laminaParaAOrdem(c, e.ordem - 1, e.total);
    if (c.tipos.indexOf("panoramica") >= 0 || (anterior && anterior.corte_direita)) return "faixa_da_borda";
  }
  return c.tipos.length ? "so_texto" : "nenhuma";
}

export type Retangulo = { x: number; y: number; largura: number; altura: number };

/**
 * Faixa da borda direita da lâmina anterior (em pixels inteiros): a largura é
 * FRACAO_DA_FAIXA da lâmina (no mínimo 1 px) e a altura inteira. Determinística:
 * a mesma lâmina dá sempre o mesmo recorte.
 */
export function faixaDaBorda(largura: number, altura: number, fracao = FRACAO_DA_FAIXA): Retangulo | null {
  const L = Math.floor(largura);
  const A = Math.floor(altura);
  if (!(L >= 2) || !(A >= 1)) return null;
  const f = Number.isFinite(fracao) && fracao > 0 && fracao < 1 ? fracao : FRACAO_DA_FAIXA;
  const w = Math.max(1, Math.min(L - 1, Math.round(L * f)));
  return { x: L - w, y: 0, largura: w, altura: A };
}

/**
 * Fatias de uma panorâmica de largura total `larguraTotal` em `n` lâminas
 * (pixels inteiros, da esquerda para a direita, sem sobra nem sobreposição; a
 * última leva o resto da divisão). É a mesma conta do fatiarTrecho do
 * carrossel contínuo, escrita aqui sem imagem para ser testada.
 */
export function fatiasDoPanorama(larguraTotal: number, altura: number, n: number): Retangulo[] {
  const L = Math.floor(larguraTotal);
  const A = Math.floor(altura);
  const k = Math.floor(n);
  if (!(k >= 1) || !(L >= k) || !(A >= 1)) return [];
  const w = Math.floor(L / k);
  const saida: Retangulo[] = [];
  for (let i = 0; i < k; i++) saida.push({ x: i * w, y: 0, largura: i === k - 1 ? L - i * w : w, altura: A });
  return saida;
}

/**
 * Texto da continuidade para o bloco do template, na lâmina pedida. Curto:
 * tipo, o que chega da vizinha (com a faixa quando houver) e o que sai por
 * esta borda para a próxima.
 */
export function linhasDaContinuidade(
  c: LeituraDaContinuidade | null | undefined,
  e: { ordem: number; total: number; estrategia: EstrategiaDaContinuidade; indiceDaFaixa: number | null },
): string[] {
  if (!c || e.estrategia === "nenhuma") return [];
  const linhas: string[] = [];
  const tipos = c.tipos.map((t) => ROTULOS_DA_CONTINUIDADE[t]).join("; ");
  if (tipos) linhas.push(`- CONTINUIDADE: ${tipos}${c.descricao ? `. ${c.descricao}` : ""}`);
  if (c.ritmo) linhas.push(`- RITMO: ${c.ritmo}`);
  const anterior = e.ordem > 1 ? laminaParaAOrdem(c, e.ordem - 1, e.total) : null;
  const esta = laminaParaAOrdem(c, e.ordem, e.total);
  if (e.estrategia === "faixa_da_borda" && e.indiceDaFaixa) {
    const o_que = anterior && anterior.corte_direita ? anterior.corte_direita : "a cena";
    linhas.push(`- Imagem ${e.indiceDaFaixa}: faixa da BORDA DIREITA da lâmina anterior. ${o_que} chega por essa borda: continue a partir da borda esquerda desta lâmina, na mesma altura, escala, cor e traço, para as duas se encaixarem lado a lado. Não repita o texto dela.`);
  } else if (e.estrategia === "panorama_fatiado") {
    linhas.push("- O fundo já é a fatia da cena contínua: mantenha a cena como está e ponha o texto por cima.");
  }
  if (esta && esta.corte_direita && e.ordem < e.total && e.estrategia !== "panorama_fatiado") {
    const faixa = esta.corte_y0 !== null && esta.corte_y1 !== null ? ` (entre ${esta.corte_y0}% e ${esta.corte_y1}% da altura)` : "";
    linhas.push(`- Saída pela borda direita${faixa}: ${esta.corte_direita}, cortado pela borda para continuar na próxima lâmina.`);
  }
  return linhas;
}

// ------------------------------------------------------------------ leitura por visão (agente de estilo)

export const SISTEMA_DA_LEITURA_DE_CARROSSEL = `Você lê a SEQUÊNCIA de um carrossel de referência para montar um template reaproveitável. As imagens vêm em ordem (imagem 1 é a primeira lâmina) ou uma imagem só é um print com as lâminas lado a lado ou em grade (leia na ordem, linha por linha, da esquerda para a direita, ignorando cabeçalho de perfil, ícones e barras do aplicativo).
Para cada lâmina diga: papel (capa, miolo ou fechamento), funcao (o que ela faz na sequência, em poucas palavras), hierarquia (título, apoio, quantas linhas, tamanho relativo) e corte_direita (o que cruza a borda direita e continua na próxima: fita, forma, seta, foto, objeto; vazio quando nada cruza), com corte_y0 e corte_y1 (faixa vertical do corte em % da altura, 0 no topo; 0 e 0 quando nada cruza).
tipos: os tipos de continuidade presentes entre panoramica (fundo ou foto que atravessa), elemento_na_borda (elemento gráfico que cruza a borda), cor_forma_repete, linha_guia, numeracao, narrativa.
descricao: como a continuidade acontece, em até 2 frases. ritmo: o ritmo da sequência (onde pesa, onde respira), em 1 frase.
Não copie texto, marca, nome de pessoa nem cor por nome. Português, sem travessão. Responda só com o JSON pedido.`;

export const ESQUEMA_DA_LEITURA_DE_CARROSSEL = {
  nome: "leitura_de_carrossel",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["total", "laminas", "tipos", "descricao", "ritmo"],
    properties: {
      total: { type: "integer" },
      laminas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "papel", "funcao", "hierarquia", "corte_direita", "corte_y0", "corte_y1"],
          properties: {
            ordem: { type: "integer" },
            papel: { type: "string", enum: [...PAPEIS_DA_LAMINA] },
            funcao: { type: "string" },
            hierarquia: { type: "string" },
            corte_direita: { type: "string" },
            corte_y0: { type: "number" },
            corte_y1: { type: "number" },
          },
        },
      },
      tipos: { type: "array", items: { type: "string", enum: [...TIPOS_DE_CONTINUIDADE] } },
      descricao: { type: "string" },
      ritmo: { type: "string" },
    },
  },
};

/** Continuidade em texto (prompt do agente e tela). */
export function continuidadeEmTexto(c: LeituraDaContinuidade | null | undefined): string {
  if (!c) return "";
  const linhas = [`${c.total} lâminas${c.tipos.length ? `; continuidade: ${c.tipos.map((t) => ROTULOS_DA_CONTINUIDADE[t]).join(", ")}` : ""}`];
  if (c.descricao) linhas.push(c.descricao);
  for (const l of c.laminas) {
    const partes = [`${l.ordem}. ${l.papel}`];
    if (l.funcao) partes.push(l.funcao);
    if (l.hierarquia) partes.push(`texto: ${l.hierarquia}`);
    if (l.corte_direita) partes.push(`cruza a borda: ${l.corte_direita}`);
    linhas.push(partes.join("; "));
  }
  if (c.ritmo) linhas.push(`Ritmo: ${c.ritmo}`);
  return linhas.join("\n");
}
