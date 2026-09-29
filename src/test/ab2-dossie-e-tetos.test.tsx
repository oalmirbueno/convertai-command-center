import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { MARCADOR_DO_MEIO, recortarDossie } from "../../supabase/functions/_shared/dossie-recortado";
import {
  FILTRO_SEM_IMAGEM_NEM_VIDEO,
  inserirSemDuplicar,
  juntarDossies,
  lerDocumentosDeMarca,
  todasAsPaginas,
} from "../../supabase/functions/_shared/contexto-cliente";
import { executarLeituras } from "../../supabase/functions/_shared/ferramentas-do-cliente";
import { openRouterSlug, requestAiChatCompletion, resolveAiProviderChain, type AiProviderEnvName } from "../../supabase/functions/_shared/ai-provider";
import {
  blocoDosAlvos,
  comApelido,
  foraDaLista,
  MAX_ALVOS_PARA_O_AGENTE,
  MAX_ITENS_POR_ACAO,
  normalizarAcaoDoAgente,
  podeExecutarDireto,
} from "../../supabase/functions/_shared/acoes-do-agente";
import { lerTodasAsPaginas } from "@/lib/paginasDoBanco";
import { repetirEntregaEmPartes } from "@/lib/mesa/entregaEmPartes";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import type { AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";

/**
 * Anti-bug 26/09, segunda rodada (AB2): dossiê cortado pelo começo, tetos
 * silenciosos, contas que paravam em 1.000 linhas, 429 da OpenAI na Central,
 * cópia leve sem clone e o mapa do painel no agente de edição.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Consulta falsa do supabase-js: registra a cadeia e devolve `resposta` no await. */
function consultaFalsa(resposta: (chamadas: Array<[string, unknown[]]>) => unknown) {
  const chamadas: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(q, {
    get(_alvo, nome: string) {
      if (nome === "then") return (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resposta(chamadas)).then(ok, erro);
      return (...args: unknown[]) => {
        chamadas.push([nome, args]);
        return proxy;
      };
    },
  });
  return { consulta: proxy, chamadas };
}

// Dossiê com a leitura da semana e o "Confirmado pelo dono" no FIM (como o agente-central grava).
const dossieGrande = [
  "# Dossiê Cliente X",
  "Resumo: loja de móveis em Curitiba, foco em Instagram e tráfego.",
  ...Array.from({ length: 400 }, (_, i) => `- histórico antigo linha ${i} com bastante texto para ocupar espaço no dossiê`),
  "## Leitura da semana (agente da Central)",
  "Onde estamos: campanha de primavera rodando.",
  "## Confirmado pelo dono",
  "- A campanha de primavera segue com R$ 30 por dia até 10/10.",
].join("\n");

describe("C. dossiê: fica o começo curto e o FIM (o mais recente)", () => {
  it("recortarDossie guarda o cabeçalho, o marcador e as seções recentes do fim, dentro do limite", () => {
    const r = recortarDossie(dossieGrande, 6000);
    expect(r.length).toBeLessThanOrEqual(6000);
    expect(r.startsWith("# Dossiê Cliente X")).toBe(true);
    expect(r).toContain(MARCADOR_DO_MEIO);
    expect(r).toContain("## Confirmado pelo dono");
    expect(r).toContain("R$ 30 por dia até 10/10.");
    expect(r).not.toContain("antigo linha 150 com");
    // Antes: .slice(0, 6000) perdia exatamente o fim.
    expect(dossieGrande.slice(0, 6000)).not.toContain("Confirmado pelo dono");
  });

  it("texto que cabe volta igual; limite pequeno fica com o fim", () => {
    expect(recortarDossie("curto", 100)).toBe("curto");
    expect(recortarDossie("", 100)).toBe("");
    const pequeno = recortarDossie(dossieGrande, 60);
    expect(pequeno.length).toBeLessThanOrEqual(60);
    expect(dossieGrande.endsWith(pequeno)).toBe(true);
    for (const n of [120, 400, 1400, 3000, 12000]) expect(recortarDossie(dossieGrande, n).length).toBeLessThanOrEqual(n);
  });

  it("juntarDossies põe o geral primeiro e mantém o fim dele mesmo com projeto junto", () => {
    const texto = juntarDossies([
      { dossier_type: "projeto", project_id: "p1", summary: null, content: "complemento do projeto ".repeat(200) },
      { dossier_type: "contexto", project_id: null, summary: "Resumo geral", content: dossieGrande },
    ], 6000);
    expect(texto.length).toBeLessThanOrEqual(6000);
    expect(texto.startsWith("[contexto]")).toBe(true);
    expect(texto).toContain("R$ 30 por dia até 10/10.");
    expect(texto).toContain("[projeto]");
  });

  it("ler_dossie (ferramenta do agente) usa o recorte no teto de 5.000", async () => {
    const saida = await executarLeituras({ from: () => { throw new Error("sem banco"); } }, "c1", [{ ferramenta: "ler_dossie", argumento: "" }], {
      lerDossie: async () => dossieGrande,
      lerCerebro: async () => "",
      hoje: "2026-09-26",
    });
    expect(saida).toContain(MARCADOR_DO_MEIO);
    expect(saida).toContain("R$ 30 por dia até 10/10.");
  });

  it("todos os pontos que cortavam pelo começo usam a função única", () => {
    const central = ler("supabase/functions/agente-central/index.ts");
    expect(central).toContain("recortarDossie(dossie.content, LIMITE_DOSSIE_PREPARAR)");
    expect(central).toContain("recortarDossie(dossieNovo?.content ?? \"\", LIMITE_DOSSIE_FATOS)");
    expect(central).toContain("recortarDossie(fatos, LIMITE_FATOS)");
    expect(central).not.toMatch(/content\.slice\(0, 9000\)|\.slice\(0, 7000\)|\}\)\.slice\(0, 12000\)/);
    expect(ler("supabase/functions/ritual-writer/index.ts")).toContain('recortarDossie(String(body?.facts || ""), 12000)');
    expect(ler("supabase/functions/esteira-semana/index.ts")).toContain('recortarDossie(String(d?.content || d?.summary || ""), 7000)');
    expect(ler("supabase/functions/radar-ideas/index.ts")).toMatch(/recortarDossie\(String\(d\.content \|\| d\.summary \|\| ""\)[^\n]*d\.project_id \? 500 : 1400\)/);
    const ads = ler("supabase/functions/mesa-ads/index.ts");
    expect(ads).toContain('recortarDossie(String(d.content ?? ""), 12000)');
    expect(ads).toContain('recortarDossie(String(ctx.dados.dossie_atual ?? ""), 3000)');
    expect(ler("supabase/functions/_shared/contexto-cliente.ts")).toContain("return juntarDossies(linhas, limite) || null;");
    expect(ler("supabase/functions/_shared/cerebro-do-cliente.ts")).toContain("recortarDossie(corpo, limiteDossie)");
    expect(ler("supabase/functions/cycle-coach/index.ts")).toContain("recortarDossie(");
  });
});

