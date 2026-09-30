import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aprenderDoPedido,
  type JulgamentoDoEnsino,
  julgamentoPorPalavras,
  lerJulgamento,
  regrasDaMesa,
} from "../../supabase/functions/_shared/aprendizado-das-mesas";
import {
  FONTE_DA_MESA,
  MARCA_DE_TODAS_AS_MESAS,
  MESAS_DO_APRENDIZADO,
  MESAS_QUE_APRENDEM,
  mesaDaFonte,
  pedidoValeParaTodas,
  regraValeParaTodasAsMesas,
} from "../../supabase/functions/_shared/mesas-que-aprendem";
import { decisaoDoConselhoNoCerebro, desfazerDecisaoNoCerebro, textoDaDecisao } from "../../supabase/functions/_shared/sincronia-entre-mesas";
import { esquecerContextoCompleto, lerContextoCompletoDaMarca } from "../../supabase/functions/_shared/contexto-completo-da-marca";
import { esquecerMarcas } from "../../supabase/functions/_shared/marca";
import { aprendizadosDaMesa, aprendizadosDoPainel, mesasDosAprendizados } from "@/components/mesa/aprendizadosDoPainel";
import { pacoteDaTela } from "@/lib/mesa/contextoUsado";
import { itensDaJanela } from "@/components/mesa/JanelaDoContextoUsado";
import { itensUsados, linhaDoUsando } from "../../supabase/functions/_shared/contexto-completo-regras";
import { normalizarMarca } from "@/lib/mesa/marcas";
import { bancoFalso, clienteComDuasMarcas } from "./fixtures/sync-marcas";

