/**
 * Render pela fila (frente EDT, F1, 30/09/2026): ações da editor-video que
 * põem o pedido na fila (render_pedidos) e contam o andamento. Quem renderiza é
 * o worker da máquina da agência (workers/render); aqui nada de ffmpeg, Chromium
 * ou arquivo grande (2 s de CPU da Edge Function).
 *
 * - render_pedir { client_id, versao_id, tipo: render_final | amostra | onda, uid, revisao?, inicio_s?, fim_s?, fontes? }
 *     -> { pedido, ja_existia }. Um pedido por clique (uid) e um ativo por versão e tipo:
 *     pedir de novo devolve o que já está na fila. Sem custo (máquina da agência).
 * - render_status { client_id, versao_id | pedido_id } -> { pedidos, worker: { visto_em, situacao } }
 *     A tela chama no máximo a cada 15 s e só enquanto tem pedido ativo (sem laço aqui).
 * - render_cancelar { client_id, pedido_id } -> { pedido }
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { normalizarProjeto } from "../_shared/projeto-de-edicao.ts";
import { lerPedidoDeRender, situacaoDoWorker, CONSULTA_MINIMA_MS, type TipoDeRender } from "../_shared/render-do-editor.ts";

export interface ApoioDoRender {
  servico: () => SupabaseClient;
  garantirAcesso: (ch: unknown, clientId: string) => Promise<void>;
  json: (body: unknown, status?: number) => Response;
  erro: (status: number, codigo: string, mensagem: string, extra?: Record<string, unknown>) => Error;
  userId: (ch: unknown) => string;
  auditar: (ch: unknown, ferramenta: string, input: Record<string, unknown>, sucesso: boolean) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS = "id, client_id, versao_id, tipo, estado, etapa, progresso, entrada, resultado, saida_path, arquivo_id, erro_codigo, erro_mensagem, tentativas, worker, criado_em, iniciado_em, concluido_em, atualizado_em";

type Linha = Record<string, unknown> & { id: string; estado: string; saida_path: string | null };

function semTabela(e: { message?: string; code?: string } | null): boolean {
  const m = String((e && e.message) || "");
  return !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(m));
}

export function rotasDoRender(a: ApoioDoRender) {
  const faltaBanco = () => a.erro(503, "banco_sem_fila", "A fila de render ainda não foi ativada no banco (SQL da frente EDT). O ZIP continua funcionando.");
  const idDe = (v: unknown, nome: string) => {
    const s = String(v ?? "").trim();
    if (!UUID.test(s)) throw a.erro(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
    return s;
  };

  /** Link de uma hora para o arquivo pronto (só da pasta do cliente). */
  async function comLink(clientId: string, linhas: Linha[]): Promise<Record<string, unknown>[]> {
    const prontos = linhas.filter((l) => l.estado === "pronto" && l.saida_path && String(l.saida_path).indexOf(`${clientId}/`) === 0).map((l) => String(l.saida_path));
    const links: Record<string, string> = {};
    if (prontos.length) {
      const { data } = await a.servico().storage.from("mesa").createSignedUrls(prontos, 3600);
      ((data || []) as { path: string | null; signedUrl: string; error: string | null }[]).forEach((d) => {
        if (d.path && d.signedUrl && !d.error) links[d.path] = d.signedUrl;
      });
    }
    return linhas.map((l) => ({ ...l, url: l.saida_path ? links[String(l.saida_path)] || null : null }));
  }

  async function renderPedir(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const versaoId = idDe(corpo.versao_id, "versao_id");
    const { data: v, error } = await a.servico().from("video_versoes").select("id, client_id, projeto, estado").eq("id", versaoId).eq("client_id", clientId).maybeSingle();
    if (error) throw a.erro(503, "banco_indisponivel", "Não foi possível ler a versão agora.");
    if (!v) throw a.erro(404, "versao_inexistente", "Esta versão do vídeo não existe mais.");
    const projeto = normalizarProjeto((v as { projeto: unknown }).projeto);
    if (!projeto) throw a.erro(409, "sem_projeto", "Esta versão não tem projeto de edição.");
    const revisao = corpo.revisao === undefined || corpo.revisao === null ? null : Number(corpo.revisao);
    if (revisao !== null && isFinite(revisao) && revisao !== projeto.revisao) {
      throw a.erro(409, "projeto_nao_salvo", "O editor ainda está salvando. Espere aparecer \"Salvo\" e peça de novo.", { revisao_salva: projeto.revisao });
    }
    let pedido;
    try {
      pedido = lerPedidoDeRender(corpo, projeto.duracao_s);
    } catch (e) {
      throw a.erro(400, "pedido_invalido", e instanceof Error ? e.message : "Pedido inválido.");
    }
    if (pedido.tipo !== "onda" && projeto.duracao_s <= 0) throw a.erro(409, "linha_vazia", "A linha do tempo está vazia: nada para renderizar.");
    let entrada: Record<string, unknown> = {};
    if (pedido.tipo === "amostra") entrada = { inicio_s: pedido.inicio_s, fim_s: pedido.fim_s };
    if (pedido.tipo === "onda") {
      const chaves = pedido.fontes.length ? pedido.fontes : Object.keys(projeto.fontes).filter((k) => projeto.fontes[k].midia !== "imagem");
      const fontes = chaves
        .filter((k) => projeto.fontes[k] && projeto.fontes[k].storage_path && String(projeto.fontes[k].storage_path).indexOf(`${clientId}/`) === 0)
        .map((k) => ({ chave: k, bucket: projeto.fontes[k].storage_bucket || "mesa", caminho: projeto.fontes[k].storage_path }));
      if (!fontes.length) throw a.erro(409, "sem_fonte", "Nenhuma mídia deste cliente para medir a onda.");
      entrada = { fontes };
    }
    const linha = {
      client_id: clientId,
      versao_id: versaoId,
      tipo: pedido.tipo,
      uid: pedido.uid,
      projeto: pedido.tipo === "onda" ? null : projeto,
      revisao: projeto.revisao,
      entrada,
      criado_por: a.userId(ch),
    };
    const ins = await a.servico().from("render_pedidos").insert(linha).select(CAMPOS).single();
    if (!ins.error && ins.data) {
      await a.auditar(ch, "editor_render_pedir", { client_id: clientId, versao_id: versaoId, tipo: pedido.tipo }, true);
      return a.json({ pedido: ins.data, ja_existia: false, custo_usd: 0 });
    }
    if (semTabela(ins.error)) throw faltaBanco();
    if (!ins.error || ins.error.code !== "23505") throw a.erro(503, "banco_indisponivel", "Não foi possível pôr o pedido na fila agora.");
    // Idempotente: o mesmo clique ou um ativo da mesma versão e tipo.
    const mesmo = await a.servico().from("render_pedidos").select(CAMPOS).eq("client_id", clientId).eq("uid", pedido.uid).maybeSingle();
    if (mesmo.data) return a.json({ pedido: mesmo.data, ja_existia: true, custo_usd: 0 });
    const ativo = await a.servico().from("render_pedidos").select(CAMPOS).eq("versao_id", versaoId).eq("tipo", pedido.tipo as TipoDeRender).in("estado", ["fila", "rodando"]).maybeSingle();
    if (ativo.data) return a.json({ pedido: ativo.data, ja_existia: true, custo_usd: 0 });
    throw a.erro(409, "pedido_em_conflito", "Já há um pedido igual em andamento. Consulte o andamento.");
  }

  async function renderStatus(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    let q = a.servico().from("render_pedidos").select(CAMPOS).eq("client_id", clientId).order("criado_em", { ascending: false }).limit(8);
    if (corpo.pedido_id) q = q.eq("id", idDe(corpo.pedido_id, "pedido_id"));
    else q = q.eq("versao_id", idDe(corpo.versao_id, "versao_id"));
    const { data, error } = await q;
    if (semTabela(error)) throw faltaBanco();
    if (error) throw a.erro(503, "banco_indisponivel", "Não foi possível ler a fila agora.");
    const w = await a.servico().from("render_workers").select("nome, visto_em").order("visto_em", { ascending: false }).limit(1);
    const visto = w.data && (w.data as { visto_em: string }[])[0] ? (w.data as { visto_em: string }[])[0].visto_em : null;
    return a.json({
      pedidos: await comLink(clientId, (data || []) as Linha[]),
      worker: { visto_em: visto, situacao: situacaoDoWorker(visto, Date.now()) },
      proxima_consulta_ms: CONSULTA_MINIMA_MS,
    });
  }

  async function renderCancelar(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const id = idDe(corpo.pedido_id, "pedido_id");
    const { data, error } = await a
      .servico()
      .from("render_pedidos")
      .update({ estado: "cancelado", erro_codigo: "cancelado", erro_mensagem: "Cancelado pela equipe.", trava_token: null, trava_ate: null, concluido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
      .eq("id", id)
      .eq("client_id", clientId)
      .in("estado", ["fila", "rodando"])
      .select(CAMPOS)
      .maybeSingle();
    if (semTabela(error)) throw faltaBanco();
    if (error) throw a.erro(503, "banco_indisponivel", "Não foi possível cancelar agora.");
    if (!data) throw a.erro(409, "nao_cancelavel", "Este pedido já terminou (ou não existe).");
    await a.auditar(ch, "editor_render_cancelar", { client_id: clientId, pedido_id: id }, true);
    return a.json({ pedido: data });
  }

  return { render_pedir: renderPedir, render_status: renderStatus, render_cancelar: renderCancelar };
}
