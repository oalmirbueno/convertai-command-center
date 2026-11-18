/**
 * Central de Skills (18/11/2026): o núcleo usado pela função central-skills
 * (REST, painel e instalador) e pelas ferramentas do MCP.
 *
 * Regras puras no topo (sem banco, testáveis) e as operações no banco embaixo,
 * sempre recebendo o cliente service_role de quem chama.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const BUCKET = 'central-skills';
export const VERSAO_DA_CENTRAL = '1.0.0';
export const RUNTIMES = ['claude', 'codex', 'hermes', 'agents'] as const;
export type Runtime = typeof RUNTIMES[number];
/** Pacote máximo aceito por skill (o cliente tira mídia pesada antes). */
export const LIMITE_DO_PACOTE = 45 * 1024 * 1024;
export const LIMITE_DO_SKILL_MD = 400_000;

export const CATEGORIAS: Record<string, string> = {
  aceleriq: 'Aceleriq (da casa)',
  video: 'Vídeo e motion',
  design: 'Design e front',
  trafego: 'Tráfego pago',
  instagram: 'Instagram',
  youtube: 'YouTube',
  automacao: 'n8n e automação',
  programacao: 'Programação',
  memoria: 'Memória e contexto',
  navegador: 'Navegador e computador',
  escrita: 'Escrita e copy',
  pesquisa: 'Pesquisa',
  negocios: 'Negócios e operação',
  documentos: 'Documentos',
  agentes: 'Agentes e orquestração',
  outros: 'Outros',
};

/** Pastas de categoria do Hermes → categoria da Central. */
const PASTA_DO_HERMES: Record<string, string> = {
  'aceleriq-video': 'video', 'media-tools': 'video', media: 'video',
  'design-taste': 'design', 'aceleriq-n8n': 'automacao', 'aceleriq-dev': 'programacao',
  github: 'programacao', devops: 'programacao', research: 'pesquisa',
  'autonomous-ai-agents': 'agentes', 'gui-automation': 'navegador', 'cua-driver': 'navegador',
  'cua-spaces': 'navegador', 'note-taking': 'memoria', mcp: 'agentes',
};

