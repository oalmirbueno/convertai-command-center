// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assinarTrechos,
  assinaturaDaFala,
  assinaturaDoAudio,
  casarComANarracao,
  duracaoDoMp3,
  ESQUEMA_DAS_FALAS,
  estimarEfeito,
  estimarMusica,
  estimarNarracao,
  faltasDaNarracao,
  lerFalasDoModelo,
  lerNarracao,
  MODELOS_DE_VOZ,
  modeloDeVoz,
  NARRACAO_PADRAO,
  narracaoDaCena,
  narracaoDaTela,
  palavrasDoAlinhamento,
  promptDaTrilha,
  semAudiosDasCenas,
  textoParaOModelo,
  trechosDoRoteiro,
  trilhaDaNarracao,
  voiceSettings,
  type Alinhamento,
  type NarracaoDoFilme,
} from "../../supabase/functions/mesa-motion/modulos/narracao";
import { adicionarVozCompartilhada, bytesDoBase64, clonarVoz, erroDaResposta, ErroDaVoz, falar, listarVozes, listarVozesCompartilhadas } from "../../supabase/functions/mesa-motion/modulos/elevenlabs";
import { ACABAMENTOS, camadaDoAcabamento, fraseDoWorkerAntigo, novidadeDaCena, PECAS_EXTRAS, workerConheceMov } from "../../supabase/functions/mesa-motion/modulos/pecas-extras";
import { coresDaMarca, ESTADO_VAZIO_DA_CENA, LISTA_DE_FORMATOS, type MarcaDaCena, montarDocumento, PECAS_DO_KIT } from "../../supabase/functions/_shared/cena-hf";
import { assinaturaDaCena, cenaDaLinha, INGREDIENTES, lerSom, projetoDoFilme, SOM_PADRAO, transicaoDaEntrevista } from "../../supabase/functions/_shared/motion-metodo";
import { normalizarProjeto } from "../../supabase/functions/_shared/projeto-de-edicao";
import { ESQUEMA_DAS_ACOES_DO_MOTION, normalizarAcoesDoMotion, OPERACOES_DO_MOTION, regrasDoMotion } from "../../supabase/functions/mesa-motion/acoes-do-motion";

/**
 * Frente MOV (30/09/2026): a narração pela ElevenLabs na Mesa Motion (Eleven
 * v4 padrão, tags de emoção, voz da marca, roteiro inteiro numa leitura,
 * sincronia das cenas com a fala), a trilha e os efeitos gerados, as 5
 * peças novas do kit, o acabamento da direção de arte e as transições.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const MARCA: MarcaDaCena = { nome: "AcelerIQ", cores: coresDaMarca([{ hex: "#00D52B", papel: "primária" }, { hex: "#111111" }, { hex: "#F7F7F7" }]), fonte_titulo: "Montserrat-Variable.ttf", fonte_texto: "Figtree-Variable.ttf", tem_logo: true };

/** Alinhamento como a ElevenLabs devolve: um tempo por caractere (0,05 s cada, espaços incluídos). */
function alinhar(texto: string, passo = 0.05, inicio = 0.1): Alinhamento {
  const characters = texto.split("");
  return { characters, character_start_times_seconds: characters.map((_, i) => inicio + i * passo), character_end_times_seconds: characters.map((_, i) => inicio + (i + 1) * passo) };
}

const narracaoCom = (p: Partial<NarracaoDoFilme>): NarracaoDoFilme => ({ ...NARRACAO_PADRAO(), ligada: true, voz: { voice_id: "abcdEFGH1234", nome: "Voz", origem: "biblioteca" }, ...p });

