import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aplicarNaDirecao,
  blocoDoEstiloPedido,
  ESQUEMA_CONVERSA,
  INSTRUCOES_CONVERSA,
  limparTexto,
  MAX_MUDANCAS,
  normalizarMudancas,
  pedeCaixaAtrasDoTexto,
  pedeEscurecer,
  pedidoMexeNoTexto,
  regraProibeCaixa,
  SEM_FOTO,
  type ContextoDasMudancas,
  type DirecaoParaMudar,
  type MudancaProposta,
} from "../../supabase/functions/estudio-arte/conversa-do-diretor";
import {
  corpoDaConversaDoDiretor,
  corpoDeAplicarMudancas,
  lerAnexosDaMensagem,
  lerMudanca,
  ordensParaRefazer,
  partesDaConversaDoDiretor,
  refazFundoContinuo,
  rotuloDeRefazer,
  TAMANHO_DA_CONVERSA,
  type MudancaDoDiretor,
} from "@/components/mesa/diretorDoEstudioApi";
import { TAMANHOS, type ModeloIa } from "@/lib/mesa/api";

// Pedido do dono (24/09): "no estúdio ali onde estou produzindo as artes ter
// um agente que eu possa conversar se caso eu quiser mudar o estilo ou
// cenários etc., e ele inteligente para me ajudar com base no conteúdo".

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const moduloConversa = ler("supabase/functions/estudio-arte/conversa-do-diretor.ts");
const abaEstudio = ler("src/components/mesa/AbaEstudio.tsx");
const arteDoCriativo = ler("src/components/mesa-ads/ArteDoCriativo.tsx");
const componente = ler("src/components/mesa/DiretorDoEstudio.tsx");
const apiFront = ler("src/components/mesa/diretorDoEstudioApi.ts");

function corpoDe(nome: string): string {
  const ini = estudio.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = estudio.slice(ini + 1);
  const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}|\nconst [A-Z_]+ = /);
  return fim < 0 ? resto : resto.slice(0, fim + 10);
}

const FOTO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ctx = (extra: Partial<ContextoDasMudancas> = {}): ContextoDasMudancas => ({
  ordens: [1, 2, 3],
  paleta: ["#880516", "#FFFFFF", "#1A1A1A"],
  acervo: new Set([FOTO]),
  permitirTexto: false,
  semCaixa: new Set<number>(),
  continuo: false,
  ...extra,
});

const vazios = {
  conceito: "", fio_visual: "", estilo: "", imagem: "", ponto_focal: "", fundo: "", tratamento: "", zona_texto: "", alinhamento: "",
  cor_fundo: "", cor_texto: "", cor_destaque: "", evitar: "", foto_acervo: "", texto_exato: "",
};
const bruta = (alvo: "conjunto" | "lamina", ordem: number, campos: Partial<typeof vazios>, titulo = "Mudança") => ({
  alvo, ordem, titulo, motivo: "Serve ao conteúdo.", campos: { ...vazios, ...campos },
});

const direcao = (extra: Partial<DirecaoParaMudar> = {}): DirecaoParaMudar => ({
  conceito: "Rotina real de quem cuida da casa.",
  fio_visual: "Mulher de 35 anos, cozinha clara, luz da manhã.",
  carrossel_infinito: false,
  cards: [
    {
      ordem: 1, funcao: "capa", texto_exato: "Sua cozinha\nem 10 minutos", composicao: "", ilustracao: "cozinha clara", prompt_imagem: "",
      blocos: [{ papel: "headline", texto: "Sua cozinha\nem 10 minutos" }],
      layout: { zona_texto: "base-esquerda", alinhamento: "esquerda", imagem: "cozinha clara com bancada", ponto_focal: "bancada", fundo: "foto", tratamento: "editorial" },
    },
    { ordem: 2, funcao: "conteudo", texto_exato: "Passo 1: limpe a pia", composicao: "antiga", ilustracao: "pia", prompt_imagem: "prompt antigo" },
    {
      ordem: 3, funcao: "cta", texto_exato: "Chame no WhatsApp", composicao: "", ilustracao: "", prompt_imagem: "",
      layout: { zona_texto: "centro", alinhamento: "centro", imagem: "fundo sólido", ponto_focal: "CTA", fundo: "cor da marca", tratamento: "limpo" },
      imagens_ids: [FOTO],
      fotos_livres: [{ caminho: "c/estudio/fotos/a.png", papel: "fundo" }, { caminho: "c/estudio/fotos/b.png", papel: "elemento" }],
    },
  ],
  ...extra,
});

