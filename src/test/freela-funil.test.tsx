import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { linkDoWhatsApp, mensagemDeRetomada, somaPorMoeda, totalEmTexto } from "@/lib/freela/freelaLib";
import FunilDasPropostas from "@/components/freela/FunilDasPropostas";

/**
 * 04/11/2026 (dono): funil em kanban, Fechados com "Transformar em cliente", Perdidos com o motivo e o follow-up,
 * e o freela como caixinha separada que entra no valor geral.
 */
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");
const sql = ler("supabase/migrations/20261104150000_freela_funil_fechados_e_perdidos.sql");

const proposta = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, status, titulo: `Trabalho ${id}`, contato_id: "c1", valor: 1000, moeda: "BRL", link_externo: null, validade_ate: null,
  convertida_em: null, convertida_client_id: null, motivo_perda: null, perdida_em: null, follow_up_em: null, ...extra,
}) as never;

const montar = (propostas: never[], acoes: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <FunilDasPropostas
        propostas={propostas}
        contatoDe={() => ({ id: "c1", nome: "Ana Souza", empresa: "Ana Doces", whatsapp: "41999998888" }) as never}
        propostasComProjeto={new Set()}
        onAbrir={vi.fn()}
        onMover={vi.fn()}
        onTransformar={vi.fn()}
        onVirarProjeto={vi.fn()}
        onRetomar={vi.fn()}
        {...acoes}
      />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("quadro do funil", () => {
  it("tem as cinco colunas, com Fechados e Perdidos", () => {
    montar([]);
    for (const coluna of ["Rascunho", "Enviada", "Em negociação", "Fechados", "Perdidos"]) {
      expect(screen.getByRole("region", { name: coluna })).toBeTruthy();
    }
  });

  it("Fechados oferece Transformar em cliente; só depois de fechar", () => {
    const onTransformar = vi.fn();
    montar([proposta("a", "aceita"), proposta("b", "negociacao")], { onTransformar });
    const botoes = screen.getAllByRole("button", { name: "Transformar em cliente" });
    expect(botoes).toHaveLength(1);
    fireEvent.click(botoes[0]);
    expect(onTransformar).toHaveBeenCalledTimes(1);
  });

  it("proposta que virou cliente não oferece de novo e não arrasta", () => {
    montar([proposta("a", "aceita", { convertida_em: "2026-11-04T10:00:00Z" })]);
    expect(screen.queryByRole("button", { name: "Transformar em cliente" })).toBeNull();
    expect(screen.getByRole("button", { name: "Abrir proposta Trabalho a" }).hasAttribute("data-arrasta")).toBe(false);
    expect(screen.getByText("Virou cliente")).toBeTruthy();
  });

  it("Perdidos mostra o motivo, a data e os caminhos de recuperar", () => {
    const onRetomar = vi.fn();
    montar([proposta("a", "perdida", { motivo_perda: "Preço: achou caro", follow_up_em: "2020-01-10" })], { onRetomar });
    expect(screen.getByText("Preço: achou caro")).toBeTruthy();
    expect(screen.getByText(/Hora de retomar/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mensagem" }).getAttribute("href")).toContain("wa.me/5541999998888");
    fireEvent.click(screen.getByRole("button", { name: "Retomar" }));
    expect(onRetomar).toHaveBeenCalledTimes(1);
  });

  it("total da coluna não mistura as moedas", () => {
    expect(totalEmTexto(somaPorMoeda([{ valor: 1000, moeda: "BRL" }, { valor: 50, moeda: "USD" }]))).toMatch(/R\$\s1\.000,00 · US\$\s50,00/);
    expect(totalEmTexto(somaPorMoeda([]))).toBe("vazio");
  });
});

describe("mensagem de retomada", () => {
  it("número sem DDI vira Brasil; número curto não gera link; quem envia é a pessoa", () => {
    expect(linkDoWhatsApp("(41) 99999-8888", "oi")).toBe("https://wa.me/5541999998888?text=oi");
    expect(linkDoWhatsApp("14155551234567", "oi")).toContain("wa.me/14155551234567");
    expect(linkDoWhatsApp("123", "oi")).toBeNull();
    expect(linkDoWhatsApp(null, "oi")).toBeNull();
    expect(mensagemDeRetomada("Ana Souza", "o site")).toContain("Oi, Ana!");
  });
});

describe("transformar em cliente no banco", () => {
  it("só admin, e só proposta fechada; repetir não duplica", () => {
    expect(sql).toContain("has_role(auth.uid(), 'admin'::public.app_role)");
    expect(sql).toContain("IF v_proposta.status <> 'aceita' THEN");
    expect(sql).toContain("IF v_proposta.convertida_em IS NOT NULL THEN");
    expect(sql).toContain("FROM public.freela_propostas WHERE id = p_proposta_id FOR UPDATE");
  });

  it("mensalidade paga passa por pending para o gatilho gerar a próxima", () => {
    expect(sql).toContain("VALUES (v_client_id, 'renewal', p_valor, v_vencimento, 'Mensalidade · ' || v_nome, 'pending')");
    expect(sql).toContain("UPDATE public.billing SET status = 'paid', paid_date = v_hoje, paid_amount = p_valor WHERE id = v_billing_id;");
  });

  it("dólar nunca vira cobrança comum nem plano; parcela existente não cobra duas vezes", () => {
    expect(sql).toContain("IF v_proposta.moeda <> 'BRL' AND p_modelo = 'recorrente' THEN");
    expect(sql).toContain("IF NOT v_tem_parcelas THEN");
    expect(sql).toContain("INSERT INTO public.freela_parcelas (projeto_id, numero, valor, moeda, vencimento, status, pago_em)");
  });

  it("marca a origem, cria o projeto e fecha o acesso a anônimo", () => {
    expect(sql).toContain("origem_aquisicao = 'freela'");
    expect(sql).toContain("INSERT INTO public.projects (");
    expect(sql).toContain("FROM PUBLIC, anon;");
    expect(sql.trim().endsWith("TO authenticated;")).toBe(true);
  });
});

describe("caixinha separada no valor geral", () => {
  it("cliente que veio do Freela fica na origem Freela e a cobrança dele é comum", () => {
    const s = ler("src/pages/AdminFinanceiro.tsx");
    expect(s).toContain('const daOrigemFreela = (b: any) => ehCobrancaFreela(b) || b?.client?.origem_aquisicao === "freela";');
    expect(s).toContain('origem === "freela" ? daOrigemFreela(b) : !daOrigemFreela(b)');
    expect(ler("src/hooks/useFinancialData.ts")).toContain("origem_aquisicao)");
  });
});

describe("os dois funis usam o mesmo quadro", () => {
  it("colunas, arrasto e moldura do cartão moram num lugar só", () => {
    for (const funil of ["src/components/freela/FunilDasPropostas.tsx", "src/components/comercial/FunilKanban.tsx"]) {
      const s = ler(funil);
      expect(s).toContain("<QuadroKanban");
      expect(s).toContain("<ColunaDoQuadro");
      expect(s).toContain("classesDoCartao(");
      expect(s).not.toContain("DndContext");
    }
  });
});

describe("janelas enquadradas", () => {
  it("nunca maiores que a tela, sem vazar para o lado", () => {
    for (const janela of ["src/components/ui/dialog.tsx", "src/components/ui/alert-dialog.tsx"]) {
      const s = ler(janela);
      expect(s).toContain("max-h-[calc(100vh-2rem)] overflow-y-auto overflow-x-hidden [&>*]:min-w-0");
      expect(s).toContain("w-[calc(100vw-2rem)]");
    }
  });
});

describe("telas sem rolagem infinita", () => {
  it("cada aba rola por dentro, e o funil por coluna", () => {
    const s = ler("src/pages/AdminFreela.tsx");
    expect(s).toContain("<AreaDeTrabalho principalRolavel={false}");
    for (const aba of ["AbaContatos", "AbaProjetos", "AbaCaixa"]) {
      const c = ler(`src/components/freela/${aba}.tsx`);
      // A barra fica antes da região que rola: só a lista corre.
      expect(c.indexOf('mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-2')).toBeGreaterThan(0);
      expect(c.indexOf("<RegiaoRolavel")).toBeGreaterThan(c.indexOf('mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-2'));
      expect(c).not.toContain("<Secao");
    }
    expect(ler("src/components/sistema/QuadroKanban.tsx")).toContain("<RegiaoRolavel");
  });
});
