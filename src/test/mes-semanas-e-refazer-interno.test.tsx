import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SemanasDoMes, { resumoDaMistura, semanasDosItens } from "@/components/mesa/SemanasDoMes";
import { pedidoParaCriar as pedidoParaCriarDaTela } from "@/components/mesa/planoDoMes";
import { normalizarCriacao, pedidoParaCriar as pedidoParaCriarDoServidor, FORMATOS_DA_CRIACAO } from "../../supabase/functions/agente-calendario/agente-mes-v2";
import { aplicarAjusteDoPlano } from "../../supabase/functions/agente-calendario/modulos/cadencia-do-mes";
import {
  autorizarChamadaInterna,
  corpoDoLoteRefeito,
  criadorPodeRefazer,
  linhasDaPropostaAntiga,
  orientacaoDaMensagem,
} from "../../supabase/functions/agente-calendario/modulos/refazer-interno";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fonte = ler("supabase/functions/agente-calendario/index.ts");
const PROPOSTA = "6f1c2a3b-1111-4222-8333-444455556666";
const TAREFA = "7f1c2a3b-1111-4222-8333-444455556666";

describe("criar conteúdos do agente do Mês com peça de foto", () => {
  it("normalizarCriacao aceita foto e guarda a direção no contrato", () => {
    expect(FORMATOS_DA_CRIACAO).toContain("foto");
    const c = normalizarCriacao({
      resumo: "",
      orientacao: "",
      itens: [
        { data: "2026-10-05", formato: "foto de produto", tema: "Armação tartaruga no rosto", referencia: "", foto: { assunto: "Armação tartaruga", angulos: ["frontal", "3/4"], cenario: "balcão da loja", luz: "natural", pessoa: null, quantidade: 4, texto_na_foto: null, referencias: [] } },
        { data: "2026-10-07", formato: "carrossel", tema: "Quanto custa uma lente boa", referencia: "", foto: null },
      ],
    }, "2026-10-02")!;
    expect(c.itens.map((i) => i.formato)).toEqual(["foto", "carrossel"]);
    expect(c.itens[0].foto).toMatchObject({ assunto: "Armação tartaruga", angulos: ["frontal", "3/4"], quantidade: 4, pessoa: null });
    expect(c.itens[1].foto).toBeUndefined();
    // O texto do lote leva a direção da foto e é o mesmo na tela e no servidor.
    const t = pedidoParaCriarDoServidor(c.itens, "Linguagem direta");
    expect(t).toContain("- 2026-10-05 · foto · Armação tartaruga no rosto\n  Direção da foto: Assunto: Armação tartaruga;");
    expect(pedidoParaCriarDaTela(c.itens, "Linguagem direta")).toBe(t);
  });

  it("o ajuste preenche vagas na data e no formato da vaga e refaz o item apontado", () => {
    const itens = [{ data: "2026-10-05", formato: "foto" as const, formato_pedido: null, tema: "Entenda as lentes", referencia: "", foto: null }];
    const vagas = [{ data: "2026-10-07", semana: "2026-W41", formato: "carrossel" as const }, { data: "2026-10-09", semana: "2026-W41", formato: "foto" as const }];
    const r = aplicarAjusteDoPlano(itens, vagas, {
      ajustes: [{ item: 1, tema: "Lente que não cansa a vista no computador", referencia: "", foto: { assunto: "Lente", angulos: ["frontal", "detalhe"], cenario: "mesa de trabalho", luz: "janela", pessoa: "mulher de 35 anos", quantidade: 4, texto_na_foto: null, referencias: [] } }],
      novos: [{ vaga: 2, tema: "Óculos de sol para o fim de semana", referencia: "", foto: { assunto: "Óculos de sol", angulos: ["3/4", "no rosto"], cenario: "praia", luz: "fim de tarde", pessoa: null, quantidade: 3, texto_na_foto: null, referencias: [] } }, { vaga: 9, tema: "fora", referencia: "", foto: null }],
    });
    expect(r.preenchidas).toBe(1);
    expect(r.refeitos).toBe(1);
    expect(r.itens.map((i) => [i.data, i.formato, i.tema])).toEqual([
      ["2026-10-05", "foto", "Lente que não cansa a vista no computador"],
      ["2026-10-09", "foto", "Óculos de sol para o fim de semana"],
    ]);
    expect(r.itens[1].foto!.quantidade).toBe(3);
  });

  it("servidor: foto vira peça de foto da Mesa Foto, o lote fixa data e formato e a resposta traz a conferência", () => {
    expect(fonte).toContain('{ mesa: "foto" as const, titulo: texto(o.tema, 200), foto: normalizarDirecaoDeFoto(o.foto,');
    expect(fonte).toContain("const pecasDoLote = lerPecasDoLote(corpo.pecas);");
    expect(fonte).toContain("Conferido: ${conferencia.frase}");
    expect(fonte).toContain("tituloDaPecaDeFoto(item.tema");
    // A mistura decidida não é desfeita pelo equilíbrio do perfil (alternar).
    expect(fonte).toContain('if (itensComTarefa.some((i) => i.formato === "foto")) {');
    // Título de tutorial volta para reescrever no detalhar e no pedido livre.
    expect(fonte.match(/await corrigirTutoriais\(/g)!.length).toBe(2);
  });
});

describe("tela do Mês por semana", () => {
  const itens = [
    { tema_id: "p1", data: "2026-10-05", formato: "foto", tema: "Armação tartaruga no rosto", foto: { assunto: "Armação", objetivo: "", angulos: ["frontal", "3/4"], cenario: "loja", luz: "natural", pessoa: null, quantidade: 4, texto_na_foto: null, referencias: [] } },
    { tema_id: "p2", data: "2026-10-07", formato: "carrossel", tema: "Quanto custa uma lente boa", task_id: TAREFA },
    { tema_id: "p3", data: "2026-10-09", formato: "foto", tema: "Óculos de sol para dirigir" },
    { tema_id: "p4", data: "2026-10-12", formato: "estatico", tema: "Exame de vista sem fila" },
  ];

  it("agrupa por semana com a contagem e a mistura", () => {
    const s = semanasDosItens(itens);
    expect(s.map((x) => x.inicio)).toEqual(["2026-10-05", "2026-10-12"]);
    expect(resumoDaMistura(s[0].formatos)).toBe("3 posts · 2 fotos e 1 carrossel");
    expect(resumoDaMistura(s[1].formatos)).toBe("1 post · 1 estático");
  });

  it("uma linha por conteúdo: chip do formato, Mesa Foto com a peça escolhida, Estúdio no gravado e troca de formato", async () => {
    const onEditar = vi.fn().mockResolvedValue(undefined);
    const onAbrir = vi.fn();
    render(
      h(MemoryRouter, { initialEntries: ["/mesa?client=c1&aba=mes"] },
        h(SemanasDoMes, { itens, itensDaProposta: itens, clientId: "c1", propostaId: PROPOSTA, editavel: true, esperadoPorSemana: 3, acoes: { onEditar, onAbrirNoEstudio: onAbrir } }),
      ),
    );
    const semanas = screen.getAllByText(/^Semana de /);
    expect(semanas.map((x) => x.textContent)).toEqual(["Semana de 05/10", "Semana de 12/10"]);
    expect(screen.getByText("3 posts · 2 fotos e 1 carrossel")).toBeTruthy();
    expect(screen.getByText("abaixo de 3 por semana")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Abrir na Mesa Foto" });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe(`/mesa-foto?client=c1&peca=${PROPOSTA}:0&volta=${encodeURIComponent("/mesa?client=c1&aba=mes")}`);
    expect(links[1].getAttribute("href")).toContain(`peca=${PROPOSTA}:2`);
    fireEvent.click(screen.getByRole("button", { name: "Abrir no Estúdio" }));
    expect(onAbrir).toHaveBeenCalledWith(TAREFA, "2026-10-01");
    // O detalhe abre na própria linha com a direção da foto.
    fireEvent.click(screen.getByRole("button", { name: /Armação tartaruga no rosto/ }));
    expect(within(document.querySelector("[data-direcao-da-foto]") as HTMLElement).getByText("Ângulos: frontal, 3/4")).toBeTruthy();
    // Trocar o formato pelo chip (estático vira foto).
    const chip = screen.getByRole("button", { name: "Formato: Estático. Trocar" });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Foto/ }));
    expect(onEditar).toHaveBeenCalledWith(expect.objectContaining({ tema_id: "p4" }), { formato: "foto" });
  });
});

