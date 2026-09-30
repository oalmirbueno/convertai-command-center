/**
 * Pacote do site (frente SIT, 30/09/2026): tudo o que o agente de código
 * precisa saber do cliente, montado no servidor com a regra de herança da
 * marca (a marca que não é a principal nunca herda da outra). Vai dentro do
 * trabalho do motor; o worker escreve em .aceleriq/pacote.json e baixa a logo,
 * as fotos reais e as imagens geradas para public/ (logo e foto real entram
 * pelo código, nunca pelo gerador).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { kitComMarca, lerContextoDaMarca, lerMarcaParaDirecaoDaMarca, type MarcaDoCliente } from "./marca.ts";
import { coresValidas, type DnaDoSite, estiloDoPacote, type OpcaoDeCopy, type PacoteDoSite } from "./site-metodo.ts";
import { mapaDoSite, normalizarEstilo, secoesDoMapa } from "./site-biblioteca.ts";
import { integracoesDoPacote, normalizarIntegracoes, normalizarSeo, robotsTxt, schemaDoNegocio, urlDoSite } from "./site-lancamento.ts";
import { variantesDoMapa } from "./site-variantes.ts";
import { lerBaseDeDesign, lerSerieReal } from "./uiux/consultas.ts";
import { BASE_COMPLETA, apoioDoProduto, pacoteDaBaseDeDesign } from "./uiux/base-completa.ts";
import { coresDoSite } from "./uiux/apoio-da-paleta.ts";
import { fontesDoSite, urlDasFontesDoSite } from "./uiux/fontes-do-site.ts";

/** UXM (lacunas 4.1 e 4.2): as fontes do site moram em uiux/fontes-do-site.ts (sem banco). */
export { fontesDoSite, urlDasFontesDoSite };

/** Arquivo do Storage que o worker copia para dentro do projeto. */
export type ArquivoDoPacote = { bucket: string; path: string; destino: string };

