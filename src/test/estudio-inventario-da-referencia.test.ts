// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocoDoPreenchimento,
  comTextoDosElementos,
  conferirElementos,
  copiaDaReferencia,
  elementosDaLamina,
  ganchosParaInspiracao,
  imagemDaLamina,
  inventarioDasImagens,
  normalizarInventario,
  preencherLamina,
  semLinhaDosVagos,
  textosDosElementos,
  validarPreenchimento,
} from "../../supabase/functions/estudio-arte/modulos/inventario-da-referencia";
import { decidirAutocorrecao } from "../../supabase/functions/estudio-arte/autocorrecao";
import { pedidoParaODiretor } from "../../supabase/functions/estudio-arte/modulos/arte-rapida";
import { promptDoReplicar, type MarcaParaDirecao, type MoldeDaReferencia } from "../../supabase/functions/_shared/direcao-arte";

/**
 * 22/10/2026 (dono): "nas referências, quando eu mando a de imagens, tem que
 * ler e complementar espaços, tipo balões que têm conteúdo na referência; ele
 * copia idêntico e não coloca nada, completar deixa vazio". O inventário lê
 * cada elemento com texto; o preenchimento dá o texto NOVO de cada um (nunca
 * vazio, nunca o da referência); o gerador e a conferência recebem o mapa.
 */

const LIDO = {
  elementos: [
    { imagem: 1, tipo: "titulo", posicao: "no topo, de lado a lado", funcao: "gancho", tamanho: "curto", itens: 0, texto_original: "Você ainda faz isso?" },
    { imagem: 1, tipo: "balao", posicao: "no meio, à esquerda", funcao: "pergunta", tamanho: "curto", itens: 0, texto_original: "Quanto custa um site?" },
    { imagem: 1, tipo: "balao", posicao: "no meio, à direita", funcao: "resposta", tamanho: "medio", itens: 0, texto_original: "Depende do que você precisa, mas começa barato e cresce junto com o negócio" },
    { imagem: 1, tipo: "caixa", posicao: "na base, à esquerda", funcao: "beneficio", tamanho: "curto", itens: 0, texto_original: "Entrega em 7 dias" },
    { imagem: 1, tipo: "lista", posicao: "na base, à direita", funcao: "passo", tamanho: "curto", itens: 3, texto_original: "Briefing / Layout / Publicação" },
    { imagem: 1, tipo: "selo", posicao: "no canto de cima, à direita", funcao: "prova", tamanho: "curto", itens: 0, texto_original: "+500 clientes" },
    { imagem: 1, tipo: "desenho", posicao: "x", funcao: "outro", tamanho: "curto", itens: 0, texto_original: "fora da lista" },
  ],
};

const LAMINA = "Seu cardápio no celular\nO cliente pede pelo link, sem fila";
const PAUTA = "Pedido: post sobre o cardápio digital da pizzaria, pedido pelo link e entrega rápida.";

