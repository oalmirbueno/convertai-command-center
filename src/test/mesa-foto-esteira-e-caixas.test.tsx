import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Foto, 02/10/2026 (dono: "quando eu abrir, a esteira do que está pronto
 * já puxando a direção de foto certa" e "várias caixas de resultado na mesma
 * tela, ligar uma na outra e fazer várias variações"). Fixa:
 * - o contrato das peças de foto (calendario_propostas.itens com formato
 *   "foto" e a direção em item.foto), com padrão para o que faltar e a pronta
 *   não gravada marcada;
 * - o endereço direto ?peca= e ?task= (fora da etapa agenda);
 * - as operações das caixas no quadro (nova, duplicar, variar, conectar,
 *   apagar) e a peça levada ao Canvas;
 * - as opções novas do Resultado no pedido ao gerador;
 * - a barra do quadro e a esteira na tela.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn(),
    from: () => ({}),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x/y.png" }, error: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import {
  ANGULOS_PADRAO,
  janelaDasPecas,
  lerChaveDaPeca,
  normalizarDirecaoDaFoto,
  pecasDeFotoDasPropostas,
} from "../../supabase/functions/mesa-foto/modulos/pecas-de-foto";
import { cameraPeloTexto, lerVariacoes, linhasDasOpcoes, luzPeloTexto, proximaCamera } from "../../supabase/functions/mesa-foto/modulos/opcoes-do-resultado";
import { dadosDoNo, promptDoCanvas } from "../../supabase/functions/mesa-foto/canvas-regras";
import { acharPeca, direcaoParaOCanvas, lerPecaDoEndereco, lerPecaLevadaAoCanvas, levarPecaAoCanvas, normalizarPecasDeFoto, pedidoAoDiretorDaPeca } from "@/components/mesa-foto/pecasDeFoto";
import { apagarCaixa, caixaDaPeca, conectarCaixas, duplicarCaixa, novaCaixa, podeConectarCaixas, variarEmCaixaNova } from "@/components/mesa-foto/canvas/caixas";
import { canvasVazio, dadosParaAFuncao, entradasDoGerar, ligar, normalizarCanvas, novoNo, type Canvas, type ResultadoDoCanvas } from "@/components/mesa-foto/canvasApi";
import { BarraDoQuadro } from "@/components/mesa-foto/canvas/BarraDoQuadro";
import EsteiraDoMes from "@/components/mesa-foto/EsteiraDoMes";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const P1 = "aaaaaaaa-0000-4000-8000-000000000001";
const P2 = "aaaaaaaa-0000-4000-8000-000000000002";
const TASK = "bbbbbbbb-0000-4000-8000-000000000009";
const HOJE = new Date("2026-10-02T15:00:00Z");

const propostas = [
  {
    id: P2,
    status: "pronta",
    itens: [
      // Mesma peça da gravada (data e título): fica só a gravada.
      { data: "2026-10-12", titulo: "Óculos na praia", formato: "foto", foto: { assunto: "repetida" } },
      // Sem direção nenhuma: padrão.
      { data: "2026-11-03", tema: "Novembro azul", formato: "Foto" },
      { data: "2026-10-20", titulo: "Reels do mês", formato: "reels" },
    ],
  },
  {
    id: P1,
    status: "gravada",
    itens: [
      { data: "2026-10-05", titulo: "Post de texto", formato: "carrossel" },
      {
        data: "2026-10-12",
        titulo: "Óculos na praia",
        tema: "Verão",
        formato: "foto",
        task_id: TASK,
        foto: { assunto: "Óculos Aurora na areia", objetivo: "vender", angulos: ["Frontal", "3/4", "Detalhe na haste"], cenario: "praia ao fim da tarde", luz: "golden hour", pessoa: "mulher de 30 anos", quantidade: 3, texto_na_foto: "Novo Aurora", referencias: ["https://ref.test/1"] },
      },
      // Fora da janela (dezembro): não entra.
      { data: "2026-12-10", titulo: "Natal", formato: "foto", foto: { assunto: "árvore" } },
      { data: "2026-10-08", titulo: "Detalhe da lente", formato: "foto", foto: { angulos: "frontal, lateral", quantidade: "0" } },
    ],
  },
  { id: "nao-e-uuid", status: "gravada", itens: [{ formato: "foto" }] },
  { id: "cccccccc-0000-4000-8000-000000000003", status: "rascunho", itens: [{ formato: "foto", data: "2026-10-10" }] },
];

