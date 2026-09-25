import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_VERSION } from "../../supabase/functions/_shared/mcp-release";
import {
  AGENTE_DA_AREA,
  aindaVale,
  chaveDoAprendizado,
  consolidarFatos,
  contextoParaAgente,
  escolhaAcimaDoCorte,
  fatoDaMemoria,
  fatoDaReprovacao,
  fatosDaEvolucao,
  lerCerebro,
  perguntasDeDuplicidade,
  registrarAprendizado,
  resumoParaPrompt,
  type FatoDoCerebro,
} from "../../supabase/functions/_shared/cerebro-do-cliente";
import {
  acaoPermitida,
  juntarBriefingDeAds,
  lerRespostaDaMesa,
  prazoDaAcao,
} from "../../supabase/functions/_shared/mcp-mesas-ponte";
import { CLIENT_SCOPED_LEGACY_TOOLS, OAUTH_STAFF_SCOPES, oauthScopesForStaff } from "../../supabase/functions/_shared/mcp-security";

/**
 * MCP 2.3 (pedido do dono, 25/09): "ele também pode fazer as coisas lá
 * dentro; não só ver; quando precisar, agir", "vai aprendendo com os ajustes
 * que eu peço, para cada cliente uma memória" e "tudo que fazemos aqui passa
 * automaticamente no painel; tem que ser bidirecional".
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const acoes = ler("supabase/functions/_shared/mcp-mesas-acoes.ts");
const servidor = ler("supabase/functions/mcp-server/index.ts");
const auth = ler("supabase/functions/_shared/mcp-auth.ts");

const ACOES = [
  "aceleriq_mesa_calendario_pedido",
  "aceleriq_mesa_calendario_gravar",
  "aceleriq_mesa_campanha_criar",
  "aceleriq_mesa_campanha_salvar",
  "aceleriq_mesa_ads_briefing_salvar",
  "aceleriq_mesa_ads_oferta_salvar",
  "aceleriq_mesa_ads_oferta_do_contexto",
  "aceleriq_mesa_enviar_para_aprovacao",
];
const CEREBRO = ["aceleriq_cerebro_do_cliente", "aceleriq_cerebro_registrar"];

// ─── Banco de mentira, só o encadeamento que o cérebro usa ────
type Linha = Record<string, unknown>;
function bancoFalso(tabelas: Record<string, Linha[]>, opcoes: { semColunasNovas?: boolean } = {}) {
  const gravados: Array<{ tabela: string; op: string; dados: Linha; filtros: Array<[string, unknown]> }> = [];
  const COLUNAS_NOVAS = ["area", "categoria", "chave", "valido_ate", "reforcos", "substituida_por", "reforcado_em", "motivo", "evidencia", "fonte", "criado_por"];
  const from = (tabela: string) => {
    let op = "select";
    let dados: Linha = {};
    const filtros: Array<[string, unknown]> = [];
    const resolver = () => {
      if (op === "insert" || op === "update") {
        if (opcoes.semColunasNovas && Object.keys(dados).some((k) => COLUNAS_NOVAS.includes(k))) {
          return { data: null, error: { code: "PGRST204", message: "Could not find the 'area' column" } };
        }
        gravados.push({ tabela, op, dados, filtros: [...filtros] });
        return { data: op === "insert" ? { id: `novo-${gravados.length}` } : null, error: null };
      }
      const linhas = (tabelas[tabela] ?? []).filter((l) => filtros.every(([k, v]) => !(k in l) || l[k] === v));
      return { data: linhas, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, order: () => q, limit: () => q, in: () => q, gte: () => q, is: () => q,
      eq: (k: string, v: unknown) => { filtros.push([k, v]); return q; },
      insert: (d: Linha) => { op = "insert"; dados = d; return q; },
      update: (d: Linha) => { op = "update"; dados = d; return q; },
      single: () => Promise.resolve(resolver()),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, erro),
    };
    return q;
  };
  return { db: { from }, gravados };
}

const CLIENTE = "11111111-2222-4333-8444-555555555555";

describe("o catálogo 2.3 está registrado", () => {
  const registro = tools.slice(tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["), tools.indexOf("export const TOOLS: readonly ToolDefinition[]"));

  it("versão 2.3.0 (o cliente MCP cacheia o catálogo)", () => {
    expect(MCP_VERSION).toBe("2.3.0");
  });

  it("dez ferramentas novas, com escopo granular e no registro", () => {
    for (const nome of [...ACOES, ...CEREBRO]) expect(tools).toContain(`'${nome}'`);
    for (const nome of ACOES) expect(tools).toContain(`${nome}: 'mesas:write'`);
    expect(tools).toContain("aceleriq_cerebro_do_cliente: 'clients:read'");
    expect(tools).toContain("aceleriq_cerebro_registrar: 'clients:write'");
    for (const v of ["cerebroDoClienteTool,", "cerebroRegistrarTool,", "calendarioPedidoTool,", "enviarParaAprovacaoTool,", "adsBriefingSalvarTool,"]) {
      expect(registro).toContain(v);
    }
  });

  it("escopo mesas:write existe em todas as pontas e é concedível a staff", () => {
    expect(tools).toContain("| 'mesas:write'");
    expect(tools).toMatch(/export const ALL_SCOPES[\s\S]*?'mesas:write',[\s\S]*?\] as const;/);
    expect(tools).toContain("'mesas:write': { title: 'Mesas: agir'");
    expect(tools.slice(tools.indexOf("export const SCOPE_EXPANSIONS"), tools.indexOf("export function expandScopes"))).toContain("'mesas:write',");
    expect(auth).toContain("'mesas:write'");
    expect((OAUTH_STAFF_SCOPES as readonly string[]).includes("mesas:write")).toBe(true);
    expect(oauthScopesForStaff(true, "openid mesas:write")).toEqual(["mesas:write"]);
  });

  it("chave restrita a cliente não alcança nenhuma ferramenta nova", () => {
    for (const nome of [...ACOES, ...CEREBRO]) expect((CLIENT_SCOPED_LEGACY_TOOLS as readonly string[]).includes(nome)).toBe(false);
  });

  it("o mapa do painel e o initialize apontam as ações e o cérebro", () => {
    expect(tools).toMatch(/area: 'Mesa do cliente', rota: '\/mesa'[^\n]*aceleriq_mesa_calendario_pedido/);
    expect(tools).toMatch(/area: 'Cerebro do cliente'[^\n]*aceleriq_cerebro_registrar/);
    const init = servidor.slice(servidor.indexOf('if (method === "initialize")'), servidor.indexOf('if (method === "notifications/initialized"'));
    expect(init).toContain("aceleriq_cerebro_do_cliente");
    expect(init).toContain("aceleriq_mesa_");
  });

  it("descrições em português, sem travessão, e dizendo que exige OAuth", () => {
    for (const nome of ACOES) {
      const i = tools.indexOf(`'${nome}',`);
      const trecho = tools.slice(i, tools.indexOf("z.object(", i));
      expect(trecho).not.toMatch(/[–—]/);
    }
    expect(tools).toContain("Exige conexão OAuth");
  });
});

describe("as ações chamam a mesa, não refazem a regra", () => {
  it("só chamam as funções e ações da lista fechada", () => {
    expect(acaoPermitida("agente-calendario", "pedido_livre")).toBe(true);
    expect(acaoPermitida("mesa-ads", "oferta_salvar")).toBe(true);
    expect(acaoPermitida("estudio-arte", "entregar")).toBe(true);
    expect(acaoPermitida("mesa-ads", "plano_gerar")).toBe(false);
    expect(acaoPermitida("mesa-foto", "tomada_gerar")).toBe(false);
    expect(acaoPermitida("admin-reset-client-access", "x")).toBe(false);
  });

  it("vão com o token da pessoa, nunca com a chave de serviço", () => {
    expect(acoes).toContain("Authorization: `Bearer ${token}`");
    expect(acoes).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(acoes).toContain("ctx.dataScope?.source !== 'oauth'");
    // O token nunca vai para log.
    expect(acoes).not.toMatch(/console\.(log|error|warn)\([^)]*token/);
    // Nada de insert/update direto nas tabelas das mesas: quem grava é a mesa.
    expect(acoes).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("prazo longo só para IA e entrega", () => {
    expect(prazoDaAcao("agente-calendario", "pedido_livre")).toBeGreaterThan(300_000);
    expect(prazoDaAcao("agente-calendario", "campanha_salvar")).toBe(60_000);
  });

  it("lê a resposta com fôlego: espaços antes do JSON e erro no corpo", () => {
    expect(lerRespostaDaMesa("   \n {\"proposta\":{\"id\":\"p1\"}}", 200)).toEqual({ ok: true, dados: { proposta: { id: "p1" } } });
    const erro = lerRespostaDaMesa("  {\"error\":\"sem_acesso_ao_cliente\",\"mensagem\":\"Você não tem acesso\",\"status_http\":403}", 200);
    expect(erro).toMatchObject({ ok: false, codigo: "sem_acesso_ao_cliente", status: 403, mensagem: "Você não tem acesso" });
    expect(lerRespostaDaMesa("<html>", 502)).toMatchObject({ ok: false, codigo: "resposta_invalida" });
    expect(lerRespostaDaMesa("{\"error\":\"acao_desconhecida\",\"aceitas\":[\"a\"]}", 400)).toMatchObject({ ok: false, detalhes: { aceitas: ["a"] } });
  });

  it("briefing de ads: o que não veio fica, e o agente não marca autorização de depoimento", () => {
    const atual = {
      oferta: { produto: "Pizza", promessa: "Chega quente" },
      publico: { quem: "Famílias" },
      provas: [{ tipo: "depoimento", texto: "Melhor pizza", autorizado: true }],
      objecoes: [{ texto: "Caro" }],
      restricoes: "Sem preço",
    };
    const novo = juntarBriefingDeAds(atual, {
      oferta: { promessa: "Em 30 minutos" },
      provas: [{ tipo: "depoimento", texto: "Melhor pizza", autorizado: true }, { tipo: "depoimento", texto: "Nova fala", autorizado: true }],
    });
    expect(novo.oferta).toEqual({ produto: "Pizza", promessa: "Em 30 minutos" });
    expect(novo.publico).toEqual({ quem: "Famílias" });
    expect(novo.objecoes).toEqual([{ texto: "Caro" }]);
    expect(novo.restricoes).toBe("Sem preço");
    expect((novo.provas as Linha[]).map((p) => p.autorizado)).toEqual([true, false]);
  });
});

describe("cérebro do cliente: leitura e resumo", () => {
  it("a chave ignora acento, pontuação e o rodapé do Estúdio", () => {
    expect(chaveDoAprendizado("Fundo CLARO, sempre! (pedido no card 2: mais claro)")).toBe(chaveDoAprendizado("fundo claro sempre"));
    expect(chaveDoAprendizado("Não usar vermelho")).toBe("nao usar vermelho");
  });

  it("linha antiga de agente_memoria vira fato com área e categoria deduzidas", () => {
    expect(fatoDaMemoria({ id: "1", agente: "diretor_arte", tipo: "evitar", origem: "aprovacao", texto: "O cliente pediu ajuste: letra maior" }))
      .toMatchObject({ area: "arte", categoria: "reprovado", reforcos: 1 });
    expect(fatoDaMemoria({ id: "2", agente: "estrategista_ads", tipo: "aprendizado", origem: "metrica", texto: "Ângulo dor: CPL 4,20" }))
      .toMatchObject({ area: "ads", categoria: "performou" });
    expect(fatoDaMemoria({ id: "3", agente: "estrategista", tipo: "preferencia", origem: "ajuste", texto: "Tom leve" })).toMatchObject({ area: "calendario", categoria: "ajuste" });
    expect(fatoDaMemoria({ id: "4", texto: "   " })).toBeNull();
  });

  it("repetido vira reforço e vencido some", () => {
    const agora = new Date("2026-09-25T12:00:00Z");
    const base: FatoDoCerebro = { id: "a", area: "arte", categoria: "preferencia", texto: "Fundo claro", motivo: null, evidencia: null, fonte: "memoria", criado_em: "2026-09-01", valido_ate: null, reforcos: 1, chave: "fundo claro" };
    const fatos = consolidarFatos([
      base,
      { ...base, id: "b", texto: "Fundo claro!", criado_em: "2026-09-20" },
      { ...base, id: "c", texto: "Vencido", chave: "vencido", valido_ate: "2026-09-01T00:00:00Z" },
    ], agora);
    expect(fatos).toHaveLength(1);
    expect(fatos[0]).toMatchObject({ id: "b", reforcos: 2 });
    expect(aindaVale("2026-10-01", agora)).toBe(true);
    expect(aindaVale(null, agora)).toBe(true);
  });

  it("o resumo respeita o teto, põe o que evitar primeiro e avisa o que ficou de fora", () => {
    const fatos: FatoDoCerebro[] = Array.from({ length: 40 }, (_, i) => ({
      id: String(i), area: "arte", categoria: i % 2 ? "preferencia" : "evitar",
      texto: `Aprendizado número ${i} com texto razoavelmente comprido para ocupar espaço no prompt`,
      motivo: null, evidencia: null, fonte: "memoria", criado_em: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
      valido_ate: null, reforcos: i === 7 ? 5 : 1, chave: `k${i}`,
    }));
    const r = resumoParaPrompt(fatos, { areas: ["arte"], limite: 900 });
    expect(r.texto.length).toBeLessThanOrEqual(900);
    expect(r.texto).toContain("EVITAR");
    expect(r.fora).toBeGreaterThan(0);
    expect(r.texto).toMatch(/fora deste resumo/);
    const largo = resumoParaPrompt(fatos, { areas: ["arte"], limite: 6000 });
    expect(largo.texto.length).toBeLessThanOrEqual(6000);
    expect(largo.texto.indexOf("EVITAR")).toBeGreaterThan(-1);
    expect(largo.texto.indexOf("EVITAR")).toBeLessThan(largo.texto.indexOf("PREFERÊNCIAS"));
    // O mais reforçado abre a sua seção.
    const prefs = largo.texto.slice(largo.texto.indexOf("PREFERÊNCIAS"));
    expect(prefs.split("\n")[1]).toContain("pedido 5 vezes");
    expect(resumoParaPrompt(fatos, { areas: ["ads"] }).texto).toBe("");
  });

  it("reprovação com comentário e evolução do Instagram viram fatos", () => {
    expect(fatoDaReprovacao({ id: "e", event_type: "client_rejected", feedback: "Cor errada da marca", created_at: "2026-09-20T10:00:00Z" }))
      .toMatchObject({ area: "arte", categoria: "reprovado", motivo: "Cor errada da marca" });
    expect(fatoDaReprovacao({ id: "e", event_type: "client_rejected", feedback: "" })).toBeNull();
    const semanas = [
      { week_start: "2026-09-15", reach: 1500, followers: 820 },
      { week_start: "2026-09-08", reach: 1000, followers: 800 },
      { week_start: "2026-09-01", reach: 1000, followers: 790 },
    ];
    const f = fatosDaEvolucao(semanas);
    expect(f[0].texto).toContain("+50%");
    expect(f[1].texto).toContain("+30");
    expect(fatosDaEvolucao(semanas.slice(0, 2))).toEqual([]);
  });

  it("lerCerebro junta as fontes, e fonte que falha vira aviso", async () => {
    const { db } = bancoFalso({
      agente_memoria: [{ id: "m1", client_id: CLIENTE, agente: "diretor_arte", tipo: "preferencia", origem: "manual", texto: "Fundo claro", ativa: true, criado_em: "2026-09-10" }],
      ads_aprendizados: [{ id: "a1", texto: "Ângulo prova social venceu", evidencia: "E3", periodo_inicio: "2026-09-01", periodo_fim: "2026-09-14", criado_em: "2026-09-15" }],
    });
    const falho = { from: (t: string) => (t === "social_post_metrics" ? { select: () => { throw new Error("caiu"); } } : db.from(t)) };
    const r = await lerCerebro(falho, CLIENTE, { agora: new Date("2026-09-25") });
    expect(r.fatos.map((f) => f.area).sort()).toEqual(["ads", "arte"]);
    expect(r.avisos.join(" ")).toContain("social_post_metrics");
  });

  it("contextoParaAgente junta cérebro da área e dossiê atual, com teto", async () => {
    const { db } = bancoFalso({
      agente_memoria: [{ id: "m1", client_id: CLIENTE, agente: "diretor_arte", tipo: "evitar", origem: "manual", texto: "Nunca fundo preto", ativa: true, criado_em: "2026-09-10" }],
      client_dossiers: [{ content: "x".repeat(5000), client_id: CLIENTE }],
    });
    const c = await contextoParaAgente(db, CLIENTE, "arte", { limiteDossie: 1000, agora: new Date("2026-09-25") });
    expect(c.cerebro).toContain("Nunca fundo preto");
    expect(c.dossie).toContain("[dossiê cortado para caber]");
    expect(c.texto).toContain("DOSSIÊ ATUAL DO CLIENTE");
  });
});

describe("cérebro do cliente: escrever sem duplicar", () => {
  const ativo = { id: "m1", client_id: CLIENTE, agente: "diretor_arte", tipo: "preferencia", origem: "manual", texto: "Fundo claro", ativa: true, reforcos: 2, criado_em: "2026-09-10" };

  it("texto igual vira reforço, sem linha nova", async () => {
    const { db, gravados } = bancoFalso({ agente_memoria: [ativo] });
    const r = await registrarAprendizado(db, { client_id: CLIENTE, area: "arte", categoria: "preferencia", texto: "fundo CLARO.", fonte: "teste" });
    expect(r.situacao).toBe("reforcado");
    expect(r.reforcos).toBe(3);
    expect(gravados.filter((g) => g.op === "insert")).toHaveLength(0);
  });

  it("o Jev diz que repete: reforça; diz que contradiz: grava o novo e aposenta o antigo", async () => {
    const repete = bancoFalso({ agente_memoria: [ativo] });
    const r1 = await registrarAprendizado(repete.db, { client_id: CLIENTE, area: "arte", categoria: "preferencia", texto: "Usar fundos em tons claros", fonte: "teste" }, {
      julgar: async () => ({ repete: { choice: "m1", probabilities: { m1: 0.9, nenhum: 0.1 } }, contradiz: { choice: "nenhum", probabilities: { nenhum: 0.95 } } }),
    });
    expect(r1.situacao).toBe("reforcado");

    const contradiz = bancoFalso({ agente_memoria: [ativo] });
    const r2 = await registrarAprendizado(contradiz.db, { client_id: CLIENTE, area: "arte", categoria: "preferencia", texto: "Agora o fundo é escuro", fonte: "teste" }, {
      julgar: async () => ({ repete: { choice: "nenhum", probabilities: { nenhum: 0.9 } }, contradiz: { choice: "m1", probabilities: { m1: 0.92 } } }),
    });
    expect(r2.situacao).toBe("substituiu");
    expect(r2.substituidos).toEqual(["m1"]);
    const aposentado = contradiz.gravados.find((g) => g.op === "update");
    expect(aposentado?.dados).toMatchObject({ ativa: false });
    const novo = contradiz.gravados.find((g) => g.op === "insert");
    expect(novo?.dados).toMatchObject({ agente: "diretor_arte", area: "arte", categoria: "preferencia", tipo: "preferencia", origem: "manual", reforcos: 1 });
  });

  it("abaixo do corte o Jev não decide; e Jev fora do ar só vira aviso", async () => {
    const baixo = bancoFalso({ agente_memoria: [ativo] });
    const r = await registrarAprendizado(baixo.db, { client_id: CLIENTE, area: "arte", categoria: "evitar", texto: "Evitar texto em cima do rosto", fonte: "teste" }, {
      julgar: async () => ({ repete: { choice: "m1", probabilities: { m1: 0.5 } }, contradiz: { choice: "m1", probabilities: { m1: 0.6 } } }),
    });
    expect(r.situacao).toBe("criado");
    const fora = bancoFalso({ agente_memoria: [ativo] });
    const r2 = await registrarAprendizado(fora.db, { client_id: CLIENTE, area: "arte", categoria: "evitar", texto: "Outro aprendizado", fonte: "teste" }, {
      julgar: async () => { throw new Error("jev_timeout"); },
    });
    expect(r2.situacao).toBe("criado");
    expect(r2.avisos.join(" ")).toContain("Jev não respondeu");
  });

  it("sem o SQL novo: grava no formato antigo, e a área geral pede o SQL", async () => {
    const velho = bancoFalso({ agente_memoria: [] }, { semColunasNovas: true });
    const r = await registrarAprendizado(velho.db, { client_id: CLIENTE, area: "ads", categoria: "performou", texto: "Criativo de prova social teve CPL 30% menor", fonte: "teste" });
    expect(r.situacao).toBe("criado");
    expect(r.avisos.join(" ")).toContain("01_cerebro_memoria.sql");
    const insert = velho.gravados.find((g) => g.op === "insert");
    expect(Object.keys(insert!.dados).sort()).toEqual(["agente", "client_id", "origem", "referencia_id", "texto", "tipo"]);
    await expect(registrarAprendizado(velho.db, { client_id: CLIENTE, area: "geral", categoria: "preferencia", texto: "Tom sempre formal", fonte: "teste" }))
      .rejects.toThrow(/01_cerebro_memoria\.sql/);
  });

  it("valida área, categoria e texto", async () => {
    const { db } = bancoFalso({});
    await expect(registrarAprendizado(db, { client_id: CLIENTE, area: "x" as never, categoria: "preferencia", texto: "abc", fonte: "t" })).rejects.toThrow(/área inválida/);
    await expect(registrarAprendizado(db, { client_id: CLIENTE, area: "arte", categoria: "x" as never, texto: "abc", fonte: "t" })).rejects.toThrow(/categoria inválida/);
    await expect(registrarAprendizado(db, { client_id: CLIENTE, area: "arte", categoria: "evitar", texto: " a ", fonte: "t" })).rejects.toThrow(/curto/);
  });

  it("as perguntas ao Jev são Choice com saída nenhum e ids curtos traduzidos pelo código", () => {
    const { questions, mapa } = perguntasDeDuplicidade({ texto: "Fundo claro" }, [fatoDaMemoria(ativo)!]);
    expect(questions.repete.type).toBe("choice");
    expect(Object.keys(questions.repete.criteria)).toEqual(["m1", "nenhum"]);
    expect(Object.keys(questions.contradiz.criteria)).toEqual(["m1", "nenhum"]);
    expect(escolhaAcimaDoCorte({ choice: "m1", probabilities: { m1: 0.8 } }, mapa, 0.75)).toEqual({ id: "m1", probabilidade: 0.8 });
    expect(escolhaAcimaDoCorte({ choice: "nenhum", probabilities: { nenhum: 1 } }, mapa, 0.1)).toBeNull();
  });

  it("cada área grava no agente que os prompts atuais já leem", () => {
    expect(AGENTE_DA_AREA).toMatchObject({ calendario: "estrategista", arte: "diretor_arte", foto: "diretor_arte", ads: "estrategista_ads", conta: "estrategista_ads" });
  });
});

describe("SQL do cérebro e do dossiê (em docs, sem aplicar)", () => {
  const sql01 = ler("docs/cerebro/01_cerebro_memoria.sql");
  const sql02 = ler("docs/cerebro/02_dossie_eventos_das_mesas.sql");

  it("os arquivos existem, com o mapa dos agentes e a ordem de aplicação", () => {
    for (const f of ["01_cerebro_memoria.sql", "02_dossie_eventos_das_mesas.sql", "03_conferir_sem_alterar.sql", "AGENTES.md"]) {
      expect(existsSync(resolve(raiz, "docs/cerebro", f))).toBe(true);
    }
    const doc = ler("docs/cerebro/AGENTES.md");
    expect(doc).toContain("Ordem de aplicação");
    expect(doc).not.toMatch(/[–—]/);
    expect(ler("docs/cerebro/03_conferir_sem_alterar.sql")).toMatch(/ROLLBACK;\s*$/);
  });

  it("o cérebro aceita o agente geral, deduplica por chave ativa e desliga o vencido", () => {
    expect(sql01).toContain("'geral'");
    expect(sql01).toContain("agente_memoria_chave_ativa_unica");
    expect(sql01).toContain("cerebro_desligar_vencidos");
  });

  it("os gatilhos das mesas só enfileiram: nunca reescrevem o dossiê", () => {
    const gatilho = sql02.slice(sql02.indexOf("CREATE OR REPLACE FUNCTION public.mesa_movimento_enfileira"), sql02.indexOf("REVOKE ALL ON FUNCTION public.mesa_movimento_enfileira"));
    expect(gatilho).toContain("dossie_enfileirar");
    expect(gatilho).not.toMatch(/dossie_registrar_avancos|upsert_current_dossier|client_dossiers/);
    for (const t of ["mesa_campanhas", "calendario_propostas", "ads_ofertas", "ads_planos", "ads_criativos", "ads_briefings", "ads_aprendizados", "cliente_imagens", "agente_memoria"]) {
      expect(sql02).toContain(`('${t}',`);
    }
  });

  it("a porta pública mantém a guarda e o cliente nunca vê movimento das mesas", () => {
    expect(sql02).toContain("app_private.rpc_trusted_backend()");
    expect(sql02).toContain("PERFORM app_private.require_rpc_client_staff(_client_id);");
    expect(sql02).toContain("_so_visiveis := true;");
    const mesas = sql02.slice(sql02.indexOf("CREATE OR REPLACE FUNCTION app_private.movimentos_das_mesas"), sql02.indexOf("REVOKE ALL ON FUNCTION app_private.movimentos_das_mesas"));
    expect(mesas).not.toMatch(/,\s*true,\s*'(mesa_campanhas|calendario_propostas|ads_|cliente_imagens|agente_memoria)/);
    expect(sql02).toContain("REVOKE ALL ON FUNCTION app_private.movimentos_das_mesas(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;");
  });
});
