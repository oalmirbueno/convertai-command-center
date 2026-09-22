/**
 * estudio-arte: diretor de arte e gerador da Mesa do cliente
 * (docs/mesa-do-cliente/SPEC.md, secao 5).
 *
 * Regra do dono, sem excecao: o gerador de imagem desenha a lamina INTEIRA,
 * texto incluido. Esta funcao nunca desenha texto por cima da imagem nem monta
 * a lamina em camadas. Ajuste e edicao dentro do gerador, sobre a versao atual.
 *
 * Acoes (POST { acao, ... }), so equipe com acesso ao cliente:
 * - preparar { task_id, modelo_imagem_id?, qualidade? }: le o item da agenda,
 *   kit, fontes, referencias, artes anteriores, prompt e memoria do diretor;
 *   escreve a direcao de cada card e cria estudio_trabalhos (status dirigido).
 * - gerar_card { trabalho_id, ordem }: UMA lamina por chamada. Jev escolhe ate 4
 *   referencias; anexa logo (capa e final), amostras das fontes e o card
 *   anterior; gera; salva no bucket mesa; grava a versao com a conferencia
 *   pendente ({ pendente: true }).
 * - conferir_card { trabalho_id, ordem, versao? }: confere uma versao (a atual
 *   quando versao nao vem): ortografia pela leitura do texto no recorte 4:5 e
 *   identidade pelo Jev (Score). A tela chama logo depois de gerar ou ajustar;
 *   separado para cada chamada caber no tempo da funcao.
 * - ajustar_card { trabalho_id, ordem, instrucao }: o diretor transforma o
 *   pedido em instrucao de edicao; o gerador edita a versao atual; nova versao
 *   com conferencia pendente; o pedido vai para a memoria do agente.
 * - legenda { trabalho_id }: legenda final a partir do item e da direcao.
 * - entregar { trabalho_id }: cria os arquivos em Arquivos pelo mesmo caminho
 *   da tela de Arquivos (bucket files + RPC create_file_record com o JWT de
 *   quem chamou), pasta materiais, carrossel com pai e filhos "(n/N)", legenda
 *   no pai, ligado ao projeto do item. Nao pede aprovacao (isso e da Entrega).
 * - referencias { subacao: importar_pinterest | sincronizar_workspace | ler }.
 *
 * Custos: toda chamada de IA passa pelo motor (_shared/ia-motor.ts), que
 * confere saldo e cota e debita a carteira do cliente.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  chamarImagem,
  chamarTexto,
  carregarModelo,
  cobrarJev,
  IaMotorErro,
  modeloPadrao,
  type ImagemEntrada,
  type ModeloIa,
  type Qualidade,
} from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar, notaScore, type PerguntaJev } from "../_shared/jev.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Toda resposta de erro sai por aqui: nunca 200, sempre com mensagem em portugues. */
const erro = (status: number, codigo: string, mensagem: string, detalhes: Record<string, unknown> = {}) =>
  json({ error: codigo, mensagem, ...detalhes }, status);

class ErroEstudio extends Error {
  status: number;
  codigo: string;
  detalhes: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, detalhes: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

// Erros do motor que a tela precisa tratar, com o status que a SPEC fixou.
const STATUS_MOTOR: Record<string, number> = {
  saldo_insuficiente: 402,
  cota_da_chave_esgotada: 402,
  cliente_sem_chave: 403,
  provedor_sem_chave: 503,
};
const MENSAGEM_MOTOR: Record<string, string> = {
  saldo_insuficiente: "Saldo insuficiente na carteira de IA do cliente. Recarregue antes de gerar.",
  cota_da_chave_esgotada: "A cota do mês da chave de IA do cliente acabou.",
  cliente_sem_chave: "O cliente não tem chave de IA própria e não está autorizado a usar a da agência.",
  provedor_sem_chave: "O provedor de IA escolhido ainda não tem chave configurada.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];
const QUALIDADE_PADRAO: Qualidade = "alta";
const TAMANHO_GERADOR = "1024x1536";
const LARGURA_FINAL = 1080;
const ALTURA_FINAL = 1350;
const MAX_CARDS = 20;
const MAX_REFERENCIAS = 4;
const MAX_CANDIDATAS_JEV = 16;
const MAX_AMOSTRAS_FONTE = 3;
const MAX_BYTES_IMAGEM = 20 * 1024 * 1024;
const TIMEOUT_PINTEREST_MS = 20_000;
const FORMATOS_FORA_DO_ESTUDIO = new Set(["reel", "video", "short", "story", "article"]);
const FORMATOS_POST_UNICO = new Set(["static", "design", "google_post"]);

// ------------------------------------------------------------------ banco

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

/** Cliente do banco com o JWT de quem chamou: RLS e regras das RPCs valem. */
function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

async function identificar(req: Request): Promise<Chamador | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) return null;
  const { data: staff } = await servico().rpc("is_staff", { _user_id: userId });
  if (staff !== true) return null;
  return { userId, token, doChamador: clienteDoChamador(token) };
}

