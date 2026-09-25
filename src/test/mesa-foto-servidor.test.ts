import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cameraDaCampanha,
  descricaoDaReferenciaWeb,
  imagensDoHtml,
  kitParecido,
  LACUNA_SO_CAIXA,
  LACUNA_SO_WEB,
  lacunasDaEvidencia,
  lerFotosDeCampanha,
  lerModeloSintetico,
  lerOrigemWeb,
  mesclarKit,
  normalizarGuiaDeEstilo,
  normalizarIdentificacao,
  planoDeVariacoes,
  promptDaCampanha,
  promptDoExemplo,
  referenciaWebServe,
  termosDeBusca,
  tipoDeVariacaoDoTexto,
  blocosDaResposta,
  vagasDoDiretor,
  vagasDoPlano,
} from "../../supabase/functions/mesa-foto/calculos";
import {
  aplicarSugestaoDeTomada,
  blocoDeVariacao,
  caminhoDeOriginalValido,
  complementoDasAreas,
  conferirRefs,
  criteriosDaConferencia,
  decidirVersao,
  derivadaDoPreparo,
  dimensoesDaImagem,
  ErroDeRegra,
  estimativaDoEnsaio,
  fontesDaTomada,
  itensDoOpenverse,
  type KitFoto,
  lerAreas,
  lerCamera,
  lerFormatos,
  lerGuia,
  limiteDeFontesDoMotor,
  mimeDe,
  modoDaCamera,
  montarTomada,
  montarTomadas,
  motivoDoBloqueio,
  normalizarConferencia,
  normalizarItemBiblioteca,
  normalizarKit,
  normalizarRefs,
  normalizarSugestoes,
  OPENVERSE_MAX_PAGINA,
  promptDaTomada,
  promptDoPreparo,
  type RefDoKit,
  semTravessao,
  sha256Hex,
  statusDoEnsaio,
  tamanhoDeTrabalho,
  type Tomada,
  urlDoOpenverse,
  urlPublicaSegura,
  type VersaoTomada,
} from "../../supabase/functions/mesa-foto/calculos";
import {
  cameraDoPreset,
  ORDEM_DAS_VARIACOES,
  PRESETS,
  PROIBICOES_PESSOA_SINTETICA,
  RECEITA_CAMPANHA,
  receitaPorId,
  RECEITAS,
  RECEITAS_V2,
  TIPOS_DE_VARIACAO,
} from "../../supabase/functions/mesa-foto/receitas";
import {
  alertasDoRealismo,
  conteudoProibido,
  DESCRICAO_DA_VISTA,
  fichaEmTexto,
  fichaSugerida,
  FOLHA_PADRAO,
  identidadesDaVista,
  invariantesDaFicha,
  NIVEIS_PELE,
  normalizarFicha,
  normalizarNomeDaPersona,
  padraoDoMotor,
  PALAVRAS_QUE_PLASTIFICAM,
  personaUsavel,
  promptDaCandidata,
  promptDaVista,
  promptDoDetalhe,
  resumoDaFolha,
  RODADA_PADRAO,
  statusDaPersona,
} from "../../supabase/functions/mesa-foto/personas";
import {
  entradasDaSaida,
  escolherSaida,
  garantirQueDaParaGerar,
  idsDoCanvas,
  LIMITE_REFERENCIAS_DO_CANVAS,
  normalizarCanvas,
  orcamentoPorPapel,
  ordenarReferencias,
  promptDoCanvas,
} from "../../supabase/functions/mesa-foto/canvas-regras";
import {
  campanhaParaOContexto,
  itensDasPropostas,
  type LinhaCampanhaDaMesa,
  marcarCampanhaDoMes,
  mesDeSaoPaulo,
} from "../../supabase/functions/mesa-foto/campanhas";