describe("E. agente-central: 429 da OpenAI com contexto menor e rota de reserva", () => {
  const env = (v: Partial<Record<AiProviderEnvName, string>>) => (n: AiProviderEnvName) => v[n];

  it("com openRouterReserve, o MESMO modelo pelo OpenRouter vem logo depois da conta direta", () => {
    const p = resolveAiProviderChain({ primaryModels: ["gpt-4.1", "gpt-4o"], openRouterReserve: true }, env({ OPENAI_API_KEY: "k", OPENROUTER_API_KEY: "r" }));
    expect(p.map((x) => `${x.kind}/${x.model}`)).toEqual(["openai/gpt-4.1", "openrouter/openai/gpt-4.1", "openai/gpt-4o", "openrouter/openai/gpt-4o"]);
    expect(p[1].chatCompletionsUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(openRouterSlug("anthropic/claude")).toBe("anthropic/claude");
  });

  it("sem a opção (ou sem a chave), a cadeia fica igual à de antes", () => {
    expect(resolveAiProviderChain({ primaryModels: ["gpt-4.1"] }, env({ OPENAI_API_KEY: "k", OPENROUTER_API_KEY: "r" })).map((x) => x.kind)).toEqual(["openai"]);
    expect(resolveAiProviderChain({ primaryModels: ["gpt-4.1"], openRouterReserve: true }, env({ OPENAI_API_KEY: "k" })).map((x) => x.kind)).toEqual(["openai"]);
  });

  it("429 na OpenAI cai no OpenRouter com o mesmo modelo", async () => {
    const p = resolveAiProviderChain({ primaryModels: ["gpt-4.1"], openRouterReserve: true }, env({ OPENAI_API_KEY: "k", OPENROUTER_API_KEY: "r" }));
    const corpos: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      corpos.push(String(init?.body));
      return String(url).includes("openai.com") ? new Response("Rate limit reached for gpt-4.1 (tokens per min)", { status: 429 }) : new Response("{}", { status: 200 });
    });
    const r = await requestAiChatCompletion(p, { messages: [] }, fetcher);
    expect(r.provider.kind).toBe("openrouter");
    expect(JSON.parse(corpos[1]).model).toBe("openai/gpt-4.1");
  });

  it("agente-central e o escritor do ritual pedem a reserva e o contexto encolheu", () => {
    const central = ler("supabase/functions/agente-central/index.ts");
    // Frente CE (28/09): o modelo passou a ser o GPT-6 Luna pelo motor das
    // mesas; a cadeia antiga com a reserva do OpenRouter mora agora no
    // escritor compartilhado (_shared/modelo-da-central.ts), que o agente e o
    // escritor do ritual usam.
    const modelo = ler("supabase/functions/_shared/modelo-da-central.ts");
    expect(modelo).toContain("openRouterReserve: true");
    expect(central).toContain("escreverComModeloDaCentral");
    expect(central).toContain("export const LIMITE_DOSSIE_PREPARAR = 6000;");
    expect(central).toContain("export const LIMITE_FATOS = 9000;");
    expect(central).toContain("lerContextoDoRitual(db, clientId, { ritual, limite: LIMITE_CONTEXTO_PREPARAR })");
    expect(central).not.toContain("limite: 8000");
    expect(ler("supabase/functions/ritual-writer/escritor.ts")).toContain("escreverComModeloDaCentral");
  });
});