/** can_access_client le auth.uid(): precisa rodar com o JWT de quem chamou. */
async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroEstudio(400, "cliente_invalido", "Cliente inválido.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroEstudio(503, "acesso_indisponivel", "Não foi possível conferir o acesso ao cliente.");
  if (data !== true) throw new ErroEstudio(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

// ------------------------------------------------------------- utilidades

const texto = (v: unknown, max = 4000) => (v == null ? "" : String(v)).slice(0, max).trim();
const arred = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

function mimeDe(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null;
}

/** Largura e altura de um PNG pelo cabecalho IHDR, sem decodificar a imagem. */
function dimensoesPng(b: Uint8Array): { largura: number; altura: number } | null {
  if (mimeDe(b) !== "image/png" || b.length < 24) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { largura: v.getUint32(16), altura: v.getUint32(20) };
}

const extensaoDe = (mime: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[mime] ?? "bin";

function nomeSeguro(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "arte";
}

/**
 * Normaliza para comparar ortografia: mantem letras (com acento) e numeros,
 * ignora caixa, pontuacao e espacos. Acento errado continua sendo erro.
 */
function palavras(s: string): string[] {
  return s
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Compara como multiconjunto de palavras: a ordem de leitura de um layout varia. */
function compararTexto(esperado: string, lido: string) {
  const faltando: string[] = [];
  const restantes = palavras(lido);
  for (const p of palavras(esperado)) {
    const i = restantes.indexOf(p);
    if (i >= 0) restantes.splice(i, 1);
    else faltando.push(p);
  }
  return { ortografia_ok: faltando.length === 0 && restantes.length === 0, faltando, sobrando: restantes };
}

async function baixar(bucket: string, caminho: string): Promise<Uint8Array> {
  const { data, error } = await servico().storage.from(bucket).download(caminho);
  if (error || !data) throw new ErroEstudio(502, "arquivo_indisponivel", `Não foi possível ler o arquivo ${caminho}.`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES_IMAGEM) throw new ErroEstudio(413, "arquivo_grande_demais", "Imagem grande demais para enviar ao gerador.");
  return bytes;
}

async function baixarImagem(bucket: string, caminho: string, nome: string): Promise<ImagemEntrada> {
  const bytes = await baixar(bucket, caminho);
  const mime = mimeDe(bytes);
  if (!mime) throw new ErroEstudio(415, "imagem_invalida", `O arquivo ${nome} não é uma imagem reconhecida.`);
  return { bytes, mime, nome: `${nomeSeguro(nome)}.${extensaoDe(mime)}` };
}

/** Uma entrada de erro do motor vira resposta com o status certo. */
function respostaDoMotor(e: IaMotorErro): Response {
  const status = STATUS_MOTOR[e.codigo] ?? e.status;
  const corpo = e.paraJson() as Record<string, unknown>;
  return json({ ...corpo, mensagem: MENSAGEM_MOTOR[e.codigo] ?? e.message }, status);
}

function codigoMotor(e: unknown): string {
  if (e instanceof IaMotorErro) return e.codigo;
  if (e instanceof JevErro) return e.codigo;
  if (e instanceof ErroEstudio) return e.codigo;
  return "erro_desconhecido";
}

// ------------------------------------------------------- tipos do trabalho

type CardDirecao = {
  ordem: number;
  funcao: string;
  texto_exato: string;
  composicao: string;
  ilustracao: string;
  prompt_imagem: string;
};

type Direcao = { conceito: string; carrossel_infinito: boolean; cards: CardDirecao[] };

/** Conferencia ainda nao feita: gerar_card e ajustar_card gravam so isto. */
type VerificacaoPendente = { pendente: true };

type Verificacao = {
  pendente?: false;
  texto_lido: string | null;
  ortografia_ok: boolean | null;
  faltando?: string[];
  sobrando?: string[];
  descricao_visual?: string | null;
  logo_presente?: boolean | null;
  logo_ok?: boolean | null;
  /** Se a leitura foi feita sobre o recorte 4:5 central (senao, sobre a tela inteira ignorando as faixas). */
  leitura_no_recorte?: boolean;
  identidade: { nota: number | null; escala_max: number; nivel: string | null; confianca: number | null } | { erro: string } | null;
  erro?: string;
  conferido_em?: string;
  uso_ids?: string[];
  custo_usd?: number;
};

type VersaoCard = {
  ordem: number;
  versao: number;
  storage_path: string;
  origem: "gerar" | "ajuste";
  instrucao?: string | null;
  referencias?: string[];
  verificacao: Verificacao | VerificacaoPendente;
  custo_usd: number;
  uso_ids: string[];
  criado_em: string;
  criado_por: string;
};

type Trabalho = {
  id: string;
  client_id: string;
  task_id: string | null;
  status: string;
  direcao: Direcao;
  modelo_imagem_id: string | null;
  qualidade: string | null;
  cards: VersaoCard[];
  legenda: string | null;
  file_ids: string[];
  custo_usd: number;
  /** Sobe a cada reprovação do cliente: a nova entrega vira arquivo novo. */
  entrega_rodada?: number | null;
  atualizado_em: string;
};

async function lerTrabalho(id: string): Promise<Trabalho> {
  if (!UUID.test(id)) throw new ErroEstudio(400, "trabalho_invalido", "Trabalho inválido.");
  const { data, error } = await servico().from("estudio_trabalhos").select("*").eq("id", id).maybeSingle();
  if (error) throw new ErroEstudio(503, "trabalho_indisponivel", "Não foi possível ler o trabalho do estúdio.");
  if (!data) throw new ErroEstudio(404, "trabalho_inexistente", "Trabalho do estúdio não encontrado.");
  const t = data as Trabalho;
  t.cards = Array.isArray(t.cards) ? t.cards : [];
  t.direcao = (t.direcao && Array.isArray((t.direcao as Direcao).cards)) ? t.direcao : { conceito: "", carrossel_infinito: false, cards: [] };
  return t;
}

async function trabalhoComAcesso(ch: Chamador, id: string): Promise<Trabalho> {
  const t = await lerTrabalho(id);
  await garantirAcesso(ch, t.client_id);
  return t;
}

/**
 * Grava no trabalho com trava otimista por atualizado_em (o gatilho do banco
 * renova a coluna em todo update). Duas laminas geradas ao mesmo tempo nao
 * apagam a versao uma da outra: quem perde a corrida rele e tenta de novo.
 */
async function mutarTrabalho(id: string, mudar: (t: Trabalho) => Record<string, unknown>): Promise<Trabalho> {
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const atual = await lerTrabalho(id);
    const patch = mudar(atual);
    const { data, error } = await servico()
      .from("estudio_trabalhos")
      .update(patch)
      .eq("id", id)
      .eq("atualizado_em", atual.atualizado_em)
      .select("*")
      .maybeSingle();
    if (error) throw new ErroEstudio(503, "gravacao_falhou", "Não foi possível gravar o trabalho do estúdio.");
    if (data) return data as Trabalho;
  }
  throw new ErroEstudio(409, "conflito_de_gravacao", "O trabalho mudou várias vezes ao mesmo tempo. Tente de novo.");
}

function versaoAtual(t: Trabalho, ordem: number): VersaoCard | null {
  const versoes = t.cards.filter((c) => c.ordem === ordem);
  if (!versoes.length) return null;
  return versoes.reduce((a, b) => (b.versao > a.versao ? b : a));
}

function cardDaDirecao(t: Trabalho, ordem: number): CardDirecao {
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw new ErroEstudio(404, "card_inexistente", `A direção não tem o card ${ordem}.`);
  return card;
}

const totalCards = (t: Trabalho) => t.direcao.cards.length;
const levaLogo = (t: Trabalho, ordem: number) => ordem === 1 || ordem === totalCards(t);

function statusDepoisDeGerar(t: Trabalho, novas: VersaoCard[]): string {
  const todas = [...t.cards, ...novas];
  const completo = t.direcao.cards.every((c) => todas.some((v) => v.ordem === c.ordem));
  return completo ? "pronto" : "gerando";
}

// ------------------------------------------------------ contexto do cliente

type Kit = { paleta: unknown; logo_file_id: string | null; estilo: string | null; regras: string | null } | null;

async function lerKit(clientId: string): Promise<Kit> {
  const { data } = await servico()
    .from("cliente_kit_marca")
    .select("paleta, logo_file_id, estilo, regras")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as Kit) ?? null;
}

type Fonte = { id: string; nome: string; papel: string; amostra_path: string | null };

async function lerFontes(clientId: string): Promise<Fonte[]> {
  const { data } = await servico()
    .from("cliente_fontes")
    .select("id, nome, papel, amostra_path")
    .eq("client_id", clientId)
    .order("criado_em", { ascending: true });
  return (data as Fonte[] | null) ?? [];
}

/** Amostras PNG das fontes (geradas no navegador), no maximo tres. */
async function amostrasDasFontes(fontes: Fonte[]): Promise<{ imagem: ImagemEntrada; fonte: Fonte }[]> {
  const saida: { imagem: ImagemEntrada; fonte: Fonte }[] = [];
  const ordemPapel: Record<string, number> = { titulo: 0, destaque: 1, texto: 2 };
  const comAmostra = fontes.filter((f) => f.amostra_path).sort((a, b) => (ordemPapel[a.papel] ?? 9) - (ordemPapel[b.papel] ?? 9));
  for (const f of comAmostra.slice(0, MAX_AMOSTRAS_FONTE)) {
    try {
      saida.push({ imagem: await baixarImagem("mesa", f.amostra_path!, `fonte-${f.papel}-${f.nome}`), fonte: f });
    } catch {
      // Amostra sumida nao impede a lamina; a direcao ja descreve a fonte.
    }
  }
  return saida;
}

/** Logo oficial pelo arquivo do kit (sempre do mesmo cliente). */
async function baixarLogo(clientId: string, kit: Kit): Promise<ImagemEntrada | null> {
  if (!kit?.logo_file_id) return null;
  const { data } = await servico()
    .from("files")
    .select("id, client_id, file_name, file_url, storage_bucket, storage_path")
    .eq("id", kit.logo_file_id)
    .maybeSingle();
  const f = data as { client_id: string; file_name: string; file_url: string; storage_bucket: string | null; storage_path: string | null } | null;
  if (!f || f.client_id !== clientId) return null;
  let bucket = f.storage_bucket;
  let caminho = f.storage_path;
  if (!caminho && f.file_url?.startsWith("files://")) {
    bucket = "files";
    caminho = f.file_url.slice("files://".length);
  }
  if (!bucket || !caminho) return null;
  try {
    return await baixarImagem(bucket, caminho, "logo-oficial");
  } catch {
    return null;
  }
}

type Referencia = {
  id: string;
  client_id: string;
  origem: string;
  workspace_node_id: string | null;
  url_origem: string | null;
  storage_path: string | null;
  leitura: string | null;
  tags: string[] | null;
};

/** Bytes da referencia: copia no bucket mesa ou o proprio arquivo do workspace. */
async function imagemDaReferencia(ref: Referencia): Promise<ImagemEntrada> {
  if (ref.storage_path) return await baixarImagem("mesa", ref.storage_path, `referencia-${ref.id.slice(0, 8)}`);
  if (ref.workspace_node_id) {
    const { data } = await servico()
      .from("workspace_nodes")
      .select("id, client_id, name, storage_path, mime")
      .eq("id", ref.workspace_node_id)
      .maybeSingle();
    const no = data as { client_id: string | null; name: string; storage_path: string | null } | null;
    if (!no || no.client_id !== ref.client_id || !no.storage_path) {
      throw new ErroEstudio(404, "referencia_sem_arquivo", "A imagem desta referência não está mais no workspace.");
    }
    return await baixarImagem("workspace", no.storage_path, `referencia-${ref.id.slice(0, 8)}`);
  }
  throw new ErroEstudio(404, "referencia_sem_arquivo", "Esta referência não tem imagem guardada.");
}

/** Prompt efetivo do diretor: global ativo + complemento ativo do cliente. */
async function promptDoDiretor(clientId: string): Promise<string> {
  const { data, error } = await servico()
    .from("agente_prompts")
    .select("client_id, conteudo, versao")
    .eq("agente", "diretor_arte")
    .eq("ativo", true)
    .or(`client_id.is.null,client_id.eq.${clientId}`);
  if (error) throw new ErroEstudio(503, "prompt_indisponivel", "Não foi possível ler o prompt do diretor de arte.");
  const linhas = (data as { client_id: string | null; conteudo: string }[] | null) ?? [];
  const global = linhas.find((l) => l.client_id === null)?.conteudo?.trim();
  if (!global) throw new ErroEstudio(409, "prompt_global_ausente", "O prompt global do diretor de arte não está ativo.");
  const complemento = linhas.find((l) => l.client_id === clientId)?.conteudo?.trim();
  return complemento ? `${global}\n\nCOMPLEMENTO DESTE CLIENTE\n\n${complemento}` : global;
}

async function memoriaDoDiretor(clientId: string): Promise<{ tipo: string; texto: string; origem: string }[]> {
  const { data } = await servico()
    .from("agente_memoria")
    .select("tipo, texto, origem")
    .eq("client_id", clientId)
    .eq("agente", "diretor_arte")
    .eq("ativa", true)
    .order("criado_em", { ascending: false })
    .limit(30);
  return ((data as { tipo: string; texto: string; origem: string }[] | null) ?? []).map((m) => ({ ...m, texto: texto(m.texto, 400) }));
}

async function modeloDoPapel(papel: "diretor_arte" | "leitura" | "imagem"): Promise<ModeloIa> {
  const m = await modeloPadrao(papel);
  if (!m) throw new ErroEstudio(503, "modelo_padrao_ausente", `O catálogo não tem modelo padrão ativo para ${papel}.`);
  return m;
}

/** Primeiro nivel de raciocinio aceito pelo modelo, na ordem de preferencia. */
function raciocinioPara(m: ModeloIa, preferidos: string[]): string | undefined {
  const aceitos = m.raciocinio ?? [];
  return preferidos.find((r) => aceitos.includes(r));
}

// ------------------------------------------------------- item da agenda

type Tarefa = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  delivery_type: string;
  due_date: string | null;
  deleted_at: string | null;
};

type ItemDaAgenda = {
  tarefa: Tarefa;
  clientId: string;
  projeto: { id: string; name: string };
  post: { id: string; title: string; objective: string | null; default_caption: string | null; content_type: string } | null;
  itemProposta: Record<string, unknown> | null;
};

async function lerItemDaAgenda(taskId: string): Promise<ItemDaAgenda> {
  if (!UUID.test(taskId)) throw new ErroEstudio(400, "item_invalido", "Item da agenda inválido.");
  const db = servico();
  const { data: t } = await db
    .from("tasks")
    .select("id, project_id, title, description, delivery_type, due_date, deleted_at")
    .eq("id", taskId)
    .maybeSingle();
  const tarefa = t as Tarefa | null;
  if (!tarefa || tarefa.deleted_at) throw new ErroEstudio(404, "item_inexistente", "Item da agenda não encontrado.");
  const { data: p } = await db.from("projects").select("id, name, client_id, deleted_at").eq("id", tarefa.project_id).maybeSingle();
  const projeto = p as { id: string; name: string; client_id: string; deleted_at: string | null } | null;
  if (!projeto || projeto.deleted_at) throw new ErroEstudio(404, "projeto_inexistente", "O projeto deste item não foi encontrado.");

  // Post editorial atual do item, pela mesma regra de
  // editorial_current_post_id_for_task (a funcao nao e exposta a RPC):
  // ligado pela tarefa, nao arquivado, em producao e sem revisao mais nova.
  let post: ItemDaAgenda["post"] = null;
  const { data: ligacoes } = await db
    .from("editorial_post_internal")
    .select("post_id, revision_of_post_id")
    .eq("task_id", taskId);
  const links = (ligacoes as { post_id: string; revision_of_post_id: string | null }[] | null) ?? [];
  if (links.length) {
    const revisados = new Set(links.map((l) => l.revision_of_post_id).filter(Boolean));
    const { data: posts } = await db
      .from("editorial_posts")
      .select("id, title, objective, default_caption, content_type, created_at")
      .in("id", links.map((l) => l.post_id))
      .is("archived_at", null)
      .in("production_status", ["draft", "production", "ready"])
      .order("created_at", { ascending: false });
    const candidato = ((posts as ItemDaAgenda["post"][] | null) ?? []).find((x) => x && !revisados.has(x.id));
    post = candidato ?? null;
  }

  // Item detalhado pelo estrategista (roteiro de cada card), quando o item
  // nasceu de uma proposta gravada. O agente do calendario grava o task_id em
  // cada item ao gravar na agenda; a busca e so por ele, nunca por posicao.
  let itemProposta: Record<string, unknown> | null = null;
  const { data: propostas } = await db
    .from("calendario_propostas")
    .select("itens")
    .eq("client_id", projeto.client_id)
    .contains("task_ids", [taskId])
    .order("criado_em", { ascending: false })
    .limit(1);
  const proposta = ((propostas as { itens: unknown }[] | null) ?? [])[0];
  if (proposta && Array.isArray(proposta.itens)) {
    const itens = proposta.itens as Record<string, unknown>[];
    itemProposta = itens.find((i) => i && typeof i === "object" && i.task_id === taskId) ?? null;
  }

  return { tarefa, clientId: projeto.client_id, projeto: { id: projeto.id, name: projeto.name }, post, itemProposta };
}

// ------------------------------------------------------------- preparar

const ESQUEMA_DIRECAO = {
  nome: "direcao_de_arte",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["conceito", "carrossel_infinito", "cards"],
    properties: {
      conceito: { type: "string" },
      carrossel_infinito: { type: "boolean" },
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "funcao", "texto_exato", "composicao", "ilustracao", "prompt_imagem"],
          properties: {
            ordem: { type: "integer" },
            funcao: { type: "string" },
            texto_exato: { type: "string" },
            composicao: { type: "string" },
            ilustracao: { type: "string" },
            prompt_imagem: { type: "string" },
          },
        },
      },
    },
  },
};

