import { describe, expect, it } from "vitest";
import { itensDaFrente, leiturasDoCliente, montarEsteira, plataformasDoCliente, resumoDeVendas } from "@/lib/esteira/esteiraMontar";
import type { CampanhaFato, FatosDoCliente, VendaFato } from "@/lib/esteira/esteiraTipos";

const HOJE = new Date("2026-09-11T12:00:00Z");

function dia(n: number): string {
  return new Date(HOJE.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

function fatos(over: Partial<FatosDoCliente>): FatosDoCliente {
  return {
    clientId: "c1",
    criadoEm: "2026-01-01T00:00:00Z",
    servicos: { social: false, trafego: true },
    posts: [],
    tarefas: [],
    campanhas: [],
    contasAds: [{ id: "acc-meta", plataforma: "meta_ads", nome: "Conta Meta", ativa: true }],
    vendas: [],
    saldoVerba: 100,
    checklists: [],
    marcos: [],
    conexoes: [{ provider: "meta", status: "connected" }],
    metricas: [],
    briefingRespondido: true,
    dossieResumo: null,
    onboardingHas: {},
    estados: {},
    rituais: [],
    oculto: { areas: [], ate: null },
    ...over,
  };
}

/** Campanha com 14 dias de dado: `agora` nos ultimos 7, `antes` nos 7 anteriores. */
function campanha(id: string, nome: string, agora: { spend: number; leads: number; compras?: number; valor?: number }, antes: { spend: number; leads: number; compras?: number; valor?: number }, plataforma: CampanhaFato["plataforma"] = "meta_ads"): CampanhaFato {
  const diario: CampanhaFato["diario"] = [];
  for (let n = 0; n < 14; n++) {
    const src = n < 7 ? agora : antes;
    diario.push({ day: dia(n), spend: src.spend / 7, leads: n % 7 === 0 ? src.leads : 0, frequency: 1.5, compras: n % 7 === 0 ? (src.compras ?? 0) : 0, valorCompras: n % 7 === 0 ? (src.valor ?? 0) : 0 });
  }
  return { id, nome, ativa: true, plataforma, diario };
}

function venda(over: Partial<VendaFato>): VendaFato {
  return { id: "v1", data: dia(1), plataforma: "meta_ads", campanhaId: "c-a", campanhaNome: "Campanha A", canal: "whatsapp", quantidade: 1, valor: null, origem: "manual", nota: null, ...over };
}

describe("vendas na leitura de trafego", () => {
  it("leads chegando e nenhuma venda vira o primeiro 'o que fazer'", () => {
    const f = fatos({ campanhas: [campanha("c-a", "Campanha A", { spend: 700, leads: 12 }, { spend: 700, leads: 10 })] });
    const e = montarEsteira(f, HOJE);
    const l = e.leituras.find((x) => x.frente === "trafego");
    expect(l?.plataforma).toBe("meta_ads");
    expect(l?.numeros.map((n) => n.rotulo)).toEqual(["Leads (7d)", "Vendas (7d)", "Gasto (7d)", "Custo por lead", "Custo por venda", "Campanhas ativas"]);
    expect(l?.fazer[0]).toMatch(/12 leads e nenhuma venda/);
  });

  it("venda registrada a mao entra na conta, com custo por venda e receita quando ha valor", () => {
    const f = fatos({
      campanhas: [campanha("c-a", "Campanha A", { spend: 700, leads: 12 }, { spend: 700, leads: 10 })],
      vendas: [venda({ id: "v1", valor: 300 }), venda({ id: "v2", data: dia(3), valor: null }), venda({ id: "v3", data: dia(9), valor: 200 })],
    });
    const r7 = resumoDeVendas(f, HOJE, 7, 0, "meta_ads");
    expect(r7.total).toBe(2);
    expect(r7.receita).toBe(300);
    expect(r7.semValor).toBe(1);
    const l = leiturasDoCliente(f, HOJE, [])[0];
    const vendas = l.numeros.find((n) => n.rotulo === "Vendas (7d)");
    expect(vendas?.atual).toBe(2);
    expect(vendas?.anterior).toBe(1);
    expect(vendas?.tendencia).toBe("sobe");
    expect(l.numeros.find((n) => n.rotulo === "Receita (7d)")?.atual).toBe(300);
    expect(l.numeros.find((n) => n.rotulo === "Custo por venda")?.atual).toBe(350);
    expect(l.fazer.some((x) => x.includes("Vendas subiram: escalar 20% a verba de Campanha A"))).toBe(true);
    expect(l.fazer.some((x) => x.includes("1 venda sem valor"))).toBe(true);
  });

  it("compra rastreada pelo pixel soma com a manual e traz o valor sozinha", () => {
    const f = fatos({
      campanhas: [campanha("c-a", "Campanha A", { spend: 700, leads: 5, compras: 3, valor: 900 }, { spend: 700, leads: 5 })],
      vendas: [venda({ id: "v1", valor: 100 })],
    });
    const r7 = resumoDeVendas(f, HOJE, 7, 0, "meta_ads");
    expect(r7.registradas).toBe(1);
    expect(r7.rastreadas).toBe(3);
    expect(r7.total).toBe(4);
    expect(r7.receita).toBe(1000);
    expect(r7.porCampanha[0]).toEqual({ nome: "Campanha A", vendas: 4, receita: 1000 });
  });

  it("leads chegam mas vendas cairam: o problema esta depois do clique", () => {
    const f = fatos({
      campanhas: [campanha("c-a", "Campanha A", { spend: 700, leads: 12 }, { spend: 700, leads: 10 })],
      vendas: [venda({ id: "v1" }), venda({ id: "v2", data: dia(8) }), venda({ id: "v3", data: dia(9) }), venda({ id: "v4", data: dia(10) })],
    });
    const l = leiturasDoCliente(f, HOJE, [])[0];
    expect(l.fazer.some((x) => x.includes("depois do clique"))).toBe(true);
  });

  it("campanha que vende o dobro das outras pede concentrar verba", () => {
    const f = fatos({
      campanhas: [campanha("c-a", "Campanha A", { spend: 350, leads: 6 }, { spend: 350, leads: 6 }), campanha("c-b", "Campanha B", { spend: 350, leads: 6 }, { spend: 350, leads: 6 })],
      vendas: [venda({ id: "v1", quantidade: 4 }), venda({ id: "v2", campanhaId: "c-b", campanhaNome: "Campanha B", quantidade: 1 })],
    });
    const l = leiturasDoCliente(f, HOJE, [])[0];
    expect(l.fazer.some((x) => x.startsWith("Campanha A vende mais que o resto (4 contra 1)"))).toBe(true);
  });
});

describe("plataformas de anuncio separadas", () => {
  it("Meta e Google ganham leituras proprias e os itens de campanha carregam a plataforma", () => {
    const f = fatos({
      contasAds: [
        { id: "acc-meta", plataforma: "meta_ads", nome: "Meta", ativa: true },
        { id: "acc-google", plataforma: "google_ads", nome: "Google", ativa: true },
      ],
      campanhas: [
        campanha("c-m", "Meta A", { spend: 700, leads: 10 }, { spend: 700, leads: 10 }),
        campanha("c-g", "Google A", { spend: 300, leads: 0 }, { spend: 300, leads: 2 }, "google_ads"),
      ],
      vendas: [venda({ id: "v1", campanhaId: "c-m", campanhaNome: "Meta A" })],
    });
    const e = montarEsteira(f, HOJE);
    const meta = e.leituras.find((l) => l.plataforma === "meta_ads");
    const google = e.leituras.find((l) => l.plataforma === "google_ads");
    expect(meta?.numeros.find((n) => n.rotulo === "Leads (7d)")?.atual).toBe(10);
    expect(google?.numeros.find((n) => n.rotulo === "Leads (7d)")?.atual).toBe(0);
    expect(meta?.numeros.find((n) => n.rotulo === "Vendas (7d)")?.atual).toBe(1);
    expect(google?.numeros.find((n) => n.rotulo === "Vendas (7d)")?.atual).toBe(0);
    const semLead = itensDaFrente(e, "trafego").find((i) => i.key === "camp:c-g:sem-lead");
    expect(semLead?.plataforma).toBe("google_ads");
  });

  it("resume o estado de cada plataforma: ativa, ligada sem campanha, nao configurada", () => {
    const f = fatos({
      contasAds: [
        { id: "acc-meta", plataforma: "meta_ads", nome: "Meta", ativa: true },
        { id: "acc-google", plataforma: "google_ads", nome: "Google", ativa: true },
      ],
      campanhas: [campanha("c-m", "Meta A", { spend: 700, leads: 10 }, { spend: 700, leads: 10 })],
      vendas: [venda({ id: "v1", quantidade: 2 })],
    });
    const p = plataformasDoCliente(f, HOJE);
    expect(p.map((x) => [x.key, x.estado])).toEqual([["meta_ads", "ativa"], ["google_ads", "ligada"], ["tiktok_ads", "nao-configurada"]]);
    expect(p[0].vendas7d).toBe(2);
    expect(p[0].ativas).toBe(1);
  });

  it("conta cadastrada mas inativa aparece como pausada", () => {
    const f = fatos({ contasAds: [{ id: "acc-meta", plataforma: "meta_ads", nome: "Meta", ativa: false }] });
    expect(plataformasDoCliente(f, HOJE)[0].estado).toBe("pausada");
  });
});