describe("B. contrato agêntico: teto não corta calado", () => {
  const alvos = comApelido(Array.from({ length: 140 }, (_, i) => ({ id: `id-${i}`, titulo: `Foto ${i}` })), "f");
  const regras = { arquivar: { rotulo: "arquivar", direta: true } };

  it("pedido acima de 120 itens: 120 na lista e o resto em acima_do_teto (antes sumia no break)", () => {
    const itens = alvos.map((a) => ({ operacao: "arquivar", ref: a.ref, para: "" }));
    const acao = normalizarAcaoDoAgente({ resumo: "", itens }, alvos, regras, { agente: "teste" })!;
    expect(acao.itens).toHaveLength(MAX_ITENS_POR_ACAO);
    expect(acao.acima_do_teto).toBe(140 - MAX_ITENS_POR_ACAO);
    expect(acao.ignorados).toEqual([]);
    expect(podeExecutarDireto({ ...acao, itens: acao.itens.slice(0, 2) }, regras, { pedidoClaro: true })).toEqual({ direto: false, motivo: "parte do pedido passou do teto" });
  });

  it("comApelido acima de 150 avisa o agente no bloco dos alvos", () => {
    const muitos = comApelido(Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, titulo: `Item ${i}` })), "a");
    expect(muitos).toHaveLength(MAX_ALVOS_PARA_O_AGENTE);
    expect(foraDaLista(muitos)).toBe(50);
    expect(JSON.stringify(muitos)).not.toContain("foraDaLista");
    const bloco = blocoDosAlvos("FOTOS", muitos);
    expect(bloco).toContain("mostra 150 de 200");
    expect(bloco).toContain("Os outros 50 não estão aqui");
    expect(blocoDosAlvos("FOTOS", comApelido([{ id: "1", titulo: "a" }], "a"))).not.toContain("ATENÇÃO");
  });

  it("o cartão mostra quantos ficaram para um próximo pedido", () => {
    const acao: AcaoDoAgente = {
      tipo: "acao_agente", agente: "t", id: "p1", resumo: "Vou arquivar 120 itens.",
      itens: [{ ref: "f1", alvo_id: "a", titulo: "foto", detalhe: null, operacao: "arquivar", rotulo: "arquivar", para: null }],
      ignorados: [], recusados: [], acima_do_teto: 20,
    };
    render(h(CartaoDeAcao, { acao, onPedido: vi.fn() }));
    expect(screen.getByText(/20 itens ficaram para um próximo pedido: o limite é 120 por vez\./)).toBeTruthy();
  });
});

