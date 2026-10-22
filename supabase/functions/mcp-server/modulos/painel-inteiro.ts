/**
 * MCP 2.17 (22/10/2026): o painel inteiro pelo MCP.
 *
 * Pedido do dono: "atualize o MCP geral, que englobe o painel inteiro de forma completa e robusta,
 * muito veloz na leitura e econômico". Este arquivo declara as ferramentas novas; o trabalho de
 * leitura mora em painel-leituras.ts e as ações chamam a própria mesa pela ponte de sempre
 * (_shared/mcp-mesas-acoes.ts), com a sessão da pessoa, a mesma confirmação de custo da tela e
 * idempotency_key.
 *
 * Não importa nada de _shared/mcp-tools.ts em tempo de execução (só o tipo): o mcp-tools importa
 * este arquivo, e o ciclo com valor quebraria a ordem de carga. O catálogo vivo chega por
 * ligarCatalogo(), chamado pelo mcp-tools depois de montar TOOLS.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { chamarMesa, clienteDaLinha, conferirCliente, umaVez } from '../../_shared/mcp-mesas-acoes.ts';
import { MCP_VERSION } from '../../_shared/mcp-release.ts';
import {
  baseDosAgentes,
  campanhasDoMes,
  hypeDoMes,
  laboratorio,
  membros,
  panoramaDaCasa,
  panoramaDoCliente,
  siteDaMesa,
  storiesDaMesa,
  templatesDaMesa,
  trabalhosDoEstudio,
} from './painel-leituras.ts';
import { guiaDoPainel } from './guia-do-painel.ts';
import { PRAZO_ESCRITA_MS, PRAZO_LEITURA_MS, RECUOS_MS, registroDoMcp } from './robustez.ts';
import { cacheDoMcp } from './leitura-enxuta.ts';

// ─── Catálogo vivo (para o guia) ────────────────────────────────

export interface FerramentaDoCatalogo {
  name: string;
  title?: string;
  description: string;
  scopes: readonly string[];
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}
let catalogo: () => readonly FerramentaDoCatalogo[] = () => [];
export function ligarCatalogo(fn: () => readonly FerramentaDoCatalogo[]) {
  catalogo = fn;
}
export const catalogoVivo = () => catalogo();

// ─── Peças comuns ───────────────────────────────────────────────

const READ_ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const UUID = z.string().uuid();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');
const DETALHE = z.enum(['enxuto', 'completo']).optional();
const LIMITE = z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Number(v)), z.number().int().min(1).max(500).optional());
const CURSOR = z.string().max(400).optional();
const CHAVE_IDEMPOTENTE = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/, 'idempotency_key: 8 a 128 caracteres [A-Za-z0-9._:-]');

const J_UUID = (d: string) => ({ type: 'string', format: 'uuid', description: d });
const J_DETALHE = { type: 'string', enum: ['enxuto', 'completo'], description: 'enxuto (padrão: campos essenciais, textos cortados) ou completo.' };
const J_LIMITE = { type: 'integer', minimum: 1, maximum: 100, description: 'Itens por página (padrão 20, máximo 100).' };
const J_CURSOR = { type: 'string', description: 'proximo_cursor da resposta anterior, para a próxima página.' };
const J_CHAVE = { type: 'string', minLength: 8, maxLength: 128, description: 'Chave única da ação. Repetir a mesma chave não refaz nada (24 h, por credencial).' };

function validar<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new Error(`Invalid input: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return r.data;
}

function leitura(
  def: { name: string; title: string; description: string; scopes: readonly string[]; cacheSeg?: number; prazoMs?: number },
  schema: z.ZodTypeAny,
  json: Record<string, unknown>,
  fn: (input: any, ctx: AuthContext) => Promise<unknown>,
): ToolDefinition & { cacheSeg?: number } {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    scopes: def.scopes as ToolDefinition['scopes'],
    annotations: READ_ANNOTATIONS,
    inputSchema: { type: 'object', ...json, additionalProperties: false },
    cacheSeg: def.cacheSeg,
    prazoMs: def.prazoMs,
    handler: async (input, ctx) => await fn(validar(schema, input), ctx),
  } as ToolDefinition & { cacheSeg?: number };
}

const LEITURA_CLIENTES = ['aceleriq:read', 'clients:read'] as const;
const LEITURA_EDITORIAL = ['aceleriq:read', 'editorial:read'] as const;
const LEITURA_GERAL = ['aceleriq:read'] as const;

// ─── Leituras ───────────────────────────────────────────────────

const panoramaDoClienteTool = leitura(
  {
    name: 'aceleriq_panorama_do_cliente',
    title: 'Panorama do cliente numa chamada',
    description: 'COMECE POR AQUI quando o assunto for um cliente: numa chamada só traz perfil e plano, projetos, tarefas abertas e atrasadas, campanhas do Mês, Estúdio (entregas), stories, Dia Prioritário, dossiê atual, pedidos, anúncios ativos, aprovações da Execução e sites. Cada parte tem prazo próprio: a que falhar vem em `faltou` e o resto chega igual. Substitui umas 10 leituras. Guardado por 30 s.',
    scopes: LEITURA_CLIENTES,
    cacheSeg: 30,
  },
  z.object({ client_id: UUID, detalhe: DETALHE }).strict(),
  { properties: { client_id: J_UUID('Cliente (aceleriq_list_clients).'), detalhe: J_DETALHE }, required: ['client_id'] },
  (i, ctx) => panoramaDoCliente(i, ctx),
);

const panoramaDaCasaTool = leitura(
  {
    name: 'aceleriq_panorama_da_casa',
    title: 'Panorama da casa numa chamada',
    description: 'Visão do dia da agência inteira numa chamada: clientes, tarefas abertas/atrasadas/de hoje, Execução (aprovações 30 dias e runs 24 h por situação), funil comercial por etapa e valor mensal em aberto, campanhas ativas, fila do Estúdio, pedidos de clientes e Laboratório (saldo e execuções). Só credencial sem restrição de cliente. Guardado por 30 s.',
    scopes: LEITURA_GERAL,
    cacheSeg: 30,
  },
  z.object({ detalhe: DETALHE }).strict(),
  { properties: { detalhe: J_DETALHE } },
  (i, ctx) => panoramaDaCasa(i, ctx),
);

const campanhasTool = leitura(
  {
    name: 'aceleriq_mes_campanhas',
    title: 'Mês: campanhas',
    description: 'Campanhas da Mesa (aba Campanhas do Mês). Sem campanha_id: lista paginada e enxuta (nome, objetivo, período, situação). Com campanha_id: a campanha inteira (briefing com linha do tempo, mercado, trilha e produtos) e o que pende dela: conteúdos da série, artes do Estúdio, stories, criativos da Mesa Ads e sons da trilha. Para mudar, use aceleriq_mesa_campanha_acao.',
    scopes: LEITURA_EDITORIAL,
    cacheSeg: 15,
  },
  z.object({ client_id: UUID, campanha_id: UUID.optional(), so_ativas: z.boolean().optional(), limite: LIMITE, cursor: CURSOR, detalhe: DETALHE }).strict(),
  {
    properties: {
      client_id: J_UUID('Cliente.'),
      campanha_id: J_UUID('Uma campanha só, com tudo o que pende dela.'),
      so_ativas: { type: 'boolean', description: 'Só campanhas que ainda não acabaram.' },
      limite: J_LIMITE, cursor: J_CURSOR, detalhe: J_DETALHE,
    },
    required: ['client_id'],
  },
  (i, ctx) => campanhasDoMes(i, ctx),
);

const storiesTool = leitura(
  {
    name: 'aceleriq_mesa_stories',
    title: 'Mesa: stories',
    description: 'Sequências de stories da Mesa (aba Stories): dia, objetivo, título e situação de cada story (no completo, cada story com molde, texto e horário). Filtra por campanha e período. Paginado.',
    scopes: LEITURA_EDITORIAL,
    cacheSeg: 15,
  },
  z.object({ client_id: UUID, campanha_id: UUID.optional(), desde: DATA.optional(), ate: DATA.optional(), limite: LIMITE, cursor: CURSOR, detalhe: DETALHE }).strict(),
  {
    properties: {
      client_id: J_UUID('Cliente.'), campanha_id: J_UUID('Só os stories desta campanha.'),
      desde: { type: 'string', description: 'AAAA-MM-DD' }, ate: { type: 'string', description: 'AAAA-MM-DD' },
      limite: J_LIMITE, cursor: J_CURSOR, detalhe: J_DETALHE,
    },
    required: ['client_id'],
  },
  (i, ctx) => storiesDaMesa(i, ctx),
);

const hypeTool = leitura(
  {
    name: 'aceleriq_mesa_hype',
    title: 'Mês: Hype da semana',
    description: 'O Hype guardado no Mês (assuntos e datas da semana que servem ao nicho do cliente), das últimas semanas. Enxuto: 8 itens por semana. Trending ao vivo (Google Notícias) é da tela.',
    scopes: LEITURA_EDITORIAL,
    cacheSeg: 60,
  },
  z.object({ client_id: UUID, semanas: z.preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().int().min(1).max(52).optional()), detalhe: DETALHE }).strict(),
  { properties: { client_id: J_UUID('Cliente.'), semanas: { type: 'integer', minimum: 1, maximum: 8, description: 'Quantas semanas (padrão 2).' }, detalhe: J_DETALHE }, required: ['client_id'] },
  (i, ctx) => hypeDoMes(i, ctx),
);

const templatesTool = leitura(
  {
    name: 'aceleriq_mesa_templates',
    title: 'Mesa: templates de design',
    description: 'Templates do Estúdio (post do X, Instagram, Story): nome, tipo, formato, situação e versão atual; no completo, as 3 últimas versões, gostos e testes. Sem client_id lista os da casa (credencial sem restrição).',
    scopes: LEITURA_EDITORIAL,
    cacheSeg: 60,
  },
  z.object({ client_id: UUID.optional(), tipo: z.string().max(40).optional(), limite: LIMITE, cursor: CURSOR, detalhe: DETALHE }).strict(),
  { properties: { client_id: J_UUID('Cliente (opcional).'), tipo: { type: 'string', description: 'Filtra pelo tipo do template.' }, limite: J_LIMITE, cursor: J_CURSOR, detalhe: J_DETALHE } },
  (i, ctx) => templatesDaMesa(i, ctx),
);

const estudioTool = leitura(
  {
    name: 'aceleriq_estudio_trabalhos',
    title: 'Estúdio: artes e entregas',
    description: 'Trabalhos do Estúdio de arte do cliente (posts, carrosséis, peças de campanha): situação, entrega (enviado, aprovado, ajustes), lâminas com arte, agendamento. Filtra por situação, entrega e campanha. Paginado; completo traz direção, cards e ajustes do cliente.',
    scopes: LEITURA_EDITORIAL,
    cacheSeg: 15,
  },
  z.object({ client_id: UUID, status: z.string().max(40).optional(), entrega_status: z.string().max(40).optional(), campanha_id: UUID.optional(), limite: LIMITE, cursor: CURSOR, detalhe: DETALHE }).strict(),
  {
    properties: {
      client_id: J_UUID('Cliente.'), status: { type: 'string' }, entrega_status: { type: 'string' },
      campanha_id: J_UUID('Só as artes desta campanha.'), limite: J_LIMITE, cursor: J_CURSOR, detalhe: J_DETALHE,
    },
    required: ['client_id'],
  },
  (i, ctx) => trabalhosDoEstudio(i, ctx),
);

const siteTool = leitura(
  {
    name: 'aceleriq_mesa_site',
    title: 'Mesa Site',
    description: 'Sites da Mesa Site. Sem site_id: lista (nome, tipo, etapa). Com site_id: o site (publicação, modelo, custo; completo traz briefing, direção, mapa, SEO e integrações), as 5 últimas versões, as 10 últimas edições e os envios do formulário em 30 dias por resultado.',
    scopes: LEITURA_CLIENTES,
    cacheSeg: 30,
  },
  z.object({ client_id: UUID.optional(), site_id: UUID.optional(), limite: LIMITE, cursor: CURSOR, detalhe: DETALHE }).strict(),
  { properties: { client_id: J_UUID('Cliente (opcional).'), site_id: J_UUID('Um site.'), limite: J_LIMITE, cursor: J_CURSOR, detalhe: J_DETALHE } },
  (i, ctx) => siteDaMesa(i, ctx),
);

const laboratorioTool = leitura(
  {
    name: 'aceleriq_laboratorio',
    title: 'Laboratório: créditos, nós e vendas',
    description: 'Laboratório (trabalho avulso em canvas). Sem projeto_id: carteira de créditos (saldo, ativa), últimos movimentos, projetos paginados (nós por projeto) e vendas (integrações sem chave nem segredo; eventos sem dado do comprador). Com projeto_id: os nós do canvas por tipo, ligações e execuções (situação, custo, erro).',
    scopes: LEITURA_GERAL,
    cacheSeg: 20,
  },
  z.object({ projeto_id: UUID.optional(), client_id: UUID.optional(), limite: LIMITE, cursor: CURSOR, detalhe: DETALHE }).strict(),
  { properties: { projeto_id: J_UUID('Um projeto do Laboratório.'), client_id: J_UUID('Só os do cliente.'), limite: J_LIMITE, cursor: J_CURSOR, detalhe: J_DETALHE } },
  (i, ctx) => laboratorio(i, ctx),
);

const baseTool = leitura(
  {
    name: 'aceleriq_base_dos_agentes',
    title: 'Base dos agentes',
    description: 'O que cada agente do painel aprendeu (fichas da /base-dos-agentes: técnica, quando usar, usos e resultado). Busca em português por `busca`; filtra por agente (ex.: calendario.legenda) e cliente. Sem busca, traz também as fontes recentes. Leia antes de escrever no estilo de um agente.',
    scopes: LEITURA_GERAL,
    cacheSeg: 60,
  },
  z.object({ agente: z.string().max(60).optional(), client_id: UUID.optional(), busca: z.string().max(200).optional(), incluir_inativas: z.boolean().optional(), limite: LIMITE, cursor: CURSOR, detalhe: DETALHE }).strict(),
  {
    properties: {
      agente: { type: 'string', description: 'Chave do agente (area.funcao).' }, client_id: J_UUID('Só as fichas do cliente.'),
      busca: { type: 'string', description: 'Palavras para buscar nas fichas.' }, incluir_inativas: { type: 'boolean' },
      limite: J_LIMITE, cursor: J_CURSOR, detalhe: J_DETALHE,
    },
  },
  (i, ctx) => baseDosAgentes(i, ctx),
);

const membrosTool = leitura(
  {
    name: 'aceleriq_membros',
    title: 'Área de membros e CRM licença',
    description: 'Área de membros: produtos (situação, venda), ferramentas (CRM licença), licenças por produto (ativas, vencidas, revogadas, origem), compras por estado e o uso do CRM licença em números (contatos ativos e negócios por estágio com valor). Nada pessoal sai: nomes, e-mails e notas dos membros ficam no banco.',
    scopes: ['aceleriq:read', 'commercial:read'],
    cacheSeg: 60,
  },
  z.object({ produto_id: UUID.optional(), detalhe: DETALHE }).strict(),
  { properties: { produto_id: J_UUID('Um produto só.'), detalhe: J_DETALHE } },
  (i, ctx) => membros(i, ctx),
);

const saudeTool = leitura(
  {
    name: 'aceleriq_mcp_saude',
    title: 'Saúde do MCP',
    description: 'Como o MCP está agora: versão, chamadas e falhas por ferramenta (desde que esta instância subiu), tempo médio e máximo, acertos de cache, novas tentativas e as últimas falhas com código. Use quando algo falhar para saber se é a ferramenta ou a rede.',
    scopes: LEITURA_GERAL,
  },
  z.object({}).strict(),
  { properties: {} },
  () => Promise.resolve({
    versao: MCP_VERSION,
    regras: {
      prazo_leitura_s: PRAZO_LEITURA_MS / 1000,
      prazo_escrita_s: PRAZO_ESCRITA_MS / 1000,
      novas_tentativas: `até ${RECUOS_MS.length}, só em leitura e só em erro transitório (rede, 502/503/504, conexão); nunca em conflito 40001`,
      cache: 'leituras marcadas, por credencial, 15 a 60 s; toda escrita da mesma credencial limpa o cache dela',
    },
    cache_itens: cacheDoMcp.tamanho,
    ...registroDoMcp.resumo(),
  }),
);

const guiaTool: ToolDefinition = {
  name: 'aceleriq_guia',
  title: 'Guia do painel e das ferramentas',
  description: 'O mapa do painel: cada área (rota, o que faz, agente) com as ferramentas do MCP que chegam nela, as regras de ação (custo, confirmação, idempotência) e as skills da casa. Com `ferramenta`, o manual completo dela (descrição inteira e campos). Com `area`, só aquela área. Barato: chame antes de explorar.',
  scopes: [],
  annotations: READ_ANNOTATIONS,
  inputSchema: {
    type: 'object',
    properties: {
      area: { type: 'string', description: 'Chave ou nome da área (ex.: mesa, mesa_ads, laboratorio, comercial).' },
      ferramenta: { type: 'string', description: 'Nome exato de uma ferramenta para ver o manual completo.' },
    },
    additionalProperties: false,
  },
  handler: (input) => {
    const i = validar(z.object({ area: z.string().max(60).optional(), ferramenta: z.string().max(80).optional() }).strict(), input);
    return Promise.resolve(guiaDoPainel(i, catalogoVivo()));
  },
};

// ─── Ação: campanha da Mesa ─────────────────────────────────────

const ACOES_DA_CAMPANHA = [
  'mudanca_planejar', 'mudanca_confirmar', 'mudanca_desfazer', 'versao_voltar',
  'reorganizar', 'mercado', 'roteiro_video', 'trilha_estado', 'trilha_gerar', 'pecas_para_ads',
] as const;
type AcaoDaCampanha = (typeof ACOES_DA_CAMPANHA)[number];

/** Ações com IA paga: só com confirmar_custo=true (a mesa cobra e confere o saldo). */
export const ACOES_COM_CUSTO: ReadonlySet<AcaoDaCampanha> = new Set(['mudanca_planejar', 'reorganizar', 'mercado', 'roteiro_video', 'trilha_gerar']);

