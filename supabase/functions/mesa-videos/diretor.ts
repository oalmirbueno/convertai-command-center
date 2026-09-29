/**
 * Agente DIRETOR de vídeo na função mesa-videos (frente V-A, 26/09/2026; AG2, 29/09/2026).
 * Regras e formatos: _shared/diretor-de-video.ts. Contrato: docs/video/CONTRATOS.md.
 *
 * - diretor_conversar { client_id, projeto, texto, fase, selecionados?, conversa? }
 *     -> { projeto, resposta, perguntas, avisos, continuidade, custo_usd, mensagem_id, acao, anexos, conversa_id, aviso_registro? }
 *     GPT-6 Luna com raciocínio "max" pelo ia-motor (carteira do cliente),
 *     busca na web na fase de pesquisa. Resposta com fôlego (pode passar de 150 s).
 *     AG2: a conversa mora em agente_conversas (agente "diretor_arte", referencia_tipo
 *     "mesa_videos", referencia_id = id do projeto) e agente_mensagens (gravarTroca).
 *     O modelo recebe o histórico, o ESTADO REAL do roteiro (pronto, gerando, prontos,
 *     escolhido, custo), a referência do pedido ("essa", "a segunda", "todos": Jev) e as
 *     regras que a equipe ensinou. O cartão (gerar, refazer, mandar ao editor) mora na
 *     mensagem do agente: Confirmar e Desfazer acham por ela, e reabrir mostra o estado.
 * - diretor_salvar { client_id, projeto, versao_lida } -> { projeto }
 * - diretor_propor_gerar { client_id, projeto, planos, variacoes?, refazer? } -> { mensagem_id, acao }
 * - diretor_avaliar { client_id, projeto, plano_ref, arquivo_ids } -> { variacoes, melhor, confianca, custo_usd }
 *     visão descreve cada quadro; o Jev julga (Noul: mesmo personagem? mesmo
 *     cenário? Choice: qual variação segue melhor a bíblia?). Nada é refeito sozinho.
 * - diretor_para_editor { client_id, projeto, titulo? } -> { versao, faltando } (versão rascunho com o projeto de edição)
 * - diretor_editor_desfazer { versao_id } -> { versao } (a versão vira rejeitada; nunca some)
 * - template_salvar { client_id, projeto, nome, da_agencia } -> { template }
 * - template_arquivar { template_id, arquivar } -> { template }
 * Execução das propostas (contrato comum): executarItemDoDiretor (gerar_plano, mandar_ao_editor)
 * e desfazerItemDoDiretor (a versão do editor volta como rejeitada).
 */

