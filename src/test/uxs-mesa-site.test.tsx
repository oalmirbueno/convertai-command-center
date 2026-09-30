import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * Frente UXS (30/09): a Mesa Site mais simples sem perder função. A barra da
 * etapa (Voltar, Salvar, Seguir no mesmo lugar), o horário em pílulas e em
 * português, os avisos do salvar, o SEO efetivo no checklist, as pendências
 * da barra das etapas pela mesma regra do checklist, o nome do site novo, o
 * canal ao vivo compartilhado, os pedidos ao diretor e as perguntas do
 * briefing na hora. Função falsa; nada sai para o Supabase real.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), canal: vi.fn(), tirarCanal: vi.fn(), aviso: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    channel: (...a: unknown[]) => {
      mock.canal(...a);
      return { on: function () { return this; }, subscribe: function () { return this; } };
    },
    removeChannel: (...a: unknown[]) => mock.tirarCanal(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: (...a: unknown[]) => mock.aviso(...a) } }));

import EtapaComBarra, { useBarraDaEtapa } from "@/components/mesa-site/BarraDaEtapa";
import EtapaBriefing from "@/components/mesa-site/EtapaBriefing";
import EtapaRevisao, { pedidoDaArea, pedidoDoBuild } from "@/components/mesa-site/EtapaRevisao";
import ListaDeSites, { nomePadraoDoSite } from "@/components/mesa-site/ListaDeSites";
import { rotuloDoConstruir } from "@/components/mesa-site/EtapaConstrucao";
import { faltaNaTela } from "@/components/mesa-site/EtapaPublicacao";
import { rascunhoDasIntegracoes, rascunhoDoSeo } from "@/components/mesa-site/EtapaIntegracoes";
import { horarioParaSalvar, linhasDoHorario } from "@/components/mesa-site/HorarioDoNegocio";
import { ETAPAS_COM_CONTADOR, estadoDaLinha, pendenciasDasEtapas } from "@/components/mesa-site/estadoDoSite";
import { perguntasDaTela, PERGUNTAS_DO_BRIEFING_NA_TELA } from "@/components/mesa-site/preencherDoSite";
import { useTrabalhos, type LinhaDoSite } from "@/components/mesa-site/siteApi";
import { mapaPadrao } from "../../supabase/functions/_shared/site-biblioteca";
import { ETAPAS_DO_SITE, PERGUNTAS_DO_BRIEFING_DO_SITE } from "../../supabase/functions/_shared/site-metodo";
import {
  avisosDeLigado,
  avisosDoSeo,
  checklistDeLancamento,
  horarioDoTexto,
  lerLinhaDeHorario,
  normalizarIntegracoes,
  normalizarSeo,
  seoEfetivo,
  textoDaLinhaDeHorario,
} from "../../supabase/functions/_shared/site-lancamento";

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

const site = (extra: Partial<LinhaDoSite> = {}): LinhaDoSite =>
  ({ id: SITE, client_id: CLIENTE, marca_id: null, nome: "Site do café", projeto: "site-do-cafe-33333333", etapa: "briefing", briefing: {}, referencias: [], dna: {}, direcao: {}, conteudo: {}, imagens: [], revisao: {}, publicacao: {}, modelo: null, tipo: "landing", mapa: mapaPadrao("landing"), estilo: {}, integracoes: {}, seo: {}, arquivado_em: null, atualizado_em: "2026-09-30T10:00:00Z", ...extra }) as LinhaDoSite;

function montar(filho: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

const corpos = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1].body.acao === acao).map((c: any[]) => c[1].body);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.canal.mockReset();
  mock.tirarCanal.mockReset();
  mock.aviso.mockReset();
  window.localStorage.clear();
});

