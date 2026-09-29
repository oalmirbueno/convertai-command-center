import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente BAS (29/09): papéis de modelo das mesas novas e dados da agência.
 * - papéis aceitos na tela, no ia-motor e no banco (CHECK lida do SQL);
 * - faltasNosDados (contrato, proposta, documento) e a qualificação da contratada;
 * - a seção de Configurações: estado, sugestão só quando o campo está vazio,
 *   rascunho que não se perde quando salvar falha.
 */

const { salvar, lerDados, lerSugestoes, papelDaPessoa } = vi.hoisted(() => ({
  salvar: vi.fn(),
  lerDados: vi.fn(),
  lerSugestoes: vi.fn(),
  papelDaPessoa: { valor: "admin" },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: papelDaPessoa.valor }, user: { id: "u-1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/agencia/dadosDaAgencia", async (original) => {
  const real = await original<typeof import("@/lib/agencia/dadosDaAgencia")>();
  return {
    ...real,
    lerDadosDaAgenciaNaTela: (...a: unknown[]) => lerDados(...a),
    lerSugestoesDaAgencia: (...a: unknown[]) => lerSugestoes(...a),
    salvarDadosDaAgencia: (...a: unknown[]) => salvar(...a),
    urlDaLogoDaAgencia: async () => null,
  };
});

import { modeloDoPapel, PAPEIS, PAPEIS_DAS_MESAS_NOVAS, padraoPara, type ModeloIa } from "@/lib/mesa/api";
import { PAPEIS_DA_TELA } from "@/components/mesa/ModelosDeIa";
import DadosDaAgencia, { estadoDosDados } from "@/components/agencia/DadosDaAgencia";
import {
  cnpjValido,
  cpfValido,
  faltasNosDados,
  normalizarDadosDaAgencia,
  qualificacaoDaContratada,
  textoDasFaltas,
  type DadosDaAgencia,
} from "@/lib/agencia/dadosDaAgencia";
import {
  DadosDaAgenciaIncompletos,
  exigirDadosDaAgencia,
  lerDadosDaAgencia,
} from "../../supabase/functions/_shared/dados-da-agencia";

const NOVOS = ["proposta", "contrato", "briefing", "conselho", "identidade", "naming", "site", "motion", "documento"];
const ANTIGOS = ["estrategista", "diretor_arte", "imagem", "leitura", "contexto", "estrategista_rapido"];

const raiz = resolve(__dirname, "../..");
const migrations = resolve(raiz, "supabase/migrations");
const ler = (arquivo: string) => readFileSync(resolve(raiz, arquivo), "utf8");
const SQL_PAPEIS = ler("supabase/migrations/20260930000000_papeis_de_modelo_das_mesas_novas.sql");
const SQL_AGENCIA = ler("supabase/migrations/20260930000100_dados_da_agencia.sql");

/** Os nomes entre aspas simples do primeiro ARRAY[...] depois de `marcador`. */
function nomesDoArray(sql: string, marcador: string): string[] {
  const i = sql.indexOf(marcador);
  expect(i).toBeGreaterThanOrEqual(0);
  const inicio = sql.indexOf("ARRAY[", i);
  const fim = sql.indexOf("]", inicio);
  return (sql.slice(inicio, fim).match(/'([a-z_]+)'/g) || []).map((s) => s.slice(1, -1));
}

function modelo(id: string, papeis: string[], ativo = true, tipo: "texto" | "imagem" = "texto"): ModeloIa {
  return {
    id, provedor: "openrouter", modelo_api: id, tipo, rotulo: id, preco_entrada_1m: 1, preco_saida_1m: 2,
    preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: papeis, ativo,
  };
}

const COMPLETO: Partial<DadosDaAgencia> = {
  razao_social: "Agência Exemplo Ltda",
  nome_fantasia: "Exemplo",
  cnpj: "11.222.333/0001-81",
  endereco: "Rua das Flores, 100\nSala 2, Centro, 86000-000",
  cidade: "Londrina",
  uf: "PR",
  comarca: "Londrina/PR",
  representante_nome: "Fulano de Tal",
  representante_cpf: "529.982.247-25",
  email: "contato@exemplo.com.br",
  telefone: "(43) 99999-0000",
  logo_path: "agencia/logo-1.png",
};

// ------------------------------------------------------------------ papéis

describe("papéis de modelo das mesas novas", () => {
  it("a tela e o catálogo aceitam os 9 papéis, todos de texto", () => {
    expect([...PAPEIS_DAS_MESAS_NOVAS]).toEqual(NOVOS);
    for (const p of NOVOS) {
      expect(PAPEIS.find((x) => x.valor === p)?.tipo).toBe("texto");
      expect(PAPEIS_DA_TELA.find((x) => x.valor === p)?.tipo).toBe("texto");
    }
    // Os antigos continuam na tela de Modelos de IA.
    for (const p of ["estrategista", "diretor_arte", "imagem", "leitura", "contexto"]) {
      expect(PAPEIS_DA_TELA.some((x) => x.valor === p)).toBe(true);
    }
  });

  it("as uniões Tarefa e Agente do ia-motor têm os 9 nomes", () => {
    const motor = ler("supabase/functions/_shared/ia-motor.ts");
    const uniao = motor.slice(motor.indexOf("export type PapelDasMesasNovas"), motor.indexOf("export const PAPEIS_DAS_MESAS_NOVAS"));
    for (const p of NOVOS) expect(uniao).toContain(`"${p}"`);
    expect(motor).toMatch(/export type Tarefa = [^;]*\| PapelDasMesasNovas;/);
    expect(motor).toMatch(/export type Agente = [^;]*\| PapelDasMesasNovas;/);
  });

  it("padraoPara usa o padrão do papel; sem ele, o da estratégia; o escolhido vale se estiver ligado", () => {
    const catalogo = [
      modelo("a-primeiro", []),
      modelo("luna", ["estrategista"]),
      modelo("opus", ["proposta", "contrato"]),
      modelo("desligado", ["site"], false),
      modelo("img", ["imagem"], true, "imagem"),
    ];
    expect(padraoPara(catalogo, "proposta")?.id).toBe("opus");
    expect(padraoPara(catalogo, "conselho")?.id).toBe("luna");
    expect(padraoPara(catalogo, "site")?.id).toBe("luna"); // o padrão está desligado
    // Papel antigo sem padrão continua no primeiro ativo (comportamento de antes).
    expect(padraoPara(catalogo, "diretor_arte")?.id).toBe("a-primeiro");
    // Troca na hora pelo SeletorDeModelo.
    expect(modeloDoPapel(catalogo, "contrato", "luna")?.id).toBe("luna");
    expect(modeloDoPapel(catalogo, "contrato", "desligado")?.id).toBe("opus");
    expect(modeloDoPapel(catalogo, "contrato", "img")?.id).toBe("opus");
    expect(modeloDoPapel(catalogo, "contrato", null)?.id).toBe("opus");
  });
});

// ------------------------------------------------------------------ SQL

describe("migration dos papéis (lida do SQL)", () => {
  it("a CHECK de padrao_para fica com os 6 antigos e os 9 novos", () => {
    const nomes = nomesDoArray(SQL_PAPEIS, "ADD CONSTRAINT ia_modelos_padrao_para_check");
    expect(nomes.slice().sort()).toEqual(ANTIGOS.concat(NOVOS).sort());
  });

  it("é a última migration que redefine a CHECK e não perde nenhum papel das anteriores", () => {
    const arquivos = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
    const comCheck = arquivos.filter((f) => readFileSync(resolve(migrations, f), "utf8").indexOf("ADD CONSTRAINT ia_modelos_padrao_para_check") >= 0);
    expect(comCheck[comCheck.length - 1]).toBe("20260930000000_papeis_de_modelo_das_mesas_novas.sql");
    const nossos = new Set(nomesDoArray(SQL_PAPEIS, "ADD CONSTRAINT ia_modelos_padrao_para_check"));
    for (const f of comCheck.slice(0, -1)) {
      for (const p of nomesDoArray(readFileSync(resolve(migrations, f), "utf8"), "ADD CONSTRAINT ia_modelos_padrao_para_check")) {
        expect(nossos.has(p)).toBe(true);
      }
    }
  });

  it("ia_usos aceita os nomes das uniões Tarefa e Agente (antigos e novos)", () => {
    const tarefas = nomesDoArray(SQL_PAPEIS, "ADD CONSTRAINT ia_usos_tarefa_check");
    const agentes = nomesDoArray(SQL_PAPEIS, "ADD CONSTRAINT ia_usos_agente_check");
    const antigasTarefas = nomesDoArray(ler("supabase/migrations/20260924015930_mesa_ads.sql"), "ADD CONSTRAINT ia_usos_tarefa_check");
    const antigosAgentes = nomesDoArray(ler("supabase/migrations/20260924015930_mesa_ads.sql"), "ADD CONSTRAINT ia_usos_agente_check");
    for (const p of antigasTarefas.concat(NOVOS)) expect(tarefas).toContain(p);
    for (const p of antigosAgentes.concat(NOVOS)) expect(agentes).toContain(p);
  });

  it("o padrão inicial só vai para modelo ligado de texto e respeita a escolha do dono", () => {
    expect(SQL_PAPEIS).toContain("WHERE m.ativo AND m.tipo = 'texto'");
    expect(SQL_PAPEIS).toMatch(/IF EXISTS \(SELECT 1 FROM public\.ia_modelos AS m WHERE _papel\.papel = ANY \(m\.padrao_para\)\) THEN\s+CONTINUE;/);
    for (const p of NOVOS) expect(SQL_PAPEIS).toContain(`('${p}', _`);
    expect(SQL_PAPEIS).not.toMatch(/SET\s+ativo/i);
  });
});

describe("migration dos dados da agência (lida do SQL)", () => {
  it("uma linha só, vazia; equipe lê, só admin altera; sem INSERT nem DELETE pela API", () => {
    expect(SQL_AGENCIA).toContain("id boolean PRIMARY KEY DEFAULT true CONSTRAINT agencia_dados_uma_linha CHECK (id)");
    expect(SQL_AGENCIA).toContain("INSERT INTO public.agencia_dados (id) VALUES (true) ON CONFLICT (id) DO NOTHING;");
    expect(SQL_AGENCIA).toContain("ALTER TABLE public.agencia_dados ENABLE ROW LEVEL SECURITY;");
    expect(SQL_AGENCIA).toMatch(/agencia_dados_equipe_le[\s\S]*FOR SELECT TO authenticated[\s\S]*public\.is_staff/);
    expect(SQL_AGENCIA).toMatch(/agencia_dados_admin_altera[\s\S]*FOR UPDATE TO authenticated[\s\S]*has_role\(\(select auth\.uid\(\)\), 'admin'::public\.app_role\)[\s\S]*WITH CHECK/);
    expect(SQL_AGENCIA).toContain("REVOKE INSERT, DELETE, TRUNCATE ON TABLE public.agencia_dados FROM authenticated;");
    expect(SQL_AGENCIA).not.toMatch(/ON public\.agencia_dados\s+FOR (INSERT|DELETE)/);
  });

  it("logo: equipe lê e admin envia na pasta agencia/ do bucket mesa; nada apaga nem sobrescreve", () => {
    expect(SQL_AGENCIA).toMatch(/"mesa: equipe le a agencia"[\s\S]*FOR SELECT[\s\S]*\(storage\.foldername\(name\)\)\[1\] = 'agencia'[\s\S]*is_staff/);
    expect(SQL_AGENCIA).toMatch(/"mesa: admin envia a agencia"[\s\S]*FOR INSERT[\s\S]*'agencia'[\s\S]*'admin'::public\.app_role/);
    expect(SQL_AGENCIA).not.toMatch(/ON storage\.objects\s+FOR (UPDATE|DELETE)/);
  });

  it("sugestões: só equipe, só leitura", () => {
    expect(SQL_AGENCIA).toMatch(/FUNCTION public\.agencia_dados_sugestoes\(\)[\s\S]*STABLE[\s\S]*SECURITY DEFINER[\s\S]*is_staff\(auth\.uid\(\)\)/);
    const corpo = SQL_AGENCIA.slice(SQL_AGENCIA.indexOf("FUNCTION public.agencia_dados_sugestoes()"));
    expect(corpo).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM)\b/);
    expect(SQL_AGENCIA).toContain("REVOKE ALL ON FUNCTION public.agencia_dados_sugestoes() FROM PUBLIC, anon;");
  });
});

