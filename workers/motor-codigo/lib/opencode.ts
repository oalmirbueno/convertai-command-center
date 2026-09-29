/**
 * O agente de código: `opencode serve` (MIT, instalado por npm neste worker)
 * rodando dentro do diretório do site, com o modelo escolhido pelo OpenRouter
 * (ou Anthropic/OpenAI direto). A chave do modelo só existe no ambiente do
 * worker; o painel nunca a vê. O preço do catálogo vai na configuração, então
 * o custo que o opencode conta é o "pela tabela" do painel, e o teto do
 * trabalho aborta a sessão quando o custo chega nele.
 */
import { resolve } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { criarContadorDeCusto, type EventoResumido, modeloParaOpencode, type ModeloDoMotor, passouDoTeto, resumirEventoDoOpencode } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { CHAVE_DO_PROVEDOR, configDoOpencode, temChave } from "./config-opencode.ts";

export { CHAVE_DO_PROVEDOR, configDoOpencode, temChave };
import { esperarNaSaida, matar, subir } from "./processos.ts";

const BINARIO = resolve(import.meta.dirname, "..", "node_modules", "opencode-ai", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");

export type ServidorDoOpencode = { url: string; fechar: () => void; cliente: ReturnType<typeof createOpencodeClient> };

export async function subirOpencode(pasta: string, m: ModeloDoMotor, medidorUrl?: string | null): Promise<ServidorDoOpencode> {
  const o = modeloParaOpencode(m);
  if (!temChave(o.providerID)) throw new Error(`o worker não tem a chave ${CHAVE_DO_PROVEDOR[o.providerID]} no ambiente`);
  const p = subir(BINARIO, ["serve", "--port=0", "--hostname=127.0.0.1", "--pure"], {
    cwd: pasta,
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(configDoOpencode(m, medidorUrl)), NO_COLOR: "1" },
  });
  const m1 = await esperarNaSaida(p.saida, /listening on (https?:\/\/\S+)/, 45_000, () => p.processo.exitCode === null);
  if (!m1) {
    matar(p.processo);
    throw new Error(`o opencode não subiu: ${p.saida().slice(-400)}`);
  }
  const url = m1[1];
  return { url, fechar: () => matar(p.processo), cliente: createOpencodeClient({ baseUrl: url, directory: pasta }) };
}

export type ResultadoDaPassada = {
  ok: boolean;
  motivo: "feito" | "teto" | "parado" | "prazo" | "erro";
  erro: string | null;
  custo: { custo_usd: number; tokens_entrada: number; tokens_saida: number; tokens_cache: number };
  resposta: string;
};

/**
 * Uma passada do agente (uma seção ou um ajuste): cria a sessão, manda o
 * pedido com o modelo, repassa os eventos resumidos e para por teto, por
 * Parar da equipe ou por prazo. `jaGasto` soma o que as passadas anteriores
 * do mesmo trabalho já custaram (o teto é do trabalho inteiro).
 */
