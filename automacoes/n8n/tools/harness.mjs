// Workflows de apoio SÓ PARA O TESTE LOCAL: um gatilho manual que chama um workflow ACQ com uma
// entrada fixa (cliente, ritual, data, mensagem de fixture). Não fazem parte da entrega.
export function harness(id, nome, alvoId, entrada) {
  return {
    id, name: 'TESTE-' + nome, active: false, settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo' }, pinData: {},
    nodes: [
      { id: 'h1-' + id, name: 'Início', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      { id: 'h2-' + id, name: 'Entrada de teste', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0],
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: 'return ' + JSON.stringify((Array.isArray(entrada) ? entrada : [entrada]).map((j) => ({ json: j }))) + ';' } },
      { id: 'h3-' + id, name: 'Chamar workflow', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.4, position: [440, 0],
        parameters: { source: 'database', workflowId: { __rl: true, mode: 'id', value: alvoId }, mode: 'once', options: { waitForSubWorkflow: true } } },
    ],
    connections: { 'Início': { main: [[{ node: 'Entrada de teste', type: 'main', index: 0 }]] }, 'Entrada de teste': { main: [[{ node: 'Chamar workflow', type: 'main', index: 0 }]] } },
  };
}