describe("modelos de voz e custo antes", () => {
  it("o Eleven v4 é o padrão e o primeiro; todo modelo tem preço e limite", () => {
    expect(MODELOS_DE_VOZ[0].id).toBe("eleven_v4");
    expect(MODELOS_DE_VOZ.filter((m) => m.padrao).map((m) => m.id)).toEqual(["eleven_v4"]);
    expect(MODELOS_DE_VOZ.map((m) => m.id)).toEqual(["eleven_v4", "eleven_v4_turbo", "eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"]);
    MODELOS_DE_VOZ.forEach((m) => {
      expect(m.preco_1k_usd).toBeGreaterThan(0);
      expect(m.limite).toBeGreaterThanOrEqual(5_000);
    });
    expect(modeloDeVoz("nao-existe").id).toBe("eleven_v4");
  });

  it("tag de emoção só vai para o modelo que entende; custo pelos caracteres enviados", () => {
    const fala = "[warmly] Olá — aqui a sua marca ganha voz.";
    expect(textoParaOModelo(fala, modeloDeVoz("eleven_v4"))).toBe("[warmly] Olá , aqui a sua marca ganha voz.");
    expect(textoParaOModelo(fala, modeloDeVoz("eleven_multilingual_v2"))).toBe("Olá , aqui a sua marca ganha voz.");
    const e = estimarNarracao(["a".repeat(1000), "b".repeat(500)], "eleven_v4");
    expect(e).toEqual({ caracteres: 1500, custo_usd: 0.12 });
    expect(estimarNarracao(["a".repeat(1000)], "eleven_v4_turbo").custo_usd).toBe(0.04);
    expect(estimarMusica(60)).toBe(0.15);
    expect(estimarMusica(2)).toBe(0.025);
    expect(estimarEfeito(2)).toBe(0.02);
  });

  it("estabilidade só nos 3 valores que o v3 e o v4 aceitam", () => {
    expect(voiceSettings({ estilo: "natural", velocidade: 1 }).stability).toBe(0.5);
    expect(voiceSettings({ estilo: "criativa", velocidade: 1.1 })).toMatchObject({ stability: 0, speed: 1.1 });
    expect(voiceSettings({ estilo: "firme", velocidade: 1 }).stability).toBe(1);
    expect(lerNarracao({ ajustes: { estilo: "outro", velocidade: 9 } }).ajustes).toEqual({ estilo: "natural", velocidade: 1.2 });
  });
});

