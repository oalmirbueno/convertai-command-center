import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  autorizacaoDaCopia,
  avisosArquivados,
  avisosRestaurados,
  caminhoDoPedido,
  colunaQueFalta,
  formatoPelaMedida,
  fotosEscolhidasParaGerar,
  LADO_MINIMO_FOTO_REAL,
  nomeDaCopia,
  novaIdentidadeReal,
  pedidoDaDescricao,
  validarFotosDeOrigem,
  vistaArquivada,
  vistaDesatualizada,
  type EntradaReal,
} from "../../supabase/functions/mesa-foto/clones-edicao";
import { PRESETS_DE_VARIACAO } from "../../supabase/functions/mesa-foto/clones-regras";
import {
  chaveDoClone,
  LADO_MINIMO_FOTO_REAL as LADO_DA_TELA,
  moverVariacaoNoCache,
  moverVistaNoCache,
  mudancaNasFotos,
  nomeDaCopiaDoClone,
  normalizarClone,
  normalizarCloneAberto,
  problemaDaFotoDeOrigem as problemaNaTela,
  type CloneAberto,
} from "@/components/mesa-foto/clonesApi";

/**
 * Clones editáveis depois de criados (pedido do dono, 25/09 à noite: "ele
 * limita a só aquelas fotos; quero mudar, excluir, trocar para gerar de novo;
 * também apagar e clonar"). Regras puras da função (clones-edicao.ts), o
 * contrato pelo código (clones.ts) e as regras da tela (clonesApi.ts).
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const C = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "aaaaaaaa-0000-4000-8000-00000000000b";
const D = "aaaaaaaa-0000-4000-8000-00000000000d";
const E = "aaaaaaaa-0000-4000-8000-00000000000e";
const X = "aaaaaaaa-0000-4000-8000-0000000000ff";
const real = (id: string, extra: Record<string, unknown> = {}) => ({ id, gerada: false, modo: null, tags: [], ativa: true, largura: 1200, altura: 1600, ...extra });
const AUT = { confirmada: true, quem: "A própria Paula", data: "2026-09-20", forma: "termo_assinado", finalidade: "posts da clínica", sabe_que_e_ia: true, adulta: true, registrada_por: "u-1", registrada_em: "2026-09-20T10:00:00Z" } as const;

describe("fotos de origem: mesmo limite e mesma qualidade da criação", () => {
  it("aceita de 1 a 4 fotos reais do acervo, ativas e com tamanho", () => {
    expect(validarFotosDeOrigem([A, B], [real(A), real(B)])).toEqual([A, B]);
    expect(() => validarFotosDeOrigem([], [])).toThrow(/de 1 a 4/);
    expect(() => validarFotosDeOrigem([A, B, D, E, X], [A, B, D, E, X].map((i) => real(i)))).toThrow(/No máximo 4/);
  });

  it("recusa foto de fora do cliente, gerada, da internet, arquivada ou pequena", () => {
    expect(() => validarFotosDeOrigem([A, X], [real(A)])).toThrow(/não está no acervo/);
    try {
      validarFotosDeOrigem([A], [real(A, { gerada: true })]);
      throw new Error("devia recusar");
    } catch (e) {
      expect((e as { codigo: string }).codigo).toBe("foto_nao_e_real");
    }
    expect(() => validarFotosDeOrigem([A], [real(A, { modo: "clone" })])).toThrow(/REAIS/);
    expect(() => validarFotosDeOrigem([A], [real(A, { tags: ["referencia_web"] })])).toThrow(/REAIS/);
    expect(() => validarFotosDeOrigem([A], [real(A, { ativa: false })])).toThrow(/arquivada/);
    expect(() => validarFotosDeOrigem([A], [real(A, { largura: 200, altura: 900 })])).toThrow(/pequena/);
    // Sem medida gravada não recusa pelo tamanho.
    expect(validarFotosDeOrigem([A], [real(A, { largura: null, altura: null })])).toEqual([A]);
  });

  it("a tela usa a mesma régua (mesmo lado mínimo, mesmos motivos)", () => {
    expect(LADO_DA_TELA).toBe(LADO_MINIMO_FOTO_REAL);
    const base = { gerada: false, modo: null, ativa: true, largura: 1200, altura: 1600, referencia_web: false };
    expect(problemaNaTela(base)).toBeNull();
    expect(problemaNaTela({ ...base, largura: 255 })).toMatch(/pequena/);
    expect(problemaNaTela({ ...base, gerada: true })).toMatch(/IA/);
    expect(problemaNaTela({ ...base, referencia_web: true })).toMatch(/internet/);
    expect(problemaNaTela({ ...base, ativa: false })).toMatch(/arquivada/);
  });

  it("a criação e a edição passam pela mesma validação na função", () => {
    const c = ler("supabase/functions/mesa-foto/clones.ts");
    const criar = c.slice(c.indexOf("async function cloneCriar"), c.indexOf("async function cloneLer"));
    const editar = c.slice(c.indexOf("async function cloneFotosEditar"), c.indexOf("async function cloneImagemArquivar"));
    expect(criar).toContain("validarFotosDeOrigem(corpo.imagem_ids");
    expect(editar).toContain("validarFotosDeOrigem(corpo.imagem_ids");
    expect(editar).toContain("garantirGeravel(c);");
    // Editar as fotos não gera nada (sem custo, sem laço de correção).
    expect(editar).not.toContain("chamarImagem");
    expect(editar).toContain("custo_usd: 0");
  });
});

describe("tirar, pôr e trocar foto de origem", () => {
  const AGORA = "2026-09-25T22:00:00.000Z";
  const atual: EntradaReal[] = [
    { imagem_id: A, client_id: C, principal: true, adicionada_em: "2026-09-20T10:00:00Z" },
    { imagem_id: B, client_id: C, principal: false, adicionada_em: "2026-09-20T10:00:00Z" },
  ];

  it("tirar: a foto sai e a principal passa para a primeira que ficou", () => {
    const m = novaIdentidadeReal(atual, [B], null, C, AGORA);
    expect(m.sairam).toEqual([A]);
    expect(m.entraram).toEqual([]);
    expect(m.identidade).toEqual([{ imagem_id: B, client_id: C, principal: true, adicionada_em: "2026-09-20T10:00:00Z" }]);
    expect(m.mudou_fotos).toBe(true);
  });

  it("adicionar: a nova ganha a data de agora; quem fica mantém a data", () => {
    const m = novaIdentidadeReal(atual, [A, B, D], A, C, AGORA);
    expect(m.entraram).toEqual([D]);
    expect(m.identidade.find((r) => r.imagem_id === D)!.adicionada_em).toBe(AGORA);
    expect(m.identidade.find((r) => r.imagem_id === A)!.adicionada_em).toBe("2026-09-20T10:00:00Z");
    expect(m.principal_mudou).toBe(false);
  });

  it("trocar: uma sai, outra entra no lugar; a principal pedida vale", () => {
    const m = novaIdentidadeReal(atual, [D, B], D, C, AGORA);
    expect(m.sairam).toEqual([A]);
    expect(m.entraram).toEqual([D]);
    expect(m.principal_mudou).toBe(true);
    expect(m.identidade.map((r) => [r.imagem_id, r.principal])).toEqual([[D, true], [B, false]]);
  });

  it("só a principal muda: não conta como foto nova; tudo igual é igual", () => {
    const m = novaIdentidadeReal(atual, [A, B], B, C, AGORA);
    expect(m.mudou_fotos).toBe(false);
    expect(m.principal_mudou).toBe(true);
    expect(novaIdentidadeReal(atual, [A, B], A, C, AGORA).igual).toBe(true);
  });
});

describe("folha feita com as fotos antigas", () => {
  const ident = (extra: EntradaReal[] = []): EntradaReal[] => [
    { imagem_id: A, client_id: C, principal: true, adicionada_em: "2026-09-20T10:00:00Z" },
    { imagem_id: B, client_id: C, principal: false, adicionada_em: "2026-09-20T10:00:00Z" },
    ...extra,
  ];
  const vista = (fontes: string[], criado_em = "2026-09-21T10:00:00Z") => ({ fontes: fontes.map((id) => ({ tipo: "foto_real", id })).concat([{ tipo: "vista", id: X }]), criado_em });

  it("usou uma foto que saiu: desatualizada", () => {
    expect(vistaDesatualizada(vista([A, D]), ident())).toBe(true);
  });

  it("entrou foto nova depois que a vista nasceu: desatualizada; antes: não", () => {
    expect(vistaDesatualizada(vista([A, B]), ident([{ imagem_id: D, client_id: C, principal: false, adicionada_em: "2026-09-25T22:00:00Z" }]))).toBe(true);
    expect(vistaDesatualizada(vista([A, B], "2026-09-26T10:00:00Z"), ident([{ imagem_id: D, client_id: C, principal: false, adicionada_em: "2026-09-25T22:00:00Z" }]))).toBe(false);
  });

  it("mesmas fotos, principal trocada, foto antiga sem data ou vista sem fontes: continua valendo", () => {
    expect(vistaDesatualizada(vista([A, B]), ident())).toBe(false);
    const trocada = ident().map((r) => ({ ...r, principal: !r.principal }));
    expect(vistaDesatualizada(vista([A, B]), trocada)).toBe(false);
    expect(vistaDesatualizada(vista([A]), [{ imagem_id: A, client_id: C, principal: true }])).toBe(false);
    expect(vistaDesatualizada({ fontes: [], criado_em: "2026-09-21T10:00:00Z" }, ident())).toBe(false);
  });

  it("a função guarda a vista antiga, marca e não a usa mais como identidade", () => {
    const c = ler("supabase/functions/mesa-foto/clones.ts");
    const ident = c.slice(c.indexOf("async function identidadesBaixadas"), c.indexOf("async function logoDaMarca"));
    expect(ident).toContain("!vistaDesatualizada(i, c.identidade_real)");
    expect(ident).toContain("ativasDa(folha)");
    expect(c).toContain("desatualizada: i.papel === \"vista\" && vistaDesatualizada(i, c.identidade_real)");
    // Nenhuma vista é apagada ao mudar as fotos.
    const editar = c.slice(c.indexOf("async function cloneFotosEditar"), c.indexOf("async function cloneImagemArquivar"));
    expect(editar).not.toMatch(/\.delete\(|\.remove\(/);
  });
});

describe("apagar é arquivar (com desfazer), nunca excluir", () => {
  it("marca de vista apagada vale sem a coluna nova; restaurar tira a marca", () => {
    const avisos = avisosArquivados(["confira a mão"], "2026-09-25T22:00:00Z");
    expect(vistaArquivada({ avisos })).toBe(true);
    expect(vistaArquivada({ arquivada_em: "2026-09-25T22:00:00Z", avisos: [] })).toBe(true);
    expect(avisosRestaurados(avisos)).toEqual(["confira a mão"]);
    expect(vistaArquivada({ avisos: avisosRestaurados(avisos) })).toBe(false);
    // Arquivar de novo não empilha marcas.
    expect(avisosArquivados(avisos, "2026-09-26T10:00:00Z").filter((a) => a.indexOf("arquivada_em:") === 0)).toHaveLength(1);
  });

  it("coluna que falta (SQL Z não aplicado) é reconhecida para seguir sem ela", () => {
    expect(colunaQueFalta({ code: "PGRST204", message: "Could not find the 'arquivada_em' column" })).toBe(true);
    expect(colunaQueFalta({ code: "42703", message: "column does not exist" })).toBe(true);
    expect(colunaQueFalta({ code: "23514", message: "violates check constraint" })).toBe(false);
  });

  it("a função arquiva e restaura: vista marcada, variação inativa, clone com status; sem exclusão definitiva", () => {
    const c = ler("supabase/functions/mesa-foto/clones.ts");
    const arq = c.slice(c.indexOf("async function cloneImagemArquivar"), c.indexOf("async function cloneVariacaoRefazer"));
    expect(arq).toContain("update({ ativa: restaurar })");
    expect(arq).toContain("avisosArquivados(img.avisos, agora)");
    expect(arq).toContain("arquivada_em: restaurar ? null : agora");
    expect(arq).toContain("atualizarStatus(c, todas)");
    expect(arq).not.toMatch(/\.delete\(|storage\.from\([^)]*\)\.remove/);
    // Apagar o clone = status arquivada; some de clones_listar; a seção Arquivados lista só eles.
    expect(c).toContain('if (corpo.arquivados === true) q = q.eq("status", "arquivada");');
    expect(c).toContain('else if (corpo.incluir_arquivados !== true) q = q.neq("status", "arquivada");');
    expect(c).toContain('if (corpo.arquivar === true) patch.status = "arquivada";');
    // Restaurar o clone pede autorização válida.
    expect(c).toContain("Para reabrir o clone, registre uma autorização válida.");
    // A folha que conta não tem vista apagada.
    expect(c).toContain("const ativasDa = (folha: VistaLida[]) => folha.filter((i) => !vistaArquivada(i));");
  });
});

describe("gerar de novo escolhendo as fotos", () => {
  const ident: EntradaReal[] = [
    { imagem_id: A, client_id: C, principal: true },
    { imagem_id: B, client_id: C, principal: false },
  ];

  it("sem escolha vão todas; a escolha é só entre as fotos de origem; pelo menos 1", () => {
    expect(fotosEscolhidasParaGerar(undefined, ident)).toBeNull();
    expect(fotosEscolhidasParaGerar([], ident)).toBeNull();
    expect(fotosEscolhidasParaGerar([B], ident)).toEqual([B]);
    expect(() => fotosEscolhidasParaGerar([D], ident)).toThrow(/fotos de origem deste clone/);
    expect(() => fotosEscolhidasParaGerar("x", ident)).toThrow(/lista/);
  });

  it("variação: o pedido fica ao lado do arquivo; sem ele, a descrição serve", () => {
    expect(caminhoDoPedido("c/foto/clones/x/v.png")).toBe("c/foto/clones/x/v.png.pedido.json");
    const p = pedidoDaDescricao("Pessoa real (Paula) recriada. Mudou: blazer bege; café com janela. Motor x.", "Paula (variação: Café)", PRESETS_DE_VARIACAO);
    expect(p).toEqual({ preset: "cafe", livre: "blazer bege; café com janela" });
    expect(pedidoDaDescricao("sem nada", "Paula", PRESETS_DE_VARIACAO)).toBeNull();
    expect(formatoPelaMedida(1088, 1920)).toBe("9:16");
    expect(formatoPelaMedida(1920, 1088)).toBe("16:9");
    expect(formatoPelaMedida(1024, 1024)).toBe("1:1");
    expect(formatoPelaMedida(null, null)).toBe("4:5");
  });

  it("a função leva a escolha ao gerador nas vistas e nas variações (uma foto por chamada)", () => {
    const c = ler("supabase/functions/mesa-foto/clones.ts");
    expect(c).toContain('identidadesBaixadas(c, vista, m, "folha", 0, soReais)');
    expect(c).toContain('identidadesBaixadas(c, vistaMaisPerto, m, "variacao", vagas, soReais)');
    expect(c).toContain("const soReais = fotosEscolhidasParaGerar(corpo.fotos_reais_ids, c.identidade_real);");
    const refazer = c.slice(c.indexOf("async function cloneVariacaoRefazer"), c.indexOf("async function cloneDuplicar"));
    expect(refazer).toContain("garantirGeravel(c);");
    expect(refazer.split("gerarVariacao(").length - 1).toBe(1);
    expect(c).toMatch(/ACOES_LONGAS_DE_CLONES = \[[^\]]*"clone_fotos_editar"[^\]]*"clone_variacao_refazer"[^\]]*"clone_duplicar"/);
  });
});

describe("duplicar mantém as fotos de origem e a autorização", () => {
  it("a autorização da cópia é a mesma, conferida de novo, com a origem anotada", () => {
    const a = autorizacaoDaCopia(AUT, "orig", "2026-09-25");
    expect(a).toMatchObject({ confirmada: true, quem: "A própria Paula", data: "2026-09-20", finalidade: "posts da clínica", sabe_que_e_ia: true, adulta: true, herdada_de: "orig", registrada_por: "u-1" });
  });

  it("sem autorização, revogada ou vencida: não nasce cópia", () => {
    expect(() => autorizacaoDaCopia(null, "orig", "2026-09-25")).toThrow(/não tem autorização/);
    expect(() => autorizacaoDaCopia({ ...AUT, revogada_em: "2026-09-24T10:00:00Z" }, "orig", "2026-09-25")).toThrow(/revogada/);
    expect(() => autorizacaoDaCopia({ ...AUT, validade: "2026-09-01" }, "orig", "2026-09-25")).toThrow(/venceu/);
    expect(() => autorizacaoDaCopia({ ...AUT, sabe_que_e_ia: false as unknown as true }, "orig", "2026-09-25")).toThrow(/IA/);
  });

  it("nome da cópia: o pedido ou o nome com (cópia), sem empilhar", () => {
    expect(nomeDaCopia("Dra. Paula")).toBe("Dra. Paula (cópia)");
    expect(nomeDaCopia("Dra. Paula (cópia)")).toBe("Dra. Paula (cópia)");
    expect(nomeDaCopia("Dra. Paula", "Paula de jaleco")).toBe("Paula de jaleco");
    expect(nomeDaCopiaDoClone("Dra. Paula (cópia)")).toBe("Dra. Paula (cópia)");
  });

  it("a função: autorização conferida antes do insert, mesmas fotos, folha copiada sem gerar", () => {
    const c = ler("supabase/functions/mesa-foto/clones.ts");
    const dup = c.slice(c.indexOf("async function cloneDuplicar"), c.indexOf("// ---------------------------------------------------------------- variações pelo contexto"));
    expect(dup.indexOf("autorizacaoDaCopia(c.autorizacao, c.id)")).toBeGreaterThan(0);
    expect(dup.indexOf("autorizacaoDaCopia(c.autorizacao, c.id)")).toBeLessThan(dup.indexOf('.from("foto_modelos").insert('));
    expect(dup).toContain("autorizacao,\n");
    expect(dup).toContain("identidade_real: c.identidade_real.map((r) => ({ ...r, client_id: c.client_id }))");
    expect(dup).toContain("origem: ORIGEM_CLONE");
    expect(dup).toContain("duplicado_de: c.id");
    expect(dup).toContain(".copy(a.storage_path, para)");
    expect(dup).not.toContain("chamarImagem");
    expect(dup).toContain("garantirPermitidoNoClone(nome)");
    expect(c).toContain("clone_duplicar: cloneDuplicar,");
    expect(c).toContain("clone_fotos_editar: cloneFotosEditar,");
    expect(c).toContain("clone_imagem_arquivar: cloneImagemArquivar,");
    expect(c).toContain("clone_variacao_refazer: cloneVariacaoRefazer,");
  });
});

describe("tela: rascunho das fotos e cache sem piscar", () => {
  const clone = normalizarClone({ id: "c1", nome: "Paula", identidade_real: [{ imagem_id: A, principal: true }, { imagem_id: B, principal: false }], autorizacao: AUT })!;

  it("o que mudou nas fotos (só mostra Salvar quando muda)", () => {
    expect(mudancaNasFotos(clone, { ids: [A, B], principal: A }).alguma).toBe(false);
    expect(mudancaNasFotos(clone, { ids: [A, B], principal: B })).toMatchObject({ principal: true, alguma: true });
    expect(mudancaNasFotos(clone, { ids: [A, D], principal: A })).toMatchObject({ entraram: [D], sairam: [B], alguma: true });
  });

  it("vista apagada e desatualizada chegam marcadas; apagar e restaurar mudam o cache na hora", () => {
    const aberto = normalizarCloneAberto({
      clone: { id: "c1", nome: "Paula", identidade_real: [{ imagem_id: A, principal: true }], autorizacao: AUT },
      imagens: [
        { id: "v1", papel: "vista", vista: "frente", storage_path: "x/1.png", aprovada: true, desatualizada: true, fontes: [{ tipo: "foto_real", id: A }] },
        { id: "v2", papel: "vista", vista: "perfil_esq", storage_path: "x/2.png", aprovada: null, avisos: ["arquivada_em:2026-09-25T22:00:00Z"] },
      ],
      variacoes: [{ id: "f1", client_id: "cl", nome: "var", storage_bucket: "mesa", storage_path: "x/f1.png", tags: ["clone:c1"], ativa: true }],
      folha: {},
    })!;
    expect(aberto.imagens.map((i) => i.id)).toEqual(["v1"]);
    expect(aberto.imagens[0]).toMatchObject({ desatualizada: true, fontes_reais: [A] });
    expect(aberto.arquivadas.map((i) => i.id)).toEqual(["v2"]);
    const qc = new QueryClient();
    qc.setQueryData(chaveDoClone("c1"), aberto);
    moverVistaNoCache(qc, "c1", "v1", true);
    let a = qc.getQueryData<CloneAberto>(chaveDoClone("c1"))!;
    expect(a.imagens).toHaveLength(0);
    expect(a.folha.aprovadas).toBe(0);
    expect(a.arquivadas[0]).toMatchObject({ id: "v1", arquivada: true });
    moverVistaNoCache(qc, "c1", "v1", false);
    a = qc.getQueryData<CloneAberto>(chaveDoClone("c1"))!;
    expect(a.folha.aprovadas).toBe(1);
    moverVariacaoNoCache(qc, "c1", "f1", true);
    a = qc.getQueryData<CloneAberto>(chaveDoClone("c1"))!;
    expect(a.variacoes).toHaveLength(0);
    expect(a.variacoes_arquivadas[0]).toMatchObject({ id: "f1", ativa: false });
  });

  it("textos sem travessão e sem CSS moderno nos arquivos novos", () => {
    for (const arq of ["supabase/functions/mesa-foto/clones-edicao.ts", "src/components/mesa-foto/EtapaClones.tsx", "src/components/mesa-foto/clonesApi.ts"]) {
      const t = ler(arq);
      expect(t, arq).not.toMatch(/[—–]/);
      expect(t, arq).not.toMatch(/aspect-ratio|:has\(|\.at\(|Object\.hasOwn|\(\?<[=!a-z]|\\p\{/);
      expect(t, arq).not.toMatch(/\[(?:min|max|clamp)\(/);
      expect(t, arq).not.toMatch(/bg-black\/|brightness-/);
    }
  });
});
