import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { passosDaCaixa } from "@/components/produto/casa/CaixaDaAceleriq";
import type { CaixaDoCorreio, DominioNaCentral } from "@/lib/produto/email-central";

/**
 * A caixa da Aceleriq (19/11/2026): a tela dizia "desligada" porque só lia a chave do caminho antigo
 * do Zoho (ACELERIQ_CAIXA_LIGADA). Agora o estado sai dos dados reais do correio (Migadu).
 */

const caixa = (x: Partial<CaixaDoCorreio> = {}): CaixaDoCorreio => ({ id: "k1", endereco: "contato@aceleriq.test", pessoa: "", minha: true, dono: null, dominio: "aceleriq.test", provedor: "migadu", ligado: true, ...x });
const dominio = (x: Partial<DominioNaCentral> = {}) => ({ id: "d", dominio: "aceleriq.test", correio_provedor: "migadu", correio_ligado: true, ...x }) as DominioNaCentral;

describe("caixa da Aceleriq: o estado vem dos dados", () => {
  it("com a caixa conectada no correio, todos os passos estão feitos", () => {
    const p = passosDaCaixa({ dominio: dominio(), caixas: [caixa()], liberado: true });
    expect(p.every((x) => x.feito)).toBe(true);
  });

  it("caixa ligada ao acesso mas sem senha: falta só conectar", () => {
    const p = passosDaCaixa({ dominio: dominio(), caixas: [caixa({ ligado: false })], liberado: true });
    expect(p.filter((x) => !x.feito).map((x) => x.chave)).toEqual(["senha"]);
  });

  it("sem domínio e sem caixa: o primeiro passo que falta é o domínio", () => {
    const p = passosDaCaixa({ dominio: null, caixas: [], liberado: false });
    expect(p.filter((x) => !x.feito)[0].chave).toBe("dominio");
  });

  it("domínio no Migadu com o correio desligado: falta ligar", () => {
    const p = passosDaCaixa({ dominio: dominio({ correio_ligado: false }), caixas: [], liberado: true });
    expect(p.filter((x) => !x.feito)[0].chave).toBe("ligado");
  });

  it("a tela relê sozinha e não depende mais só da chave do Zoho", () => {
    const tela = readFileSync(resolve(__dirname, "../components/produto/casa/CaixaDaAceleriq.tsx"), "utf8");
    expect(tela).toContain("carregarMinhasCaixas");
    expect(tela).toContain("refetchOnWindowFocus: true");
    expect(tela).toMatch(/refetchInterval: 60_000/);
    expect(tela).not.toMatch(/[—–]/);
  });
});
