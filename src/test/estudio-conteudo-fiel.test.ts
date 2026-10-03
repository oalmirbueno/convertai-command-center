import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Estúdio, conteúdo (02/10, pedidos do dono):
 * A. a arte rápida lê o TEXTO dos cards do post (visão falsa, fixture) e o diretor recebe gancho, CTA e estrutura;
 * B. fidelidade Idêntico, Próximo ou Criativo (tela, padrão pelo pedido, comando na conversa) e a conferência;
 * C. o gancho fica fora do Criativo (em código no Idêntico);
 * D. mundo real: pesquisa ligada, logo do Commons com licença, SVG do Simple Icons na nota de fontes;
 * E. conteúdo específico: conferência do genérico e a revisão numa chamada só;
 * F. "muda todo o conteúdo" reescreve todas as lâminas e não aumenta a quantidade.
 */

import {
  ESQUEMA_LEITURA_DOS_CARDS,
  estruturaPelaRegra,
  lerCardsDoPost,
  leituraGravada,
  leituraParaODiretor,
  normalizarLeituraDosCards,
  textoDaLeitura,
} from "../../supabase/functions/estudio-arte/modulos/leitura-dos-cards";
import {
  conferirFidelidade,
  devolverGanchoNaCapa,
  fidelidadeNaMensagem,
  fidelidadePadrao,
  ganchoPeloJev,
  headlineDaCapa,
  instrucoesDaFidelidade,
  laminasPelaFidelidade,
  perguntaDoGancho,
  semelhancaDoGancho,
} from "../../supabase/functions/estudio-arte/modulos/fidelidade-do-conteudo";
import {
  aplicarRevisao,
  analisarConteudo,
  instrucoesDoConteudo,
  laminasGenericas,
  numeroNovo,
  revisarConteudo,
} from "../../supabase/functions/estudio-arte/modulos/conteudo-especifico";
import {
  AREA_DA_LOGO_REAL,
  arquivoDoCommons,
  CAMPOS_DO_MUNDO_REAL,
  escolherNaBusca,
  fraseDaLogoReal,
  hostDoCommonsPermitido,
  INSTRUCOES_DO_MUNDO_REAL,
  lerInfoDoCommons,
  mundoRealPelaRegra,
  normalizarMarcasReais,
  notaDasFontes,
  perguntaDoMundoReal,
  slugDoSimpleIcons,
  urlDoSimpleIcons,
} from "../../supabase/functions/estudio-arte/modulos/mundo-real";
import {
  acoesSemMudarQuantidade,
  blocoDaReescritaTotal,
  coberturaDaReescrita,
  intencaoDeConteudo,
  mudancasDaReescrita,
} from "../../supabase/functions/estudio-arte/operacoes-de-conteudo";
import {
  arteRapidaDa,
  corpoDaArteRapida,
  decidirMundoReal,
  INSTRUCOES_DA_ARTE_RAPIDA,
  normalizarPedidoDaArteRapida,
  pedidoParaODiretor,
  perguntasDaArteRapida,
} from "../../supabase/functions/estudio-arte/modulos/arte-rapida";
import {
  aplicarNaDirecao,
  INSTRUCOES_CONVERSA,
  normalizarMudancas,
  pedidoMexeNoTexto,
  type ContextoDasMudancas,
  type DirecaoParaMudar,
} from "../../supabase/functions/estudio-arte/conversa-do-diretor";
import {
  adicionarLaminaNoTrabalho,
  blocoDasAcoesDoDiretor,
  normalizarAcoesDoDiretor,
  OPERACOES_DO_DIRETOR,
  regrasDoDiretor,
  type TrabalhoParaAcoes,
} from "../../supabase/functions/estudio-arte/acoes-do-diretor";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const LEITURA_BRUTA = JSON.parse(ler("src/test/fixtures/instagram/leitura-dos-cards.json"));
const COMMONS = JSON.parse(ler("src/test/fixtures/commons-info-whatsapp.json"));