/** Regras fixas por nome (a primeira que casa vence). */
const REGRAS: Array<[RegExp, string]> = [
  [/^(aceleriq|vendedor-whatsapp|documento-entrega|migracao-email|gatum|thaina|almir)/, 'aceleriq'],
  [/^(firecrawl|decodo|xurl|grounded-citations|llm-wiki|bioinformatics)/, 'pesquisa'],
  [/^(github|python-debugpy|systematic-debugging|test-driven|requesting-code-review|simplify-code|spike|merge-reconciler|release|version-bump|build-and-release|sdlc|oh-my-issues|pathfinder|wayfinder)/, 'programacao'],
  [/^(mkt-|pm-|ops-|chief-of-staff|owner-goals|weekly-review|meeting-action|document-to-action|teams-meeting|product-price|ai-local-business|whatsapp-antiban)/, 'negocios'],
  [/^(comfyui|p5js|sketch|excalidraw|ascii-art|meme|baoyu|pretext)/, 'design'],
  [/^(music|songsee|songwriting|sound-effects|text-to-speech|whisper|canal-noir|gif-search)/, 'video'],
  [/^(claude-code|codex|opencode|blackbox|antigravity|orchestrate|hermes|mode-creator|make-plan|plan$|do$|caveman|one-three-one|full-output|typesafe|aisa|session-librarian|request-progress|teach|ask-matt|mattpocock|ccs-align|claude-automation)/, 'agentes'],
  [/^(notion|airtable|google-workspace|microsoft-office|powerpoint|nano-pdf|ocr-and-documents|box$|apple-|himalaya|email-inbox|imessage|findmy|maps|openhue)/, 'documentos'],
  [/^(llama-cpp|serving-llms|huggingface|weights-and-biases|evaluating-llms)/, 'programacao'],
  [/^(gui-automation|blocked-page|inspecting-hermes|dogfood|screenpipe|hermes-desktop)/, 'navegador'],
  [/^(backup-setup|childhood|retro|what-the|wait-what)/, 'memoria'],
  [/^(ads|ads-.*|claude-ads|ad-creative|google-ads.*|memoria-de-conta-ads|google-analytics.*|lead-magnets)$/, 'trafego'],
  [/^(ig-|instagram)/, 'instagram'],
  [/^(yt-|youtube)/, 'youtube'],
  [/^(n8n-|using-n8n)/, 'automacao'],
  [/(hyperframes|remotion|video|ffmpeg|media-use|motion|trilha|reel|^watch|manim|music-to-video|slideshow|caption|faceless|overlay|pr-to-video|product-launch|edicao|hypit|sfx-)/, 'video'],
  [/(taste|design|brandkit|minimalist|brutalist|soft-skill|stitch|redesign|image-to-code|imagegen|high-end|liquid|polaris)/, 'design'],
  [/^(ego-browser|computer-use|cua|browser|chrome)/, 'navegador'],
  [/^(mem-search|obsidian|fechar-sessao|handoff|claude-handoff|knowledge-agent|timeline-report|weekly-digests|cloud-sync|how-it-works|smart-explore|learn-codebase|memory|consolidate-memory|import-memory)/, 'memoria'],
  [/^(writing-|humanizer|copy|ux-copy|draft-content|content-)/, 'escrita'],
  [/^(research|deep-research|competitor|yt-search|arxiv|blogwatcher)/, 'pesquisa'],
  [/^(tdd|diagnosing|code-review|codebase|domain-modeling|pr$|prototype|implement|to-spec|to-tickets|to-questionnaire|triage|grill|setup-|git-|resolving|improve-codebase|scaffold|migrate|wizard|debug|testing|architecture|reverse-engineer|shopify)/, 'programacao'],
  [/^(pdf|docx|xlsx|pptx|wowerpoint)/, 'documentos'],
  [/^(sales|finance|marketing|operations|small-business|product-management|standup|business)/, 'negocios'],
  [/(agent|workflow|loop|babysit|orquestr|composio|mcp)/, 'agentes'],
];

export function normalizarSlug(valor: unknown): string {
  const s = String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 80);
  return s;
}

export function slugValido(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(slug);
}

