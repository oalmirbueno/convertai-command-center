import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Trilha e efeitos da campanha (22/10/2026): o pedido montado pelo tema e pelo
 * tom (sempre instrumental, sem voz), o custo antes (409 confirmar_custo sem
 * gastar), a escolha gravada em briefing.trilha (e em Arquivos), o pacote de
 * efeitos por tema e o provedor suno desligado. Servidor com banco e
 * ElevenLabs falsos; a tela com a função falsa.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import {
  PROVEDORES_DE_TRILHA,
  SEM_VOZ,
  custoDaTrilha,
  pacoteDeEfeitos,
  pedidosDaTrilha,
  provedorParaGerar,
  temaDaCampanha,
  trilhaDoBriefing,
  briefingComTrilha,
} from "../../supabase/functions/agente-calendario/modulos/trilha-da-campanha-regras";
import { acoesDaTrilha, type CampanhaDaTrilha } from "../../supabase/functions/agente-calendario/modulos/trilha-da-campanha";
import { estimarMusica } from "../../supabase/functions/mesa-motion/modulos/narracao";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import CampanhaTrilha from "@/components/mesa/CampanhaTrilha";
import { trilhaSugeridaDaCampanha } from "@/components/mesa/trilhaDaCampanhaApi";
import type { Campanha } from "@/components/mesa/mesaV4Api";

