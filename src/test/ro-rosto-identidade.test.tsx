import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

/**
 * Frente RO (29/09), queixa do dono: "eu coloco uma imagem do rosto na arte e
 * ele faz exatamente aquela foto, em vez de aproveitar as características do
 * rosto e fazer junto da imagem. Tem que ser feito pelo gerador, e não a mesma
 * pose [...]. Mas tem imagens que eu quero que sejam exatamente elas."
 * 1. Usar o rosto: o prompt ao gerador pede nova pose e composição, sem colagem.
 * 2. Foto exata: continua intacta (o caminho de sempre).
 * 3. Automático: o Jev com confiança mínima, a regra do pedido e o padrão.
 * 4. Diretor na conversa: "usa só o rosto dele" e "a foto exatamente como está".
 * 5. Conferência: mesma pessoa e pose copiada, só aviso.
 * 6. Tela: seletor compacto na base da lâmina e o papel novo na Arte rápida.
 */

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const q: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit", "range", "neq"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return {
    supabase: {
      functions: { invoke: vi.fn() },
      from: () => consulta(),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: new Error("sem") }), createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import {
  AJUDA_DO_USO,
  avisoDaPoseCopiada,
  CONFIANCA_MINIMA_DO_USO,
  decidirUso,
  FRASE_DA_IDENTIDADE,
  fotoSemUso,
  mensagemFalaDaFoto,
  perguntaDoUso,
  ROTULO_DA_FOTO_DE_IDENTIDADE,
  usoDaFotoLivre,
  usoDoAcervo,
  usoForteNoPedido,
  usoPedidoNaConversa,
  usoPelaRegra,
} from "../../supabase/functions/_shared/uso-da-foto";
import {
  aplicarArquivosNasLaminas,
  decidirArteRapida,
  DICA_DO_PAPEL,
  INSTRUCOES_DA_ARTE_RAPIDA,
  normalizarPedidoDaArteRapida,
  PAPEIS_DO_ARQUIVO,
  perguntasDaArteRapida,
  ROTULO_DO_PAPEL,
  type ArquivoDaArteRapida,
} from "../../supabase/functions/_shared/arte-rapida";
import {
  blocoDoRosto,
  ESQUEMA_CONFERENCIA_DO_ROSTO,
  ESQUEMA_CONFERENCIA_DO_ROSTO_COM_POSE,
  SISTEMA_CONFERENCIA_DO_ROSTO_COM_POSE,
} from "../../supabase/functions/estudio-arte/rosto-na-geracao";
import {
  aplicarNaDirecao,
  aplicarUsoNaLamina,
  CAMPOS_DA_LAMINA,
  ESQUEMA_CONVERSA,
  INSTRUCOES_CONVERSA,
  normalizarMudancas,
  usoDaFotoNaLamina,
} from "../../supabase/functions/estudio-arte/conversa-do-diretor";
import { MUDANCAS_DO_GERADOR_DO_ESTUDIO } from "../../supabase/functions/_shared/motores";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EstudioBaseDaLamina, { baseDaLamina, DESCRICAO_DO_MODO, SeletorDoUso } from "@/components/mesa/EstudioBaseDaLamina";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const servidor = ler("supabase/functions/estudio-arte/index.ts");
const trecho = (de: string, ate: string) => servidor.slice(servidor.indexOf(de), servidor.indexOf(ate, servidor.indexOf(de)));

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const FOTO_ID = "33333333-3333-4333-8333-333333333333";
const CAMINHO = `${CLIENTE}/pedidos/palestrante.jpg`;

// ------------------------------------------------------------------ 1

