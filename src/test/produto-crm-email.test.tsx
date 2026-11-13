import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { chaveDoEscopo, definirEscopoDoCrm, limitesDoPlano, naConta, tabelaDoCrm } from "@/lib/comercial/escopo";
import { avisoDaConta, diasAte, mensalidadePrevista, type EstadoDoProduto, type PlanoDoProduto } from "@/lib/produto/api";
import EscolhaDePlano from "@/components/produto/EscolhaDePlano";
import { precisaCriarSenha, senhaAceita } from "@/components/produto/CriarSenha";
import { registrosParaPublicar } from "@/components/produto/casa/EmailDaCasa";
import { nomeDoMes, resultadoDoMes, somarMeses } from "@/components/produto/casa/FaturamentoDoProduto";
import { situacaoDaConta } from "@/components/produto/casa/ContasDaCasa";
import {
  cancelarAssinaturaNoAsaas,
  contaDaReferencia,
  criarCheckoutDaAssinatura,
  descricaoDosItens,
  estadoDaCobranca,
  itensValidos,
  lerPagamento,
  mudarValorDaAssinatura,
  totalDosItens,
} from "../../supabase/functions/produto/modulos/asaas";
import { avaliar } from "../../supabase/functions/produto/modulos/dns";

/**
 * Produto CRM e E-mail (13/11/2026): as regras que não podem quebrar sem
 * ninguém ver. Dado de uma empresa nunca vira dado da casa, a mensalidade da
 * tela é a do banco, o cartão não passa pelo servidor e o aviso do Asaas só
 * vale conferido.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const ESCOPO_DA_CONTA = {
  modo: "conta" as const,
  contaId: "11111111-1111-4111-8111-111111111111",
  base: "/app/crm",
  equipe: [],
  limites: limitesDoPlano({ maquina_buscas_mes: 5 }),
  maquinaNoMes: 0,
};

afterEach(() => definirEscopoDoCrm(null));

describe("escopo do CRM", () => {
  it("na casa o nome da tabela não muda", () => {
    expect(naConta()).toBe(false);
    expect(tabelaDoCrm("commercial_leads")).toBe("commercial_leads");
    expect(tabelaDoCrm("commercial_handoffs")).toBe("commercial_handoffs");
    expect(chaveDoEscopo()).toBe("casa");
  });

  it("na empresa cada tabela vai para a gêmea com conta_id", () => {
    definirEscopoDoCrm(ESCOPO_DA_CONTA);
    expect(naConta()).toBe(true);
    expect(tabelaDoCrm("commercial_leads")).toBe("crm_leads");
    expect(tabelaDoCrm("commercial_lead_messages")).toBe("crm_lead_messages");
    expect(chaveDoEscopo()).toBe(`conta:${ESCOPO_DA_CONTA.contaId}`);
  });

  it("tabela que só existe na casa falha alto dentro de uma empresa", () => {
    definirEscopoDoCrm(ESCOPO_DA_CONTA);
    expect(() => tabelaDoCrm("commercial_handoffs")).toThrow();
    expect(() => tabelaDoCrm("commercial_facts")).toThrow();
  });

  it("a camada de dados do Comercial não chama tabela espelhada pelo nome fixo", () => {
    const espelhadas = /\.from\("commercial_(leads|organizations|contacts|activities|lead_events|campaigns|goals|lead_messages)"\)/;
    for (const arquivo of ["src/lib/comercial.ts", "src/lib/comercial/mercurio.ts", "src/components/comercial/eventosDoFunil.ts"]) {
      expect(espelhadas.test(ler(arquivo)), arquivo).toBe(false);
    }
  });

  it("a meta do mês é única por empresa: o salvar aponta para a chave certa em cada escopo", () => {
    const dados = ler("src/lib/comercial.ts");
    expect(dados).toContain('onConflict: naConta() ? "conta_id,period,metric" : "period,metric"');
    expect(ler("supabase/migrations/20261113120000_produto_crm_e_email.sql")).toContain("on public.crm_goals (conta_id, period, metric)");
  });

  it("limites do plano malformados caem no padrão fechado", () => {
    expect(limitesDoPlano(null).maquina_buscas_mes).toBe(0);
    expect(limitesDoPlano({ maquina_google_maps: "sim" }).maquina_google_maps).toBe(false);
    expect(limitesDoPlano({ maquina_limite_por_busca: 0 }).maquina_limite_por_busca).toBe(1);
  });
});

const PLANO: PlanoDoProduto = {
  id: "starter", nome: "Starter", resumo: "", preco_usuario: 49.9, minimo_usuarios: 1, recursos: ["Funil"],
  limites: limitesDoPlano({ maquina_buscas_mes: 5 }), email_caixas_incluidas: 0, destaque: false, ativo: true, ordem: 1,
};
const PRO: PlanoDoProduto = { ...PLANO, id: "pro", nome: "Pro", preco_usuario: 79.9, email_caixas_incluidas: 5, destaque: true };
const CONFIG = { email_mensal: 39.9, email_caixas_no_mensal: 5, email_caixa_extra: 14.9 };

describe("mensalidade", () => {
  it("três usuários no Starter custam 149,70", () => {
    const m = mensalidadePrevista({ plano: PLANO, usuarios: 3 });
    expect(m.total).toBe(149.7);
    expect(m.itens).toHaveLength(1);
    expect(m.itens[0]).toMatchObject({ chave: "crm", quantidade: 3, unitario: 49.9 });
  });

  it("o e-mail entra com a mensalidade e as caixas além das incluídas", () => {
    const m = mensalidadePrevista({ plano: PLANO, usuarios: 2, email: true, caixas: 7, config: CONFIG });
    expect(m.itens.map((i) => i.chave)).toEqual(["crm", "email", "email_caixa_extra"]);
    expect(m.total).toBe(Math.round((2 * 49.9 + 39.9 + 2 * 14.9) * 100) / 100);
  });

  it("plano que inclui e-mail não cobra a mensalidade do e-mail", () => {
    const m = mensalidadePrevista({ plano: PRO, usuarios: 2, email: true, caixas: 5, config: CONFIG });
    expect(m.itens.map((i) => i.chave)).toEqual(["crm"]);
    const comExtra = mensalidadePrevista({ plano: PRO, usuarios: 2, email: true, caixas: 6, config: CONFIG });
    expect(comExtra.itens.map((i) => i.chave)).toEqual(["crm", "email_caixa_extra"]);
  });

  it("só e-mail, sem CRM, cobra só o e-mail", () => {
    const m = mensalidadePrevista({ plano: PLANO, usuarios: 1, crm: false, email: true, caixas: 5, config: CONFIG });
    expect(m.total).toBe(39.9);
  });

  it("a regra do banco é a mesma da tela", () => {
    const sql = ler("supabase/migrations/20261113120000_produto_crm_e_email.sql");
    expect(sql).toContain("create or replace function public.produto_itens_da_conta");
    expect(sql).toContain("'email_caixa_extra'");
    expect(sql).toContain("email_caixas_no_mensal");
  });
});

function estado(parte: Partial<EstadoDoProduto["conta"]> & { estado: NonNullable<EstadoDoProduto["conta"]>["estado"] }, liberada: boolean, papel: "admin" | "usuario" = "admin"): EstadoDoProduto {
  return {
    conta: {
      id: "c", nome: "Empresa", plano_id: "starter", usuarios_contratados: 2, crm_ativo: true, email_ativo: false, email_caixas_contratadas: 0,
      teste_ate: null, atrasada_desde: null, acesso_ate: null, visibilidade: "todos", documento: null, email_cobranca: null, telefone: null, ...parte,
    },
    eu: { membro_id: "m", papel, nome: "Ana", email: "ana@exemplo.com" },
    plano: null, liberada, crm: liberada, email: false, dono_da_casa: false, pagamentos_ativos: true, tolerancia_dias: 5, teste_dias: 7,
    equipe: [], maquina_no_mes: 0, assinatura: null, convite: null,
  };
}

describe("aviso da conta", () => {
  const agora = new Date("2026-11-13T12:00:00-03:00").getTime();
  it("conta ativa não mostra aviso", () => {
    expect(avisoDaConta(estado({ estado: "ativa" }, true), agora)).toBeNull();
  });
  it("teste diz quantos dias faltam e chama para assinar só quem administra", () => {
    const a = avisoDaConta(estado({ estado: "teste", teste_ate: "2026-11-18T12:00:00-03:00" }, true), agora);
    expect(a && a.texto).toBe("Faltam 5 dias de teste.");
    expect(a && a.acao).toBe("Assinar");
    const u = avisoDaConta(estado({ estado: "teste", teste_ate: "2026-11-18T12:00:00-03:00" }, true, "usuario"), agora);
    expect(u && u.acao).toBeNull();
  });
  it("teste vencido e atraso sem acesso viram perigo", () => {
    expect(avisoDaConta(estado({ estado: "teste", teste_ate: "2026-11-01T12:00:00-03:00" }, false), agora)).toMatchObject({ tom: "perigo" });
    expect(avisoDaConta(estado({ estado: "atrasada" }, false), agora)).toMatchObject({ tom: "perigo", acao: "Regularizar" });
    expect(avisoDaConta(estado({ estado: "atrasada" }, true), agora)).toMatchObject({ tom: "alerta" });
  });
  it("dias até uma data nunca ficam negativos", () => {
    expect(diasAte("2026-11-01T00:00:00Z", agora)).toBe(0);
    expect(diasAte(null, agora)).toBe(0);
  });
});

describe("Asaas: assinatura sem ver o cartão", () => {
  const TOKEN = "$aact_hmlg_teste";
  const itens = itensValidos([
    { chave: "crm", nome: "CRM Starter", quantidade: 3, unitario: 49.9 },
    { chave: "lixo", nome: "Sem valor", quantidade: 0, unitario: 10 },
  ]);

  it("itens sem quantidade ou valor ficam de fora e o total fecha", () => {
    expect(itens).toHaveLength(1);
    expect(totalDosItens(itens)).toBe(149.7);
    expect(descricaoDosItens(itens)).toBe("CRM Starter x 3");
  });

  it("o checkout é recorrente, no cartão, e não leva nenhum dado de cartão", async () => {
    const pedidos: Array<{ url: string; corpo: Record<string, unknown> }> = [];
    const buscar = async (url: string, init?: RequestInit) => {
      pedidos.push({ url, corpo: JSON.parse(String(init && init.body)) });
      return new Response(JSON.stringify({ id: "chk_1", link: "https://sandbox.asaas.com/checkoutSession/show/chk_1" }), { status: 200 });
    };
    const r = await criarCheckoutDaAssinatura(TOKEN, buscar, { clienteId: "cus_1", itens, referencia: "conta:abc", voltarPara: "https://aceleriq.online/app/conta", agora: new Date("2026-11-13T15:00:00Z") });
    expect(r.id).toBe("chk_1");
    expect(pedidos[0].url).toBe("https://api-sandbox.asaas.com/v3/checkouts");
    const corpo = pedidos[0].corpo;
    expect(corpo.billingTypes).toEqual(["CREDIT_CARD"]);
    expect(corpo.chargeTypes).toEqual(["RECURRENT"]);
    expect((corpo.subscription as { cycle: string }).cycle).toBe("MONTHLY");
    expect((corpo.items as Array<{ quantity: number; value: number }>)[0]).toMatchObject({ quantity: 3, value: 49.9 });
    expect(JSON.stringify(corpo)).not.toMatch(/creditCard|cardNumber|ccv|holderName/i);
    expect((corpo.callback as { successUrl: string }).successUrl).toContain("/app/conta?pagamento=ok");
  });

  it("checkout sem link do Asaas é erro, não sucesso", async () => {
    const buscar = async () => new Response(JSON.stringify({ id: "chk_1" }), { status: 200 });
    await expect(criarCheckoutDaAssinatura(TOKEN, buscar, { clienteId: "cus_1", itens, referencia: "conta:abc", voltarPara: "https://x", agora: new Date() })).rejects.toThrow();
  });

  it("mudança de valor só vale se o Asaas devolver o valor novo", async () => {
    const aceita = async () => new Response(JSON.stringify({ id: "sub_1", value: 199.6, status: "ACTIVE" }), { status: 200 });
    const ignora = async () => new Response(JSON.stringify({ id: "sub_1", value: 149.7, status: "ACTIVE" }), { status: 200 });
    await expect(mudarValorDaAssinatura(TOKEN, aceita, "sub_1", { valor: 199.6, descricao: "x" })).resolves.toMatchObject({ valor: 199.6 });
    await expect(mudarValorDaAssinatura(TOKEN, ignora, "sub_1", { valor: 199.6, descricao: "x" })).rejects.toThrow();
  });

  it("id que não é de assinatura nem chega ao Asaas", async () => {
    let chamou = false;
    const buscar = async () => {
      chamou = true;
      return new Response("{}", { status: 200 });
    };
    expect(await cancelarAssinaturaNoAsaas(TOKEN, buscar, "../payments/pay_1")).toBe(false);
    expect(chamou).toBe(false);
  });

  it("o estado da cobrança vem do status do Asaas", () => {
    expect(estadoDaCobranca("CONFIRMED")).toBe("paga");
    expect(estadoDaCobranca("RECEIVED")).toBe("paga");
    expect(estadoDaCobranca("OVERDUE")).toBe("atrasada");
    expect(estadoDaCobranca("REFUNDED")).toBe("estornada");
    expect(estadoDaCobranca("PENDING")).toBe("aberta");
    expect(estadoDaCobranca("CONFIRMED", true)).toBe("cancelada");
  });

  it("a referência liga a cobrança à empresa, e só no formato certo", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(contaDaReferencia(`conta:${id}`)).toEqual({ contaId: id, tipo: "mensalidade" });
    expect(contaDaReferencia(`conta:${id}:migracao`)).toEqual({ contaId: id, tipo: "migracao" });
    expect(contaDaReferencia(`lead:${id}`)).toBeNull();
    expect(contaDaReferencia(null)).toBeNull();
  });

  it("do cartão só ficam os quatro últimos dígitos", () => {
    const p = lerPagamento({ id: "pay_1", value: 149.7, netValue: 144.2, status: "CONFIRMED", subscription: "sub_1", creditCard: { creditCardNumber: "8829", creditCardBrand: "VISA", creditCardToken: "tok" } });
    expect(p.cartao_final).toBe("8829");
    expect(p.assinatura_id).toBe("sub_1");
    expect(p.liquido).toBe(144.2);
    expect(JSON.stringify(p)).not.toContain("tok");
  });

  it("o aviso do Asaas confere o token, a origem da cobrança e o próprio Asaas", () => {
    const webhook = ler("supabase/functions/produto-asaas-webhook/index.ts");
    expect(webhook).toContain('req.headers.get("asaas-access-token")');
    expect(webhook).toContain("lerPagamentoNoAsaas");
    expect(webhook).toContain('"cobranca_de_fora"');
    expect(webhook).toContain("produto_eventos");
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.produto-asaas-webhook\]\s+verify_jwt = false/);
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.produto\]\s+verify_jwt = true/);
  });
});

describe("saúde do domínio de e-mail", () => {
  const agora = new Date("2026-11-13T12:00:00Z");
  const base = { dominio: "exemplo.com.br", provedor: "zoho" as const, seletor: "zmail", agora };

  it("Zoho configurado por inteiro fica pronto", () => {
    const c = avaliar({
      ...base,
      mx: ["10 mx.zoho.com", "20 mx2.zoho.com", "50 mx3.zoho.com"],
      txt: ["v=spf1 include:zoho.com ~all", "google-site-verification=abc"],
      dkim: ["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"],
      dmarc: ["v=DMARC1; p=quarantine; rua=mailto:dmarc@exemplo.com.br"],
    });
    expect(c.pronto).toBe(true);
    expect(c.itens.map((i) => i.estado)).toEqual(["certo", "certo", "certo", "certo"]);
  });

  it("e-mail ainda no provedor antigo aparece como falta, com a explicação", () => {
    const c = avaliar({ ...base, mx: ["10 mx.uhserver.com"], txt: ["v=spf1 ?all"], dkim: [], dmarc: [] });
    expect(c.pronto).toBe(false);
    const porChave = (k: string) => c.itens.filter((i) => i.chave === k)[0];
    expect(porChave("mx").estado).toBe("falta");
    expect(porChave("mx").explicacao).toContain("provedor antigo");
    expect(porChave("spf").estado).toBe("atencao");
    expect(porChave("dkim").estado).toBe("falta");
    expect(porChave("dmarc").estado).toBe("falta");
  });

  it("dois SPF e MX misturado pedem atenção", () => {
    const c = avaliar({ ...base, mx: ["10 mx.zoho.com", "20 mx.uhserver.com"], txt: ["v=spf1 include:zoho.com ~all", "v=spf1 a mx ~all"], dkim: [], dmarc: ["v=DMARC1; p=none"] });
    const porChave = (k: string) => c.itens.filter((i) => i.chave === k)[0];
    expect(porChave("mx").estado).toBe("atencao");
    expect(porChave("spf").estado).toBe("atencao");
    expect(porChave("spf").explicacao).toContain("mais de um SPF");
    expect(porChave("dmarc").estado).toBe("atencao");
  });

  it("os registros para publicar seguem o provedor e o domínio", () => {
    const zoho = registrosParaPublicar({ dominio: "exemplo.com.br", provedor: "zoho", dkim_seletor: null });
    expect(zoho).toContain("mx.zoho.com.");
    expect(zoho).toContain("include:zoho.com");
    expect(zoho).toContain("zmail._domainkey.exemplo.com.br.");
    expect(zoho).toContain("_dmarc.exemplo.com.br.");
    expect(registrosParaPublicar({ dominio: "exemplo.com.br", provedor: "google", dkim_seletor: "s1" })).toContain("s1._domainkey.exemplo.com.br.");
  });
});

describe("a casa", () => {
  it("o resultado do mês é o recebido menos o custo total", () => {
    expect(resultadoDoMes({ recebido: 1000, custo_total: 312.45 })).toBe(687.55);
    expect(resultadoDoMes({ recebido: 0, custo_total: 50 })).toBe(-50);
  });

  it("o custo total não soma a taxa do Asaas duas vezes", () => {
    const sql = ler("supabase/migrations/20261113120000_produto_crm_e_email.sql");
    const linha = sql.split("\n").filter((l) => l.indexOf("'custo_total'") >= 0)[0];
    expect(linha).toContain("_custos");
    expect(linha).not.toContain("_liquido");
  });

  it("os meses andam certo na virada do ano", () => {
    expect(somarMeses("2026-12-01", 1)).toBe("2027-01-01");
    expect(somarMeses("2026-01-01", -1)).toBe("2025-12-01");
    expect(nomeDoMes("2026-11-01")).toBe("Novembro de 2026");
  });

  it("a situação da empresa na lista diz o que importa", () => {
    const agora = new Date("2026-11-13T12:00:00-03:00").getTime();
    const c = { estado: "teste", teste_ate: "2026-11-16T12:00:00-03:00", liberada: true, acesso_ate: null } as never;
    expect(situacaoDaConta(c, agora)).toBe("teste, 3 dias");
    expect(situacaoDaConta({ estado: "teste", teste_ate: "2026-11-01T00:00:00Z", liberada: false, acesso_ate: null } as never, agora)).toBe("teste vencido");
    expect(situacaoDaConta({ estado: "atrasada", liberada: false, teste_ate: null, acesso_ate: null } as never, agora)).toBe("atrasada, sem acesso");
  });
});

describe("primeira entrada", () => {
  it("só quem entrou por convite e ainda não criou senha vê a janela", () => {
    expect(precisaCriarSenha(null)).toBe(false);
    expect(precisaCriarSenha({ invited_at: null, user_metadata: {} })).toBe(false);
    expect(precisaCriarSenha({ invited_at: "2026-11-13T10:00:00Z", user_metadata: {} })).toBe(true);
    expect(precisaCriarSenha({ invited_at: "2026-11-13T10:00:00Z", user_metadata: { produto_senha: true } })).toBe(false);
  });
  it("a senha pede tamanho, maiúscula, minúscula e número", () => {
    expect(senhaAceita("curta1A")).toBe(false);
    expect(senhaAceita("semnumeroABC")).toBe(false);
    expect(senhaAceita("Empresa2026ok")).toBe(true);
  });
});

describe("escolha de plano", () => {
  it("mostra o preço por usuário e não deixa contratar menos que a equipe", () => {
    const usuarios: number[] = [];
    const planos: string[] = [];
    render(<EscolhaDePlano planos={[PLANO, PRO]} plano="starter" usuarios={3} minimoDeUsuarios={3} onPlano={(p) => planos.push(p)} onUsuarios={(n) => usuarios.push(n)} atual="starter" />);
    expect(screen.getByText("Plano atual")).toBeTruthy();
    expect(screen.getByText("Mais completo")).toBeTruthy();
    expect((screen.getByLabelText("Menos um usuário") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Mais um usuário"));
    expect(usuarios).toEqual([4]);
    fireEvent.click(screen.getByRole("radio", { name: /Pro/ }));
    expect(planos).toEqual(["pro"]);
  });
});

describe("banco do produto", () => {
  const sql = ler("supabase/migrations/20261113120000_produto_crm_e_email.sql");

  it("toda tabela do CRM da empresa tem RLS, conta_id e política por conta", () => {
    for (const t of ["crm_leads", "crm_organizations", "crm_contacts", "crm_activities", "crm_lead_events", "crm_campaigns", "crm_goals", "crm_lead_messages"]) {
      expect(sql, t).toContain(`'${t}'`);
    }
    expect(sql).toContain("add column if not exists conta_id uuid not null default public.crm_conta_atual()");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain('create policy "crm da conta" on public.crm_leads');
    expect(sql).toContain("crm_conta_nao_muda");
  });

  it("o cliente não escreve direto nas tabelas da conta: só a casa administra, e ele lê", () => {
    expect(sql).toContain('create policy "produto dono administra"');
    expect(sql).not.toMatch(/create policy "produto (conta da pessoa|colegas|admin da conta le|email da conta)"[^;]*for (all|insert|update|delete)/);
  });

  it("ninguém sem login lê nada além dos planos à venda", () => {
    const concessoes = sql.split("\n").filter((l) => /\bto anon\b/.test(l) && /grant /.test(l));
    expect(concessoes).toEqual(["  grant select on public.produto_planos to anon;"]);
  });

  it("uma pessoa trabalha numa empresa só, e a empresa precisa de quem administre", () => {
    expect(sql).toContain("produto_membros_um_por_pessoa");
    expect(sql).toContain("A empresa precisa de pelo menos uma pessoa administradora.");
  });

  it("a cobrança começa desligada", () => {
    expect(sql).toMatch(/pagamentos_ativos boolean not null default false/);
  });
});

describe("arquivos do produto", () => {
  const pastas = ["src/components/produto", "src/lib/produto", "supabase/functions/produto", "supabase/functions/produto-asaas-webhook"];
  const soltos = [
    "src/pages/ProdutoApp.tsx", "src/pages/ProdutoLanding.tsx", "src/pages/AdminProduto.tsx", "src/hooks/useProduto.ts", "src/lib/comercial/escopo.ts",
    "supabase/functions/_shared/transactional-email-templates/produto-convite.tsx",
    "supabase/migrations/20261113120000_produto_crm_e_email.sql",
  ];
  const andar = (dir: string): string[] =>
    readdirSync(resolve(raiz, dir)).reduce((lista: string[], nome) => {
      const rel = `${dir}/${nome}`;
      return lista.concat(statSync(resolve(raiz, rel)).isDirectory() ? andar(rel) : [rel]);
    }, []);
  const arquivos = pastas.reduce((l: string[], p) => l.concat(andar(p)), []).concat(soltos);

  it("sem travessão e compatíveis com navegador antigo", () => {
    const travessao = String.fromCharCode(0x2014);
    for (const arquivo of arquivos) {
      const texto = ler(arquivo);
      expect(texto.indexOf(travessao), `${arquivo}: travessão`).toBe(-1);
      if (/\.tsx?$/.test(arquivo) && arquivo.indexOf("supabase/") !== 0) {
        expect(/\(\?<[=!]/.test(texto), `${arquivo}: lookbehind`).toBe(false);
        expect(/\\p\{/.test(texto), `${arquivo}: classe Unicode`).toBe(false);
        expect(/\.at\(/.test(texto), `${arquivo}: .at()`).toBe(false);
        expect(/Object\.hasOwn\(/.test(texto), `${arquivo}: Object.hasOwn`).toBe(false);
      }
    }
  });

  it("as telas não usam gap em flex", () => {
    for (const arquivo of arquivos.filter((a) => /\.tsx$/.test(a) && a.indexOf("src/") === 0)) {
      const classes = ler(arquivo).match(/"[^"\n]*\bflex\b[^"\n]*"/g) || [];
      for (const c of classes) {
        if (/\bgrid\b/.test(c)) continue;
        expect(/(^|[\s"])gap-/.test(c), `${arquivo}: ${c}`).toBe(false);
      }
    }
  });
});