const PECA_PARA_ADS = z.object({
  trabalho_id: UUID,
  formato: z.enum(['feed_4x5', 'quadrado_1x1', 'stories_9x16', 'carrossel']),
  titulo: z.string().max(200).optional(),
  tema_id: z.string().max(40).optional(),
  sequencia_id: UUID.optional(),
  fase: z.string().max(40).optional(),
  data: DATA.optional(),
}).strict();

export const ENTRADA_DA_ACAO = z.object({
  campanha_id: UUID,
  acao: z.enum(ACOES_DA_CAMPANHA),
  mensagem: z.string().min(1).max(4000).optional(),
  mensagem_id: UUID.optional(),
  acao_id: z.string().max(64).optional(),
  refs: z.array(z.string().max(40)).max(60).optional(),
  descartar: z.boolean().optional(),
  versao_id: z.string().max(64).optional(),
  data_evento: DATA.optional(),
  dias_antes: z.number().int().min(0).max(60).optional(),
  fim: DATA.optional(),
  aplicar: z.boolean().optional(),
  tema_id: z.string().max(40).optional(),
  duracao: z.number().int().min(5).max(300).optional(),
  opcoes: z.number().int().min(2).max(3).optional(),
  tema: z.string().max(60).optional(),
  extra: z.string().max(600).optional(),
  loop: z.boolean().optional(),
  pecas: z.array(PECA_PARA_ADS).min(1).max(20).optional(),
  confirmar_custo: z.boolean().optional(),
  idempotency_key: CHAVE_IDEMPOTENTE,
}).strict();
type EntradaDaAcao = z.infer<typeof ENTRADA_DA_ACAO>;

