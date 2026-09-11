import { describe, expect, it } from "vitest";
import { escolherDossieGeral, montarDossieDoCliente, mudancasEntreVersoes, rotuloDoDossie, type DossieLinha } from "@/lib/dossieGeral";
import { buildGroupMessageText, type GroupMessageContext } from "@/lib/groupMessage";

const linha = (over: Partial<DossieLinha>): DossieLinha => ({
  id: over.id ?? "d1",
  client_id: "c1",
  project_id: null,
  dossier_type: "contexto",
  version: 1,
  summary: null,
  content: "Onde estamos: a loja abriu a segunda unidade.",
  updated_at: "2026-09-10T10:00:00Z",
  prior_version_id: null,
  ...over,
});

describe("o dossiê geral manda", () => {
  it("o geral vence o de projeto mesmo quando o de projeto é mais novo", () => {
    const geral = linha({ id: "g", version: 12, updated_at: "2026-09-08T10:00:00Z" });
    const projeto = linha({ id: "p", project_id: "proj-1", dossier_type: "projeto", version: 30, updated_at: "2026-09-11T10:00:00Z" });
    const r = escolherDossieGeral([projeto, geral]);
    expect(r.geral?.id).toBe("g");
    expect(r.substituto).toBe(false);
    expect(r.outros.map((o) => o.id)).toEqual(["p"]);
  });

  it("sem geral, usa o mais recente e avisa que é substituto", () => {
    const p1 = linha({ id: "p1", project_id: "a", dossier_type: "projeto", updated_at: "2026-09-01T10:00:00Z" });
    const p2 = linha({ id: "p2", project_id: "b", dossier_type: "projeto", updated_at: "2026-09-09T10:00:00Z" });
    const r = escolherDossieGeral([p1, p2]);
    expect(r.geral?.id).toBe("p2");
    expect(r.substituto).toBe(true);
  });

  it("as mudanças são só o que entrou de novo, sem a seção automática de avanços", () => {
    const antes = ["# Onde estamos", "A loja abriu a segunda unidade.", "Campanha de inverno rodando."].join("\n");
    const depois = [
      "# Onde estamos",
      "A loja abriu a segunda unidade.",
      "Campanha de inverno rodando.",
      "Fechou o primeiro contrato corporativo com a Rede Sol.",
      "## Avancos recentes (automatico)",
      "- Post publicado: Dia do cliente",
      "# Proximos",
      "Abrir a terceira unidade em outubro.",
    ].join("\n");
    expect(mudancasEntreVersoes(antes, depois)).toEqual([
      "Fechou o primeiro contrato corporativo com a Rede Sol.",
      "Abrir a terceira unidade em outubro.",
    ]);
    expect(mudancasEntreVersoes(depois, depois)).toEqual([]);
    expect(mudancasEntreVersoes(null, "Primeira versão escrita hoje.")).toEqual(["Primeira versão escrita hoje."]);
  });

  it("monta geral + anterior + mudanças a partir das linhas", () => {
    const anterior = linha({ id: "v11", version: 11, content: "A loja abriu a segunda unidade." });
    const atual = linha({ id: "v12", version: 12, prior_version_id: "v11", content: "A loja abriu a segunda unidade.\nContratou gerente para a unidade nova." });
    const d = montarDossieDoCliente([atual], new Map([["v11", anterior]]));
    expect(d.geral?.version).toBe(12);
    expect(d.anterior?.version).toBe(11);
    expect(d.mudancas).toEqual(["Contratou gerente para a unidade nova."]);
    expect(rotuloDoDossie(d, new Date("2026-09-10T13:00:00Z"))).toBe("dossiê geral v12 · atualizado há 3 h · 1 mudança desde a v11");
  });
});

describe("a mensagem do grupo carrega a progressão", () => {
  const base: GroupMessageContext = {
    clientName: "Mirante Luz",
    greeting: "Bom dia",
    entregasSemana: [],
    entregasDesdeSegunda: [],
    aguardandoOk: [],
    publicadasSemana: 0,
    proximasAgendadas: [],
    cicloFeito: [],
    avulsosFeitos: [],
    frentes: [],
    contextoRecente: "A pousada está com 80% de ocupação no feriado.",
  };

  it("abertura traz o que andou desde a última leitura e o foco da semana", () => {
    const texto = buildGroupMessageText({ ...base, dossieMudancas: ["Fechou parceria com a agência de turismo local."], focoDaSemana: "Encher o feriado de outubro com o pacote café incluso." }, "abertura");
    expect(texto).toContain("*O que andou desde a última leitura*");
    expect(texto).toContain("• Fechou parceria com a agência de turismo local.");
    expect(texto).toContain("*Foco desta semana*");
    expect(texto).toContain("Encher o feriado de outubro");
  });

  it("fechamento conta a venda registrada e o que mudou na semana", () => {
    const texto = buildGroupMessageText({ ...base, vendas: { total: 1, receita: 608.9 }, dossieMudancas: ["Primeira reserva vinda do anúncio do feriado."], feitoDaEsteira: ["Reel do feriado publicado"] }, "fechamento");
    expect(texto).toMatch(/uma venda foi registrada/i);
    expect(texto).toContain("R$");
    expect(texto).toContain("*O que mudou nesta semana*");
    expect(texto).toContain("Reel do feriado publicado");
  });

  it("sem mudanças e sem vendas, nada disso aparece", () => {
    const texto = buildGroupMessageText(base, "meio");
    expect(texto).not.toContain("última leitura");
    expect(texto).not.toContain("Vendas até agora");
  });
});
