/**
 * Escolha de formatos na preparação do Mês (24/10/2026). Dono: "Só entram Story
 * e vídeos com roteiro ou IA para selecionar quando eu for preparar".
 *
 * - A equipe escolhe os formatos do mês em chips (carrossel, estático, foto,
 *   vídeo para gravar com roteiro, vídeo gerado com IA e Stories). A escolha
 *   manda sobre a mistura do nicho: só entram os formatos escolhidos, e o peso
 *   de cada um vem do perfil do nicho (mistura-do-nicho.ts).
 * - Vídeo tem dois caminhos: "gravar" (a pessoa grava com o roteiro da peça) e
 *   "ia" (o vídeo é gerado no Estúdio). Cada item de vídeo nasce marcado com o
 *   caminho (caminho_video) e a peça abre nele.
 * - Stories não ocupam vaga de feed: são a sequência do dia na aba Stories,
 *   ligada ao post do mesmo dia. O Mês só planeja o dia e o tema (código, sem
 *   IA); o gerador é o da aba Stories (mesa-stories), sem duplicar.
 *
 * Puro (sem Deno, sem banco): a função, a tela e o Vitest leem este arquivo.
 * Sem travessão nos textos.
 */
import type { CadenciaDoMes, MixDaSemana } from "./cadencia-do-mes.ts";
import { segundaDaSemana } from "./cadencia-do-mes.ts";
import type { PerfilDeMistura } from "./mistura-do-nicho.ts";

export type OpcaoDoMes = "carrossel" | "estatico" | "foto" | "video_gravar" | "video_ia" | "stories";
export type CaminhoDoVideo = "gravar" | "ia";
type FormatoDeFeed = "carrossel" | "estatico" | "foto" | "video";

export const OPCOES_DO_MES: Array<{ id: OpcaoDoMes; rotulo: string; titulo: string }> = [
  { id: "carrossel", rotulo: "Carrossel", titulo: "Carrossel de arte no Estúdio" },
  { id: "estatico", rotulo: "Estático", titulo: "Post estático (uma arte)" },
  { id: "foto", rotulo: "Foto", titulo: "Post de foto real (Mesa Foto)" },
  { id: "video_gravar", rotulo: "Vídeo para gravar", titulo: "Vídeo com roteiro para a pessoa gravar" },
  { id: "video_ia", rotulo: "Vídeo com IA", titulo: "Vídeo gerado com IA no Estúdio" },
  { id: "stories", rotulo: "Stories", titulo: "Sequência de Stories do dia (aba Stories)" },
];
export const IDS_DAS_OPCOES: OpcaoDoMes[] = OPCOES_DO_MES.map((o) => o.id);
export const ROTULO_DA_OPCAO: Record<OpcaoDoMes, string> = {
  carrossel: "Carrossel",
  estatico: "Estático",
  foto: "Foto",
  video_gravar: "Vídeo para gravar",
  video_ia: "Vídeo com IA",
  stories: "Stories",
};
export const ROTULO_DO_CAMINHO: Record<CaminhoDoVideo, string> = { gravar: "Gravar com roteiro", ia: "Gerar com IA" };

export const ehOpcaoDoMes = (v: unknown): v is OpcaoDoMes => IDS_DAS_OPCOES.indexOf(v as OpcaoDoMes) >= 0;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A opção que o texto ou o modelo pede ("stories", "vídeo para gravar", "reels com IA"). Null quando não dá para saber. */
export function opcaoDoTexto(v: unknown): OpcaoDoMes | null {
  if (ehOpcaoDoMes(v)) return v;
  const s = semAcento(String(v == null ? "" : v).trim());
  if (!s) return null;
  if (s.indexOf("stor") >= 0) return "stories";
  if (/video|reels?\b|shorts?\b/.test(s)) {
    if (/grav|roteiro|falando|camera|pessoa/.test(s)) return "video_gravar";
    if (/\bia\b|gerad|gerar|inteligencia|ai\b/.test(s)) return "video_ia";
    return null;
  }
  if (/\bfotos?\b|fotograf|ensaio/.test(s)) return "foto";
  if (s.indexOf("carross") >= 0 || s.indexOf("carous") >= 0) return "carrossel";
  if (s.indexOf("estat") >= 0 || s.indexOf("static") >= 0) return "estatico";
  return null;
}

