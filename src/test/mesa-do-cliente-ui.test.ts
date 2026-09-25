import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa do cliente, a tela (docs/mesa-do-cliente/SPEC.md, seções 1, 2.1 e 7).
 *
 * Fixa as regras que não podem voltar atrás:
 * - /mesa é só da equipe que produz (admin, gestor, design);
 * - "Gerar todos" gera um card por vez, esperando cada um (gerar e conferir);
 * - a chave de IA digitada nunca volta para a tela;
 * - toda ação que gasta mostra a estimativa antes de gastar;
 * - o estúdio não desenha texto por cima da arte (a lâmina vem inteira do gerador).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: mock.rpc,
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { BotaoComCusto } from "@/components/mesa/Custo";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import ChavesECotas from "@/components/mesa/ChavesECotas";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import { corpoDoPreparar, legendaParaCopiar, normalizarArea, normalizarHashtags } from "@/components/mesa/estudioUtil";
import { janelaDaLista, PROXIMOS_DIAS } from "@/components/mesa/useItensDoMes";
import {
  custoDaResposta,
  ErroDaMesa,
  mensagemDoCodigo,
  modeloNovo,
  precoDoModelo,
  type ModeloIa,
} from "@/lib/mesa/api";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const app = ler("src/App.tsx");
const estudio = ler("src/components/mesa/AbaEstudio.tsx");
const cardEstudio = ler("src/components/mesa/CardDoEstudio.tsx");
const prancheta = ler("src/components/mesa/PranchetaDoEstudio.tsx");
// Esteira (23/09): lista, preparo e lâmina grande saíram do AbaEstudio para arquivos próprios.
const listaDoEstudio = ler("src/components/mesa/EstudioLista.tsx");
const prepararDoEstudio = ler("src/components/mesa/EstudioPreparar.tsx");
const laminaGrande = ler("src/components/mesa/EstudioLaminaGrande.tsx");
const arteDaAgenda = ler("src/components/mesa/EstudioArteDaAgenda.tsx");
// Estúdio grande (23/09, noite): fotos reais para compor ganharam ferramenta própria.
const fotosDoEstudio = ler("src/components/mesa/EstudioFotos.tsx");
const seletorDeAreas = ler("src/components/mesa/SeletorDeAreas.tsx");
const referenciasDoEstudio = ler("src/components/mesa/ReferenciasDoEstudio.tsx");
const mesAba = ler("src/components/mesa/AbaMes.tsx");
const referencias = ler("src/components/mesa/ContextoReferencias.tsx");
const custo = ler("src/components/mesa/Custo.tsx");
const chaves = ler("src/components/mesa/ChavesECotas.tsx");
const central = ler("src/pages/AdminExperience.tsx");
const calendario = ler("src/pages/EditorialCalendar.tsx");
const gaveta = ler("src/components/editorial/EditorialDetailSheet.tsx");

const valorDaMesa = (extra: Partial<MesaValor> = {}): MesaValor => ({
  clientId: "11111111-1111-1111-1111-111111111111",
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
  ...extra,
});

function montar(filho: any, valor = valorDaMesa()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(MesaProvider, { valor }, filho))));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rota /mesa só para a equipe que produz", () => {
  it("admin, gestor e design entram; o resto volta para o painel", () => {
    const linha = app.split("\n").find((l) => l.indexOf('path="/mesa"') >= 0) || "";
    // A trava de login fica na rota-mãe (casca do painel montada uma vez só).
    expect(app).toContain("<Route element={<ProtectedRoute><AppLayout><Suspense fallback={<EsqueletoDaPagina />}><Outlet /></Suspense></AppLayout></ProtectedRoute>}>");
    expect(linha).toContain('["admin", "manager", "design"].includes(profile?.role || "")');
    expect(linha).toContain("<MesaDoCliente />");
    expect(linha).toContain('<Navigate to="/dashboard" replace />');
    expect(linha).not.toContain("traffic");
    // A rota baixa pela pré-carga das mesas (frente U, 25/09): página e etapa juntas.
    expect(app).toContain('const MesaDoCliente = PaginaMesaDoCliente;');
    expect(readFileSync(resolve(__dirname, "../lib/mesa/preCarga.ts"), "utf8")).toContain('pagina: () => import("@/pages/MesaDoCliente"),');
  });

  it("as entradas da Central e do Calendário só aparecem para quem entra na Mesa", () => {
    expect(central).toContain('["admin", "manager", "design"].includes(profile?.role || "") && (');
    expect(central).toContain("navigate(`/mesa?client=${client.id}&aba=estudio`)");
    expect(calendario).toContain('["admin", "manager", "design"].includes(effectiveRole || "")');
    expect(calendario).toContain("`/mesa?client=${selectedPost.post.client_id}&aba=estudio&task=${selectedPost.internal.task_id}`");
    expect(gaveta).toContain("mesaHref && !isImpersonating");
  });
});

