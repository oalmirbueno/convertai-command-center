import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Comercial com o Mercúrio (25/10/2026, MCP 2.18): a régua dos fatos com prova (inspirada no Comp AI CRM, MIT),
 * o pedido para parar (LGPD), a fila do agente, a conversa registrada com teto e horário do primeiro contato,
 * a Caixa do comercial sem aviso dobrado, o fato que grava ou vira sugestão e a Máquina de leads.
 * O banco é um falso em memória que entende as chamadas do supabase-js usadas pelo serviço.
 */

type Linha = Record<string, any>;
const banco: Record<string, Linha[]> = {};
let seq = 0;

function consulta(tabela: string) {
  const filtros: Array<(l: Linha) => boolean> = [];
  let modo: "select" | "insert" | "update" | "delete" = "select";
  let carga: Linha | null = null;
  let contar = false;
  let cabeca = false;
  let limite = Infinity;
  let ordem: { col: string; asc: boolean } | null = null;
  const linhas = () => (banco[tabela] = banco[tabela] || []);
  const casa = (l: Linha) => filtros.every((f) => f(l));
  const b: any = {
    select(_c?: string, o?: { count?: string; head?: boolean }) {
      if (o && o.count) contar = true;
      if (o && o.head) cabeca = true;
      return b;
    },
    insert(obj: Linha) { modo = "insert"; carga = obj; return b; },
    update(obj: Linha) { modo = "update"; carga = obj; return b; },
    delete() { modo = "delete"; return b; },
    eq(c: string, v: unknown) { filtros.push((l) => l[c] === v); return b; },
    neq(c: string, v: unknown) { filtros.push((l) => l[c] !== v); return b; },
    is(c: string, v: unknown) { filtros.push((l) => (l[c] ?? null) === v); return b; },
    in(c: string, vs: unknown[]) { filtros.push((l) => vs.indexOf(l[c]) >= 0); return b; },
    not(c: string, _op: string, v: string) { const lista = v.replace(/[()]/g, "").split(","); filtros.push((l) => lista.indexOf(String(l[c])) < 0); return b; },
    gte(c: string, v: string) { filtros.push((l) => String(l[c]) >= v); return b; },
    ilike(c: string, v: string) { filtros.push((l) => String(l[c]).toLowerCase() === v.toLowerCase()); return b; },
    order(c: string, o?: { ascending?: boolean }) { if (!ordem) ordem = { col: c, asc: !o || o.ascending !== false }; return b; },
    limit(n: number) { limite = n; return b; },
    maybeSingle() { return Promise.resolve(exec()).then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })); },
    single() { return Promise.resolve(exec()).then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })); },
    then(ok: any, erro: any) { return Promise.resolve(exec()).then(ok, erro); },
  };
  function exec(): { data: any; error: any; count?: number } {
    if (modo === "insert") {
      const nova: Linha = { id: `id-${++seq}`, created_at: new Date().toISOString(), ...(carga as Linha) };
      if (tabela === "commercial_lead_messages" && nova.id_externo && linhas().some((l) => l.lead_id === nova.lead_id && l.id_externo === nova.id_externo)) {
        return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      }
      linhas().push(nova);
      return { data: [nova], error: null };
    }
    if (modo === "update") {
      const alvo = linhas().filter(casa);
      alvo.forEach((l) => Object.assign(l, carga));
      return { data: alvo, error: null };
    }
    let r = linhas().filter(casa);
    if (ordem) {
      const { col, asc } = ordem;
      r = r.slice().sort((x, y) => (String(x[col]) < String(y[col]) ? (asc ? -1 : 1) : String(x[col]) > String(y[col]) ? (asc ? 1 : -1) : 0));
    }
    const total = r.length;
    r = r.slice(0, limite);
    if (contar && cabeca) return { data: null, error: null, count: total };
    return { data: r, error: null, count: total };
  }
  return b;
}

vi.mock("../../supabase/functions/_shared/aceleriq-read-services.ts", () => ({
  db: () => ({ from: (t: string) => consulta(t) }),
  isUuid: (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v),
  READ_LIMITS: { queryTimeoutMs: 5000 },
}));

