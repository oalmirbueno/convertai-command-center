/**
 * Central de Automações (19/11/2026): o guia de como trabalhar no n8n da Aceleriq. Sem import nenhum:
 * o MCP (aceleriq_automacoes_guia) e a tela /automacoes (aba "Para as IAs") leem o mesmo texto.
 * Nunca ponha segredo aqui.
 */
export const GUIA_DO_N8N = {
  enderecos: {
    editor: 'https://n8n-recovery.srv1769409.hstgr.cloud (login do dono; agente não entra no editor)',
    webhooks: 'https://n8n.aceleriq.com.br/webhook/<caminho> (Worker da Cloudflare aceleriq-n8n-porta: só /webhook/* e /healthz)',
    api_publica: 'https://n8n-recovery.srv1769409.hstgr.cloud/api/v1 (a chave mora só no segredo N8N_API_KEY das funções do painel; nunca peça nem copie)',
  },
  onde_roda: 'VPS do Hermes, /docker/n8n-recovery, container n8n-recovery-n8n-1 (n8n 2.47.7, SQLite no volume n8n-recovery_n8n_data, fuso America/Sao_Paulo).',
  grupos: {
    'Clientes': 'falam com cliente nos grupos (mensagem da semana, post no ar, leitura e resumo das conversas, radar e relatório de anúncios)',
    'Comercial': 'Rafael/Mercúrio no WhatsApp oficial (primeiro contato, respostas, repasse)',
    'Instagram': 'comentários e Direct da Aceleriq',
    'Apoio': 'ponte com o painel, registro de falhas e teste de saúde: não desligar, os outros dependem deles',
    'Grupos DK': 'plataforma de sorteios do cliente DK',
    'Desligado: o Hermes já faz': 'ACQ-01 e ACQ-02 ficam desligados de propósito (o Hermes faz o mesmo)',
  },
  codigo_fonte: 'Repositório lf-N8N em C:\\AI\\lf-N8N\\automacoes\\n8n (branch comercial-whatsapp). Fluxo nasce de build/gerar.mjs + lib/*.js; nunca edite fluxo de produção à mão no editor.',
  regras: [
    'Repositório travado: gerar sempre em modo simulado; modo real só com --ao-vivo "ACQ-06,ACQ-07,ACQ-09" (a lista que está ao vivo).',
    'Atualizar um fluxo publicado: desligar (unpublish) -> importar (servidor/n8n-reconstrucao/importar-pelo-cli.mjs; o antigo tools/importar-homologacao.mjs só funciona com o MCP da instância ligado) -> ligar (publish). O importador recusa fluxo ligado.',
    'Desligar fluxo de Clientes, Comercial ou Instagram tem efeito no cliente: só com ordem do dono.',
    'Nada de segredo em fluxo, arquivo, commit, log ou mensagem. Credenciais têm id fixo AcqCred... e são criadas por criar-credenciais.mjs.',
    'Ler execução: use aceleriq_automacoes_execucoes (caminho e erro já mascarado). Não abra o SQLite do servidor sem precisar.',
    'Sub-workflow só roda fora do modo manual se estiver publicado; errorWorkflow exige o fluxo de erro publicado.',
  ],
  ferramentas: {
    aceleriq_automacoes_listar: 'todos os fluxos por grupo, ligado ou não, última e próxima execução, erros em 24 h',
    aceleriq_automacoes_saude: 'n8n, porta dos webhooks, ponte do 3429, leitor dos grupos, timers, vigia, disco e vencimentos',
    aceleriq_automacoes_execucoes: 'últimas execuções de um fluxo com o caminho e onde parou; desenho do fluxo se pedir',
    aceleriq_automacoes_ligar_desligar: 'só com escopo automacoes:write, confirmar:true e motivo',
  },
  painel: 'Tela /automacoes (Agentes > Automações): mesma informação, com o botão ligar/desligar do dono.',
};
