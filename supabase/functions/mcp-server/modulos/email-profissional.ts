/**
 * MCP 2.33.0 (18/11/2026): o e-mail profissional pelo agente, para tocar a migração sozinho quando o
 * dono pedir (roteiro na skill migracao-email-cliente). Mesmas regras da tela do dono: tudo passa
 * pelas funções do banco de 20261118170000_produto_email_rota_unica.sql, que deixam histórico.
 *
 *   aceleriq_email_entradas      leitura: os pedidos (abertos por padrão) com empresa, contato e andamento
 *   aceleriq_email_migracao      leitura: um pedido ou domínio inteiro (empresa, integração, caixas, etapas, histórico)
 *   aceleriq_email_registrar     escrita: pedido, domínio (e integração), caixa, etapa ou andamento
 *   aceleriq_email_marcar_pago   escrita: marca o pagamento que o dono confirmou (um livro só)
 *   aceleriq_email_conferir      leitura nos provedores: DNS público, Cloudflare ou Zoho, e guarda o resultado
 *
 * As empresas do produto não são todas clientes do painel: só credencial sem restrição de cliente
 * (a casa) usa estas ferramentas. Senha, código e token nunca passam por aqui.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { DataScopeError } from '../../_shared/mcp-auth.ts';
import { db } from './aceleriq-read-services.ts';
import { umaVez } from './mcp-mesas-acoes.ts';
import { conferirDominio, type Provedor } from '../../produto/modulos/dns.ts';
import { lerZona, resumirZona } from '../../produto-email/modulos/cloudflare.ts';
import { dcValido, lerOrganizacao, resumirZoho, SemPermissaoNoZoho, tokenDeAcesso } from '../../produto-email/modulos/zoho.ts';

const UUID = z.string().uuid();
const CHAVE = z.string().trim().min(8).max(120);
const LEITURA = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const LEITURA_FORA = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true };
const ESCRITA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };

// ------------------------------------------------------------------ esquemas

export const entradasSchema = z.object({
  estado: z.enum(['abertos', 'todos', 'novo', 'aguardando_pagamento', 'pago', 'em_andamento', 'concluido', 'cancelado']).default('abertos'),
  // Pedir acima do teto acomoda no teto (como o limite() do catálogo), em vez de virar erro.
  limite: z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 200) : v;
  }, z.number().int().min(1).max(200).default(50)),
}).strict();

export const migracaoSchema = z.object({
  pedido_id: UUID.optional(),
  dominio_id: UUID.optional(),
}).strict().refine((x) => !!x.pedido_id !== !!x.dominio_id, { message: 'Diga pedido_id ou dominio_id (um dos dois).' });

const TEXTO_CURTO = z.string().trim().max(120);
const DOMINIO = z.string().trim().toLowerCase().regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, 'Domínio no formato suaempresa.com.br.');

/** Nenhum campo de segredo é aceito: o schema fechado recusa e o banco recusa de novo. */
export const dadosDoDominioSchema = z.object({
  provedor_antigo: TEXTO_CURTO.optional(),
  dns_em: TEXTO_CURTO.optional(),
  registro_em: TEXTO_CURTO.optional(),
  webmail_url: z.string().trim().url().startsWith('https://').optional(),
  dkim_seletor: z.string().trim().regex(/^[a-z0-9_-]{1,63}$/i).optional(),
  estado: z.enum(['levantamento', 'preparando', 'virada', 'concluido', 'pausado']).optional(),
  observacao: z.string().max(1500).optional(),
  cloudflare_zona_id: z.string().trim().toLowerCase().regex(/^[0-9a-f]{32}$/).optional(),
  zoho_org_id: z.string().trim().regex(/^[0-9]{3,30}$/).optional(),
  zoho_dc: z.enum(['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa']).optional(),
  zoho_admin: z.string().trim().toLowerCase().email().optional(),
  zoho_plano: z.enum(['gratuito', 'lite', 'premium', 'workplace']).optional(),
}).strict().refine((x) => Object.keys(x).length > 0, { message: 'Diga ao menos um campo do domínio.' });