const INSTRUCOES_DIRECAO = `COMO ENTREGAR A DIREÇÃO (regras técnicas do estúdio)

Você escreve a direção de cada lâmina para um gerador de imagem que desenha a lâmina INTEIRA numa imagem só, texto incluído. Nunca planeje texto aplicado depois em camada: o texto é parte da arte e é desenhado pelo gerador.

Devolva:
- conceito: a ideia visual do conjunto em até 4 frases.
- carrossel_infinito: verdadeiro quando a sequência for uma composição panorâmica contínua.
- cards: uma entrada por lâmina, ordem 1, 2, 3... seguindo o roteiro do item. Post único tem um card só.
  - funcao: capa, conteudo ou cta.
  - texto_exato: todo o texto que aparece escrito na lâmina, exatamente, com acentos, na ordem de leitura, blocos separados por quebra de linha. Nada além dele pode aparecer escrito (a logo não conta).
  - composicao: grid, planos, posição da headline, escala, espaço negativo, luz.
  - ilustracao: imagem, objeto, cenário ou recurso gráfico e por que serve ao assunto.
  - prompt_imagem: prompt completo de direção de arte para o gerador, autossuficiente. Precisa ter:
    1. a cena, a composição, os planos, a luz e a paleta (com os hex do kit);
    2. cada bloco do texto exato entre aspas duplas, com posição, tamanho relativo, peso e caixa;
    3. a tipografia descrita e casada com as amostras de fonte anexadas (nome da fonte, papel, peso, caixa, espacejamento), dizendo que as letras devem seguir a amostra correspondente;
    4. o formato: peça final vertical 4:5 (1080 x 1350) desenhada numa tela 1024 x 1536; a peça será cortada pelo centro, então TODO o texto e a logo ficam dentro da área útil central de 1024 x 1280 (de y = 128 a y = 1408), com margem de respiro, e as faixas de 128 px no topo e na base recebem só continuação do fundo, sem texto, logo ou elemento importante;
    5. logo: na capa e no card final, "usar a logo oficial anexada, sem redesenhar"; nos cards do meio, "sem logo";
    6. no carrossel infinito: o que atravessa a borda direita continua no card seguinte com a mesma posição, escala, perspectiva e luz, e o card final se conecta visualmente com a capa;
    7. o que evitar nesta lâmina (repetição das artes anteriores listadas, texto extra, letras deformadas).

Escreva sem travessão. Use o roteiro do item como fonte do texto; corrija só ortografia evidente.`;

