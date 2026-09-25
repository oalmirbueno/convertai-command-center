/**
 * mesa-foto: o estúdio fotográfico da Mesa (docs/mesa-foto/CONTRATO.md e a
 * pesquisa em docs/mesa-foto/pesquisa/).
 *
 * POST { acao, ... }, só equipe com acesso ao cliente. Toda ação que usa IA
 * devolve custo_usd e saldo_usd; erro sai como { error, mensagem } (nas ações
 * com fôlego o status real vai em status_http).
 *
 * Acervo (cliente_imagens é o acervo único das três mesas):
 * - acervo_registrar { client_id, caminhos[], nomes? } -> { imagens, duplicadas, recusadas }
 * - acervo_ler_foto { client_id, imagem_id } -> { imagem_id, descricao, observado, texto_lido, qualidade, sugestao }
 * - acervo_decidir { client_id, imagem_id, decisao } -> { imagem } (aprova derivada do preparo)
 * Kits:
 * - kit_sugerir { client_id, imagem_ids[] } -> { kits, nao_agrupadas } (não grava)
 * - kit_salvar { client_id, kit, refs[] } -> { kit, refs }
 * Ensaio:
 * - receitas {} -> { receitas, presets, ... } (sem IA)
 * - ensaio_planejar { client_id, kit_id, receita_id, finalidade, formatos, pedido? } -> { ensaio, estimativa_usd, estimativa }
 * - tomada_editar { ensaio_id, tomada_id, campos } -> { ensaio, tomada, estimativa_usd } (sem IA)
 * - tomada_gerar { ensaio_id, tomada_id, modelo_imagem_id?, qualidade?, guia? } -> { ensaio, versao }
 * - versao_conferir { ensaio_id, tomada_id, versao? } -> { conferencia } (visão + Jev só como aviso)
 * - versao_decidir { ensaio_id, tomada_id, versao, decisao, motivo? } -> { ensaio, versao, imagem }
 * Preparar:
 * - preparar { client_id, imagem_id, modo, areas_protegidas?, cenario?, instrucao?, guia?, kit_id? } -> { imagem }
 * Usar:
 * - enviar { client_id, imagem_ids[], destino } -> { file_ids, arquivos }
 * - baixar { client_id, imagem_ids[] } -> { arquivos: [{ imagem_id, nome, arquivo, url }] }
 * - estimar { client_id, acao, ... } -> { estimativa_usd } (sem IA)
 * Biblioteca e agente:
 * - biblioteca_salvar { client_id, item } -> { item }
 * - referencias_buscar { q, licenca?, pagina? } -> { itens } (Openverse, sem chave)
 * - referencia_importar { client_id, imagem_url, titulo, licenca, fonte_url } -> { item, url }
 * - agente_conversar { client_id, mensagem, conversa_id?, kit_id?, ensaio_id?, anexos?, nova_conversa? } -> { conversa_id, resposta, sugestoes }
 * - agente_aplicar { ensaio_id?, client_id?, kit_id?, sugestao } -> { ensaio?, tomada?, item?, itens? } e, na v2:
 *   plano_de_variacoes e campanha -> { ensaio, estimativa_usd, estimativa, ... }; identificar_produto -> resposta de produto_identificar
 * v2 (docs/mesa-foto/CONTRATO-V2.md):
 * - produto_identificar { client_id, imagem_ids[], salvar_kit?, pedido? } -> { produto, referencias_web, lacunas, proximo_passo, kit, kit_acao, aviso_jev }
 * - variacoes_planejar { client_id, kit_id, quantidade, tipos?, pedido?, referencia_ids?, formatos? } -> { ensaio, estimativa_usd, estimativa, lacunas }
 * - campanha_planejar { client_id, kit_id, quantidade, referencias_estilo_ids?, modelo?, pedido?, formatos? } -> { ensaio, guia_de_estilo, modelo, estimativa_usd, estimativa, lacunas }
 * - biblioteca_ilustrar { limite? } -> { ilustrados, sem_resultado, pendentes, itens } (só admin, Openverse, sem IA)
 * - biblioteca_exemplo_gerar { client_id, item_id, modelo_imagem_id?, qualidade? } -> { item, url, custo_usd }
 * - kit_sugerir agora SALVA os kits como rascunho (sem duplicar o mesmo produto) e devolve kit_ids.
 * Modelos e Canvas (docs/mesa-foto/MODELOS-E-CANVAS.md; ações em modelos.ts e canvas.ts, regras puras em
 * personas.ts e canvas-regras.ts; o index só registra):
 * - modelos_listar, modelo_ler, modelo_criar, modelo_editar, motores_imagem, modelo_candidata_gerar,
 *   modelo_ancora_escolher, modelo_vista_gerar, modelo_imagem_decidir, modelo_detalhar, modelo_conferir
 * - canvas_listar, canvas_ler, canvas_salvar, canvas_montar, canvas_gerar, canvas_conferir
 * - estimar aceita também acao_alvo modelo_candidata, modelo_rodada, modelo_vista, modelo_detalhar e canvas_gerar
 * Ligada à Mesa (pedido do dono, 25/09; campanhas.ts):
 * - campanhas_listar { client_id } -> { mes, hoje, campanha_do_mes_id, campanhas } (sem IA; a do mês sai do calendário)
 * - ensaio_planejar, variacoes_planejar, campanha_planejar e agente_conversar aceitam campanha_id (mesa_campanhas;
 *   "nenhuma" = só a marca): o contexto do diretor leva a campanha escolhida (ou, sem ela, a do mês) e o ensaio
 *   grava direcao.campanha_mesa
 * - modelo_sugerir { client_id, pedido?, campanha_id? } -> { sugestao, avisos } (ficha da persona pelo brief; não grava)
 * - versao_decidir aprovando grava a foto no acervo com as tags mesa_foto, gerada e ensaio:<id> (o Estúdio acha por elas)
 * Frente D (25/09; docs/mesa-foto/CLONES.md):
 * - preparar modo fundo_transparente ("Tirar fundo"): só o alfa do GPT Image, alinhado à foto original (recorte.ts)
 * - clones_listar, clone_criar, clone_ler, clone_editar, clone_folha_gerar, clone_imagem_decidir, clone_variacao_gerar,
 *   clone_conferir, clone_pacote (clones.ts; pessoa real só com autorização) e estimar clone_folha|clone_variacao|clone_conferir
 * - biblioteca_limpar_exemplos, biblioteca_exemplos_estimar, biblioteca_exemplo_proximo (biblioteca-lote.ts; só admin)
 *
 * Regras duras: original imutável (toda alteração é derivada com derivada_de);
 * identidade separada de estilo (referência de estilo vai depois das fontes,
 * com legenda "só estilo"); sem laço de correção (gera uma vez, confere uma
 * vez, a equipe decide; refazer pede variação real); modo pedido que o motor
 * não faz vira erro explícito; nada de escurecer a foto; custo à vista antes
 * (estimativa) e custo real por versão. Sem travessão.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  aceitaFundoTransparente,
  carregarModelo,
  chamarImagem,
  chamarTexto,
  cobrarJev,
  estimarComModelo,
  IaMotorErro,
  type ImagemEntrada,
  modeloPadrao,
  type ModeloIa,
  type Qualidade,
  recusouTamanho,
  type SaidaImagem,
} from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar, probabilidadeNoul } from "../_shared/jev.ts";
import { lerContextoConsolidado, lerDocumentosDeMarca, lerMarcaParaDirecao } from "../_shared/contexto-cliente.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { acoesDeCampanhas, campanhaParaOContexto, type CampanhaParaFoto, lerCampanhasParaFoto } from "./campanhas.ts";
import {
  AVISO_REFERENCIA_WEB,
  blocosDaResposta,
  cameraDaCampanha,
  camposV2,
  chaveDoProduto,
  descricaoDaReferenciaWeb,
  type FotoDeCampanha,
  type GuiaDeEstilo,
  type Identificacao,
  imagensDoHtml,
  type KitExistente,
  kitParecido,
  lacunasDaEvidencia,
  lerFotosDeCampanha,
  lerModeloSintetico,
  lerOrigemWeb,
  lerVariacoesSugeridas,
  MAX_FOTOS_CAMPANHA,
  MAX_VARIACOES,
  mesclarKit,
  type ModeloSintetico,
  normalizarGuiaDeEstilo,
  normalizarIdentificacao,
  type OrigemWeb,
  planoDeVariacoes,
  referenciaWebServe,
  TAG_REFERENCIA_WEB,
  formatoValido,
  promptDoExemplo,
  temIdentidade,
  termosDeBusca,
  type VagaDeVariacao,
  vagasDoPlano,
  type VariacaoSugerida,
} from "./calculos.ts";
import {
  aplicarSugestaoDeTomada,
  arred6,
  type Area,
  caminhoDeOriginalValido,
  caminhoDoClienteNoMesa,
  categoriaDoAcervo,
  categoriaDoKit,
  type Conferencia,
  conferirRefs,
  criteriosDaConferencia,
  decidirVersao,
  derivadaDoPreparo,
  dimensoesDaImagem,
  ErroDeRegra,
  type Estimativa,
  estimativaDoEnsaio,
  extensaoDe,
  fontesDaTomada,
  type Guia,
  type ImagemDoAcervo,
  ipv4Interno,
  ipv6Interno,
  itensDoOpenverse,
  type KitFoto,
  lerAreas,
  lerCamera,
  lerFormatos,
  lerGuia,
  LIMITE_PRATICO_DE_FONTES,
  limiteDeFontesDoMotor,
  limpo,
  limpoOuNulo,
  listaDeTextos,
  mimeDe,
  montarTomada,
  montarTomadas,
  motivoDoBloqueio,
  nomeDoArquivo,
  nomeSeguro,
  normalizarConferencia,
  OPENVERSE_MAX_PAGINA,
  normalizarItemBiblioteca,
  normalizarKit,
  normalizarRefs,
  normalizarSugestoes,
  promptDaTomada,
  promptDoPreparo,
  proximaVersao,
  type RefDoKit,
  sha256Hex,
  statusDaTomada,
  statusDoEnsaio,
  type Sugestao,
  tamanhoDeTrabalho,
  type Tomada,
  type TomadaDoDiretor,
  urlDoOpenverse,
  urlPublicaSegura,
  UUID,
  type VersaoTomada,
} from "./calculos.ts";
import { SEMENTE_DA_BIBLIOTECA, VERSAO_DA_SEMENTE } from "./biblioteca-semente.ts";
import { ACOES_LONGAS_DE_MODELOS, acoesDeModelos, ALVOS_DE_ESTIMATIVA_DE_MODELOS } from "./modelos.ts";
import { ACOES_LONGAS_DO_CANVAS, acoesDoCanvas, ALVOS_DE_ESTIMATIVA_DO_CANVAS } from "./canvas.ts";
import { ACOES_LONGAS_DE_CLONES, acoesDeClones, ALVOS_DE_ESTIMATIVA_DE_CLONES } from "./clones.ts";
import { ACOES_LONGAS_DA_BIBLIOTECA, acoesDaBibliotecaEmLote } from "./biblioteca-lote.ts";
import type { FerramentasDaMesa } from "./ferramentas.ts";
import {
  AZIMUTES,
  cameraDoPreset,
  ELEVACOES,
  ENQUADRAMENTOS,
  FORMATOS,
  PROMESSA_CAMPANHA,
  PROMESSA_REFERENCIA_WEB,
  RECEITA_CAMPANHA,
  RECEITA_VARIACOES,
  TIPOS_DE_VARIACAO,
  tipoDeVariacaoPorId,
  type Formato,
  MODOS_PREPARAR,
  type ModoPreparar,
  NOMES_DAS_VISTAS,
  PAPEIS,
  PRESETS,
  PROMESSA_DO_MODO,
  receitaPorId,
  RECEITAS,
  TAMANHO_DO_FORMATO,
  TIPOS_DE_KIT,
  type TipoKit,
  VERSAO_RECEITAS,
} from "./receitas.ts";
import {
  aplicarAlfaDaOrigem,
  comporRecorteSobre,
  comporSobreBranco,
  devolverOriginalNasAreas,
  dimensoesDecodificando,
  ehRecorte,
  emPng,
  mascaraProtegendo,
  reduzir,
  telaDeTrabalho,
} from "./imagem.ts";
import { abrirFoto, avisoDoRecorte, fracaoTransparenteDe, LADO_DO_RECORTE, recortePreservandoOriginal, telaDoRecorte } from "./recorte.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ------------------------------------------------------------------ constantes

// Tarefas e agentes já aceitos pelos checks de ia_usos (sem valor novo no banco).
const TAREFA_ESTUDIO = "estudio" as const;
const TAREFA_LEITURA = "leitura_referencia" as const;
const TAREFA_CONFERENCIA = "verificacao" as const;
const AGENTE_DIRETOR = "diretor_arte" as const;
const AGENTE_LEITOR = "leitor" as const;
const AGENTE_GERADOR = "gerador_imagem" as const;
// referencia_tipo de ia_usos e agente_conversas (texto livre no banco).
const REF_ENSAIO = "foto_ensaio";
const REF_IMAGEM = "cliente_imagem";
const REF_KIT = "foto_kit";
const REF_CONVERSA = "mesa_foto";

/** Texto do diretor e do leitor: 300 s (o padrão de 120 s corta planejamento com raciocínio). */
const TIMEOUT_TEXTO_FOTO_MS = 300_000;
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];
const QUALIDADE_PADRAO: Qualidade = "media";
const MAX_BYTES_ORIGINAL = 30 * 1024 * 1024;
const MAX_BYTES_REFERENCIA = 12 * 1024 * 1024;
const MAX_CAMINHOS_POR_CHAMADA = 30;
const MAX_FOTOS_KIT_SUGERIR = 12;
const LADO_VISAO = 1280;
const LADO_FONTE = 1536;
const LADO_PREPARO = 2048;
const URL_ASSINADA_S = 3600;
const TIMEOUT_BUSCA_MS = 15_000;
// Sem e-mail de pessoa no User-Agent (Openverse e hosts de imagem; Wikimedia Commons não é usado aqui).
const AGENTE_HTTP = "Mozilla/5.0 (compatible; AceleriqMesaFoto/1.0)";
const MAX_HISTORICO_CONVERSA = 12;
/** produto_identificar: fotos lidas por chamada e referências baixadas da internet. */
const MAX_FOTOS_IDENTIFICAR = 6;
const MAX_REFERENCIAS_WEB = 6;
const MAX_PAGINAS_LIDAS = 3;
const MAX_BYTES_PAGINA = 2 * 1024 * 1024;
const TIMEOUT_PAGINA_MS = 12_000;
/** biblioteca_ilustrar: o Openverse sem cadastro aceita 20 buscas por minuto. */
const ILUSTRAR_PADRAO = 8;
const ILUSTRAR_MAXIMO = 18;
const TAG_EXEMPLO_PUBLICO = "exemplo_banco_publico";
const TAG_EXEMPLO_GERADO = "exemplo_gerado";
const TAG_SEM_EXEMPLO = "exemplo_nao_encontrado";
const CAMPOS_IMAGEM =
  "id, client_id, origem, storage_bucket, storage_path, nome, pasta, categoria, tags, descricao, ativa, derivada_de, gerada, modo, kit_id, sha256, largura, altura, aprovada, criado_em, atualizado_em";

// ------------------------------------------------------------------ tipos

type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

type LinhaImagem = {
  id: string;
  client_id: string;
  origem: string;
  storage_bucket: string;
  storage_path: string;
  nome: string;
  pasta: string | null;
  categoria: string | null;
  tags: string[] | null;
  descricao: string | null;
  ativa: boolean;
  derivada_de: string | null;
  gerada: boolean | null;
  modo: string | null;
  kit_id: string | null;
  sha256: string | null;
  largura: number | null;
  altura: number | null;
  aprovada: boolean | null;
  criado_em: string;
  atualizado_em: string;
};

type LinhaKit = KitFoto & { id: string; client_id: string; criado_por: string | null; criado_em: string; atualizado_em: string };

type LinhaEnsaio = {
  id: string;
  client_id: string;
  kit_id: string;
  receita_id: string;
  receita_versao: string;
  finalidade: string | null;
  formatos: string[];
  tomadas: Tomada[];
  direcao: Record<string, unknown>;
  pedido: string | null;
  custo_usd: number | string;
  status: string;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

type LinhaBiblioteca = {
  id: string;
  client_id: string | null;
  tipo: "prompt" | "referencia";
  categoria: string;
  titulo: string;
  prompt_pt: string | null;
  prompt_en: string | null;
  negativo: string | null;
  imagem_url: string | null;
  storage_path: string | null;
  fonte_nome: string | null;
  fonte_url: string | null;
  licenca: string | null;
  autor: string | null;
  tags: string[] | null;
  destaque: boolean;
};

// ------------------------------------------------------------------ banco e acesso

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

/** Cliente do banco com o JWT de quem chamou: can_access_client, create_file_record e a revisão leem auth.uid(). */
function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa a Mesa Foto.");
  return { userId, token, doChamador: clienteDoChamador(token) };
}

async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroHttp(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};

// ------------------------------------------------------------------ erros

const MENSAGEM_MOTOR: Record<string, { status: number; mensagem: string }> = {
  saldo_insuficiente: { status: 402, mensagem: "Saldo insuficiente na carteira de IA deste cliente. Peça a recarga a um admin ou gestor." },
  cota_da_chave_esgotada: { status: 402, mensagem: "A cota do mês da chave de IA deste cliente acabou." },
  cliente_sem_chave: { status: 403, mensagem: "Este cliente não tem chave de IA própria e o uso da chave da agência está desligado para ele." },
  provedor_sem_chave: { status: 503, mensagem: "O provedor deste modelo está sem chave de API configurada." },
};

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof ErroDeRegra) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof IaMotorErro) {
    if (err.detalhes?.motivo === "fundo_transparente_nao_suportado") {
      return json({ ...err.paraJson(), error: "fundo_transparente_nao_suportado", mensagem: "O modelo de imagem escolhido não gera fundo transparente. Escolha um GPT Image." }, 409);
    }
    const conhecido = MENSAGEM_MOTOR[err.codigo];
    const status = conhecido?.status ?? (err.status >= 400 ? err.status : 500);
    return json({ ...err.paraJson(), mensagem: conhecido?.mensagem ?? err.message }, status);
  }
  if (err instanceof JevErro) return json({ error: "jev_indisponivel", mensagem: "O Jev não respondeu. Tente de novo.", codigo: err.codigo }, 502);
  console.error("[mesa-foto] erro inesperado", { nome: err instanceof Error ? err.name : "desconhecido" });
  return json({ error: "erro_interno", mensagem: "Falha inesperada na Mesa Foto." }, 500);
}

// ------------------------------------------------------------------ storage

async function baixar(bucket: string, caminho: string, max = MAX_BYTES_ORIGINAL): Promise<Uint8Array> {
  const { data, error } = await servico().storage.from(bucket).download(caminho);
  if (error || !data) throw new ErroHttp(502, "arquivo_indisponivel", "Não foi possível ler a imagem no armazenamento.", { caminho });
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > max) throw new ErroHttp(413, "arquivo_grande_demais", "Imagem grande demais para processar.", { caminho });
  return bytes;
}

/**
 * Imagem reduzida (lado maior até `lado`) para visão e fontes do gerador:
 * pede à transformação do Storage e, sem ela, reduz aqui.
 */
async function baixarReduzida(bucket: string, caminho: string, lado: number, nome: string): Promise<ImagemEntrada> {
  try {
    const { data, error } = await servico().storage.from(bucket).download(caminho, {
      transform: { width: lado, height: lado, resize: "contain", format: "origin" },
    });
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const mime = mimeDe(bytes);
      const d = mime ? dimensoesDaImagem(bytes) : null;
      if (mime && d && Math.max(d.largura, d.altura) <= lado + 2) return { bytes, mime, nome: `${nomeSeguro(nome)}.${extensaoDe(mime)}` };
    }
  } catch {
    // cai no original abaixo
  }
  const original = await baixar(bucket, caminho);
  if (!mimeDe(original)) throw new ErroHttp(415, "imagem_invalida", `O arquivo ${nome} não é uma imagem reconhecida.`);
  const png = await reduzir(original, lado);
  return { bytes: png, mime: "image/png", nome: `${nomeSeguro(nome)}.png` };
}

async function urlAssinada(bucket: string, caminho: string, download?: string): Promise<string | null> {
  const { data } = await servico().storage.from(bucket).createSignedUrl(caminho, URL_ASSINADA_S, download ? { download } : undefined);
  return data?.signedUrl ?? null;
}

async function salvarNoMesa(caminho: string, bytes: Uint8Array, mime: string) {
  const { error } = await servico().storage.from("mesa").upload(caminho, new Blob([new Uint8Array(bytes)], { type: mime }), { contentType: mime, upsert: false });
  if (error) throw new ErroHttp(503, "gravacao_de_imagem_falhou", "Não foi possível guardar a imagem gerada. Tente de novo.");
}

async function emParalelo<T, R>(itens: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await fn(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return saida;
}

// ------------------------------------------------------------------ leituras

async function lerImagens(clientId: string, ids: string[]): Promise<LinhaImagem[]> {
  const validos = Array.from(new Set(ids.filter((i) => UUID.test(i))));
  if (!validos.length) return [];
  const { data, error } = await servico().from("cliente_imagens").select(CAMPOS_IMAGEM).eq("client_id", clientId).in("id", validos);
  if (error) throw new ErroHttp(503, "acervo_indisponivel", "Não foi possível ler o acervo do cliente.");
  return (data as LinhaImagem[] | null) ?? [];
}

async function lerImagem(clientId: string, id: string): Promise<LinhaImagem> {
  const [linha] = await lerImagens(clientId, [id]);
  if (!linha) throw new ErroHttp(404, "imagem_inexistente", "Esta imagem não está no acervo do cliente.");
  return linha;
}

async function comUrl(l: LinhaImagem) {
  return { ...l, url: await urlAssinada(l.storage_bucket, l.storage_path) };
}

async function lerKit(ch: Chamador, kitId: string): Promise<LinhaKit> {
  const k = await lerKitSemConferir(kitId);
  await garantirAcesso(ch, k.client_id);
  return k;
}

/** Kit lido sem conferir o acesso (só depois de uma conferência feita pela ação). */
async function lerKitSemConferir(kitId: string): Promise<LinhaKit> {
  const { data, error } = await servico().from("foto_kits").select("*").eq("id", kitId).maybeSingle();
  if (error) throw new ErroHttp(503, "kit_indisponivel", "Não foi possível ler o kit.");
  if (!data) throw new ErroHttp(404, "kit_inexistente", "Kit não encontrado.");
  const k = data as LinhaKit;
  const identificacao = normalizarIdentificacao(k.atributos?.identificacao);
  k.atributos = {
    observado: listaDeTextos(k.atributos?.observado, 30, 300),
    informado: listaDeTextos(k.atributos?.informado, 30, 300),
    inferido: listaDeTextos(k.atributos?.inferido, 30, 300),
    ...(identificacao ? { identificacao } : {}),
  };
  k.invariantes = k.invariantes ?? [];
  k.lacunas = k.lacunas ?? [];
  return k;
}

/** Referências do kit com o que o acervo sabe de cada imagem. */
async function lerRefs(kit: LinhaKit): Promise<(RefDoKit & { imagem: LinhaImagem })[]> {
  const { data, error } = await servico().from("foto_kit_refs").select("imagem_id, papel, vista, prioridade").eq("kit_id", kit.id);
  if (error) throw new ErroHttp(503, "kit_indisponivel", "Não foi possível ler as referências do kit.");
  const refs = (data as RefDoKit[] | null) ?? [];
  const imagens = await lerImagens(kit.client_id, refs.map((r) => r.imagem_id));
  const porId = new Map(imagens.map((i) => [i.id, i]));
  // Referência cuja imagem saiu do acervo (ou ficou inativa) não é trocada por outra: some da lista.
  return refs
    .filter((r) => porId.get(r.imagem_id)?.ativa !== false && porId.has(r.imagem_id))
    .map((r) => {
      const i = porId.get(r.imagem_id)!;
      return { ...r, gerada: !!i.gerada, aprovada: !!i.aprovada, nome: i.nome, descricao: i.descricao, origem_web: lerOrigemWeb(i.tags, i.descricao), imagem: i };
    });
}

async function lerEnsaio(id: string): Promise<LinhaEnsaio> {
  const { data, error } = await servico().from("foto_ensaios").select("*").eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(503, "ensaio_indisponivel", "Não foi possível ler o ensaio.");
  if (!data) throw new ErroHttp(404, "ensaio_inexistente", "Ensaio não encontrado.");
  const e = data as LinhaEnsaio;
  e.tomadas = Array.isArray(e.tomadas) ? e.tomadas : [];
  e.direcao = e.direcao && typeof e.direcao === "object" ? e.direcao : {};
  return e;
}

async function ensaioComAcesso(ch: Chamador, id: string): Promise<LinhaEnsaio> {
  const e = await lerEnsaio(id);
  await garantirAcesso(ch, e.client_id);
  return e;
}

/**
 * Grava no ensaio com trava otimista por atualizado_em (o gatilho renova a
 * coluna em todo update): duas tomadas geradas ao mesmo tempo não apagam a
 * versão uma da outra.
 */
async function mutarEnsaio(id: string, mudar: (e: LinhaEnsaio) => Record<string, unknown>): Promise<LinhaEnsaio> {
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const atual = await lerEnsaio(id);
    const patch = mudar(atual);
    const { data, error } = await servico().from("foto_ensaios").update(patch).eq("id", id).eq("atualizado_em", atual.atualizado_em).select("*").maybeSingle();
    if (error) throw new ErroHttp(503, "gravacao_falhou", "Não foi possível gravar o ensaio.");
    if (data) {
      const e = data as LinhaEnsaio;
      e.tomadas = Array.isArray(e.tomadas) ? e.tomadas : [];
      return e;
    }
  }
  throw new ErroHttp(409, "conflito_de_gravacao", "O ensaio mudou várias vezes ao mesmo tempo. Tente de novo.");
}

function tomadaDoEnsaio(e: LinhaEnsaio, id: unknown): Tomada {
  const t = e.tomadas.find((x) => x.id === String(id ?? ""));
  if (!t) throw new ErroHttp(404, "tomada_inexistente", "Tomada não encontrada neste ensaio.");
  return t;
}

// ------------------------------------------------------------------ modelos

const raciocinioPara = (m: ModeloIa) => ["medium", "low", "high"].find((r) => (m.raciocinio ?? []).includes(r));

async function modeloDeTexto(papel: "diretor_arte" | "leitura", pedido?: unknown): Promise<ModeloIa> {
  if (typeof pedido === "string" && pedido.trim()) return await carregarModelo(pedido.trim(), "texto");
  const m = (await modeloPadrao(papel)) ?? (papel === "diretor_arte" ? await modeloPadrao("estrategista") : null);
  if (!m) throw new ErroHttp(409, "sem_modelo_padrao", `O catálogo não tem modelo padrão ativo para ${papel === "leitura" ? "leitura" : "o diretor"}.`);
  return m;
}

async function modeloDeImagem(pedido?: unknown): Promise<ModeloIa> {
  if (typeof pedido === "string" && pedido.trim()) return await carregarModelo(pedido.trim(), "imagem");
  const m = await modeloPadrao("imagem");
  if (!m) throw new ErroHttp(409, "sem_modelo_padrao", "O catálogo não tem modelo padrão ativo para imagem.");
  return m;
}

const lerQualidade = (v: unknown): Qualidade => (QUALIDADES.includes(v as Qualidade) ? (v as Qualidade) : QUALIDADE_PADRAO);

const custoDeUmaImagem = (m: ModeloIa, qualidade: Qualidade, imagensDeEntrada: number, caracteresDoPrompt = 3500) =>
  estimarComModelo(m, { imagens: 1, qualidade, tokensEntrada: Math.ceil(caracteresDoPrompt / 3.5) + imagensDeEntrada * 1_600 });

const custoDeUmaConferencia = (m: ModeloIa, imagensDeEntrada: number) =>
  estimarComModelo(m, { tokensEntrada: imagensDeEntrada * 1_600 + 2_500, tokensSaida: 2_500 });

// ------------------------------------------------------------------ esquemas JSON

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const lista = (items: unknown) => ({ type: "array", items });
const enumNulo = (valores: readonly string[]) => ({ type: ["string", "null"], enum: [...valores, null] });

