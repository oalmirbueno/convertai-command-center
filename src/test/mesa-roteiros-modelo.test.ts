import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avisoDasRespostasDoJev,
  comGanchosNovos,
  duracaoEstimada,
  escolherGancho,
  faixaDeDuracao,
  faltasDoRoteiro,
  hashDoRoteiro,
  MAX_VERSOES,
  modeloDaAgencia,
  modeloDoCliente,
  motivoParaNaoEditar,
  motivoParaNaoMudar,
  mudouDe,
  normalizarComentarios,
  normalizarLinhaDoRoteiro,
  normalizarRoteiro,
  normalizarVersoes,
  novaVersao,
  novoComentario,
  roteiroEmBranco,
  sanitizarTexto,
  statusDepoisDeEditar,
  versaoPorNumero,
} from "../../supabase/functions/_shared/roteiro-modelo";

/**
 * Mesa Roteiros (Frente R2): o roteiro estruturado é a fonte da verdade.
 * Normalização tolerante (o modelo esquece campo, a tela manda parcial),
 * versões imutáveis, status, comentários e a memória (modelo do cliente e
 * modelo da agência sem dado privado).
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const BRUTO = {
  titulo: "Salário-maternidade",
  subtitulo: "Estou desempregada e agora?",
  tipo: "fala_camera",
  ganchos: [
    { texto: "Estou grávida e sem emprego. Tenho direito?", mecanismo: "pergunta concreta", promessa: "responder se há direito", motivo: "dúvida comum" },
    { texto: "Perdeu o emprego grávida? Ainda pode haver proteção.", mecanismo: "contraste", promessa: "", motivo: "" },
    { texto: "A data em que você saiu do emprego muda tudo.", mecanismo: "resultado primeiro", promessa: "", motivo: "" },
    { texto: "Um quarto gancho que sobra", mecanismo: "x" },
  ],
  gancho_escolhido: 0,
  blocos: [
    { funcao: "Abertura", fala: "Estou grávida e sem emprego. Tenho direito?", segundos: 5, visual: "Sentada", texto_na_tela: "Grávida e sem emprego?", broll: "" },
    { funcao: "Resposta", fala: "Não necessariamente. Você pode continuar protegida pelo INSS por um período.", segundos: "9", visual: "Aproximar" },
    { id: "b9", funcao: "Fechamento", fala: "Salve para consultar depois.", visual: "" },
    { funcao: "", fala: "", visual: "" },
  ],
  direcao: { enquadramento: "Peito para cima", ambiente: "Sentada à mesa", orientacoes: ["Olhar na lente", "Olhar na lente", "Gesto leve"] },
  hashtags: ["inss", "#previdencia", "salario maternidade"],
  cta: "Salve para consultar depois.",
  legenda: "Grávida e sem emprego?",
  logline: "não vale fora do cinema",
};

describe("normalização do roteiro", () => {
  it("lê a saída do modelo: 3 ganchos, blocos com id estável, tempo e direção", () => {
    const r = normalizarRoteiro(BRUTO);
    expect(r.ganchos).toHaveLength(3);
    expect(r.blocos.map((b) => b.id)).toEqual(["b1", "b2", "b9"]);
    expect(r.blocos.map((b) => b.ordem)).toEqual([1, 2, 3]);
    expect(r.blocos[1].segundos).toBe(9);
    // Sem tempo: estima pela fala (2,5 palavras por segundo), nunca zero.
    expect(r.blocos[2].segundos).toBeGreaterThanOrEqual(1);
    expect(r.direcao.orientacoes).toEqual(["Olhar na lente", "Gesto leve"]);
    expect(r.hashtags).toEqual(["#inss", "#previdencia", "#salariomaternidade"]);
    expect(r.logline).toBe("");
    expect(r.formato).toBe("9:16");
  });

  it("aceita qualquer lixo sem quebrar e usa o padrão da peça", () => {
    for (const lixo of [null, undefined, 42, "texto", [], { blocos: "nada", ganchos: 3 }]) {
      const r = normalizarRoteiro(lixo, { titulo: "Reels do dia 12", tipo: "tutorial", duracao_s: 45 });
      expect(r.titulo).toBe("Reels do dia 12");
      expect(r.tipo).toBe("tutorial");
      expect(r.duracao_alvo_s).toBe(45);
      expect(r.blocos).toEqual([]);
    }
  });

  it("sem gancho do modelo, a fala de abertura vira o único gancho (não inventa os outros)", () => {
    const r = normalizarRoteiro({ blocos: [{ funcao: "Abertura", fala: "Você sabia disso?" }] });
    expect(r.ganchos.map((g) => g.texto)).toEqual(["Você sabia disso?"]);
    expect(faltasDoRoteiro(r).join(" ")).toContain("o padrão é 3");
  });

  it("escolher outro gancho troca a fala de abertura; o bloco editado à mão fica", () => {
    const r = normalizarRoteiro(BRUTO);
    const b = escolherGancho(r, 2);
    expect(b.gancho_escolhido).toBe(2);
    expect(b.blocos[0].fala).toBe(r.ganchos[2].texto);
    const editado = { ...r, blocos: r.blocos.map((x, i) => (i === 0 ? { ...x, fala: "Fala própria da cliente." } : x)) };
    expect(escolherGancho(editado, 1).blocos[0].fala).toBe("Fala própria da cliente.");
  });

  it("refazer o gancho troca os três e a abertura acompanha", () => {
    const r = normalizarRoteiro(BRUTO);
    const novo = comGanchosNovos(r, [{ texto: "Novo A", mecanismo: "objeção" }, { texto: "Novo B" }, { texto: "Novo C" }], 1);
    expect(novo.ganchos.map((g) => g.texto)).toEqual(["Novo A", "Novo B", "Novo C"]);
    expect(novo.blocos[0].fala).toBe("Novo B");
    expect(novo.blocos.slice(1)).toEqual(r.blocos.slice(1));
    expect(comGanchosNovos(r, [], 0)).toBe(r);
  });

  it("duração em faixa pela fala, sem prometer segundo exato", () => {
    const r = normalizarRoteiro(BRUTO);
    const d = duracaoEstimada(r);
    expect(d.min_s).toBeLessThan(d.max_s);
    expect(d.min_s % 5).toBe(0);
    expect(faixaDeDuracao(r)).toMatch(/^\d+ a \d+s$/);
  });

  it("rascunho em branco segue a estrutura do modo, ou do modelo aprovado", () => {
    const tutorial = roteiroEmBranco("Como fazer", "tutorial");
    expect(tutorial.blocos.map((b) => b.funcao)).toEqual(["Resultado", "O que precisa", "Passo 1", "Passo 2", "Passo 3", "Conferência"]);
    const doModelo = roteiroEmBranco("Outro", "fala_camera", modeloDoCliente(normalizarRoteiro(BRUTO)));
    expect(doModelo.blocos.map((b) => b.funcao)).toEqual(["Abertura", "Resposta", "Fechamento"]);
    expect(doModelo.blocos[0].fala).toContain("grávida");
  });
});

describe("versões", () => {
  const r = normalizarRoteiro(BRUTO);

  it("numera em sequência, guarda hash e não mexe nas anteriores", () => {
    const um = novaVersao([], r, { origem: "ia", custo_usd: 0.02, agora: "2026-09-26T10:00:00Z" });
    expect(um.versao.numero).toBe(1);
    expect(um.versao.hash).toBe(hashDoRoteiro(r));
    const editado = { ...r, cta: "Comente sua dúvida." };
    const dois = novaVersao(um.versoes, editado, { origem: "edicao", agora: "2026-09-26T11:00:00Z" });
    expect(dois.versao.numero).toBe(2);
    expect(dois.versoes[0]).toBe(um.versoes[0]);
    expect(dois.versoes[0].conteudo.cta).toBe("Salve para consultar depois.");
    expect(dois.versao.hash).not.toBe(um.versao.hash);
  });

  it("hash estável: mesmo roteiro, mesmo código; edição sem mudança não cria versão", () => {
    const copia = JSON.parse(JSON.stringify(r));
    expect(hashDoRoteiro(copia)).toBe(hashDoRoteiro(r));
    const v = novaVersao([], r, { origem: "ia" }).versao;
    expect(mudouDe(v, copia)).toBe(false);
    expect(mudouDe(v, { ...r, titulo: "Outro título" })).toBe(true);
    expect(mudouDe(null, r)).toBe(true);
  });

  it("no teto de versões, a aprovada nunca sai", () => {
    let versoes = novaVersao([], r, { origem: "ia" }).versoes;
    for (let i = 0; i < MAX_VERSOES + 5; i++) versoes = novaVersao(versoes, { ...r, cta: `CTA ${i}` }, { origem: "edicao", aprovada: 1 }).versoes;
    expect(versoes.length).toBe(MAX_VERSOES);
    expect(versoes.some((v) => v.numero === 1)).toBe(true);
    expect(versoes[versoes.length - 1].numero).toBe(MAX_VERSOES + 6);
  });

  it("lê versões do banco em qualquer forma e acha pelo número", () => {
    const lidas = normalizarVersoes([{ numero: 2, conteudo: BRUTO }, { numero: 1, conteudo: {} }, { numero: 2, conteudo: {} }, "lixo", { numero: "x" }]);
    expect(lidas.map((v) => v.numero)).toEqual([1, 2]);
    expect(versaoPorNumero(lidas, 1)!.numero).toBe(1);
    expect(versaoPorNumero(lidas, 99)!.numero).toBe(2);
    expect(versaoPorNumero([], 1)).toBeNull();
  });

  it("linha do banco normalizada, com status e versões", () => {
    const linha = normalizarLinhaDoRoteiro({
      id: "r1",
      client_id: "c1",
      status: "aprovado",
      versao_atual: 2,
      versao_aprovada: 2,
      versoes: [{ numero: 1, conteudo: BRUTO }, { numero: 2, conteudo: BRUTO }],
      comentarios: [{ texto: "Trocar a abertura", versao: 1, bloco_id: "b1" }, { texto: "" }],
    });
    expect(linha!.status).toBe("aprovado");
    expect(linha!.versoes).toHaveLength(2);
    expect(linha!.comentarios).toHaveLength(1);
    expect(normalizarLinhaDoRoteiro({ id: "", client_id: "c" })).toBeNull();
    expect(normalizarLinhaDoRoteiro({ id: "a", client_id: "c", status: "inventado" })!.status).toBe("rascunho");
  });
});

describe("status e edição", () => {
  it("rascunho aprova; aprovado grava ou volta; gravado volta para aprovado; arquivado trava", () => {
    expect(motivoParaNaoMudar("rascunho", "aprovado", false)).toBeNull();
    expect(motivoParaNaoMudar("aprovado", "gravado", false)).toBeNull();
    expect(motivoParaNaoMudar("aprovado", "rascunho", false)).toBeNull();
    expect(motivoParaNaoMudar("gravado", "aprovado", false)).toBeNull();
    expect(motivoParaNaoMudar("rascunho", "gravado", false)).toContain("Só roteiro aprovado");
    expect(motivoParaNaoMudar("gravado", "rascunho", false)).toContain("volta primeiro");
    expect(motivoParaNaoMudar("rascunho", "aprovado", true)).toContain("arquivado");
  });

  it("aprovado é imutável: editar cria versão em rascunho; gravado não se edita", () => {
    expect(statusDepoisDeEditar("aprovado")).toBe("rascunho");
    expect(statusDepoisDeEditar("rascunho")).toBe("rascunho");
    expect(motivoParaNaoEditar("gravado", false)).toContain("gravado");
    expect(motivoParaNaoEditar("aprovado", false)).toBeNull();
    expect(motivoParaNaoEditar("rascunho", true)).toContain("arquivado");
  });

  it("comentários: acrescenta com autor e versão, ignora vazio", () => {
    const um = novoComentario([], { texto: "  Mais direto  ", autor_nome: "Ana", versao: 3, bloco_id: "b2", id: "c-1", agora: "2026-09-26T12:00:00Z" });
    expect(um).toEqual([{ id: "c-1", autor_id: null, autor_nome: "Ana", texto: "Mais direto", criado_em: "2026-09-26T12:00:00Z", versao: 3, bloco_id: "b2", resolvido: false }]);
    expect(novoComentario(um, { texto: "   ", versao: 3 })).toBe(um);
    expect(normalizarComentarios([{ texto: "ok", resolvido: true }])[0].resolvido).toBe(true);
  });
});

describe("memória: modelo do cliente e da agência", () => {
  const r = normalizarRoteiro({
    ...BRUTO,
    blocos: [
      { funcao: "Abertura", fala: "Eu sou Thainá Rosa, advogada. Me chama no @advogada_thaina.rosa.", visual: "Thainá sentada no escritório Rosa Advocacia" },
      { funcao: "Oferta", fala: "Consulta por R$ 250 com 30% de desconto. Ligue (41) 99999-8888 ou acesse thainarosa.com.br", visual: "Logo" },
    ],
    ganchos: [{ texto: "Thainá explica", mecanismo: "pergunta concreta" }],
    legenda: "Fale com a Thainá",
  });

  it("modelo do cliente guarda estrutura e falas como exemplo", () => {
    const m = modeloDoCliente(r);
    expect(m.blocos[0].exemplo).toContain("Thainá");
    expect(m.slots).toContain("cta");
  });

  it("modelo da agência sai sem fala, legenda, CTA, nome, perfil, site, telefone, valor ou número", () => {
    const m = modeloDaAgencia(r, ["Thainá Rosa", "Thainá", "Rosa Advocacia"]);
    const texto = JSON.stringify(m);
    expect(m.blocos.every((b) => b.exemplo === "")).toBe(true);
    expect(m.cta_tipo).toBe("");
    for (const privado of ["Thainá", "@advogada", "thainarosa.com.br", "99999", "R$ 250", "30%", "Rosa Advocacia"]) expect(texto).not.toContain(privado);
    expect(m.blocos.map((b) => b.funcao)).toEqual(["Abertura", "Oferta"]);
    expect(m.mecanismos_de_gancho).toEqual(["pergunta concreta"]);
  });

  it("sanitizar troca por marcadores, sem lookbehind", () => {
    expect(sanitizarTexto("Siga @perfil.x e veja https://a.com/b", [])).toBe("Siga [perfil] e veja [site]");
    expect(sanitizarTexto("OAB/PR 109.244 e CPF 123.456.789-00", [])).toBe("[registro] e [registro]");
    const fonte = ler("supabase/functions/_shared/roteiro-modelo.ts");
    expect(fonte).not.toMatch(/\(\?<[=!]/);
    expect(fonte).not.toMatch(/\\p\{/);
    expect(fonte).not.toMatch(/\(\?<[a-z]/i);
    expect(fonte).not.toMatch(/\.at\(|Object\.hasOwn|\.flat\(|flatMap\(|Object\.fromEntries/);
    expect(fonte).not.toMatch(/[—]/);
  });
});

describe("aviso do Jev", () => {
  it("converte 0 a 4 em nota de 1 a 5 e só avisa o que merece atenção", () => {
    const bom = avisoDasRespostasDoJev(4, 3, 0.9);
    expect(bom).toEqual({ retencao: 5, clareza: 4, promessa_cumprida: 0.9, frases: [] });
    const fraco = avisoDasRespostasDoJev(1, 0.5, 0.2);
    expect(fraco.frases).toHaveLength(3);
    expect(fraco.frases.join(" ")).toContain("Promessa");
    expect(avisoDasRespostasDoJev(null, null, null)).toEqual({ retencao: null, clareza: null, promessa_cumprida: null, frases: [] });
  });
});
