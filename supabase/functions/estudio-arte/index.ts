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
  recusouTamanho,
  TAMANHO_2X3,
  TAMANHO_4X5,
  type ImagemEntrada,
  type ModeloIa,
  type Qualidade,
} from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar, notaScore, type PerguntaJev } from "../_shared/jev.ts";
import { CONHECIMENTO_DIRETOR, PADRAO_NA_IMAGEM } from "../_shared/conhecimento-design.ts";
import {
  blocosDoTexto,
  caixaDaLogo,
  caixaDaZona,
  direcaoDoRoteiro,
  formatoPara2x3,
  normalizarLayout,
  promptDaLamina,
  resumoDaComposicao,
  type BlocoTexto,
  type CardDirecao,
  type MarcaParaDirecao,
} from "../_shared/direcao-arte.ts";
import { caminhoDoArquivo, lerContextoConsolidado, sincronizarAcervo, sincronizarReferencias } from "../_shared/contexto-cliente.ts";
import {
  ampliar,
  type Area,
  devolverOriginalForaDasAreas,
  analisarLogo,
  fotoNaLamina,
  logoLimpa,
  mascara,
  metadeDireita,
  normalizarAreas,
  TAMANHO_TELA_DUPLA,
  telaDupla,
} from "../_shared/imagem-local.ts";

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
// Média: US$ 0,01 por lâmina contra US$ 0,04 da alta, com texto nítido no
// recorte final. A alta fica para quando a equipe pedir (seletor na tela).
const QUALIDADE_PADRAO: Qualidade = "media";
// Formato de geração: 4:5 direto (2:3 de reserva no motor). Direções antigas, sem layout, seguem em 2:3.
const TAMANHO_GERADOR = TAMANHO_4X5;
const LARGURA_FINAL = 1080;
const ALTURA_FINAL = 1350;
const MAX_CARDS = 20;
// Uma referência de identidade (arte da própria marca) e uma de técnica: cada
// imagem anexada custa tokens de entrada no gerador.
const MAX_REFERENCIAS = 2;
const MAX_CANDIDATAS_JEV = 16;
const MAX_AMOSTRAS_FONTE = 2;
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

type Direcao = {
  conceito: string;
  carrossel_infinito: boolean;
  cards: CardDirecao[];
  origem?: "diretor" | "roteiro";
  /** Referências escolhidas na tela para o conjunto (ids de cliente_referencias; prefixo g: = banco global). */
  referencias_ids?: string[];
  /** Último pedido feito ao diretor sobre o conjunto (conversa com o diretor). */
  pedido?: string | null;
  /** Protagonista, cenário, luz e tratamento que se repetem em todas as lâminas (a série). */
  fio_visual?: string | null;
  /** Campanha (mesa_campanhas) do conteúdo: identidade do tema e selo entram em cada lâmina. */
  campanha_id?: string | null;
};

type CampanhaDaLamina = {
  id: string;
  nome: string;
  conceito: string | null;
  identidade: { tema_visual?: string; paleta_apoio?: { nome?: string; hex?: string }[]; tipografia?: string; elementos?: string; tom?: string; selo?: { texto?: string; descricao?: string } } | null;
  referencias_ids: string[] | null;
  selo_path: string | null;
};

async function lerCampanha(clientId: string, id: unknown): Promise<CampanhaDaLamina | null> {
  const cid = typeof id === "string" ? id : "";
  if (!UUID.test(cid)) return null;
  const { data } = await servico()
    .from("mesa_campanhas")
    .select("id, nome, conceito, identidade, referencias_ids, selo_path")
    .eq("id", cid)
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as CampanhaDaLamina | null) ?? null;
}

/** Bloco do prompt da lâmina com a identidade do tema da campanha (dentro da marca). */
function blocoDaCampanha(c: CampanhaDaLamina): string {
  const i = c.identidade ?? {};
  const apoio = (i.paleta_apoio ?? []).filter((p) => p.hex).map((p) => `${p.nome || "apoio"} ${p.hex}`).join(", ");
  return [
    `CAMPANHA "${c.nome}" (identidade do tema, sempre dentro da marca)`,
    i.tema_visual ? `- Tema visual: ${i.tema_visual}` : "",
    apoio ? `- Cores de apoio da campanha (só como acento, a paleta da marca continua dominante): ${apoio}` : "",
    i.tipografia ? `- Título da campanha: ${i.tipografia}` : "",
    i.elementos ? `- Elementos gráficos: ${i.elementos}` : "",
  ].filter(Boolean).join("\n");
}

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
  hashtags?: string[] | null;
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

type Kit = {
  paleta: unknown;
  logo_file_id: string | null;
  /** Logo escolhida de qualquer pasta (copiada para o bucket mesa); tem prioridade sobre logo_file_id. */
  logo_path?: string | null;
  logo_alt_path?: string | null;
  estilo: string | null;
  regras: string | null;
} | null;

