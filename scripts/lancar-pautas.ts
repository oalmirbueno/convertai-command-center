/**
 * Lançador de pautas prontas, SEM IA (24/10/2026, dono: "lançar cerca de 200 peças escritas fora do painel
 * sem gastar a carteira de IA"). Para cada peça do JSON:
 *
 * - tarefa da Agenda pelo MESMO serviço do MCP e do `gravar` do Mês (createEditorialItem: id determinístico
 *   pela chave, source `mcp:editorial:<hash>`, auditoria em mcp_audit_log), com a descrição legível;
 * - carrossel: estudio_trabalhos `dirigido` com a direção completa de cada lâmina (capa como card 1), no
 *   formato do `gravar` (direcaoDoRoteiro + promptDaLamina, sem IA): o Estúdio abre pronto para Gerar ou para
 *   o Template Profile, sem o diretor de arte reescrever nada;
 * - reel: tarefa de vídeo (delivery_type video, caminho "gravar") e o roteiro pronto em `roteiros` pela mesma
 *   lógica de roteiro_criar + versao_salvar (versão 1 rascunho em branco, versão 2 o texto pronto, custo 0).
 *
 * Nada aqui chama IA nem debita carteira. As capas NÃO são PNG: saem no formato da casa pelo Estúdio.
 *
 * Uso (na raiz do repo):
 *   deno run -A scripts/lancar-pautas.ts pautas.json --dry-run
 *   deno run -A scripts/lancar-pautas.ts pautas.json --apenas 2
 *   deno run -A scripts/lancar-pautas.ts pautas.json
 *   deno run -A scripts/lancar-pautas.ts --arquivar-antigas --de 2026-10-28 --ate 2026-12-29 --dry-run
 *   deno run -A scripts/lancar-pautas.ts --arquivar-ids <task_id>,<task_id>
 * Opções: --env <arquivo> (padrão .env.migracao na raiz: TARGET_URL e TARGET_SERVICE_KEY), --cliente <uuid>,
 *   --projeto <uuid>, --autor <uuid> (padrão: o primeiro admin, o mesmo do agendador da Mesa),
 *   --confirmar-arte (arquiva também peça com arte já feita no Estúdio, sem aprovação nem post agendado).
 * A chave de serviço só vive no processo: nunca é impressa nem gravada.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const CLIENTE_PADRAO = "4dd691a7-d481-451f-800b-5e6b6fdc8721"; // AcelerIQ
const PROJETO_PADRAO = "f99f5957-f67b-4ef3-8acc-d1540ba7d87d"; // Aceleriq | Instagram 5 mil | Set-Dez 2026
const PRINCIPAL = "mesa:lancar-pautas";
const ORIGEM_NA_DESCRICAO = "Origem: lançador de pautas";
const FUSO_OFFSET = "-03:00"; // America/Sao_Paulo (sem horário de verão desde 2019)

// Limites (os do painel: título da tarefa 200, descrição 4000, legenda do Instagram 2200, roteiro e lâminas
// do diretor de arte; até 20 lâminas por carrossel com a capa).
export const LIMITES = {
  serie: 80,
  titulo: 200,
  gancho: 300,
  palavra_gigante: 40,
  frase: 160,
  numero: 12,
  laminas_min: 2,
  laminas_max: 19,
  lamina_papel: 30,
  lamina_titulo: 120,
  lamina_texto: 600,
  lamina_visual: 600,
  lamina_layout: 300,
  roteiro: 8000,
  legenda: 2200,
  cta: 280,
  palavra_comentario: 40,
  hashtags: 12,
  hashtag: 40,
  descricao: 4000,
} as const;

const ZONAS = ["topo-esquerda", "topo-centro", "centro-esquerda", "centro", "base-esquerda", "base-centro", "base-direita", "coluna-esquerda", "coluna-direita"];

type Layout = {
  zona_texto?: string;
  alinhamento?: "esquerda" | "centro" | "direita";
  imagem?: string;
  ponto_focal?: string;
  fundo?: string;
  tratamento?: string;
  cor_fundo?: string;
  cor_texto?: string;
  cor_destaque?: string;
};
export type Lamina = { papel: string; titulo: string; texto: string; visual: string; layout: Layout | string | null };
export type Peca = {
  data: string;
  hora: string;
  formato: "carrossel" | "reel";
  serie: string;
  titulo: string;
  gancho: string;
  capa: { palavra_gigante: string; frase: string; numero: string | null; visual: string; layout: Layout | string | null };
  laminas: Lamina[];
  roteiro: string;
  legenda: string;
  cta: string;
  palavra_comentario: string;
  hashtags: string[];
};

// ------------------------------------------------------------------ leitura e validação (puras)

const texto = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : typeof v === "number" ? String(v) : "");

function dataReal(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function lerLayout(v: unknown, erros: string[], onde: string): Layout | string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    if (v.length > LIMITES.lamina_layout) erros.push(`${onde}.layout passa de ${LIMITES.lamina_layout} caracteres`);
    return v.trim();
  }
  if (typeof v !== "object" || Array.isArray(v)) {
    erros.push(`${onde}.layout precisa ser texto ou objeto`);
    return null;
  }
  const o = v as Record<string, unknown>;
  const l: Layout = {};
  for (const k of ["zona_texto", "alinhamento", "imagem", "ponto_focal", "fundo", "tratamento", "cor_fundo", "cor_texto", "cor_destaque"] as const) {
    const s = texto(o[k]);
    if (!s) continue;
    if (s.length > LIMITES.lamina_layout) erros.push(`${onde}.layout.${k} passa de ${LIMITES.lamina_layout} caracteres`);
    (l as Record<string, string>)[k] = s;
  }
  if (l.zona_texto && ZONAS.indexOf(l.zona_texto) < 0) erros.push(`${onde}.layout.zona_texto precisa ser uma de: ${ZONAS.join(", ")}`);
  if (l.alinhamento && ["esquerda", "centro", "direita"].indexOf(l.alinhamento) < 0) erros.push(`${onde}.layout.alinhamento precisa ser esquerda, centro ou direita`);
  return l;
}

export function lerPeca(bruto: unknown, i: number): { peca: Peca | null; erros: string[] } {
  const erros: string[] = [];
  const onde = `peça ${i + 1}`;
  if (!bruto || typeof bruto !== "object") return { peca: null, erros: [`${onde}: não é um objeto`] };
  const o = bruto as Record<string, unknown>;
  const campo = (k: string, max: number, obrigatorio = true) => {
    const s = texto(o[k]);
    if (obrigatorio && !s) erros.push(`${onde}: ${k} é obrigatório`);
    if (s.length > max) erros.push(`${onde}: ${k} passa de ${max} caracteres (${s.length})`);
    return s;
  };
  const data = texto(o.data);
  if (!dataReal(data)) erros.push(`${onde}: data precisa ser AAAA-MM-DD real`);
  const hora = texto(o.hora);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) erros.push(`${onde}: hora precisa ser HH:MM`);
  const formato = texto(o.formato).toLowerCase();
  if (formato !== "carrossel" && formato !== "reel") erros.push(`${onde}: formato precisa ser "carrossel" ou "reel"`);
  const serie = campo("serie", LIMITES.serie);
  const titulo = campo("titulo", LIMITES.titulo);
  const gancho = campo("gancho", LIMITES.gancho);
  const legenda = campo("legenda", LIMITES.legenda);
  const cta = campo("cta", LIMITES.cta);
  const palavra = campo("palavra_comentario", LIMITES.palavra_comentario, false);
  const hashtags = (Array.isArray(o.hashtags) ? o.hashtags : typeof o.hashtags === "string" ? o.hashtags.split(/[\s,]+/) : [])
    .map((h) => texto(h)).filter(Boolean).map((h) => (h.charAt(0) === "#" ? h : `#${h}`).replace(/\s+/g, ""));
  if (hashtags.length > LIMITES.hashtags) erros.push(`${onde}: no máximo ${LIMITES.hashtags} hashtags`);
  if (hashtags.some((h) => h.length > LIMITES.hashtag)) erros.push(`${onde}: hashtag passa de ${LIMITES.hashtag} caracteres`);
  if (o.arquivo_capa) erros.push(`AVISO ${onde}: arquivo_capa foi ignorado (a capa sai no formato da casa pelo Estúdio)`);

  const c = (o.capa && typeof o.capa === "object" ? o.capa : {}) as Record<string, unknown>;
  const capa = {
    palavra_gigante: texto(c.palavra_gigante),
    frase: texto(c.frase),
    numero: texto(c.numero) || null,
    visual: texto(c.visual),
    layout: lerLayout(c.layout, erros, `${onde}: capa`),
  };
  const laminas: Lamina[] = [];
  let roteiro = "";
  if (formato === "carrossel") {
    if (!capa.palavra_gigante) erros.push(`${onde}: capa.palavra_gigante é obrigatória no carrossel`);
    if (!capa.frase) erros.push(`${onde}: capa.frase é obrigatória no carrossel`);
    if (capa.palavra_gigante.length > LIMITES.palavra_gigante) erros.push(`${onde}: capa.palavra_gigante passa de ${LIMITES.palavra_gigante}`);
    if (capa.frase.length > LIMITES.frase) erros.push(`${onde}: capa.frase passa de ${LIMITES.frase}`);
    if (capa.numero && capa.numero.length > LIMITES.numero) erros.push(`${onde}: capa.numero passa de ${LIMITES.numero}`);
    if (capa.visual.length > LIMITES.lamina_visual) erros.push(`${onde}: capa.visual passa de ${LIMITES.lamina_visual}`);
    const lista = Array.isArray(o.laminas) ? o.laminas : [];
    if (lista.length < LIMITES.laminas_min || lista.length > LIMITES.laminas_max) erros.push(`${onde}: o carrossel precisa de ${LIMITES.laminas_min} a ${LIMITES.laminas_max} lâminas além da capa (veio ${lista.length})`);
    lista.forEach((l, k) => {
      const ondeL = `${onde}: laminas[${k}]`;
      // Compatível com a forma antiga (lista de textos): o texto vira o título e o resto.
      const x = (typeof l === "string" ? { titulo: l.split("\n")[0], texto: l.split("\n").slice(1).join("\n") } : l && typeof l === "object" ? l : {}) as Record<string, unknown>;
      const lam: Lamina = {
        papel: texto(x.papel) || (k === lista.length - 1 ? "cta" : "conteudo"),
        titulo: texto(x.titulo),
        texto: texto(x.texto),
        visual: texto(x.visual),
        layout: lerLayout(x.layout, erros, ondeL),
      };
      if (!lam.titulo && !lam.texto) erros.push(`${ondeL}: título ou texto é obrigatório`);
      if (lam.papel.length > LIMITES.lamina_papel) erros.push(`${ondeL}: papel passa de ${LIMITES.lamina_papel}`);
      if (lam.titulo.length > LIMITES.lamina_titulo) erros.push(`${ondeL}: titulo passa de ${LIMITES.lamina_titulo} (${lam.titulo.length})`);
      if (lam.texto.length > LIMITES.lamina_texto) erros.push(`${ondeL}: texto passa de ${LIMITES.lamina_texto} (${lam.texto.length})`);
      if (lam.visual.length > LIMITES.lamina_visual) erros.push(`${ondeL}: visual passa de ${LIMITES.lamina_visual}`);
      laminas.push(lam);
    });
  } else if (formato === "reel") {
    roteiro = campo("roteiro", LIMITES.roteiro);
  }
  const reais = erros.filter((e) => !e.startsWith("AVISO "));
  if (reais.length) return { peca: null, erros };
  return {
    peca: { data, hora, formato: formato as Peca["formato"], serie, titulo, gancho, capa, laminas, roteiro, legenda, cta, palavra_comentario: palavra, hashtags },
    erros,
  };
}

// ------------------------------------------------------------------ descrição da Agenda (pura)

const PAPEL_LEGIVEL = (p: string) => p.replace(/_/g, " ");

function textoDaLamina(l: Pick<Lamina, "titulo" | "texto">): string {
  return [l.titulo, l.texto].filter(Boolean).join("\n");
}

/** Descrição legível da tarefa, no formato que a Agenda e o Estúdio já leem ("Roteiro dos cards:", "Card N (função):"). */
export function descricaoDaPeca(p: Peca, chave: string): string {
  const cabeca = [
    `Tema: ${p.titulo}`,
    `Formato: ${p.formato === "reel" ? "Vídeo rápido (Estúdio)" : "Carrossel"}`,
    `Série: ${p.serie}`,
    `Horário sugerido: ${p.hora}`,
    ...(p.palavra_comentario ? [`Palavra para comentar: ${p.palavra_comentario}`] : []),
    "",
    `Gancho: ${p.gancho}`,
  ];
  const corpo: string[] = [];
  if (p.formato === "carrossel") {
    const capa = [p.capa.numero, p.capa.palavra_gigante, p.capa.frase].filter(Boolean).join(" | ");
    corpo.push("", `Capa: ${capa}`, "", "Roteiro dos cards:");
    corpo.push(`Card 1 (capa): ${[p.capa.numero, p.capa.palavra_gigante, p.capa.frase].filter(Boolean).join(" / ")}`);
    if (p.capa.visual) corpo.push(`  Ilustração: ${p.capa.visual}`);
    p.laminas.forEach((l, k) => {
      corpo.push(`Card ${k + 2} (${PAPEL_LEGIVEL(l.papel)}): ${textoDaLamina(l).replace(/\n/g, " / ")}`);
      if (l.visual) corpo.push(`  Ilustração: ${l.visual}`);
    });
  } else {
    corpo.push("", "Caminho do vídeo: Gravar com roteiro", "", "Roteiro (completo na mesa de Roteiros):", p.roteiro);
  }
  const fim = ["", `CTA: ${p.cta}`, "", `Legenda (copy):\n${p.legenda}`, ...(p.hashtags.length ? ["", p.hashtags.join(" ")] : []), "", `${ORIGEM_NA_DESCRICAO}, chave ${chave}.`];
  const completo = [...cabeca, ...corpo, ...fim].join("\n").trim();
  if (completo.length <= LIMITES.descricao) return completo;
  // Sem espaço: o roteiro do reel (que mora inteiro em `roteiros`) e depois a legenda (inteira no Estúdio) encurtam.
  const aviso = "\n[Texto cortado para caber na Agenda; completo no Estúdio ou na mesa de Roteiros.]";
  const sobra = completo.length - LIMITES.descricao + aviso.length;
  if (p.formato === "reel" && p.roteiro.length > sobra + 200) {
    return descricaoDaPeca({ ...p, roteiro: p.roteiro.slice(0, p.roteiro.length - sobra).trimEnd() + aviso }, chave).slice(0, LIMITES.descricao);
  }
  if (p.legenda.length > sobra + 200) {
    return descricaoDaPeca({ ...p, legenda: p.legenda.slice(0, p.legenda.length - sobra).trimEnd() + aviso }, chave).slice(0, LIMITES.descricao);
  }
  return completo.slice(0, LIMITES.descricao - aviso.length) + aviso;
}

