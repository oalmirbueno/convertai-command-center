// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  CAMPO_ISCA,
  chaveDaPergunta,
  criarLimite,
  ehRobo,
  lerCampos,
  lerFormularioPublico,
  lerOrigemDaCaptacao,
  lerPerguntas,
  montarLink,
  origemDaUrl,
  UTM_DA_META,
  validarEnvio,
} from "../../supabase/functions/_shared/captacao-do-crm";
import {
  corpoDoEnvio,
  enderecoDosEventos,
  lerRespostaDaMeta,
  montarEventoDaMeta,
  montarFbc,
  normalizarEmail,
  normalizarNome,
  normalizarTelefone,
  semSegredo,
  sha256Hex,
  type ConversaoDaFila,
} from "../../supabase/functions/_shared/conversoes-da-meta";

/**
 * Captação e rastreamento do CRM da empresa (13/11/2026): as funções puras que
 * a página pública, a tela e as funções do servidor compartilham.
 */

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");

describe("origem do clique lida do endereço", () => {
  it("lê utm, fbclid e gclid, e guarda a página sem a busca", () => {
    const o = origemDaUrl("https://app.exemplo.com/f/abc?utm_source=Instagram&utm_medium=paid_social&utm_campaign=Black%20Friday&utm_content=video+1&utm_term=cons%C3%B3rcio&fbclid=IwAR0abcdefghij&gclid=Cj0KCQabcdefgh&outra=1#topo", { agora: 1763000000000, referencia: "https://l.instagram.com/?u=x" });
    expect(o).toEqual({
      utm_source: "Instagram",
      utm_medium: "paid_social",
      utm_campaign: "Black Friday",
      utm_content: "video 1",
      utm_term: "consórcio",
      fbclid: "IwAR0abcdefghij",
      gclid: "Cj0KCQabcdefgh",
      pagina: "https://app.exemplo.com/f/abc",
      referencia: "https://l.instagram.com/",
      clicado_em: "1763000000000",
    });
  });

  it("sem parâmetros, sobra só a página; o instante do clique só entra com fbclid", () => {
    expect(origemDaUrl("https://app.exemplo.com/f/abc", { agora: 1763000000000 })).toEqual({ pagina: "https://app.exemplo.com/f/abc" });
  });

  it("macro que a Meta não trocou, marcação e id malformado ficam de fora", () => {
    const o = origemDaUrl("https://x.com/f/a?utm_campaign={{campaign.id}}&utm_source=%3Cscript%3E&fbclid=curto&gclid=a%20b&utm_medium=cpc");
    expect(o).toEqual({ utm_medium: "cpc", pagina: "https://x.com/f/a" });
  });

  it("id de anúncio e de campanha da Meta saem das UTMs quando são só dígitos", () => {
    const o = origemDaUrl("https://x.com/f/a?utm_source=meta&utm_campaign=120210000000001&utm_content=120210000000002");
    expect(o.campaign_id).toBe("120210000000001");
    expect(o.ad_id).toBe("120210000000002");
  });

  it("o servidor relê a origem com a mesma régua e ignora chave estranha", () => {
    const o = lerOrigemDaCaptacao({ utm_source: "google", conta_id: "x", pagina: "javascript:alert(1)", referencia: "https://g.co/a?q=segredo", fbp: "fb.1.1763000000000.123456789", clicado_em: "ontem", gclid: "Cj0KCQabcdefgh" });
    expect(o).toEqual({ utm_source: "google", gclid: "Cj0KCQabcdefgh", fbp: "fb.1.1763000000000.123456789", referencia: "https://g.co/a" });
  });

  it("parâmetro mal codificado não derruba a leitura", () => {
    expect(() => origemDaUrl("https://x.com/f/a?utm_source=%E0%A4%A&gclid=%E0%A4%A")).not.toThrow();
  });
});