/** O que cada ação exige além de campanha_id (erro claro antes de sair para a mesa). */
export function faltaNaAcao(i: EntradaDaAcao): string | null {
  if (ACOES_COM_CUSTO.has(i.acao) && i.confirmar_custo !== true) {
    return `${i.acao} usa IA paga: avise o dono do custo e repita com confirmar_custo=true.`;
  }
  if (i.acao === 'mudanca_planejar' && !i.mensagem) return 'mudanca_planejar precisa de `mensagem` (o que mudar na campanha).';
  if ((i.acao === 'mudanca_confirmar' || i.acao === 'mudanca_desfazer') && !i.mensagem_id) return `${i.acao} precisa do mensagem_id devolvido por mudanca_planejar ou reorganizar.`;
  if (i.acao === 'versao_voltar' && !i.versao_id) return 'versao_voltar precisa de versao_id.';
  if (i.acao === 'roteiro_video' && !i.tema_id) return 'roteiro_video precisa de tema_id (a peça de vídeo da série).';
  if (i.acao === 'pecas_para_ads' && !i.pecas?.length) return 'pecas_para_ads precisa de `pecas` (trabalho_id e formato de cada arte pronta).';
  return null;
}

/** Corpo que vai para a mesa (só os campos que a ação usa). */
export function corpoDaAcao(i: EntradaDaAcao, clientId: string): { funcao: 'agente-calendario' | 'mesa-ads'; acao: string; corpo: Record<string, unknown> } {
  const so = (campos: (keyof EntradaDaAcao)[]) => Object.fromEntries(campos.filter((c) => i[c] !== undefined).map((c) => [c, i[c]]));
  const base = { campanha_id: i.campanha_id };
  switch (i.acao) {
    case 'mudanca_planejar': return { funcao: 'agente-calendario', acao: 'campanha_mudanca_planejar', corpo: { ...base, mensagem: i.mensagem } };
    case 'mudanca_confirmar': return { funcao: 'agente-calendario', acao: 'campanha_mudanca_confirmar', corpo: so(['mensagem_id', 'acao_id', 'refs', 'descartar']) };
    case 'mudanca_desfazer': return { funcao: 'agente-calendario', acao: 'campanha_mudanca_desfazer', corpo: so(['mensagem_id', 'acao_id']) };
    case 'versao_voltar': return { funcao: 'agente-calendario', acao: 'campanha_versao_voltar', corpo: { ...base, versao_id: i.versao_id } };
    case 'reorganizar': return { funcao: 'agente-calendario', acao: 'campanha_reorganizar', corpo: { ...base, ...so(['data_evento', 'dias_antes', 'fim', 'aplicar']) } };
    case 'mercado': return { funcao: 'agente-calendario', acao: 'campanha_mercado', corpo: base };
    case 'roteiro_video': return { funcao: 'agente-calendario', acao: 'campanha_roteiro_video', corpo: { ...base, tema_id: i.tema_id } };
    case 'trilha_estado': return { funcao: 'agente-calendario', acao: 'campanha_trilha', corpo: { ...base, operacao: 'estado' } };
    case 'trilha_gerar': return { funcao: 'agente-calendario', acao: 'campanha_trilha', corpo: { ...base, operacao: 'gerar_trilha', confirmado: true, ...so(['duracao', 'opcoes', 'tema', 'extra', 'loop']) } };
    case 'pecas_para_ads': return { funcao: 'mesa-ads', acao: 'criativos_da_campanha_mesa', corpo: { client_id: clientId, campanha_id: i.campanha_id, pecas: i.pecas } };
  }
}

