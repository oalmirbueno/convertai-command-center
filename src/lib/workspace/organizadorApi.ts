import { supabase } from "@/integrations/supabase/client";
import { ErroDaMesa, mensagemDoCodigo } from "@/lib/mesa/api";
import type { Leitura, Previa } from "../../../supabase/functions/workspace-organizar/organizador";

/**
 * Ponte da tela com o organizador inteligente do Workspace
 * (supabase/functions/workspace-organizar, frente OR 29/09/2026).
 *
 * - As leituras já pagas ficam guardadas neste navegador por arquivo (id,
 *   caminho e tamanho): abrir a prévia de novo não paga a mesma leitura.
 * - O registro do Desfazer da última organização também fica aqui, por
 *   cliente, para desfazer mesmo depois de fechar a janela.
 * - Vídeo vai pelo quadro: o navegador tira uma imagem do vídeo (sem baixar
 *   o arquivo inteiro) e manda só esse JPEG pequeno.
 */

export type { Leitura, Previa };

export type CandidatoDaTela = {
  id: string;
  nome: string;
  mime: string | null;
  tamanho: number | null;
  duracao: number | null;
  storage_path: string | null;
  caminho: string[];
  leitura: "imagem" | "video" | "nome";
  situacao: string | null;
};

export type Preparacao = {
  candidatos: CandidatoDaTela[];
  imagens: number;
  videos: number;
  outros: number;
  estimativa_usd: number;
  por_imagem_usd: number;
  modelo: string;
  max_por_chamada: number;
  /** Chamadas de leitura sugeridas pelo servidor (rajadas de envio inteiras juntas). */
  chamadas?: string[][];
};

/** As chamadas de leitura para o que falta ler: as do servidor (sem partir a rajada) ou em blocos de `max`. */
export function chamadasDeLeitura(prep: Pick<Preparacao, "chamadas" | "max_por_chamada">, faltam: string[]): string[][] {
  const falta = new Set(faltam);
  const max = Math.max(1, prep.max_por_chamada || 8);
  const saida: string[][] = [];
  const usados = new Set<string>();
  for (const c of prep.chamadas || []) {
    const parte = c.filter((id) => falta.has(id) && !usados.has(id));
    parte.forEach((id) => usados.add(id));
    if (parte.length) saida.push(parte);
  }
  const resto = faltam.filter((id) => !usados.has(id));
  for (let i = 0; i < resto.length; i += max) saida.push(resto.slice(i, i + max));
  return saida;
}

export type Lido = { id: string; leitura: Leitura; hash: string | null; largura: number | null; altura: number | null };

export type RespostaDaLeitura = {
  lidos: Lido[];
  falhas: Array<{ id: string; motivo: string }>;
  restantes: string[];
  custo_usd: number;
  parou: { codigo: string; mensagem: string } | null;
};

export type RespostaDaProposta = { previa: Previa; custo_jev_usd: number; aviso: string | null; parent_id: string | null; tudo: boolean };

export type EstadoDoNo = { parent_id: string | null; name: string; sort_index: number | null };
export type RegistroDoDesfazer = {
  versao: 1;
  client_id: string;
  parent_id: string | null;
  feito_em: string;
  itens: Array<{ id: string; antes: EstadoDoNo; depois: EstadoDoNo }>;
  pastas_criadas: string[];
};

export type RespostaDaConfirmacao = {
  registro: RegistroDoDesfazer;
  movidos: number;
  renomeados: number;
  pastas_criadas: number;
  falhas: Array<{ id: string; nome: string; motivo: string }>;
};

export type RespostaDoDesfazer = {
  restaurados: number;
  pulados: Array<{ id: string; nome: string; motivo: string }>;
  pastas_tiradas: number;
  pastas_mantidas: number;
};

export type GrupoParaConfirmar = { caminho: string[]; itens: Array<{ id: string; nome: string; ordem: number | null }> };

const FUNCAO = "workspace-organizar";

type ContextoDoErro = { status?: number; clone?: () => { json: () => Promise<Record<string, unknown>> }; json?: () => Promise<Record<string, unknown>> };

async function erroDaResposta(error: { name?: string; context?: ContextoDoErro } | null): Promise<ErroDaMesa> {
  const ctx = error?.context;
  let corpo: Record<string, unknown> | null = null;
  try {
    if (ctx && typeof ctx.clone === "function") corpo = await ctx.clone().json();
    else if (ctx && typeof ctx.json === "function") corpo = await ctx.json();
  } catch {
    corpo = null;
  }
  if (corpo && typeof corpo.error === "string") return new ErroDaMesa(String(corpo.error), mensagemDoCodigo(String(corpo.error), corpo), corpo);
  const status = Number(ctx?.status) || 0;
  const nome = String(error?.name || "");
  if (status === 404 || nome === "FunctionsFetchError" || nome === "FunctionsRelayError") {
    return new ErroDaMesa("servico_indisponivel", "O organizador ainda não respondeu. Pode estar sendo publicado agora; tente de novo em instantes.");
  }
  return new ErroDaMesa("falha_interna", "O organizador falhou ao processar o pedido. Nada foi movido; tente de novo.");
}

export async function chamarOrganizador<T>(acao: string, corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FUNCAO, { body: { acao, ...corpo } });
  if (error) throw await erroDaResposta(error as { name?: string; context?: ContextoDoErro });
  const resposta = data as Record<string, unknown> | null;
  if (resposta && typeof resposta === "object" && typeof resposta.error === "string") {
    const codigo = String(resposta.error);
    throw new ErroDaMesa(codigo, mensagemDoCodigo(codigo, resposta), resposta);
  }
  return data as T;
}

// ------------------------------------------------------------ guardado no navegador