import { chamarTexto, cobrarJev, IaMotorErro } from "../_shared/ia-motor.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { lerContextoConsolidado, lerDossie } from "../_shared/contexto-cliente.ts";
import { caminhoDaMiniatura, reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
import { leituraParaAVisao } from "../_shared/video-armazenar.ts";
import { type AcaoDoAgente, comCaminho, executarDireto, type ItemDaAcaoDoAgente, podeExecutarDireto, type ResultadoDoItem } from "../_shared/acoes-do-agente.ts";
import {
  acaoDeGerarPlanos,
  acaoDeMandarAoEditor,
  type AndamentoDoPlano,
  aplicarRespostaDoDiretor,
  blocoDoEstadoReal,
  conferirContinuidade,
  custoDoRoteiro,
  type EntradaDoPlano,
  esquemaDoDiretor,
  estruturaDoTemplate,
  FASES_DO_DIRETOR,
  type FaseDoDiretor,
  lerAvaliacao,
  MODELO_DO_DIRETOR,
  normalizarProjetoDoDiretor,
  OPERACAO_DO_EDITOR,
  perguntasDeContinuidade,
  type PlanoDoRoteiro,
  type PlanoParaOEditor,
  projetoAntesDepois,
  projetoParaEditor,
  projetoParaOModelo,
  type ProjetoDoDiretor,
  prometeSemAcao,
  RACIOCINIO_DO_DIRETOR,
  REGRAS_DIRETAS_DO_DIRETOR,
  sistemaDoDiretor,
} from "../_shared/diretor-de-video.ts";
import { caminhoDaMesaDeVideo } from "../_shared/agente-de-video.ts";
import { kitPorId } from "../_shared/video-kits.ts";
import { MAX_BYTES_DO_PROJETO, tamanhoDoProjeto } from "../_shared/projeto-de-edicao.ts";
import { type BaseDaFuncao, catalogo, enviarGeracao, motorPronto } from "./geracao.ts";
// Frente FS (29/09): leitura ou gravação que falha segue opcional, mas fica no log com o motivo.
import { registrarFalha } from "../_shared/falha-registrada.ts";
// Frente AG2 (29/09): conversa guardada, "essa/a segunda/todos", ordem clara e aprendizado.
import { AVISO_SEM_REGISTRO, blocoDaReferencia, gravarTroca, type ItemReferivel, referenciaDoPedido } from "../_shared/conversa-das-mesas.ts";
import { ehOrdemClara } from "../_shared/ordem-clara.ts";
import { anexoDasRegrasSeguidas, aprenderDoPedido, CAMPOS_DO_APRENDIZADO, regrasDaMesa } from "../_shared/aprendizado-das-mesas.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "mesa";
const TABELA = "video_diretor_projetos";
/** Onde a conversa do diretor mora (agente_conversas: o `agente` tem check; referencia_tipo é livre). */
export const AGENTE_DA_CONVERSA = "diretor_arte";
export const REFERENCIA_DA_CONVERSA = "mesa_videos";
/** Quantas mensagens anteriores vão para o modelo (o histórico inteiro fica no banco). */
const HISTORICO_NO_MODELO = 12;
const EM_ANDAMENTO = ["enviado", "gerando", "baixando", "parcial"];

function projetoDoCorpo(b: BaseDaFuncao, v: unknown): ProjetoDoDiretor {
  const p = normalizarProjetoDoDiretor(v);
  if (!p) throw b.erro(400, "projeto_invalido", "O projeto do diretor veio vazio ou em formato desconhecido.");
  return p;
}

async function contextoDoCliente(b: BaseDaFuncao, clientId: string): Promise<string> {
  const db = b.servico();
  const [perfil, contexto, dossie] = await Promise.all([
    db.from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle().then((r) => r.data as { company_name?: string | null; full_name?: string | null } | null, (e) => (registrarFalha("mesa-videos: perfil do cliente não lido", e), null)),
    lerContextoConsolidado(db, clientId).catch((e) => (registrarFalha("mesa-videos: lerContextoConsolidado falhou", e), ({}))),
    lerDossie(db, clientId, 4000).catch((e) => (registrarFalha("mesa-videos: lerDossie falhou", e), null)),
  ]);
  const nome = perfil ? perfil.company_name || perfil.full_name || "" : "";
  return [nome ? `Cliente: ${nome}` : "", Object.keys(contexto || {}).length ? `Contexto consolidado: ${JSON.stringify(contexto).slice(0, 3000)}` : "", dossie ? `Dossiê:\n${dossie}` : ""].filter(Boolean).join("\n\n") || "sem contexto registrado";
}

/** Grava o projeto (trava otimista pela versão). Sem a tabela: devolve o projeto sem id e avisa (com o motivo no log). */
async function gravarProjeto(b: BaseDaFuncao, clientId: string, p: ProjetoDoDiretor): Promise<{ projeto: ProjetoDoDiretor; gravado: boolean }> {
  const linha: Record<string, unknown> = {
    client_id: clientId,
    titulo: (p.titulo || "Vídeo").slice(0, 120),
    kit_id: p.kit_id,
    template_id: p.template_id,
    fase: p.fase,
    briefing: p.briefing,
    biblia: p.biblia,
    roteiro: p.roteiro,
    atualizado_em: new Date().toISOString(),
  };
  if (p.id) {
    const { data, error } = await b.servico().from(TABELA).update({ ...linha, versao: p.versao + 1 }).eq("id", p.id).eq("client_id", clientId).eq("versao", p.versao).select("id, versao, atualizado_em").maybeSingle();
    if (error) {
      registrarFalha("mesa-videos: projeto do diretor não gravado", error, { projeto_id: p.id });
      return { projeto: p, gravado: false };
    }
    if (!data) throw b.erro(409, "projeto_mudou", "O projeto foi mudado em outra tela. Abra de novo antes de salvar.");
    const d = data as { id: string; versao: number; atualizado_em: string };
    return { projeto: { ...p, versao: d.versao, atualizado_em: d.atualizado_em }, gravado: true };
  }
  const { data, error } = await b.servico().from(TABELA).insert({ ...linha, versao: 1, criado_por: b.userId }).select("id, versao, atualizado_em").single();
  if (error) {
    registrarFalha("mesa-videos: projeto novo do diretor não gravado", error, { client_id: clientId });
    return { projeto: p, gravado: false };
  }
  const d = data as { id: string; versao: number; atualizado_em: string };
  return { projeto: { ...p, id: d.id, versao: d.versao, atualizado_em: d.atualizado_em }, gravado: true };
}

// ------------------------------------------------------------------ conversa guardada (AG2)

/** A conversa do projeto (uma por projeto). `criar`: cria quando não há. Nunca lança (null + log). */
export async function conversaDoProjeto(b: BaseDaFuncao, clientId: string, projetoId: string, criar: boolean): Promise<string | null> {
  if (!UUID.test(projetoId)) return null;
  try {
    const { data, error } = await b.servico()
      .from("agente_conversas")
      .select("id")
      .eq("client_id", clientId)
      .eq("agente", AGENTE_DA_CONVERSA)
      .eq("referencia_tipo", REFERENCIA_DA_CONVERSA)
      .eq("referencia_id", projetoId)
      .order("criado_em", { ascending: false })
      .limit(1);
    if (error) {
      registrarFalha("mesa-videos: conversa do diretor não lida", error, { projeto_id: projetoId });
      return null;
    }
    const achada = Array.isArray(data) && data[0] ? String((data[0] as { id: string }).id) : null;
    if (achada || !criar) return achada;
    const { data: nova, error: e2 } = await b.servico()
      .from("agente_conversas")
      .insert({ client_id: clientId, agente: AGENTE_DA_CONVERSA, referencia_tipo: REFERENCIA_DA_CONVERSA, referencia_id: projetoId, criado_por: b.userId })
      .select("id")
      .single();
    if (e2 || !nova) {
      registrarFalha("mesa-videos: conversa do diretor não criada", e2 || "sem retorno", { projeto_id: projetoId });
      return null;
    }
    return String((nova as { id: string }).id);
  } catch (e) {
    registrarFalha("mesa-videos: conversa do diretor indisponível", e, { projeto_id: projetoId });
    return null;
  }
}

type FalaDoHistorico = { papel: "usuario" | "agente"; conteudo: string };

async function historicoDaConversa(b: BaseDaFuncao, conversaId: string): Promise<FalaDoHistorico[]> {
  const { data, error } = await b.servico().from("agente_mensagens").select("papel, conteudo, criado_em").eq("conversa_id", conversaId).order("criado_em", { ascending: false }).limit(HISTORICO_NO_MODELO);
  if (error) {
    registrarFalha("mesa-videos: histórico do diretor não lido", error, { conversa_id: conversaId });
    return [];
  }
  return ((data || []) as { papel: string; conteudo: string }[])
    .slice()
    .reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: String(m.conteudo || "").slice(0, 1500) }));
}

/** Conversa que a tela ainda tinha só no navegador (projeto sem conversa no banco). */
function historicoDoCorpo(v: unknown): FalaDoHistorico[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => (x.papel === "usuario" || x.papel === "agente") && typeof x.texto === "string" && x.texto)
    .slice(-HISTORICO_NO_MODELO)
    .map((x) => ({ papel: x.papel as "usuario" | "agente", conteudo: String(x.texto).slice(0, 1500) }));
}