export const registrarSchema = z.discriminatedUnion('o_que', [
  z.object({
    o_que: z.literal('pedido'),
    conta_id: UUID,
    dominio: DOMINIO.optional(),
    caixas: z.number().int().min(1).max(500).optional(),
    tipo: z.enum(['migracao', 'novo']).optional(),
    provedor_atual: TEXTO_CURTO.optional(),
    observacao: z.string().max(1500).optional(),
    extra_id: UUID.optional(),
    confirmar: z.literal(true),
    idempotency_key: CHAVE,
  }).strict(),
  z.object({ o_que: z.literal('dominio'), dominio_id: UUID, dados: dadosDoDominioSchema, confirmar: z.literal(true), idempotency_key: CHAVE }).strict(),
  z.object({
    o_que: z.literal('caixa'),
    dominio_id: UUID,
    endereco: z.string().trim().toLowerCase().min(1).max(254),
    pessoa: TEXTO_CURTO.optional(),
    tipo: z.enum(['caixa', 'apelido', 'grupo']).optional(),
    estado: z.enum(['pedida', 'criada', 'copiando', 'ativa', 'removida']).optional(),
    tamanho: z.string().trim().max(40).optional(),
    observacao: z.string().max(600).optional(),
    confirmar: z.literal(true),
    idempotency_key: CHAVE,
  }).strict(),
  z.object({
    o_que: z.literal('etapa'),
    dominio_id: UUID,
    etapa: z.string().trim().regex(/^([a-z_]{2,40}|[1-9][0-9]?)$/, 'A chave da etapa (ex.: dns_copiado) ou a ordem (1 a 8).'),
    feito: z.boolean().default(true),
    nota: z.string().max(1500).optional(),
    confirmar: z.literal(true),
    idempotency_key: CHAVE,
  }).strict(),
  z.object({
    o_que: z.literal('andamento'),
    pedido_id: UUID,
    estado: z.enum(['aguardando_pagamento', 'concluido', 'cancelado', 'reabrir']),
    nota: z.string().max(1500).optional(),
    confirmar: z.literal(true),
    idempotency_key: CHAVE,
  }).strict(),
]);

