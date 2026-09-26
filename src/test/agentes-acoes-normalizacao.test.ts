import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alvosDoTrabalho,
  arquivarVersoesDaLamina,
  devolverVersoesDaLamina,
  MOTIVO_CONTINUO,
  MOTIVO_ENTREGUE,
  normalizarAcoesDoDiretor,
  ordemInversa,
  ordemPedida,
  ordensParaGerarDeNovo,
  reordenarTrabalho,
  trocarTextoDaLamina,
  type TrabalhoParaAcoes,
} from "../../supabase/functions/estudio-arte/acoes-do-diretor";
import { alvosDoAcervo, etiquetaPedida, type FotoDoAcervo, pastaPedida } from "../../supabase/functions/_shared/acoes-do-acervo";
import { alvosDoWorkspace, type NoDoWorkspace, regrasDoWorkspace } from "../../supabase/functions/_shared/acoes-do-workspace";
import { normalizarAcaoDoAgente } from "../../supabase/functions/_shared/acoes-do-agente";
import { blocoDasAcoesDoContexto, normalizarAcoesDoContexto, pedeAcaoNoContexto } from "../../supabase/functions/agente-contexto/acoes-do-contexto";
import { blocoDasAcoesDaMesaFoto, normalizarAcoesDaMesaFoto, pedeAcaoNasFotos } from "../../supabase/functions/mesa-foto/acoes-da-mesa-foto";
import {
  campanhasComApelido,
  normalizarAcoesNaAgenda,
  normalizarGeracao,
  pecasComApelido,
  pedidoParaRefazer,
  type PecaDaAgenda,
} from "../../supabase/functions/agente-calendario/acoes-agenda";
import { ehPedidoNaAgenda, geracaoDaMensagem, pedidoParaRefazer as pedidoParaRefazerDaTela } from "@/components/mesa/planoDoMes";

const ID = (n: number) => `${String(n).repeat(8).slice(0, 8)}-0000-4000-8000-000000000000`;

// ------------------------------------------------------------------ Estúdio

function trabalho(extra: Partial<TrabalhoParaAcoes> = {}, direcao: Partial<TrabalhoParaAcoes["direcao"]> = {}): TrabalhoParaAcoes {
  return {
    id: "trab-1",
    status: "pronto",
    entrega_status: null,
    tipo: "social",
    direcao: {
      cards: [
        { ordem: 1, funcao: "capa", texto_exato: "Outono chegou com R$ 99" },
        { ordem: 2, funcao: "conteudo", texto_exato: "Mudas por R$ 99 cada" },
        { ordem: 3, funcao: "cta", texto_exato: "Chame no WhatsApp" },
      ],
      ...direcao,
    },
    cards: [
      { ordem: 1, versao: 1 },
      { ordem: 1, versao: 2 },
      { ordem: 2, versao: 1 },
      { ordem: 3, versao: 1 },
    ],
    ...extra,
  };
}

