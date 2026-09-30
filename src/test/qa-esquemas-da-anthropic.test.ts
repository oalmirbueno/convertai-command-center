import { describe, expect, it } from "vitest";
import { esquemaDosCampos, type CampoParaPreencher } from "../../supabase/functions/_shared/preencher-com-ia";
import { ESQUEMA_DA_ESTRATEGIA } from "../../supabase/functions/_shared/estrategia-de-marca";
import { ESQUEMA_DA_GERACAO } from "../../supabase/functions/_shared/proposta-modelo";
import { ESQUEMA_DAS_HEADLINES, ESQUEMA_DO_RESUMO, esquemaDoTom } from "../../supabase/functions/_shared/proposta-comercial";
import { ESQUEMA_DO_CONTEUDO } from "../../supabase/functions/_shared/site-metodo";
import { ESQUEMA_DO_BRAND, esquemaDosStoryboards } from "../../supabase/functions/_shared/motion-metodo";
import { ESQUEMA_DA_CENA } from "../../supabase/functions/_shared/cena-hf";
import { ESQUEMA_DA_CRITICA, ESQUEMA_DA_PROPOSTA, ESQUEMA_DA_REVISAO, ESQUEMA_DO_MODERADOR } from "../../supabase/functions/_shared/conselho";
import { ESQUEMA_DOS_TEXTOS } from "../../supabase/functions/_shared/registro-de-entrega";
import { ESQUEMA_DAS_OBSERVACOES } from "../../supabase/functions/_shared/referencias-do-site";
import { ESQUEMA_DA_LEITURA } from "../../supabase/functions/_shared/leitura-da-logo";

/**
 * QA 30/09: os esquemas das mesas novas vão à Anthropic (o padrão de proposta,
 * contrato, site, documento, identidade, naming e motion é o Opus 5.5 pelo
 * OpenRouter). A Anthropic recusa com 400:
 * - mais de 16 parâmetros com união (type em lista ou anyOf): visto no
 *   "Preencher tudo do site" (19 uniões);
 * - mais de 24 parâmetros opcionais;
 * - enum com type em lista;
 * - minimum, maximum, minLength, maxLength, multipleOf (sem suporte);
 * - objeto sem additionalProperties false.
 */

type Conta = { unioes: string[]; opcionais: string[]; problemas: string[] };

const SEM_SUPORTE = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern"];

function conferir(esquema: unknown): Conta {
  const conta: Conta = { unioes: [], opcionais: [], problemas: [] };
  const andar = (no: unknown, caminho: string) => {
    if (!no || typeof no !== "object") return;
    const o = no as Record<string, any>;
    if (Array.isArray(o.type) || Array.isArray(o.anyOf) || Array.isArray(o.oneOf)) conta.unioes.push(caminho);
    if (o.enum && Array.isArray(o.type)) conta.problemas.push(`${caminho}: enum com type em lista`);
    for (const k of SEM_SUPORTE) if (o[k] !== undefined) conta.problemas.push(`${caminho}: ${k}`);
    const tipos = Array.isArray(o.type) ? o.type : [o.type];
    if (tipos.indexOf("object") >= 0) {
      if (o.additionalProperties !== false) conta.problemas.push(`${caminho}: additionalProperties`);
      for (const k of Object.keys(o.properties || {})) {
        if ((o.required || []).indexOf(k) < 0) conta.opcionais.push(`${caminho}.${k}`);
        andar(o.properties[k], `${caminho}.${k}`);
      }
    }
    if (o.items) andar(o.items, `${caminho}[]`);
    for (const alt of (o.anyOf || []).concat(o.oneOf || [])) andar(alt, `${caminho}|`);
  };
  andar(esquema, "$");
  return conta;
}

const schemaDe = (e: unknown) => {
  const o = e as { schema?: unknown };
  return o && typeof o === "object" && o.schema ? o.schema : e;
};

function esperarQueAAnthropicAceite(nome: string, e: unknown) {
  const c = conferir(schemaDe(e));
  expect({ nome, problemas: c.problemas }).toEqual({ nome, problemas: [] });
  expect(c.unioes.length, `${nome}: ${c.unioes.join(", ")}`).toBeLessThanOrEqual(16);
  expect(c.opcionais.length, `${nome}: ${c.opcionais.join(", ")}`).toBeLessThanOrEqual(24);
}