/** Lê name e description do frontmatter YAML simples do SKILL.md. */
export function lerFrontmatter(md: string): { name: string | null; description: string | null } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(md || '');
  if (!m) return { name: null, description: null };
  const bloco = m[1];
  const campo = (chave: string): string | null => {
    const re = new RegExp(`^${chave}:\\s*(.*)$`, 'm');
    const r = re.exec(bloco);
    if (!r) return null;
    let v = r[1].trim();
    // Bloco dobrado (>- ou |): junta as linhas recuadas seguintes.
    if (/^[>|][-+]?$/.test(v)) {
      const depois = bloco.slice(r.index + r[0].length).split(/\r?\n/);
      const linhas: string[] = [];
      for (const l of depois) {
        if (l.trim() === '') { if (linhas.length) linhas.push(''); continue; }
        if (!/^\s+/.test(l)) break;
        linhas.push(l.trim());
      }
      v = linhas.join(' ').replace(/\s+/g, ' ').trim();
    }
    v = v.replace(/^["']|["']$/g, '').trim();
    return v || null;
  };
  return { name: campo('name'), description: campo('description') };
}

export function categoriaDaSkill(slug: string, caminhos: string[] = []): string {
  for (const c of caminhos) {
    const partes = c.replace(/\\/g, '/').split('/');
    const i = partes.lastIndexOf('skills');
    const pasta = i >= 0 && partes.length > i + 2 ? partes[i + 1] : '';
    if (pasta && PASTA_DO_HERMES[pasta]) return PASTA_DO_HERMES[pasta];
  }
  const s = slug.replace(/^[a-z0-9-]+:/, '');
  for (const [re, cat] of REGRAS) if (re.test(s)) return cat;
  return 'outros';
}

export type Origem = { runtime: string; caminho: string; perfil?: string; maquina?: string; plugin?: string };

/** Junta a origem nova às já conhecidas sem repetir (runtime + máquina + caminho). */
export function juntarOrigens(atuais: unknown, nova: Origem | null): Origem[] {
  const lista: Origem[] = Array.isArray(atuais) ? (atuais as Origem[]).filter((o) => o && typeof o === 'object') : [];
  if (!nova) return lista;
  const chave = (o: Origem) => `${o.runtime}|${o.maquina ?? ''}|${o.caminho}`;
  if (!lista.some((o) => chave(o) === chave(nova))) lista.push(nova);
  return lista.slice(-40);
}

export function runtimesValidos(v: unknown): Runtime[] {
  const lista = Array.isArray(v) ? v.map((x) => String(x)) : [];
  const ok = lista.filter((x): x is Runtime => (RUNTIMES as readonly string[]).includes(x));
  return ok.length ? [...new Set(ok)] : [...RUNTIMES];
}

export function caminhoDoPacote(slug: string, hash: string): string {
  return `pacotes/${slug}/${hash.slice(0, 40)}.zip`;
}

/** Padrões de segredo que nunca podem entrar num SKILL.md publicado. */
const SEGREDOS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bmcp_live_[A-Za-z0-9_-]{16,}/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
];
export function temSegredo(texto: string): boolean {
  return SEGREDOS.some((re) => re.test(texto || ''));
}

export type PedidoDePublicacao = {
  slug: string;
  nome: string;
  descricao: string;
  categoria: string;
  /** true quando quem publicou escolheu a categoria (senão a já gravada é mantida). */
  categoria_explicita: boolean;
  tags: string[];
  runtimes: Runtime[];
  plugin: string | null;
  hash: string;
  tamanho_bytes: number;
  arquivos: number;
  skill_md: string;
  origem: Origem | null;
};

/** Valida e completa o pedido de publicação (nome e descrição saem do frontmatter quando faltam). */
export function montarPublicacao(corpo: Record<string, unknown>): { ok: true; pedido: PedidoDePublicacao } | { ok: false; erro: string } {
  const skillMd = String(corpo.skill_md ?? '');
  if (!skillMd.trim()) return { ok: false, erro: 'skill_md vazio: toda skill precisa do SKILL.md.' };
  if (skillMd.length > LIMITE_DO_SKILL_MD) return { ok: false, erro: `SKILL.md passa de ${LIMITE_DO_SKILL_MD} caracteres.` };
  if (temSegredo(skillMd)) return { ok: false, erro: 'O SKILL.md parece ter uma chave ou token. Tire o segredo e publique de novo.' };
  const fm = lerFrontmatter(skillMd);
  const slug = normalizarSlug(corpo.slug ?? fm.name ?? '');
  if (!slugValido(slug)) return { ok: false, erro: 'slug inválido (use letras minúsculas, números, ponto, hífen).' };
  const hash = String(corpo.hash ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{16,128}$/.test(hash)) return { ok: false, erro: 'hash inválido (sha256 em hexadecimal).' };
  const origemBruta = corpo.origem as Record<string, unknown> | undefined;
  const origem: Origem | null = origemBruta && typeof origemBruta === 'object' && origemBruta.runtime
    ? {
      runtime: String(origemBruta.runtime).slice(0, 30),
      caminho: String(origemBruta.caminho ?? '').slice(0, 300),
      ...(origemBruta.perfil ? { perfil: String(origemBruta.perfil).slice(0, 60) } : {}),
      ...(origemBruta.maquina ? { maquina: String(origemBruta.maquina).slice(0, 80) } : {}),
      ...(origemBruta.plugin ? { plugin: String(origemBruta.plugin).slice(0, 120) } : {}),
    }
    : null;
  const categoriaPedida = normalizarSlug(corpo.categoria ?? '');
  const categoria = CATEGORIAS[categoriaPedida] ? categoriaPedida : categoriaDaSkill(slug, origem ? [origem.caminho] : []);
  const tags = Array.isArray(corpo.tags) ? corpo.tags.map((t) => normalizarSlug(t)).filter(Boolean).slice(0, 12) : [];
  return {
    ok: true,
    pedido: {
      slug,
      nome: String(corpo.nome ?? fm.name ?? slug).slice(0, 120),
      descricao: String(corpo.descricao ?? fm.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 1500),
      categoria,
      categoria_explicita: Boolean(CATEGORIAS[categoriaPedida]),
      tags,
      runtimes: runtimesValidos(corpo.runtimes),
      plugin: corpo.plugin ? String(corpo.plugin).slice(0, 120) : null,
      hash,
      tamanho_bytes: Math.max(0, Math.floor(Number(corpo.tamanho_bytes ?? 0)) || 0),
      arquivos: Math.max(0, Math.floor(Number(corpo.arquivos ?? 0)) || 0),
      skill_md: skillMd,
      origem,
    },
  };
}

