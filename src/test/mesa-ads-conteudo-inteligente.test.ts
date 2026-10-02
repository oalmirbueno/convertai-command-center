import { describe, expect, it, vi } from "vitest";
import {
  ANGULOS_DE_VENDA,
  angulosParaVariacoes,
  anguloDeVenda,
  blocoDeRespostaDireta,
  conferirAnuncio,
  fatosDaOferta,
  pedidoDeReescrita,
} from "../../supabase/functions/mesa-ads/modulos/copy-de-resposta";
import {
  avisosDaFidelidade,
  blocoDaReplicacao,
  fidelidadeAds,
  lerTextoDaReferencia,
  normalizarTextoLido,
  textoLidoDaFicha,
} from "../../supabase/functions/mesa-ads/modulos/replicar-referencia";
import {
  blocoDoMundoReal,
  entidadesReais,
  logoDaRespostaDoCommons,
  logoDoSimpleIcons,
  MARCAS_REAIS,
  mundoRealParaGravar,
  pedeTutorial,
  precisaPesquisar,
  pesquisarFatosReais,
  regraDosLogosParaArte,
  resolverLogosReais,
} from "../../supabase/functions/mesa-ads/modulos/mundo-real";
import {
  cardsComTextoNovo,
  copyComProposta,
  copyConfirmada,
  copyDesfeita,
  pedeRefazerTudo,
  propostaDoLote,
  reescreverReprovadas,
} from "../../supabase/functions/mesa-ads/modulos/conteudo-do-estudio";

/**
 * Estúdio Ads mais inteligente (pedido do dono em 02/10/2026): copy de
 * resposta direta com ângulos de venda e conferente anti-genérico (uma
 * reescrita só), replicar referência com Fidelidade (Idêntico, Próximo,
 * Criativo) lendo o texto da imagem, mundo real (pesquisa web, logos reais
 * com licença e fontes) e o "refaz tudo" que troca no lugar, com Confirmar e
 * Desfazer. Modelo, visão e web são falsos aqui.
 */

const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const OFERTA = {
  nome: "Limpeza de sofá a seco em Curitiba",
  para_quem: "famílias com criança e pet em Curitiba",
  promessa: "sofá seco e sem cheiro no mesmo dia",
  mecanismo: "higienização a seco com extratora",
  entregaveis: ["limpeza de 3 lugares", "impermeabilização opcional"],
  bonus: ["higienização de 2 almofadas"],
  garantia: "refaz em 7 dias se a mancha voltar",
  urgencia_real: null,
  ancoragem: "a partir de R$ 189",
  cta: "chamar no WhatsApp",
};
const BRIEFING = { oferta: { produto: null, preco_confirmado: "R$ 189" }, publico: { quem: "famílias", situacoes: [{ texto: "sofá com xixi do cachorro", fonte: "dono" }] }, objecoes: [{ texto: "demora para secar" }], provas: [{ tipo: "numero", texto: "1.200 sofás limpos desde 2019", autorizado: true }] };

