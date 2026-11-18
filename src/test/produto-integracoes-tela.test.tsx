import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { EstadoDoProduto } from "@/lib/produto/api";

/**
 * A tela "Leads da Meta e WhatsApp" com dados simulados (14/11/2026).
 * O gestor vê as cinco partes; o vendedor, só a explicação; e o segredo nunca
 * aparece: nem o salvo (o banco não devolve) nem o que acabou de ser colado.
 */

const TOKEN_COLADO = "EAAGtokenDeTesteQueNuncaPodeAparecer12345";

const banco = vi.hoisted(() => ({
  integracao: {} as Record<string, unknown>,
  vendedores: [] as unknown[],
  atividade: { leads: [] as unknown[], envios: [] as unknown[] },
  chamadas: [] as Array<{ f: string; a: { _dados?: Record<string, unknown>; _membro?: string; _limite?: number } | undefined }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (f: string, a?: { _dados?: Record<string, unknown>; _membro?: string; _limite?: number }) => {
      banco.chamadas.push({ f, a });
      if (f === "crm_integracao_ler") return { data: banco.integracao, error: null };
      if (f === "crm_integracao_salvar") {
        const d = (a && a._dados) || {};
        const { token, app_secret, wa_token, ...resto } = d;
        banco.integracao = {
          ...banco.integracao,
          ...resto,
          existe: true,
          ...(token ? { tem_token: true, token_final: String(token).slice(-4) } : {}),
          ...(app_secret ? { tem_app_secret: true } : {}),
          ...(wa_token ? { tem_wa_token: true, wa_token_final: String(wa_token).slice(-4) } : {}),
        };
        return { data: banco.integracao, error: null };
      }
      if (f === "crm_vendedores_ler") return { data: banco.vendedores, error: null };
      if (f === "crm_vendedor_salvar") return { data: null, error: null };
      if (f === "crm_integracao_atividade") return { data: banco.atividade, error: null };
      return { data: null, error: { message: `rpc desconhecida: ${f}` } };
    }),
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "jwt-de-teste" } } })) },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import IntegracoesDaConta from "@/components/produto/IntegracoesDaConta";

const INTEGRACAO = {
  existe: true,
  ativo: false,
  modo: "teste",
  webhook_chave: "0123456789abcdef0123456789abcdef",
  verify_token: "verificar123verificar123",
  pagina_id: "123456789012345",
  formularios: [],
  tem_app_secret: true,
  tem_token: true,
  token_final: "9ZxQ",
  wa_phone_id: null,
  wa_waba_id: null,
  wa_numero: null,
  tem_wa_token: false,
  wa_token_final: null,
  templates: {},
  idioma: "pt_BR",
  pontuacao: {},
  followup_horas: [24, 72],
  ultimo_erro: null,
  numeros: { leads_7_dias: 7, na_fila: 2, em_nutricao: 3, envios_pendentes: 1, envios_com_erro: 0 },
};

const VENDEDORES = [
  { membro_id: "m1", user_id: "u1", nome: "Ana Souza", papel: "usuario", cargo: "Consultora", estado: "ativo", recebe_leads: true, bens: ["imovel", "carro"], expediente: { dias: [1, 2, 3, 4, 5], inicio: "09:00", fim: "18:00" }, whatsapp: "5541999990000", no_expediente: true, ultimo_lead_em: null },
  { membro_id: "m2", user_id: "u2", nome: "Bruno Lima", papel: "usuario", cargo: "", estado: "ativo", recebe_leads: true, bens: [], expediente: {}, whatsapp: null, no_expediente: false, ultimo_lead_em: null },
];

const ATIVIDADE = {
  leads: [
    { id: "l1", leadgen_id: "sim_1", form_id: null, situacao: "criado", de_teste: true, erro: null, criado_em: "2026-11-13T15:00:00Z", lead_id: "n1", nome: "Carla Teste", faixa: "quente", nota: 82, fila_desde: null, nutricao: false, vendedor: "Ana Souza", campanha: "Consórcio novembro" },
    { id: "l2", leadgen_id: "sim_2", form_id: null, situacao: "criado", de_teste: true, erro: null, criado_em: "2026-11-13T14:00:00Z", lead_id: "n2", nome: "Diego Teste", faixa: "morno", nota: 50, fila_desde: "2026-11-13T14:00:00Z", nutricao: false, vendedor: null, campanha: null },
  ],
  envios: [
    { id: "e1", destino: "lead", situacao: "simulado", erro: null, criado_em: "2026-11-13T15:00:05Z", enviado_em: null, lead_id: "n1", tipo: "template", resumo: "crm_boas_vindas" },
    { id: "e2", destino: "vendedor", situacao: "erro", erro: "Número sem WhatsApp", criado_em: "2026-11-13T15:00:06Z", enviado_em: null, lead_id: "n1", tipo: "template", resumo: "crm_aviso_vendedor" },
  ],
};

