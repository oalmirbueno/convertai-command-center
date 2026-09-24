import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Custos de produção da Mesa (pedido do dono em 24/09): quantas peças, quanto
 * custou cada uma e quanto US$ 1 compra. Fixa as contas (médias, "com US$ 1"),
 * a regra de categoria igual à da RPC, a leitura direta enquanto a RPC não
 * existe e a tela.
 */

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mock.rpc, from: mock.from, functions: { invoke: vi.fn() }, storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import {
  agruparPorCliente,
  agruparPorMes,
  categoriaDoUso,
  contarCards,
  lerCustos,
  limitesDoPeriodo,
  linhaVazia,
  media,
  mediasDe,
  mesDeSaoPaulo,
  montarLinhasDeCusto,
  normalizarCustos,
  paraCsv,
  pecaDoTrabalho,
  porUmDolar,
  quebraDoGasto,
  rpcAusente,
  somarLinhas,
  type LinhaDeCusto,
} from "@/lib/mesa/custos";
import PainelDeCustos, { fraseDoDolar, quantidadeCurta } from "@/components/mesa/PainelDeCustos";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const linha = (extra: Partial<LinhaDeCusto>): LinhaDeCusto => ({ ...linhaVazia(A, "Padaria", "2026-09-01"), ...extra });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("contas do custo médio", () => {
  it("média só com quantidade; US$ 1 só com custo maior que zero", () => {
    expect(media(1, 4)).toBe(0.25);
    expect(media(1, 0)).toBeNull();
    expect(media(0, 3)).toBe(0);
    expect(porUmDolar(0.25)).toBe(4);
    expect(porUmDolar(0)).toBeNull();
    expect(porUmDolar(null)).toBeNull();
  });

  it("soma as linhas e tira cada média da sua base", () => {
    const t = somarLinhas([
      linha({ gasto_total_usd: 2, gasto_imagem_usd: 1.5, gasto_planejamento_usd: 0.3, gasto_conferencia_usd: 0.15, gasto_leitura_usd: 0.05, imagens_geradas: 30, posts: 2, custo_posts_usd: 0.4, carrosseis: 2, laminas: 12, laminas_carrossel: 10, custo_carrosseis_usd: 1.2 }),
      linha({ client_id: B, nome: "Ótica", gasto_total_usd: 1, gasto_imagem_usd: 0.5, imagens_geradas: 10, criativos: 2, custo_criativos_usd: 0.3 }),
    ]);
    expect(t.gasto).toBe(3);
    const m = mediasDe(t);
    expect(m.post).toBeCloseTo(0.2);
    expect(m.carrossel).toBeCloseTo(0.6);
    expect(m.lamina).toBeCloseTo(1.6 / 12);
    expect(m.criativo).toBeCloseTo(0.15);
    expect(m.imagem).toBeCloseTo(2 / 40);
    // Tudo incluído: todo o gasto por peça (2 posts + 2 carrosséis + 2 criativos).
    expect(m.pecaCheia).toBeCloseTo(0.5);
  });

  it("sem peça no período, nenhuma média é inventada", () => {
    const m = mediasDe(somarLinhas([linha({ gasto_total_usd: 0.5, gasto_planejamento_usd: 0.5 })]));
    expect(m).toEqual({ post: null, carrossel: null, lamina: null, criativo: null, imagem: null, pecaCheia: null });
    expect(fraseDoDolar(m)).toBeNull();
  });

  it("quebra do gasto soma 100% e vem com as quatro partes", () => {
    const partes = quebraDoGasto(somarLinhas([linha({ gasto_imagem_usd: 3, gasto_planejamento_usd: 0.5, gasto_conferencia_usd: 0.25, gasto_leitura_usd: 0.25 })]));
    expect(partes.map((p) => p.chave)).toEqual(["imagem", "planejamento", "conferencia", "leitura"]);
    expect(partes.map((p) => p.pct)).toEqual([75, 13, 6, 6]);
  });

  it("frase do dólar em português, só com o que tem base", () => {
    expect(quantidadeCurta(2.36)).toBe("2,3");
    expect(quantidadeCurta(18.9)).toBe("18");
    expect(fraseDoDolar({ post: 0.4, carrossel: 1.25, lamina: null, criativo: null, imagem: 0.05, pecaCheia: null })).toBe(
      "Com US$ 1 você faz 2,5 posts, 0,8 carrosséis ou 20 imagens.",
    );
    expect(fraseDoDolar({ post: 1, carrossel: null, lamina: null, criativo: null, imagem: null, pecaCheia: null })).toBe("Com US$ 1 você faz 1 post.");
  });

  it("agrupa por cliente (maior gasto primeiro) e por mês (mais recente primeiro)", () => {
    const linhas = [
      linha({ mes: "2026-08-01", gasto_total_usd: 0.2 }),
      linha({ mes: "2026-09-01", gasto_total_usd: 0.3 }),
      linha({ client_id: B, nome: "Ótica", mes: "2026-09-01", gasto_total_usd: 1 }),
    ];
    const clientes = agruparPorCliente(linhas);
    expect(clientes.map((c) => c.nome)).toEqual(["Ótica", "Padaria"]);
    expect(clientes[1].totais.gasto).toBeCloseTo(0.5);
    expect(agruparPorMes(linhas).map((m) => m.mes)).toEqual(["2026-09-01", "2026-08-01"]);
  });
});