describe("Gerar todas: até 3 ao mesmo tempo, uma por vez no carrossel contínuo", () => {
  // Pedido do dono em 2026-09-23: gerar estava lento demais um card por vez.
  // O fim do trecho era "const montarDoRoteiro"; o preparo agora é "const preparar" (esteira de 23/09).
  it("o limite de lâminas simultâneas é 3, e 1 no carrossel contínuo", () => {
    expect(estudio).toContain("const EM_PARALELO = 3;");
    expect(estudio.indexOf("const preparar = async")).toBeGreaterThan(estudio.indexOf("const gerarVarias = async"));
    const corpo = estudio.slice(estudio.indexOf("const gerarVarias = async"), estudio.indexOf("const preparar = async"));
    expect(corpo).toContain("const limite = infinito ? 1 : EM_PARALELO;");
    expect(corpo).toContain("Array.from({ length: Math.min(limite, ordens.length) }, trabalhador)");
    expect(corpo).toContain("while (proximo < ordens.length && !parar.current)");
  });

  it("saldo, cota ou chave param tudo; a conferência roda depois de cada lâmina", () => {
    const corpo = estudio.slice(estudio.indexOf("const gerarVarias = async"), estudio.indexOf("const preparar = async"));
    expect(corpo).toContain("CODIGOS_QUE_PARAM_TUDO.indexOf(e.codigo) >= 0) parar.current = true");
    const gerar = corpo.indexOf("await gerarUma(trabalho.id, ordem)");
    // A conferência do lote passa por conferirSemDerrubar (avisa a falha sem derrubar a lâmina já gerada).
    const conferir = corpo.indexOf("conferirSemDerrubar(trabalho.id, ordem)");
    expect(gerar).toBeGreaterThan(0);
    expect(conferir).toBeGreaterThan(gerar);
    expect(estudio).toContain('acao: "conferir_card", trabalho_id: trabalhoId, ordem');
  });

  it("a qualidade padrão do estúdio é a padrão (média)", () => {
    expect(estudio).toContain('useState<Qualidade>("media")');
    expect(estudio).toContain('(trabalho?.qualidade as Qualidade) || "media"');
  });

  // Esteira (23/09): o corpo do "preparar" sai de corpoDoPreparar (testado de verdade abaixo),
  // e o cartão Preparar tem o botão grátis do roteiro e o do diretor com custo.
  it("item com roteiro monta a direção sem custo; o diretor é opcional e passa pelo botão com custo", () => {
    const roteiro = corpoDoPreparar("t-1", { modo: "roteiro", laminas: 5, continuo: false, pedido: "capa centralizada" });
    expect(roteiro).toMatchObject({ acao: "preparar", task_id: "t-1", modo: "roteiro" });
    // No roteiro, nem quantidade nem pedido: um pedido viraria diretor, com custo.
    expect(roteiro.laminas).toBeUndefined();
    expect(roteiro.instrucao).toBeUndefined();
    expect(estudio).toContain("corpoDoPreparar(item.id, escolhas, { postUnico, modeloImagemId: modeloImagem || undefined, qualidade })");
    expect(estudio).toContain('modo: "diretor"');
    const gratis = prepararDoEstudio.slice(prepararDoEstudio.indexOf('modo === "roteiro" ? ('), prepararDoEstudio.indexOf("Montar do roteiro · grátis"));
    expect(gratis).toContain("<Button");
    expect(gratis).not.toContain("BotaoComCusto");
  });
});

