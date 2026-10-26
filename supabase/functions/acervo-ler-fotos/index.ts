/**
 * Leitura das fotos do acervo do cliente (26/10/2026). Regras em regras.ts.
 *
 * Robô do cron (a cada 30 min, x-cron-secret e chave de serviço; `client_id`
 * opcional no corpo para ler um cliente só). Pega as fotos ativas de cliente_imagens
 * SEM descrição (nunca logo, gerada por IA nem referência da internet), lê por
 * visão no mesmo leitor do organizador do Workspace (lerArquivos: lotes de até
 * 8, quebrada sai antes de gastar, recusa uma a uma, prazo) com a cópia leve
 * (miniatura de 640 px; sem ela, a copias-leves grava numa chamada à parte, sem
 * gastar a CPU desta) e grava descrição, etiquetas e categoria (só quando vazia
 * ou "?"). Com descrição, a mídia da peça e o Estúdio passam a achar a foto
 * real que combina com a pauta.
 *
 * Custos: a visão vai na carteira de cada cliente (tarefa leitura_referencia);
 * quem tem menos de US$ 0,30 fica para depois. Nunca apaga nada, nunca escreve
 * em `files` (a guarda de arquivos não entra aqui) e não sobrescreve descrição
 * que alguém escreveu entre a leitura e a gravação.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chamarTexto, IaMotorErro, type ImagemEntrada, lerSaldo, modeloPadrao, type ModeloIa } from "../_shared/ia-motor.ts";
import { dimensoesDoCabecalho } from "../_shared/imagem-cabecalho.ts";
import { reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { defeitoDaImagem, type ItemParaLer, LADO_DA_LEITURA, lerArquivos, pedidoDoLote, textoDoMotivo } from "../workspace-organizar/leitura.ts";
import {
  ESQUEMA_DA_LEITURA_DO_ACERVO,
  type FotoParaLer,
  FOTOS_POR_RODADA,
  fotosDaRodada,
  type LeituraDoAcervo,
  MAX_FOTOS_POR_RODADA,
  normalizarLeituraDoAcervo,
  patchDaFalha,
  patchDaLeitura,
  SALDO_MINIMO_DA_LEITURA,
  SISTEMA_DA_LEITURA_DO_ACERVO,
} from "./regras.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS = "id, client_id, nome, storage_bucket, storage_path, categoria, tags, descricao, ativa, gerada, criado_em";
/** A rodada inteira cabe longe dos 150 s (a resposta tem fôlego, mas o cron não precisa esperar mais). */
const PRAZO_DA_RODADA_MS = 110_000;
/** Cópia leve: a miniatura de 640 px serve; original acima disto não é aberto aqui (a copias-leves reduz). */
const MAX_PIXELS_AQUI = 2_000_000;
const COPIA_ACEITA_ATE = 3 * 1024 * 1024;
const MAX_BYTES_ORIGINAL = 30 * 1024 * 1024;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

/**
 * Só o cron (x-cron-secret) ou a chave de serviço: a leitura gasta na carteira do cliente, então a equipe não
 * dispara por aqui (na tela, a leitura sob pedido continua no organizador do Workspace).
 */
function autorizado(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (cronSecret && req.headers.get("x-cron-secret")?.trim() === cronSecret) return true;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  return !!token && !!chave && token === chave;
}

