/**
 * MCP 2.32.0 (18/11/2026): Central de Skills e segundo cérebro em tempo real.
 *
 * Qualquer agente que entra pelo MCP vê o catálogo único de skills (Claude,
 * Codex, Hermes, plugins e as da casa), pega o SKILL.md e o pacote de cada uma,
 * recebe o comando que instala e mantém tudo sincronizado na máquina dele,
 * publica skill nova e lê/edita notas do segundo cérebro sem outra conexão.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import { strToU8, zipSync } from 'https://esm.sh/fflate@0.8.2';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { db } from './aceleriq-read-services.ts';
import { listTree, SecondBrainError, writeNote } from '../../_shared/second-brain-github.ts';
import {
  BUCKET,
  caminhoDoPacote,
  CATEGORIAS,
  comandosDeInstalacao,
  lerManifesto,
  lerSkill,
  linksDeDownload,
  montarPublicacao,
  normalizarSlug,
  publicarSkill,
  RUNTIMES,
  temSegredo,
} from '../../central-skills/modulos/nucleo.ts';

const LEITURA = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const ESCRITA = { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true };
const SUPABASE_URL = () => Deno.env.get('SUPABASE_URL') ?? '';

const erroDeEntrada = (e: z.ZodError) => new Error(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);

function erroDoCerebro(e: unknown): Error {
  if (e instanceof SecondBrainError) {
    const d = e.error as Record<string, unknown>;
    return new Error(`segundo cérebro: ${d.kind}${d.detail ? ` (${d.detail})` : ''}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** Pasta onde cada agente lê as skills (para quem instala na mão). */
export const PASTAS_DOS_AGENTES: Record<string, string> = {
  claude: '~/.claude/skills/<slug>/',
  codex: '~/.codex/skills/<slug>/',
  hermes: '~/.hermes/skills/central-<categoria>/<slug>/',
  agents: '~/.agents/skills/<slug>/ (Cursor, Gemini CLI, OpenCode e outros que leem ~/.agents)',
};

// ─── Listar ──────────────────────────────────────────────────

const listarSchema = z.object({
  categoria: z.string().max(40).optional(),
  busca: z.string().max(120).optional(),
  runtime: z.enum(RUNTIMES).optional(),
  conectores: z.boolean().optional(),
  limite: z.number().int().min(1).max(1000).optional(),
}).strict();

