/**
 * Trocar o cenário com a pessoa fixa (frente TCN, rodada 3 parte 1, 01/10/2026).
 * Regras e preços: modulos/troca-de-cenario.ts. Tabela: video_cenarios (SQL 20260930327000).
 *
 * Ações (POST na mesa-videos, só equipe com acesso ao cliente):
 * - cenario_amostra { client_id, versao_id?, arquivo_id?, fonte_path, clipe_ref?, entrada_s, saida_s,
 *     cenario, galeria?, qualidade, layout, formato?, quadro_path, variacoes?, confirma_direito_de_imagem,
 *     uid, custo_confirmado_usd } -> { troca }
 *   Sem custo_confirmado_usd: 409 confirmar_custo com a estimativa (nada gasto).
 *   Gera na hora (com fôlego) 1 a 3 quadros com o cenário novo e a mesma pessoa.
 * - cenario_gerar { cenario_id, escolha, qualidade?, layout?, uid, custo_confirmado_usd } -> { troca }
 *   A final: Rápido gera o fundo limpo da amostra escolhida (na hora) e pede o
 *   preparo do trecho ao worker; Cinema e Aleph pedem o preparo. O resto anda
 *   sozinho (tela aberta ou cron de 1 min): provedor e composição no worker.
 * - cenario_status { client_id, versao_id? } -> { trocas, qualidades }  (anda as que estão em curso)
 * - cenario_inserido { cenario_id } -> { ok }  (a tela pôs o clipe no projeto; não põe de novo)
 * - cenario_descartar { cenario_id } -> { troca }  (some da lista; nada é apagado)
 * Cron: cenariosColetar junto da coleta dos pedidos de vídeo.
 *
 * SEM LAÇO: nenhuma chamada repete sozinha; erro do provedor ou do worker
 * encerra com o motivo e nada é refeito. Cada envio é cobrado UMA vez, quando
 * o provedor termina, antes de baixar (a cobrança fica gravada no passo).
 */

import type { BaseDaFuncao } from "./geracao.ts";
import { chaveCarregada } from "../_shared/chaves.ts";
import { carregarModelo, chamarImagem, estimarComModelo, garantirSaldo, IaMotorErro, modeloPadrao, type ModeloIa } from "../_shared/ia-motor.ts";
import { reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { desfechoDaConsulta, executorDoProvedor, passouDoPrazo, passouDoTeto, podeConsultar } from "./modulos/video-executor.ts";
import { fotoParaEditar, guardarDoProvedor, LEITURA_DA_FOTO_PARA_EDITAR } from "./modulos/video-armazenar.ts";
import type { Credenciais, RefDoEnvio } from "./modulos/video-provedor-comum.ts";
import {
  caminhoNaTroca,
  cenarioDaGaleria,
  corpoDoEnvio,
  custoDaAmostra,
  custoDaFinal,
  custoRegistrado,
  duracaoDoTrecho,
  ESTADOS_EM_ANDAMENTO,
  type EnvioDaTroca,
  type EstadoDaTroca,
  faltaNoTrecho,
  INFO_DAS_QUALIDADES,
  LAYOUTS_DA_TROCA,
  type LayoutDaTroca,
  limparCenario,
  MAX_AMOSTRAS,
  motorDaTroca,
  nomeDoResultado,
  passosDaFinal,
  type PassosDaTroca,
  promptDaAmostra,
  promptDaPlaca,
  proximoPasso,
  QUALIDADES_DA_TROCA,
  type QualidadeDaTroca,
  textoDoEstado,
} from "./modulos/troca-de-cenario.ts";

const BUCKET = "mesa";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O provedor baixa o trecho quando o pedido sai da fila (pode demorar): link de 6 h. */
const URL_PARA_O_PROVEDOR_S = 6 * 3600;
const URL_PARA_A_TELA_S = 3600;
/** A trava cobre a rodada inteira (consulta, cobrança e download em partes; a função tem 150 s). */
const TRAVA_MS = 180_000;
const INTERVALO_MS = 15_000;
const TENTATIVAS_DE_BAIXAR = 5;
const TAMANHO_DO_FORMATO: Record<string, string> = { "9:16": "1024x1536", "4:5": "1088x1360", "1:1": "1024x1024", "16:9": "1536x1024" };
const TOKENS_DA_IMAGEM_DE_ENTRADA = 1_600;

type Linha = {
  id: string;
  client_id: string;
  versao_id: string | null;
  arquivo_id: string | null;
  fonte_bucket: string;
  fonte_path: string;
  clipe_ref: string | null;
  entrada_s: number | string;
  saida_s: number | string;
  cenario: string;
  galeria: string | null;
  qualidade: QualidadeDaTroca;
  layout: LayoutDaTroca;
  formato: string | null;
  estado: EstadoDaTroca;
  quadro_path: string | null;
  amostras: { n: number; path: string; custo_usd: number; uso_id: string | null; modelo?: string | null }[];
  escolha: number | null;
  passos: PassosDaTroca & { chave_final?: string | null };
  custo_estimado: Record<string, unknown> | null;
  custo_usd: number | string;
  resultado_arquivo_id: string | null;
  erro: string | null;
  inserido_em: string | null;
  consultado_em: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

const linhaCurta = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const numero = (v: unknown, padrao: number) => (v !== null && v !== "" && v !== undefined && isFinite(Number(v)) ? Number(v) : padrao);
const quemCriou = (...ids: Array<string | null | undefined>): string | null => ids.find((x) => !!x && UUID.test(String(x))) || null;
const temChave = (nome: string) => !!chaveCarregada(nome);

function caminhoDoCliente(b: BaseDaFuncao, clientId: string, v: unknown, nome: string): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.indexOf(`${clientId}/`) !== 0 || s.indexOf("..") >= 0 || s.length > 500) throw b.erro(400, `${nome}_invalido`, "Arquivo fora da pasta do cliente.");
  return s;
}