describe("a chave de IA nunca volta para a tela", () => {
  it("campo de senha, ligado só ao que a pessoa digita, limpo depois de salvar", () => {
    expect(chaves).toContain('type="password"');
    expect(chaves).toContain('autoComplete="new-password"');
    expect(chaves).toContain("value={novaChave}");
    const chamadas = chaves.match(/setNovaChave\(([^)]*)\)/g) || [];
    for (const c of chamadas) expect(["setNovaChave(e.target.value)", 'setNovaChave("")']).toContain(c);
    const finalDoSalvar = chaves.slice(chaves.indexOf("} finally {", chaves.indexOf('rpc("ia_chave_salvar"')));
    expect(finalDoSalvar.slice(0, 200)).toContain('setNovaChave("")');
    expect(chaves).not.toContain("vault_secret_id");
    expect(chaves).not.toContain("segredo");
  });

  it("depois de salvar, o campo fica vazio e a lista só mostra o final da chave", async () => {
    mock.rpc.mockImplementation(async (nome: string) => {
      if (nome === "ia_chaves_listar") {
        return { data: { usar_chave_agencia: true, chaves: [] }, error: null };
      }
      return { data: { id: "k1", final_chave: "WXYZ" }, error: null };
    });
    montar(h(ChavesECotas, { aberto: true, onOpenChange: vi.fn(), clientId: "11111111-1111-1111-1111-111111111111", clientName: "Cliente" }));
    const campos = (await screen.findAllByPlaceholderText("Cole aqui; ela vai para o cofre e some da tela")) as HTMLInputElement[];
    const campo = campos[0];
    expect(campo.type).toBe("password");
    expect(campo.value).toBe("");
    fireEvent.change(campo, { target: { value: "sk-segredo-de-teste-123456" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Salvar chave" })[0]);
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("ia_chave_salvar", expect.objectContaining({ _chave: "sk-segredo-de-teste-123456", _provedor: "openai" })));
    await waitFor(() => expect(campo.value).toBe(""));
  });
});

describe("estimativa antes de toda ação que gasta", () => {
  it("o preço estimado aparece ao lado do botão antes de gastar e o clique executa, sem janela", async () => {
    mock.invoke.mockResolvedValue({ data: { custo_usd: 0.25 }, error: null });
    const executar = vi.fn().mockResolvedValue({ custo_usd: 0.31 });
    montar(
      h(BotaoComCusto, {
        rotulo: "Gerar card",
        titulo: "Gerar o card 1",
        partes: () => [{ modeloId: "openai:gpt-image-2", tipo: "imagem", imagens: 1, qualidade: "alta" }],
        executar,
      }),
    );
    await screen.findByText("~US$ 0,25");
    expect(mock.invoke).toHaveBeenCalledWith("ia-gateway", { body: expect.objectContaining({ acao: "estimar", modelo_id: "openai:gpt-image-2", tipo: "imagem", qualidade: "alta" }) });
    expect(executar).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Gerar card/ }));
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(1));
  });

  it("acima de US$ 1 pede um segundo clique antes de gastar", async () => {
    mock.invoke.mockResolvedValue({ data: { custo_usd: 1.5 }, error: null });
    const executar = vi.fn().mockResolvedValue({ custo_usd: 1.4 });
    montar(h(BotaoComCusto, { rotulo: "Gerar tudo", titulo: "Gerar tudo", partes: () => [{ modeloId: "x", tipo: "imagem", imagens: 40 }], executar }));
    await screen.findByText("~US$ 1,50");
    fireEvent.click(screen.getByRole("button", { name: /Gerar tudo/ }));
    expect(executar).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /Clique de novo para confirmar/ }));
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(1));
  });

  it("sem estimativa também pede um segundo clique", async () => {
    mock.invoke.mockResolvedValue({ data: null, error: { name: "FunctionsFetchError" } });
    const executar = vi.fn().mockResolvedValue({});
    montar(h(BotaoComCusto, { rotulo: "Ler", titulo: "Ler", partes: () => [{ modeloId: "x", tipo: "texto" }], executar }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Ler/ }));
    expect(executar).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /Sem estimativa: clique de novo/ }));
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(1));
  });

  it("saldo que não cobre a estimativa não executa", () => {
    const clicar = custo.slice(custo.indexOf("const clicar = async"), custo.indexOf("<Button", custo.indexOf("const clicar = async")));
    expect(clicar.indexOf("mesa.saldoUsd < valor")).toBeGreaterThan(0);
    expect(clicar.indexOf("mesa.saldoUsd < valor")).toBeLessThan(clicar.indexOf("await executar()"));
    expect(clicar).toContain("custoDaResposta(data)");
  });
  it("cada ação que gasta passa pelo botão com custo ou mostra o preço ao lado", () => {
    // Mês
    for (const acao of ['acao: "propor_temas"', 'acao: "detalhar"']) {
      const i = mesAba.indexOf(acao);
      expect(i).toBeGreaterThan(0);
      const botao = mesAba.lastIndexOf("<BotaoComCusto", i);
      expect(botao).toBeGreaterThan(0);
      expect(i - botao).toBeLessThan(1500);
      expect(mesAba.slice(botao, i)).toContain("partes={");
      expect(mesAba.slice(botao, i)).toContain("executar=");
    }
    expect(mesAba).toContain("<EstimativaInline partes={partes} />");
    // Estúdio (o preparo mudou para o cartão EstudioPreparar em 23/09)
    const preparar = prepararDoEstudio.indexOf("Preparar direção</>}");
    expect(preparar).toBeGreaterThan(0);
    const botaoDoDiretor = prepararDoEstudio.slice(prepararDoEstudio.lastIndexOf("<BotaoComCusto", preparar), prepararDoEstudio.indexOf("executar={preparar}", preparar) + 20);
    expect(botaoDoDiretor).toContain("partes={partesDiretor}");
    expect(botaoDoDiretor).toContain("executar={preparar}");
    expect(estudio).toContain("partesDiretor={partesDiretor}");
    expect(estudio).toContain("executar={() => gerarVarias(filaDeGeracao.map((c) => c.ordem))}");
    // No contínuo, o panorama que falta entra na mesma estimativa.
    expect(estudio).toContain("partes={() => partesGerarDas(ordensDaFila).concat(partesDoFundo(ordensDaFila))}");
    expect(estudio.slice(estudio.indexOf('titulo="Escrever a legenda"'), estudio.indexOf('acao: "legenda"'))).toContain("partes={");
    expect(cardEstudio).toContain("executar={onGerar}");
    expect(cardEstudio).toContain("executar={() => onAjustar(instrucao.trim())}");
    expect(cardEstudio).toContain("executar={onConferir}");
    // Referência
    expect(referencias.slice(referencias.indexOf('titulo="Ler a referência"'), referencias.indexOf('acao: "ler"'))).toContain("partes={");
  });

  it("o custo real vem da resposta, em qualquer das formas combinadas", () => {
    expect(custoDaResposta({ custo_usd: 0.12 })).toBe(0.12);
    expect(custoDaResposta({ custoUsd: "0.5" })).toBe(0.5);
    expect(custoDaResposta({ uso: { custo_usd: 1 } })).toBe(1);
    expect(custoDaResposta({ usos: [{ custo_usd: 0.1 }, { custo_usd: 0.2 }] })).toBeCloseTo(0.3);
    expect(custoDaResposta({ ok: true })).toBeNull();
  });
});