const ESQUEMA_LEITURA = {
  nome: "leitura_da_foto",
  schema: obj({
    descricao: S("string"),
    observado: lista(S("string")),
    texto_lido: S("string"),
    qualidade: obj({
      nitidez: S("string", { enum: ["boa", "aceitavel", "ruim"] }),
      luz: S("string", { enum: ["boa", "aceitavel", "ruim"] }),
      enquadramento: S("string", { enum: ["bom", "aceitavel", "ruim"] }),
      problemas: lista(S("string")),
    }),
    sugestao: obj({
      tipo: S("string", { enum: TIPOS_DE_KIT }),
      nome: S("string"),
      papel: S("string", { enum: PAPEIS }),
      vista: enumNulo(NOMES_DAS_VISTAS),
    }),
  }),
};

const ESQUEMA_KITS = {
  nome: "kits_sugeridos",
  schema: obj({
    kits: lista(obj({
      tipo: S("string", { enum: TIPOS_DE_KIT }),
      nome: S("string"),
      variante: S(["string", "null"]),
      refs: lista(obj({ imagem_id: S("string"), papel: S("string", { enum: PAPEIS }), vista: enumNulo(NOMES_DAS_VISTAS) })),
      atributos: obj({ observado: lista(S("string")), inferido: lista(S("string")) }),
      invariantes: lista(S("string")),
      lacunas: lista(S("string")),
      perguntas: lista(S("string")),
    })),
    nao_agrupadas: lista(obj({ imagem_id: S("string"), motivo: S("string") })),
  }),
};

const ESQUEMA_PLANO = {
  nome: "plano_do_ensaio",
  schema: obj({
    conceito: S("string"),
    tomadas: lista(obj({
      receita_tomada_id: S(["string", "null"]),
      nome: S("string"),
      objetivo: S("string"),
      preset_id: S(["string", "null"]),
      cenario: S("string"),
      luz: S("string"),
      pode_mudar: lista(S("string")),
      formato: S(["string", "null"]),
      observacao: S(["string", "null"]),
      props: lista(S("string")),
    })),
    lacunas_que_limitam: lista(S("string")),
    perguntas: lista(S("string")),
  }),
};

const ESQUEMA_GUIA_DE_ESTILO = obj({
  resumo: S("string"),
  paleta: lista(S("string")),
  luz: S("string"),
  cenarios: lista(S("string")),
  props: lista(S("string")),
  enquadramentos: lista(S("string")),
  clima: S("string"),
  figurino: S("string"),
  evitar: lista(S("string")),
});

const ESQUEMA_MODELO = obj({ perfil: S("string"), idade_aprox: S(["number", "null"]), estilo: S("string") });

const ESQUEMA_FOTO_CAMPANHA = obj({
  nome: S("string"),
  objetivo: S("string"),
  acao: S("string"),
  expressao: S("string"),
  figurino: S("string"),
  enquadramento: S("string", { enum: ["close", "medio", "aberto"] }),
  camera: S(["string", "null"]),
  cenario: S("string"),
  luz: S("string"),
  props: lista(S("string")),
  formato: S(["string", "null"]),
  com_pessoa: S("boolean"),
});

const ESQUEMA_IDENTIFICACAO = {
  nome: "produto_identificado",
  schema: obj({
    texto_lido: S("string"),
    observado: lista(S("string")),
    fotos: lista(obj({ imagem_id: S("string"), e_embalagem: S("boolean"), vista: enumNulo(NOMES_DAS_VISTAS) })),
    produto: obj({
      marca: S(["string", "null"]),
      modelo: S(["string", "null"]),
      variante: S(["string", "null"]),
      categoria: S(["string", "null"]),
      tipo_kit: S("string", { enum: TIPOS_DE_KIT }),
      especificacoes: lista(S("string")),
      forma_do_produto: lista(S("string")),
      confianca: S("string", { enum: ["alta", "media", "baixa"] }),
      evidencias: lista(S("string")),
    }),
    candidatos: lista(obj({ marca: S(["string", "null"]), modelo: S(["string", "null"]), variante: S(["string", "null"]), motivo: S("string") })),
    paginas: lista(obj({ url: S("string"), fonte: S("string"), tipo: S("string", { enum: ["oficial", "loja", "outra"] }) })),
    imagens: lista(obj({ url: S("string"), pagina: S(["string", "null"]), fonte: S("string"), mostra: S("string") })),
    lacunas: lista(S("string")),
    proximo_passo: S("string"),
  }),
};

const ESQUEMA_VARIACOES = {
  nome: "plano_de_variacoes",
  schema: obj({
    conceito: S("string"),
    tomadas: lista(obj({
      vaga_id: S("string"),
      nome: S("string"),
      objetivo: S("string"),
      cenario: S("string"),
      luz: S("string"),
      props: lista(S("string")),
      formato: S(["string", "null"]),
    })),
    lacunas_que_limitam: lista(S("string")),
  }),
};

const ESQUEMA_CAMPANHA = {
  nome: "campanha_com_modelo",
  schema: obj({
    conceito: S("string"),
    guia_de_estilo: ESQUEMA_GUIA_DE_ESTILO,
    modelo: ESQUEMA_MODELO,
    fotos: lista(ESQUEMA_FOTO_CAMPANHA),
    lacunas: lista(S("string")),
  }),
};

const esquemaConferencia = (criterios: string[]) => ({
  nome: "conferencia_da_foto",
  schema: obj({
    pontos: lista(obj({ criterio: S("string", { enum: criterios }), ok: S(["boolean", "null"]), nota: S("string") })),
    alertas: lista(S("string")),
    resumo: S("string"),
  }),
});

const ESQUEMA_AGENTE = {
  nome: "resposta_do_diretor_de_fotografia",
  schema: obj({
    resposta: S("string"),
    sugestoes: lista(obj({
      tipo: S("string", { enum: ["identificar_produto", "plano_de_variacoes", "campanha", "tomada_nova", "ajuste_tomada", "prompt", "busca_referencia"] }),
      titulo: S("string"),
      motivo: S("string"),
      tomada_id: S(["string", "null"]),
      campos: obj({
        nome: S(["string", "null"]),
        objetivo: S(["string", "null"]),
        preset_id: S(["string", "null"]),
        cenario: S(["string", "null"]),
        luz: S(["string", "null"]),
        formato: S(["string", "null"]),
        pode_mudar: lista(S("string")),
      }),
      prompt_pt: S(["string", "null"]),
      prompt_en: S(["string", "null"]),
      negativo: S(["string", "null"]),
      categoria: S(["string", "null"]),
      busca: S(["string", "null"]),
      kit_id: S(["string", "null"]),
      quantidade: S(["number", "null"]),
      variacoes: lista(obj({
        nome: S("string"),
        tipo: S("string", { enum: TIPOS_DE_VARIACAO.map((t) => t.id) }),
        camera: S(["string", "null"]),
        cenario: S("string"),
        luz: S("string"),
        props: lista(S("string")),
        formato: S(["string", "null"]),
      })),
      guia_de_estilo: ESQUEMA_GUIA_DE_ESTILO,
      modelo: ESQUEMA_MODELO,
      fotos: lista(ESQUEMA_FOTO_CAMPANHA),
      imagem_ids: lista(S("string")),
      referencias_estilo_ids: lista(S("string")),
    })),
  }),
};

// ------------------------------------------------------------------ sistemas

const REGRAS_DA_CASA = `REGRAS DA CASA (Mesa Foto):
- Original é imutável; o que se gera é derivada rastreável.
- Identidade do assunto (produto, pessoa, alimento) vem só das fotos de evidência do kit; estilo, cenário e pose só orientam.
- A embalagem não mostra o formato do produto, mas identifica marca, modelo e variante: use a caixa para identificar e pesquisar o produto real. Com foto do produto (real ou referência oficial da internet), o produto pode sair fora da caixa; sem ela, a caixa é o assunto. Nunca desenhe o produto a partir da arte da caixa. Lacuna fica escrita.
- Referência da internet (foto oficial ou de loja) é uso interno para fidelidade: nunca vai ao cliente como foto final.
- Pessoa real: só a do kit, com autorização; retoque não muda anatomia, idade nem rosto. Pessoa sintética (campanha): gerada, adulta, sem parecer pessoa real conhecida, sem sexualização, sempre marcada como gerada.
- Alimento: não aumentar porção nem inventar ingrediente.
- Nunca escurecer a foto para dar destaque; as regras da capa das artes não valem para fotografia.
- A Mesa é a principal e a Mesa Foto é ferramenta dela: use o brief, a marca, a história, o porquê e o público do cliente, e a campanha que vem em cliente.campanha_escolhida (ou, sem ela, cliente.campanha_do_mes, do calendário editorial). Tema, período, oferta e identidade da campanha orientam cenário, props, paleta de apoio e clima, sempre dentro da marca; a campanha nunca muda o produto.
- Português do Brasil, sem travessão.`;

/**
 * Estética atual (pedido do dono, 25/09: "está muito antigo; quero mais atual:
 * as cores, ambientes diferentes"). Vale para o diretor, as variações e a
 * campanha. Não muda nenhuma regra da casa: fidelidade, nunca escurecer,
 * pessoa só com autorização.
 */
const ESTETICA_ATUAL = `ESTÉTICA ATUAL (2025/2026), o padrão de toda direção:
- Editorial limpo e fotográfico: parece foto de marca contemporânea tirada por fotógrafo de verdade, não banco de imagem, não render 3D, não anúncio dos anos 2010.
- Luz natural suave e com direção: janela lateral, sol de fim de tarde filtrado por cortina de linho, céu aberto na sombra, flash direto suave de editorial quando a marca pede energia. Sombras reais, macias e com forma; nada de luz chapada de estúdio antigo.
- Paletas atuais e com intenção: neutros quentes (areia, aveia, off-white, argila, terracota suave), verdes sálvia e oliva, azul acinzentado, manteiga, cacau, e um acento de cor da marca; tons sólidos e superfícies tingidas no lugar de degradê.
- Cenários contemporâneos e reais: cozinha com pedra natural ou microcimento, bancada de travertino, madeira clara, linho, cerâmica artesanal, papel colorido em tom sólido (papel de fundo de cor), acrílico e vidro com sombra projetada, arquitetura com sombra de janela, rua e café com luz do dia, interior com plantas e objetos de design; props poucos e com função.
- Composição de hoje: respiro, assimetria, recorte ousado, ponto de vista de celular quando o formato é UGC, vistas de cima com sombras gráficas, close de textura; conteúdo vertical pensado para 4:5 e 9:16.
- UGC autêntico quando o uso é Reels, Stories ou anúncio nativo: mão real, luz do ambiente, pequenas imperfeições, sem pose de catálogo.
- EXEMPLOS DE DIREÇÃO: "sérum sobre bancada de travertino, sol das 17h entrando pela janela e desenhando sombra de folhagem, paleta areia e sálvia"; "tênis sobre papel de fundo terracota sólido, flash direto suave, sombra dura curta e gráfica"; "café na mão, mesa de madeira clara num café com janela grande, luz do dia, celular na altura do peito"; "óculos em pedestal de acrílico com sombra colorida projetada no fundo off-white, luz lateral macia".
- EVITE (clichês antigos): fundo degradê, vinheta, HDR, bokeh exagerado, reflexo espelhado em acrílico preto, fumaça e faíscas, luz neon sem motivo, fundo preto dramático sem pedido da marca, flutuação sem motivo, saturação alta, filtro vintage pesado, cenário de banco de imagem (escritório genérico, aperto de mão, gente sorrindo para a câmera sem motivo).`;

/** Linguagem de direção de arte publicitária usada pelo diretor em todo plano. */
const PADRAO_PUBLICITARIO = `PADRÃO DE FOTOGRAFIA PUBLICITÁRIA:
- Cada foto tem intenção: para que serve (anúncio, feed, catálogo, capa) e o que o olhar vê primeiro.
- Luz descrita como fotógrafo: fonte e tamanho (softbox, octabox, janela, sol filtrado), direção, altura, qualidade (dura ou suave), temperatura de cor, preenchimento e recorte.
- Cenário concreto: superfície e material, fundo, planos de profundidade, props com função (nunca aleatórios, sem marca de terceiros, sem texto), paleta do cliente no cenário e nunca no produto.
- Variações diferentes de verdade: não repita a mesma combinação de câmera, cenário, luz e paleta; cada uma responde a um uso diferente.
- Produto fiel: formato, cor, texto e proporções do kit; escala real em relação às mãos e ao cenário.
${ESTETICA_ATUAL}`;

const SISTEMA_LEITOR = `Você é o assistente de estúdio fotográfico da agência Aceleriq. Olhe a foto real do cliente e descreva só o que se vê.
- descricao: até 3 frases objetivas sobre o assunto e a foto.
- observado: fatos visíveis curtos (cor, material, forma, quantidade de botões ou peças, texto, estado), sem opinião.
- texto_lido: todo texto visível exatamente como está, sem corrigir; trecho ilegível vira [ilegível]; vazio quando não há texto.
- qualidade: nitidez, luz e enquadramento; problemas concretos (desfoque, reflexo estourado, assunto cortado, ruído, compressão, fundo poluído).
- sugestao: tipo do assunto, nome curto, papel desta foto num kit (identidade para foto limpa do assunto inteiro; detalhe; embalagem para caixa ou pacote; verso; rotulo; rosto; corpo; pose; estilo; cenario) e a vista (frente, tres_quartos_direito, lateral_direita, verso, topo, detalhe e assim por diante; null quando não dá para saber).
Nunca invente modelo, marca, medida ou especificação que não esteja escrita ou visível.
${REGRAS_DA_CASA}
Responda só com o JSON pedido.`;

const SISTEMA_KITS = `Você organiza as fotos de um cliente em kits de referência de um estúdio fotográfico. Cada kit é UM assunto (um produto numa variante, uma pessoa, um prato).
- Agrupe só o que é comprovadamente o mesmo assunto. Duas variantes (cor, tamanho, sabor, modelo) são kits diferentes, mesmo com embalagem parecida.
- Produto e a caixa dele ficam no mesmo kit com papéis diferentes (identidade para o produto, embalagem para a caixa). Leia na caixa marca, modelo, variante e códigos e use no nome e na variante do kit. Se só houver caixa, o kit existe do mesmo jeito (a caixa com papel embalagem) e a lacuna diz "falta foto do produto fora da embalagem"; a identificação pela internet completa depois.
- Foto marcada como REFERÊNCIA DA INTERNET é foto oficial ou de loja do produto: pode entrar como identidade do mesmo produto (uso interno), nunca como embalagem.
- A palavra do pedido que não bate com a foto não trava nada: organize pelo que as fotos mostram.
- papel: identidade (foto limpa do assunto inteiro), detalhe, embalagem, verso, rotulo, rosto, corpo, pose, estilo, cenario. vista: de que lado a foto mostra o assunto.
- atributos.observado: o que se vê; atributos.inferido: o que você supõe (marcado como suposição). Nada do que o cliente informou existe ainda.
- invariantes: o que não pode mudar em nenhuma foto (cor, texto do rótulo, quantidade de botões, formato).
- lacunas: vistas e detalhes que faltam para um ensaio completo (verso, lateral, detalhe de porta, rótulo legível, medida real).
- perguntas: o que a equipe precisa confirmar (modelo, variante, autorização de pessoa).
- Foto que não serve (desfocada, de outro assunto, arte pronta) vai em nao_agrupadas com o motivo.
Use exatamente os ids de imagem recebidos.
${REGRAS_DA_CASA}
Responda só com o JSON pedido.`;

const SISTEMA_DIRETOR = `Você é o diretor de fotografia da agência Aceleriq. Planeja ensaios fotográficos profissionais de produtos, alimentos e pessoas a partir de fotos reais do cliente.
Use o contexto real do cliente (negócio, história, porquê, público, oferta, marca, nicho) para decidir cenário, luz, props e clima de cada tomada: a foto precisa parecer da marca e falar com o público dela.
Linguagem de fotógrafo: tomada, cenário, luz (chave, preenchimento, recorte), proximidade, lente, superfície, props.
COMO PLANEJAR:
- Use as tomadas da receita como base (receita_tomada_id) e acrescente no máximo 3 tomadas próprias quando o contexto justificar (receita_tomada_id null).
- preset_id só da lista de presets; a câmera é relativa à frente definida no kit.
- Tomada da receita marcada como bloqueada continua na lista, com observacao dizendo a evidência que falta. Não contorne a falta.
- cenario e luz concretos (superfície, fundo, props, direção e qualidade da luz), coerentes com a marca e com a finalidade.
- pode_mudar: o que a tomada pode variar (cenário, props, superfície, luz, composição), nunca o assunto.
- formato: um dos formatos pedidos.
- lacunas_que_limitam: o que falta no kit e limita o ensaio. perguntas: o que a equipe precisa confirmar.
- props: objetos de cena com função (lista curta, sem marca e sem texto); vazio quando a tomada pede fundo limpo.
- Nunca invente atributo do produto; cenário e props não sugerem função, acessório, sabor ou ingrediente que o kit não tem.
${PADRAO_PUBLICITARIO}
${REGRAS_DA_CASA}
Responda só com o JSON pedido.`;

const SISTEMA_CONFERENCIA = `Você é o conferente de fotografia do estúdio. A PRIMEIRA imagem é a foto gerada; as outras são as fontes reais do kit (a verdade sobre o assunto).
Compare critério por critério: ok true quando está fiel às fontes, false quando diverge, null quando não dá para avaliar (a parte não aparece nas fontes). nota: o que você viu, curto e concreto.
alertas: só divergências críticas (produto ou variante trocada, texto do rótulo diferente ou espelhado, quantidade de botões ou peças diferente, rosto de outra pessoa, idade ou corpo alterados, mão deformada, ingrediente inventado, porção maior, sombra dupla, assunto flutuando).
Não julgue beleza nem gosto. Não invente o que não vê.
${REGRAS_DA_CASA}
Responda só com o JSON pedido.`;

const SISTEMA_AGENTE = `Você é o diretor de fotografia e de arte publicitária da Mesa Foto, trabalhando junto com a equipe da agência Aceleriq. Você TRABALHA: entende o pedido, decide e entrega o próximo passo concreto, pronto para aplicar com um clique. Nada de resposta de uma linha, nada de recusar.

COMO RESPONDER (campo resposta), em blocos curtos, cada um numa linha própria começando pelo rótulo:
Entendi: o que você viu nas fotos e no pedido, em uma ou duas frases (se a palavra da equipe não bate com a foto, diga o que viu e siga com isso; ex.: "vi duas caixas do mouse NTC X, vou trabalhar com ele").
Plano: o que você propõe e por quê, com números (quantas fotos, quais tipos).
Atenção: só se houver lacuna real que muda o resultado (e o caminho padrão que você já tomou).
Próximo passo: a ação exata que a equipe aplica agora.

SEJA PROATIVO:
- Sempre proponha o próximo passo executável. Só pergunte quando a resposta muda o resultado, e mesmo assim entregue a sugestão com o caminho padrão.
- Foto de caixa ou embalagem: leia marca, modelo, variante e códigos e devolva identificar_produto com os ids dessas fotos (ele pesquisa o produto real na internet, baixa fotos de referência e salva o kit). Nunca recuse porque "só tem a caixa".
- Anexo com referencia_de_estilo true (print de perfil, moodboard) é só estilo: vai em referencias_estilo_ids, nunca em identificar_produto.
- Sem kit do produto e com fotos anexadas do produto ou da caixa: a primeira sugestão é identificar_produto. Com kit (kit aberto ou kits_do_cliente), use o kit_id certo.
- "N fotos", "variações", "várias fotos", "tirar da caixa": plano_de_variacoes com N variações realmente diferentes (tipos da lista tipos_de_variacao; camera é um preset_id; cenario, luz, props e formato concretos). Padrão sem número: 8.
- "Campanha", "modelo", "publicidade", "pessoa usando", print de perfil ou moodboard anexado: campanha com guia_de_estilo lido das imagens anexadas (paleta, luz, cenários, props, enquadramentos, clima, figurino, o que evitar), modelo (perfil, idade_aprox adulta, estilo) e as fotos (com_pessoa false para produto sozinho, flutuando ou em destaque). referencias_estilo_ids = ids das imagens anexadas que são referência de estilo. Extraia a DIREÇÃO, nunca copie foto, marca ou pessoa da referência.

TIPOS DE SUGESTÃO (até 6; em cada uma, campos que não se aplicam ficam null, listas vazias, textos vazios):
- identificar_produto: imagem_ids (até 6 ids de fotos anexadas ou do acervo).
- plano_de_variacoes: kit_id, quantidade (1 a 16), variacoes.
- campanha: kit_id, quantidade, guia_de_estilo, modelo, fotos, referencias_estilo_ids.
- tomada_nova e ajuste_tomada (só com ensaio aberto): campos com nome, objetivo, preset_id, cenario, luz, formato, pode_mudar.
- prompt: prompt_pt, prompt_en, negativo e categoria da biblioteca.
- busca_referencia: termo curto em inglês para referências de estilo com licença comercial.

HONESTIDADE: referência da internet é uso interno para fidelidade, nunca foto final; pessoa sintética é gerada, adulta e não parece ninguém real; o que falta fica escrito. Você sugere, a equipe decide; nada de laço de correção.
${PADRAO_PUBLICITARIO}
${REGRAS_DA_CASA}
Responda só com o JSON pedido.`;

const SISTEMA_IDENTIFICAR = `Você identifica produtos para o estúdio fotográfico da agência Aceleriq. Recebe fotos de uma embalagem ou do próprio produto.
1. LEIA as fotos: todo texto visível (marca, modelo, variante, cor, códigos, EAN, especificações impressas) em texto_lido, exatamente como está; observado com fatos visíveis. Em fotos, diga para cada imagem_id se é embalagem (caixa, blister, pacote) ou o produto em si, e a vista.
2. PESQUISE NA INTERNET o produto real: página oficial do fabricante primeiro, depois lojas grandes. Confirme marca, modelo e variante; traga especificações objetivas (dimensões, peso, conexão, material, cores) e forma_do_produto (como o produto é por fora: formato, cor, botões, peças, acabamento, logotipo e onde fica).
3. IMAGENS: endereços diretos de imagem (jpg, png ou webp) do PRODUTO em si, de preferência fundo limpo, da página oficial ou de lojas grandes. Só endereços que você viu nos resultados da busca; nunca invente nem monte endereço. Nada de foto da caixa, de montagem com vários produtos, de outro modelo ou de outra cor.
4. confianca: alta quando a página oficial ou duas lojas confirmam o modelo e a variante lidos; media quando confirma o modelo mas não a variante; baixa quando não achou ou há dúvida. candidatos: os modelos possíveis quando há dúvida (inclua o escolhido).
5. lacunas: o que não foi confirmado (variante, cor, medida). proximo_passo: uma frase com o que a equipe faz agora.
Nunca invente marca, modelo ou especificação. Português do Brasil, sem travessão. Responda só com o JSON pedido.`;

const SISTEMA_VARIACOES = `Você é o diretor de fotografia publicitária da agência Aceleriq. Recebe o contexto real do cliente, o kit do produto e as VAGAS de um lote de variações já decididas no código (tipo, câmera e o que muda em cada uma).
Para cada vaga (use exatamente o vaga_id recebido), escreva: nome curto e vendedor, objetivo (uso da foto), cenario, luz, props e formato (um dos formatos pedidos).
- Cada foto do lote precisa ser claramente diferente das outras: superfície, fundo, paleta de apoio, hora e direção da luz, props. Nunca repita o mesmo cenário.
- Siga a direção do tipo da vaga e a mudança da rodada quando houver.
- Use a paleta, o estilo e o público do cliente; props e cenário conversam com a história da marca.
- Vaga com foco embalagem: a caixa fechada é o herói; não descreva o produto de dentro.
- Vaga fora da embalagem: o produto sozinho, sem a caixa.
${PADRAO_PUBLICITARIO}
${REGRAS_DA_CASA}
Responda só com o JSON pedido.`;

const SISTEMA_CAMPANHA = `Você é o diretor de arte de campanhas publicitárias da agência Aceleriq. Recebe o contexto real do cliente, o kit do produto, o perfil pedido da pessoa sintética e imagens: primeiro as fotos do produto (identidade), depois as REFERÊNCIAS DE ESTILO (print de perfil, moodboard).
1. guia_de_estilo: extraia a DIREÇÃO das referências de estilo (paleta com nomes de cor e hex quando der, luz, cenários, props, enquadramentos, clima, figurino, o que evitar). Nunca copie foto, marca, logotipo, texto ou pessoa das referências. Sem referência, crie o guia pela marca e pelo público do cliente.
2. modelo: uma pessoa sintética adulta (idade_aprox a partir de 21) coerente com o público do cliente, com perfil e estilo concretos; respeite o perfil pedido pela equipe. Nunca parecida com pessoa real conhecida, sem sexualização. Varie etnia, corpo e estilo entre campanhas quando a equipe não pedir um perfil.
3. fotos: a quantidade pedida, todas diferentes entre si (enquadramento, cenário, luz, ação). acao diz exatamente o que a pessoa faz com o produto no jeito real de uso; com_pessoa false para produto sozinho, flutuando ou em destaque (no máximo um terço das fotos). camera é um preset_id ou null. Os cenários complementam a identidade do cliente e seguem o guia.
4. lacunas: o que limita a campanha (produto sem foto fora da caixa, variante não confirmada).
O produto do kit é invariante: forma, cor, peças e texto não mudam em nenhuma foto.
${PADRAO_PUBLICITARIO}
${REGRAS_DA_CASA}
Responda só com o JSON pedido.`;

// ------------------------------------------------------------------ contexto do cliente

type ContextoFoto = {
  cliente: string;
  marca: Awaited<ReturnType<typeof lerMarcaParaDirecao>>;
  dados: Record<string, unknown>;
  /** A campanha da Mesa que orienta este plano (a escolhida ou a do mês), para gravar no ensaio. */
  campanha: { id: string; nome: string; papel: "escolhida" | "do_mes" } | null;
};

/**
 * Contexto real do cliente para o diretor de fotografia: marca (paleta,
 * estilo, regras, tom), contexto consolidado (negócio, público, oferta,
 * diferenciais, lacunas), dossiê atual (história e porquê), documentos de
 * marca, briefing de ads atual (oferta, público, objeções), nicho do último
 * plano da Mesa Ads e a memória do diretor. Sem dado, fica null.
 */
async function contextoDoCliente(clientId: string, campanhaId?: unknown): Promise<ContextoFoto> {
  // "nenhuma": a equipe escolheu seguir só a marca (nem a campanha do mês entra).
  const semCampanha = campanhaId === "nenhuma";
  const pedida = campanhaId != null && campanhaId !== "" && !semCampanha ? idDe(campanhaId, "campanha_id") : null;
  const [marca, consolidado, dossie, documentos, briefing, plano, memoria, campanhas] = await Promise.all([
    lerMarcaParaDirecao(servico(), clientId),
    lerContextoConsolidado(servico(), clientId),
    servico().from("client_dossiers").select("content, summary, dossier_type, effective_at").eq("client_id", clientId).eq("is_current", true)
      .order("effective_at", { ascending: false }).limit(2),
    lerDocumentosDeMarca(servico(), clientId, 6_000).catch(() => []),
    servico().from("ads_briefings").select("oferta, publico, objecoes, restricoes").eq("client_id", clientId).eq("atual", true).maybeSingle(),
    servico().from("ads_planos").select("estrutura").eq("client_id", clientId).order("criado_em", { ascending: false }).limit(1),
    servico().from("agente_memoria").select("tipo, texto").eq("client_id", clientId).eq("agente", AGENTE_DIRETOR).eq("ativa", true)
      .order("criado_em", { ascending: false }).limit(20),
    lerCampanhasParaFoto(servico(), clientId).catch(() => null),
  ]);
  const listaDeCampanhas: CampanhaParaFoto[] = campanhas ? campanhas.campanhas : [];
  const escolhida = pedida ? listaDeCampanhas.find((c) => c.id === pedida) || null : null;
  if (pedida && !escolhida) throw new ErroHttp(404, "campanha_inexistente", "Esta campanha não é deste cliente (ou foi apagada na Mesa).");
  const doMes = !escolhida && !semCampanha ? listaDeCampanhas.find((c) => c.do_mes) || null : null;
  const dossies = (dossie.data as { content: string | null; summary: string | null; dossier_type: string | null }[] | null) ?? [];
  const estrutura = ((plano.data as { estrutura: Record<string, unknown> | null }[] | null) ?? [])[0]?.estrutura ?? null;
  return {
    cliente: marca.nomeCliente,
    marca,
    dados: {
      cliente: marca.nomeCliente,
      contexto_consolidado: consolidado,
      marca: { estilo: marca.estilo, regras: marca.regras, tom_de_voz: marca.tomDeVoz, paleta: marca.paleta },
      dossie_atual: dossies.length
        ? dossies.map((d) => `[${d.dossier_type ?? "dossiê"}] ${d.summary ? `${d.summary}\n` : ""}${String(d.content ?? "")}`).join("\n\n").slice(0, 8_000)
        : null,
      documentos_de_marca: (documentos as { nome: string; texto: string }[]).map((d) => ({ nome: d.nome, texto: d.texto.slice(0, 3_000) })),
      briefing_de_ads: briefing.data ?? null,
      nicho: typeof estrutura?.nicho === "string" ? estrutura.nicho : null,
      memoria_do_diretor: memoria.data ?? [],
      // A Mesa é a principal: a campanha que ela usa (escolhida ou a do mês no calendário) orienta a foto.
      campanha_escolhida: escolhida ? campanhaParaOContexto(escolhida, "escolhida") : null,
      campanha_do_mes: doMes ? campanhaParaOContexto(doMes, "do_mes") : null,
      outras_campanhas_ativas: listaDeCampanhas.filter((c) => c.status !== "encerrada" && c !== escolhida && c !== doMes).slice(0, 5).map((c) => c.nome),
    },
    campanha: escolhida ? { id: escolhida.id, nome: escolhida.nome, papel: "escolhida" } : doMes ? { id: doMes.id, nome: doMes.nome, papel: "do_mes" } : null,
  };
}

