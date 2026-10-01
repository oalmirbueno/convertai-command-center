import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const invocar = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invocar(...a) }, from: vi.fn(), rpc: (...a: unknown[]) => rpc(...a) } }));

import {
  ALFABETO,
  criarTratador,
  type Dependencias,
  formatarCodigo,
  gerarCodigo,
  hashDoCodigo,
  normalizarCodigo,
  semAChave,
} from "../../supabase/functions/motores-parear/modulos/pareamento";
import { MARCA_DO_SCRIPT, montarInstalador, montarInstaladorDe, paraCrlf, sha256Hex, valorSeguroParaCmd } from "@/lib/motores/instaladorDosMotores";
import { lerMaquina, type MaquinaDosMotores, relogio, segundosAte } from "@/lib/motores/maquinasDosMotores";
import MaquinasDosMotores from "@/components/config/MaquinasDosMotores";
import EstadoDosMotores from "@/components/config/EstadoDosMotores";

/**
 * Frente SUP (01/10/2026): Aceleriq Motores no painel e no servidor.
 * - função motores-parear: código de uso único, só admin gera, só HTTPS, a chave
 *   nunca em log nem numa segunda resposta;
 * - o instalador .cmd: script conferido por hash, nada secreto dentro;
 * - a tela das máquinas: situação, desatualizada, motores por máquina, instalar
 *   com o passo a passo e o código, remover com confirmação.
 * O supervisor (workers/supervisor) tem os testes dele em node:test (npm run teste).
 */

const RAIZ = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(RAIZ, p), "utf8");
const CHAVE = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.chave-de-servico-do-teste-sup";
const SEGREDO = "segredo-do-hmac-de-teste-1234567890";

function depsFalsas(extra: Partial<Dependencias> = {}) {
  const logs: string[] = [];
  const usados = new Set<string>();
  const criados: Array<Record<string, unknown>> = [];
  const d: Dependencias = {
    supabaseUrl: "https://exemplo.supabase.co",
    chaveDeServico: CHAVE,
    segredo: SEGREDO,
    rpc: async (nome, args) => {
      if (nome === "motores_pareamento_criar") {
        criados.push(args);
        return { data: { id: "p-1", expira_em: "2026-10-01T12:10:00Z", motores: args._motores }, error: null };
      }
      if (nome === "motores_pareamento_trocar") {
        const hash = String(args._hash);
        if (!criados.some((c) => c._hash === hash)) return { data: { ok: false, motivo: "codigo_invalido" }, error: null };
        if (usados.has(hash)) return { data: { ok: false, motivo: "ja_usado" }, error: null };
        usados.add(hash);
        return { data: { ok: true, maquina_id: "m-1", nome: "PC-NOVO", motores: ["navegador"] }, error: null };
      }
      return { data: null, error: { message: "rpc desconhecida" } };
    },
    quem: async (t) => (t === "admin" ? { id: "u-admin", admin: true } : t === "equipe" ? { id: "u-equipe", admin: false } : null),
    pacote: async () => ({ versao: "0123456789", sha256: "a".repeat(64), tamanho: 100, url: "https://exemplo.supabase.co/storage/v1/object/sign/motores-pacotes/x?token=t" }),
    log: (onde, dados) => void logs.push(`${onde} ${JSON.stringify(dados)}`),
    ...extra,
  };
  return { d, logs, criados };
}