describe("recusas da IA viram frase com o próximo passo", () => {
  it("cada código tem português claro e a ação certa", () => {
    const saldo = new ErroDaMesa("saldo_insuficiente", mensagemDoCodigo("saldo_insuficiente", { falta_usd: 1.5 }));
    expect(saldo.message).toContain("faltam US$ 1,50");
    expect(saldo.acao).toBe("recarregar");
    expect(new ErroDaMesa("cota_da_chave_esgotada", "").acao).toBe("cota");
    expect(new ErroDaMesa("cliente_sem_chave", "").acao).toBe("chave");
    expect(new ErroDaMesa("provedor_sem_chave", "").acao).toBe("chave");
    expect(mensagemDoCodigo("cliente_sem_chave", { provedor: "anthropic" })).toContain("Anthropic");
    expect(mensagemDoCodigo("provedor_sem_chave", { provedor: "openrouter" })).toContain("OpenRouter");
    expect(mensagemDoCodigo("cota_da_chave_esgotada", {})).toContain("Ajuste a cota");
  });
});

describe("o estúdio nunca põe texto por cima da arte", () => {
  it("nenhum canvas, fillText ou camada de texto sobre a imagem do card", () => {
    // Estúdio v3: a prancheta e o desenho de áreas também não pintam nada na arte.
    // Esteira (23/09): a lâmina grande e a arte da Agenda entram na mesma regra.
    for (const fonte of [estudio, cardEstudio, prancheta, seletorDeAreas, laminaGrande, arteDaAgenda, fotosDoEstudio]) {
      expect(fonte).not.toContain("fillText");
      expect(fonte).not.toContain("getContext");
      expect(fonte).not.toContain("<canvas");
      expect(fonte).not.toContain("html2canvas");
      expect(fonte).not.toContain("<svg");
    }
    // A imagem grande mudou do CardDoEstudio (inspetor) para o centro (EstudioLaminaGrande).
    // O texto exato fica fora do quadro da imagem, como conferência no inspetor; com arte,
    // o quadro mostra só a imagem (o esboço aparece só sem arte, no lugar dela).
    const quadro = laminaGrande.slice(laminaGrande.indexOf("<QuadroQueCabe soPelaLargura"), laminaGrande.indexOf("</QuadroQueCabe>"));
    expect(quadro).toContain("<ImagemDaMesa");
    expect(quadro).not.toContain("texto_exato");
    expect(quadro).not.toContain("absolute");
    expect(quadro.indexOf("vista ? (")).toBeLessThan(quadro.indexOf("<Esboco"));
    expect(cardEstudio).not.toContain("<ImagemDaMesa caminho={vista");
  });
});

