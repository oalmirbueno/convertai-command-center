/**
 * Prova do editor completo (frente EDT, rodada 2), NESTA máquina e sem banco:
 * monta a edição inteira com o MESMO código da tela (o "Editar com IA" pelo
 * plano da casa: corte, reenquadrar 16:9 para 9:16 seguindo o rosto, zoom nos
 * momentos fortes, legenda da marca, gancho, animação, transições, cor com
 * LUT, música com ducking, efeitos e cartão final) e renderiza pelo MESMO
 * código do worker (Remotion CLI + -14 LUFS), em 9:16 e uma amostra em 1:1.
 * Tira quadros do MP4 para conferir a olho.
 *
 * Rodar na raiz do repositório (vite-node entende os imports da tela):
 *   npx vite-node workers/render/testes/editor-completo-ponta-a-ponta.ts
 * Opcional: RENDER_EXEMPLO (vídeo de fala), RENDER_PROVAS (pasta das provas),
 * RENDER_CHROME (Chrome Headless Shell já baixado).
 */

import assert from "node:assert/strict";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { comFormato, projetoDosTakes, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { planoPadrao } from "../../../supabase/functions/editor-video/modulos/plano-da-edicao";
import { aplicarOperacao, aplicarOperacoes } from "../../../src/lib/editor/operacoes";
import { montarEdicaoCompleta, projetoDepoisDoCorte } from "../../../src/lib/editor/edicaoCompleta";
import { frasesDoProjeto } from "../../../src/lib/editor/skills/pecasDaEdicao";
import { lutDoArquivo } from "../../../src/lib/editor/cor";
import type { Armazem } from "../armazem.ts";
import type { Fila, PedidoDoWorker } from "../fila.ts";
import { executar, medirLoudness, sondar } from "../midia.ts";
import { PASTA_DO_WORKER, trabalharRender, type Ambiente } from "../trabalho.ts";

const EXEMPLO = process.env.RENDER_EXEMPLO || "C:/AI/acervo-aceleriq/edit-ia-pro/EDIT-IA-PRO/teste/video-de-teste.mp4";
const PASTA = path.join(PASTA_DO_WORKER, "tmp", "editor-completo");
const ARMAZEM = path.join(PASTA, "armazem");
const PROVAS = process.env.RENDER_PROVAS || path.join(PASTA, "provas");
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const inicio = Date.now();
const log = (t: string) => console.log(`[${((Date.now() - inicio) / 1000).toFixed(1).padStart(6)} s] ${t}`);

const FALA = "Eu gravei esse vídeo uma vez só, errei, gaguejei, repeti frase e você não viu nada disso! Porque quem editou esse vídeo não fui eu, foi uma IA.";

const nomesNaMidia: string[] = [];

/** Armazém no disco (o mesmo contrato do Storage). */
const armazemLocal: Armazem = {
  async baixar(bucket, caminho, destino) {
    await mkdir(path.dirname(destino), { recursive: true });
    await copyFile(path.join(ARMAZEM, bucket, caminho), destino);
    return 0;
  },
  async subir(bucket, caminho, arquivo) {
    const destino = path.join(ARMAZEM, bucket, caminho);
    await mkdir(path.dirname(destino), { recursive: true });
    await copyFile(arquivo, destino);
  },
};

const filaSolta: Fila = {
  pegar: async () => null,
  progresso: async () => true,
  concluir: async () => true,
  falhar: async () => true,
  registrarArquivo: async (a: { nome: string; origem: Record<string, unknown> }) => {
    log(`Mídia: "${a.nome}" (formato ${String(a.origem.formato)})`);
    nomesNaMidia.push(a.nome);
    return "arquivo-de-teste";
  },
  tituloDaVersao: async () => "Prova do editor completo",
};

/** Vídeo 16:9 com a pessoa à direita (o exemplo vertical sobre um fundo): o reenquadramento tem o que achar. */
async function prepararFonte(): Promise<{ caminho: string; duracao: number }> {
  const rel = `${CLIENTE}/video/brutos/fala-16x9.mp4`;
  const destino = path.join(ARMAZEM, "mesa", rel);
  await mkdir(path.dirname(destino), { recursive: true });
  const filtro = [
    "color=c=0x2b3a4a:s=1280x720:r=30:d=9[fundo]",
    "[0:v]scale=-2:720,setsar=1[pessoa]",
    "[fundo][pessoa]overlay=x=860:y=0:shortest=1,format=yuv420p[v]",
    "[0:a]aresample=48000,aformat=channel_layouts=stereo[a]",
  ].join(";");
  const r = await executar("ffmpeg", ["-y", "-v", "error", "-t", "9", "-i", EXEMPLO, "-filter_complex", filtro, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", destino]);
  assert.equal(r.codigo, 0, r.erros);
  const s = await sondar(destino);
  return { caminho: rel, duracao: s.duracao_s || 9 };
}

async function prepararTrilha(): Promise<string> {
  const rel = `${CLIENTE}/video/brutos/trilha-teste.wav`;
  const destino = path.join(ARMAZEM, "mesa", rel);
  const expr = "0.25*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.2*sin(2*PI*277.18*t)+0.18*sin(2*PI*329.63*t)";
  const r = await executar("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `aevalsrc=${expr}:s=48000:d=12`, "-ac", "2", destino]);
  assert.equal(r.codigo, 0, r.erros);
  return rel;
}

/** Letra da marca do cliente no Storage (aqui, um arquivo de letra à mão, para a diferença aparecer no quadro). */
async function prepararLetraDaMarca(): Promise<string> {
  const rel = `${CLIENTE}/fontes/letra-da-marca.woff2`;
  const destino = path.join(ARMAZEM, "mesa", rel);
  await mkdir(path.dirname(destino), { recursive: true });
  await copyFile(path.join(PASTA_DO_WORKER, "..", "..", "public", "editor", "fontes", "Caveat-Variable.woff2"), destino);
  return rel;
}

function cubeQuente(): string {
  const N = 17;
  const s = (v: number) => Math.min(1, Math.max(0, (v - 0.5) * 1.15 + 0.5));
  const l = ["TITLE \"Quente da marca\"", `LUT_3D_SIZE ${N}`];
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) l.push([s((r / (N - 1)) * 1.07), s(g / (N - 1)), s((b / (N - 1)) * 0.86)].map((x) => x.toFixed(5)).join(" "));
  return l.join("\n");
}

/** O projeto como a tela deixaria depois do Timestamp, do rastreio do rosto e da música na Mídia. */
function projetoDaTela(fonte: { caminho: string; duracao: number }, trilha: string): ProjetoDeEdicao {
  let p = projetoDosTakes({ titulo: "Prova do editor completo", formato: "16:9", fps: 30, takes: [{ id: "a", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: fonte.caminho, cena_ref: null, melhor: true, duracao_s: fonte.duracao, largura: 1280, altura: 720 }] });
  const palavras = FALA.split(" ");
  const passo = (fonte.duracao - 0.6) / palavras.length;
  const segmentos = palavras.map((t, k) => ({ t, i: Math.round((0.3 + k * passo) * 1000) / 1000, f: Math.round((0.3 + k * passo + passo * 0.85) * 1000) / 1000 }));
  p = aplicarOperacao(p, { op: "transcricao", fonte: "fala", transcricao: { segmentos, por_palavra: true, origem: "prova", versao: 1, em: null } });
  // Rastro do rosto como o painel Formato guardaria (a pessoa está à direita do quadro 16:9).
  const pontos = Array.from({ length: 7 }).map((_, k) => ({ t: k * 1.5, x: 0.83, y: 0.36, w: 0.12 }));
  p = aplicarOperacao(p, { op: "rosto", fonte: "fala", rastro: { pontos, origem: "prova", em: null } });
  p = aplicarOperacao(p, { op: "fonte", fonte: { chave: "trilha", arquivo_id: null, nome: "Trilha de teste", tipo: "audio", storage_bucket: "mesa", storage_path: trilha, duracao_s: 12, largura: null, altura: null, midia: "audio" } });
  return p;
}

async function quadros(mp4: string, nome: string, tempos: number[]) {
  await mkdir(PROVAS, { recursive: true });
  const saidas: string[] = [];
  for (const t of tempos) {
    const png = path.join(PROVAS, `${nome}-${t.toFixed(1).replace(".", "_")}s.png`);
    const r = await executar("ffmpeg", ["-y", "-v", "error", "-ss", t.toFixed(2), "-i", mp4, "-frames:v", "1", "-vf", "scale=360:-2", png]);
    assert.equal(r.codigo, 0, r.erros);
    saidas.push(png);
  }
  const folha = path.join(PROVAS, `${nome}-folha.png`);
  const r = await executar("ffmpeg", ["-y", "-v", "error", ...saidas.reduce((l, s) => l.concat(["-i", s]), [] as string[]), "-filter_complex", `hstack=inputs=${saidas.length}`, folha]);
  assert.equal(r.codigo, 0, r.erros);
  return folha;
}

async function principal() {
  assert.ok(existsSync(EXEMPLO), `Falta o vídeo de exemplo: ${EXEMPLO}`);
  await rm(PASTA, { recursive: true, force: true });
  await mkdir(ARMAZEM, { recursive: true });
  const fonte = await prepararFonte();
  const trilha = await prepararTrilha();
  const letra = await prepararLetraDaMarca();
  log(`fonte 16:9 de ${fonte.duracao} s, trilha pronta`);

  // 1) O "Editar com IA" pelo plano da casa (receita Anúncio), sem rede: o que seria do Jev entra pela regra.
  const base = projetoDaTela(fonte, trilha);
  // A música entra pelo próprio Plano da casa (a primeira da Mídia do projeto), como na tela; nada preenchido à mão.
  const musicas = Object.keys(base.fontes).filter((k) => base.fontes[k].midia === "audio" && base.fontes[k].storage_bucket !== "publico");
  const plano = { ...planoPadrao("anuncio", musicas), formato: "9:16" as const, textos: { gancho: "Você não viu nada disso", chamada: "", nome: "" }, cartao_final: { ligado: true, titulo: "Editado pela IA da Aceleriq", botao: "Fale com a gente" } };
  const cortado = projetoDepoisDoCorte(base, plano, new Date().toISOString());
  const frases = frasesDoProjeto(cortado);
  const r = montarEdicaoCompleta(base, plano, {
    agora: new Date().toISOString(),
    marca: { nome: "Aceleriq", cor: "#00E676", cor2: "#0B1F14", fonte: "Letra da Marca", fonte_path: letra, logo_path: null },
    notas: frases.map((f) => ({ k: f.k, nota: /IA|nada disso/.test(f.texto) ? 0.95 : 0.2 })),
    animacoes: [{ inicio_s: frases[frases.length - 1].inicio_s, peca: "carimbo", params: { texto: "IA" } }],
  });
  r.passos.forEach((x) => log(`${x.feito ? "ok " : "-- "} ${x.rotulo}: ${x.detalhe}`));
  assert.ok(r.passos.some((x) => x.id === "musica" && x.feito), "a música do Plano da casa entrou");
  assert.equal(r.proposta.resultado.identidade && r.proposta.resultado.identidade.fonte_path, letra, "a letra da marca foi para o projeto");
  let projeto = r.proposta.resultado;
  // A proposta é a lista de operações: reaplicada no projeto de entrada, dá o mesmo resultado.
  assert.equal(JSON.stringify(aplicarOperacoes(base, r.proposta.operacoes).trilhas), JSON.stringify(projeto.trilhas));
  // LUT do cliente (.cube) por cima do look.
  const lut = lutDoArquivo(cubeQuente(), "quente.cube");
  projeto = aplicarOperacao(projeto, { op: "cor", campos: { lut, intensidade: 0.85 } });
  log(`LUT "${lut.nome}": erro médio ${(lut.erro * 100).toFixed(2)}%`);
  assert.equal(projeto.formato, "9:16");
  await mkdir(PROVAS, { recursive: true });
  await writeFile(path.join(PROVAS, "projeto-editado.json"), JSON.stringify(projeto, null, 1));

  const amb: Ambiente = { fila: filaSolta, armazem: armazemLocal, token: "t", pasta: path.join(PASTA, "trabalho"), chrome: process.env.RENDER_CHROME || null, concorrencia: Number(process.env.RENDER_CONCORRENCIA) || null, log };

  // 2) Render do vídeo inteiro em 9:16 (o mesmo trabalharRender do worker).
  const pedido: PedidoDoWorker = { id: "prova-9x16", client_id: CLIENTE, versao_id: null, tipo: "render_final", projeto: projeto as unknown as Record<string, unknown>, revisao: 1, entrada: { formato: "9:16" }, tentativas: 0 };
  await mkdir(path.join(PASTA, "trabalho", pedido.id), { recursive: true });
  const f1 = await trabalharRender(amb, pedido, path.join(PASTA, "trabalho", pedido.id));
  const mp4 = path.join(ARMAZEM, "mesa", f1.saida);
  const s1 = await sondar(mp4);
  const l1 = await medirLoudness(mp4);
  log(`9:16 pronto: ${s1.largura}x${s1.altura}, ${s1.duracao_s} s, ${l1 ? l1.input_i : "?"} LUFS`);
  assert.equal(s1.largura, 1080);
  assert.equal(s1.altura, 1920);
  assert.ok(l1 && Math.abs(l1.input_i + 14) <= 1.5, `volume final perto de -14 LUFS (${l1 && l1.input_i})`);
  await copyFile(mp4, path.join(PROVAS, "editor-completo-9x16.mp4"));
  const folha1 = await quadros(mp4, "9x16", [0.6, 2.2, 4.0, Math.max(0.5, (s1.duracao_s || 8) - 1.2)]);

  // 3) O mesmo projeto em 1:1 (amostra de 4 s): o render_pedir com formato faz isto no servidor.
  const q = comFormato(projeto, "1:1");
  const amostra: PedidoDoWorker = { id: "prova-1x1", client_id: CLIENTE, versao_id: null, tipo: "amostra", projeto: q as unknown as Record<string, unknown>, revisao: 1, entrada: { inicio_s: 1, fim_s: 5, formato: "1:1" }, tentativas: 0 };
  await mkdir(path.join(PASTA, "trabalho", amostra.id), { recursive: true });
  const f2 = await trabalharRender(amb, amostra, path.join(PASTA, "trabalho", amostra.id));
  const mp4b = path.join(ARMAZEM, "mesa", f2.saida);
  const s2 = await sondar(mp4b);
  log(`1:1 pronto: ${s2.largura}x${s2.altura}, ${s2.duracao_s} s`);
  assert.equal(s2.largura, 1080);
  assert.equal(s2.altura, 1080);
  await copyFile(mp4b, path.join(PROVAS, "editor-completo-1x1-amostra.mp4"));
  const folha2 = await quadros(mp4b, "1x1", [0.5, 2.5]);
  // Na Mídia, cada render diz o formato no nome.
  assert.deepEqual(nomesNaMidia, ["Prova do editor completo (render 9:16)", "Prova do editor completo (amostra 1:1)"]);
  log(`provas: ${folha1} e ${folha2}`);
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
