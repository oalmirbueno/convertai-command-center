// deno-lint-ignore-file no-explicit-any
/**
 * Central de Skills (18/11/2026).
 *
 * Uma porta só para o catálogo de skills de todos os agentes e para o segundo
 * cérebro. Quem entra:
 *   - o painel (sessão da equipe; escrever exige admin ou gestor);
 *   - qualquer agente com chave MCP (Bearer mcp_live_...): memory:read lê,
 *     memory:write publica skill, conector e edita nota.
 *
 * GET  ?acao=instalador&so=windows|linux   script de instalação (público, sem segredo)
 * GET  ?acao=cliente                       o central.py (público, sem segredo)
 * GET  ?acao=manifesto                     catálogo (skills + conectores)
 * GET  ?acao=skill&slug=                   detalhe com SKILL.md e versões
 * GET  ?acao=maquinas                      quem sincronizou e quando
 * GET  ?acao=cerebro_arvore&prefixo=       árvore do segundo cérebro
 * GET  ?acao=cerebro_ler&caminho=          um arquivo do segundo cérebro
 * POST {acao:'preparar', slug, hash}       link de upload do pacote (ou igual:true)
 * POST {acao:'publicar', ...}              grava skill/versão
 * POST {acao:'baixar', slugs:[]}           links assinados dos pacotes
 * POST {acao:'conector', ...}              grava plugin/MCP/Composio
 * POST {acao:'maquina', ...}               registra a sincronização da máquina
 * POST {acao:'status', slug, status}       arquivar/restaurar (admin ou gestor)
 * POST {acao:'cerebro_salvar', caminho, conteudo, sha?}
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { authenticate, expandScopesLocal } from '../_shared/mcp-auth.ts';
import {
  getFile,
  listTree,
  SecondBrainError,
  writeNote,
} from '../_shared/second-brain-github.ts';
import {
  BUCKET,
  comandosDeInstalacao,
  lerManifesto,
  lerSkill,
  linksDeDownload,
  montarConector,
  montarPublicacao,
  mudarStatus,
  normalizarSlug,
  prepararEnvio,
  publicarConector,
  publicarSkill,
  registrarMaquina,
} from './modulos/nucleo.ts';
import { scriptDoInstalador } from './modulos/instalador.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
function texto(status: number, body: string, tipo = 'text/plain') {
  return new Response(body, { status, headers: { ...cors, 'Content-Type': `${tipo}; charset=utf-8`, 'Cache-Control': 'no-store' } });
}

type Quem = { nome: string; podeLer: boolean; podeEscrever: boolean; admin: boolean; via: 'painel' | 'chave' };

async function identificar(req: Request, banco: any): Promise<Quem | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  if (token.startsWith('mcp_')) {
    const r = await authenticate(req);
    if (!r.ok) return null;
    // Chave presa a um projeto e a um operador não usa a Central de Skills (negado por padrão).
    if (r.ctx.projectGrant) return null;
    const s = expandScopesLocal(r.ctx.scopes);
    const admin = s.has('admin');
    return {
      nome: `chave:${r.ctx.keyName}`,
      podeLer: admin || s.has('memory:read') || s.has('aceleriq:read'),
      podeEscrever: admin || s.has('memory:write'),
      admin: false, // chave de agente nunca edita memória consolidada
      via: 'chave',
    };
  }
  const { data, error } = await banco.auth.getUser(token);
  if (error || !data?.user) return null;
  const uid = data.user.id;
  const [staff, admin, manager] = await Promise.all([
    banco.rpc('is_staff', { _user_id: uid }),
    banco.rpc('has_role', { _user_id: uid, _role: 'admin' }),
    banco.rpc('has_role', { _user_id: uid, _role: 'manager' }),
  ]);
  const ehStaff = Boolean(staff.data);
  const ehAdmin = Boolean(admin.data);
  return {
    nome: `painel:${data.user.email ?? uid}`,
    podeLer: ehStaff || ehAdmin,
    podeEscrever: ehAdmin || Boolean(manager.data),
    admin: ehAdmin,
    via: 'painel',
  };
}

function erroDoCerebro(e: unknown) {
  if (e instanceof SecondBrainError) {
    const k = e.error.kind;
    const status = k === 'not_found' ? 404 : k === 'forbidden' ? 403 : k === 'conflict' ? 409
      : k === 'validation' || k === 'too_large' ? 400 : k === 'not_configured' ? 503 : 502;
    return json(status, { ok: false, erro: e.error });
  }
  return json(500, { ok: false, erro: String((e as Error)?.message ?? e) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  const banco = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    // ── Públicos: não trazem dado nenhum, só o código do cliente. ──
    if (req.method === 'GET') {
      const acao = url.searchParams.get('acao') ?? 'manifesto';
      if (acao === 'instalador') {
        const so = url.searchParams.get('so') === 'linux' ? 'linux' : 'windows';
        return texto(200, scriptDoInstalador(so, SUPABASE_URL));
      }
      if (acao === 'cliente') {
        const { data, error } = await banco.storage.from(BUCKET).download('cliente/central.py');
        if (error || !data) return texto(503, '# cliente ainda não publicado na Central\n');
        return texto(200, await data.text(), 'text/x-python');
      }
    }

    const quem = await identificar(req, banco);
    if (!quem) return json(401, { ok: false, erro: 'Mande Authorization: Bearer <chave mcp_live_ ou sessão do painel>.' });
    if (!quem.podeLer) return json(403, { ok: false, erro: 'A chave precisa de memory:read ou aceleriq:read.' });

    if (req.method === 'GET') {
      const acao = url.searchParams.get('acao') ?? 'manifesto';
      if (acao === 'manifesto') {
        const m = await lerManifesto(banco, url.searchParams.get('arquivadas') === '1');
        return json(200, { ok: true, ...m, instalar: comandosDeInstalacao(SUPABASE_URL) });
      }
      if (acao === 'skill') {
        const s = await lerSkill(banco, normalizarSlug(url.searchParams.get('slug')));
        return s ? json(200, { ok: true, skill: s }) : json(404, { ok: false, erro: 'skill não encontrada' });
      }
      if (acao === 'maquinas') {
        const { data, error } = await banco.from('central_maquinas').select('*').order('ultima_sync', { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        return json(200, { ok: true, maquinas: data ?? [] });
      }
      if (acao === 'cerebro_arvore') {
        try { return json(200, { ok: true, ...(await listTree(url.searchParams.get('prefixo') ?? '')) }); }
        catch (e) { return erroDoCerebro(e); }
      }
      if (acao === 'cerebro_ler') {
        try { return json(200, { ok: true, arquivo: await getFile(url.searchParams.get('caminho') ?? '') }); }
        catch (e) { return erroDoCerebro(e); }
      }
      return json(400, { ok: false, erro: `acao desconhecida: ${acao}` });
    }

    if (req.method !== 'POST') return json(405, { ok: false, erro: 'método não aceito' });
    const corpo = await req.json().catch(() => ({})) as Record<string, any>;
    const acao = String(corpo.acao ?? '');

    if (acao === 'baixar') {
      const slugs = (Array.isArray(corpo.slugs) ? corpo.slugs : []).map(normalizarSlug).filter(Boolean);
      return json(200, { ok: true, pacotes: await linksDeDownload(banco, slugs) });
    }
    if (acao === 'maquina') {
      return json(200, { ok: true, ...(await registrarMaquina(banco, corpo)) });
    }

    if (!quem.podeEscrever) return json(403, { ok: false, erro: 'Escrever na Central exige memory:write (ou admin/gestor no painel).' });

    if (acao === 'preparar') {
      const slug = normalizarSlug(corpo.slug);
      const hash = String(corpo.hash ?? '').toLowerCase();
      if (!slug || !/^[a-f0-9]{16,128}$/.test(hash)) return json(400, { ok: false, erro: 'slug e hash são obrigatórios.' });
      return json(200, { ok: true, ...(await prepararEnvio(banco, slug, hash)) });
    }
    if (acao === 'publicar') {
      const m = montarPublicacao(corpo);
      if (!m.ok) return json(400, { ok: false, erro: m.erro });
      const r = await publicarSkill(banco, m.pedido, corpo.pacote_path ? String(corpo.pacote_path) : null, quem.nome);
      return json(200, { ok: true, ...r });
    }
    if (acao === 'conector') {
      const c = montarConector(corpo);
      if (!c.ok) return json(400, { ok: false, erro: c.erro });
      return json(200, { ok: true, ...(await publicarConector(banco, c.conector, quem.nome)) });
    }
    if (acao === 'status') {
      if (quem.via !== 'painel') return json(403, { ok: false, erro: 'Arquivar e restaurar só pelo painel.' });
      const status = corpo.status === 'arquivada' ? 'arquivada' : 'ativa';
      const r = await mudarStatus(banco, normalizarSlug(corpo.slug), status);
      return r ? json(200, { ok: true, ...r }) : json(404, { ok: false, erro: 'skill não encontrada' });
    }
    if (acao === 'cerebro_salvar') {
      try {
        const r = await writeNote({
          path: String(corpo.caminho ?? ''),
          content: String(corpo.conteudo ?? ''),
          sha: corpo.sha ? String(corpo.sha) : null,
          message: corpo.mensagem ? String(corpo.mensagem) : undefined,
          author: quem.nome,
          admin: quem.admin,
        });
        return json(200, { ok: true, ...r });
      } catch (e) { return erroDoCerebro(e); }
    }
    return json(400, { ok: false, erro: `acao desconhecida: ${acao}` });
  } catch (e) {
    console.error('central-skills', e);
    return json(500, { ok: false, erro: String((e as Error)?.message ?? e) });
  }
});
