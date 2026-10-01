import { describe, expect, it } from "vitest";
import {
  camposDaCopy,
  classificarEdicao,
  copyDoSite,
  ErroDaPrevia,
  estadoDasSecoes,
  estadoDoMotor,
  haQuanto,
  igualProfundo,
  lerCampo,
  destinoDaEdicao,
  normalizarEdicao,
  pacoteMaisNovo,
  pacoteParaOPedido,
  planejarDesfazer,
  planejarEdicao,
  textoComParagrafos,
  type AlvoDaEdicao,
  type SiteDaPrevia,
} from "../../supabase/functions/mesa-site/modulos/site-previa";
import { fontesComAjustes, mapaDoSite, mapaPadrao, normalizarEstilo, normalizarMapa, secoesDoMapa } from "../../supabase/functions/_shared/site-biblioteca";
import { coresDoSite } from "../../supabase/functions/_shared/uiux/apoio-da-paleta";
import { normalizarPedido, TIPOS_DE_TRABALHO, gasta, ROTULO_DO_TIPO } from "../../supabase/functions/_shared/motor-codigo";
import { camposDoEstilo } from "../../supabase/functions/mesa-site/estrutura-pura";
import { arquivoDaImagemNoSite } from "../../supabase/functions/_shared/pacote-do-site";

/**
 * Frente SPV (30/09): a prévia editável do site. As regras puras: o que é
 * conteúdo (vale na hora, sem custo) e o que é código (vira ajuste do motor
 * com o custo antes), o Desfazer exato por ponto, as seções escondidas que
 * voltam iguais, o estado das seções na construção e o estado do motor.
 */

const copy = {
  conceito: "c",
  headline: "Seu serviço explicado com clareza",
  subtitulo: "Sites e anúncios para você.",
  cta: "Pedir orçamento",
  secoes: [
    { id: "hero", titulo: "Abertura", texto: "Texto da abertura", itens: ["Pedir orçamento", "Baixar checklist"] },
    { id: "bento", titulo: "O que cada serviço resolve", texto: "Quatro frentes", itens: ["Site que orienta: páginas claras.", "Identidade: logo coerente."] },
  ],
  faq: [{ pergunta: "Atendem minha cidade?", resposta: "Sim, todo o Brasil." }],
  seo: { titulo: "t", descricao: "d", palavras: [] },
};

const IMG_A = "aaaaaaaa-1111-4111-8111-111111111111";
const IMG_B = "bbbbbbbb-2222-4222-8222-222222222222";

const site = (extra: Partial<SiteDaPrevia> = {}): SiteDaPrevia => ({
  conteudo: { opcoes: [copy, { ...copy, headline: "Outra" }], escolhida: 0 },
  estilo: { preset: null, motion: [] },
  mapa: mapaPadrao("landing") as unknown as Record<string, unknown>,
  tipo: "landing",
  direcao: {},
  imagens: [
    { id: IMG_A, slot: "hero", origem: "gerada", bucket: "mesa", path: "c/site/s/imagens/hero-1.png", alt: "hero", escolhida: true, secao: "hero" },
    { id: IMG_B, slot: "hero", origem: "gerada", bucket: "mesa", path: "c/site/s/imagens/hero-2.png", alt: "outra", escolhida: false, secao: "hero" },
  ],
  ...extra,
});

/** Aplica o plano como o servidor faz (as colunas voltam do banco). */
const aplicar = (s: SiteDaPrevia, campos: Record<string, unknown>): SiteDaPrevia => JSON.parse(JSON.stringify({ ...s, ...campos }));