describe("horário de funcionamento: pílulas, schema e português", () => {
  it("a ida e a volta não perdem nada (faixa, lista, 24:00 e fechar depois da meia-noite)", () => {
    for (const h0 of ["Mo-Fr 09:00-18:00", "Mo-We,Fr 09:00-18:00", "Mo,We,Fr 10:00-14:00", "Sa 09:00-13:00", "Mo-Su 00:00-24:00", "Fr-Sa 18:00-02:00"]) {
      const l = lerLinhaDeHorario(h0)!;
      expect(l).not.toBeNull();
      expect(textoDaLinhaDeHorario(l)).toBe(h0);
    }
    // Faixa que vira a semana volta com o mesmo sentido, em lista (a faixa só pode vir no primeiro item).
    const virada = lerLinhaDeHorario("Sa-Mo 10:00-14:00")!;
    expect(virada.dias).toEqual([true, false, false, false, false, true, true]);
    expect(textoDaLinhaDeHorario(virada)).toBe("Mo,Sa,Su 10:00-14:00");
    expect(textoDaLinhaDeHorario({ dias: [true, false, true, true, true, false, false], abre: "9", fecha: "1830" })).toBe("Mo,We,Th,Fr 09:00-18:30");
    // Sem dia ou com hora inválida, nada é inventado.
    expect(textoDaLinhaDeHorario({ dias: [false, false, false, false, false, false, false], abre: "09:00", fecha: "18:00" })).toBeNull();
    expect(textoDaLinhaDeHorario({ dias: [true, false, false, false, false, false, false], abre: "24:00", fecha: "18:00" })).toBeNull();
  });

  it("aceita o português explícito por regra fixa e recusa o ambíguo", () => {
    expect(horarioDoTexto("seg a sex 9h às 18h")).toBe("Mo-Fr 09:00-18:00");
    expect(horarioDoTexto("Segunda-feira a Sexta-feira das 8h30 às 17h")).toBe("Mo-Fr 08:30-17:00");
    expect(horarioDoTexto("sábado 9:00-13:00")).toBe("Sa 09:00-13:00");
    expect(horarioDoTexto("sab e dom 10h as 14h")).toBe("Sa-Su 10:00-14:00");
    expect(horarioDoTexto("seg, qua e sex 14h - 20h")).toBe("Mo,We,Fr 14:00-20:00");
    expect(horarioDoTexto("horário comercial")).toBeNull();
    expect(horarioDoTexto("toda hora")).toBeNull();
    expect(horarioDoTexto("seg a sex 9 às 18")).toBeNull();
    const seo = normalizarSeo({ negocio: { horario: ["seg a sex 9h às 18h", "Sa 09:00-13:00", "toda hora"] } });
    expect(seo.negocio.horario).toEqual(["Mo-Fr 09:00-18:00", "Sa 09:00-13:00"]);
  });

  it("a tela grava as pílulas e avisa a linha incompleta; linha fora do formato fica como texto e vai como está", () => {
    const linhas = linhasDoHorario(["Mo-Fr 09:00-18:00", "texto solto"]);
    expect(linhas[0].texto).toBeUndefined();
    expect(linhas[1].texto).toBe("texto solto");
    const r = horarioParaSalvar(linhas.concat([{ id: "x", dias: [false, false, false, false, false, false, false], abre: "09:00", fecha: "12:00" }]));
    expect(r.lista).toEqual(["Mo-Fr 09:00-18:00", "texto solto"]);
    expect(r.incompletas).toBe(1);
    // A máscara HH:MM pode deixar "93:0": os números valem (9:30).
    expect(horarioParaSalvar([{ id: "y", dias: [false, false, false, false, false, true, false], abre: "93:0", fecha: "12:00" }]).lista).toEqual(["Sa 09:30-12:00"]);
  });
});

describe("avisos do salvar", () => {
  it("SEO: cita o que veio no pedido e não entrou; nada sobre dado antigo", () => {
    const pedido = { negocio: { horario: ["seg 9h", "Mo-Fr 09:00-18:00"], email: "x@", telefone: "123", redes: ["http://a.com", "https://instagram.com/cafe"] } };
    const avisos = avisosDoSeo(pedido, normalizarSeo(pedido));
    expect(avisos).toEqual(['Não entrou no horário: "seg 9h".', 'E-mail do negócio inválido: "x@".', 'Telefone do negócio inválido: "123".', 'Rede sem https não entrou: "http://a.com".']);
    expect(avisosDoSeo({ titulo: "Café" }, normalizarSeo({ titulo: "Café" }))).toEqual([]);
  });

  it("integrações: pediu ligado e ficou desligado vira aviso", () => {
    const pedido = { whatsapp: { ligado: true, numero: "" }, mapa: { ligado: true, endereco: "R. A" } };
    expect(avisosDeLigado(pedido, normalizarIntegracoes(pedido))).toEqual(["O WhatsApp ficou desligado: falta um número válido.", "O mapa ficou desligado: o endereço está curto."]);
    const certo = { whatsapp: { ligado: true, numero: "41999998888" }, mapa: { ligado: true, endereco: "Rua XV, 10, Curitiba" } };
    expect(avisosDeLigado(certo, normalizarIntegracoes(certo))).toEqual([]);
  });

  it("a função mesa-site devolve os avisos no seo_salvar e no integracoes_salvar", () => {
    const f = ler("supabase/functions/mesa-site/estrutura.ts");
    expect(f).toContain("const avisos = avisosDoSeo(pedido, seo);");
    expect(f).toContain("return ctx.json({ site: r.site, avisos, aviso_versao: r.aviso_versao, custo_usd: 0 });");
    expect(f).toContain("avisos.push(...avisosDeLigado(c.integracoes, novo));");
  });
});