const pedido = (corpo: unknown, cab: Record<string, string> = {}) =>
  new Request("https://exemplo.supabase.co/functions/v1/motores-parear", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-proto": "https", "x-forwarded-for": "200.1.2.3", ...cab }, body: JSON.stringify(corpo) });

describe("motores-parear: código de pareamento", () => {
  it("o código usa só o alfabeto sem letras ambíguas e aceita digitação solta", () => {
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigo();
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
    expect(ALFABETO).not.toMatch(/[01OIL]/);
    expect(formatarCodigo("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(normalizarCodigo(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizarCodigo("ABCD-EFG0")).toBeNull();
    expect(normalizarCodigo("ABC")).toBeNull();
  });

  it("só o admin gera; o banco recebe só o HMAC, nunca o código", async () => {
    const { d, criados } = depsFalsas();
    const t = criarTratador(d);
    expect((await t(pedido({ acao: "gerar" }))).status).toBe(401);
    expect((await t(pedido({ acao: "gerar" }, { Authorization: "Bearer equipe" }))).status).toBe(403);
    const r = await t(pedido({ acao: "gerar", nome: "Notebook", motores: ["navegador", "xpto"] }, { Authorization: "Bearer admin" }));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { codigo: string; validade_min: number };
    expect(j.codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(j.validade_min).toBe(10);
    expect(criados[0]._hash).toBe(await hashDoCodigo(SEGREDO, j.codigo.replace("-", "")));
    expect(JSON.stringify(criados)).not.toContain(j.codigo.replace("-", ""));
    expect(criados[0]._motores).toEqual(["navegador"]);
    expect(r.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("troca uma vez: a chave sai só na primeira resposta e nunca em log", async () => {
    const espiao = vi.spyOn(console, "log").mockImplementation(() => {});
    const espiaoErro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, logs } = depsFalsas();
    const t = criarTratador(d);
    const g = (await (await t(pedido({ acao: "gerar" }, { Authorization: "Bearer admin" }))).json()) as { codigo: string };
    const r1 = await t(pedido({ acao: "trocar", codigo: g.codigo.toLowerCase(), maquina: { nome: "PC", hostname: "PC-NOVO", sistema: "windows" } }));
    expect(r1.status).toBe(200);
    expect(r1.headers.get("Cache-Control")).toMatch(/no-store/);
    const j1 = (await r1.json()) as { chave_de_servico: string; maquina: { id: string }; pacote: { versao: string } };
    expect(j1.chave_de_servico).toBe(CHAVE);
    expect(j1.maquina.id).toBe("m-1");
    expect(j1.pacote.versao).toBe("0123456789");
    const r2 = await t(pedido({ acao: "trocar", codigo: g.codigo, maquina: {} }));
    expect(r2.status).toBe(404);
    const corpo2 = await r2.text();
    expect(corpo2).not.toContain(CHAVE);
    expect(corpo2).toMatch(/inválido, vencido ou já usado/);
    const tudo = [...logs, ...espiao.mock.calls.map((c) => JSON.stringify(c)), ...espiaoErro.mock.calls.map((c) => JSON.stringify(c))].join("\n");
    expect(tudo).not.toContain(CHAVE);
    espiao.mockRestore();
    espiaoErro.mockRestore();
  });

  it("recusa http, código fora do formato e respeita o limite de tentativas do banco", async () => {
    const { d } = depsFalsas({
      rpc: async (nome) => (nome === "motores_pareamento_trocar" ? { data: { ok: false, motivo: "muitas_tentativas" }, error: null } : { data: null, error: null }),
    });
    const t = criarTratador(d);
    expect((await t(pedido({ acao: "trocar", codigo: "ABCD-EFGH" }, { "x-forwarded-proto": "http" }))).status).toBe(400);
    const muitas = await t(pedido({ acao: "trocar", codigo: "ABCD-EFGH" }));
    expect(muitas.status).toBe(429);
    expect(await muitas.text()).not.toContain(CHAVE);
    const { d: d2 } = depsFalsas();
    expect((await criarTratador(d2)(pedido({ acao: "trocar", codigo: "!!" }))).status).toBe(404);
  });

  it("um erro do banco com a chave no texto não vaza para o log", async () => {
    const { d, logs } = depsFalsas({ rpc: async () => ({ data: null, error: { message: `falhou com ${CHAVE}` } }) });
    const r = await criarTratador(d)(pedido({ acao: "trocar", codigo: "ABCD-EFGH" }));
    expect(r.status).toBe(500);
    expect(logs.join("\n")).not.toContain(CHAVE);
    expect(semAChave(`x ${CHAVE} y`, CHAVE)).toBe("x [chave] y");
  });
});

describe("instalador único (.cmd)", () => {
  it("leva o script inteiro, confere o hash antes de rodar e não leva segredo", async () => {
    const script = "﻿<#\n teste #>\nparam([string]$SupabaseUrl)\nWrite-Host 'oi'\n";
    const i = await montarInstaladorDe(script, { supabaseUrl: "https://exemplo.supabase.co", chavePublica: "sb_publishable_abc123", painelUrl: "https://aceleriq.online", quando: new Date("2026-10-01T10:00:00Z") });
    expect(i.nome).toBe("instalar-aceleriq-motores.cmd");
    expect(i.conteudo.indexOf("\n")).toBe(i.conteudo.indexOf("\r\n") + 1);
    expect(i.conteudo.split("\n").every((l, n, a) => n === a.length - 1 || l.endsWith("\r"))).toBe(true);
    const corpo = i.conteudo.slice(i.conteudo.indexOf(MARCA_DO_SCRIPT) + MARCA_DO_SCRIPT.length).replace(/^(\r\n)+/, "");
    expect(corpo.startsWith("<#")).toBe(true);
    expect(await sha256Hex(corpo)).toBe(i.sha256DoScript);
    expect(i.conteudo).toContain(`set "ACELERIQ_SHA=${i.sha256DoScript}"`);
    expect(await sha256Hex(i.conteudo)).toBe(i.sha256DoArquivo);
    expect(i.conteudo).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE_KEY=/);
    expect(paraCrlf("a\nb\r\nc")).toBe("a\r\nb\r\nc");
  });

  it("recusa valor que o cmd expandiria e endereço sem HTTPS", async () => {
    expect(() => valorSeguroParaCmd("abc%PATH%", "x")).toThrow();
    expect(() => valorSeguroParaCmd('a"b', "x")).toThrow();
    await expect(montarInstaladorDe("x", { supabaseUrl: "http://exemplo.supabase.co", chavePublica: "k", painelUrl: "https://a" })).rejects.toThrow(/HTTPS/);
  });

  it("o instalador de verdade traz os quatro modos, o DPAPI e o início sem janela", async () => {
    const i = await montarInstalador({ supabaseUrl: "https://exemplo.supabase.co", chavePublica: "sb_publishable_abc123", painelUrl: "https://aceleriq.online" });
    for (const t of ["'instalar', 'migrar-desta-maquina', 'desinstalar', 'conferir'", "ProtectedData]::Protect", "DataProtectionScope]::CurrentUser", "conhost.exe", "--headless", "Get-FileHash", "OpenJS.NodeJS.LTS", "Gyan.FFmpeg", "Git.Git", "Chromium", "preparar.ts"]) {
      expect(i.conteudo, t).toContain(t);
    }
    // Nunca grava a chave em variável de ambiente nova nem em arquivo de texto.
    expect(i.conteudo).not.toMatch(/SetEnvironmentVariable\('SUPABASE_SERVICE_ROLE_KEY'/);
    expect(i.conteudo).not.toMatch(/Set-Content[^\n]*chave/i);
  });
});

describe("leitura da máquina", () => {
  const agora = Date.parse("2026-10-01T12:00:00Z");
  const base: MaquinaDosMotores = {
    id: "m-1",
    nome: "DESKTOP-3A5EAKC",
    hostname: "DESKTOP-3A5EAKC",
    sistema: "windows",
    motores: ["render", "codigo", "navegador"],
    estado: { motores: { render: { situacao: "ligado" }, codigo: { situacao: "trabalhando" }, navegador: { situacao: "ligado" } } },
    versao: "aaaaaaaaaa",
    ultimo_sinal: "2026-10-01T11:59:40Z",
    origem: "migracao",
    criada_em: "2026-10-01T10:00:00Z",
    criada_por_nome: null,
  };

  it("ligada, trabalhando, desatualizada, pausada, caindo e sem sinal", () => {
    const ok = lerMaquina(base, agora, "aaaaaaaaaa");
    expect(ok).toMatchObject({ situacao: "ok", rotulo: "Ligada", desatualizada: false });
    expect(ok.resumo).toMatch(/trabalhando: código/);
    expect(lerMaquina(base, agora, "bbbbbbbbbb").desatualizada).toBe(true);
    expect(lerMaquina({ ...base, estado: { ...base.estado, pausado: true } }, agora, null).rotulo).toBe("Pausada");
    expect(lerMaquina({ ...base, estado: { motores: { render: { situacao: "falhando" } } } }, agora, null)).toMatchObject({ situacao: "parado" });
    expect(lerMaquina({ ...base, ultimo_sinal: "2026-10-01T11:50:00Z" }, agora, null)).toMatchObject({ situacao: "parado", rotulo: "Desligada" });
    expect(lerMaquina({ ...base, ultimo_sinal: null }, agora, null).rotulo).toBe("Sem sinal");
    expect(relogio(segundosAte("2026-10-01T12:09:05Z", agora))).toBe("9:05");
  });
});

const PAINEL = {
  maquinas: [
    {
      id: "m-1",
      nome: "DESKTOP-3A5EAKC",
      hostname: "DESKTOP-3A5EAKC",
      sistema: "windows",
      motores: ["render", "codigo", "navegador"],
      estado: { motores: { render: { situacao: "ligado" }, codigo: { situacao: "trabalhando" }, navegador: { situacao: "ligado" } } },
      versao: "aaaaaaaaaa",
      ultimo_sinal: new Date().toISOString(),
      origem: "migracao",
      criada_em: new Date().toISOString(),
      criada_por_nome: null,
    },
  ],
  codigos: [],
  versao: { versao: "bbbbbbbbbb", publicada_em: new Date().toISOString() },
  auditoria: [],
};

function montarTela(no = h(MaquinasDosMotores)) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, no));
}

describe("tela das máquinas (Configurações › Estado dos motores)", () => {
  beforeEach(() => {
    rpc.mockReset();
    invocar.mockReset();
    rpc.mockImplementation(async (nome: string) => (nome === "motores_admin_painel" ? { data: PAINEL, error: null } : { data: {}, error: null }));
  });
  afterEach(() => vi.useRealTimers());

  it("lista a máquina com a situação e o aviso de desatualizada; troca motores e remove com confirmação", async () => {
    montarTela();
    const linha = await screen.findByText("DESKTOP-3A5EAKC");
    const li = linha.closest("[data-maquina]") as HTMLElement;
    expect(li.getAttribute("data-situacao")).toBe("ok");
    expect(li.getAttribute("data-desatualizada")).toBe("sim");
    expect(within(li).getByText("desatualizada")).toBeTruthy();
    fireEvent.click(within(li).getByRole("button", { expanded: false }));
    expect(await within(li).findByText(/a publicada é bbbbbbbbbb/)).toBeTruthy();
    fireEvent.click(within(li).getByRole("button", { name: /Código/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("motores_admin_maquina_motores", { _maquina: "m-1", _motores: ["render", "navegador"] }));
    fireEvent.click(within(li).getByRole("button", { name: /Remover máquina/ }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText(/Remover DESKTOP-3A5EAKC\?/)).toBeTruthy();
    fireEvent.click(within(janela).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("motores_admin_maquina_remover", { _maquina: "m-1" }));
  });

  it("Instalar: janela no centro com o passo a passo em 3 linhas, o código e a validade", async () => {
    invocar.mockResolvedValue({ data: { codigo: "ABCD-EFGH", id: "p-1", expira_em: new Date(Date.now() + 600_000).toISOString(), motores: ["navegador"] }, error: null });
    montarTela();
    fireEvent.click(await screen.findByRole("button", { name: /Instalar os motores neste computador/ }));
    const janela = await screen.findByRole("dialog");
    const passos = within(janela).getAllByRole("listitem").filter((x) => x.closest("[data-passos-do-instalador]"));
    expect(passos).toHaveLength(3);
    fireEvent.click(within(janela).getByRole("button", { name: "Render" }));
    fireEvent.click(within(janela).getByRole("button", { name: "Código" }));
    fireEvent.change(within(janela).getByLabelText(/Nome desta máquina/), { target: { value: "Notebook da Ana" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Gerar código" }));
    expect(await within(janela).findByText("ABCD-EFGH")).toBeTruthy();
    expect(invocar).toHaveBeenCalledWith("motores-parear", { body: { acao: "gerar", nome: "Notebook da Ana", motores: ["navegador"] } });
    expect(within(janela).getByText(/Vale por (10:00|9:5\d)/)).toBeTruthy();
  });

  it("só o admin vê as máquinas no Estado dos motores", async () => {
    invocar.mockResolvedValue({ data: { motores: [], geral: { parados: 0, atencao: 0, texto: "ok" }, avisos: [], conferido_em: new Date().toISOString() }, error: null });
    const { unmount } = montarTela(h(EstadoDosMotores, { semTitulo: true }));
    await screen.findByText(/conferido/);
    expect(screen.queryByText("Máquinas")).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("motores_admin_painel", undefined);
    unmount();
    montarTela(h(EstadoDosMotores, { semTitulo: true, admin: true }));
    expect(await screen.findByText("Máquinas")).toBeTruthy();
  });
});

describe("registro da frente", () => {
  it("função sem JWT do gateway (o instalador não tem sessão), migration na faixa e o publicar dos motores", () => {
    expect(ler("supabase/config.toml")).toContain("[functions.motores-parear]\n    verify_jwt = false");
    const sql = ler("supabase/migrations/20260930326000_aceleriq_motores.sql");
    for (const t of ["motores_pareamento_trocar", "motores_maquina_sinal", "ENABLE ROW LEVEL SECURITY", "'motores-pacotes', 'motores-pacotes', false"]) expect(sql).toContain(t);
    const pkg = JSON.parse(ler("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["publicar:motores"]).toContain("workers/supervisor/empacotar.ts --subir");
    expect(ler(".gitignore")).toMatch(/\.aceleriq-pacotes/);
  });
});
