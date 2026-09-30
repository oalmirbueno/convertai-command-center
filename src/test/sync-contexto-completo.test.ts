import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AREAS_DO_CONTEXTO,
  aplicarNoContexto,
  contextoDaEstrategia,
  ehDecisaoDoConselho,
  itensUsados,
  linhaDoCerebroValeNaMarca,
  linhaDoUsando,
  marcaDaLinhaDoCerebro,
  montarBlocoDoPacote,
  mudancasNoContexto,
  type PacoteDaMarca,
  pacoteVazio,
  PARTES_DO_CONTEXTO,
  reverterNoContexto,
  TETO_MINIMO_DO_CONTEXTO,
  TITULO_DO_CONTEXTO_COMPLETO,
} from "../../supabase/functions/_shared/contexto-completo-regras";
import {
  contextoCompletoParaPrompt,
  esquecerContextoCompleto,
  lerContextoCompletoDaMarca,
  tamanhoDoCacheDoContexto,
} from "../../supabase/functions/_shared/contexto-completo-da-marca";
import { criarContextoDoAgente } from "../../supabase/functions/_shared/contexto-do-agente";
import { esquecerMarcas } from "../../supabase/functions/_shared/marca";
import { bancoFalso, clienteComDuasMarcas } from "./fixtures/sync-marcas";

/**
 * Frente SYNC (30/09): "tudo puxa o contexto completo das marcas, tudo é
 * sincronizado 100%". O pacote único da marca aberta, pela regra da
 * herança, com cache curto e o bloco do prompt sempre dentro do teto.
 */

const CLIENTE = "c0000000-0000-4000-8000-000000000001";
const ACERBI = "a0000000-0000-4000-8000-00000000000a";
const CME = "b0000000-0000-4000-8000-00000000000b";
const PB = "p0000000-0000-4000-8000-00000000000b";

beforeEach(() => {
  esquecerContextoCompleto();
  esquecerMarcas();
});

// ------------------------------------------------------------------ herança por marca