describe("A. leitura dos cards do post (visão falsa)", () => {
  it("transcreve cada lâmina, tira o @ do autor e pega gancho, CTA e estrutura", async () => {
    const chamadas: Array<{ sistema: string; pedido: string; imagens: string[] }> = [];
    const r = await lerCardsDoPost(["c1", "c2", "c3", "c4", "c5"], "Legenda do post sobre segurança", async (sistema, pedido, imagens) => {
      chamadas.push({ sistema, pedido, imagens });
      return { json: LEITURA_BRUTA, custoUsd: 0.0021 };
    });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].imagens).toHaveLength(5);
    expect(chamadas[0].sistema).toContain("Transcreva o que está ESCRITO");
    expect(chamadas[0].pedido).toContain("Legenda do post");
    expect(r.custoUsd).toBe(0.0021);
    const l = r.leitura!;
    expect(l.cards).toHaveLength(5);
    expect(l.gancho).toBe("Seu WhatsApp pode ser clonado hoje");
    expect(l.cta).toBe("Salve e mande para quem precisa");
    expect(l.estrutura).toBe("passo_a_passo");
    expect(l.cards[0].texto).not.toContain("@perfil");
    expect(l.cards[0].papel).toBe("capa");
    expect(l.cards[4].papel).toBe("cta");
    expect(l.cards[2].texto).toContain("Conta > Confirmação em duas etapas");
  });

  it("sem imagem não chama; falha da visão segue sem leitura (e saldo sobe)", async () => {
    let chamou = false;
    const nada = await lerCardsDoPost([], "", async () => {
      chamou = true;
      return { json: {}, custoUsd: 0 };
    });
    expect(chamou).toBe(false);
    expect(nada.leitura).toBeNull();
    const falha = await lerCardsDoPost(["c1"], "", async () => {
      throw new Error("timeout");
    });
    expect(falha.leitura).toBeNull();
    expect(falha.erro).toContain("timeout");
    await expect(lerCardsDoPost(["c1"], "", async () => { throw new Error("saldo"); }, () => true)).rejects.toThrow("saldo");
  });

  it("gancho e estrutura pela regra quando o leitor não diz", () => {
    const l = normalizarLeituraDosCards({ cards: [{ ordem: 1, titulo: "3 erros no Pix", texto: "" }, { ordem: 2, titulo: "1. Chave errada", texto: "" }, { ordem: 3, titulo: "2. Valor", texto: "" }] }, 3)!;
    expect(l.gancho).toBe("3 erros no Pix");
    expect(l.estrutura).toBe("lista");
    expect(estruturaPelaRegra([{ titulo: "Antes", texto: "pele opaca" }, { titulo: "Depois", texto: "pele com viço" }])).toBe("antes_depois");
    expect(normalizarLeituraDosCards({ cards: [{ ordem: 1, titulo: "", texto: "" }] }, 1)).toBeNull();
  });

  it("o esquema é estrito e a leitura gravada volta igual", () => {
    expect(ESQUEMA_LEITURA_DOS_CARDS.schema.required).toEqual(["tema", "gancho", "cta", "estrutura", "cards"]);
    const l = normalizarLeituraDosCards(LEITURA_BRUTA, 5)!;
    expect(leituraGravada(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(textoDaLeitura(l)).toContain("PIN de 6 dígitos");
  });

  it("o diretor recebe o conteúdo dos cards e a fidelidade no pedido avulso", () => {
    const l = normalizarLeituraDosCards(LEITURA_BRUTA, 5)!;
    const ctx = pedidoParaODiretor({ pedido: "faz com a nossa marca", peca: "carrossel", arquivos: [], leitura_dos_cards: l, fidelidade: "proximo" }, []) as Record<string, any>;
    expect(ctx.conteudo_dos_cards).toMatchObject({ gancho_original: "Seu WhatsApp pode ser clonado hoje", estrutura: "Passo a passo", quantidade_de_laminas: 5 });
    expect(ctx.conteudo_dos_cards.laminas[1]).toEqual({ ordem: 2, titulo: "Passo 1", texto: "Abra o WhatsApp e toque em Configurações" });
    expect(ctx.fidelidade).toBe("Próximo");
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("conteudo_dos_cards");
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("Com o bloco MUNDO REAL, pesquise");
  });

  it("o post leva as imagens para a leitura (só da pasta do post e do cliente) e a fidelidade da tela", () => {
    const caminho = (n: number) => `${CLIENTE}/pedidos/instagram/CxEXEMPLO12/${n}.jpg`;
    const corpo = corpoDaArteRapida({
      clientId: CLIENTE,
      pedido: "refaz esse post",
      peca: "auto",
      campanha: null,
      arquivos: [],
      documentos: [],
      post: { url: "https://www.instagram.com/p/CxEXEMPLO12/", codigo: "CxEXEMPLO12", autor: null, legenda: "legenda", modo: "so_conteudo", imagens: [caminho(1), caminho(2)] },
      fidelidade: "identico",
    });
    expect(corpo.fidelidade).toBe("identico");
    const p = normalizarPedidoDaArteRapida({ ...corpo, post_do_instagram: { ...(corpo.post_do_instagram as object), imagens: [caminho(1), "outro/pedidos/instagram/CxEXEMPLO12/9.jpg", `${CLIENTE}/pedidos/instagram/OUTRO123/1.jpg`, caminho(2)] } }, CLIENTE);
    expect(p.fidelidade).toBe("identico");
    expect(p.post!.imagens).toEqual([caminho(1), caminho(2)]);
    // Em "Só o conteúdo" as imagens não entram como referência, mas vão para a leitura.
    expect(p.arquivos).toHaveLength(0);
  });

  it("a arte rápida gravada guarda fidelidade, leitura e mundo real", () => {
    const l = normalizarLeituraDosCards(LEITURA_BRUTA, 5)!;
    const a = arteRapidaDa({ arte_rapida: { pedido: "x", peca: "carrossel", arquivos: [], fidelidade: "criativo", leitura_dos_cards: l, mundo_real: { por: "regra", marcas: ["WhatsApp"], tutorial: true } } })!;
    expect(a.fidelidade).toBe("criativo");
    expect(a.leitura_dos_cards!.gancho).toBe(l.gancho);
    expect(a.mundo_real).toEqual({ por: "regra", marcas: ["WhatsApp"], tutorial: true });
    expect(arteRapidaDa({ arte_rapida: { pedido: "x", peca: "unica", arquivos: [] } })!.fidelidade).toBeNull();
  });
});