export const marcarPagoSchema = z.object({
  pedido_id: UUID,
  forma: z.enum(['pix', 'boleto', 'cartao', 'transferencia', 'dinheiro', 'cortesia', 'ja_lancado']),
  valor: z.number().positive().max(100000).optional(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data como AAAA-MM-DD.').optional(),
  confirmar: z.literal(true),
  idempotency_key: CHAVE,
}).strict();

export const conferirSchema = z.object({
  dominio_id: UUID,
  onde: z.enum(['dns', 'cloudflare', 'zoho']).default('dns'),
}).strict();

// ------------------------------------------------------------------ regras puras

/** Senha, token e código nunca entram: frase com cara de segredo é recusada antes de ir ao banco. */
export function pareceSegredo(texto: string | undefined): boolean {
  if (!texto) return false;
  return /\b(senha|password|passwd|token|refresh_token|api[_ -]?key|secret|c[oó]digo de verifica)\b\s*[:=]/i.test(texto) || /\b1000\.[0-9a-f]{20,}\.[0-9a-f]{20,}\b/i.test(texto);
}

/** Só a casa: as empresas do produto não são todas clientes do painel. */
export function exigirCasa(ctx: AuthContext): void {
  if (!ctx.dataScope || !ctx.dataScope.unrestricted) {
    throw new DataScopeError('o e-mail profissional é da administração da casa: use uma credencial sem restrição de cliente');
  }
}

/** O próximo passo que o agente lê depois de cada leitura da migração. */
export function proximoPassoDaMigracao(m: { pedido?: { estado?: string; pago_em?: string | null } | null; dominio?: { id?: string } | null; etapas?: Array<{ ordem: number; titulo: string; feito_em: string | null; chave: string }> }): string {
  const p = m.pedido;
  if (p && !p.pago_em && (p.estado === 'novo' || p.estado === 'aguardando_pagamento')) {
    return 'Esperando o pagamento. Só marque como pago (aceleriq_email_marcar_pago) quando o dono confirmar que recebeu.';
  }
  if (!m.dominio) return 'Pago, sem domínio: registre o domínio no pedido (aceleriq_email_registrar o_que=pedido com dominio) e marque de novo como pago para criar o passo a passo.';
  const falta = (m.etapas || []).filter((e) => !e.feito_em).sort((a, b) => a.ordem - b.ordem)[0];
  if (!falta) return p && p.estado !== 'concluido' ? 'Todas as etapas feitas: confira o DNS (aceleriq_email_conferir) e conclua o pedido (o_que=andamento, estado=concluido).' : 'Migração concluída.';
  return `Próxima etapa: ${falta.ordem}. ${falta.titulo} (chave ${falta.chave}). Siga a skill migracao-email-cliente e marque com aceleriq_email_registrar o_que=etapa.`;
}

// ------------------------------------------------------------------ dependências (o teste troca)

type Rpc = (nome: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
// deno-lint-ignore no-explicit-any
type Consulta = any;

export interface DependenciasDoEmail {
  rpc: Rpc;
  banco: { from(tabela: string): Consulta };
  umaVez: typeof umaVez;
  busca: (url: string, init: RequestInit) => Promise<Response>;
  ambiente: (nome: string) => string;
}

function padrao(): DependenciasDoEmail {
  return {
    rpc: (nome, args) => db().rpc(nome, args) as unknown as ReturnType<Rpc>,
    banco: db(),
    umaVez,
    busca: (url, init) => fetch(url, init),
    ambiente: (n) => String(Deno.env.get(n) || '').trim(),
  };
}

/** Recusa da regra do banco (P0001/42501) volta com a frase dele; o resto, genérico. */
function doBanco(error: { message: string; code?: string } | null, padraoMsg: string): Error {
  const daRegra = error && (error.code === 'P0001' || error.code === '42501');
  return new Error(daRegra ? error!.message.slice(0, 240) : padraoMsg);
}

async function chamar<T>(deps: DependenciasDoEmail, nome: string, args: Record<string, unknown>, padraoMsg: string): Promise<T> {
  const { data, error } = await deps.rpc(nome, args);
  if (error) throw doBanco(error, padraoMsg);
  return data as T;
}

const autor = (ctx: AuthContext) => (ctx.dataScope && ctx.dataScope.principalUserId) || null;

// ------------------------------------------------------------------ handlers

export async function entradas(input: z.infer<typeof entradasSchema>, ctx: AuthContext, deps = padrao()) {
  exigirCasa(ctx);
  const lista = await chamar<unknown[]>(deps, 'produto_email_pedidos_da_casa', { _estado: input.estado === 'todos' ? null : input.estado, _limite: input.limite }, 'Não foi possível ler as entradas agora.');
  const itens = Array.isArray(lista) ? lista : [];
  return { ok: true, total: itens.length, entradas: itens };
}

export async function migracao(input: z.infer<typeof migracaoSchema>, ctx: AuthContext, deps = padrao()) {
  exigirCasa(ctx);
  const m = await chamar<Record<string, unknown>>(deps, 'produto_email_migracao', { _pedido: input.pedido_id ?? null, _dominio_id: input.dominio_id ?? null }, 'Não foi possível ler a migração agora.');
  return { ok: true, ...m, proximo_passo: proximoPassoDaMigracao(m as Parameters<typeof proximoPassoDaMigracao>[0]) };
}

export async function registrar(input: z.infer<typeof registrarSchema>, ctx: AuthContext, deps = padrao()) {
  exigirCasa(ctx);
  const textos = [
    'observacao' in input ? input.observacao : undefined,
    'nota' in input ? input.nota : undefined,
    input.o_que === 'dominio' ? input.dados.observacao : undefined,
  ];
  if (textos.some(pareceSegredo)) throw new Error('Senha, token e código não entram no painel: guarde no cofre (Windows ou cofre do cliente).');
  const ator = autor(ctx);
  const escopo: Record<string, string> = { o_que: input.o_que };
  return await deps.umaVez('aceleriq_email_registrar', ctx, input.idempotency_key, async () => {
    if (input.o_que === 'pedido') {
      const r = await chamar<{ pedido: { id: string }; novo: boolean }>(deps, 'produto_email_registrar_pedido', {
        _conta: input.conta_id, _dominio: input.dominio ?? null, _caixas: input.caixas ?? null, _tipo: input.tipo ?? null,
        _observacao: input.observacao ?? null, _origem: 'agente', _ator: ator, _extra: input.extra_id ?? null, _provedor_atual: input.provedor_atual ?? null,
      }, 'Não foi possível registrar o pedido agora.');
      return { ref: `produto_email_pedidos:${r.pedido.id}`, resultado: { pedido: r.pedido, novo: r.novo } };
    }
    if (input.o_que === 'dominio') {
      const r = await chamar<Record<string, unknown>>(deps, 'produto_email_dominio_atualizar', { _dominio_id: input.dominio_id, _dados: input.dados, _ator: ator }, 'Não foi possível atualizar o domínio agora.');
      return { ref: `produto_email_dominios:${input.dominio_id}`, resultado: { migracao: r } };
    }
    if (input.o_que === 'caixa') {
      const r = await chamar<{ caixa_id: string }>(deps, 'produto_email_caixa_salvar', {
        _dominio_id: input.dominio_id, _endereco: input.endereco, _pessoa: input.pessoa ?? null, _tipo: input.tipo ?? null, _estado: input.estado ?? null,
        _tamanho: input.tamanho ?? null, _observacao: input.observacao ?? null, _ator: ator,
      }, 'Não foi possível salvar a caixa agora.');
      return { ref: `produto_email_caixas:${r.caixa_id}`, resultado: { caixa: r } };
    }
    if (input.o_que === 'etapa') {
      const r = await chamar<Record<string, unknown>>(deps, 'produto_email_etapa_marcar', { _dominio_id: input.dominio_id, _etapa: input.etapa, _feito: input.feito, _nota: input.nota ?? null, _ator: ator }, 'Não foi possível marcar a etapa agora.');
      return { ref: `produto_email_dominios:${input.dominio_id}`, resultado: { etapa: r } };
    }
    const r = await chamar<{ pedido: { id: string } }>(deps, 'produto_email_pedido_mudar', { _pedido: input.pedido_id, _estado: input.estado, _nota: input.nota ?? null, _ator: ator }, 'Não foi possível mudar o pedido agora.');
    return { ref: `produto_email_pedidos:${input.pedido_id}`, resultado: { pedido: r.pedido } };
  }, escopo);
}

export async function marcarPago(input: z.infer<typeof marcarPagoSchema>, ctx: AuthContext, deps = padrao()) {
  exigirCasa(ctx);
  return await deps.umaVez('aceleriq_email_marcar_pago', ctx, input.idempotency_key, async () => {
    const r = await chamar<{ pedido: { id: string; dominio_id: string | null }; ja_estava_pago: boolean; livro?: string }>(deps, 'produto_email_marcar_pago', {
      _pedido: input.pedido_id, _forma: input.forma, _valor: input.valor ?? null, _pago_em: input.pago_em ?? null, _ator: autor(ctx),
    }, 'Não foi possível marcar o pagamento agora.');
    return {
      ref: `produto_email_pedidos:${input.pedido_id}`,
      resultado: {
        pedido: r.pedido,
        ja_estava_pago: r.ja_estava_pago,
        livro: r.livro ?? null,
        proximo_passo: r.pedido.dominio_id
          ? `Migração aberta: leia com aceleriq_email_migracao (dominio_id ${r.pedido.dominio_id}) e siga as etapas.`
          : 'Pago, sem domínio: registre o domínio no pedido.',
      },
    };
  }, { pedido_id: input.pedido_id });
}

export async function conferir(input: z.infer<typeof conferirSchema>, ctx: AuthContext, deps = padrao()) {
  exigirCasa(ctx);
  const { data, error } = await deps.banco.from('produto_email_dominios')
    .select('id, dominio, provedor, dkim_seletor, cloudflare_zona_id, zoho_org_id, zoho_dc, zoho_plano').eq('id', input.dominio_id).maybeSingle();
  if (error) throw new Error('Não foi possível ler o domínio agora.');
  if (!data) throw new Error('O domínio não foi encontrado.');
  const d = data as { id: string; dominio: string; provedor: Provedor; dkim_seletor: string | null; cloudflare_zona_id: string | null; zoho_org_id: string | null; zoho_dc: string | null; zoho_plano: string | null };
  const gravar = (onde: string, resultado: unknown) => deps.rpc('produto_email_gravar_conferencia', { _dominio_id: d.id, _onde: onde, _resultado: resultado });

  if (input.onde === 'dns') {
    const checagem = await conferirDominio(deps.busca as Parameters<typeof conferirDominio>[0], { dominio: d.dominio, provedor: d.provedor, seletor: d.dkim_seletor });
    await gravar('dns', checagem);
    return { ok: true, onde: 'dns', resultado: checagem };
  }
  if (input.onde === 'cloudflare') {
    const token = deps.ambiente('CLOUDFLARE_API_TOKEN');
    if (!token) return { ok: false, onde: 'cloudflare', indisponivel: true, aviso: 'Falta o segredo CLOUDFLARE_API_TOKEN (Zone:Read e DNS:Read) nas funções. Peça ao dono; não repita.' };
    const lido = await lerZona(token, deps.busca, { dominio: d.dominio, zonaId: d.cloudflare_zona_id, contaId: deps.ambiente('CLOUDFLARE_ACCOUNT_ID') || null });
    if (!lido) return { ok: false, onde: 'cloudflare', aviso: `A zona ${d.dominio} não está na Cloudflare da Aceleriq.` };
    const resumo = resumirZona(lido.zona, lido.registros, { dominio: d.dominio, provedor: d.provedor, seletor: d.dkim_seletor });
    await gravar('cloudflare', resumo);
    if (!d.cloudflare_zona_id) await deps.rpc('produto_email_dominio_atualizar', { _dominio_id: d.id, _dados: { cloudflare_zona_id: lido.zona.id }, _ator: autor(ctx) });
    return { ok: true, onde: 'cloudflare', resultado: resumo };
  }
  const clientId = deps.ambiente('ZOHO_CLIENT_ID');
  const clientSecret = deps.ambiente('ZOHO_CLIENT_SECRET');
  if (!clientId || !clientSecret) return { ok: false, onde: 'zoho', indisponivel: true, aviso: 'Faltam ZOHO_CLIENT_ID e ZOHO_CLIENT_SECRET nas funções. Peça ao dono; não repita.' };
  const { data: refresh } = await deps.rpc('produto_email_ler_token_zoho', { _dominio_id: d.id });
  if (!refresh) return { ok: false, onde: 'zoho', indisponivel: true, aviso: 'O token do Zoho deste cliente não está no cofre. O dono guarda em /produto, E-mail, Integração.' };
  const dc = dcValido(d.zoho_dc);
  try {
    const acesso = await tokenDeAcesso(deps.busca, { dc, clientId, clientSecret, refreshToken: String(refresh) });
    const org = await lerOrganizacao(deps.busca, { dc, acesso, orgId: d.zoho_org_id, dominio: d.dominio });
    const resumo = resumirZoho({ orgId: org.orgId, plano: org.plano || d.zoho_plano, usuarios: org.usuarios, dominio: org.dominio, nomeDoDominio: d.dominio });
    await gravar('zoho', resumo);
    return { ok: true, onde: 'zoho', resultado: resumo };
  } catch (e) {
    if (e instanceof SemPermissaoNoZoho) {
      const resumo = { ok: false, sem_api: true, avisos: [e.message], conferido_em: new Date().toISOString() };
      await gravar('zoho', resumo);
      return { ok: false, onde: 'zoho', resultado: resumo };
    }
    throw e;
  }
}

// ------------------------------------------------------------------ catálogo

function lido<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const p = schema.safeParse(input ?? {});
  if (!p.success) throw new Error(`Invalid input: ${p.error.issues.map((i) => i.message).join('; ')}`);
  return p.data;
}

const ENTRADAS: ToolDefinition = {
  name: 'aceleriq_email_entradas',
  title: 'E-mail profissional: entradas',
  description: 'Lista os pedidos de e-mail profissional (a entrada que o dono vê em /produto, E-mail): empresa, contato, domínio, caixas, tipo (migracao ou novo), origem, estado (novo, aguardando_pagamento, pago, em_andamento, concluido, cancelado), valores, se está ligado a um extra do cliente e as etapas feitas. Padrão: só os abertos. Só leitura. Só para credencial da casa (sem restrição de cliente).',
  scopes: ['clients:read'],
  annotations: LEITURA,
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      estado: { type: 'string', enum: ['abertos', 'todos', 'novo', 'aguardando_pagamento', 'pago', 'em_andamento', 'concluido', 'cancelado'], description: 'Padrão abertos.' },
      limite: { type: 'integer', minimum: 1, maximum: 200, description: 'Padrão 50.' },
    },
  },
  handler: (input, ctx) => entradas(lido(entradasSchema, input), ctx),
};

