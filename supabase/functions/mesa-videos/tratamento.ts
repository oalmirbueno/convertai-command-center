/**
 * Tratar vídeo na Mesa Edição (02/10/2026): tirar a legenda que já veio
 * gravada e melhorar a qualidade (pele de cera, rosto real sem mudar o rosto).
 * Regras, motores e preços: modulos/tratamento-de-video.ts. Tabela:
 * video_tratamentos (SQL 20261002160000).
 *
 * Ações (POST na mesa-videos, só equipe com acesso ao cliente):
 * - tratamento_amostra { client_id, arquivo_id, tipo: tirar_legenda|melhorar, motor?, regiao?, nivel?, inicio_s?, medidas?,
 *     uid, custo_confirmado_usd } -> { tratamento }
 *   Sem custo_confirmado_usd: 409 confirmar_custo com a estimativa (nada gasto).
 *   Alguns segundos do vídeo: preparar no worker -> provedor -> montar no worker.
 * - tratamento_final { tratamento_id, uid, custo_confirmado_usd } -> { tratamento }
 *   Só depois da amostra pronta. O vídeo inteiro, pelo mesmo caminho; sai um
 *   vídeo novo no acervo (pasta "Antes e depois"), o original fica intacto.
 * - tratamento_status { client_id, arquivo_id? } -> { tratamentos, motores }  (anda os que estão em curso)
 * - tratamento_descartar { tratamento_id } -> { tratamento }  (sai da lista; nada é apagado)
 * Cron: tratamentosColetar junto da coleta dos pedidos de vídeo.
 *
 * SEM LAÇO: nenhuma chamada repete sozinha. Cada envio é cobrado UMA vez,
 * quando o provedor termina, antes de baixar.
 */

import type { BaseDaFuncao } from "./geracao.ts";
import { chaveCarregada } from "../_shared/chaves.ts";
import { garantirSaldo, IaMotorErro } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { desfechoDaConsulta, executorDoProvedor, passouDoPrazo, passouDoTeto, podeConsultar } from "./modulos/video-executor.ts";
import { guardarDoProvedor } from "./modulos/video-armazenar.ts";
import type { Credenciais, RefDoEnvio } from "./modulos/video-provedor-comum.ts";
import {
  ACOES_DO_TRATAMENTO,
  type AcaoDoTratamento,
  caminhoNoTratamento,
  corpoDoTratamento,
  custoCobrado,
  custoDoTratamento,
  type EnvioDoTratamento,
  ESTADOS_EM_ANDAMENTO,
  type EstadoDoTratamento,
  estadoDepoisDe,
  type FaseDoTratamento,
  faltaNoTrecho,
  fatorDoNivel,
  janelaDaAmostra,
  type MedidasDoVideo,
  motorDoTratamento,
  MOTORES_DO_TRATAMENTO,
  type MotorDoTratamento,
  type NivelDaMelhora,
  nomeDoTratado,
  partesDoTrecho,
  type PartePreparadaDoTratamento,
  type PassosDaFase,
  pastaDoTratado,
  podeComecar,
  proximoPassoDoTratamento,
  regiaoValida,
  type RegiaoDaLegenda,
  ROTULO_DA_ACAO,
  textoDoEstadoDoTratamento,
} from "./modulos/tratamento-de-video.ts";

const BUCKET = "mesa";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_PARA_O_PROVEDOR_S = 6 * 3600;
const URL_PARA_A_TELA_S = 3600;
const TRAVA_MS = 180_000;
const INTERVALO_MS = 15_000;
const TENTATIVAS_DE_BAIXAR = 5;

type Parametros = { regiao?: RegiaoDaLegenda | null; nivel?: NivelDaMelhora; fator?: number; medidas?: MedidasDoVideo };

