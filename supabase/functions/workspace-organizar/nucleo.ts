/**
 * Núcleo do organizador do Workspace (frente OR, 29/09/2026): o que as ações
 * fazem, sem HTTP nem sessão. index.ts confere quem chama (equipe com acesso
 * ao cliente) e chama daqui. A prova real (script de conferência) usa o
 * mesmo núcleo, então o que se prova é o que roda.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chamarTexto, cobrarJev, custoJev, estimarComModelo, IaMotorErro, type ImagemEntrada, modeloPadrao, type ModeloIa } from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar } from "../_shared/jev.ts";
// FN-01: só o cabeçalho; o imagescript não carrega na partida da função.
import { dimensoesDoCabecalho, mimeDaImagem } from "../_shared/imagem-cabecalho.ts";
import { reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { chave as chaveDoPainel } from "../_shared/chaves.ts";
import type { BancoDoWorkspace, NoDoIndice } from "./aplicar.ts";
import { arquivosParaOrganizar, type ArquivoCandidato, chamadasPorRajada, type NoCompleto } from "./candidatos.ts";
import { defeitoDaImagem, ESQUEMA_DA_LEITURA, type ItemParaLer, LADO_DA_LEITURA, lerArquivos, MAX_POR_CHAMADA, pedidoDoLote, SISTEMA_DA_LEITURA, textoDoMotivo, tokensDaLeitura } from "./leitura.ts";
import { type Candidato, montarPrevia, normalizarLeitura, type Perguntar, type PerguntaJev, type Situacao } from "./organizador.ts";

export class ErroHttp extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

export const STATUS_MOTOR: Record<string, number> = {
  saldo_insuficiente: 402,
  cota_da_chave_esgotada: 402,
  cliente_sem_chave: 403,
  provedor_sem_chave: 503,
  openrouter_sem_credito: 402,
  provedor_sem_credito: 402,
};
export const MENSAGEM_MOTOR: Record<string, string> = {
  saldo_insuficiente: "Saldo insuficiente na carteira de IA do cliente. Recarregue antes de continuar.",
  cota_da_chave_esgotada: "A cota do mês da chave de IA do cliente acabou.",
  cliente_sem_chave: "O cliente não tem chave de IA própria e não está autorizado a usar a da agência.",
  provedor_sem_chave: "O provedor de IA escolhido ainda não tem chave configurada.",
  openrouter_sem_credito: "O OpenRouter está sem crédito.",
  provedor_sem_credito: "A conta do provedor de IA está sem crédito.",
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_TIPO = "workspace_organizar";
const BUCKET = "workspace";
/** Original acima disto nem é baixado (a cópia leve resolve a leitura). */
const MAX_BYTES_ORIGINAL = 30 * 1024 * 1024;
/** Original mandado como veio quando não há cópia leve. */
const MAX_BYTES_SEM_COPIA = 6 * 1024 * 1024;
/** Quadro de vídeo capturado pela tela. */
const MAX_BYTES_QUADRO = 700 * 1024;
const COPIA_ACEITA_ATE = 3 * 1024 * 1024;

let servicoCache: SupabaseClient | null = null;
export function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

export function pastaDoPedido(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  if (!UUID.test(s)) throw new ErroHttp(400, "pasta_invalida", "Pasta inválida (abra uma pasta real do workspace).");
  return s;
}

// ------------------------------------------------------------------ índice

const COLUNAS = "id, parent_id, kind, name, sort_index, inbox_token, inbox_scan_status, mime, size_bytes, storage_path, duration_sec, created_at, sent_for_approval_file_id";