async function lerKit(clientId: string): Promise<Kit> {
  const { data } = await servico()
    .from("cliente_kit_marca")
    .select("paleta, logo_file_id, logo_path, logo_alt_path, estilo, regras")
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

/**
 * Logo oficial: a escolhida de qualquer pasta (kit.logo_path, no bucket mesa,
 * sempre sob a pasta do cliente) e, sem ela, o arquivo do kit.
 */
async function baixarLogo(clientId: string, kit: Kit): Promise<ImagemEntrada | null> {
  const bruta = await baixarLogoBruta(clientId, kit);
  if (!bruta) return null;
  // Sem o fundo falso (xadrez de transparência ou branco): o gerador copiava como uma caixa.
  try {
    const limpa = await logoLimpa(bruta.bytes);
    return limpa === bruta.bytes ? bruta : { bytes: limpa, mime: "image/png", nome: "logo-oficial.png" };
  } catch {
    return bruta;
  }
}

async function baixarLogoBruta(clientId: string, kit: Kit): Promise<ImagemEntrada | null> {
  if (kit?.logo_path && kit.logo_path.startsWith(`${clientId}/`)) {
    try {
      return await baixarImagem("mesa", kit.logo_path, "logo-oficial");
    } catch {
      // cai no arquivo do kit abaixo
    }
  }
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
  file_id?: string | null;
  /** identidade: arte da própria marca; tecnica: peça que ensina composição; global: banco da agência. */
  papel?: string | null;
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
  if (ref.file_id) {
    const { data } = await servico()
      .from("files")
      .select("client_id, storage_bucket, storage_path, file_url")
      .eq("id", ref.file_id)
      .maybeSingle();
    const f = data as { client_id: string; storage_bucket: string | null; storage_path: string | null; file_url: string | null } | null;
    const c = f && f.client_id === ref.client_id ? caminhoDoArquivo(f) : null;
    if (!c) throw new ErroEstudio(404, "referencia_sem_arquivo", "A arte desta referência não está mais em Arquivos.");
    return await baixarImagem(c.bucket, c.caminho, `arte-da-marca-${ref.id.slice(0, 8)}`);
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

/** Marca pronta para o compositor: kit, fontes, contexto consolidado e nome. */
async function marcaDoCliente(clientId: string, kit?: Kit, fontes?: Fonte[]): Promise<MarcaParaDirecao> {
  const [k, f, contexto, perfil] = await Promise.all([
    kit === undefined ? lerKit(clientId) : Promise.resolve(kit),
    fontes === undefined ? lerFontes(clientId) : Promise.resolve(fontes),
    lerContextoConsolidado(servico(), clientId),
    servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle(),
  ]);
  const p = perfil.data as { company_name: string | null; full_name: string | null } | null;
  return {
    nomeCliente: texto(p?.company_name || p?.full_name || "cliente", 120),
    paleta: Array.isArray(k?.paleta) ? k!.paleta as MarcaParaDirecao["paleta"] : [],
    estilo: k?.estilo ?? null,
    regras: k?.regras ?? null,
    fontes: f.map((x) => ({ nome: x.nome, papel: x.papel })),
    tipografiaCitada: contexto.tipografia ?? null,
    tomDeVoz: contexto.tom_de_voz ?? null,
    temLogo: !!(k?.logo_path || k?.logo_file_id),
  };
}

// ------------------------------------------------ acervo de imagens reais

type ImagemAcervo = {
  id: string;
  client_id: string;
  storage_bucket: string;
  storage_path: string;
  nome: string;
  pasta: string | null;
  categoria: string | null;
  tags: string[] | null;
  descricao: string | null;
};

const CAMPOS_ACERVO = "id, client_id, storage_bucket, storage_path, nome, pasta, categoria, tags, descricao";

/** Acervo ativo do cliente para o diretor escolher a foto de cada lâmina (sem custo). */
async function lerAcervo(clientId: string, limite = 60): Promise<ImagemAcervo[]> {
  const { data } = await servico()
    .from("cliente_imagens")
    .select(CAMPOS_ACERVO)
    .eq("client_id", clientId)
    .eq("ativa", true)
    // neq sozinho descartava as fotos ainda sem categoria (NULL); arte pronta e logo não servem de base.
    .or("categoria.is.null,categoria.not.in.(logo,arte)")
    .order("atualizado_em", { ascending: false })
    .limit(limite);
  return (data as ImagemAcervo[] | null) ?? [];
}

async function imagensDoAcervo(clientId: string, ids: string[]): Promise<ImagemAcervo[]> {
  const validos = ids.filter((i) => UUID.test(i)).slice(0, 8);
  if (!validos.length) return [];
  const { data } = await servico().from("cliente_imagens").select(CAMPOS_ACERVO).eq("client_id", clientId).in("id", validos);
  const achadas = (data as ImagemAcervo[] | null) ?? [];
  return validos.map((i) => achadas.find((a) => a.id === i)).filter(Boolean) as ImagemAcervo[];
}

const resumoDaFoto = (a: ImagemAcervo) =>
  texto([a.descricao, a.categoria ? `categoria ${a.categoria}` : "", a.pasta ? `pasta ${a.pasta}` : ""].filter(Boolean).join("; ") || a.nome, 400);

/**
 * Foto real já no formato da lâmina (1088 x 1360, cover pelo centro). Pede o
 * recorte à transformação do Storage (sem gastar CPU da função) e, sem ela,
 * recorta aqui.
 */
async function fotoRealNaLamina(a: ImagemAcervo): Promise<Uint8Array> {
  try {
    const { data, error } = await servico().storage.from(a.storage_bucket).download(a.storage_path, {
      transform: { width: 1088, height: 1360, resize: "cover", format: "origin" },
    });
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (mimeDe(bytes)) return await fotoNaLamina(bytes);
    }
  } catch {
    // cai no original abaixo
  }
  return await fotoNaLamina(await baixar(a.storage_bucket, a.storage_path));
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

const ZONAS_TEXTO = ["topo-esquerda", "topo-centro", "centro-esquerda", "centro", "base-esquerda", "base-centro", "base-direita", "coluna-esquerda", "coluna-direita"];

const ESQUEMA_DIRECAO = {
  nome: "direcao_de_arte",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["conceito", "fio_visual", "carrossel_infinito", "cards"],
    properties: {
      conceito: { type: "string" },
      fio_visual: { type: "string" },
      carrossel_infinito: { type: "boolean" },
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "funcao", "blocos", "layout", "evitar", "imagem_acervo"],
          properties: {
            ordem: { type: "integer" },
            imagem_acervo: { type: "string" },
            funcao: { type: "string", enum: ["capa", "conteudo", "cta"] },
            blocos: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["papel", "texto"],
                properties: {
                  papel: { type: "string", enum: ["headline", "subtitulo", "apoio", "numero", "cta", "selo"] },
                  texto: { type: "string" },
                },
              },
            },
            layout: {
              type: "object",
              additionalProperties: false,
              required: ["zona_texto", "alinhamento", "imagem", "ponto_focal", "fundo", "tratamento", "cor_fundo", "cor_texto", "cor_destaque"],
              properties: {
                zona_texto: { type: "string", enum: ZONAS_TEXTO },
                alinhamento: { type: "string", enum: ["esquerda", "centro", "direita"] },
                imagem: { type: "string" },
                ponto_focal: { type: "string" },
                fundo: { type: "string" },
                tratamento: { type: "string" },
                cor_fundo: { type: "string" },
                cor_texto: { type: "string" },
                cor_destaque: { type: "string" },
              },
            },
            evitar: { type: "string" },
          },
        },
      },
    },
  },
};

const INSTRUCOES_DIRECAO = `COMO ENTREGAR A DIREÇÃO (regras técnicas do estúdio)

Um gerador de imagem desenha cada lâmina INTEIRA numa imagem só, texto incluído. O estúdio monta o prompt final em código a partir do que você devolver, já com a área útil, as margens do grid, os tamanhos de letra, a paleta e as fontes da marca. Por isso você decide só o essencial, com precisão:

- conceito: a ideia visual do conjunto em até 3 frases.
- fio_visual: o que se repete em TODAS as lâminas para o carrossel ser uma série só, em 2 a 4 frases concretas: a protagonista (quem é, idade aproximada, cabelo, roupa) ou o objeto protagonista, o cenário (lugar, cores, objetos fixos), a luz (hora, direção, temperatura) e o tratamento de foto. Se as artes já publicadas da marca têm uma protagonista e um cenário, siga os mesmos.
- carrossel_infinito: siga \`item.carrossel_infinito_pedido\` quando vier (a equipe decidiu no começo). Verdadeiro: o conjunto é UMA cena panorâmica que atravessa as lâminas (o fundo de uma continua na outra); escreva cada layout.imagem como o trecho seguinte da mesma cena, da esquerda para a direita.
- cards: uma entrada por lâmina, na ordem do roteiro. Post único tem um card só. Quantidade pelo conteúdo: o mínimo que conta a história inteira, em geral 4 a 6 lâminas; 7 ou mais só quando o conteúdo pede (lista longa, passo a passo). Menos lâminas custa menos. Se \`item.quantidade_de_laminas_pedida\` vier, use exatamente essa quantidade.
  - funcao: capa, conteudo ou cta (o último card de carrossel é cta).
  - blocos: o texto da lâmina dividido por papel, na ordem de leitura: headline (a frase dominante, curta, quebrada por sentido com \\n), subtitulo, apoio, numero (quando um número é o protagonista), cta, selo. No máximo 3 níveis de hierarquia. Texto exatamente como vai aparecer, com acentos, sem travessão.
  - layout.zona_texto: onde fica o bloco de texto (topo-esquerda, topo-centro, centro-esquerda, centro, base-esquerda, base-centro, base-direita, coluna-esquerda, coluna-direita). Varie entre as lâminas do miolo; mantenha o mesmo eixo de alinhamento no carrossel.
  - layout.alinhamento: esquerda na maioria dos casos; centro só em peça curta e simétrica de propósito.
  - layout.imagem: a imagem concreta (foto real do nicho, objeto, cenário, recorte), com enquadramento e luz.
  - layout.ponto_focal: o que domina a lâmina e onde fica.
  - layout.fundo: o que ocupa o fundo e como o texto ganha área calma.
  - layout.tratamento: técnica de composição da base de conhecimento aplicada nesta lâmina (planos, recorte, escala, espaço negativo).
  - layout.cor_fundo, cor_texto, cor_destaque: hex da paleta da marca (string vazia se não houver paleta).
  - evitar: o que não pode acontecer nesta lâmina (repetição de lâmina anterior, elemento genérico, cor fora da paleta).
  - imagem_acervo: o id de uma foto REAL do cliente em \`acervo\` que serve de base para esta lâmina (ambiente, antes e depois, equipe, produto), ou string vazia. A foto é usada como está, sem ser refeita: escolha só quando ela combina com o texto e tem área calma para o texto na zona escolhida. Nunca a mesma foto em duas lâminas. Prefira foto real a imagem inventada sempre que houver uma boa.

NARRATIVA E CONTINUIDADE (obrigatório)
- Carrossel é uma história só, nunca frases picotadas: a capa abre uma tensão, cada lâmina avança um passo e prepara a seguinte (conectivos, continuidade de sentido), o final resolve e chama para a ação.
- Série contínua com variação: a mesma protagonista, o mesmo cenário, a mesma luz e a mesma paleta do começo ao fim (o fio_visual), como fotos de um mesmo ensaio. Em cada lâmina varie só a pose, o gesto, o plano e o enquadramento (de costas, de frente, pensativa, sorrindo, detalhe das mãos); nunca a mesma pose em duas lâminas seguidas e nunca trocar de pessoa, de cenário ou de clima no meio.
- A capa (de carrossel ou de post estático) existe para PARAR A ROLAGEM: gancho de até 7 palavras que gera curiosidade ou identificação, a maior headline do conjunto em peso black com a palavra-chave na cor de destaque, e um elemento visual forte e inesperado (escala, recorte ousado, rosto ou olhar, gesto em ação), sempre na mesma luz, cenário e paleta da série. Nunca escureça a imagem para criar destaque, e nunca ponha fundo da mesma cor da logo. Zona da capa pela foto: esquerda quando o sujeito está à direita; topo-centro ou centro quando o sujeito está no centro ou embaixo.
- Nunca escreva o nome da marca no texto das lâminas; a marca aparece pela logo.
- Se \`pedido_da_equipe\` vier preenchido, refaça a direção atendendo o pedido e mantenha o que ele não manda mudar da \`direcao_atual\`.
- Se \`item.campanha\` vier, o conteúdo é de uma campanha: siga o tema visual, as cores de apoio, os elementos e o tom da campanha, sempre dentro da marca; o fio_visual inclui o tema da campanha.

Seja específico e curto: cada campo em uma ou duas frases.`;

