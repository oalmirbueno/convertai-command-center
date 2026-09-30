/**
 * documentos, frente BRF2 (30/09/2026): a agenda dos documentos mensais
 * automáticos. No dia marcado, o cron monta o RASCUNHO do documento do mês
 * anterior (só com o que aconteceu, sem IA e sem custo) e avisa a equipe.
 * Gerar o PDF e mandar ao cliente continuam com Confirmar na tela.
 *
 * - agenda_ler { client_id } -> { agendas }
 * - agenda_salvar { client_id, marca_id?, ligada, dia, modelo } -> { agenda }
 * - agenda_cron (só com x-cron-secret; sem usuário) -> { olhadas, preparados, sem_eventos, falhas }
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { marcasDoCliente } from "../_shared/marca.ts";
import { registrarEntregaNoBanco } from "../_shared/registro-de-entrega.ts";
import { ehModeloDeDocumento, mesParaGerar, rotuloDoMesDeReferencia } from "../_shared/documento-modelos.ts";
import { coletarDaLinha, type LinhaComRascunho, rascunhoDaLinha } from "./rascunho.ts";

const CAMPOS_DA_AGENDA = "id, client_id, marca_id, ligada, dia, modelo, ultimo_mes, ultima_execucao_em, ultimo_erro, ligada_em, atualizado_em";
const CAMPOS_DA_LINHA = "id, client_id, marca_id, tipo, referencia, titulo, status, gancho, modelo, rascunho";
/** Clientes por chamada do cron (cada um lê o banco inteiro do mês; o próximo dia pega o resto). */
const POR_CHAMADA = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AgendaNaTela = { id: string; client_id: string; marca_id: string | null; ligada: boolean; dia: number; modelo: string; ultimo_mes: string | null; ultima_execucao_em: string | null; ultimo_erro: string | null };

export async function lerAgendas(s: SupabaseClient, clientId: string): Promise<AgendaNaTela[]> {
  const { data, error } = await s.from("documentos_agenda").select(CAMPOS_DA_AGENDA).eq("client_id", clientId).order("criado_em", { ascending: true });
  if (error) throw error;
  return (data as AgendaNaTela[] | null) ?? [];
}

/** Liga, desliga ou muda a agenda de uma marca (uma por cliente e marca). */
export async function salvarAgenda(s: SupabaseClient, userId: string, corpo: Record<string, unknown>): Promise<AgendaNaTela> {
  const clientId = String(corpo.client_id || "");
  const marcaId = corpo.marca_id ? String(corpo.marca_id) : null;
  if (marcaId && !UUID.test(marcaId)) throw new Error("marca_id precisa ser um UUID.");
  if (marcaId) {
    const marcas = await marcasDoCliente(s, clientId);
    if (!marcas.some((m) => m.id === marcaId)) throw new Error("Esta marca não é deste cliente.");
  }
  const dia = Math.max(1, Math.min(28, Math.round(Number(corpo.dia) || 3)));
  const modelo = ehModeloDeDocumento(corpo.modelo) ? corpo.modelo : "mensal";
  const ligada = corpo.ligada === true;
  let q = s.from("documentos_agenda").select("id").eq("client_id", clientId);
  q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);
  const { data: existente, error: e1 } = await q.maybeSingle();
  if (e1) throw e1;
  const agora = new Date().toISOString();
  const campos = { ligada, dia, modelo, atualizado_em: agora, ...(ligada ? { ligada_por: userId, ligada_em: agora } : {}) };
  const r = existente
    ? await s.from("documentos_agenda").update(campos).eq("id", (existente as { id: string }).id).select(CAMPOS_DA_AGENDA).single()
    : await s.from("documentos_agenda").insert({ client_id: clientId, marca_id: marcaId, ...campos }).select(CAMPOS_DA_AGENDA).single();
  if (r.error || !r.data) throw r.error || new Error("agenda não gravada");
  return r.data as AgendaNaTela;
}