/** Pedidos do gerador ligados ao projeto, por plano (o que está gerando, pronto ou com erro). */
async function andamentoDosPlanos(b: BaseDaFuncao, clientId: string, projetoId: string): Promise<Record<string, AndamentoDoPlano>> {
  const saida: Record<string, AndamentoDoPlano> = {};
  const { data, error } = await b.servico().from("video_pedidos").select("alvo, estado").eq("client_id", clientId).eq("projeto_id", projetoId).limit(300);
  if (error) {
    registrarFalha("mesa-videos: andamento dos planos não lido", error, { projeto_id: projetoId });
    return saida;
  }
  ((data || []) as { alvo: { plano_ref?: string } | null; estado: string }[]).forEach((p) => {
    const ref = p.alvo && typeof p.alvo.plano_ref === "string" ? p.alvo.plano_ref : "";
    if (!ref) return;
    const a = saida[ref] || (saida[ref] = { gerando: 0, prontos: 0, falharam: 0 });
    if (EM_ANDAMENTO.indexOf(p.estado) >= 0) a.gerando++;
    else if (p.estado === "pronto") a.prontos++;
    else if (p.estado === "erro") a.falharam++;
  });
  return saida;
}

/** Os planos como o Jev e o modelo veem ("a segunda" = p2), na ordem do roteiro. */
export const planosReferiveis = (p: ProjetoDoDiretor): ItemReferivel[] => p.roteiro.planos.map((x) => ({ ref: x.ref, titulo: `${x.ordem}. ${x.titulo}`, detalhe: x.acao || null }));

/** Esquema do diretor com os campos do aprendizado (a regra ensinada e as regras seguidas). */
function esquemaComAprendizado() {
  const e = esquemaDoDiretor();
  const s = e.schema as { properties: Record<string, unknown>; required: string[] };
  s.properties = { ...s.properties, ...CAMPOS_DO_APRENDIZADO };
  s.required = s.required.concat(["regra_aprendida", "regras_seguidas"]);
  return e;
}

