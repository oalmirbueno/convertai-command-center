// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizarAcoesNaAgenda, type PecaComApelido } from "../../supabase/functions/agente-calendario/acoes-agenda";
import { juntarAlvoNaAcao } from "../../supabase/functions/agente-calendario/alvo-citado";
import { formatosAusentes } from "../../supabase/functions/agente-calendario/pedido-do-mes";
import { podeAplicarDireto } from "../../supabase/functions/agente-calendario/execucao-do-mes";
import { desfazerPassosDoFormato } from "../../supabase/functions/agente-calendario/mudanca-de-formato";
import { gravarMidia, planejarMidia, type DepsDaMidia } from "../../supabase/functions/agente-calendario/modulos/midia-da-peca";
import {
  candidatasDoAcervo,
  escolhidasPelasNotas,
  ESQUEMA_DA_MIDIA_DA_PECA,
  midiaDoPedido,
  NOTA_MINIMA_DA_MIDIA,
  tipoDeMidia,
  versoesDoModelo,
} from "../../supabase/functions/agente-calendario/modulos/midia-da-peca-regras";

/**
 * 23/10/2026 (dono: "se eu pedir para mudar os conteúdos e trocar, ele tem que trocar"; "já reconhece fotos no
 * Workspace ou busca na internet; no vídeo, gancho viral"). A mídia da peça vira ação com Confirmar e o item da
 * proposta muda de verdade no banco (banco em memória aqui), com Desfazer.
 */

// ------------------------------------------------------------------ banco em memória (o mínimo do PostgREST que o módulo usa)

type Linha = Record<string, any>;
function bancoEmMemoria(tabelas: Record<string, Linha[]>) {
  let relogio = 0;
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let acao: { tipo: "select" } | { tipo: "update"; valores: Linha } = { tipo: "select" };
    let limite = Infinity;
    let ordem: { col: string; asc: boolean } | null = null;
    const linhas = () => {
      let r = (tabelas[tabela] || []).filter((l) => filtros.every((f) => f(l)));
      if (ordem) r = r.slice().sort((a, b) => (String(a[ordem!.col]) < String(b[ordem!.col]) ? -1 : 1) * (ordem!.asc ? 1 : -1));
      return r.slice(0, limite);
    };
    const executar = () => {
      if (acao.tipo === "update") {
        const alvo = linhas();
        for (const l of alvo) Object.assign(l, JSON.parse(JSON.stringify(acao.valores)), { atualizado_em: `t${++relogio}`, updated_at: `t${relogio}` });
        return { data: alvo.map((l) => ({ id: l.id })), error: null, status: 200 };
      }
      return { data: JSON.parse(JSON.stringify(linhas())), error: null, status: 200 };
    };
    const q: any = {
      select: () => q,
      update: (valores: Linha) => { acao = { tipo: "update", valores }; return q; },
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; },
      is: (c: string, v: unknown) => { filtros.push((l) => (l[c] ?? null) === v); return q; },
      in: (c: string, v: unknown[]) => { filtros.push((l) => v.indexOf(l[c]) >= 0); return q; },
      contains: (c: string, v: unknown[]) => { filtros.push((l) => Array.isArray(l[c]) && v.every((x) => l[c].indexOf(x) >= 0)); return q; },
      order: (col: string, o?: { ascending?: boolean }) => { ordem = { col, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { limite = n; return q; },
      maybeSingle: async () => { const r = executar(); return { data: r.data[0] ?? null, error: null }; },
      single: async () => { const r = executar(); return { data: r.data[0] ?? null, error: null }; },
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro),
    };
    return q;
  };
  return { from, tabelas };
}

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TAREFA = "22222222-2222-4222-8222-222222222222";
const PROPOSTA = "33333333-3333-4333-8333-333333333333";
const FOTO_JARDIM = "44444444-4444-4444-8444-444444444444";
const FOTO_LOGO = "55555555-5555-4555-8555-555555555555";
const FOTO_COZINHA = "66666666-6666-4666-8666-666666666666";