const MIGRACAO: ToolDefinition = {
  name: 'aceleriq_email_migracao',
  title: 'E-mail profissional: migração',
  description: 'Lê uma migração inteira por pedido_id ou dominio_id: o pedido, a empresa (e se o e-mail está liberado), o domínio com a integração (zona da Cloudflare, organização, região e plano do Zoho, conferências guardadas), as caixas e apelidos, as 8 etapas com nota e o histórico do e-mail. Devolve proximo_passo. Só leitura. Leia antes de registrar qualquer avanço.',
  scopes: ['clients:read'],
  annotations: LEITURA,
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      pedido_id: { type: 'string', format: 'uuid', description: 'Id do pedido (aceleriq_email_entradas). Use este ou dominio_id.' },
      dominio_id: { type: 'string', format: 'uuid', description: 'Id do domínio. Use este ou pedido_id.' },
    },
  },
  handler: (input, ctx) => migracao(lido(migracaoSchema, input), ctx),
};

const REGISTRAR: ToolDefinition = {
  name: 'aceleriq_email_registrar',
  title: 'E-mail profissional: registrar avanço',
  description: 'Registra o avanço da migração, com histórico e o autor da credencial. o_que=pedido: cria ou completa a entrada da empresa (conta_id; uma aberta por empresa, repetir não duplica; extra_id liga ao extra de e-mail do cliente). o_que=dominio: muda campos do domínio e da integração (cloudflare_zona_id, zoho_org_id, zoho_dc, zoho_admin, zoho_plano, dkim_seletor, estado...). o_que=caixa: cria ou atualiza caixa ou apelido pelo endereço (nome curto vira nome@dominio). o_que=etapa: marca ou desmarca etapa pela chave ou pela ordem, com nota. o_que=andamento: aguardando_pagamento, concluido (só depois de pago), cancelado ou reabrir. Nunca aceita senha, token ou código: isso fica no cofre. Não cobra e não mexe em DNS nem no Zoho. Exige confirmar=true e idempotency_key.',
  scopes: ['clients:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object', additionalProperties: false,
    required: ['o_que', 'confirmar', 'idempotency_key'],
    properties: {
      o_que: { type: 'string', enum: ['pedido', 'dominio', 'caixa', 'etapa', 'andamento'] },
      conta_id: { type: 'string', format: 'uuid', description: 'o_que=pedido: a empresa do produto.' },
      pedido_id: { type: 'string', format: 'uuid', description: 'o_que=andamento.' },
      dominio_id: { type: 'string', format: 'uuid', description: 'o_que=dominio, caixa ou etapa.' },
      dominio: { type: 'string', description: 'o_que=pedido: suaempresa.com.br.' },
      caixas: { type: 'integer', minimum: 1, maximum: 500 },
      tipo: { type: 'string', description: 'pedido: migracao ou novo. caixa: caixa, apelido ou grupo.' },
      provedor_atual: { type: 'string' },
      extra_id: { type: 'string', format: 'uuid', description: 'o_que=pedido: o extra de e-mail na ficha do cliente (o pagamento quita a cobrança dele).' },
      dados: { type: 'object', description: 'o_que=dominio: só os campos que mudam.' },
      endereco: { type: 'string', description: 'o_que=caixa: nome ou nome@dominio.' },
      pessoa: { type: 'string' },
      estado: { type: 'string', description: 'caixa: pedida, criada, copiando, ativa, removida. andamento: aguardando_pagamento, concluido, cancelado, reabrir.' },
      tamanho: { type: 'string', description: 'o_que=caixa: tamanho na origem (ex.: 2,3 GB).' },
      etapa: { type: 'string', description: 'o_que=etapa: levantamento, contas, dns_copiado, caixas_criadas, historico, virada, teste, encerramento, ou 1 a 8.' },
      feito: { type: 'boolean', description: 'o_que=etapa: false desmarca. Padrão true.' },
      nota: { type: 'string' },
      observacao: { type: 'string' },
      confirmar: { type: 'boolean', const: true },
      idempotency_key: { type: 'string', description: 'Chave estável de 8 a 120 caracteres. Repetir não refaz.' },
    },
  },
  handler: (input, ctx) => registrar(lido(registrarSchema, input), ctx),
};

