/**
 * MCP 2.17 (22/10/2026): o MCP ensina a usar o painel.
 *
 * - FERRAMENTAS_POR_AREA: cada área do mapa do painel (_shared/mapa-do-painel.ts, a mesma fonte
 *   que os agentes leem) com as ferramentas do MCP que chegam nela. Área sem ferramenta diz isso,
 *   em vez de deixar o agente adivinhar.
 * - guiaDoPainel: o que a ferramenta aceleriq_guia devolve (mapa curto, regras, skills; ou o
 *   manual completo de UMA ferramenta).
 * - descricaoParaLista: a descrição curta que vai no tools/list. O manual inteiro continua em
 *   aceleriq_guia (ferramenta=...). Economiza contexto de quem conecta: a lista inteira caía em
 *   ~233 KB (~58 mil tokens) a cada conexão.
 * - RECURSOS e PROMPTS do protocolo MCP (resources/list, resources/read, prompts/list,
 *   prompts/get): texto estático, sem dado de cliente.
 */

import { AGENTES_DO_PAINEL, AREAS_DO_PAINEL, type AreaDoPainel } from '../../_shared/mapa-do-painel.ts';

export interface FerramentaDoGuia {
  name: string;
  title?: string;
  description: string;
  scopes: readonly string[];
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

const FIN = ['aceleriq_get_finance_dashboard', 'aceleriq_get_finance_overview', 'aceleriq_get_finance_billing', 'aceleriq_list_finance_expenses', 'aceleriq_list_finance_project_payments', 'aceleriq_get_finance_cash_flow', 'aceleriq_list_finance_mensalidades', 'aceleriq_get_finance_capital', 'aceleriq_get_finance_ads_investment', 'aceleriq_list_finance_history', 'aceleriq_list_finance_entries', 'aceleriq_get_finance_client_summaries', 'aceleriq_list_finance_plans', 'aceleriq_list_finance_recurring'];

/** Área do painel → ferramentas. Chaves = ChaveDaArea do mapa (mais 'memoria' e 'mcp'). */
export const FERRAMENTAS_POR_AREA: Record<string, string[]> = {
  dashboard: ['aceleriq_panorama_da_casa', 'aceleriq_search', 'aceleriq_fetch'],
  central: ['aceleriq_dia_prioritario', 'aceleriq_dia_prioritario_registrar', 'aceleriq_get_client_dossier', 'aceleriq_ritual_redigir'],
  ciclo: ['aceleriq_get_cycle_status', 'aceleriq_get_weekly_cycle', 'aceleriq_central_review_fila', 'aceleriq_central_review_preparar', 'aceleriq_central_review_decidir', 'aceleriq_central_review_marcar_enviado', 'aceleriq_aviso_publicacao_fila', 'aceleriq_aviso_publicacao_preparar', 'aceleriq_aviso_publicacao_decidir', 'aceleriq_aviso_publicacao_marcar_enviado'],
  clientes: ['aceleriq_list_clients', 'aceleriq_panorama_do_cliente', 'aceleriq_get_client_context', 'aceleriq_get_client_dossier', 'aceleriq_get_current_dossier', 'aceleriq_upsert_current_dossier', 'aceleriq_register_dossier_progress', 'aceleriq_update_client', 'aceleriq_cerebro_do_cliente', 'aceleriq_cerebro_registrar', 'aceleriq_client_instruction'],
  projetos: ['aceleriq_list_projects', 'aceleriq_get_project', 'aceleriq_create_project', 'aceleriq_update_project', 'aceleriq_archive_project', 'aceleriq_restore_project', 'aceleriq_link_project_to_client', 'aceleriq_get_project_memory', 'aceleriq_upsert_project_memory'],
  kanban: ['aceleriq_list_tasks', 'aceleriq_create_task', 'aceleriq_update_task', 'aceleriq_complete_task', 'aceleriq_reopen_task', 'aceleriq_delete_task'],
  calendario: ['aceleriq_list_editorial_calendar', 'aceleriq_get_agenda_status', 'aceleriq_create_editorial_item'],
  aprovacoes: ['aceleriq_estudio_trabalhos', 'aceleriq_mesa_enviar_para_aprovacao'],
  execucao: ['aceleriq_operator_board', 'aceleriq_operator_queue', 'aceleriq_operator_digest', 'aceleriq_operator_diary', 'aceleriq_operator_report', 'aceleriq_operator_checklist', 'aceleriq_operator_assign', 'aceleriq_operator_register', 'aceleriq_operator_organize', 'aceleriq_operator_request_approval', 'aceleriq_operator_propose_assignee', 'aceleriq_agent_conversations', 'aceleriq_agent_handoff', 'aceleriq_browser_session', 'aceleriq_browser_act', 'aceleriq_navegador_do_pc', 'aceleriq_acesso_usar', 'aceleriq_acesso_pedir', 'aceleriq_acesso_estado', 'aceleriq_studio_read', 'aceleriq_studio_draft'],
  pedidos: ['aceleriq_panorama_do_cliente', 'aceleriq_get_client_context'],
  briefings: ['aceleriq_list_briefings', 'aceleriq_get_briefing'],
  contratos: ['aceleriq_list_contracts', 'aceleriq_get_contract', 'aceleriq_create_contract', 'aceleriq_update_contract', 'aceleriq_cancel_contract'],
  arquivos: ['aceleriq_list_files', 'aceleriq_get_file', 'aceleriq_get_file_content', 'aceleriq_search_file_content', 'aceleriq_get_file_processing_status', 'aceleriq_upload_file', 'aceleriq_upload_file_inline', 'aceleriq_prepare_file_upload', 'aceleriq_finalize_file_upload', 'aceleriq_update_file_metadata', 'aceleriq_create_file_version', 'aceleriq_archive_file', 'aceleriq_restore_file'],
  workspace: ['aceleriq_list_workspace_nodes', 'aceleriq_get_workspace_node', 'aceleriq_studio_read', 'aceleriq_studio_draft'],
  metricas: ['aceleriq_get_social_metrics', 'aceleriq_list_social_posts', 'aceleriq_instagram_diagnostico'],
  anuncios: ['aceleriq_get_ads_campaigns', 'aceleriq_get_ads_creatives', 'aceleriq_get_ads_performance', 'aceleriq_ads_registrar_acao', 'aceleriq_ads_boletim'],
  relatorios: ['aceleriq_list_reports', 'aceleriq_get_report', 'aceleriq_create_report_draft'],
  comercial: ['aceleriq_list_opportunities', 'aceleriq_get_opportunity', 'aceleriq_create_opportunity', 'aceleriq_update_opportunity', 'aceleriq_move_opportunity', 'aceleriq_add_opportunity_note', 'aceleriq_archive_opportunity', 'aceleriq_delete_opportunity', 'aceleriq_list_commercial_activities', 'aceleriq_create_commercial_activity', 'aceleriq_complete_commercial_activity', 'aceleriq_list_commercial_organizations', 'aceleriq_upsert_commercial_organization', 'aceleriq_upsert_commercial_contact', 'aceleriq_comercial_fila', 'aceleriq_comercial_registrar_mensagem', 'aceleriq_comercial_avisar_caixa', 'aceleriq_comercial_registrar_fato', 'aceleriq_comercial_atribuir_agente', 'aceleriq_comercial_maquina_buscar', 'aceleriq_comercial_maquina_candidatos', 'aceleriq_membros'],
  mesa: ['aceleriq_mes_campanhas', 'aceleriq_mesa_campanha_acao', 'aceleriq_mesa_campanha_criar', 'aceleriq_mesa_campanha_salvar', 'aceleriq_mesa_calendario_pedido', 'aceleriq_mesa_calendario_gravar', 'aceleriq_mesa_stories', 'aceleriq_mesa_hype', 'aceleriq_mesa_templates', 'aceleriq_estudio_trabalhos', 'aceleriq_mesa_enviar_para_aprovacao', 'aceleriq_cerebro_do_cliente', 'aceleriq_client_instruction'],
  mesa_ads: ['aceleriq_mesa_ads_contexto', 'aceleriq_mesa_ads_saude', 'aceleriq_mesa_ads_briefing_salvar', 'aceleriq_mesa_ads_oferta_salvar', 'aceleriq_mesa_ads_oferta_do_contexto', 'aceleriq_mesa_ads_plano_gerar', 'aceleriq_mesa_ads_criativos_produzir', 'aceleriq_mesa_ads_arte_gerar', 'aceleriq_mesa_ads_entregar_ao_gestor', 'aceleriq_mesa_campanha_acao', 'aceleriq_ads_registrar_acao', 'aceleriq_ads_boletim'],
  mesa_foto: ['aceleriq_mesa_foto_contexto'],
  mesa_site: ['aceleriq_mesa_site'],
  laboratorio: ['aceleriq_laboratorio'],
  financeiro: FIN,
  financeiro_cfo: FIN,
  cofre: ['aceleriq_vault_overview', 'aceleriq_acesso_usar', 'aceleriq_acesso_pedir', 'aceleriq_acesso_estado'],
  memoria: ['memory_get_context', 'memory_search', 'memory_fetch', 'memory_list_pending_proposals', 'memory_get_pulse', 'memory_recent_commits', 'memory_propose_update', 'aceleriq_base_dos_agentes'],
  mcp: ['aceleriq_guia', 'aceleriq_health', 'aceleriq_capabilities', 'aceleriq_mcp_saude', 'aceleriq_audit_integrity'],
};

/** Regras de ação que valem para toda ferramenta que muda alguma coisa. */
export const REGRAS_DE_ACAO = [
  'Leia antes de agir: comece por aceleriq_panorama_do_cliente (cliente) ou aceleriq_panorama_da_casa (dia da agência).',
  'Ação nas mesas roda com a sessão de uma pessoa (OAuth) ou da chave de um dono admin/gestor; chave sem dono só lê.',
  'IA paga só com confirmar_custo=true: diga o custo ao dono antes. Nada publica, agenda post ou gasta verba de anúncio pelo MCP.',
  'Toda ação pede idempotency_key: repetir a mesma chave não refaz nada (24 h). Em tempo esgotado, confira pela leitura ANTES de repetir.',
  'Erro com transitorio=true: espere alguns segundos e tente UMA vez. Conflito (versão mudou, já decidido) não se repete: leia de novo.',
  'Leituras vêm enxutas; detalhe="completo" traz tudo. Listas longas: use proximo_cursor.',
  'Assinatura (2.19): operator só pode ser um agente da sua credencial; outro vira o padrão da credencial, com aviso_de_autoria.',
  'Feito só com prova (2.19): done leva em evidence o permalink do post, ads_acao:<id>, envio:<id> ou aceleriq-file://<id>; sem prova vira revisão.',
  'Anúncios (2.19): toda ação feita na conta (Composio ou à mão) vai para aceleriq_ads_registrar_acao; o boletim das 9h e 17h30, para aceleriq_ads_boletim (um aviso no sino, página /anuncios/hoje).',
  'Diário (2.19): leia com desde (só o novo), no máximo 30 vezes por minuto por vínculo; responda com reply_to_entry_id; texto repetido sem fato novo não é registrado.',
  'Tarefas (2.19): quem traz tarefa de outro sistema manda origem_externa (ex.: paperclip:ACE-275); título igual de tarefa aberta no projeto devolve a existente.',
  'Navegador do PC (2.20, Hermes e Paperclip, credencial da equipe): conta que o dono já usa logado no PC (gerenciador de anúncios da Meta, Instagram, Google) vai por aceleriq_navegador_do_pc, sem senha nem código: acao pedir com os passos (navegar primeiro, depois ler; ex.: [{"acao":"navegar","url":"https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=<conta>"},{"acao":"esperar","ms":5000},{"acao":"ler"}]), responde na hora com pedido_id; depois acao resultado com o pedido_id a cada 15 a 30 s (texto lido, URL e prints). Ler é livre; clicar em publicar, salvar, ativar, pausar ou apagar e digitar fora de busca só com aprovacao_id aprovado. Resposta navegador_do_pc_indisponivel = PC desligado: não repita, siga com outra tarefa. sessao_expirada = o dono entra de novo naquele site no Ego; avise no diário.',
  'Horário comercial (2.21): o Ego (aceleriq_navegador_do_pc) só roda das 9h às 18h, seg a sex (São Paulo). Fora disso, trabalhe na nuvem: leia pelo painel e pelo MCP, analise, prepare pauta, rascunho e proposta de ajuste (com aceleriq_operator_request_approval quando muda a conta) e já peça ao Ego o que precisa: o pedido volta estado "agendada" com agendado_para e nao_insistir=true, roda na abertura por prioridade (alta, normal, baixa) e o resultado fica guardado; leia com acao resultado depois de agendado_para. Aprovação pode ser pedida e dada de noite; o clique acontece na janela.',
  'Nada parado (2.21): tarefa travada por mais de 1 dia útil vira pedido claro ao dono no painel (aceleriq_operator_request_approval ou insumo, dizendo o que falta e o que você já preparou) ou é encerrada com o motivo. Nunca deixe tarefa esperando sem pedido aberto; não repita pedido que já está aberto.',
];

/** Skills e jeitos da casa que o agente deve seguir ao produzir (nomes das skills do Claude Code). */
export const SKILLS_DA_CASA = [
  { skill: 'aceleriq-conteudo', quando: 'roteiro, gancho, Reel e motion da Aceleriq e dos clientes' },
  { skill: 'trilha-cinematografica', quando: 'trilha de vídeo com música' },
  { skill: 'legenda na voz da Aceleriq', quando: 'post de cliente: a Aceleriq conta "como a gente fez", com @ do cliente' },
  { skill: 'instagram-skills', quando: 'legenda (gancho nos 125 primeiros caracteres), carrossel, 3 a 5 hashtags' },
  { skill: 'claude-ads', quando: 'tráfego pago: auditoria e plano, só leitura e rascunho' },
  { skill: 'typesafe (Jev)', quando: 'escolher, ranquear, classificar ou conferir texto: o painel já usa o Jev nas mesas' },
];

function normalizar(t: string) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function areaPedida(area: string): AreaDoPainel | { chave: string; nome: string; rota: string; faz: string } | null {
  const n = normalizar(area).replace(/[\s-]+/g, '_');
  const achada = AREAS_DO_PAINEL.find((a) => a.chave === n || normalizar(a.nome).replace(/[\s-]+/g, '_') === n);
  if (achada) return achada;
  if (n === 'memoria') return { chave: 'memoria', nome: 'Segundo Cérebro e base dos agentes', rota: '/base-dos-agentes', faz: 'memória da casa e o que os agentes aprenderam' };
  if (n === 'mcp') return { chave: 'mcp', nome: 'O próprio MCP', rota: '/conectar-mcp', faz: 'saúde, catálogo e guia' };
  return null;
}

function linhaDaArea(a: { chave: string; nome: string; rota: string; faz: string; agente?: string; soPessoa?: boolean }, existentes: Set<string>) {
  const ferramentas = (FERRAMENTAS_POR_AREA[a.chave] ?? []).filter((n) => existentes.size === 0 || existentes.has(n));
  const agente = a.agente ? AGENTES_DO_PAINEL.find((g) => g.chave === a.agente) : null;
  return {
    area: a.chave,
    nome: a.nome,
    rota: a.rota,
    faz: a.faz,
    ...(agente ? { agente: `${agente.nome} (${agente.faz})` } : {}),
    ...(a.soPessoa ? { so_pessoa: true } : {}),
    ferramentas: ferramentas.length ? ferramentas : 'sem ferramenta própria no MCP ainda: leia pelo panorama ou converse com o agente da área (aceleriq_agent_conversations)',
  };
}

export function guiaDoPainel(input: { area?: string; ferramenta?: string }, catalogo: readonly FerramentaDoGuia[]) {
  const existentes = new Set(catalogo.map((t) => t.name));
  if (input.ferramenta) {
    const pedida = input.ferramenta.trim();
    const t = catalogo.find((x) => x.name === pedida);
    if (!t) {
      const parecidas = catalogo.map((x) => x.name).filter((n) => n.includes(normalizar(input.ferramenta ?? '').replace(/^aceleriq_/, '').split('_')[0] ?? '')).slice(0, 8);
      return { encontrada: false, mensagem: `Ferramenta "${input.ferramenta}" não existe nesta versão.`, parecidas };
    }
    const areas = Object.entries(FERRAMENTAS_POR_AREA).filter(([, l]) => l.includes(t.name)).map(([k]) => k);
    return { encontrada: true, nome: t.name, titulo: t.title ?? null, manual: t.description, escopos: t.scopes, so_leitura: t.annotations?.readOnlyHint === true, areas, entrada: t.inputSchema };
  }
  if (input.area) {
    const a = areaPedida(input.area);
    if (!a) return { encontrada: false, mensagem: `Área "${input.area}" não existe.`, areas: [...AREAS_DO_PAINEL.map((x) => x.chave), 'memoria', 'mcp'] };
    return { encontrada: true, ...linhaDaArea(a, existentes), regras: REGRAS_DE_ACAO };
  }
  return {
    comece_por: ['aceleriq_panorama_do_cliente', 'aceleriq_panorama_da_casa'],
    regras: REGRAS_DE_ACAO,
    areas: [...AREAS_DO_PAINEL, areaPedida('memoria')!, areaPedida('mcp')!].map((a) => linhaDaArea(a as AreaDoPainel, existentes)),
    skills_da_casa: SKILLS_DA_CASA,
    manual: 'aceleriq_guia com ferramenta="<nome>" devolve a descrição inteira e os campos de uma ferramenta.',
  };
}

// ─── Descrição curta no tools/list ──────────────────────────────

/** Ferramentas cujo texto é regra de trabalho do Hermes: vão inteiras, sempre. */
export const DESCRICAO_INTEIRA = new Set([
  'aceleriq_operator_diary',
  'aceleriq_operator_report',
  'aceleriq_acesso_pedir',
  'aceleriq_acesso_usar',
  'aceleriq_central_review_decidir',
  'aceleriq_operator_request_approval',
]);

export const TETO_DA_DESCRICAO = 400;
/** Descrição de campo no inputSchema da lista: até este tamanho (o esquema inteiro segue no guia). */
export const TETO_DO_CAMPO = 200;

/** Corta no fim de frase até o teto e aponta para o manual completo. */
export function descricaoCurta(nome: string, descricao: string, teto = TETO_DA_DESCRICAO): string {
  const d = String(descricao ?? '').trim();
  if (DESCRICAO_INTEIRA.has(nome) || d.length <= teto) return d;
  const sufixo = ` (Manual completo: aceleriq_guia ferramenta="${nome}".)`;
  const corte = d.slice(0, teto - sufixo.length - 1);
  const fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('.\n'), corte.lastIndexOf(': '));
  const base = fim > teto / 3 ? corte.slice(0, fim + 1) : `${corte.trimEnd()}…`;
  return `${base}${sufixo}`;
}