// ------------------------------------------------------------------ servidor: regras da casa

describe("conversa com o diretor: as mudanças passam pelas regras da casa", () => {
  it("lâmina inexistente sai com aviso; lâmina válida fica com id estável e refaz só ela", () => {
    const r = normalizarMudancas(
      [bruta("lamina", 9, { imagem: "praia" }), bruta("lamina", 2, { imagem: "cozinha ao entardecer, luz dourada" }, "Cenário ao entardecer")],
      ctx(),
    );
    expect(r.mudancas).toHaveLength(1);
    expect(r.mudancas[0]).toMatchObject({ id: "m1", alvo: "lamina", ordem: 2, titulo: "Cenário ao entardecer", regerar: [2] });
    expect(r.mudancas[0].campos).toEqual({ imagem: "cozinha ao entardecer, luz dourada" });
    expect(r.avisos.join(" ")).toContain("não existe");
  });

  it("mudança do conjunto refaz todas as lâminas e aceita só conceito, fio visual e estilo", () => {
    const r = normalizarMudancas([bruta("conjunto", 0, { estilo: "fotografia documental, grão leve", imagem: "ignorado" })], ctx());
    expect(r.mudancas[0]).toMatchObject({ alvo: "conjunto", ordem: null, regerar: [1, 2, 3] });
    expect(r.mudancas[0].campos).toEqual({ estilo: "fotografia documental, grão leve" });
  });

  it("nunca escurecer foto ou capa: o campo sai com aviso; negação ('sem escurecer') passa", () => {
    expect(pedeEscurecer("escurecer a foto para o texto aparecer")).toBe(true);
    expect(pedeEscurecer("aplique um véu escuro sobre a capa")).toBe(true);
    expect(pedeEscurecer("degradê preto na base")).toBe(true);
    expect(pedeEscurecer("luz natural, sem escurecer a cena")).toBe(false);
    expect(pedeEscurecer("fundo escuro da paleta")).toBe(false);
    const r = normalizarMudancas([bruta("lamina", 1, { tratamento: "escureça a foto para destacar", ponto_focal: "rosto" })], ctx());
    expect(r.mudancas[0].campos).toEqual({ ponto_focal: "rosto" });
    expect(r.avisos.join(" ")).toContain("não escurece foto nem capa");
    const so = normalizarMudancas([bruta("lamina", 1, { tratamento: "overlay escuro" })], ctx());
    expect(so.mudancas).toHaveLength(0);
  });

  it("sem caixa atrás do texto quando a lâmina usa foto real, contínuo ou a regra da marca pede", () => {
    expect(pedeCaixaAtrasDoTexto("uma faixa vinho atrás do texto")).toBe(true);
    expect(pedeCaixaAtrasDoTexto("texto dentro de uma caixa branca")).toBe(true);
    expect(pedeCaixaAtrasDoTexto("texto direto na foto, sem caixa atrás do texto")).toBe(false);
    expect(regraProibeCaixa("Nunca usar caixa; sem faixa atrás do título")).toBe(true);
    const pedido = bruta("lamina", 3, { fundo: "painel branco atrás do texto" });
    expect(normalizarMudancas([pedido], ctx({ semCaixa: new Set([3]) })).mudancas).toHaveLength(0);
    expect(normalizarMudancas([pedido], ctx()).mudancas[0].campos.fundo).toBe("painel branco atrás do texto");
  });

  it("cor só da paleta da marca (hex), foto só do acervo do cliente", () => {
    const r = normalizarMudancas(
      [bruta("lamina", 1, { cor_destaque: "#00ff00", cor_texto: "#ffffff", foto_acervo: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })],
      ctx(),
    );
    expect(r.mudancas[0].campos).toEqual({ cor_texto: "#FFFFFF" });
    expect(r.avisos.join(" ")).toContain("#00FF00");
    expect(r.avisos.join(" ")).toContain("acervo");
    expect(normalizarMudancas([bruta("lamina", 1, { foto_acervo: FOTO })], ctx()).mudancas[0].campos.foto_acervo).toBe(FOTO);
    expect(normalizarMudancas([bruta("lamina", 1, { foto_acervo: SEM_FOTO })], ctx()).mudancas[0].campos.foto_acervo).toBe(SEM_FOTO);
  });

  it("texto exato só muda com pedido explícito", () => {
    const pedido = bruta("lamina", 1, { texto_exato: "Cozinha limpa\nem 10 minutos" });
    const sem = normalizarMudancas([pedido], ctx());
    expect(sem.mudancas).toHaveLength(0);
    expect(sem.avisos.join(" ")).toContain("só muda quando você pede");
    expect(normalizarMudancas([pedido], ctx({ permitirTexto: true })).mudancas[0].campos.texto_exato).toBe("Cozinha limpa\nem 10 minutos");
    expect(pedidoMexeNoTexto("troque o título da capa")).toBe(true);
    expect(pedidoMexeNoTexto('escreva "Cozinha limpa" na capa')).toBe(true);
    expect(pedidoMexeNoTexto("quero um cenário ao ar livre")).toBe(false);
    expect(pedidoMexeNoTexto("mude o estilo para aquarela")).toBe(false);
  });

  it("carrossel contínuo: mudança de cena numa lâmina refaz todas", () => {
    const r = normalizarMudancas([bruta("lamina", 2, { imagem: "sala ampla" })], ctx({ continuo: true }));
    expect(r.mudancas[0].regerar).toEqual([1, 2, 3]);
    expect(r.avisos.join(" ")).toContain("contínuo");
  });

  it("sem travessão, no máximo 6 mudanças, e o id que veio da tela se mantém", () => {
    expect(limparTexto("luz quente — clima de domingo")).toBe("luz quente, clima de domingo");
    const muitas = Array.from({ length: 10 }, (_, i) => bruta("lamina", 1, { ponto_focal: `foco ${i}` }));
    expect(normalizarMudancas(muitas, ctx()).mudancas).toHaveLength(MAX_MUDANCAS);
    const daTela = normalizarMudancas([{ ...bruta("lamina", 2, { fundo: "parede verde" }), id: "m4" }], ctx());
    expect(daTela.mudancas[0].id).toBe("m4");
  });

  it("o esquema pede todos os campos (saída estrita) e as instruções trazem as regras da casa", () => {
    const campos = (ESQUEMA_CONVERSA.schema.properties.mudancas.items.properties.campos as { required: string[] }).required;
    expect(campos).toEqual(expect.arrayContaining(["estilo", "imagem", "tratamento", "cor_destaque", "foto_acervo", "texto_exato"]));
    expect(ESQUEMA_CONVERSA.schema.required).toEqual(["resposta", "mudancas", "memoria"]);
    expect(INSTRUCOES_CONVERSA).toContain("Nunca escureça a foto nem a capa");
    expect(INSTRUCOES_CONVERSA).toContain("Sem caixa, faixa, painel");
    expect(INSTRUCOES_CONVERSA).toContain("texto_pode_mudar");
    expect(INSTRUCOES_CONVERSA).toContain("cores só da paleta");
  });
});

