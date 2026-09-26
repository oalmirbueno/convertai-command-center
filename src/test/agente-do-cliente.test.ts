import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apelidosDoPlano,
  blocoDoPlanoParaPrompt,
  dataValida,
  type DadosDoPlano,
  normalizarCaminho,
  normalizarPlanoDoCliente,
  pedeCaminho,
} from "../../supabase/functions/agente-contexto/plano-do-cliente";
import { cargaDoItem, executarItemDoPlano, reverterItemDoPlano, type DependenciasDoExecutor } from "../../supabase/functions/agente-contexto/executor-do-plano";
import { organizarPorTipo, pastaDoTipo } from "../../supabase/functions/agente-contexto/organizar-por-tipo";
import { normalizarAcoesDoContexto } from "../../supabase/functions/agente-contexto/acoes-do-contexto";
import { limparSegredos, linhasDoBriefing, montarPacoteExterno, temSegredo } from "../../supabase/functions/_shared/pacote-externo";
import { briefingDeIdentidade, paletaDoBrandBook, propostaDoKitPeloBrandBook } from "../../supabase/functions/_shared/identidade-visual";
import { executarLeituras, FERRAMENTAS_DO_CLIENTE, NOMES_DAS_FERRAMENTAS, normalizarPedidosDeLeitura, termoDeBusca } from "../../supabase/functions/_shared/ferramentas-do-cliente";
import { conhecimentoDoPlano } from "../../supabase/functions/_shared/conhecimento-do-plano";
import { ferramentasDoMotor, motor, origemDoBloco } from "../../supabase/functions/_shared/motores";
import type { ItemDaAcaoDoAgente } from "../../supabase/functions/_shared/acoes-do-agente";