export async function diretorConversar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const texto = String(corpo.texto || "").trim().slice(0, 4000);
  if (!texto) throw b.erro(400, "texto_vazio", "Escreva o pedido para o diretor.");
  const atual = projetoDoCorpo(b, corpo.projeto);
  const fase: FaseDoDiretor = (FASES_DO_DIRETOR as readonly string[]).indexOf(String(corpo.fase)) >= 0 ? (corpo.fase as FaseDoDiretor) : atual.fase;
  const kit = kitPorId(atual.kit_id);
  const itens = planosReferiveis(atual);
  const selecionados = (Array.isArray(corpo.selecionados) ? (corpo.selecionados as unknown[]) : []).map((x) => String(x).toLowerCase()).filter((x) => itens.some((i) => i.ref === x));
  // Tudo o que é lido corre junto (contexto, regras ensinadas, catálogo, conversa + referência, andamento).
  const [contexto, regras, cat, conversa, andamento] = await Promise.all([
    contextoDoCliente(b, clientId),
    regrasDaMesa(b.servico(), { clientId, mesa: "video" }),
    catalogo(b),
    (async () => {
      const conversaId = atual.id ? await conversaDoProjeto(b, clientId, atual.id, false) : null;
      const historico = conversaId ? await historicoDaConversa(b, conversaId) : [];
      const usado = historico.length ? historico : historicoDoCorpo(corpo.conversa);
      const ultima = usado.slice().reverse().find((m) => m.papel === "agente");
      const referencia = await referenciaDoPedido(texto, itens, { agente: "diretor de vídeo", ultimaResposta: ultima ? ultima.conteudo : null, selecionados });
      return { conversaId, historico: usado, ultimaResposta: ultima ? ultima.conteudo : null, referencia };
    })(),
    atual.id ? andamentoDosPlanos(b, clientId, atual.id) : Promise.resolve({} as Record<string, AndamentoDoPlano>),
  ]);
  const sistema = [
    sistemaDoDiretor({ fase, kit, contexto, motores: cat.motores }),
    blocoDoEstadoReal(atual, andamento, cat.motores),
    blocoDaReferencia(conversa.referencia, itens),
    regras.bloco ? `\n${regras.bloco}` : "",
  ].filter(Boolean).join("\n");
  let saida;
  try {
    saida = await chamarTexto({
      clientId,
      tarefa: "conversa",
      agente: "diretor_arte",
      modeloId: MODELO_DO_DIRETOR,
      raciocinio: RACIOCINIO_DO_DIRETOR,
      pesquisaWeb: fase === "pesquisa" || /pesquis|regi[aã]o|local|lugar|cidade|[ée]poca/i.test(texto),
      sistema,
      mensagens: conversa.historico.concat([{ papel: "usuario", conteudo: `PROJETO ATUAL (JSON):\n${projetoParaOModelo(atual)}\n\nPEDIDO DA EQUIPE:\n${texto}` }]),
      esquemaJson: esquemaComAprendizado(),
      maxTokensSaida: 16000,
      timeoutMs: 300_000,
      criadoPor: b.userId,
    });
  } catch (e) {
    if (e instanceof IaMotorErro) throw b.erro(e.status, e.codigo, e.message, e.detalhes);
    throw e;
  }
  const bruto = (saida.json && typeof saida.json === "object" ? saida.json : {}) as Record<string, unknown>;
  const r = aplicarRespostaDoDiretor(bruto, { ...atual, fase }, cat.motores);
  r.projeto.fase = fase;
  const avisos = r.avisos.slice();
  // O projeto e o aprendizado correm juntos (o aprendizado nunca bloqueia a resposta).
  const [gravacao, aprendido] = await Promise.all([
    gravarProjeto(b, clientId, r.projeto).then(
      (g) => ({ ...g, conflito: false }),
      (e) => {
        // Outra tela mudou o projeto: a resposta fica na conversa, sem aplicar as mudanças.
        if ((e as { status?: number }).status === 409) return { projeto: atual, gravado: false, conflito: true };
        throw e;
      },
    ),
    aprenderDoPedido(b.servico(), { clientId, mesa: "video", pedido: texto, regraSugerida: bruto.regra_aprendida, userId: b.userId, ultimaResposta: conversa.ultimaResposta }),
  ]);
  const g = gravacao;
  if (g.conflito) avisos.unshift("O projeto foi mudado em outra tela: as mudanças desta resposta não entraram. Abra de novo e peça outra vez.");
  let resposta = r.resposta;
  let acao: AcaoDoAgente | null = null;
  let direto: { levar: boolean } | null = null;
  if (r.acao && !g.conflito) {
    const id = `diretor-${Date.now().toString(36)}`;
    if (r.acao.tipo === "mandar_ao_editor") acao = acaoDeMandarAoEditor(g.projeto, { id });
    else acao = acaoDeGerarPlanos(g.projeto, r.acao.planos, { id, variacoes: r.acao.variacoes || 1, motores: cat.motores, refazer: r.acao.tipo === "refazer" });
    // Mandar ao editor não custa e tem Desfazer: ordem clara vai na hora (depois de a proposta ficar guardada).
    if (acao && acao.itens.length && podeExecutarDireto(acao, REGRAS_DIRETAS_DO_DIRETOR, { pedidoClaro: true }).direto) {
      const ordem = await ehOrdemClara(texto, { agente: "diretor de vídeo", resumo: acao.resumo });
      if (ordem.clara) direto = { levar: ordem.levar };
    }
    if (acao && !acao.itens.length && acao.recusados.length) resposta = `${resposta}\n\nNão deu para preparar: ${acao.recusados.slice(0, 3).map((x) => `${x.ref} ${x.motivo}`).join(" ")}`;
  }
  // Nada de promessa sem cartão: a resposta diz com clareza que nada foi preparado.
  if (!acao && prometeSemAcao(resposta)) resposta = `${resposta}\n\nNenhum cartão foi preparado nesta resposta. Peça de novo dizendo os planos (ex.: "gera p1 e p2").`;
  const seguidas = anexoDasRegrasSeguidas(bruto.regras_seguidas, regras.regras);
  const anexosDa = (a: AcaoDoAgente | null): unknown[] => [a, aprendido, seguidas].filter(Boolean);
  // A conversa mora no projeto gravado (o id nasce no primeiro pedido).
  const conversaId = conversa.conversaId || (g.projeto.id ? await conversaDoProjeto(b, clientId, g.projeto.id, true) : null);
  const troca = conversaId
    ? await gravarTroca(b.servico(), { conversaId, clientId, usuario: { conteudo: texto, anexos: [] }, agente: { conteudo: resposta, anexos: anexosDa(acao), uso_id: saida.usoId || null }, onde: "mesa-videos diretor" })
    : { usuarioId: null, agenteId: null, erro: registrarFalha("mesa-videos: diretor sem conversa para gravar", "projeto sem id ou conversa não criada", { client_id: clientId }) };
  let avisoRegistro: string | null = troca.erro ? AVISO_SEM_REGISTRO : null;
  // Feito na hora só com a proposta já guardada (o Desfazer precisa da mensagem).
  if (direto && acao && troca.agenteId) {
    const feita = await executarDireto(acao, (item, a) => executarItemDoDiretor(b, clientId, item, a, troca.agenteId as string), { userId: b.userId });
    acao = comCaminho(feita, caminhoDaMesaDeVideo(clientId, feita, { abrirSozinho: direto.levar }), { abrirSozinho: direto.levar });
    const ok = (feita.resultados || []).filter((x) => x.ok);
    const falha = (feita.resultados || []).find((x) => !x.ok);
    resposta = `${resposta}\n\n${ok.length ? `Feito: mandei ao editor (${ok[0].motivo || "versão rascunho criada"}).` : `Não consegui mandar ao editor: ${falha ? falha.motivo : "motivo desconhecido"}.`}`;
    const { error: eFeita } = await b.servico().from("agente_mensagens").update({ conteudo: resposta, anexos: anexosDa(acao) }).eq("id", troca.agenteId).eq("client_id", clientId);
    if (eFeita) {
      registrarFalha("mesa-videos: ação do diretor feita, registro não gravado", eFeita, { mensagem_id: troca.agenteId });
      avisoRegistro = "A ação foi feita, mas o registro na conversa falhou: o Desfazer deste cartão pode não funcionar. Rejeite a versão na Mesa Edição se precisar.";
    }
  }
  const custo = custoDoRoteiro(g.projeto.roteiro, cat.motores);
  await b.auditar("video_diretor_conversar", { client_id: clientId, fase, projeto_id: g.projeto.id, mudou: r.mudou, acao: acao ? acao.itens.map((i) => i.operacao) : [] }, true, g.projeto.id || undefined);
  return b.json({
    projeto: g.projeto,
    gravado: g.gravado,
    resposta,
    perguntas: r.perguntas,
    avisos,
    continuidade: conferirContinuidade(g.projeto.biblia, g.projeto.roteiro, cat.motores),
    custo_roteiro: custo,
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    mensagem_id: troca.agenteId,
    usuario_mensagem_id: troca.usuarioId,
    conversa_id: conversaId,
    acao,
    anexos: [aprendido, seguidas].filter(Boolean),
    referencia: conversa.referencia ? { refs: conversa.referencia.refs, incerta: conversa.referencia.incerta } : null,
    ...(avisoRegistro ? { aviso_registro: avisoRegistro } : {}),
    // Compatível com a tela antiga: o editor agora vem como ação (cartão ou feito na hora).
    pedido_do_editor: null,
  });
}

