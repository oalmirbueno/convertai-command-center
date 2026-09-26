/**
 * Agente DIRETOR de vídeo na função mesa-videos (frente V-A, 26/09/2026).
 * Regras e formatos: _shared/diretor-de-video.ts. Contrato: docs/video/CONTRATOS.md.
 *
 * - diretor_conversar { client_id, projeto, texto, fase } -> { projeto, resposta, perguntas, avisos, continuidade, custo_usd, mensagem_id?, acao? }
 *     GPT-6 Luna com raciocínio "max" pelo ia-motor (carteira do cliente),
 *     busca na web na fase de pesquisa. Resposta com fôlego (pode passar de 150 s).
 * - diretor_salvar { client_id, projeto, versao_lida } -> { projeto }
 * - diretor_avaliar { client_id, projeto, plano_ref, arquivo_ids } -> { variacoes, melhor, confianca, custo_usd }
 *     visão descreve cada quadro; o Jev julga (Noul: mesmo personagem? mesmo
 *     cenário? Choice: qual variação segue melhor a bíblia?). Nada é refeito sozinho.
 * - diretor_para_editor { client_id, projeto, titulo? } -> { versao, faltando } (versão rascunho com o projeto de edição)
 * - diretor_editor_desfazer { versao_id } -> { versao } (a versão vira rejeitada; nunca some)
 * - template_salvar { client_id, projeto, nome, da_agencia } -> { template }
 * - template_arquivar { template_id, arquivar } -> { template }
 * Execução da proposta "gerar_plano" (contrato comum): executarItemDoDiretor.
 */