describe("D. tetos implícitos de 1.000 linhas", () => {
  it("lerDocumentosDeMarca tira imagem e vídeo no banco, antes do limite de 400", async () => {
    const arquivos = consultaFalsa(() => ({ data: [{ id: "d1", file_name: "Manual da marca.pdf", file_type: null, mime_type: "application/pdf" }] }));
    const pedacos = consultaFalsa(() => ({ data: [{ file_id: "d1", chunk_index: 0, text: "Cores: verde e areia." }] }));
    const db = { from: (t: string) => (t === "files" ? arquivos.consulta : pedacos.consulta) };
    const docs = await lerDocumentosDeMarca(db as never, "c1", 1000);
    expect(docs.map((d) => d.nome)).toEqual(["Manual da marca.pdf"]);
    const nomes = arquivos.chamadas.map((c) => c[0]);
    expect(nomes.indexOf("or")).toBeGreaterThan(0);
    expect(nomes.indexOf("or")).toBeLessThan(nomes.indexOf("limit"));
    expect(arquivos.chamadas[nomes.indexOf("or")][1][0]).toBe(FILTRO_SEM_IMAGEM_NEM_VIDEO);
    expect(FILTRO_SEM_IMAGEM_NEM_VIDEO).toBe("mime_type.is.null,and(mime_type.not.ilike.image/*,mime_type.not.ilike.video/*)");
  });

  it("todasAsPaginas (servidor) e lerTodasAsPaginas (tela) passam de 1.000 linhas", async () => {
    const linhas = Array.from({ length: 2345 }, (_, i) => ({ i }));
    const pagina = (de: number, ate: number) => Promise.resolve({ data: linhas.slice(de, ate + 1), error: null });
    expect(await todasAsPaginas(pagina, 5000)).toHaveLength(2345);
    expect(await todasAsPaginas(pagina, 1500)).toHaveLength(1500);
    const r = await lerTodasAsPaginas(() => ({ range: pagina }));
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(2345);
    const erro = await lerTodasAsPaginas(() => ({ range: () => Promise.resolve({ data: null, error: { message: "caiu" } }) }));
    expect(erro.error).toEqual({ message: "caiu" });
  });

  it("inserirSemDuplicar: o lote que bate no índice único grava o resto em vez de perder tudo", async () => {
    const noBanco = new Set(["b", "d"]);
    const gravadas: string[] = [];
    const linhas = ["a", "b", "c", "d", "e"].map((k) => ({ k }));
    const r = await inserirSemDuplicar(linhas, {
      inserir: async (grupo) => {
        if (grupo.some((l) => noBanco.has(l.k))) return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        grupo.forEach((l) => { noBanco.add(l.k); gravadas.push(l.k); });
        return { error: null };
      },
      existentes: async (grupo) => grupo.filter((l) => noBanco.has(l.k)),
    }, 200);
    expect(r).toEqual({ novas: 3, duplicadas: 2, falhas: 0 });
    expect(gravadas.sort()).toEqual(["a", "c", "e"]);
  });

  it("sincronizarAcervo lê por páginas e grava sem perder o lote", () => {
    const f = ler("supabase/functions/_shared/contexto-cliente.ts");
    const i = f.indexOf("export async function sincronizarAcervo(");
    const corpo = f.slice(i, f.indexOf("\n}\n", i));
    expect(corpo.match(/todasAsPaginas</g)).toHaveLength(3);
    expect(corpo).toContain('.order("id", { ascending: true }).range(de, ate)');
    expect(corpo).toContain("inserirSemDuplicar(linhas");
    expect(corpo).not.toContain(".limit(5000)");
  });

  it("Ciclo (cycleSituation) lê cada consulta da carteira por páginas", () => {
    const f = ler("src/lib/cycleSituation.ts");
    expect(f).toContain('import { lerTodasAsPaginas } from "@/lib/paginasDoBanco";');
    for (const tabela of ["files", "editorial_publications", "project_memory", "editorial_posts", "social_metrics_weekly", "ads_campaign_daily", "briefings", "client_dossiers"]) {
      expect(f).toMatch(new RegExp(`lerTodasAsPaginas\\(\\(\\) => \\(supabase as any\\)\\n\\s+\\.from\\("${tabela}"\\)`));
    }
  });

  it("journey-narrative conta no banco (número exato ao cliente), sem a lista de 20", () => {
    const f = ler("supabase/functions/journey-narrative/index.ts");
    expect(f.match(/count: "exact", head: true/g)!.length).toBeGreaterThanOrEqual(3);
    expect(f).not.toContain(".limit(20)");
    expect(f).not.toContain(".limit(200)");
    expect(f).toContain("Materiais produzidos no mês: ${filesCount}");
  });

  it("cycle-coach lê só a janela de 7 dias da agenda", () => {
    const f = ler("supabase/functions/cycle-coach/index.ts");
    const i = f.indexOf('db.from("editorial_publications")');
    const trecho = f.slice(i, i + 400);
    expect(trecho).toContain('.gte("scheduled_at", new Date(Date.now() - JANELA_DA_AGENDA_MS).toISOString())');
    expect(trecho).toContain('.lte("scheduled_at", new Date(Date.now() + JANELA_DA_AGENDA_MS).toISOString())');
  });
});