/** Abre a foto pela cópia leve. Nunca lança: o motivo volta no lugar da imagem. */
async function abrir(f: FotoParaLer): Promise<ItemParaLer | { id: string; motivo: string }> {
  try {
    const leve = await reduzidaSemTransformacao(servico(), f.storage_bucket, f.storage_path, LADO_DA_LEITURA, LADO_DA_LEITURA, {
      maxBytes: MAX_BYTES_ORIGINAL,
      pedirCopia: true,
      maxPixels: MAX_PIXELS_AQUI,
      aceitarCopiaMaiorAte: COPIA_ACEITA_ATE,
    });
    if (!leve) return { id: f.id, motivo: textoDoMotivo("arquivo_indisponivel") };
    if (!leve.cabe) return { id: f.id, motivo: textoDoMotivo("grande_demais") };
    const defeito = defeitoDaImagem(leve.bytes, MAX_BYTES_ORIGINAL);
    if (defeito) return { id: f.id, motivo: textoDoMotivo(defeito) };
    const d = leve.largura && leve.altura ? { largura: leve.largura, altura: leve.altura } : dimensoesDoCabecalho(leve.bytes);
    return { id: f.id, nome: f.nome, video: false, duracao: null, largura: d?.largura ?? null, altura: d?.altura ?? null, enviado_em: null, imagem: { bytes: leve.bytes, mime: leve.mime } };
  } catch (e) {
    registrarFalha("acervo-ler-fotos: foto não abriu", e, { imagem_id: f.id });
    return { id: f.id, motivo: textoDoMotivo("arquivo_indisponivel") };
  }
}

const paraTudo = (e: unknown) => e instanceof IaMotorErro && ["saldo_insuficiente", "cota_da_chave_esgotada", "cliente_sem_chave", "provedor_sem_chave", "openrouter_sem_credito", "provedor_sem_credito"].indexOf(e.codigo) >= 0;
function recusouImagem(e: unknown): boolean {
  if (!(e instanceof IaMotorErro) || e.codigo !== "provedor_erro") return false;
  const st = Number(e.detalhes?.status_provedor);
  return st === 413 || (st === 400 && /image|imagem|picture/i.test(e.message));
}
const descrever = (e: unknown) => (e instanceof IaMotorErro ? e.message : String((e as Error)?.message ?? e ?? "falha desconhecida")).slice(0, 300);

/** Grava a leitura (ou a tentativa que falhou) sem passar por cima de descrição escrita no meio do caminho. */
async function gravar(f: FotoParaLer, patch: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await servico().from("cliente_imagens").update(patch).eq("id", f.id).eq("client_id", f.client_id).or("descricao.is.null,descricao.eq.").select("id");
  if (error) {
    registrarFalha("acervo-ler-fotos: gravação recusada", error, { imagem_id: f.id });
    return false;
  }
  return ((data as unknown[] | null) ?? []).length > 0;
}

function raciocinioPara(m: ModeloIa, preferidos: string[]): string | undefined {
  const aceitos = m.raciocinio ?? [];
  return preferidos.find((r) => aceitos.includes(r));
}

type Resumo = { cliente: string; lidas: number; falhas: number; custo_usd: number; parou: string | null };

async function lerDoCliente(clientId: string, fotos: FotoParaLer[], leitor: ModeloIa, prazoMs: number): Promise<Resumo> {
  const resumo: Resumo = { cliente: clientId, lidas: 0, falhas: 0, custo_usd: 0, parou: null };
  // Uma foto aberta por vez: a CPU da função fica com o cabeçalho e os bytes da miniatura.
  const itens: ItemParaLer[] = [];
  for (const f of fotos) {
    const a = await abrir(f);
    if ("motivo" in a) {
      if (await gravar(f, patchDaFalha(f))) resumo.falhas += 1;
    } else itens.push(a);
  }
  if (!itens.length) return resumo;
  const porId = new Map(fotos.map((f) => [f.id, f]));
  const r = await lerArquivos<LeituraDoAcervo>(itens, {
    normalizar: normalizarLeituraDoAcervo,
    lerLote: async (lote) => {
      const resposta = await chamarTexto({
        clientId,
        tarefa: "leitura_referencia",
        agente: "leitor",
        modeloId: leitor.id,
        raciocinio: raciocinioPara(leitor, ["low", "minimal", "none"]),
        sistema: SISTEMA_DA_LEITURA_DO_ACERVO,
        mensagens: [{ papel: "usuario", conteudo: pedidoDoLote(lote), imagens: lote.map((c): ImagemEntrada => ({ bytes: c.imagem.bytes, mime: c.imagem.mime, nome: `foto-${c.id.slice(0, 8)}` })) }],
        esquemaJson: ESQUEMA_DA_LEITURA_DO_ACERVO,
        maxTokensSaida: 3000,
        timeoutMs: 50_000,
        referencia: { tipo: "acervo_ler_fotos", id: clientId },
        criadoPor: null,
      });
      return { leituras: ((resposta.json as { leituras?: unknown[] } | undefined)?.leituras) ?? [], custo: resposta.custoUsd };
    },
    erroQueParaTudo: paraTudo,
    recusouImagem,
    descrever,
    log: (m, dados) => console.error(m.replace("workspace-organizar", "acervo-ler-fotos"), { clientId, ...dados }),
    prazoMs,
  });
  resumo.custo_usd = Math.round(r.custo * 1e6) / 1e6;
  for (const l of r.leituras) {
    const f = porId.get(l.id);
    if (f && (await gravar(f, patchDaLeitura(f, l.leitura)))) resumo.lidas += 1;
  }
  // Saldo, cota ou chave: nada conta como tentativa (a foto não teve culpa).
  if (r.erroQueParou) resumo.parou = descrever(r.erroQueParou);
  else {
    for (const falha of r.falhas) {
      const f = porId.get(falha.id);
      if (f && (await gravar(f, patchDaFalha(f)))) resumo.falhas += 1;
    }
  }
  return resumo;
}

