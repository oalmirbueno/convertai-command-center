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
 * - referencias_organizar { client_id, task_id?, titulo?, pedido?, referencias?: [{ imagem_id, papel }] | imagem_ids?: [] (até 6) }
 *     -> { referencias: [{ imagem_id, papel, descricao, cena, confianca, par }], custo_usd, saldo_usd, avisos }
 *     UMA leitura de visão descreve as fotos (o que mostra, cena e estado); o Jev decide o papel
 *     (confiança baixa mantém o que estava); antes e depois saem pareados pela cena e em ordem.
 *     Regras puras em referencias-organizar.ts.
 *
 * Sem LLM: o contexto entra por regra (contextoParaFoto) e o gerador recebe
 * as fotos reais do acervo na ordem do prompt. A foto entra no acervo como
 * gerada e sem aprovação (a equipe aprova no envio, como as outras).
 */

import { chamarImagem, chamarTexto, cobrarJev, type ImagemEntrada, type ModeloIa, type Qualidade } from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar } from "../_shared/jev.ts";
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
  type PapelDaReferencia,
} from "./foto-da-pauta-regras.ts";
import {
  descricaoParaOAcervo,
  ESQUEMA_DA_LEITURA_DAS_REFERENCIAS,
  lerLeituraDasReferencias,
  lerPapeis,
  parearEOrdenar,
  pedidoDaLeitura,
  perguntasDosPapeis,
  SISTEMA_DA_LEITURA_DAS_REFERENCIAS,
} from "./referencias-organizar.ts";

export const ACOES_LONGAS_DA_FOTO_DA_PAUTA = ["foto_da_pauta_gerar", "referencias_organizar"];

/** O que o index empresta (sem import circular): o modelo de imagem e o estilo da biblioteca já resolvido. */
export interface ExtrasDaFotoDaPauta {
  modeloDeImagem: (pedido?: unknown) => Promise<ModeloIa>;
  lerQualidade: (v: unknown) => Qualidade;
  /** Guia de estilo (biblioteca, referência de imagem ou livre) resolvido em texto e imagens. */
  resolverEstilo: (clientId: string, guia: unknown) => Promise<{ texto: string | null; estilos: { titulo: string; imagem: ImagemEntrada }[]; prompt_id: string | null }>;
}