describe("mesma regra da RPC", () => {
  it("categoria de cada uso", () => {
    expect(categoriaDoUso({ tarefa: "estudio", agente: "gerador_imagem" })).toBe("imagem");
    expect(categoriaDoUso({ tarefa: "verificacao", agente: "gerador_imagem" })).toBe("imagem");
    expect(categoriaDoUso({ tarefa: "verificacao", agente: "leitor" })).toBe("conferencia");
    expect(categoriaDoUso({ tarefa: "contexto", agente: "jev" })).toBe("conferencia");
    expect(categoriaDoUso({ tarefa: "leitura_referencia", agente: "leitor" })).toBe("leitura");
    expect(categoriaDoUso({ tarefa: "contexto", agente: "contexto" })).toBe("leitura");
    expect(categoriaDoUso({ tarefa: "calendario", agente: "estrategista" })).toBe("planejamento");
    expect(categoriaDoUso({ tarefa: "estudio", agente: "diretor_arte" })).toBe("planejamento");
    expect(categoriaDoUso({ tarefa: "ads", agente: "estrategista_ads" })).toBe("planejamento");
    const sql = ler("docs/mesa/v6/migrations/20260924180000_mesa_custos_e_fila.sql");
    expect(sql).toContain("WHEN u.agente = 'gerador_imagem' THEN 'imagem'");
    expect(sql).toContain("WHEN u.agente = 'jev' OR u.tarefa = 'verificacao' THEN 'conferencia'");
  });

  it("lâminas, versões e correções automáticas saem dos cards", () => {
    const cards = [
      { ordem: 1, versao: 1 },
      { ordem: 1, versao: 2, autocorrecao: { rodada: 1, motivos: ["texto"] } },
      { ordem: 2, versao: 1 },
      { ordem: 3, versao: 1 },
    ];
    expect(contarCards(cards)).toEqual({ laminas: 3, versoes: 4, automaticas: 1 });
    expect(contarCards(null)).toEqual({ laminas: 1, versoes: 0, automaticas: 0 });
    expect(pecaDoTrabalho("ads", "carousel", 5)).toBe("criativo");
    expect(pecaDoTrabalho("social", "carousel", 1)).toBe("carrossel");
    expect(pecaDoTrabalho("social", "static", 3)).toBe("carrossel");
    expect(pecaDoTrabalho("social", "static", 1)).toBe("post");
  });

  it("mês de São Paulo: 01/10 às 02h UTC ainda é setembro", () => {
    expect(mesDeSaoPaulo("2026-10-01T02:00:00Z")).toBe("2026-09-01");
    expect(mesDeSaoPaulo("2026-10-01T03:00:00Z")).toBe("2026-10-01");
    expect(mesDeSaoPaulo("lixo")).toBe("");
  });

  it("monta as linhas da leitura direta no formato da RPC", () => {
    const linhas = montarLinhasDeCusto(
      [
        { client_id: A, tarefa: "estudio", agente: "gerador_imagem", imagens: 1, custo_usd: "0.05", criado_em: "2026-09-10T12:00:00Z" },
        { client_id: A, tarefa: "estudio", agente: "gerador_imagem", imagens: 1, custo_usd: 0.05, criado_em: "2026-09-10T12:01:00Z" },
        { client_id: A, tarefa: "verificacao", agente: "leitor", imagens: 0, custo_usd: 0.001, criado_em: "2026-09-10T12:02:00Z" },
        { client_id: A, tarefa: "verificacao", agente: "jev", imagens: 0, custo_usd: 0.0001, criado_em: "2026-09-10T12:02:00Z" },
        { client_id: A, tarefa: "calendario", agente: "estrategista", imagens: 0, custo_usd: 0.02, criado_em: "2026-09-02T12:00:00Z" },
      ],
      [
        { id: "t1", client_id: A, tipo: "social", task_id: "k1", cards: [{ ordem: 1 }, { ordem: 1 }, { ordem: 2 }], custo_usd: 0, criado_em: "2026-09-10T11:00:00Z" },
        { id: "t2", client_id: A, tipo: "social", task_id: "k2", cards: [{ ordem: 1 }], custo_usd: 0.07, criado_em: "2026-09-11T11:00:00Z" },
        { id: "t3", client_id: A, tipo: "ads", task_id: null, cards: [{ ordem: 1 }], custo_usd: 0.03, criado_em: "2026-09-12T11:00:00Z" },
      ],
      { k1: "carousel", k2: "static" },
      { t1: 0.1011 },
      { [A]: "Padaria" },
    );
    expect(linhas).toHaveLength(1);
    const l = linhas[0];
    expect(l.gasto_total_usd).toBeCloseTo(0.1211);
    expect(l.gasto_imagem_usd).toBeCloseTo(0.1);
    expect(l.gasto_conferencia_usd).toBeCloseTo(0.0011);
    expect(l.gasto_planejamento_usd).toBeCloseTo(0.02);
    expect(l.usos).toBe(5);
    expect(l.imagens_geradas).toBe(2);
    expect(l.conferencias).toBe(1);
    expect([l.posts, l.carrosseis, l.criativos, l.laminas, l.laminas_carrossel]).toEqual([1, 1, 1, 3, 2]);
    expect([l.versoes, l.refacoes]).toEqual([5, 1]);
    // Custo ligado ao trabalho vence; sem ligado, o custo guardado nele.
    expect(l.custo_carrosseis_usd).toBeCloseTo(0.1011);
    expect(l.custo_posts_usd).toBeCloseTo(0.07);
    expect(l.custo_criativos_usd).toBeCloseTo(0.03);
  });

  it("normaliza o que o banco devolver; lixo vira lista vazia", () => {
    expect(normalizarCustos(null).linhas).toEqual([]);
    expect(normalizarCustos({ linhas: [{ nome: "sem id" }, 3] }).linhas).toEqual([]);
    const r = normalizarCustos({ versao: 1, inicio: "2026-09-01", fim: "2026-10-01", linhas: [{ client_id: A, nome: "Padaria", mes: "2026-09-01", posts: "2", gasto_total_usd: "0.5" }] });
    expect(r.linhas[0].posts).toBe(2);
    expect(r.linhas[0].gasto_total_usd).toBe(0.5);
    expect(r.linhas[0].criativos).toBe(0);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe("período e CSV", () => {
  it("períodos em meses cheios, fim excluído", () => {
    const agora = new Date(2026, 8, 24);
    expect(limitesDoPeriodo("mes", agora)).toEqual({ inicio: "2026-09-01", fim: "2026-10-01" });
    expect(limitesDoPeriodo("mes_passado", agora)).toEqual({ inicio: "2026-08-01", fim: "2026-09-01" });
    expect(limitesDoPeriodo("tres_meses", agora)).toEqual({ inicio: "2026-07-01", fim: "2026-10-01" });
    expect(limitesDoPeriodo("ano", agora)).toEqual({ inicio: "2026-01-01", fim: "2026-10-01" });
  });

  it("CSV com ponto e vírgula, vírgula decimal e aspas escapadas", () => {
    const csv = paraCsv([linha({ nome: 'Padaria "Boa"', posts: 2, custo_posts_usd: 0.5, gasto_total_usd: 1.23456 })]);
    const [cabecalho, primeira] = csv.split("\r\n");
    expect(cabecalho.split(";")[0]).toBe('"Cliente"');
    expect(primeira).toContain('"Padaria ""Boa"""');
    expect(primeira).toContain("2026-09");
    expect(primeira).toContain("1,2346");
    expect(primeira).toContain("0,2500");
  });
});

// ------------------------------------------------------------------ leitura

/** Consulta falsa do supabase-js: cada método encadeia e o await devolve as linhas da tabela. */
function tabelas(dados: Record<string, unknown[]>) {
  return (tabela: string) => {
    const q: any = {};
    for (const m of ["select", "gte", "lt", "order", "range", "in", "eq", "is", "limit", "neq"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: dados[tabela] || [], error: null }).then(ok, erro);
    return q;
  };
}

describe("leitura: RPC primeiro, tabelas enquanto ela não existe", () => {
  it("com a RPC: formato do banco", async () => {
    mock.rpc.mockResolvedValue({ data: { versao: 1, inicio: "2026-09-01", fim: "2026-10-01", linhas: [{ client_id: A, nome: "Padaria", mes: "2026-09-01", posts: 1 }] }, error: null });
    const r = await lerCustos("2026-09-01", "2026-10-01", {});
    expect(mock.rpc).toHaveBeenCalledWith("mesa_custos_producao", { _inicio: "2026-09-01", _fim: "2026-10-01" });
    expect(r.origem).toBe("banco");
    expect(r.linhas[0].posts).toBe(1);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("sem a RPC (PGRST202): lê as tabelas e monta o mesmo formato", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.mesa_custos_producao" } });
    mock.from.mockImplementation(
      tabelas({
        ia_usos: [{ client_id: A, tarefa: "estudio", agente: "gerador_imagem", imagens: 1, custo_usd: 0.05, referencia_tipo: "estudio_trabalho", referencia_id: "t1", criado_em: "2026-09-10T12:00:00Z" }],
        estudio_trabalhos: [{ id: "t1", client_id: A, tipo: "social", task_id: "k1", cards: [{ ordem: 1 }], custo_usd: 0.05, criado_em: "2026-09-10T11:00:00Z" }],
        tasks: [{ id: "k1", delivery_type: "static" }],
      }),
    );
    const r = await lerCustos("2026-09-01", "2026-10-01", { [A]: "Padaria" });
    expect(r.origem).toBe("direto");
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].nome).toBe("Padaria");
    expect(r.linhas[0].posts).toBe(1);
  });

  it("outro erro não cai na leitura direta", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "MESA_CUSTOS_SO_ADMIN_OU_GESTOR" } });
    await expect(lerCustos("2026-09-01", "2026-10-01", {})).rejects.toBeTruthy();
    expect(rpcAusente({ code: "42501" })).toBe(false);
    expect(rpcAusente({ code: "PGRST202" })).toBe(true);
  });
});

