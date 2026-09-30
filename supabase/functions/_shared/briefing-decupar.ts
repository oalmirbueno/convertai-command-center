/**
 * Executor da decupagem do briefing (frente BRF, 30/09/2026): banco + Jev.
 * As regras puras moram em briefing-decupagem.ts (testadas no vitest).
 *
 * Quem chama:
 * - briefing-publico, logo depois do envio (sem esperar a pessoa);
 * - briefing-agente, pelo painel ("Decupar de novo" ou decupagem que ficou
 *   na fila).
 * Idempotente: uma decupagem por envio (briefing_decupagens, briefing_id +
 * envio). Quem pega a linha marca "processando"; outra chamada no mesmo
 * minuto não repete o Jev.
 *
 * Contexto do cliente e da marca (regra de herança): marca que não é a
 * principal grava só no contexto dela (cliente_marcas.contexto); a principal
 * e o cliente sem marca gravam no kit do cliente (cliente_kit_marca). Nada é
 * gravado sem Confirmar: aqui só se montam as sugestões; aplicar e desfazer
 * são chamadas à parte, com o que precisa para voltar.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { JevErro, jevPerguntar, type PerguntaJev, type ResultadoJev } from "./jev.ts";
import { cobrarJev } from "./ia-motor.ts";
import { registrarFalha } from "./falha-registrada.ts";
import { gravarTroca } from "./conversa-das-mesas.ts";
import { type AnexoDoBriefing, modeloDoLink } from "./briefing-modelos.ts";
import {
  aplicarNoContexto,
  desfazerNoContexto,
  entradaDaDecupagem,
  estadoDaDecupagem,
  lerDecupagem,
  perguntasDaDecupagem,
  type Aplicada,
  type SugestaoDoContexto,
  sugestoesParaOContexto,
} from "./briefing-decupagem.ts";

export type DestinoDoContexto = { tipo: "kit" } | { tipo: "marca"; marca_id: string; marca_nome: string };

export type LinhaDaDecupagem = {
  id: string;
  briefing_id: string;
  client_id: string | null;
  marca_id: string | null;
  envio: number;
  status: "pendente" | "processando" | "pronta" | "falhou" | "aplicada" | "desfeita";
  itens: unknown[];
  tom_de_voz: string | null;
  sugestoes: SugestaoDoContexto[];
  destino: DestinoDoContexto | null;
  aplicadas: Aplicada[] | null;
  custo_usd: number;
  erro: string | null;
  tentativas: number;
  criado_em: string;
  iniciado_em: string | null;
  concluido_em: string | null;
  aplicada_em: string | null;
  desfeita_em: string | null;
};

export const CAMPOS_DA_DECUPAGEM =
  "id, briefing_id, client_id, marca_id, envio, status, itens, tom_de_voz, sugestoes, destino, aplicadas, custo_usd, erro, tentativas, criado_em, iniciado_em, concluido_em, aplicada_em, desfeita_em";

/** Minutos que uma decupagem "processando" segura a vez (depois, outra chamada retoma). */
const MINUTOS_DE_POSSE = 3;

export class ErroDaDecupagem extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {});

/** Onde o contexto deste briefing mora e o que está lá agora. */
export async function destinoDoBriefing(db: SupabaseClient, clientId: string, marcaId: string | null): Promise<{ destino: DestinoDoContexto; contexto: Record<string, unknown> }> {
  if (marcaId) {
    const { data, error } = await db.from("cliente_marcas").select("id, nome, principal, contexto").eq("id", marcaId).eq("client_id", clientId).maybeSingle();
    if (error) throw new ErroDaDecupagem(503, "marca_indisponivel", "Não foi possível ler a marca do briefing.");
    const m = data as { id: string; nome: string; principal: boolean; contexto: unknown } | null;
    if (m && !m.principal) return { destino: { tipo: "marca", marca_id: m.id, marca_nome: m.nome }, contexto: obj(m.contexto) };
  }
  const { data, error } = await db.from("cliente_kit_marca").select("contexto").eq("client_id", clientId).maybeSingle();
  if (error) throw new ErroDaDecupagem(503, "contexto_indisponivel", "Não foi possível ler o contexto do cliente.");
  return { destino: { tipo: "kit" }, contexto: obj((data as { contexto?: unknown } | null)?.contexto) };
}