// ------------------------------------------------------------------ contrato das peças

describe("peças de foto do mês: contrato", () => {
  it("janela do mês atual ao fim do próximo, no horário de Brasília", () => {
    expect(janelaDasPecas(HOJE)).toEqual({ inicio: "2026-10-01", fim: "2026-11-30" });
    // 1º de novembro às 01:00 UTC ainda é 31/10 em Brasília.
    expect(janelaDasPecas(new Date("2026-11-01T01:00:00Z"))).toEqual({ inicio: "2026-10-01", fim: "2026-11-30" });
    expect(janelaDasPecas(new Date("2026-12-15T12:00:00Z"))).toEqual({ inicio: "2026-12-01", fim: "2027-01-31" });
  });

  it("só itens de foto na janela; gravadas primeiro; a pronta entra como não gravada; repetida fica a gravada", () => {
    const pecas = pecasDeFotoDasPropostas(propostas, HOJE);
    expect(pecas.map((p) => [p.chave, p.gravada, p.data])).toEqual([
      [`${P1}:3`, true, "2026-10-08"],
      [`${P1}:1`, true, "2026-10-12"],
      [`${P2}:1`, false, "2026-11-03"],
    ]);
    const praia = pecas[1];
    expect(praia.task_id).toBe(TASK);
    expect(praia.foto).toEqual({
      assunto: "Óculos Aurora na areia",
      objetivo: "vender",
      angulos: ["Frontal", "3/4", "Detalhe na haste"],
      cenario: "praia ao fim da tarde",
      luz: "golden hour",
      pessoa: "mulher de 30 anos",
      quantidade: 3,
      texto_na_foto: "Novo Aurora",
      referencias: ["https://ref.test/1"],
    });
  });

  it("direção que falta ganha padrão sensato", () => {
    const pecas = pecasDeFotoDasPropostas(propostas, HOJE);
    const novembro = pecas.find((p) => p.chave === `${P2}:1`)!;
    expect(novembro.titulo).toBe("Novembro azul");
    expect(novembro.foto).toEqual({ assunto: "Novembro azul", objetivo: "", angulos: ANGULOS_PADRAO, cenario: "", luz: "Natural", pessoa: null, quantidade: 3, texto_na_foto: null, referencias: [] });
    // Ângulos em texto viram lista; quantidade inválida sai dos ângulos.
    const lente = pecas.find((p) => p.chave === `${P1}:3`)!;
    expect(lente.foto.angulos).toEqual(["frontal", "lateral"]);
    expect(lente.foto.quantidade).toBe(2);
    expect(normalizarDirecaoDaFoto({ quantidade: 99 }).quantidade).toBe(12);
    expect(normalizarDirecaoDaFoto({ quantidade: 1 }).angulos).toEqual(["Frontal"]);
    expect(normalizarDirecaoDaFoto(null, { titulo: "Título do item" }).assunto).toBe("Título do item");
  });

  it("a tela confere de novo o que chegou da função (forma errada fica de fora)", () => {
    const pecas = normalizarPecasDeFoto({ pecas: [...pecasDeFotoDasPropostas(propostas, HOJE), { proposta_id: "x", indice: 1 }, null, { proposta_id: P1, indice: -1 }] });
    expect(pecas).toHaveLength(3);
    expect(normalizarPecasDeFoto(null)).toEqual([]);
    expect(normalizarPecasDeFoto({ pecas: "nada" })).toEqual([]);
  });

  it("a ação pecas_de_foto lê com a checagem de acesso do cliente e está registrada", () => {
    const modulo = readFileSync(resolve(__dirname, "../../supabase/functions/mesa-foto/modulos/acao-pecas-de-foto.ts"), "utf8");
    const corpo = modulo.slice(modulo.indexOf("async function pecasDeFoto"), modulo.indexOf("return { pecas_de_foto"));
    expect(corpo).toContain("await f.garantirAcesso(ch, clientId)");
    expect(corpo.indexOf("garantirAcesso")).toBeLessThan(corpo.indexOf('from("calendario_propostas")'));
    expect(corpo).toContain('.eq("client_id", clientId)');
    expect(corpo).toContain('.in("status", ["pronta", "gravada"])');
    expect(readFileSync(resolve(__dirname, "../../supabase/functions/mesa-foto/index.ts"), "utf8")).toContain("...acoesDasPecasDeFoto(FERRAMENTAS),");
  });
});

