import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));

import {
  BLOCOS_DO_MENU,
  LIMITE_DO_CONTEUDO,
  MODELOS,
  NIVEIS_NO_MAXIMO,
  achatarArvore,
  bytesDoDoc,
  cabeNoTeto,
  consultaDaBarra,
  descendentesDe,
  destinosParaMover,
  docVazio,
  ehGestor,
  estaArquivada,
  filtrarBlocos,
  fraseDoErroDoEspaco,
  lerDoc,
  linkSeguro,
  modeloPorId,
  montarArvore,
  paginasArquivadas,
  podeEditar,
  podeMoverPara,
  proximaOrdem,
  textoDoDoc,
  tituloDaPagina,
  trilhaDaPagina,
  visibilidadesPermitidas,
  ErroDoEspaco,
  type NoDoEditor,
  type PaginaDoEspaco,
} from "@/lib/produto/espaco";

/**
 * Espaço do CRM (13/11/2026): as funções puras da árvore de páginas, de quem
 * pode editar e dos modelos prontos. As regras de verdade são do banco
 * (supabase/migrations/20261113220000_crm_espaco.sql); aqui a tela só não
 * pode oferecer o que ele nega nem desenhar a árvore errada.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

let relogio = 0;
function pagina(id: string, extra: Partial<PaginaDoEspaco> = {}): PaginaDoEspaco {
  relogio += 1;
  return {
    id,
    conta_id: "conta",
    pai_id: null,
    titulo: `Página ${id}`,
    icone: null,
    visivel_para: "todos",
    ordem: 0,
    versao: 1,
    criado_por: "ana",
    atualizado_por: "ana",
    criado_em: new Date(Date.UTC(2026, 10, 13, 10, 0, 0) + relogio * 1000).toISOString(),
    atualizado_em: "2026-11-13T10:00:00Z",
    arquivada_em: null,
    ...extra,
  };
}

const ids = (nos: Array<{ pagina: PaginaDoEspaco }>) => nos.map((n) => n.pagina.id);

describe("árvore de páginas", () => {
  it("põe cada página dentro do pai, na ordem, com o nível certo", () => {
    const paginas = [
      pagina("roteiro", { ordem: 2 }),
      pagina("playbook", { ordem: 1 }),
      pagina("etapas", { pai_id: "playbook", ordem: 2 }),
      pagina("cliente", { pai_id: "playbook", ordem: 1 }),
      pagina("perfil", { pai_id: "cliente", ordem: 1 }),
    ];
    const arvore = montarArvore(paginas);
    expect(ids(arvore)).toEqual(["playbook", "roteiro"]);
    expect(ids(arvore[0].filhos)).toEqual(["cliente", "etapas"]);
    expect(ids(arvore[0].filhos[0].filhos)).toEqual(["perfil"]);
    expect(achatarArvore(arvore).map((n) => `${n.nivel}:${n.pagina.id}`)).toEqual(["0:playbook", "1:cliente", "2:perfil", "1:etapas", "0:roteiro"]);
  });

  it("com a mesma ordem, a mais antiga vem primeiro", () => {
    const a = pagina("a");
    const b = pagina("b");
    expect(ids(montarArvore([b, a]))).toEqual(["a", "b"]);
  });

  it("página recolhida esconde o que está dentro dela, e só dela", () => {
    const paginas = [pagina("a", { ordem: 1 }), pagina("a1", { pai_id: "a" }), pagina("a2", { pai_id: "a1" }), pagina("b", { ordem: 2 }), pagina("b1", { pai_id: "b" })];
    expect(ids(achatarArvore(montarArvore(paginas), ["a"]))).toEqual(["a", "b", "b1"]);
  });

  it("arquivada some da árvore com tudo o que está dentro", () => {
    const paginas = [pagina("a"), pagina("a1", { pai_id: "a", arquivada_em: "2026-11-13T12:00:00Z" }), pagina("a2", { pai_id: "a1" }), pagina("b")];
    expect(ids(achatarArvore(montarArvore(paginas)))).toEqual(["a", "b"]);
    expect(estaArquivada(paginas, "a2")).toBe(true);
    expect(estaArquivada(paginas, "a")).toBe(false);
    expect(ids(paginasArquivadas(paginas).map((p) => ({ pagina: p })))).toEqual(["a1"]);
  });

  it("página cujo pai a pessoa não enxerga sobe para o topo em vez de sumir", () => {
    const paginas = [pagina("visivel"), pagina("orfa", { pai_id: "pai-so-de-gestores" })];
    expect(ids(montarArvore(paginas)).sort()).toEqual(["orfa", "visivel"]);
    expect(ids(trilhaDaPagina(paginas, "orfa").map((p) => ({ pagina: p })))).toEqual(["orfa"]);
  });

  it("um círculo não trava a tela nem perde página", () => {
    const paginas = [pagina("a", { pai_id: "b" }), pagina("b", { pai_id: "a" }), pagina("c")];
    const todas = ids(achatarArvore(montarArvore(paginas))).sort();
    expect(todas).toEqual(["a", "b", "c"]);
    expect(trilhaDaPagina(paginas, "a").length).toBe(2);
    expect(descendentesDe(paginas, "a")).toEqual(["b"]);
    expect(estaArquivada(paginas, "a")).toBe(false);
  });

  it("a trilha vai do topo até a página", () => {
    const paginas = [pagina("a"), pagina("b", { pai_id: "a" }), pagina("c", { pai_id: "b" })];
    expect(trilhaDaPagina(paginas, "c").map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(trilhaDaPagina(paginas, "nao-existe")).toEqual([]);
  });

  it("descendentes pegam todos os níveis", () => {
    const paginas = [pagina("a"), pagina("b", { pai_id: "a" }), pagina("c", { pai_id: "b" }), pagina("d")];
    expect(descendentesDe(paginas, "a").sort()).toEqual(["b", "c"]);
    expect(descendentesDe(paginas, "d")).toEqual([]);
  });

  it("a página nova entra depois da última irmã", () => {
    const paginas = [pagina("a", { ordem: 3 }), pagina("b", { ordem: 7 }), pagina("b1", { pai_id: "b", ordem: 2 })];
    expect(proximaOrdem(paginas, null)).toBe(8);
    expect(proximaOrdem(paginas, "b")).toBe(3);
    expect(proximaOrdem(paginas, "a")).toBe(1);
  });

  it("título vazio vira 'Sem título'", () => {
    expect(tituloDaPagina({ titulo: "   " })).toBe("Sem título");
    expect(tituloDaPagina({ titulo: " Playbook " })).toBe("Playbook");
    expect(tituloDaPagina(null)).toBe("Sem título");
  });
});

describe("mover para dentro de outra", () => {
  const paginas = [pagina("a"), pagina("b", { pai_id: "a" }), pagina("c", { pai_id: "b" }), pagina("d"), pagina("velha", { arquivada_em: "2026-11-01T00:00:00Z" })];

  it("não entra nela mesma nem no que está dentro dela", () => {
    expect(podeMoverPara(paginas, "a", "a")).toBe(false);
    expect(podeMoverPara(paginas, "a", "b")).toBe(false);
    expect(podeMoverPara(paginas, "a", "c")).toBe(false);
    expect(podeMoverPara(paginas, "a", "d")).toBe(true);
    expect(podeMoverPara(paginas, "c", "a")).toBe(true);
    expect(podeMoverPara(paginas, "c", null)).toBe(true);
  });

  it("não entra em página arquivada nem em página que não existe", () => {
    expect(podeMoverPara(paginas, "d", "velha")).toBe(false);
    expect(podeMoverPara(paginas, "d", "fantasma")).toBe(false);
  });

  it("a lista de destinos vem na ordem da árvore, sem os proibidos", () => {
    expect(ids(destinosParaMover(paginas, "b"))).toEqual(["a", "d"]);
    expect(ids(destinosParaMover(paginas, "d"))).toEqual(["a", "b", "c"]);
  });

  it("respeita o máximo de níveis do banco", () => {
    const fila: PaginaDoEspaco[] = [];
    for (let i = 0; i < NIVEIS_NO_MAXIMO; i += 1) fila.push(pagina(`n${i}`, { pai_id: i ? `n${i - 1}` : null }));
    const solta = pagina("solta");
    const comFilha = [pagina("mae"), pagina("filha", { pai_id: "mae" })];
    const todas = fila.concat([solta], comFilha);
    expect(podeMoverPara(todas, "solta", `n${NIVEIS_NO_MAXIMO - 2}`)).toBe(true);
    expect(podeMoverPara(todas, "solta", `n${NIVEIS_NO_MAXIMO - 1}`)).toBe(false);
    expect(podeMoverPara(todas, "mae", `n${NIVEIS_NO_MAXIMO - 2}`)).toBe(false);
    expect(ler("supabase/migrations/20261113220000_crm_espaco.sql")).toContain(`_passos > ${NIVEIS_NO_MAXIMO}`);
  });
});

describe("quem pode editar", () => {
  const daAna = pagina("p", { criado_por: "ana", visivel_para: "todos" });
  const soDaAna = pagina("p", { criado_por: "ana", visivel_para: "eu" });
  const dosGestores = pagina("p", { criado_por: "gil", visivel_para: "gestores" });

  it("gestor é admin ou gerente", () => {
    expect(ehGestor("admin")).toBe(true);
    expect(ehGestor("gerente")).toBe(true);
    expect(ehGestor("usuario")).toBe(false);
    expect(ehGestor(null)).toBe(false);
  });

  it("quem criou edita; o colega vendedor não", () => {
    expect(podeEditar(daAna, { userId: "ana", papel: "usuario" })).toBe(true);
    expect(podeEditar(daAna, { userId: "beto", papel: "usuario" })).toBe(false);
    expect(podeEditar(daAna, { userId: null, papel: "admin" })).toBe(false);
  });

  it("gestor edita a página dos outros, menos a particular", () => {
    expect(podeEditar(daAna, { userId: "gil", papel: "gerente" })).toBe(true);
    expect(podeEditar(daAna, { userId: "hugo", papel: "admin" })).toBe(true);
    expect(podeEditar(soDaAna, { userId: "hugo", papel: "admin" })).toBe(false);
    expect(podeEditar(soDaAna, { userId: "ana", papel: "usuario" })).toBe(true);
    expect(podeEditar(dosGestores, { userId: "hugo", papel: "admin" })).toBe(true);
  });

  it("página sem autor (pessoa saiu) fica com os gestores", () => {
    const semAutor = pagina("p", { criado_por: null });
    expect(podeEditar(semAutor, { userId: "vera", papel: "usuario" })).toBe(false);
    expect(podeEditar(semAutor, { userId: "gil", papel: "gerente" })).toBe(true);
  });

  it("as opções de quem vê seguem o que o banco aceita", () => {
    expect(visibilidadesPermitidas(null, { userId: "vera", papel: "usuario" })).toEqual(["todos", "eu"]);
    expect(visibilidadesPermitidas(null, { userId: "gil", papel: "gerente" })).toEqual(["todos", "gestores", "eu"]);
    expect(visibilidadesPermitidas(daAna, { userId: "ana", papel: "usuario" })).toEqual(["todos", "eu"]);
    // O gestor não torna particular a página de outra pessoa.
    expect(visibilidadesPermitidas(daAna, { userId: "gil", papel: "gerente" })).toEqual(["todos", "gestores"]);
    expect(visibilidadesPermitidas(daAna, { userId: "beto", papel: "usuario" })).toEqual([]);
  });

  it("a migration tem as mesmas três visibilidades e os mesmos cargos de gestor", () => {
    const sql = ler("supabase/migrations/20261113220000_crm_espaco.sql");
    expect(sql).toContain("visivel_para in ('todos', 'gestores', 'eu')");
    expect(sql).toContain("public.crm_sou_gestor()");
    expect(ler("supabase/migrations/20261113200000_crm_cargos_campos_e_automacoes.sql")).toContain("public.crm_meu_papel() in ('admin', 'gerente')");
  });
});

describe("modelos prontos", () => {
  const TIPOS_DO_EDITOR = ["doc", "paragraph", "heading", "text", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "blockquote", "horizontalRule"];
  const tipos = (no: NoDoEditor, saida: string[] = []): string[] => {
    saida.push(no.type);
    (no.content || []).forEach((f) => tipos(f, saida));
    return saida;
  };
  const contexto = { empresa: "Imobiliária Horizonte", nicho: "imobiliaria", etapas: { diagnostico: "Visita", negociacao: "Documentação" } };

  it("são os quatro pedidos, cada um com título e resumo", () => {
    expect(MODELOS.map((m) => m.titulo)).toEqual(["Playbook de vendas", "Roteiro de abordagem", "Respostas para objeções", "Boas-vindas do vendedor novo"]);
    MODELOS.forEach((m) => expect(m.resumo.length).toBeGreaterThan(20));
    expect(modeloPorId("roteiro")!.titulo).toBe("Roteiro de abordagem");
    expect(modeloPorId("nao-existe")).toBeNull();
  });

  it("cada modelo traz conteúdo de verdade, só com blocos que o editor conhece", () => {
    MODELOS.forEach((m) => {
      const doc = m.conteudo(contexto);
      const usados = tipos(doc);
      usados.forEach((tp) => expect(TIPOS_DO_EDITOR).toContain(tp));
      expect(usados.filter((tp) => tp === "heading").length).toBeGreaterThanOrEqual(4);
      expect(textoDoDoc(doc).length).toBeGreaterThan(900);
      expect(cabeNoTeto(doc)).toBe(true);
      // Todo título é de nível 1 a 3 e nenhum texto vem vazio (o editor recusa texto vazio).
      const conferir = (no: NoDoEditor) => {
        if (no.type === "heading") expect([1, 2, 3]).toContain(no.attrs && no.attrs.level);
        if (no.type === "text") expect((no.text || "").length).toBeGreaterThan(0);
        (no.content || []).forEach(conferir);
      };
      conferir(doc);
    });
  });

  it("sem travessão e sem emoji no texto dos modelos", () => {
    MODELOS.forEach((m) => {
      const texto = `${m.titulo} ${m.resumo} ${textoDoDoc(m.conteudo(contexto))} ${textoDoDoc(m.conteudo())}`;
      expect(texto).not.toMatch(/[–—]/);
      expect(texto).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
    });
  });

  it("o modelo nasce com as palavras da empresa: nome, etapas do funil e objeção do ramo", () => {
    const playbook = textoDoDoc(modeloPorId("playbook")!.conteudo(contexto));
    expect(playbook).toContain("Imobiliária Horizonte");
    expect(playbook).toContain("Visita:");
    expect(playbook).toContain("Documentação:");
    expect(playbook).toContain("Proposta:");
    expect(playbook).not.toContain("Diagnóstico:");
    const objecoes = textoDoDoc(modeloPorId("objecoes")!.conteudo(contexto));
    expect(objecoes).toContain("Vou esperar o preço baixar");
    expect(textoDoDoc(modeloPorId("objecoes")!.conteudo({ nicho: "consorcio" }))).toContain("contemplado");
  });

  it("sem saber nada da empresa o modelo ainda sai inteiro", () => {
    MODELOS.forEach((m) => {
      const t = textoDoDoc(m.conteudo());
      expect(t).not.toContain("undefined");
      expect(t.length).toBeGreaterThan(900);
    });
    expect(textoDoDoc(modeloPorId("playbook")!.conteudo({ nicho: "ramo-que-nao-existe" }))).toContain("Diagnóstico:");
  });

  it("os modelos têm lista de tarefas e citação (roteiro e boas-vindas são para usar, não só ler)", () => {
    expect(tipos(modeloPorId("boas_vindas")!.conteudo())).toContain("taskList");
    expect(tipos(modeloPorId("roteiro")!.conteudo())).toContain("blockquote");
    expect(tipos(modeloPorId("objecoes")!.conteudo())).toContain("horizontalRule");
  });
});

describe("documento e editor", () => {
  it("o que não é documento vira um documento vazio", () => {
    expect(lerDoc(null)).toEqual(docVazio());
    expect(lerDoc({})).toEqual(docVazio());
    expect(lerDoc({ type: "doc", content: [] })).toEqual(docVazio());
    expect(lerDoc("texto")).toEqual(docVazio());
    const bom = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "oi" }] }] };
    expect(lerDoc(bom)).toBe(bom);
  });

  it("o teto da tela fica abaixo do teto do banco", () => {
    const sql = ler("supabase/migrations/20261113220000_crm_espaco.sql");
    const doBanco = Number((sql.match(/octet_length\(conteudo::text\) <= (\d+)/) || [])[1]);
    expect(doBanco).toBe(400000);
    expect(LIMITE_DO_CONTEUDO).toBeLessThan(doBanco);
    const grande = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "á".repeat(160000) }] }] };
    expect(bytesDoDoc(grande)).toBeGreaterThan(320000);
    expect(cabeNoTeto(grande)).toBe(false);
    expect(cabeNoTeto(docVazio())).toBe(true);
  });

  it("link só de endereço seguro", () => {
    expect(linkSeguro("https://aceleriq.com")).toBe("https://aceleriq.com");
    expect(linkSeguro("  exemplo.com.br/pagina ")).toBe("https://exemplo.com.br/pagina");
    expect(linkSeguro("vendas@empresa.com")).toBe("mailto:vendas@empresa.com");
    expect(linkSeguro("tel:+5541999990000")).toBe("tel:+5541999990000");
    expect(linkSeguro("javascript:alert(1)")).toBeNull();
    expect(linkSeguro("data:text/html,oi")).toBeNull();
    expect(linkSeguro("duas palavras")).toBeNull();
    expect(linkSeguro("")).toBeNull();
  });

  it("o menu de barra tem os dez tipos de bloco e acha sem acento", () => {
    expect(BLOCOS_DO_MENU.map((b) => b.id)).toEqual(["texto", "titulo1", "titulo2", "titulo3", "lista", "numerada", "tarefas", "citacao", "codigo", "divisor"]);
    expect(filtrarBlocos("")).toHaveLength(10);
    expect(filtrarBlocos("titulo").map((b) => b.id)).toEqual(["titulo1", "titulo2", "titulo3"]);
    expect(filtrarBlocos("Citação").map((b) => b.id)).toEqual(["citacao"]);
    expect(filtrarBlocos("lista").map((b) => b.id)).toEqual(["lista", "numerada", "tarefas"]);
    expect(filtrarBlocos("check").map((b) => b.id)).toEqual(["tarefas"]);
    expect(filtrarBlocos("h2").map((b) => b.id)).toEqual(["titulo2"]);
    expect(filtrarBlocos("xyz")).toEqual([]);
  });

  it("a barra abre o menu no começo do bloco ou depois de espaço, não no meio da palavra", () => {
    expect(consultaDaBarra("/")).toBe("");
    expect(consultaDaBarra("/tit")).toBe("tit");
    expect(consultaDaBarra("Texto antes /lis")).toBe("lis");
    expect(consultaDaBarra("/lista num")).toBe("lista num");
    expect(consultaDaBarra("e/ou")).toBeNull();
    expect(consultaDaBarra("https://site.com")).toBeNull();
    expect(consultaDaBarra("1 / 2")).toBeNull();
    expect(consultaDaBarra("sem barra")).toBeNull();
    expect(consultaDaBarra("/uma frase comprida demais para ser um tipo de bloco")).toBeNull();
  });

  it("erro do banco vira frase para a pessoa", () => {
    expect(fraseDoErroDoEspaco(new ErroDoEspaco("conflito", "Mudou em outro lugar."))).toBe("Mudou em outro lugar.");
    expect(fraseDoErroDoEspaco({ code: "23514", message: "A empresa chegou ao limite de 500 páginas. Exclua páginas arquivadas para abrir espaço." })).toContain("500 páginas");
    expect(fraseDoErroDoEspaco({ code: "23514", message: 'new row for relation "crm_paginas" violates check constraint "crm_paginas_conteudo_check"' })).toContain("grande demais");
    expect(fraseDoErroDoEspaco({ code: "42501", message: "new row violates row-level security policy" })).toContain("permissão");
    expect(fraseDoErroDoEspaco(new Error("fetch failed"), "Padrão.")).toBe("Padrão.");
  });
});