export async function lerContextoDoDestino(db: SupabaseClient, clientId: string, destino: DestinoDoContexto): Promise<Record<string, unknown>> {
  if (destino.tipo === "marca") {
    const { data, error } = await db.from("cliente_marcas").select("contexto").eq("id", destino.marca_id).eq("client_id", clientId).maybeSingle();
    if (error || !data) throw new ErroDaDecupagem(503, "marca_indisponivel", "Não foi possível ler o contexto da marca.");
    return obj((data as { contexto?: unknown }).contexto);
  }
  const { data, error } = await db.from("cliente_kit_marca").select("contexto").eq("client_id", clientId).maybeSingle();
  if (error) throw new ErroDaDecupagem(503, "contexto_indisponivel", "Não foi possível ler o contexto do cliente.");
  return obj((data as { contexto?: unknown } | null)?.contexto);
}

export async function gravarContexto(db: SupabaseClient, clientId: string, destino: DestinoDoContexto, contexto: Record<string, unknown>, userId: string) {
  const agora = new Date().toISOString();
  if (destino.tipo === "marca") {
    const { error } = await db.from("cliente_marcas").update({ contexto, atualizado_por: userId, atualizado_em: agora }).eq("id", destino.marca_id).eq("client_id", clientId);
    if (error) throw new ErroDaDecupagem(503, "contexto_nao_gravado", `O contexto da marca ${destino.marca_nome} não foi gravado.`);
    return;
  }
  const { error } = await db.from("cliente_kit_marca").upsert(
    { client_id: clientId, contexto, contexto_atualizado_em: agora, atualizado_em: agora, atualizado_por: userId },
    { onConflict: "client_id" },
  );
  if (error) throw new ErroDaDecupagem(503, "contexto_nao_gravado", "O contexto do cliente não foi gravado.");
}

type LinhaDoBriefing = {
  id: string;
  client_id: string | null;
  marca_id: string | null;
  modelo: string | null;
  modelo_conteudo: unknown;
  responses: Record<string, unknown> | null;
  submitted: boolean | null;
  envios: number | null;
  enviado_em: string | null;
  criado_por: string | null;
};

async function lerBriefing(db: SupabaseClient, briefingId: string): Promise<LinhaDoBriefing> {
  const { data, error } = await db
    .from("briefings")
    .select("id, client_id, marca_id, modelo, modelo_conteudo, responses, submitted, envios, enviado_em, criado_por")
    .eq("id", briefingId)
    .maybeSingle();
  if (error) throw new ErroDaDecupagem(503, "briefing_indisponivel", "Não foi possível ler o briefing.");
  if (!data) throw new ErroDaDecupagem(404, "briefing_inexistente", "Briefing não encontrado.");
  return data as LinhaDoBriefing;
}

export async function anexosDoBriefing(db: SupabaseClient, briefingId: string): Promise<AnexoDoBriefing[]> {
  const { data, error } = await db
    .from("briefing_anexos")
    .select("id, campo, categoria, nome, tamanho, mime, file_id")
    .eq("briefing_id", briefingId)
    .eq("status", "pronto")
    .is("arquivado_em", null)
    .order("criado_em", { ascending: true });
  if (error) {
    registrarFalha("briefing: anexos não lidos", error, { briefing_id: briefingId });
    return [];
  }
  return (data as AnexoDoBriefing[] | null) ?? [];
}

export type PerguntarAoJev = (p: { state: unknown; questions: Record<string, PerguntaJev> }) => Promise<ResultadoJev>;

/**
 * Faz (ou devolve) a decupagem do envio atual do briefing.
 * - forcar: refaz a que já está pronta (não a aplicada: essa precisa de Desfazer antes).
 */