async function preparar(ch: Chamador, corpo: Record<string, unknown>) {
  const item = await lerItemDaAgenda(texto(corpo.task_id, 64));
  await garantirAcesso(ch, item.clientId);
  const clientId = item.clientId;
  if (FORMATOS_FORA_DO_ESTUDIO.has(item.tarefa.delivery_type)) {
    throw new ErroEstudio(400, "formato_fora_do_estudio", "O estúdio faz carrossel e post estático. Este item é de outro formato.", {
      formato: item.tarefa.delivery_type,
    });
  }

  const qualidade = QUALIDADES.includes(corpo.qualidade as Qualidade) ? corpo.qualidade as Qualidade : QUALIDADE_PADRAO;
  const modeloImagem = corpo.modelo_imagem_id
    ? await carregarModelo(texto(corpo.modelo_imagem_id, 120), "imagem")
    : await modeloDoPapel("imagem");
  const modeloDiretor = await modeloDoPapel("diretor_arte");

  const db = servico();
  const [kit, fontes, prompt, memoria, refsRes, artesRes] = await Promise.all([
    lerKit(clientId),
    lerFontes(clientId),
    promptDoDiretor(clientId),
    memoriaDoDiretor(clientId),
    db.from("cliente_referencias")
      .select("id, origem, leitura, tags")
      .eq("client_id", clientId)
      .eq("ativa", true)
      .not("leitura", "is", null)
      .order("criado_em", { ascending: false })
      .limit(12),
    // Artes ja entregues do cliente (anti-repeticao): so a raiz de cada entrega.
    db.from("files")
      .select("file_name, file_type, description, caption, created_at")
      .eq("client_id", clientId)
      .eq("folder", "materiais")
      .is("parent_file_id", null)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const amostras = await amostrasDasFontes(fontes);

  const postUnico = FORMATOS_POST_UNICO.has(item.tarefa.delivery_type);
  const pedidoInfinito = item.itemProposta && typeof item.itemProposta.carrossel_infinito === "boolean"
    ? item.itemProposta.carrossel_infinito as boolean
    : null;

  const contexto = {
    item: {
      titulo: item.tarefa.title,
      formato: item.tarefa.delivery_type,
      post_unico: postUnico,
      data: item.tarefa.due_date,
      roteiro_e_contexto: texto(item.tarefa.description, 4000),
      objetivo_do_post: item.post?.objective ?? null,
      legenda_prevista: texto(item.post?.default_caption, 2000) || null,
      detalhe_do_estrategista: item.itemProposta ?? null,
      carrossel_infinito_pedido: pedidoInfinito,
    },
    marca: {
      paleta: kit?.paleta ?? [],
      estilo: kit?.estilo ?? null,
      regras: kit?.regras ?? null,
      tem_logo_oficial: !!kit?.logo_file_id,
    },
    fontes: fontes.map((f) => ({ nome: f.nome, papel: f.papel })),
    amostras_anexadas: amostras.map((a, i) => `Imagem ${i + 1}: amostra da fonte ${a.fonte.nome} (papel ${a.fonte.papel})`),
    referencias: ((refsRes.data as { id: string; origem: string; leitura: string; tags: string[] }[] | null) ?? [])
      .map((r) => ({ origem: r.origem, tecnica: texto(r.leitura, 700), tags: r.tags })),
    artes_anteriores: ((artesRes.data as Record<string, unknown>[] | null) ?? []).map((a) => ({
      nome: texto(a.file_name, 160),
      tipo: a.file_type,
      descricao: texto(a.description, 300) || null,
      legenda: texto(a.caption, 200) || null,
    })),
    memoria_do_diretor: memoria,
  };

  const trabalhoId = crypto.randomUUID();
  const r = await chamarTexto({
    clientId,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: modeloDiretor.id,
    raciocinio: raciocinioPara(modeloDiretor, ["high", "medium"]),
    sistema: `${prompt}\n\n${INSTRUCOES_DIRECAO}`,
    mensagens: [{
      papel: "usuario",
      conteudo: `Escreva a direção de arte deste item. Contexto em JSON:\n${JSON.stringify(contexto)}`,
      imagens: amostras.map((a) => a.imagem),
    }],
    esquemaJson: ESQUEMA_DIRECAO,
    maxTokensSaida: 32_000,
    referencia: { tipo: "estudio_trabalho", id: trabalhoId },
    criadoPor: ch.userId,
  });

  const bruto = (r.json ?? {}) as Partial<Direcao>;
  let cards = (Array.isArray(bruto.cards) ? bruto.cards : [])
    .filter((c) => c && texto(c.texto_exato) && texto(c.prompt_imagem))
    .sort((a, b) => num(a.ordem) - num(b.ordem))
    .slice(0, postUnico ? 1 : MAX_CARDS)
    .map((c, i): CardDirecao => ({
      ordem: i + 1,
      funcao: texto(c.funcao, 40) || (i === 0 ? "capa" : "conteudo"),
      texto_exato: texto(c.texto_exato, 1200),
      composicao: texto(c.composicao, 2000),
      ilustracao: texto(c.ilustracao, 2000),
      prompt_imagem: texto(c.prompt_imagem, 6000),
    }));
  if (!cards.length) {
    throw new ErroEstudio(502, "direcao_vazia", "O diretor de arte não devolveu nenhum card utilizável. Tente de novo.", { uso_id: r.usoId });
  }
  if (cards.length > 1) cards = cards.map((c, i) => (i === cards.length - 1 && c.funcao === "conteudo" ? { ...c, funcao: "cta" } : c));
  const direcao: Direcao = {
    conceito: texto(bruto.conceito, 2000),
    carrossel_infinito: cards.length > 1 && (pedidoInfinito ?? !!bruto.carrossel_infinito),
    cards,
  };

  const { data: criado, error } = await db
    .from("estudio_trabalhos")
    .insert({
      id: trabalhoId,
      client_id: clientId,
      task_id: item.tarefa.id,
      status: "dirigido",
      direcao,
      modelo_imagem_id: modeloImagem.id,
      qualidade,
      cards: [],
      custo_usd: arred(r.custoUsd),
      criado_por: ch.userId,
    })
    .select("*")
    .single();
  if (error) throw new ErroEstudio(503, "gravacao_falhou", "A direção foi escrita, mas o trabalho não foi gravado.", { uso_id: r.usoId });

  return json({ trabalho: criado, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, reserva_usada: r.reservaUsada ?? null });
}

// ------------------------------------------------------ referencias (Jev)

const NIVEIS_REFERENCIA = [
  "Não serve: a técnica da referência (composição, hierarquia, clima) é de outro tipo de peça e não ajuda esta lâmina.",
  "Serve pouco: só um detalhe isolado da referência (uma cor, uma textura, um estilo de letra) ajuda esta lâmina.",
  "Serve em parte: a composição ou a hierarquia da referência ajuda a resolver esta lâmina, com adaptação.",
  "Serve muito: composição, hierarquia e tratamento visual da referência resolvem diretamente o que esta lâmina pede.",
];
const NOTA_MINIMA_REFERENCIA = 1.5;

/**
 * Ate 4 referencias mais proximas da lamina. Um Score por referencia, todas na
 * mesma chamada ao Jev (rodam em paralelo); o codigo ordena e corta.
 */
async function escolherReferencias(
  t: Trabalho,
  card: CardDirecao,
  kit: Kit,
  criadoPor: string,
): Promise<{ refs: Referencia[]; jev: string }> {
  const { data } = await servico()
    .from("cliente_referencias")
    .select("id, client_id, origem, workspace_node_id, url_origem, storage_path, leitura, tags")
    .eq("client_id", t.client_id)
    .eq("ativa", true)
    .not("leitura", "is", null)
    .order("criado_em", { ascending: false })
    .limit(MAX_CANDIDATAS_JEV);
  const candidatas = (data as Referencia[] | null) ?? [];
  if (!candidatas.length) return { refs: [], jev: "sem_referencias_lidas" };

  const referencias: Record<string, { tecnica: string; tags: string[] }> = {};
  const questions: Record<string, PerguntaJev> = {};
  candidatas.forEach((r, i) => {
    referencias[`r${i}`] = { tecnica: texto(r.leitura, 900), tags: r.tags ?? [] };
    questions[`r${i}`] = {
      type: "score",
      instructions:
        `Quão útil é a técnica descrita em \`referencias.r${i}.tecnica\` como referência visual para executar a lâmina descrita em \`lamina\`, para a marca em \`marca\`? ` +
        "Julgue a técnica (composição, hierarquia, tipografia, luz, integração entre imagem e texto), não o assunto da foto.",
      criteria: NIVEIS_REFERENCIA,
    };
  });
  const state = {
    marca: { estilo: kit?.estilo ?? null, regras: kit?.regras ?? null },
    conceito: t.direcao.conceito,
    lamina: { funcao: card.funcao, composicao: card.composicao, ilustracao: card.ilustracao, texto_exato: card.texto_exato },
    referencias,
  };
  try {
    const res = await jevPerguntar({ state, questions });
    await cobrarJev(res, {
      clientId: t.client_id,
      tarefa: "estudio",
      referencia: { tipo: "estudio_trabalho", id: t.id },
      criadoPor,
    });
    const notas = candidatas
      .map((r, i) => ({ r, nota: notaScore(res.answers[`r${i}`]) }))
      .filter((x) => x.nota != null && x.nota >= NOTA_MINIMA_REFERENCIA)
      .sort((a, b) => (b.nota as number) - (a.nota as number))
      .slice(0, MAX_REFERENCIAS);
    return { refs: notas.map((x) => x.r), jev: "ok" };
  } catch (e) {
    // Sem Jev a lamina sai sem referencia, e o motivo fica gravado na versao.
    return { refs: [], jev: codigoMotor(e) };
  }
}

// ---------------------------------------------------------- conferencia

const ESQUEMA_LEITURA = {
  nome: "leitura_da_arte",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["texto_lido", "descricao_visual", "logo_presente"],
    properties: {
      texto_lido: { type: "string" },
      descricao_visual: { type: "string" },
      logo_presente: { type: "boolean" },
    },
  },
};

const SISTEMA_LEITURA = `Você é o leitor de artes do estúdio. Olhe a imagem e devolva:
- texto_lido: TODO o texto visível, exatamente como está desenhado, na ordem de leitura, com a grafia, os acentos e a pontuação que aparecem, inclusive erros e letras deformadas. Não corrija nada. Não transcreva o texto que faz parte da logo da marca.
- descricao_visual: em até 6 frases, a paleta observada (cores com hex aproximado), a tipografia (estilo, peso, caixa), a composição, o estilo da imagem e qualquer defeito (letra quebrada, objeto deformado, texto cortado).
- logo_presente: se aparece uma logo de marca na imagem.
Escreva sem travessão.`;

const NIVEIS_IDENTIDADE = [
  "Fora da marca: paleta, tipografia e clima não têm relação com o kit da marca.",
  "Pouco da marca: algum elemento lembra o kit, mas o conjunto parece de outra marca.",
  "Parcial: paleta ou tipografia seguem o kit, mas há desvio visível (cor fora da paleta, estilo diferente ou regra da marca quebrada).",
  "Da marca: paleta, tipografia e estilo seguem o kit, com desvio pequeno.",
  "Totalmente da marca: paleta, tipografia, estilo e regras do kit respeitados, e a lâmina cumpre a direção.",
];

/**
 * Conferencia de uma versao: o leitor transcreve o texto da imagem (modelo de
 * visao do catalogo, papel leitura) e o codigo compara com o texto_exato; o
 * Jev da a nota de identidade a partir da descricao visual. A leitura e feita
 * sobre o recorte 4:5 central (o que vai ao ar); sem a transformacao do
 * Storage, sobre a tela inteira, pedindo ao leitor que ignore as faixas.
 */
async function verificar(ch: Chamador, t: Trabalho, card: CardDirecao, caminho: string, kit: Kit, fontes: Fonte[]) {
  const usos: { usoId: string; custoUsd: number }[] = [];
  const v: Verificacao = { pendente: false, texto_lido: null, ortografia_ok: null, identidade: null };
  try {
    const recorte = await laminaFinal(caminho);
    v.leitura_no_recorte = recorte.redimensionada;
    const pedido = recorte.redimensionada
      ? "Leia esta arte (já no recorte final 4:5)."
      : `Leia esta arte. A tela tem ${recorte.largura ?? 1024} x ${recorte.altura ?? 1536} px e será cortada em 4:5 pelo centro: ignore tudo o que estiver nas faixas de 128 px do topo e da base, e leia só a área central.`;
    const leitor = await modeloDoPapel("leitura");
    const lido = await chamarTexto({
      clientId: t.client_id,
      tarefa: "verificacao",
      agente: "leitor",
      modeloId: leitor.id,
      sistema: SISTEMA_LEITURA,
      mensagens: [{ papel: "usuario", conteudo: pedido, imagens: [{ bytes: recorte.bytes, mime: "image/png", nome: `card-${card.ordem}.png` }] }],
      esquemaJson: ESQUEMA_LEITURA,
      maxTokensSaida: 6_000,
      referencia: { tipo: "estudio_trabalho", id: t.id },
      criadoPor: ch.userId,
    });
    usos.push({ usoId: lido.usoId, custoUsd: lido.custoUsd });
    const l = (lido.json ?? {}) as { texto_lido?: string; descricao_visual?: string; logo_presente?: boolean };
    v.texto_lido = texto(l.texto_lido, 2000);
    v.descricao_visual = texto(l.descricao_visual, 2000) || null;
    v.logo_presente = typeof l.logo_presente === "boolean" ? l.logo_presente : null;
    v.logo_ok = v.logo_presente == null ? null : v.logo_presente === levaLogo(t, card.ordem);
    const cmp = compararTexto(card.texto_exato, v.texto_lido);
    v.ortografia_ok = cmp.ortografia_ok;
    v.faltando = cmp.faltando;
    v.sobrando = cmp.sobrando;
  } catch (e) {
    // Saldo, cota e chave voltam como erro da chamada (402/403/503); o resto fica na verificacao.
    if (e instanceof IaMotorErro && STATUS_MOTOR[e.codigo]) throw e;
    v.erro = `leitura: ${codigoMotor(e)}`;
    return { verificacao: v, usos };
  }

  try {
    const res = await jevPerguntar({
      state: {
        kit: {
          paleta: kit?.paleta ?? [],
          estilo: kit?.estilo ?? null,
          regras: kit?.regras ?? null,
          fontes: fontes.map((f) => ({ nome: f.nome, papel: f.papel })),
        },
        conceito: t.direcao.conceito,
        lamina: { funcao: card.funcao, composicao: card.composicao, texto_exato: card.texto_exato },
        arte_gerada: { descricao_visual: v.descricao_visual, texto_lido: v.texto_lido, logo_presente: v.logo_presente },
      },
      questions: {
        identidade: {
          type: "score",
          instructions: "Quanto a arte descrita em `arte_gerada` segue a identidade da marca em `kit` e a direção da lâmina em `lamina`?",
          criteria: NIVEIS_IDENTIDADE,
        },
      },
    });
    const cobrado = await cobrarJev(res, {
      clientId: t.client_id,
      tarefa: "verificacao",
      referencia: { tipo: "estudio_trabalho", id: t.id },
      criadoPor: ch.userId,
    });
    if (cobrado) usos.push(cobrado);
    const resposta = res.answers.identidade;
    const nota = notaScore(resposta);
    v.identidade = {
      nota,
      escala_max: NIVEIS_IDENTIDADE.length - 1,
      nivel: nota == null ? null : NIVEIS_IDENTIDADE[Math.max(0, Math.min(NIVEIS_IDENTIDADE.length - 1, Math.round(nota)))],
      confianca: typeof resposta?.confidence === "number" ? resposta.confidence : null,
    };
  } catch (e) {
    v.identidade = { erro: codigoMotor(e) };
  }
  return { verificacao: v, usos };
}

/**
 * conferir_card { trabalho_id, ordem, versao? }: acao propria, chamada pela
 * tela logo depois de gerar ou ajustar, para cada chamada caber no tempo da
 * funcao. Sem versao, confere a atual. Grava a verificacao naquela versao.
 */
async function conferirCard(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  const card = cardDaDirecao(t, ordem);
  let alvo: VersaoCard | null;
  if (corpo.versao == null || corpo.versao === "") {
    alvo = versaoAtual(t, ordem);
  } else {
    const versao = Number(corpo.versao);
    if (!Number.isInteger(versao) || versao < 1) throw new ErroEstudio(400, "versao_invalida", "Versão do card inválida.");
    alvo = t.cards.find((c) => c.ordem === ordem && c.versao === versao) ?? null;
  }
  if (!alvo) throw new ErroEstudio(404, "versao_inexistente", "Esta versão do card não existe. Gere o card antes de conferir.");
  const [kit, fontes] = await Promise.all([lerKit(t.client_id), lerFontes(t.client_id)]);
  const conf = await verificar(ch, t, card, alvo.storage_path, kit, fontes);
  const custo = arred(conf.usos.reduce((s, u) => s + u.custoUsd, 0));
  const verificacao: Verificacao = {
    ...conf.verificacao,
    conferido_em: new Date().toISOString(),
    uso_ids: conf.usos.map((u) => u.usoId),
    custo_usd: custo,
  };
  const caminhoAlvo = alvo.storage_path;
  await mutarTrabalho(t.id, (atual) => ({
    cards: atual.cards.map((c) =>
      c.ordem === ordem && c.storage_path === caminhoAlvo
        ? { ...c, verificacao, custo_usd: arred(num(c.custo_usd) + custo), uso_ids: [...(c.uso_ids ?? []), ...(verificacao.uso_ids ?? [])] }
        : c
    ),
    custo_usd: arred(num(atual.custo_usd) + custo),
  }));
  return json({ trabalho_id: t.id, ordem, versao: alvo.versao, verificacao, custo_usd: custo });
}

// ------------------------------------------------------------- gerar card

const REGRA_TEXTO_NA_ARTE =
  "Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.";

function regrasDeRender(t: Trabalho, card: CardDirecao, anexos: string[], comLogo: boolean): string {
  return [
    "REGRAS FIXAS DE RENDER",
    `- ${REGRA_TEXTO_NA_ARTE}`,
    `- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "${card.texto_exato}"`,
    "- Tela 1024 x 1536. A peça final é vertical 4:5 (1080 x 1350), cortada pelo centro.",
    "- ÁREA ÚTIL: todo o texto, a logo e os elementos importantes ficam DENTRO da área central de 1024 x 1280 (de y = 128 a y = 1408), com margem de respiro de pelo menos 48 px até o limite dela. Nenhuma letra pode encostar ou entrar nas faixas de 128 px do topo e da base.",
    "- As faixas de 128 px no topo e na base recebem só continuação do fundo: serão cortadas.",
    comLogo
      ? "- Logo: use a logo oficial anexada exatamente como é, sem redesenhar, sem mudar cor nem proporção."
      : "- Sem logo nesta lâmina.",
    t.direcao.carrossel_infinito
      ? "- Carrossel infinito: o que chega à borda continua na lâmina vizinha com a mesma posição, escala, perspectiva e luz."
      : "",
    anexos.length ? `- Imagens anexadas, na ordem: ${anexos.join("; ")}.` : "",
    "- Sem travessão no texto.",
  ].filter(Boolean).join("\n");
}

/**
 * Guarda a versao sem sobrescrever nada: se outra chamada ja usou o numero,
 * sobe para o proximo. O numero do caminho e o numero gravado no card.
 */
async function salvarNaMesa(t: Trabalho, ordem: number, versaoInicial: number, png: Uint8Array, mime: string) {
  for (let versao = versaoInicial; versao < versaoInicial + 5; versao++) {
    const caminho = `${t.client_id}/estudio/${t.id}/card-${ordem}-v${versao}.png`;
    const { error } = await servico().storage.from("mesa").upload(caminho, new Blob([new Uint8Array(png)], { type: mime }), {
      contentType: mime,
      upsert: false,
    });
    if (!error) return { caminho, versao };
    const status = String((error as { statusCode?: string | number }).statusCode ?? "");
    if (status !== "409" && !/exist|duplicate/i.test(error.message)) break;
  }
  throw new ErroEstudio(503, "armazenamento_falhou", "A lâmina foi gerada, mas não foi possível guardá-la.");
}

async function urlAssinada(caminho: string): Promise<string | null> {
  const { data } = await servico().storage.from("mesa").createSignedUrl(caminho, 3600);
  return data?.signedUrl ?? null;
}

function lerOrdem(corpo: Record<string, unknown>): number {
  // Uma lamina por chamada: lista de ordens e recusada.
  if (Array.isArray(corpo.ordem)) throw new ErroEstudio(400, "uma_lamina_por_chamada", "Gere uma lâmina por chamada.");
  const ordem = Number(corpo.ordem);
  if (!Number.isInteger(ordem) || ordem < 1) throw new ErroEstudio(400, "ordem_invalida", "Ordem do card inválida.");
  return ordem;
}

function garantirEditavel(t: Trabalho) {
  if (t.status === "entregue") {
    throw new ErroEstudio(409, "trabalho_entregue", "Este trabalho já foi entregue. Prepare um novo para refazer as artes.");
  }
  if (!t.modelo_imagem_id) throw new ErroEstudio(409, "trabalho_sem_modelo", "O trabalho não tem modelo de imagem definido.");
}

async function gerarCard(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  garantirEditavel(t);
  const card = cardDaDirecao(t, ordem);
  const [kit, fontes] = await Promise.all([lerKit(t.client_id), lerFontes(t.client_id)]);

  const anexos: ImagemEntrada[] = [];
  const legendas: string[] = [];
  const comLogo = levaLogo(t, ordem);
  if (comLogo) {
    const logo = await baixarLogo(t.client_id, kit);
    if (logo) {
      anexos.push(logo);
      legendas.push(`imagem ${anexos.length}: logo oficial da marca`);
    }
  }
  for (const a of await amostrasDasFontes(fontes)) {
    anexos.push(a.imagem);
    legendas.push(`imagem ${anexos.length}: amostra da fonte ${a.fonte.nome} (${a.fonte.papel}), siga o desenho destas letras`);
  }
  // Continuidade: o card anterior; no carrossel infinito o final tambem ve a capa.
  const anterior = ordem > 1 ? versaoAtual(t, ordem - 1) : null;
  if (anterior) {
    anexos.push({ bytes: await baixar("mesa", anterior.storage_path), mime: "image/png", nome: `card-${ordem - 1}.png` });
    legendas.push(`imagem ${anexos.length}: card ${ordem - 1} já aprovado, esta lâmina continua a sequência`);
  }
  if (t.direcao.carrossel_infinito && ordem === totalCards(t) && ordem > 2) {
    const capa = versaoAtual(t, 1);
    if (capa) {
      anexos.push({ bytes: await baixar("mesa", capa.storage_path), mime: "image/png", nome: "card-1.png" });
      legendas.push(`imagem ${anexos.length}: capa, o final se conecta visualmente com ela`);
    }
  }
  const escolha = await escolherReferencias(t, card, kit, ch.userId);
  const idsReferencias: string[] = [];
  for (const ref of escolha.refs) {
    try {
      anexos.push(await imagemDaReferencia(ref));
      idsReferencias.push(ref.id);
      legendas.push(`imagem ${anexos.length}: referência de técnica (absorva composição e hierarquia, não copie a peça)`);
    } catch {
      // Referencia sem arquivo fica de fora desta lamina.
    }
  }

  const prompt = `${card.prompt_imagem}\n\n${regrasDeRender(t, card, legendas, comLogo)}`;
  const img = await chamarImagem({
    clientId: t.client_id,
    modeloId: t.modelo_imagem_id!,
    prompt,
    referencias: anexos,
    qualidade: (QUALIDADES.includes(t.qualidade as Qualidade) ? t.qualidade : QUALIDADE_PADRAO) as Qualidade,
    tamanho: TAMANHO_GERADOR,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor: ch.userId,
    tarefa: "estudio",
    agente: "gerador_imagem",
  });

  return await gravarVersao(ch, t, card, img, {
    origem: "gerar",
    referencias: idsReferencias,
    extra: { referencias_jev: escolha.jev },
  });
}

/**
 * Grava a versao nova com a conferencia pendente. A leitura do texto e o Jev
 * ficam em conferir_card, que a tela chama logo depois: assim gerar e ajustar
 * cabem no tempo da funcao.
 */
async function gravarVersao(
  ch: Chamador,
  t: Trabalho,
  card: CardDirecao,
  img: { png: Uint8Array; mime: string; usoId: string; custoUsd: number; saldoUsd: number },
  meta: { origem: "gerar" | "ajuste"; instrucao?: string; referencias?: string[]; custoExtraUsd?: number; extra?: Record<string, unknown> },
) {
  const proxima = Math.max(0, ...t.cards.filter((c) => c.ordem === card.ordem).map((c) => c.versao)) + 1;
  const { caminho, versao } = await salvarNaMesa(t, card.ordem, proxima, img.png, img.mime);
  const custo = arred(img.custoUsd);
  const nova: VersaoCard = {
    ordem: card.ordem,
    versao,
    storage_path: caminho,
    origem: meta.origem,
    instrucao: meta.instrucao ?? null,
    referencias: meta.referencias ?? [],
    verificacao: { pendente: true },
    custo_usd: arred(custo + num(meta.custoExtraUsd)),
    uso_ids: [img.usoId],
    criado_em: new Date().toISOString(),
    criado_por: ch.userId,
    ...(meta.extra ?? {}),
  };
  // Acrescenta a versao (nunca substitui): o caminho no bucket ja e unico.
  const gravado = await mutarTrabalho(t.id, (atual) => ({
    cards: [...atual.cards, nova],
    custo_usd: arred(num(atual.custo_usd) + custo),
    status: statusDepoisDeGerar(atual, [nova]),
  }));
  return json({
    trabalho_id: t.id,
    ordem: card.ordem,
    versao,
    storage_path: caminho,
    url: await urlAssinada(caminho),
    verificacao: nova.verificacao,
    proximo_passo: "conferir_card",
    custo_usd: custo,
    saldo_usd: img.saldoUsd,
    status: gravado.status,
  });
}

// ------------------------------------------------------------ ajustar card

const ESQUEMA_AJUSTE = {
  nome: "instrucao_de_edicao",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["instrucao_edicao", "texto_exato", "memoria"],
    properties: {
      instrucao_edicao: { type: "string" },
      texto_exato: { type: "string" },
      memoria: { type: "string" },
    },
  },
};