/**
 * Frente C (26/09): agente do cliente (modo plano do agente de contexto),
 * pacote para LLM externo e preparação da Mesa Identidade Visual.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function dados(extra: Partial<DadosDoPlano> = {}): DadosDoPlano {
  return {
    hoje: "2026-09-26",
    projetos: [],
    marcos: [],
    tarefas: [],
    equipe: [
      { id: id(901), nome: "Ana Design", papel: "design" },
      { id: id(902), nome: "Bruno Tráfego", papel: "traffic" },
    ],
    contexto: {},
    ...extra,
  };
}

// ------------------------------------------------------------------ plano (normalização)

describe("plano do cliente: normalização das ações", () => {
  it("projeto novo, marcos e tarefas com dono e prazo viram itens na ordem de execução, sem id no prompt", () => {
    const d = dados();
    const bloco = blocoDoPlanoParaPrompt(d);
    expect(bloco).not.toMatch(UUID);
    expect(bloco).toContain("e1 | Ana Design | design");
    const acao = normalizarPlanoDoCliente(
      {
        plano: {
          resumo: "Plano de entrada",
          projeto: { ref: "novo", nome: "Marketing Digital Softy", tipo: "marketing_digital", inicio: "2026-09-28", prazo: "2026-12-20", objetivos: "Aparecer no Google", escopo: null, descricao: null },
          marcos: [
            { ref: "mn1", titulo: "Analisar: diagnóstico", prazo: "2026-10-10", descricao: null },
            { ref: "mn2", titulo: "Estruturar: base de busca", prazo: "2026-10-31", descricao: null },
          ],
          tarefas: [
            { titulo: "Criar o Perfil da Empresa no Google", descricao: "com o dono", marco: "mn2", dono: "e2", prazo: "2026-10-20", frente: "traffic", entrega: "google_post", prioridade: "high" },
            { titulo: "Mapear concorrentes do nicho", descricao: null, marco: "mn1", dono: "e9", prazo: null, frente: "general", entrega: "planning", prioridade: "medium" },
          ],
          atualizar_tarefas: [],
        },
      },
      d,
      CLIENTE,
      "plano-1",
    )!;
    expect(acao).not.toBeNull();
    expect(acao.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["criar_projeto:pn1", "criar_marco:mn1", "criar_marco:mn2", "criar_tarefa:tn1", "criar_tarefa:tn2"]);
    expect(acao.contexto).toMatchObject({ client_id: CLIENTE, tipo: "plano" });
    const gmn = cargaDoItem(acao, acao.itens[3]);
    expect(gmn).toMatchObject({ projeto_novo: "pn1", marco_novo: "mn2", assigned_to: id(902), due_date: "2026-10-20", workstream: "traffic", delivery_type: "google_post", priority: "high" });
    // Dono que não existe: a tarefa entra sem dono; sem prazo, herda a data do marco.
    const concorrentes = cargaDoItem(acao, acao.itens[4]);
    expect(concorrentes.assigned_to).toBeNull();
    expect(concorrentes.due_date).toBe("2026-10-10");
    expect(acao.itens[4].detalhe).toContain("sem dono");
    // O item mostrado nunca leva id real no título nem no detalhe.
    for (const i of acao.itens) expect(`${i.titulo} ${i.detalhe}`).not.toMatch(UUID);
  });

  it("recusa prazo que já passou, tarefa sem prazo, título repetido e marco sem data; ignora apelido inventado", () => {
    const d = dados({
      projetos: [{ id: id(1), name: "Social Media", status: "active", project_type: "social_media", start_date: "2026-09-01", deadline: "2026-12-31" }],
      marcos: [{ id: id(11), project_id: id(1), title: "Clarear", status: "pending", target_date: "2026-10-15" }],
      tarefas: [{ id: id(21), project_id: id(1), milestone_id: null, title: "Escrever a promessa da marca", status: "todo", assigned_to: null, due_date: null, priority: "medium" }],
    });
    const acao = normalizarPlanoDoCliente(
      {
        plano: {
          resumo: "",
          projeto: null,
          marcos: [{ ref: "mn1", titulo: "Sem data", prazo: "ontem", descricao: null }],
          tarefas: [
            { titulo: "Tarefa velha", marco: null, dono: "e1", prazo: "2026-09-01", frente: "general", entrega: "other", prioridade: "low" },
            { titulo: "Sem prazo nenhum", marco: null, dono: "e1", prazo: null, frente: "general", entrega: "other", prioridade: "low" },
            { titulo: "escrever a PROMESSA da marca", marco: "m1", dono: "e1", prazo: "2026-10-01", frente: "content", entrega: "copywriting", prioridade: "medium" },
            { titulo: "Definir pilares", marco: "m1", dono: "e1", prazo: "2026-10-02", frente: "content", entrega: "planning", prioridade: "medium" },
          ],
          atualizar_tarefas: [
            { ref: "t1", dono: "e2", prazo: "2026-10-05", prioridade: "high" },
            { ref: "t99", dono: "e1", prazo: null, prioridade: null },
          ],
        },
      },
      d,
      CLIENTE,
    )!;
    const motivos = acao.recusados.map((r) => `${r.operacao}:${r.motivo}`);
    expect(motivos).toEqual(
      expect.arrayContaining([
        "criar_marco:Sem data válida (AAAA-MM-DD).",
        "criar_tarefa:O prazo já passou.",
        "criar_tarefa:Sem prazo (AAAA-MM-DD).",
        "criar_tarefa:Já existe uma tarefa com este título.",
      ]),
    );
    expect(acao.ignorados).toContain("t99");
    // Um só projeto ativo: as tarefas vão para ele, com o marco existente.
    const pilares = acao.itens.find((i) => i.operacao === "criar_tarefa")!;
    expect(cargaDoItem(acao, pilares)).toMatchObject({ projeto_id: id(1), marco_id: id(11), assigned_to: id(901) });
    const atualizar = acao.itens.find((i) => i.operacao === "atualizar_tarefa")!;
    expect(cargaDoItem(acao, atualizar)).toEqual({ tarefa_id: id(21), campos: { assigned_to: id(902), due_date: "2026-10-05", priority: "high" } });
  });

  it("sem projeto e com mais de um ativo, pede o projeto; projeto repetido não é criado de novo", () => {
    const d = dados({
      projetos: [
        { id: id(1), name: "Site", status: "active", project_type: "website", start_date: null, deadline: null },
        { id: id(2), name: "Social", status: "active", project_type: "social_media", start_date: null, deadline: null },
      ],
    });
    const semProjeto = normalizarPlanoDoCliente({ plano: { resumo: "", projeto: null, marcos: [], tarefas: [{ titulo: "Algo", prazo: "2026-10-01", frente: "general", entrega: "other", prioridade: "low" }], atualizar_tarefas: [] } }, d, CLIENTE)!;
    expect(semProjeto.itens).toEqual([]);
    expect(semProjeto.recusados[0].motivo).toContain("em qual projeto");
    const repetido = normalizarPlanoDoCliente({ plano: { resumo: "", projeto: { ref: "novo", nome: "site", inicio: null, prazo: "2026-11-01" }, marcos: [], tarefas: [], atualizar_tarefas: [] } }, d, CLIENTE)!;
    expect(repetido.recusados[0].motivo).toContain("Já existe um projeto");
  });

  it("contexto, decisões e caminho entram como itens; custo sem fonte fica a confirmar", () => {
    const d = dados({ contexto: { nicho: "Móveis", publico: "Casais" } });
    const acao = normalizarPlanoDoCliente(
      {
        plano: null,
        contexto: { nicho: "Móveis planejados para apartamento pequeno em Curitiba", publico: "Casais", estagio: "começando", negocio: null, oferta: null, tom_de_voz: null, posicionamento: null },
        decisoes: [
          { area: "geral", categoria: "preferencia", texto: "Nicho de entrada: apartamento pequeno." },
          { area: "inexistente", categoria: "preferencia", texto: "fora" },
        ],
        caminho: { resumo: "Base de busca primeiro", etapas: [{ titulo: "Perfil da Empresa no Google", porque: "é de graça e traz busca local", quando: "semana 1" }], stack: [{ ferramenta: "Canva Pro", para_que: "peças", custo: "R$ 35 por mês", fonte: null, porque: "a equipe já usa" }], cuidados: [] },
      },
      d,
      CLIENTE,
    )!;
    const ops = acao.itens.map((i) => `${i.operacao}:${i.alvo_id}`);
    expect(ops).toEqual(["preencher_contexto:nicho", "preencher_contexto:estagio", "gravar_decisao:cerebro", "gravar_caminho:caminho"]);
    expect(acao.itens[0].detalhe).toBe("substitui o atual");
    expect(acao.itens[1].detalhe).toBe("estava vazio");
    const caminho = cargaDoItem(acao, acao.itens[3]).caminho as { stack: Array<{ custo: string }> };
    expect(caminho.stack[0].custo).toBe("R$ 35 por mês (a confirmar)");
    expect(normalizarCaminho({ resumo: "", etapas: [], stack: [] })).toBeNull();
  });

  it("datas e sinais auxiliares", () => {
    expect(dataValida("2026-02-29")).toBeNull();
    expect(dataValida("2028-02-29")).toBe("2028-02-29");
    expect(dataValida("26/09/2026")).toBeNull();
    expect(pedeCaminho("qual o tech stack e quanto custa?")).toBe(true);
    expect(pedeCaminho("o público são mães")).toBe(false);
    expect(normalizarPlanoDoCliente(null, dados(), CLIENTE)).toBeNull();
    expect(apelidosDoPlano(dados()).equipe.map((e) => e.ref)).toEqual(["e1", "e2"]);
  });
});

// ------------------------------------------------------------------ executor (banco falso)

type Linha = Record<string, any>;
function bancoFalso(inicial: Record<string, Linha[]>) {
  const tabelas: Record<string, Linha[]> = JSON.parse(JSON.stringify(inicial));
  let seq = 500;
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: { tipo: "select" | "insert" | "update" | "upsert"; valor?: any; conflito?: string } = { tipo: "select" };
    let limite = Infinity;
    const lista = () => (tabelas[tabela] = tabelas[tabela] || []);
    const executar = () => {
      if (op.tipo === "insert") {
        const linhas = (Array.isArray(op.valor) ? op.valor : [op.valor]).map((v: Linha) => ({ id: id(++seq), ...v }));
        lista().push(...linhas);
        return { data: linhas, error: null };
      }
      if (op.tipo === "upsert") {
        const chave = op.conflito || "id";
        const existente = lista().find((l) => l[chave] === op.valor[chave]);
        if (existente) Object.assign(existente, op.valor);
        else lista().push({ ...op.valor });
        return { data: null, error: null };
      }
      const achadas = lista().filter((l) => filtros.every((f) => f(l)));
      if (op.tipo === "update") {
        achadas.forEach((l) => Object.assign(l, op.valor));
        return { data: null, error: null };
      }
      return { data: achadas.slice(0, limite).map((l) => ({ ...l })), error: null };
    };
    const q: any = {
      select: () => q,
      insert: (v: any) => ((op = { tipo: "insert", valor: v }), q),
      update: (v: any) => ((op = { tipo: "update", valor: v }), q),
      upsert: (v: any, o?: { onConflict?: string }) => ((op = { tipo: "upsert", valor: v, conflito: o && o.onConflict }), q),
      eq: (c: string, v: any) => (filtros.push((l) => l[c] === v), q),
      neq: (c: string, v: any) => (filtros.push((l) => l[c] !== v), q),
      is: (c: string, v: any) => (filtros.push((l) => (l[c] ?? null) === v), q),
      in: (c: string, v: any[]) => (filtros.push((l) => v.indexOf(l[c]) >= 0), q),
      ilike: (c: string, v: string) => {
        const termo = v.replace(/%/g, "").toLowerCase();
        filtros.push((l) => String(l[c] || "").toLowerCase().indexOf(termo) >= 0);
        return q;
      },
      gte: () => q,
      lte: () => q,
      not: () => q,
      order: () => q,
      limit: (n: number) => ((limite = n), q),
      maybeSingle: async () => {
        const r = executar();
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
      },
      single: async () => {
        const r = executar();
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.data ? null : { message: "vazio" } };
      },
      then: (ok: any, falha: any) => Promise.resolve(executar()).then(ok, falha),
    };
    return q;
  };
  return { from, tabelas };
}

const deps = (extra: Partial<DependenciasDoExecutor> = {}): DependenciasDoExecutor => ({
  userId: id(900),
  gravarDecisao: async () => ({ id: id(777), situacao: "criado", erro: null }),
  agora: () => "2026-09-26T12:00:00.000Z",
  ...extra,
});

describe("plano do cliente: execução confirmada e desfazer", () => {
  it("cria projeto, marco e tarefa em ordem (o novo vira id pela memória) e o desfazer manda para a lixeira", async () => {
    const d = dados();
    const acao = normalizarPlanoDoCliente(
      {
        plano: {
          resumo: "",
          projeto: { ref: "novo", nome: "Entrada", tipo: "branding", inicio: "2026-09-28", prazo: "2026-11-30" },
          marcos: [{ ref: "mn1", titulo: "Identidade", prazo: "2026-10-20" }],
          tarefas: [{ titulo: "Preparar briefing de identidade", marco: "mn1", dono: "e1", prazo: "2026-10-05", frente: "design", entrega: "branding", prioridade: "high" }],
          atualizar_tarefas: [],
        },
      },
      d,
      CLIENTE,
    )!;
    const db = bancoFalso({ user_roles: [{ user_id: id(901), role: "design" }] });
    const memoria = new Map<string, string>();
    const resultados: Array<{ item: ItemDaAcaoDoAgente; desfazer: any }> = [];
    for (const item of acao.itens) {
      const r = await executarItemDoPlano(db, CLIENTE, item, acao, memoria, deps());
      resultados.push({ item, desfazer: r.desfazer });
    }
    const [projeto] = db.tabelas.projects;
    const [marco] = db.tabelas.milestones;
    const [tarefa] = db.tabelas.tasks;
    expect(projeto).toMatchObject({ client_id: CLIENTE, name: "Entrada", status: "active", start_date: "2026-09-28", deadline: "2026-11-30" });
    expect(marco).toMatchObject({ project_id: projeto.id, title: "Identidade", status: "pending" });
    expect(tarefa).toMatchObject({ project_id: projeto.id, milestone_id: marco.id, assigned_to: id(901), due_date: "2026-10-05", source: "agente:contexto", status: "todo" });
    for (const r of resultados.slice().reverse()) {
      await reverterItemDoPlano(db, CLIENTE, { ref: r.item.ref, alvo_id: r.item.alvo_id, titulo: r.item.titulo, operacao: r.item.operacao, ok: true, desfazer: r.desfazer }, deps());
    }
    expect(db.tabelas.tasks[0].deleted_at).toBe("2026-09-26T12:00:00.000Z");
    expect(db.tabelas.milestones[0].deleted_at).toBe("2026-09-26T12:00:00.000Z");
    expect(db.tabelas.projects[0].deleted_at).toBe("2026-09-26T12:00:00.000Z");
  });

  it("tarefa de projeto que não é do cliente e dono fora da equipe não passam", async () => {
    const db = bancoFalso({ projects: [{ id: id(1), client_id: id(2), deleted_at: null }], user_roles: [] });
    const acao = { contexto: { dados: { "criar_tarefa:tn1": { projeto_id: id(1), title: "x", due_date: "2026-10-01", assigned_to: id(5) } } } };
    const item = { ref: "tn1", alvo_id: "novo", titulo: "x", detalhe: null, operacao: "criar_tarefa", rotulo: "criar tarefa", para: null };
    await expect(executarItemDoPlano(db, CLIENTE, item, acao, new Map(), deps())).rejects.toThrow("não está mais com o cliente");
  });

  it("contexto e caminho gravam no kit sem apagar o resto, e o desfazer volta o valor de antes", async () => {
    const db = bancoFalso({ cliente_kit_marca: [{ client_id: CLIENTE, contexto: { negocio: "Móveis", nicho: "Antigo" } }] });
    const acao = { contexto: { dados: { "preencher_contexto:c5": { campo: "nicho", valor: "Novo" }, "gravar_caminho:r1": { caminho: { resumo: "x", etapas: [], stack: [] } } } } };
    const i1 = { ref: "c5", alvo_id: "nicho", titulo: "Nicho", detalhe: null, operacao: "preencher_contexto", rotulo: "preencher", para: null };
    const r1 = await executarItemDoPlano(db, CLIENTE, i1, acao, new Map(), deps());
    const i2 = { ref: "r1", alvo_id: "caminho", titulo: "Caminho", detalhe: null, operacao: "gravar_caminho", rotulo: "gravar", para: null };
    const r2 = await executarItemDoPlano(db, CLIENTE, i2, acao, new Map(), deps());
    expect(db.tabelas.cliente_kit_marca[0].contexto).toMatchObject({ negocio: "Móveis", nicho: "Novo", caminho: { resumo: "x" } });
    await reverterItemDoPlano(db, CLIENTE, { ...i2, ok: true, desfazer: r2.desfazer }, deps());
    await reverterItemDoPlano(db, CLIENTE, { ...i1, ok: true, desfazer: r1.desfazer }, deps());
    expect(db.tabelas.cliente_kit_marca[0].contexto).toEqual({ negocio: "Móveis", nicho: "Antigo" });
  });
});

// ------------------------------------------------------------------ pacote externo

describe("pacote para LLM externo: sem segredo dentro", () => {
  const briefingSujo = {
    companyName: "Softy Móveis",
    region: "Curitiba",
    idealClient: "Casais em apartamento pequeno",
    senha: "Softy@2026",
    instagramPassword: "abc12345",
    token_meta: "EAAGm0PX4ZCpsBAKZCZBqwerty1234567890abcdefgh",
    cpf: "123.456.789-09",
    observacoes: "Acesso do Instagram: senha: Softy@2026, chave sk-proj-abcdefghijklmnopqrstuvwxyz123456. Link https://drive.google.com/file/d/abc?token=XYZ123secreto&x=1",
    cartao: "4111 1111 1111 1111",
  };

  it("monta Markdown e JSON com o contexto e a tarefa, e nada de senha, chave, token, CPF ou cartão", () => {
    const p = montarPacoteExterno({
      cliente: { nome: "Softy Móveis", telefone: "(41) 99999-0000", cidade: "Curitiba" },
      contexto: { negocio: "Móveis planejados", nicho: "Apartamento pequeno", publico: "Casais", fontes_lidas: ["x"], tipografia: { titulo: "Montserrat" } },
      kit: { paleta: [{ nome: "Verde", hex: "#1a7f5a", papel: "primaria" }], estilo: "Fotos claras", regras: null },
      briefing: briefingSujo,
      dossie: "Diagnóstico com Authorization: Bearer abcdefghijklmnop1234567890 dentro.",
      caminho: { resumo: "Base de busca", etapas: [{ titulo: "Perfil no Google", porque: "busca local" }], stack: [{ ferramenta: "Canva", custo: "R$ 35", fonte: null }] },
      tarefa: { tipo: "google_meu_negocio" },
      geradoEm: "2026-09-26T12:00:00.000Z",
    });
    const tudo = `${p.markdown}\n${JSON.stringify(p.json)}`;
    expect(temSegredo(tudo)).toBe(false);
    for (const proibido of ["Softy@2026", "abc12345", "EAAGm0PX4", "123.456.789-09", "sk-proj-", "XYZ123secreto", "4111 1111", "abcdefghijklmnop1234567890"]) {
      expect(tudo, proibido).not.toContain(proibido);
    }
    expect(p.removidos).toBeGreaterThan(0);
    expect(p.avisos.join(" ")).toContain("saíram do pacote");
    // O que é do negócio continua.
    for (const fica of ["Softy Móveis", "(41) 99999-0000", "Curitiba", "Apartamento pequeno", "#1A7F5A", "Casais em apartamento pequeno", "https://drive.google.com/file/d/abc"]) {
      expect(tudo, fica).toContain(fica);
    }
    expect(p.markdown).toContain("Nunca peça senha nem oriente login na conta de outra pessoa");
    expect(p.markdown).toContain("(a confirmar)");
    expect(p.markdown).not.toMatch(/[—–]/);
    expect(p.json).toMatchObject({ formato: "aceleriq.pacote_externo", versao: 1, tarefa: { tipo: "google_meu_negocio" } });
    expect(p.nome_arquivo).toBe("pacote-softy-moveis-google-meu-negocio-2026-09-26");
  });

  it("o briefing perde os campos sensíveis e a limpeza não estraga link nem telefone", () => {
    const linhas = linhasDoBriefing(briefingSujo);
    const junto = linhas.join("\n");
    for (const rotulo of ["Senha:", "Instagram password", "Token meta", "Cpf:", "Cartao"]) expect(junto, rotulo).not.toContain(rotulo);
    for (const valor of ["Softy@2026", "abc12345", "123.456.789-09", "4111", "XYZ123secreto"]) expect(junto, valor).not.toContain(valor);
    expect(linhas).toContain("Company name: Softy Móveis");
    expect(limparSegredos("Site https://softy.com.br/moveis/planejados-sob-medida-para-apartamento e WhatsApp (41) 3333-4444")).toBe(
      "Site https://softy.com.br/moveis/planejados-sob-medida-para-apartamento e WhatsApp (41) 3333-4444",
    );
    expect(limparSegredos("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk")).toBe("[removido]");
  });

  it("o servidor nunca lê token, senha nem e-mail do cadastro para o pacote", () => {
    const fonte = ler("supabase/functions/agente-contexto/index.ts");
    const trecho = fonte.slice(fonte.indexOf("async function entradaDoPacote("), fonte.indexOf("const SISTEMA_DO_PEDIDO_EXTERNO"));
    expect(trecho).toContain('.select("company_name, full_name, phone")');
    expect(trecho).not.toMatch(/portal_password|first_access|email|cofre|vault/);
  });
});

// ------------------------------------------------------------------ identidade visual

describe("identidade visual: briefing e importação do brand book", () => {
  const pasta = `${CLIENTE}/marca/brandbook/`;
  const imagens = [
    { caminho: `${pasta}1-logo.png`, nome: "logo.png", mime: "image/png" },
    { caminho: `${pasta}2-logo-branca.png`, nome: "logo-branca.png", mime: "image/png" },
    { caminho: `${pasta}3-pagina-1.jpg`, nome: "manual.pdf página 1", pagina_de_pdf: true },
    { caminho: `outro-cliente/marca/brandbook/x.png`, nome: "x.png", mime: "image/png" },
  ];

  it("a leitura vira proposta de kit: paleta, tipografia, logos, estilo e regras", () => {
    const acao = propostaDoKitPeloBrandBook(
      {
        paleta: [{ nome: "Verde", hex: "#1a7f5a", papel: "primaria" }, { nome: "Areia", hex: "#F2E8D5", papel: "fundo" }, { nome: "Repetida", hex: "#1A7F5A", papel: "x" }, { nome: "Inválida", hex: "verde", papel: "x" }],
        tipografia: { titulo: "Playfair Display", texto: "Inter", observacao: "Títulos em 700" },
        logos: [{ imagem: 1, papel: "principal" }, { imagem: 2, papel: "alternativa" }],
        estilo: "Fotografia clara de ambientes reais, muito respiro e grafismo de linha fina.",
        regras: "curta",
      },
      { paleta: [], logo_path: null, tipografia: null },
      imagens,
      CLIENTE,
      "bb-1",
    )!;
    expect(acao.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["kit_paleta:b1", "kit_tipografia:b2", "kit_logo:b3", "kit_logo:b4", "kit_estilo:b5"]);
    expect(cargaDoItem(acao, acao.itens[0]).paleta).toEqual([
      { nome: "Verde", hex: "#1A7F5A", papel: "primaria" },
      { nome: "Areia", hex: "#F2E8D5", papel: "fundo" },
    ]);
    expect(cargaDoItem(acao, acao.itens[2])).toEqual({ alternativa: false, caminho: `${pasta}1-logo.png` });
    expect(cargaDoItem(acao, acao.itens[3])).toEqual({ alternativa: true, caminho: `${pasta}2-logo-branca.png` });
    expect(acao.contexto).toMatchObject({ client_id: CLIENTE, tipo: "brand_book" });
  });

  it("página inteira do PDF e imagem de fora da pasta não viram logo; o que já está no kit não repete", () => {
    const acao = propostaDoKitPeloBrandBook(
      { paleta: [{ hex: "#111111" }], logos: [{ imagem: 3, papel: "principal" }, { imagem: 4, papel: "alternativa" }, { imagem: 9, papel: "principal" }], estilo: null, regras: null },
      { logo_path: null },
      imagens,
      CLIENTE,
    )!;
    expect(acao.itens).toEqual([]);
    expect(acao.recusados.map((r) => r.motivo)).toEqual(["É uma página inteira do PDF. Envie a logo em PNG para ela virar logo do kit.", "A imagem não está na pasta do brand book deste cliente."]);
    expect(paletaDoBrandBook([{ hex: "#111111" }])).toEqual([]);
    expect(propostaDoKitPeloBrandBook({ logos: [{ imagem: 1, papel: "principal" }] }, { logo_path: `${pasta}1-logo.png` }, imagens, CLIENTE)).toBeNull();
  });

  it("o executor recusa logo fora da pasta e a conferência de tamanho; aceita a da pasta", async () => {
    const db = bancoFalso({ cliente_kit_marca: [{ client_id: CLIENTE, logo_path: "antes.png" }] });
    const item = { ref: "b3", alvo_id: "principal", titulo: "Logo", detalhe: null, operacao: "kit_logo", rotulo: "trocar a logo por", para: null };
    const fora = { contexto: { dados: { "kit_logo:b3": { alternativa: false, caminho: "outro/marca/brandbook/x.png" } } } };
    await expect(executarItemDoPlano(db, CLIENTE, item, fora, new Map(), deps())).rejects.toThrow("pasta do brand book");
    const dentro = { contexto: { dados: { "kit_logo:b3": { alternativa: false, caminho: `${pasta}1-logo.png` } } } };
    await expect(executarItemDoPlano(db, CLIENTE, item, dentro, new Map(), deps({ conferirLogo: async () => "A logo tem 9000 x 9000 px." }))).rejects.toThrow("9000");
    const r = await executarItemDoPlano(db, CLIENTE, item, dentro, new Map(), deps({ conferirLogo: async () => null }));
    expect(db.tabelas.cliente_kit_marca[0].logo_path).toBe(`${pasta}1-logo.png`);
    await reverterItemDoPlano(db, CLIENTE, { ...item, ok: true, desfazer: r.desfazer }, deps());
    expect(db.tabelas.cliente_kit_marca[0].logo_path).toBe("antes.png");
  });

  it("o briefing de identidade sai do contexto e transforma o que falta em pergunta", () => {
    const vazio = briefingDeIdentidade({ cliente: "Softy" });
    expect(vazio.lacunas.length).toBeGreaterThan(4);
    expect(vazio.markdown).toContain("## Perguntas para o dono antes de criar");
    const cheio = briefingDeIdentidade({
      cliente: "Softy",
      contexto: { negocio: "Móveis planejados", nicho: "Apartamento pequeno", publico: "Casais", tom_de_voz: "Próximo", posicionamento: "Sob medida sem obra", estagio: "começando", oferta: "Projeto 3D grátis", diferenciais: ["Entrega em 20 dias"] },
      kit: { paleta: [{ nome: "Verde", hex: "#1a7f5a" }], tem_logo: true },
      fontes: [{ nome: "Inter", papel: "texto" }],
    });
    expect(cheio.lacunas).toEqual([]);
    expect(cheio.markdown).toContain("Paleta atual: Verde #1A7F5A");
    expect(cheio.markdown).toContain("Importar brand book");
    expect(cheio.markdown).not.toMatch(/[—–]/);
  });
});

// ------------------------------------------------------------------ organizar tudo por tipo

describe("organizar tudo por tipo (sem IA)", () => {
  const nos = [
    { id: id(1), parent_id: null, kind: "folder", name: "Fotos" },
    { id: id(2), parent_id: null, kind: "folder", name: "Evento de março" },
    { id: id(3), parent_id: null, kind: "folder", name: "Recebidos", inbox_token: "tok" },
    { id: id(4), parent_id: null, kind: "folder", name: "Nova pasta" },
    { id: id(10), parent_id: null, kind: "file", name: "IMG_001.jpg" },
    { id: id(11), parent_id: null, kind: "file", name: "logo-final.png" },
    { id: id(12), parent_id: null, kind: "file", name: "proposta.pdf" },
    { id: id(13), parent_id: id(2), kind: "file", name: "palco.jpg" },
    { id: id(14), parent_id: id(3), kind: "file", name: "enviado.jpg" },
    { id: id(15), parent_id: id(4), kind: "file", name: "video.mp4" },
    { id: id(16), parent_id: null, kind: "file", name: "sem-extensao" },
  ];

  it("só arquivos soltos saem do lugar, para a pasta do tipo (existente ou nova), e a normalização aceita", () => {
    const p = organizarPorTipo(nos);
    expect(p.porPasta).toEqual({ Fotos: 1, Marca: 1, Documentos: 1, "Vídeos": 1 });
    const d = { kit: null, referencias: [], fotos: [], nos };
    const acao = normalizarAcoesDoContexto({ resumo: p.resumo, itens: p.itens }, d, CLIENTE)!;
    const porNome = Object.fromEntries(acao.itens.map((i) => [i.titulo, i.para_rotulo]));
    expect(porNome).toEqual({ "IMG_001.jpg": "pasta Fotos", "logo-final.png": "pasta nova Marca", "proposta.pdf": "pasta nova Documentos", "video.mp4": "pasta nova Vídeos" });
    expect(acao.ignorados).toEqual([]);
    expect(pastaDoTipo("manual-da-marca.pdf")).toBe("Marca");
    expect(pastaDoTipo("planilha.xlsx")).toBe("Planilhas");
  });
});

// ------------------------------------------------------------------ ferramentas de leitura

describe("ferramentas internas de leitura", () => {
  it("aceita só ferramentas registradas, sem repetir, no máximo 4", () => {
    const p = normalizarPedidosDeLeitura([
      { ferramenta: "ler_briefing", argumento: "" },
      { ferramenta: "ler_briefing", argumento: "" },
      { ferramenta: "apagar_tudo", argumento: "" },
      { ferramenta: "buscar_arquivo", argumento: "x" },
      { ferramenta: "buscar_arquivo", argumento: "manual" },
      { ferramenta: "ler_metricas", argumento: "" },
      { ferramenta: "ler_agenda", argumento: "" },
      { ferramenta: "ler_dossie", argumento: "" },
    ]);
    expect(p.map((x) => x.ferramenta)).toEqual(["ler_briefing", "buscar_arquivo", "ler_metricas", "ler_agenda"]);
    expect(termoDeBusca("100%_manual,(x)")).toBe("100 manual x");
  });

  it("lê o banco sob demanda e o resultado sai limpo de senha", async () => {
    const db = bancoFalso({
      briefings: [{ client_id: CLIENTE, responses: { companyName: "Softy", senha: "segredo123" }, submitted: true }],
      files: [{ id: id(60), client_id: CLIENTE, file_name: "Manual da marca.pdf", mime_type: "application/pdf", archived_at: null }],
      file_content_chunks: [{ file_id: id(60), chunk_index: 0, text: "Cor primária verde. token: abc123def456" }],
      workspace_nodes: [],
    });
    const texto = await executarLeituras(db, CLIENTE, [{ ferramenta: "ler_briefing", argumento: "" }, { ferramenta: "ler_arquivo", argumento: "manual" }], {
      hoje: "2026-09-26",
      lerDossie: async () => null,
      lerCerebro: async () => "",
    });
    expect(texto).toContain("Company name: Softy");
    expect(texto).toContain("Cor primária verde");
    expect(texto).not.toContain("segredo123");
    expect(texto).not.toContain("abc123def456");
  });
});

// ------------------------------------------------------------------ motores e ligação

describe("índice dos motores e ligação no código", () => {
  it("o motor do agente do cliente lista os blocos e as ferramentas que ele usa de verdade", () => {
    const m = motor("contexto.plano")!;
    expect(m).toBeTruthy();
    const k = conhecimentoDoPlano();
    for (const b of m.promete) expect(k.ids, b).toContain(b);
    for (const b of k.ids) expect(origemDoBloco(b), b).not.toBeNull();
    expect(k.tamanho).toBeLessThanOrEqual(k.teto);
    expect(ferramentasDoMotor("contexto.plano")).toEqual(NOMES_DAS_FERRAMENTAS);
    for (const f of ferramentasDoMotor("contexto.plano")) expect(FERRAMENTAS_DO_CLIENTE[f as keyof typeof FERRAMENTAS_DO_CLIENTE], f).toBeTruthy();
    const fonte = ler(m.ligacao.arquivo);
    for (const t of m.ligacao.trechos) expect(fonte, t).toContain(t);
  });

  it("a função expõe as ações novas e o executor comum continua ligado", () => {
    const fonte = ler("supabase/functions/agente-contexto/index.ts");
    for (const acao of ["ler_plano: lerPlano", "salvar_caminho: salvarCaminho", "pacote_externo: pacoteExterno", "preparar_identidade: prepararIdentidade", "importar_brand_book: importarBrandBook", "organizar_por_tipo: organizarPorTipoAcao", "executar_acao_agente: executarAcaoDoContexto"]) {
      expect(fonte).toContain(acao);
    }
    // A montagem do contexto não apaga o que o agente do cliente guardou.
    expect(fonte).toContain('const CHAVES_DO_PLANO_NO_CONTEXTO = ["nicho", "posicionamento", "estagio", "caminho", "identidade"];');
    expect(fonte).toContain("contexto: { ...extras, ...mesclado },");
  });

  it("arquivos novos sem travessão e compatíveis com navegador antigo", () => {
    for (const rel of [
      "supabase/functions/agente-contexto/plano-do-cliente.ts",
      "supabase/functions/agente-contexto/executor-do-plano.ts",
      "supabase/functions/agente-contexto/organizar-por-tipo.ts",
      "supabase/functions/_shared/pacote-externo.ts",
      "supabase/functions/_shared/identidade-visual.ts",
      "supabase/functions/_shared/ferramentas-do-cliente.ts",
      "supabase/functions/_shared/conhecimento-do-plano.ts",
      "src/components/mesa/ContextoPlanoDoCliente.tsx",
      "src/components/mesa/planoDoClienteApi.ts",
      "src/components/mesa/AgenteDeContexto.tsx",
      "src/components/mesa/AbaContexto.tsx",
      "docs/mesa-identidade/CONTRATO.md",
    ]) {
      const texto = ler(rel);
      expect(texto, rel).not.toMatch(/[—–]/);
      expect(texto, rel).not.toContain("(?<");
      expect(texto, rel).not.toMatch(/\\p\{/);
      expect(texto, rel).not.toContain(".at(");
      expect(texto, rel).not.toContain("Object.hasOwn(");
      expect(texto, rel).not.toContain("aspect-[");
      expect(texto, rel).not.toContain(":has(");
    }
  });

  it("a tela manda o modo plano na mesma conversa e mostra o cartão de cada proposta", () => {
    const agente = ler("src/components/mesa/AgenteDeContexto.tsx");
    expect(agente).toContain('...(modo === "plano" ? { modo: "plano" } : {})');
    expect(agente).toContain("anexos: propostas");
    const aba = ler("src/components/mesa/AbaContexto.tsx");
    expect(aba).toContain("<AgenteDeContexto preencher modo={modoDoAgente} onModo={setModoDoAgente} pedido={pedido} />");
    expect(aba).toContain("<ContextoPlanoDoCliente onPedirAoAgente={pedirAoAgente} />");
  });
});
