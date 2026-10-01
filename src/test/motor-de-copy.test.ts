import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocoDoMotor,
  CANAIS,
  conferirCopy,
  escolherFrameworks,
  frameworkDaCopy,
  lerConferencia,
  limparCopy,
  notaDaCopy,
  objetivoDaCopy,
  pedeSemTravessao,
  perguntaDoCliche,
  perguntasDaConferencia,
  porqueDaEscolha,
  ranquear,
  REGRA_DA_LEGENDA_NO_PLANO,
  regrasDaCasa,
} from "../../supabase/functions/_shared/motor-de-copy";

const fonte = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("motor de copy: objetivo e estrutura", () => {
  it("lê o objetivo do Mês, do Ads e do pedido livre", () => {
    expect(objetivoDaCopy("conversao_vendas")).toBe("venda");
    expect(objetivoDaCopy("viralizacao_descoberta")).toBe("descoberta");
    expect(objetivoDaCopy("autoridade_confianca")).toBe("autoridade");
    expect(objetivoDaCopy("engajamento_relacionamento")).toBe("relacionamento");
    expect(objetivoDaCopy("conscientizacao_educacao")).toBe("educacao");
    expect(objetivoDaCopy("Gerar mensagens no WhatsApp")).toBe("contato");
    expect(objetivoDaCopy("OUTCOME_SALES")).toBe("venda");
    expect(objetivoDaCopy(null)).toBe("educacao");
  });

  it("escolhe estruturas diferentes, primeiro as que servem ao objetivo e ao canal", () => {
    const venda = escolherFrameworks("venda", "anuncio", 3);
    expect(venda).toHaveLength(3);
    expect(new Set(venda).size).toBe(3);
    expect(["aida", "pas"]).toContain(venda[0]);
    expect(escolherFrameworks("descoberta", "lamina", 1)[0]).toBe("4u");
    expect(escolherFrameworks("educacao", "roteiro", 1)[0]).toBe("gcc");
    // Mais variações que estruturas: repete na ordem, nunca quebra.
    expect(escolherFrameworks("venda", "legenda", 7)).toHaveLength(7);
  });

  it("aceita o nome da estrutura no lugar do id", () => {
    expect(frameworkDaCopy("AIDA")).toBe("aida");
    expect(frameworkDaCopy("Gancho, corpo e CTA")).toBe("gcc");
    expect(frameworkDaCopy("4U")).toBe("4u");
    expect(frameworkDaCopy("lista")).toBeNull();
  });

  it("o bloco do pedido é curto e traz canal, estruturas, tamanho, CTA e regras da casa", () => {
    const b = blocoDoMotor({ canal: "legenda", objetivo: "venda", variacoes: 3 });
    expect(b.length).toBeLessThan(1_900);
    expect(b).toContain("Legenda do Instagram");
    expect(b).toContain("variação 1 em");
    expect(b).toContain("até 2200 caracteres");
    expect(b).toContain("primeira linha com até 125");
    expect(b).toContain("CTA: um só");
    expect(b).toContain("Sem promessa proibida");
    expect(b).toContain("Sem clichê de IA");
    expect(b).toContain("Sem travessão");
    expect(b).not.toMatch(/[\u2014\u2013]/);
    const pedida = blocoDoMotor({ canal: "legenda", objetivo: "educacao", variacoes: 3, estruturaPedida: "Lista" });
    expect(pedida).toContain("a pedida pela equipe (Lista)");
    expect(pedida).not.toContain("variação 1 em");
    expect(REGRA_DA_LEGENDA_NO_PLANO.length).toBeLessThan(500);
  });
});

