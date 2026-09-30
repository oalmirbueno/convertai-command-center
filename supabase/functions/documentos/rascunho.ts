/**
 * documentos, frente BRF2 (30/09/2026): o rascunho do documento de entrega,
 * que a equipe edita antes do PDF, e a capa com a identidade do cliente.
 *
 * - rascunho { documento_id } ou { client_id, marca_id?, tipo, referencia, titulo?, modelo? }
 *   -> { documento, rascunho, eventos, candidatos, numeros, avisos } (sem IA, sem custo; lê só o que
 *   aconteceu. O primeiro rascunho sai por código: resumo pelas contagens, provas na ordem padrão)
 * - salvar_rascunho { documento_id, rascunho } -> { documento, rascunho }
 *
 * O texto de cada seção a equipe escreve ou preenche com IA pela peça comum
 * (PreencherComIA, papel "documento") na tela; aqui nada chama modelo.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { marcasDoCliente, resolverMarca, type MarcaDoCliente } from "../_shared/marca.ts";
import { reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
// FN-01: o imagescript só carrega quando uma imagem é aberta (não na partida da função).
import { jpegSobreBranco } from "../_shared/imagem-sob-demanda.ts";
import { ehImagemDoPdf, type ImagemDoPdf, imagemParaPdf } from "../_shared/pdf-base.ts";
import { candidatosAProva, FONTES, type PedidoDeRegistro } from "./modulos/registro-de-entrega.ts";
import {
  DEFINICOES_DE_DOCUMENTO,
  ehModeloDeDocumento,
  juntarCandidatos,
  modeloDoTipo,
  normalizarRascunho,
  type RascunhoDoDocumento,
  rascunhoInicial,
} from "../_shared/documento-modelos.ts";
import { type Coleta, coletarEventos } from "./eventos.ts";

export type LinhaComRascunho = {
  id: string;
  client_id: string;
  marca_id: string | null;
  tipo: string;
  referencia: string;
  titulo: string | null;
  gancho: Record<string, unknown>;
  modelo?: string | null;
  rascunho?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Os eventos reais da entrega (mesma leitura do gerar), com a marca pela regra de herança. */
export async function coletarDaLinha(s: SupabaseClient, linha: LinhaComRascunho): Promise<{ coleta: Coleta; marca: MarcaDoCliente | null }> {
  const pedido = { tipo: linha.tipo as PedidoDeRegistro["tipo"], referencia: linha.referencia };
  const [marca, marcas] = await Promise.all([
    resolverMarca(s, linha.client_id, { marca_id: linha.marca_id, project_id: pedido.tipo === "projeto" ? pedido.referencia : null }),
    marcasDoCliente(s, linha.client_id),
  ]);
  const outras = marca ? marcas.filter((m) => m.id !== marca.id && m.project_id).map((m) => m.project_id as string) : [];
  const provasDoGancho = linha.gancho && Array.isArray(linha.gancho.provas) ? (linha.gancho.provas as string[]).filter((x) => UUID.test(String(x))) : [];
  const coleta = await coletarEventos(s, {
    clientId: linha.client_id,
    tipo: pedido.tipo,
    referencia: pedido.referencia,
    marca: marca ? { id: marca.id, nome: marca.nome, principal: marca.principal, project_id: marca.project_id } : null,
    projetosDeOutrasMarcas: outras,
    provasDoGancho,
  });
  return { coleta, marca };
}

/** O rascunho que vale agora: o salvo (com os candidatos novos no fim, desmarcados) ou o inicial. */
export function rascunhoDaLinha(linha: LinhaComRascunho, coleta: Coleta, modeloPedido?: unknown): RascunhoDoDocumento {
  const tipo = linha.tipo as PedidoDeRegistro["tipo"];
  const modelo = ehModeloDeDocumento(modeloPedido) ? modeloPedido : ehModeloDeDocumento(linha.modelo) ? linha.modelo : modeloDoTipo(tipo);
  const candidatos = candidatosAProva(coleta.eventos);
  if (linha.rascunho && typeof linha.rascunho === "object") {
    const r = normalizarRascunho(linha.rascunho, modelo);
    return juntarCandidatos(ehModeloDeDocumento(modeloPedido) ? normalizarRascunho({ ...r, modelo: modeloPedido }, modeloPedido) : r, candidatos);
  }
  return rascunhoInicial(modelo, { titulo: linha.titulo || coleta.titulo, eventos: coleta.eventos, numeros: coleta.numeros, candidatos });
}

