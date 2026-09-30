import { createElement as h, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente UXS (30/09): simplificação da Mesa Motion. Regras puras (Sem prova
 * exclusiva, entrevista padrão, prova igual nas duas listas, números com
 * fonte que não somem ao ler o filme, lote das finais), o editor da cena que
 * salva sozinho (um por vez, sem desaprovar à toa), a lista de provas (Enter,
 * teto, repetida) e os contratos do servidor (desfazer da troca, do casar e
 * a cópia de desfazer que não vai para a tela nem vem dela).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia: Record<string, unknown> = {};
  ["select", "eq", "in", "order", "limit", "is", "not", "gte", "lt", "maybeSingle", "single"].forEach((k) => (cadeia[k] = () => cadeia));
  (cadeia as { then: unknown }).then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn(() => cadeia),
      storage: { from: vi.fn(() => ({ upload: vi.fn(async () => ({ error: null })) })) },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EditorDaCena from "@/components/mesa-motion/EditorDaCena";
import ListaDeProvas from "@/components/mesa-motion/ListaDeProvas";
import { deTexto, faltantesDoFilme, finaisQueFaltam, nomePadraoDoFilme, paraTexto, resumoDasFinais, textoDaTroca } from "@/components/mesa-motion/motionApi";
import { alternarOpcao, assinaturaDaCena, cenaDaLinha, duracaoAlvo, entrevistaPadrao, INGREDIENTES, lerBrand, lerEntrevista, normalizarFilme, textoDaProva, type RenderDaCena } from "../../supabase/functions/_shared/motion-metodo";
import type { ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import Renderizar from "@/components/mesa-edicao/editor/Renderizar";
import { _limparVigias, marcarRenderAtivo, pedirRender, temRenderAtivo } from "@/lib/editor/render";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const FILME = "33333333-3333-4333-8333-333333333333";
const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

const valor = {
  clientId: CLIENTE,
  clientName: "AcelerIQ",
  userId: "u1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
  versaoCarteira: 0,
  marcas: [],
  marca: null,
} as unknown as MesaValor;

function montar(no: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [`/mesa-motion?client=${CLIENTE}&filme=${FILME}`] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor }, no))));
}

const filmeCom = (cenas: unknown[], extra: Record<string, unknown> = {}) =>
  normalizarFilme({ id: FILME, client_id: CLIENTE, marca_id: null, nome: "Filme", tipo: "apresentacao", etapa: "construcao", formatos: ["9:16", "16:9"], insumos: {}, entrevista: {}, brand: { provas: [{ texto: "Nota 4,8 no Google", fonte: "print de 12/09" }] }, storyboards: [], storyboard_escolhido: null, cenas, renders: [], critica: {}, som: {}, montagem: {}, entrega: {}, ...extra })!;

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
});