describe("B e C. fidelidade e gancho", () => {
  const leitura = normalizarLeituraDosCards(LEITURA_BRUTA, 5)!;
  const cards = (capa: string, n = 5) =>
    Array.from({ length: n }, (_, i) => ({ ordem: i + 1, funcao: i === 0 ? "capa" : i === n - 1 ? "cta" : "conteudo", texto_exato: i === 0 ? `${capa}\nApoio` : `Lâmina ${i + 1}`, blocos: i === 0 ? [{ papel: "headline", texto: capa }, { papel: "apoio", texto: "Apoio" }] : [{ papel: "headline", texto: `Lâmina ${i + 1}` }] }));

  it("padrão pelo pedido: Fazer igual = Idêntico, outra ideia = Criativo, o resto Próximo", () => {
    expect(fidelidadePadrao({ temFazerIgual: true, pedido: "" })).toBe("identico");
    expect(fidelidadePadrao({ temFazerIgual: false, pedido: "faça igual a este post" })).toBe("identico");
    expect(fidelidadePadrao({ temFazerIgual: false, pedido: "usa só a ideia, com outro ângulo" })).toBe("criativo");
    expect(fidelidadePadrao({ temFazerIgual: false, pedido: "faz esse post para a nossa loja" })).toBe("proximo");
  });

  it("comando na conversa", () => {
    expect(fidelidadeNaMensagem("deixa idêntico ao post")).toBe("identico");
    expect(fidelidadeNaMensagem("quero igual ao original")).toBe("identico");
    expect(fidelidadeNaMensagem("seja mais criativo, outro ângulo")).toBe("criativo");
    expect(fidelidadeNaMensagem("volta pro conteúdo do post, mantém o gancho")).toBe("proximo");
    expect(fidelidadeNaMensagem("muda a cor do título")).toBeNull();
  });

  it("instruções por fidelidade: Idêntico com a quantidade e o gancho palavra por palavra", () => {
    const i = instrucoesDaFidelidade("identico", leitura);
    expect(i).toContain("exatamente 5 lâminas");
    expect(i).toContain('"Seu WhatsApp pode ser clonado hoje", palavra por palavra');
    expect(instrucoesDaFidelidade("proximo", leitura)).toContain("MESMO gancho");
    expect(instrucoesDaFidelidade("criativo", leitura)).toContain("ângulo NOVO");
    expect(laminasPelaFidelidade("identico", leitura, null)).toBe(5);
    expect(laminasPelaFidelidade("proximo", leitura, 3)).toBe(3);
    expect(laminasPelaFidelidade("criativo", leitura, null)).toBeNull();
  });

  it("conferência: quantidade diferente avisa; gancho mantido, perdido ou na zona cinzenta (Jev)", () => {
    expect(semelhancaDoGancho("Seu WhatsApp pode ser clonado hoje", "Seu WhatsApp pode ser clonado ainda hoje")).toBe(1);
    const ok = conferirFidelidade(cards("Seu WhatsApp pode ser clonado hoje"), leitura, "identico");
    expect(ok).toMatchObject({ quantidade_ok: true, gancho_mantido: true, pergunta_ao_jev: false });
    const menos = conferirFidelidade(cards("Seu WhatsApp pode ser clonado hoje", 3), leitura, "identico");
    expect(menos.quantidade_ok).toBe(false);
    expect(menos.avisos[0]).toContain("5 lâminas");
    const perdeu = conferirFidelidade(cards("Dicas de tecnologia para você"), leitura, "proximo");
    expect(perdeu.gancho_mantido).toBe(false);
    const cinza = conferirFidelidade(cards("Clonaram o WhatsApp da sua mãe?"), leitura, "identico");
    expect(cinza.pergunta_ao_jev).toBe(true);
    expect(cinza.gancho_mantido).toBeNull();
    expect(conferirFidelidade(cards("Outra coisa"), leitura, "criativo")).toMatchObject({ gancho_mantido: null, pergunta_ao_jev: false, avisos: [] });
    const q = perguntaDoGancho();
    expect(q.type).toBe("noul");
    expect(q.instructions).toContain("gancho_original");
    expect(ganchoPeloJev(0.8)).toBe(true);
    expect(ganchoPeloJev(0.2)).toBe(false);
    expect(ganchoPeloJev(null)).toBeNull();
  });

  it("Idêntico: o gancho volta à capa em código, sem mexer nas outras lâminas", () => {
    const r = devolverGanchoNaCapa(cards("Dicas de tecnologia"), "Seu WhatsApp pode ser clonado hoje — @autor");
    expect(r.mudou).toBe(true);
    expect(headlineDaCapa(r.cards)).toBe("Seu WhatsApp pode ser clonado hoje,");
    expect(r.cards[0].texto_exato).toContain("Apoio");
    expect(r.cards[1].texto_exato).toBe("Lâmina 2");
    expect(devolverGanchoNaCapa(cards("Seu WhatsApp pode ser clonado hoje"), "Seu WhatsApp pode ser clonado hoje").mudou).toBe(false);
  });
});