// ------------------------------------------------------------------ endereço direto

describe("peças de foto: endereço direto", () => {
  const p = (q: string) => new URLSearchParams(q);
  it("?peca=<proposta>:<indice> e ?task= (fora da agenda)", () => {
    expect(lerPecaDoEndereco(p(`peca=${P1}:1`))).toEqual({ tipo: "peca", proposta_id: P1, indice: 1 });
    expect(lerPecaDoEndereco(p(`peca=${P1.toUpperCase()}:12`))).toEqual({ tipo: "peca", proposta_id: P1, indice: 12 });
    expect(lerPecaDoEndereco(p(`task=${TASK}`))).toEqual({ tipo: "task", task_id: TASK });
    expect(lerPecaDoEndereco(p(`etapa=criar&task=${TASK}`))).toEqual({ tipo: "task", task_id: TASK });
    // Na etapa agenda o task= é o post da Agenda.
    expect(lerPecaDoEndereco(p(`etapa=agenda&task=${TASK}`))).toBeNull();
    expect(lerPecaDoEndereco(p("peca=abc:1"))).toBeNull();
    expect(lerPecaDoEndereco(p(`peca=${P1}`))).toBeNull();
    expect(lerPecaDoEndereco(p("task=123"))).toBeNull();
    expect(lerChaveDaPeca(`${P1}:x`)).toBeNull();
  });

  it("acha a peça pela chave ou pelo task_id", () => {
    const pecas = pecasDeFotoDasPropostas(propostas, HOJE);
    expect(acharPeca(pecas, { tipo: "peca", proposta_id: P1, indice: 1 })!.titulo).toBe("Óculos na praia");
    expect(acharPeca(pecas, { tipo: "task", task_id: TASK })!.chave).toBe(`${P1}:1`);
    expect(acharPeca(pecas, { tipo: "peca", proposta_id: P1, indice: 7 })).toBeNull();
    expect(acharPeca(pecas, null)).toBeNull();
  });

  it("o pedido ao diretor e a caixa do Canvas levam a direção", () => {
    const praia = pecasDeFotoDasPropostas(propostas, HOJE)[1];
    const pedido = pedidoAoDiretorDaPeca(praia);
    expect(pedido).toContain("Assunto: Óculos Aurora na areia.");
    expect(pedido).toContain("Quantidade: 3 fotos, nos ângulos: Frontal, 3/4, Detalhe na haste.");
    expect(pedido).toContain("Cenário: praia ao fim da tarde.");
    expect(pedido).toContain("Pessoa: mulher de 30 anos.");
    expect(pedido).toContain('Deixe respiro para o texto "Novo Aurora"');
    expect(pedido).not.toMatch(/—/);
    const d = direcaoParaOCanvas(praia, "kit-1");
    expect(d).toMatchObject({ cenario: "praia ao fim da tarde", camera: "frontal", luz: "dourada", variacoes: 2, kit_id: "kit-1" });
    expect(d.pedido).toContain("Ângulos da série: Frontal, 3/4, Detalhe na haste.");
  });

  it("a peça levada ao Canvas é lida uma vez só", () => {
    const praia = pecasDeFotoDasPropostas(propostas, HOJE)[1];
    levarPecaAoCanvas(CLIENTE, praia);
    expect(lerPecaLevadaAoCanvas(CLIENTE)!.chave).toBe(praia.chave);
    expect(lerPecaLevadaAoCanvas(CLIENTE)).toBeNull();
  });
});

// ------------------------------------------------------------------ caixas no quadro

