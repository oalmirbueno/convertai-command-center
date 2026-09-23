import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { useState } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoria de defeitos da Mesa (23/09, noite). Cada bloco prova uma
 * correção: o comportamento quando dá para montar, o texto da fonte quando a
 * peça depende da tela inteira.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn(), subir: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: mock.from, storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/mesa/mesaV4Api", async (original) => ({
  ...(await original<typeof import("@/components/mesa/mesaV4Api")>()),
  subirAnexo: mock.subir,
}));

import { chavePersistivel } from "@/lib/mesa/cachePersistido";
import { Ditado } from "@/components/mesa/Ditado";
import { useAnexos } from "@/components/mesa/AnexosDoPedido";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { marcarPedidoDaCampanha, pedidoDaCampanha, usePedidoDaCampanha } from "@/components/mesa/campanhasApi";
import { resumoDaSincronizacao } from "@/components/mesa/ModelosDeIa";
import { artePronta } from "@/components/mesa/AbaEntrega";
import { indiceNoAmpliar } from "@/components/mesa/EstudioArteDaAgenda";
import { papelNaTela } from "@/components/mesa/ContextoMarca";
import { ROTULO_DO_PAPEL } from "@/components/mesa/ContextoPaleta";
import { MAX_ORGANIZAR_POR_VEZ } from "@/components/mesa/ContextoImagens";
import { TooltipProvider } from "@/components/ui/tooltip";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------------------ cache e compatibilidade