export function filtrarSkills(
  skills: Array<Record<string, any>>,
  f: { categoria?: string; busca?: string; runtime?: string },
) {
  const busca = (f.busca ?? '').trim().toLowerCase();
  return skills.filter((s) =>
    (!f.categoria || s.categoria === f.categoria)
    && (!f.runtime || (s.runtimes ?? []).includes(f.runtime))
    && (!busca || `${s.slug} ${s.nome} ${s.descricao} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(busca))
  );
}

const listarTool: ToolDefinition = {
  name: 'aceleriq_central_skills',
  title: 'Central de Skills: catálogo',
  description:
    'Só leitura. O catálogo único das skills de todos os agentes (Claude Code, Codex, Hermes, plugins e as da Aceleriq), organizado por categoria, com versão, para quais agentes vale e, com conectores:true, os plugins, servidores MCP e a Composio com o jeito de instalar (só nomes de variáveis, nunca chaves). Traz também o comando de uma linha que instala e mantém a Central sincronizada na máquina. Ao conectar pela primeira vez numa máquina com terminal, rode esse comando (ou aceleriq_central_instalar). Filtros: categoria, busca, runtime (claude, codex, hermes, agents). Exige memory:read ou aceleriq:read.',
  scopes: ['memory:read', 'aceleriq:read'],
  annotations: LEITURA,
  cacheSeg: 30,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      categoria: { type: 'string', enum: Object.keys(CATEGORIAS) },
      busca: { type: 'string', description: 'Texto no nome, descrição ou tags.' },
      runtime: { type: 'string', enum: [...RUNTIMES] },
      conectores: { type: 'boolean', description: 'true inclui plugins, MCP e Composio.' },
      limite: { type: 'integer', minimum: 1, maximum: 1000, description: 'Padrão 400.' },
    },
  },
  handler: async (input) => {
    const p = listarSchema.safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    const m = await lerManifesto(db());
    const filtradas = filtrarSkills(m.skills as Array<Record<string, any>>, p.data);
    const porCategoria: Record<string, number> = {};
    for (const s of m.skills as Array<Record<string, any>>) porCategoria[s.categoria] = (porCategoria[s.categoria] ?? 0) + 1;
    return {
      total: m.skills.length,
      encontradas: filtradas.length,
      por_categoria: porCategoria,
      categorias: CATEGORIAS,
      skills: filtradas.slice(0, p.data.limite ?? 400).map((s) => ({
        slug: s.slug,
        nome: s.nome,
        descricao: String(s.descricao ?? '').slice(0, 220),
        categoria: s.categoria,
        versao: s.versao,
        runtimes: s.runtimes,
        ...(s.plugin ? { plugin: s.plugin } : {}),
        atualizado_em: s.atualizado_em,
      })),
      ...(p.data.conectores ? { conectores: m.conectores } : {}),
      instalar: comandosDeInstalacao(SUPABASE_URL()),
      proximo_passo: 'Para usar uma skill agora: aceleriq_central_skill com o slug (traz o SKILL.md). Para instalar tudo na máquina: aceleriq_central_instalar.',
    };
  },
};

// ─── Uma skill ───────────────────────────────────────────────

const umaSchema = z.object({ slug: z.string().min(1).max(80), com_pacote: z.boolean().optional() }).strict();

const umaTool: ToolDefinition = {
  name: 'aceleriq_central_skill',
  title: 'Central de Skills: uma skill',
  description:
    'Só leitura. Uma skill da Central pelo slug: o SKILL.md inteiro (para seguir as instruções na hora, mesmo sem instalar), descrição, categoria, versões recentes e, com com_pacote:true, um link de 1 hora para baixar o zip completo (scripts e referências) e a pasta onde cada agente lê. Exige memory:read ou aceleriq:read.',
  scopes: ['memory:read', 'aceleriq:read'],
  annotations: LEITURA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['slug'],
    properties: {
      slug: { type: 'string', description: 'Slug da skill (veja aceleriq_central_skills).' },
      com_pacote: { type: 'boolean', description: 'true traz o link do zip completo (1 hora).' },
    },
  },
  handler: async (input) => {
    const p = umaSchema.safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    const banco = db();
    const s = await lerSkill(banco, normalizarSlug(p.data.slug));
    if (!s) throw new Error(`Skill ${p.data.slug} não está na Central. Procure com aceleriq_central_skills (busca).`);
    const pacote = p.data.com_pacote ? (await linksDeDownload(banco, [s.slug]))[0]?.url ?? null : undefined;
    return {
      slug: s.slug,
      nome: s.nome,
      descricao: s.descricao,
      categoria: s.categoria,
      versao: s.versao,
      runtimes: s.runtimes,
      plugin: s.plugin,
      status: s.status,
      arquivos: s.arquivos,
      tamanho_bytes: s.tamanho_bytes,
      skill_md: s.skill_md,
      ...(pacote !== undefined ? { pacote_url: pacote, onde_instalar: PASTAS_DOS_AGENTES } : {}),
      versoes: s.versoes,
    };
  },
};

// ─── Instalar ────────────────────────────────────────────────

const instalarSchema = z.object({
  agente: z.string().max(40).optional(),
  sistema: z.enum(['windows', 'linux', 'macos']).optional(),
}).strict();

export function guiaDeInstalacao(baseUrl: string, sistema: 'windows' | 'linux' | 'macos' = 'windows', agente = '') {
  const cmd = comandosDeInstalacao(baseUrl);
  return {
    comando: sistema === 'windows' ? cmd.windows : cmd.linux_mac,
    o_que_faz: [
      'Baixa ~/.aceleriq/central.py (só Python 3, sem dependências).',
      'Sobe para a Central as skills desta máquina que ainda não estão lá (e as que você mudou).',
      'Instala em cada agente desta máquina (Claude Code, Codex, Hermes, ~/.agents) as skills que faltam ou estão velhas.',
      'Registra plugins e servidores MCP desta máquina como conectores (só nome e como instalar, nunca chave).',
      'Liga a sincronização a cada 30 min (tarefa agendada ou cron) e no início de cada sessão do Claude Code.',
      'Escreve o aviso da Central em ~/.claude/CLAUDE.md e ~/.codex/AGENTS.md, para todo agente local saber.',
    ],
    chave: 'A chave vem de ACELERIQ_CENTRAL_TOKEN: a mesma chave mcp_live_ deste conector, com memory:read e memory:write. Nunca escreva a chave em arquivo do projeto, log ou mensagem.',
    sem_terminal: 'Sem terminal (ChatGPT, Claude.ai): use aceleriq_central_skill para ler o SKILL.md e seguir as instruções na hora.',
    depois: cmd.sincronizar_agora,
    pastas: PASTAS_DOS_AGENTES,
    ...(agente ? { agente } : {}),
  };
}

const instalarTool: ToolDefinition = {
  name: 'aceleriq_central_instalar',
  title: 'Central de Skills: instalar nesta máquina',
  description:
    'Só leitura. Devolve o comando de uma linha (Windows ou Linux/macOS) que instala todas as skills da Central em todos os agentes da máquina e deixa a sincronização automática ligada (a cada 30 min e no início de cada sessão), mais o que ele faz e onde cada agente lê as skills. Agente com terminal: rode o comando uma vez ao conectar. Exige memory:read ou aceleriq:read.',
  scopes: ['memory:read', 'aceleriq:read'],
  annotations: LEITURA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      agente: { type: 'string', description: 'Quem está instalando (claude-code, codex, hermes, cursor...).' },
      sistema: { type: 'string', enum: ['windows', 'linux', 'macos'], description: 'Padrão windows.' },
    },
  },
  handler: async (input) => {
    const p = instalarSchema.safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    return guiaDeInstalacao(SUPABASE_URL(), p.data.sistema ?? 'windows', p.data.agente ?? '');
  },
};

// ─── Publicar ────────────────────────────────────────────────

const arquivoSchema = z.object({ caminho: z.string().min(1).max(200), conteudo: z.string().max(1_000_000) }).strict();
const publicarSchema = z.object({
  slug: z.string().max(80).optional(),
  skill_md: z.string().min(20).max(400_000),
  arquivos: z.array(arquivoSchema).max(40).optional(),
  categoria: z.string().max(40).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  runtimes: z.array(z.enum(RUNTIMES)).max(4).optional(),
  agente: z.string().min(2).max(60),
}).strict();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mesmo hash do central.py: sha256 de "caminho\0sha256(arquivo)\n" em ordem. */
export async function hashDosArquivos(arquivos: Record<string, Uint8Array>): Promise<string> {
  let texto = '';
  for (const rel of Object.keys(arquivos).sort()) texto += `${rel}\0${await sha256Hex(arquivos[rel])}\n`;
  return await sha256Hex(new TextEncoder().encode(texto));
}

export function caminhoSeguro(c: string): string | null {
  const p = c.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || p.startsWith('/') || p.split('/').some((s) => s === '..' || s === '' || s === '.')) return null;
  if (p === 'SKILL.md') return null; // o SKILL.md vem no campo próprio
  return p;
}

const publicarTool: ToolDefinition = {
  name: 'aceleriq_central_publicar_skill',
  title: 'Central de Skills: publicar skill',
  description:
    'Cria ou atualiza uma skill na Central para todos os agentes. Mande o SKILL.md (com frontmatter name e description) e, se houver, até 40 arquivos de texto (scripts, referências) com caminho relativo. Mesmo conteúdo não gera versão nova; conteúdo novo vira versão N+1 e a anterior fica no histórico. Recusa texto com chave ou token. Skill grande ou com binários: publique pela máquina com `python ~/.aceleriq/central.py sync`. Exige memory:write.',
  scopes: ['memory:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['skill_md', 'agente'],
    properties: {
      slug: { type: 'string', description: 'Opcional: sai do name do frontmatter.' },
      skill_md: { type: 'string', description: 'O SKILL.md inteiro.' },
      arquivos: {
        type: 'array',
        maxItems: 40,
        items: {
          type: 'object', additionalProperties: false, required: ['caminho', 'conteudo'],
          properties: { caminho: { type: 'string' }, conteudo: { type: 'string' } },
        },
      },
      categoria: { type: 'string', enum: Object.keys(CATEGORIAS) },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      runtimes: { type: 'array', items: { type: 'string', enum: [...RUNTIMES] }, description: 'Padrão: todos.' },
      agente: { type: 'string', description: 'Quem publica (claude-code, codex, hermes-helena...).' },
    },
  },
  handler: async (input, ctx: AuthContext) => {
    const p = publicarSchema.safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    const arquivos: Record<string, Uint8Array> = { 'SKILL.md': strToU8(p.data.skill_md) };
    let total = arquivos['SKILL.md'].length;
    for (const a of p.data.arquivos ?? []) {
      const c = caminhoSeguro(a.caminho);
      if (!c) throw new Error(`Caminho inválido: ${a.caminho}`);
      arquivos[c] = strToU8(a.conteudo);
      total += arquivos[c].length;
    }
    if (total > 2_000_000) throw new Error('Passa de 2 MB pelo MCP: publique pela máquina com central.py sync.');
    const textos = Object.values(arquivos).map((b) => new TextDecoder().decode(b)).join('\n');
    const hash = await hashDosArquivos(arquivos);
    const m = montarPublicacao({
      slug: p.data.slug,
      skill_md: p.data.skill_md,
      categoria: p.data.categoria,
      tags: p.data.tags,
      runtimes: p.data.runtimes,
      hash,
      tamanho_bytes: total,
      arquivos: Object.keys(arquivos).length,
      origem: { runtime: 'mcp', caminho: p.data.agente, maquina: ctx.keyName },
    });
    if (!m.ok) throw new Error(m.erro);
    if (temSegredo(textos)) throw new Error('Um dos arquivos parece ter chave ou token. Tire o segredo e publique de novo.');
    const banco = db();
    const path = caminhoDoPacote(m.pedido.slug, hash);
    const up = await banco.storage.from(BUCKET).upload(path, zipSync(arquivos, { level: 6 }), {
      contentType: 'application/zip', upsert: true,
    });
    if (up.error) throw new Error(`Storage: ${up.error.message}`);
    const r = await publicarSkill(banco, m.pedido, path, `mcp:${ctx.keyName}:${p.data.agente}`);
    if (ctx.resultRefHolder) ctx.resultRefHolder.value = `central_skills:${r.slug}`;
    return {
      ...r,
      onde: 'Painel > Agentes > Skills e cérebro',
      chega_nos_agentes: 'Na próxima sincronização de cada máquina (até 30 min) ou agora com python ~/.aceleriq/central.py sync.',
    };
  },
};

// ─── Segundo cérebro ─────────────────────────────────────────

const arvoreSchema = z.object({ prefixo: z.string().max(200).optional(), limite: z.number().int().min(1).max(3000).optional() }).strict();

const arvoreTool: ToolDefinition = {
  name: 'aceleriq_cerebro_arvore',
  title: 'Segundo cérebro: pastas e arquivos',
  description:
    'Só leitura. A árvore do segundo cérebro (memory/, obsidian-vault/, docs/...), com tamanho e sha de cada arquivo, filtrada por prefixo. Leia um arquivo com memory_fetch e edite com aceleriq_cerebro_salvar_nota. Exige memory:read ou aceleriq:read.',
  scopes: ['memory:read', 'aceleriq:read'],
  annotations: LEITURA,
  cacheSeg: 20,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prefixo: { type: 'string', description: 'Ex.: obsidian-vault/30-Clientes/ ou memory/inbox/.' },
      limite: { type: 'integer', minimum: 1, maximum: 3000, description: 'Padrão 500.' },
    },
  },
  handler: async (input) => {
    const p = arvoreSchema.safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    try {
      const t = await listTree(p.data.prefixo ?? '');
      const limite = p.data.limite ?? 500;
      return { branch: t.branch, total: t.entries.length, truncado: t.truncated || t.entries.length > limite, itens: t.entries.slice(0, limite) };
    } catch (e) { throw erroDoCerebro(e); }
  },
};

const salvarSchema = z.object({
  caminho: z.string().min(3).max(256),
  conteudo: z.string().max(250_000),
  sha: z.string().max(64).optional(),
  mensagem: z.string().max(120).optional(),
  agente: z.string().min(2).max(60),
}).strict();

const salvarTool: ToolDefinition = {
  name: 'aceleriq_cerebro_salvar_nota',
  title: 'Segundo cérebro: criar ou editar nota',
  description:
    'Cria ou edita, na hora, um arquivo do segundo cérebro (nota do Obsidian, inbox, docs, work...). Cada gravação vira um commit com o nome do agente (dá para voltar). Para editar, leia antes com memory_fetch e mande o sha que veio; sem sha só cria arquivo novo. Memória consolidada (MEMORY.md, memory/now.md, decisions, lessons, pending, projects/, context/, AGENTS.md) continua com a revisão diária: ali use memory_propose_update. Só .md, .txt, .json, .yaml ou .csv, até 250 KB. Exige memory:write.',
  scopes: ['memory:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['caminho', 'conteudo', 'agente'],
    properties: {
      caminho: { type: 'string', description: 'Ex.: obsidian-vault/10-Notas/ideia.md ou memory/inbox/claude-code/2026-11-18-x.md' },
      conteudo: { type: 'string', description: 'O arquivo inteiro como deve ficar.' },
      sha: { type: 'string', description: 'O sha lido em memory_fetch (obrigatório para editar).' },
      mensagem: { type: 'string', description: 'Resumo do commit.' },
      agente: { type: 'string', description: 'Quem grava (claude-code, codex, hermes-helena...).' },
    },
  },
  handler: async (input, ctx: AuthContext) => {
    const p = salvarSchema.safeParse(input ?? {});
    if (!p.success) throw erroDeEntrada(p.error);
    try {
      const r = await writeNote({
        path: p.data.caminho,
        content: p.data.conteudo,
        sha: p.data.sha ?? null,
        message: p.data.mensagem,
        author: `${p.data.agente}/${ctx.keyName}`,
        admin: false,
      });
      if (ctx.resultRefHolder) ctx.resultRefHolder.value = `segundo-cerebro:${r.path}`;
      return { ok: true, criado: r.created, caminho: r.path, sha: r.sha, commit: r.commit_sha, commit_url: r.commit_url, bytes: r.bytes };
    } catch (e) { throw erroDoCerebro(e); }
  },
};

export const FERRAMENTAS_DA_CENTRAL: readonly ToolDefinition[] = [
  listarTool,
  umaTool,
  instalarTool,
  publicarTool,
  arvoreTool,
  salvarTool,
];