const LADO_DA_REFERENCIA = 1024;
/** referencia_tipo de ia_usos (o mesmo do index). */
const REF_IMAGEM = "cliente_imagem";

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

  /**
   * Entender e organizar as referências (27/10/2026): a visão descreve, o Jev
   * decide o papel e as regras puras pareiam antes e depois pela cena.
   */
  async function referenciasOrganizar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id ?? "");
    if (!UUID.test(clientId)) throw new ErroDeRegra(400, "client_id_invalido", "Cliente inválido.");
    await f.garantirAcesso(ch, clientId);
    const taskId = corpo.task_id != null && corpo.task_id !== "" ? String(corpo.task_id) : null;
    if (taskId && !UUID.test(taskId)) throw new ErroDeRegra(400, "task_id_invalido", "Pauta inválida.");
    // A tela manda as referências com o papel atual; imagem_ids sozinhos entram como produto.
    const brutas = Array.isArray(corpo.referencias)
      ? corpo.referencias
      : Array.isArray(corpo.imagem_ids) ? corpo.imagem_ids.map((id) => ({ imagem_id: id, papel: "produto" })) : [];
    let atuais;
    try {
      atuais = lerReferenciasComPapel(brutas);
    } catch (e) {
      if (e instanceof ErroDaFotoDaPauta) throw new ErroDeRegra(e.status, e.codigo, e.message);
      throw e;
    }
    if (!atuais.length) throw new ErroDeRegra(400, "sem_imagens", "Escolha as fotos para organizar.");
    const lidas = await f.lerImagens(clientId, atuais.map((r) => r.imagem_id));
    const comFoto = atuais.map((r) => {
      const img = lidas.find((l) => l.id === r.imagem_id);
      if (!img || img.ativa === false) throw new ErroDeRegra(409, "id_fora_do_cliente", "Uma das fotos não está no acervo deste cliente.");
      return { ...r, img };
    });
    const titulo = limpo(corpo.titulo, 140) || null;
    const pedido = limpo(corpo.pedido, MAX_PEDIDO_DA_PAUTA);
    const avisos: string[] = [];

    // 1. Uma leitura de visão com todas as fotos juntas (a cena só se compara vendo todas).
    const imagens = await f.emParalelo(comFoto, 3, (r) => f.baixarReduzida(r.img.storage_bucket || "mesa", r.img.storage_path, LADO_DA_REFERENCIA, r.img.nome));
    const leitor = await f.modeloDeTexto("leitura", corpo.modelo_id);
    const lido = await chamarTexto({
      clientId,
      tarefa: "leitura_referencia",
      agente: "leitor",
      modeloId: leitor.id,
      sistema: SISTEMA_DA_LEITURA_DAS_REFERENCIAS,
      mensagens: [{
        papel: "usuario",
        conteudo: pedidoDaLeitura({ titulo, pedido, fotos: comFoto.map((r) => ({ nome: r.img.nome, descricao: r.img.descricao, gerada: r.img.gerada })) }),
        imagens,
      }],
      esquemaJson: ESQUEMA_DA_LEITURA_DAS_REFERENCIAS,
      maxTokensSaida: 2_000,
      timeoutMs: f.timeoutTextoMs,
      referencia: taskId ? { tipo: "task", id: taskId } : { tipo: REF_IMAGEM, id: comFoto[0].imagem_id },
      criadoPor: ch.userId,
    });
    let custo = lido.custoUsd;
    const leituras = lerLeituraDasReferencias(lido.json, comFoto.length);
    if (leituras.some((l) => !l.descricao)) avisos.push("Uma das fotos não foi descrita: o papel dela ficou como estava.");

    // 2. O papel de cada foto é julgamento: o Jev escolhe; confiança baixa mantém o que estava.
    let respostas: Record<string, { choice?: string; confidence?: number }> | null = null;
    try {
      const { state, questions } = perguntasDosPapeis({ titulo, pedido, fotos: comFoto.map((r, i) => ({ nome: r.img.nome, leitura: leituras[i] })) });
      const res = await jevPerguntar({ state, questions });
      const cobrado = await cobrarJev(res, { clientId, tarefa: "leitura_referencia", referencia: { tipo: REF_IMAGEM, id: comFoto[0].imagem_id }, criadoPor: ch.userId });
      if (cobrado) custo += cobrado.custoUsd;
      respostas = res.answers;
    } catch (e) {
      if (!(e instanceof JevErro)) throw e;
      registrarFalha("mesa-foto: Jev não decidiu o papel das referências", e);
      avisos.push("O Jev não respondeu agora: os papéis ficaram como estavam; descrições e pares foram atualizados.");
    }
    const decididos = lerPapeis(comFoto.map((r) => r.papel), respostas);
    // Foto sem descrição não troca de papel (o Jev julgaria no escuro).
    const papeis: PapelDaReferencia[] = decididos.map((d, i) => (leituras[i].descricao ? d.papel : comFoto[i].papel));

    // 3. Pares pela cena e a ordem (cada antes logo antes do seu depois).
    const { ordem, avisos: avisosDosPares } = parearEOrdenar(comFoto.map((r, i) => ({
      imagem_id: r.imagem_id,
      papel: papeis[i],
      cena: leituras[i].cena,
      descricao: leituras[i].descricao,
      confianca: decididos[i].confianca,
    })));
    avisos.push(...avisosDosPares);

    // A descrição entra no acervo só onde estava vazia (nunca sobrescreve a da equipe).
    await f.emParalelo(comFoto, 3, async (r, i) => {
      const texto = descricaoParaOAcervo(leituras[i]);
      if (!texto || (r.img.descricao && r.img.descricao.trim())) return;
      const base = db().from("cliente_imagens").update({ descricao: texto }).eq("id", r.imagem_id).eq("client_id", clientId);
      const { error } = await (r.img.descricao === null ? base.is("descricao", null) : base.eq("descricao", r.img.descricao));
      if (error) registrarFalha("mesa-foto: descrição da referência não gravada", error, { imagem_id: r.imagem_id });
    });

    return f.json({
      referencias: ordem.map((r) => ({ imagem_id: r.imagem_id, papel: r.papel, descricao: r.descricao || null, cena: r.cena || null, confianca: r.confianca, par: r.par })),
      custo_usd: arred6(custo),
      saldo_usd: lido.saldoUsd,
      avisos: Array.from(new Set(avisos)),
    });
  }

  return { acoes: { foto_da_pauta_gerar: fotoDaPautaGerar, referencias_organizar: referenciasOrganizar } };
}