describe("motor de copy: regras da casa, limpeza e conferência em código", () => {
  it("vê quando o cliente pede sem travessão", () => {
    expect(pedeSemTravessao("Regras: não usar travessão nas legendas")).toBe(true);
    expect(pedeSemTravessao("Evitar o uso de travessão")).toBe(true);
    expect(pedeSemTravessao("Tom leve e próximo")).toBe(false);
    expect(regrasDaCasa("tom leve").semTravessao).toBe(true);
    expect(regrasDaCasa("tom leve", false).semTravessao).toBe(false);
    expect(regrasDaCasa("sem travessão, por favor", false).semTravessao).toBe(true);
  });

  it("limpa sem reescrever: travessão, aspas, espaços, hashtags no fim e teto do canal", () => {
    const r = limparCopy("\u201cSeu carro merece \u2014 e você também.   Agende hoje!\n\n\n#oficina #curitiba\u201d", "legenda", { semHashtags: true });
    expect(r.texto).toBe("Seu carro merece, e você também. Agende hoje!");
    expect(r.ajustes).toContain("travessão trocado por vírgula");
    const longo = limparCopy("Frase curta. ".repeat(40), "bio");
    expect(longo.texto.length).toBeLessThanOrEqual(CANAIS.bio.max);
    expect(longo.ajustes.join(" ")).toContain("cortado");
    expect(limparCopy("x ".repeat(200), "bio", { cortar: false }).texto.length).toBeGreaterThan(CANAIS.bio.max);
    expect(limparCopy("A \u2014 B", "legenda", { regras: { semTravessao: false } }).texto).toBe("A \u2014 B");
  });

  it("acha clichê de IA, promessa proibida, falta de CTA e gancho longo", () => {
    const ruim = conferirCopy("No mundo de hoje, desbloqueie todo o potencial da sua jornada com resultados garantidos e o melhor do Brasil em atendimento para toda a família e amigos.", "legenda");
    const tipos = ruim.problemas.map((p) => p.tipo);
    expect(tipos).toContain("cliche");
    expect(tipos).toContain("promessa");
    expect(tipos).toContain("sem_cta");
    expect(tipos).toContain("primeira_linha");
    expect(ruim.nota).toBeLessThanOrEqual(3);
    const boa = conferirCopy("Troca de óleo em 30 minutos no Bacacheri.\nVocê espera tomando um café e sai com o checklist do carro.\nChame no WhatsApp e agende o seu horário.", "legenda");
    expect(boa.problemas).toEqual([]);
    expect(boa.nota).toBe(10);
    expect(conferirCopy("", "legenda").problemas[0].tipo).toBe("vazia");
    expect(conferirCopy("Headline #promo", "lamina").problemas.map((p) => p.tipo)).toContain("hashtag");
  });
});

describe("motor de copy: Jev, nota e ordem", () => {
  it("faz 5 perguntas independentes por variação, com Score em lista ordenada", () => {
    const q = perguntasDaConferencia(3);
    expect(Object.keys(q)).toHaveLength(15);
    for (const i of [0, 1, 2]) {
      for (const k of ["voz", "forca", "inventa", "promessa", "cliche"]) expect(q[`${k}_${i}`]).toBeTruthy();
      const voz = q[`voz_${i}`] as { type: string; criteria: string[] };
      expect(voz.type).toBe("score");
      expect(Array.isArray(voz.criteria)).toBe(true);
      expect(voz.criteria.length).toBe(5);
      expect(q[`inventa_${i}`].type).toBe("noul");
    }
    expect(perguntaDoCliche("`copies[0]`").instructions).toContain("`copies[0]`");
  });

  it("lê as respostas e aplica a política da nota (voz, força, código e penalidades)", () => {
    const notas = lerConferencia(
      {
        voz_0: { score: 4 }, forca_0: { score: 3 }, inventa_0: { noul: 0.1 }, promessa_0: { noul: 0.05 }, cliche_0: { noul: 0.1 },
        voz_1: { score: 4 }, forca_1: { score: 4 }, inventa_1: { noul: 0.8 }, promessa_1: { noul: 0.7 }, cliche_1: { noul: 0.2 },
        voz_2: { score: 1 }, forca_2: { score: 1 }, inventa_2: { noul: 0.1 }, promessa_2: { noul: 0.1 }, cliche_2: { noul: 0.9 },
      },
      3,
    );
    expect(notas[0]).toEqual({ voz: 10, forca: 7.5, inventa: 0.1, promessa: 0.05, cliche: 0.1 });
    const local = { nota: 10, problemas: [] };
    const c0 = notaDaCopy(local, notas[0], 0);
    const c1 = notaDaCopy(local, notas[1], 1);
    const c2 = notaDaCopy(local, notas[2], 2);
    expect(c0.nota).toBe(91);
    expect(c0.alerta).toBe(false);
    expect(c1.alerta).toBe(true);
    expect(c1.avisos.join(" ")).toContain("promessa");
    expect(c2.avisos.join(" ")).toContain("genérico de IA");
    expect(c2.avisos.join(" ")).toContain("Pouco da voz da marca");
    // A com alerta vai para o fim mesmo com nota maior que a fraca.
    expect(ranquear([c1, c2, c0]).map((c) => c.indice)).toEqual([0, 2, 1]);
    expect(porqueDaEscolha(c0, 3)).toContain("Melhor de 3");
    // Sem o Jev: só a conferência em código.
    const semJev = notaDaCopy({ nota: 7, problemas: [] }, null);
    expect(semJev.nota).toBe(70);
    expect(porqueDaEscolha(semJev, 1)).toContain("sem o Jev");
  });
});

