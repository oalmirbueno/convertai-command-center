/**
 * Agente de roteiro da peça de vídeo da campanha (23/10/2026, dono: "o agente onde eu dou a ideia do roteiro
 * e ele já faz, quantos minutos e tudo, ele fica para selecionar ali dentro mesmo, e o roteiro já tem que vir
 * completo com cenas e tudo e até dar sugestão, participar junto com ultra criatividade").
 *
 * - criar: a pessoa dá a ideia, a duração (de 15 s a 5 min), o estilo e o nível de criatividade; o agente
 *   escreve duas versões completas com conceitos diferentes (cenas com câmera, fala, texto na tela e som,
 *   trilha, CTA e sugestões), o Jev recomenda uma e a pessoa escolhe ali mesmo.
 * - ajustar: a pessoa conversa com o agente sobre o roteiro aberto ("mais engraçado", uma sugestão dele);
 *   volta o roteiro ajustado, uma resposta curta e sugestões novas.
 * A duração é do código: as cenas são reescaladas para somar o tempo pedido.
 * Puro (a tela e as funções importam o mesmo). Sem lookbehind, sem classe Unicode e sem grupo nomeado.
 */

import { DURACAO_MAXIMA, MAX_CENAS, MAX_SEGUNDOS_DA_CENA, normalizarRoteiroDeVideo, type RoteiroDeVideo } from "./roteiro-de-video.ts";

export const DURACOES_DO_ROTEIRO: Array<{ segundos: number; rotulo: string }> = [
  { segundos: 15, rotulo: "15 s" },
  { segundos: 30, rotulo: "30 s" },
  { segundos: 45, rotulo: "45 s" },
  { segundos: 60, rotulo: "1 min" },
  { segundos: 90, rotulo: "1 min 30" },
  { segundos: 120, rotulo: "2 min" },
  { segundos: 180, rotulo: "3 min" },
  { segundos: 300, rotulo: "5 min" },
];

export type EstiloDoRoteiro = "viral" | "cinematografico" | "bastidor" | "tutorial" | "humor" | "venda" | "depoimento";

export const ESTILOS_DO_ROTEIRO: Array<{ id: EstiloDoRoteiro; rotulo: string; direcao: string }> = [
  { id: "viral", rotulo: "Viral", direcao: "Reels feito para parar o dedo: gancho visual e falado juntos, ritmo rápido, virada no meio e final que dá vontade de mandar para alguém." },
  { id: "cinematografico", rotulo: "Cinematográfico", direcao: "Abertura de cinema publicitário: plano de impacto, movimento de câmera, luz, pausa dramática e som desenhado; pouca fala e muita imagem." },
  { id: "bastidor", rotulo: "Bastidor", direcao: "Bastidor real do negócio: mãos, processo, gente trabalhando, o antes e o depois, com fala natural de quem faz." },
  { id: "tutorial", rotulo: "Tutorial", direcao: "Ensina algo útil em passos claros, cada passo uma cena, com texto na tela que resume o passo." },
  { id: "humor", rotulo: "Humor", direcao: "Esquete curta com situação reconhecível pelo público, personagem, timing de piada e CTA dentro da piada." },
  { id: "venda", rotulo: "Venda direta", direcao: "Problema, solução, prova e oferta com chamada clara; nada de promessa que o briefing não sustenta." },
  { id: "depoimento", rotulo: "Depoimento", direcao: "Alguém conta a experiência para a câmera, com cortes de apoio (B-roll) do que é contado." },
];

export type CriatividadeDoRoteiro = "segura" | "ousada" | "ultra";

export const CRIATIVIDADES_DO_ROTEIRO: Array<{ id: CriatividadeDoRoteiro; rotulo: string; direcao: string }> = [
  { id: "segura", rotulo: "Segura", direcao: "Formato conhecido e direto, sem risco; clareza acima de tudo." },
  { id: "ousada", rotulo: "Ousada", direcao: "Uma ideia inesperada por versão (ângulo, personagem ou transição), ainda simples de gravar." },
  {
    id: "ultra",
    rotulo: "Ultra",
    direcao:
      "Ultra criatividade: fuja do primeiro pensamento e do segundo também. Quebra de padrão nos 2 primeiros segundos, metáfora visual, transições que contam a história (match cut, objeto que vira outro, câmera que atravessa), um detalhe que ninguém do nicho faz e um final que surpreende. Ousado na forma, honesto no conteúdo e gravável com o que o cliente tem.",
  },
];

