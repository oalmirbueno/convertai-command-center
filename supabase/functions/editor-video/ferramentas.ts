/**
 * Núcleo PURO da função editor-video (frente V-B, 26/09): o que a tela e a
 * função precisam concordar, sem Deno e sem banco (a tela importa daqui, como
 * faz com _shared/projeto-de-edicao.ts).
 *
 * 1. Agente editor: laço de ferramentas no padrão dos agentes de código
 *    abertos (Claude Code, Codex CLI): o modelo planeja, pede ferramentas
 *    tipadas, a TELA executa (as operações são funções puras da linha do tempo)
 *    e devolve o resultado; o modelo confere e segue ou termina. Travas: no
 *    máximo MAX_PASSOS chamadas ao modelo e MAX_FERRAMENTAS ferramentas por
 *    pedido, teto de custo por sessão, e nada muda o projeto de verdade antes
 *    do Aplicar do dono.
 * 2. Timestamp: preço, partes do áudio e o deslocamento de tempo de cada parte
 *    (determinístico: palavra da parte n ganha exatamente o início da parte).
 * 3. Visão: o que o modelo viu só vale nos tempos dos quadros que ele recebeu.
 */

export const MAX_PASSOS = 6;
export const MAX_FERRAMENTAS = 12;
export const TETO_PADRAO_USD = 0.5;
export const TETO_MAXIMO_USD = 5;
export const MAX_QUADROS_POR_CHAMADA = 12;
export const MAX_QUADROS_POR_FONTE = 48;
export const MAX_BYTES_DO_QUADRO = 200_000;
export const MAX_TEXTO_DO_PEDIDO = 1500;
export const MAX_CONTEXTO_CHARS = 60_000;

// ------------------------------------------------------------------ ferramentas do agente

export interface DefinicaoDeFerramenta {
  nome: string;
  descricao: string;
  /** Argumentos em texto (vai no prompt; o modelo devolve argumentos_json). */
  argumentos: string;
  /** Só lê (não muda o projeto). */
  leitura: boolean;
}

export const FERRAMENTAS_DO_AGENTE: DefinicaoDeFerramenta[] = [
  { nome: "ler_projeto", descricao: "Lista trilhas e clipes com apelidos (c1, c2) e tempos exatos.", argumentos: "{}", leitura: true },
  { nome: "ler_fala", descricao: "Palavras ditas num trecho da linha do tempo, com tempo.", argumentos: '{"de_s": number, "ate_s": number}', leitura: true },
  { nome: "ler_visao", descricao: "O que aparece num trecho (descrição por trecho já vista). Só isso vale como imagem.", argumentos: '{"de_s": number, "ate_s": number}', leitura: true },
  { nome: "dividir", descricao: "Divide um clipe num ponto da linha do tempo.", argumentos: '{"clipe": "c3", "em_s": number}', leitura: false },
  { nome: "aparar", descricao: "Move o início ou o fim de um clipe para um tempo da linha.", argumentos: '{"clipe": "c3", "lado": "inicio"|"fim", "tempo_s": number}', leitura: false },
  { nome: "mover", descricao: "Muda onde o clipe começa na linha do tempo.", argumentos: '{"clipe": "c3", "inicio_s": number}', leitura: false },
  { nome: "remover", descricao: "Tira um clipe; com ondular, o resto encosta.", argumentos: '{"clipe": "c3", "ondular": boolean}', leitura: false },
  { nome: "recortar", descricao: "Tira um trecho da FONTE de um clipe (tempos da fonte).", argumentos: '{"clipe": "c3", "de_s": number, "ate_s": number}', leitura: false },
  { nome: "ajustar", descricao: "Muda velocidade (0.25 a 4), volume (0 a 2), zoom {de, para} ou nota de um clipe.", argumentos: '{"clipe": "c3", "velocidade"?: number, "volume"?: number, "zoom"?: {"de": number, "para": number} | null, "nota"?: string}', leitura: false },
  { nome: "inserir_texto", descricao: "Texto na tela (trilha texto) num trecho.", argumentos: '{"inicio_s": number, "duracao_s": number, "texto": string}', leitura: false },
  { nome: "reordenar", descricao: "Nova ordem da trilha de vídeo, com todos os apelidos dela.", argumentos: '{"ordem": ["c2", "c1", "c3"]}', leitura: false },
  { nome: "fechar_buracos", descricao: "Encosta os clipes da trilha de vídeo.", argumentos: "{}", leitura: false },
  {
    nome: "aplicar_skill",
    descricao: "Roda uma skill determinística: brabo, cortar_silencios, legendas, punch_in, organizar_por_roteiro, antes_depois, fechar_buracos, transicoes_suaves.",
    argumentos: '{"skill": string, "parametros"?: object, "selecionados"?: ["c1", "c2"]}',
    leitura: false,
  },
];