type Descritor = Record<string, unknown> & { name: string; description?: string; securitySchemes?: unknown; _meta?: Record<string, unknown> };

const ESQUEMA_OAUTH_CURTO = [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }];

/** Copia o esquema cortando só os textos `description` longos dos campos (tipos e regras intactos). */
export function esquemaEnxuto(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(esquemaEnxuto);
  if (!v || typeof v !== 'object') return v;
  const saida: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    saida[k] = k === 'description' && typeof x === 'string' && x.length > TETO_DO_CAMPO ? `${x.slice(0, TETO_DO_CAMPO - 1).trimEnd()}…` : esquemaEnxuto(x);
  }
  return saida;
}

/**
 * O descritor do tools/list, enxuto: descrição curta e o esquema de segurança sem o parágrafo
 * repetido em todas as ferramentas (ia duas vezes por ferramenta, ~56 KB no total).
 */
export function descritorEnxuto(d: Descritor): Descritor {
  const oauth = Array.isArray(d.securitySchemes) && (d.securitySchemes as Array<{ type?: string }>).some((s) => s?.type === 'oauth2');
  const seguranca = oauth ? ESQUEMA_OAUTH_CURTO : d.securitySchemes;
  return {
    ...d,
    description: descricaoCurta(d.name, String(d.description ?? '')),
    inputSchema: DESCRICAO_INTEIRA.has(d.name) ? d.inputSchema : esquemaEnxuto(d.inputSchema),
    securitySchemes: seguranca,
    _meta: { ...(d._meta ?? {}), securitySchemes: seguranca },
  };
}

