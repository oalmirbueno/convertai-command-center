import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MODELOS_DE_FABRICA,
  SLUGS_DE_BRIEFING,
  TIPOS_DE_CAMPO,
  camposDoModelo,
  campoRespondido,
  campoVisivel,
  erroDoCampo,
  estadoDoLink,
  faltandoNoBriefing,
  linkDoWhatsApp,
  mensagemDoLink,
  modeloDaMesa,
  modeloDoLink,
  modeloVigente,
  normalizarModelo,
  prefillDoModelo,
  progressoDoBriefing,
  textoDaResposta,
  urlValida,
} from "../../supabase/functions/_shared/briefing-modelos";
import { QUESTIONS } from "@/components/briefing/questions";

/**
 * Frente BRF: modelos de briefing (esquema unificado, versões, tipos novos),
 * validade do link, envio único (contrato das RPCs) e o link por tipo.
 */

const ler = (p: string) => readFileSync(p, "utf8");

describe("modelos de briefing", () => {
  it("tem os 7 modelos, cada um com chaves únicas e tipos conhecidos", () => {
    expect(SLUGS_DE_BRIEFING).toEqual(["diagnostico", "site", "landing", "identidade", "naming", "redes", "video"]);
    for (const slug of SLUGS_DE_BRIEFING) {
      const m = MODELOS_DE_FABRICA[slug];
      expect(m.slug).toBe(slug);
      const chaves = camposDoModelo(m).map((c) => c.key);
      expect(new Set(chaves).size, `${slug}: chave repetida`).toBe(chaves.length);
      camposDoModelo(m).forEach((c) => {
        expect(TIPOS_DE_CAMPO).toContain(c.tipo);
        if (c.mostrarSe) expect(chaves, `${slug}.${c.key}: condição aponta para campo que não existe`).toContain(c.mostrarSe.key);
      });
      // Texto nosso: sem travessão e sem os erros dos originais.
      const texto = JSON.stringify(m);
      expect(texto).not.toMatch(/[—–]/);
      expect(texto).not.toMatch(/Landing PAge|Iformações|você você|São clientes são|Vender os guias de viagem/);
    }
  });

  it("os serviços usam os tipos novos: escala, referência, envio, url, checklist e confirmar", () => {
    const tipos = new Set(SLUGS_DE_BRIEFING.filter((s) => s !== "diagnostico").reduce<string[]>((acc, s) => acc.concat(camposDoModelo(MODELOS_DE_FABRICA[s]).map((c) => c.tipo)), []));
    ["scale", "reference", "upload", "url", "checklist", "confirm"].forEach((t) => expect(tipos.has(t), t).toBe(true));
    // Nenhum campo pede senha (acesso é por convite).
    SLUGS_DE_BRIEFING.forEach((s) => camposDoModelo(MODELOS_DE_FABRICA[s]).forEach((c) => expect(c.pergunta.toLowerCase()).not.toContain("senha")));
  });

  it("o diagnóstico de hoje continua intacto (mesmas chaves e textos em QUESTIONS)", () => {
    expect(QUESTIONS).toHaveLength(15);
    expect(QUESTIONS.map((q) => q.key)).toEqual([
      "companyName", "segment", "companyAge", "companyDescription", "digitalPresence", "paidTraffic", "digitalLevel",
      "objectives", "expectedResults", "biggestChallenge", "idealClient", "region", "howClientsFind", "budget", "additionalNotes",
    ]);
    expect(QUESTIONS[0]).toMatchObject({ block: "empresa", blockLabel: "Sobre sua Empresa", question: "Qual é o nome da sua empresa?", type: "text", required: true });
    expect(QUESTIONS[7].maxSelect).toBe(3);
    expect(QUESTIONS[14].required).toBe(false);
  });

  it("modelo editado no banco: a versão ativa mais nova vence; quebrada ou antiga cai no de fábrica", () => {
    const editado = { ...MODELOS_DE_FABRICA.site, titulo: "Site, versão do dono", blocos: [{ id: "x", titulo: "Novo", campos: [{ key: "novo", tipo: "text", pergunta: "Pergunta nova" }] }] };
    expect(modeloVigente("site", [{ slug: "site", versao: 2, conteudo: editado, ativo: true }]).titulo).toBe("Site, versão do dono");
    expect(modeloVigente("site", [{ slug: "site", versao: 2, conteudo: editado, ativo: false }]).titulo).toBe(MODELOS_DE_FABRICA.site.titulo);
    expect(modeloVigente("site", [{ slug: "site", versao: 3, conteudo: { blocos: [] } }]).titulo).toBe(MODELOS_DE_FABRICA.site.titulo);
    expect(modeloVigente("site", [{ slug: "landing", versao: 9, conteudo: editado }]).slug).toBe("site");
  });

  it("normaliza o modelo: tira tipo desconhecido, chave repetida, escolha sem opções e script em chave", () => {
    const m = normalizarModelo({
      slug: "redes",
      blocos: [
        {
          titulo: "A",
          campos: [
            { key: "ok", tipo: "text", pergunta: "Ok" },
            { key: "ok", tipo: "textarea", pergunta: "Repetida" },
            { key: "ruim", tipo: "html", pergunta: "Tipo estranho" },
            { key: "<script>", tipo: "text", pergunta: "Chave estranha" },
            { key: "escolha", tipo: "single-chip", pergunta: "Sem opções", opcoes: ["só uma"] },
            { key: "escala", tipo: "scale", pergunta: "Escala", polos: ["A", "B"] },
          ],
        },
      ],
    });
    expect(m).not.toBeNull();
    expect(camposDoModelo(m!).map((c) => c.key)).toEqual(["ok", "escala"]);
    expect(normalizarModelo({ slug: "redes", blocos: [] })).toBeNull();
    expect(normalizarModelo("lixo")).toBeNull();
  });

  it("o link antigo sem modelo abre como diagnóstico; o link novo usa a cópia gravada", () => {
    expect(modeloDoLink(null, null).slug).toBe("diagnostico");
    const copia = { ...MODELOS_DE_FABRICA.video, titulo: "Vídeo do lançamento" };
    expect(modeloDoLink("video", copia).titulo).toBe("Vídeo do lançamento");
  });
});

