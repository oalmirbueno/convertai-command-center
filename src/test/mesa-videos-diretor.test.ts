import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { KITS_DE_VIDEO, kitPorId, lacunasDoTexto, preencherPrompt, problemasDoKit } from "../../supabase/functions/_shared/video-kits";
import {
  atende,
  catalogoEmUso,
  compararVersao,
  custoDoMotor,
  estadoDoMotor,
  motorDoNivel,
  motorDoPapel,
  motorPorId,
  MOTORES_DE_VIDEO,
  nivelDoMotor,
  novidadesDoProvedor,
  textoDoCusto,
} from "../../supabase/functions/_shared/modelos-de-video";
import { azimuteDoPonto, normalizarAngulo, normalizarVariacoes, parametrosDoAngulo, pontoDoAzimute, promptDoAngulo, textoDoAngulo } from "../../supabase/functions/_shared/video-angulo";
import {
  chaveDaGeracao,
  corpoDaGeracao,
  endpointDaGeracao,
  enviarAoFal,
  estadoDoPedidoPelosEnvios,
  faltaParaGerar,
  lerSituacao,
  passouDoPrazo,
  podeConsultar,
  urlsDoResultado,
  consultarNoFal,
} from "../../supabase/functions/_shared/video-executor";
import {
  acaoDeGerarPlanos,
  aplicarRespostaDoDiretor,
  conferirContinuidade,
  custoDoRoteiro,
  entradaDoPlano,
  esquemaDoDiretor,
  estruturaDoTemplate,
  lerAvaliacao,
  MODELO_DO_DIRETOR,
  normalizarBiblia,
  normalizarProjetoDoDiretor,
  normalizarRoteiro,
  perguntasDeContinuidade,
  projetoAntesDepois,
  projetoDoKit,
  projetoDoTemplate,
  projetoParaEditor,
  projetoVazio,
  RACIOCINIO_DO_DIRETOR,
  sistemaDoDiretor,
} from "../../supabase/functions/_shared/diretor-de-video";
import { AGENTES_DA_MESA_DE_VIDEO, intencaoPorPalavras } from "../../supabase/functions/_shared/agente-de-video";
import { tempoDoQuadro } from "@/lib/mesa-videos/quadros";
import { MODOS_DO_GERAR, modoDoGerarValido } from "@/components/mesa-videos/modosDoGerar";
import { naEntradaDaEdicao } from "@/components/mesa-videos/videosApi";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({}) }, from: () => ({}), functions: { invoke: vi.fn() } } }));

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const CLIENTE = "11111111-1111-4111-8111-111111111111";

// ------------------------------------------------------------------ kits

