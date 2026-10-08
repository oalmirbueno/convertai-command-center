/**
 * Áudio para o Gestor (08/10/2026): o dono grava ou anexa um áudio e ele vira
 * a mensagem. Mesmo caminho da resposta por áudio do briefing (whisper-1, em
 * português), mas pago pela carteira de IA da agência. O áudio não é guardado:
 * só o texto volta para a conversa.
 *
 * Chave, cota e saldo são conferidos ANTES de chamar o provedor; o uso é
 * registrado pela duração real.
 */

import { garantirCota, garantirSaldo, IaMotorErro, type ModeloIa, registrarUso, resolverChave } from "../../_shared/ia-motor.ts";
import { registrarFalha } from "../../_shared/falha-registrada.ts";
import { custoDaTranscricao, TRANSCRICAO, tipoDoAudio } from "../../briefing-publico/modulos/briefing-audio.ts";

/** Do dono: até 10 minutos e 24 MB (o limite do provedor é 25 MB). */
export const MAX_SEGUNDOS_DO_AUDIO_DO_GESTOR = 600;
export const MAX_BYTES_DO_AUDIO_DO_GESTOR = 24 * 1024 * 1024;

const MODELO_DE_AUDIO: ModeloIa = {
  id: TRANSCRICAO.modeloId,
  provedor: "openai",
  modelo_api: TRANSCRICAO.modelo,
  tipo: "texto",
  rotulo: TRANSCRICAO.modelo,
  preco_entrada_1m: null,
  preco_saida_1m: null,
  preco_cache_1m: null,
  preco_imagem: null,
  raciocinio: null,
  padrao_para: null,
  ativo: true,
  fonte_preco: TRANSCRICAO.fonte,
  conferido_em: null,
};

export class ErroDaTranscricao extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) { super(mensagem); }
}

/** Transcreve os bytes do áudio. `agencia` é a carteira que paga. */
export async function transcreverAudio(e: { bytes: Uint8Array<ArrayBuffer>; contentType: string | null; segundos: number; agencia: string; userId: string }): Promise<{ texto: string; segundos: number; custoUsd: number }> {
  const tipo = tipoDoAudio(e.contentType);
  if (!tipo) throw new ErroDaTranscricao(415, "tipo_nao_aceito", "Esse formato de áudio não é aceito. Mande em mp3, m4a, ogg, wav ou webm.");
  if (!e.bytes.byteLength) throw new ErroDaTranscricao(400, "audio_vazio", "O áudio chegou vazio. Grave de novo.");
  if (e.bytes.byteLength > MAX_BYTES_DO_AUDIO_DO_GESTOR) throw new ErroDaTranscricao(413, "audio_grande", "O áudio passou de 24 MB. Mande em partes menores.");
  const duracao = Math.max(1, Math.min(MAX_SEGUNDOS_DO_AUDIO_DO_GESTOR, Number(e.segundos) || 60));

  const estimativa = custoDaTranscricao(duracao);
  let chave;
  try {
    chave = await resolverChave(e.agencia, "openai");
    garantirCota(chave, estimativa);
    await garantirSaldo(e.agencia, estimativa);
  } catch (err) {
    registrarFalha("gestor-aceleriq: transcrição sem chave ou saldo", err);
    const codigo = err instanceof IaMotorErro ? err.codigo : "chave_indisponivel";
    throw new ErroDaTranscricao(503, codigo, "O áudio não pode ser transcrito agora (chave ou saldo da IA). Escreva a mensagem.");
  }

  const form = new FormData();
  form.append("file", new File([e.bytes], `audio.${tipo.ext}`, { type: tipo.mime }));
  form.append("model", TRANSCRICAO.modelo);
  form.append("response_format", "verbose_json");
  form.append("language", "pt");
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${chave.segredo}` }, body: form, signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    registrarFalha("gestor-aceleriq: transcrição demorou", err);
    throw new ErroDaTranscricao(504, "provedor_timeout", "A transcrição demorou demais. Tente de novo.");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    registrarFalha("gestor-aceleriq: transcrição recusada", new Error(`whisper respondeu ${res.status}`));
    throw new ErroDaTranscricao(502, res.status === 429 ? "provedor_ocupado" : "provedor_erro", "A transcrição não funcionou agora. Tente de novo.");
  }
  const j = (await res.json().catch(() => null)) as { text?: string; duration?: number } | null;
  const texto = String((j && j.text) || "").replace(/\s*[–—]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 12_000);
  const segundos = Math.max(1, Math.min(MAX_SEGUNDOS_DO_AUDIO_DO_GESTOR, Number(j && j.duration) || duracao));
  const custoUsd = custoDaTranscricao(segundos);
  try {
    await registrarUso({
      clientId: e.agencia,
      tarefa: "conversa",
      agente: "estrategista",
      modelo: MODELO_DE_AUDIO,
      tokensEntrada: 0,
      tokensSaida: 0,
      tokensCache: 0,
      imagens: 0,
      qualidade: null,
      custoUsd,
      custoFonte: "tabela",
      referencia: { tipo: "gestor_transcricao", id: crypto.randomUUID() },
      criadoPor: e.userId,
      chave,
    });
  } catch (err) {
    registrarFalha("gestor-aceleriq: uso da transcrição não registrado", err, { custo_usd: custoUsd });
  }
  if (!texto) throw new ErroDaTranscricao(422, "sem_fala", "Não deu para entender o áudio. Tente de novo mais perto do microfone.");
  return { texto, segundos, custoUsd };
}