const ESTILOS = ESTILOS_DO_ROTEIRO.map((e) => e.id) as string[];
const CRIATIVIDADES = CRIATIVIDADES_DO_ROTEIRO.map((c) => c.id) as string[];

export const normalizarEstilo = (v: unknown): EstiloDoRoteiro => (typeof v === "string" && ESTILOS.indexOf(v) >= 0 ? (v as EstiloDoRoteiro) : "viral");
export const normalizarCriatividade = (v: unknown): CriatividadeDoRoteiro => (typeof v === "string" && CRIATIVIDADES.indexOf(v) >= 0 ? (v as CriatividadeDoRoteiro) : "ultra");

/** A duração pedida, presa à lista (a mais próxima); sem pedido, 30 s. */
export function normalizarDuracaoPedida(v: unknown): number {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 30;
  let melhor = DURACOES_DO_ROTEIRO[0].segundos;
  for (const d of DURACOES_DO_ROTEIRO) if (Math.abs(d.segundos - n) < Math.abs(melhor - n)) melhor = d.segundos;
  return melhor;
}

export const rotuloDaDuracao = (s: number) => {
  const d = DURACOES_DO_ROTEIRO.filter((x) => x.segundos === s)[0];
  if (d) return d.rotulo;
  return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60}` : ""}` : `${s} s`;
};

/** Quantas cenas cabem na duração (uma a cada 3 a 12 s, dentro do teto). */
export function cenasParaDuracao(segundos: number): { min: number; max: number } {
  const s = Math.max(5, Math.min(DURACAO_MAXIMA, segundos));
  const min = Math.max(3, Math.min(MAX_CENAS, Math.round(s / 12)));
  const max = Math.max(min, Math.min(MAX_CENAS, Math.round(s / 3)));
  return { min, max };
}

/**
 * Reescala os segundos das cenas para somar a duração pedida (o modelo erra a conta; o código acerta).
 * Cada cena fica entre 1 e MAX_SEGUNDOS_DA_CENA; a sobra vai para as cenas mais longas.
 */
export function ajustarDuracao(r: RoteiroDeVideo, alvo: number): RoteiroDeVideo {
  const n = r.cenas.length;
  if (!n) return r;
  const meta = Math.max(n, Math.min(alvo, n * MAX_SEGUNDOS_DA_CENA, DURACAO_MAXIMA));
  const soma = r.cenas.reduce((s, c) => s + c.segundos, 0) || n;
  const seg = r.cenas.map((c) => Math.max(1, Math.min(MAX_SEGUNDOS_DA_CENA, Math.round((c.segundos / soma) * meta))));
  let falta = meta - seg.reduce((s, x) => s + x, 0);
  const ordem = seg.map((_, i) => i).sort((a, b) => r.cenas[b].segundos - r.cenas[a].segundos);
  let volta = 0;
  while (falta !== 0 && volta < n * MAX_SEGUNDOS_DA_CENA) {
    const i = ordem[volta % n];
    if (falta > 0 && seg[i] < MAX_SEGUNDOS_DA_CENA) {
      seg[i]++;
      falta--;
    } else if (falta < 0 && seg[i] > 1) {
      seg[i]--;
      falta++;
    }
    volta++;
  }
  const cenas = r.cenas.map((c, i) => ({ ...c, segundos: seg[i] }));
  return { ...r, cenas, duracao: Math.max(5, Math.min(DURACAO_MAXIMA, cenas.reduce((s, c) => s + c.segundos, 0))) };
}

// ------------------------------------------------------------------ esquemas da resposta