const PROXIMO: Record<AcaoDaCampanha, string> = {
  mudanca_planejar: 'Nada mudou ainda: mostre o plano ao dono e aplique com acao=mudanca_confirmar (mensagem_id da resposta; refs para escolher itens).',
  mudanca_confirmar: 'Aplicado, com versão guardada: volte com acao=mudanca_desfazer (mesmo mensagem_id). Peças aprovadas/publicadas não mudaram; artes das peças que mudaram ficam "a refazer".',
  mudanca_desfazer: 'A campanha voltou à versão de antes da mudança.',
  versao_voltar: 'A campanha voltou à versão escolhida.',
  reorganizar: 'Sem aplicar=true sai como mudança planejada: confirme com acao=mudanca_confirmar. Nada foi aprovado, publicado nem gerado de arte.',
  mercado: 'A pesquisa com fonte real entrou no briefing (briefing.mercado). Leia com aceleriq_mes_campanhas.',
  roteiro_video: 'O roteiro ficou gravado na peça (roteiro_video) e na direção do vídeo.',
  trilha_estado: 'Para gerar: acao=trilha_gerar com confirmar_custo=true (o custo está em `custos`).',
  trilha_gerar: 'As trilhas ficam na aba Trilha da campanha; escolher a final é na tela.',
  pecas_para_ads: 'As peças viraram criativos em rascunho na Mesa Ads (mesmo trabalho do Estúdio). Nada foi à Meta.',
};

