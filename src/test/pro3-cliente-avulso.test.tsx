import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente PRO3, adendo do dono (30/09): "às vezes o cliente ainda não está no
 * painel e só quer algo avulso". Cobre a criação rápida (janela central,
 * caminho de hoje: manage-team + perfil, nada enviado ao cliente, convite só
 * no botão), o cliente aparecendo na hora no seletor de cada mesa de criação
 * e a marca "Avulso"; a Mesa (orgânica), a Ads e a Edição seguem a régua antiga.
 */

configure({ asyncUtilTimeout: 8000 });

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), updates: [] as Array<{ tabela: string; valores: any; id: string }>, papel: "admin" }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const b: any = {};
    let valores: any = null;
    for (const m of ["select", "neq", "not", "in", "is", "order", "limit", "gte", "lte"]) b[m] = () => b;
    b.update = (v: any) => {
      valores = v;
      return b;
    };
    b.eq = (_c: string, id: string) => {
      if (valores) mock.updates.push({ tabela, valores, id });
      return b;
    };
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: tabela === "commercial_leads" ? [{ won_client_id: "99999999-9999-4999-8999-999999999999" }] : [], error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: (t: string) => consulta(t) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: mock.papel }, user: { id: "u-1" } }) }));

import { toast } from "sonner";
import NovoClienteRapido, { criarClienteRapido, DOMINIO_SEM_EMAIL, enviarConviteDoCliente, faltaNoClienteRapido } from "@/components/clientes/NovoClienteRapido";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";
import { ehAvulso, entraPeloPadrao, MESAS_DE_CRIACAO, montarClientesDaMesa, type ClienteBruto, type MesaDeClientes } from "@/components/mesa/clientesDaMesa";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const NOVO = "12121212-1212-4121-8121-121212121212";
const LEAD = "34343434-3434-4343-8343-343434343434";
const GANHO = "99999999-9999-4999-8999-999999999999";