const INSTRUCOES_AJUSTE = `AJUSTE DE UMA LÂMINA

A imagem anexada é a versão atual da lâmina. A pessoa da equipe pediu um ajuste. Transforme o pedido numa instrução de edição precisa para o gerador de imagem, que vai editar ESTA imagem (não criar outra):
- instrucao_edicao: o que muda, onde fica, com que tamanho, cor (hex), peso e posição; e o que deve ficar exatamente igual (todo o resto da lâmina). Se o texto muda, escreva o texto novo entre aspas duplas, com acentos.
- texto_exato: o texto completo que deve aparecer escrito na lâmina depois do ajuste (igual ao atual se o pedido não mexe no texto).
- memoria: uma frase curta, reutilizável em outros trabalhos deste cliente, com o que o pedido ensina sobre o gosto da marca (ou vazio se for só correção pontual).
Escreva sem travessão.`;

async function ajustarCard(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  const pedido = texto(corpo.instrucao, 2000);
  if (!pedido) throw new ErroEstudio(400, "instrucao_vazia", "Descreva o ajuste que você quer.");
  garantirEditavel(t);
  const card = cardDaDirecao(t, ordem);
  const atualVersao = versaoAtual(t, ordem);
  if (!atualVersao) throw new ErroEstudio(409, "card_sem_versao", "Gere este card antes de pedir ajuste.");
  const atual = await baixar("mesa", atualVersao.storage_path);

  const [kit, prompt, diretor] = await Promise.all([
    lerKit(t.client_id),
    promptDoDiretor(t.client_id),
    modeloDoPapel("diretor_arte"),
  ]);
  const dir = await chamarTexto({
    clientId: t.client_id,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: diretor.id,
    raciocinio: raciocinioPara(diretor, ["medium", "low"]),
    sistema: `${prompt}\n\n${INSTRUCOES_AJUSTE}`,
    mensagens: [{
      papel: "usuario",
      conteudo: JSON.stringify({
        pedido,
        lamina: { ordem, funcao: card.funcao, texto_exato: card.texto_exato, composicao: card.composicao, leva_logo: levaLogo(t, ordem) },
        verificacao_atual: atualVersao.verificacao,
        marca: { paleta: kit?.paleta ?? [], estilo: kit?.estilo ?? null, regras: kit?.regras ?? null },
      }),
      imagens: [{ bytes: atual, mime: "image/png", nome: `card-${ordem}-v${atualVersao.versao}.png` }],
    }],
    esquemaJson: ESQUEMA_AJUSTE,
    maxTokensSaida: 8_000,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor: ch.userId,
  });
  const a = (dir.json ?? {}) as { instrucao_edicao?: string; texto_exato?: string; memoria?: string };
  const instrucaoEdicao = texto(a.instrucao_edicao, 4000);
  if (!instrucaoEdicao) throw new ErroEstudio(502, "ajuste_vazio", "O diretor não devolveu a instrução de edição. Tente de novo.");
  const novoTexto = texto(a.texto_exato, 1200) || card.texto_exato;
  const cardAjustado: CardDirecao = { ...card, texto_exato: novoTexto };

  // O texto novo passa a valer na direcao, para a conferencia comparar certo.
  let base = t;
  if (novoTexto !== card.texto_exato) {
    base = await mutarTrabalho(t.id, (x) => ({
      direcao: { ...x.direcao, cards: x.direcao.cards.map((c) => (c.ordem === ordem ? { ...c, texto_exato: novoTexto } : c)) },
      custo_usd: arred(num(x.custo_usd) + dir.custoUsd),
    }));
  } else {
    base = await mutarTrabalho(t.id, (x) => ({ custo_usd: arred(num(x.custo_usd) + dir.custoUsd) }));
  }

  // Edicao DENTRO do gerador sobre a versao atual (primeira imagem); a logo
  // vai junto na capa e no final para nao ser redesenhada.
  const referencias: ImagemEntrada[] = [];
  const legendas = ["imagem 1: versão atual da lâmina, que deve ser editada"];
  if (levaLogo(base, ordem)) {
    const logo = await baixarLogo(base.client_id, kit);
    if (logo) {
      referencias.push(logo);
      legendas.push("imagem 2: logo oficial da marca");
    }
  }
  const promptEdicao = [
    "EDITE a imagem 1. Mantenha exatamente igual tudo o que a instrução não manda mudar: composição, fundo, cores, tipografia, texto e posição dos elementos.",
    instrucaoEdicao,
    regrasDeRender(base, cardAjustado, legendas, levaLogo(base, ordem)),
  ].join("\n\n");
  const img = await chamarImagem({
    clientId: base.client_id,
    modeloId: base.modelo_imagem_id!,
    prompt: promptEdicao,
    referencias,
    editar: { bytes: atual },
    qualidade: (QUALIDADES.includes(base.qualidade as Qualidade) ? base.qualidade : QUALIDADE_PADRAO) as Qualidade,
    tamanho: TAMANHO_GERADOR,
    referencia: { tipo: "estudio_trabalho", id: base.id },
    criadoPor: ch.userId,
    tarefa: "estudio",
    agente: "gerador_imagem",
  });

  // O que foi pedido vai para a memoria do diretor (origem ajuste).
  const aprendizado = texto(a.memoria, 400);
  await servico().from("agente_memoria").insert({
    client_id: base.client_id,
    agente: "diretor_arte",
    tipo: "preferencia",
    texto: aprendizado
      ? `${aprendizado} (pedido no card ${ordem}: ${texto(pedido, 300)})`
      : `Ajuste pedido no card ${ordem} (${card.funcao}): ${texto(pedido, 500)}`,
    origem: "ajuste",
    referencia_id: base.id,
  });

  return await gravarVersao(ch, base, cardAjustado, img, {
    origem: "ajuste",
    instrucao: pedido,
    custoExtraUsd: dir.custoUsd,
    extra: { instrucao_edicao: instrucaoEdicao, versao_editada: atualVersao.versao, uso_diretor: dir.usoId },
  });
}

