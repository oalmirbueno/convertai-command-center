/**
 * briefing-publico: resposta por áudio (frente BRF2, 30/09/2026). O link é
 * público: o token é a chave, e tudo é conferido antes de gastar.
 *
 * transcrever (corpo = bytes do áudio; x-briefing-campo, x-briefing-duracao)
 *   -> { texto, segundos }
 *
 * 1. estado do link (aberto, com cliente) e tetos pela RPC
 *    briefing_transcricao_reservar (40 por briefing, 45 minutos, 6 por minuto);
 * 2. chave (a do cliente ou a da agência), cota e saldo da carteira ANTES de
 *    chamar o provedor;
 * 3. whisper-1 (o mesmo do Editor de vídeo), em português;
 * 4. uso registrado pela duração real (tarefa e agente "briefing"). O áudio
 *    não é guardado em lugar nenhum.
 * Falha nunca vira "link inválido": volta a frase para o cliente escrever.
 */

import { garantirCota, garantirSaldo, IaMotorErro, type ModeloIa, registrarUso, resolverChave } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { custoDaTranscricao, MAX_BYTES_DO_AUDIO, MAX_SEGUNDOS_DO_AUDIO, TRANSCRICAO, tipoDoAudio } from "../_shared/briefing-audio.ts";
import { estadoDoLink } from "../_shared/briefing-modelos.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Resposta = (body: unknown, status?: number) => Response;
type BriefingDoToken = { id: string; client_id: string | null; submitted: boolean | null; expira_em: string | null };

const MOTIVO: Record<string, [number, string]> = {
  inexistente: [404, "Link inválido ou arquivado."],
  enviado: [409, "Este briefing já foi enviado."],
  expirado: [410, "Este link expirou. Peça um novo à equipe."],
  sem_cliente: [409, "Este link não aceita áudio. Escreva a resposta."],
  longo: [413, "O áudio passa de 3 minutos. Grave em partes."],
  muitas: [429, "Este briefing já recebeu muitos áudios. Escreva o resto da resposta."],
  cota: [429, "Os áudios deste briefing passaram de 45 minutos. Escreva o resto da resposta."],
  devagar: [429, "Muitos áudios em um minuto. Espere um pouco e tente de novo."],
  campo_invalido: [400, "Pergunta inválida para áudio."],
};

/** Modelo só para o registro do uso de áudio (não está no catálogo de texto). */
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