describe("1. Usar o rosto: cena nova pelo gerador, sem colar a foto", () => {
  it("o bloco do rosto leva a frase do dono, cena nova pela direção e nada colado", () => {
    const bloco = blocoDoRosto({ indices: [4], destacar: false, pessoaNaReferencia: false, modo: "lamina", daFoto: true });
    expect(bloco).toContain(FRASE_DA_IDENTIDADE);
    expect(FRASE_DA_IDENTIDADE).toBe("mantenha a identidade da pessoa da imagem de referência; crie nova pose e composição conforme a direção; não copie a foto");
    expect(bloco).toContain("nada dela é colado ou recortado");
    expect(bloco).toMatch(/pose, gesto, ângulo da cabeça, expressão, roupa \(quando o tema pedir\), luz e enquadramento vêm da direção de arte/);
    expect(bloco).toContain("óculos, barba");
    expect(bloco).toContain("Nunca a mesma pose nem o mesmo recorte da foto");
    // Sem daFoto (rosto escolhido da frente R2), o bloco é o de antes.
    const antes = blocoDoRosto({ indices: [4], destacar: false, pessoaNaReferencia: false, modo: "lamina" });
    expect(antes).not.toContain(FRASE_DA_IDENTIDADE);
    expect(bloco.indexOf(antes.split("\n").slice(0, 4).join("\n"))).toBe(0);
    expect(ROTULO_DA_FOTO_DE_IDENTIDADE).toMatch(/não copie a pose, o ângulo, o enquadramento, o recorte, o fundo, a roupa nem a luz/);
  });

  it("gerar_card: a foto em rosto não vira base nem elemento; vai como identidade, sem devolver o original", () => {
    const g = trecho("async function gerarCard(", "async function gravarVersao(");
    expect(g).toContain("const acervoComoRosto = !!fotoDoAcervo && usoDoAcervo(card) === \"rosto\";");
    expect(g).toContain("const foto = acervoComoRosto ? undefined : fotoDoAcervo;");
    expect(g).toContain("const livresComoRosto = livresDaLamina.filter((f) => usoDaFotoLivre(f) === \"rosto\" && !f.recortada);");
    expect(g).toContain("const livres = livresDaLamina.filter((f) => livresComoRosto.indexOf(f) < 0);");
    // Sem base: o caminho que devolve o original (devolverOriginalAlinhado) só roda com baseFoto.
    expect(g).toContain("let baseFoto: Uint8Array | null = foto ? await fotoRealNaLamina(foto, quadro.largura, quadro.altura) : null;");
    expect(g).toContain("const fundoLivre = foto ? undefined : livres.find((f) => f.papel === \"fundo\");");
    // Normal e replicar: as fotos em rosto entram como identidade, com o rótulo e o bloco do modo rosto.
    expect(g).toContain("const rostoDaFotoNaNormal = rostoDaFoto && !replicar && !baseFoto && !recorteNaLamina ? rostoDaFoto : null;");
    expect(g).toContain("const rostoDaFotoNoReplicar = replicar && fotosReplicar.length === 0 && rostoDaFoto ? rostoDaFoto : null;");
    expect(g).toContain("const rotuloDoRosto = rostoVeioDaFoto ? ROTULO_DA_FOTO_DE_IDENTIDADE : ROTULO_DA_FOTO_DO_ROSTO;");
    expect(g.match(/daFoto: rostoVeioDaFoto/g)!.length).toBe(2);
    // A versão guarda a origem (a conferência olha a pose).
    expect(g.match(/rostoVeioDaFoto \? \{ origem: "foto_da_lamina" \} : \{\}/g)!.length).toBe(2);
    // Com foto exata de fundo junto, a cena é a da foto: aviso, sem trocar em silêncio.
    expect(g).toContain("o rosto (Usar o rosto) não entrou");
  });

  it("registro em _shared/motores.ts (rosto_identidade) com trechos que existem e sem travessão", () => {
    const m = MUDANCAS_DO_GERADOR_DO_ESTUDIO.find((x) => x.id === "rosto_identidade")!;
    expect(m).toBeTruthy();
    for (const t of m.ligacao.trechos) expect(servidor).toContain(t);
    expect(`${m.pedido} ${m.o_que} ${m.intocado}`).not.toContain("—");
  });
});

// ------------------------------------------------------------------ 2