type ModoDirecao = "diretor" | "roteiro";

function cardsDoDiretor(
  bruto: unknown,
  postUnico: boolean,
  marca: MarcaParaDirecao,
  conceito: string,
  infinito: boolean,
  levaLogoFn: (ordem: number, total: number) => boolean,
  acervoValido: Set<string> = new Set(),
  fioVisual: string | null = null,
): CardDirecao[] {
  const lista = (Array.isArray(bruto) ? bruto : []) as Record<string, any>[];
  const base = lista
    .filter((c) => c && Array.isArray(c.blocos) && c.blocos.some((b: any) => texto(b?.texto)))
    .sort((a, b) => num(a.ordem) - num(b.ordem))
    .slice(0, postUnico ? 1 : MAX_CARDS);
  const total = base.length;
  const fotosUsadas = new Set<string>();
  const cards = base.map((c, i) => {
    const ordem = i + 1;
    const funcao = ordem === 1 ? "capa" : ordem === total && total > 1 ? "cta" : (c.funcao === "cta" ? "cta" : "conteudo");
    const blocos = (c.blocos as any[])
      .map((b) => ({ papel: b?.papel, texto: texto(b?.texto, 600) }))
      .filter((b) => b.texto) as BlocoTexto[];
    const layout = normalizarLayout(c.layout, funcao, ordem, total);
    const card: CardDirecao = {
      ordem,
      funcao,
      texto_exato: blocos.map((b) => b.texto).join("\n"),
      blocos,
      layout,
      evitar: texto(c.evitar, 600),
      composicao: resumoDaComposicao(layout),
      ilustracao: layout.imagem,
      prompt_imagem: "",
    };
    // Foto real do acervo: só id conhecido e nunca a mesma foto em duas lâminas.
    const foto = texto(c.imagem_acervo, 64);
    if (foto && acervoValido.has(foto) && !fotosUsadas.has(foto)) {
      fotosUsadas.add(foto);
      card.imagens_ids = [foto];
    }
    return card;
  });
  for (const card of cards) {
    card.prompt_imagem = promptDaLamina(card, marca, {
      total,
      carrosselInfinito: infinito && total > 1,
      levaLogo: levaLogoFn(card.ordem, total),
      conceito,
      anteriores: imagensAnteriores(cards, card.ordem),
      fioVisual,
    });
  }
  return cards;
}