const hexDaPaleta = (marca: ContextoFoto["marca"]) =>
  marca.paleta.map((p) => (typeof p?.hex === "string" && /^#[0-9a-f]{3,8}$/i.test(p.hex) ? p.hex.toUpperCase() : null)).filter((x): x is string => !!x).slice(0, 5);

function resumoDoKit(kit: LinhaKit, refs: (RefDoKit & { imagem: LinhaImagem })[]) {
  return {
    id: kit.id,
    tipo: kit.tipo,
    nome: kit.nome,
    variante: kit.variante,
    atributos: kit.atributos,
    invariantes: kit.invariantes,
    lacunas: kit.lacunas,
    autorizacao_confirmada: kit.tipo === "pessoa" ? kit.autorizacao?.confirmada === true : null,
    fontes: refs.map((r) => ({ papel: r.papel, vista: r.vista, descricao: limpo(r.descricao, 300) || r.nome })),
  };
}

// ------------------------------------------------------------------ acervo

async function acervoRegistrar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const nomesBrutos = Array.isArray(corpo.nomes) ? corpo.nomes : [];
  // O mesmo caminho repetido conta uma vez (e nunca é apagado como duplicata de si mesmo).
  const pares = new Map<string, unknown>();
  (Array.isArray(corpo.caminhos) ? corpo.caminhos : []).forEach((c, i) => {
    if (!pares.has(String(c))) pares.set(String(c), nomesBrutos[i]);
  });
  const brutos = Array.from(pares.keys());
  const nomes = Array.from(pares.values());
  if (!brutos.length) throw new ErroHttp(400, "sem_caminhos", "Envie os caminhos das fotos já enviadas ao bucket mesa.");
  if (brutos.length > MAX_CAMINHOS_POR_CHAMADA) {
    throw new ErroHttp(400, "lote_grande_demais", `Registre no máximo ${MAX_CAMINHOS_POR_CHAMADA} fotos por chamada.`);
  }
  const imagens: unknown[] = [];
  const duplicadas: { caminho: string; imagem_id: string }[] = [];
  const recusadas: { caminho: string; motivo: string; mensagem: string }[] = [];
  const noLote = new Map<string, string>();
  // Duplicata de outra foto do mesmo lote que ainda está sendo registrada: resolvida no fim.
  const duplicadasNoLote: { caminho: string; sha: string }[] = [];

  await emParalelo(brutos, 3, async (bruto, i) => {
    const caminho = caminhoDeOriginalValido(clientId, bruto);
    if (!caminho) {
      recusadas.push({ caminho: String(bruto ?? "").slice(0, 400), motivo: "caminho_invalido", mensagem: `O caminho precisa começar com ${clientId}/foto/originais/.` });
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = await baixar("mesa", caminho);
    } catch (e) {
      recusadas.push({ caminho, motivo: e instanceof ErroHttp ? e.codigo : "arquivo_indisponivel", mensagem: e instanceof Error ? e.message : "Arquivo indisponível." });
      return;
    }
    const mime = mimeDe(bytes);
    if (!mime) {
      recusadas.push({ caminho, motivo: "tipo_nao_suportado", mensagem: "Envie JPEG, PNG ou WebP (HEIC, GIF e outros formatos não entram)." });
      return;
    }
    let dim = dimensoesDaImagem(bytes);
    if (!dim) {
      try {
        dim = await dimensoesDecodificando(bytes);
      } catch {
        recusadas.push({ caminho, motivo: "imagem_corrompida", mensagem: "Não foi possível abrir esta imagem." });
        return;
      }
    }
    const sha = await sha256Hex(bytes);
    // Duplicata exata (mesmo conteúdo): não cria outra linha; a cópia recém enviada sai do bucket.
    const doLote = noLote.get(sha);
    if (doLote) {
      if (doLote === "pendente") duplicadasNoLote.push({ caminho, sha });
      else duplicadas.push({ caminho, imagem_id: doLote });
      await servico().storage.from("mesa").remove([caminho]).catch(() => {});
      return;
    }
    // Marca antes de qualquer espera: outra foto igual do lote não passa daqui.
    noLote.set(sha, "pendente");
    const { data: existente } = await servico().from("cliente_imagens").select("id, storage_path").eq("client_id", clientId).eq("sha256", sha).limit(1);
    const achada = ((existente as { id: string; storage_path: string }[] | null) ?? [])[0] ?? null;
    if (achada) {
      noLote.set(sha, achada.id);
      duplicadas.push({ caminho, imagem_id: achada.id });
      if (achada.storage_path !== caminho) await servico().storage.from("mesa").remove([caminho]).catch(() => {});
      return;
    }
    const { data, error } = await servico().from("cliente_imagens").insert({
      client_id: clientId,
      origem: "mesa_foto",
      storage_bucket: "mesa",
      storage_path: caminho,
      nome: nomeDoArquivo(caminho, nomes[i]),
      pasta: "Mesa Foto / Originais",
      categoria: null,
      tags: ["mesa_foto", "original"],
      sha256: sha,
      largura: dim.largura,
      altura: dim.altura,
      gerada: false,
      aprovada: false,
      modo: null,
      derivada_de: null,
    }).select(CAMPOS_IMAGEM).single();
    if (error || !data) {
      // Corrida com outra chamada que registrou o mesmo conteúdo (índice único por sha256).
      if ((error as { code?: string } | null)?.code === "23505") {
        const { data: outra } = await servico().from("cliente_imagens").select("id").eq("client_id", clientId).eq("sha256", sha).limit(1);
        const id = ((outra as { id: string }[] | null) ?? [])[0]?.id;
        if (id) {
          noLote.set(sha, id);
          duplicadas.push({ caminho, imagem_id: id });
          return;
        }
      }
      recusadas.push({ caminho, motivo: "registro_falhou", mensagem: "A foto subiu, mas o registro no acervo falhou. Tente de novo." });
      return;
    }
    noLote.set(sha, (data as LinhaImagem).id);
    imagens.push(await comUrl(data as LinhaImagem));
  });
  for (const d of duplicadasNoLote) {
    const id = noLote.get(d.sha);
    if (id && id !== "pendente") duplicadas.push({ caminho: d.caminho, imagem_id: id });
    else recusadas.push({ caminho: d.caminho, motivo: "duplicada_no_lote", mensagem: "Foto repetida no mesmo envio; a primeira não entrou no acervo. Envie de novo." });
  }
  return json({ imagens, duplicadas, recusadas, custo_usd: 0 });
}

async function acervoLerFoto(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const imagem = await lerImagem(clientId, idDe(corpo.imagem_id, "imagem_id"));
  const foto = await baixarReduzida(imagem.storage_bucket, imagem.storage_path, LADO_VISAO, imagem.nome);
  const leitor = await modeloDeTexto("leitura", corpo.modelo_id);
  const saida = await chamarTexto({
    clientId,
    tarefa: TAREFA_LEITURA,
    agente: AGENTE_LEITOR,
    modeloId: leitor.id,
    sistema: SISTEMA_LEITOR,
    mensagens: [{ papel: "usuario", conteudo: `Leia esta foto do acervo (nome do arquivo: ${imagem.nome}).`, imagens: [foto] }],
    esquemaJson: ESQUEMA_LEITURA,
    maxTokensSaida: 4_000,
    timeoutMs: TIMEOUT_TEXTO_FOTO_MS,
    referencia: { tipo: REF_IMAGEM, id: imagem.id },
    criadoPor: ch.userId,
  });
  const r = (saida.json ?? {}) as Record<string, unknown>;
  const q = (r.qualidade ?? {}) as Record<string, unknown>;
  const s = (r.sugestao ?? {}) as Record<string, unknown>;
  const tipo = TIPOS_DE_KIT.includes(s.tipo as TipoKit) ? (s.tipo as TipoKit) : "outro";
  const papel = PAPEIS.includes(s.papel as typeof PAPEIS[number]) ? String(s.papel) : "identidade";
  const leitura = {
    descricao: limpo(r.descricao, 1000),
    observado: listaDeTextos(r.observado, 20, 200),
    texto_lido: typeof r.texto_lido === "string" ? r.texto_lido.slice(0, 2000) : "",
    qualidade: {
      nitidez: limpo(q.nitidez, 20) || "aceitavel",
      luz: limpo(q.luz, 20) || "aceitavel",
      enquadramento: limpo(q.enquadramento, 20) || "aceitavel",
      problemas: listaDeTextos(q.problemas, 10, 200),
    },
    sugestao: {
      tipo,
      nome: limpo(s.nome, 120),
      papel,
      vista: typeof s.vista === "string" && NOMES_DAS_VISTAS.includes(s.vista) ? s.vista : null,
    },
  };
  // Grava a leitura em descricao e tags (sem apagar as tags que a equipe pôs).
  const novasTags = [`tipo:${tipo}`, `papel:${papel}`, ...leitura.observado.slice(0, 6).map((o) => o.toLowerCase().slice(0, 60))];
  const tags = Array.from(new Set([...(imagem.tags ?? []).filter((t) => !/^tipo:|^papel:/.test(t)), ...novasTags])).slice(0, 30);
  await servico().from("cliente_imagens").update({
    descricao: leitura.descricao || imagem.descricao,
    tags,
    ...(imagem.categoria ? {} : { categoria: categoriaDoAcervo(tipo) }),
  }).eq("id", imagem.id).eq("client_id", clientId);
  return json({ imagem_id: imagem.id, ...leitura, custo_usd: saida.custoUsd, saldo_usd: saida.saldoUsd, reserva_usada: saida.reservaUsada ?? null });
}

async function acervoDecidir(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const imagem = await lerImagem(clientId, idDe(corpo.imagem_id, "imagem_id"));
  const decisao = String(corpo.decisao ?? "");
  if (decisao !== "aprovar" && decisao !== "rejeitar") throw new ErroHttp(400, "decisao_invalida", "decisao: aprovar ou rejeitar.");
  const { data, error } = await servico().from("cliente_imagens").update({ aprovada: decisao === "aprovar" })
    .eq("id", imagem.id).eq("client_id", clientId).select(CAMPOS_IMAGEM).single();
  if (error || !data) throw new ErroHttp(503, "gravacao_falhou", "Não foi possível gravar a decisão.");
  return json({ imagem: await comUrl(data as LinhaImagem), custo_usd: 0 });
}

// ------------------------------------------------------------------ kits

async function kitSugerir(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const ids = Array.isArray(corpo.imagem_ids) ? Array.from(new Set(corpo.imagem_ids.map(String))) : [];
  if (!ids.length) throw new ErroHttp(400, "sem_imagens", "Escolha as fotos para montar o kit.");
  if (ids.length > MAX_FOTOS_KIT_SUGERIR) throw new ErroHttp(400, "fotos_demais", `Escolha no máximo ${MAX_FOTOS_KIT_SUGERIR} fotos por sugestão.`);
  const imagens = await lerImagens(clientId, ids);
  const faltando = ids.filter((i) => !imagens.some((x) => x.id === i));
  if (faltando.length) throw new ErroHttp(404, "imagem_fora_do_cliente", "Há foto que não está no acervo deste cliente.", { imagem_ids: faltando });
  const ordem = ids.map((i) => imagens.find((x) => x.id === i)!);
  const fotos = await emParalelo(ordem, 4, (img) => baixarReduzida(img.storage_bucket, img.storage_path, 768, img.nome));
  const leitor = await modeloDeTexto("leitura", corpo.modelo_id);
  const legenda = ordem.map((img, i) =>
    `Imagem ${i + 1}: id ${img.id}; arquivo "${img.nome}"${img.descricao ? `; leitura anterior: ${limpo(img.descricao, 300)}` : ""}${img.gerada ? "; IMAGEM GERADA (não é evidência)" : ""}${
      (img.tags ?? []).includes(TAG_REFERENCIA_WEB) ? "; REFERÊNCIA DA INTERNET (foto oficial ou de loja do produto, uso interno)" : ""
    }`
  ).join("\n");
  const saida = await chamarTexto({
    clientId,
    tarefa: TAREFA_LEITURA,
    agente: AGENTE_LEITOR,
    modeloId: leitor.id,
    raciocinio: raciocinioPara(leitor),
    sistema: SISTEMA_KITS,
    mensagens: [{ papel: "usuario", conteudo: `Organize estas ${ordem.length} fotos em kits.\n${legenda}`, imagens: fotos }],
    esquemaJson: ESQUEMA_KITS,
    maxTokensSaida: 8_000,
    timeoutMs: TIMEOUT_TEXTO_FOTO_MS,
    referencia: { tipo: REF_IMAGEM, id: ordem[0].id },
    criadoPor: ch.userId,
  });
  const r = (saida.json ?? {}) as Record<string, unknown>;
  const validos = new Set(ids);
  const kits: unknown[] = [];
  for (const bruto of Array.isArray(r.kits) ? r.kits : []) {
    const k = (bruto ?? {}) as Record<string, unknown>;
    let kit: KitFoto;
    try {
      kit = normalizarKit({ ...k, atributos: { ...((k.atributos as Record<string, unknown>) ?? {}), informado: [] }, status: "rascunho" });
    } catch {
      continue;
    }
    const refs = (Array.isArray(k.refs) ? k.refs : [])
      .filter((x) => x && typeof x === "object" && validos.has(String((x as Record<string, unknown>).imagem_id)))
      .map((x) => ({ ...(x as Record<string, unknown>), prioridade: 100 }));
    let refsOk: RefDoKit[] = [];
    try {
      refsOk = normalizarRefs(refs);
    } catch {
      refsOk = [];
    }
    // Imagem gerada não aprovada nunca entra como evidência na sugestão.
    refsOk = refsOk.map((ref) => {
      const img = imagens.find((x) => x.id === ref.imagem_id);
      return img?.gerada && !img.aprovada && ref.papel !== "estilo" && ref.papel !== "cenario" ? { ...ref, papel: "estilo" as const } : ref;
    });
    const lacunas = [...kit.lacunas];
    if (kit.tipo !== "pessoa" && !refsOk.some((x) => x.papel === "identidade") && refsOk.some((x) => x.papel === "embalagem")) {
      lacunas.unshift("Falta foto do produto fora da embalagem: a caixa sozinha não documenta o produto.");
    }
    if (kit.tipo === "pessoa") lacunas.unshift("Registrar a autorização de uso de imagem da pessoa antes de gerar.");
    kits.push({ ...kit, lacunas: Array.from(new Set(lacunas)).slice(0, 20), refs: refsOk, perguntas: listaDeTextos(k.perguntas, 10, 300) });
  }
  const naoAgrupadas = (Array.isArray(r.nao_agrupadas) ? r.nao_agrupadas : [])
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .filter((x) => validos.has(String(x.imagem_id)))
    .map((x) => ({ imagem_id: String(x.imagem_id), motivo: limpo(x.motivo, 300) }));
  // v2: sugestão vira kit salvo (rascunho). Kit rascunho do mesmo produto é
  // atualizado (as referências da internet de produto_identificar ficam).
  const refsWeb = imagens.filter((i) => (i.tags ?? []).includes(TAG_REFERENCIA_WEB)).map((i) => i.id);
  const salvos: unknown[] = [];
  const falhas: string[] = [];
  for (const bruto of kits as (KitFoto & { refs: RefDoKit[]; perguntas: string[] })[]) {
    if (bruto.tipo === "pessoa" || !bruto.refs.length) {
      // Kit de pessoa só salva com a autorização registrada pela equipe (kit_salvar).
      salvos.push({ ...bruto, id: null, salvo: false, motivo_nao_salvo: bruto.tipo === "pessoa" ? "autorizacao_pendente" : "sem_referencias" });
      continue;
    }
    try {
      const { perguntas, ...kit } = bruto;
      const r2 = await salvarKitRascunho(ch, clientId, kit, { refsWeb });
      salvos.push({ ...(await kitComRefs(r2.kit)), perguntas, salvo: true, acao: r2.acao });
    } catch (e) {
      falhas.push(e instanceof Error ? e.message : "falha ao salvar");
      salvos.push({ ...bruto, id: null, salvo: false, motivo_nao_salvo: "gravacao_falhou" });
    }
  }
  return json({
    kits: salvos,
    kit_ids: salvos.map((k) => (k as { id?: string | null }).id).filter((x): x is string => !!x),
    nao_agrupadas: naoAgrupadas,
    aviso: falhas.length ? `Nem todo kit sugerido foi salvo: ${falhas.join("; ")}` : null,
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    reserva_usada: saida.reservaUsada ?? null,
  });
}

/** Kits do cliente (menos os arquivados) com as referências, para achar o mesmo produto. */
async function kitsDoCliente(clientId: string): Promise<KitExistente[]> {
  const { data, error } = await servico().from("foto_kits").select("id, status, nome, variante, tipo, atualizado_em")
    .eq("client_id", clientId).neq("status", "arquivado").order("atualizado_em", { ascending: false }).limit(200);
  if (error) throw new ErroHttp(503, "kit_indisponivel", "Não foi possível ler os kits do cliente.");
  const kits = (data as (KitExistente & { tipo: string })[] | null) ?? [];
  if (!kits.length) return [];
  const { data: refs } = await servico().from("foto_kit_refs").select("kit_id, imagem_id, papel").in("kit_id", kits.map((k) => k.id));
  const lista = (refs as { kit_id: string; imagem_id: string; papel: string }[] | null) ?? [];
  return kits.map((k) => ({ ...k, refs: lista.filter((r) => r.kit_id === k.id) }));
}

/**
 * Grava o kit e troca o conjunto de referências (o enviado substitui o
 * anterior). Usado por kit_salvar, kit_sugerir e produto_identificar.
 */
async function gravarKit(ch: Chamador, clientId: string, kit: KitFoto, refs: RefDoKit[], anteriorId: string | null): Promise<LinhaKit> {
  const campos = {
    client_id: clientId,
    tipo: kit.tipo,
    nome: kit.nome,
    variante: kit.variante,
    atributos: kit.atributos,
    invariantes: kit.invariantes,
    lacunas: kit.lacunas,
    autorizacao: kit.autorizacao,
    frente_imagem_id: kit.frente_imagem_id && refs.some((r) => r.imagem_id === kit.frente_imagem_id) ? kit.frente_imagem_id : null,
    status: kit.status,
  };
  const gravado = anteriorId
    ? await servico().from("foto_kits").update(campos).eq("id", anteriorId).eq("client_id", clientId).select("*").single()
    : await servico().from("foto_kits").insert({ ...campos, criado_por: ch.userId }).select("*").single();
  if (gravado.error || !gravado.data) throw new ErroHttp(503, "gravacao_falhou", "Não foi possível gravar o kit.");
  const salvo = gravado.data as LinhaKit;
  const { data: atuais } = await servico().from("foto_kit_refs").select("id, imagem_id, papel").eq("kit_id", salvo.id);
  const manter = new Set(refs.map((r) => `${r.imagem_id}|${r.papel}`));
  const remover = ((atuais as { id: string; imagem_id: string; papel: string }[] | null) ?? []).filter((a) => !manter.has(`${a.imagem_id}|${a.papel}`)).map((a) => a.id);
  if (remover.length) await servico().from("foto_kit_refs").delete().in("id", remover);
  if (refs.length) {
    const { error } = await servico().from("foto_kit_refs").upsert(
      refs.map((r) => ({ kit_id: salvo.id, client_id: clientId, imagem_id: r.imagem_id, papel: r.papel, vista: r.vista, prioridade: r.prioridade })),
      { onConflict: "kit_id,imagem_id,papel" },
    );
    if (error) throw new ErroHttp(503, "gravacao_falhou", "O kit foi salvo, mas as referências não. Tente de novo.");
  }
  return salvo;
}

/** O kit gravado com as referências e a URL assinada de cada foto (como kit_salvar devolve). */
async function kitComRefs(kit: LinhaKit) {
  // O acesso ao cliente já foi conferido pela ação que chamou.
  const lido = await lerKitSemConferir(kit.id);
  const refs = await lerRefs(lido);
  return {
    ...lido,
    refs: await Promise.all(refs.map(async ({ imagem, ...r }) => ({ ...r, imagem: await comUrl(imagem) }))),
  };
}

/**
 * Salva o kit sugerido como rascunho sem duplicar: rascunho do mesmo produto
 * (nome e variante, ou foto de evidência em comum) é atualizado; kit
 * confirmado do mesmo produto não é tocado.
 */
async function salvarKitRascunho(
  ch: Chamador,
  clientId: string,
  novo: KitFoto & { refs: RefDoKit[] },
  opcoes: { preferirNomeNovo?: boolean; refsWeb?: string[] } = {},
): Promise<{ kit: LinhaKit; acao: "criado" | "atualizado" | "ja_confirmado" }> {
  const imagens = await lerImagens(clientId, novo.refs.map((r) => r.imagem_id));
  // Imagem gerada sem aprovação nunca vira evidência; foto fora do cliente sai.
  const refs = novo.refs
    .filter((r) => imagens.some((i) => i.id === r.imagem_id))
    .map((r) => {
      const i = imagens.find((x) => x.id === r.imagem_id)!;
      return i.gerada && !i.aprovada && r.papel !== "estilo" && r.papel !== "cenario" ? { ...r, papel: "estilo" as const } : r;
    });
  const existentes = await kitsDoCliente(clientId);
  const alvo = { ...novo, refs };
  const achado = kitParecido(existentes, alvo);
  if (!achado) {
    const confirmado = existentes.find((k) => k.status === "confirmado" && chaveDoProduto(k) === chaveDoProduto(alvo));
    if (confirmado) return { kit: await lerKit(ch, confirmado.id), acao: "ja_confirmado" };
    const kit = { ...alvo, status: "rascunho" as const, lacunas: lacunasDaEvidencia(alvo, refs, opcoes.refsWeb ?? []) };
    return { kit: await gravarKit(ch, clientId, kit, refs, null), acao: "criado" };
  }
  const anterior = await lerKit(ch, achado.id);
  const refsAnteriores = (await lerRefs(anterior)).map(({ imagem: _i, ...r }) => r);
  const mesclado = mesclarKit({ ...anterior, refs: refsAnteriores }, alvo, opcoes);
  return { kit: await gravarKit(ch, clientId, mesclado, mesclado.refs, anterior.id), acao: "atualizado" };
}

async function kitSalvar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const kit = normalizarKit(corpo.kit);
  const refs = normalizarRefs(corpo.refs);
  const imagens = await lerImagens(clientId, refs.map((r) => r.imagem_id));
  conferirRefs(refs, clientId, imagens as ImagemDoAcervo[]);
  if (kit.frente_imagem_id && !refs.some((r) => r.imagem_id === kit.frente_imagem_id)) {
    throw new ErroHttp(400, "frente_fora_do_kit", "A foto da frente precisa estar entre as referências do kit.");
  }
  let anterior: LinhaKit | null = null;
  let atualizouRascunho = false;
  if (kit.id) {
    anterior = await lerKit(ch, kit.id);
    if (anterior.client_id !== clientId) throw new ErroHttp(409, "kit_de_outro_cliente", "Este kit pertence a outro cliente.");
  } else if (kit.tipo !== "pessoa") {
    // Kit novo do mesmo produto de um rascunho que já existe (ex.: a sugestão já
    // salva aberta de novo na tela): atualiza o rascunho em vez de duplicar.
    const parecido = kitParecido(await kitsDoCliente(clientId), { nome: kit.nome, variante: kit.variante, refs });
    if (parecido) {
      anterior = await lerKit(ch, parecido.id);
      atualizouRascunho = true;
    }
  }
  // A identificação pela internet não se perde quando a tela salva sem ela.
  if (!kit.atributos.identificacao && anterior?.atributos.identificacao) {
    kit.atributos = { ...kit.atributos, identificacao: anterior.atributos.identificacao };
  }
  // Autorização de pessoa: quem confirmou e quando ficam registrados pelo servidor.
  let autorizacao = kit.autorizacao;
  if (autorizacao?.confirmada) {
    const ja = anterior?.autorizacao?.confirmada === true;
    autorizacao = {
      ...autorizacao,
      registrada_por: ja ? anterior!.autorizacao!.registrada_por ?? ch.userId : ch.userId,
      registrada_em: ja ? anterior!.autorizacao!.registrada_em ?? new Date().toISOString() : new Date().toISOString(),
    };
  }
  // Referências: o conjunto enviado substitui o anterior (gravarKit).
  const salvo = await gravarKit(ch, clientId, { ...kit, autorizacao }, refs, anterior?.id ?? null);
  const refsLidas = await lerRefs(salvo);
  return json({
    kit: salvo,
    refs: await Promise.all(refsLidas.map(async ({ imagem, ...r }) => ({ ...r, imagem: await comUrl(imagem) }))),
    atualizou_rascunho_existente: atualizouRascunho,
    custo_usd: 0,
  });
}

// ------------------------------------------------------------------ identificar o produto

type ReferenciaWebBaixada = { imagem_id: string; url_origem: string; pagina: string | null; fonte: string; url: string | null; ja_existia: boolean };

/** Página pública (https, sem host interno), só texto HTML, até 2 MB. */
async function lerPagina(url: string): Promise<{ url: string; html: string } | null> {
  const r = await buscarSeguro(url, { maxBytes: MAX_BYTES_PAGINA, aceitar: "text/html,application/xhtml+xml", timeoutMs: TIMEOUT_PAGINA_MS });
  if (!r || !/html|xml|text\/plain/.test(r.tipo || "text/html")) return null;
  return { url: r.url.toString(), html: new TextDecoder().decode(r.bytes) };
}

/**
 * Baixa uma imagem de referência da internet para mesa/<cliente>/foto/web/:
 * só https público, tipo validado pelo conteúdo (JPEG, PNG, WebP), tamanho
 * mínimo (nada de ícone ou logotipo) e sem duplicar (sha256 do cliente).
 */