export async function decuparBriefing(
  db: SupabaseClient,
  briefingId: string,
  opcoes: { criadoPor?: string | null; perguntar?: PerguntarAoJev; forcar?: boolean } = {},
): Promise<{ decupagem: LinhaDaDecupagem | null; motivo?: string }> {
  const b = await lerBriefing(db, briefingId);
  if (!b.submitted) return { decupagem: null, motivo: "nao_enviado" };
  const envio = Math.max(1, Number(b.envios) || 1);

  const ler = async () => {
    const { data, error } = await db.from("briefing_decupagens").select(CAMPOS_DA_DECUPAGEM).eq("briefing_id", b.id).eq("envio", envio).maybeSingle();
    if (error) throw new ErroDaDecupagem(503, "decupagem_indisponivel", "Não foi possível ler a decupagem.");
    return data as LinhaDaDecupagem | null;
  };
  let linha = await ler();
  if (!linha) {
    const { error } = await db.from("briefing_decupagens").insert({ briefing_id: b.id, client_id: b.client_id, marca_id: b.marca_id, envio, status: "pendente" });
    if (error && error.code !== "23505") throw new ErroDaDecupagem(503, "decupagem_indisponivel", "Não foi possível abrir a decupagem.");
    linha = await ler();
    if (!linha) throw new ErroDaDecupagem(503, "decupagem_indisponivel", "Não foi possível abrir a decupagem.");
  }

  if (linha.status === "aplicada") {
    if (opcoes.forcar) return { decupagem: linha, motivo: "ja_aplicada" };
    return { decupagem: linha };
  }
  if ((linha.status === "pronta" || linha.status === "desfeita") && !opcoes.forcar) return { decupagem: linha };
  if (linha.status === "processando" && linha.iniciado_em && Date.now() - new Date(linha.iniciado_em).getTime() < MINUTOS_DE_POSSE * 60_000) {
    return { decupagem: linha, motivo: "processando" };
  }

  // Pega a vez: só quem mudou o estado de antes segue (outra chamada ao mesmo tempo para aqui).
  const { data: pega, error: erroPega } = await db
    .from("briefing_decupagens")
    .update({ status: "processando", iniciado_em: new Date().toISOString(), tentativas: (Number(linha.tentativas) || 0) + 1, erro: null })
    .eq("id", linha.id)
    .eq("status", linha.status)
    .select("id");
  if (erroPega) throw new ErroDaDecupagem(503, "decupagem_indisponivel", "Não foi possível começar a decupagem.");
  if (!pega || !(pega as unknown[]).length) return { decupagem: await ler(), motivo: "processando" };

  try {
    const anexos = await anexosDoBriefing(db, b.id);
    const modelo = modeloDoLink(b.modelo, b.modelo_conteudo);
    const respostas = obj(b.responses);
    const entrada = entradaDaDecupagem(modelo, respostas, anexos);
    const perguntas = perguntasDaDecupagem(entrada);
    let respostasDoJev: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number }> | null = null;
    let custo = 0;
    let aviso: string | null = null;

    if (Object.keys(perguntas).length && b.client_id) {
      try {
        const perguntar = opcoes.perguntar ?? ((p) => jevPerguntar(p));
        const r = await perguntar({ state: estadoDaDecupagem(modelo, respostas, entrada, anexos), questions: perguntas as Record<string, PerguntaJev> });
        respostasDoJev = r.answers;
        const cobrado = await cobrarJev(r, { clientId: b.client_id, tarefa: "briefing", referencia: { tipo: "briefing", id: b.id }, criadoPor: opcoes.criadoPor ?? b.criado_por ?? null });
        custo = cobrado?.custoUsd ?? 0;
      } catch (e) {
        registrarFalha("briefing: Jev da decupagem indisponível", e, { briefing_id: b.id, codigo: e instanceof JevErro ? e.codigo : null });
        aviso = "O Jev não respondeu agora: ficou só o que o modelo já separa. Use Decupar de novo mais tarde.";
      }
    }

    const decupagem = lerDecupagem(entrada, respostasDoJev);
    let destino: DestinoDoContexto | null = null;
    let sugestoes: SugestaoDoContexto[] = [];
    if (b.client_id) {
      const d = await destinoDoBriefing(db, b.client_id, b.marca_id);
      destino = d.destino;
      sugestoes = sugestoesParaOContexto({ modelo, respostas, decupagem, contexto: d.contexto, briefingId: b.id, recebidoEm: b.enviado_em, anexos });
    }

    const { error } = await db
      .from("briefing_decupagens")
      .update({
        status: "pronta",
        itens: decupagem.itens,
        tom_de_voz: decupagem.tom_de_voz,
        sugestoes,
        destino,
        aplicadas: null,
        custo_usd: custo,
        erro: aviso,
        concluido_em: new Date().toISOString(),
      })
      .eq("id", linha.id);
    if (error) throw new ErroDaDecupagem(503, "decupagem_nao_gravada", "A decupagem foi feita, mas não ficou gravada.");
    await registrarNaConversa(db, {
      clientId: b.client_id,
      briefingId: b.id,
      userId: opcoes.criadoPor ?? b.criado_por ?? null,
      pedido: `Decupar o briefing recebido (${modelo.nome}, envio ${envio}).`,
      resposta: resumoDaDecupagem(decupagem.itens, decupagem.tom_de_voz, sugestoes.length, aviso),
      anexos: [{ tipo: "briefing_decupagem", decupagem_id: linha.id, briefing_id: b.id }],
    });
    return { decupagem: await ler() };
  } catch (e) {
    const motivo = registrarFalha("briefing: decupagem falhou", e, { briefing_id: b.id });
    await db.from("briefing_decupagens").update({ status: "falhou", erro: motivo.slice(0, 300) }).eq("id", linha.id).then(
      () => undefined,
      (e2: unknown) => registrarFalha("briefing: estado de falha não gravado", e2, { briefing_id: b.id }),
    );
    throw e instanceof ErroDaDecupagem ? e : new ErroDaDecupagem(500, "decupagem_falhou", `A decupagem falhou: ${motivo}`);
  }
}