/** A escolha da tela: só opções válidas, sem repetir, na ordem dos chips. */
export function normalizarEscolha(v: unknown): OpcaoDoMes[] {
  const lista = Array.isArray(v) ? v : [];
  const vistas: Record<string, boolean> = {};
  for (const x of lista) {
    const o = opcaoDoTexto(x);
    if (o) vistas[o] = true;
  }
  return IDS_DAS_OPCOES.filter((id) => vistas[id]);
}

/** O caminho de vídeo que o nicho pede quando a equipe não escolheu: serviço e marca de pessoa gravam; o resto gera com IA. */
export function caminhoDoNicho(perfil: Pick<PerfilDeMistura, "id"> | null | undefined): CaminhoDoVideo {
  const id = perfil ? perfil.id : "";
  return id === "servico_que_explica" || id === "pessoa_e_autoridade" ? "gravar" : "ia";
}

/** "gravar", "roteiro", "ia", "gerar": o caminho; o resto, null. */
export function caminhoDoVideo(v: unknown): CaminhoDoVideo | null {
  const s = semAcento(String(v == null ? "" : v).trim());
  if (!s) return null;
  if (s === "gravar" || s.indexOf("grav") >= 0 || s.indexOf("roteiro") >= 0) return "gravar";
  if (s === "ia" || s.indexOf("gerar") >= 0 || s.indexOf("gerad") >= 0) return "ia";
  return null;
}

/** O formato e o caminho de cada opção (stories fora do feed). */
export function formatoDaOpcao(o: OpcaoDoMes): { formato: FormatoDeFeed | "stories"; caminho: CaminhoDoVideo | null } {
  if (o === "video_gravar") return { formato: "video", caminho: "gravar" };
  if (o === "video_ia") return { formato: "video", caminho: "ia" };
  return { formato: o, caminho: null };
}

/** A opção de um item que já existe (formato do Mês, o caminho do vídeo e a mesa). */
export function opcaoDoItem(item: { formato?: string | null; caminho_video?: string | null; stories?: boolean | null }, perfil?: Pick<PerfilDeMistura, "id"> | null): OpcaoDoMes {
  if (item.stories === true) return "stories";
  const f = String(item.formato || "");
  if (f === "video") return (caminhoDoVideo(item.caminho_video) || caminhoDoNicho(perfil)) === "gravar" ? "video_gravar" : "video_ia";
  if (f === "foto" || f === "estatico" || f === "carrossel") return f;
  return "carrossel";
}

/** Os formatos de feed da escolha (os dois caminhos de vídeo viram "video"). */
export function feedDaEscolha(escolha: OpcaoDoMes[]): FormatoDeFeed[] {
  const saida: FormatoDeFeed[] = [];
  for (const o of escolha) {
    const f = formatoDaOpcao(o).formato;
    if (f !== "stories" && saida.indexOf(f) < 0) saida.push(f);
  }
  return saida;
}

const ORDEM_DO_FEED: FormatoDeFeed[] = ["video", "foto", "carrossel", "estatico"];

/**
 * Quantos de cada formato escolhido por semana para N posts. Só os escolhidos
 * entram; o peso de cada um vem do perfil do nicho ("fotos" no perfil da conta
 * dobra a foto). Cada formato escolhido tem pelo menos 1 quando a semana tem
 * vaga para todos, e nenhum passa da metade da semana (arredondada para cima)
 * quando há mais de um.
 */