const CENA = {
  type: "object",
  additionalProperties: false,
  required: ["descricao", "plano", "fala", "texto_na_tela", "som", "segundos"],
  properties: {
    descricao: { type: "string" },
    plano: { type: "string" },
    fala: { type: "string" },
    texto_na_tela: { type: "string" },
    som: { type: "string" },
    segundos: { type: "integer" },
  },
};

const VERSAO = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "conceito", "gancho", "cenas", "trilha", "cta", "sugestoes"],
  properties: {
    titulo: { type: "string" },
    conceito: { type: "string" },
    gancho: { type: "string" },
    cenas: { type: "array", items: CENA },
    trilha: { type: "string" },
    cta: { type: "string" },
    sugestoes: { type: "array", items: { type: "string" } },
  },
};

export const ESQUEMA_DAS_VERSOES_DO_ROTEIRO = {
  nome: "versoes_do_roteiro_do_agente",
  schema: { type: "object", additionalProperties: false, required: ["versoes"], properties: { versoes: { type: "array", items: VERSAO } } },
};

export const ESQUEMA_DO_AJUSTE_DO_ROTEIRO = {
  nome: "ajuste_do_roteiro_do_agente",
  schema: { type: "object", additionalProperties: false, required: ["resposta", "roteiro"], properties: { resposta: { type: "string" }, roteiro: VERSAO } },
};

// ------------------------------------------------------------------ pedidos ao modelo

export interface PedidoDoAgenteDeRoteiro {
  ideia: string;
  duracao: number;
  estilo: EstiloDoRoteiro;
  criatividade: CriatividadeDoRoteiro;
  /** O título da trilha da campanha, quando já escolhida. */
  trilha?: string;
}

const REGRAS_DO_ROTEIRO = [
  "- Cada cena: descricao (o que aparece, concreto: quem, onde, ação), plano (enquadramento e movimento de câmera), fala exata (ou vazia quando a cena é só imagem), texto_na_tela curto (até 6 palavras, ou vazio), som (efeito, entrada ou corte da trilha, silêncio) e segundos.",
  "- O gancho prende nos 2 primeiros segundos com imagem E fala; a primeira cena é o gancho em ação.",
  "- Retenção: uma virada ou revelação a cada 20 a 30 segundos nos roteiros longos; nada de cena morta.",
  "- Fala como gente fala, frases curtas, sem clichê de IA, sem pergunta-ponte (\"O resultado?\"), sem \"não é X, é Y\".",
  "- Só o que o cliente consegue gravar ou gerar: o produto, o lugar, a equipe, as fotos reais. Sem preço, número, prêmio ou depoimento inventado; sem promessa que o briefing não sustenta.",
  "- sugestoes: 3 ideias curtas e concretas para deixar ESTA versão ainda mais forte (cada uma pode virar um pedido de ajuste: \"troque a abertura por...\", \"acrescente...\").",
  "- Português do Brasil. Sem travessão.",
].join("\n");

/** A tarefa do criar: duas versões completas, com conceitos diferentes. */
export function tarefaDoAgenteDeRoteiro(p: PedidoDoAgenteDeRoteiro): string {
  const estilo = ESTILOS_DO_ROTEIRO.filter((e) => e.id === p.estilo)[0] || ESTILOS_DO_ROTEIRO[0];
  const criatividade = CRIATIVIDADES_DO_ROTEIRO.filter((c) => c.id === p.criatividade)[0] || CRIATIVIDADES_DO_ROTEIRO[2];
  const faixa = cenasParaDuracao(p.duracao);
  return [
    `IDEIA DA EQUIPE: ${p.ideia ? p.ideia : "(sem ideia: proponha você, pela peça e pela fase da campanha)"}`,
    `DURAÇÃO: ${rotuloDaDuracao(p.duracao)} (${p.duracao} segundos no total, somando as cenas). Entre ${faixa.min} e ${faixa.max} cenas, cada uma de 1 a ${MAX_SEGUNDOS_DA_CENA} segundos.`,
    `ESTILO: ${estilo.rotulo}. ${estilo.direcao}`,
    `CRIATIVIDADE: ${criatividade.rotulo}. ${criatividade.direcao}`,
    p.trilha ? `TRILHA DA CAMPANHA (já escolhida): ${p.trilha}. Use-a e marque no som de cada cena onde ela entra, sobe ou corta.` : "Sem trilha escolhida: em trilha, descreva o clima em poucas palavras (ritmo, instrumentos, BPM aproximado).",
    "",
    "TAREFA: escreva 2 versões COMPLETAS do roteiro desta peça, com conceitos realmente diferentes entre si (não é paráfrase: muda a ideia, o gancho e a forma). Cada versão: titulo (até 6 palavras), conceito (a ideia criativa em uma frase), gancho, cenas, trilha, cta (ação direta ligada à fase) e sugestoes.",
    REGRAS_DO_ROTEIRO,
  ].join("\n");
}