describe("o que a prévia aceita", () => {
  it("lê o endereço dos textos da copy e recusa o resto", () => {
    expect(lerCampo("headline")).toEqual({ onde: "abertura", chave: "headline" });
    expect(lerCampo("secao:bento:item:1")).toEqual({ onde: "item", uid: "bento", n: 1 });
    expect(lerCampo("faq:0:resposta")).toEqual({ onde: "faq", n: 0, chave: "resposta" });
    expect(lerCampo("secao:Bento:titulo")).toBeNull();
    expect(lerCampo("secao:bento:preco")).toBeNull();
    expect(lerCampo("../x")).toBeNull();
  });

  it("normaliza a edição sem confiar na tela", () => {
    expect(normalizarEdicao({ tipo: "cor", papel: "destaque", hex: "#FF0000" })).toEqual({ tipo: "cor", papel: "destaque", hex: "#ff0000" });
    expect(normalizarEdicao({ tipo: "cor", papel: "fundo", hex: null })).toEqual({ tipo: "cor", papel: "fundo", hex: null });
    expect(() => normalizarEdicao({ tipo: "cor", papel: "destaque", hex: "red" })).toThrow(ErroDaPrevia);
    expect(() => normalizarEdicao({ tipo: "fonte", papel: "titulo", nome: "Inter; drop" })).toThrow(/fonte/);
    expect(() => normalizarEdicao({ tipo: "texto", campo: "nada", valor: "x" })).toThrow(/copy/);
    expect(() => normalizarEdicao({ tipo: "secao_mover", secao: "hero", direcao: "lado" })).toThrow();
    expect(() => normalizarEdicao({ tipo: "imagem", secao: "hero", slot: "hero" })).toThrow(/imagem/);
    expect(() => normalizarEdicao({ tipo: "pedido", secao: "hero", instrucao: "" })).toThrow(/mudar/);
    expect(() => normalizarEdicao({ tipo: "apagar_tudo" })).toThrow(/desconhecido/);
    const img = normalizarEdicao({ tipo: "imagem", secao: "HERO", slot: "xxx", imagem_id: IMG_B, substitui_id: "não-é-uuid" });
    expect(img).toEqual({ tipo: "imagem", secao: "hero", slot: "secao", imagem_id: IMG_B, cliente_imagem_id: null, substitui_id: null });
  });

  it("conteúdo vale na hora; texto do código e pedido livre vão ao motor", () => {
    ["texto", "imagem", "cor", "fonte", "secao_visivel", "secao_mover"].forEach((t) => expect(classificarEdicao({ tipo: t as never })).toBe("conteudo"));
    expect(classificarEdicao({ tipo: "texto_livre" })).toBe("codigo");
    expect(classificarEdicao({ tipo: "pedido" })).toBe("codigo");
  });

  it("os campos da copy saem com endereço e seção (a ponte acha no site do motor)", () => {
    const campos = camposDaCopy(copyDoSite(site().conteudo).copy);
    expect(campos.find((c) => c.campo === "headline")!.valor).toBe(copy.headline);
    expect(campos.find((c) => c.campo === "secao:bento:item:0")).toMatchObject({ secao: "bento", valor: "Site que orienta: páginas claras." });
    expect(campos.find((c) => c.campo === "faq:0:pergunta")!.rotulo).toMatch(/Pergunta 1/);
    expect(camposDaCopy(null)).toEqual([]);
  });
});

