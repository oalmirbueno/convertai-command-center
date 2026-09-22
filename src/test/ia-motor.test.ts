import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("texto usa 120 s e imagem usa 150 s", () => {
    expect(motor).toContain("export const TIMEOUT_TEXTO_MS = 120_000;");
    expect(motor).toContain("export const TIMEOUT_IMAGEM_MS = 150_000;");
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
    const cota = reserva.indexOf("garantirCota(direta.chave, estimativa);");
    const saldo = reserva.indexOf("await garantirSaldo(clientId, estimativa);");
    const chamada = reserva.indexOf("await despachar(direta.m, direta.chave.segredo)");
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
