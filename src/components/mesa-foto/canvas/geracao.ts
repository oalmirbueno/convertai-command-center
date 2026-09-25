import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { acrescentarFotos, invalidarFotos } from "../fotoApi";
import { chaveDoAndamento, emParalelo, marcarAndamento, type Andamento } from "../modelosApi";
import { ANGULOS_DE_VARIACAO, gerarNoCanvas, novoId, VARIACOES_POR_VEZ, type ResultadoDoCanvas } from "../canvasApi";

/**
 * Geração do Canvas fora dos componentes: uma chamada de canvas_gerar por
 * foto (a função gera UMA imagem por chamada), em segundo plano, com o
 * andamento no Resultado. O que chega depois de a tela sair fica em
 * "pendentes" até o canvas abrir de novo. Sem laço de correção: foto que
 * falha fica escrita como falha; tentar de novo é decisão da equipe.
 */

// ------------------------------------------------------------------ resultados que chegam fora da tela

let pendentes: Record<string, ResultadoDoCanvas[]> = {};
const ouvintesDosPendentes: (() => void)[] = [];
const chaveDoPendente = (canvasId: string, gerarId: string) => `${canvasId}|${gerarId}`;

export function anotarPendente(canvasId: string, gerarId: string, r: ResultadoDoCanvas) {
  const k = chaveDoPendente(canvasId, gerarId);
  const copia: Record<string, ResultadoDoCanvas[]> = { ...pendentes };
  copia[k] = (copia[k] || []).filter((x) => x.geracao_id !== r.geracao_id).concat([r]);
  pendentes = copia;
  ouvintesDosPendentes.slice().forEach((f) => f());
}

export function tirarPendentes(canvasId: string): Record<string, ResultadoDoCanvas[]> {
  const saida: Record<string, ResultadoDoCanvas[]> = {};
  const resto: Record<string, ResultadoDoCanvas[]> = {};
  Object.keys(pendentes).forEach((k) => {
    if (k.indexOf(`${canvasId}|`) === 0) saida[k.slice(canvasId.length + 1)] = pendentes[k];
    else resto[k] = pendentes[k];
  });
  if (Object.keys(saida).length) {
    pendentes = resto;
    ouvintesDosPendentes.slice().forEach((f) => f());
  }
  return saida;
}

export function usePendentes() {
  return useSyncExternalStore(
    (f) => {
      ouvintesDosPendentes.push(f);
      return () => {
        const i = ouvintesDosPendentes.indexOf(f);
        if (i >= 0) ouvintesDosPendentes.splice(i, 1);
      };
    },
    () => pendentes,
    () => pendentes,
  );
}

// ------------------------------------------------------------------ andamento por Resultado

/** Chave de uma foto em andamento: o motor, e o número da foto quando é série. */
export const chaveDaFoto = (gerarId: string, motorId: string, n?: number) => chaveDoAndamento("canvas", gerarId, n === undefined ? motorId : `${motorId}#${n}`);

export interface FotoEmAndamento {
  chave: string;
  motor: string;
  a: Andamento;
}

/** Todas as fotos em andamento (ou que falharam) de um Resultado. */
export function andamentoDoResultado(andamentos: Record<string, Andamento>, gerarId: string): { gerando: FotoEmAndamento[]; falhas: FotoEmAndamento[] } {
  const prefixo = `canvas|${gerarId}|`;
  const lista: FotoEmAndamento[] = Object.keys(andamentos)
    .filter((k) => k.indexOf(prefixo) === 0)
    .map((k) => ({ chave: k, motor: k.slice(prefixo.length).split("#")[0], a: andamentos[k] }));
  return { gerando: lista.filter((x) => x.a.estado === "gerando"), falhas: lista.filter((x) => x.a.estado === "falhou") };
}

// ------------------------------------------------------------------ gerar

interface Base {
  queryClient: QueryClient;
  clientId: string;
  canvasId: string;
  gerarId: string;
  qualidade: Qualidade;
  atualizar: () => void;
}

type Pedido = { motorId: string; chave: string; baseImagemId?: string | null; angulo?: number | null; quadro?: number | null; quadros?: number | null; grupo?: string | null };