// O jsdom não tem AbortSignal.timeout (o cliente da ElevenLabs usa).
if (!(AbortSignal as unknown as { timeout?: unknown }).timeout) (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () => new AbortController().signal;

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMP = "44444444-4444-4444-4444-444444444444";
const SOM = "55555555-5555-5555-5555-555555555555";

// ------------------------------------------------------------------ regras

describe("pedido da trilha pelo tema e pelo tom", () => {
  it("Black Friday energética, sempre instrumental e sem voz, 3 opções de 30 s", () => {
    const p = pedidosDaTrilha({ nome: "Black Friday 2026", tom_da_campanha: "comercial_direto" }, { duracao: 30, opcoes: 3 });
    expect(p).toHaveLength(3);
    for (const x of p) {
      expect(x.tema).toBe("black_friday");
      expect(x.instrumental).toBe(true);
      expect(x.duracao_s).toBe(30);
      expect(x.prompt).toContain(SEM_VOZ);
      expect(x.prompt).toMatch(/no vocals/);
      expect(x.prompt).toMatch(/high-energy/);
      expect(x.prompt).toMatch(/punchy and direct/);
    }
    expect(new Set(p.map((x) => x.prompt)).size).toBe(3);
  });

  it("Natal acolhedor, Halloween misterioso com humor; o nome manda antes do tipo", () => {
    expect(pedidosDaTrilha({ nome: "Natal da Loja", tipo: "promocao" }, { opcoes: 2 })[0].prompt).toMatch(/warm cozy Christmas/);
    const hw = pedidosDaTrilha({ nome: "Noite de Halloween" }, { opcoes: 2 });
    expect(hw).toHaveLength(2);
    expect(hw[0].prompt).toMatch(/mysterious playful Halloween.*humor/);
    expect(temaDaCampanha({ nome: "Campanha de outubro", tipo: "lancamento" }).id).toBe("lancamento");
    expect(temaDaCampanha({ nome: "Feliz Páscoa" }).id).toBe("pascoa");
    expect(temaDaCampanha({ nome: "Presente para o Dia dos Pais" }).id).toBe("dia_dos_pais");
    expect(temaDaCampanha({ nome: "Sem data", tipo: null }).id).toBe("institucional");
  });

  it("duração fora da lista vira 30 s, opções entre 2 e 3, loop para Story e Reels", () => {
    const p = pedidosDaTrilha({ nome: "Black Friday" }, { duracao: 45, opcoes: 9, loop: true });
    expect(p).toHaveLength(3);
    expect(p[0].duracao_s).toBe(30);
    expect(p[0].loop).toBe(true);
    expect(p[0].prompt).toMatch(/Seamless loop for Instagram Stories and Reels/);
    expect(pedidosDaTrilha({ nome: "x" }, { opcoes: 1 })).toHaveLength(2);
    expect(pedidosDaTrilha({ nome: "x" }, { duracao: 60 })[0].duracao_s).toBe(60);
  });
});

describe("pacote de efeitos por tema", () => {
  it("Halloween: rangido, risada leve, trovão; Black Friday: caixa, swoosh, alerta de oferta", () => {
    expect(pacoteDeEfeitos({ nome: "Halloween" }).efeitos.map((e) => e.rotulo)).toEqual(["Rangido de porta", "Risada leve", "Trovão"]);
    expect(pacoteDeEfeitos({ nome: "Esquenta Black Friday" }).efeitos.map((e) => e.rotulo)).toEqual(["Caixa registradora", "Swoosh", "Alerta de oferta"]);
  });
});

describe("provedor suno desligado", () => {
  it("existe na interface, desligado, e nunca é o que gera", () => {
    expect(PROVEDORES_DE_TRILHA.suno.ligado).toBe(false);
    expect(PROVEDORES_DE_TRILHA.suno.motivo).toMatch(/API oficial/);
    expect(PROVEDORES_DE_TRILHA.elevenlabs.ligado).toBe(true);
    expect(provedorParaGerar("suno").ligado).toBe(false);
    expect(provedorParaGerar("terceiro-qualquer").id).toBe("elevenlabs");
  });
});

describe("trilha no briefing", () => {
  it("guarda { arquivo, titulo, duracao, origem } e mantém o resto do briefing", () => {
    const t = trilhaDoBriefing({ arquivo: `${CLIENTE}/campanhas/${CAMP}/sons/a.mp3`, titulo: "Natal · Opção A", duracao: 30.04, origem: "elevenlabs", som_id: SOM });
    expect(t).toMatchObject({ arquivo: `${CLIENTE}/campanhas/${CAMP}/sons/a.mp3`, titulo: "Natal · Opção A", duracao: 30, origem: "elevenlabs", som_id: SOM });
    const b = briefingComTrilha({ oferta: "10%", canais: ["Reels"] }, t);
    expect(b).toMatchObject({ oferta: "10%", canais: ["Reels"], trilha: t });
    expect(briefingComTrilha(b, null)).toEqual({ oferta: "10%", canais: ["Reels"] });
    expect(trilhaDoBriefing({ arquivo: "../fora.mp3" })).toBeNull();
    expect(trilhaSugeridaDaCampanha(b)).toMatchObject({ titulo: "Natal · Opção A", duracao: 30 });
  });
});

// ------------------------------------------------------------------ servidor

class Erro extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

function servidorFalso(campanha: CampanhaDaTrilha) {
  const reg = { inserts: [] as Array<{ tabela: string; linha: Record<string, unknown> }>, updates: [] as Array<{ tabela: string; campos: Record<string, unknown> }>, rpcs: [] as Array<{ nome: string; args: Record<string, unknown> }>, uploads: [] as string[] };
  const sons: Record<string, unknown>[] = [];
  const consulta = (tabela: string) => {
    let modo: "ler" | "inserir" | "atualizar" = "ler";
    let linha: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "is"]) b[m] = () => b;
    b.insert = (l: Record<string, unknown>) => {
      modo = "inserir";
      linha = l;
      reg.inserts.push({ tabela, linha: l });
      if (tabela === "video_arquivos") sons.push({ ...l, id: SOM, melhor: false, criado_em: "2026-10-22T12:00:00Z" });
      return b;
    };
    b.update = (c: Record<string, unknown>) => {
      modo = "atualizar";
      linha = c;
      reg.updates.push({ tabela, campos: c });
      if (tabela === "mesa_campanhas") campanha.briefing = c.briefing as Record<string, unknown>;
      return b;
    };
    const um = () => {
      if (tabela === "video_arquivos" && modo === "inserir") return { data: { id: SOM }, error: null };
      if (tabela === "mesa_campanhas" && modo === "atualizar") return { data: { ...campanha, ...linha }, error: null };
      return { data: null, error: null };
    };
    b.single = () => Promise.resolve(um());
    b.maybeSingle = () => Promise.resolve(um());
    b.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve({ data: tabela === "video_arquivos" ? sons : [], error: null }).then(ok, falha);
    return b;
  };
  const servico = {
    from: consulta,
    rpc: (nome: string, args: Record<string, unknown>) => {
      reg.rpcs.push({ nome, args });
      return Promise.resolve({ data: [{ saldo_usd: 9 }], error: null });
    },
    storage: {
      from: () => ({
        upload: (caminho: string) => {
          reg.uploads.push(caminho);
          return Promise.resolve({ data: { path: caminho }, error: null });
        },
        createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://assinado.test/${p}`, error: null })), error: null }),
        download: () => Promise.resolve({ data: { arrayBuffer: async () => new ArrayBuffer(64000) }, error: null }),
        remove: () => Promise.resolve({ error: null }),
      }),
    },
  };
  const doChamador = {
    ...servico,
    rpc: (nome: string, args: Record<string, unknown>) => {
      reg.rpcs.push({ nome, args });
      return Promise.resolve({ data: { id: "66666666-6666-6666-6666-666666666666" }, error: null });
    },
  };
  return { servico, doChamador, reg, sons };
}

