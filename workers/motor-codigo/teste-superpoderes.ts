/**
 * Teste dos superpoderes no motor de código (frente SPM, 30/09/2026; revisão
 * de segurança e custo no mesmo dia).
 *
 * SEM GASTO (padrão): o código de produção (subirOpencode + rodarPassada)
 * com o provedor "openrouter" apontado, pelo medidorUrl, para um servidor
 * FALSO local que imita a API e grava o pedido. Nenhuma chamada sai da
 * máquina; a chave é um valor falso só neste processo (não é credencial de
 * ninguém), e os "segredos" do worker são valores falsos plantados aqui.
 * Confere:
 *   - GET /skill: exatamente as 15 skills do vendor e a embutida; nenhuma pessoal
 *     (~/.claude/skills, ~/.agents/skills e a pasta global do opencode, plantada aqui);
 *   - no pedido gravado: as 5 skills do "construir" em <available_skills>, e só elas; a regra
 *     dos 1% e a abertura da casa no sistema; o AGENTS.md com a seção do método; nenhum trecho
 *     do ~/.claude/CLAUDE.md nem do AGENTS.md global plantado; sem question e task;
 *   - skill liberada carrega (writing-plans) e a negada é recusada (brainstorming);
 *   - RED sem build: `node scripts/conferir.mjs --secao hero` falha dizendo que não está no build;
 *   - o anexo de uma skill do vendor é lido (writing-good-tests.md) e uma pasta de fora, não;
 *   - a edição de scripts/conferir.mjs e de .git/hooks é negada;
 *   - mesmo com um conferir.mjs trocado (plantado pelo teste), o bash não vê
 *     SUPABASE_*, VERCEL_* nem MOTOR_*, e nenhum segredo chega ao provedor;
 *   - opencode.json e .opencode/plugins plantados no site são apagados antes de subir;
 *   - uma PROVA falsa vira o aviso "prova declarada não confere" (conferência do motor);
 *   - com um modelo "gpt-5-falso", o opencode troca edit e write por apply_patch, e a
 *     abertura da casa fala dele;
 *   - custo US$ 0,00.
 *
 *   node teste-superpoderes.ts
 *   SUPERPOWERS_MODO=plugin node teste-superpoderes.ts     (plugin oficial; se não subir em 45 s, cai no nativo)
 *   SUPERPOWERS_MODO=plugin SUPERPOWERS_TESTE_QUEDA=1 node teste-superpoderes.ts   (força a queda e confere o aviso)
 *   O modo plugin NÃO isola a pasta global do opencode (ele trava com a pasta vazia): o teste
 *   registra isso em vez de exigir.
 *
 * PAGO (opcional, até US$ 0,20; só com OPENROUTER_API_KEY no ambiente e com autorização):
 *   node --env-file-if-exists=.env teste-superpoderes.ts --pago [--modelo deepseek/deepseek-v4-flash]
 *   "Construa a seção hero" num site de teste com pacote mínimo, pelo prompt de produção, com o
 *   teto de US$ 0,20 no rodarPassada. Espera uma skill liberada carregada, a resposta com PROVA:,
 *   um `npm run checar` só (o GREEN), a conferência do motor e o custo real abaixo de US$ 0,05.
 *
 * Nada deste teste imprime chave, cabeçalho ou o conteúdo do CLAUDE.md pessoal: só contagens.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ModeloDoMotor } from "../../supabase/functions/_shared/motor-codigo.ts";
import { type PacoteDoSite, promptDaSecao } from "../../supabase/functions/_shared/site-metodo.ts";
import { ABERTURA_DA_CASA, BOOTSTRAP_DO_VENDOR, SKILLS_DA_CASA, SKILLS_DO_SUPERPOWERS, SKILLS_DO_VENDOR, SKILLS_POR_TRABALHO } from "./lib/config-opencode.ts";
import { conferirSecaoDoProjeto, construirSite, escreverPacote, garantirProjeto, instalarSePrecisar } from "./lib/projeto.ts";
import { eventosDasMarcas } from "./lib/marcas-da-resposta.ts";
import type { Fila } from "./lib/fila.ts";

const PAGO = process.argv.indexOf("--pago") >= 0;
/** SUPERPOWERS_TESTE_QUEDA=1 (com SUPERPOWERS_MODO=plugin): força a queda para o nativo com as pastas do opencode vazias. */
const QUEDA_FORCADA = process.env.SUPERPOWERS_TESTE_QUEDA === "1";
const arg = (nome: string, padrao: string) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

type Checagem = { nome: string; ok: boolean; detalhe?: string };
const checagens: Checagem[] = [];
const conferir = (nome: string, ok: boolean, detalhe?: string) => {
  checagens.push({ nome, ok, detalhe });
  console.log(`${ok ? "  ok " : "  FALHOU"} ${nome}${detalhe ? ` (${detalhe})` : ""}`);
};