describe("2. Foto exata: continua intacta", () => {
  it("sem o campo uso, toda foto é exata (as de hoje); recorte e logo não têm uso", () => {
    expect(usoDaFotoLivre({})).toBe("exata");
    expect(usoDaFotoLivre({ uso: "qualquer" })).toBe("exata");
    expect(usoDaFotoLivre({ uso: "rosto" })).toBe("rosto");
    expect(usoDoAcervo({})).toBe("exata");
    expect(usoDoAcervo({ uso_do_acervo: "rosto" })).toBe("rosto");
    expect(fotoSemUso({ recortada: true })).toBe(true);
    expect(fotoSemUso({ nota: "Logo do pedido (parceiro.png): aplicar exatamente como está" })).toBe(true);
    expect(fotoSemUso({ nota: "Foto real do pedido" })).toBe(false);
  });

  it("o caminho da foto real fixa não mudou: alinhamento, recorte das letras e máscara com a logo", () => {
    const g = trecho("async function gerarCard(", "async function gravarVersao(");
    expect(g).toContain("const fotoFixa = !!baseFoto && !panorama && !elementos.length && !replicar;");
    expect(g).toContain("const volta = await devolverOriginalAlinhado(baseFoto, img.png, areas, 28, { texto: fotoFixa });");
    expect(g).toContain("const mascaraComLogo = cenaFixa;");
  });

  it("tela: sem uso, o modo é o de sempre; com rosto, modo rosto e sai do contínuo", () => {
    expect(baseDaLamina({ fotos_livres: [{ caminho: CAMINHO, papel: "fundo" }] }, [], false).modo).toBe("foto_real");
    expect(baseDaLamina({ imagens_ids: [FOTO_ID] }, [], false).modo).toBe("foto_real");
    const rosto = baseDaLamina({ fotos_livres: [{ caminho: CAMINHO, papel: "fundo", uso: "rosto" }] }, [], false);
    expect(rosto.modo).toBe("rosto");
    expect(rosto.comRosto).toBe(true);
    expect(baseDaLamina({ imagens_ids: [FOTO_ID], uso_do_acervo: "rosto" }, [], false).modo).toBe("rosto");
    // Contínuo: a lâmina com foto própria (mesmo só o rosto) sai do panorama, como no servidor.
    expect(baseDaLamina({ fotos_livres: [{ caminho: CAMINHO, papel: "fundo", uso: "rosto" }] }, [], true).modo).toBe("rosto");
    // Referência + rosto: replica sem o aviso de foto recomposta (a identidade é o pedido).
    const rep = baseDaLamina({ referencias_ids: ["r1"], fotos_livres: [{ caminho: CAMINHO, papel: "fundo", uso: "rosto" }] }, [], false);
    expect(rep.modo).toBe("replicar_referencia");
    expect(rep.fotoRecomposta).toBe(false);
    expect(DESCRICAO_DO_MODO.rosto).toMatch(/cena nova/);
  });
});

// ------------------------------------------------------------------ 3

const arquivoPedido = (papel: string) => ({ caminho: CAMINHO, nome: "palestrante.jpg", papel });

