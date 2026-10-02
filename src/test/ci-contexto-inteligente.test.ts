import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  aplicarMudancas,
  conferirMudancas,
  handleDoPerfil,
  identidadeQueVale,
  linhasDasDiretrizesParaTela,
  normalizarDiretrizes,
  normalizarMudancas,
  perfisQueValem,
  reverterMudancas,
  secaoDasDiretrizes,
  TITULO_DAS_DIRETRIZES,
} from "../../supabase/functions/_shared/diretrizes-da-marca";
import {
  acaoDasDiretrizes,
  conferirKit,
  conferirNasMesas,
  conferirNoBanco,
  entradaDaSintese,
  escolherPostsParaSintese,
  executarAjusteDasDiretrizes,
  ESQUEMA_DAS_DIRETRIZES,
  gravarIdentidade,
  identidadeDaSintese,
  MESAS_CONFERIDAS,
  mudancasComOJev,
  mudancasFeitas,
  perguntasDoJev,
  REGRAS_DAS_DIRETRIZES,
  reverterAjusteDasDiretrizes,
  sintesePrecisaRefazer,
  textoDoTeste,
} from "../../supabase/functions/agente-contexto/modulos/diretrizes-na-conversa";
import { executarDireto, podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { montarBlocoDoPacote, pacoteVazio, itensUsados, linhaDoUsando, AREAS_DO_CONTEXTO } from "../../supabase/functions/_shared/contexto-completo-regras";
import { esquecerContextoCompleto, lerContextoCompletoDaMarca } from "../../supabase/functions/_shared/contexto-completo-da-marca";
import { esquecerMarcas } from "../../supabase/functions/_shared/marca";
import { normalizarAcoesDoContexto, pedeAcaoNoContexto } from "../../supabase/functions/agente-contexto/acoes-do-contexto";
import { camposDoConsolidado } from "@/components/mesa/ContextoAutomatico";
import { bancoFalso, clienteComDuasMarcas } from "./fixtures/sync-marcas";

/**
 * Frente CI (02/10/2026): "o agente de contexto tem que ser muito mais
 * inteligente, tem que testar; tudo que eu mandar ali ele já tem que alterar
 * e fazer; ler os perfis de referência e gerar a base; refletir em TODAS as
 * mesas da marca".
 */

const CLIENTE = "c0000000-0000-4000-8000-000000000001";
const ACERBI = "a0000000-0000-4000-8000-00000000000a";
const CME = "b0000000-0000-4000-8000-00000000000b";
const AGORA = "2026-10-02T12:00:00.000Z";
const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

let n = 0;
const opcoes = () => ({ agora: AGORA, gerarId: () => `id${++n}` });

beforeEach(() => {
  esquecerContextoCompleto();
  esquecerMarcas();
  n = 0;
});

// ------------------------------------------------------------------ mudanças nas diretrizes

describe("o que o dono manda vira mudança concreta nas diretrizes", () => {
  it("evitar e preferir entram sem repetir; o pedido novo tira a contradição antiga", () => {
    const um = aplicarMudancas(null, normalizarMudancas({ evitar: [{ texto: "Fundo rosa chapado", area: "arte", origem: "dono" }], preferir: ["Foto real do balcão"] })!, opcoes());
    expect(um.diretrizes.evitar.map((i) => i.texto)).toEqual(["Fundo rosa chapado"]);
    expect(um.diretrizes.evitar[0].area).toBe("arte");
    expect(um.diretrizes.preferir.map((i) => i.texto)).toEqual(["Foto real do balcão"]);
    expect(um.resumo).toEqual(["Evitar (artes): Fundo rosa chapado", "Preferir: Foto real do balcão"]);
    // "o cliente não gostou da foto do balcão": sai do preferir e entra no evitar.
    const dois = aplicarMudancas(um.diretrizes, normalizarMudancas({ evitar: [{ texto: "foto real do balcao", area: "geral", origem: "cliente" }] })!, opcoes());
    expect(dois.diretrizes.preferir).toEqual([]);
    expect(dois.diretrizes.evitar.map((i) => i.texto)).toEqual(["Fundo rosa chapado", "foto real do balcao"]);
    expect(dois.diretrizes.evitar[1].origem).toBe("cliente");
    // Repetido não entra.
    const tres = aplicarMudancas(dois.diretrizes, normalizarMudancas({ evitar: ["FUNDO ROSA CHAPADO"] })!, opcoes());
    expect(tres.resumo).toEqual([]);
    expect(tres.diretrizes.evitar.length).toBe(2);
  });

  it("remover tira pelo trecho; excluir e voltar a seguir mexem só no @", () => {
    const base = aplicarMudancas(null, normalizarMudancas({ evitar: ["texto pequeno demais nas artes"], excluir_perfis: [{ handle: "@Doces.Da.Vovo", motivo: "estilo infantil" }] })!, opcoes()).diretrizes;
    expect(base.perfis_excluidos).toEqual([{ handle: "doces.da.vovo", motivo: "estilo infantil", em: AGORA }]);
    const r = aplicarMudancas(base, normalizarMudancas({ remover: ["texto pequeno"], voltar_a_seguir: ["doces.da.vovo"] })!, opcoes());
    expect(r.diretrizes.evitar).toEqual([]);
    expect(r.diretrizes.perfis_excluidos).toEqual([]);
    expect(r.resumo).toEqual(["Tirei das diretrizes: texto pequeno", "Voltar a seguir @doces.da.vovo"]);
  });

  it("Desfazer tira só o que a ação pôs (a mudança feita depois fica)", () => {
    const a = aplicarMudancas(null, normalizarMudancas({ evitar: ["Fundo rosa"], excluir_perfis: ["@fulano"] })!, opcoes());
    const b = aplicarMudancas(a.diretrizes, normalizarMudancas({ preferir: ["Luz natural"] })!, opcoes());
    const volta = reverterMudancas(b.diretrizes, a.desfazer, AGORA);
    expect(volta.evitar).toEqual([]);
    expect(volta.perfis_excluidos).toEqual([]);
    expect(volta.preferir.map((i) => i.texto)).toEqual(["Luz natural"]);
    // Desfazer de um "remover" devolve o item.
    const c = aplicarMudancas(b.diretrizes, normalizarMudancas({ remover: ["Luz natural"] })!, opcoes());
    expect(c.diretrizes.preferir).toEqual([]);
    expect(reverterMudancas(c.diretrizes, c.desfazer, AGORA).preferir.map((i) => i.texto)).toEqual(["Luz natural"]);
  });

  it("lixo do modelo não vira mudança; @ inválido cai", () => {
    expect(normalizarMudancas(null)).toBeNull();
    expect(normalizarMudancas({ evitar: [], preferir: [], remover: [], excluir_perfis: [], voltar_a_seguir: [] })).toBeNull();
    expect(normalizarMudancas({ excluir_perfis: [{ handle: "não é um @ válido!", motivo: "" }] })).toBeNull();
    expect(handleDoPerfil("https://instagram.com/Fulano_1/")).toBe("fulano_1");
    expect(normalizarDiretrizes("lixo")).toEqual({ evitar: [], preferir: [], perfis_excluidos: [], identidade_referencia: null, atualizado_em: null });
  });

  it("o esquema da conversa não tem união (cabe na Anthropic) e pede todas as listas", () => {
    expect(ESQUEMA_DAS_DIRETRIZES.required).toEqual(["evitar", "preferir", "remover", "excluir_perfis", "voltar_a_seguir"]);
    expect(JSON.stringify(ESQUEMA_DAS_DIRETRIZES)).not.toContain('"null"');
  });
});

// ------------------------------------------------------------------ Jev

describe("o Jev confere que é ajuste duradouro e resolve \"aquele perfil\"", () => {
  const perfis = [{ handle: "padaria.bela", nome: "Padaria Bela" }, { handle: "doces.da.vovo", nome: "Doces da Vovó" }];

  it("pergunta noul do ajuste e choice só para o @ que não está cadastrado", () => {
    const m = normalizarMudancas({ excluir_perfis: [{ handle: "vovo", motivo: "infantil" }, { handle: "padaria.bela", motivo: "" }] })!;
    const q = perguntasDoJev("não quero que siga aquele da vovó", [], m, perfis);
    expect(q.questions.ajuste.type).toBe("noul");
    expect(Object.keys(q.questions)).toEqual(["ajuste", "perfil_1"]);
    expect(q.questions.perfil_1.type).toBe("choice");
    expect(Object.keys((q.questions.perfil_1 as { criteria: Record<string, string> }).criteria)).toEqual(["p1", "p2", "nenhum"]);
    expect(q.perfilDaPergunta).toEqual({ perfil_1: "vovo" });
  });

  it("o perfil escolhido pelo Jev troca o @; incerto só fica se a equipe escreveu o @", () => {
    const m = normalizarMudancas({ excluir_perfis: [{ handle: "vovo", motivo: "infantil" }] })!;
    const certo = mudancasComOJev(m, "não siga aquele da vovó", perfis, { ajuste: { noul: 0.9 }, perfil_1: { choice: "p2", confidence: 0.8 } }, { perfil_1: "vovo" });
    expect(certo.mudancas!.excluir_perfis).toEqual([{ handle: "doces.da.vovo", motivo: "infantil" }]);
    const incerto = mudancasComOJev(m, "não siga aquele da vovó", perfis, { ajuste: { noul: 0.9 }, perfil_1: { choice: "nenhum", confidence: 0.9 } }, { perfil_1: "vovo" });
    expect(incerto.mudancas).toBeNull();
    const escrito = mudancasComOJev(m, "não siga o @vovo", perfis, null, { perfil_1: "vovo" });
    expect(escrito.mudancas!.excluir_perfis[0].handle).toBe("vovo");
  });

  it("pergunta solta não grava (noul baixo); sem o Jev segue o modelo", () => {
    const m = normalizarMudancas({ evitar: ["Fundo rosa"] })!;
    expect(mudancasComOJev(m, "e se a gente evitasse rosa?", perfis, { ajuste: { noul: 0.1 } }, {}).mudancas).toBeNull();
    expect(mudancasComOJev(m, "evita rosa", perfis, null, {}).mudancas!.evitar[0].texto).toBe("Fundo rosa");
  });
});

// ------------------------------------------------------------------ feito na hora, no lugar certo, e testado

describe("a ação é feita na hora, na marca certa, com Desfazer, e o agente testa", () => {
  it("sem custo e com reverso: vai direto; o cliente (principal) grava no kit sem perder o resto do contexto", async () => {
    const { db, tabelas } = bancoFalso(clienteComDuasMarcas());
    const m = normalizarMudancas({ evitar: [{ texto: "Fundo rosa chapado", area: "arte", origem: "cliente" }], excluir_perfis: [{ handle: "doces.da.vovo", motivo: "infantil" }] })!;
    const acao = acaoDasDiretrizes(m, { clientId: CLIENTE, marcaId: null, marcaNome: "Acerbi" })!;
    expect(acao.itens.map((i) => i.titulo)).toEqual(["Evitar: Fundo rosa chapado", "Não seguir @doces.da.vovo"]);
    expect(podeExecutarDireto(acao, REGRAS_DAS_DIRETRIZES, { pedidoClaro: true, maxItens: 12 }).direto).toBe(true);
    const feita = await executarDireto(acao, (item, ac) => executarAjusteDasDiretrizes(db, CLIENTE, item, ac, { userId: "u1", agora: () => AGORA, gerarId: () => `id${++n}` }), { userId: "u1" });
    expect(feita.resultados!.every((r) => r.ok)).toBe(true);
    const kit = tabelas.cliente_kit_marca[0];
    expect(kit.contexto.negocio).toBe("Pernil artesanal");
    expect(kit.contexto.diretrizes.evitar[0].texto).toBe("Fundo rosa chapado");
    expect(kit.contexto.diretrizes.perfis_excluidos[0].handle).toBe("doces.da.vovo");
    // A CME (outra marca) não recebe nada da Acerbi.
    expect(tabelas.cliente_marcas[1].contexto.diretrizes).toBeUndefined();

    // O teste do agente: relê o banco e o que cada mesa lê.
    const feitas = mudancasFeitas(feita);
    const banco = await conferirNoBanco(db, CLIENTE, null, feitas);
    expect(banco).toEqual({ ok: true, conferidos: ['evitar "Fundo rosa chapado"', "não seguir @doces.da.vovo"], faltaram: [] });
    const pacote = await lerContextoCompletoDaMarca(db, CLIENTE, ACERBI, { semCache: true });
    const mesas = conferirNasMesas(pacote, feitas);
    expect(mesas.ok).toBe(true);
    expect(mesas.mesas).toEqual(MESAS_CONFERIDAS.map((x) => x.nome));
    expect(textoDoTeste(banco, mesas, null)).toContain("as 2 mudanças estão gravadas");
    // A CME não vê as diretrizes da Acerbi.
    const cme = await lerContextoCompletoDaMarca(db, CLIENTE, CME, { semCache: true });
    expect(montarBlocoDoPacote(cme, { area: "arte" })).not.toContain("Fundo rosa chapado");

    // Desfazer item a item, na ordem inversa.
    for (const r of feita.resultados!.slice().reverse()) await reverterAjusteDasDiretrizes(db, CLIENTE, r, { userId: "u1", agora: () => AGORA });
    expect(tabelas.cliente_kit_marca[0].contexto.diretrizes.evitar).toEqual([]);
    expect(tabelas.cliente_kit_marca[0].contexto.diretrizes.perfis_excluidos).toEqual([]);
    expect(tabelas.cliente_kit_marca[0].contexto.negocio).toBe("Pernil artesanal");
  });

  it("outra marca (CME): grava SÓ na linha dela, e todas as mesas da CME leem", async () => {
    const { db, tabelas } = bancoFalso(clienteComDuasMarcas());
    const m = normalizarMudancas({ preferir: [{ texto: "Aula gravada em close nas mãos", area: "video", origem: "dono" }] })!;
    const acao = acaoDasDiretrizes(m, { clientId: CLIENTE, marcaId: CME, marcaNome: "CME" })!;
    expect(acao.resumo).toContain("da CME");
    const feita = await executarDireto(acao, (item, ac) => executarAjusteDasDiretrizes(db, CLIENTE, item, ac, { userId: "u1", agora: () => AGORA }), { userId: "u1" });
    expect(feita.resultados![0].ok).toBe(true);
    expect(tabelas.cliente_marcas[1].contexto.diretrizes.preferir[0].texto).toBe("Aula gravada em close nas mãos");
    expect(tabelas.cliente_marcas[1].contexto.negocio).toBe("Cursos de corte da CME");
    expect(tabelas.cliente_kit_marca[0].contexto.diretrizes).toBeUndefined();
    const pacote = await lerContextoCompletoDaMarca(db, CLIENTE, CME, { semCache: true });
    const mesas = conferirNasMesas(pacote, mudancasFeitas(feita));
    expect(mesas.ok).toBe(true);
    // Diretriz de vídeo aparece nas mesas de vídeo e fica fora da de Foto (área diferente), sem falhar o teste.
    expect(montarBlocoDoPacote(pacote, { area: "video", partes: ["estrategia"] })).toContain("Aula gravada em close nas mãos");
    expect(montarBlocoDoPacote(pacote, { area: "foto", partes: ["estrategia"] })).not.toContain("Aula gravada");
  });

  it("marca de outro cliente: recusa (nunca grava fora do cliente)", async () => {
    const { db } = bancoFalso(clienteComDuasMarcas());
    const acao = acaoDasDiretrizes(normalizarMudancas({ evitar: ["x qualquer coisa"] })!, { clientId: "c0000000-0000-4000-8000-000000000099", marcaId: CME, marcaNome: "CME" })!;
    await expect(executarAjusteDasDiretrizes(db, "c0000000-0000-4000-8000-000000000099", acao.itens[0], acao, { userId: "u1" })).rejects.toThrow("não é mais deste cliente");
  });

  it("o teste acusa o que não gravou e o kit conferido campo a campo", () => {
    const lidas = normalizarDiretrizes({ evitar: [{ id: "a", texto: "Fundo rosa" }] });
    const c = conferirMudancas(lidas, normalizarMudancas({ evitar: ["Fundo rosa", "Letra fina"], excluir_perfis: ["@x.y"] })!);
    expect(c.ok).toBe(false);
    expect(c.faltaram).toEqual(['evitar "Letra fina"', "não seguir @x.y"]);
    expect(textoDoTeste(c, null, null)).toContain("1 de 3");
    const kitFeito = {
      tipo: "acao_agente" as const, agente: "contexto", id: "k", resumo: "", ignorados: [], recusados: [],
      itens: [
        { ref: "e1", alvo_id: "estilo", titulo: "", detalhe: null, operacao: "kit_estilo", rotulo: "gravar", para: null },
        { ref: "c1", alvo_id: "tom_de_voz", titulo: "", detalhe: null, operacao: "preencher_contexto", rotulo: "preencher", para: null },
      ],
      contexto: { dados: { "kit_estilo:e1": { estilo: "Luz natural" }, "preencher_contexto:c1": { campo: "tom_de_voz", valor: "direto" } } },
      resultados: [{ ref: "e1", alvo_id: "estilo", titulo: "", operacao: "kit_estilo", ok: true }, { ref: "c1", alvo_id: "tom_de_voz", titulo: "", operacao: "preencher_contexto", ok: true }],
    };
    expect(conferirKit({ estilo: "Luz natural", contexto: { tom_de_voz: "direto" } }, kitFeito)).toEqual({ ok: true, conferidos: ["estilo", "tom de voz"], faltaram: [] });
    expect(conferirKit({ estilo: "outro", contexto: {} }, kitFeito).faltaram).toEqual(["estilo", "tom de voz"]);
  });
});

// ------------------------------------------------------------------ todas as mesas

describe("todas as mesas recebem as diretrizes (qualquer área, quaisquer partes)", () => {
  const comDiretrizes = () => ({
    ...pacoteVazio(CLIENTE, "Acerbi"),
    diretrizes: normalizarDiretrizes({
      evitar: [{ id: "1", texto: "Fundo rosa chapado", area: "arte" }, { id: "2", texto: "Gíria de adolescente", area: "copy" }],
      preferir: [{ id: "3", texto: "Close nas mãos", area: "geral" }],
      perfis_excluidos: [{ handle: "doces.da.vovo", motivo: "infantil" }],
    }),
  });

  it("vem mesmo quando a mesa pede só estratégia; filtra por área; o @ excluído vai em todas", () => {
    const p = comDiretrizes();
    for (const area of AREAS_DO_CONTEXTO) {
      const b = montarBlocoDoPacote(p, { area, partes: ["estrategia"], semTitulo: true });
      expect(b, area).toContain(TITULO_DAS_DIRETRIZES);
      expect(b, area).toContain("Close nas mãos");
      expect(b, area).toContain("@doces.da.vovo");
    }
    expect(montarBlocoDoPacote(p, { area: "arte", partes: ["estrategia"] })).toContain("Fundo rosa chapado");
    expect(montarBlocoDoPacote(p, { area: "arte", partes: ["estrategia"] })).not.toContain("Gíria");
    expect(montarBlocoDoPacote(p, { area: "copy", partes: ["estrategia"] })).toContain("Gíria de adolescente");
    expect(montarBlocoDoPacote(p, { area: "copy", partes: ["estrategia"], semDiretrizes: true })).toBe("");
    expect(linhaDoUsando(itensUsados(p))).toBe("Usando: marca Acerbi (contexto ainda vazio), diretrizes do dono (4).");
  });

  it("nunca passa do teto, com diretrizes enormes", () => {
    const p = comDiretrizes();
    p.diretrizes!.evitar = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, texto: `coisa ${i} ${"muito longa ".repeat(20)}`, area: "geral" as const, origem: "dono" as const, em: AGORA }));
    for (const teto of [600, 1500, 4000, 16_000]) expect(montarBlocoDoPacote(p, { area: "ads", teto }).length).toBeLessThanOrEqual(teto);
  });

  it("o contexto da marca não despeja o JSON das diretrizes", () => {
    const p = { ...comDiretrizes(), contexto: { negocio: "Pernil", diretrizes: { evitar: [{ texto: "Fundo rosa chapado" }] } } };
    const b = montarBlocoDoPacote(p, { area: "geral", partes: ["contexto"], semDiretrizes: true });
    expect(b).toContain("Negócio: Pernil");
    expect(b).not.toContain("diretrizes");
  });

  it("a tela de Contexto mostra as diretrizes preenchidas (e não reclama das vazias)", () => {
    const { cheios, vazios } = camposDoConsolidado({
      client_id: "c", paleta: null, logo_file_id: null, estilo: null, regras: null, contexto_atualizado_em: null,
      contexto: { negocio: "Loja", diretrizes: { evitar: [{ texto: "Fundo rosa" }], perfis_excluidos: ["@fulano"] } },
    });
    expect(cheios.map((c) => c.rotulo)).toEqual(["Negócio", "Evitar", "Perfis que a marca não segue"]);
    expect(vazios.join(" ")).not.toContain("Evitar");
    expect(linhasDasDiretrizesParaTela(null)).toEqual([]);
  });
});