import {
  comercialAvisarCaixa,
  comercialFila,
  comercialMaquinaBuscar,
  comercialRegistrarFato,
  comercialRegistrarMensagem,
  resumoDaConfig,
  agoraEmSaoPaulo,
} from "../../supabase/functions/_shared/aceleriq-commercial-services";
import { avaliarEvidencias, pedeParaParar } from "../../supabase/functions/_shared/comercial-evidencia";
import { FERRAMENTAS_POR_AREA } from "../../supabase/functions/mcp-server/modulos/guia-do-painel";
import { MCP_VERSION } from "../../supabase/functions/_shared/mcp-release";

const ctx = { dataScope: { unrestricted: true }, keyName: "hermes", scopes: ["admin"] } as any;
const restrito = { dataScope: { unrestricted: false }, keyName: "cliente", scopes: [] } as any;
const LEAD = "11111111-1111-4111-8111-111111111111";
const LEAD2 = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

function limpar() {
  for (const k of Object.keys(banco)) delete banco[k];
  banco.commercial_agente_config = [{ slug: "mercurio", ativo: true, limite_primeiros_contatos_dia: 1, horario_inicio: "09:00:00", horario_fim: "18:00:00", orientacoes: "Foque em clínicas" }];
  banco.commercial_leads = [
    { id: LEAD, name: "Ana", company: "Clínica Sorriso", whatsapp: "+55 41 99999-0000", stage: "novo", origin: "maquina_de_leads", qualificacao: {}, agente_slug: "mercurio", archived_at: null, organization_id: ORG, updated_at: "2026-10-25T10:00:00Z" },
    { id: LEAD2, name: "Bruno", company: "Pet Feliz", whatsapp: "+55 41 98888-0000", stage: "novo", origin: "prospeccao", qualificacao: {}, agente_slug: "mercurio", archived_at: null, organization_id: null, updated_at: "2026-10-25T09:00:00Z" },
  ];
  banco.commercial_organizations = [{ id: ORG, name: "Clínica Sorriso", cnpj: null }];
}

beforeEach(() => {
  vi.useFakeTimers();
  // 25/10/2026 12:00 em São Paulo.
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  limpar();
});
afterEach(() => vi.useRealTimers());

describe("régua dos fatos com prova", () => {
  it("primária grava, apoio sugere, dedução sozinha e contradição descartam", () => {
    expect(avaliarEvidencias([{ tipo: "cnpj_receita", detalhe: "consulta na Receita" }]).situacao).toBe("gravado");
    expect(avaliarEvidencias([{ tipo: "pagina_citada", detalhe: "matéria do jornal" }]).situacao).toBe("sugestao");
    expect(avaliarEvidencias([{ tipo: "pagina_citada", detalhe: "a" }, { tipo: "diretorio_publico", detalhe: "b" }]).situacao).toBe("sugestao");
    expect(avaliarEvidencias([{ tipo: "deducao_do_agente", detalhe: "parece" }]).situacao).toBe("descartado");
    const c = avaliarEvidencias([{ tipo: "site_oficial_da_empresa", detalhe: "rodapé" }, { tipo: "contradicao", detalhe: "o Instagram diz outro número" }]);
    expect(c.situacao).toBe("descartado");
    expect(c.porque).toContain("o Instagram diz outro número");
    expect(avaliarEvidencias([]).situacao).toBe("descartado");
  });

  it("pedido para parar: forte em qualquer texto, fraco só quando é quase só isso", () => {
    expect(pedeParaParar("Por favor, não me mande mais mensagens sobre isso, obrigado pela atenção")).toBe(true);
    expect(pedeParaParar("Não tenho interesse")).toBe(true);
    expect(pedeParaParar("PARAR")).toBe(true);
    expect(pedeParaParar("posso sair às 18h para a reunião?")).toBe(false);
    expect(pedeParaParar("quero saber o preço")).toBe(false);
  });

  it("horário e teto do dia em São Paulo", () => {
    const agora = agoraEmSaoPaulo();
    expect(agora.hora).toBe("12:00");
    expect(agora.data).toBe("2026-10-25");
    const r = resumoDaConfig({ ativo: true, limite_primeiros_contatos_dia: 3, horario_inicio: "13:00", horario_fim: "18:00" }, 1, agora);
    expect(r).toMatchObject({ dentro_do_horario: false, restam_hoje: 2 });
  });
});