export async function indiceDoCliente(db: SupabaseClient, clientId: string, colunas = COLUNAS): Promise<NoCompleto[]> {
  const linhas: NoCompleto[] = [];
  for (let pagina = 0; pagina < 20; pagina++) {
    const de = pagina * 1000;
    const { data, error } = await db.from("workspace_nodes").select(colunas).eq("scope", "client").eq("client_id", clientId).order("id").range(de, de + 999);
    if (error) throw new ErroHttp(503, "workspace_indisponivel", "Não foi possível ler o workspace do cliente.");
    linhas.push(...((data ?? []) as unknown as NoCompleto[]));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

/** Publicado, aprovado ou em aprovação, pelo arquivo ligado em Arquivos. */
async function situacoes(clientId: string, cands: ArquivoCandidato[]): Promise<Map<string, Situacao>> {
  const saida = new Map<string, Situacao>();
  try {
    const caminhos = cands.map((c) => c.storage_path).filter(Boolean) as string[];
    const arquivos: Array<{ id: string; storage_path: string | null; approval_status: string | null; agency_approval_status: string | null }> = [];
    for (let i = 0; i < caminhos.length; i += 100) {
      const { data } = await servico().from("files").select("id, storage_path, approval_status, agency_approval_status").eq("client_id", clientId).eq("storage_bucket", BUCKET).in("storage_path", caminhos.slice(i, i + 100));
      arquivos.push(...((data ?? []) as typeof arquivos));
    }
    const ligados = cands.map((c) => c.vinculo_file_id).filter(Boolean) as string[];
    for (let i = 0; i < ligados.length; i += 100) {
      const { data } = await servico().from("files").select("id, storage_path, approval_status, agency_approval_status").eq("client_id", clientId).in("id", ligados.slice(i, i + 100));
      arquivos.push(...((data ?? []) as typeof arquivos));
    }
    if (!arquivos.length) return saida;
    const ids = Array.from(new Set(arquivos.map((a) => a.id)));
    const publicados = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await servico().from("editorial_publications").select("file_id, published_at, status").eq("client_id", clientId).in("file_id", ids.slice(i, i + 100));
      for (const p of (data ?? []) as Array<{ file_id: string; published_at: string | null; status: string | null }>) {
        if (p.published_at || /publish|publicad/i.test(String(p.status || ""))) publicados.add(p.file_id);
      }
    }
    for (const c of cands) {
      const doArquivo = arquivos.filter((a) => a.id === c.vinculo_file_id || (!!c.storage_path && a.storage_path === c.storage_path));
      if (!doArquivo.length) continue;
      if (doArquivo.some((a) => publicados.has(a.id))) saida.set(c.id, "publicado");
      else if (doArquivo.some((a) => a.approval_status === "approved")) saida.set(c.id, "aprovado");
      else if (doArquivo.some((a) => a.approval_status === "pending" || a.agency_approval_status === "pending")) saida.set(c.id, "em_aprovacao");
    }
  } catch (e) {
    registrarFalha("workspace-organizar: situação (publicado) não carregou", e, { clientId });
  }
  return saida;
}

async function candidatosDoPedido(clientId: string, parentId: string | null, tudo: boolean) {
  const indice = await indiceDoCliente(servico(), clientId);
  if (parentId) {
    const p = indice.find((n) => n.id === parentId);
    if (!p || p.kind !== "folder") throw new ErroHttp(404, "pasta_nao_encontrada", "Esta pasta não está no workspace deste cliente.");
  }
  const cands = arquivosParaOrganizar(indice, parentId, tudo);
  const sit = await situacoes(clientId, cands);
  for (const c of cands) c.situacao = sit.get(c.id) ?? null;
  return { indice, cands };
}

// ------------------------------------------------------------------ preparar

async function modeloDeLeitura(): Promise<ModeloIa> {
  const m = await modeloPadrao("leitura");
  if (!m) throw new ErroHttp(503, "modelo_padrao_ausente", "O catálogo não tem modelo padrão ativo para leitura.");
  return m;
}

export async function prepararNoCliente(clientId: string, corpo: Record<string, unknown>) {
  const parentId = pastaDoPedido(corpo.parent_id);
  const { cands } = await candidatosDoPedido(clientId, parentId, corpo.tudo === true);
  const imagens = cands.filter((c) => c.leitura === "imagem").length;
  const videos = cands.filter((c) => c.leitura === "video").length;
  const m = await modeloDeLeitura();
  const t1 = tokensDaLeitura(1);
  const porImagem = estimarComModelo(m, { tokensEntrada: t1.entrada, tokensSaida: t1.saida });
  const tn = tokensDaLeitura(imagens + videos);
  return {
    candidatos: cands.map((c) => ({ id: c.id, nome: c.nome, mime: c.mime, tamanho: c.tamanho, duracao: c.duracao, storage_path: c.storage_path, caminho: c.caminho, leitura: c.leitura, situacao: c.situacao })),
    // Chamadas de leitura sugeridas: rajadas de envio inteiras juntas (até 8), para o leitor ver o card inteiro.
    chamadas: chamadasPorRajada(cands.filter((c) => c.leitura !== "nome"), MAX_POR_CHAMADA),
    imagens,
    videos,
    outros: cands.length - imagens - videos,
    estimativa_usd: estimarComModelo(m, { tokensEntrada: tn.entrada, tokensSaida: tn.saida }),
    por_imagem_usd: porImagem,
    modelo: m.rotulo || m.modelo_api,
    max_por_chamada: MAX_POR_CHAMADA,
  };
}

// ------------------------------------------------------------------ ler

function base64ParaBytes(b64: string): Uint8Array | null {
  try {
    const limpo = b64.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
    const bin = atob(limpo);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  let s = "";
  for (let i = 0; i < d.length; i++) s += (d[i] + 0x100).toString(16).slice(1);
  return s;
}

type Aberto =
  | { id: string; hash: string | null; largura: number | null; altura: number | null; item: ItemParaLer }
  | { id: string; motivo: string };

/** Abre um arquivo para a leitura: confere o original, tira o hash e usa a cópia leve. Nunca lança. */
async function abrir(no: NoCompleto, quadro: string | null): Promise<Aberto> {
  try {
    const video = String(no.mime || "").indexOf("video/") === 0 || /\.(mp4|mov|m4v|webm)$/i.test(no.name);
    if (video) {
      if (!quadro) return { id: no.id, motivo: "vídeo sem quadro (o navegador não conseguiu tirar a imagem do vídeo)" };
      const bytes = base64ParaBytes(quadro);
      if (!bytes || bytes.byteLength > MAX_BYTES_QUADRO) return { id: no.id, motivo: "quadro do vídeo inválido" };
      const defeito = defeitoDaImagem(bytes, MAX_BYTES_QUADRO);
      if (defeito) return { id: no.id, motivo: textoDoMotivo(defeito) };
      const d = dimensoesDoCabecalho(bytes);
      const tamanho = Number(no.size_bytes) || 0;
      return {
        id: no.id,
        // Vídeo não é baixado: dois vídeos com o mesmo tamanho exato (acima de 100 KB) contam como o mesmo arquivo.
        hash: tamanho > 100_000 ? `video:${tamanho}` : null,
        largura: d?.largura ?? null,
        altura: d?.altura ?? null,
        item: { id: no.id, nome: no.name, video: true, duracao: no.duration_sec === null ? null : Number(no.duration_sec), largura: d?.largura ?? null, altura: d?.altura ?? null, enviado_em: no.created_at, imagem: { bytes, mime: mimeDaImagem(bytes) || "image/jpeg" } },
      };
    }
    if (!no.storage_path) return { id: no.id, motivo: textoDoMotivo("arquivo_indisponivel") };
    if (Number(no.size_bytes) > MAX_BYTES_ORIGINAL) return { id: no.id, motivo: textoDoMotivo("grande_demais") };
    const { data, error } = await servico().storage.from(BUCKET).download(no.storage_path);
    if (error || !data) return { id: no.id, motivo: textoDoMotivo("arquivo_indisponivel") };
    const original = new Uint8Array(await data.arrayBuffer());
    const defeito = defeitoDaImagem(original, MAX_BYTES_ORIGINAL);
    if (defeito) return { id: no.id, motivo: textoDoMotivo(defeito) };
    const hash = await sha256(original);
    const d = dimensoesDoCabecalho(original);
    const leve = await reduzidaSemTransformacao(servico(), BUCKET, no.storage_path, LADO_DA_LEITURA, LADO_DA_LEITURA, {
      maxBytes: MAX_BYTES_ORIGINAL,
      pedirCopia: true,
      maxPixels: 700_000,
      aceitarCopiaMaiorAte: COPIA_ACEITA_ATE,
    }).catch((e) => {
      registrarFalha("workspace-organizar: cópia leve falhou; tenta o original", e, { no: no.id });
      return null;
    });
    let imagem: { bytes: Uint8Array; mime: string } | null = null;
    if (leve && leve.cabe && !defeitoDaImagem(leve.bytes, MAX_BYTES_ORIGINAL)) imagem = { bytes: leve.bytes, mime: leve.mime };
    else if (original.byteLength <= MAX_BYTES_SEM_COPIA) imagem = { bytes: original, mime: mimeDaImagem(original) || "image/jpeg" };
    if (!imagem) return { id: no.id, motivo: textoDoMotivo("grande_demais") };
    return {
      id: no.id,
      hash,
      largura: d?.largura ?? null,
      altura: d?.altura ?? null,
      item: { id: no.id, nome: no.name, video: false, duracao: null, largura: d?.largura ?? null, altura: d?.altura ?? null, enviado_em: no.created_at, imagem },
    };
  } catch (e) {
    registrarFalha("workspace-organizar: arquivo não abriu", e, { no: no.id });
    return { id: no.id, motivo: textoDoMotivo("arquivo_indisponivel") };
  }
}

const paraTudo = (e: unknown) => e instanceof IaMotorErro && !!STATUS_MOTOR[e.codigo];

function recusouImagem(e: unknown): boolean {
  if (!(e instanceof IaMotorErro) || e.codigo !== "provedor_erro") return false;
  const st = Number(e.detalhes?.status_provedor);
  return st === 413 || (st === 400 && /image|imagem|picture/i.test(e.message));
}

function descrever(e: unknown): string {
  if (e instanceof IaMotorErro) return MENSAGEM_MOTOR[e.codigo] ?? e.message;
  if (e instanceof ErroHttp) return e.message;
  return String((e as Error)?.message ?? e ?? "falha desconhecida").slice(0, 300);
}

function raciocinioPara(m: ModeloIa, preferidos: string[]): string | undefined {
  const aceitos = m.raciocinio ?? [];
  return preferidos.find((r) => aceitos.includes(r));
}

export async function lerNoCliente(clientId: string, userId: string | null, corpo: Record<string, unknown>) {
  const pedidos = (Array.isArray(corpo.itens) ? corpo.itens : [])
    .map((i) => ({ id: String((i as { id?: unknown })?.id ?? ""), quadro: typeof (i as { quadro?: unknown })?.quadro === "string" ? String((i as { quadro: string }).quadro) : null }))
    .filter((i) => UUID.test(i.id))
    .slice(0, MAX_POR_CHAMADA);
  if (!pedidos.length) throw new ErroHttp(400, "entrada_invalida", "Nenhum arquivo para ler.");
  const inicio = Date.now();

  const { data, error } = await servico().from("workspace_nodes").select(COLUNAS).eq("scope", "client").eq("client_id", clientId).in("id", pedidos.map((p) => p.id));
  if (error) throw new ErroHttp(503, "workspace_indisponivel", "Não foi possível ler o workspace do cliente.");
  const nos = new Map(((data ?? []) as unknown as NoCompleto[]).map((n) => [n.id, n]));
  const falhas: Array<{ id: string; motivo: string }> = [];
  // Três arquivos abertos por vez: o original de cada um (hash e conferência) não fica todo na memória junto.
  const abertos: Aberto[] = new Array(pedidos.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(3, pedidos.length) }, async () => {
    while (proximo < pedidos.length) {
      const i = proximo++;
      const p = pedidos[i];
      const no = nos.get(p.id);
      abertos[i] = !no || no.kind !== "file" ? { id: p.id, motivo: "o arquivo não está mais no workspace deste cliente" } : await abrir(no, p.quadro);
    }
  }));
  const meta = new Map<string, { hash: string | null; largura: number | null; altura: number | null }>();
  const itens: ItemParaLer[] = [];
  for (const a of abertos) {
    if ("motivo" in a) falhas.push({ id: a.id, motivo: a.motivo });
    else {
      meta.set(a.id, { hash: a.hash, largura: a.largura, altura: a.altura });
      itens.push(a.item);
    }
  }
  // Na ordem de envio: o leitor vê as lâminas na sequência em que foram coladas.
  itens.sort((a, b) => String(a.enviado_em || "").localeCompare(String(b.enviado_em || "")));

  const leitor = await modeloDeLeitura();
  const r = itens.length
    ? await lerArquivos(itens, {
      lerLote: async (lote) => {
        const resposta = await chamarTexto({
          clientId,
          tarefa: "leitura_referencia",
          agente: "leitor",
          modeloId: leitor.id,
          raciocinio: raciocinioPara(leitor, ["low", "minimal", "none"]),
          sistema: SISTEMA_DA_LEITURA,
          mensagens: [{ papel: "usuario", conteudo: pedidoDoLote(lote), imagens: lote.map((c): ImagemEntrada => ({ bytes: c.imagem.bytes, mime: c.imagem.mime, nome: `arq-${c.id.slice(0, 8)}` })) }],
          esquemaJson: ESQUEMA_DA_LEITURA,
          maxTokensSaida: 3500,
          timeoutMs: 50_000,
          referencia: { tipo: REF_TIPO, id: clientId },
          criadoPor: userId,
        });
        const leituras = ((resposta.json as { leituras?: unknown[] } | undefined)?.leituras) ?? [];
        return { leituras, custo: resposta.custoUsd };
      },
      erroQueParaTudo: paraTudo,
      recusouImagem,
      descrever,
      log: (m, dados) => console.error(m, { clientId, ...dados }),
      prazoMs: Math.max(30_000, 95_000 - (Date.now() - inicio)),
    })
    : { leituras: [], falhas: [], custo: 0, restantes: [] as string[] };

  falhas.push(...r.falhas);
  const parou = r.erroQueParou
    ? { codigo: r.erroQueParou instanceof IaMotorErro ? r.erroQueParou.codigo : "falha", mensagem: descrever(r.erroQueParou) }
    : null;
  if (falhas.length) console.warn("workspace-organizar: arquivos não lidos", { clientId, falhas: falhas.length, motivos: Array.from(new Set(falhas.map((f) => f.motivo))) });
  return {
    lidos: r.leituras.map((l) => ({ id: l.id, leitura: l.leitura, ...(meta.get(l.id) ?? { hash: null, largura: null, altura: null }) })),
    falhas,
    restantes: r.restantes,
    custo_usd: Math.round(r.custo * 1e6) / 1e6,
    // Saldo, cota ou chave: o que já foi lido volta junto; a tela para e mostra o motivo.
    parou,
  };
}