async function rodar(p: Base, pedidos: Pedido[], paralelo: number) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  const saidas: ResultadoDoCanvas[] = [];
  pedidos.forEach((x) => marcarAndamento(x.chave, { estado: "gerando", erro: "" }));
  await emParalelo(pedidos, paralelo, async (x) => {
    try {
      // Formato, resolução, ação e pose vão no Resultado salvo (a função lê de lá).
      const r = await gerarNoCanvas({
        canvasId: p.canvasId,
        gerarId: p.gerarId,
        motorId: x.motorId,
        qualidade: p.qualidade,
        baseImagemId: x.baseImagemId,
        angulo: x.angulo,
        quadro: x.quadro,
        quadros: x.quadros,
        grupo: x.grupo,
      });
      if (r.imagem) acrescentarFotos(p.queryClient, p.clientId, [r.imagem]);
      anotarPendente(p.canvasId, p.gerarId, r.resultado);
      saidas.push(r.resultado);
      custo += Number(r.custo_usd || 0);
      feitas++;
      marcarAndamento(x.chave, null);
    } catch (e) {
      falhas++;
      marcarAndamento(x.chave, { estado: "falhou", erro: textoDoErro(e) });
    }
  });
  return { feitas, falhas, custo, saidas };
}

function avisar(feitas: number, falhas: number, custo: number, oQue: string) {
  if (feitas) toast.success(`${feitas} ${feitas === 1 ? "foto pronta" : "fotos prontas"} ${oQue}`, { description: `Custo real: ${usd(custo)}. Elas já estão no acervo, marcadas como geradas.` });
  if (falhas) toast.error(`${falhas} ${falhas === 1 ? "foto falhou" : "fotos falharam"}`, { description: "O erro aparece no Resultado. Tentar de novo é com você (sem refazer sozinho)." });
}

/**
 * Botão Gerar do Resultado: uma foto por motor ligado; com carrossel, a foto
 * 1 no primeiro motor e, com ela pronta como base, as outras em paralelo
 * (mesma pessoa, mesmo produto, ângulo diferente em cada uma).
 */
export async function gerarNoResultado(p: Base & { motores: string[]; carrossel: number }) {
  if (p.carrossel && p.motores.length) {
    const motorId = p.motores[0];
    const grupo = novoId("car").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
    const total = p.carrossel;
    const pedidos: Pedido[] = [];
    for (let q = 1; q <= total; q++) pedidos.push({ motorId, chave: chaveDaFoto(p.gerarId, motorId, q), angulo: (q - 1) % ANGULOS_DE_VARIACAO.length, quadro: q, quadros: total, grupo });
    // As que esperam a capa já aparecem como "gerando" no Resultado.
    pedidos.slice(1).forEach((x) => marcarAndamento(x.chave, { estado: "gerando", erro: "" }));
    const primeira = await rodar(p, pedidos.slice(0, 1), 1);
    const capa = primeira.saidas[0];
    if (!capa || !capa.imagem_id) {
      pedidos.slice(1).forEach((x) => marcarAndamento(x.chave, null));
      p.atualizar();
      avisar(0, primeira.falhas || 1, primeira.custo, "do carrossel");
      return;
    }
    const resto = await rodar(p, pedidos.slice(1).map((x) => ({ ...x, baseImagemId: capa.imagem_id })), 3);
    invalidarFotos(p.queryClient, p.clientId);
    p.atualizar();
    avisar(primeira.feitas + resto.feitas, primeira.falhas + resto.falhas, primeira.custo + resto.custo, "no carrossel");
    return;
  }
  const r = await rodar(p, p.motores.map((m) => ({ motorId: m, chave: chaveDaFoto(p.gerarId, m) })), 4);
  invalidarFotos(p.queryClient, p.clientId);
  p.atualizar();
  avisar(r.feitas, r.falhas, r.custo, "no Resultado");
}

/**
 * "Variações desta": a foto escolhida vai como base (mesma pessoa, mesmo
 * produto, mesmo estilo) e cada variação tem um ângulo diferente, sem
 * repetir o ângulo da própria base.
 */
export async function gerarVariacoes(p: Base & { base: ResultadoDoCanvas; vezes?: number }) {
  if (!p.base.imagem_id) return;
  const motorId = p.base.motor_id;
  const grupo = (p.base.grupo || `var-${p.base.geracao_id}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  const usado = p.base.quadro ? (p.base.quadro - 1) % ANGULOS_DE_VARIACAO.length : 0;
  const angulos = ANGULOS_DE_VARIACAO.map((_, i) => i).filter((i) => i !== usado).slice(0, p.vezes || VARIACOES_POR_VEZ);
  const pedidos: Pedido[] = angulos.map((angulo, i) => ({ motorId, chave: chaveDaFoto(p.gerarId, motorId, 100 + i), angulo, baseImagemId: p.base.imagem_id, grupo }));
  const r = await rodar(p, pedidos, 3);
  invalidarFotos(p.queryClient, p.clientId);
  p.atualizar();
  avisar(r.feitas, r.falhas, r.custo, "nas variações");
}