/** A tarefa do ajustar: o roteiro aberto mais o pedido da pessoa. */
export function tarefaDoAjusteDoRoteiro(p: { roteiro: RoteiroDeVideo; pedido: string; duracao: number; criatividade: CriatividadeDoRoteiro }): string {
  const criatividade = CRIATIVIDADES_DO_ROTEIRO.filter((c) => c.id === p.criatividade)[0] || CRIATIVIDADES_DO_ROTEIRO[2];
  const atual = {
    titulo: p.roteiro.titulo || "",
    conceito: p.roteiro.conceito || "",
    gancho: p.roteiro.gancho,
    cenas: p.roteiro.cenas.map((c) => ({ descricao: c.descricao, plano: c.plano || "", fala: c.fala, texto_na_tela: c.texto_na_tela, som: c.som || "", segundos: c.segundos })),
    trilha: p.roteiro.trilha,
    cta: p.roteiro.cta,
  };
  return [
    `ROTEIRO ABERTO (JSON): ${JSON.stringify(atual)}`,
    `PEDIDO DA EQUIPE: ${p.pedido}`,
    `DURAÇÃO: ${rotuloDaDuracao(p.duracao)} (${p.duracao} segundos no total).`,
    `CRIATIVIDADE: ${criatividade.rotulo}. ${criatividade.direcao}`,
    "",
    "TAREFA: você está criando junto com a equipe. Aplique o pedido no roteiro inteiro (o que mudar numa cena e afetar outra, ajuste também) e mantenha o que já estava bom. Devolva resposta (até 2 frases: o que você mudou e por quê, e uma ideia sua que vai além do pedido, quando houver) e o roteiro completo ajustado, com sugestoes novas.",
    REGRAS_DO_ROTEIRO,
  ].join("\n");
}

// ------------------------------------------------------------------ leitura da resposta

/** As versões que voltaram do modelo, normalizadas e com a duração pedida (no máximo 3). */
export function versoesDaResposta(json: unknown, p: { duracao: number; ideia: string; trilha?: string }): RoteiroDeVideo[] {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const brutas = Array.isArray(o.versoes) ? o.versoes : [];
  const em = new Date().toISOString();
  return brutas
    .map((v) => normalizarRoteiroDeVideo({ ...((v && typeof v === "object" ? v : {}) as Record<string, unknown>), ideia: p.ideia, gerado_em: em, ...(p.trilha ? { trilha: p.trilha } : {}) }))
    .filter((r): r is RoteiroDeVideo => !!r)
    .slice(0, 3)
    .map((r) => ajustarDuracao(r, p.duracao));
}

/** O roteiro ajustado e a resposta do agente; null quando o roteiro não voltou. */
export function ajusteDaResposta(json: unknown, p: { duracao: number; antes: RoteiroDeVideo }): { roteiro: RoteiroDeVideo; resposta: string } | null {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const bruto = o.roteiro && typeof o.roteiro === "object" ? (o.roteiro as Record<string, unknown>) : null;
  const r = bruto ? normalizarRoteiroDeVideo({ ...bruto, ideia: p.antes.ideia || "", gerado_em: new Date().toISOString() }) : null;
  if (!r) return null;
  // A narração e a montagem ficam com o roteiro salvo; a tela avisa quando a fala mudou.
  const resposta = typeof o.resposta === "string" ? o.resposta.replace(/\s+/g, " ").trim().replace(/\s*[–—]\s*/g, ", ").slice(0, 400) : "";
  return { roteiro: ajustarDuracao(r, p.duracao), resposta };
}