// ─── Banco ─────────────────────────────────────────────────────

const COLUNAS_DO_MANIFESTO =
  'slug, nome, descricao, categoria, tags, runtimes, plugin, hash, versao, tamanho_bytes, arquivos, status, pacote_path, atualizado_em, publicado_por';

export async function lerManifesto(banco: SupabaseClient, incluirArquivadas = false) {
  let q = banco.from('central_skills').select(COLUNAS_DO_MANIFESTO).order('categoria').order('slug').limit(3000);
  if (!incluirArquivadas) q = q.eq('status', 'ativa');
  const [skills, conectores] = await Promise.all([
    q,
    banco.from('central_conectores').select('slug, tipo, nome, descricao, instalar, requer, skills, status, atualizado_em')
      .eq('status', 'ativo').order('tipo').order('slug').limit(500),
  ]);
  if (skills.error) throw new Error(skills.error.message);
  if (conectores.error) throw new Error(conectores.error.message);
  return {
    versao_da_central: VERSAO_DA_CENTRAL,
    gerado_em: new Date().toISOString(),
    categorias: CATEGORIAS,
    skills: skills.data ?? [],
    conectores: conectores.data ?? [],
  };
}

export async function lerSkill(banco: SupabaseClient, slug: string) {
  const { data, error } = await banco.from('central_skills').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const versoes = await banco.from('central_skill_versoes')
    .select('versao, hash, publicado_por, origem, criado_em').eq('skill_id', data.id)
    .order('versao', { ascending: false }).limit(20);
  return { ...data, versoes: versoes.data ?? [] };
}

/** Link assinado de upload do pacote (o cliente manda o zip direto ao Storage). */
export async function prepararEnvio(banco: SupabaseClient, slug: string, hash: string) {
  const atual = await banco.from('central_skills').select('hash').eq('slug', slug).maybeSingle();
  if (atual.data?.hash === hash) return { igual: true as const };
  const path = caminhoDoPacote(slug, hash);
  const { data, error } = await banco.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error) throw new Error(`Storage: ${error.message}`);
  return { igual: false as const, pacote_path: path, upload_url: data.signedUrl, token: data.token };
}

async function pacoteExiste(banco: SupabaseClient, path: string): Promise<boolean> {
  const pasta = path.split('/').slice(0, -1).join('/');
  const nome = path.split('/').pop()!;
  const { data, error } = await banco.storage.from(BUCKET).list(pasta, { search: nome, limit: 5 });
  if (error) return false;
  return (data ?? []).some((f: { name: string }) => f.name === nome);
}

