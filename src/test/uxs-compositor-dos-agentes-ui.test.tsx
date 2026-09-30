import { createElement as h, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente UXS (30/09), o pé da conversa dos agentes das mesas novas: o modelo
 * num chip no rodapé (com o custo por mensagem, também no Contratos, que vive
 * fora da Mesa), "Nova conversa" em ícone com "Voltar à anterior", atalho que
 * põe o foco e o cursor no fim do campo (pelo chip e pelo "..."), a lista do
 * que o agente faz no "?", o envio só de anexo no Site com o aviso do limite
 * de 6 e o campo que nasce com 1 linha no celular.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      channel: () => {
        const canal: any = { on: () => canal, subscribe: () => canal };
        return canal;
      },
      removeChannel: () => Promise.resolve(),
      storage: { from: () => ({ upload: mock.upload, createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/a.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }) }));
// Seletor de modelo como select nativo (o Radix Select não abre no jsdom).
vi.mock("@/components/mesa/Seletores", async () => {
  const real = await vi.importActual<any>("@/components/mesa/Seletores");
  return {
    ...real,
    SeletorDeModelo: ({ catalogo, tipo, valor, onChange, rotulo }: any) =>
      h(
        "select",
        { "aria-label": rotulo, value: valor, onChange: (e: any) => onChange(e.target.value) },
        catalogo.filter((m: any) => m.tipo === tipo && m.ativo).map((m: any) => h("option", { key: m.id, value: m.id }, m.rotulo)),
      ),
  };
});

import { toast } from "sonner";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AgenteDeContratos from "@/components/contratos/AgenteDeContratos";
import AgenteDoSite from "@/components/mesa-site/AgenteDoSite";
import AgenteDiretorDeMarca from "@/components/mesa-identidade/AgenteDiretorDeMarca";
import AgenteDaProposta from "@/components/mesa-proposta/AgenteDaProposta";
import CampoDoAgente from "@/components/sistema/CampoDoAgente";
import type { ModeloIa } from "@/lib/mesa/api";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const SITE = "55555555-5555-4555-8555-555555555555";

const modelo = (id: string, rotulo: string, padrao: string[] = []): ModeloIa => ({
  id,
  provedor: id.split(":")[0],
  modelo_api: id.split(":")[1],
  tipo: "texto",
  rotulo,
  preco_entrada_1m: 1,
  preco_saida_1m: 4,
  preco_cache_1m: null,
  preco_imagem: null,
  raciocinio: [],
  padrao_para: padrao,
  ativo: true,
});

const catalogo: ModeloIa[] = [modelo("openai:gpt-texto", "GPT Texto", ["estrategista", "contrato", "identidade", "site", "proposta"]), modelo("anthropic:claude", "Claude")];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

const corpos = (funcao: string, acao: string) =>
  mock.invoke.mock.calls.filter((c) => c[0] === funcao && c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

const naQuery = (filho: any) => h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, filho);
const naMesa = (filho: any) => naQuery(h(MesaProvider, { valor: valorDaMesa() }, filho));

let respostaDaConversa = 0;
beforeAll(() => {
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
});
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  respostaDaConversa = 0;
  mock.tabelas = { ia_modelos: catalogo };
  mock.upload.mockResolvedValue({ data: {}, error: null });
  mock.invoke.mockImplementation(async (funcao: string, { body }: any) => {
    if (funcao === "motor-codigo") return { data: { trabalhos: [], executor: null, executor_vivo: false }, error: null };
    if (body.acao === "agente_historico") return { data: { mensagens: [], conversa_id: null }, error: null };
    if (body.acao === "agente_conversar") {
      respostaDaConversa += 1;
      return { data: { resposta: `Resposta ${respostaDaConversa}`, mensagem_id: `m${respostaDaConversa}`, conversa_id: "c-1", anexos: [], custo_usd: 0.01 }, error: null };
    }
    return { data: {}, error: null };
  });
});
afterEach(() => {
  window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as any;
});

