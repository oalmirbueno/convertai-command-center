import { describe, expect, it } from "vitest";
import {
  agrupar,
  alinhar,
  aplicarModelo,
  aplicarMovimentoPronto,
  conteudoDoQuadro,
  desagrupar,
  distribuir,
  duplicarCamadas,
  encaixar,
  estadoNoTempo,
  idsDoGrupo,
  lerCamada,
  limparMontagem,
  marcaDoQuadro,
  MAX_CAMADAS,
  MODELOS_DO_QUADRO,
  mudarOrdem,
  normalizarQuadro,
  novaCamada,
  porChave,
  quadroVazio,
  sugestoesDeLayout,
  textoSobre,
  tirarChave,
  type CamadaDoQuadro,
  type MidiaDaCamada,
} from "../../supabase/functions/mesa-foto/modulos/quadro-animado";
import { desfazer, empilhar, refazer } from "@/components/mesa-foto/canvas/quadro/apoio";
import { quadroParaProjeto } from "@/components/mesa-foto/canvas/quadro/quadroParaEdicao";
import { linhasDoTexto } from "@/components/mesa-foto/canvas/quadro/exportarQuadro";
import { normalizarProjeto } from "../../supabase/functions/_shared/projeto-de-edicao";
import { fontesUsadas } from "../../supabase/functions/_shared/render-do-editor";

