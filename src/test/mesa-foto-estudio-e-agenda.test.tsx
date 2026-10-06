import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente MF (27/09): Mesa Foto facilitada. Pedidos do dono: "no mesa fotos
 * ainda está confuso", "o agente deixa pronto e dá o caminho", "preparar
 * carrossel na agenda e selecionar as fotos", "um estúdio de fotos", "de
 * qualquer imagem gerada abrir no estúdio de fotos ou na mesa", "só fotos,
 * só artes ou alternar". Aqui: o post de fotos no fluxo das artes (regras e
 * gravação), o formato do perfil no plano do mês, o diretor que faz (direto,
 * teto, caminho e prova) e as telas novas (Criar, Estúdio de fotos, Post na
 * Agenda, menu Usar, persona no acervo).
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lte", "lt", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: vi.fn(),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaCriar from "@/components/mesa-foto/EtapaCriar";
import EtapaEstudio, { larguraQueCabe, raizDaLinhagem, recorteDoFormato, versoesDaLinhagem } from "@/components/mesa-foto/EtapaEstudio";
import EtapaAgenda from "@/components/mesa-foto/EtapaAgenda";
import { MenuDeUso } from "@/components/mesa-foto/UsoDaFoto";
import { AmpliarEUsarDaPersona } from "@/components/mesa-foto/EtapaModelos";
import { paresDaProva } from "@/components/mesa-foto/ProvaDoDiretor";
import CartaoDaGeracao from "@/components/mesa-foto/CartaoDaGeracao";
import { confirmarGeracaoItemAItem } from "@/components/mesa-foto/diretorApi";
import { normalizarFoto, type FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import { CHAVE_DAS_FOTOS_DO_POST } from "@/components/mesa-foto/agendaApi";
import { gravarNaSessao } from "@/components/mesa-foto/sessao";
import {
  artePodeVirarFotos,
  direcaoDoPostDeFotos,
  ehPostDeFotos,
  ErroDoPost,
  estadoDoPostDeFotos,
  formatoDoPerfil,
  fotosDoPost,
  linkDaMesaDoItem,
  mesaDoTrabalho,
  planoDoCaminho,
  podeTrocarAsFotos,
  prepararPostDeFotos,
  reservarPostDeFotos,
  trabalhoParaAsFotos,
  versoesDoPost,
  type FotoDoPost,
  type TrabalhoLido,
} from "../../supabase/functions/_shared/post-de-fotos";
import { equilibrarMesas, perguntasDaMesa, textoDoPerfilParaOPlano } from "../../supabase/functions/agente-calendario/mesa-do-item-regras";
import {
  blocoDoPacote,
  caminhoDaAcaoDoDiretor,
  caminhoDaResposta,
  chamadaDaGeracao,
  destinoDoPost,
  geracaoPodeIrSozinha,
  lerDestinoDoPost,
  lerFoco,
  MAX_FOTOS_SEM_CONFIRMAR,
  montarPacote,
  normalizarAcoesDoDiretor,
  normalizarGeracoesDoDiretor,
  OPERACOES_DIRETAS_DO_DIRETOR,
  pedeParaLevar,
  pedidoDoItem,
  regrasDoDiretor,
  TETO_SEM_CONFIRMAR_USD,
  type EntradaDoPacote,
} from "../../supabase/functions/mesa-foto/diretor-agentico";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TASK = "44444444-4444-4444-8444-444444444444";
const TRAB = "55555555-5555-4555-8555-555555555555";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const F2 = "aaaaaaaa-0000-4000-8000-000000000002";
const F3 = "aaaaaaaa-0000-4000-8000-000000000003";
const G1 = "aaaaaaaa-0000-4000-8000-000000000011";
const WEB = "aaaaaaaa-0000-4000-8000-000000000021";
const UUID_NO_TEXTO = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const fotoDoPost = (id: string, extra: Partial<FotoDoPost> = {}): FotoDoPost => ({
  id,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/originais/${id}.jpg`,
  nome: `foto ${id.slice(-2)}.jpg`,
  largura: 1600,
  altura: 2000,
  gerada: false,
  aprovada: true,
  ativa: true,
  tags: [],
  descricao: null,
  ...extra,
});

// ------------------------------------------------------------------ banco de mentira (post de fotos)

type Linha = Record<string, any>;
function bancoFalso(inicial: { trabalhos?: Linha[]; fotos?: Linha[]; arquivos?: string[] } = {}) {
  const tabelas: Record<string, Linha[]> = {
    estudio_trabalhos: (inicial.trabalhos || []).map((t) => ({ ...t })),
    cliente_imagens: (inicial.fotos || []).map((f) => ({ ...f })),
  };
  const arquivos = new Set(inicial.arquivos || []);
  const escritas: { tabela: string; tipo: string; valor: any }[] = [];
  const from = (tabela: string) => {
    const filtros: ((r: Linha) => boolean)[] = [];
    let patch: Linha | null = null;
    let novo: Linha | null = null;
    const b: any = {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq: (c: string, v: unknown) => {
        filtros.push((r) => r[c] === v);
        return b;
      },
      in: (c: string, v: unknown[]) => {
        filtros.push((r) => v.indexOf(r[c]) >= 0);
        return b;
      },
      update: (p: Linha) => {
        patch = p;
        return b;
      },
      insert: (p: Linha) => {
        novo = { atualizado_em: "t0", ...p };
        return b;
      },
    };
    const executar = () => {
      const lista = tabelas[tabela] || (tabelas[tabela] = []);
      if (novo) {
        lista.push(novo);
        escritas.push({ tabela, tipo: "insert", valor: novo });
        return [novo];
      }
      const achados = lista.filter((r) => filtros.every((f) => f(r)));
      if (patch) {
        achados.forEach((r) => Object.assign(r, patch, { atualizado_em: `${r.atualizado_em}+` }));
        escritas.push({ tabela, tipo: "update", valor: patch });
      }
      return achados;
    };
    b.maybeSingle = () => Promise.resolve({ data: executar()[0] || null, error: null });
    b.single = () => Promise.resolve({ data: executar()[0] || null, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: executar(), error: null }).then(ok, erro);
    return b;
  };
  const storage = {
    from: () => ({
      list: (_pasta: string, o: { search: string }) => Promise.resolve({ data: Array.from(arquivos).filter((c) => c.endsWith(o.search)).map((c) => ({ name: c.split("/").pop() })), error: null }),
      download: () => Promise.resolve({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), error: null }),
      upload: (caminho: string) => {
        arquivos.add(caminho);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { db: { from, storage }, tabelas, escritas, arquivos };
}

// ================================================================== post de fotos (regras)

describe("post de fotos no fluxo das artes: regras", () => {
  it("as fotos entram na ordem pedida, sem repetir; referência da internet e arquivada ficam de fora com o motivo", () => {
    const lidas = [fotoDoPost(F1), fotoDoPost(F2), fotoDoPost(WEB, { tags: ["referencia_web"] }), fotoDoPost(F3, { ativa: false })];
    const r = fotosDoPost([F2, F1, F2, WEB, F3, "nao-e-uuid"], lidas);
    expect(r.fotos.map((f) => f.id)).toEqual([F2, F1]);
    expect(r.recusadas.map((x) => [x.id, x.motivo])).toEqual([
      [WEB, "Referência da internet é uso interno: não vai ao ar."],
      [F3, "Esta foto está arquivada."],
    ]);
    // Carrossel do Instagram: até 10 fotos.
    const muitas = Array.from({ length: 12 }, (_, i) => fotoDoPost(`aaaaaaaa-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`));
    const cheio = fotosDoPost(muitas.map((f) => f.id), muitas);
    expect(cheio.fotos).toHaveLength(10);
    expect(cheio.acima).toBe(2);
  });

  it("cada lâmina É a foto (versão 1, nada gerado), com o formato do conjunto para a entrega aceitar", () => {
    const fotos = [fotoDoPost(F1, { descricao: "mesa posta com o produto" }), fotoDoPost(F2, { gerada: true, aprovada: false })];
    const direcao = direcaoDoPostDeFotos({ titulo: "Bastidores", formato: "quadrado_1x1", fotos });
    expect(ehPostDeFotos(direcao)).toBe(true);
    expect(direcao.formato).toBe("quadrado_1x1");
    expect((direcao.cards as any[]).map((c) => [c.ordem, c.texto_exato, c.imagens_ids])).toEqual([[1, "", [F1]], [2, "", [F2]]]);
    expect(String(direcao.conceito)).toContain("sem arte, sem texto na imagem");
    expect(String(direcao.conceito)).toContain("(imagem gerada)");
    const versoes = versoesDoPost({ fotos, caminhos: fotos.map((f) => ({ caminho: f.storage_path, como: "foto" as const })), formato: "quadrado_1x1", userId: "u-1", agora: "2026-09-27T10:00:00Z" });
    expect(versoes.map((v) => [v.ordem, v.versao, v.storage_path, v.origem, v.formato_post, v.custo_usd])).toEqual([
      [1, 1, fotos[0].storage_path, "foto", "quadrado_1x1", 0],
      [2, 1, fotos[1].storage_path, "foto", "quadrado_1x1", 0],
    ]);
    // 4:5 fica sem o campo, como no Estúdio.
    expect(direcaoDoPostDeFotos({ titulo: "x", formato: "feed_4x5", fotos }).formato).toBeUndefined();
  });

  it("foto grande usa a cópia média do painel; de outro bucket, cópia sem mexer nos pixels na pasta do post", () => {
    expect(planoDoCaminho(fotoDoPost(F1), CLIENTE, TRAB, 1).preferido).toEqual({ caminho: `${CLIENTE}/foto/originais/${F1}.jpg`, como: "foto" });
    const grande = planoDoCaminho(fotoDoPost(F1, { largura: 4000, altura: 5000 }), CLIENTE, TRAB, 1);
    expect(grande.preferido).toEqual({ caminho: `${CLIENTE}/foto/originais/${F1}.jpg.media.jpg`, como: "media" });
    expect(grande.reserva && grande.reserva.como).toBe("foto");
    const fora = planoDoCaminho(fotoDoPost(F1, { storage_bucket: "files", storage_path: `${CLIENTE}/grupo/v1/foto.png` }), CLIENTE, TRAB, 3);
    expect(fora.preferido).toEqual({ caminho: `${CLIENTE}/foto/posts/${TRAB}/3-${F1}.png`, como: "copia" });
  });

  it("as fotos só mudam antes de ir para a aprovação (ou depois de um pedido de ajuste); arte sem nada gerado pode virar fotos", () => {
    expect(podeTrocarAsFotos({ entrega_status: null })).toBe(true);
    expect(podeTrocarAsFotos({ entrega_status: "reprovado" })).toBe(true);
    for (const e of ["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado", "precisa_de_atencao"]) expect(podeTrocarAsFotos({ entrega_status: e }), e).toBe(false);
    expect(artePodeVirarFotos({ status: "dirigido", cards: [], file_ids: [] })).toBe(true);
    expect(artePodeVirarFotos({ status: "gerando", cards: [{ ordem: 1 }], file_ids: [] })).toBe(false);
    const arte = { id: TRAB, client_id: CLIENTE, task_id: TASK, tipo: "social", status: "pronto", direcao: {}, cards: [{ ordem: 1 }], file_ids: [], atualizado_em: "t" } as TrabalhoLido;
    expect(() => trabalhoParaAsFotos([arte], null)).toThrow(ErroDoPost);
    const ads = { ...arte, tipo: "ads" };
    expect(trabalhoParaAsFotos([ads], null)).toEqual({ alvo: null, converte: false });
    const reservado = { ...arte, status: "dirigido", cards: [], direcao: { so_fotos: true } };
    expect(trabalhoParaAsFotos([reservado], null)).toEqual({ alvo: reservado, converte: false });
  });

  it("estado do post em palavras curtas e o próximo passo; o item abre na mesa certa", () => {
    expect(estadoDoPostDeFotos({ cards: [] }).codigo).toBe("sem_fotos");
    expect(estadoDoPostDeFotos({ cards: [{}], legenda: "" }).codigo).toBe("falta_legenda");
    expect(estadoDoPostDeFotos({ cards: [{}], legenda: "oi" }).codigo).toBe("pronto");
    expect(estadoDoPostDeFotos({ cards: [{}], status: "entregue", file_ids: ["x"] }).codigo).toBe("falta_enviar");
    expect(estadoDoPostDeFotos({ cards: [{}], entrega_status: "aguardando_cliente" }).rotulo).toBe("com o cliente");
    expect(estadoDoPostDeFotos({ cards: [{}], entrega_status: "agendado" }, { status: "published" }).codigo).toBe("publicado");
    expect(linkDaMesaDoItem(CLIENTE, TASK, "foto")).toBe(`/mesa-foto?client=${CLIENTE}&etapa=agenda&task=${TASK}`);
    expect(linkDaMesaDoItem(CLIENTE, TASK, "arte", "2026-10-01")).toBe(`/mesa?client=${CLIENTE}&aba=estudio&task=${TASK}&mes=2026-10-01`);
    expect(mesaDoTrabalho({ direcao: { so_fotos: true } })).toBe("foto");
    expect(mesaDoTrabalho({ direcao: {} })).toBe("arte");
    expect(formatoDoPerfil("alternar")).toBe("alternar");
    expect(formatoDoPerfil(null)).toBe("artes");
    expect(formatoDoPerfil("outra")).toBe("artes");
  });
});

describe("post de fotos: gravação (banco de mentira)", () => {
  it("cria o trabalho do item com as fotos como lâminas (tipo social, pronto, sem custo) e prefere a cópia média", async () => {
    const f = bancoFalso({
      fotos: [
        { ...fotoDoPost(F1), client_id: CLIENTE },
        { ...fotoDoPost(F2, { largura: 4000, altura: 5000 }), client_id: CLIENTE },
      ],
      arquivos: [`${CLIENTE}/foto/originais/${F2}.jpg.media.jpg`],
    });
    const r = await prepararPostDeFotos(f.db, { clientId: CLIENTE, taskId: TASK, titulo: "Bastidores", imagemIds: [F2, F1], userId: "u-1" });
    expect(r.criado).toBe(true);
    const t = r.trabalho as any;
    expect(t.tipo).toBe("social");
    expect(t.status).toBe("pronto");
    expect(t.custo_usd).toBe(0);
    expect(t.direcao.so_fotos).toBe(true);
    expect(t.cards.map((c: any) => c.storage_path)).toEqual([`${CLIENTE}/foto/originais/${F2}.jpg.media.jpg`, `${CLIENTE}/foto/originais/${F1}.jpg`]);
    // Nada foi gerado: nenhuma escrita além do trabalho.
    expect(f.escritas.map((e) => `${e.tabela}:${e.tipo}`)).toEqual(["estudio_trabalhos:insert"]);
  });

  it("post já entregue (sem enviar) troca as fotos subindo a rodada; com o cliente, recusa; arte com versões, recusa", async () => {
    const entregue = { id: TRAB, client_id: CLIENTE, task_id: TASK, tipo: "social", status: "entregue", entrega_status: null, entrega_rodada: 1, direcao: { so_fotos: true, fotos: { imagem_ids: [F1] } }, cards: [{ ordem: 1 }], file_ids: ["arq-1"], atualizado_em: "t1" };
    const f = bancoFalso({ trabalhos: [entregue], fotos: [{ ...fotoDoPost(F1), client_id: CLIENTE }, { ...fotoDoPost(F2), client_id: CLIENTE }] });
    const r = await prepararPostDeFotos(f.db, { clientId: CLIENTE, taskId: TASK, titulo: "Post", imagemIds: [F1, F2], userId: "u-1" });
    expect(r.criado).toBe(false);
    expect((r.trabalho as any).entrega_rodada).toBe(2);
    expect((r.trabalho as any).status).toBe("pronto");
    expect((r.trabalho as any).direcao.reaberturas[0].motivo).toBe("Fotos trocadas na Mesa Foto");

    const comCliente = bancoFalso({ trabalhos: [{ ...entregue, entrega_status: "aguardando_cliente" }], fotos: [{ ...fotoDoPost(F1), client_id: CLIENTE }] });
    await expect(prepararPostDeFotos(comCliente.db, { clientId: CLIENTE, taskId: TASK, titulo: "Post", imagemIds: [F1], userId: "u-1" })).rejects.toMatchObject({ codigo: "post_em_aprovacao" });

    const arte = bancoFalso({ trabalhos: [{ ...entregue, direcao: {}, status: "pronto", file_ids: [] }], fotos: [{ ...fotoDoPost(F1), client_id: CLIENTE }] });
    await expect(prepararPostDeFotos(arte.db, { clientId: CLIENTE, taskId: TASK, titulo: "Post", imagemIds: [F1], userId: "u-1" })).rejects.toMatchObject({ codigo: "item_com_arte" });
  });

  it("o plano reserva o post de fotos uma vez só (idempotente) e sem fotos", async () => {
    const f = bancoFalso();
    const a = await reservarPostDeFotos(f.db, { clientId: CLIENTE, taskId: TASK, titulo: "Bastidores", userId: "u-1" });
    const b = await reservarPostDeFotos(f.db, { clientId: CLIENTE, taskId: TASK, titulo: "Bastidores", userId: "u-1" });
    expect(a.criado).toBe(true);
    expect(b.criado).toBe(false);
    expect(f.tabelas.estudio_trabalhos).toHaveLength(1);
    expect(f.tabelas.estudio_trabalhos[0].status).toBe("dirigido");
    expect(f.tabelas.estudio_trabalhos[0].cards).toEqual([]);
  });
});

// ================================================================== formato do perfil no plano

describe("formato do perfil no plano do mês", () => {
  it("alternar: metade e metade pela probabilidade de foto (Jev); sem o Jev, alterna pela data; o que a equipe marcou fica", () => {
    expect(equilibrarMesas([0.9, 0.1, 0.8, 0.2], [null, null, null, null])).toEqual(["foto", "arte", "foto", "arte"]);
    expect(equilibrarMesas([0.2, 0.3, 0.95, 0.4], [null, null, null, null])).toEqual(["arte", "arte", "foto", "foto"]);
    expect(equilibrarMesas([null, null, null, null], [null, null, null, null])).toEqual(["arte", "foto", "arte", "foto"]);
    // A equipe já pôs um na Mesa Foto: sobra uma vaga de foto, para o mais "foto" dos livres.
    expect(equilibrarMesas([null, 0.6, 0.9, 0.1], ["foto", null, null, null])).toEqual(["foto", "arte", "foto", "arte"]);
  });

  it("uma Choice por item (foto ou arte), todas numa chamada; o texto do perfil vai ao planejador só quando não é 'só artes'", () => {
    const { state, questions } = perguntasDaMesa([{ data: "2026-10-01", tema: "Bastidores" }, { data: "2026-10-03", tema: "5 dicas" }]);
    expect(Object.keys(questions)).toEqual(["mesa_0", "mesa_1"]);
    expect(questions.mesa_0.type).toBe("choice");
    expect(Object.keys((questions.mesa_0 as any).criteria)).toEqual(["foto", "arte"]);
    expect((state.itens as any[]).map((i) => i.tema)).toEqual(["Bastidores", "5 dicas"]);
    expect(textoDoPerfilParaOPlano("artes")).toBeNull();
    expect(textoDoPerfilParaOPlano("fotos")).toContain("Mesa Foto");
    expect(textoDoPerfilParaOPlano("alternar")).toContain("metade");
  });

  it("o agente do Mês marca a mesa ao gravar, reserva o post de fotos e não dá direção de arte ao item de fotos", () => {
    const f = ler("supabase/functions/agente-calendario/index.ts");
    const gravar = f.slice(f.indexOf("async function gravarItens("), f.indexOf("async function registrarMemoriaDaEscolha("));
    expect(gravar).toContain('await marcarMesasDoPlano(servico, p.client_id, itensComTarefa.filter((i) => i.formato !== "video"),');
    expect(gravar).toContain('criarDirecoesDoRoteiro(servico, p.client_id, itensComTarefa.filter((i) => i.mesa !== "foto" && i.formato !== "video"), chamador.userId)');
    expect(gravar).toContain("await reservarPostsDoPlano(servico, p.client_id, itensComTarefa, chamador.userId)");
    expect(gravar.indexOf("marcarMesasDoPlano")).toBeLessThan(gravar.indexOf("salvarProposta(servico, p,"));
    // O Jev do "alternar" mora fora do index (as contagens do index ficam as mesmas).
    expect(ler("supabase/functions/agente-calendario/mesa-do-item.ts")).toContain("await jevPerguntar({ state, questions }");
    expect(f).toContain("formato_do_perfil: textoDoPerfilParaOPlano(");
  });
});

// ================================================================== estudio-arte

describe("estudio-arte: post de fotos sem gerar arte", () => {
  const e = ler("supabase/functions/estudio-arte/index.ts");
  it("fotos_preparar está nas ações; gerar, ajustar, corrigir e a direção de arte recusam o post de fotos", () => {
    expect(e).toContain("...acoesDasFotosNaAgenda({ servico, garantirAcesso, json, erro: (status, codigo, mensagem) => new ErroEstudio(status, codigo, mensagem) }).acoes,");
    const editavel = e.slice(e.indexOf("function garantirEditavel("), e.indexOf("function garantirEditavel(") + 600);
    expect(editavel).toContain('if (ehPostDeFotos(t.direcao)) throw new ErroEstudio(409, "post_de_fotos"');
    const preparar = e.slice(e.indexOf("async function preparar(ch"), e.indexOf("// O que o cliente já tem entra sozinho"));
    expect(preparar).toContain("(await liberarItemParaArte(db, clientId, item.tarefa.id)).bloqueado");
    expect(preparar).toContain('if (ehPostDeFotos(existente.direcao)) throw new ErroEstudio(409, "post_de_fotos"');
    const acao = ler("supabase/functions/estudio-arte/fotos-na-agenda.ts");
    expect(acao).toContain("prepararPostDeFotos(db(), {");
    expect(acao).toContain("criarItemDoPostDeFotos(db(), {");
  });
});

// ================================================================== diretor que faz

function entrada(extra: Partial<EntradaDoPacote> = {}): EntradaDoPacote {
  return {
    clientId: CLIENTE,
    cliente: "Loja A",
    foco: lerFoco({ etapa: "acervo", imagem_ids: [F1] }),
    imagens: [
      { id: F1, nome: "mesa.jpg", tags: [], ativa: true, gerada: false, origem: "upload", criado_em: "2026-09-22" },
      { id: F2, nome: "produto.jpg", tags: [], ativa: true, gerada: false, origem: "upload", criado_em: "2026-09-21" },
      { id: WEB, nome: "ref loja.jpg", tags: ["referencia_web"], ativa: true, gerada: false, origem: "referencia_web", criado_em: "2026-09-19" },
    ],
    clones: [],
    prompts: [],
    books: [],
    kits: [],
    personas: [],
    campanhas: [],
    posts: [{ trabalho_id: TRAB, task_id: TASK, titulo: "Bastidores de sexta", data: "2026-10-02", fotos: 0, estado: "sem fotos" }],
    leituras: {},
    lidasNoStorage: [],
    contexto: null,
    ...extra,
  };
}

describe("diretor que faz: post na Agenda, melhorar, caminho e travas", () => {
  it("o pacote lista os posts de fotos com apelido a#, sem UUID no que vai ao modelo, e pede o ir_para", () => {
    const p = montarPacote(entrada());
    expect(p.posts.map((x) => x.ref)).toEqual(["a1"]);
    const bloco = blocoDoPacote(p);
    expect(bloco).toContain("POSTS DE FOTOS NA AGENDA");
    expect(bloco).toContain("a1 | Bastidores de sexta");
    expect(bloco).toContain("post_na_agenda");
    expect(bloco).toContain("melhorar_foto");
    expect(bloco).toContain("ir_para e ir_para_ref");
    expect(UUID_NO_TEXTO.test(bloco)).toBe(false);
  });

  it("post na Agenda: a# vira o post; data vira post novo; referência da internet fica de fora", () => {
    const p = montarPacote(entrada());
    expect(destinoDoPost("a1", p)).toBe(`post:${TRAB}|${TASK}`);
    expect(destinoDoPost("2026-10-09 Vitrine nova", p)).toBe("novo:2026-10-09|Vitrine nova");
    expect(destinoDoPost("2026-02-30 x", p)).toBeNull();
    expect(destinoDoPost("a9", p)).toBeNull();
    expect(lerDestinoDoPost(`post:${TRAB}|${TASK}`)).toEqual({ tipo: "post", trabalho_id: TRAB, task_id: TASK });
    expect(lerDestinoDoPost("novo:2026-10-09|Vitrine nova")).toEqual({ tipo: "novo", data: "2026-10-09", titulo: "Vitrine nova" });
    const i = (id: string) => p.imagens.find((x) => x.id === id)!.ref;
    const acao = normalizarAcoesDoDiretor({ resumo: "Monto o post", itens: [{ operacao: "post_na_agenda", ref: i(F1), para: "a1" }, { operacao: "post_na_agenda", ref: i(F2), para: "a1" }, { operacao: "post_na_agenda", ref: i(WEB), para: "a1" }] }, p)!;
    expect(acao.itens.map((x) => [x.alvo_id, x.para])).toEqual([[F1, `post:${TRAB}|${TASK}`], [F2, `post:${TRAB}|${TASK}`]]);
    expect(acao.itens[0].para_rotulo).toBe("a1 Bastidores de sexta");
    expect(acao.recusados[0].motivo).toContain("uso interno");
  });

  it("faz na hora só o que é seguro: sem custo, com Desfazer e até 5 itens; Arquivos e fotos do clone pedem Confirmar", () => {
    const p = montarPacote(entrada());
    const regras = regrasDoDiretor(p);
    // Toda operação direta que existe neste pacote vem marcada (campanha só aparece com campanha aberta).
    for (const op of OPERACOES_DIRETAS_DO_DIRETOR) if (regras[op]) expect(regras[op].direta, op).toBe(true);
    expect(["arquivar_foto", "aprovar_foto", "post_na_agenda", "abrir_no_estudio", "levar_ao_canvas"].every((op) => regras[op] && regras[op].direta === true)).toBe(true);
    expect(regras.aprovar_e_enviar.direta).toBeUndefined();
    expect(regras.fotos_do_clone.direta).toBeUndefined();
    const i1 = p.imagens.find((x) => x.id === F1)!.ref;
    const arquivar = normalizarAcoesDoDiretor({ resumo: "Arquivo", itens: [{ operacao: "arquivar_foto", ref: i1, para: "" }] }, p)!;
    expect(podeExecutarDireto(arquivar, regras, { pedidoClaro: true }).direto).toBe(true);
    const enviar = normalizarAcoesDoDiretor({ resumo: "Envio", itens: [{ operacao: "aprovar_e_enviar", ref: i1, para: "" }] }, p)!;
    expect(podeExecutarDireto(enviar, regras, { pedidoClaro: true }).direto).toBe(false);
    // Post novo na Agenda cria item: o servidor pede Confirmar (mesmo sendo sem custo).
    expect(ler("supabase/functions/mesa-foto/index.ts")).toContain('String(i.para || "").indexOf("novo:") === 0');
  });

  it("melhorar a foto: modo do Preparar obrigatório (cenário pede o cenário) e a chamada é a do Preparar", () => {
    const p = montarPacote(entrada());
    const i1 = p.imagens.find((x) => x.id === F1)!.ref;
    const linha = (modo: string | null, cenario: string | null = null) => ({ operacao: "melhorar_foto", ref: i1, quantidade: 1, cenario, pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null, modo });
    const ok = normalizarGeracoesDoDiretor([linha("luz_cor")], p)!;
    expect(ok.itens).toHaveLength(1);
    expect(chamadaDaGeracao(pedidoDoItem(ok, "g1")!, CLIENTE)).toEqual({ acao: "preparar", corpo: { client_id: CLIENTE, imagem_id: F1, modo: "luz_cor" } });
    const cen = normalizarGeracoesDoDiretor([linha("cenario", "bancada de travertino")], p)!;
    expect(chamadaDaGeracao(pedidoDoItem(cen, "g1")!, CLIENTE).corpo.cenario).toBe("bancada de travertino");
    expect(normalizarGeracoesDoDiretor([linha(null)], p)!.recusados[0].motivo).toContain("Diga o que melhorar");
    expect(normalizarGeracoesDoDiretor([linha("cenario")], p)!.recusados[0].motivo).toContain("cenário novo");
  });

  it("geração só começa sozinha com ordem clara, custo conhecido até o teto, poucas fotos e saldo", () => {
    const base = { itens: [{ ref: "g1" }] as any, recusados: [], custo_estimado_usd: 0.1, contexto: {} };
    expect(geracaoPodeIrSozinha(base, { pedidoClaro: true, saldoUsd: 5 }).sozinha).toBe(true);
    expect(geracaoPodeIrSozinha(base, { pedidoClaro: false, saldoUsd: 5 }).sozinha).toBe(false);
    expect(geracaoPodeIrSozinha({ ...base, custo_estimado_usd: TETO_SEM_CONFIRMAR_USD + 0.01 }, { pedidoClaro: true, saldoUsd: 5 }).motivo).toContain("acima");
    expect(geracaoPodeIrSozinha({ ...base, itens: Array.from({ length: MAX_FOTOS_SEM_CONFIRMAR + 1 }, (_, k) => ({ ref: `g${k}` })) as any }, { pedidoClaro: true, saldoUsd: 5 }).sozinha).toBe(false);
    expect(geracaoPodeIrSozinha({ ...base, contexto: { custo_incompleto: true } }, { pedidoClaro: true, saldoUsd: 5 }).motivo).toBe("custo sem estimativa");
    expect(geracaoPodeIrSozinha(base, { pedidoClaro: true, saldoUsd: 0.05 }).motivo).toBe("saldo não cobre");
    const idx = ler("supabase/functions/mesa-foto/index.ts");
    const conversa = idx.slice(idx.indexOf("async function agenteConversar("), idx.indexOf("async function agenteAplicar("));
    // O Jev (ordem clara) só é chamado quando a proposta já passou nas outras travas.
    expect(conversa).toContain("if (direto || sozinha) {");
    expect(conversa).toContain('await ehOrdemClara(mensagem, { agente: "diretor de fotografia da Mesa Foto"');
    expect(conversa).toContain("caminho: caminhoDaMensagem,");
  });

  it("todo feito tem caminho interno para a área certa; 'faz e me leva' vai sozinho", () => {
    const post = caminhoDaAcaoDoDiretor({ agente: "diretor", itens: [], resultados: [{ ok: true, operacao: "post_na_agenda", alvo_id: F1, desfazer: { trabalho_id: TRAB, task_id: TASK } }] }, CLIENTE, true);
    expect(post).toEqual({ rotulo: "Abrir o post na Agenda", destino: `/mesa-foto?client=${CLIENTE}&etapa=agenda&task=${TASK}&trabalho=${TRAB}`, abrir_sozinho: true });
    const canvas = caminhoDaAcaoDoDiretor({ agente: "diretor", itens: [], resultados: [{ ok: true, operacao: "levar_ao_canvas", alvo_id: F1, desfazer: { canvas_id: "cv-1" } }] }, CLIENTE);
    expect(canvas).toEqual({ rotulo: "Abrir o Canvas", destino: `/mesa-foto?client=${CLIENTE}&etapa=canvas&canvas=cv-1` });
    const uma = caminhoDaAcaoDoDiretor({ agente: "diretor_geracao", itens: [], resultados: [{ ok: true, operacao: "melhorar_foto", alvo_id: F1, desfazer: { imagem_id: G1 } }] }, CLIENTE);
    expect(uma && uma.destino).toBe(`/mesa-foto?client=${CLIENTE}&etapa=estudio&imagem=${G1}`);
    const nada = caminhoDaAcaoDoDiretor({ agente: "diretor", itens: [], resultados: [{ ok: false, operacao: "arquivar_foto", alvo_id: F1 }] }, CLIENTE);
    expect(nada).toBeNull();
    const p = montarPacote(entrada());
    expect(caminhoDaResposta("estudio", p.imagens[0].ref, p)!.destino).toBe(`/mesa-foto?client=${CLIENTE}&etapa=estudio&imagem=${p.imagens[0].id}`);
    expect(caminhoDaResposta("agenda", "a1", p)!.destino).toBe(`/mesa-foto?client=${CLIENTE}&etapa=agenda&task=${TASK}&trabalho=${TRAB}`);
    expect(caminhoDaResposta("nenhum", null, p)).toBeNull();
    expect(caminhoDaResposta("https://fora.com", null, p)).toBeNull();
    expect(pedeParaLevar("arquiva essas e me leva pra lá")).toBe(true);
    expect(pedeParaLevar("arquiva essas duas")).toBe(false);
  });

  it("parar no meio: o que saiu fica e nada mais é gerado", async () => {
    const acao: any = { tipo: "acao_agente", agente: "diretor_geracao", id: "g", resumo: "", itens: [{ ref: "g1" }, { ref: "g2" }, { ref: "g3" }], ignorados: [], recusados: [], resultados: [] };
    const feitas: string[] = [];
    let parar = false;
    const r = await confirmarGeracaoItemAItem({
      mensagemId: "m",
      acao,
      executar: async (_m, _a, ref) => {
        feitas.push(ref);
        parar = true;
        return { anexo: null, resultado: null, custo_usd: 0.05, repetido: false };
      },
      deveParar: () => parar,
    });
    expect(feitas).toEqual(["g1"]);
    expect(r.parou).toBe(true);
  });

  it("a prova mostra o antes e o depois da melhoria e as fotos mexidas", () => {
    const pares = paresDaProva({
      agente: "diretor_geracao",
      itens: [],
      contexto: { pedidos: { g1: { operacao: "melhorar_foto", alvo_id: F1 }, g2: { operacao: "gerar_clone", alvo_id: "clone" } } },
      resultados: [
        { ref: "g1", alvo_id: F1, titulo: "", operacao: "melhorar_foto", ok: true, desfazer: { imagem_id: G1 } },
        { ref: "g2", alvo_id: "clone", titulo: "", operacao: "gerar_clone", ok: true, desfazer: { imagem_id: F3 } },
      ],
    } as any);
    expect(pares).toEqual([{ antes: F1, depois: G1 }, { antes: null, depois: F3 }]);
  });
});

// ================================================================== telas

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Loja A",
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
});

const valorDaFoto = (extra: Partial<MesaFotoValor> = {}): MesaFotoValor => ({
  kitId: null,
  ensaioId: null,
  imagemId: null,
  escolherKit: vi.fn(),
  escolherEnsaio: vi.fn(),
  irPara: vi.fn(),
  selecionadas: [],
  setSelecionadas: vi.fn(),
  abrirAgente: vi.fn(),
  pedirAoDiretor: vi.fn(),
  abrirNoEstudio: vi.fn(),
  prepararNaAgenda: vi.fn(),
  ...extra,
});

function montar(filho: any, foto: MesaFotoValor, rota = `/mesa-foto?client=${CLIENTE}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, h(MesaFotoProvider, { valor: foto }, filho)))),
  );
}

