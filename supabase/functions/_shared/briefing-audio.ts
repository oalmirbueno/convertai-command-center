/**
 * Resposta por áudio no link do briefing (frente BRF2, 30/09/2026): o cliente
 * grava no celular, o painel transcreve e o texto entra no campo para ele
 * conferir e corrigir. O áudio não fica guardado.
 *
 * Transcrição: o mesmo provedor que o painel já usa no Editor de vídeo
 * (OpenAI whisper-1, cobrado por minuto). O custo vai para a carteira de IA do
 * cliente, com tarefa e agente "briefing" (papel da frente BASE).
 *
 * Puro: sem Deno e sem npm (a página pública e a função usam os mesmos tetos).
 * Sem travessão.
 */

export const TRANSCRICAO = {
  modelo: "whisper-1",
  modeloId: "openai:whisper-1",
  usdPorMinuto: 0.006,
  fonte: "https://platform.openai.com/docs/guides/speech-to-text (whisper-1)",
} as const;

/** Uma gravação: até 3 minutos e 8 MB (celular grava em webm ou mp4 com boa margem). */
export const MAX_SEGUNDOS_DO_AUDIO = 180;
export const MAX_BYTES_DO_AUDIO = 8 * 1024 * 1024;

/** Tipos de áudio aceitos (o que o MediaRecorder dos navegadores grava). */
export const TIPOS_DE_AUDIO: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
};

/** O tipo base (sem ";codecs=...") e a extensão; null quando não é áudio aceito. */
export function tipoDoAudio(contentType: string | null | undefined): { mime: string; ext: string } | null {
  const base = String(contentType || "").split(";")[0].trim().toLowerCase();
  const ext = TIPOS_DE_AUDIO[base];
  return ext ? { mime: base, ext } : null;
}

/** Custo antes (arredonda o segundo para cima, como o provedor cobra por minuto). */
export function custoDaTranscricao(segundos: number): number {
  const s = Math.max(1, Math.ceil(Number(segundos) || 0));
  return Math.round((s / 60) * TRANSCRICAO.usdPorMinuto * 1e6) / 1e6;
}

/** Junta o texto transcrito ao que já estava no campo (um espaço ou uma linha entre eles). */
export function juntarTranscricao(atual: string, novo: string, longo: boolean): string {
  const a = String(atual || "").trim();
  const n = String(novo || "").replace(/\s+/g, " ").trim();
  if (!n) return a;
  if (!a) return n;
  return `${a}${longo ? "\n" : " "}${n}`;
}