function montar(campanha: CampanhaDaTrilha, fetchImpl: typeof fetch) {
  const f = servidorFalso(campanha);
  const saldo = vi.fn(async () => 10);
  const somar = vi.fn(async () => {});
  const acoes = acoesDaTrilha({
    erro: (s, c, m, e) => new Erro(s, c, m, e),
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    carregarCampanha: async () => campanha,
    exigirAcesso: async () => {},
    somarCusto: somar,
    garantirSaldo: saldo,
    lerChave: async () => "sk_teste",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clienteDoChamador: () => f.doChamador as any,
    fetchImpl,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chamar = (corpo: Record<string, unknown>) => acoes.campanhaTrilha(f.servico as any, { userId: "u-1", token: "t" }, { campanha_id: CAMP, ...corpo });
  return { ...f, chamar, saldo, somar };
}

const campanhaBase = (): CampanhaDaTrilha => ({
  id: CAMP,
  client_id: CLIENTE,
  nome: "Black Friday da Loja",
  pedido: null,
  objetivo: null,
  conceito: null,
  identidade: { tipo: "promocao" },
  briefing: { oferta: "até 40%", tom_da_campanha: "comercial_direto" },
});

describe("campanha_trilha no servidor", () => {
  it("custo antes: sem confirmado responde 409 confirmar_custo com o custo e não chama a ElevenLabs", async () => {
    const fetchImpl = vi.fn();
    const s = montar(campanhaBase(), fetchImpl as unknown as typeof fetch);
    const e = await s.chamar({ operacao: "gerar_trilha", duracao: 30, opcoes: 3 }).catch((x) => x);
    expect(e).toBeInstanceOf(Erro);
    expect(e.status).toBe(409);
    expect(e.codigo).toBe("confirmar_custo");
    expect(e.extra.custo_estimado_usd).toBeCloseTo(estimarMusica(30) * 3, 6);
    expect(custoDaTrilha(30, 3)).toBeCloseTo(estimarMusica(30) * 3, 6);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(s.saldo).not.toHaveBeenCalled();
  });

  it("confirmado: pede música instrumental sem voz, cobra na carteira e guarda na Mídia da campanha", async () => {
    const corpos: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      corpos.push({ url, ...JSON.parse(String(init.body)) });
      return new Response(new Uint8Array(480000), { status: 200 });
    });
    const s = montar(campanhaBase(), fetchImpl as unknown as typeof fetch);
    const r = await s.chamar({ operacao: "gerar_trilha", duracao: 30, opcoes: 2, confirmado: true });
    const j = await r.json();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const c of corpos) {
      expect(String(c.url)).toMatch(/\/v1\/music/);
      expect(c.force_instrumental).toBe(true);
      expect(c.music_length_ms).toBe(30000);
      expect(String(c.prompt)).toContain(SEM_VOZ);
    }
    expect(s.saldo).toHaveBeenCalledWith(CLIENTE, custoDaTrilha(30, 2));
    const usos = s.reg.rpcs.filter((x) => x.nome === "ia_registrar_uso");
    expect(usos).toHaveLength(2);
    expect(usos[0].args).toMatchObject({ _client_id: CLIENTE, _provedor: "elevenlabs", _referencia_tipo: "mesa_campanha", _referencia_id: CAMP, _chave_origem: "agencia" });
    const midia = s.reg.inserts.filter((x) => x.tabela === "video_arquivos");
    expect(midia).toHaveLength(2);
    expect(midia[0].linha).toMatchObject({ tipo: "audio", grupo: "trilha_gerada", origem: { campanha_id: CAMP, som: "trilha", tema: "black_friday" } });
    expect(String(midia[0].linha.storage_path)).toMatch(new RegExp(`^${CLIENTE}/campanhas/${CAMP}/sons/`));
    expect(j.custo_usd).toBeCloseTo(custoDaTrilha(30, 2), 6);
    expect(s.somar).toHaveBeenCalled();
  });

  it("provedor suno: 409 provedor_desligado, nada de terceiros é chamado", async () => {
    const fetchImpl = vi.fn();
    const s = montar(campanhaBase(), fetchImpl as unknown as typeof fetch);
    const e = await s.chamar({ operacao: "gerar_trilha", provedor: "suno", confirmado: true }).catch((x) => x);
    expect(e.codigo).toBe("provedor_desligado");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("efeitos do pacote do tema pela Sound Effects, com o custo antes", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(new Uint8Array(32000), { status: 200 });
    });
    const s = montar({ ...campanhaBase(), nome: "Halloween" }, fetchImpl as unknown as typeof fetch);
    const e = await s.chamar({ operacao: "gerar_efeitos" }).catch((x) => x);
    expect(e.codigo).toBe("confirmar_custo");
    await s.chamar({ operacao: "gerar_efeitos", efeitos: ["rangido", "trovao"], confirmado: true });
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => /\/v1\/sound-generation/.test(u))).toBe(true);
    expect(s.reg.inserts.filter((x) => x.tabela === "video_arquivos").map((x) => x.linha.nome)).toEqual(["Rangido de porta · Halloween", "Trovão · Halloween"]);
  });

  it("escolher grava briefing.trilha, mantém o briefing e manda o MP3 para Arquivos do cliente", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(480000), { status: 200 }));
    const c = campanhaBase();
    const s = montar(c, fetchImpl as unknown as typeof fetch);
    await s.chamar({ operacao: "gerar_trilha", duracao: 30, opcoes: 2, confirmado: true });
    const r = await s.chamar({ operacao: "escolher", som_id: SOM });
    const j = await r.json();
    expect(j.trilha).toMatchObject({ arquivo: expect.stringMatching(new RegExp(`^${CLIENTE}/campanhas/${CAMP}/sons/`)), origem: "elevenlabs", som_id: SOM });
    expect(j.trilha.titulo).toMatch(/Black Friday/);
    expect(j.trilha.duracao).toBeGreaterThan(0);
    const gravado = s.reg.updates.find((u) => u.tabela === "mesa_campanhas");
    expect(gravado && gravado.campos.briefing).toMatchObject({ oferta: "até 40%", tom_da_campanha: "comercial_direto", trilha: { som_id: SOM } });
    const arquivo = s.reg.rpcs.find((x) => x.nome === "create_file_record");
    expect(arquivo && (arquivo.args.p_file as Record<string, unknown>)).toMatchObject({ client_id: CLIENTE, folder: "criativos", mime_type: "audio/mpeg", tags: expect.arrayContaining([`campanha:${CAMP}`, "trilha"]) });
    expect(j.trilha.file_id).toBe("66666666-6666-6666-6666-666666666666");
  });
});