describe("aplicar na direção", () => {
  const mud = (m: Partial<MudancaProposta>): MudancaProposta => ({ id: "m1", alvo: "lamina", ordem: 1, titulo: "t", motivo: "", campos: {}, regerar: [1], ...m });

  it("muda o layout da lâmina, recompõe a composição e não toca no texto", () => {
    const r = aplicarNaDirecao(direcao(), [mud({ campos: { imagem: "quintal com plantas, fim de tarde", cor_destaque: "#880516", zona_texto: "topo-esquerda" } })]);
    const c = r.direcao.cards[0];
    expect(c.layout).toMatchObject({ imagem: "quintal com plantas, fim de tarde", zona_texto: "topo-esquerda", cor_destaque: "#880516", ponto_focal: "bancada" });
    expect(c.ilustracao).toBe("quintal com plantas, fim de tarde");
    expect(c.composicao).toContain("topo esquerda");
    expect(c.texto_exato).toBe("Sua cozinha\nem 10 minutos");
    expect(r.afetadas).toEqual([1]);
    expect(r.textoMudou).toEqual([]);
  });

  it("texto novo só com texto_exato, e os blocos acompanham", () => {
    const r = aplicarNaDirecao(direcao(), [mud({ campos: { texto_exato: "Cozinha limpa\nem 10 minutos" } })]);
    expect(r.direcao.cards[0].texto_exato).toBe("Cozinha limpa\nem 10 minutos");
    expect((r.direcao.cards[0].blocos || []).map((b) => b.texto).join("\n")).toContain("Cozinha limpa");
    expect(r.textoMudou).toEqual([1]);
  });

  it("direção antiga sem layout ganha o layout padrão antes de mudar", () => {
    const r = aplicarNaDirecao(direcao(), [mud({ ordem: 2, regerar: [2], campos: { fundo: "parede verde-oliva" } })]);
    const c = r.direcao.cards[1];
    expect(c.layout && c.layout.fundo).toBe("parede verde-oliva");
    expect(c.layout && c.layout.imagem).toBe("pia");
    expect(c.texto_exato).toBe("Passo 1: limpe a pia");
  });

  it("tirar a foto real limpa a foto do acervo e a foto de fundo trazida, mas mantém os elementos", () => {
    const r = aplicarNaDirecao(direcao(), [mud({ ordem: 3, regerar: [3], campos: { foto_acervo: SEM_FOTO, imagem: "estúdio claro" } })]);
    const c = r.direcao.cards[2];
    expect(c.imagens_ids).toEqual([]);
    expect(c.fotos_livres).toEqual([{ caminho: "c/estudio/fotos/b.png", papel: "elemento" }]);
  });

  it("conjunto grava conceito, fio visual e estilo pedido e afeta todas", () => {
    const r = aplicarNaDirecao(direcao(), [mud({ alvo: "conjunto", ordem: null, regerar: [1, 2, 3], campos: { estilo: "aquarela suave", fio_visual: "Homem de 40 anos na varanda." } })]);
    expect(r.direcao.estilo_pedido).toBe("aquarela suave");
    expect(r.direcao.fio_visual).toBe("Homem de 40 anos na varanda.");
    expect(r.direcao.conceito).toBe("Rotina real de quem cuida da casa.");
    expect(r.afetadas).toEqual([1, 2, 3]);
  });

  it("contínuo: mudar a cena apaga o fundo panorâmico e refaz todas", () => {
    const d = direcao({ carrossel_infinito: true, panorama: { fundos: { "1": "a.png", "2": "b.png", "3": "c.png" } } });
    const r = aplicarNaDirecao(d, [mud({ campos: { tratamento: "luz de fim de tarde" } })]);
    // Apagado com a geração seguinte (25/09): um trecho atrasado não ressuscita o fundo velho.
    expect(r.direcao.panorama).toEqual({ fundos: {}, geracao: 1, em_andamento: null });
    expect(r.fundoApagado).toBe(true);
    expect(r.afetadas).toEqual([1, 2, 3]);
    // Desde 25/09 a zona do texto também é cena no contínuo: o panorama deixa calma a zona de cada lâmina.
    const soPosicao = aplicarNaDirecao(d, [mud({ campos: { zona_texto: "centro" } })]);
    expect(soPosicao.direcao.panorama).toEqual({ fundos: {}, geracao: 1, em_andamento: null });
    expect(soPosicao.afetadas).toEqual([1, 2, 3]);
    // Só o alinhamento não mexe na cena: o fundo fica.
    const soAlinhamento = aplicarNaDirecao(d, [mud({ campos: { alinhamento: "centro" } })]);
    expect(soAlinhamento.direcao.panorama).toEqual(d.panorama);
    expect(soAlinhamento.afetadas).toEqual([1]);
  });

  it("o estilo pedido vira bloco do prompt, sem escurecer e dentro da paleta", () => {
    expect(blocoDoEstiloPedido(null)).toBe("");
    const b = blocoDoEstiloPedido("fotografia documental");
    expect(b).toContain("ESTILO PEDIDO PELA EQUIPE");
    expect(b).toContain("não escureça a foto nem a capa");
  });
});

