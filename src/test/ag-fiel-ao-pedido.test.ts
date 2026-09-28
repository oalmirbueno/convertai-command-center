import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avisoDaFidelidade,
  blocosSemNomeDaMarca,
  conferirTextoContraOPedido,
  duvidaDoAjuste,
  ehConfirmacao,
  estadoDaFidelidade,
  fatosDoTexto,
  palavrasDaMarca,
  pedidoConfirmado,
  perguntaDaFidelidade,
  perguntaDoAjusteClaro,
  textoDoAjusteFiel,
  VALIDADE_DA_DUVIDA_MS,
} from "../../supabase/functions/estudio-arte/fiel-ao-pedido";
import {
  antesDaMudanca,
  aplicarNaDirecao,
  mudancaSoDeTexto,
  normalizarMudancas,
  pedidoMexeNoTexto,
  PREFIXO_FOTO_DO_PEDIDO,
  traduzirApelidosDeFoto,
  type ContextoDasMudancas,
  type DirecaoParaMudar,
} from "../../supabase/functions/estudio-arte/conversa-do-diretor";
import {
  CONFIANCA_MINIMA_DA_CAMPANHA,
  decidirArteRapida,
  INSTRUCOES_DA_ARTE_RAPIDA,
  normalizarPedidoDaArteRapida,
  perguntasDaArteRapida,
} from "../../supabase/functions/_shared/arte-rapida";
import { CONFIANCA_MINIMA_DO_TIPO, tipoPelaResposta } from "../../supabase/functions/_shared/tipos-de-campanha";
import {
  camposParaMostrar,
  corpoDoAjusteDeTexto,
  lerMudanca,
  mudancaSoDeTexto as mudancaSoDeTextoNaTela,
  partesDoAjusteDeTexto,
  valorParaMostrar,
} from "@/components/mesa/diretorDoEstudioApi";
import type { ModeloIa } from "@/lib/mesa/api";

// Queixa do dono (28/09): "o estúdio de arte novo está meio alucinado, ele não
// faz o que eu peço (...) o agente tem que ser muito mais inteligente". Os
// casos abaixo são os pedidos reais da arte rápida 168142a5 (Stop Informática,
// promoção do mouse) que deram errado, mais os controles.

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");

const PEDIDO_DO_MOUSE =
  "Quero que você crie uma promoção desse mouse. Pega especificações desse mouse, pesquisa sobre o que esse mouse faz, ponha 90% off, oferta por tempo limitado, algo bem agressivo, bem fancy, bonito, em cima dessa imagem. Pode deixar essa imagem ali, coloca o sell de tudo certinho, deixa algo bem completinho, bem bacana, bem bonito.";
const CAMPANHA_OFERTA_STOP = "Oferta Stop. Mouse anunciado por R$ 9,90. Consulte pelo WhatsApp o modelo e a disponibilidade.";
const MARCA = palavrasDaMarca(["Stop Informática"]);