describe("serviços do Mercúrio", () => {
  it("área da casa: credencial restrita a cliente não alcança a fila", async () => {
    await expect(comercialFila({}, restrito)).rejects.toThrow(/area interna/);
  });

  it("a fila traz os leads com a regra do dia; desligado, vem vazia com o aviso", async () => {
    const f = await comercialFila({}, ctx);
    expect(f.total).toBe(2);
    expect(f.config).toMatchObject({ ativo: true, limite_primeiros_contatos_dia: 1, restam_hoje: 1, dentro_do_horario: true, orientacoes: "Foque em clínicas" });
    expect(f.itens[0]).toMatchObject({ nome: "Ana", lead_frio: true, primeiro_contato_feito: false });
    banco.commercial_agente_config[0].ativo = false;
    const d = await comercialFila({}, ctx);
    expect(d.itens).toEqual([]);
    expect(d.aviso).toMatch(/desligado/);
  });

  it("primeiro contato frio conta no teto: o segundo do dia é recusado; idempotente pelo id externo", async () => {
    const r1 = await comercialRegistrarMensagem({ lead_id: LEAD, direcao: "saida", texto: "Oi Ana, aqui é da Aceleriq", id_externo: "wa-1" }, ctx);
    expect(r1).toMatchObject({ registrada: true, primeiro_contato: true });
    // Primeira mensagem enviada leva de novo para contato.
    expect(banco.commercial_leads[0].stage).toBe("contato");
    const de_novo = await comercialRegistrarMensagem({ lead_id: LEAD, direcao: "saida", texto: "Oi Ana, aqui é da Aceleriq", id_externo: "wa-1" }, ctx);
    expect(de_novo).toMatchObject({ registrada: false, duplicada: true });
    await expect(comercialRegistrarMensagem({ lead_id: LEAD2, direcao: "saida", texto: "Oi Bruno" }, ctx)).rejects.toThrow(/Teto do dia/);
    // Conversa já aberta não conta no teto.
    const r2 = await comercialRegistrarMensagem({ lead_id: LEAD, direcao: "saida", texto: "Posso te mandar um exemplo?" }, ctx);
    expect(r2).toMatchObject({ primeiro_contato: false });
  });

  it("fora do horário, o primeiro contato frio é recusado", async () => {
    vi.setSystemTime(new Date("2026-10-25T23:30:00Z"));
    await expect(comercialRegistrarMensagem({ lead_id: LEAD, direcao: "saida", texto: "Oi" }, ctx)).rejects.toThrow(/Fora do horario/);
  });

  it("pedido para parar marca nao_contatar e recusa as saídas seguintes", async () => {
    const r = await comercialRegistrarMensagem({ lead_id: LEAD, direcao: "entrada", texto: "não tenho interesse" }, ctx);
    expect(r).toMatchObject({ pediu_para_parar: true });
    expect(banco.commercial_leads[0].qualificacao.nao_contatar).toBe("sim");
    await expect(comercialRegistrarMensagem({ lead_id: LEAD, direcao: "saida", texto: "Mas olha essa oferta" }, ctx)).rejects.toThrow(/LGPD/);
  });

  it("Caixa: avisa com o telefone do lead e não dobra o mesmo aviso em 6 horas", async () => {
    const c = await comercialAvisarCaixa({ lead_id: LEAD, tipo: "avancou", resumo: "Quer proposta do plano mensal para 2 unidades" }, ctx);
    expect(c.item).toMatchObject({ tipo: "avancou", telefone: "+55 41 99999-0000", operador_slug: "mercurio" });
    expect(c.link).toBe(`/comercial/caixa?item=${c.item.id}`);
    // O default do banco (situacao 'nova') o falso não aplica sozinho.
    banco.commercial_handoffs[0].situacao = "nova";
    await expect(comercialAvisarCaixa({ lead_id: LEAD, tipo: "avancou", resumo: "De novo a mesma coisa" }, ctx)).rejects.toThrow(/Ja existe/);
    // Outro tipo passa.
    const f = await comercialAvisarCaixa({ lead_id: LEAD, tipo: "fechou", resumo: "Fechou o plano mensal" }, ctx);
    expect(f.avisado).toBe(true);
  });

  it("fato: prova forte grava na ficha (empresa e qualificação); apoio só sugere", async () => {
    const forte = await comercialRegistrarFato({ lead_id: LEAD, campo: "CNPJ", valor: "12.345.678/0001-90", evidencias: [{ tipo: "cnpj_receita", detalhe: "consulta na Receita em 25/10" }] }, ctx);
    expect(forte.avaliacao.situacao).toBe("gravado");
    expect(forte.escrito_em).toBe("commercial_organizations.cnpj");
    expect(banco.commercial_organizations[0].cnpj).toBe("12.345.678/0001-90");
    const cargo = await comercialRegistrarFato({ lead_id: LEAD, campo: "cargo", valor: "sócia", evidencias: [{ tipo: "lead_confirmou_na_conversa", detalhe: "ela disse: sou a sócia" }] }, ctx);
    expect(cargo.escrito_em).toBe("commercial_leads.qualificacao.cargo");
    const fraco = await comercialRegistrarFato({ lead_id: LEAD, campo: "whatsapp", valor: "+55 41 90000-0000", evidencias: [{ tipo: "diretorio_publico", detalhe: "guia da cidade" }] }, ctx);
    expect(fraco.avaliacao.situacao).toBe("sugestao");
    expect(fraco.escrito_em).toBeNull();
    expect(banco.commercial_leads[0].whatsapp).toBe("+55 41 99999-0000");
    expect(banco.commercial_facts.length).toBe(3);
  });

  it("máquina de leads: busca igual na fila não duplica", async () => {
    const a = await comercialMaquinaBuscar({ nicho: "clínica odontológica", cidade: "Curitiba", uf: "pr" }, ctx);
    expect(a.criada).toBe(true);
    expect(a.busca).toMatchObject({ uf: "PR", limite: 50, fontes: ["osm", "sites"] });
    a.busca.situacao = "na_fila";
    const b = await comercialMaquinaBuscar({ nicho: "Clínica Odontológica", cidade: "curitiba" }, ctx);
    expect(b).toMatchObject({ criada: false, duplicada: true });
  });
});

