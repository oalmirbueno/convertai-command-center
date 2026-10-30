// Avaliação do Jev (TypeSafe) nos julgamentos do ACQ-04, com mensagens SANITIZADAS (inventadas,
// sem dado de cliente). Chama a API real com TYPESAFE_API_KEY (variável de usuário; nunca impressa).
// Mede: tipo, pergunta respondida, autorização e objeto. A decisão final continua nas regras.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { carregarLib } from '../test/_lib.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = carregarLib('nucleo', 'wf04');
const chave = process.env.TYPESAFE_API_KEY || execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY','User')"], { encoding: 'utf8' }).trim();
if (!chave) throw new Error('TYPESAFE_API_KEY ausente');

const perguntas = [
  { id: 'q_pautas', pergunta: 'As pautas prontas sem data já foram aprovadas pela cliente para agendamento?' },
  { id: 'q_fotos', pergunta: 'As fotos atuais do café da manhã já foram enviadas pela cliente?' },
];
const casos = [
  { id: 'c1', texto: 'Pode fazer.', esperado: { autoriza: true, objeto_claro: false, tipo: ['decisao'] } },
  { id: 'c2', texto: 'Pode publicar o carrossel da Fenaostra na quinta às 10h.', esperado: { autoriza: true, objeto_claro: true, tipo: ['decisao'] } },
  { id: 'c3', texto: 'Aprovei as pautas, podem agendar.', esperado: { autoriza: true, responde: 'q_pautas', tipo: ['decisao', 'resposta'] } },
  { id: 'c4', texto: 'Mandei as fotos do café agora há pouco pelo drive.', esperado: { autoriza: false, responde: 'q_fotos', tipo: ['resposta', 'informacao'] } },
  { id: 'c5', texto: 'Bom dia pessoal! 😊', esperado: { autoriza: false, tipo: ['ruido'] } },
  { id: 'c6', texto: 'Podem aumentar a verba da campanha para 30 reais por dia.', esperado: { autoriza: true, sensivel: true, tipo: ['decisao', 'pedido'] } },
  { id: 'c7', texto: 'Na verdade a pousada fecha dia 20, não dia 25 como eu disse.', esperado: { autoriza: false, tipo: ['correcao'] } },
  { id: 'c8', texto: 'Vocês conseguem criar um post sobre o feriado?', esperado: { autoriza: false, tipo: ['pedido'] } },
  { id: 'c9', texto: 'Ok, obrigado!', esperado: { autoriza: false, tipo: ['ruido'] } },
  { id: 'c10', texto: 'Ainda não aprovei nada, vou olhar no fim de semana.', esperado: { autoriza: false, responde: 'q_pautas', tipo: ['resposta', 'informacao'] } },
  { id: 'c11', texto: 'Paguei o boleto de outubro hoje.', esperado: { autoriza: false, sensivel: true, tipo: ['informacao'] } },
  { id: 'c12', texto: 'Sim', esperado: { autoriza: null, tipo: null } },
];

const resultados = [];
for (const c of casos) {
  const trecho = [{ provider_message_id: c.id, papel: 'cliente_decisor', occurred_at: '2026-10-14T14:00:00Z', texto: c.texto, tipo: 'texto' }];
  const corpo = L.acq04PedidoJev(trecho, { perguntas_abertas: perguntas });
  const t0 = Date.now();
  const r = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json();
  if (!r.ok) { resultados.push({ id: c.id, erro: r.status }); continue; }
  const julg = L.acq04LerJev(j);
  const dec = L.acq04Decidir({ client_id: 'x', papel: 'cliente_decisor', tipo: 'texto' }, julg, {});
  const e = c.esperado;
  const conf = {
    tipo: e.tipo ? e.tipo.includes(julg.tipo) : null,
    autoriza: e.autoriza === null ? null : (julg.p_autoriza >= 0.5) === e.autoriza,
    objeto_claro: e.objeto_claro === undefined ? null : (julg.p_objeto_claro >= 0.7) === e.objeto_claro,
    responde: e.responde === undefined ? null : julg.responde === e.responde,
    sensivel: e.sensivel === undefined ? null : (julg.p_sensivel >= 0.5) === e.sensivel,
  };
  resultados.push({ id: c.id, texto: c.texto, julg, destino: dec.destino, motivos: dec.motivos, conf, ms: Date.now() - t0, tokens: j.usage });
}
const checks = resultados.flatMap((r) => Object.values(r.conf || {}).filter((v) => v !== null));
const resumo = { modelo: resultados.find((r) => r.julg)?.julg.modelo, casos: resultados.length, acertos: checks.filter(Boolean).length, verificacoes: checks.length,
  nenhuma_aprovacao_automatica: resultados.every((r) => r.destino !== 'aprovado'),
  autorizacoes_em_revisao: resultados.filter((r) => r.julg && r.julg.p_autoriza >= 0.5).every((r) => r.destino === 'revisao') };
const saida = path.join(raiz, 'piloto', 'avaliacao-jev-acq04.json');
fs.writeFileSync(saida, JSON.stringify({ executado_em: new Date().toISOString(), observacao: 'mensagens inventadas; nada de cliente', resumo, resultados }, null, 2) + '\n');
console.log(JSON.stringify(resumo));
for (const r of resultados) console.log(r.id, r.julg ? `${r.julg.tipo}(${r.julg.tipo_confianca?.toFixed(2)}) aut=${r.julg.p_autoriza?.toFixed(2)} obj=${r.julg.p_objeto_claro?.toFixed(2)} sens=${r.julg.p_sensivel?.toFixed(2)} resp=${r.julg.responde}` : r.erro, '→', r.destino, JSON.stringify(r.conf));
