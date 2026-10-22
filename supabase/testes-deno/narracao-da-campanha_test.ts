/**
 * 22/10/2026: a narração da peça de vídeo da campanha (campanha_narracao, caminho Gerar). O texto são as
 * falas das cenas na ordem; custo antes (409 sem gastar); com confirmado, a voz sai numa chamada só, é
 * cobrada, guardada e gravada em itens[].roteiro_video.narracao com o trecho de cada cena. Banco,
 * Storage e ElevenLabs falsos.
 *
 *   npx --yes deno test --no-lock --allow-env --allow-read supabase/testes-deno/narracao-da-campanha_test.ts
 */
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { acoesDaNarracao, type CampanhaDaNarracao, type ItemDaNarracao, type PropostaDaNarracao } from "../functions/agente-calendario/modulos/narracao-da-campanha.ts";
import { duracoesDasCenas, falasDaNarracao, pedidoDaNarracao, situacaoDaNarracao, textoDaNarracao } from "../functions/agente-calendario/modulos/narracao-da-campanha-regras.ts";
import { normalizarRoteiroDeVideo, type RoteiroDeVideo } from "../functions/agente-calendario/modulos/roteiro-de-video.ts";
import { estimarNarracao, modeloDeVoz } from "../functions/mesa-motion/modulos/narracao.ts";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const CAMP = "44444444-4444-4444-8444-444444444444";
const PROPOSTA = "22222222-2222-4222-8222-222222222222";
const PEDIDO = "77777777-7777-4777-8777-777777777777";
const MIDIA = "66666666-6666-4666-8666-666666666666";
const VOZ = "AbCdEfGh12345678";

const roteiro = (): RoteiroDeVideo =>
  normalizarRoteiroDeVideo({
    gancho: "Sua loja vazia na Black Friday?",
    cenas: [
      { descricao: "Vitrine apagada", fala: "Sua loja vazia na Black Friday?", texto_na_tela: "Loja vazia?", segundos: 3 },
      { descricao: "Clientes entrando", fala: "", texto_na_tela: "Até 40%", segundos: 4 },
      { descricao: "Caixa cheio", fala: "Até quarenta por cento, só neste fim de semana.", texto_na_tela: "Só este fim de semana", segundos: 5 },
    ],
    trilha: "Black Friday · Opção A",
    cta: "Chame no direct",
  }) as RoteiroDeVideo;

class Erro extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

/** Alinhamento falso da ElevenLabs: 0,06 s por caractere do texto enviado. */
function alinhamentoDe(texto: string) {
  const chars = texto.split("");
  return { characters: chars, character_start_times_seconds: chars.map((_c, i) => i * 0.06), character_end_times_seconds: chars.map((_c, i) => i * 0.06 + 0.06) };
}