// ------------------------------------------------------------------ faltasNosDados

describe("faltasNosDados", () => {
  it("vazio: contrato pede a qualificação e o foro; proposta pede nome, contato e logo", () => {
    expect(faltasNosDados(null, "contrato").map((f) => f.campo)).toEqual([
      "razao_social", "cnpj", "endereco", "cidade", "uf", "comarca", "representante_nome", "email",
    ]);
    expect(faltasNosDados({}, "proposta").map((f) => f.campo)).toEqual(["nome_fantasia", "email", "telefone", "logo_path"]);
    expect(faltasNosDados({}, "documento").map((f) => f.campo)).toEqual(["nome_fantasia", "logo_path"]);
    expect(faltasNosDados({}, "contrato").every((f) => f.motivo === "vazio")).toBe(true);
  });

  it("completo não falta nada", () => {
    expect(faltasNosDados(COMPLETO, "contrato")).toEqual([]);
    expect(faltasNosDados(COMPLETO, "proposta")).toEqual([]);
    expect(faltasNosDados(COMPLETO, "documento")).toEqual([]);
  });

  it("razão social vale pelo nome fantasia; só espaço é vazio", () => {
    const d = { ...COMPLETO, nome_fantasia: "   " };
    expect(faltasNosDados(d, "proposta")).toEqual([]);
    expect(faltasNosDados({ ...d, razao_social: "" }, "proposta").map((f) => f.campo)).toEqual(["nome_fantasia"]);
  });

  it("formato errado trava: CNPJ, UF, e-mail e CPF opcional preenchido", () => {
    const d = { ...COMPLETO, cnpj: "11.222.333/0001-80", uf: "XX", email: "sem-arroba", representante_cpf: "111.111.111-11" };
    expect(faltasNosDados(d, "contrato")).toEqual([
      { campo: "cnpj", rotulo: "CNPJ", motivo: "invalido" },
      { campo: "uf", rotulo: "UF", motivo: "invalido" },
      { campo: "email", rotulo: "E-mail", motivo: "invalido" },
      { campo: "representante_cpf", rotulo: "CPF do representante", motivo: "invalido" },
    ]);
    // CPF vazio não trava (é opcional).
    expect(faltasNosDados({ ...COMPLETO, representante_cpf: null }, "contrato")).toEqual([]);
  });

  it("textoDasFaltas e qualificação montada por código", () => {
    expect(textoDasFaltas([])).toBeNull();
    expect(textoDasFaltas(faltasNosDados({ ...COMPLETO, comarca: null, cnpj: "123" }, "contrato"))).toBe(
      "Faltam nos dados da agência: CNPJ (inválido), Comarca do foro. Preencha em Configurações, Dados da agência.",
    );
    expect(qualificacaoDaContratada(normalizarDadosDaAgencia({}))).toBeNull();
    expect(qualificacaoDaContratada(normalizarDadosDaAgencia(COMPLETO))).toBe(
      "Agência Exemplo Ltda, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 11.222.333/0001-81, " +
        "com sede em Rua das Flores, 100, Sala 2, Centro, 86000-000, Londrina/PR, neste ato representada por Fulano de Tal, " +
        "inscrito(a) no CPF sob o nº 529.982.247-25",
    );
  });

  it("normaliza: máscara no CNPJ e CPF, UF maiúscula, e-mail minúsculo, vazio vira null", () => {
    const n = normalizarDadosDaAgencia({ cnpj: "11222333000181", representante_cpf: "52998224725", uf: "pr", email: " Contato@X.COM ", site: "  " });
    expect(n.cnpj).toBe("11.222.333/0001-81");
    expect(n.representante_cpf).toBe("529.982.247-25");
    expect(n.uf).toBe("PR");
    expect(n.email).toBe("contato@x.com");
    expect(n.site).toBeNull();
    expect(n.logo_bucket).toBe("mesa");
    expect(cnpjValido("00.000.000/0000-00")).toBe(false);
    expect(cpfValido("000.000.000-00")).toBe(false);
  });
});