// ---------------------------------------------------------------- legenda

const ESQUEMA_LEGENDA = {
  nome: "legenda",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["legenda"],
    properties: { legenda: { type: "string" } },
  },
};

const INSTRUCOES_LEGENDA = `LEGENDA FINAL DO POST

Escreva a legenda do Instagram deste post a partir do item da agenda e da direção de arte já definida. A legenda completa a arte, não repete lâmina por lâmina.
- Primeira linha forte, que funcione antes do "mais".
- Parágrafos curtos, linguagem do público da marca, português do Brasil.
- Termine com a chamada para ação do item.
- Hashtags só se o item pedir, no máximo 5, no fim.
- Se o item já traz uma legenda prevista, parta dela e melhore sem mudar o sentido.
- Sem travessão. Sem inventar preço, dado ou promessa que não estão no item.`;

async function legenda(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  if (!t.task_id) throw new ErroEstudio(409, "trabalho_sem_item", "Este trabalho não está ligado a um item da agenda.");
  const item = await lerItemDaAgenda(t.task_id);
  const [prompt, diretor] = await Promise.all([promptDoDiretor(t.client_id), modeloDoPapel("diretor_arte")]);
  const r = await chamarTexto({
    clientId: t.client_id,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: diretor.id,
    sistema: `${prompt}\n\n${INSTRUCOES_LEGENDA}`,
    mensagens: [{
      papel: "usuario",
      conteudo: JSON.stringify({
        item: {
          titulo: item.tarefa.title,
          roteiro_e_contexto: texto(item.tarefa.description, 4000),
          objetivo: item.post?.objective ?? null,
          legenda_prevista: texto(item.post?.default_caption, 2200) || null,
          detalhe_do_estrategista: item.itemProposta ?? null,
        },
        direcao: {
          conceito: t.direcao.conceito,
          cards: t.direcao.cards.map((c) => ({ ordem: c.ordem, funcao: c.funcao, texto_exato: c.texto_exato })),
        },
      }),
    }],
    esquemaJson: ESQUEMA_LEGENDA,
    maxTokensSaida: 8_000,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor: ch.userId,
  });
  const final = texto((r.json as { legenda?: string } | undefined)?.legenda, 2200);
  if (!final) throw new ErroEstudio(502, "legenda_vazia", "O diretor não devolveu a legenda. Tente de novo.");
  const gravado = await mutarTrabalho(t.id, (x) => ({ legenda: final, custo_usd: arred(num(x.custo_usd) + r.custoUsd) }));
  return json({ trabalho_id: t.id, legenda: gravado.legenda, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, reserva_usada: r.reservaUsada ?? null });
}