// ------------------------------------------------------------------ servidor: contrato da função

describe("estudio-arte: ações conversar e aplicar_mudancas", () => {
  it("estão no roteador; conversar é longa (resposta com fôlego), aplicar não", () => {
    expect(estudio).toContain("  conversar,\n  aplicar_mudancas: aplicarMudancas,\n  reabrir,\n};");
    const longas = estudio.slice(estudio.indexOf("const ACOES_LONGAS"), estudio.indexOf("\n", estudio.indexOf("const ACOES_LONGAS")));
    expect(longas).toContain('"conversar"');
    expect(longas).not.toContain("aplicar_mudancas");
    expect(estudio).toContain("return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();");
    expect(estudio).toContain("- conversar { trabalho_id, mensagem, ordem? }");
    expect(estudio).toContain("- aplicar_mudancas { trabalho_id, mudancas, regerar?, mensagem_id? }");
  });

  it("conversar: diretor de arte com o conteúdo inteiro, esquema estrito, cobrança no trabalho e conversa por trabalho", () => {
    const c = corpoDe("conversar");
    expect(c).toContain('modeloDoPapel("diretor_arte")');
    expect(c).toContain("esquemaJson: ESQUEMA_CONVERSA");
    expect(c).toContain("referencia: { tipo: REFERENCIA_DA_CONVERSA, id: t.id }");
    expect(c).toContain("CONHECIMENTO_DIRETOR");
    expect(c).toContain("INSTRUCOES_CONVERSA");
    for (const parte of ["texto_exato", "layout", "foto_real", "ultima_conferencia", "referencias_escolhidas", "acervo", "memoria_do_diretor", "marca", "fio_visual"]) {
      expect(c, parte).toContain(parte);
    }
    expect(c).toContain("permitirTexto: textoPodeMudar");
    expect(c).toContain("pedidoMexeNoTexto(mensagem)");
    expect(c).toContain('new ErroEstudio(400, "mensagem_vazia"');
    // Nada muda na direção durante a conversa: só o custo é somado ao trabalho.
    expect(c).toContain("mutarTrabalho(t.id, (x) => ({ custo_usd: arred(num(x.custo_usd) + r.custoUsd) }))");
    expect(c).not.toContain("direcao:");
    expect(estudio).toContain('const REFERENCIA_DA_CONVERSA = "estudio_trabalho";');
    const conversa = corpoDe("conversaDoTrabalho");
    expect(conversa).toContain('.from("agente_conversas")');
    expect(conversa).toContain('agente: "diretor_arte"');
    // conversa_id do trabalho fica vazio: o CardDoEstudio lê os pedidos de ajuste por ele.
    expect(estudio).not.toMatch(/estudio_trabalhos"\)\s*\.update\(\{\s*conversa_id/);
  });

  it("aplicar_mudancas: sem IA, revalida pelas regras, não aplica em trabalho entregue e devolve o que refazer", () => {
    const c = corpoDe("aplicarMudancas");
    expect(c).not.toContain("chamarTexto");
    expect(c).not.toContain("chamarImagem");
    expect(c).toContain("normalizarMudancas(brutas");
    expect(c).toContain("aplicarNaDirecao<Direcao>(x.direcao, mudancas)");
    expect(c).toContain("if (estaEntregue(t)) {");
    expect(c).toContain("throw erroTrabalhoEntregue();");
    expect(c).toContain("custo_usd: 0");
    expect(c).toContain("regerar");
    expect(c).toContain('.from("agente_memoria").insert(');
    expect(c).toContain('origem: "ajuste"');
  });

  it("o estilo pedido entra no prompt de cada lâmina e no fundo contínuo", () => {
    expect(corpoDe("gerarCard")).toContain("blocoDoEstiloPedido(t.direcao.estilo_pedido)");
    expect(corpoDe("garantirFundoContinuo")).toContain("atual.direcao.estilo_pedido");
  });

  it("o módulo da conversa é puro (sem banco nem IA)", () => {
    expect(moduloConversa).not.toMatch(/createClient|chamarTexto|chamarImagem|Deno\.|fetch\(/);
  });
});

// ------------------------------------------------------------------ tela: lógica pura

const mudTela = (m: Partial<MudancaDoDiretor>): MudancaDoDiretor => ({
  id: "m1", alvo: "lamina", ordem: 2, titulo: "Cenário novo", motivo: "", campos: { imagem: "praia" }, regerar: [2], ...m,
});

describe("tela: corpo das chamadas e leitura da conversa", () => {
  it("conversar manda a lâmina em foco só quando há uma", () => {
    expect(corpoDaConversaDoDiretor({ trabalhoId: "t1", mensagem: "  outro cenário  ", ordem: 2 })).toEqual({
      acao: "conversar", trabalho_id: "t1", mensagem: "outro cenário", ordem: 2,
    });
    expect(corpoDaConversaDoDiretor({ trabalhoId: "t1", mensagem: "oi", ordem: null })).toEqual({ acao: "conversar", trabalho_id: "t1", mensagem: "oi" });
  });

  it("aplicar manda as mudanças como vieram, o que refazer e a mensagem", () => {
    const corpo = corpoDeAplicarMudancas({ trabalhoId: "t1", mudancas: [mudTela({}), mudTela({ id: "m2", alvo: "conjunto", ordem: null, campos: { estilo: "aquarela" }, regerar: [1, 2] })], regerar: [1, 2], mensagemId: "msg" });
    expect(corpo).toMatchObject({ acao: "aplicar_mudancas", trabalho_id: "t1", regerar: [1, 2], mensagem_id: "msg" });
    expect((corpo.mudancas as any[])[1]).toEqual({ id: "m2", alvo: "conjunto", ordem: 0, titulo: "Cenário novo", motivo: "", campos: { estilo: "aquarela" } });
    expect(corpoDeAplicarMudancas({ trabalhoId: "t1", mudancas: [mudTela({})] })).not.toHaveProperty("regerar");
  });

  it("lê mudanças e aplicadas dos anexos, sem confiar no formato", () => {
    const anexos = [{ tipo: "mudancas", em_foco: 2, mudancas: [mudTela({}), { id: "m9", campos: {} }, null], avisos: ["x"], aplicadas: ["m1"] }];
    const a = lerAnexosDaMensagem(anexos);
    expect(a.emFoco).toBe(2);
    expect(a.mudancas.map((m) => m.id)).toEqual(["m1"]);
    expect(a.aplicadas).toEqual(["m1"]);
    expect(a.avisos).toEqual(["x"]);
    expect(lerMudanca({ id: "m1", alvo: "lamina", ordem: 3, campos: { fundo: "verde", invalido: "x" } })).toMatchObject({ regerar: [3], campos: { fundo: "verde" } });
    expect(lerAnexosDaMensagem(null)).toEqual({ emFoco: null, mudancas: [], avisos: [], aplicadas: [] });
  });

  it("o que refazer, o fundo contínuo e o rótulo do botão", () => {
    expect(ordensParaRefazer([mudTela({ regerar: [3, 1] }), mudTela({ regerar: [1, 2] })])).toEqual([1, 2, 3]);
    expect(refazFundoContinuo([mudTela({ campos: { zona_texto: "centro" } })], true)).toBe(false);
    expect(refazFundoContinuo([mudTela({ campos: { imagem: "praia" } })], true)).toBe(true);
    expect(refazFundoContinuo([mudTela({ campos: { imagem: "praia" } })], false)).toBe(false);
    expect(rotuloDeRefazer([2])).toBe("Aplicar e refazer a lâmina 2");
    expect(rotuloDeRefazer([1, 2, 3])).toBe("Aplicar e refazer 3 lâminas");
  });

  it("a estimativa usa o diretor de arte e soma a imagem da lâmina em foco", () => {
    const catalogo = [{ id: "d", tipo: "texto", padrao_para: ["diretor_arte"], ativo: true } as unknown as ModeloIa];
    const sem = partesDaConversaDoDiretor(catalogo, false)[0];
    const com = partesDaConversaDoDiretor(catalogo, true)[0];
    expect(sem.modeloId).toBe("d");
    expect(sem.tokensEntrada).toBe(TAMANHO_DA_CONVERSA.entrada);
    expect(com.tokensEntrada).toBe(TAMANHO_DA_CONVERSA.entrada + TAMANHOS.imagemAnexos.entrada);
  });
});

// ------------------------------------------------------------------ tela: integração e compatibilidade

describe("tela: o diretor no Estúdio e na Mesa Ads", () => {
  it("Estúdio: ferramenta Diretor, botão claro e refazer pelo fluxo normal", () => {
    expect(abaEstudio).toContain('producao: ["lamina", "diretor", "fotos", "referencias", "conjunto", "legenda", "entrega"]');
    expect(abaEstudio).toContain("Conversar com o diretor");
    expect(abaEstudio).toContain("<DiretorDoEstudio");
    expect(abaEstudio).toContain("onRefazer={(ordens) => gerarVarias(ordens)}");
    expect(abaEstudio).toContain("partesRefazer={partesDoRefazer}");
  });

  it("Mesa Ads: a arte do criativo ganha o Diretor sem mudar as props públicas", () => {
    expect(arteDoCriativo).toContain('{ valor: "diretor", rotulo: "Diretor", icone: MessageSquare }');
    expect(arteDoCriativo).toContain("<DiretorDoEstudio");
    expect(arteDoCriativo).toContain("onRefazer={(ordens) => gerarVarias(ordens)}");
    expect(arteDoCriativo).toContain("}: {\n  criativo: CriativoAds;\n  trabalho: Trabalho;\n  onAtualizar: () => void;\n");
    // A Mesa Ads v3 só acrescentou `irmaos` opcional; as props obrigatórias não mudam.
    expect(arteDoCriativo).toContain("  irmaos?: IrmaoDoCriativo[];\n}) {");
  });

  it("componente: microfone, custo estimado, Aplicar e Aplicar e refazer", () => {
    expect(componente).toContain("<Ditado ");
    expect(componente).toContain("<BotaoComCusto");
    expect(componente).toContain("partesDaConversaDoDiretor(catalogo, focoTemArte)");
    expect(componente).toContain("Aplicar");
    expect(componente).toContain("rotuloDeRefazer(ordens)");
    expect(componente).toContain("usePedidoAoDiretor(trabalho.id)");
  });

  it("sem travessão e sem recurso fora do Safari 11 / Chrome 64 nos arquivos novos da tela", () => {
    const proibidos: [string, RegExp][] = [
      ["travessão", /[—–]/],
      ["lookbehind", /\(\?<[=!]/],
      ["grupo nomeado", /\(\?<[a-zA-Z]/],
      ["\\p{}", /\\p\{/],
      [".at(", /\.at\(/],
      ["Object.hasOwn", /Object\.hasOwn\b/],
      ["aspect-ratio", /aspect-(square|video|\[)|aspect-ratio/],
      [":has", /:has\(|has-\[/],
      ["min/max/clamp em classe", /-\[(min|max|clamp)\(/],
      ["flatMap", /\.flatMap\(/],
    ];
    for (const [nome, fonte] of [["DiretorDoEstudio.tsx", componente], ["diretorDoEstudioApi.ts", apiFront]] as const) {
      for (const [regra, re] of proibidos) expect(re.test(fonte), `${nome}: ${regra}`).toBe(false);
    }
    expect(/[—–]/.test(arteDoCriativo)).toBe(false);
    expect(/[—–]/.test(INSTRUCOES_CONVERSA)).toBe(false);
  });
});