describe("pacote da marca: a outra marca só usa o que é dela", () => {
  it("CME: kit, contexto, dossiê, briefing, estratégia, decisões, cérebro, Instagram e acervo só dela", async () => {
    const { db } = bancoFalso(clienteComDuasMarcas());
    const p = await lerContextoCompletoDaMarca(db, CLIENTE, CME);
    expect(p.marca).toEqual({ id: CME, nome: "CME", principal: false, outras: ["Acerbi"] });
    expect(p.kit!.paleta.join(" ")).toContain("#0044ff");
    expect(p.kit!.paleta.join(" ")).not.toContain("#ff00aa");
    expect(p.kit!.estilo).toBe("azul limpo da escola");
    expect(p.kit!.regras).toBeNull();
    expect(p.kit!.temLogo).toBe(false);
    expect(p.kit!.fontes).toEqual(["Inter (titulo)"]);
    expect(p.contexto.negocio).toBe("Cursos de corte da CME");
    expect(p.contexto.publico).toBeUndefined();
    expect(p.contexto.tom_de_voz).toBe("técnico e didático");
    expect(p.dossie!.texto).toContain("Dossiê da CME");
    expect(p.dossie!.texto).not.toContain("Acerbi");
    expect(p.briefing!.linhas.join(" ")).toContain("CME cursos online");
    expect(p.briefing!.data).toBe("2026-09-28T10:00:00Z");
    expect(p.estrategia!.titulo).toBe("Identidade CME");
    expect(p.estrategia!.aprovada).toBe(false);
    expect(p.decisoes.map((d) => d.resumo)).toEqual(["CME foca em cursos online"]);
    expect(p.cerebro!.texto).toContain("Nunca usar rosa na CME");
    expect(p.cerebro!.texto).not.toContain("pernil");
    expect(p.cerebro!.texto).not.toContain("Evitar preço");
    expect(p.instagram).toEqual({ contas: ["cmeacerbi"], seguidores: 512, alcance: 1800, semana: "2026-09-21" });
    expect(p.referencias).toEqual({ referencias: 2, acervo: 1, categorias: { ambiente: 1 } });
    const bloco = montarBlocoDoPacote(p, { area: "arte" });
    for (const vazado of ["Pernil", "#ff00aa", "famílias", "rosa da Acerbi", "Foco no pernil"]) expect(bloco).not.toContain(vazado);
    expect(bloco).toContain("MARCA DESTE TRABALHO: CME");
  });

  it("Acerbi (principal): herda o kit do cliente, vê o geral e a estratégia aprovada, e nada marcado da CME", async () => {
    const { db } = bancoFalso(clienteComDuasMarcas());
    const p = await lerContextoCompletoDaMarca(db, CLIENTE, ACERBI);
    expect(p.marca!.principal).toBe(true);
    expect(p.kit!.paleta.join(" ")).toContain("#ff00aa");
    expect(p.kit!.fontes).toEqual(["Poppins (titulo)"]);
    expect(p.kit!.temLogo).toBe(true);
    expect(p.contexto.negocio).toBe("Pernil artesanal");
    expect(p.dossie!.texto).toContain("Dossiê geral da Acerbi");
    expect(p.dossie!.texto).not.toContain("CME");
    expect(p.briefing!.linhas.join(" ")).toContain("Acerbi pernil");
    expect(p.estrategia).toEqual(expect.objectContaining({ titulo: "Rebranding Acerbi", aprovada: true, versao: 3, tagline: "O pernil da família" }));
    expect(p.decisoes.map((d) => d.resumo)).toEqual(["Foco no pernil de Natal"]);
    expect(p.cerebro!.texto).toContain("Sempre citar o pernil");
    expect(p.cerebro!.texto).toContain("Evitar preço na arte");
    expect(p.cerebro!.texto).not.toContain("rosa na CME");
    // A decisão do conselho já vem na parte "decisões": não repete no cérebro.
    expect(p.cerebro!.texto).not.toContain("Decisão do conselho");
    expect(p.instagram!.contas).toEqual(["acerbicarnes"]);
    expect(p.referencias!.referencias).toBe(1);
    const bloco = montarBlocoDoPacote(p, { area: "comercial" });
    expect(bloco).toContain("Tagline: O pernil da família");
    expect(bloco).toContain("ESTRATÉGIA DE MARCA");
    expect(bloco).not.toContain("cursos online");
  });

  it("cliente de uma marca só: vale o dado do cliente, sem linha de marca", async () => {
    const dados = clienteComDuasMarcas();
    dados.cliente_marcas = [];
    const { db } = bancoFalso(dados);
    const p = await lerContextoCompletoDaMarca(db, CLIENTE, null);
    expect(p.marca).toBeNull();
    expect(p.kit!.paleta.join(" ")).toContain("#ff00aa");
    expect(p.dossie!.texto).toContain("Acerbi");
    expect(secaoDaMarca(p)).toContain("CLIENTE: Acerbi Carnes");
  });

  it("marca pelo corpo do pedido (marca_id) e pela marca já resolvida dão o mesmo pacote", async () => {
    const { db } = bancoFalso(clienteComDuasMarcas());
    const a = await lerContextoCompletoDaMarca(db, CLIENTE, { marca_id: CME });
    esquecerContextoCompleto();
    const b = await lerContextoCompletoDaMarca(db, CLIENTE, { id: CME, client_id: CLIENTE, nome: "CME", principal: false, project_id: PB });
    expect(a.contexto).toEqual(b.contexto);
    expect(a.dossie).toEqual(b.dossie);
  });
});

function secaoDaMarca(p: PacoteDaMarca) {
  return montarBlocoDoPacote(p, { partes: ["marca"], semTitulo: true });
}

// ------------------------------------------------------------------ cache e falhas