describe("conferência do texto contra o pedido (código)", () => {
  it("o texto real da v1 do mouse deixou de fora o 90% off e o tempo limitado: vira aviso", () => {
    const c = conferirTextoContraOPedido(
      [{ ordem: 1, texto: "Mouse por\nR$ 9,90\nConsulte o modelo e a disponibilidade pelo WhatsApp.\nConsulte pelo WhatsApp" }],
      { pedido: PEDIDO_DO_MOUSE, confirmados: [CAMPANHA_OFERTA_STOP] },
    );
    expect(c.faltando.map((f) => f.chave)).toEqual(expect.arrayContaining(["percentual:90", "promessa:limitado"]));
    expect(c.inventados).toEqual([]);
    expect(c.avisos.join(" ")).toContain('O pedido pede "90%"');
    expect(c.avisos.join(" ")).toContain("tempo ou estoque limitado");
    // Um aviso só para "90% off" (o percentual já diz o desconto).
    expect(c.faltando.some((f) => f.chave === "promessa:desconto")).toBe(false);
  });

  it("controle: o texto que atende o pedido do mouse não gera aviso (o R$ 9,90 vem da campanha)", () => {
    const c = conferirTextoContraOPedido([{ ordem: 1, texto: "Mouse com\n90% OFF\nOferta por tempo limitado\nPor R$ 9,90" }], {
      pedido: PEDIDO_DO_MOUSE,
      confirmados: [CAMPANHA_OFERTA_STOP],
    });
    expect(c.avisos).toEqual([]);
  });

  it("pedido simples sem preço não pode ganhar preço: o preço inventado vira aviso", () => {
    const pedido = "Faça um post convidando para a palestra de sexta sobre saúde da coluna com a Dra. Ana.";
    const c = conferirTextoContraOPedido([{ ordem: 1, texto: "Palestra: saúde da coluna\nSexta com a Dra. Ana\nIngresso R$ 29,90" }], { pedido, confirmados: ["Stop Informática"] });
    expect(c.inventados.map((i) => i.fato.chave)).toEqual(["preco:29,90"]);
    expect(c.avisos[0]).toContain('"R$ 29,90" (preço), que não está no pedido');
    const fiel = conferirTextoContraOPedido([{ ordem: 1, texto: "Palestra: saúde da coluna\nSexta, com a Dra. Ana\nVenha participar" }], { pedido });
    expect(fiel.avisos).toEqual([]);
  });

  it("loja ou marketplace fora do pedido e do contexto é inventado (o Lazada de 28/09)", () => {
    const c = conferirTextoContraOPedido([{ ordem: 1, texto: "Mouse na oferta\nR$ 9,90\nou compre agora pelo Lazada" }], { pedido: PEDIDO_DO_MOUSE, confirmados: [CAMPANHA_OFERTA_STOP] });
    expect(c.inventados.map((i) => i.fato.chave)).toContain("loja:lazada");
  });

  it("negação no pedido não conta como fato pedido, só na mesma oração", () => {
    expect(fatosDoTexto("faça sem preço e sem frete grátis", true).map((f) => f.chave)).toEqual([]);
    expect(fatosDoTexto("tira o preço e põe 90% off", true).map((f) => f.chave)).toEqual(expect.arrayContaining(["percentual:90"]));
  });

  it("lê preço, percentual, data e hora em formas comuns", () => {
    const chaves = fatosDoTexto("De R$ 1.299,90 por R$ 999 · 30% off · dia 29/09 às 19h").map((f) => f.chave);
    expect(chaves).toEqual(expect.arrayContaining(["preco:1299,90", "preco:999,00", "percentual:30", "data:29/9", "hora:19:00", "promessa:desconto"]));
  });
});

describe("texto combinado do ajuste (o ajuste não inventa texto)", () => {
  it("v2 real: as letras da logo (STOP INFORMÁTICA) e a gravação do mouse (CNT) não entram no texto combinado", () => {
    const pedidoV2 = "Ele não usou “seleo ali” na oferta 990 (...) então “mouse na oferta 990”, entendeu? Daí (...) “compra agora pelo WhatsApp na shop”, entendeu? A logo também tem que ser mais bonitinho.";
    const r = textoDoAjusteFiel(
      "Mouse por\nR$ 9,90\nConsulte o modelo e a disponibilidade pelo WhatsApp.\nConsulte pelo WhatsApp",
      "Mouse na oferta\nR$ 9,90\nCompre agora pelo WhatsApp\n\nSTOP\nINFORMÁTICA\n\nCNT",
      pedidoV2,
      MARCA,
    );
    expect(r.texto).toBe("Mouse na oferta\nR$ 9,90\nCompre agora pelo WhatsApp");
    expect(r.removidas).toEqual(["STOP", "INFORMÁTICA", "CNT"]);
  });

  it("'tira o preço' remove só o preço; o resto fica palavra por palavra", () => {
    const atual = "Mouse na oferta\nR$ 9,90\nCompre agora pelo WhatsApp";
    const r = textoDoAjusteFiel(atual, "Mouse na oferta\nCompre agora pelo WhatsApp", "tira o preço", MARCA);
    expect(r.texto).toBe("Mouse na oferta\nCompre agora pelo WhatsApp");
    expect(r.removidas).toEqual([]);
  });

  it("preço ou loja que o ajuste não pediu sai; reescrita criativa pedida passa", () => {
    const atual = "Mouse na oferta\nR$ 9,90\nCompre agora pelo WhatsApp";
    const inventou = textoDoAjusteFiel(atual, "Mouse na oferta\nDe R$ 99 por R$ 9,90\nCompre pela Shopee", "deixa a chamada mais forte", MARCA);
    expect(inventou.removidas).toEqual(["De R$ 99 por R$ 9,90", "Compre pela Shopee"]);
    const criativa = textoDoAjusteFiel(atual, "Mouse na oferta\nR$ 9,90\nGaranta o seu pelo WhatsApp", "deixa a chamada mais forte", MARCA);
    expect(criativa.texto).toBe("Mouse na oferta\nR$ 9,90\nGaranta o seu pelo WhatsApp");
  });

  it("nunca deixa a lâmina sem texto", () => {
    expect(textoDoAjusteFiel("Mouse na oferta", "STOP\nINFORMÁTICA", "centraliza a logo", MARCA).texto).toBe("Mouse na oferta");
  });

  it("bloco que é só o nome da marca sai da direção (a v7 tinha 'STOP' e 'INFORMÁTICA' como texto); a headline fica", () => {
    const r = blocosSemNomeDaMarca(
      [
        { papel: "headline", texto: "Mouse na oferta" },
        { papel: "subtitulo", texto: "STOP" },
        { papel: "apoio", texto: "INFORMÁTICA" },
      ],
      MARCA,
    );
    expect(r.blocos.map((b) => b.texto)).toEqual(["Mouse na oferta"]);
    expect(r.removidos).toEqual(["STOP", "INFORMÁTICA"]);
    expect(blocosSemNomeDaMarca([{ papel: "headline", texto: "Stop" }, { papel: "apoio", texto: "Informática" }], MARCA).blocos.length).toBe(1);
  });
});