// ------------------------------------------------------------------ propor

type Lido = { leitura: unknown; hash?: unknown; largura?: unknown; altura?: unknown };

export async function proporNoCliente(clientId: string, userId: string | null, corpo: Record<string, unknown>) {
  const parentId = pastaDoPedido(corpo.parent_id);
  const todos = (await candidatosDoPedido(clientId, parentId, corpo.tudo === true)).cands;
  // Prévia de uma seleção (ids): só esses arquivos entram.
  const selecao = Array.isArray(corpo.ids) ? new Set(corpo.ids.map(String)) : null;
  const cands = selecao ? todos.filter((c) => selecao.has(c.id)) : todos;
  const lidos = (corpo.lidos && typeof corpo.lidos === "object" ? corpo.lidos : {}) as Record<string, Lido>;
  const falhas = (corpo.falhas && typeof corpo.falhas === "object" ? corpo.falhas : {}) as Record<string, unknown>;
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);

  const candidatos: Candidato[] = cands.map((c) => {
    const l = lidos[c.id];
    const leitura = l ? normalizarLeitura(l.leitura) : null;
    const hash = l && typeof l.hash === "string" && /^[a-z0-9:]{8,80}$/i.test(l.hash) ? l.hash : null;
    return {
      id: c.id,
      nome: c.nome,
      mime: c.mime,
      tamanho: c.tamanho,
      duracao: c.duracao,
      largura: l ? num(l.largura) : null,
      altura: l ? num(l.altura) : null,
      caminho: c.caminho,
      hash: leitura ? hash : null,
      criado_em: c.criado_em,
      storage_path: c.storage_path,
      leitura,
      falha: typeof falhas[c.id] === "string" ? String(falhas[c.id]).slice(0, 200) : null,
      situacao: c.situacao,
    };
  });

  let custoDoJev = 0;
  let avisoDoJev: string | null = null;
  const temChave = !!(await chaveDoPainel("TYPESAFE_API_KEY"));
  const perguntar: Perguntar | null = temChave
    ? async (state, questions: Record<string, PerguntaJev>) => {
      let ultimo: unknown = null;
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        try {
          const r = await jevPerguntar({ state, questions });
          const cobrado = await cobrarJev(r, { clientId, tarefa: "leitura_referencia", referencia: { tipo: REF_TIPO, id: clientId }, criadoPor: userId }).catch((e) => {
            registrarFalha("workspace-organizar: uso do Jev não registrado", e, { clientId });
            return null;
          });
          custoDoJev += cobrado?.custoUsd ?? custoJev(Number(r.usage?.input_tokens) || 0);
          return r.answers;
        } catch (e) {
          ultimo = e;
          const st = e instanceof JevErro ? e.status : undefined;
          if (st !== 429 && st !== 529 && !(e instanceof JevErro && e.codigo === "jev_timeout")) break;
          await new Promise((ok) => setTimeout(ok, 1500));
        }
      }
      throw ultimo;
    }
    : null;
  if (!temChave) avisoDoJev = "O Jev não está configurado neste servidor: as decisões difíceis ficaram como dúvida.";

  const previa = await montarPrevia(candidatos, {
    perguntar,
    aoFalharOJev: (etapa, e) => {
      registrarFalha(`workspace-organizar: Jev falhou (${etapa})`, e, { clientId });
      avisoDoJev = "O Jev não respondeu em uma das decisões: o que ele decidiria ficou marcado como dúvida.";
    },
  });
  return { previa, custo_jev_usd: Math.round(custoDoJev * 1e6) / 1e6, aviso: avisoDoJev, parent_id: parentId, tudo: corpo.tudo === true };
}