const foto = (id: string, imagem: string): ResultadoDoCanvas => ({
  geracao_id: id, imagem_id: imagem, storage_bucket: "mesa", storage_path: `c/${imagem}.png`, url: "", motor_id: "m1", status: "gerada", erro: "", custo_usd: 0, conferencia: null, criado_em: "", grupo: null, quadro: null, tipo: "foto",
});

function quadroBase(): Canvas {
  let c = canvasVazio(CLIENTE);
  const g = { ...novoNo("gerar", 400, 0, { motores: ["m1"], formato: "9:16", camera: "frontal", luz: "natural", variacoes: 4 }), id: "g1" };
  const prod = { ...novoNo("produto", 0, 0, { kit_id: "kit-1" }), id: "p1" };
  const texto = { ...novoNo("texto", 0, 120, { texto: "na mesa", papel: "pedido" }), id: "t1" };
  c = { ...c, nos: [g, prod, texto] };
  c = ligar(c, "p1", "g1");
  c = ligar(c, "t1", "g1");
  return c;
}

describe("caixas de resultado no mesmo quadro", () => {
  it("nova caixa entra embaixo, com os motores", () => {
    const c = novaCaixa(quadroBase(), "g2", { motores: ["m1"] });
    const g2 = c.nos.find((n) => n.id === "g2")!;
    expect(g2.tipo).toBe("gerar");
    expect(g2.dados.motores).toEqual(["m1"]);
    expect(g2.y).toBeGreaterThan(0);
    expect(c.ligacoes.some((l) => l.para === "g2")).toBe(false);
  });

  it("duplicar copia ajustes e entradas, sem as fotos", () => {
    let c = quadroBase();
    c = { ...c, nos: c.nos.map((n) => (n.id === "g1" ? { ...n, dados: { ...n.dados, resultados: [foto("r1", "img-1")] } } : n)) };
    const d = duplicarCaixa(c, "g1", "g2");
    const g2 = d.nos.find((n) => n.id === "g2")!;
    expect(g2.dados).toMatchObject({ formato: "9:16", camera: "frontal", luz: "natural", variacoes: 4, resultados: [] });
    expect(entradasDoGerar(d, "g2").map((e) => e.no.id)).toEqual(["p1", "t1"]);
    expect(g2.x).toBeGreaterThan(400);
    expect(duplicarCaixa(c, "p1", "g3")).toBe(c);
  });

  it("variar: caixa nova ligada à origem pela foto (estilo), mesmas entradas e outra câmera; sem foto, nada", () => {
    const sem = quadroBase();
    expect(variarEmCaixaNova(sem, "g1", "g2")).toBe(sem);
    const c = { ...sem, nos: sem.nos.map((n) => (n.id === "g1" ? { ...n, dados: { ...n.dados, resultados: [foto("r1", "img-1"), foto("r2", "img-2")] } } : n)) };
    const v = variarEmCaixaNova(c, "g1", "g2", "img-1");
    const g2 = v.nos.find((n) => n.id === "g2")!;
    expect(g2.dados.camera).toBe(proximaCamera("frontal"));
    expect(g2.dados.camera).not.toBe("frontal");
    const daOrigem = v.ligacoes.find((l) => l.de === "g1" && l.para === "g2")!;
    expect(daOrigem).toMatchObject({ papel: "estilo", entrada: "estilo", imagem_id: "img-1" });
    expect(entradasDoGerar(v, "g2").map((e) => e.no.id)).toEqual(["p1", "g1", "t1"]);
    // Sem foto pedida: a mais nova.
    const v2 = variarEmCaixaNova(c, "g1", "g3");
    expect(v2.ligacoes.find((l) => l.de === "g1" && l.para === "g3")!.imagem_id).toBe("img-2");
  });

  it("conectar liga a foto de uma caixa noutra, sem laço e sem repetir", () => {
    let c = novaCaixa(quadroBase(), "g2", { motores: ["m1"] });
    expect(podeConectarCaixas(c, "g1", "g2")).toBe(true);
    c = conectarCaixas(c, "g1", "g2", "cenario", "img-9");
    expect(c.ligacoes.find((l) => l.de === "g1" && l.para === "g2")).toMatchObject({ papel: "cenario", entrada: "ambiente", imagem_id: "img-9" });
    expect(podeConectarCaixas(c, "g1", "g2")).toBe(false);
    expect(podeConectarCaixas(c, "g2", "g1")).toBe(false);
    expect(conectarCaixas(c, "g2", "g1")).toBe(c);
    expect(podeConectarCaixas(c, "p1", "g2")).toBe(false);
  });

  it("apagar tira a caixa e as linhas dela", () => {
    let c = novaCaixa(quadroBase(), "g2", { motores: ["m1"] });
    c = conectarCaixas(c, "g1", "g2");
    const a = apagarCaixa(c, "g1");
    expect(a.nos.some((n) => n.id === "g1")).toBe(false);
    expect(a.ligacoes.some((l) => l.de === "g1" || l.para === "g1")).toBe(false);
  });

  it("a peça do mês vira uma caixa com Pedido, Ambiente e Produto ligados e os presets", () => {
    const praia = pecasDeFotoDasPropostas(propostas, HOJE)[1];
    const c = caixaDaPeca(canvasVazio(CLIENTE), direcaoParaOCanvas(praia, "kit-1"), { caixa: "gx", pedido: "tx", ambiente: "ax", produto: "px" }, ["m1"]);
    const g = c.nos.find((n) => n.id === "gx")!;
    expect(g.dados).toMatchObject({ motores: ["m1"], camera: "frontal", luz: "dourada", variacoes: 2 });
    expect(entradasDoGerar(c, "gx").map((e) => e.no.id)).toEqual(["px", "ax", "tx"]);
    expect(c.nos.find((n) => n.id === "ax")!.dados).toMatchObject({ texto: "praia ao fim da tarde", modo: "descrever" });
    // Sem cenário e sem produto: só o Pedido.
    const so = caixaDaPeca(canvasVazio(CLIENTE), { ...direcaoParaOCanvas(praia, null), cenario: "" }, { caixa: "g", pedido: "t", ambiente: "a", produto: "p" }, []);
    expect(so.nos.map((n) => n.id).sort()).toEqual(["g", "t"]);
  });
});

