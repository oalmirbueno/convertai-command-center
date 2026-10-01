/**
 * Conversão pura do catalogo.json / texturas.json (saída de tools/mockups) para as linhas
 * de public.mockup_catalogo e public.textura_catalogo, com os caminhos no bucket `mockups`.
 * Sem rede e sem disco: o subir_catalogo.mjs usa, e o teste src/test/mockups-catalogo.test.ts confere.
 */

export const BUCKET = "mockups";
export const ARQUIVOS_DO_CONJUNTO = ["base.jpg", "vazio.jpg", "ganho.png", "uv.png", "mapa.png"];
export const CATEGORIAS = [
  "papelaria", "cartao", "sacola", "caneca", "vestuario", "embalagem", "outdoor", "dispositivo",
  "poster", "veiculo", "logo-efeito", "folder", "livro", "fachada", "sinalizacao",
];
/** De onde veio o mockup: PSD pré-processado ou cena gerada por IA (mockup_de_ia.py). */
export const FONTES = ["psd", "ia"];
export const CATEGORIAS_DE_TEXTURA = ["grunge", "papel", "concreto", "fumaca", "carimbo", "outro"];
export const PAPEIS = ["arte", "logo", "cor", "verso"];

const ID = /^[a-z0-9][a-z0-9-]{1,79}$/;

/** Camada extra do fundo trocável (R = objeto, G = luz do fundo). */
export const ARQUIVO_DO_FUNDO = "fundo.png";

/** Caminhos de um mockup no bucket (com fundo trocável, mais o fundo.png de cada tamanho). */
export function caminhosDoMockup(id, comFundo = false) {
  const arquivos = comFundo ? ARQUIVOS_DO_CONJUNTO.concat([ARQUIVO_DO_FUNDO]) : ARQUIVOS_DO_CONJUNTO;
  const conjunto = (pasta) => Object.fromEntries(arquivos.map((f) => [f.split(".")[0], `catalogo/${id}/${pasta}/${f}`]));
  return { alta: conjunto("alta"), trabalho: conjunto("trabalho"), thumb: `catalogo/${id}/thumb.jpg` };
}

