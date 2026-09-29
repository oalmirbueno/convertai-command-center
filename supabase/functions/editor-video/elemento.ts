/**
 * gerar_elemento (frente EDT, F4): ícone ou objeto gerado com FUNDO
 * TRANSPARENTE para pôr por cima do vídeo. Pago: custo antes (elemento_estimar,
 * sem gasto) e o Confirmar do dono (elemento_gerar com custo_confirmado_usd e o
 * uid do clique). Idempotente pelo uid (o mesmo clique nunca gera duas vezes).
 * Logo e foto real do cliente NUNCA saem daqui: entram pelo código.
 *
 * - elemento_estimar { client_id, tipo } -> { custo_usd, modelo_id, modelo }
 * - elemento_gerar { client_id, tipo, prompt, uid, custo_confirmado_usd } -> { arquivo, custo_usd, saldo_usd, ja_existia }
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { aceitaFundoTransparente, chamarImagem, estimarComModelo, type ModeloIa } from "../_shared/ia-motor.ts";
import { escolherModeloDoElemento, promptDoElemento, TAMANHO_DO_ELEMENTO, type TipoDeElemento } from "./elemento-regras.ts";

export { promptDoElemento, TIPOS_DE_ELEMENTO } from "./elemento-regras.ts";

const UID = /^[A-Za-z0-9_-]{8,80}$/;

export interface ApoioDoElemento {
  servico: () => SupabaseClient;
  garantirAcesso: (ch: unknown, clientId: string) => Promise<void>;
  json: (body: unknown, status?: number) => Response;
  erro: (status: number, codigo: string, mensagem: string, extra?: Record<string, unknown>) => Error;
  userId: (ch: unknown) => string;
  folego: (f: () => Promise<Response>) => Response | Promise<Response>;
  respostaDeErro: (e: unknown) => Response;
}

export function rotasDoElemento(a: ApoioDoElemento) {
  async function modelo(): Promise<ModeloIa> {
    const { data, error } = await a.servico().from("ia_modelos").select("*").eq("tipo", "imagem").eq("ativo", true).limit(80);
    if (error) throw a.erro(503, "catalogo_indisponivel", "Não foi possível ler os modelos de imagem agora.");
    const m = escolherModeloDoElemento((data || []) as ModeloIa[], aceitaFundoTransparente);
    if (!m) throw a.erro(409, "sem_modelo_transparente", "Nenhum modelo de imagem ativo faz fundo transparente (GPT Image). Ative um no catálogo.");
    return m;
  }
  const tipoDe = (v: unknown): TipoDeElemento => (v === "objeto" ? "objeto" : "icone");
  const estimativa = (m: ModeloIa, prompt: string) => estimarComModelo(m, { imagens: 1, qualidade: "media", tokensEntrada: Math.ceil(prompt.length / 3.5), tamanho: TAMANHO_DO_ELEMENTO });

  async function elementoEstimar(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const m = await modelo();
    const custo = estimativa(m, promptDoElemento(tipoDe(corpo.tipo), String(corpo.prompt || "x")));
    return a.json({ custo_usd: custo, modelo_id: m.id, modelo: m.rotulo || m.modelo_api });
  }

  async function elementoGerar(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const tipo = tipoDe(corpo.tipo);
    const pedido = String(corpo.prompt || "").trim();
    if (pedido.length < 3) throw a.erro(400, "prompt_vazio", "Diga o que é o elemento.");
    const uid = String(corpo.uid || "");
    if (!UID.test(uid)) throw a.erro(400, "uid_invalido", "Pedido sem a marca do clique (uid).");
    const ja = await a.servico().from("video_arquivos").select("id, nome, storage_bucket, storage_path, tipo").eq("client_id", clientId).contains("origem", { uid }).maybeSingle();
    if (ja.data) return a.json({ arquivo: ja.data, custo_usd: 0, ja_existia: true });
    const m = await modelo();
    const prompt = promptDoElemento(tipo, pedido);
    const custo = estimativa(m, prompt);
    const mostrado = Number(corpo.custo_confirmado_usd);
    if (!isFinite(mostrado) || mostrado < 0) throw a.erro(409, "confirmar_custo", "Mostre o custo e confirme antes.", { custo_estimado: custo });
    if (custo > mostrado + 0.0001) throw a.erro(409, "custo_mudou", `O custo passou do mostrado: US$ ${custo.toFixed(4)}. Confirme de novo.`, { custo_estimado: custo });
    return a.folego(async () => {
      try {
        const r = await chamarImagem({ clientId, modeloId: m.id, prompt, referencias: [], qualidade: "media", tamanho: TAMANHO_DO_ELEMENTO, fundo: "transparente", mesmoModelo: true, tarefa: "estudio", agente: "gerador_imagem", referencia: { tipo: "editor_elemento", id: crypto.randomUUID() }, criadoPor: a.userId(ch) });
        const id = crypto.randomUUID();
        const caminho = `${clientId}/video/editor/elementos/${id}.png`;
        const up = await a.servico().storage.from("mesa").upload(caminho, new Blob([new Uint8Array(r.png)], { type: r.mime || "image/png" }), { contentType: r.mime || "image/png", upsert: false });
        if (up.error) throw a.erro(503, "armazenamento_falhou", "A imagem saiu (e foi cobrada), mas não subiu. Tente de novo: o mesmo clique não cobra outra vez.");
        const nome = `${tipo === "icone" ? "Ícone" : "Objeto"}: ${pedido.slice(0, 80)}`;
        const linha = { client_id: clientId, nome: nome.slice(0, 120), nome_original: `${id}.png`, storage_bucket: "mesa", storage_path: caminho, tipo: "elemento", mime: r.mime || "image/png", bytes: r.png.length, criado_por: a.userId(ch), origem: { uid, modelo: r.modeloId, custo_usd: r.custoUsd, gerado: "editor_elemento", fundo: "transparente" } };
        let ins = await a.servico().from("video_arquivos").insert(linha).select("id, nome, storage_bucket, storage_path, tipo").single();
        // Sem o SQL da frente EDT, o tipo "elemento" ainda não existe: guarda como quadro.
        if (ins.error && /video_arquivos_tipo_check/.test(String(ins.error.message || ""))) ins = await a.servico().from("video_arquivos").insert({ ...linha, tipo: "quadro" }).select("id, nome, storage_bucket, storage_path, tipo").single();
        if (ins.error || !ins.data) throw a.erro(503, "registro_falhou", "A imagem subiu, mas não entrou na Mídia. Ela está na pasta do editor.", { storage_path: caminho });
        return a.json({ arquivo: ins.data, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, ja_existia: false });
      } catch (e) {
        return a.respostaDeErro(e);
      }
    });
  }

  return { elemento_estimar: elementoEstimar, elemento_gerar: elementoGerar };
}