describe("rascunho das integrações e do SEO (nada grava sozinho)", () => {
  it("celular do negócio vira WhatsApp; fixo não; o mapa recebe o endereço com rua e cidade; nada liga", () => {
    const seo = normalizarSeo({ negocio: { telefone: "(41) 99999-8888", rua: "Rua XV, 10", bairro: "Centro", cidade: "Curitiba", estado: "PR" } });
    const r = rascunhoDasIntegracoes(normalizarIntegracoes({}), seo);
    expect(r.int.whatsapp).toMatchObject({ numero: "41999998888", ligado: false });
    expect(r.int.mapa).toMatchObject({ endereco: "Rua XV, 10, Centro, Curitiba, PR", ligado: false });
    expect(r.chaves).toEqual(["whatsapp.numero", "mapa.endereco"]);
    const fixo = rascunhoDasIntegracoes(normalizarIntegracoes({}), normalizarSeo({ negocio: { telefone: "(41) 3333-4444" } }));
    expect(fixo.int.whatsapp.numero).toBeNull();
    // O que já está salvo nunca é trocado.
    const salvo = rascunhoDasIntegracoes(normalizarIntegracoes({ whatsapp: { numero: "41988887777" } }), seo);
    expect(salvo.int.whatsapp.numero).toBe("5541988887777");
    expect(salvo.chaves).toEqual(["mapa.endereco"]);
  });

  it("SEO: título e descrição do conteúdo escolhido e o nome, só no vazio", () => {
    const r = rascunhoDoSeo(normalizarSeo({}), { titulo: "Café X", descricao: "Café torrado na hora." }, "Café X Ltda");
    expect(r.seo).toMatchObject({ titulo: "Café X", descricao: "Café torrado na hora.", negocio: { nome: "Café X Ltda" } });
    expect(r.chaves).toEqual(["seo.titulo", "seo.descricao", "seo.negocio.nome"]);
    const salvo = rascunhoDoSeo(normalizarSeo({ titulo: "Meu título" }), { titulo: "Café X", descricao: "" }, "");
    expect(salvo.seo.titulo).toBe("Meu título");
    expect(salvo.chaves).toEqual([]);
    expect(seoEfetivo(normalizarSeo({}), { titulo: "A", descricao: "B" })).toEqual({ titulo: "A", descricao: "B" });
  });
});

