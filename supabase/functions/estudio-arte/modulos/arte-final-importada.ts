/**
 * Arte final pronta (12/11/2026): a peça foi feita fora (ex.: reserva do
 * Codex) e entra direto na lâmina, sem Gerar, sem Preparar direção e sem
 * nenhum modelo. É só mais uma versão da lâmina, gravada pelo MESMO caminho do
 * Gerar: o arquivo no bucket mesa (salvarNaMesa: card-<ordem>-v<versão>.png) e a
 * versão acrescentada em estudio_trabalhos.cards pela trava otimista
 * (mutarTrabalho). As versões anteriores ficam guardadas.
 *
 * Travas (as mesmas do Profile, que também grava PNG sem IA): trabalho entregue,
 * agendado, aprovado ou em aprovação não aceita versão nova (reabrir primeiro);
 * post de fotos e criativo de anúncio ficam de fora; a versão esperada protege
 * contra duas pessoas trocando a mesma lâmina. O pedido_id torna o reenvio
 * idempotente. Não importa Deno/Supabase: as regras são as mesmas nos testes.
 *
 * Formato: só PNG, gravado como veio (sem conversão), como o Gerar. O caminho
 * do Gerar é sempre .png: aceitar JPEG/WEBP exigiria outra extensão no mesmo
 * número de versão (card-N-vX.jpg ao lado de card-N-vX.png). JPEG e WEBP são
 * recusados ("Use uma imagem PNG."), nunca gravados.
 */
import { defeitoDaImagem } from "../../_shared/defeito-da-imagem.ts";
import { dimensoesDoCabecalho, mimeDaImagem } from "../../_shared/imagem-cabecalho.ts";

export const MAX_BYTES_ARTE_IMPORTADA = 8_000_000;
export const MIMES_DA_ARTE_IMPORTADA = ["image/png"] as const;
export const MODO_DA_ARTE_IMPORTADA = "arte_importada";
const MENOR_LADO = 300;
const MAX_PIXELS = 40_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHADOS = new Set(["entregue", "aprovado", "agendado", "arquivado"]);
const EM_APROVACAO = new Set(["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"]);

type Erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Error;

export interface VersaoDaArteImportada {
  ordem: number;
  versao: number;
  storage_path: string;
  pedido_id?: string;
  arte_hash?: string;
  [k: string]: unknown;
}

export interface TrabalhoDaArteImportada {
  id: string;
  client_id: string;
  status: string;
  tipo?: string | null;
  entrega_status?: string | null;
  direcao: { cards: Array<{ ordem: number }>; formato?: unknown };
  cards: VersaoDaArteImportada[];
}

export type DepsDaArteImportada<C extends { userId: string }, T extends TrabalhoDaArteImportada> = {
  erro: Erro;
  json: (body: unknown, status?: number) => Response;
  trabalhoComAcesso: (ch: C, id: string) => Promise<T>;
  mutarTrabalho: (id: string, mudar: (t: T) => Record<string, unknown>) => Promise<T>;
  /** O mesmo salvarNaMesa do Gerar. */
  salvarImagem: (t: T, ordem: number, proxima: number, bytes: Uint8Array, mime: string) => Promise<{ caminho: string; versao: number }>;
  descartarUpload?: (caminho: string) => Promise<void>;
  /** Erro do mutarTrabalho que garante que nenhum UPDATE gravou (no index: gravacaoNaoOcorreuNoMutar). */
  gravacaoNaoOcorreu?: (e: unknown) => boolean;
  quadro: (t: T) => { formato: string; largura: number; altura: number };
  ehPostDeFotos: (t: T) => boolean;
  statusDepoisDeGerar: (t: T, ordem: number) => string;
};