/** Chave de idempotência estável pela data, formato e título (a mesma peça não duplica). */
export async function chaveDaPeca(p: Pick<Peca, "data" | "formato" | "titulo">): Promise<string> {
  const base = `${p.data}|${p.formato}|${p.titulo.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base)));
  return `lancar-pautas:${Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ------------------------------------------------------------------ roteiro do reel (puro)

/**
 * O roteiro em texto vira blocos: parágrafos separados por linha em branco; linha entre colchetes ou que começa
 * com "Cena:", "Visual:", "Tela:", "Texto na tela:" ou "B-roll:" é indicação de cena (não é fala).
 */
export function blocosDoRoteiro(roteiro: string): Array<{ funcao: string; fala: string; visual: string; texto_na_tela: string; broll: string; segundos: number }> {
  const paragrafos = roteiro.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const blocos = paragrafos.map((par, k) => {
    const fala: string[] = [];
    const visual: string[] = [];
    let tela = "";
    let broll = "";
    for (const linha of par.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const colchete = /^[[(](.+)[\])]$/.exec(linha);
      const rotulo = /^(cena|visual|câmera|camera|tela|texto na tela|b-?roll)\s*:\s*(.+)$/i.exec(linha);
      if (colchete) visual.push(colchete[1].trim());
      else if (rotulo) {
        const r = rotulo[1].toLowerCase();
        if (r === "tela" || r === "texto na tela") tela = rotulo[2].trim();
        else if (r.indexOf("roll") >= 0) broll = rotulo[2].trim();
        else visual.push(rotulo[2].trim());
      } else fala.push(linha);
    }
    const f = fala.join(" ");
    const palavras = f ? f.split(/\s+/).length : 0;
    return {
      funcao: k === 0 ? "Abertura" : k === paragrafos.length - 1 ? "Fechamento" : "Desenvolvimento",
      fala: f,
      visual: visual.join("; ") || "a definir",
      texto_na_tela: tela,
      broll,
      segundos: Math.max(2, Math.round(palavras / 2.5)),
    };
  });
  return blocos.filter((b) => b.fala || b.visual !== "a definir");
}

// ------------------------------------------------------------------ argumentos

function lerArgs(argv: string[]) {
  const a: Record<string, string | boolean> = {};
  const soltos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s.startsWith("--")) {
      const nome = s.slice(2);
      const prox = argv[i + 1];
      if (["dry-run", "arquivar-antigas", "confirmar-arte"].indexOf(nome) >= 0) a[nome] = true;
      else if (prox !== undefined) { a[nome] = prox; i++; }
    } else soltos.push(s);
  }
  return { a, soltos };
}

