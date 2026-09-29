/**
 * Frente AG3 (29/09): o agente do Workspace age (criar pasta, renomear, mover,
 * arquivar), com apelidos, Desfazer e travas; e a conversa não perde nada.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import {
  alvosDoWorkspace,
  destinoDentroDoItem,
  executarItemDoWorkspace,
  NOME_DA_PASTA_DE_ARQUIVO,
  nomeValido,
  normalizarAcoesDoWorkspace,
  pareceOrganizar,
  regrasDoWorkspace,
  reverterItemDoWorkspace,
  type NoDoWorkspace,
} from "../../supabase/functions/workspace-agent/acoes-do-workspace";

const U = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const CLIENTE = U(900);
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

type Linha = Record<string, unknown>;
function bancoFalso(tabelas: Record<string, Linha[]>) {
  let seq = 0;
  const from = (tabela: string) => {
    const filtros: Array<[string, unknown, "eq" | "is"]> = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let dados: Linha | null = null;
    const linhas = () => (tabelas[tabela] || []).filter((l) => filtros.every(([c, v]) => (v === null ? l[c] === null || l[c] === undefined : l[c] === v)));
    const executar = () => {
      if (op === "insert") {
        const nova = { id: U(700 + ++seq), parent_id: null, sent_for_approval_file_id: null, ...(dados as Linha) };
        (tabelas[tabela] = tabelas[tabela] || []).push(nova);
        return { data: [nova], error: null };
      }
      if (op === "update") { const alvo = linhas(); for (const l of alvo) Object.assign(l, dados); return { data: alvo, error: null }; }
      if (op === "delete") { const fora = new Set(linhas()); tabelas[tabela] = (tabelas[tabela] || []).filter((l) => !fora.has(l)); return { data: [...fora], error: null }; }
      return { data: linhas(), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, order: () => q, limit: () => q,
      eq: (c: string, v: unknown) => (filtros.push([c, v, "eq"]), q),
      is: (c: string, v: unknown) => (filtros.push([c, v, "is"]), q),
      insert: (d: Linha) => ((op = "insert"), (dados = d), q),
      update: (d: Linha) => ((op = "update"), (dados = d), q),
      delete: () => ((op = "delete"), q),
      maybeSingle: async () => ({ data: (executar().data as Linha[])[0] ?? null, error: null }),
      single: async () => ({ data: (executar().data as Linha[])[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro),
    };
    return q;
  };
  return { db: { from }, tabelas };
}

const nos = (): NoDoWorkspace[] => [
  { id: U(1), name: "Artes", kind: "folder", parent_id: null, client_id: CLIENTE },
  { id: U(2), name: "Outubro", kind: "folder", parent_id: U(1), client_id: CLIENTE },
  { id: U(3), name: "post-1.png", kind: "file", parent_id: null, client_id: CLIENTE },
  { id: U(4), name: "aprovacao.png", kind: "file", parent_id: U(1), client_id: CLIENTE, sent_for_approval_file_id: U(99) },
  { id: U(5), name: "de-outro.png", kind: "file", parent_id: null, client_id: U(777) },
];

describe("apelidos e regras", () => {
  it("r1 é a raiz, n# são os itens do cliente (pastas primeiro), com o caminho; item de outro cliente não entra", () => {
    const a = alvosDoWorkspace(CLIENTE, "Verzelo", nos());
    expect(a.raiz[0]).toMatchObject({ ref: "r1", id: "raiz" });
    expect(a.itens.map((i) => i.titulo)).toEqual(["Artes", "Outubro", "post-1.png", "aprovacao.png"]);
    expect(a.itens[1].detalhe).toContain("/Artes/Outubro");
    expect(a.itens[3].detalhe).toContain("enviado para aprovação");
    expect(pareceOrganizar("Mova os posts de outubro para a pasta Artes")).toBe(true);
    expect(pareceOrganizar("Escreva a legenda do post")).toBe(false);
    expect(nomeValido("  Artes/Novembro ")).toBe("Artes-Novembro");
  });

  it("o modelo pede com apelidos; destino vira id com o nome da pasta no cartão; laço, aprovação e inventado ficam de fora", () => {
    const a = alvosDoWorkspace(CLIENTE, "Verzelo", nos());
    const acao = normalizarAcoesDoWorkspace({
      resumo: "Organizar",
      itens: [
        { operacao: "mover", ref: "n3", para: "n2" },
        { operacao: "criar_pasta", ref: "r1", para: "Vídeos" },
        { operacao: "renomear", ref: "n1", para: "Artes 2026" },
        { operacao: "mover", ref: "n1", para: "n2" },
        { operacao: "arquivar", ref: "n4", para: "" },
        { operacao: "mover", ref: "n9", para: "r1" },
        { operacao: "mover", ref: "n2", para: "n3" },
      ],
    }, a, { clientId: CLIENTE })!;
    expect(acao.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["mover:n3", "criar_pasta:r1", "renomear:n1"]);
    expect(acao.itens[0]).toMatchObject({ para: U(2), para_rotulo: "/Artes/Outubro" });
    expect(acao.recusados.map((r) => r.motivo)).toEqual(expect.arrayContaining(["Não dá para mover uma pasta para dentro dela mesma.", "Enviado para aprovação: não sai do lugar."]));
    expect(acao.ignorados).toEqual(expect.arrayContaining(["n9", "n2"]));
    expect(destinoDentroDoItem(U(1), U(2), a.porId)).toBe(true);
    // Ordem clara, sem custo e com Desfazer: vai direto só sem recusa nem ignorado.
    expect(podeExecutarDireto(acao, regrasDoWorkspace(a), { pedidoClaro: true }).direto).toBe(false);
    const limpa = normalizarAcoesDoWorkspace({ resumo: "x", itens: [{ operacao: "mover", ref: "n3", para: "n1" }] }, a, { clientId: CLIENTE })!;
    expect(podeExecutarDireto(limpa, regrasDoWorkspace(a), { pedidoClaro: true }).direto).toBe(true);
    expect(podeExecutarDireto(limpa, regrasDoWorkspace(a), { pedidoClaro: false }).direto).toBe(false);
  });
});

describe("executa e desfaz", () => {
  it("criar pasta, renomear, mover e arquivar; o Desfazer volta cada um", async () => {
    const f = bancoFalso({ workspace_nodes: nos().map((n) => ({ ...n, scope: n.client_id ? "client" : "global" })) });
    const deps = { userId: U(9) };
    const criada = await executarItemDoWorkspace(f.db, CLIENTE, { operacao: "criar_pasta", alvo_id: "raiz", para: "Vídeos", titulo: "Raiz" }, deps);
    const nova = f.tabelas.workspace_nodes.find((n) => n.id === criada.desfazer.criado_id)!;
    expect(nova).toMatchObject({ name: "Vídeos", kind: "folder", parent_id: null, client_id: CLIENTE, scope: "client" });
    await reverterItemDoWorkspace(f.db, CLIENTE, { operacao: "criar_pasta", desfazer: criada.desfazer });
    expect(f.tabelas.workspace_nodes.some((n) => n.id === criada.desfazer.criado_id)).toBe(false);

    const ren = await executarItemDoWorkspace(f.db, CLIENTE, { operacao: "renomear", alvo_id: U(1), para: "Artes 2026", titulo: "Artes" }, deps);
    expect(f.tabelas.workspace_nodes[0].name).toBe("Artes 2026");
    await reverterItemDoWorkspace(f.db, CLIENTE, { operacao: "renomear", desfazer: ren.desfazer });
    expect(f.tabelas.workspace_nodes[0].name).toBe("Artes");

    const mov = await executarItemDoWorkspace(f.db, CLIENTE, { operacao: "mover", alvo_id: U(3), para: U(2), titulo: "post" }, deps);
    expect(f.tabelas.workspace_nodes[2].parent_id).toBe(U(2));
    await reverterItemDoWorkspace(f.db, CLIENTE, { operacao: "mover", desfazer: mov.desfazer });
    expect(f.tabelas.workspace_nodes[2].parent_id).toBeNull();

    const arq = await executarItemDoWorkspace(f.db, CLIENTE, { operacao: "arquivar", alvo_id: U(3), para: null, titulo: "post" }, deps);
    const pasta = f.tabelas.workspace_nodes.find((n) => n.name === NOME_DA_PASTA_DE_ARQUIVO)!;
    expect(pasta).toMatchObject({ kind: "folder", parent_id: null, client_id: CLIENTE });
    expect(f.tabelas.workspace_nodes[2].parent_id).toBe(pasta.id);
    expect(arq.aviso).toContain("criada");
    await reverterItemDoWorkspace(f.db, CLIENTE, { operacao: "arquivar", desfazer: arq.desfazer });
    expect(f.tabelas.workspace_nodes[2].parent_id).toBeNull();
  });

  it("travas no banco: outro cliente, laço, aprovação; e o Desfazer não passa por cima de quem mexeu depois", async () => {
    const f = bancoFalso({ workspace_nodes: nos().map((n) => ({ ...n, scope: "client" })) });
    const deps = { userId: U(9) };
    await expect(executarItemDoWorkspace(f.db, CLIENTE, { operacao: "renomear", alvo_id: U(5), para: "x", titulo: "x" }, deps)).rejects.toThrow("não está mais no Workspace do cliente");
    await expect(executarItemDoWorkspace(f.db, CLIENTE, { operacao: "mover", alvo_id: U(1), para: U(2), titulo: "Artes" }, deps)).rejects.toThrow("dentro dela mesma");
    await expect(executarItemDoWorkspace(f.db, CLIENTE, { operacao: "arquivar", alvo_id: U(4), para: null, titulo: "aprov" }, deps)).rejects.toThrow("aprovação");
    const mov = await executarItemDoWorkspace(f.db, CLIENTE, { operacao: "mover", alvo_id: U(3), para: U(1), titulo: "post" }, deps);
    f.tabelas.workspace_nodes[2].parent_id = U(2); // alguém mexeu depois
    await expect(reverterItemDoWorkspace(f.db, CLIENTE, { operacao: "mover", desfazer: mov.desfazer })).rejects.toThrow("movido depois");
    const criada = await executarItemDoWorkspace(f.db, CLIENTE, { operacao: "criar_pasta", alvo_id: U(1), para: "Nova", titulo: "Artes" }, deps);
    f.tabelas.workspace_nodes.push({ id: U(50), name: "dentro.png", kind: "file", parent_id: criada.desfazer.criado_id, client_id: CLIENTE });
    await expect(reverterItemDoWorkspace(f.db, CLIENTE, { operacao: "criar_pasta", desfazer: criada.desfazer })).rejects.toThrow("já recebeu itens");
  });
});

describe("conversa do Workspace sem perda (fonte)", () => {
  const fonte = ler("supabase/functions/workspace-agent/index.ts");
  const tela = ler("src/components/workspace/StudioPanel.tsx");

  it("servidor: pergunta gravada antes do modelo com o erro conferido; cota depois do escopo; resposta parcial gravada; extras depois", () => {
    expect(fonte.lastIndexOf("claim_ai_usage")).toBeGreaterThan(fonte.indexOf("const safeClientId = context?.client_id ?? authorizedClientId;"));
    expect(fonte).toContain("if (erroDaPergunta) {");
    expect(fonte).toContain("await gravarResposta(true)");
    expect(fonte).toContain("depoisDaResposta((async () => {");
    expect(fonte).toContain('.is("deleted_at", null).order("created_at", { ascending: false }).limit(12)');
    expect(fonte).toContain('.is("archived_at", null)');
    expect(fonte).toContain("Hoje: ${hoje} (horário de Brasília).");
  });

  it("servidor: organizar vira ação com Jev e o cartão (Confirmar, Desfazer, Esquecer, Guardar)", () => {
    expect(fonte).toContain("async function julgarOrganizacao(");
    expect(fonte).toContain('acaoDoCartao === "executar_acao_agente" || acaoDoCartao === "desfazer_acao_agente"');
    expect(fonte).toContain('acaoDoCartao === "esquecer_regra" || acaoDoCartao === "guardar_regra"');
    expect(fonte).toContain("t.user_id !== userId");
  });

  it("tela: texto volta ao campo na falha, parcial fica, conversa trocada não recebe resposta de outra, só as conversas do usuário", () => {
    expect(tela).toContain("setInput(atual => atual || text);");
    expect(tela).toContain("_(resposta interrompida)_");
    expect(tela).toContain("if (conversaAtiva.current !== id) return;");
    expect(tela).toContain('.eq("user_id", uid)');
    expect(tela).toContain("<CartaoDeAcao");
    expect(tela).toContain("<AprendizadoDoAgente");
    expect(tela).toContain('window.confirm("Apagar esta conversa e todas as mensagens dela?")');
  });
});