async function baixarReferenciaWeb(clientId: string, alvo: OrigemWeb, produto: string): Promise<ReferenciaWebBaixada | null> {
  const buscado = await buscarSeguro(alvo.url, { maxBytes: MAX_BYTES_REFERENCIA, aceitar: "image/avif,image/webp,image/png,image/jpeg,image/*", timeoutMs: 10_000 });
  if (!buscado) return null;
  const mime = mimeDe(buscado.bytes);
  if (!mime) return null;
  let dim = dimensoesDaImagem(buscado.bytes);
  if (!dim) dim = await dimensoesDecodificando(buscado.bytes).catch(() => null);
  if (!referenciaWebServe(dim)) return null;
  const sha = await sha256Hex(buscado.bytes);
  const { data: ja } = await servico().from("cliente_imagens").select(CAMPOS_IMAGEM).eq("client_id", clientId).eq("sha256", sha).limit(1);
  const existente = ((ja as LinhaImagem[] | null) ?? [])[0];
  const origem: OrigemWeb = { url: buscado.url.toString(), pagina: alvo.pagina, fonte: alvo.fonte || buscado.url.hostname };
  if (existente) {
    return { imagem_id: existente.id, url_origem: origem.url, pagina: origem.pagina, fonte: origem.fonte, url: await urlAssinada(existente.storage_bucket, existente.storage_path), ja_existia: true };
  }
  const caminho = `${clientId}/foto/web/${crypto.randomUUID()}.${extensaoDe(mime)}`;
  await salvarNoMesa(caminho, buscado.bytes, mime);
  const host = buscado.url.hostname.replace(/^www\./, "").slice(0, 60);
  const { data, error } = await servico().from("cliente_imagens").insert({
    client_id: clientId,
    origem: "mesa_foto",
    storage_bucket: "mesa",
    storage_path: caminho,
    nome: `Ref. internet: ${produto} (${host})`.slice(0, 160),
    pasta: "Mesa Foto / Referências da internet",
    categoria: "produto",
    tags: ["mesa_foto", TAG_REFERENCIA_WEB, `fonte:${host}`, "nao_publicar"],
    descricao: descricaoDaReferenciaWeb(origem, produto),
    sha256: sha,
    largura: dim!.largura,
    altura: dim!.altura,
    gerada: false,
    aprovada: false,
    modo: null,
    derivada_de: null,
  }).select(CAMPOS_IMAGEM).single();
  if (error || !data) {
    await servico().storage.from("mesa").remove([caminho]).catch(() => {});
    return null;
  }
  return { imagem_id: (data as LinhaImagem).id, url_origem: origem.url, pagina: origem.pagina, fonte: origem.fonte, url: await urlAssinada("mesa", caminho), ja_existia: false };
}

/**
 * produto_identificar { client_id, imagem_ids[], salvar_kit? (padrão true), modelo_id? }
 * -> { produto, referencias_web, lacunas, proximo_passo, kit, aviso_jev, custo_usd, saldo_usd }
 *
 * Visão lê a embalagem ou a foto (marca, modelo, variante, códigos), a
 * pesquisa web acha o produto real (página oficial, especificações, imagens),
 * até 6 imagens entram no acervo como referência da internet (uso interno) e
 * o kit rascunho do produto é salvo (ou atualizado) com elas como identidade.
 * O Jev só avisa quando há dúvida entre candidatos de modelo.
 */
async function produtoIdentificar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const ids = Array.isArray(corpo.imagem_ids) ? Array.from(new Set(corpo.imagem_ids.map(String))) : [];
  if (!ids.length) throw new ErroHttp(400, "sem_imagens", "Escolha as fotos da embalagem ou do produto.");
  if (ids.length > MAX_FOTOS_IDENTIFICAR) throw new ErroHttp(400, "fotos_demais", `Escolha no máximo ${MAX_FOTOS_IDENTIFICAR} fotos para identificar o produto.`);
  const imagens = await lerImagens(clientId, ids);
  const faltando = ids.filter((i) => !imagens.some((x) => x.id === i));
  if (faltando.length) throw new ErroHttp(404, "imagem_fora_do_cliente", "Há foto que não está no acervo deste cliente.", { imagem_ids: faltando });
  const ordem = ids.map((i) => imagens.find((x) => x.id === i)!);
  const fotos = await emParalelo(ordem, 3, (img) => baixarReduzida(img.storage_bucket, img.storage_path, LADO_VISAO, img.nome));
  const leitor = await modeloDeTexto("leitura", corpo.modelo_id);
  const legenda = ordem.map((img, i) => `Imagem ${i + 1}: id ${img.id}; arquivo "${img.nome}"${img.descricao ? `; leitura anterior: ${limpo(img.descricao, 300)}` : ""}`).join("\n");
  const pedido = limpo(corpo.pedido, 500);
  const saida = await chamarTexto({
    clientId,
    tarefa: TAREFA_LEITURA,
    agente: AGENTE_LEITOR,
    modeloId: leitor.id,
    raciocinio: raciocinioPara(leitor),
    sistema: SISTEMA_IDENTIFICAR,
    mensagens: [{
      papel: "usuario",
      conteudo: `Identifique o produto destas ${ordem.length} fotos e pesquise o produto real na internet.\n${legenda}${pedido ? `\nPedido da equipe (pode estar ditado errado; vale o que as fotos mostram): ${pedido}` : ""}`,
      imagens: fotos,
    }],
    pesquisaWeb: true,
    esquemaJson: ESQUEMA_IDENTIFICACAO,
    maxTokensSaida: 8_000,
    timeoutMs: TIMEOUT_TEXTO_FOTO_MS,
    referencia: { tipo: REF_IMAGEM, id: ordem[0].id },
    criadoPor: ch.userId,
  });
  let custo = saida.custoUsd;
  const r = (saida.json ?? {}) as Record<string, unknown>;
  const p = (r.produto ?? {}) as Record<string, unknown>;
  const paginas = (Array.isArray(r.paginas) ? r.paginas : [])
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .map((x) => ({ url: urlPublicaSegura(x.url)?.toString() ?? null, fonte: limpo(x.fonte, 120), tipo: String(x.tipo ?? "outra") }))
    .filter((x): x is { url: string; fonte: string; tipo: string } => !!x.url)
    .sort((a, b) => Number(b.tipo === "oficial") - Number(a.tipo === "oficial") || Number(b.tipo === "loja") - Number(a.tipo === "loja"))
    .slice(0, 8);
  const identificacao: Identificacao | null = normalizarIdentificacao({
    marca: p.marca,
    modelo: p.modelo,
    variante: p.variante,
    categoria: p.categoria,
    especificacoes: p.especificacoes,
    confianca: p.confianca,
    evidencias: p.evidencias,
    paginas,
    identificado_em: new Date().toISOString(),
  });
  const nomeProduto = identificacao ? [identificacao.marca, identificacao.modelo].filter(Boolean).join(" ") : "";
  const lacunas = listaDeTextos(r.lacunas, 12, 300);

  // Candidatas a referência: as que o modelo viu na busca e as da própria página (og:image, JSON-LD).
  const candidatas: OrigemWeb[] = [];
  const somar = (url: unknown, pagina: string | null, fonte: string) => {
    const u = urlPublicaSegura(url);
    if (u && !candidatas.some((c) => c.url === u.toString())) candidatas.push({ url: u.toString(), pagina, fonte: fonte || u.hostname });
  };
  for (const x of Array.isArray(r.imagens) ? r.imagens : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    somar(o.url, urlPublicaSegura(o.pagina)?.toString() ?? null, limpo(o.fonte, 120));
  }
  if (identificacao) {
    const lidas = await emParalelo(paginas.slice(0, MAX_PAGINAS_LIDAS), 3, (pg) => lerPagina(pg.url).catch(() => null));
    lidas.forEach((l, i) => {
      if (l) imagensDoHtml(l.html, l.url, 4).forEach((u) => somar(u, paginas[i].url, paginas[i].fonte));
    });
  }
  // Tempo: 300 s da leitura com busca + páginas (12 s) + 3 rodadas de download (10 s) cabem nos 400 s da função.
  const referencias: ReferenciaWebBaixada[] = [];
  if (identificacao && candidatas.length) {
    const baixadas = await emParalelo(candidatas.slice(0, 9), 3, (c) => baixarReferenciaWeb(clientId, c, nomeProduto || "produto").catch(() => null));
    baixadas.forEach((b) => {
      if (b && referencias.length < MAX_REFERENCIAS_WEB && !referencias.some((x) => x.imagem_id === b.imagem_id)) referencias.push(b);
    });
  }
  if (!identificacao) lacunas.unshift("A leitura não identificou marca nem modelo: o kit fica com a embalagem como assunto até a equipe informar o produto.");
  else if (!referencias.length) lacunas.unshift("Nenhuma foto do produto fora da caixa foi confirmada na internet: o ensaio trabalha com a embalagem até chegar foto real.");
  if (identificacao && identificacao.confianca !== "alta") {
    lacunas.unshift(`Modelo ou variante com confiança ${identificacao.confianca}: confirme com o cliente antes de publicar.`);
  }

  // Jev só como aviso: com mais de um candidato, ele diz qual bate com o texto lido.
  let avisoJev: { escolha: string | null; confianca: number | null; concorda: boolean | null; aviso: string | null } | { erro: string } | null = null;
  const candidatos = (Array.isArray(r.candidatos) ? r.candidatos : [])
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .map((x) => [limpo(x.marca, 80), limpo(x.modelo, 120), limpo(x.variante, 80)].filter(Boolean).join(" "))
    .filter((x, i, a) => x && a.indexOf(x) === i)
    .slice(0, 6);
  const escolhido = [nomeProduto, identificacao?.variante ?? ""].filter(Boolean).join(" ");
  const opcoes = Array.from(new Set([escolhido, ...candidatos].filter(Boolean)));
  if (identificacao && opcoes.length >= 2) {
    try {
      const criterios: Record<string, unknown> = {};
      opcoes.forEach((o, i) => (criterios[`c${i}`] = o));
      criterios.nenhum = "Nenhum dos candidatos bate com o texto lido na embalagem.";
      const res = await jevPerguntar({
        state: { texto_lido: limpo(r.texto_lido, 2000), observado: listaDeTextos(r.observado, 20, 200), evidencias_da_busca: identificacao.evidencias },
        questions: {
          modelo: {
            type: "choice",
            instructions: "Qual candidato de produto (marca, modelo e variante) bate com o texto lido na embalagem em `texto_lido`, com o que se vê em `observado` e com as evidências da busca?",
            criteria: criterios,
          },
        },
      });
      const cobrado = await cobrarJev(res, { clientId, tarefa: TAREFA_LEITURA, referencia: { tipo: REF_IMAGEM, id: ordem[0].id }, criadoPor: ch.userId });
      if (cobrado) custo += cobrado.custoUsd;
      const resposta = res.answers.modelo;
      const escolha = typeof resposta?.choice === "string" ? resposta.choice : null;
      const confianca = typeof resposta?.confidence === "number" ? resposta.confidence : null;
      const concorda = escolha ? escolha === "c0" : null;
      const nomeEscolha = escolha && escolha !== "nenhum" ? opcoes[Number(escolha.slice(1))] ?? null : escolha;
      avisoJev = {
        escolha: nomeEscolha,
        confianca,
        concorda,
        aviso: concorda === false || (confianca != null && confianca < 0.6)
          ? `O Jev ${concorda === false ? `aponta outro candidato (${nomeEscolha})` : "ficou em dúvida entre os candidatos"}: confira modelo e variante antes de usar.`
          : null,
      };
      if (avisoJev.aviso) lacunas.unshift(avisoJev.aviso);
    } catch (e) {
      avisoJev = { erro: e instanceof JevErro ? e.codigo : "jev_indisponivel" };
    }
  }

  // Kit rascunho do produto: fotos lidas (caixa como embalagem) e referências da internet como identidade.
  let kit: unknown = null;
  let acaoKit: string | null = null;
  if (corpo.salvar_kit !== false) {
    const porFoto = new Map((Array.isArray(r.fotos) ? r.fotos : []).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return [String(o.imagem_id), o] as const;
    }));
    const refs: RefDoKit[] = [
      ...ordem.map((img, i) => {
        const f = porFoto.get(img.id);
        const web = (img.tags ?? []).includes(TAG_REFERENCIA_WEB);
        const vista = typeof f?.vista === "string" && NOMES_DAS_VISTAS.includes(f.vista) ? f.vista : null;
        return { imagem_id: img.id, papel: (f?.e_embalagem === false || web ? "identidade" : "embalagem") as RefDoKit["papel"], vista, prioridade: 10 + i };
      }),
      ...referencias.map((ref, i) => ({ imagem_id: ref.imagem_id, papel: "identidade" as const, vista: null, prioridade: 50 + i })),
    ];
    const tipo = TIPOS_DE_KIT.includes(p.tipo_kit as TipoKit) && p.tipo_kit !== "pessoa" ? (p.tipo_kit as TipoKit) : "produto";
    const forma = listaDeTextos(p.forma_do_produto, 12, 200);
    const novo: KitFoto & { refs: RefDoKit[] } = {
      tipo,
      nome: limpo(nomeProduto, 120) || limpo(ordem[0].nome, 120) || "Produto",
      variante: identificacao?.variante ?? null,
      atributos: {
        observado: listaDeTextos(r.observado, 20, 300),
        informado: [],
        inferido: [
          ...(identificacao?.especificacoes ?? []).map((s) => `Pela internet: ${s}`),
          ...forma.map((s) => `Forma pela internet: ${s}`),
        ].slice(0, 30),
        ...(identificacao ? { identificacao } : {}),
      },
      invariantes: [],
      lacunas,
      autorizacao: null,
      frente_imagem_id: null,
      status: "rascunho",
      refs,
    };
    try {
      const salvo = await salvarKitRascunho(ch, clientId, novo, { preferirNomeNovo: !!identificacao, refsWeb: referencias.map((x) => x.imagem_id) });
      kit = await kitComRefs(salvo.kit);
      acaoKit = salvo.acao;
    } catch (e) {
      lacunas.unshift(`O kit não foi salvo: ${e instanceof Error ? e.message : "falha ao gravar"}. As referências já estão no acervo.`);
    }
  }
  const temRefs = referencias.length > 0;
  const proximo = limpo(r.proximo_passo, 400) ||
    (temRefs
      ? `Produto identificado com ${referencias.length} ${referencias.length === 1 ? "referência" : "referências"} da internet. Próximo: planejar variações fora da caixa.`
      : "Próximo: planejar as fotos com a embalagem como assunto, ou subir uma foto real do produto.");
  return json({
    produto: {
      marca: identificacao?.marca ?? null,
      modelo: identificacao?.modelo ?? null,
      variante: identificacao?.variante ?? null,
      categoria: identificacao?.categoria ?? null,
      especificacoes: identificacao?.especificacoes ?? [],
      confianca: identificacao?.confianca ?? "baixa",
      evidencias: identificacao?.evidencias ?? [],
      texto_lido: typeof r.texto_lido === "string" ? r.texto_lido.slice(0, 2000) : "",
      paginas,
    },
    referencias_web: referencias.map(({ imagem_id, url_origem, pagina, fonte, url, ja_existia }) => ({ imagem_id, url_origem, pagina, fonte, url, ja_existia })),
    aviso_referencias: temRefs ? AVISO_REFERENCIA_WEB : null,
    lacunas: Array.from(new Set(lacunas)).slice(0, 15),
    proximo_passo: proximo,
    kit,
    kit_acao: acaoKit,
    aviso_jev: avisoJev,
    promessa: temRefs ? PROMESSA_REFERENCIA_WEB : null,
    custo_usd: arred6(custo),
    saldo_usd: saida.saldoUsd,
    reserva_usada: saida.reservaUsada ?? null,
  });
}

// ------------------------------------------------------------------ receitas e estimativa

function receitas() {
  return json({
    versao: VERSAO_RECEITAS,
    receitas: RECEITAS,
    presets: PRESETS,
    azimutes: AZIMUTES,
    elevacoes: ELEVACOES,
    enquadramentos: ENQUADRAMENTOS,
    tipos_de_kit: TIPOS_DE_KIT,
    papeis: PAPEIS,
    vistas: NOMES_DAS_VISTAS,
    formatos: FORMATOS,
    modos_preparar: MODOS_PREPARAR,
    promessas: { ...PROMESSA_DO_MODO, campanha: PROMESSA_CAMPANHA, referencia_web: PROMESSA_REFERENCIA_WEB },
    tipos_de_variacao: TIPOS_DE_VARIACAO.map((t) => ({ id: t.id, nome: t.nome, direcao: t.direcao, formato: t.formato, foco: t.foco })),
    max_variacoes: MAX_VARIACOES,
    max_fotos_campanha: MAX_FOTOS_CAMPANHA,
    custo_usd: 0,
  });
}

/** Estimativa do ensaio com os modelos padrão (imagem e leitura) e a qualidade pedida. */
async function estimarEnsaio(
  tomadas: Tomada[],
  refs: RefDoKit[],
  opcoes: { modeloImagemId?: unknown; qualidade?: Qualidade; extras?: number } = {},
): Promise<Estimativa & { modelo_imagem_id: string; qualidade: Qualidade }> {
  const mImg = await modeloDeImagem(opcoes.modeloImagemId);
  const mLeitura = await modeloDeTexto("leitura").catch(() => null);
  const qualidade = opcoes.qualidade ?? QUALIDADE_PADRAO;
  // Referências de estilo do ensaio (e a pessoa aprovada da campanha) também entram no gerador.
  const extras = Math.max(0, Math.min(3, opcoes.extras ?? 0));
  const limite = Math.max(1, Math.min(limiteDeFontesDoMotor(mImg), LIMITE_PRATICO_DE_FONTES) - extras);
  const porId = new Map(tomadas.map((t) => [t.id, t]));
  const fontes = (id: string) => fontesDaTomada(refs, porId.get(id)!, limite).length;
  const est = estimativaDoEnsaio(
    tomadas,
    (id) => custoDeUmaImagem(mImg, qualidade, fontes(id) + extras),
    (id) => (mLeitura ? custoDeUmaConferencia(mLeitura, Math.min(4, fontes(id)) + 1) : 0),
  );
  return { ...est, modelo_imagem_id: mImg.id, qualidade };
}

/** Imagens extras que o ensaio manda ao gerador em toda tomada (estilo e pessoa aprovada). */
const extrasDoEnsaio = (e: Pick<LinhaEnsaio, "direcao" | "receita_id">) =>
  referenciasDeEstiloDoEnsaio(e).length + (e.receita_id === RECEITA_CAMPANHA ? 1 : 0);

/** Referências de estilo gravadas no ensaio (campanha e variações), até 2. */
function referenciasDeEstiloDoEnsaio(e: Pick<LinhaEnsaio, "direcao">): string[] {
  const v = (e.direcao ?? {}).referencias_estilo;
  return Array.isArray(v) ? v.map(String).filter((x) => UUID.test(x)).slice(0, MAX_ESTILOS_NO_GERADOR) : [];
}
const MAX_ESTILOS_NO_GERADOR = 2;

async function estimar(ch: Chamador, corpo: Record<string, unknown>) {
  const qualidade = lerQualidade(corpo.qualidade);
  const acao = String(corpo.acao_alvo ?? corpo.alvo ?? "");
  if (acao === "preparar") {
    const clientId = idDe(corpo.client_id, "client_id");
    await garantirAcesso(ch, clientId);
    const imagem = await lerImagem(clientId, idDe(corpo.imagem_id, "imagem_id"));
    const modo = String(corpo.modo ?? "") as ModoPreparar;
    if (!MODOS_PREPARAR.includes(modo)) throw new ErroHttp(400, "modo_invalido", `Modo inválido. Use: ${MODOS_PREPARAR.join(", ")}.`);
    const bytes = (await baixarReduzida(imagem.storage_bucket, imagem.storage_path, 1024, imagem.nome)).bytes;
    if (modo === "fundo_branco" && (await ehRecorte(bytes))) {
      return json({ estimativa_usd: 0, gratis: true, motivo: "A foto já é um recorte: o fundo branco é montado aqui, sem gerador.", custo_usd: 0 });
    }
    const mImg = await modeloDeImagem(corpo.modelo_imagem_id);
    const estilos = lerGuia(corpo.guia).referencia_ids.length;
    return json({ estimativa_usd: custoDeUmaImagem(mImg, qualidade, 1 + estilos, 1500), gratis: false, modelo_imagem_id: mImg.id, qualidade, custo_usd: 0 });
  }
  if (acao === "tomada_gerar" || acao === "ensaio") {
    const ensaio = await ensaioComAcesso(ch, idDe(corpo.ensaio_id, "ensaio_id"));
    const kit = await lerKit(ch, ensaio.kit_id);
    const refs = await lerRefs(kit);
    const alvo = acao === "tomada_gerar" ? [tomadaDoEnsaio(ensaio, corpo.tomada_id)] : ensaio.tomadas;
    const est = await estimarEnsaio(alvo, refs, { modeloImagemId: corpo.modelo_imagem_id, qualidade, extras: extrasDoEnsaio(ensaio) });
    return json({ estimativa_usd: acao === "tomada_gerar" ? est.geracao_usd : est.total_usd, estimativa: est, custo_usd: 0 });
  }
  if (acao === "biblioteca_exemplo") {
    const mImg = await modeloDeImagem(corpo.modelo_imagem_id);
    return json({ estimativa_usd: custoDeUmaImagem(mImg, qualidade, 0, 2500), modelo_imagem_id: mImg.id, qualidade, custo_usd: 0 });
  }
  if (ALVOS_DE_ESTIMATIVA_DE_MODELOS.includes(acao)) return await MODELOS.estimar(ch, corpo, acao);
  if (ALVOS_DE_ESTIMATIVA_DO_CANVAS.includes(acao)) return await CANVAS.estimar(ch, corpo);
  if (ALVOS_DE_ESTIMATIVA_DE_CLONES.includes(acao)) return await CLONES.estimar(ch, corpo, acao);
  throw new ErroHttp(400, "alvo_invalido", `acao_alvo: preparar, tomada_gerar, ensaio, biblioteca_exemplo, ${[...ALVOS_DE_ESTIMATIVA_DE_MODELOS, ...ALVOS_DE_ESTIMATIVA_DO_CANVAS, ...ALVOS_DE_ESTIMATIVA_DE_CLONES].join(", ")}.`);
}

// ------------------------------------------------------------------ ensaio

async function ensaioPlanejar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const kit = await lerKit(ch, idDe(corpo.kit_id, "kit_id"));
  if (kit.client_id !== clientId) throw new ErroHttp(409, "kit_de_outro_cliente", "Este kit pertence a outro cliente.");
  if (kit.status === "arquivado") throw new ErroHttp(409, "kit_arquivado", "O kit está arquivado.");
  const receitaBase = receitaPorId(corpo.receita_id);
  if (!receitaBase) throw new ErroHttp(400, "receita_invalida", "Receita desconhecida. Consulte a ação receitas.");
  if (!receitaBase.tipos_de_kit.includes(kit.tipo)) {
    throw new ErroHttp(409, "receita_incompativel", `A receita ${receitaBase.nome} não serve para kit do tipo ${kit.tipo}.`, { tipos_aceitos: receitaBase.tipos_de_kit });
  }
  // Campanha com modelo tem planejamento próprio (guia de estilo e pessoa sintética).
  if (receitaBase.id === RECEITA_CAMPANHA) {
    return await campanhaPlanejar(ch, { ...corpo, quantidade: corpo.quantidade ?? receitaBase.tomadas.length });
  }
  const formatos = lerFormatos(corpo.formatos);
  const finalidade = limpo(corpo.finalidade, 200) || "catálogo e redes sociais";
  const pedido = limpoOuNulo(corpo.pedido, 2000);
  const refs = await lerRefs(kit);
  // Tomadas da receita que a equipe manteve na tela (ids); sem lista, todas.
  const pedidas = Array.isArray(corpo.tomadas_pedidas) ? new Set(corpo.tomadas_pedidas.map(String)) : null;
  if (pedidas && pedidas.size) {
    const desconhecidas = Array.from(pedidas).filter((id) => !receitaBase.tomadas.some((t) => t.id === id));
    if (desconhecidas.length) throw new ErroHttp(400, "tomada_desconhecida", "Há tomada que não existe nesta receita.", { tomada_ids: desconhecidas });
  }
  const receita = pedidas && pedidas.size ? { ...receitaBase, tomadas: receitaBase.tomadas.filter((t) => pedidas.has(t.id)) } : receitaBase;
  const [contexto, diretor] = await Promise.all([contextoDoCliente(clientId, corpo.campanha_id), modeloDeTexto("diretor_arte", corpo.modelo_id)]);

  const tomadasDaReceita = receita.tomadas.map((t) => ({
    id: t.id,
    nome: t.nome,
    objetivo: t.objetivo,
    preset_id: t.camera.preset_id,
    camera: t.camera,
    bloqueada: motivoDoBloqueio(kit, refs, t.exige ?? null),
  }));
  const dados = {
    cliente: contexto.dados,
    kit: resumoDoKit(kit, refs),
    receita: { id: receita.id, nome: receita.nome, direcao: receita.direcao, luz: receita.luz, cenario: receita.cenario, atributos_criticos: receita.atributos_criticos, tomadas: tomadasDaReceita },
    finalidade,
    formatos,
    pedido_da_equipe: pedido,
    tomadas_mantidas_pela_equipe: pedidas && pedidas.size ? Array.from(pedidas) : "todas",
    presets: PRESETS.map((p) => ({ id: p.id, nome: p.nome })),
  };
  const saida = await chamarTexto({
    clientId,
    tarefa: TAREFA_ESTUDIO,
    agente: AGENTE_DIRETOR,
    modeloId: diretor.id,
    raciocinio: raciocinioPara(diretor),
    sistema: SISTEMA_DIRETOR,
    mensagens: [{ papel: "usuario", conteudo: `Planeje o ensaio com estes dados reais:\n${JSON.stringify(dados)}` }],
    esquemaJson: ESQUEMA_PLANO,
    maxTokensSaida: 10_000,
    timeoutMs: TIMEOUT_TEXTO_FOTO_MS,
    referencia: { tipo: REF_KIT, id: kit.id },
    criadoPor: ch.userId,
  });
  const r = (saida.json ?? {}) as Record<string, unknown>;
  const doDiretor: TomadaDoDiretor[] = (Array.isArray(r.tomadas) ? r.tomadas : []).map((x) => {
    const t = (x ?? {}) as Record<string, unknown>;
    return {
      receita_tomada_id: typeof t.receita_tomada_id === "string" ? t.receita_tomada_id : null,
      nome: limpo(t.nome, 120),
      objetivo: limpo(t.objetivo, 400),
      preset_id: typeof t.preset_id === "string" ? t.preset_id : null,
      cenario: limpo(t.cenario, 800),
      luz: limpo(t.luz, 800),
      pode_mudar: listaDeTextos(t.pode_mudar, 12, 200),
      formato: typeof t.formato === "string" ? t.formato : null,
      observacao: limpoOuNulo(t.observacao, 600),
      props: listaDeTextos(t.props, 8, 160),
    };
  }).filter((t) => t.nome);
  const tomadas = montarTomadas(receita, doDiretor, { kit, refs, formatos });
  const qualidade = lerQualidade(corpo.qualidade);
  const estimativa = await estimarEnsaio(tomadas, refs, { modeloImagemId: corpo.modelo_imagem_id, qualidade });
  const { data, error } = await servico().from("foto_ensaios").insert({
    client_id: clientId,
    kit_id: kit.id,
    receita_id: receita.id,
    receita_versao: VERSAO_RECEITAS,
    finalidade,
    formatos,
    tomadas,
    direcao: {
      conceito: limpo(r.conceito, 1500),
      lacunas_que_limitam: listaDeTextos(r.lacunas_que_limitam, 12, 300),
      perguntas: listaDeTextos(r.perguntas, 10, 300),
      modelo_id: saida.modeloId,
      estimativa,
      campanha_mesa: contexto.campanha,
    },
    pedido,
    custo_usd: arred6(saida.custoUsd),
    status: statusDoEnsaio(tomadas),
    criado_por: ch.userId,
  }).select("*").single();
  if (error || !data) throw new ErroHttp(503, "gravacao_falhou", "O plano foi feito, mas o ensaio não foi gravado. Tente de novo.", { custo_usd: saida.custoUsd });
  return json({
    ensaio: data,
    estimativa_usd: estimativa.total_usd,
    estimativa,
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    reserva_usada: saida.reservaUsada ?? null,
  });
}

async function tomadaEditar(ch: Chamador, corpo: Record<string, unknown>) {
  const ensaio = await ensaioComAcesso(ch, idDe(corpo.ensaio_id, "ensaio_id"));
  const tomada = tomadaDoEnsaio(ensaio, corpo.tomada_id);
  const [sugestao] = normalizarSugestoes([{ tipo: "ajuste_tomada", titulo: "Edição da equipe", tomada_id: tomada.id, campos: corpo.campos }], {
    tomadaIds: [tomada.id],
    formatos: ensaio.formatos,
  });
  if (!sugestao) throw new ErroHttp(400, "campos_invalidos", "Nada para mudar: envie nome, objetivo, preset_id, cenario, luz, formato ou pode_mudar.");
  return await aplicarNaTomada(ch, ensaio, sugestao);
}