// --------------------------------------------------------------- entregar

/**
 * Lamina no formato final 4:5. O gerador entrega 1024 x 1536; o corte e a
 * escala ficam com a transformacao de imagem do Storage (cover pelo centro,
 * sem gastar CPU da funcao). Se a transformacao nao estiver disponivel no
 * plano, entra a lamina como foi gerada e a resposta avisa.
 */
async function laminaFinal(caminho: string): Promise<{ bytes: Uint8Array; largura: number | null; altura: number | null; redimensionada: boolean }> {
  try {
    const { data, error } = await servico().storage.from("mesa").download(caminho, {
      transform: { width: LARGURA_FINAL, height: ALTURA_FINAL, resize: "cover", format: "origin" },
    });
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const d = dimensoesPng(bytes);
      // Aceita qualquer tamanho em 4:5 (o Storage pode nao ampliar alem do original).
      if (d && Math.abs(d.largura / d.altura - 0.8) < 0.01) {
        return { bytes, largura: d.largura, altura: d.altura, redimensionada: true };
      }
    }
  } catch {
    // cai no original abaixo
  }
  const original = await baixar("mesa", caminho);
  const d = dimensoesPng(original);
  return { bytes: original, largura: d?.largura ?? null, altura: d?.altura ?? null, redimensionada: false };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const resumo = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(resumo, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function entregar(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  if (t.status === "entregue" && t.file_ids.length) {
    return json({ trabalho_id: t.id, file_ids: t.file_ids, root_file_id: t.file_ids[0], ja_entregue: true });
  }
  if (!t.task_id) throw new ErroEstudio(409, "trabalho_sem_item", "Este trabalho não está ligado a um item da agenda.");
  const ultimas = t.direcao.cards.map((c) => ({ card: c, versao: versaoAtual(t, c.ordem) }));
  const semArte = ultimas.filter((u) => !u.versao).map((u) => u.card.ordem);
  if (!ultimas.length || semArte.length) {
    throw new ErroEstudio(409, "cards_sem_arte", "Gere todos os cards antes de entregar.", { cards_sem_arte: semArte });
  }

  const item = await lerItemDaAgenda(t.task_id);
  if (item.clientId !== t.client_id) throw new ErroEstudio(409, "item_de_outro_cliente", "O item da agenda não pertence a este cliente.");
  const projetoId = item.projeto.id;
  const total = ultimas.length;
  const ehCarrossel = total > 1;
  const tipo = ehCarrossel ? "carrossel" : "post";
  const nomeBase = texto(item.tarefa.title, 160) || "Arte do estúdio";
  const legendaFinal = t.legenda?.trim() || item.post?.default_caption?.trim() || null;
  const descricao = texto(`Arte do Estúdio (Mesa do cliente). ${t.direcao.conceito}`, 1000);

  const fileIds: string[] = [];
  const formatos: { ordem: number; largura: number | null; altura: number | null; redimensionada: boolean }[] = [];
  let paiId: string | null = null;

  for (let i = 0; i < total; i++) {
    const { card, versao } = ultimas[i];
    // Idempotente: uma nova tentativa reaproveita o que ja foi registrado.
    // Depois de uma reprovacao a rodada sobe e a entrega vira arquivo novo
    // (a rodada 1 mantem a chave antiga, das entregas ja feitas).
    const rodada = Math.max(1, Number(t.entrega_rodada) || 1);
    const chave = rodada > 1 ? `estudio-arte:${t.id}:r${rodada}:${i}` : `estudio-arte:${t.id}:${i}`;
    const { data: existente } = await servico().from("files").select("id, client_id").eq("idempotency_key", chave).maybeSingle();
    const ja = existente as { id: string; client_id: string } | null;
    if (ja) {
      if (ja.client_id !== t.client_id) throw new ErroEstudio(409, "chave_de_arquivo_em_uso", "O registro deste envio pertence a outro cliente.");
      fileIds.push(ja.id);
      if (i === 0) paiId = ja.id;
      continue;
    }

    const lamina = await laminaFinal(versao!.storage_path);
    formatos.push({ ordem: card.ordem, largura: lamina.largura, altura: lamina.altura, redimensionada: lamina.redimensionada });

    // Mesmo caminho da tela de Arquivos: <cliente>/<grupo>/v1/<n>-<nome>.png
    // no bucket files, enviado com o JWT de quem chamou.
    const fileId = crypto.randomUUID();
    const grupo: string = paiId ?? fileId;
    const caminho: string = `${t.client_id}/${grupo}/v1/${i + 1}-${nomeSeguro(nomeBase)}.png`;
    const { error: erroUpload } = await ch.doChamador.storage
      .from("files")
      .upload(caminho, new Blob([new Uint8Array(lamina.bytes)], { type: "image/png" }), { contentType: "image/png", upsert: false });
    if (erroUpload) {
      throw new ErroEstudio(503, "envio_de_arquivo_falhou", "Não foi possível enviar a arte para Arquivos. Tente entregar de novo.", {
        card: card.ordem,
        detalhe: erroUpload.message,
      });
    }

    const nome = i === 0 ? nomeBase : (ehCarrossel ? `${nomeBase} (${i + 1}/${total})` : nomeBase);
    // create_file_record le auth.uid(): roda com o JWT de quem chamou, como na tela.
    const { data: registro, error: erroRegistro } = await ch.doChamador.rpc("create_file_record", {
      p_file: {
        id: fileId,
        client_id: t.client_id,
        file_name: nome,
        file_url: `files://${caminho}`,
        file_type: ehCarrossel ? "carrossel" : "post",
        mime_type: "image/png",
        extension: "png",
        storage_bucket: "files",
        storage_path: caminho,
        size_bytes: lamina.bytes.byteLength,
        // A publicacao automatica na Meta exige o sha256 de cada lamina.
        sha256: await sha256Hex(lamina.bytes),
        folder: "materiais",
        project_id: projetoId,
        status: "ready",
        version: 1,
        caption: i === 0 ? legendaFinal : null,
        description: i === 0 ? descricao : null,
        parent_file_id: ehCarrossel && i > 0 ? paiId : null,
        idempotency_key: chave,
      },
    });
    if (erroRegistro || !registro) {
      await ch.doChamador.storage.from("files").remove([caminho]).catch(() => {});
      throw new ErroEstudio(503, "registro_de_arquivo_falhou", "A arte subiu, mas o registro em Arquivos falhou. Tente entregar de novo.", {
        card: card.ordem,
        detalhe: erroRegistro?.message ?? null,
      });
    }
    const id: string = (registro as { id: string }).id;
    fileIds.push(id);
    if (i === 0) paiId = id;
  }

  const gravado = await mutarTrabalho(t.id, () => ({ file_ids: fileIds, status: "entregue", legenda: legendaFinal }));
  return json({
    trabalho_id: t.id,
    status: gravado.status,
    tipo,
    project_id: projetoId,
    root_file_id: fileIds[0],
    file_ids: fileIds,
    formatos,
    aviso: formatos.some((f) => !f.redimensionada)
      ? "A transformação de imagem do Storage não respondeu: parte das artes foi entregue em 1024 x 1536, como gerada."
      : null,
  });
}

// ------------------------------------------------------------ referencias

const HOST_PINTEREST = /(^|\.)pinterest\.[a-z.]{2,8}$/i;
const HOST_IMAGEM_PINTEREST = /(^|\.)pinimg\.com$/i;

function hostPermitido(url: URL, imagem = false): boolean {
  if (url.protocol !== "https:") return false;
  if (imagem) return HOST_IMAGEM_PINTEREST.test(url.hostname);
  return HOST_PINTEREST.test(url.hostname) || url.hostname.toLowerCase() === "pin.it";
}

/** Busca seguindo redirecionamentos na mao, conferindo o host a cada salto. */
async function buscarPinterest(inicial: URL, imagem: boolean): Promise<{ res: Response; url: URL }> {
  let url = inicial;
  for (let salto = 0; salto < 5; salto++) {
    if (!hostPermitido(url, imagem)) throw new ErroEstudio(400, "link_fora_do_pinterest", "O link precisa ser de um pin do Pinterest.");
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AceleriqEstudio/1.0)", "Accept-Language": "pt-BR,pt;q=0.9" },
        signal: AbortSignal.timeout(TIMEOUT_PINTEREST_MS),
      });
    } catch {
      throw new ErroEstudio(504, "pinterest_indisponivel", "O Pinterest não respondeu a tempo.");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new ErroEstudio(502, "pinterest_recusou", `O Pinterest respondeu ${res.status}.`);
    }
    return { res, url };
  }
  throw new ErroEstudio(502, "pinterest_redirecionou_demais", "O link do Pinterest redirecionou vezes demais.");
}

function ogImage(html: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const nome of ["og:image:secure_url", "og:image"]) {
    for (const m of metas) {
      const prop = m.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
      if (prop?.toLowerCase() !== nome) continue;
      const conteudo = m.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
      if (conteudo) return conteudo.replace(/&amp;/g, "&");
    }
  }
  return null;
}