describe("dúvida no ajuste: uma pergunta curta, sem gerar", () => {
  it("a pergunta do Jev tem os quatro caminhos e os exemplos reais", () => {
    const q = perguntaDoAjusteClaro();
    expect(q.type).toBe("choice");
    const c = q.criteria as Record<string, { examples: string[] }>;
    expect(Object.keys(c)).toEqual(["claro", "ruido_de_ditado", "nome_fora_do_contexto", "vago"]);
    expect(c.nome_fora_do_contexto.examples.join(" ")).toContain("Lazada");
    expect(c.claro.examples).toEqual(expect.arrayContaining(["tira o preço", "deixa mais minimalista, com menos elementos"]));
  });

  it("Jev ao vivo em 28/09: v4 (Lazada) e v3 (select, label desktop) viram pergunta; controles seguem", () => {
    // Respostas reais do Jev (jev-latest) às mensagens reais do dono.
    expect(duvidaDoAjuste({ choice: "nome_fora_do_contexto", confidence: 0.96 }, { entendi: "alinhar a linha do Lazada" })!.pergunta).toContain("não aparece na arte");
    expect(duvidaDoAjuste({ choice: "ruido_de_ditado", confidence: 0.98 }, {})!.motivo).toBe("ruido_de_ditado");
    expect(duvidaDoAjuste({ choice: "ruido_de_ditado", confidence: 0.39 }, {})).toBeNull();
    expect(duvidaDoAjuste({ choice: "claro", confidence: 1 }, {})).toBeNull();
    expect(duvidaDoAjuste({ choice: "claro", confidence: 0.93 }, {})).toBeNull();
    expect(duvidaDoAjuste({ choice: "claro", confidence: 0.32 }, {})).toBeNull();
  });

  it("a pergunta do leitor vale mesmo com o Jev em silêncio", () => {
    expect(duvidaDoAjuste(null, { pergunta: "Lazada é isso mesmo?" })).toEqual({ pergunta: "Lazada é isso mesmo?", motivo: "leitura" });
  });

  it("'sim' retoma o pedido pendente da mesma lâmina; o mesmo pedido de novo também confirma", () => {
    const agora = Date.parse("2026-09-28T20:00:00Z");
    const g = { ordem: 1, pedido: "Alinhe 'ou compre agora pelo Lazada'", pergunta: "?", em: "2026-09-28T19:50:00Z" };
    expect(pedidoConfirmado("sim", 1, g, agora)).toEqual({ pedido: g.pedido, confirmado: true });
    expect(pedidoConfirmado("pode seguir", 1, g, agora).confirmado).toBe(true);
    expect(pedidoConfirmado("Alinhe 'ou compre agora pelo Lazada'", 1, g, agora).confirmado).toBe(true);
    expect(pedidoConfirmado("sim", 2, g, agora).confirmado).toBe(false);
    expect(pedidoConfirmado("sim", 1, g, agora + VALIDADE_DA_DUVIDA_MS).confirmado).toBe(false);
    expect(pedidoConfirmado("tira o preço", 1, g, agora)).toEqual({ pedido: "tira o preço", confirmado: false });
    expect(ehConfirmacao("Isso mesmo!")).toBe(true);
    expect(ehConfirmacao("sim, mas tira o preço também e sobe a logo")).toBe(false);
  });

  it("o ajuste guarda a dúvida, responde 409 sem gerar imagem e recorta a área marcada para o leitor", () => {
    const a = estudio.slice(estudio.indexOf("async function ajustarCard("), estudio.indexOf("async function corrigirCard("));
    expect(a).toContain("pedidoConfirmado(pedidoBruto, ordem, t.direcao.duvida_do_ajuste ?? null)");
    expect(a).toContain('"ajuste_com_duvida"');
    expect(a.indexOf('"ajuste_com_duvida"')).toBeLessThan(a.indexOf("chamarImagem("));
    expect(a).toContain("recorteDasAreas(atual, areas)");
    expect(a).toContain("perguntaDoAjusteClaro()");
    expect(a).toContain("textoDoAjusteFiel(card.texto_exato");
    expect(estudio).toContain('required: ["instrucao_edicao", "texto_exato", "memoria", "entendi", "pergunta"]');
  });
});

