import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dinheiro } from "@/lib/comercial";
import { totalDoGanho } from "@/components/comercial/resumoDaOportunidade";

/** 05/11/2026 (dono): valor do ganho igual ao cadastro, Documentos à vista no portal e upgrade de plano em um passo. */
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");

describe("valor do ganho", () => {
  it("a Prix mostra o que foi cadastrado, não os R$ 777 de mensal x 12 + entrada", () => {
    expect(totalDoGanho([{ one_off_value: 597, monthly_value: 39.9 }]).replace(/\s/g, " ")).toBe("R$ 597 + R$ 39,90/mês");
    expect(totalDoGanho([{ one_off_value: 0, monthly_value: 500 }]).replace(/\s/g, " ")).toBe("R$ 500/mês");
    expect(totalDoGanho([{ one_off_value: 200, monthly_value: 0 }]).replace(/\s/g, " ")).toBe("R$ 200");
    expect(totalDoGanho([])).toBe("vazio");
  });

  it("centavos aparecem; valor inteiro continua limpo", () => {
    expect(dinheiro(39.9).replace(/\s/g, " ")).toBe("R$ 39,90");
    expect(dinheiro(298.5).replace(/\s/g, " ")).toBe("R$ 298,50");
    expect(dinheiro(1500).replace(/\s/g, " ")).toBe("R$ 1.500");
  });
});

describe("documentos no portal", () => {
  it("fica no menu principal do cliente, fora do Mais", () => {
    const s = ler("src/components/AppLayout.tsx");
    const principal = s.slice(s.indexOf("const clientMainNav"), s.indexOf("const clientMoreNav"));
    const mais = s.slice(s.indexOf("const clientMoreNav"), s.indexOf("export default function AppLayout"));
    expect(principal).toContain('url: "/documentos"');
    expect(mais).not.toContain('url: "/documentos"');
  });

  it("subir arquivo já começa em Disponibilizar ao cliente para quem pode liberar", () => {
    const s = ler("src/pages/AdminFiles.tsx");
    expect(s).toContain('useState<UploadPostSaveAction>(canReviewAndRelease ? "client_shared" : "draft")');
    expect(s).toContain('setUploadPostSaveAction(canReviewAndRelease ? "client_shared" : "draft");');
    expect(s).toContain('"save-internal-draft"');
  });
});