type Linha = {
  id: string;
  client_id: string;
  arquivo_id: string | null;
  fonte_bucket: string;
  fonte_path: string;
  nome_do_antes: string;
  acao: AcaoDoTratamento;
  motor: string;
  parametros: Parametros;
  estado: EstadoDoTratamento;
  fase: FaseDoTratamento;
  amostra: PassosDaFase | null;
  final: PassosDaFase | null;
  custo_estimado: Record<string, unknown> | null;
  custo_usd: number | string;
  resultado_arquivo_id: string | null;
  erro: string | null;
  chave: string;
  consultado_em: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

const linhaCurta = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const numero = (v: unknown, padrao: number) => (v !== null && v !== "" && v !== undefined && isFinite(Number(v)) ? Number(v) : padrao);
const quemCriou = (...ids: Array<string | null | undefined>): string | null => ids.find((x) => !!x && UUID.test(String(x))) || null;
const temChave = (nome: string) => !!chaveCarregada(nome);

function semTabela(b: BaseDaFuncao, error: { message?: string; code?: string } | null): Error {
  const m = String((error && error.message) || "");
  if (/video_tratamentos|does not exist|schema cache|PGRST20|42P01|42703|tratamento_id|tipo_check|alvo_check/i.test(m)) {
    return b.erro(503, "banco_sem_tratamento", "Tratar vídeo ainda não foi ativado no banco. Aplique o SQL 20261002160000.");
  }
  return b.erro(500, "banco_indisponivel", "Não foi possível gravar agora. Tente de novo.");
}

function exigirConfirmacao(b: BaseDaFuncao, estimado: number, confirmado: unknown, detalhe: string) {
  const c = Number(confirmado);
  if (confirmado === undefined || confirmado === null || confirmado === "" || !isFinite(c)) {
    throw b.erro(409, "confirmar_custo", "Confirme o custo antes de tratar.", { custo_estimado: { usd: estimado, detalhe } });
  }
  if (estimado > c + 0.005) throw b.erro(409, "custo_mudou", "O custo mudou desde a confirmação. Confira de novo.", { custo_estimado: { usd: estimado, detalhe } });
}

async function conferirSaldo(b: BaseDaFuncao, clientId: string, usd: number) {
  try {
    await garantirSaldo(clientId, usd);
  } catch (e) {
    if (e instanceof IaMotorErro) throw b.erro(e.status, e.codigo, e.message, e.detalhes);
    throw e;
  }
}

/** Medidas do vídeo (as que o acervo guardou; a tela pode mandar o qps lido no navegador). */
function medidasDe(a: { largura: number | null; altura: number | null }, bruto: unknown): MedidasDoVideo {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const fps = numero(o.fps, 30);
  return { largura: a.largura || numero(o.largura, 1080), altura: a.altura || numero(o.altura, 1920), fps: Math.max(1, Math.min(120, fps)) };
}

function estadoDosMotores() {
  return MOTORES_DO_TRATAMENTO.map((m) => ({ id: m.id, acao: m.acao, rotulo: m.rotulo, nota: m.nota, pronto: temChave(m.chave_env), motivo: temChave(m.chave_env) ? null : `Falta a chave ${m.chave_env} em Configurações › Chaves e custos.` }));
}

// ------------------------------------------------------------------ tela

async function assinar(b: BaseDaFuncao, caminhos: Array<string | null | undefined>, ttl: number): Promise<Record<string, string>> {
  const unicos = Array.from(new Set(caminhos.filter((c): c is string => !!c)));
  if (!unicos.length) return {};
  const { data } = await b.servico().storage.from(BUCKET).createSignedUrls(unicos, ttl);
  const saida: Record<string, string> = {};
  ((data || []) as { path: string | null; signedUrl: string | null }[]).forEach((x) => {
    if (x.path && x.signedUrl) saida[x.path] = x.signedUrl;
  });
  return saida;
}

async function paraTela(b: BaseDaFuncao, linhas: Linha[]) {
  const urls = await assinar(b, linhas.reduce((l, x) => l.concat([x.amostra && x.amostra.antes_path, x.amostra && x.amostra.depois_path]), [] as Array<string | null | undefined>), URL_PARA_A_TELA_S);
  return linhas.map((x) => {
    const passos = x.fase === "final" ? x.final : x.amostra;
    return {
      id: x.id,
      arquivo_id: x.arquivo_id,
      nome_do_antes: x.nome_do_antes,
      acao: x.acao,
      acao_rotulo: ROTULO_DA_ACAO[x.acao],
      motor: x.motor,
      parametros: x.parametros,
      estado: x.estado,
      fase: x.fase,
      estado_texto: textoDoEstadoDoTratamento(x.estado, x.fase, passos),
      amostra: x.amostra
        ? { inicio_s: x.amostra.inicio_s, fim_s: x.amostra.fim_s, antes_url: x.amostra.antes_path ? urls[x.amostra.antes_path] || null : null, depois_url: x.amostra.depois_path ? urls[x.amostra.depois_path] || null : null, custo_previsto_usd: x.amostra.custo_previsto_usd ?? null }
        : null,
      envios: ((passos && passos.envios) || []).map((e) => ({ parte: e.parte, estado: e.estado, posicao: e.posicao, erro: e.erro })),
      custo_estimado: x.custo_estimado,
      custo_usd: Number(x.custo_usd) || 0,
      resultado_arquivo_id: x.resultado_arquivo_id,
      erro: x.erro,
      criado_em: x.criado_em,
      atualizado_em: x.atualizado_em,
    };
  });
}

async function lerTratamento(b: BaseDaFuncao, id: string): Promise<Linha> {
  if (!UUID.test(id)) throw b.erro(400, "tratamento_id_invalido", "tratamento_id precisa ser um UUID.");
  const { data, error } = await b.servico().from("video_tratamentos").select("*").eq("id", id).maybeSingle();
  if (error) throw semTabela(b, error);
  if (!data) throw b.erro(404, "tratamento_inexistente", "Tratamento não encontrado.");
  const l = data as Linha;
  await b.garantirAcesso(l.client_id);
  return l;
}

/** Pede o preparo da fase ao worker: corta em partes e (tirar legenda com máscara) faz a máscara de cada uma. */
async function pedirPreparo(b: BaseDaFuncao, t: Pick<Linha, "id" | "client_id" | "fonte_bucket" | "fonte_path" | "parametros">, fase: FaseDoTratamento, passos: PassosDaFase, motor: MotorDoTratamento): Promise<string> {
  const partes = partesDoTrecho(passos.inicio_s, passos.fim_s, motor.parte_max_s).map((p, k) => ({
    inicio_s: p.inicio_s,
    fim_s: p.fim_s,
    destino: caminhoNoTratamento(t.client_id, t.id, fase, `parte-${k + 1}.mp4`),
    mascara_destino: motor.mascara ? caminhoNoTratamento(t.client_id, t.id, fase, `mascara-${k + 1}.mp4`) : null,
  }));
  const { data, error } = await b.servico()
    .from("render_pedidos")
    .insert({
      client_id: t.client_id,
      tipo: "tratamento",
      tratamento_id: t.id,
      uid: `tratamento-${t.id.slice(0, 8)}-${fase}-preparar-${crypto.randomUUID().slice(0, 8)}`,
      entrada: { fase: "preparar", etapa: fase, fonte_bucket: BUCKET, fonte_path: t.fonte_path, perfil: motor.perfil, regiao: (t.parametros && t.parametros.regiao) || null, partes },
      criado_por: quemCriou(b.userId),
    })
    .select("id")
    .single();
  if (error || !data) throw semTabela(b, error);
  return (data as { id: string }).id;
}

// ------------------------------------------------------------------ amostra

export async function tratamentoAmostra(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  // `acao` é a ação da chamada (tratamento_amostra): o tipo do tratamento vem em `tipo`.
  const acao = (ACOES_DO_TRATAMENTO as string[]).indexOf(String(corpo.tipo)) >= 0 ? (corpo.tipo as AcaoDoTratamento) : null;
  if (!acao) throw b.erro(400, "acao_invalida", "Escolha tirar a legenda ou melhorar a qualidade.");
  const motor = motorDoTratamento(acao, linhaCurta(corpo.motor, 60) || null);
  if (!temChave(motor.chave_env)) throw b.erro(409, "motor_precisa_chave", `${motor.rotulo}: falta a chave ${motor.chave_env} em Configurações › Chaves e custos.`, { chave: motor.chave_env });
  if (!UUID.test(String(corpo.arquivo_id || ""))) throw b.erro(400, "arquivo_id_invalido", "Escolha o vídeo.");
  const { data: a0 } = await b.servico().from("video_arquivos").select("id, client_id, nome, tipo, mime, storage_bucket, storage_path, duracao_s, largura, altura, estado").eq("id", String(corpo.arquivo_id)).maybeSingle();
  const a = a0 as { id: string; client_id: string; nome: string; tipo: string; mime: string | null; storage_bucket: string; storage_path: string; duracao_s: number | null; largura: number | null; altura: number | null; estado: string } | null;
  if (!a || a.client_id !== clientId) throw b.erro(404, "arquivo_inexistente", "Vídeo não encontrado no acervo deste cliente.");
  if ((a.storage_bucket || BUCKET) !== BUCKET || a.storage_path.indexOf(`${clientId}/`) !== 0) throw b.erro(400, "arquivo_fora_do_bucket", "Este vídeo não está no armazenamento da mesa.");
  if (a.tipo === "audio" || String(a.mime || "").indexOf("audio/") === 0 || a.tipo === "quadro" || a.tipo === "still" || a.tipo === "elemento") throw b.erro(400, "nao_e_video", "Escolha um vídeo.");
  if (!a.duracao_s || a.duracao_s <= 0) throw b.erro(400, "sem_duracao", "Sem a duração do vídeo: abra o vídeo uma vez na Entrada para ler.");
  const regiao = acao === "tirar_legenda" ? regiaoValida(corpo.regiao) : null;
  if (acao === "tirar_legenda" && !regiao) throw b.erro(400, "regiao_invalida", "Marque a faixa da legenda no quadro.");
  const medidas = medidasDe(a, corpo.medidas);
  const nivel: NivelDaMelhora = corpo.nivel === "dobro" ? "dobro" : "mesmo_tamanho";
  const fator = acao === "melhorar" ? fatorDoNivel(nivel, medidas) : 1;
  const janela = janelaDaAmostra(a.duracao_s, numero(corpo.inicio_s, 0), numero(corpo.tamanho_s, 5));
  const falta = faltaNoTrecho("amostra", janela.inicio_s, janela.fim_s);
  if (falta) throw b.erro(400, "trecho_invalido", falta);
  const custo = custoDoTratamento(motor, janela.inicio_s, janela.fim_s, medidas, fator);
  exigirConfirmacao(b, custo.usd, corpo.custo_confirmado_usd, custo.detalhe);
  const uid = linhaCurta(corpo.uid, 64).replace(/[^a-z0-9-]/gi, "");
  if (uid.length < 6) throw b.erro(400, "uid_invalido", "Falta o identificador do clique.");
  const chave = `amostra:${uid}`;
  const { data: ja, error: eJa } = await b.servico().from("video_tratamentos").select("*").eq("client_id", clientId).eq("chave", chave).maybeSingle();
  if (eJa) throw semTabela(b, eJa);
  if (ja) return b.json({ tratamento: (await paraTela(b, [ja as Linha]))[0], ja_existia: true });
  await conferirSaldo(b, clientId, custo.usd);

  const passos: PassosDaFase = { chave, inicio_s: janela.inicio_s, fim_s: janela.fim_s, motor: motor.id, fator, custo_previsto_usd: custo.usd, preparo: null, envios: [], composicao: null };
  const parametros: Parametros = { regiao, nivel, fator, medidas };
  const { data: criada, error } = await b.servico()
    .from("video_tratamentos")
    .insert({
      client_id: clientId,
      arquivo_id: a.id,
      fonte_bucket: BUCKET,
      fonte_path: a.storage_path,
      nome_do_antes: a.nome.slice(0, 200),
      acao,
      motor: motor.id,
      parametros,
      estado: "preparando",
      fase: "amostra",
      amostra: passos,
      custo_estimado: { amostra: { usd: custo.usd, detalhe: custo.detalhe, confirmado_usd: Number(corpo.custo_confirmado_usd) } },
      chave,
      consultado_em: new Date(Date.now() + TRAVA_MS).toISOString(),
      criado_por: quemCriou(b.userId),
    })
    .select("*")
    .single();
  if (error || !criada) throw semTabela(b, error);
  const t = criada as Linha;
  try {
    passos.preparo = { render_id: await pedirPreparo(b, t, "amostra", passos, motor) };
  } catch (e) {
    await b.servico().from("video_tratamentos").update({ estado: "erro", erro: (e instanceof Error ? e.message : "Não começou.").slice(0, 600), consultado_em: null, atualizado_em: new Date().toISOString() }).eq("id", t.id);
    throw e;
  }
  const { data: salva, error: eSalvar } = await b.servico().from("video_tratamentos").update({ amostra: passos, consultado_em: null, atualizado_em: new Date().toISOString() }).eq("id", t.id).select("*").single();
  if (eSalvar || !salva) throw semTabela(b, eSalvar);
  await b.auditar("video_tratamento_amostra", { client_id: clientId, acao, motor: motor.id, segundos: janela.fim_s - janela.inicio_s, custo_usd: custo.usd }, true, t.id);
  return b.json({ tratamento: (await paraTela(b, [salva as Linha]))[0] });
}

// ------------------------------------------------------------------ vídeo inteiro

export async function tratamentoFinal(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const t = await lerTratamento(b, String(corpo.tratamento_id || ""));
  const uid = linhaCurta(corpo.uid, 64).replace(/[^a-z0-9-]/gi, "");
  const chaveFinal = uid ? `final:${uid}` : "";
  if (chaveFinal && t.final && t.final.chave === chaveFinal) return b.json({ tratamento: (await paraTela(b, [t]))[0], ja_existia: true });
  const temAmostra = !!(t.amostra && t.amostra.depois_path);
  const trava = podeComecar("final", t.estado, temAmostra);
  if (trava) throw b.erro(409, "tratamento_em_curso", trava);
  const motor = motorDoTratamento(t.acao, t.motor);
  if (!temChave(motor.chave_env)) throw b.erro(409, "motor_precisa_chave", `${motor.rotulo}: falta a chave ${motor.chave_env} em Configurações › Chaves e custos.`, { chave: motor.chave_env });
  const { data: a0 } = await b.servico().from("video_arquivos").select("id, client_id, duracao_s, storage_path").eq("id", t.arquivo_id || "").maybeSingle();
  const a = a0 as { id: string; client_id: string; duracao_s: number | null; storage_path: string } | null;
  if (!a || a.client_id !== t.client_id || a.storage_path !== t.fonte_path) throw b.erro(404, "arquivo_inexistente", "O vídeo de origem não está mais no acervo.");
  const fim = Number(a.duracao_s) || 0;
  const falta = faltaNoTrecho("final", 0, fim);
  if (falta) throw b.erro(400, "trecho_invalido", falta);
  const p = t.parametros || {};
  const fator = Number(p.fator) || 1;
  const custo = custoDoTratamento(motor, 0, fim, p.medidas || { largura: null, altura: null }, fator);
  exigirConfirmacao(b, custo.usd, corpo.custo_confirmado_usd, custo.detalhe);
  if (!chaveFinal) throw b.erro(400, "uid_invalido", "Falta o identificador do clique.");
  await conferirSaldo(b, t.client_id, custo.usd);
  const passos: PassosDaFase = { chave: chaveFinal, inicio_s: 0, fim_s: fim, motor: motor.id, fator, custo_previsto_usd: custo.usd, preparo: null, envios: [], composicao: null };
  const agora = new Date().toISOString();
  const { data: travada, error: eTrava } = await b.servico()
    .from("video_tratamentos")
    .update({ estado: "preparando", fase: "final", final: passos, erro: null, consultado_em: new Date(Date.now() + TRAVA_MS).toISOString(), atualizado_em: agora, custo_estimado: { ...(t.custo_estimado || {}), final: { usd: custo.usd, detalhe: custo.detalhe, confirmado_usd: Number(corpo.custo_confirmado_usd) } } })
    .eq("id", t.id)
    .in("estado", ["amostra", "erro"])
    .select("*")
    .maybeSingle();
  if (eTrava) throw semTabela(b, eTrava);
  if (!travada) throw b.erro(409, "tratamento_em_curso", "Este tratamento mudou agora há pouco. Abra de novo.");
  try {
    passos.preparo = { render_id: await pedirPreparo(b, travada as Linha, "final", passos, motor) };
  } catch (e) {
    await b.servico().from("video_tratamentos").update({ estado: "erro", erro: (e instanceof Error ? e.message : "Não começou.").slice(0, 600), consultado_em: null, atualizado_em: new Date().toISOString() }).eq("id", t.id);
    throw e;
  }
  const { data: salva, error: eSalvar } = await b.servico().from("video_tratamentos").update({ final: passos, consultado_em: null, atualizado_em: new Date().toISOString() }).eq("id", t.id).select("*").single();
  if (eSalvar || !salva) throw semTabela(b, eSalvar);
  await b.auditar("video_tratamento_final", { client_id: t.client_id, acao: t.acao, motor: motor.id, duracao_s: fim, custo_usd: custo.usd }, true, t.id);
  return b.json({ tratamento: (await paraTela(b, [salva as Linha]))[0] });
}

// ------------------------------------------------------------------ andar (tela e cron)

async function cobrar(b: BaseDaFuncao, t: Linha, e: EnvioDoTratamento): Promise<string | null> {
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
    _referencia_tipo: "video_tratamento",
    _referencia_id: t.id,
    _criado_por: quemCriou(b.userId, t.criado_por),
    _chave_origem: "agencia",
    _chave_id: null,
  });
  if (error) {
    registrarFalha("mesa-videos: uso do tratamento de vídeo não registrado", error, { tratamento_id: t.id, parte: e.parte });
    return null;
  }
  const l = (Array.isArray(data) ? data[0] : data) as { uso_id?: string } | null;
  return l && l.uso_id ? String(l.uso_id) : null;
}