describe("nota do Jev para a fidelidade (só aviso)", () => {
  it("Score de 4 níveis, do contraria ao fiel, com o estado do pedido", () => {
    const q = perguntaDaFidelidade();
    expect(q.type).toBe("score");
    expect((q.criteria as string[]).length).toBe(4);
    const e = estadoDaFidelidade(PEDIDO_DO_MOUSE, [CAMPANHA_OFERTA_STOP], [{ ordem: 1, texto: "Mouse por R$ 9,90" }]);
    expect(e).toMatchObject({ pedido: PEDIDO_DO_MOUSE, texto_da_arte: [{ lamina: 1, texto: "Mouse por R$ 9,90" }] });
  });

  it("notas reais de 28/09: v1 do mouse (0,37) e preço inventado (1,1) avisam; controles (2,15 e 2,81) não", () => {
    expect(avisoDaFidelidade({ score: 0.37 })).toContain("contrariar");
    expect(avisoDaFidelidade({ score: 1.1 })).toContain("acrescentar fato");
    expect(avisoDaFidelidade({ score: 2.15 })).toBeNull();
    expect(avisoDaFidelidade({ score: 2.81 })).toBeNull();
    expect(avisoDaFidelidade(null)).toBeNull();
  });

  it("a conferência roda depois da direção, vai para a direção e para os avisos, e nunca gera de novo", () => {
    const p = estudio.slice(estudio.indexOf("async function prepararItem("), estudio.indexOf("// ------------------------------------------------------ fiel ao pedido (frente AG)"));
    expect(p).toContain("conferirTextoDoPedido(ch, clientId, trabalhoId");
    expect(p).toContain("direcao.conferencia_do_pedido =");
    expect(p).toContain("avisos_do_pedido: avisosDoPedido");
    const f = estudio.slice(estudio.indexOf("async function conferirTextoDoPedido("), estudio.indexOf("async function conferirTextoDoPedido(") + 2500);
    expect(f).not.toContain("chamarImagem(");
    expect(f).not.toContain("gerarCard(");
  });
});