describe("3. Automático: o Jev decide pelo pedido, com confiança mínima", () => {
  it("regra de palavras: rosto forte vence, depois exata, depois cena nova", () => {
    expect(usoPelaRegra("coloca essa foto com o título")).toBe("exata");
    expect(usoPelaRegra("quero a foto exatamente como está")).toBe("exata");
    expect(usoPelaRegra("usa a foto igual, só põe o texto")).toBe("exata");
    expect(usoPelaRegra("usa só o rosto dele, em outra pose")).toBe("rosto");
    expect(usoPelaRegra("faz uma arte com ele falando sobre investimentos")).toBe("rosto");
    expect(usoPelaRegra("ela de jaleco explicando o tratamento")).toBe("rosto");
    expect(usoPelaRegra("arte do evento")).toBeNull();
    expect(usoPelaRegra("")).toBeNull();
    // Na conversa só as palavras fortes contam.
    expect(usoForteNoPedido("faz uma cena no escritório")).toBeNull();
    expect(usoForteNoPedido("usa só o rosto")).toBe("rosto");
  });

  it("pergunta ao Jev: Choice exata ou rosto, com exemplos; na conversa com 'nenhum'", () => {
    const q = perguntaDoUso({ caminhoDaFoto: "arquivos[0]", nome: "x.jpg" });
    expect(q.type).toBe("choice");
    expect(Object.keys(q.criteria)).toEqual(["exata", "rosto"]);
    expect(JSON.stringify(q.instructions)).toContain("`arquivos[0]`");
    expect(Object.keys(perguntaDoUso({ nenhum: true }).criteria)).toEqual(["exata", "rosto", "nenhum"]);
    expect(CONFIANCA_MINIMA_DO_USO).toBe(0.7);
  });

  it("decidirUso: Jev confiante vale; em dúvida vale a regra; sem regra, exata com dúvida", () => {
    expect(decidirUso({ choice: "rosto", confidence: 0.9 }, "arte do evento")).toMatchObject({ uso: "rosto", por: "jev", duvida: false });
    expect(decidirUso({ choice: "rosto", confidence: 0.5 }, "coloca essa foto")).toMatchObject({ uso: "exata", por: "regra", duvida: false });
    expect(decidirUso({ choice: "rosto", confidence: 0.5 }, "arte do evento")).toMatchObject({ uso: "exata", por: "regra", duvida: true });
    expect(decidirUso(null, "usa só o rosto dela")).toMatchObject({ uso: "rosto", por: "regra" });
    expect(decidirUso(null, "arte do evento")).toMatchObject({ uso: "exata", duvida: false });
  });

  it("arte rápida: pergunta de uso junto com a de papel, só para o que ficou em Automático", () => {
    const p = normalizarPedidoDaArteRapida({ pedido: "faz uma arte com ele falando sobre investimentos", arquivos: [arquivoPedido("auto")] }, CLIENTE);
    const q = perguntasDaArteRapida(p, []);
    expect(Object.keys(q.questions).sort()).toEqual(["papel_1", "peca", "uso_1"]);
    expect(q.usos).toEqual({ uso_1: 0 });
    const equipe = perguntasDaArteRapida(normalizarPedidoDaArteRapida({ pedido: "x", peca: "unica", arquivos: [arquivoPedido("foto")] }, CLIENTE), []);
    expect(Object.keys(equipe.questions)).toEqual([]);
  });

  const casos: { pedido: string; respostas: Record<string, { choice: string; confidence: number }> | null; papel: string; por: string; aviso?: RegExp }[] = [
    { pedido: "Coloca essa foto do palestrante com o título Inauguração", respostas: { papel_1: { choice: "foto", confidence: 0.92 }, uso_1: { choice: "exata", confidence: 0.88 } }, papel: "foto", por: "jev" },
    { pedido: "Faz uma arte com ele falando sobre investimentos para jovens", respostas: { papel_1: { choice: "foto", confidence: 0.9 }, uso_1: { choice: "rosto", confidence: 0.86 } }, papel: "rosto", por: "jev" },
    { pedido: "Quero essa foto igualzinha, só com o preço", respostas: { papel_1: { choice: "foto", confidence: 0.9 }, uso_1: { choice: "rosto", confidence: 0.52 } }, papel: "foto", por: "jev" },
    { pedido: "Arte para o evento de sexta", respostas: { papel_1: { choice: "foto", confidence: 0.9 }, uso_1: { choice: "rosto", confidence: 0.55 } }, papel: "foto", por: "jev", aviso: /entra como está ou só com o rosto/ },
    { pedido: "Usa só o rosto dela, em outra pose, no consultório", respostas: null, papel: "rosto", por: "regra" },
  ];
  for (const c of casos) {
    it(`decide: "${c.pedido}"`, () => {
      const p = normalizarPedidoDaArteRapida({ pedido: c.pedido, arquivos: [arquivoPedido("auto")] }, CLIENTE);
      const q = perguntasDaArteRapida(p, []);
      const d = decidirArteRapida(p, q, c.respostas);
      expect(d.arquivos[0].papel).toBe(c.papel);
      expect(d.arquivos[0].papel_por).toBe(c.por);
      expect(d.arquivos[0].codigo).toBe(c.papel === "rosto" ? "P1" : "F1");
      if (c.aviso) expect(d.avisos.join(" ")).toMatch(c.aviso);
    });
  }

  it("a equipe vale sobre o Jev: Foto é exata e Rosto (identidade) é o papel novo", () => {
    expect(PAPEIS_DO_ARQUIVO).toContain("rosto");
    expect(ROTULO_DO_PAPEL.rosto).toBe("Rosto (identidade)");
    expect(DICA_DO_PAPEL.foto).toMatch(/Foto exata/);
    const p = normalizarPedidoDaArteRapida({ pedido: "faz uma arte com ele falando", peca: "unica", arquivos: [arquivoPedido("foto")] }, CLIENTE);
    expect(decidirArteRapida(p, perguntasDaArteRapida(p, []), { uso_1: { choice: "rosto", confidence: 0.99 } }).arquivos[0]).toMatchObject({ papel: "foto", papel_por: "equipe" });
    const r = normalizarPedidoDaArteRapida({ pedido: "coloca essa foto", peca: "unica", arquivos: [arquivoPedido("rosto")] }, CLIENTE);
    expect(decidirArteRapida(r, perguntasDaArteRapida(r, []), null).arquivos[0]).toMatchObject({ papel: "rosto", codigo: "P1", papel_por: "equipe" });
  });

  it("nas lâminas: o rosto vai com uso rosto (foto trazida e do acervo); o mesmo P repete no carrossel", () => {
    const rosto: ArquivoDaArteRapida = { codigo: "P1", imagem_id: null, caminho: CAMINHO, nome: "palestrante.jpg", papel: "rosto", papel_por: "jev" };
    const [capa] = aplicarArquivosNasLaminas([{ ordem: 1 }], { 1: "P1" }, [rosto], "unica");
    expect(capa.fotos_livres![0]).toMatchObject({ caminho: CAMINHO, papel: "fundo", uso: "rosto", uso_por: "jev" });
    const doAcervo: ArquivoDaArteRapida = { ...rosto, imagem_id: FOTO_ID, caminho: null, papel_por: "equipe" };
    const [c2] = aplicarArquivosNasLaminas([{ ordem: 1 }], {}, [doAcervo], "unica");
    expect(c2).toMatchObject({ imagens_ids: [FOTO_ID], uso_do_acervo: "rosto", uso_do_acervo_por: "equipe" });
    const exata: ArquivoDaArteRapida = { codigo: "F1", imagem_id: null, caminho: `${CLIENTE}/pedidos/loja.jpg`, nome: "loja.jpg", papel: "foto", papel_por: "equipe" };
    const car = aplicarArquivosNasLaminas([{ ordem: 1 }, { ordem: 2 }, { ordem: 3 }], { 1: "P1", 2: "F1", 3: "P1" }, [rosto, exata], "carrossel");
    expect(car[0].fotos_livres![0].uso).toBe("rosto");
    expect(car[1].fotos_livres![0].uso).toBeUndefined();
    expect(car[2].fotos_livres![0]).toMatchObject({ caminho: CAMINHO, uso: "rosto" });
    // Foto exata segue a nota de sempre.
    expect(car[1].fotos_livres![0].nota).toMatch(/entra como está/);
  });

  it("o diretor sabe o que fazer com P1: cena nova, pessoa pelo papel, nunca os traços", () => {
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("Rostos do pedido (códigos P1, P2...");
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("diferente da pose da foto");
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("nunca pelos traços");
  });
});

