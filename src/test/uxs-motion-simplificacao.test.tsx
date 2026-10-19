import { createElement as h, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { alternarOpcao, duracaoAlvo, entrevistaPadrao, INGREDIENTES, lerBrand, lerEntrevista, normalizarFilme, textoDaProva } from "../../supabase/functions/mesa-motion/modulos/motion-metodo";
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

});

// 19/10/2026: Mesa Motion retirada a pedido do dono; os testes da tela dela
// (editor da cena, lista de provas e as regras do motionApi) saíram com ela.
// Ficam as regras puras do servidor e os contratos da função mesa-motion.
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
    const { unmount } = render(h(MemoryRouter, null, h(Renderizar, p)));
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
    render(h(MemoryRouter, null, h(Renderizar, q)));
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
    const { rerender } = render(h(MemoryRouter, null, h(Renderizar, props({ salvamento: "conflito" as const }))));
    const botaoRender = document.querySelector("[data-botao-renderizar]") as HTMLButtonElement;
    expect(botaoRender.disabled).toBe(true);
    expect(botaoRender.getAttribute("title")).toBe("Mudou em outro lugar: use Recarregar");
    rerender(h(MemoryRouter, null, h(Renderizar, props())));
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