/**
 * Frente CNV (30/09): Quadro animado do Canvas. Regras puras (sem React):
 * validação, tempo e animação, alinhar e encaixar, grupos, modelos da marca,
 * limpeza da resposta da IA, desfazer e a ida para a Mesa Edição e o render.
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const foto: MidiaDaCamada = { bucket: "mesa", caminho: `${CLIENTE}/foto/canvas/a.png`, nome: "Foto A", imagem_id: "aaaaaaaa-0000-4000-8000-000000000001", arquivo_id: null };
const video: MidiaDaCamada = { bucket: "mesa", caminho: `${CLIENTE}/video/gerados/p-1.mp4`, nome: "Vídeo", imagem_id: null, arquivo_id: "bbbbbbbb-0000-4000-8000-000000000001" };
const marca = marcaDoQuadro({ nome: "Clínica Aurora", paleta: [{ hex: "#0E7C66", papel: "primária" }, { hex: "#101418", papel: "fundo" }, { hex: "#F2C14E", papel: "apoio" }], logo: { ...foto, caminho: `${CLIENTE}/marca/logo.png`, nome: "Logo" } });

const camada = (extra: Record<string, unknown>) => lerCamada({ id: "c1", tipo: "texto", texto: "Oi", fim_s: 6, ...extra }, 6) as CamadaDoQuadro;

describe("quadro animado: leitura e limites", () => {
  it("normaliza o quadro, prende números, tira mídia de fora da pasta de cliente e não repete id", () => {
    const q = normalizarQuadro({
      formato: "4:5",
      duracao_s: 999,
      fundo: "#ABCDEF",
      camadas: [
        { id: "a", tipo: "texto", texto: "x".repeat(900), tamanho: 9, opacidade: 7, entrada: "pulo" },
        { id: "a", tipo: "imagem", midia: { bucket: "mesa", caminho: "../segredo.png" } },
        { id: "b", tipo: "video", midia: { bucket: "outro", caminho: `${OUTRO}/v.mp4`, nome: "v" } },
        { tipo: "forma", forma: "estrela", cor: "vermelho" },
      ],
    });
    expect(q.formato).toBe("4:5");
    expect(q.duracao_s).toBe(60);
    expect(q.fundo).toBe("#abcdef");
    expect(q.camadas.map((c) => c.id)).toEqual(["a", "a_2", "b", "c4"]);
    expect(q.camadas[0].texto).toHaveLength(400);
    expect(q.camadas[0].tamanho).toBe(0.4);
    expect(q.camadas[0].opacidade).toBe(1);
    expect(q.camadas[1].midia).toBeNull();
    // Bucket desconhecido vira "mesa" (a função ainda confere a pasta do cliente ao salvar).
    expect(q.camadas[2].midia).toMatchObject({ bucket: "mesa", caminho: `${OUTRO}/v.mp4` });
    expect(q.camadas[3]).toMatchObject({ forma: "retangulo", cor: "#00ff66" });
  });

  it("no máximo 40 camadas e 12 chaves por camada, em ordem de tempo", () => {
    const q = normalizarQuadro({ camadas: Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, tipo: "forma" })) });
    expect(q.camadas).toHaveLength(MAX_CAMADAS);
    const c = camada({ chaves: Array.from({ length: 20 }, (_, i) => ({ t: 6 - i * 0.2, x: i / 100 })) });
    expect(c.chaves).toHaveLength(12);
    expect(c.chaves.map((k) => k.t)).toEqual(c.chaves.map((k) => k.t).slice().sort((a, b) => a - b));
  });
});

describe("quadro animado: tempo e animação (mesma conta na tela, no PNG e no render)", () => {
  it("fora do intervalo da camada não aparece; dentro, a entrada e a saída mexem na opacidade", () => {
    const c = camada({ inicio_s: 1, fim_s: 4, entrada: "aparecer", entrada_s: 1, saida: "sumir", saida_s: 1 });
    expect(estadoNoTempo(c, 0.5).visivel).toBe(false);
    expect(estadoNoTempo(c, 4.5).visivel).toBe(false);
    expect(estadoNoTempo(c, 1.5).opacidade).toBeGreaterThan(0.5);
    expect(estadoNoTempo(c, 1.5).opacidade).toBeLessThan(1);
    expect(estadoNoTempo(c, 2.5).opacidade).toBe(1);
    expect(estadoNoTempo(c, 3.8).opacidade).toBeLessThan(0.5);
  });

  it("entradas deslocam e escalam; revelar recorta; tudo determinístico", () => {
    const sobe = camada({ y: 0.5, entrada: "subir", entrada_s: 1 });
    expect(estadoNoTempo(sobe, 0).y).toBeCloseTo(0.56, 5);
    expect(estadoNoTempo(sobe, 1).y).toBeCloseTo(0.5, 5);
    const zoom = camada({ entrada: "zoom", entrada_s: 1 });
    expect(estadoNoTempo(zoom, 0.01).escala).toBeLessThan(0.7);
    const pulo = camada({ entrada: "pulo", entrada_s: 1 });
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => estadoNoTempo(pulo, t).escala))).toBeGreaterThan(1);
    expect(estadoNoTempo(pulo, 1).escala).toBeCloseTo(1, 5);
    const revela = camada({ entrada: "revelar", entrada_s: 2 });
    expect(estadoNoTempo(revela, 1).recorte).toBeGreaterThan(0);
    expect(estadoNoTempo(revela, 1).recorte).toBeLessThan(1);
    expect(estadoNoTempo(revela, 1)).toEqual(estadoNoTempo(revela, 1));
  });

  it("chaves interpolam (suave) e gravar ou tirar chave no tempo funciona", () => {
    let c = camada({ x: 0.1 });
    c = porChave(c, 0, { x: 0.1, escala: 1 });
    c = porChave(c, 2, { x: 0.5, escala: 2 });
    expect(estadoNoTempo(c, 0).x).toBeCloseTo(0.1);
    expect(estadoNoTempo(c, 1).x).toBeCloseTo(0.3);
    expect(estadoNoTempo(c, 2).escala).toBeCloseTo(2);
    expect(estadoNoTempo(c, 5).x).toBeCloseTo(0.5);
    c = porChave(c, 2.01, { x: 0.6 });
    expect(c.chaves).toHaveLength(2);
    expect(c.chaves[1]).toMatchObject({ x: 0.6, escala: 2 });
    expect(tirarChave(c, 2).chaves).toHaveLength(1);
    expect(aplicarMovimentoPronto(c, "aproximar").chaves).toEqual([{ t: 0, escala: 1 }, { t: 6, escala: 1.12 }]);
    expect(aplicarMovimentoPronto(c, "nenhum").chaves).toEqual([]);
  });
});

describe("quadro animado: alinhar, distribuir, encaixar, grupos e ordem", () => {
  const tres = [lerCamada({ id: "a", tipo: "forma", x: 0.1, y: 0.1, l: 0.1, a: 0.1 }, 6)!, lerCamada({ id: "b", tipo: "forma", x: 0.5, y: 0.3, l: 0.2, a: 0.1 }, 6)!, lerCamada({ id: "c", tipo: "forma", x: 0.8, y: 0.6, l: 0.1, a: 0.2 }, 6)!];

  it("uma camada alinha no quadro; várias, na caixa que junta todas", () => {
    expect(alinhar(tres, ["b"], "centro_h").find((c) => c.id === "b")!.x).toBeCloseTo(0.4);
    const juntas = alinhar(tres, ["a", "b", "c"], "topo");
    expect(juntas.map((c) => c.y)).toEqual([0.1, 0.1, 0.1]);
    expect(alinhar(tres, ["a", "c"], "direita").map((c) => c.x + c.l)).toEqual([0.9, 0.7, 0.9]);
  });

  it("distribuir dá o mesmo vão entre 3 ou mais; travada não mexe", () => {
    const d = distribuir(tres, ["a", "b", "c"], "h");
    const vao1 = d[1].x - (d[0].x + d[0].l);
    const vao2 = d[2].x - (d[1].x + d[1].l);
    expect(vao1).toBeCloseTo(vao2, 4);
    const travada = tres.map((c) => (c.id === "b" ? { ...c, travada: true } : c));
    expect(alinhar(travada, ["b"], "esquerda").find((c) => c.id === "b")!.x).toBe(0.5);
  });

  it("encaixe gruda no centro do quadro e nas bordas das outras e devolve as guias", () => {
    const e = encaixar({ x: 0.395, y: 0.2, l: 0.2, a: 0.1 }, []);
    expect(e.x).toBeCloseTo(0.4);
    expect(e.guias).toEqual([{ eixo: "v", pos: 0.5 }]);
    const outra = encaixar({ x: 0.3, y: 0.405, l: 0.1, a: 0.1 }, [{ x: 0.7, y: 0.3, l: 0.2, a: 0.2 }]);
    expect(outra.y).toBeCloseTo(0.4);
    expect(outra.guias.some((g) => g.eixo === "h")).toBe(true);
    expect(encaixar({ x: 0.2, y: 0.2, l: 0.1, a: 0.1 }, []).guias).toEqual([]);
  });

  it("grupos, duplicar (grupo novo) e ordem da pilha", () => {
    let l = agrupar(tres, ["a", "b"], "g1");
    expect(idsDoGrupo(l, "a")).toEqual(["a", "b"]);
    const dup = duplicarCamadas(l, ["a", "b"]);
    expect(dup.novos).toHaveLength(2);
    const novos = dup.camadas.filter((c) => dup.novos.indexOf(c.id) >= 0);
    expect(novos[0].grupo).toBe(novos[1].grupo);
    expect(novos[0].grupo).not.toBe("g1");
    l = desagrupar(l, ["b"]);
    expect(l.every((c) => c.grupo === null)).toBe(true);
    expect(mudarOrdem(tres, "a", "frente").map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(mudarOrdem(tres, "c", "fundo").map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(mudarOrdem(tres, "b", "descer").map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});

describe("quadro animado: modelos da marca e sugestões", () => {
  const conteudo = { titulo: "Avaliação gratuita em outubro", subtitulo: "Descubra o tom ideal do seu sorriso", cta: "Chame no WhatsApp", selo: "Outubro", topicos: ["Sem dor", "Resultado rápido", "Retoque incluso"], midias: [foto, video] };

  it("todo modelo cabe no quadro, usa as cores da marca e põe a logo pelo código (nunca pelo gerador)", () => {
    for (const m of MODELOS_DO_QUADRO) {
      for (const formato of ["9:16", "1:1", "16:9"] as const) {
        const q = aplicarModelo(m.id, conteudo, marca, formato, 6);
        expect(q.modelo).toBe(m.id);
        expect(q.camadas.length).toBeGreaterThan(1);
        q.camadas.forEach((c) => {
          expect(c.x).toBeGreaterThanOrEqual(-0.001);
          expect(c.y).toBeGreaterThanOrEqual(-0.001);
          expect(c.x + c.l).toBeLessThanOrEqual(1.01);
          expect(c.y + c.a).toBeLessThanOrEqual(1.01);
          expect(c.fim_s).toBeLessThanOrEqual(6);
        });
        const logos = q.camadas.filter((c) => c.tipo === "logo");
        logos.forEach((l) => expect(l.midia && l.midia.caminho).toBe(`${CLIENTE}/marca/logo.png`));
      }
    }
    const forte = aplicarModelo("titulo_forte", conteudo, marca, "9:16", 6);
    expect(forte.camadas[0]).toMatchObject({ tipo: "forma", cor: "#0e7c66" });
    expect(forte.camadas.find((c) => c.nome === "Título")!.cor).toBe(textoSobre("#0e7c66"));
    expect(aplicarModelo("lista_tres", conteudo, marca, "9:16", 6).camadas.filter((c) => /^Tópico/.test(c.nome)).map((c) => c.texto)).toEqual(conteudo.topicos);
  });

  it("marca sem paleta usa o verde da casa; sem logo, o modelo não inventa logo", () => {
    const m = marcaDoQuadro({ nome: "X", paleta: [] });
    expect(m.primaria).toBe("#00ff66");
    expect(aplicarModelo("chamada_final", { ...conteudo, midias: [] }, m, "9:16", 5).camadas.some((c) => c.tipo === "logo")).toBe(false);
  });

  it("o conteúdo do quadro volta para sugerir outros layouts com o mesmo texto e as mesmas mídias", () => {
    const q = aplicarModelo("capa_cheia", conteudo, marca, "9:16", 6);
    const c = conteudoDoQuadro(q);
    expect(c.titulo).toBe(conteudo.titulo);
    expect(c.subtitulo).toBe(conteudo.subtitulo);
    expect(c.midias.map((m) => m.caminho)).toEqual([foto.caminho]);
    const s = sugestoesDeLayout(q, marca, 8);
    expect(s.every((x) => x.modelo.id !== "capa_cheia")).toBe(true);
    expect(s.some((x) => x.modelo.id === "antes_depois")).toBe(false);
    s.forEach((x) => expect(conteudoDoQuadro(x.quadro).titulo).toBe(conteudo.titulo));
    expect(sugestoesDeLayout({ ...q, camadas: q.camadas.filter((x) => !x.midia) }, marca).every((x) => !x.modelo.pedeMidia)).toBe(true);
  });
});

describe("quadro animado: montar com IA (o que volta do modelo é limpo)", () => {
  it("prende às listas, tira travessão, corta tamanhos e não escolhe layout de mídia sem mídia", () => {
    const m = limparMontagem({ resposta: "Montei — pronto", modelo: "capa_cheia", titulo: "Sorriso — novo", subtitulo: "x".repeat(400), cta: "Agende", selo: "", topicos: ["a"], duracao_s: 99, animacao: "loucura", alternativas: ["antes_depois", "inexistente", "titulo_forte", "titulo_forte", "lista_tres"] }, { midias: 0 });
    expect(m.modelo).toBe("titulo_forte");
    expect(m.conteudo.titulo).toBe("Sorriso, novo");
    expect(m.resposta).not.toMatch(/—/);
    expect(m.conteudo.subtitulo).toHaveLength(160);
    expect(m.duracao_s).toBe(12);
    expect(m.animacao).toBe("suave");
    expect(m.alternativas).toEqual([]);
    const comMidia = limparMontagem({ modelo: "antes_depois", alternativas: ["capa_cheia", "meio_a_meio"], topicos: [] }, { midias: 1 });
    expect(comMidia.modelo).toBe("capa_cheia");
    expect(comMidia.alternativas).toEqual(["meio_a_meio"]);
    expect(limparMontagem(null).modelo).toBe("titulo_forte");
  });
});

describe("quadro animado: desfazer e refazer", () => {
  it("empilha o estado de antes, desfaz e refaz na ordem", () => {
    const a = quadroVazio("9:16");
    const b = { ...a, fundo: "#ffffff" };
    const c = { ...a, fundo: "#000000" };
    let h = empilhar({ passado: [], futuro: [] }, a);
    h = empilhar(h, b);
    const d1 = desfazer(h, c)!;
    expect(d1.quadro).toBe(b);
    const d2 = desfazer(d1.historico, d1.quadro)!;
    expect(d2.quadro).toBe(a);
    expect(desfazer(d2.historico, d2.quadro)).toBeNull();
    const r = refazer(d2.historico, d2.quadro)!;
    expect(r.quadro).toBe(b);
    expect(empilhar(r.historico, b).futuro).toEqual([]);
  });
});

describe("quadro animado: para a Mesa Edição e o render", () => {
  it("vira projeto de edição válido: uma trilha de sobreposição, o fundo e cada camada visível num clipe, toda mídia é fonte usada", () => {
    const base = aplicarModelo("meio_a_meio", { titulo: "T", subtitulo: "S", cta: "C", selo: "", topicos: [], midias: [video] }, marca, "4:5", 5);
    const q = { ...base, camadas: base.camadas.concat([novaCamada("texto", base, { visivel: false })]) };
    const p = quadroParaProjeto(q, "Quadro de teste");
    expect(normalizarProjeto(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(p.formato).toBe("4:5");
    expect(p.fps).toBe(30);
    expect(p.trilhas).toHaveLength(1);
    expect(p.trilhas[0].tipo).toBe("sobreposicao");
    const clipes = p.trilhas[0].clipes;
    expect(clipes).toHaveLength(base.camadas.length + 1);
    expect((clipes[0].estilo as any).camada).toMatchObject({ tipo: "forma", cor: base.fundo, l: 1, a: 1 });
    expect(clipes.every((c) => (c.estilo as any).camada && (c.estilo as any).quadro_duracao_s === 5)).toBe(true);
    const comMidia = clipes.filter((c) => c.fonte);
    expect(comMidia.length).toBeGreaterThanOrEqual(1);
    expect(fontesUsadas(p).sort()).toEqual(Object.keys(p.fontes).sort());
    Object.keys(p.fontes).forEach((k) => expect(p.fontes[k].storage_path!.indexOf(`${CLIENTE}/`)).toBe(0));
    expect(p.fontes[comMidia[0].fonte as string].midia).toBe("video");
    expect(p.duracao_s).toBe(5);
  });

  it("quebra de linha do texto exportado respeita a largura e as quebras da pessoa", () => {
    const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) } as unknown as CanvasRenderingContext2D;
    expect(linhasDoTexto(ctx, "um dois tres quatro", 90)).toEqual(["um dois", "tres", "quatro"]);
    expect(linhasDoTexto(ctx, "a\nb", 100)).toEqual(["a", "b"]);
  });
});