/** O que as lâminas anteriores já mostram, para a lâmina atual não repetir. */
function imagensAnteriores(cards: CardDirecao[], ordem: number): string[] {
  return cards
    .filter((c) => c.ordem < ordem)
    .map((c) => texto(c.layout?.imagem || c.ilustracao, 160))
    .filter(Boolean)
    .slice(-4);
}

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

  const db = servico();
  // Conversa com o diretor: com instrução e trabalho, a direção do mesmo
  // trabalho é refeita a partir do pedido (as versões geradas ficam).
  const instrucao = texto(corpo.instrucao, 2000);
  let existente: Trabalho | null = null;
  if (corpo.trabalho_id) {
    existente = await lerTrabalho(texto(corpo.trabalho_id, 64));
    if (existente.client_id !== clientId || existente.task_id !== item.tarefa.id) {
      throw new ErroEstudio(409, "trabalho_de_outro_item", "Este trabalho não é deste item da agenda.");
    }
    if (existente.status === "entregue") {
      throw new ErroEstudio(409, "trabalho_entregue", "Este trabalho já foi entregue. Prepare um novo para refazer as artes.");
    }
  }

  // O que o cliente já tem entra sozinho (pastas de referência, artes aprovadas
  // e fotos reais para o acervo), em paralelo com a leitura do kit.
  const [, , kit, fontes] = await Promise.all([
    sincronizarReferencias(db, clientId).catch(() => null),
    sincronizarAcervo(db, clientId).catch(() => null),
    lerKit(clientId),
    lerFontes(clientId),
  ]);
  const marca = await marcaDoCliente(clientId, kit, fontes);

  const postUnico = FORMATOS_POST_UNICO.has(item.tarefa.delivery_type);
  // Contínuo decidido no começo: o pedido da tela vale; senão o que o trabalho já tinha; senão o do estrategista.
  const pedidoInfinito = typeof corpo.carrossel_infinito === "boolean"
    ? corpo.carrossel_infinito
    : existente?.direcao.carrossel_infinito === true
      ? true
      : item.itemProposta && typeof item.itemProposta.carrossel_infinito === "boolean"
        ? item.itemProposta.carrossel_infinito as boolean
        : null;
  const levaLogoFn = (ordem: number, total: number) => ordem === 1 || ordem === total;
  const campanha = await lerCampanha(clientId, item.itemProposta?.campanha_id);
  const laminasPedidas = Number.isInteger(Number(corpo.laminas)) && Number(corpo.laminas) >= 1 && Number(corpo.laminas) <= 10
    ? Number(corpo.laminas)
    : null;
  // Modo roteiro: o roteiro do calendário vira direção sem IA (custo zero).
  const roteiro = Array.isArray(item.itemProposta?.cards) ? item.itemProposta!.cards as Record<string, unknown>[] : [];
  const modoPedido: ModoDirecao = corpo.modo === "roteiro" && !instrucao ? "roteiro" : "diretor";
  const trabalhoId = existente?.id ?? crypto.randomUUID();
  let direcao: Direcao;
  let custo = 0;
  let usoId: string | null = null;
  let saldo: number | null = null;
  let reserva: string | null = null;

  if (modoPedido === "roteiro" && roteiro.length) {
    direcao = direcaoDoRoteiro(roteiro as any, marca, {
      postUnico,
      carrosselInfinito: pedidoInfinito ?? false,
      conceito: texto(item.itemProposta?.resumo ?? item.itemProposta?.tema, 600) || null,
      levaLogo: levaLogoFn,
    });
  } else {
    const modeloDiretor = await modeloDoPapel("diretor_arte");
    const [prompt, memoria, acervo, refsRes, artesRes] = await Promise.all([
      promptDoDiretor(clientId),
      memoriaDoDiretor(clientId),
      lerAcervo(clientId, 40),
      db.from("cliente_referencias")
        .select("id, origem, papel, leitura, tags")
        .eq("client_id", clientId)
        .eq("ativa", true)
        .not("leitura", "is", null)
        .order("criado_em", { ascending: false })
        .limit(12),
      db.from("files")
        .select("file_name, file_type, description, caption, created_at")
        .eq("client_id", clientId)
        .eq("folder", "materiais")
        .is("parent_file_id", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    const contexto = {
      item: {
        titulo: item.tarefa.title,
        formato: item.tarefa.delivery_type,
        post_unico: postUnico,
        data: item.tarefa.due_date,
        roteiro_e_contexto: texto(item.tarefa.description, 4000),
        objetivo_do_post: item.post?.objective ?? null,
        legenda_prevista: texto(item.post?.default_caption, 1500) || null,
        detalhe_do_estrategista: item.itemProposta ?? null,
        carrossel_infinito_pedido: pedidoInfinito,
        // Escolhida na tela antes da direção; nula = o diretor decide pelo conteúdo.
        quantidade_de_laminas_pedida: laminasPedidas,
        campanha: campanha ? { nome: campanha.nome, conceito: campanha.conceito, identidade: campanha.identidade } : null,
      },
      marca: {
        nome: marca.nomeCliente,
        paleta: marca.paleta,
        estilo: marca.estilo,
        regras: marca.regras,
        fontes: marca.fontes,
        tipografia_citada: marca.tipografiaCitada,
        tom_de_voz: marca.tomDeVoz,
        tem_logo_oficial: marca.temLogo,
      },
      referencias: ((refsRes.data as { papel: string; leitura: string; tags: string[] }[] | null) ?? [])
        .map((r) => ({ papel: r.papel === "identidade" ? "arte publicada da marca" : "técnica", tecnica: texto(r.leitura, 600), tags: r.tags })),
      artes_anteriores: ((artesRes.data as Record<string, unknown>[] | null) ?? []).map((a) => ({
        nome: texto(a.file_name, 120),
        descricao: texto(a.description, 200) || null,
      })),
      memoria_do_diretor: memoria,
      // Fotos reais do cliente: o diretor escolhe por id (imagem_acervo) e a foto entra como está.
      acervo: acervo.map((a) => ({ id: a.id, nome: texto(a.nome, 80), pasta: a.pasta, categoria: a.categoria, descricao: texto(a.descricao, 240) || null })),
      pedido_da_equipe: instrucao || null,
      direcao_atual: existente
        ? {
          conceito: existente.direcao.conceito,
          cards: existente.direcao.cards.map((c) => ({ ordem: c.ordem, funcao: c.funcao, texto_exato: c.texto_exato, imagem: c.layout?.imagem ?? c.ilustracao })),
        }
        : null,
    };
    const r = await chamarTexto({
      clientId,
      tarefa: "estudio",
      agente: "diretor_arte",
      modeloId: modeloDiretor.id,
      raciocinio: raciocinioPara(modeloDiretor, ["low", "medium"]),
      // Base de conhecimento primeiro: prefixo fixo, reaproveitado pelo cache do provedor.
      sistema: `${CONHECIMENTO_DIRETOR}\n\n${prompt}\n\n${INSTRUCOES_DIRECAO}`,
      mensagens: [{ papel: "usuario", conteudo: `Escreva a direção de arte deste item. Contexto em JSON:\n${JSON.stringify(contexto)}` }],
      esquemaJson: ESQUEMA_DIRECAO,
      maxTokensSaida: 12_000,
      referencia: { tipo: "estudio_trabalho", id: trabalhoId },
      criadoPor: ch.userId,
    });
    const bruto = (r.json ?? {}) as Record<string, any>;
    const conceito = texto(bruto.conceito, 1200);
    const fioVisual = texto(bruto.fio_visual, 800) || null;
    const infinito = pedidoInfinito ?? !!bruto.carrossel_infinito;
    const cards = cardsDoDiretor(bruto.cards, postUnico, marca, conceito, infinito, levaLogoFn, new Set(acervo.map((a) => a.id)), fioVisual);
    if (!cards.length) {
      throw new ErroEstudio(502, "direcao_vazia", "O diretor de arte não devolveu nenhum card utilizável. Tente de novo.", { uso_id: r.usoId });
    }
    direcao = { conceito, fio_visual: fioVisual, carrossel_infinito: cards.length > 1 && infinito, cards, origem: "diretor" };
    custo = r.custoUsd;
    usoId = r.usoId;
    saldo = r.saldoUsd;
    reserva = r.reservaUsada ?? null;
  }

  if (campanha) {
    direcao.campanha_id = campanha.id;
    if (!direcao.referencias_ids?.length && campanha.referencias_ids?.length) direcao.referencias_ids = campanha.referencias_ids.slice(0, 4);
  }

  if (existente) {
    // Mantém o que a equipe escolheu na tela (referências do conjunto e de cada
    // lâmina, fotos do acervo) quando a direção nova não troca.
    const anterior = existente.direcao;
    const cardsMesclados = direcao.cards.map((c) => {
      const velho = anterior.cards.find((v) => v.ordem === c.ordem);
      return {
        ...c,
        imagens_ids: c.imagens_ids?.length ? c.imagens_ids : velho?.imagens_ids,
        referencias_ids: velho?.referencias_ids,
      };
    });
    const atualizado = await mutarTrabalho(existente.id, (x) => ({
      direcao: {
        ...direcao,
        cards: cardsMesclados,
        referencias_ids: anterior.referencias_ids,
        pedido: instrucao || null,
      },
      custo_usd: arred(num(x.custo_usd) + custo),
    }));
    return json({ trabalho: atualizado, custo_usd: custo, saldo_usd: saldo, reserva_usada: reserva, modo: direcao.origem ?? modoPedido });
  }

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
      custo_usd: arred(custo),
      criado_por: ch.userId,
    })
    .select("*")
    .single();
  if (error) throw new ErroEstudio(503, "gravacao_falhou", "A direção foi escrita, mas o trabalho não foi gravado.", { uso_id: usoId });

  return json({ trabalho: criado, custo_usd: custo, saldo_usd: saldo, reserva_usada: reserva, modo: direcao.origem ?? modoPedido });
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
type LinhaGlobal = { id: string; storage_path: string; url_origem: string | null; leitura: string; tags: string[] };
const CAMPOS_REF_CLIENTE = "id, client_id, origem, papel, workspace_node_id, url_origem, storage_path, file_id, leitura, tags";
const CAMPOS_REF_GLOBAL = "id, origem, storage_path, url_origem, leitura, tags";

const globalComoReferencia = (g: LinhaGlobal, clientId: string): Referencia => ({
  id: `g:${g.id}`,
  client_id: clientId,
  origem: "global",
  papel: "global",
  workspace_node_id: null,
  url_origem: g.url_origem,
  storage_path: g.storage_path,
  file_id: null,
  leitura: g.leitura,
  tags: g.tags,
});

/** Referências escolhidas na tela: ids do cliente e do banco global (prefixo g:). */
async function referenciasPorId(clientId: string, ids: string[]): Promise<Referencia[]> {
  const doCliente = ids.filter((i) => UUID.test(i));
  const globais = ids.filter((i) => i.startsWith("g:")).map((i) => i.slice(2)).filter((i) => UUID.test(i));
  const [c, g] = await Promise.all([
    doCliente.length
      ? servico().from("cliente_referencias").select(CAMPOS_REF_CLIENTE).eq("client_id", clientId).in("id", doCliente)
      : Promise.resolve({ data: [] }),
    globais.length ? servico().from("referencias_globais").select(CAMPOS_REF_GLOBAL).in("id", globais) : Promise.resolve({ data: [] }),
  ]);
  const todas = [
    ...((c.data as Referencia[] | null) ?? []),
    ...((g.data as LinhaGlobal[] | null) ?? []).map((x) => globalComoReferencia(x, clientId)),
  ];
  // Na ordem em que a equipe escolheu.
  return ids.map((i) => todas.find((r) => r.id === i || r.id === `g:${i}`)).filter(Boolean) as Referencia[];
}

const PALAVRAS_VAZIAS = new Set(["para", "como", "sobre", "entre", "mesma", "mesmo", "cada", "texto", "lamina", "lâmina", "imagem", "fundo", "com", "sem", "uma", "que", "dos", "das", "nos", "nas", "pela", "pelo"]);

/**
 * Pré-filtro do banco global (mais de 1.300 leituras) pela busca de texto do
 * Postgres: palavras da composição da lâmina, ligadas por "or". Sem acerto,
 * as mais recentes.
 */
async function globaisParaALamina(card: CardDirecao, limite = 20): Promise<LinhaGlobal[]> {
  const fonte = [card.layout?.tratamento, card.layout?.fundo, card.composicao, card.funcao === "capa" ? "capa tipografia-grande contraste" : ""].join(" ");
  const termos = [...new Set(
    fonte.toLowerCase().normalize("NFC").split(/[^a-zà-ÿ0-9-]+/).filter((p) => p.length >= 5 && !PALAVRAS_VAZIAS.has(p)),
  )].slice(0, 12);
  const base = () =>
    servico().from("referencias_globais").select(CAMPOS_REF_GLOBAL).eq("ativa", true).not("leitura", "is", null).not("storage_path", "is", null);
  if (termos.length) {
    const { data } = await base().textSearch("leitura", termos.join(" or "), { type: "websearch", config: "portuguese" }).limit(limite);
    const achadas = (data as LinhaGlobal[] | null) ?? [];
    if (achadas.length >= 4) return achadas;
  }
  const { data } = await base().order("criado_em", { ascending: false }).limit(limite);
  return (data as LinhaGlobal[] | null) ?? [];
}

async function escolherReferencias(
  t: Trabalho,
  card: CardDirecao,
  kit: Kit,
  criadoPor: string,
): Promise<{ refs: Referencia[]; jev: string }> {
  // Escolha da equipe na tela (da lâmina ou do conjunto) vale sem passar pelo Jev.
  const escolhidasNaTela = (card.referencias_ids?.length ? card.referencias_ids : t.direcao.referencias_ids) ?? [];
  if (escolhidasNaTela.length) {
    const refs = await referenciasPorId(t.client_id, escolhidasNaTela);
    if (refs.length) return { refs: refs.slice(0, MAX_REFERENCIAS), jev: "escolha_da_equipe" };
  }
  const [doCliente, globais] = await Promise.all([
    servico()
      .from("cliente_referencias")
      .select(CAMPOS_REF_CLIENTE)
      .eq("client_id", t.client_id)
      .eq("ativa", true)
      .not("leitura", "is", null)
      .order("criado_em", { ascending: false })
      .limit(MAX_CANDIDATAS_JEV),
    globaisParaALamina(card),
  ]);
  const candidatas: Referencia[] = [
    ...((doCliente.data as Referencia[] | null) ?? []),
    ...globais.map((g) => globalComoReferencia(g, t.client_id)),
  ];
  if (!candidatas.length) {
    const identidade = await artePublicadaMaisRecente(t.client_id);
    return { refs: identidade ? [identidade] : [], jev: "sem_referencias_lidas" };
  }

  const referencias: Record<string, { tipo: string; tecnica: string; tags: string[] }> = {};
  const questions: Record<string, PerguntaJev> = {};
  candidatas.forEach((r, i) => {
    referencias[`r${i}`] = {
      tipo: r.papel === "identidade" ? "arte já publicada pela própria marca" : "referência de técnica",
      tecnica: texto(r.leitura, 700),
      tags: r.tags ?? [],
    };
    questions[`r${i}`] = {
      type: "score",
      instructions: r.papel === "identidade"
        ? `Quão bem a arte descrita em \`referencias.r${i}\` mostra a identidade visual que a lâmina em \`lamina\` precisa seguir (paleta, tipografia, tratamento de foto e clima da marca em \`marca\`)?`
        : `Quão útil é a técnica descrita em \`referencias.r${i}.tecnica\` como referência de composição para executar a lâmina descrita em \`lamina\`? Julgue composição, hierarquia, tipografia e integração entre imagem e texto, não o assunto da foto.`,
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
      .sort((a, b) => (b.nota as number) - (a.nota as number));
    // Uma da identidade da marca e uma de técnica (do cliente ou do banco da agência).
    const identidade = notas.find((x) => x.r.papel === "identidade")?.r ?? await artePublicadaMaisRecente(t.client_id);
    const tecnica = notas.find((x) => x.r.papel !== "identidade")?.r;
    const escolhidas = [identidade, tecnica].filter(Boolean).slice(0, MAX_REFERENCIAS) as Referencia[];
    return { refs: escolhidas, jev: "ok" };
  } catch (e) {
    // Sem Jev, ao menos a arte publicada mais recente da marca vai junto.
    const identidade = await artePublicadaMaisRecente(t.client_id);
    return { refs: identidade ? [identidade] : [], jev: codigoMotor(e) };
  }
}

/**
 * Arte já publicada mais recente da marca (referência de identidade), mesmo
 * ainda sem leitura: a série nova precisa continuar o estilo do que foi ao ar.
 */
async function artePublicadaMaisRecente(clientId: string): Promise<Referencia | null> {
  const { data } = await servico()
    .from("cliente_referencias")
    .select(CAMPOS_REF_CLIENTE)
    .eq("client_id", clientId)
    .eq("ativa", true)
    .eq("papel", "identidade")
    .order("criado_em", { ascending: false })
    .limit(1);
  return ((data as Referencia[] | null) ?? [])[0] ?? null;
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
  // Direção com layout é composta para 4:5; a antiga, sem layout, segue o recorte de 2:3.
  const formatoAntigo = !card.layout;
  return [
    "REGRAS FIXAS DE RENDER",
    `- ${REGRA_TEXTO_NA_ARTE}`,
    `- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "${card.texto_exato}"`,
    formatoAntigo ? "- Tela 1024 x 1536. A peça final é vertical 4:5 (1080 x 1350), cortada pelo centro." : "",
    formatoAntigo
      ? "- ÁREA ÚTIL: todo o texto, a logo e os elementos importantes ficam DENTRO da área central de 1024 x 1280 (de y = 128 a y = 1408), com margem de respiro de pelo menos 48 px até o limite dela. Nenhuma letra pode encostar ou entrar nas faixas de 128 px do topo e da base."
      : "",
    formatoAntigo ? "- As faixas de 128 px no topo e na base recebem só continuação do fundo: serão cortadas." : "",
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

/** Área do texto e da logo da lâmina, em fração do quadro (máscara da foto real). */
function areasDeDesenho(card: CardDirecao, total: number, comLogo: boolean): Area[] {
  const capa = card.funcao === "capa" || card.ordem === 1;
  const zona = card.layout?.zona_texto ?? "base-esquerda";
  const pct = (c: { x0: number; x1: number; y0: number; y1: number }): Area => ({ x0: c.x0 / 100, y0: c.y0 / 100, x1: c.x1 / 100, y1: c.y1 / 100 });
  const areas = [ampliar(pct(caixaDaZona(zona, capa, total > 1)), 0.04)];
  if (comLogo) areas.push(ampliar(pct(caixaDaLogo(zona, capa)), 0.02));
  return areas;
}

const descreverArea = (a: Area) =>
  `de ${Math.round(a.x0 * 100)}% a ${Math.round(a.x1 * 100)}% da largura e de ${Math.round(a.y0 * 100)}% a ${Math.round(a.y1 * 100)}% da altura`;

/**
 * gerar_card { trabalho_id, ordem }: uma lâmina por chamada, em um de três modos:
 * - foto real: a lâmina tem imagens_ids; a foto do acervo é a base, o gerador
 *   só desenha a área do texto e da logo, e o código devolve a foto original
 *   em todo o resto (a foto não é refeita);
 * - carrossel contínuo: a lâmina N nasce da borda direita da N-1 numa tela
 *   dupla (metade esquerda pronta, metade direita pintada) e sai o recorte da
 *   metade direita; sem tela dupla no provedor, cai no modo normal;
 * - normal: prompt composto com a lâmina anterior como referência.
 */
async function gerarCard(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  garantirEditavel(t);
  const card = cardDaDirecao(t, ordem);
  const total = totalCards(t);
  const [kit, fontes, modeloImagem] = await Promise.all([
    lerKit(t.client_id),
    lerFontes(t.client_id),
    carregarModelo(t.modelo_imagem_id!, "imagem"),
  ]);
  const qualidade = (QUALIDADES.includes(t.qualidade as Qualidade) ? t.qualidade : QUALIDADE_PADRAO) as Qualidade;

  // Foto real escolhida para a lâmina (pelo diretor ou pela equipe).
  const [foto] = card.imagens_ids?.length ? await imagensDoAcervo(t.client_id, card.imagens_ids) : [];
  const baseFoto = foto ? await fotoRealNaLamina(foto) : null;

  // Continuidade real: só no carrossel contínuo, com a anterior pronta, sem foto real e no editor da OpenAI (máscara).
  const anterior = ordem > 1 ? versaoAtual(t, ordem - 1) : null;
  const continuar = !baseFoto && t.direcao.carrossel_infinito && !!anterior && modeloImagem.provedor === "openai" && !!card.layout;

  const anexos: ImagemEntrada[] = [];
  // Rótulo de cada anexo; a numeração sai na hora do prompt, porque a imagem
  // editada (foto ou tela dupla), quando há, é a imagem 1 e empurra as outras.
  const rotulos: string[] = [];
  const legendar = (txt: string) => rotulos.push(txt);
  const legendas = (deslocamento: number) => rotulos.map((r, i) => `imagem ${i + 1 + deslocamento}: ${r}`);

  // Logo só quando o arquivo existe de fato: pedir "a logo anexada" sem anexo faz o gerador inventar uma.
  let comLogo = false;
  let tomDaLogo: { tom: string | null; clara: boolean } | null = null;
  if (levaLogo(t, ordem)) {
    const logo = await baixarLogo(t.client_id, kit);
    if (logo) {
      anexos.push(logo);
      legendar("logo oficial da marca");
      comLogo = true;
      // Medida em código: o prompt põe atrás da logo um fundo de valor oposto.
      tomDaLogo = await analisarLogo(logo.bytes).catch(() => null);
    }
  }
  for (const a of await amostrasDasFontes(fontes)) {
    anexos.push(a.imagem);
    legendar(`amostra da fonte ${a.fonte.nome} (${a.fonte.papel}), siga o desenho destas letras`);
  }
  // Conteúdo de campanha: selo do tema na capa e no fechamento, e a identidade da campanha no prompt.
  const campanha = t.direcao.campanha_id ? await lerCampanha(t.client_id, t.direcao.campanha_id) : null;
  if (campanha?.selo_path && levaLogo(t, ordem)) {
    try {
      anexos.push(await baixarImagem("mesa", campanha.selo_path, "selo-da-campanha"));
      legendar(`selo da campanha "${campanha.nome}": use como está, pequeno, perto do título ou no canto oposto à logo, sem redesenhar`);
    } catch {
      // Selo sumido não impede a lâmina.
    }
  }
  // Sem tela dupla, a anterior vai como referência; no contínuo o final também vê a capa.
  if (anterior && !continuar) {
    anexos.push({ bytes: await baixar("mesa", anterior.storage_path), mime: "image/png", nome: `card-${ordem - 1}.png` });
    legendar(`card ${ordem - 1} já aprovado desta mesma série: mantenha a mesma protagonista, cenário, luz, paleta, tipografia e posição da marca; mude só a pose, o enquadramento e o texto`);
  }
  if (t.direcao.carrossel_infinito && ordem === total && ordem > 2) {
    const capa = versaoAtual(t, 1);
    if (capa) {
      anexos.push({ bytes: await baixar("mesa", capa.storage_path), mime: "image/png", nome: "card-1.png" });
      legendar("capa, o final se conecta visualmente com ela");
    }
  }
  // Foto real dispensa referência de técnica: a imagem já está decidida.
  const escolhida = baseFoto ? { refs: [] as Referencia[], jev: "foto_real" } : await escolherReferencias(t, card, kit, ch.userId);
  const daEquipe = escolhida.jev === "escolha_da_equipe";
  // Do miolo em diante, a lâmina anterior da série é o guia de estilo: só a
  // identidade da marca continua junto (técnica solta puxava cada lâmina para um lado).
  const escolha = !daEquipe && anterior
    ? { ...escolhida, refs: escolhida.refs.filter((r) => r.papel === "identidade") }
    : escolhida;
  const idsReferencias: string[] = [];
  for (const ref of escolha.refs) {
    try {
      anexos.push(await imagemDaReferencia(ref));
      idsReferencias.push(ref.id);
      legendar(daEquipe
        ? "referência escolhida pela equipe: siga de perto a composição, a tipografia, a hierarquia e o tratamento desta peça, com o texto e a marca deste post"
        : ref.papel === "identidade"
          ? "arte já publicada da própria marca: siga a mesma identidade (cores, tipografia, tratamento de foto, estilo das pessoas); não copie o layout"
          : "referência de técnica (absorva composição e hierarquia, não copie a peça)");
    } catch {
      // Referencia sem arquivo fica de fora desta lamina.
    }
  }

  // Direção com layout: o prompt é recomposto agora, com o kit atual da marca.
  const marca = await marcaDoCliente(t.client_id, kit, fontes);
  marca.temLogo = comLogo;
  const base = card.layout
    ? promptDaLamina(card, marca, {
      total,
      carrosselInfinito: t.direcao.carrossel_infinito,
      levaLogo: levaLogo(t, ordem),
      conceito: t.direcao.conceito,
      anteriores: imagensAnteriores(t.direcao.cards, ordem),
      fotoReal: foto ? resumoDaFoto(foto) : null,
      fioVisual: t.direcao.fio_visual ?? null,
      logo: tomDaLogo,
    })
    : card.prompt_imagem;
  const baseComCampanha = campanha ? `${base}\n\n${blocoDaCampanha(campanha)}` : base;
  const comum = {
    clientId: t.client_id,
    modeloId: t.modelo_imagem_id!,
    referencias: anexos,
    qualidade,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor: ch.userId,
    tarefa: "estudio" as const,
    agente: "gerador_imagem" as const,
  };

  // 1) Foto real como base.
  if (baseFoto) {
    const areas = areasDeDesenho(card, total, comLogo);
    const prompt = [
      `EDITE a imagem 1 (foto real do cliente). Desenhe SÓ dentro destas áreas: ${areas.map(descreverArea).join("; ")}. Fora delas a foto fica exatamente como está.`,
      baseComCampanha,
      regrasDeRender(t, card, legendas(1), comLogo),
    ].join("\n\n");
    const img = await chamarImagem({
      ...comum,
      prompt,
      editar: { bytes: baseFoto, mascara: await mascara(1088, 1360, areas) },
      tamanho: TAMANHO_GERADOR,
    });
    // O gerador redesenha tudo mesmo com máscara: a foto original volta fora das áreas.
    const final = img.tamanho === TAMANHO_GERADOR ? await devolverOriginalForaDasAreas(baseFoto, img.png, areas) : img.png;
    return await gravarVersao(ch, t, card, { ...img, png: final, mime: "image/png" }, {
      origem: "gerar",
      referencias: idsReferencias,
      extra: { referencias_jev: escolha.jev, tamanho: img.tamanho, modo: "foto_real", imagem_id: foto!.id },
    });
  }

  // 2) Carrossel contínuo: tela dupla com a lâmina anterior à esquerda.
  if (continuar) {
    try {
      const dupla = await telaDupla(await baixar("mesa", anterior!.storage_path));
      const prompt = [
        `TELA DUPLA ${TAMANHO_TELA_DUPLA.replace("x", " x ")}: a metade esquerda (imagem 1) é a lâmina ${ordem - 1}, já pronta, e não pode mudar. Pinte SÓ a metade direita como a lâmina ${ordem} de ${total}, continuação direta da mesma cena: o fundo, o horizonte, a luz, a escala e os elementos que chegam à borda direita da esquerda continuam na mesma altura, sem emenda visível. O quadro 1080 x 1350 descrito abaixo é a metade direita. Nenhum texto cruza a divisa e todo texto fica a pelo menos 90 px dela. O fundo da metade direita é a continuação da cena da esquerda: ignore qualquer cor de fundo sugerida abaixo que quebre essa continuidade.`,
        baseComCampanha,
        regrasDeRender(t, card, legendas(1), comLogo),
      ].join("\n\n");
      const img = await chamarImagem({
        ...comum,
        prompt,
        editar: { bytes: dupla.tela, mascara: dupla.mascara },
        tamanho: TAMANHO_TELA_DUPLA,
        tamanhoFixo: true,
      });
      const direita = await metadeDireita(img.png);
      return await gravarVersao(ch, t, card, { ...img, png: direita, mime: "image/png" }, {
        origem: "gerar",
        referencias: idsReferencias,
        extra: { referencias_jev: escolha.jev, tamanho: TAMANHO_GERADOR, modo: "continuo", continua_de: anterior!.versao },
      });
    } catch (e) {
      // Provedor sem tela dupla: segue no modo normal, com a anterior como referência.
      if (!recusouTamanho(e)) throw e;
      anexos.push({ bytes: await baixar("mesa", anterior!.storage_path), mime: "image/png", nome: `card-${ordem - 1}.png` });
      legendar(`card ${ordem - 1} já aprovado, esta lâmina continua a cena dele pela borda direita`);
    }
  }

  // 3) Normal.
  const prompt = `${baseComCampanha}\n\n${regrasDeRender(t, card, legendas(0), comLogo)}`;
  const img = await chamarImagem({
    ...comum,
    prompt,
    promptSe2x3: card.layout ? formatoPara2x3(prompt) : undefined,
    tamanho: card.layout ? TAMANHO_GERADOR : TAMANHO_2X3,
  });

  return await gravarVersao(ch, t, card, img, {
    origem: "gerar",
    referencias: idsReferencias,
    extra: { referencias_jev: escolha.jev, tamanho: img.tamanho, modo: "normal" },
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
- Se vier \`areas\` (frações da lâmina, de 0 a 1), o ajuste acontece SÓ dentro delas: descreva a mudança para aquele ponto e diga que o resto fica idêntico.
- Se \`tipo\` for "fundo", troque SÓ o fundo: texto, logo, pessoas e objetos em primeiro plano ficam idênticos, na mesma posição. Com \`nova_foto_de_fundo\`, o fundo novo é essa foto real do cliente (anexada depois da lâmina).
Escreva sem travessão.`;

async function ajustarCard(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  const ordem = lerOrdem(corpo);
  const tipo: "livre" | "fundo" = corpo.tipo === "fundo" ? "fundo" : "livre";
  // Ajuste pontual: só as áreas marcadas na tela mudam (máscara + devolução dos pixels originais).
  const areas = tipo === "fundo" ? [] : normalizarAreas(corpo.areas);
  const pedido = texto(corpo.instrucao, 2000) || (tipo === "fundo" ? "Troque só o fundo, mantendo texto, logo e primeiro plano." : "");
  if (!pedido) throw new ErroEstudio(400, "instrucao_vazia", "Descreva o ajuste que você quer.");
  garantirEditavel(t);
  const card = cardDaDirecao(t, ordem);
  const atualVersao = versaoAtual(t, ordem);
  if (!atualVersao) throw new ErroEstudio(409, "card_sem_versao", "Gere este card antes de pedir ajuste.");
  const [atual, fotoFundo] = await Promise.all([
    baixar("mesa", atualVersao.storage_path),
    corpo.imagem_id ? imagensDoAcervo(t.client_id, [texto(corpo.imagem_id, 64)]).then((l) => l[0] ?? null) : Promise.resolve(null),
  ]);
  if (corpo.imagem_id && !fotoFundo) throw new ErroEstudio(404, "imagem_inexistente", "Esta foto não está no acervo do cliente.");

  // O ajuste é uma tradução do pedido em instrução de edição: o modelo de
  // leitura (com visão) resolve bem e custa uma fração do diretor.
  const [kit, leitor] = await Promise.all([
    lerKit(t.client_id),
    modeloDoPapel("leitura"),
  ]);
  const dir = await chamarTexto({
    clientId: t.client_id,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: leitor.id,
    raciocinio: raciocinioPara(leitor, ["low", "medium"]),
    sistema: `${INSTRUCOES_AJUSTE}\n\n${PADRAO_NA_IMAGEM}`,
    mensagens: [{
      papel: "usuario",
      conteudo: JSON.stringify({
        pedido,
        tipo,
        areas: areas.length ? areas : null,
        nova_foto_de_fundo: fotoFundo ? resumoDaFoto(fotoFundo) : null,
        lamina: { ordem, funcao: card.funcao, texto_exato: card.texto_exato, composicao: card.composicao, leva_logo: levaLogo(t, ordem) },
        verificacao_atual: atualVersao.verificacao,
        marca: { paleta: kit?.paleta ?? [], estilo: kit?.estilo ?? null, regras: kit?.regras ?? null },
      }),
      imagens: [{ bytes: atual, mime: "image/png", nome: `card-${ordem}-v${atualVersao.versao}.png` }],
    }],
    esquemaJson: ESQUEMA_AJUSTE,
    maxTokensSaida: 3_000,
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
      legendas.push(`imagem ${referencias.length + 1}: logo oficial da marca`);
    }
  }
  if (fotoFundo) {
    referencias.push({ bytes: await fotoRealNaLamina(fotoFundo), mime: "image/png", nome: "novo-fundo.png" });
    legendas.push(`imagem ${referencias.length + 1}: foto real do cliente que vira o novo fundo (use como está, sem redesenhar)`);
  }
  // A edição mantém o formato da versão editada.
  const tamanhoAtual = String((atualVersao as { tamanho?: string }).tamanho || (card.layout ? TAMANHO_GERADOR : TAMANHO_2X3));
  const dims = dimensoesPng(atual);
  const abertas = areas.map((a) => ampliar(a, 0.02));
  const comMascara = abertas.length > 0 && !!dims;
  const abertura = comMascara
    ? `Mude SÓ dentro destas áreas: ${abertas.map(descreverArea).join("; ")}. Fora delas, nenhum pixel muda.`
    : tipo === "fundo"
      ? "Troque SÓ o fundo. Texto, logo, pessoas e objetos em primeiro plano ficam idênticos, na mesma posição, tamanho e cor."
      : "Mantenha exatamente igual tudo o que a instrução não manda mudar: composição, fundo, cores, tipografia, texto e posição dos elementos.";
  const promptEdicao = [
    `EDITE a imagem 1. ${abertura}`,
    instrucaoEdicao,
    regrasDeRender(base, cardAjustado, legendas, levaLogo(base, ordem)),
  ].join("\n\n");
  const gerado = await chamarImagem({
    clientId: base.client_id,
    modeloId: base.modelo_imagem_id!,
    prompt: promptEdicao,
    referencias,
    editar: { bytes: atual, mascara: comMascara ? await mascara(dims!.largura, dims!.altura, abertas) : undefined },
    qualidade: (QUALIDADES.includes(base.qualidade as Qualidade) ? base.qualidade : QUALIDADE_PADRAO) as Qualidade,
    tamanho: tamanhoAtual,
    referencia: { tipo: "estudio_trabalho", id: base.id },
    criadoPor: ch.userId,
    tarefa: "estudio",
    agente: "gerador_imagem",
  });
  // Ajuste pontual de verdade: fora das áreas marcadas voltam os pixels da versão anterior.
  const img = comMascara && gerado.tamanho === tamanhoAtual
    ? { ...gerado, png: await devolverOriginalForaDasAreas(atual, gerado.png, abertas, 16), mime: "image/png" }
    : gerado;

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
    extra: {
      instrucao_edicao: instrucaoEdicao,
      versao_editada: atualVersao.versao,
      uso_diretor: dir.usoId,
      tamanho: img.tamanho,
      tipo_ajuste: comMascara ? "area" : tipo,
      areas: comMascara ? areas : undefined,
      imagem_id: fotoFundo?.id,
    },
  });
}

// ---------------------------------------------------------------- legenda

const ESQUEMA_LEGENDA = {
  nome: "legenda",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["legenda", "hashtags_candidatas"],
    properties: {
      legenda: { type: "string" },
      hashtags_candidatas: { type: "array", items: { type: "string" } },
    },
  },
};

const INSTRUCOES_LEGENDA = `LEGENDA FINAL DO POST

Escreva a legenda do Instagram deste post a partir do item da agenda, da direção de arte e do contexto da marca. A legenda completa a arte: conta o que a arte não cabe, com a voz da marca, sem repetir lâmina por lâmina.
- Primeira linha forte (gancho que funciona antes do "mais"), ligada à capa.
- Corpo em 2 a 4 parágrafos curtos: contexto, o porquê, um detalhe concreto do negócio (bairro, serviço, prova, bastidor) tirado do contexto; linguagem do público da marca, português do Brasil, emoji só se a marca usa.
- Termine com a chamada para ação do item (um verbo claro: salvar, comentar, chamar no WhatsApp, agendar).
- Não repita frases das legendas recentes em \`legendas_recentes\`.
- NÃO coloque hashtags na legenda. Em hashtags_candidatas, sugira de 10 a 14 hashtags em minúsculas, sem acento, com #: misture nicho, serviço, cidade ou bairro, e o tema do post; nada genérico demais (#love, #instagood) e nada que o público não busque.
- Se o item já traz uma legenda prevista, parta dela e melhore sem mudar o sentido.
- Sem travessão. Sem inventar preço, dado ou promessa que não estão no item ou no contexto.`;

const NIVEIS_HASHTAG = [
  "Não serve: genérica demais, fora do tema ou do público, ou de outro nicho.",
  "Serve pouco: ligada ao tema, mas ampla demais ou com público pouco provável de virar cliente.",
  "Serve: do nicho ou do serviço, com público que busca este assunto.",
  "Serve muito: específica do nicho, do serviço ou da região da marca e do tema deste post; atrai exatamente o público que vira cliente.",
];
const MAX_HASHTAGS = 5;

function limparHashtag(h: unknown): string | null {
  const s = semAcento(texto(h, 60)).replace(/^#+/, "").replace(/[^a-z0-9_]/g, "");
  return s.length >= 3 && s.length <= 40 ? `#${s}` : null;
}

/** De 4 a 5 hashtags: o Jev dá a nota de cada candidata e o código fica com as melhores. */
async function escolherHashtags(t: Trabalho, candidatas: string[], contexto: Record<string, unknown>, criadoPor: string): Promise<string[]> {
  if (candidatas.length <= MAX_HASHTAGS) return candidatas;
  try {
    const questions: Record<string, PerguntaJev> = {};
    candidatas.forEach((h, i) => {
      questions[`h${i}`] = {
        type: "score",
        instructions: `Quão boa é a hashtag \`hashtags.h${i}\` para este post chegar ao público que vira cliente da marca em \`marca\`, dado o tema em \`post\`?`,
        criteria: NIVEIS_HASHTAG,
      };
    });
    const res = await jevPerguntar({
      state: { ...contexto, hashtags: Object.fromEntries(candidatas.map((h, i) => [`h${i}`, h])) },
      questions,
    });
    await cobrarJev(res, { clientId: t.client_id, tarefa: "estudio", referencia: { tipo: "estudio_trabalho", id: t.id }, criadoPor });
    return candidatas
      .map((h, i) => ({ h, nota: notaScore(res.answers[`h${i}`]) ?? -1 }))
      .sort((a, b) => b.nota - a.nota)
      .slice(0, MAX_HASHTAGS)
      .map((x) => x.h);
  } catch {
    // Sem Jev, as primeiras sugeridas pelo diretor.
    return candidatas.slice(0, MAX_HASHTAGS);
  }
}

async function legenda(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  if (!t.task_id) throw new ErroEstudio(409, "trabalho_sem_item", "Este trabalho não está ligado a um item da agenda.");
  const item = await lerItemDaAgenda(t.task_id);
  const [prompt, diretor, contexto, recentes, perfil] = await Promise.all([
    promptDoDiretor(t.client_id),
    modeloDoPapel("diretor_arte"),
    lerContextoConsolidado(servico(), t.client_id),
    servico()
      .from("files")
      .select("caption")
      .eq("client_id", t.client_id)
      .eq("folder", "materiais")
      .is("parent_file_id", null)
      .not("caption", "is", null)
      .order("created_at", { ascending: false })
      .limit(5),
    servico().from("profiles").select("company_name, full_name").eq("id", t.client_id).maybeSingle(),
  ]);
  const p = perfil.data as { company_name: string | null; full_name: string | null } | null;
  const marca = {
    nome: texto(p?.company_name || p?.full_name, 120) || null,
    contexto: contexto ?? null,
  };
  const r = await chamarTexto({
    clientId: t.client_id,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: diretor.id,
    raciocinio: raciocinioPara(diretor, ["low", "medium"]),
    sistema: `${prompt}\n\n${INSTRUCOES_LEGENDA}`,
    mensagens: [{
      papel: "usuario",
      conteudo: JSON.stringify({
        item: {
          titulo: item.tarefa.title,
          formato: item.tarefa.delivery_type,
          roteiro_e_contexto: texto(item.tarefa.description, 4000),
          objetivo: item.post?.objective ?? null,
          legenda_prevista: texto(item.post?.default_caption, 2200) || null,
          detalhe_do_estrategista: item.itemProposta ?? null,
        },
        direcao: {
          conceito: t.direcao.conceito,
          cards: t.direcao.cards.map((c) => ({ ordem: c.ordem, funcao: c.funcao, texto_exato: c.texto_exato })),
        },
        marca,
        legendas_recentes: ((recentes.data as { caption: string }[] | null) ?? []).map((x) => texto(x.caption, 400)),
      }),
    }],
    esquemaJson: ESQUEMA_LEGENDA,
    maxTokensSaida: 8_000,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor: ch.userId,
  });
  const bruto = (r.json ?? {}) as { legenda?: string; hashtags_candidatas?: unknown[] };
  // Hashtag que escapou para dentro do texto sai dali: elas vivem em campo próprio.
  const final = texto(bruto.legenda, 2200).replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, "").trim();
  if (!final) throw new ErroEstudio(502, "legenda_vazia", "O diretor não devolveu a legenda. Tente de novo.");
  const candidatas = [...new Set((bruto.hashtags_candidatas ?? []).map(limparHashtag).filter(Boolean) as string[])].slice(0, 16);
  const hashtags = await escolherHashtags(
    t,
    candidatas,
    { marca: { nome: marca.nome, contexto: marca.contexto }, post: { titulo: item.tarefa.title, conceito: t.direcao.conceito, legenda: final.slice(0, 600) } },
    ch.userId,
  );
  const gravado = await mutarTrabalho(t.id, (x) => ({ legenda: final, hashtags, custo_usd: arred(num(x.custo_usd) + r.custoUsd) }));
  return json({
    trabalho_id: t.id,
    legenda: gravado.legenda,
    hashtags: (gravado as Trabalho & { hashtags?: string[] }).hashtags ?? hashtags,
    custo_usd: r.custoUsd,
    saldo_usd: r.saldoUsd,
    reserva_usada: r.reservaUsada ?? null,
  });
}

/** Legenda que vai ao ar: o texto e, numa linha própria no fim, as hashtags. */
function legendaComHashtags(legendaTexto: string | null, hashtags: string[] | null | undefined): string | null {
  const base = legendaTexto?.trim() || "";
  const tags = (hashtags ?? []).filter((h) => !base.includes(h));
  if (!base && !tags.length) return null;
  return tags.length ? `${base}${base ? "\n\n" : ""}${tags.join(" ")}` : base;
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
  const legendaTexto = t.legenda?.trim() || item.post?.default_caption?.trim() || null;
  // Vai ao ar com as 4 a 5 hashtags escolhidas no fim; no trabalho, legenda e hashtags seguem separadas.
  const legendaFinal = legendaComHashtags(legendaTexto, t.hashtags);
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

  const gravado = await mutarTrabalho(t.id, () => ({ file_ids: fileIds, status: "entregue", legenda: legendaTexto }));
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

// ------------------------------------------------------------- configurar

const ID_REFERENCIA = /^(g:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idsDeReferencia(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new ErroEstudio(400, "referencias_invalidas", "Referências em formato inválido.");
  return [...new Set(v.map((x) => texto(x, 80)).filter((x) => ID_REFERENCIA.test(x)))].slice(0, 4);
}

/**
 * configurar { trabalho_id, conjunto?, card? }: escolhas da tela, sem custo.
 * Conjunto: referências e carrossel contínuo. Lâmina: fotos reais do acervo,
 * referências próprias e o texto exato (os blocos acompanham o texto).
 */
async function configurar(ch: Chamador, corpo: Record<string, unknown>) {
  const t = await trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
  if (t.status === "entregue") {
    throw new ErroEstudio(409, "trabalho_entregue", "Este trabalho já foi entregue. Prepare um novo para refazer as artes.");
  }
  const conjunto = (corpo.conjunto && typeof corpo.conjunto === "object" ? corpo.conjunto : null) as Record<string, unknown> | null;
  const cardPedido = (corpo.card && typeof corpo.card === "object" ? corpo.card : null) as Record<string, unknown> | null;
  if (!conjunto && !cardPedido) throw new ErroEstudio(400, "nada_para_configurar", "Nada para mudar.");

  const refsConjunto = conjunto ? idsDeReferencia(conjunto.referencias_ids) : undefined;
  const infinito = conjunto && typeof conjunto.carrossel_infinito === "boolean" ? conjunto.carrossel_infinito : undefined;

  let ordem: number | null = null;
  let imagens: string[] | undefined;
  let refsCard: string[] | undefined;
  let novoTexto: string | undefined;
  if (cardPedido) {
    ordem = lerOrdem(cardPedido);
    cardDaDirecao(t, ordem);
    if (cardPedido.imagens_ids !== undefined) {
      if (!Array.isArray(cardPedido.imagens_ids)) throw new ErroEstudio(400, "imagens_invalidas", "Fotos em formato inválido.");
      // Só fotos do acervo deste cliente.
      imagens = (await imagensDoAcervo(t.client_id, (cardPedido.imagens_ids as unknown[]).map((x) => texto(x, 64)))).map((a) => a.id).slice(0, 1);
    }
    refsCard = idsDeReferencia(cardPedido.referencias_ids);
    if (cardPedido.texto_exato !== undefined) {
      novoTexto = texto(cardPedido.texto_exato, 1200);
      if (!novoTexto) throw new ErroEstudio(400, "texto_vazio", "O texto da lâmina não pode ficar vazio.");
    }
  }

  const gravado = await mutarTrabalho(t.id, (x) => {
    const cards = x.direcao.cards.map((c) => {
      if (c.ordem !== ordem) return c;
      const mudou: CardDirecao = { ...c };
      if (imagens !== undefined) mudou.imagens_ids = imagens;
      if (refsCard !== undefined) mudou.referencias_ids = refsCard;
      if (novoTexto !== undefined && novoTexto !== c.texto_exato) {
        mudou.texto_exato = novoTexto;
        mudou.blocos = blocosDoTexto(novoTexto, c.funcao);
      }
      return mudou;
    });
    return {
      direcao: {
        ...x.direcao,
        cards,
        ...(refsConjunto !== undefined ? { referencias_ids: refsConjunto } : {}),
        ...(infinito !== undefined ? { carrossel_infinito: infinito && cards.length > 1 } : {}),
      },
    };
  });
  return json({ trabalho: gravado });
}

// ------------------------------------------------------------------ porta

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  preparar,
  configurar,
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
