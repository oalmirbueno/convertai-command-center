import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mesa, 23/09: agente do mês (pedido livre com anexos), hypes da semana e
 * campanhas. Conferência pelo código da função e da migration.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const calendario = ler("supabase/functions/agente-calendario/index.ts");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const migration = ler("supabase/migrations/20260923171454_mesa_campanhas_e_hypes.sql");
const corpoDe = (fonte: string, nome: string) => {
  const i = fonte.indexOf(`async function ${nome}(`);
  const j = fonte.indexOf("\nasync function ", i + 10);
  return fonte.slice(i, j > 0 ? j : undefined);
};

describe("agente do mês: pedido livre", () => {
  const p = corpoDe(calendario, "pedidoLivre");
  it("aceita só anexos do próprio cliente e lê as imagens com o modelo", () => {
    const anexos = corpoDe(calendario, "baixarAnexos");
    expect(anexos).toContain("c.startsWith(`${clientId}/`)");
    expect(anexos).toContain('c.indexOf("..") < 0');
    expect(p).toContain("imagens: anexos.imagens.length ? anexos.imagens : undefined");
  });
  it("depoimento vira texto transcrito sem inventar", () => {
    expect(p).toContain("transcrito exatamente como está");
  });
  it("devolve uma proposta pronta (gravar e conversar continuam iguais) e guarda a conversa", () => {
    expect(p).toContain('status: "pronta"');
    expect(p).toContain('origem: "pedido_livre"');
    expect(p).toContain("registrarMensagens(servico, conversaId");
  });
});

describe("hypes da semana", () => {
  const h = corpoDe(calendario, "buscarHypes");
  it("uma busca por cliente e semana: sem forcar, devolve a guardada sem custo", () => {
    expect(h).toContain('if (corpo.forcar !== true)');
    expect(h).toContain("cache: true, custo_usd: 0");
    expect(migration).toContain("CONSTRAINT mesa_hypes_cliente_semana_unica UNIQUE (client_id, semana)");
  });
  it("pesquisa na web e ordena pela relevância do Jev, cobrada do cliente", () => {
    expect(h).toContain("pesquisaWeb: true");
    expect(h).toContain("await jevPerguntar(");
    expect(h).toContain("await cobrarJev(");
    expect(h).toContain("Nunca invente evento nem data.");
  });
});

describe("campanhas", () => {
  it("equipe lê e muda só nome, estado e referências; o resto vem da função", () => {
    expect(migration).toContain("GRANT UPDATE (nome, status, referencias_ids) ON public.mesa_campanhas TO authenticated;");
    expect(migration).toContain("public.can_access_client(client_id)");
  });
  it("campanha cria proposta pronta com os itens ligados à campanha e o gravar marca gravada", () => {
    const c = corpoDe(calendario, "campanhaCriar");
    expect(c).toContain('origem: "campanha"');
    expect(c).toContain(").campanha_id = campanhaId;");
    expect(calendario).toContain('update({ status: "gravada" }).eq("id", p.parametros.campanha_id)');
  });
  it("ajuste na conversa não perde o vínculo com a campanha", () => {
    expect(corpoDe(calendario, "conversar")).toContain("item.campanha_id = p.parametros.campanha_id");
  });
  it("o Estúdio segue a identidade da campanha e anexa o selo na capa e no fechamento", () => {
    expect(estudio).toContain("direcao.campanha_id = campanha.id;");
    expect(corpoDe(estudio, "gerarCard")).toContain("campanha?.selo_path && levaLogo(t, ordem)");
    expect(corpoDe(estudio, "gerarCard")).toContain("baseComCampanha");
  });
});

/**
 * 25/09, pedido do dono: campanha completa. Imagens anexadas com papel e
 * porquê, briefing (produto, oferta, mensagem, público, provas, tom, CTA) e
 * plano de imagens (estrategista com visão + Jev), levado ao Estúdio no gravar.
 */