/** Aplica tomada nova ou ajuste (sem IA) e devolve o ensaio e a estimativa nova. */
async function aplicarNaTomada(ch: Chamador, ensaio: LinhaEnsaio, sugestao: Sugestao) {
  const kit = await lerKit(ch, ensaio.kit_id);
  const refs = await lerRefs(kit);
  const receita = receitaPorId(ensaio.receita_id);
  const formatos = lerFormatos(ensaio.formatos) as Formato[];
  let tomadaId = "";
  const gravado = await mutarEnsaio(ensaio.id, (atual) => {
    const r = aplicarSugestaoDeTomada(atual.tomadas, sugestao, { kit, refs, receita, formatos });
    tomadaId = r.tomada.id;
    return { tomadas: r.tomadas, status: statusDoEnsaio(r.tomadas, atual.status) };
  });
  const estimativa = await estimarEnsaio(gravado.tomadas, refs).catch(() => null);
  return json({
    ensaio: gravado,
    tomada: gravado.tomadas.find((t) => t.id === tomadaId) ?? null,
    estimativa_usd: estimativa?.total_usd ?? null,
    estimativa,
    custo_usd: 0,
  });
}

// ------------------------------------------------------------------ variações e campanha

type TextoDaVaga = { nome: string; objetivo: string; cenario: string; luz: string; props: string[]; formato: string | null };

/** Grava um ensaio novo (variações ou campanha) e devolve a linha. */
async function gravarEnsaioNovo(ch: Chamador, d: {
  clientId: string;
  kit: LinhaKit;
  receitaId: string;
  finalidade: string;
  formatos: Formato[];
  tomadas: Tomada[];
  direcao: Record<string, unknown>;
  pedido: string | null;
  custoUsd: number;
}): Promise<LinhaEnsaio> {
  const { data, error } = await servico().from("foto_ensaios").insert({
    client_id: d.clientId,
    kit_id: d.kit.id,
    receita_id: d.receitaId,
    receita_versao: VERSAO_RECEITAS,
    finalidade: d.finalidade,
    formatos: d.formatos,
    tomadas: d.tomadas,
    direcao: d.direcao,
    pedido: d.pedido,
    custo_usd: arred6(d.custoUsd),
    status: statusDoEnsaio(d.tomadas),
    criado_por: ch.userId,
  }).select("*").single();
  if (error || !data) throw new ErroHttp(503, "gravacao_falhou", "O plano foi feito, mas o ensaio não foi gravado. Tente de novo.", { custo_usd: d.custoUsd });
  return data as LinhaEnsaio;
}

/** Formatos do lote: os pedidos, ou os sugeridos pelos tipos das vagas. */
function formatosDoLote(pedidos: unknown, sugeridos: string[]): Formato[] {
  if (Array.isArray(pedidos) && pedidos.length) return lerFormatos(pedidos) as Formato[];
  return lerFormatos(Array.from(new Set(sugeridos))) as Formato[];
}

/** Tomadas do lote de variações: câmera e tipo das vagas, texto do diretor (ou o base do tipo). */
function tomadasDasVagas(vagas: VagaDeVariacao[], textos: Map<string, Partial<TextoDaVaga>>, ctx: { kit: KitFoto; refs: RefDoKit[]; formatos: Formato[] }): Tomada[] {
  const cenarios = new Set<string>();
  return vagas.map((v) => {
    const t = textos.get(v.id) ?? {};
    let cenario = limpo(t.cenario, 800) || v.tipo.cenario;
    // Cenário repetido no lote não passa: vira o base do tipo com a mudança da rodada.
    if (cenarios.has(cenario.toLowerCase())) cenario = `${v.tipo.cenario}${v.mudanca ? ` Mudança: ${v.mudanca}.` : ""}`;
    cenarios.add(cenario.toLowerCase());
    const formato = formatoValido(t.formato) ?? (ctx.formatos.includes(v.tipo.formato as Formato) ? (v.tipo.formato as Formato) : null);
    return montarTomada({
      id: v.id,
      nome: limpo(t.nome, 120) || (v.rodada ? `${v.tipo.nome} ${v.rodada + 1}` : v.tipo.nome),
      objetivo: limpo(t.objetivo, 400) || v.tipo.direcao,
      camera: v.camera,
      cenario,
      luz: limpo(t.luz, 800) || v.tipo.luz,
      props: t.props?.length ? t.props : v.tipo.props,
      formato,
      exige: v.tipo.exige ?? null,
      foco: v.foco,
      tipo_variacao: v.tipo.id,
      mudanca: v.mudanca,
      pode_mudar: ["cenário", "props", "superfície", "luz", "composição"],
    }, { ...ctx, receita: null });
  });
}

type EstiloResolvido = { id: string; titulo: string; imagem: ImagemEntrada; origem: "acervo" | "biblioteca" };

/** Imagem de um item da biblioteca (arquivo guardado no bucket mesa ou endereço público seguro). */
async function imagemDoItemDaBiblioteca(clientId: string, item: LinhaBiblioteca, lado = 1024): Promise<ImagemEntrada> {
  const caminho = item.storage_path ? caminhoDoClienteNoMesa(clientId, item.storage_path, true) : null;
  if (caminho) return await baixarReduzida("mesa", caminho, lado, `estilo-${item.titulo}`);
  const url = item.imagem_url ? urlPublicaSegura(item.imagem_url) : null;
  const buscado = url ? await buscarSeguro(url.toString(), { maxBytes: MAX_BYTES_REFERENCIA, aceitar: "image/*" }) : null;
  const mime = buscado ? mimeDe(buscado.bytes) : null;
  if (!buscado || !mime) throw new ErroHttp(502, "referencia_indisponivel", `Não foi possível abrir a referência "${item.titulo}". Importe a imagem para o cliente e tente de novo.`);
  return { bytes: await reduzir(buscado.bytes, lado), mime: "image/png", nome: `estilo-${nomeSeguro(item.titulo)}.png` };
}

/**
 * Referências de estilo por id: foto do acervo do cliente (print de perfil,
 * moodboard) ou item da biblioteca. Id desconhecido é erro explícito.
 */
async function resolverReferenciasDeEstilo(clientId: string, ids: string[], max = 4): Promise<EstiloResolvido[]> {
  const unicos = Array.from(new Set(ids.filter((x) => UUID.test(x)))).slice(0, max);
  if (!unicos.length) return [];
  const doAcervo = await lerImagens(clientId, unicos);
  const resto = unicos.filter((id) => !doAcervo.some((i) => i.id === id));
  const itens = resto.length ? await lerItensDaBiblioteca(clientId, resto) : [];
  const faltando = resto.filter((id) => !itens.some((i) => i.id === id && (i.storage_path || i.imagem_url)));
  if (faltando.length) throw new ErroHttp(404, "referencia_inexistente", "Há referência de estilo que não está no acervo nem na biblioteca deste cliente.", { ids: faltando });
  return await emParalelo(unicos, 2, async (id): Promise<EstiloResolvido> => {
    const img = doAcervo.find((i) => i.id === id);
    if (img) return { id, titulo: img.nome, imagem: await baixarReduzida(img.storage_bucket, img.storage_path, 1024, `estilo-${img.nome}`), origem: "acervo" };
    const item = itens.find((i) => i.id === id)!;
    return { id, titulo: item.titulo, imagem: await imagemDoItemDaBiblioteca(clientId, item), origem: "biblioteca" };
  });
}

/** Ids de referência de estilo que existem no acervo ou na biblioteca do cliente (sem baixar nada). */
async function idsDeEstiloValidos(clientId: string, ids: string[]): Promise<string[]> {
  const unicos = Array.from(new Set(ids.filter((x) => UUID.test(x)))).slice(0, 4);
  if (!unicos.length) return [];
  const doAcervo = await lerImagens(clientId, unicos);
  const itens = await lerItensDaBiblioteca(clientId, unicos.filter((id) => !doAcervo.some((i) => i.id === id)));
  return unicos.filter((id) => doAcervo.some((i) => i.id === id) || itens.some((i) => i.id === id && (i.storage_path || i.imagem_url)));
}

/** Kit que aceita variações e campanha: do cliente, ativo e de produto (não pessoa real). */
async function kitDoLote(ch: Chamador, clientId: string, kitId: unknown): Promise<{ kit: LinhaKit; refs: (RefDoKit & { imagem: LinhaImagem })[] }> {
  const kit = await lerKit(ch, idDe(kitId, "kit_id"));
  if (kit.client_id !== clientId) throw new ErroHttp(409, "kit_de_outro_cliente", "Este kit pertence a outro cliente.");
  if (kit.status === "arquivado") throw new ErroHttp(409, "kit_arquivado", "O kit está arquivado.");
  if (kit.tipo === "pessoa") {
    throw new ErroHttp(409, "kit_de_pessoa", "Variações e campanha com pessoa sintética usam kit de produto. Para a pessoa real do kit, use as receitas de retrato.");
  }
  return { kit, refs: await lerRefs(kit) };
}

const quantidadeDe = (v: unknown, padrao: number, max: number, nome: string) => {
  if (v == null || v === "") return padrao;
  const q = Math.round(Number(v));
  if (!Number.isFinite(q) || q < 1 || q > max) throw new ErroHttp(400, "quantidade_invalida", `${nome}: de 1 a ${max}.`);
  return q;
};

/**
 * variacoes_planejar { client_id, kit_id, quantidade (1 a 16), tipos?[], pedido?, referencia_ids?, formatos?, finalidade?, qualidade? }
 * -> { ensaio, estimativa_usd, estimativa }
 * Vagas decididas no código (tipos, câmeras, mudança por rodada) e texto de
 * direção de arte do diretor por vaga, com o contexto real do cliente.
 */
async function variacoesPlanejar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const { kit, refs } = await kitDoLote(ch, clientId, corpo.kit_id);
  const quantidade = quantidadeDe(corpo.quantidade, 8, MAX_VARIACOES, "quantidade");
  const temEmb = refs.some((r) => r.papel === "embalagem");
  const ctxVagas = { temIdentidade: temIdentidade(kit, refs), temEmbalagem: temEmb };
  const vagas = planoDeVariacoes(quantidade, corpo.tipos, ctxVagas);
  const formatos = formatosDoLote(corpo.formatos, vagas.map((v) => v.tipo.formato));
  const finalidade = limpo(corpo.finalidade, 200) || "anúncios, feed e loja";
  const pedido = limpoOuNulo(corpo.pedido, 2000);
  const estiloIds = Array.isArray(corpo.referencia_ids) ? corpo.referencia_ids.map(String) : [];
  const [contexto, diretor, estilos] = await Promise.all([
    contextoDoCliente(clientId, corpo.campanha_id),
    modeloDeTexto("diretor_arte", corpo.modelo_id),
    resolverReferenciasDeEstilo(clientId, estiloIds, MAX_ESTILOS_NO_GERADOR),
  ]);
  const doProduto = fontesDaTomada(refs, { camera: cameraDoPreset("a0-e0-dmedio"), exige: null, foco: ctxVagas.temIdentidade ? "produto" : "embalagem" }, 2)
    .filter((f) => f.papel !== "estilo" && f.papel !== "cenario") as (RefDoKit & { imagem: LinhaImagem })[];
  const imagensDoProduto = await emParalelo(doProduto, 2, (f) => baixarReduzida(f.imagem.storage_bucket, f.imagem.storage_path, 768, `${f.papel}-${f.imagem.nome}`));
  const dados = {
    cliente: contexto.dados,
    kit: resumoDoKit(kit, refs),
    finalidade,
    formatos,
    pedido_da_equipe: pedido,
    vagas: vagas.map((v) => ({
      vaga_id: v.id,
      tipo: v.tipo.id,
      tipo_nome: v.tipo.nome,
      direcao: v.tipo.direcao,
      foco: v.foco,
      camera: `${azimuteDaVaga(v)}, ${v.camera.enquadramento}`,
      cenario_base: v.tipo.cenario,
      luz_base: v.tipo.luz,
      props_base: v.tipo.props,
      formato_sugerido: v.tipo.formato,
      mudanca_da_rodada: v.mudanca,
    })),
  };
  const legenda = [
    ...doProduto.map((f, i) => `Imagem ${i + 1}: o produto do kit (${f.papel}${f.origem_web ? ", referência da internet" : ""}).`),
    ...estilos.map((e, i) => `Imagem ${doProduto.length + i + 1}: SÓ ESTILO ("${e.titulo}"): extraia a direção, não copie.`),
  ].join("\n");
  const saida = await chamarTexto({
    clientId,
    tarefa: TAREFA_ESTUDIO,
    agente: AGENTE_DIRETOR,
    modeloId: diretor.id,
    raciocinio: raciocinioPara(diretor),
    sistema: SISTEMA_VARIACOES,
    mensagens: [{
      papel: "usuario",
      conteudo: `Escreva a direção de arte de cada vaga deste lote com os dados reais:\n${JSON.stringify(dados)}${legenda ? `\n${legenda}` : ""}`,
      imagens: [...imagensDoProduto, ...estilos.map((e) => e.imagem)],
    }],
    esquemaJson: ESQUEMA_VARIACOES,
    maxTokensSaida: 12_000,
    timeoutMs: TIMEOUT_TEXTO_FOTO_MS,
    referencia: { tipo: REF_KIT, id: kit.id },
    criadoPor: ch.userId,
  });
  const r = (saida.json ?? {}) as Record<string, unknown>;
  const textos = new Map<string, Partial<TextoDaVaga>>();
  for (const x of Array.isArray(r.tomadas) ? r.tomadas : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    textos.set(String(o.vaga_id ?? ""), {
      nome: limpo(o.nome, 120),
      objetivo: limpo(o.objetivo, 400),
      cenario: limpo(o.cenario, 800),
      luz: limpo(o.luz, 800),
      props: listaDeTextos(o.props, 8, 160),
      formato: typeof o.formato === "string" ? o.formato : null,
    });
  }
  const tomadas = tomadasDasVagas(vagas, textos, { kit, refs, formatos });
  const qualidade = lerQualidade(corpo.qualidade);
  const estimativa = await estimarEnsaio(tomadas, refs, { modeloImagemId: corpo.modelo_imagem_id, qualidade, extras: estilos.length });
  const lacunas = listaDeTextos(r.lacunas_que_limitam, 12, 300);
  if (!ctxVagas.temIdentidade && temEmb) lacunas.unshift("Sem foto do produto fora da caixa: as variações usam a embalagem como assunto. Rode Identificar produto para tirar da caixa.");
  const ensaio = await gravarEnsaioNovo(ch, {
    clientId,
    kit,
    receitaId: RECEITA_VARIACOES,
    finalidade,
    formatos,
    tomadas,
    direcao: {
      tipo: "variacoes",
      conceito: limpo(r.conceito, 1500),
      quantidade,
      tipos: vagas.map((v) => v.tipo.id),
      referencias_estilo: estilos.map((e) => e.id),
      lacunas_que_limitam: lacunas,
      perguntas: [],
      modelo_id: saida.modeloId,
      estimativa,
      campanha_mesa: contexto.campanha,
    },
    pedido,
    custoUsd: saida.custoUsd,
  });
  return json({
    ensaio,
    campanha_mesa: contexto.campanha,
    estimativa_usd: estimativa.total_usd,
    estimativa,
    lacunas,
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    reserva_usada: saida.reservaUsada ?? null,
  });
}

const azimuteDaVaga = (v: VagaDeVariacao) => (v.camera.elevacao >= 75 ? "vista de cima" : `azimute ${v.camera.azimute}, elevação ${v.camera.elevacao}`);

/** Tomadas da campanha: câmera pelo enquadramento, cena da pessoa sintética, foco pelo que o kit documenta. */
function tomadasDaCampanha(fotos: FotoDeCampanha[], ctx: { kit: KitFoto; refs: RefDoKit[]; formatos: Formato[] }): Tomada[] {
  const foco = temIdentidade(ctx.kit, ctx.refs) || !ctx.refs.some((r) => r.papel === "embalagem") ? "produto" : "embalagem";
  const usados = new Set<string>();
  return fotos.map((f) => {
    const raiz = nomeSeguro(f.nome).slice(0, 30) || "foto";
    let id = raiz;
    for (let n = 2; usados.has(id); n++) id = `${raiz}-${n}`;
    usados.add(id);
    return montarTomada({
      id,
      nome: f.nome,
      objetivo: f.objetivo,
      receita_tomada_id: null,
      camera: cameraDaCampanha(f),
      cenario: f.cenario,
      luz: f.luz,
      props: f.props,
      formato: formatoValido(f.formato),
      espaco_para_texto: !f.com_pessoa,
      foco,
      tipo_variacao: null,
      campanha: { com_pessoa: f.com_pessoa, acao: f.acao, expressao: f.expressao, figurino: f.figurino },
      pode_mudar: ["cenário", "props", "figurino", "pose", "luz", "composição"],
    }, { ...ctx, receita: receitaPorId(RECEITA_CAMPANHA) });
  });
}

/** Fotos padrão da receita de campanha, para completar a quantidade pedida. */
function fotosPadraoDaCampanha(quantidade: number, ja: FotoDeCampanha[]): FotoDeCampanha[] {
  const receita = receitaPorId(RECEITA_CAMPANHA)!;
  const saida = ja.slice(0, quantidade);
  let i = 0;
  while (saida.length < quantidade && i < 40) {
    const t = receita.tomadas[i % receita.tomadas.length];
    const volta = Math.floor(i / receita.tomadas.length);
    saida.push({
      nome: volta ? `${t.nome} ${volta + 1}` : t.nome,
      objetivo: t.objetivo,
      acao: "",
      expressao: "",
      figurino: "",
      enquadramento: t.camera.enquadramento === "detalhe" ? "close" : t.camera.enquadramento === "aberto" ? "aberto" : "medio",
      camera: t.camera.preset_id,
      cenario: "",
      luz: "",
      props: [],
      formato: null,
      com_pessoa: t.com_pessoa !== false,
    });
    i++;
  }
  return saida;
}

const LACUNA_MESMA_MODELO = "O gerador não garante o mesmo rosto entre fotos: aprove a primeira foto com pessoa e as próximas usam ela como referência da mesma modelo sintética.";

/**
 * campanha_planejar { client_id, kit_id, quantidade (1 a 16), referencias_estilo_ids?, modelo?: { perfil?, idade_aprox?, estilo? }, pedido?, formatos?, finalidade? }
 * -> { ensaio, guia_de_estilo, modelo, estimativa_usd, estimativa, lacunas }
 * Lê as referências de estilo por visão (guia de estilo), define a pessoa
 * sintética e planeja as fotos; grava foto_ensaios com receita
 * campanha-com-modelo e direcao.guia_de_estilo.
 */
async function campanhaPlanejar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const { kit, refs } = await kitDoLote(ch, clientId, corpo.kit_id);
  const quantidade = quantidadeDe(corpo.quantidade, 6, MAX_FOTOS_CAMPANHA, "quantidade");
  const pedidoModelo = lerModeloSintetico(corpo.modelo);
  const formatos = formatosDoLote(corpo.formatos, ["4:5", "9:16"]);
  const finalidade = limpo(corpo.finalidade, 200) || "campanha e feed";
  const pedido = limpoOuNulo(corpo.pedido, 2000);
  const estiloIds = Array.isArray(corpo.referencias_estilo_ids) ? corpo.referencias_estilo_ids.map(String) : [];
  const [contexto, diretor, estilos] = await Promise.all([
    contextoDoCliente(clientId, corpo.campanha_id),
    modeloDeTexto("diretor_arte", corpo.modelo_id),
    resolverReferenciasDeEstilo(clientId, estiloIds, 4),
  ]);
  const comProduto = temIdentidade(kit, refs);
  const doProduto = fontesDaTomada(refs, { camera: cameraDoPreset("a0-e0-dmedio"), exige: null, foco: comProduto ? "produto" : "embalagem" }, 2)
    .filter((f) => f.papel !== "estilo" && f.papel !== "cenario") as (RefDoKit & { imagem: LinhaImagem })[];
  const imagensDoProduto = await emParalelo(doProduto, 2, (f) => baixarReduzida(f.imagem.storage_bucket, f.imagem.storage_path, 768, `${f.papel}-${f.imagem.nome}`));
  const dados = {
    cliente: contexto.dados,
    kit: resumoDoKit(kit, refs),
    assunto: comProduto ? "o produto do kit" : "a embalagem do kit (sem foto do produto fora da caixa)",
    quantidade,
    formatos,
    finalidade,
    modelo_pedido_pela_equipe: { perfil: pedidoModelo.perfil || null, idade_aprox: corpo.modelo ? pedidoModelo.idade_aprox : null, estilo: pedidoModelo.estilo || null },
    pedido_da_equipe: pedido,
    presets: PRESETS.filter((p) => p.elevacao_graus <= 30).map((p) => p.id),
  };
  const legenda = [
    ...doProduto.map((f, i) => `Imagem ${i + 1}: IDENTIDADE do produto (${f.papel}${f.origem_web ? ", referência da internet" : ""}).`),
    ...estilos.map((e, i) => `Imagem ${doProduto.length + i + 1}: REFERÊNCIA DE ESTILO ("${e.titulo}"): extraia a direção; não copie foto, marca nem pessoa.`),
  ].join("\n");
  const saida = await chamarTexto({
    clientId,
    tarefa: TAREFA_ESTUDIO,
    agente: AGENTE_DIRETOR,
    modeloId: diretor.id,
    raciocinio: raciocinioPara(diretor),
    sistema: SISTEMA_CAMPANHA,
    mensagens: [{
      papel: "usuario",
      conteudo: `Planeje a campanha com estes dados reais:\n${JSON.stringify(dados)}${legenda ? `\n${legenda}` : ""}`,
      imagens: [...imagensDoProduto, ...estilos.map((e) => e.imagem)],
    }],
    esquemaJson: ESQUEMA_CAMPANHA,
    maxTokensSaida: 14_000,
    timeoutMs: TIMEOUT_TEXTO_FOTO_MS,
    referencia: { tipo: REF_KIT, id: kit.id },
    criadoPor: ch.userId,
  });
  const r = (saida.json ?? {}) as Record<string, unknown>;
  const guia = normalizarGuiaDeEstilo(r.guia_de_estilo);
  const doDiretor = (r.modelo ?? {}) as Record<string, unknown>;
  // O que a equipe pediu vale sobre o que o diretor escolheu.
  const modelo = lerModeloSintetico({
    perfil: pedidoModelo.perfil || doDiretor.perfil,
    idade_aprox: corpo.modelo && (corpo.modelo as Record<string, unknown>).idade_aprox != null ? pedidoModelo.idade_aprox : doDiretor.idade_aprox,
    estilo: pedidoModelo.estilo || doDiretor.estilo,
  });
  modelo.avisos = Array.from(new Set([...pedidoModelo.avisos, ...modelo.avisos]));
  const fotos = fotosPadraoDaCampanha(quantidade, lerFotosDeCampanha(r.fotos, formatos, quantidade));
  const lacunas = listaDeTextos(r.lacunas, 10, 300);
  if (!comProduto) lacunas.unshift("Sem foto do produto fora da caixa: a campanha usa a embalagem. Rode Identificar produto para ter o produto em uso.");
  const resultado = await criarEnsaioDeCampanha(ch, {
    clientId,
    kit,
    refs,
    fotos,
    guia,
    modelo,
    estilos: estilos.map((e) => e.id),
    formatos,
    finalidade,
    conceito: limpo(r.conceito, 1500),
    lacunas,
    pedido,
    custoUsd: saida.custoUsd,
    modeloTextoId: saida.modeloId,
    qualidade: lerQualidade(corpo.qualidade),
    modeloImagemId: corpo.modelo_imagem_id,
    campanhaMesa: contexto.campanha,
  });
  return json({ ...resultado, campanha_mesa: contexto.campanha, custo_usd: saida.custoUsd, saldo_usd: saida.saldoUsd, reserva_usada: saida.reservaUsada ?? null });
}

/** Monta e grava o ensaio de campanha (campanha_planejar e a sugestão do diretor). */
async function criarEnsaioDeCampanha(ch: Chamador, d: {
  clientId: string;
  kit: LinhaKit;
  refs: RefDoKit[];
  fotos: FotoDeCampanha[];
  guia: GuiaDeEstilo | null;
  modelo: ModeloSintetico;
  estilos: string[];
  formatos: Formato[];
  finalidade: string;
  conceito: string;
  lacunas: string[];
  pedido: string | null;
  custoUsd: number;
  modeloTextoId: string | null;
  qualidade?: Qualidade;
  modeloImagemId?: unknown;
  campanhaMesa?: ContextoFoto["campanha"];
}) {
  const tomadas = tomadasDaCampanha(d.fotos, { kit: d.kit, refs: d.refs, formatos: d.formatos });
  const estilos = d.estilos.slice(0, MAX_ESTILOS_NO_GERADOR);
  const lacunas = Array.from(new Set([...d.lacunas, ...d.modelo.avisos, ...(tomadas.some((t) => t.campanha?.com_pessoa) ? [LACUNA_MESMA_MODELO] : [])])).slice(0, 14);
  const estimativa = await estimarEnsaio(tomadas, d.refs, { modeloImagemId: d.modeloImagemId, qualidade: d.qualidade, extras: estilos.length + 1 });
  const ensaio = await gravarEnsaioNovo(ch, {
    clientId: d.clientId,
    kit: d.kit,
    receitaId: RECEITA_CAMPANHA,
    finalidade: d.finalidade,
    formatos: d.formatos,
    tomadas,
    direcao: {
      tipo: "campanha",
      conceito: d.conceito,
      guia_de_estilo: d.guia,
      modelo: { perfil: d.modelo.perfil, idade_aprox: d.modelo.idade_aprox, estilo: d.modelo.estilo, sintetica: true },
      referencias_estilo: estilos,
      lacunas_que_limitam: lacunas,
      perguntas: [],
      modelo_id: d.modeloTextoId,
      estimativa,
      promessa: PROMESSA_CAMPANHA,
      campanha_mesa: d.campanhaMesa ?? null,
    },
    pedido: d.pedido,
    custoUsd: d.custoUsd,
  });
  return {
    ensaio,
    guia_de_estilo: d.guia,
    modelo: { perfil: d.modelo.perfil, idade_aprox: d.modelo.idade_aprox, estilo: d.modelo.estilo, sintetica: true },
    estimativa_usd: estimativa.total_usd,
    estimativa,
    lacunas,
    promessa: PROMESSA_CAMPANHA,
  };
}

// ------------------------------------------------------------------ guia (biblioteca, referência, livre)

type GuiaResolvida = { texto: string | null; estilos: { titulo: string; imagem: ImagemEntrada }[] };

async function lerItensDaBiblioteca(clientId: string, ids: string[]): Promise<LinhaBiblioteca[]> {
  if (!ids.length) return [];
  const { data, error } = await servico().from("foto_biblioteca").select("*").in("id", ids).or(`client_id.is.null,client_id.eq.${clientId}`);
  if (error) throw new ErroHttp(503, "biblioteca_indisponivel", "Não foi possível ler a biblioteca.");
  return (data as LinhaBiblioteca[] | null) ?? [];
}

/**
 * Guia da tomada ou do preparo: prompt da biblioteca vira direção de estilo
 * (nunca substitui invariantes), referência vira imagem de ESTILO anexada
 * depois das fontes de identidade, livre é o texto da equipe.
 */
async function resolverGuia(clientId: string, guia: Guia): Promise<GuiaResolvida> {
  if (guia.modo === "nenhum") return { texto: null, estilos: [] };
  if (guia.modo === "livre") return { texto: guia.texto, estilos: [] };
  if (guia.modo === "biblioteca") {
    const [item] = await lerItensDaBiblioteca(clientId, [guia.prompt_id!]);
    if (!item || item.tipo !== "prompt") throw new ErroHttp(404, "prompt_inexistente", "Prompt da biblioteca não encontrado para este cliente.");
    const base = item.prompt_pt || item.prompt_en || "";
    const texto = [base, item.negativo ? `Evite: ${item.negativo}.` : "", guia.texto ?? ""].filter(Boolean).join(" ");
    return { texto: limpo(texto, 3000), estilos: [] };
  }
  const itens = await lerItensDaBiblioteca(clientId, guia.referencia_ids);
  const ordem = guia.referencia_ids.map((id) => itens.find((i) => i.id === id)).filter((i): i is LinhaBiblioteca => !!i && i.tipo === "referencia");
  if (!ordem.length) throw new ErroHttp(404, "referencia_inexistente", "Referência de estilo não encontrada para este cliente.");
  const estilos = await emParalelo(ordem, 2, async (item) => {
    const caminho = item.storage_path ? caminhoDoClienteNoMesa(clientId, item.storage_path, true) : null;
    if (caminho) return { titulo: item.titulo, imagem: await baixarReduzida("mesa", caminho, 1024, `estilo-${item.titulo}`) };
    const url = item.imagem_url ? urlPublicaSegura(item.imagem_url) : null;
    const buscado = url ? await buscarSeguro(url.toString(), { maxBytes: MAX_BYTES_REFERENCIA, aceitar: "image/*" }) : null;
    const mime = buscado ? mimeDe(buscado.bytes) : null;
    if (!buscado || !mime) throw new ErroHttp(502, "referencia_indisponivel", `Não foi possível abrir a referência "${item.titulo}". Importe a imagem para o cliente e tente de novo.`);
    return { titulo: item.titulo, imagem: { bytes: await reduzir(buscado.bytes, 1024), mime: "image/png", nome: `estilo-${nomeSeguro(item.titulo)}.png` } };
  });
  return { texto: guia.texto, estilos };
}

