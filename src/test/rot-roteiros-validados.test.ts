import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocoDaBaseParaORoteirista,
  candidatosPorObjetivo,
  DNA_DOS_VALIDADOS,
  escolherPelaRegra,
  ESQUEMA_DA_FICHA,
  fichaParaPrompt,
  indiceDaBaseParaOAgente,
  lerBaseDoPara,
  lerEscolhaDoJev,
  MODELOS_VALIDADOS,
  modeloValidadoPorId,
  nichoRegulado,
  normalizarFichaPropria,
  objetivoDoTexto,
  OBJETIVOS_DA_BASE,
  perguntaDaEscolha,
  SISTEMA_DA_EXTRACAO,
} from "../../supabase/functions/mesa-roteiros/modulos/roteiros-validados";
import { paraDoGerar, rotuloDoGerar, normalizarAcoesDosRoteiros } from "../../supabase/functions/mesa-roteiros/acoes-dos-roteiros";
import { hashDoRoteiro, normalizarRoteiro } from "../../supabase/functions/_shared/roteiro-modelo";

/**
 * Frente ROT (30/09): a biblioteca "Roteiros validados" da Mesa Roteiros.
 * Confere a base extraída do material (23 roteiros + os da casa), a escolha
 * pelo objetivo (Jev Choice e a regra de reserva), o bloco que vai ao
 * roteirista, o pedido do agente ("tipo@objetivo"), os modelos próprios, o
 * campo "base" no roteiro (sem mudar o hash das versões antigas), a ligação
 * no código da função e a migração.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const validados = MODELOS_VALIDADOS.filter((m) => m.origem === "roteiros_magicos");
const daCasa = MODELOS_VALIDADOS.filter((m) => m.origem === "casa");

describe("a base extraída do material", () => {
  it("tem os 23 roteiros do PDF e os 4 da casa, com ids únicos e ficha completa", () => {
    expect(validados).toHaveLength(23);
    expect(daCasa.map((m) => m.id)).toEqual(["casa-direto-ao-ponto", "casa-advogado-duvida-juridica", "casa-produto-na-mao", "casa-bastidor-da-marca"]);
    const ids = MODELOS_VALIDADOS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODELOS_VALIDADOS) {
      expect(m.nome.length, m.id).toBeGreaterThan(5);
      expect(OBJETIVOS_DA_BASE).toContain(m.objetivo);
      expect(m.tambem).not.toContain(m.objetivo);
      expect(m.quando_usar.length, m.id).toBeGreaterThan(20);
      expect(m.blocos.length, m.id).toBeGreaterThanOrEqual(5);
      for (const b of m.blocos) expect(b.faz.length, `${m.id} ${b.funcao}`).toBeGreaterThan(10);
      expect(m.gatilhos.length, m.id).toBeGreaterThanOrEqual(3);
      expect(m.exemplo.length, m.id).toBeGreaterThan(30);
      expect(m.nichos.length, m.id).toBe(3);
      expect(m.duracao_s[0]).toBeLessThan(m.duracao_s[1]);
      if (m.origem === "roteiros_magicos") expect(m.referencia, m.id).toBeTruthy();
    }
  });

  it("todo objetivo tem modelos, e Autoridade, Produto e Presença de marca (o foco do dono) têm vários", () => {
    for (const o of OBJETIVOS_DA_BASE) expect(candidatosPorObjetivo(o).length, o).toBeGreaterThanOrEqual(3);
    expect(MODELOS_VALIDADOS.filter((m) => m.objetivo === "autoridade").length).toBeGreaterThanOrEqual(8);
    expect(MODELOS_VALIDADOS.filter((m) => m.objetivo === "produto").length).toBeGreaterThanOrEqual(3);
    expect(MODELOS_VALIDADOS.filter((m) => m.objetivo === "presenca_de_marca").length).toBeGreaterThanOrEqual(4);
  });

  it("guarda estrutura e técnica, sem dado do comprador do PDF, sem travessão e sem copiar o texto", () => {
    const fonte = ler("supabase/functions/mesa-roteiros/modulos/roteiros-validados.ts");
    expect(fonte).not.toMatch(/070\.978|Bibi|licenciado para/);
    expect(fonte).not.toMatch(new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]"));
    // Frases marcantes do material não entram (o exemplo é paráfrase num negócio comum).
    for (const frase of ["gemido mais constrangedor", "foguete dar ré", "lavava pratos no Outback", "cozinha da sua mãe a maior agência"]) expect(fonte).not.toContain(frase);
    expect(DNA_DOS_VALIDADOS).toContain("60 a 90 segundos");
  });

  it("mora em mesa-roteiros/modulos, nunca em _shared (guarda de 4 MB do App MCP)", () => {
    expect(existsSync(resolve(process.cwd(), "supabase/functions/_shared/roteiros-validados.ts"))).toBe(false);
    expect(ler("supabase/functions/mesa-roteiros/index.ts")).toContain('from "./modulos/roteiros-validados.ts"');
  });
});

describe("escolha do modelo pelo objetivo", () => {
  it("candidatos: primeiro os que têm o objetivo como principal, depois os que também atendem; próprios primeiro", () => {
    const c = candidatosPorObjetivo("produto");
    const i = c.findIndex((m) => m.objetivo !== "produto");
    expect(i).toBeGreaterThan(0);
    expect(c.slice(i).every((m) => m.objetivo !== "produto" && m.tambem.indexOf("produto") >= 0)).toBe(true);
    const proprio = normalizarFichaPropria({ nome: "Meu produto", objetivo: "produto", blocos: [{ funcao: "Gancho", faz: "x" }, { funcao: "CTA", faz: "y" }] }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!;
    expect(candidatosPorObjetivo("produto", [proprio])[0].id).toBe(proprio.id);
  });

  it("objetivo dito do jeito da equipe vira o valor da base", () => {
    expect(objetivoDoTexto("agora eu preciso de autoridade")).toBe("autoridade");
    expect(objetivoDoTexto("Presença de marca")).toBe("presenca_de_marca");
    expect(objetivoDoTexto("vender o curso")).toBe("venda");
    expect(objetivoDoTexto("produto")).toBe("produto");
    expect(objetivoDoTexto("")).toBeNull();
  });

  it("regra de reserva: advogado com autoridade cai no modelo de advogado; nicho regulado nunca usa o polêmico", () => {
    expect(nichoRegulado("Thainá Lima Rosa Advogada, direito previdenciário")).toBe(true);
    const m = escolherPelaRegra(candidatosPorObjetivo("autoridade"), { objetivo: "autoridade", texto: "Escritório de advocacia previdenciária, OAB" });
    expect(m && m.id).toBe("casa-advogado-duvida-juridica");
    const e = escolherPelaRegra(candidatosPorObjetivo("engajamento"), { objetivo: "engajamento", texto: "clínica odontológica" });
    expect(e && e.id).not.toBe("rv-polemico-assumido");
  });

  it("pergunta ao Jev: Choice com uma opção por candidato (ids da base), o contexto da marca no estado", () => {
    const candidatos = candidatosPorObjetivo("autoridade");
    const q = perguntaDaEscolha(candidatos, { objetivo: "autoridade", tipo: "Fala para câmera", tema: "Aposentadoria", pedido: "", peca: "", duracao_s: 60, marca: { nome: "X", negocio: "advocacia", publico: null, oferta: null, tom: null } });
    expect(q.questions.modelo.type).toBe("choice");
    expect(Object.keys(q.questions.modelo.criteria)).toEqual(candidatos.map((m) => m.id));
    expect(Object.keys(q.questions.modelo.criteria).length).toBeLessThanOrEqual(255);
    expect(q.state.objetivo_pedido).toBe("Autoridade");
    expect(q.state.marca.negocio).toBe("advocacia");
  });

  it("resposta do Jev vira a escolha com duas alternativas; escolha fora da lista é recusada", () => {
    const c = candidatosPorObjetivo("autoridade");
    const e = lerEscolhaDoJev({ choice: c[1].id, confidence: 0.7, probabilities: { [c[1].id]: 0.6, [c[0].id]: 0.2, [c[2].id]: 0.15, outro: 0.05 } }, c)!;
    expect(e.modelo.id).toBe(c[1].id);
    expect(e.como).toBe("jev");
    expect(e.alternativas.map((a) => a.id)).toEqual([c[0].id, c[2].id]);
    expect(lerEscolhaDoJev({ choice: "nao-existe" }, c)).toBeNull();
    expect(lerEscolhaDoJev(null, c)).toBeNull();
  });
});

describe("o que vai ao roteirista e ao agente", () => {
  it("bloco da base: DNA só nos validados, ficha com blocos e a regra de adaptar sem copiar nem inventar", () => {
    const v = modeloValidadoPorId("rv-queda-e-reconstrucao")!;
    const bloco = blocoDaBaseParaORoteirista({ modelo: v, como: "jev", confianca: 0.6, alternativas: [] });
    expect(bloco).toContain("BASE OBRIGATÓRIA");
    expect(bloco).toContain("DNA DOS ROTEIROS VALIDADOS");
    expect(bloco).toContain("1. Gancho:");
    expect(bloco).toContain("NÃO copie");
    expect(bloco).toContain("vira pendência");
    expect(bloco).toContain(`modelo da base: ${v.nome}`);
    const casa = blocoDaBaseParaORoteirista({ modelo: modeloValidadoPorId("casa-advogado-duvida-juridica")!, como: "equipe", confianca: null, alternativas: [] });
    expect(casa).not.toContain("DNA DOS ROTEIROS VALIDADOS");
    expect(casa).toContain("Provimento 205/2021");
    expect(fichaParaPrompt(v)).toContain("Adaptação por nicho");
  });

  it("índice do agente lista todos os modelos e ensina o para tipo@objetivo", () => {
    const i = indiceDaBaseParaOAgente();
    for (const m of MODELOS_VALIDADOS) expect(i).toContain(m.id);
    expect(i).toContain("fala_camera@autoridade");
  });

  it("gerar_roteiro do agente: tipo sozinho continua igual; tipo@objetivo e tipo@modelo passam; base estranha é ignorada", () => {
    expect(paraDoGerar("tutorial")).toBe("tutorial");
    expect(paraDoGerar("fala_camera@autoridade")).toBe("fala_camera@autoridade");
    expect(paraDoGerar("fala_camera@presença de marca")).toBe("fala_camera@presenca_de_marca");
    expect(paraDoGerar("ugc@rv-observacao-que-virou-marca")).toBe("ugc@rv-observacao-que-virou-marca");
    expect(paraDoGerar("fala_camera@rv-nao-existe")).toBe("fala_camera");
    expect(paraDoGerar("fala_camera@qualquer coisa")).toBe("fala_camera");
    expect(rotuloDoGerar("fala_camera@autoridade")).toBe("Fala para câmera · base: Autoridade");
    expect(rotuloDoGerar("fala_camera@casa-produto-na-mao")).toContain("Produto na mão");
    expect(lerBaseDoPara("cinema@produto")).toEqual({ tipo: "cinema", objetivo: "produto", modeloId: null });
    const acao = normalizarAcoesDosRoteiros(
      { resumo: "Gerar", itens: [{ operacao: "gerar_roteiro", ref: "p1", para: "fala_camera@autoridade" }] },
      [],
      [{ id: "22222222-2222-4222-8222-222222222222", titulo: "Reels", formato: "reel", data: "2026-10-02", roteiro_status: null }],
      "11111111-1111-1111-1111-111111111111",
      0.05,
    );
    expect(acao && acao.itens[0].para).toBe("fala_camera@autoridade");
  });
});

describe("modelos próprios e o roteiro", () => {
  it("ficha própria: precisa de nome e 2 blocos; objetivo em palavras vira o valor; textos cortados", () => {
    expect(normalizarFichaPropria({ nome: "x", blocos: [{ funcao: "a" }] })).toBeNull();
    const f = normalizarFichaPropria({ nome: "Advogado direto", objetivo: "autoridade", tambem: ["conexão", "autoridade"], blocos: ["Pergunta", { funcao: "Resposta", faz: "curta" }], duracao_s: [20, 500] }, "id-1")!;
    expect(f.origem).toBe("proprio");
    expect(f.tambem).toEqual(["conexao"]);
    expect(f.duracao_s).toEqual([20, 300]);
    expect(f.id).toBe("id-1");
  });

  it("extração por IA: esquema fechado e regra de não copiar nem trazer dado pessoal", () => {
    expect(ESQUEMA_DA_FICHA.schema.additionalProperties).toBe(false);
    expect(ESQUEMA_DA_FICHA.schema.required).toContain("blocos");
    expect(SISTEMA_DA_EXTRACAO).toContain("Não copie");
    expect(SISTEMA_DA_EXTRACAO).toContain("CPF");
  });

  it("o roteiro guarda a base, e a versão antiga (sem base) mantém o mesmo hash", () => {
    const antigo = normalizarRoteiro({ titulo: "T", blocos: [{ funcao: "Abertura", fala: "Oi", segundos: 2, visual: "v" }] });
    expect("base" in antigo).toBe(false);
    const hashAntes = hashDoRoteiro(antigo);
    expect(hashDoRoteiro(normalizarRoteiro(antigo))).toBe(hashAntes);
    const com = normalizarRoteiro({ ...antigo, base: { id: "rv-tudo-em-jogo", nome: "Tudo em jogo", objetivo: "autoridade", origem: "roteiros_magicos", como: "jev", confianca: 0.71234, alternativas: [{ id: "a", nome: "A" }] } });
    expect(com.base).toEqual({ id: "rv-tudo-em-jogo", nome: "Tudo em jogo", objetivo: "autoridade", origem: "roteiros_magicos", como: "jev", confianca: 0.712, alternativas: [{ id: "a", nome: "A" }] });
    expect(hashDoRoteiro(com)).not.toBe(hashAntes);
    expect(normalizarRoteiro({ ...antigo, base: { id: "", nome: "" } }).base).toBeUndefined();
  });
});

describe("ligação no código da função e migração", () => {
  const fonte = ler("supabase/functions/mesa-roteiros/index.ts");

  it("o roteirista sempre recebe a base escolhida (equipe, Jev ou regra) e o contexto completo da marca", () => {
    expect(fonte).toContain("escolha ? `\\n\\n${blocoDaBaseParaORoteirista(escolha)}` : \"\"");
    expect(fonte).toContain("const res = await jevPerguntar(pergunta);");
    expect(fonte).toContain("lerEscolhaDoJev(res.answers.modelo, candidatos) || pelaRegra()");
    expect(fonte).toContain('registrarFalha("mesa-roteiros: Jev da base fora do ar, escolha pela regra"');
    expect(fonte).toContain("if (base) roteiro.base = base;");
    expect(fonte).toContain('contextoCompletoParaPrompt(servico(), clientId, marca, { area: "video"');
    expect(fonte).toContain("contexto_completo_da_marca: completo.bloco || null");
    expect(fonte).toContain("indiceDaBaseParaOAgente(proprios)");
    for (const a of ["biblioteca_salvar: bibliotecaSalvar", "biblioteca_arquivar: bibliotecaArquivar", "biblioteca_extrair: bibliotecaExtrair"]) expect(fonte).toContain(a);
  });

  it("migração da biblioteca: na faixa da frente, RLS por cliente, só service_role escreve, apagar é arquivar", () => {
    const sql = ler("supabase/migrations/20260930313000_roteiro_biblioteca.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.roteiro_biblioteca");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.roteiro_biblioteca FROM authenticated");
    expect(sql).toContain("arquivado_em timestamptz");
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE/i);
  });
});