export async function diretorSalvar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const p = projetoDoCorpo(b, corpo.projeto);
  const lida = Number(corpo.versao_lida);
  if (p.id && isFinite(lida)) p.versao = lida;
  const g = await gravarProjeto(b, clientId, p);
  if (!g.gravado) throw b.erro(503, "banco_sem_diretor", "O diretor ainda não foi ativado no banco. O projeto fica guardado neste navegador. Aplique o SQL V-01.");
  return b.json({ projeto: g.projeto, continuidade: conferirContinuidade(g.projeto.biblia, g.projeto.roteiro) });
}

/** Proposta para gerar (ou refazer) planos sem passar pelo modelo (botão "Gerar selecionados" do Roteiro). */
export async function diretorProporGerar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const p = projetoDoCorpo(b, corpo.projeto);
  const refs = (Array.isArray(corpo.planos) ? (corpo.planos as unknown[]) : []).map((x) => String(x).toLowerCase()).slice(0, 24);
  // O custo do cartão sai do mesmo catálogo que o executor usa (preço do banco quando há).
  const cat = await catalogo(b);
  const acao = acaoDeGerarPlanos(p, refs, { id: `diretor-${Date.now().toString(36)}`, variacoes: Math.max(1, Math.min(4, Math.round(Number(corpo.variacoes) || 1))), motores: cat.motores, refazer: corpo.refazer === true });
  if (!acao) return b.json({ mensagem_id: null, acao: null });
  const { data, error } = await b.servico().from("video_acoes").insert({ client_id: clientId, anexos: [acao], criado_por: b.userId }).select("id").single();
  if (error) {
    registrarFalha("mesa-videos: proposta do diretor não gravada", error, { client_id: clientId });
    throw b.erro(503, "banco_sem_mesa_videos", "A Mesa Vídeos ainda não foi ativada no banco. Aplique o SQL V2-01.");
  }
  return b.json({ mensagem_id: (data as { id: string }).id, acao });
}

/**
 * Executor de UM item confirmado:
 * - gerar_plano: gera com a entrada que foi mostrada na confirmação, pelo motor do
 *   catálogo em uso (motor desligado ou sem chave recusa o item) e com o custo DESTE
 *   plano mostrado no cartão como teto (preço que subiu depois recusa: "custo_mudou").
 * - mandar_ao_editor: cria a versão rascunho; o Desfazer a deixa rejeitada.
 */
export async function executarItemDoDiretor(b: BaseDaFuncao, clientId: string, item: ItemDaAcaoDoAgente, acao: AcaoDoAgente, mensagemId: string): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string }> {
  if (item.operacao === OPERACAO_DO_EDITOR) {
    const ctx = (acao.contexto || {}) as { editor?: { titulo?: string; formato?: string; notas?: string | null; planos?: PlanoParaOEditor[] } };
    if (!ctx.editor || !Array.isArray(ctx.editor.planos)) throw new Error("A proposta não trouxe os planos do roteiro.");
    const r = await criarVersaoDoEditor(b, clientId, { titulo: String(ctx.editor.titulo || "Vídeo"), formato: String(ctx.editor.formato || "9:16"), notas: ctx.editor.notas || null, planos: ctx.editor.planos });
    return { desfazer: { versao_id: r.versao.id }, aviso: r.faltando.length ? `versão rascunho criada; sem resultado: ${r.faltando.join(", ")}` : "versão rascunho criada com todos os planos" };
  }
  if (item.operacao !== "gerar_plano") throw new Error("Operação desconhecida.");
  const ctx = (acao.contexto || {}) as { entradas?: Record<string, EntradaDoPlano>; custos?: Record<string, number>; projeto_id?: string | null; variacoes?: number; titulo?: string };
  const e = ctx.entradas ? ctx.entradas[item.alvo_id] : null;
  if (!e) throw new Error("O plano não estava pronto quando a lista foi feita.");
  // Mesmo catálogo e mesmas travas do gerar_video (erro vira o motivo do item).
  const { motor } = await motorPronto(b, e.motor);
  // Teto: o custo deste plano mostrado no cartão (cartão antigo sem o valor por plano: o total mostrado).
  const custoDoItem = ctx.custos && typeof ctx.custos[item.alvo_id] === "number" ? ctx.custos[item.alvo_id] : typeof acao.custo_estimado_usd === "number" ? acao.custo_estimado_usd : null;
  if (custoDoItem === null) throw new Error("O cartão não mostrou o custo deste plano. Peça a lista de novo.");
  const assinar = async (c: string | null) => {
    if (!c) return null;
    if (c.indexOf(`${clientId}/`) !== 0) throw new Error("Quadro fora da pasta do cliente.");
    const { data } = await b.servico().storage.from(BUCKET).createSignedUrl(c, 3600);
    if (!data || !data.signedUrl) throw new Error("Quadro não encontrado no armazenamento.");
    return data.signedUrl;
  };
  const variacoes = Math.max(1, Math.min(4, Number(ctx.variacoes) || 1));
  const [ini, fim, ...refs] = await Promise.all([assinar(e.quadro_inicial_path), assinar(e.quadro_final_path), ...e.referencias_paths.map(assinar)]);
  const modo = e.modo === "imagem" ? "primeiro_quadro" : e.modo;
  const custo = await enviarGeracao(b, {
    clientId,
    tipo: "gerar_plano",
    motor,
    entrada: { modo, prompt: e.prompt, duracao_s: e.duracao_s, formato: e.formato, audio: e.audio, quadro_inicial_url: ini, quadro_final_url: fim, referencias_urls: refs.filter((x): x is string => !!x) },
    caminhos: { quadro_inicial: e.quadro_inicial_path, quadro_final: e.quadro_final_path, referencias: e.referencias_paths, video_arquivo_id: null },
    variacoes,
    uid: `${mensagemId}-${item.alvo_id}`,
    // O que a pessoa confirmou no cartão para ESTE plano (enviarGeracao recusa se o custo subiu).
    confirmado: custoDoItem,
    projetoId: ctx.projeto_id && UUID.test(ctx.projeto_id) ? ctx.projeto_id : null,
    planoRef: item.alvo_id,
    titulo: ctx.titulo ? `${ctx.titulo} ${item.alvo_id}` : item.titulo,
  });
  return { aviso: `pedido ${String(custo.pedido_id || "").slice(0, 8)} enviado` };
}

