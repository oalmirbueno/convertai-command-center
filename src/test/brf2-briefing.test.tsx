import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement as h, useState } from "react";

/**
 * Frente BRF2: o briefing mais completo. Editor de modelos (versão nova,
 * condição só para pergunta de escolha que vem antes), perguntas extras por
 * projeto, painel (pendentes, vencendo, recebidos), lembrete com mensagem
 * pronta, comparação de dois briefings, "Preencher com IA" com a peça comum
 * (prévia, nada inventado, aplicar e desfazer), resposta por áudio e as
 * ligações das funções e da migração.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke }, rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/mesa/MesaContexto", () => ({
  useCatalogo: () => ({ data: [{ id: "openai:gpt-6-luna", provedor: "openai", modelo_api: "gpt-6-luna", tipo: "texto", rotulo: "GPT-6 Luna", ativo: true, padrao_para: ["briefing"], preco_entrada_1m: 1, preco_saida_1m: 4 }] }),
}));
vi.mock("@/components/mesa/Seletores", () => ({
  SeletorDeModelo: ({ valor, onChange, rotulo }: { valor: string; onChange: (v: string) => void; rotulo: string }) =>
    h("select", { "aria-label": rotulo, value: valor, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, h("option", { value: "openai:gpt-6-luna" }, "GPT-6 Luna")),
}));

import { MODELOS_DE_FABRICA, camposDoModelo, type CampoDoBriefing } from "../../supabase/functions/_shared/briefing-modelos";
import {
  chaveNova,
  compararBriefings,
  contagemDoPainel,
  extrasDoModelo,
  mensagemDeLembrete,
  modeloComExtras,
  moverItem,
  normalizarExtras,
  precisaDeLembrete,
  proximaVersao,
  situacaoNoPainel,
  validarModeloEditado,
} from "../../supabase/functions/_shared/briefing-editor";
import { camposParaIa, fontesDoMaterial, limparPreenchimento, pedidoDoPreenchimento, PARTE_DO_MATERIAL } from "../../supabase/functions/_shared/briefing-preencher";
import { custoDaTranscricao, juntarTranscricao, tipoDoAudio } from "../../supabase/functions/_shared/briefing-audio";
import EditorDeCampos from "@/components/briefing/EditorDeCampos";
import RespostaPorAudio from "@/components/briefing/RespostaPorAudio";
import PreencherBriefingComIA from "@/components/briefing/PreencherBriefingComIA";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const AGORA = new Date("2026-09-30T12:00:00Z");
const dias = (n: number) => new Date(AGORA.getTime() + n * 86_400_000).toISOString();

beforeEach(() => {
  invoke.mockReset();
});

describe("editor de modelos", () => {
  it("versão nova acima da de fábrica e das do banco", () => {
    expect(proximaVersao("site", [])).toBe(2);
    expect(proximaVersao("site", [{ slug: "site", versao: 4 }, { slug: "landing", versao: 9 }])).toBe(5);
  });

  it("condição só para pergunta de escolha que vem antes, com opção que existe (senão sai, com aviso)", () => {
    const base = MODELOS_DE_FABRICA.site;
    const bruto = JSON.parse(JSON.stringify(base));
    // Aponta para uma pergunta que vem depois: perde a condição.
    bruto.blocos[0].campos[0].mostrarSe = { key: "temSiteAtual", valor: "Sim" };
    // Pergunta sem texto sai.
    bruto.blocos[0].campos.push({ key: "vazia", tipo: "text", pergunta: "" });
    const { modelo, avisos } = validarModeloEditado(bruto, "site");
    expect(camposDoModelo(modelo)[0].mostrarSe).toBeUndefined();
    expect(avisos.join(" ")).toMatch(/perdeu a condição/);
    expect(avisos.join(" ")).toMatch(/1 pergunta saiu/);
    // As condições de fábrica (temSiteAtual -> siteAtualBom) continuam.
    expect(camposDoModelo(modelo).find((c) => c.key === "siteAtualBom")!.mostrarSe).toEqual({ key: "temSiteAtual", valor: "Sim" });
    expect(() => validarModeloEditado({ blocos: [] }, "site")).toThrow(/sem nenhuma pergunta/);
  });

  it("chave nova vem do texto, sem acento e sem repetir; mover troca a ordem", () => {
    expect(chaveNova("Qual é o horário de funcionamento?", [])).toBe("qualHorarioFuncionamento");
    expect(chaveNova("Qual é o horário de funcionamento?", ["qualHorarioFuncionamento"])).toBe("qualHorarioFuncionamento2");
    expect(chaveNova("Quantos pontos de venda", [], "extra_")).toBe("extra_QuantosPontosVenda");
    expect(moverItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moverItem(["a", "b"], 1, -3)).toEqual(["b", "a"]);
  });

  it("EditorDeCampos: setas trocam a ordem e Nova pergunta entra com chave provisória", () => {
    const campos: CampoDoBriefing[] = [
      { key: "a", tipo: "text", pergunta: "Primeira" },
      { key: "b", tipo: "single-chip", pergunta: "Segunda", opcoes: ["Sim", "Não"] },
    ];
    const mudou = vi.fn();
    render(h(EditorDeCampos, { campos, onMudar: mudou, todasAsChaves: ["a", "b"], prefixo: "extra_", rotulo: "Perguntas" }));
    fireEvent.click(screen.getByRole("button", { name: "Descer Primeira" }));
    expect(mudou.mock.calls[0][0].map((c: CampoDoBriefing) => c.key)).toEqual(["b", "a"]);
    fireEvent.click(screen.getByRole("button", { name: /Nova pergunta/ }));
    const nova = mudou.mock.calls[1][0][2] as CampoDoBriefing;
    expect(nova.key).toBe("extra_NovaPergunta");
    expect(nova.tipo).toBe("text");
  });
});

describe("perguntas extras por projeto", () => {
  it("prefixo, chave do texto no lugar da provisória, condição só entre as extras e bloco no fim do link", () => {
    const extras = normalizarExtras([
      { key: "extra_NovaPergunta", tipo: "single-chip", pergunta: "Tem loja física", opcoes: ["Sim", "Não"] },
      { key: "extra_NovaPergunta2", tipo: "text", pergunta: "Endereço da loja", mostrarSe: { key: "extra_NovaPergunta", valor: "Sim" }, alimenta: "negocio" },
      { key: "historia", tipo: "text", pergunta: "Outra história" },
      { key: "x", tipo: "single-chip", pergunta: "Sem opções", opcoes: [] },
    ]);
    expect(extras.map((c) => c.key)).toEqual(["extra_TemLojaFisica", "extra_EnderecoLoja", "extra_OutraHistoria"]);
    expect(extras[1].mostrarSe).toEqual({ key: "extra_TemLojaFisica", valor: "Sim" });
    expect(extras[1].alimenta).toBeUndefined();
    const m = modeloComExtras(MODELOS_DE_FABRICA.site, extras);
    expect(m.blocos[m.blocos.length - 1]).toMatchObject({ id: "extras", titulo: "Perguntas deste projeto" });
    expect(extrasDoModelo(m).map((c) => c.key)).toEqual(extras.map((c) => c.key));
    // Trocar as extras não duplica o bloco; sem extras, o bloco sai.
    expect(modeloComExtras(m, []).blocos.some((b) => b.id === "extras")).toBe(false);
  });
});

describe("painel e lembrete", () => {
  const link = (extra: Record<string, unknown>) => ({ submitted: false, expira_em: dias(20), created_at: dias(-1), ...extra });

  it("pendente, vencendo, recebido no mês e reabrir", () => {
    expect(situacaoNoPainel(link({}), AGORA)).toBe("pendente");
    expect(situacaoNoPainel(link({ expira_em: dias(3) }), AGORA)).toBe("vencendo");
    expect(situacaoNoPainel(link({ expira_em: dias(-1) }), AGORA)).toBe("expirado");
    expect(situacaoNoPainel(link({ submitted: true, enviado_em: dias(-2) }), AGORA)).toBe("recebido");
    expect(situacaoNoPainel(link({ submitted: true, reabertura_pedida_em: dias(-1) }), AGORA)).toBe("reabrir");
    const c = contagemDoPainel([link({}), link({ expira_em: dias(2) }), link({ submitted: true, enviado_em: dias(-5) }), link({ submitted: true, enviado_em: dias(-40) })], AGORA);
    expect(c).toMatchObject({ pendentes: 2, vencendo: 1, recebidos30: 1 });
  });

  it("lembrete: parado há dias ou vencendo; nunca dois em 3 dias; no máximo 3", () => {
    expect(precisaDeLembrete(link({}), AGORA)).toBe(false);
    expect(precisaDeLembrete(link({ created_at: dias(-4) }), AGORA)).toBe(true);
    expect(precisaDeLembrete(link({ created_at: dias(-4), rascunho_salvo_em: dias(-1) }), AGORA)).toBe(false);
    expect(precisaDeLembrete(link({ expira_em: dias(2) }), AGORA)).toBe(true);
    expect(precisaDeLembrete(link({ expira_em: dias(2), ultimo_lembrete_em: dias(-1) }), AGORA)).toBe(false);
    expect(precisaDeLembrete(link({ expira_em: dias(2), lembretes: 3 }), AGORA)).toBe(false);
    expect(precisaDeLembrete(link({ submitted: true, created_at: dias(-9) }), AGORA)).toBe(false);
  });

  it("mensagem pronta com o andamento e a validade; sem travessão e sem exclamação", () => {
    const m = mensagemDeLembrete({ cliente: "Padaria Aurora", modelo: MODELOS_DE_FABRICA.site, url: "https://app/briefing/x", expiraEm: "2026-10-10T12:00:00Z", respondidos: 9, total: 30 });
    expect(m).toContain("Olá, Padaria Aurora.");
    expect(m).toContain("9 de 30 respostas: faltam 21");
    expect(m).toContain("https://app/briefing/x");
    expect(m).toContain("O link vale até 10/10");
    expect(m).toContain("por áudio");
    expect(m).not.toMatch(/[—–!]/);
    expect(mensagemDeLembrete({ modelo: MODELOS_DE_FABRICA.site, url: "u", respondidos: 0, total: 30, grupo: true })).toContain("Olá, pessoal.");
  });

  it("comparar dois briefings: pergunta por pergunta, com o que mudou", () => {
    const m = MODELOS_DE_FABRICA.site;
    const linhas = compararBriefings(
      { modelo: m, respostas: { historia: "Padaria de bairro desde 1990", tipoDeSite: "Institucional", temSiteAtual: "Não" } },
      { modelo: modeloComExtras(m, normalizarExtras([{ key: "extra_Delivery", tipo: "text", pergunta: "Faz delivery" }])), respostas: { historia: "Padaria de bairro desde 1990", tipoDeSite: "Loja virtual", extra_Delivery: "Sim, pelo iFood" } },
    );
    const porChave = (k: string) => linhas.find((l) => l.key === k)!;
    expect(porChave("historia").igual).toBe(true);
    expect(porChave("tipoDeSite")).toMatchObject({ a: "Institucional", b: "Loja virtual", igual: false });
    expect(porChave("extra_Delivery")).toMatchObject({ a: "", b: "Sim, pelo iFood", bloco: "Perguntas deste projeto" });
    expect(linhas.some((l) => l.key === "decisor")).toBe(false);
  });
});

describe("Preencher com IA (peça comum por dentro)", () => {
  const modelo = MODELOS_DE_FABRICA.site;

  it("campos do briefing viram campos da peça comum; só os vazios, a menos que substituir", () => {
    const campos = camposParaIa(modelo, { historia: "já respondida" });
    expect(campos.some((c) => c.chave === "historia")).toBe(false);
    expect(camposParaIa(modelo, { historia: "já" }, [], true).some((c) => c.chave === "historia")).toBe(true);
    const escala = campos.find((c) => c.chave === "eixoSerio")!;
    expect(escala.tipo).toBe("numero");
    expect(escala.dica).toContain("1, 2, 3, 4 ou 5");
    expect(campos.find((c) => c.chave === "tipoDeSite")!).toMatchObject({ tipo: "escolha", opcoes: ["Institucional", "Loja virtual", "Portal de conteúdo", "Página única", "Outro"] });
    expect(campos.find((c) => c.chave === "conversoes")!.tipo).toBe("lista");
    // Arquivo e lista de materiais ficam para o cliente.
    expect(campos.some((c) => c.chave === "anexoLogo" || c.chave === "materiais")).toBe(false);
  });

  it("a reunião longa entra em partes; o pedido é o da peça comum, com o esquema estrito", () => {
    const { fontes, avisos } = fontesDoMaterial({ reuniao: "a".repeat(PARTE_DO_MATERIAL * 2 + 10), site: "Padaria Aurora, pães artesanais", contexto: "" });
    expect(fontes.filter((f) => f.rotulo.indexOf("Reunião") === 0)).toHaveLength(3);
    expect(fontes.some((f) => f.rotulo === "Site do cliente")).toBe(true);
    expect(avisos).toEqual([]);
    const campos = camposParaIa(modelo, {});
    const p = pedidoDoPreenchimento(modelo, campos, fontes);
    expect(p.sistema).toContain("Nunca invente número");
    expect(Object.keys(p.esquema.mapa).length).toBe(campos.length);
  });

  it("a resposta volta no formato do link: opções da pergunta, Outro, escala inteira; número sem fonte sai", () => {
    const campos = camposParaIa(modelo, {});
    const { fontes } = fontesDoMaterial({ reuniao: "A padaria existe desde 1990 no Batel. Quer vender pelo WhatsApp e receber encomendas. Já tem instagram." });
    const pedido = pedidoDoPreenchimento(modelo, campos, fontes);
    const k = (chave: string) => Object.keys(pedido.esquema.mapa).find((x) => pedido.esquema.mapa[x].chave === chave)!;
    const valores: Record<string, unknown> = {};
    valores[k("historia")] = "Padaria no Batel desde 1990.";
    valores[k("produtos")] = "Pães, 35 tipos de bolo";
    valores[k("tipoDeSite")] = "Institucional";
    valores[k("conversoes")] = ["WhatsApp", "Encomenda pelo site"];
    valores[k("eixoSerio")] = 4;
    valores[k("prazo")] = "outubro";
    const r = limparPreenchimento({ valores, fontes_usadas: ["Reunião"], citacoes: [], avisos: [] }, modelo, campos, pedido, fontes);
    expect(r.valores.historia).toBe("Padaria no Batel desde 1990.");
    expect(r.valores.produtos).toBeUndefined();
    expect(r.avisos.join(" ")).toContain("35");
    expect(r.valores.tipoDeSite).toBe("Institucional");
    expect(r.valores.conversoes).toEqual(["WhatsApp", "Outro"]);
    expect(r.valores.conversoes__outro).toBe("Encomenda pelo site");
    expect(r.valores.eixoSerio).toBe(4);
    expect(r.valores.prazo).toBeUndefined();
    expect(r.fontes).toContain("Reunião");
  });

  it("na tela: custo antes, prévia, aplicar só o escolhido e o Desfazer", async () => {
    invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => {
      if (body.acao === "estimar_preenchimento") return { data: { custo_usd: 0.012, campos: 20 }, error: null };
      if (body.acao === "preencher_ia") return { data: { valores: { historia: "Padaria no Batel.", tipoDeSite: "Institucional" }, fontes: ["Reunião"], avisos: ["Prazo ficou em aberto."], rotulos: { historia: "Conte a história", tipoDeSite: "Tipo de site" }, atuais: { historia: null, tipoDeSite: null }, custo_usd: 0.01, saldo_usd: 3, modelo_id: "openai:gpt-6-luna" }, error: null };
      if (body.acao === "aplicar_respostas") return { data: { aplicadas: Object.keys(body.valores as object), aviso: null }, error: null };
      return { data: {}, error: null };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mudou = vi.fn();
    render(h(QueryClientProvider, { client: qc }, h(PreencherBriefingComIA, { briefingId: "b1", temDesfazer: false, onMudou: mudou })));
    fireEvent.click(screen.getByRole("button", { name: /Preencher com IA/ }));
    fireEvent.change(screen.getByLabelText("Reunião com o cliente"), { target: { value: "A padaria fica no Batel e quer um site institucional para receber encomendas." } });
    await screen.findByText(/cerca de US\$ 0,012/);
    fireEvent.click(screen.getByRole("button", { name: /Gerar prévia/ }));
    await screen.findByText("Padaria no Batel.");
    expect(invoke).toHaveBeenCalledWith("briefing-agente", { body: expect.objectContaining({ acao: "preencher_ia", briefing_id: "b1", confirmado: true, modelo_id: "openai:gpt-6-luna" }) });
    expect(screen.getByText("Prazo ficou em aberto.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Tipo de site/));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar \(1\)/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("briefing-agente", { body: { acao: "aplicar_respostas", briefing_id: "b1", valores: { historia: "Padaria no Batel." } } }));
    await waitFor(() => expect(mudou).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Desfazer o último/ })).toBeInTheDocument();
  });
});

describe("resposta por áudio", () => {
  it("tipo, custo por minuto e junção com o que já estava escrito", () => {
    expect(tipoDoAudio("audio/webm;codecs=opus")).toEqual({ mime: "audio/webm", ext: "webm" });
    expect(tipoDoAudio("video/mp4")).toBeNull();
    expect(custoDaTranscricao(60)).toBe(0.006);
    expect(custoDaTranscricao(1)).toBeCloseTo(0.0001, 6);
    expect(juntarTranscricao("Começamos em 1990.", " hoje   temos 3 lojas ", true)).toBe("Começamos em 1990.\nhoje temos 3 lojas");
    expect(juntarTranscricao("", "oi", false)).toBe("oi");
  });

  it("sem gravador no navegador (Safari antigo), o botão não aparece", () => {
    const { container } = render(h(RespostaPorAudio, { onTranscrever: vi.fn() }));
    expect(container.textContent).toBe("");
  });

  it("grava, para e manda o áudio para transcrever; o erro fica à vista", async () => {
    class GravadorFalso {
      static isTypeSupported = (t: string) => t === "audio/webm";
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["som"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    const trilha = { stop: vi.fn() };
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = GravadorFalso;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [trilha] })) } });
    const transcrever = vi.fn(async () => {
      throw new Error("A resposta por áudio não está disponível agora.");
    });
    function Caixa() {
      const [n] = useState(0);
      return h("div", { "data-n": n }, h(RespostaPorAudio, { onTranscrever: transcrever }));
    }
    render(h(Caixa));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Responder por áudio" }));
    });
    fireEvent.click(await screen.findByRole("button", { name: "Parar e transcrever" }));
    await waitFor(() => expect(transcrever).toHaveBeenCalledTimes(1));
    const [audio, segundos] = transcrever.mock.calls[0] as unknown as [Blob, number];
    expect(audio.type).toBe("audio/webm");
    expect(segundos).toBeGreaterThan(0);
    expect(trilha.stop).toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("não está disponível");
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  });
});

describe("ligações do briefing", () => {
  it("equipe: modelos só admin, preencher com Confirmar, aplicar pelo mesmo caminho do link e exportar com Desfazer", () => {
    const editor = ler("supabase/functions/briefing-agente/editor.ts");
    expect(editor).toContain("await garantirAdmin(ch);");
    expect(editor.indexOf("await garantirAdmin(ch);")).toBeLessThan(editor.indexOf('.from("briefing_modelos")\n    .insert('));
    const preencher = ler("supabase/functions/briefing-agente/preencher.ts");
    expect(preencher).toContain('if (corpo.confirmado !== true) throw new ErroHttp(400, "confirmacao_obrigatoria"');
    expect(preencher.indexOf("garantirSaldo(")).toBeLessThan(preencher.indexOf("chamarTexto({"));
    expect(preencher).toContain("const PAPEL = \"briefing\" as const;");
    expect(preencher).toContain("salvarPeloLink(b.token, valores)");
    expect(preencher).toContain("urlPublica(");
    expect(ler("supabase/functions/briefing-agente/base.ts")).toContain('rpc("briefing_public_save"');
    const exportar = ler("supabase/functions/briefing-agente/exportar.ts");
    expect(exportar).toContain("desfazerNoContexto");
    expect(exportar).toContain('kind: "briefing"');
    const idx = ler("supabase/functions/briefing-agente/index.ts");
    ["salvar_modelo", "perguntas_extras", "registrar_lembrete", "preencher_ia", "aplicar_respostas", "desfazer_preenchimento", "exportar_contexto", "desfazer_exportacao"].forEach((a) => expect(idx).toContain(`${a}:`));
    expect(idx).toContain("modeloComExtras(modeloVigente(slug, await linhasDeModelos()), normalizarExtras(corpo.extras))");
  });

  it("link público: transcrição reserva no banco e confere chave e saldo antes de chamar o provedor; o áudio não é guardado", () => {
    const t = ler("supabase/functions/briefing-publico/transcrever.ts");
    const i = (s: string) => t.indexOf(s);
    expect(i('rpc("briefing_transcricao_reservar"')).toBeGreaterThan(0);
    expect(i('rpc("briefing_transcricao_reservar"')).toBeLessThan(i("audio/transcriptions"));
    expect(i("await garantirSaldo(clientId, estimativa);")).toBeLessThan(i("audio/transcriptions"));
    expect(t).not.toMatch(/storage\.from\(/);
    expect(t).toContain('tarefa: "briefing"');
    expect(ler("supabase/functions/briefing-publico/index.ts")).toContain('if (acao === "transcrever") return await transcrever(req, token, b, servico(), json);');
  });

  it("migração: só amplia, nada abre para anon, reserva só da service_role e o aviso diário no banco", () => {
    const sql = ler("supabase/migrations/20260930196000_briefing_evolucao.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.briefing_transcricao_reservar(text, text, numeric) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.briefing_lembretes_do_dia() TO service_role;");
    expect(sql).not.toMatch(/GRANT [^;]*TO anon/);
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM/i);
    expect(sql).toContain("'briefing-lembretes-diarios'");
  });
});
