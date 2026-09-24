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
      'fundo: "transparente"', "aceitaFundoTransparente(mImg)", '"fundo_transparente_nao_suportado"', "recorteComPixelsOriginais(", "devolverOriginalNasAreas(",
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
  const mapa = fonte.slice(fonte.indexOf("const ACOES:"), fonte.indexOf("const ACOES_LONGAS"));

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