describe("alinhamento, trechos e sincronia", () => {
  it("palavras pelo tempo por caractere, sem as tags", () => {
    const p = palavrasDoAlinhamento(alinhar("[warmly] Oi, marca [short pause] boa."));
    expect(p.map((w) => w.t)).toEqual(["Oi,", "marca", "boa."]);
    expect(p[0].i).toBeCloseTo(0.1 + 9 * 0.05, 3);
    expect(p[2].f).toBeGreaterThan(p[1].f);
  });

  it("roteiro inteiro: cada cena fica com o trecho das suas palavras; contagem diferente vai pela proporção", () => {
    const falas = [
      { cena_id: "c1", texto: "[excited] Seu marketing sem plano?" },
      { cena_id: "c2", texto: "A gente organiza tudo." },
    ];
    const texto = falas.map((f) => f.texto).join("\n\n");
    const palavras = palavrasDoAlinhamento(alinhar(texto));
    const t = trechosDoRoteiro(falas, palavras, 4);
    expect(t.map((x) => x.cena_id)).toEqual(["c1", "c2"]);
    expect(t[0].ate_s).toBeLessThanOrEqual(t[1].de_s);
    expect(t[1].de_s).toBeCloseTo(palavras[4].i - 0.05, 3);
    const prop = trechosDoRoteiro(falas, palavras.slice(0, 3), 4);
    expect(prop[0].de_s).toBe(0);
    expect(prop[1].ate_s).toBe(4);
  });

  it("encaixa cada cena no tempo da fala (respiro antes e depois), cai na batida perto e avisa a fala longa", () => {
    const cenas = [
      { id: "c1", duracao_s: 4 },
      { id: "c2", duracao_s: 6 },
      { id: "c3", duracao_s: 3 },
    ];
    const falas = { c1: "Fala um", c2: "Fala dois", c3: "" };
    const n = narracaoCom({ falas });
    n.audios = [
      { id: "a1", path: `${CLIENTE}/x.mp3`, arquivo_id: null, duracao_s: 20, modelo: "eleven_v4", voice_id: "abcdEFGH1234", trechos: [{ cena_id: "c1", de_s: 0, ate_s: 2.2 }, { cena_id: "c2", de_s: 2.3, ate_s: 15 }], palavras: [], assinatura: "", custo_usd: 0, em: "2026-09-30T10:00:00Z" },
    ];
    n.audios[0].assinatura = ["c1", "c2"].map((id) => assinaturaDaFala(falas[id as "c1" | "c2"], n)).join(".");
    const r = casarComANarracao(cenas, n);
    expect(r.cenas.map((c) => c.duracao_s)).toEqual([3.05, 12, 3]);
    expect(r.casadas).toBe(2);
    expect(r.avisos[0]).toMatch(/Cena 2/);
    const comBatida = casarComANarracao(cenas, n, { bpm: 120, batidas: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], compassos: [0, 2, 4], drop_s: null, duracao_s: 4, energia: [], confianca: 1 });
    expect(comBatida.cenas[0].duracao_s).toBe(3.5);
  });

  it("a fala mudou depois do áudio: desatualizada; a tela não troca os áudios", () => {
    const n = narracaoCom({ falas: { c1: "Oi" } });
    n.audios = [{ id: "a1", path: `${CLIENTE}/x.mp3`, arquivo_id: null, duracao_s: 1, modelo: "eleven_v4", voice_id: "abcdEFGH1234", trechos: [{ cena_id: "c1", de_s: 0, ate_s: 1 }], palavras: [], assinatura: assinaturaDaFala("Oi", n), custo_usd: 0, em: "x" }];
    expect(narracaoDaCena(n, "c1")!.desatualizada).toBe(false);
    expect(narracaoDaCena({ ...n, falas: { c1: "Olá" } }, "c1")!.desatualizada).toBe(true);
    expect(narracaoDaCena({ ...n, ajustes: { estilo: "natural", velocidade: 1.1 } }, "c1")!.desatualizada).toBe(true);
    const daTela = narracaoDaTela(n, { ...n, audios: [], falas: { c1: "Nova" } });
    expect(daTela.audios).toHaveLength(1);
    expect(daTela.falas.c1).toBe("Nova");
    expect(lerSom({ narracao: { ligada: true, falas: { c1: "Oi" } } }).narracao.falas.c1).toBe("Oi");
  });

  it("8 cenas numa leitura só: mudar a última fala marca só ela, montar recusa e gerar de novo tira só o trecho dela", () => {
    const falas: Record<string, string> = {};
    const ids: string[] = [];
    for (let i = 1; i <= 8; i++) {
      ids.push(`c${i}`);
      falas[`c${i}`] = `Fala numero ${i} do filme.`;
    }
    const n = narracaoCom({ falas });
    const trechos = assinarTrechos(ids.map((id, i) => ({ cena_id: id, de_s: i, ate_s: i + 0.9 })), n);
    n.audios = [{ id: "rot", path: `${CLIENTE}/r.mp3`, arquivo_id: null, duracao_s: 8, modelo: "eleven_v4", voice_id: "abcdEFGH1234", trechos, palavras: [], assinatura: assinaturaDoAudio(ids, n), custo_usd: 0, em: "1" }];
    const cenas = ids.map((id) => ({ id }));
    expect(faltasDaNarracao(n, cenas)).toEqual([]);
    const mudada = { ...n, falas: { ...falas, c8: "Fala nova da cena oito." } };
    expect(narracaoDaCena(mudada, "c8")!.desatualizada).toBe(true);
    ids.slice(0, 7).forEach((id) => expect(narracaoDaCena(mudada, id)!.desatualizada).toBe(false));
    // O montar recusa (409 cenas_faltando) com a cena 8, e só ela.
    expect(faltasDaNarracao(mudada, cenas)).toEqual(["cena 8: a fala mudou depois da narração"]);
    // A assinatura do áudio inteiro também enxerga a cena 8 (sem corte em 5 cenas).
    expect(assinaturaDoAudio(ids, mudada)).not.toBe(assinaturaDoAudio(ids, n));
    // Gerar a cena 8 de novo: o roteiro fica com os 7 trechos e a leitura contínua continua valendo.
    const restantes = semAudiosDasCenas(mudada, ["c8"]);
    expect(restantes).toHaveLength(1);
    expect(restantes[0].trechos.map((t) => t.cena_id)).toEqual(ids.slice(0, 7));
    expect(semAudiosDasCenas(mudada, ids)).toHaveLength(0);
    // Áudio antigo sem assinatura no trecho: confere pelo áudio inteiro.
    const antigo = { ...n, audios: [{ ...n.audios[0], trechos: n.audios[0].trechos.map((t) => ({ cena_id: t.cena_id, de_s: t.de_s, ate_s: t.ate_s })) }] };
    expect(narracaoDaCena(antigo, "c1")!.desatualizada).toBe(false);
    expect(narracaoDaCena({ ...antigo, falas: mudada.falas }, "c1")!.desatualizada).toBe(true);
    // A assinatura do trecho sobrevive à leitura do banco.
    expect(lerNarracao(JSON.parse(JSON.stringify(n))).audios[0].trechos[7].assinatura).toBe(trechos[7].assinatura);
  });

  it("falas do modelo: só cenas que existem, sem travessão", () => {
    const f = lerFalasDoModelo({ falas: [{ cena_id: "c1", texto: "Oi — tudo bem?" }, { cena_id: "zz", texto: "fora" }] }, [{ id: "c1", duracao_s: 4 }]);
    expect(f).toEqual({ c1: "Oi , tudo bem?" });
    expect(ESQUEMA_DAS_FALAS.schema.additionalProperties).toBe(false);
  });

  it("mp3 de 128 kbps: 16 mil bytes por segundo", () => {
    expect(duracaoDoMp3(32_000)).toBe(2);
  });
});