export async function rodarPassada(
  s: ServidorDoOpencode,
  p: {
    titulo: string;
    pedido: string;
    modelo: ModeloDoMotor;
    tetoUsd: number;
    jaGasto: number;
    prazoMs: number;
    aoEvento: (ev: EventoResumido) => void;
    aoCusto: (totalDoTrabalho: number) => void;
    deveParar: () => Promise<boolean>;
    /** Custo real do trabalho inteiro (medidor do OpenRouter), quando há. */
    custoReal?: () => number;
  },
): Promise<ResultadoDaPassada> {
  const o = modeloParaOpencode(p.modelo);
  const contador = criarContadorDeCusto();
  const sessao = await s.cliente.session.create({ body: { title: p.titulo.slice(0, 80) } });
  if (!sessao.data) throw new Error(`sessão do opencode: ${JSON.stringify(sessao.error || {}).slice(0, 200)}`);
  const id = sessao.data.id;
  let motivo: ResultadoDaPassada["motivo"] = "feito";
  let abortado = false;
  const abortar = async (m: ResultadoDaPassada["motivo"]) => {
    if (abortado) return;
    abortado = true;
    motivo = m;
    await s.cliente.session.abort({ path: { id } }).catch(() => {});
    setTimeout(() => terminou(), 5000);
  };

  // Fim da passada: a sessão fica ociosa (session.idle) ou dá erro. O pedido vai por promptAsync
  // (volta na hora): uma passada longa não depende de uma conexão HTTP aberta por minutos.
  let terminou: () => void = () => {};
  const fim = new Promise<void>((ok) => (terminou = ok));
  let erro: string | null = null;
  const eventos = await s.cliente.event.subscribe();
  let ouvindo = true;
  const ouvir = (async () => {
    try {
      for await (const e of eventos.stream as AsyncIterable<{ type?: string; properties?: Record<string, unknown> }>) {
        if (!ouvindo) break;
        const props = e.properties || {};
        const daSessao = props.sessionID === id || (props.info && (props.info as { sessionID?: string }).sessionID === id) || (props.part && (props.part as { sessionID?: string }).sessionID === id);
        if (!daSessao) continue;
        if (e.type === "session.idle" || (e.type === "session.status" && (props.status as { type?: string } | undefined)?.type === "idle" && contador.total().tokens_saida > 0)) {
          terminou();
          continue;
        }
        if (e.type === "session.error") {
          const f = props.error as { name?: string; data?: { message?: string } } | undefined;
          if (!abortado) erro = `${(f && f.name) || "erro"}: ${(f && f.data && f.data.message) || ""}`.slice(0, 300);
        }
        if (e.type === "message.updated") {
          contador.registrar(props.info as never);
          const total = Math.max(p.jaGasto + contador.total().custo_usd, p.custoReal ? p.custoReal() : 0);
          p.aoCusto(total);
          if (passouDoTeto(total, p.tetoUsd)) void abortar("teto");
          continue;
        }
        const r = resumirEventoDoOpencode(e);
        if (r) p.aoEvento(r);
      }
    } catch {
      /* o fluxo fecha quando o servidor para */
    }
    terminou();
  })();

  const vigia = setInterval(async () => {
    if (await p.deveParar().catch(() => false)) void abortar("parado");
    const real = p.custoReal ? p.custoReal() : 0;
    if (real > 0) {
      p.aoCusto(Math.max(real, p.jaGasto + contador.total().custo_usd));
      if (passouDoTeto(real, p.tetoUsd)) void abortar("teto");
    }
    // Rede de segurança: se o evento de fim se perder, a sessão ociosa encerra a passada.
    const st = await s.cliente.session.status().catch(() => null);
    const estado = st && st.data ? (st.data as Record<string, { type?: string }>)[id] : undefined;
    if (contador.total().tokens_saida > 0 && (!estado || estado.type === "idle")) terminou();
  }, 3000);
  const prazo = setTimeout(() => void abortar("prazo"), p.prazoMs);

  let resposta = "";
  try {
    const r = await s.cliente.session.promptAsync({
      path: { id },
      body: { model: { providerID: o.providerID, modelID: o.modelID }, parts: [{ type: "text", text: p.pedido }] },
    });
    if (r.error) {
      erro = JSON.stringify(r.error).slice(0, 300);
      terminou();
    }
    // Abortar (teto, Parar, prazo) também encerra: a sessão fica ociosa logo depois.
    await fim;
    const msgs = await s.cliente.session.messages({ path: { id } }).catch(() => null);
    const lista = msgs && Array.isArray(msgs.data) ? (msgs.data as Array<{ info?: Record<string, unknown>; parts?: Array<{ type?: string; text?: string }> }>) : [];
    for (const m of lista) if (m.info) contador.registrar(m.info as never);
    const ultima = lista.filter((m) => m.info && m.info.role === "assistant").pop();
    resposta = ultima && ultima.parts ? ultima.parts.filter((x) => x.type === "text" && x.text).map((x) => x.text).join("\n").slice(0, 2000) : "";
    const falha = ultima && ultima.info ? (ultima.info as { error?: { name?: string; data?: { message?: string } } }).error : null;
    if (falha && !abortado && !erro) erro = `${falha.name || "erro"}: ${(falha.data && falha.data.message) || ""}`.slice(0, 300);
  } catch (e) {
    if (!abortado) erro = e instanceof Error ? e.message.slice(0, 300) : "falha na passada";
  } finally {
    clearInterval(vigia);
    clearTimeout(prazo);
    ouvindo = false;
  }
  await Promise.race([ouvir, new Promise((r) => setTimeout(r, 1500))]);
  const custo = contador.total();
  if (erro && motivo === "feito") motivo = "erro";
  return { ok: motivo === "feito", motivo, erro, custo, resposta };
}