function montar(itens: ItemDaNarracao[]) {
  const reg = {
    inserts: [] as Array<{ tabela: string; linha: Record<string, unknown> }>,
    rpcs: [] as Array<{ nome: string; args: Record<string, unknown> }>,
    uploads: [] as string[],
    salvos: [] as ItemDaNarracao[][],
    pedidosTts: [] as Array<{ url: string; corpo: Record<string, unknown> }>,
    saldo: [] as number[],
    somas: [] as number[],
  };
  let proposta: PropostaDaNarracao = { id: PROPOSTA, client_id: CLIENTE, itens };
  const campanha: CampanhaDaNarracao = { id: CAMP, client_id: CLIENTE, nome: "Black Friday da Loja", proposta_id: PROPOSTA };
  const consulta = (tabela: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "is"]) b[m] = () => b;
    let inserindo = false;
    b.insert = (l: Record<string, unknown>) => {
      inserindo = true;
      reg.inserts.push({ tabela, linha: l });
      return b;
    };
    const um = () => {
      if (tabela === "video_arquivos" && inserindo) return { data: { id: MIDIA }, error: null };
      if (tabela === "video_pedidos") return { data: { id: PEDIDO, client_id: CLIENTE }, error: null };
      return { data: null, error: null };
    };
    b.single = () => Promise.resolve(um());
    b.maybeSingle = () => Promise.resolve(um());
    b.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(tabela === "motion_vozes" ? { data: [{ voice_id: "MarcaVoz12345678", nome: "Voz da loja", origem: "desenhada", padrao: true, previa_path: null }], error: null } : { data: [], error: null }).then(ok, falha);
    return b;
  };
  const servico = {
    from: consulta,
    rpc: (nome: string, args: Record<string, unknown>) => {
      reg.rpcs.push({ nome, args });
      return Promise.resolve({ data: [{ saldo_usd: 9 }], error: null });
    },
    storage: {
      from: () => ({
        upload: (caminho: string) => {
          reg.uploads.push(caminho);
          return Promise.resolve({ data: { path: caminho }, error: null });
        },
        createSignedUrl: (caminho: string) => Promise.resolve({ data: { signedUrl: `https://assinado.test/${caminho}` }, error: null }),
        createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://assinado.test/${p}`, error: null })), error: null }),
      }),
    },
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (String(url).indexOf("/v2/voices") >= 0) {
      return new Response(JSON.stringify({ voices: [{ voice_id: VOZ, name: "Ana", category: "premade", description: "calma", preview_url: "https://x.test/a.mp3", verified_languages: [{ language: "pt", preview_url: "https://x.test/pt.mp3" }] }], has_more: false }), { status: 200 });
    }
    const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    reg.pedidosTts.push({ url: String(url), corpo });
    const audio = btoa(String.fromCharCode(...new Uint8Array(32000)));
    return new Response(JSON.stringify({ audio_base64: audio, alignment: alinhamentoDe(String(corpo.text)) }), { status: 200 });
  }) as unknown as typeof fetch;
  const acoes = acoesDaNarracao({
    erro: (s, c, m, e) => new Erro(s, c, m, e),
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    carregarCampanha: () => Promise.resolve(campanha),
    exigirAcesso: () => Promise.resolve(),
    carregarProposta: () => Promise.resolve(proposta),
    salvarItens: (_s, p, novos) => {
      reg.salvos.push(novos);
      proposta = { ...p, itens: novos };
      return Promise.resolve(proposta);
    },
    somarCusto: (_s, _id, _c, v) => {
      reg.somas.push(v);
      return Promise.resolve();
    },
    garantirSaldo: (_c, v) => {
      reg.saldo.push(v);
      return Promise.resolve(10);
    },
    lerChave: () => Promise.resolve("sk_teste"),
    fetchImpl,
    agora: () => new Date("2026-10-22T12:00:00Z"),
  });
  // deno-lint-ignore no-explicit-any
  const chamar = (corpo: Record<string, unknown>) => acoes.campanhaNarracao(servico as any, { userId: "u-1", token: "t" }, { campanha_id: CAMP, ...corpo });
  return { chamar, reg, proposta: () => proposta };
}

const pecaDeVideo = (): ItemDaNarracao => ({ tema_id: "t-video", formato: "video", tema: "Reels da oferta", roteiro_video: roteiro() });

Deno.test("regras: as falas na ordem (cena sem fala fica de fora), o custo de tabela e a situação", () => {
  const r = roteiro();
  assertEquals(falasDaNarracao(r).map((f) => f.ordem), [1, 3]);
  assertEquals(textoDaNarracao(r), "Sua loja vazia na Black Friday?\n\nAté quarenta por cento, só neste fim de semana.");
  const p = pedidoDaNarracao(r);
  assertEquals(p.modelo.id, "eleven_v4");
  assertEquals(p.enviado, textoDaNarracao(r));
  assertEquals(p.custo_usd, Math.round((p.enviado.length / 1000) * modeloDeVoz("eleven_v4").preco_1k_usd * 1e6) / 1e6);
  // A mesma tabela da Mesa Motion (só a linha em branco entre as falas pesa a mais).
  assert(Math.abs(p.custo_usd - estimarNarracao([textoDaNarracao(r)], "eleven_v4").custo_usd) < 0.001);
  assertEquals(pedidoDaNarracao(r, "eleven_flash_v2_5").custo_usd, Math.round((p.enviado.length / 1000) * 0.04 * 1e6) / 1e6);
  assertEquals(situacaoDaNarracao(r), "falta");
  assertEquals(situacaoDaNarracao({ ...r, cenas: r.cenas.map((c) => ({ ...c, fala: "" })) }), "sem_falas");
});

Deno.test("gerar sem confirmado: 409 confirmar_custo com o custo, nada chamado nem cobrado", async () => {
  const s = montar([pecaDeVideo()]);
  const e = await s.chamar({ operacao: "gerar", tema_id: "t-video", voz_id: VOZ }).catch((x) => x);
  assert(e instanceof Erro);
  assertEquals(e.status, 409);
  assertEquals(e.codigo, "confirmar_custo");
  assertEquals(e.extra.custo_estimado_usd, pedidoDaNarracao(roteiro()).custo_usd);
  assertEquals(s.reg.pedidosTts.length, 0);
  assertEquals(s.reg.saldo.length, 0);
  assertEquals(s.reg.rpcs.length, 0);
});