export function mixDaEscolha(perfil: PerfilDeMistura, porSemana: number, escolha: OpcaoDoMes[], formatoDoPerfil?: string | null): MixDaSemana {
  const n = Math.max(1, Math.min(5, Math.round(porSemana) || 1));
  const feed = feedDaEscolha(escolha);
  const formatos = ORDEM_DO_FEED.filter((f) => feed.indexOf(f) >= 0);
  const vazio: MixDaSemana = { foto: 0, carrossel: 0, estatico: 0, arte: 0 };
  if (!formatos.length) return vazio;
  const pesos: Record<FormatoDeFeed, number> = { video: 0, foto: 0, carrossel: 0, estatico: 0 };
  for (const f of formatos) pesos[f] = Math.max(1, perfil.pesos[f] || 1);
  if (formatoDoPerfil === "fotos" && pesos.foto) pesos.foto *= 2;
  const soma = formatos.reduce((a, f) => a + pesos[f], 0);
  const conta: Record<FormatoDeFeed, number> = { video: 0, foto: 0, carrossel: 0, estatico: 0 };
  // Primeiro um de cada escolhido (pelo peso) enquanto couber.
  const porPeso = formatos.slice().sort((a, b) => pesos[b] - pesos[a] || ORDEM_DO_FEED.indexOf(a) - ORDEM_DO_FEED.indexOf(b));
  let resto = n;
  for (const f of porPeso) {
    if (resto <= 0) break;
    conta[f] = 1;
    resto--;
  }
  // O resto pelo maior resto sobre os pesos (quem está mais abaixo da sua parte recebe).
  const falta = (f: FormatoDeFeed) => (pesos[f] / soma) * n - conta[f];
  while (resto > 0) {
    const alvo = porPeso.slice().sort((a, b) => falta(b) - falta(a) || pesos[b] - pesos[a])[0];
    conta[alvo]++;
    resto--;
  }
  if (formatos.length > 1 && n > 1) {
    const teto = Math.ceil(n / 2);
    for (let guarda = 0; guarda < 10; guarda++) {
      const cheio = formatos.filter((f) => conta[f] > teto)[0];
      if (!cheio) break;
      conta[cheio]--;
      const menor = formatos.filter((f) => f !== cheio).sort((a, b) => conta[a] - conta[b] || pesos[b] - pesos[a])[0];
      conta[menor]++;
    }
  }
  return { foto: conta.foto, carrossel: conta.carrossel, estatico: conta.estatico, ...(conta.video ? { video: conta.video } : {}), arte: 0 };
}

/** Stories por semana quando a equipe escolhe Stories: 3 na marca de pessoa, 2 nos outros nichos. */
export function storiesPorSemana(perfil: Pick<PerfilDeMistura, "id"> | null | undefined): number {
  return perfil && perfil.id === "pessoa_e_autoridade" ? 3 : 2;
}

/** Quantos vídeos de cada caminho por semana: só um caminho escolhido leva todos; os dois dividem, o do nicho primeiro. */
export function caminhosDaSemana(videos: number, escolha: OpcaoDoMes[], perfil: Pick<PerfilDeMistura, "id"> | null | undefined): { gravar: number; ia: number } {
  const v = Math.max(0, Math.round(videos) || 0);
  const gravar = escolha.indexOf("video_gravar") >= 0;
  const ia = escolha.indexOf("video_ia") >= 0;
  if (gravar && !ia) return { gravar: v, ia: 0 };
  if (ia && !gravar) return { gravar: 0, ia: v };
  const primeiro = caminhoDoNicho(perfil);
  const maior = Math.ceil(v / 2);
  return primeiro === "gravar" ? { gravar: maior, ia: v - maior } : { gravar: v - maior, ia: maior };
}

/** A cadência com a escolha da equipe: o mix só com os formatos escolhidos, os caminhos do vídeo e os Stories. */
export function cadenciaComEscolha(c: CadenciaDoMes, perfil: PerfilDeMistura, escolha: OpcaoDoMes[], formatoDoPerfil?: string | null): CadenciaDoMes {
  if (!escolha.length) return c;
  const feed = feedDaEscolha(escolha);
  const mix = feed.length ? mixDaEscolha(perfil, c.por_semana, escolha, formatoDoPerfil) : c.mix;
  const videos = mix && mix.video ? caminhosDaSemana(mix.video, escolha, perfil) : undefined;
  const stories = escolha.indexOf("stories") >= 0 ? storiesPorSemana(perfil) : 0;
  return {
    ...c,
    mix,
    fonte: `${c.fonte}+escolha`,
    escolha: escolha.slice(),
    ...(videos ? { videos } : {}),
    ...(stories ? { stories } : {}),
  };
}

/**
 * O caminho de cada vídeo do mês, na ordem das datas: segue a divisão da
 * semana (2 para gravar e 1 com IA: gravar, ia, gravar...). Sem divisão, o
 * caminho do nicho em todos.
 */
