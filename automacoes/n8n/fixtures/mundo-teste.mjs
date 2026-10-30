// Mundo de TESTE (fixture sanitizada). Estrutura espelha o que o MCP 2.9.0 devolve, com textos
// genéricos e sem dado pessoal. IDs de empresas reais aparecem só como identificadores de escopo.
// Nada disto é dado vivo: serve aos testes e ao servidor de replay local (tools/mcp-replay-teste.mjs).

export const IDS = {
  mirante: 'eb1270a5-4d9e-4c67-bb17-e25fa12ada34',
  miranteProjeto: '6f06e0ae-b72b-424a-a675-6efd5adbcdd1',
  miranteIG: '67588009-db0f-4433-b66c-3b3b72d04504',
  acerbi: '39ebda82-637c-498b-a23a-b622f645e852',
  acerbiProjeto: '1a55e3e5-c823-4cc9-8e26-1ba14396219a',
  cmeProjeto: 'a220d8f6-0259-41b5-aaa4-eb1ef5435fb1',
  acerbiIG: '168cc115-efc0-401f-bd32-335cd928755c',
  cmeIG: 'd1bcc512-c3d0-4d76-8667-29cbf8f94e29',
  cmeIGDuplicada: '1ee957ad-d300-40b9-9a4c-c70c990252cb',
  stop: '6a847578-ba39-44cd-be61-08e34e18e4c9',
  paraSi: '20c96cea-6ada-4db5-a408-25a3b0c978ba',
  outro: '11111111-1111-4111-8111-111111111111',
  usuarioEquipe: 'aaaaaaaa-0000-4000-8000-000000000001',
};

const h = (ms) => new Date(ms).toISOString();
const dia = (ms) => h(ms).slice(0, 10);

