import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { definirEscopoDoCrm, limitesDoPlano } from "@/lib/comercial/escopo";
import { rotuloDoEstagio } from "@/lib/comercial/estagios";
import { ETAPAS_DO_FUNIL, NICHOS, OBJETIVOS, lerPerfil, nomesDasEtapas, perfilDoNicho } from "@/lib/produto/nichos";
import { destinoDoObjetivo, pedidoDeConta } from "@/components/produto/OnboardingDoProduto";
import { enderecoDoAssistente, instrucoes } from "@/components/produto/ConexoesDaConta";
import { ErroDaApi, camposDoNegocio, etapaDe, negocioParaFora, type Operacoes } from "../../supabase/functions/produto-api/modulos/operacoes";
import { FERRAMENTAS, responderMcp } from "../../supabase/functions/produto-api/modulos/mcp";

/**
 * Produto CRM e E-mail, segunda parte (13/11/2026): o CRM por ramo, a chegada
 * antes do cadastro, a API da empresa e a porta para o Claude e o ChatGPT.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

afterEach(() => definirEscopoDoCrm(null));

describe("CRM por ramo", () => {
  it("a tela e o banco aceitam os mesmos ramos, objetivos e etapas", () => {
    const sql = ler("supabase/migrations/20261113120000_produto_crm_e_email.sql");
    expect(sql).toContain(`(${NICHOS.map((n) => `'${n.id}'`).join(", ")})`);
    expect(sql).toContain(`(${OBJETIVOS.map((o) => `'${o.id}'`).join(", ")})`);
    expect(sql).toContain(`(${ETAPAS_DO_FUNIL.map((e) => `'${e}'`).join(", ")})`);
  });

  it("o ramo dá ao funil os nomes dele, e o que não muda fica no padrão", () => {
    const imob = perfilDoNicho("imobiliaria", "prospectar");
    expect(imob).toMatchObject({ nicho: "imobiliaria", objetivo: "prospectar" });
    const nomes = nomesDasEtapas(imob);
    expect(nomes.diagnostico).toBe("Visita");
    expect(nomes.proposta).toBe("Proposta");
    expect(nomesDasEtapas(perfilDoNicho("agencia")).diagnostico).toBe("Diagnóstico");
    expect(perfilDoNicho("outro").etapas).toBeUndefined();
  });

  it("nome de etapa do ramo cabe no limite do banco (24 caracteres)", () => {
    NICHOS.forEach((n) => Object.keys(n.etapas).forEach((k) => expect(String(n.etapas[k as keyof typeof n.etapas]).length, `${n.id}.${k}`).toBeLessThanOrEqual(24)));
  });

  it("perfil malformado não entra", () => {
    expect(lerPerfil({ nicho: "pirataria", objetivo: "x", etapas: { novo: "a", lixo: "Nome", proposta: "  Orçamento  " } })).toEqual({ etapas: { proposta: "Orçamento" } });
    expect(lerPerfil(null)).toEqual({});
  });

  it("no CRM da empresa a etapa aparece com o nome dela; na casa, com o padrão", () => {
    expect(rotuloDoEstagio("diagnostico")).toBe("Diagnóstico");
    definirEscopoDoCrm({ modo: "conta", contaId: "c", base: "/app/crm", equipe: [], limites: limitesDoPlano({}), maquinaNoMes: 0, rotulos: { diagnostico: "Visita" } });
    expect(rotuloDoEstagio("diagnostico")).toBe("Visita");
    expect(rotuloDoEstagio("proposta")).toBe("Proposta");
    definirEscopoDoCrm(null);
    expect(rotuloDoEstagio("diagnostico")).toBe("Diagnóstico");
  });
});

describe("chegada antes do cadastro", () => {
  it("as respostas viram o pedido de criar a empresa, com o perfil do ramo", () => {
    const pedido = pedidoDeConta({ nicho: "saude", objetivo: "organizar", empresa: "  Clínica Vida ", usuarios: 3, plano: "pro", etapas: {} });
    expect(pedido).toMatchObject({ nome: "Clínica Vida", plano: "pro", usuarios: 3 });
    expect(pedido.perfil).toMatchObject({ nicho: "saude", objetivo: "organizar" });
    expect((pedido.perfil as { etapas: Record<string, string> }).etapas.diagnostico).toBe("Avaliação");
  });

  it("o nome de etapa que a pessoa trocou vence o do ramo", () => {
    const pedido = pedidoDeConta({ nicho: "saude", objetivo: "", empresa: "X Y", usuarios: 1, plano: "starter", etapas: { diagnostico: "Consulta" } });
    expect((pedido.perfil as { etapas: Record<string, string> }).etapas).toEqual({ diagnostico: "Consulta" });
  });

  it("o objetivo decide a primeira tela", () => {
    expect(destinoDoObjetivo("prospectar")).toBe("/app/crm/leads");
    expect(destinoDoObjetivo("organizar")).toBe("/app/crm/crm");
    expect(destinoDoObjetivo("")).toBe("/app");
  });

  it("a página de venda leva à chegada, e a chegada tem endereço próprio sem login", () => {
    expect(ler("src/pages/ProdutoLanding.tsx")).toContain('"/crm/comecar"');
    expect(ler("src/App.tsx")).toContain('<Route path="/crm/comecar" element={<ProdutoComecar />} />');
  });
});

describe("API da empresa", () => {
  it("a etapa entra pelo id, pelo nome padrão ou pelo nome que a empresa deu", () => {
    const proprias = { diagnostico: "Visita" };
    expect(etapaDe("proposta", proprias)).toBe("proposta");
    expect(etapaDe("Em contato", proprias)).toBe("contato");
    expect(etapaDe("visita", proprias)).toBe("diagnostico");
    expect(etapaDe("inexistente", proprias)).toBeNull();
    expect(etapaDe("", proprias)).toBeNull();
  });

  it("só o que foi enviado vira coluna, com os valores limpos", () => {
    expect(camposDoNegocio({ nome: "  Maria  ", valor_mensal: "1.500,50", email: "MARIA@EXEMPLO.COM" })).toEqual({ name: "Maria", monthly_value: 1500.5, email: "maria@exemplo.com" });
    expect(camposDoNegocio({ origem: "qualquer" })).toEqual({ origin: "site" });
    expect(camposDoNegocio({ previsao: "amanhã" })).toEqual({ expected_close_date: null });
    expect(camposDoNegocio({ conta_id: "outra", stage: "ganho", owner_id: "x" })).toEqual({});
  });

  it("o negócio sai com nomes em português e a etapa com o nome da empresa", () => {
    const fora = negocioParaFora({ id: "1", name: "Maria", company: "Sol", stage: "diagnostico", monthly_value: "300", one_off_value: null, origin: "site" }, { diagnostico: "Visita" });
    expect(fora).toMatchObject({ id: "1", nome: "Maria", empresa: "Sol", etapa: "diagnostico", etapa_nome: "Visita", valor_mensal: 300, valor_entrada: 0 });
  });

  it("cada leitura e escrita da API leva a empresa da chave", () => {
    const codigo = ler("supabase/functions/produto-api/modulos/operacoes.ts");
    const acessos = codigo.split("db.from(").slice(1);
    expect(acessos.length).toBeGreaterThan(12);
    acessos.forEach((trecho) => {
      const ate = trecho.slice(0, 420);
      expect(/ctx\.contaId/.test(ate), ate.slice(0, 90)).toBe(true);
    });
  });

  it("a chave é conferida pelo resumo, com limite de chamadas, e a função é pública só com chave", () => {
    const api = ler("supabase/functions/produto-api/index.ts");
    expect(api).toContain("produto_chave_usar");
    expect(api).toContain('crypto.subtle.digest("SHA-256"');
    expect(api).toContain("LIMITE_POR_MINUTO = 120");
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.produto-api\]\s+verify_jwt = false/);
    const sql = ler("supabase/migrations/20261113120000_produto_crm_e_email.sql");
    expect(sql).toContain("revoke all on function public.produto_chave_usar(text) from public, anon, authenticated;");
    expect(sql).toContain("grant select (id, conta_id, nome, prefixo, criado_por, criado_em, ultimo_uso_em, revogada_em) on public.produto_chaves_api to authenticated;");
  });
});

describe("porta para o Claude e o ChatGPT (MCP)", () => {
  const chamadas: Array<{ op: string; a: unknown }> = [];
  const falso = {
    eu: async () => ({ empresa: "Empresa A" }),
    resumoDoFunil: async () => ({ abertos: 3 }),
    listarNegocios: async (a: unknown) => {
      chamadas.push({ op: "listar", a });
      return { total: 0, negocios: [] };
    },
    atualizarNegocio: async () => {
      throw new ErroDaApi(400, "sem_motivo", "Para marcar como perdido, informe o motivo (campo motivo).");
    },
  } as unknown as Operacoes;

  it("apresenta o servidor e a versão do protocolo pedida", async () => {
    const r = (await responderMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, falso, "Empresa A")) as { result: { protocolVersion: string; serverInfo: { title: string }; capabilities: { tools: unknown } } };
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.serverInfo.title).toBe("CRM de Empresa A");
    expect(r.result.capabilities.tools).toBeTruthy();
  });

  it("lista as ferramentas com esquema fechado e marca o que só lê", async () => {
    const r = (await responderMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, falso, "E")) as { result: { tools: Array<{ name: string; inputSchema: { additionalProperties: boolean }; annotations: { readOnlyHint: boolean } }> } };
    expect(r.result.tools.map((t) => t.name)).toEqual(FERRAMENTAS.map((f) => f.name));
    expect(r.result.tools.length).toBe(11);
    r.result.tools.forEach((t) => expect(t.inputSchema.additionalProperties).toBe(false));
    const porNome = (n: string) => r.result.tools.filter((t) => t.name === n)[0];
    expect(porNome("crm_listar_negocios").annotations.readOnlyHint).toBe(true);
    expect(porNome("crm_criar_negocio").annotations.readOnlyHint).toBe(false);
  });

  it("chama a operação com os argumentos e devolve o resultado em texto e estruturado", async () => {
    const r = (await responderMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crm_listar_negocios", arguments: { etapa: "proposta" } } }, falso, "E")) as { result: { isError: boolean; structuredContent: unknown; content: Array<{ text: string }> } };
    expect(chamadas[chamadas.length - 1]).toEqual({ op: "listar", a: { etapa: "proposta" } });
    expect(r.result.isError).toBe(false);
    expect(JSON.parse(r.result.content[0].text)).toEqual({ total: 0, negocios: [] });
  });

  it("erro de regra volta como frase para o assistente se corrigir, não como falha do protocolo", async () => {
    const r = (await responderMcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "crm_atualizar_negocio", arguments: { id: "x", etapa: "perdido" } } }, falso, "E")) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("informe o motivo");
  });

  it("notificação não tem resposta; método e ferramenta desconhecidos têm erro", async () => {
    expect(await responderMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, falso, "E")).toBeNull();
    expect(await responderMcp({ jsonrpc: "2.0", id: 5, method: "resources/list" }, falso, "E")).toMatchObject({ error: { code: -32601 } });
    expect(await responderMcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "apagar_tudo" } }, falso, "E")).toMatchObject({ error: { code: -32602 } });
    expect(await responderMcp({ id: 7, method: "ping" } as never, falso, "E")).toMatchObject({ error: { code: -32600 } });
  });

  it("nenhuma ferramenta apaga dados", () => {
    expect(FERRAMENTAS.some((f) => /apagar|excluir|delete|remover/i.test(f.name))).toBe(false);
    expect(/\.delete\(/.test(ler("supabase/functions/produto-api/modulos/operacoes.ts"))).toBe(false);
  });
});

describe("tela de Conexões", () => {
  const API = "https://exemplo.supabase.co/functions/v1/produto-api";
  it("Claude e ChatGPT recebem o endereço da porta com a chave no fim", () => {
    expect(enderecoDoAssistente(API, "acq_abc")).toBe(`${API}/mcp/acq_abc`);
    expect(instrucoes("claude", API, "acq_abc").copiar[0].valor).toBe(`${API}/mcp/acq_abc`);
    expect(instrucoes("chatgpt", API, "").copiar[0].valor).toBe(`${API}/mcp/SUA_CHAVE`);
  });
  it("o site e a API usam a chave no cabeçalho, não no endereço", () => {
    const site = instrucoes("site", API, "acq_abc").copiar[0].valor;
    expect(site).toContain(`${API}/v1/negocios`);
    expect(site).toContain("Authorization: Bearer acq_abc");
    expect(site.indexOf("/acq_abc")).toBe(-1);
    expect(instrucoes("api", API, "acq_abc").copiar[0].valor).toBe(`${API}/v1`);
  });
});

describe("arquivos novos", () => {
  it("sem travessão e compatíveis com navegador antigo", () => {
    const travessao = String.fromCharCode(0x2014);
    [
      "src/lib/produto/nichos.ts", "src/lib/produto/aparencia.ts", "src/components/produto/OnboardingDoProduto.tsx", "src/components/produto/ConexoesDaConta.tsx",
      "src/components/produto/FunilDaConta.tsx", "src/components/produto/AparenciaDaConta.tsx", "src/pages/ProdutoComecar.tsx", "src/components/produto/produto.css",
      "supabase/functions/produto-api/index.ts", "supabase/functions/produto-api/modulos/operacoes.ts", "supabase/functions/produto-api/modulos/mcp.ts",
    ].forEach((arquivo) => {
      const texto = ler(arquivo);
      expect(texto.indexOf(travessao), `${arquivo}: travessão`).toBe(-1);
      if (arquivo.indexOf("src/") === 0 && /\.tsx?$/.test(arquivo)) {
        expect(/\(\?<[=!]/.test(texto), `${arquivo}: lookbehind`).toBe(false);
        expect(/\.at\(/.test(texto), `${arquivo}: .at()`).toBe(false);
      }
    });
  });

  it("o vidro tem saída para navegador sem desfoque", () => {
    const css = ler("src/components/produto/produto.css");
    expect(css).toContain("-webkit-backdrop-filter");
    expect(css).toContain("@supports not");
    expect(css).toContain("prefers-reduced-motion");
  });
});

describe("cobrança depois da revisão", () => {
  it("o pagamento vale pelo pedido do checkout pago, e pedido incompleto não vale", async () => {
    const { pedidoDoCheckout, comPedido } = await import("../../supabase/functions/produto/modulos/regras");
    const agora = new Date("2026-11-13T12:00:00Z");
    let pedidos = comPedido({}, "chk_barato", { plano_id: "starter", usuarios: 1, valor: 49.9 }, agora);
    pedidos = comPedido(pedidos, "chk_caro", { plano_id: "pro", usuarios: 10, valor: 799 }, new Date(agora.getTime() + 60000));
    expect(pedidoDoCheckout(pedidos, "chk_barato")).toEqual({ plano_id: "starter", usuarios: 1, valor: 49.9 });
    expect(pedidoDoCheckout(pedidos, "chk_caro")).toMatchObject({ plano_id: "pro", usuarios: 10 });
    expect(pedidoDoCheckout(pedidos, "outro")).toBeNull();
    expect(pedidoDoCheckout({ x: { plano_id: "pro", usuarios: 0 } }, "x")).toBeNull();
    expect(pedidoDoCheckout({ x: { plano_id: "PRO; drop", usuarios: 2 } }, "x")).toBeNull();
  });

  it("guarda só os oito pedidos mais novos", async () => {
    const { comPedido } = await import("../../supabase/functions/produto/modulos/regras");
    let pedidos: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) pedidos = comPedido(pedidos, `chk_${i}`, { plano_id: "starter", usuarios: 1, valor: 49.9 }, new Date(Date.UTC(2026, 10, 13, 12, i)));
    expect(Object.keys(pedidos)).toEqual(["chk_4", "chk_5", "chk_6", "chk_7", "chk_8", "chk_9", "chk_10", "chk_11"]);
  });

  it("reduzir espera a próxima cobrança; subir vale na hora", async () => {
    const { ehReducao } = await import("../../supabase/functions/produto/modulos/regras");
    expect(ehReducao(49.9, 149.7)).toBe(true);
    expect(ehReducao(199.6, 149.7)).toBe(false);
    expect(ehReducao(149.7, 149.7)).toBe(false);
  });

  it("cancelar em dia usa até o fim do período pago; em atraso, termina agora", async () => {
    const { fimDoAcessoAoCancelar } = await import("../../supabase/functions/produto/modulos/regras");
    const agora = new Date("2026-11-13T15:00:00Z");
    expect(fimDoAcessoAoCancelar({ estadoDaConta: "ativa", proximoVencimento: "2026-12-05", agora })).toBe("2026-12-05T23:59:59-03:00");
    expect(fimDoAcessoAoCancelar({ estadoDaConta: "atrasada", proximoVencimento: "2026-12-05", agora })).toBe(agora.toISOString());
    expect(fimDoAcessoAoCancelar({ estadoDaConta: "ativa", proximoVencimento: "2026-11-01", agora })).toBe(agora.toISOString());
  });

  it("o aviso do Asaas marca o evento antes de processar e confere o valor pago", () => {
    const w = ler("supabase/functions/produto-asaas-webhook/index.ts");
    expect(w.indexOf('from("produto_eventos").insert(')).toBeGreaterThan(-1);
    expect(w.indexOf('from("produto_eventos").insert(')).toBeLessThan(w.indexOf("await tratarPagamento("));
    expect(w).toContain("pagamento_divergente");
    expect(w).toContain('"assinatura_substituida"');
  });

  it("em cortesia a empresa não muda o próprio plano nem cancela", () => {
    const f = ler("supabase/functions/produto/index.ts");
    expect(f).toContain('throw new ErroHttp(409, "cortesia", "A empresa está em cortesia. Para mudar');
    expect(f).toContain('throw new ErroHttp(409, "cortesia", "A empresa está em cortesia: não há assinatura');
  });

  it("o MCP da casa e a tela da casa não veem as buscas das empresas", () => {
    const mcp = ler("supabase/functions/_shared/aceleriq-commercial-services.ts");
    expect((mcp.match(/from\('leads_buscas'\)\.select\([^)]*\)\.is\('conta_id', null\)/g) || []).length).toBe(2);
    expect(mcp).toContain(".eq('id', input.busca_id).is('conta_id', null)");
    expect(ler("supabase/migrations/20261113120000_produto_crm_e_email.sql")).toContain("using (conta_id is null and (public.has_role(auth.uid(), 'admin'::public.app_role)");
  });

  it("e-mail que não é e-mail não entra no filtro de repetido", () => {
    expect(camposDoNegocio({ email: "x,stage.neq.zzz" })).toEqual({ email: null });
    expect(camposDoNegocio({ email: "Maria@Exemplo.com" })).toEqual({ email: "maria@exemplo.com" });
  });
});