describe("texto da copy", () => {
  it("troca o ponto exato na opção escolhida, sem travessão, e o Desfazer volta só ele", () => {
    const s0 = site();
    const p = planejarEdicao(s0, normalizarEdicao({ tipo: "texto", campo: "headline", valor: "  Novo título — com  espaço " }));
    expect(p.modo).toBe("direto");
    if (p.modo !== "direto") return;
    expect(p.alvos).toEqual([{ coluna: "conteudo", caminho: ["opcoes", 0, "headline"], antes: copy.headline, depois: "Novo título, com espaço" }]);
    const s1 = aplicar(s0, p.campos);
    expect(copyDoSite(s1.conteudo).copy!.headline).toBe("Novo título, com espaço");
    // A outra opção não muda.
    expect((s1.conteudo as any).opcoes[1].headline).toBe("Outra");
    // Outra edição depois, em outro ponto, não impede o Desfazer da primeira.
    const p2 = planejarEdicao(s1, normalizarEdicao({ tipo: "texto", campo: "secao:bento:item:1", valor: "Identidade: marca forte." }));
    if (p2.modo !== "direto") throw new Error("esperava direto");
    const s2 = aplicar(s1, p2.campos);
    const volta = planejarDesfazer(s2, p.alvos);
    expect("campos" in volta).toBe(true);
    if (!("campos" in volta)) return;
    const s3 = aplicar(s2, volta.campos);
    expect(copyDoSite(s3.conteudo).copy!.headline).toBe(copy.headline);
    expect(copyDoSite(s3.conteudo).copy!.secoes![1].itens![1]).toBe("Identidade: marca forte.");
  });

  it("texto longo guarda o parágrafo; título, botão e item ficam numa linha só", () => {
    expect(textoComParagrafos("  Um  \r\n\r\n\r\n\t dois — três  \n", 100)).toBe("Um\n\ndois, três");
    const s0 = site();
    const p = planejarEdicao(s0, normalizarEdicao({ tipo: "texto", campo: "secao:bento:texto", valor: "Quatro frentes.\nCada uma com dono." }));
    if (p.modo !== "direto") throw new Error("esperava direto");
    expect(p.alvos[0].depois).toBe("Quatro frentes.\nCada uma com dono.");
    // O resumo do histórico fica numa linha só.
    expect(p.resumo).toMatch(/: "Quatro frentes\. Cada uma com dono\."$/);
    const r = planejarEdicao(s0, normalizarEdicao({ tipo: "texto", campo: "faq:0:resposta", valor: "Sim.\nTodo o Brasil." }));
    if (r.modo !== "direto") throw new Error("esperava direto");
    expect(r.alvos[0].depois).toBe("Sim.\nTodo o Brasil.");
    const sub = planejarEdicao(s0, normalizarEdicao({ tipo: "texto", campo: "subtitulo", valor: "Sites.\nAnúncios." }));
    if (sub.modo !== "direto") throw new Error("esperava direto");
    expect(sub.alvos[0].depois).toBe("Sites.\nAnúncios.");
    const t = planejarEdicao(s0, normalizarEdicao({ tipo: "texto", campo: "secao:bento:titulo", valor: "O que\ncada um resolve" }));
    if (t.modo !== "direto") throw new Error("esperava direto");
    expect(t.alvos[0].depois).toBe("O que cada um resolve");
    const i = planejarEdicao(s0, normalizarEdicao({ tipo: "texto", campo: "secao:bento:item:0", valor: "Site:\nclaro" }));
    if (i.modo !== "direto") throw new Error("esperava direto");
    expect(i.alvos[0].depois).toBe("Site: claro");
  });

  it("o Desfazer recusa quando o ponto mudou depois (sem apagar o que veio depois)", () => {
    const s0 = site();
    const p = planejarEdicao(s0, normalizarEdicao({ tipo: "texto", campo: "cta", valor: "Falar agora" }));
    if (p.modo !== "direto") throw new Error("esperava direto");
    const s1 = aplicar(s0, p.campos);
    const p2 = planejarEdicao(s1, normalizarEdicao({ tipo: "texto", campo: "cta", valor: "Chamar no WhatsApp" }));
    if (p2.modo !== "direto") throw new Error("esperava direto");
    const s2 = aplicar(s1, p2.campos);
    expect(planejarDesfazer(s2, p.alvos)).toEqual({ conflito: expect.stringMatching(/mudou depois/) });
    // Desfazendo na ordem certa, volta tudo.
    const v2 = planejarDesfazer(s2, p2.alvos);
    if (!("campos" in v2)) throw new Error("esperava campos");
    const v1 = planejarDesfazer(aplicar(s2, v2.campos), p.alvos);
    if (!("campos" in v1)) throw new Error("esperava campos");
    expect(copyDoSite(aplicar(aplicar(s2, v2.campos), v1.campos).conteudo).copy!.cta).toBe(copy.cta);
  });

  it("igual ao que está é 'nada'; vazio onde não pode é recusado; sem copy escolhida pede a etapa Conteúdo", () => {
    expect(planejarEdicao(site(), normalizarEdicao({ tipo: "texto", campo: "headline", valor: copy.headline })).modo).toBe("nada");
    expect(() => planejarEdicao(site(), normalizarEdicao({ tipo: "texto", campo: "headline", valor: "   " }))).toThrow(/vazio/);
    expect(planejarEdicao(site(), normalizarEdicao({ tipo: "texto", campo: "subtitulo", valor: "" })).modo).toBe("direto");
    expect(() => planejarEdicao(site({ conteudo: { opcoes: [copy] } }), normalizarEdicao({ tipo: "texto", campo: "headline", valor: "x" }))).toThrow(/Conteúdo/);
    expect(() => planejarEdicao(site(), normalizarEdicao({ tipo: "texto", campo: "secao:bento:item:9", valor: "x" }))).toThrow(/não existe/);
    expect(() => planejarEdicao(site(), normalizarEdicao({ tipo: "texto", campo: "faq:4:pergunta", valor: "x" }))).toThrow(/não existe/);
  });

  it("seção sem copy ganha a entrada com o texto; o Desfazer tira a entrada", () => {
    const s0 = site();
    const p = planejarEdicao(s0, normalizarEdicao({ tipo: "texto", campo: "secao:faq:titulo", valor: "Dúvidas" }));
    if (p.modo !== "direto") throw new Error("esperava direto");
    const s1 = aplicar(s0, p.campos);
    expect(copyDoSite(s1.conteudo).copy!.secoes!.map((x) => x.id)).toEqual(["hero", "bento", "faq"]);
    const v = planejarDesfazer(s1, p.alvos);
    if (!("campos" in v)) throw new Error("esperava campos");
    expect(copyDoSite(aplicar(s1, v.campos).conteudo).copy!.secoes!.map((x) => x.id)).toEqual(["hero", "bento"]);
  });
});