describe("kits de vídeo", () => {
  it("todos válidos, sem travessão e com os nichos pedidos pelo dono", () => {
    KITS_DE_VIDEO.forEach((k) => expect(problemasDoKit(k), k.id).toEqual([]));
    const ids = KITS_DE_VIDEO.map((k) => k.id);
    for (const id of ["mobiliario", "antes_depois", "ugc", "produto", "imobiliario", "gastronomia", "estetica", "automotivo", "esporte", "filme"]) expect(ids).toContain(id);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(kitPorId("antes_depois")!.variantes!.map((v) => v.id)).toEqual(["reforma", "estetica", "jardim", "carro"]);
  });

  it("cada cena tem um motor no catálogo pelo papel, que faz o modo da cena", () => {
    KITS_DE_VIDEO.forEach((k) =>
      k.cenas.forEach((c) => {
        const m = motorDoPapel(c.papel, MOTORES_DE_VIDEO, c.modo);
        expect(m, `${k.id}/${c.ref}`).toBeTruthy();
        if (c.modo !== "imagem") expect(atende(m!, { modo: c.modo === "referencia" ? "primeiro_quadro" : c.modo }), `${k.id}/${c.ref} ${m!.id}`).toBe(true);
      }),
    );
  });

  it("lacuna sem valor não é inventada: vira pergunta; opcional vazia some", () => {
    const k = kitPorId("mobiliario")!;
    expect(lacunasDoTexto(k.cenas[0].prompt)).toEqual(["ambiente", "luz"]);
    const r = preencherPrompt(k.cenas[0].prompt, { ambiente: "cozinha em L" }, k.lacunas);
    expect(r.faltando).toEqual([]);
    expect(r.texto).toContain("cozinha em L");
    expect(r.texto).not.toContain("{luz}");
    const r2 = preencherPrompt(k.cenas[1].prompt, {}, k.lacunas);
    expect(r2.faltando).toEqual(["moveis", "ambiente", "acabamento"]);
  });

  it("do kit ao projeto sem IA: planos p1.., motor, custo e as perguntas do que falta", () => {
    const { projeto, faltando } = projetoDoKit(kitPorId("antes_depois")!, { assunto: "a fachada" }, "9:16");
    expect(projeto.roteiro.planos.map((p) => p.ref)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(faltando).toEqual(["antes", "depois"]);
    expect(projeto.biblia.perguntas.length).toBe(2);
    expect(projeto.roteiro.planos[1].modo).toBe("primeiro_ultimo");
    expect(motorPorId(projeto.roteiro.planos[1].motor)!.cap.ultimo_quadro).toBe(true);
    const c = custoDoRoteiro(projeto.roteiro);
    expect(c.usd).toBeGreaterThan(0);
    // Durações presas ao que cada motor aceita (2 s vira 4 s no Veo, por exemplo).
    expect(c.segundos).toBeGreaterThanOrEqual(15);
  });
});

// ------------------------------------------------------------------ catálogo, custo e níveis

describe("catálogo de motores", () => {
  it("custo antes de gerar: por segundo, com áudio, por imagem; sem preço não gera", () => {
    const veo = motorPorId("veo-3.1")!;
    expect(custoDoMotor(veo, { duracao_s: 8 }).usd).toBe(1.6);
    expect(custoDoMotor(veo, { duracao_s: 8, audio: true }).usd).toBe(3.2);
    expect(custoDoMotor(veo, { duracao_s: 5 }).usd).toBe(0.8); // 5 s vira 4 s (o Veo aceita 4, 6 ou 8; empate fica com o menor)
    expect(custoDoMotor(motorPorId("wan-3.0")!, { duracao_s: 5, resolucao: "1080p", variacoes: 3 }).usd).toBe(3);
    expect(custoDoMotor(motorPorId("qwen-angulos-2511")!, { variacoes: 4 }).usd).toBe(0.148);
    expect(custoDoMotor(motorPorId("higgsfield")!, { duracao_s: 5 }).usd).toBeNull();
    expect(textoDoCusto({ usd: 0.148, incerto: false })).toBe("US$ 0,15");
    expect(textoDoCusto({ usd: null, incerto: true })).toBe("Sem cotação");
  });

  it("todo motor executável tem fonte, data e preço; Sora encerrado e Runway a integrar", () => {
    MOTORES_DE_VIDEO.filter((m) => !m.situacao && m.provedor === "fal").forEach((m) => {
      expect(m.preco, m.id).toBeTruthy();
      expect(m.preco!.fonte, m.id).toMatch(/^https:\/\//);
      expect(m.preco!.conferido_em, m.id).toBe("2026-09-26");
      expect(Object.keys(m.endpoints).length, m.id).toBeGreaterThan(0);
    });
    const tem = (nome: string) => !!Deno_ok(nome);
    const Deno_ok = (nome: string) => nome === "FAL_KEY";
    expect(estadoDoMotor(motorPorId("sora-2")!, { temChave: tem })).toBe("encerrado");
    expect(estadoDoMotor(motorPorId("runway-gen4.5")!, { temChave: tem })).toBe("a_integrar");
    expect(estadoDoMotor(motorPorId("seedance-2.5")!, { temChave: () => false })).toBe("precisa_chave");
    expect(estadoDoMotor(motorPorId("seedance-2.5")!, { temChave: tem })).toBe("pronto");
    expect(estadoDoMotor(motorPorId("seedance-2.5")!, { temChave: tem, desligados: ["seedance-2.5"] })).toBe("desligado");
  });

  it("níveis: Top é a versão mais nova com preço de cada linha; Normal o mais barato; Rápido o rascunho", () => {
    expect(nivelDoMotor(motorPorId("seedance-2.5")!)).toBe("top");
    expect(nivelDoMotor(motorPorId("kling-3-pro")!)).toBe("top");
    expect(nivelDoMotor(motorPorId("kling-2.6-pro")!)).toBe("normal");
    expect(nivelDoMotor(motorPorId("minimax-h3-max-turbo")!)).toBe("rapido");
    expect(motorDoNivel("top", { modo: "primeiro_quadro" })!.id).toBe("seedance-2.5");
    expect(motorDoNivel("top", { modo: "primeiro_quadro", pessoa_real: true })!.linha).toBe("veo");
    expect(motorDoNivel("rapido", { modo: "primeiro_quadro" })!.id).toBe("veo-3.1-lite");
    expect(motorDoNivel("rapido", { modo: "texto", formato: "4:5" })!.id).toBe("minimax-h3-max-turbo");
    const normal = motorDoNivel("normal", { modo: "primeiro_ultimo" })!;
    expect(normal.cap.ultimo_quadro).toBe(true);
    expect(nivelDoMotor(normal)).not.toBe("rapido");
    expect(compararVersao("2.5", "2.0")).toBeGreaterThan(0);
    expect(compararVersao("2511", "2509")).toBeGreaterThan(0);
  });

  it("sincronização: versão nova entra como novo sem preço (não vira Top); com preço conferido vira o Top sozinha", () => {
    const lista = [
      { endpoint_id: "bytedance/seedance-3.0/image-to-video", status: "active" },
      { endpoint_id: "bytedance/seedance-3.0/text-to-video", status: "active" },
      { endpoint_id: "bytedance/seedance-2.5/image-to-video", status: "active" },
      { endpoint_id: "fal-ai/kling-video/v3/pro/image-to-video", status: "active" },
      { endpoint_id: "fal-ai/qwen-image-edit-2601-multiple-angles", status: "active" },
    ];
    const { novos } = novidadesDoProvedor(lista);
    expect(novos.map((n) => n.id).sort()).toEqual(["qwen-angulos-2601", "seedance-3.0"]);
    const s3 = novos.find((n) => n.id === "seedance-3.0")!;
    expect(s3.endpoints).toEqual({ imagem: "bytedance/seedance-3.0/image-to-video", ultimo: "bytedance/seedance-3.0/image-to-video", texto: "bytedance/seedance-3.0/text-to-video" });
    const semPreco = catalogoEmUso(novos);
    expect(nivelDoMotor(motorPorId("seedance-3.0", semPreco.motores)!, semPreco.motores)).toBe("normal");
    expect(motorDoNivel("top", { modo: "primeiro_quadro" }, semPreco.motores)!.id).toBe("seedance-2.5");
    const comPreco = catalogoEmUso([{ ...s3, preco: { por_segundo: { "720p": 0.5 }, fonte: "https://fal.ai/x", conferido_em: "2026-10-01" }, novo: false }]);
    expect(motorDoNivel("top", { modo: "primeiro_quadro" }, comPreco.motores)!.id).toBe("seedance-3.0");
    expect(nivelDoMotor(motorPorId("seedance-2.5", comPreco.motores)!, comPreco.motores)).toBe("normal");
    // Linha do banco com o id de um motor do código só desliga.
    expect(catalogoEmUso([{ id: "veo-3.1", linha: "veo", versao: "3.1", rotulo: "Veo", endpoints: {}, preco: null, novo: false, disponivel: true, ativo: false }]).desligados).toEqual(["veo-3.1"]);
    // Lista completa sem o endpoint: sumiu.
    expect(novidadesDoProvedor(lista, MOTORES_DE_VIDEO, true).sumiram).toContain("veo-3.1");
  });
});

// ------------------------------------------------------------------ ângulo (contrato com a V-B)

describe("troca de ângulo (angulo_gerar)", () => {
  it("normaliza o contrato e recusa fora da faixa", () => {
    expect(normalizarAngulo({ azimute: 90, elevacao: 0, distancia: "perto" })).toEqual({ azimute: 90, elevacao: 0, distancia: "perto" });
    expect(() => normalizarAngulo({ azimute: 200, elevacao: 0, distancia: "medio" })).toThrow(/-180 a 180/);
    expect(() => normalizarAngulo({ azimute: 0, elevacao: 70, distancia: "medio" })).toThrow(/-30 a 60/);
    expect(() => normalizarAngulo({ azimute: 0, elevacao: 0, distancia: "colado" })).toThrow(/perto/);
    expect(normalizarVariacoes(9)).toBe(4);
    expect(normalizarVariacoes(undefined)).toBe(1);
    expect(textoDoAngulo({ azimute: -90, elevacao: 30, distancia: "longe" })).toBe("perfil esquerdo, de cima, longe");
  });

  it("vira os parâmetros do Qwen 2511 (0 = frente, 90 = direita, 270 = esquerda) e o corpo do pedido", () => {
    expect(parametrosDoAngulo({ azimute: -90, elevacao: -20, distancia: "perto" })).toEqual({ horizontal_angle: 270, vertical_angle: -20, zoom: 8 });
    const m = motorPorId("qwen-angulos-2511")!;
    const corpo = corpoDaGeracao(m, { modo: "angulo", prompt: "", duracao_s: 0, formato: "9:16", audio: false, quadro_inicial_url: "https://x/img.png", angulo: { azimute: 45, elevacao: 0, distancia: "medio" }, manter: "personagem" });
    expect(corpo).toEqual(expect.objectContaining({ image_urls: ["https://x/img.png"], horizontal_angle: 45, vertical_angle: 0, zoom: 5, num_images: 1 }));
    expect(String(corpo.additional_prompt)).toMatch(/same person/);
    expect(endpointDaGeracao(m, { modo: "angulo" })).toBe("fal-ai/qwen-image-edit-2511-multiple-angles");
    expect(promptDoAngulo({ azimute: 180, elevacao: 0, distancia: "medio" }, "cenario")).toMatch(/back view/);
    // Controle de órbita: câmera embaixo = frente; à direita = 90.
    expect(azimuteDoPonto(0, 10)).toBe(0);
    expect(azimuteDoPonto(10, 0)).toBe(90);
    expect(azimuteDoPonto(0, -10)).toBe(180);
    expect(pontoDoAzimute(90)).toEqual({ x: 1, y: 0 });
  });
});

// ------------------------------------------------------------------ executor sem laço

describe("executor (fila do fal, sem laço)", () => {
  it("corpo no jeito de cada motor: Veo em '8s', Kling com start/end, Seedance com end_image_url, extensão", () => {
    const base = { prompt: "p", duracao_s: 8, formato: "9:16", audio: true, quadro_inicial_url: "https://a", quadro_final_url: "https://b" };
    expect(corpoDaGeracao(motorPorId("veo-3.1")!, { ...base, modo: "primeiro_ultimo" })).toEqual(expect.objectContaining({ duration: "8s", first_frame_url: "https://a", last_frame_url: "https://b", generate_audio: true }));
    expect(corpoDaGeracao(motorPorId("kling-3-pro")!, { ...base, modo: "primeiro_ultimo" })).toEqual(expect.objectContaining({ start_image_url: "https://a", end_image_url: "https://b", duration: "8" }));
    expect(corpoDaGeracao(motorPorId("seedance-2.5")!, { ...base, modo: "primeiro_quadro" })).toEqual(expect.objectContaining({ image_url: "https://a", duration: "8", resolution: "720p" }));
    expect(corpoDaGeracao(motorPorId("seedance-2.5")!, { ...base, modo: "primeiro_quadro" }).end_image_url).toBeUndefined();
    expect(corpoDaGeracao(motorPorId("seedance-2.5")!, { ...base, modo: "estender", video_url: "https://v" })).toEqual(expect.objectContaining({ task: "extension", video_urls: ["https://v"] }));
    expect(corpoDaGeracao(motorPorId("minimax-h3-max")!, { ...base, modo: "primeiro_quadro" }).resolution).toBe("768P");
    expect(endpointDaGeracao(motorPorId("veo-3.1")!, { modo: "estender" })).toBe("fal-ai/veo3.1/extend-video");
    expect(() => endpointDaGeracao(motorPorId("hailuo-2.3-pro")!, { modo: "primeiro_ultimo" })).toThrow(/não faz/);
    expect(faltaParaGerar(motorPorId("veo-3.1")!, { ...base, modo: "primeiro_ultimo", quadro_final_url: null })).toMatch(/último quadro/);
  });

  it("envio: uma chamada, sem nova tentativa em erro; o motivo vem do provedor", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: [{ loc: ["body", "duration"], msg: "invalid" }] }), { status: 422 }));
    await expect(enviarAoFal("fal-ai/veo3.1", { prompt: "x" }, { chave: "k", fetchImpl: f as unknown as typeof fetch })).rejects.toThrow(/body.duration: invalid/);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://queue.fal.run/fal-ai/veo3.1");
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Key k");
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ request_id: "r1", status_url: "https://queue.fal.run/fal-ai/veo3.1/requests/r1/status", response_url: "https://queue.fal.run/fal-ai/veo3.1/requests/r1" }), { status: 200 }));
    expect(await enviarAoFal("fal-ai/veo3.1", {}, { chave: "k", fetchImpl: ok as unknown as typeof fetch })).toEqual(expect.objectContaining({ request_id: "r1" }));
    await expect(enviarAoFal("x", {}, { chave: "" })).rejects.toThrow(/chave/);
    const st = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "IN_QUEUE", queue_position: 3 }), { status: 202 }));
    expect(await consultarNoFal("https://s", { chave: "k", fetchImpl: st as unknown as typeof fetch })).toEqual({ estado: "fila", posicao: 3, erro: null });
    expect(st).toHaveBeenCalledTimes(1);
  });

  it("consulta só quando pedida, com intervalo mínimo e prazo; estado do pedido pelas variações", () => {
    const agora = Date.parse("2026-09-26T12:00:00Z");
    expect(podeConsultar({ estado: "enviado", consultado_em: null }, agora)).toBe(true);
    expect(podeConsultar({ estado: "gerando", consultado_em: "2026-09-26T11:59:55Z" }, agora)).toBe(false);
    expect(podeConsultar({ estado: "gerando", consultado_em: "2026-09-26T11:59:40Z" }, agora)).toBe(true);
    expect(podeConsultar({ estado: "pronto", consultado_em: null }, agora)).toBe(false);
    expect(passouDoPrazo({ enviado_em: "2026-09-26T11:20:00Z" }, 30, agora)).toBe(true);
    expect(passouDoPrazo({ enviado_em: "2026-09-26T11:50:00Z" }, 30, agora)).toBe(false);
    expect(estadoDoPedidoPelosEnvios([{ estado: "pronto" }, { estado: "erro" }])).toBe("parcial");
    expect(estadoDoPedidoPelosEnvios([{ estado: "pronto" }, { estado: "gerando" }])).toBe("gerando");
    expect(estadoDoPedidoPelosEnvios([{ estado: "erro" }])).toBe("erro");
    expect(lerSituacao({ status: "COMPLETED", error: "NSFW" })).toEqual({ estado: "erro", posicao: null, erro: "NSFW" });
    expect(urlsDoResultado({ video: { url: "https://v.mp4" } })).toEqual({ tipo: "video", urls: ["https://v.mp4"] });
    expect(urlsDoResultado({ images: [{ url: "https://a.png" }, { url: "http://b" }] })).toEqual({ tipo: "imagem", urls: ["https://a.png"] });
    expect(chaveDaGeracao("angulo", "abc-1")).toBe("angulo:abc-1");
    // Nenhum setInterval/laço de consulta no código do gerador.
    for (const p of ["supabase/functions/_shared/video-executor.ts", "supabase/functions/mesa-videos/geracao.ts", "src/components/mesa-videos/GeracoesRecentes.tsx"]) {
      expect(ler(p), p).not.toMatch(/setInterval|refetchInterval|while \(true\)/);
    }
  });
});