describe("copy de resposta direta", () => {
  it("fatos da oferta trazem o concreto e os termos que provam especificidade", () => {
    const f = fatosDaOferta(OFERTA, BRIEFING);
    expect(f.linhas.join("\n")).toContain("Limpeza de sofá a seco em Curitiba");
    expect(f.linhas.join("\n")).toContain("1.200 sofás limpos desde 2019");
    expect(f.linhas.join("\n")).toContain("demora para secar");
    expect(f.termos).toEqual(expect.arrayContaining(["limpeza", "curitiba", "extratora"]));
    expect(f.temProva).toBe(true);
    expect(f.temUrgencia).toBe(false);
  });

  it("prova sem autorização não conta como prova", () => {
    const f = fatosDaOferta(OFERTA, { provas: [{ texto: "depoimento da Ana", autorizado: false }] });
    expect(f.temProva).toBe(false);
  });

  it("variações em ângulos de venda diferentes; sem urgência real, sem ângulo de urgência", () => {
    const a = angulosParaVariacoes(5, { temProva: true, temUrgencia: false });
    expect(a).toEqual(["dor", "desejo", "prova", "objecao", "dor"]);
    expect(angulosParaVariacoes(3, { temProva: false, temUrgencia: true })).toEqual(["dor", "desejo", "objecao"]);
    expect(anguloDeVenda("Objeção")).toBe("objecao");
    expect(ANGULOS_DE_VENDA.urgencia.rotulo).toBe("Urgência");
  });

  it("o bloco do prompt tem a estrutura, os fatos, os ângulos e a política da Meta, sem travessão", () => {
    const f = fatosDaOferta(OFERTA, BRIEFING);
    const b = blocoDeRespostaDireta({ fatos: f, angulos: ["dor", "prova"], nicho: "limpeza" });
    expect(b).toContain("gancho na PRIMEIRA linha");
    expect(b).toContain("variação 1: Dor");
    expect(b).toContain("variação 2: Prova");
    expect(b).toContain("atributo pessoal");
    expect(b).toContain("Limpeza de sofá a seco em Curitiba");
    expect(TRAVESSAO.test(b)).toBe(false);
  });

  it("o conferente reprova genérico, gancho fraco, atributo pessoal e promessa, e aprova o específico", () => {
    const f = fatosDaOferta(OFERTA, BRIEFING);
    const generica = conferirAnuncio({ texto_principal: "Descubra a solução ideal para sua casa com qualidade que você merece.", titulo: "Aproveite já", cta_meta: "Saiba mais" }, f);
    expect(generica.reprovada).toBe(true);
    const tipos = generica.motivos.map((m) => m.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["cliche", "gancho_fraco", "sem_fato", "sem_cta"]));

    const atributo = conferirAnuncio({ texto_principal: "Você está acima do peso? Limpeza de sofá em Curitiba. Chame no WhatsApp.", titulo: "x" }, f);
    expect(atributo.motivos.map((m) => m.tipo)).toContain("atributo_pessoal");

    const promessa = conferirAnuncio({ texto_principal: "Limpeza de sofá em Curitiba com resultado garantido. Chame no WhatsApp.", titulo: "x" }, f);
    expect(promessa.motivos.map((m) => m.tipo)).toContain("promessa");

    const boa = conferirAnuncio({
      texto_principal: "Xixi do cachorro no sofá? Em Curitiba, limpeza a seco com extratora e sofá seco no mesmo dia.",
      texto_principal_longo: "Xixi do cachorro no sofá? Em Curitiba, limpeza a seco com extratora e sofá seco no mesmo dia. A partir de R$ 189. Chame no WhatsApp e agende.",
      titulo: "Sofá seco no mesmo dia",
    }, f);
    expect(boa.reprovada).toBe(false);
    expect(boa.citados.length).toBeGreaterThan(1);
  });

  it("o pedido da reescrita leva os motivos e os fatos", () => {
    const f = fatosDaOferta(OFERTA, BRIEFING);
    const p = pedidoDeReescrita([{ indice: 0, copy: { texto_principal: "Descubra" }, motivos: ["Gancho fraco."], angulo: "dor" }], f);
    expect(p).toContain("uma vez só");
    expect(p).toContain("Gancho fraco.");
    expect(p).toContain("extratora");
  });
});

describe("reescrita única das reprovadas", () => {
  const f = fatosDaOferta(OFERTA, BRIEFING);
  const boa = { variacao: 1, angulo_de_venda: "dor", texto_principal: "Xixi do cachorro no sofá? Limpeza a seco em Curitiba, seco no mesmo dia.", texto_principal_longo: "Xixi do cachorro no sofá? Limpeza a seco em Curitiba, seco no mesmo dia. Chame no WhatsApp.", titulo: "Sofá seco hoje", headline_arte: "Sofá seco hoje", cta_arte: "Chame no WhatsApp" };
  const ruim = { variacao: 2, angulo_de_venda: "desejo", texto_principal: "Descubra a solução ideal.", titulo: "Aproveite já", headline_arte: "Qualidade que você merece", cta_arte: "" };

  it("chama o modelo uma vez só, só para as reprovadas, e troca no lugar", async () => {
    const escrever = vi.fn(async () => [{ ...boa, variacao: 2, angulo_de_venda: "prova", texto_principal: "1.200 sofás limpos em Curitiba desde 2019: o seu seca no mesmo dia." }]);
    const r = await reescreverReprovadas(escrever, [boa, ruim], f);
    expect(escrever).toHaveBeenCalledTimes(1);
    expect(String(escrever.mock.calls[0][0])).toContain("REPROVADAS");
    expect(r.reescritas).toEqual([1]);
    expect(r.variacoes[0]).toBe(boa);
    expect(r.variacoes[1].angulo_de_venda).toBe("desejo");
    expect(r.variacoes[1].variacao).toBe(2);
    expect(r.conferencias[1].reprovada).toBe(false);
  });

  it("nada reprovado: não chama o modelo", async () => {
    const escrever = vi.fn(async () => []);
    const r = await reescreverReprovadas(escrever, [boa], f);
    expect(escrever).not.toHaveBeenCalled();
    expect(r.reescritas).toEqual([]);
  });

  it("reescrita pior ou com falha: fica a original, sem segunda tentativa", async () => {
    const pior = vi.fn(async () => [{ texto_principal: "Descubra a solução ideal. Você está acima do peso?", titulo: "Aproveite já" }]);
    const r = await reescreverReprovadas(pior, [ruim], f);
    expect(pior).toHaveBeenCalledTimes(1);
    expect(r.variacoes[0]).toBe(ruim);
    const falha = vi.fn(async () => { throw new Error("modelo fora"); });
    const r2 = await reescreverReprovadas(falha, [ruim], f);
    expect(falha).toHaveBeenCalledTimes(1);
    expect(r2.erro).toContain("modelo fora");
    expect(r2.variacoes[0]).toBe(ruim);
  });
});

