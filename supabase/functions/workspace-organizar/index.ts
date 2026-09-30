/**
 * Organizador inteligente do Workspace do cliente (frente OR, 29/09/2026).
 *
 * O botão "Organizar" do Workspace passa por aqui, em cinco ações (equipe com
 * acesso ao cliente):
 * - preparar { client_id, parent_id?, tudo? }: sem IA. Lista o que entra
 *   (candidatos.ts), quantas imagens e vídeos serão lidos e o custo estimado
 *   pela tabela do catálogo (modelo de leitura).
 * - ler { client_id, itens: [{ id, quadro? }] }: centavos. Até 8 arquivos por
 *   chamada: confere o arquivo (quebrado sai antes de gastar), tira o hash
 *   (duplicata exata), usa a cópia leve (copias-leves, nada de abrir foto
 *   grande aqui) e lê por visão em lotes de até 4 (leitura.ts). Vídeo vai
 *   pelo quadro que a tela capturou (`quadro`, JPEG em base64). Com fôlego.
 * - propor { client_id, parent_id?, tudo?, lidos, falhas, ids? }: monta a
 *   prévia (organizador.ts) com as decisões do Jev. Nada muda.
 * - confirmar { client_id, parent_id?, grupos }: cria as pastas, move e
 *   renomeia (aplicar.ts) com a sessão de quem confirmou. Devolve o registro
 *   do Desfazer. Nunca apaga.
 * - desfazer { client_id, registro }: volta como estava.
 *
 * O trabalho mora em nucleo.ts; aqui ficam a sessão, o acesso e o HTTP.
 * Custos: a visão passa pelo motor (ia-motor.ts, carteira do cliente,
 * tarefa leitura_referencia) e o Jev pelo cobrarJev, os dois com o cliente
 * certo e a referência workspace_organizar.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { IaMotorErro } from "../_shared/ia-motor.ts";
import { JevErro } from "../_shared/jev.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { aplicarOrganizacao, desfazerOrganizacao, normalizarRegistro } from "./aplicar.ts";
import { normalizarConfirmacao } from "./organizador.ts";
import { bancoDoWorkspace, ErroHttp, lerNoCliente, MENSAGEM_MOTOR, pastaDoPedido, prepararNoCliente, proporNoCliente, servico, STATUS_MOTOR, UUID } from "./nucleo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const erro = (status: number, codigo: string, mensagem: string, detalhes: Record<string, unknown> = {}) => json({ error: codigo, mensagem, ...detalhes }, status);

type Chamador = { userId: string; doChamador: SupabaseClient };

async function identificar(req: Request): Promise<Chamador | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) return null;
  const { data: staff } = await servico().rpc("is_staff", { _user_id: userId });
  if (staff !== true) return null;
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, doChamador };
}

async function garantirAcesso(ch: Chamador, corpo: Record<string, unknown>): Promise<string> {
  const clientId = String(corpo.client_id ?? "");
  if (!UUID.test(clientId)) throw new ErroHttp(400, "cliente_invalido", "Cliente inválido.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "acesso_indisponivel", "Não foi possível conferir o acesso ao cliente.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
  return clientId;
}

async function confirmar(ch: Chamador, clientId: string, corpo: Record<string, unknown>) {
  const parentId = pastaDoPedido(corpo.parent_id);
  const grupos = normalizarConfirmacao(corpo.grupos);
  if (!grupos.length) throw new ErroHttp(400, "nada_para_confirmar", "Nenhum item ficou na prévia para organizar.");
  const r = await aplicarOrganizacao(bancoDoWorkspace(ch.doChamador, clientId, ch.userId), clientId, parentId, grupos);
  console.log("workspace-organizar: organização confirmada", { clientId, movidos: r.movidos, renomeados: r.renomeados, pastas: r.pastas_criadas, falhas: r.falhas.length });
  return r;
}

async function desfazer(ch: Chamador, clientId: string, corpo: Record<string, unknown>) {
  const registro = normalizarRegistro(corpo.registro, clientId);
  if (!registro) throw new ErroHttp(400, "registro_invalido", "Não há o que desfazer (o registro da organização não confere).");
  const r = await desfazerOrganizacao(bancoDoWorkspace(ch.doChamador, clientId, ch.userId), registro);
  console.log("workspace-organizar: organização desfeita", { clientId, restaurados: r.restaurados, pulados: r.pulados.length, pastas: r.pastas_tiradas });
  return r;
}

const ACOES: Record<string, (ch: Chamador, clientId: string, corpo: Record<string, unknown>) => Promise<unknown>> = {
  preparar: (_ch, clientId, corpo) => prepararNoCliente(clientId, corpo),
  ler: (ch, clientId, corpo) => lerNoCliente(clientId, ch.userId, corpo),
  propor: (ch, clientId, corpo) => proporNoCliente(clientId, ch.userId, corpo),
  confirmar,
  desfazer,
};
/** Ações longas (IA): respondem com fôlego para a plataforma não cortar em 150 s. */
const COM_FOLEGO = new Set(["ler", "propor"]);

function respostaDoErro(e: unknown, acao: string): Response {
  if (e instanceof ErroHttp) return erro(e.status, e.codigo, e.message);
  if (e instanceof IaMotorErro) {
    const status = STATUS_MOTOR[e.codigo] ?? e.status;
    return json({ ...(e.paraJson() as Record<string, unknown>), mensagem: MENSAGEM_MOTOR[e.codigo] ?? e.message }, status);
  }
  if (e instanceof JevErro) return erro(502, "jev_indisponivel", "O Jev não respondeu. Tente de novo.", { codigo: e.codigo });
  registrarFalha("workspace-organizar: falha inesperada", e, { acao });
  return erro(500, "erro_interno", "Erro inesperado no organizador. Tente de novo.");
}

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
  const chamador = ch;
  const trabalho = async () => {
    try {
      const clientId = await garantirAcesso(chamador, corpo);
      return json(await executar(chamador, clientId, corpo));
    } catch (e) {
      return respostaDoErro(e, acao);
    }
  };
  return COM_FOLEGO.has(acao) ? respostaComFolego(trabalho, corsHeaders) : await trabalho();
});