const MARCAR_PAGO: ToolDefinition = {
  name: 'aceleriq_email_marcar_pago',
  title: 'E-mail profissional: marcar como pago',
  description: 'Marca o pagamento de uma entrada SÓ quando o dono disse que recebeu. Lança o dinheiro num livro só: pedido ligado a extra quita a cobrança aberta do extra; sem extra, lança a cobrança paga no produto; cortesia e ja_lancado (já está no Financeiro) não lançam valor. Depois liga o e-mail da empresa, cria o domínio com as 8 etapas e o cliente passa a ver a migração no /app. Repetir não lança de novo (ja_estava_pago). Não cobra ninguém nem gera link. Exige confirmar=true e idempotency_key.',
  scopes: ['clients:write'],
  annotations: ESCRITA,
  inputSchema: {
    type: 'object', additionalProperties: false,
    required: ['pedido_id', 'forma', 'confirmar', 'idempotency_key'],
    properties: {
      pedido_id: { type: 'string', format: 'uuid' },
      forma: { type: 'string', enum: ['pix', 'boleto', 'cartao', 'transferencia', 'dinheiro', 'cortesia', 'ja_lancado'] },
      valor: { type: 'number', description: 'Vazio: a migração (ou a mensalidade, em e-mail novo) da tabela de preços; no extra, o valor da cobrança.' },
      pago_em: { type: 'string', description: 'AAAA-MM-DD; vazio é hoje. Não aceita data futura.' },
      confirmar: { type: 'boolean', const: true, description: 'Tem que ser true: lança o pagamento no Financeiro.' },
      idempotency_key: { type: 'string' },
    },
  },
  handler: (input, ctx) => marcarPago(lido(marcarPagoSchema, input), ctx),
};

