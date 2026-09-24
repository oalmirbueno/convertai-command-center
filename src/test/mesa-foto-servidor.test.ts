import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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
import { cameraDoPreset, PRESETS, receitaPorId, RECEITAS } from "../../supabase/functions/mesa-foto/receitas";

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
  it("tem as 8 receitas da pesquisa, com as mesmas tomadas", () => {
    expect(RECEITAS).toHaveLength(8);
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
    expect(gerar).toContain("referencias: [...imagensFontes, ...guiado.estilos.map((e) => e.imagem)]");
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