type Guardado = { caminho: string | null; tamanho: number | null; lido: Omit<Lido, "id">; em: number };
const chaveDasLeituras = (clientId: string) => `workspace-organizar:leituras:v1:${clientId}`;
const chaveDoDesfazer = (clientId: string) => `workspace-organizar:desfazer:v1:${clientId}`;
const MAX_GUARDADAS = 1500;

function lerJson<T>(chave: string): T | null {
  try {
    const v = window.localStorage.getItem(chave);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function gravarJson(chave: string, valor: unknown) {
  try {
    if (valor === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* navegador sem espaço ou bloqueado: segue sem guardar */
  }
}

/** Leituras já pagas que ainda valem (mesmo arquivo: mesmo caminho e tamanho). */
export function leiturasGuardadas(clientId: string, candidatos: CandidatoDaTela[]): Map<string, Lido> {
  const tudo = lerJson<Record<string, Guardado>>(chaveDasLeituras(clientId)) || {};
  const saida = new Map<string, Lido>();
  for (const c of candidatos) {
    const g = tudo[c.id];
    if (g && g.caminho === c.storage_path && (g.tamanho ?? null) === (c.tamanho ?? null) && g.lido?.leitura) saida.set(c.id, { id: c.id, ...g.lido });
  }
  return saida;
}

export function guardarLeituras(clientId: string, candidatos: CandidatoDaTela[], lidos: Lido[]) {
  if (!lidos.length) return;
  const tudo = lerJson<Record<string, Guardado>>(chaveDasLeituras(clientId)) || {};
  const porId = new Map(candidatos.map((c) => [c.id, c]));
  const agora = Date.now();
  for (const l of lidos) {
    const c = porId.get(l.id);
    if (!c) continue;
    const { id: _id, ...lido } = l;
    tudo[l.id] = { caminho: c.storage_path, tamanho: c.tamanho, lido, em: agora };
  }
  const ids = Object.keys(tudo);
  if (ids.length > MAX_GUARDADAS) {
    ids.sort((a, b) => (tudo[a].em || 0) - (tudo[b].em || 0));
    for (const id of ids.slice(0, ids.length - MAX_GUARDADAS)) delete tudo[id];
  }
  gravarJson(chaveDasLeituras(clientId), tudo);
}

export type UltimaOrganizacao = { registro: RegistroDoDesfazer; resumo: string };

export function ultimaOrganizacao(clientId: string): UltimaOrganizacao | null {
  const u = lerJson<UltimaOrganizacao>(chaveDoDesfazer(clientId));
  return u && u.registro && Array.isArray(u.registro.itens) && u.registro.itens.length ? u : null;
}

export function guardarUltimaOrganizacao(clientId: string, u: UltimaOrganizacao | null) {
  gravarJson(chaveDoDesfazer(clientId), u);
}

// ------------------------------------------------------------ quadro do vídeo

export type QuadroDoVideo = { base64: string; url: string; largura: number; altura: number; duracao: number | null };

/**
 * Tira um quadro do vídeo no navegador (a 1 s ou a 10% do começo), no máximo
 * 640 px e em JPEG. Null quando o navegador não abre o vídeo a tempo.
 */
export function quadroDoVideo(url: string, esperaMs = 12_000): Promise<QuadroDoVideo | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((ok) => {
    const v = document.createElement("video");
    let feito = false;
    const fim = (r: QuadroDoVideo | null) => {
      if (feito) return;
      feito = true;
      window.clearTimeout(t);
      try {
        v.removeAttribute("src");
        v.load();
      } catch {
        /* nada */
      }
      ok(r);
    };
    const t = window.setTimeout(() => fim(null), esperaMs);
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      try {
        v.currentTime = d ? Math.min(1, d * 0.1) : 0.1;
      } catch {
        fim(null);
      }
    };
    v.onseeked = () => {
      try {
        const lw = v.videoWidth || 0;
        const la = v.videoHeight || 0;
        if (!lw || !la) return fim(null);
        const escala = Math.min(1, 640 / Math.max(lw, la));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(lw * escala));
        c.height = Math.max(1, Math.round(la * escala));
        const ctx = c.getContext("2d");
        if (!ctx) return fim(null);
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL("image/jpeg", 0.8);
        const base64 = dataUrl.split(",")[1] || "";
        if (!base64) return fim(null);
        fim({ base64, url: dataUrl, largura: lw, altura: la, duracao: isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration * 10) / 10 : null });
      } catch {
        fim(null);
      }
    };
    v.onerror = () => fim(null);
    v.src = url;
  });
}

// ------------------------------------------------------------ prévia editada

export type EdicaoDaPrevia = {
  /** Itens que a pessoa tirou da prévia. */
  fora: Set<string>;
  /** Nome novo da última pasta de cada grupo, por chave do grupo. */
  nomes: Record<string, string>;
};

/** O que vai para o Confirmar: só os itens que ficaram, com o nome da pasta que a pessoa escolheu. */
export function gruposParaConfirmar(previa: Previa, edicao: EdicaoDaPrevia): GrupoParaConfirmar[] {
  const saida: GrupoParaConfirmar[] = [];
  const renomeadas = new Map<string, string>();
  for (const g of previa.grupos) {
    const novo = (edicao.nomes[g.chave] || "").trim();
    if (novo) renomeadas.set(g.caminho.join("/"), novo);
  }
  for (const g of previa.grupos) {
    // Pasta de cima renomeada vale também para os grupos dentro dela.
    const caminho = g.caminho.map((parte, i) => renomeadas.get(g.caminho.slice(0, i + 1).join("/")) || parte);
    const itens = g.itens.filter((i) => !edicao.fora.has(i.id)).map((i) => ({ id: i.id, nome: i.nome_novo, ordem: i.ordem }));
    if (itens.length) saida.push({ caminho, itens });
  }
  return saida;
}
