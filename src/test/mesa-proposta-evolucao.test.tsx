import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { comBloco, conteudoDoModelo, MODELO_PADRAO_ACELERIQ, normalizarItens } from "../../supabase/functions/_shared/proposta-modelo";
import { caminhoDaProposta, normalizarAcoesDaProposta, OPERACOES_COM_IA, regrasDaProposta, type PropostaParaAcao } from "../../supabase/functions/mesa-proposta/acoes-da-proposta";
import PropostaPublica, { whatsDaAgencia } from "@/pages/PropostaPublica";
import PropostaDocumento, { fundoNoTema, itensDoIndice } from "@/components/mesa-proposta/PropostaDocumento";

/**
 * Frente PRO2 da Mesa Proposta: as ações novas do estrategista (pacotes pelo
 * Jev, margem pela hora técnica, resumo da reunião), o banco (migration
 * 20260930130000), a função nova no config e o link público com índice,
 * barra fixa, pacotes e forma de pagamento no aceite.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "c".repeat(64);
const hojeMais = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

function proposta(extra: Partial<PropostaParaAcao> = {}): PropostaParaAcao {
  return { id: ID, titulo: "Identidade visual", numero: "2026-001", status: "rascunho", validade_ate: "2026-10-15", blocos: conteudoDoModelo(MODELO_PADRAO_ACELERIQ).blocos, itens: normalizarItens([{ id: "x1", nome: "Logo", valor_unitario: 3000, horas: 12 }]), ...extra };
}

describe("estrategista: ações novas (PRO2)", () => {
  it("montar os pacotes e resumir a reunião pedem Confirmar com o custo antes", () => {
    expect(OPERACOES_COM_IA).toEqual(expect.arrayContaining(["montar_pacotes", "resumir_reuniao"]));
    const a = normalizarAcoesDaProposta({ resumo: "x", itens: [{ operacao: "montar_pacotes", ref: "p1", para: "" }, { operacao: "resumir_reuniao", ref: "p1", para: "" }] }, proposta(), "monte os pacotes e resuma a reunião", 0.06, 0.02, undefined, { resumo: 0.01, pacotes: 0.005 })!;
    expect(a.itens.map((i) => i.operacao)).toEqual(["montar_pacotes", "resumir_reuniao"]);
    expect(a.custo_estimado_usd).toBeCloseTo(0.015, 6);
    expect(podeExecutarDireto(a, regrasDaProposta(), { pedidoClaro: true }).direto).toBe(false);
  });

  it("margem: só a que a equipe disse, sem custo mas sempre com Confirmar (mexe em preço)", () => {
    const sem = normalizarAcoesDaProposta({ resumo: "x", itens: [{ operacao: "ajustar_margem", ref: "p1", para: "40" }] }, proposta(), "melhore a margem", 0.05, 0.02)!;
    expect(sem.itens).toHaveLength(0);
    expect(sem.recusados[0].motivo).toMatch(/margem não está no seu pedido/);
    const com = normalizarAcoesDaProposta({ resumo: "x", itens: [{ operacao: "ajustar_margem", ref: "p1", para: "35%" }] }, proposta(), "ajuste os preços para a margem de 35%", 0.05, 0.02)!;
    expect(com.itens[0].para).toBe("35");
    expect(com.itens[0].para_rotulo).toBe("margem de 35%");
    expect(com.custo_estimado_usd).toBe(0);
    expect(podeExecutarDireto(com, regrasDaProposta(), { pedidoClaro: true }).direto).toBe(false);
    const aceita = normalizarAcoesDaProposta({ resumo: "x", itens: [{ operacao: "montar_pacotes", ref: "p1", para: "" }] }, proposta({ status: "aceita" }), "monte", 0.05, 0.02)!;
    expect(aceita.recusados[0].motivo).toMatch(/aceita não muda/);
  });

  it("pacotes, margem e resumo levam ao Contexto", () => {
    const c = caminhoDaProposta(ID, ID, { itens: [{ operacao: "montar_pacotes" }, { operacao: "ajustar_margem" }] as never });
    expect(c!.destino).toContain("etapa=contexto");
  });
});

describe("banco da PRO2 (migration 20260930130000)", () => {
  const sql = ler("supabase/migrations/20260930130000_proposta_comercial_evolucao.sql");

  it("só amplia: colunas com IF NOT EXISTS, CHECKs com os valores de antes e os novos", () => {
    for (const c of ["pacotes", "pagamento", "visual", "anexos", "duplicada_de", "pacote_aceito", "pagamento_aceito", "ultimo_followup_em"]) expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${c} `);
    for (const t of ["'criada'", "'aberta'", "'contrato_pendente'", "'duplicada'", "'followup'", "'pacotes_montados'"]) expect(sql.slice(sql.indexOf("proposta_eventos_tipo_check CHECK"))).toContain(t);
    for (const o of ["'manual'", "'envio'", "'duplicacao'", "'margem'", "'resumo'"]) expect(sql.slice(sql.indexOf("proposta_versoes_origem_check CHECK"))).toContain(o);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
  });

  it("tabelas da biblioteca: RLS de admin e gestor, ninguém escreve pela API, autorização registrada", () => {
    for (const t of ["proposta_servicos", "proposta_provas", "proposta_calculadora"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toMatch(new RegExp(`CREATE POLICY ${t}_gestao_le ON public\\.${t}\\s+FOR SELECT TO authenticated`));
    }
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.proposta_servicos, public.proposta_provas, public.proposta_calculadora FROM authenticated;");
    expect(sql).toContain("CHECK (NOT autorizado OR length(btrim(coalesce(autorizacao, ''))) >= 3)");
    expect(sql).not.toMatch(/USING \(true\)/i);
  });

  it("aceite v2: security definer, só o service_role, pacote obrigatório com pacotes e itens do pacote aceito", () => {
    const v2 = sql.slice(sql.indexOf("FUNCTION public.proposta_publica_aceitar_v2"));
    expect(v2).toContain("SECURITY DEFINER");
    expect(v2).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");
    expect(v2).toContain("RAISE EXCEPTION 'package required'");
    expect(v2).toContain("RAISE EXCEPTION 'invalid payment option'");
    expect(v2).toContain("(now() AT TIME ZONE 'America/Sao_Paulo')::date");
    expect(v2).toContain("'ja_aceita', true");
    expect(v2).toContain("'itens_enviados'");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.proposta_publica_aceitar_v2\([^)]*\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.proposta_publica_aceitar_v2\([^)]*\) TO service_role;/);
    const lerSql = sql.slice(sql.indexOf("FUNCTION public.proposta_publica_ler"), sql.indexOf("FUNCTION public.proposta_publica_aceitar_v2"));
    for (const c of ["'pacotes'", "'pagamento'", "'visual'", "'anexos'"]) expect(lerSql).toContain(c);
  });

  it("função nova no config com JWT; mesa-proposta e a pública seguem como estavam", () => {
    const cfg = ler("supabase/config.toml");
    expect(cfg).toMatch(/\[functions\.proposta-biblioteca\]\s+verify_jwt = true/);
    expect(cfg).toMatch(/\[functions\.mesa-proposta\]\s+verify_jwt = true/);
    expect(cfg).toMatch(/\[functions\.proposta-publica\]\s+verify_jwt = false/);
    expect(ler("src/lib/mesa/api.ts")).toContain('"proposta-biblioteca"');
  });

  it("sem a migration no banco, a mesa lê as colunas de antes (não quebra)", () => {
    expect(ler("supabase/functions/mesa-proposta/index.ts")).toContain("semColunaDaPro2");
    expect(ler("src/components/mesa-proposta/propostaApi.ts")).toContain("faltaAColunaNova");
  });
});

describe("documento: modelos visuais, pacotes e cronograma", () => {
  const conteudo = comBloco(
    comBloco(conteudoDoModelo(MODELO_PADRAO_ACELERIQ), "capa", { dados: { headline: "Marca nova para vender mais", subtitulo: "", projeto: "Marca" } }),
    "cronograma",
    { dados: { marcos: [{ titulo: "Kickoff", quando: "semana 1" }, { titulo: "Criação", quando: "semanas 2 a 3" }], observacao: "" } },
  );
  const itens = normalizarItens([
    { id: "a", nome: "Identidade", valor_unitario: 3000 },
    { id: "b", nome: "Site", valor_unitario: 4000 },
  ]);

  it("tema claro deixa tudo claro; cores do cliente pintam a capa; o índice pula a capa", () => {
    expect(fundoNoTema("investimento", "aceleriq")).toBe("escuro");
    expect(fundoNoTema("investimento", "claro")).toBe("claro");
    expect(itensDoIndice(conteudo)[0].tipo).not.toBe("capa");
    const { container } = render(<PropostaDocumento cliente="Loja" dados={{ numero: "2026-001", titulo: "Marca", conteudo, itens, validade_ate: null, data: null, visual: { tema: "cliente", cores: ["#ffcc00"] } }} />);
    const doc = container.querySelector("[data-proposta-documento]") as HTMLElement;
    expect(doc.getAttribute("data-tema")).toBe("cliente");
    expect(doc.style.getPropertyValue("--pd-cliente")).toBe("#ffcc00");
    expect(container.querySelector('[data-bloco="capa"]')!.className).toContain("pd-capa-na-cor");
    // Amarelo pede texto escuro: a capa não usa a logo clara.
    expect(container.querySelector('[data-bloco="capa"]')!.className).toContain("pd-claro");
    expect(container.querySelectorAll(".pd-gantt-barra")).toHaveLength(2);
  });

  it("com pacotes: três cartões, comparativo e o pagamento pelo pacote em destaque", () => {
    render(
      <PropostaDocumento
        cliente="Loja"
        dados={{ numero: "2026-001", titulo: "Marca", conteudo, itens, validade_ate: null, data: null, pacotes: { ativo: true, niveis: { a: "essencial", b: "recomendado" }, destaque: "recomendado" }, pagamento: { opcoes: [{ tipo: "a_vista", desconto_pct: 10 }] } }}
      />,
    );
    const inv = screen.getByLabelText("Investimento");
    expect(within(inv).getAllByText("R$ 7.000,00").length).toBeGreaterThanOrEqual(2);
    expect(within(inv).getByText("Recomendado", { selector: ".pd-selo" })).toBeTruthy();
    expect(within(inv).getByRole("table")).toBeTruthy();
    expect(within(inv).getByText("À vista com 10% de desconto: R$ 6.300,00")).toBeTruthy();
  });
});

describe("link público (PRO2)", () => {
  let chamadas: Array<{ url: string; corpo: any }> = [];
  afterEach(() => vi.unstubAllGlobals());

  function mockFetch(get: unknown) {
    chamadas = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const corpo = init && init.body ? JSON.parse(String(init.body)) : null;
        chamadas.push({ url: String(url), corpo });
        const dados = init && init.method === "POST" ? (corpo && corpo.aceitar ? { ok: true, aceita_em: "2026-10-01T10:00:00Z" } : { ok: true }) : get;
        return { ok: true, json: async () => dados } as Response;
      }),
    );
  }

  function publica(extra: Record<string, unknown> = {}) {
    const conteudo = comBloco(conteudoDoModelo(MODELO_PADRAO_ACELERIQ), "capa", { dados: { headline: "Marca nova para vender mais", subtitulo: "", projeto: "Marca" } });
    return {
      proposta: {
        id: "p1",
        numero: "2026-009",
        titulo: "Marca",
        status: "enviada",
        validade_ate: hojeMais(10),
        enviada_em: "2026-09-30T12:00:00Z",
        conteudo,
        itens: [
          { id: "a", nome: "Identidade", valor_unitario: 3000, quantidade: 1, recorrencia: "unico" },
          { id: "b", nome: "Site", valor_unitario: 4000, quantidade: 1, recorrencia: "unico" },
        ],
        cliente: "Loja da Joana",
        aceite: null,
        pacotes: { ativo: true, niveis: { a: "essencial", b: "recomendado" }, destaque: "recomendado" },
        pagamento: { opcoes: [{ id: "a_vista", tipo: "a_vista", desconto_pct: 5 }, { id: "parcelado", tipo: "parcelado", parcelas: 3 }] },
        anexos: [{ id: "x", tipo: "link", titulo: "Portfólio", url: "https://behance.net/aceleriq" }],
        ...extra,
      },
      agencia: { nome: "Aceleriq", whatsapp: "(41) 99999-0000" },
      logo_cliente_url: null,
    };
  }

  function montar() {
    return render(
      <MemoryRouter initialEntries={[`/proposta/${TOKEN}`]}>
        <Routes>
          <Route path="/proposta/:token" element={<PropostaPublica />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("índice, barra fixa com Aceitar e o WhatsApp da agência, e os materiais", async () => {
    mockFetch(publica());
    montar();
    await screen.findByText("Marca nova para vender mais");
    expect(screen.getByRole("navigation", { name: "Índice da proposta" })).toBeTruthy();
    const barra = screen.getByRole("region", { name: "Ações da proposta" });
    expect(within(barra).getByRole("link", { name: "Aceitar agora" }).getAttribute("href")).toBe("#pd-aceite");
    expect(within(barra).getByRole("link", { name: "Falar no WhatsApp" }).getAttribute("href")).toContain("https://wa.me/5541999990000?text=");
    expect(screen.getByRole("link", { name: "Portfólio" }).getAttribute("href")).toBe("https://behance.net/aceleriq");
    expect(whatsDaAgencia("123")).toBe("");
  });

  it("o aceite pede o pacote e a forma de pagamento e manda os dois", async () => {
    mockFetch(publica());
    montar();
    await screen.findByText("Marca nova para vender mais");
    fireEvent.change(screen.getByLabelText("Seu nome completo"), { target: { value: "Joana Lima" } });
    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "joana@loja.com.br" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Aceitar proposta" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/pacote/);
    fireEvent.click(screen.getByRole("radio", { name: /Recomendado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Aceitar proposta" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/forma de pagamento/);
    fireEvent.click(screen.getByRole("radio", { name: /À vista com 5% de desconto: R\$ 6\.650,00/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aceitar proposta" }));
    });
    await waitFor(() => expect(chamadas.some((c) => c.corpo && c.corpo.aceitar)).toBe(true));
    const aceite = chamadas.find((c) => c.corpo && c.corpo.aceitar)!;
    expect(aceite.corpo.aceitar).toEqual({ nome: "Joana Lima", email: "joana@loja.com.br", aceito: true, pacote: "recomendado", pagamento: "a_vista" });
  });

  it("aceita: sem o botão de aceitar na barra, só o WhatsApp", async () => {
    mockFetch(publica({ status: "aceita", aceite: { nome: "Joana", em: "2026-10-01" }, pacote_aceito: "completo" }));
    montar();
    await screen.findByText("Marca nova para vender mais");
    const barra = screen.getByRole("region", { name: "Ações da proposta" });
    expect(within(barra).queryByRole("link", { name: "Aceitar agora" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aceitar proposta" })).toBeNull();
  });
});