// ------------------------------------------------------------------ gerar tomada

async function tomadaGerar(ch: Chamador, corpo: Record<string, unknown>) {
  const ensaio = await ensaioComAcesso(ch, idDe(corpo.ensaio_id, "ensaio_id"));
  if (ensaio.status === "arquivado") throw new ErroHttp(409, "ensaio_arquivado", "O ensaio está arquivado.");
  const salva = tomadaDoEnsaio(ensaio, corpo.tomada_id);
  const kit = await lerKit(ch, ensaio.kit_id);
  const refs = await lerRefs(kit);
  // Câmera escolhida na tela (presets em botões) passa a valer para a tomada.
  const cameraPedida = corpo.camera != null ? lerCamera(corpo.camera) : null;
  if (corpo.camera != null && !cameraPedida) {
    throw new ErroHttp(400, "camera_invalida", "Câmera inválida: envie azimute, elevacao e enquadramento (detalhe, medio ou aberto).");
  }
  // Modo, lente e bloqueio recalculados com o kit de agora (a equipe pode ter completado o kit depois do plano).
  const tomada = montarTomada({
    id: salva.id,
    nome: salva.nome,
    objetivo: salva.objetivo,
    receita_tomada_id: salva.receita_tomada_id,
    camera: cameraPedida ?? salva.camera,
    cenario: salva.cenario,
    luz: salva.luz,
    pode_mudar: salva.pode_mudar,
    formato: salva.formato,
    espaco_para_texto: salva.espaco_para_texto,
    exige: salva.exige,
    observacao: salva.observacao,
    versoes: salva.versoes,
    ...camposV2(salva),
  }, { kit, refs, receita: receitaPorId(ensaio.receita_id), formatos: lerFormatos(ensaio.formatos) as Formato[] });
  if (tomada.motivo_bloqueio) throw new ErroHttp(409, "tomada_bloqueada", tomada.motivo_bloqueio, { tomada_id: tomada.id });

  const guia = lerGuia(corpo.guia);
  const guiado = await resolverGuia(ensaio.client_id, guia);
  // Sem guia pedido na tela, valem as referências de estilo gravadas no ensaio (campanha, variações).
  const doEnsaio = guia.modo === "nenhum" ? await resolverReferenciasDeEstilo(ensaio.client_id, referenciasDeEstiloDoEnsaio(ensaio), MAX_ESTILOS_NO_GERADOR) : [];
  const estilos = [...guiado.estilos, ...doEnsaio.map((e) => ({ titulo: e.titulo, imagem: e.imagem }))].slice(0, MAX_ESTILOS_NO_GERADOR);
  // Campanha: a primeira foto com pessoa já aprovada mantém a mesma modelo sintética nas próximas.
  const aprovadaComPessoa = tomada.campanha?.com_pessoa
    ? ensaio.tomadas.filter((t) => t.campanha?.com_pessoa).flatMap((t) => t.versoes).find((v) => v.aprovada === true) ?? null
    : null;
  const pessoaAprovada = aprovadaComPessoa ? [await baixarReduzida("mesa", aprovadaComPessoa.storage_path, 1024, "pessoa-sintetica-aprovada")] : [];
  const mImg = await modeloDeImagem(corpo.modelo_imagem_id);
  const qualidade = lerQualidade(corpo.qualidade);
  const limite = Math.max(1, Math.min(limiteDeFontesDoMotor(mImg), LIMITE_PRATICO_DE_FONTES) - estilos.length - pessoaAprovada.length);
  const fontes = fontesDaTomada(refs, tomada, limite);
  const imagensFontes = await emParalelo(fontes, 4, (f) => {
    const r = f as RefDoKit & { imagem: LinhaImagem };
    return baixarReduzida(r.imagem.storage_bucket, r.imagem.storage_path, LADO_FONTE, `${f.papel}-${r.imagem.nome}`);
  });
  const contexto = await lerMarcaParaDirecao(servico(), ensaio.client_id);
  const rejeicoes = tomada.versoes.filter((v) => v.aprovada === false && v.motivo_rejeicao).map((v) => v.motivo_rejeicao!);
  const direcao = ensaio.direcao as Record<string, unknown>;
  const prompt = promptDaTomada({
    kit,
    tomada,
    finalidade: ensaio.finalidade ?? "",
    marca: { nome: contexto.nomeCliente, estilo: contexto.estilo, paleta: hexDaPaleta(contexto as ContextoFoto["marca"]) },
    fontes,
    estilos: estilos.map((e) => ({ titulo: e.titulo })),
    guiaTexto: guiado.texto,
    versoesAntes: tomada.versoes.length,
    rejeicoes,
    guiaDeEstilo: normalizarGuiaDeEstilo(direcao.guia_de_estilo),
    modelo: tomada.campanha ? lerModeloSintetico(direcao.modelo) : null,
    pessoaAprovada: pessoaAprovada.length > 0,
  });
  const tamanho = TAMANHO_DO_FORMATO[tomada.formato] ?? TAMANHO_DO_FORMATO["4:5"];
  /** A tomada gravada com os campos recalculados, as versões de agora e o status pedido. */
  const comStatus = (t: Tomada, status: Tomada["status"], extra: Partial<Tomada> = {}): Tomada => ({ ...tomada, versoes: t.versoes, status, ...extra });

  // Estado visível para quem abrir o ensaio durante a geração.
  await mutarEnsaio(ensaio.id, (atual) => ({
    tomadas: atual.tomadas.map((t) => (t.id === tomada.id ? comStatus(t, "gerando", { ultimo_erro: null }) : t)),
  }));
  let saida: SaidaImagem;
  let caminho: string;
  try {
    saida = await chamarImagem({
      clientId: ensaio.client_id,
      modeloId: mImg.id,
      prompt,
      referencias: [...imagensFontes, ...pessoaAprovada, ...estilos.map((e) => e.imagem)],
      qualidade,
      tamanho,
      referencia: { tipo: REF_ENSAIO, id: ensaio.id },
      criadoPor: ch.userId,
      tarefa: TAREFA_ESTUDIO,
      agente: AGENTE_GERADOR,
    });
    const png = await emPng(saida.png);
    caminho = `${ensaio.client_id}/foto/ensaios/${ensaio.id}/${nomeSeguro(tomada.id)}-${crypto.randomUUID().slice(0, 8)}.png`;
    await salvarNoMesa(caminho, png, "image/png");
  } catch (e) {
    // A falha fica escrita na tomada (status falhou); nova tentativa é pedido da equipe, sem laço aqui.
    const mensagem = e instanceof Error ? e.message.slice(0, 300) : "Falha do gerador.";
    await mutarEnsaio(ensaio.id, (atual) => ({
      tomadas: atual.tomadas.map((t) => (t.id === tomada.id ? comStatus(t, "falhou", { ultimo_erro: mensagem }) : t)),
    })).catch(() => {});
    throw e;
  }
  let nova: VersaoTomada | null = null;
  const gravado = await mutarEnsaio(ensaio.id, (atual) => {
    const tomadas = atual.tomadas.map((t) => {
      if (t.id !== tomada.id) return t;
      nova = {
        versao: proximaVersao(t),
        imagem_id: null,
        storage_path: caminho,
        custo_usd: arred6(saida.custoUsd),
        conferencia: { pendente: true },
        aprovada: null,
        decisao: null,
        motivo_rejeicao: null,
        criado_em: new Date().toISOString(),
        criado_por: ch.userId,
        gerada: true,
        modo: tomada.modo,
        camera: tomada.camera,
        formato: tomada.formato,
        tamanho: saida.tamanho,
        fontes: fontes.map((f) => f.imagem_id),
        guia: guia.modo === "nenhum" ? null : guia,
        modelo_id: saida.modeloId,
        qualidade,
        prompt,
        uso_ids: [saida.usoId],
        reserva_usada: saida.reservaUsada ?? null,
        travada: false,
        decidida_por: null,
        decidida_em: null,
      };
      const atualizada = comStatus({ ...t, versoes: [...t.versoes, nova] }, "gerada", { ultimo_erro: null });
      atualizada.status = statusDaTomada(atualizada);
      return atualizada;
    });
    return { tomadas, status: statusDoEnsaio(tomadas, atual.status), custo_usd: arred6(Number(atual.custo_usd || 0) + saida.custoUsd) };
  });
  const versao = nova as VersaoTomada | null;
  return json({
    ensaio: gravado,
    versao: versao ? { ...versao, tomada_id: tomada.id, url: await urlAssinada("mesa", caminho) } : null,
    promessa: tomada.campanha ? PROMESSA_CAMPANHA : PROMESSA_DO_MODO[tomada.modo],
    proximo_passo: "versao_conferir",
    aviso: [
      saida.tamanho !== tamanho ? `O gerador entregou em ${saida.tamanho} em vez de ${tamanho}; recorte no formato ao usar.` : "",
      fontes.some((f) => f.origem_web) ? "O produto foi refeito a partir de referências da internet (uso interno): confira modelo e variante antes de aprovar." : "",
    ].filter(Boolean).join(" ") || null,
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    reserva_usada: saida.reservaUsada ?? null,
  });
}

// ------------------------------------------------------------------ conferir e decidir

async function versaoConferir(ch: Chamador, corpo: Record<string, unknown>) {
  const ensaio = await ensaioComAcesso(ch, idDe(corpo.ensaio_id, "ensaio_id"));
  const tomada = tomadaDoEnsaio(ensaio, corpo.tomada_id);
  const numero = corpo.versao == null ? Math.max(0, ...tomada.versoes.map((v) => v.versao)) : Number(corpo.versao);
  const versao = tomada.versoes.find((v) => v.versao === numero);
  if (!versao) throw new ErroHttp(404, "versao_inexistente", "Esta versão não existe na tomada.");
  const kit = await lerKit(ch, ensaio.kit_id);
  const refs = await lerRefs(kit);
  // As mesmas fontes da geração (as que ainda estão no kit), identidade primeiro, até 4.
  const daGeracao = refs.filter((r) => versao.fontes.includes(r.imagem_id));
  const fontes = fontesDaTomada(daGeracao.length ? daGeracao : refs, tomada, 4) as (RefDoKit & { imagem: LinhaImagem })[];
  const [gerada, ...imagensFontes] = await Promise.all([
    baixarReduzida("mesa", versao.storage_path, LADO_VISAO, `versao-${versao.versao}`),
    ...fontes.map((f) => baixarReduzida(f.imagem.storage_bucket, f.imagem.storage_path, 1024, `${f.papel}-${f.imagem.nome}`)),
  ]);
  const criterios = criteriosDaConferencia(kit.tipo, {
    comPessoaSintetica: !!tomada.campanha?.com_pessoa || !!tipoDeVariacaoPorId(tomada.tipo_variacao)?.com_maos,
    embalagem: tomada.foco === "embalagem",
  });
  const leitor = await modeloDeTexto("leitura", corpo.modelo_id);
  const pedido = [
    `Tomada "${tomada.nome}" (${PROMESSA_DO_MODO[tomada.modo]}). Câmera pedida: preset ${tomada.camera.preset_id ?? "próprio"}, azimute ${tomada.camera.azimute}, elevação ${tomada.camera.elevacao}, enquadramento ${tomada.camera.enquadramento}.`,
    `Cenário pedido: ${tomada.cenario}. Luz pedida: ${tomada.luz}.`,
    `Assunto: ${kit.nome}${kit.variante ? ` (variante ${kit.variante})` : ""}. Invariantes: ${tomada.invariantes.join("; ")}.`,
    tomada.campanha?.com_pessoa ? "A pessoa da foto é SINTÉTICA (gerada de propósito): confira anatomia, mãos, idade adulta e que não se pareça com pessoa real conhecida; o produto é conferido contra as fontes." : "",
    `Imagem 1 = foto gerada. ${fontes.map((f, i) => `Imagem ${i + 2} = fonte real (${f.papel}${f.vista ? `, vista ${f.vista}` : ""}${f.origem_web ? ", foto de referência da internet do mesmo produto" : ""}).`).join(" ")}`,
    `Critérios: ${criterios.join("; ")}.`,
  ].join("\n");
  const lido = await chamarTexto({
    clientId: ensaio.client_id,
    tarefa: TAREFA_CONFERENCIA,
    agente: AGENTE_LEITOR,
    modeloId: leitor.id,
    sistema: SISTEMA_CONFERENCIA,
    mensagens: [{ papel: "usuario", conteudo: pedido, imagens: [gerada, ...imagensFontes] }],
    esquemaJson: esquemaConferencia(criterios),
    maxTokensSaida: 5_000,
    timeoutMs: TIMEOUT_TEXTO_FOTO_MS,
    referencia: { tipo: REF_ENSAIO, id: ensaio.id },
    criadoPor: ch.userId,
  });
  const base = normalizarConferencia(lido.json, criterios);
  let custo = lido.custoUsd;
  // Jev só como aviso: a conferência já está feita; ele diz se há divergência crítica.
  let jev: Conferencia["jev"] = null;
  try {
    const res = await jevPerguntar({
      state: {
        kit: { tipo: kit.tipo, nome: kit.nome, variante: kit.variante, invariantes: tomada.invariantes },
        tomada: { nome: tomada.nome, modo: tomada.modo, angulo_novo: tomada.angulo_novo },
        conferencia: { pontos: base.pontos, alertas: base.alertas, resumo: base.resumo },
      },
      questions: {
        divergencia: {
          type: "noul",
          instructions:
            "A conferência em `conferencia` mostra divergência crítica entre a foto gerada e o assunto real do kit (produto ou variante diferente, texto do rótulo alterado ou espelhado, rosto de outra pessoa, idade ou corpo alterados, ingrediente ou porção inventados, anatomia errada)?",
          criteria: { true: "Há divergência crítica: a foto não pode ser usada como o assunto real sem revisão.", false: "Não há divergência crítica nas evidências da conferência." },
        },
      },
    });
    const cobrado = await cobrarJev(res, { clientId: ensaio.client_id, tarefa: TAREFA_CONFERENCIA, referencia: { tipo: REF_ENSAIO, id: ensaio.id }, criadoPor: ch.userId });
    if (cobrado) custo += cobrado.custoUsd;
    const p = probabilidadeNoul(res.answers.divergencia);
    jev = { divergencia_critica: p, aviso: p != null && p >= 0.5 };
  } catch (e) {
    jev = { erro: e instanceof JevErro ? e.codigo : "jev_indisponivel" };
  }
  const conferencia: Conferencia = { ...base, jev, modelo_id: lido.modeloId, conferida_em: new Date().toISOString(), custo_usd: arred6(custo) };
  await mutarEnsaio(ensaio.id, (atual) => ({
    tomadas: atual.tomadas.map((t) =>
      t.id !== tomada.id ? t : { ...t, versoes: t.versoes.map((v) => (v.versao === numero ? { ...v, conferencia } : v)) }
    ),
    custo_usd: arred6(Number(atual.custo_usd || 0) + custo),
  }));
  return json({ ensaio_id: ensaio.id, tomada_id: tomada.id, versao: numero, conferencia, custo_usd: arred6(custo), saldo_usd: lido.saldoUsd });
}

async function versaoDecidir(ch: Chamador, corpo: Record<string, unknown>) {
  const ensaio = await ensaioComAcesso(ch, idDe(corpo.ensaio_id, "ensaio_id"));
  const tomada = tomadaDoEnsaio(ensaio, corpo.tomada_id);
  const numero = Number(corpo.versao);
  const decisao = String(corpo.decisao ?? "");
  if (decisao !== "aprovar" && decisao !== "rejeitar") throw new ErroHttp(400, "decisao_invalida", "decisao: aprovar ou rejeitar.");
  const motivo = limpoOuNulo(corpo.motivo, 800);
  // Valida antes de tocar no acervo (versão inexistente ou travada).
  const previa = decidirVersao(tomada, numero, decisao, motivo, ch.userId, new Date().toISOString());
  let imagem: LinhaImagem | null = null;
  if (decisao === "aprovar") {
    const kit = await lerKit(ch, ensaio.kit_id);
    const v = previa.versao;
    if (v.imagem_id) {
      imagem = await lerImagem(ensaio.client_id, v.imagem_id);
    } else {
      const bytes = await baixar("mesa", v.storage_path);
      const sha = await sha256Hex(bytes);
      const dim = dimensoesDaImagem(bytes);
      const { data: ja } = await servico().from("cliente_imagens").select(CAMPOS_IMAGEM).eq("client_id", ensaio.client_id).eq("sha256", sha).limit(1);
      imagem = ((ja as LinhaImagem[] | null) ?? [])[0] ?? null;
      if (!imagem) {
        const origem = v.fontes[0] ?? null;
        const { data, error } = await servico().from("cliente_imagens").insert({
          client_id: ensaio.client_id,
          origem: "mesa_foto",
          storage_bucket: "mesa",
          storage_path: v.storage_path,
          nome: `${kit.nome}, ${tomada.nome} v${v.versao}`.slice(0, 160),
          pasta: "Mesa Foto / Ensaios",
          categoria: categoriaDoAcervo(kit.tipo),
          tags: [
            "mesa_foto", "ensaio", "gerada", `tomada:${tomada.id}`, `ensaio:${ensaio.id}`,
            ...(tomada.angulo_novo ? ["novo_angulo"] : []),
            ...(tomada.campanha ? ["campanha"] : []),
            ...(tomada.campanha?.com_pessoa || tipoDeVariacaoPorId(tomada.tipo_variacao)?.com_maos ? ["pessoa_sintetica"] : []),
            ...(tomada.tipo_variacao ? [`variacao:${tomada.tipo_variacao}`] : []),
          ],
          descricao: `${tomada.campanha ? PROMESSA_CAMPANHA : PROMESSA_DO_MODO[v.modo]} Ensaio ${ensaio.id}, tomada ${tomada.nome}.`.slice(0, 1000),
          derivada_de: origem,
          gerada: true,
          modo: v.modo,
          kit_id: kit.id,
          sha256: sha,
          largura: dim?.largura ?? null,
          altura: dim?.altura ?? null,
          aprovada: true,
        }).select(CAMPOS_IMAGEM).single();
        if (error || !data) throw new ErroHttp(503, "gravacao_falhou", "Não foi possível criar a foto aprovada no acervo.");
        imagem = data as LinhaImagem;
      } else if (!imagem.aprovada) {
        await servico().from("cliente_imagens").update({ aprovada: true }).eq("id", imagem.id);
        imagem = { ...imagem, aprovada: true };
      }
    }
  }
  const quando = new Date().toISOString();
  let versaoFinal: VersaoTomada | null = null;
  const gravado = await mutarEnsaio(ensaio.id, (atual) => {
    const tomadas = atual.tomadas.map((t) => {
      if (t.id !== tomada.id) return t;
      const r = decidirVersao(t, numero, decisao, motivo, ch.userId, quando);
      const versoes = r.tomada.versoes.map((v) => (v.versao === numero && imagem ? { ...v, imagem_id: imagem.id } : v));
      versaoFinal = versoes.find((v) => v.versao === numero) ?? null;
      return { ...r.tomada, versoes };
    });
    return { tomadas, status: statusDoEnsaio(tomadas, atual.status) };
  });
  return json({ ensaio: gravado, versao: versaoFinal, imagem: imagem ? await comUrl(imagem) : null, custo_usd: 0 });
}

// ------------------------------------------------------------------ preparar

const ROTULO_DO_PREPARO: Record<ModoPreparar, string> = {
  fundo_branco: "fundo branco",
  fundo_transparente: "sem fundo",
  cenario: "novo cenário",
  luz_cor: "luz e cor",
  limpar: "limpa",
};

async function preparar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const imagem = await lerImagem(clientId, idDe(corpo.imagem_id, "imagem_id"));
  const modo = String(corpo.modo ?? "") as ModoPreparar;
  if (!MODOS_PREPARAR.includes(modo)) throw new ErroHttp(400, "modo_invalido", `Modo inválido. Use: ${MODOS_PREPARAR.join(", ")}.`);
  const protegidas: Area[] = lerAreas(corpo.areas_protegidas);
  const cenario = limpoOuNulo(corpo.cenario, 1200);
  if (modo === "cenario" && !cenario) throw new ErroHttp(400, "cenario_obrigatorio", "Descreva o cenário (superfície, fundo, props, luz).");
  const instrucao = limpoOuNulo(corpo.instrucao, 1500);
  let kit: LinhaKit | null = null;
  if (corpo.kit_id != null && corpo.kit_id !== "") {
    kit = await lerKit(ch, idDe(corpo.kit_id, "kit_id"));
    if (kit.client_id !== clientId) throw new ErroHttp(409, "kit_de_outro_cliente", "Este kit pertence a outro cliente.");
  }
  const tipoDaTag = (imagem.tags ?? []).find((t) => t.startsWith("tipo:"))?.slice(5) as TipoKit | undefined;
  const tipo: TipoKit | null = kit?.tipo ?? (tipoDaTag && TIPOS_DE_KIT.includes(tipoDaTag) ? tipoDaTag : null);
  const guia = lerGuia(corpo.guia);
  const guiado = await resolverGuia(clientId, guia);

  // A derivada sai na resolução de trabalho (até 1920 px no lado maior): a foto chega reduzida
  // a 2048 px pelo Storage, o que também poupa memória da função com originais grandes.
  // "Tirar fundo" (25/09) devolve a FOTO ORIGINAL com o alfa alinhado, até 1600 px no lado
  // maior: decodificar JPEG é o passo mais caro e o limite é de 2 s de CPU (medido em recorte.ts).
  const usaRecorte = modo === "fundo_transparente" || (modo === "fundo_branco" && !protegidas.length);
  const bytes = (await baixarReduzida(imagem.storage_bucket, imagem.storage_path, usaRecorte ? LADO_DO_RECORTE : LADO_PREPARO, imagem.nome)).bytes;
  const dim = dimensoesDaImagem(bytes) ?? await dimensoesDecodificando(bytes);
  // A foto é aberta uma vez só no caminho do recorte; JPEG não tem alfa (não precisa abrir para saber).
  let aberta: Awaited<ReturnType<typeof abrirFoto>> | null = null;
  const recorteNaEntrada = mimeDe(bytes) === "image/jpeg"
    ? false
    : usaRecorte
    ? fracaoTransparenteDe(aberta = await abrirFoto(bytes)) >= 0.02
    : await ehRecorte(bytes);
  if (modo === "fundo_transparente" && recorteNaEntrada) throw new ErroHttp(409, "ja_e_recorte", "Esta foto já está sem fundo.");
  let tamanho = tamanhoDeTrabalho(dim.largura, dim.altura);
  const qualidade = lerQualidade(corpo.qualidade);

  let custo = 0;
  let saldo: number | null = null;
  let reserva: string | null = null;
  let final: Uint8Array;
  let rota: "recorte" | "gerador";

  /** Uma chamada ao gerador sobre a foto de trabalho (tamanho recusado: uma nova tentativa num tamanho clássico). */
  const gerar = async (opcoes: { fundo?: "transparente"; protegidas: Area[] }): Promise<{ trabalho: Uint8Array; png: Uint8Array; saida: SaidaImagem }> => {
    const mImg = await modeloDeImagem(corpo.modelo_imagem_id);
    if (opcoes.fundo === "transparente" && !aceitaFundoTransparente(mImg)) {
      throw new ErroHttp(409, "fundo_transparente_nao_suportado", `O modelo de imagem ${mImg.rotulo ?? mImg.id} não gera fundo transparente. Escolha um GPT Image ou marque a área do assunto.`, {
        modelo_imagem_id: mImg.id,
      });
    }
    const prompt = promptDoPreparo({
      modo,
      tipo,
      cenario,
      instrucao,
      guiaTexto: guiado.texto,
      estilos: guiado.estilos.map((e) => ({ titulo: e.titulo })),
      temAreasProtegidas: opcoes.protegidas.length > 0,
      entradaRecortada: recorteNaEntrada,
    });
    const tentar = async (t: string) => {
      const trabalho = await telaDeTrabalho(bytes, t);
      const [l, a] = t.split("x").map(Number);
      const mascaraPng = opcoes.protegidas.length ? await mascaraProtegendo(l, a, opcoes.protegidas) : undefined;
      const saida = await chamarImagem({
        clientId,
        modeloId: mImg.id,
        prompt,
        referencias: guiado.estilos.map((e) => e.imagem),
        qualidade,
        tamanho: t,
        tamanhoFixo: true,
        editar: { bytes: trabalho, mascara: mascaraPng },
        fundo: opcoes.fundo,
        referencia: { tipo: REF_IMAGEM, id: imagem.id },
        criadoPor: ch.userId,
        tarefa: TAREFA_ESTUDIO,
        agente: AGENTE_GERADOR,
      });
      return { trabalho, png: await emPng(saida.png), saida };
    };
    try {
      return await tentar(tamanho);
    } catch (e) {
      const classico = tamanhoDeTrabalhoClassico(dim.largura, dim.altura);
      if (recusouTamanho(e) && classico !== tamanho) {
        tamanho = classico;
        return await tentar(classico);
      }
      throw e;
    }
  };
  const somar = (s: SaidaImagem) => {
    custo += s.custoUsd;
    saldo = s.saldoUsd;
    reserva = s.reservaUsada ?? reserva;
  };
  // Objeto (e não let): o recorte grava por dentro da função abaixo.
  const doRecorte: { info: { alinhou: boolean; erro: number; situacao: string; aviso: string | null } | null } = { info: null };
  /**
   * "Tirar fundo" (dono, 25/09): o GPT Image devolve a tela com fundo
   * transparente e só o ALFA dele é usado, alinhado à foto original
   * (recorte.ts). A cor de cada pixel é a da foto original, na resolução em
   * que chegou. Fundo opaco, recorte vazio ou assunto redesenhado na volta
   * viram erro explícito (nada é gravado; a chamada já foi cobrada).
   */
  const recortar = async (): Promise<Uint8Array> => {
    const mImg = await modeloDeImagem(corpo.modelo_imagem_id);
    if (!aceitaFundoTransparente(mImg)) {
      throw new ErroHttp(409, "fundo_transparente_nao_suportado", `O modelo de imagem ${mImg.rotulo ?? mImg.id} não gera fundo transparente. Escolha um GPT Image ou marque a área do assunto.`, {
        modelo_imagem_id: mImg.id,
      });
    }
    const o = aberta ?? await abrirFoto(bytes);
    const prompt = promptDoPreparo({ modo: "fundo_transparente", tipo, cenario: null, instrucao, guiaTexto: null, estilos: [], temAreasProtegidas: false, entradaRecortada: false });
    const tentar = async (t: string) => {
      const { tela, png } = await telaDoRecorte(o, t);
      const saida = await chamarImagem({
        clientId,
        modeloId: mImg.id,
        prompt,
        referencias: [],
        qualidade,
        tamanho: t,
        tamanhoFixo: true,
        editar: { bytes: png },
        fundo: "transparente",
        referencia: { tipo: REF_IMAGEM, id: imagem.id },
        criadoPor: ch.userId,
        tarefa: TAREFA_ESTUDIO,
        agente: AGENTE_GERADOR,
      });
      return { tela, saida };
    };
    let volta: Awaited<ReturnType<typeof tentar>>;
    try {
      volta = await tentar(tamanho);
    } catch (e) {
      const classico = tamanhoDeTrabalhoClassico(dim.largura, dim.altura);
      if (!(recusouTamanho(e) && classico !== tamanho)) throw e;
      tamanho = classico;
      volta = await tentar(classico);
    }
    somar(volta.saida);
    const falhou = (codigo: string, mensagem: string) =>
      new ErroHttp(502, codigo, `${mensagem} Nada foi gravado; o custo da chamada já foi cobrado.`, { custo_usd: arred6(custo), saldo_usd: saldo });
    const g = await abrirFoto(volta.saida.png).catch(() => null);
    if (!g) throw falhou("imagem_invalida", "O gerador devolveu uma imagem que não abre.");
    if (fracaoTransparenteDe(g) < 0.02) throw falhou("fundo_nao_veio_transparente", "O gerador devolveu a foto com fundo opaco.");
    const r = await recortePreservandoOriginal(o, g, volta.tela);
    if (r.situacao === "vazio") throw falhou("recorte_vazio", "O gerador não achou o assunto (a máscara veio vazia). Marque a área do assunto e tente de novo.");
    if (r.situacao === "desalinhado") {
      throw falhou("recorte_desalinhado", "O gerador redesenhou o assunto e a máscara não bate com a foto original. Tente de novo ou use uma foto com o assunto mais destacado do fundo.");
    }
    doRecorte.info = { alinhou: r.alinhou, erro: Math.round(r.erro * 100) / 100, situacao: r.situacao, aviso: avisoDoRecorte(r) };
    return r.png;
  };

  if (modo === "fundo_transparente") {
    final = await recortar();
    rota = "recorte";
  } else if (modo === "fundo_branco") {
    if (recorteNaEntrada) {
      final = await comporSobreBranco(bytes);
      rota = "recorte";
    } else if (protegidas.length) {
      const g = await gerar({ protegidas });
      somar(g.saida);
      final = await devolverOriginalNasAreas(g.trabalho, g.png, protegidas);
      rota = "gerador";
    } else {
      final = await comporSobreBranco(await recortar());
      rota = "recorte";
    }
  } else if (modo === "cenario") {
    if (recorteNaEntrada) {
      const g = await gerar({ protegidas: [] });
      somar(g.saida);
      final = await comporRecorteSobre(g.png, g.trabalho);
      rota = "gerador";
    } else if (protegidas.length) {
      const g = await gerar({ protegidas });
      somar(g.saida);
      final = await devolverOriginalNasAreas(g.trabalho, g.png, protegidas);
      rota = "gerador";
    } else {
      throw new ErroHttp(409, "recorte_ou_area_necessaria", "Para novo cenário preservando o assunto, faça antes o fundo transparente desta foto ou marque a área do assunto.");
    }
  } else {
    const g = await gerar({ protegidas });
    somar(g.saida);
    final = await devolverOriginalNasAreas(g.trabalho, g.png, protegidas);
    if (recorteNaEntrada) final = await aplicarAlfaDaOrigem(final, g.trabalho);
    rota = "gerador";
  }

  const derivada = derivadaDoPreparo(modo, rota);
  const caminho = `${clientId}/foto/derivadas/${crypto.randomUUID()}.png`;
  await salvarNoMesa(caminho, final, "image/png");
  const sha = await sha256Hex(final);
  const d = dimensoesDaImagem(final);
  const { data, error } = await servico().from("cliente_imagens").insert({
    client_id: clientId,
    origem: "mesa_foto",
    storage_bucket: "mesa",
    storage_path: caminho,
    nome: `${imagem.nome} (${ROTULO_DO_PREPARO[modo]})`.slice(0, 160),
    pasta: "Mesa Foto / Preparadas",
    categoria: imagem.categoria,
    tags: ["mesa_foto", `preparo:${modo}`, ...(derivada.gerada ? ["gerada"] : []), ...(modo === "fundo_transparente" ? ["sem_fundo"] : [])],
    descricao: modo === "fundo_transparente"
      ? `Sem fundo: pixels originais do assunto; do gerador veio só a máscara, alinhada à foto original.${doRecorte.info?.aviso ? ` ${doRecorte.info.aviso}` : ""}`.slice(0, 1000)
      : PROMESSA_DO_MODO[derivada.modo],
    derivada_de: imagem.id,
    gerada: derivada.gerada,
    modo: derivada.modo,
    kit_id: kit?.id ?? null,
    sha256: sha,
    largura: d?.largura ?? null,
    altura: d?.altura ?? null,
    aprovada: false,
  }).select(CAMPOS_IMAGEM).single();
  if (error || !data) {
    throw new ErroHttp(503, "gravacao_falhou", "A foto foi preparada, mas não entrou no acervo. Tente de novo.", { custo_usd: arred6(custo) });
  }
  return json({
    imagem: await comUrl(data as LinhaImagem),
    rota,
    modo_derivada: derivada.modo,
    promessa: PROMESSA_DO_MODO[derivada.modo],
    tamanho_de_trabalho: rota === "gerador" || modo !== "fundo_branco" || !recorteNaEntrada ? tamanho : null,
    recorte: doRecorte.info,
    aviso: doRecorte.info?.aviso ?? null,
    custo_usd: arred6(custo),
    saldo_usd: saldo,
    reserva_usada: reserva,
  });
}

