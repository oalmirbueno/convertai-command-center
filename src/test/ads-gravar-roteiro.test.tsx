import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Ads > Estúdio > Vídeo > "Gravar nós mesmos" (23/10/2026): o modo
 * Gravar não muda o Higgsfield; roteiro completo e só fala; geração pela Mesa
 * Roteiros com custo antes e Jev (2 versões, sem laço); PDF com capa, cenas e
 * teleprompter; vínculo com o criativo; subir o vídeo pelo fluxo existente.
 */

const mock = vi.hoisted(() => ({
  roteiros: vi.fn(),
  videos: vi.fn(),
  subir: vi.fn(),
  handoff: vi.fn(),
  revisao: vi.fn(),
  baixar: vi.fn(),
  consultas: [] as Array<{ tabela: string; filtros: Array<[string, unknown]> }>,
  linhas: [] as unknown[],
  lembrada: null as unknown,
  arquivos: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const reg = { tabela, filtros: [] as Array<[string, unknown]> };
    mock.consultas.push(reg);
    const b: any = {};
    for (const m of ["select", "neq", "not", "in", "is", "or", "order", "limit"]) b[m] = () => b;
    b.eq = (c: string, v: unknown) => (reg.filtros.push([c, v]), b);
    b.maybeSingle = () => Promise.resolve({ data: mock.lembrada, error: null });
    b.single = () => Promise.resolve({ data: { id: "node-1", client_id: "cliente", kind: "file", name: "v.mp4", mime: "video/mp4", size_bytes: 10, storage_path: "p", sent_for_approval_file_id: null }, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: tabela === "roteiros" ? mock.linhas : [], error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { from: (t: string) => consulta(t), functions: { invoke: vi.fn() } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "cliente", clientName: "Padaria Real", userId: "user-1", catalogo: [], atualizarCusto: vi.fn() }) }));
vi.mock("@/components/sistema/useEstadoDaTela", () => ({ useEstadoDaTela: (_: string, inicial: unknown) => useState(inicial) }));
vi.mock("@/components/mesa/BancadaDaPauta", () => ({ PreviaDaPauta: ({ nome }: { nome: string }) => <div>Prévia {nome}</div> }));
vi.mock("@/lib/mesa/api", async (original) => ({ ...(await original<typeof import("@/lib/mesa/api")>()), padraoPara: () => ({ id: "modelo-1" }) }));
// O botão da casa: o custo estimado aparece antes, no rótulo; o clique executa.
vi.mock("@/components/mesa/Custo", () => ({
  BotaoComCusto: ({ rotulo, partes, executar, aoConcluir, disabled }: any) => {
    const p = partes();
    return <button disabled={disabled} data-partes={JSON.stringify(p)} onClick={() => void executar().then((d: unknown) => aoConcluir && aoConcluir(d, 0))}>{rotulo} ~custo</button>;
  },
}));
vi.mock("@/components/mesa-roteiros/roteirosApi", () => ({ chamarRoteiros: mock.roteiros }));
vi.mock("@/components/mesa-roteiros/pdfNoNavegador", () => ({ baixarBytes: mock.baixar }));
vi.mock("@/components/mesa-videos/videosApi", () => ({
  chamarMesaVideos: mock.videos,
  chaveDosArquivos: (c: string) => ["mesa-videos", "arquivos", c],
  subirVideos: mock.subir,
  useArquivosDeVideo: () => ({ data: { arquivos: mock.arquivos } }),
}));
vi.mock("@/lib/workspaceFileHandoff", () => ({ handoffWorkspaceFileToFiles: mock.handoff }));
vi.mock("@/lib/fileApprovalActions", () => ({ requestFileAgencyReview: mock.revisao }));
vi.mock("@/components/mesa-ads/adsApi", async (original) => ({ ...(await original<typeof import("@/components/mesa-ads/adsApi")>()), lerOfertas: () => Promise.resolve([{ id: "oferta-1", nome: "Pão de fermentação natural", promessa: "Pão quente às 17h" }]) }));
vi.mock("@/components/mesa-ads/VideoDoCriativo", () => ({ default: (p: { criativo: { id: string }; referencia?: string | null }) => <div>Higgsfield {p.criativo.id} {p.referencia}</div> }));

import VideoOuGravacao from "@/components/mesa-ads/VideoOuGravacao";
import GravarDoCriativo from "@/components/mesa-ads/GravarDoCriativo";
import type { CriativoAds, PlanoAds } from "@/components/mesa-ads/adsApi";
import { corpoDaGravacao, lerRoteiroDoCriativo, OPCOES_PADRAO, partesDaGravacao } from "@/components/mesa-ads/roteiroDoAnuncio";
import { ehSoFala, gerarPdfDoAnuncio, nomeDoPdfDoAnuncio, tempoDeLeitura } from "@/components/mesa-ads/pdfDoRoteiroDoAnuncio";
import { paginasDoPdf, textosDoPdf } from "../../supabase/functions/_shared/pdf-base";
import { normalizarRoteiro, type Roteiro } from "../../supabase/functions/_shared/roteiro-modelo";
import {
  BUSCAS_WEB_DO_ANUNCIO,
  escolherVersao,
  ESQUEMA_DO_ROTEIRO_DE_ANUNCIO,
  estruturasPelaRegra,
  fontesDaWeb,
  lerPedidoDoAnuncio,
  notasDasVersoes,
  perguntasDaEscolha,
  TAMANHO_DO_ANUNCIO,
} from "../../supabase/functions/mesa-roteiros/modulos/roteiro-de-anuncio";

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const CRIATIVO_ID = "0f6b3c1e-2d4a-4b5c-8d9e-0a1b2c3d4e5f";
const ROTEIRO_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const criativo = { id: CRIATIVO_ID, client_id: "cliente", nome: "Pão quente", plano_id: "plano-1", angulo_id: "a1", copy: { titulo: "Pão quente às 17h", texto_principal: "Pão de fermentação natural", cta_meta: "Enviar mensagem" } } as unknown as CriativoAds;
const plano = { id: "plano-1", nome: "Plano", angulos: [], estrutura: { oferta_id: "oferta-1" } } as unknown as PlanoAds;

function roteiroDeTeste(soFala = false): Roteiro {
  return normalizarRoteiro({
    titulo: "Anúncio · Pão quente às 17h",
    subtitulo: "Gancho, problema, demonstração, prova, oferta e CTA",
    tipo: "ugc",
    formato: "9:16",
    duracao_alvo_s: 30,
    ganchos: [{ texto: "Sabe por que o pão de mercado endurece em uma hora?", mecanismo: "pergunta", promessa: "explicar", motivo: "dor real" }],
    gancho_escolhido: 0,
    blocos: [
      { funcao: "Gancho", fala: "Sabe por que o pão de mercado endurece em uma hora?", segundos: 3, visual: soFala ? "" : "Close no pão partindo", texto_na_tela: soFala ? "" : "Pão que endurece?", broll: "" },
      { funcao: "Demonstração", fala: "Aqui a massa descansa vinte e quatro horas antes de assar.", segundos: 8, visual: soFala ? "" : "Plano médio do forno", texto_na_tela: soFala ? "" : "24 h de descanso", broll: "" },
      { funcao: "CTA", fala: "Chama no WhatsApp e reserva o seu para as 17h.", segundos: 4, visual: soFala ? "" : "Plano aberto do balcão", texto_na_tela: "", broll: "" },
    ],
    direcao: soFala ? undefined : { enquadramento: "Vertical", ambiente: "Balcão da padaria às 17h", figurino: "Avental da casa", objetos: "Pão, faca", luz: "Natural", camera: "Celular na mão", orientacoes: ["Corte seco entre cenas"] },
    cta: "Chama no WhatsApp e reserva o seu.",
    pendencias: ["Confirmar o horário da fornada"],
  }, { formato: "9:16", duracao_s: 30 });
}
const linhaDe = (r: Roteiro) => ({ id: ROTEIRO_ID, client_id: "cliente", titulo: r.titulo, tipo: r.tipo, status: "rascunho", versao_atual: 1, versoes: [{ numero: 1, conteudo: r, origem: "ia" }], comentarios: [] });

function abrir(el: JSX.Element) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>);
}

