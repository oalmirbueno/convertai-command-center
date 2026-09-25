import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capacidadesDaListaDeImagens,
  capacidadesDoModelo,
  lerResolucao,
  limiteDeReferencias,
  precoDasEntradas,
  precoImagemDoEndpoint,
  precoPorImagem,
  precosDoEndpoint,
  proporcaoEntre,
  qualidadeParaModelo,
  referenciasNoLimite,
  resolucaoParaModelo,
} from "../../supabase/functions/_shared/capacidades-imagem";

// Contrato do motor de modelos da Mesa do cliente (SPEC.md, secao 3).
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const motor = ler("supabase/functions/_shared/ia-motor.ts");
const jev = ler("supabase/functions/_shared/jev.ts");
const gateway = ler("supabase/functions/ia-gateway/index.ts");
const config = ler("supabase/config.toml");

/** Corpo de uma funcao exportada, do cabecalho ate a proxima funcao de topo. */
function corpoDe(fonte: string, nome: string): string {
  const ini = fonte.indexOf(`export async function ${nome}(`);
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = fonte.slice(ini + 10);
  const fim = resto.search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}/);
  return fim < 0 ? resto : resto.slice(0, fim);
}

describe("motor de modelos: toda chamada externa tem tempo limite", () => {
  it("existe um unico fetch no motor e ele leva AbortSignal.timeout", () => {
    const fetches = motor.match(/\bfetch\(/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(motor).toContain("await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });");
  });

  it("texto usa 120 s e imagem usa 280 s (panorama do contínuo)", () => {
    expect(motor).toContain("export const TIMEOUT_TEXTO_MS = 120_000;");
    expect(motor).toContain("export const TIMEOUT_IMAGEM_MS = 280_000;");
    for (const url of ["https://api.openai.com/v1/responses", "https://api.anthropic.com/v1/messages"]) {
      const trecho = motor.slice(motor.indexOf(url), motor.indexOf(url) + 400);
      expect(trecho).toContain("TIMEOUT_TEXTO_MS");
    }
    for (const url of ["https://api.openai.com/v1/images/generations", "https://api.openai.com/v1/images/edits"]) {
      const trecho = motor.slice(motor.indexOf(url), motor.indexOf(url) + 400);
      expect(trecho).toContain("TIMEOUT_IMAGEM_MS");
    }
  });

  it("o gateway e o Jev nao fazem fetch sem tempo limite", () => {
    expect(gateway).not.toMatch(/\bfetch\(/);
    expect(jev).toContain("signal: AbortSignal.timeout(opcoes.timeoutMs ?? JEV_TIMEOUT_MS)");
    expect(jev).toContain("export const JEV_TIMEOUT_MS = 20_000;");
  });
});

describe("motor de modelos: carteira antes, registro depois", () => {
  for (const nome of ["chamarTexto", "chamarImagem"]) {
    it(`${nome} confere saldo antes do provedor e registra o uso depois`, () => {
      const corpo = corpoDe(motor, nome);
      const chave = corpo.indexOf("await resolverRota(e.clientId, pedido)");
      const cota = corpo.indexOf("garantirCota(rota.chave, estimativa);");
      const saldo = corpo.indexOf("await garantirSaldo(");
      const chamada = corpo.indexOf("await comReservaOpenRouter(e.clientId, rota, estimativaPara,");
      const registro = corpo.indexOf("await registrarUso(");
      // Um registro so por chamada, no modelo que atendeu: sem cobranca dupla.
      expect(corpo.match(/registrarUso\(/g) ?? []).toHaveLength(1);
      expect(chave).toBeGreaterThan(-1);
      expect(cota).toBeGreaterThan(chave);
      expect(saldo).toBeGreaterThan(cota);
      expect(chamada).toBeGreaterThan(saldo);
      expect(registro).toBeGreaterThan(chamada);
      // A chave vai junto para o registro (chave_origem e chave_id).
      expect(corpo.slice(registro)).toMatch(/\n\s+chave,\n/);
      // Nenhuma chamada paga pula a resolucao da chave por cliente.
      expect(corpo).not.toContain("chaveDoProvedor(");
    });
  }

  it("saldo insuficiente e erro com o valor que falta", () => {
    expect(motor).toContain("if (saldo < estimativaUsd) {");
    expect(motor).toContain('new IaMotorErro("saldo_insuficiente"');
    expect(motor).toContain("falta_usd: falta,");
  });

  it("o registro vai pela RPC ia_registrar_uso com os parametros do contrato", () => {
    expect(motor).toContain('.rpc("ia_registrar_uso", params)');
    for (const p of [
      "_client_id", "_tarefa", "_agente", "_modelo_id", "_provedor", "_tokens_entrada", "_tokens_saida",
      "_tokens_cache", "_imagens", "_qualidade", "_custo_usd", "_custo_fonte", "_referencia_tipo",
      "_referencia_id", "_criado_por", "_chave_origem", "_chave_id",
    ]) {
      expect(motor).toContain(`${p}:`);
    }
  });

  it("custo do provedor quando informado, senao a tabela do catalogo", () => {
    expect(motor).toContain('const custoFonte: "provedor" | "tabela" = r.custoProvedor != null ? "provedor" : "tabela";');
    expect(motor).toContain("typeof u.cost === \"number\"");
    expect(motor).toContain('.from("ia_modelos")');
    expect(motor).toContain("m.preco_imagem?.[u.qualidade");
  });
});

describe("motor de modelos: chave por cliente e cota (SPEC 2.1)", () => {
  const resolver = corpoDe(motor, "resolverChave");

  it("primeiro a chave do cliente pela RPC backend; senao a da agencia se permitido; senao bloqueia", () => {
    expect(resolver).toContain('servicoDb.rpc("ia_chave_resolver", { _client_id: clientId, _provedor: provedor })');
    expect(resolver).toContain('origem: "cliente"');
    expect(resolver).toContain('.from("ia_clientes_config")');
    expect(resolver).toContain("?.usar_chave_agencia !== false;");
    expect(resolver).toContain('throw new IaMotorErro("cliente_sem_chave"');
    expect(resolver).toContain('return { segredo: chaveDoProvedor(provedor), origem: "agencia", chaveId: null');
    expect(resolver.indexOf("ia_chave_resolver")).toBeLessThan(resolver.indexOf("chaveDoProvedor(provedor)"));
  });

  it("cota do mes da chave do cliente cobre a estimativa, senao cota_da_chave_esgotada", () => {
    expect(motor).toContain('if (chave.origem !== "cliente" || chave.cotaMensalUsd == null) return;');
    expect(motor).toContain("if (chave.gastoMesUsd + estimativaUsd > chave.cotaMensalUsd) {");
    expect(motor).toContain('throw new IaMotorErro("cota_da_chave_esgotada"');
  });

  it("o segredo nunca vai para log nem para a resposta de erro", () => {
    const logs = [...motor.matchAll(/console\.\w+\(([^;]*)\);/g)].map((m) => m[1]);
    for (const linha of logs) expect(linha).not.toMatch(/segredo|chave\b/i);
    const detalhes = [...motor.matchAll(/new IaMotorErro\([^;]*\);/g)].map((m) => m[0]);
    for (const d of detalhes) expect(d).not.toMatch(/segredo/);
  });
});

describe("motor de modelos: chaves e privacidade", () => {
  it("provedor sem chave responde provedor_sem_chave", () => {
    expect(motor).toContain('openai: "OPENAI_API_KEY"');
    expect(motor).toContain('anthropic: "ANTHROPIC_API_KEY"');
    expect(motor).toContain('openrouter: "OPENROUTER_API_KEY"');
    expect(motor).toContain('throw new IaMotorErro("provedor_sem_chave"');
  });

  it("nenhum log leva chave, cabecalho de autorizacao ou prompt", () => {
    const logs = [...motor.matchAll(/console\.\w+\(([^;]*)\);/g), ...gateway.matchAll(/console\.\w+\(([^;]*)\);/g), ...jev.matchAll(/console\.\w+\(([^;]*)\);/g)].map((m) => m[1]);
    for (const linha of logs) {
      expect(linha).not.toMatch(/chave|API_KEY|Authorization|prompt|sistema|mensagens|conteudo|state/i);
    }
    expect(motor).not.toMatch(/console\.(log|info|debug)\(/);
    expect(gateway).not.toMatch(/console\.(log|info|debug)\(/);
  });

  it("usa as APIs certas de cada provedor", () => {
    expect(motor).toContain('corpo.tools = [{ type: "web_search" }];');
    expect(motor).toContain("corpo.reasoning = { effort: e.raciocinio };");
    expect(motor).toContain('corpo.text = { format: { type: "json_schema", name: nome, schema, strict: true } };');
    expect(motor).toContain('form.append("image[]"');
    expect(motor).toContain('modalities: ["image", "text"]');
    expect(motor).toContain('"anthropic-version": "2023-06-01"');
  });
});

describe("Jev: ajudante unico", () => {
  it("chama o System One com jev-latest e a chave do ambiente", () => {
    expect(jev).toContain('export const JEV_URL = "https://api.typesafe.ai/v1/systemone";');
    expect(jev).toContain('export const JEV_MODELO = "jev-latest";');
    expect(jev).toContain('Deno.env.get("TYPESAFE_API_KEY")');
    expect(jev).toContain("export async function jevPerguntar(");
  });

  it("Score exige criteria como lista ordenada; Noul devolve noul", () => {
    expect(jev).toContain("criteria: string[];");
    expect(jev).toContain("!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10");
    expect(jev).toContain("noul?: number;");
    expect(jev).toContain("score?: number;");
  });
});

describe("ia-gateway: porta da equipe", () => {
  it("exige JWT no gateway e fica declarada no config", () => {
    expect(config).toMatch(/\[functions\.ia-gateway\]\s+verify_jwt\s*=\s*true/);
  });

  it("equipe via is_staff; cron via x-cron-secret", () => {
    expect(gateway).toContain('servico.rpc("is_staff", { _user_id: userId })');
    expect(gateway).toContain('req.headers.get("x-cron-secret")?.trim() === cronSecret');
    expect(gateway).toContain('if (chamador.tipo === "cron" && !ACOES_DO_CRON.includes(acao)) return json({ error: "nao_autorizado" }, 403);');
  });

  it("recarga usa o JWT de quem chamou para a regra de admin ou manager valer", () => {
    expect(gateway).toContain("global: { headers: { Authorization: `Bearer ${token}` } }");
    expect(gateway).toContain('await doChamador.rpc("ia_carteira_recarregar"');
    expect(gateway).not.toContain('servico.rpc("ia_carteira_recarregar"');
    expect(gateway).toContain('await doChamador.rpc("ia_consumo_cliente"');
  });

  it("chaves e cotas do cliente passam as RPCs com o JWT de quem chamou", () => {
    for (const [acao, rpc] of [
      ["chaves_listar", "ia_chaves_listar"],
      ["chave_salvar", "ia_chave_salvar"],
      ["chave_cota", "ia_chave_cota"],
      ["chave_desativar", "ia_chave_desativar"],
      ["cliente_config_salvar", "ia_cliente_config_salvar"],
    ]) {
      expect(gateway).toContain(`if (acao === "${acao}")`);
      expect(gateway).toContain(`await doChamador.rpc("${rpc}"`);
      expect(gateway).not.toContain(`servico.rpc("${rpc}"`);
    }
    // O segredo entra so em chave_salvar e nunca volta na resposta.
    const ini = gateway.indexOf('if (acao === "chave_salvar")');
    const trecho = gateway.slice(ini, gateway.indexOf('if (acao === "chave_cota")'));
    expect(trecho).toContain("_chave: segredo,");
    expect(trecho).not.toMatch(/json\(\{[^}]*segredo/);
  });

  it("modelos_do_provedor e so de admin ou do cron", () => {
    const ini = gateway.indexOf('if (acao === "modelos_do_provedor")');
    const trecho = gateway.slice(ini, ini + 300);
    expect(trecho).toContain('if (chamador.tipo === "usuario" && !chamador.admin) return json({ error: "somente_admin" }, 403);');
    expect(gateway).toContain('servico.rpc("has_role", { _user_id: userId, _role: "admin" })');
  });
});

describe("rota de reserva: OpenRouter sem chave cai no equivalente direto", () => {
  const rota = corpoDe(motor, "resolverRota");

  const direta = corpoDe(motor, "rotaDireta");

  it("tenta primeiro o modelo pedido e so cai quando falta chave", () => {
    expect(rota.indexOf("resolverChave(clientId, pedido.provedor)")).toBeLessThan(rota.indexOf("rotaDireta(clientId, pedido)"));
    expect(rota).toContain('err.codigo === "provedor_sem_chave" || err.codigo === "cliente_sem_chave"');
    // Sem equivalente, ou equivalente sem chave: sobe o erro do modelo pedido.
    expect(rota).toContain("if (!direta) throw err;");
    expect(rota).toContain('return { ...direta, reserva: "openrouter_sem_chave" };');
    expect(direta).toContain("const eq = equivalenteDireto(pedido);");
    expect(direta).toContain('.neq("disponivel", false)');
    expect(direta).toContain('.eq("tipo", pedido.tipo)');
  });

  it("so OpenAI e Anthropic tem equivalente; a Anthropic troca ponto por hifen", () => {
    expect(motor).toContain('if (dono === "openai") return { provedor: "openai", modeloApi: nome };');
    expect(motor).toContain('if (dono === "anthropic") return { provedor: "anthropic", modeloApi: nome.replace(/\\./g, "-") };');
    expect(motor).toContain('if (m.provedor !== "openrouter") return null;');
  });

  it("chamarTexto e chamarImagem passam pela rota; modelo sumido do provedor nao e chamado", () => {
    for (const nome of ["chamarTexto", "chamarImagem"]) {
      expect(corpoDe(motor, nome)).toContain("const rota = await resolverRota(e.clientId, pedido);");
      expect(corpoDe(motor, nome)).toContain("if (reserva) saida.reservaUsada = reserva;");
    }
    expect(motor).toContain('throw new IaMotorErro("modelo_indisponivel"');
  });
});

describe("catalogo que se atualiza sozinho", () => {
  const sincronia = ler("supabase/migrations/20260922123000_ia_modelos_sincronizacao.sql");
  const catalogo = ler("supabase/migrations/20260922124000_ia_modelos_catalogo_inicial.sql");

  it("a lista publica do OpenRouter vira preco por 1M, sem batch, free, roteador ou audio", () => {
    expect(motor).toContain('export const OPENROUTER_MODELOS_URL = "https://openrouter.ai/api/v1/models";');
    expect(motor).toContain('if (!slug || slug.includes(":") || slug.startsWith("openrouter/")) return null;');
    expect(motor).toContain('if (saida.includes("audio")) return null;');
    expect(motor).toContain('const tipo: TipoModelo | null = saida.includes("image") ? "imagem"');
    expect(motor).toContain("return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000;");
    expect(motor).toContain("const saidaImagem = por1m(p.image_output);");
    expect(motor).toContain("id: `openrouter:${slug}`,");
  });

  it("a acao sincronizar_catalogo e so de admin ou do cron e grava pela RPC backend", () => {
    const ini = gateway.indexOf('if (acao === "sincronizar_catalogo")');
    const trecho = gateway.slice(ini, gateway.indexOf('if (acao === "modelos_do_provedor")'));
    expect(trecho).toContain('if (chamador.tipo === "usuario" && !chamador.admin) return json({ error: "somente_admin" }, 403);');
    expect(trecho).toContain('servico.rpc("ia_modelos_sincronizar"');
    expect(trecho).toContain("_completo: linhas.length >= MINIMO_LISTA_COMPLETA.openrouter,");
    expect(gateway).toContain('const ACOES_DO_CRON = ["modelos_do_provedor", "sincronizar_catalogo"];');
  });

  it("modelo novo entra desligado e marcado; nunca mexe no que o dono ligou; sumido vira indisponivel", () => {
    expect(sincronia).toContain("ADD COLUMN IF NOT EXISTS novo boolean NOT NULL DEFAULT true");
    expect(sincronia).toContain("ADD COLUMN IF NOT EXISTS disponivel boolean NOT NULL DEFAULT true");
    expect(sincronia).toContain("COALESCE(e.raciocinio, '{}'::text[]), '{}'::text[], false, true, true,");
    const conflito = sincronia.slice(sincronia.indexOf("ON CONFLICT (id) DO UPDATE SET"), sincronia.indexOf("RETURNING (xmax = 0)"));
    expect(conflito).not.toMatch(/\bativo\s*=/);
    expect(conflito).not.toMatch(/\bpadrao_para\s*=/);
    expect(conflito).not.toMatch(/\bnovo\s*=/);
    expect(sincronia).toContain("SET disponivel = false, sincronizado_em = now()");
    expect(sincronia).not.toMatch(/DELETE FROM public\.ia_modelos/i);
    expect(sincronia).toContain("IF NOT app_private.rpc_trusted_backend() THEN");
    expect(sincronia).toContain("GRANT EXECUTE ON FUNCTION public.ia_modelos_sincronizar(text, jsonb, boolean) TO service_role;");
    expect(sincronia).toContain("FROM PUBLIC, anon, authenticated;");
  });

  it("roda todo dia as 06:17 de Brasilia pelo cron com os segredos do cofre", () => {
    expect(sincronia).toContain("cron.schedule('ia-catalogo-sincronizar-diario', '17 9 * * *'");
    expect(sincronia).toContain("body := jsonb_build_object('acao', 'sincronizar_catalogo')");
    expect(sincronia).toContain("where name = 'cron_secret'");
  });

  it("papeis padrao: GPT-6 Sol pelo OpenRouter, leitura no GPT-6 Luna, imagem no GPT Image 2.5 direto", () => {
    expect(catalogo).toContain("'openrouter:openai/gpt-6-sol', 'openrouter', 'openai/gpt-6-sol'");
    expect(catalogo).toMatch(/'openrouter:openai\/gpt-6-sol'[\s\S]*?ARRAY\['estrategista', 'diretor_arte'\]/);
    expect(catalogo).toMatch(/'openrouter:openai\/gpt-6-luna'[\s\S]*?ARRAY\['leitura'\]/);
    expect(catalogo).toMatch(/'openai:gpt-image-2\.5-sunburst'[\s\S]*?ARRAY\['imagem'\]/);
    // Equivalentes diretos com preco para a rota de reserva.
    expect(catalogo).toContain("'openai:gpt-6-sol', 'openai', 'gpt-6-sol'");
    expect(catalogo).toContain("'openai:gpt-6-luna', 'openai', 'gpt-6-luna'");
    expect(catalogo).toContain("'anthropic:claude-opus-5-5', 'anthropic', 'claude-opus-5-5'");
  });
});

describe("reserva por credito: OpenRouter 402 ou 401 cai no direto na mesma chamada", () => {
  const reserva = motor.slice(motor.indexOf("async function comReservaOpenRouter<R>("), motor.indexOf("// ---------------------------------------------------------------- utilidades"));

  it("so 402 e 401 do OpenRouter disparam a reserva", () => {
    expect(motor).toContain('if (m.provedor !== "openrouter" || !(err instanceof IaMotorErro) || err.codigo !== "provedor_erro") return false;');
    expect(motor).toContain("return status === 402 || status === 401;");
    expect(reserva).toContain("if (!ehOpenRouterSemCredito(err, rota.m)) throw err;");
  });

  it("confere cota e saldo do modelo direto antes de tentar e avisa a tela", () => {
    const direta = reserva.indexOf("const direta = await rotaDireta(clientId, rota.m);");
    // Busca a partir da rota direta: antes dela vem o caminho inverso (conta direta
    // sem crédito vai pelo OpenRouter), que também confere cota e saldo.
    const cota = reserva.indexOf("garantirCota(direta.chave, estimativa);", direta);
    const saldo = reserva.indexOf("await garantirSaldo(clientId, estimativa);", direta);
    const chamada = reserva.indexOf("await despachar(direta.m, direta.chave.segredo)", direta);
    expect(direta).toBeGreaterThan(-1);
    expect(cota).toBeGreaterThan(direta);
    expect(saldo).toBeGreaterThan(cota);
    expect(chamada).toBeGreaterThan(saldo);
    expect(reserva).toContain('reserva: "openrouter_sem_credito" };');
  });

  it("sem equivalente direto: erro openrouter_sem_credito 402 pedindo recarga", () => {
    expect(reserva).toContain("if (!direta) throw erroOpenRouterSemCredito(err as IaMotorErro, rota.m);");
    expect(motor).toContain("openrouter_sem_credito: 402,");
    expect(motor).toContain("Recarregue em https://openrouter.ai/settings/credits");
  });

  it("a reserva nunca registra uso: o registro fica para depois do sucesso", () => {
    expect(reserva).not.toContain("registrarUso(");
    expect(reserva).not.toContain("ia_registrar_uso");
  });
});

// ---------------------------------------------------------------------------
// Modelos só de imagem pela API de imagens, resolução e capacidades
// (docs/mesa-foto/MODELOS-E-CANVAS.md, seção 8.1).
// ---------------------------------------------------------------------------

const capsFonte = ler("supabase/functions/_shared/capacidades-imagem.ts");
const or = (modelo_api: string, extra: Record<string, unknown> = {}) => ({ provedor: "openrouter", modelo_api, ...extra });

describe("capacidades: limite de referências e API por família", () => {
  it("limites conferidos na lista pública do OpenRouter", () => {
    expect(limiteDeReferencias(or("openai/gpt-image-2.5-sunburst"))).toBe(16);
    expect(limiteDeReferencias({ provedor: "openai", modelo_api: "gpt-image-2.5-sunburst" })).toBe(16);
    expect(limiteDeReferencias(or("google/gemini-3-pro-image"))).toBe(14);
    expect(limiteDeReferencias(or("bytedance-seed/seedream-5-0-pro"))).toBe(14);
    expect(limiteDeReferencias(or("sourceful/riverflow-v2.5-pro"))).toBe(10);
    expect(limiteDeReferencias(or("black-forest-labs/flux.2-max"))).toBe(8);
    expect(limiteDeReferencias(or("microsoft/mai-image-2.6"))).toBe(5);
    expect(limiteDeReferencias(or("qwen/qwen-image-3-pro"))).toBe(4);
    expect(limiteDeReferencias(or("x-ai/grok-imagine-image-2.0"))).toBe(3);
    expect(limiteDeReferencias(or("krea/krea-2-large"))).toBe(1);
  });

  it("a coluna capacidades do catálogo manda sobre a família", () => {
    expect(limiteDeReferencias(or("microsoft/mai-image-2.6", { capacidades: { refs_max: 2 } }))).toBe(2);
    expect(capacidadesDoModelo(or("bytedance-seed/seedream-4.5", { capacidades: { resolucoes: ["1K"] } })).resolucoes).toEqual(["1K"]);
  });

  it("GPT Image e modelos só de imagem vão pela API de imagens; Gemini segue no chat", () => {
    expect(capacidadesDoModelo(or("openai/gpt-image-2.5-sunburst")).api).toBe("imagens");
    expect(capacidadesDoModelo(or("bytedance-seed/seedream-5-0-pro")).api).toBe("imagens");
    expect(capacidadesDoModelo(or("microsoft/mai-image-2.6")).api).toBe("imagens");
    expect(capacidadesDoModelo(or("google/gemini-3-pro-image")).api).toBe("chat");
    // Desconhecido: só imagem na saída vai pela API de imagens; com texto, chat (como antes).
    expect(capacidadesDoModelo(or("novo/gerador", { modalidades: { saida: ["image"] } })).api).toBe("imagens");
    expect(capacidadesDoModelo(or("novo/gerador", { modalidades: { saida: ["image", "text"] } })).api).toBe("chat");
    expect(capacidadesDoModelo(or("novo/gerador")).api).toBe("chat");
    // GPT Image nunca sai da API de imagens, nem com coluna errada.
    expect(capacidadesDoModelo(or("openai/gpt-image-2.5-flare", { capacidades: { api: "chat" } })).api).toBe("imagens");
  });
});

describe("capacidades: resolução, proporção, qualidade e referências", () => {
  it("resolução só vai quando o modelo aceita; senão a mais perto abaixo, com aviso", () => {
    const pro = capacidadesDoModelo(or("google/gemini-3-pro-image-preview"));
    expect(resolucaoParaModelo(pro, "4K")).toEqual({ resolucao: "4K", aviso: null });
    expect(resolucaoParaModelo(pro, null)).toEqual({ resolucao: null, aviso: null });
    // 26/09/2026: o OpenRouter recusa 4K no gemini-3-pro-image normal; mesmo com o catálogo dizendo 4K, vai 2K.
    const normal = capacidadesDoModelo({ ...or("google/gemini-3-pro-image"), capacidades: { resolucoes: ["1K", "2K", "4K"] } });
    expect(normal.resolucoes).toEqual(["1K", "2K"]);
    expect(resolucaoParaModelo(normal, "4K").resolucao).toBe("2K");
    expect(capacidadesDoModelo(or("google/gemini-3.1-flash-image")).resolucoes).not.toContain("4K");
    expect(capacidadesDoModelo(or("google/gemini-3.1-flash-image-preview")).resolucoes).toContain("4K");
    // A sincronização também não marca 4K nos normais (a lista pública ainda diz 4K).
    const lista = { id: "google/gemini-3-pro-image", architecture: { output_modalities: ["image", "text"] }, supported_parameters: { resolution: { values: ["1K", "2K", "4K"] } } };
    expect(capacidadesDaListaDeImagens(lista, null).resolucoes).toEqual(["1K", "2K"]);
    expect(capacidadesDaListaDeImagens({ ...lista, id: "google/gemini-3-pro-image-preview" }, null).resolucoes).toEqual(["1K", "2K", "4K"]);
    const seed5 = capacidadesDoModelo(or("bytedance-seed/seedream-5-0-pro"));
    const r = resolucaoParaModelo(seed5, "4K");
    expect(r.resolucao).toBe("2K");
    expect(r.aviso).toMatch(/não gera em 4K/);
    const mai = capacidadesDoModelo(or("microsoft/mai-image-2.6"));
    expect(resolucaoParaModelo(mai, "2K").resolucao).toBeNull();
    expect(resolucaoParaModelo(mai, "2K").aviso).toMatch(/não escolhe resolução/);
    expect(lerResolucao("2k")).toBe("2K");
    expect(lerResolucao("8K")).toBeNull();
  });

  it("proporção: a aceita mais perto do tamanho pedido (MAI não tem 4:5, vai 3:4)", () => {
    expect(proporcaoEntre("1088x1360", capacidadesDoModelo(or("bytedance-seed/seedream-5-0-pro")).proporcoes)).toBe("4:5");
    expect(proporcaoEntre("1088x1360", capacidadesDoModelo(or("microsoft/mai-image-2.6")).proporcoes)).toBe("3:4");
    expect(proporcaoEntre("1024x1024", ["1:1", "16:9"])).toBe("1:1");
  });

  it("qualidade no vocabulário do modelo; sem qualidade, nada", () => {
    expect(qualidadeParaModelo(capacidadesDoModelo(or("x-ai/grok-imagine-image-2.0")), "alta")).toBe("medium");
    expect(qualidadeParaModelo(capacidadesDoModelo(or("bytedance-seed/seedream-5-0-pro")), "alta")).toBeNull();
    expect(qualidadeParaModelo(capacidadesDoModelo(or("openai/gpt-image-2.5-sunburst")), "baixa")).toBe("low");
  });

  it("referências cortadas no limite, em ordem, com aviso", () => {
    const r = referenciasNoLimite("editada", ["a", "b", "c", "d", "e"], 3);
    expect(r.imagens).toEqual(["editada", "a", "b"]);
    expect(r.cortadas).toBe(3);
    expect(r.aviso).toMatch(/no máximo 3/);
    expect(referenciasNoLimite(null, ["a"], 5)).toEqual({ imagens: ["a"], cortadas: 0, aviso: null });
  });
});

describe("catálogo de imagens: preço por imagem, por megapixel e por token", () => {
  // Trechos reais de https://openrouter.ai/api/v1/images/models/.../endpoints (2026-09-24).
  const seedream5 = {
    id: "bytedance-seed/seedream-5-0-pro",
    architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] },
    supported_parameters: {
      resolution: { type: "enum", values: ["1K", "2K"] },
      aspect_ratio: { type: "enum", values: ["1:1", "4:5", "auto"] },
      input_references: { type: "range", min: 0, max: 14 },
      seed: { type: "boolean" },
    },
  };
  const endpointSeedream5 = {
    pricing: [
      { billable: "output_image", unit: "image", cost_usd: 0.045 },
      { billable: "output_image", unit: "image", cost_usd: 0.09, variant: "high_resolution" },
      { billable: "input_image", unit: "image", cost_usd: 0.003 },
    ],
  };
  const riverflow = {
    id: "sourceful/riverflow-v2.5-pro",
    architecture: { output_modalities: ["image"] },
    supported_parameters: { resolution: { type: "enum", values: ["1K", "2K", "4K"] }, background: { type: "enum", values: ["auto", "transparent", "opaque"] }, input_references: { type: "range", min: 0, max: 10 } },
  };
  const endpointRiverflow = {
    pricing: [
      { billable: "output_image", unit: "image", cost_usd: 0.13 },
      { billable: "output_image", unit: "image", cost_usd: 0.15, variant: "2k" },
      { billable: "output_image", unit: "image", cost_usd: 0.17, variant: "4k" },
    ],
  };

  it("capacidades vêm dos parâmetros aceitos (referências, resolução, semente, fundo)", () => {
    const caps = capacidadesDaListaDeImagens(seedream5, null);
    expect(caps).toMatchObject({ api: "imagens", refs_max: 14, resolucoes: ["1K", "2K"], seed: true, fundo_transparente: false });
    expect(caps.proporcoes).not.toContain("auto");
    expect(capacidadesDaListaDeImagens(riverflow, null).fundo_transparente).toBe(true);
    expect(capacidadesDaListaDeImagens({ id: "google/gemini-3-pro-image", architecture: { output_modalities: ["image", "text"] } }, null).api).toBe("chat");
  });

  it("por imagem: variante de alta resolução e 2k/4k viram res_<R>; entrada por imagem", () => {
    const caps = capacidadesDaListaDeImagens(seedream5, null);
    const p = precoImagemDoEndpoint(seedream5.id, caps, precosDoEndpoint(endpointSeedream5));
    expect(p.preco_imagem).toMatchObject({ res_1K: 0.045, res_2K: 0.09, media: 0.045, entrada_por_imagem: 0.003 });
    const r = precoImagemDoEndpoint(riverflow.id, capacidadesDaListaDeImagens(riverflow, null), precosDoEndpoint(endpointRiverflow));
    expect(r.preco_imagem).toMatchObject({ res_1K: 0.13, res_2K: 0.15, res_4K: 0.17, alta: 0.13 });
  });

  it("por megapixel (FLUX.2) e por token (MAI e Gemini) com os tokens por resolução", () => {
    const flux = precoImagemDoEndpoint("black-forest-labs/flux.2-pro", { resolucoes: [] }, precosDoEndpoint({ pricing: [{ billable: "output_image", unit: "megapixel", cost_usd: 0.03 }] }));
    expect(flux.preco_imagem?.por_megapixel).toBe(0.03);
    const pro = precoImagemDoEndpoint("google/gemini-3-pro-image", { resolucoes: ["1K", "2K", "4K"] }, precosDoEndpoint({ pricing: [{ billable: "output_image", unit: "token", cost_usd: 0.00012 }] }));
    // Oficial do Google: US$ 0,134 em 1K e 2K, US$ 0,24 em 4K.
    expect(pro.preco_imagem).toMatchObject({ res_1K: 0.1344, res_2K: 0.1344, res_4K: 0.24, saida_imagem_1m: 120 });
    const mai = precoImagemDoEndpoint("microsoft/mai-image-2.6", { resolucoes: [] }, precosDoEndpoint({ pricing: [{ billable: "output_image", unit: "token", cost_usd: 0.000038 }, { billable: "input_text", unit: "token", cost_usd: 0.000005 }] }));
    expect(mai.preco_imagem?.media).toBeCloseTo(0.0418, 4);
    expect(mai.preco_entrada_1m).toBe(5);
    expect(mai.preco_saida_1m).toBe(38);
    expect(precoImagemDoEndpoint("krea/krea-2-large", { resolucoes: ["1K"] }, []).preco_imagem).toBeNull();
  });

  it("preço de uma imagem na resolução pedida; sem resolução, o preço por qualidade de antes", () => {
    const seed = { modelo_api: "bytedance-seed/seedream-5-0-pro", preco_imagem: { res_1K: 0.045, res_2K: 0.09, baixa: 0.045, media: 0.045, alta: 0.045, entrada_por_imagem: 0.003 } };
    expect(precoPorImagem(seed, "alta", "2K")).toBe(0.09);
    expect(precoPorImagem(seed, "media", null)).toBe(0.045);
    expect(precoDasEntradas(seed, 4)).toBe(0.012);
    const gpt = { modelo_api: "openai/gpt-image-2.5-sunburst", preco_imagem: { baixa: 0.02, media: 0.06, alta: 0.21 } };
    expect(precoPorImagem(gpt, "alta", null)).toBe(0.21);
    const flux = { modelo_api: "black-forest-labs/flux.2-pro", preco_imagem: { por_megapixel: 0.03, media: 0.0315 } };
    expect(precoPorImagem(flux, "media", null, "1088x1360")).toBeCloseTo(0.0444, 3);
    const pro = { modelo_api: "google/gemini-3-pro-image", preco_imagem: { media: 0.1548, saida_imagem_1m: 120 } };
    expect(precoPorImagem(pro, "media", "4K")).toBe(0.24);
  });
});

describe("motor: API de imagens do OpenRouter para modelos só de imagem", () => {
  const imagens = motor.slice(motor.indexOf("async function imagemOpenRouterImages("), motor.indexOf("function mimePelosBytes("));
  const chat = motor.slice(motor.indexOf("async function imagemOpenRouter("), motor.indexOf("export async function chamarImagem("));

  it("rota: GPT Image ou capacidades.api imagens vão por POST /api/v1/images", () => {
    expect(motor).toContain('(m.provedor === "openrouter" && capacidadesDoModelo(m).api === "imagens")');
    expect(chat).toContain("if (usaApiDeImagensDoOpenRouter(m)) return await imagemOpenRouterImages(m, chave, e);");
  });

  it("GPT Image segue igual (size, quality, png); os outros recebem só o que aceitam", () => {
    expect(imagens).toContain("corpo.size = tamanho;");
    expect(imagens).toContain('corpo.quality = QUALIDADE_OPENAI[e.qualidade] ?? "medium";');
    expect(imagens).toContain("corpo.aspect_ratio = proporcaoEntre(tamanho, caps.proporcoes);");
    expect(imagens).toContain("if (r.resolucao) corpo.resolution = r.resolucao;");
    expect(imagens).toContain('if (caps.seed && typeof e.seed === "number" && Number.isFinite(e.seed)) corpo.seed = Math.floor(e.seed);');
    expect(imagens).toContain("referenciasNoLimite(");
    // Sem size para quem não é GPT Image (o provedor recusaria).
    expect(imagens.indexOf("corpo.size = tamanho;")).toBeLessThan(imagens.indexOf("} else {"));
  });

  it("Gemini pelo chat: corpo de antes, com image_size só quando pedido e aceito", () => {
    expect(chat).toContain("if (r.resolucao) imageConfig.image_size = r.resolucao;");
    expect(chat).toContain("const imageConfig: Record<string, unknown> = { aspect_ratio: proporcao(e.tamanho || TAMANHO_2X3) };");
    expect(chat).toContain('modalities: ["image", "text"]');
  });

  it("a estimativa e o custo pela tabela usam a resolução e as referências que de fato vão", () => {
    const chamar = corpoDe(motor, "chamarImagem");
    expect(chamar).toContain("resolucao: e.resolucao ? resolucaoParaModelo(capacidadesDoModelo(mod), e.resolucao).resolucao : null,");
    expect(chamar).toContain("imagensEntrada: r.referenciasEnviadas ?? qtdImagensEntrada,");
    expect(chamar).toContain("if (r.avisos?.length) saida.avisos = r.avisos;");
    expect(motor).toContain("const entradasPorImagem = precoDasEntradas(m, num(u.imagensEntrada));");
  });

  it("fundo transparente: GPT Image e modelo só de imagem que aceita (Riverflow)", () => {
    expect(motor).toContain('return caps.api === "imagens" && caps.fundo_transparente === true;');
  });

  it("sincronização: lista de imagens + endpoints, GPT Image fica à mão, Gemini ganha capacidades", () => {
    expect(capsFonte).toContain('export const OPENROUTER_IMAGENS_URL = "https://openrouter.ai/api/v1/images/models";');
    expect(motor).toContain("export function converterModeloDeImagemOpenRouter(");
    expect(motor).toContain(String.raw`/^openai\/gpt-image/.test(slug)) return null;`);
    expect(motor).toContain("porId.set(img.id, noChat ? juntarCapacidades(noChat, img) : img);");
    expect(motor).toContain("capacidades: null,");
    // Lista de imagens que falha duas vezes derruba a sincronização (sem marcar modelos como indisponíveis).
    expect(motor).toContain("const comUmaNovaTentativa = async <T>(fn: () => Promise<T>): Promise<T> => {");
  });
});