const urlCanonica = (u: URL) => `https://${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;

async function referenciaPorUrl(clientId: string, url: string) {
  const { data } = await servico().from("cliente_referencias").select("*").eq("client_id", clientId).eq("url_origem", url).maybeSingle();
  return data as Referencia | null;
}

async function importarPinterest(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  let entrada: URL;
  try {
    entrada = new URL(texto(corpo.url, 1000));
  } catch {
    throw new ErroEstudio(400, "link_invalido", "Cole o link de um pin do Pinterest.");
  }
  if (!hostPermitido(entrada)) throw new ErroEstudio(400, "link_fora_do_pinterest", "O link precisa ser de um pin do Pinterest.");
  const jaTinha = await referenciaPorUrl(clientId, urlCanonica(entrada));
  if (jaTinha) return json({ referencia: jaTinha, ja_existia: true });

  const pagina = await buscarPinterest(entrada, false);
  const html = (await pagina.res.text()).slice(0, 2_000_000);
  const canonica = urlCanonica(pagina.url);
  const jaTinhaFinal = await referenciaPorUrl(clientId, canonica);
  if (jaTinhaFinal) return json({ referencia: jaTinhaFinal, ja_existia: true });

  const og = ogImage(html);
  if (!og) throw new ErroEstudio(422, "pin_sem_imagem", "Não achei a imagem deste pin.");
  let urlImagem: URL;
  try {
    urlImagem = new URL(og, pagina.url);
  } catch {
    throw new ErroEstudio(422, "pin_sem_imagem", "Não achei a imagem deste pin.");
  }
  const imagem = await buscarPinterest(urlImagem, true);
  const bytes = new Uint8Array(await imagem.res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES_IMAGEM) throw new ErroEstudio(413, "imagem_grande_demais", "A imagem do pin é grande demais.");
  const mime = mimeDe(bytes);
  if (!mime) throw new ErroEstudio(415, "imagem_invalida", "O arquivo do pin não é uma imagem reconhecida.");

  const id = crypto.randomUUID();
  const caminho = `${clientId}/referencias/pinterest-${id}.${extensaoDe(mime)}`;
  const { error: erroUpload } = await servico().storage.from("mesa").upload(caminho, new Blob([new Uint8Array(bytes)], { type: mime }), { contentType: mime });
  if (erroUpload) throw new ErroEstudio(503, "armazenamento_falhou", "Não foi possível guardar a imagem do pin.");

  const { data, error } = await servico()
    .from("cliente_referencias")
    .insert({ id, client_id: clientId, origem: "pinterest", url_origem: canonica, storage_path: caminho, ativa: true })
    .select("*")
    .single();
  if (error) {
    await servico().storage.from("mesa").remove([caminho]).catch(() => {});
    // Corrida com outra importacao do mesmo pin: devolve a que ficou.
    const outra = await referenciaPorUrl(clientId, canonica);
    if (outra) return json({ referencia: outra, ja_existia: true });
    throw new ErroEstudio(503, "gravacao_falhou", "Não foi possível criar a referência.");
  }
  return json({ referencia: data, ja_existia: false });
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function sincronizarWorkspace(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const { data, error } = await servico()
    .from("workspace_nodes")
    .select("id, parent_id, kind, name, mime, storage_path")
    .eq("client_id", clientId)
    .limit(5000);
  if (error) throw new ErroEstudio(503, "workspace_indisponivel", "Não foi possível ler o workspace do cliente.");
  const nos = (data as { id: string; parent_id: string | null; kind: string; name: string; mime: string | null; storage_path: string | null }[] | null) ?? [];

  // Pastas cujo nome contem "refer" (sem caixa e sem acento) e tudo abaixo delas.
  const filhos = new Map<string, typeof nos>();
  for (const n of nos) {
    if (!n.parent_id) continue;
    const lista = filhos.get(n.parent_id) ?? [];
    lista.push(n);
    filhos.set(n.parent_id, lista);
  }
  const pastas = nos.filter((n) => n.kind === "folder" && semAcento(n.name).includes("refer"));
  const imagens = new Map<string, (typeof nos)[number]>();
  const visitadas = new Set<string>();
  const fila = pastas.map((p) => p.id);
  while (fila.length) {
    const id = fila.shift()!;
    if (visitadas.has(id)) continue;
    visitadas.add(id);
    for (const f of filhos.get(id) ?? []) {
      if (f.kind === "folder") fila.push(f.id);
      else if (f.storage_path && (f.mime ?? "").startsWith("image/")) imagens.set(f.id, f);
    }
  }
  if (!imagens.size) return json({ pastas: pastas.length, imagens: 0, novas: 0 });

  // So liga: a imagem continua morando no workspace (storage_path nulo).
  const linhas = [...imagens.values()].map((n) => ({ client_id: clientId, origem: "workspace", workspace_node_id: n.id, ativa: true }));
  const { data: novas, error: erroInsert } = await servico()
    .from("cliente_referencias")
    .upsert(linhas, { onConflict: "client_id,workspace_node_id", ignoreDuplicates: true })
    .select("id");
  if (erroInsert) throw new ErroEstudio(503, "gravacao_falhou", "Não foi possível ligar as referências do workspace.");
  return json({ pastas: pastas.length, imagens: imagens.size, novas: (novas as unknown[] | null)?.length ?? 0 });
}

const ESQUEMA_LER = {
  nome: "leitura_de_referencia",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["leitura", "tags"],
    properties: {
      leitura: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
};

const SISTEMA_LER = `Você é o leitor de referências visuais de um estúdio de direção de arte. Descreva a TÉCNICA da peça, não o assunto, para outro diretor reaproveitar sem copiar:
- leitura: em até 8 frases, composição e grid, hierarquia, tipografia (estilo, peso, caixa, escala), profundidade e planos, enquadramento e recortes, espaçamento e ritmo, luz e cor, integração entre fotografia e elementos gráficos.
- tags: de 3 a 8 palavras curtas em português (ex.: "tipografia gigante", "recorte", "fundo chapado").
Escreva sem travessão.`;

async function lerReferencia(ch: Chamador, corpo: Record<string, unknown>) {
  const id = texto(corpo.referencia_id, 64);
  if (!UUID.test(id)) throw new ErroEstudio(400, "referencia_invalida", "Referência inválida.");
  const { data } = await servico()
    .from("cliente_referencias")
    .select("id, client_id, origem, workspace_node_id, url_origem, storage_path, leitura, tags")
    .eq("id", id)
    .maybeSingle();
  const ref = data as Referencia | null;
  if (!ref) throw new ErroEstudio(404, "referencia_inexistente", "Referência não encontrada.");
  await garantirAcesso(ch, ref.client_id);
  const imagem = await imagemDaReferencia(ref);
  if (imagem.mime === "image/gif") throw new ErroEstudio(415, "imagem_invalida", "GIF não pode ser lido. Use PNG, JPG ou WEBP.");
  const leitor = await modeloDoPapel("leitura");
  // Custo na carteira do cliente da referencia.
  const r = await chamarTexto({
    clientId: ref.client_id,
    tarefa: "leitura_referencia",
    agente: "leitor",
    modeloId: leitor.id,
    sistema: SISTEMA_LER,
    mensagens: [{ papel: "usuario", conteudo: "Leia a técnica desta referência.", imagens: [imagem] }],
    esquemaJson: ESQUEMA_LER,
    maxTokensSaida: 6_000,
    referencia: { tipo: "cliente_referencia", id: ref.id },
    criadoPor: ch.userId,
  });
  const l = (r.json ?? {}) as { leitura?: string; tags?: unknown };
  const leitura = texto(l.leitura, 3000);
  if (!leitura) throw new ErroEstudio(502, "leitura_vazia", "O leitor não descreveu a referência. Tente de novo.");
  const tags = Array.isArray(l.tags) ? (l.tags as unknown[]).map((x) => texto(x, 40)).filter(Boolean).slice(0, 8) : [];
  const { data: atualizada, error } = await servico()
    .from("cliente_referencias")
    .update({ leitura, tags })
    .eq("id", ref.id)
    .eq("client_id", ref.client_id)
    .select("*")
    .single();
  if (error) throw new ErroEstudio(503, "gravacao_falhou", "A leitura foi feita, mas não foi gravada.", { uso_id: r.usoId });
  return json({ referencia: atualizada, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, reserva_usada: r.reservaUsada ?? null });
}

async function referencias(ch: Chamador, corpo: Record<string, unknown>) {
  const sub = String(corpo.subacao ?? "");
  if (sub === "importar_pinterest") return await importarPinterest(ch, corpo);
  if (sub === "sincronizar_workspace") return await sincronizarWorkspace(ch, corpo);
  if (sub === "ler") return await lerReferencia(ch, corpo);
  throw new ErroEstudio(400, "subacao_desconhecida", "Subação de referências desconhecida.", {
    aceitas: ["importar_pinterest", "sincronizar_workspace", "ler"],
  });
}

// ------------------------------------------------------------------ porta

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  preparar,
  gerar_card: gerarCard,
  conferir_card: conferirCard,
  ajustar_card: ajustarCard,
  legenda,
  entregar,
  referencias,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return erro(405, "metodo_nao_permitido", "Use POST.");

  let ch: Chamador | null = null;
  try {
    ch = await identificar(req);
  } catch {
    ch = null;
  }
  if (!ch) return erro(401, "nao_autorizado", "Sessão expirada ou sem permissão de equipe.");

  let corpo: Record<string, unknown> = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio */ }
  const acao = String(corpo.acao ?? "");
  const executar = ACOES[acao];
  if (!executar) return erro(400, "acao_desconhecida", "Ação desconhecida.", { aceitas: Object.keys(ACOES) });

  try {
    return await executar(ch, corpo);
  } catch (e) {
    if (e instanceof ErroEstudio) return erro(e.status, e.codigo, e.message, e.detalhes);
    if (e instanceof IaMotorErro) return respostaDoMotor(e);
    if (e instanceof JevErro) return erro(502, "jev_indisponivel", "A conferência do Jev não respondeu. Tente de novo.", { codigo: e.codigo });
    // Log so com o codigo e a acao: nada de prompt nem dado de cliente.
    console.error("estudio-arte: falha inesperada", { acao, erro: e instanceof Error ? e.name : "desconhecido" });
    return erro(500, "erro_interno", "Erro inesperado no estúdio. Tente de novo.");
  }
});