describe("refazer_proposta_interno", () => {
  const base = { authorization: "Bearer chave-servico", cronSecretDoPedido: "segredo-x", chavesDeServico: ["chave-servico", null], cronSecret: "segredo-x" };

  it("recusa sem o x-cron-secret, com segredo errado, sem segredo configurado e sem a chave de serviço", () => {
    expect(autorizarChamadaInterna(base)).toEqual({ ok: true });
    expect(autorizarChamadaInterna({ ...base, cronSecretDoPedido: null })).toMatchObject({ ok: false, status: 401 });
    expect(autorizarChamadaInterna({ ...base, cronSecretDoPedido: "segredo-y" })).toMatchObject({ ok: false, status: 401 });
    expect(autorizarChamadaInterna({ ...base, cronSecret: "" })).toMatchObject({ ok: false, status: 401 });
    expect(autorizarChamadaInterna({ ...base, authorization: "Bearer token-de-usuario" })).toMatchObject({ ok: false, status: 403 });
    expect(autorizarChamadaInterna({ ...base, authorization: null })).toMatchObject({ ok: false, status: 403 });
  });

  it("recusa autor que não é da equipe ou sem acesso ao cliente (regra de can_access_client)", () => {
    expect(criadorPodeRefazer({ staff: false, papeis: ["admin"], atribuido: true }).ok).toBe(false);
    expect(criadorPodeRefazer({ staff: true, papeis: ["design"], atribuido: false }).ok).toBe(false);
    expect(criadorPodeRefazer({ staff: true, papeis: ["client"], atribuido: true }).ok).toBe(false);
    expect(criadorPodeRefazer({ staff: true, papeis: ["admin"], atribuido: false }).ok).toBe(true);
    expect(criadorPodeRefazer({ staff: true, papeis: ["manager"], atribuido: true }).ok).toBe(true);
  });

  it("reaproveita os parâmetros guardados (anexos, campanha, modelo, projeto) e as linhas da proposta antiga", () => {
    const antiga = {
      client_id: "11111111-0000-4000-8000-000000000001",
      project_id: "22222222-0000-4000-8000-000000000002",
      parametros: { origem: "pedido_livre", mensagem: "Crie estes conteúdos...\nOrientação da equipe para todos: Linguagem direta para o cliente", anexos: ["a/1.png"], campanha_id: "33333333-0000-4000-8000-000000000003", modelo: "openrouter:x" },
    };
    expect(orientacaoDaMensagem(antiga.parametros.mensagem)).toBe("Linguagem direta para o cliente");
    const linhas = linhasDaPropostaAntiga([
      { data: "2026-10-07", formato: "estatico", tema: "Entenda o astigmatismo", gancho: "Você vê borrado?", resumo: "Explica" },
      { data: "2026-10-05", formato: "carrossel", tema: "Lente para dirigir" },
      { data: "sem", formato: "carrossel", tema: "x" },
    ]);
    expect(linhas.map((l) => [l.data, l.formato, l.tema])).toEqual([["2026-10-05", "carrossel", "Lente para dirigir"], ["2026-10-07", "estatico", "Entenda o astigmatismo"]]);
    expect(linhas[1].referencia).toBe("Você vê borrado? · Explica");
    const corpo = corpoDoLoteRefeito(antiga, "texto do lote", linhas);
    expect(corpo).toEqual({
      acao: "pedido_livre",
      client_id: antiga.client_id,
      mensagem: "texto do lote",
      pecas: linhas,
      anexos: ["a/1.png"],
      campanha_id: antiga.parametros.campanha_id,
      modelo_id: "openrouter:x",
      project_id: antiga.project_id,
    });
  });

  it("no servidor: a ação interna passa antes da sessão, confere o autor com is_staff e as atribuições e nunca grava", () => {
    const serve = fonte.slice(fonte.indexOf("Deno.serve("));
    expect(serve.indexOf("if (acao === ACAO_REFAZER_INTERNO)")).toBeGreaterThan(-1);
    expect(serve.indexOf("if (acao === ACAO_REFAZER_INTERNO)")).toBeLessThan(serve.indexOf("await identificar(req, servico)"));
    expect(serve).toContain('cronSecretDoPedido: req.headers.get("x-cron-secret")');
    expect(serve).toContain('cronSecret: await chave("CRON_SECRET")');
    const autor = fonte.slice(fonte.indexOf("async function chamadorDoAutor("), fonte.indexOf("async function refazerPropostaInterno("));
    expect(autor).toContain('servico.rpc("is_staff", { _user_id: autor })');
    expect(autor).toContain('from("team_client_assignments")');
    expect(autor).toContain("criadorPodeRefazer(");
    const refazer = fonte.slice(fonte.indexOf("async function refazerPropostaInterno("), fonte.indexOf("Deno.serve("));
    expect(refazer).not.toContain("gravarItens(");
    expect(refazer).not.toContain(".delete()");
    expect(refazer).toContain("substituida_por");
    // O acesso de chamada interna vale só para o cliente da proposta.
    expect(fonte).toContain("if (chamador.interno.clientId === clientId) return;");
  });
});