/** Tamanho de reserva quando o gerador recusa o tamanho flexível: só os três clássicos do GPT Image. */
function tamanhoDeTrabalhoClassico(largura: number, altura: number): string {
  const r = largura / altura;
  if (r > 1.2) return "1536x1024";
  if (r < 0.83) return "1024x1536";
  return "1024x1024";
}

// ------------------------------------------------------------------ usar

async function enviar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const destino = String(corpo.destino ?? "");
  if (destino !== "arquivos" && destino !== "aprovacao") throw new ErroHttp(400, "destino_invalido", "destino: arquivos ou aprovacao.");
  const ids = Array.isArray(corpo.imagem_ids) ? Array.from(new Set(corpo.imagem_ids.map(String))) : [];
  if (!ids.length || ids.length > 30) throw new ErroHttp(400, "imagens_invalidas", "Escolha de 1 a 30 fotos.");
  const imagens = await lerImagens(clientId, ids);
  const faltando = ids.filter((i) => !imagens.some((x) => x.id === i));
  if (faltando.length) throw new ErroHttp(404, "imagem_fora_do_cliente", "Há foto que não está no acervo deste cliente.", { imagem_ids: faltando });
  // Referência da internet é uso interno para fidelidade: nunca vai ao cliente nem para Arquivos.
  const daInternet = imagens.filter((i) => (i.tags ?? []).includes(TAG_REFERENCIA_WEB)).map((i) => i.id);
  if (daInternet.length) {
    throw new ErroHttp(409, "referencia_web_nao_publica", "Foto de referência da internet é uso interno para fidelidade e não pode ser enviada. Envie as fotos geradas e aprovadas.", {
      imagem_ids: daInternet,
    });
  }
  if (destino === "aprovacao") {
    const semAprovacao = imagens.filter((i) => i.gerada && !i.aprovada).map((i) => i.id);
    if (semAprovacao.length) {
      throw new ErroHttp(409, "gerada_sem_aprovacao_interna", "Foto gerada só vai para a aprovação do cliente depois de aprovada pela equipe.", { imagem_ids: semAprovacao });
    }
  }
  const pasta = destino === "aprovacao" ? "materiais" : "base";
  const arquivos: { imagem_id: string; file_id: string; ja_existia: boolean; revisao_solicitada: boolean | null }[] = [];
  const avisos: string[] = [];
  for (const id of ids) {
    const img = imagens.find((x) => x.id === id)!;
    const chave = `mesa-foto:${img.id}:${destino}`;
    const { data: existente } = await servico().from("files").select("id, client_id, agency_approval_status").eq("idempotency_key", chave).maybeSingle();
    const ja = existente as { id: string; client_id: string; agency_approval_status: string | null } | null;
    let fileId: string;
    if (ja) {
      if (ja.client_id !== clientId) throw new ErroHttp(409, "chave_de_arquivo_em_uso", "O registro deste envio pertence a outro cliente.");
      fileId = ja.id;
    } else {
      const bytes = await baixar(img.storage_bucket, img.storage_path);
      const mime = mimeDe(bytes) ?? "image/png";
      const ext = extensaoDe(mime);
      fileId = crypto.randomUUID();
      const caminho = `${clientId}/${fileId}/v1/1-${nomeSeguro(img.nome)}.${ext}`;
      const { error: erroUpload } = await ch.doChamador.storage.from("files").upload(caminho, new Blob([new Uint8Array(bytes)], { type: mime }), {
        contentType: mime,
        upsert: false,
      });
      if (erroUpload) throw new ErroHttp(503, "envio_de_arquivo_falhou", "Não foi possível enviar a foto para Arquivos. Tente de novo.", { imagem_id: img.id, detalhe: erroUpload.message });
      const honestidade = img.gerada ? ` Imagem gerada por IA a partir de fotos reais (${img.modo ?? "ensaio"}).` : "";
      const { data: registro, error: erroRegistro } = await ch.doChamador.rpc("create_file_record", {
        p_file: {
          id: fileId,
          client_id: clientId,
          file_name: img.nome,
          file_url: `files://${caminho}`,
          file_type: "foto",
          mime_type: mime,
          extension: ext,
          storage_bucket: "files",
          storage_path: caminho,
          size_bytes: bytes.byteLength,
          sha256: img.sha256 ?? await sha256Hex(bytes),
          folder: pasta,
          tags: ["mesa_foto", ...(img.gerada ? ["gerada"] : [])],
          status: "ready",
          version: 1,
          description: `Foto da Mesa Foto.${honestidade}`.slice(0, 1000),
          idempotency_key: chave,
        },
      });
      if (erroRegistro || !registro) {
        await ch.doChamador.storage.from("files").remove([caminho]).catch(() => {});
        throw new ErroHttp(503, "registro_de_arquivo_falhou", "A foto subiu, mas o registro em Arquivos falhou. Tente de novo.", { imagem_id: img.id, detalhe: erroRegistro?.message ?? null });
      }
      fileId = (registro as { id: string }).id;
    }
    let revisao: boolean | null = null;
    if (destino === "aprovacao") {
      // Mesmo caminho da tela de Arquivos: revisão interna da agência, depois liberação ao cliente.
      if (ja && ja.agency_approval_status && ja.agency_approval_status !== "not_requested") {
        revisao = true;
      } else {
        const { error } = await ch.doChamador.rpc("request_file_agency_review", { p_file_id: fileId });
        revisao = !error;
        if (error) avisos.push(`A foto ${img.nome} foi para Arquivos, mas a revisão não foi pedida: ${error.message}`);
      }
    }
    arquivos.push({ imagem_id: img.id, file_id: fileId, ja_existia: !!ja, revisao_solicitada: revisao });
  }
  return json({ file_ids: arquivos.map((a) => a.file_id), arquivos, pasta, aviso: avisos.length ? avisos.join(" ") : null, custo_usd: 0 });
}

async function baixarFotos(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const ids = Array.isArray(corpo.imagem_ids) ? Array.from(new Set(corpo.imagem_ids.map(String))) : [];
  if (!ids.length || ids.length > 100) throw new ErroHttp(400, "imagens_invalidas", "Escolha de 1 a 100 fotos.");
  const imagens = await lerImagens(clientId, ids);
  const usados = new Set<string>();
  const arquivos = await Promise.all(ids.map(async (id) => {
    const img = imagens.find((x) => x.id === id);
    if (!img) return { imagem_id: id, nome: null, arquivo: null, url: null, erro: "imagem_fora_do_cliente" };
    const ext = (img.storage_path.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "png").toLowerCase();
    let arquivo = `${nomeSeguro(img.nome)}.${ext}`;
    for (let n = 2; usados.has(arquivo); n++) arquivo = `${nomeSeguro(img.nome)}-${n}.${ext}`;
    usados.add(arquivo);
    return { imagem_id: id, nome: img.nome, arquivo, url: await urlAssinada(img.storage_bucket, img.storage_path, arquivo), gerada: !!img.gerada, aprovada: !!img.aprovada, referencia_web: (img.tags ?? []).includes(TAG_REFERENCIA_WEB) };
  }));
  return json({ arquivos, validade_s: URL_ASSINADA_S, custo_usd: 0 });
}

// ------------------------------------------------------------------ busca segura de imagem externa

async function hostResolvePublico(host: string): Promise<boolean> {
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return true; // IP literal já conferido em urlPublicaSegura
  const resolver = (Deno as unknown as { resolveDns?: (h: string, t: "A" | "AAAA") => Promise<string[]> }).resolveDns;
  if (typeof resolver !== "function") return true;
  const [v4, v6] = await Promise.all([resolver(host, "A").catch(() => [] as string[]), resolver(host, "AAAA").catch(() => [] as string[])]);
  return !v4.some((ip) => ipv4Interno(ip)) && !v6.some((ip) => ipv6Interno(ip));
}

/** Busca https pública com limite de bytes e de saltos; nada de host interno. */
async function buscarSeguro(inicial: string, opcoes: { maxBytes: number; aceitar?: string; timeoutMs?: number }): Promise<{ url: URL; tipo: string; bytes: Uint8Array } | null> {
  let url = urlPublicaSegura(inicial);
  for (let salto = 0; url && salto < 4; salto++) {
    if (!(await hostResolvePublico(url.hostname))) return null;
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": AGENTE_HTTP, ...(opcoes.aceitar ? { Accept: opcoes.aceitar } : {}) },
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_BUSCA_MS),
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!destino) return null;
      try {
        url = urlPublicaSegura(new URL(destino, url).toString());
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    if (Number(res.headers.get("content-length") || 0) > opcoes.maxBytes) {
      await res.body.cancel().catch(() => {});
      return null;
    }
    const partes: Uint8Array[] = [];
    let total = 0;
    const leitor = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        total += value.byteLength;
        if (total > opcoes.maxBytes) {
          await leitor.cancel().catch(() => {});
          return null;
        }
        partes.push(value);
      }
    } catch {
      return null;
    }
    const bytes = new Uint8Array(total);
    let pos = 0;
    for (const p of partes) {
      bytes.set(p, pos);
      pos += p.byteLength;
    }
    return { url, tipo: (res.headers.get("content-type") || "").toLowerCase(), bytes };
  }
  return null;
}

// ------------------------------------------------------------------ biblioteca

async function bibliotecaSalvar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const bruto = (corpo.item && typeof corpo.item === "object" ? corpo.item : {}) as Record<string, unknown>;
  // Cópia de um item da agência (ou do próprio cliente) para o cliente.
  const copiarDe = bruto.origem_id ?? bruto.copiar_de;
  if (copiarDe != null && copiarDe !== "") {
    const origemId = idDe(copiarDe, "origem_id");
    const [origem] = await lerItensDaBiblioteca(clientId, [origemId]);
    if (!origem) throw new ErroHttp(404, "item_inexistente", "Item da biblioteca não encontrado.");
    const { id: _id, client_id: _c, ...resto } = origem as LinhaBiblioteca & Record<string, unknown>;
    delete (resto as Record<string, unknown>).criado_em;
    delete (resto as Record<string, unknown>).atualizado_em;
    delete (resto as Record<string, unknown>).criado_por;
    const { data, error } = await servico().from("foto_biblioteca").insert({ ...resto, client_id: clientId, destaque: false, criado_por: ch.userId }).select("*").single();
    if (error || !data) throw new ErroHttp(503, "gravacao_falhou", "Não foi possível copiar o item.");
    return json({ item: data, copiado_de: origemId, custo_usd: 0 });
  }
  const item = normalizarItemBiblioteca(bruto);
  if (item.storage_path && !caminhoDoClienteNoMesa(clientId, item.storage_path, true)) {
    throw new ErroHttp(400, "caminho_invalido", "A imagem precisa estar na pasta do cliente no bucket mesa.");
  }
  if (bruto.id != null) {
    const id = idDe(bruto.id, "id");
    const { data, error } = await servico().from("foto_biblioteca").update(item).eq("id", id).eq("client_id", clientId).select("*").maybeSingle();
    if (error) throw new ErroHttp(503, "gravacao_falhou", "Não foi possível salvar o item.");
    if (!data) throw new ErroHttp(404, "item_inexistente", "Só itens do próprio cliente podem ser editados. Copie o item da agência antes.");
    return json({ item: data, custo_usd: 0 });
  }
  const { data, error } = await servico().from("foto_biblioteca").insert({ ...item, client_id: clientId, criado_por: ch.userId }).select("*").single();
  if (error || !data) throw new ErroHttp(503, "gravacao_falhou", "Não foi possível salvar o item.");
  return json({ item: data, custo_usd: 0 });
}

async function buscarNoOpenverse(q: unknown, licenca: unknown, pagina: unknown) {
  const url = urlDoOpenverse(q, licenca, pagina);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": AGENTE_HTTP, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_BUSCA_MS) });
  } catch {
    throw new ErroHttp(504, "openverse_indisponivel", "A busca de referências não respondeu a tempo. Tente de novo.");
  }
  if (res.status === 429) {
    await res.body?.cancel().catch(() => {});
    // Sem cadastro o Openverse aceita 20 buscas por minuto e 200 por dia (para a agência toda).
    throw new ErroHttp(429, "openverse_limite", "A busca pública de referências chegou ao limite (20 buscas por minuto e 200 por dia, sem cadastro). Espere um minuto; se persistir, o limite do dia acabou e volta amanhã.");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new ErroHttp(502, "openverse_indisponivel", "A busca de referências falhou. Tente de novo.");
  }
  const corpo = await res.json().catch(() => null) as Record<string, unknown> | null;
  return { itens: itensDoOpenverse(corpo), total: typeof corpo?.result_count === "number" ? corpo.result_count : null };
}

async function referenciasBuscar(_ch: Chamador, corpo: Record<string, unknown>) {
  const { itens, total } = await buscarNoOpenverse(corpo.q, corpo.licenca, corpo.pagina);
  const pagina = Math.max(1, Math.min(OPENVERSE_MAX_PAGINA, Math.round(Number(corpo.pagina) || 1)));
  return json({ itens, total, pagina, ultima_pagina: OPENVERSE_MAX_PAGINA, fonte: "Openverse", custo_usd: 0 });
}

async function referenciaImportar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  // A tela manda { client_id, categoria, referencia: { titulo, imagem_url, fonte_url, licenca, licenca_rotulo, autor, autor_url } }.
  const r = (corpo.referencia && typeof corpo.referencia === "object" && !Array.isArray(corpo.referencia) ? corpo.referencia : corpo) as Record<string, unknown>;
  const url = urlPublicaSegura(r.imagem_url);
  if (!url) throw new ErroHttp(400, "url_invalida", "Endereço da imagem inválido: use https público.");
  const titulo = limpo(r.titulo, 160) || "Referência importada";
  // Guarda a licença legível (licenca_rotulo da busca) e, sem ela, o código cru (cc0, by, by-sa...).
  const licenca = limpo(r.licenca_rotulo, 120) || limpo(r.licenca, 120);
  const codigoDaLicenca = limpo(r.licenca, 40).toLowerCase();
  if (!licenca) throw new ErroHttp(400, "licenca_obrigatoria", "Informe a licença da referência (vem da busca).");
  const { data: ja } = await servico().from("foto_biblioteca").select("*").eq("client_id", clientId).eq("tipo", "referencia").eq("imagem_url", url.toString()).limit(1);
  const existente = ((ja as LinhaBiblioteca[] | null) ?? [])[0];
  if (existente) {
    return json({ item: existente, url: existente.storage_path ? await urlAssinada("mesa", existente.storage_path) : existente.imagem_url, ja_existia: true, custo_usd: 0 });
  }
  const buscado = await buscarSeguro(url.toString(), { maxBytes: MAX_BYTES_REFERENCIA, aceitar: "image/*" });
  const mime = buscado ? mimeDe(buscado.bytes) : null;
  if (!buscado || !mime) throw new ErroHttp(502, "imagem_indisponivel", "Não foi possível baixar a imagem (ou ela não é JPEG, PNG ou WebP).");
  const caminho = `${clientId}/foto/referencias/${crypto.randomUUID()}.${extensaoDe(mime)}`;
  await salvarNoMesa(caminho, buscado.bytes, mime);
  const fonte = urlPublicaSegura(r.fonte_url);
  const autorUrl = urlPublicaSegura(r.autor_url);
  const categoria = normalizarItemBiblioteca({ tipo: "referencia", categoria: corpo.categoria ?? "estilo", titulo, storage_path: caminho }).categoria;
  const { data, error } = await servico().from("foto_biblioteca").insert({
    client_id: clientId,
    tipo: "referencia",
    categoria,
    titulo,
    imagem_url: url.toString(),
    storage_path: caminho,
    fonte_nome: limpoOuNulo(r.fonte_nome, 200) ?? url.hostname,
    fonte_url: fonte ? fonte.toString() : null,
    licenca,
    autor: limpoOuNulo(r.autor, 200),
    autor_url: autorUrl ? autorUrl.toString() : null,
    tags: Array.from(new Set([
      ...listaDeTextos(r.tags ?? corpo.tags, 17, 60).map((t) => t.toLowerCase()),
      ...(typeof r.id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(r.id) ? [`openverse:${r.id}`] : []),
      ...(codigoDaLicenca && /^[a-z0-9.-]{2,20}$/.test(codigoDaLicenca) ? [`licenca:${codigoDaLicenca}`] : []),
    ])),
    destaque: false,
    uso: limpoOuNulo(r.uso ?? corpo.uso, 600),
    criado_por: ch.userId,
  }).select("*").single();
  if (error || !data) {
    await servico().storage.from("mesa").remove([caminho]).catch(() => {});
    throw new ErroHttp(503, "gravacao_falhou", "Não foi possível guardar a referência.");
  }
  return json({ item: data, url: await urlAssinada("mesa", caminho), ja_existia: false, custo_usd: 0 });
}

// ------------------------------------------------------------------ agente

type LinhaMensagem = { papel: string; conteudo: string; criado_em: string };

async function conversaDoAgente(ch: Chamador, clientId: string, conversaId: unknown, referenciaId: string | null, abrirNova = false): Promise<string> {
  if (!abrirNova && conversaId != null && conversaId !== "") {
    const id = idDe(conversaId, "conversa_id");
    const { data } = await servico().from("agente_conversas").select("id, client_id, referencia_tipo").eq("id", id).maybeSingle();
    const c = data as { id: string; client_id: string; referencia_tipo: string | null } | null;
    if (!c || c.client_id !== clientId || c.referencia_tipo !== REF_CONVERSA) throw new ErroHttp(404, "conversa_inexistente", "Conversa não encontrada para este cliente.");
    return c.id;
  }
  let q = servico().from("agente_conversas").select("id").eq("client_id", clientId).eq("agente", AGENTE_DIRETOR).eq("referencia_tipo", REF_CONVERSA);
  q = referenciaId ? q.eq("referencia_id", referenciaId) : q.is("referencia_id", null);
  // "Nova conversa" na tela abre outra de verdade (antes reabria a última do mesmo kit).
  const { data } = abrirNova ? { data: [] } : await q.order("criado_em", { ascending: false }).limit(1);
  const achada = ((data as { id: string }[] | null) ?? [])[0];
  if (achada) return achada.id;
  const { data: nova, error } = await servico().from("agente_conversas")
    .insert({ client_id: clientId, agente: AGENTE_DIRETOR, referencia_tipo: REF_CONVERSA, referencia_id: referenciaId, criado_por: ch.userId })
    .select("id").single();
  if (error || !nova) throw new ErroHttp(503, "conversa_nao_criada", "Não foi possível abrir a conversa com o diretor de fotografia.");
  return (nova as { id: string }).id;
}

async function gravarMensagens(conversaId: string, clientId: string, msgs: { papel: "usuario" | "agente"; conteudo: string; anexos?: unknown[]; uso_id?: string | null }[]) {
  const base = Date.now();
  const { data, error } = await servico().from("agente_mensagens").insert(msgs.map((m, i) => ({
    conversa_id: conversaId,
    client_id: clientId,
    criado_em: new Date(base + i).toISOString(),
    papel: m.papel,
    conteudo: m.conteudo.slice(0, 20_000),
    anexos: m.anexos ?? [],
    uso_id: m.uso_id || null,
  }))).select("id, criado_em");
  if (error) {
    // A resposta já foi cobrada: a tela recebe a resposta mesmo sem o histórico gravado.
    console.error("[mesa-foto] mensagens nao gravadas", { conversa_id: conversaId, code: error.code });
    return [];
  }
  return ((data as { id: string; criado_em: string }[] | null) ?? []).slice().sort((a, b) => (a.criado_em < b.criado_em ? -1 : 1)).map((m) => m.id);
}

/** Anexos da conversa: ids do acervo ou caminhos do bucket mesa na pasta do cliente (até 4). */
async function anexosDaConversa(clientId: string, bruto: unknown): Promise<{ imagens: ImagemEntrada[]; registro: unknown[]; doAcervo: LinhaImagem[] }> {
  const itens = (Array.isArray(bruto) ? bruto.slice(0, 4) : []).map((x) => {
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      return String(o.imagem_id ?? o.caminho ?? "");
    }
    return String(x ?? "");
  });
  const ids = itens.filter((x) => UUID.test(x));
  const caminhos = itens.map((x) => caminhoDoClienteNoMesa(clientId, x)).filter((x): x is string => !!x);
  const doAcervo = await lerImagens(clientId, ids);
  const alvos = [
    ...doAcervo.map((i) => ({ bucket: i.storage_bucket, caminho: i.storage_path, nome: i.nome, registro: { imagem_id: i.id } })),
    ...caminhos.map((c) => ({ bucket: "mesa", caminho: c, nome: c.split("/").pop() ?? "anexo", registro: { caminho: c } })),
  ];
  const imagens = await emParalelo(alvos, 4, (a) => baixarReduzida(a.bucket, a.caminho, 1024, a.nome).catch(() => null));
  return { imagens: imagens.filter((x): x is ImagemEntrada => !!x), registro: alvos.map((a) => a.registro), doAcervo };
}