import { chamarTexto, cobrarJev, IaMotorErro } from "../_shared/ia-motor.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { lerContextoConsolidado, lerDossie } from "../_shared/contexto-cliente.ts";
import { reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
import type { AcaoDoAgente, ItemDaAcaoDoAgente } from "../_shared/acoes-do-agente.ts";
import {
  acaoDeGerarPlanos,
  aplicarRespostaDoDiretor,
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
  perguntasDeContinuidade,
  projetoAntesDepois,
  projetoParaEditor,
  projetoParaOModelo,
  type ProjetoDoDiretor,
  RACIOCINIO_DO_DIRETOR,
  sistemaDoDiretor,
} from "../_shared/diretor-de-video.ts";
import { kitPorId } from "../_shared/video-kits.ts";
import { MOTORES_DE_VIDEO, motorPorId } from "../_shared/modelos-de-video.ts";
import { MAX_BYTES_DO_PROJETO, tamanhoDoProjeto } from "../_shared/projeto-de-edicao.ts";
import { type BaseDaFuncao, enviarGeracao } from "./geracao.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "mesa";
const TABELA = "video_diretor_projetos";
const MAX_CONVERSA = 30;

function projetoDoCorpo(b: BaseDaFuncao, v: unknown): ProjetoDoDiretor {
  const p = normalizarProjetoDoDiretor(v);
  if (!p) throw b.erro(400, "projeto_invalido", "O projeto do diretor veio vazio ou em formato desconhecido.");
  return p;
}

async function contextoDoCliente(b: BaseDaFuncao, clientId: string): Promise<string> {
  const db = b.servico();
  const [perfil, contexto, dossie] = await Promise.all([
    db.from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle().then((r) => r.data as { company_name?: string | null; full_name?: string | null } | null, () => null),
    lerContextoConsolidado(db, clientId).catch(() => ({})),
    lerDossie(db, clientId, 4000).catch(() => null),
  ]);
  const nome = perfil ? perfil.company_name || perfil.full_name || "" : "";
  return [nome ? `Cliente: ${nome}` : "", Object.keys(contexto || {}).length ? `Contexto consolidado: ${JSON.stringify(contexto).slice(0, 3000)}` : "", dossie ? `Dossiê:\n${dossie}` : ""].filter(Boolean).join("\n\n") || "sem contexto registrado";
}

/** Grava o projeto (trava otimista pela versão). Sem a tabela: devolve o projeto sem id e avisa. */
async function gravarProjeto(b: BaseDaFuncao, clientId: string, p: ProjetoDoDiretor, conversa?: unknown[]): Promise<{ projeto: ProjetoDoDiretor; gravado: boolean }> {
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
  if (conversa) linha.conversa = conversa.slice(-MAX_CONVERSA);
  if (p.id) {
    const { data, error } = await b.servico().from(TABELA).update({ ...linha, versao: p.versao + 1 }).eq("id", p.id).eq("client_id", clientId).eq("versao", p.versao).select("id, versao, atualizado_em").maybeSingle();
    if (error) return { projeto: p, gravado: false };
    if (!data) throw b.erro(409, "projeto_mudou", "O projeto foi mudado em outra tela. Abra de novo antes de salvar.");
    const d = data as { id: string; versao: number; atualizado_em: string };
    return { projeto: { ...p, versao: d.versao, atualizado_em: d.atualizado_em }, gravado: true };
  }
  const { data, error } = await b.servico().from(TABELA).insert({ ...linha, versao: 1, criado_por: b.userId }).select("id, versao, atualizado_em").single();
  if (error) return { projeto: p, gravado: false };
  const d = data as { id: string; versao: number; atualizado_em: string };
  return { projeto: { ...p, id: d.id, versao: d.versao, atualizado_em: d.atualizado_em }, gravado: true };
}

export async function diretorConversar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const texto = String(corpo.texto || "").trim().slice(0, 4000);
  if (!texto) throw b.erro(400, "texto_vazio", "Escreva o pedido para o diretor.");
  const atual = projetoDoCorpo(b, corpo.projeto);
  const fase: FaseDoDiretor = (FASES_DO_DIRETOR as readonly string[]).indexOf(String(corpo.fase)) >= 0 ? (corpo.fase as FaseDoDiretor) : atual.fase;
  const kit = kitPorId(atual.kit_id);
  const contexto = await contextoDoCliente(b, clientId);
  let saida;
  try {
    saida = await chamarTexto({
      clientId,
      tarefa: "conversa",
      agente: "diretor_arte",
      modeloId: MODELO_DO_DIRETOR,
      raciocinio: RACIOCINIO_DO_DIRETOR,
      pesquisaWeb: fase === "pesquisa" || /pesquis|regi[aã]o|local|lugar|cidade|[ée]poca/i.test(texto),
      sistema: sistemaDoDiretor({ fase, kit, contexto, motores: MOTORES_DE_VIDEO }),
      mensagens: [{ papel: "usuario", conteudo: `PROJETO ATUAL (JSON):\n${projetoParaOModelo(atual)}\n\nPEDIDO DA EQUIPE:\n${texto}` }],
      esquemaJson: esquemaDoDiretor(),
      maxTokensSaida: 16000,
      timeoutMs: 300_000,
      criadoPor: b.userId,
    });
  } catch (e) {
    if (e instanceof IaMotorErro) throw b.erro(e.status, e.codigo, e.message, e.detalhes);
    throw e;
  }
  const r = aplicarRespostaDoDiretor(saida.json, { ...atual, fase });
  r.projeto.fase = fase;
  const conversa = (Array.isArray(corpo.conversa) ? (corpo.conversa as unknown[]) : []).concat([{ papel: "usuario", texto }, { papel: "agente", texto: r.resposta }]);
  const g = await gravarProjeto(b, clientId, r.projeto, conversa);
  let mensagemId: string | null = null;
  let acao: AcaoDoAgente | null = null;
  if (r.acao && r.acao.tipo === "gerar") {
    acao = acaoDeGerarPlanos(g.projeto, r.acao.planos, { id: `diretor-${Date.now().toString(36)}`, variacoes: 1 });
    if (acao) {
      const { data, error } = await b.servico().from("video_acoes").insert({ client_id: clientId, anexos: [acao], criado_por: b.userId }).select("id").single();
      if (!error) mensagemId = (data as { id: string }).id;
      else acao = null;
    }
  }
  const custo = custoDoRoteiro(g.projeto.roteiro);
  await b.auditar("video_diretor_conversar", { client_id: clientId, fase, projeto_id: g.projeto.id, mudou: r.mudou }, true, g.projeto.id || undefined);
  return b.json({
    projeto: g.projeto,
    gravado: g.gravado,
    resposta: r.resposta,
    perguntas: r.perguntas,
    avisos: r.avisos,
    continuidade: conferirContinuidade(g.projeto.biblia, g.projeto.roteiro),
    custo_roteiro: custo,
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    mensagem_id: mensagemId,
    acao,
    pedido_do_editor: r.acao && r.acao.tipo === "mandar_ao_editor" ? r.acao.planos : null,
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

/** Proposta para gerar planos sem passar pelo modelo (botão "Gerar selecionados" do Roteiro). */
export async function diretorProporGerar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const p = projetoDoCorpo(b, corpo.projeto);
  const refs = (Array.isArray(corpo.planos) ? (corpo.planos as unknown[]) : []).map((x) => String(x).toLowerCase()).slice(0, 24);
  const acao = acaoDeGerarPlanos(p, refs, { id: `diretor-${Date.now().toString(36)}`, variacoes: Math.max(1, Math.min(4, Math.round(Number(corpo.variacoes) || 1))) });
  if (!acao) return b.json({ mensagem_id: null, acao: null });
  const { data, error } = await b.servico().from("video_acoes").insert({ client_id: clientId, anexos: [acao], criado_por: b.userId }).select("id").single();
  if (error) throw b.erro(503, "banco_sem_mesa_videos", "A Mesa Vídeos ainda não foi ativada no banco. Aplique o SQL V2-01.");
  return b.json({ mensagem_id: (data as { id: string }).id, acao });
}

/** Executor de UM item confirmado (gerar_plano): gera com a entrada que foi mostrada na confirmação. */
export async function executarItemDoDiretor(b: BaseDaFuncao, clientId: string, item: ItemDaAcaoDoAgente, acao: AcaoDoAgente, mensagemId: string) {
  if (item.operacao !== "gerar_plano") throw new Error("Operação desconhecida.");
  const ctx = (acao.contexto || {}) as { entradas?: Record<string, EntradaDoPlano>; projeto_id?: string | null; variacoes?: number; titulo?: string };
  const e = ctx.entradas ? ctx.entradas[item.alvo_id] : null;
  if (!e) throw new Error("O plano não estava pronto quando a lista foi feita.");
  const motor = motorPorId(e.motor);
  if (!motor) throw new Error("Motor desconhecido.");
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
    // A confirmação do cartão já mostrou o custo deste plano (acao.custo_estimado_usd somado).
    confirmado: Number.MAX_SAFE_INTEGER,
    projetoId: ctx.projeto_id && UUID.test(ctx.projeto_id) ? ctx.projeto_id : null,
    planoRef: item.alvo_id,
    titulo: ctx.titulo ? `${ctx.titulo} ${item.alvo_id}` : item.titulo,
  });
  return { aviso: `pedido ${String(custo.pedido_id || "").slice(0, 8)} enviado` };
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
    // Vídeo: a miniatura própria (primeiro quadro). Imagem: reduzida sem transformação.
    const r = await reduzidaSemTransformacao(b.servico(), BUCKET, a.storage_path, 1024, 1024, { folga: 1.1 });
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
  } catch {
    return b.json({ variacoes: [], melhor: null, confianca: null, custo_usd: descricao.custoUsd, sem_miniatura: semImagem, descricoes, aviso: "O Jev não respondeu agora. As descrições estão abaixo para conferir a olho." });
  }
}