const credenciais = (provedor: string): Credenciais => ({ chave: chaveCarregada(provedor === "runway" ? "RUNWAYML_API_SECRET" : "FAL_KEY") });
const refDoEnvio = (e: EnvioDoTratamento): RefDoEnvio => ({ request_id: e.request_id, status_url: e.status_url, response_url: e.response_url, endpoint: e.endpoint });

async function enviarTodos(b: BaseDaFuncao, t: Linha, passos: PassosDaFase): Promise<EnvioDoTratamento[]> {
  const motor = motorDoTratamento(t.acao, passos.motor);
  const partes = (passos.preparo && passos.preparo.partes) || [];
  if (!partes.length) throw new Error("O worker não devolveu as partes preparadas.");
  partes.forEach((p) => {
    if (p.path.indexOf(`${t.client_id}/`) !== 0 || (p.mascara_path && p.mascara_path.indexOf(`${t.client_id}/`) !== 0)) throw new Error("Parte preparada fora da pasta do cliente.");
  });
  const urls = await assinar(b, partes.reduce((l, p) => l.concat([p.path, p.mascara_path]), [] as Array<string | null>), URL_PARA_O_PROVEDOR_S);
  const medidas = (t.parametros && t.parametros.medidas) || { largura: null, altura: null };
  const lista: EnvioDoTratamento[] = [];
  for (let k = 0; k < partes.length; k++) {
    const p = partes[k];
    const custo = custoDoTratamento(motor, p.inicio_s, p.fim_s, medidas, passos.fator || 1).usd;
    const base: EnvioDoTratamento = { parte: k + 1, motor: motor.id, provedor: motor.provedor, endpoint: motor.endpoint, request_id: "", status_url: "", response_url: "", estado: "erro", enviado_em: new Date().toISOString(), consultado_em: new Date().toISOString(), posicao: null, erro: null, custo_previsto_usd: custo, custo_usd: null, uso_id: null, storage_path: null };
    const executor = executorDoProvedor(motor.provedor);
    try {
      if (!executor) throw new Error(`${motor.rotulo} ainda não trata por aqui.`);
      if (!urls[p.path]) throw new Error("A parte preparada não foi encontrada no armazenamento.");
      const corpo = corpoDoTratamento(motor, { parte_url: urls[p.path], mascara_url: p.mascara_path ? urls[p.mascara_path] || null : null, fator: passos.fator || 1 });
      const r = await executor.enviar(motor.endpoint, corpo, credenciais(motor.provedor), { idempotencia: `${t.id}-${t.fase}-${k + 1}` });
      lista.push({ ...base, ...r, estado: "enviado" });
    } catch (e) {
      registrarFalha("mesa-videos: envio do tratamento de vídeo falhou", e, { tratamento_id: t.id, parte: k + 1 });
      lista.push({ ...base, erro: `${motor.rotulo} não aceitou a parte ${k + 1}: ${e instanceof Error ? e.message.slice(0, 300) : "falhou"}. Nada foi cobrado por ela.` });
      // Uma parte recusada encerra a fase (sem nova tentativa): não envia as outras.
      break;
    }
  }
  return lista;
}

