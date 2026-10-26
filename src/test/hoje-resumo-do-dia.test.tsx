import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizarResumo } from "@/lib/resumoDoDia";
import { categoriaDoAviso, rotuloDoLink } from "@/lib/avisos/rotulos";

/**
 * 26/10/2026 (decisão do dono: "1 resumo por dia numa tela Hoje + 1 aviso no
 * sino"): a tela /hoje lê a RPC resumo_do_dia; poucas linhas por seção, cada
 * uma com uma ação direta; vazio e RPC ainda ausente têm estado claro.
 */

const resposta: { data: unknown; error: { message: string; code?: string } | null } = { data: null, error: null };
const rpc = vi.fn(async () => resposta);
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => (rpc as any)(...a) } }));
vi.mock("@/components/admin/LogoDoCliente", async (orig) => ({ ...(await orig<any>()), useIdentidadesDosClientes: () => ({ data: new Map() }) }));

import Hoje from "@/pages/Hoje";

const RESUMO = {
  gerado_em: "2026-10-26T09:00:00Z",
  anuncios: {
    mudancas: [{ id: "m1", client_id: "c1", cliente: "Casa dos Assados", acao: "Subiu a verba", alvo: "Remarketing", antes: "R$ 30/dia", depois: "R$ 45/dia", quem: "Paperclip", quando: "2026-10-26T08:00:00Z", prova_url: "https://exemplo.com/print.png" }],
    alertas: [{ client_id: "c2", cliente: "Stop", nivel: "info", texto: "CPM estável" }, { client_id: "c1", cliente: "Casa dos Assados", nivel: "critico", texto: "Saldo acaba amanhã" }],
  },
  // Formato final da frente SERVIDOR (26/10): link sugerido no risco e "campanhas" (cliente em dia com hype forte).
  calendario: {
    clientes_em_risco: [{ client_id: "c3", nome: "Terra Flor", situacao: "sem post", dias_sem_post: 9, falta: "preparar 6 posts até 26/10", sugestao: "Gerar o carrossel de novembro", em_risco_ha_dias: 3, pct_mes: 40, task_id: null, link: null }],
    campanhas: [{ client_id: "c4", nome: "Stop Informática", tema: "Black Friday", por_que: "Hype forte nesta semana e o calendário em dia" }],
  },
  precisa_de_voce: [
    { id: "p1", tipo: "aprovacao", titulo: "ACE-275 | Meta: arquivar anúncio com erro", cliente: "Preserva Eco", aprovacao_id: "ap-1", motivo: "O agente pede o seu sim" },
    { id: "p2", tipo: "mensagem", titulo: "Rota da semana", cliente: "Stop", area: "Atendimento" },
  ],
  feito_ontem: [{ id: "f1", titulo: "Carrossel de outubro", cliente: "Softy Móveis", agente: "Estrategista de Conteúdo", quando: "2026-10-25T18:00:00Z", prova_url: "https://exemplo.com/carrossel.png" }],
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(Hoje))));
}

afterEach(() => { cleanup(); resposta.data = null; resposta.error = null; rpc.mockClear(); });

