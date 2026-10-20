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
    // 20/10: a fonte da arte livre é o par da biblioteca gravado no trabalho, nunca o kit do cliente.
    expect(srv).toMatch(/async function lerFontes\([^)]*\): Promise<Fonte\[\]> \{\n[^\n]*\n  if \(alvoSemMarca\(alvo\)\) \{[\s\S]{0,300}fontesGravadasDoLivre/);
    expect(srv).toContain("if (alvoSemMarca(alvo)) return MARCA_LIVRE;");
    expect(srv).toContain("!semMarca && (ordem === 1 || ordem === total)");
    expect(srv).toContain("semMarca ? Promise.resolve(null) : contextoCompletoParaPrompt(");
    expect(ler("supabase/functions/estudio-arte/modulos/arte-rapida.ts")).toContain("sem_marca?: boolean;");
  });
});

describe("carteira própria do Estúdio livre, sem criar cliente", () => {
  it("o banco: carteira e registro do livre; a cobrança da arte livre sai da carteira dele, nunca da do cliente", () => {
    const sql = ler("supabase/migrations/20261019235958_estudio_livre_carteira.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.estudio_livre_carteira");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.estudio_livre_trabalhos");
    expect(sql).toMatch(/_livre := _referencia_tipo = 'estudio_trabalho'[\s\S]*estudio_livre_trabalhos/);
    expect(sql).toMatch(/IF _livre THEN[\s\S]*UPDATE public\.estudio_livre_carteira SET saldo_usd = saldo_usd - _custo/);
    expect(sql).toContain("AND uso.carteira = ''cliente''");
    expect(sql).toContain("public.has_role(auth.uid(), 'admin'::public.app_role)");
    expect(sql).not.toMatch(/40001/);
  });

  it("o saldo conferido antes de gastar é o dos Créditos do Laboratório (limite desligado não trava)", () => {
    const motor = ler("supabase/functions/_shared/ia-motor.ts");
    expect(motor).toContain("async function saldoDoEstudioLivre(");
    expect(motor).toContain('from("lab_carteira").select("saldo_usd, ativa")');
    expect(motor).toContain("if (!carteira || carteira.ativa !== true) return Number.POSITIVE_INFINITY;");
    expect(motor).toContain("await garantirSaldo(e.clientId, estimativa, e.referencia);");
  });

  it("20/10: uma carteira só, a do topo do Laboratório; a arte livre debita os Créditos do Laboratório", () => {
    const sql = ler("supabase/migrations/20261020002646_estudio_livre_usa_creditos_do_lab.sql");
    expect(sql).toMatch(/IF _livre THEN[\s\S]*FROM public\.lab_carteira AS c WHERE c\.id = true FOR UPDATE/);
    expect(sql).toContain("INSERT INTO public.lab_creditos_movimentos (tipo, valor_usd, saldo_depois, debitado, nota, criado_por)");
    expect(sql).not.toMatch(/40001/);
    const tela = ler("src/components/laboratorio/estudio-livre/EstudioLivre.tsx");
    expect(tela).toContain("const creditosDoLab = useCreditosDoLab(livre);");
    expect(tela).toContain("? doLab && doLab.ativa ? numero(doLab.saldo_usd) : null");
    expect(tela).toContain('carteira: livre ? "laboratorio" : "cliente",');
    expect(tela).toContain("? () => setCreditosAbertos(true)");
    expect(tela).not.toContain('rpc("estudio_livre_saldo")');
    expect(tela).toContain("enabled: !!clientId && !livre,");
    expect(ler("src/lib/mesa/api.ts")).toContain('if (detalhes.carteira === "laboratorio") {');
  });
});
