// Vigia da mensagem da semana (ACQ-11): pega uma rodada do n8n, acha os clientes cujo texto ficou segurado e
// confere de novo com a mesma função do fluxo, usando a mediana de 3 chamadas ao Jev (a nota oscila perto do limite).
// O que passar vira um arquivo com rascunho + pedido prontos para o servidor criar. Só corta frase, nunca acrescenta.
//
// Uso (na pasta automacoes/n8n):
//   node tools/semana-vigia/n8n.mjs execucao <id> > C:/tmp/rodada.json
//   node tools/semana-vigia/soltar-segurados.mjs C:/tmp/rodada.json C:/tmp/soltar.json [--texto]
// Precisa de TYPESAFE_API_KEY no ambiente. Não imprime chave.
import fs from "node:fs";
import { carregarLib } from "../../test/_lib.mjs";
const L = carregarLib("nucleo", "adaptador", "wf01", "wf11");
const [ARQ, SAIDA] = process.argv.slice(2);
if (!ARQ || !SAIDA) { console.error("uso: soltar-segurados.mjs <rodada.json> <soltar.json> [--texto]"); process.exit(2); }
const j = JSON.parse(fs.readFileSync(ARQ, "utf8"));
function achar(o, nome, d = 0) { if (!o || typeof o !== "object" || d > 8) return null; if (o[nome]) return o[nome]; for (const k of Object.keys(o)) { const r = achar(o[k], nome, d + 1); if (r) return r; } return null; }
const itens = (n) => { const x = achar(j, n); try { return x[0].data.main.flat().filter(Boolean).map((i) => i.json); } catch { return []; } };
const pedidos = itens("Pedir conferência ao Jev"), fechados = itens("Fechar texto"), crus = itens("Escrever com o escritor da Central");
const ritual = itens("Preparar rodada")[0].ctx.ritual;
if (itens("Preparar rodada")[0].ctx.ensaio) { console.error("esta execução é um ensaio; nada a soltar"); process.exit(2); }
const jev = async (req) => { for (let t = 0; ; t++) { try { return await (await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.TYPESAFE_API_KEY }, body: JSON.stringify(req), signal: AbortSignal.timeout(60000) })).json(); } catch (e) { if (t >= 6) throw e; await new Promise((ok) => setTimeout(ok, 4000)); } } };
const mediana = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const saida = {};
for (let i = 0; i < pedidos.length; i++) {
  const it = pedidos[i], nome = it.alvo.cliente;
  if (!fechados[i] || !fechados[i].tem_texto) { console.log("#####", nome, "| SEM TEXTO do escritor:", JSON.stringify((fechados[i] || {}).motivos)); continue; }
  if (fechados[i].conferencia && fechados[i].conferencia.ok) continue;
  const lido = L.acq11LerTexto(L.acqInterpretarResposta({ ferramenta: "aceleriq_ritual_redigir", tipo: "escrita" }, crus[i]));
  const texto = lido.ok ? lido : it.texto;
  const req = L.acq11PedidoConferencia(texto, it.alvo);
  const rs = await Promise.all([jev(req), jev(req), jev(req)]);
  const m = { answers: {} };
  for (const q of Object.keys(req.questions)) {
    const as = rs.map((r) => r.answers && r.answers[q]).filter(Boolean);
    if (as.length < 3) continue;
    m.answers[q] = req.questions[q].type === "noul" ? { type: "noul", noul: mediana(as.map((a) => a.noul)) }
      : { type: "choice", choice: "apoia", probabilities: { apoia: mediana(as.map((a) => a.probabilities.apoia)) } };
  }
  const conf = L.acq11Conferir(texto, m, { semana: ritual.semana, tipo: ritual.tipo });
  console.log("\n#####", nome, "| antes:", JSON.stringify(fechados[i].conferencia.motivos), "| agora ok=" + conf.ok, JSON.stringify(conf.motivos), JSON.stringify(conf.notas));
  for (const c of conf.cortes) console.log("   corte [" + c.motivo + "]:", c.frase.slice(0, 120));
  if (process.argv.includes("--texto") || !conf.ok) console.log(conf.corpo);
  if (!conf.ok) continue;
  conf.metodo = "vigia: mediana de 3 conferências do Jev";
  const final = Object.assign({}, texto, { body: conf.corpo });
  const rasc = L.acq11Rascunho(final, it.alvo, ritual, conf);
  rasc.idempotency_key += ":vigia";
  saida[nome] = { alvo: { client_id: it.alvo.client_id, cliente: nome, grupo: it.alvo.grupo }, rascunho: rasc, revisao: L.acq11PedidoRevisao(it.alvo, ritual, "REPORT_ID", final, "default") };
}
fs.writeFileSync(SAIDA, JSON.stringify(saida, null, 1));
console.log("\nprontos para soltar:", Object.keys(saida).length, Object.keys(saida).join(" | "));