async function consultarEnvios(b: BaseDaFuncao, t: Linha, envios: EnvioDoTratamento[], gravar: (e: EnvioDoTratamento[]) => Promise<void>) {
  const agora = Date.now();
  const motor = motorDoTratamento(t.acao, envios[0] ? envios[0].motor : t.motor);
  for (const e of envios) {
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
        registrarFalha("mesa-videos: consulta do tratamento falhou", err, { tratamento_id: t.id, parte: e.parte });
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
        const caminho = caminhoNoTratamento(t.client_id, t.id, t.fase, `ia-${e.parte}.mp4`);
        await guardarDoProvedor(r.urls[0], "video", { supabaseUrl: Deno.env.get("SUPABASE_URL") || "", chaveDeServico: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", bucket: BUCKET, caminho });
        e.storage_path = caminho;
        e.estado = "pronto";
        e.erro = null;
      } catch (err) {
        e.tentativas_de_baixar = (e.tentativas_de_baixar || 0) + 1;
        e.erro = err instanceof Error ? err.message : "Não baixou.";
        registrarFalha("mesa-videos: resultado do tratamento não foi guardado", err, { tratamento_id: t.id, parte: e.parte, tentativa: e.tentativas_de_baixar });
        if (e.tentativas_de_baixar >= TENTATIVAS_DE_BAIXAR) {
          e.estado = "erro";
          e.erro = `O provedor terminou, mas a parte ${e.parte} não foi guardada depois de ${TENTATIVAS_DE_BAIXAR} tentativas. O uso já foi registrado.`;
        }
      }
    }
  }
}

