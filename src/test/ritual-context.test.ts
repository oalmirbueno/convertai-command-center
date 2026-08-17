import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regras que nasceram de erro real com cliente.
 *
 * O ritual do Mirante afirmou que o tráfego "ainda vai iniciar" quando ele já
 * rodava campanhas: o painel não tinha registro de carteira e a lógica tratou
 * ausência de registro como prova de ausência de trabalho. E houve cobrança de
 * aprovação de material de data comemorativa cuja data já tinha passado.
 *
 * Nos dois casos o dano é o mesmo: a mensagem perde credibilidade inteira.
 */
const raiz = process.cwd();
const central = readFileSync(resolve(raiz, "src/pages/AdminExperience.tsx"), "utf8");
const escritor = readFileSync(
  resolve(raiz, "supabase/functions/ritual-writer/index.ts"),
  "utf8",
);

describe("contexto do ritual: não afirmar o que não se sabe", () => {
  it("não trata falta de carteira de anúncios como prova de tráfego parado", () => {
    // A carteira é controle financeiro e nem todo cliente usa.
    expect(central).toContain("sinaisDeOperacao");
    expect(central).toContain("NÃO TEM REGISTRO do estado atual das campanhas");
    expect(central).toContain("NÃO afirme que o tráfego começou nem que não começou");
  });

  it("reconhece operação de tráfego por vários sinais, não só pela carteira", () => {
    expect(central).toContain("checklist semanal de tráfego sendo marcado pela equipe");
    expect(central).toContain("frente contratada de campanhas");
    expect(central).toContain("etapas de campanha já concluídas");
  });

  it("lê o ciclo das duas frentes, não só de social", () => {
    // A consulta filtrava area=social e por isso nunca via tráfego rodando.
    expect(central).toContain("trafegoEmOperacao");
    expect(central).not.toContain('.eq("week_start", cycleWeekKey)\n        .eq("area", "social")');
  });

  it("proíbe no prompt afirmar que uma frente não começou sem prova", () => {
    expect(escritor).toContain("ausência de registro NÃO é prova de ausência de trabalho");
    expect(escritor).toMatch(/nunca como diagnóstico/i);
  });
});

describe("contexto do ritual: data que já passou", () => {
  it("identifica material de data marcada parado tempo demais", () => {
    expect(central).toContain("vencidosPorData");
    expect(central).toContain("MATERIAL COM DATA VENCIDA");
    // Precisa cobrir as datas comemorativas comuns do calendário brasileiro.
    for (const data of ["natal", "páscoa", "black friday", "namorados"]) {
      expect(central.toLowerCase()).toContain(data);
    }
  });

  it("manda reconhecer a perda em vez de cobrar aprovação vencida", () => {
    expect(central).toContain("NÃO peça aprovação deles");
    expect(escritor).toContain("NÃO pode ser cobrado como aprovação pendente");
    expect(escritor).toMatch(/sem culpar ninguém/i);
  });

  it("conta publicação agendada que passou da data sem ir ao ar", () => {
    expect(central).toContain("publicacoesPerdidas");
  });
});

describe("contexto do ritual: segundo cérebro", () => {
  it("busca o que existe fora do painel sobre aquele cliente", () => {
    expect(central).toContain("brain-client-context");
    expect(central).toContain("CONTEXTO DO SEGUNDO CÉREBRO");
  });

  it("nunca deixa a falta do segundo cérebro derrubar a geração", () => {
    // A busca é enriquecimento: se falhar, o ritual sai com o resto.
    expect(central).toContain('.catch(() => "")');
  });
});