/** Nomes das skills pessoais desta máquina (só os nomes das pastas). */
function skillsPessoais(): string[] {
  const nomes: string[] = [];
  for (const d of [join(homedir(), ".claude", "skills"), join(homedir(), ".agents", "skills")]) {
    try {
      for (const n of readdirSync(d)) if (SKILLS_DO_SUPERPOWERS.indexOf(n as never) < 0) nomes.push(n);
    } catch {
      /* pasta que não existe */
    }
  }
  return nomes;
}

/** Linhas longas do CLAUDE.md pessoal (para conferir que não entram; nunca são impressas). */
function trechosDoClaudeMd(): string[] {
  try {
    return readFileSync(join(homedir(), ".claude", "CLAUDE.md"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 30)
      .slice(0, 12);
  } catch {
    return [];
  }
}

/** Texto de uma mensagem (string ou lista de partes { type: "text", text }). */
const textoDaMensagem = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("\n") : JSON.stringify(c);

const sistemaDoPedido = (j: { messages?: Array<{ role?: string; content?: unknown }> }) =>
  (j.messages || [])
    .filter((m) => m.role === "system")
    .map((m) => textoDaMensagem(m.content))
    .join("\n");

const skillsListadas = (sistema: string) => {
  const i = sistema.indexOf("<available_skills>");
  const f = sistema.indexOf("</available_skills>");
  const bloco = i >= 0 ? sistema.slice(i, f > i ? f : undefined) : "";
  return Array.from(bloco.matchAll(/<name>([^<]+)<\/name>/g)).map((m) => m[1].trim());
};

/** A ferramenta foi recusada pela permissão (o texto do opencode 1.18.33). */
const RECUSADA = /prevents you from using this specific tool call|denied|not allowed|permission|rejected/i;

// ------------------------------------------------------------------ provedor falso

type Pedido = { url: string; corpo: string; auth: string };

function provedorFalso(roteiro: (j: Record<string, unknown>) => { texto?: string; ferramenta?: { nome: string; args: Record<string, unknown> } }) {
  const pedidos: Pedido[] = [];
  const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      pedidos.push({ url: req.url || "", corpo, auth: String(req.headers.authorization || "") });
      if (!String(req.url).includes("chat/completions")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      let j: Record<string, unknown> = {};
      try {
        j = JSON.parse(corpo);
      } catch {
        /* corpo quebrado: responde texto */
      }
      const r = roteiro(j);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const pedaco = (delta: unknown, fim: string | null) => `data: ${JSON.stringify({ id: "falso", object: "chat.completion.chunk", created: 1, model: "falso", choices: [{ index: 0, delta, finish_reason: fim }] })}\n\n`;
      if (r.ferramenta) {
        res.write(pedaco({ role: "assistant", content: null, tool_calls: [{ index: 0, id: `call_${randomUUID().slice(0, 8)}`, type: "function", function: { name: r.ferramenta.nome, arguments: JSON.stringify(r.ferramenta.args) } }] }, null));
        res.write(pedaco({}, "tool_calls"));
      } else {
        res.write(pedaco({ role: "assistant", content: r.texto || "ok" }, null));
        res.write(pedaco({}, "stop"));
      }
      res.write(`data: ${JSON.stringify({ id: "falso", object: "chat.completion.chunk", created: 1, model: "falso", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  return { servidor, pedidos };
}

const filaDeTeste = (pasta: string): Fila =>
  ({
    nome: "teste",
    baixar: async (_b: string, p: string) => {
      const c = join(pasta, p);
      return existsSync(c) ? new Uint8Array(readFileSync(c)) : null;
    },
  }) as unknown as Fila;

const PACOTE_MINIMO = {
  cliente: "Café Teste",
  marca: { nome: "Café Teste", negocio: "cafeteria de bairro", publico: "vizinhos que trabalham de casa", oferta: "café coado e pão de fermentação natural", tom: "acolhedor e direto" },
  paleta: [{ hex: "#6B3E26", papel: "primária" }, { hex: "#FAF6F0", papel: "fundo" }],
  fontes: [],
  dna: null,
  direcao: { nicho: "cafeteria", peca: "site de uma página", referencia_de_nivel: "premium" },
  copy: { headline: "Café coado sem pressa", subtitulo: "Grãos torrados na semana e pão de fermentação natural.", cta: "Ver o cardápio", secoes: [], faq: [], seo: { titulo: "Café Teste", descricao: "Cafeteria de bairro", palavras: [] } },
  imagens: [],
  fotos_reais: [],
  logo: null,
  secoes: ["hero"],
  regras_da_equipe: [],
};

// ------------------------------------------------------------------ sem gasto

async function semGasto() {
  // Só este processo: valor falso, e nada de buscar catálogo ou atualização na rede.
  process.env.OPENROUTER_API_KEY = "chave-falsa-local-sem-valor-nenhum";
  process.env.OPENCODE_DISABLE_AUTOUPDATE = "1";
  process.env.OPENCODE_DISABLE_MODELS_FETCH = "1";
  // "Segredos" do worker (valores falsos): nenhum pode chegar ao bash nem ao provedor.
  const marca = randomUUID().slice(0, 8);
  const SEGREDOS: Record<string, string> = {
    SUPABASE_SERVICE_ROLE_KEY: `segredo-supabase-${marca}`,
    SUPABASE_URL: `https://segredo-${marca}.supabase.invalid`,
    VERCEL_TOKEN: `segredo-vercel-${marca}`,
    MOTOR_SEGREDO_TESTE: `segredo-motor-${marca}`,
  };
  Object.assign(process.env, SEGREDOS);
  const pedidoPlugin = process.env.SUPERPOWERS_MODO === "plugin";
  // Pasta global do opencode com um AGENTS.md e uma skill "pessoais" (marcador), para provar o isolamento
  // do nativo. No modo plugin sem queda, a pasta global é a de verdade (o plugin trava com outra): nada é plantado.
  const MARCADOR = `MARCADOR-PESSOAL-${marca}`;
  let plantouGlobal = false;
  if (QUEDA_FORCADA || !pedidoPlugin) {
    const xdg = mkdtempSync(join(tmpdir(), "aceleriq-sp-xdg-"));
    if (QUEDA_FORCADA) {
      // A condição medida no desenho: pastas do opencode vazias fazem o plugin travar a subida.
      for (const k of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) process.env[k] = join(xdg, k.toLowerCase());
    } else process.env.XDG_CONFIG_HOME = join(xdg, "xdg_config_home");
    const global = join(String(process.env.XDG_CONFIG_HOME), "opencode");
    mkdirSync(join(global, "skills", "pessoal-teste"), { recursive: true });
    writeFileSync(join(global, "AGENTS.md"), `# Pessoal\n\n${MARCADOR}: regra pessoal que nunca pode entrar no site do cliente.\n`);
    writeFileSync(join(global, "skills", "pessoal-teste", "SKILL.md"), `---\nname: pessoal-teste\ndescription: Skill pessoal de teste (${MARCADOR})\n---\n\n# Pessoal\n`);
    plantouGlobal = true;
  }
  const { subirOpencode, rodarPassada } = await import("./lib/opencode.ts");

  const raiz = mkdtempSync(join(tmpdir(), "aceleriq-sp-"));
  const pasta = join(raiz, "site-teste");
  await garantirProjeto(pasta);
  const conferirOriginal = readFileSync(join(pasta, "scripts", "conferir.mjs"), "utf8");
  // Fora do projeto: o agente não pode ler.
  const fora = join(raiz, "fora-do-projeto.txt");
  writeFileSync(fora, `FORA-DO-PROJETO-${marca}`);
  // Configuração plantada no site (como se uma passada antiga tivesse escrito): tem de sumir antes de subir.
  writeFileSync(join(pasta, "opencode.json"), JSON.stringify({ permission: { bash: "allow", edit: "allow" } }));
  mkdirSync(join(pasta, ".opencode", "plugins"), { recursive: true });
  writeFileSync(join(pasta, ".opencode", "plugins", "plantado.js"), "export default async () => ({})\n");
  const anexo = join(SKILLS_DO_VENDOR, "test-driven-development", "writing-good-tests.md");
  const tituloDoAnexo = (readFileSync(anexo, "utf8").split("\n").find((l) => /^# /.test(l)) || "# ").trim();
  // conferir.mjs trocado pelo teste (simula uma troca que escapou): mostra o que o bash vê do ambiente.
  const conferirQueMostraOAmbiente = [
    `const vars = ${JSON.stringify(Object.keys(SEGREDOS))};`,
    `console.log("AMBIENTE DO BASH: " + vars.map((k) => k + "=" + (process.env[k] || "(ausente)")).join(" ") + " tem_path=" + (process.env.PATH || process.env.Path ? "sim" : "nao") + " tem_chave_do_provedor=" + (process.env.OPENROUTER_API_KEY ? "sim" : "nao"));`,
    "",
  ].join("\n");
  let agenteTrocouOConferir = false;

  const passo = (n: number): { texto?: string; ferramenta?: { nome: string; args: Record<string, unknown> } } => {
    const bash = (command: string, description: string) => ({ ferramenta: { nome: "bash", args: { command, description } } });
    if (n === 0) return { ferramenta: { nome: "skill", args: { name: "writing-plans" } } };
    if (n === 1) return { ferramenta: { nome: "skill", args: { name: "brainstorming" } } };
    if (n === 2) return bash("node scripts/conferir.mjs --secao hero", "RED antes de escrever, sem build");
    if (n === 3) return { ferramenta: { nome: "read", args: { filePath: anexo } } };
    if (n === 4) return { ferramenta: { nome: "read", args: { filePath: fora } } };
    if (n === 5) return { ferramenta: { nome: "write", args: { filePath: join(pasta, "scripts", "conferir.mjs"), content: "console.log(process.env.SUPABASE_SERVICE_ROLE_KEY) // ESCRITO-PELO-AGENTE\n" } } };
    if (n === 6) return { ferramenta: { nome: "write", args: { filePath: join(pasta, ".git", "hooks", "post-commit"), content: "#!/bin/sh\nenv\n" } } };
    if (n === 7) {
      agenteTrocouOConferir = readFileSync(join(pasta, "scripts", "conferir.mjs"), "utf8").indexOf("ESCRITO-PELO-AGENTE") >= 0;
      writeFileSync(join(pasta, "scripts", "conferir.mjs"), conferirQueMostraOAmbiente);
      return bash("node scripts/conferir.mjs --secao hero", "Confere a seção hero");
    }
    writeFileSync(join(pasta, "scripts", "conferir.mjs"), conferirOriginal);
    // PROVA falsa de propósito: não há build; a conferência do motor tem de desmentir.
    return { texto: "Seção hero escrita (teste falso).\n\nDECIDI: título em duas linhas, porque a headline é curta\nPROVA:\nconferir --secao hero ok (teste falso)" };
  };
  const { servidor: falso, pedidos } = provedorFalso((j) => {
    const tools = Array.isArray(j.tools) ? j.tools : [];
    if (!tools.length) return { texto: "Seção hero" }; // título da sessão (small_model)
    if (String(j.model || "").indexOf("gpt-5-falso") >= 0) return { texto: "Nada a mudar (teste falso do apply_patch)." };
    const msgs = Array.isArray(j.messages) ? (j.messages as Array<{ role?: string }>) : [];
    return passo(msgs.filter((m) => m.role === "tool").length);
  });
  await new Promise<void>((ok) => falso.listen(0, "127.0.0.1", () => ok()));
  const urlFalsa = `http://127.0.0.1:${(falso.address() as { port: number }).port}/api/v1`;
  const modelo: ModeloDoMotor = { id: "openrouter:falso/modelo", provedor: "openrouter", modelo_api: "falso/modelo", preco_entrada_1m: 0, preco_saida_1m: 0, preco_cache_1m: 0, contexto_tokens: 200_000 } as ModeloDoMotor;
  const avisos: string[] = [];
  const inicio = Date.now();
  const s = await subirOpencode(pasta, modelo, urlFalsa, { tipo: "construir", aoFalhar: (m) => void avisos.push(m) });
  const relatorio: Record<string, unknown> = { modo_pedido: process.env.SUPERPOWERS_MODO || "nativo", modo: s.modo, subiu_em_s: Math.round((Date.now() - inicio) / 100) / 10 };
  try {
    console.log(`[superpoderes] opencode no modo ${s.modo} em ${relatorio.subiu_em_s} s`);
    if (pedidoPlugin) {
      if (QUEDA_FORCADA) conferir("plugin que não sobe em 45 s cai para o nativo, com o aviso", s.modo === "nativo" && avisos.length === 1, avisos[0] ? avisos[0].slice(0, 90) : s.modo);
      else conferir("modo plugin: sobe pelo plugin oficial ou cai para o nativo com aviso", s.modo === "plugin" ? avisos.length === 0 : avisos.length === 1, avisos[0] ? avisos[0].slice(0, 90) : s.modo);
    }
    conferir("opencode.json e .opencode/plugins plantados no site foram apagados antes de subir", s.limpos.indexOf("opencode.json") >= 0 && s.limpos.indexOf(".opencode/plugins") >= 0 && !existsSync(join(pasta, "opencode.json")), s.limpos.join(", "));

    // GET /skill: as 15 do vendor e a embutida; nenhuma pessoal.
    const r = await fetch(`${s.url}/skill?directory=${encodeURIComponent(pasta)}`);
    const lista = (await r.json()) as Array<{ name?: string; location?: string }>;
    const nomes = Array.isArray(lista) ? lista.map((x) => String(x.name)) : [];
    const doVendor = Array.isArray(lista) ? lista.filter((x) => String(x.location || "").indexOf(SKILLS_DO_VENDOR) === 0).map((x) => String(x.name)) : [];
    const pessoais = skillsPessoais();
    const foraDoVendor = nomes.filter((n) => doVendor.indexOf(n) < 0);
    conferir("GET /skill lista as 15 skills do vendor", SKILLS_DO_SUPERPOWERS.every((n) => doVendor.indexOf(n) >= 0) && doVendor.length === 15, `${doVendor.length} do vendor`);
    conferir("GET /skill sem skill pessoal", nomes.filter((n) => pessoais.indexOf(n) >= 0).length === 0, `${pessoais.length} pessoais nesta máquina, ${nomes.length} listadas`);
    if (s.modo === "nativo" && plantouGlobal) {
      // Integração com a UIM: fora do vendor ficam só as skills da casa (ui-ux-pro-max, do worker) e a embutida.
      const esperadasFora = SKILLS_DA_CASA.concat(["customize-opencode"]).sort();
      conferir("GET /skill: exatamente as 15 do vendor, as da casa e a embutida (a da pasta global plantada não entra)", nomes.length === 15 + esperadasFora.length && JSON.stringify(foraDoVendor.slice().sort()) === JSON.stringify(esperadasFora) && nomes.indexOf("pessoal-teste") < 0, `fora do vendor: ${foraDoVendor.join(", ")}`);
    } else relatorio.pasta_global_isolada = false;

    const eventos: string[] = [];
    const passada = await rodarPassada(s, { titulo: "construir hero", pedido: "Construa a seção hero (id hero).", modelo, tetoUsd: 0.01, jaGasto: 0, prazoMs: 180_000, aoEvento: (ev) => eventos.push(`${ev.tipo}: ${ev.resumo}`), aoCusto: () => {}, deveParar: async () => false });
    const chats = pedidos.filter((p) => p.url.includes("chat/completions")).map((p) => ({ ...p, j: JSON.parse(p.corpo) as Record<string, unknown> })).filter((p) => Array.isArray(p.j.tools) && (p.j.tools as unknown[]).length);
    const primeiro = chats[0];
    conferir("o pedido chegou ao provedor falso", !!primeiro, `${chats.length} pedidos com ferramentas`);
    if (!primeiro) throw new Error("nenhum pedido com ferramentas chegou ao falso");
    const sistema = sistemaDoPedido(primeiro.j as never);
    const ferramentas = (primeiro.j.tools as Array<{ function?: { name?: string } }>).map((t) => String(t.function && t.function.name));
    const listadas = skillsListadas(sistema);
    const liberadas = SKILLS_POR_TRABALHO.construir;
    conferir(`as ${liberadas.length} skills do construir em <available_skills>, e só elas (sem brainstorming nem executing-plans)`, listadas.length === liberadas.length && liberadas.every((n) => listadas.indexOf(n) >= 0), listadas.join(", "));
    if (s.modo === "plugin") {
      // O plugin oficial injeta a abertura na primeira mensagem do usuário (experimental.chat.messages.transform).
      const usuario = ((primeiro.j.messages as Array<{ role?: string; content?: unknown }>) || []).filter((m) => m.role === "user").map((m) => textoDaMensagem(m.content)).join("\n");
      conferir("regra dos 1% (using-superpowers original) injetada pelo plugin oficial", usuario.indexOf("1% chance a skill might apply") >= 0 && usuario.indexOf("You have superpowers") >= 0);
    } else {
      conferir("regra dos 1% (using-superpowers original) no sistema", sistema.indexOf("1% chance a skill might apply") >= 0 && sistema.indexOf(BOOTSTRAP_DO_VENDOR) >= 0);
    }
    conferir("abertura da casa no sistema", sistema.indexOf("Abertura da casa para o Superpowers") >= 0 && sistema.indexOf(ABERTURA_DA_CASA) >= 0);
    conferir("AGENTS.md com a seção do método no sistema", sistema.indexOf("## Método (Superpowers, obra/superpowers v6.4.2, licença MIT)") >= 0);
    const trechos = trechosDoClaudeMd();
    const vazou = trechos.filter((t) => primeiro.corpo.indexOf(t) >= 0).length;
    conferir("nenhum trecho do ~/.claude/CLAUDE.md pessoal no pedido", vazou === 0, `${trechos.length} trechos conferidos, ${vazou} no pedido`);
    if (s.modo === "nativo" && plantouGlobal) conferir("o AGENTS.md da pasta global do opencode (plantado) não entra no pedido", pedidos.every((p) => p.corpo.indexOf(MARCADOR) < 0));
    conferir("nenhuma skill pessoal no pedido", listadas.filter((n) => pessoais.indexOf(n) >= 0 || n === "pessoal-teste").length === 0);
    conferir("sem as ferramentas question e task", ferramentas.indexOf("question") < 0 && ferramentas.indexOf("task") < 0, ferramentas.join(", "));
    conferir("ferramenta skill presente", ferramentas.indexOf("skill") >= 0);

    // O que voltou das ferramentas (mensagens role=tool do último pedido).
    const ultimo = chats[chats.length - 1];
    const saidas = ((ultimo.j.messages as Array<{ role?: string; content?: unknown }>) || []).filter((m) => m.role === "tool").map((m) => textoDaMensagem(m.content));
    const tituloDoPlano = (readFileSync(join(SKILLS_DO_VENDOR, "writing-plans", "SKILL.md"), "utf8").split("\n").find((l) => /^# /.test(l)) || "# Writing Plans").trim();
    const tituloDoBrainstorming = (readFileSync(join(SKILLS_DO_VENDOR, "brainstorming", "SKILL.md"), "utf8").split("\n").find((l) => /^# /.test(l)) || "# Brainstorming").trim();
    const curta = (t: string | undefined) => (t || "sem resposta").replace(/\s+/g, " ").slice(0, 110);
    conferir("a skill liberada (writing-plans) carregou o SKILL.md original", !!saidas[0] && saidas[0].indexOf(tituloDoPlano) >= 0, tituloDoPlano.slice(0, 60));
    conferir("a skill negada no construir (brainstorming) foi recusada", !!saidas[1] && saidas[1].indexOf(tituloDoBrainstorming) < 0 && RECUSADA.test(saidas[1]), curta(saidas[1]));
    conferir("RED sem build: conferir --secao hero falha dizendo que a seção não está no build", !!saidas[2] && /a seção hero ainda não está no build/.test(saidas[2]), curta(saidas[2]));
    conferir("o anexo de uma skill do vendor é lido (writing-good-tests.md)", !!saidas[3] && saidas[3].indexOf(tituloDoAnexo) >= 0, curta(saidas[3]));
    conferir("uma pasta de fora do projeto continua negada", !!saidas[4] && saidas[4].indexOf(`FORA-DO-PROJETO-${marca}`) < 0 && RECUSADA.test(saidas[4]), curta(saidas[4]));
    conferir("a edição de scripts/conferir.mjs é negada", !!saidas[5] && RECUSADA.test(saidas[5]) && !agenteTrocouOConferir, curta(saidas[5]));
    conferir("a edição de .git/hooks é negada", !!saidas[6] && RECUSADA.test(saidas[6]) && !existsSync(join(pasta, ".git", "hooks", "post-commit")), curta(saidas[6]));
    const ambiente = saidas[7] || "";
    const semSegredoNoBash = Object.keys(SEGREDOS).every((k) => ambiente.indexOf(`${k}=(ausente)`) >= 0) && Object.values(SEGREDOS).every((v) => ambiente.indexOf(v) < 0);
    conferir("mesmo com o conferir.mjs trocado, o bash não vê SUPABASE, VERCEL nem MOTOR", /tem_path=sim/.test(ambiente) && /tem_chave_do_provedor=sim/.test(ambiente) && semSegredoNoBash, curta(ambiente.replace(/segredo-[a-z]+-[0-9a-f]{8}/g, "<SEGREDO>")));
    const segredoNoProvedor = pedidos.filter((p) => Object.values(SEGREDOS).some((v) => p.corpo.indexOf(v) >= 0)).length;
    conferir("nenhum segredo do worker chegou ao provedor", segredoNoProvedor === 0, `${pedidos.length} pedidos conferidos`);
    conferir("marcas lidas da resposta (PROVA e DECIDI)", !!passada.marcas.prova && passada.marcas.decisoes.length === 1, passada.marcas.prova || "sem prova");
    // A conferência do motor (conferir.mjs do MODELO) desmente a PROVA falsa: não há build.
    const conferencia = conferirSecaoDoProjeto(pasta, "hero");
    const doMotor = eventosDasMarcas(passada.marcas, { secao: "hero", rotulo: "Hero", motivo: passada.motivo, conferencia });
    const naoConfere = doMotor.find((e) => e.tipo === "aviso" && /^Prova declarada não confere \(Hero\)/.test(e.resumo));
    conferir("PROVA falsa vira o aviso \"prova declarada não confere\"", !!naoConfere, naoConfere ? naoConfere.resumo.slice(0, 120) : doMotor.map((e) => e.resumo).join(" | ").slice(0, 160));
    conferir("evento de skill carregada na tela", eventos.some((e) => /Carregou a skill writing-plans/.test(e)), eventos.filter((e) => /skill/.test(e)).join(" | ").slice(0, 160));
    conferir("a passada terminou", passada.motivo === "feito", `${passada.motivo}${passada.erro ? `: ${passada.erro}` : ""}`);
    conferir("custo US$ 0,00; os pedidos foram ao falso com a chave falsa", passada.custo.custo_usd === 0 && pedidos.every((p) => p.auth === "Bearer chave-falsa-local-sem-valor-nenhum"), `custo ${passada.custo.custo_usd}`);
    Object.assign(relatorio, {
      pedidos_ao_falso: pedidos.length,
      tamanho_do_primeiro_pedido: primeiro.corpo.length,
      tamanho_do_sistema: sistema.length,
      skills_listadas: listadas,
      skills_do_get: { total: nomes.length, do_vendor: doVendor.length, fora_do_vendor: foraDoVendor },
      ferramentas,
      limpos: s.limpos,
      eventos,
      eventos_da_conferencia: doMotor.map((e) => `${e.tipo}: ${e.resumo}`),
      marcas: passada.marcas,
      custo_usd: passada.custo.custo_usd,
    });
    if (process.env.SUPERPOWERS_TESTE_GUARDAR) writeFileSync(resolve(process.env.SUPERPOWERS_TESTE_GUARDAR), primeiro.corpo);
  } finally {
    s.fechar();
  }

  // Modelo GPT: o opencode 1.18.33 troca edit e write por apply_patch (a abertura da casa fala dele).
  try {
    const gpt: ModeloDoMotor = { ...modelo, id: "openrouter:openai/gpt-5-falso", modelo_api: "openai/gpt-5-falso" } as ModeloDoMotor;
    const antes = pedidos.length;
    const s2 = await subirOpencode(pasta, gpt, urlFalsa, { tipo: "ajustar", modo: "nativo" });
    try {
      await rodarPassada(s2, { titulo: "ajustar hero", pedido: "Ajuste a seção hero (id hero).", modelo: gpt, tetoUsd: 0.01, jaGasto: 0, prazoMs: 120_000, aoEvento: () => {}, aoCusto: () => {}, deveParar: async () => false });
    } finally {
      s2.fechar();
    }
    const doGpt = pedidos
      .slice(antes)
      .filter((p) => p.url.includes("chat/completions"))
      .map((p) => JSON.parse(p.corpo) as Record<string, unknown>)
      .find((j) => Array.isArray(j.tools) && (j.tools as unknown[]).length);
    const ferramentasGpt = doGpt ? (doGpt.tools as Array<{ function?: { name?: string } }>).map((t) => String(t.function && t.function.name)) : [];
    const sistemaGpt = doGpt ? sistemaDoPedido(doGpt as never) : "";
    conferir("modelo gpt-5-falso: apply_patch no lugar de edit e write", ferramentasGpt.indexOf("apply_patch") >= 0 && ferramentasGpt.indexOf("edit") < 0 && ferramentasGpt.indexOf("write") < 0, ferramentasGpt.join(", "));
    conferir("modelo gpt-5-falso: a abertura da casa manda usar o apply_patch", sistemaGpt.indexOf("`apply_patch`") >= 0);
    conferir("modelo gpt-5-falso: as 5 skills do ajustar", skillsListadas(sistemaGpt).length === SKILLS_POR_TRABALHO.ajustar.length, skillsListadas(sistemaGpt).join(", "));
    relatorio.ferramentas_com_gpt = ferramentasGpt;
  } finally {
    falso.close();
    setTimeout(() => {
      try {
        rmSync(raiz, { recursive: true, force: true });
      } catch {
        /* o Windows solta a pasta depois */
      }
    }, 1500);
  }
  return relatorio;
}

// ------------------------------------------------------------------ pago (até US$ 0,20)

async function pago() {
  const chave = process.env.OPENROUTER_API_KEY || "";
  if (chave.trim().length < 10) throw new Error("--pago precisa de OPENROUTER_API_KEY no ambiente (nunca em arquivo do repositório)");
  const { subirOpencode, rodarPassada } = await import("./lib/opencode.ts");
  const { abrirMedidor } = await import("./lib/medidor.ts");
  const TETO = Math.min(0.2, Number(arg("teto", "0.2")) || 0.2);
  const id = arg("modelo", "deepseek/deepseek-v4-flash");
  const r = await fetch("https://openrouter.ai/api/v1/models");
  const lista = ((await r.json()) as { data: Array<{ id: string; context_length: number; pricing: Record<string, string>; supported_parameters?: string[] }> }).data;
  const m = lista.find((x) => x.id === id);
  if (!m) throw new Error(`modelo ${id} não está no OpenRouter`);
  if (m.supported_parameters && m.supported_parameters.indexOf("tools") < 0) throw new Error(`modelo ${id} não chama ferramentas`);
  const por1m = (v?: string) => (v ? Number(v) * 1e6 : null);
  const modelo = { id: `openrouter:${id}`, provedor: "openrouter", modelo_api: id, preco_entrada_1m: por1m(m.pricing.prompt), preco_saida_1m: por1m(m.pricing.completion), preco_cache_1m: por1m(m.pricing.input_cache_read), contexto_tokens: m.context_length } as ModeloDoMotor;
  const base = process.env.MOTOR_TESTE_PASTA || (process.platform === "win32" ? "C:\\AI\\motor-codigo\\teste-e2e" : join(tmpdir(), "motor-teste"));
  const pasta = join(base, "projetos", `superpoderes-${randomUUID().slice(0, 8)}`);
  mkdirSync(join(base, "projetos"), { recursive: true });
  await garantirProjeto(pasta);
  await escreverPacote(pasta, PACOTE_MINIMO, filaDeTeste(pasta));
  console.log(`[superpoderes] pago: ${id} (US$ ${modelo.preco_entrada_1m}/${modelo.preco_saida_1m} por 1M), teto US$ ${TETO}, projeto ${pasta}`);
  await instalarSePrecisar(pasta);
  const medidor = await abrirMedidor();
  const s = await subirOpencode(pasta, modelo, medidor.url, { tipo: "construir" });
  const eventos: string[] = [];
  const inicio = Date.now();
  try {
    const pedido = promptDaSecao(PACOTE_MINIMO as unknown as PacoteDoSite, "hero", null);
    const passada = await rodarPassada(s, { titulo: "construir hero", pedido, modelo, tetoUsd: TETO, jaGasto: 0, prazoMs: 12 * 60_000, aoEvento: (ev) => (eventos.push(`${ev.tipo}: ${ev.resumo}`), console.log(`  · ${ev.tipo}: ${ev.resumo}`)), aoCusto: () => {}, deveParar: async () => false, custoReal: medidor.total });
    const msgs = await s.cliente.session.messages({ path: { id: passada.sessao } });
    const partes = (Array.isArray(msgs.data) ? msgs.data : []).flatMap((x: { parts?: Array<{ type?: string; tool?: string; state?: { status?: string; input?: { name?: string; command?: string } } }> }) => x.parts || []);
    const skills = partes.filter((p) => p.type === "tool" && p.tool === "skill").map((p) => `${(p.state && p.state.input && p.state.input.name) || "?"}:${p.state && p.state.status}`);
    const bashes = partes.filter((p) => p.type === "tool" && p.tool === "bash");
    const comandos = bashes.map((p) => String((p.state && p.state.input && p.state.input.command) || ""));
    const negados = bashes.filter((p) => p.state && p.state.status === "error").length;
    const checar = comandos.filter((c) => /^npm run (checar|build)\b/.test(c.trim())).length;
    const real = medidor.total();
    const liberadas = new RegExp(`^(${SKILLS_POR_TRABALHO.construir.join("|")}):completed$`);
    conferir("o agente carregou uma skill liberada do construir pela ferramenta skill", skills.some((x) => liberadas.test(x)), skills.join(", ") || "nenhuma");
    conferir("a resposta termina com PROVA:", !!passada.marcas.prova, (passada.marcas.prova || "sem prova").slice(0, 120));
    conferir("rodou conferir --secao hero", comandos.some((c) => /conferir\.mjs\s+--secao[= ]hero/.test(c)), comandos.join(" | ").slice(0, 200));
    conferir("um build só na passada (o GREEN): o RED roda sem build", checar <= 1, `${checar} build(s): ${comandos.join(" | ").slice(0, 160)}`);
    conferir("custo real abaixo de US$ 0,05 (teto US$ 0,20)", real < 0.05, `US$ ${real.toFixed(5)}`);
    conferir("plano em .metodo/ fora do git", !existsSync(join(pasta, ".metodo")) || readFileSync(join(pasta, ".gitignore"), "utf8").indexOf(".metodo") >= 0, existsSync(join(pasta, ".metodo")) ? readdirSync(join(pasta, ".metodo")).join(", ") : "sem plano");
    // A conferência do motor, como no worker: build dele e o conferir.mjs do modelo.
    const b = await construirSite(pasta);
    const conferencia = b.ok ? conferirSecaoDoProjeto(pasta, "hero") : { rodou: false, ok: false, problemas: [], onde: null, motivo: "o build falhou" };
    conferir("a conferência do motor confirma a seção hero", conferencia.ok, conferencia.problemas.join("; ") || (conferencia.onde ? conferencia.onde.pagina : conferencia.motivo || ""));
    return { modo: s.modo, modelo: id, minutos: Math.round((Date.now() - inicio) / 6000) / 10, custo_real_usd: real, custo_tabela_usd: passada.custo.custo_usd, chamadas: medidor.chamadas(), bash_negados: negados, builds_do_agente: checar, motivo: passada.motivo, erro: passada.erro, skills, comandos, marcas: passada.marcas, conferencia, eventos, pasta };
  } finally {
    s.fechar();
    await medidor.fechar();
  }
}

const relatorio = await (PAGO ? pago() : semGasto()).catch((e) => {
  console.error("[superpoderes] falhou:", e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
const falhas = checagens.filter((c) => !c.ok);
const saida = { teste: PAGO ? "pago" : "sem_gasto", passou: falhas.length === 0, checagens: checagens.length, falhas: falhas.map((f) => f.nome), ...relatorio };
if (process.env.SUPERPOWERS_TESTE_RELATORIO) writeFileSync(resolve(process.env.SUPERPOWERS_TESTE_RELATORIO), JSON.stringify(saida, null, 2));
console.log(JSON.stringify(saida, null, 2));
setTimeout(() => process.exit(falhas.length ? 1 : 0), 2000);