describe("esquemas das mesas novas que a Anthropic aceita", () => {
  it("Preencher com IA com o máximo de campos (40, todos os tipos)", () => {
    const campos: CampoParaPreencher[] = [];
    for (let i = 0; i < 40; i++) {
      const tipo = (["texto", "texto_longo", "lista", "numero", "escolha", "objeto"] as const)[i % 6];
      campos.push({ chave: `k${i}`, rotulo: `Campo ${i}`, tipo, opcoes: tipo === "escolha" ? ["a", "b"] : undefined, valorAtual: tipo === "objeto" ? { a: "", b: [], c: 0 } : undefined });
    }
    esperarQueAAnthropicAceite("preencher-ia", esquemaDosCampos(campos));
    // O "Preencher tudo do site" que voltou 400 tinha 18 campos: agora nenhuma união.
    expect(conferir(esquemaDosCampos(campos).schema).unioes).toEqual([]);
  });

  it("estratégia de marca (Mesa Identidade): eixos sem minimum/maximum", () => {
    esperarQueAAnthropicAceite("ESQUEMA_DA_ESTRATEGIA", ESQUEMA_DA_ESTRATEGIA);
    const eixos = (ESQUEMA_DA_ESTRATEGIA.schema.properties as any).personalidade.properties.eixos.properties;
    Object.keys(eixos).forEach((k) => expect(eixos[k].enum).toEqual([-2, -1, 0, 1, 2]));
  });

  it("proposta, site, motion, conselho e documento", () => {
    esperarQueAAnthropicAceite("ESQUEMA_DA_GERACAO", ESQUEMA_DA_GERACAO);
    esperarQueAAnthropicAceite("ESQUEMA_DAS_HEADLINES", ESQUEMA_DAS_HEADLINES);
    esperarQueAAnthropicAceite("ESQUEMA_DO_RESUMO", ESQUEMA_DO_RESUMO);
    esperarQueAAnthropicAceite("esquemaDoTom", esquemaDoTom([{ chave: "capa.headline", tipo: "texto" }, { chave: "solucao.frentes", tipo: "lista" }]));
    esperarQueAAnthropicAceite("ESQUEMA_DO_CONTEUDO", ESQUEMA_DO_CONTEUDO);
    esperarQueAAnthropicAceite("ESQUEMA_DAS_OBSERVACOES", ESQUEMA_DAS_OBSERVACOES);
    esperarQueAAnthropicAceite("ESQUEMA_DO_BRAND", ESQUEMA_DO_BRAND);
    esperarQueAAnthropicAceite("storyboards apresentacao", esquemaDosStoryboards("apresentacao"));
    esperarQueAAnthropicAceite("storyboards filme_marca", esquemaDosStoryboards("filme_marca"));
    esperarQueAAnthropicAceite("ESQUEMA_DA_CENA", ESQUEMA_DA_CENA);
    esperarQueAAnthropicAceite("ESQUEMA_DA_PROPOSTA", ESQUEMA_DA_PROPOSTA);
    esperarQueAAnthropicAceite("ESQUEMA_DA_CRITICA", ESQUEMA_DA_CRITICA);
    esperarQueAAnthropicAceite("ESQUEMA_DA_REVISAO", ESQUEMA_DA_REVISAO);
    esperarQueAAnthropicAceite("ESQUEMA_DO_MODERADOR", ESQUEMA_DO_MODERADOR);
    esperarQueAAnthropicAceite("ESQUEMA_DOS_TEXTOS", ESQUEMA_DOS_TEXTOS);
    // Completar marca existente (Mesa Identidade, 30/09): leitura da logo.
    esperarQueAAnthropicAceite("ESQUEMA_DA_LEITURA", ESQUEMA_DA_LEITURA);
  });
});

