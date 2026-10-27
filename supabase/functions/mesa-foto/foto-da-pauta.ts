/**
 * Foto da pauta (27/10/2026): gerar a foto no Estúdio da Mesa a partir do
 * contexto da pauta e do cliente, com o estilo escolhido em cartões e
 * referências do acervo marcadas por papel (antes, depois, produto, cenário,
 * estilo). Regras puras e prompt em foto-da-pauta-regras.ts.
 *
 * Ação (POST { acao, ... } na função mesa-foto):
 * - foto_da_pauta_gerar { client_id, task_id?, titulo?, pedido, referencias?: [{ imagem_id, papel }],
 *     guia?: { modo, prompt_id?, referencia_ids?, texto? }, modelo_imagem_id?, qualidade?, formato?,
 *     marca_id?, posicao?: { atual, total } }
 *     -> { imagem, url, prompt, referencias, custo_usd, saldo_usd, reserva_usada, avisos } (UMA imagem por chamada)
 *
 * Sem LLM: o contexto entra por regra (contextoParaFoto) e o gerador recebe
 * as fotos reais do acervo na ordem do prompt. A foto entra no acervo como
 * gerada e sem aprovação (a equipe aprova no envio, como as outras).
 */

import { chamarImagem, type ImagemEntrada, type ModeloIa, type Qualidade } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { arred6, dimensoesDaImagem, ErroDeRegra, extensaoDe, limpo, mimeDe, sha256Hex, UUID } from "./calculos.ts";
import type { Chamador, FerramentasDaMesa } from "./ferramentas.ts";
import { FORMATOS, type Formato, TAMANHO_DO_FORMATO } from "./receitas.ts";
import {
  contextoParaFoto,
  ErroDaFotoDaPauta,
  etiquetasDaFotoDaPauta,
  lerReferenciasComPapel,
  MAX_PEDIDO_DA_PAUTA,
  MAX_REFERENCIAS_DA_PAUTA,
  ordenarReferencias,
  promptDaFotoDaPauta,
} from "./foto-da-pauta-regras.ts";

export const ACOES_LONGAS_DA_FOTO_DA_PAUTA = ["foto_da_pauta_gerar"];

/** O que o index empresta (sem import circular): o modelo de imagem e o estilo da biblioteca já resolvido. */
export interface ExtrasDaFotoDaPauta {
  modeloDeImagem: (pedido?: unknown) => Promise<ModeloIa>;
  lerQualidade: (v: unknown) => Qualidade;
  /** Guia de estilo (biblioteca, referência de imagem ou livre) resolvido em texto e imagens. */
  resolverEstilo: (clientId: string, guia: unknown) => Promise<{ texto: string | null; estilos: { titulo: string; imagem: ImagemEntrada }[]; prompt_id: string | null }>;
}

const LADO_DA_REFERENCIA = 1024;