export function criarMundo(agoraMs = Date.parse('2026-10-14T14:10:00Z')) {
  const H = 3600000, D = 86400000;
  const I = IDS;
  const mundo = {
    agoraMs,
    clientes: {
      [I.mirante]: { nome: 'Mirante Luz Floripa', dia: 3, situacao: 'confirmado' },
      [I.acerbi]: { nome: 'Acerbi', dia: 3, situacao: 'confirmado' },
      [I.stop]: { nome: 'Stop Informatica', dia: 2, situacao: 'provisorio' },
      [I.paraSi]: { nome: 'Para Si Ótica', dia: null, situacao: 'nao_aplicavel' },
      [I.outro]: { nome: 'Cliente Fixture', dia: 3, situacao: 'confirmado' },
    },
    dossies: {
      [I.mirante]: { version: 132, project_id: null, updated_at: h(agoraMs - 15 * H), summary: 'Resumo genérico de teste.', content: '# Dossiê de teste\n\nConteúdo genérico.\n' },
      [I.outro]: { version: 7, project_id: null, updated_at: h(agoraMs - 30 * H), summary: 'Outro cliente.', content: '# Outro\n' },
      [I.acerbi]: { version: 40, project_id: null, updated_at: h(agoraMs - 30 * H), summary: 'Acerbi teste.', content: '# Acerbi\n' },
    },
    memoria: {
      [I.mirante]: [
        { id: 'm-dec-1', kind: 'decisao', source: 'agente-central', created_by: I.usuarioEquipe, created_at: h(agoraMs - 7 * D), title: 'Respostas ao agente da Central',
          content: 'As pautas prontas sem data já foram aprovadas pela cliente para agendamento?\nainda não, aguardando retorno\n\nAs imagens reais do café da manhã e da collab já chegaram e foram aprovadas?\nsim' },
        { id: 'm-dec-2', kind: 'decisao', source: 'mcp', created_by: null, created_at: h(agoraMs - 4 * D), title: 'Regra permanente — dias de publicação', content: 'Regra registrada (texto de teste).' },
        { id: 'm-rit-1', kind: 'ritual', source: 'central', created_by: I.usuarioEquipe, created_at: h(agoraMs - 4 * D - 17 * H), title: 'Semana fecha com anúncios em alta' },
      ],
    },
    relatorios: {
      [I.mirante]: [
        { id: 'r-pub-sexta', project_id: I.miranteProjeto, client_id: I.mirante, title: 'Semana fecha com anúncios em alta', status: 'published', created_at: h(agoraMs - 4 * D - 17 * H),
          period_start: null, period_end: null, metrics: { ritual_type: 'prova_movimento', sent_channel: 'portal', sent_at: h(agoraMs - 4 * D - 17 * H) }, review_version: 2 },
        { id: 'r-draft-interno', project_id: I.miranteProjeto, client_id: I.mirante, title: 'Preparação interna | semana anterior', status: 'draft', created_at: h(agoraMs - 4 * D - 18 * H),
          period_start: null, period_end: null, metrics: {}, review_version: 1 },
        { id: 'r-draft-abertura', project_id: I.miranteProjeto, client_id: I.mirante, title: 'Abertura da semana anterior', status: 'draft', created_at: h(agoraMs - 9 * D),
          period_start: null, period_end: null, metrics: {}, review_version: 2 },
        { id: 'r-pub-segunda-ant', project_id: I.miranteProjeto, client_id: I.mirante, title: 'Semana começa com campanha nova', status: 'published', created_at: h(agoraMs - 9 * D + 2 * H),
          period_start: null, period_end: null, metrics: { ritual_type: 'rota_semana', sent_channel: 'portal' }, review_version: 2 },
      ],
    },
    fila: {
      esperando_decisao: [
        { approval_id: 'aaaa0000-0000-4000-8000-00000000a001', report_id: 'r-draft-abertura', client_id: I.mirante, cliente: 'Mirante Luz Floripa', titulo: 'Abertura da semana anterior',
          ritual: null, mensagem: 'Texto antigo', proximo_passo: 'x', destino: 'Mirante Luz Floripa - MKT - Aceleriq', payload_version: 2, payload_hash: 'f'.repeat(64), valid_until: h(agoraMs - 2 * D - 3 * H) },
        { approval_id: 'aaaa0000-0000-4000-8000-00000000a099', report_id: 'r-outro', client_id: I.outro, cliente: 'Cliente Fixture', titulo: 'Outro', ritual: 'meio_semana',
          mensagem: 'Não pode vazar', proximo_passo: 'x', destino: 'Grupo Outro', payload_version: 1, payload_hash: 'e'.repeat(64), valid_until: h(agoraMs + 5 * D) },
      ],
      aprovados_para_enviar: [],
      rascunhos_sem_pedido: [],
      enviados_recentes: [],
    },
    agenda: {
      [I.mirante]: {
        scheduled: [],
        published_last_7_days: [{ publication_id: 'fbb5987d-3339-43cc-905d-5e096a0a2ec2', post_id: 'p-mirante-1', title: 'Consultar valores e disponibilidade para datas reais', platform: 'instagram', published_at: h(agoraMs - 6 * D), permalink: 'https://www.instagram.com/p/DePGZpPFk6m/' }],
        ready_without_date: [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'pronta-' + n, title: 'Pauta pronta de teste ' + n, content_type: 'carousel' })),
        without_art: [],
      },
      [I.acerbi]: { scheduled: [{ publication_id: 'pub-cme-agendada', post_id: 'p-cme-2', title: 'Agendada CME', platform: 'instagram', scheduled_at: h(agoraMs + 9 * H) }], published_last_7_days: [], ready_without_date: [], without_art: [] },
      [I.outro]: { scheduled: [], published_last_7_days: [], ready_without_date: [], without_art: [] },
    },
    calendario: {},
    posts: {},
    tarefas: {},
    board: {
      resumo: { em_andamento: 1, feitas_com_evidencia: 3, em_revisao: 23, aguardando_insumo: 0, bloqueadas: 5, aprovacoes_pendentes: 0, kanban_abertas: 100, sem_operador: 10, incidentes: 7, execucoes_sem_heartbeat: 0 },
      operadores: [{ slug: 'default', nome: 'Hermes Core', situacao: 'active', ultima_execucao: h(agoraMs - 46 * D) }, { slug: 'augusto', nome: 'Augusto', situacao: 'active', ultima_execucao: h(agoraMs - 30 * H) }],
    },
    ads: { [I.mirante]: { auditoria: null, memoria: null } },
    escritas: [],
    falhas: {},
  };

  // Calendário publicado: Mirante (válida), Acerbi (institucional) e CME (outra conta, mesmo cliente).
  const pubMirante = { id: 'fbb5987d-3339-43cc-905d-5e096a0a2ec2', project_id: I.miranteProjeto, external_account_id: I.miranteIG, platform: 'instagram', status: 'published',
    published_at: h(agoraMs - 6 * D), scheduled_at: h(agoraMs - 6 * D), permalink: 'https://www.instagram.com/p/DePGZpPFk6m/',
    account: { id: I.miranteIG, platform: 'instagram', handle: '@miranteluzfloripa', display_name: 'Mirante Luz', status: 'active' } };
  mundo.calendario[I.mirante] = [
    { kind: 'editorial_post', calendar_date: dia(agoraMs - 6 * D), project: { id: I.miranteProjeto, name: 'Mirante | Conteúdo' },
      post: { id: 'p-mirante-1', title: 'Consultar valores e disponibilidade para datas e número de hóspedes reais.', content_type: 'static',
        objective: 'Arte do Estúdio (Mesa do cliente). Post direto de conversão: apresenta a consulta como próximo passo para quem já está organizando a viagem.',
        default_caption: 'Legenda genérica de teste.', publications: [pubMirante] } },
  ];
  mundo.posts[I.mirante] = [
    { client_id: I.mirante, media_id: '18169031185477827', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/DePGZpPFk6m/', posted_at: h(agoraMs - 6 * D - 2 * 60000), reach: 29, total_interactions: 5, captured_at: h(agoraMs - 30 * 60000), external_account_id: I.miranteIG },
    { client_id: I.mirante, media_id: '17896484178672527', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/Dd6gCqqDgbF/', posted_at: h(agoraMs - 14 * D), reach: 52, total_interactions: 5, captured_at: h(agoraMs - 30 * 60000), external_account_id: I.miranteIG },
    { client_id: I.mirante, media_id: 'img-old-2', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/AAAAAAA2/', posted_at: h(agoraMs - 30 * D), reach: 40, total_interactions: 3, captured_at: h(agoraMs - 30 * 60000), external_account_id: I.miranteIG },
    { client_id: I.mirante, media_id: 'img-old-3', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/AAAAAAA3/', posted_at: h(agoraMs - 40 * D), reach: 61, total_interactions: 4, captured_at: h(agoraMs - 30 * 60000), external_account_id: I.miranteIG },
  ];
  const contaAcerbi = { id: I.acerbiIG, platform: 'instagram', handle: '@acerbispc', status: 'active' };
  const contaCME = { id: I.cmeIG, platform: 'instagram', handle: '@cmeacerbi2025', status: 'active' };
  mundo.calendario[I.acerbi] = [
    { kind: 'editorial_post', calendar_date: dia(agoraMs - 2 * H), project: { id: I.cmeProjeto, name: 'CME Acerbi' },
      post: { id: 'p-cme-1', title: 'Post CME de teste', content_type: 'carousel', objective: 'Convida empreendedoras para o encontro.', publications: [
        { id: 'pub-cme-1', project_id: I.cmeProjeto, external_account_id: I.cmeIG, platform: 'instagram', status: 'published', published_at: h(agoraMs - 2 * H), scheduled_at: h(agoraMs - 2 * H),
          permalink: 'https://www.instagram.com/p/DeehdCCgO_7/', account: contaCME }] } },
    { kind: 'editorial_post', calendar_date: dia(agoraMs - 3 * H), project: { id: I.acerbiProjeto, name: 'Acerbi institucional' },
      post: { id: 'p-acerbi-1', title: 'Post Acerbi institucional', content_type: 'static', objective: 'Mostra o serviço.', publications: [
        { id: 'pub-acerbi-1', project_id: I.acerbiProjeto, external_account_id: I.acerbiIG, platform: 'instagram', status: 'published', published_at: h(agoraMs - 3 * H), scheduled_at: h(agoraMs - 3 * H),
          // ERRADO de propósito: o permalink é o do post da CME (conta errada)
          permalink: 'https://www.instagram.com/p/DeehdCCgO_7/', account: contaAcerbi }] } },
    { kind: 'editorial_post', calendar_date: dia(agoraMs + 9 * H), project: { id: I.cmeProjeto, name: 'CME Acerbi' },
      post: { id: 'p-cme-2', title: 'Agendada CME', content_type: 'static', publications: [
        { id: 'pub-cme-agendada', project_id: I.cmeProjeto, external_account_id: I.cmeIG, platform: 'instagram', status: 'scheduled', published_at: null, scheduled_at: h(agoraMs + 9 * H), permalink: null, account: contaCME }] } },
  ];
  mundo.posts[I.acerbi] = [
    { client_id: I.acerbi, media_id: '18133024294727437', media_type: 'CAROUSEL_ALBUM', permalink: 'https://www.instagram.com/p/DeehdCCgO_7/', posted_at: h(agoraMs - 2 * H), reach: 10, captured_at: h(agoraMs - 10 * 60000), external_account_id: I.cmeIG },
  ];

  // Tarefas: 58 abertas na Mirante, 30 vencidas (paginação de 25 por página exige 3 páginas).
  const tarefas = [];
  for (let n = 0; n < 58; n++) {
    const vencida = n < 30;
    tarefas.push({ id: 't-' + String(n).padStart(3, '0'), title: n === 3 ? 'Atualizar agenda com status e datas reais' : 'Tarefa de teste ' + n, status: n % 3 ? 'doing' : 'todo',
      priority: n < 6 ? 'urgent' : 'medium', due_date: vencida ? dia(agoraMs - (33 - n) * D) : dia(agoraMs + (n - 29) * D), assigned_to: I.usuarioEquipe, client_id: I.mirante });
  }
  mundo.tarefas[I.mirante] = tarefas;
  return mundo;
}