beforeEach(() => {
  [mock.roteiros, mock.videos, mock.subir, mock.handoff, mock.revisao, mock.baixar].forEach((f) => f.mockReset());
  mock.consultas = [];
  mock.linhas = [];
  mock.lembrada = null;
  mock.arquivos = [];
});

describe("modo Gravar ao lado do Higgsfield", () => {
  it("abre no Gerar com IA com o mesmo componente e as mesmas props; Gravar não monta o Higgsfield", async () => {
    abrir(<VideoOuGravacao criativo={criativo} plano={plano} referencia="cliente/capa.png" />);
    expect(await screen.findByText(`Higgsfield ${CRIATIVO_ID} cliente/capa.png`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Gravar nós mesmos/ }));
    expect(await screen.findByText("Roteiro para a equipe gravar")).toBeInTheDocument();
    expect(screen.queryByText(/^Higgsfield/)).toBeNull();
    expect(mock.videos).not.toHaveBeenCalled();
  });

  it("o gerador do Higgsfield continua o mesmo arquivo; o Estúdio só troca o import para a área com os dois modos", () => {
    const estudio = ler("src/components/mesa-ads/AbaEstudioAds.tsx");
    expect(estudio).toContain('lazy(() => import("./VideoOuGravacao"))');
    expect(ler("src/components/mesa-ads/VideoOuGravacao.tsx")).toContain('import("./VideoDoCriativo")');
    expect(ler("src/components/mesa-ads/VideoDoCriativo.tsx")).not.toContain("Gravar");
  });
});

