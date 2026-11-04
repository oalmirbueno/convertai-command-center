import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dadosDoLugar, nivelDaNota, ordenarCandidatos, passaNoContato, saudeDoCandidato, tetoDoGoogleEmDolar } from "@/lib/comercial/saudeDoLead";

/** 04/11/2026 (dono: "scroll único, filtros para recentes, cores como saudável e nota, Apify mais completo"). */
const cand = (m: Record<string, unknown> = {}) => ({
  id: "a", busca_id: "b", nome: "Loja", categoria: null, site: null, telefone: null, whatsapp: null, email: null, instagram: null,
  endereco: null, cidade: null, fonte: "google_maps", fonte_url: null, evidencias: [], nota: null, porque: null, situacao: "novo", lead_id: null, ...m,
}) as never;
const avaliado = (texto: string) => [{ campo: "avaliacoes", valor: texto, fonte: "google_maps", url: null }];

describe("saúde do candidato", () => {
  it("com canal direto e sinais é saudável; só telefone pede atenção; sem contato é fraco", () => {
    expect(saudeDoCandidato(cand({ whatsapp: "+5541999887766", site: "https://a.com" })).nivel).toBe("saudavel");
    expect(saudeDoCandidato(cand({ telefone: "+554133334444" })).nivel).toBe("atencao");
    expect(saudeDoCandidato(cand()).nivel).toBe("fraco");
  });

  it("a avaliação do Google pesa nos dois sentidos, e poucas avaliações não contam", () => {
    const base = { telefone: "+554133334444", site: "https://a.com" };
    expect(saudeDoCandidato(cand({ ...base, evidencias: avaliado("4.7 (80 avaliações)") })).nivel).toBe("saudavel");
    expect(saudeDoCandidato(cand({ ...base, evidencias: avaliado("3.0 (80 avaliações)") })).nivel).toBe("atencao");
    expect(saudeDoCandidato(cand({ ...base, evidencias: avaliado("4.9 (3 avaliações)") })).nivel).toBe("atencao");
  });

  it("explica o porquê, e busca sem dados do Google não quebra", () => {
    expect(saudeDoCandidato(cand({ whatsapp: "x" })).porque).toBe("tem WhatsApp, sem site");
    expect(dadosDoLugar(cand())).toMatchObject({ estrelas: null, avaliacoes: 0, dor: 0, bairro: null });
    expect(dadosDoLugar(cand({ evidencias: avaliado("4.5 (120 avaliações)") }))).toMatchObject({ estrelas: 4.5, avaliacoes: 120 });
  });
});

describe("cores da nota", () => {
  it("7 ou mais é verde, de 4 a 7 âmbar, abaixo de 4 vermelho", () => {
    expect([nivelDaNota(7), nivelDaNota(6.9), nivelDaNota(4), nivelDaNota(3.9)]).toEqual(["saudavel", "atencao", "atencao", "fraco"]);
  });
});

describe("ordem e filtros", () => {
  const a = cand({ id: "a", nome: "Zeta", nota: 3, created_at: "2026-11-01", whatsapp: "x", site: "s" });
  const b = cand({ id: "b", nome: "Alfa", nota: null, created_at: "2026-11-03", evidencias: avaliado("4.5 (120 avaliações)") });
  const c = cand({ id: "c", nome: "Meio", nota: 9, created_at: "2026-11-02", telefone: "t" });
  const ids = (l: Array<{ id: string }>) => l.map((x) => x.id).join("");
  it("ordena por recentes, nota, saúde, avaliações e nome, sem mexer na lista original", () => {
    const lista = [a, b, c];
    expect(ids(ordenarCandidatos(lista, "recentes"))).toBe("bca");
    expect(ids(ordenarCandidatos(lista, "nota"))).toBe("cab");
    expect(ids(ordenarCandidatos(lista, "saude"))[0]).toBe("a");
    expect(ids(ordenarCandidatos(lista, "avaliacoes"))[0]).toBe("b");
    expect(ids(ordenarCandidatos(lista, "nome"))).toBe("bca");
    expect(ids(lista)).toBe("abc");
  });
  it("filtra pelo contato", () => {
    expect(passaNoContato(a, "whatsapp")).toBe(true);
    expect(passaNoContato(c, "whatsapp")).toBe(false);
    expect(passaNoContato(c, "telefone")).toBe(true);
    expect(passaNoContato(c, "sem_site")).toBe(true);
    expect(passaNoContato(a, "sem_site")).toBe(false);
  });
});

describe("tela e motor", () => {
  const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");
  it("buscas e candidatos rolam cada um por si, e a nova busca abre em janela", () => {
    const s = ler("src/components/comercial/MaquinaDeLeads.tsx");
    expect(s).toContain('<AreaDeTrabalho principalRolavel={false} rotuloDoPrincipal="Máquina de leads">');
    expect(s).toContain('<RegiaoRolavel rotulo="Lista de buscas"');
    expect(s).toContain('<RegiaoRolavel rotulo="Lista de candidatos"');
    expect(s).toContain("<Dialog open={novaAberta}");
  });
  it("o teto mostrado é o mesmo do motor, que pede contatos e pula fechados", () => {
    const py = ler("workers/leads/apify.py");
    expect(py).toContain("USD_POR_LUGAR = 0.008");
    expect(py).toContain("TETO_MINIMO_USD = 0.5");
    expect(py).toContain('"scrapeContacts": True');
    expect(py).toContain('"skipClosedPlaces": True');
    expect(py).toContain("maxTotalChargeUsd");
    expect(tetoDoGoogleEmDolar(50)).toBe(0.5);
    expect(tetoDoGoogleEmDolar(300)).toBe(2.4);
  });
});