/** Grava a skill (nova versão só quando o hash muda). Devolve o que ficou. */
export async function publicarSkill(
  banco: SupabaseClient,
  pedido: PedidoDePublicacao,
  pacotePath: string | null,
  quem: string,
) {
  if (pacotePath) {
    if (pacotePath !== caminhoDoPacote(pedido.slug, pedido.hash)) throw new Error('pacote_path não confere com slug e hash.');
    if (!(await pacoteExiste(banco, pacotePath))) throw new Error('O pacote ainda não chegou ao Storage. Envie o zip pelo link de upload antes de publicar.');
  }
  const atual = await banco.from('central_skills').select('id, hash, versao, origens, pacote_path, status, categoria').eq('slug', pedido.slug).maybeSingle();
  if (atual.error) throw new Error(atual.error.message);
  const agora = new Date().toISOString();
  const origens = juntarOrigens(atual.data?.origens, pedido.origem);

  if (atual.data && atual.data.hash === pedido.hash) {
    // Mesmo conteúdo: só anota de onde mais ela veio.
    await banco.from('central_skills').update({ origens }).eq('id', atual.data.id);
    return { slug: pedido.slug, versao: atual.data.versao, mudou: false };
  }

  const versao = (atual.data?.versao ?? 0) + 1;
  const linha = {
    slug: pedido.slug,
    nome: pedido.nome,
    descricao: pedido.descricao,
    categoria: atual.data && !pedido.categoria_explicita ? atual.data.categoria : pedido.categoria,
    tags: pedido.tags,
    runtimes: pedido.runtimes,
    plugin: pedido.plugin,
    hash: pedido.hash,
    versao,
    tamanho_bytes: pedido.tamanho_bytes,
    arquivos: pedido.arquivos,
    skill_md: pedido.skill_md,
    pacote_path: pacotePath ?? atual.data?.pacote_path ?? null,
    origens,
    status: 'ativa',
    publicado_por: quem.slice(0, 120),
    atualizado_em: agora,
  };
  const gravado = atual.data
    ? await banco.from('central_skills').update(linha).eq('id', atual.data.id).select('id').single()
    : await banco.from('central_skills').insert(linha).select('id').single();
  if (gravado.error) throw new Error(gravado.error.message);
  const hist = await banco.from('central_skill_versoes').insert({
    skill_id: gravado.data.id,
    versao,
    hash: pedido.hash,
    pacote_path: linha.pacote_path,
    skill_md: pedido.skill_md,
    publicado_por: linha.publicado_por,
    origem: pedido.origem,
  });
  if (hist.error && !/duplicate/i.test(hist.error.message)) throw new Error(hist.error.message);
  return { slug: pedido.slug, versao, mudou: true };
}

export async function linksDeDownload(banco: SupabaseClient, slugs: string[]) {
  const { data, error } = await banco.from('central_skills').select('slug, hash, versao, pacote_path, skill_md')
    .in('slug', slugs.slice(0, 200));
  if (error) throw new Error(error.message);
  const saida: Array<{ slug: string; hash: string; versao: number; url: string | null; skill_md?: string }> = [];
  for (const s of data ?? []) {
    if (!s.pacote_path) { saida.push({ slug: s.slug, hash: s.hash, versao: s.versao, url: null, skill_md: s.skill_md }); continue; }
    const link = await banco.storage.from(BUCKET).createSignedUrl(s.pacote_path, 3600);
    saida.push({ slug: s.slug, hash: s.hash, versao: s.versao, url: link.data?.signedUrl ?? null, ...(link.data ? {} : { skill_md: s.skill_md }) });
  }
  return saida;
}