describe("pedido, estruturas e escolha do Jev (puro)", () => {
  it("valida modo, formato e duração; estrutura automática propõe duas diferentes", () => {
    expect(lerPedidoDoAnuncio({ ads_criativo_id: CRIATIVO_ID, modo: "fala", formato: "4:5", duracao_s: 15 })).toMatchObject({ modo: "fala", formato: "4:5", duracaoS: 15, estrutura: null, web: true });
    expect(lerPedidoDoAnuncio({ ads_criativo_id: CRIATIVO_ID, modo: "completo", formato: "1:1", duracao_s: 30 })).toHaveProperty("erro");
    expect(lerPedidoDoAnuncio({ ads_criativo_id: CRIATIVO_ID, modo: "completo", formato: "9:16", duracao_s: 20 })).toHaveProperty("erro");
    expect(lerPedidoDoAnuncio({ ads_criativo_id: "x", modo: "completo", formato: "9:16", duracao_s: 30 })).toHaveProperty("erro");
    const [a, b] = estruturasPelaRegra("O cliente acha caro, tem dúvida do preço");
    expect(a.id).toBe("objecao_resposta");
    expect(b.id).not.toBe(a.id);
    expect(a.cenas[0]).toMatch(/0 a 3 s/);
  });

  it("2 versões no esquema; o Jev pontua gancho, clareza, venda e nicho por versão e a maior vence, sem laço", () => {
    expect((ESQUEMA_DO_ROTEIRO_DE_ANUNCIO.schema.properties.versoes as any).items.required).toContain("estrutura_id");
    const q = perguntasDaEscolha(2);
    expect(Object.keys(q).sort()).toEqual(["clareza_v1", "clareza_v2", "gancho_v1", "gancho_v2", "nicho_v1", "nicho_v2", "venda_v1", "venda_v2"]);
    Object.values(q).forEach((x) => expect(x.type === "score" && x.criteria.length === 5).toBe(true));
    const notas = notasDasVersoes({ gancho_v1: { score: 1 }, clareza_v1: { score: 2 }, venda_v1: { score: 1 }, nicho_v1: { score: 2 }, gancho_v2: { score: 4 }, clareza_v2: { score: 3 }, venda_v2: { score: 3 }, nicho_v2: { score: 2 } }, 2);
    const e = escolherVersao(notas);
    expect(e).toMatchObject({ indice: 1, como: "jev" });
    expect(e.porque).toContain("gancho");
    expect(escolherVersao(notasDasVersoes(null, 2))).toMatchObject({ indice: 0, como: "regra" });
  });

  it("referência da web só com página citada pela busca", () => {
    expect(fontesDaWeb([{ url: "https://exemplo.com/a", titulo: "A" }, { url: "javascript:x" }, { url: "https://exemplo.com/a" }])).toEqual([{ titulo: "A", url: "https://exemplo.com/a" }]);
  });
});

