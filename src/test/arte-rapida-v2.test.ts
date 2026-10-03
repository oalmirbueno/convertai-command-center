import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Arte rápida v2 (02/10, pedidos do dono):
 * 1. o nome da arte é o título escrito NELA (headline da capa), não o pedido;
 * 2. todo aviso diz o cliente (tela, link do indicador de geração e avisos do banco);
 * 3. até 16 imagens com papéis simples; o diretor vê até 8;
 * 4. link de post do Instagram com 3 modos (sem login, fixtures sintéticas);
 * 5. vitrine de logos (parceiros): grade colada pelo código, distribuída nas lâminas;
 * 6. o diretor na conversa recebe o pedido inteiro.
 */

import {
  aplicarArquivosNasLaminas,
  arteRapidaDa,
  comTituloDaArte,
  corpoDaArteRapida,
  decidirArteRapida,
  DICA_DO_PAPEL,
  INSTRUCOES_DA_ARTE_RAPIDA,
  MAX_IMAGENS_DA_ARTE_RAPIDA,
  MAX_IMAGENS_VISTAS_PELO_DIRETOR,
  normalizarPedidoDaArteRapida,
  PAPEIS_NA_TELA,
  pedidoParaODiretor,
  pedidoProntoParaIr,
  perguntasDaArteRapida,
  ROTULO_CURTO_DO_PAPEL,
  tituloDaArte,
  tituloDoAviso,
  type ArquivoDaArteRapida,
} from "../../supabase/functions/estudio-arte/modulos/arte-rapida";
import {
  codigoDoPostDoInstagram,
  desescapar,
  enderecoDoEmbed,
  enderecoDoPost,
  hostDaImagemPermitido,
  imagensDoEmbed,
  lerPaginaDoPost,
  lerPostDoInstagram,
  MAX_IMAGENS_DO_POST,
  PostBloqueado,
} from "../../supabase/functions/estudio-arte/modulos/post-do-instagram";
import {
  areaDaVitrine,
  areaLivreParaAVitrine,
  celulasDaGrade,
  distribuirLogosNasLaminas,
  laminasDoCarrosselDaVitrine,
  pedeVitrinePelaRegra,
} from "../../supabase/functions/estudio-arte/modulos/vitrine-de-logos";
import { geracoesPorCliente, type ItemNaFila } from "@/lib/mesa/filaDeGeracao";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fixture = (n: string) => ler(`src/test/fixtures/instagram/${n}`);

// ------------------------------------------------------------------ 1. título

describe("1. o nome da arte vem do título escrito nela", () => {
  const capa = (extra: Record<string, unknown> = {}) => ({
    ordem: 1,
    funcao: "capa",
    texto_exato: "Nossos parceiros\nquem caminha com a gente",
    blocos: [{ papel: "headline", texto: "Nossos\nparceiros" }, { papel: "subtitulo", texto: "quem caminha com a gente" }],
    ...extra,
  });

  it("headline da primeira lâmina (pela ordem), sem quebra de linha e sem travessão", () => {
    expect(tituloDaArte([{ ordem: 2, texto_exato: "Lâmina 2", blocos: [{ papel: "headline", texto: "Outra" }] }, capa()])).toBe("Nossos parceiros");
    expect(tituloDaArte([{ ordem: 1, texto_exato: "90% OFF — só hoje\nNo Pix" }])).toBe("90% OFF, só hoje");
  });

  it("blocos antigos (o texto mudou num ajuste): vale a primeira linha do texto exato", () => {
    expect(tituloDaArte([capa({ texto_exato: "Parceiros 2026\nobrigado" })])).toBe("Parceiros 2026");
  });

  it("título longo corta na palavra; sem texto, null", () => {
    const t = tituloDaArte([{ ordem: 1, texto_exato: "Uma frase muito comprida que passa bastante do limite de setenta caracteres da arte" }]);
    expect(t!.length).toBeLessThanOrEqual(73);
    expect(t!.endsWith("...")).toBe(true);
    expect(tituloDaArte([])).toBeNull();
    expect(tituloDaArte([{ ordem: 1, texto_exato: "" }])).toBeNull();
  });

  it("arteRapidaDa e comTituloDaArte: a arte manda; o pedido só antes do diretor", () => {
    const direcao = { cards: [capa()], arte_rapida: { pedido: "faz um post apresentando os parceiros do evento", titulo: "Faz um post apresentando os parceiros do evento", peca: "unica", arquivos: [] } };
    expect(arteRapidaDa(direcao)!.titulo).toBe("Nossos parceiros");
    expect((comTituloDaArte(direcao).arte_rapida as { titulo: string }).titulo).toBe("Nossos parceiros");
    // Sem lâminas: o título gravado (o do pedido).
    expect(arteRapidaDa({ cards: [], arte_rapida: { pedido: "x", titulo: "Do pedido", peca: "unica", arquivos: [] } })!.titulo).toBe("Do pedido");
    // Trabalho que não é arte rápida: nada muda.
    const comum = { cards: [capa()] };
    expect(comTituloDaArte(comum)).toBe(comum);
  });

  it("servidor: título sincronizado depois do diretor, na conversa e no ajuste de texto", () => {
    const fonte = ler("supabase/functions/estudio-arte/index.ts");
    expect(fonte).toContain("direcao = comTituloDaArte(direcao);");
    expect(fonte).toContain("return { direcao: comTituloDaArte(r.direcao) };");
    expect(fonte).toContain("direcao: comTituloDaArte({ ...x.direcao, duvida_do_ajuste: null");
  });
});

