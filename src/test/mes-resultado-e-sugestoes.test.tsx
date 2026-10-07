import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SugestoesDoAgente from "@/components/agentes/SugestoesDoAgente";
import { resumoDoRecibo } from "../../supabase/functions/agente-calendario/resultado-da-agenda";
import { camposDoFormato } from "../../supabase/functions/agente-calendario/mudanca-de-formato";
import { direcaoComRoteiro } from "../../supabase/functions/agente-calendario/roteiro-no-estudio";
import { atualizarAgenda } from "@/components/mesa/mesaV4Api";
import { QueryClient } from "@tanstack/react-query";

afterEach(cleanup);
describe("Mês: resultado confirmado e espaço da conversa", () => {
  it("começa recolhido, abre pelo teclado/clique e recolhe sem apagar o pedido", () => {
    render(<><SugestoesDoAgente><button>Revisar o mês</button></SugestoesDoAgente><textarea aria-label="Pedido" defaultValue="Meu texto" /></>);
    expect(screen.queryByRole("button", { name: "Revisar o mês" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sugestões" }));
    expect(screen.getByRole("button", { name: "Recolher sugestões" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Revisar o mês" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recolher sugestões" }));
    expect(screen.queryByRole("button", { name: "Revisar o mês" })).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Meu texto");
  });
  it("não confunde proposta, aplicação parcial, conclusão e desfazer", () => {
    expect(resumoDoRecibo({ textos: [{ ok: true }] })).toBeNull();
    expect(resumoDoRecibo({ executada_em: "hoje", desfeita_em: "depois" })).toBeNull();
    const texto = resumoDoRecibo({ executada_em: "hoje", textos: [{ ok: true }], formatos: [{ ok: false, motivo: "Arte aprovada" }] });
    expect(texto).toContain("1 conteúdo reescrito");
    expect(texto).toContain("1 alteração(ões) não concluída(s). Arte aprovada");
    expect(resumoDoRecibo({ executada_em: "hoje", textos: [{ ok: false }] })).toContain("Nenhuma alteração foi confirmada");
    expect(resumoDoRecibo({ executada_em: "hoje", refeitos: [{ ok: true }] })).toContain("geração ainda precisa ser concluída");
  });
  it("converter de foto/vídeo/carrossel para arte nunca grava direção null", () => {
    for (const formato_para of ["static", "carousel"]) {
      const r = camposDoFormato({ title: "Peça de foto: Produto" }, { formato_para }, { formato: "foto", cards: [{ texto: "Produto" }, { texto: "Detalhe" }] });
      expect(r.direcao).toBeTruthy();
      expect(r.novo.mesa).toBe("arte");
      expect(r.novo.cards.length).toBe(formato_para === "static" ? 1 : 2);
    }
  });
  it("sincroniza copy e prompt do Estúdio preservando referências visuais", () => {
    const marca = { nomeCliente: "Cliente", paleta: [], fontes: [], estilo: null, regras: null, temLogo: false } as any;
    const primeiro = direcaoComRoteiro({}, { tema: "Produto", formato: "estatico", cards: [{ ordem: 1, texto: "Antigo" }] }, marca);
    primeiro.cards[0].referencia_imagem = "workspace/foto";
    const depois = direcaoComRoteiro(primeiro, { tema: "Produto", formato: "estatico", cards: [{ ordem: 1, texto: "Novo título" }] }, marca);
    expect(depois.cards[0].texto_exato).toBe("Novo título");
    expect(depois.cards[0].prompt_imagem).toContain("Novo título");
    expect(depois.cards[0].referencia_imagem).toBe("workspace/foto");
    expect(primeiro.cards[0].texto_exato).toBe("Antigo");
  });
  it("invalida agenda, detalhes abertos e estúdio sem invalidar outro cliente", () => {
    const qc = new QueryClient();
    const alvos = [["mesa", "item-avulso", "c"], ["mesa", "agenda-do-mes", "c"], ["mesa", "proposta-v4", "p"], ["mesa", "agente-do-mes", "c", "propostas", "p"]];
    for (const chave of [...alvos, ["mesa", "item-avulso", "outro"]]) qc.setQueryData(chave, {});
    atualizarAgenda(qc, "c");
    for (const chave of alvos) expect(qc.getQueryState(chave)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["mesa", "item-avulso", "outro"])?.isInvalidated).toBe(false);
    qc.clear();
  });
});