describe("cache curto e falha que não derruba", () => {
  it("a segunda leitura não vai ao banco; esquecer relê", async () => {
    const { db, chamadas } = bancoFalso(clienteComDuasMarcas());
    await lerContextoCompletoDaMarca(db, CLIENTE, CME);
    const depoisDaPrimeira = chamadas.length;
    expect(depoisDaPrimeira).toBeGreaterThan(8);
    await lerContextoCompletoDaMarca(db, CLIENTE, CME, { area: "copy" });
    expect(chamadas.length).toBe(depoisDaPrimeira);
    expect(tamanhoDoCacheDoContexto()).toBe(1);
    esquecerContextoCompleto(CLIENTE);
    await lerContextoCompletoDaMarca(db, CLIENTE, CME);
    expect(chamadas.length).toBeGreaterThan(depoisDaPrimeira);
  });

  it("uma parte que falha vira aviso (e log) e o resto segue; leitura com falha não fica no cache", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = bancoFalso(clienteComDuasMarcas());
    const quebrado = {
      from: (t: string) => {
        if (t === "briefings") {
          const q: any = { select: () => q, eq: () => q, or: () => q, order: () => q, limit: () => Promise.resolve({ data: null, error: { code: "57014", message: "tempo esgotado" } }) };
          return q;
        }
        return db.from(t);
      },
    };
    const r = await contextoCompletoParaPrompt(quebrado, CLIENTE, ACERBI, { area: "copy" });
    expect(r.pacote.avisos).toEqual(["o briefing"]);
    expect(r.pacote.briefing).toBeNull();
    expect(r.pacote.estrategia).not.toBeNull();
    expect(r.usando).toContain("Não deu para ler: o briefing");
    expect(tamanhoDoCacheDoContexto()).toBe(0);
    erro.mockRestore();
  });
});

// ------------------------------------------------------------------ bloco e teto

function pacoteGrande(): PacoteDaMarca {
  const longo = (s: string) => Array.from({ length: 400 }, (_, i) => `${s} ${i} com texto que ocupa espaço`).join("\n");
  return {
    ...pacoteVazio(CLIENTE, "Cliente"),
    marca: { id: CME, nome: "CME", principal: false, outras: ["Acerbi"] },
    kit: { paleta: ["Azul #0044ff"], estilo: longo("estilo"), regras: longo("regra"), fontes: ["Inter"], temLogo: true },
    contexto: { negocio: longo("negócio"), publico: "alunos" },
    estrategia: { projeto_id: "x", titulo: "Identidade", versao: 2, aprovada: true, atualizado_em: "2026-09-29", estrategia: { proposito: longo("propósito") }, tagline: "Corte certo", nome: null },
    briefing: { id: null, titulo: "Cursos", data: "2026-09-28", enviado: true, linhas: longo("resposta").split("\n") },
    dossie: { texto: longo("dossiê"), data: "2026-09-27" },
    cerebro: { texto: longo("cérebro"), regras: 7, fatos: 30 },
    decisoes: [{ id: "d", titulo: "Cursos", resumo: longo("decisão"), data: "2026-09-28" }],
    instagram: { contas: ["cmeacerbi"], seguidores: 512, alcance: 1800, semana: "2026-09-21" },
    referencias: { referencias: 2, acervo: 5, categorias: { ambiente: 3, produto: 2 } },
    avisos: [],
    lido_em: "2026-09-29T00:00:00Z",
  };
}

