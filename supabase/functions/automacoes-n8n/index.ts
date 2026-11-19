// deno-lint-ignore-file no-explicit-any
/**
 * Central de Automações (19/11/2026): a única porta entre o painel e o n8n de produção.
 *
 * POST {acao:'coletar', ...retrato}       o coletor do VPS (cabeçalho x-coletor-chave; confere pelo sha256 no
 *                                          segredo AUTOMACOES_COLETOR_SHA256). Grava fluxos, execuções e saúde.
 * POST {acao:'ligar'|'desligar', fluxo_id, confirmar:true, motivo?}
 *                                          só admin do painel (sessão). Chama a API pública do n8n com a chave do
 *                                          segredo N8N_API_KEY, que nunca sai daqui, e registra quem e quando.
 *
 * Publicar com --no-verify-jwt: o coletor não tem sessão; a sessão do painel é conferida aqui.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { chaveConfere, ErroDeAutomacao, gravarRetrato, ligarDesligar } from '../_shared/automacoes.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': `${corsHeaders['Access-Control-Allow-Headers'] ?? 'authorization, x-client-info, apikey, content-type'}, x-coletor-chave` };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, erro: 'Use POST.' });
  const banco = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let corpo: any;
  try {
    corpo = await req.json();
  } catch {
    return json(400, { ok: false, erro: 'Corpo precisa ser JSON.' });
  }

  try {
    if (corpo?.acao === 'coletar') {
      const chave = req.headers.get('x-coletor-chave') ?? '';
      if (!(await chaveConfere(chave, Deno.env.get('AUTOMACOES_COLETOR_SHA256') ?? ''))) {
        return json(401, { ok: false, erro: 'Chave do coletor não confere.' });
      }
      const r = await gravarRetrato(banco, corpo);
      return json(200, { ok: true, ...r });
    }

    if (corpo?.acao === 'ligar' || corpo?.acao === 'desligar') {
      const auth = req.headers.get('authorization') ?? '';
      const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      const { data, error } = token ? await banco.auth.getUser(token) : { data: null, error: true };
      if (error || !data?.user) return json(401, { ok: false, erro: 'Entre no painel para ligar ou desligar.' });
      const uid = data.user.id;
      const { data: admin } = await banco.rpc('has_role', { _user_id: uid, _role: 'admin' });
      if (!admin) return json(403, { ok: false, erro: 'Só o dono liga e desliga fluxo.' });
      if (corpo.confirmar !== true) return json(400, { ok: false, erro: 'Confirme antes (confirmar: true).' });
      const fluxoId = String(corpo.fluxo_id ?? '').trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(fluxoId)) return json(400, { ok: false, erro: 'fluxo_id inválido.' });
      const { data: perfil } = await banco.from('profiles').select('full_name').eq('id', uid).maybeSingle();
      const r = await ligarDesligar(banco, {
        fluxoId, acao: corpo.acao, quemId: uid, quemNome: perfil?.full_name || data.user.email || 'dono', via: 'painel', motivo: corpo.motivo ?? null,
      });
      return json(200, r);
    }

    return json(400, { ok: false, erro: 'acao precisa ser coletar, ligar ou desligar.' });
  } catch (e) {
    if (e instanceof ErroDeAutomacao) return json(e.status, { ok: false, codigo: e.codigo, erro: e.message });
    console.error('[automacoes-n8n]', (e as Error)?.message);
    return json(500, { ok: false, erro: 'Falha inesperada na Central de Automações.' });
  }
});
