import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// 23/10 (dono): "o seletor tem que ser no gerar a copy do conteúdo e não da legenda; adicione um seletor no
// motor que faz a copy do conteúdo, no refinar copy e no estrategista". Três escopos, cada um com o seu.

const rpc = vi.fn(async () => ({ data: null, error: null }));
const colunasLidas: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...(a as [])),
    from: () => ({
      select: (coluna: string) => {
        colunasLidas.push(coluna);
        return { eq: () => ({ maybeSingle: async () => ({ data: { [coluna]: coluna === "modelo_refino_id" ? "openrouter:anthropic/claude-fable-5.1" : null }, error: null }) }) };
      },
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const CATALOGO = [
  { id: "openrouter:openai/gpt-6.1-sol", tipo: "texto", ativo: true, padrao_para: ["estrategista"], rotulo: "GPT-6.1 Sol", preco_entrada_1m: 2, preco_saida_1m: 10 },
  { id: "openrouter:anthropic/claude-opus-5.5", tipo: "texto", ativo: true, padrao_para: ["copy"], rotulo: "Claude Opus 5.5", preco_entrada_1m: 4, preco_saida_1m: 20 },
  { id: "openrouter:anthropic/claude-fable-5.1", tipo: "texto", ativo: true, padrao_para: [], rotulo: "Claude Fable 5.1", preco_entrada_1m: 10, preco_saida_1m: 50 },
];
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "c1", catalogo: CATALOGO }) }));

import { useModeloDoEscopo } from "@/components/mesa/ModeloDaCopyDoConteudo";
import { escolherModeloDoEscopo } from "../../supabase/functions/estudio-arte/modulos/copy-viral";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const trecho = (codigo: string, inicio: string) => {
  const i = codigo.indexOf(inicio);
  const fim = codigo.indexOf("\nasync function ", i + inicio.length);
  return codigo.slice(i, fim < 0 ? undefined : fim);
};

function Sonda({ escopo }: { escopo: "copy" | "refino" | "estrategista" }) {
  const e = useModeloDoEscopo(escopo);
  return (
    <div>
      <p data-testid="modelo">{e.modeloId}</p>
      <p data-testid="motivo">{e.motivo}</p>
      <p data-testid="corpo">{JSON.stringify(e.corpo)}</p>
      <button type="button" onClick={() => void e.trocar("openrouter:anthropic/claude-opus-5.5")}>trocar</button>
    </div>
  );
}

const montar = (escopo: "copy" | "refino" | "estrategista") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Sonda escopo={escopo} />
    </QueryClientProvider>,
  );

describe("a legenda fica no modelo do diretor, sem seletor e mais rápida", () => {
  it("o servidor da legenda não usa o modelo da copy, escreve 3 variações e o Jev sem as notas virais", () => {
    // 24/10: o corpo da legenda virou escreverLegendaDoPost (o trabalho e o vídeo da pauta usam o mesmo motor).
    const legenda = trecho(ler("supabase/functions/estudio-arte/index.ts"), "async function escreverLegendaDoPost(");
    expect(legenda).not.toMatch(/modeloDaCopy|modeloDoRefino|modelo_copy_id/);
    expect(legenda).toContain("const escritorDaLegenda = diretor;");
    expect(legenda).toContain("semViral: true,");
    expect(ler("supabase/functions/estudio-arte/index.ts")).toContain("const VARIACOES_DA_LEGENDA = 3;");
  });

  it("a ferramenta da legenda não mostra seletor nem manda modelo", () => {
    const tela = ler("src/components/mesa/AbaEstudio.tsx");
    const i = tela.indexOf("const ferramentaLegenda = trabalho ? (");
    const bloco = tela.slice(i, tela.indexOf("<EstudioRefinarTexto", i));
    expect(bloco).not.toContain("SeletorDoModeloDoEscopo");
    expect(bloco).toContain('chamarFuncao("estudio-arte", { acao: "legenda", trabalho_id: trabalho.id })');
    expect(bloco).toContain("modeloId: diretor?.id");
  });
});