describe("diretor do Estúdio: ações nas lâminas", () => {
  it("t1 é o trabalho e l{ordem} é a lâmina; o bloco não leva id", () => {
    const alvos = alvosDoTrabalho(trabalho());
    expect(alvos.map((a) => a.ref)).toEqual(["t1", "l1", "l2", "l3"]);
    expect(alvos[1].detalhe).toContain("2 versões");
  });

  it("reordenar: citadas primeiro, resto na ordem; repetida ou inexistente não vale", () => {
    expect(ordemPedida("3,1", [1, 2, 3])).toEqual([3, 1, 2]);
    expect(ordemPedida("l2 l1", [1, 2, 3])).toEqual([2, 1, 3]);
    expect(ordemPedida("1,2,3", [1, 2, 3])).toBeNull();
    expect(ordemPedida("1,1", [1, 2, 3])).toBeNull();
    expect(ordemPedida("4", [1, 2, 3])).toBeNull();
    const a = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "reordenar", ref: "t1", para: "3,1,2" }] }, trabalho());
    expect(a!.itens[0]).toMatchObject({ operacao: "reordenar", para: "3,1,2", para_rotulo: "nova ordem 3,1,2" });
  });

  it("reordenar é travado no carrossel contínuo e em trabalho entregue", () => {
    const c = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "reordenar", ref: "t1", para: "2,1" }] }, trabalho({}, { carrossel_infinito: true }));
    expect(c!.itens).toEqual([]);
    expect(c!.recusados[0].motivo).toBe(MOTIVO_CONTINUO);
    const e = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "refazer", ref: "l1", para: "" }] }, trabalho({ entrega_status: "agendado" }));
    expect(e!.recusados[0].motivo).toBe(MOTIVO_ENTREGUE);
  });

  it("formato: 9:16 e stories viram o formato do post; anúncio não muda por aqui", () => {
    const a = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "mudar_formato", ref: "t1", para: "9:16" }] }, trabalho());
    expect(a!.itens[0]).toMatchObject({ para: "stories_9x16", para_rotulo: "9:16" });
    expect(normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "mudar_formato", ref: "t1", para: "4:5" }] }, trabalho())).toBeNull();
    const ads = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "mudar_formato", ref: "t1", para: "3:4" }] }, trabalho({ tipo: "ads" }));
    expect(ads!.recusados[0].motivo).toContain("Mesa Ads");
    expect(normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "mudar_formato", ref: "l1", para: "9:16" }] }, trabalho())).toBeNull();
  });

  it("trocar texto em várias lâminas só onde o trecho existe; troca antes de refazer", () => {
    const a = normalizarAcoesDoDiretor(
      {
        resumo: "",
        itens: [
          { operacao: "refazer", ref: "l1", para: "" },
          { operacao: "trocar_texto", ref: "l1", para: "R$ 99 => R$ 89" },
          { operacao: "trocar_texto", ref: "l2", para: "R$ 99 => R$ 89" },
          { operacao: "trocar_texto", ref: "l3", para: "R$ 99 => R$ 89" },
        ],
      },
      trabalho(),
    );
    expect(a!.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["trocar_texto:l1", "trocar_texto:l2", "refazer:l1"]);
    expect(a!.ignorados).toEqual(["l3"]);
    const t = trocarTextoDaLamina(trabalho(), 2, "R$ 99 => R$ 89");
    expect((t.patch.direcao.cards as any[])[1].texto_exato).toBe("Mudas por R$ 89 cada");
    expect(t.antes.texto_exato).toBe("Mudas por R$ 99 cada");
    expect(() => trocarTextoDaLamina(trabalho(), 3, "R$ 99 => R$ 89")).toThrow("não está mais no texto");
  });

  it("reordenar junto com ações nas lâminas não entra (a ordem mudaria no meio)", () => {
    const a = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "reordenar", ref: "t1", para: "2,1,3" }, { operacao: "refazer", ref: "l2", para: "" }] }, trabalho());
    expect(a!.itens.map((i) => i.operacao)).toEqual(["refazer"]);
    expect(a!.ignorados).toEqual(["t1"]);
    expect(a!.sem_desfazer).toBe(true);
  });

  it("reordenar e voltar dá o trabalho de antes; capa e fechamento acompanham", () => {
    const t = trabalho();
    const r = reordenarTrabalho(t, [3, 1, 2]);
    expect(r.direcao.cards.map((c) => [c.ordem, c.funcao, c.texto_exato])).toEqual([
      [1, "capa", "Chame no WhatsApp"],
      [2, "conteudo", "Outono chegou com R$ 99"],
      [3, "cta", "Mudas por R$ 99 cada"],
    ]);
    expect(r.cards.filter((v) => v.ordem === 2).length).toBe(2);
    const volta = reordenarTrabalho({ ...t, direcao: r.direcao, cards: r.cards }, ordemInversa([3, 1, 2]));
    expect(volta.direcao.cards.map((c) => c.texto_exato)).toEqual(t.direcao.cards.map((c) => c.texto_exato));
  });

  it("arquivar versões guarda as antigas e o desfazer devolve", () => {
    const t = trabalho();
    const a = arquivarVersoesDaLamina(t, 1);
    expect(a.versoes).toEqual([1]);
    expect(a.patch.cards.filter((v) => v.ordem === 1)).toEqual([{ ordem: 1, versao: 2 }]);
    expect((a.patch.direcao.versoes_arquivadas as any[]).length).toBe(1);
    const d = devolverVersoesDaLamina({ ...t, cards: a.patch.cards, direcao: a.patch.direcao }, 1, [1]);
    expect(d.cards.filter((v) => v.ordem === 1).length).toBe(2);
    expect(d.direcao.versoes_arquivadas).toEqual([]);
    const so1 = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "arquivar_versoes", ref: "l2", para: "" }] }, t);
    expect(so1!.recusados[0].motivo).toContain("só tem a versão atual");
  });

  it("as lâminas a gerar de novo são só as que deram certo", () => {
    const a = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "refazer", ref: "l1", para: "" }, { operacao: "refazer", ref: "l3", para: "" }] }, trabalho())!;
    expect(ordensParaGerarDeNovo({ ...a, resultados: [{ ref: "l1", alvo_id: "1", titulo: "", operacao: "refazer", ok: true }, { ref: "l3", alvo_id: "3", titulo: "", operacao: "refazer", ok: false }] })).toEqual([1]);
  });
});