describe("link do formulário", () => {
  it("monta o link simples e o link com UTM", () => {
    expect(montarLink("https://app.exemplo.com/", "abc123")).toBe("https://app.exemplo.com/f/abc123");
    expect(montarLink("https://app.exemplo.com", "abc123", { utm_source: "instagram", utm_medium: "bio", utm_campaign: "Black Friday" })).toBe("https://app.exemplo.com/f/abc123?utm_source=instagram&utm_medium=bio&utm_campaign=Black%20Friday");
  });

  it("as macros da Meta ficam inteiras para a Meta trocar no clique", () => {
    const link = montarLink("https://app.exemplo.com", "abc123", UTM_DA_META);
    expect(link).toBe("https://app.exemplo.com/f/abc123?utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}");
  });

  it("o link montado volta inteiro pela leitura da origem", () => {
    const o = origemDaUrl(montarLink("https://app.exemplo.com", "abc123", { utm_source: "tiktok", utm_campaign: "verão & sol" }));
    expect(o.utm_source).toBe("tiktok");
    expect(o.utm_campaign).toBe("verão & sol");
  });
});

describe("campos e perguntas do formulário", () => {
  it("campos sempre com as quatro chaves e um valor aceito", () => {
    expect(lerCampos({ whatsapp: "opcional", email: "xx", mensagem: "obrigatorio" })).toEqual({ whatsapp: "opcional", email: "opcional", empresa: "nao", mensagem: "obrigatorio" });
    expect(lerCampos(null)).toEqual({ whatsapp: "obrigatorio", email: "opcional", empresa: "nao", mensagem: "nao" });
  });

  it("perguntas: no máximo 3, sem chave repetida ou malformada", () => {
    const p = lerPerguntas([
      { chave: "cidade", rotulo: "Qual a sua cidade?", obrigatoria: true },
      { chave: "Cidade!", rotulo: "Ruim" },
      { chave: "cidade", rotulo: "Repetida" },
      { chave: "valor", rotulo: "Valor" },
      { chave: "prazo", rotulo: "Prazo" },
      { chave: "extra", rotulo: "Sobra" },
    ]);
    expect(p.map((x) => x.chave)).toEqual(["cidade", "valor", "prazo"]);
    expect(p[0].obrigatoria).toBe(true);
    expect(p[1].obrigatoria).toBe(false);
  });

  it("a chave da pergunta sai do texto, sem acento e sem começar por número", () => {
    expect(chaveDaPergunta("Qual a sua cidade?")).toBe("qual_a_sua_cidade");
    expect(chaveDaPergunta("  Orçamento (R$)  ")).toBe("orcamento_r");
    expect(chaveDaPergunta("2 quartos ou 3?")).toBe("quartos_ou_3");
    expect(chaveDaPergunta("?")).toBe("");
    expect(chaveDaPergunta("a".repeat(80)).length).toBe(40);
  });

  it("a página só aceita formulário bem formado, com logo e pixel conferidos", () => {
    const f = lerFormularioPublico({ ok: true, formulario: { titulo: "Simule", campos: {}, perguntas: [] }, empresa: { nome: "Empresa H", cor: "azul", logo: "https://fora.com/logo.png" }, pixel: "abc" });
    expect(f && f.titulo).toBe("Simule");
    expect(f && f.empresa.logo).toBeNull();
    expect(f && f.pixel).toBeNull();
    expect(f && f.texto_botao).toBe("Enviar");
    expect(lerFormularioPublico({ ok: false, motivo: "desligado" })).toBeNull();
    const g = lerFormularioPublico({ ok: true, formulario: { titulo: "T" }, empresa: { logo: "data:image/png;base64,AAAA" }, pixel: "123456789012345" });
    expect(g && g.pixel).toBe("123456789012345");
    expect(g && g.empresa.logo).toBe("data:image/png;base64,AAAA");
  });
});