/** Reverso de um item do diretor (só o editor tem: a versão fica rejeitada). */
export async function desfazerItemDoDiretor(b: BaseDaFuncao, r: ResultadoDoItem): Promise<void> {
  const d = r.desfazer && typeof r.desfazer === "object" ? (r.desfazer as { versao_id?: unknown }) : {};
  if (!d.versao_id) throw new Error("Este item não tem desfazer.");
  await desfazerVersaoDoEditor(b, String(d.versao_id));
}

// ------------------------------------------------------------------ avaliar (visão + Jev)

export async function diretorAvaliar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const projeto = projetoDoCorpo(b, corpo.projeto);
  const plano = projeto.roteiro.planos.find((p) => p.ref === String(corpo.plano_ref || "").toLowerCase());
  if (!plano) throw b.erro(404, "plano_inexistente", "Plano não encontrado no roteiro.");
  const ids = (Array.isArray(corpo.arquivo_ids) ? (corpo.arquivo_ids as unknown[]) : []).map(String).filter((x) => UUID.test(x)).slice(0, 4);
  if (!ids.length) throw b.erro(400, "sem_arquivos", "Escolha as variações para avaliar.");
  const { data, error } = await b.servico().from("video_arquivos").select("id, client_id, tipo, storage_path").in("id", ids);
  if (error) throw b.erro(503, "banco_sem_mesa_videos", "Não foi possível ler os arquivos.");
  const arquivos = ((data || []) as { id: string; client_id: string; tipo: string; storage_path: string }[]).filter((a) => a.client_id === clientId);
  const imagens: { id: string; bytes: Uint8Array; mime: string }[] = [];
  const semImagem: string[] = [];
  for (const a of arquivos) {
    // Vídeo: a miniatura própria (primeiro quadro), nunca o vídeo baixado. Imagem: a cópia leve
    // (pedida à copias-leves quando falta), nunca o original grande aberto aqui.
    const l = leituraParaAVisao(a);
    const r = await reduzidaSemTransformacao(b.servico(), BUCKET, l.miniatura ? caminhoDaMiniatura(a.storage_path) : a.storage_path, l.caixa, l.caixa, l.opcoes).catch((e) => (registrarFalha("mesa-videos: miniatura para avaliar não lida", e, { arquivo_id: a.id }), null));
    if (r && r.cabe && /^image\//.test(r.mime)) imagens.push({ id: a.id, bytes: r.bytes, mime: r.mime });
    else semImagem.push(a.id);
  }
  if (!imagens.length) throw b.erro(409, "sem_quadro", "As variações ainda não têm miniatura. Abra os Resultados para gravar e tente de novo.");
  let descricao;
  try {
    descricao = await chamarTexto({
      clientId,
      tarefa: "verificacao",
      agente: "leitor",
      modeloId: MODELO_DO_DIRETOR,
      raciocinio: "low",
      sistema: "You describe video frames objectively for a continuity check. For each image, in English, describe: each person (apparent age, face shape, hair color and style, skin tone, outfit and colors), the place (architecture, objects, materials), time of day and light. No opinions, no guesses about identity. Return JSON.",
      mensagens: [{ papel: "usuario", conteudo: `Describe the ${imagens.length} images in order. ids: ${imagens.map((x) => x.id).join(", ")}`, imagens: imagens.map((x) => ({ bytes: x.bytes, mime: x.mime })) }],
      esquemaJson: { nome: "descricoes", schema: { type: "object", additionalProperties: false, required: ["descricoes"], properties: { descricoes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "texto"], properties: { id: { type: "string" }, texto: { type: "string" } } } } } } },
      maxTokensSaida: 3000,
      criadoPor: b.userId,
    });
  } catch (e) {
    if (e instanceof IaMotorErro) throw b.erro(e.status, e.codigo, e.message, e.detalhes);
    throw e;
  }
  const lidas = ((descricao.json as { descricoes?: { id: string; texto: string }[] }) || {}).descricoes || [];
  const descricoes = imagens.map((x, i) => ({ id: x.id, texto: String((lidas.find((d) => d.id === x.id) || lidas[i] || { texto: "" }).texto || "") })).filter((d) => d.texto);
  if (!descricoes.length) throw b.erro(502, "sem_descricao", "O modelo não descreveu os quadros. Nada foi julgado.");
  const q = perguntasDeContinuidade(projeto.biblia, plano, descricoes);
  if (!Object.keys(q.questions).length) return b.json({ variacoes: descricoes.map((d) => ({ id: d.id, personagens: {}, cenario: null, nota: null, ok: true })), melhor: descricoes[0].id, confianca: null, custo_usd: descricao.custoUsd, sem_miniatura: semImagem, aviso: "O plano não tem personagem nem cenário da bíblia para conferir." });
  try {
    // deno-lint-ignore no-explicit-any
    const r = await jevPerguntar(q as any);
    await cobrarJev(r, { clientId, tarefa: "verificacao", criadoPor: b.userId });
    // deno-lint-ignore no-explicit-any
    const av = lerAvaliacao(r.answers as any, descricoes);
    await b.auditar("video_diretor_avaliar", { client_id: clientId, plano: plano.ref, variacoes: descricoes.length }, true);
    return b.json({ ...av, custo_usd: descricao.custoUsd, sem_miniatura: semImagem, descricoes });
  } catch (e) {
    // Frente FS: o aviso já vai para a tela; o motivo agora também fica no log.
    console.error("mesa-videos: jev da continuidade falhou", { client_id: clientId, motivo: String((e as Error)?.message ?? e).slice(0, 300) });
    return b.json({ variacoes: [], melhor: null, confianca: null, custo_usd: descricao.custoUsd, sem_miniatura: semImagem, descricoes, aviso: "O Jev não respondeu agora. As descrições estão abaixo para conferir a olho." });
  }
}

