import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ehTextoInterno, semTextoInterno } from "@/lib/textoInterno";

// 19/10: 15 clientes receberam no portal a preparação interna do Hermes de 09/10. Relatório publicado é
// imutável no banco; o portal deixa de mostrar o que tem marca de nota interna.
describe("portal sem texto interno", () => {
  it("reconhece a preparação interna e deixa passar a mensagem para o cliente", () => {
    expect(ehTextoInterno({ title: "Preparação interna | Mirante Luz Floripa | Semana 05–11/10 | corte 09/10/2026", summary: "x" })).toBe(true);
    expect(ehTextoInterno({ title: "SKC | Fechamento semanal parcial 05–11/10 | corte 09/10", summary: "x" })).toBe(true);
    expect(ehTextoInterno({ title: "Insights", summary: "Contrato 5061ae81-7e47-41c5-9a0c-ee368d37f1d9 completed" })).toBe(true);
    expect(ehTextoInterno({ title: "Carrossel dos quartos entra em produção", summary: "Bom dia, Simone. O carrossel entra no ar na quarta, 21/10." })).toBe(false);
    expect(semTextoInterno([{ title: "Preparação interna", summary: "" }, { title: "Ok", summary: "" }])).toEqual([{ title: "Ok", summary: "" }]);
  });

  it("as telas do cliente filtram: relatórios, jornada, painel, linha do tempo e o detalhe", () => {
    const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
    expect(ler("src/pages/ClientReports.tsx")).toContain("semTextoInterno(data || [])");
    expect(ler("src/pages/ClientJourneyUpdates.tsx")).toContain("reports: semTextoInterno(reports.data || [])");
    expect(ler("src/components/client/dashboardHelpers.ts")).toContain("return semTextoInterno(data || [])[0] ?? null;");
    expect(ler("src/components/shared/ProjectJournal.tsx")).toContain("reports: semTextoInterno(reports.data || [])");
    expect(ler("src/pages/ReportDetail.tsx")).toContain("(isClientView && ehTextoInterno(report))");
  });
});