// ------------------------------------------------------------------ diretor

const BIBLIA = {
  titulo: "Padaria",
  objetivo: "Contar a história da padaria",
  formato: "16:9",
  estilo: { paleta: ["âmbar"], lente: "35mm", luz: "manhã fria", clima: "geada", textura: "grão" },
  personagens: [{ id: "pe1", nome: "Seu João", aparencia: "man in his 60s, grey beard", roupa: "red flannel shirt", folha_path: `${CLIENTE}/video/quadros/folha.png` }],
  cenarios: [{ id: "ce1", nome: "Padaria", descricao: "old bakery", hora: "5h", ancora_path: `${CLIENTE}/video/quadros/ancora.png` }],
  fontes: [{ id: "f1", titulo: "Prefeitura", url: "https://ponta-grossa.pr.gov.br/historia" }],
  fatos: [
    { texto: "Geada comum em julho", fonte: "f1" },
    { texto: "A padaria abriu em 1950", fonte: "f9" },
    { texto: "Cliente atende desde cedo", fonte: "cliente" },
  ],
};

describe("agente diretor", () => {
  it("usa GPT-6 Luna com raciocínio máximo e esquema estruturado; o sistema proíbe inventar", () => {
    expect(MODELO_DO_DIRETOR).toBe("openrouter:openai/gpt-6-luna");
    expect(RACIOCINIO_DO_DIRETOR).toBe("max");
    const s = sistemaDoDiretor({ fase: "pesquisa", kit: kitPorId("filme"), contexto: "Cliente: Padaria" });
    expect(s).toMatch(/Nunca invente fato/);
    expect(s).toMatch(/seedance-2\.5/);
    expect(s).not.toMatch(/sora-2:/);
    expect(s).not.toMatch(/[—–]/);
    expect((esquemaDoDiretor().schema as { required: string[] }).required).toEqual(["resposta", "perguntas", "fontes", "fatos", "biblia", "roteiro", "acao"]);
  });

  it("bíblia sem alucinar: fato sem fonte vira pergunta; fonte só http(s)", () => {
    const { biblia, avisos } = normalizarBiblia({ ...BIBLIA, fontes: BIBLIA.fontes.concat([{ id: "f2", titulo: "ruim", url: "javascript:alert(1)" }]) });
    expect(biblia.fatos.map((f) => f.fonte)).toEqual(["f1", "cliente"]);
    expect(biblia.perguntas).toEqual(["Confirma? A padaria abriu em 1950"]);
    expect(biblia.fontes.map((f) => f.id)).toEqual(["f1"]);
    expect(avisos.length).toBe(1);
  });

  it("roteiro: refs p1.., personagem fora da bíblia sai, motor que não faz o modo é trocado, duração presa e custo pelo código", () => {
    const b = normalizarBiblia(BIBLIA).biblia;
    const { roteiro, avisos } = normalizarRoteiro(
      {
        planos: [
          { titulo: "Abertura", duracao_s: 7, personagens: ["pe1", "pe9"], cenario: "ce1", motor: "veo-3.1", modo: "primeiro_quadro", prompt: "man in his 60s, grey beard opens the door", quadro_inicial: { tipo: "ancora", ref: "ce1" } },
          { titulo: "Passagem", duracao_s: 5, personagens: [], cenario: "ce1", motor: "hailuo-2.3-pro", modo: "primeiro_ultimo", prompt: "x", quadro_inicial: { tipo: "anterior", ref: null }, quadro_final: { tipo: "ancora", ref: "ce1" } },
        ],
      },
      b,
    );
    expect(roteiro.planos.map((p) => p.ref)).toEqual(["p1", "p2"]);
    expect(roteiro.planos[0].personagens).toEqual(["pe1"]);
    expect(roteiro.planos[0].duracao_s).toBe(6);
    expect(roteiro.planos[0].custo_usd).toBe(1.2);
    expect(motorPorId(roteiro.planos[1].motor)!.cap.ultimo_quadro).toBe(true);
    expect(avisos.some((a) => /pe9/.test(a))).toBe(true);
    expect(avisos.some((a) => /p2/.test(a))).toBe(true);
  });

  it("aplica a resposta do modelo: fontes novas remapeadas, folha e âncora da equipe preservadas, ação só com apelidos válidos", () => {
    const atual = normalizarProjetoDoDiretor({ titulo: "Padaria", biblia: BIBLIA, roteiro: { planos: [] } })!;
    const r = aplicarRespostaDoDiretor(
      {
        resposta: "Pronto — montei.",
        perguntas: ["Qual o nome da padaria?"],
        fontes: [
          { id: "f1", titulo: "Clima", url: "https://clima.gov/geada" },
          { id: "f2", titulo: "Prefeitura", url: "https://ponta-grossa.pr.gov.br/historia" },
        ],
        fatos: [
          { texto: "Inverno com geada", fonte: "f1" },
          { texto: "Inventado", fonte: "f7" },
        ],
        biblia: { ...BIBLIA, personagens: [{ id: "pe1", nome: "Seu João", aparencia: "man in his 60s, grey beard", roupa: "red flannel shirt" }], cenarios: [{ id: "ce1", nome: "Padaria", descricao: "old bakery", hora: "5h" }], regras: ["Mesma luz"] },
        roteiro: { notas: "", planos: [{ titulo: "Abertura", duracao_s: 6, personagens: ["pe1"], cenario: "ce1", motor: "veo-3.1", modo: "primeiro_quadro", prompt: "man in his 60s, grey beard", quadro_inicial: { tipo: "folha", ref: "pe1" }, quadro_final: null, fala: null, texto_na_tela: null, angulo: "", enquadramento: "", movimento: "", acao: "", cena_do_kit: null }] },
        acao: { tipo: "gerar", planos: ["p1", "p9"] },
      },
      atual,
    );
    expect(r.resposta).toBe("Pronto, montei.");
    const clima = r.projeto.biblia.fontes.find((f) => f.url === "https://clima.gov/geada")!;
    expect(clima.id).toBe("f2");
    expect(r.projeto.biblia.fatos.find((f) => f.texto === "Inverno com geada")!.fonte).toBe("f2");
    expect(r.projeto.biblia.fatos.some((f) => f.texto === "Inventado")).toBe(false);
    expect(r.projeto.biblia.personagens[0].folha_path).toBe(`${CLIENTE}/video/quadros/folha.png`);
    expect(r.projeto.biblia.cenarios[0].ancora_path).toBe(`${CLIENTE}/video/quadros/ancora.png`);
    expect(r.acao).toEqual({ tipo: "gerar", planos: ["p1"] });
    expect(r.projeto.biblia.perguntas[0]).toBe("Qual o nome da padaria?");
  });

  it("gerar pelo contrato comum: apelidos p1.., trava com motivo, custo somado e sem desfazer", () => {
    const p = normalizarProjetoDoDiretor({
      titulo: "Padaria",
      biblia: BIBLIA,
      roteiro: {
        planos: [
          { titulo: "Abertura", duracao_s: 6, personagens: ["pe1"], cenario: "ce1", motor: "veo-3.1", modo: "primeiro_quadro", prompt: "man in his 60s, grey beard", quadro_inicial: { tipo: "folha", ref: "pe1" } },
          { titulo: "Depois", duracao_s: 6, personagens: ["pe1"], cenario: "ce1", motor: "veo-3.1", modo: "primeiro_quadro", prompt: "man in his 60s, grey beard", quadro_inicial: { tipo: "anterior", ref: null } },
          { titulo: "Sem prompt", duracao_s: 6, motor: "veo-3.1", modo: "texto", prompt: "" },
        ],
      },
    })!;
    const acao = acaoDeGerarPlanos(p, ["p1", "p2", "p3", "x9"], { variacoes: 2 })!;
    expect(acao.agente).toBe("diretor_de_video");
    expect(AGENTES_DA_MESA_DE_VIDEO).toContain(acao.agente);
    expect(acao.itens.map((i) => i.ref)).toEqual(["p1"]);
    expect(acao.recusados.map((r) => r.ref)).toEqual(["p2", "p3"]);
    expect(acao.ignorados).toEqual(["x9"]);
    expect(acao.sem_desfazer).toBe(true);
    expect(acao.custo_estimado_usd).toBe(2.4);
    const entradas = (acao.contexto as { entradas: Record<string, { quadro_inicial_path: string; referencias_paths: string[] }> }).entradas;
    expect(entradas.p1.quadro_inicial_path).toBe(`${CLIENTE}/video/quadros/folha.png`);
    expect(entradas.p1.referencias_paths).toEqual([`${CLIENTE}/video/quadros/folha.png`]);
    expect(entradaDoPlano(p, p.roteiro.planos[1]).motivo).toMatch(/anterior/);
  });

  it("continuidade (conta do código): folha, âncora, pessoa real sem autorização, motor sem último quadro", () => {
    const b = normalizarBiblia({ ...BIBLIA, personagens: [{ id: "pe1", nome: "Maria", aparencia: "woman", roupa: "", pessoa_real: true, autorizado: false }], cenarios: [{ id: "ce1", nome: "Loja", descricao: "", hora: "" }] }).biblia;
    const r = normalizarRoteiro({ planos: [{ titulo: "A", duracao_s: 5, personagens: ["pe1"], cenario: "ce1", motor: "veo-3.1", modo: "primeiro_quadro", prompt: "woman walks {lugar}", quadro_inicial: { tipo: "ancora", ref: "ce1" } }] }, b).roteiro;
    const a = conferirContinuidade(b, r).map((x) => x.texto).join(" | ");
    expect(a).toMatch(/sem quadro âncora/);
    expect(a).toMatch(/sem autorização/);
    expect(a).toMatch(/Lacuna sem valor: lugar/);
  });

  it("Jev: perguntas em Noul por personagem e cenário e Choice da melhor variação; a pior nota manda", () => {
    const p = normalizarProjetoDoDiretor({ titulo: "P", biblia: BIBLIA, roteiro: { planos: [{ titulo: "A", duracao_s: 6, personagens: ["pe1"], cenario: "ce1", motor: "veo-3.1", modo: "primeiro_quadro", prompt: "x", quadro_inicial: { tipo: "folha" } }] } })!;
    const q = perguntasDeContinuidade(p.biblia, p.roteiro.planos[0], [{ id: "a1", texto: "old man grey beard red shirt in bakery" }, { id: "a2", texto: "young woman" }]);
    expect(Object.keys(q.questions).sort()).toEqual(["melhor", "v0_ce", "v0_pe_pe1", "v1_ce", "v1_pe_pe1"]);
    expect((q.questions.melhor as { type: string }).type).toBe("choice");
    expect((q.questions.v0_pe_pe1 as { type: string }).type).toBe("noul");
    const av = lerAvaliacao({ v0_pe_pe1: { noul: 0.92 }, v0_ce: { noul: 0.8 }, v1_pe_pe1: { noul: 0.1 }, v1_ce: { noul: 0.9 }, melhor: { choice: "v0", confidence: 0.88 } }, [{ id: "a1" }, { id: "a2" }]);
    expect(av.melhor).toBe("a1");
    expect(av.variacoes.map((v) => [v.id, v.nota, v.ok])).toEqual([["a1", 0.8, true], ["a2", 0.1, false]]);
  });

  it("para o editor no formato do projeto de edição (sem mudar o formato): ordem do roteiro, texto na tela e o que falta", () => {
    const p = normalizarProjetoDoDiretor({ titulo: "P", biblia: BIBLIA, roteiro: { planos: [{ titulo: "A", duracao_s: 6, motor: "veo-3.1", modo: "texto", prompt: "x", texto_na_tela: "Visite" }, { titulo: "B", duracao_s: 4, motor: "veo-3.1", modo: "texto", prompt: "y" }] } })!;
    const take = { id: "a1", nome: "a1.mp4", tipo: "gerado", storage_bucket: "mesa", storage_path: "c/a1.mp4", cena_ref: null, melhor: false, duracao_s: 6, largura: 1080, altura: 1920 };
    const r = projetoParaEditor({ titulo: "Filme", formato: "9:16", escolhidos: [{ plano: p.roteiro.planos[0], arquivo: take }, { plano: p.roteiro.planos[1], arquivo: null }] });
    expect(r.faltando).toEqual(["p2"]);
    const video = r.projeto.trilhas.find((t) => t.tipo === "video")!;
    expect(video.clipes.map((c) => [c.cena_ref, c.inicio_s, c.saida_s])).toEqual([["p1", 0, 6]]);
    expect(r.projeto.trilhas.find((t) => t.tipo === "texto")!.clipes[0]).toEqual(expect.objectContaining({ texto: "Visite", inicio_s: 0, saida_s: 6 }));
    const ad = projetoAntesDepois({ titulo: "AD", formato: "9:16", antes: { ...take, id: "x", duracao_s: 5 }, depois: { ...take, id: "y", duracao_s: 4 }, layout: "cortina" });
    const vs = ad.trilhas.filter((t) => t.tipo === "video");
    expect(vs.length).toBe(2);
    expect(vs[0].clipes[0].estilo).toEqual({ layout: "cortina", par: "antes", lado: "esquerda" });
    expect(vs[1].clipes[0].saida_s).toBe(4);
    expect(ad.duracao_s).toBe(4);
  });

  it("template da agência sai sem arquivos, fatos nem autorização do cliente; volta como projeto", () => {
    const p = normalizarProjetoDoDiretor({ titulo: "Padaria", biblia: { ...BIBLIA, personagens: [{ ...BIBLIA.personagens[0], pessoa_real: true, autorizado: true }] }, roteiro: { planos: [{ titulo: "A", duracao_s: 6, motor: "veo-3.1", modo: "primeiro_quadro", prompt: "x", quadro_inicial: { tipo: "arquivo", ref: `${CLIENTE}/video/quadros/q.png` } }] } })!;
    const e = estruturaDoTemplate(p, true);
    expect(e.biblia.personagens[0].folha_path).toBeNull();
    expect(e.biblia.personagens[0].autorizado).toBe(false);
    expect(e.biblia.fatos).toEqual([]);
    expect(e.roteiro.planos[0].quadro_inicial).toEqual({ tipo: "arquivo", ref: null });
    const doCliente = estruturaDoTemplate(p, false);
    expect(doCliente.roteiro.planos[0].quadro_inicial!.ref).toContain("q.png");
    const volta = projetoDoTemplate({ id: "22222222-2222-4222-8222-222222222222", nome: "T", client_id: null, kit_id: "filme", estrutura: e });
    expect(volta.template_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(volta.roteiro.planos.length).toBe(1);
    expect(projetoVazio().fase).toBe("briefing");
  });
});

// ------------------------------------------------------------------ tela e agente

describe("tela do gerador", () => {
  it("modos do Gerar (mais de 4 vira seletor) e o agente entende diretor e ângulo", () => {
    expect(MODOS_DO_GERAR.map((m) => m.valor)).toEqual(["cena", "livre", "angulo", "continuar", "antes_depois"]);
    expect(modoDoGerarValido("x")).toBe("cena");
    expect(intencaoPorPalavras("videos", "quero ele de lado, outro ângulo")).toBe("angulo");
    expect(intencaoPorPalavras("videos", "abre o diretor para montar o filme")).toBe("diretor");
    expect(intencaoPorPalavras("videos", "gera a próxima cena")).toBe("gerar");
  });

  it("último quadro no mesmo ponto sempre (duração menos meio quadro); ângulo e quadro não entram na Edição sozinhos", () => {
    expect(tempoDoQuadro("primeiro", 8)).toBe(0);
    expect(tempoDoQuadro("ultimo", 8)).toBe(7.983);
    expect(tempoDoQuadro("ultimo", NaN)).toBe(0);
    const base = { id: "a", client_id: CLIENTE, nome: "a", nome_original: "a", storage_bucket: "mesa", storage_path: "p", mime: null, bytes: null, duracao_s: null, largura: null, altura: null, sha256: null, gravado_em: null, roteiro_id: null, cena_ref: null, grupo: null, melhor: false, nota: null, estado: "ativo", criado_em: "" };
    expect(naEntradaDaEdicao({ ...base, tipo: "angulo" })).toBe(false);
    expect(naEntradaDaEdicao({ ...base, tipo: "quadro" })).toBe(false);
    expect(naEntradaDaEdicao({ ...base, tipo: "bruto" })).toBe(true);
  });

  it("piso Safari 11 / Chrome 64 e sem travessão nos arquivos da frente V-A; chave nunca no front", () => {
    const arquivos = [
      "src/components/mesa-videos/PecasDoGerador.tsx",
      "src/components/mesa-videos/GeradorLivre.tsx",
      "src/components/mesa-videos/FerramentaDeAngulo.tsx",
      "src/components/mesa-videos/ContinuarVideo.tsx",
      "src/components/mesa-videos/AntesEDepois.tsx",
      "src/components/mesa-videos/GeracoesRecentes.tsx",
      "src/components/mesa-videos/AngulosGerados.tsx",
      "src/components/mesa-videos/EtapaKit.tsx",
      "src/components/mesa-videos/EtapaBiblia.tsx",
      "src/components/mesa-videos/EtapaRoteiro.tsx",
      "src/components/mesa-videos/DiretorDoVideo.tsx",
      "src/components/mesa-videos/modosDoGerar.ts",
      "src/lib/mesa-videos/api.ts",
      "src/lib/mesa-videos/quadros.ts",
      "supabase/functions/_shared/video-kits.ts",
      "supabase/functions/_shared/video-angulo.ts",
      "supabase/functions/_shared/video-executor.ts",
      "supabase/functions/_shared/diretor-de-video.ts",
      "supabase/functions/mesa-videos/geracao.ts",
      "supabase/functions/mesa-videos/diretor.ts",
    ];
    for (const p of arquivos) {
      const f = ler(p);
      expect(f, p).not.toMatch(/\(\?<[=!]/);
      expect(f, p).not.toMatch(/\(\?<[a-z]/i);
      expect(f, p).not.toMatch(/\\p\{/);
      expect(f, p).not.toMatch(/\.at\(/);
      expect(f, p).not.toMatch(/Object\.hasOwn\(/);
      expect(f, p).not.toMatch(/[—–]/);
      if (p.indexOf("src/") === 0) {
        expect(f, p).not.toMatch(/crypto\.randomUUID|PointerEvent|onPointer|aspect-ratio|FAL_KEY|TYPESAFE_API_KEY/);
        expect(f, p).not.toMatch(/\[(min|max|clamp)\(/);
      }
    }
  });
});
