import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocoDoDiagnostico,
  conferirLink,
  formatoRepetido,
  linhasDaVisao,
  linhasDoPainel,
  linhasDoTexto,
  montarDiagnostico,
  ORDEM_DAS_PARTES,
  perguntasDoDiagnostico,
  usuarioDificil,
} from "../../supabase/functions/mesa-instagram/modulos/diagnostico-do-perfil";
import { sinaisDaBio, vereditoDaBio } from "../../supabase/functions/mesa-instagram/modulos/conhecimento-perfil-instagram";
import { BLOCOS_DA_ABA } from "../../supabase/functions/mesa-instagram/modulos/instagram-do-cliente";

/** Diagnóstico do perfil em 9 partes (12/10/2026, ig-profile-optimizer). */

const BIO_BOA = "Dentista em Curitiba há 12 anos. Clareamento e implantes. Agende pelo WhatsApp 👇";
const respostasBoas = { faz: { score: 2.8 }, chamada: { noul: 0.9 }, local: { noul: 0.9 }, atende_local: { noul: 0.95 }, prova: { noul: 0.8 }, nome_busca: { noul: 0.8 }, usuario_facil: { noul: 0.9 }, categoria_certa: { noul: 0.85 } };

function texto(o: { nome?: string; username?: string; bio?: string; site?: string; respostas?: Record<string, unknown> | null; link?: Parameters<typeof linhasDoTexto>[0]["link"]; categoria?: string | null } = {}) {
  const bio = o.bio ?? BIO_BOA;
  const sinais = sinaisDaBio(bio);
  const respostas = (o.respostas === undefined ? respostasBoas : o.respostas) as never;
  return linhasDoTexto({
    perfil: { nome: o.nome ?? "Clínica Sorriso | Dentista", username: o.username ?? "clinicasorriso", bio, site: o.site ?? "wa.me/5541999999999" },
    sinais,
    veredito: vereditoDaBio(respostas, sinais),
    respostas,
    link: o.link ?? { estado: "abre", status: 200 },
    categoria: o.categoria === undefined ? "Dentista" : o.categoria,
  });
}
const estado = (l: ReturnType<typeof texto>, parte: string) => l.find((x) => x.parte === parte)?.estado;

describe("partes de texto", () => {
  it("perfil bom passa em tudo", () => {
    const l = texto();
    expect(l.map((x) => x.estado)).toEqual(["passa", "passa", "passa", "passa", "passa"]);
  });

  it("nome longo, @ com números, bio vazia, sem link e categoria errada", () => {
    const l = texto({ nome: "Clínica Odontológica Sorriso Perfeito Curitiba", username: "clinica_sorriso_2019_ofc", bio: "", site: "", link: { estado: "sem_link", status: null }, respostas: { ...respostasBoas, faz: { score: 0.2 }, categoria_certa: { noul: 0.1 } } });
    expect(estado(l, "nome")).toBe("melhorar");
    expect(estado(l, "usuario")).toBe("melhorar");
    expect(estado(l, "bio")).toBe("falha");
    expect(estado(l, "link")).toBe("falha");
    expect(estado(l, "categoria")).toBe("melhorar");
  });

  it("link que recusa robô é melhorar, não falha; sem Jev, o que é julgamento fica para conferir", () => {
    expect(estado(texto({ link: { estado: "recusou", status: 403 } }), "link")).toBe("melhorar");
    const semJev = texto({ respostas: null });
    expect(estado(semJev, "bio")).toBe("nao_lido");
    expect(estado(semJev, "usuario")).toBe("nao_lido");
    expect(estado(semJev, "categoria")).toBe("nao_lido");
    expect(estado(texto({ categoria: null }), "categoria")).toBe("nao_lido");
  });

  it("@ difícil pelo código", () => {
    expect(usuarioDificil("loja123")).toMatch(/números/);
    expect(usuarioDificil("a.b_c.d")).toMatch(/pontos/);
    expect(usuarioDificil("clinicasorriso")).toBeNull();
  });

  it("perguntas ao Jev: as da bio, mais @ e categoria (só com categoria)", () => {
    expect(Object.keys(perguntasDoDiagnostico(true, true))).toEqual(expect.arrayContaining(["faz", "fiel", "usuario_facil", "categoria_certa"]));
    expect(Object.keys(perguntasDoDiagnostico(false, false))).not.toContain("categoria_certa");
  });
});