// ------------------------------------------------------------------ perfis de referência

describe("perfis de referência: a identidade vira base, o excluído não influencia", () => {
  const identidade = {
    visual: "fundo claro, foto grande, título curto",
    video: "cortes rápidos de 1 s, gancho com a mão no produto",
    tom: "próximo e direto",
    formatos: "reels de bastidor",
    levar: "bastidor",
    nao_levar: "copiar texto",
    perfis: ["padaria.bela", "doces.da.vovo"],
    por_perfil: [
      { handle: "padaria.bela", visual: "luz natural no balcão", video: "POV do padeiro", tom: "caloroso", formatos: "receita em 3 passos" },
      { handle: "doces.da.vovo", visual: "cores infantis", video: "trend de dança", tom: "infantil", formatos: "meme" },
    ],
    posts: 18,
    gerado_em: AGORA,
  };

  it("sem exclusão, a síntese inteira; com exclusão, só o que o perfil que ficou trouxe", () => {
    const inteira = identidadeQueVale(normalizarDiretrizes({ identidade_referencia: identidade }))!;
    expect(inteira.refazer).toBe(false);
    expect(inteira.identidade.video).toContain("cortes rápidos");
    const parcial = identidadeQueVale(normalizarDiretrizes({ identidade_referencia: identidade, perfis_excluidos: ["doces.da.vovo"] }))!;
    expect(parcial.refazer).toBe(true);
    expect(parcial.identidade.perfis).toEqual(["padaria.bela"]);
    const texto = JSON.stringify(parcial.identidade.visual + parcial.identidade.video + parcial.identidade.tom + parcial.identidade.formatos);
    expect(texto).toContain("POV do padeiro");
    for (const vazado of ["infantis", "dança", "meme", "cortes rápidos"]) expect(texto).not.toContain(vazado);
    const secao = secaoDasDiretrizes(normalizarDiretrizes({ identidade_referencia: identidade, perfis_excluidos: ["doces.da.vovo"] }), "video");
    expect(secao).toContain("Vídeo e pegada: @padaria.bela: POV do padeiro");
    expect(secao).not.toContain("trend de dança");
    expect(identidadeQueVale(normalizarDiretrizes({ identidade_referencia: identidade, perfis_excluidos: ["doces.da.vovo", "padaria.bela"] }))).toBeNull();
    expect(perfisQueValem([{ handle: "padaria.bela" }, { handle: "doces.da.vovo" }], normalizarDiretrizes({ perfis_excluidos: ["@doces.da.vovo"] }))).toEqual([{ handle: "padaria.bela" }]);
  });

  it("tirar um perfil da síntese pede para refazê-la", () => {
    expect(sintesePrecisaRefazer(["padaria.bela"], normalizarMudancas({ excluir_perfis: ["padaria.bela"] })!)).toBe(true);
    expect(sintesePrecisaRefazer(["padaria.bela"], normalizarMudancas({ excluir_perfis: ["outro"] })!)).toBe(false);
    expect(sintesePrecisaRefazer(null, normalizarMudancas({ excluir_perfis: ["padaria.bela"] })!)).toBe(false);
  });

  it("a entrada da síntese usa o que a perfis-instagram guardou, com os vídeos sempre dentro", () => {
    const posts = Array.from({ length: 15 }, (_, i) => ({ formato: i < 2 ? "reel" : "foto", formato_editorial: "bastidor", legenda: `legenda ${i}`, leitura: i % 2 ? `leitura ${i}` : null, engajamento: 100 - i, fora_da_curva: i === 14 }));
    const escolhidos = escolherPostsParaSintese(posts);
    expect(escolhidos.length).toBe(10);
    expect(escolhidos.filter((p) => p.formato === "reel").length).toBe(2);
    const entrada = entradaDaSintese([{ handle: "padaria.bela", nome: "Padaria", resumo: { padrao_visual: "luz natural" }, posts }], "Acerbi");
    expect(entrada).toContain("PERFIL @padaria.bela");
    expect(entrada).toContain("padrao visual: luz natural");
    expect(entrada).toContain("reel");
    const ident = identidadeDaSintese({ visual: "v", video: "vid", tom: "t", formatos: "f", levar: "", nao_levar: "", por_perfil: [{ handle: "@padaria.bela", visual: "a", video: "b", tom: "c", formatos: "d" }, { handle: "intruso", visual: "x", video: "", tom: "", formatos: "" }] }, [{ handle: "padaria.bela", nome: null, resumo: null, posts }], AGORA)!;
    expect(ident.perfis).toEqual(["padaria.bela"]);
    expect(ident.por_perfil.map((p) => p.handle)).toEqual(["padaria.bela"]);
    expect(ident.posts).toBe(10);
    expect(identidadeDaSintese({}, [], AGORA)).toBeNull();
  });

  it("a identidade grava na marca certa e o Desfazer volta a de antes", async () => {
    const { db, tabelas } = bancoFalso(clienteComDuasMarcas());
    const r = await gravarIdentidade(db, CLIENTE, CME, normalizarDiretrizes({ identidade_referencia: identidade }).identidade_referencia, { userId: "u1", agora: () => AGORA });
    expect(r.antes).toBeNull();
    expect(tabelas.cliente_marcas[1].contexto.diretrizes.identidade_referencia.perfis).toEqual(["padaria.bela", "doces.da.vovo"]);
    expect(tabelas.cliente_kit_marca[0].contexto.diretrizes).toBeUndefined();
    const pacote = await lerContextoCompletoDaMarca(db, CLIENTE, CME, { semCache: true });
    expect(montarBlocoDoPacote(pacote, { area: "video", partes: ["marca"] })).toContain("Vídeo e pegada: cortes rápidos");
    await gravarIdentidade(db, CLIENTE, CME, r.antes, { userId: "u1", agora: () => AGORA });
    expect(tabelas.cliente_marcas[1].contexto.diretrizes.identidade_referencia).toBeNull();
  });

  it("x3 sintetizar_perfis: com custo, pede Confirmar e trava sem perfil seguido", () => {
    const dados = { kit: null, referencias: [], fotos: [], nos: [], pendentes: 0, montado_em: null, perfis: { seguidos: 2, excluidos: 1, identidade_em: null } };
    const acao = normalizarAcoesDoContexto({ resumo: "Gerar", itens: [{ operacao: "sintetizar_perfis", ref: "x3", para: "" }] }, dados, CLIENTE)!;
    expect(acao.itens.map((i) => i.operacao)).toEqual(["sintetizar_perfis"]);
    expect(acao.custo_estimado_usd).toBeGreaterThan(0);
    const semPerfil = normalizarAcoesDoContexto({ resumo: "Gerar", itens: [{ operacao: "sintetizar_perfis", ref: "x3", para: "" }] }, { ...dados, perfis: { seguidos: 0, excluidos: 0, identidade_em: null } }, CLIENTE);
    expect(semPerfil ? semPerfil.itens.length : 0).toBe(0);
    expect(pedeAcaoNoContexto("lê os perfis de referência e gera a base")).toBe(true);
    expect(pedeAcaoNoContexto("não quero seguir o @padaria.bela")).toBe(true);
  });
});