// ------------------------------------------------------------------ 2. cliente nos avisos

describe("2. o cliente em todo aviso", () => {
  it("tituloDoAviso põe o cliente na frente", () => {
    expect(tituloDoAviso("Arte arquivada", "Acerbi")).toBe("Acerbi: Arte arquivada");
    expect(tituloDoAviso("Arte arquivada", "")).toBe("Arte arquivada");
  });

  it("a tela da arte rápida e o Estúdio usam o cliente nos avisos", () => {
    const tela = ler("src/components/mesa/EstudioArteRapida.tsx");
    for (const t of ["Arte rápida criada", "A direção está pronta", "Sobre o pedido", "Arte arquivada", "Arte na Agenda"]) expect(tela).toContain(`aviso("${t}")`);
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain('avisoDaPeca(data.na_fila ? "Gerando no servidor"');
    expect(aba).toContain('avisoDaPeca(data?.parado ? "Geração parada" : "Lâminas geradas")');
  });

  it("o indicador de geração abre a própria arte rápida (rapida=<trabalho>)", () => {
    const item = (trabalho: string): ItemNaFila => ({
      id: `i-${trabalho}`, client_id: CLIENTE, trabalho_id: trabalho, ordem: 1, lote_id: "l", status: "rodando", etapa: "gerar", rodadas: 0, tentativas: 0, custo_usd: 0,
      pedido_por: null, proxima_em: null, trava_ate: null, criado_em: "2026-10-02T10:00:00Z", iniciado_em: null, concluido_em: null, erro_codigo: null, erro_mensagem: null, aviso: null,
    });
    const [g] = geracoesPorCliente([item("t1")], { [CLIENTE]: "Acerbi" }, { t1: { task_id: null, tipo: null, rapida: true } });
    expect(g.link).toBe(`/mesa?client=${CLIENTE}&aba=estudio&rapida=t1`);
    const [h] = geracoesPorCliente([item("t2")], {}, { t2: { task_id: "task-9", tipo: null, rapida: true } });
    expect(h.link).toBe(`/mesa?client=${CLIENTE}&aba=estudio&task=task-9`);
    expect(ler("src/lib/mesa/filaDeGeracao.ts")).toContain("rapida:direcao->arte_rapida->>peca");
  });

  it("migration: avisos da Mesa com o cliente, corpo copiado e privilégios iguais", () => {
    const sql = ler("supabase/migrations/20261002110000_avisos_com_cliente.sql");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.mesa_com_cliente(_client uuid, _mensagem text)");
    expect(sql).toContain("_n := public.avisar_equipe_do_cliente(_client, public.mesa_com_cliente(_client, _mensagem), _tipo, _link);");
    expect(sql).toContain("RETURN _nome || ' (Mesa): ' || substr(_mensagem, 7);");
    expect((sql.match(/public\.mesa_com_cliente\(_t\.client_id, 'Mesa: /g) || []).length).toBe(2);
    expect(sql).toContain("public.mesa_com_cliente(_f.client_id, 'Mesa: uma arte aprovada");
    expect((sql.match(/^ ?SECURITY DEFINER$/gm) || []).length).toBe(3);
    expect((sql.match(/SET search_path TO ''/g) || []).length).toBe(3);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mesa_agendar_aprovados() TO service_role;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mesa_avisar_peca(uuid, text, text, text, text) TO service_role;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.mesa_com_cliente(uuid, text) FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/\r/);
  });
});

// ------------------------------------------------------------------ 3. imagens e papéis

const arquivo = (i: number, papel = "auto") => ({ caminho: `${CLIENTE}/pedidos/img-${i}.jpg`, nome: `img-${i}.jpg`, papel });

describe("3. até 16 imagens, papéis simples", () => {
  it("o servidor aceita 16 e corta a 17ª; o corpo da tela também", () => {
    expect(MAX_IMAGENS_DA_ARTE_RAPIDA).toBe(16);
    expect(MAX_IMAGENS_VISTAS_PELO_DIRETOR).toBe(8);
    const lista = Array.from({ length: 17 }, (_, i) => arquivo(i));
    expect(normalizarPedidoDaArteRapida({ pedido: "x", arquivos: lista }, CLIENTE).arquivos).toHaveLength(16);
    const corpo = corpoDaArteRapida({ clientId: CLIENTE, pedido: "x", peca: "auto", campanha: null, arquivos: lista as never, documentos: [] });
    expect((corpo.arquivos as unknown[]).length).toBe(16);
  });

  it("os papéis na tela: Referência, Fazer igual, Compor, Logo, Rosto", () => {
    expect(PAPEIS_NA_TELA.map((p) => ROTULO_CURTO_DO_PAPEL[p])).toEqual(["Referência", "Fazer igual", "Compor", "Logo", "Rosto"]);
    expect(DICA_DO_PAPEL.arte_para_melhorar).toMatch(/Fazer igual: reproduz/);
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("Fazer igual (A1...)");
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("Mantenha o layout, a estrutura, a hierarquia e todo o conteúdo");
  });

  it("o diretor vê até 8 imagens; as outras mesas seguem com 6 anexos", () => {
    const fonte = ler("supabase/functions/estudio-arte/index.ts");
    expect(fonte).toContain(".slice(0, MAX_IMAGENS_VISTAS_PELO_DIRETOR);");
    expect(ler("src/components/mesa/mesaV4Api.ts")).toContain("export const MAX_ANEXOS = 6;");
    expect(ler("src/components/mesa/EstudioArteRapida.tsx")).toContain("useAnexos(clientId, { max: MAX_IMAGENS_DA_ARTE_RAPIDA })");
    // Geração: as logos comuns seguem no teto de 2 elementos por chamada e o teto de anexos por lâmina não mudou.
    expect(fonte).toContain('const elementos = livres.filter((f) => f.papel === "elemento").slice(0, 2);');
    expect(ler("supabase/functions/_shared/direcao-arte.ts")).toContain("export const MAX_ANEXOS_DA_LAMINA = 6;");
  });
});

// ------------------------------------------------------------------ 4. Instagram

describe("4. post do Instagram (sem login)", () => {
  it("código do post: /p/, /reel/, /reels/, /tv/, com o @ antes; outros links não", () => {
    expect(codigoDoPostDoInstagram("https://www.instagram.com/p/CxEXEMPLO12/?igsh=abc")).toEqual({ codigo: "CxEXEMPLO12", tipo: "p" });
    expect(codigoDoPostDoInstagram("instagram.com/reels/DAbc_123-x/")).toEqual({ codigo: "DAbc_123-x", tipo: "reel" });
    expect(codigoDoPostDoInstagram("https://instagram.com/loja.exemplo/p/CxEXEMPLO12/")).toEqual({ codigo: "CxEXEMPLO12", tipo: "p" });
    expect(codigoDoPostDoInstagram("https://www.instagram.com/loja.exemplo/")).toBeNull();
    expect(codigoDoPostDoInstagram("https://evil.com/p/CxEXEMPLO12/")).toBeNull();
    expect(enderecoDoPost({ codigo: "Abc12", tipo: "reel" })).toBe("https://www.instagram.com/reel/Abc12/");
    expect(enderecoDoEmbed({ codigo: "Abc12", tipo: "reel" })).toBe("https://www.instagram.com/p/Abc12/embed/captioned/");
  });

  it("página do post: capa, autor e legenda (inglês e português)", () => {
    const en = lerPaginaDoPost(fixture("post-pagina.html"))!;
    expect(en.autor).toBe("loja.exemplo");
    expect(en.legenda).toBe("Semana do café ☕ 3 dicas para o seu espresso. 1) moa na hora 2) água a 92 graus 3) 25 segundos. Qual você já faz?");
    expect(en.capa).toContain("cdninstagram.com");
    expect(en.capa).toContain("&_nc_ht=");
    const pt = lerPaginaDoPost(fixture("post-pagina-pt.html"))!;
    expect(pt).toMatchObject({ autor: "estudio_teste", legenda: "Bastidores do ensaio de hoje" });
    expect(lerPaginaDoPost(fixture("login.html"))).toBeNull();
  });

  it("embed do carrossel: as lâminas na ordem, só do CDN do Instagram, sem a capa repetida", () => {
    const imgs = imagensDoEmbed(fixture("embed-carrossel.html"));
    expect(imgs.map((u) => u.split("?")[0].split("/").pop())).toEqual(["lamina1_n.jpg", "lamina2_n.jpg", "lamina3_n.jpg"]);
    expect(imgs[0]).toContain("&_nc_ht=x&oh=1");
    expect(desescapar("https:\\\\\\/\\\\\\/a.cdninstagram.com\\\\\\/x.jpg?a=1\\\\u0026b=2")).toBe("https://a.cdninstagram.com/x.jpg?a=1&b=2");
    expect(MAX_IMAGENS_DO_POST).toBe(10);
  });

  it("host das imagens: só cdninstagram.com e fbcdn.net por https", () => {
    expect(hostDaImagemPermitido("https://scontent.cdninstagram.com/a.jpg")).toBe(true);
    expect(hostDaImagemPermitido("https://x.fna.fbcdn.net/a.jpg")).toBe(true);
    expect(hostDaImagemPermitido("http://scontent.cdninstagram.com/a.jpg")).toBe(false);
    expect(hostDaImagemPermitido("https://cdninstagram.com.evil.net/a.jpg")).toBe(false);
    expect(hostDaImagemPermitido("https://evilcdninstagram.com/a.jpg")).toBe(false);
  });

  it("lerPostDoInstagram: carrossel pelo embed; bloqueado vira PostBloqueado com mensagem para mandar print", async () => {
    const paginas: Record<string, string> = {
      "https://www.instagram.com/p/CxEXEMPLO12/": fixture("post-pagina.html"),
      "https://www.instagram.com/p/CxEXEMPLO12/embed/captioned/": fixture("embed-carrossel.html"),
    };
    const r = await lerPostDoInstagram("https://www.instagram.com/p/CxEXEMPLO12/", async (u) => paginas[u] ?? null);
    expect(r).toMatchObject({ codigo: "CxEXEMPLO12", autor: "loja.exemplo" });
    expect(r.imagens).toHaveLength(3);
    // Só a página (sem embed): a capa.
    const so = await lerPostDoInstagram("https://www.instagram.com/p/CxEXEMPLO12/", async (u) => (u.indexOf("embed") < 0 ? paginas[u] : null));
    expect(so.imagens).toHaveLength(1);
    await expect(lerPostDoInstagram("https://www.instagram.com/p/CxEXEMPLO12/", async () => fixture("login.html"))).rejects.toBeInstanceOf(PostBloqueado);
    await expect(lerPostDoInstagram("https://example.com", async () => null)).rejects.toMatchObject({ motivo: "link_invalido" });
  });

  const post = (modo: string) => ({ url: "https://www.instagram.com/p/CxEXEMPLO12/", autor: "loja.exemplo", legenda: "Semana do café", modo });
  const doPost = (n: number) => ({ caminho: `${CLIENTE}/pedidos/instagram/CxEXEMPLO12/${n}.jpg`, nome: `instagram-${n}.jpg`, papel: "auto" });

  it("pedido: as imagens do post entram como Referência; em Só o conteúdo, ficam de fora", () => {
    const ambos = normalizarPedidoDaArteRapida({ pedido: "", post_do_instagram: post("referencia_e_conteudo"), arquivos: [doPost(1), doPost(2)] }, CLIENTE);
    expect(ambos.post).toMatchObject({ codigo: "CxEXEMPLO12", modo: "referencia_e_conteudo", autor: "loja.exemplo" });
    expect(ambos.arquivos.map((a) => a.papel)).toEqual(["referencia", "referencia"]);
    const conteudo = normalizarPedidoDaArteRapida({ pedido: "", post_do_instagram: post("so_conteudo"), arquivos: [doPost(1)] }, CLIENTE);
    expect(conteudo.arquivos).toHaveLength(0);
    // Imagem do post sem o post: fora.
    expect(normalizarPedidoDaArteRapida({ pedido: "x", arquivos: [doPost(1)] }, CLIENTE).arquivos).toHaveLength(0);
    // Só o post (com legenda) já basta para ir.
    expect(pedidoProntoParaIr("", 0, 0, true)).toBe(true);
    const corpo = corpoDaArteRapida({ clientId: CLIENTE, pedido: "", peca: "auto", campanha: null, arquivos: [], documentos: [], post: { ...post("so_referencia"), codigo: "CxEXEMPLO12", modo: "so_referencia" } as never });
    expect(corpo.post_do_instagram).toMatchObject({ modo: "so_referencia", url: "https://www.instagram.com/p/CxEXEMPLO12/" });
  });

  it("diretor: inspira, nunca copia; conteúdo só nos modos com conteúdo", () => {
    const p = normalizarPedidoDaArteRapida({ pedido: "", post_do_instagram: post("referencia_e_conteudo"), arquivos: [doPost(1)] }, CLIENTE);
    const d = decidirArteRapida(p, perguntasDaArteRapida(p, []), null);
    const comConteudo = pedidoParaODiretor({ pedido: p.pedido, peca: d.peca, arquivos: d.arquivos, post: p.post }, []) as Record<string, any>;
    expect(comConteudo.post_do_instagram).toMatchObject({ modo: "referencia_e_conteudo", conteudo: "Semana do café", imagens: ["R1"] });
    const soRef = pedidoParaODiretor({ pedido: "x", peca: "unica", arquivos: [], post: { ...p.post!, modo: "so_referencia" } }, []) as Record<string, any>;
    expect(soRef.post_do_instagram.conteudo).toBeNull();
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("INSPIRE, NUNCA COPIE");
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain('"faça exatamente como está aqui"');
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("nunca o @ nem o nome do autor na arte");
  });

  it("servidor: ação rapida_instagram com o robô de prévia, host conferido e teto de bytes", () => {
    const fonte = ler("supabase/functions/estudio-arte/index.ts");
    expect(fonte).toContain("rapida_instagram: rapidaInstagram,");
    expect(fonte).toContain('"User-Agent": UA_DO_INSTAGRAM');
    expect(fonte).toContain("if (!hostDaImagemPermitido(url)) return null;");
    expect(fonte).toContain("MAX_BYTES_DA_IMAGEM_DO_POST");
    expect(fonte).toContain('tipo.indexOf("image/") !== 0');
  });
});

// ------------------------------------------------------------------ 5. vitrine de logos

describe("5. vitrine de logos (parceiros)", () => {
  it("distribuição: arte única até 12; carrossel com a capa livre e grades equilibradas de até 9", () => {
    expect(distribuirLogosNasLaminas(5, [1]).porLamina).toEqual({ 1: [0, 1, 2, 3, 4] });
    expect(distribuirLogosNasLaminas(14, [1])).toMatchObject({ fora: 2 });
    const c = distribuirLogosNasLaminas(10, [1, 2, 3]);
    expect(c.porLamina[1]).toBeUndefined();
    expect(c.porLamina[2]).toEqual([0, 1, 2, 3, 4]);
    expect(c.porLamina[3]).toEqual([5, 6, 7, 8, 9]);
    expect(c.fora).toBe(0);
    // 20 logos e só 2 lâminas de logos: até 12 por lâmina, o resto fica de fora.
    const apertado = distribuirLogosNasLaminas(26, [1, 2, 3]);
    expect(apertado.porLamina[2]).toHaveLength(12);
    expect(apertado.fora).toBe(2);
    // 4 logos num carrossel de 4 lâminas: uma lâmina de logos só.
    expect(Object.keys(distribuirLogosNasLaminas(4, [1, 2, 3, 4]).porLamina)).toEqual(["2"]);
    expect(laminasDoCarrosselDaVitrine(10)).toBe(3);
    expect(laminasDoCarrosselDaVitrine(3)).toBe(2);
  });

  it("grade: células dentro da área, sem sobrepor, última linha centralizada", () => {
    const area = areaDaVitrine(true);
    const cel = celulasDaGrade(5, area);
    expect(cel).toHaveLength(5);
    for (const c of cel) {
      expect(c.x0).toBeGreaterThanOrEqual(area.x0 - 1e-9);
      expect(c.x1).toBeLessThanOrEqual(area.x1 + 1e-9);
      expect(c.y0).toBeGreaterThanOrEqual(area.y0 - 1e-9);
      expect(c.y1).toBeLessThanOrEqual(area.y1 + 1e-9);
    }
    // 3 em cima, 2 embaixo centralizadas: o meio da última linha é o meio da área.
    const meio = (cel[3].x0 + cel[4].x1) / 2;
    expect(Math.abs(meio - (area.x0 + area.x1) / 2)).toBeLessThan(0.001);
    expect(cel[0].x1).toBeLessThan(cel[1].x0);
    expect(areaLivreParaAVitrine(area, 5)).toContain("Não desenhe nenhuma logo de parceiro");
  });

  const logos = (n: number, papel = "logo") => Array.from({ length: n }, (_, i) => ({ caminho: `${CLIENTE}/pedidos/logo-${i}.png`, nome: `empresa-${i}.png`, papel }));

  it("Jev: a pergunta da vitrine só com 3 ou mais logos; decide com confiança; sem o Jev, a regra do pedido", () => {
    const p = normalizarPedidoDaArteRapida({ pedido: "apresentar os parceiros do evento", arquivos: logos(4) }, CLIENTE);
    const q = perguntasDaArteRapida(p, []);
    expect(q.questions.vitrine).toBeTruthy();
    expect(Object.keys((q.questions.vitrine as any).criteria)).toEqual(["vitrine", "comum"]);
    expect(perguntasDaArteRapida(normalizarPedidoDaArteRapida({ pedido: "x", arquivos: logos(2) }, CLIENTE), []).questions.vitrine).toBeUndefined();
    expect(decidirArteRapida(p, q, { vitrine: { choice: "vitrine", confidence: 0.92 }, peca: { choice: "unica", confidence: 0.9 } }).vitrine).toMatchObject({ por: "jev", logos: 4 });
    expect(decidirArteRapida(p, q, { vitrine: { choice: "comum", confidence: 0.9 } }).vitrine).toBeNull();
    expect(decidirArteRapida(p, q, null).vitrine).toMatchObject({ por: "regra" });
    expect(pedeVitrinePelaRegra("post com as logos dos patrocinadores")).toBe(true);
    expect(pedeVitrinePelaRegra("promoção do mouse")).toBe(false);
  });

  it("mais de 9 logos sem a equipe decidir a peça: vira carrossel; sem vitrine, o aviso de sempre", () => {
    const p = normalizarPedidoDaArteRapida({ pedido: "nossos parceiros", arquivos: logos(11) }, CLIENTE);
    const d = decidirArteRapida(p, perguntasDaArteRapida(p, []), { vitrine: { choice: "vitrine", confidence: 0.95 }, peca: { choice: "unica", confidence: 0.95 } });
    expect(d.peca).toBe("carrossel");
    const comum = normalizarPedidoDaArteRapida({ pedido: "promoção", arquivos: logos(3) }, CLIENTE);
    const dc = decidirArteRapida(comum, perguntasDaArteRapida(comum, []), { vitrine: { choice: "comum", confidence: 0.9 } });
    expect(dc.vitrine).toBeNull();
    expect(dc.avisos.join(" ")).toMatch(/Até 2 logos por lâmina/);
  });

  it("nas lâminas: as logos vão para a grade (nunca ao gerador como elemento) e a capa do carrossel fica livre", () => {
    const arquivos: ArquivoDaArteRapida[] = logos(10).map((l, i) => ({ codigo: `L${i + 1}`, imagem_id: null, caminho: l.caminho, nome: l.nome, papel: "logo", papel_por: "equipe" }));
    const vitrine = { por: "jev" as const, confianca: 0.9, logos: 10 };
    const cards = aplicarArquivosNasLaminas([{ ordem: 1 }, { ordem: 2 }, { ordem: 3 }], {}, arquivos, "carrossel", vitrine);
    expect(cards[0].vitrine_de_logos).toBeUndefined();
    expect(cards[1].vitrine_de_logos).toHaveLength(5);
    expect(cards[2].vitrine_de_logos!.map((l) => l.nome)).toEqual(["empresa-5.png", "empresa-6.png", "empresa-7.png", "empresa-8.png", "empresa-9.png"]);
    expect(cards.every((c) => !(c.fotos_livres || []).some((f) => f.papel === "elemento"))).toBe(true);
    const [unica] = aplicarArquivosNasLaminas([{ ordem: 1 }], {}, arquivos.slice(0, 6), "unica", vitrine);
    expect(unica.vitrine_de_logos).toHaveLength(6);
    // Sem vitrine: o caminho de sempre (até 2 logos como elemento).
    const [sem] = aplicarArquivosNasLaminas([{ ordem: 1 }], {}, arquivos.slice(0, 3), "unica");
    expect(sem.vitrine_de_logos).toBeUndefined();
    expect((sem.fotos_livres || []).filter((f) => f.papel === "elemento")).toHaveLength(2);
  });

  it("diretor e servidor: plano das lâminas com logos, área lisa no prompt e logos coladas pelo código", () => {
    const arquivos: ArquivoDaArteRapida[] = logos(10).map((l, i) => ({ codigo: `L${i + 1}`, imagem_id: null, caminho: l.caminho, nome: l.nome, papel: "logo", papel_por: "jev" }));
    const ctx = pedidoParaODiretor({ pedido: "parceiros", peca: "carrossel", arquivos, vitrine: { por: "jev", confianca: 0.9, logos: 10 } }, []) as Record<string, any>;
    expect(ctx.vitrine_de_logos).toEqual({ total_de_logos: 10, laminas_com_logos: [{ ordem: 2, logos: 5 }, { ordem: 3, logos: 5 }] });
    expect(INSTRUCOES_DA_ARTE_RAPIDA).toContain("Vitrine de logos (`item.pedido_avulso.vitrine_de_logos`)");
    const fonte = ler("supabase/functions/estudio-arte/index.ts");
    expect(fonte).toContain("areaLivreParaAVitrine(vitrineAqui.area, vitrineAqui.logos.length)) : \"\",");
    expect(fonte).toContain("const r = await colarVitrineNaArte(pngFinal, vitrinePedida, t.client_id);");
    expect(fonte).toContain("...(vitrineDaVersao(atualVersao) ? { vitrine_de_logos: vitrineDaVersao(atualVersao) } : {}),");
    expect(fonte).toContain("notaDaVitrineParaOLeitor(vitrineColada.area)");
  });
});

// ------------------------------------------------------------------ 6. conversa

describe("6. o diretor na conversa recebe o pedido inteiro", () => {
  it("contexto da conversa leva papéis, post e vitrine", () => {
    expect(ler("supabase/functions/estudio-arte/index.ts")).toContain("arte_rapida: arteRapida ? pedidoParaODiretor(arteRapida, [], total) : null,");
  });
});
