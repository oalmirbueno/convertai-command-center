/**
 * briefing-agente, frente BRF2 (30/09/2026): exportar o briefing para o
 * contexto do cliente (ou da marca), com Confirmar e Desfazer. Vale também
 * para o briefing preenchido pela equipe (antes de o cliente enviar).
 *
 * - exportar_contexto { briefing_id } -> prévia: { destino, sugestoes, memoria } (nada gravado)
 * - exportar_contexto { briefing_id, confirmar: true, sugestoes: string[], memoria: boolean }
 *   -> { aplicadas, memoria_id, destino } (grava no contexto e, se pedido, guarda as respostas no
 *   cérebro do cliente como memória "briefing")
 * - desfazer_exportacao { briefing_id } -> { voltaram, mantidos }
 *
 * Regra de herança: a marca que não é a principal grava só no contexto dela.
 * Sem IA e sem custo: os campos que alimentam o contexto são regra do modelo.
 */

import { registrarFalha } from "../_shared/falha-registrada.ts";
import { campoVisivel, modeloDoLink, type Respostas, textoDaResposta } from "../_shared/briefing-modelos.ts";
import { aplicarNoContexto, type Aplicada, desfazerNoContexto, sugestoesParaOContexto } from "../_shared/briefing-decupagem.ts";
import { anexosDoBriefing, destinoDoBriefing, gravarContexto, lerContextoDoDestino, type DestinoDoContexto } from "../_shared/briefing-decupar.ts";
import { type Chamador, ErroHttp, json, lerBriefing, nomeDoCliente, registrar, servico } from "./base.ts";

const CAMPOS = "id, token, client_id, project_id, marca_id, modelo, modelo_versao, modelo_conteudo, prefill, titulo, responses, submitted, expira_em, enviado_em, envios, reabertura_pedida_em, arquivado_em, arquivo_pdf_id, created_at, exportado";

type Exportado = { em: string; por: string; destino: DestinoDoContexto; aplicadas: Aplicada[]; memoria_id: string | null; desfeito_em?: string | null };

/** As respostas em texto, por bloco (o que vai para o cérebro do cliente). */
function textoDasRespostas(b: { modelo: string | null; modelo_conteudo: unknown; responses: Record<string, unknown> | null }, anexos: Awaited<ReturnType<typeof anexosDoBriefing>>): string {
  const modelo = modeloDoLink(b.modelo, b.modelo_conteudo);
  const respostas = (b.responses || {}) as Respostas;
  const partes: string[] = [];
  modelo.blocos.forEach((bl) => {
    const linhas = bl.campos
      .filter((c) => campoVisivel(c, respostas))
      .map((c) => ({ p: c.pergunta, r: textoDaResposta(c, respostas, anexos) }))
      .filter((x) => x.r)
      .map((x) => `- ${x.p}: ${x.r}`);
    if (linhas.length) partes.push(`${bl.titulo}\n${linhas.join("\n")}`);
  });
  return partes.join("\n\n");
}