const campoDe = (rotulo: string) => screen.getByRole("textbox", { name: rotulo }) as HTMLTextAreaElement;
const cursorNoFim = (el: HTMLTextAreaElement) => document.activeElement === el && el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

describe("agente de contratos (fora da Mesa): modelo no rodapé, Nova conversa com volta, atalhos e o \"?\"", () => {
  const montar = () => render(naQuery(h(AgenteDeContratos, { clientId: CLIENTE, contratoId: null, aoAbrirContrato: vi.fn() })));

  it("o seletor sai do topo e vira o chip com o custo por mensagem; a troca vai na conversa e o Voltar ao padrão desfaz", async () => {
    montar();
    const chip = await screen.findByRole("button", { name: "Modelo do agente" });
    await waitFor(() => expect(chip.textContent).toContain("GPT Texto"));
    expect(chip.textContent).toContain("~US$");
    expect(chip.textContent).toContain("padrão");
    // Nenhum seletor fixo no topo: só o do chip, que abre sob demanda.
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(chip);
    fireEvent.change(await screen.findByRole("combobox", { name: "Modelo" }), { target: { value: "anthropic:claude" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Modelo do agente" }).textContent).toContain("Claude"));
    expect(screen.getByRole("button", { name: "Modelo do agente" }).textContent).not.toContain("padrão");
    fireEvent.change(campoDe("Mensagem ao agente de contratos"), { target: { value: "Contrato de site" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    await waitFor(() => expect(corpos("contratos", "agente_conversar").length).toBe(1));
    expect(corpos("contratos", "agente_conversar")[0].modelo_id).toBe("anthropic:claude");
    // O popover do chip ainda aberto: "Voltar ao padrão" fecha e volta ao padrão do papel.
    fireEvent.click(await screen.findByRole("button", { name: "Voltar ao padrão" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Modelo do agente" }).textContent).toContain("padrão"));
  });

  it("Nova conversa é um ícone; o aviso traz Voltar à anterior, que devolve as mensagens e o id da conversa", async () => {
    montar();
    fireEvent.change(await screen.findByRole("textbox", { name: "Mensagem ao agente de contratos" }), { target: { value: "Primeiro pedido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    expect(await screen.findByText("Resposta 1")).toBeTruthy();
    const nova = screen.getByRole("button", { name: "Nova conversa" });
    expect(nova.textContent).toBe("");
    fireEvent.click(nova);
    expect(screen.queryByText("Resposta 1")).toBeNull();
    const aviso = (toast.info as any).mock.calls.find((c: any[]) => c[0] === "Conversa nova");
    expect(aviso[1].action.label).toBe("Voltar à anterior");
    act(() => aviso[1].action.onClick());
    expect(await screen.findByText("Resposta 1")).toBeTruthy();
    fireEvent.change(campoDe("Mensagem ao agente de contratos"), { target: { value: "Segundo pedido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    await waitFor(() => expect(corpos("contratos", "agente_conversar").length).toBe(2));
    const segundo = corpos("contratos", "agente_conversar")[1];
    expect(segundo.conversa_id).toBe("c-1");
    expect(segundo.nova_conversa).toBeUndefined();
  });

  it("depois de mandar na conversa nova, Voltar à anterior não faz nada (a cópia vale só enquanto nada novo foi enviado)", async () => {
    montar();
    fireEvent.change(await screen.findByRole("textbox", { name: "Mensagem ao agente de contratos" }), { target: { value: "Primeiro pedido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    expect(await screen.findByText("Resposta 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nova conversa" }));
    const aviso = (toast.info as any).mock.calls.find((c: any[]) => c[0] === "Conversa nova");
    fireEvent.change(campoDe("Mensagem ao agente de contratos"), { target: { value: "Outro assunto" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));
    expect(await screen.findByText("Resposta 2")).toBeTruthy();
    expect(corpos("contratos", "agente_conversar")[1].nova_conversa).toBe(true);
    act(() => aviso[1].action.onClick());
    expect(screen.queryByText("Resposta 1")).toBeNull();
    expect(screen.getByText("Resposta 2")).toBeTruthy();
  });

  it("atalho pelo chip e pelo \"...\": preenche, dá foco e põe o cursor no fim (o do CNPJ espera o número)", async () => {
    montar();
    const campo = await screen.findByRole("textbox", { name: "Mensagem ao agente de contratos" });
    fireEvent.click(screen.getByRole("button", { name: "O que falta?" }));
    await waitFor(() => expect(cursorNoFim(campo as HTMLTextAreaElement)).toBe(true));
    expect((campo as HTMLTextAreaElement).value).toBe("O que falta para assinar este contrato?"); // CON-12: "Assinar pela agência" no lugar de "congelar"
    (campo as HTMLTextAreaElement).blur();
    // "Puxar pelo CNPJ" é o 5º atalho: mora no "...".
    expect(screen.queryByRole("button", { name: "Puxar pelo CNPJ" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Mais atalhos" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Puxar pelo CNPJ" }));
    await waitFor(() => expect(cursorNoFim(campoDe("Mensagem ao agente de contratos"))).toBe(true));
    expect(campoDe("Mensagem ao agente de contratos").value).toBe("Puxa os dados do cliente pelo CNPJ ");
  });

  it("a lista do que o agente faz mora no \"?\" do cabeçalho (a linha Posso sai do compositor)", async () => {
    montar();
    await screen.findByRole("textbox", { name: "Mensagem ao agente de contratos" });
    expect(screen.queryByText(/Posso:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Como o agente de contratos funciona" }));
    expect(await screen.findByText("puxar os dados do cliente pelo CNPJ (Receita)")).toBeTruthy();
  });
});

describe("diretor de site: só o anexo também vai; o limite de 6 avisa", () => {
  function Casca() {
    const [rascunho, setRascunho] = useState("");
    return h(AgenteDoSite, { site: { id: SITE, nome: "Site da Joana" } as any, rascunho, onRascunho: setRascunho, onIrPara: vi.fn() });
  }

  it("oito prints: seis sobem e o aviso diz que 2 ficaram de fora; mandar só os anexos vai com o texto padrão e os nomes no balão", async () => {
    render(naMesa(h(Casca)));
    const enviar = await screen.findByRole("button", { name: "Enviar ao diretor de site" });
    expect((enviar as HTMLButtonElement).disabled).toBe(true);
    const arquivos = Array.from({ length: 8 }, (_, i) => new File(["x"], `print-${i + 1}.png`, { type: "image/png" }));
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: arquivos } });
    expect(toast.message).toHaveBeenCalledWith("Até 6 anexos por mensagem: 2 ficaram de fora.");
    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(6));
    await waitFor(() => expect((screen.getByRole("button", { name: "Enviar ao diretor de site" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao diretor de site" }));
    await waitFor(() => expect(corpos("mesa-site", "agente_conversar").length).toBe(1));
    const corpo = corpos("mesa-site", "agente_conversar")[0];
    expect(corpo.mensagem).toBe("Veja as referências anexas.");
    expect(corpo.anexos.length).toBe(6);
    expect(corpo.modelo_id).toBeUndefined();
    expect(await screen.findByText(/print-1\.png, print-2\.png/)).toBeTruthy();
  });
});

describe("diretor de marca: o modelo do agente numa chave só dele", () => {
  function Casca() {
    const [rascunho, setRascunho] = useState("");
    return h(AgenteDiretorDeMarca, { projetoId: null, rascunho, onRascunho: setRascunho });
  }

  it("sem escolha a conversa vai sem modelo (a função usa o padrão do papel); escolhido no chip, vai o escolhido", async () => {
    render(naMesa(h(Casca)));
    const chip = await screen.findByRole("button", { name: "Modelo do agente" });
    expect(chip.textContent).toContain("GPT Texto");
    expect(chip.textContent).toContain("padrão");
    fireEvent.change(campoDe("Mensagem ao diretor de marca"), { target: { value: "O que falta?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao diretor de marca" }));
    await waitFor(() => expect(corpos("mesa-identidade", "agente_conversar").length).toBe(1));
    expect("modelo_id" in corpos("mesa-identidade", "agente_conversar")[0] && corpos("mesa-identidade", "agente_conversar")[0].modelo_id !== undefined).toBe(false);
    await screen.findByText("Resposta 1");
    fireEvent.click(screen.getByRole("button", { name: "Modelo do agente" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Modelo" }), { target: { value: "anthropic:claude" } });
    fireEvent.change(campoDe("Mensagem ao diretor de marca"), { target: { value: "E agora?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao diretor de marca" }));
    await waitFor(() => expect(corpos("mesa-identidade", "agente_conversar").length).toBe(2));
    expect(corpos("mesa-identidade", "agente_conversar")[1].modelo_id).toBe("anthropic:claude");
    // A chave das etapas da Identidade fica intocada.
    expect(Object.keys(window.localStorage).some((k) => k.indexOf("mesa-identidade:modelo:identidade") >= 0)).toBe(false);
  });
});

describe("estrategista comercial: o chip usa o mesmo estado da etapa Rascunho (da página)", () => {
  function Casca() {
    const [rascunho, setRascunho] = useState("");
    const [escolhido, setEscolhido] = useState("");
    const modeloId = escolhido || "openai:gpt-texto";
    return h("div", null, h("output", { "aria-label": "Modelo da página" }, escolhido), h(AgenteDaProposta, { propostaId: null, modeloId, modeloEscolhido: escolhido, onModelo: setEscolhido, rascunho, onRascunho: setRascunho }));
  }

  it("trocar no chip muda o modelo da página e o próximo envio já vai com ele", async () => {
    render(naMesa(h(Casca)));
    const chip = await screen.findByRole("button", { name: "Modelo do agente" });
    expect(chip.textContent).toContain("padrão");
    fireEvent.click(chip);
    fireEvent.change(await screen.findByRole("combobox", { name: "Modelo" }), { target: { value: "anthropic:claude" } });
    expect(screen.getByLabelText("Modelo da página").textContent).toBe("anthropic:claude");
    fireEvent.change(campoDe("Mensagem ao estrategista"), { target: { value: "Escreva a proposta" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao estrategista" }));
    await waitFor(() => expect(corpos("mesa-proposta", "agente_conversar").length).toBe(1));
    expect(corpos("mesa-proposta", "agente_conversar")[0].modelo_id).toBe("anthropic:claude");
  });
});

describe("campo do agente", () => {
  function Campo({ aoEnviar }: { aoEnviar: () => void }) {
    const [v, setV] = useState("");
    const ref = useRef<HTMLTextAreaElement | null>(null);
    return h(CampoDoAgente, { ref, valor: v, aoMudar: setV, aoEnviar, "aria-label": "Mensagem" });
  }

  it("no computador: 2 linhas; Enter envia e Shift+Enter não", () => {
    const aoEnviar = vi.fn();
    render(h(Campo, { aoEnviar }));
    const campo = campoDe("Mensagem");
    expect(campo.rows).toBe(2);
    expect(campo.className).toContain("min-h-[60px]");
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true });
    expect(aoEnviar).not.toHaveBeenCalled();
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(aoEnviar).toHaveBeenCalledTimes(1);
  });

  it("no celular (abaixo de 768 px): nasce com 1 linha", () => {
    window.matchMedia = (query: string) => ({ matches: query.indexOf("max-width") >= 0, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as any;
    render(h(Campo, { aoEnviar: vi.fn() }));
    const campo = campoDe("Mensagem");
    expect(campo.rows).toBe(1);
    expect(campo.className).not.toContain("min-h-[60px]");
  });
});