export const NOMES_DAS_FERRAMENTAS = FERRAMENTAS_DO_AGENTE.map((f) => f.nome);

export interface ChamadaDeFerramenta {
  ferramenta: string;
  argumentos: Record<string, unknown>;
}

export interface RespostaDoPasso {
  plano: string;
  chamadas: ChamadaDeFerramenta[];
  resposta: string;
  terminou: boolean;
  /** Chamadas cortadas pelo limite ou recusadas (nome desconhecido, JSON quebrado). */
  recusadas: string[];
}

/** Esquema da resposta do modelo (estrito: argumentos vão como texto JSON). */
export const ESQUEMA_DO_PASSO = {
  nome: "passo_do_editor",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["plano", "chamadas", "resposta", "terminou"],
    properties: {
      plano: { type: "string" },
      chamadas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ferramenta", "argumentos_json"],
          properties: { ferramenta: { type: "string", enum: NOMES_DAS_FERRAMENTAS }, argumentos_json: { type: "string" } },
        },
      },
      resposta: { type: "string" },
      terminou: { type: "boolean" },
    },
  },
};

/** Lê e confere a resposta do modelo; corta no que ainda cabe de ferramentas. */
export function lerPasso(bruto: unknown, cabem: number): RespostaDoPasso {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const recusadas: string[] = [];
  const chamadas: ChamadaDeFerramenta[] = [];
  (Array.isArray(o.chamadas) ? o.chamadas : []).forEach((c) => {
    const x = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const nome = String(x.ferramenta || "");
    if (NOMES_DAS_FERRAMENTAS.indexOf(nome) < 0) {
      recusadas.push(`${nome || "sem nome"}: ferramenta desconhecida`);
      return;
    }
    let argumentos: Record<string, unknown> = {};
    const bruta = x.argumentos_json !== undefined ? x.argumentos_json : x.argumentos;
    if (typeof bruta === "string") {
      try {
        const j = bruta.trim() ? JSON.parse(bruta) : {};
        argumentos = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
      } catch {
        recusadas.push(`${nome}: argumentos não são JSON`);
        return;
      }
    } else if (bruta && typeof bruta === "object") argumentos = bruta as Record<string, unknown>;
    if (chamadas.length >= cabem) {
      recusadas.push(`${nome}: passou do limite de ferramentas`);
      return;
    }
    chamadas.push({ ferramenta: nome, argumentos });
  });
  return {
    plano: String(o.plano || "").slice(0, 1200),
    chamadas,
    resposta: String(o.resposta || "").slice(0, 2000),
    terminou: o.terminou === true || chamadas.length === 0,
    recusadas,
  };
}

export interface LimitesDoPedido {
  passo: number;
  ferramentasUsadas: number;
  gastoUsd: number;
  tetoUsd: number;
}