describe("pendências na barra das etapas", () => {
  it("o contador de cada etapa bate com os itens pendentes do checklist da mesma etapa", () => {
    // Briefing do BRF sem salvo_em, sem contato, pixel sem cookies (o normalizador liga o aviso).
    const s = site({ briefing: { fonte: "brf", briefing_id: "b-1" }, integracoes: { pixel_meta: { id: "123456789012345" }, cookies: { ligado: false } } });
    const p = pendenciasDasEtapas(s, ETAPAS_DO_SITE.map((e) => e.valor));
    const itens = checklistDeLancamento(estadoDaLinha(s));
    for (const e of ETAPAS_COM_CONTADOR) {
      const pendentes = itens.filter((i) => i.etapa === e && !i.ok && ["construido", "atualizado", "build", "qa", "logo", "dominio", "dns"].indexOf(i.id) < 0);
      expect(p.contador[e] || 0, e).toBe(pendentes.length);
    }
    expect(p.contador.briefing).toBeUndefined();
    expect(p.contador.integracoes).toBeGreaterThan(0);
    expect(p.dica.integracoes).toMatch(/Falta: .*Um jeito de falar com o cliente/);
    // O destaque vai no primeiro obrigatório pendente (o conteúdo), não no estilo nem nas imagens.
    expect(p.destaque).toBe("conteudo");
    expect(p.contador.referencias).toBeUndefined();
  });

  it("a página usa a mesma regra (sem chamada nova) e Referências leva só a dica Opcional", () => {
    const f = ler("src/pages/MesaSite.tsx");
    expect(f).toContain("pendenciasDasEtapas(site, ETAPAS_DO_SITE.map((e) => e.valor))");
    expect(f).toContain('dica: e.valor === "referencias" ? "Opcional"');
    expect(f).not.toMatch(/useTrabalhos\(/);
    expect(f).not.toMatch(/useKitDaMesa\(/);
    expect(f).not.toMatch(/publicacao_estado/);
  });
});

describe("barra da etapa", () => {
  function EtapaFalsa({ antes, motivo }: { antes?: () => Promise<boolean>; motivo?: string | null }) {
    useBarraDaEtapa({ estado: "3 de 8 respondidas", motivo: motivo || null, salvar: true }, { antesDeSeguir: antes, aoSalvar: async () => undefined });
    return h("p", null, "etapa");
  }

  it("Seguir grava antes e só troca de etapa quando deu certo; o motivo desliga e aparece", async () => {
    const irPara = vi.fn();
    const antes = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    montar(h(EtapaComBarra, { etapa: "briefing", onIrPara: irPara, children: h(EtapaFalsa, { antes }) }));
    const seguir = await screen.findByRole("button", { name: "Seguir: Referências" });
    await waitFor(() => expect(document.querySelector("[data-estado-da-etapa]")!.textContent).toBe("3 de 8 respondidas"));
    fireEvent.click(seguir);
    await waitFor(() => expect(antes).toHaveBeenCalledTimes(1));
    expect(irPara).not.toHaveBeenCalled();
    fireEvent.click(seguir);
    await waitFor(() => expect(irPara).toHaveBeenCalledWith("referencias"));
    // Primeira etapa: sem Voltar.
    expect(document.querySelector("[data-voltar-etapa]")).toBeNull();
  });

  it("com motivo, o Seguir fica desligado e o motivo fica à vista", async () => {
    montar(h(EtapaComBarra, { etapa: "direcao", onIrPara: vi.fn(), children: h(EtapaFalsa, { motivo: "Escolha um estilo ou 3 atributos" }) }));
    await waitFor(() => expect(document.querySelector("[data-estado-da-etapa]")!.textContent).toBe("Escolha um estilo ou 3 atributos"));
    expect((screen.getByRole("button", { name: "Seguir: Conteúdo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Voltar: Referências" })).toBeTruthy();
  });

  it("Publicação é a última: só o Voltar, nenhum Seguir competindo com o Publicar", () => {
    montar(h(EtapaComBarra, { etapa: "publicacao", onIrPara: vi.fn(), children: h("p", null, "publicação") }));
    expect(document.querySelector("[data-seguir-etapa]")).toBeNull();
    expect(screen.getByRole("button", { name: "Voltar: Revisão" })).toBeTruthy();
  });

  it("a barra fica fora da região que rola, e nenhuma etapa tem mais o Seguir no cabeçalho", () => {
    const pagina = ler("src/pages/MesaSite.tsx");
    expect(pagina.indexOf("<EtapaComBarra etapa={etapa} onIrPara={irPara}>")).toBeLessThan(pagina.indexOf("<RegiaoRolavel key={etapa}"));
    for (const e of ["EtapaBriefing", "EtapaDirecao", "EtapaConteudo", "EtapaImagens", "EtapaIntegracoes", "EtapaRevisao"]) {
      const f = ler(`src/components/mesa-site/${e}.tsx`);
      expect(f, e).not.toMatch(/>\s*Seguir\s*</);
      expect(f, e).toContain("useBarraDaEtapa(");
    }
  });
});

describe("briefing: as perguntas na hora", () => {
  it("uma fonte só para as perguntas; as a mais do servidor entram no fim", () => {
    expect(PERGUNTAS_DO_BRIEFING_NA_TELA.map((p) => p.id)).toEqual(PERGUNTAS_DO_BRIEFING_DO_SITE.map((p) => p.id));
    expect(ler("supabase/functions/mesa-site/index.ts")).toContain("export const PERGUNTAS_DO_BRIEFING = PERGUNTAS_DO_BRIEFING_DO_SITE.map(");
    const juntas = perguntasDaTela([{ id: "objetivo", rotulo: "Outro rótulo" }, { id: "extra", rotulo: "Pergunta nova" }]);
    expect(juntas[0]).toEqual({ id: "objetivo", rotulo: "O que o site precisa fazer acontecer" });
    expect(juntas[juntas.length - 1]).toEqual({ id: "extra", rotulo: "Pergunta nova" });
  });

  it("o formulário aparece sem esperar o servidor, e o Seguir grava com a etapa seguinte antes de trocar", async () => {
    let respondeLeitura: (v: unknown) => void = () => undefined;
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "briefing_ler") return new Promise((r) => (respondeLeitura = r));
      return Promise.resolve({ data: { site: site({ briefing: { respostas: {}, salvo_em: "2026-09-30T10:00:00Z" } }) }, error: null });
    });
    const irPara = vi.fn();
    montar(h(EtapaComBarra, { etapa: "briefing", onIrPara: irPara, children: h(EtapaBriefing, { site: site() }) }));
    // A leitura ainda não voltou: as perguntas já estão na tela, e o esqueleto só no lugar do briefing respondido.
    const objetivo = screen.getByLabelText("O que o site precisa fazer acontecer") as HTMLTextAreaElement;
    expect(document.querySelector('[aria-label="Procurando o briefing do site"]')).not.toBeNull();
    fireEvent.change(objetivo, { target: { value: "Vender mais café" } });
    fireEvent.click(await screen.findByRole("button", { name: "Seguir: Referências" }));
    await waitFor(() => expect(irPara).toHaveBeenCalledWith("referencias"));
    const salvo = corpos("mesa-site", "site_salvar")[0];
    expect(salvo).toMatchObject({ etapa: "referencias", briefing: { respostas: { objetivo: "Vender mais café" } } });
    respondeLeitura({ data: { encontrado: false, perguntas: [], respostas: {}, decupagem: null }, error: null });
    await waitFor(() => expect(screen.getByText("Sem briefing de site respondido")).toBeTruthy());
    // O que foi escrito continua lá (o formulário não remontou).
    expect((screen.getByLabelText("O que o site precisa fazer acontecer") as HTMLTextAreaElement).value).toBe("Vender mais café");
  });

  it("erro na leitura: Tentar de novo, e o formulário continua", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve(body.acao === "briefing_ler" ? { data: null, error: { message: "fora do ar" } } : { data: {}, error: null }));
    montar(h(EtapaBriefing, { site: site() }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy());
    expect(screen.getByLabelText("O que o site precisa fazer acontecer")).toBeTruthy();
  });
});