// ------------------------------------------------------------------ mandar ao editor

export async function diretorParaEditor(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const projeto = projetoDoCorpo(b, corpo.projeto);
  const ids = projeto.roteiro.planos.map((p) => p.escolhido).filter((x): x is string => !!x && UUID.test(x));
  const { data } = ids.length ? await b.servico().from("video_arquivos").select("*").in("id", ids) : { data: [] };
  const arquivos = ((data || []) as { id: string; client_id: string; nome: string; tipo: string; storage_bucket: string; storage_path: string; duracao_s: number | null; largura: number | null; altura: number | null }[]).filter((a) => a.client_id === clientId);
  const r = projetoParaEditor({
    titulo: String(corpo.titulo || projeto.titulo || "Vídeo").slice(0, 120),
    formato: projeto.biblia.formato,
    direcao: projeto.roteiro.notas || null,
    agora: new Date().toISOString(),
    escolhidos: projeto.roteiro.planos.map((plano) => {
      const a = arquivos.find((x) => x.id === plano.escolhido);
      return { plano, arquivo: a ? { id: a.id, nome: a.nome, tipo: a.tipo, storage_bucket: a.storage_bucket, storage_path: a.storage_path, cena_ref: plano.ref, melhor: true, duracao_s: a.duracao_s ?? plano.duracao_s, largura: a.largura, altura: a.altura } : null };
    }),
  });
  if (!r.projeto.trilhas.some((t) => t.clipes.length)) throw b.erro(409, "nada_escolhido", "Escolha ao menos um resultado por plano antes de mandar ao editor.", { faltando: r.faltando });
  if (tamanhoDoProjeto(r.projeto) > MAX_BYTES_DO_PROJETO) throw b.erro(413, "projeto_grande", "O projeto passou do tamanho que o banco guarda.");
  const { data: versao, error } = await b.servico()
    .from("video_versoes")
    .insert({ client_id: clientId, video_id: crypto.randomUUID(), titulo: r.projeto.titulo, numero: 1, estado: "rascunho", projeto: r.projeto, nota: `Montado pelo diretor${r.faltando.length ? `; faltando: ${r.faltando.join(", ")}` : ""}`.slice(0, 600), criado_por: b.userId })
    .select("*")
    .single();
  if (error) throw b.erro(503, "banco_sem_mesa_edicao", "A versão não foi gravada. Aplique os SQL V2-01 e E2-01.");
  await b.auditar("video_diretor_para_editor", { client_id: clientId, planos: projeto.roteiro.planos.length, faltando: r.faltando.length }, true, (versao as { id: string }).id);
  return b.json({ versao, faltando: r.faltando });
}