describe("campanha completa: imagens, briefing e plano de imagens", () => {
  const sql = ler("docs/mesa/migrations/20260925120000_mesa_campanhas_completas.sql");
  const trecho = (inicio: string, fim: string) => {
    const i = calendario.indexOf(inicio);
    const j = calendario.indexOf(fim, i + inicio.length);
    return calendario.slice(i, j > 0 ? j : undefined);
  };

  it("o SQL novo acrescenta briefing, imagens (até 12) e plano_imagens, idempotente e sem abrir escrita à equipe", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS briefing jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS imagens jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS plano_imagens jsonb");
    expect(sql).toContain("jsonb_array_length(imagens) <= 12");
    expect(sql).not.toMatch(/GRANT\s+UPDATE/i);
    expect(sql).not.toContain("—");
  });

  it("campanha_salvar grava só o que veio e confere cada imagem no acervo do cliente (nunca referência da internet)", () => {
    const s = corpoDe(calendario, "campanhaSalvar");
    expect(s).toContain("if (corpo.briefing !== undefined) campos.briefing = normalizarBriefing(corpo.briefing);");
    expect(s).toContain("fotosDoAcervoPorId(servico, c.client_id");
    expect(s).toContain("recusadas");
    const acervo = corpoDe(calendario, "fotosDoAcervoPorId");
    expect(acervo).toContain('.eq("client_id", clientId)');
    expect(acervo).toContain('.eq("ativa", true)');
    expect(acervo).toContain("!fotoNaoPublicavel(a)");
    expect(calendario).toContain('t === "nao_publicar" || t === "referencia_web"');
  });

  it("o plano de imagens vê as fotos (reduzidas), cita por código curto em vez de UUID e o Jev decide entre candidatas", () => {
    const p = corpoDe(calendario, "campanhaPlanoImagens");
    expect(p).toContain("fotoParaLeitura(servico, x.foto");
    expect(p).toContain("mensagens: [{ papel: \"usuario\", conteudo: pedido, imagens }]");
    expect(p).toContain("codigos.set(`F${vistas.length}`");
    expect(p).toContain("timeoutMs: TIMEOUT_CALENDARIO_MS");
    expect(p).toContain("decidirFotosComJev(");
    const jev = corpoDe(calendario, "decidirFotosComJev");
    expect(jev).toContain('type: "choice"');
    expect(jev).toContain("criteria.nenhuma");
    expect(jev).toContain("await cobrarJev(");
    // Resposta com fôlego (a plataforma derruba com 504 aos 150 s).
    expect(calendario).toMatch(/ACOES_LONGAS = new Set\(\[[^\]]*"campanha_plano_imagens"/);
  });

  it("a normalização do plano descarta código desconhecido, lâmina inexistente e foto repetida como fundo no mesmo conteúdo", () => {
    const n = trecho("export function normalizarPlanoDeImagens(", "export function semFundoRepetido(");
    expect(n).toContain("if (!item) continue;");
    expect(n).toContain("ordem > nCards");
    expect(n).toContain('uso: item.carrossel_infinito ? "elemento"');
    const r = trecho("export function semFundoRepetido(", "async function decidirFotosComJev(");
    expect(r).toContain("p.candidatas.find((c) => !doItem.has(c))");
  });

  it("campanha_criar recebe briefing e imagens da equipe, a equipe vence a IA e sem o SQL a campanha ainda nasce", () => {
    const c = corpoDe(calendario, "campanhaCriar");
    expect(c).toContain("normalizarBriefing(corpo.briefing)");
    expect(c).toContain("normalizarImagensDaCampanha(corpo.imagens)");
    expect(c).toContain("juntarBriefing(normalizarBriefing(r.briefing), briefingDaEquipe)");
    expect(c).toContain("briefing, imagens: imagensValidas, plano_imagens: plano");
    expect(c).toContain("faltaColunaNova(error)");
    expect(c).toContain("REGRAS_DO_PLANO_DE_IMAGENS");
  });

  it("o gravar leva a foto do plano ao Estúdio (fundo vira imagens_ids, elemento vira fotos_livres; contínuo não recebe foto)", () => {
    // Desde 25/09 a função é compartilhada com o Estúdio (_shared/fotos-do-plano.ts).
    const compartilhado = ler("supabase/functions/_shared/fotos-do-plano.ts");
    const a = compartilhado.slice(compartilhado.indexOf("export function aplicarFotosDoPlano("));
    expect(calendario).toContain('import { aplicarFotosDoPlano, pecasDoPlanoGravado } from "../_shared/fotos-do-plano.ts";');
    expect(a).toContain("if (direcao.carrossel_infinito) return 0;");
    expect(a).toContain("card.imagens_ids = [foto.id];");
    expect(a).toContain('card.fotos_livres = [{ caminho: foto.storage_path, papel: "elemento"');
    expect(corpoDe(calendario, "criarDirecoesDoRoteiro")).toContain("aplicarFotosDoPlano(direcao, item.tema_id");
    expect(corpoDe(calendario, "gravarItens")).toContain("descricaoDoItem({ ...item, data }, p.id, i, campanhaNoItem)");
    expect(calendario).toContain("linhas.push(`  Foto da campanha: ${foto}`)");
  });

  it("pedido livre e conversa da campanha passam a enxergar o briefing e as imagens", () => {
    expect(corpoDe(calendario, "pedidoLivre")).toContain("resumoDaCampanha(campanha, fotosDaCamp)");
    expect(corpoDe(calendario, "campanhaConversar")).toContain("resumoDaCampanha(c, fotosDaCamp)");
    expect(corpoDe(calendario, "campanhaConversar")).toContain("campos.briefing = normalizarBriefing(nova.briefing)");
  });

  it("a assinatura do plano é a mesma conta na tela e na função", () => {
    const tela = ler("src/components/mesa/campanhasApi.ts");
    const linhas = [
      'const a = imagens.map((i) => `${i.imagem_id}:${i.papel || ""}`).sort().join(",");',
      'const b = itens.map((i) => `${i.tema_id || ""}:${Array.isArray(i.cards) ? i.cards.length : 0}`).sort().join(",");',
      "return `${a}|${b}`;",
    ];
    for (const l of linhas) {
      expect(tela).toContain(l);
      expect(calendario).toContain(l);
    }
  });

  it("sem travessão nos textos novos da função", () => {
    const novos = trecho("// ------------------------------- campanha completa", "const resumoDaCampanha");
    expect(novos.length).toBeGreaterThan(1000);
    expect(novos).not.toContain("—");
    expect(corpoDe(calendario, "campanhaPlanoImagens")).not.toContain("—");
  });
});