// ------------------------------------------------------------------ 4

const cardComFoto = (extra: Record<string, unknown> = {}) => ({ ordem: 1, funcao: "capa", texto_exato: "Olá", ilustracao: "", prompt_imagem: "", fotos_livres: [{ caminho: CAMINHO, papel: "fundo" as const, nota: "Foto real do pedido (x): entra como está, sem ser refeita nem escurecida." }], ...extra });

describe("4. Diretor na conversa", () => {
  it("o campo uso_da_foto existe no esquema, nas instruções e nas regras", () => {
    expect(CAMPOS_DA_LAMINA).toContain("uso_da_foto");
    const campos = (ESQUEMA_CONVERSA.schema.properties.mudancas.items.properties.campos as any).properties;
    expect(campos.uso_da_foto.enum).toEqual(["", "exata", "rosto"]);
    expect(INSTRUCOES_CONVERSA).toContain("\"usa só o rosto dele\", \"em outra pose\"");
    expect(INSTRUCOES_CONVERSA).toContain("\"Coloca a foto exatamente como está\"");
  });

  it("normaliza e aplica: rosto na foto de fundo e no acervo; exata volta ao padrão", () => {
    const ctx = { ordens: [1], paleta: [], acervo: new Set<string>(), permitirTexto: false, semCaixa: new Set<number>(), continuo: false };
    const { mudancas } = normalizarMudancas([{ alvo: "lamina", ordem: 1, titulo: "Só o rosto", motivo: "m", campos: { uso_da_foto: "rosto" } }], ctx);
    expect(mudancas[0].campos).toEqual({ uso_da_foto: "rosto" });
    expect(mudancas[0].regerar).toEqual([1]);
    const r = aplicarNaDirecao({ conceito: "c", carrossel_infinito: false, cards: [cardComFoto() as any] }, mudancas);
    expect(r.direcao.cards[0].fotos_livres![0]).toMatchObject({ uso: "rosto", uso_por: "equipe" });
    expect(r.direcao.cards[0].fotos_livres![0].nota).toMatch(/só a identidade/);
    const acervo: any = { ...cardComFoto({ fotos_livres: [], imagens_ids: [FOTO_ID] }) };
    aplicarUsoNaLamina(acervo, "rosto");
    expect(acervo.uso_do_acervo).toBe("rosto");
    aplicarUsoNaLamina(acervo, "exata");
    expect(acervo.uso_do_acervo).toBeUndefined();
    expect(usoDaFotoNaLamina({ fotos_livres: [] })).toBeNull();
    const invalido = normalizarMudancas([{ alvo: "lamina", ordem: 1, titulo: "x", motivo: "m", campos: { uso_da_foto: "colar" } }], ctx);
    expect(invalido.mudancas.length).toBe(0);
  });

  it("rede de segurança: 'usa só o rosto dele, em outra pose' e 'coloca a foto exatamente como está'", () => {
    expect(mensagemFalaDaFoto("usa só o rosto dele, em outra pose")).toBe(true);
    expect(mensagemFalaDaFoto("muda a cor do título")).toBe(false);
    // Jev confiante.
    expect(usoPedidoNaConversa({ mensagem: "usa só o rosto dele, em outra pose", usoAtual: "exata", resposta: { choice: "rosto", confidence: 0.93 } })).toBe("rosto");
    expect(usoPedidoNaConversa({ mensagem: "coloca a foto exatamente como está", usoAtual: "rosto", resposta: { choice: "exata", confidence: 0.9 } })).toBe("exata");
    // Jev fora do ar: as palavras fortes.
    expect(usoPedidoNaConversa({ mensagem: "usa só o rosto dele", usoAtual: "exata", resposta: null })).toBe("rosto");
    // "nenhum" confiante (troca de foto, cor): nada muda.
    expect(usoPedidoNaConversa({ mensagem: "troca a foto pela segunda", usoAtual: "rosto", resposta: { choice: "nenhum", confidence: 0.9 } })).toBeNull();
    // Já está no uso pedido, ou lâmina sem foto: nada.
    expect(usoPedidoNaConversa({ mensagem: "usa só o rosto", usoAtual: "rosto", resposta: { choice: "rosto", confidence: 0.9 } })).toBeNull();
    expect(usoPedidoNaConversa({ mensagem: "usa só o rosto", usoAtual: null, resposta: null })).toBeNull();
    // O servidor liga a rede depois do diretor e antes do antes e depois.
    const c = trecho("async function conversar(", "/** Linha curta com as mudanças propostas");
    expect(c.indexOf("const mudancaDoUso = await mudancaDeUsoNaConversa(")).toBeGreaterThan(c.indexOf("const avisos = normalizadas.avisos;"));
    expect(c.indexOf("const mudancaDoUso = await mudancaDeUsoNaConversa(")).toBeLessThan(c.indexOf("antes: antesDaMudanca(t.direcao, m, rotuloDaFoto)"));
    expect(servidor).toContain("questions: { uso: perguntaDoUso({ caminhoDaFoto: \"foto_da_lamina\", nenhum: true }) as PerguntaJev },");
  });

  it("o contexto do diretor mostra o uso de cada foto; sem caixa só com foto exata", () => {
    expect(servidor).toContain("uso: usoDaFotoNaLamina(c) }");
    expect(servidor).toContain("fotos_da_equipe: (c.fotos_livres ?? []).map((f) => ({ papel: f.papel, nota: f.nota ?? null, uso: usoDaFotoLivre(f) })),");
    expect(servidor).toContain("(c.fotos_livres ?? []).some((f) => f.papel === \"fundo\" && usoDaFotoLivre(f) === \"exata\")");
  });
});

