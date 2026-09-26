import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avaliarRevisao,
  briefingVazio,
  campanhaVazia,
  classeDoCriterio,
  enderecoDoDestino,
  lacunasDoBriefing,
  montarLinhagem,
  motivoDaReprovacao,
  normalizarBriefing,
  normalizarCampanha,
  normalizarTerritorios,
  normalizarTomadas,
  paraEncaminhar,
  pedidoParaMesaFoto,
  planoDeTomadas,
  podeAprovar,
  statusDaCampanha,
  versoesDoEnsaio,
  type CampanhaDePublicidade,
  type ConferenciaLida,
  type RevisaoDePublicidade,
  type Territorio,
} from "../../supabase/functions/mesa-publicidade/regras";
import {
  alvosDaPublicidade,
  normalizarAcoesDaPublicidade,
  OPERACOES_DA_PUBLICIDADE,
} from "../../supabase/functions/mesa-publicidade/acoes-da-publicidade";
import { RECEITAS_DE_PUBLICIDADE, receitaDaCategoria, receitaParaProduto } from "../../supabase/functions/_shared/receitas-de-publicidade";
import { conhecimentoPublicidade } from "../../supabase/functions/_shared/conhecimento-publicidade";
import { MOTORES, motoresDaFonte } from "../../supabase/functions/_shared/motores";
import { CRITERIOS_CONFERENCIA, CRITERIOS_DA_TOMADA } from "../../supabase/functions/mesa-foto/receitas";