describe("teto de saída com folga para o raciocínio da Anthropic", () => {
  it("modelo da Anthropic (direto ou pelo OpenRouter) ganha folga; os outros ficam no teto pedido", async () => {
    const { tetoDeSaidaNoProvedor, ehModeloDaAnthropic, FOLGA_DO_RACIOCINIO_ANTHROPIC } = await import("../../supabase/functions/_shared/teto-de-saida");
    const opusOr = { provedor: "openrouter", modelo_api: "anthropic/claude-opus-5.5" } as const;
    const opusDireto = { provedor: "anthropic", modelo_api: "claude-opus-5-5" } as const;
    const luna = { provedor: "openrouter", modelo_api: "openai/gpt-6-luna" } as const;
    expect(ehModeloDaAnthropic(opusOr)).toBe(true);
    expect(ehModeloDaAnthropic({ provedor: "openrouter", modelo_api: "~anthropic/claude-haiku-latest" })).toBe(true);
    expect(ehModeloDaAnthropic(luna)).toBe(false);
    // As headlines da proposta pedem 800: sem folga, o pensamento do Opus 5.5 cortaria o JSON.
    expect(tetoDeSaidaNoProvedor(opusOr, 800)).toBe(800 + FOLGA_DO_RACIOCINIO_ANTHROPIC);
    expect(tetoDeSaidaNoProvedor(opusDireto, 60_000)).toBe(64_000);
    expect(tetoDeSaidaNoProvedor(luna, 800)).toBe(800);
    // Com esforço pedido (naming, estratégia), qualquer provedor ganha a folga: o raciocínio sai do mesmo teto.
    expect(tetoDeSaidaNoProvedor(luna, 3_500, "medium")).toBe(3_500 + FOLGA_DO_RACIOCINIO_ANTHROPIC);
    expect(tetoDeSaidaNoProvedor(opusOr, undefined)).toBeUndefined();
  });
});

describe("editor: render com a máquina da agência desligada", () => {
  it("diz na hora que a máquina está desligada (nunca ligada ou desligada), sem esperar 2 minutos", async () => {
    const { rotuloDoPedido } = await import("@/lib/editor/render");
    const agora = Date.parse("2026-09-30T03:00:00Z");
    const pedido = { id: "p1", tipo: "final", estado: "fila", criado_em: "2026-09-30T02:59:50Z" } as any;
    expect(rotuloDoPedido(pedido, agora, { visto_em: null, situacao: "nunca" })).toBe("Na fila: a máquina da agência está desligada");
    expect(rotuloDoPedido(pedido, agora, { visto_em: "2026-09-29T10:00:00Z", situacao: "desligado" })).toBe("Na fila: a máquina da agência está desligada");
    expect(rotuloDoPedido(pedido, agora, { visto_em: "2026-09-30T02:59:59Z", situacao: "ligado" })).not.toContain("desligada");
  });
});

