// Simulador LOCAL de workflows n8n (só para teste): executa o JSON gerado por build/gerar.mjs nó a nó,
// com o código dos nós Code exatamente como vai para o n8n, Postgres real (o do teste) e TODA chamada
// HTTP desviada para uma função falsa do teste. Nada sai da máquina: URL sem resposta falsa é erro.
//
// Cobre o que os fluxos ACQ usam: Code (runOnceForAllItems, $input, $('Nó').first/all/itemMatching/
// isExecuted, this.helpers.getBinaryDataBuffer), If, Switch, HTTP Request (fullResponse, neverError,
// onError, retry), Postgres executeQuery (queryReplacement), Execute Sub-workflow (mode each),
// Respond to Webhook e NoOp. Ordem de execução: profundidade primeiro, saída 0 antes da 1 (como o
// executionOrder v1); nó com dois pais roda uma vez por pai que entregou itens.
// Não substitui o n8n de verdade: é a verificação de fiação, expressões e lógica sem rede.

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export function criarSimulador({ workflows, http, pg }) {
  const porId = {};
  for (const w of workflows) porId[w.id] = w;

  async function executar(wfId, gatilho, itensIniciais) {
    const wf = porId[wfId];
    if (!wf) throw new Error('workflow não carregado: ' + wfId);
    const nos = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
    const runs = {};          // nome -> [{ saidas: [[item]] }]
    const respostas = [];
    const ordem = [];
    let ultimo = null;

    const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const item = (json, pai, no, binary) => ({ json, binary, __pai: pai || null, __no: no });

    function acessor(atual) {
      return (nome) => {
        const r = runs[nome];
        const ultimoRun = r ? r[r.length - 1] : null;
        const lista = ultimoRun ? (ultimoRun.saidas[0] || []) : [];
        return {
          isExecuted: !!r,
          all: () => { if (!r) throw new Error(`nó '${nome}' não executou`); return lista.map((x) => ({ json: copia(x.json), binary: x.binary })); },
          first: () => { if (!r) throw new Error(`nó '${nome}' não executou`); const x = lista[0]; return x ? { json: copia(x.json), binary: x.binary } : undefined; },
          itemMatching: (i) => {
            let x = atual[i];
            while (x && x.__no !== nome) x = x.__pai;
            if (!x) throw new Error(`Paired item data unavailable: '${nome}' a partir do item ${i}`);
            return { json: copia(x.json), binary: x.binary };
          },
        };
      };
    }

    function avaliar(valor, it, entrada) {
      if (typeof valor !== 'string' || valor[0] !== '=') return valor;
      const s = valor.slice(1);
      const $ = acessor(entrada);
      const ev = (expr) => new Function('$json', '$', '"use strict"; return (' + expr + ');')(it ? copia(it.json) : {}, $);
      const unico = /^\{\{([\s\S]*)\}\}$/.exec(s.trim());
      if (unico && s.trim().indexOf('{{', 2) < 0) return ev(unico[1]);
      return s.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => { const v = ev(e); return typeof v === 'string' ? v : JSON.stringify(v); });
    }

    async function comRetry(no, fn) {
      const max = no.retryOnFail ? Math.max(1, no.maxTries || 3) : 1;
      let erro;
      for (let t = 0; t < max; t++) { try { return await fn(); } catch (e) { erro = e; } }
      throw erro;
    }

    async function executarNo(no, entrada) {
      const p = no.parameters || {};
      const tipo = no.type;
      const ent = no.executeOnce ? entrada.slice(0, 1) : entrada;
      if (tipo === 'n8n-nodes-base.code') {
        const $input = { all: () => ent.map((x) => ({ json: copia(x.json), binary: x.binary })), first: () => ({ json: copia(ent[0].json), binary: ent[0].binary }) };
        const ctx = { helpers: { prepareBinaryData: async (buf, fileName, mimeType) => ({ data: Buffer.from(buf).toString('base64'), fileName, mimeType }), getBinaryDataBuffer: async (i, prop) => {
          const b = ent[i] && ent[i].binary && ent[i].binary[prop];
          if (!b || !b.data) throw new Error('sem binário ' + prop);
          return Buffer.from(b.data, 'base64');
        } } };
        const fn = new AsyncFunction('$input', '$', 'Buffer', p.jsCode);
        const out = await fn.call(ctx, $input, acessor(ent), Buffer);
        if (!Array.isArray(out)) throw new Error(`Code '${no.name}' não devolveu lista`);
        return [out.map((o) => {
          const pi = o.pairedItem === undefined ? null : (typeof o.pairedItem === 'number' ? o.pairedItem : o.pairedItem.item);
          const pai = pi !== null ? ent[pi] : (ent.length === 1 ? ent[0] : null);
          return item(o.json, pai, no.name, o.binary);
        })];
      }
      if (tipo === 'n8n-nodes-base.if') {
        const c = p.conditions.conditions[0];
        const sim = [], nao = [];
        ent.forEach((x) => (avaliar(c.leftValue, x, ent) === true ? sim : nao).push(item(x.json, x, no.name, x.binary)));
        return [sim, nao];
      }
      if (tipo === 'n8n-nodes-base.switch') {
        const regras = p.rules.values;
        const saidas = regras.map(() => []).concat([[]]);
        ent.forEach((x) => {
          let k = regras.findIndex((r) => { const c = r.conditions.conditions[0]; return avaliar(c.leftValue, x, ent) === c.rightValue; });
          if (k < 0) k = regras.length;
          saidas[k].push(item(x.json, x, no.name, x.binary));
        });
        return saidas;
      }
      if (tipo === 'n8n-nodes-base.httpRequest') {
        const out = [];
        for (const x of ent) {
          const url = avaliar(p.url, x, ent);
          const corpo = p.sendBody && p.jsonBody ? JSON.parse(avaliar(p.jsonBody, x, ent)) : undefined;
          const cred = no.credentials ? Object.values(no.credentials)[0].name : null;
          const resp = (p.options && p.options.response && p.options.response.response) || {};
          let json;
          try {
            json = await comRetry(no, async () => {
              const r = await http({ url, method: p.method, corpo, credencial: cred, no: no.name });
              if (r.statusCode >= 400 && !resp.neverError) { const e = new Error('HTTP ' + r.statusCode); e.httpCode = String(r.statusCode); throw e; }
              return resp.fullResponse ? { statusCode: r.statusCode, headers: r.headers || {}, body: r.body } : r.body;
            });
          } catch (e) {
            if (no.onError !== 'continueRegularOutput') throw e;
            json = { error: { message: e.message, httpCode: e.httpCode || null } };
          }
          if (resp.responseFormat === 'file' && !json.error) { out.push(item({}, x, no.name, { [resp.outputPropertyName || 'data']: { data: Buffer.from(String(json.arquivo || '')).toString('base64') } })); continue; }
          out.push(item(json, x, no.name));
        }
        return [out];
      }
      if (tipo === 'n8n-nodes-base.postgres') {
        const out = [];
        for (const x of ent) {
          const params = p.options && p.options.queryReplacement ? avaliar(p.options.queryReplacement, x, ent) : [];
          const rows = await comRetry(no, async () => (await pg.query(p.query, params)).rows);
          rows.forEach((r) => out.push(item(JSON.parse(JSON.stringify(r)), x, no.name)));
        }
        return [out];
      }
      if (tipo === 'n8n-nodes-base.executeWorkflow') {
        const out = [];
        const alvo = p.workflowId.value;
        for (const x of ent) {
          const sub = await executar(alvo, null, [{ json: copia(x.json) }]);
          sub.ultimo.forEach((r) => out.push(item(r.json, x, no.name)));
        }
        return [out];
      }
      if (tipo === 'n8n-nodes-base.respondToWebhook') {
        respostas.push({ no: no.name, corpo: avaliar(p.responseBody, ent[0], ent), codigo: (p.options && p.options.responseCode) || 200 });
        return [ent.map((x) => item(x.json, x, no.name))];
      }
      if (tipo === 'n8n-nodes-base.wait') return [ent.map((x) => item(x.json, x, no.name, x.binary))];
      if (tipo === 'n8n-nodes-base.noOp') return [ent.map((x) => item(x.json, x, no.name))];
      throw new Error('tipo de nó não simulado: ' + tipo);
    }

    async function rodar(nome, entrada) {
      const no = nos[nome];
      ordem.push(nome);
      const saidas = await executarNo(no, entrada);
      (runs[nome] = runs[nome] || []).push({ saidas });
      ultimo = saidas.find((s) => s.length) || saidas[0] || [];
      const con = (wf.connections[nome] && wf.connections[nome].main) || [];
      for (let k = 0; k < con.length; k++) {
        const s = saidas[k] || [];
        if (!s.length) continue;
        for (const c of con[k] || []) await rodar(c.node, s);
      }
    }

    const inicio = gatilho ? nos[gatilho] : wf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
    if (!inicio) throw new Error('gatilho não encontrado: ' + gatilho);
    const itens0 = itensIniciais.map((x) => item(x.json, null, inicio.name, x.binary));
    (runs[inicio.name] = []).push({ saidas: [itens0] });
    ordem.push(inicio.name);
    ultimo = itens0;
    const con = (wf.connections[inicio.name] && wf.connections[inicio.name].main) || [];
    for (const c of con[0] || []) await rodar(c.node, itens0);
    return { runs, respostas, ordem, ultimo: ultimo || [], saida: (nome) => (runs[nome] || []).flatMap((r) => (r.saidas[0] || []).map((x) => x.json)) };
  }

  return { executar };
}

// Troca a config embutida nos nós Code (linha "const AMBIENTES = ...") para testar outro estado
// (ex.: transporte ligado) sem mexer em config/ambientes.json.
export function comConfig(wfJson, mudar) {
  const w = JSON.parse(JSON.stringify(wfJson));
  for (const n of w.nodes) {
    if (n.type !== 'n8n-nodes-base.code') continue;
    n.parameters.jsCode = n.parameters.jsCode.replace(/^const AMBIENTES = (.*);$/m, (_, j) => {
      const a = JSON.parse(j); mudar(a); return 'const AMBIENTES = ' + JSON.stringify(a) + ';';
    });
  }
  return w;
}
