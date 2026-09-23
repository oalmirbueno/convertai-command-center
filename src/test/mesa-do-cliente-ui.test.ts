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
    expect(linha).toContain("<ProtectedRoute>");
    expect(linha).toContain('["admin", "manager", "design"].includes(profile?.role || "")');
    expect(linha).toContain("<MesaDoCliente />");
    expect(linha).toContain('<Navigate to="/dashboard" replace />');
    expect(linha).not.toContain("traffic");
    expect(app).toContain('const MesaDoCliente = lazy(() => import("@/pages/MesaDoCliente"));');
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
  it("o limite de lâminas simultâneas é 3, e 1 no carrossel contínuo", () => {
    expect(estudio).toContain("const EM_PARALELO = 3;");
    const corpo = estudio.slice(estudio.indexOf("const gerarVarias = async"), estudio.indexOf("const montarDoRoteiro"));
    expect(corpo).toContain("const limite = infinito ? 1 : EM_PARALELO;");
    expect(corpo).toContain("Array.from({ length: Math.min(limite, ordens.length) }, trabalhador)");
    expect(corpo).toContain("while (proximo < ordens.length && !parar.current)");
  });

  it("saldo, cota ou chave param tudo; a conferência roda depois de cada lâmina", () => {
    const corpo = estudio.slice(estudio.indexOf("const gerarVarias = async"), estudio.indexOf("const montarDoRoteiro"));
    expect(corpo).toContain("CODIGOS_QUE_PARAM_TUDO.indexOf(e.codigo) >= 0) parar.current = true");
    const gerar = corpo.indexOf("await gerarUma(trabalho.id, ordem)");
    const conferir = corpo.indexOf("conferirDepois(trabalho.id, ordem)");
    expect(gerar).toBeGreaterThan(0);
    expect(conferir).toBeGreaterThan(gerar);
    expect(estudio).toContain('acao: "conferir_card", trabalho_id: trabalhoId, ordem');
  });

  it("a qualidade padrão do estúdio é a padrão (média)", () => {
    expect(estudio).toContain('useState<Qualidade>("media")');
    expect(estudio).toContain('(trabalho?.qualidade as Qualidade) || "media"');
  });

  it("item com roteiro monta a direção sem custo; o diretor é opcional e passa pelo botão com custo", () => {
    expect(estudio).toContain('acao: "preparar", task_id: item.id, modo: "roteiro"');
    expect(estudio).toContain('modo: "diretor"');
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
  it("o botão com custo só executa depois de mostrar a estimativa e ser confirmado", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Gerar card" }));
    expect(executar).not.toHaveBeenCalled();
    await screen.findByText("Custo estimado");
    await screen.findByText("US$ 0,25");
    expect(mock.invoke).toHaveBeenCalledWith("ia-gateway", { body: expect.objectContaining({ acao: "estimar", modelo_id: "openai:gpt-image-2", tipo: "imagem", qualidade: "alta" }) });
    expect(executar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e gastar" }));
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(1));
  });

  it("sem estimativa não há como confirmar", async () => {
    mock.invoke.mockResolvedValue({ data: null, error: { name: "FunctionsFetchError" } });
    const executar = vi.fn();
    montar(h(BotaoComCusto, { rotulo: "Ler", titulo: "Ler", partes: () => [{ modeloId: "x", tipo: "texto" }], executar }));
    fireEvent.click(screen.getByRole("button", { name: "Ler" }));
    await screen.findByText("sem estimativa");
    expect(screen.getByRole("button", { name: "Confirmar e gastar" })).toBeDisabled();
    expect(executar).not.toHaveBeenCalled();
  });

  it("abrir a confirmação não chama a ação; só o confirmar chama", () => {
    const abrir = custo.slice(custo.indexOf("const abrir = () => {"), custo.indexOf("const confirmar = async"));
    expect(abrir).not.toContain("executar(");
    const confirmar = custo.slice(custo.indexOf("const confirmar = async"), custo.indexOf("const faltaSaldo"));
    expect(confirmar).toContain("await executar()");
    expect(confirmar).toContain("custoDaResposta(data)");
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
    // Estúdio
    const preparar = estudio.indexOf('rotulo="Preparar direção"');
    expect(estudio.slice(preparar, estudio.indexOf('acao: "preparar"', preparar))).toContain("partes={");
    expect(estudio).toContain("executar={() => gerarVarias(filaDeGeracao.map((c) => c.ordem))}");
    expect(estudio).toContain("partes={() => partesGerar(filaDeGeracao.length)}");
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
    for (const fonte of [estudio, cardEstudio]) {
      expect(fonte).not.toContain("fillText");
      expect(fonte).not.toContain("getContext");
      expect(fonte).not.toContain("<canvas");
      expect(fonte).not.toContain("html2canvas");
      expect(fonte).not.toContain("<svg");
    }
    // O texto exato fica fora do bloco da imagem, como conferência.
    const blocoDaImagem = cardEstudio.slice(cardEstudio.indexOf('<div className="overflow-hidden rounded-lg border border-border">'), cardEstudio.indexOf("{ordenadas.length > 1 && ("));
    expect(blocoDaImagem).toContain("<ImagemDaMesa");
    expect(blocoDaImagem).not.toContain("texto_exato");
    expect(blocoDaImagem).not.toContain("absolute");
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