export async function exportarContexto(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id, CAMPOS);
  if (!b.client_id) throw new ErroHttp(409, "sem_cliente", "Ligue o briefing a um cliente antes de exportar.");
  const clientId = b.client_id;
  const anterior = b.exportado as Exportado | null;
  if (anterior && !anterior.desfeito_em && corpo.confirmar === true) throw new ErroHttp(409, "ja_exportado", "Este briefing já foi exportado. Desfaça antes de exportar de novo.");
  const modelo = modeloDoLink(b.modelo, b.modelo_conteudo);
  const respostas = (b.responses || {}) as Respostas;
  const anexos = await anexosDoBriefing(servico(), b.id);
  const { destino, contexto } = await destinoDoBriefing(servico(), clientId, b.marca_id);
  // Sem decupagem (é do envio): aqui só a regra do modelo (campos que alimentam o contexto).
  const sugestoes = sugestoesParaOContexto({ modelo, respostas, decupagem: { itens: [], tom_de_voz: null, tom_confianca: null }, contexto, briefingId: b.id, recebidoEm: b.enviado_em, anexos });
  const texto = textoDasRespostas(b, anexos);
  const cliente = await nomeDoCliente(clientId);
  const titulo = `Briefing: ${b.titulo || modelo.titulo}`.slice(0, 200);
  if (corpo.confirmar !== true) {
    return json({ destino, sugestoes, memoria: { titulo, previa: texto.slice(0, 900), caracteres: texto.length }, exportado: anterior && !anterior.desfeito_em ? anterior : null });
  }

  const escolhidas = (Array.isArray(corpo.sugestoes) ? corpo.sugestoes : []).map(String);
  const aplicar = sugestoes.filter((s) => escolhidas.indexOf(s.id) >= 0);
  const guardarMemoria = corpo.memoria === true && texto.length > 0;
  if (!aplicar.length && !guardarMemoria) throw new ErroHttp(400, "nada_para_exportar", "Escolha ao menos um campo ou guarde as respostas no cérebro.");

  let aplicadas: Aplicada[] = [];
  if (aplicar.length) {
    const atual = await lerContextoDoDestino(servico(), clientId, destino);
    const r = aplicarNoContexto(atual, aplicar);
    await gravarContexto(servico(), clientId, destino, r.novo, ch.userId);
    aplicadas = r.aplicadas;
  }
  let memoriaId: string | null = null;
  if (guardarMemoria) {
    const { data, error } = await servico().from("project_memory").insert({
      client_id: clientId,
      project_id: b.project_id,
      kind: "briefing",
      source: "briefing",
      title: titulo,
      content: `${titulo} de ${cliente.nome}${b.enviado_em ? `, enviado em ${new Date(b.enviado_em).toLocaleDateString("pt-BR")}` : ", preenchido pela equipe"}.\n\n${texto}`.slice(0, 60_000),
      tags: ["briefing", modelo.slug],
      metadata: { briefing_id: b.id, marca_id: b.marca_id, destino },
      created_by: ch.userId,
    }).select("id").single();
    if (error || !data) {
      registrarFalha("briefing-agente: respostas não guardadas no cérebro", error, { briefing_id: b.id });
      // O contexto já foi gravado: volta para não ficar pela metade.
      if (aplicadas.length) {
        const atual = await lerContextoDoDestino(servico(), clientId, destino);
        await gravarContexto(servico(), clientId, destino, desfazerNoContexto(atual, aplicadas).novo, ch.userId);
      }
      throw new ErroHttp(503, "memoria_nao_gravada", "Não foi possível guardar as respostas no cérebro do cliente. Nada foi mudado.");
    }
    memoriaId = String((data as { id: string }).id);
  }
  const registro: Exportado = { em: new Date().toISOString(), por: ch.userId, destino, aplicadas, memoria_id: memoriaId, desfeito_em: null };
  const { error: e2 } = await servico().from("briefings").update({ exportado: registro }).eq("id", b.id);
  if (e2) registrarFalha("briefing-agente: registro da exportação não gravado", e2, { briefing_id: b.id });
  await registrar(ch, "briefing_exportar_contexto", { briefing_id: b.id, campos: aplicadas.map((a) => a.campo), memoria_id: memoriaId, destino }, memoriaId || b.id);
  return json({ aplicadas: aplicadas.map((a) => a.campo), memoria_id: memoriaId, destino, aviso: e2 ? "Exportado, mas o Desfazer não ficou disponível." : null });
}

export async function desfazerExportacao(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id, CAMPOS);
  const reg = b.exportado as Exportado | null;
  if (!b.client_id || !reg || reg.desfeito_em) throw new ErroHttp(409, "nada_para_desfazer", "Este briefing não tem exportação para desfazer.");
  let voltaram: string[] = [];
  let mantidos: Array<{ campo: string; motivo: string }> = [];
  if (reg.aplicadas && reg.aplicadas.length) {
    const atual = await lerContextoDoDestino(servico(), b.client_id, reg.destino);
    const r = desfazerNoContexto(atual, reg.aplicadas);
    await gravarContexto(servico(), b.client_id, reg.destino, r.novo, ch.userId);
    voltaram = r.voltaram;
    mantidos = r.mantidos;
  }
  if (reg.memoria_id) {
    // Apagar é arquivar: a memória fica, marcada como desfeita.
    const { data: m } = await servico().from("project_memory").select("tags, title, metadata").eq("id", reg.memoria_id).maybeSingle();
    if (m) {
      const linha = m as { tags?: string[] | null; title?: string | null; metadata?: Record<string, unknown> | null };
      const tags = (linha.tags || []).indexOf("desfeita") >= 0 ? linha.tags || [] : (linha.tags || []).concat("desfeita");
      const { error } = await servico().from("project_memory").update({
        tags,
        title: String(linha.title || "").indexOf("Desfeita: ") === 0 ? linha.title : `Desfeita: ${String(linha.title || "")}`.slice(0, 200),
        metadata: { ...(linha.metadata || {}), desfeita_em: new Date().toISOString(), desfeita_por: ch.userId },
      }).eq("id", reg.memoria_id);
      if (error) registrarFalha("briefing-agente: memória não marcada como desfeita", error, { memoria_id: reg.memoria_id });
    }
  }
  const { error } = await servico().from("briefings").update({ exportado: { ...reg, desfeito_em: new Date().toISOString() } }).eq("id", b.id);
  if (error) registrarFalha("briefing-agente: desfazer da exportação não registrado", error, { briefing_id: b.id });
  await registrar(ch, "briefing_desfazer_exportacao", { briefing_id: b.id, voltaram, mantidos: mantidos.map((x) => x.campo) }, b.id);
  return json({ voltaram, mantidos });
}