export function caminhosDosVideos(n: number, videos: { gravar: number; ia: number } | null | undefined, perfil: Pick<PerfilDeMistura, "id"> | null | undefined): CaminhoDoVideo[] {
  const total = Math.max(0, Math.round(n) || 0);
  if (!videos || videos.gravar + videos.ia <= 0) return Array.from({ length: total }, () => caminhoDoNicho(perfil));
  const saida: CaminhoDoVideo[] = [];
  let g = 0;
  let i = 0;
  const parte = videos.gravar / (videos.gravar + videos.ia);
  for (let k = 0; k < total; k++) {
    // Quem está mais abaixo da própria parte recebe a próxima vaga.
    const faltaG = parte * (k + 1) - g;
    const faltaI = (1 - parte) * (k + 1) - i;
    if (faltaG >= faltaI && videos.gravar > 0) {
      saida.push("gravar");
      g++;
    } else {
      saida.push("ia");
      i++;
    }
  }
  return saida;
}

/** O bloco do prompt com a escolha da equipe (manda sobre o nicho). */
export function blocoDaEscolha(escolha: OpcaoDoMes[]): string {
  if (!escolha.length) return "";
  const feed = feedDaEscolha(escolha);
  const nomes = escolha.filter((o) => o !== "stories").map((o) => ROTULO_DA_OPCAO[o].toLowerCase());
  const partes = [
    `FORMATOS ESCOLHIDOS PELA EQUIPE (mandam sobre a mistura do nicho): ${nomes.join(", ") || "os do nicho"}. Use só ${feed.length ? feed.join(", ") : "os formatos do nicho"} em formato.`,
  ];
  if (escolha.indexOf("video_gravar") >= 0) partes.push("Vídeo para gravar: pessoa falando para a câmera com gancho nos 2 primeiros segundos; em video, prompt com o roteiro curto e narracao com a fala.");
  if (escolha.indexOf("video_ia") >= 0) partes.push("Vídeo com IA: cenas geradas a partir de fotos reais do cliente, sem pessoa falando; em video, prompt com a direção das cenas.");
  if (escolha.indexOf("stories") >= 0) partes.push("Stories: o painel planeja a sequência de Stories nos dias dos posts (não crie item de story aqui).");
  return partes.join(" ");
}

/**
 * O formato de cada item depois da escolha: quem já está num formato escolhido
 * fica (até a parte dele no mês); o resto vai para o formato escolhido mais
 * abaixo da sua parte. Devolve só a lista de formatos, na ordem dos itens.
 */
export function formatosNaEscolha(formatos: string[], mix: MixDaSemana | null): FormatoDeFeed[] {
  const n = formatos.length;
  if (!mix) return formatos.map((f) => (ORDEM_DO_FEED.indexOf(f as FormatoDeFeed) >= 0 ? (f as FormatoDeFeed) : "carrossel"));
  const parte: Record<FormatoDeFeed, number> = { video: mix.video || 0, foto: mix.foto, carrossel: mix.carrossel + (mix.arte || 0), estatico: mix.estatico };
  const soma = ORDEM_DO_FEED.reduce((a, f) => a + parte[f], 0);
  if (!soma) return formatos.map((f) => (ORDEM_DO_FEED.indexOf(f as FormatoDeFeed) >= 0 ? (f as FormatoDeFeed) : "carrossel"));
  // A meta de cada formato no total (maior resto), com pelo menos 1 de cada escolhido quando cabe.
  const exatos = ORDEM_DO_FEED.map((f) => (parte[f] * n) / soma);
  const meta: Record<FormatoDeFeed, number> = { video: 0, foto: 0, carrossel: 0, estatico: 0 };
  ORDEM_DO_FEED.forEach((f, k) => (meta[f] = Math.floor(exatos[k])));
  let falta = n - ORDEM_DO_FEED.reduce((a, f) => a + meta[f], 0);
  const ordem = ORDEM_DO_FEED.map((f, k) => ({ f, r: exatos[k] - Math.floor(exatos[k]) })).filter((x) => parte[x.f] > 0).sort((a, b) => b.r - a.r);
  for (let k = 0; falta > 0 && ordem.length; k++, falta--) meta[ordem[k % ordem.length].f]++;
  const escolhidos = ORDEM_DO_FEED.filter((f) => parte[f] > 0);
  if (n >= escolhidos.length) {
    for (const f of escolhidos) {
      if (meta[f] > 0) continue;
      const doador = escolhidos.slice().sort((a, b) => meta[b] - meta[a])[0];
      if (meta[doador] > 1) {
        meta[doador]--;
        meta[f]++;
      }
    }
  }
  const usados: Record<FormatoDeFeed, number> = { video: 0, foto: 0, carrossel: 0, estatico: 0 };
  const saida: Array<FormatoDeFeed | null> = formatos.map((f) => {
    const g = f as FormatoDeFeed;
    if (ORDEM_DO_FEED.indexOf(g) >= 0 && usados[g] < meta[g]) {
      usados[g]++;
      return g;
    }
    return null;
  });
  return saida.map((f) => {
    if (f) return f;
    const alvo = escolhidos.slice().sort((a, b) => meta[b] - usados[b] - (meta[a] - usados[a]) || ORDEM_DO_FEED.indexOf(a) - ORDEM_DO_FEED.indexOf(b))[0];
    usados[alvo]++;
    return alvo;
  });
}