const linhaDaFoto = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  client_id: CLIENTE,
  nome: `foto ${id.slice(-2)}.jpg`,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/originais/${id}.jpg`,
  origem: "upload",
  pasta: null,
  categoria: null,
  tags: [],
  descricao: null,
  ativa: true,
  derivada_de: null,
  gerada: false,
  modo: null,
  kit_id: null,
  aprovada: false,
  largura: 1600,
  altura: 1200,
  criado_em: "2026-09-20T10:00:00Z",
  ...extra,
});

describe("telas da frente MF", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
    mock.rpc.mockReset();
    mock.tabelas = {};
    try {
      window.sessionStorage.clear();
      window.localStorage.clear();
    } catch {
      /* sem armazenamento */
    }
  });

  it("O que fazer (passo 1): objetivos em termos simples; escolher guarda e leva às Fotos; o avançado fica recolhido", async () => {
    mock.tabelas.foto_kits = [];
    const escolherObjetivo = vi.fn();
    const foto = valorDaFoto({ selecionadas: [F1], escolherObjetivo });
    montar(h(EtapaCriar), foto);
    expect(await screen.findByText("O que você quer produzir?")).toBeTruthy();
    const objetivos = Array.from(document.querySelectorAll("[data-objetivo]")).map((b) => b.getAttribute("data-objetivo"));
    expect(objetivos).toEqual(["combinar", "compor", "melhorar", "variacoes", "modelo", "fundo", "post"]);
    // Nenhum cartão travado: cada um diz o que precisa, e o passo 2 pede.
    expect(Array.from(document.querySelectorAll("[data-objetivo]")).every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect((document.querySelector('[data-objetivo="variacoes"]') as HTMLElement).textContent).toContain("Precisa: fotos do produto");
    fireEvent.click(document.querySelector('[data-objetivo="melhorar"]') as HTMLElement);
    expect(escolherObjetivo).toHaveBeenCalledWith("melhorar", true);
    // As formas avançadas ficam recolhidas (um toque abre) e seguem a um clique.
    fireEvent.click(screen.getByRole("button", { name: /Mais formas de criar/ }));
    const apoios = (await waitFor(() => {
      const el = document.querySelector("[data-apoios-do-criar]");
      if (!el) throw new Error("recolhido");
      return el;
    })) as HTMLElement;
    for (const r of ["Book", "Clones", "Modelos", "Canvas", "Biblioteca"]) expect(within(apoios).getByRole("button", { name: new RegExp(r) })).toBeTruthy();
    fireEvent.click(within(apoios).getByRole("button", { name: /Canvas/ }));
    expect(foto.irPara).toHaveBeenCalledWith("canvas");
  });

  it("O que fazer: com o objetivo escolhido e a foto já marcada, o atalho vai direto ao Estúdio na foto", async () => {
    mock.tabelas.foto_kits = [];
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1)];
    const foto = valorDaFoto({ selecionadas: [F1], objetivo: "melhorar" });
    montar(h(EtapaCriar), foto);
    const atalho = (await waitFor(() => {
      const el = document.querySelector("[data-atalho-da-linha]");
      if (!el) throw new Error("sem atalho");
      return el;
    })) as HTMLElement;
    expect((document.querySelector('[data-objetivo="melhorar"]') as HTMLElement).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(atalho).getByRole("button", { name: /Abrir no Estúdio/ }));
    expect(foto.irPara).toHaveBeenCalledWith("estudio", { imagem: F1 });
  });

  it("Estúdio de fotos: a foto grande com antes e depois, as versões, as ferramentas ao lado e a moldura do recorte do post", async () => {
    mock.tabelas.cliente_imagens = [
      linhaDaFoto(F1),
      linhaDaFoto(G1, { derivada_de: F1, modo: "luz_cor", tags: ["preparo:luz_cor"], criado_em: "2026-09-26T10:00:00Z" }),
    ];
    mock.invoke.mockResolvedValue({ data: { configurada: true, opcoes: [], custo_usd: 0 }, error: null });
    const foto = valorDaFoto({ imagemId: G1 });
    montar(h(EtapaEstudio), foto, `/mesa-foto?client=${CLIENTE}&etapa=estudio&imagem=${G1}`);
    // Abre na versão escolhida, grande; "Lado a lado" mostra o original (antes) junto.
    await screen.findByRole("button", { name: "Lado a lado" });
    expect(screen.queryByText("Antes (original)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lado a lado" }));
    expect(await screen.findByText("Antes (original)")).toBeTruthy();
    expect(document.querySelector("[data-versoes-da-foto]")!.textContent).toContain("Versões desta foto · 2");
    const grupos = Array.from(document.querySelectorAll("[data-grupo-do-estudio]")).map((g) => g.getAttribute("data-grupo-do-estudio"));
    expect(grupos).toEqual(["usar", "melhorar", "logo", "fundo", "angulo", "formato"]);
    // Foto deitada (4:3) no post 4:5: a moldura mostra o recorte, sem véu escuro.
    expect(document.querySelector('[data-recorte-do-post="feed_4x5"]')).toBeTruthy();
    expect(document.querySelector("[data-estudio-de-fotos]")!.innerHTML).not.toMatch(/bg-black|bg-foreground\/[0-9]/);
    fireEvent.click(screen.getByRole("button", { name: /Trocar ângulo/ }));
    expect(foto.setSelecionadas).toHaveBeenCalledWith([G1]);
    expect(String((foto.pedirAoDiretor as any).mock.calls[0][0])).toContain("outros ângulos");
    fireEvent.click(screen.getByRole("button", { name: /Preparar na Agenda/ }));
    expect(foto.prepararNaAgenda).toHaveBeenCalledWith([G1]);
    // Regras de linhagem e de recorte.
    const todas = [normalizarFoto(linhaDaFoto(F1))!, normalizarFoto(linhaDaFoto(G1, { derivada_de: F1 }))!] as FotoDoAcervo[];
    expect(raizDaLinhagem(todas, G1)!.id).toBe(F1);
    expect(versoesDaLinhagem(todas, todas[0]).map((f) => f.id)).toEqual([F1, G1]);
    const r = recorteDoFormato(4 / 3, "feed_4x5");
    expect(r.altura).toBe(1);
    expect(Math.round(r.largura * 1000) / 1000).toBe(0.6);
    expect(recorteDoFormato(0.8, "feed_4x5")).toEqual({ x: 0, y: 0, largura: 1, altura: 1 });
  });

  it("Post na Agenda: as fotos que vieram de Fotos abrem o post montando; Preparar chama fotos_preparar sem custo", async () => {
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1, { aprovada: true }), linhaDaFoto(F2, { aprovada: true })];
    mock.tabelas.mesa_cliente_config = [{ formato_do_perfil: "alternar" }];
    mock.tabelas.projects = [];
    mock.invoke.mockResolvedValue({ data: { trabalho: { id: TRAB, cards: [{}, {}] }, task: { id: TASK, title: "Post" }, item_criado: true, recusadas: [], avisos: [], sem_aprovacao_da_equipe: 0 }, error: null });
    gravarNaSessao(CLIENTE, CHAVE_DAS_FOTOS_DO_POST, [F2, F1]);
    montar(h(EtapaAgenda), valorDaFoto(), `/mesa-foto?client=${CLIENTE}&etapa=agenda`);
    await screen.findByText("Montar o post");
    await waitFor(() => expect(document.querySelectorAll("[data-foto-do-post]").length).toBe(2));
    expect(Array.from(document.querySelectorAll("[data-foto-do-post]")).map((x) => x.getAttribute("data-foto-do-post"))).toEqual([F2, F1]);
    expect(await screen.findByRole("button", { name: /Formato do perfil: Alternar fotos e artes/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Título do post"), { target: { value: "Bastidores" } });
    fireEvent.change(screen.getByLabelText("Dia do post"), { target: { value: "2026-10-02" } });
    fireEvent.click(document.querySelector("[data-preparar-na-agenda]") as HTMLElement);
    await waitFor(() => expect(mock.invoke).toHaveBeenCalled());
    const [funcao, corpo] = mock.invoke.mock.calls.find((c) => c[1].body.acao === "fotos_preparar")!;
    expect(funcao).toBe("estudio-arte");
    expect(corpo.body).toMatchObject({ acao: "fotos_preparar", client_id: CLIENTE, imagem_ids: [F2, F1], formato: "feed_4x5", novo_item: { titulo: "Bastidores", data: "2026-10-02" } });
    expect(typeof corpo.body.pedido_id).toBe("string");
  });

  it("de qualquer foto: o menu Usar abre no Estúdio de fotos e prepara na Agenda", async () => {
    const foto = valorDaFoto();
    const f = normalizarFoto(linhaDaFoto(F1, { aprovada: true }))!;
    montar(h(MenuDeUso, { foto: f }), foto);
    fireEvent.click(screen.getByRole("button", { name: /Usar/ }));
    fireEvent.click(await screen.findByText("Abrir no Estúdio de fotos"));
    await waitFor(() => expect(foto.abrirNoEstudio).toHaveBeenCalledWith(F1));
    fireEvent.click(screen.getByRole("button", { name: /Usar/ }));
    fireEvent.click(await screen.findByText("Preparar na Agenda"));
    await waitFor(() => expect(foto.prepararNaAgenda).toHaveBeenCalledWith([F1]));
  });

  it("persona: Ampliar fiel de verdade leva a imagem ao acervo (sem custo) e mostra as ferramentas pro com o preço antes", async () => {
    mock.invoke.mockImplementation(async (_f: string, o: { body: Record<string, unknown> }) => {
      if (o.body.acao === "modelo_imagem_para_acervo") return { data: { imagem: { ...linhaDaFoto(G1, { gerada: true, tags: ["gerada", "pessoa_sintetica"] }), url: "https://x/y.png" }, ja_existia: false }, error: null };
      return { data: { configurada: true, opcoes: [], custo_usd: 0 }, error: null };
    });
    const persona: any = { id: "p-1", nome: "Lia" };
    const imagem: any = { id: "pi-1", modelo_id: "p-1", papel: "detalhe", vista: null, storage_bucket: "mesa", storage_path: "x.png", url: "", largura: 1088, altura: 1360, aprovada: true };
    montar(h(AmpliarEUsarDaPersona, { persona, imagem }), valorDaFoto());
    fireEvent.click(screen.getByRole("button", { name: /Ampliar fiel \(pro\)/ }));
    await waitFor(() => expect(document.querySelector(`[data-ferramentas-pro="${G1}"]`)).toBeTruthy());
    const pedido = mock.invoke.mock.calls.find((c) => c[1].body.acao === "modelo_imagem_para_acervo")!;
    expect(pedido[0]).toBe("mesa-foto");
    expect(pedido[1].body).toMatchObject({ client_id: CLIENTE, modelo_id: "p-1", imagem_id: "pi-1" });
  });
});

describe("geração barata começa sozinha (resposta nova) e só com a liberação do servidor", () => {
  const acaoDaTela = (irSozinho: boolean): any => ({
    tipo: "acao_agente",
    agente: "diretor_geracao",
    id: "ger-1",
    resumo: "Vou melhorar 1 foto.",
    itens: [{ ref: "g1", alvo_id: F1, titulo: "mesa.jpg", detalhe: null, operacao: "melhorar_foto", rotulo: "foto melhorada", para: null }],
    ignorados: [],
    recusados: [],
    contexto: { pedidos: { g1: { operacao: "melhorar_foto", alvo_id: F1 } }, ...(irSozinho ? { ir_sozinho: true } : {}) },
    custo_estimado_usd: 0.04,
  });
  const montarCartao = (acao: any, iniciarSozinha: boolean, executar: any) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, h(CartaoDaGeracao, { acao, mensagemId: "m-1", executar, iniciarSozinha }))));
  };
  const executarFeito = (acao: any) =>
    vi.fn(async (_m: string, _a: string, ref: string) => {
      const resultado = { ref, alvo_id: F1, titulo: "mesa.jpg", operacao: "melhorar_foto", ok: true, desfazer: { imagem_id: G1, custo_usd: 0.04 } };
      return { anexo: { ...acao, resultados: [resultado], executada_em: "2026-09-27T12:00:00Z" }, resultado, custo_usd: 0.04, repetido: false };
    });

  it("com ir_sozinho e a resposta nova, gera sem o clique (com o custo à vista e Desfazer no fim)", async () => {
    const acao = acaoDaTela(true);
    const executar = executarFeito(acao);
    montarCartao(acao, true, executar);
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector("[data-acao-agente='feita']")).toBeTruthy());
    expect(screen.getByText(/O diretor já está gerando/)).toBeTruthy();
  });

  it("sem a liberação do servidor (ou reabrindo a conversa), espera o Confirmar", async () => {
    const semLiberar = executarFeito(acaoDaTela(false));
    montarCartao(acaoDaTela(false), true, semLiberar);
    const reaberta = executarFeito(acaoDaTela(true));
    montarCartao(acaoDaTela(true), false, reaberta);
    await new Promise((r) => setTimeout(r, 50));
    expect(semLiberar).not.toHaveBeenCalled();
    expect(reaberta).not.toHaveBeenCalled();
  });
});

// ================================================================== textos e compatibilidade

describe("textos de tela e compatibilidade (Safari 11)", () => {
  const arquivos = [
    "src/components/mesa-foto/EtapaEstudio.tsx",
    "src/components/mesa-foto/EtapaAgenda.tsx",
    "src/components/mesa-foto/EtapaCriar.tsx",
    "src/components/mesa-foto/EtapaAprovar.tsx",
    "src/components/mesa-foto/GuiaDaLinha.tsx",
    "src/components/mesa-foto/linhaDeProducao.ts",
    "src/components/mesa-foto/SeletorDoPerfil.tsx",
    "src/components/mesa-foto/ProvaDoDiretor.tsx",
    "src/components/mesa-foto/CartaoDaGeracao.tsx",
    "src/components/mesa-foto/agendaApi.ts",
    "supabase/functions/_shared/post-de-fotos.ts",
  ];
  it("sem travessão e sem regex que o Safari 11 não entende", () => {
    for (const a of arquivos) {
      const t = ler(a);
      expect(t, a).not.toMatch(/[—–]/);
      expect(t, a).not.toMatch(/\(\?<[=!]/);
      expect(t, a).not.toMatch(/\\p\{/);
      expect(t, a).not.toMatch(/\(\?<[a-zA-Z]/);
    }
  });
});

describe("27/09: Estúdio de fotos organizado, com rolagem própria", () => {
  it("a foto cabe inteira na altura do palco; lado a lado divide a largura; no celular segue a largura", () => {
    expect(larguraQueCabe(null, 0.8, 1)).toBeNull();
    // Retrato 4:5 num palco largo e baixo: quem manda é a altura (500 de foto * 0,8).
    expect(larguraQueCabe({ largura: 800, altura: 524 }, 0.8, 1)).toBe(400);
    // Duas fotos quadradas: cada uma fica com metade da largura (menos o vão).
    expect(larguraQueCabe({ largura: 812, altura: 1000 }, 1, 2)).toBe(400);
    // Nunca some: tem um mínimo.
    expect(larguraQueCabe({ largura: 100, altura: 60 }, 1, 1)).toBe(140);
  });

  it("a página não rola no computador: o Estúdio entra em coluna, as ferramentas rolam por dentro e as versões numa tira", () => {
    expect(ler("src/pages/MesaFoto.tsx")).toContain('const ETAPAS_EM_COLUNA: string[] = ["acervo", "estudio"];');
    const fonte = ler("src/components/mesa-foto/EtapaEstudio.tsx");
    expect(fonte).toContain('rotulo="Ferramentas do Estúdio"');
    expect(fonte).toContain("data-tira-de-versoes");
    expect(ler("src/components/mesa-foto/GaleriaDeFotos.tsx")).toContain("overflow-x-auto");
    expect(fonte).toContain("data-barra-do-palco");
  });
});


describe("Galeria de versões profundas", () => {
  it("mantém a origem e todas as versões depois de mais de 16 tratamentos", () => {
    const cadeia = Array.from({ length: 25 }, (_, i) => ({ id: `v${i}`, derivada_de: i ? `v${i - 1}` : null, ativa: true, criado_em: String(i).padStart(2, '0') })) as FotoDoAcervo[];
    const raiz = raizDaLinhagem(cadeia, "v24");
    expect(raiz?.id).toBe("v0");
    expect(versoesDaLinhagem(cadeia, raiz)).toHaveLength(25);
    expect(versoesDaLinhagem(cadeia, raiz)[1].id).toBe("v24");
  });
  it("interrompe uma linhagem circular sem travar a tela", () => {
    const ciclo = [{ id: "a", derivada_de: "b" }, { id: "b", derivada_de: "a" }] as FotoDoAcervo[];
    expect(raizDaLinhagem(ciclo, "a")?.id).toBe("a");
    expect(versoesDaLinhagem(ciclo, { id: "outra" } as FotoDoAcervo)).toHaveLength(1);
  });
});
