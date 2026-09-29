/**
 * Som do editor (frente EDT, F3, 30/09/2026): biblioteca de efeitos CC0 com o
 * registro de licença de cada um e o pico MEDIDO por nós, o plano de sons no
 * pico do movimento, a trilha com duck e o -14 LUFS do render.
 *
 * Puro e sem import (a tela, a composição Remotion, o worker e os testes usam).
 *
 * Arquivos em `public/editor/sons/` (servidos pelo próprio painel: a prévia
 * toca e o worker lê do disco). Comprovantes em `public/editor/sons/licencas/`.
 * O pico foi medido por `workers/render/sons/medir-sons.mjs` (janela de 10 ms
 * com mais energia, mono 48 kHz): é o ponto do som que cai no quadro do
 * movimento. Nenhum som é CC-BY: crédito não é obrigatório.
 */

export interface SomDaBiblioteca {
  id: string;
  arquivo: string;
  rotulo: string;
  /** Quando usar (vai no "?" e no plano). */
  uso: string;
  duracao_s: number;
  /** Ponto forte medido (s desde o começo do arquivo). */
  pico_s: number;
  pico_dbfs: number;
  origem: string;
  autor: string;
  licenca: "CC0 1.0";
  comprovante: string;
}

const KENNEY = "Kenney Vleugels (kenney.nl)";
const BSB = "Joseph SARDIN (BigSoundBank.com)";
const WOVEN = "Woven SFX (github.com/woven-video/woven-sfx, commit 521b446)";

/** Pasta pública dos sons (a URL do painel e o caminho no disco do worker). */
export const PASTA_DOS_SONS = "editor/sons";

