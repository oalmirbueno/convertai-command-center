/**
 * Mesa Foto, ferramentas profissionais de imagem (pedido do dono, 26/09):
 * AMPLIAR (upscale fiel ou criativo, 2x ou 4x) e TIRAR FUNDO (pro), por API
 * externa (fal.ai). O trabalho pesado roda no provedor; aqui só há rede,
 * conferência, carteira e acervo. Regras, catálogo e fila em
 * _shared/ferramentas-imagem.ts; pesquisa em docs/ferramentas-imagem/PESQUISA.md.
 *
 * Ações (POST { acao, ... } na função mesa-foto; todas com resposta com fôlego):
 * - ferramentas_estimar { client_id, imagem_id }
 *     -> { configurada, segredo, provedor, imagem, saldo_usd, opcoes[], motores[] } (sem custo)
 * - upscale { client_id, imagem_id, fator: 2|4, modo: 'fiel'|'criativo', motor?, conteudo?: 'foto'|'texto'|'arte', refazer? }
 * - remover_fundo { client_id, imagem_id, motor?: 'bria'|'birefnet', refazer? }
 *     -> pronto:        { situacao: 'pronto', imagem, url, custo_usd, saldo_usd, uso_id, ja_existia, cobrado, ... }
 *     -> passou do prazo: { situacao: 'em_andamento', ficha, andamento, posicao, estimativa_usd, custo_usd: 0 }
 * - ferramenta_retomar { client_id, ficha } -> igual a upscale/remover_fundo (não cobra duas vezes)
 *
 * A derivada vai para o acervo (cliente_imagens) com derivada_de = a foto de
 * origem, modo 'detalhe' (ampliada) ou 'preservar' (sem fundo) e as tags
 * 'upscale' ou 'sem_fundo' (a mesma que o Estúdio já reconhece como recorte).
 * O id da derivada é o id do pedido no provedor: retomar ou repetir a
 * gravação nunca duplica a foto nem a cobrança.
 *
 * Custo: estimativa antes (ferramentas_estimar e estimativa_usd), saldo
 * conferido antes de enviar (garantirSaldo) e o valor da tabela registrado
 * na carteira do cliente pelo mesmo registro do motor (registrarUso, tarefa
 * 'estudio', agente 'gerador_imagem', provedor 'fal'). A chave é da agência
 * (segredo FAL_KEY); sem ela, erro ferramenta_sem_chave com o nome do segredo.
 */

import { garantirSaldo, IaMotorErro, lerSaldo, type ModeloIa, type Qualidade, registrarUso } from "../_shared/ia-motor.ts";
import {
  acompanharPedido,
  assinarFicha,
  chaveDoProvedor,
  concluirPedido,
  type DadosDaFicha,
  type Dimensoes,
  dimensoesDoCabecalho,
  enviarParaFila,
  etiquetaDoResultado,
  FerramentaImagemErro,
  ferramentasConfiguradas,
  fichaDoPlano,
  lerFicha,
  lerPedidoDeFundo,
  lerPedidoDeUpscale,
  MAX_BYTES_ENTRADA,
  mimeDaImagem,
  MOTOR_PADRAO,
  MOTORES,
  type PedidoNaFila,
  type PlanoDaFerramenta,
  planoDaFicha,
  planoDoFundo,
  planoDoUpscale,
  PROVEDORES,
  type Rede,
  redePadrao,
} from "../_shared/ferramentas-imagem.ts";
import { ErroDeRegra, extensaoDe, limpo, sha256Hex, UUID } from "./calculos.ts";
import type { Chamador, FerramentasDaMesa, ImagemDoAcervoLida } from "./ferramentas.ts";

const REFERENCIA_DO_USO = "ferramenta_imagem";
const PASTA = "Mesa Foto / Ferramentas";

/** Ações longas (fila do provedor + download): resposta com fôlego no index. */
export const ACOES_LONGAS_DAS_FERRAMENTAS_PRO = ["ferramentas_estimar", "upscale", "remover_fundo", "ferramenta_retomar"];