describe("geração pela Mesa Roteiros (servidor)", () => {
  const fonte = ler("supabase/functions/mesa-roteiros/index.ts");
  const trecho = fonte.slice(fonte.indexOf("async function anuncioGerar"), fonte.indexOf("function aprenderDoAjuste"));
  it("ação registrada e longa; uma geração com método, motor de copy viral, ganchos e base ads.video; Jev escolhe", () => {
    expect(fonte).toMatch(/anuncio_gerar: anuncioGerar/);
    expect(fonte).toContain('const ACOES_LONGAS_DO_ANUNCIO = new Set(["anuncio_gerar"]);');
    expect(fonte).toContain("ACOES_LONGAS_DO_ANUNCIO.has(acao) ? respostaComFolego");
    expect(trecho).toContain("metodo: sp");
    expect(trecho).toContain('formato: "anuncio"');
    expect(trecho).toContain('formato: "reels_abertura"');
    expect(trecho).toContain('agente: "ads.video"');
    expect(trecho).toContain("perguntasDaEscolha(versoes.length)");
    expect(trecho).toContain("cobrarJev(res");
    // Sem laço: um pedido ao modelo (o segundo só quando a busca na web falha).
    expect(trecho.match(/await pedir\(/g)).toHaveLength(2);
    expect(trecho).toContain("ads_criativo_id: criativo.id, ads_oferta_id: ofertaId");
  });
  it("custo antes: a tela soma geração, busca na web e Jev; o estimar da função conhece o anúncio", () => {
    const partes = partesDaGravacao("modelo-1", { modo: "fala", web: true });
    expect(partes[0]).toMatchObject({ modeloId: "modelo-1", tipo: "texto", ...TAMANHO_DO_ANUNCIO.fala, buscasWeb: BUSCAS_WEB_DO_ANUNCIO });
    expect(partes[1].fixoUsd).toBeGreaterThan(0);
    expect(partesDaGravacao("m", { modo: "completo", web: false })[0].buscasWeb).toBe(0);
    expect(fonte).toContain('alvo === "anuncio"');
  });
  it("migração do vínculo com o timestamp combinado", () => {
    const sql = ler("supabase/migrations/20261023130000_roteiros_do_anuncio.sql");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS ads_criativo_id uuid REFERENCES public\.ads_criativos/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS ads_oferta_id uuid/);
  });
});

describe("PDF do roteiro do anúncio", () => {
  const base = { cliente: "Padaria Real", criativo: "Pão quente às 17h", oferta: "Pão de fermentação natural", cta: "Enviar mensagem", versao: 2, rascunho: true, data: "2026-10-23T12:00:00Z" };
  it("completo: capa com cliente, oferta e formato; tabela de cenas; direção; teleprompter", () => {
    const bytes = gerarPdfDoAnuncio({ ...base, roteiro: roteiroDeTeste(), modo: "completo" });
    const t = textosDoPdf(bytes).join("\n");
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 8))).toBe("%PDF-1.4");
    expect(paginasDoPdf(bytes)).toBeGreaterThanOrEqual(4);
    expect(t).toContain("Padaria Real");
    expect(t).toContain("9:16");
    expect(t).toContain("OFERTA");
    expect(t).toContain("Tabela de cenas");
    expect(t).toContain("Close no pão partindo");
    expect(t).toContain("Texto da fala");
    expect(t).toContain("Confirmar antes de gravar: Confirmar o horário da fornada");
    expect(nomeDoPdfDoAnuncio("Padaria Real", "Anúncio · Pão quente às 17h", 2)).toBe("roteiro-anuncio-padaria-real-pao-quente-as-17h-r2.pdf");
  });
  it("só a fala: capa e teleprompter, sem tabela de cenas, com o tempo de leitura", () => {
    const r = roteiroDeTeste(true);
    expect(ehSoFala(r)).toBe(true);
    const t = textosDoPdf(gerarPdfDoAnuncio({ ...base, roteiro: r, modo: "fala" })).join("\n");
    expect(t).not.toContain("Tabela de cenas");
    expect(t).toContain("Texto da fala");
    expect(tempoDeLeitura(r).total).toBeGreaterThan(5);
  });
});

