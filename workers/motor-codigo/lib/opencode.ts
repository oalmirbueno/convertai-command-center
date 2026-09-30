/**
 * O agente de código: `opencode serve` (MIT, instalado por npm neste worker)
 * rodando dentro do diretório do site, com o modelo escolhido pelo OpenRouter
 * (ou Anthropic/OpenAI direto). A chave do modelo só existe no ambiente do
 * worker; o painel nunca a vê. O preço do catálogo vai na configuração, então
 * o custo que o opencode conta é o "pela tabela" do painel, e o teto do
 * trabalho aborta a sessão quando o custo chega nele.
 *
 * Superpoderes (SPM, 30/09/2026): o agente sobe isolado do que é pessoal
 * desta máquina (as skills de ~/.claude e ~/.agents, o ~/.claude/CLAUDE.md e,
 * no modo nativo, a pasta global ~/.config/opencode não entram) e com as
 * skills do Superpowers vendorizado, no modo nativo (padrão) ou pelo plugin
 * oficial (SUPERPOWERS_MODO=plugin), com queda para o nativo quando o plugin
 * não sobe.
 *
 * O ambiente do processo sai de uma lista de permissão: o bash do agente
 * herda tudo o que o opencode tem, então SUPABASE_*, VERCEL_*, MOTOR_* e as
 * outras chaves nunca entram (só a chave do provedor do trabalho). Antes de
 * subir, a configuração que um agente possa ter plantado no site
 * (opencode.json, .opencode/ fora de skills/) é apagada.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { criarContadorDeCusto, type EventoResumido, modeloParaOpencode, type ModeloDoMotor, passouDoTeto, resumirEventoDoOpencode } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { registrarFalha } from "../../../supabase/functions/_shared/falha-registrada.ts";
import { ambienteDoOpencode, CHAVE_DO_PROVEDOR, configDoOpencode, modoDoSuperpowers, type ModoDoSuperpowers, SKILLS_DA_CASA, temChave } from "./config-opencode.ts";
import { limparConfiguracaoDoSite } from "./projeto.ts";
import { eventoDaSkill, lerMarcasDaResposta, type MarcasDaResposta } from "./marcas-da-resposta.ts";

// O ambiente mora em config-opencode.ts (um só, para as frentes UIM e superpowers); daqui só sai reexportado.
export { ambienteDoOpencode, CHAVE_DO_PROVEDOR, configDoOpencode, limparConfiguracaoDoSite, SKILLS_DA_CASA, temChave };
import { esperarNaSaida, matar, subir } from "./processos.ts";

export const BINARIO = resolve(import.meta.dirname, "..", "node_modules", "opencode-ai", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");

/** Prazo para o servidor dizer "listening on" (o plugin oficial trava a subida no Windows com o 1.18.33). */
export const PRAZO_DA_SUBIDA_MS = 45_000;

export type ServidorDoOpencode = {
  url: string;
  fechar: () => void;
  cliente: ReturnType<typeof createOpencodeClient>;
  modo: ModoDoSuperpowers;
  /** Configuração do opencode que estava no site e foi apagada antes de subir (vira aviso na tela). */
  limpos: string[];
};

export type OpcoesDaSubida = {
  /** Tipo do trabalho: decide as skills liberadas (permission.skill). */
  tipo?: string | null;
  /** Padrão: SUPERPOWERS_MODO do ambiente, e nativo quando não há. */
  modo?: ModoDoSuperpowers;
  /** Aviso para a tela quando o plugin não sobe e o trabalho segue no nativo. */
  aoFalhar?: (mensagem: string) => void | Promise<void>;
};

/** `--pure` desliga todo plugin: vale no nativo; o modo plugin sobe sem ele. */
export const argumentosDoServe = (modo: ModoDoSuperpowers) => ["serve", "--port=0", "--hostname=127.0.0.1"].concat(modo === "plugin" ? [] : ["--pure"]);