describe("regras puras da Mesa Motion", () => {
  it("'Sem prova' vale sozinha: ligar tira as outras; ligar outra tira 'Sem prova'; desligar é como sempre", () => {
    const prova = INGREDIENTES.find((i) => i.chave === "prova")!;
    expect(prova.opcoes.find((o) => o.valor === "sem_prova")!.exclusiva).toBe(true);
    expect(alternarOpcao(prova, ["sem_prova"], "numeros")).toEqual(["numeros"]);
    expect(alternarOpcao(prova, ["numeros", "prints"], "sem_prova")).toEqual(["sem_prova"]);
    expect(alternarOpcao(prova, ["numeros", "prints"], "prints")).toEqual(["numeros"]);
    expect(alternarOpcao(prova, ["numeros"], "metodo")).toEqual(["numeros", "metodo"]);
    // Resposta antiga com as duas coisas não é reescrita em silêncio.
    expect(lerEntrevista({ prova: ["sem_prova", "numeros"] }).prova).toEqual(["sem_prova", "numeros"]);
  });

  it("entrevista padrão: só a forma, duração igual ao alvo do tipo e fundo escuro", () => {
    for (const tipo of ["apresentacao", "filme_marca"] as const) {
      const p = entrevistaPadrao(tipo);
      expect(Number(p.duracao)).toBe(duracaoAlvo({}, tipo));
      expect(p).toMatchObject({ logo: "sting", abertura: "titulo", transicao: "corte_na_batida", ritmo: "medio", fundo: "escuro" });
      expect(Object.keys(p).sort()).toEqual(["abertura", "duracao", "fundo", "logo", "ritmo", "transicao"]);
      expect(lerEntrevista(p)).toEqual(p);
    }
    expect(entrevistaPadrao("apresentacao").duracao).toBe("15");
    expect(entrevistaPadrao("filme_marca").duracao).toBe("45");
  });

  it("a mesma prova nas duas listas: travessão vira vírgula, espaço junta, sem maiúscula", () => {
    // O BRAND guarda a prova pelo lerBrand; a de Insumos, como foi digitada: a comparação passa as duas pela mesma regra.
    const guardada = lerBrand({ provas: [{ texto: "120 lojas — atendidas", fonte: "relatório" }] }).provas[0].texto;
    expect(textoDaProva("120 LOJAS — atendidas")).toBe(textoDaProva(guardada));
    expect(textoDaProva("  120   lojas ")).toBe("120 lojas");
  });

  it("ler o filme não tira os números que têm fonte nas provas do BRAND", () => {
    const f = filmeCom([{ id: "c1", titulo: "Nota", peca: "numeros", params: { itens: [{ valor: 4.8, rotulo: "nota", fonte: "print" }] } }]);
    expect(f.cenas[0].params.itens).toEqual([expect.objectContaining({ valor: 4.8, rotulo: "nota" })]);
    const semProva = filmeCom([{ id: "c1", titulo: "Nota", peca: "numeros", params: { itens: [{ valor: 9.9, rotulo: "nota", fonte: "print" }] } }]);
    expect(semProva.cenas[0].params.itens).toBeUndefined();
  });

  it("número no campo de texto vai e volta igual (vírgula decimal)", () => {
    for (const valor of [4.8, 1200, 12]) {
      const t = paraTexto([{ valor, rotulo: "r", fonte: "f" }], "numeros");
      expect((deTexto(t, "numeros") as Array<{ valor: number }>)[0].valor).toBe(valor);
    }
    expect(paraTexto([{ valor: 4.8, rotulo: "nota", fonte: "print" }], "numeros")).toBe("4,8;nota;print");
    expect((deTexto("1.200;lojas;relatório", "numeros") as Array<{ valor: number }>)[0].valor).toBe(1200);
  });

  it("lote das finais: só o que falta ou ficou velho, sem o que está na fila; o resumo conta cenas e formatos", () => {
    const a = cenaDaLinha({ ordem: 1, id: "a", titulo: "A", peca: "logo_sting", params: { tagline: "x" } }).cena;
    const b = cenaDaLinha({ ordem: 2, id: "b", titulo: "B", peca: "logo_sting", params: { tagline: "y" } }).cena;
    const r = (cena: typeof a, formato: "9:16" | "16:9", assinatura: string): RenderDaCena => ({ pedido_id: `${cena.id}-${formato}`, cena_id: cena.id, modo: "final", formato, assinatura, estado: "pronto", saida_path: `${CLIENTE}/x/${cena.id}.webm`, arquivo_id: null, folha_path: null, check: null, em: "2026-09-30T10:00:00Z" });
    const f = { ...filmeCom([a, b]), renders: [r(a, "9:16", assinaturaDaCena(a)), r(a, "16:9", "velha"), r(b, "9:16", assinaturaDaCena(b))] };
    const fila = { pedidos: [{ id: "p", tipo: "cena_hf", estado: "fila" as const, etapa: null, progresso: 0, entrada: { chave: "b:final:16:9" }, resultado: null, saida_path: null, erro_mensagem: null, criado_em: "" }], finais: [], links: {}, worker: { visto_em: null, situacao: "ligado" as const } };
    expect(finaisQueFaltam(f, fila).map((x) => [x.cena.id, x.formatos])).toEqual([["a", ["16:9"]]]);
    expect(finaisQueFaltam(f, fila, true).map((x) => x.cena.id)).toEqual(["a"]);
    expect(resumoDasFinais(finaisQueFaltam(f, undefined))).toBe("2 cenas × 1 formato");
    expect(resumoDasFinais([{ cena: a, numero: 1, formatos: ["9:16", "16:9"] }, { cena: b, numero: 2, formatos: ["9:16"] }])).toBe("3 renders em 2 cenas");
    expect(faltantesDoFilme(f)).toEqual([
      { numero: 1, motivo: "a cena mudou depois do render", formatos: ["16:9"] },
      { numero: 2, motivo: "sem a cena final", formatos: ["16:9"] },
    ]);
  });

  it("nome do filme novo: pelo tipo, cliente e marca, sem repetir", () => {
    expect(nomePadraoDoFilme("apresentacao", "Forno", null, [])).toBe("Apresentação Forno");
    expect(nomePadraoDoFilme("filme_marca", "Forno", "Forno Café", ["Filme da marca Forno Café"])).toBe("Filme da marca Forno Café 2");
    expect(nomePadraoDoFilme("apresentacao", "", null, [])).toBe("Apresentação em motion");
    expect(textoDaTroca({ cenas: 8, stills_aprovados: 5, sob_medida: 2 })).toBe("8 cenas, 5 stills aprovados, 2 sob medida");
  });
});