// ------------------------------------------------------------------ tela

const valorDaMesa = (): MesaValor =>
  ({
    clientId: CLIENTE,
    clientName: "Cliente sintético",
    userId: "u-1",
    isAdmin: true,
    podeRecarregar: true,
    saldoUsd: 50,
    catalogo: [],
    catalogoCarregando: false,
    atualizarCusto: vi.fn(),
    abrirRecarga: vi.fn(),
    abrirChaves: vi.fn(),
    abrirModelos: vi.fn(),
  }) as unknown as MesaValor;

const campanhaDaTela = { id: CAMP, client_id: CLIENTE, nome: "Black Friday", briefing: {} } as unknown as Campanha;

const estado = {
  tem_chave: true,
  aviso_chave: null,
  provedores: [PROVEDORES_DE_TRILHA.elevenlabs, PROVEDORES_DE_TRILHA.suno],
  tema: { id: "black_friday", rotulo: "Black Friday" },
  temas: [{ id: "black_friday", rotulo: "Black Friday" }, { id: "natal", rotulo: "Natal" }],
  pacote: [{ id: "caixa", rotulo: "Caixa registradora", duracao_s: 1.5 }],
  custos: { trilha: { "15": 0.0375, "30": 0.075, "60": 0.15 }, efeito: 0.02 },
  sons: [],
  escolhida: null,
};

