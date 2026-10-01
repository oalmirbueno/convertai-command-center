/**
 * Frente MOV (30/09/2026): o caminho da narração no servidor, com banco e
 * ElevenLabs falsos. Roda com: npx deno test supabase/functions/mesa-motion/voz_test.ts
 * Confere: sem chave diz o que falta; o roteiro inteiro sai numa chamada, o
 * áudio sobe para a pasta do filme, vai para a Mídia, o gasto é registrado
 * como motion/elevenlabs e cada cena fica com o seu trecho; encaixar as
 * cenas usa o tempo da fala; clone sem autorização não chama a ElevenLabs.
 */

import { criarVoz, type DepsDaVoz } from "./voz.ts";
import { lerSom, type LinhaDoFilme, normalizarFilme } from "./modulos/motion-metodo.ts";

function igual(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} esperado ${y}, veio ${x}`);
}
function ok(v: unknown, msg: string) {
  if (!v) throw new Error(msg);
}

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const FILME = "33333333-3333-4333-8333-333333333333";
const USUARIO = "22222222-2222-4222-8222-222222222222";

function filmeBase(): LinhaDoFilme {
  return normalizarFilme({
    id: FILME,
    client_id: CLIENTE,
    nome: "Filme",
    tipo: "apresentacao",
    cenas: [
      { id: "c1", titulo: "Gancho", peca: "abertura", params: { titulo: "Oi" }, duracao_s: 4 },
      { id: "c2", titulo: "Marca", peca: "cartao_final", params: { chamada: "Fale" }, duracao_s: 4 },
    ],
    som: { narracao: { ligada: true, voz: { voice_id: "abcdEFGH1234", nome: "Clara", origem: "biblioteca" }, falas: { c1: "[warmly] Seu marketing sem plano?", c2: "A gente organiza tudo." } } },
  })!;
}

function montar(o: { chave?: string; fetchImpl?: typeof fetch; base?: LinhaDoFilme } = {}) {
  let filme = o.base || filmeBase();
  const registro = { uploads: [] as string[], midia: [] as Record<string, unknown>[], usos: [] as Record<string, unknown>[], saldo: [] as number[] };
  const tabela = (nome: string) => ({
    insert: (linha: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          if (nome === "video_arquivos") registro.midia.push(linha);
          return { data: { id: "44444444-4444-4444-8444-444444444444" }, error: null };
        },
      }),
    }),
  });
  const servico = {
    from: tabela,
    storage: { from: () => ({ upload: async (caminho: string) => (registro.uploads.push(caminho), { error: null }) }) },
    rpc: async (_n: string, p: Record<string, unknown>) => (registro.usos.push(p), { data: [{ uso_id: "u1", saldo_usd: 9.9 }], error: null }),
  };
  const erro = (status: number, codigo: string, mensagem: string) => Object.assign(new Error(mensagem), { status, codigo });
  const d: DepsDaVoz = {
    servico: () => servico as unknown as ReturnType<DepsDaVoz["servico"]>,
    json: (b, s = 200) => new Response(JSON.stringify(b), { status: s }),
    erro,
    garantirAcesso: async () => {},
    lerFilme: async () => filme,
    atualizarFilme: async (_id, campos) => (filme = normalizarFilme({ ...filme, ...campos })!),
    somarCusto: async (f, custo, campos = {}) => (filme = normalizarFilme({ ...f, ...campos, custo_usd: f.custo_usd + custo })!),
    modeloDoPedido: async () => {
      throw new Error("sem modelo de texto no teste");
    },
    kitDoFilme: async () => ({ nome: "AcelerIQ", estilo: null, tom: null, regras: null }),
    linksDoFilme: async () => ({}),
    pedirBatidas: async () => null,
    auditar: async () => {},
    conexao: () => ({ chave: o.chave ?? "sk_teste", fetchImpl: o.fetchImpl }),
    garantirSaldo: async (_c, usd) => registro.saldo.push(usd),
  };
  return { voz: criarVoz(d), registro, filme: () => filme, mudar: (fn: (f: LinhaDoFilme) => LinhaDoFilme) => (filme = fn(filme)) };
}

const ch = { userId: USUARIO, doChamador: {} as never };

/** ElevenLabs falsa: devolve 32 kB de "mp3" (2 s) e o tempo por caractere do texto pedido. */
function elevenFalsa(pedidos: Array<Record<string, unknown>>): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body));
    pedidos.push(corpo);
    const chars = String(corpo.text).split("");
    const audio = btoa("x".repeat(32_000));
    return new Response(JSON.stringify({ audio_base64: audio, alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.03), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.03) } }));
  }) as unknown as typeof fetch;
}

Deno.test("sem a chave: gerar a narração volta voz_sem_chave", async () => {
  const { voz } = montar({ chave: "" });
  let erro: { codigo?: string } | null = null;
  try {
    await voz.gerarNarracao(ch, filmeBase(), "roteiro");
  } catch (e) {
    erro = e as { codigo?: string };
  }
  igual(erro && erro.codigo, "voz_sem_chave", "código");
});

Deno.test("roteiro inteiro: uma chamada, áudio na pasta do filme, na Mídia, gasto registrado e trecho por cena", async () => {
  const pedidos: Array<Record<string, unknown>> = [];
  const { voz, registro, filme } = montar({ fetchImpl: elevenFalsa(pedidos) });
  const r = await voz.gerarNarracao(ch, filmeBase(), "roteiro");
  igual(pedidos.length, 1, "chamadas");
  igual(pedidos[0].model_id, "eleven_v4", "modelo");
  igual(pedidos[0].language_code, "pt", "idioma");
  ok(String(pedidos[0].text).indexOf("[warmly]") === 0, "a tag vai para o v4");
  ok(registro.uploads[0].indexOf(`${CLIENTE}/video/motion/${FILME}/narracao/`) === 0, "pasta do filme");
  igual(registro.midia[0].grupo, "narracao", "Mídia");
  igual(registro.usos[0]._provedor, "elevenlabs", "provedor");
  igual(registro.usos[0]._tarefa, "motion", "tarefa");
  ok(registro.saldo[0] > 0, "saldo conferido antes");
  const n = lerSom(filme().som).narracao;
  igual(n.audios.length, 1, "um áudio");
  igual(n.audios[0].trechos.map((t) => t.cena_id), ["c1", "c2"], "trechos");
  ok(n.audios[0].trechos[0].ate_s <= n.audios[0].trechos[1].de_s, "trechos em ordem");
  igual(n.audios[0].duracao_s, 2, "duração do mp3");
  ok(r.custo > 0 && r.avisos.length === 0, "custo e sem aviso");
});

Deno.test("encaixar as cenas na voz usa o tempo de cada fala", async () => {
  const pedidos: Array<Record<string, unknown>> = [];
  const { voz, filme } = montar({ fetchImpl: elevenFalsa(pedidos) });
  await voz.gerarNarracao(ch, filmeBase(), "cenas");
  igual(pedidos.length, 2, "uma chamada por cena");
  ok(pedidos[1].previous_text === "Seu marketing sem plano?", "a cena 2 leva a fala anterior (sem tag) para a entonação");
  const r = await voz.casarNarracao(filme());
  igual(r.casadas, 2, "casadas");
  r.filme.cenas.forEach((c) => ok(c.duracao_s >= 2 && c.duracao_s <= 12, "duração no limite"));
});

Deno.test("clone sem a autorização registrada não chama a ElevenLabs", async () => {
  let chamou = false;
  const { voz } = montar({ fetchImpl: (async () => ((chamou = true), new Response("{}"))) as unknown as typeof fetch });
  let erro: { codigo?: string } | null = null;
  try {
    await voz.acoes.voz_clonar(ch, { client_id: CLIENTE, nome: "Ana", caminhos: [`${CLIENTE}/a.mp3`], autorizacao: { quem: "", como: "" }, confirma: true });
  } catch (e) {
    erro = e as { codigo?: string };
  }
  igual(erro && erro.codigo, "autorizacao_do_clone", "código");
  igual(chamou, false, "não chamou");
});

/** Filme de 8 cenas, todas com fala (o filme da marca tem de 6 a 10 planos). */
function filmeDe8(): LinhaDoFilme {
  const cenas = [];
  const falas: Record<string, string> = {};
  for (let i = 1; i <= 8; i++) {
    cenas.push({ id: `c${i}`, titulo: `Cena ${i}`, peca: "abertura", params: { titulo: `T${i}` }, duracao_s: 3 });
    falas[`c${i}`] = `Fala numero ${i} do filme.`;
  }
  return normalizarFilme({ id: FILME, client_id: CLIENTE, nome: "Filme", tipo: "apresentacao", cenas, som: { narracao: { ligada: true, voz: { voice_id: "abcdEFGH1234", nome: "Clara", origem: "biblioteca" }, falas } } })!;
}

Deno.test("8 cenas no roteiro: mudar a fala da última marca só ela, e 'só as que faltam' gera só ela e mantém os outros trechos", async () => {
  const pedidos: Array<Record<string, unknown>> = [];
  const { voz, filme, mudar } = montar({ fetchImpl: elevenFalsa(pedidos), base: filmeDe8() });
  await voz.gerarNarracao(ch, filme(), "roteiro");
  igual(pedidos.length, 1, "roteiro numa chamada");
  // A equipe muda a fala da cena 8 depois da narração.
  mudar((f) => normalizarFilme({ ...f, som: { ...f.som, narracao: { ...f.som.narracao, falas: { ...f.som.narracao.falas, c8: "Fala nova da cena oito." } } } })!);
  const { narracaoDaCena } = await import("./modulos/narracao.ts");
  const n = lerSom(filme().som).narracao;
  igual(narracaoDaCena(n, "c8")!.desatualizada, true, "a cena 8 fica desatualizada");
  for (let i = 1; i <= 7; i++) igual(narracaoDaCena(n, `c${i}`)!.desatualizada, false, `a cena ${i} continua em dia`);
  await voz.gerarNarracao(ch, filme(), "cenas");
  igual(pedidos.length, 2, "só a cena 8 foi gerada de novo");
  igual(pedidos[1].text, "Fala nova da cena oito.", "o texto novo");
  const depois = lerSom(filme().som).narracao;
  igual(depois.audios.length, 2, "o áudio do roteiro continua, mais o da cena 8");
  igual(depois.audios[0].trechos.map((t) => t.cena_id), ["c1", "c2", "c3", "c4", "c5", "c6", "c7"], "o roteiro perdeu só o trecho da cena 8");
  for (let i = 1; i <= 8; i++) igual(narracaoDaCena(depois, `c${i}`)!.desatualizada, false, `cena ${i} em dia`);
  igual(narracaoDaCena(depois, "c8")!.audio.id, depois.audios[1].id, "a cena 8 usa o áudio novo");
});

Deno.test("narração longa: o volume e a fala mudados na tela durante a geração não são sobrescritos", async () => {
  const pedidos: Array<Record<string, unknown>> = [];
  let mudarNoMeio: (() => void) | null = null;
  const base = elevenFalsa(pedidos);
  const fetchImpl = (async (u: string, i: RequestInit) => {
    if (mudarNoMeio) mudarNoMeio();
    return await base(u, i);
  }) as unknown as typeof fetch;
  const { voz, filme, mudar } = montar({ fetchImpl });
  mudarNoMeio = () => mudar((f) => normalizarFilme({ ...f, som: { ...f.som, narracao: { ...f.som.narracao, volume: 0.6, falas: { ...f.som.narracao.falas, c2: "Fala trocada no meio." } } } })!);
  await voz.gerarNarracao(ch, filmeBase(), "roteiro");
  const n = lerSom(filme().som).narracao;
  igual(n.volume, 0.6, "volume da tela");
  igual(n.falas.c2, "Fala trocada no meio.", "fala da tela");
  const { narracaoDaCena } = await import("./modulos/narracao.ts");
  igual(narracaoDaCena(n, "c2")!.desatualizada, true, "o áudio novo leu a fala antiga: fica desatualizado");
  igual(narracaoDaCena(n, "c1")!.desatualizada, false, "a cena 1 em dia");
});