describe("texto do código e pedido livre viram ajuste do motor", () => {
  it("monta a instrução com a seção e o antes e o depois", () => {
    const p = planejarEdicao(site(), normalizarEdicao({ tipo: "texto_livre", secao: "bento", antes: "Veja mais", valor: "Conheça os planos" }));
    expect(p).toMatchObject({ modo: "ajuste", secao: "bento" });
    if (p.modo !== "ajuste") return;
    expect(p.instrucao).toMatch(/troque o texto "Veja mais" por "Conheça os planos"/);
    expect(p.instrucao).toMatch(/Não mude mais nada/);
    const q = planejarEdicao(site(), normalizarEdicao({ tipo: "pedido", secao: "hero", instrucao: "título maior no celular" }));
    expect(q.modo === "ajuste" && q.instrucao).toMatch(/Na seção .*\(hero\): título maior no celular/);
  });
});

describe("imagem", () => {
  it("troca pela outra imagem do site (a antiga sai, a nova entra na seção) e desfaz", () => {
    const s0 = site();
    const p = planejarEdicao(s0, normalizarEdicao({ tipo: "imagem", secao: "hero", slot: "hero", imagem_id: IMG_B, substitui_id: IMG_A }));
    if (p.modo !== "direto") throw new Error("esperava direto");
    const s1 = aplicar(s0, p.campos);
    const lista = s1.imagens as Array<{ id: string; escolhida: boolean; secao: string }>;
    expect(lista.find((i) => i.id === IMG_A)!.escolhida).toBe(false);
    expect(lista.find((i) => i.id === IMG_B)).toMatchObject({ escolhida: true, secao: "hero" });
    const v = planejarDesfazer(s1, p.alvos);
    if (!("campos" in v)) throw new Error("esperava campos");
    expect(igualProfundo(aplicar(s1, v.campos).imagens, s0.imagens)).toBe(true);
  });

  it("foto real do acervo entra como real (e a mesma foto não duplica); imagem que sumiu é recusada", () => {
    const foto = { id: "cccccccc-3333-4333-8333-333333333333", slot: "secao", origem: "real" as const, bucket: "cliente", path: "c/fotos/loja.jpg", alt: "loja", escolhida: true };
    const p = planejarEdicao(site(), normalizarEdicao({ tipo: "imagem", secao: "bento", slot: "detalhe", cliente_imagem_id: "dddddddd-4444-4444-8444-444444444444" }), { fotoReal: foto });
    if (p.modo !== "direto") throw new Error("esperava direto");
    const s1 = aplicar(site(), p.campos);
    expect((s1.imagens as unknown[]).length).toBe(3);
    const p2 = planejarEdicao(s1, normalizarEdicao({ tipo: "imagem", secao: "hero", slot: "hero", cliente_imagem_id: "dddddddd-4444-4444-8444-444444444444" }), { fotoReal: { ...foto, id: "eeeeeeee-5555-4555-8555-555555555555" } });
    if (p2.modo !== "direto") throw new Error("esperava direto");
    expect((aplicar(s1, p2.campos).imagens as unknown[]).length).toBe(3);
    expect(() => planejarEdicao(site(), normalizarEdicao({ tipo: "imagem", secao: "hero", slot: "hero", cliente_imagem_id: "dddddddd-4444-4444-8444-444444444444" }))).toThrow(/acervo/);
    expect(() => planejarEdicao(site(), normalizarEdicao({ tipo: "imagem", secao: "hero", slot: "hero", imagem_id: "ffffffff-6666-4666-8666-666666666666" }))).toThrow(/não está mais/);
  });

  it("o arquivo da imagem no site leva o começo do id (trocar baixa a nova; a prévia acha pelo arquivo)", () => {
    expect(arquivoDaImagemNoSite({ id: IMG_A, origem: "gerada", slot: "hero", path: "x/y.PNG" })).toBe("/imagens/hero-aaaaaaaa.png");
    expect(arquivoDaImagemNoSite({ id: IMG_B, origem: "real", slot: "secao", path: "x/y.jpeg" })).toBe("/imagens/foto-bbbbbbbb.jpeg");
  });
});