describe("projeto da Mesa Edição com a narração", () => {
  const cenas = [cenaDaLinha({ ordem: 1, id: "c1", peca: "logo_sting", duracao_s: 4 }).cena, cenaDaLinha({ ordem: 2, id: "c2", peca: "cartao_final", params: { chamada: "Oi" }, duracao_s: 5, transicao: "zoom" }).cena];
  const materiais = cenas.map((c) => ({ cena: c, caminho: `${CLIENTE}/video/motion/f/cenas/${c.id}/final.webm`, duracao_s: c.duracao_s, picos: [] }));

  it("trilha Narração com a fala por palavra, música abaixa na voz e as transições entram", () => {
    const n = narracaoCom({ falas: { c1: "Oi marca", c2: "Fale com a gente" } });
    n.audios = [{ id: "A1", path: `${CLIENTE}/video/motion/f/narracao/a1.mp3`, arquivo_id: "11111111-1111-4111-8111-111111111111", duracao_s: 5, modelo: "eleven_v4", voice_id: "abcdEFGH1234", trechos: [{ cena_id: "c1", de_s: 0.1, ate_s: 1.6 }, { cena_id: "c2", de_s: 1.8, ate_s: 4.2 }], palavras: [{ t: "Oi", i: 0.1, f: 0.4 }, { t: "marca", i: 0.5, f: 1.5 }], assinatura: "", custo_usd: 0, em: "x" }];
    const p = projetoDoFilme({ titulo: "F", formato: "9:16", materiais, som: { ...SOM_PADRAO(), narracao: n, trilha: { arquivo_id: null, path: `${CLIENTE}/t.mp3`, nome: "T", duracao_s: 30 } }, transicao: "fade" });
    const proj = normalizarProjeto(p)!;
    expect(proj).not.toBeNull();
    const voz = proj.trilhas.find((t) => t.id === "audio-voz")!;
    // A fala entra 0,35 s depois do começo da cena (no quadro de 30 fps).
    expect(voz.clipes[0].inicio_s).toBeCloseTo(0.35, 1);
    expect(voz.clipes[1].inicio_s).toBeCloseTo(4.35, 1);
    expect(voz.clipes[1].entrada_s).toBe(1.8);
    expect((voz.clipes[0].estilo as Record<string, unknown>).papel).toBe("voz");
    expect(proj.transcricoes["voz-a1"].por_palavra).toBe(true);
    expect((proj.trilhas.find((t) => t.id === "audio-1")!.clipes[0].estilo as Record<string, unknown>).papel).toBe("trilha");
    expect(proj.mixagem).toMatchObject({ duck: true, trilha_abaixo_da_voz_db: 18 });
    const video = proj.trilhas.find((t) => t.tipo === "video")!;
    expect(video.clipes[0].transicao_entrada).toBeNull();
    expect(video.clipes[1].transicao_entrada).toMatchObject({ tipo: "zoom" });
  });

  it("sem narração: música sem duck como antes, transição da entrevista", () => {
    const p = normalizarProjeto(projetoDoFilme({ titulo: "F", formato: "9:16", materiais: [materiais[0], { ...materiais[1], cena: { ...materiais[1].cena, transicao: undefined } }], som: { ...SOM_PADRAO(), trilha: { arquivo_id: null, path: `${CLIENTE}/t.mp3`, nome: "T", duracao_s: 30 } }, transicao: "empurrao" }))!;
    expect(p.trilhas.some((t) => t.id === "audio-voz")).toBe(false);
    expect(p.mixagem.duck).toBe(false);
    expect(p.trilhas.find((t) => t.tipo === "video")!.clipes[1].transicao_entrada).toMatchObject({ tipo: "deslizar" });
    expect(transicaoDaEntrevista("corte_na_batida")).toBe("corte");
  });

  it("o worker trata a trilha com papel voz como a voz; a prévia abaixa a música na narração", () => {
    expect(ler("workers/render/trabalho.ts")).toContain('c.estilo.papel === "voz"');
    expect(ler("src/components/mesa-edicao/editor/Composicao.tsx")).toContain('estiloTxt(c, "papel", "") === "voz"');
  });
});

