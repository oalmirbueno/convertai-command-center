import { describe, expect, it } from "vitest";
import {
  aplicarSugestaoNoCanvas,
  complementarCampanha,
  mesclarNoCanvas,
  pedidoDoCanvas,
  projetarCampanha,
  sincDoNo,
  sincronizar,
  type CampanhaDaPonte,
  type CanvasDaPonte,
  type ItemDaPonte,
} from "../../supabase/functions/ponte-lab-campanha/modulos/regras";
import { calcularLinhaDoTempo } from "../../supabase/functions/agente-calendario/modulos/linha-do-tempo";
import { errosDoCanvas } from "../../supabase/functions/laboratorio/modulos/regras";

/**
 * Ponte Laboratório ↔ Campanhas (25/10/2026): campanha vira canvas, canvas complementa a campanha, nada é
 * substituído (o que difere vira sugestão), a pessoa não perde nó, a segunda passada não muda nada (o eco
 * dos gatilhos termina), o teto de 80 nós agrupa e a peça protegida não muda.
 */

const CAMP = "44444444-4444-4444-8444-444444444444";
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const MARCA = "55555555-5555-4555-8555-555555555555";

const linha = calcularLinhaDoTempo({ esquema: "halloween", evento: "2026-10-31", diasAntes: 10, hoje: "2026-10-01" });

function campanha(b: Record<string, unknown> = {}): CampanhaDaPonte {
  return {
    id: CAMP,
    client_id: CLIENTE,
    nome: "Halloween do PC",
    objetivo: "Vender a limpeza do PC",
    conceito: "O PC assombrado",
    periodo_inicio: linha.inicio,
    periodo_fim: linha.fim,
    identidade: { marca_id: MARCA },
    briefing: {
      oferta: "Limpeza completa por R$ 89",
      mensagem_central: "Seu PC está assombrado?",
      publico: "Gamers de Curitiba",
      produtos: [{ nome: "Limpeza completa", preco: "89", link: "" }],
      linha_do_tempo: linha,
      ...b,
    },
    sincronia: {},
  };
}

const itens = (): ItemDaPonte[] => [
  { tema_id: "c1", data: linha.fases[0].inicio, formato: "carrossel", tema: "5 sinais de PC assombrado", gancho: "Travou?", cards: [{ ordem: 1, texto: "a" }, { ordem: 2, texto: "b" }] },
  { tema_id: "c2", data: linha.fases[1].inicio, formato: "estatico", tema: "Exorcismo por R$ 89", cards: [{ ordem: 1, texto: "x" }] },
  { tema_id: "c3", data: linha.fases[2].inicio, formato: "video", tema: "Reels do PC", gancho: "Ele grita", task_id: "t-agenda" },
];

const vazio = (): CanvasDaPonte => ({ nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } });
const no = (c: CanvasDaPonte, chave: string) => c.nos.filter((n) => sincDoNo(n) && (sincDoNo(n) as { chave: string }).chave === chave)[0];