// ------------------------------------------------------------------ escolha do Jev

/** A pergunta Choice: qual versão serve melhor à peça (o código lê a mais provável). */
export function perguntaDaEscolhaDoRoteiro(n: number): { melhor: { type: "choice"; instructions: string; criteria: Record<string, string> } } {
  const criteria: Record<string, string> = {};
  for (let i = 0; i < n; i++) criteria[`v${i + 1}`] = `A versão \`versoes[${i}]\` é a mais forte.`;
  return {
    melhor: {
      type: "choice",
      instructions:
        "Qual versão de roteiro desta peça de vídeo é a mais forte para o público do cliente? Pese, nesta ordem: o gancho prender nos 2 primeiros segundos, cumprir a `ideia` pedida pela equipe, servir à fase e ao objetivo da `campanha`, ser gravável com o que o cliente tem e não prometer o que o briefing não sustenta.",
      criteria,
    },
  };
}

/** O estado do Jev: a campanha resumida, a ideia e as versões condensadas. */
export function estadoDaEscolhaDoRoteiro(p: { campanha: Record<string, unknown>; ideia: string; versoes: RoteiroDeVideo[] }) {
  return {
    campanha: p.campanha,
    ideia: p.ideia || "(sem ideia: o agente propôs)",
    versoes: p.versoes.map((v) => ({
      titulo: v.titulo || "",
      conceito: v.conceito || "",
      gancho: v.gancho,
      cenas: v.cenas.slice(0, 12).map((c) => `${c.segundos}s: ${c.descricao}${c.fala ? ` | fala: ${c.fala}` : ""}`.slice(0, 260)),
      cta: v.cta,
    })),
  };
}

/** O índice recomendado (0 sem resposta) e a confiança. */
export function lerEscolhaDoRoteiro(resposta: { choice?: string; confidence?: number } | null | undefined, n: number): { indice: number; confianca: number | null } {
  const c = resposta && typeof resposta.choice === "string" ? resposta.choice : "";
  const i = /^v\d+$/.test(c) ? Number(c.slice(1)) - 1 : -1;
  return { indice: i >= 0 && i < n ? i : 0, confianca: resposta && typeof resposta.confidence === "number" ? resposta.confidence : null };
}

// ------------------------------------------------------------------ opções guardadas na peça

/** As versões do agente guardadas na peça (a pessoa escolhe depois, mesmo saindo da tela). */
export interface OpcoesDoRoteiro {
  versoes: RoteiroDeVideo[];
  recomendada: number;
  porque: string;
  ideia: string;
  duracao: number;
  estilo: EstiloDoRoteiro;
  criatividade: CriatividadeDoRoteiro;
  em: string;
}

export function normalizarOpcoesDoRoteiro(v: unknown): OpcoesDoRoteiro | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const versoes = (Array.isArray(o.versoes) ? o.versoes : []).map((x) => normalizarRoteiroDeVideo(x)).filter((r): r is RoteiroDeVideo => !!r).slice(0, 3);
  if (!versoes.length) return null;
  const rec = Math.round(Number(o.recomendada) || 0);
  return {
    versoes,
    recomendada: rec >= 0 && rec < versoes.length ? rec : 0,
    porque: typeof o.porque === "string" ? o.porque.slice(0, 300) : "",
    ideia: typeof o.ideia === "string" ? o.ideia.slice(0, 1200) : "",
    duracao: normalizarDuracaoPedida(o.duracao),
    estilo: normalizarEstilo(o.estilo),
    criatividade: normalizarCriatividade(o.criatividade),
    em: typeof o.em === "string" ? o.em.slice(0, 40) : "",
  };
}