describe("o pedido manda na direção", () => {
  it("a arte rápida põe o pedido acima da campanha e da marca e proíbe inventar", () => {
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("O PEDIDO DA EQUIPE É A FONTE DA VERDADE");
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("nunca escreva o oposto do pedido");
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("Você não pesquisa na internet");
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain('"sell" ou "seleo" = selo');
    expect(INSTRUCOES_DA_ARTE_RAPIDA).not.toContain("a peça é daquela campanha (tema, oferta, preço");
  });

  it("o diretor devolve avisos para a equipe e tira o nome da marca dos blocos", () => {
    expect(estudio).toContain('required: ["conceito", "fio_visual", "carrossel_infinito", "cards", "avisos_para_a_equipe"]');
    expect(estudio).toContain("O PEDIDO DA EQUIPE É A FONTE DA VERDADE (\\`pedido_da_equipe\\`");
    expect(estudio).toContain("blocosSemNomeDaMarca(");
  });

  it("'Automático' só com confiança alta: campanha 0,8, tipo 0,7", () => {
    expect(CONFIANCA_MINIMA_DA_CAMPANHA).toBe(0.8);
    expect(CONFIANCA_MINIMA_DO_TIPO).toBe(0.7);
    expect(tipoPelaResposta({ choice: "promocao", confidence: 0.6 })).toBeNull();
    const p = normalizarPedidoDaArteRapida({ pedido: "promoção do mouse", campanha_id: "auto", arquivos: [] }, "cliente");
    const q = perguntasDaArteRapida(p, [{ id: "b5991918-6c40-46c1-ba58-da9b43b79fd3", nome: "Oferta Stop" }]);
    const media = decidirArteRapida(p, q, { campanha: { choice: "c1", confidence: 0.7 } });
    expect(media.campanha_id).toBeNull();
    expect(media.avisos.join(" ")).toContain("seguiu só a marca");
    expect(decidirArteRapida(p, q, { campanha: { choice: "c1", confidence: 0.85 } }).campanha_id).toBe("b5991918-6c40-46c1-ba58-da9b43b79fd3");
  });

  it("peça em dúvida: com regra, vale a regra; sem regra, a escolha do Jev com aviso", () => {
    const comRegra = normalizarPedidoDaArteRapida({ pedido: "carrossel com as 5 dicas de postura" }, "cliente");
    expect(decidirArteRapida(comRegra, perguntasDaArteRapida(comRegra, []), { peca: { choice: "unica", confidence: 0.5 } })).toMatchObject({ peca: "carrossel", peca_por: "regra" });
    const semRegra = normalizarPedidoDaArteRapida({ pedido: "promoção do mouse" }, "cliente");
    const d = decidirArteRapida(semRegra, perguntasDaArteRapida(semRegra, []), { peca: { choice: "unica", confidence: 0.5 } });
    expect(d.peca).toBe("unica");
    expect(d.avisos.join(" ")).toContain("Não ficou claro se é arte única ou carrossel");
  });
});

// ------------------------------------------------------------------ o agente do lado (conversa com o diretor)

const direcao = (): DirecaoParaMudar => ({
  conceito: "Promoção do mouse",
  fio_visual: "Fundo claro, grafite e vermelho",
  carrossel_infinito: false,
  cards: [
    {
      ordem: 1,
      funcao: "capa",
      texto_exato: "Mouse na oferta\nR$ 9,90\nCompre agora pelo WhatsApp",
      blocos: [
        { papel: "headline", texto: "Mouse na oferta" },
        { papel: "numero", texto: "R$ 9,90" },
        { papel: "cta", texto: "Compre agora pelo WhatsApp" },
      ],
      layout: {
        zona_texto: "topo-esquerda",
        alinhamento: "esquerda",
        imagem: "Foto F1 do mouse",
        ponto_focal: "O preço",
        fundo: "Superfície clara",
        tratamento: "Duas zonas",
        cor_fundo: "#F7F7F7",
        cor_texto: "#242629",
        cor_destaque: "#D10A0A",
      },
      composicao: "",
      ilustracao: "",
      prompt_imagem: "",
      evitar: "",
      fotos_livres: [{ caminho: "cli/pedidos/mouse.jpg", papel: "fundo", nota: "Foto real do pedido" }],
    },
  ] as DirecaoParaMudar["cards"],
});

const ctx = (extra: Partial<ContextoDasMudancas> = {}): ContextoDasMudancas => ({
  ordens: [1],
  paleta: ["#242629", "#D10A0A", "#F7F7F7", "#1E8E3E"],
  acervo: new Set(),
  permitirTexto: true,
  semCaixa: new Set([1]),
  continuo: false,
  ...extra,
});