// ------------------------------------------------------------------ opções do Resultado

describe("opções do Resultado no pedido ao gerador", () => {
  it("câmera, luz, fundo e variações vão e voltam pela função", () => {
    const d = dadosDoNo("saida", { camera: "lateral", luz: "contraluz", fundo: "madeira", variacoes: 9, motores: ["m1"] }) as Record<string, unknown>;
    expect(d).toMatchObject({ camera: "lateral", luz: "contraluz", fundo: "madeira", variacoes: 5 });
    const ruim = dadosDoNo("saida", { camera: "drone", luz: 3, fundo: null }) as Record<string, unknown>;
    expect(ruim).toMatchObject({ camera: "livre", luz: "livre", fundo: "livre", variacoes: 3 });
    const tela = dadosParaAFuncao("gerar", { camera: "lateral", luz: "x", variacoes: 0 });
    expect(tela).toMatchObject({ camera: "lateral", luz: "livre", fundo: "livre", variacoes: 1 });
    const volta = normalizarCanvas({ nos: [{ id: "g", tipo: "saida", dados: { camera: "detalhe", fundo: "branco", variacoes: 2 } }] })!;
    expect(volta.nos[0].dados).toMatchObject({ camera: "detalhe", luz: "livre", fundo: "branco", variacoes: 2 });
    expect(lerVariacoes(undefined)).toBe(3);
  });

  it("as frases entram no pedido; numa série a câmera sai (o ângulo obrigatório vence)", () => {
    const base = { referencias: [], produtos: [], pessoas: [], ambientes: [], estilos: [], textos: [], formato: "4:5" as const, camera: "tres_quartos", luz: "estudio", fundo: "branco" };
    const solta = promptDoCanvas(base);
    expect(solta).toContain("CÂMERA: câmera em três quartos");
    expect(solta).toContain("LUZ: luz de estúdio suave");
    expect(solta).toContain("FUNDO E CENÁRIO: fundo infinito branco");
    const serie = promptDoCanvas({ ...base, angulo: 2 });
    expect(serie).not.toContain("CÂMERA:");
    expect(serie).toContain("LUZ: luz de estúdio suave");
    expect(linhasDasOpcoes({ camera: "livre", luz: "livre", fundo: "livre" })).toEqual([]);
    expect(solta).not.toMatch(/—/);
  });

  it("ângulo e luz em palavras viram preset", () => {
    expect(cameraPeloTexto("Três quartos")).toBe("tres_quartos");
    expect(cameraPeloTexto("3/4")).toBe("tres_quartos");
    expect(cameraPeloTexto("no rosto")).toBe("no_rosto");
    expect(cameraPeloTexto("no modelo")).toBe("no_modelo");
    expect(cameraPeloTexto("Detalhe da costura")).toBe("detalhe");
    expect(cameraPeloTexto("qualquer coisa")).toBe("livre");
    expect(luzPeloTexto("golden hour")).toBe("dourada");
    expect(luzPeloTexto("luz de janela")).toBe("natural");
    expect(luzPeloTexto("")).toBe("livre");
  });
});