describe("link", () => {
  const resposta = (status: number) => (async () => new Response("", { status })) as unknown as typeof fetch;
  it("abre, recusa e não abre", async () => {
    expect(await conferirLink("site.com.br", resposta(200))).toEqual({ estado: "abre", status: 200 });
    expect((await conferirLink("https://x.com", resposta(403))).estado).toBe("recusou");
    expect((await conferirLink("https://x.com", resposta(404))).estado).toBe("nao_abre");
    expect((await conferirLink("https://x.com", (async () => { throw new Error("dns"); }) as unknown as typeof fetch)).estado).toBe("nao_abre");
    expect((await conferirLink("", resposta(200))).estado).toBe("sem_link");
  });
});

describe("visão, painel e montagem", () => {
  it("a visão fora do esquema vira não lido; sem imagem, não lido", () => {
    const l = linhasDaVisao({ foto: { estado: "passa", detalhe: "Logo centrada — legível", como_corrigir: "" }, grade: { estado: "ruim" } }, true, true);
    expect(l[0]).toMatchObject({ parte: "foto", estado: "passa", fonte: "visao" });
    expect(l[0].detalhe).not.toMatch(/—/);
    expect(l[1].estado).toBe("nao_lido");
    expect(linhasDaVisao(null, false, false).map((x) => x.estado)).toEqual(["nao_lido", "nao_lido"]);
  });

  it("formato repetido três vezes nos 9 primeiros", () => {
    expect(formatoRepetido(["Reels", "Reels", "Reels", "Post"])).toBe("Reels");
    expect(formatoRepetido(["Reels", "Post", "Reels", "Post"])).toBeNull();
  });

  it("destaques e fixados dizem o que o painel sabe", () => {
    const [d, f] = linhasDoPainel(5, [{ link: "https://x/p/1", multiplo: "3,1x o normal do perfil (views)", legenda: "Antes e depois" }]);
    expect(d.detalhe).toContain("5 capas prontas");
    expect(f.detalhe).toContain("3,1x");
    expect(f.estado).toBe("nao_lido");
  });

  it("monta as 9 partes na ordem, com nota sem contar o não lido", () => {
    const d = montarDiagnostico("clinicasorriso", [...texto(), ...linhasDaVisao({ foto: { estado: "falha", detalhe: "cortada", como_corrigir: "centralize" }, grade: { estado: "melhorar", detalhe: "repetida", como_corrigir: "alterne" } }, true, true), ...linhasDoPainel(0, [])], [], new Date("2026-10-12T12:00:00Z"));
    expect(d.linhas.map((x) => x.parte)).toEqual(ORDEM_DAS_PARTES.map((x) => x.parte));
    expect(d.resumo).toEqual({ passa: 5, melhorar: 1, falha: 1, nao_lido: 2, nota: 79 });
    const bloco = blocoDoDiagnostico(d);
    expect(bloco).toContain("Foto do perfil: falha");
    expect(bloco).toContain("Grade: melhorar");
    expect(bloco).not.toContain("Bio:");
  });
});

describe("ligação na aba Redes", () => {
  it("ação no servidor, coluna no plano, bloco na conversa e ferramenta na tela", () => {
    const fn = readFileSync(resolve(__dirname, "../../supabase/functions/mesa-instagram/index.ts"), "utf8");
    expect(fn).toContain("perfil_diagnosticar: diagnosticar");
    // 20/10/2026: o plano também lê os ajustes do app (sem a coluna, relê só estes três).
    expect(fn).toContain('ler("ordem, bio_analise, diagnostico, ajustes_do_app")');
    expect(fn).toContain('ler("ordem, bio_analise, diagnostico")');
    expect(fn).toContain("blocoDoDiagnostico(plano.diagnostico)");
    const aba = readFileSync(resolve(__dirname, "../components/mesa/AbaInstagram.tsx"), "utf8");
    expect(aba).toContain('{ valor: "diagnostico", rotulo: "Diagnóstico", icone: <Stethoscope');
    expect(BLOCOS_DA_ABA).toContain("diagnostico");
    const mig = readFileSync(resolve(__dirname, "../../supabase/migrations/20261012040000_diagnostico_do_perfil.sql"), "utf8");
    expect(mig).toContain("ADD COLUMN IF NOT EXISTS diagnostico jsonb");
  });
});