function cenario() {
  return bancoEmMemoria({
    tasks: [{ id: TAREFA, title: "Jardim vertical na varanda", due_date: "2026-11-10", delivery_type: "reel", deleted_at: null, updated_at: "t0" }],
    calendario_propostas: [{
      id: PROPOSTA, client_id: CLIENTE, task_ids: [TAREFA], criado_em: "2026-10-20", atualizado_em: "t0",
      itens: [{ task_id: TAREFA, tema_id: "t1", formato: "video", mesa: "video", tema: "Jardim vertical na varanda", gancho: "Sua varanda pode virar um jardim", video: { estilo: "produto", prompt: "Apresente o produto", referencias: [], narracao: "", formato: "9:16" } }],
    }],
    cliente_imagens: [
      { id: FOTO_LOGO, client_id: CLIENTE, nome: "logo terra flor", categoria: "logo", tags: [], ativa: true, atualizado_em: "3" },
      { id: FOTO_COZINHA, client_id: CLIENTE, nome: "reunião da equipe no escritório", tags: [], ativa: true, atualizado_em: "2" },
      { id: FOTO_JARDIM, client_id: CLIENTE, nome: "jardim vertical varanda projeto Ana", descricao: "parede verde com samambaias", tags: ["jardim"], ativa: true, atualizado_em: "1" },
    ],
  });
}

function deps(db: ReturnType<typeof bancoEmMemoria>, over: Partial<DepsDaMidia> = {}): DepsDaMidia & { pedidos: string[]; estados: unknown[] } {
  const pedidos: string[] = [];
  const estados: unknown[] = [];
  return {
    pedidos,
    estados,
    db,
    julgar: async (state: any) => {
      estados.push(state);
      const respostas: Record<string, { score: number }> = {};
      (state.candidatas as string[]).forEach((c, i) => { respostas[`m${i}`] = { score: /jardim|varanda/.test(c) ? 2.7 : 0.2 }; });
      return respostas;
    },
    escrever: async (pedido) => {
      pedidos.push(pedido);
      return {
        custoUsd: 0.004,
        json: {
          busca_en: "vertical garden balcony",
          versoes: [
            { gancho: "Versão A", cenas: ["varanda vazia"], narracao: "", prompt: "câmera lenta na varanda", estilo: "jardim" },
            { gancho: "Sua varanda vazia em 5 segundos vira isso", cenas: ["varanda vazia", "parede verde"], narracao: "Olha o que dá para fazer", prompt: "travelling da varanda vazia para o jardim vertical", estilo: "transformacao" },
          ],
        },
      };
    },
    prepararViral: async () => ({ bloco: "GANCHOS DO NICHO: ...", nicho: "paisagismo", publico: "casais com apartamento" }),
    escolherViral: async () => [1, 0],
    buscarWeb: async () => [],
    agora: () => "2026-10-23T12:00:00.000Z",
    ...over,
  };
}