// ------------------------------------------------------------------ mandar ao editor

/** Nota com que o diretor marca a versão que criou (o Desfazer só mexe nessas). */
const NOTA_DO_DIRETOR = "Montado pelo diretor";

/**
 * Cria a versão rascunho no editor com os resultados escolhidos, na ordem do
 * roteiro. Confere cada arquivo contra o banco e o cliente (id escolhido que não
 * existe ou é de outro cliente conta como "faltando").
 */
export async function criarVersaoDoEditor(b: BaseDaFuncao, clientId: string, e: { titulo: string; formato: string; notas: string | null; planos: PlanoParaOEditor[] }) {
  const ids = e.planos.map((p) => p.escolhido).filter((x): x is string => !!x && UUID.test(x));
  let linhas: unknown[] = [];
  if (ids.length) {
    const { data, error } = await b.servico().from("video_arquivos").select("*").in("id", ids);
    if (error) {
      registrarFalha("mesa-videos: resultados escolhidos não lidos", error, { client_id: clientId });
      throw b.erro(503, "banco_indisponivel", "Não foi possível ler os resultados escolhidos agora.");
    }
    linhas = data || [];
  }
  const arquivos = (linhas as { id: string; client_id: string; nome: string; tipo: string; estado?: string; storage_bucket: string; storage_path: string; duracao_s: number | null; largura: number | null; altura: number | null }[]).filter((a) => a.client_id === clientId && a.estado !== "arquivado");
  const r = projetoParaEditor({
    titulo: String(e.titulo || "Vídeo").slice(0, 120),
    formato: e.formato,
    direcao: e.notas || null,
    agora: new Date().toISOString(),
    escolhidos: e.planos.map((p) => {
      const a = arquivos.find((x) => x.id === p.escolhido);
      const plano = p as unknown as PlanoDoRoteiro;
      return { plano, arquivo: a ? { id: a.id, nome: a.nome, tipo: a.tipo, storage_bucket: a.storage_bucket, storage_path: a.storage_path, cena_ref: p.ref, melhor: true, duracao_s: a.duracao_s ?? p.duracao_s, largura: a.largura, altura: a.altura } : null };
    }),
  });
  if (!r.projeto.trilhas.some((t) => t.clipes.length)) throw b.erro(409, "nada_escolhido", "Escolha ao menos um resultado por plano antes de mandar ao editor.", { faltando: r.faltando });
  if (tamanhoDoProjeto(r.projeto) > MAX_BYTES_DO_PROJETO) throw b.erro(413, "projeto_grande", "O projeto passou do tamanho que o banco guarda.");
  const { data: versao, error } = await b.servico()
    .from("video_versoes")
    .insert({ client_id: clientId, video_id: crypto.randomUUID(), titulo: r.projeto.titulo, numero: 1, estado: "rascunho", projeto: r.projeto, nota: `${NOTA_DO_DIRETOR}${r.faltando.length ? `; faltando: ${r.faltando.join(", ")}` : ""}`.slice(0, 600), criado_por: b.userId })
    .select("*")
    .single();
  if (error) {
    registrarFalha("mesa-videos: versão do diretor não gravada", error, { client_id: clientId });
    throw b.erro(503, "banco_sem_mesa_edicao", "A versão não foi gravada. Aplique os SQL V2-01 e E2-01.");
  }
  await b.auditar("video_diretor_para_editor", { client_id: clientId, planos: e.planos.length, faltando: r.faltando.length }, true, (versao as { id: string }).id);
  return { versao: versao as { id: string } & Record<string, unknown>, faltando: r.faltando };
}

export async function diretorParaEditor(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const projeto = projetoDoCorpo(b, corpo.projeto);
  const r = await criarVersaoDoEditor(b, clientId, {
    titulo: String(corpo.titulo || projeto.titulo || "Vídeo"),
    formato: projeto.biblia.formato,
    notas: projeto.roteiro.notas || null,
    planos: projeto.roteiro.planos.map((p) => ({ ref: p.ref, ordem: p.ordem, titulo: p.titulo, texto_na_tela: p.texto_na_tela, duracao_s: p.duracao_s, escolhido: p.escolhido })),
  });
  return b.json({ versao: r.versao, faltando: r.faltando });
}

/**
 * Desfazer do "mandar ao editor": a versão que o diretor criou vira rejeitada
 * (nunca some). Só a versão em rascunho e só a que o diretor montou.
 */
export async function desfazerVersaoDoEditor(b: BaseDaFuncao, id: string) {
  if (!UUID.test(id)) throw b.erro(400, "versao_id_invalido", "versao_id precisa ser um UUID.");
  const { data, error: eLer } = await b.servico().from("video_versoes").select("id, client_id, estado, nota").eq("id", id).maybeSingle();
  if (eLer) {
    registrarFalha("mesa-videos: versão para desfazer não lida", eLer, { versao_id: id });
    throw b.erro(503, "banco_indisponivel", "Não foi possível ler a versão agora.");
  }
  const v = data as { id: string; client_id: string; estado: string; nota: string | null } | null;
  if (!v) throw b.erro(404, "versao_inexistente", "Versão não encontrada.");
  await b.garantirAcesso(v.client_id);
  if (v.estado === "rejeitada") return v;
  if (v.estado !== "rascunho") throw b.erro(409, "versao_travada", "Só a versão em rascunho volta atrás.");
  if (String(v.nota || "").indexOf(NOTA_DO_DIRETOR) !== 0) throw b.erro(409, "versao_de_outra_origem", "Esta versão não foi montada pelo diretor: o Desfazer daqui não mexe nela.");
  const { data: nova, error } = await b.servico().from("video_versoes").update({ estado: "rejeitada", motivo: "Desfeito na Mesa Vídeos (diretor)." }).eq("id", id).eq("estado", "rascunho").select("*").maybeSingle();
  if (error) {
    registrarFalha("mesa-videos: desfazer da versão falhou", error, { versao_id: id });
    throw b.erro(500, "banco_indisponivel", "Não foi possível desfazer agora.");
  }
  if (!nova) throw b.erro(409, "versao_travada", "A versão mudou de estado. Abra de novo.");
  return nova;
}