// ─── Recursos e prompts do protocolo MCP ────────────────────────

export interface Recurso { uri: string; name: string; title: string; description: string; mimeType: string }

export const RECURSOS: readonly Recurso[] = [
  { uri: 'aceleriq://mapa-do-painel', name: 'mapa-do-painel', title: 'Mapa do painel', description: 'Cada área do painel (rota, o que faz, agente) e as ferramentas do MCP que chegam nela.', mimeType: 'text/markdown' },
  { uri: 'aceleriq://regras-de-acao', name: 'regras-de-acao', title: 'Regras de ação', description: 'Custo, confirmação, idempotência, sessão da pessoa e o que nunca se faz pelo MCP.', mimeType: 'text/markdown' },
  { uri: 'aceleriq://skills-da-casa', name: 'skills-da-casa', title: 'Skills da casa', description: 'Os jeitos de produzir da Aceleriq (conteúdo, trilha, legenda, anúncios, Jev).', mimeType: 'text/markdown' },
];

export function lerRecurso(uri: string, catalogo: readonly FerramentaDoGuia[]): { uri: string; mimeType: string; text: string } | null {
  if (uri === 'aceleriq://mapa-do-painel') {
    const g = guiaDoPainel({}, catalogo) as { areas: Array<{ nome: string; rota: string; faz: string; agente?: string; ferramentas: string[] | string }> };
    const linhas = g.areas.map((a) => `## ${a.nome} (${a.rota})\n${a.faz}${a.agente ? `\nAgente: ${a.agente}` : ''}\nFerramentas: ${Array.isArray(a.ferramentas) ? a.ferramentas.join(', ') : a.ferramentas}`);
    return { uri, mimeType: 'text/markdown', text: `# Mapa do painel Aceleriq\n\nComece por aceleriq_panorama_do_cliente ou aceleriq_panorama_da_casa.\n\n${linhas.join('\n\n')}\n` };
  }
  if (uri === 'aceleriq://regras-de-acao') {
    return { uri, mimeType: 'text/markdown', text: `# Regras de ação\n\n${REGRAS_DE_ACAO.map((r) => `- ${r}`).join('\n')}\n` };
  }
  if (uri === 'aceleriq://skills-da-casa') {
    return { uri, mimeType: 'text/markdown', text: `# Skills da casa\n\n${SKILLS_DA_CASA.map((s) => `- **${s.skill}**: ${s.quando}`).join('\n')}\n` };
  }
  return null;
}