Deno.test("gerar confirmado: uma chamada com as falas, cobra, guarda e grava a narração com o tempo de cada cena", async () => {
  const s = montar([{ tema_id: "outro", formato: "carrossel" }, pecaDeVideo()]);
  const resp = await s.chamar({ operacao: "gerar", tema_id: "t-video", voz_id: VOZ, voz_nome: "Ana", confirmado: true });
  const j = await resp.json();
  // Uma chamada só, no TTS com tempo por caractere, em português, pelo v4.
  assertEquals(s.reg.pedidosTts.length, 1);
  assertMatch(s.reg.pedidosTts[0].url, new RegExp(`/v1/text-to-speech/${VOZ}/with-timestamps`));
  assertEquals(s.reg.pedidosTts[0].corpo.text, textoDaNarracao(roteiro()));
  assertEquals(s.reg.pedidosTts[0].corpo.model_id, "eleven_v4");
  assertEquals(s.reg.pedidosTts[0].corpo.language_code, "pt");
  // Saldo antes e a cobrança na carteira do cliente.
  const custo = pedidoDaNarracao(roteiro()).custo_usd;
  assertEquals(s.reg.saldo, [custo]);
  const uso = s.reg.rpcs.find((x) => x.nome === "ia_registrar_uso");
  assert(uso);
  assertEquals(uso!.args._client_id, CLIENTE);
  assertEquals(uso!.args._provedor, "elevenlabs");
  assertEquals(uso!.args._modelo_id, "elevenlabs:eleven_v4");
  assertEquals(uso!.args._referencia_tipo, "mesa_campanha");
  assertEquals(uso!.args._referencia_id, CAMP);
  assertEquals(uso!.args._custo_usd, custo);
  assertEquals(s.reg.somas, [custo]);
  // MP3 na pasta da campanha e na Mídia, sem campanha_id na origem (a aba Trilha não lista a voz).
  assertMatch(s.reg.uploads[0], new RegExp(`^${CLIENTE}/campanhas/${CAMP}/narracao/t-video-.+\\.mp3$`));
  const midia = s.reg.inserts.find((x) => x.tabela === "video_arquivos")!;
  assertEquals(midia.linha.grupo, "narracao");
  assertEquals(midia.linha.tipo, "audio");
  assertEquals((midia.linha.origem as Record<string, unknown>).campanha_id, undefined);
  assertEquals((midia.linha.origem as Record<string, unknown>).campanha_narracao_id, CAMP);
  // Gravada no item da peça (e só nele), com o trecho de cada cena com fala.
  assertEquals(s.reg.salvos.length, 1);
  const salvo = s.reg.salvos[0].find((i) => i.tema_id === "t-video")!;
  const n = (salvo.roteiro_video as RoteiroDeVideo).narracao!;
  assertEquals(n.arquivo, s.reg.uploads[0]);
  assertEquals(n.arquivo_id, MIDIA);
  assertEquals(n.voz, { voice_id: VOZ, nome: "Ana" });
  assertEquals(n.texto, textoDaNarracao(roteiro()));
  assertEquals(n.cenas.map((c) => c.ordem), [1, 3]);
  assert(n.cenas[0].ate_s <= n.cenas[1].de_s, "o trecho da cena 1 termina antes do da cena 3");
  assert(n.palavras.length > 5);
  assertEquals(s.reg.salvos[0].find((i) => i.tema_id === "outro"), { tema_id: "outro", formato: "carrossel" });
  // A resposta: o arquivo, a duração e o tempo de cada cena.
  assertEquals(j.cenas, n.cenas);
  assert(j.duracao_s > 0);
  assertMatch(String(j.link), /^https:\/\/assinado\.test\//);
  assertEquals(j.custo_usd, custo);
  // A narração em dia casa a duração das cenas com a fala; a cena sem fala fica com os segundos dela.
  const r2 = normalizarRoteiroDeVideo(salvo.roteiro_video) as RoteiroDeVideo;
  assertEquals(situacaoDaNarracao(r2), "em_dia");
  const tempos = duracoesDasCenas(r2);
  assertEquals(tempos[1], { ordem: 2, duracao_s: 4, fala: null });
  assert(tempos[0].fala !== null && tempos[0].duracao_s >= 2);
  // Mudou a fala depois: desatualizada.
  assertEquals(situacaoDaNarracao({ ...r2, cenas: r2.cenas.map((c) => (c.ordem === 1 ? { ...c, fala: "Outra fala" } : c)) }), "desatualizada");
});

Deno.test("gerar: peça sem fala, voz inválida e peça que não é vídeo param antes de gastar", async () => {
  const semFala = { ...pecaDeVideo(), roteiro_video: { ...roteiro(), cenas: roteiro().cenas.map((c) => ({ ...c, fala: "" })) } };
  const s = montar([semFala, { tema_id: "foto", formato: "foto" }]);
  assertEquals((await s.chamar({ operacao: "gerar", tema_id: "t-video", voz_id: VOZ, confirmado: true }).catch((x) => x)).codigo, "sem_falas");
  assertEquals((await s.chamar({ operacao: "gerar", tema_id: "foto", voz_id: VOZ, confirmado: true }).catch((x) => x)).codigo, "peca_nao_e_video");
  const s2 = montar([pecaDeVideo()]);
  assertEquals((await s2.chamar({ operacao: "gerar", tema_id: "t-video", voz_id: "x", confirmado: true }).catch((x) => x)).codigo, "voz_invalida");
  assertEquals(s.reg.pedidosTts.length + s2.reg.pedidosTts.length, 0);
});

Deno.test("registrar: o pedido da cena em vídeo e a montagem ficam no roteiro da peça; a narração continua", async () => {
  const comNarracao = { ...pecaDeVideo(), roteiro_video: { ...roteiro(), narracao: { arquivo: `${CLIENTE}/x.mp3`, arquivo_id: null, modelo: "eleven_v4", custo_usd: 0, em: "", voz: { voice_id: VOZ, nome: "Ana" }, texto: "a", cenas: [], palavras: [], duracao_s: 3 } } };
  const s = montar([comNarracao]);
  await s.chamar({ operacao: "registrar", tema_id: "t-video", cena: { ordem: 2, pedido_id: PEDIDO, motor: "seedance-2.0-mini" } });
  const r = normalizarRoteiroDeVideo(s.proposta().itens[0].roteiro_video) as RoteiroDeVideo;
  assertEquals(r.cenas[1].video?.pedido_id, PEDIDO);
  assertEquals(r.cenas[1].video?.motor, "seedance-2.0-mini");
  assert(!!r.cenas[1].video?.assinatura);
  assertEquals(r.cenas[0].video, undefined);
  assertEquals(r.narracao?.arquivo, `${CLIENTE}/x.mp3`);
  // Sem pedido: a cena volta a não ter vídeo.
  await s.chamar({ operacao: "registrar", tema_id: "t-video", cena: { ordem: 2, pedido_id: null } });
  assertEquals((normalizarRoteiroDeVideo(s.proposta().itens[0].roteiro_video) as RoteiroDeVideo).cenas[1].video, undefined);
  // Várias cenas de uma vez (sem uma apagar a outra) e a montagem.
  await s.chamar({ operacao: "registrar", tema_id: "t-video", cenas: [{ ordem: 1, pedido_id: PEDIDO, motor: "m" }, { ordem: 3, pedido_id: PEDIDO, motor: "m" }] });
  const r3 = normalizarRoteiroDeVideo(s.proposta().itens[0].roteiro_video) as RoteiroDeVideo;
  assertEquals(r3.cenas.map((c) => !!c.video), [true, false, true]);
  const e = await s.chamar({ operacao: "registrar", tema_id: "t-video", cena: { ordem: 9, pedido_id: PEDIDO } }).catch((x) => x);
  assertEquals(e.codigo, "cena_inexistente");
});

Deno.test("vozes: as da conta da ElevenLabs (prévia em português) e as da marca, sem custo", async () => {
  const s = montar([pecaDeVideo()]);
  const j = await (await s.chamar({ operacao: "vozes" })).json();
  assertEquals(j.tem_chave, true);
  assertEquals(j.vozes[0], { voice_id: VOZ, nome: "Ana", categoria: "premade", descricao: "calma", previa_url: "https://x.test/pt.mp3", idiomas: ["pt"] });
  assertEquals(j.vozes_da_marca[0].voice_id, "MarcaVoz12345678");
  assertEquals(j.modelo_padrao, "eleven_v4");
  assertEquals(j.custo_usd, 0);
});
