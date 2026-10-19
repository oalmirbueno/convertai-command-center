// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  conferenciaAtual,
  estadoDoRascunho,
  faseDoEvento,
  fasesDoTrabalho,
  instrucaoDaCorrecao,
  lerConferencia,
  MOTIVO_GERAR_E_PUBLICAR,
  podeCorrigir,
  podeMexerNoRascunho,
  problemasDaMedicao,
  promptDaCorrecao,
  separarPublicarDaGeracao,
  travaDaPublicacao,
  versaoDoRascunho,
  versoesSalvas,
} from "../../supabase/functions/mesa-site/modulos/obra-do-site";
import { normalizarAcoesDoSite, type ListasDoAgente } from "../../supabase/functions/mesa-site/acoes-do-site";
import { normalizarPedido, motivoParaRecusar, podeDesfazer, gasta, TIPOS_DE_TRABALHO, type TrabalhoDoMotor } from "../../supabase/functions/_shared/motor-codigo";
import { errosDoTsc, erroEmPalavras, resumoDosTipos } from "../../workers/motor-codigo/lib/tipos";
import { localizarTexto, planejarTrocaDeTexto, planejarTrocas, type PlanoDaTroca, recusaDoTextoNovo, type ArquivoDoCodigo } from "../../workers/motor-codigo/lib/textos-no-codigo";
import { enderecosDasPaginas } from "../../workers/motor-codigo/lib/conferencia-no-navegador";
import { problemasDoPedido } from "../../workers/motor-codigo/lib/conferencia-no-navegador";
import { trocasDoPedido } from "../../workers/motor-codigo/lib/textos-no-codigo";
import { abrirRascunho, commitar, commitAtual, descartarRascunho, lerRegistroDoRascunho, ramoAtual, salvarRascunho } from "../../workers/motor-codigo/lib/projeto";

/**
 * A obra do site no jeito do Gravyx (19/10/2026): fases à vista, gerar e
 * publicar nunca no mesmo turno, rascunho x versão salva, conferência no
 * navegador que trava o Publicar (com "mesmo assim"), correção uma vez só e
 * troca de texto no código sem IA. Tudo puro, mais o git de verdade do
 * rascunho numa pasta temporária. Nada sai para o Supabase nem para a rede.
 */