describe("cache persistido e navegador antigo", () => {
  it("URL assinada em lote (useUrlsAssinadas, chave 'urls') também não vai para o navegador", () => {
    expect(chavePersistivel(["mesa", "urls", "mesa", "a.png|b.png"])).toBe(false);
    expect(chavePersistivel(["mesa", "url", "mesa", "a.png"])).toBe(false);
    expect(chavePersistivel(["mesa", "agenda-do-mes", "c", "2026-09-01"])).toBe(true);
  });

  it("nenhum min(), max() ou clamp() em classe arbitrária do Tailwind na Mesa (Chrome 64 não conhece)", () => {
    const pasta = resolve(raiz, "src/components/mesa");
    const arquivos = readdirSync(pasta).filter((n) => /\.tsx?$/.test(n));
    const comFuncao = arquivos.filter((n) => /-\[(min|max|clamp)\(/.test(readFileSync(join(pasta, n), "utf8")));
    expect(comFuncao).toEqual([]);
    expect(ler("src/components/mesa/BarraDeCusto.tsx")).toContain('className="w-[92vw] max-w-[340px] p-3"');
  });
});

// ------------------------------------------------------------------ ditado

type Ouvinte = { onresult: ((e: any) => void) | null; onend: (() => void) | null; abort: () => void };
let reconhecedor: Ouvinte | null = null;
class ReconhecedorFalso {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  abortado = false;
  constructor() {
    reconhecedor = this;
  }
  start() {}
  stop() {
    if (this.onend) this.onend();
  }
  abort() {
    this.abortado = true;
    if (this.onend) this.onend();
  }
}

const fala = (texto: string, final = false) => ({ resultIndex: 0, results: { length: 1, 0: { isFinal: final, 0: { transcript: texto } } } });

function CampoComDitado() {
  const [texto, setTexto] = useState("");
  return (
    <TooltipProvider>
      <textarea aria-label="campo" value={texto} onChange={(e) => setTexto(e.target.value)} />
      <button type="button" onClick={() => setTexto("")}>Enviar</button>
      <Ditado valor={texto} onChange={setTexto} />
    </TooltipProvider>
  );
}

describe("ditado", () => {
  beforeEach(() => {
    (window as any).webkitSpeechRecognition = ReconhecedorFalso;
    reconhecedor = null;
  });
  afterEach(() => {
    delete (window as any).webkitSpeechRecognition;
  });

  it("enviar no meio do ditado (campo limpo) para o microfone e não devolve o texto já enviado", () => {
    render(<CampoComDitado />);
    fireEvent.click(screen.getByRole("button", { name: "Falar em vez de digitar" }));
    const r = reconhecedor!;
    act(() => r.onresult && r.onresult(fala("quero um post de promoção", true)));
    const campo = screen.getByLabelText("campo") as HTMLTextAreaElement;
    expect(campo.value).toBe("Quero um post de promoção");

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(campo.value).toBe("");
    // O reconhecedor foi solto: resultado atrasado e fim não escrevem mais.
    expect((r as any).abortado).toBe(true);
    act(() => {
      if (r.onresult) r.onresult(fala("quero um post de promoção", true));
      if (r.onend) r.onend();
    });
    expect(campo.value).toBe("");
    expect(screen.getByRole("button", { name: "Falar em vez de digitar" })).toBeTruthy();
  });

  it("sem mudança por fora, o ditado segue escrevendo e o fim deixa o texto final limpo", () => {
    render(<CampoComDitado />);
    fireEvent.click(screen.getByRole("button", { name: "Falar em vez de digitar" }));
    const r = reconhecedor!;
    act(() => r.onresult && r.onresult(fala("bom dia")));
    act(() => r.onresult && r.onresult(fala("bom dia a todos", true)));
    act(() => r.onend && r.onend());
    expect((screen.getByLabelText("campo") as HTMLTextAreaElement).value).toBe("Bom dia a todos");
  });
});

// ------------------------------------------------------------------ anexos e custo

describe("anexos do pedido", () => {
  it("tirarEnviados tira só o que foi no pedido; o anexado durante o trabalho fica", async () => {
    mock.subir.mockImplementation(async (_c: string, f: File) => `c/pedidos/${f.name}`);
    const { result } = renderHook(() => useAnexos("c"));
    act(() => result.current.adicionar([new File(["a"], "a.png", { type: "image/png" })]));
    await waitFor(() => expect(result.current.caminhos).toEqual(["c/pedidos/a.png"]));
    const enviados = result.current.caminhos.slice();
    act(() => result.current.adicionar([new File(["b"], "b.png", { type: "image/png" })]));
    await waitFor(() => expect(result.current.caminhos.length).toBe(2));
    act(() => result.current.tirarEnviados(enviados));
    expect(result.current.caminhos).toEqual(["c/pedidos/b.png"]);
  });

  it("agente do mês e agente da campanha usam tirarEnviados, não limpar tudo", () => {
    for (const f of ["src/components/mesa/AgenteDoMes.tsx", "src/components/mesa/CampanhaAgente.tsx"]) {
      const fonte = ler(f);
      expect(fonte).toContain("enviados.current = caminhos;");
      expect(fonte).toContain("anexos.tirarEnviados(enviados.current);");
      expect(fonte).not.toContain("anexos.limpar();");
    }
  });
});

const valorDaMesa = (atualizarCusto = vi.fn()): MesaValor => ({
  clientId: "11111111-1111-1111-1111-111111111111",
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [
    { id: "x", provedor: "openai", modelo_api: "x", tipo: "texto", rotulo: "X", preco_entrada_1m: 1, preco_saida_1m: 1, preco_cache_1m: null, preco_imagem: null, raciocinio: [], padrao_para: [], ativo: true } as any,
  ],
  catalogoCarregando: false,
  atualizarCusto,
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

describe("botão que gasta", () => {
  it("falha também relê o saldo da barra (falha depois da IA também é cobrada)", async () => {
    const atualizarCusto = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MesaProvider valor={valorDaMesa(atualizarCusto)}>
          <BotaoComCusto
            rotulo="Detalhar"
            titulo="Detalhar"
            partes={() => [{ modeloId: "x", tipo: "texto", tokensEntrada: 1000, tokensSaida: 1000 }]}
            executar={() => Promise.reject(new Error("detalhar parcial"))}
          />
        </MesaProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Detalhar/ }));
    await waitFor(() => expect(atualizarCusto).toHaveBeenCalledTimes(1));
  });
});

// ------------------------------------------------------------------ campanhas

describe("campanhas", () => {
  it("o pedido em curso fica por campanha, fora do componente, e sobrevive a remontar", () => {
    const { result, unmount } = renderHook(() => usePedidoDaCampanha("camp-a"));
    expect(result.current).toBeNull();
    act(() => marcarPedidoDaCampanha("camp-a", { mensagem: "mude o nome", desde: 1 }));
    expect(result.current).toEqual({ mensagem: "mude o nome", desde: 1 });
    unmount();
    // Remontou (gaveta fechada e aberta): o pedido continua lá.
    const outra = renderHook(() => usePedidoDaCampanha("camp-a"));
    expect(outra.result.current).toEqual({ mensagem: "mude o nome", desde: 1 });
    // E não vaza para outra campanha.
    expect(pedidoDaCampanha("camp-b")).toBeNull();
    act(() => marcarPedidoDaCampanha("camp-a", null));
    expect(outra.result.current).toBeNull();
  });

  it("agente, botão da gaveta e selo leem o andamento da própria campanha", () => {
    const agente = ler("src/components/mesa/CampanhaAgente.tsx");
    expect(agente).toContain("const envio = usePedidoDaCampanha(campanha.id);");
    expect(agente).toContain("marcarPedidoDaCampanha(campanhaId, null);");
    const aba = ler("src/components/mesa/AbaCampanhas.tsx");
    expect(aba).toContain("const andando = !!usePedidoDaCampanha(escolhida ? escolhida.id : null);");
    expect(aba).not.toContain("setAndando");
    const detalhe = ler("src/components/mesa/CampanhaDetalhe.tsx");
    expect(detalhe).toContain("usePedidoDaCampanha(`selo:${campanha.id}`)");
  });

  it("tirar o hype não remonta a campanha nova (o formulário fica)", () => {
    const aba = ler("src/components/mesa/AbaCampanhas.tsx");
    expect(aba).toContain("key={chaveDaNova.current}");
    expect(aba).toContain("if (hype && hypeIndice !== null) chaveDaNova.current = `hype-${hypeIndice}`;");
    expect(aba).not.toContain('key={hype ? `hype-${hypeIndice}` : "nova"}');
  });

  it("referências que não salvaram voltam ao que está gravado", () => {
    const detalhe = ler("src/components/mesa/CampanhaDetalhe.tsx");
    const catchIdx = detalhe.indexOf('toast.error("Referências não salvas"');
    const trecho = detalhe.slice(catchIdx, catchIdx + 500);
    expect(trecho).toContain("setReferencias(refsSalvas.current);");
    expect(detalhe).toContain("refsSalvas.current = lista;");
  });

  it("Cancelar fica travado enquanto a campanha é criada", () => {
    expect(ler("src/components/mesa/CampanhaNova.tsx")).toContain("onClick={onCancelar} disabled={desde !== null}");
  });
});

describe("catálogo de modelos", () => {
  it("a contagem de novos vem de cada provedor e ok:false é erro", () => {
    expect(resumoDaSincronizacao({ ok: true, openrouter: { novos: 3 }, openai: { novos: 1 }, anthropic: { pulado: "x" } })).toEqual({ falhou: false, erro: null, novos: 4 });
    expect(resumoDaSincronizacao({ ok: false, openrouter: { erro: "rpc caiu" } })).toEqual({ falhou: true, erro: "rpc caiu", novos: null });
    expect(resumoDaSincronizacao({ ok: true })).toEqual({ falhou: false, erro: null, novos: null });
  });

  it("trocar o padrão grava o novo antes de tirar dos antigos", () => {
    const fonte = ler("src/components/mesa/ModelosDeIa.tsx");
    const corpo = fonte.slice(fonte.indexOf("const definirPadrao = async"));
    expect(corpo.indexOf(".update({ padrao_para: lista })")).toBeGreaterThan(0);
    expect(corpo.indexOf(".update({ padrao_para: lista })")).toBeLessThan(corpo.indexOf("for (const m of antigos)"));
  });
});

// ------------------------------------------------------------------ mês

describe("aba Mês", () => {
  const mes = ler("src/components/mesa/AbaMes.tsx");

  it("'Uma proposta por vez' lista só as propostas do estrategista", () => {
    expect(mes).toContain('.is("parametros->>origem", null)');
  });

  it("proposta 'detalhando' (parcial ou que caiu) volta a ter o botão Detalhar", () => {
    expect(mes).toContain('proposta.status === "temas" || proposta.status === "pronta" || proposta.status === "detalhando"');
    expect(mes).toContain('{podeDetalhar && (proposta.status === "temas" || proposta.status === "detalhando" || itens.length === 0) && (');
  });

  it("gravar conta os itens pelo que o servidor devolve e relê agenda, Estúdio e propostas mesmo na falha", () => {
    const corpo = mes.slice(mes.indexOf("const gravar = async"), mes.indexOf("// O estrategista recebe quantas"));
    expect(corpo).toContain("Array.isArray(data?.itens)");
    expect(corpo).not.toContain("data?.task_ids");
    expect(corpo.indexOf("atualizarAgenda(queryClient, clientId)")).toBeGreaterThan(corpo.indexOf("} finally {"));
    const auto = ler("src/components/mesa/PlanejamentoAutomatico.tsx");
    expect(auto.match(/atualizarAgenda\(f\.queryClient, f\.clientId\)/g)?.length).toBe(2);
  });

  it("detalhar relê a proposta também quando volta com erro parcial", () => {
    const i = mes.indexOf('acao: "escolher_temas", proposta_id: proposta.id');
    const trecho = mes.slice(i - 200, i + 500);
    expect(trecho).toContain("} finally {");
    expect(trecho).toContain("atualizar();");
  });

  it("as propostas do agente do mês não piscam para o esqueleto a cada mensagem", () => {
    expect(ler("src/components/mesa/AgenteDoMes.tsx")).toContain("placeholderData: keepPreviousData,");
  });
});

// ------------------------------------------------------------------ contexto

describe("aba Contexto", () => {
  it("cor 'primaria' (como o agente grava) aparece como Principal", () => {
    expect(papelNaTela("primaria")).toBe("principal");
    expect(papelNaTela("primária")).toBe("principal");
    expect(papelNaTela("destaque")).toBe("destaque");
    expect(ROTULO_DO_PAPEL.primaria).toBe("Principal");
    expect(ler("src/components/mesa/ContextoMarca.tsx")).toContain("<Select value={papelNaTela(cor.papel)}");
  });

  it("o editor da marca não apaga o que está sendo digitado quando o kit é relido", () => {
    const fonte = ler("src/components/mesa/ContextoMarca.tsx");
    expect(fonte).toContain("if (sujo.current) return;");
    expect(fonte).toContain("sujo.current = false;");
  });

  it("Organizar com IA estima no máximo 12 imagens (o que o servidor faz por vez) e diz quantas faltam", () => {
    expect(MAX_ORGANIZAR_POR_VEZ).toBe(12);
    const fonte = ler("src/components/mesa/ContextoImagens.tsx");
    expect(fonte).toContain("vezes: Math.min(semDescricao.length, MAX_ORGANIZAR_POR_VEZ),");
    expect(fonte).toContain("data?.restantes");
  });

  it("a releitura depois da sincronização marca o cliente só quando roda", () => {
    const fonte = ler("src/components/mesa/ContextoAutomatico.tsx");
    const i = fonte.indexOf("if (relidos.current[clientId]) return;");
    const trecho = fonte.slice(i, i + 700);
    expect(trecho.indexOf("relidos.current[alvo] = true;")).toBeGreaterThan(trecho.indexOf("window.setTimeout"));
    expect(fonte).not.toContain("relidos.current[clientId] = true;");
  });

  it("montar sem novidade (ja_atualizado) não apaga as sugestões que estão na tela", () => {
    const fonte = ler("src/components/mesa/ContextoAutomatico.tsx");
    expect(fonte).toContain("const semMontagem = !!(data && data.ja_atualizado);");
    expect(fonte).toContain("if (!semMontagem) setSugestoesPorCliente");
  });

  it("salvar versão do complemento: número lido do banco e a versão anterior volta se a nova falhar", () => {
    const fonte = ler("src/components/mesa/ContextoAgente.tsx");
    const corpo = fonte.slice(fonte.indexOf("const salvarVersao = async"), fonte.indexOf("const usarVersao = async"));
    expect(corpo).toContain('.order("versao", { ascending: false })');
    expect(corpo).toContain('if (desligou && anterior)');
    expect(corpo).toContain('.update({ ativo: true }).eq("id", anterior)');
  });

  it("falha ao ler os rostos aparece na tela", () => {
    expect(ler("src/components/mesa/ContextoRosto.tsx")).toContain("{rostos.isError && <AvisoDeErro erro={rostos.error} />}");
  });
});

// ------------------------------------------------------------------ estúdio

describe("Estúdio", () => {
  const estudio = ler("src/components/mesa/AbaEstudio.tsx");

  it("custo do lote: o total é somado depois do await (os 3 trabalhadores não se apagam)", () => {
    expect(estudio).not.toContain("total += await");
    expect(estudio).toContain("const custo = await gerarUma(trabalho.id, ordem);\n          total += custo;");
  });

  it("conferência que falha depois de gerar ou ajustar avisa sem derrubar a lâmina já paga", () => {
    const f = estudio.slice(estudio.indexOf("const conferirSemDerrubar = async"), estudio.indexOf("const gerarEConferir = async"));
    expect(f).toContain("avisarErro(e, `Lâmina ${ordem} pronta, mas a conferência falhou`);");
    expect(f).toContain("return 0;");
    expect(estudio).not.toContain("conferirDepois(trabalho.id, ordem).catch(() => 0)");
    const ajuste = estudio.slice(estudio.indexOf("const ajustar = async"), estudio.indexOf("const configurar = async"));
    expect(ajuste).toContain("await conferirSemDerrubar(trabalho.id, ordem)");
  });

  it("contagem de lâminas com arte só olha a direção atual", () => {
    expect(estudio).toContain("const laminasComArte = cardsDaDirecao.length - semImagem.length;");
    expect(estudio).toContain("laminasFeitas={laminasComArte}");
    expect(estudio).not.toContain("ultimas.size / cardsDaDirecao.length");
  });

  it("artePronta (Entrega) não se completa com versão de lâmina que saiu da direção", () => {
    const v = (ordem: number) => ({ ordem, versao: 1, storage_path: `p${ordem}` });
    const direcao = (n: number) => ({ cards: Array.from({ length: n }, (_, i) => ({ ordem: i + 1 })) }) as any;
    expect(artePronta({ direcao: direcao(3), cards: [v(1), v(4), v(5)] } as any)).toBe(false);
    expect(artePronta({ direcao: direcao(2), cards: [v(1), v(2), v(3)] } as any)).toBe(true);
    expect(artePronta({ direcao: direcao(0), cards: [] } as any)).toBe(false);
  });

  it("no contínuo, outra lâmina não gera enquanto uma gera (mesmo panorama)", () => {
    expect(estudio).toContain("const laminaOcupada = (ordem: number) => !!andamento[ordem] || entregando || (infinito && algoGerando);");
  });

  it("reordenar confere se gravou (atualizado_em mudou: nenhuma linha) e avisa", () => {
    const corpo = estudio.slice(estudio.indexOf("const reordenar = async"), estudio.indexOf("const hashtags = "));
    expect(corpo).toContain('.eq("atualizado_em", trabalho.atualizado_em)\n      .select("id");');
    expect(corpo).toContain("gravadas.length === 0");
  });

  it("entregar não segue com a legenda antiga quando a nova não gravou", () => {
    expect(estudio).toContain("const salvarLegenda = async (silencioso = false): Promise<boolean> => {");
    expect(estudio).toContain("if (legendaMudou && !(await salvarLegenda(true))) return;");
  });

  it("pedir ao diretor mantém o contínuo como está no trabalho", () => {
    const i = estudio.indexOf('acao: "preparar",\n                task_id: item.id,');
    expect(estudio.slice(i, i + 600)).toContain("carrossel_infinito: postUnico ? undefined : infinito,");
  });

  it("gerar e entregar no Estúdio também relê a agenda e as artes da aba Mês", () => {
    const corpo = estudio.slice(estudio.indexOf("const atualizar = () => {"), estudio.indexOf("const diretor = "));
    expect(corpo).toContain('queryKey: ["mesa", "agenda-do-mes", clientId]');
    expect(corpo).toContain('queryKey: ["mesa", "artes-do-mes", clientId]');
  });

  it("Ver grande abre a lâmina certa mesmo com uma lâmina sem arquivo antes", () => {
    const imgs = [{ caminho: "a" }, { caminho: "" }, { caminho: "c" }];
    expect(indiceNoAmpliar(imgs, 2)).toBe(1);
    expect(indiceNoAmpliar(imgs, 0)).toBe(0);
    expect(indiceNoAmpliar(imgs, 1)).toBeNull();
    expect(indiceNoAmpliar(imgs, null)).toBeNull();
  });

  it("ajuste avisa que parte da versão atual quando outra está na tela; pedidos anteriores saem das versões", () => {
    const card = ler("src/components/mesa/CardDoEstudio.tsx");
    expect(card).toContain('data-aviso="ajuste-parte-da-atual"');
    expect(card).toContain('.filter((v) => v.origem === "ajuste" && !!(v.instrucao && v.instrucao.trim()))');
    expect(card).toContain("{pedidosAnteriores.length > 0 && (");
  });
});