describe("editor da cena: salva sozinho, um por vez", () => {
  const cena = cenaDaLinha({ ordem: 1, id: "c1", titulo: "Marca entra", peca: "logo_sting", params: { tagline: "Método" }, duracao_s: 5, still_aprovado: true }).cena;

  it("sair do campo grava sem still_aprovado; sem mudança não chama; o que chega durante a gravação sai depois, com o mais novo", async () => {
    const filme = filmeCom([cena]);
    const respostas: Array<() => void> = [];
    mock.invoke.mockImplementation((_f: string, { body }: { body: Record<string, unknown> }) =>
      new Promise((ok) =>
        respostas.push(() => {
          const c = { ...cena, ...(body.cena as Record<string, unknown>) };
          ok({ data: { filme: { ...filme, cenas: [c] }, avisos: [] }, error: null });
        }),
      ),
    );
    montar(h(EditorDaCena, { filme, cena, prints: [] }));
    const titulo = screen.getByDisplayValue("Marca entra");
    fireEvent.blur(titulo);
    expect(mock.invoke).not.toHaveBeenCalled();
    fireEvent.change(titulo, { target: { value: "Marca chega" } });
    fireEvent.blur(titulo);
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    const corpo = mock.invoke.mock.calls[0][1].body as { acao: string; cena: Record<string, unknown> };
    expect(corpo.acao).toBe("cena_salvar");
    expect(corpo.cena).toMatchObject({ id: "c1", titulo: "Marca chega", peca: "logo_sting", modo: "kit", params: { tagline: "Método" } });
    expect("still_aprovado" in corpo.cena).toBe(false);
    // Durante a gravação: outra mudança fica pendente.
    fireEvent.change(titulo, { target: { value: "Marca chega forte" } });
    fireEvent.blur(titulo);
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    await act(async () => respostas[0]());
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(2));
    expect((mock.invoke.mock.calls[1][1].body as { cena: { titulo: string } }).cena.titulo).toBe("Marca chega forte");
    await act(async () => respostas[1]());
    await screen.findByText("Salvo");
  });

  it("trocar a peça é ação explícita; fundo e tema salvam ao escolher; imagens viram lista de marcar na ordem dos prints", async () => {
    const carrossel = cenaDaLinha({ ordem: 1, id: "c2", titulo: "Provas", peca: "carrossel_provas", params: { imagens: [`${CLIENTE}/b.png`] } }, [], CLIENTE).cena;
    const filme = filmeCom([carrossel]);
    mock.invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => ({ data: { filme: { ...filme, cenas: [{ ...carrossel, ...(body.cena as Record<string, unknown>) }] }, avisos: [] }, error: null }));
    const prints = [
      { path: `${CLIENTE}/a.png`, nome: "a.png" },
      { path: `${CLIENTE}/b.png`, nome: "b.png" },
    ];
    montar(h(EditorDaCena, { filme, cena: carrossel, prints }));
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "a.png" }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(1));
    expect((mock.invoke.mock.calls[0][1].body as { cena: { params: { imagens: string[] } } }).cena.params.imagens).toEqual([`${CLIENTE}/a.png`, `${CLIENTE}/b.png`]);
    fireEvent.change(screen.getByDisplayValue("Fundo da marca, escuro"), { target: { value: "marca:claro" } });
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(2));
    expect((mock.invoke.mock.calls[1][1].body as { cena: { tema: string } }).cena.tema).toBe("claro");
    fireEvent.change(screen.getByDisplayValue("Carrossel de provas (3D)"), { target: { value: "abertura" } });
    expect(mock.invoke).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Trocar a peça" }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(3));
    expect((mock.invoke.mock.calls[2][1].body as { cena: { peca: string; modo: string } }).cena).toMatchObject({ peca: "abertura", modo: "kit" });
  });
});

