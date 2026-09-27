import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { avisoDoPlanoForaDoMes, datasDoPlanoDoMes } from "../../supabase/functions/_shared/perfis-instagram";
import {
  type EntradaDoPacote,
  lerFoco,
  MAX_FOTOS_POR_LINHA,
  MAX_LINHAS_DE_GERACAO,
  montarPacote,
  normalizarGeracoesDoDiretor,
} from "../../supabase/functions/mesa-foto/diretor-agentico";
import {
  blocoDaIdentificacaoNoPedido,
  kitsComIdentificacao,
  legendaDaReferenciaWeb,
  produtoDaTela,
  referenciasWebDaTela,
} from "../../supabase/functions/mesa-foto/kit-sugerir";
import {
  aceitaRecorteRedesenhado,
  detalhesDoRecorteDoGerador,
  JANELA_DO_RECORTE_GUARDADO_MS,
  mensagemDoRecorteDesalinhado,
  nomeDoRecorteDoGerador,
  pastaDoRecorteDoGerador,
  recorteGuardadoMaisNovo,
} from "../../supabase/functions/mesa-foto/recorte-do-gerador";
import type { KitFoto, RefDoKit } from "../../supabase/functions/mesa-foto/calculos";
import { corpoDoTirarFundo, ofertaDoRecorteDoGerador } from "@/components/mesa/estudioUtil";