describe("respostas: condicionais, obrigatórias e leitura", () => {
  const site = MODELOS_DE_FABRICA.site;
  const campo = (k: string) => camposDoModelo(site).find((c) => c.key === k)!;

  it("campo condicional só aparece com a resposta certa", () => {
    expect(campoVisivel(campo("siteAtualProblemas"), {})).toBe(false);
    expect(campoVisivel(campo("siteAtualProblemas"), { temSiteAtual: "Sim" })).toBe(true);
    const ident = camposDoModelo(MODELOS_DE_FABRICA.redes).find((c) => c.key === "anexoIdentidade")!;
    expect(campoVisivel(ident, { temIdentidade: "Em construção" })).toBe(true);
    expect(campoVisivel(ident, { temIdentidade: "Não" })).toBe(false);
  });

  it("referência conta só link válido ou imagem, e pede o mínimo", () => {
    const ref = campo("referencias");
    expect(ref.minimo).toBe(3);
    const duas = { referencias: [{ link: "https://a.com.br" }, { anexo_id: "x" }, { link: "não é link" }] };
    expect(campoRespondido(ref, duas)).toBe(false);
    expect(erroDoCampo(ref, duas)).toBe("Faltam 1 de 3.");
    const tres = { referencias: [{ link: "https://a.com.br" }, { anexo_id: "x" }, { link: "pinterest.com/pin/1" }] };
    expect(campoRespondido(ref, tres)).toBe(true);
    expect(textoDaResposta(ref, { referencias: [{ link: "https://a.com.br", nota: "as cores" }] })).toBe("https://a.com.br (as cores)");
  });

  it("escala, checklist, envio e confirmar", () => {
    const escala = camposDoModelo(site).find((c) => c.tipo === "scale")!;
    expect(textoDaResposta(escala, { [escala.key]: 5 })).toMatch(/^Bem /);
    expect(textoDaResposta(escala, { [escala.key]: 3 })).toMatch(/^Equilíbrio/);
    const mat = campo("materiais");
    expect(textoDaResposta(mat, { materiais: { "Manual ou guia da marca": "vou_enviar" } })).toBe("Manual ou guia da marca: vou enviar");
    const logo = campo("anexoLogo");
    expect(campoRespondido(logo, {}, [{ id: "a1", campo: "anexoLogo", categoria: "logo", nome: "logo.ai" }])).toBe(true);
    const empresa = campo("empresa");
    expect(erroDoCampo(empresa, {})).toBe("Confirme ou corrija.");
    expect(campoRespondido(empresa, { empresa__ok: true })).toBe(true);
  });

  it("progresso e o que falta contam só o que está visível", () => {
    const vazio = progressoDoBriefing(site, {});
    const comSite = progressoDoBriefing(site, { temSiteAtual: "Sim" });
    expect(comSite.total).toBeGreaterThan(vazio.total);
    const faltam = faltandoNoBriefing(site, {}).map((c) => c.key);
    expect(faltam).toContain("historia");
    expect(faltam).not.toContain("siteAtualProblemas");
  });

  it("dado já sabido vira pré-preenchimento só dos campos de confirmar", () => {
    const p = prefillDoModelo(site, { empresa: "Padaria Aurora", instagram: "@aurora", negocio: "pães" });
    expect(p).toEqual({ empresa: "Padaria Aurora", instagram: "@aurora" });
  });

  it("url aceita endereço, domínio e @perfil", () => {
    expect(urlValida("https://aceleriq.com.br")).toBe(true);
    expect(urlValida("aceleriq.com.br")).toBe(true);
    expect(urlValida("@aceleriq")).toBe(true);
    expect(urlValida("javascript:alert(1)")).toBe(false);
    expect(urlValida("texto solto")).toBe(false);
  });
});