/** Motivo para parar antes de chamar o modelo de novo (null = pode seguir). */
export function motivoParaParar(l: LimitesDoPedido): string | null {
  if (l.passo > MAX_PASSOS) return `Chegou ao limite de ${MAX_PASSOS} passos neste pedido.`;
  if (l.ferramentasUsadas >= MAX_FERRAMENTAS) return `Chegou ao limite de ${MAX_FERRAMENTAS} ferramentas neste pedido.`;
  if (l.gastoUsd >= l.tetoUsd) return `Chegou ao teto de US$ ${l.tetoUsd.toFixed(2)} deste pedido.`;
  return null;
}

export const tetoValido = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.min(TETO_MAXIMO_USD, Math.round(n * 100) / 100) : TETO_PADRAO_USD;
};

export function sistemaDoAgente(): string {
  return [
    "Você é o agente editor de vídeo da Aceleriq, dentro de um editor com linha do tempo.",
    "Você edita SÓ com as ferramentas abaixo. Quem mexe nos tempos é o código; você escolhe e parametriza.",
    "Regras: fale português do Brasil, frases curtas, sem travessão. Clipes são citados SÓ por apelido (c1, c2); nunca invente id.",
    "Use tempos exatos que você leu (ler_projeto, ler_fala). Sobre imagem, só afirme o que está em ler_visao, citando o tempo. Não viu: diga que não viu.",
    "Planeje, chame as ferramentas, confira o resultado que volta e termine. Prefira uma skill determinística quando ela faz o pedido inteiro.",
    `Limites: até ${MAX_PASSOS} passos e ${MAX_FERRAMENTAS} ferramentas por pedido. Nada é aplicado sem o dono clicar em Aplicar.`,
    "Responda sempre no JSON pedido: plano (uma frase), chamadas (ferramenta + argumentos_json), resposta (o que fez ou o que falta, curto) e terminou.",
    "Ferramentas:",
    ...FERRAMENTAS_DO_AGENTE.map((f) => `- ${f.nome} ${f.argumentos}: ${f.descricao}`),
  ].join("\n");
}

// ------------------------------------------------------------------ custo (estimativa antes)

export interface PrecoDoModelo {
  preco_entrada_1m: number | null;
  preco_saida_1m: number | null;
}

const SAIDA_POR_RACIOCINIO: Record<string, number> = { none: 1200, minimal: 1500, low: 2500, medium: 5000, high: 10000, xhigh: 16000, max: 24000 };

/** Estimativa de um passo do agente (tokens ~ caracteres / 4), pela tabela do catálogo. */
export function estimarPasso(m: PrecoDoModelo, caracteresDeEntrada: number, raciocinio?: string | null): number {
  const entrada = Math.ceil(caracteresDeEntrada / 4) + 1800;
  const saida = SAIDA_POR_RACIOCINIO[String(raciocinio || "")] || 2500;
  const pe = Number(m.preco_entrada_1m) || 0;
  const ps = Number(m.preco_saida_1m) || 0;
  return Math.round(((entrada * pe + saida * ps) / 1e6) * 10000) / 10000;
}

/** Sugestão (só sugestão: quem decide é o dono) de modelo mais barato que dá conta. */
export function sugerirModeloMaisBarato<T extends PrecoDoModelo & { id: string }>(modelos: T[], atual: string, precisaDeImagem: boolean, aceitaImagem: (m: T) => boolean): T | null {
  const custo = (m: T) => (Number(m.preco_entrada_1m) || 0) * 3 + (Number(m.preco_saida_1m) || 0);
  const esse = modelos.find((m) => m.id === atual);
  if (!esse) return null;
  const candidatos = modelos.filter((m) => m.id !== atual && (!precisaDeImagem || aceitaImagem(m)) && custo(m) < custo(esse) * 0.5);
  if (!candidatos.length) return null;
  return candidatos.sort((a, b) => custo(a) - custo(b))[0];
}

// ------------------------------------------------------------------ timestamp