describe("A1 (tela). entrega do Estúdio em partes continua sozinha", () => {
  it("repete só no 409 entrega_em_partes, até o teto de rodadas", async () => {
    const parte = Object.assign(new Error("2 de 8 lâminas já estão em Arquivos."), { codigo: "entrega_em_partes" });
    const chamar = vi.fn().mockRejectedValueOnce(parte).mockRejectedValueOnce(parte).mockResolvedValueOnce({ ok: true });
    await expect(repetirEntregaEmPartes(chamar)).resolves.toEqual({ ok: true });
    expect(chamar).toHaveBeenCalledTimes(3);
    const outro = Object.assign(new Error("x"), { codigo: "sem_saldo" });
    const falha = vi.fn().mockRejectedValue(outro);
    await expect(repetirEntregaEmPartes(falha)).rejects.toBe(outro);
    expect(falha).toHaveBeenCalledTimes(1);
    const sempre = vi.fn().mockRejectedValue(parte);
    await expect(repetirEntregaEmPartes(sempre, 3)).rejects.toBe(parte);
    expect(sempre).toHaveBeenCalledTimes(3);
  });

  it("as três telas que entregam usam a repetição", () => {
    for (const p of ["src/components/mesa/AbaEntrega.tsx", "src/components/mesa-ads/AbaEstudioAds.tsx"]) {
      expect(ler(p), p).toMatch(/repetirEntregaEmPartes\(\(\) => chamarFuncao\("estudio-arte", \{ acao: "entregar"/);
    }
    // Frente EN: o Estúdio entrega pelas três opções (entregaComOpcoes), com a mesma repetição.
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("await entregarComModo(trabalho.id, modo, { mostrarAoCliente })");
    expect(ler("src/lib/mesa/entregaComOpcoes.ts")).toContain("await repetirEntregaEmPartes(() => chamar(corpoDoEntregar(trabalhoId, modo)));");
  });

  it("imagem-reduzida: a cópia pedida agora e maior que a caixa é reduzida (não volta o original)", () => {
    const f = ler("supabase/functions/_shared/imagem-reduzida.ts");
    const i = f.indexOf("if (opcoes.pedirCopia && (await pedirCopiaLeve(bucket, caminho)))");
    const trecho = f.slice(i, f.indexOf("return { cabe: false", i));
    expect(trecho).toContain("reduzirParaCaber(copia, maxL, maxA, { qualidadeJpeg: opcoes.qualidadeJpeg, maxPixels: LADO_MEDIA * LADO_MEDIA })");
  });
});

describe("A3. copias-leves sem clone e com teto medido", () => {
  it("média direto do original e miniatura da média, sem clone(); teto 14 MP", () => {
    const f = ler("supabase/functions/copias-leves/index.ts");
    expect(f).not.toContain(".clone()");
    expect(f).toContain("const MAX_PIXELS = 14_000_000;");
    expect(f).toContain("const media = copiaMedia(img);");
    expect(f).toContain("reduzirPorAreaRapido(media, m.l, m.a)");
    expect(ler("supabase/functions/_shared/imagem-local.ts")).toContain("export function metadePorBloco(img: Image): Image {");
  });
});

describe("F. mapa do painel no agente de edição (só na conversa)", () => {
  it("agente_passo leva o mapa; visão e receita não", () => {
    const f = ler("supabase/functions/editor-video/index.ts");
    expect(f).toContain('const sistema = `${sistemaDoAgente()}\\n\\n${blocoDoMapaDoPainel("edicao")}`;');
    expect(f).toContain("const sistema = sistemaDaVisao();");
    expect(f).toContain("const sistema = sistemaDaReceita();");
    expect(f.match(/blocoDoMapaDoPainel\(/g)).toHaveLength(1);
  });
});