describe("motor de copy ligado nas mesas", () => {
  it("fica pequeno no compartilhado e sem travessão", () => {
    const puro = fonte("supabase/functions/_shared/motor-de-copy.ts");
    const servidor = fonte("supabase/functions/_shared/motor-de-copy-servidor.ts");
    expect(puro.length + servidor.length).toBeLessThan(30_000);
    expect(puro).not.toMatch(/[\u2014\u2013]/);
    expect(servidor).not.toMatch(/[\u2014\u2013]/);
    expect(puro).not.toMatch(/from "npm:|Deno\./);
  });

  it("Estúdio: legenda em 3 variações conferidas, a melhor no campo e as outras na resposta", () => {
    const e = fonte("supabase/functions/estudio-arte/index.ts");
    expect(e).toContain("const VARIACOES_DA_LEGENDA = 3;");
    expect(e).toContain('motor_de_copy: blocoDoMotor({ canal: "legenda", objetivo: objetivoDoPost, variacoes: VARIACOES_DA_LEGENDA, partirDoPrevisto: temLegendaPrevista, regras: voz.regras })');
    expect(e).toContain("contexto_completo_da_marca: voz.bloco || null");
    expect(e).toContain("const conf = await conferirCopies({");
    expect(e).toContain("porque: porqueDaEscolha(conf.conferencias[conf.ordem[0]], escritas.length)");
    // O refino também vem conferido e em ordem, sem cortar no teto do canal.
    expect(e).toContain("cortar: false,");
    expect(e).toContain("estruturaPedida: framework ? framework.nome : null");
  });

  it("Mês e Campanhas: a legenda de todo item passa pelo motor", () => {
    const c = fonte("supabase/functions/agente-calendario/index.ts");
    expect(c).toContain("const legenda = copyDoItem(o.copy, o.cta);");
    expect(c).toContain("copy: legenda.texto,");
    expect(c.split("${REGRA_DA_LEGENDA_NO_PLANO}").length - 1).toBe(3);
    // A legenda revisada pelo agente também passa pelo motor, e os avisos dela trocam os da legenda antiga.
    expect(c).toContain("const legenda = copyDoItem(campos.copy, novo.cta);");
    expect(c).toContain('import { legendaDoItem } from "./modulos/legenda-do-item.ts";');
  });

  it("Ads, Roteiros, Site e Proposta usam o motor", () => {
    const ads = fonte("supabase/functions/mesa-ads/index.ts");
    expect(ads).toContain("questions[`cliche_${i}`] = perguntaDoCliche(`\\`copies[${i}]\\``);");
    expect(ads).toContain('limparCopy(v, "anuncio", { cortar: false })');
    const rot = fonte("supabase/functions/mesa-roteiros/index.ts");
    expect(rot).toContain("roteiroPeloMotorDeCopy(normalizarRoteiro(");
    // Sem o Jev, as frases da conferência em código continuam (comportamento testado em motor-de-copy-comportamento).
    expect(rot).toContain("const aviso = avisoComAsFrasesDaCasa(await avisoDoJev(");
    expect(rot).toContain('registrarFalha("mesa-roteiros: Jev indisponível (vale a conferência em código)"');
    expect(rot).toContain('cliche: perguntaDoCliche("formada pelo `gancho` e pela fala dos `blocos`")');
    const site = fonte("supabase/functions/mesa-site/index.ts");
    expect(site).toContain('canal: "site",');
    expect(site).toContain("conferencia: { nota: conf.conferencias[i].nota");
    const pro = fonte("supabase/functions/mesa-proposta/evolucao.ts");
    expect(pro).toContain('canal: "proposta",');
    expect(pro).toContain("oferta: ofertaDosFatos([");
    expect(site).toContain("oferta: ofertaDosFatos([");
    expect(pro).toContain('blocoDoMotor({ canal: "proposta", objetivo: "venda", variacoes: 3, frameworks: ["4u", "bab", "pas"] })');
  });

  it("a tela mostra a nota e as outras opções da legenda", () => {
    const aba = fonte("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain("setOpcoesDaLegenda(opcoesDaResposta(data));");
    expect(aba).toContain("<OpcoesDaCopy");
    const refino = fonte("src/components/mesa/EstudioRefinarTexto.tsx");
    expect(refino).toContain("<NotaDaCopy nota={o.nota}");
  });
});