export async function diretorEditorDesfazer(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const versao = await desfazerVersaoDoEditor(b, String(corpo.versao_id || ""));
  return b.json({ versao });
}

// ------------------------------------------------------------------ templates

export async function templateSalvar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const projeto = projetoDoCorpo(b, corpo.projeto);
  const daAgencia = corpo.da_agencia === true;
  if (daAgencia && !b.admin) throw b.erro(403, "somente_admin", "Só o dono salva template da agência.");
  const nome = String(corpo.nome || projeto.titulo || "Template").replace(/\s+/g, " ").trim().slice(0, 120);
  const { data, error } = await b.servico()
    .from("video_templates")
    .insert({ client_id: daAgencia ? null : clientId, nome, kit_id: projeto.kit_id, estrutura: estruturaDoTemplate(projeto, daAgencia), criado_por: b.userId })
    .select("*")
    .single();
  if (error) throw b.erro(503, "banco_sem_diretor", "Templates ainda não foram ativados no banco. Aplique o SQL V-01.");
  await b.auditar("video_template_salvar", { client_id: clientId, da_agencia: daAgencia }, true, (data as { id: string }).id);
  return b.json({ template: data });
}

export async function templateArquivar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const id = String(corpo.template_id || "");
  if (!UUID.test(id)) throw b.erro(400, "template_id_invalido", "template_id precisa ser um UUID.");
  const { data, error: eLer } = await b.servico().from("video_templates").select("id, client_id").eq("id", id).maybeSingle();
  if (eLer) {
    registrarFalha("mesa-videos: template não lido", eLer, { template_id: id });
    throw b.erro(503, "banco_sem_diretor", "Não foi possível ler o template agora.");
  }
  const t = data as { id: string; client_id: string | null } | null;
  if (!t) throw b.erro(404, "template_inexistente", "Template não encontrado.");
  if (t.client_id) await b.garantirAcesso(t.client_id);
  else if (!b.admin) throw b.erro(403, "somente_admin", "Só o dono mexe em template da agência.");
  // Arquivar, nunca apagar (e o desfazer é arquivar: false).
  const { data: novo, error } = await b.servico().from("video_templates").update({ estado: corpo.arquivar === false ? "ativo" : "arquivado", atualizado_em: new Date().toISOString() }).eq("id", id).select("*").single();
  if (error) throw b.erro(500, "banco_indisponivel", "Não foi possível mudar agora.");
  return b.json({ template: novo });
}

// ------------------------------------------------------------------ antes e depois no editor

/**
 * Projeto de edição do par antes e depois (a V-B desenha o layout lado a
 * lado, cortina ou sequência a partir do `estilo` de cada clipe).
 */
export async function antesDepoisParaEditor(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const ids = [String(corpo.antes_arquivo_id || ""), String(corpo.depois_arquivo_id || "")];
  if (!ids.every((x) => UUID.test(x))) throw b.erro(400, "arquivos_invalidos", "Escolha o vídeo do antes e o do depois.");
  const { data, error: eLer } = await b.servico().from("video_arquivos").select("*").in("id", ids);
  if (eLer) {
    registrarFalha("mesa-videos: vídeos do antes e depois não lidos", eLer, { client_id: clientId });
    throw b.erro(503, "banco_indisponivel", "Não foi possível ler os vídeos agora.");
  }
  const lista =((data || []) as { id: string; client_id: string; nome: string; tipo: string; storage_bucket: string; storage_path: string; duracao_s: number | null; largura: number | null; altura: number | null }[]).filter((a) => a.client_id === clientId);
  const antes = lista.find((a) => a.id === ids[0]);
  const depois = lista.find((a) => a.id === ids[1]);
  if (!antes || !depois) throw b.erro(404, "arquivo_inexistente", "Vídeo do antes ou do depois não encontrado.");
  const take = (a: typeof antes) => ({ id: a.id, nome: a.nome, tipo: a.tipo, storage_bucket: a.storage_bucket, storage_path: a.storage_path, cena_ref: null, melhor: true, duracao_s: a.duracao_s || 5, largura: a.largura, altura: a.altura });
  const layout = corpo.layout === "cortina" ? "cortina" : corpo.layout === "sequencia" ? "sequencia" : "lado_a_lado";
  const projeto = projetoAntesDepois({ titulo: String(corpo.titulo || "Antes e depois").slice(0, 120), formato: String(corpo.formato || "9:16"), antes: take(antes), depois: take(depois), layout, agora: new Date().toISOString() });
  const { data: versao, error } = await b.servico()
    .from("video_versoes")
    .insert({ client_id: clientId, video_id: crypto.randomUUID(), titulo: projeto.titulo, numero: 1, estado: "rascunho", projeto, nota: `Antes e depois (${layout.replace("_", " ")}) montado na Mesa Vídeos`, criado_por: b.userId })
    .select("*")
    .single();
  if (error) throw b.erro(503, "banco_sem_mesa_edicao", "A versão não foi gravada. Aplique os SQL V2-01 e E2-01.");
  await b.auditar("video_antes_depois_para_editor", { client_id: clientId, layout }, true, (versao as { id: string }).id);
  return b.json({ versao, layout });
}