async function rodada(corpo: Record<string, unknown>) {
  const inicio = Date.now();
  const limite = Math.min(MAX_FOTOS_POR_RODADA, Math.max(1, Number(corpo.limit) || FOTOS_POR_RODADA));
  const clientId = typeof corpo.client_id === "string" && UUID.test(corpo.client_id) ? corpo.client_id : null;
  let q = servico().from("cliente_imagens").select(CAMPOS).eq("ativa", true).eq("gerada", false).or("descricao.is.null,descricao.eq.")
    .order("criado_em", { ascending: false }).limit(300);
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error) throw error;
  const fotos = (data ?? []) as FotoParaLer[];
  if (!fotos.length) return { ok: true, candidatas: 0, lidas: 0, falhas: 0, clientes: [] as Resumo[] };

  const leitor = await modeloPadrao("leitura");
  if (!leitor) return { ok: false, error: "modelo_padrao_ausente", mensagem: "O catálogo não tem modelo padrão ativo para leitura." };
  const saldos = new Map<string, number>();
  for (const c of new Set(fotos.map((f) => f.client_id))) saldos.set(c, await lerSaldo(c).catch(() => 0));
  const grupos = fotosDaRodada(fotos, limite, (c) => (saldos.get(c) ?? 0) >= SALDO_MINIMO_DA_LEITURA);

  const clientes: Resumo[] = [];
  for (const [c, doCliente] of grupos) {
    const resta = PRAZO_DA_RODADA_MS - (Date.now() - inicio);
    if (resta < 20_000) break;
    try {
      clientes.push(await lerDoCliente(c, doCliente, leitor, resta - 10_000));
    } catch (e) {
      registrarFalha("acervo-ler-fotos: leitura do cliente falhou", e, { client_id: c });
      clientes.push({ cliente: c, lidas: 0, falhas: 0, custo_usd: 0, parou: descrever(e) });
    }
  }
  return {
    ok: true,
    candidatas: fotos.length,
    lidas: clientes.reduce((s, x) => s + x.lidas, 0),
    falhas: clientes.reduce((s, x) => s + x.falhas, 0),
    sem_saldo: [...saldos].filter(([, v]) => v < SALDO_MINIMO_DA_LEITURA).length,
    clientes,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!autorizado(req)) return json({ error: "unauthorized" }, 401);
  let corpo: Record<string, unknown> = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio é normal no cron */ }
  return respostaComFolego(async () => {
    try {
      return json(await rodada(corpo));
    } catch (e) {
      registrarFalha("acervo-ler-fotos: rodada falhou", e, {});
      return json({ ok: false, error: "erro_interno", mensagem: "A leitura das fotos falhou nesta rodada." }, 500);
    }
  }, corsHeaders);
});