describe("site novo e arquivados", () => {
  it("nome já preenchido pelo tipo e pelo dono, sem repetir", () => {
    expect(nomePadraoDoSite("institucional", "Café", [])).toBe("Site Café");
    expect(nomePadraoDoSite("landing", "Café", [])).toMatch(/Café$/);
    expect(nomePadraoDoSite("institucional", "Café", ["Site Café", "site café 2"])).toBe("Site Café 3");
  });

  it("na tela: tipo, nome e Novo site numa linha; o nome troca com o tipo até a pessoa digitar; Arquivados só com a seta", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) =>
      Promise.resolve({ data: body.acao === "sites_listar" ? { sites: [site({ nome: "Site Café" }), site({ id: "44444444-4444-4444-8444-444444444444", nome: "Velho", arquivado_em: "2026-09-01T00:00:00Z" })] } : { site: site() }, error: null }),
    );
    montar(h(ListaDeSites, { marcaId: null, onAbrir: vi.fn() }));
    const nome = screen.getByLabelText("Nome do novo site") as HTMLInputElement;
    await waitFor(() => expect(nome.value).toBe("Site Café 2"));
    fireEvent.click(screen.getByRole("button", { name: /Tipo do site novo:/ }));
    fireEvent.click(within(await screen.findByRole("listbox", { name: "Tipo do site novo" })).getByRole("option", { name: /Portfólio/ }));
    expect(nome.value).toMatch(/^Portfólio.* Café$/);
    fireEvent.change(nome, { target: { value: "Meu site" } });
    fireEvent.click(screen.getByRole("button", { name: /Tipo do site novo:/ }));
    fireEvent.click(within(await screen.findByRole("listbox", { name: "Tipo do site novo" })).getByRole("option", { name: /Institucional/ }));
    expect(nome.value).toBe("Meu site");
    expect(screen.queryByRole("button", { name: "Ver" })).toBeNull();
    expect(screen.getByText("Arquivados")).toBeTruthy();
  });
});