describe("lista de provas", () => {
  it("Enter põe a prova; os campos só limpam depois de salvar; repetida e teto cheio não entram", async () => {
    let ok = false;
    const onMudar = vi.fn(async () => ok);
    const { rerender } = render(h(ListaDeProvas, { provas: [{ texto: "120 lojas atendidas", fonte: "relatório" }], maximo: 2, onMudar }));
    const prova = screen.getByRole("textbox", { name: "Prova" }) as HTMLInputElement;
    const fonte = screen.getByRole("textbox", { name: "Fonte da prova" }) as HTMLInputElement;
    fireEvent.change(prova, { target: { value: "120  LOJAS atendidas " } });
    fireEvent.change(fonte, { target: { value: "site" } });
    expect(screen.getByText("Esta prova já está na lista.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Pôr a prova/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(prova, { target: { value: "Nota 4,8 no Google" } });
    fireEvent.submit(prova.closest("form") as HTMLFormElement);
    await waitFor(() => expect(onMudar).toHaveBeenCalledTimes(1));
    // Falhou: o texto fica para tentar de novo.
    expect(prova.value).toBe("Nota 4,8 no Google");
    ok = true;
    fireEvent.submit(prova.closest("form") as HTMLFormElement);
    await waitFor(() => expect(prova.value).toBe(""));
    expect(onMudar).toHaveBeenLastCalledWith([{ texto: "120 lojas atendidas", fonte: "relatório" }, { texto: "Nota 4,8 no Google", fonte: "site" }]);
    rerender(h(ListaDeProvas, { provas: [{ texto: "a", fonte: "b" }, { texto: "c", fonte: "d" }], maximo: 2, onMudar }));
    expect((screen.getByRole("textbox", { name: "Prova" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Pôr a prova/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("servidor e casca: contratos da simplificação", () => {
  const servidor = ler("supabase/functions/mesa-motion/index.ts");

  it("desfazer da troca e do casar pela cópia do servidor; a cópia não vai para a tela nem vem dela", () => {
    expect(servidor).toContain("storyboard_desfazer: storyboardDesfazer");
    expect(servidor).toContain("ritmo_desfazer: ritmoDesfazer");
    expect(servidor).toMatch(/JSON\.stringify\(body, semCopiaDeDesfazer\)/);
    expect(servidor).toMatch(/delete vindos\[CHAVE_DO_DESFAZER\]/);
    expect(servidor).toMatch(/copia\.retrato !== retratoDasCenas\(f\.cenas\)/);
    // cena_salvar sem still_aprovado: só desaprova quando a cena mudou.
    expect(servidor).toMatch(/typeof nova\.still_aprovado !== "boolean" && \(assinaturaDaCena\(r\.cena\) !== assinaturaDaCena\(antiga\) \|\| r\.cena\.titulo !== antiga\.titulo\)/);
    // filme_salvar com cenas não aceita código sob medida vindo da tela.
    expect(servidor).toMatch(/escrita: antiga \? antiga\.escrita : null/);
    // Nome padrão pelo tipo, sem repetir.
    expect(servidor).toContain('"Filme da marca" : "Apresentação em motion"');
  });

  it("piso Safari 11 / Chrome 64 e sem travessão nos arquivos desta frente", () => {
    for (const p of [
      "src/components/mesa-motion/FilmeAberto.tsx",
      "src/components/mesa-motion/EditorDaCena.tsx",
      "src/components/mesa-motion/ListaDeProvas.tsx",
      "src/components/mesa-motion/EtapaStills.tsx",
      "src/components/mesa-motion/EtapaConstrucao.tsx",
      "src/components/mesa-motion/EtapaStoryboards.tsx",
      "src/components/mesa-motion/EtapaBrand.tsx",
      "src/components/mesa-motion/EtapaInsumos.tsx",
      "src/components/mesa-motion/EtapaEntrevista.tsx",
      "src/components/mesa-motion/EtapaSom.tsx",
      "src/components/mesa-motion/EtapaCritica.tsx",
      "src/components/mesa-motion/EtapaRender.tsx",
      "src/components/mesa-motion/motionApi.ts",
      "src/components/mesa-motion/useAcoesDaCena.ts",
      "src/components/mesa-edicao/editor/Renderizar.tsx",
      "src/components/mesa-edicao/AreaDoEditor.tsx",
      "src/lib/editor/render.ts",
      "src/lib/editor/autosave.ts",
    ]) {
      const f = ler(p);
      expect(f, p).not.toMatch(/\(\?<[=!]/);
      expect(f, p).not.toMatch(/\(\?<[a-z]/i);
      expect(f, p).not.toMatch(/\\p\{/);
      expect(f, p).not.toMatch(/\.at\(/);
      expect(f, p).not.toMatch(/Object\.hasOwn\(/);
      expect(f, p).not.toMatch(/[—–]/);
      expect(f, p).not.toMatch(/aspect-ratio|aspect-\[|:has\(/);
    }
  });
});

describe("Renderizar (Mesa Edição): clique que salva antes, marca do pedido e o erro com saída", () => {
  const VERSAO = "88888888-8888-4888-8888-888888888888";
  const projeto = { duracao_s: 60, trilhas: [], fontes: {}, transcricoes: {}, ondas: {} } as unknown as ProjetoDeEdicao;
  const props = (extra: Record<string, unknown> = {}) => ({
    clientId: CLIENTE,
    versaoId: VERSAO,
    projeto,
    salvamento: "pendente" as const,
    salvarAgora: vi.fn(async () => undefined),
    estadoDoSalvamento: () => "salvo" as const,
    revisao: () => 7,
    cursor: () => 20,
    onOps: vi.fn(),
    ...extra,
  });
  const corpos = (acao: string) => mock.invoke.mock.calls.filter((c) => c[0] === "editor-video" && (c[1] as { body: { acao: string } }).body.acao === acao).map((c) => (c[1] as { body: Record<string, unknown> }).body);

  beforeEach(() => _limparVigias());

  it("'Salvando em instantes' não trava: o clique grava antes e pede com a revisão salva; em erro, não pede", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => ({ data: body.acao === "render_pedir" ? { pedido: { id: "r1", tipo: "render_final", estado: "fila", criado_em: new Date().toISOString() }, ja_existia: false } : { pedidos: [] }, error: null }));
    const p = props();
    const { unmount } = render(h(Renderizar, p));
    const botaoRender = document.querySelector("[data-botao-renderizar]") as HTMLButtonElement;
    expect(botaoRender.disabled).toBe(false);
    expect(botaoRender.getAttribute("aria-label")).toBe("Renderizar");
    fireEvent.click(botaoRender);
    await waitFor(() => expect(corpos("render_pedir")).toHaveLength(1));
    expect(p.salvarAgora).toHaveBeenCalledTimes(1);
    expect(corpos("render_pedir")[0]).toMatchObject({ tipo: "render_final", revisao: 7, versao_id: VERSAO });
    // O pedido deixou a marca: reabrir o editor lê a fila uma vez.
    expect(temRenderAtivo(VERSAO)).toBe(true);
    unmount();
    _limparVigias();
    mock.invoke.mockClear();
    const q = props({ estadoDoSalvamento: () => "erro" as const });
    render(h(Renderizar, q));
    await waitFor(() => expect(corpos("render_status")).toHaveLength(1));
    // A leitura voltou sem pedido ativo: a marca some (a próxima abertura não consulta).
    expect(temRenderAtivo(VERSAO)).toBe(false);
    fireEvent.click(document.querySelector("[data-botao-renderizar]") as HTMLButtonElement);
    await screen.findByRole("button", { name: /O render não saiu: O editor não salvou/ });
    expect(corpos("render_pedir")).toHaveLength(0);
  });

  it("em erro ou conflito o botão trava com o motivo; o 'Tentar de novo' da amostra que falhou usa a janela dela", async () => {
    const falhou = { id: "a1", tipo: "amostra", estado: "erro", etapa: null, progresso: 0, entrada: { inicio_s: 3, fim_s: 13 }, resultado: null, erro_mensagem: "O worker não achou a fonte do clipe 2.", criado_em: new Date().toISOString(), concluido_em: null, arquivo_id: null, url: null };
    mock.invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => ({ data: body.acao === "render_pedir" ? { pedido: { ...falhou, id: "a2", estado: "fila" }, ja_existia: false } : { pedidos: [falhou] }, error: null }));
    marcarRenderAtivo(VERSAO);
    const { rerender } = render(h(Renderizar, props({ salvamento: "conflito" as const })));
    const botaoRender = document.querySelector("[data-botao-renderizar]") as HTMLButtonElement;
    expect(botaoRender.disabled).toBe(true);
    expect(botaoRender.getAttribute("title")).toBe("Mudou em outro lugar: use Recarregar");
    rerender(h(Renderizar, props()));
    const etiqueta = await screen.findByRole("button", { name: /O render não saiu: O worker não achou a fonte/ });
    fireEvent.click(etiqueta);
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(corpos("render_pedir")).toHaveLength(1));
    // A janela da amostra que falhou (3 a 13 s), não a do cursor (20 s).
    expect(corpos("render_pedir")[0]).toMatchObject({ tipo: "amostra", inicio_s: 3, fim_s: 13 });
  });

  it("marca velha (mais de 24 h) não vale; o pedido do agente (pedirRender direto) também deixa a marca", async () => {
    gravarEstadoDaTela(`editor:render-ativo:${VERSAO}`, { em: Date.now() - 25 * 60 * 60 * 1000 }, "/editor");
    expect(temRenderAtivo(VERSAO)).toBe(false);
    const chamar = vi.fn(async () => ({ pedido: { id: "ag1", tipo: "render_final", estado: "fila", criado_em: new Date().toISOString() }, ja_existia: false }));
    await pedirRender(chamar, { clientId: CLIENTE, versaoId: VERSAO, tipo: "render_final", uid: "xagente001" });
    expect(temRenderAtivo(VERSAO)).toBe(true);
  });
});