export async function mudarStatus(banco: SupabaseClient, slug: string, status: 'ativa' | 'arquivada') {
  const { data, error } = await banco.from('central_skills').update({ status, atualizado_em: new Date().toISOString() })
    .eq('slug', slug).select('slug, status').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export type Conector = {
  slug: string; tipo: 'plugin' | 'mcp' | 'composio'; nome: string; descricao: string;
  instalar: Record<string, string>; requer: string[]; skills: string[];
};

export function montarConector(c: Record<string, unknown>): { ok: true; conector: Conector } | { ok: false; erro: string } {
  const slug = String(c.slug ?? '').trim().toLowerCase().slice(0, 120);
  if (!/^[a-z0-9][a-z0-9._:@-]{0,119}$/.test(slug)) return { ok: false, erro: 'slug do conector inválido.' };
  const tipo = String(c.tipo ?? '');
  if (!['plugin', 'mcp', 'composio'].includes(tipo)) return { ok: false, erro: 'tipo deve ser plugin, mcp ou composio.' };
  const instalarBruto = (c.instalar && typeof c.instalar === 'object') ? c.instalar as Record<string, unknown> : {};
  const instalar: Record<string, string> = {};
  for (const [k, v] of Object.entries(instalarBruto)) instalar[k.slice(0, 20)] = String(v).slice(0, 2000);
  const tudo = JSON.stringify(instalar) + String(c.descricao ?? '');
  if (temSegredo(tudo)) return { ok: false, erro: 'O conector parece ter uma chave. Use só o NOME da variável em requer.' };
  return {
    ok: true,
    conector: {
      slug,
      tipo: tipo as Conector['tipo'],
      nome: String(c.nome ?? slug).slice(0, 120),
      descricao: String(c.descricao ?? '').slice(0, 1500),
      instalar,
      requer: Array.isArray(c.requer) ? c.requer.map((x) => String(x).replace(/[^A-Z0-9_]/gi, '').toUpperCase()).filter(Boolean).slice(0, 20) : [],
      skills: Array.isArray(c.skills) ? c.skills.map((x) => normalizarSlug(x)).filter(Boolean).slice(0, 200) : [],
    },
  };
}

export async function publicarConector(banco: SupabaseClient, c: Conector, quem: string) {
  const { error } = await banco.from('central_conectores').upsert({
    ...c, status: 'ativo', publicado_por: quem.slice(0, 120), atualizado_em: new Date().toISOString(),
  }, { onConflict: 'slug' });
  if (error) throw new Error(error.message);
  return { slug: c.slug };
}

export async function registrarMaquina(banco: SupabaseClient, m: Record<string, unknown>) {
  const maquina = String(m.maquina ?? '').trim().slice(0, 80);
  const agente = String(m.agente ?? '').trim().slice(0, 40);
  if (!maquina || !agente) throw new Error('maquina e agente são obrigatórios.');
  const { error } = await banco.from('central_maquinas').upsert({
    maquina,
    agente,
    versao_cliente: String(m.versao_cliente ?? '').slice(0, 20),
    instaladas: Math.max(0, Number(m.instaladas ?? 0) || 0),
    enviadas: Math.max(0, Number(m.enviadas ?? 0) || 0),
    detalhe: (m.detalhe && typeof m.detalhe === 'object') ? m.detalhe : {},
    ultima_sync: new Date().toISOString(),
  }, { onConflict: 'maquina,agente' });
  if (error) throw new Error(error.message);
  return { maquina, agente };
}

/** Comando de uma linha para instalar e manter a Central em cada sistema. */
export function comandosDeInstalacao(baseUrl: string) {
  const fn = `${baseUrl.replace(/\/$/, '')}/functions/v1/central-skills`;
  return {
    windows: `$env:ACELERIQ_CENTRAL_TOKEN="<sua chave mcp_live_>"; irm "${fn}?acao=instalador&so=windows" | iex`,
    linux_mac: `export ACELERIQ_CENTRAL_TOKEN="<sua chave mcp_live_>"; curl -fsSL "${fn}?acao=instalador&so=linux" | bash`,
    sincronizar_agora: 'python ~/.aceleriq/central.py sync',
    cliente_url: `${fn}?acao=cliente`,
  };
}