export type LinhaDoSite = {
  id: string;
  client_id: string;
  marca_id: string | null;
  nome: string;
  projeto: string;
  etapa: string;
  briefing: Record<string, unknown>;
  referencias: unknown[];
  dna: Record<string, unknown>;
  direcao: Record<string, unknown>;
  conteudo: Record<string, unknown>;
  imagens: unknown[];
  revisao: Record<string, unknown>;
  publicacao: Record<string, unknown>;
  modelo: string | null;
  custo_usd: number;
  /** SIT2 (migration 20260930160000): podem faltar antes de aplicar. */
  tipo?: string | null;
  mapa?: Record<string, unknown> | null;
  estilo?: Record<string, unknown> | null;
  integracoes?: Record<string, unknown> | null;
  seo?: Record<string, unknown> | null;
  arquivado_em: string | null;
  criado_em: string;
  atualizado_em: string;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export type ImagemDoSite = { id: string; slot: string; origem: "gerada" | "real"; bucket: string; path: string; alt: string; custo_usd?: number; escolhida?: boolean; secao?: string | null };

export function imagensDoSite(lista: unknown): ImagemDoSite[] {
  return (Array.isArray(lista) ? lista : [])
    .map((b) => (b && typeof b === "object" ? (b as Record<string, unknown>) : null))
    .filter((b): b is Record<string, unknown> => !!b && typeof b.path === "string" && typeof b.id === "string")
    .map((b) => ({
      id: String(b.id),
      slot: String(b.slot || "secao"),
      origem: b.origem === "real" ? "real" : "gerada",
      bucket: String(b.bucket || "mesa"),
      path: String(b.path),
      alt: String(b.alt || "").slice(0, 200),
      custo_usd: Number(b.custo_usd) || 0,
      escolhida: b.escolhida !== false,
      secao: typeof b.secao === "string" && b.secao ? String(b.secao).slice(0, 48) : null,
    }));
}

/** A opção de copy escolhida (conteudo.escolhida = índice em conteudo.opcoes). */
export function copyEscolhida(conteudo: Record<string, unknown>): OpcaoDeCopy | null {
  const opcoes = Array.isArray(conteudo.opcoes) ? (conteudo.opcoes as OpcaoDeCopy[]) : [];
  const i = Number(conteudo.escolhida);
  return Number.isInteger(i) && i >= 0 && i < opcoes.length ? opcoes[i] : null;
}

const extensao = (path: string) => {
  const m = /\.([a-z0-9]{2,4})$/i.exec(path);
  return m ? m[1].toLowerCase() : "png";
};

export async function montarPacoteDoSite(db: SupabaseClient, site: LinhaDoSite, marca: MarcaDoCliente | null, secoes?: string[]): Promise<{ pacote: PacoteDoSite; arquivos: ArquivoDoPacote[] }> {
  const [kitBruto, direcaoDaMarca, contexto] = await Promise.all([
    db.from("cliente_kit_marca").select("paleta, logo_path, logo_file_id, estilo, regras, contexto").eq("client_id", site.client_id).maybeSingle(),
    lerMarcaParaDirecaoDaMarca(db, site.client_id, marca),
    lerContextoDaMarca(db, site.client_id, marca),
  ]);
  const kit = kitComMarca((kitBruto.data as Record<string, unknown> | null) ?? {}, marca) as Record<string, unknown>;
  const arquivos: ArquivoDoPacote[] = [];
  let logo: string | null = null;
  if (typeof kit.logo_path === "string" && kit.logo_path) {
    logo = `/marca/logo.${extensao(kit.logo_path)}`;
    arquivos.push({ bucket: "mesa", path: kit.logo_path, destino: `public${logo}` });
  }
  const imagens: PacoteDoSite["imagens"] = [];
  const fotos: PacoteDoSite["fotos_reais"] = [];
  const arquivoDaImagem = new Map<string, string>();
  imagensDoSite(site.imagens)
    .filter((i) => i.escolhida !== false)
    .forEach((img, n) => {
      const arquivo = `/imagens/${img.origem === "real" ? "foto" : img.slot}-${n + 1}.${extensao(img.path)}`;
      arquivos.push({ bucket: img.bucket, path: img.path, destino: `public${arquivo}` });
      arquivoDaImagem.set(img.id, arquivo);
      if (img.origem === "real") fotos.push({ arquivo, alt: img.alt, secao: img.secao || null });
      else imagens.push({ slot: img.slot, arquivo, alt: img.alt, secao: img.secao || null });
    });
  const c = contexto as Record<string, unknown>;
  const dna = site.dna && Array.isArray((site.dna as { atributos?: unknown }).atributos) ? (site.dna as unknown as DnaDoSite) : null;
  const mapa = mapaDoSite(site);
  const temMapaSalvo = !!(site.mapa && typeof site.mapa === "object" && Array.isArray((site.mapa as { paginas?: unknown }).paginas));
  const integracoes = normalizarIntegracoes(site.integracoes || {});
  const seo = normalizarSeo(site.seo || {});
  const publicacao = site.publicacao && typeof site.publicacao === "object" ? site.publicacao : {};
  const dominio = typeof publicacao.dominio === "string" ? publicacao.dominio : null;
  const url = urlDoSite(dominio);
  const heroi = imagens.find((i) => i.slot === "hero");
  const og = (seo.og_imagem && arquivoDaImagem.get(seo.og_imagem)) || (heroi ? heroi.arquivo : null) || logo;
  const copy = copyEscolhida(site.conteudo);
  const nomeDoCliente = direcaoDaMarca.nomeCliente || site.nome;
  const env = (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  const base = env ? String(env.env.get("SUPABASE_URL") || "").replace(/\/$/, "") : "";
  // UXM: a base de design da marca do site (produto, estilo, padrão, par), o apoio da paleta, as variantes do mapa e o gráfico.
  const baseDeDesign = lerBaseDeDesign(obj(site.direcao).base_de_design);
  const temBase = !!(baseDeDesign.produto || baseDeDesign.estilo || baseDeDesign.padrao || baseDeDesign.par);
  const parDaBase = baseDeDesign.par ? BASE_COMPLETA.pares.filter((x) => x.no === baseDeDesign.par!.id)[0] || null : null;
  const fontesEscolhidas = fontesDoSite(direcaoDaMarca.fontes, direcaoDaMarca.tipografiaCitada, parDaBase ? { titulo: parDaBase.titulo, texto: parDaBase.texto } : null);
  const paleta = direcaoDaMarca.paleta
    .filter((p) => coresValidas([p.hex]).length)
    .map((p) => ({ hex: coresValidas([p.hex])[0], nome: p.nome, papel: p.papel }))
    .slice(0, 8);
  const estilo = estiloDoPacote(normalizarEstilo(site.estilo || {}));
  const doSite = coresDoSite({ paleta, dna, estilo });
  // Uma regra só para o destaque: o apoio sai do MESMO destaque que o worker põe em --cor-destaque.
  const apoio = apoioDoProduto(paleta, baseDeDesign.produto ? baseDeDesign.produto.id : null, { fundo: doSite.fundo, texto: doSite.texto, destaque: doSite.destaque });
  const tipos = mapa.paginas.reduce((l: string[], p) => l.concat(p.secoes.map((x) => x.tipo)), mapa.globais.slice());
  // Sem escolha da base, o pacote ainda leva as regras de UX do mapa e as variantes (o apoio da paleta o motor calcula da marca).
  const base_de_design = pacoteDaBaseDeDesign(temBase ? baseDeDesign : null, { tipos, variantes: variantesDoMapa(mapa), apoio: temBase ? apoio : null, kitTemFontes: direcaoDaMarca.fontes.length > 0, serie: lerSerieReal(obj(site.conteudo).serie_real) });
  const pacote: PacoteDoSite = {
    cliente: nomeDoCliente,
    marca: {
      nome: direcaoDaMarca.nomeCliente,
      negocio: typeof c.negocio === "string" ? c.negocio.slice(0, 1200) : undefined,
      publico: typeof c.publico === "string" ? c.publico.slice(0, 1200) : undefined,
      oferta: typeof c.oferta === "string" ? c.oferta.slice(0, 1200) : undefined,
      tom: direcaoDaMarca.tomDeVoz || undefined,
      diferenciais: Array.isArray(c.diferenciais) ? (c.diferenciais as unknown[]).map((d) => String(d).slice(0, 240)).slice(0, 8) : undefined,
    },
    paleta,
    fontes: fontesEscolhidas.fontes,
    fontes_url: urlDasFontesDoSite(fontesEscolhidas.fontes),
    dna,
    direcao: {
      nicho: typeof site.direcao.nicho === "string" ? site.direcao.nicho : undefined,
      peca: typeof site.direcao.peca === "string" ? site.direcao.peca : mapa.paginas.length > 1 ? `site de ${mapa.paginas.length} páginas` : "site de uma página",
      referencia_de_nivel: typeof site.direcao.nivel === "string" ? site.direcao.nivel : undefined,
      observacao: typeof site.direcao.observacao === "string" ? site.direcao.observacao.slice(0, 1500) : undefined,
    },
    copy,
    imagens,
    fotos_reais: fotos,
    logo,
    secoes: secoes && secoes.length ? secoes : temMapaSalvo ? secoesDoMapa(mapa) : Array.isArray(site.direcao.secoes) && site.direcao.secoes.length ? (site.direcao.secoes as string[]) : secoesDoMapa(mapa),
    // SIT2: o template multipágina lê paginas e globais; o agente lê o mapa na fórmula de 6 blocos.
    tipo: mapa.tipo,
    mapa,
    paginas: mapa.paginas.map((p) => ({ id: p.id, slug: p.slug, titulo: p.titulo, secoes: p.secoes.map((x) => x.uid) })),
    globais: mapa.globais,
    estilo,
    integracoes: integracoesDoPacote(integracoes, base ? `${base}/functions/v1/site-formulario` : null),
    seo: {
      titulo: seo.titulo || (copy ? copy.seo.titulo : "") || nomeDoCliente,
      descricao: seo.descricao || (copy ? copy.seo.descricao : ""),
      palavras: seo.palavras.length ? seo.palavras : copy ? copy.seo.palavras : [],
      indexar: seo.indexar,
      url,
      og_imagem: og,
      robots: robotsTxt(seo.indexar, url),
      schema: schemaDoNegocio(seo, { url, logo, imagem: og, nomePadrao: nomeDoCliente }),
    },
    base_de_design,
  };
  return { pacote, arquivos };
}