describe("D. mundo real (pesquisa, logos reais e fontes)", () => {
  it("as palavras decidem tutorial e marca; passo a passo sem marca não liga a pesquisa", () => {
    expect(mundoRealPelaRegra(["Como ativar a confirmação em duas etapas no WhatsApp"])).toMatchObject({ real: true, tutorial: true, marcas: ["WhatsApp"] });
    expect(mundoRealPelaRegra(["toque em Configurações > Privacidade"]).real).toBe(true);
    expect(mundoRealPelaRegra(["passo a passo da maquiagem para o dia"]).real).toBe(false);
    expect(mundoRealPelaRegra(["promoção do pernil de sexta"]).real).toBe(false);
    // Marca sozinha é CTA ("chame no WhatsApp"): não liga pesquisa nem logo.
    expect(mundoRealPelaRegra(["Promoção de sexta, chame no WhatsApp e siga no Instagram"])).toMatchObject({ real: false, marcas: ["WhatsApp", "Instagram"] });
    expect(perguntaDoMundoReal().type).toBe("noul");
  });

  it("o Jev decide quando as palavras não decidem (pergunta só nesse caso)", () => {
    const pedido = normalizarPedidoDaArteRapida({ pedido: "explica como funciona a nova regra do cartão do banco digital", peca: "unica" }, CLIENTE);
    expect(perguntasDaArteRapida(pedido, []).questions.mundo_real).toBeTruthy();
    expect(decidirMundoReal(pedido, { noul: 0.82 })).toEqual({ por: "jev", marcas: [], tutorial: false });
    expect(decidirMundoReal(pedido, { noul: 0.3 })).toBeNull();
    const pix = normalizarPedidoDaArteRapida({ pedido: "como cadastrar a chave Pix no Nubank", peca: "unica" }, CLIENTE);
    expect(perguntasDaArteRapida(pix, []).questions.mundo_real).toBeUndefined();
    expect(decidirMundoReal(pix, null)).toMatchObject({ por: "regra", tutorial: true });
  });

  it("instruções e campos do esquema", () => {
    expect(INSTRUCOES_DO_MUNDO_REAL).toContain("documentação oficial");
    expect(INSTRUCOES_DO_MUNDO_REAL).toContain("colada pelo CÓDIGO");
    expect(Object.keys(CAMPOS_DO_MUNDO_REAL)).toEqual(["marcas_reais", "fontes_da_pesquisa"]);
    expect(fraseDaLogoReal(AREA_DA_LOGO_REAL, ["WhatsApp"])).toContain("Não desenhe a logo de WhatsApp");
  });

  it("Commons: arquivo limpo, imagem só de upload.wikimedia.org, licença e escolha da busca em código", () => {
    expect(arquivoDoCommons("WhatsApp.svg")).toBe("File:WhatsApp.svg");
    expect(arquivoDoCommons("https://commons.wikimedia.org/wiki/File:Nubank_logo_2021.svg")).toBe("File:Nubank logo 2021.svg");
    expect(arquivoDoCommons("logo")).toBeNull();
    expect(arquivoDoCommons("../x.png")).toBeNull();
    const info = lerInfoDoCommons(COMMONS, "File:WhatsApp.svg")!;
    expect(info.url).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/WhatsApp.svg/640px-WhatsApp.svg.png");
    expect(info.licenca).toBe("Public domain");
    expect(info.autor).toBe("WhatsApp");
    expect(hostDoCommonsPermitido("https://upload.wikimedia.org/a.png")).toBe(true);
    expect(hostDoCommonsPermitido("https://evil.example/upload.wikimedia.org/a.png")).toBe(false);
    expect(lerInfoDoCommons({ query: { pages: [{ missing: true }] } }, "File:X.svg")).toBeNull();
    const busca = { query: { search: [{ title: "File:WhatsApp fake logo.svg" }, { title: "File:Telegram logo.svg" }, { title: "File:WhatsApp logo.png" }, { title: "File:WhatsApp logo.svg" }] } };
    expect(escolherNaBusca(busca, "WhatsApp")).toBe("File:WhatsApp logo.svg");
    expect(escolherNaBusca({ query: { search: [{ title: "File:Foto de praia.jpg" }] } }, "WhatsApp")).toBeNull();
  });

  it("marcas da direção e a nota de fontes (pesquisa, logo com licença e SVG oficial)", () => {
    const marcas = normalizarMarcasReais([{ nome: "WhatsApp", arquivo_wikimedia: "File:WhatsApp.svg", laminas: [2, 9] }, { nome: "whatsapp", arquivo_wikimedia: "", laminas: [] }, { nome: "Nubank", arquivo_wikimedia: "", laminas: [] }], [1, 2, 3]);
    expect(marcas).toEqual([{ nome: "WhatsApp", arquivo: "File:WhatsApp.svg", laminas: [2] }, { nome: "Nubank", arquivo: null, laminas: [1] }]);
    expect(slugDoSimpleIcons("Mercado Livre")).toBe("mercadolivre");
    expect(slugDoSimpleIcons("Dot.js+")).toBe("dotdotjsplus");
    expect(urlDoSimpleIcons("whatsapp")).toBe("https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/whatsapp.svg");
    const fontes = notaDasFontes({
      daWeb: [{ url: "https://faq.whatsapp.com/1920866721452534", title: "Central de Ajuda" }, { url: "javascript:alert(1)" }],
      doDiretor: [{ titulo: "Central de Ajuda do WhatsApp", url: "https://faq.whatsapp.com/1920866721452534/" }],
      logos: [lerInfoDoCommons(COMMONS, "File:WhatsApp.svg")!],
      icones: [{ nome: "WhatsApp", url: urlDoSimpleIcons("whatsapp") }],
    });
    expect(fontes.map((f) => f.tipo)).toEqual(["pesquisa", "logo", "icone"]);
    expect(fontes[0].titulo).toBe("Central de Ajuda do WhatsApp");
    expect(fontes[1].licenca).toBe("Public domain");
  });
});