async function agenteConversar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const mensagem = limpo(corpo.mensagem, 4000);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva a mensagem para o diretor de fotografia.");
  let ensaio: LinhaEnsaio | null = null;
  if (corpo.ensaio_id != null && corpo.ensaio_id !== "") {
    ensaio = await ensaioComAcesso(ch, idDe(corpo.ensaio_id, "ensaio_id"));
    if (ensaio.client_id !== clientId) throw new ErroHttp(409, "ensaio_de_outro_cliente", "Este ensaio pertence a outro cliente.");
  }
  const kitId = ensaio?.kit_id ?? (corpo.kit_id != null && corpo.kit_id !== "" ? idDe(corpo.kit_id, "kit_id") : null);
  const kit = kitId ? await lerKit(ch, kitId) : null;
  if (kit && kit.client_id !== clientId) throw new ErroHttp(409, "kit_de_outro_cliente", "Este kit pertence a outro cliente.");
  const refs = kit ? await lerRefs(kit) : [];
  // Anexo marcado pela tela como estilo (print de perfil, moodboard) nunca é o assunto.
  const anexosDeEstilo = new Set((Array.isArray(corpo.anexos) ? corpo.anexos : [])
    .filter((x) => x && typeof x === "object" && (x as Record<string, unknown>).papel === "estilo")
    .map((x) => String((x as Record<string, unknown>).imagem_id ?? "")));
  const conversaId = await conversaDoAgente(ch, clientId, corpo.conversa_id, ensaio?.id ?? kit?.id ?? null, corpo.nova_conversa === true);
  const [contexto, diretor, historico, anexos, biblioteca, kitsDoCli] = await Promise.all([
    contextoDoCliente(clientId, corpo.campanha_id),
    modeloDeTexto("diretor_arte", corpo.modelo_id),
    servico().from("agente_mensagens").select("papel, conteudo, criado_em").eq("conversa_id", conversaId).order("criado_em", { ascending: false }).limit(MAX_HISTORICO_CONVERSA),
    anexosDaConversa(clientId, corpo.anexos),
    servico().from("foto_biblioteca").select("id, client_id, tipo, categoria, titulo, destaque").eq("tipo", "prompt")
      .or(`client_id.is.null,client_id.eq.${clientId}`)
      .order("destaque", { ascending: false }).limit(40),
    kitsDoCliente(clientId).catch(() => [] as KitExistente[]),
  ]);
  const categoria = kit ? categoriaDoKit(kit.tipo) : null;
  const prompts = ((biblioteca.data as { id: string; client_id: string | null; categoria: string; titulo: string; destaque: boolean }[] | null) ?? [])
    .sort((a, b) => Number(b.categoria === categoria) - Number(a.categoria === categoria))
    .slice(0, 15)
    .map((p) => ({ id: p.id, titulo: p.titulo, categoria: p.categoria, do_cliente: !!p.client_id }));
  const dados = {
    cliente: contexto.dados,
    kit: kit ? resumoDoKit(kit, refs) : null,
    ensaio: ensaio
      ? {
        id: ensaio.id,
        receita_id: ensaio.receita_id,
        finalidade: ensaio.finalidade,
        formatos: ensaio.formatos,
        conceito: (ensaio.direcao as Record<string, unknown>).conceito ?? null,
        tomadas: ensaio.tomadas.map((t) => {
          const ultima = t.versoes[t.versoes.length - 1];
          const conf = ultima && "pontos" in ultima.conferencia ? ultima.conferencia : null;
          return {
            id: t.id,
            nome: t.nome,
            status: t.status,
            modo: t.modo,
            preset_id: t.camera.preset_id,
            cenario: t.cenario,
            luz: t.luz,
            formato: t.formato,
            motivo_bloqueio: t.motivo_bloqueio,
            versoes: t.versoes.length,
            ultima_rejeicao: t.versoes.filter((v) => v.aprovada === false).pop()?.motivo_rejeicao ?? null,
            ultima_conferencia: conf ? { resumo: conf.resumo, alertas: conf.alertas } : null,
          };
        }),
      }
      : null,
    kits_do_cliente: kitsDoCli.slice(0, 20).map((k) => ({
      id: k.id,
      nome: k.nome,
      variante: k.variante,
      status: k.status,
      fotos_do_produto: k.refs.filter((r) => r.papel === "identidade").length,
      fotos_da_embalagem: k.refs.filter((r) => r.papel === "embalagem").length,
    })),
    anexos_desta_mensagem: anexos.doAcervo.map((i) => ({
      imagem_id: i.id,
      nome: i.nome,
      leitura: limpo(i.descricao, 300) || null,
      referencia_da_internet: (i.tags ?? []).includes(TAG_REFERENCIA_WEB),
      gerada: !!i.gerada,
      referencia_de_estilo: anexosDeEstilo.has(i.id),
    })),
    tipos_de_variacao: TIPOS_DE_VARIACAO.map((t) => ({ id: t.id, nome: t.nome, direcao: t.direcao, foco: t.foco })),
    biblioteca_de_prompts: prompts,
    presets: PRESETS.map((p) => ({ id: p.id, nome: p.nome })),
    formatos: ensaio?.formatos ?? FORMATOS,
  };
  const anteriores = ((historico.data as LinhaMensagem[] | null) ?? []).slice().reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: m.conteudo.slice(0, 4000) }));
  const saida = await chamarTexto({
    clientId,
    tarefa: TAREFA_ESTUDIO,
    agente: AGENTE_DIRETOR,
    modeloId: diretor.id,
    raciocinio: raciocinioPara(diretor),
    sistema: `${SISTEMA_AGENTE}\n\nDADOS REAIS DESTA CONVERSA:\n${JSON.stringify(dados)}`,
    mensagens: [...anteriores, { papel: "usuario", conteudo: mensagem, imagens: anexos.imagens.length ? anexos.imagens : undefined }],
    esquemaJson: ESQUEMA_AGENTE,
    maxTokensSaida: 12_000,
    timeoutMs: TIMEOUT_TEXTO_FOTO_MS,
    referencia: { tipo: ensaio ? REF_ENSAIO : kit ? REF_KIT : REF_CONVERSA, id: ensaio?.id ?? kit?.id ?? conversaId },
    criadoPor: ch.userId,
  });
  const r = (saida.json ?? {}) as Record<string, unknown>;
  const resposta = limpo(r.resposta, 6000) || "Sem resposta do diretor.";
  const kitsValidos = Array.from(new Set([...(kit ? [kit.id] : []), ...kitsDoCli.map((k) => k.id)]));
  const sugestoes = normalizarSugestoes(r.sugestoes, {
    tomadaIds: ensaio?.tomadas.map((t) => t.id) ?? [],
    formatos: ensaio?.formatos ?? FORMATOS,
    kitIds: kitsValidos,
    kitPadrao: kit?.id ?? null,
  })
    // Sem ensaio aberto não há tomada para criar ou ajustar.
    .filter((s) => ensaio || (s.tipo !== "tomada_nova" && s.tipo !== "ajuste_tomada"));
  // Proativo: foto anexada sem kit e sem nenhuma sugestão vira "identificar produto" (a equipe decide aplicar).
  const anexadasDoProduto = anexos.doAcervo
    .filter((i) => !(i.tags ?? []).includes(TAG_REFERENCIA_WEB) && !i.gerada && !anexosDeEstilo.has(i.id))
    .map((i) => i.id);
  if (!kit && !sugestoes.length && anexadasDoProduto.length) {
    const [extra] = normalizarSugestoes([{
      tipo: "identificar_produto",
      titulo: "Identificar o produto pela embalagem ou foto",
      motivo: "Lê marca, modelo e variante, pesquisa o produto real na internet, baixa fotos de referência (uso interno) e salva o kit.",
      imagem_ids: anexadasDoProduto.slice(0, 6),
    }], { tomadaIds: [] });
    if (extra) sugestoes.push(extra);
  }
  const mensagemIds = await gravarMensagens(conversaId, clientId, [
    { papel: "usuario", conteudo: mensagem, anexos: anexos.registro },
    { papel: "agente", conteudo: resposta, anexos: sugestoes.length ? [{ tipo: "sugestoes", sugestoes }] : [], uso_id: saida.usoId },
  ]);
  return json({
    conversa_id: conversaId,
    resposta,
    ...blocosDaResposta(resposta),
    sugestoes,
    // A conversa não grava kit: kit sai salvo de identificar_produto ou kit_sugerir.
    kit_ids: [],
    mensagem_ids: mensagemIds,
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    reserva_usada: saida.reservaUsada ?? null,
  });
}

async function agenteAplicar(ch: Chamador, corpo: Record<string, unknown>) {
  let ensaio: LinhaEnsaio | null = null;
  if (corpo.ensaio_id != null && corpo.ensaio_id !== "") ensaio = await ensaioComAcesso(ch, idDe(corpo.ensaio_id, "ensaio_id"));
  const clientId = ensaio?.client_id ?? idDe(corpo.client_id, "client_id");
  if (!ensaio) await garantirAcesso(ch, clientId);
  // A sugestão passa de novo pela mesma conferência (a tela não é fonte de verdade).
  const kitsCli = await kitsDoCliente(clientId).catch(() => [] as KitExistente[]);
  const kitPedido = corpo.kit_id != null && UUID.test(String(corpo.kit_id)) ? String(corpo.kit_id) : null;
  const [s] = normalizarSugestoes([corpo.sugestao], {
    tomadaIds: ensaio?.tomadas.map((t) => t.id) ?? [],
    formatos: ensaio?.formatos ?? FORMATOS,
    kitIds: kitsCli.map((k) => k.id),
    kitPadrao: ensaio?.kit_id ?? (kitPedido && kitsCli.some((k) => k.id === kitPedido) ? kitPedido : null),
  });
  if (!s) throw new ErroHttp(400, "sugestao_invalida", "Sugestão inválida ou de uma tomada que não existe mais.");
  if (s.tipo === "tomada_nova" || s.tipo === "ajuste_tomada") {
    if (!ensaio) throw new ErroHttp(400, "ensaio_obrigatorio", "Abra um ensaio para aplicar sugestões de tomada.");
    return await aplicarNaTomada(ch, ensaio, s);
  }
  if (s.tipo === "identificar_produto") {
    // Pesquisa web e download: resposta com fôlego (agente_aplicar é ação longa).
    return await produtoIdentificar(ch, { client_id: clientId, imagem_ids: s.imagem_ids, salvar_kit: true });
  }
  if (s.tipo === "plano_de_variacoes") {
    const { kit, refs } = await kitDoLote(ch, clientId, s.kit_id);
    const ctxVagas = { temIdentidade: temIdentidade(kit, refs), temEmbalagem: refs.some((r) => r.papel === "embalagem") };
    const variacoes: VariacaoSugerida[] = s.variacoes ?? [];
    const vagas = vagasDoPlano(variacoes, s.quantidade, s.tipos, ctxVagas);
    const textos = new Map<string, Partial<TextoDaVaga>>(
      vagas.map((v, i) => [v.id, variacoes[i] ? { nome: variacoes[i].nome, cenario: variacoes[i].cenario, luz: variacoes[i].luz, props: variacoes[i].props, formato: variacoes[i].formato } : {}]),
    );
    const formatos = formatosDoLote(corpo.formatos, [
      ...variacoes.map((v) => v.formato).filter((f): f is string => !!f),
      ...vagas.map((v) => v.tipo.formato),
    ]);
    const tomadas = tomadasDasVagas(vagas, textos, { kit, refs, formatos });
    const estimativa = await estimarEnsaio(tomadas, refs, { modeloImagemId: corpo.modelo_imagem_id, qualidade: lerQualidade(corpo.qualidade) });
    const lacunas = !ctxVagas.temIdentidade && ctxVagas.temEmbalagem
      ? ["Sem foto do produto fora da caixa: as variações usam a embalagem como assunto. Rode Identificar produto para tirar da caixa."]
      : [];
    const novo = await gravarEnsaioNovo(ch, {
      clientId,
      kit,
      receitaId: RECEITA_VARIACOES,
      finalidade: "anúncios, feed e loja",
      formatos,
      tomadas,
      direcao: {
        tipo: "variacoes",
        origem: "diretor",
        conceito: s.motivo || s.titulo,
        quantidade: tomadas.length,
        tipos: vagas.map((v) => v.tipo.id),
        referencias_estilo: [],
        lacunas_que_limitam: lacunas,
        perguntas: [],
        estimativa,
      },
      pedido: s.titulo,
      custoUsd: 0,
    });
    return json({ ensaio: novo, estimativa_usd: estimativa.total_usd, estimativa, lacunas, custo_usd: 0 });
  }
  if (s.tipo === "campanha") {
    const { kit, refs } = await kitDoLote(ch, clientId, s.kit_id);
    const fotos = fotosPadraoDaCampanha(s.quantidade ?? 6, s.fotos ?? []);
    const formatos = formatosDoLote(corpo.formatos, fotos.map((f) => f.formato ?? "4:5"));
    const estilos = await idsDeEstiloValidos(clientId, s.referencias_estilo_ids ?? []);
    const modelo = s.modelo ?? lerModeloSintetico(null);
    const comProduto = temIdentidade(kit, refs);
    const resultado = await criarEnsaioDeCampanha(ch, {
      clientId,
      kit,
      refs,
      fotos,
      guia: s.guia_de_estilo ?? null,
      modelo,
      estilos,
      formatos,
      finalidade: "campanha e feed",
      conceito: s.motivo || s.titulo,
      lacunas: comProduto ? [] : ["Sem foto do produto fora da caixa: a campanha usa a embalagem. Rode Identificar produto para ter o produto em uso."],
      pedido: s.titulo,
      custoUsd: 0,
      modeloTextoId: null,
      qualidade: lerQualidade(corpo.qualidade),
      modeloImagemId: corpo.modelo_imagem_id,
    });
    return json({ ...resultado, custo_usd: 0 });
  }
  if (s.tipo === "prompt") {
    const kit = ensaio ? await lerKit(ch, ensaio.kit_id) : null;
    const item = normalizarItemBiblioteca({
      tipo: "prompt",
      categoria: s.categoria ?? (kit ? categoriaDoKit(kit.tipo) : "estilo"),
      titulo: s.titulo,
      prompt_pt: s.prompt_pt,
      prompt_en: s.prompt_en,
      negativo: s.negativo,
      fonte_nome: "Diretor de fotografia da Mesa Foto",
      tags: ["agente"],
    });
    const { data, error } = await servico().from("foto_biblioteca").insert({ ...item, client_id: clientId, criado_por: ch.userId }).select("*").single();
    if (error || !data) throw new ErroHttp(503, "gravacao_falhou", "Não foi possível guardar o prompt na biblioteca.");
    return json({ item: data, custo_usd: 0 });
  }
  const { itens, total } = await buscarNoOpenverse(s.busca, "comercial", 1);
  return json({ itens, total, busca: s.busca, fonte: "Openverse", custo_usd: 0 });
}

// ------------------------------------------------------------------ porta

/**
 * biblioteca_semear {} -> { inseridos, ja_existiam, total, versao }
 * Só admin. Grava a biblioteca de prompts da agência (client_id nulo) sem
 * duplicar: pula o que já existe com o mesmo título e tipo. Sem IA, sem custo.
 */
async function ehAdmin(ch: Chamador): Promise<boolean> {
  const { data: admin, error: erroPapel } = await servico().rpc("has_role", { _user_id: ch.userId, _role: "admin" });
  if (erroPapel) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  return admin === true;
}

async function garantirAdmin(ch: Chamador) {
  if (!(await ehAdmin(ch))) throw new ErroHttp(403, "somente_admin", "Só admin grava a biblioteca da agência.");
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Coluna nova (02_mesa_foto_v2.sql) ainda não aplicada no banco. */
const colunaAusente = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|Could not find the '.*' column/i.test(e.message ?? ""));

/**
 * Atualiza o item da biblioteca; sem as colunas novas (miniatura_url,
 * exemplo), grava o resto e devolve o aviso da migration pendente.
 */
async function atualizarItemDaBiblioteca(id: string, campos: Record<string, unknown>): Promise<{ item: LinhaBiblioteca; aviso: string | null }> {
  const primeira = await servico().from("foto_biblioteca").update(campos).eq("id", id).select("*").single();
  if (!primeira.error && primeira.data) return { item: primeira.data as LinhaBiblioteca, aviso: null };
  if (colunaAusente(primeira.error)) {
    const { miniatura_url: _m, exemplo: _e, ...resto } = campos;
    const segunda = await servico().from("foto_biblioteca").update(resto).eq("id", id).select("*").single();
    if (!segunda.error && segunda.data) {
      return { item: segunda.data as LinhaBiblioteca, aviso: "Miniatura e crédito completo do exemplo ficaram de fora: aplique docs/mesa-foto/migrations/02_mesa_foto_v2.sql." };
    }
  }
  throw new ErroHttp(503, "gravacao_falhou", "Não foi possível gravar o exemplo no item da biblioteca.");
}

/**
 * biblioteca_ilustrar { limite? } -> { ilustrados, sem_resultado, pendentes, itens, aviso }
 * Só admin, sem IA paga. Para cada prompt da agência sem imagem, busca no
 * Openverse uma fotografia de uso comercial que ilustre o prompt e grava a
 * imagem, a miniatura e o crédito (licença, autor, página). Respeita o limite
 * de 20 buscas por minuto do Openverse sem cadastro: um lote por chamada;
 * chame de novo enquanto houver pendentes.
 */
async function bibliotecaIlustrar(ch: Chamador, corpo: Record<string, unknown>) {
  await garantirAdmin(ch);
  const pedido = Math.round(Number(corpo.limite));
  const limite = Number.isFinite(pedido) && pedido > 0 ? Math.min(ILUSTRAR_MAXIMO, pedido) : ILUSTRAR_PADRAO;
  const semImagem = () => servico().from("foto_biblioteca").select("id, titulo, categoria, prompt_en, tags, fonte_nome, fonte_url, licenca, autor, destaque", { count: "exact" })
    .is("client_id", null).eq("tipo", "prompt").is("imagem_url", null).is("storage_path", null).not("tags", "cs", `{${TAG_SEM_EXEMPLO}}`);
  const { data, error, count } = await semImagem().order("destaque", { ascending: false }).order("titulo").limit(limite);
  if (error) throw new ErroHttp(503, "biblioteca_indisponivel", "Não foi possível ler a biblioteca da agência.");
  const itens = (data as (LinhaBiblioteca & { destaque: boolean })[] | null) ?? [];
  const { data: usadas } = await servico().from("foto_biblioteca").select("imagem_url").is("client_id", null).not("imagem_url", "is", null).limit(5000);
  const jaUsadas = new Set(((usadas as { imagem_url: string }[] | null) ?? []).map((u) => u.imagem_url));
  const feitos: { id: string; titulo: string; imagem_url: string | null; busca: string }[] = [];
  let semResultado = 0;
  let parouNoLimite = false;
  let aviso: string | null = null;
  let buscas = 0;
  const buscar = async (q: string) => {
    // 20 buscas por minuto: uma a cada 3,1 s.
    if (buscas++) await esperar(3_100);
    const res = await fetch(urlDoOpenverse(q, "comercial", 1, { categoria: "photograph", porPagina: 12 }), {
      headers: { "User-Agent": AGENTE_HTTP, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_BUSCA_MS),
    }).catch(() => null);
    if (!res) return null;
    if (res.status === 429) {
      await res.body?.cancel().catch(() => {});
      parouNoLimite = true;
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return [];
    }
    return itensDoOpenverse(await res.json().catch(() => null));
  };
  const escolher = (lista: ReturnType<typeof itensDoOpenverse>) =>
    lista.find((x) => !jaUsadas.has(x.imagem_url) && (x.largura == null || x.largura >= 640) && (x.altura == null || x.altura >= 480)) ?? null;
  for (const item of itens) {
    if (parouNoLimite) break;
    const busca = termosDeBusca(item);
    let achado = escolher((await buscar(busca)) ?? []);
    if (!achado && !parouNoLimite) {
      // Segunda tentativa mais larga: duas primeiras palavras e a categoria.
      const larga = busca.split(" ").slice(0, 2).join(" ");
      if (larga && larga !== busca) achado = escolher((await buscar(larga)) ?? []);
    }
    if (parouNoLimite) break;
    if (!achado) {
      semResultado++;
      await servico().from("foto_biblioteca").update({ tags: Array.from(new Set([...(item.tags ?? []), TAG_SEM_EXEMPLO])) }).eq("id", item.id);
      feitos.push({ id: item.id, titulo: item.titulo, imagem_url: null, busca });
      continue;
    }
    jaUsadas.add(achado.imagem_url);
    const r = await atualizarItemDaBiblioteca(item.id, {
      imagem_url: achado.imagem_url,
      miniatura_url: achado.miniatura_url,
      licenca: achado.licenca_rotulo,
      autor: achado.autor,
      autor_url: achado.autor_url,
      fonte_url: achado.fonte_url,
      fonte_nome: achado.fonte_nome ? `${achado.fonte_nome} via Openverse` : "Openverse",
      tags: Array.from(new Set([...(item.tags ?? []), TAG_EXEMPLO_PUBLICO, ...(achado.id ? [`openverse:${achado.id}`] : [])])),
      exemplo: {
        tipo: "banco_publico",
        busca,
        openverse_id: achado.id,
        licenca_codigo: achado.licenca,
        licenca_url: achado.licenca_url,
        titulo_da_foto: achado.titulo,
        // Crédito do prompt antes da ilustração (nada se perde).
        prompt_origem: { fonte_nome: item.fonte_nome, fonte_url: item.fonte_url, licenca: item.licenca, autor: item.autor },
        ilustrado_em: new Date().toISOString(),
      },
    });
    aviso = aviso ?? r.aviso;
    feitos.push({ id: item.id, titulo: item.titulo, imagem_url: achado.imagem_url, busca });
  }
  const ilustrados = feitos.filter((f) => f.imagem_url).length;
  const pendentes = Math.max(0, (count ?? itens.length) - ilustrados - semResultado);
  return json({
    ilustrados,
    sem_resultado: semResultado,
    pendentes,
    itens: feitos,
    aviso: [
      parouNoLimite ? "O Openverse chegou ao limite de buscas (20 por minuto, 200 por dia sem cadastro). Espere um minuto e chame de novo." : "",
      aviso ?? "",
    ].filter(Boolean).join(" ") || null,
    fonte: "Openverse",
    custo_usd: 0,
  });
}

/**
 * biblioteca_exemplo_gerar { client_id, item_id, modelo_imagem_id?, qualidade? } -> { item, url, custo_usd, saldo_usd }
 * Pago (custo antes na tela com estimar acao_alvo biblioteca_exemplo): gera
 * um exemplo real do prompt com produto genérico da categoria, sem marca.
 * Item da agência guarda em mesa/biblioteca/exemplos/ (só admin); item do
 * cliente, na pasta do cliente. A carteira cobrada é a do client_id.
 */
async function bibliotecaExemploGerar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const itemId = idDe(corpo.item_id, "item_id");
  const [item] = await lerItensDaBiblioteca(clientId, [itemId]);
  if (!item) throw new ErroHttp(404, "item_inexistente", "Item da biblioteca não encontrado.");
  if (item.tipo !== "prompt" || (!item.prompt_pt && !item.prompt_en)) throw new ErroHttp(400, "item_sem_prompt", "Só item de prompt ganha exemplo gerado.");
  const daAgencia = item.client_id == null;
  if (daAgencia && !(await ehAdmin(ch))) {
    throw new ErroHttp(403, "somente_admin", "Só admin muda um item da biblioteca da agência. Copie o item para o cliente e gere o exemplo nele.");
  }
  const mImg = await modeloDeImagem(corpo.modelo_imagem_id);
  const qualidade = lerQualidade(corpo.qualidade);
  const saida = await chamarImagem({
    clientId,
    modeloId: mImg.id,
    prompt: promptDoExemplo(item),
    referencias: [],
    qualidade,
    tamanho: "1024x1024",
    referencia: { tipo: "foto_biblioteca", id: item.id },
    criadoPor: ch.userId,
    tarefa: TAREFA_ESTUDIO,
    agente: AGENTE_GERADOR,
  });
  const png = await emPng(saida.png);
  const caminho = daAgencia ? `biblioteca/exemplos/${item.id}-${crypto.randomUUID().slice(0, 8)}.png` : `${clientId}/foto/biblioteca/exemplos/${item.id}-${crypto.randomUUID().slice(0, 8)}.png`;
  await salvarNoMesa(caminho, png, "image/png");
  const r = await atualizarItemDaBiblioteca(item.id, {
    storage_path: caminho,
    tags: Array.from(new Set([...(item.tags ?? []).filter((t) => t !== TAG_SEM_EXEMPLO), TAG_EXEMPLO_GERADO])),
    exemplo: {
      tipo: "gerado",
      modelo_id: saida.modeloId,
      qualidade,
      custo_usd: arred6(saida.custoUsd),
      pago_por_cliente: clientId,
      gerado_em: new Date().toISOString(),
      aviso: "Exemplo gerado por IA com produto genérico, só para mostrar a direção do prompt.",
    },
  }).catch(async (e) => {
    await servico().storage.from("mesa").remove([caminho]).catch(() => {});
    throw e;
  });
  return json({
    item: r.item,
    url: await urlAssinada("mesa", caminho),
    aviso: r.aviso,
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    reserva_usada: saida.reservaUsada ?? null,
  });
}

async function bibliotecaSemear(ch: Chamador, _corpo: Record<string, unknown>) {
  await garantirAdmin(ch);
  const { data: existentes, error } = await servico().from("foto_biblioteca").select("titulo").is("client_id", null).eq("tipo", "prompt").limit(5000);
  if (error) throw new ErroHttp(503, "biblioteca_indisponivel", "A biblioteca ainda não existe no banco. Aplique a migration da Mesa Foto.");
  const ja = new Set(((existentes ?? []) as { titulo: string }[]).map((x) => x.titulo));
  const novos = SEMENTE_DA_BIBLIOTECA.filter((i) => !ja.has(i.titulo)).map((i) => ({
    client_id: null,
    tipo: "prompt",
    categoria: i.categoria,
    titulo: i.titulo,
    prompt_pt: i.prompt_pt,
    prompt_en: i.prompt_en,
    negativo: i.negativo,
    tags: i.tags ?? [],
    fonte_nome: i.fonte_nome,
    fonte_url: i.fonte_url,
    licenca: i.licenca,
    autor: "Aceleriq (curadoria)",
    uso: i.uso,
    destaque: !!i.destaque,
    criado_por: ch.userId,
  }));
  for (let k = 0; k < novos.length; k += 50) {
    const { error: erroInserir } = await servico().from("foto_biblioteca").insert(novos.slice(k, k + 50));
    if (erroInserir) throw new ErroHttp(503, "biblioteca_nao_gravada", `A biblioteca parou no item ${k + 1}: ${erroInserir.message}`);
  }
  return json({ inseridos: novos.length, ja_existiam: SEMENTE_DA_BIBLIOTECA.length - novos.length, total: SEMENTE_DA_BIBLIOTECA.length, versao: VERSAO_DA_SEMENTE, custo_usd: 0 });
}

/** O que Modelos e Canvas usam do index (sem import circular; o index não cresce com elas). */
const FERRAMENTAS: FerramentasDaMesa = {
  servico,
  json,
  garantirAcesso,
  baixar,
  baixarReduzida,
  urlAssinada,
  salvarNoMesa,
  emParalelo,
  lerImagens,
  lerKitComRefs: async (ch, kitId) => {
    const kit = await lerKit(ch, kitId);
    return { kit, refs: await lerRefs(kit) };
  },
  lerItensDaBiblioteca,
  imagemDoItemDaBiblioteca,
  modeloDeTexto,
  camposImagem: CAMPOS_IMAGEM,
  timeoutTextoMs: TIMEOUT_TEXTO_FOTO_MS,
  contextoDoCliente,
};
const MODELOS = acoesDeModelos(FERRAMENTAS);
const CANVAS = acoesDoCanvas(FERRAMENTAS);
const CAMPANHAS = acoesDeCampanhas(FERRAMENTAS);
const CLONES = acoesDeClones(FERRAMENTAS);
const BIBLIOTECA_EM_LOTE = acoesDaBibliotecaEmLote(FERRAMENTAS, { ehAdmin, atualizarItemDaBiblioteca, modeloDeImagem });

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  biblioteca_semear: bibliotecaSemear,
  acervo_registrar: acervoRegistrar,
  acervo_ler_foto: acervoLerFoto,
  acervo_decidir: acervoDecidir,
  kit_sugerir: kitSugerir,
  kit_salvar: kitSalvar,
  receitas: () => Promise.resolve(receitas()),
  estimar,
  ensaio_planejar: ensaioPlanejar,
  tomada_editar: tomadaEditar,
  tomada_gerar: tomadaGerar,
  versao_conferir: versaoConferir,
  versao_decidir: versaoDecidir,
  preparar,
  enviar,
  baixar: baixarFotos,
  biblioteca_salvar: bibliotecaSalvar,
  referencias_buscar: referenciasBuscar,
  referencia_importar: referenciaImportar,
  agente_conversar: agenteConversar,
  agente_aplicar: agenteAplicar,
  // v2 (docs/mesa-foto/CONTRATO-V2.md)
  produto_identificar: produtoIdentificar,
  variacoes_planejar: variacoesPlanejar,
  campanha_planejar: campanhaPlanejar,
  biblioteca_ilustrar: bibliotecaIlustrar,
  biblioteca_exemplo_gerar: bibliotecaExemploGerar,
  // Modelos e Canvas (docs/mesa-foto/MODELOS-E-CANVAS.md)
  ...MODELOS.acoes,
  ...CANVAS.acoes,
  // Ligada à Mesa (25/09): campanhas do cliente e a do mês pelo calendário (sem IA; campanhas.ts).
  campanhas_listar: CAMPANHAS.campanhas_listar,
  // Clones de pessoa real com autorização (25/09; clones.ts) e a biblioteca em lote (biblioteca-lote.ts).
  ...CLONES.acoes,
  ...BIBLIOTECA_EM_LOTE.acoes,
};

/**
 * Ações que podem passar de 150 s (IA, imagem, pesquisa web, downloads em
 * lote, envio): a resposta começa na hora (resposta-com-folego.ts) e o erro
 * vai no corpo.
 */
const ACOES_LONGAS = new Set([
  "acervo_registrar", "acervo_ler_foto", "kit_sugerir", "kit_salvar", "ensaio_planejar", "tomada_gerar", "versao_conferir",
  "versao_decidir", "preparar", "enviar", "referencia_importar", "agente_conversar", "agente_aplicar", "estimar",
  "produto_identificar", "variacoes_planejar", "campanha_planejar", "biblioteca_ilustrar", "biblioteca_exemplo_gerar",
  ...ACOES_LONGAS_DE_MODELOS, ...ACOES_LONGAS_DO_CANVAS, ...ACOES_LONGAS_DE_CLONES, ...ACOES_LONGAS_DA_BIBLIOTECA,
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const chamador = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    const rodar = async () => {
      try {
        return await fn(chamador, corpo);
      } catch (err) {
        return respostaDeErro(err);
      }
    };
    return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