describe("validação do envio", () => {
  const formulario = {
    campos: { whatsapp: "obrigatorio", email: "opcional", empresa: "nao", mensagem: "opcional" } as const,
    perguntas: [{ chave: "cidade", rotulo: "Qual a sua cidade?", obrigatoria: true }, { chave: "valor", rotulo: "Valor", obrigatoria: false }],
  };

  it("aceita o envio bom, limpa espaços e põe o e-mail em minúsculas", () => {
    const r = validarEnvio(formulario, { nome: "  Maria   Souza ", whatsapp: "(47) 99999-1111", email: " Maria@Exemplo.COM ", mensagem: "Olá\n\n\n\nquero   saber", respostas: { cidade: " Brusque " }, origem: { utm_source: "instagram" } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados).toEqual({ nome: "Maria Souza", whatsapp: "(47) 99999-1111", email: "maria@exemplo.com", empresa: null, mensagem: "Olá\n\nquero saber", respostas: { cidade: "Brusque" }, origem: { utm_source: "instagram" } });
    }
  });

  it("nada do corpo escolhe empresa, etapa ou responsável", () => {
    const r = validarEnvio(formulario, { nome: "Zé da Silva", whatsapp: "47999991111", respostas: { cidade: "Itajaí", intruso: "x" }, conta_id: "outra", etapa: "ganho", owner_id: "alguem", empresa: "Campo desligado" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.dados).sort()).toEqual(["email", "empresa", "mensagem", "nome", "origem", "respostas", "whatsapp"]);
      expect(r.dados.empresa).toBeNull();
      expect(r.dados.respostas).toEqual({ cidade: "Itajaí" });
    }
  });

  it("recusa o que falta e diz qual campo", () => {
    const campoDe = (corpo: unknown) => {
      const r = validarEnvio(formulario, corpo);
      return r.ok === false ? r.campo : "";
    };
    expect(campoDe({ nome: "A" })).toBe("nome");
    expect(campoDe({ nome: "Maria" })).toBe("whatsapp");
    expect(campoDe({ nome: "Maria", whatsapp: "12345" })).toBe("whatsapp");
    expect(campoDe({ nome: "Maria", whatsapp: "47999991111", email: "sem-arroba" })).toBe("email");
    expect(campoDe({ nome: "Maria", whatsapp: "47999991111" })).toBe("cidade");
    expect(campoDe(null)).toBe("nome");
    expect(campoDe("texto")).toBe("nome");
  });

  it("corta tamanhos para o teto de cada campo", () => {
    const r = validarEnvio(formulario, { nome: "N".repeat(500), whatsapp: "47999991111", mensagem: "m".repeat(9000), respostas: { cidade: "c".repeat(900) } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados.nome.length).toBe(120);
      expect((r.dados.mensagem || "").length).toBe(2000);
      expect(r.dados.respostas.cidade.length).toBe(300);
    }
  });

  it("campo isca preenchido é robô", () => {
    expect(ehRobo({ nome: "Maria", [CAMPO_ISCA]: "http://spam.example" })).toBe(true);
    expect(ehRobo({ nome: "Maria", [CAMPO_ISCA]: "  " })).toBe(false);
    expect(ehRobo(null)).toBe(false);
  });

  it("limite de envios por janela de tempo", () => {
    const limite = criarLimite(3, 60_000);
    const t = 1_000_000;
    expect([limite("ip", t), limite("ip", t + 1), limite("ip", t + 2), limite("ip", t + 3)]).toEqual([true, true, true, false]);
    expect(limite("outro", t)).toBe(true);
    expect(limite("ip", t + 60_001)).toBe(true);
  });
});