export async function diretorEditorDesfazer(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const id = String(corpo.versao_id || "");
  if (!UUID.test(id)) throw b.erro(400, "versao_id_invalido", "versao_id precisa ser um UUID.");
  const { data } = await b.servico().from("video_versoes").select("id, client_id, estado").eq("id", id).maybeSingle();
  const v = data as { id: string; client_id: string; estado: string } | null;
  if (!v) throw b.erro(404, "versao_inexistente", "Versão não encontrada.");
  await b.garantirAcesso(v.client_id);
  if (v.estado !== "rascunho") throw b.erro(409, "versao_travada", "Só a versão em rascunho volta atrás.");
  const { data: nova, error } = await b.servico().from("video_versoes").update({ estado: "rejeitada", motivo: "Desfeito na Mesa Vídeos (diretor)." }).eq("id", id).select("*").single();
  if (error) throw b.erro(500, "banco_indisponivel", "Não foi possível desfazer agora.");
  return b.json({ versao: nova });
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
  const { data } = await b.servico().from("video_templates").select("id, client_id").eq("id", id).maybeSingle();
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
  const { data } = await b.servico().from("video_arquivos").select("*").in("id", ids);
  const lista = ((data || []) as { id: string; client_id: string; nome: string; tipo: string; storage_bucket: string; storage_path: string; duracao_s: number | null; largura: number | null; altura: number | null }[]).filter((a) => a.client_id === clientId);
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
