import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Máquina de leads (25/10/2026): as regras da busca, do Jev e do lead que entra no CRM; a tela (nova busca,
 * andamento, candidatos com contato e origem, avaliar, levar ao CRM com o Mercúrio, descartar e abrir o lead);
 * e as travas do buscador (sem disfarce, robots.txt, sem Google, Instagram nem LinkedIn).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mock.invoke }, from: vi.fn(), rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/comercial", () => ({ listarCampanhas: () => Promise.resolve([{ id: "11111111-1111-4111-8111-111111111111", name: "Halloween da casa" }]) }));

import MaquinaDeLeads from "@/components/comercial/MaquinaDeLeads";
import { custoDaAvaliacao, estadoDaBusca, telefoneLegivel } from "@/lib/comercial/maquinaApi";
import { chavesDoContato, leadDoCandidato, NIVEIS_DE_ENCAIXE, normalizarBusca, notaDoEncaixe, perguntasDoJev } from "../../supabase/functions/comercial-leads/regras";

const BUSCA = "22222222-2222-4222-8222-222222222222";
const CAMP = "11111111-1111-4111-8111-111111111111";
const busca = (m: Record<string, unknown> = {}) => ({ id: BUSCA, nicho: "Pizzaria", cidade: "Curitiba", uf: "PR", fontes: ["osm", "sites"], limite: 50, situacao: "pronta", erro: null, encontrados: 2, progresso: null, campanha_id: null, entregar_ao_mercurio: false, created_at: "2026-10-25T14:00:00Z", terminado_em: null, ...m });
const cand = (id: string, m: Record<string, unknown> = {}) => ({ id, busca_id: BUSCA, nome: `Pizzaria ${id}`, categoria: "restaurant", site: "https://p.com.br", telefone: "+554133334444", whatsapp: "+5541999887766", email: null, instagram: "pizzariax", endereco: null, cidade: null, fonte: "osm", fonte_url: "https://www.openstreetmap.org/node/1", evidencias: [{ campo: "whatsapp", valor: "+5541999887766", fonte: "site", url: "https://p.com.br/contato" }], nota: null, porque: null, situacao: "novo", lead_id: null, ...m });

describe("regras da Máquina de leads", () => {
  it("a busca: fontes conhecidas, teto de 300, UF válida, lista pede sites e nicho e cidade sem lista", () => {
    const r = normalizarBusca({ nicho: " pizzaria ", cidade: "Curitiba", uf: "pr", limite: 999, fontes: ["osm", "google", "osm"], campanha_id: "x" });
    expect(r).toEqual({ busca: { nicho: "pizzaria", cidade: "Curitiba", uf: "PR", fontes: ["osm"], limite: 300, campanha_id: null, entregar_ao_mercurio: false, urls: [] } });
    expect(normalizarBusca({ nicho: "x", cidade: "Curitiba" })).toEqual({ erro: "Diga o nicho (ex.: pizzaria, dentista, pet shop)." });
    expect(normalizarBusca({ fontes: ["lista"] })).toEqual({ erro: "Cole pelo menos um site para a fonte de sites colados." });
    const so = normalizarBusca({ fontes: ["lista"], urls: "empresa.com.br\nhttps://outra.com.br/x  lixo" });
    expect("busca" in so && so.busca.urls).toEqual(["empresa.com.br", "https://outra.com.br/x"]);
    expect("busca" in so && so.busca.nicho).toBe("Sites colados");
  });

  it("o Jev: uma pergunta Score por candidato, níveis do pior ao melhor, e a nota de 0 a 10", () => {
    const q = perguntasDoJev(2);
    expect(Object.keys(q)).toEqual(["encaixe_0", "encaixe_1"]);
    expect(q.encaixe_1.type).toBe("score");
    expect(q.encaixe_1.criteria).toBe(NIVEIS_DE_ENCAIXE);
    expect(q.encaixe_1.instructions).toContain("`candidatos[1]`");
    expect(notaDoEncaixe(4)).toMatchObject({ nota: 10 });
    expect(notaDoEncaixe(2).nota).toBe(5);
    expect(notaDoEncaixe(null)).toEqual({ nota: null, porque: null });
    expect(notaDoEncaixe(3).porque).toMatch(/^Bom encaixe:/);
  });

  it("o lead do CRM: origem maquina_de_leads, contato, contexto com a fonte e o Mercúrio só quando pedido", () => {
    const l = leadDoCandidato(cand("a", { nota: 8 }) as never, { id: BUSCA, nicho: "Pizzaria", cidade: "Curitiba", uf: "PR", campanha_id: CAMP }, { mercurio: true, criadoPor: "u" });
    expect(l).toMatchObject({ origin: "maquina_de_leads", stage: "novo", whatsapp: "+5541999887766", campaign_id: CAMP, agente_slug: "mercurio" });
    expect(l.qualificacao.origem_dos_dados).toEqual(["https://www.openstreetmap.org/node/1", "https://p.com.br"]);
    expect(l.notes).toContain("Encaixe pelo Jev: 8 de 10");
    const sem = leadDoCandidato(cand("b") as never, { id: BUSCA, nicho: "P", cidade: "C", uf: null, campanha_id: null }, { mercurio: false, criadoPor: null });
    expect("agente_slug" in sem).toBe(false);
    expect(chavesDoContato({ whatsapp: "+55 (41) 99988-7766", company: "Pizzaria Nápoli" })).toEqual({ fone: "99887766", email: "", nome: "pizzarianapoli" });
  });

  it("a tela em palavras: andamento, telefone legível e o custo antes", () => {
    expect(estadoDaBusca(busca({ situacao: "rodando", progresso: { etapa: "Lendo os sites", feitos: 3, total: 20 } }) as never)).toBe("Lendo os sites · 3 de 20");
    expect(estadoDaBusca(busca({ situacao: "falhou", erro: "não achei a cidade" }) as never)).toBe("não achei a cidade");
    expect(telefoneLegivel("+5541999887766")).toBe("(41) 99988-7766");
    expect(custoDaAvaliacao(41)).toBeCloseTo(0.0015, 6);
  });
});