describe("cor e fonte deste site (o kit da marca não muda)", () => {
  it("guarda em estilo.ajustes, volta para a da marca com nulo, e o preset não apaga o ajuste", () => {
    const s0 = site();
    const p = planejarEdicao(s0, normalizarEdicao({ tipo: "cor", papel: "destaque", hex: "#ff5500" }));
    if (p.modo !== "direto") throw new Error("esperava direto");
    const s1 = aplicar(s0, p.campos);
    expect(normalizarEstilo(s1.estilo).ajustes).toEqual({ destaque: "#ff5500" });
    const f = planejarEdicao(s1, normalizarEdicao({ tipo: "fonte", papel: "titulo", nome: "Fraunces" }));
    if (f.modo !== "direto") throw new Error("esperava direto");
    const s2 = aplicar(s1, f.campos);
    expect(normalizarEstilo(s2.estilo).ajustes).toEqual({ destaque: "#ff5500", fonte_titulo: "Fraunces" });
    // Trocar o preset na Direção mantém o ajuste.
    const comPreset = camposDoEstilo(s2 as never, { preset: "saas_limpo", aplicarDna: false });
    expect((comPreset.estilo as { ajustes?: unknown }).ajustes).toEqual({ destaque: "#ff5500", fonte_titulo: "Fraunces" });
    const volta = planejarEdicao(s2, normalizarEdicao({ tipo: "cor", papel: "destaque", hex: null }));
    if (volta.modo !== "direto") throw new Error("esperava direto");
    expect(normalizarEstilo(aplicar(s2, volta.campos).estilo).ajustes).toEqual({ fonte_titulo: "Fraunces" });
    const d = planejarDesfazer(s2, f.alvos);
    if (!("campos" in d)) throw new Error("esperava campos");
    expect(normalizarEstilo(aplicar(s2, d.campos).estilo).ajustes).toEqual({ destaque: "#ff5500" });
  });

  it("as cores do site seguem o ajuste; fundo trocado acerta o texto pelo contraste", () => {
    const paleta = [{ hex: "#00d52b", papel: "primária" }, { hex: "#ffffff", papel: "fundo" }];
    const base = coresDoSite({ paleta, dna: null, estilo: null });
    expect(base.destaque).toBe("#00d52b");
    const ajustada = coresDoSite({ paleta, dna: null, estilo: { ajustes: { destaque: "#FF5500", fundo: "#0b0b0c" } } });
    expect(ajustada).toEqual({ destaque: "#ff5500", fundo: "#0b0b0c", texto: "#f5f5f3", escuro: true });
    expect(coresDoSite({ paleta, dna: null, estilo: { ajustes: { texto: "#222222" } } }).texto).toBe("#222222");
  });

  it("as fontes do pacote trocam título e texto sem perder as outras", () => {
    const kit = [{ nome: "Inter", papel: "texto" }, { nome: "Sora", papel: "titulo" }, { nome: "JetBrains Mono", papel: "mono" }];
    expect(fontesComAjustes(kit, null)).toBe(kit);
    expect(fontesComAjustes(kit, { fonte_titulo: "Fraunces" })).toEqual([{ nome: "Fraunces", papel: "titulo" }, { nome: "Inter", papel: "texto" }, { nome: "JetBrains Mono", papel: "mono" }]);
    expect(fontesComAjustes(kit, { fonte_texto: "Lora" }).filter((f) => f.papel === "texto")).toEqual([{ nome: "Lora", papel: "texto" }]);
  });
});