/** Segredo do servidor que assina a ficha de retomada (nunca sai do servidor). */
function segredoDaFicha(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || Deno.env.get(PROVEDORES.fal.segredo)?.trim() || "";
}

/** Erro das regras compartilhadas vira o erro que o index já sabe responder. */
function comoErroDaMesa(err: unknown, ficha?: string): unknown {
  const extra = ficha ? { ficha } : {};
  if (err instanceof FerramentaImagemErro) return new ErroDeRegra(err.status, err.codigo, err.message, { ...err.extra, ...extra });
  if (ficha && err instanceof IaMotorErro) return new ErroDeRegra(err.status, err.codigo, err.message, { ...err.detalhes, ...extra });
  if (ficha && err instanceof ErroDeRegra) return new ErroDeRegra(err.status, err.codigo, err.message, { ...err.extra, ...extra });
  return err;
}

const mimePeloNome = (caminho: string): string | null => {
  const c = caminho.toLowerCase();
  if (c.endsWith(".png")) return "image/png";
  if (c.endsWith(".jpg") || c.endsWith(".jpeg")) return "image/jpeg";
  if (c.endsWith(".webp")) return "image/webp";
  return null;
};

const fatorEmTexto = (f: number | null) => String(f ?? "").replace(".", ",");

export function acoesDasFerramentasPro(f: FerramentasDaMesa, rede: Rede = redePadrao()) {
  const db = () => f.servico();

  // ---------------------------------------------------------------- leituras

  async function lerOrigem(ch: Chamador, corpo: Record<string, unknown>): Promise<{ clientId: string; img: ImagemDoAcervoLida }> {
    const clientId = String(corpo.client_id ?? "").trim();
    await f.garantirAcesso(ch, clientId);
    const imagemId = String(corpo.imagem_id ?? "").trim();
    if (!UUID.test(imagemId)) throw new ErroDeRegra(400, "imagem_id_invalido", "imagem_id precisa ser um UUID.");
    const [img] = await f.lerImagens(clientId, [imagemId]);
    if (!img) throw new ErroDeRegra(404, "imagem_inexistente", "Esta imagem não está no acervo do cliente.");
    return { clientId, img };
  }

  /** Tamanho e tipo da foto: do acervo; sem eles, pelo cabeçalho do arquivo. */
  async function medidas(img: ImagemDoAcervoLida): Promise<{ entrada: Dimensoes; mime: string | null }> {
    const mime = mimePeloNome(img.storage_path);
    if (img.largura && img.altura && mime) return { entrada: { largura: img.largura, altura: img.altura }, mime };
    const bytes = await f.baixar(img.storage_bucket, img.storage_path, MAX_BYTES_ENTRADA);
    const d = dimensoesDoCabecalho(bytes);
    if (!d) throw new ErroDeRegra(422, "dimensoes_desconhecidas", "Não foi possível ler o tamanho desta imagem.");
    return { entrada: d, mime: mimeDaImagem(bytes) };
  }

  /** Derivadas ativas desta foto (para não pagar de novo pela mesma ferramenta). */
  async function derivadasDe(clientId: string, imagemId: string): Promise<ImagemDoAcervoLida[]> {
    const { data, error } = await db().from("cliente_imagens").select(f.camposImagem)
      .eq("client_id", clientId).eq("derivada_de", imagemId).eq("ativa", true)
      .order("criado_em", { ascending: false }).limit(200);
    if (error) throw new ErroDeRegra(503, "acervo_indisponivel", "Não foi possível ler o acervo do cliente.");
    return (data ?? []) as unknown as ImagemDoAcervoLida[];
  }

  const comEtiqueta = (lista: ImagemDoAcervoLida[], etiqueta: string) => lista.find((i) => (i.tags ?? []).indexOf(etiqueta) >= 0) ?? null;

  async function comUrl(img: ImagemDoAcervoLida) {
    const url = await f.urlAssinada(img.storage_bucket, img.storage_path);
    return { imagem: { ...img, url }, url };
  }

  // ---------------------------------------------------------------- carteira

  const modeloDoUso = (plano: PlanoDaFerramenta) =>
    // O registro do motor só lê id e provedor do modelo; o provedor 'fal' não é um modelo do catálogo de IA.
    ({ id: `${plano.motor.provedor}:${plano.motor.modelo_api}`, provedor: plano.motor.provedor } as unknown as ModeloIa);

  function dependencias(ch: Chamador, clientId: string, plano: PlanoDaFerramenta) {
    return {
      rede,
      jaCobrado: async (referenciaId: string) => {
        const { data, error } = await db().from("ia_usos").select("id, custo_usd")
          .eq("client_id", clientId).eq("referencia_tipo", REFERENCIA_DO_USO).eq("referencia_id", referenciaId).limit(1).maybeSingle();
        if (error) throw new ErroDeRegra(503, "carteira_indisponivel", "Não foi possível conferir a carteira agora.");
        const linha = data as { id: string; custo_usd: number | string } | null;
        return linha ? { usoId: linha.id, custoUsd: Number(linha.custo_usd) || 0 } : null;
      },
      registrar: async (r: { custoUsd: number; qualidade: string; referenciaId: string }) => {
        const u = await registrarUso({
          clientId,
          tarefa: "estudio",
          agente: "gerador_imagem",
          modelo: modeloDoUso(plano),
          tokensEntrada: 0,
          tokensSaida: 0,
          tokensCache: 0,
          imagens: 1,
          // Coluna de texto livre: guarda a variante da ferramenta (ex.: upscale_2x_fiel, sem_fundo).
          qualidade: r.qualidade as Qualidade,
          custoUsd: r.custoUsd,
          custoFonte: "tabela",
          referencia: r.referenciaId ? { tipo: REFERENCIA_DO_USO, id: r.referenciaId } : undefined,
          criadoPor: ch.userId,
          // Chave da agência (segredo do ambiente). O segredo não vai para o registro.
          chave: { segredo: "", origem: "agencia", chaveId: null, cotaMensalUsd: null, gastoMesUsd: 0 },
        });
        return { usoId: u.usoId, saldoUsd: u.saldoUsd };
      },
    };
  }

  // ---------------------------------------------------------------- acervo

  async function gravarDerivada(
    clientId: string,
    origem: ImagemDoAcervoLida,
    plano: PlanoDaFerramenta,
    r: { bytes: Uint8Array; conferida: { mime: string; largura: number; altura: number }; referenciaId: string; usoId: string; custoUsd: number },
  ): Promise<{ img: ImagemDoAcervoLida; ja_existia: boolean }> {
    const id = r.referenciaId || crypto.randomUUID();
    const [ja] = await f.lerImagens(clientId, [id]);
    if (ja) return { img: ja, ja_existia: true };
    const etiqueta = etiquetaDoResultado(plano);
    const upscale = plano.tarefa === "upscale";
    const nomeDoArquivo = upscale ? `ampliada-${fatorEmTexto(plano.fator_efetivo).replace(",", "_")}x-${plano.modo}` : "sem-fundo";
    const caminho = `${clientId}/foto/ferramentas/${origem.id}/${nomeDoArquivo}-${id.slice(0, 8)}-${crypto.randomUUID().slice(0, 6)}.${extensaoDe(r.conferida.mime)}`;
    await f.salvarNoMesa(caminho, r.bytes, r.conferida.mime);
    const herdadas = (origem.tags ?? []).filter((t) => !/^(upscale|sem_fundo|preparo:|fundo:|motor:)/.test(t));
    const tags = Array.from(new Set([
      ...herdadas,
      "mesa_foto",
      upscale ? "upscale" : "sem_fundo",
      etiqueta,
      `motor:${plano.motor.modelo_api}`,
      ...(upscale && plano.modo === "criativo" ? ["gerada"] : []),
    ]));
    const descricao = upscale
      ? `Ampliada ${fatorEmTexto(plano.fator_efetivo)}x (${plano.modo}) por ${plano.motor.rotulo} via ${PROVEDORES[plano.motor.provedor].rotulo}, de ${origem.largura ?? plano.entrada.largura} x ${origem.altura ?? plano.entrada.altura} para ${r.conferida.largura} x ${r.conferida.altura}.${plano.modo === "criativo" ? " A IA reconstruiu detalhes: confira rosto, textura e letras antes de usar." : " Modo fiel: sem redesenhar o assunto."}`
      : `Sem fundo por ${plano.motor.rotulo} via ${PROVEDORES[plano.motor.provedor].rotulo} (recorte com transparência, pixels do assunto preservados).`;
    const { data, error } = await db().from("cliente_imagens").insert({
      id,
      client_id: clientId,
      origem: "mesa_foto",
      storage_bucket: "mesa",
      storage_path: caminho,
      nome: limpo(`${origem.nome} (${upscale ? `ampliada ${fatorEmTexto(plano.fator_efetivo)}x${plano.modo === "criativo" ? ", criativa" : ""}` : "sem fundo"})`, 160),
      pasta: PASTA,
      categoria: origem.categoria,
      tags,
      descricao: limpo(descricao, 1000),
      derivada_de: origem.id,
      gerada: upscale && plano.modo === "criativo",
      modo: upscale ? "detalhe" : "preservar",
      kit_id: origem.kit_id,
      sha256: await sha256Hex(r.bytes),
      largura: r.conferida.largura,
      altura: r.conferida.altura,
      aprovada: false,
    }).select(f.camposImagem).single();
    if (error || !data) {
      await db().storage.from("mesa").remove([caminho]).catch(() => {});
      // Mesmo arquivo já no acervo (índice único por sha256): devolve o que existe.
      if ((error as { code?: string } | null)?.code === "23505") {
        const { data: igual } = await db().from("cliente_imagens").select(f.camposImagem)
          .eq("client_id", clientId).eq("sha256", await sha256Hex(r.bytes)).maybeSingle();
        if (igual) return { img: igual as unknown as ImagemDoAcervoLida, ja_existia: true };
      }
      throw new ErroDeRegra(503, "gravacao_falhou", "A imagem ficou pronta e foi cobrada, mas não entrou no acervo. Tente de novo pela mesma ficha (não cobra de novo).", {
        uso_id: r.usoId,
        custo_usd: r.custoUsd,
      });
    }
    return { img: data as unknown as ImagemDoAcervoLida, ja_existia: false };
  }

  // ---------------------------------------------------------------- fluxo

  function resumoDoPlano(plano: PlanoDaFerramenta) {
    return {
      tarefa: plano.tarefa,
      motor: { id: plano.motor.id, rotulo: plano.motor.rotulo, provedor: PROVEDORES[plano.motor.provedor].rotulo, modelo_api: plano.motor.modelo_api },
      fator: plano.fator,
      fator_efetivo: plano.fator_efetivo,
      modo: plano.modo,
      entrada: plano.entrada,
      saida: plano.saida,
      estimativa_usd: plano.estimativa_usd,
      avisos: plano.avisos,
    };
  }

  /** Acompanha o pedido; pronto vira derivada no acervo; senão devolve a ficha para retomar. */
  async function acompanharEConcluir(ch: Chamador, clientId: string, origem: ImagemDoAcervoLida, plano: PlanoDaFerramenta, pedido: PedidoNaFila, ficha: string, chave: string) {
    try {
      const andamento = await acompanharPedido(pedido, chave, rede);
      if (andamento.situacao !== "pronto") {
        return f.json({
          situacao: "em_andamento",
          ficha,
          andamento: andamento.situacao,
          posicao: andamento.posicao,
          mensagem: "O provedor ainda está trabalhando. A tela continua acompanhando sem cobrar de novo.",
          custo_usd: 0,
          ...resumoDoPlano(plano),
        });
      }
      const r = await concluirPedido(plano, andamento, pedido, dependencias(ch, clientId, plano));
      const { img, ja_existia } = await gravarDerivada(clientId, origem, plano, r);
      return f.json({
        situacao: "pronto",
        ...(await comUrl(img)),
        ...resumoDoPlano(plano),
        saida: { largura: r.conferida.largura, altura: r.conferida.altura },
        custo_usd: r.cobradoAgora ? r.custoUsd : 0,
        saldo_usd: r.saldoUsd,
        uso_id: r.usoId,
        cobrado: r.cobradoAgora,
        ja_existia,
      });
    } catch (err) {
      throw comoErroDaMesa(err, ficha);
    }
  }

  async function executar(ch: Chamador, clientId: string, origem: ImagemDoAcervoLida, plano: PlanoDaFerramenta, refazer: boolean) {
    // Mesma ferramenta já aplicada nesta foto: devolve a derivada, sem custo.
    if (!refazer) {
      const existente = comEtiqueta(await derivadasDe(clientId, origem.id), etiquetaDoResultado(plano));
      if (existente) {
        return f.json({ situacao: "pronto", ...(await comUrl(existente)), ...resumoDoPlano(plano), custo_usd: 0, cobrado: false, ja_existia: true });
      }
    }
    const chave = chaveDoProvedor(plano.motor.provedor);
    await garantirSaldo(clientId, plano.estimativa_usd);
    const imagemUrl = await f.urlAssinada(origem.storage_bucket, origem.storage_path);
    if (!imagemUrl) throw new ErroDeRegra(502, "arquivo_indisponivel", "Não foi possível ler a imagem no armazenamento.");
    const pedido = await enviarParaFila(plano, imagemUrl, chave, rede);
    const ficha = await assinarFicha(fichaDoPlano(plano, clientId, origem.id, pedido), segredoDaFicha());
    return await acompanharEConcluir(ch, clientId, origem, plano, pedido, ficha, chave);
  }

  // ---------------------------------------------------------------- ações

  async function upscale(ch: Chamador, corpo: Record<string, unknown>) {
    try {
      const pedido = lerPedidoDeUpscale(corpo);
      const { clientId, img } = await lerOrigem(ch, corpo);
      const { entrada, mime } = await medidas(img);
      return await executar(ch, clientId, img, planoDoUpscale(pedido, entrada, mime), pedido.refazer);
    } catch (err) {
      throw comoErroDaMesa(err);
    }
  }

  async function removerFundo(ch: Chamador, corpo: Record<string, unknown>) {
    try {
      const pedido = lerPedidoDeFundo(corpo);
      const { clientId, img } = await lerOrigem(ch, corpo);
      const tags = img.tags ?? [];
      if (tags.indexOf("sem_fundo") >= 0 || tags.indexOf("preparo:fundo_transparente") >= 0) {
        throw new ErroDeRegra(409, "ja_e_recorte", "Esta foto já está sem fundo.");
      }
      const { entrada } = await medidas(img);
      return await executar(ch, clientId, img, planoDoFundo(pedido, entrada), pedido.refazer);
    } catch (err) {
      throw comoErroDaMesa(err);
    }
  }

  async function retomar(ch: Chamador, corpo: Record<string, unknown>) {
    let dados: DadosDaFicha;
    try {
      dados = await lerFicha(corpo.ficha, segredoDaFicha());
    } catch (err) {
      throw comoErroDaMesa(err);
    }
    const clientId = String(corpo.client_id ?? "").trim();
    if (clientId !== dados.client_id) throw new ErroDeRegra(403, "ficha_de_outro_cliente", "Esta ficha é de outro cliente.");
    await f.garantirAcesso(ch, clientId);
    const [img] = await f.lerImagens(clientId, [dados.imagem_id]);
    if (!img) throw new ErroDeRegra(404, "imagem_inexistente", "A foto de origem saiu do acervo.");
    const plano = planoDaFicha(dados);
    // Já gravada numa tentativa anterior: devolve sem consultar nem cobrar.
    const id = UUID.test(dados.pedido.request_id) ? dados.pedido.request_id.toLowerCase() : "";
    if (id) {
      const [ja] = await f.lerImagens(clientId, [id]);
      if (ja) return f.json({ situacao: "pronto", ...(await comUrl(ja)), ...resumoDoPlano(plano), custo_usd: 0, cobrado: false, ja_existia: true });
    }
    let chave: string;
    try {
      chave = chaveDoProvedor(plano.motor.provedor);
    } catch (err) {
      throw comoErroDaMesa(err);
    }
    return await acompanharEConcluir(ch, clientId, img, plano, dados.pedido, String(corpo.ficha), chave);
  }

  /** Custo de cada ferramenta nesta foto, sem chamar o provedor e sem custo. */
  async function estimar(ch: Chamador, corpo: Record<string, unknown>) {
    const { clientId, img } = await lerOrigem(ch, corpo);
    const { entrada, mime } = await medidas(img);
    const derivadas = await derivadasDe(clientId, img.id);
    const opcao = (chave: string, fazer: () => PlanoDaFerramenta) => {
      try {
        const plano = fazer();
        const existente = comEtiqueta(derivadas, etiquetaDoResultado(plano));
        return { chave, ...resumoDoPlano(plano), impedimento: null, ja_existe: existente ? existente.id : null };
      } catch (err) {
        const e = err instanceof FerramentaImagemErro ? err : null;
        return { chave, impedimento: { codigo: e?.codigo ?? "indisponivel", mensagem: e?.message ?? "Indisponível para esta foto." }, ja_existe: null };
      }
    };
    const tags = img.tags ?? [];
    const jaSemFundo = tags.indexOf("sem_fundo") >= 0 || tags.indexOf("preparo:fundo_transparente") >= 0;
    const opcoes = [
      opcao("upscale_2x_fiel", () => planoDoUpscale(lerPedidoDeUpscale({ fator: 2, modo: "fiel" }), entrada, mime)),
      opcao("upscale_4x_fiel", () => planoDoUpscale(lerPedidoDeUpscale({ fator: 4, modo: "fiel" }), entrada, mime)),
      opcao("upscale_2x_criativo", () => planoDoUpscale(lerPedidoDeUpscale({ fator: 2, modo: "criativo" }), entrada, mime)),
      opcao("upscale_4x_criativo", () => planoDoUpscale(lerPedidoDeUpscale({ fator: 4, modo: "criativo" }), entrada, mime)),
      jaSemFundo
        ? { chave: "remover_fundo", impedimento: { codigo: "ja_e_recorte", mensagem: "Esta foto já está sem fundo." }, ja_existe: null }
        : opcao("remover_fundo", () => planoDoFundo(lerPedidoDeFundo({}), entrada)),
    ];
    let saldo: number | null = null;
    try {
      saldo = await lerSaldo(clientId);
    } catch { /* carteira fora do ar não impede a estimativa */ }
    const configurada = ferramentasConfiguradas("fal");
    return f.json({
      configurada,
      segredo: PROVEDORES.fal.segredo,
      provedor: PROVEDORES.fal.rotulo,
      aviso: configurada ? null : `Configure ${PROVEDORES.fal.segredo} nos segredos das funções do Supabase para ligar Ampliar e Tirar fundo (pro).`,
      imagem: { id: img.id, largura: entrada.largura, altura: entrada.altura },
      saldo_usd: saldo,
      opcoes,
      padroes: MOTOR_PADRAO,
      motores: Object.values(MOTORES).map((m) => ({ id: m.id, tarefa: m.tarefa, modo: m.modo, rotulo: m.rotulo, modelo_api: m.modelo_api, preco: m.preco, fonte_preco: m.fonte_preco })),
      custo_usd: 0,
    });
  }

  return {
    acoes: {
      ferramentas_estimar: estimar,
      upscale,
      remover_fundo: removerFundo,
      ferramenta_retomar: retomar,
    } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
  };
}