describe("E. conteúdo específico (anti-genérico)", () => {
  it("genérico: clichê, frase vazia ou nada concreto; específico passa", () => {
    expect(analisarConteudo("Dicas importantes para sua saúde e qualidade de vida", "conteudo").generico).toBe(true);
    expect(analisarConteudo("Eleve sua pele ao próximo nível", "capa").generico).toBe(true);
    expect(analisarConteudo("Cuidar da pele todos os dias faz bem para você e sua família inteira", "conteudo").motivos.join(" ")).toContain("nenhum detalhe concreto");
    expect(analisarConteudo("Protetor a cada 2 horas, mesmo no dia nublado", "conteudo").generico).toBe(false);
    expect(analisarConteudo("Toque em Configurações > Privacidade", "conteudo").generico).toBe(false);
    expect(analisarConteudo("Chame no WhatsApp", "cta").generico).toBe(false);
    expect(laminasGenericas([{ ordem: 1, funcao: "capa", texto_exato: "Pele bonita" }, { ordem: 2, funcao: "conteudo", texto_exato: "Confira dicas importantes para o seu dia a dia" }]).map((g) => g.ordem)).toEqual([2]);
    expect(instrucoesDoConteudo("venda")).toContain("MOTOR DE COPY DA CASA");
    expect(instrucoesDoConteudo()).toContain("pergunta real do cliente");
  });

  it("revisão numa chamada só: só as genéricas, sem número inventado, capa pulada no Próximo", async () => {
    const cards = [
      { ordem: 1, funcao: "capa", texto_exato: "Dicas importantes", blocos: [{ papel: "headline", texto: "Dicas importantes" }] },
      { ordem: 2, funcao: "conteudo", texto_exato: "Confira dicas importantes para sua saúde", blocos: [{ papel: "headline", texto: "Confira dicas importantes para sua saúde" }] },
      { ordem: 3, funcao: "conteudo", texto_exato: "Saiba mais sobre o tema com a nossa equipe qualificada", blocos: [{ papel: "headline", texto: "Saiba mais" }] },
    ];
    let chamadas = 0;
    const r = await revisarConteudo(cards, { fatos: ["Consulta de 30 minutos"], pular: [1] }, async (_s, pedido) => {
      chamadas++;
      expect(pedido).toContain("Revise as lâminas 2, 3");
      return {
        json: {
          laminas: [
            { ordem: 2, blocos: [{ papel: "headline", texto: "Consulta de 30 minutos" }, { papel: "apoio", texto: "Você sai com o plano do mês" }] },
            { ordem: 3, blocos: [{ papel: "headline", texto: "97% saem satisfeitos" }] },
          ],
        },
        custoUsd: 0.004,
      };
    });
    expect(chamadas).toBe(1);
    expect(r.genericas.map((g) => g.ordem)).toEqual([2, 3]);
    expect(r.mudou).toEqual([2]);
    expect(r.cards[1].texto_exato).toBe("Consulta de 30 minutos\nVocê sai com o plano do mês");
    // Número que não está nos fatos: fica como estava.
    expect(r.cards[2].texto_exato).toBe(cards[2].texto_exato);
    expect(r.cards[0]).toBe(cards[0]);
    expect(numeroNovo("97% saem", ["30 minutos"])).toBe("97");
  });

  it("nada genérico: nenhuma chamada; a capa que perdeu o gancho entra forçada", async () => {
    let chamou = false;
    const limpo = [{ ordem: 1, funcao: "capa", texto_exato: "3 erros no Pix" }];
    const r = await revisarConteudo(limpo, { fatos: [] }, async () => {
      chamou = true;
      return { json: {}, custoUsd: 0 };
    });
    expect(chamou).toBe(false);
    expect(r.mudou).toEqual([]);
    const f = await revisarConteudo(limpo, { fatos: ["Seu Pix pode ir para a pessoa errada"], forcar: [{ ordem: 1, motivos: ["perdeu o gancho"] }] }, async (_s, pedido) => {
      expect(pedido).toContain("perdeu o gancho");
      return { json: { laminas: [{ ordem: 1, blocos: [{ papel: "headline", texto: "Seu Pix pode ir para a pessoa errada" }] }] }, custoUsd: 0.001 };
    });
    expect(f.mudou).toEqual([1]);
    expect(aplicarRevisao(limpo, { laminas: [{ ordem: 1, blocos: [{ papel: "apoio", texto: "sem headline" }] }] }, [1], []).mudou).toEqual([]);
  });
});