function lerEnv(caminho: string): { url: string; chave: string } {
  let url = Deno.env.get("TARGET_URL") || "";
  let chave = Deno.env.get("TARGET_SERVICE_KEY") || "";
  try {
    for (const linha of Deno.readTextFileSync(caminho).split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(linha);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (m[1] === "TARGET_URL" && !url) url = v;
      if (m[1] === "TARGET_SERVICE_KEY" && !chave) chave = v;
    }
  } catch {
    // sem arquivo: só as variáveis de ambiente
  }
  if (!url || !chave) throw new Error(`Faltam TARGET_URL e TARGET_SERVICE_KEY (arquivo ${caminho} ou variáveis de ambiente).`);
  return { url, chave };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------ principal

async function main() {
  const { a, soltos } = lerArgs(Deno.args);
  const seco = a["dry-run"] === true;
  const clienteId = String(a.cliente || CLIENTE_PADRAO);
  const projetoId = String(a.projeto || PROJETO_PADRAO);
  if (!UUID.test(clienteId) || !UUID.test(projetoId)) throw new Error("--cliente e --projeto precisam ser UUID.");
  const env = lerEnv(String(a.env || ".env.migracao"));
  // Os serviços compartilhados (MCP, auditoria) leem a chave do ambiente do processo; só aqui dentro.
  Deno.env.set("SUPABASE_URL", env.url);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", env.chave);
  const db = createClient(env.url, env.chave, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as SupabaseClient;

  const autor = String(a.autor || "") || await primeiroAdmin(db);
  if (!UUID.test(autor)) throw new Error("Não achei o autor (admin). Passe --autor <uuid>.");

  if (a["arquivar-antigas"] === true || a["arquivar-ids"]) {
    await arquivar(db, { clienteId, autor, seco, de: String(a.de || "2026-10-28"), ate: String(a.ate || "2026-12-29"), ids: a["arquivar-ids"] ? String(a["arquivar-ids"]).split(",").map((s) => s.trim()).filter(Boolean) : null, confirmarArte: a["confirmar-arte"] === true });
    return;
  }

  const arquivo = soltos[0];
  if (!arquivo) throw new Error("Passe o arquivo JSON das peças (lista ou { pecas: [...] }).");
  const bruto = JSON.parse(Deno.readTextFileSync(arquivo));
  const lista = Array.isArray(bruto) ? bruto : Array.isArray(bruto?.pecas) ? bruto.pecas : null;
  if (!lista) throw new Error("O JSON precisa ser uma lista de peças ou { pecas: [...] }.");
  const pecas: Peca[] = [];
  const todosErros: string[] = [];
  lista.forEach((x: unknown, i: number) => {
    const r = lerPeca(x, i);
    todosErros.push(...r.erros);
    if (r.peca) pecas.push(r.peca);
  });
  const avisos = todosErros.filter((e) => e.startsWith("AVISO "));
  const erros = todosErros.filter((e) => !e.startsWith("AVISO "));
  for (const w of avisos) console.log(w);
  if (erros.length) {
    console.error(`${erros.length} erro(s) no JSON; nada foi lançado:`);
    for (const e of erros) console.error(`- ${e}`);
    Deno.exit(1);
  }
  const apenas = a.apenas ? Math.max(1, Number(a.apenas) || 1) : pecas.length;
  const lote = pecas.slice(0, apenas);

  // Projeto do cliente e config do fim de semana (aviso, nunca muda a data).
  const { data: projeto } = await db.from("projects").select("id, client_id, deleted_at, name").eq("id", projetoId).maybeSingle();
  const pj = projeto as { client_id: string; deleted_at: string | null; name: string } | null;
  if (!pj || pj.deleted_at || pj.client_id !== clienteId) throw new Error("O projeto não é deste cliente ou está arquivado.");
  const { data: cfg } = await db.from("mesa_cliente_config").select("postar_fim_de_semana, posts_por_dia").eq("client_id", clienteId).maybeSingle();
  const fds = (cfg as { postar_fim_de_semana?: boolean } | null)?.postar_fim_de_semana === true;

  console.log(`${seco ? "[dry-run] " : ""}${lote.length} de ${pecas.length} peça(s) para "${pj.name}". Fim de semana ${fds ? "liberado" : "NÃO liberado"} no cliente.`);
  const resultado: Array<Record<string, unknown>> = [];
  for (const p of lote) {
    const chave = await chaveDaPeca(p);
    const descricao = descricaoDaPeca(p, chave);
    const dow = new Date(`${p.data}T12:00:00Z`).getUTCDay();
    if (!fds && (dow === 0 || dow === 6)) console.log(`AVISO ${p.data} é fim de semana e o cliente não posta no fim de semana; a data fica como pedida.`);
    if (seco) {
      console.log(`\n--- ${p.data} ${p.hora} · ${p.formato} · ${p.titulo}\nchave ${chave} · descrição ${descricao.length} caracteres${p.formato === "carrossel" ? ` · ${p.laminas.length + 1} lâminas` : ""}`);
      console.log(descricao.split("\n").slice(0, 14).join("\n"));
      resultado.push({ titulo: p.titulo, data: p.data, chave, situacao: "dry-run" });
      continue;
    }
    resultado.push(await lancarUma(db, p, { clienteId, projetoId, autor, chave, descricao }));
  }
  console.log("\nResumo:");
  for (const r of resultado) console.log(JSON.stringify(r));
}

async function primeiroAdmin(db: SupabaseClient): Promise<string> {
  const { data } = await db.from("user_roles").select("user_id").eq("role", "admin").order("user_id").limit(1);
  return ((data ?? []) as Array<{ user_id: string }>)[0]?.user_id ?? "";
}

async function lancarUma(
  db: SupabaseClient,
  p: Peca,
  e: { clienteId: string; projetoId: string; autor: string; chave: string; descricao: string },
): Promise<Record<string, unknown>> {
  const { createEditorialItem, createEditorialItemSchema, WriteError } = await import("../supabase/functions/_shared/mcp-write-services.ts");
  const { auditLog } = await import("../supabase/functions/_shared/mcp-audit.ts");
  const correlationId = crypto.randomUUID();
  const entrada = {
    client_id: e.clienteId,
    project_id: e.projetoId,
    title: p.titulo.slice(0, LIMITES.titulo),
    description: e.descricao,
    format: p.formato === "reel" ? "video" as const : "carousel" as const,
    due_date: p.data,
    priority: "medium" as const,
    idempotency_key: e.chave,
  };
  const inicio = Date.now();
  let taskId: string;
  let situacao: string;
  try {
    const r = await createEditorialItem(createEditorialItemSchema.parse(entrada), {
      keyId: PRINCIPAL,
      origin: "script:lancar-pautas",
      correlationId,
      dataScope: { unrestricted: false, clientIds: [e.clienteId], principalUserId: e.autor, source: "oauth" } as never,
      resultRefHolder: {},
    });
    taskId = String((r.record as Record<string, unknown>).id);
    situacao = r.replayed ? "ja_lancada" : "criada";
    await auditLog({
      correlationId, toolName: "aceleriq_create_editorial_item", origin: "script:lancar-pautas",
      keyId: `${PRINCIPAL}:${e.autor}`, scopes: ["editorial:write"],
      input: { ...entrada, description: "[pauta pronta do lançador]" },
      success: true, statusCode: 200, durationMs: Date.now() - inicio, resultRef: taskId,
    });
  } catch (err) {
    const conflito = err instanceof WriteError && (err as { code?: string }).code === "conflict";
    const msg = err instanceof Error ? err.message : String(err);
    await auditLog({
      correlationId, toolName: "aceleriq_create_editorial_item", origin: "script:lancar-pautas",
      keyId: `${PRINCIPAL}:${e.autor}`, scopes: ["editorial:write"],
      input: { ...entrada, description: "[pauta pronta do lançador]" },
      success: false, statusCode: conflito ? 409 : 500, durationMs: Date.now() - inicio,
      errorCode: conflito ? "conflict" : "handler_error", errorMessage: msg,
    });
    return { titulo: p.titulo, data: p.data, situacao: conflito ? "ja_lancada_com_outro_texto" : "erro", erro: msg.slice(0, 300) };
  }
  const extra = p.formato === "carrossel" ? await criarDirecao(db, p, taskId, e) : await criarRoteiro(db, p, taskId, e);
  return { titulo: p.titulo, data: p.data, formato: p.formato, task_id: taskId, situacao, ...extra };
}

/** Direção do Estúdio sem IA, no formato do `gravar` (criarDirecoesDoRoteiro), com cada lâmina exatamente como veio. */
async function criarDirecao(db: SupabaseClient, p: Peca, taskId: string, e: { clienteId: string; autor: string }) {
  const { data: existente } = await db.from("estudio_trabalhos").select("id").eq("client_id", e.clienteId).eq("task_id", taskId).limit(1);
  const jaTem = ((existente ?? []) as Array<{ id: string }>)[0];
  if (jaTem) return { trabalho_id: jaTem.id, estudio: "ja_tinha" };
  const direcao = await montarDirecao(db, p, taskId, e.clienteId);
  const { data: modelo } = await db.from("ia_modelos").select("id").eq("ativo", true).contains("padrao_para", ["imagem"]).limit(1);
  const modeloId = ((modelo ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  if (!modeloId) return { estudio: "sem_modelo_de_imagem_padrao" };
  const { data, error } = await db.from("estudio_trabalhos").insert({
    client_id: e.clienteId,
    task_id: taskId,
    status: "dirigido",
    direcao,
    modelo_imagem_id: modeloId,
    qualidade: "media",
    cards: [],
    custo_usd: 0,
    criado_por: e.autor,
    legenda: p.legenda,
    hashtags: p.hashtags,
    // Sugestão de horário (não confirma nada: a Entrega pede a confirmação de sempre).
    publicar_em: `${p.data}T${p.hora}:00${FUSO_OFFSET}`,
  }).select("id").single();
  if (error) return { estudio: "erro", erro: error.message };
  return { trabalho_id: (data as { id: string }).id, estudio: "dirigido", laminas: (direcao.cards as unknown[]).length };
}

/** Monta a direção (pura sobre a marca lida do banco): direcaoDoRoteiro do painel e, por cima, o que a peça trouxe. */
export async function montarDirecao(db: SupabaseClient, p: Peca, taskId: string | null, clienteId: string): Promise<Record<string, unknown>> {
  const arte = await import("../supabase/functions/_shared/direcao-arte.ts");
  const { resolverMarca, lerMarcaParaDirecaoDaMarca } = await import("../supabase/functions/_shared/marca.ts");
  const marca = await lerMarcaParaDirecaoDaMarca(db as never, clienteId, taskId ? await resolverMarca(db as never, clienteId, { task_id: taskId }) : null);
  const capaTexto = [p.capa.numero, p.capa.palavra_gigante, p.capa.frase].filter(Boolean).join("\n");
  const entradas = [
    { ordem: 1, funcao: "capa", texto: capaTexto, ilustracao: p.capa.visual || undefined, layout: p.capa.layout, papel: "capa" },
    ...p.laminas.map((l, k) => ({ ordem: k + 2, funcao: /cta|chamada/i.test(l.papel) ? "cta" : "conteudo", texto: textoDaLamina(l), ilustracao: l.visual || undefined, layout: l.layout, papel: l.papel })),
  ];
  const conceito = `Série "${p.serie}". ${p.titulo}. Gancho: ${p.gancho}`.slice(0, 900);
  const levaLogo = (ordem: number, total: number) => ordem === 1 || ordem === total;
  const base = arte.direcaoDoRoteiro(entradas, marca, { postUnico: false, carrosselInfinito: false, conceito, levaLogo });
  const total = base.cards.length;
  base.cards = base.cards.map((card, i) => {
    const ent = entradas[i];
    const lam = i === 0 ? null : p.laminas[i - 1];
    // Blocos exatos: capa = número + palavra gigante (headline) + frase; lâmina = título (headline) + texto.
    const blocos = i === 0
      ? [
        ...(p.capa.numero ? [{ papel: "numero" as const, texto: p.capa.numero }] : []),
        { papel: "headline" as const, texto: p.capa.palavra_gigante },
        { papel: "subtitulo" as const, texto: p.capa.frase },
      ]
      : [
        ...(lam!.titulo ? [{ papel: "headline" as const, texto: lam!.titulo }] : []),
        ...(lam!.texto ? [{ papel: (card.funcao === "cta" ? "cta" : "apoio") as "cta" | "apoio", texto: lam!.texto }] : []),
      ];
    const pedido = ent.layout;
    const parcial = typeof pedido === "string"
      ? (ZONAS.indexOf(pedido) >= 0 ? { zona_texto: pedido } : { tratamento: `${pedido}; ${card.layout?.tratamento ?? ""}` })
      : pedido ?? {};
    const layout = arte.normalizarLayout({ ...card.layout, ...(ent.ilustracao ? { imagem: ent.ilustracao } : {}), ...parcial } as never, card.funcao, card.ordem, total);
    const novo = { ...card, blocos, layout, composicao: arte.resumoDaComposicao(layout), ilustracao: layout.imagem, papel_editorial: ent.papel };
    novo.prompt_imagem = arte.promptDaLamina(novo, marca, { total, carrosselInfinito: false, levaLogo: levaLogo(card.ordem, total), conceito });
    return novo;
  });
  return { ...base, lancador: { serie: p.serie, chave: await chaveDaPeca(p), hora: p.hora } };
}

/** Roteiro pronto pela lógica de roteiro_criar + versao_salvar (custo 0). */
async function criarRoteiro(db: SupabaseClient, p: Peca, taskId: string, e: { clienteId: string; autor: string }) {
  const rm = await import("../supabase/functions/_shared/roteiro-modelo.ts");
  const { data: existente } = await db.from("roteiros").select("id, versao_atual").eq("task_id", taskId).is("arquivado_em", null).limit(1);
  const ja = ((existente ?? []) as Array<{ id: string; versao_atual: number }>)[0];
  if (ja) return { roteiro_id: ja.id, roteiro: "ja_tinha" };
  const agora = new Date().toISOString();
  const titulo = p.titulo.slice(0, 140);
  const branco = rm.roteiroEmBranco(titulo, "fala_camera", null);
  const v1 = rm.novaVersao([], branco, { origem: "edicao", nota: "Rascunho em branco", criado_por: e.autor, agora });
  const conteudo = rm.normalizarRoteiro({
    titulo,
    subtitulo: p.gancho,
    tipo: "fala_camera",
    objetivo: `Série ${p.serie}`,
    formato: "9:16",
    ganchos: [{ texto: p.gancho, mecanismo: "", promessa: "", motivo: "" }],
    gancho_escolhido: 0,
    blocos: blocosDoRoteiro(p.roteiro),
    cta: p.cta,
    legenda: p.legenda,
    hashtags: p.hashtags,
    fontes: ["Pauta pronta do lançador (texto do dono, sem IA)"],
  }, { titulo, tipo: "fala_camera" });
  const v2 = rm.novaVersao(v1.versoes, conteudo, { origem: "edicao", nota: "Roteiro pronto (lançador de pautas)", criado_por: e.autor, agora });
  const { data, error } = await db.from("roteiros").insert({
    client_id: e.clienteId,
    task_id: taskId,
    proposta_id: null,
    campanha_id: null,
    titulo: v2.versao.conteudo.titulo,
    tipo: v2.versao.conteudo.tipo,
    status: "rascunho",
    versao_atual: v2.versao.numero,
    versoes: v2.versoes,
    comentarios: [],
    custo_usd: 0,
    criado_por: e.autor,
  }).select("id").single();
  if (error) return { roteiro: "erro", erro: error.message };
  return { roteiro_id: (data as { id: string }).id, roteiro: "criado", blocos: v2.versao.conteudo.blocos.length };
}

/**
 * Arquiva (nunca apaga) as peças da Agenda: tarefa com deleted_at (o mesmo do "apagar" da tela, que se desfaz
 * com restaurar_item_agenda), a direção do Estúdio marcada como arquivada e o roteiro com arquivado_em. As
 * mesmas travas da tela: publicação agendada ou no ar, arte aprovada ou agendada, ou arte já feita sem
 * --confirmar-arte, ficam de fora com o motivo.
 */
async function arquivar(
  db: SupabaseClient,
  e: { clienteId: string; autor: string; seco: boolean; de: string; ate: string; ids: string[] | null; confirmarArte: boolean },
) {
  const { auditLog } = await import("../supabase/functions/_shared/mcp-audit.ts");
  const { data: projetos } = await db.from("projects").select("id").eq("client_id", e.clienteId);
  const pids = ((projetos ?? []) as Array<{ id: string }>).map((x) => x.id);
  let q = db.from("tasks").select("id, title, due_date, delivery_type, description, source, deleted_at").in("project_id", pids).is("deleted_at", null).not("delivery_type", "is", null);
  if (e.ids) q = q.in("id", e.ids);
  else q = q.gte("due_date", e.de).lte("due_date", e.ate);
  const { data: tarefas, error } = await q.order("due_date").limit(500);
  if (error) throw new Error(error.message);
  // Sem ids: só as antigas (o que o lançador criou não entra).
  const lista = ((tarefas ?? []) as Array<{ id: string; title: string; due_date: string; delivery_type: string; description: string | null; source: string | null }>)
    .filter((t) => e.ids || String(t.description || "").indexOf(ORIGEM_NA_DESCRICAO) < 0);
  console.log(`${e.seco ? "[dry-run] " : ""}${lista.length} peça(s) ${e.ids ? "pedidas" : `de ${e.de} a ${e.ate}`}:`);
  const feitos: Array<Record<string, unknown>> = [];
  for (const t of lista) {
    const motivo = await motivoParaNaoArquivar(db, e.clienteId, t, e.confirmarArte);
    const linha = { task_id: t.id, data: t.due_date, formato: t.delivery_type, titulo: t.title };
    if (motivo) {
      console.log(`FICA  ${t.due_date} ${t.id} ${t.title} (${motivo})`);
      feitos.push({ ...linha, situacao: "ficou", motivo });
      continue;
    }
    console.log(`${e.seco ? "SAI?" : "SAI "}  ${t.due_date} ${t.id} ${t.title}`);
    if (e.seco) continue;
    const agora = new Date().toISOString();
    const { error: erroT } = await db.from("tasks").update({ deleted_at: agora }).eq("id", t.id).is("deleted_at", null);
    if (erroT) {
      feitos.push({ ...linha, situacao: "erro", erro: erroT.message });
      continue;
    }
    const { data: trabs } = await db.from("estudio_trabalhos").select("id, direcao").eq("client_id", e.clienteId).eq("task_id", t.id);
    for (const w of (trabs ?? []) as Array<{ id: string; direcao: Record<string, unknown> }>) {
      await db.from("estudio_trabalhos").update({ direcao: { ...(w.direcao || {}), arquivado_em: agora, arquivado_motivo: "Substituída pelas pautas prontas (lançador)" } }).eq("id", w.id);
    }
    await db.from("roteiros").update({ arquivado_em: agora, arquivado_por: e.autor }).eq("task_id", t.id).is("arquivado_em", null);
    await auditLog({
      correlationId: crypto.randomUUID(), toolName: "mesa_apagar_item_da_agenda", origin: "script:lancar-pautas",
      keyId: `${PRINCIPAL}:${e.autor}`, scopes: ["editorial:write"],
      input: { client_id: e.clienteId, task_id: t.id, arquivado: true, motivo: "substituida_pelas_pautas_prontas" },
      success: true, statusCode: 200, durationMs: 0, resultRef: t.id,
    });
    feitos.push({ ...linha, situacao: "arquivada", estudio: ((trabs ?? []) as unknown[]).length });
  }
  console.log("\nResumo:");
  for (const f of feitos) console.log(JSON.stringify(f));
}

async function motivoParaNaoArquivar(db: SupabaseClient, clienteId: string, t: { id: string; source: string | null }, confirmarArte: boolean): Promise<string | null> {
  const { requestIdFromTaskSource } = await import("../supabase/functions/_shared/mcp-write-services.ts");
  if (requestIdFromTaskSource(t.source)) return "veio de pedido do cliente";
  const { data: vinculo } = await db.from("editorial_post_internal").select("post_id").eq("task_id", t.id).maybeSingle();
  const postId = (vinculo as { post_id?: string } | null)?.post_id ?? null;
  if (postId) {
    const { data: pubs } = await db.from("editorial_publications").select("status").eq("post_id", postId).in("status", ["scheduled", "published"]).limit(1);
    const pub = ((pubs ?? []) as Array<{ status: string }>)[0];
    if (pub) return pub.status === "published" ? "já publicada" : "publicação agendada (cancele na Agenda antes)";
  }
  const { data: trabs } = await db.from("estudio_trabalhos").select("status, entrega_status, cards").eq("client_id", clienteId).eq("task_id", t.id).limit(5);
  const lista = (trabs ?? []) as Array<{ status: string; entrega_status: string | null; cards: unknown }>;
  if (lista.some((w) => w.entrega_status === "aprovado" || w.entrega_status === "agendado")) return "arte aprovada ou agendada";
  if (lista.some((w) => w.status === "gerando")) return "arte sendo gerada agora";
  const temArte = lista.some((w) => ["pronto", "entregue"].indexOf(w.status) >= 0 || !!w.entrega_status || (Array.isArray(w.cards) && w.cards.length > 0));
  if (temArte && !confirmarArte) return "já tem arte no Estúdio (use --confirmar-arte)";
  if (postId) return "tem post na Agenda (arquive o post pela Agenda)";
  return null;
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`Falhou: ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  });
}