// ------------------------------------------------------------------ ligações no código

describe("ligações: conversa, montagem, perfis e motores", () => {
  it("a conversa aplica, testa e responde com o teste; a montagem não apaga as diretrizes", () => {
    const f = ler("supabase/functions/agente-contexto/index.ts");
    expect(f).toContain("diretrizes: ESQUEMA_DAS_DIRETRIZES,");
    expect(f).toContain("REGRAS_DAS_DIRETRIZES_NO_PROMPT,");
    expect(f).toContain("const dir = await diretrizesDaConversa(ch,");
    expect(f).toContain("await testarMudancas(clientId, marcaDaConversa, dir.mudancas, kitFeito)");
    expect(f).toContain("if (teste && teste.texto) resposta = ");
    expect(f).toContain('CHAVES_DO_PLANO_NO_CONTEXTO.concat(["diretrizes"])');
    expect(f).toContain("jevPerguntar({ state: q.state, questions: q.questions })");
    expect(f).toContain('if (item.operacao === "sintetizar_perfis") return sintetizarPerfis(ch, clientId, marca);');
    expect(f).toContain("if (r.operacao === OPERACAO_DAS_DIRETRIZES) {");
  });

  it("perfil que a marca não segue não vira plano, ideia nem estilo; a lista mostra o selo", () => {
    const f = ler("supabase/functions/perfis-instagram/index.ts");
    expect(f.split("await garantirQueAMarcaSegue(clientId, perfil);").length - 1).toBe(4);
    expect(f).toContain('nao_seguir: p.papel === "referencia" && perfilExcluido(diretrizes, p.handle),');
  });

  it("a síntese está registrada nos motores (sem método de propósito: é leitura)", () => {
    expect(ler("supabase/functions/_shared/motores.ts")).toContain('"agente-contexto/index.ts#sintetizarPerfis": "leituras",');
  });

  it("arquivos novos sem travessão e sem regex que o Safari 11 não lê", () => {
    for (const rel of ["supabase/functions/_shared/diretrizes-da-marca.ts", "supabase/functions/agente-contexto/modulos/diretrizes-na-conversa.ts"]) {
      const t = ler(rel);
      expect(t, rel).not.toContain(String.fromCharCode(0x2014));
      expect(t, rel).not.toMatch(/\(\?<[=!]|\\p\{|\(\?<[a-z]/i);
    }
  });
});
