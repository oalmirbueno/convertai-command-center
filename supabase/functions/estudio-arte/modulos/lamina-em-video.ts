/**
 * Lâmina de vídeo do carrossel estilo X (22/10/2026): o contrato entre o Estúdio e o worker de
 * render. A lâmina já guardada em PNG (a moldura do post, desenhada por código, com o quadro do
 * vídeo no bloco) é o fundo; o vídeo entra INTEIRO no retângulo do bloco, com os mesmos cantos,
 * e sai um MP4 do tamanho da lâmina. Sem Remotion: dois passos de ffmpeg (máscara dos cantos e
 * composição), determinísticos e rápidos. Puro: a função e o worker (Node) usam o mesmo arquivo.
 */

export const TIPO_DA_LAMINA_EM_VIDEO = "lamina_video";
/** Teto da lâmina de vídeo (o Instagram aceita até 60 s por item do carrossel). */
export const MAX_SEGUNDOS_DA_LAMINA = 60;
export const QPS_DA_LAMINA = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RetanguloDaLamina { x: number; y: number; largura: number; altura: number; raio: number }
export interface EntradaDaLaminaEmVideo {
  trabalho_id: string;
  ordem: number;
  versao: number;
  largura: number;
  altura: number;
  fundo: { bucket: "mesa"; caminho: string };
  video: { bucket: "mesa" | "workspace"; caminho: string };
  retangulo: RetanguloDaLamina;
  enquadramento: "inteira" | "preencher";
  foco_x: number;
  foco_y: number;
  /** Cor que sobra em volta do vídeo no modo "inteira" (a do fundo do bloco). */
  cor_do_bloco: string;
  som: boolean;
  saida: string;
}

const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const seguro = (c: unknown) => typeof c === "string" && c.length <= 500 && !/[\\%?#:'"]/.test(c) && c.split("/").every((s) => !!s && s !== "." && s !== "..");
const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Confere a entrada (no pedido e de novo no worker): caminhos do cliente, retângulo dentro da lâmina. */
export function normalizarEntradaDaLaminaEmVideo(v: unknown, clientId: string): EntradaDaLaminaEmVideo {
  const o = objeto(v);
  const falha = (m: string): never => { throw new Error(m); };
  if (typeof o.trabalho_id !== "string" || !UUID.test(o.trabalho_id)) falha("Trabalho da lâmina inválido.");
  if (typeof o.ordem !== "number" || !Number.isInteger(o.ordem) || o.ordem < 1) falha("Lâmina inválida.");
  if (typeof o.versao !== "number" || !Number.isInteger(o.versao) || o.versao < 1) falha("Versão da lâmina inválida.");
  const largura = Number(o.largura), altura = Number(o.altura);
  if (largura !== 1080 || [1080, 1350, 1440, 1920].indexOf(altura) < 0) falha("Tamanho da lâmina inválido.");
  const fundo = objeto(o.fundo), video = objeto(o.video);
  if (fundo.bucket !== "mesa" || !seguro(fundo.caminho) || !String(fundo.caminho).startsWith(`${clientId}/`) || !/\.png$/i.test(String(fundo.caminho))) falha("A moldura da lâmina precisa ser o PNG guardado deste cliente.");
  const doVideo = video.bucket === "mesa" ? `${clientId}/` : video.bucket === "workspace" ? `client/${clientId}/` : null;
  if (!doVideo || !seguro(video.caminho) || !String(video.caminho).startsWith(doVideo)) falha("O vídeo do bloco precisa ser deste cliente.");
  const r = objeto(o.retangulo);
  const nums = [r.x, r.y, r.largura, r.altura, r.raio].map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) falha("Retângulo do vídeo inválido.");
  const [x, y, w, h, raio] = nums;
  if (w < 32 || h < 32 || x + w > largura + 1 || y + h > altura + 1) falha("O vídeo precisa caber dentro da lâmina.");
  const foco = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
  const cor = typeof o.cor_do_bloco === "string" && /^#[0-9a-f]{6}$/i.test(o.cor_do_bloco) ? o.cor_do_bloco.toLowerCase() : "#000000";
  if (typeof o.saida !== "string" || !seguro(o.saida) || !o.saida.startsWith(`${clientId}/estudio/template/videos/`) || !/\.mp4$/.test(o.saida)) falha("Destino do MP4 inválido.");
  // Pares para o yuv420p; o retângulo nunca passa da borda depois de arredondar.
  const X = Math.min(largura - 32, Math.round(x / 2) * 2), Y = Math.min(altura - 32, Math.round(y / 2) * 2);
  const W = Math.min(par(w), Math.floor((largura - X) / 2) * 2), H = Math.min(par(h), Math.floor((altura - Y) / 2) * 2);
  return {
    trabalho_id: (o.trabalho_id as string).toLowerCase(), ordem: o.ordem as number, versao: o.versao as number, largura, altura,
    fundo: { bucket: "mesa", caminho: fundo.caminho as string },
    video: { bucket: video.bucket as "mesa" | "workspace", caminho: video.caminho as string },
    retangulo: { x: X, y: Y, largura: W, altura: H, raio: Math.min(Math.round(raio), Math.floor(Math.min(W, H) / 2)) },
    enquadramento: o.enquadramento === "preencher" ? "preencher" : "inteira",
    foco_x: foco(o.foco_x), foco_y: foco(o.foco_y), cor_do_bloco: cor, som: o.som !== false, saida: o.saida as string,
  };
}