describe("contratos: marcas de lembrete e de vencimento pela trilha", () => {
  it("não grava lembrete_em nem aviso_vencimento_em em contrato enviado ou assinado (a guarda do banco recusa) e lê a última vez da trilha", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const ciclo = readFileSync(resolve(__dirname, "../../supabase/functions/contratos/ciclo.ts"), "utf8");
    // A guarda contracts_secure_guard só deixa o service_role mudar sent_at e updated_at em contrato enviado.
    expect(ciclo).not.toMatch(/update\(\{\s*lembrete_em/);
    expect(ciclo).not.toMatch(/update\(\{\s*aviso_vencimento_em/);
    expect(ciclo).toContain('ultimosEventos([l.id], "lembrete_copiado")');
    expect(ciclo).toContain('"lembrete_copiado");');
    expect(ciclo).toContain('ultimosEventos(linhas.filter((l) => l.status === "completed").map((l) => l.id), "aviso_vencimento")');
    expect(ciclo).toContain("!jaAvisados[l.id]");
  });
});

describe("seletor de modelo: só o que o servidor aceita", () => {
  it("modelosAtivos tira o modelo que o provedor tirou (disponivel=false); o id lembrado fora da lista volta ao padrão", async () => {
    const { modelosAtivos } = await import("@/lib/mesa/api");
    const base = { provedor: "openrouter", modelo_api: "x", rotulo: null, preco_entrada_1m: 1, preco_saida_1m: 1, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: null } as const;
    const catalogo = [
      { ...base, id: "a", tipo: "texto" as const, ativo: true, disponivel: true },
      { ...base, id: "b", tipo: "texto" as const, ativo: true, disponivel: false },
      { ...base, id: "c", tipo: "texto" as const, ativo: false },
      { ...base, id: "d", tipo: "texto" as const, ativo: true },
    ];
    expect(modelosAtivos(catalogo, "texto").map((m) => m.id)).toEqual(["a", "d"]);
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const comuns = readFileSync(resolve(__dirname, "../components/mesa-identidade/Comuns.tsx"), "utf8");
    expect(comuns).toContain('!modelosAtivos(catalogo, "texto").some((m) => m.id === id) ? "" : id');
  });
});

describe("QA 30/09: pontos corrigidos nas funções (conferidos no código)", () => {
  const ler = async (rel: string) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    return readFileSync(resolve(__dirname, "../..", rel), "utf8");
  };

  it("documento: o estimar confere os dados da agência antes do Confirmar e a mensagem não repete a frase", async () => {
    const f = await ler("supabase/functions/documentos/index.ts");
    const estimar = f.slice(f.indexOf("async function estimar("), f.indexOf("async function estimar(") + 600);
    expect(estimar).toContain("await dadosDaAgencia();");
    expect(f).not.toContain("${e.message} Preencha em Configurações, Dados da agência.");
  });

  it("Mesa Site: zip reaproveita o pedido aberto e diz se o motor está desligado; preset sem Jev não vira 500", async () => {
    const f = await ler("supabase/functions/mesa-site/index.ts");
    const zip = f.slice(f.indexOf("async function zipPedir("), f.indexOf("async function zipPedir(") + 1500);
    expect(zip).toContain('t.tipo === "zip" && ehAberto(t.estado)');
    expect(zip).toContain("ja_na_fila: true");
    expect(zip).toContain("motor_ligado");
    const estrutura = await ler("supabase/functions/mesa-site/estrutura.ts");
    const preset = estrutura.slice(estrutura.indexOf("async function presetSugerir("), estrutura.indexOf("async function presetSugerir(") + 900);
    expect(preset).toContain("catch (e)");
    expect(preset).toContain("preset: null");
  });

  it("Mesa Site: com o motor desligado a tela diz que o pedido espera na fila e não relê de 4 em 4 s", async () => {
    const api = await ler("src/components/mesa-site/siteApi.ts");
    expect(api).toContain("d && d.vivo && d.trabalhos.some((t) => ABERTOS.indexOf(t.estado) >= 0) ? 4000 : 30_000");
    expect(api).toContain("refetchInterval: aberto && vivo ? 2500 : false");
    expect(await ler("src/components/mesa-site/EtapaIntegracoes.tsx")).toContain("Motor desligado: a montagem espera na fila");
    expect(await ler("src/components/mesa-site/EtapaRevisao.tsx")).toContain("Na fila: motor desligado");
  });

  it("Mesa Proposta: o Aplicar da prévia leva perguntas e conferência do evento da prévia (nada vem da tela)", async () => {
    const f = await ler("supabase/functions/mesa-proposta/index.ts");
    expect(f).toContain("perguntas: r.perguntas, conferencia: tocouMercado ? conferencia : null");
    expect(f).toContain("corpo.aplicar_previa === true");
    expect(f).toContain('.eq("tipo", "preenchida")');
    const tela = await ler("src/components/mesa-proposta/EtapaRascunho.tsx");
    expect(tela).toContain("aplicar_previa: true, chaves_aplicadas: chaves");
    expect(tela).toContain("Notas da reunião:");
  });

  it("Mesa Identidade: paletas, fontes e slogans releem o projeto antes de gravar", async () => {
    const f = await ler("supabase/functions/mesa-identidade/estrategia-acoes.ts");
    expect((f.match(/const fresco = await lerProjeto\(ch, p\.id\);/g) || []).length).toBe(3);
  });

  it("selo: SVG ou WebP sem cópia leve dá mensagem de formato, não 'grande demais'", async () => {
    const f = await ler("supabase/functions/agente-calendario/selo-da-campanha.ts");
    expect(f).toContain('"formato_nao_suportado"');
  });

  it("editor: o agente não promete prazo com a máquina da agência desligada", async () => {
    const f = await ler("src/components/mesa-edicao/editor/AgenteEditor.tsx");
    expect(f).toContain('maquinaDesligadaRef.current = !!filaDeRender.worker && filaDeRender.worker.situacao !== "ligado"');
  });
});