function semTabela(b: BaseDaFuncao, error: { message?: string; code?: string } | null): Error {
  const m = String((error && error.message) || "");
  if (/video_cenarios|does not exist|schema cache|PGRST20|42P01|42703|cenario_id|tipo_check|alvo_check/i.test(m)) {
    return b.erro(503, "banco_sem_troca_de_cenario", "A troca de cenário ainda não foi ativada no banco. Aplique o SQL 20260930327000.");
  }
  return b.erro(500, "banco_indisponivel", "Não foi possível gravar agora. Tente de novo.");
}

function exigirConfirmacao(b: BaseDaFuncao, estimado: number, confirmado: unknown, detalhe: string, partes: unknown) {
  const c = Number(confirmado);
  if (confirmado === undefined || confirmado === null || confirmado === "" || !isFinite(c)) {
    throw b.erro(409, "confirmar_custo", "Confirme o custo antes de gerar.", { custo_estimado: { usd: estimado, detalhe, partes } });
  }
  if (estimado > c + 0.005) throw b.erro(409, "custo_mudou", "O custo mudou desde a confirmação. Confira de novo.", { custo_estimado: { usd: estimado, detalhe, partes } });
}

async function conferirSaldo(b: BaseDaFuncao, clientId: string, usd: number) {
  try {
    await garantirSaldo(clientId, usd);
  } catch (e) {
    if (e instanceof IaMotorErro) throw b.erro(e.status, e.codigo, e.message, e.detalhes);
    throw e;
  }
}

/** Valor de uma imagem editada no modelo de imagem padrão do painel (tabela do catálogo). */
function precoDaImagem(m: ModeloIa, prompt: string, qualidade: "media" | "alta", tamanho: string): number {
  return estimarComModelo(m, { imagens: 1, qualidade, tokensEntrada: Math.ceil(prompt.length / 3.5) + TOKENS_DA_IMAGEM_DE_ENTRADA, imagensEntrada: 1, tamanho });
}

async function modeloDeImagem(b: BaseDaFuncao): Promise<ModeloIa> {
  const m = await modeloPadrao("imagem");
  if (!m) throw b.erro(409, "sem_modelo_de_imagem", "Nenhum modelo de imagem padrão ativo no painel (Configurações › Modelos).");
  return await carregarModelo(m.id, "imagem");
}

/** Lê a imagem pela cópia leve (até 2048 px), nunca o original inteiro sem teto. */
async function bytesDaImagem(b: BaseDaFuncao, caminho: string): Promise<Uint8Array> {
  const L = LEITURA_DA_FOTO_PARA_EDITAR;
  const leitura = await reduzidaSemTransformacao(b.servico(), BUCKET, caminho, L.caixa, L.caixa, L.opcoes).catch(() => null);
  const foto = fotoParaEditar(leitura);
  if (foto.erro === "foto_ilegivel") throw b.erro(404, "arquivo_indisponivel", "Não deu para ler o quadro do vídeo. Tente de novo.");
  if (foto.erro === "foto_grande_demais") throw b.erro(413, "foto_grande_demais", "O quadro ficou grande demais para editar aqui.");
  return foto.bytes as Uint8Array;
}