async function pedirComposicao(b: BaseDaFuncao, t: Linha, passos: PassosDaFase): Promise<string> {
  const envios = (passos.envios || []).slice().sort((x, y) => x.parte - y.parte);
  const partes = (passos.preparo && passos.preparo.partes) || [];
  const final = t.fase === "final";
  const { data, error } = await b.servico()
    .from("render_pedidos")
    .insert({
      client_id: t.client_id,
      tipo: "tratamento",
      tratamento_id: t.id,
      uid: `tratamento-${t.id.slice(0, 8)}-${t.fase}-compor-${crypto.randomUUID().slice(0, 8)}`,
      entrada: {
        fase: "compor",
        etapa: t.fase,
        acao: t.acao,
        fonte_bucket: BUCKET,
        fonte_path: t.fonte_path,
        inicio_s: passos.inicio_s,
        fim_s: passos.fim_s,
        regiao: (t.parametros && t.parametros.regiao) || null,
        ia: envios.map((e, k) => ({ path: e.storage_path, inicio_s: partes[k] ? partes[k].inicio_s : null, fim_s: partes[k] ? partes[k].fim_s : null })),
        destino: caminhoNoTratamento(t.client_id, t.id, t.fase, `depois-${Date.now().toString(36)}.mp4`),
        destino_antes: final ? null : caminhoNoTratamento(t.client_id, t.id, t.fase, "antes.mp4"),
        registrar: final,
        titulo: nomeDoTratado(t.nome_do_antes, t.acao),
        de_arquivo_id: t.arquivo_id,
      },
      criado_por: quemCriou(t.criado_por),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`O pedido de montagem não foi gravado: ${error ? error.message : "sem id"}`);
  return (data as { id: string }).id;
}

/** O vídeo novo entra na Entrada da Edição, na pasta "Antes e depois" do antes. */
async function arrumarResultado(b: BaseDaFuncao, t: Linha, arquivoId: string) {
  let grupoDoAntes: string | null = null;
  if (t.arquivo_id) {
    const { data } = await b.servico().from("video_arquivos").select("grupo, client_id").eq("id", t.arquivo_id).maybeSingle();
    const a = data as { grupo: string | null; client_id: string } | null;
    if (a && a.client_id === t.client_id) grupoDoAntes = a.grupo;
  }
  const { error } = await b.servico().from("video_arquivos").update({ edicao_desde: new Date().toISOString(), grupo: pastaDoTratado(grupoDoAntes), atualizado_em: new Date().toISOString() }).eq("id", arquivoId).eq("client_id", t.client_id);
  if (error) registrarFalha("mesa-videos: vídeo tratado sem pasta ou sem entrar na Edição", error, { tratamento_id: t.id, arquivo_id: arquivoId });
}

/** Uma rodada de UM tratamento em curso (tela ou cron), sob a trava de consultado_em. */
async function andar(b: BaseDaFuncao, lida: Linha): Promise<Linha> {
  if (ESTADOS_EM_ANDAMENTO.indexOf(lida.estado) < 0) return lida;
  const agora = Date.now();
  const { data: travada, error } = await b.servico()
    .from("video_tratamentos")
    .update({ consultado_em: new Date(agora + TRAVA_MS).toISOString() })
    .eq("id", lida.id)
    .in("estado", ESTADOS_EM_ANDAMENTO)
    .or(`consultado_em.is.null,consultado_em.lt.${new Date(agora - INTERVALO_MS).toISOString()}`)
    .select("*")
    .maybeSingle();
  if (error) throw semTabela(b, error);
  if (!travada) return lida;
  const t = travada as Linha;
  const fase = t.fase;
  const passos: PassosDaFase = { ...((fase === "final" ? t.final : t.amostra) as PassosDaFase) };
  let estado: EstadoDoTratamento = t.estado;
  let erro: string | null = t.erro;
  let resultado: string | null = t.resultado_arquivo_id;
  const coluna = fase === "final" ? "final" : "amostra";
  const gravar = async (envios: EnvioDoTratamento[]) => {
    const { error: e } = await b.servico().from("video_tratamentos").update({ [coluna]: { ...passos, envios } }).eq("id", t.id);
    if (e) registrarFalha("mesa-videos: cobrança do tratamento não gravada antes de baixar", e, { tratamento_id: t.id });
  };
  try {
    const idDoRender = estado === "preparando" ? passos.preparo && passos.preparo.render_id : estado === "compondo" ? passos.composicao && passos.composicao.render_id : null;
    type PedidoDoRender = { estado: string; erro_mensagem: string | null; saida_path: string | null; arquivo_id: string | null; resultado: Record<string, unknown> | null };
    let render: PedidoDoRender | null = null;
    if (idDoRender) {
      const { data } = await b.servico().from("render_pedidos").select("estado, erro_mensagem, saida_path, arquivo_id, resultado").eq("id", idDoRender).maybeSingle();
      render = (data as PedidoDoRender | null) || null;
    }
    let d = proximoPassoDoTratamento(estado, passos, render ? { estado: render.estado, erro: render.erro_mensagem } : null);
    if (d.passo === "enviar" && estado === "preparando" && render) {
      const r = render.resultado || {};
      const partes = (Array.isArray(r.partes) ? r.partes : []) as PartePreparadaDoTratamento[];
      passos.preparo = { ...(passos.preparo as { render_id: string }), estado: "pronto", partes };
      passos.envios = await enviarTodos(b, t, passos);
      estado = "gerando";
      d = proximoPassoDoTratamento(estado, passos, null);
    }
    if (d.passo === "consultar") {
      await consultarEnvios(b, t, passos.envios || [], gravar);
      d = proximoPassoDoTratamento(estado, passos, null);
    }
    if (d.passo === "compor") {
      passos.composicao = { render_id: await pedirComposicao(b, t, passos) };
      estado = "compondo";
    } else if (d.passo === "concluir" && render) {
      const r = render.resultado || {};
      passos.depois_path = render.saida_path;
      passos.antes_path = typeof r.antes_path === "string" ? r.antes_path : null;
      passos.resumo = typeof r.resumo === "string" ? r.resumo : null;
      if (fase === "final") {
        resultado = render.arquivo_id;
        passos.arquivo_id = render.arquivo_id;
        if (resultado) await arrumarResultado(b, t, resultado);
      }
      estado = fase === "final" && !resultado ? "erro" : estadoDepoisDe(fase);
      erro = estado === "erro" ? "A máquina terminou sem registrar o vídeo novo." : null;
    } else if (d.passo === "erro") {
      estado = "erro";
      erro = d.motivo.slice(0, 600);
    }
  } catch (e) {
    registrarFalha("mesa-videos: tratamento de vídeo não andou", e, { tratamento_id: t.id });
    erro = (e instanceof Error ? e.message : "Não andou.").slice(0, 600);
    if (estado === "gerando" && !(passos.envios || []).length) estado = "erro";
  }
  const fim = new Date().toISOString();
  const outras = fase === "final" ? t.amostra : t.final;
  const { data: salva, error: eSalvar } = await b.servico()
    .from("video_tratamentos")
    .update({ estado, [coluna]: passos, erro, resultado_arquivo_id: resultado, custo_usd: custoCobrado([passos, outras]), consultado_em: fim, atualizado_em: fim })
    .eq("id", t.id)
    .select("*")
    .single();
  if (eSalvar || !salva) throw semTabela(b, eSalvar);
  return salva as Linha;
}

export async function tratamentoStatus(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id || "");
  await b.garantirAcesso(clientId);
  let q = b.servico().from("video_tratamentos").select("*").eq("client_id", clientId).neq("estado", "descartado").order("criado_em", { ascending: false }).limit(12);
  if (UUID.test(String(corpo.arquivo_id || ""))) q = q.eq("arquivo_id", String(corpo.arquivo_id));
  const { data, error } = await q;
  if (error) throw semTabela(b, error);
  const saida: Linha[] = [];
  let andadas = 0;
  for (const l of (data || []) as Linha[]) {
    if (ESTADOS_EM_ANDAMENTO.indexOf(l.estado) >= 0 && andadas < 3) {
      andadas++;
      try {
        saida.push(await andar(b, l));
        continue;
      } catch (e) {
        registrarFalha("mesa-videos: status do tratamento", e, { tratamento_id: l.id });
      }
    }
    saida.push(l);
  }
  return b.json({ tratamentos: await paraTela(b, saida), motores: estadoDosMotores() });
}