// ------------------------------------------------------------------ acervo, workspace, contexto e Mesa Foto

const fotos: FotoDoAcervo[] = [
  { id: ID(1), nome: "fachada.jpg", pasta: "Loja", tags: ["fachada"], ativa: true, aprovada: true, origem: "upload", gerada: false },
  { id: ID(2), nome: "ref-pinterest.jpg", pasta: null, tags: ["referencia_web"], ativa: true, aprovada: false, origem: "mesa_foto", gerada: false },
  { id: ID(3), nome: "gerada-1.png", pasta: "Mesa Foto / Ensaios", tags: ["mesa_foto", "gerada", "ensaio:abc"], ativa: true, aprovada: false, origem: "mesa_foto", gerada: true },
];

const nos: NoDoWorkspace[] = [
  { id: ID(4), parent_id: null, kind: "folder", name: "Marca" },
  { id: ID(5), parent_id: ID(4), kind: "folder", name: "Logos" },
  { id: ID(6), parent_id: null, kind: "file", name: "logo-final.png" },
  { id: ID(7), parent_id: null, kind: "folder", name: "Arquivados" },
  { id: ID(8), parent_id: null, kind: "folder", name: "Recebidos", inbox_token: "tok" },
];

describe("acervo e workspace", () => {
  it("pasta e etiqueta chegam limpas", () => {
    expect(pastaPedida("  /Produtos/ Outono / ")).toBe("Produtos / Outono");
    expect(etiquetaPedida("Fachada da Loja")).toBe("fachada_da_loja");
    expect(etiquetaPedida("Promoção")).toBe("promocao");
  });

  it("workspace: pastas primeiro; mover para pasta, raiz ou pasta nova; pasta não entra nela mesma", () => {
    const alvos = alvosDoWorkspace(nos);
    expect(alvos.map((a) => `${a.ref}:${a.titulo}`)).toEqual(["w1:Arquivados", "w2:Marca", "w3:Recebidos", "w4:Logos", "w5:logo-final.png"]);
    const regras = regrasDoWorkspace(alvos);
    const a = normalizarAcaoDoAgente(
      {
        resumo: "",
        itens: [
          { operacao: "mover", ref: "w5", para: "w4" },
          { operacao: "renomear", ref: "w5", para: "logo/principal.png" },
          { operacao: "mover", ref: "w2", para: "w4" },
          { operacao: "mover", ref: "w4", para: "raiz" },
          { operacao: "arquivar", ref: "w1", para: "" },
          { operacao: "arquivar", ref: "w3", para: "" },
          { operacao: "mover", ref: "w2", para: "nova: Clientes 2026" },
        ],
      },
      alvos,
      regras,
      { agente: "contexto" },
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.ref}:${i.para}`)).toEqual([
      `mover:w5:${ID(5)}`,
      "renomear:w5:logo-principal.png",
      "mover:w4:raiz",
      "mover:w2:nova:Clientes 2026",
    ]);
    expect(a.ignorados).toEqual(["w2"]);
    expect(a.recusados.map((r) => r.motivo)).toEqual(["A pasta Arquivados fica onde está.", "Esta pasta recebe os arquivos do cliente e fica onde está."]);
  });

  it("contexto: trocar a logo aponta para a imagem do acervo pelo apelido; lista só entra quando o pedido é de ação", () => {
    const dados = { kit: { logo_path: "c/marca/logo.png", logo_alt_path: null }, referencias: [{ id: ID(9), papel: "identidade", origem: "pinterest", tags: [], leitura: "Paleta terrosa" }], fotos, nos };
    const a = normalizarAcoesDoContexto(
      { resumo: "", itens: [{ operacao: "trocar_logo", ref: "k2", para: "i1" }, { operacao: "trocar_logo", ref: "i1", para: "i1" }, { operacao: "arquivar_referencia", ref: "r1", para: "" }, { operacao: "tirar_marca", ref: "i3", para: "gerada" }] },
      dados,
      "cliente-1",
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.alvo_id}:${i.para}`)).toEqual([`trocar_logo:alternativa:${ID(1)}`, `arquivar_referencia:${ID(9)}:null`]);
    expect(a.itens[0].para_rotulo).toBe("a imagem fachada.jpg");
    expect(a.recusados[0].motivo).toContain("etiqueta é da casa");
    expect(a.contexto).toEqual({ client_id: "cliente-1" });
    const bloco = blocoDasAcoesDoContexto(dados);
    expect(bloco).toContain("k1 | Logo principal do kit | definida");
    expect(bloco).toContain("w5 | logo-final.png");
    expect(bloco).not.toContain(ID(1));
    expect(pedeAcaoNoContexto("organize os arquivos do workspace em pastas")).toBe(true);
    expect(pedeAcaoNoContexto("o público são mães de 30 a 45 anos")).toBe(false);
  });

  it("Mesa Foto: aprovar e mandar para campanha travam referência da internet; campanha pelo apelido", () => {
    const campanhas = [{ id: ID(8), nome: "Dia dos Pais", status: "planejada" }, { id: ID(9), nome: "Antiga", status: "encerrada" }];
    const a = normalizarAcoesDaMesaFoto(
      {
        resumo: "",
        itens: [
          { operacao: "aprovar_foto", ref: "i3", para: "" },
          { operacao: "mandar_para_campanha", ref: "i3", para: "c1" },
          { operacao: "aprovar_foto", ref: "i2", para: "" },
          { operacao: "mandar_para_campanha", ref: "i1", para: "c2" },
          { operacao: "aprovar_foto", ref: "i1", para: "" },
        ],
      },
      fotos,
      campanhas,
      "cliente-1",
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["aprovar_foto:i3", "mandar_para_campanha:i3"]);
    expect(a.itens[1]).toMatchObject({ para: ID(8), para_rotulo: "Dia dos Pais" });
    expect(a.ignorados).toEqual(["i1"]);
    expect(a.recusados.map((r) => r.motivo)).toEqual(["Referência da internet não vira foto do cliente.", "Esta foto já está aprovada."]);
    expect(blocoDasAcoesDaMesaFoto(fotos, campanhas)).toContain("c1 | Dia dos Pais");
    expect(blocoDasAcoesDaMesaFoto(fotos, campanhas)).not.toContain("Antiga");
    expect(pedeAcaoNasFotos("aprove todas as fotos do ensaio")).toBe(true);
    expect(alvosDoAcervo(fotos)[1].detalhe).toContain("não aprovada");
  });
});