/** Base64 puro (sem "data:"), até 8 MB, PNG inteiro e de tamanho razoável. */
export function lerArteImportada(v: unknown, erro: Erro): { bytes: Uint8Array; mime: string; largura: number; altura: number } {
  if (typeof v !== "string" || !v) throw erro(400, "arte_invalida", "Escolha o arquivo da arte final (PNG).");
  if (v.length > Math.ceil(MAX_BYTES_ARTE_IMPORTADA / 3) * 4 + 4) throw erro(413, "arte_grande", "A arte final deve ter até 8 MB.");
  if (v.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) throw erro(400, "arte_invalida", "O arquivo da arte não pôde ser lido. Escolha de novo.");
  let raw: string;
  try { raw = atob(v); } catch { throw erro(400, "arte_invalida", "O arquivo da arte não pôde ser lido. Escolha de novo."); }
  if (raw.length > MAX_BYTES_ARTE_IMPORTADA) throw erro(413, "arte_grande", "A arte final deve ter até 8 MB.");
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const mime = mimeDaImagem(bytes);
  if (!mime || !(MIMES_DA_ARTE_IMPORTADA as readonly string[]).includes(mime)) throw erro(400, "arte_formato", "Use uma imagem PNG.");
  if (defeitoDaImagem(bytes, MAX_BYTES_ARTE_IMPORTADA)) throw erro(400, "arte_quebrada", "A imagem parece incompleta ou corrompida. Exporte de novo e tente outra vez.");
  const d = dimensoesDoCabecalho(bytes);
  if (!d || d.largura < 1 || d.altura < 1) throw erro(400, "arte_quebrada", "Não deu para ler o tamanho da imagem. Exporte de novo e tente outra vez.");
  if (Math.min(d.largura, d.altura) < MENOR_LADO) throw erro(400, "arte_pequena", `A imagem é pequena demais (${d.largura} × ${d.altura} px). Use pelo menos ${MENOR_LADO} px no lado menor.`);
  if (d.largura * d.altura > MAX_PIXELS) throw erro(413, "arte_grande", "A imagem tem pixels demais. Exporte em até 4000 px de lado.");
  return { bytes, mime, largura: d.largura, altura: d.altura };
}

/** Mesma trava do Profile: travado não ganha versão nova, nunca sobrescreve. */
export function travaDaArteImportada<T extends TrabalhoDaArteImportada>(t: T, ordem: number, esperado: number, d: { erro: Erro; ehPostDeFotos: (t: T) => boolean }) {
  if (FECHADOS.has(t.status) || EM_APROVACAO.has(t.entrega_status || "")) {
    throw d.erro(409, "trabalho_entregue", "Esta lâmina está travada: o trabalho já foi entregue, aprovado ou está em aprovação. Use \"Reabrir para corrigir\" antes de trocar a arte.", { pode_reabrir: true });
  }
  if (t.tipo === "ads") throw d.erro(409, "arte_importada_indisponivel", "Para criativo de anúncio, troque a arte na Mesa Ads.");
  if (d.ehPostDeFotos(t)) throw d.erro(409, "post_de_fotos", "Este post é de fotos da Mesa Foto: troque as fotos na Mesa Foto.");
  if (!t.direcao.cards.some((c) => c.ordem === ordem)) throw d.erro(404, "card_inexistente", "Esta lâmina não existe mais na direção do trabalho.");
  const atual = Math.max(0, ...t.cards.filter((c) => c.ordem === ordem).map((c) => c.versao));
  if (atual !== esperado) throw d.erro(409, "arte_concorrente", "A lâmina mudou enquanto você escolhia o arquivo. Atualize a tela e envie de novo.");
}

/**
 * Erros do mutarTrabalho que provam que nada foi gravado: a leitura do trabalho
 * (que roda antes de cada UPDATE) falhou, ou todas as tentativas terminaram sem
 * linha atualizada. Numa nova tentativa a anterior voltou sem linha e sem erro,
 * então leitura falhando depois de um UPDATE também é sem commit. Fica de fora
 * "gravacao_falhou" (o UPDATE voltou com erro: pode ter gravado).
 */
export const ERROS_DO_MUTAR_SEM_GRAVACAO: ReadonlySet<string> = new Set([
  "conflito_de_gravacao",
  "trabalho_indisponivel",
  "trabalho_inexistente",
  "trabalho_invalido",
]);
export const gravacaoNaoOcorreuNoMutar = (e: unknown): boolean => {
  const codigo = e && typeof e === "object" ? (e as { codigo?: unknown }).codigo : undefined;
  return typeof codigo === "string" && ERROS_DO_MUTAR_SEM_GRAVACAO.has(codigo);
};

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

class Replay<T> extends Error {
  constructor(readonly trabalho: T, readonly versao: VersaoDaArteImportada) { super("arte_ja_guardada"); }
}
class Recusa<T> extends Error {
  constructor(readonly trabalho: T, readonly motivo: unknown) { super("arte_recusada_antes_da_gravacao"); }
}