function numero(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function slotLimpo(s) {
  const indice = numero(s && s.indice, 1, 8);
  const papel = s && PAPEIS.includes(s.papel) ? s.papel : null;
  const area = Array.isArray(s && s.area_segura) && s.area_segura.length === 4 ? s.area_segura.map((x) => numero(x, 0, 1)) : null;
  if (!indice || !papel || !area || area.some((x) => x === null) || area[2] <= area[0] || area[3] <= area[1]) return null;
  const so = Array.isArray(s.so_px) ? s.so_px.map((x) => numero(x, 1, 20000)) : [null, null];
  return {
    indice,
    papel,
    nome: String(s.nome || "").slice(0, 80),
    so_px: so[0] && so[1] ? [Math.round(so[0]), Math.round(so[1])] : [1024, 1024],
    area_segura: area,
    luminancia_superficie: numero(s.luminancia_superficie, 0, 1),
    deformacao: String(s.deformacao || "warpNone").slice(0, 40),
    cobertura: numero(s.cobertura, 0, 1),
    px_na_tela: numero(s.px_na_tela, 1, 10000),
  };
}

/**
 * meta.json aprovado -> linha de mockup_catalogo. Devolve { linha } ou { erro } (nunca lança):
 * item com erro fica fora do envio e aparece no relatório.
 */
export function linhaDoCatalogo(meta) {
  if (!meta || typeof meta !== "object") return { erro: "meta vazio" };
  const id = String(meta.id || "");
  if (!ID.test(id)) return { erro: `id inválido: ${id}` };
  if (!meta.qualidade || meta.qualidade.aprovado !== true) return { erro: `${id}: não aprovado no controle de qualidade` };
  if (!CATEGORIAS.includes(meta.categoria)) return { erro: `${id}: categoria desconhecida ${meta.categoria}` };
  const slots = (Array.isArray(meta.slots) ? meta.slots : []).map(slotLimpo);
  if (!slots.length || slots.some((s) => !s)) return { erro: `${id}: slot inválido` };
  const largura = numero(meta.largura, 1, 6000);
  const altura = numero(meta.altura, 1, 6000);
  const lt = numero(meta.largura_trabalho, 1, 2048);
  const at = numero(meta.altura_trabalho, 1, 2048);
  if (!largura || !altura || !lt || !at) return { erro: `${id}: dimensões inválidas` };
  const bytes = meta.bytes || {};
  const fonte = FONTES.includes(meta.fonte) ? meta.fonte : "psd";
  const comFundo = meta.fundo_trocavel === true;
  const soma = (o) => Object.values(o || {}).reduce((t, v) => t + (Number(v) || 0), 0);
  return {
    linha: {
      id,
      nome: String(meta.nome || id).slice(0, 120),
      categoria: meta.categoria,
      tags: (Array.isArray(meta.tags) ? meta.tags : []).map((t) => String(t).slice(0, 40)).slice(0, 12),
      slots,
      largura: Math.round(largura),
      altura: Math.round(altura),
      largura_trabalho: Math.round(lt),
      altura_trabalho: Math.round(at),
      caminhos: caminhosDoMockup(id, comFundo),
      fonte,
      qualidade: {
        diferenca: numero(meta.qualidade.diferenca, 0, 255),
        diferenca_imagem: numero(meta.qualidade.diferenca_imagem, 0, 255),
        diferenca_slot: numero(meta.qualidade.diferenca_slot, 0, 255),
        limite: numero(meta.qualidade.limite, 0, 255),
        metodo: meta.qualidade.metodo ? String(meta.qualidade.metodo).slice(0, 200) : null,
        calibrado: !!meta.calibracao,
        avisos: Array.isArray(meta.qualidade.avisos) ? meta.qualidade.avisos.slice(0, 12) : [],
      },
      luminancia_media: numero(meta.luminancia_media, 0, 1),
      origem: meta.origem ? String(meta.origem).slice(0, 300) : null,
      versao_pipeline: Number(meta.versao_pipeline) || 1,
      bytes: soma(bytes.alta) + soma(bytes.trabalho) + (Number(bytes.thumb) || 0),
      // Curadoria (curadoria-catalogo.json): vista repetida sobe guardada, fora da tela.
      ativo: meta.ativo !== false,
    },
  };
}

/**
 * Aplica a curadoria (curadoria-catalogo.json) nos itens do catálogo: o id listado em
 * `inativos` sobe com ativo=false. Devolve uma cópia; o resto fica igual.
 */
export function aplicarCuradoria(itens, curadoria) {
  const inativos = (curadoria && curadoria.inativos) || {};
  return (itens || []).map((m) => (m && Object.prototype.hasOwnProperty.call(inativos, m.id) ? { ...m, ativo: false } : m));
}

/** Item de texturas.json -> linha de textura_catalogo. */
export function linhaDaTextura(t) {
  const id = String((t && t.id) || "");
  if (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(id)) return { erro: `textura com id inválido: ${id}` };
  if (!CATEGORIAS_DE_TEXTURA.includes(t.categoria)) return { erro: `${id}: categoria desconhecida` };
  const largura = numero(t.largura, 1, 4096);
  const altura = numero(t.altura, 1, 4096);
  if (!largura || !altura) return { erro: `${id}: dimensões inválidas` };
  return {
    linha: {
      id,
      nome: String(t.nome || id).slice(0, 120),
      categoria: t.categoria,
      largura: Math.round(largura),
      altura: Math.round(altura),
      caminho: `texturas/${id}.png`,
      caminho_mini: `texturas/${id}_mini.png`,
      cobertura: numero(t.cobertura, 0, 1),
      origem: t.origem ? String(t.origem).slice(0, 200) : null,
      bytes: Number(t.bytes) || 0,
      ativo: true,
    },
  };
}

/** Lista de envios (arquivo local -> caminho no bucket) de um mockup. */
export function enviosDoMockup(id, pastaLocal, comFundo = false) {
  const c = caminhosDoMockup(id, comFundo);
  const arquivos = comFundo ? ARQUIVOS_DO_CONJUNTO.concat([ARQUIVO_DO_FUNDO]) : ARQUIVOS_DO_CONJUNTO;
  const lista = [];
  for (const pasta of ["alta", "trabalho"]) {
    for (const f of arquivos) lista.push({ local: `${pastaLocal}/${pasta}/${f}`, destino: c[pasta][f.split(".")[0]] });
  }
  lista.push({ local: `${pastaLocal}/thumb.jpg`, destino: c.thumb });
  return lista;
}

export function tipoDoArquivo(caminho) {
  if (caminho.endsWith(".png")) return "image/png";
  if (caminho.endsWith(".jpg") || caminho.endsWith(".jpeg")) return "image/jpeg";
  return "application/json";
}