export const PROVEDORES_DE_TIMESTAMP = {
  whisper: {
    rotulo: "OpenAI Whisper (palavra por palavra)",
    modelo: "whisper-1",
    usd_por_minuto: 0.006,
    fonte: "https://developers.openai.com/api/docs/guides/speech-to-text (whisper-1: timestamp_granularities word)",
  },
  alinhamento: {
    rotulo: "ElevenLabs Forced Alignment via fal (texto dado + áudio, palavra e letra)",
    modelo: "fal-ai/elevenlabs/forced-alignment",
    usd_por_hora_iniciada: 0.22,
    fonte: "https://fal.ai/models/fal-ai/elevenlabs/forced-alignment",
  },
} as const;

export type ModoDoTimestamp = "transcrever" | "alinhar";

/** Custo antes de gastar. Whisper cobra por minuto (arredonda para cima o segundo); alinhamento por hora iniciada. */
export function custoDoTimestamp(modo: ModoDoTimestamp, duracaoS: number): number {
  const d = Math.max(0, Number(duracaoS) || 0);
  if (modo === "alinhar") return Math.round(Math.max(1, Math.ceil(d / 3600)) * PROVEDORES_DE_TIMESTAMP.alinhamento.usd_por_hora_iniciada * 10000) / 10000;
  return Math.round((Math.ceil(d) / 60) * PROVEDORES_DE_TIMESTAMP.whisper.usd_por_minuto * 10000) / 10000;
}

export interface PalavraComTempo {
  t: string;
  i: number;
  f: number;
}

/** Palavras da parte n levadas para o tempo da fonte: soma o início da parte (exato, 3 casas). */
export function deslocarPalavras(palavras: { t?: unknown; text?: unknown; word?: unknown; i?: unknown; f?: unknown; start?: unknown; end?: unknown }[], inicioDaParte: number): PalavraComTempo[] {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const saida: PalavraComTempo[] = [];
  palavras.forEach((w) => {
    const t = String(w.t !== undefined ? w.t : w.word !== undefined ? w.word : w.text !== undefined ? w.text : "").trim();
    const i = Number(w.i !== undefined ? w.i : w.start);
    const f = Number(w.f !== undefined ? w.f : w.end);
    if (!t || !isFinite(i) || !isFinite(f) || f < i) return;
    saida.push({ t: t.slice(0, 120), i: r3(inicioDaParte + i), f: r3(inicioDaParte + Math.max(f, i + 0.01)) });
  });
  return saida;
}

/** Junta partes (ordem por início) e tira palavra repetida na emenda (mesmo texto começando antes do fim da anterior). */
export function juntarPartes(partes: PalavraComTempo[][]): PalavraComTempo[] {
  const todas = partes.reduce((a, p) => a.concat(p), [] as PalavraComTempo[]).sort((a, b) => a.i - b.i || a.f - b.f);
  const saida: PalavraComTempo[] = [];
  todas.forEach((w) => {
    const u = saida.length ? saida[saida.length - 1] : null;
    if (u && u.t === w.t && w.i < u.f) return;
    saida.push(w);
  });
  return saida;
}

/** Linhas prontas para legenda: até `maxPalavras` e quebra em pausa ou fim de frase. */
export function linhasDeLegenda(palavras: PalavraComTempo[], maxPalavras = 6, pausa = 0.6): { texto: string; i: number; f: number }[] {
  const linhas: { texto: string; i: number; f: number }[] = [];
  let atual: PalavraComTempo[] = [];
  const fechar = () => {
    if (!atual.length) return;
    linhas.push({ texto: atual.map((w) => w.t).join(" "), i: atual[0].i, f: atual[atual.length - 1].f });
    atual = [];
  };
  palavras.forEach((w, k) => {
    const ant = k > 0 ? palavras[k - 1] : null;
    if (atual.length >= maxPalavras || (ant && (w.i - ant.f > pausa || /[.!?]$/.test(ant.t)))) fechar();
    atual.push(w);
  });
  fechar();
  return linhas;
}