// ------------------------------------------------------------------ Stories do mês

export const PREFIXO_DOS_STORIES = "Stories: ";
export const tituloDosStories = (tema: string) => `${PREFIXO_DOS_STORIES}${String(tema || "").replace(/^Stories: /, "").replace(/^Peça de foto: /, "").trim()}`.slice(0, 200);
export const temaDosStories = (titulo: string) => String(titulo || "").replace(/^Stories: /, "").trim();

export type StoryPlanejado = { tema_id: string; data: string; tema: string; base: string | null };

/**
 * Os Stories do mês: em cada semana, até N dias com post (espalhados pela
 * semana), uma sequência de Stories no mesmo dia, sobre o tema do post (os
 * Stories levam para o post do dia). Código puro, sem IA.
 */
export function storiesDoPlano(itens: Array<{ data: string; tema: string; tema_id?: string | null }>, porSemana: number): StoryPlanejado[] {
  const n = Math.max(0, Math.min(5, Math.round(porSemana) || 0));
  if (!n) return [];
  const porSegunda: Record<string, Array<{ data: string; tema: string; tema_id?: string | null }>> = {};
  const ordem: string[] = [];
  for (const i of itens.slice().sort((a, b) => String(a.data).localeCompare(String(b.data)))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(i.data)) || !String(i.tema || "").trim()) continue;
    const seg = segundaDaSemana(i.data);
    if (!porSegunda[seg]) {
      porSegunda[seg] = [];
      ordem.push(seg);
    }
    // Um story por dia: o primeiro post do dia puxa.
    if (!porSegunda[seg].some((x) => x.data === i.data)) porSegunda[seg].push(i);
  }
  const saida: StoryPlanejado[] = [];
  for (const seg of ordem) {
    const dias = porSegunda[seg];
    const quantos = Math.min(n, dias.length);
    // Espalhados: o primeiro, o último e os do meio.
    const escolhidos: number[] = [];
    for (let k = 0; k < quantos; k++) {
      const idx = quantos === 1 ? 0 : Math.round((k * (dias.length - 1)) / (quantos - 1));
      if (escolhidos.indexOf(idx) < 0) escolhidos.push(idx);
    }
    for (const idx of escolhidos) {
      const d = dias[idx];
      saida.push({ tema_id: `s${saida.length + 1}`, data: d.data, tema: temaDosStories(String(d.tema).replace(/^Peça de foto: /, "")).slice(0, 180), base: d.tema_id ? String(d.tema_id) : null });
    }
  }
  return saida;
}

/** O pedido que abre a aba Stories já com o tema do item (o gerador é o da aba Stories). */
export function pedidoDosStories(tema: string): string {
  return `Stories do dia sobre: ${temaDosStories(tema)}. Leve para o post de hoje.`.slice(0, 2000);
}

/** A descrição da tarefa de Stories na agenda. */
export function descricaoDosStories(s: { tema: string; data: string }, propostaId: string): string {
  return [
    `Sequência de Stories do dia (aba Stories da Mesa).`,
    `Tema: ${s.tema}`,
    `Liga ao post de ${s.data}: os Stories levam para o post do dia.`,
    "",
    `Origem: Mesa do cliente, proposta ${propostaId}, Stories do mês.`,
  ].join("\n");
}

/** A frase da resposta sobre os Stories planejados ("Com 4 sequências de Stories, que entram na agenda ao gravar."). */
export function fraseDosStories(n: number): string {
  if (!n) return "";
  return `Com ${n} ${n === 1 ? "sequência" : "sequências"} de Stories nos dias dos posts, que ${n === 1 ? "entra" : "entram"} na agenda ao gravar e ${n === 1 ? "abre" : "abrem"} na aba Stories já com o tema.`;
}