export function acoesDaFotoDaPauta(f: FerramentasDaMesa, x: ExtrasDaFotoDaPauta) {
  const db = () => f.servico();

  async function fotoDaPautaGerar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id ?? "");
    if (!UUID.test(clientId)) throw new ErroDeRegra(400, "client_id_invalido", "Cliente inválido.");
    await f.garantirAcesso(ch, clientId);
    const taskId = corpo.task_id != null && corpo.task_id !== "" ? String(corpo.task_id) : null;
    if (taskId && !UUID.test(taskId)) throw new ErroDeRegra(400, "task_id_invalido", "Pauta inválida.");
    let referencias;
    try {
      referencias = lerReferenciasComPapel(corpo.referencias);
    } catch (e) {
      if (e instanceof ErroDaFotoDaPauta) throw new ErroDeRegra(e.status, e.codigo, e.message);
      throw e;
    }
    const pedido = limpo(corpo.pedido, MAX_PEDIDO_DA_PAUTA);
    if (!pedido && !referencias.length) throw new ErroDeRegra(400, "pedido_vazio", "Escreva o que a foto mostra ou escolha uma referência.");
    const formato = (FORMATOS as readonly string[]).includes(String(corpo.formato)) ? String(corpo.formato) as Formato : "4:5";
    const qualidade = x.lerQualidade(corpo.qualidade);
    const m = await x.modeloDeImagem(corpo.modelo_imagem_id);

    // As fotos do acervo deste cliente (nunca de outro), na ordem do prompt.
    const lidas = referencias.length ? await f.lerImagens(clientId, referencias.map((r) => r.imagem_id)) : [];
    const comFoto = referencias.map((r) => {
      const img = lidas.find((l) => l.id === r.imagem_id);
      if (!img || img.ativa === false) throw new ErroDeRegra(409, "id_fora_do_cliente", "Uma das referências não está no acervo deste cliente.");
      return { ...r, img };
    });
    const ordenadas = ordenarReferencias(comFoto);
    const avisos: string[] = [];
    const [estilo, contexto] = await Promise.all([
      x.resolverEstilo(clientId, corpo.guia),
      f.contextoDoCliente
        ? f.contextoDoCliente(clientId, undefined, corpo.marca_id).catch((e) => (registrarFalha("mesa-foto: contexto da foto da pauta não lido", e), null))
        : Promise.resolve(null),
    ]);
    if (!contexto) avisos.push("O contexto do cliente não foi lido agora: a foto saiu só com a pauta, o estilo e as referências.");
    const vagasDeEstilo = Math.max(0, MAX_REFERENCIAS_DA_PAUTA - ordenadas.length);
    const estilosUsados = estilo.estilos.slice(0, vagasDeEstilo);
    if (estilo.estilos.length > estilosUsados.length) avisos.push("Parte das imagens do estilo ficou de fora pelo limite de referências.");
    const imagens = await f.emParalelo(ordenadas, 3, (r) => f.baixarReduzida(r.img.storage_bucket || "mesa", r.img.storage_path, LADO_DA_REFERENCIA, `${r.papel}-${r.img.nome}`));
    const pos = corpo.posicao && typeof corpo.posicao === "object" ? corpo.posicao as Record<string, unknown> : null;
    const total = pos ? Math.min(10, Math.max(1, Math.floor(Number(pos.total) || 1))) : 1;
    const posicao = pos ? { atual: Math.min(total, Math.max(1, Math.floor(Number(pos.atual) || 1))), total } : null;
    const titulo = limpo(corpo.titulo, 140) || null;
    const prompt = promptDaFotoDaPauta({
      pedido,
      titulo,
      referencias: ordenadas.map((r) => ({ papel: r.papel, nome: r.img.nome })),
      estiloTexto: estilo.texto,
      estilosDaBiblioteca: estilosUsados.length,
      contexto: contexto ? contextoParaFoto(contexto.dados, contexto.cliente) : null,
      formato,
      posicao,
    });

    const saida = await chamarImagem({
      clientId,
      modeloId: m.id,
      prompt,
      referencias: [...imagens, ...estilosUsados.map((e) => e.imagem)],
      qualidade,
      tamanho: TAMANHO_DO_FORMATO[formato],
      referencia: taskId ? { tipo: "task", id: taskId } : { tipo: "cliente", id: clientId },
      criadoPor: ch.userId,
      tarefa: "estudio",
      agente: "gerador_imagem",
    });
    const mime = mimeDe(saida.png) ?? (saida.mime || "image/png");
    const dim = dimensoesDaImagem(saida.png);
    const caminho = `${clientId}/foto/pauta/${taskId ?? "avulsa"}/${crypto.randomUUID()}.${extensaoDe(mime)}`;
    await f.salvarNoMesa(caminho, saida.png, mime);
    // Nasce da foto real principal (antes, produto ou lugar); estilo nunca é a origem.
    const origem = ordenadas.find((r) => r.papel !== "estilo")?.img.id ?? null;
    const { data: img, error } = await db().from("cliente_imagens").insert({
      client_id: clientId,
      origem: "mesa_foto",
      storage_bucket: "mesa",
      storage_path: caminho,
      nome: `${titulo || "Foto da pauta"}${posicao && posicao.total > 1 ? ` ${posicao.atual}` : ""} (${saida.modeloId.split("/").pop()})`.slice(0, 160),
      pasta: "Mesa Foto / Pauta",
      categoria: ordenadas.some((r) => r.papel === "produto") ? "produto" : null,
      tags: etiquetasDaFotoDaPauta({ taskId, referencias: ordenadas, estiloId: estilo.prompt_id }),
      descricao: `Imagem gerada por IA no Estúdio da pauta (motor ${saida.modeloId}).${ordenadas.length ? ` Referências: ${ordenadas.map((r) => r.papel).join(", ")}.` : ""}`.slice(0, 1000),
      derivada_de: origem,
      gerada: true,
      modo: "canvas",
      kit_id: null,
      sha256: await sha256Hex(saida.png),
      largura: dim?.largura ?? null,
      altura: dim?.altura ?? null,
      aprovada: false,
    }).select(f.camposImagem).single();
    if (error || !img) {
      throw new ErroDeRegra(503, "gravacao_falhou", "A imagem foi gerada e cobrada, mas não entrou no acervo.", { uso_id: saida.usoId, custo_usd: saida.custoUsd, caminho });
    }
    const url = await f.urlAssinada("mesa", caminho);
    return f.json({
      imagem: { ...(img as unknown as Record<string, unknown>), url },
      url,
      prompt,
      referencias: ordenadas.map((r, i) => ({ ordem: i + 1, imagem_id: r.imagem_id, papel: r.papel })),
      custo_usd: arred6(saida.custoUsd),
      saldo_usd: saida.saldoUsd,
      reserva_usada: saida.reservaUsada ?? null,
      avisos: Array.from(new Set([...avisos, ...(saida.avisos ?? [])])),
    });
  }

  return { acoes: { foto_da_pauta_gerar: fotoDaPautaGerar } };
}