describe("bloco pronto para o prompt", () => {
  it("nunca passa do teto, em qualquer área e em qualquer teto", () => {
    const p = pacoteGrande();
    for (const area of AREAS_DO_CONTEXTO) {
      for (const teto of [TETO_MINIMO_DO_CONTEXTO, 1500, 4000, 9000, 16_000, 50_000]) {
        const b = montarBlocoDoPacote(p, { area, teto });
        expect(b.length, `${area} ${teto}`).toBeLessThanOrEqual(Math.min(teto, 16_000));
        expect(b.length).toBeGreaterThan(0);
      }
    }
  });

  it("todas as partes cabem com espaço; a ordem segue a área; parte vazia some", () => {
    const p = pacoteGrande();
    const comercial = montarBlocoDoPacote(p, { area: "comercial", teto: 16_000 });
    expect(comercial.indexOf(TITULO_DO_CONTEXTO_COMPLETO)).toBe(0);
    expect(comercial.indexOf("CONTEXTO DA MARCA")).toBeLessThan(comercial.indexOf("ESTRATÉGIA DE MARCA"));
    const arte = montarBlocoDoPacote(p, { area: "arte", teto: 16_000 });
    expect(arte.indexOf("KIT DA MARCA")).toBeLessThan(arte.indexOf("CONTEXTO DA MARCA"));
    for (const t of ["MARCA DESTE TRABALHO", "KIT DA MARCA", "BRIEFING MAIS NOVO", "DOSSIÊ ATUAL", "DECISÕES DO CONSELHO", "INSTAGRAM DA MARCA", "REFERÊNCIAS E ACERVO"]) expect(arte).toContain(t);
    const semNada = montarBlocoDoPacote({ ...pacoteVazio(CLIENTE, "X"), kit: null }, { partes: ["briefing", "dossie"] });
    expect(semNada).toBe("");
  });

  it("partes pedidas: só elas (o complemento de quem já lê o kit não repete o kit)", () => {
    const b = montarBlocoDoPacote(pacoteGrande(), { partes: ["estrategia", "briefing"], semTitulo: true });
    expect(b).toContain("ESTRATÉGIA DE MARCA");
    expect(b).toContain("BRIEFING MAIS NOVO");
    expect(b).not.toContain("KIT DA MARCA");
    expect(b).not.toContain(TITULO_DO_CONTEXTO_COMPLETO);
  });
});

// ------------------------------------------------------------------ "Usando: ..."

describe("linha \"Usando\" para o dono ver o que o agente leu", () => {
  it("contexto da marca, briefing com data, estratégia com versão, dossiê, decisões, cérebro e Instagram", () => {
    const linha = linhaDoUsando(itensUsados(pacoteGrande()));
    expect(linha).toBe("Usando: contexto da marca CME (com o kit), briefing de 28/09, estratégia v2 aprovada com tagline, dossiê de 27/09, 1 decisão(ões) do conselho, cérebro (7 regra(s) ensinada(s)), Instagram @cmeacerbi, 2 referência(s) e 5 foto(s) do acervo.");
  });

  it("só as partes que entraram no prompt; vazio diz que não há contexto", () => {
    expect(linhaDoUsando(itensUsados(pacoteGrande(), ["briefing"]))).toBe("Usando: briefing de 28/09.");
    expect(linhaDoUsando(itensUsados({ ...pacoteVazio(CLIENTE), kit: null }, ["briefing"]))).toBe("Sem contexto da marca ainda.");
    expect(PARTES_DO_CONTEXTO.length).toBe(10);
  });
});

// ------------------------------------------------------------------ cérebro por marca

describe("cérebro pela regra da herança", () => {
  it("marca da linha pela evidência ou pelo referencia_id que é marca do cliente", () => {
    expect(marcaDaLinhaDoCerebro(`marca:${CME}; pedido: "x"`, null, [])).toBe(CME);
    expect(marcaDaLinhaDoCerebro(null, ACERBI, [ACERBI, CME])).toBe(ACERBI);
    expect(marcaDaLinhaDoCerebro(null, "t0000000-0000-4000-8000-000000000009", [ACERBI, CME])).toBeNull();
  });

  it("principal: sem marca e a dela; outra marca: só a dela; sem marca aberta: tudo", () => {
    const principal = { id: ACERBI, principal: true };
    const outra = { id: CME, principal: false };
    expect(linhaDoCerebroValeNaMarca(null, principal)).toBe(true);
    expect(linhaDoCerebroValeNaMarca(CME, principal)).toBe(false);
    expect(linhaDoCerebroValeNaMarca(null, outra)).toBe(false);
    expect(linhaDoCerebroValeNaMarca(CME, outra)).toBe(true);
    expect(linhaDoCerebroValeNaMarca(CME, null)).toBe(true);
    expect(ehDecisaoDoConselho("Decisão do conselho (x): y")).toBe(true);
  });
});

