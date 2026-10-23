/**
 * Roteiro de anúncio em vídeo para GRAVAR (Mesa Ads > Estúdio > Vídeo >
 * "Gravar nós mesmos", 23/10/2026). O dono: "roteiros, cenas e ambientação,
 * ou só o texto de fala, para gravarmos os criativos em vídeo da maneira que
 * converte, com roteiros validados". O roteiro nasce na Mesa Roteiros (ação
 * anuncio_gerar) e fica ligado ao criativo e à oferta.
 *
 * Aqui mora só o que é puro (sem Deno, sem banco): as estruturas de anúncio
 * em vídeo que a casa usa, o pedido validado, o esquema das 2 versões, as
 * perguntas do Jev (Score por versão: gancho, clareza, venda e nicho) e a
 * escolha pela nota. Sem laço de correção: gera 2, o Jev escolhe, acabou.
 *
 * As estruturas são padrões de mecanismo (gancho nos 3 primeiros segundos,
 * problema, demonstração, prova, oferta e CTA; UGC falado; antes e depois;
 * objeção e resposta), adaptados ao anúncio. Não são prova de conversão:
 * conversão se mede depois de veicular. Sem travessão.
 */

import { ESQUEMA_DO_ROTEIRO, type TipoDeRoteiro } from "../../_shared/roteiro-modelo.ts";

// ------------------------------------------------------------------ pedido

export type ModoDoAnuncio = "completo" | "fala";
export const MODOS_DO_ANUNCIO: ModoDoAnuncio[] = ["completo", "fala"];
export const ROTULO_DO_MODO: Record<ModoDoAnuncio, string> = {
  completo: "Roteiro completo para gravar",
  fala: "Só o texto da fala (teleprompter)",
};

export type FormatoDoAnuncio = "9:16" | "4:5" | "16:9";
export const FORMATOS_DO_ANUNCIO: Array<{ id: FormatoDoAnuncio; rotulo: string }> = [
  { id: "9:16", rotulo: "9:16 Reels e Stories" },
  { id: "4:5", rotulo: "4:5 Feed" },
  { id: "16:9", rotulo: "16:9 Horizontal" },
];

export const DURACOES_DO_ANUNCIO = [15, 30, 45] as const;
export type DuracaoDoAnuncio = typeof DURACOES_DO_ANUNCIO[number];

export type IdDaEstrutura = "problema_demo" | "ugc_falado" | "antes_depois" | "objecao_resposta";

export type EstruturaDeAnuncio = {
  id: IdDaEstrutura;
  nome: string;
  /** Tipo do roteiro na Mesa Roteiros (o modo dos cuidados e papéis). */
  tipo: TipoDeRoteiro;
  /** Funções das cenas, na ordem. A primeira é sempre o gancho dos 3 primeiros segundos. */
  cenas: string[];
  quando: string;
  cuidado: string;
};

export const ESTRUTURAS_DE_ANUNCIO: EstruturaDeAnuncio[] = [
  {
    id: "problema_demo",
    nome: "Gancho, problema, demonstração, prova, oferta e CTA",
    tipo: "ugc",
    cenas: ["Gancho (0 a 3 s)", "Problema", "Demonstração", "Prova", "Oferta", "CTA"],
    quando: "Produto ou serviço que se mostra funcionando; público que já sente a dor.",
    cuidado: "A demonstração é o centro: ação visível, não descrição. Prova só a que está nos dados.",
  },
  {
    id: "ugc_falado",
    nome: "UGC falado para a câmera",
    tipo: "ugc",
    cenas: ["Gancho falado (0 a 3 s)", "Dor ou desejo", "Uso real", "Prova", "Oferta", "CTA"],
    quando: "Pessoa da marca ou cliente real falando de celular, tom de conversa.",
    cuidado: "Sem experiência pessoal, resultado ou depoimento inventado. Quem fala é quem grava.",
  },
  {
    id: "antes_depois",
    nome: "Antes e depois",
    tipo: "ugc",
    cenas: ["Gancho com o depois (0 a 3 s)", "Antes", "Processo", "Depois", "Oferta", "CTA"],
    quando: "Serviço com transformação visível (limpeza, reforma, estética, organização).",
    cuidado: "Antes e depois reais, mesma luz e mesmo ângulo. Nada de resultado prometido.",
  },
  {
    id: "objecao_resposta",
    nome: "Objeção e resposta",
    tipo: "fala_camera",
    cenas: ["Gancho com a objeção (0 a 3 s)", "A dúvida", "Resposta com demonstração", "Prova", "Oferta", "CTA"],
    quando: "Público que trava em preço, confiança, prazo ou 'será que serve pra mim'.",
    cuidado: "A objeção é dita como dúvida comum, nunca como mensagem inventada de um cliente.",
  },
];