export async function transcrever(req: Request, token: string, b: BriefingDoToken, db: SupabaseClient, json: Resposta): Promise<Response> {
  const erro = (codigo: string, mensagem: string, status: number) => json({ error: codigo, mensagem }, status);
  if (estadoDoLink(b) !== "aberto") return erro(b.submitted ? "enviado" : "expirado", b.submitted ? "Este briefing já foi enviado." : "Este link expirou. Peça um novo à equipe.", b.submitted ? 409 : 410);
  const tipo = tipoDoAudio(req.headers.get("content-type"));
  if (!tipo) return erro("tipo_nao_aceito", "Este formato de áudio não é aceito. Escreva a resposta.", 415);
  const tamanho = Number(req.headers.get("content-length"));
  if (!Number.isSafeInteger(tamanho) || tamanho <= 0) return erro("tamanho_obrigatorio", "O tamanho do envio é obrigatório.", 411);
  if (tamanho > MAX_BYTES_DO_AUDIO) return erro("grande", "O áudio ficou grande demais. Grave em partes menores.", 413);
  const duracao = Math.max(1, Math.min(MAX_SEGUNDOS_DO_AUDIO + 5, Number(req.headers.get("x-briefing-duracao")) || MAX_SEGUNDOS_DO_AUDIO));
  const campo = (req.headers.get("x-briefing-campo") || "").trim() || null;

  const { data: reserva, error: erroReserva } = await db.rpc("briefing_transcricao_reservar", { _token: token, _campo: campo, _segundos: Math.min(duracao, MAX_SEGUNDOS_DO_AUDIO) });
  if (erroReserva) {
    registrarFalha("briefing-publico: reserva da transcrição falhou", erroReserva, { briefing_id: b.id });
    return erro("reserva_falhou", "Não foi possível transcrever agora. Escreva a resposta ou tente de novo.", 503);
  }
  const r = reserva as { ok: boolean; motivo?: string; transcricao_id?: string; client_id?: string } | null;
  if (!r?.ok || !r.transcricao_id || !r.client_id) {
    const [st, msg] = MOTIVO[r?.motivo || ""] ?? [400, "Não foi possível aceitar o áudio."];
    return erro(r?.motivo || "recusado", msg, st);
  }
  const id = r.transcricao_id;
  const clientId = r.client_id;
  const falhar = async (codigo: string, mensagem: string, status: number, e?: unknown) => {
    if (e) registrarFalha(`briefing-publico: transcrição falhou (${codigo})`, e, { briefing_id: b.id, transcricao_id: id });
    await db.from("briefing_transcricoes").update({ status: "falhou", erro: codigo, concluido_em: new Date().toISOString() }).eq("id", id).then(
      () => undefined,
      (x: unknown) => registrarFalha("briefing-publico: estado da transcrição não gravado", x, { transcricao_id: id }),
    );
    return erro(codigo, mensagem, status);
  };

  // Chave, cota e saldo antes de gastar (a frase do cliente não fala de carteira).
  const estimativa = custoDaTranscricao(duracao);
  let chave;
  try {
    chave = await resolverChave(clientId, "openai");
    garantirCota(chave, estimativa);
    await garantirSaldo(clientId, estimativa);
  } catch (e) {
    const codigo = e instanceof IaMotorErro ? e.codigo : "chave_indisponivel";
    return await falhar(codigo, "A resposta por áudio não está disponível agora. Escreva a resposta; a equipe já foi avisada.", 503, e);
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch (e) {
    return await falhar("envio_falhou", "O áudio não chegou inteiro. Tente de novo.", 400, e);
  }
  if (bytes.byteLength !== tamanho || bytes.byteLength > MAX_BYTES_DO_AUDIO) return await falhar("tamanho_divergente", "O áudio não chegou inteiro. Tente de novo.", 400);

  const form = new FormData();
  form.append("file", new File([bytes], `resposta.${tipo.ext}`, { type: tipo.mime }));
  form.append("model", TRANSCRICAO.modelo);
  form.append("response_format", "verbose_json");
  form.append("language", "pt");
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${chave.segredo}` }, body: form, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    return await falhar("provedor_timeout", "A transcrição demorou demais. Tente de novo ou escreva a resposta.", 504, e);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return await falhar(res.status === 429 ? "provedor_ocupado" : "provedor_erro", "A transcrição não funcionou agora. Tente de novo ou escreva a resposta.", 502, new Error(`whisper respondeu ${res.status}`));
  }
  const j = (await res.json().catch(() => null)) as { text?: string; duration?: number } | null;
  const texto = String((j && j.text) || "").replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 6_000);
  const segundos = Math.max(1, Math.min(MAX_SEGUNDOS_DO_AUDIO, Number(j && j.duration) || duracao));
  const custo = custoDaTranscricao(segundos);
  try {
    await registrarUso({
      clientId,
      tarefa: "briefing",
      agente: "briefing",
      modelo: MODELO_DE_AUDIO,
      tokensEntrada: 0,
      tokensSaida: 0,
      tokensCache: 0,
      imagens: 0,
      qualidade: null,
      custoUsd: custo,
      custoFonte: "tabela",
      referencia: { tipo: "briefing_transcricao", id },
      criadoPor: null,
      chave,
    });
  } catch (e) {
    // A transcrição foi feita: o texto volta para o cliente e a falha do registro fica no log.
    registrarFalha("briefing-publico: uso da transcrição não registrado", e, { transcricao_id: id, custo_usd: custo });
  }
  const { error } = await db.from("briefing_transcricoes").update({ status: "pronta", segundos, caracteres: texto.length, custo_usd: custo, concluido_em: new Date().toISOString() }).eq("id", id);
  if (error) registrarFalha("briefing-publico: transcrição não concluída no banco", error, { transcricao_id: id });
  if (!texto) return erro("sem_fala", "Não deu para entender o áudio. Tente de novo mais perto do microfone.", 422);
  return json({ texto, segundos });
}