describe("ponte: campanha vira canvas", () => {
  it("projeta cliente, marca, produto, público, oferta, funil e uma peça por nó, com ligações válidas", () => {
    const r = mesclarNoCanvas(vazio(), campanha(), itens());
    const chaves = r.chaves.slice().sort();
    expect(chaves).toEqual(["cliente", "funil", "marca", "oferta", "peca:c1", "peca:c2", "peca:c3", "produto:0", "publico"].sort());
    expect(no(r.canvas, "oferta").dados).toMatchObject({ titulo: "Halloween do PC", produto: "Limpeza completa", preco: "89" });
    expect(String(no(r.canvas, "oferta").dados.instrucao)).toContain("R$ 89");
    expect(no(r.canvas, "peca:c1").tipo).toBe("carrossel");
    expect(no(r.canvas, "peca:c2").tipo).toBe("template_designer");
    expect(no(r.canvas, "peca:c3").tipo).toBe("filme");
    // As peças ficam na coluna da fase delas (fase 1 à esquerda da fase 2).
    expect(no(r.canvas, "peca:c1").x).toBeLessThan(no(r.canvas, "peca:c2").x);
    expect(r.canvas.ligacoes.length).toBeGreaterThan(5);
    expect(errosDoCanvas(r.canvas as never)).toEqual([]);
    expect(r.resumo.nos_novos).toBe(9);
  });

  it("segunda passada sem mudança não muda nada (o eco termina)", () => {
    const a = sincronizar(vazio(), campanha(), itens(), {});
    const b = sincronizar(a.canvas, a.campanha, a.itens, {});
    expect(b.canvasMudou).toBe(false);
    expect(b.campanhaMudou).toBe(false);
    expect(b.itensMudaram).toBe(false);
    expect(b.sugestoes).toEqual([]);
  });

  it("nó que a pessoa não mexeu acompanha a campanha; o que ela pôs fica", () => {
    const a = mesclarNoCanvas(vazio(), campanha(), itens());
    a.canvas.nos.push({ id: "meu", tipo: "contexto", x: 0, y: 900, dados: { titulo: "Nota minha", texto: "não apague" } });
    const c2 = campanha({ publico: "Gamers e home office de Curitiba" });
    const b = mesclarNoCanvas(a.canvas, c2, itens());
    expect(no(b.canvas, "publico").dados.publico).toBe("Gamers e home office de Curitiba");
    expect(b.canvas.nos.some((n) => n.id === "meu")).toBe(true);
    expect(b.sugestoes).toEqual([]);
  });

  it("campo que a pessoa mudou no canvas e a campanha também mudou vira sugestão para o canvas, sem trocar", () => {
    const a = mesclarNoCanvas(vazio(), campanha(), itens());
    no(a.canvas, "publico").dados.publico = "Só gamers";
    const b = mesclarNoCanvas(a.canvas, campanha({ publico: "Gamers e escritórios" }), itens());
    expect(no(b.canvas, "publico").dados.publico).toBe("Só gamers");
    expect(b.sugestoes).toEqual([expect.objectContaining({ destino: "canvas", chave: "no:publico:publico", valor_sugerido: "Gamers e escritórios" })]);
    const aceita = aplicarSugestaoNoCanvas(b.canvas, CAMP, "no:publico:publico", "Gamers e escritórios");
    expect(aceita.ok).toBe(true);
    expect(no(aceita.canvas, "publico").dados.publico).toBe("Gamers e escritórios");
  });

  it("nó que a pessoa apagou não volta; peça que saiu da campanha fica marcada", () => {
    const a = sincronizar(vazio(), campanha(), itens(), {});
    a.canvas.nos = a.canvas.nos.filter((n) => !(sincDoNo(n) && (sincDoNo(n) as { chave: string }).chave === "produto:0"));
    const b = sincronizar(a.canvas, a.campanha, itens().slice(0, 2), {});
    expect(no(b.canvas, "produto:0")).toBeUndefined();
    expect((b.campanha.sincronia as { removidas: string[] }).removidas).toContain("produto:0");
    expect((sincDoNo(no(b.canvas, "peca:c3")) as { fora?: boolean }).fora).toBe(true);
  });

  it("teto de 80 nós: as peças que não cabem ficam agrupadas por fase, com aviso", () => {
    const muitos: ItemDaPonte[] = Array.from({ length: 90 }, (_x, k) => ({ tema_id: `c${k + 1}`, data: linha.fases[k % linha.fases.length].inicio, formato: "estatico", tema: `Peça ${k + 1}` }));
    const r = mesclarNoCanvas(vazio(), campanha(), muitos);
    expect(r.canvas.nos.length).toBeLessThanOrEqual(80);
    expect(r.canvas.nos.some((n) => String(n.dados.titulo).indexOf("peças desta fase") >= 0)).toBe(true);
    expect(r.avisos.join(" ")).toContain("80 nós");
  });
});