describe("seções: esconder, mostrar e mover", () => {
  it("esconder tira da página e guarda o lugar; mostrar volta igual (mesmo uid)", () => {
    const s0 = site();
    const antes = secoesDoMapa(mapaDoSite(s0 as never));
    const p = planejarEdicao(s0, normalizarEdicao({ tipo: "secao_visivel", secao: "problema", visivel: false }));
    if (p.modo !== "direto") throw new Error("esperava direto");
    const s1 = aplicar(s0, p.campos);
    const m1 = mapaDoSite(s1 as never);
    expect(secoesDoMapa(m1)).not.toContain("problema");
    expect(m1.ocultas).toEqual([{ uid: "problema", tipo: "problema", pagina: "inicio", posicao: 1 }]);
    // Esconder de novo: nada muda.
    expect(planejarEdicao(s1, normalizarEdicao({ tipo: "secao_visivel", secao: "problema", visivel: false })).modo).toBe("nada");
    const q = planejarEdicao(s1, normalizarEdicao({ tipo: "secao_visivel", secao: "problema", visivel: true }));
    if (q.modo !== "direto") throw new Error("esperava direto");
    const s2 = aplicar(s1, q.campos);
    expect(secoesDoMapa(mapaDoSite(s2 as never))).toEqual(antes);
    expect(mapaDoSite(s2 as never).ocultas).toBeUndefined();
  });

  it("o topo esconde e volta primeiro; a última seção da página não esconde", () => {
    const s0 = site();
    const p = planejarEdicao(s0, normalizarEdicao({ tipo: "secao_visivel", secao: "topo", visivel: false }));
    if (p.modo !== "direto") throw new Error("esperava direto");
    const s1 = aplicar(s0, p.campos);
    expect(mapaDoSite(s1 as never).globais).toEqual(["rodape"]);
    const q = planejarEdicao(s1, normalizarEdicao({ tipo: "secao_visivel", secao: "topo", visivel: true }));
    if (q.modo !== "direto") throw new Error("esperava direto");
    expect(mapaDoSite(aplicar(s1, q.campos) as never).globais).toEqual(["topo", "rodape"]);
    const uma = site({ mapa: { tipo: "landing", globais: [], paginas: [{ id: "inicio", slug: "", titulo: "Início", secoes: [{ uid: "hero", tipo: "hero" }] }] } });
    expect(() => planejarEdicao(uma, normalizarEdicao({ tipo: "secao_visivel", secao: "hero", visivel: false }))).toThrow(/ao menos uma/);
  });

  it("subir e descer trocam com a vizinha; na ponta é 'nada'; global não move; site antigo (sem mapa) ganha o mapa e o Desfazer volta ao antigo", () => {
    const s0 = site();
    const p = planejarEdicao(s0, normalizarEdicao({ tipo: "secao_mover", secao: "bento", direcao: "subir" }));
    if (p.modo !== "direto") throw new Error("esperava direto");
    const ordem = mapaDoSite(aplicar(s0, p.campos) as never).paginas[0].secoes.map((x) => x.uid);
    expect(ordem.slice(0, 3)).toEqual(["hero", "bento", "problema"]);
    expect(planejarEdicao(s0, normalizarEdicao({ tipo: "secao_mover", secao: "hero", direcao: "subir" })).modo).toBe("nada");
    expect(() => planejarEdicao(s0, normalizarEdicao({ tipo: "secao_mover", secao: "topo", direcao: "descer" }))).toThrow(/topo e o rodapé/);
    const antigo = site({ mapa: {}, direcao: { secoes: ["topo", "hero", "servicos", "faq", "rodape"] } });
    const m = planejarEdicao(antigo, normalizarEdicao({ tipo: "secao_mover", secao: "faq", direcao: "subir" }));
    if (m.modo !== "direto") throw new Error("esperava direto");
    const s1 = aplicar(antigo, m.campos);
    expect(secoesDoMapa(mapaDoSite(s1 as never))).toEqual(["topo", "hero", "faq", "servicos", "rodape"]);
    const v = planejarDesfazer(s1, m.alvos);
    if (!("campos" in v)) throw new Error("esperava campos");
    expect(aplicar(s1, v.campos).mapa).toEqual({});
  });

  it("o mapa guardado descarta oculta inválida (uid repetido, página que não existe)", () => {
    const m = normalizarMapa({ ...mapaPadrao("landing"), ocultas: [{ uid: "hero", tipo: "hero", pagina: "inicio", posicao: 0 }, { uid: "x1", tipo: "faq", pagina: "sumiu", posicao: 0 }, { uid: "galeria", tipo: "galeria", pagina: "inicio", posicao: 99 }] });
    expect(m.ocultas).toEqual([{ uid: "galeria", tipo: "galeria", pagina: "inicio", posicao: 14 }]);
  });
});