/** SRT a partir das linhas (para copiar). */
export function srtDasLinhas(linhas: { texto: string; i: number; f: number }[]): string {
  const tc = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const se = Math.floor((ms % 60000) / 1000);
    const r = ms % 1000;
    const p = (n: number, t = 2) => String(n).padStart(t, "0");
    return `${p(h)}:${p(m)}:${p(se)},${p(r, 3)}`;
  };
  return linhas.map((l, k) => `${k + 1}\n${tc(l.i)} --> ${tc(l.f)}\n${l.texto}\n`).join("\n");
}

// ------------------------------------------------------------------ visão

export interface TrechoVistoBruto {
  de_s?: unknown;
  ate_s?: unknown;
  descricao?: unknown;
  quem?: unknown;
  plano?: unknown;
  qualidade?: unknown;
}

export const ESQUEMA_DA_VISAO = {
  nome: "visao_por_trecho",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["trechos"],
    properties: {
      trechos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["de_s", "ate_s", "descricao", "quem", "plano", "qualidade"],
          properties: {
            de_s: { type: "number" },
            ate_s: { type: "number" },
            descricao: { type: "string" },
            quem: { type: "string" },
            plano: { type: "string" },
            qualidade: { type: "string" },
          },
        },
      },
    },
  },
};

export function sistemaDaVisao(): string {
  return [
    "Você assiste um vídeo por quadros. Cada imagem vem com o tempo exato (s) na legenda da mensagem.",
    "Descreva por trecho SÓ o que está visível: o que aparece, quem (sem nome se não houver texto na tela), plano (fechado, médio, aberto, detalhe) e qualidade (foco, luz, tremido).",
    "Trecho começa e termina em tempos de quadros que você recebeu. Não invente o que acontece entre quadros. Português do Brasil, frases curtas.",
  ].join("\n");
}

/**
 * Confere o que o modelo disse: trecho só existe entre tempos de quadros
 * enviados (de_s e ate_s vão para o quadro enviado mais perto); texto vazio sai.
 */
export function trechosConferidos(bruto: unknown, tempos: number[]): { de_s: number; ate_s: number; descricao: string; quem: string | null; plano: string | null; qualidade: string | null }[] {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { trechos?: unknown }).trechos) ? ((bruto as { trechos: unknown[] }).trechos as TrechoVistoBruto[]) : [];
  const ordem = tempos.slice().sort((a, b) => a - b);
  if (!ordem.length) return [];
  const perto = (v: number) => ordem.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), ordem[0]);
  const txt = (v: unknown, n: number) => {
    const s = String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
    return s || null;
  };
  return lista
    .map((t) => {
      const de = Number(t.de_s);
      const ate = Number(t.ate_s);
      const descricao = txt(t.descricao, 300);
      if (!isFinite(de) || !isFinite(ate) || !descricao) return null;
      const a = perto(Math.min(de, ate));
      const b = perto(Math.max(de, ate));
      return { de_s: a, ate_s: b, descricao, quem: txt(t.quem, 120), plano: txt(t.plano, 60), qualidade: txt(t.qualidade, 120) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((x, y) => x.de_s - y.de_s);
}

/** Tempos de amostra de uma fonte: 1 quadro a cada `passo` s (mínimo 1 s), até o teto, no meio de cada janela. */
export function temposDeAmostra(duracaoS: number, teto = MAX_QUADROS_POR_FONTE, passoMinimo = 1): number[] {
  const d = Math.max(0, Number(duracaoS) || 0);
  if (d <= 0) return [];
  const n = Math.max(1, Math.min(teto, Math.floor(d / passoMinimo)));
  const janela = d / n;
  const saida: number[] = [];
  for (let k = 0; k < n; k++) saida.push(Math.round((k * janela + janela / 2) * 1000) / 1000);
  return saida;
}