describe("todo erro tem um próximo clique", () => {
  it("o pedido ao diretor leva o fim do log ou os avisos em lista", () => {
    const p = pedidoDoBuild(`${"x".repeat(2000)}ERRO FINAL`);
    expect(p).toMatch(/^O build do site falhou/);
    expect(p).toMatch(/ERRO FINAL$/);
    expect(p.length).toBeLessThan(700);
    expect(pedidoDaArea("SEO", ["Título longo", "Sem descrição"])).toBe("Ajuste o site para resolver os avisos de seo da revisão:\n- Título longo\n- Sem descrição");
  });

  it("Revisão: build com erro pede correção ao diretor; área com aviso pede ajuste", async () => {
    const trabalho = { id: "t-1", client_id: CLIENTE, tipo: "revisar", estado: "feito", resultado: { build: { ok: false, log: "vite build\nError: falta o arquivo Hero.tsx" }, qa: [{ area: "seo", texto: "Título com mais de 60 caracteres" }] }, criado_em: "2026-09-30T10:00:00Z", terminado_em: "2026-09-30T10:05:00Z" };
    mock.invoke.mockImplementation((f: string, { body }: any) =>
      Promise.resolve({ data: f === "motor-codigo" && body.acao === "listar" ? { trabalhos: [trabalho], executor: null, executor_vivo: true } : body.acao === "publicacao_estado" ? { dominio: null, estado: "sem_dominio" } : {}, error: null }),
    );
    const pedir = vi.fn();
    montar(h(EtapaRevisao, { site: site(), onIrPara: vi.fn(), onPedirAoDiretor: pedir }));
    fireEvent.click(await screen.findByRole("button", { name: /Pedir correção ao diretor/ }));
    expect(pedir.mock.calls[0][0]).toMatch(/falta o arquivo Hero\.tsx/);
    fireEvent.click(document.querySelector('[data-pedir-ajuste="seo"]') as HTMLElement);
    expect(pedir.mock.calls[1][0]).toMatch(/- Título com mais de 60 caracteres/);
  });

  it("Revisão sem nenhuma revisão ainda: o vazio leva para a Construção", async () => {
    mock.invoke.mockImplementation((f: string, { body }: any) => Promise.resolve({ data: f === "motor-codigo" && body.acao === "listar" ? { trabalhos: [], executor: null, executor_vivo: true } : {}, error: null }));
    const irPara = vi.fn();
    montar(h(EtapaRevisao, { site: site(), onIrPara: irPara }));
    fireEvent.click(await screen.findByRole("button", { name: "Ir para Construção" }));
    expect(irPara).toHaveBeenCalledWith("construcao");
  });

  it("Construção: o rótulo diz o que vai construir; Publicação traduz a chave da Vercel", () => {
    expect(rotuloDoConstruir(["hero", "faq"], ["faq", "hero"], 0.5)).toMatch(/^Construir o que falta · teto/);
    expect(rotuloDoConstruir(["hero"], ["faq", "hero"], 0.5)).toMatch(/^Construir 1 seção · teto/);
    expect(rotuloDoConstruir([], [], 0)).toBe("Tudo construído");
    expect(faltaNaTela("a conta Vercel da agência (chave VERCEL_TOKEN no cofre do servidor e no worker)")).toBe("a conta de publicação da agência");
    expect(faltaNaTela("o domínio do cliente")).toBe("o domínio do cliente");
  });

  it("a página só preenche o campo do diretor e abre a lateral (nada é enviado)", () => {
    const f = ler("src/pages/MesaSite.tsx");
    expect(f).toContain("abrirLateralDaArea();");
    expect(f).toContain("setRascunhoDoAgente((atual) =>");
    expect(f).not.toMatch(/agente_conversar/);
  });
});

describe("canal ao vivo compartilhado", () => {
  function Leitor() {
    useTrabalhos(CLIENTE, SITE);
    return null;
  }
  it("um canal por tópico; sai só quando sai o último que usa", async () => {
    mock.invoke.mockResolvedValue({ data: { trabalhos: [], executor: null, executor_vivo: false }, error: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const um = render(h(QueryClientProvider, { client: qc }, h(Leitor)));
    const dois = render(h(QueryClientProvider, { client: qc }, h(Leitor)));
    expect(mock.canal.mock.calls.filter((c: any[]) => String(c[0]).indexOf("mesa-site:motor_trabalhos:") === 0).length).toBe(1);
    um.unmount();
    expect(mock.tirarCanal).not.toHaveBeenCalled();
    dois.unmount();
    expect(mock.tirarCanal).toHaveBeenCalledTimes(1);
  });
});