export function acoesDaArteImportada<C extends { userId: string }, T extends TrabalhoDaArteImportada>(d: DepsDaArteImportada<C, T>) {
  async function importarArteFinal(ch: C, corpo: Record<string, unknown>): Promise<Response> {
    if (typeof corpo.trabalho_id !== "string" || !UUID.test(corpo.trabalho_id) || typeof corpo.pedido_id !== "string" || !UUID.test(corpo.pedido_id)) {
      throw d.erro(400, "pedido_invalido", "Trabalho e identificador do pedido são obrigatórios.");
    }
    if (typeof corpo.ordem !== "number" || !Number.isInteger(corpo.ordem) || corpo.ordem < 1 || typeof corpo.versao_esperada !== "number" || !Number.isInteger(corpo.versao_esperada) || corpo.versao_esperada < 0) {
      throw d.erro(400, "versao_invalida", "Informe a lâmina e a versão que está trocando.");
    }
    const ordem = corpo.ordem;
    const esperado = corpo.versao_esperada;
    const pedidoId = corpo.pedido_id;
    const t = await d.trabalhoComAcesso(ch, corpo.trabalho_id);
    const arte = lerArteImportada(corpo.imagem_base64, d.erro);
    const hashDosBytes = hex(await crypto.subtle.digest("SHA-256", new Uint8Array(arte.bytes)));
    const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([ordem, esperado, hashDosBytes]))));
    const replay = (atual: T) => {
      const anterior = atual.cards.find((c) => c.pedido_id === pedidoId);
      if (anterior && anterior.arte_hash !== hash) throw d.erro(409, "pedido_reutilizado", "Este pedido já foi usado para outra arte. Envie de novo.");
      return anterior;
    };
    const quadro = d.quadro(t);
    const proporcaoDiferente = Math.abs(arte.largura / arte.altura - quadro.largura / quadro.altura) >= 0.01;
    const aviso = proporcaoDiferente
      ? `A arte tem ${arte.largura} × ${arte.altura} px, fora da proporção do post (${quadro.largura} × ${quadro.altura}). Na entrega ela é cortada pelo centro.`
      : null;
    const resposta = (trabalho: T, v: VersaoDaArteImportada, repetido = false) =>
      d.json({ trabalho, ordem: v.ordem, versao: v.versao, storage_path: v.storage_path, custo_usd: 0, aviso, ...(repetido ? { ja_guardado: true } : {}) });
    const anterior = replay(t);
    if (anterior) return resposta(t, anterior, true);
    travaDaArteImportada(t, ordem, esperado, d);
    const upload = await d.salvarImagem(t, ordem, esperado + 1, arte.bytes, arte.mime);
    const nova: VersaoDaArteImportada = {
      ordem,
      versao: upload.versao,
      storage_path: upload.caminho,
      origem: "gerar",
      modo: MODO_DA_ARTE_IMPORTADA,
      pedido_id: pedidoId,
      arte_hash: hash,
      formato_post: quadro.formato,
      tamanho: `${arte.largura}x${arte.altura}`,
      mime: arte.mime,
      // Sem conferência automática (ela usa modelo): a equipe confere se quiser, pelo botão de sempre.
      verificacao: { pendente: true },
      custo_usd: 0,
      uso_ids: [],
      criado_em: new Date().toISOString(),
      criado_por: ch.userId,
    };
    // Antes do primeiro UPDATE (ex.: leitura falhou), nada foi gravado: o arquivo pode sair.
    let mandouUpdate = false;
    const descartar = async () => {
      if (d.descartarUpload) await d.descartarUpload(upload.caminho).catch(() => undefined);
    };
    try {
      const gravado = await d.mutarTrabalho(t.id, (atual) => {
        try {
          if (atual.client_id !== t.client_id) throw d.erro(409, "cliente_alterado", "O cliente do trabalho mudou. Abra o trabalho de novo.");
          const repetido = replay(atual);
          if (repetido) throw new Replay(atual, repetido);
          travaDaArteImportada(atual, ordem, esperado, d);
        } catch (e) {
          if (e instanceof Replay) throw e;
          throw new Recusa(atual, e);
        }
        const patch = { cards: [...atual.cards, nova], status: d.statusDepoisDeGerar(atual, ordem) };
        mandouUpdate = true;
        return patch;
      });
      return resposta(gravado, nova);
    } catch (e) {
      if (e instanceof Recusa) {
        const r = e as Recusa<T>;
        if (!r.trabalho.cards.some((c) => c.storage_path === upload.caminho)) await descartar();
        throw r.motivo;
      }
      if (!(e instanceof Replay)) {
        // Sem commit comprovado (erro antes de qualquer UPDATE, ou todas as tentativas sem linha
        // gravada): descarta para não deixar órfão nem gastar os nomes do salvarNaMesa.
        // Falha de rede/UPDATE sem resultado confirmado: não apaga (o commit pode ter ocorrido).
        if (!mandouUpdate || d.gravacaoNaoOcorreu?.(e)) await descartar();
        throw e;
      }
      const r = e as Replay<T>;
      if (!r.trabalho.cards.some((c) => c.storage_path === upload.caminho)) await descartar();
      return resposta(r.trabalho, r.versao, true);
    }
  }
  return { importar_arte_final: importarArteFinal };
}