describe("mídia da peça: o pedido de troca muda o item de verdade", () => {
  it("vídeo: escolhe a foto do Workspace pelo Jev, a versão mais viral e grava no item; Desfazer volta", async () => {
    const db = cenario();
    const d = deps(db);
    const plano = await planejarMidia(d, { clientId: CLIENTE, taskId: TAREFA, tipo: "video", pedido: "faz um vídeo de inspiração de jardim" });
    // Logo não é candidata; a foto da equipe entra mas não passa da nota mínima.
    expect((d.estados[0] as any).candidatas.join(" ")).not.toContain("logo");
    expect(plano.midia.fonte).toBe("acervo");
    expect(plano.midia.acervo.map((a) => a.id)).toEqual([FOTO_JARDIM]);
    expect(plano.midia.gancho).toBe("Sua varanda vazia em 5 segundos vira isso");
    expect(d.pedidos[0]).toContain("IMAGEM DE PARTIDA ESCOLHIDA DO ACERVO");
    expect(d.pedidos[0]).toContain("faz um vídeo de inspiração de jardim");

    const antes = JSON.parse(JSON.stringify(db.tabelas.calendario_propostas[0].itens));
    const passos = await gravarMidia(db, CLIENTE, TAREFA, plano);
    const item = db.tabelas.calendario_propostas[0].itens[0];
    expect(item.video.referencias).toEqual([FOTO_JARDIM]);
    expect(item.video.estilo).toBe("transformacao");
    expect(item.video.prompt).toContain("Gancho nos 2 primeiros segundos: Sua varanda vazia");
    expect(item.video.narracao).toBe("Olha o que dá para fazer");
    expect(item.midia.resumo).toContain("1 foto do Workspace como imagem de partida");
    expect(item.tema).toBe("Jardim vertical na varanda");

    await desfazerPassosDoFormato(db, passos, CLIENTE);
    expect(db.tabelas.calendario_propostas[0].itens).toEqual(antes);
  });

  it("foto sem foto boa no acervo: busca referência livre (termos em inglês do modelo) e o Jev filtra", async () => {
    const db = cenario();
    db.tabelas.cliente_imagens = db.tabelas.cliente_imagens.filter((f) => f.id !== FOTO_JARDIM);
    const buscadas: string[] = [];
    const d = deps(db, {
      buscarWeb: async (t) => {
        buscadas.push(t);
        return [
          { titulo: "Vertical garden on balcony", imagem_url: "https://x.org/a.jpg", miniatura_url: null, fonte_url: "https://x.org/a", licenca: "CC BY 2.0", autor: "Ana" },
          { titulo: "Office meeting", imagem_url: "https://x.org/b.jpg", miniatura_url: null, fonte_url: "https://x.org/b", licenca: "CC0", autor: null },
        ];
      },
      julgar: async (state: any) => {
        const r: Record<string, { score: number }> = {};
        (state.candidatas as string[]).forEach((c, i) => { r[`m${i}`] = { score: /garden|jardim/i.test(c) ? 2.5 : 0.1 }; });
        return r;
      },
    });
    const plano = await planejarMidia(d, { clientId: CLIENTE, taskId: TAREFA, tipo: "foto" });
    expect(buscadas).toEqual(["vertical garden balcony"]);
    expect(plano.midia.fonte).toBe("internet");
    expect(plano.midia.web.map((w) => w.titulo)).toEqual(["Vertical garden on balcony"]);
    expect(plano.avisos.join(" ")).toContain("suba as fotos no Workspace");
    await gravarMidia(db, CLIENTE, TAREFA, plano);
    expect(db.tabelas.calendario_propostas[0].itens[0].midia.web[0].licenca).toBe("CC BY 2.0");
  });

  it("sem roteiro do Mês: avisa e não grava nada", async () => {
    const db = cenario();
    db.tabelas.calendario_propostas = [];
    await expect(planejarMidia(deps(db), { clientId: CLIENTE, taskId: TAREFA, tipo: "video" })).rejects.toThrow("não tem o roteiro do Mês");
  });
});