describe("replicar referência com Fidelidade", () => {
  it("lê os três níveis e aceita os nomes do Estúdio", () => {
    expect(fidelidadeAds("Idêntico")).toBe("identico");
    expect(fidelidadeAds("proxima")).toBe("proximo");
    expect(fidelidadeAds("inspirada")).toBe("criativo");
    expect(fidelidadeAds("qualquer")).toBeNull();
  });

  it("a visão lê o texto da imagem com o leitor barato e o custo volta", async () => {
    const chamar = vi.fn(async () => ({
      json: { textos: [{ ordem: 2, texto: "Agende pelo link", papel: "cta" }, { ordem: 1, texto: "3 sinais de que seu sofá precisa de limpeza", papel: "gancho" }, { ordem: 3, texto: " ", papel: "apoio" }], gancho: null, modelo_do_gancho: "lista com número", cta: "Agende pelo link" },
      custoUsd: 0.0021,
      saldoUsd: 9.5,
      modeloId: "leitor-barato",
    }));
    const r = await lerTextoDaReferencia(chamar, [{ bytes: new Uint8Array([1]), mime: "image/png" }], { titulo: "Ref" });
    expect(chamar).toHaveBeenCalledTimes(1);
    expect(r.custoUsd).toBe(0.0021);
    expect(r.lido?.textos.map((t) => t.texto)).toEqual(["3 sinais de que seu sofá precisa de limpeza", "Agende pelo link"]);
    expect(r.lido?.gancho).toBe("3 sinais de que seu sofá precisa de limpeza");
    expect(r.lido?.estrutura).toEqual(["gancho", "cta"]);
    expect(r.lido?.modelo).toBe("leitor-barato");
  });

  it("sem imagem, não chama a visão nem cobra", async () => {
    const chamar = vi.fn();
    const r = await lerTextoDaReferencia(chamar as never, [], { titulo: "Ref" });
    expect(chamar).not.toHaveBeenCalled();
    expect(r).toEqual({ lido: null, custoUsd: 0, saldoUsd: null });
  });

  it("o texto lido fica na ficha e volta igual", () => {
    const lido = normalizarTextoLido({ textos: [{ ordem: 1, texto: "Seu sofá tem cheiro?", papel: "gancho" }], gancho: "Seu sofá tem cheiro?", modelo_do_gancho: "pergunta", cta: null }, "m", "2026-10-02T10:00:00Z");
    expect(textoLidoDaFicha({ texto_lido: lido })?.gancho).toBe("Seu sofá tem cheiro?");
    expect(textoLidoDaFicha({})).toBeNull();
  });

  it("cada nível muda o que se mantém, e nunca copia marca, número ou prova da referência", () => {
    const lido = normalizarTextoLido({ textos: [{ ordem: 1, texto: "Seu sofá tem cheiro?", papel: "gancho" }, { ordem: 2, texto: "Chame já", papel: "cta" }], gancho: "Seu sofá tem cheiro?", modelo_do_gancho: "pergunta de dor", cta: "Chame já" }, "m");
    const identico = blocoDaReplicacao({ fidelidade: "identico", titulo: "Ref", lido, ficha: { mecanismo: "pergunta que expõe a dor" } });
    const proximo = blocoDaReplicacao({ fidelidade: "proximo", titulo: "Ref", lido });
    const criativo = blocoDaReplicacao({ fidelidade: "criativo", titulo: "Ref", lido });
    expect(identico).toContain("IDÊNTICO");
    expect(identico).toContain("bloco a bloco");
    expect(identico).toContain("Sequência da referência: gancho > CTA");
    expect(identico).toContain("pergunta que expõe a dor");
    expect(proximo).toContain("voz do cliente");
    expect(criativo).toContain("ideia central");
    for (const b of [identico, proximo, criativo]) {
      expect(b).toContain("Nunca copie da referência");
      expect(TRAVESSAO.test(b)).toBe(false);
    }
  });

  it("aviso quando o Idêntico perde o molde do gancho ou a quantidade de blocos", () => {
    const lido = normalizarTextoLido({ textos: [{ ordem: 1, texto: "Seu sofá tem cheiro?", papel: "gancho" }, { ordem: 2, texto: "Limpeza hoje", papel: "apoio" }, { ordem: 3, texto: "Chame", papel: "cta" }], gancho: "Seu sofá tem cheiro?", modelo_do_gancho: null, cta: null }, "m");
    const avisos = avisosDaFidelidade({ fidelidade: "identico", lido, headline: "Sofá limpo hoje", textoNaArte: ["Sofá limpo hoje"], textoPrincipal: "" });
    expect(avisos.join(" ")).toContain("pergunta");
    expect(avisos.join(" ")).toContain("3 blocos");
    expect(avisosDaFidelidade({ fidelidade: "criativo", lido, headline: "x", textoNaArte: [], textoPrincipal: "" })).toEqual([]);
  });
});