const extensaoDoMime = (mime: string) => (mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png");

async function editarImagem(b: BaseDaFuncao, clientId: string, id: string, modelo: ModeloIa, prompt: string, bytes: Uint8Array, qualidade: "media" | "alta", tamanho: string, destinoSemExtensao: string, seed: number | null) {
  let saida;
  try {
    saida = await chamarImagem({
      clientId,
      modeloId: modelo.id,
      prompt,
      referencias: [],
      qualidade,
      tamanho,
      editar: { bytes },
      seed,
      tarefa: "estudio",
      agente: "gerador_imagem",
      referencia: { tipo: "video_cenario", id },
      criadoPor: quemCriou(b.userId),
    });
  } catch (e) {
    if (e instanceof IaMotorErro) throw b.erro(e.status, e.codigo, e.message, e.detalhes);
    throw e;
  }
  const caminho = `${destinoSemExtensao}.${extensaoDoMime(saida.mime)}`;
  const up = await b.servico().storage.from(BUCKET).upload(caminho, saida.png, { contentType: saida.mime, upsert: true });
  if (up.error) throw b.erro(500, "armazenamento_falhou", "A imagem foi gerada, mas não foi gravada. O custo já foi registrado.");
  return { path: caminho, custo_usd: saida.custoUsd, uso_id: saida.usoId, modelo: saida.modeloId };
}

// ------------------------------------------------------------------ tela

async function assinar(b: BaseDaFuncao, caminhos: string[], ttl: number): Promise<Record<string, string>> {
  const unicos = Array.from(new Set(caminhos.filter(Boolean)));
  if (!unicos.length) return {};
  const { data } = await b.servico().storage.from(BUCKET).createSignedUrls(unicos, ttl);
  const saida: Record<string, string> = {};
  ((data || []) as { path: string | null; signedUrl: string | null }[]).forEach((x) => {
    if (x.path && x.signedUrl) saida[x.path] = x.signedUrl;
  });
  return saida;
}

/** O que a tela recebe: sem caminhos de provedor, sem chaves; amostras com link assinado. */
async function paraTela(b: BaseDaFuncao, linhas: Linha[]) {
  const urls = await assinar(b, linhas.reduce((l, x) => l.concat((x.amostras || []).map((a) => a.path)), [] as string[]), URL_PARA_A_TELA_S);
  const ids = linhas.map((x) => x.resultado_arquivo_id).filter((x): x is string => !!x);
  let arquivos: Record<string, unknown>[] = [];
  if (ids.length) {
    const { data } = await b.servico().from("video_arquivos").select("id, client_id, nome, tipo, storage_bucket, storage_path, duracao_s, largura, altura").in("id", ids);
    arquivos = (data || []) as Record<string, unknown>[];
  }
  return linhas.map((x) => {
    const passos = x.passos || {};
    const arquivo = x.resultado_arquivo_id ? arquivos.find((a) => a.id === x.resultado_arquivo_id && a.client_id === x.client_id) || null : null;
    return {
      id: x.id,
      versao_id: x.versao_id,
      clipe_ref: x.clipe_ref,
      arquivo_id: x.arquivo_id,
      fonte_path: x.fonte_path,
      entrada_s: Number(x.entrada_s),
      saida_s: Number(x.saida_s),
      cenario: x.cenario,
      galeria: x.galeria,
      qualidade: x.qualidade,
      layout: x.layout,
      formato: x.formato,
      estado: x.estado,
      estado_texto: textoDoEstado(x.estado, passos),
      amostras: (x.amostras || []).map((a) => ({ n: a.n, url: urls[a.path] || null, custo_usd: a.custo_usd })),
      escolha: x.escolha,
      envios: (passos.envios || []).map((e) => ({ papel: e.papel, motor: e.motor, estado: e.estado, posicao: e.posicao, erro: e.erro })),
      custo_estimado: x.custo_estimado,
      custo_usd: Number(x.custo_usd) || 0,
      resultado: arquivo,
      erro: x.erro,
      inserido_em: x.inserido_em,
      criado_em: x.criado_em,
      atualizado_em: x.atualizado_em,
    };
  });
}

function estadoDasQualidades() {
  const r: Record<string, { pronto: boolean; motivo: string | null }> = {};
  QUALIDADES_DA_TROCA.forEach((q) => {
    const i = INFO_DAS_QUALIDADES[q];
    const ok = temChave(i.chave);
    r[q] = { pronto: ok, motivo: ok ? null : q === "aleph" ? "Falta a chave da Runway em Configurações › Chaves e custos." : "Falta a chave do fal (FAL_KEY) em Configurações › Chaves e custos." };
  });
  return r;
}

async function lerTroca(b: BaseDaFuncao, id: string): Promise<Linha> {
  if (!UUID.test(id)) throw b.erro(400, "cenario_id_invalido", "cenario_id precisa ser um UUID.");
  const { data, error } = await b.servico().from("video_cenarios").select("*").eq("id", id).maybeSingle();
  if (error) throw semTabela(b, error);
  if (!data) throw b.erro(404, "troca_inexistente", "Troca de cenário não encontrada.");
  const l = data as Linha;
  await b.garantirAcesso(l.client_id);
  return l;
}

// ------------------------------------------------------------------ amostra

export async function cenarioAmostra(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  const qualidade = (QUALIDADES_DA_TROCA as string[]).indexOf(String(corpo.qualidade)) >= 0 ? (corpo.qualidade as QualidadeDaTroca) : "rapido";
  const layout = (LAYOUTS_DA_TROCA as string[]).indexOf(String(corpo.layout)) >= 0 ? (corpo.layout as LayoutDaTroca) : "cheio";
  const formato = ["9:16", "4:5", "1:1", "16:9"].indexOf(String(corpo.formato)) >= 0 ? String(corpo.formato) : "9:16";
  const galeria = cenarioDaGaleria(linhaCurta(corpo.galeria, 40));
  const cenario = limparCenario(corpo.cenario) || (galeria ? galeria.texto : "");
  if (cenario.length < 3) throw b.erro(400, "cenario_vazio", "Descreva o cenário (ou toque num da galeria).");
  if (corpo.confirma_direito_de_imagem !== true) throw b.erro(422, "confirmar_direito_de_imagem", "Confirme que a pessoa do vídeo autorizou o uso da imagem (termo de imagem).");
  const entrada = Math.max(0, numero(corpo.entrada_s, 0));
  const saida = numero(corpo.saida_s, 0);
  const falta = faltaNoTrecho(qualidade, entrada, saida);
  if (falta) throw b.erro(400, "trecho_invalido", falta);
  const quadro = caminhoDoCliente(b, clientId, corpo.quadro_path, "quadro_path");
  if (!quadro || quadro.indexOf(`${clientId}/video/editor/quadros/`) !== 0) throw b.erro(400, "quadro_invalido", "Falta o quadro do vídeo (a tela sobe antes de preparar).");
  // Origem: o arquivo do acervo (conferido contra o banco e o cliente) ou o caminho da fonte da edição.
  let fonte = caminhoDoCliente(b, clientId, corpo.fonte_path, "fonte_path");
  let arquivoId: string | null = null;
  if (UUID.test(String(corpo.arquivo_id || ""))) {
    const { data } = await b.servico().from("video_arquivos").select("id, client_id, storage_bucket, storage_path").eq("id", String(corpo.arquivo_id)).maybeSingle();
    const a = data as { id: string; client_id: string; storage_bucket: string; storage_path: string } | null;
    if (!a || a.client_id !== clientId) throw b.erro(404, "arquivo_inexistente", "Vídeo não encontrado no acervo deste cliente.");
    if ((a.storage_bucket || BUCKET) !== BUCKET) throw b.erro(400, "arquivo_fora_do_bucket", "Este vídeo não está no armazenamento da mesa.");
    arquivoId = a.id;
    fonte = a.storage_path;
  }
  if (!fonte) throw b.erro(400, "fonte_vazia", "Escolha o vídeo.");
  let versaoId: string | null = null;
  if (UUID.test(String(corpo.versao_id || ""))) {
    const { data } = await b.servico().from("video_versoes").select("id, client_id").eq("id", String(corpo.versao_id)).maybeSingle();
    const v = data as { id: string; client_id: string } | null;
    if (!v || v.client_id !== clientId) throw b.erro(404, "versao_inexistente", "Versão da edição não encontrada.");
    versaoId = v.id;
  }
  const variacoes = Math.max(1, Math.min(MAX_AMOSTRAS, Math.round(numero(corpo.variacoes, 2))));
  const modelo = await modeloDeImagem(b);
  const tamanho = TAMANHO_DO_FORMATO[formato] || "1024x1536";
  const prompt = promptDaAmostra(cenario);
  const custo = custoDaAmostra(variacoes, precoDaImagem(modelo, prompt, "media", tamanho));
  exigirConfirmacao(b, custo.usd, corpo.custo_confirmado_usd, custo.detalhe, custo.partes);
  const uid = linhaCurta(corpo.uid, 64).replace(/[^a-z0-9-]/gi, "");
  if (uid.length < 6) throw b.erro(400, "uid_invalido", "Falta o identificador do clique.");
  const chave = `amostra:${uid}`;
  const { data: ja, error: eJa } = await b.servico().from("video_cenarios").select("*").eq("client_id", clientId).eq("chave", chave).maybeSingle();
  if (eJa) throw semTabela(b, eJa);
  if (ja) return b.json({ troca: (await paraTela(b, [ja as Linha]))[0], ja_existia: true });
  await conferirSaldo(b, clientId, custo.usd);

  const { data: criada, error } = await b.servico()
    .from("video_cenarios")
    .insert({
      client_id: clientId,
      versao_id: versaoId,
      arquivo_id: arquivoId,
      fonte_bucket: BUCKET,
      fonte_path: fonte,
      clipe_ref: linhaCurta(corpo.clipe_ref, 80) || null,
      entrada_s: Math.round(entrada * 1000) / 1000,
      saida_s: Math.round(saida * 1000) / 1000,
      cenario,
      galeria: galeria ? galeria.id : null,
      qualidade,
      layout,
      formato,
      estado: "amostrando",
      quadro_path: quadro,
      custo_estimado: { amostra: { usd: custo.usd, detalhe: custo.detalhe, confirmado_usd: Number(corpo.custo_confirmado_usd) } },
      autorizacao: { confirmada: true, por: quemCriou(b.userId), em: new Date().toISOString(), como: "confirmação na Mesa Edição" },
      chave,
      criado_por: quemCriou(b.userId),
    })
    .select("*")
    .single();
  if (error || !criada) throw semTabela(b, error);
  const troca = criada as Linha;

  const bytes = await bytesDaImagem(b, quadro);
  const base = caminhoNaTroca(clientId, troca.id, "amostra");
  const feitas = await Promise.allSettled(Array.from({ length: variacoes }, (_, i) => editarImagem(b, clientId, troca.id, modelo, prompt, bytes, "media", tamanho, `${base}-${i + 1}`, 1000 + i)));
  const amostras = feitas.map((r, i) => (r.status === "fulfilled" ? { n: i + 1, ...r.value } : null)).filter((x): x is NonNullable<typeof x> => !!x);
  const falhas = feitas.filter((r) => r.status === "rejected").map((r) => ((r as PromiseRejectedResult).reason instanceof Error ? ((r as PromiseRejectedResult).reason as Error).message : "falhou"));
  if (falhas.length) registrarFalha("mesa-videos: amostra da troca de cenário não saiu", new Error(falhas.join(" | ")), { client_id: clientId, cenario_id: troca.id });
  const estado: EstadoDaTroca = amostras.length ? "amostra" : "erro";
  const erro = amostras.length ? (falhas.length ? `${falhas.length} amostra(s) não saíram: ${falhas[0]}`.slice(0, 600) : null) : `Nenhuma amostra saiu: ${falhas[0] || "o modelo de imagem não respondeu"}. O que não saiu não foi cobrado.`.slice(0, 600);
  const { data: salva, error: eSalvar } = await b.servico()
    .from("video_cenarios")
    .update({ estado, amostras, erro, custo_usd: custoRegistrado(amostras, {}), atualizado_em: new Date().toISOString() })
    .eq("id", troca.id)
    .select("*")
    .single();
  if (eSalvar || !salva) throw semTabela(b, eSalvar);
  await b.auditar("video_cenario_amostra", { client_id: clientId, qualidade, variacoes, prontas: amostras.length }, amostras.length > 0, troca.id);
  if (!amostras.length) throw b.erro(502, "amostra_nao_saiu", erro || "Nenhuma amostra saiu.", { cenario_id: troca.id });
  return b.json({ troca: (await paraTela(b, [salva as Linha]))[0] });
}

// ------------------------------------------------------------------ final

export async function cenarioGerar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const troca = await lerTroca(b, String(corpo.cenario_id || ""));
  const clientId = troca.client_id;
  const uid = linhaCurta(corpo.uid, 64).replace(/[^a-z0-9-]/gi, "");
  const chaveFinal = uid ? `final:${uid}` : "";
  // O mesmo clique de novo: devolve o que já está andando.
  if (chaveFinal && troca.passos && troca.passos.chave_final === chaveFinal) return b.json({ troca: (await paraTela(b, [troca]))[0], ja_existia: true });
  if (troca.estado !== "amostra" && troca.estado !== "erro") throw b.erro(409, "troca_em_curso", troca.estado === "pronto" ? "Esta troca já está pronta. Faça outra amostra para outra versão." : "Esta troca já está gerando.");
  if (!(troca.amostras || []).length) throw b.erro(409, "sem_amostra", "Gere a amostra antes da final.");
  const qualidade = (QUALIDADES_DA_TROCA as string[]).indexOf(String(corpo.qualidade)) >= 0 ? (corpo.qualidade as QualidadeDaTroca) : troca.qualidade;
  const layout = (LAYOUTS_DA_TROCA as string[]).indexOf(String(corpo.layout)) >= 0 ? (corpo.layout as LayoutDaTroca) : troca.layout;
  const entrada = Number(troca.entrada_s);
  const saida = Number(troca.saida_s);
  const falta = faltaNoTrecho(qualidade, entrada, saida);
  if (falta) throw b.erro(400, "trecho_invalido", falta);
  const escolha = Math.round(numero(corpo.escolha, troca.escolha || 1));
  const amostra = (troca.amostras || []).find((a) => a.n === escolha);
  if (!amostra) throw b.erro(400, "escolha_invalida", "Escolha uma das amostras.");
  const passos = passosDaFinal(qualidade, layout);
  const faltam = passos.envios.map((p) => motorDaTroca(p).chave_env).filter((n, i, l) => l.indexOf(n) === i && !temChave(n));
  if (faltam.length) throw b.erro(409, "motor_precisa_chave", `${INFO_DAS_QUALIDADES[qualidade].rotulo}: falta a chave ${faltam.join(" e ")} em Configurações › Chaves e custos.`, { chave: faltam.join(", ") });
  const formato = troca.formato || "9:16";
  const tamanho = TAMANHO_DO_FORMATO[formato] || "1024x1536";
  const modelo = passos.placa ? await modeloDeImagem(b) : null;
  const porImagem = modelo ? precoDaImagem(modelo, promptDaPlaca(), "alta", tamanho) : 0;
  const duracao = duracaoDoTrecho(entrada, saida);
  const custo = custoDaFinal(qualidade, layout, duracao, porImagem);
  exigirConfirmacao(b, custo.usd, corpo.custo_confirmado_usd, custo.detalhe, custo.partes);
  if (!chaveFinal) throw b.erro(400, "uid_invalido", "Falta o identificador do clique.");
  await conferirSaldo(b, clientId, custo.usd);

  // Trava o pedido da final (outra aba com o mesmo clique não passa daqui).
  const agoraIso = new Date().toISOString();
  const novosPassos: PassosDaTroca & { chave_final: string } = { chave_final: chaveFinal, envios: [], preparo: null, composicao: null, placa: null, resumo: null };
  const { data: travada, error: eTrava } = await b.servico()
    .from("video_cenarios")
    .update({ estado: "preparando", qualidade, layout, escolha, passos: novosPassos, erro: null, consultado_em: new Date(Date.now() + TRAVA_MS).toISOString(), atualizado_em: agoraIso, custo_estimado: { ...(troca.custo_estimado || {}), final: { usd: custo.usd, detalhe: custo.detalhe, partes: custo.partes, confirmado_usd: Number(corpo.custo_confirmado_usd) } } })
    .eq("id", troca.id)
    .in("estado", ["amostra", "erro"])
    .select("*")
    .maybeSingle();
  if (eTrava) throw semTabela(b, eTrava);
  if (!travada) throw b.erro(409, "troca_em_curso", "Esta troca mudou agora há pouco. Abra de novo.");

  const voltarAoErro = async (mensagem: string) => {
    await b.servico().from("video_cenarios").update({ estado: "erro", erro: mensagem.slice(0, 600), passos: novosPassos, consultado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq("id", troca.id);
  };
  try {
    // Rápido: o fundo limpo sai da amostra escolhida (a pessoa original entra por cima no worker).
    if (passos.placa && modelo) {
      const bytes = await bytesDaImagem(b, amostra.path);
      novosPassos.placa = await editarImagem(b, clientId, troca.id, modelo, promptDaPlaca(), bytes, "alta", tamanho, caminhoNaTroca(clientId, troca.id, "placa"), null);
    }
    const { data: render, error: eRender } = await b.servico()
      .from("render_pedidos")
      .insert({
        client_id: clientId,
        tipo: "cenario",
        cenario_id: troca.id,
        uid: `cenario-${troca.id.slice(0, 8)}-preparar-${crypto.randomUUID().slice(0, 8)}`,
        entrada: { fase: "preparar", fonte_bucket: BUCKET, fonte_path: troca.fonte_path, inicio_s: entrada, fim_s: saida, perfil: qualidade === "aleph" ? "aleph" : "padrao", destino: caminhoNaTroca(clientId, troca.id, "trecho.mp4") },
        criado_por: quemCriou(b.userId),
      })
      .select("id")
      .single();
    if (eRender || !render) throw semTabela(b, eRender);
    novosPassos.preparo = { render_id: (render as { id: string }).id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Não foi possível começar a final.";
    await voltarAoErro(msg);
    throw e;
  }
  const { data: salva, error: eSalvar } = await b.servico()
    .from("video_cenarios")
    .update({ passos: novosPassos, custo_usd: custoRegistrado(troca.amostras || [], novosPassos), consultado_em: null, atualizado_em: new Date().toISOString() })
    .eq("id", troca.id)
    .select("*")
    .single();
  if (eSalvar || !salva) throw semTabela(b, eSalvar);
  await b.auditar("video_cenario_gerar", { client_id: clientId, qualidade, layout, duracao_s: duracao, custo_usd: custo.usd }, true, troca.id);
  return b.json({ troca: (await paraTela(b, [salva as Linha]))[0] });
}

// ------------------------------------------------------------------ andar (tela e cron)

async function cobrar(b: BaseDaFuncao, t: Linha, e: EnvioDaTroca): Promise<string | null> {
  const { data, error } = await b.servico().rpc("ia_registrar_uso", {
    _client_id: t.client_id,
    _tarefa: "estudio",
    _agente: "gerador_imagem",
    _modelo_id: `video:${e.motor}`,
    _provedor: e.provedor,
    _tokens_entrada: 0,
    _tokens_saida: 0,
    _tokens_cache: 0,
    _imagens: 0,
    _qualidade: null,
    _custo_usd: Math.round(e.custo_previsto_usd * 10000) / 10000,
    _custo_fonte: "tabela",
    _referencia_tipo: "video_cenario",
    _referencia_id: t.id,
    _criado_por: quemCriou(b.userId, t.criado_por),
    _chave_origem: "agencia",
    _chave_id: null,
  });
  if (error) {
    registrarFalha("mesa-videos: uso da troca de cenário não registrado", error, { cenario_id: t.id, papel: e.papel });
    return null;
  }
  const l = (Array.isArray(data) ? data[0] : data) as { uso_id?: string } | null;
  return l && l.uso_id ? String(l.uso_id) : null;
}

const credenciais = (provedor: string): Credenciais => ({ chave: chaveCarregada(provedor === "runway" ? "RUNWAYML_API_SECRET" : "FAL_KEY") });
const refDoEnvio = (e: EnvioDaTroca): RefDoEnvio => ({ request_id: e.request_id, status_url: e.status_url, response_url: e.response_url, endpoint: e.endpoint });

async function enviarTodos(b: BaseDaFuncao, t: Linha, passos: PassosDaTroca): Promise<EnvioDaTroca[]> {
  const trecho = passos.preparo && passos.preparo.trecho_path ? passos.preparo.trecho_path : null;
  if (!trecho || trecho.indexOf(`${t.client_id}/`) !== 0) throw new Error("O trecho preparado não está na pasta do cliente.");
  const amostra = (t.amostras || []).find((a) => a.n === t.escolha) || (t.amostras || [])[0] || null;
  const urls = await assinar(b, [trecho].concat(amostra ? [amostra.path] : []), URL_PARA_O_PROVEDOR_S);
  if (!urls[trecho]) throw new Error("O trecho preparado não foi encontrado no armazenamento.");
  const duracao = passos.preparo && passos.preparo.duracao_s ? Number(passos.preparo.duracao_s) : duracaoDoTrecho(Number(t.entrada_s), Number(t.saida_s));
  const lista: EnvioDaTroca[] = [];
  for (const papel of passosDaFinal(t.qualidade, t.layout).envios) {
    const { motor, corpo } = corpoDoEnvio(papel, { trecho_url: urls[trecho], amostra_url: amostra ? urls[amostra.path] || null : null, cenario: t.cenario, seed: null });
    const custo = Math.round(motor.por_segundo * Math.max(motor.minimo_s, Math.ceil(duracao - 1e-6)) * 10000) / 10000;
    const base: EnvioDaTroca = { papel, motor: motor.id, provedor: motor.provedor, endpoint: motor.endpoint, request_id: "", status_url: "", response_url: "", estado: "erro", enviado_em: new Date().toISOString(), consultado_em: new Date().toISOString(), posicao: null, erro: null, custo_previsto_usd: custo, custo_usd: null, uso_id: null, storage_path: null };
    const executor = executorDoProvedor(motor.provedor);
    try {
      if (!executor) throw new Error(`${motor.rotulo} ainda não gera por aqui.`);
      const r = await executor.enviar(motor.endpoint, corpo, credenciais(motor.provedor), { idempotencia: `${t.id}-${papel}` });
      // consultado_em = agora: a primeira consulta respeita o intervalo mínimo (o fal acabou de pôr na fila).
      lista.push({ ...base, ...r, estado: "enviado" });
    } catch (e) {
      // Sem nova tentativa: o motivo fica no passo e nada é cobrado.
      registrarFalha("mesa-videos: envio da troca de cenário falhou", e, { cenario_id: t.id, papel });
      lista.push({ ...base, erro: `${motor.rotulo} não aceitou o pedido: ${e instanceof Error ? e.message.slice(0, 300) : "falhou"}. Nada foi cobrado.` });
    }
  }
  return lista;
}

async function consultarEnvios(b: BaseDaFuncao, t: Linha, envios: EnvioDaTroca[], gravar: (e: EnvioDaTroca[]) => Promise<void>) {
  const agora = Date.now();
  for (const e of envios) {
    const motor = motorDaTroca(e.papel, e.motor);
    const executor = executorDoProvedor(e.provedor);
    if (!executor) {
      e.estado = "erro";
      e.erro = "Provedor sem executor.";
      continue;
    }
    if (podeConsultar(e, agora)) {
      let situacao = null;
      let falha: string | null = null;
      try {
        situacao = await executor.consultar(refDoEnvio(e), credenciais(e.provedor));
        e.posicao = situacao.posicao;
      } catch (err) {
        falha = err instanceof Error ? err.message : "Consulta falhou.";
        registrarFalha("mesa-videos: consulta da troca de cenário falhou", err, { cenario_id: t.id, papel: e.papel });
      }
      e.consultado_em = new Date().toISOString();
      const d = desfechoDaConsulta(situacao, passouDoPrazo(e, motor.prazo_min, agora), motor.prazo_min, falha, passouDoTeto(e, motor.prazo_min, agora), e.request_id);
      if (d.estado) e.estado = d.estado;
      e.erro = d.erro;
    }
    if (e.estado === "baixando") {
      if (!e.uso_id) {
        e.uso_id = await cobrar(b, t, e);
        e.custo_usd = e.custo_previsto_usd;
        if (e.uso_id) await gravar(envios);
      }
      try {
        const r = await executor.resultado(refDoEnvio(e), credenciais(e.provedor));
        const caminho = caminhoNaTroca(t.client_id, t.id, nomeDoResultado(e.papel));
        await guardarDoProvedor(r.urls[0], "video", { supabaseUrl: Deno.env.get("SUPABASE_URL") || "", chaveDeServico: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", bucket: BUCKET, caminho });
        e.storage_path = caminho;
        e.estado = "pronto";
        e.erro = null;
      } catch (err) {
        e.tentativas_de_baixar = (e.tentativas_de_baixar || 0) + 1;
        e.erro = err instanceof Error ? err.message : "Não baixou.";
        registrarFalha("mesa-videos: resultado da troca de cenário não foi guardado", err, { cenario_id: t.id, papel: e.papel, tentativa: e.tentativas_de_baixar });
        if (e.tentativas_de_baixar >= TENTATIVAS_DE_BAIXAR) {
          e.estado = "erro";
          e.erro = `O provedor terminou, mas o arquivo não foi guardado depois de ${TENTATIVAS_DE_BAIXAR} tentativas. O uso já foi registrado.`;
        }
      }
    }
  }
}

/** Medidas de saída do formato do projeto (para 2 e 3 faixas). */
const MEDIDAS: Record<string, [number, number]> = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080] };

async function pedirComposicao(b: BaseDaFuncao, t: Linha, passos: PassosDaTroca): Promise<string> {
  const envios = passos.envios || [];
  const caminhoDe = (papel: string) => {
    const e = envios.find((x) => x.papel === papel);
    return e && e.storage_path ? e.storage_path : null;
  };
  const [largura, altura] = MEDIDAS[t.formato || "9:16"] || MEDIDAS["9:16"];
  const { data, error } = await b.servico()
    .from("render_pedidos")
    .insert({
      client_id: t.client_id,
      tipo: "cenario",
      cenario_id: t.id,
      uid: `cenario-${t.id.slice(0, 8)}-compor-${crypto.randomUUID().slice(0, 8)}`,
      entrada: {
        fase: "compor",
        qualidade: t.qualidade,
        layout: t.layout,
        original: passos.preparo ? passos.preparo.trecho_path : null,
        ia: caminhoDe(t.qualidade === "rapido" ? "-" : t.qualidade),
        recorte: caminhoDe("recorte"),
        placa: passos.placa ? passos.placa.path : null,
        destino: caminhoNaTroca(t.client_id, t.id, `final-${Date.now().toString(36)}.mp4`),
        largura,
        altura,
        titulo: `Cenário: ${t.cenario}`.slice(0, 110),
      },
      criado_por: quemCriou(t.criado_por),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`O pedido de composição não foi gravado: ${error ? error.message : "sem id"}`);
  return (data as { id: string }).id;
}

/** Uma rodada de UMA troca em curso (tela ou cron), sob a trava de consultado_em. */
async function andar(b: BaseDaFuncao, lida: Linha): Promise<Linha> {
  if (ESTADOS_EM_ANDAMENTO.indexOf(lida.estado) < 0) return lida;
  const agora = Date.now();
  const { data: travada, error } = await b.servico()
    .from("video_cenarios")
    .update({ consultado_em: new Date(agora + TRAVA_MS).toISOString() })
    .eq("id", lida.id)
    .in("estado", ESTADOS_EM_ANDAMENTO)
    .or(`consultado_em.is.null,consultado_em.lt.${new Date(agora - INTERVALO_MS).toISOString()}`)
    .select("*")
    .maybeSingle();
  if (error) throw semTabela(b, error);
  if (!travada) return lida;
  const t = travada as Linha;
  const passos: PassosDaTroca & { chave_final?: string | null } = { ...(t.passos || {}) };
  let estado: EstadoDaTroca = t.estado;
  let erro: string | null = t.erro;
  let resultado: string | null = t.resultado_arquivo_id;
  const gravar = async (envios: EnvioDaTroca[]) => {
    const { error: e } = await b.servico().from("video_cenarios").update({ passos: { ...passos, envios } }).eq("id", t.id);
    if (e) registrarFalha("mesa-videos: cobrança da troca não gravada antes de baixar", e, { cenario_id: t.id });
  };
  try {
    const idDoRender = estado === "preparando" ? (passos.preparo && passos.preparo.render_id) : estado === "compondo" ? (passos.composicao && passos.composicao.render_id) : null;
    type PedidoDoRender = { estado: string; erro_mensagem: string | null; saida_path: string | null; arquivo_id: string | null; resultado: Record<string, unknown> | null };
    let render: PedidoDoRender | null = null;
    if (idDoRender) {
      const { data } = await b.servico().from("render_pedidos").select("estado, erro_mensagem, saida_path, arquivo_id, resultado").eq("id", idDoRender).maybeSingle();
      render = (data as PedidoDoRender | null) || null;
    }
    let d = proximoPasso(estado, passos, render ? { estado: render.estado, erro: render.erro_mensagem } : null);
    if (d.passo === "enviar" && estado === "preparando" && render) {
      const r = render.resultado || {};
      passos.preparo = { ...(passos.preparo as { render_id: string }), estado: "pronto", trecho_path: render.saida_path, duracao_s: Number(r.duracao_s) || null, largura: Number(r.largura) || null, altura: Number(r.altura) || null };
      passos.envios = await enviarTodos(b, t, passos);
      estado = "gerando";
      d = proximoPasso(estado, passos, null);
    }
    if (d.passo === "consultar") {
      await consultarEnvios(b, t, passos.envios || [], gravar);
      d = proximoPasso(estado, passos, null);
    }
    if (d.passo === "compor") {
      passos.composicao = { render_id: await pedirComposicao(b, t, passos) };
      estado = "compondo";
    } else if (d.passo === "nada" && estado === "compondo" && render && render.estado === "pronto") {
      resultado = render.arquivo_id;
      estado = resultado ? "pronto" : "erro";
      erro = resultado ? null : "A máquina terminou sem registrar o arquivo final.";
      const envios = passos.envios || [];
      passos.resumo = `Troca de cenário (${INFO_DAS_QUALIDADES[t.qualidade].rotulo}, ${t.layout.replace("_", " ")}) de ${duracaoDoTrecho(Number(t.entrada_s), Number(t.saida_s))} s: ${envios.map((e) => e.motor).join(" + ")}${passos.placa ? " + fundo limpo" : ""}, composta no worker com o áudio original.`;
    } else if (d.passo === "erro") {
      estado = "erro";
      erro = d.motivo.slice(0, 600);
    }
  } catch (e) {
    registrarFalha("mesa-videos: troca de cenário não andou", e, { cenario_id: t.id });
    erro = (e instanceof Error ? e.message : "Não andou.").slice(0, 600);
    if (estado === "gerando" && !(passos.envios || []).length) estado = "erro";
  }
  const fim = new Date().toISOString();
  const { data: salva, error: eSalvar } = await b.servico()
    .from("video_cenarios")
    .update({ estado, passos, erro, resultado_arquivo_id: resultado, custo_usd: custoRegistrado(t.amostras || [], passos), consultado_em: fim, atualizado_em: fim })
    .eq("id", t.id)
    .select("*")
    .single();
  if (eSalvar || !salva) throw semTabela(b, eSalvar);
  return salva as Linha;
}

export async function cenarioStatus(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  let q = b.servico().from("video_cenarios").select("*").eq("client_id", clientId).neq("estado", "descartado").order("criado_em", { ascending: false }).limit(12);
  if (UUID.test(String(corpo.versao_id || ""))) q = q.eq("versao_id", String(corpo.versao_id));
  const { data, error } = await q;
  if (error) throw semTabela(b, error);
  const linhas = (data || []) as Linha[];
  const saida: Linha[] = [];
  let andadas = 0;
  for (const l of linhas) {
    if (ESTADOS_EM_ANDAMENTO.indexOf(l.estado) >= 0 && andadas < 3) {
      andadas++;
      try {
        saida.push(await andar(b, l));
        continue;
      } catch (e) {
        registrarFalha("mesa-videos: status da troca de cenário", e, { cenario_id: l.id });
      }
    }
    saida.push(l);
  }
  return b.json({ trocas: await paraTela(b, saida), qualidades: estadoDasQualidades() });
}

export async function cenarioInserido(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const t = await lerTroca(b, String(corpo.cenario_id || ""));
  if (t.estado !== "pronto") throw b.erro(409, "troca_nao_pronta", "A troca ainda não está pronta.");
  if (!t.inserido_em) {
    const { error } = await b.servico().from("video_cenarios").update({ inserido_em: new Date().toISOString() }).eq("id", t.id).is("inserido_em", null);
    if (error) throw semTabela(b, error);
  }
  return b.json({ ok: true });
}

export async function cenarioDescartar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const t = await lerTroca(b, String(corpo.cenario_id || ""));
  if (ESTADOS_EM_ANDAMENTO.indexOf(t.estado) >= 0 || t.estado === "amostrando") throw b.erro(409, "troca_em_curso", "Espere terminar para tirar da lista.");
  // Apagar = arquivar: a linha e os arquivos ficam; só sai da lista.
  const { data, error } = await b.servico().from("video_cenarios").update({ estado: "descartado", atualizado_em: new Date().toISOString() }).eq("id", t.id).select("*").single();
  if (error || !data) throw semTabela(b, error);
  return b.json({ troca: (await paraTela(b, [data as Linha]))[0] });
}

/** Cron (junto da coleta dos pedidos): anda as trocas em curso de todos os clientes, as mais esquecidas primeiro. */
export async function cenariosColetar(b: BaseDaFuncao, tetoMs = 40_000): Promise<{ conferidas: number; prontas: number; erros: number }> {
  const inicio = Date.now();
  const { data, error } = await b.servico().from("video_cenarios").select("*").in("estado", ESTADOS_EM_ANDAMENTO).order("consultado_em", { ascending: true, nullsFirst: true }).limit(6);
  if (error) {
    // Sem o SQL da frente TCN: a coleta dos pedidos de vídeo segue normal.
    if (/video_cenarios|does not exist|schema cache|42P01/i.test(String(error.message || ""))) return { conferidas: 0, prontas: 0, erros: 0 };
    throw semTabela(b, error);
  }
  let conferidas = 0;
  let prontas = 0;
  let erros = 0;
  for (const l of (data || []) as Linha[]) {
    if (Date.now() - inicio > tetoMs) break;
    try {
      const r = await andar(b, l);
      conferidas++;
      if (r.estado === "pronto") prontas++;
      if (r.estado === "erro") erros++;
    } catch (e) {
      registrarFalha("mesa-videos: coleta de uma troca de cenário falhou", e, { cenario_id: l.id });
    }
  }
  return { conferidas, prontas, erros };
}
