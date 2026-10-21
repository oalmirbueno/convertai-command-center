import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ganchoDaDescricao, ganchoDoHype, hypeNaAgenda, momentoDoGancho } from "@/components/mesa/momentoDoGancho";
import { corpoDoPedidoLivre } from "@/components/mesa/mesaV4Api";

// 17/10 (dono): "quando adiciona na agenda os gerados pelo hype, ele some dali e também marca com o
// foguinho do hype na esteira no Estúdio, onde aparece para gerar".
const ler = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");

describe("hype na agenda", () => {
  it("lê o gancho da descrição e diz se é hype ou nicho", () => {
    const d = "Tema: dia das crianças\nGancho do momento: Hype: Dia das Crianças 2026\nFormato: carrossel";
    expect(ganchoDaDescricao(d)).toBe("Hype: Dia das Crianças 2026");
    expect(momentoDoGancho("Hype: Dia das Crianças")).toBe("hype");
    expect(momentoDoGancho("Nicho: reels de bastidor")).toBe("nicho");
    expect(momentoDoGancho("Concorrente @loja")).toBeNull();
    expect(ganchoDaDescricao("sem gancho")).toBeNull();
  });

  it("o hype some da lista quando um gancho da agenda cita o título (sem acento, sem pontuação)", () => {
    const ganchos = ["Hype: Dia das Crianças 2026.", "Nicho: reels de bastidor"];
    expect(hypeNaAgenda("Dia das crianças 2026", ganchos)).toBe(true);
    expect(hypeNaAgenda("Reels de bastidor", ganchos)).toBe(true);
    expect(hypeNaAgenda("Black Friday", ganchos)).toBe(false);
    // Título curto demais não casa por acaso.
    expect(hypeNaAgenda("Dia", ganchos)).toBe(false);
  });

  it("o pedido do hype leva o hype, e o servidor grava o gancho exato em cada conteúdo", () => {
    const corpo = corpoDoPedidoLivre({ clientId: "c1", mensagem: "oi", hype: { tipo: "nicho", titulo: "Reels de bastidor" } });
    expect(corpo.hype).toEqual({ tipo: "nicho", titulo: "Reels de bastidor" });
    expect(corpoDoPedidoLivre({ clientId: "c1", mensagem: "oi" }).hype).toBeUndefined();
    expect(ganchoDoHype({ tipo: "hype", titulo: "Dia das Crianças" })).toBe("Hype: Dia das Crianças");
    const servidor = ler("supabase/functions/agente-calendario/index.ts");
    expect(servidor).toContain("const ganchoDoPedido = ganchoDoHypeDoPedido(corpo.hype);");
    expect(servidor).toContain("if (ganchoDoPedido) for (const item of itens) item.gancho_do_momento = ganchoDoPedido;");
    // 21/10: o pedido sai das áreas Hype (datas e leitura) e Trending (notícias e nicho), sempre com o hype junto.
    expect(ler("src/components/mesa/AreaDoHype.tsx")).toContain("pedidoLivre({ clientId, mensagem, hype })");
    expect(ler("src/components/mesa/AreaDoHype.tsx")).toContain('{ tipo: "hype", titulo: h.titulo }');
    expect(ler("src/components/mesa/AreaDoTrending.tsx")).toContain('hype: { tipo: "nicho", titulo }');
  });

  it("a esteira do Estúdio mostra o foguinho na lista e no título da pauta", () => {
    expect(ler("src/components/mesa/EstudioLista.tsx")).toContain("data-foguinho={item.momento}");
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("data-foguinho={item.momento}");
    expect(ler("src/components/mesa/useItensDoMes.ts")).toContain("itens = await comMomentoDoGancho(itens);");
    expect(ler("src/components/mesa/pautasPlanejadas.ts")).toContain("momento: momentoDoGancho(gancho)");
  });
});