/**
 * Mesa Publicidade (frente P, 26/09): as regras puras que a função e a tela
 * dividem. Normalização de territórios e tomadas, a regra de reprovação por
 * mudança de produto, o encaminhamento com linhagem, o agente com ações
 * confirmadas e o conhecimento registrado nos motores.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENTE = U(1);

const territorioBruto = (nome: string, extra: Record<string, unknown> = {}) => ({
  nome,
  conceito: `Conceito de ${nome} com o produto real.`,
  tensao_humana: "Escolher algo que combine com a rotina.",
  promessa: "Estilo que acompanha o dia.",
  razao_para_acreditar: "Armação leve (confirmada).",
  direcao_de_arte: { paleta: ["#1a2b3c", "azul"], luz: "luz dura lateral", tratamento: "editorial", enquadramentos: "médio e close" },
  casting: { perfil: "mulher urbana", idade_aprox: 30, estilo: "minimalista", figurino: "camisa azul" },
  ambiente: "rua de centro histórico",
  referencias: ["editorial de moda"],
  riscos: ["clichê de café"],
  por_que_combina: "Marca urbana.",
  ...extra,
});

function conferencia(pontos: Array<[string, boolean | null, string?]>, extra: Partial<ConferenciaLida> = {}): ConferenciaLida {
  return { pontos: pontos.map(([criterio, ok, nota]) => ({ criterio, ok, nota: nota || "" })), alertas: [], resumo: "", aviso_jev: false, conferida_em: "2026-09-26T00:00:00Z", ...extra };
}

function territorioAprovado(): Territorio {
  const t = normalizarTerritorios([territorioBruto("Rotina urbana")]).territorios[0];
  return { ...t, id: U(50), status: "aprovado" };
}

function revisao(n: number, extra: Partial<RevisaoDePublicidade> = {}): RevisaoDePublicidade {
  return {
    id: U(100 + n),
    tomada_id: null,
    foto_tomada_id: `t${n}`,
    versao: 1,
    imagem_id: U(200 + n),
    storage_path: `${CLIENTE}/foto/v${n}.png`,
    avaliacao: avaliarRevisao(conferencia([["Produto e variante iguais às fontes", true]])),
    aviso_jev: null,
    decisao: null,
    motivo: "",
    decidido_em: null,
    ...extra,
  };
}

function campanhaCompleta(extra: Partial<CampanhaDePublicidade> = {}): CampanhaDePublicidade {
  const t = territorioAprovado();
  const briefing = normalizarBriefing({ publico: "adultos urbanos", destino: "WhatsApp", oferta: { texto: "10% no Pix", fonte: "site", status: "confirmado" }, restricoes: { logo: "logo na haste", cor_da_variante: "tartaruga mel", detalhes: ["ponte de metal"] } });
  const tomadas = planoDeTomadas(t, receitaDaCategoria("oculos"), briefing).map((x, i) => ({ ...x, id: U(300 + i), foto_tomada_id: `t${i + 1}` }));
  return {
    ...campanhaVazia(CLIENTE),
    id: U(10),
    nome: "Óculos Aurora",
    categoria: "oculos",
    kit_id: U(20),
    kit_nome: "Óculos Aurora",
    produto_fontes: [U(21), U(22)],
    briefing,
    briefing_versao: 2,
    territorios: [t],
    territorio_id: t.id,
    tomadas,
    ensaio_id: U(30),
    persistida: true,
    ...extra,
  };
}

describe("briefing versionado", () => {
  it("oferta sem fonte nunca fica confirmada e lacunas aparecem", () => {
    const b = normalizarBriefing({ oferta: { texto: "20% off", status: "confirmado" } });
    expect(b.oferta.status).toBe("hipotese");
    expect(lacunasDoBriefing(b).join(" ")).toContain("Oferta sem fonte");
    expect(lacunasDoBriefing(briefingVazio()).length).toBeGreaterThan(2);
    const semTexto = normalizarBriefing({ oferta: { texto: "", fonte: "site", status: "confirmado" } });
    expect(semTexto.oferta.status).toBe("pendente");
    expect(normalizarBriefing({ formatos: ["4:5", "3:7", "9:16"] }).formatos).toEqual(["4:5", "9:16"]);
  });
});

describe("territórios", () => {
  it("no máximo três, sem repetidos, com casting adulto e paleta limpa", () => {
    const r = normalizarTerritorios({
      territorios: [
        territorioBruto("Expressão pessoal", { casting: { perfil: "jovem", idade_aprox: 16, estilo: "", figurino: "" } }),
        territorioBruto("expressao PESSOAL"),
        territorioBruto("Rotina urbana"),
        { nome: "Sem conceito" },
        territorioBruto("Presente"),
        territorioBruto("Quarto a mais"),
      ],
    });
    expect(r.territorios.map((t) => t.nome)).toEqual(["Expressão pessoal", "Rotina urbana", "Presente"]);
    expect(r.territorios[0].casting.idade_aprox).toBe(21);
    expect(r.territorios[0].direcao_de_arte.paleta[0]).toBe("#1A2B3C");
    expect(r.territorios.every((t) => t.status === "proposto" && t.ordem >= 1)).toBe(true);
    expect(r.avisos.join(" ")).toContain("repetido");
  });

  it("menos de três volta com aviso (não inventa o que faltou)", () => {
    const r = normalizarTerritorios([territorioBruto("Único")], 3);
    expect(r.territorios).toHaveLength(1);
    expect(r.territorios[0].briefing_versao).toBe(3);
    expect(r.avisos.join(" ")).toContain("1 de 3");
    expect(normalizarTerritorios(null).territorios).toEqual([]);
  });
});

describe("tomadas", () => {
  it("o plano tem seis, uma por função, na ordem; espaço para texto só na última", () => {
    const b = normalizarBriefing({ formatos: ["4:5", "9:16"] });
    const plano = planoDeTomadas(territorioAprovado(), receitaDaCategoria("oculos"), b);
    expect(plano.map((t) => t.funcao)).toEqual(["atrair", "apresentar_produto", "contextualizar_uso", "mostrar_detalhe", "expressar_conceito", "apoiar_acao"]);
    expect(plano.map((t) => t.formato)).toEqual(["4:5", "9:16", "4:5", "9:16", "4:5", "9:16"]);
    expect(plano.filter((t) => t.espaco_para_texto).map((t) => t.funcao)).toEqual(["apoiar_acao"]);
    expect(plano[1].com_pessoa).toBe(false);
    expect(plano[0].com_pessoa).toBe(true);
    expect(plano[0].descricao).toContain("óculos");
  });

  it("ajuste da equipe entra, função repetida ou lixo não quebra o plano de seis", () => {
    const base = planoDeTomadas(territorioAprovado(), null, briefingVazio());
    const r = normalizarTomadas(
      [{ funcao: "atrair", descricao: "Retrato na janela", formato: "1:1" }, { funcao: "atrair", descricao: "outro" }, { funcao: "inventada" }, null, { funcao: "mostrar_detalhe", formato: "7:3" }],
      base,
    );
    expect(r).toHaveLength(6);
    expect(r[0].descricao).toBe("Retrato na janela");
    expect(r[0].formato).toBe("1:1");
    expect(r[3].formato).toBe(base[3].formato);
    expect(normalizarTomadas("nada", base)).toEqual(base);
  });

  it("o pedido à Mesa Foto cabe em 2000 caracteres e leva o que não pode mudar", () => {
    const c = campanhaCompleta();
    const t = c.territorios[0];
    const longo = { ...c.briefing, proibido: "x".repeat(600) };
    const p = pedidoParaMesaFoto(longo, { ...t, conceito: "c".repeat(700) }, c.tomadas.map((x) => ({ ...x, descricao: "d".repeat(400) })));
    expect(p.length).toBeLessThanOrEqual(2000);
    expect(p).toContain("Não pode mudar no produto");
    expect(p).toContain("tartaruga mel");
    expect(p).toContain("fontes do kit");
    expect(p.split("\n").filter((l) => /^\d\. /.test(l))).toHaveLength(6);
    // A marca do pedido abre o texto (é por ela que o pedido caído por tempo é achado).
    const comMarca = pedidoParaMesaFoto(longo, { ...t, conceito: "c".repeat(700) }, c.tomadas, "[Mesa Publicidade 12345678]");
    expect(comMarca.indexOf("[Mesa Publicidade 12345678]")).toBe(0);
    expect(comMarca.length).toBeLessThanOrEqual(2000);
    expect(comMarca).toContain("Vista sem evidência volta como lacuna.");
  });
});

describe("revisão: produto antes da estética", () => {
  it("todo critério da conferência da Mesa Foto tem classe (produto, estética ou pessoa)", () => {
    const produto = CRITERIOS_CONFERENCIA.produto.map(classeDoCriterio);
    expect(produto).toEqual(["variante", "logo", "formato", "cor", "detalhe", "estetica", "estetica"]);
    expect(CRITERIOS_CONFERENCIA.alimento.map(classeDoCriterio)).toEqual(["detalhe", "formato", "detalhe", "detalhe", "estetica", "estetica"]);
    expect(CRITERIOS_DA_TOMADA.map(classeDoCriterio)).toEqual(["estetica", "estetica"]);
    expect(classeDoCriterio("Corpo e proporções reais")).toBe("pessoa");
    expect(classeDoCriterio("Mãos com anatomia correta")).toBe("pessoa");
    expect(classeDoCriterio("Embalagem igual às fontes (arte, cores, texto e logotipos)")).toBe("logo");
  });

  it("mudou logo, formato, cor ou detalhe: reprovada, mesmo com a estética perfeita", () => {
    const a = avaliarRevisao(
      conferencia([
        ["Produto e variante iguais às fontes", true],
        ["Rótulo e texto iguais, legíveis e sem espelhamento", false, "logo da haste sumiu"],
        ["Cor e material", false, "virou preto, não tartaruga mel"],
        ["Reflexos coerentes com o material", true],
        ["Cenário e luz pedidos", true],
      ]),
      campanhaCompleta().briefing.restricoes,
    );
    expect(a.veredito).toBe("reprovada");
    expect(a.mudancas).toEqual(["logo", "cor"]);
    expect(a.restricoes_citadas).toContain("tartaruga mel");
    expect(podeAprovar(a, true).pode).toBe(false);
    expect(motivoDaReprovacao(a)).toContain("logo ou texto, cor");
  });

  it("falha só de estética não reprova; produto sem evidência pede olho humano; sem conferência não aprova", () => {
    const estetica = avaliarRevisao(conferencia([["Produto e variante iguais às fontes", true], ["Reflexos coerentes com o material", false, "reflexo estranho"], ["Mãos com anatomia correta", false]]));
    expect(estetica.veredito).toBe("produto_ok");
    expect(estetica.estetica).toHaveLength(2);
    expect(podeAprovar(estetica).pode).toBe(true);

    const incerta = avaliarRevisao(conferencia([["Produto e variante iguais às fontes", true], ["Proporção e formato", null]]));
    expect(incerta.veredito).toBe("nao_determinavel");
    expect(podeAprovar(incerta).pode).toBe(false);
    expect(podeAprovar(incerta, true).pode).toBe(true);

    expect(avaliarRevisao(null).veredito).toBe("sem_conferencia");
    expect(podeAprovar(avaliarRevisao(null), true).pode).toBe(false);
    // O Jev nunca decide: aviso sem ponto falho continua aprovável.
    expect(avaliarRevisao(conferencia([["Produto e variante iguais às fontes", true]], { aviso_jev: true })).veredito).toBe("produto_ok");
  });

  it("lê o ensaio da Mesa Foto nos dois formatos (banco e tela)", () => {
    const banco = versoesDoEnsaio({
      tomadas: [
        { id: "a", nome: "Atrair", status: "gerada", versoes: [{ versao: 1, aprovada: false, decisao: "rejeitada" }, { versao: 2, aprovada: null, decisao: null, storage_path: "x.png", conferencia: { pendente: true } }] },
        { id: "b", nome: "Produto", status: "aprovada", versoes: [{ versao: 1, aprovada: true, imagem_id: U(9), conferencia: { pontos: [{ criterio: "Cor e material", ok: true }] } }] },
        { id: "c", nome: "Sem versão", versoes: [] },
      ],
    });
    expect(banco.map((v) => [v.foto_tomada_id, v.versao, v.decisao])).toEqual([["a", 2, null], ["b", 1, "aprovada"], ["c", 0, null]]);
    expect(banco[0].conferencia).toBeNull();
    expect(banco[1].conferencia && banco[1].conferencia.pontos).toHaveLength(1);
    const tela = versoesDoEnsaio({ tomadas: [{ id: "a", versoes: [{ versao: 1, aprovada: false, rejeitada: false }] }, { id: "b", versoes: [{ versao: 1, aprovada: false, rejeitada: true }] }] });
    expect(tela.map((v) => v.decisao)).toEqual([null, "rejeitada"]);
  });
});

describe("encaminhamento com linhagem", () => {
  it("só aprovada, com foto no acervo, produto conferido e ainda não enviada vai", () => {
    const c = campanhaCompleta({
      revisoes: [
        revisao(1, { decisao: "aprovada" }),
        revisao(2, { decisao: null }),
        revisao(3, { decisao: "aprovada", imagem_id: null }),
        revisao(4, { decisao: "aprovada", avaliacao: avaliarRevisao(conferencia([["Cor e material", false]])) }),
        revisao(5, { decisao: "aprovada" }),
        revisao(6, { decisao: "reprovada" }),
      ],
    });
    c.encaminhamentos = [{ id: "e1", destino: "ads", imagem_id: U(205), linhagem: montarLinhagem(c, c.revisoes[4]), anuncio_aprovado: false, verba_aprovada: false, criado_em: null }];
    const r = paraEncaminhar(c.revisoes, "ads", c.encaminhamentos);
    expect(r.vao.map((x) => x.foto_tomada_id)).toEqual(["t1"]);
    expect(r.ficam.map((f) => f.motivo)).toEqual([
      "Foto ainda não aprovada na revisão.",
      "A foto aprovada ainda não está no acervo.",
      "A conferência mostra mudança no produto: não vai para as mesas.",
      "Já foi para este destino.",
      "Foto reprovada.",
    ]);
    // Para a Mesa, a 5 ainda pode ir (destinos separados).
    expect(paraEncaminhar(c.revisoes, "mesa", c.encaminhamentos).vao.map((x) => x.foto_tomada_id)).toEqual(["t1", "t5"]);
    expect(paraEncaminhar(c.revisoes, "mesa", [], [U(105)]).vao.map((x) => x.foto_tomada_id)).toEqual(["t5"]);
  });

  it("a linhagem liga produto, briefing, território, tomada e versão", () => {
    const c = campanhaCompleta({ revisoes: [revisao(3, { decisao: "aprovada", versao: 2 })] });
    const l = montarLinhagem(c, c.revisoes[0]);
    expect(l).toMatchObject({
      campanha_id: U(10),
      briefing_versao: 2,
      territorio_id: U(50),
      territorio_nome: "Rotina urbana",
      funcao: "contextualizar_uso",
      tomada_id: U(302),
      ensaio_id: U(30),
      foto_tomada_id: "t3",
      versao: 2,
      imagem_id: U(203),
      kit_id: U(20),
      fontes_do_produto: [U(21), U(22)],
      veredito: "produto_ok",
    });
    expect(enderecoDoDestino("ads", CLIENTE, [U(1), U(2)])).toBe(`/mesa-ads?client=${CLIENTE}&etapa=estudio&fotos=${U(1)},${U(2)}`);
    expect(enderecoDoDestino("mesa", CLIENTE, [U(1)])).toBe(`/mesa?client=${CLIENTE}&aba=estudio&fotos=${U(1)}`);
    expect(statusDaCampanha({ ...c, encaminhamentos: [] })).toBe("em_revisao");
  });

  it("a campanha volta inteira do servidor (e do rascunho) em forma segura", () => {
    const c = campanhaCompleta({ revisoes: [revisao(1, { decisao: "aprovada" })] });
    const n = normalizarCampanha(JSON.parse(JSON.stringify(c)));
    expect(n.tomadas).toHaveLength(6);
    expect(n.tomadas[0].foto_tomada_id).toBe("t1");
    expect(n.territorio_id).toBe(U(50));
    expect(n.revisoes[0].avaliacao.veredito).toBe("produto_ok");
    expect(normalizarCampanha({ territorio_id: "inexistente", territorios: [] }, CLIENTE).territorio_id).toBeNull();
  });
});

describe("agente da mesa (ações confirmadas)", () => {
  const c = campanhaCompleta({
    territorios: [territorioAprovado(), { ...territorioAprovado(), id: U(51), nome: "Presente", status: "proposto" }],
    ensaio_id: null,
    revisoes: [
      revisao(1, { avaliacao: avaliarRevisao(conferencia([["Rótulo e texto iguais, legíveis e sem espelhamento", false]])) }),
      revisao(2, { decisao: "aprovada" }),
      revisao(3),
    ],
  });

  it("apelidos no lugar de UUID e o agente nunca vê id", () => {
    const alvos = alvosDaPublicidade(c);
    expect(alvos.map((a) => a.ref)).toEqual(["k1", "t1", "t2", "f1", "f2", "f3"]);
    expect(alvos.find((a) => a.ref === "f1")!.detalhe).toContain("produto mudou");
    expect(OPERACOES_DA_PUBLICIDADE).toEqual(["propor_territorios", "pedir_tomadas", "reprovar_foto", "mandar_para_ads", "mandar_para_mesa"]);
  });

  it("travas: reprova só quem mudou o produto; manda só aprovada; pede só com território aprovado", () => {
    const a = normalizarAcoesDaPublicidade(
      {
        resumo: "Vou reprovar e mandar.",
        itens: [
          { operacao: "reprovar_foto", ref: "f1", para: "" },
          { operacao: "reprovar_foto", ref: "f3", para: "" },
          { operacao: "mandar_para_ads", ref: "f2", para: "" },
          // f3 já está em outra operação desta lista: vai para ignorados.
          { operacao: "mandar_para_ads", ref: "f3", para: "" },
          { operacao: "mandar_para_mesa", ref: "f1", para: "" },
          { operacao: "pedir_tomadas", ref: "t2", para: "" },
          { operacao: "pedir_tomadas", ref: "t1", para: "" },
          { operacao: "reprovar_foto", ref: U(101), para: "" },
          { operacao: "propor_territorios", ref: "t1", para: "" },
        ],
      },
      c,
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["reprovar_foto:f1", "mandar_para_ads:f2", "pedir_tomadas:t1"]);
    expect(a.recusados.map((r) => r.motivo)).toEqual(["A conferência não mostra mudança no produto.", "Aprove este território antes de pedir as tomadas."]);
    expect(a.ignorados).toEqual(expect.arrayContaining(["f3", "f1", U(101).toLowerCase().slice(0, 12), "t1"]));
    const soMandar = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "mandar_para_ads", ref: "f3", para: "" }, { operacao: "mandar_para_ads", ref: "f1", para: "" }] }, c)!;
    expect(soMandar.recusados.map((r) => r.motivo)).toEqual(["Aprove a foto na revisão antes de mandar.", "Aprove a foto na revisão antes de mandar."]);
    expect(a.itens.every((i) => i.alvo_id && !String(i.titulo).includes(i.alvo_id))).toBe(true);
    expect(a.contexto).toEqual({ client_id: CLIENTE, campanha_id: U(10) });
    expect(a.sem_desfazer).toBeUndefined();
    const soReprovar = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "reprovar_foto", ref: "f1", para: "" }] }, c)!;
    expect(soReprovar.sem_desfazer).toBe(true);
  });

  it("com as tomadas já pedidas, propor e pedir ficam travados", () => {
    const pedida = { ...c, ensaio_id: U(30) };
    const a = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "propor_territorios", ref: "k1", para: "" }, { operacao: "pedir_tomadas", ref: "t1", para: "" }] }, pedida)!;
    expect(a.itens).toHaveLength(0);
    expect(a.recusados).toHaveLength(2);
  });
});

describe("receitas e conhecimento", () => {
  it("oito categorias, cada uma com as seis funções de tomada", () => {
    expect(RECEITAS_DE_PUBLICIDADE.map((r) => r.id)).toEqual(["oculos", "cosmeticos", "moda", "alimentos", "joias", "decoracao", "eletronicos", "esporte"]);
    for (const r of RECEITAS_DE_PUBLICIDADE) {
      expect(Object.keys(r.tomadas).sort(), r.id).toEqual(["apoiar_acao", "atrair", "contextualizar_uso", "expressar_conceito", "mostrar_detalhe", "apresentar_produto"].sort());
      expect(r.territorios.length, r.id).toBe(3);
      expect(r.invariantes.length, r.id).toBeGreaterThan(3);
    }
    expect(receitaParaProduto("Óculos Aurora tartaruga", "produto")!.id).toBe("oculos");
    expect(receitaParaProduto("Sérum facial", "produto")!.id).toBe("cosmeticos");
    expect(receitaParaProduto("Item X", "tecnologia")!.id).toBe("eletronicos");
    expect(receitaParaProduto("Item X", "produto")).toBeNull();
  });

  it("os motores da publicidade estão no índice, recebem os blocos e a função liga o conhecimento", () => {
    const diretor = MOTORES.find((m) => m.id === "mesa_publicidade.diretor")!;
    const agente = MOTORES.find((m) => m.id === "mesa_publicidade.agente")!;
    expect(diretor && agente).toBeTruthy();
    for (const m of [diretor, agente]) {
      const k = m.montar();
      for (const b of m.promete) expect(k.ids, `${m.id}/${b}`).toContain(b);
      expect(k.tamanho).toBeLessThanOrEqual(k.teto);
      const fonte = ler(m.ligacao.arquivo);
      for (const t of m.ligacao.trechos) expect(fonte, t).toContain(t);
    }
    expect(motoresDaFonte("kit_publicidade")).toEqual(expect.arrayContaining(["mesa_publicidade.diretor", "mesa_publicidade.agente"]));
    expect(conhecimentoPublicidade("diretor").cortados).toEqual([]);
  });

  it("textos novos sem travessão e a tela sem regex que o Safari 11 não entende", () => {
    for (const p of [
      "supabase/functions/_shared/conhecimento-publicidade.ts",
      "supabase/functions/_shared/receitas-de-publicidade.ts",
      "supabase/functions/mesa-publicidade/regras.ts",
      "supabase/functions/mesa-publicidade/acoes-da-publicidade.ts",
      "supabase/functions/mesa-publicidade/index.ts",
      "src/pages/MesaPublicidade.tsx",
      "src/components/mesa-publicidade/EtapaCampanha.tsx",
      "src/components/mesa-publicidade/EtapaDirecao.tsx",
      "src/components/mesa-publicidade/EtapaTomadas.tsx",
      "src/components/mesa-publicidade/EtapaRevisao.tsx",
      "src/components/mesa-publicidade/EtapaEnvio.tsx",
      "src/components/mesa-publicidade/AgenteDaPublicidade.tsx",
      "src/components/mesa-publicidade/Comuns.tsx",
      "src/components/mesa-publicidade/publicidadeApi.ts",
    ]) {
      const f = ler(p);
      expect(f, p).not.toMatch(/[—–]/);
      expect(f, p).not.toMatch(/\(\?<[=!]/);
      expect(f, p).not.toMatch(/\\p\{/);
      expect(f, p).not.toMatch(/\(\?<[a-z]/i);
      expect(f, p).not.toMatch(/\.at\(|Object\.hasOwn/);
    }
  });
});