export const BIBLIOTECA_DE_SONS: SomDaBiblioteca[] = [
  { id: "whoosh", arquivo: "whoosh.wav", rotulo: "Whoosh", uso: "entrada de imagem, troca de assunto", duracao_s: 0.85, pico_s: 0.165, pico_dbfs: -3.5, origem: "archive.org/details/SSE_Library_SWOOSHES", autor: "USC Cinema / Sunset Editorial Collection", licenca: "CC0 1.0", comprovante: "licencas/whoosh.txt" },
  { id: "pop", arquivo: "pop.wav", rotulo: "Pop", uso: "texto ou item que aparece", duracao_s: 0.25, pico_s: 0.015, pico_dbfs: -4.5, origem: "kenney.nl/assets/interface-sounds", autor: KENNEY, licenca: "CC0 1.0", comprovante: "licencas/pop.txt" },
  { id: "click", arquivo: "click.wav", rotulo: "Clique", uso: "check, marcação, botão", duracao_s: 0.3, pico_s: 0.015, pico_dbfs: 1.2, origem: "kenney.nl/assets/ui-audio", autor: KENNEY, licenca: "CC0 1.0", comprovante: "licencas/click.txt" },
  { id: "rise", arquivo: "rise.wav", rotulo: "Subida", uso: "antes de uma revelação", duracao_s: 2.6, pico_s: 1.485, pico_dbfs: -8.7, origem: "commons.wikimedia.org (Phonk Riser (1) Sample)", autor: "UnKnownrNone", licenca: "CC0 1.0", comprovante: "licencas/rise.txt" },
  { id: "cash", arquivo: "cash.wav", rotulo: "Caixa registradora", uso: "preço, venda", duracao_s: 1.4, pico_s: 0.115, pico_dbfs: 1.8, origem: "bigsoundbank.com (Metal drawer #1 + Counter bell #4)", autor: BSB, licenca: "CC0 1.0", comprovante: "licencas/cash.txt" },
  { id: "coin", arquivo: "coin.wav", rotulo: "Moeda", uso: "dinheiro, economia", duracao_s: 0.7, pico_s: 0.045, pico_dbfs: -1.6, origem: "bigsoundbank.com (Coin in cup #1)", autor: "DavidGreck (BigSoundBank.com)", licenca: "CC0 1.0", comprovante: "licencas/coin.txt" },
  { id: "notification", arquivo: "notification.wav", rotulo: "Notificação", uso: "notificação, mensagem", duracao_s: 1.2, pico_s: 0.025, pico_dbfs: -9.3, origem: "bigsoundbank.com (clinking of empty glass)", autor: BSB, licenca: "CC0 1.0", comprovante: "licencas/notification.txt" },
  { id: "success", arquivo: "success.wav", rotulo: "Sucesso", uso: "selo, resultado, garantia", duracao_s: 0.929, pico_s: 0.145, pico_dbfs: -6.2, origem: "kenney.nl/assets/music-jingles", autor: KENNEY, licenca: "CC0 1.0", comprovante: "licencas/success.txt" },
  { id: "count", arquivo: "count.wav", rotulo: "Contagem", uso: "número contando", duracao_s: 0.643, pico_s: 0.575, pico_dbfs: -8.2, origem: "opengameart.org (Hi-Tech Button Sound Pack I)", autor: "Circlerun", licenca: "CC0 1.0", comprovante: "licencas/count.txt" },
  { id: "keyboard", arquivo: "keyboard.wav", rotulo: "Teclado", uso: "texto sendo digitado", duracao_s: 1.5, pico_s: 1.315, pico_dbfs: 1.3, origem: "bigsoundbank.com (Computer Keyboard)", autor: BSB, licenca: "CC0 1.0", comprovante: "licencas/keyboard.txt" },
  { id: "mouse_click", arquivo: "mouse_click.wav", rotulo: "Clique de mouse", uso: "clique na tela gravada", duracao_s: 0.24, pico_s: 0.005, pico_dbfs: 1.8, origem: "bigsoundbank.com (Raspberry Mouse, Single Click)", autor: BSB, licenca: "CC0 1.0", comprovante: "licencas/mouse_click.txt" },
  { id: "impacto", arquivo: "woven-bass-impact.wav", rotulo: "Impacto grave", uso: "carimbo, palavra de impacto", duracao_s: 2.461, pico_s: 0.075, pico_dbfs: 2.9, origem: WOVEN, autor: "Woven", licenca: "CC0 1.0", comprovante: "licencas/woven.txt" },
  { id: "camera", arquivo: "woven-camera-shutter-1-shot.wav", rotulo: "Câmera", uso: "polaroide, foto", duracao_s: 0.279, pico_s: 0.105, pico_dbfs: 3, origem: WOVEN, autor: "Woven", licenca: "CC0 1.0", comprovante: "licencas/woven.txt" },
  { id: "baque", arquivo: "woven-dull-thud.wav", rotulo: "Baque", uso: "etiqueta que cai, peso", duracao_s: 1.393, pico_s: 0.135, pico_dbfs: -2.8, origem: WOVEN, autor: "Woven", licenca: "CC0 1.0", comprovante: "licencas/woven.txt" },
  { id: "whoosh_rapido", arquivo: "woven-fast-whoosh.wav", rotulo: "Whoosh rápido", uso: "barra, passo, lista", duracao_s: 0.395, pico_s: 0.115, pico_dbfs: -5.1, origem: WOVEN, autor: "Woven", licenca: "CC0 1.0", comprovante: "licencas/woven.txt" },
  { id: "glitch", arquivo: "woven-glitch-logo.wav", rotulo: "Glitch", uso: "logo, cartão final", duracao_s: 0.627, pico_s: 0.145, pico_dbfs: -4, origem: WOVEN, autor: "Woven", licenca: "CC0 1.0", comprovante: "licencas/woven.txt" },
  { id: "mensagem", arquivo: "woven-message-pop-reply.wav", rotulo: "Mensagem", uso: "comentário, conversa", duracao_s: 0.882, pico_s: 0.045, pico_dbfs: 2.9, origem: WOVEN, autor: "Woven", licenca: "CC0 1.0", comprovante: "licencas/woven.txt" },
  { id: "pop_mao", arquivo: "woven-pop-hand.wav", rotulo: "Pop de mão", uso: "rótulo, lettering", duracao_s: 0.348, pico_s: 0.025, pico_dbfs: 0.8, origem: WOVEN, autor: "Woven", licenca: "CC0 1.0", comprovante: "licencas/woven.txt" },
  { id: "swish", arquivo: "woven-swish-whoosh-large.wav", rotulo: "Swish largo", uso: "entrada grande, cartão", duracao_s: 0.789, pico_s: 0.145, pico_dbfs: 3, origem: WOVEN, autor: "Woven", licenca: "CC0 1.0", comprovante: "licencas/woven.txt" },
  { id: "tique", arquivo: "woven-tick-sound.wav", rotulo: "Tique", uso: "passo, item de lista", duracao_s: 0.557, pico_s: 0.025, pico_dbfs: -7.3, origem: WOVEN, autor: "Woven", licenca: "CC0 1.0", comprovante: "licencas/woven.txt" },
];

export const somPorId = (id: string): SomDaBiblioteca | null => BIBLIOTECA_DE_SONS.find((s) => s.id === id) || null;