/** O agente do briefing nas conversas (papel da frente BASE: agente_conversas.agente = "briefing"). */
export const AGENTE_DO_BRIEFING = "briefing";

/**
 * Grava a troca do agente do briefing (o que foi pedido e o que ele fez) na
 * conversa do briefing, para o histórico do cliente. Nunca lança: falha vai
 * para o log e a ação principal segue.
 */
export async function registrarNaConversa(
  db: SupabaseClient,
  p: { clientId: string | null; briefingId: string; userId: string | null; pedido: string; resposta: string; anexos?: unknown[] },
): Promise<void> {
  if (!p.clientId) return;
  try {
    const { data: achadas, error } = await db
      .from("agente_conversas")
      .select("id")
      .eq("client_id", p.clientId)
      .eq("agente", AGENTE_DO_BRIEFING)
      .eq("referencia_tipo", "briefing")
      .eq("referencia_id", p.briefingId)
      .order("criado_em", { ascending: false })
      .limit(1);
    if (error) throw error;
    let conversaId = ((achadas as { id: string }[] | null) ?? [])[0]?.id ?? null;
    if (!conversaId) {
      const { data: nova, error: erroNova } = await db
        .from("agente_conversas")
        .insert({ client_id: p.clientId, agente: AGENTE_DO_BRIEFING, referencia_tipo: "briefing", referencia_id: p.briefingId, criado_por: p.userId })
        .select("id")
        .single();
      if (erroNova || !nova) throw erroNova || new Error("conversa não criada");
      conversaId = (nova as { id: string }).id;
    }
    const r = await gravarTroca(db as never, {
      conversaId,
      clientId: p.clientId,
      usuario: { conteudo: p.pedido },
      agente: { conteudo: p.resposta, anexos: p.anexos ?? [] },
      onde: "briefing",
    });
    if (r.erro) registrarFalha("briefing: troca da conversa incompleta", r.erro, { briefing_id: p.briefingId });
  } catch (e) {
    registrarFalha("briefing: conversa do agente não gravada", e, { briefing_id: p.briefingId });
  }
}

function resumoDaDecupagem(itens: Array<{ categoria: string }>, tom: string | null, sugestoes: number, aviso: string | null): string {
  const conta = (c: string) => itens.filter((i) => i.categoria === c).length;
  const pares: Array<[number, string]> = [
    [conta("palavra_chave"), "palavras-chave"],
    [conta("dor"), "dores"],
    [conta("publico"), "pontos de público"],
    [conta("objetivo"), "objetivos"],
    [conta("restricao"), "restrições"],
    [conta("referencia"), "referências"],
  ];
  const partes = pares.filter((x) => x[0] > 0).map((x) => `${x[0]} ${x[1]}`);
  const base = partes.length ? `Separei ${partes.join(", ")}.` : "Não achei pontos para separar nas respostas.";
  const tomTxt = tom ? ` Tom sugerido: ${tom}.` : "";
  const sug = sugestoes ? ` Deixei ${sugestoes} sugestões para o contexto, esperando Confirmar.` : "";
  return `${base}${tomTxt}${sug}${aviso ? ` ${aviso}` : ""}`;
}

async function lerDecupagemPorId(db: SupabaseClient, id: string): Promise<LinhaDaDecupagem> {
  const { data, error } = await db.from("briefing_decupagens").select(CAMPOS_DA_DECUPAGEM).eq("id", id).maybeSingle();
  if (error) throw new ErroDaDecupagem(503, "decupagem_indisponivel", "Não foi possível ler a decupagem.");
  if (!data) throw new ErroDaDecupagem(404, "decupagem_inexistente", "Decupagem não encontrada.");
  return data as LinhaDaDecupagem;
}

