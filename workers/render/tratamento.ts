/**
 * Tratar vídeo no worker (Mesa Edição, 02/10/2026): tirar a legenda gravada e
 * melhorar a qualidade. Regras e motores em
 * supabase/functions/mesa-videos/modulos/tratamento-de-video.ts.
 *
 * Pedido `tratamento` (fila render_pedidos, ligado a video_tratamentos.id):
 * - fase "preparar": baixa o vídeo de origem (só da pasta do cliente) e corta
 *   cada parte pedida no perfil do motor:
 *   - "padrao" (Wan VACE): 30 qps, lado menor 720 a 1080, H.264;
 *   - "aleph" (Runway): lado menor 720 e taxa contida (até 16 MB por envio);
 *   - "fiel" (Topaz, SeedVR2): o mesmo tamanho e o mesmo qps do original,
 *     H.264 quase sem perda (nada de reduzir antes de ampliar).
 *   Para tirar a legenda com máscara, faz também a MÁSCARA de cada parte: vídeo
 *   preto do mesmo tamanho, qps e duração, com a faixa da legenda em branco.
 * - fase "compor": monta com o ÁUDIO ORIGINAL:
 *   - normaliza o trecho original (gira pelo metadado, mesmo qps) = o "antes";
 *   - tirar legenda: junta as partes tratadas, põe no tamanho do original e
 *     cola SÓ a faixa da legenda (máscara com borda suave) sobre o original.
 *     O resto do quadro é o original;
 *   - melhorar: junta as partes tratadas no tamanho que o modelo devolveu;
 *   - amostra: sobe o antes e o depois (para comparar); final: sobe o depois e
 *     registra o vídeo novo na Mídia (video_arquivos, tipo "gerado").
 * Tudo por ffmpeg. Sem nova tentativa: erro sobe com o motivo.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Fila, PedidoDoWorker } from "./fila.ts";
import type { Armazem } from "./armazem.ts";
import { argsDoPreparo, caminhoDoCliente } from "./cenario.ts";
import { executar, FFMPEG, sondar } from "./midia.ts";

type Avisar = (etapa: string, valor: number, forcar?: boolean) => Promise<void>;

export interface AmbienteDoTratamento {
  fila: Fila;
  armazem: Armazem;
  log?: (t: string) => void;
}

export type PerfilDoTratamento = "padrao" | "aleph" | "fiel";

export interface Regiao {
  x: number;
  y: number;
  w: number;
  h: number;
}

const par = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const extensao = (c: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(c);
  return m ? `.${m[1].toLowerCase()}` : "";
};

/** Região conferida (fração do quadro); null quando não vale. */
export function regiaoDoPedido(v: unknown): Regiao | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const r = { x: Number(o.x), y: Number(o.y), w: Number(o.w), h: Number(o.h) };
  if (![r.x, r.y, r.w, r.h].every((z) => isFinite(z) && z >= 0 && z <= 1) || r.w <= 0 || r.h <= 0) return null;
  return r;
}

/** A região em pixels pares dentro de W x H. */
export function regiaoEmPixels(r: Regiao, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.floor((r.x * W) / 2) * 2);
  const y = Math.max(0, Math.floor((r.y * H) / 2) * 2);
  return { x, y, w: Math.min(par(r.w * W), W - x), h: Math.min(par(r.h * H), H - y) };
}

// ------------------------------------------------------------------ preparar