describe("helper do servidor", () => {
  const cliente = (linha: unknown, erro: unknown = null) => ({
    from: (tabela: string) => {
      expect(tabela).toBe("agencia_dados");
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: linha, error: erro }) };
      return q;
    },
  });

  it("lê a linha e normaliza; erro do banco sobe (não é engolido)", async () => {
    expect((await lerDadosDaAgencia(cliente({ ...COMPLETO, cnpj: "11222333000181" }))).cnpj).toBe("11.222.333/0001-81");
    await expect(lerDadosDaAgencia(cliente(null, { message: "relation does not exist" }))).rejects.toThrow("Dados da agência não lidos: relation does not exist");
  });

  it("exigirDadosDaAgencia lança com o código e a lista de faltas", async () => {
    await expect(exigirDadosDaAgencia(cliente(COMPLETO), "contrato")).resolves.toMatchObject({ razao_social: "Agência Exemplo Ltda" });
    const erro = await exigirDadosDaAgencia(cliente(null), "proposta").catch((e) => e);
    expect(erro).toBeInstanceOf(DadosDaAgenciaIncompletos);
    expect(erro.codigo).toBe("dados_da_agencia_incompletos");
    expect(erro.faltas.map((f: { campo: string }) => f.campo)).toEqual(["nome_fantasia", "email", "telefone", "logo_path"]);
  });
});