describe("mundo real: pesquisa, logos com licença e fontes", () => {
  it("acha marcas reais e tutorial sem confundir palavra comum", () => {
    expect(entidadesReais("Como ativar o Pix no Nubank pelo app").map((m) => m.id)).toEqual(["nubank", "pix"]);
    expect(entidadesReais("Agende pelo WhatsApp ou siga no Instagram").map((m) => m.id)).toEqual(["instagram", "whatsapp"]);
    expect(entidadesReais("Apareça no Google Meu Negócio").map((m) => m.id)).toEqual(["googlemeunegocio"]);
    expect(entidadesReais("vamos instalar o piso hoje")).toEqual([]);
    expect(pedeTutorial("Passo a passo para configurar o Instagram")).toBe(true);
    expect(pedeTutorial("cardápio do menu de verão")).toBe(false);
    expect(precisaPesquisar("Como ativar o modo profissional do Instagram")).toBe(true);
    expect(precisaPesquisar("Sofá limpo no mesmo dia")).toBe(false);
  });

  it("a pesquisa usa a busca web uma vez e guarda as fontes limpas", async () => {
    const chamar = vi.fn(async () => ({
      json: { fatos: ["O Pix funciona 24 horas"], passos: ["Abra o app", "Toque em Área Pix"], nomes_exatos: ["Área Pix"], alertas: [] },
      custoUsd: 0.01,
      saldoUsd: 5,
      fontes: [{ url: "https://www.bcb.gov.br/estabilidadefinanceira/pix", titulo: "Pix BCB" }, { url: "https://www.bcb.gov.br/estabilidadefinanceira/pix" }, { url: "javascript:alert(1)" }],
    }));
    const r = await pesquisarFatosReais(chamar, { assunto: "Como cadastrar chave Pix", entidades: entidadesReais("pix"), tutorial: true }, "2026-10-02T00:00:00Z");
    expect(chamar).toHaveBeenCalledTimes(1);
    expect(r.pesquisa.fontes).toEqual([{ titulo: "Pix BCB", url: "https://www.bcb.gov.br/estabilidadefinanceira/pix" }]);
    const bloco = blocoDoMundoReal(r.pesquisa, entidadesReais("pix"));
    expect(bloco).toContain("1) Abra o app");
    expect(bloco).toContain("Área Pix");
    expect(bloco).toContain("nunca desenhe nem imite logo");
  });

  it("logos: Simple Icons na versão fixa e Wikimedia com a licença da página", async () => {
    const whatsapp = MARCAS_REAIS.find((m) => m.id === "whatsapp")!;
    const si = logoDoSimpleIcons(whatsapp)!;
    expect(si.url).toBe("https://cdn.jsdelivr.net/npm/simple-icons@16/icons/whatsapp.svg");
    expect(si.licenca).toContain("CC0");
    const resposta = { query: { pages: { "9": { index: 2, title: "File:Outro.svg", imageinfo: [{ url: "https://exemplo.com/x.svg" }] }, "7": { index: 1, title: "File:WhatsApp.svg", imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg?utm=x", thumburl: "https://upload.wikimedia.org/thumb/WhatsApp.svg/512px-WhatsApp.svg.png?x=1", descriptionurl: "https://commons.wikimedia.org/wiki/File:WhatsApp.svg", extmetadata: { LicenseShortName: { value: "Public domain" }, Artist: { value: "<a href='x'>WhatsApp</a>" } } }] } } } };
    const wm = logoDaRespostaDoCommons(whatsapp, resposta)!;
    expect(wm.url).toBe("https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg");
    expect(wm.png_url).toBe("https://upload.wikimedia.org/thumb/WhatsApp.svg/512px-WhatsApp.svg.png");
    expect(wm.licenca).toContain("Public domain");
    expect(wm.autor).toBe("WhatsApp");
    const buscar = vi.fn(async () => resposta);
    const logos = await resolverLogosReais(buscar, [whatsapp]);
    expect(logos.map((l) => l.fonte)).toEqual(["Simple Icons", "Wikimedia Commons"]);
    const semCommons = await resolverLogosReais(async () => { throw new Error("fora"); }, [whatsapp]);
    expect(semCommons.map((l) => l.fonte)).toEqual(["Simple Icons"]);
    expect(regraDosLogosParaArte(logos)).toContain("não desenhe");
    const gravar = mundoRealParaGravar([whatsapp], null, logos)!;
    expect(gravar.fontes.join("\n")).toContain("Logo WhatsApp (Wikimedia Commons, Public domain");
  });
});

describe('"muda todo o conteúdo" troca no lugar, com Confirmar e Desfazer', () => {
  it("entende o pedido de trocar tudo e não confunde com ajuste pontual", () => {
    for (const t of ["muda todo o conteúdo", "Refaz tudo", "reescreve todas as variações", "troca todos os textos", "quero tudo de novo", "faz do zero"]) expect(pedeRefazerTudo(t)).toBe(true);
    for (const t of ["muda o título", "troca o CTA para Agendar", "deixa mais curto", ""]) expect(pedeRefazerTudo(t)).toBe(false);
  });

  it("cards: mesmo número e mesma ordem, texto novo no lugar, layout intacto (nunca acrescenta card)", () => {
    const cards = [
      { ordem: 1, funcao: "capa", texto_exato: "Velho", blocos: [], layout: { zona_texto: "topo" } },
      { ordem: 2, funcao: "cta", texto_exato: "Velho 2", blocos: [], layout: { zona_texto: "base" } },
    ];
    const novos = cardsComTextoNovo(cards, ["Gancho novo\nApoio novo\nChame no WhatsApp", "Agende hoje\nChame no WhatsApp", "Card a mais"], "Chame no WhatsApp");
    expect(novos).toHaveLength(2);
    expect(novos[0].texto_exato).toBe("Gancho novo\nApoio novo\nChame no WhatsApp");
    expect((novos[0].blocos as { papel: string }[]).map((b) => b.papel)).toEqual(["headline", "subtitulo", "cta"]);
    expect((novos[1].blocos as { papel: string }[]).map((b) => b.papel)).toEqual(["headline", "cta"]);
    expect(novos[0].layout).toEqual({ zona_texto: "topo" });
  });

  it("proposta não muda nada; Confirmar troca só o conteúdo; Desfazer volta o de antes", () => {
    const copy = { texto_principal: "Antigo", titulo: "T antigo", pacote: { x: 1 }, alternativas: [1] };
    const proposta = { lote: "L1", pedido: "refaz tudo", depois: { texto_principal: "Novo", titulo: "T novo", angulo_de_venda: "dor" }, textos_dos_cards: ["Novo"], criado_em: "2026-10-02" };
    const pendente = copyComProposta(copy, proposta);
    expect(pendente.texto_principal).toBe("Antigo");
    expect(propostaDoLote(pendente, "L1")).toEqual(proposta);
    expect(propostaDoLote(pendente, "L2")).toBeNull();
    const confirmada = copyConfirmada(pendente, proposta, { cards: [{ ordem: 1, texto_exato: "Antigo" }], legenda: "leg" });
    expect(confirmada.texto_principal).toBe("Novo");
    expect(confirmada.angulo_de_venda).toBe("dor");
    expect(confirmada.pacote).toEqual({ x: 1 });
    expect(confirmada.reescrita_pendente).toBeUndefined();
    const desfeita = copyDesfeita(confirmada, "L1")!;
    expect(desfeita.copy.texto_principal).toBe("Antigo");
    expect(desfeita.copy.titulo).toBe("T antigo");
    expect(desfeita.copy.angulo_de_venda).toBeUndefined();
    expect(desfeita.cards).toEqual([{ ordem: 1, texto_exato: "Antigo" }]);
    expect(desfeita.legenda).toBe("leg");
    expect(copyDesfeita(confirmada, "outro")).toBeNull();
  });
});