/**
 * Mesa Foto, frente A (docs/mesa-foto/CONTRATO.md): lógica pura executando de
 * verdade, contratos da função pelo código-fonte e o SQL da migration.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fonte = ler("supabase/functions/mesa-foto/index.ts");
const calculosFonte = ler("supabase/functions/mesa-foto/calculos.ts");
const receitasFonte = ler("supabase/functions/mesa-foto/receitas.ts");
const imagemFonte = ler("supabase/functions/mesa-foto/imagem.ts");
const motor = ler("supabase/functions/_shared/ia-motor.ts");
const sql = ler("docs/mesa-foto/migrations/01_mesa_foto.sql");
const config = ler("supabase/config.toml");
const pesquisaReceitas = JSON.parse(ler("docs/mesa-foto/pesquisa/receitas-ensaio.json")) as { recipes: { id: string; tomadas: string[] }[] };
const pesquisaPresets = JSON.parse(ler("docs/mesa-foto/pesquisa/presets-angulos.json")) as {
  presets: { id: string; azimute_graus: number; elevacao_graus: number; enquadramento: string; zoom_fal_sugerido: number }[];
};

const corpoDe = (texto: string, nome: string) => {
  const i = texto.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const proximos = ["\nasync function ", "\nfunction ", "\nconst ACOES"].map((m) => texto.indexOf(m, i + 10)).filter((x) => x > 0);
  return texto.slice(i, Math.min(...proximos));
};

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const IMG = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const kitProduto = (extra: Partial<KitFoto> = {}): KitFoto => ({
  tipo: "tecnologia",
  nome: "Mouse Orbit",
  variante: "preto",
  atributos: { observado: ["seis botões"], informado: [], inferido: [] },
  invariantes: ['texto "ORBIT" na lateral'],
  lacunas: ["Vista inferior não documentada"],
  autorizacao: null,
  frente_imagem_id: null,
  status: "confirmado",
  ...extra,
});

const ref = (n: number, papel: RefDoKit["papel"], vista: string | null = null, prioridade = 100): RefDoKit => ({ imagem_id: IMG(n), papel, vista, prioridade });

// ------------------------------------------------------------------ receitas e presets

describe("receitas e presets da pesquisa", () => {
  it("tem as 8 receitas da pesquisa, com as mesmas tomadas, e as 2 da v2", () => {
    expect(RECEITAS).toHaveLength(10);
    expect(RECEITAS.filter((r) => !RECEITAS_V2.includes(r.id))).toHaveLength(8);
    for (const r of pesquisaReceitas.recipes) {
      const nossa = receitaPorId(r.id);
      expect(nossa, r.id).not.toBeNull();
      expect(nossa!.tomadas.length, r.id).toBe(r.tomadas.length);
      expect(nossa!.testada).toBe(false);
      expect(nossa!.luz.length).toBeGreaterThan(40);
    }
  });

  it("tem as 96 posições da grade, na ordem e com o zoom da pesquisa", () => {
    expect(PRESETS).toHaveLength(96);
    PRESETS.forEach((p, i) => {
      const q = pesquisaPresets.presets[i];
      expect(p.id).toBe(q.id);
      expect([p.azimute_graus, p.elevacao_graus, p.enquadramento, p.zoom_fal_sugerido]).toEqual([q.azimute_graus, q.elevacao_graus, q.enquadramento, q.zoom_fal_sugerido]);
    });
    expect(PRESETS[12].nome).toBe("Três quartos direito / Câmera baixa / detalhe");
  });

  it("tomadas que dependem de evidência declaram o que exigem", () => {
    const cat = receitaPorId("catalogo-fiel")!;
    expect(cat.tomadas.find((t) => t.id === "verso")!.exige!.papeis).toEqual(["verso"]);
    expect(cat.tomadas.find((t) => t.id === "escala")!.exige!.informado).toBe("medida");
    // Vista de cima fica fora da grade e é marcada como posição própria.
    expect(receitaPorId("alimentos")!.tomadas.find((t) => t.id === "de-cima")!.camera.preset_id).toBeNull();
  });
});

// ------------------------------------------------------------------ bytes

describe("tipo e dimensões pelo conteúdo", () => {
  const png = (l: number, a: number) => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, l);
    new DataView(b.buffer).setUint32(20, a);
    return b;
  };
  it("lê PNG, JPEG e WebP pelo cabeçalho", () => {
    expect(mimeDe(png(4000, 3000))).toBe("image/png");
    expect(dimensoesDaImagem(png(4000, 3000))).toEqual({ largura: 4000, altura: 3000 });
    const jpeg = new Uint8Array(40);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    jpeg.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xb8, 0x0f, 0xa0, 0x03], 20);
    expect(mimeDe(jpeg)).toBe("image/jpeg");
    expect(dimensoesDaImagem(jpeg)).toEqual({ largura: 4000, altura: 3000 });
    const webp = new Uint8Array(32);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp.set([(1920 - 1) & 0xff, ((1920 - 1) >> 8) & 0xff, 0, (1080 - 1) & 0xff, ((1080 - 1) >> 8) & 0xff, 0], 24);
    expect(mimeDe(webp)).toBe("image/webp");
    expect(dimensoesDaImagem(webp)).toEqual({ largura: 1920, altura: 1080 });
  });

  it("recusa GIF e lixo", () => {
    expect(mimeDe(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(dimensoesDaImagem(new Uint8Array(20))).toBeNull();
  });

  it("sha256 confere com o vetor conhecido", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("caminho de original só dentro da pasta do cliente", () => {
    expect(caminhoDeOriginalValido(CLIENTE, `${CLIENTE}/foto/originais/lote1/mouse.jpg`)).toBe(`${CLIENTE}/foto/originais/lote1/mouse.jpg`);
    expect(caminhoDeOriginalValido(CLIENTE, `${OUTRO}/foto/originais/mouse.jpg`)).toBeNull();
    expect(caminhoDeOriginalValido(CLIENTE, `${CLIENTE}/foto/originais/../../x.jpg`)).toBeNull();
    expect(caminhoDeOriginalValido(CLIENTE, `${CLIENTE}/foto/derivadas/x.png`)).toBeNull();
  });
});

// ------------------------------------------------------------------ áreas

describe("áreas protegidas e tamanho de trabalho", () => {
  const dentro = (a: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) => x > a.x0 && x < a.x1 && y > a.y0 && y < a.y1;
  it("o complemento cobre tudo o que não é protegido e nada do que é", () => {
    expect(complementoDasAreas([])).toEqual([{ x0: 0, y0: 0, x1: 1, y1: 1 }]);
    const protegidas = lerAreas([{ x0: 0.6, y0: 0.2, x1: 0.2, y1: 0.7 }, { x0: 0.5, y0: 0.5, x1: 0.9, y1: 0.95 }]);
    expect(protegidas[0]).toEqual({ x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.7 });
    const comp = complementoDasAreas(protegidas);
    for (let i = 1; i < 50; i++) {
      for (let j = 1; j < 50; j++) {
        const x = i / 50 + 0.003, y = j / 50 + 0.003;
        const protegido = protegidas.some((a) => dentro(a, x, y));
        const aberto = comp.some((a) => dentro(a, x, y));
        expect(protegido !== aberto, `${x},${y}`).toBe(true);
      }
    }
    // Faixas iguais se juntam: bem menos retângulos que a grade inteira.
    expect(comp.length).toBeLessThan(12);
  });

  it("descarta áreas vazias", () => {
    expect(lerAreas([{ x0: 0.1, y0: 0.1, x1: 0.11, y1: 0.9 }])).toEqual([]);
    expect(lerAreas("x")).toEqual([]);
  });

  it("escolhe o tamanho de trabalho de proporção mais próxima", () => {
    expect(tamanhoDeTrabalho(3000, 4000)).toBe("1088x1360");
    expect(tamanhoDeTrabalho(4000, 3000)).toBe("1360x1088");
    expect(tamanhoDeTrabalho(2000, 2000)).toBe("1024x1024");
    expect(tamanhoDeTrabalho(1080, 1920)).toBe("1088x1920");
    expect(tamanhoDeTrabalho(null, 10)).toBe("1024x1024");
  });
});

// ------------------------------------------------------------------ kit

describe("kit, referências e bloqueio", () => {
  it("valida o kit e só guarda autorização em kit de pessoa", () => {
    expect(() => normalizarKit({ tipo: "carro", nome: "x" })).toThrow(ErroDeRegra);
    expect(() => normalizarKit({ tipo: "produto", nome: " " })).toThrow(/nome/i);
    const p = normalizarKit({ tipo: "produto", nome: "Mouse", autorizacao: { confirmada: true } });
    expect(p.autorizacao).toBeNull();
    const pessoa = normalizarKit({
      tipo: "pessoa", nome: "Dra. Ana",
      autorizacao: { confirmada: true, quem: "Ana Souza", data: "2026-09-20T10:00:00Z", finalidade: "site e anúncios", observacao: "termo assinado" },
    });
    expect(pessoa.autorizacao).toMatchObject({ confirmada: true, quem: "Ana Souza", data: "2026-09-20", finalidade: "site e anúncios", observacao: "termo assinado" });
    expect(pessoa.status).toBe("rascunho");
  });

  it("referência de outro cliente e gerada sem aprovação como evidência são recusadas", () => {
    const refs = normalizarRefs([{ imagem_id: IMG(1), papel: "identidade", vista: "frente" }, { imagem_id: IMG(2), papel: "estilo" }]);
    expect(() => conferirRefs(refs, CLIENTE, [
      { id: IMG(1), client_id: OUTRO, gerada: false, aprovada: false },
      { id: IMG(2), client_id: CLIENTE, gerada: false, aprovada: false },
    ])).toThrow(/acervo deste cliente/);
    expect(() => conferirRefs(refs, CLIENTE, [
      { id: IMG(1), client_id: CLIENTE, gerada: true, aprovada: false },
      { id: IMG(2), client_id: CLIENTE, gerada: false, aprovada: false },
    ])).toThrow(/aprovada/);
    // Gerada aprovada pode ser evidência; gerada sem aprovação pode ser estilo.
    expect(() => conferirRefs(refs, CLIENTE, [
      { id: IMG(1), client_id: CLIENTE, gerada: true, aprovada: true },
      { id: IMG(2), client_id: CLIENTE, gerada: true, aprovada: false },
    ])).not.toThrow();
    expect(() => normalizarRefs([{ imagem_id: IMG(1), papel: "logo" }])).toThrow(/Papel/);
  });

  it("caixa sozinha não documenta o produto; pessoa sem autorização não gera; evidência exigida aparece", () => {
    expect(motivoDoBloqueio(kitProduto(), [ref(1, "embalagem")])).toMatch(/Embalagem sozinha/);
    expect(motivoDoBloqueio(kitProduto(), [ref(1, "identidade", "frente")])).toBeNull();
    const pessoa = kitProduto({ tipo: "pessoa", autorizacao: null });
    expect(motivoDoBloqueio(pessoa, [ref(1, "rosto")])).toMatch(/autorização/);
    const verso = receitaPorId("catalogo-fiel")!.tomadas.find((t) => t.id === "verso")!;
    expect(motivoDoBloqueio(kitProduto(), [ref(1, "identidade")], verso.exige)).toMatch(/verso/);
    const escala = receitaPorId("catalogo-fiel")!.tomadas.find((t) => t.id === "escala")!;
    expect(motivoDoBloqueio(kitProduto(), [ref(1, "identidade")], escala.exige)).toMatch(/medida/);
    expect(motivoDoBloqueio(kitProduto({ atributos: { observado: [], informado: ["Medida: 12 cm de comprimento"], inferido: [] } }), [ref(1, "identidade")], escala.exige)).toBeNull();
  });

  it("modo pela câmera: vista documentada é cenário; outra vista é novo ângulo, sem espelhar", () => {
    const refs = [ref(1, "identidade", "tres_quartos_direito")];
    expect(modoDaCamera(cameraDoPreset("a45-e30-dmedio"), refs)).toBe("cenario");
    expect(modoDaCamera(cameraDoPreset("a315-e30-dmedio"), refs)).toBe("angulo");
    expect(modoDaCamera(cameraDoPreset("a180-e0-dmedio"), refs)).toBe("angulo");
    // Sem vista marcada, a identidade é a frente.
    expect(modoDaCamera(cameraDoPreset("a0-e0-dmedio"), [ref(1, "identidade")])).toBe("cenario");
    expect(modoDaCamera(lerCamera({ azimute: 0, elevacao: 90, enquadramento: "medio" })!, [ref(1, "identidade", "topo")])).toBe("cenario");
    // Estilo não documenta nada.
    expect(modoDaCamera(cameraDoPreset("a0-e0-dmedio"), [ref(1, "estilo", "frente")])).toBe("angulo");
  });

  it("fontes na ordem identidade, detalhe, embalagem, estilo, até o limite", () => {
    const refs = [ref(5, "estilo"), ref(4, "embalagem", "frente"), ref(3, "detalhe"), ref(2, "identidade", "lateral_direita"), ref(1, "identidade", "frente")];
    const semCaixa = fontesDaTomada(refs, { camera: cameraDoPreset("a0-e0-dmedio"), exige: null }, 8);
    expect(semCaixa.map((r) => r.imagem_id)).toEqual([IMG(1), IMG(2), IMG(3), IMG(5)]);
    const comCaixa = fontesDaTomada(refs, { camera: cameraDoPreset("a90-e0-dmedio"), exige: { papeis: ["embalagem"], descricao: "caixa" } }, 3);
    expect(comCaixa.map((r) => r.imagem_id)).toEqual([IMG(2), IMG(1), IMG(3)]);
    expect(limiteDeFontesDoMotor({ provedor: "openrouter", modelo_api: "openai/gpt-image-2.5" })).toBe(16);
  });
});

// ------------------------------------------------------------------ tomadas e prompts

describe("tomadas, prompts e estimativa", () => {
  const receita = receitaPorId("tecnologia")!;
  const refs = [ref(1, "identidade", "tres_quartos_direito"), ref(2, "embalagem", "frente")];

  it("sem plano do diretor, usa a receita; bloqueio e modo decididos no código", () => {
    const tomadas = montarTomadas(receita, [], { kit: kitProduto(), refs, formatos: ["1:1", "4:5"] });
    expect(tomadas).toHaveLength(8);
    expect(tomadas.every((t) => t.gerado === true)).toBe(true);
    expect(tomadas.find((t) => t.id === "portas")!).toMatchObject({ status: "bloqueada", bloqueada: true, ultimo_erro: null });
    expect(tomadas.find((t) => t.id === "principal")!).toMatchObject({ status: "pendente", bloqueada: false });
    expect(tomadas.find((t) => t.id === "embalagem")!.motivo_bloqueio).toBeNull();
    const frente = tomadas.find((t) => t.id === "frente")!;
    expect(frente.modo).toBe("angulo");
    expect(frente.angulo_novo).toBe(true);
    expect(tomadas.find((t) => t.id === "principal")!.modo).toBe("cenario");
    expect(tomadas.every((t) => t.formato === "1:1")).toBe(true);
  });

  it("preset desconhecido do diretor cai na câmera da receita; tomada própria não herda exigência", () => {
    const tomadas = montarTomadas(receita, [
      { receita_tomada_id: "lateral", nome: "Lateral", objetivo: "", preset_id: "a999", cenario: "mesa de nogueira", luz: "", pode_mudar: ["props"], formato: "4:5", observacao: null },
      { receita_tomada_id: null, nome: "Mouse no setup gamer", objetivo: "Clima", preset_id: "a45-e-30-dmedio", cenario: "setup com LED", luz: "recorte azul", pode_mudar: [], formato: "9:16", observacao: null },
    ], { kit: kitProduto(), refs, formatos: ["4:5"] });
    expect(tomadas[0].camera.preset_id).toBe("a90-e0-dmedio");
    expect(tomadas[0].cenario).toBe("mesa de nogueira");
    expect(tomadas[1].exige).toBeNull();
    expect(tomadas[1].formato).toBe("4:5");
    expect(tomadas[1].id).toBe("mouse-no-setup-gamer");
  });

  it("prompt fotográfico traz câmera, lente, luz, sombra, invariantes, proibições e lacunas", () => {
    const [t] = montarTomadas(receita, [], { kit: kitProduto(), refs, formatos: ["4:5"] }).filter((x) => x.id === "frente");
    const p = promptDaTomada({
      kit: kitProduto(),
      tomada: t,
      finalidade: "anúncio",
      marca: { nome: "Loja X", estilo: "minimalista", paleta: ["#112233"] },
      fontes: [ref(1, "identidade", "tres_quartos_direito")],
      estilos: [{ titulo: "Luz lateral dramática" }],
      guiaTexto: "clima noturno",
      versoesAntes: 1,
      rejeicoes: ["texto da lateral saiu torto"],
    });
    for (const trecho of [
      "CÂMERA: de frente", "LENTE: objetiva", "LUZ:", "chave, preenchimento e recorte", "SOMBRA E REFLEXO", "sombra de contato",
      "mesmo texto do rótulo", "mesma quantidade de botões", "não espelhar", "NOVO ÂNGULO", "Vista inferior não documentada",
      "Imagem 1: IDENTIDADE", "Imagem 2: SÓ ESTILO", "não copie o objeto", "Esta direção não muda as invariantes",
      "VARIAÇÃO REAL (versão 2)", "texto da lateral saiu torto", "não escurecer a foto",
    ]) expect(p, trecho).toContain(trecho);
    expect(p).not.toMatch(/[\u2014\u2013]/);
  });

  it("proibições por tipo: pessoa e alimento", () => {
    const pessoa = kitProduto({ tipo: "pessoa", nome: "Ana", autorizacao: { confirmada: true, finalidade: null, escopo: null, validade: null, observacao: null } });
    const tp = montarTomada({ id: "r", nome: "Retrato", camera: cameraDoPreset("a0-e0-ddetalhe") }, { kit: pessoa, refs: [ref(1, "rosto")], receita: null, formatos: ["4:5"] });
    const pp = promptDaTomada({ kit: pessoa, tomada: tp, finalidade: "", marca: { nome: "X" }, fontes: [ref(1, "rosto")], estilos: [], guiaTexto: null, versoesAntes: 0, rejeicoes: [] });
    expect(pp).toContain("não mudar o rosto");
    expect(pp).toContain("idade aparente");
    expect(pp).toContain("85 mm");
    const prato = kitProduto({ tipo: "alimento", nome: "Moqueca" });
    const ta = montarTomada({ id: "p", nome: "Prato", camera: cameraDoPreset("a0-e30-dmedio") }, { kit: prato, refs: [ref(1, "identidade")], receita: null, formatos: ["4:5"] });
    const pa = promptDaTomada({ kit: prato, tomada: ta, finalidade: "", marca: { nome: "X" }, fontes: [], estilos: [], guiaTexto: null, versoesAntes: 0, rejeicoes: [] });
    expect(pa).toContain("não aumentar a porção");
    expect(pa).toContain("não inventar ingrediente");
    expect(criteriosDaConferencia("bebida")).toEqual(expect.arrayContaining(["Rótulo e texto iguais, legíveis e sem espelhamento", "Porção e volume iguais"]));
  });

  it("prompt do preparo diz o modo e nunca pede para escurecer", () => {
    const base = { tipo: "produto" as const, cenario: null, instrucao: null, guiaTexto: null, estilos: [], temAreasProtegidas: false, entradaRecortada: false };
    expect(promptDoPreparo({ ...base, modo: "fundo_transparente" })).toContain("fundo totalmente transparente");
    expect(promptDoPreparo({ ...base, modo: "luz_cor" })).toContain("Não escureça");
    expect(promptDoPreparo({ ...base, modo: "cenario", cenario: "bancada de mármore", temAreasProtegidas: true })).toContain("pixels originais");
    expect(derivadaDoPreparo("fundo_transparente", "recorte")).toEqual({ modo: "preservar", gerada: false });
    expect(derivadaDoPreparo("fundo_branco", "gerador")).toEqual({ modo: "preservar", gerada: true });
    expect(derivadaDoPreparo("cenario", "gerador")).toEqual({ modo: "cenario", gerada: true });
  });

  it("estimativa conta só as tomadas que podem ser geradas", () => {
    const est = estimativaDoEnsaio(
      [{ id: "a", motivo_bloqueio: null }, { id: "b", motivo_bloqueio: "falta verso" }, { id: "c", motivo_bloqueio: null }],
      () => 0.04,
      () => 0.002,
    );
    expect(est).toMatchObject({ tomadas_geraveis: 2, tomadas_bloqueadas: 1, geracao_usd: 0.08, conferencia_usd: 0.004, total_usd: 0.084 });
    expect(Object.keys(est.por_tomada_usd)).toEqual(["a", "c"]);
  });

  it("refazer pede variação real diferente a cada versão", () => {
    expect(blocoDeVariacao(0, [])).toBe("");
    expect(blocoDeVariacao(1, [])).not.toBe(blocoDeVariacao(2, []));
  });
});

// ------------------------------------------------------------------ versões

describe("decisão de versão", () => {
  const versao = (n: number): VersaoTomada => ({
    versao: n, imagem_id: null, storage_path: `c/foto/ensaios/e/t-${n}.png`, custo_usd: 0.04, conferencia: { pendente: true }, aprovada: null, decisao: null,
    motivo_rejeicao: null, criado_em: "2026-09-24T12:00:00Z", criado_por: null, gerada: true, modo: "cenario", camera: cameraDoPreset("a0-e0-dmedio"),
    formato: "4:5", tamanho: "1088x1360", fontes: [IMG(1)], guia: null, modelo_id: "m", qualidade: "media", prompt: "p", uso_ids: [], reserva_usada: null,
    travada: false, decidida_por: null, decidida_em: null,
  });
  const tomada = (): Tomada => ({
    ...montarTomada({ id: "t", nome: "T", camera: cameraDoPreset("a0-e0-dmedio") }, { kit: kitProduto(), refs: [ref(1, "identidade")], receita: null, formatos: ["4:5"] }),
    versoes: [versao(1), versao(2)],
  });

  it("aprovar trava; rejeitar versão travada é recusado; status acompanha", () => {
    const r = decidirVersao(tomada(), 2, "aprovar", null, "u", "agora");
    expect(r.versao).toMatchObject({ aprovada: true, decisao: "aprovada", travada: true, decidida_por: "u" });
    expect(r.tomada.status).toBe("aprovada");
    expect(() => decidirVersao(r.tomada, 2, "rejeitar", "não gostei", "u", "depois")).toThrow(/travada/);
    expect(decidirVersao(r.tomada, 2, "aprovar", null, "u", "depois").mudou).toBe(false);
    const rej = decidirVersao(tomada(), 2, "rejeitar", "rótulo espelhado", "u", "agora");
    expect(rej.versao).toMatchObject({ motivo_rejeicao: "rótulo espelhado", decisao: "rejeitada" });
    expect(rej.tomada.status).toBe("rejeitada");
    expect(() => decidirVersao(tomada(), 9, "aprovar", null, "u", "agora")).toThrow(/não existe/);
    expect(statusDoEnsaio([r.tomada])).toBe("concluido");
    expect(statusDoEnsaio([rej.tomada])).toBe("em_producao");
    expect(statusDoEnsaio([r.tomada], "arquivado")).toBe("arquivado");
  });

  it("conferência normalizada lista todo critério", () => {
    const c = normalizarConferencia({ pontos: [{ criterio: "Cor e material", ok: false, nota: "azul virou roxo" }], alertas: ["cor trocada"], resumo: "ok" }, ["Cor e material", "Proporção e formato"]);
    expect(c.pontos).toEqual([{ criterio: "Cor e material", ok: false, nota: "azul virou roxo" }, { criterio: "Proporção e formato", ok: null, nota: "não avaliado" }]);
  });
});

// ------------------------------------------------------------------ guia, biblioteca, openverse e agente

describe("guia, biblioteca, Openverse e agente", () => {
  it("guia valida cada modo", () => {
    expect(lerGuia(undefined).modo).toBe("nenhum");
    expect(() => lerGuia({ modo: "biblioteca" })).toThrow(/prompt_id/);
    expect(lerGuia({ modo: "referencia", referencia_ids: [IMG(1), IMG(2), IMG(3)] }).referencia_ids).toHaveLength(2);
    expect(() => lerGuia({ modo: "livre", texto: "" })).toThrow(/texto/);
  });

  it("item da biblioteca aceita cenario e uso; referência precisa de imagem; só https público", () => {
    const item = normalizarItemBiblioteca({ tipo: "prompt", categoria: "cenario", titulo: "Bancada \u2014 mármore", prompt_pt: "Produto sobre mármore", uso: "Cosméticos" });
    expect(item.categoria).toBe("cenario");
    expect(item.titulo).not.toMatch(/\u2014/);
    expect(item.uso).toBe("Cosméticos");
    expect(() => normalizarItemBiblioteca({ tipo: "referencia", categoria: "luz", titulo: "x" })).toThrow(/imagem/);
    expect(() => normalizarItemBiblioteca({ tipo: "referencia", categoria: "luz", titulo: "x", imagem_url: "http://exemplo.com/a.jpg" })).toThrow(/https/);
    expect(urlPublicaSegura("https://127.0.0.1/a.png")).toBeNull();
    expect(urlPublicaSegura("https://localhost/a.png")).toBeNull();
    expect(urlPublicaSegura("https://192.168.0.10/a.png")).toBeNull();
    expect(urlPublicaSegura("https://live.staticflickr.com/a.jpg")).not.toBeNull();
  });

  it("busca do Openverse: uso comercial por padrão e no máximo a página 12", () => {
    const u = new URL(urlDoOpenverse("coffee product photo", undefined, 50));
    expect(u.origin + u.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(u.searchParams.get("license_type")).toBe("commercial");
    expect(u.searchParams.get("page")).toBe(String(OPENVERSE_MAX_PAGINA));
    expect(OPENVERSE_MAX_PAGINA).toBe(12);
    expect(new URL(urlDoOpenverse("café", "modificacao")).searchParams.get("license_type")).toBe("commercial,modification");
    expect(new URL(urlDoOpenverse("café", "todas")).searchParams.get("license_type")).toBeNull();
    expect(() => urlDoOpenverse("a", undefined)).toThrow(/2 letras/);
  });

  it("resultado do Openverse vira item com licença crua e rótulo", () => {
    const itens = itensDoOpenverse({
      results: [
        {
          id: "abc-123-def", title: "Espresso", url: "https://live.staticflickr.com/1/e.jpg", thumbnail: "https://api.openverse.org/v1/images/abc/thumb/",
          foreign_landing_url: "https://www.flickr.com/photos/x/1", license: "by-sa", license_version: "2.0", creator: "Fulano", creator_url: "https://www.flickr.com/people/x",
          source: "flickr", width: 1024, height: 768,
        },
        { title: "Inseguro", url: "http://example.com/x.jpg", license: "cc0" },
      ],
    });
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({
      id: "abc-123-def", titulo: "Espresso", miniatura_url: "https://api.openverse.org/v1/images/abc/thumb/", licenca: "by-sa", licenca_rotulo: "CC BY-SA 2.0",
      autor: "Fulano", autor_url: "https://www.flickr.com/people/x", fonte_nome: "flickr",
    });
    expect(itensDoOpenverse({ results: [{ url: "https://a.b/c.jpg", license: "pdm" }] })[0].licenca_rotulo).toBe("Domínio público (PDM)");
  });

  it("sugestões do agente são conferidas e aplicadas sem IA", () => {
    const sug = normalizarSugestoes([
      { tipo: "ajuste_tomada", tomada_id: "frente", campos: { luz: "contraluz suave", preset_id: "a45-e30-dmedio", nome: null }, titulo: "Luz" },
      { tipo: "ajuste_tomada", tomada_id: "nao-existe", campos: { luz: "x" } },
      { tipo: "tomada_nova", campos: { nome: "Detalhe do scroll", preset_id: "a0-e30-ddetalhe", formato: "1:1" } },
      { tipo: "prompt", titulo: "Noturno", prompt_pt: "Produto em mesa escura com luz de recorte", categoria: "luz" },
      { tipo: "busca_referencia", busca: "moody tech product" },
      { tipo: "busca_referencia", busca: "" },
      { tipo: "outra" },
    ], { tomadaIds: ["frente"], formatos: ["1:1", "4:5"] });
    expect(sug.map((s) => s.tipo)).toEqual(["ajuste_tomada", "tomada_nova", "prompt", "busca_referencia"]);
    const ctx = { kit: kitProduto(), refs: [ref(1, "identidade", "tres_quartos_direito")], receita: receitaPorId("tecnologia"), formatos: lerFormatos(["1:1", "4:5"]) };
    const tomadas = montarTomadas(receitaPorId("tecnologia")!, [], ctx);
    const ajustada = aplicarSugestaoDeTomada(tomadas, sug[0], ctx);
    expect(ajustada.tomada.luz).toBe("contraluz suave");
    expect(ajustada.tomada.modo).toBe("cenario");
    expect(ajustada.tomadas).toHaveLength(tomadas.length);
    const nova = aplicarSugestaoDeTomada(tomadas, sug[1], ctx);
    expect(nova.tomadas).toHaveLength(tomadas.length + 1);
    expect(nova.tomada).toMatchObject({ nome: "Detalhe do scroll", formato: "1:1", gerado: true });
    expect(() => aplicarSugestaoDeTomada(tomadas, sug[2], ctx)).toThrow(ErroDeRegra);
  });

  it("travessão vira vírgula", () => {
    expect(semTravessao("luz \u2014 sombra")).toBe("luz, sombra");
  });
});

// ------------------------------------------------------------------ contratos da função

describe("função mesa-foto (contrato pelo código)", () => {
  const ACOES_DO_CONTRATO = [
    "acervo_registrar", "acervo_ler_foto", "kit_sugerir", "kit_salvar", "receitas", "ensaio_planejar", "tomada_gerar", "preparar",
    "versao_conferir", "versao_decidir", "enviar", "baixar", "biblioteca_salvar", "referencias_buscar", "referencia_importar",
    "agente_conversar", "agente_aplicar",
  ];
  const mapa = fonte.slice(fonte.indexOf("const ACOES:"), fonte.indexOf("const ACOES_LONGAS"));
  const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("Deno.serve"));

  it("tem todas as ações do contrato, e as de IA respondem com fôlego", () => {
    for (const a of ACOES_DO_CONTRATO) expect(mapa, a).toMatch(new RegExp(`\\b${a}\\b`));
    for (const a of ["acervo_ler_foto", "kit_sugerir", "ensaio_planejar", "tomada_gerar", "versao_conferir", "preparar", "agente_conversar"]) {
      expect(longas, a).toContain(`"${a}"`);
    }
    expect(fonte).toContain('from "../_shared/resposta-com-folego.ts"');
  });

  it("toda chamada de texto usa 300 s e tarefas e agentes aceitos pelo banco", () => {
    expect(fonte).toContain("const TIMEOUT_TEXTO_FOTO_MS = 300_000;");
    const chamadas = fonte.split("chamarTexto({").length - 1;
    expect(chamadas).toBeGreaterThanOrEqual(5);
    expect(fonte.split("timeoutMs: TIMEOUT_TEXTO_FOTO_MS").length - 1).toBe(chamadas);
    const migracaoAds = ler("supabase/migrations/20260924015930_mesa_ads.sql");
    const aceitos = (nome: string) => {
      const m = migracaoAds.match(new RegExp(`${nome} CHECK \\((\\w+) = ANY \\(ARRAY\\[([^\\]]+)\\]`));
      return (m?.[2] ?? "").split(",").map((x) => x.trim().replace(/'/g, ""));
    };
    const tarefas = aceitos("ia_usos_tarefa_check");
    const agentes = aceitos("ia_usos_agente_check");
    for (const [, v] of fonte.matchAll(/const TAREFA_\w+ = "(\w+)" as const/g)) expect(tarefas, v).toContain(v);
    for (const [, v] of fonte.matchAll(/const AGENTE_(?:DIRETOR|LEITOR|GERADOR) = "(\w+)" as const/g)) expect(agentes, v).toContain(v);
  });

  it("sem laço de correção: gerar chama o gerador uma vez; conferir não gera; Jev só como aviso", () => {
    const gerar = corpoDe(fonte, "tomadaGerar");
    expect(gerar.split("chamarImagem(").length - 1).toBe(1);
    expect(gerar).not.toMatch(/\bwhile\b|\bfor \(/);
    const conferir = corpoDe(fonte, "versaoConferir");
    expect(conferir).not.toContain("chamarImagem(");
    expect(conferir).toContain('type: "noul"');
    expect(conferir).toContain("aviso:");
    expect(conferir).toContain("catch (e)");
  });

  it("fontes do kit na ordem e referência de estilo depois delas", () => {
    const gerar = corpoDe(fonte, "tomadaGerar");
    expect(gerar).toContain("fontesDaTomada(refs, tomada, limite)");
    expect(gerar).toContain("referencias: [...imagensFontes, ...pessoaAprovada, ...estilos.map((e) => e.imagem)]");
    // Bloqueio recalculado com o kit de agora, e a câmera escolhida na tela vale para a tomada.
    expect(gerar).toContain("cameraPedida ?? salva.camera");
    expect(gerar).toContain("lerCamera(corpo.camera)");
    expect(gerar).toContain("if (tomada.motivo_bloqueio) throw");
  });

  it("alinhado com a tela (frente B)", () => {
    const gerar = corpoDe(fonte, "tomadaGerar");
    expect(gerar).toContain('comStatus(t, "gerando"');
    expect(gerar).toContain('comStatus(t, "falhou", { ultimo_erro: mensagem })');
    expect(gerar).toContain("decisao: null");
    const planejar = corpoDe(fonte, "ensaioPlanejar");
    expect(planejar).toContain("corpo.tomadas_pedidas");
    expect(planejar).toContain('"tomada_desconhecida"');
    const importar = corpoDe(fonte, "referenciaImportar");
    expect(importar).toContain("corpo.referencia");
    expect(importar).toContain("autor_url:");
    expect(importar).toContain("r.licenca_rotulo");
    expect(corpoDe(fonte, "bibliotecaSalvar")).toContain("bruto.origem_id");
    expect(corpoDe(fonte, "anexosDaConversa")).toContain("o.imagem_id");
    expect(corpoDe(fonte, "preparar")).toContain("lerGuia(corpo.guia)");
  });

  it("preparar preserva: recorte com pixels originais, áreas protegidas de volta e erro explícito sem fundo transparente", () => {
    const p = corpoDe(fonte, "preparar");
    for (const trecho of [
      'fundo: "transparente"', "aceitaFundoTransparente(mImg)", '"fundo_transparente_nao_suportado"', "recortePreservandoOriginal(o, g, volta.tela)", "devolverOriginalNasAreas(",
      "mascaraProtegendo(", '"recorte_ou_area_necessaria"', '"fundo_nao_veio_transparente"', "tamanhoFixo: true", "derivada_de: imagem.id",
    ]) expect(p, trecho).toContain(trecho);
    expect(imagemFonte).toContain("devolverOriginalForaDasAreas(original, gerado, complementoDasAreas(protegidas)");
    expect(imagemFonte).toContain('from "../_shared/imagem-local.ts"');
  });

  it("aprovar cria a derivada no acervo com linhagem; enviar usa create_file_record e a revisão da agência", () => {
    const d = corpoDe(fonte, "versaoDecidir");
    for (const t of ["aprovada: true", "gerada: true", "derivada_de: origem", "kit_id: kit.id", "modo: v.modo"]) expect(d, t).toContain(t);
    const e = corpoDe(fonte, "enviar");
    expect(e).toContain('ch.doChamador.rpc("create_file_record"');
    expect(e).toContain('ch.doChamador.rpc("request_file_agency_review"');
    expect(e).toContain('destino === "aprovacao" ? "materiais" : "base"');
    expect(e).toContain("idempotency_key: chave");
    expect(corpoDe(fonte, "baixarFotos")).toContain("urlAssinada(");
  });

  it("Openverse sem chave, com tempo limite e 429 explicado; agente grava em agente_conversas", () => {
    const b = corpoDe(fonte, "buscarNoOpenverse");
    expect(b).toContain("AbortSignal.timeout(TIMEOUT_BUSCA_MS)");
    expect(b).toContain("res.status === 429");
    expect(b).not.toMatch(/Authorization|api_key|token/i);
    const a = fonte.slice(fonte.indexOf("async function conversaDoAgente"), fonte.indexOf("async function agenteAplicar"));
    expect(a).toContain('from("agente_conversas")');
    expect(a).toContain('from("agente_mensagens")');
    expect(a).toContain("referencia_tipo: REF_CONVERSA");
  });

  it("motor aceita fundo transparente só no GPT Image e recusa antes de cobrar", () => {
    expect(motor).toContain("export function aceitaFundoTransparente(");
    expect(motor).toContain('form.append("background", "transparent")');
    expect(motor).toContain('corpo.background = "transparent"');
    expect(motor).toContain('if (e.fundo === "transparente" && !aceitaFundoTransparente(rota.m)) throw erroFundoTransparente(rota.m);');
  });

  it("config e textos sem travessão", () => {
    expect(config).toMatch(/\[functions\.mesa-foto\]\s*\n\s*verify_jwt = true/);
    for (const [nome, texto] of Object.entries({ index: fonte, calculos: calculosFonte, receitas: receitasFonte, imagem: imagemFonte, sql })) {
      expect(texto, nome).not.toMatch(/[\u2014\u2013]/);
    }
  });
});

// ------------------------------------------------------------------ SQL

describe("SQL da Mesa Foto", () => {
  it("acervo ganha as colunas do contrato e aceita origem mesa_foto", () => {
    for (const c of ["derivada_de uuid", "gerada boolean NOT NULL DEFAULT false", "modo text", "kit_id uuid", "sha256 text", "largura integer", "altura integer", "aprovada boolean NOT NULL DEFAULT false"]) {
      expect(sql, c).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
    expect(sql).toContain("CHECK (origem IN ('workspace', 'arquivo', 'upload', 'mesa_foto'))");
    expect(sql).toContain("modo IN ('preservar', 'luz_cor', 'cenario', 'angulo', 'ensaio')");
    expect(sql).toContain("cliente_imagens_sha256_unico ON public.cliente_imagens (client_id, sha256)");
    expect(sql).toContain("GRANT UPDATE (nome, pasta, categoria, tags, descricao, ativa) ON public.cliente_imagens TO authenticated;");
  });

  it("cria kits, referências, ensaios e biblioteca com RLS de leitura da equipe", () => {
    for (const t of ["foto_kits", "foto_kit_refs", "foto_ensaios", "foto_biblioteca"]) {
      expect(sql, t).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`);
      expect(sql, t).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql, t).toMatch(new RegExp(`CREATE POLICY ${t}_equipe_le ON public\\.${t} FOR SELECT TO authenticated`));
    }
    expect(sql).toContain("CONSTRAINT foto_kit_refs_unico UNIQUE (kit_id, imagem_id, papel)");
    expect(sql).toContain("FOREIGN KEY (imagem_id, client_id) REFERENCES public.cliente_imagens (id, client_id)");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*foto_[a-z_]+[^;]*TO authenticated/);
  });

  it("biblioteca tem uso e categorias da pesquisa (com cenario) e aceita a semente", () => {
    expect(sql).toContain("'produto', 'alimento', 'bebida', 'cosmetico', 'moda', 'tecnologia', 'pessoa', 'ambiente', 'estilo', 'composicao', 'luz', 'cenario'");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS uso text");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS autor_url text");
    expect(normalizarItemBiblioteca({ tipo: "referencia", categoria: "estilo", titulo: "x", imagem_url: "https://a.b/c.jpg", autor_url: "https://a.b/autor" }).autor_url).toBe("https://a.b/autor");
    const semente = ler("docs/mesa-foto/biblioteca/seed.sql");
    const colunas = semente.match(/insert into public\.foto_biblioteca\s*\(([^)]+)\)/i)![1].split(",").map((c) => c.trim());
    const tabela = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS public.foto_biblioteca"), sql.indexOf("-- Quem criou a tabela"));
    for (const c of colunas) expect(tabela, c).toMatch(new RegExp(`\\n\\s+${c} `));
  });

  it("idempotente, original imutável no Storage e sem mexer nos checks de ia_usos", () => {
    expect(sql.match(/CREATE POLICY/g)!.length).toBe(sql.match(/DROP POLICY IF EXISTS/g)!.length);
    expect(sql.match(/CREATE TRIGGER/g)!.length).toBe(sql.match(/DROP TRIGGER IF EXISTS/g)!.length);
    expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(sql).toContain("AS RESTRICTIVE FOR DELETE TO authenticated");
    expect(sql).toContain("NOT COALESCE(storage.objects.bucket_id = 'mesa'");
    expect(sql).not.toMatch(/ia_usos_(tarefa|agente)_check/);
  });
});

describe("a tela (frente B) só pede o que a função e o banco têm", () => {
  const tela = ler("src/components/mesa-foto/fotoApi.ts");
  // As áreas novas registram as ações por arquivo (index só espalha: ...CLONES.acoes, ...BIBLIOTECA_EM_LOTE.acoes).
  const mapa = fonte.slice(fonte.indexOf("const ACOES:"), fonte.indexOf("const ACOES_LONGAS")) + ler("supabase/functions/mesa-foto/biblioteca-lote.ts");

  it("toda ação chamada pela tela existe na função, inclusive acervo_decidir e tomada_editar", () => {
    const chamadas = Array.from(new Set(Array.from(tela.matchAll(/acao: "(\w+)"/g)).map((m) => m[1])));
    expect(chamadas).toEqual(expect.arrayContaining(["acervo_decidir", "tomada_editar", "tomada_gerar", "ensaio_planejar", "versao_decidir", "enviar", "baixar"]));
    for (const a of chamadas) expect(mapa, a).toMatch(new RegExp(`\\b${a}\\b`));
  });

  it("tabelas lidas direto pela tela têm leitura da equipe no SQL; a biblioteca da agência (client_id nulo) também", () => {
    const lidas = Array.from(new Set(Array.from(tela.matchAll(/\.from\("(\w+)"\)/g)).map((m) => m[1]))).filter((t) => t !== "mesa");
    expect(lidas.sort()).toEqual(["cliente_imagens", "foto_biblioteca", "foto_ensaios", "foto_kit_refs", "foto_kits"]);
    expect(sql).toContain("GRANT SELECT ON public.foto_kits, public.foto_kit_refs, public.foto_ensaios, public.foto_biblioteca TO authenticated;");
    expect(sql).toContain("(client_id IS NULL OR public.can_access_client(client_id))");
    expect(tela).toContain(".or(`client_id.is.null,client_id.eq.${clientId}`)");
    // Colunas em que a tela ordena existem nas tabelas novas.
    expect(sql).toMatch(/foto_kits \([\s\S]*?atualizado_em timestamptz/);
    expect(sql).toMatch(/foto_ensaios \([\s\S]*?criado_em timestamptz/);
    expect(sql).toMatch(/foto_biblioteca \([\s\S]*?destaque boolean[\s\S]*?titulo|titulo text[\s\S]*?destaque boolean/);
  });
});

// ================================================================== v2 (docs/mesa-foto/CONTRATO-V2.md)

const sqlV2 = ler("docs/mesa-foto/migrations/02_mesa_foto_v2.sql");

describe("v2: receitas novas e tipos de variação", () => {
  it("fora-da-embalagem e campanha-com-modelo existem, sem pessoa real e com o produto invariante", () => {
    const fora = receitaPorId("fora-da-embalagem")!;
    expect(fora.tomadas.some((t) => t.foco === "fora_da_embalagem")).toBe(true);
    expect(fora.tomadas.some((t) => t.foco === "embalagem")).toBe(true);
    expect(fora.tipos_de_kit).not.toContain("pessoa");
    const campanha = receitaPorId(RECEITA_CAMPANHA)!;
    expect(campanha.tipos_de_kit).not.toContain("pessoa");
    expect(campanha.tomadas.filter((t) => t.com_pessoa === true).length).toBeGreaterThanOrEqual(3);
    expect(campanha.regra).toMatch(/pessoa real conhecida/);
  });

  it("os 10 tipos do contrato têm câmera válida, direção, luz e cenário", () => {
    expect(TIPOS_DE_VARIACAO.map((t) => t.id)).toEqual(expect.arrayContaining([
      "heroi_fundo_cor", "fundo_branco", "lifestyle", "na_mao", "flat_lay", "macro", "cenario_marca", "flutuando", "fora_da_caixa", "com_embalagem",
    ]));
    expect(new Set(TIPOS_DE_VARIACAO.map((t) => t.id)).size).toBe(TIPOS_DE_VARIACAO.length);
    for (const t of TIPOS_DE_VARIACAO) {
      expect(t.cameras.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.luz.length, t.id).toBeGreaterThan(40);
      expect(t.cenario.length, t.id).toBeGreaterThan(30);
    }
    expect(ORDEM_DAS_VARIACOES.every((id) => TIPOS_DE_VARIACAO.some((t) => t.id === id))).toBe(true);
  });

  it("tipo dito pelo diretor em palavras soltas vira o tipo certo", () => {
    expect(tipoDeVariacaoDoTexto("Produto flutuando")!.id).toBe("flutuando");
    expect(tipoDeVariacaoDoTexto("na mão")!.id).toBe("na_mao");
    expect(tipoDeVariacaoDoTexto("tirar da caixa, fora da caixa")!.id).toBe("fora_da_caixa");
    expect(tipoDeVariacaoDoTexto("flat lay")!.id).toBe("flat_lay");
    expect(tipoDeVariacaoDoTexto("")).toBeNull();
  });
});

describe("v2: plano de variações decidido no código", () => {
  const comProduto = { temIdentidade: true, temEmbalagem: true };

  it("8 variações são 8 tipos diferentes, com câmeras e cenários próprios", () => {
    const vagas = planoDeVariacoes(8, null, comProduto);
    expect(vagas).toHaveLength(8);
    expect(new Set(vagas.map((v) => v.tipo.id)).size).toBe(8);
    expect(new Set(vagas.map((v) => v.id)).size).toBe(8);
    expect(vagas.every((v) => v.rodada === 0 && v.mudanca === null)).toBe(true);
  });

  it("16 variações repetem tipo com outra câmera e uma mudança concreta; limite 16", () => {
    const vagas = planoDeVariacoes(16, null, comProduto);
    expect(vagas).toHaveLength(16);
    const heroi = vagas.filter((v) => v.tipo.id === "heroi_fundo_cor");
    expect(heroi).toHaveLength(2);
    expect(heroi[0].camera).not.toEqual(heroi[1].camera);
    expect(heroi[1].mudanca).toBeTruthy();
    expect(heroi[1].id).toBe("heroi_fundo_cor-2");
    expect(planoDeVariacoes(40, null, comProduto)).toHaveLength(16);
    expect(planoDeVariacoes(0, null, comProduto)).toHaveLength(8);
  });

  it("tipos pedidos valem na ordem; sem foto do produto a caixa vira o assunto", () => {
    expect(planoDeVariacoes(3, ["macro", "na_mao", "inexistente"], comProduto).map((v) => v.tipo.id)).toEqual(["macro", "na_mao", "macro"]);
    const soCaixa = planoDeVariacoes(8, null, { temIdentidade: false, temEmbalagem: true });
    expect(soCaixa.some((v) => v.tipo.id === "fora_da_caixa" || v.tipo.id === "com_embalagem")).toBe(false);
    expect(soCaixa.every((v) => v.foco === "embalagem")).toBe(true);
  });

  it("variações escritas pelo diretor viram vagas com id único e câmera válida", () => {
    const vagas = vagasDoDiretor([
      { nome: "Herói azul", tipo: "heroi_fundo_cor", camera: "a0-e0-dmedio", cenario: "fundo azul", luz: "", props: [], formato: "4:5" },
      { nome: "Herói azul", tipo: "heroi_fundo_cor", camera: "nao-existe", cenario: "fundo verde", luz: "", props: [], formato: null },
    ], comProduto);
    expect(vagas.map((v) => v.id)).toEqual(["heroi-azul", "heroi-azul-2"]);
    expect(vagas[0].camera.preset_id).toBe("a0-e0-dmedio");
    expect(vagas[1].camera.preset_id).toBe("a0-e0-dmedio");
    expect(vagas[1].mudanca).toBeTruthy();
  });
});

describe("v2: foco na embalagem, fora da embalagem e referência da internet", () => {
  const kit = kitProduto({ nome: "Mouse NTC X", variante: "preto" });
  const web = { url: "https://loja.exemplo.com.br/img/mouse.jpg", pagina: "https://loja.exemplo.com.br/mouse-ntc-x", fonte: "loja.exemplo.com.br" };

  it("só caixa: a caixa como assunto gera; fora da embalagem bloqueia pedindo identificar o produto", () => {
    const caixa = [ref(1, "embalagem", "frente")];
    expect(motivoDoBloqueio(kit, caixa, null, "embalagem")).toBeNull();
    expect(motivoDoBloqueio(kit, caixa, null, "fora_da_embalagem")).toMatch(/Identificar produto/);
    expect(motivoDoBloqueio(kit, [ref(1, "identidade")], null, "embalagem")).toMatch(/embalagem/);
    const t = montarTomada({ id: "c", nome: "Caixa", camera: cameraDoPreset("a0-e0-dmedio"), foco: "embalagem" }, { kit, refs: caixa, receita: null, formatos: ["4:5"] });
    expect(t).toMatchObject({ bloqueada: false, modo: "cenario", foco: "embalagem" });
    expect(t.invariantes.join(" ")).toMatch(/arte, cores, textos e logotipos/);
    const p = promptDaTomada({ kit, tomada: t, finalidade: "", marca: { nome: "X" }, fontes: caixa, estilos: [], guiaTexto: null, versoesAntes: 0, rejeicoes: [] });
    expect(p).toContain("A caixa é o herói desta foto");
    expect(p).toContain("EMBALAGEM real, que é o ASSUNTO");
  });

  it("fora da embalagem: a arte da caixa nunca entra como fonte; foto real antes da referência da internet", () => {
    const refs: RefDoKit[] = [{ ...ref(1, "identidade", "frente"), origem_web: web }, ref(2, "identidade", "frente"), ref(3, "embalagem")];
    const fontes = fontesDaTomada(refs, { camera: cameraDoPreset("a0-e0-dmedio"), exige: { papeis: ["embalagem"], descricao: "caixa" }, foco: "fora_da_embalagem" }, 8);
    expect(fontes.map((f) => f.imagem_id)).toEqual([IMG(2), IMG(1)]);
    const caixaPrimeiro = fontesDaTomada(refs, { camera: cameraDoPreset("a0-e0-dmedio"), exige: null, foco: "embalagem" }, 8);
    expect(caixaPrimeiro[0].imagem_id).toBe(IMG(3));
    const t = montarTomada({ id: "f", nome: "Fora", camera: cameraDoPreset("a0-e0-dmedio"), foco: "fora_da_embalagem", tipo_variacao: "fora_da_caixa" }, { kit, refs, receita: null, formatos: ["4:5"] });
    const p = promptDaTomada({ kit, tomada: t, finalidade: "loja", marca: { nome: "X" }, fontes, estilos: [], guiaTexto: null, versoesAntes: 0, rejeicoes: [] });
    expect(p).toContain("FORA DA EMBALAGEM");
    expect(p).toContain("Nunca desenhe o produto a partir da arte impressa na caixa");
    expect(p).toContain("achada na internet (loja.exemplo.com.br)");
    expect(p).toContain("FIDELIDADE DO PRODUTO");
  });

  it("origem da internet vai e volta pela descrição do acervo", () => {
    const d = descricaoDaReferenciaWeb(web, "Mouse NTC X");
    expect(d).toContain("não publicar");
    expect(lerOrigemWeb(["mesa_foto", "referencia_web", "fonte:loja.exemplo.com.br"], d)).toEqual(web);
    expect(lerOrigemWeb(["mesa_foto"], d)).toBeNull();
  });

  it("imagens da página: og:image, twitter, JSON-LD; só https público; relativas viram absolutas", () => {
    const html = `<html><head>
      <meta property="og:image" content="/media/mouse-front.jpg">
      <meta name="twitter:image" content="https://cdn.exemplo.com/mouse.webp">
      <meta property="og:image" content="http://inseguro.com/x.jpg">
      <script type="application/ld+json">{"@type":"Product","image":["https://cdn.exemplo.com/a.jpg",{"url":"https://127.0.0.1/b.jpg"}],"offers":{"image":"https://cdn.exemplo.com/c.png"}}</script>
    </head></html>`;
    expect(imagensDoHtml(html, "https://loja.exemplo.com.br/p/1")).toEqual([
      "https://loja.exemplo.com.br/media/mouse-front.jpg", "https://cdn.exemplo.com/mouse.webp", "https://cdn.exemplo.com/a.jpg", "https://cdn.exemplo.com/c.png",
    ]);
    expect(referenciaWebServe({ largura: 1200, altura: 1200 })).toBe(true);
    expect(referenciaWebServe({ largura: 200, altura: 200 })).toBe(false);
    expect(referenciaWebServe({ largura: 3000, altura: 500 })).toBe(false);
    expect(referenciaWebServe(null)).toBe(false);
  });
});

describe("v2: kit sugerido vira rascunho salvo, sem duplicar", () => {
  const base = { tipo: "tecnologia" as const, invariantes: [], autorizacao: null, frente_imagem_id: null, status: "rascunho" as const };

  it("acha o rascunho do mesmo produto pelo nome ou por foto em comum; confirmado não é reaproveitado", () => {
    const existentes = [
      { id: "k1", status: "confirmado", nome: "Mouse NTC X", variante: "Preto", refs: [] },
      { id: "k2", status: "rascunho", nome: "mouse ntc x", variante: "preto", refs: [], atualizado_em: "2026-09-24T10:00:00Z" },
      { id: "k3", status: "rascunho", nome: "Caixas", variante: null, refs: [{ imagem_id: IMG(9), papel: "embalagem" }], atualizado_em: "2026-09-24T11:00:00Z" },
    ];
    expect(kitParecido(existentes, { nome: "Mouse NTC X", variante: "Preto", refs: [] })!.id).toBe("k2");
    expect(kitParecido(existentes, { nome: "Outro nome", variante: null, refs: [{ imagem_id: IMG(9), papel: "embalagem" }] })!.id).toBe("k3");
    expect(kitParecido(existentes, { nome: "Outro nome", variante: null, refs: [{ imagem_id: IMG(9), papel: "estilo" }] })).toBeNull();
    expect(kitParecido(existentes.slice(0, 1), { nome: "Mouse NTC X", variante: "Preto", refs: [] })).toBeNull();
  });

  it("mescla soma referências, guarda o informado e refaz as lacunas de evidência", () => {
    const existente = {
      ...base, nome: "Caixas do mouse", variante: null,
      atributos: { observado: ["caixa azul"], informado: ["cliente disse: cor preta"], inferido: [] },
      lacunas: [LACUNA_SO_CAIXA, "Vista inferior"], refs: [ref(9, "embalagem")],
    };
    const identificacao = normalizarIdentificacao({ marca: "NTC", modelo: "X", confianca: "alta", paginas: ["https://ntc.com.br/x", "http://inseguro"] })!;
    expect(identificacao.paginas).toEqual([{ url: "https://ntc.com.br/x", fonte: "ntc.com.br" }]);
    const novo = {
      ...base, nome: "NTC X", variante: "preto",
      atributos: { observado: ["caixa azul", "texto NTC X"], informado: [], inferido: ["Pela internet: 1600 dpi"], identificacao },
      lacunas: [], refs: [{ ...ref(20, "identidade"), origem_web: { url: "https://ntc.com.br/x.jpg", pagina: null, fonte: "ntc.com.br" } }],
    };
    const m = mesclarKit(existente, novo, { preferirNomeNovo: true, refsWeb: [IMG(20)] });
    expect(m.nome).toBe("NTC X");
    expect(m.refs.map((r) => r.imagem_id)).toEqual([IMG(9), IMG(20)]);
    expect(m.atributos.informado).toEqual(["cliente disse: cor preta"]);
    expect(m.atributos.observado).toEqual(["caixa azul", "texto NTC X"]);
    expect(m.atributos.identificacao!.marca).toBe("NTC");
    expect(m.lacunas).toContain(LACUNA_SO_WEB);
    expect(m.lacunas).not.toContain(LACUNA_SO_CAIXA);
    expect(m.lacunas).toContain("Vista inferior");
    expect(lacunasDaEvidencia({ tipo: "produto", lacunas: [] }, [ref(1, "embalagem")], [])).toEqual([LACUNA_SO_CAIXA]);
    expect(lacunasDaEvidencia({ tipo: "produto", lacunas: [LACUNA_SO_CAIXA] }, [ref(1, "identidade")], [])).toEqual([]);
  });

  it("kit_salvar guarda a identificação da internet no kit", () => {
    const k = normalizarKit({ tipo: "produto", nome: "NTC X", atributos: { observado: [], identificacao: { marca: "NTC", modelo: "X", confianca: "media" } } });
    expect(k.atributos.identificacao).toMatchObject({ marca: "NTC", modelo: "X", confianca: "media" });
    expect(normalizarKit({ tipo: "produto", nome: "Y", atributos: { identificacao: { confianca: "alta" } } }).atributos.identificacao).toBeUndefined();
  });
});

describe("v2: campanha com pessoa sintética", () => {
  const kit = kitProduto({ tipo: "moda", nome: "Óculos Aurora", variante: "armação prata" });
  const refs = [ref(1, "identidade", "frente")];

  it("pessoa sintética é adulta e pedido de sósia sai com aviso", () => {
    const m = lerModeloSintetico({ perfil: "mulher parecida com a atriz Fulana, cabelo cacheado", idade_aprox: 16, estilo: "urbano" });
    expect(m.idade_aprox).toBe(21);
    expect(m.perfil).not.toMatch(/parecida/i);
    expect(m.perfil).toContain("cabelo cacheado");
    expect(m.avisos.length).toBe(2);
    expect(lerModeloSintetico(null)).toMatchObject({ idade_aprox: 30, avisos: [] });
  });

  it("fotos da campanha: enquadramento vira câmera; guia de estilo normalizado", () => {
    const fotos = lerFotosDeCampanha([
      { nome: "Retrato céu azul", enquadramento: "close", cenario: "céu azul com nuvens", com_pessoa: true, formato: "4:5" },
      { nome: "Flutuando", enquadramento: "medio", cenario: "formas prateadas", com_pessoa: false, camera: "a0-e0-dmedio" },
      { nome: "" },
    ], ["4:5", "9:16"]);
    expect(fotos).toHaveLength(2);
    expect(cameraDaCampanha(fotos[0]).preset_id).toBe("a0-e0-ddetalhe");
    expect(cameraDaCampanha(fotos[1]).preset_id).toBe("a0-e0-dmedio");
    expect(normalizarGuiaDeEstilo({ resumo: "", paleta: [] })).toBeNull();
    expect(normalizarGuiaDeEstilo({ resumo: "Editorial solar", paleta: ["azul céu #8EC5FF"], luz: "sol filtrado" })!.paleta).toEqual(["azul céu #8EC5FF"]);
  });

  it("prompt de campanha: pessoa sintética, produto invariante, mãos, guia só como direção e a mesma modelo aprovada", () => {
    const t = montarTomada(
      { id: "r", nome: "Retrato", camera: cameraDoPreset("a0-e0-ddetalhe"), campanha: { com_pessoa: true, acao: "ajusta os óculos no rosto", expressao: "sorriso leve", figurino: "camisa branca" } },
      { kit, refs, receita: receitaPorId(RECEITA_CAMPANHA), formatos: ["4:5"] },
    );
    expect(t.lente).toContain("85 mm");
    expect(t.proibicoes).toEqual(expect.arrayContaining(PROIBICOES_PESSOA_SINTETICA));
    const p = promptDaCampanha({
      kit, tomada: t, finalidade: "campanha", marca: { nome: "Ótica X", paleta: ["#1E3A8A"] }, fontes: refs,
      estilos: [{ titulo: "print do perfil" }], guiaTexto: null, versoesAntes: 0, rejeicoes: [],
      guiaDeEstilo: normalizarGuiaDeEstilo({ resumo: "Editorial surreal", paleta: ["azul"], luz: "estúdio azul" }),
      modelo: lerModeloSintetico({ perfil: "homem negro de 30 anos", estilo: "minimalista" }), pessoaAprovada: true,
    });
    for (const trecho of [
      "PESSOA SINTÉTICA", "não existe", "sem parecer celebridade", "cinco dedos", "PRODUTO (invariante)", "ajusta os óculos no rosto",
      "Imagem 1: IDENTIDADE", "Imagem 2: SÓ A PESSOA SINTÉTICA", "Imagem 3: SÓ ESTILO", "GUIA DE ESTILO DA CAMPANHA", "Só direção",
      "retrato de perto", "homem negro de 30 anos", "nunca escurecer",
    ]) expect(p, trecho).toContain(trecho);
    expect(p).not.toMatch(/[\u2014\u2013]/);
    // promptDaTomada encaminha a tomada de campanha para o prompt de campanha.
    expect(promptDaTomada({ kit, tomada: t, finalidade: "", marca: { nome: "X" }, fontes: refs, estilos: [], guiaTexto: null, versoesAntes: 0, rejeicoes: [] })).toContain("PESSOA SINTÉTICA");
    expect(criteriosDaConferencia("moda", { comPessoaSintetica: true })).toEqual(expect.arrayContaining(["Mãos com anatomia correta"]));
    expect(criteriosDaConferencia("moda", { embalagem: true })[0]).toMatch(/Embalagem igual/);
  });

  it("variações: direção de arte, mão adulta e produto flutuando com a sombra certa", () => {
    const mao = montarTomada({ id: "m", nome: "Na mão", camera: cameraDoPreset("a45-e0-dmedio"), tipo_variacao: "na_mao", props: ["caneca"], mudanca: "outra hora do dia" },
      { kit, refs, receita: null, formatos: ["4:5"] });
    const pm = promptDaTomada({ kit, tomada: mao, finalidade: "", marca: { nome: "X" }, fontes: refs, estilos: [], guiaTexto: null, versoesAntes: 0, rejeicoes: [] });
    expect(pm).toContain("DIREÇÃO DE ARTE: Na mão");
    expect(pm).toContain("Objetos de cena: caneca");
    expect(pm).toContain("outra hora do dia");
    expect(pm).toContain("MÃO: mão adulta natural");
    const voa = montarTomada({ id: "v", nome: "Voa", camera: cameraDoPreset("a45-e-30-dmedio"), tipo_variacao: "flutuando" }, { kit, refs, receita: null, formatos: ["4:5"] });
    const pv = promptDaTomada({ kit, tomada: voa, finalidade: "", marca: { nome: "X" }, fontes: refs, estilos: [], guiaTexto: null, versoesAntes: 0, rejeicoes: [] });
    expect(pv).toContain("flutua de propósito");
    expect(pv).not.toContain("nada de sombra dupla nem assunto flutuando");
  });
});

describe("v2: sugestões novas do diretor", () => {
  const KIT = "33333333-3333-4333-8333-333333333333";
  it("plano de variações e campanha só com kit do cliente; identificar produto só com fotos", () => {
    const sug = normalizarSugestoes([
      { tipo: "plano_de_variacoes", kit_id: KIT, variacoes: [{ nome: "Herói", tipo: "heroi_fundo_cor", camera: "a0-e0-dmedio", cenario: "azul", luz: "", props: [], formato: "4:5" }] },
      { tipo: "plano_de_variacoes", kit_id: OUTRO, quantidade: 8, variacoes: [] },
      { tipo: "campanha", kit_id: null, quantidade: 4, fotos: [], modelo: { idade_aprox: 17 }, guia_de_estilo: { resumo: "surreal" }, referencias_estilo_ids: [IMG(1), "x"] },
      { tipo: "identificar_produto", imagem_ids: [IMG(1), IMG(1), "nao-uuid"] },
      { tipo: "identificar_produto", imagem_ids: [] },
    ], { tomadaIds: [], kitIds: [KIT], kitPadrao: null });
    expect(sug.map((s) => s.tipo)).toEqual(["plano_de_variacoes", "identificar_produto"]);
    expect(sug[0]).toMatchObject({ kit_id: KIT, quantidade: 1 });
    expect(sug[1].imagem_ids).toEqual([IMG(1)]);
    const comKitAberto = normalizarSugestoes([
      { tipo: "campanha", kit_id: OUTRO, quantidade: 4, fotos: [], modelo: { idade_aprox: 17 }, guia_de_estilo: { resumo: "surreal" }, referencias_estilo_ids: [IMG(1), "x"] },
    ], { tomadaIds: [], kitIds: [KIT], kitPadrao: KIT });
    expect(comKitAberto[0]).toMatchObject({ kit_id: KIT, quantidade: 4, referencias_estilo_ids: [IMG(1)] });
    expect(comKitAberto[0].modelo!.idade_aprox).toBe(21);
  });
});

describe("v2: biblioteca ilustrada", () => {
  it("termos de busca concretos, sem jargão, com a categoria em inglês; busca só de fotografia", () => {
    expect(termosDeBusca({ categoria: "bebida", prompt_en: "Professional photo of an iced coffee glass on marble, soft window light, 85mm lens" })).toBe("iced coffee glass marble drink");
    expect(termosDeBusca({ categoria: "cosmetico", prompt_en: null, tags: ["sérum", "frasco"] })).toBe("serum frasco cosmetics");
    const u = new URL(urlDoOpenverse("coffee", "comercial", 1, { categoria: "photograph", porPagina: 12 }));
    expect(u.searchParams.get("category")).toBe("photograph");
    expect(u.searchParams.get("license_type")).toBe("commercial");
    expect(u.searchParams.get("page_size")).toBe("12");
  });

  it("exemplo gerado usa produto genérico sem marca e as regras da pessoa sintética", () => {
    const p = promptDoExemplo({ categoria: "pessoa", titulo: "Retrato editorial", prompt_en: "editorial portrait, rim light", negativo: "plastic skin" });
    expect(p).toContain("pessoa sintética adulta");
    expect(p).toContain("Sem marca, sem logotipo");
    expect(p).toContain("EVITE: plastic skin");
    expect(p).toContain("editorial portrait, rim light");
  });

  it("SQL 02 cria miniatura_url e exemplo, idempotente e sem travessão", () => {
    expect(sqlV2).toContain("ADD COLUMN IF NOT EXISTS miniatura_url text");
    expect(sqlV2).toContain("ADD COLUMN IF NOT EXISTS exemplo jsonb");
    expect(sqlV2).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(sqlV2).not.toMatch(/[\u2014\u2013]/);
  });
});

describe("v2: contratos da função pelo código", () => {
  const mapa = fonte.slice(fonte.indexOf("const ACOES:"), fonte.indexOf("const ACOES_LONGAS"));
  const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("Deno.serve"));

  it("ações novas existem e respondem com fôlego (inclusive agente_aplicar, que pode identificar o produto)", () => {
    for (const a of ["produto_identificar", "variacoes_planejar", "campanha_planejar", "biblioteca_ilustrar", "biblioteca_exemplo_gerar"]) {
      expect(mapa, a).toMatch(new RegExp(`\\b${a}\\b`));
      expect(longas, a).toContain(`"${a}"`);
    }
    expect(longas).toContain('"agente_aplicar"');
  });

  it("produto_identificar: visão com pesquisa web em 300 s, download seguro para foto/web e Jev só como aviso", () => {
    const p = corpoDe(fonte, "produtoIdentificar");
    for (const t of [
      "pesquisaWeb: true", "timeoutMs: TIMEOUT_TEXTO_FOTO_MS", "imagensDoHtml(", "baixarReferenciaWeb(", 'type: "choice"', "cobrarJev(", "salvarKitRascunho(",
      "MAX_REFERENCIAS_WEB", "catch (e)",
    ]) expect(p, t).toContain(t);
    expect(p).not.toContain("chamarImagem(");
    const b = corpoDe(fonte, "baixarReferenciaWeb");
    for (const t of ["buscarSeguro(", "mimeDe(", "referenciaWebServe(", "/foto/web/", "TAG_REFERENCIA_WEB", "descricaoDaReferenciaWeb(", "sha256"]) expect(b, t).toContain(t);
    expect(corpoDe(fonte, "lerPagina")).toContain("buscarSeguro(");
  });

  it("kit_sugerir salva rascunho e kit_salvar não duplica o mesmo produto", () => {
    expect(corpoDe(fonte, "kitSugerir")).toContain("salvarKitRascunho(");
    expect(corpoDe(fonte, "kitSugerir")).toContain("kit_ids");
    const s = corpoDe(fonte, "kitSalvar");
    expect(s).toContain("kitParecido(");
    expect(s).toContain("anterior?.atributos.identificacao");
    expect(corpoDe(fonte, "salvarKitRascunho")).toContain('"ja_confirmado"');
  });

  it("diretor proativo com os tipos novos; agente_aplicar cria o ensaio", () => {
    expect(fonte).toContain('"identificar_produto", "plano_de_variacoes", "campanha"');
    expect(fonte).toContain('Nunca recuse porque "só tem a caixa"');
    expect(fonte).toContain("Entendi:");
    const a = corpoDe(fonte, "agenteAplicar");
    for (const t of ['s.tipo === "identificar_produto"', 's.tipo === "plano_de_variacoes"', 's.tipo === "campanha"', "gravarEnsaioNovo(", "criarEnsaioDeCampanha(", "estimativa_usd"]) {
      expect(a, t).toContain(t);
    }
    expect(corpoDe(fonte, "agenteConversar")).toContain("kits_do_cliente");
    expect(corpoDe(fonte, "conversaDoAgente")).toContain("abrirNova");
  });

  it("variações e campanha: guia de estilo por visão, receitas certas, custo antes", () => {
    const v = corpoDe(fonte, "variacoesPlanejar");
    for (const t of ["planoDeVariacoes(", "RECEITA_VARIACOES", "estimarEnsaio(", "resolverReferenciasDeEstilo("]) expect(v, t).toContain(t);
    const c = corpoDe(fonte, "campanhaPlanejar");
    for (const t of ["resolverReferenciasDeEstilo(", "ESQUEMA_CAMPANHA", "lerModeloSintetico(", "criarEnsaioDeCampanha("]) expect(c, t).toContain(t);
    const e = corpoDe(fonte, "criarEnsaioDeCampanha");
    for (const t of ["RECEITA_CAMPANHA", "guia_de_estilo: d.guia", "sintetica: true", "estimativa_usd"]) expect(e, t).toContain(t);
    expect(corpoDe(fonte, "ensaioPlanejar")).toContain("campanhaPlanejar(ch");
  });

  it("tomada_gerar entende campanha: referências de estilo do ensaio e a pessoa já aprovada", () => {
    const g = corpoDe(fonte, "tomadaGerar");
    for (const t of ["referenciasDeEstiloDoEnsaio(ensaio)", "aprovadaComPessoa", "...camposV2(salva)", "guiaDeEstilo: normalizarGuiaDeEstilo(", "PROMESSA_CAMPANHA"]) {
      expect(g, t).toContain(t);
    }
  });

  it("referência da internet não sai para o cliente; foto aprovada de campanha é marcada pessoa sintética", () => {
    expect(corpoDe(fonte, "enviar")).toContain('"referencia_web_nao_publica"');
    expect(corpoDe(fonte, "versaoDecidir")).toContain('"pessoa_sintetica"');
  });

  it("biblioteca: ilustrar é só admin, sem IA paga, com pausa pelo limite do Openverse; exemplo gerado cobra uma imagem", () => {
    const i = corpoDe(fonte, "bibliotecaIlustrar");
    for (const t of ["garantirAdmin(ch)", 'categoria: "photograph"', "res.status === 429", "esperar(3_100)", "pendentes", "TAG_EXEMPLO_PUBLICO", "prompt_origem"]) {
      expect(i, t).toContain(t);
    }
    expect(i).not.toMatch(/chamarImagem\(|chamarTexto\(/);
    const g = corpoDe(fonte, "bibliotecaExemploGerar");
    expect(g.split("chamarImagem(").length - 1).toBe(1);
    expect(g).toContain("TAG_EXEMPLO_GERADO");
    expect(g).toContain("biblioteca/exemplos/");
    expect(g).toContain("ehAdmin(ch)");
  });
});

describe("v2: ajustes do cartão e blocos da resposta", () => {
  const ctx = { temIdentidade: true, temEmbalagem: true };
  const v = (nome: string, tipo: string) => ({ nome, tipo, camera: null, cenario: nome, luz: "", props: [], formato: null });
  it("quantidade do cartão completa com tipos ainda não usados ou corta a lista do diretor", () => {
    const vagas = vagasDoPlano([v("Herói", "heroi_fundo_cor"), v("Mão", "na_mao")], 5, null, ctx);
    expect(vagas).toHaveLength(5);
    expect(vagas.slice(0, 2).map((x) => x.tipo.id)).toEqual(["heroi_fundo_cor", "na_mao"]);
    expect(new Set(vagas.map((x) => x.tipo.id)).size).toBe(5);
    expect(new Set(vagas.map((x) => x.id)).size).toBe(5);
    expect(vagasDoPlano([v("A", "macro"), v("B", "macro"), v("C", "macro")], 2, null, ctx)).toHaveLength(2);
    expect(vagasDoPlano([], 3, ["flat_lay"], ctx).map((x) => x.tipo.id)).toEqual(["flat_lay", "flat_lay", "flat_lay"]);
    const s = normalizarSugestoes([{ tipo: "plano_de_variacoes", kit_id: IMG(7), quantidade: 12, tipos: ["macro", "x"], variacoes: [v("Herói", "heroi_fundo_cor")] }], { tomadaIds: [], kitIds: [IMG(7)] });
    expect(s[0]).toMatchObject({ quantidade: 12, tipos: ["macro"] });
  });

  it("Entendi e Próximo passo saem da resposta do diretor", () => {
    const b = blocosDaResposta("Entendi: vi duas caixas do mouse NTC X, vou trabalhar com ele.\nPlano: 8 variações.\nPróximo passo: identificar o produto.");
    expect(b).toEqual({ entendi: "vi duas caixas do mouse NTC X, vou trabalhar com ele.", proximo_passo: "identificar o produto." });
    expect(blocosDaResposta("texto solto")).toEqual({ entendi: "", proximo_passo: "" });
  });
});
// ------------------------------------------------------------------ Modelos e Canvas (MODELOS-E-CANVAS.md)

const modelosFonte = ler("supabase/functions/mesa-foto/modelos.ts");
const canvasFonte = ler("supabase/functions/mesa-foto/canvas.ts");
const sql03 = ler("docs/mesa-foto/migrations/03_modelos_canvas.sql");

const fichaBase = { idade_aparente: 29, tom_de_pele: "morena clara com subtom quente", rosto: "oval", olhos: "castanhos amendoados", cabelo: { cor: "castanho escuro", comprimento: "ombro", textura: "ondulado" }, marcas: ["sardas leves no nariz"] };

describe("personas: ficha, idade mínima e o que é proibido", () => {
  it("idade aparente é obrigatória e mínima de 21 (recusa, não ajusta)", () => {
    expect(normalizarFicha(fichaBase).idade_aparente).toBe(29);
    expect(() => normalizarFicha({ ...fichaBase, idade_aparente: 20 })).toThrow(ErroDeRegra);
    try {
      normalizarFicha({ ...fichaBase, idade_aparente: 18 });
    } catch (e) {
      expect((e as ErroDeRegra).codigo).toBe("idade_minima");
      expect((e as ErroDeRegra).status).toBe(422);
    }
    expect(() => normalizarFicha({ tom_de_pele: "clara" })).toThrow(/idade aparente/);
    expect(() => normalizarFicha({ ...fichaBase, idade_aparente: 95 })).toThrow(ErroDeRegra);
  });

  it("sósia, pessoa conhecida, menor e sexualização são recusados", () => {
    expect(conteudoProibido("parecida com a Anitta")?.codigo).toBe("semelhanca_proibida");
    expect(conteudoProibido("inspirada em Taylor Swift")?.codigo).toBe("pessoa_publica_proibida");
    expect(conteudoProibido("rosto de adolescente")?.codigo).toBe("menor_de_idade");
    expect(conteudoProibido("pose sensual")?.codigo).toBe("sexualizacao_proibida");
    expect(conteudoProibido("pele morena, nuances douradas, número 3 de cabelo")).toBeNull();
    expect(() => normalizarFicha({ ...fichaBase, estilo: "igual ao Neymar" })).toThrow(ErroDeRegra);
    expect(() => normalizarNomeDaPersona("")).toThrow(/nome fictício/);
    expect(normalizarNomeDaPersona("Marina Aurora")).toBe("Marina Aurora");
  });

  it("invariantes e a ficha em texto sempre dizem adulta com a idade", () => {
    const f = normalizarFicha(fichaBase);
    const inv = invariantesDaFicha(f, ["pinta pequena acima do lábio"]);
    expect(inv[0]).toBe("adulta, idade aparente de 29 anos");
    expect(inv).toContain("pinta pequena acima do lábio");
    expect(fichaEmTexto(f)).toMatch(/^Pessoa adulta de 29 anos de idade aparente/);
  });
});

describe("personas: prompts de hiper-realismo com a ficha em todo pedido", () => {
  const f = normalizarFicha(fichaBase);
  const inv = invariantesDaFicha(f);
  const candidata = promptDaCandidata({ nome: "Marina", ficha: f, invariantes: inv, usos: ["pose", "luz"] });
  const vista = promptDaVista({ nome: "Marina", ficha: f, invariantes: inv, vista: "perfil_esq", identidades: ["âncora da persona"] });
  const detalhe = promptDoDetalhe({ alvo: "pessoa", nome: "Marina", ficha: f, invariantes: inv, comIdentidade: 2 });

  it("pele, poros, imperfeições, luz, lente e proibições; nada de palavra que plastifica", () => {
    for (const p of [candidata, vista]) {
      expect(p).toContain("poros visíveis");
      expect(p).toContain("pequenas assimetrias naturais");
      expect(p).toContain("85 mm em f/2");
      expect(p).toContain("pele de porcelana ou de plástico");
      expect(p).toContain("Pessoa adulta de 29 anos");
      expect(p).toContain(inv.join("; "));
      for (const palavra of PALAVRAS_QUE_PLASTIFICAM) expect(p.toLowerCase()).not.toContain(palavra);
      expect(p).not.toMatch(/[—–]/);
    }
  });

  it("referência do dono entra só como uso declarado, nunca identidade", () => {
    expect(candidata).toContain("Imagem 1: SÓ POSE");
    expect(candidata).toContain("Imagem 2: SÓ LUZ");
    expect(candidata).toContain("Não é a identidade da persona");
    expect(vista).toContain("Imagem 1: âncora da persona. IDENTIDADE da persona");
    expect(vista).toContain(DESCRICAO_DA_VISTA.perfil_esq);
  });

  it("detalhe 4K: mesma foto, identidade da persona e sem inventar", () => {
    expect(detalhe).toContain("a MESMA fotografia, mesma composição");
    expect(detalhe).toContain("Imagens 2 a 3: a mesma pessoa sintética");
    expect(promptDoDetalhe({ alvo: "produto", comIdentidade: 0 })).toContain("texto e logotipo do produto exatamente como estão");
  });
});

describe("personas: rodada, folha, status e aviso de realismo", () => {
  it("rodada padrão do dono: Sunburst alta, Nano Banana Pro 2K, Seedream 5.0 Pro 2K e MAI-Image-2.6 ligados", () => {
    const ligados = RODADA_PADRAO.filter((r) => r.padrao);
    expect(ligados.map((r) => r.modelo_imagem_id)).toEqual([
      "openrouter:openai/gpt-image-2.5-sunburst",
      "openrouter:google/gemini-3-pro-image",
      "openrouter:bytedance-seed/seedream-5-0-pro",
      "openrouter:microsoft/mai-image-2.6",
    ]);
    expect(padraoDoMotor("openrouter:openai/gpt-image-2.5-sunburst")).toEqual({ qualidade: "alta", resolucao: null });
    expect(padraoDoMotor("openrouter:google/gemini-3-pro-image").resolucao).toBe("2K");
    expect(RODADA_PADRAO.filter((r) => !r.padrao).length).toBeGreaterThanOrEqual(3);
  });

  it("folha de 6 vistas; identidades da vista: âncora e aprovadas mais perto do ângulo", () => {
    expect(FOLHA_PADRAO).toHaveLength(6);
    const ancora = { id: "a", papel: "candidata", vista: null, aprovada: true };
    const imgs = [
      ancora,
      { id: "b", papel: "vista", vista: "corpo_inteiro", aprovada: true },
      { id: "c", papel: "vista", vista: "tres_quartos_esq", aprovada: true },
      { id: "d", papel: "vista", vista: "perfil_dir", aprovada: false },
    ];
    expect(identidadesDaVista(ancora, imgs, "perfil_esq", 14).map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(identidadesDaVista(ancora, imgs, "perfil_esq", 1).map((i) => i.id)).toEqual(["a"]);
    const folha = resumoDaFolha(imgs);
    expect(folha.aprovadas).toBe(2);
    expect(folha.pronta).toBe(false);
  });

  it("status pelo que existe: rascunho, candidatos, ancora, folha, pronta; arquivada fica", () => {
    expect(statusDaPersona({ status: "rascunho", ancora_imagem_id: null }, [])).toBe("rascunho");
    expect(statusDaPersona({ status: "rascunho", ancora_imagem_id: null }, [{ id: "1", papel: "candidata", vista: null, aprovada: null }])).toBe("candidatos");
    expect(statusDaPersona({ status: "candidatos", ancora_imagem_id: "1" }, [{ id: "1", papel: "candidata", vista: null, aprovada: true }])).toBe("ancora");
    const tres = ["frente", "perfil_esq", "meio_corpo"].map((v, i) => ({ id: `v${i}`, papel: "vista", vista: v, aprovada: true }));
    expect(statusDaPersona({ status: "folha", ancora_imagem_id: "1" }, tres)).toBe("pronta");
    expect(statusDaPersona({ status: "folha", ancora_imagem_id: "1" }, tres.slice(0, 1))).toBe("folha");
    expect(statusDaPersona({ status: "arquivada", ancora_imagem_id: "1" }, tres)).toBe("arquivada");
    expect(personaUsavel("candidatos").ok).toBe(false);
    expect(personaUsavel("ancora").aviso).toMatch(/Folha da persona incompleta/);
  });

  it("aviso composto do Jev: só alerta, com nota ponderada", () => {
    const r = alertasDoRealismo({ realismo_pele: 0.8, anatomia: 2, luz: 2, lembra_pessoa_publica: 0.7, identidade_diferente: 0.1 }, { idade_aparente_estimada: 19 });
    expect(r.alertas.join(" ")).toMatch(/plástico/);
    expect(r.alertas.join(" ")).toMatch(/pessoa pública/);
    expect(r.alertas.join(" ")).toMatch(/abaixo de 21/);
    expect(r.nota_realismo).toBeCloseTo((0.8 / 3) * 0.5 + 0.3 + 0.2, 3);
    expect(alertasDoRealismo({ realismo_pele: null, anatomia: null, luz: null, lembra_pessoa_publica: null, identidade_diferente: null }).nota_realismo).toBeNull();
    expect(NIVEIS_PELE).toHaveLength(4);
  });
});

describe("canvas: validação do quadro", () => {
  const canvasOk = {
    nome: "Óculos na praia",
    nos: [
      { id: "p1", tipo: "produto", x: 0, y: 0, dados: { kit_id: IMG(1) } },
      { id: "m1", tipo: "modelo", x: 0, y: 100, dados: { modelo_id: IMG(2) } },
      { id: "a1", tipo: "ambiente", x: 0, y: 200, dados: { texto: "praia ao fim da tarde" } },
      { id: "e1", tipo: "estilo", x: 0, y: 300, dados: { imagem_ids: [IMG(3), "lixo"], guia: "céu azul com nuvens" } },
      { id: "t1", tipo: "prompt", x: 0, y: 400, dados: { texto: "sorrindo, vento no cabelo" } },
      { id: "s1", tipo: "saida", x: 400, y: 200, dados: { formato: "4:5", resolucao: "2k" } },
    ],
    ligacoes: [
      { de: "p1", para: "s1", ordem: 0 },
      { de: "m1", para: "s1", ordem: 1 },
      { de: "a1", para: "s1", ordem: 2 },
      { de: "e1", para: "s1", ordem: 3 },
      { de: "t1", para: "s1", ordem: 4 },
      { de: "t1", para: "s1", ordem: 5 },
    ],
  };

  it("normaliza nós e ligações, descarta id inválido e ligação repetida", () => {
    const c = normalizarCanvas(canvasOk);
    expect(c.nos).toHaveLength(6);
    expect(c.nos.find((n) => n.id === "e1")!.dados.imagem_ids).toEqual([IMG(3)]);
    expect(c.nos.find((n) => n.id === "s1")!.dados).toMatchObject({ formato: "4:5", resolucao: "2K", qualidade: "alta" });
    expect(c.ligacoes).toHaveLength(5);
    expect(idsDoCanvas(c)).toEqual({ kits: [IMG(1)], modelos: [IMG(2)], imagens: [IMG(3)], biblioteca: [] });
  });

  it("recusa tipo desconhecido, ligação para cartão que não é saida e texto proibido", () => {
    expect(() => normalizarCanvas({ nos: [{ id: "x", tipo: "camera" }] })).toThrow(/Tipo de cartão/);
    expect(() => normalizarCanvas({ ...canvasOk, ligacoes: [{ de: "p1", para: "m1" }] })).toThrow(/resultado/);
    expect(() => normalizarCanvas({ ...canvasOk, ligacoes: [{ de: "p1", para: "zz" }] })).toThrow(/não existe/);
    expect(() => normalizarCanvas({ nos: [{ id: "t", tipo: "prompt", dados: { texto: "modelo parecida com a Zendaya" } }] })).toThrow(ErroDeRegra);
    expect(() => normalizarCanvas({ nos: Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, tipo: "prompt" })) })).toThrow(/no máximo 60/);
  });

  it("escolhe a saida, agrupa as entradas em ordem e bloqueia sem produto nem pessoa", () => {
    const c = normalizarCanvas(canvasOk);
    const s = escolherSaida(c);
    expect(s.id).toBe("s1");
    const e = entradasDaSaida(c, s.id);
    expect(e.produto.map((n) => n.id)).toEqual(["p1"]);
    expect(e.modelo.map((n) => n.id)).toEqual(["m1"]);
    expect(() => garantirQueDaParaGerar({ ...e, produto: [], modelo: [] })).toThrow(/pelo menos um produto/);
    expect(() => escolherSaida({ nos: [] })).toThrow(/cartão de resultado/);
    expect(() => escolherSaida(c, "nao")).toThrow(ErroDeRegra);
  });
});

describe("canvas: ordem das referências por papel e orçamento do gerador", () => {
  it("orçamento com 8: produto 3, pessoa 3, ambiente 1, estilo 1; com 16: 5, 5, 2, 4; com 3: 1, 1, 1", () => {
    const muitos = { produto: 10, pessoa: 10, ambiente: 10, estilo: 10 };
    expect(orcamentoPorPapel(8, muitos)).toEqual({ produto: 3, pessoa: 3, ambiente: 1, estilo: 1 });
    expect(orcamentoPorPapel(16, muitos)).toEqual({ produto: 5, pessoa: 5, ambiente: 2, estilo: 4 });
    expect(orcamentoPorPapel(3, muitos)).toEqual({ produto: 1, pessoa: 1, ambiente: 1, estilo: 0 });
    // Papel sem imagem passa a vaga adiante.
    expect(orcamentoPorPapel(8, { produto: 6, pessoa: 0, ambiente: 1, estilo: 0 })).toEqual({ produto: 6, pessoa: 0, ambiente: 1, estilo: 0 });
  });

  it("produto primeiro (identidade), pessoa, ambiente e estilo; cortadas com aviso", () => {
    const cand = (papel: "produto" | "pessoa" | "ambiente" | "estilo", n: number) =>
      Array.from({ length: n }, (_, i) => ({ papel, origem: { tipo: "acervo" as const, id: `${papel}${i}`, no_id: papel }, imagem_id: `${papel}${i}`, titulo: papel, legenda: papel }));
    const r = ordenarReferencias([...cand("estilo", 2), ...cand("pessoa", 4), ...cand("ambiente", 1), ...cand("produto", 4)], 8);
    expect(r.referencias.map((x) => x.papel)).toEqual(["produto", "produto", "produto", "pessoa", "pessoa", "pessoa", "ambiente", "estilo"]);
    expect(r.referencias.map((x) => x.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.cortadas).toHaveLength(3);
    expect(r.avisos[0]).toMatch(/3 imagens ficaram de fora/);
    const krea = ordenarReferencias([...cand("produto", 2), ...cand("pessoa", 2)], 1);
    expect(krea.avisos.join(" ")).toMatch(/Nenhuma imagem de pessoa coube/);
  });

  it("prompt do canvas: índice por papel, invariantes do kit e da ficha, hiper-realismo com pessoa", () => {
    const ficha = normalizarFicha(fichaBase);
    const refs = ordenarReferencias([
      { papel: "produto", origem: { tipo: "kit", id: "k", no_id: "p1" }, imagem_id: "i1", titulo: "Óculos", legenda: "identidade" },
      { papel: "produto", origem: { tipo: "kit", id: "k", no_id: "p1" }, imagem_id: "i2", titulo: "Óculos", legenda: "detalhe" },
      { papel: "pessoa", origem: { tipo: "persona", id: "m", no_id: "m1" }, imagem_id: "i3", titulo: "Marina", legenda: "âncora" },
      { papel: "estilo", origem: { tipo: "acervo", id: "e", no_id: "e1" }, imagem_id: "i4", titulo: "print", legenda: "estilo" },
    ], 12).referencias;
    const p = promptDoCanvas({
      referencias: refs,
      produtos: [{ no_id: "p1", nome: "Óculos Aurora", variante: "tartaruga", invariantes: ["ponte dupla dourada"], lacunas: ["verso da haste"] }],
      pessoas: [{ no_id: "m1", nome: "Marina", ficha, invariantes: invariantesDaFicha(ficha) }],
      ambientes: [{ texto: "praia ao fim da tarde" }],
      estilos: [{ guia: "céu azul com nuvens" }],
      textos: [{ texto: "sorrindo", papel: "pedido" }, { texto: "sem chapéu", papel: "restricao" }],
      formato: "4:5",
      marca: { nome: "Ótica X", paleta: ["#112233"] },
    });
    expect(p).toContain('Imagens 1 a 2: O PRODUTO "Óculos Aurora (variante tartaruga)" (identidade invariante)');
    expect(p).toContain("Invariantes: ponte dupla dourada.");
    expect(p).toContain('Imagem 3: A PESSOA SINTÉTICA "Marina"');
    expect(p).toContain("Pessoa adulta de 29 anos");
    expect(p).toContain("Imagem 4: SÓ ESTILO");
    expect(p).toContain("poros visíveis");
    expect(p).toContain("RESTRIÇÕES DA EQUIPE: sem chapéu");
    expect(p).toContain("NÃO DOCUMENTADO NO KIT");
    expect(p).not.toMatch(/[—–]/);
    const semPessoa = promptDoCanvas({ referencias: refs.slice(0, 2), produtos: [{ no_id: "p1", nome: "Óculos", variante: null, invariantes: [], lacunas: [] }], pessoas: [], ambientes: [], estilos: [], textos: [], formato: "1:1" });
    expect(semPessoa).not.toContain("poros visíveis");
    expect(LIMITE_REFERENCIAS_DO_CANVAS).toBe(12);
  });
});

describe("modelos e canvas: contratos da função", () => {
  it("ações registradas no index (arquivos próprios, sem crescer o index) e com fôlego", () => {
    for (const a of [
      "modelos_listar", "modelo_ler", "modelo_criar", "modelo_editar", "motores_imagem", "modelo_candidata_gerar",
      "modelo_ancora_escolher", "modelo_vista_gerar", "modelo_imagem_decidir", "modelo_detalhar", "modelo_conferir",
    ]) expect(modelosFonte).toContain(`${a}: `);
    for (const a of ["canvas_listar", "canvas_ler", "canvas_salvar", "canvas_montar", "canvas_gerar", "canvas_conferir"]) expect(canvasFonte).toContain(`${a}: `);
    expect(fonte).toContain("...MODELOS.acoes,");
    expect(fonte).toContain("...CANVAS.acoes,");
    expect(fonte).toContain("...ACOES_LONGAS_DE_MODELOS, ...ACOES_LONGAS_DO_CANVAS,");
    for (const a of ["modelo_candidata_gerar", "modelo_vista_gerar", "modelo_detalhar", "modelo_conferir"]) expect(modelosFonte).toMatch(new RegExp(`ACOES_LONGAS_DE_MODELOS = \\[[^\\]]*"${a}"`));
    for (const a of ["canvas_montar", "canvas_gerar", "canvas_conferir"]) expect(canvasFonte).toMatch(new RegExp(`ACOES_LONGAS_DO_CANVAS = \\[[^\\]]*"${a}"`));
    expect(fonte).toContain("if (ALVOS_DE_ESTIMATIVA_DE_MODELOS.includes(acao)) return await MODELOS.estimar(ch, corpo, acao);");
    expect(fonte).toContain("if (ALVOS_DE_ESTIMATIVA_DO_CANVAS.includes(acao)) return await CANVAS.estimar(ch, corpo);");
  });

  it("uma imagem por chamada, com resolução, custo gravado e bytes como vieram", () => {
    expect(modelosFonte.match(/await chamarImagem\(/g) ?? []).toHaveLength(2);
    expect(canvasFonte.match(/await chamarImagem\(/g) ?? []).toHaveLength(1);
    expect(modelosFonte).toContain("resolucao: d.resolucao,");
    expect(modelosFonte).toContain("custo_usd: arred6(saida.custoUsd),");
    expect(modelosFonte).toContain("uso_id: saida.usoId || null,");
    expect(canvasFonte).toContain("custo_usd: arred6(saida.custoUsd),");
    expect(modelosFonte).not.toContain("emPng(");
    expect(canvasFonte).not.toContain("emPng(");
  });

  it("persona: ética obrigatória, UMA candidata por gerador, folha presa ao gerador da âncora, 4K explícito", () => {
    expect(modelosFonte).toContain('if (corpo.etica_confirmada !== true) {');
    expect(modelosFonte).toContain('if (!motorId) throw new ErroDeRegra(400, "modelo_imagem_obrigatorio"');
    expect(modelosFonte).toContain('"motor_da_ancora"');
    expect(modelosFonte).toContain('if (!aceitaResolucao(caps, "4K")) {');
    expect(modelosFonte).toContain('papel: "detalhe",');
    expect(modelosFonte).toContain('derivada_de: origem.id,');
    expect(modelosFonte).toContain('modo: "detalhe",');
    expect(modelosFonte).toContain("aviso: \"Só aviso: a equipe decide (sem refazer automático).\"");
  });

  it("conferência: visão descreve e o Jev dá notas como aviso (sem laço)", () => {
    expect(modelosFonte).toContain('realismo_pele: { type: "score"');
    expect(modelosFonte).toContain('lembra_pessoa_publica: {\n          type: "noul"');
    expect(modelosFonte).toContain("timeoutMs: f.timeoutTextoMs,");
    expect(canvasFonte).toContain("timeoutMs: f.timeoutTextoMs,");
    expect(fonte).toContain("timeoutTextoMs: TIMEOUT_TEXTO_FOTO_MS,");
    expect(modelosFonte).not.toMatch(/while\s*\(.*conferencia/);
  });

  it("canvas: trava otimista por versao, ids conferidos contra o banco e imagem marcada gerada no acervo", () => {
    expect(canvasFonte).toContain('"versao_esperada_obrigatoria"');
    expect(canvasFonte).toContain('throw new ErroDeRegra(409, "canvas_mudou"');
    expect(canvasFonte).toContain('.eq("versao", atual.versao)');
    expect(canvasFonte).toContain("await conferirIds(clientId, c);");
    expect(canvasFonte).toContain('modo: "canvas",');
    expect(canvasFonte).toContain("gerada: true,");
    expect(canvasFonte).toContain("...mt.personaIds.map((p) => `persona:${p}`),");
    expect(canvasFonte).toContain('"kit_de_pessoa"');
    expect(canvasFonte).toContain('"persona_sem_ancora"');
  });

  it("migration 03: capacidades, modos novos, personas adultas, canvas com versão e RLS", () => {
    expect(sql03).toContain("ADD COLUMN IF NOT EXISTS capacidades jsonb");
    expect(sql03).toContain("capacidades = COALESCE(EXCLUDED.capacidades, m.capacidades),");
    expect(sql03).toContain("AND NOT (_provedor = 'openrouter' AND modelo_api LIKE 'openai/gpt-image%');");
    expect(sql03).toContain("'preservar', 'luz_cor', 'cenario', 'angulo', 'ensaio', 'canvas', 'detalhe'");
    expect(sql03).toContain("(ficha ->> 'idade_aparente')::numeric >= 21");
    expect(sql03).toContain("gerada boolean NOT NULL DEFAULT true CHECK (gerada)");
    expect(sql03).toContain("versao integer NOT NULL DEFAULT 1 CHECK (versao > 0)");
    for (const t of ["foto_modelos", "foto_modelo_imagens", "foto_canvas", "foto_canvas_geracoes"]) {
      expect(sql03).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    }
    for (const id of ["openrouter:bytedance-seed/seedream-5-0-pro", "openrouter:microsoft/mai-image-2.6", "openrouter:bytedance-seed/seedream-4.5"]) expect(sql03).toContain(`'${id}'`);
    expect(sql03).not.toMatch(/[—–]/);
  });
});

describe("modelos e canvas: contrato com a tela (as duas frentes escreveram em paralelo)", () => {
  const modelosApi = ler("src/components/mesa-foto/modelosApi.ts");
  const canvasApi = ler("src/components/mesa-foto/canvasApi.ts");
  const regrasFonte = ler("supabase/functions/mesa-foto/canvas-regras.ts");
  const acoesDaTela = (texto: string) => {
    const saida: string[] = [];
    const re = /acao: "([a-z_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) if (saida.indexOf(m[1]) < 0) saida.push(m[1]);
    return saida;
  };

  it("toda ação que a tela chama está registrada na função", () => {
    const acoes = acoesDaTela(modelosApi + canvasApi);
    expect(acoes).toEqual(expect.arrayContaining(["modelo_criar", "modelo_candidata_gerar", "modelo_vista_gerar", "modelo_detalhar", "modelo_imagem_decidir", "canvas_salvar"]));
    for (const a of acoes) {
      const registrada = modelosFonte.includes(`${a}: `) || canvasFonte.includes(`${a}: `) || new RegExp(`\\n  ${a}[,:]`).test(fonte);
      expect(registrada, `ação ${a}`).toBe(true);
    }
    // A tela chama canvas_montar e canvas_gerar pelo helper (acao vem do parâmetro).
    expect(canvasApi).toContain('corpoDoPedidoDoCanvas("canvas_montar"');
    expect(canvasApi).toContain('corpoDoPedidoDoCanvas("canvas_gerar"');
  });

  it("os nomes antigos da tela não voltam (a função é a fonte dos nomes de entrada)", () => {
    for (const velho of ["da_agencia", "prompt_extra", "regenerar_4k", "no_gerar_id", "motor_id: p.motorId", 'formato: "4:5" }', "etica: { sintetica"]) {
      expect(modelosApi + canvasApi, velho).not.toContain(velho);
    }
    // Campos que a função lê, escritos na tela.
    for (const campo of ["etica_confirmada", "escopo:", "modelo_imagem_id: p.motorId", "pedido = p.pedido", 'alvo: "pessoa"', 'acao: "modelo_imagem_decidir"']) expect(modelosApi, campo).toContain(campo);
    expect(modelosFonte).toContain("if (corpo.etica_confirmada !== true) {");
    expect(modelosFonte).toContain("const escopo = lerEscopo(corpo.escopo);");
    expect(modelosFonte).toContain("const pedido = limpoOuNulo(corpo.pedido, 600);");
    expect(modelosFonte).toContain("const alvo = lerAlvoDoDetalhe(corpo.alvo);");
    for (const campo of ["no_saida_id: p.gerarId", "modelo_imagem_id: p.motorId"]) expect(canvasApi, campo).toContain(campo);
  });

  it("canvas: a função aceita os apelidos da tela e grava com os seus nomes", () => {
    expect(regrasFonte).toContain('export const APELIDOS_DE_TIPO: Record<string, TipoDeNo> = { texto: "prompt", gerar: "saida" };');
    expect(canvasFonte).toContain("const pedido = lerPedidoDoCanvas(corpo);");
    expect(canvasFonte).toContain("const grafo = canvasGravado(c);");
    const c = normalizarCanvas({
      nos: [
        { id: "g", tipo: "gerar", x: 1, y: 2, dados: { motores: ["openrouter:openai/gpt-image-2.5-sunburst"], resultados: [{ geracao_id: "g1", url: "https://expira.test", storage_path: "a/b.png", status: "gerada", custo_usd: 0.1 }] } },
        { id: "t", tipo: "texto", dados: { texto: "sorrindo", papel: "restricao" } },
        { id: "e", tipo: "estilo", dados: { imagem_id: IMG(3), biblioteca_id: IMG(4), texto: "luz fria" } },
        { id: "m", tipo: "modelo", dados: { modelo_id: IMG(2), versao: 3 } },
      ],
      ligacoes: [
        { id: "l1", de: "t", para: "g", entrada: "texto", ordem: 0 },
        { id: "l2", de: "e", para: "g", entrada: "estilo", ordem: 0 },
        { id: "l3", de: "m", para: "g", entrada: "pessoa", ordem: 0 },
      ],
    });
    expect(c.nos.map((n) => n.tipo)).toEqual(["saida", "prompt", "estilo", "modelo"]);
    expect(c.nos[2].dados).toMatchObject({ imagem_ids: [IMG(3)], biblioteca_ids: [IMG(4)], guia: "luz fria" });
    expect(c.nos[3].dados).toMatchObject({ modelo_id: IMG(2), versao: 3 });
    expect(c.nos[0].dados.resultados).toEqual([{ geracao_id: "g1", imagem_id: null, storage_bucket: "mesa", storage_path: "a/b.png", motor_id: "", status: "gerada", erro: "", custo_usd: 0.1, conferencia: null, criado_em: "" }]);
    expect(c.ligacoes.map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
    expect(c.ligacoes.every((l) => !("entrada" in l))).toBe(true);
    const e = entradasDaSaida(c, "g");
    expect(e.prompt.map((n) => n.id)).toEqual(["t"]);
    expect(e.estilo.map((n) => n.id)).toEqual(["e"]);
    expect(idsDoCanvas(c)).toMatchObject({ modelos: [IMG(2)], imagens: [IMG(3)], biblioteca: [IMG(4)] });
    // Os resultados guardados na Saída têm teto.
    const muitos = normalizarCanvas({ nos: [{ id: "g", tipo: "saida", dados: { resultados: Array.from({ length: 30 }, (_, i) => ({ geracao_id: `g${i}` })) } }] });
    expect((muitos.nos[0].dados.resultados as unknown[]).length).toBe(24);
  });
});

describe("personas da agência só com admin (servidor)", () => {
  it("criar, mover ou editar persona da agência pede admin", () => {
    const m = readFileSync(resolve(__dirname, "../../supabase/functions/mesa-foto/modelos.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(m).toContain('db().rpc("has_role", { _user_id: ch.userId, _role: "admin" })');
    expect(m).toContain('if (escopo === "agencia") await garantirAdminDaAgencia(ch);');
    expect(m).toContain('if (!p.client_id || corpo.escopo === "agencia") await garantirAdminDaAgencia(ch);');
  });
});

// ================================================================== ligada à Mesa (pedido do dono, 25/09)

describe("ligada à Mesa: campanha do mês pelo calendário (campanhas.ts, sem IA)", () => {
  const linha = (id: string, extra: Partial<LinhaCampanhaDaMesa> = {}): LinhaCampanhaDaMesa => ({
    id,
    nome: `Campanha ${id}`,
    pedido: null,
    objetivo: "vender mais",
    conceito: null,
    periodo_inicio: null,
    periodo_fim: null,
    status: "planejada",
    identidade: { tema_visual: "primavera em tons claros", paleta_apoio: [{ nome: "verde", hex: "#22aa55" }, { nome: "ruim", hex: "verde" }] },
    referencias_ids: [],
    proposta_id: null,
    criado_em: "2026-09-01T10:00:00Z",
    ...extra,
  });
  // 25/09/2026 10h em São Paulo.
  const agora = new Date("2026-09-25T13:00:00Z");

  it("mês de São Paulo (UTC-3): a virada do mês segue o fuso, não o UTC", () => {
    expect(mesDeSaoPaulo(agora)).toEqual({ mes: "2026-09", hoje: "2026-09-25", inicio: "2026-09-01", fim: "2026-09-30" });
    // 30/09 às 23h30 em São Paulo ainda é setembro, embora já seja 01/10 no UTC.
    expect(mesDeSaoPaulo(new Date("2026-10-01T02:30:00Z")).mes).toBe("2026-09");
    expect(mesDeSaoPaulo(new Date("2026-02-10T12:00:00Z")).fim).toBe("2026-02-28");
  });

  it("a que acontece hoje vence; conteúdo no calendário do mês conta; encerrada nunca é a do mês", () => {
    const itens = itensDasPropostas([
      { id: "prop-b", itens: [{ data: "2026-09-12", tema: "Dia do cliente", campanha_id: "b" }, { data: "2026-09-19", tema: "Depoimento", campanha_id: "b" }, { data: "sem data", tema: "x" }] },
      { id: "prop-velha", itens: [{ data: "2026-08-10", tema: "Agosto", campanha_id: "d" }] },
    ]);
    expect(itens).toHaveLength(3);
    const r = marcarCampanhaDoMes(
      [
        linha("a", { periodo_inicio: "2026-09-20", periodo_fim: "2026-10-05", criado_em: "2026-09-10T00:00:00Z" }),
        linha("b", { criado_em: "2026-09-15T00:00:00Z" }),
        linha("c", { periodo_inicio: "2026-09-01", periodo_fim: "2026-09-30", status: "encerrada" }),
        linha("d", { periodo_inicio: "2026-08-01", periodo_fim: "2026-08-31" }),
      ],
      itens,
      agora,
    );
    expect(r.mes).toBe("2026-09");
    expect(r.campanha_do_mes_id).toBe("a");
    expect(r.campanhas.map((c) => c.id)).toEqual(["a", "b", "d", "c"]);
    const a = r.campanhas[0];
    expect(a).toMatchObject({ do_mes: true, acontecendo_hoje: true, no_mes: true, motivo: "Acontece hoje (20/09 a 05/10)." });
    expect(a.identidade.paleta_apoio).toEqual([{ nome: "verde", hex: "#22AA55" }]);
    // Sem período escrito: o período sai das datas do calendário.
    const b = r.campanhas[1];
    expect(b).toMatchObject({ do_mes: false, no_mes: true, periodo_inicio: "2026-09-12", periodo_fim: "2026-09-19", periodo_pelo_calendario: true, conteudos_no_mes: 2 });
    expect(b.pautas_no_mes).toEqual(["12/09 Dia do cliente", "19/09 Depoimento"]);
    expect(r.campanhas[3]).toMatchObject({ id: "c", do_mes: false, acontecendo_hoje: false, motivo: "Campanha encerrada." });
    expect(r.campanhas[2]).toMatchObject({ id: "d", no_mes: false, motivo: "Fora deste mês (01/08 a 31/08)." });
  });

  it("sem nada acontecendo hoje, vence a que tem conteúdo no calendário do mês; sem nenhuma no mês, não há campanha do mês", () => {
    const itens = itensDasPropostas([{ id: "p1", itens: [{ data: "2026-09-28", tema: "Lançamento" }] }]);
    const r = marcarCampanhaDoMes([linha("x", { periodo_inicio: "2026-09-01", periodo_fim: "2026-09-10" }), linha("y", { proposta_id: "p1" })], itens, agora);
    expect(r.campanha_do_mes_id).toBe("y");
    expect(r.campanhas[0]).toMatchObject({ id: "y", conteudos_no_mes: 1, pautas_no_mes: ["28/09 Lançamento"] });
    expect(marcarCampanhaDoMes([linha("z", { periodo_inicio: "2026-07-01", periodo_fim: "2026-07-31" })], [], agora).campanha_do_mes_id).toBeNull();
    expect(marcarCampanhaDoMes([], [], agora)).toMatchObject({ campanha_do_mes_id: null, campanhas: [] });
  });

  it("o diretor recebe tema, período, paleta de apoio e pautas, e sabe se a campanha foi escolhida ou é a do mês", () => {
    const r = marcarCampanhaDoMes([linha("a", { periodo_inicio: "2026-09-20", periodo_fim: "2026-09-30" })], [], agora);
    const ctx = campanhaParaOContexto(r.campanhas[0], "escolhida");
    expect(ctx).toMatchObject({ nome: "Campanha a", periodo: "2026-09-20 a 2026-09-30", tema_visual: "primavera em tons claros", paleta_de_apoio: ["verde #22AA55"] });
    expect(ctx.como_usar).toContain("dentro da marca");
    expect(campanhaParaOContexto(r.campanhas[0], "do_mes").como_usar).toContain("calendário editorial");
  });

  it("a função lista as campanhas, e todo planejamento (diretor, variações, campanha, ensaio, persona) usa o contexto da Mesa com a campanha", () => {
    const campanhasFonte = ler("supabase/functions/mesa-foto/campanhas.ts");
    const f = fonte.replace(/\r\n/g, "\n");
    expect(campanhasFonte).toContain('.from("mesa_campanhas")');
    expect(campanhasFonte).toContain('.from("calendario_propostas")');
    expect(campanhasFonte).toContain('.in("status", ["pronta", "gravada"])');
    expect(campanhasFonte).toContain("custo_usd: 0");
    expect(f).toContain("campanhas_listar: CAMPANHAS.campanhas_listar,");
    expect(f).toContain("async function contextoDoCliente(clientId: string, campanhaId?: unknown): Promise<ContextoFoto>");
    expect(f).toContain('const semCampanha = campanhaId === "nenhuma";');
    expect(f).toContain('throw new ErroHttp(404, "campanha_inexistente"');
    expect(f).toContain('campanha_escolhida: escolhida ? campanhaParaOContexto(escolhida, "escolhida") : null,');
    expect(f).toContain('campanha_do_mes: doMes ? campanhaParaOContexto(doMes, "do_mes") : null,');
    expect(f).toContain("A Mesa é a principal e a Mesa Foto é ferramenta dela");
    expect(f.match(/contextoDoCliente\(clientId, corpo\.campanha_id\)/g) || []).toHaveLength(4);
    // Gravada na direção do ensaio (ensaio e variações) e devolvida na resposta (variações e campanha).
    expect(f.match(/campanha_mesa: contexto\.campanha/g) || []).toHaveLength(4);
    expect(f).toContain("campanha_mesa: d.campanhaMesa ?? null,");
    expect(f).toContain("  contextoDoCliente,\n};");
  });

  it("foto aprovada entra no acervo marcada (origem mesa_foto, gerada, aprovada, tags) para o Estúdio achar", () => {
    const f = fonte.replace(/\r\n/g, "\n");
    const decidir = f.slice(f.indexOf("async function versaoDecidir"), f.indexOf("// ------------------------------------------------------------------ preparar"));
    expect(decidir).toContain('origem: "mesa_foto",');
    expect(decidir).toContain("client_id: ensaio.client_id,");
    expect(decidir).toContain('"mesa_foto", "ensaio", "gerada", `tomada:${tomada.id}`, `ensaio:${ensaio.id}`,');
    expect(decidir).toContain("gerada: true,");
    expect(decidir).toContain("aprovada: true,");
  });
});

describe("ligada à Mesa: persona sugerida pelo brief (modelo_sugerir)", () => {
  it("a ação lê o contexto da Mesa, usa texto com 300 s e fôlego, e não grava", () => {
    const m = modelosFonte.replace(/\r\n/g, "\n");
    const acao = m.slice(m.indexOf("async function modeloSugerir"), m.indexOf("return {\n    acoes: {"));
    expect(acao).toContain("f.contextoDoCliente(clientId, corpo.campanha_id)");
    expect(acao).toContain("timeoutMs: 300_000,");
    expect(acao).toContain("garantirPermitido(pedido);");
    expect(acao).not.toMatch(/\.insert\(|\.update\(/);
    expect(m).toContain("modelo_sugerir: modeloSugerir,");
    expect(m).toContain('"modelo_sugerir", "modelo_candidata_gerar"');
    expect(m).toContain("Adulta, com idade aparente de 21 anos ou mais; sem sexualização.");
  });

  it("fichaSugerida conserta sem recusar: idade mínima, texto proibido e nome de pessoa conhecida saem, com aviso", () => {
    const s = fichaSugerida({
      nome: "Anitta",
      ficha: {
        idade_aparente: 18,
        genero_apresentado: "feminino",
        tom_de_pele: "pele morena, subtom quente",
        rosto: "parecida com a Anitta",
        olhos: "castanhos",
        cabelo: { cor: "castanho", comprimento: "longo", textura: "ondulado" },
        marcas: ["sardas leves", "sexy"],
        corpo: "porte médio",
        estilo: "urbano",
        notas: "",
      },
      invariantes: ["sardas no nariz", "lembra a Anitta"],
      porque: "Conversa com o público jovem da marca.",
    });
    expect(s.nome).toBe("");
    expect(s.ficha.idade_aparente).toBe(25);
    expect(s.ficha.rosto).toBe("");
    expect(s.ficha.cabelo).toEqual({ cor: "castanho", comprimento: "longo", textura: "ondulado" });
    expect(s.ficha.marcas).toEqual(["sardas leves"]);
    expect(s.invariantes).toEqual(["sardas no nariz"]);
    expect(s.porque).toBe("Conversa com o público jovem da marca.");
    expect(s.avisos.join(" ")).toContain("abaixo do mínimo de 21");
    expect(s.avisos.join(" ")).toContain("nome fictício");
    expect(s.avisos.join(" ")).toContain("rosto");
    // Sem idade: 30 anos, com aviso; o resultado passa na validação de criar.
    const vazia = fichaSugerida({});
    expect(vazia.ficha.idade_aparente).toBe(30);
    expect(() => normalizarFicha(vazia.ficha)).not.toThrow();
  });
});

// ================================================================== 25/09, frente D: clones, tirar fundo, biblioteca, diretor atual

import {
  alertasDoClone,
  autorizacaoValida,
  garantirPermitidoNoClone,
  identidadesDoClone,
  lerAutorizacaoDoClone,
  lerFotosReais,
  lerPedidoDeVariacao,
  MOTOR_PADRAO_DO_CLONE,
  promptDaFolhaDoClone,
  promptDaVariacaoDoClone,
  statusDoClone,
} from "../../supabase/functions/mesa-foto/clones-regras";
import { ESTETICA_NO_PROMPT, preencherLacunasDoPrompt } from "../../supabase/functions/mesa-foto/calculos";

const AUT_OK = { confirmada: true, quem: "A própria pessoa", data: "2026-09-20", forma: "termo_assinado", finalidade: "posts da clínica", sabe_que_e_ia: true, adulta: true };
const ID = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;

describe("clones: autorização e regras duras", () => {
  it("sem autorização completa não existe clone; validade vencida e revogação bloqueiam", () => {
    expect(() => lerAutorizacaoDoClone({}, "2026-09-25")).toThrow(/Clone só com autorização/);
    expect(() => lerAutorizacaoDoClone({ ...AUT_OK, sabe_que_e_ia: false }, "2026-09-25")).toThrow(/geradas por IA/);
    expect(() => lerAutorizacaoDoClone({ ...AUT_OK, adulta: false }, "2026-09-25")).toThrow(/18 anos/);
    expect(() => lerAutorizacaoDoClone({ ...AUT_OK, validade: "2026-01-01" }, "2026-09-25")).toThrow(/venceu/);
    const a = lerAutorizacaoDoClone({ ...AUT_OK, data: "20/09/2026" }, "2026-09-25");
    expect(a).toMatchObject({ confirmada: true, data: "2026-09-20", forma: "termo_assinado", sabe_que_e_ia: true, adulta: true });
    expect(autorizacaoValida(a, "2026-09-25").ok).toBe(true);
    expect(autorizacaoValida({ ...a, revogada_em: "2026-09-24" }, "2026-09-25").ok).toBe(false);
    expect(autorizacaoValida(null).ok).toBe(false);
  });

  it("o texto não muda a identidade, não pede sósia nem pessoa conhecida; a palavra clone é permitida", () => {
    expect(() => garantirPermitidoNoClone("clone da Paula em outra roupa")).not.toThrow();
    expect(() => garantirPermitidoNoClone("deixe mais jovem")).toThrow(/não mudam/);
    expect(() => garantirPermitidoNoClone("parecida com a Anitta")).toThrow();
    expect(() => garantirPermitidoNoClone("igual à Taylor Swift")).toThrow();
    expect(() => lerPedidoDeVariacao({ roupa: "lingerie sensual" })).toThrow();
    expect(() => lerPedidoDeVariacao({})).toThrow(/Diga o que muda/);
    const p = lerPedidoDeVariacao({ preset: "lifestyle_rua", roupa: "jaqueta jeans" });
    expect(p).toMatchObject({ preset: "lifestyle_rua", roupa: "jaqueta jeans", enquadramento: "meio_corpo" });
    expect(p.cenario).toContain("rua");
  });

  it("de 1 a 4 fotos reais; identidade vai com as reais primeiro e a folha aprovada mais perto do ângulo", () => {
    expect(() => lerFotosReais([])).toThrow(/de 1 a 4/);
    expect(() => lerFotosReais([ID(1), ID(2), ID(3), ID(4), ID(5)])).toThrow(/No máximo 4/);
    const reais = [{ id: "r1", tipo: "real" as const, vista: null }, { id: "r2", tipo: "real" as const, vista: null, principal: true }];
    const folha = [{ id: "f-perfil", tipo: "folha" as const, vista: "perfil_esq" }, { id: "f-frente", tipo: "folha" as const, vista: "frente" }];
    const ids = identidadesDoClone(reais, folha, "frente", 14).map((x) => x.id);
    expect(ids).toEqual(["r2", "r1", "f-frente", "f-perfil"]);
    expect(identidadesDoClone(reais, folha, "frente", 3)).toHaveLength(3);
    expect(identidadesDoClone(reais, [], null, 2).map((x) => x.id)).toEqual(["r2", "r1"]);
  });

  it("prompts citam as fotos por índice, repetem o que não muda e não espelham; sem travessão", () => {
    const fontes = [{ id: "r1", tipo: "real" as const, vista: null, principal: true }, { id: "f1", tipo: "folha" as const, vista: "tres_quartos_esq" }];
    const folha = promptDaFolhaDoClone({ nome: "Paula", vista: "perfil_esq", fontes, invariantes: ["pinta acima do lábio"] });
    expect(folha).toContain("Imagem 1: FOTO REAL da pessoa (a principal)");
    expect(folha).toContain("Imagem 2: vista aprovada da folha");
    expect(folha).toContain("TRAÇOS QUE NÃO MUDAM: pinta acima do lábio");
    expect(folha).toContain("fundo cinza claro liso");
    expect(folha).toContain("nunca espelhe");
    const v = promptDaVariacaoDoClone({ nome: "Paula", fontes, invariantes: [], pedido: lerPedidoDeVariacao({ preset: "cafe" }), formato: "4:5" });
    expect(v).toContain("MESMO rosto");
    expect(v).toContain("O QUE MUDA NESTA FOTO");
    expect(v).toContain("sem fundo degradê");
    expect(v).toContain("Nunca escureça a foto");
    for (const t of [folha, v]) expect(t).not.toMatch(/[—–]/);
  });

  it("status pronto pede a frente aprovada e mais duas; a conferência é só aviso e sem biometria", () => {
    expect(statusDoClone("rascunho", [])).toBe("rascunho");
    const vistas = (aprovadas: string[]) => ["frente", "tres_quartos_esq", "perfil_esq"].map((v, i) => ({ id: `v${i}`, papel: "vista", vista: v, aprovada: aprovadas.includes(v) }));
    expect(statusDoClone("rascunho", vistas(["tres_quartos_esq", "perfil_esq"]))).toBe("folha");
    expect(statusDoClone("folha", vistas(["frente", "tres_quartos_esq", "perfil_esq"]))).toBe("pronta");
    expect(statusDoClone("arquivada", vistas(["frente", "tres_quartos_esq", "perfil_esq"]))).toBe("arquivada");
    const iguais = alertasDoClone([{ traco: "nariz", escolha: "igual", confianca: 0.9, probabilidades: { igual: 0.9, pequena_diferenca: 0.1 } }], 0.1, 0.05);
    expect(iguais.alertas).toEqual([]);
    expect(iguais.semelhanca).toBeGreaterThan(0.9);
    const outra = alertasDoClone([{ traco: "olhos", escolha: "diferente", confianca: 0.8, probabilidades: { diferente: 0.8, igual: 0.1 } }], 0.7, 0.6);
    expect(outra.alertas[0]).toMatch(/não parecer a mesma pessoa/);
    expect(outra.alertas.join(" ")).toMatch(/Olhos parece diferente/);
    expect(outra.alertas.join(" ")).toMatch(/espelhada/);
    expect(MOTOR_PADRAO_DO_CLONE.modelo_imagem_id).toBe("openrouter:google/gemini-3-pro-image");
  });

  it("a função: autorização exigida, foto gerada não vira identidade, motor preso, variação no acervo marcada, Jev só aviso", () => {
    const c = ler("supabase/functions/mesa-foto/clones.ts");
    expect(c).toContain("lerAutorizacaoDoClone(mesclada)");
    expect(c).toContain('"foto_nao_e_real"');
    expect(c).toContain("garantirGeravel(c);");
    expect(c).toContain('"motor_do_clone"');
    expect(c).toContain("mesmoModelo: true");
    expect(c).toContain('modo: "clone"');
    expect(c).toContain("gerada: true,");
    expect(c).toContain('"pessoa_real_autorizada"');
    expect(c).toContain("Não identifique a pessoa");
    expect(c).toContain("Só aviso, sem biometria");
    expect(c).toContain('formato: "aceleriq.clone.v1"');
    expect(c).not.toMatch(/[—–]/);
    const mapa = fonte.slice(fonte.indexOf("const ACOES:"), fonte.indexOf("const ACOES_LONGAS"));
    expect(mapa).toContain("...CLONES.acoes");
    expect(mapa).toContain("...BIBLIOTECA_EM_LOTE.acoes");
    const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("Deno.serve"));
    expect(longas).toContain("...ACOES_LONGAS_DE_CLONES");
    expect(c).toMatch(/ACOES_LONGAS_DE_CLONES = \[[^\]]*"clone_folha_gerar"[^\]]*"clone_variacao_gerar"[^\]]*"clone_conferir"/);
    // Persona sintética e clone não se misturam.
    expect(modelosFonte).toContain("recusarClone(p);");
    expect(modelosFonte).toContain("p.origem !== ORIGEM_CLONE");
  });

  it("migration 04: clone só com autorização e de um cliente, modo clone no acervo, idempotente e não aplicada", () => {
    const sql4 = ler("docs/mesa-foto/migrations/04_clones.sql");
    expect(sql4).toContain("NÃO APLICADA");
    expect(sql4).toContain("ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'sintetica'");
    expect(sql4).toContain("(autorizacao ->> 'confirmada') = 'true'");
    expect(sql4).toContain("jsonb_array_length(identidade_real) BETWEEN 1 AND 4");
    expect(sql4).toContain("'detalhe', 'clone'");
    expect(sql4).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(sql4).not.toMatch(/[—–]/);
  });
});

describe("tirar fundo: pixels originais com o alfa alinhado", () => {
  it("o recorte usa só o alfa do gerador, alinhado, na foto original, e erra explícito quando não serve", () => {
    const r = ler("supabase/functions/mesa-foto/recorte.ts");
    expect(r).toContain('from "../_shared/imagem-local.ts"');
    expect(r).toContain("ob[i + 3] = final;");
    expect(r).not.toMatch(/ob\[i\] = |ob\[i \+ 1\] = |ob\[i \+ 2\] = /);
    expect(r).toContain("export const LADO_DO_RECORTE = 1600;");
    const p = corpoDe(fonte, "preparar");
    for (const t of ['"recorte_vazio"', '"recorte_desalinhado"', '"fundo_nao_veio_transparente"', "LADO_DO_RECORTE", '"sem_fundo"']) expect(p, t).toContain(t);
    // Contrato que o Estúdio chama: preparar { client_id, imagem_id, modo } -> { imagem, custo_usd }.
    expect(p).toContain("imagem: await comUrl(data as LinhaImagem)");
    expect(p).toContain("custo_usd: arred6(custo)");
  });
});

describe("biblioteca: exemplo gerado pelo próprio prompt", () => {
  it("as lacunas viram valores concretos e genéricos; o prompt do item vai inteiro", () => {
    expect(preencherLacunasDoPrompt("[Product] on a [light brand color, e.g. #F3EEE8] backdrop", "produto")).toBe("a generic unbranded product (a neutral colored box or bottle) on a #F3EEE8 backdrop");
    expect(preencherLacunasDoPrompt("gradient from [color 1] to [color 2]", "cosmetico")).toBe("gradient from soft sage green (#B7C4A8) to warm sand (#E6D5B8)");
    expect(preencherLacunasDoPrompt("[occasion: Christmas, Mother's Day]", "produto")).toBe("Christmas");
    expect(preencherLacunasDoPrompt("[Garment] on a hanger", "moda")).toBe("a generic unbranded garment on a hanger");
    const p = promptDoExemplo({ categoria: "bebida", titulo: "Lata no gelo", prompt_en: "[Beverage can] half buried in crushed ice, solid [brand color, HEX] background", negativo: "watermark" });
    expect(p).toContain("PROMPT (siga à risca");
    expect(p).toContain("a generic unbranded beverage can half buried in crushed ice");
    expect(p).not.toContain("[");
  });

  it("ações de admin: limpar Openverse (prévia antes), estimar o total e gerar um por chamada no gerador barato", () => {
    const b = ler("supabase/functions/mesa-foto/biblioteca-lote.ts");
    expect(b).toContain('export const MOTORES_DO_EXEMPLO = ["openrouter:microsoft/mai-image-2.6", "openrouter:bytedance-seed/seedream-4.5"]');
    expect(b).toContain("if (corpo.confirmar !== true)");
    expect(b).toContain("await garantirAdmin(ch);");
    expect(b).toContain("prompt_origem");
    expect(b).toContain('type: "noul"');
    expect(b).toContain("pelo_proprio_prompt: true");
    expect(b).toContain('ACOES_LONGAS_DA_BIBLIOTECA = ["biblioteca_limpar_exemplos", "biblioteca_exemplo_proximo"]');
    expect(b).not.toMatch(/[—–]/);
  });
});

describe("diretor de fotografia atual (2025/2026)", () => {
  it("o sistema traz a estética atual com exemplos e os clichês antigos a evitar, sem perder as regras", () => {
    const e = fonte.slice(fonte.indexOf("const ESTETICA_ATUAL"), fonte.indexOf("const SISTEMA_LEITOR"));
    for (const t of ["Luz natural suave", "UGC autêntico", "EXEMPLOS DE DIREÇÃO", "fundo degradê", "vinheta", "HDR", "bokeh exagerado", "${ESTETICA_ATUAL}"]) expect(e, t).toContain(t);
    expect(fonte).toContain("Nunca escurecer a foto para dar destaque");
    for (const s of ["SISTEMA_DIRETOR", "SISTEMA_AGENTE", "SISTEMA_VARIACOES", "SISTEMA_CAMPANHA"]) {
      const corpo = fonte.slice(fonte.indexOf(`const ${s} =`), fonte.indexOf("`;", fonte.indexOf(`const ${s} =`)));
      expect(corpo, s).toContain("${PADRAO_PUBLICITARIO}");
    }
    expect(ESTETICA_NO_PROMPT).toContain("sem fundo degradê");
    expect(calculosFonte.split("linhas.push(ESTETICA_NO_PROMPT);").length - 1).toBe(2);
    expect(ler("supabase/functions/mesa-foto/receitas.ts")).not.toContain("gradiente");
  });
});