/** Confirmar: grava no contexto só as sugestões escolhidas. Devolve o que foi aplicado. */
export async function aplicarDecupagem(db: SupabaseClient, decupagemId: string, escolhidas: string[], userId: string) {
  const linha = await lerDecupagemPorId(db, decupagemId);
  if (!linha.client_id || !linha.destino) throw new ErroDaDecupagem(409, "sem_cliente", "Este briefing não tem cliente: não há contexto para gravar.");
  if (linha.status !== "pronta" && linha.status !== "desfeita") {
    throw new ErroDaDecupagem(409, "decupagem_fora_de_estado", linha.status === "aplicada" ? "Estas sugestões já foram confirmadas." : "A decupagem ainda não está pronta.");
  }
  const sugestoes = (linha.sugestoes || []).filter((s) => escolhidas.indexOf(s.id) >= 0);
  if (!sugestoes.length) throw new ErroDaDecupagem(400, "nada_escolhido", "Escolha pelo menos uma sugestão.");

  // Trava primeiro (só um Confirmar vale), grava o contexto depois; falhou, destrava.
  const { data: trava, error: erroTrava } = await db
    .from("briefing_decupagens")
    .update({ status: "aplicada", aplicada_em: new Date().toISOString(), aplicada_por: userId, desfeita_em: null, desfeita_por: null })
    .eq("id", linha.id)
    .eq("status", linha.status)
    .select("id");
  if (erroTrava) throw new ErroDaDecupagem(503, "decupagem_indisponivel", "Não foi possível confirmar agora.");
  if (!trava || !(trava as unknown[]).length) throw new ErroDaDecupagem(409, "decupagem_fora_de_estado", "Outra pessoa confirmou ou mudou esta decupagem agora.");

  try {
    const atual = await lerContextoDoDestino(db, linha.client_id, linha.destino);
    const { novo, aplicadas } = aplicarNoContexto(atual, sugestoes);
    await gravarContexto(db, linha.client_id, linha.destino, novo, userId);
    const { error } = await db.from("briefing_decupagens").update({ aplicadas }).eq("id", linha.id);
    if (error) registrarFalha("briefing: desfazer da decupagem não gravado", error, { decupagem_id: linha.id });
    const onde = linha.destino.tipo === "marca" ? `no contexto da marca ${linha.destino.marca_nome}` : "no contexto do cliente";
    await registrarNaConversa(db, {
      clientId: linha.client_id,
      briefingId: linha.briefing_id,
      userId,
      pedido: `Confirmar as sugestões do briefing: ${aplicadas.map((a) => a.campo).join(", ")}.`,
      resposta: `Gravei ${aplicadas.length} ${aplicadas.length === 1 ? "campo" : "campos"} ${onde}. O Desfazer volta como estava.`,
      anexos: [{ tipo: "briefing_decupagem", decupagem_id: linha.id, briefing_id: linha.briefing_id, aplicadas: aplicadas.map((a) => a.campo) }],
    });
    return { aplicadas, destino: linha.destino, desfazer_disponivel: !error };
  } catch (e) {
    await db.from("briefing_decupagens").update({ status: linha.status, aplicada_em: null, aplicada_por: null }).eq("id", linha.id).then(
      () => undefined,
      (e2: unknown) => registrarFalha("briefing: trava da decupagem não desfeita", e2, { decupagem_id: linha.id }),
    );
    throw e;
  }
}

/** Desfazer: volta cada campo que ainda está como ficou. */
export async function desfazerDecupagem(db: SupabaseClient, decupagemId: string, userId: string) {
  const linha = await lerDecupagemPorId(db, decupagemId);
  if (linha.status !== "aplicada" || !linha.client_id || !linha.destino) {
    throw new ErroDaDecupagem(409, "decupagem_fora_de_estado", "Não há confirmação para desfazer.");
  }
  const aplicadas = Array.isArray(linha.aplicadas) ? linha.aplicadas : [];
  if (!aplicadas.length) throw new ErroDaDecupagem(409, "sem_desfazer", "Esta confirmação não guardou o que havia antes.");
  const atual = await lerContextoDoDestino(db, linha.client_id, linha.destino);
  const { novo, voltaram, mantidos } = desfazerNoContexto(atual, aplicadas);
  if (voltaram.length) await gravarContexto(db, linha.client_id, linha.destino, novo, userId);
  const { error } = await db.from("briefing_decupagens").update({ status: "desfeita", desfeita_em: new Date().toISOString(), desfeita_por: userId }).eq("id", linha.id);
  if (error) registrarFalha("briefing: estado do desfazer não gravado", error, { decupagem_id: linha.id });
  await registrarNaConversa(db, {
    clientId: linha.client_id,
    briefingId: linha.briefing_id,
    userId,
    pedido: "Desfazer a confirmação das sugestões do briefing.",
    resposta: mantidos.length
      ? `Voltei ${voltaram.length}; ${mantidos.length} mudaram depois e ficaram como estão (${mantidos.map((m) => m.campo).join(", ")}).`
      : `Voltei ${voltaram.length} ${voltaram.length === 1 ? "campo" : "campos"} ao que era antes.`,
  });
  return { voltaram, mantidos, destino: linha.destino };
}