const campanhaAcaoTool: ToolDefinition = {
  name: 'aceleriq_mesa_campanha_acao',
  title: 'Campanha da Mesa: agir',
  description: 'As ações novas da campanha, como na tela: mudanca_planejar (o agente planeja a mudança, sem aplicar) e mudanca_confirmar/mudanca_desfazer, versao_voltar, reorganizar (linha do tempo da introdução ao encerramento; aplicar=true confirma o não protegido), mercado (pesquisa com fonte), roteiro_video (de uma peça), trilha_estado e trilha_gerar, pecas_para_ads (artes prontas viram criativos em rascunho na Mesa Ads). Peça aprovada ou publicada nunca muda. IA paga (mudanca_planejar, reorganizar, mercado, roteiro_video, trilha_gerar) exige confirmar_custo=true. Exige OAuth ou chave de dono admin/gestor; idempotency_key evita repetir.',
  scopes: ['mesas:write'],
  longRunning: true,
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      campanha_id: J_UUID('Campanha (aceleriq_mes_campanhas).'),
      acao: { type: 'string', enum: [...ACOES_DA_CAMPANHA] },
      mensagem: { type: 'string', maxLength: 4000, description: 'mudanca_planejar: o que mudar.' },
      mensagem_id: J_UUID('mudanca_confirmar/desfazer: o id devolvido pelo planejamento.'),
      acao_id: { type: 'string' },
      refs: { type: 'array', items: { type: 'string' }, description: 'mudanca_confirmar: só estes itens (apelidos).' },
      descartar: { type: 'boolean', description: 'mudanca_confirmar: descarta o plano.' },
      versao_id: { type: 'string', description: 'versao_voltar.' },
      data_evento: { type: 'string', description: 'reorganizar: AAAA-MM-DD do evento.' },
      dias_antes: { type: 'integer', description: 'reorganizar: dias de introdução antes do evento.' },
      fim: { type: 'string', description: 'reorganizar: AAAA-MM-DD do encerramento.' },
      aplicar: { type: 'boolean', description: 'reorganizar: aplica direto o que não é protegido.' },
      tema_id: { type: 'string', description: 'roteiro_video: a peça.' },
      duracao: { type: 'integer', description: 'trilha_gerar: segundos.' },
      opcoes: { type: 'integer', minimum: 2, maximum: 3, description: 'trilha_gerar: quantas trilhas.' },
      tema: { type: 'string' }, extra: { type: 'string' }, loop: { type: 'boolean' },
      pecas: {
        type: 'array', maxItems: 20, description: 'pecas_para_ads: artes prontas da campanha.',
        items: {
          type: 'object',
          properties: {
            trabalho_id: { type: 'string', format: 'uuid' }, formato: { type: 'string', enum: ['feed_4x5', 'quadrado_1x1', 'stories_9x16', 'carrossel'] },
            titulo: { type: 'string' }, tema_id: { type: 'string' }, sequencia_id: { type: 'string', format: 'uuid' }, fase: { type: 'string' }, data: { type: 'string' },
          },
          required: ['trabalho_id', 'formato'],
          additionalProperties: false,
        },
      },
      confirmar_custo: { type: 'boolean', description: 'true nas ações com IA paga.' },
      idempotency_key: J_CHAVE,
    },
    required: ['campanha_id', 'acao', 'idempotency_key'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    const i = validar(ENTRADA_DA_ACAO, input);
    const falta = faltaNaAcao(i);
    if (falta) throw new Error(`Invalid input: ${falta}`);
    const clientId = await clienteDaLinha('mesa_campanhas', i.campanha_id, 'campanha_id');
    await conferirCliente(clientId, ctx);
    return await umaVez('aceleriq_mesa_campanha_acao', ctx, i.idempotency_key, async () => {
      const { funcao, acao, corpo } = corpoDaAcao(i, clientId);
      const dados = await chamarMesa(funcao, acao, corpo, ctx);
      return {
        ref: `campanha:${i.campanha_id}`,
        resultado: { campanha_id: i.campanha_id, client_id: clientId, acao: i.acao, custo_usd: dados.custo_usd ?? 0, resultado_da_mesa: dados, proximo_passo: PROXIMO[i.acao] },
      };
    });
  },
};

export const FERRAMENTAS_DO_PAINEL_INTEIRO: readonly ToolDefinition[] = [
  guiaTool,
  panoramaDoClienteTool,
  panoramaDaCasaTool,
  campanhasTool,
  storiesTool,
  hypeTool,
  templatesTool,
  estudioTool,
  siteTool,
  laboratorioTool,
  baseTool,
  membrosTool,
  saudeTool,
  campanhaAcaoTool,
];