describe("tela do Gravar: gerar, reabrir, PDF e subir o vídeo gravado", () => {
  it("vínculo: lê pelo criativo; sem a coluna/linha, pelo id lembrado", async () => {
    mock.lembrada = linhaDe(roteiroDeTeste());
    const l = await lerRoteiroDoCriativo("cliente", CRIATIVO_ID, ROTEIRO_ID);
    expect(l && l.id).toBe(ROTEIRO_ID);
    expect(mock.consultas[0].filtros).toContainEqual(["ads_criativo_id", CRIATIVO_ID]);
    expect(mock.consultas[1].filtros).toContainEqual(["id", ROTEIRO_ID]);
  });

  it("gera pela Mesa Roteiros com o contexto do criativo; só fala manda modo fala", async () => {
    mock.roteiros.mockResolvedValue({ roteiro: linhaDe(roteiroDeTeste(true)), escolha: { indice: 0, como: "jev", porque: "Versão 1, nota 4,0 contra 3,1.", estrutura: "ugc_falado", notas: [] }, referencias: [], vinculo: { gravado: true, aviso: null } });
    abrir(<GravarDoCriativo criativo={criativo} plano={plano} />);
    fireEvent.click(screen.getByRole("tab", { name: /Só a fala/ }));
    fireEvent.change(screen.getByLabelText("Duração"), { target: { value: "15" } });
    const botao = screen.getByRole("button", { name: /Gerar roteiro ~custo/ });
    expect(JSON.parse(botao.getAttribute("data-partes") || "[]")[0]).toMatchObject({ tokensSaida: TAMANHO_DO_ANUNCIO.fala.tokensSaida });
    fireEvent.click(botao);
    await waitFor(() => expect(mock.roteiros).toHaveBeenCalledTimes(1));
    expect(mock.roteiros.mock.calls[0][0]).toBe("anuncio_gerar");
    expect(mock.roteiros.mock.calls[0][1]).toMatchObject({ client_id: "cliente", ads_criativo_id: CRIATIVO_ID, modo: "fala", formato: "9:16", duracao_s: 15, estrutura: "auto", web: true, modelo_id: "modelo-1" });
    expect(corpoDaGravacao("c", CRIATIVO_ID, OPCOES_PADRAO, "m")).toMatchObject({ modo: "completo", duracao_s: 30 });
  });

  it("roteiro guardado aparece com cenas, Baixar PDF, Abrir na Mesa Roteiros; subir o vídeo usa o fluxo existente", async () => {
    mock.linhas = [linhaDe(roteiroDeTeste())];
    mock.subir.mockResolvedValue({ registrados: [{ id: "arq-1" }], recusados: [], aviso: null });
    mock.videos.mockImplementation((c: { acao: string }) => Promise.resolve(c.acao === "final_para_workspace" ? { client_id: "cliente", workspace: { node_id: "node-1" } } : {}));
    mock.handoff.mockResolvedValue({ fileId: "file-1", created: true });
    mock.revisao.mockResolvedValue({});
    abrir(<GravarDoCriativo criativo={criativo} plano={plano} />);
    expect(await screen.findByText("Anúncio · Pão quente às 17h")).toBeInTheDocument();
    expect(screen.getByText("Close no pão partindo", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir na Mesa Roteiros/ })).toHaveAttribute("href", `/mesa-roteiros?client=cliente&etapa=roteiro&roteiro=${ROTEIRO_ID}`);
    fireEvent.click(screen.getByRole("button", { name: /Baixar PDF/ }));
    expect(mock.baixar).toHaveBeenCalledTimes(1);
    expect(mock.baixar.mock.calls[0][1]).toMatch(/^roteiro-anuncio-padaria-real-.*-r1\.pdf$/);
    const arquivo = new File(["x"], "gravado.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("Vídeo gravado"), { target: { files: [arquivo] } });
    await waitFor(() => expect(mock.revisao).toHaveBeenCalledWith("file-1"));
    expect(mock.subir.mock.calls[0][0]).toBe("cliente");
    expect(mock.videos.mock.calls.map((c) => c[0].acao)).toEqual(["arquivo_editar", "final_para_workspace"]);
    expect(mock.videos.mock.calls[0][0]).toMatchObject({ arquivo_id: "arq-1", campos: { roteiro_id: ROTEIRO_ID } });
    expect(mock.handoff.mock.calls[0][0]).toMatchObject({ clientId: "cliente", folder: "materiais", fileType: "creative" });
  });
});