describe("a fila do motor sabe do tipo novo", () => {
  it("'conteudo' é máquina (sem modelo e sem teto) e tem rótulo", () => {
    expect(TIPOS_DE_TRABALHO).toContain("conteudo");
    expect(gasta("conteudo")).toBe(false);
    expect(ROTULO_DO_TIPO.conteudo).toMatch(/prévia/);
    expect(normalizarPedido({ tipo: "conteudo", teto_usd: 3 }).tipo).toBe("conteudo");
  });
});

const trabalho = (t: Record<string, unknown>) => ({ id: String(t.id || Math.random()), tipo: "construir", estado: "feito", custo_usd: 0, teto_usd: 0, instrucao: "", resultado: {}, ...t }) as never;

describe("para onde vai a edição da prévia (a fila do motor é serial por projeto)", () => {
  const t = (id: string, tipo: string, estado: string, commit: string | null = null) => ({ id, tipo, estado, commit });
  it("construir na fila antes do primeiro commit ganha o pacote novo; nada é criado", () => {
    expect(destinoDaEdicao([t("b1", "construir", "na_fila")])).toEqual({ atualizar: ["b1"], criar: false, publicarAberto: false });
  });
  it("construir rodando sem commit: o pacote dele já foi escrito, então vai um 'conteudo' depois", () => {
    expect(destinoDaEdicao([t("b1", "construir", "executando")])).toEqual({ atualizar: [], criar: true, publicarAberto: false });
  });
  it("projeto com commit e fila vazia: 'conteudo'; sem projeto e nada aberto: nada", () => {
    expect(destinoDaEdicao([t("b1", "construir", "feito", "abc")])).toMatchObject({ atualizar: [], criar: true });
    expect(destinoDaEdicao([t("b1", "construir", "cancelado"), t("z1", "zip", "falhou")])).toMatchObject({ atualizar: [], criar: false });
  });
  it("publicar, zip e desfazer não ganham o pacote; publicar aberto pede um 'conteudo' depois dele", () => {
    const d = destinoDaEdicao([t("p1", "publicar", "na_fila"), t("z1", "zip", "na_fila"), t("d1", "desfazer", "na_fila"), t("r1", "revisar", "na_fila"), t("k1", "conteudo", "na_fila"), t("c1", "construir", "feito", "abc")]);
    expect(d).toEqual({ atualizar: ["r1", "k1"], criar: true, publicarAberto: true });
  });
  it("o carimbo: sem carimbo é o mais velho; empate troca (o último a montar ganha)", () => {
    expect(pacoteMaisNovo(undefined, "2026-09-30T10:00:00Z")).toBe(true);
    expect(pacoteMaisNovo("2026-09-30T10:00:00Z", "2026-09-30T10:00:00.000Z")).toBe(true);
    expect(pacoteMaisNovo("2026-09-30T10:00:01Z", "2026-09-30T10:00:00Z")).toBe(false);
    expect(pacoteMaisNovo("2026-09-30T10:00:00Z", null)).toBe(false);
  });
  it("o pacote novo no pedido antigo: o construir mantém as seções pedidas e os anexos da conversa ficam", () => {
    const antigo = { secoes: ["hero"], arquivos: [{ destino: "referencias/anexo-1-a.png" }, { destino: "public/marca/logo.png" }] };
    const novo = { secoes: ["topo", "hero", "faq"], headline: "Novo", arquivos: [{ destino: "public/marca/logo.png" }] };
    expect(pacoteParaOPedido(antigo, novo, "construir")).toEqual({ secoes: ["hero"], headline: "Novo", arquivos: [{ destino: "public/marca/logo.png" }, { destino: "referencias/anexo-1-a.png" }] });
    expect(pacoteParaOPedido(antigo, novo, "conteudo").secoes).toEqual(["topo", "hero", "faq"]);
  });
});

describe("estado das seções na construção", () => {
  it("pronta pelo que o motor entregou (inclusive no meio), construindo agora, na fila, falhou e pendente", () => {
    const uids = ["topo", "hero", "problema", "bento", "faq", "rodape"];
    const e = estadoDasSecoes(
      [
        trabalho({ estado: "executando", resultado: { secoes_pedidas: ["hero", "problema", "bento"], secoes: ["hero"], secao_atual: "problema" } }),
        trabalho({ estado: "na_fila", resultado: { secoes_pedidas: ["faq"] } }),
        trabalho({ estado: "falhou", resultado: { secoes_pedidas: ["rodape"] } }),
        trabalho({ estado: "feito", resultado: { secoes_pedidas: ["topo"], secoes: ["topo"] } }),
      ],
      uids,
    );
    expect(e).toEqual({ topo: "pronta", hero: "pronta", problema: "construindo", bento: "na_fila", faq: "na_fila", rodape: "falhou" });
    expect(estadoDasSecoes([], ["hero"])).toEqual({ hero: "pendente" });
    // Seção desfeita por quebrar o build conta como falha; pronta vence a falha de antes.
    expect(estadoDasSecoes([trabalho({ estado: "feito", resultado: { secoes: ["hero"], secoes_desfeitas: [{ secao: "faq", motivo: "x" }] } })], ["hero", "faq"])).toEqual({ hero: "pronta", faq: "falhou" });
  });
});

