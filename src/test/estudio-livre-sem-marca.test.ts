import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 19/10/2026 (dono, com o print do Estúdio livre mostrando "Campanha: Só a marca"): "no Laboratório,
 * o Estúdio está puxando cliente, sendo que tem que começar com o livre; não pode puxar logo, identidade
 * nem nada de cliente se não foi selecionado". Duas causas: o Laboratório passava o cliente lembrado das
 * outras abas, e o Livre usava o cliente interno da agência com a marca dela.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

describe("Estúdio livre começa livre e sem marca", () => {
  it("o Laboratório não passa o cliente lembrado: o Estúdio abre em Livre, com o próprio seletor", () => {
    const pagina = ler("src/pages/Laboratorio.tsx");
    expect(pagina).toContain('{aba === "estudio" && <EstudioLivre />}');
    expect(ler("src/components/laboratorio/estudio-livre/EstudioLivre.tsx")).toContain("useState<string>(LIVRE)");
  });

  it("no Livre a tela não carrega marca, esconde a campanha e pede a arte sem marca", () => {
    const livre = ler("src/components/laboratorio/estudio-livre/EstudioLivre.tsx");
    expect(livre).toContain("const marca = livre ? null : daCasca.marca;");
    expect(livre).toContain("semMarca={livre}");
    const estudio = ler("src/components/mesa/EstudioArteRapida.tsx");
    expect(estudio).toContain("sem_marca: true, campanha_id: null, marca_id: null");
    expect(estudio).toMatch(/semMarca \? \(\s*<p[^>]*data-arte-sem-marca/);
  });

  it("o servidor não deixa marca nenhuma entrar na arte livre, nem na direção nem na geração", () => {
    const srv = ler("supabase/functions/estudio-arte/index.ts");
    expect(srv).toContain('origem === "laboratorio" && (corpo.sem_marca === true || !texto(corpo.client_id, 64))');
    expect(srv).toContain("gravada = { ...gravada, sem_marca: true, campanha_id: null, campanha_por: null };");
    expect(srv).toMatch(/async function lerKit\([^)]*\): Promise<Kit> \{\n  if \(alvoSemMarca\(alvo\)\) return null;/);
    expect(srv).toMatch(/async function lerFontes\([^)]*\): Promise<Fonte\[\]> \{\n  if \(alvoSemMarca\(alvo\)\) return \[\];/);
    expect(srv).toContain("if (alvoSemMarca(alvo)) return MARCA_LIVRE;");
    expect(srv).toContain("!semMarca && (ordem === 1 || ordem === total)");
    expect(srv).toContain("semMarca ? Promise.resolve(null) : contextoCompletoParaPrompt(");
    expect(ler("supabase/functions/estudio-arte/modulos/arte-rapida.ts")).toContain("sem_marca?: boolean;");
  });
});
