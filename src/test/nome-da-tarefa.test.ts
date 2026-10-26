import { describe, expect, it } from "vitest";
import { nomeDaTarefa, nomeDaTarefaDoBanco, nomeDoCliente } from "@/lib/nomeDaTarefa";
import { ultimasAcoesReais } from "@/lib/funcionandoDeVerdade";

/**
 * 26/10/2026 (dono: "o nome ACE com número é confuso: marcação por
 * departamento, por cliente"): toda tarefa vira "Cliente · Área · assunto".
 * Os títulos abaixo são os reais do banco em 26/10.
 */
describe("nome da tarefa", () => {
  it("tira o código ACE e põe cliente e área (Meta → Tráfego)", () => {
    const n = nomeDaTarefa({ titulo: "ACE-275 | Meta: arquivar anúncio com erro 2016153", cliente: "Preserva Eco", tipoDeEntrega: "traffic" });
    expect(n.texto).toBe("Preserva Eco · Tráfego · Arquivar anúncio com erro 2016153");
    expect(n.codigo).toBe("ACE-275");
    expect(n.texto).not.toContain("ACE");
  });

  it("não repete o cliente que já vem no começo do título", () => {
    expect(nomeDaTarefa({ titulo: "Softy — retomar mensagens e continuidade sem término", cliente: "Softy Móveis", agente: "Gestor de Tráfego Sênior" }).texto)
      .toBe("Softy Móveis · Tráfego · Retomar mensagens e continuidade sem término");
    expect(nomeDaTarefa({ titulo: "Doces em Ordem | Copy de landing page e checkout para revisão do Core", cliente: "Doces em Ordem", tipoDeEntrega: "copywriting" }).texto)
      .toBe("Doces em Ordem · Conteúdo · Copy de landing page e checkout para revisão do Core");
  });

  it("área do agente que é plataforma (Paperclip) não vira departamento; a casa vira Aceleriq", () => {
    const n = nomeDaTarefa({ titulo: "Diagnosticar e corrigir os erros recorrentes", cliente: "AcelerIQ", areaDoAgente: "Paperclip", agente: "Chefe de Gabinete" });
    expect(n.texto).toBe("Aceleriq · Operação · Diagnosticar e corrigir os erros recorrentes");
    expect(nomeDoCliente(null)).toBe("Aceleriq");
  });

  it("acha a área pelo assunto e tira id técnico", () => {
    const n = nomeDaTarefa({ titulo: "Carrossel de novembro 9623ab68-1c2d-4e5f-8a9b-0c1d2e3f4a5b", cliente: "Stop" });
    expect(n.texto).toBe("Stop · Conteúdo · Carrossel de novembro");
  });

  it("título já no formato novo fica igual (não duplica)", () => {
    const n = nomeDaTarefa({ titulo: "Stop · Operação · Organizar o painel", cliente: "Stop" });
    expect(n.texto).toBe("Stop · Operação · Organizar o painel");
  });

  it("lê a tarefa do banco (projeto → cliente)", () => {
    const n = nomeDaTarefaDoBanco({ title: "ACE-336 Relatório semanal", delivery_type: null, project: { client: { company_name: "Terra Flor" } } });
    expect(n.texto).toBe("Terra Flor · Relatório · Relatório semanal");
    expect(n.semCliente).toBe("Relatório · Relatório semanal");
  });
});

describe("funcionando de verdade", () => {
  it("só conta o que deixou prova, a mais recente por agente, e lista quem ainda não entregou", () => {
    const r = ultimasAcoesReais(
      [{ id: "a", display_name: "Gestor de Tráfego", status: "active" }, { id: "b", display_name: "Revisor", status: "active" }, { id: "c", display_name: "Pausado", status: "paused" }],
      [
        { id: "1", operator_id: "a", status: "done", last_evidence: "https://x/print.png", updated_at: "2026-10-26T10:00:00Z" },
        { id: "2", operator_id: "a", status: "review", last_evidence: "https://x/novo.png", updated_at: "2026-10-26T12:00:00Z" },
        { id: "3", operator_id: "a", status: "in_progress", last_evidence: null, updated_at: "2026-10-26T13:00:00Z" },
        { id: "4", operator_id: "b", status: "done", last_evidence: "", updated_at: "2026-10-26T13:00:00Z" },
      ],
      (v) => `nome ${v.id}`,
    );
    expect(r.comProva).toHaveLength(1);
    expect(r.comProva[0]).toMatchObject({ agente: "Gestor de Tráfego", linkId: "2", estado: "revisao", nome: "nome 2" });
    expect(r.semProva).toEqual(["Revisor"]);
  });
});