/** Passo 1: a máscara dos cantos arredondados (um PNG em tons de cinza, borda suavizada). */
export function argumentosDaMascara(e: EntradaDaLaminaEmVideo, saida: string): string[] {
  const { largura: W, altura: H, raio: R } = e.retangulo;
  const lum = R > 0 ? `255*clip(${R}+0.5-hypot(X-clip(X,${R},W-1-${R}),Y-clip(Y,${R},H-1-${R})),0,1)` : "255";
  return ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:d=1`, "-vf", `format=gray,geq=lum='${lum}'`, "-frames:v", "1", saida];
}

/** Passo 2: o PNG da lâmina parado, o vídeo inteiro (ou cobrindo pelo ponto focal) no retângulo com a máscara. */
export function argumentosDaComposicao(e: EntradaDaLaminaEmVideo, a: { fundo: string; video: string; mascara: string; saida: string }, duracaoDoVideo: number | null, temAudio: boolean): string[] {
  const { x, y, largura: W, altura: H } = e.retangulo;
  const dur = Math.max(0.5, Math.min(MAX_SEGUNDOS_DA_LAMINA, duracaoDoVideo && duracaoDoVideo > 0 ? duracaoDoVideo : MAX_SEGUNDOS_DA_LAMINA));
  const encaixe = e.enquadramento === "preencher"
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${e.foco_x}:(ih-${H})*${e.foco_y}`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${e.cor_do_bloco.replace("#", "0x")}`;
  const filtro = [
    `[1:v]fps=${QPS_DA_LAMINA},${encaixe},setsar=1,format=yuva420p[v]`,
    `[2:v]format=gray,scale=${W}:${H}[m]`,
    "[v][m]alphamerge[va]",
    `[0:v]scale=${e.largura}:${e.altura},format=yuv420p[f]`,
    `[f][va]overlay=${x}:${y}:shortest=1:format=auto,format=yuv420p[saida]`,
  ].join(";");
  const som = e.som && temAudio;
  return [
    "-y", "-v", "error",
    "-loop", "1", "-framerate", String(QPS_DA_LAMINA), "-i", a.fundo,
    "-i", a.video,
    "-loop", "1", "-i", a.mascara,
    "-filter_complex", filtro,
    "-map", "[saida]", ...(som ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"] : ["-an"]),
    "-t", dur.toFixed(3), "-r", String(QPS_DA_LAMINA),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    a.saida,
  ];
}