describe("as travas do buscador (código)", () => {
  const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
  it("sem disfarce, com robots.txt e sem Google, Instagram nem LinkedIn como fonte", () => {
    const fontes = ler("workers/leads/fontes.py");
    expect(fontes).toContain("impersonate=None, stealthy_headers=False");
    expect(fontes).toContain("RobotFileParser");
    expect(fontes).toContain('UA = "AceleriqLeads/1.0');
    const tudo = ["workers/leads/fontes.py", "workers/leads/buscar.py", "workers/leads/extrair.py"].map(ler).join("\n");
    expect(tudo).not.toMatch(/StealthyFetcher|DynamicFetcher|solve_cloudflare|proxy_rotator/);
    expect(tudo).not.toMatch(/google\.com\/maps|maps\.googleapis|linkedin\.com\/in|instagram\.com\/api/);
  });
  it("o motor leads no supervisor e no banco", () => {
    expect(ler("workers/supervisor/config.ts")).toContain('export const MOTORES: IdDoMotor[] = ["render", "codigo", "navegador", "leads"];');
    expect(ler("supabase/migrations/20261025110000_motor_de_leads.sql")).toContain("ARRAY['render', 'codigo', 'navegador', 'leads']");
  });
});

// ------------------------------------------------------------------ tela

const corpos = (acao: string) => mock.invoke.mock.calls.filter((c) => c[0] === "comercial-leads" && c[1].body.acao === acao).map((c) => c[1].body);

function montar(aoAbrirLead = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(h(QueryClientProvider, { client: qc }, h(MaquinaDeLeads, { aoAbrirLead })));
  return aoAbrirLead;
}

beforeEach(() => {
  mock.invoke.mockReset();
  let lista = [cand("a"), cand("b", { situacao: "importado", lead_id: "33333333-3333-4333-8333-333333333333" })];
  mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
    if (body.acao === "listar_buscas") return { data: { buscas: [busca()] }, error: null };
    if (body.acao === "criar_busca") return { data: { busca: busca({ id: "44444444-4444-4444-8444-444444444444", situacao: "na_fila", nicho: body.nicho }) }, error: null };
    if (body.acao === "candidatos") return { data: { busca: busca(), candidatos: lista }, error: null };
    if (body.acao === "avaliar") {
      lista = lista.map((c) => (c.id === "a" ? { ...c, nota: 8.5, porque: "Bom encaixe: negócio local do tipo certo" } : c));
      return { data: { avaliados: [{ id: "a", nota: 8.5, porque: "Bom encaixe" }], custo_usd: 0.0005 }, error: null };
    }
    if (body.acao === "importar") {
      lista = lista.map((c) => (c.id === "a" ? { ...c, situacao: "importado", lead_id: "55555555-5555-4555-8555-555555555555" } : c));
      return { data: { importados: [{ candidato_id: "a", lead_id: "55555555-5555-4555-8555-555555555555" }], repetidos: [] }, error: null };
    }
    if (body.acao === "descartar") return { data: { candidatos: lista }, error: null };
    return { data: {}, error: null };
  });
});