/**
 * Frente SYNC (30/09): "tudo é sincronizado 100%, e aprende e evolui também,
 * mesma lógica". A matriz da auditoria (plano/p8-sincronia.md) vira contrato:
 * toda função com IA lê o contexto completo da marca, recebe marca_id e
 * aprende; a decisão do conselho entra no cérebro; a regra que vale "em
 * todas" vale em todas as mesas; a tela lista todas as mesas.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8").replace(/\r\n/g, "\n");
const fontesDaFuncao = (f: string) =>
  readdirSync(resolve(raiz, "supabase/functions", f))
    .filter((n) => /\.ts$/.test(n) && !/_test\.ts$/.test(n))
    .map((n) => ler(`supabase/functions/${f}/${n}`))
    .join("\n");

const CLIENTE = "c0000000-0000-4000-8000-000000000001";
const ACERBI = "a0000000-0000-4000-8000-00000000000a";
const CME = "b0000000-0000-4000-8000-00000000000b";

beforeEach(() => {
  esquecerContextoCompleto();
  esquecerMarcas();
});

// ------------------------------------------------------------------ matriz como contrato

type Aprende = "mesas" | "mesa_do_cliente" | "agentes_gerais" | { excecao: string };
type Marca = "casca" | { excecao: string };
type LinhaDaMatriz = { funcao: string; contexto: RegExp; marca: Marca; aprende: Aprende };

/** Onde cada função lê o contexto completo (a evidência que o teste procura no fonte). */
const COMPLETO = /contextoCompletoParaPrompt\(|lerContextoCompletoDaMarca\(|CONTEXTO_DO_AGENTE\.ler\([^;]{0,160}?\{ ?(cerebro: \d+, dossie: \d+, )?marca:/;
const MATRIZ: LinhaDaMatriz[] = [
  { funcao: "estudio-arte", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "agente-calendario", contexto: COMPLETO, marca: "casca", aprende: "mesa_do_cliente" },
  { funcao: "agente-contexto", contexto: COMPLETO, marca: "casca", aprende: "mesa_do_cliente" },
  { funcao: "agente-estilo", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "mesa-instagram", contexto: COMPLETO, marca: "casca", aprende: "mesa_do_cliente" },
  { funcao: "perfis-instagram", contexto: COMPLETO, marca: "casca", aprende: "mesa_do_cliente" },
  { funcao: "mesa-ads", contexto: COMPLETO, marca: "casca", aprende: "agentes_gerais" },
  { funcao: "mesa-foto", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "mesa-videos", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "editor-video", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "mesa-publicidade", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "mesa-roteiros", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "mesa-proposta", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "contratos", contexto: COMPLETO, marca: { excecao: "contrato é do cliente inteiro (regra da herança); marca_id só quando a tela manda" }, aprende: "mesas" },
  { funcao: "mesa-identidade", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "mesa-mockups", contexto: COMPLETO, marca: "casca", aprende: { excecao: "sem conversa: o Jev dá nota e a cena é imagem" } },
  { funcao: "mesa-site", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "motor-codigo", contexto: COMPLETO, marca: { excecao: "a marca vem do site do pedido" }, aprende: { excecao: "sem agente no Edge: leva as regras da Mesa Site ao worker" } },
  { funcao: "mesa-motion", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "briefing-agente", contexto: COMPLETO, marca: { excecao: "a marca é escolhida na janela do link" }, aprende: { excecao: "sem conversa: a decupagem é do Jev e o Preencher com IA é de uma vez" } },
  { funcao: "documentos", contexto: COMPLETO, marca: "casca", aprende: { excecao: "geração de uma vez: o registro só mostra o que aconteceu" } },
  { funcao: "conselho", contexto: COMPLETO, marca: "casca", aprende: "mesas" },
  { funcao: "preencher-ia", contexto: COMPLETO, marca: "casca", aprende: { excecao: "geração de uma vez, com as fontes escolhidas" } },
  { funcao: "workspace-agent", contexto: /CONTEXTO_DO_AGENTE\.ler\(/, marca: { excecao: "agente geral: sem marca na tela, vale a principal" }, aprende: "agentes_gerais" },
  { funcao: "voice-assistant-agent", contexto: COMPLETO, marca: { excecao: "lançador geral: sem marca na tela, vale a principal" }, aprende: "agentes_gerais" },
  { funcao: "agente-central", contexto: COMPLETO, marca: { excecao: "Central: um cliente por vez, marca principal" }, aprende: "agentes_gerais" },
];

const MARCAS_DA_CASCA = (() => {
  const f = ler("src/lib/mesa/marcas.ts");
  const bloco = f.slice(f.indexOf("const FUNCOES_COM_MARCA = ["), f.indexOf("];", f.indexOf("const FUNCOES_COM_MARCA = [")));
  return (bloco.match(/"[a-z-]+"/g) || []).map((s) => s.slice(1, -1));
})();

const EVIDENCIA_DO_APRENDIZADO: Record<Exclude<Aprende, { excecao: string }>, RegExp[]> = {
  mesas: [/aprenderDoPedido\(/, /regrasDaMesa\(/],
  mesa_do_cliente: [/aprenderComOPedido\(/, /lerRegrasDoDono\(/],
  agentes_gerais: [/aprenderNoServidor\(/, /regrasDoAgente\(/],
};

describe("matriz da sincronia como contrato (toda função com IA)", () => {
  it("cobre as 26 funções do pedido do dono", () => {
    expect(MATRIZ.map((l) => l.funcao).length).toBe(26);
  });

  for (const l of MATRIZ) {
    it(`${l.funcao}: lê o contexto completo da marca, recebe a marca e aprende`, () => {
      const fonte = fontesDaFuncao(l.funcao);
      expect(fonte, `${l.funcao} lê o contexto completo`).toMatch(l.contexto);
      if (l.marca === "casca") expect(MARCAS_DA_CASCA, `${l.funcao} em FUNCOES_COM_MARCA`).toContain(l.funcao);
      else expect(l.marca.excecao.length).toBeGreaterThan(10);
      if (typeof l.aprende === "string") for (const re of EVIDENCIA_DO_APRENDIZADO[l.aprende]) expect(fonte, `${l.funcao} aprende (${re})`).toMatch(re);
      else expect(l.aprende.excecao.length).toBeGreaterThan(10);
    });
  }

  it("toda mesa que chama aprenderDoPedido está na lista única (e a tela a mostra)", () => {
    const mesas = new Set<string>();
    for (const l of MATRIZ) {
      const f = fontesDaFuncao(l.funcao);
      const re = /aprenderDoPedido\([^{]*\{[^}]*?mesa: "([a-z]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f))) mesas.add(m[1]);
    }
    expect(mesas.size).toBeGreaterThan(10);
    for (const mesa of Array.from(mesas)) expect(MESAS_QUE_APRENDEM as readonly string[], mesa).toContain(mesa);
    const fontesDaTela = MESAS_DO_APRENDIZADO.map((m) => m.fonte);
    for (const m of MESAS_QUE_APRENDEM) expect(fontesDaTela, m).toContain(FONTE_DA_MESA[m]);
  });

  it("quem já usava o leitor antigo passa a marca (a CME nunca lê a Acerbi)", () => {
    for (const [arq, trecho] of [
      ["supabase/functions/mesa-publicidade/index.ts", "marca: (campanha && campanha.marca_id)"],
      ["supabase/functions/mesa-roteiros/index.ts", "{ marca: marcaDaConversa, partes: PARTES_COM_O_CONTEXTO }"],
      ["supabase/functions/mesa-identidade/diretor.ts", "{ marca: marcaId, partes: TODAS_AS_PARTES, area: \"identidade\" }"],
      ["supabase/functions/mesa-site/index.ts", "{ marca: marca || s.marca_id, partes: PARTES_COM_O_CONTEXTO, area: \"site\" }"],
      ["supabase/functions/mesa-motion/index.ts", "{ marca: kit.marca || f.marca_id, partes: PARTES_COM_O_CONTEXTO, area: \"video\" }"],
      ["supabase/functions/mesa-proposta/index.ts", "{ marca: linha.marca_id, partes: PARTES_COMPLEMENTARES.filter"],
      ["supabase/functions/conselho/index.ts", "marca: marca, partes: outra ?"],
    ] as const) expect(ler(arq), arq).toContain(trecho);
    // O leitor antigo delega ao pacote completo (a herança mora num lugar só).
    expect(ler("supabase/functions/_shared/contexto-do-agente.ts")).toContain("contextoCompletoParaPrompt(db, clientId, limites.marca ?? null, {");
  });

  it("o editor e os mockups mandam a marca aberta (FUNCOES_COM_MARCA e corpoComMarca)", () => {
    expect(ler("src/lib/editor/api.ts")).toContain('corpoComMarca("editor-video", corpo)');
    expect(MARCAS_DA_CASCA).toEqual(expect.arrayContaining(["editor-video", "mesa-mockups"]));
  });

  it("o lançador lê o briefing pelas colunas certas (responses e submitted)", () => {
    const f = ler("supabase/functions/voice-assistant-agent/index.ts");
    expect(f).toContain('.select("responses, submitted, created_at")');
    expect(f).not.toContain('.select("answers, status, created_at")');
  });
});

// ------------------------------------------------------------------ decisões do conselho no cérebro

describe("decisão do conselho entra no cérebro (Decidir é o Confirmar, Desfazer tira)", () => {
  it("vira aprendizado da área geral com a marca, e o pacote não a repete no cérebro", async () => {
    const { db, tabelas } = bancoFalso(clienteComDuasMarcas());
    const sessao = "e1000000-0000-4000-8000-000000000001";
    const r = await decisaoDoConselhoNoCerebro(db, { clientId: CLIENTE, sessaoId: sessao, tema: "Cursos", resumo: "CME foca em cursos online", marcaId: CME, userId: "u1" }, { julgar: null });
    expect(r.gravada).toBe(true);
    const linha = tabelas.agente_memoria.find((l) => l.referencia_id === sessao)!;
    expect(linha).toEqual(expect.objectContaining({ area: "geral", agente: "geral", fonte: "conselho", categoria: "aprendizado", valido_ate: null }));
    expect(String(linha.evidencia)).toContain(`marca:${CME}`);
    expect(linha.texto).toBe(textoDaDecisao("Cursos", "CME foca em cursos online"));
    const p = await lerContextoCompletoDaMarca(db, CLIENTE, CME);
    expect((p.cerebro && p.cerebro.texto) || "").not.toContain("Decisão do conselho");
    expect(p.decisoes.map((d) => d.resumo)).toContain("CME foca em cursos online");
    const d = await desfazerDecisaoNoCerebro(db, { clientId: CLIENTE, sessaoId: sessao });
    expect(d.ok).toBe(true);
    expect(linha.ativa).toBe(false);
  });

  it("a função do conselho grava e tira a decisão do cérebro, e a conversa aprende", () => {
    const f = ler("supabase/functions/conselho/index.ts");
    expect(f).toContain("decisaoDoConselhoNoCerebro(servico(), { clientId: sessao.client_id, sessaoId: sessao.id, tema: sessao.tema, resumo, marcaId: sessao.marca_id, userId: ch.userId })");
    expect(f).toContain("desfazerDecisaoNoCerebro(servico(), { clientId: sessao.client_id, sessaoId: sessao.id })");
    expect(f).toContain('aprenderDoPedido(servico(), { clientId: sessao.client_id, mesa: "conselho"');
    expect(f).toContain('regrasDaMesa(servico(), { clientId: sessao.client_id, mesa: "conselho", marcaId: sessao.marca_id })');
    expect(f).toContain('...rotasDoAprendizado({ mesa: "conselho"');
  });
});

// ------------------------------------------------------------------ regra "em todas as mesas"

const duradoura = (alcance?: "todas"): (() => Promise<JulgamentoDoEnsino>) => async () => ({ decisao: "preferencia_duradoura", tipo: "evitar", probabilidade: 0.9, fonte: "jev", ...(alcance ? { alcance } : {}) });

describe("regra aprendida numa mesa com área geral vale em todas", () => {
  it("o dono diz \"em todas as mesas\": a regra vai para a geral e a Mesa Foto passa a obedecer a regra ensinada na Mesa Vídeos", async () => {
    const { db, tabelas } = bancoFalso({});
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "video", pedido: "nunca use música triste, em todas as mesas", regraSugerida: "Não usar música triste", marcaId: ACERBI }, { julgarEnsino: duradoura("todas"), julgarDuplicidade: null });
    expect(a).toEqual(expect.objectContaining({ alcance: "todas", categoria: "evitar" }));
    const linha = tabelas.agente_memoria[0];
    expect(linha).toEqual(expect.objectContaining({ area: "geral", agente: "geral", fonte: "mesa_videos" }));
    expect(String(linha.evidencia)).toContain(MARCA_DE_TODAS_AS_MESAS);
    const foto = await regrasDaMesa(db, { clientId: CLIENTE, mesa: "foto", marcaId: ACERBI });
    expect(foto.bloco).toContain("Não usar música triste");
    // Na outra marca não vale (a regra é da Acerbi).
    expect((await regrasDaMesa(db, { clientId: CLIENTE, mesa: "foto", marcaId: CME })).bloco).toBe("");
  });

  it("sem \"em todas\", a regra da Mesa Vídeos (área arte) e a de Contratos (área geral local) não passam para a Mesa Foto", async () => {
    const { db } = bancoFalso({});
    await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "video", pedido: "nunca use zoom", regraSugerida: "Não usar zoom" }, { julgarEnsino: duradoura(), julgarDuplicidade: null });
    await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "contrato", pedido: "nunca multa de 10%", regraSugerida: "Multa máxima de 2%" }, { julgarEnsino: duradoura(), julgarDuplicidade: null });
    expect((await regrasDaMesa(db, { clientId: CLIENTE, mesa: "foto" })).bloco).toBe("");
    expect((await regrasDaMesa(db, { clientId: CLIENTE, mesa: "contrato" })).bloco).toContain("Multa máxima de 2%");
  });

  it("o Jev decide o alcance (certeza alta); sem Jev, as palavras", () => {
    const base = { duracao: { choice: "preferencia_duradoura", probabilities: { preferencia_duradoura: 0.9 } }, tipo: { choice: "evitar" } };
    expect(lerJulgamento({ ...base, alcance: { choice: "todas_as_mesas", probabilities: { todas_as_mesas: 0.85 } } })!.alcance).toBe("todas");
    expect(lerJulgamento({ ...base, alcance: { choice: "todas_as_mesas", probabilities: { todas_as_mesas: 0.55 } } })!.alcance).toBeUndefined();
    expect(lerJulgamento(base)).toEqual({ decisao: "preferencia_duradoura", tipo: "evitar", probabilidade: 0.9, fonte: "jev" });
    expect(julgamentoPorPalavras("nunca use rosa em todas as mesas").alcance).toBe("todas");
    expect(julgamentoPorPalavras("nunca use rosa").alcance).toBeUndefined();
    expect(pedidoValeParaTodas("isso vale para tudo")).toBe(true);
    expect(regraValeParaTodasAsMesas({ area: "geral", fonte: "agente_do_mes" })).toBe(true);
    expect(regraValeParaTodasAsMesas({ area: "geral", fonte: "mesa_contratos" })).toBe(false);
    expect(regraValeParaTodasAsMesas({ area: "geral", fonte: "mesa_contratos", evidencia: MARCA_DE_TODAS_AS_MESAS })).toBe(true);
  });
});

// ------------------------------------------------------------------ Mesa Identidade: estratégia e tagline viram contexto

describe("estratégia aprovada e tagline viram contexto da marca (sugestão com Confirmar e Desfazer)", () => {
  it("a sugestão do kit leva o contexto da estratégia e a tagline; o executor aplica e desfaz campo a campo", () => {
    const b = ler("supabase/functions/mesa-identidade/brandbook-acoes.ts");
    expect(b).toContain('export const OPERACOES_DO_KIT = ["kit_paleta", "kit_tipografia", "kit_logo", "kit_contexto"] as const;');
    expect(b).toContain('cargas["kit_contexto:k5"] = { campos: doContexto };');
    expect(b).toContain('cargas["kit_contexto:k6"] = { campos: { tagline: tagline.slice(0, 140) } };');
    expect(b).toContain('return { campo: "contexto.campos", antes: r.antes };');
    expect(b).toContain('if (campo === "contexto.campos") {');
    expect(ler("supabase/functions/mesa-identidade/diretor.ts")).toContain('case "kit_contexto": {');
  });
});

// ------------------------------------------------------------------ "O que o painel aprendeu" lista todas as mesas

describe("a tela \"O que o painel aprendeu\" lista todas as mesas", () => {
  const linhas = [
    { id: "1", agente: "diretor_arte", texto: "Luz natural", categoria: "preferencia", area: "foto", fonte: "mesa_foto" },
    { id: "2", agente: "geral", texto: "Não usar música triste", categoria: "evitar", area: "geral", fonte: "mesa_videos", evidencia: `${MARCA_DE_TODAS_AS_MESAS}; pedido: "x"` },
    { id: "3", agente: "geral", texto: "Decisão do conselho (Natal): foco no pernil", categoria: "aprendizado", area: "geral", fonte: "conselho" },
    { id: "4", agente: "estrategista", texto: "Proposta com 3 opções", categoria: "preferencia", area: "copy", fonte: "mesa_proposta" },
  ];

  it("toda mesa aparece (zero também), a regra de todas conta em cada uma e o filtro a mantém", () => {
    const lista = aprendizadosDoPainel(linhas);
    const mesas = mesasDosAprendizados(lista);
    const nomes = mesas.map((m) => m.rotulo);
    for (const m of ["Mesa Foto", "Mesa Vídeos", "Mesa Proposta", "Contratos", "Mesa Motion", "Conselho", "Decisões do conselho", "Mês", "Central"]) expect(nomes).toContain(m);
    expect(mesas.find((m) => m.rotulo === "Mesa Foto")!.total).toBe(2);
    expect(mesas.find((m) => m.rotulo === "Mesa Motion")!.total).toBe(1);
    expect(aprendizadosDaMesa(lista, "Mesa Foto").map((a) => a.id).sort()).toEqual(["1", "2"]);
    expect(lista.find((a) => a.id === "2")).toMatchObject({ todasAsMesas: true, mesa: "Mesa Vídeos" });
    expect(lista.find((a) => a.id === "4")).toMatchObject({ origem: "Mesa Proposta", fonte: "pedido" });
    expect(mesaDaFonte("conselho")).toBe("Decisões do conselho");
  });

  it("a tela tem o seletor de mesa e a linha diz \"todas as mesas\"", () => {
    const tela = ler("src/components/mesa/ContextoAprendizados.tsx");
    expect(tela).toContain('rotulo="Mesa"');
    expect(tela).toContain('a.todasAsMesas ? "todas as mesas" : ""');
    expect(ler("src/components/agentes/AprendizadoDoAgente.tsx")).toContain("(vale em todas as mesas)");
  });
});

// ------------------------------------------------------------------ "Usando: ..." em cada mesa

describe("cada mesa mostra o que os agentes leem (janela central)", () => {
  it("a leitura da tela segue a herança: a CME vê o dela, a Acerbi vê a estratégia aprovada", () => {
    const d = clienteComDuasMarcas();
    const marcas = d.cliente_marcas.map((m) => normalizarMarca(m)!).filter(Boolean);
    const linhas = {
      nomeCliente: "Acerbi Carnes",
      kit: d.cliente_kit_marca[0],
      marcas,
      briefings: d.briefings,
      projetos: d.idv_projetos.map((p) => ({ ...p, estrategia: p.dados.estrategia, tagline: p.dados.naming ? p.dados.naming.slogan : null })),
      dossies: d.client_dossiers,
      decisoes: d.project_memory,
      memoria: d.agente_memoria,
      contas: d.external_accounts as never,
      ligacoes: d.project_external_accounts as never,
    };
    const cme = pacoteDaTela(linhas, CME, CLIENTE);
    expect(linhaDoUsando(itensUsados(cme))).toBe("Usando: contexto da marca CME (com o kit), briefing de 28/09, estratégia v1 em construção, dossiê de 26/09, 1 decisão(ões) do conselho, cérebro (1 regra(s) ensinada(s)), Instagram @cmeacerbi.");
    const acerbi = pacoteDaTela(linhas, ACERBI, CLIENTE);
    const linha = linhaDoUsando(itensUsados(acerbi));
    expect(linha).toContain("contexto da marca Acerbi (com o kit)");
    expect(linha).toContain("estratégia v3 aprovada com tagline");
    expect(linha).toContain("briefing de 20/09");
    expect(linha).toContain("Instagram @acerbicarnes");
    const itens = itensDaJanela(acerbi);
    expect(itens.find((i) => i.chave === "estrategia")).toMatchObject({ le: true });
    expect(itens.find((i) => i.chave === "estrategia")!.texto).toContain('tagline "O pernil da família"');
  });

  it("o botão mora na casca de todas as mesas e abre numa janela central (nunca gaveta)", () => {
    expect(ler("src/components/sistema/CascaDaMesa.tsx")).toContain("<BotaoDoContextoUsado clientId={clientId} marcaId={marcaId}");
    const janela = ler("src/components/mesa/JanelaDoContextoUsado.tsx");
    expect(janela).toContain("<JanelaCentral");
    expect(janela).not.toMatch(/Sheet|Drawer|lateral=/);
  });

  it("falha de leitura na tela vai para o log (nada engolido)", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = ler("src/lib/mesa/contextoUsado.ts");
    expect(f).toContain("console.error(`[contexto usado] ${nome} não lido`, e);");
    expect(f).toContain("pacote.avisos = avisos;");
    erro.mockRestore();
  });
});
