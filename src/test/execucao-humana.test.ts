import { describe, expect, it } from "vitest";
import { fraseDoAgente, oQueFoiFeito, tipoDaEntrega } from "@/lib/execucaoHumana";

/** 16/10/2026, dono: "o que foi feito de fato? quando é arte, quando são lâminas"; "estou fazendo arte no carrossel para o cliente". */
describe("o trabalho dito como gente", () => {
  it("tipo da entrega: o marcado na tarefa vence; sem ele, o título diz", () => {
    expect(tipoDaEntrega("carousel", "qualquer")).toBe("carrossel");
    expect(tipoDaEntrega("unspecified", "[CME | 14/10] Carrossel - Os próximos 90 dias")).toBe("carrossel");
    expect(tipoDaEntrega(null, "Lâminas da apresentação comercial")).toBe("lâminas");
    expect(tipoDaEntrega(null, "Finalizar edição dos vídeos captados")).toBe("vídeo");
    expect(tipoDaEntrega(null, "Conferir pendências")).toBeNull();
  });
  it("o agente fala em primeira pessoa, pela situação", () => {
    expect(fraseDoAgente({ status: "in_progress", titulo: "[ACERBI | 13/10] Carrossel: Seu cliente entendeu a oferta?", cliente: "Acerbi", tipo: "carrossel" })).toBe('Estou fazendo o carrossel "Carrossel: Seu cliente entendeu a oferta?" para Acerbi.');
    expect(fraseDoAgente({ status: "review", titulo: "Post de antes e depois", cliente: "Verzelo", tipo: "post" })).toBe('Terminei o post "Post de antes e depois" para Verzelo e estou esperando você aprovar.');
    expect(fraseDoAgente({ status: "blocked", titulo: "Coordenar rotina", motivo: "falta o acesso ao Meta" })).toBe('Parei em "Coordenar rotina": falta o acesso ao Meta');
  });
  it("o que foi feito diz o que é e se há prova, sem 'arquivo interno'", () => {
    expect(oQueFoiFeito({ status: "review", tipo: "carrossel", temImagem: true, temProva: true })).toBe("Pronto para você aprovar: carrossel (veja a imagem).");
    expect(oQueFoiFeito({ status: "in_progress", tipo: null, temProva: false })).toBe("Em produção: entrega (ainda sem prova anexada).");
  });
});