describe("estado do motor", () => {
  const agora = Date.parse("2026-09-30T18:00:00Z");
  const vivo = { nome: "agencia-pc", visto_em: "2026-09-30T17:59:40Z", versao: "v", capacidades: { tunel: true, openrouter: true } };

  it("sem worker: nunca ligou, ou parou há tempos, com a fila à vista", () => {
    expect(estadoDoMotor(null, [], agora)).toMatchObject({ codigo: "sem_worker", rotulo: "Motor desligado: o worker nunca ligou", tom: "atencao" });
    const r = estadoDoMotor({ ...vivo, visto_em: "2026-09-30T15:00:00Z" }, [trabalho({ estado: "na_fila" })], agora);
    expect(r).toMatchObject({ codigo: "sem_worker", tom: "erro", fila: 1 });
    expect(r.rotulo).toMatch(/há 3 h/);
    expect(r.detalhe).toMatch(/1 pedido espera/);
  });

  it("caiu no meio de um trabalho", () => {
    expect(estadoDoMotor({ ...vivo, visto_em: "2026-09-30T17:40:00Z" }, [trabalho({ estado: "executando" })], agora).codigo).toBe("caiu");
  });

  it("rodando diz a seção, quantas saíram e o gasto contra o teto", () => {
    const r = estadoDoMotor(vivo, [trabalho({ estado: "executando", custo_usd: 0.12, teto_usd: 0.8, resultado: { secoes_pedidas: ["hero", "faq"], secoes: ["hero"], secao_atual: "faq" } }), trabalho({ estado: "na_fila" })], agora);
    expect(r).toMatchObject({ codigo: "rodando", tom: "andando", fila: 1 });
    expect(r.rotulo).toMatch(/^Construindo Perguntas/);
    expect(r.detalhe).toBe("1 de 2 seções · US$ 0,12 de US$ 0,80 · 1 na fila");
  });

  it("na fila e livre; os avisos dizem o que falta na máquina da agência", () => {
    expect(estadoDoMotor(vivo, [trabalho({ estado: "na_fila" })], agora)).toMatchObject({ codigo: "na_fila", rotulo: "1 pedido na fila" });
    expect(estadoDoMotor({ ...vivo, trabalho_id: "outro" }, [trabalho({ id: "meu", estado: "na_fila" })], agora).detalhe).toMatch(/outro site/);
    const livre = estadoDoMotor({ ...vivo, capacidades: { tunel: false, openrouter: false, anthropic: false, openai: false } }, [], agora);
    expect(livre).toMatchObject({ codigo: "livre", tom: "ok" });
    expect(livre.avisos.join(" ")).toMatch(/cloudflared/);
    expect(livre.avisos.join(" ")).toMatch(/sem chave/);
  });

  it("'há quanto' em português", () => {
    expect(haQuanto("2026-09-30T17:59:50Z", agora)).toBe("agora");
    expect(haQuanto("2026-09-30T17:55:00Z", agora)).toBe("há 5 min");
    expect(haQuanto("2026-09-28T18:00:00Z", agora)).toBe("há 2 dias");
    expect(haQuanto(null, agora)).toBe("");
  });
});

describe("utilidades do Desfazer", () => {
  it("igualdade ignora a ordem das chaves (o jsonb reordena) e trata ausente como nulo", () => {
    expect(igualProfundo({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(igualProfundo({ a: 1 }, { a: 1, b: null })).toBe(true);
    expect(igualProfundo([1, 2], [2, 1])).toBe(false);
  });

  it("alvo sem nada guardado não desfaz", () => {
    expect(planejarDesfazer(site(), [] as AlvoDaEdicao[])).toEqual({ conflito: expect.any(String) });
  });
});