describe("Máquina de leads (tela)", () => {
  it("nova busca manda nicho, cidade, UF, quantos, fontes, campanha e o Mercúrio", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Nova busca/ }));
    const form = screen.getByRole("region", { name: "Nova busca de leads" });
    fireEvent.change(within(form).getByLabelText("Nicho"), { target: { value: "Pet shop" } });
    fireEvent.change(within(form).getByLabelText("Cidade"), { target: { value: "Joinville" } });
    fireEvent.change(within(form).getByLabelText("UF"), { target: { value: "SC" } });
    fireEvent.click(within(form).getByRole("button", { name: "100" }));
    fireEvent.click(within(form).getByRole("button", { name: "CNPJ (BrasilAPI)" }));
    await within(form).findByRole("option", { name: "Halloween da casa" });
    fireEvent.change(within(form).getByLabelText("Campanha da busca"), { target: { value: CAMP } });
    fireEvent.click(within(form).getByLabelText("Entregar ao Mercúrio"));
    fireEvent.click(within(form).getByRole("button", { name: /Buscar/ }));
    await waitFor(() => expect(corpos("criar_busca").length).toBe(1));
    expect(corpos("criar_busca")[0]).toMatchObject({ nicho: "Pet shop", cidade: "Joinville", uf: "SC", limite: 100, fontes: ["osm", "sites", "cnpj"], campanha_id: CAMP, entregar_ao_mercurio: true, urls: [] });
  });

  it("abre a busca, avalia com o Jev, leva ao CRM com o Mercúrio, mostra a origem e abre o lead do CRM", async () => {
    const abrir = montar();
    fireEvent.click(await screen.findByRole("button", { name: /Abrir a busca Pizzaria em Curitiba/ }));
    const area = await screen.findByRole("region", { name: /Candidatos de Pizzaria em Curitiba/ });
    expect(await within(area).findByText("Pizzaria a")).toBeTruthy();
    expect(within(area).getByRole("link", { name: /WhatsApp de Pizzaria a/ }).getAttribute("href")).toBe("https://wa.me/5541999887766");
    fireEvent.click(within(area).getAllByRole("button", { name: "De onde veio" })[0]);
    expect(within(area).getByRole("link", { name: "site da empresa" }).getAttribute("href")).toBe("https://p.com.br/contato");

    fireEvent.click(within(area).getByRole("button", { name: /Avaliar com Jev/ }));
    await waitFor(() => expect(corpos("avaliar")[0]).toMatchObject({ busca_id: BUSCA, candidato_ids: ["a"] }));
    expect(await within(area).findByLabelText("Encaixe 8.5 de 10")).toBeTruthy();

    fireEvent.click(within(area).getByLabelText("Marcar Pizzaria a"));
    fireEvent.click(within(area).getByLabelText("Mercúrio faz o primeiro contato"));
    fireEvent.click(within(area).getByRole("button", { name: /Levar ao CRM \(1\)/ }));
    await waitFor(() => expect(corpos("importar")[0]).toMatchObject({ busca_id: BUSCA, candidato_ids: ["a"], mercurio: true }));

    fireEvent.click(within(area).getByRole("button", { name: /No CRM 2/ }));
    const noCrm = await within(area).findAllByRole("button", { name: /^No CRM$/ });
    fireEvent.click(noCrm[0]);
    expect(abrir).toHaveBeenCalled();
  });

  it("descarta os marcados e volta pelo filtro Descartados", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Abrir a busca Pizzaria em Curitiba/ }));
    const area = await screen.findByRole("region", { name: /Candidatos de Pizzaria em Curitiba/ });
    fireEvent.click(await within(area).findByLabelText("Marcar Pizzaria a"));
    fireEvent.click(within(area).getByRole("button", { name: "Descartar os marcados" }));
    await waitFor(() => expect(corpos("descartar")[0]).toMatchObject({ candidato_ids: ["a"], voltar: false }));
  });
});