describe("três seletores, cada um no seu escopo", () => {
  it("copy do conteúdo: a direção do Estúdio e a arte rápida só com escolha explícita; o detalhar do Mês com o padrão", () => {
    // Direção do Estúdio: sem escolha, o diretor de arte de hoje (a parte visual aprovada não muda sozinha).
    const servidor = ler("supabase/functions/estudio-arte/index.ts");
    expect(servidor).toContain("await modeloDaCopyEscolhido(db as never, clientId, corpo.modelo_copy_id)");
    expect(servidor).not.toMatch(/await modeloDaCopy\(/);
    const tela = ler("src/components/mesa/AbaEstudio.tsx");
    expect(tela).toContain('const modeloDaCopy = useModeloDoEscopo("copy");');
    expect(tela).toContain("Object.assign(corpoDoPedido, modeloDaCopy.corpoEscolhido);");
    expect(tela).toContain("...modeloDaCopy.corpoEscolhido,");
    expect(tela).toContain("modeloId: (modeloDaCopy.escolhido && modeloDaCopy.modeloId) || diretor?.id, tipo: \"texto\", tokensEntrada: TAMANHOS.preparar.entrada");
    expect(tela.split('<SeletorDoModeloDoEscopo estado={modeloDaCopy} padraoDoLugar={{ rotulo: "diretor de arte", modelo: diretor }} />').length - 1).toBe(2);
    const rapida = ler("src/components/mesa/EstudioArteRapida.tsx");
    expect(rapida).toContain('const modeloDaCopy = useModeloDoEscopo("copy");');
    expect(rapida).toContain("if (!semMarca) Object.assign(corpoDoPedido, modeloDaCopy.corpoEscolhido);");
    expect(rapida).toContain('padraoDoLugar={{ rotulo: "diretor de arte", modelo: diretor }}');
    const mes = ler("src/components/mesa/AbaMes.tsx");
    expect(mes).toContain("<SeletorDoModeloDoEscopo estado={modeloDaCopy} />");
    expect(mes).toContain("...modeloDaCopy.corpo");
    expect(ler("supabase/functions/agente-calendario/index.ts")).toContain("const daCopy = await modeloDaCopy(servico, clientId, corpo.modelo_copy_id)");
  });

  it("refinar copy: seletor próprio no refino, campo próprio e o servidor no escopo do refino", () => {
    const refino = trecho(ler("supabase/functions/estudio-arte/index.ts"), "async function refinarTexto(");
    expect(refino).toContain("modeloDoRefino(servico(), t.client_id, corpo.modelo_refino_id)");
    expect(refino).not.toContain("modeloDaCopy(");
    const tela = ler("src/components/mesa/AbaEstudio.tsx");
    expect(tela).toContain('const modeloDoRefino = useModeloDoEscopo("refino");');
    expect(tela.split("modelo={modeloDoRefino}").length - 1).toBe(2);
    const componente = ler("src/components/mesa/EstudioRefinarTexto.tsx");
    expect(componente).toContain("{modelo && <SeletorDoModeloDoEscopo estado={modelo} />}");
    expect(componente).toContain("...(modelo ? modelo.corpo : {})");
  });

  it("estrategista: o seletor do Mês no mesmo padrão, lembrado por cliente", () => {
    const mes = ler("src/components/mesa/AbaMes.tsx");
    expect(mes).toContain('const modeloDoEstrategista = useModeloDoEscopo("estrategista");');
    expect(mes).toContain("<SeletorDoModeloDoEscopo estado={modeloDoEstrategista} valor={modeloId}");
  });

  it("padrões: copy e refino no melhor para copy; estrategista no de hoje", () => {
    expect(escolherModeloDoEscopo(CATALOGO, "", "copy").modelo!.id).toBe("openrouter:anthropic/claude-opus-5.5");
    expect(escolherModeloDoEscopo(CATALOGO, "", "refino").modelo!.id).toBe("openrouter:anthropic/claude-opus-5.5");
    expect(escolherModeloDoEscopo(CATALOGO, "", "estrategista").modelo!.id).toBe("openrouter:openai/gpt-6.1-sol");
    expect(escolherModeloDoEscopo(CATALOGO, "openrouter:anthropic/claude-fable-5.1", "estrategista").motivo).toBe("escolhido");
  });
});

describe("a escolha é lembrada por cliente, cada escopo na sua coluna", () => {
  it("lê a coluna do escopo, manda o campo certo e grava pela RPC com o escopo", async () => {
    montar("refino");
    await waitFor(() => expect(screen.getByTestId("modelo").textContent).toBe("openrouter:anthropic/claude-fable-5.1"));
    expect(screen.getByTestId("motivo").textContent).toBe("escolhido");
    expect(JSON.parse(screen.getByTestId("corpo").textContent || "{}")).toEqual({ modelo_refino_id: "openrouter:anthropic/claude-fable-5.1" });
    expect(colunasLidas).toContain("modelo_refino_id");
    fireEvent.click(screen.getByText("trocar"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("definir_modelo_do_cliente", { _client_id: "c1", _escopo: "refino", _modelo_id: "openrouter:anthropic/claude-opus-5.5" }));
  });

  it("copy sem escolha guardada fica no padrão e manda modelo_copy_id", async () => {
    montar("copy");
    await waitFor(() => expect(screen.getByTestId("motivo").textContent).toBe("padrao_copy"));
    expect(JSON.parse(screen.getByTestId("corpo").textContent || "{}")).toEqual({ modelo_copy_id: "openrouter:anthropic/claude-opus-5.5" });
  });

  it("a migration cria as colunas separadas e a RPC que confere o acesso", () => {
    const sql = ler("supabase/migrations/20261023140000_modelos_por_escopo.sql");
    for (const c of ["modelo_copy_id", "modelo_refino_id", "modelo_estrategista_id"]) expect(sql).toContain(`add column if not exists ${c} text`);
    expect(sql).toContain("function public.definir_modelo_do_cliente(_client_id uuid, _escopo text, _modelo_id text)");
    expect(sql).toContain("public.can_access_client(_client_id)");
    expect(sql).toContain("_escopo not in ('copy', 'refino', 'estrategista')");
  });
});

describe("no Estúdio, sem escolha, o seletor mostra o diretor de arte", () => {
  it("mostra \"Padrão (diretor de arte)\" e não manda modelo; o servidor sem escolha devolve null", async () => {
    const { SeletorDoModeloDoEscopo } = await import("@/components/mesa/ModeloDaCopyDoConteudo");
    function Tela() {
      const e = useModeloDoEscopo("copy");
      return (
        <div>
          <SeletorDoModeloDoEscopo estado={e} padraoDoLugar={{ rotulo: "diretor de arte", modelo: CATALOGO[0] as never }} />
          <p data-testid="escolhido">{JSON.stringify(e.corpoEscolhido)}</p>
        </div>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Tela />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Padrão \(diretor de arte\): GPT-6\.1 Sol/)).toBeTruthy());
    expect(screen.getByTestId("escolhido").textContent).toBe("{}");
  });
});