describe("kit novo e acabamento", () => {
  const cena = (p: Record<string, unknown>) => ({ ...ESTADO_VAZIO_DA_CENA("c1", 1), ...p });

  it("5 peças novas no kit, todas 2D, montando em todos os formatos só com arquivos locais", () => {
    expect(PECAS_EXTRAS.map((p) => p.id)).toEqual(["frase_impacto", "foto_destaque", "mockup_tela", "pergunta", "beneficios"]);
    expect(PECAS_DO_KIT).toHaveLength(15);
    const foto = montarDocumento(cena({ peca: "foto_destaque", params: { imagens: [`${CLIENTE}/video/motion/f/insumos/a.jpg`], titulo: "Loja" } }), MARCA, { formato: "16:9" });
    expect(foto.imagens).toEqual([{ destino: "midia/prova-1.jpg", caminho: `${CLIENTE}/video/motion/f/insumos/a.jpg` }]);
    expect(foto.html).toContain('src="midia/prova-1.jpg"');
    expect(() => montarDocumento(cena({ peca: "foto_destaque", params: {} }), MARCA, { formato: "9:16" })).toThrow(/Foto/);
    const frase = montarDocumento(cena({ peca: "frase_impacto", params: { frase: "Marketing com método", destaque: "metodo" } }), MARCA, { formato: "9:16" });
    expect(frase.html).toContain("fi-pal fi-forte");
    LISTA_DE_FORMATOS.forEach((f) => {
      const d = montarDocumento(cena({ peca: "pergunta", params: { pergunta: "Quanto custa?", resposta: "Menos" } }), MARCA, { formato: f });
      expect(d.html).not.toMatch(/https?:\/\/|Math\.random|Date\.now|repeat:\s*-1/);
    });
  });

  it("acabamento é camada nossa: entra no documento, muda a assinatura só quando existe", () => {
    expect(ACABAMENTOS.map((a) => a.valor)).toEqual(["limpo", "grao", "grade", "luz", "cinema"]);
    const base = cena({ peca: "abertura", params: { titulo: "Oi" } });
    const assinaturaAntes = assinaturaDaCena(base);
    expect(assinaturaDaCena({ ...base, acabamento: "limpo" })).toBe(assinaturaAntes);
    expect(assinaturaDaCena({ ...base, acabamento: "cinema" })).not.toBe(assinaturaAntes);
    const d = montarDocumento({ ...base, acabamento: "grao" }, MARCA, { formato: "9:16" });
    expect(d.html).toContain("feTurbulence");
    expect(d.html).not.toMatch(/https?:\/\//);
    expect(montarDocumento({ ...base, acabamento: "cinema", fundo: "transparente" }, MARCA, { formato: "9:16" }).html).not.toContain("ac-faixa");
    expect(camadaDoAcabamento("limpo", MARCA.cores, { largura: 1, altura: 1, u: 1, deitado: false }).css).toBe("");
    expect(cenaDaLinha({ ordem: 1, peca: "abertura", acabamento: "luz" }).cena.acabamento).toBe("luz");
    expect(cenaDaLinha({ ordem: 1, peca: "abertura", acabamento: "nada" }).cena.acabamento).toBeUndefined();
  });

  it("entrevista ganha acabamento, locução e o zoom de entrada", () => {
    expect(INGREDIENTES.find((i) => i.chave === "acabamento")!.opcoes.map((o) => o.valor)).toEqual(["limpo", "grao", "grade", "luz", "cinema"]);
    expect(INGREDIENTES.find((i) => i.chave === "locucao")!.opcoes.map((o) => o.valor)).toEqual(["com_voz", "sem_voz"]);
    expect(INGREDIENTES.find((i) => i.chave === "transicao")!.opcoes.map((o) => o.valor)).toContain("zoom");
  });
});

describe("ponte da ElevenLabs (fetch falso)", () => {
  const b64 = (t: string) => btoa(t);

  it("falar: endpoint com tempo por caractere, chave só no cabeçalho, português forçado", async () => {
    const pedidos: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      return new Response(JSON.stringify({ audio_base64: b64("ID3audio"), alignment: alinhar("Oi") }), { status: 200, headers: { "request-id": "r1" } });
    }) as unknown as typeof fetch;
    const r = await falar({ chave: "sk_teste", fetchImpl }, { voiceId: "abcdEFGH1234", texto: "[warmly] Oi", modelo: "eleven_v4", idioma: "pt", voiceSettings: voiceSettings({ estilo: "natural", velocidade: 1 }), anterior: "Antes", proximo: null });
    expect(pedidos[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/abcdEFGH1234/with-timestamps?output_format=mp3_44100_128");
    expect((pedidos[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("sk_teste");
    const corpo = JSON.parse(String(pedidos[0].init.body));
    expect(corpo).toMatchObject({ text: "[warmly] Oi", model_id: "eleven_v4", language_code: "pt", previous_text: "Antes" });
    expect(corpo.next_text).toBeUndefined();
    expect(new TextDecoder().decode(r.bytes)).toBe("ID3audio");
    expect(r.requestId).toBe("r1");
    expect(bytesDoBase64(b64("ab")).length).toBe(2);
  });

  it("erros da ElevenLabs viram frase certa (pagamento pendente, chave, crédito, voz) e sem chave nem chama", async () => {
    expect(erroDaResposta(401, { detail: { type: "payment_required", code: "payment_issue", status: "payment_issue", message: "Your subscription has a failed or incomplete payment." } }).codigo).toBe("voz_pagamento_pendente");
    expect(erroDaResposta(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } }).codigo).toBe("voz_chave_invalida");
    expect(erroDaResposta(401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota" } }).codigo).toBe("voz_sem_credito");
    expect(erroDaResposta(404, { detail: { status: "voice_not_found" } }).codigo).toBe("voz_nao_encontrada");
    expect(erroDaResposta(400, { detail: { status: "voice_limit_reached" } }).message).toMatch(/limite de vozes/);
    expect(erroDaResposta(422, { detail: "texto vazio sk_abc123" }).message).not.toContain("sk_abc123");
    let chamou = false;
    const fetchImpl = (async () => {
      chamou = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    await expect(listarVozes({ chave: "", fetchImpl }, {})).rejects.toBeInstanceOf(ErroDaVoz);
    expect(chamou).toBe(false);
  });

  it("biblioteca: marca as vozes que falam português e a prévia em português", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toContain("/v2/voices?page_size=30&search=narrador");
      return new Response(JSON.stringify({ has_more: true, next_page_token: "t2", voices: [{ voice_id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", category: "premade", preview_url: "https://x/en.mp3", labels: { accent: "australian" }, verified_languages: [{ language: "en" }, { language: "pt", preview_url: "https://x/pt.mp3" }] }] }));
    }) as unknown as typeof fetch;
    const r = await listarVozes({ chave: "sk", fetchImpl }, { busca: "narrador" });
    expect(r.proxima).toBe("t2");
    expect(r.vozes[0]).toMatchObject({ voice_id: "IKne3meq5aSn9XLyUdCD", idiomas: ["en", "pt"], previa_pt: "https://x/pt.mp3" });
  });

  it("clone manda as gravações em multipart", async () => {
    let form: FormData | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      form = init.body as FormData;
      return new Response(JSON.stringify({ voice_id: "novaVoz12345", requires_verification: false }));
    }) as unknown as typeof fetch;
    const r = await clonarVoz({ chave: "sk", fetchImpl }, { nome: "Ana", descricao: "", arquivos: [{ nome: "a.mp3", tipo: "audio/mpeg", bytes: new Uint8Array([1, 2]) }], removerRuido: true });
    expect(r.voice_id).toBe("novaVoz12345");
    expect(form!.get("name")).toBe("Ana");
    expect(form!.get("remove_background_noise")).toBe("true");
    expect(form!.getAll("files")).toHaveLength(1);
  });
});

describe("agente do motion: voz e som", () => {
  const listas = (voz: Record<string, unknown>) => ({ filmeId: "f1", cenas: [{ id: "c1", titulo: "Abre", peca: "abertura", modo: "kit", tipo_plano: "hf", tem_still: false, still_aprovado: false }], storyboards: [], tem_trilha: false, tem_batidas: false, voz: { tem_chave: true, tem_voz: true, falas: 1, audios: 0, cenas_com_fala: ["c1"], ...voz } });

  it("operações novas no esquema, com custo no cartão; sem chave ou sem voz, trava com a frase", () => {
    ["escrever_falas", "gerar_narracao", "casar_narracao", "gerar_trilha"].forEach((o) => expect(OPERACOES_DO_MOTION).toContain(o));
    expect(JSON.stringify(ESQUEMA_DAS_ACOES_DO_MOTION)).toContain("gerar_narracao");
    const acao = normalizarAcoesDoMotion({ itens: [{ ref: "x1", operacao: "gerar_narracao", para: null }], resumo: "narrar" }, listas({}), CLIENTE, { brand: 0, storyboards: 0, cena: 0, critica: 0, narracao: 0.05, trilha: 0.1 });
    expect(acao && acao.custo_estimado_usd).toBe(0.05);
    expect(regrasDoMotion().gerar_narracao.direta).toBeFalsy();
    expect(regrasDoMotion().casar_narracao.direta).toBe(true);
    const semChave = normalizarAcoesDoMotion({ itens: [{ ref: "x1", operacao: "gerar_narracao", para: null }], resumo: "narrar" }, listas({ tem_chave: false }), CLIENTE, { brand: 0, storyboards: 0, cena: 0, critica: 0 });
    expect(JSON.stringify(semChave)).toContain("chave da ElevenLabs");
  });
});

describe("banco, servidor e regras", () => {
  const sql = ler("supabase/migrations/20260930315000_motion_vozes.sql");
  const voz = ler("supabase/functions/mesa-motion/voz.ts");
  const index = ler("supabase/functions/mesa-motion/index.ts");

  it("motion_vozes: RLS por cliente, escrita só do servidor, clone só com autorização", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.motion_vozes FROM authenticated");
    expect(sql).toMatch(/origem <> 'clonada' OR \(autorizacao IS NOT NULL/);
    expect(sql).toContain("WHERE padrao AND arquivado_em IS NULL");
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM/i);
  });

  it("a chave fica no servidor; todo gasto confere o saldo antes e registra o uso como motion", () => {
    expect(voz).toContain('chaveDaElevenLabs((n) => Deno.env.get(n))');
    expect(voz).not.toMatch(/sk_[A-Za-z0-9]{10,}/);
    expect(voz.match(/await saldoAntes\(/g)!.length).toBeGreaterThanOrEqual(4);
    expect(voz).toContain('_tarefa: "motion"');
    expect(voz).toContain('_provedor: "elevenlabs"');
    expect(voz).toContain("metodo: await superpoderesPara(d.servico(), { agente: \"motion.geracao\"");
    // A marca que não é a principal nunca herda a voz da outra.
    expect(voz).toContain('q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);');
    expect(index).toContain("...VOZ.acoes");
    expect(index).toContain("ACOES_LONGAS_DA_VOZ");
    // A tela não escreve caminho de áudio: os áudios vêm do servidor.
    expect(index).toContain("narracaoDaTela(f.som.narracao, obj(c.som).narracao)");
  });

  it("montar recusa a fala sem narração em dia (409 com a lista de faltasDaNarracao)", () => {
    const n = narracaoCom({ falas: { c1: "Oi", c2: "" } });
    expect(faltasDaNarracao(n, [{ id: "c1" }, { id: "c2" }])).toEqual(["cena 1: fala sem narração gerada"]);
    expect(faltasDaNarracao({ ...n, ligada: false }, [{ id: "c1" }])).toEqual([]);
    expect(index).toMatch(/faltasDaNarracao\(f\.som\.narracao, f\.cenas\)\.forEach[\s\S]{0,200}new ErroHttp\(409, "cenas_faltando"/);
  });

  it("a trilha gerada é instrumental e no tamanho do filme", () => {
    expect(promptDaTrilha({ clima: "epica", tom: "confiante", ritmo: "rapido", duracao_s: 31.6, comVoz: true })).toMatch(/Instrumental epic.*124 bpm.*voiceover.*32 seconds\. No vocals\./);
  });
});

describe("correções da revisão (MOV)", () => {
  const index = ler("supabase/functions/mesa-motion/index.ts");
  const voz = ler("supabase/functions/mesa-motion/voz.ts");

  it("worker antigo: a função recusa a peça nova, o acabamento e a mixagem com narração com a frase certa", () => {
    expect(ler("workers/render/principal.ts")).toMatch(/VERSAO_DO_WORKER = "[^"]*\+mov-1"/);
    expect(workerConheceMov("edt-1.0+mot-1.0+mov-1")).toBe(true);
    expect(workerConheceMov("edt-1.0+mot-1.0+mov-2")).toBe(true);
    expect(workerConheceMov("edt-1.0+mot-1.0")).toBe(false);
    expect(workerConheceMov(null)).toBe(false);
    expect(novidadeDaCena({ peca: "frase_impacto" })).toBe(`a cena "${PECAS_EXTRAS[0].rotulo}"`);
    expect(novidadeDaCena({ peca: "abertura", acabamento: "cinema" })).toBe('o acabamento "Cinema"');
    expect(novidadeDaCena({ peca: "abertura", acabamento: "limpo" })).toBeNull();
    expect(novidadeDaCena({ peca: "abertura" })).toBeNull();
    expect(fraseDoWorkerAntigo("edt-1.0+mot-1.0", "o acabamento \"Cinema\"")).toMatch(/versão antiga \(edt-1\.0\+mot-1\.0\).*reinicie/);
    expect(index).toContain("await exigirWorkerNovo(novidadeDaCena(cena));");
    expect(index).toContain('"worker_antigo"');
    expect(index).toMatch(/exigirWorkerNovo\(temNarracao \?/);
  });

  it("Voice Library pública: português do Brasil com prévia, e a voz entra na conta ao escolher", async () => {
    const pedidos: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      if (url.indexOf("/v1/shared-voices") >= 0)
        return new Response(JSON.stringify({ has_more: true, voices: [{ public_owner_id: "dono1234567", voice_id: "pubVOZ12345", name: "Ana", accent: "brazilian", gender: "female", age: "middle_aged", language: "pt", locale: "pt-BR", preview_url: "https://p/a.mp3", verified_languages: [{ language: "pt", preview_url: "https://p/pt.mp3" }] }, { voice_id: "semDono1234" }] }));
      return new Response(JSON.stringify({ voice_id: "contaVOZ999" }));
    }) as unknown as typeof fetch;
    const r = await listarVozesCompartilhadas({ chave: "k", fetchImpl }, { busca: "narradora", idioma: "pt", locale: "pt-BR", pagina: 0 });
    const u = new URL(pedidos[0].url);
    expect(u.pathname).toBe("/v1/shared-voices");
    expect(u.searchParams.get("language")).toBe("pt");
    expect(u.searchParams.get("locale")).toBe("pt-BR");
    expect(u.searchParams.get("search")).toBe("narradora");
    expect(r.vozes).toHaveLength(1);
    expect(r.vozes[0]).toMatchObject({ public_owner_id: "dono1234567", locale: "pt-BR", previa_pt: "https://p/pt.mp3", sotaque: "brazilian" });
    expect(r.proxima).toBe(1);
    const id = await adicionarVozCompartilhada({ chave: "k", fetchImpl }, { publicOwnerId: "dono1234567", voiceId: "pubVOZ12345", nome: "Ana" });
    expect(id).toBe("contaVOZ999");
    expect(pedidos[1].url).toMatch(/\/v1\/voices\/add\/dono1234567\/pubVOZ12345$/);
    expect(JSON.parse(String(pedidos[1].init.body))).toEqual({ new_name: "Ana" });
    await expect(adicionarVozCompartilhada({ chave: "k", fetchImpl }, { publicOwnerId: "../x", voiceId: "pubVOZ12345", nome: "Ana" })).rejects.toBeInstanceOf(ErroDaVoz);
    expect(voz).toContain("vozes_compartilhadas: vozesCompartilhadas");
  });

  it("ações longas releem o filme antes de gravar (nada que a equipe mudou na tela é sobrescrito)", () => {
    expect(voz.match(/await filmeAtual\(ch, f\)/g)!.length).toBeGreaterThanOrEqual(4);
    expect(voz).toContain('registrarFalha("mesa-motion: Jev não escolheu o storyboard"');
  });
});