// ------------------------------------------------------------------ 5

describe("5. Conferência: só aviso", () => {
  it("pose copiada: leitura ou pixels alinhados; fora disso, nada", () => {
    expect(avisoDaPoseCopiada({ poseIgualNaLeitura: true, erroDoAlinhamento: 40 }).aviso).toBe(true);
    expect(avisoDaPoseCopiada({ poseIgualNaLeitura: false, erroDoAlinhamento: 3.2 }).aviso).toBe(true);
    expect(avisoDaPoseCopiada({ poseIgualNaLeitura: false, erroDoAlinhamento: 44 }).aviso).toBe(false);
    expect(avisoDaPoseCopiada({ poseIgualNaLeitura: null, erroDoAlinhamento: null }).aviso).toBe(false);
    expect(avisoDaPoseCopiada({ poseIgualNaLeitura: true, erroDoAlinhamento: null }).texto).toMatch(/gere de novo ou troque para Foto exata/);
  });

  it("o esquema com pose só no modo rosto; o de sempre fica igual", () => {
    expect(ESQUEMA_CONFERENCIA_DO_ROSTO.schema.required).toEqual(["pessoa_na_arte", "nas_fotos", "na_arte", "impressao_geral"]);
    expect(ESQUEMA_CONFERENCIA_DO_ROSTO_COM_POSE.schema.required).toContain("pose_igual_a_foto");
    expect(SISTEMA_CONFERENCIA_DO_ROSTO_COM_POSE).toContain("pose_igual_a_foto");
    expect(SISTEMA_CONFERENCIA_DO_ROSTO_COM_POSE.trim().endsWith("Só o JSON pedido.")).toBe(true);
    const c = trecho("async function conferirRosto(", "/** O que a versão guarda do rosto");
    expect(c).toContain("const daFoto = !!rosto && rosto.origem === \"foto_da_lamina\";");
    expect(c).toContain("esquemaJson: daFoto ? ESQUEMA_CONFERENCIA_DO_ROSTO_COM_POSE : ESQUEMA_CONFERENCIA_DO_ROSTO,");
    // Sem laço: nada de gerar de novo na conferência.
    expect(c).not.toMatch(/gerarCard\(|chamarImagem\(/);
  });
});

// ------------------------------------------------------------------ 6

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

describe("6. Tela", () => {
  const props = (card: any, onTrocarUso = vi.fn()) => ({ card, refsDoConjunto: [], continuo: false, versao: null, onAbrirFotos: vi.fn(), onAbrirReferencias: vi.fn(), onTrocarUso });

  it("base da lâmina: cada foto com o seletor compacto; trocar chama onTrocarUso; logo e recorte sem seletor", () => {
    const onTrocarUso = vi.fn();
    const card = {
      ordem: 1,
      fotos_livres: [
        { caminho: CAMINHO, papel: "fundo" },
        { caminho: `${CLIENTE}/pedidos/logo.png`, papel: "elemento", nota: "Logo do pedido (logo.png): aplicar exatamente como está" },
      ],
    };
    const { container } = montar(h(EstudioBaseDaLamina, props(card, onTrocarUso)));
    const seletores = container.querySelectorAll("[data-seletor-uso]");
    expect(seletores.length).toBe(1);
    const grupo = screen.getByRole("radiogroup", { name: "Uso da fundo" });
    expect(within(grupo).getByRole("radio", { name: "Foto exata" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(grupo).getByRole("radio", { name: "Usar o rosto" }));
    expect(onTrocarUso).toHaveBeenCalledWith({ caminho: CAMINHO }, "rosto");
  });

  it("escolha do agente fica visível (auto) e o rótulo da miniatura vira Rosto (identidade)", () => {
    const card = { ordem: 1, fotos_livres: [{ caminho: CAMINHO, papel: "fundo", uso: "rosto", uso_por: "jev" }] };
    const { container } = montar(h(EstudioBaseDaLamina, props(card)));
    const grupo = screen.getByRole("radiogroup", { name: "Uso da rosto (identidade)" });
    expect(within(grupo).getByRole("radio", { name: "Usar o rosto" }).getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector("[data-uso-por='jev']")).toBeTruthy();
    expect(container.querySelector("[title='Rosto (identidade)']")).toBeTruthy();
  });

  it("foto do acervo: o seletor grava pelo alvo acervo", () => {
    const onTrocarUso = vi.fn();
    montar(h(EstudioBaseDaLamina, props({ ordem: 1, imagens_ids: [FOTO_ID] }, onTrocarUso)));
    const grupo = screen.getByRole("radiogroup", { name: "Uso da foto do acervo" });
    fireEvent.click(within(grupo).getByRole("radio", { name: "Usar o rosto" }));
    expect(onTrocarUso).toHaveBeenCalledWith({ acervo: true }, "rosto");
  });

  it("seletor bloqueado não troca; sem caixa (sem borda de cartão)", () => {
    const onTrocar = vi.fn();
    const { container } = render(h(SeletorDoUso, { uso: "exata", rotulo: "foto", bloqueado: true, onTrocar }));
    fireEvent.click(screen.getByRole("radio", { name: "Usar o rosto" }));
    expect(onTrocar).not.toHaveBeenCalled();
    expect(container.querySelector("[data-seletor-uso]")!.className).not.toMatch(/border/);
  });

  it("AbaEstudio grava o uso pelo configurar; Arte rápida explica no ? e lista o papel novo", () => {
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain("onTrocarUso={(alvo, uso) => void trocarUsoDaFoto(cardSelecionado, alvo, uso)}");
    expect(aba).toContain("await configurar({ card: { ordem: card.ordem, uso_do_acervo: uso } });");
    expect(aba).toContain("f.caminho === alvo.caminho ? { ...f, uso, uso_por: \"equipe\" as const } : f");
    const rapida = ler("src/components/mesa/EstudioArteRapida.tsx");
    expect(rapida).toContain("{AJUDA_DO_USO} Em Automático, o agente decide pelo pedido");
    expect(rapida).toContain("{PAPEIS_DO_ARQUIVO.map((p) => (");
    expect(AJUDA_DO_USO).toMatch(/Foto exata: .*Usar o rosto: /);
    // Servidor: configurar aceita uso_do_acervo e fotos_livres com uso (recorte nunca vira rosto).
    expect(servidor).toContain("if (uso === \"rosto\" && !saida[saida.length - 1].recortada) {");
    expect(servidor).toContain("throw new ErroEstudio(400, \"uso_invalido\", \"Uso da foto inválido. Use exata ou rosto.\");");
  });

  it("arquivos novos: sem travessão, sem lookbehind, \\p{} nem grupo nomeado", () => {
    for (const f of ["supabase/functions/_shared/uso-da-foto.ts"]) {
      const s = ler(f);
      expect(s).not.toContain("—");
      expect(s).not.toMatch(/\(\?<[=!]|\\p\{|\(\?<[a-z]/);
    }
  });
});