let n = 0;
const T = (o: Partial<TrabalhoDoMotor>): TrabalhoDoMotor =>
  ({
    id: o.id || `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    client_id: "c",
    marca_id: null,
    mesa: "site",
    projeto: "cafe-12345678",
    referencia_id: "s",
    tipo: "construir",
    estado: "feito",
    modelo: null,
    instrucao: "",
    teto_usd: 0,
    estimativa_usd: null,
    custo_usd: 0,
    preview_url: null,
    commit: "abc1234",
    commit_anterior: "0001111",
    zip_path: null,
    resultado: {},
    erro: null,
    criado_em: "2026-10-19T10:00:00Z",
    terminado_em: "2026-10-19T10:05:00Z",
    ...o,
  }) as TrabalhoDoMotor;

const conf = (graves: number, avisos = 0) => ({
  estado: "pronto",
  motivo: null,
  em: "2026-10-19T10:06:00Z",
  paginas: ["/"],
  problemas: [
    ...Array.from({ length: graves }, (_, i) => ({ tipo: "vazando", grave: true, texto: `Vaza ${i}`, aparelho: "celular", pagina: "/", caminho: "body>main:nth-of-type(1)", secao: "hero" })),
    ...Array.from({ length: avisos }, (_, i) => ({ tipo: "cortado", grave: false, texto: `Corta ${i}`, aparelho: "computador", pagina: "/", caminho: null, secao: null })),
  ],
  graves,
  capa: { bucket: "mesa", path: "c/site/s/conferencia/x.jpg" },
});

// ------------------------------------------------------------------ 1. fases

describe("fases do trabalho a partir dos eventos", () => {
  it("lê a fase marcada pelo worker e cai no texto quando o evento é antigo", () => {
    expect(faseDoEvento({ tipo: "passo", resumo: "x", dados: { fase: "compilando" } })).toBe("compilando");
    expect(faseDoEvento({ tipo: "arquivo", resumo: "Escreveu src/secoes/Hero.tsx" })).toBe("escrevendo");
    expect(faseDoEvento({ tipo: "passo", resumo: "Construindo Hero" })).toBe("escrevendo");
    expect(faseDoEvento({ tipo: "aviso", resumo: "O build falhou; a revisão não rodou" })).toBe("compilando");
    expect(faseDoEvento({ tipo: "passo", resumo: "Revisão: 2 aviso(s)" })).toBe("conferindo");
    expect(faseDoEvento({ tipo: "fim", resumo: "Pronto" })).toBe("pronto");
    expect(faseDoEvento({ tipo: "estado", resumo: "O motor pegou o trabalho" })).toBeNull();
  });

  it("monta os passos: feitas, a de agora e as que faltam", () => {
    const eventos = [
      { tipo: "estado", resumo: "Na fila" },
      { tipo: "passo", resumo: "Entendendo o pedido", dados: { fase: "entendendo" } },
      { tipo: "passo", resumo: "Construindo Hero", dados: { fase: "escrevendo" } },
      { tipo: "arquivo", resumo: "Escreveu src/secoes/Hero.tsx" },
      { tipo: "passo", resumo: "Compilando o site", dados: { fase: "compilando" } },
    ];
    const f = fasesDoTrabalho({ estado: "executando" }, eventos);
    expect(f.atual).toBe("compilando");
    expect(f.passos.map((p) => p.estado)).toEqual(["feita", "feita", "agora", "falta", "falta"]);
    expect(f.passos.map((p) => p.rotulo)).toEqual(["Entendendo o pedido", "Escrevendo", "Compilando", "Conferindo", "Pronto"]);
  });

  it("na fila, pronto e parado no meio", () => {
    expect(fasesDoTrabalho({ estado: "na_fila" }, []).naFila).toBe(true);
    expect(fasesDoTrabalho({ estado: "feito" }, []).passos.every((p) => p.estado === "feita")).toBe(true);
    const caiu = fasesDoTrabalho({ estado: "falhou" }, [{ tipo: "passo", resumo: "x", dados: { fase: "escrevendo" } }]);
    expect(caiu.parou).toBe(true);
    expect(caiu.passos.find((p) => p.id === "escrevendo")!.estado).toBe("parou");
    expect(caiu.passos.find((p) => p.id === "pronto")!.estado).toBe("falta");
  });
});

// ------------------------------------------------------------------ 2. gerar e publicar

const listas: ListasDoAgente = { siteId: "site-1", secoes: [{ id: "hero", construida: true }, { id: "faq", construida: false }], trabalhos: [], opcoesDeCopy: [] };
const custos = { ajustar: 0.4, construir: 0.6, conteudo: 0.02, imagem: 0.05 };

describe("gerar e publicar nunca no mesmo turno", () => {
  it("o publicar junto de uma geração é recusado com o motivo; sozinho, vai para o cartão", () => {
    const junto = normalizarAcoesDoSite({ resumo: "constrói e publica", itens: [{ operacao: "construir_secao", ref: "s2", para: "" }, { operacao: "publicar_site", ref: "x1", para: "" }] }, listas, "c", custos)!;
    expect(junto.itens.map((i) => i.operacao)).toEqual(["construir_secao"]);
    expect(junto.recusados.map((r) => r.operacao)).toEqual(["publicar_site"]);
    expect(junto.recusados[0].motivo).toBe(MOTIVO_GERAR_E_PUBLICAR);

    const sozinho = normalizarAcoesDoSite({ resumo: "publica", itens: [{ operacao: "publicar_site", ref: "x1", para: "" }] }, listas, "c", custos)!;
    expect(sozinho.itens.map((i) => i.operacao)).toEqual(["publicar_site"]);
    expect(sozinho.recusados).toEqual([]);
    expect(sozinho.sem_desfazer).toBe(true);
  });

  it("a separação vale para qualquer operação que gera", () => {
    expect(separarPublicarDaGeracao([{ operacao: "gerar_imagem" }, { operacao: "publicar_site" }]).recusados).toHaveLength(1);
    expect(separarPublicarDaGeracao([{ operacao: "parar_trabalho" }, { operacao: "publicar_site" }]).recusados).toHaveLength(0);
  });

  it("o servidor recusa publicar com geração rodando (o botão e o diretor passam pela mesma trava)", () => {
    const t = travaDaPublicacao([T({ tipo: "ajustar", estado: "executando", resultado: {} })]);
    expect(t.ok).toBe(false);
    expect(t.codigo).toBe("geracao_em_andamento");
  });
});

// ------------------------------------------------------------------ 3. rascunho

describe("rascunho x versão salva", () => {
  const salvo = T({ tipo: "salvar", resultado: { ramo: "main", versao: { commit: "bbb2222", de: "aaa1111", origem: "edicao", modelos: ["anthropic/claude-x"], trabalhos: ["t1"], em: "2026-10-19T10:00:00Z" } } });

  it("trabalho que terminou no ramo do rascunho abre o rascunho; salvar ou descartar fecha", () => {
    const ajuste = T({ tipo: "ajustar", resultado: { ramo: "rascunho", rascunho: { aberto: true, base: "bbb2222" } }, criado_em: "2026-10-19T11:00:00Z" });
    const aberto = estadoDoRascunho([ajuste, salvo]);
    expect(aberto.aberto).toBe(true);
    expect(aberto.trabalhos.map((t) => t.id)).toEqual([ajuste.id]);
    expect(aberto.base).toBe("bbb2222");
    expect(podeMexerNoRascunho(aberto).ok).toBe(true);

    const salvou = T({ tipo: "salvar", resultado: { ramo: "main" }, criado_em: "2026-10-19T12:00:00Z" });
    expect(estadoDoRascunho([salvou, ajuste, salvo]).aberto).toBe(false);
    const descartou = T({ tipo: "descartar", resultado: { ramo: "main" }, criado_em: "2026-10-19T12:00:00Z" });
    expect(estadoDoRascunho([descartou, ajuste, salvo]).aberto).toBe(false);
  });

  it("com o motor escrevendo, salvar e descartar esperam", () => {
    const rodando = T({ tipo: "construir", estado: "executando", resultado: {} });
    const e = estadoDoRascunho([rodando, salvo]);
    expect(e.aberto).toBe(true);
    expect(e.emAndamento).toBe(true);
    expect(podeMexerNoRascunho(e).ok).toBe(false);
    expect(podeMexerNoRascunho(estadoDoRascunho([salvo])).motivo).toMatch(/Não há rascunho/);
  });

  it("trabalho antigo, sem ramo, não abre rascunho", () => {
    expect(estadoDoRascunho([T({ tipo: "construir", resultado: {} })]).aberto).toBe(false);
  });

  it("a versão guarda origem, modelos e de qual veio; a restauração é marcada", () => {
    const v = versaoDoRascunho({ base: "aaa1111", aberto_em: "x", trabalhos: [{ id: "t1", tipo: "ajustar", modelo: "m1", origem: "edicao" }, { id: "t2", tipo: "corrigir", modelo: "m1", origem: "edicao" }] }, "ccc3333", "2026-10-19T10:00:00Z");
    expect(v).toEqual({ commit: "ccc3333", de: "aaa1111", origem: "edicao", modelos: ["m1"], trabalhos: ["t1", "t2"], em: "2026-10-19T10:00:00Z" });
    expect(versaoDoRascunho({ base: "a", aberto_em: "x", trabalhos: [{ id: "t", tipo: "desfazer", modelo: null, origem: "restauracao" }] }, "d", "e").origem).toBe("restauracao");
    expect(versoesSalvas([salvo])[0]).toMatchObject({ trabalho_id: salvo.id, origem: "edicao", de: "aaa1111", modelos: ["anthropic/claude-x"] });
  });

  it("os tipos novos entram na fila: salvar e descartar sem custo, corrigir gasta, textos é máquina", () => {
    for (const tipo of ["salvar", "descartar", "corrigir", "textos"]) expect(TIPOS_DE_TRABALHO).toContain(tipo);
    expect(normalizarPedido({ tipo: "salvar" }).tipo).toBe("salvar");
    expect(gasta("salvar")).toBe(false);
    expect(gasta("textos")).toBe(false);
    expect(gasta("corrigir")).toBe(true);
    expect(motivoParaRecusar(normalizarPedido({ tipo: "corrigir", teto_usd: 1 }), { estimativaUsd: 0.1, saldoLivreUsd: 5, temModelo: true })!.codigo).toBe("instrucao_vazia");
    expect(podeDesfazer(T({ tipo: "textos", commit: "b", commit_anterior: "a" }))).toBe(true);
  });
});

describe("rascunho no git de verdade (worker)", () => {
  const temGit = (() => {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!temGit)("abre o rascunho, salva como versão (main anda) e descarta o seguinte (main fica)", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "rascunho-site-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: pasta });
      writeFileSync(join(pasta, "a.txt"), "versao 1\n");
      await commitar(pasta, "Modelo da casa");
      const v1 = await commitAtual(pasta);

      const r = await abrirRascunho(pasta, { id: "t1", tipo: "ajustar", modelo: "m1", origem: "edicao" });
      expect(r.abriu).toBe(true);
      expect(await ramoAtual(pasta)).toBe("rascunho");
      writeFileSync(join(pasta, "a.txt"), "versao 2\n");
      await commitar(pasta, "Ajuste");
      expect(lerRegistroDoRascunho(pasta)!.trabalhos.map((x) => x.id)).toEqual(["t1"]);

      const salvo = await salvarRascunho(pasta);
      expect(await ramoAtual(pasta)).toBe("main");
      expect(salvo.commit).not.toBe(v1);
      expect(salvo.registro!.base).toBe(v1);
      expect(readFileSync(join(pasta, "a.txt"), "utf8")).toBe("versao 2\n");
      expect(lerRegistroDoRascunho(pasta)).toBeNull();

      await abrirRascunho(pasta, { id: "t2", tipo: "textos", modelo: null, origem: "edicao" });
      writeFileSync(join(pasta, "a.txt"), "versao 3\n");
      writeFileSync(join(pasta, "novo.txt"), "do rascunho\n");
      await commitar(pasta, "Texto");
      const d = await descartarRascunho(pasta);
      expect(d.havia).toBe(true);
      expect(await ramoAtual(pasta)).toBe("main");
      expect(d.commit).toBe(salvo.commit);
      expect(readFileSync(join(pasta, "a.txt"), "utf8")).toBe("versao 2\n");
      expect(existsSync(join(pasta, "novo.txt"))).toBe(false);
      await expect(salvarRascunho(pasta)).rejects.toThrow(/não há rascunho/);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }, 60_000);
});

// ------------------------------------------------------------------ 4. conferência trava publicar

describe("conferência no navegador trava o Publicar", () => {
  it("problema grave trava; 'publicar mesmo assim' libera; aviso não trava", () => {
    const com = T({ tipo: "revisar", resultado: { ramo: "main", build: { ok: true }, conferencia: conf(2, 1) } });
    const t = travaDaPublicacao([com]);
    expect(t).toMatchObject({ ok: false, codigo: "conferencia_com_problemas", graves: 2 });
    expect(t.motivo).toMatch(/mesmo assim/);
    expect(travaDaPublicacao([com], { mesmoAssim: true }).ok).toBe(true);
    expect(travaDaPublicacao([T({ tipo: "revisar", resultado: { ramo: "main", build: { ok: true }, conferencia: conf(0, 3) } })]).ok).toBe(true);
  });

  it("rascunho sem salvar trava antes da conferência (o que sobe é a versão salva)", () => {
    const t = travaDaPublicacao([T({ tipo: "ajustar", resultado: { ramo: "rascunho", build: { ok: true }, conferencia: conf(0) } })], { mesmoAssim: true });
    expect(t.codigo).toBe("rascunho_aberto");
  });

  it("vale a conferência do último trabalho que compilou (o publicar não conta)", () => {
    const velho = T({ tipo: "ajustar", resultado: { ramo: "main", build: { ok: true }, conferencia: conf(3) } });
    const novo = T({ tipo: "revisar", resultado: { ramo: "main", build: { ok: true }, conferencia: conf(0) } });
    const publicou = T({ tipo: "publicar", resultado: { ramo: "main", build: { ok: true } } });
    expect(conferenciaAtual([publicou, novo, velho])!.trabalho.id).toBe(novo.id);
    // Mudou o código sem conferência nova (worker antigo): nenhuma conferência vale.
    const semConferencia = T({ tipo: "construir", resultado: { ramo: "main", build: { ok: true } } });
    expect(conferenciaAtual([semConferencia, velho])).toBeNull();
  });

  it("a medição vira problema: vazando e imagem quebrada são graves, texto cortado é aviso, ruído do navegador some", () => {
    const l = problemasDaMedicao(
      {
        carregou: true,
        status: 200,
        largura_da_tela: 390,
        largura_da_pagina: 460,
        vazando: [{ caminho: "body>div:nth-of-type(1)", secao: "hero", texto: "Café de verdade", direita: 455 }],
        imagens: [{ src: "http://127.0.0.1/imagens/hero.webp?v=1", caminho: "body>img:nth-of-type(1)", secao: "hero" }],
        cortados: [{ caminho: null, secao: "faq", texto: "Pergunta longa" }],
        erros: ["Uncaught TypeError: x is undefined", "Failed to load resource: favicon.ico 404"],
      },
      "celular",
      "/",
    );
    expect(l.map((p) => [p.tipo, p.grave])).toEqual([["execucao", true], ["imagem", true], ["vazando", true], ["cortado", false]]);
    expect(l[1].texto).toMatch(/hero\.webp/);
    expect(l[2].texto).toMatch(/65px da borda no celular/);
    expect(problemasDaMedicao({ carregou: false, status: null, largura_da_tela: 1440, largura_da_pagina: 1440, vazando: [], imagens: [], cortados: [], erros: ["timeout"] }, "computador", "/sobre/")[0]).toMatchObject({ tipo: "pagina", grave: true });
  });

  it("lê a conferência gravada sem confiar no que vier", () => {
    const c = lerConferencia({ ...conf(1), problemas: [...conf(1).problemas, { tipo: "inventado", texto: "x" }] })!;
    expect(c.problemas).toHaveLength(1);
    expect(c.graves).toBe(1);
    expect(lerConferencia({ estado: "outro" })).toBeNull();
  });

  it("os endereços das páginas do dist (a inicial primeiro)", () => {
    const dist = join("C:", "p", "dist");
    expect(enderecosDasPaginas(dist, [join(dist, "sobre", "index.html"), join(dist, "index.html"), join(dist, "contato", "index.html")])).toEqual(["/", "/sobre/", "/contato/"]);
  });
});

// ------------------------------------------------------------------ 5. correção uma vez só

describe("correção da conferência: uma vez só, sem laço", () => {
  const conferida = T({ tipo: "ajustar", resultado: { ramo: "rascunho", build: { ok: true }, conferencia: conf(2, 1) } });

  it("a primeira correção pode, com os graves primeiro", () => {
    const p = podeCorrigir([conferida], conferida.id);
    expect(p.ok).toBe(true);
    expect(p.problemas.map((x) => x.grave)).toEqual([true, true, false]);
    expect(instrucaoDaCorrecao(p.problemas)).toMatch(/^Corrigir o que a conferência no navegador achou:\n1\. \[Conteúdo vazando para o lado, grave\]/);
    expect(promptDaCorrecao(p.problemas, "Café")).toMatch(/uma passada só/);
  });

  it("a segunda correção da mesma conferência é recusada (cancelada antes de rodar não conta)", () => {
    const pedida = T({ tipo: "corrigir", estado: "na_fila", resultado: { conferencia_de: conferida.id } });
    expect(podeCorrigir([pedida, conferida], conferida.id)).toMatchObject({ ok: false });
    const feita = T({ tipo: "corrigir", estado: "feito", resultado: { conferencia_de: conferida.id, ramo: "rascunho" } });
    expect(podeCorrigir([feita, conferida], conferida.id).motivo).toMatch(/já foi pedida uma vez/);
    const cancelada = T({ tipo: "corrigir", estado: "cancelado", resultado: { conferencia_de: conferida.id } });
    expect(podeCorrigir([cancelada, conferida], conferida.id).ok).toBe(true);
  });

  it("a conferência que veio de uma correção não ganha outra rodada automática", () => {
    const daCorrecao = T({ tipo: "corrigir", resultado: { ramo: "rascunho", build: { ok: true }, conferencia: conf(1) } });
    expect(podeCorrigir([daCorrecao], daCorrecao.id).motivo).toMatch(/já é a de uma correção/);
  });

  it("o worker só lê da correção os problemas com texto", () => {
    expect(problemasDoPedido({ problemas: [{ tipo: "vazando", texto: "x", grave: true }, { nada: 1 }] })).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ 6. texto no código, sem IA

const arquivos = (): ArquivoDoCodigo[] => [
  {
    caminho: "src/secoes/Hero.tsx",
    conteudo: [
      "export default function Hero() {",
      "  return (",
      '    <section data-secao="hero">',
      '      <h1 className="titulo">Café de verdade',
      "        em Curitiba</h1>",
      '      <img src="/imagens/hero.webp" alt="Xícara de café" />',
      "      <p>Torra da semana</p>",
      "    </section>",
      "  );",
      "}",
    ].join("\n"),
  },
  {
    caminho: "src/secoes/Servicos.tsx",
    conteudo: [
      'import Cartao from "./Cartao";',
      'const filtro = (x: string) => x === "Entrega rápida";',
      "export default function Servicos() {",
      "  return (",
      "    <section>",
      "      <p>Torra da semana</p>",
      '      <Cartao /><Cartao />',
      '      <span>{filtro("a") ? "sim" : "Entrega rápida"}</span>',
      "    </section>",
      "  );",
      "}",
    ].join("\n"),
  },
  {
    caminho: "src/secoes/Cartao.tsx",
    conteudo: ["export default function Cartao() {", "  return <div>Peça já o seu</div>;", "}"].join("\n"),
  },
];

describe("edição no clique para texto escrito no código", () => {
  it("achou: troca o texto do JSX (mesmo quebrado em linhas) e só ele", () => {
    const p = planejarTrocaDeTexto(arquivos(), { antes: "Café de verdade em Curitiba", depois: "Café fresco em Curitiba" }) as Extract<PlanoDaTroca, { ok: true }>;
    expect(p.ok).toBe(true);
    expect(p.arquivo).toBe("src/secoes/Hero.tsx");
    expect(p.linha).toBe(4);
    expect(p.conteudo).toContain('<h1 className="titulo">Café fresco em Curitiba</h1>');
    expect(p.conteudo).toContain("<p>Torra da semana</p>");
  });

  it("achou num atributo de leitura (alt) e escapa as aspas", () => {
    const p = planejarTrocaDeTexto(arquivos(), { antes: "Xícara de café", depois: 'Xícara "da casa"' });
    expect(p.ok).toBe(true);
    expect((p as Extract<PlanoDaTroca, { ok: true }>).conteudo).toContain('alt="Xícara \\"da casa\\""');
  });

  it("repetido: recusa com motivo e onde aparece", () => {
    const p = planejarTrocaDeTexto(arquivos(), { antes: "Torra da semana", depois: "Torra do dia" });
    expect(p).toMatchObject({ ok: false, codigo: "repetido" });
    expect((p as Extract<PlanoDaTroca, { ok: false }>).motivo).toMatch(/aparece em 2 lugares/);
  });

  it("componente usado em vários lugares, uso na lógica, não achado e texto novo com código: recusa", () => {
    expect(planejarTrocaDeTexto(arquivos(), { antes: "Peça já o seu", depois: "Peça agora" })).toMatchObject({ ok: false, codigo: "componente" });
    expect(planejarTrocaDeTexto(arquivos().slice(1, 2), { antes: "Entrega rápida", depois: "Entrega no dia" })).toMatchObject({ ok: false });
    const so = [{ caminho: "src/secoes/X.tsx", conteudo: 'const filtro = (x: string) => x === "Entrega rápida";' }];
    expect(planejarTrocaDeTexto(so, { antes: "Entrega rápida", depois: "Entrega no dia" })).toMatchObject({ ok: false, codigo: "na_logica" });
    expect(planejarTrocaDeTexto(arquivos(), { antes: "Texto que não existe", depois: "Outro" })).toMatchObject({ ok: false, codigo: "nao_achou" });
    expect(planejarTrocaDeTexto(arquivos(), { antes: "Café de verdade em Curitiba", depois: "<script>x</script>" })).toMatchObject({ ok: false, codigo: "texto_novo" });
    expect(recusaDoTextoNovo("veja https://x.com")).toMatch(/link/);
    expect(recusaDoTextoNovo("")).toMatch(/tirar/);
  });

  it("dentro de uma lista que repete: recusa", () => {
    const lista = [{ caminho: "src/secoes/L.tsx", conteudo: "export default function L({ itens }) {\n  return <ul>{itens.map((i) => (\n    <li key={i}>Saiba mais</li>\n  ))}</ul>;\n}" }];
    expect(planejarTrocaDeTexto(lista, { antes: "Saiba mais", depois: "Veja" })).toMatchObject({ ok: false, codigo: "lista" });
  });

  it("pedaço de palavra não conta e várias trocas só passam juntas", () => {
    expect(localizarTexto([{ caminho: "a.tsx", conteudo: "<p>Cafeteria</p>" }], "Cafe")).toHaveLength(0);
    const r = planejarTrocas(arquivos(), [{ antes: "Café de verdade em Curitiba", depois: "Novo" }, { antes: "Torra da semana", depois: "x" }]);
    expect(r.ok).toBe(false);
    expect(r.recusa!.codigo).toBe("repetido");
    expect(r.arquivos).toEqual(arquivos());
  });

  it("o worker lê as trocas do pedido sem confiar", () => {
    expect(trocasDoPedido([{ antes: "a", depois: "b", secao: "hero" }, { antes: "  " }, "x"])).toEqual([{ antes: "a", depois: "b", secao: "hero" }]);
  });
});

// ------------------------------------------------------------------ tipos (tsc)

describe("conferência de tipos com o erro em palavras simples", () => {
  const saida = [
    "src/secoes/Hero.tsx(12,5): error TS2339: Property 'subtitulo' does not exist on type 'Copy'.",
    "src\\secoes\\Faq.tsx(3,10): error TS2307: Cannot find module './Pergunta' or its corresponding type declarations.",
    "linha que não é erro",
  ].join("\n");

  it("lê arquivo, linha e a frase da equipe", () => {
    const e = errosDoTsc(saida);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ arquivo: "src/secoes/Hero.tsx", linha: 12, codigo: "TS2339" });
    expect(e[0].simples).toBe('o código usa "subtitulo", que não existe em Copy');
    expect(e[1].arquivo).toBe("src/secoes/Faq.tsx");
    expect(e[1].simples).toMatch(/importa ".\/Pergunta", que não foi achado/);
    expect(erroEmPalavras("TS9999", "x")).toBe("erro de tipo (TS9999)");
    expect(resumoDosTipos({ rodou: true, ok: false, erros: e, total: 2, motivo: null })).toMatch(/^Tipos: 2 erros\. Em src\/secoes\/Hero\.tsx linha 12: .*\(e mais 1\)$/);
    expect(resumoDosTipos({ rodou: false, ok: true, erros: [], total: 0, motivo: "o projeto não é TypeScript" })).toMatch(/não rodou/);
  });
});