// ------------------------------------------------------------------ tela

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(DadosDaAgencia)));
}

describe("Configurações, Dados da agência", () => {
  beforeEach(() => {
    papelDaPessoa.valor = "admin";
    salvar.mockReset();
    lerDados.mockReset();
    lerSugestoes.mockReset();
    lerDados.mockResolvedValue(normalizarDadosDaAgencia({}));
    lerSugestoes.mockResolvedValue([{ campo: "nome_fantasia", valor: "Aceleriq", fonte: "Comercial: organização Aceleriq" }]);
  });

  it("estado em uma linha", () => {
    expect(estadoDosDados(normalizarDadosDaAgencia({}))).toBe("Contrato: faltam 8 · Proposta: faltam 4");
    expect(estadoDosDados(normalizarDadosDaAgencia(COMPLETO))).toBe("Contrato: pronto · Proposta: pronto");
  });

  it("nada vem preenchido; a sugestão só entra se o admin usar; falha ao salvar não perde o rascunho", async () => {
    salvar.mockRejectedValueOnce(new Error("sem rede"));
    montar();
    const nome = (await screen.findByLabelText(/Nome fantasia/)) as HTMLInputElement;
    expect(nome.value).toBe("");
    const usar = await screen.findByRole("button", { name: "Usar sugestão: Aceleriq" });
    fireEvent.click(usar);
    expect(nome.value).toBe("Aceleriq");
    fireEvent.change(screen.getByLabelText(/Comarca do foro/), { target: { value: "Londrina/PR" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    expect(salvar.mock.calls[0][0]).toMatchObject({ nome_fantasia: "Aceleriq", comarca: "Londrina/PR" });
    expect(salvar.mock.calls[0][0]).not.toHaveProperty("logo_path");
    await waitFor(() => expect((screen.getByLabelText(/Comarca do foro/) as HTMLInputElement).value).toBe("Londrina/PR"));
  });

  it("equipe que não é admin só vê: campos travados, sem Salvar, sem sugestão", async () => {
    papelDaPessoa.valor = "design";
    montar();
    const nome = (await screen.findByLabelText(/Nome fantasia/)) as HTMLInputElement;
    expect(nome.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
    expect(screen.queryByText(/Usar sugestão/)).toBeNull();
    expect(lerSugestoes).not.toHaveBeenCalled();
  });
});