export interface Prompt { name: string; title: string; description: string; arguments: Array<{ name: string; description: string; required: boolean }> }

export const PROMPTS: readonly Prompt[] = [
  { name: 'panorama_do_cliente', title: 'Como está o cliente', description: 'Retrato do cliente numa chamada e o que fazer agora.', arguments: [{ name: 'client_id', description: 'UUID do cliente', required: true }] },
  { name: 'dia_da_agencia', title: 'Dia da agência', description: 'O que está atrasado, travado e esperando aprovação hoje.', arguments: [] },
  { name: 'revisar_campanha', title: 'Revisar uma campanha', description: 'Lê a campanha inteira e propõe a mudança (sem aplicar).', arguments: [{ name: 'campanha_id', description: 'UUID da campanha', required: true }, { name: 'client_id', description: 'UUID do cliente', required: true }] },
  { name: 'diagnosticar_falha', title: 'Por que falhou?', description: 'Descobre se a falha é da ferramenta, da entrada ou da rede.', arguments: [{ name: 'ferramenta', description: 'Nome da ferramenta que falhou', required: false }] },
];

export function montarPrompt(nome: string, args: Record<string, unknown>): { description: string; messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> } | null {
  const a = (k: string) => String(args?.[k] ?? '').trim();
  const msg = (text: string) => [{ role: 'user' as const, content: { type: 'text' as const, text } }];
  switch (nome) {
    case 'panorama_do_cliente':
      if (!a('client_id')) return null;
      return { description: 'Retrato do cliente', messages: msg(`Chame aceleriq_panorama_do_cliente com client_id=${a('client_id')}. Depois, em português simples e frases curtas: o que está bem, o que está atrasado ou travado (com o porquê) e os 3 próximos passos, cada um com a ferramenta que resolve. Se alguma parte vier em "faltou", diga qual.`) };
    case 'dia_da_agencia':
      return { description: 'Dia da agência', messages: msg('Chame aceleriq_panorama_da_casa. Liste o que vence hoje, o que está atrasado, o que espera aprovação do dono na Execução e o funil comercial. Termine com as 5 prioridades do dia, em ordem.') };
    case 'revisar_campanha':
      if (!a('campanha_id') || !a('client_id')) return null;
      return { description: 'Revisar campanha', messages: msg(`Leia a campanha com aceleriq_mes_campanhas (client_id=${a('client_id')}, campanha_id=${a('campanha_id')}) e o cérebro do cliente com aceleriq_cerebro_do_cliente. Aponte o que falta (fases da linha do tempo sem peça, artes sem aprovação, trilha, mercado). Proponha a mudança em texto; só chame aceleriq_mesa_campanha_acao (mudanca_planejar, com confirmar_custo=true) depois que o dono aprovar o custo.`) };
    case 'diagnosticar_falha':
      return { description: 'Diagnóstico', messages: msg(`Chame aceleriq_mcp_saude${a('ferramenta') ? ` e aceleriq_guia com ferramenta="${a('ferramenta')}"` : ''}. Diga se a falha é de entrada (campo errado), de permissão, de conflito (não repetir) ou transitória (repetir uma vez), e o que fazer.`) };
  }
  return null;
}
