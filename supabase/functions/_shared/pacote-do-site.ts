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
import { coresValidas, type DnaDoSite, type OpcaoDeCopy, type PacoteDoSite, SECOES_PADRAO } from "./site-metodo.ts";

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
  arquivado_em: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type ImagemDoSite = { id: string; slot: string; origem: "gerada" | "real"; bucket: string; path: string; alt: string; custo_usd?: number; escolhida?: boolean };

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
  imagensDoSite(site.imagens)
    .filter((i) => i.escolhida !== false)
    .forEach((img, n) => {
      const arquivo = `/imagens/${img.origem === "real" ? "foto" : img.slot}-${n + 1}.${extensao(img.path)}`;
      arquivos.push({ bucket: img.bucket, path: img.path, destino: `public${arquivo}` });
      if (img.origem === "real") fotos.push({ arquivo, alt: img.alt });
      else imagens.push({ slot: img.slot, arquivo, alt: img.alt });
    });
  const c = contexto as Record<string, unknown>;
  const dna = site.dna && Array.isArray((site.dna as { atributos?: unknown }).atributos) ? (site.dna as unknown as DnaDoSite) : null;
  const pacote: PacoteDoSite = {
    cliente: direcaoDaMarca.nomeCliente || site.nome,
    marca: {
      nome: direcaoDaMarca.nomeCliente,
      negocio: typeof c.negocio === "string" ? c.negocio.slice(0, 1200) : undefined,
      publico: typeof c.publico === "string" ? c.publico.slice(0, 1200) : undefined,
      oferta: typeof c.oferta === "string" ? c.oferta.slice(0, 1200) : undefined,
      tom: direcaoDaMarca.tomDeVoz || undefined,
      diferenciais: Array.isArray(c.diferenciais) ? (c.diferenciais as unknown[]).map((d) => String(d).slice(0, 240)).slice(0, 8) : undefined,
    },
    paleta: direcaoDaMarca.paleta
      .filter((p) => coresValidas([p.hex]).length)
      .map((p) => ({ hex: coresValidas([p.hex])[0], nome: p.nome, papel: p.papel }))
      .slice(0, 8),
    fontes: direcaoDaMarca.fontes.slice(0, 4),
    dna,
    direcao: {
      nicho: typeof site.direcao.nicho === "string" ? site.direcao.nicho : undefined,
      peca: typeof site.direcao.peca === "string" ? site.direcao.peca : "site de uma página",
      referencia_de_nivel: typeof site.direcao.nivel === "string" ? site.direcao.nivel : undefined,
      observacao: typeof site.direcao.observacao === "string" ? site.direcao.observacao.slice(0, 1500) : undefined,
    },
    copy: copyEscolhida(site.conteudo),
    imagens,
    fotos_reais: fotos,
    logo,
    secoes: secoes && secoes.length ? secoes : Array.isArray(site.direcao.secoes) ? (site.direcao.secoes as string[]) : SECOES_PADRAO.slice(),
  };
  return { pacote, arquivos };
}