describe("ação midia no agente do Mês", () => {
  const pecas: PecaComApelido[] = [
    { id: "a", ref: "a1", title: "5 erros ao escolher a cozinha", due_date: "2026-11-03", delivery_type: "carousel", status: "todo" },
    { id: "b", ref: "a2", title: "Cozinha planejada antes e depois", due_date: "2026-11-05", delivery_type: "reel", status: "todo" },
    { id: "c", ref: "a3", title: "Peça de foto: Bancada de quartzo", due_date: "2026-11-07", delivery_type: "carousel", status: "todo" },
  ];

  it("vídeo numa peça de carrossel muda o formato junto; peça já de vídeo e de foto não", () => {
    const a = normalizarAcoesNaAgenda({ midia: [
      { ref: "a1", tipo: "video", pedido: "inspiração de cozinha" },
      { ref: "a2", tipo: "vídeo" },
      { ref: "a3", tipo: "foto real" },
      { ref: "a9", tipo: "video" },
    ] }, pecas)!;
    expect(a.midia.map((m) => [m.task_id, m.tipo])).toEqual([["a", "video"], ["b", "video"], ["c", "foto"]]);
    expect(a.mudar_formato.map((f) => [f.task_id, f.formato_para])).toEqual([["a", "reel"]]);
    expect(a.ignorados).toEqual(["a9"]);
    expect(a.resumo).toContain("pensar a mídia de 3 peças");
    // Mídia gasta: nunca aplica sem o Confirmar.
    expect(podeAplicarDireto(a)).toBe(false);
    // "faz vídeo" atendido só com midia conta como formato presente (não reprova o pedido).
    expect(formatosAusentes(["video", "foto"], a, null)).toEqual([]);
  });

  it("peça citada com pedido de foto real vira pensar a mídia, não refazer", () => {
    const acao = juntarAlvoNaAcao(null, { tipo: "um", peca: pecas[0], prob: 0.9 }, pecas, "põe foto real nesse post dos 5 erros");
    expect(acao!.refazer).toEqual([]);
    expect(acao!.midia.map((m) => m.task_id)).toEqual(["a"]);
    expect(acao!.mudar_formato.map((f) => f.formato_para)).toEqual(["foto"]);
    // Pedido que não fala de mídia continua refazendo, como antes.
    const outra = juntarAlvoNaAcao(null, { tipo: "um", peca: pecas[0], prob: 0.9 }, pecas, "troca esse conteúdo por outro tema");
    expect(outra!.refazer.map((r) => r.task_id)).toEqual(["a"]);
  });

  it("lê o pedido de mídia em português", () => {
    expect(midiaDoPedido("faz um vídeo de inspiração de cozinha")).toBe("video");
    expect(midiaDoPedido("põe foto real")).toBe("foto");
    expect(midiaDoPedido("troca a imagem desse post")).toBe("foto");
    expect(midiaDoPedido("muda o título")).toBe(null);
    expect(tipoDeMidia("Reels")).toBe("video");
  });
});

describe("regras puras da mídia", () => {
  it("candidatas: sem logo, arte nem referência da internet; o tema primeiro", () => {
    const c = candidatasDoAcervo([
      { id: "1", nome: "IMG_0001" },
      { id: "2", nome: "logo", categoria: "logo" },
      { id: "3", nome: "mesa de jantar", tags: ["referencia_web"] },
      { id: "4", nome: "cozinha planejada branca", descricao: "projeto Silva" },
      { id: "5", nome: "fachada da loja" },
    ], "inspiração de cozinha planejada");
    expect(c.map((f) => f.id)).toEqual(["4", "5"]);
  });

  it("nota mínima e teto", () => {
    const r = escolhidasPelasNotas(["a", "b", "c"].map((id) => ({ id })), { m0: { score: 1.0 }, m1: { score: 2.9 }, m2: { score: NOTA_MINIMA_DA_MIDIA } }, 1);
    expect(r.map((x) => x.id)).toEqual(["b"]);
  });

  it("versões do modelo: só as completas, até 2, estilo conhecido", () => {
    const v = versoesDoModelo({ versoes: [{ gancho: "", prompt: "x" }, { gancho: "G", prompt: "P", cenas: ["a"], estilo: "inexistente" }, { gancho: "H", prompt: "Q" }, { gancho: "I", prompt: "R" }] });
    expect(v.map((x) => x.gancho)).toEqual(["G", "H"]);
    expect(v[0].estilo).toBe("produto");
  });

  it("esquema estrito (tudo obrigatório, sem propriedade extra)", () => {
    const s = ESQUEMA_DA_MIDIA_DA_PECA.schema;
    expect(s.required).toEqual(["busca_en", "versoes"]);
    expect(s.properties.versoes.items.required).toEqual(["gancho", "cenas", "narracao", "prompt", "estilo"]);
    expect(s.additionalProperties).toBe(false);
  });
});