describe("normalizar e fazer hash (API de Conversões da Meta)", () => {
  it("e-mail: sem espaço e em minúsculas, como no exemplo da documentação", async () => {
    expect(normalizarEmail("  John_Smith@gmail.com ")).toBe("john_smith@gmail.com");
    expect(normalizarEmail("sem-arroba")).toBe("");
    expect(await sha256Hex(normalizarEmail("  John_Smith@gmail.com "))).toBe(createHash("sha256").update("john_smith@gmail.com").digest("hex"));
  });

  it("telefone: só dígitos, sem zero à esquerda, com o código do país", async () => {
    expect(normalizarTelefone("(47) 99999-1111")).toBe("5547999991111");
    expect(normalizarTelefone("047 3333-4444")).toBe("554733334444");
    expect(normalizarTelefone("+55 47 99999-1111")).toBe("5547999991111");
    expect(normalizarTelefone("(650)555-1212", "1")).toBe("16505551212");
    expect(normalizarTelefone("123")).toBe("");
    expect(await sha256Hex("16505551212")).toBe(createHash("sha256").update("16505551212").digest("hex"));
  });

  it("hash conhecido", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("nome e sobrenome em minúsculas, sem pontuação", () => {
    expect(normalizarNome("  Maria  de Souza. ")).toEqual({ primeiro: "maria", ultimo: "souza" });
    expect(normalizarNome("João")).toEqual({ primeiro: "joão", ultimo: "" });
  });

  it("fbc a partir do fbclid e do instante do clique", () => {
    expect(montarFbc("IwAR0abcdefghij", "1763000000000")).toBe("fb.1.1763000000000.IwAR0abcdefghij");
    expect(montarFbc("curto", 1763000000000)).toBe("");
    expect(montarFbc("IwAR0abcdefghij", "ontem")).toBe("");
  });

  const base: ConversaoDaFila = {
    id: "11111111-1111-1111-1111-111111111111",
    conta_id: "c",
    lead_id: "22222222-2222-2222-2222-222222222222",
    evento: "Lead",
    valor: 0,
    dados: { fbclid: "IwAR0abcdefghij", clicado_em: "1763000000000", pagina: "https://app.exemplo.com/f/abc", fbp: "fb.1.1763000000000.123456789", ip: "203.0.113.9", navegador: "Mozilla/5.0", formulario: "Anúncio" },
    tentativas: 0,
    criado_em: "2026-11-13T12:00:00.000Z",
    nome: "Maria Souza",
    email: " Maria@Exemplo.com ",
    whatsapp: "(47) 99999-1111",
  };
  const agora = new Date("2026-11-13T12:05:00.000Z").getTime();

  it("Lead de formulário: evento de site, com hash, fbc, página e o mesmo id da fila", async () => {
    const e = (await montarEventoDaMeta(base, agora)) as any;
    expect(e.event_name).toBe("Lead");
    expect(e.event_id).toBe(base.id);
    expect(e.event_time).toBe(Math.floor(new Date(base.criado_em).getTime() / 1000));
    expect(e.action_source).toBe("website");
    expect(e.event_source_url).toBe("https://app.exemplo.com/f/abc");
    expect(e.user_data.em).toEqual([await sha256Hex("maria@exemplo.com")]);
    expect(e.user_data.ph).toEqual([await sha256Hex("5547999991111")]);
    expect(e.user_data.fn).toEqual([await sha256Hex("maria")]);
    expect(e.user_data.ln).toEqual([await sha256Hex("souza")]);
    expect(e.user_data.fbc).toBe("fb.1.1763000000000.IwAR0abcdefghij");
    expect(e.user_data.fbp).toBe("fb.1.1763000000000.123456789");
    expect(e.user_data.client_ip_address).toBe("203.0.113.9");
    expect(e.user_data.client_user_agent).toBe("Mozilla/5.0");
    // Nada em texto puro: e-mail, telefone e nome só saem com hash.
    const texto = JSON.stringify(e);
    expect(texto).not.toMatch(/maria@|99999|Souza/i);
  });

  it("Purchase: evento do sistema, com valor em reais e sem IP nem navegador", async () => {
    const e = (await montarEventoDaMeta({ ...base, evento: "Purchase", valor: "8000.00" }, agora)) as any;
    expect(e.event_name).toBe("Purchase");
    expect(e.action_source).toBe("system_generated");
    expect(e.custom_data.currency).toBe("BRL");
    expect(e.custom_data.value).toBe(8000);
    expect(e.user_data.client_ip_address).toBeUndefined();
    expect(e.user_data.client_user_agent).toBeUndefined();
    expect(e.event_source_url).toBeUndefined();
    expect(e.user_data.fbc).toBe("fb.1.1763000000000.IwAR0abcdefghij");
  });

  it("sem e-mail, telefone e clique, o evento sai só com o que existe", async () => {
    const e = (await montarEventoDaMeta({ ...base, email: null, whatsapp: null, nome: null, dados: {} }, agora)) as any;
    expect(Object.keys(e.user_data)).toEqual(["external_id"]);
    expect(e.action_source).toBe("system_generated");
  });

  it("o token vai no corpo, nunca no endereço", () => {
    const corpo = corpoDoEnvio([{ event_name: "Lead" }], "EAABsegredo", "TEST123") as any;
    expect(corpo.access_token).toBe("EAABsegredo");
    expect(corpo.test_event_code).toBe("TEST123");
    expect(corpoDoEnvio([], "t", null)).toEqual({ data: [], access_token: "t" });
    expect(enderecoDosEventos("123456789012345")).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d\/123456789012345\/events$/);
    expect(enderecoDosEventos("123456789012345", "v25.0")).toBe("https://graph.facebook.com/v25.0/123456789012345/events");
    expect(() => enderecoDosEventos("abc")).toThrow();
  });

  it("resposta da Meta: enviado, tentar de novo ou erro que precisa de gente", () => {
    expect(lerRespostaDaMeta(200, { events_received: 1, fbtrace_id: "x" })).toEqual({ ok: true, definitivo: false, erro: "" });
    expect(lerRespostaDaMeta(400, { error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } }).definitivo).toBe(true);
    expect(lerRespostaDaMeta(400, { error: { message: "Invalid parameter", code: 100 } })).toEqual({ ok: false, definitivo: true, erro: "Invalid parameter" });
    expect(lerRespostaDaMeta(500, null).definitivo).toBe(false);
    expect(lerRespostaDaMeta(429, null).definitivo).toBe(false);
    expect(lerRespostaDaMeta(400, { error: { message: "limite", code: 80004 } }).definitivo).toBe(false);
    expect(lerRespostaDaMeta(200, { events_received: 0 }).ok).toBe(false);
  });

  it("mensagem de erro nunca carrega o token", () => {
    const token = "EAAB" + "x".repeat(40);
    const r = lerRespostaDaMeta(400, { error: { message: `Bad token ${token} em access_token=${token}`, code: 100 } }, token);
    expect(r.erro).not.toContain(token);
    expect(semSegredo(`falhou com EAAGabcdefghijklmnopqrstuvwxyz0123`)).not.toContain("EAAGabcdefghijklmnopqrstuvwxyz0123");
  });
});