/** O passo do cron: prepara o rascunho do mês anterior de quem está no dia. */
export async function rodarAgenda(s: SupabaseClient, agora = new Date()): Promise<{ olhadas: number; preparados: number; sem_eventos: number; falhas: number }> {
  const { data, error } = await s.from("documentos_agenda").select(CAMPOS_DA_AGENDA).eq("ligada", true).order("ultima_execucao_em", { ascending: true, nullsFirst: true }).limit(200);
  if (error) throw error;
  const pendentes = ((data as AgendaNaTela[] | null) ?? []).filter((a) => !!mesParaGerar(agora, a.dia, a.ultimo_mes)).slice(0, POR_CHAMADA);
  const r = { olhadas: pendentes.length, preparados: 0, sem_eventos: 0, falhas: 0 };
  for (const a of pendentes) {
    const mes = mesParaGerar(agora, a.dia, a.ultimo_mes) as string;
    const marcar = (campos: Record<string, unknown>) => s.from("documentos_agenda").update({ ultimo_mes: mes, ultima_execucao_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), ...campos }).eq("id", a.id);
    try {
      const reg = await registrarEntregaNoBanco(s, { client_id: a.client_id, marca_id: a.marca_id, tipo: "mes_de_pautas", referencia: mes }, null, CAMPOS_DA_LINHA);
      if (reg.erro || !reg.linha) throw reg.erro || new Error("linha do documento não criada");
      const linha = reg.linha as unknown as LinhaComRascunho & { status: string };
      // Já tem rascunho ou PDF: a equipe já cuidou deste mês.
      if (linha.rascunho || linha.status !== "pendente") {
        await marcar({ ultimo_erro: null });
        continue;
      }
      const { coleta } = await coletarDaLinha(s, linha);
      if (!coleta.eventos.length) {
        r.sem_eventos += 1;
        await marcar({ ultimo_erro: "Nada registrado no painel neste mês." });
        continue;
      }
      const rascunho = rascunhoDaLinha(linha, coleta, a.modelo);
      const { error: e2 } = await s.from("documentos_entrega").update({
        rascunho,
        modelo: rascunho.modelo,
        titulo: linha.titulo || rascunho.titulo || coleta.titulo,
        rascunho_em: new Date().toISOString(),
        origem_rascunho: "agenda",
        atualizado_em: new Date().toISOString(),
      }).eq("id", linha.id);
      if (e2) throw e2;
      const { error: e3 } = await s.rpc("avisar_equipe_do_cliente", {
        _client_id: a.client_id,
        _message: `Rascunho do documento de ${rotuloDoMesDeReferencia(mes)} pronto: ${coleta.eventos.length} itens do painel. Confira, ajuste e gere o PDF.`,
        _type: "update",
        _link: `/arquivos?client=${a.client_id}&folder=entregas&documento=${linha.id}`,
      });
      if (e3) registrarFalha("documentos: aviso do rascunho mensal não saiu", e3, { client_id: a.client_id });
      await marcar({ ultimo_erro: e3 ? "Rascunho pronto, mas o aviso da equipe falhou." : null });
      r.preparados += 1;
    } catch (e) {
      r.falhas += 1;
      registrarFalha("documentos: agenda mensal falhou", e, { agenda_id: a.id, client_id: a.client_id, mes });
      // Não marca o mês: amanhã tenta de novo, com o motivo à vista na tela.
      await s.from("documentos_agenda").update({ ultima_execucao_em: new Date().toISOString(), ultimo_erro: (e instanceof Error ? e.message : "Falhou.").slice(0, 300) }).eq("id", a.id);
    }
  }
  return r;
}

/**
 * O pg_cron chama a função com x-cron-secret (sem usuário): só a ação
 * agenda_cron roda. null = não é o cron (segue o caminho da equipe).
 */
export async function respostaDoCron(req: Request, json: (b: unknown, s?: number) => Response): Promise<Response | null> {
  const segredo = (Deno.env.get("CRON_SECRET") || "").trim();
  if (!segredo || (req.headers.get("x-cron-secret") || "").trim() !== segredo) return null;
  let corpo: Record<string, unknown> = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio */ }
  if (String(corpo.acao ?? "") !== "agenda_cron") return json({ error: "acao_desconhecida", mensagem: "O cron só roda a agenda mensal." }, 400);
  try {
    const s = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    return json(await rodarAgenda(s));
  } catch (e) {
    registrarFalha("documentos: agenda_cron falhou", e);
    return json({ error: "agenda_falhou", mensagem: "A agenda mensal falhou; o motivo está no log." }, 500);
  }
}