async function subirNoModo(pasta: string, m: ModeloDoMotor, medidorUrl: string | null | undefined, tipo: string | null | undefined, modo: ModoDoSuperpowers, limpos: string[]): Promise<ServidorDoOpencode> {
  const inicio = Date.now();
  const config = configDoOpencode(m, medidorUrl, { tipo, modo });
  // Nativo: a pasta global do opencode é uma pasta vazia só desta subida (apagada no fechar).
  const pastaDeConfig = modo === "nativo" ? mkdtempSync(join(tmpdir(), "aceleriq-opencode-config-")) : null;
  const soltarPasta = () => {
    if (!pastaDeConfig) return;
    setTimeout(() => {
      try {
        rmSync(pastaDeConfig, { recursive: true, force: true });
      } catch {
        /* o Windows solta a pasta depois; fica no temporário */
      }
    }, 1500);
  };
  const env = ambienteDoOpencode(config, modo, { provedor: modeloParaOpencode(m).providerID, pastaDeConfig });
  const p = subir(BINARIO, argumentosDoServe(modo), { cwd: pasta, env });
  const m1 = await esperarNaSaida(p.saida, /listening on (https?:\/\/\S+)/, PRAZO_DA_SUBIDA_MS, () => p.processo.exitCode === null);
  if (!m1) {
    matar(p.processo);
    soltarPasta();
    throw new Error(`o opencode não subiu${modo === "plugin" ? " (modo plugin)" : ""}: ${p.saida().slice(-400)}`);
  }
  const url = m1[1];
  if (modo === "plugin") {
    // O plugin carrega na primeira chamada da pasta: "listening on" não basta (com as pastas do
    // opencode vazias, o servidor escuta e não responde). Dentro do mesmo prazo, as skills têm de vir.
    try {
      const r = await fetch(`${url}/skill?directory=${encodeURIComponent(pasta)}`, { signal: AbortSignal.timeout(Math.max(5_000, PRAZO_DA_SUBIDA_MS - (Date.now() - inicio))) });
      const lista = r.ok ? ((await r.json()) as Array<{ name?: string }>) : null;
      if (!Array.isArray(lista) || !lista.some((s) => s && s.name === "using-superpowers")) throw new Error(`o plugin não registrou as skills (GET /skill ${r.status})`);
    } catch (e) {
      matar(p.processo);
      soltarPasta();
      throw new Error(`o opencode não respondeu no modo plugin: ${e instanceof Error ? e.message : "sem resposta"}`);
    }
  }
  const fechar = () => {
    matar(p.processo);
    soltarPasta();
  };
  return { url, fechar, cliente: createOpencodeClient({ baseUrl: url, directory: pasta }), modo, limpos };
}

export async function subirOpencode(pasta: string, m: ModeloDoMotor, medidorUrl?: string | null, opcoes: OpcoesDaSubida = {}): Promise<ServidorDoOpencode> {
  const o = modeloParaOpencode(m);
  if (!temChave(o.providerID)) throw new Error(`o worker não tem a chave ${CHAVE_DO_PROVEDOR[o.providerID]} no ambiente`);
  const modo = opcoes.modo || modoDoSuperpowers();
  // Plugin, ferramenta ou configuração plantados no site não sobem com o agente.
  const limpos = limparConfiguracaoDoSite(pasta);
  if (modo !== "plugin") return await subirNoModo(pasta, m, medidorUrl, opcoes.tipo, "nativo", limpos);
  try {
    return await subirNoModo(pasta, m, medidorUrl, opcoes.tipo, "plugin", limpos);
  } catch (e) {
    // O trabalho não morre: a falha vai para o log e para a tela, e o agente sobe no modo nativo.
    const motivo = registrarFalha("motor: plugin do superpowers não subiu", e, { pasta });
    if (opcoes.aoFalhar) {
      try {
        await opcoes.aoFalhar(`Plugin do Superpowers não subiu em ${Math.round(PRAZO_DA_SUBIDA_MS / 1000)} s; seguiu no modo nativo (${motivo.slice(0, 120)})`);
      } catch (e2) {
        registrarFalha("motor: aviso da queda para o nativo", e2);
      }
    }
    return await subirNoModo(pasta, m, medidorUrl, opcoes.tipo, "nativo", limpos);
  }
}

export type ResultadoDaPassada = {
  ok: boolean;
  motivo: "feito" | "teto" | "parado" | "prazo" | "erro";
  erro: string | null;
  custo: { custo_usd: number; tokens_entrada: number; tokens_saida: number; tokens_cache: number };
  resposta: string;
  /** PROVA, DECIDI e PRECISA DE RESPOSTA, lidos da resposta inteira (antes do corte de 2.000 caracteres). */
  marcas: MarcasDaResposta;
  /** Id da sessão do opencode (o teste dos superpoderes lê as ferramentas usadas). */
  sessao: string;
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
        // SPM: skill carregada (ou recusada pela permissão) vira passo na tela.
        const r = eventoDaSkill(e) || resumirEventoDoOpencode(e);
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
  let marcas = lerMarcasDaResposta("");
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
    const inteira = ultima && ultima.parts ? ultima.parts.filter((x) => x.type === "text" && x.text).map((x) => x.text).join("\n") : "";
    // As marcas ficam no fim da resposta: ler antes de cortar.
    marcas = lerMarcasDaResposta(inteira);
    resposta = inteira.slice(0, 2000);
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
  return { ok: motivo === "feito", motivo, erro, custo, resposta, marcas, sessao: id };
}