// ------------------------------------------------------------------ tela

function montar(el: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
}

describe("painel de custos", () => {
  const resposta = {
    versao: 1,
    inicio: "2026-09-01",
    fim: "2026-10-01",
    linhas: [
      { client_id: A, nome: "Padaria", mes: "2026-09-01", gasto_total_usd: 2, gasto_imagem_usd: 1.5, gasto_planejamento_usd: 0.4, usos: 40, imagens_geradas: 32, posts: 2, custo_posts_usd: 0.5, carrosseis: 2, laminas: 12, laminas_carrossel: 10, custo_carrosseis_usd: 1.25 },
      { client_id: B, nome: "Ótica", mes: "2026-09-01", gasto_total_usd: 0.5, gasto_imagem_usd: 0.5, imagens_geradas: 8, criativos: 2, custo_criativos_usd: 0.4 },
    ],
  };

  it("resumo, frase do dólar, tabela por cliente e filtro por cliente", async () => {
    mock.rpc.mockResolvedValue({ data: resposta, error: null });
    montar(<PainelDeCustos clientes={[{ id: A, nome: "Padaria" }, { id: B, nome: "Ótica" }]} />);
    expect(screen.getByRole("heading", { name: "Custos de produção" })).toBeTruthy();
    expect(await screen.findByText("Com US$ 1 você faz 4 posts, 1,6 carrosséis, 20 imagens ou 5 criativos.")).toBeTruthy();
    const tabela = screen.getByRole("region", { name: "Custos por cliente" });
    const nomes = within(tabela).getAllByRole("button").map((b) => b.textContent);
    expect(nomes).toEqual(["Padaria", "Ótica"]);
    expect(screen.getByText("US$ 2,50")).toBeTruthy();

    fireEvent.click(within(tabela).getByRole("button", { name: "Ótica" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Custos por cliente" })).toBeNull());
    expect(screen.getByText("Com US$ 1 você faz 16 imagens ou 5 criativos.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ver todos os clientes/ })).toBeTruthy();
  });

  it("trocar o período pede outro intervalo ao banco", async () => {
    mock.rpc.mockResolvedValue({ data: resposta, error: null });
    montar(<PainelDeCustos clientes={[]} />);
    await screen.findByText(/Com US\$ 1 você faz/);
    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    const [, args] = mock.rpc.mock.calls[1];
    expect(args._fim).toBe(mock.rpc.mock.calls[0][1]._inicio);
  });

  it("sem gasto: diz que não há nada e não inventa média", async () => {
    mock.rpc.mockResolvedValue({ data: { versao: 1, inicio: "2026-09-01", fim: "2026-10-01", linhas: [] }, error: null });
    montar(<PainelDeCustos clientes={[]} />);
    expect(await screen.findByText("Nenhum gasto de IA neste período.")).toBeTruthy();
    expect(screen.getAllByText("sem peça").length).toBe(6);
  });
});

describe("arquivos desta frente", () => {
  it("sem travessão nem recurso fora do piso Safari 11 / Chrome 64", () => {
    for (const rel of [
      "src/lib/mesa/custos.ts",
      "src/lib/mesa/fila.ts",
      "src/components/mesa/PainelDeCustos.tsx",
      "src/components/mesa/FilaDePrioridades.tsx",
      "src/pages/MesaDoCliente.tsx",
      "docs/mesa/v6/migrations/20260924180000_mesa_custos_e_fila.sql",
    ]) {
      const texto = ler(rel);
      expect(texto, rel).not.toContain("—");
      expect(texto, rel).not.toContain("–");
      expect(texto, rel).not.toContain("(?<");
      expect(texto, rel).not.toMatch(/\\p\{/);
      expect(texto, rel).not.toContain(".at(");
      expect(texto, rel).not.toContain("Object.hasOwn(");
      expect(texto, rel).not.toContain("aspect-[");
      expect(texto, rel).not.toContain(":has(");
      expect(texto, rel).not.toContain("[min(");
      expect(texto, rel).not.toContain("[max(");
      expect(texto, rel).not.toContain("[clamp(");
    }
  });

  it("RPC de custos: security definer, só admin e gestor, sem anon", () => {
    const sql = ler("docs/mesa/v6/migrations/20260924180000_mesa_custos_e_fila.sql");
    const corpo = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.mesa_custos_producao"), sql.indexOf("REVOKE ALL ON FUNCTION public.mesa_custos_producao"));
    expect(corpo).toContain("SECURITY DEFINER");
    expect(corpo).toContain("SET search_path TO ''");
    expect(corpo).toContain("'admin'::public.app_role");
    expect(corpo).toContain("'manager'::public.app_role");
    expect(corpo).toContain("public.can_access_client(p.id)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.mesa_custos_producao(date, date) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mesa_custos_producao(date, date) TO authenticated;");
  });

  it("o botão Custos só aparece para admin e gestor", () => {
    const pagina = ler("src/pages/MesaDoCliente.tsx");
    expect(pagina).toContain('const podeVerCustos = role === "admin" || role === "manager";');
    expect(pagina).toContain('painelUrl === "custos" && podeVerCustos ? "custos"');
    expect(pagina).toContain("{podeVerCustos && (");
  });
});