/** Chave da fonte de um som da biblioteca no projeto. */
export const chaveDoSom = (id: string) => `som-${id.replace(/_/g, "-")}`;
/** Caminho do som (fonte com storage_bucket "publico"). */
export const caminhoDoSom = (s: SomDaBiblioteca) => `${PASTA_DOS_SONS}/${s.arquivo}`;

// ------------------------------------------------------------------ plano de sons

export const ESPACO_MINIMO_ENTRE_SONS_S = 0.65;

export interface EventoDeMovimento {
  /** Quando o movimento chega no auge (tempo da linha). */
  pico_s: number;
  som: string;
  /** Maior = mais importante (fica quando dois brigam pelo espaço). */
  prioridade?: number;
  ref?: string;
}

export interface SomPlanejado {
  som: string;
  /** Onde o arquivo começa na linha: pico do movimento menos o pico do som. */
  inicio_s: number;
  pico_s: number;
  ref: string | null;
}

/**
 * Plano de sons: o pico medido de cada som cai no quadro do auge do
 * movimento. Dois sons a menos de `espaco_min_s` um do outro: fica o de maior
 * prioridade (empate: o primeiro). "poucos" = só um a cada 2 s e só os de
 * prioridade 2 ou mais.
 */
export function planoDeSons(eventos: EventoDeMovimento[], o: { modo?: "casados" | "poucos"; espaco_min_s?: number; fps?: number } = {}): SomPlanejado[] {
  const poucos = o.modo === "poucos";
  const espaco = o.espaco_min_s !== undefined ? o.espaco_min_s : poucos ? 2 : ESPACO_MINIMO_ENTRE_SONS_S;
  const fps = o.fps && o.fps > 0 ? o.fps : 30;
  const candidatos = eventos
    .filter((e) => somPorId(e.som) && isFinite(e.pico_s) && e.pico_s >= 0 && (!poucos || (e.prioridade || 1) >= 2))
    .map((e, k) => ({ e, k }))
    .sort((a, b) => (b.e.prioridade || 1) - (a.e.prioridade || 1) || a.e.pico_s - b.e.pico_s || a.k - b.k);
  const ficam: EventoDeMovimento[] = [];
  candidatos.forEach(({ e }) => {
    if (ficam.some((f) => Math.abs(f.pico_s - e.pico_s) < espaco - 1e-6)) return;
    ficam.push(e);
  });
  const quadro = (s: number) => Math.round(s * fps) / fps;
  return ficam
    .sort((a, b) => a.pico_s - b.pico_s)
    .map((e) => {
      const s = somPorId(e.som) as SomDaBiblioteca;
      const pico = quadro(e.pico_s);
      return { som: s.id, inicio_s: Math.max(0, Math.round((pico - s.pico_s) * 1000) / 1000), pico_s: pico, ref: e.ref || null };
    });
}

// ------------------------------------------------------------------ trilha, duck e loudness

export const MIXAGEM_PADRAO = {
  /** A trilha fica este tanto abaixo da voz (LUFS). */
  trilha_abaixo_da_voz_db: 22,
  /** Nas pausas longas a trilha sobe este tanto. */
  subida_nas_pausas_db: 6,
  /** Pausa a partir da qual a trilha sobe. */
  pausa_para_subir_s: 0.8,
  ataque_s: 0.12,
  soltura_s: 0.4,
  /** Loudness do arquivo final. */
  lufs_alvo: -14,
  /** Teto de pico real do arquivo final. */
  pico_real_db: -1.5,
  /** Voz presumida na prévia (sem medida). */
  voz_presumida_lufs: -18,
  /** Trilha presumida na prévia (sem medida). */
  trilha_presumida_lufs: -14,
} as const;

export const dbParaGanho = (db: number) => Math.pow(10, db / 20);
export const ganhoParaDb = (g: number) => (g > 0 ? 20 * Math.log10(g) : -100);

/** Ganho (dB) que põe a trilha `abaixo_db` abaixo da voz, pelos LUFS medidos. Limite de -40 a +12 dB. */
export function ganhoDaTrilhaDb(lufsVoz: number, lufsTrilha: number, abaixoDb: number = MIXAGEM_PADRAO.trilha_abaixo_da_voz_db): number {
  const alvo = lufsVoz - abaixoDb;
  const g = alvo - lufsTrilha;
  return Math.round(Math.max(-40, Math.min(12, g)) * 10) / 10;
}