// ------------------------------------------------------------------ confirmar e desfazer

/** O banco do organizador com a sessão de quem confirmou (as regras de acesso do banco valem). */
export function bancoDoWorkspace(db: SupabaseClient, clientId: string, userId: string): BancoDoWorkspace {
  return {
    indice: async () => (await indiceDoCliente(db, clientId, "id, parent_id, kind, name, sort_index, inbox_token, inbox_scan_status")) as NoDoIndice[],
    criarPasta: async (nome, parentId) => {
      const { data, error } = await db.from("workspace_nodes")
        .insert({ name: nome, kind: "folder", scope: "client", client_id: clientId, parent_id: parentId, created_by: userId })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message || "a pasta não foi criada");
      return (data as { id: string }).id;
    },
    atualizar: async (id, campos) => {
      const { error } = await db.from("workspace_nodes").update(campos).eq("id", id).eq("client_id", clientId).eq("scope", "client");
      if (error) throw new Error(error.message);
    },
    tirarPastaVazia: async (id) => {
      // Confere de novo no banco: pasta com qualquer coisa dentro fica (apagar a pasta levaria o que está nela).
      const { data: dentro, error: e1 } = await db.from("workspace_nodes").select("id").eq("parent_id", id).limit(1);
      if (e1 || (dentro ?? []).length) return false;
      const { error } = await db.from("workspace_nodes").delete().eq("id", id).eq("client_id", clientId).eq("kind", "folder").is("inbox_token", null);
      return !error;
    },
  };
}