describe("tela Hoje", () => {
  it("com dados: números do dia no topo e cada coisa num cartão da grade, com uma ação (o cartão é o link)", async () => {
    resposta.data = RESUMO;
    montar();
    await waitFor(() => expect(document.querySelectorAll("[data-pedido-do-dia]").length).toBe(2));
    expect(rpc).toHaveBeenCalledWith("resumo_do_dia");
    // Topo: os quatro números do dia, Precisa de você primeiro.
    const numeros = document.querySelector("[data-numeros-do-dia]")!;
    expect(numeros.textContent).toMatch(/^Precisa de você2/);
    // Precisa de você: cartões em grade (não lista de linhas), nome Cliente · Área · assunto.
    const grade = screen.getByRole("list", { name: "Precisa de você" });
    expect(grade.className).toContain("grid");
    const pedidos = Array.from(document.querySelectorAll("[data-pedido-do-dia]"));
    const link = pedidos[0].querySelector("a")!;
    expect(link.getAttribute("aria-label")).toBe("Aprovar: Preserva Eco · Tráfego · Arquivar anúncio com erro");
    expect(pedidos[0].textContent).toContain("Arquivar anúncio com erro");
    expect(pedidos[0].textContent).not.toContain("ACE-275");
    expect(pedidos[0].querySelectorAll("a").length).toBe(1);
    expect(link.getAttribute("href")).toBe("/execucao?aprovacao=ap-1");
    expect(pedidos[1].querySelector("a")!.getAttribute("href")).toBe("/central/mensagens");
    // Cliente sem post: cartão com os dias em destaque, a barra do mês e a pauta na Mesa.
    const risco = document.querySelector('[data-risco="c3"]')!;
    expect(risco.textContent).toContain("Terra Flor");
    expect(risco.textContent).toContain("9dias sem post");
    expect(risco.querySelector("[data-barra-do-mes]")!.getAttribute("data-barra-do-mes")).toBe("40");
    expect(risco.querySelector("a")!.getAttribute("href")).toBe("/mesa?client=c3");
    expect(risco.textContent).toContain("preparar 6 posts até 26/10");
    // Dá para fazer campanha: abre a aba Campanhas da Mesa.
    const campanha = document.querySelector('[data-campanha-do-dia="c4"]')!;
    expect(campanha.textContent).toContain("Black Friday");
    expect(campanha.querySelector("a")!.getAttribute("href")).toBe("/mesa?client=c4&aba=campanhas");
    expect(campanha.querySelector("a")!.getAttribute("title")).toBe("Abrir Campanhas");
    // Anúncios: urgente antes de info; a mudança abre a prova.
    expect(Array.from(document.querySelectorAll("[data-alerta-do-dia]")).map((x) => x.getAttribute("data-alerta-do-dia"))).toEqual(["critico", "info"]);
    const mudanca = document.querySelector("[data-mudanca-do-dia]")!;
    expect(mudanca.textContent).toContain("R$ 30/dia → R$ 45/dia");
    expect(mudanca.querySelector("a")!.getAttribute("href")).toBe("https://exemplo.com/print.png");
    // Feito ontem com prova, compacto.
    const feito = document.querySelector("[data-feito]")!;
    expect(feito.querySelector("a")!.getAttribute("aria-label")).toBe("Ver a prova: Softy Móveis · Conteúdo · Carrossel de outubro");
    expect(feito.querySelector("a")!.getAttribute("target")).toBe("_blank");
  });

  it("vazio: diz que não há nada para hoje", async () => {
    resposta.data = { gerado_em: "2026-10-26T09:00:00Z", anuncios: {}, calendario: {}, precisa_de_voce: [], feito_ontem: [] };
    montar();
    await waitFor(() => expect(screen.getByText("Nada para hoje.")).toBeTruthy());
    expect(document.querySelectorAll("[data-pedido-do-dia]").length).toBe(0);
  });

  it("RPC ainda não criada no banco: estado claro, sem erro", async () => {
    resposta.error = { message: "Could not find the function public.resumo_do_dia without parameters in the schema cache", code: "PGRST202" };
    montar();
    await waitFor(() => expect(screen.getByText("O resumo do dia ainda não chega a este painel.")).toBeTruthy());
    expect(screen.queryByText("Não foi possível ler o resumo do dia.")).toBeNull();
  });

  it("lê o resumo de forma tolerante (texto, linha, campos ausentes)", () => {
    expect(normalizarResumo(JSON.stringify(RESUMO)).precisaDeVoce).toHaveLength(2);
    expect(normalizarResumo([{ resumo_do_dia: RESUMO }]).feitoOntem).toHaveLength(1);
    const vazio = normalizarResumo(null);
    expect(vazio).toMatchObject({ mudancas: [], alertas: [], clientesEmRisco: [], precisaDeVoce: [], feitoOntem: [] });
  });

  it("o aviso diário do sino leva para /hoje; a página está no menu, no topo da área de agentes", () => {
    expect(categoriaDoAviso("resumo_do_dia")).toBe("resumo");
    expect(rotuloDoLink("/hoje")).toBe("Abrir o resumo de hoje");
    const menu = readFileSync(resolve(__dirname, "../components/AppLayout.tsx"), "utf8");
    const agentes = menu.slice(menu.indexOf('label: "Agentes"'));
    expect(agentes.indexOf('{ title: "Hoje", url: "/hoje"')).toBeGreaterThan(0);
    expect(menu.indexOf('label: "Agentes"')).toBeLessThan(menu.indexOf('label: "Operação da semana"'));
    expect(readFileSync(resolve(__dirname, "../App.tsx"), "utf8")).toContain('<Route path="/hoje" element={<StaffRoute><Hoje /></StaffRoute>} />');
  });
});