describe("validade do link e envio único", () => {
  it("estado do link: aberto, expirado e enviado (enviado vence expirado)", () => {
    const agora = new Date("2026-09-30T12:00:00Z");
    expect(estadoDoLink({ submitted: false, expira_em: "2026-10-30T12:00:00Z" }, agora)).toBe("aberto");
    expect(estadoDoLink({ submitted: false, expira_em: "2026-09-30T11:59:59Z" }, agora)).toBe("expirado");
    expect(estadoDoLink({ submitted: true, expira_em: "2026-09-01T00:00:00Z" }, agora)).toBe("enviado");
    expect(estadoDoLink({ submitted: false, expira_em: null }, agora)).toBe("aberto");
  });

  it("as RPCs públicas recusam link expirado, arquivado e segundo envio; a tabela segue fechada para anon", () => {
    const sql = ler("supabase/migrations/20260930010100_briefing_link_publico.sql");
    const submit = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.briefing_public_submit"), sql.indexOf("CREATE OR REPLACE FUNCTION public.briefing_public_pedir_reabertura"));
    expect(submit).toMatch(/SECURITY DEFINER/);
    expect(submit).toMatch(/arquivado_em IS NULL FOR UPDATE/);
    expect(submit).toMatch(/IF NOT FOUND OR b\.submitted IS TRUE THEN\s+RETURN false;/);
    expect(submit).toMatch(/b\.expira_em <= now\(\) THEN\s+RETURN false;/);
    expect(submit).toMatch(/INSERT INTO public\.briefing_decupagens/);
    expect(submit).toMatch(/avisar_equipe_do_cliente/);
    expect(submit).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
    const salvar = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.briefing_public_save"), sql.indexOf("CREATE OR REPLACE FUNCTION public.briefing_public_submit"));
    expect(salvar).toMatch(/'motivo', 'enviado'/);
    expect(salvar).toMatch(/'motivo', 'expirado'/);
    // Reserva de anexo só com a chave de serviço.
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.briefing_anexo_reservar\(text, text, text, text, text, bigint\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.briefing_anexo_reservar\(text, text, text, text, text, bigint\) TO service_role;/);
    const tabelas = ler("supabase/migrations/20260930010000_briefing_modelos_e_link.sql");
    expect(tabelas).not.toMatch(/TO anon/);
    expect(tabelas).not.toMatch(/GRANT [A-Z, ]*(INSERT|UPDATE)[A-Z, ]* ON TABLE public\.briefing_(anexos|decupagens) TO authenticated/);
    expect(tabelas).toMatch(/can_access_client\(client_id\)/);
    // Links antigos continuam sem validade (a coluna nasce nula) e os novos ganham 30 dias.
    expect(tabelas).toMatch(/ALTER COLUMN expira_em SET DEFAULT \(now\(\) \+ interval '30 days'\)/);
  });

  it("as funções novas estão registradas com a porta certa", () => {
    const config = ler("supabase/config.toml");
    expect(config).toMatch(/\[functions\.briefing-agente\]\s+verify_jwt = true/);
    expect(config).toMatch(/\[functions\.briefing-publico\]\s+verify_jwt = false/);
  });
});

describe("link por tipo", () => {
  it("cada mesa oferece o modelo do serviço dela", () => {
    expect(modeloDaMesa("videos")).toBe("video");
    expect(modeloDaMesa("edicao")).toBe("video");
    expect(modeloDaMesa("ads")).toBe("landing");
    expect(modeloDaMesa("mesa")).toBe("redes");
    expect(modeloDaMesa("site")).toBe("site");
    expect(modeloDaMesa("identidade")).toBe("identidade");
    expect(modeloDaMesa("naming")).toBe("naming");
    expect(modeloDaMesa("qualquer")).toBeNull();
  });

  it("a mensagem pronta cita o tipo, o link e a validade, sem travessão nem exclamação", () => {
    const msg = mensagemDoLink({ cliente: "Padaria Aurora", modelo: MODELOS_DE_FABRICA.identidade, url: "https://app.example.com/briefing/abc", expiraEm: "2026-10-30T12:00:00Z" });
    expect(msg).toContain("Olá, Padaria Aurora.");
    expect(msg).toContain("briefing de identidade visual");
    expect(msg).toContain("https://app.example.com/briefing/abc");
    expect(msg).toMatch(/vale até \d\d\/10/);
    expect(msg).not.toMatch(/[!—–]/);
    expect(mensagemDoLink({ cliente: "X", modelo: MODELOS_DE_FABRICA.site, url: "u", grupo: true })).toMatch(/^Olá, pessoal\./);
  });

  it("WhatsApp: com telefone vai direto (DDI 55), sem telefone abre a escolha do contato", () => {
    expect(linkDoWhatsApp("oi", "(41) 99999-0000")).toBe("https://wa.me/5541999990000?text=oi");
    expect(linkDoWhatsApp("a b", null)).toBe("https://wa.me/?text=a%20b");
  });
});