describe("MCP 2.18 com as ferramentas do comercial", () => {
  const novas = {
    aceleriq_comercial_fila: "commercial:read",
    aceleriq_comercial_maquina_candidatos: "commercial:read",
    aceleriq_comercial_registrar_mensagem: "commercial:write",
    aceleriq_comercial_avisar_caixa: "commercial:write",
    aceleriq_comercial_registrar_fato: "commercial:write",
    aceleriq_comercial_atribuir_agente: "commercial:write",
    aceleriq_comercial_maquina_buscar: "commercial:write",
  };

  it("cada ferramenta existe com o escopo certo, entra no guia do comercial e a versão subiu", () => {
    expect(MCP_VERSION).toBe("2.22.0");
    // O catálogo importa zod por URL (Deno): conferido pelo texto, como os outros testes do MCP.
    const tools = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/mcp-tools.ts"), "utf8");
    const lista = tools.slice(tools.indexOf("const RAW_TOOLS: readonly ToolDefinition[] = ["));
    for (const [nome, escopo] of Object.entries(novas)) {
      expect(tools, nome).toContain(`  ${nome}: '${escopo}',`);
      expect(tools, nome).toContain(`'${nome}',`);
      const variavel = (tools.match(new RegExp("const (\\w+) = ferramentaDoCrm\\(\\s*'" + nome + "'")) || [])[1];
      expect(variavel, nome).toBeTruthy();
      expect(lista, nome).toContain(`  ${variavel},`);
      expect(FERRAMENTAS_POR_AREA.comercial).toContain(nome);
    }
  });

  it("o roteiro do Mercúrio existe e fala das réguas", () => {
    const doc = readFileSync(resolve(__dirname, "../../docs/comercial/MERCURIO.md"), "utf8");
    for (const t of ["aceleriq_comercial_fila", "aceleriq_comercial_registrar_mensagem", "aceleriq_comercial_avisar_caixa", "aceleriq_comercial_registrar_fato", "nao_contatar", "Aceleriq"]) expect(doc).toContain(t);
    expect(doc.indexOf("—")).toBe(-1);
  });
});