// ------------------------------------------------------------------ estratégia vira contexto

describe("estratégia aprovada vira contexto da marca (Confirmar e Desfazer)", () => {
  const estrategia = { posicionamento: { publico: "famílias", categoria: "açougue de bairro", diferencial: "pernil artesanal" }, proposta_de_valor: { promessa: "Pernil macio sempre", ganhos: ["entrega rápida"] }, tom: { atributos: ["caloroso"], fala_assim: ["Tem pernil fresquinho"] } };

  it("negócio, público, oferta, diferenciais, tom, posicionamento e tagline", () => {
    const c = contextoDaEstrategia(estrategia, { tagline: "O pernil da família", nomeDaMarca: "Acerbi" });
    expect(c).toEqual({
      posicionamento: "Para famílias, Acerbi é açougue de bairro que pernil artesanal.",
      negocio: "açougue de bairro",
      publico: "famílias",
      oferta: "Pernil macio sempre",
      diferenciais: ["pernil artesanal", "entrega rápida"],
      tom_de_voz: "caloroso; fala assim: Tem pernil fresquinho",
      tagline: "O pernil da família",
    });
  });

  it("só o que muda é aplicado; o Desfazer volta cada campo (e apaga o que não existia)", () => {
    const atual = { negocio: "açougue de bairro", lacunas: ["logo"], tom_de_voz: "sério" };
    const proposta = contextoDaEstrategia(estrategia, { tagline: "O pernil da família" });
    const mudam = mudancasNoContexto(atual, proposta);
    expect(Object.keys(mudam)).not.toContain("negocio");
    const r = aplicarNoContexto(atual, mudam);
    expect(r.contexto.tom_de_voz).toContain("caloroso");
    expect(r.contexto.lacunas).toEqual(["logo"]);
    expect(r.antes).toEqual(expect.objectContaining({ tom_de_voz: "sério", tagline: null }));
    const volta = reverterNoContexto(r.contexto, r.antes);
    expect(volta).toEqual(atual);
  });
});

// ------------------------------------------------------------------ o leitor antigo agora é o completo

describe("contexto-do-agente (quem já usava) lê o pacote pela marca", () => {
  it("com a marca da CME, o bloco não traz nada da Acerbi e traz a estratégia e o briefing dela", async () => {
    const { db } = bancoFalso(clienteComDuasMarcas());
    const leitor = criarContextoDoAgente();
    const r = await leitor.lerComUsando(db, CLIENTE, ["arte", "copy", "geral"], { marca: CME });
    expect(r.texto).toContain("MARCA DESTE TRABALHO: CME");
    expect(r.texto).toContain("CME cursos online");
    expect(r.texto).toContain("Nunca usar rosa na CME");
    expect(r.texto).not.toContain("pernil");
    expect(r.texto).not.toContain("KIT DA MARCA");
    expect(r.usando).toContain("briefing de 28/09");
    // Mesmo pedido de novo: vem do cache do leitor.
    expect(await leitor.ler(db, CLIENTE, ["arte", "copy", "geral"], { marca: CME })).toBe(r.texto);
  });

  it("sem marca num cliente com marcas: a principal (nunca a CME)", async () => {
    const { db } = bancoFalso(clienteComDuasMarcas());
    const texto = await criarContextoDoAgente().ler(db, CLIENTE, ["copy", "campanha", "geral"]);
    expect(texto).toContain("MARCA DESTE TRABALHO: Acerbi");
    expect(texto).toContain("Tagline: O pernil da família");
    expect(texto).not.toContain("cursos online");
  });
});