describe("tela da trilha da campanha", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
  });

  it("Gerar mostra o custo para confirmar e só gera com confirmado", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    mock.invoke.mockImplementation(async (_f: string, o?: { body: Record<string, unknown> }) => {
      if (!o) throw new Error(`invoke sem corpo: ${_f}`);
      bodies.push(o.body);
      if (o.body.operacao === "estado") return { data: estado, error: null };
      if (o.body.operacao === "gerar_trilha" && !o.body.confirmado) return { data: { error: "confirmar_custo", mensagem: "Três trilhas de 30 s custa cerca de US$ 0,23. Confirme para continuar.", custo_estimado_usd: 0.225 }, error: null };
      return {
        data: { sons: [{ id: SOM, tipo: "trilha", titulo: "Black Friday · Opção A · 30 s", duracao_s: 30, favorito: false, loop: false, tema: "black_friday", caminho: "x", link: "https://assinado.test/a.mp3", escolhida: false, criado_em: "" }], avisos: [], custo_usd: 0.225 },
        error: null,
      };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa(), children: h(CampanhaTrilha, { campanha: campanhaDaTela }) })));
    fireEvent.click(await screen.findByRole("button", { name: /Gerar trilhas/ }));
    const confirmar = await screen.findByRole("button", { name: /Confirmar US\$/ });
    expect(bodies.filter((b) => b.operacao === "gerar_trilha")).toHaveLength(1);
    fireEvent.click(confirmar);
    await screen.findByText("Black Friday · Opção A · 30 s");
    const ultima = bodies.filter((b) => b.operacao === "gerar_trilha").pop()!;
    expect(ultima).toMatchObject({ acao: "campanha_trilha", confirmado: true, duracao: 30, opcoes: 3, campanha_id: CAMP });
    expect(screen.getByRole("button", { name: /Usar .* como trilha da campanha/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Baixar .* em MP3/ }).getAttribute("href")).toMatch(/download=/);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Confirmar US\$/ })).toBeNull());
  });
});