// ------------------------------------------------------------------ tela

describe("barra do quadro", () => {
  const acoes = () => ({
    onNova: vi.fn(), onDuplicar: vi.fn(), onVariar: vi.fn(), onConectar: vi.fn(), onApagar: vi.fn(),
    onZoomMenos: vi.fn(), onZoomMais: vi.fn(), onEnquadrar: vi.fn(), onCheia: vi.fn(),
  });

  it("sem caixa escolhida: só Nova caixa e o zoom", () => {
    const a = acoes();
    render(h(BarraDoQuadro, { temCaixa: false, podeVariar: false, conectando: false, zoom: 0.8, cheia: false, ...a }));
    const barra = screen.getByRole("toolbar", { name: "Caixas do quadro" });
    expect((within(barra).getByRole("button", { name: "Duplicar" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(barra).getByRole("button", { name: "Variar" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(barra).getByRole("button", { name: "Conectar" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(barra).getByRole("button", { name: "Apagar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(barra).getByText("80%")).toBeTruthy();
    fireEvent.click(within(barra).getByRole("button", { name: "Nova caixa" }));
    fireEvent.click(within(barra).getByRole("button", { name: "Aumentar" }));
    fireEvent.click(within(barra).getByRole("button", { name: "Ver tudo" }));
    fireEvent.click(within(barra).getByRole("button", { name: "Tela cheia" }));
    expect(a.onNova).toHaveBeenCalledTimes(1);
    expect(a.onZoomMais).toHaveBeenCalledTimes(1);
    expect(a.onEnquadrar).toHaveBeenCalledTimes(1);
    expect(a.onCheia).toHaveBeenCalledTimes(1);
  });

  it("com caixa e foto: duplica, varia, conecta (fica marcado) e apaga", () => {
    const a = acoes();
    const { rerender } = render(h(BarraDoQuadro, { temCaixa: true, podeVariar: true, conectando: false, zoom: 1, cheia: false, ...a }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicar" }));
    fireEvent.click(screen.getByRole("button", { name: "Variar" }));
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect([a.onDuplicar, a.onVariar, a.onConectar, a.onApagar].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
    rerender(h(BarraDoQuadro, { temCaixa: true, podeVariar: true, conectando: true, zoom: 1, cheia: true, ...a }));
    expect(screen.getByRole("button", { name: "Toque na caixa" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Sair da tela cheia" })).toBeTruthy();
  });

  it("caixa sem foto não varia", () => {
    render(h(BarraDoQuadro, { temCaixa: true, podeVariar: false, conectando: false, zoom: 1, cheia: false, ...acoes() }));
    expect((screen.getByRole("button", { name: "Variar" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Duplicar" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("esteira das peças do mês na tela", () => {
  const valorDaMesa = (): MesaValor =>
    ({
      clientId: CLIENTE, clientName: "Ótica Sintética", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50, catalogo: [], catalogoCarregando: false,
      atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
    }) as MesaValor;
  let foto: MesaFotoValor;

  function montar(props: Record<string, unknown> = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: foto, children: h(EsteiraDoMes, props) }) }))),
    );
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (_fn: string, o: any) => (o.body.acao === "pecas_de_foto" ? { data: { pecas: pecasDeFotoDasPropostas(propostas, HOJE), banco: true }, error: null } : { data: {}, error: null }));
    foto = { kitId: null, ensaioId: null, imagemId: null, escolherKit: vi.fn(), escolherEnsaio: vi.fn(), irPara: vi.fn(), selecionadas: [], setSelecionadas: vi.fn(), abrirAgente: vi.fn(), pedirAoDiretor: vi.fn(), etapa: "criar" };
  });

  it("mostra as peças com o não gravado; abrir leva a direção ao campo do diretor (sem mandar)", async () => {
    montar();
    const lista = await waitFor(() => {
      const l = document.querySelector("[data-lista-de-pecas]") as HTMLElement;
      expect(l).toBeTruthy();
      return l;
    });
    expect(mock.invoke.mock.calls[0][1].body).toMatchObject({ acao: "pecas_de_foto", client_id: CLIENTE });
    expect(lista.querySelectorAll("[data-peca]")).toHaveLength(3);
    expect(screen.getByText("3 para fazer")).toBeTruthy();
    const novembro = lista.querySelector(`[data-peca="${P2}:1"]`) as HTMLElement;
    expect(novembro.getAttribute("data-gravada")).toBe("nao");
    expect(within(novembro).getByText("não gravado")).toBeTruthy();
    fireEvent.click(lista.querySelector(`[data-peca="${P1}:1"]`) as HTMLElement);
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Óculos Aurora na areia")).toBeTruthy();
    expect(within(janela).getByText("Frontal, 3/4, Detalhe na haste")).toBeTruthy();
    fireEvent.click(within(janela).getByRole("button", { name: /Gerar com o diretor/ }));
    expect(foto.pedirAoDiretor).toHaveBeenCalledWith(expect.stringContaining("Assunto: Óculos Aurora na areia."), { soRascunho: true });
  });

  it("Montar no Canvas guarda a peça e leva à etapa do Canvas; Marcar como feita manda a peça para o fim", async () => {
    montar();
    const lista = await waitFor(() => {
      const l = document.querySelector("[data-lista-de-pecas]") as HTMLElement;
      expect(l).toBeTruthy();
      return l;
    });
    fireEvent.click(lista.querySelector(`[data-peca="${P1}:3"]`) as HTMLElement);
    let janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("button", { name: /Marcar como feita/ }));
    await waitFor(() => expect(screen.getByText("2 para fazer")).toBeTruthy());
    expect(Array.from(lista.querySelectorAll("[data-peca]")).map((b) => b.getAttribute("data-peca"))).toEqual([`${P1}:1`, `${P2}:1`, `${P1}:3`]);
    fireEvent.click(within(janela).getByRole("button", { name: /Montar no Canvas/ }));
    expect(foto.irPara).toHaveBeenCalledWith("canvas");
    expect(lerPecaLevadaAoCanvas(CLIENTE)!.chave).toBe(`${P1}:3`);
    janela = screen.queryByRole("dialog") as HTMLElement;
    expect(janela).toBeNull();
  });

  it("endereço direto abre a peça sozinho, mesmo com a faixa escondida (Canvas), e avisa que atendeu", async () => {
    const atendido = vi.fn();
    montar({ mostrarFaixa: false, pedido: { tipo: "task", task_id: TASK }, onPedidoAtendido: atendido });
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Óculos Aurora na areia")).toBeTruthy();
    expect(document.querySelector("[data-esteira-do-mes]")).toBeNull();
    expect(atendido).toHaveBeenCalled();
  });

  it("sem peças, uma linha só; erro na leitura não mostra nada", async () => {
    mock.invoke.mockImplementation(async () => ({ data: { pecas: [], banco: true }, error: null }));
    const t = montar();
    expect(await screen.findByText("Nenhuma peça de foto no planejamento deste mês e do próximo.")).toBeTruthy();
    t.unmount();
    mock.invoke.mockImplementation(async () => ({ data: null, error: { message: "falhou" } }));
    montar();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector("[data-esteira-do-mes]")).toBeNull();
  });
});