describe("contratos dos arquivos", () => {
  const migration = ler("supabase/migrations/20261113210000_crm_captacao_e_rastreamento.sql");

  it("a migration não dá nada a anon e as funções de serviço não ficam com quem está logado", () => {
    expect(migration).not.toMatch(/grant[^;]*to[^;]*\banon\b/i);
    for (const f of ["crm_captar(text, jsonb, jsonb)", "crm_formulario_publico(text)", "crm_rastreamento_token(uuid)", "crm_conversoes_pegar(integer)", "crm_conversao_resultado(uuid, boolean, text, boolean)"]) {
      expect(migration).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(migration).toContain(`grant execute on function public.${f} to service_role;`);
    }
    const definers = migration.split(/create or replace function/).slice(1);
    expect(definers.length).toBeGreaterThan(12);
    for (const d of definers) expect(d.split("as $$")[0]).toContain("set search_path = ''");
  });

  it("o recebimento público não lê conta_id do corpo e o roteamento do index é mínimo", () => {
    const modulo = ler("supabase/functions/produto-api/modulos/captacao.ts");
    expect(modulo).not.toMatch(/conta_id/);
    expect(modulo).toContain("crm_captar");
    expect(modulo).toContain("ehRobo(corpo)");
    const index = ler("supabase/functions/produto-api/index.ts");
    expect(index).toContain('if (partes[0] === "captar")');
  });

  it("o envio para a Meta segue o padrão das rotinas agendadas e não registra o token", () => {
    const envio = ler("supabase/functions/produto-conversoes/index.ts");
    expect(envio).toContain('req.headers.get("x-cron-secret")');
    expect(envio).toContain("crm_rastreamento_token");
    for (const linha of envio.split("\n").filter((l) => l.indexOf("console.") >= 0)) expect(linha).not.toMatch(/token|conexao\./i);
    expect(ler("supabase/config.toml")).toContain("[functions.produto-conversoes]");
  });

  it("arquivos compartilhados sem recurso que o Safari 11 não tem", () => {
    for (const arquivo of ["supabase/functions/_shared/captacao-do-crm.ts", "supabase/functions/_shared/conversoes-da-meta.ts", "src/pages/ProdutoFormulario.tsx", "src/components/produto/CaptacaoDaConta.tsx", "src/lib/produto/captacao.ts"]) {
      const codigo = ler(arquivo);
      expect(codigo, arquivo).not.toMatch(/\(\?<[=!]/);
      expect(codigo, arquivo).not.toMatch(/\\p\{/);
      expect(codigo, arquivo).not.toMatch(/\.at\(/);
      expect(codigo, arquivo).not.toMatch(/—/);
    }
  });

  it("a tela diz, em uma linha, que o Lead Ads da Meta ainda não entra", () => {
    const tela = ler("src/components/produto/CaptacaoDaConta.tsx");
    expect(tela).toContain("Formulário instantâneo da Meta (Lead Ads) ainda não entra: exige app aprovado na Meta.");
  });
});
