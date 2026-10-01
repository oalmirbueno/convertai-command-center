/**
 * motores-parear (frente SUP, 01/10/2026): pareamento de máquina do Aceleriq Motores.
 *
 * POST { acao: "gerar", nome?, motores? }          (admin, com a sessão do painel)
 *   -> { codigo: "ABCD-EFGH", id, expira_em, motores, validade_min }
 * POST { acao: "trocar", codigo, maquina: { nome, hostname, sistema } }   (instalador, sem login)
 *   -> { ok, supabase_url, chave_de_servico, maquina: { id, nome, motores }, pacote: { versao, sha256, tamanho, url } | null }
 *
 * verify_jwt = false: o instalador da máquina nova não tem sessão do painel; a
 * ação "gerar" confere a sessão e o papel admin aqui dentro. O código vale 10
 * min e uma vez (motores_pareamento_trocar), com limite de tentativas no banco.
 * A chave de serviço só sai na resposta 200 de uma troca, sem cache, e nunca
 * entra em log. O instalador a guarda no cofre DPAPI do Windows.
 * Revogar código, trocar motores e remover máquina: RPCs motores_admin_* na tela.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { criarTratador, type PacoteVigente } from "./modulos/pareamento.ts";

let cache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!cache) cache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return cache;
}

const chaveDeServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const tratar = criarTratador({
  supabaseUrl: (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, ""),
  chaveDeServico,
  segredo: Deno.env.get("MOTORES_PAREAR_SEGREDO") || chaveDeServico,
  rpc: async (nome, args) => {
    const { data, error } = await servico().rpc(nome, args);
    return { data, error: error ? { message: error.message, code: error.code } : null };
  },
  quem: async (token) => {
    const { data } = await servico().auth.getUser(token);
    const id = data?.user?.id;
    if (!id) return null;
    const admin = await servico().rpc("has_role", { _user_id: id, _role: "admin" });
    return { id, admin: admin.data === true };
  },
  pacote: async (): Promise<PacoteVigente | null> => {
    const { data, error } = await servico()
      .from("motores_versoes")
      .select("versao, sha256, caminho, tamanho")
      .is("retirada_em", null)
      .order("publicada_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const assinado = await servico().storage.from("motores-pacotes").createSignedUrl(String(data.caminho), 3600);
    if (assinado.error || !assinado.data?.signedUrl) throw new Error(assinado.error?.message || "sem URL do pacote");
    return { versao: String(data.versao), sha256: String(data.sha256), tamanho: data.tamanho === null ? null : Number(data.tamanho), url: assinado.data.signedUrl };
  },
  log: (onde, dados) => {
    if (/pareada$/.test(onde)) console.log(onde, dados);
    else registrarFalha(onde, new Error(String(dados.motivo || "falha")), dados);
  },
});

Deno.serve(tratar);