// ------------------------------------------------------------------ agente do mês (novas ações)

const tarefas: PecaDaAgenda[] = [
  { id: ID(1), title: "Carrossel outono", due_date: "2026-10-06", delivery_type: "carousel", status: "todo", campanha: "Outono" },
  { id: ID(2), title: "Estático promo", due_date: "2026-10-08", delivery_type: "static", status: "todo" },
  { id: ID(3), title: "Reels bastidor", due_date: "2026-10-10", delivery_type: "reel", status: "todo" },
];

describe("agente do mês: refazer, formato, campanhas e gerar meses", () => {
  it("mudar formato aceita nome em português e combina com mudar a data", () => {
    const pecas = pecasComApelido(tarefas);
    const a = normalizarAcoesNaAgenda(
      { resumo: "", apagar: [], refazer: [], mudar_data: [{ ref: "a2", data: "2026-10-09" }], mudar_formato: [{ ref: "a2", formato: "Carrossel" }, { ref: "a3", formato: "reels" }, { ref: "a1", formato: "podcast" }], editar_campanhas: [] },
      pecas,
    )!;
    expect(a.mudar_data.map((m) => m.task_id)).toEqual([ID(2)]);
    expect(a.mudar_formato.map((m) => [m.task_id, m.formato_para, m.formato_para_nome])).toEqual([[ID(2), "carousel", "carrossel"]]);
    expect(a.ignorados).toEqual(["a3", "a1"]);
  });

  it("refazer não divide a peça com outra ação e tem limite", () => {
    const pecas = pecasComApelido(tarefas);
    const a = normalizarAcoesNaAgenda({ resumo: "", apagar: ["a1"], refazer: ["a1", "a2"], mudar_data: [{ ref: "a2", data: "2026-10-20" }], mudar_formato: [], editar_campanhas: [] }, pecas)!;
    expect(a.apagar.map((i) => i.task_id)).toEqual([ID(1)]);
    expect(a.refazer.map((i) => i.task_id)).toEqual([ID(2)]);
    expect(a.mudar_data).toEqual([]);
    expect(a.resumo).toContain("refazer 1 peça");
  });

  it("editar campanha pelo apelido; período ao contrário não entra; campanha inventada é ignorada", () => {
    const campanhas = campanhasComApelido([
      { id: ID(5), nome: "Antiga", status: "encerrada", periodo_inicio: null, periodo_fim: null },
      { id: ID(6), nome: "Outono", status: "planejada", periodo_inicio: "2026-10-01", periodo_fim: "2026-10-31" },
    ]);
    expect(campanhas.map((c) => `${c.ref}:${c.nome}`)).toEqual(["c1:Outono", "c2:Antiga"]);
    const a = normalizarAcoesNaAgenda(
      {
        resumo: "",
        apagar: [],
        refazer: [],
        mudar_data: [],
        mudar_formato: [],
        editar_campanhas: [
          { ref: "c1", nome: "Outono 2026", status: "encerrada", periodo_inicio: "", periodo_fim: "2026-09-01" },
          { ref: "c9", nome: "X", status: "", periodo_inicio: "", periodo_fim: "" },
        ],
      },
      pecasComApelido(tarefas),
      campanhas,
    )!;
    expect(a.editar_campanhas).toEqual([{ campanha_id: ID(6), nome_atual: "Outono", campos: { nome: "Outono 2026", status: "encerrada" } }]);
    expect(a.ignorados).toEqual(["c9"]);
  });

  it("gerar meses: só de agora até 12 à frente, frequência de 1 a 14, projeto do servidor", () => {
    const g = normalizarGeracao({ resumo: "", meses: ["2026-10", "2026-09", "2026-10-01", "2025-12", "2028-01", "2026-13"], frequencia_semanal: 40 }, "2026-09", { id: "p1", nome: "Social" }, 3)!;
    expect(g.meses).toEqual(["2026-09", "2026-10"]);
    expect(g.frequencia_semanal).toBe(3);
    expect(g.project_id).toBe("p1");
    expect(normalizarGeracao({ resumo: "", meses: ["2025-01"], frequencia_semanal: 3 }, "2026-09", null)).toBeNull();
    expect(geracaoDaMensagem([{ tipo: "acao_agenda" }, g])!.meses).toEqual(["2026-09", "2026-10"]);
  });

  it("o texto do refazer é o mesmo na tela e no servidor, e o modo Criar manda estes pedidos para o agente do mês", () => {
    const itens = [{ titulo: "Carrossel  outono", data: "2026-10-06", formato: "carrossel" }];
    expect(pedidoParaRefazerDaTela(itens)).toBe(pedidoParaRefazer(itens));
    for (const t of ["Refaça os conteúdos da semana", "Crie todos os conteúdos de outubro", "mude o formato do reels para carrossel", "Gere de novo o post de sexta"]) {
      expect(ehPedidoNaAgenda(t)).toBe(true);
    }
    expect(ehPedidoNaAgenda("3 conteúdos para a campanha de outubro")).toBe(false);
  });

  it("o servidor de cada agente liga executar e desfazer", () => {
    const ler = (p: string) => readFileSync(resolve(__dirname, "../../supabase/functions", p), "utf8");
    expect(ler("estudio-arte/index.ts")).toContain("executar_acao_agente: executarAcaoDoDiretor");
    expect(ler("estudio-arte/index.ts")).toContain("desfazer_acao_agente: desfazerAcaoDoDiretor");
    expect(ler("agente-contexto/index.ts")).toContain("executar_acao_agente: executarAcaoDoContexto");
    expect(ler("mesa-foto/index.ts")).toContain("executar_acao_agente: executarAcaoNasFotos");
    expect(ler("agente-calendario/index.ts")).toContain("registrar_geracao: registrarGeracao");
  });
});