describe("o agente do lado entende o ajuste fino", () => {
  it("'tira o preço' conta como pedido de texto e remove só o preço", () => {
    expect(pedidoMexeNoTexto("tira o preço")).toBe(true);
    expect(pedidoMexeNoTexto("tira a data")).toBe(true);
    // Tamanho do selo não é texto: vai em tratamento, sem mexer no texto.
    expect(pedidoMexeNoTexto("deixa o selo menor")).toBe(false);
    expect(pedidoMexeNoTexto("mais minimalista")).toBe(false);
    const d = direcao();
    const { mudancas, avisos } = normalizarMudancas(
      [{ alvo: "lamina", ordem: 1, titulo: "Sem o preço", motivo: "pedido", campos: { texto_exato: "Mouse na oferta\nCompre agora pelo WhatsApp" } }],
      ctx({ fontesDoTexto: { atual: { 1: d.cards[0].texto_exato }, pedido: "tira o preço", confirmados: [], marca: MARCA } }),
    );
    expect(avisos).toEqual([]);
    expect(mudancas[0].campos).toEqual({ texto_exato: "Mouse na oferta\nCompre agora pelo WhatsApp" });
    const r = aplicarNaDirecao(d, mudancas);
    expect(r.direcao.cards[0].texto_exato).toBe("Mouse na oferta\nCompre agora pelo WhatsApp");
    expect(r.direcao.cards[0].layout).toEqual(d.cards[0].layout);
    expect(r.direcao.cards[0].fotos_livres).toEqual(d.cards[0].fotos_livres);
    expect(mudancaSoDeTexto(mudancas[0])).toBe(true);
  });

  it("'troca a cor do título para verde da marca' muda só a cor, com antes e depois", () => {
    const d = direcao();
    const { mudancas } = normalizarMudancas([{ alvo: "lamina", ordem: 1, titulo: "Título verde", motivo: "pedido", campos: { cor_texto: "#1e8e3e" } }], ctx());
    expect(mudancas[0].campos).toEqual({ cor_texto: "#1E8E3E" });
    expect(antesDaMudanca(d, mudancas[0])).toEqual({ cor_texto: "#242629" });
    const r = aplicarNaDirecao(d, mudancas);
    const antes = d.cards[0];
    const depois = r.direcao.cards[0];
    expect(depois.layout!.cor_texto).toBe("#1E8E3E");
    expect({ ...depois.layout, cor_texto: antes.layout!.cor_texto }).toEqual(antes.layout);
    expect(depois.texto_exato).toBe(antes.texto_exato);
    expect(depois.fotos_livres).toEqual(antes.fotos_livres);
    expect(mudancaSoDeTexto(mudancas[0])).toBe(true);
  });

  it("texto novo com loja inventada ou letras da logo não passa", () => {
    const d = direcao();
    const { mudancas, avisos } = normalizarMudancas(
      [{ alvo: "lamina", ordem: 1, titulo: "CTA", motivo: "", campos: { texto_exato: "Mouse na oferta\nR$ 9,90\nou compre agora pelo Lazada\nSTOP INFORMÁTICA" } }],
      ctx({ fontesDoTexto: { atual: { 1: d.cards[0].texto_exato }, pedido: "muda o texto da chamada", confirmados: [CAMPANHA_OFERTA_STOP], marca: MARCA } }),
    );
    expect(avisos.join(" ")).toContain('"ou compre agora pelo Lazada"');
    expect(avisos.join(" ")).toContain('"STOP INFORMÁTICA"');
    // Fica só o que veio do texto atual (a equipe vê antes e depois e decide).
    expect(mudancas[0].campos).toEqual({ texto_exato: "Mouse na oferta\nR$ 9,90" });
  });

  it("'troca a foto pela segunda': o apelido F2 vira a foto do pedido e a base da lâmina, sem tocar no resto", () => {
    const valor = `${PREFIXO_FOTO_DO_PEDIDO}cli/pedidos/mouse-2.jpg`;
    const bruto = traduzirApelidosDeFoto([{ alvo: "lamina", ordem: 1, titulo: "Segunda foto", motivo: "", campos: { foto_acervo: "f2" } }], { F1: `${PREFIXO_FOTO_DO_PEDIDO}cli/pedidos/mouse.jpg`, F2: valor });
    const { mudancas } = normalizarMudancas(bruto, ctx({ fotosDoPedido: new Set([valor]) }));
    expect(mudancas[0].campos).toEqual({ foto_acervo: valor });
    const d = direcao();
    const r = aplicarNaDirecao(d, mudancas);
    expect(r.direcao.cards[0].fotos_livres).toEqual([{ caminho: "cli/pedidos/mouse-2.jpg", papel: "fundo", nota: expect.any(String) }]);
    expect(r.direcao.cards[0].imagens_ids).toEqual([]);
    expect(r.direcao.cards[0].texto_exato).toBe(d.cards[0].texto_exato);
    // Apelido inventado não vira foto.
    expect(normalizarMudancas(traduzirApelidosDeFoto([{ alvo: "lamina", ordem: 1, titulo: "x", motivo: "", campos: { foto_acervo: "F9" } }], { F1: "x" }), ctx()).mudancas).toEqual([]);
  });

  it("a conversa manda fotos por apelido, o estado da lâmina e o pedido original; nunca o id", () => {
    const c = estudio.slice(estudio.indexOf("async function conversar("), estudio.indexOf("function resumoDasPropostas("));
    expect(c).toContain("traduzirApelidosDeFoto(bruto.mudancas, apelidos)");
    expect(c).toContain("texto_lido_na_arte:");
    expect(c).toContain("leva_logo: levaLogo(t, c.ordem)");
    expect(c).toContain("pedido_original: arteRapida ? arteRapida.pedido : null");
    expect(c).toContain("antes: antesDaMudanca(t.direcao, m, rotuloDaFoto)");
    expect(c).not.toContain("acervo: acervo.map((a) => ({ id: a.id");
  });

  it("texto e cor aplicados mudam só a área do texto (ajustar_texto, máscara da autocorreção), sem refazer a lâmina", () => {
    expect(estudio).toContain("ajustar_texto: ajustarTextoDaLamina,");
    const f = estudio.slice(estudio.indexOf("async function ajustarTextoDaLamina("), estudio.indexOf("// ------------------------------------------------------------ corrigir card"));
    expect(f).toContain("areasDeDesenho(card, totalCards(t), false, quadroDoCard(t, card))");
    expect(f).toContain("conversa: true");
    expect(f).not.toContain("gerarCard(");
  });
});