describe("inventário da referência (leitura estruturada por visão)", () => {
  it("lê balões, caixas, lista e selo com tipo, posição, função, tamanho e itens", () => {
    const inv = normalizarInventario(LIDO, 1)!;
    expect(inv.elementos.map((e) => e.tipo)).toEqual(["titulo", "balao", "balao", "caixa", "lista", "selo"]);
    expect(inv.elementos.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
    const resposta = inv.elementos[2];
    expect(resposta).toMatchObject({ posicao: "no meio, à direita", funcao: "resposta", tamanho: "medio" });
    expect(inv.elementos[4]).toMatchObject({ tipo: "lista", itens: 3 });
    // Texto longo nunca é "curto", mesmo que a visão diga.
    expect(normalizarInventario({ elementos: [{ ...LIDO.elementos[2], tamanho: "curto" }] }, 1)!.elementos[0].tamanho).toBe("medio");
    expect(normalizarInventario({ elementos: [] }, 1)).toBeNull();
  });

  it("a lâmina preenche os elementos da imagem dela; título e CTA ficam com o texto da própria lâmina", () => {
    const inv = normalizarInventario(LIDO, 1)!;
    const { elementos } = elementosDaLamina(inv, 3, 5);
    expect(elementos.map((e) => e.tipo)).toEqual(["balao", "balao", "caixa", "lista", "selo"]);
    // Uma imagem por lâmina quando dá; senão a 1 na capa e as outras em roda no miolo.
    expect([1, 2, 3].map((o) => imagemDaLamina(3, o, 3))).toEqual([1, 2, 3]);
    expect([1, 2, 3, 4, 5].map((o) => imagemDaLamina(3, o, 5))).toEqual([1, 2, 3, 2, 3]);
    expect([1, 2, 3].map((o) => imagemDaLamina(1, o, 3))).toEqual([1, 1, 1]);
  });
});

describe("preenchimento completo: texto novo em cada elemento", () => {
  const inv = normalizarInventario(LIDO, 1)!;
  const { elementos } = elementosDaLamina(inv, 1, 1);
  const base = { ordem: 1, imagem: 1, fonte: PAUTA, textoDaLamina: LAMINA };

  it("todo elemento recebe texto novo, com a função dele, e entra no texto exato", () => {
    const p = validarPreenchimento(elementos, {
      elementos: [
        { id: "e2", acao: "preencher", texto: "Dá para pedir sem ligar?" },
        { id: "e3", acao: "preencher", texto: "Dá sim: o cliente abre o link, escolhe a pizza e confirma o pedido" },
        { id: "e4", acao: "preencher", texto: "Pedido pelo link" },
        { id: "e5", acao: "preencher", texto: "Abre o link\nEscolhe a pizza\nConfirma" },
        { id: "e6", acao: "preencher", texto: "Sem fila" },
      ],
    }, base);
    expect(p.elementos.every((e) => e.acao === "preencher" && e.texto)).toBe(true);
    expect(p.elementos.find((e) => e.id === "e5")!.texto.split("\n")).toHaveLength(3);
    const texto = comTextoDosElementos(LAMINA, p);
    expect(texto).toContain("Dá para pedir sem ligar?");
    expect(texto.startsWith(LAMINA)).toBe(true);
    const bloco = blocoDoPreenchimento(p);
    expect(bloco).toContain('balão de fala no meio, à esquerda (pergunta): "Dá para pedir sem ligar?"');
    expect(bloco).toContain('lista na base, à direita (passo, 3 itens, um por linha): "Abre o link / Escolhe a pizza / Confirma"');
    expect(bloco).toContain("Nenhum balão, caixa, selo, lista, seta, tabela ou rótulo fica vazio");
    expect(bloco).not.toMatch(/[—–]/);
  });

  it("nunca o texto original: o que repete a referência sai inteiro", () => {
    expect(copiaDaReferencia("Quanto custa um site?", "Quanto custa um site?")).toBe(true);
    expect(copiaDaReferencia("quanto custa um SITE", "Quanto custa um site?")).toBe(true);
    expect(copiaDaReferencia("Depende do que você precisa, mas começa barato", "Depende do que você precisa, mas começa barato e cresce junto com o negócio")).toBe(true);
    expect(copiaDaReferencia("Dá para pedir sem ligar?", "Quanto custa um site?")).toBe(false);
    const p = validarPreenchimento(elementos, { elementos: elementos.map((e) => ({ id: e.id, acao: "preencher", texto: e.texto_original })) }, base);
    expect(p.elementos.every((e) => e.acao === "remover")).toBe(true);
    expect(p.elementos.find((e) => e.id === "e2")!.motivo).toBe("copia");
    expect(textosDosElementos(p)).toEqual([]);
    // Nenhuma palavra da referência vai ao gerador como texto a escrever.
    const bloco = blocoDoPreenchimento(p);
    expect(bloco).not.toContain("Quanto custa um site");
    expect(bloco).toContain("Saem por inteiro, forma e texto, sem deixar o espaço vazio");
  });

  it("elemento sem conteúdo é removido em vez de ficar vazio (remover, vazio, esquecido, número inventado)", () => {
    const p = validarPreenchimento(elementos, {
      elementos: [
        { id: "e2", acao: "preencher", texto: "   " },
        { id: "e3", acao: "remover", texto: "" },
        { id: "e4", acao: "preencher", texto: "Entrega em 30 minutos" },
        { id: "e6", acao: "preencher", texto: "+500 pizzarias atendidas" },
      ],
    }, base);
    const porId = (id: string) => p.elementos.find((e) => e.id === id)!;
    expect(porId("e2")).toMatchObject({ acao: "remover", motivo: "vazio", texto: "" });
    expect(porId("e3")).toMatchObject({ acao: "remover", motivo: "sem_conteudo" });
    expect(porId("e4")).toMatchObject({ acao: "remover", motivo: "numero_inventado" });
    expect(porId("e5")).toMatchObject({ acao: "remover" });
    expect(porId("e6")).toMatchObject({ acao: "remover", motivo: "numero_inventado" });
    // Número que está no conteúdo vale.
    const comNumero = validarPreenchimento(elementos, { elementos: [{ id: "e4", acao: "preencher", texto: "Entrega em 30 minutos" }] }, { ...base, fonte: `${PAUTA} Entrega em até 30 minutos.` });
    expect(comNumero.elementos.find((e) => e.id === "e4")!.acao).toBe("preencher");
    // Nunca sobra elemento sem decisão: ou texto, ou fora.
    expect(p.elementos.every((e) => (e.acao === "preencher" ? !!e.texto : e.texto === ""))).toBe(true);
  });

  it("texto que já está na lâmina não entra duas vezes no texto exato", () => {
    const p = validarPreenchimento(elementos, { elementos: [{ id: "e4", acao: "preencher", texto: "O cliente pede pelo link, sem fila" }] }, base);
    expect(p.elementos.find((e) => e.id === "e4")).toMatchObject({ acao: "preencher", na_lamina: true });
    expect(comTextoDosElementos(LAMINA, p)).toBe(LAMINA);
  });

  it("orquestração: uma chamada por lâmina, guardada; redator fora do ar tira os elementos inteiros, com aviso", async () => {
    const guardados = new Map<string, Record<string, unknown>>();
    const deps = {
      pasta: "c/estudio/leituras",
      lerGuardado: async (c: string) => guardados.get(c) ?? null,
      guardar: async (c: string, v: unknown) => void guardados.set(c, v as Record<string, unknown>),
    };
    let chamadas = 0;
    const escrever = async () => {
      chamadas++;
      return { json: { elementos: elementos.map((e) => ({ id: e.id, acao: "preencher", texto: `Texto novo do ${e.id} sobre o link` })) }, custoUsd: 0.002 };
    };
    const e = { inventario: inv, ordem: 1, total: 1, textoDaLamina: LAMINA, pauta: PAUTA, fonte: PAUTA, ganchos: ["Pare de perder pedido no WhatsApp"] };
    const r1 = await preencherLamina(e, { ...deps, escrever });
    const r2 = await preencherLamina(e, { ...deps, escrever });
    expect(chamadas).toBe(1);
    expect(r2.custoUsd).toBe(0);
    expect(r1.preenchimento!.elementos.every((x) => x.acao === "preencher")).toBe(true);
    const falha = await preencherLamina({ ...e, ordem: 1, textoDaLamina: "Outro texto" }, { ...deps, escrever: async () => { throw new Error("fora do ar"); } });
    expect(falha.preenchimento!.elementos.every((x) => x.acao === "remover" && x.motivo === "sem_redator")).toBe(true);
    expect(falha.aviso).toContain("saem inteiros em vez de ficarem vazios");
    // Sem inventário: nada é chamado.
    expect((await preencherLamina({ ...e, inventario: null }, { ...deps, escrever })).preenchimento).toBeNull();
  });

  it("inventário guardado: as imagens só abrem quando não há leitura", async () => {
    const guardados = new Map<string, Record<string, unknown>>();
    const deps = { pasta: "p", lerGuardado: async (c: string) => guardados.get(c) ?? null, guardar: async (c: string, v: unknown) => void guardados.set(c, v as Record<string, unknown>) };
    let abriu = 0;
    const abrir = async () => { abriu++; return ["img"]; };
    const ler = async () => ({ json: LIDO, custoUsd: 0.001 });
    const a = await inventarioDasImagens("ref:1", [], { ...deps, ler }, abrir);
    const b = await inventarioDasImagens("ref:1", [], { ...deps, ler }, abrir);
    expect(a.inventario!.elementos).toHaveLength(6);
    expect(b.inventario!.elementos).toHaveLength(6);
    expect(abriu).toBe(1);
  });
});

describe("conferência: elemento vazio e texto copiado da referência", () => {
  const inv = normalizarInventario(LIDO, 1)!;
  const { elementos } = elementosDaLamina(inv, 1, 1);
  const p = validarPreenchimento(elementos, {
    elementos: [
      { id: "e2", acao: "preencher", texto: "Dá para pedir sem ligar?" },
      { id: "e3", acao: "preencher", texto: "Dá sim, pelo link do cardápio" },
      { id: "e4", acao: "remover", texto: "" },
    ],
  }, { ordem: 1, imagem: 1, fonte: PAUTA, textoDaLamina: LAMINA });

  it("acusa o balão sem o texto do mapa e o texto da referência que ficou na arte", () => {
    const lido = `${LAMINA}\nDá para pedir sem ligar?\nEntrega em 7 dias`;
    const r = conferirElementos(p, lido, LAMINA);
    expect(r.vazios.map((v) => v.id)).toEqual(["e3"]);
    expect(r.vazios[0]).toMatchObject({ rotulo: "balão de fala", posicao: "no meio, à direita" });
    expect(r.copiados.map((c) => c.texto_original)).toEqual(["Entrega em 7 dias"]);
    expect(r.copiados[0].substituir).toBeNull();
    // Arte certa: nada a acusar.
    expect(conferirElementos(p, `${LAMINA}\nDá para pedir sem ligar?\nDá sim, pelo link do cardápio`, LAMINA)).toEqual({ vazios: [], copiados: [] });
  });

  it("a autocorreção corrige sozinha: escreve o texto no balão vazio e apaga ou troca o texto copiado", () => {
    const r = conferirElementos(p, `${LAMINA}\nDá para pedir sem ligar?\nQuanto custa um site?\nEntrega em 7 dias`, LAMINA);
    const d = decidirAutocorrecao({ texto_lido: "x", ortografia_ok: true, logo_ok: true, elementos_vazios: r.vazios, textos_copiados: r.copiados }, { ads: false, textoExato: comTextoDosElementos(LAMINA, p) });
    expect(d.precisa).toBe(true);
    expect(d.motivos.join(" | ")).toContain("Elemento vazio: balão de fala no meio, à direita");
    expect(d.motivos.join(" | ")).toContain('Texto copiado da referência: "Quanto custa um site?", "Entrega em 7 dias"');
    expect(d.instrucao).toContain('Escreva dentro do balão de fala (no meio, à direita) o texto "Dá sim, pelo link do cardápio"');
    expect(d.instrucao).toContain('Troque o texto "Quanto custa um site?" (balão de fala, no meio, à esquerda) por "Dá para pedir sem ligar?"');
    expect(d.instrucao).toContain("Apague o caixa de texto (na base, à esquerda) inteiro");
  });
});

describe("o mapa chega ao gerador e ao diretor", () => {
  const MARCA: MarcaParaDirecao = { nomeCliente: "Cliente", paleta: [{ nome: "Verde", hex: "#1f6f43", papel: "fundo" }], estilo: "", regras: null, fontes: [{ nome: "Fonte", papel: "titulo" }], temLogo: false };
  const MOLDE: MoldeDaReferencia = {
    versao: 2, proporcao: "4:5", fundo: "cor lisa", cor_do_fundo: "#F2F2EE", grade: "título em cima, balões no meio", assunto: null, elementos: [], tratamento: "chapado",
    blocos: [
      { papel: "titulo", x0: 6, y0: 6, x1: 94, y1: 20, altura_da_letra: 8, linhas: 1, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "black", cor: "#111111", alinhamento: "centro" },
      { papel: "texto", x0: 6, y0: 40, x1: 45, y1: 50, altura_da_letra: 2, linhas: 2, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "regular", cor: "#111111", alinhamento: "esquerda" },
      { papel: "texto", x0: 55, y0: 55, x1: 94, y1: 65, altura_da_letra: 2, linhas: 2, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "regular", cor: "#111111", alinhamento: "esquerda" },
    ],
  };

  it("replicar: a linha que mandava deixar os blocos da referência sem texto sai quando há mapa", () => {
    const { prompt } = promptDoReplicar({
      card: { ordem: 1, funcao: "capa", texto_exato: "Seu cardápio no celular", blocos: [{ papel: "headline", texto: "Seu cardápio no celular" }] },
      marca: MARCA, total: 1, referencias: [{ indice: 1, molde: MOLDE }], editando: true, fotos: [], logo: { leva: false, indice: null, medida: null, descricao: null }, quadro: { largura: 1080, altura: 1350 },
    });
    expect(prompt).toContain("ficam sem texto nenhum");
    const inv = normalizarInventario(LIDO, 1)!;
    const p = validarPreenchimento(elementosDaLamina(inv, 1, 1).elementos, { elementos: [{ id: "e2", acao: "preencher", texto: "Dá para pedir sem ligar?" }] }, { ordem: 1, imagem: 1, fonte: PAUTA, textoDaLamina: LAMINA });
    const limpo = semLinhaDosVagos(prompt, p);
    expect(limpo).not.toContain("ficam sem texto nenhum");
    expect(limpo).toContain("1. TEXTO EXATO");
    // Sem mapa, o prompt é o de sempre.
    expect(semLinhaDosVagos(prompt, null)).toBe(prompt);
  });

  it("o diretor da arte rápida recebe os elementos (sem o texto da referência)", () => {
    const inv = normalizarInventario(LIDO, 1)!;
    const saida = pedidoParaODiretor({ pedido: "post", peca: "unica", arquivos: [], inventario_da_referencia: inv }, []) as Record<string, { elementos: unknown[] }>;
    expect(saida.elementos_da_referencia.elementos).toHaveLength(6);
    expect(JSON.stringify(saida.elementos_da_referencia)).not.toContain("Quanto custa um site");
  });

  it("ganchos vencedores: leitura tolerante (sem tabela, lista vazia)", () => {
    expect(ganchosParaInspiracao(null)).toEqual([]);
    expect(ganchosParaInspiracao([{ gancho: "Pare de perder pedido" }, { texto: "pare de perder pedido!" }, { titulo: "Outro gancho" }, { nada: 1 }])).toEqual(["Pare de perder pedido", "Outro gancho"]);
  });

  it("servidor: o mapa vai ao prompt, às regras finais, à versão e à conferência", () => {
    const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");
    const estudio = ler("supabase/functions/estudio-arte/index.ts");
    const gerar = estudio.slice(estudio.indexOf("async function gerarCard("), estudio.indexOf("async function gravarVersao("));
    // 23/10 (velocidade): o preenchimento roda junto com o molde e a logo (emParalelo), com o mesmo resultado.
    expect(gerar).toContain("const [[anexoLogo, moldes], doPreenchimento] = await emParalelo(");
    expect(gerar).toContain("    preenchimentoNaGeracao(t, card, {");
    expect(gerar).toContain("semLinhaDosVagos(replica.prompt, preenchimentoDaReferencia)");
    expect(gerar).toContain("replica.textoExato = comTextoDosElementos(replica.textoExato, preenchimentoDaReferencia);");
    expect(gerar).toContain('replicar ? "" : blocoDoPreenchimentoAqui,');
    expect(gerar).toContain("...(preenchimentoDaReferencia ? { preenchimento_da_referencia: preenchimentoDaReferencia } : {}),");
    expect(gerar).not.toContain("regrasDeRender(t, card, legendas");
    expect(estudio).toContain("const dosElementos = conferirElementos(preenchimentoDaVersao, verificacao.texto_lido, card.texto_exato);");
    expect(estudio).toContain("const inv = await inventarioDaArteRapida(clientId, trabalhoId, gravada, fotosDoAcervo, ch.userId);");
  });
});