const CONFERIR: ToolDefinition = {
  name: 'aceleriq_email_conferir',
  title: 'E-mail profissional: conferir DNS, Cloudflare ou Zoho',
  description: 'Confere um domínio e guarda o resultado na migração. onde=dns: DNS público (MX, SPF, DKIM, DMARC contra o provedor). onde=cloudflare: a zona na Cloudflare da Aceleriq (ativa, proxy em registro de e-mail, MX, SPF único, DKIM, DMARC, verificação do Zoho). onde=zoho: a organização do Zoho do cliente (caixas, apelidos, limite do gratuito, domínio verificado, DKIM), com o token do cofre. Só leitura nos provedores. Sem segredo configurado, responde indisponivel: peça ao dono, não repita.',
  scopes: ['clients:read'],
  annotations: LEITURA_FORA,
  inputSchema: {
    type: 'object', additionalProperties: false,
    required: ['dominio_id'],
    properties: {
      dominio_id: { type: 'string', format: 'uuid' },
      onde: { type: 'string', enum: ['dns', 'cloudflare', 'zoho'], description: 'Padrão dns.' },
    },
  },
  prazoMs: 25_000,
  handler: (input, ctx) => conferir(lido(conferirSchema, input), ctx),
};

export const FERRAMENTAS_DO_EMAIL: readonly ToolDefinition[] = [ENTRADAS, MIGRACAO, REGISTRAR, MARCAR_PAGO, CONFERIR];