export async function tratamentoDescartar(b: BaseDaFuncao, corpo: Record<string, unknown>) {
  const t = await lerTratamento(b, String(corpo.tratamento_id || ""));
  if (ESTADOS_EM_ANDAMENTO.indexOf(t.estado) >= 0) throw b.erro(409, "tratamento_em_curso", "Espere terminar para tirar da lista.");
  // Apagar = arquivar: a linha e os arquivos ficam; só sai da lista.
  const { data, error } = await b.servico().from("video_tratamentos").update({ estado: "descartado", atualizado_em: new Date().toISOString() }).eq("id", t.id).select("*").single();
  if (error || !data) throw semTabela(b, error);
  return b.json({ tratamento: (await paraTela(b, [data as Linha]))[0] });
}

/** Cron (junto da coleta dos pedidos): anda os tratamentos em curso de todos os clientes, os mais esquecidos primeiro. */
export async function tratamentosColetar(b: BaseDaFuncao, tetoMs = 30_000): Promise<{ conferidos: number; prontos: number; erros: number }> {
  const inicio = Date.now();
  const { data, error } = await b.servico().from("video_tratamentos").select("*").in("estado", ESTADOS_EM_ANDAMENTO).order("consultado_em", { ascending: true, nullsFirst: true }).limit(6);
  if (error) {
    // Sem o SQL 20261002160000: a coleta dos pedidos de vídeo segue normal.
    if (/video_tratamentos|does not exist|schema cache|42P01/i.test(String(error.message || ""))) return { conferidos: 0, prontos: 0, erros: 0 };
    throw semTabela(b, error);
  }
  let conferidos = 0;
  let prontos = 0;
  let erros = 0;
  for (const l of (data || []) as Linha[]) {
    if (Date.now() - inicio > tetoMs) break;
    try {
      const r = await andar(b, l);
      conferidos++;
      if (r.estado === "pronto" || r.estado === "amostra") prontos++;
      if (r.estado === "erro") erros++;
    } catch (e) {
      registrarFalha("mesa-videos: coleta de um tratamento falhou", e, { tratamento_id: l.id });
    }
  }
  return { conferidos, prontos, erros };
}