describe("F. operações de conteúdo na conversa", () => {
  const direcao = (n = 4): DirecaoParaMudar => ({
    conceito: "Rotina da clínica.",
    fio_visual: null,
    carrossel_infinito: false,
    cards: Array.from({ length: n }, (_, i) => ({
      ordem: i + 1,
      funcao: i === 0 ? "capa" : i === n - 1 ? "cta" : "conteudo",
      texto_exato: `Texto antigo ${i + 1}`,
      composicao: "",
      ilustracao: "",
      prompt_imagem: "",
      blocos: [{ papel: "headline" as const, texto: `Texto antigo ${i + 1}` }],
    })),
  });

  it("lê a intenção: reescrever tudo, uma lâmina, adicionar, tirar, reordenar", () => {
    expect(intencaoDeConteudo("muda todo o conteúdo")).toBe("reescrever_tudo");
    expect(intencaoDeConteudo("refaz o texto de tudo")).toBe("reescrever_tudo");
    expect(intencaoDeConteudo("troca o tema para cuidados no inverno")).toBe("reescrever_tudo");
    expect(intencaoDeConteudo("reescreve todos os textos")).toBe("reescrever_tudo");
    expect(intencaoDeConteudo("quero outro conteúdo")).toBe("reescrever_tudo");
    expect(intencaoDeConteudo("muda o texto da capa")).toBe("reescrever_lamina");
    expect(intencaoDeConteudo("adiciona uma lâmina sobre preço")).toBe("adicionar_lamina");
    expect(intencaoDeConteudo("refaz a lâmina 2")).not.toBe("adicionar_lamina");
    expect(intencaoDeConteudo("tira a lâmina 3")).toBe("tirar_lamina");
    expect(intencaoDeConteudo("inverte a ordem das lâminas")).toBe("reordenar");
    expect(intencaoDeConteudo("muda a cor do título")).toBeNull();
    // A causa do bug: "conteúdo" não liberava a troca de texto.
    expect(pedidoMexeNoTexto("muda todo o conteúdo")).toBe(true);
    expect(pedidoMexeNoTexto("troca o tema")).toBe(true);
    expect(INSTRUCOES_CONVERSA).toContain("OPERAÇÕES DE CONTEÚDO");
    expect(blocoDaReescritaTotal(4, [1, 2, 3, 4])).toContain("nunca use duplicar_lamina");
  });

  it('"muda todo o conteúdo": todas as lâminas mudam de texto e a quantidade não aumenta', () => {
    const d = direcao(4);
    const atual: Record<number, string> = {};
    d.cards.forEach((c) => { atual[c.ordem] = c.texto_exato; });
    // O diretor escreveu 3 lâminas e ainda propôs duplicar uma (o bug).
    const doDiretor = [1, 2, 3].map((o) => ({ alvo: "lamina", ordem: o, titulo: `Texto ${o}`, motivo: "", campos: { texto_exato: `Inverno pede hidratação\nLâmina nova ${o}` } }));
    const acoes = { resumo: "", itens: [{ operacao: "duplicar_lamina", ref: "l2", para: "" }] };
    const sem = acoesSemMudarQuantidade(acoes);
    expect((sem.acoes as { itens: unknown[] }).itens).toHaveLength(0);
    expect(sem.tiradas).toEqual(["duplicar_lamina"]);
    const cob = coberturaDaReescrita(doDiretor, atual);
    expect(cob).toEqual({ cobertas: [1, 2, 3], faltam: [4] });
    // O redator (uma chamada) escreve a que faltou.
    const faltou = mudancasDaReescrita({ laminas: [{ ordem: 4, texto: "Agende sua avaliação de inverno" }] }, cob.faltam, atual);
    const ctx: ContextoDasMudancas = {
      ordens: [1, 2, 3, 4],
      paleta: [],
      acervo: new Set(),
      permitirTexto: true,
      semCaixa: new Set(),
      continuo: false,
      fontesDoTexto: { atual, pedido: "muda todo o conteúdo", confirmados: [], marca: [] },
      reescrita: true,
      maxMudancas: 6,
    };
    const norm = normalizarMudancas([...doDiretor, ...faltou], ctx);
    expect(norm.mudancas).toHaveLength(4);
    const r = aplicarNaDirecao(d, norm.mudancas);
    expect(r.direcao.cards).toHaveLength(4);
    r.direcao.cards.forEach((c) => expect(c.texto_exato).not.toBe(atual[c.ordem]));
    expect(r.textoMudou).toEqual([1, 2, 3, 4]);
  });

  it("reescrita com mais de 6 lâminas não corta (teto pela quantidade)", () => {
    const d = direcao(8);
    const atual: Record<number, string> = {};
    d.cards.forEach((c) => { atual[c.ordem] = c.texto_exato; });
    const todas = d.cards.map((c) => ({ alvo: "lamina", ordem: c.ordem, titulo: "t", motivo: "", campos: { texto_exato: `Novo texto da lâmina ${c.ordem}` } }));
    const base = { ordens: d.cards.map((c) => c.ordem), paleta: [], acervo: new Set<string>(), permitirTexto: true, semCaixa: new Set<number>(), continuo: false };
    expect(normalizarMudancas(todas, base).mudancas).toHaveLength(6);
    expect(normalizarMudancas(todas, { ...base, maxMudancas: 10, reescrita: true }).mudancas).toHaveLength(8);
  });

  it("adicionar_lamina cria lâmina NOVA com outro texto (não a cópia) e mudar_fidelidade só na arte rápida", () => {
    expect(OPERACOES_DO_DIRETOR).toEqual(expect.arrayContaining(["adicionar_lamina", "mudar_fidelidade"]));
    const t: TrabalhoParaAcoes = { id: "t", status: "dirigido", direcao: { cards: direcao(3).cards as never, arte_rapida: { pedido: "x", fidelidade: "proximo" } }, cards: [{ ordem: 2, versao: 1 }, { ordem: 3, versao: 1 }] };
    const r = adicionarLaminaNoTrabalho(t, 2, "Quanto custa a avaliação\nA partir da tabela da clínica");
    const cards = r.patch.direcao.cards as Array<{ ordem: number; texto_exato?: string; funcao?: string }>;
    expect(cards).toHaveLength(4);
    expect(cards[2].texto_exato).toBe("Quanto custa a avaliação\nA partir da tabela da clínica");
    expect(cards[2].texto_exato).not.toBe(cards[1].texto_exato);
    expect(cards[3].funcao).toBe("cta");
    expect((r.patch.cards as Array<{ ordem: number }>).map((v) => v.ordem)).toEqual([2, 4]);
    const acao = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "adicionar_lamina", ref: "l2", para: "Lâmina sobre preço" }, { operacao: "mudar_fidelidade", ref: "t1", para: "identico" }] }, t)!;
    expect(acao.itens.map((i) => i.operacao)).toEqual(["mudar_fidelidade", "adicionar_lamina"]);
    expect(regrasDoDiretor(t).mudar_fidelidade.trava!({ ref: "t1", id: "t", titulo: "", dados: { tipo: "trabalho" } }, "identico")).toBeNull();
    const semRapida: TrabalhoParaAcoes = { ...t, direcao: { cards: t.direcao.cards } };
    expect(regrasDoDiretor(semRapida).mudar_fidelidade.trava!({ ref: "t1", id: "t", titulo: "", dados: { tipo: "trabalho" } }, "identico")).toContain("arte rápida");
    expect(blocoDasAcoesDoDiretor(t)).toContain("adicionar_lamina");
  });
});