/**
 * Anti-bug 26/09, segunda rodada (subfrente AB2-FOTO-PERFIS): tetos que
 * cortavam calados (plano do mês no último dia, 8 fotos por linha no diretor)
 * e contratos que a tela mandava e a função ignorava (produto e referências
 * da internet no kit_sugerir; aceitar o recorte redesenhado sem pagar de novo).
 * Nada aqui chama IA nem gerador: funções puras e o código-fonte.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const corpoDe = (texto: string, nome: string) => {
  const i = texto.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const proximos = ["\nasync function ", "\nfunction ", "\nconst ACOES"].map((m) => texto.indexOf(m, i + 10)).filter((x) => x > 0);
  return texto.slice(i, Math.min(...proximos));
};

const A = "11111111-1111-4111-8111-111111111111";
const IMG = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("B. janelas e tetos que cortavam calados", () => {
  it("plano de mês pedido: uma pauta por dia útil, sem repetir o último dia; o que não cabe vai ao mês seguinte com aviso", () => {
    // 28, 29 e 30/09 são os únicos dias úteis depois de 27/09: 6 pautas.
    const p = datasDoPlanoDoMes("2026-09", "2026-09-27", 6);
    expect(p.datas).toHaveLength(6);
    expect(new Set(p.datas).size).toBe(6);
    expect(p.datas.slice(0, 3)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(p.datas.slice(3).every((d) => d.slice(0, 7) === "2026-10")).toBe(true);
    expect(p).toMatchObject({ noMes: 3, foraDoMes: 3 });
    const aviso = avisoDoPlanoForaDoMes("2026-09", p);
    expect(aviso).toContain("3 dias úteis livres");
    expect(aviso).toContain("3 pautas passaram para 2026-10");
    expect(aviso).not.toMatch(/[—–]/);
    // Cabe no mês: espalhadas, sem repetir, nenhum aviso.
    const cabe = datasDoPlanoDoMes("2026-10", "2026-09-26", 8);
    expect(cabe.datas).toHaveLength(8);
    expect(new Set(cabe.datas).size).toBe(8);
    expect(cabe.foraDoMes).toBe(0);
    expect(avisoDoPlanoForaDoMes("2026-10", cabe)).toBe("");
    expect(avisoDoPlanoForaDoMes("2026-09", datasDoPlanoDoMes("2026-09", "2026-09-29", 2))).toContain("1 dia útil livre: 1 pauta passou");

    // A função usa as datas do plano e avisa; a proposta não empilha no último dia.
    const f = ler("supabase/functions/perfis-instagram/index.ts");
    const plano = corpoDe(f, "planoIgual");
    expect(plano).toContain("const plano = datasDoPlanoDoMes(mes, hojeEmSaoPaulo(), aprovadas.length);");
    expect(plano).toContain("propostaDeAgenda(perfil, aprovadas, plano.datas,");
    expect(plano).toContain("const foraDoMes = avisoDoPlanoForaDoMes(mes, plano);");
    expect(plano).toContain('A lista está pronta para confirmar.${foraDoMes ? ` ${foraDoMes}` : ""}');
    expect(plano).not.toContain("datasDasPautas(mes, hojeEmSaoPaulo(), aprovadas.length)");
    expect(plano).toContain('"mes_sem_dias"');
    expect(corpoDe(f, "propostaDeAgenda")).not.toContain("datas[datas.length - 1]");
  });

  it("diretor: acima de 8 fotos numa linha ou de 16 no pedido, avisa quantas ficaram de fora (recusados e resumo)", () => {
    const entrada: EntradaDoPacote = {
      clientId: A,
      cliente: "Loja A",
      foco: lerFoco({ etapa: "clones", clone_id: IMG(90) }),
      imagens: [{ id: IMG(1), nome: "rosto.jpg", tags: ["tipo:pessoa"], ativa: true, gerada: false, origem: "upload" }],
      clones: [{ id: IMG(90), nome: "Ana", status: "pronta", identidade_real: [{ imagem_id: IMG(1), principal: true }], autorizacao_ok: true }],
      prompts: [],
      books: [],
      kits: [],
      personas: [],
      campanhas: [],
      leituras: {},
      lidasNoStorage: [],
    };
    const p = montarPacote(entrada);
    const linha = (quantidade: number) => ({ operacao: "gerar_clone", ref: "c1", quantidade, cenario: "estúdio", pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null });

    // 12 numa linha: 8 entram, 4 ficam de fora com o aviso (antes cortava calado).
    const uma = normalizarGeracoesDoDiretor([linha(12)], p)!;
    expect(uma.itens).toHaveLength(MAX_FOTOS_POR_LINHA);
    const limite = uma.recusados.find((r) => r.operacao === "limite" && r.ref === "c1")!;
    expect(limite.motivo).toContain("4 ficaram de fora");
    expect(uma.resumo).toContain("Pelo limite, 4 fotos ficaram de fora");
    expect(uma.ignorados).toEqual([]);

    // Dentro do limite: nenhum aviso.
    const ok = normalizarGeracoesDoDiretor([linha(3)], p)!;
    expect(ok.recusados).toEqual([]);
    expect(ok.resumo).not.toContain("de fora");

    // Linha acima de 8 e pedido acima de 16: soma os dois cortes, sem chave repetida no cartão.
    const muitas = normalizarGeracoesDoDiretor([linha(10), linha(8), linha(8)], p)!;
    expect(muitas.itens).toHaveLength(16);
    const doPedido = muitas.recusados.find((r) => r.ref === "-")!;
    expect(doPedido.motivo).toContain("No máximo 16 fotos por pedido: 8 ficaram de fora");
    expect(muitas.recusados.find((r) => r.ref === "c1")!.motivo).toContain("2 ficaram de fora");
    expect(muitas.resumo).toContain("Pelo limite, 10 fotos ficaram de fora");
    const chaves = muitas.recusados.map((r) => `${r.operacao}-${r.ref}`);
    expect(new Set(chaves).size).toBe(chaves.length);

    // Linhas além do teto de linhas também contam no aviso.
    const alem = normalizarGeracoesDoDiretor(Array.from({ length: MAX_LINHAS_DE_GERACAO + 2 }, () => linha(1)), p)!;
    expect(alem.itens).toHaveLength(16);
    expect(alem.recusados.find((r) => r.ref === "-")!.motivo).toContain("10 ficaram de fora");
  });
});

describe("E. contratos que a tela manda e a função ignorava", () => {
  it("kit_sugerir usa o produto identificado e as referências da internet (no pedido ao leitor e no kit), sem trocar o modelo", () => {
    const produto = produtoDaTela({ marca: "NTC", modelo: "Orbit X", variante: "preto", categoria: "mouse", especificacoes: ["DPI: 16000", "Peso: 58 g"], confianca: "média", evidencias: [] });
    expect(produto).toMatchObject({ marca: "NTC", modelo: "Orbit X", variante: "preto", confianca: "media" });
    expect(produtoDaTela({ categoria: "mouse" })).toBeNull();
    expect(produtoDaTela("x")).toBeNull();

    const refs = referenciasWebDaTela([
      { imagem_id: IMG(21), url_origem: "https://loja.test/x.jpg", pagina: "https://www.ntc.test/orbit", fonte: "ntc.test" },
      { imagem_id: IMG(21), url_origem: "", pagina: "", fonte: "" },
      { imagem_id: "não é uuid" },
      { imagem_id: IMG(22), pagina: "javascript:alert(1)" },
    ]);
    expect(refs.map((r) => r.imagem_id)).toEqual([IMG(21), IMG(22)]);
    expect(refs[1].pagina).toBeNull();
    expect(legendaDaReferenciaWeb(refs[0])).toBe(" (fonte ntc.test, página https://www.ntc.test/orbit)");

    const bloco = blocoDaIdentificacaoNoPedido(produto, refs);
    expect(bloco).toContain("PRODUTO JÁ IDENTIFICADO");
    expect(bloco).toContain("NTC Orbit X, variante preto, categoria mouse");
    expect(bloco).toContain("DPI: 16000; Peso: 58 g");
    expect(bloco).toContain("REFERÊNCIA DA INTERNET");
    expect(bloco).not.toMatch(/[—–]/);
    expect(blocoDaIdentificacaoNoPedido(null, [])).toBe("");

    const kit = (nome: string, tipo: KitFoto["tipo"], refsDoKit: RefDoKit[]): KitFoto & { refs: RefDoKit[]; perguntas: string[] } => ({
      tipo, nome, variante: null, atributos: { observado: [], informado: [], inferido: [] }, invariantes: [], lacunas: [], autorizacao: null, frente_imagem_id: null, status: "rascunho", refs: refsDoKit, perguntas: [],
    });
    const kits = [
      kit("Caneca", "produto", [{ imagem_id: IMG(5), papel: "identidade", vista: null, prioridade: 100 }]),
      kit("Mouse", "tecnologia", [{ imagem_id: IMG(1), papel: "embalagem", vista: null, prioridade: 100 }, { imagem_id: IMG(21), papel: "identidade", vista: null, prioridade: 100 }]),
    ];
    const saida = kitsComIdentificacao(kits, produto, { noLote: [IMG(21)], foraDoLote: [IMG(22)] });
    // Só o kit com a referência da internet ganha a identificação e a referência que ficou fora do lote.
    expect(saida[0]).toBe(kits[0]);
    expect(saida[1].atributos.identificacao).toMatchObject({ marca: "NTC", modelo: "Orbit X" });
    expect(saida[1].variante).toBe("preto");
    expect(saida[1].atributos.inferido).toContain("Pela internet: DPI: 16000");
    expect(saida[1].refs.map((r) => r.imagem_id)).toEqual([IMG(1), IMG(21), IMG(22)]);
    expect(saida[1].refs[2].papel).toBe("identidade");
    // Um kit só (que não é de pessoa): é o do produto mesmo sem referência no lote.
    expect(kitsComIdentificacao([kits[0]], produto, { noLote: [], foraDoLote: [] })[0].atributos.identificacao).toBeTruthy();
    // Kit de pessoa nunca recebe a identificação do produto.
    expect(kitsComIdentificacao([kit("Ana", "pessoa", [])], produto, { noLote: [], foraDoLote: [] })[0].atributos.identificacao).toBeUndefined();

    // A função lê os dois campos que a tela manda e o modelo do leitor continua o mesmo.
    const f = ler("supabase/functions/mesa-foto/index.ts");
    const sugerir = corpoDe(f, "kitSugerir");
    expect(sugerir).toContain("produtoDaTela(corpo.produto)");
    expect(sugerir).toContain("referenciasWebDaTela(corpo.referencias_web)");
    expect(sugerir).toContain("conteudo: `Organize estas ${ordem.length} fotos em kits.\\n${legenda}${blocoDoProduto}`");
    expect(sugerir).toContain("kitsComIdentificacao(");
    expect(sugerir).toContain('const leitor = await modeloDeTexto("leitura", corpo.modelo_id);');
    expect(sugerir).toContain("modeloId: leitor.id,");
    expect(sugerir).toContain("salvarKitRascunho(ch, clientId, kit, { refsWeb })");
    const tela = ler("src/components/mesa-foto/fotoApi.ts");
    expect(tela).toContain("if (extras && extras.produto) corpo.produto = extras.produto;");
    expect(tela).toContain("corpo.referencias_web = extras.referenciasWeb.map(");
  });

  it("preparar aceita o recorte redesenhado sem cobrar duas vezes: guarda a volta já paga e reaproveita", () => {
    // O pedido de aceite só vale no Tirar fundo e com true explícito (o corpo que o Estúdio manda).
    expect(aceitaRecorteRedesenhado(corpoDoTirarFundo(A, IMG(3), { aceitarRedesenhado: true }), "fundo_transparente")).toBe(true);
    expect(aceitaRecorteRedesenhado(corpoDoTirarFundo(A, IMG(3)), "fundo_transparente")).toBe(false);
    expect(aceitaRecorteRedesenhado({ aceitar_recorte_redesenhado: "sim" }, "fundo_transparente")).toBe(false);
    expect(aceitaRecorteRedesenhado({ aceitar_recorte_redesenhado: true }, "fundo_branco")).toBe(false);

    // A volta guardada da foto: a mais nova dentro da janela; de outra foto ou velha não serve.
    const agora = Date.parse("2026-09-26T20:00:00Z");
    const nome = nomeDoRecorteDoGerador(IMG(3), "b");
    expect(nome.indexOf(IMG(3))).toBe(0);
    expect(pastaDoRecorteDoGerador(A)).toBe(`${A}/foto/derivadas/sem-garantia`);
    const lista = [
      { name: nomeDoRecorteDoGerador(IMG(3), "a"), created_at: "2026-09-26T18:00:00Z" },
      { name: nome, created_at: "2026-09-26T19:30:00Z" },
      { name: nomeDoRecorteDoGerador(IMG(4), "c"), created_at: "2026-09-26T19:59:00Z" },
      { name: nomeDoRecorteDoGerador(IMG(3), "velho"), created_at: new Date(agora - JANELA_DO_RECORTE_GUARDADO_MS - 1000).toISOString() },
    ];
    expect(recorteGuardadoMaisNovo(lista, IMG(3), agora)).toBe(nome);
    expect(recorteGuardadoMaisNovo(lista.slice(3), IMG(3), agora)).toBeNull();
    expect(recorteGuardadoMaisNovo([], IMG(3), agora)).toBeNull();

    // O erro leva o que a tela do Estúdio lê: com o caminho, usa direto (sem nova chamada).
    const caminho = `${pastaDoRecorteDoGerador(A)}/${nome}`;
    expect(ofertaDoRecorteDoGerador(detalhesDoRecorteDoGerador(caminho))).toEqual({ caminho, podeAceitar: true });
    expect(ofertaDoRecorteDoGerador(detalhesDoRecorteDoGerador(null))).toEqual({ caminho: null, podeAceitar: true });
    expect(mensagemDoRecorteDesalinhado(true)).toContain("usá-la não cobra de novo");
    expect(mensagemDoRecorteDesalinhado(true)).not.toMatch(/[—–]/);
    expect(mensagemDoRecorteDesalinhado(false)).toContain("Nada foi gravado");

    // Na função: o aceite reaproveita a volta guardada ANTES de chamar o gerador; sem ela, gera uma vez e aceita.
    const f = ler("supabase/functions/mesa-foto/index.ts");
    const preparar = corpoDe(f, "preparar");
    expect(preparar).toContain("const aceitarRedesenhado = aceitaRecorteRedesenhado(corpo, modo);");
    const i = preparar.indexOf('if (modo === "fundo_transparente") {\n    // Aceite do recorte do gerador');
    expect(i).toBeGreaterThan(0);
    const ramo = preparar.slice(i, preparar.indexOf('} else if (modo === "fundo_branco")', i));
    const reaproveita = ramo.slice(ramo.indexOf("if (guardado) {"), ramo.indexOf("} else {"));
    expect(ramo).toContain("aceitarRedesenhado ? await recorteDoGeradorGuardado(clientId, imagem.id) : null");
    expect(reaproveita).toContain("final = guardado.bytes;");
    expect(reaproveita).not.toContain("recortar(");
    expect(reaproveita).not.toContain("chamarImagem");
    expect(ramo).toContain("recortar({ aceitarDesalinhado: aceitarRedesenhado, guardarDesalinhado: true })");
    // Falha por redesenho: a volta paga fica guardada e o erro diz onde; com o aceite, ela é o resultado.
    expect(preparar).toContain("const guardado = await guardarRecorteDoGerador(clientId, imagem.id, pngDaVolta);");
    expect(preparar).toContain("...detalhesDoRecorteDoGerador(guardado),");
    expect(preparar).toContain("if (opcoes.aceitarDesalinhado) {");
    expect(preparar).toContain("recorte_reaproveitado: !!doRecorte.reaproveitado,");
    // Derivada aceita não finge pixels originais.
    expect(preparar).toContain("const derivada = doRecorte.aceito ? DERIVADA_DO_RECORTE_ACEITO : derivadaDoPreparo(modo, rota);");
    expect(preparar).toContain("...(doRecorte.aceito ? TAGS_DO_RECORTE_ACEITO : []),");
    // O fundo branco continua como estava (erro explícito, sem guardar).
    expect(preparar).toContain("final = await comporSobreBranco(await recortar());");
    // A volta guardada é procurada no Storage da pasta do cliente, pela foto.
    const guardadoFn = corpoDe(f, "recorteDoGeradorGuardado");
    expect(guardadoFn).toContain('servico().storage.from("mesa").list(pasta, { search: imagemId');
    expect(guardadoFn).toContain("recorteGuardadoMaisNovo(");
  });
});
