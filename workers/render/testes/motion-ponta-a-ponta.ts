/**
 * Teste de ponta a ponta da Mesa Motion (frente MOT), NESTA máquina, sem
 * tocar no banco de produção:
 *
 * - kit real da AcelerIQ (cliente 4dd691a7-d481-451f-800b-5e6b6fdc8721):
 *   paleta e fontes lidas do banco em 29/09 (cliente_kit_marca e
 *   cliente_fontes); a logo é a arte da AcelerIQ do repositório
 *   (src/assets/logo-aceleriq.png, recortada) posta no MESMO caminho do kit no
 *   Storage local (o worker baixa pelo caminho, como em produção);
 * - apresentação de 15 s em 3 cenas HyperFrames: logo sting (kit), uma cena
 *   SOB MEDIDA escrita pelo modelo padrão do papel motion (uma chamada, sem
 *   laço; recusada pela conferência, entra a peça "passos" do kit e o teste
 *   diz) e o cartão final (kit);
 * - fila: as migrations de verdade (EDT + MOT) num Postgres em memória
 *   (PGlite); o worker pega pelos mesmos RPCs; Storage local com TUS;
 * - por cena: still, amostra de 5 s e final com alfa em 9:16 e 16:9; mapa de
 *   batidas de uma trilha feita aqui (120 BPM, sem licença de terceiro); cortes
 *   casados no ritmo; montagem pelo projeto da Mesa Edição e render final nos
 *   dois formatos a -14 LUFS, com os efeitos CC0 no pico;
 * - crítica: nota por critério pelo Jev (só aviso).
 * Teto: US$ 1 no total (modelo + Jev); a estimativa é conferida antes.
 *
 * Rodar (na pasta workers/render), com as chaves só na sessão:
 *   $env:OPENROUTER_API_KEY / $env:TYPESAFE_API_KEY
 *   $env:RENDER_HYPERFRAMES = "C:\AI\hyperframes-root\node_modules\hyperframes\bin\hyperframes.mjs" (ou npm install)
 *   npm run motion-ponta-a-ponta
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { lerMapaDeBatidas } from "../../../supabase/functions/_shared/batidas-da-trilha.ts";
import {
  conferirEscrita,
  contraste,
  coresDaMarca,
  dadosDaCenaSobMedida,
  ESQUEMA_DA_CENA,
  fontesDaCena,
  lerEscrita,
  type EscritaDaCena,
  type FormatoDoMotion,
  type MarcaDaCena,
  SISTEMA_DA_CENA,
} from "../../../supabase/functions/_shared/cena-hf.ts";
import {
  assinaturaDaCena,
  brandMd,
  casarNoRitmo,
  cenaDaLinha,
  chaveDoPedido,
  estadoDaCritica,
  lerBrand,
  lerCritica,
  type CenaDaLinha,
  type MaterialDaCena,
  perguntasDaCritica,
  projetoDoFilme,
  SOM_PADRAO,
} from "../../../supabase/functions/_shared/motion-metodo.ts";
import { noAlvoDeLoudness } from "../../../supabase/functions/_shared/som-do-editor.ts";
import { armazemSupabase } from "../armazem.ts";
import type { Fila, PedidoDoWorker } from "../fila.ts";
import { executar, medirLoudness, sondar } from "../midia.ts";
import { PASTA_DO_WORKER, RAIZ_DO_REPO, umPedido, type Ambiente } from "../trabalho.ts";
import { armazemLocal, CHAVE_LOCAL } from "./armazem-local.ts";
import { bancoComOMotion } from "./banco.ts";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const FILME = "33333333-3333-4333-8333-333333333333";
const PASTA = path.join(PASTA_DO_WORKER, "tmp", "motion");
const ARMAZEM = path.join(PASTA, "armazem");
const QUADROS = path.join(PASTA, "quadros");
const TETO_USD = 1;
const inicio = Date.now();
const log = (t: string) => console.log(`[${((Date.now() - inicio) / 1000).toFixed(1).padStart(6)} s] ${t}`);

// Kit da AcelerIQ como está no banco (cliente_kit_marca.paleta e cliente_fontes, lidos em 29/09/2026).
const KIT = {
  nome: "AcelerIQ",
  logo_path: `${CLIENTE}/marca/logo-1790364144125-2048.png`,
  paleta: [
    { hex: "#00D52B", nome: "Verde vibrante", papel: "primária e destaque" },
    { hex: "#111111", nome: "Preto carvão", papel: "secundária e fundo" },
    { hex: "#F7F7F7", nome: "Branco suave", papel: "fundo e texto sobre" },
    { hex: "#E7E8E9", nome: "Cinza claro", papel: "fundo" },
    { hex: "#6B6F73", nome: "Cinza médio", papel: "texto secundário" },
  ],
  fontes: [
    { nome: "Citrica", papel: "titulo" },
    { nome: "Roboto", papel: "texto" },
  ],
};

// BRAND.md do filme (o que a etapa 3 grava). Sem número: a AcelerIQ não tem prova numérica com fonte no dossiê.
const BRAND = lerBrand({
  essencia: "Agência de marketing que trabalha com método e mostra cada entrega no painel.",
  publico: "Donos de pequenas e médias empresas que querem marketing organizado.",
  promessa: "Marketing com método: plano, conteúdo, anúncios e relatório no mesmo lugar.",
  tom: "Direto, profissional, sem exagero.",
  provas: [{ texto: "Painel com calendário, aprovação e relatório para cada cliente", fonte: "painel Aceleriq OS" }],
  evitar: "Prometer resultado, número sem fonte, jargão.",
  movimento: "Entrada pela esquerda com rastro de velocidade, curva expo, um elemento por vez.",
  regras: "Verde, preto e branco com alto contraste.",
  beats: [
    { momento: "gancho", texto: "A marca entra com velocidade.", duracao_s: 5 },
    { momento: "promessa", texto: "Como o método funciona.", duracao_s: 5 },
    { momento: "marca", texto: "Chamada final com a logo.", duracao_s: 5 },
  ],
});

// ------------------------------------------------------------------ fila no PGlite

function filaNoPGlite(db: PGlite): Fila {
  const um = async <T>(sql: string, p: unknown[]) => (await db.query<T>(sql, p)).rows[0];
  return {
    async pegar(token, worker, versao) {
      const r = (await db.query<PedidoDoWorker>("SELECT * FROM public.render_pedidos_pegar($1, $2, 600, $3)", [token, worker, versao])).rows;
      return r.length ? r[0] : null;
    },
    progresso: async (id, token, etapa, p) => (await um<{ r: boolean }>("SELECT public.render_pedidos_progresso($1, $2, $3, $4, 600) AS r", [id, token, etapa, p])).r,
    concluir: async (id, token, s, a, r) => (await um<{ r: boolean }>("SELECT public.render_pedidos_concluir($1, $2, $3, $4, $5::jsonb) AS r", [id, token, s, a, JSON.stringify(r)])).r,
    falhar: async (id, token, c, m) => (await um<{ r: boolean }>("SELECT public.render_pedidos_falhar($1, $2, $3, $4) AS r", [id, token, c, m])).r,
    async registrarArquivo(l) {
      const r = await um<{ id: string }>(
        "INSERT INTO public.video_arquivos (client_id, nome, nome_original, storage_bucket, storage_path, tipo, mime, bytes, duracao_s, largura, altura, sha256, origem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING id",
        [l.client_id, l.nome, l.nome_original, l.storage_bucket, l.storage_path, l.tipo, l.mime, l.bytes, l.duracao_s, l.largura, l.altura, l.sha256, JSON.stringify(l.origem)],
      );
      return r.id;
    },
    tituloDaVersao: async (id) => {
      const r = (await db.query<{ titulo: string; numero: number }>("SELECT titulo, numero FROM public.video_versoes WHERE id = $1", [id])).rows[0];
      return r ? `${r.titulo} v${r.numero}` : null;
    },
  };
}

// ------------------------------------------------------------------ modelo (uma cena sob medida) e Jev

const PRECO = { entrada: 4, saida: 20 }; // anthropic/claude-opus-5.5 no OpenRouter (US$ por 1M), padrão do papel motion no ia_modelos
const MODELO = "anthropic/claude-opus-5.5";

async function escreverCena(cena: CenaDaLinha, marca: MarcaDaCena, md: string, gasto: { usd: number }): Promise<{ escrita: EscritaDaCena | null; problemas: string[]; custo: number }> {
  const chave = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!chave) return { escrita: null, problemas: ["sem OPENROUTER_API_KEY nesta sessão"], custo: 0 };
  const estimativa = (6000 * PRECO.entrada + 6000 * PRECO.saida) / 1e6;
  assert.ok(gasto.usd + estimativa <= TETO_USD, `teto: gasto ${gasto.usd} + estimativa ${estimativa} passaria de US$ ${TETO_USD}`);
  const corpo = {
    model: MODELO,
    max_tokens: 6000,
    usage: { include: true },
    response_format: { type: "json_schema", json_schema: { name: ESQUEMA_DA_CENA.nome, strict: true, schema: ESQUEMA_DA_CENA.schema } },
    messages: [
      { role: "system", content: SISTEMA_DA_CENA },
      { role: "user", content: dadosDaCenaSobMedida({ cena, marca, formato: "9:16", provas: BRAND.provas, brand_md: md, imagens: [] }) },
    ],
  };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(180_000) });
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };
  if (!r.ok) return { escrita: null, problemas: [`OpenRouter ${r.status}: ${j.error ? j.error.message : ""}`], custo: 0 };
  const u = j.usage || {};
  const custo = typeof u.cost === "number" ? u.cost : ((u.prompt_tokens || 0) * PRECO.entrada + (u.completion_tokens || 0) * PRECO.saida) / 1e6;
  gasto.usd += custo;
  const texto = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  let bruto: unknown = null;
  try {
    bruto = JSON.parse(texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1));
  } catch {
    return { escrita: null, problemas: ["resposta do modelo não é JSON"], custo };
  }
  const escrita = lerEscrita(bruto, cena.duracao_s);
  const c = conferirEscrita(escrita);
  return { escrita: c.ok ? { ...escrita!, modelo_id: `openrouter:${MODELO}`, custo_usd: custo } : null, problemas: c.problemas, custo };
}

async function criticar(estado: Record<string, unknown>, gasto: { usd: number }): Promise<{ notas: Record<string, number>; avisos: string[]; media: number | null; custo: number }> {
  const chave = (process.env.TYPESAFE_API_KEY || "").trim();
  if (!chave) return { notas: {}, avisos: ["sem TYPESAFE_API_KEY nesta sessão"], media: null, custo: 0 };
  const r = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state: estado, model: "jev-latest", questions: perguntasDaCritica() }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) return { notas: {}, avisos: [`Jev ${r.status}`], media: null, custo: 0 };
  const j = (await r.json()) as { answers?: Record<string, { score?: number }>; usage?: { input_tokens?: number } };
  const custo = ((j.usage && j.usage.input_tokens) || 0) * 0.042 / 1e6;
  gasto.usd += custo;
  return { ...lerCritica(j.answers || {}), custo };
}

// ------------------------------------------------------------------ o teste

async function prepararKit(): Promise<void> {
  const destino = path.join(ARMAZEM, "mesa", KIT.logo_path);
  await mkdir(path.dirname(destino), { recursive: true });
  // A arte ocupa só a faixa do meio do PNG de 7813 px: recorte do lockup (memória "identidade Aceleriq em vídeo").
  const r = await executar("ffmpeg", ["-y", "-v", "error", "-i", path.join(RAIZ_DO_REPO, "src", "assets", "logo-aceleriq.png"), "-vf", "crop=6558:1946:565:2870,scale=1400:-1", destino]);
  assert.equal(r.codigo, 0, r.erros);
}

async function prepararTrilha(): Promise<string> {
  // 120 BPM: bumbo a cada 0,5 s, acorde e um "drop" em 8 s (mais energia). Feita aqui, sem licença de terceiro.
  const rel = `${CLIENTE}/video/brutos/trilha-motion-120bpm.wav`;
  const destino = path.join(ARMAZEM, "mesa", rel);
  await mkdir(path.dirname(destino), { recursive: true });
  const expr = [
    "0.8*sin(2*PI*55*t)*exp(-16*mod(t,0.5))",
    "0.25*sin(2*PI*1800*t)*exp(-60*mod(t+0.25,0.5))*gt(t,4)",
    "(0.10*sin(2*PI*220*t)+0.08*sin(2*PI*277.18*t)+0.08*sin(2*PI*329.63*t))*if(gt(t,8),1.8,1)",
  ].join("+");
  const r = await executar("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `aevalsrc='${expr}':s=48000:d=16`, "-ac", "2", destino]);
  assert.equal(r.codigo, 0, r.erros);
  return rel;
}

async function pedir(db: PGlite, tipo: "cena_hf" | "batidas", uid: string, entrada: Record<string, unknown>) {
  await db.query("INSERT INTO public.render_pedidos (client_id, motion_id, tipo, uid, entrada) VALUES ($1, $2, $3, $4, $5::jsonb)", [CLIENTE, FILME, tipo, uid, JSON.stringify(entrada)]);
}

async function rodarFila(amb: Ambiente): Promise<Array<{ tipo: string; detalhe: string }>> {
  const feitos: Array<{ tipo: string; detalhe: string }> = [];
  for (;;) {
    const r = await umPedido(amb, "maquina-de-teste", "mot-teste");
    if (!r) break;
    log(`${r.tipo}: ${r.estado} (${r.detalhe.slice(-90)})`);
    assert.equal(r.estado, "pronto", r.detalhe);
    feitos.push({ tipo: r.tipo, detalhe: r.detalhe });
  }
  return feitos;
}

async function principal() {
  assert.ok(process.env.RENDER_HYPERFRAMES || existsSync(path.join(PASTA_DO_WORKER, "node_modules", "hyperframes")), "Falta o HyperFrames (RENDER_HYPERFRAMES ou npm install).");
  await rm(PASTA, { recursive: true, force: true });
  await mkdir(QUADROS, { recursive: true });
  const srv = await armazemLocal(ARMAZEM);
  const db = await bancoComOMotion();
  const gasto = { usd: 0 };
  const amb: Ambiente = { fila: filaNoPGlite(db), armazem: armazemSupabase(srv.url, CHAVE_LOCAL), token: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", pasta: path.join(PASTA, "trabalho"), chrome: process.env.RENDER_CHROME || null, concorrencia: Number(process.env.RENDER_CONCORRENCIA) || null, log };
  const provas: Record<string, unknown> = { cliente: CLIENTE, kit: { paleta: KIT.paleta.map((c) => c.hex), fontes: KIT.fontes, logo_path: KIT.logo_path } };
  try {
    await db.query(`INSERT INTO public.profiles VALUES ('${CLIENTE}')`);
    await db.query("INSERT INTO public.motion_filmes (id, client_id, nome, tipo, formatos) VALUES ($1, $2, 'Apresentação AcelerIQ 15 s', 'apresentacao', ARRAY['9:16','16:9'])", [FILME, CLIENTE]);
    await prepararKit();
    const trilha = await prepararTrilha();

    // Marca da cena pelo kit real (cores pela paleta, fontes livres no lugar das do kit, logo pelo código).
    const fontes = fontesDaCena(KIT.fontes);
    const marca: MarcaDaCena = { nome: KIT.nome, cores: coresDaMarca(KIT.paleta, "escuro"), fonte_titulo: fontes.titulo, fonte_texto: fontes.texto, tem_logo: true };
    provas.marca = { cores: marca.cores, fonte_titulo: marca.fonte_titulo, fonte_texto: marca.fonte_texto, avisos_de_fonte: fontes.avisos };
    const md = brandMd("Apresentação AcelerIQ 15 s", BRAND, { nome: KIT.nome, paleta: KIT.paleta, fontes: KIT.fontes }, { duracao: "15", logo: "sting", prova: ["metodo"], clima: "tech", fundo: "escuro" });
    await writeFile(path.join(PASTA, "BRAND.md"), md);

    // Storyboard escolhido: 3 cenas de 5 s.
    let cenas: CenaDaLinha[] = [
      cenaDaLinha({ ordem: 1, titulo: "Marca entra", peca: "logo_sting", params: { tagline: "Marketing com método para empresas" }, duracao_s: 5, ideia: "A logo entra com o rastro de velocidade, assinatura da marca.", movimento: "entrada pela esquerda, skew e blur, expo.out" }, BRAND.provas, CLIENTE).cena,
      cenaDaLinha({ ordem: 2, titulo: "O método em 3 passos", modo: "sob_medida", duracao_s: 5, params: { passos: ["Plano do mês", "Conteúdo e anúncios", "Relatório no painel"] }, ideia: "Mostrar o método da AcelerIQ como um caminho que acende passo a passo, com um traço verde que liga as etapas.", movimento: "traço verde desenhado, cada etapa acende no tempo, câmera parada" }, BRAND.provas, CLIENTE).cena,
      cenaDaLinha({ ordem: 3, titulo: "Chamada final", peca: "cartao_final", params: { chamada: "Vamos organizar o seu marketing?", botao: "Fale com a AcelerIQ" }, duracao_s: 5, ideia: "Fechamento com a logo e a chamada.", movimento: "logo acelerada, chamada palavra por palavra, botão com seta" }, BRAND.provas, CLIENTE).cena,
    ];

    // 1) Cena 2 escrita pelo modelo padrão do papel motion (uma chamada; recusa vira aviso e entra o kit).
    log(`escrevendo a cena 2 com ${MODELO} (teto US$ ${TETO_USD})`);
    const escrita = await escreverCena(cenas[1], marca, md, gasto);
    if (escrita.escrita) {
      cenas[1] = { ...cenas[1], escrita: escrita.escrita };
      provas.cena_sob_medida = { modelo: MODELO, custo_usd: Math.round(escrita.custo * 1e6) / 1e6, resumo: escrita.escrita.resumo, picos: escrita.escrita.picos, bytes: { html: escrita.escrita.html.length, css: escrita.escrita.css.length, js: escrita.escrita.js.length } };
      await writeFile(path.join(PASTA, "cena-2-escrita.json"), JSON.stringify(escrita.escrita, null, 1));
      log(`cena 2 escrita (US$ ${escrita.custo.toFixed(4)}): ${escrita.escrita.resumo}`);
    } else {
      provas.cena_sob_medida = { recusada: escrita.problemas, custo_usd: escrita.custo, troca: "peça passos do kit" };
      log(`cena 2 recusada pela conferência (${escrita.problemas.join("; ")}): entra a peça passos do kit`);
      cenas[1] = cenaDaLinha({ ...cenas[1], modo: "kit", peca: "passos", params: { titulo: "Como funciona", itens: ["Plano do mês", "Conteúdo e anúncios", "Relatório no painel"] } }, BRAND.provas, CLIENTE).cena;
    }

    // 2) Batidas da trilha e cortes casados no ritmo.
    await pedir(db, "batidas", "mot-batidas-0001", { chave: trilha, bucket: "mesa", caminho: trilha });
    await rodarFila(amb);
    const bat = (await db.query<{ resultado: { batidas: unknown; lufs: number } }>("SELECT resultado FROM public.render_pedidos WHERE uid = 'mot-batidas-0001'")).rows[0].resultado;
    const mapa = lerMapaDeBatidas(bat.batidas)!;
    assert.ok(Math.abs(mapa.bpm - 120) <= 3, `andamento medido ${mapa.bpm} (esperado 120)`);
    assert.ok(mapa.drop_s !== null && Math.abs(mapa.drop_s - 8) <= 1.1, `drop medido em ${mapa.drop_s} (esperado perto de 8 s)`);
    cenas = casarNoRitmo(cenas, mapa);
    provas.batidas = { bpm: mapa.bpm, batidas: mapa.batidas.length, compassos: mapa.compassos.slice(0, 8), drop_s: mapa.drop_s, confianca: mapa.confianca, lufs_da_trilha: bat.lufs, duracoes_casadas: cenas.map((c) => c.duracao_s) };
    log(`batidas: ${mapa.bpm} BPM, drop ${mapa.drop_s} s; durações ${cenas.map((c) => c.duracao_s).join(" + ")}`);

    // 3) Still, amostra de 5 s e final (9:16 e 16:9) de cada cena pela fila.
    const formatos: FormatoDoMotion[] = ["9:16", "16:9"];
    for (const c of cenas) {
      const base = { cena: c, marca, logo_path: KIT.logo_path, filme_id: FILME, assinatura: assinaturaDaCena(c) };
      await pedir(db, "cena_hf", `mot-${c.id}-still`, { ...base, chave: chaveDoPedido(c.id, "still", "9:16"), modo: "still", formato: "9:16" });
      await pedir(db, "cena_hf", `mot-${c.id}-amostra`, { ...base, chave: chaveDoPedido(c.id, "amostra", "9:16"), modo: "amostra", formato: "9:16" });
      for (const f of formatos) await pedir(db, "cena_hf", `mot-${c.id}-final-${f.replace(":", "x")}`, { ...base, chave: chaveDoPedido(c.id, "final", f), modo: "final", formato: f });
    }
    // Um ativo por filme, tipo e chave: o mesmo pedido de novo não entra.
    await assert.rejects(pedir(db, "cena_hf", "mot-repetido-0001", { chave: chaveDoPedido(cenas[0].id, "still", "9:16"), modo: "still", formato: "9:16" }));
    const feitos = await rodarFila(amb);
    assert.equal(feitos.length, cenas.length * 4);
    const linhas = (await db.query<{ id: string; entrada: Record<string, unknown>; saida_path: string; resultado: Record<string, unknown> }>("SELECT id, entrada, saida_path, resultado FROM public.render_pedidos WHERE tipo = 'cena_hf' AND estado = 'pronto' ORDER BY criado_em")).rows;
    // A ordem da fila: still e amostra passam na frente dos finais.
    const ordem = (await db.query<{ modo: string }>("SELECT entrada->>'modo' AS modo FROM public.render_pedidos WHERE tipo = 'cena_hf' ORDER BY iniciado_em")).rows.map((r) => r.modo);
    assert.deepEqual(ordem.slice(0, cenas.length * 2).sort(), Array(cenas.length).fill("amostra").concat(Array(cenas.length).fill("still")).sort(), "still e amostra primeiro");
    const porCena: Record<string, unknown> = {};
    for (const c of cenas) {
      const minhas = linhas.filter((l) => (l.entrada.cena as { id: string }).id === c.id);
      const detalhe: Record<string, unknown> = {};
      for (const l of minhas) {
        const modo = String(l.entrada.modo);
        const formato = String(l.entrada.formato);
        const local = path.join(ARMAZEM, "mesa", l.saida_path);
        assert.ok(existsSync(local), `saída ${l.saida_path}`);
        const nome = `cena${c.ordem}-${modo}-${formato.replace(":", "x")}`;
        if (modo === "still") {
          await executar("ffmpeg", ["-y", "-v", "error", "-i", local, "-vf", "scale=540:-2", path.join(QUADROS, `${nome}.png`)]);
        } else {
          const s = await sondar(local);
          const esperado = modo === "amostra" ? Math.min(5, c.duracao_s) : c.duracao_s;
          assert.ok(s.duracao_s !== null && Math.abs(s.duracao_s - esperado) < 0.2, `${nome}: ${s.duracao_s} s (esperado ${esperado})`);
          if (modo === "final") {
            const alfa = await executar("ffprobe", ["-v", "error", "-show_entries", "stream_tags=alpha_mode", "-of", "csv=p=0", local]);
            assert.match(alfa.saida.toString("utf8"), /1/, `${nome}: WebM com canal alfa`);
          }
          const folha = l.resultado.folha_path ? path.join(ARMAZEM, "mesa", String(l.resultado.folha_path)) : null;
          if (folha && existsSync(folha)) await executar("ffmpeg", ["-y", "-v", "error", "-i", folha, path.join(QUADROS, `${nome}-folha.png`)]);
          detalhe[`${modo} ${formato}`] = { duracao_s: s.duracao_s, largura: s.largura, altura: s.altura, check: (l.resultado.check as Record<string, unknown>) ? { ok: (l.resultado.check as Record<string, unknown>).ok, layout: ((l.resultado.check as Record<string, Record<string, unknown>>).layout || {}).errorCount, contraste: (l.resultado.check as Record<string, Record<string, unknown>>).contrast } : null };
        }
      }
      porCena[`cena ${c.ordem} (${c.modo === "sob_medida" ? "sob medida" : c.peca})`] = detalhe;
    }
    provas.cenas = porCena;

    // 4) Crítica pelo Jev (só aviso), com o check medido do final 9:16 de cada cena.
    const critica: Record<string, unknown> = {};
    for (const c of cenas) {
      const l = linhas.find((x) => (x.entrada.cena as { id: string }).id === c.id && x.entrada.modo === "final" && x.entrada.formato === "9:16")!;
      const estado = estadoDaCritica({ cena: c, brand: BRAND, marca: { nome: marca.nome, cores: marca.cores }, formato: "9:16", check: l.resultado.check as Record<string, unknown>, contrasteTexto: contraste(marca.cores.texto, marca.cores.fundo) });
      critica[`cena ${c.ordem}`] = await criticar(estado, gasto);
    }
    provas.critica = critica;
    log(`crítica: ${JSON.stringify(critica)}`);

    // 5) Montagem (projeto da Mesa Edição) e render final nos dois formatos, pela mesma fila.
    const som = { ...SOM_PADRAO(), trilha: { arquivo_id: null, path: trilha, nome: "Trilha 120 BPM (teste)", duracao_s: 16 }, clima: "tech", batidas: mapa };
    const saidas: Record<string, unknown> = {};
    let k = 0;
    for (const f of formatos) {
      const materiais: MaterialDaCena[] = cenas.map((c) => {
        const l = linhas.find((x) => (x.entrada.cena as { id: string }).id === c.id && x.entrada.modo === "final" && x.entrada.formato === f)!;
        return { cena: c, caminho: l.saida_path, duracao_s: Number(l.resultado.duracao_s) || c.duracao_s, picos: (l.resultado.picos as Array<{ t: number; som: string }>) || [] };
      });
      const projeto = projetoDoFilme({ titulo: "Apresentação AcelerIQ", formato: f, materiais, som });
      const versao = `44444444-4444-4444-8444-44444444444${++k}`;
      await db.query("INSERT INTO public.video_versoes (id, client_id, titulo, numero, projeto) VALUES ($1, $2, $3, 1, $4::jsonb)", [versao, CLIENTE, `Apresentação AcelerIQ ${f}`, JSON.stringify(projeto)]);
      await db.query("INSERT INTO public.render_pedidos (client_id, versao_id, tipo, uid, projeto, revisao, entrada) VALUES ($1, $2, 'render_final', $3, $4::jsonb, 1, '{}'::jsonb)", [CLIENTE, versao, `mot-filme-${f.replace(":", "x")}`, JSON.stringify(projeto)]);
      saidas[f] = { versao, efeitos: ((projeto.trilhas as Array<{ id: string; clipes: Array<{ estilo: { som: string; pico_s: number } }> }>).find((t) => t.id === "audio-2") || { clipes: [] }).clipes.map((x) => `${x.estilo.som}@${x.estilo.pico_s}`) };
    }
    await rodarFila(amb);
    const finais = (await db.query<{ uid: string; saida_path: string; resultado: Record<string, unknown> }>("SELECT uid, saida_path, resultado FROM public.render_pedidos WHERE tipo = 'render_final' ORDER BY uid")).rows;
    assert.equal(finais.length, 2);
    for (const l of finais) {
      const f = l.uid.indexOf("16x9") > 0 ? "16:9" : "9:16";
      const local = path.join(ARMAZEM, "mesa", l.saida_path);
      const s = await sondar(local);
      const lufs = await medirLoudness(local);
      const total = cenas.reduce((a, c) => a + c.duracao_s, 0);
      assert.ok(s.duracao_s !== null && Math.abs(s.duracao_s - total) < 0.25, `filme ${f}: ${s.duracao_s} s (esperado ${total})`);
      assert.ok(lufs && noAlvoDeLoudness(lufs.input_i), `filme ${f}: ${lufs ? lufs.input_i : "sem"} LUFS (alvo -14)`);
      assert.ok(l.resultado.miniatura_path, "miniatura do filme");
      const pasta = f.replace(":", "x");
      for (const t of [1.2, 3.5, 6.5, 8.5, 11.5, 14]) await executar("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", local, "-frames:v", "1", "-vf", `scale=${f === "9:16" ? 360 : 640}:-2`, path.join(QUADROS, `filme-${pasta}-${String(t).replace(".", "_")}.png`)]);
      await executar("ffmpeg", ["-y", "-v", "error", "-i", local, "-c", "copy", path.join(PASTA, `filme-${pasta}.mp4`)]);
      saidas[f] = { ...(saidas[f] as object), arquivo: l.saida_path, duracao_s: s.duracao_s, largura: s.largura, altura: s.altura, lufs: lufs ? lufs.input_i : null, miniatura: l.resultado.miniatura_path };
    }
    provas.filme = saidas;
    provas.custo_total_usd = Math.round(gasto.usd * 1e6) / 1e6;
    assert.ok(gasto.usd <= TETO_USD, `gasto US$ ${gasto.usd} dentro do teto de US$ ${TETO_USD}`);
    provas.upload = srv.envios.map((e) => ({ objeto: e.objeto.replace(`${CLIENTE}/`, ""), bytes: e.total, partes: e.partes.length }));
    await writeFile(path.join(PASTA, "provas.json"), JSON.stringify(provas, null, 1));
    log(`PASSOU. Gasto US$ ${gasto.usd.toFixed(4)}. Provas em ${path.join(PASTA, "provas.json")}; quadros em ${QUADROS}`);
  } finally {
    srv.fechar();
    await db.close();
  }
}

principal().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