/** Corte de uma parte no perfil do motor. */
export function argsDaParte(entrada: string, saida: string, inicio_s: number, duracao_s: number, perfil: PerfilDoTratamento): string[] {
  if (perfil === "fiel") {
    return ["-y", "-v", "error", "-ss", inicio_s.toFixed(3), "-i", entrada, "-t", duracao_s.toFixed(3), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", saida];
  }
  return argsDoPreparo(entrada, saida, inicio_s, duracao_s, perfil === "aleph" ? "aleph" : "padrao");
}

/** Máscara da parte: preto do tamanho, qps e duração da parte, com a faixa em branco (H.264). */
export function argsDaMascara(saida: string, W: number, H: number, duracao_s: number, r: Regiao, fps = 30): string[] {
  const p = regiaoEmPixels(r, W, H);
  const fonte = `color=c=black:s=${par(W)}x${par(H)}:r=${fps}:d=${duracao_s.toFixed(3)}`;
  return ["-y", "-v", "error", "-f", "lavfi", "-i", fonte, "-vf", `drawbox=x=${p.x}:y=${p.y}:w=${p.w}:h=${p.h}:color=white:t=fill,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-movflags", "+faststart", saida];
}

// ------------------------------------------------------------------ compor

/** O trecho original normalizado (gira pelo metadado, mesmo qps, pixel par): o "antes". */
export function argsDoAntes(entrada: string, saida: string, inicio_s: number, duracao_s: number): string[] {
  return ["-y", "-v", "error", "-ss", inicio_s.toFixed(3), "-i", entrada, "-t", duracao_s.toFixed(3), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", saida];
}

/**
 * O filtro da montagem. Entrada 0 = o antes; 1..n = as partes tratadas, na ordem.
 * Saída em [v]. Tirar legenda: só a faixa vem da IA (borda suave), o resto é o original.
 */
export function filtroDoTratamento(p: { acao: "tirar_legenda" | "melhorar"; partes: number; W: number; H: number; duracao_s: number; regiao: Regiao | null; Wia?: number | null; Hia?: number | null }): string {
  const W = par(p.W);
  const H = par(p.H);
  const n = Math.max(1, p.partes);
  const partes: string[] = [];
  const alvoW = p.acao === "melhorar" ? par(p.Wia || W) : W;
  const alvoH = p.acao === "melhorar" ? par(p.Hia || H) : H;
  for (let k = 1; k <= n; k++) partes.push(`[${k}:v]scale=${alvoW}:${alvoH},setsar=1,fps=30,format=yuv420p[p${k}]`);
  const juntas = n > 1 ? `${Array.from({ length: n }, (_, k) => `[p${k + 1}]`).join("")}concat=n=${n}:v=1:a=0[ia]` : `[p1]null[ia]`;
  partes.push(juntas);
  if (p.acao === "melhorar") {
    partes.push(`[ia]null[v]`);
    return partes.join(";");
  }
  if (!p.regiao) throw new Error("Falta a faixa da legenda.");
  const r = regiaoEmPixels(p.regiao, W, H);
  const borda = Math.max(2, Math.round(H * 0.012));
  partes.push(`color=c=black:s=${W}x${H}:r=30:d=${Math.max(0.1, p.duracao_s).toFixed(3)},format=gray,drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=white:t=fill,boxblur=${borda}:1[m]`);
  partes.push(`[ia]format=rgba[iar]`);
  partes.push(`[iar][m]alphamerge[faixa]`);
  partes.push(`[0:v][faixa]overlay=0:0:shortest=1:format=auto,format=yuv420p[v]`);
  return partes.join(";");
}

async function sha256(arquivo: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((ok, erro) => createReadStream(arquivo).on("data", (d) => h.update(d)).on("end", () => ok()).on("error", erro));
  return h.digest("hex");
}

const ultimas = (t: string, n = 3) => t.split("\n").filter(Boolean).slice(-n).join(" | ").slice(-400);

/** Monta o depois num arquivo local (usada pelo pedido e pela prova local). */
export async function montarLocal(o: { pasta: string; antes: string; ia: string[]; acao: "tirar_legenda" | "melhorar"; regiao: Regiao | null; saida: string }): Promise<{ filtro: string; W: number; H: number }> {
  const s = await sondar(o.antes);
  if (!s.largura || !s.altura) throw new Error("Não deu para ler o tamanho do vídeo original.");
  const sia = o.acao === "melhorar" ? await sondar(o.ia[0]) : null;
  const filtro = filtroDoTratamento({ acao: o.acao, partes: o.ia.length, W: s.largura, H: s.altura, duracao_s: s.duracao_s || 1, regiao: o.regiao, Wia: sia ? sia.largura : null, Hia: sia ? sia.altura : null });
  const entradas: string[] = ["-i", o.antes];
  o.ia.forEach((c) => entradas.push("-i", c));
  const args = ["-y", "-v", "error", ...entradas, "-filter_complex", filtro, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", o.saida];
  const r = await executar(FFMPEG, args, { cwd: o.pasta });
  if (r.codigo !== 0) throw new Error(`O ffmpeg não montou o vídeo tratado: ${ultimas(r.erros, 4)}`);
  return { filtro, W: s.largura, H: s.altura };
}

// ------------------------------------------------------------------ o pedido

export async function trabalharTratamento(amb: AmbienteDoTratamento, p: PedidoDoWorker, pasta: string, avisar: Avisar): Promise<{ saida: string | null; arquivoId: string | null; resultado: Record<string, unknown> }> {
  const e = p.entrada || {};
  const fase = String(e.fase || "");
  const fonte = caminhoDoCliente(p.client_id, e.fonte_path);
  if (!fonte) throw new Error("Vídeo de origem fora da pasta do cliente.");
  await avisar("baixando", 0.05, true);
  const local = path.join(pasta, `origem${extensao(fonte) || ".mp4"}`);
  await amb.armazem.baixar("mesa", fonte, local);

  if (fase === "preparar") {
    const perfil: PerfilDoTratamento = e.perfil === "aleph" ? "aleph" : e.perfil === "fiel" ? "fiel" : "padrao";
    const regiao = regiaoDoPedido(e.regiao);
    const lista = Array.isArray(e.partes) ? (e.partes as Record<string, unknown>[]) : [];
    if (!lista.length || lista.length > 120) throw new Error("Partes do tratamento inválidas.");
    const prontas: Record<string, unknown>[] = [];
    for (let k = 0; k < lista.length; k++) {
      const q = lista[k];
      const destino = caminhoDoCliente(p.client_id, q.destino);
      const destinoMascara = q.mascara_destino ? caminhoDoCliente(p.client_id, q.mascara_destino) : null;
      if (!destino || (q.mascara_destino && !destinoMascara)) throw new Error("Destino fora da pasta do cliente.");
      if (destinoMascara && !regiao) throw new Error("Falta a faixa da legenda para a máscara.");
      const inicio = Math.max(0, Number(q.inicio_s) || 0);
      const fim = Number(q.fim_s) || 0;
      if (!(fim > inicio)) throw new Error("Trecho inválido.");
      await avisar("montando", 0.1 + (0.7 * k) / lista.length, true);
      const parte = path.join(pasta, `parte-${k + 1}.mp4`);
      const r = await executar(FFMPEG, argsDaParte(local, parte, inicio, fim - inicio, perfil));
      if (r.codigo !== 0) throw new Error(`O ffmpeg não cortou a parte ${k + 1}: ${ultimas(r.erros)}`);
      const s = await sondar(parte);
      const bytes = (await stat(parte)).size;
      if (perfil === "aleph" && bytes > 16 * 1024 * 1024) throw new Error(`A parte ${k + 1} ficou com ${Math.round(bytes / 1048576)} MB e a Runway aceita até 16 MB.`);
      await amb.armazem.subir("mesa", destino, parte, "video/mp4");
      let mascaraPath: string | null = null;
      if (destinoMascara && regiao && s.largura && s.altura) {
        const mascara = path.join(pasta, `mascara-${k + 1}.mp4`);
        const m = await executar(FFMPEG, argsDaMascara(mascara, s.largura, s.altura, s.duracao_s || fim - inicio, regiao, 30));
        if (m.codigo !== 0) throw new Error(`O ffmpeg não fez a máscara da parte ${k + 1}: ${ultimas(m.erros)}`);
        await amb.armazem.subir("mesa", destinoMascara, mascara, "video/mp4");
        mascaraPath = destinoMascara;
      }
      prontas.push({ inicio_s: inicio, fim_s: fim, path: destino, mascara_path: mascaraPath, duracao_s: s.duracao_s, largura: s.largura, altura: s.altura });
    }
    await avisar("subindo", 0.95, true);
    if (amb.log) amb.log(`tratamento: ${prontas.length} parte(s) no perfil ${perfil}`);
    return { saida: null, arquivoId: null, resultado: { partes: prontas, perfil } };
  }

  if (fase !== "compor") throw new Error(`Fase desconhecida: ${fase || "vazia"}.`);
  const acao = e.acao === "melhorar" ? "melhorar" : "tirar_legenda";
  const destino = caminhoDoCliente(p.client_id, e.destino);
  if (!destino) throw new Error("Destino fora da pasta do cliente.");
  const destinoAntes = e.destino_antes ? caminhoDoCliente(p.client_id, e.destino_antes) : null;
  const regiao = regiaoDoPedido(e.regiao);
  const inicio = Math.max(0, Number(e.inicio_s) || 0);
  const fim = Number(e.fim_s) || 0;
  if (!(fim > inicio)) throw new Error("Trecho inválido.");
  const ia: string[] = [];
  const lista = Array.isArray(e.ia) ? (e.ia as Record<string, unknown>[]) : [];
  for (let k = 0; k < lista.length; k++) {
    const c = caminhoDoCliente(p.client_id, lista[k].path);
    if (!c) throw new Error(`Falta a parte tratada ${k + 1}.`);
    const l = path.join(pasta, `ia-${k + 1}${extensao(c) || ".mp4"}`);
    await amb.armazem.baixar("mesa", c, l);
    ia.push(l);
  }
  if (!ia.length) throw new Error("Nenhuma parte tratada para montar.");
  await avisar("montando", 0.25, true);
  const antes = path.join(pasta, "antes.mp4");
  const ra = await executar(FFMPEG, argsDoAntes(local, antes, inicio, fim - inicio));
  if (ra.codigo !== 0) throw new Error(`O ffmpeg não cortou o original: ${ultimas(ra.erros)}`);
  await avisar("renderizando", 0.45, true);
  const depois = path.join(pasta, "depois.mp4");
  await montarLocal({ pasta, antes, ia, acao, regiao, saida: depois });
  const s = await sondar(depois);
  const bytes = (await stat(depois)).size;
  await avisar("subindo", 0.85, true);
  await amb.armazem.subir("mesa", destino, depois, "video/mp4");
  if (destinoAntes) await amb.armazem.subir("mesa", destinoAntes, antes, "video/mp4");
  let arquivoId: string | null = null;
  if (e.registrar === true) {
    arquivoId = await amb.fila.registrarArquivo({
      client_id: p.client_id,
      nome: String(e.titulo || "Vídeo tratado").slice(0, 120),
      nome_original: `${p.id}.mp4`,
      storage_bucket: "mesa",
      storage_path: destino,
      tipo: "gerado",
      mime: "video/mp4",
      bytes,
      duracao_s: s.duracao_s,
      largura: s.largura,
      altura: s.altura,
      sha256: await sha256(depois),
      origem: { tipo: "tratamento", acao, tratamento_id: p.tratamento_id || null, de_arquivo_id: typeof e.de_arquivo_id === "string" ? e.de_arquivo_id : null, render_pedido_id: p.id },
    });
  }
  const resumo = `${acao === "melhorar" ? "Qualidade melhorada" : "Legenda tirada"} (${destinoAntes ? "amostra" : "vídeo inteiro"}): ${s.duracao_s} s em ${s.largura}x${s.altura}, ${Math.round(bytes / 1024)} KB, com o áudio original.`;
  return { saida: destino, arquivoId, resultado: { resumo, antes_path: destinoAntes, duracao_s: s.duracao_s, largura: s.largura, altura: s.altura, bytes } };
}