export const estruturaPorId = (id: unknown): EstruturaDeAnuncio | null => ESTRUTURAS_DE_ANUNCIO.filter((e) => e.id === id)[0] || null;

/** Sem escolha da equipe: a estrutura que o ângulo pede, por regra (o Jev decide entre as 2 versões depois). */
export function estruturasPelaRegra(texto: string): [EstruturaDeAnuncio, EstruturaDeAnuncio] {
  const s = String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const primeira = /objec|duvida|caro|preco|confia|sera que/.test(s)
    ? "objecao_resposta"
    : /antes e depois|antes\/depois|transforma|resultado visivel|reforma|limpeza/.test(s)
    ? "antes_depois"
    : /ugc|depoimento|celular|selfie|criador/.test(s)
    ? "ugc_falado"
    : "problema_demo";
  const segunda = primeira === "problema_demo" ? "ugc_falado" : "problema_demo";
  return [estruturaPorId(primeira)!, estruturaPorId(segunda)!];
}

export type PedidoDoAnuncio = {
  criativoId: string;
  modo: ModoDoAnuncio;
  formato: FormatoDoAnuncio;
  duracaoS: DuracaoDoAnuncio;
  /** null: automático (a regra propõe duas estruturas diferentes e o Jev escolhe). */
  estrutura: IdDaEstrutura | null;
  web: boolean;
  pedido: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lê e confere o corpo; devolve o motivo em português quando algo não serve. */
export function lerPedidoDoAnuncio(corpo: Record<string, unknown>): PedidoDoAnuncio | { erro: string } {
  const criativoId = String(corpo.ads_criativo_id || "");
  if (!UUID.test(criativoId)) return { erro: "ads_criativo_id precisa ser o id do criativo." };
  const modo = MODOS_DO_ANUNCIO.indexOf(corpo.modo as ModoDoAnuncio) >= 0 ? (corpo.modo as ModoDoAnuncio) : null;
  if (!modo) return { erro: "modo: completo ou fala." };
  const formato = FORMATOS_DO_ANUNCIO.filter((f) => f.id === corpo.formato)[0];
  if (!formato) return { erro: "formato: 9:16, 4:5 ou 16:9." };
  const duracao = Number(corpo.duracao_s);
  if ((DURACOES_DO_ANUNCIO as readonly number[]).indexOf(duracao) < 0) return { erro: "duracao_s: 15, 30 ou 45." };
  const bruta = corpo.estrutura == null || corpo.estrutura === "" || corpo.estrutura === "auto" ? null : estruturaPorId(corpo.estrutura);
  if (corpo.estrutura && corpo.estrutura !== "auto" && !bruta) return { erro: "estrutura desconhecida." };
  return {
    criativoId,
    modo,
    formato: formato.id,
    duracaoS: duracao as DuracaoDoAnuncio,
    estrutura: bruta ? bruta.id : null,
    web: corpo.web !== false,
    pedido: typeof corpo.pedido === "string" ? corpo.pedido.trim().slice(0, 800) : "",
  };
}

// ------------------------------------------------------------------ custo (mesma conta na tela e no estimar)

/** Tokens de uma geração (2 versões numa chamada) e buscas na web previstas. */
export const TAMANHO_DO_ANUNCIO: Record<ModoDoAnuncio, { tokensEntrada: number; tokensSaida: number }> = {
  completo: { tokensEntrada: 16_000, tokensSaida: 7_000 },
  fala: { tokensEntrada: 14_000, tokensSaida: 3_000 },
};
export const BUSCAS_WEB_DO_ANUNCIO = 3;

// ------------------------------------------------------------------ o que vai ao modelo

export const SISTEMA_DO_ANUNCIO = `ROTEIRO DE ANÚNCIO EM VÍDEO PARA GRAVAR (Mesa Ads)
Agora você escreve um anúncio pago em vídeo, não um Reels orgânico. A equipe do cliente vai GRAVAR.
- O gancho acontece nos 3 primeiros segundos: a primeira cena para o dedo com imagem e fala juntas.
- Uma oferta, um público, uma ação. O CTA final é o da oferta (o mesmo do criativo); nunca invente preço, desconto, prazo, bônus, garantia ou escassez.
- Prova só a que está nos dados (oferta, ângulo, criativo, contexto). Sem prova nos dados, a cena de prova mostra o produto ou o processo e a falta vira pendência.
- Cada cena tem: funcao (o nome da cena da estrutura), fala (o que a pessoa diz, natural, respirável), segundos, visual (enquadramento e plano: close, plano médio, plano aberto, detalhe, por cima do ombro; e a ação), texto_na_tela (curto, até 6 palavras, legível no celular), broll (apoio).
- A soma dos segundos fica perto da duração pedida (até 2,5 palavras por segundo de fala).
- direcao: ambientação e cenário reais do cliente, figurino, objetos, luz, câmera; orientacoes traz o ritmo e o corte (onde cortar seco, onde respirar).
- Referência de anúncios que estão rodando: só quando a busca na web trouxer, e cada uma com a página em fontes. Nunca copie fala ou cena de terceiro.
- Escreva DUAS versões com GANCHOS DE FÓRMULAS DIFERENTES, cada uma seguindo a estrutura indicada para ela (estrutura_id). O Jev escolhe a mais forte; não existe segunda rodada.
- Português do Brasil. Sem travessão.`;

export const INSTRUCAO_DO_MODO: Record<ModoDoAnuncio, string> = {
  completo: "MODO: roteiro completo. Preencha todas as cenas (fala, visual com enquadramento e plano, texto na tela, apoio), a direção inteira (ambiente, figurino, objetos, luz, câmera, ritmo e corte) e o CTA final.",
  fala: "MODO: só a fala (teleprompter). Escreva a fala de cada cena e os segundos; deixe visual, texto_na_tela e broll vazios e a direção vazia. O CTA final continua obrigatório.",
};

/** As duas estruturas para as duas versões (a equipe escolheu uma: as duas seguem ela, com ganchos diferentes). */
export function estruturasDasVersoes(p: Pick<PedidoDoAnuncio, "estrutura">, textoDoAngulo: string): [EstruturaDeAnuncio, EstruturaDeAnuncio] {
  const escolhida = p.estrutura ? estruturaPorId(p.estrutura) : null;
  return escolhida ? [escolhida, escolhida] : estruturasPelaRegra(textoDoAngulo);
}

export function blocoDasEstruturas(par: [EstruturaDeAnuncio, EstruturaDeAnuncio]): string {
  return [
    "ESTRUTURAS DE ANÚNCIO EM VÍDEO (padrões de mecanismo da casa; não são prova de conversão):",
    ...par.map((e, i) => `Versão ${i + 1} (estrutura_id "${e.id}"): ${e.nome}. Cenas: ${e.cenas.join(" > ")}. Quando: ${e.quando} Cuidado: ${e.cuidado}`),
  ].join("\n");
}

const versaoDoEsquema = (() => {
  const s = ESQUEMA_DO_ROTEIRO.schema as { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  return {
    type: "object",
    properties: { ...s.properties, estrutura_id: { type: "string" } },
    required: s.required.concat(["estrutura_id"]),
    additionalProperties: false,
  };
})();

/** Duas versões do roteiro numa chamada (gerar a mais e escolher). */
export const ESQUEMA_DO_ROTEIRO_DE_ANUNCIO = {
  nome: "roteiro_de_anuncio_em_video",
  schema: {
    type: "object",
    properties: { versoes: { type: "array", items: versaoDoEsquema } },
    required: ["versoes"],
    additionalProperties: false,
  },
};

// ------------------------------------------------------------------ escolha com o Jev

export const DIMENSOES_DO_ANUNCIO = ["gancho", "clareza", "venda", "nicho"] as const;
export type DimensaoDoAnuncio = typeof DIMENSOES_DO_ANUNCIO[number];
export const PESOS_DO_ANUNCIO: Record<DimensaoDoAnuncio, number> = { gancho: 0.35, clareza: 0.2, venda: 0.3, nicho: 0.15 };

const NIVEIS: Record<DimensaoDoAnuncio, { instrucao: string; niveis: string[] }> = {
  gancho: {
    instrucao: "Nos 3 primeiros segundos (a primeira cena: fala, visual e texto na tela), quanto o anúncio para quem está rolando o feed?",
    niveis: [
      "abertura genérica, que qualquer marca usaria, sem motivo para parar",
      "tem um assunto, mas demora ou começa por apresentação da marca",
      "chama atenção, mas a promessa fica vaga",
      "para o dedo com uma situação ou contraste concreto do público",
      "para o dedo de imediato: imagem e fala juntas criam uma pergunta que só o anúncio responde",
    ],
  },
  clareza: {
    instrucao: "Quem nunca ouviu falar da marca entende o que é vendido, para quem e o que fazer, só pela fala das cenas?",
    niveis: [
      "não dá para saber o que é vendido",
      "entende o assunto, mas não a oferta",
      "entende a oferta com esforço ou com termo sem explicação",
      "claro: o que é, para quem e o próximo passo",
      "muito claro, uma ideia por cena e o próximo passo sem dúvida",
    ],
  },
  venda: {
    instrucao: "Como anúncio pago, quanto o roteiro leva à ação do CTA: mostra o problema, demonstra, prova com o que está nos dados e faz uma oferta só, sem prometer o que a oferta não tem?",
    niveis: [
      "não pede ação ou promete o que a oferta não sustenta",
      "pede ação sem dar motivo (sem demonstração nem prova)",
      "tem demonstração ou prova, mas o CTA fica solto",
      "problema, demonstração e CTA amarrados à oferta",
      "cada cena empurra para o CTA, com demonstração e prova coerentes com a oferta",
    ],
  },
  nicho: {
    instrucao: "Quanto a fala e as cenas soam como o nicho e o público descritos (palavras, situações e objetos do dia a dia deles), e não como texto que serviria para qualquer negócio?",
    niveis: [
      "serviria para qualquer negócio",
      "cita o nicho, mas as situações são genéricas",
      "tem algum detalhe do nicho",
      "situações e palavras do público do nicho",
      "só poderia ser deste negócio para este público",
    ],
  },
};

type RoteiroParaOJev = { estrutura: string; ganchos?: Array<{ texto?: string }>; gancho_escolhido?: number; blocos: Array<{ funcao: string; fala: string; visual?: string; texto_na_tela?: string }>; cta: string };

/** Estado do Jev: as 2 versões lado a lado, a oferta e o nicho. */
export function estadoDaEscolha(versoes: RoteiroParaOJev[], contexto: { oferta: string; publico: string; nicho: string; cta: string }) {
  const v: Record<string, unknown> = {};
  versoes.forEach((r, i) => {
    const g = r.ganchos && r.ganchos[r.gancho_escolhido || 0];
    v[`v${i + 1}`] = {
      estrutura: r.estrutura,
      gancho: g && g.texto ? g.texto : "",
      cenas: r.blocos.map((b) => ({ funcao: b.funcao, fala: b.fala, visual: b.visual || "", texto_na_tela: b.texto_na_tela || "" })),
      cta: r.cta,
    };
  });
  return { versoes: v, oferta: contexto.oferta, publico: contexto.publico || "o público da marca", nicho: contexto.nicho || "negócio local", cta_do_criativo: contexto.cta };
}

/** Um Score por dimensão e por versão (comparáveis entre si). */
export function perguntasDaEscolha(n: number): Record<string, { type: "score"; instructions: string; criteria: string[] }> {
  const q: Record<string, { type: "score"; instructions: string; criteria: string[] }> = {};
  for (let i = 1; i <= n; i++) {
    DIMENSOES_DO_ANUNCIO.forEach((d) => {
      q[`${d}_v${i}`] = { type: "score", instructions: `Avalie só \`versoes.v${i}\`, contra \`oferta\`, \`publico\` e \`nicho\`. ${NIVEIS[d].instrucao}`, criteria: NIVEIS[d].niveis };
    });
  }
  return q;
}

export type NotasDaVersao = Record<DimensaoDoAnuncio, number | null> & { nota: number | null };

export type EscolhaDoAnuncio = {
  indice: number;
  como: "jev" | "regra" | "equipe_unica";
  notas: NotasDaVersao[];
  porque: string;
};

/** Notas de 1 a 5 a partir do Score do Jev (0 a 4). */
export function notasDasVersoes(answers: Record<string, { score?: number } | undefined> | null | undefined, n: number): NotasDaVersao[] {
  const lista: NotasDaVersao[] = [];
  for (let i = 1; i <= n; i++) {
    const notas = {} as NotasDaVersao;
    let soma = 0;
    let peso = 0;
    DIMENSOES_DO_ANUNCIO.forEach((d) => {
      const r = answers ? answers[`${d}_v${i}`] : undefined;
      const s = r && typeof r.score === "number" && isFinite(r.score) ? Math.max(0, Math.min(4, r.score)) + 1 : null;
      notas[d] = s == null ? null : Math.round(s * 10) / 10;
      if (s != null) {
        soma += s * PESOS_DO_ANUNCIO[d];
        peso += PESOS_DO_ANUNCIO[d];
      }
    });
    notas.nota = peso ? Math.round((soma / peso) * 10) / 10 : null;
    lista.push(notas);
  }
  return lista;
}

const ROTULO_DA_DIMENSAO: Record<DimensaoDoAnuncio, string> = { gancho: "gancho", clareza: "clareza", venda: "venda", nicho: "nicho" };

/** Maior nota combinada; empate fica com a versão 1. Sem nota (Jev fora): a versão 1, pela regra. */
export function escolherVersao(notas: NotasDaVersao[]): EscolhaDoAnuncio {
  if (notas.length < 2) return { indice: 0, como: "equipe_unica", notas, porque: "Só uma versão veio do modelo." };
  const comNota = notas.map((n, i) => ({ i, nota: n.nota })).filter((x) => x.nota != null) as Array<{ i: number; nota: number }>;
  if (comNota.length < notas.length) return { indice: 0, como: "regra", notas, porque: "O Jev não respondeu: ficou a versão 1 (a estrutura pela regra do ângulo)." };
  const melhor = comNota.slice().sort((a, b) => b.nota - a.nota || a.i - b.i)[0];
  const outra = comNota.filter((x) => x.i !== melhor.i)[0];
  const ganha = DIMENSOES_DO_ANUNCIO.filter((d) => (notas[melhor.i][d] || 0) > (notas[outra.i][d] || 0)).map((d) => ROTULO_DA_DIMENSAO[d]);
  const porque = `Versão ${melhor.i + 1}, nota ${melhor.nota.toFixed(1).replace(".", ",")} contra ${outra.nota.toFixed(1).replace(".", ",")}` + (ganha.length ? `: mais forte em ${ganha.join(", ")}.` : ".");
  return { indice: melhor.i, como: "jev", notas, porque };
}

/** Fontes da busca na web como linhas do roteiro (só as páginas que a busca citou de fato). */
export function fontesDaWeb(fontes: Array<{ url?: string; titulo?: string }> | null | undefined, max = 5): Array<{ titulo: string; url: string }> {
  const vistas: Record<string, true> = {};
  const lista: Array<{ titulo: string; url: string }> = [];
  (fontes || []).forEach((f) => {
    const url = typeof f.url === "string" ? f.url.trim() : "";
    if (!/^https?:\/\//i.test(url) || vistas[url] || lista.length >= max) return;
    vistas[url] = true;
    lista.push({ titulo: String(f.titulo || url).replace(/\s+/g, " ").trim().slice(0, 120), url: url.slice(0, 400) });
  });
  return lista;
}