describe("tela do diretor: antes e depois e o botão de ajustar só o texto", () => {
  const mud = lerMudanca({ id: "m1", alvo: "lamina", ordem: 1, titulo: "Título verde", motivo: "", campos: { cor_texto: "#1E8E3E" }, antes: { cor_texto: "#242629" } })!;

  it("mostra o valor de antes e o de depois", () => {
    expect(camposParaMostrar(mud)).toEqual([{ campo: "cor_texto", rotulo: "Cor do texto", valor: "#1E8E3E", hex: "#1E8E3E", antes: "#242629", hexAntes: "#242629" }]);
    const semAntes = lerMudanca({ id: "m2", alvo: "lamina", ordem: 1, titulo: "x", motivo: "", campos: { fundo: "verde" } })!;
    expect(camposParaMostrar(semAntes)[0].antes).toBeNull();
    expect(valorParaMostrar("foto_acervo", "pedido:cli/pedidos/a.jpg")).toBe("Usar outra foto do pedido");
  });

  it("só texto e cor numa lâmina ganham 'Aplicar e ajustar o texto'", () => {
    expect(mudancaSoDeTextoNaTela(mud)).toBe(true);
    expect(mudancaSoDeTextoNaTela(lerMudanca({ id: "m3", alvo: "lamina", ordem: 1, titulo: "x", motivo: "", campos: { cor_texto: "#1E8E3E", fundo: "praia" } })!)).toBe(false);
    expect(mudancaSoDeTextoNaTela(lerMudanca({ id: "m4", alvo: "conjunto", ordem: 0, titulo: "x", motivo: "", campos: { conceito: "novo" } })!)).toBe(false);
    expect(corpoDoAjusteDeTexto("t1", 2)).toEqual({ acao: "ajustar_texto", trabalho_id: "t1", ordem: 2 });
    const catalogo = [
      { id: "luna", tipo: "texto", ativo: true, padrao_para: ["leitura"] },
      { id: "sunburst", tipo: "imagem", ativo: true, padrao_para: ["imagem"] },
    ] as unknown as ModeloIa[];
    const partes = partesDoAjusteDeTexto(catalogo, "sunburst", "alta");
    expect(partes.map((p) => p.tipo)).toEqual(["texto", "imagem"]);
    expect(partes[1]).toMatchObject({ modeloId: "sunburst", imagens: 1, qualidade: "alta" });
  });

  it("o cartão mostra antes e depois e o botão chama o ajuste só do texto", () => {
    const tela = ler("src/components/mesa/DiretorDoEstudio.tsx");
    expect(tela).toContain("data-antes");
    expect(tela).toContain("Aplicar e ajustar o texto");
    expect(tela).toContain("ajustarTextoDaLamina(trabalho.id, mud.ordem as number)");
  });
});