/** O que a tela mostra do rascunho: eventos (sem caminho de arquivo), candidatos a prova (com a imagem para a miniatura) e números reais. */
export function vistaDoRascunho(coleta: Coleta) {
  const candidatos = candidatosAProva(coleta.eventos, 40);
  return {
    eventos: coleta.eventos.slice(0, 150).map((e) => ({ id: e.id, grupo: FONTES[e.fonte].grupo, quando: e.quando, titulo: e.titulo, detalhe: e.detalhe || null, link: e.link || null })),
    candidatos: candidatos.map((c) => ({ id: c.id, titulo: c.titulo, legenda: c.detalhe || FONTES[c.fonte].grupo, quando: c.quando, forte: !!c.forte, imagem: c.imagem ? { bucket: c.imagem.bucket, caminho: c.imagem.caminho } : null })),
    numeros: coleta.numeros,
    avisos: coleta.avisos,
    modelos: DEFINICOES_DE_DOCUMENTO,
  };
}

// ------------------------------------------------------------------ capa com a identidade do cliente

/** Maior logo que abre aqui para virar JPEG (fundo branco). */
const MAX_PIXELS_DA_LOGO = 2_000_000;

type KitDaCapa = { logo_path: string | null; paleta: unknown };

function corPrimaria(paleta: unknown): string | null {
  const lista = Array.isArray(paleta) ? (paleta as Array<Record<string, unknown>>) : [];
  const valida = (h: unknown) => (typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h.trim()) ? h.trim() : null);
  const primaria = lista.find((c) => c && c.papel === "primaria" && valida(c.hex));
  if (primaria) return valida(primaria.hex);
  const qualquer = lista.find((c) => c && valida(c.hex));
  return qualquer ? valida(qualquer.hex) : null;
}

/**
 * Logo e cor do cliente para a capa, pela regra de herança: a marca que não é
 * a principal só usa o que é dela (sem logo própria, a capa sai sem logo); a
 * principal e o cliente sem marca usam o kit. A logo entra pelo código (a
 * imagem real), nunca pelo gerador. Falha vira aviso, nunca derruba o PDF.
 */
export async function identidadeDaCapa(s: SupabaseClient, clientId: string, marca: MarcaDoCliente | null, avisos: string[]): Promise<{ logo: ImagemDoPdf | null; cor: string | null }> {
  let kit: KitDaCapa = { logo_path: null, paleta: [] };
  if (marca && !marca.principal) {
    kit = { logo_path: marca.logo_path, paleta: marca.paleta };
  } else {
    const { data, error } = await s.from("cliente_kit_marca").select("logo_path, paleta").eq("client_id", clientId).maybeSingle();
    if (error) {
      registrarFalha("documentos: kit do cliente não lido para a capa", error, { client_id: clientId });
      avisos.push("O kit da marca não foi lido; a capa saiu sem a identidade do cliente.");
      return { logo: null, cor: null };
    }
    const k = (data as KitDaCapa | null) || { logo_path: null, paleta: [] };
    kit = { logo_path: (marca && marca.logo_path) || k.logo_path, paleta: marca && Array.isArray(marca.paleta) && (marca.paleta as unknown[]).length ? marca.paleta : k.paleta };
  }
  const cor = corPrimaria(kit.paleta);
  if (!kit.logo_path) return { logo: null, cor };
  try {
    const r = await reduzidaSemTransformacao(s, "mesa", kit.logo_path, 600, 600, { usarCopias: false, maxBytes: 4 * 1024 * 1024 });
    if (!r || !r.cabe) {
      avisos.push("A logo do cliente é grande demais para abrir aqui; a capa saiu só com a cor dele.");
      return { logo: null, cor };
    }
    const direta = imagemParaPdf(r.bytes);
    if (ehImagemDoPdf(direta)) return { logo: direta, cor };
    if (!((r.largura || 0) * (r.altura || 0) <= MAX_PIXELS_DA_LOGO) || !r.largura) return { logo: null, cor };
    // PNG com transparência ou WebP: fundo branco e JPEG.
    const jpeg = imagemParaPdf(await jpegSobreBranco(r.bytes, 90));
    return { logo: ehImagemDoPdf(jpeg) ? jpeg : null, cor };
  } catch (e) {
    registrarFalha("documentos: logo do cliente não abriu para a capa", e, { client_id: clientId });
    avisos.push("A logo do cliente não abriu; a capa saiu só com a cor dele.");
    return { logo: null, cor };
  }
}