function estadoDe(papel: "admin" | "gerente" | "usuario"): EstadoDoProduto {
  return {
    conta: { id: "c1", nome: "Consórcios Sul", estado: "ativa", plano_id: "pro", usuarios_contratados: 3, crm_ativo: true, email_ativo: false, email_caixas_contratadas: 0, teste_ate: null, atrasada_desde: null, acesso_ate: null, visibilidade: "proprios", aparencia: {}, perfil: { nicho: "consorcio" }, documento: null, email_cobranca: null, telefone: null },
    eu: { membro_id: "eu", papel, nome: "Eu", email: "eu@empresa.test", cargo: "", gerente_id: null },
    ve_tudo: papel !== "usuario",
    avisos_novos: 0,
    plano: null,
    liberada: true,
    crm: true,
    email: false,
    dono_da_casa: false,
    pagamentos_ativos: false,
    tolerancia_dias: 5,
    teste_dias: 7,
    equipe: [],
    maquina_no_mes: 0,
    assinatura: null,
    convite: null,
  } as unknown as EstadoDoProduto;
}

function abrir(papel: "admin" | "gerente" | "usuario", parte = "") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/integracoes${parte ? `?parte=${parte}` : ""}`]}>
        <IntegracoesDaConta estado={estadoDe(papel)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const salvamentos = () => banco.chamadas.filter((c) => c.f === "crm_integracao_salvar").map((c) => c.a._dados);

beforeEach(() => {
  banco.integracao = { ...INTEGRACAO };
  banco.vendedores = VENDEDORES.map((v) => ({ ...v }));
  banco.atividade = ATIVIDADE;
  banco.chamadas = [];
});

describe("quem vê a tela", () => {
  it("o vendedor vê só a explicação e nada é lido do banco", () => {
    const { container } = abrir("usuario");
    expect(container.querySelector("[data-integracoes-da-conta='vendedor']")).not.toBeNull();
    expect(screen.getByText("Isto é com o seu gerente.")).toBeInTheDocument();
    expect(container.querySelector("[data-partes-da-integracao]")).toBeNull();
    expect(container.querySelector("[data-parte]")).toBeNull();
    expect(banco.chamadas).toEqual([]);
  });

  it("o vendedor não abre parte nenhuma pelo endereço", () => {
    const { container } = abrir("usuario", "meta");
    expect(container.querySelector("[data-parte]")).toBeNull();
    expect(banco.chamadas).toEqual([]);
  });

  for (const papel of ["admin", "gerente"] as const) {
    it(`${papel} vê as cinco partes e começa na visão`, async () => {
      const { container } = abrir(papel);
      const nav = container.querySelector("[data-partes-da-integracao]") as HTMLElement;
      expect(Array.from(nav.querySelectorAll("[data-ir-para-parte]")).map((b) => b.getAttribute("data-ir-para-parte"))).toEqual(["visao", "meta", "whatsapp", "pontuacao", "vendedores"]);
      await waitFor(() => expect(container.querySelector("[data-parte='visao']")).not.toBeNull());
    });
  }
});

describe("visão", () => {
  it("mostra a chave desligada, os números, a conferência e a atividade", async () => {
    const { container } = abrir("gerente");
    await waitFor(() => expect(container.querySelector("[data-chave-geral='desligada']")).not.toBeNull());
    expect(screen.getByRole("switch", { name: "Ligar a integração" })).toHaveAttribute("aria-checked", "false");
    const numeros = container.querySelector("[data-numeros-da-integracao]") as HTMLElement;
    for (const rotulo of ["Leads em 7 dias", "Na fila", "Em nutrição", "Envios pendentes", "Envios com erro"]) expect(within(numeros).getByText(rotulo)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("[data-item-da-conferencia='vendedor']")).not.toBeNull());
    expect(container.querySelector("[data-item-da-conferencia='pagina']")!.getAttribute("data-feito")).toBe("sim");
    expect(container.querySelector("[data-item-da-conferencia='wa_numero']")!.getAttribute("data-feito")).toBe("nao");
    expect(container.querySelector("[data-item-da-conferencia='aviso']")!.getAttribute("data-feito")).toBe("nao");
    await screen.findByText("Carla Teste");
    expect(screen.getByText("Quente 82")).toBeInTheDocument();
    expect(screen.getByText("Diego Teste").closest("li")!.textContent).toContain("Na fila");
    expect(screen.getByText("Carla Teste").closest("li")!.textContent).toContain("Ana Souza");
    expect(container.querySelectorAll("[data-envio='simulado']").length).toBe(1);
    expect(container.querySelectorAll("[data-envio='erro']").length).toBe(1);
    expect(screen.getByRole("button", { name: /Simular um lead/ })).toBeInTheDocument();
  });

  it("simular abre a conexão na primeira vez e chama o simulador com a sessão, sem nada além da faixa", async () => {
    banco.integracao = { ...INTEGRACAO, existe: false, webhook_chave: null, verify_token: null };
    const pedidos: Array<{ url: string; init: RequestInit }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      pedidos.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({ ok: true, de_teste: true, resultado: { nome: "Lead de teste", nota: 82, faixa: "quente", na_fila: false, nutricao: false, vendedor: { nome: "Ana Souza" } } }), { status: 201 });
    }) as typeof fetch;
    try {
      const { container } = abrir("gerente");
      await waitFor(() => expect(container.querySelector("[data-simular-lead]")).not.toBeNull());
      fireEvent.change(container.querySelector("[data-faixa-da-simulacao]") as HTMLElement, { target: { value: "morno" } });
      fireEvent.click(container.querySelector("[data-simular-lead]") as HTMLElement);
      await waitFor(() => expect(pedidos.length).toBe(1));
      expect(salvamentos()).toEqual([{}]);
      expect(pedidos[0].url).toBe("https://ci-placeholder.supabase.co/functions/v1/produto-meta/simular");
      expect(pedidos[0].init.method).toBe("POST");
      expect((pedidos[0].init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-de-teste");
      expect(JSON.parse(String(pedidos[0].init.body))).toEqual({ faixa: "morno" });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("ligar em teste salva direto", async () => {
    abrir("gerente");
    fireEvent.click(await screen.findByRole("switch", { name: "Ligar a integração" }));
    await waitFor(() => expect(salvamentos()).toEqual([{ ativo: true, modo: "teste" }]));
  });

  it("ligar de verdade pede confirmação antes de salvar", async () => {
    banco.integracao = { ...INTEGRACAO, modo: "real" };
    abrir("gerente");
    fireEvent.click(await screen.findByRole("switch", { name: "Ligar a integração" }));
    const confirmar = await screen.findByRole("button", { name: "Ligar de verdade" });
    expect(salvamentos()).toEqual([]);
    fireEvent.click(confirmar);
    await waitFor(() => expect(salvamentos()).toEqual([{ ativo: true, modo: "real" }]));
  });

  it("sem a Meta conectada, ligar de verdade mostra o que falta e não salva", async () => {
    banco.integracao = { ...INTEGRACAO, modo: "real", tem_token: false, token_final: null, pagina_id: null };
    abrir("gerente");
    fireEvent.click(await screen.findByRole("switch", { name: "Ligar a integração" }));
    const falta = await waitFor(() => {
      const el = document.querySelector("[data-falta-para-ligar]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(falta).getByText("ID da Página")).toBeInTheDocument();
    expect(within(falta).getByText("Token do usuário do sistema")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ligar de verdade" })).toBeNull();
    expect(salvamentos()).toEqual([]);
  });
});

describe("Meta: o segredo nunca aparece", () => {
  it("mostra o endereço e o token de verificação para copiar, e o segredo salvo só como 'termina em'", async () => {
    const { container } = abrir("admin", "meta");
    await waitFor(() => expect(container.querySelector("[data-parte='meta']")).not.toBeNull());
    expect(container.querySelector("[data-webhook-da-empresa]")!.textContent).toContain("https://ci-placeholder.supabase.co/functions/v1/produto-meta/0123456789abcdef0123456789abcdef");
    expect(container.querySelector("[data-webhook-da-empresa]")!.textContent).toContain("verificar123verificar123");
    expect(screen.getByRole("button", { name: "Copiar: Endereço do webhook" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-passos-da-meta] > li").length).toBeGreaterThanOrEqual(4);
    const salvoToken = container.querySelector("[data-segredo='token']") as HTMLElement;
    expect(salvoToken.tagName).toBe("DIV");
    expect(salvoToken.textContent).toContain("Salvo, termina em 9ZxQ");
    expect((container.querySelector("[data-segredo='app_secret']") as HTMLElement).textContent).toContain("Salvo no cofre");
    // Nenhum campo de senha preenchido nem valor de segredo no DOM.
    expect(container.querySelectorAll("input[type='password']").length).toBe(0);
  });

  it("trocar abre um campo de senha vazio; depois de salvar, o valor colado some da tela", async () => {
    const { container } = abrir("admin", "meta");
    fireEvent.click(await screen.findByRole("button", { name: "Trocar: Token do usuário do sistema" }));
    const entrada = container.querySelector("input[data-segredo='token']") as HTMLInputElement;
    expect(entrada.type).toBe("password");
    expect(entrada.value).toBe("");
    expect(entrada.getAttribute("autocomplete")).toBe("off");
    fireEvent.change(entrada, { target: { value: TOKEN_COLADO } });
    fireEvent.click(container.querySelector("[data-salvar='meta']") as HTMLElement);
    await waitFor(() => expect(salvamentos().length).toBe(1));
    expect(salvamentos()[0].token).toBe(TOKEN_COLADO);
    expect(salvamentos()[0]).not.toHaveProperty("app_secret");
    await waitFor(() => expect((container.querySelector("[data-segredo='token']") as HTMLElement).textContent).toContain("Salvo, termina em 2345"));
    expect(container.querySelector("input[data-segredo='token']")).toBeNull();
    expect(document.body.innerHTML).not.toContain(TOKEN_COLADO);
    for (const el of Array.from(document.querySelectorAll("input, textarea"))) expect((el as HTMLInputElement).value).not.toContain(TOKEN_COLADO);
  });

  it("empresa que ainda não abriu a conexão gera o endereço primeiro", async () => {
    banco.integracao = { ...INTEGRACAO, existe: false, webhook_chave: null, verify_token: null, tem_token: false, tem_app_secret: false, token_final: null, pagina_id: null };
    const { container } = abrir("admin", "meta");
    await waitFor(() => expect(container.querySelector("[data-gerar-endereco]")).not.toBeNull());
    expect(container.querySelector("[data-webhook-da-empresa]")!.textContent).not.toContain("produto-meta");
    expect((container.querySelector("input[data-segredo='token']") as HTMLInputElement).type).toBe("password");
  });
});

describe("as outras partes abrem pelo endereço", () => {
  it("WhatsApp: campos do número, nomes dos templates, prazos e os textos sugeridos", async () => {
    const { container } = abrir("gerente", "whatsapp");
    await waitFor(() => expect(container.querySelector("[data-parte='whatsapp']")).not.toBeNull());
    expect(container.querySelector("[data-id-do-numero]")).not.toBeNull();
    expect(container.querySelector("[data-id-da-conta-do-whatsapp]")).not.toBeNull();
    expect(container.querySelectorAll("[data-nome-do-template]").length).toBe(4);
    expect(Array.from(container.querySelectorAll("[data-prazo-de-followup]")).map((e) => (e as HTMLInputElement).value)).toEqual(["24", "72", ""]);
    expect(container.querySelectorAll("[data-template-sugerido]").length).toBe(4);
    expect(container.querySelector("[data-template-sugerido='lead']")!.textContent).toContain("{{1}}");
    // Sem token próprio, usa o da Meta: campo de senha vazio.
    expect((container.querySelector("input[data-segredo='wa_token']") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Vazio: usa o mesmo token da Meta.")).toBeInTheDocument();
  });

  it("Pontuação: o simulador dá a nota na hora e o padrão do ramo é o do consórcio", async () => {
    const { container } = abrir("gerente", "pontuacao");
    await waitFor(() => expect(container.querySelector("[data-parte='pontuacao']")).not.toBeNull());
    expect(Array.from(container.querySelectorAll("[data-criterio]")).map((e) => e.getAttribute("data-criterio"))).toEqual(["bem", "valor_carta", "parcela", "prazo", "lance"]);
    expect((container.querySelector("[data-manda-para-nutricao='menos_de_3_meses']") as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector("[data-voltar-ao-padrao]") as HTMLButtonElement).disabled).toBe(true);
    const nota = () => container.querySelector("[data-nota-simulada]") as HTMLElement;
    expect(nota().getAttribute("data-nota-simulada")).toBe("40");
    fireEvent.change(container.querySelector("[data-resposta='bem']") as HTMLElement, { target: { value: "imovel" } });
    fireEvent.change(container.querySelector("[data-resposta='valor_carta']") as HTMLElement, { target: { value: "200000" } });
    fireEvent.change(container.querySelector("[data-resposta='parcela']") as HTMLElement, { target: { value: "2500" } });
    fireEvent.change(container.querySelector("[data-resposta='lance']") as HTMLElement, { target: { value: "sim" } });
    expect(nota().getAttribute("data-nota-simulada")).toBe("80");
    expect(nota().getAttribute("data-faixa-simulada")).toBe("quente");
    expect(within(container.querySelector("[data-motivos-da-nota]") as HTMLElement).getByText("Bem: 25")).toBeInTheDocument();
    // Mexer num ponto muda a nota sem salvar, e libera o "voltar ao padrão".
    fireEvent.change(container.querySelector("[data-criterio='bem'] [data-pontos='imovel']") as HTMLElement, { target: { value: "5" } });
    expect(nota().getAttribute("data-nota-simulada")).not.toBe("80");
    expect((container.querySelector("[data-voltar-ao-padrao]") as HTMLButtonElement).disabled).toBe(false);
    expect(salvamentos()).toEqual([]);
    fireEvent.click(container.querySelector("[data-voltar-ao-padrao]") as HTMLElement);
    expect(nota().getAttribute("data-nota-simulada")).toBe("80");
  });

  it("Vendedores: cada pessoa com bens, expediente, WhatsApp e se está no expediente agora", async () => {
    const { container } = abrir("gerente", "vendedores");
    await screen.findByText("Ana Souza");
    const ana = container.querySelector("[data-vendedor='m1']") as HTMLElement;
    expect(ana.textContent).toContain("Imóvel, Carro");
    expect(ana.textContent).toContain("Seg a sex, 09:00 às 18:00");
    expect(ana.textContent).toContain("+55 41 99999-0000");
    expect(ana.querySelector("[data-no-expediente]")!.getAttribute("data-no-expediente")).toBe("sim");
    const bruno = container.querySelector("[data-vendedor='m2']") as HTMLElement;
    expect(bruno.textContent).toContain("Todos os bens");
    expect(bruno.textContent).toContain("Sempre");
    expect(bruno.textContent).toContain("Sem WhatsApp para os avisos");
    expect(bruno.querySelector("[data-no-expediente]")!.getAttribute("data-no-expediente")).toBe("nao");
    fireEvent.click(within(ana).getByRole("switch"));
    await waitFor(() => expect(banco.chamadas.some((c) => c.f === "crm_vendedor_salvar" && c.a._membro === "m1" && c.a._dados.recebe_leads === false)).toBe(true));
    // As etiquetas de bem do editor saem das regras do ramo.
    fireEvent.click(within(bruno).getByRole("button", { name: "Editar Bruno Lima" }));
    const editor = await waitFor(() => {
      const el = document.querySelector("[data-editor-de-vendedor]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(Array.from(editor.querySelectorAll("[data-bem]")).map((b) => b.getAttribute("data-bem"))).toEqual(["imovel", "carro", "moto", "pesados", "servicos", "outros"]);
    expect((editor.querySelector("[data-sempre]") as HTMLInputElement).checked).toBe(true);
  });
});

describe("texto e padrão da tela", () => {
  const fonte = readFileSync(resolve(__dirname, "../components/produto/IntegracoesDaConta.tsx"), "utf8");

  it("sem travessão, sem emoji e sem gap em flex", () => {
    expect(fonte).not.toMatch(/[—–]/);
    expect(fonte).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
    for (const m of fonte.match(/"[^"\n]*\bgap-[^"\n]*"/g) || []) expect(m, m).toMatch(/\bgrid\b/);
  });

  it("o segredo só entra em campo de senha e a tela nunca escreve o valor", () => {
    expect(fonte).toContain('type="password"');
    expect(fonte).not.toMatch(/console\.(log|info|debug)/);
    expect(fonte).not.toMatch(/localStorage|sessionStorage/);
  });
});
