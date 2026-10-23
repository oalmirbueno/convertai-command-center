import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { caminhoDeVideoDaLamina, laminaComVideo, videoProntoDaLamina } from "../../supabase/functions/estudio-arte/modulos/lamina-de-video-na-entrega";

/**
 * Carrossel com lâmina de vídeo na publicação automática (23/10/2026, dono: "deixe tudo pronto").
 * - Entrega (estudio-arte): a lâmina com vídeo pronto da versão atual vai para Arquivos em MP4 no lugar do
 *   PNG, na mesma posição; sem MP4 pronto (ou fora do formato), segue o PNG.
 * - Banco (migration 20261023160000): o filho do carrossel vale como vídeo e o motor manda o cartão em vídeo
 *   como VIDEO, esperando FINISHED antes do pai; o resto do motor é o vigente byte a byte.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const sql = ler("supabase/migrations/20261023160000_carrossel_com_video.sql");
const vigente = ler("supabase/migrations/20261020120000_stories_da_mesa.sql");
const estudio = ler("supabase/functions/estudio-arte/index.ts");

const corpoDa = (texto: string, nome: string) => {
  const ini = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}()`);
  expect(ini, nome).toBeGreaterThanOrEqual(0);
  return texto.slice(ini, texto.indexOf("$function$;", ini));
};

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const MP4 = `${CLIENTE}/estudio/template/videos/t-2-v3-abc12345.mp4`;
const versao = (extra: Record<string, unknown> = {}) => ({ ordem: 2, versao: 3, tamanho: "1080x1350", template_profile: { estilo: "carrossel", bloco: { tipo: "video" } }, ...extra });

describe("entrega: a lâmina de vídeo vai em MP4 no lugar do PNG", () => {
  it("só o MP4 da pasta de vídeos do Template deste cliente vale", () => {
    expect(caminhoDeVideoDaLamina(MP4, CLIENTE)).toBe(MP4);
    expect(caminhoDeVideoDaLamina(`outro/estudio/template/videos/x.mp4`, CLIENTE)).toBeNull();
    expect(caminhoDeVideoDaLamina(`${CLIENTE}/estudio/template/videos/../x.mp4`, CLIENTE)).toBeNull();
    expect(caminhoDeVideoDaLamina(`${CLIENTE}/estudio/template/videos/x.png`, CLIENTE)).toBeNull();
  });

  it("vídeo no bloco da versão atual: o gravado na versão primeiro, depois o pedido pronto da MESMA versão", () => {
    expect(laminaComVideo(versao())).toBe(true);
    expect(laminaComVideo(versao({ template_profile: { estilo: "carrossel", bloco: { tipo: "imagem" } } }))).toBe(false);
    expect(videoProntoDaLamina(versao({ video_path: MP4 }), [], CLIENTE)).toBe(MP4);
    const pedidos = [
      { estado: "pronto", saida_path: `${CLIENTE}/estudio/template/videos/velho.mp4`, entrada: { ordem: 2, versao: 2 }, criado_em: "2026-10-23T10:00:00Z" },
      { estado: "rodando", saida_path: null, entrada: { ordem: 2, versao: 3 }, criado_em: "2026-10-23T12:00:00Z" },
      { estado: "pronto", saida_path: MP4, entrada: { ordem: 2, versao: 3 }, criado_em: "2026-10-23T11:00:00Z" },
    ];
    expect(videoProntoDaLamina(versao(), pedidos, CLIENTE)).toBe(MP4);
    // Sem MP4 pronto desta versão: fica o PNG (nunca trava).
    expect(videoProntoDaLamina(versao(), pedidos.slice(0, 2), CLIENTE)).toBeNull();
    // O bloco deixou de ser vídeo: o MP4 antigo não entra.
    expect(videoProntoDaLamina(versao({ video_path: MP4, template_profile: { estilo: "carrossel", bloco: { tipo: "grafico" } } }), pedidos, CLIENTE)).toBeNull();
  });

  it("o entregar troca o PNG pelo MP4 na mesma posição, em video/mp4 com sha256, e cai no PNG em qualquer falha", () => {
    const ini = estudio.indexOf("async function entregar(ch: Chamador");
    const entregar = estudio.slice(ini, estudio.indexOf("async function entregarAnuncio(", ini));
    expect(entregar).toContain("videoProntoDaLamina(versao as unknown as VersaoComVideo, pedidosDeVideo, t.client_id)");
    expect(entregar).toContain("laminaJaNoFormato((versao as unknown as { tamanho?: unknown }).tamanho, quadroFinal)");
    expect(entregar).toContain("videosQueFicaramEmPng.push(card.ordem);");
    expect(entregar).toContain("laminas_em_video: laminasEmVideo,");
    // A ordem é a das lâminas: o MP4 entra no mesmo fileIds.push da posição i, com a mesma chave idempotente.
    expect(entregar).toMatch(/if \(idDoVideo\) \{\n\s+fileIds\.push\(idDoVideo\);\n\s+if \(i === 0\) paiId = idDoVideo;/);
    expect(entregar).toContain('mime_type: "video/mp4"');
    expect(entregar).toContain("sha256: await sha256Hex(bytes)");
    expect(entregar).toContain("idempotency_key: p.chave");
    expect(entregar).toContain('.eq("estado", "pronto")');
  });
});

describe("banco: o filho do carrossel pode ser vídeo", () => {
  it("patch no texto vigente da função de mídia publicável: âncora 1 vez, idempotente", () => {
    expect(sql).toContain("pg_get_functiondef('public.editorial_file_is_publishable_media(uuid,uuid,uuid)'::regprocedure)");
    expect(sql).toContain("_alvo text := 'lower(COALESCE(child.mime_type, '''')) LIKE ''image/%''';");
    expect(sql).toContain("LIKE ''video/%'' OR lower(COALESCE(child.extension, '''')) IN (''mp4'', ''mov'', ''m4v''))");
    expect(sql).toContain("RAISE EXCEPTION 'CARROSSEL_VIDEO_MIDIA_ANCHOR_MISMATCH';");
    expect(sql).toContain("RETURN;");
    // A âncora existe exatamente uma vez na versão de origem da função (a que os patches seguintes mantêm).
    const origem = ler("supabase/migrations/20260730010000_fix_editorial_save_and_accounts.sql");
    expect(origem.split("lower(COALESCE(child.mime_type, '')) LIKE 'image/%'").length).toBe(2);
  });
});

describe("motor: cartão em vídeo no carrossel", () => {
  const novo = corpoDa(sql, "editorial_autopublish_tick");
  const antigo = corpoDa(vigente, "editorial_autopublish_tick");
  const ehVideo = /\.(mp4|mov|m4v)(\?|$)/i;

  it("o cartão em vídeo vai como VIDEO com video_url e is_carousel_item; imagem segue com image_url", () => {
    expect(novo.split("|| '?media_type=VIDEO'").length).toBe(3);
    expect(novo.split("|| '&video_url=' || social_private.autopublish_urlencode(_urls[_idx])").length).toBe(2);
    expect(novo.split("|| '&video_url=' || social_private.autopublish_urlencode(_job.child_urls[_idx])").length).toBe(2);
    expect(novo.split("|| '?image_url=' || social_private.autopublish_urlencode(_urls[_idx])").length).toBe(2);
    expect(novo.split("|| '?image_url=' || social_private.autopublish_urlencode(_job.child_urls[_idx])").length).toBe(2);
    expect(novo).toContain("~* '\\.(mp4|mov|m4v)(\\?|$)'");
    // O caminho assinado do Storage termina na extensão antes do token.
    expect(ehVideo.test("https://x.supabase.co/storage/v1/object/sign/files/c/g/v1/2-post.mp4?token=abc")).toBe(true);
    expect(ehVideo.test("https://x.supabase.co/storage/v1/object/sign/files/c/g/v1/1-post.png?token=abc")).toBe(false);
  });

  it("o pai CAROUSEL só sai com os cartões em vídeo FINISHED; ERROR falha claro; teto de 40 rodadas", () => {
    const espera = novo.indexOf("_video_wait := false;");
    const pai = novo.indexOf("|| '?media_type=CAROUSEL'");
    expect(espera).toBeGreaterThan(0);
    expect(espera).toBeLessThan(pai);
    expect(novo).toContain("IF _all_ready AND NOT _video_wait AND NOT EXISTS (");
    expect(novo).toContain("CONTINUE WHEN _status_code = 'FINISHED';");
    expect(novo).toContain("IF _status_code IN ('ERROR', 'EXPIRED') THEN");
    expect(novo).toContain("|| '?fields=status_code&access_token=' || _token.access_token;");
    expect(novo).toContain("SET child_request_ids = _req_ids, poll_count = poll_count + 1, updated_at = now()");
    expect(novo).toContain("IF _job.poll_count >= 40 THEN");
    expect(novo).toContain("'Video do carrossel passou de 40 minutos em processamento no Instagram.'");
    expect(novo).toMatch(/SECURITY DEFINER\nSET search_path = ''/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.editorial_autopublish_tick() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.editorial_autopublish_tick() TO service_role;");
  });

  it("fora dos trechos marcados [carrossel-video], o motor é o vigente (20261020120000) byte a byte", () => {
    const semMarcados = novo.replace(/^[ \t]*-- \[carrossel-video\][^\n]*\n[\s\S]*?^[ \t]*-- \[\/carrossel-video\]\n/gm, "");
    const trocados = [
      "              _payload := _graph || '/' || _token.resource_id || '/media'\n                || '?image_url=' || social_private.autopublish_urlencode(_job.child_urls[_idx])\n                || '&is_carousel_item=true'\n                || '&access_token=' || _token.access_token;\n",
      "          IF _all_ready AND NOT EXISTS (\n",
      "              _payload := _graph || '/' || _token.resource_id || '/media'\n                || '?image_url=' || social_private.autopublish_urlencode(_urls[_idx])\n                || '&is_carousel_item=true'\n                || '&access_token=' || _token.access_token;\n",
    ];
    let esperado = antigo;
    for (const t of trocados) {
      expect(esperado.split(t).length, t.slice(0, 60)).toBe(2);
      esperado = esperado.replace(t, "");
    }
    expect((novo.match(/-- \[carrossel-video\]/g) || []).length).toBe(4);
    expect(semMarcados).toBe(esperado);
  });
});