const invocacoes = (funcao: string) => mock.invoke.mock.calls.filter((c) => c[0] === funcao);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.updates = [];
  mock.papel = "admin";
  (toast.success as any).mockClear();
  mock.invoke.mockImplementation((funcao: string) => {
    if (funcao === "manage-team") return Promise.resolve({ data: { user_id: NOVO }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
  window.localStorage.clear();
});

function montar(ui: any, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { qc, ...render(h(QueryClientProvider, { client: qc }, ui)) };
}

describe("criação rápida de cliente avulso", () => {
  it("pede o mínimo: nome e um contato (e-mail ou WhatsApp com DDD)", () => {
    const base = { nome: "Carla", empresa: "", email: "", whatsapp: "", leadId: null };
    expect(faltaNoClienteRapido(base)).toMatch(/e-mail ou o WhatsApp/);
    expect(faltaNoClienteRapido({ ...base, nome: "" })).toMatch(/nome/);
    expect(faltaNoClienteRapido({ ...base, email: "carla@" })).toMatch(/não parece certo/);
    expect(faltaNoClienteRapido({ ...base, whatsapp: "(41) 99999-0000" })).toBeNull();
    expect(faltaNoClienteRapido({ ...base, email: "carla@loja.com" })).toBeNull();
  });

  it("usa o caminho de hoje (manage-team + perfil), marca avulso e não manda nada ao cliente", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["clients", "u-1", "admin"], [{ id: "a", company_name: "Antigo" }]);
    const c = await criarClienteRapido({ nome: "Carla Souza", empresa: "Doces da Carla", email: "Carla@Doces.com", whatsapp: "41999990000", leadId: null }, qc);
    expect(c).toEqual({ id: NOVO, nome: "Doces da Carla", email: "carla@doces.com" });
    const criar = invocacoes("manage-team")[0][1].body;
    expect(criar).toMatchObject({ action: "create", email: "carla@doces.com", full_name: "Carla Souza", role: "client", company_name: "Doces da Carla" });
    expect(String(criar.password).length).toBeGreaterThanOrEqual(12);
    expect(mock.updates[0]).toMatchObject({ tabela: "profiles", id: NOVO, valores: { phone: "41999990000", company_name: "Doces da Carla", client_type: "one_off", services_config: {} } });
    // Nada sai sozinho: nem e-mail de boas-vindas, nem convite, nem token de acesso.
    expect(invocacoes("send-transactional-email")).toHaveLength(0);
    expect(mock.rpc).not.toHaveBeenCalled();
    // Aparece na hora na lista de clientes em cache (o seletor da mesa lê daqui).
    const lista = qc.getQueryData<any[]>(["clients", "u-1", "admin"])!;
    expect(lista.map((x) => x.id)).toEqual(["a", NOVO]);
    const naMesa = montarClientesDaMesa("site", lista as ClienteBruto[], []);
    expect(naMesa.visiveis.find((x) => x.id === NOVO)).toMatchObject({ nome: "Doces da Carla", avulso: true, naMesa: true });
  });

  it("só WhatsApp: e-mail de reserva que não recebe nada; do lead, fica Em andamento com a bandeira do lead", async () => {
    const c = await criarClienteRapido({ nome: "Beto", empresa: "", email: "", whatsapp: "41988887777", leadId: LEAD });
    expect(c.email).toBeNull();
    expect(invocacoes("manage-team")[0][1].body.email).toMatch(new RegExp(`@${DOMINIO_SEM_EMAIL.replace(/\./g, "\\.")}$`));
    expect(mock.updates[0].valores).toMatchObject({ client_type: "one_off", services_config: { lead_id: LEAD }, plan_status: "onboarding" });
    await expect(enviarConviteDoCliente({ id: NOVO, nome: "Beto", email: `x@${DOMINIO_SEM_EMAIL}` })).rejects.toThrow(/e-mail do cliente/);
  });

  it("o convite só sai no botão: gera o acesso e manda o e-mail de boas-vindas", async () => {
    mock.rpc.mockResolvedValue({ data: { token: "a".repeat(64) }, error: null });
    await enviarConviteDoCliente({ id: NOVO, nome: "Carla", empresa: "Doces", email: "carla@doces.com" });
    expect(mock.rpc).toHaveBeenCalledWith("issue_first_access_token", { p_profile_id: NOVO });
    const email = invocacoes("send-transactional-email")[0][1].body;
    expect(email).toMatchObject({ templateName: "client-welcome", recipientEmail: "carla@doces.com", idempotencyKey: `client-welcome-${NOVO}` });
    expect(email.templateData.firstAccessUrl).toContain(`primeiro-acesso?token=${"a".repeat(64)}`);
  });

  it("janela central: cria, fecha, avisa que nenhum convite foi enviado (com o botão) e abre no cliente", async () => {
    const onCriado = vi.fn();
    const onAberto = vi.fn();
    montar(h(NovoClienteRapido, { aberto: true, onAberto, onCriado }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByRole("tab", { name: "Avulso" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(janela).getByRole("button", { name: "Criar e abrir" }));
    expect(await within(janela).findByRole("alert")).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
    fireEvent.change(within(janela).getByLabelText("Nome"), { target: { value: "Carla Souza" } });
    fireEvent.change(within(janela).getByLabelText("Empresa"), { target: { value: "Doces da Carla" } });
    fireEvent.change(within(janela).getByLabelText("E-mail"), { target: { value: "carla@doces.com" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Criar e abrir" }));
    await waitFor(() => expect(onCriado).toHaveBeenCalledWith({ id: NOVO, nome: "Doces da Carla", email: "carla@doces.com" }));
    expect(onAberto).toHaveBeenCalledWith(false);
    const aviso = (toast.success as any).mock.calls.find((c: any[]) => /Nenhum convite foi enviado/.test(String(c[0])));
    expect(aviso && aviso[1].action.label).toBe("Enviar convite");
    expect(invocacoes("send-transactional-email")).toHaveLength(0);
    expect(ler("src/components/clientes/NovoClienteRapido.tsx")).toContain('import JanelaCentral from "@/components/sistema/JanelaCentral";');
  });

  it("erro do cadastro volta para a janela, com os campos como estavam", async () => {
    mock.invoke.mockResolvedValueOnce({ data: { error: "User already registered" }, error: null });
    montar(h(NovoClienteRapido, { aberto: true, onAberto: vi.fn(), onCriado: vi.fn() }));
    const janela = await screen.findByRole("dialog");
    fireEvent.change(within(janela).getByLabelText("Nome"), { target: { value: "Carla" } });
    fireEvent.change(within(janela).getByLabelText("E-mail"), { target: { value: "carla@doces.com" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Criar e abrir" }));
    expect((await within(janela).findByRole("alert")).textContent).toMatch(/já está cadastrado/);
    expect((within(janela).getByLabelText("Nome") as HTMLInputElement).value).toBe("Carla");
  });
});

// ------------------------------------------------------------------ quem aparece

const AVULSO: ClienteBruto = { id: "11111111-1111-4111-8111-111111111111", company_name: "Avulso Ltda", plan_status: "active", client_type: "one_off" };
const SEM_PLANO: ClienteBruto = { id: "22222222-2222-4222-8222-222222222222", company_name: "Sem Plano", plan_status: "inactive", client_type: "recurring" };
const DO_LEAD: ClienteBruto = { id: "33333333-3333-4333-8333-333333333333", company_name: "Do Lead", plan_status: "inactive", client_type: "recurring", plan_name: "Antigo", services_config: { lead_id: LEAD } };
const GANHO_NO_COMERCIAL: ClienteBruto = { id: GANHO, company_name: "Ganho", plan_status: "inactive", client_type: "recurring", plan_name: "Antigo" };
const MENSAL: ClienteBruto = { id: "44444444-4444-4444-8444-444444444444", company_name: "Mensal", plan_status: "active", client_type: "recurring", plan_name: "Growth", services_config: { trafego: true } };
const PAUSADO: ClienteBruto = { id: "55555555-5555-4555-8555-555555555555", company_name: "Pausado", plan_status: "standby", client_type: "recurring" };

describe("quem aparece nas mesas de criação", () => {
  it("avulso, sem plano e lead convertido sempre entram nas 8 mesas de criação; a Mesa, a Ads e a Edição não mudam", () => {
    expect(MESAS_DE_CRIACAO.slice().sort()).toEqual(["foto", "identidade", "motion", "proposta", "publicidade", "roteiros", "site", "videos"]);
    const convertidos = { [GANHO]: true as const };
    for (const mesa of MESAS_DE_CRIACAO) {
      expect(entraPeloPadrao(mesa, AVULSO).entra).toBe(true);
      expect(entraPeloPadrao(mesa, SEM_PLANO).entra).toBe(true);
      expect(entraPeloPadrao(mesa, DO_LEAD).entra).toBe(true);
      expect(entraPeloPadrao(mesa, GANHO_NO_COMERCIAL, convertidos).entra).toBe(true);
      expect(entraPeloPadrao(mesa, MENSAL).entra).toBe(true);
    }
    expect(entraPeloPadrao("foto", PAUSADO).entra).toBe(false);
    expect(entraPeloPadrao("foto", { ...AVULSO, deleted_at: "2026-09-01" }).entra).toBe(false);
    for (const mesa of ["organica", "ads", "edicao"] as MesaDeClientes[]) {
      expect(entraPeloPadrao(mesa, AVULSO).entra).toBe(false);
      expect(entraPeloPadrao(mesa, SEM_PLANO).entra).toBe(false);
      expect(entraPeloPadrao(mesa, DO_LEAD).entra).toBe(false);
    }
    expect(ehAvulso(AVULSO)).toBe(true);
    expect(ehAvulso(SEM_PLANO)).toBe(true);
    expect(ehAvulso(MENSAL)).toBe(false);
    expect(ehAvulso(PAUSADO)).toBe(false);
  });

  it("o seletor de cada mesa de criação tem Cliente avulso (admin) e marca Avulso; Mesa e Ads não têm", async () => {
    for (const mesa of MESAS_DE_CRIACAO) {
      const { unmount } = montar(h(SeletorDeClientesDaMesa, { mesa, clientesBrutos: [AVULSO, MENSAL], valor: "", nome: "", carregando: false, onEscolher: vi.fn() }));
      fireEvent.click(screen.getByRole("combobox", { name: "Escolher o cliente" }));
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
      const opcoes = screen.getAllByRole("option");
      expect(within(opcoes[0]).getByText("Avulso")).toBeTruthy();
      expect(within(opcoes[1]).queryByText("Avulso")).toBeNull();
      expect(document.querySelector(`[data-novo-cliente-avulso="${mesa}"]`)).toBeTruthy();
      unmount();
    }
    for (const mesa of ["organica", "ads"] as MesaDeClientes[]) {
      const { unmount } = montar(h(SeletorDeClientesDaMesa, { mesa, clientesBrutos: [AVULSO, MENSAL], valor: "", nome: "", carregando: false, onEscolher: vi.fn() }));
      fireEvent.click(screen.getByRole("combobox", { name: "Escolher o cliente" }));
      await screen.findAllByRole("option");
      expect(screen.queryByRole("button", { name: /Cliente avulso/ })).toBeNull();
      unmount();
    }
  });

  it("o gestor não vê o Cliente avulso (o cadastro é do admin)", async () => {
    mock.papel = "manager";
    montar(h(SeletorDeClientesDaMesa, { mesa: "site", clientesBrutos: [MENSAL], valor: "", nome: "", carregando: false, onEscolher: vi.fn() }));
    fireEvent.click(screen.getByRole("combobox", { name: "Escolher o cliente" }));
    await screen.findAllByRole("option");
    expect(screen.queryByRole("button", { name: /Cliente avulso/ })).toBeNull();
  });

  it("do seletor: Cliente avulso abre a janela central, cria e a mesa já abre no cliente novo", async () => {
    const onEscolher = vi.fn();
    montar(h(SeletorDeClientesDaMesa, { mesa: "identidade", clientesBrutos: [MENSAL], valor: "", nome: "", carregando: false, onEscolher }));
    fireEvent.click(screen.getByRole("combobox", { name: "Escolher o cliente" }));
    fireEvent.click(await screen.findByRole("button", { name: /Cliente avulso/ }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Cliente avulso na Mesa Identidade")).toBeTruthy();
    fireEvent.change(within(janela).getByLabelText("Nome"), { target: { value: "Rui" } });
    fireEvent.change(within(janela).getByLabelText("WhatsApp"), { target: { value: "41977776666" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Criar e abrir" }));
    await waitFor(() => expect(onEscolher).toHaveBeenCalledWith(NOVO));
  });

  it("as 8 mesas de criação usam o seletor comum (a peça chega a todas)", () => {
    const fontes: Record<string, string> = {
      site: "src/pages/MesaSite.tsx",
      identidade: "src/pages/MesaIdentidade.tsx",
      proposta: "src/pages/MesaProposta.tsx",
      publicidade: "src/pages/MesaPublicidade.tsx",
      roteiros: "src/pages/MesaRoteiros.tsx",
      foto: "src/pages/MesaFoto.tsx",
    };
    for (const mesa of Object.keys(fontes)) expect(ler(fontes[mesa])).toContain(`<SeletorDeClientesDaMesa mesa="${mesa}"`);
    // Vídeos e Motion pela casca de vídeo (a mesa vai no prop).
    expect(ler("src/components/mesa-videos/MesaDeVideo.tsx")).toContain("<SeletorDeClientesDaMesa mesa={mesa}");
    expect(ler("src/pages/MesaMotion.tsx")).toContain('mesa="motion"');
    expect(ler("src/pages/MesaVideos.tsx")).toContain('mesa="videos"');
  });
});