describe("catálogo de modelos", () => {
  const base: ModeloIa = {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "GPT Image 2",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  };
  it("preço ao lado do nome: por imagem ou por 1M tokens", () => {
    expect(precoDoModelo(base, "alta")).toBe("US$ 0,17 por imagem");
    expect(precoDoModelo({ ...base, tipo: "texto", preco_imagem: null, preco_entrada_1m: 1.25, preco_saida_1m: 10 })).toBe("US$ 1,25 / 10,00 por 1M");
  });
  it("selo novo pela coluna quando existe, senão pela data recente", () => {
    const agora = Date.parse("2026-09-22T12:00:00Z");
    expect(modeloNovo({ ...base, novo: true }, agora)).toBe(true);
    expect(modeloNovo({ ...base, novo: false, criado_em: "2026-09-21T00:00:00Z" }, agora)).toBe(false);
    expect(modeloNovo({ ...base, criado_em: "2026-09-20T00:00:00Z" }, agora)).toBe(true);
    expect(modeloNovo({ ...base, conferido_em: "2026-07-01T00:00:00Z" }, agora)).toBe(false);
  });
});

describe("Estúdio versão 3 (pedido do dono em 23/09)", () => {
  it("a lista abre nos próximos 60 dias, de hoje em diante; o mês continua escolhível", () => {
    expect(janelaDaLista(PROXIMOS_DIAS, new Date(2026, 8, 23, 15, 0))).toEqual({ inicio: "2026-09-23", fimExclusivo: "2026-11-23" });
    expect(janelaDaLista("2026-09-01")).toEqual({ inicio: "2026-09-01", fimExclusivo: "2026-10-01" });
    expect(estudio).toContain('useEstadoGuardado<"proximos" | "mes">(`mesa:estudio:lista:${clientId}`, "proximos")');
    // A coluna da lista virou o componente EstudioLista (esteira de 23/09).
    expect(listaDoEstudio).toContain("<SelectItem value={PROXIMOS_DIAS}>Próximos 60 dias</SelectItem>");
    expect(estudio).toContain('useEstadoGuardado<Filtro>(`mesa:estudio:filtro:${clientId}`, "a_fazer")');
  });

  it("ajuste pontual: áreas em frações de 0 a 1 desenhadas com divs e eventos de ponteiro, sem canvas", () => {
    expect(normalizarArea({ x0: 0.8, y0: 1.4, x1: -0.2, y1: 0.25 })).toEqual({ x0: 0, y0: 0.25, x1: 0.8, y1: 1 });
    expect(seletorDeAreas).toContain("onPointerDown");
    expect(seletorDeAreas).toContain("setPointerCapture");
    expect(seletorDeAreas).toContain('className="absolute rounded-sm border-2 border-primary');
    expect(cardEstudio).toContain("executar={() => onAjustar(instrucao.trim(), { areas })}");
    expect(cardEstudio).toContain('{ tipo: "fundo", imagem_id: fundoId || undefined }');
    const ajuste = estudio.slice(estudio.indexOf('acao: "ajustar_card"'), estudio.indexOf("atualizar();", estudio.indexOf('acao: "ajustar_card"')));
    expect(ajuste).toContain("areas: opcoes.areas && opcoes.areas.length ? opcoes.areas : undefined");
    expect(ajuste).toContain("tipo: opcoes.tipo");
    expect(ajuste).toContain("imagem_id: opcoes.imagem_id");
  });

  it("referências e foto real vão pelo configurar, sem custo; id do banco da agência leva g:", () => {
    expect(referenciasDoEstudio).toContain('const PREFIXO_GLOBAL = "g:";');
    expect(referenciasDoEstudio).toContain('acao: "configurar"');
    expect(referenciasDoEstudio).toContain("{ card: { ordem, referencias_ids: lista } }");
    expect(referenciasDoEstudio).toContain("{ conjunto: { referencias_ids: lista } }");
    expect(referenciasDoEstudio).toContain("const POR_PAGINA = 24;");
    // Foto real (V5): saiu do CardDoEstudio para a ferramenta Fotos (EstudioFotos), gravada pelo mesmo configurar.
    expect(fotosDoEstudio).toContain("return { card: { ordem, fotos_livres: fotosParaSalvar(lista) } };");
    expect(estudio).toContain("onSalvar={(corpo) => configurar(corpo)}");
    // A foto do acervo do modo anterior (imagens_ids) continua podendo sair da lâmina.
    expect(estudio).toContain("configurar({ card: { ordem: cardSelecionado.ordem, imagens_ids: [] } })");
    expect(estudio).toContain("onConfigurar={(card) => configurar({ card: { ordem: cardSelecionado.ordem, ...card } })}");
  });

  it("pedir ao diretor refaz a direção do mesmo trabalho pelo pedido, com o preço ao lado", () => {
    const i = estudio.indexOf("instrucao: pedidoAoDiretor.trim() || undefined");
    expect(i).toBeGreaterThan(0);
    const botao = estudio.lastIndexOf("<BotaoComCusto", i);
    expect(estudio.slice(botao, i)).toContain("partes={partesDiretor}");
    expect(estudio.slice(botao, i + 200)).toContain("trabalho_id: trabalho.id");
  });

  it("legenda e hashtags separadas; copiar junta com uma linha em branco", () => {
    expect(normalizarHashtags(["##praia", "sol", "#praia", " "])).toEqual(["#praia", "#sol"]);
    expect(legendaParaCopiar("Bom dia", ["#a", "#b"])).toBe(["Bom dia", "", "#a #b"].join(String.fromCharCode(10)));
    expect(legendaParaCopiar("", ["#a"])).toBe("#a");
    expect(estudio).toContain("Copiar legenda");
    expect(estudio).toContain("Copiar hashtags");
  });

  it("a lâmina e o painel abertos ficam guardados na sessão por item", () => {
    expect(estudio).toContain("useEstadoGuardado<number | null>(`${chave}:lamina`, null)");
    expect(estudio).toContain('useEstadoGuardado<PainelDaLamina>(`${chave}:painel`, "direcao")');
  });
});