describe("ponte: canvas complementa a campanha", () => {
  it("nó de conteúdo novo vira peça na série, na fase da coluna, e ganha a marca (sem duplicar)", () => {
    const a = sincronizar(vazio(), campanha(), itens(), {});
    const xDaFase2 = no(a.canvas, "peca:c2").x;
    a.canvas.nos.push({ id: "novo", tipo: "carrossel", x: xDaFase2, y: 1200, dados: { tema: "Mitos da limpeza", laminas: 4 } });
    const b = sincronizar(a.canvas, a.campanha, a.itens, {});
    const nova = b.itens.filter((i) => i.tema === "Mitos da limpeza")[0];
    expect(nova).toMatchObject({ tema_id: "c4", formato: "carrossel", data: linha.fases[1].inicio, etapa: linha.fases[1].etapa, campanha_id: CAMP });
    expect(nova.cards && nova.cards.length).toBe(4);
    expect((sincDoNo(b.canvas.nos.filter((n) => n.id === "novo")[0]) as { chave: string }).chave).toBe("peca:c4");
    expect(b.canvas.nos.filter((n) => sincDoNo(n) && (sincDoNo(n) as { chave: string }).chave === "peca:c4").length).toBe(1);
    const c = sincronizar(b.canvas, b.campanha, b.itens, {});
    expect(c.itensMudaram || c.canvasMudou || c.campanhaMudou).toBe(false);
  });

  it("campo vazio na campanha é preenchido; com valor, a mudança do canvas vira sugestão para a campanha", () => {
    const sem = campanha({ publico: "" });
    const a = sincronizar(vazio(), sem, itens(), {});
    const avatar = { id: "av", tipo: "avatar", x: 0, y: 2000, dados: { publico: "Donos de PC gamer" } };
    // O canvas não tinha nó de público (campanha sem público): o avatar avulso é adotado e preenche.
    a.canvas.nos.push(avatar);
    const b = sincronizar(a.canvas, a.campanha, a.itens, {});
    expect((b.campanha.briefing as { publico: string }).publico).toBe("Donos de PC gamer");
    expect(b.resumo.campos_preenchidos).toBeGreaterThan(0);
    // Agora a pessoa muda a oferta no canvas: a campanha já tem oferta, então vira sugestão.
    no(b.canvas, "oferta").dados.instrucao = "Limpeza e troca de pasta térmica por R$ 129";
    const c = sincronizar(b.canvas, b.campanha, b.itens, {});
    expect((c.campanha.briefing as { oferta: string }).oferta).toBe("Limpeza completa por R$ 89");
    expect(c.sugestoes).toEqual(expect.arrayContaining([expect.objectContaining({ destino: "campanha", chave: "campanha:briefing.oferta", valor_sugerido: "Limpeza e troca de pasta térmica por R$ 129" })]));
  });

  it("peça protegida (na agenda) não muda pelo canvas", () => {
    const a = sincronizar(vazio(), campanha(), itens(), {});
    no(a.canvas, "peca:c3").dados.titulo = "Outro tema";
    const r = complementarCampanha(a.canvas, a.campanha, a.itens, {});
    expect(r.itens.filter((i) => i.tema_id === "c3")[0].tema).toBe("Reels do PC");
    expect(r.sugestoes.filter((s) => s.chave.indexOf("itens.c3") >= 0)).toEqual([]);
    expect(r.avisos.join(" ")).toContain("agenda");
  });

  it("produto avulso e canais do funil só somam", () => {
    const a = sincronizar(vazio(), campanha(), itens(), {});
    a.canvas.nos.push({ id: "p2", tipo: "produto", x: 0, y: 3000, dados: { nome: "Pasta térmica", preco: "39" } });
    a.canvas.nos.push({ id: "wpp", tipo: "whatsapp", x: 0, y: 3200, dados: {} });
    const b = sincronizar(a.canvas, a.campanha, a.itens, {});
    const prods = (b.campanha.briefing as { produtos: Array<{ nome: string }> }).produtos.map((p) => p.nome);
    expect(prods).toEqual(["Limpeza completa", "Pasta térmica"]);
    expect((b.campanha.briefing as { canais: string[] }).canais).toContain("whatsapp");
  });

  it("monta o pedido da campanha a partir do canvas (oferta, público, funil, produtos e formatos)", () => {
    const c: CanvasDaPonte = {
      nos: [
        { id: "o", tipo: "oferta", x: 0, y: 0, dados: { titulo: "Black do PC", instrucao: "Limpeza por R$ 89" } },
        { id: "a", tipo: "avatar", x: 0, y: 0, dados: { publico: "Gamers" } },
        { id: "f", tipo: "funil", x: 0, y: 0, dados: { objetivo: "Vender limpezas" } },
        { id: "p", tipo: "produto", x: 0, y: 0, dados: { nome: "Limpeza", preco: "89" } },
        { id: "k", tipo: "carrossel", x: 0, y: 0, dados: {} },
        { id: "v", tipo: "filme", x: 0, y: 0, dados: {} },
        { id: "s", tipo: "template_designer", x: 0, y: 0, dados: { formato_arte: "story_9_16" } },
      ],
      ligacoes: [],
    };
    const p = pedidoDoCanvas(c, { f: { saida: { json: { etapas: [{ nome: "Aquecimento" }, { nome: "Oferta" }] } } } }, "Projeto X");
    expect(p.nome).toBe("Black do PC");
    expect(p.formatos).toEqual({ posts: 0, carrosseis: 1, stories: 1, videos: 1 });
    expect(p.pedido).toContain("Gamers");
    expect(p.pedido).toContain("Aquecimento > Oferta");
    expect(p.briefing).toMatchObject({ oferta: "Limpeza por R$ 89", publico: "Gamers", produtos: [{ nome: "Limpeza", preco: "89" }] });
  });

  it("a projeção é a mesma conta para a tela e a função (sem lookbehind nem travessão)", () => {
    const p = projetarCampanha(campanha(), itens());
    expect(p.length).toBe(9);
    expect(JSON.stringify(p).indexOf("—")).toBe(-1);
  });
});