/** Trechos de fala (linha do tempo) a partir das palavras: junta o que está a menos de `junta_s`. */
export function trechosDeFala(palavras: { i: number; f: number }[], juntaS = 0.3): { de_s: number; ate_s: number }[] {
  const ordem = palavras.slice().sort((a, b) => a.i - b.i);
  const saida: { de_s: number; ate_s: number }[] = [];
  ordem.forEach((w) => {
    const u = saida[saida.length - 1];
    if (u && w.i - u.ate_s <= juntaS) u.ate_s = Math.max(u.ate_s, w.f);
    else saida.push({ de_s: w.i, ate_s: w.f });
  });
  return saida;
}

/**
 * Quanto a trilha sobe (dB, 0 = na base) no tempo t: na base durante a fala
 * (22 dB abaixo da voz) e sobe `subida_db` nas pausas de `pausa_s` ou mais,
 * com rampa de ataque (descendo antes da fala voltar) e soltura (subindo depois).
 */
export function subidaDaTrilhaDb(t: number, fala: { de_s: number; ate_s: number }[], o: { subida_db?: number; pausa_s?: number; ataque_s?: number; soltura_s?: number; fim_s?: number } = {}): number {
  const subida = o.subida_db !== undefined ? o.subida_db : MIXAGEM_PADRAO.subida_nas_pausas_db;
  const pausa = o.pausa_s !== undefined ? o.pausa_s : MIXAGEM_PADRAO.pausa_para_subir_s;
  const ataque = o.ataque_s !== undefined ? o.ataque_s : MIXAGEM_PADRAO.ataque_s;
  const soltura = o.soltura_s !== undefined ? o.soltura_s : MIXAGEM_PADRAO.soltura_s;
  if (!fala.length || subida <= 0) return subida > 0 && !fala.length ? subida : 0;
  // Dentro da fala: base.
  for (const f of fala) if (t >= f.de_s && t <= f.ate_s) return 0;
  // Pausa em volta de t.
  let antes = -Infinity;
  let depois = Infinity;
  fala.forEach((f) => {
    if (f.ate_s < t && f.ate_s > antes) antes = f.ate_s;
    if (f.de_s > t && f.de_s < depois) depois = f.de_s;
  });
  const tamanho = (isFinite(depois) ? depois : o.fim_s !== undefined ? o.fim_s : Infinity) - (isFinite(antes) ? antes : 0);
  if (tamanho < pausa) return 0;
  const sobe = isFinite(antes) ? Math.min(1, (t - antes) / Math.max(0.001, soltura)) : 1;
  const desce = isFinite(depois) ? Math.min(1, (depois - t) / Math.max(0.001, ataque)) : 1;
  return Math.round(subida * Math.max(0, Math.min(sobe, desce)) * 1000) / 1000;
}

export interface MedidaDoLoudnorm {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

/** Passo 1 do loudnorm (só mede). */
export const filtroLoudnormMedir = (alvo: number = MIXAGEM_PADRAO.lufs_alvo, tp: number = MIXAGEM_PADRAO.pico_real_db) => `loudnorm=I=${alvo}:TP=${tp}:LRA=11:print_format=json`;

/** Lê o JSON que o loudnorm imprime no fim do passo 1. */
export function lerLoudnorm(saida: string): MedidaDoLoudnorm | null {
  const fim = saida.lastIndexOf("}");
  const ini = fim >= 0 ? saida.lastIndexOf("{", fim) : -1;
  if (ini < 0) return null;
  try {
    const j = JSON.parse(saida.slice(ini, fim + 1)) as Record<string, string>;
    const n = (k: string) => Number(j[k]);
    const m = { input_i: n("input_i"), input_tp: n("input_tp"), input_lra: n("input_lra"), input_thresh: n("input_thresh"), target_offset: n("target_offset") };
    return Object.values(m).every((v) => isFinite(v)) ? m : null;
  } catch {
    return null;
  }
}

/** Passo 2: aplica com a medida (linear quando dá), para o arquivo sair em -14 LUFS. */
export function filtroLoudnormAplicar(m: MedidaDoLoudnorm, alvo: number = MIXAGEM_PADRAO.lufs_alvo, tp: number = MIXAGEM_PADRAO.pico_real_db): string {
  return `loudnorm=I=${alvo}:TP=${tp}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
}

/** Ganho (dB) que leva uma medida ao alvo (conferência do render). */
export const ganhoParaOAlvoDb = (lufsMedido: number, alvo: number = MIXAGEM_PADRAO.lufs_alvo) => Math.round((alvo - lufsMedido) * 10) / 10;

/** O arquivo final está no alvo? Tolerância de 1 LU. */
export const noAlvoDeLoudness = (lufsMedido: number, alvo: number = MIXAGEM_PADRAO.lufs_alvo, tolerancia = 1) => Math.abs(lufsMedido - alvo) <= tolerancia;
