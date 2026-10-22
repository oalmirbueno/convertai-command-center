/**
 * Narração da peça de vídeo da campanha no servidor (22/10/2026, caminho Gerar). Uma ação da função
 * agente-calendario, POST { acao: "campanha_narracao", operacao, campanha_id, ... }, sempre com o acesso ao
 * cliente conferido:
 *
 * - vozes { tema_id?, marca_id? } -> { tem_chave, aviso_chave, vozes_da_marca, vozes, modelos, modelo_padrao, aviso } (sem custo)
 *     as vozes da conta da ElevenLabs e as que a marca já usa na Mesa Motion (motion_vozes).
 * - gerar { tema_id, voz_id, voz_nome?, modelo?, confirmado? }
 *     o texto são as falas das cenas do roteiro_video da peça, na ordem, numa chamada só (TTS com tempo
 *     por caractere). Sem `confirmado: true` responde 409 confirmar_custo com custo_estimado_usd (nada
 *     gasto); com ele, gera, cobra na carteira do cliente (ia_registrar_uso), guarda o MP3 no bucket mesa
 *     (<cliente>/campanhas/<id>/narracao/...) e na Mídia (video_arquivos, grupo narracao), e grava em
 *     itens[].roteiro_video.narracao da peça: o arquivo, a duração e o trecho de cada cena.
 * - registrar { tema_id, cena? | cenas?: [{ ordem, pedido_id | null, motor? }], montagem?: { versao_id } | null } (sem custo)
 *     o pedido da Mesa Vídeos que fez a cena em vídeo e a versão montada na Mesa Edição, no mesmo item.
 *
 * O padrão é o da trilha (trilha-da-campanha.ts): chave pelo chave() do painel, saldo antes, a mesma
 * cobrança. Regras puras em narracao-da-campanha-regras.ts. Sem travessão.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Conexao, ErroDaVoz, falar, listarVozes } from "../../mesa-motion/modulos/elevenlabs.ts";
import {
  AJUSTES_PADRAO,
  duracaoDoMp3,
  fimDoAlinhamento,
  lerAlinhamento,
  MODELO_DE_VOZ_PADRAO,
  MODELOS_DE_VOZ,
  palavrasDoAlinhamento,
  palavrasDoTexto,
  trechosDoRoteiro,
  voiceSettings,
} from "../../mesa-motion/modulos/narracao.ts";
import { registrarFalha } from "../../_shared/falha-registrada.ts";
import { type NarracaoDoRoteiro, normalizarNarracaoDoRoteiro, normalizarRoteiroDeVideo, type RoteiroDeVideo } from "./roteiro-de-video.ts";
import { assinaturaDaCena, falasDaNarracao, pedidoDaNarracao, textoDaNarracao } from "./narracao-da-campanha-regras.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOICE_ID = /^[A-Za-z0-9]{8,64}$/;
const REF = "mesa_campanha";
const BALDE = "mesa";
const arred = (n: number) => Math.round(n * 1e6) / 1e6;

type Chamador = { userId: string; token: string; interno?: { clientId: string } };

export interface CampanhaDaNarracao {
  id: string;
  client_id: string;
  nome: string;
  proposta_id: string | null;
}

export interface ItemDaNarracao {
  tema_id?: string;
  formato?: string;
  tema?: string;
  roteiro_video?: RoteiroDeVideo | null;
  [k: string]: unknown;
}

export interface PropostaDaNarracao {
  id: string;
  client_id: string;
  itens: ItemDaNarracao[];
}

export interface DepsDaNarracao {
  erro: (status: number, codigo: string, mensagem: string, extra?: Record<string, unknown>) => Error;
  json: (body: unknown, status?: number) => Response;
  carregarCampanha: (s: SupabaseClient, id: unknown) => Promise<CampanhaDaNarracao>;
  exigirAcesso: (ch: Chamador, clientId: string) => Promise<void>;
  carregarProposta: (s: SupabaseClient, id: unknown) => Promise<PropostaDaNarracao>;
  /** Grava os itens da proposta (sempre presa ao client_id dela) e devolve a proposta salva. */
  salvarItens: (s: SupabaseClient, p: PropostaDaNarracao, itens: ItemDaNarracao[]) => Promise<PropostaDaNarracao>;
  somarCusto: (s: SupabaseClient, id: string, clientId: string, valor: number) => Promise<void>;
  /** Confere o saldo da carteira antes de gastar (garantirSaldo do motor). */
  garantirSaldo: (clientId: string, estimativa: number) => Promise<unknown>;
  /** A chave da ElevenLabs (vazia quando não há). */
  lerChave: () => Promise<string>;
  /** Para teste: o fetch da ElevenLabs. */
  fetchImpl?: typeof fetch;
  /** Para teste: o relógio. */
  agora?: () => Date;
}

const semTabela = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /motion_vozes/.test(String(e.message || "")));
const nomeSeguro = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "peca";

export function acoesDaNarracao(d: DepsDaNarracao) {
  const agora = () => (d.agora ? d.agora() : new Date());

  async function campanhaComAcesso(servico: SupabaseClient, ch: Chamador, id: unknown) {
    const c = await d.carregarCampanha(servico, id);
    await d.exigirAcesso(ch, c.client_id);
    return c;
  }

  /** A peça de vídeo da série da campanha (com o roteiro normalizado). */
  async function pecaDaCampanha(servico: SupabaseClient, c: CampanhaDaNarracao, temaId: unknown) {
    if (!c.proposta_id) throw d.erro(400, "campanha_sem_serie", "A campanha ainda não tem a série de conteúdos.");
    const proposta = await d.carregarProposta(servico, c.proposta_id);
    if (proposta.client_id !== c.client_id) throw d.erro(403, "serie_de_outro_cliente", "A série não é deste cliente.");
    const tid = String(temaId ?? "").slice(0, 40);
    const item = proposta.itens.find((i) => i.tema_id === tid);
    if (!tid || !item) throw d.erro(404, "peca_inexistente", "Esta peça não está mais na série.");
    if (item.formato !== "video") throw d.erro(400, "peca_nao_e_video", "Só as peças de vídeo têm narração.");
    return { proposta, item, temaId: tid, roteiro: normalizarRoteiroDeVideo(item.roteiro_video) };
  }

  /**
   * Muda o roteiro da peça relendo a série na hora de gravar (o que mudou na série durante a geração não
   * se perde). `mudar` recebe o roteiro atual e devolve o novo.
   */
  async function gravarNoRoteiro(servico: SupabaseClient, c: CampanhaDaNarracao, temaId: string, mudar: (r: RoteiroDeVideo) => RoteiroDeVideo) {
    const atual = await d.carregarProposta(servico, c.proposta_id);
    const item = atual.itens.find((i) => i.tema_id === temaId);
    const r = item ? normalizarRoteiroDeVideo(item.roteiro_video) : null;
    if (!item || !r) throw d.erro(409, "roteiro_mudou", "O roteiro desta peça saiu da série enquanto isso. Atualize a tela.");
    const novo = normalizarRoteiroDeVideo(mudar(r));
    const itemNovo: ItemDaNarracao = { ...item, roteiro_video: novo };
    const salva = await d.salvarItens(servico, atual, atual.itens.map((i) => (i.tema_id === temaId ? itemNovo : i)));
    return { proposta: salva, item: itemNovo };
  }

  /** Erro da ElevenLabs no padrão da casa (a mensagem nunca leva a chave). */
  const traduzir = (e: unknown) => (e instanceof ErroDaVoz ? d.erro(e.status, e.codigo, e.message) : e);

  async function conexao(): Promise<Conexao> {
    const chave = await d.lerChave().catch(() => "");
    if (!chave) throw traduzir(new ErroDaVoz("voz_sem_chave"));
    return { chave, fetchImpl: d.fetchImpl, timeoutMs: 120_000 };
  }

  /** Registra o gasto na carteira do cliente, como a trilha da campanha. Falha vai para o log. */
  async function cobrar(servico: SupabaseClient, c: CampanhaDaNarracao, ch: Chamador, p: { modelo: string; caracteres: number; custo: number }): Promise<number | null> {
    if (!(p.custo > 0)) return null;
    const { data, error } = await servico.rpc("ia_registrar_uso", {
      _client_id: c.client_id,
      _tarefa: "calendario",
      _agente: "estrategista",
      _modelo_id: `elevenlabs:${p.modelo}`,
      _provedor: "elevenlabs",
      _tokens_entrada: Math.max(0, Math.round(p.caracteres)),
      _tokens_saida: 0,
      _tokens_cache: 0,
      _imagens: 0,
      _qualidade: null,
      _custo_usd: arred(p.custo),
      _custo_fonte: "tabela",
      _referencia_tipo: REF,
      _referencia_id: c.id,
      _criado_por: ch.userId,
      _chave_origem: "agencia",
      _chave_id: null,
    });
    if (error) {
      registrarFalha("narração da campanha: uso da ElevenLabs não registrado", error, { client_id: c.client_id, campanha_id: c.id });
      return null;
    }
    const l = (Array.isArray(data) ? data[0] : data) as { saldo_usd?: unknown } | null;
    return l && isFinite(Number(l.saldo_usd)) ? Number(l.saldo_usd) : null;
  }

  /** As vozes que a marca já usa na Mesa Motion (a marca que não é a principal nunca herda a voz da outra). */
  async function vozesDaMarca(servico: SupabaseClient, clientId: string, marcaId: string | null) {
    let q = servico.from("motion_vozes").select("voice_id, nome, origem, padrao, previa_path").eq("client_id", clientId).is("arquivado_em", null).order("criado_em", { ascending: false }).limit(40);
    q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);
    const { data, error } = await q;
    if (semTabela(error)) return [];
    if (error) {
      registrarFalha("narração da campanha: vozes da marca ilegíveis", error, { client_id: clientId });
      return [];
    }
    const linhas = ((data as Array<Record<string, unknown>>) || []).filter((v) => typeof v.voice_id === "string" && VOICE_ID.test(v.voice_id));
    const caminhos = linhas.map((v) => String(v.previa_path || "")).filter((p) => p.indexOf(`${clientId}/`) === 0);
    const links: Record<string, string> = {};
    if (caminhos.length) {
      const { data: assinados } = await servico.storage.from(BALDE).createSignedUrls(caminhos, 3600);
      ((assinados || []) as Array<{ path: string | null; signedUrl: string; error: string | null }>).forEach((x) => {
        if (x.path && x.signedUrl && !x.error) links[x.path] = x.signedUrl;
      });
    }
    return linhas.map((v) => ({
      voice_id: String(v.voice_id),
      nome: String(v.nome || "Voz da marca").slice(0, 80),
      origem: String(v.origem || ""),
      padrao: v.padrao === true,
      previa_url: typeof v.previa_path === "string" ? links[v.previa_path] || null : null,
    }));
  }

  async function vozes(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const marcaId = typeof corpo.marca_id === "string" && UUID.test(corpo.marca_id) ? corpo.marca_id : null;
    const daMarca = await vozesDaMarca(servico, c.client_id, marcaId);
    const chave = await d.lerChave().catch(() => "");
    let daConta: Awaited<ReturnType<typeof listarVozes>>["vozes"] = [];
    let aviso: string | null = null;
    if (chave) {
      try {
        daConta = (await listarVozes({ chave, fetchImpl: d.fetchImpl, timeoutMs: 20_000 }, { tamanho: 60 })).vozes;
      } catch (e) {
        aviso = e instanceof Error ? e.message : "Não deu para listar as vozes da ElevenLabs agora.";
      }
    }
    return d.json({
      tem_chave: !!chave,
      aviso_chave: chave ? null : new ErroDaVoz("voz_sem_chave").message,
      vozes_da_marca: daMarca,
      vozes: daConta.map((v) => ({ voice_id: v.voice_id, nome: v.nome, categoria: v.categoria, descricao: v.descricao, previa_url: v.previa_pt || v.previa_url, idiomas: v.idiomas })),
      modelos: MODELOS_DE_VOZ,
      modelo_padrao: MODELO_DE_VOZ_PADRAO,
      aviso,
      custo_usd: 0,
    });
  }

  async function gerar(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const { temaId, roteiro, item } = await pecaDaCampanha(servico, c, corpo.tema_id);
    if (!roteiro) throw d.erro(409, "sem_roteiro", "Gere ou escreva o roteiro desta peça antes da narração.");
    const falas = falasDaNarracao(roteiro);
    if (!falas.length) throw d.erro(409, "sem_falas", "As cenas desta peça não têm fala. Escreva as falas antes da narração.");
    const vozId = String(corpo.voz_id ?? "");
    if (!VOICE_ID.test(vozId)) throw d.erro(400, "voz_invalida", "Escolha a voz da narração.");
    const pedido = pedidoDaNarracao(roteiro, corpo.modelo);
    const m = pedido.modelo;
    if (pedido.caracteres > m.limite) throw d.erro(422, "falas_longas", `As falas passam de ${m.limite} caracteres para o ${m.rotulo}. Encurte o roteiro.`);
    if (corpo.confirmado !== true) {
      throw d.erro(409, "confirmar_custo", `A narração (${pedido.caracteres} caracteres, ${m.rotulo}) custa cerca de US$ ${pedido.custo_usd.toFixed(2).replace(".", ",")}. Confirme para continuar.`, {
        precisa_confirmar: true,
        custo_estimado_usd: pedido.custo_usd,
        caracteres: pedido.caracteres,
        modelo: m.id,
      });
    }
    const conn = await conexao();
    await d.garantirSaldo(c.client_id, pedido.custo_usd);
    let gerada: Awaited<ReturnType<typeof falar>>;
    try {
      gerada = await falar(conn, { voiceId: vozId, texto: pedido.enviado, modelo: m.id, idioma: m.idioma ? "pt" : null, voiceSettings: voiceSettings(AJUSTES_PADRAO()) });
    } catch (e) {
      throw traduzir(e);
    }
    const saldo = await cobrar(servico, c, ch, { modelo: m.id, caracteres: pedido.caracteres, custo: pedido.custo_usd });
    const alinhamento = lerAlinhamento(gerada.alinhamento);
    const palavras = palavrasDoAlinhamento(alinhamento);
    const duracao = fimDoAlinhamento(alinhamento) || duracaoDoMp3(gerada.bytes.length);
    const trechos = trechosDoRoteiro(falas.map((f) => ({ cena_id: String(f.ordem), texto: f.texto })), palavras, duracao);
    const avisos: string[] = [];
    if (palavras.length !== falas.reduce((s, f) => s + palavrasDoTexto(f.texto).length, 0)) avisos.push("O tempo de cada cena saiu pela proporção do texto (a leitura mudou algumas palavras). Confira a sincronia.");
    const em = agora().toISOString();
    const caminho = `${c.client_id}/campanhas/${c.id}/narracao/${nomeSeguro(temaId)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.mp3`;
    const up = await servico.storage.from(BALDE).upload(caminho, gerada.bytes, { contentType: "audio/mpeg", upsert: false });
    if (up.error) {
      registrarFalha("narração da campanha: áudio não subiu", up.error, { caminho });
      await d.somarCusto(servico, c.id, c.client_id, pedido.custo_usd);
      throw d.erro(502, "narracao_nao_guardada", "A narração foi gerada (e cobrada), mas não ficou guardada. Tente de novo.");
    }
    const tituloDaPeca = String(item.tema || "Vídeo").slice(0, 60);
    const { data: linha, error: eMidia } = await servico
      .from("video_arquivos")
      .insert({
        client_id: c.client_id,
        nome: `Narração ${tituloDaPeca}`.slice(0, 120),
        nome_original: caminho.split("/").pop() || "narracao.mp3",
        storage_bucket: BALDE,
        storage_path: caminho,
        tipo: "audio",
        mime: "audio/mpeg",
        bytes: gerada.bytes.length,
        duracao_s: duracao,
        grupo: "narracao",
        nota: `ElevenLabs ${m.rotulo}, voz ${String(corpo.voz_nome || vozId).slice(0, 60)}. Campanha ${c.nome}, peça ${tituloDaPeca}.`.slice(0, 600),
        // Sem campanha_id na origem: a lista de sons da aba Trilha não mostra a narração.
        origem: { campanha_narracao_id: c.id, tema_id: temaId, som: "narracao", provedor: "elevenlabs", modelo: m.id, voice_id: vozId },
        criado_por: ch.userId,
      })
      .select("id")
      .single();
    if (eMidia || !linha) {
      registrarFalha("narração da campanha: áudio fora da Mídia", eMidia, { caminho });
      avisos.push("A narração ficou na peça, mas não apareceu na Mídia do cliente.");
    }
    const narracao: NarracaoDoRoteiro | undefined = normalizarNarracaoDoRoteiro({
      arquivo: caminho,
      arquivo_id: linha ? (linha as { id: string }).id : null,
      duracao_s: duracao,
      voz: { voice_id: vozId, nome: String(corpo.voz_nome || "Voz").slice(0, 80) },
      modelo: m.id,
      texto: textoDaNarracao(roteiro),
      cenas: trechos.map((t) => ({ ordem: Number(t.cena_id), de_s: t.de_s, ate_s: t.ate_s })),
      palavras,
      custo_usd: pedido.custo_usd,
      em,
    });
    if (!narracao) throw d.erro(502, "narracao_invalida", "A narração voltou sem o essencial. Tente de novo.");
    const gravado = await gravarNoRoteiro(servico, c, temaId, (r) => ({ ...r, narracao }));
    await d.somarCusto(servico, c.id, c.client_id, pedido.custo_usd);
    const { data: assinado } = await servico.storage.from(BALDE).createSignedUrl(caminho, 3600);
    return d.json({
      narracao,
      link: assinado && (assinado as { signedUrl?: string }).signedUrl ? (assinado as { signedUrl: string }).signedUrl : null,
      cenas: narracao.cenas,
      duracao_s: narracao.duracao_s,
      item: gravado.item,
      proposta: gravado.proposta,
      avisos,
      custo_usd: pedido.custo_usd,
      saldo_usd: saldo,
    });
  }

  async function registrar(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const { temaId, roteiro } = await pecaDaCampanha(servico, c, corpo.tema_id);
    if (!roteiro) throw d.erro(409, "sem_roteiro", "Esta peça ainda não tem roteiro.");
    // Uma cena (cena) ou várias de uma vez (cenas): gravadas juntas, sem uma apagar a outra.
    const pedidas = (Array.isArray(corpo.cenas) ? (corpo.cenas as unknown[]) : corpo.cena ? [corpo.cena] : [])
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
      .filter((x): x is Record<string, unknown> => !!x)
      .slice(0, 8);
    const temMontagem = Object.prototype.hasOwnProperty.call(corpo, "montagem");
    if (!pedidas.length && !temMontagem) throw d.erro(400, "nada_a_registrar", "Diga a cena ou a montagem.");
    const cenas: Array<{ ordem: number; pedidoId: string | null; motor: string }> = [];
    for (const cena of pedidas) {
      const ordem = Math.round(Number(cena.ordem));
      if (!roteiro.cenas.some((x) => x.ordem === ordem)) throw d.erro(404, "cena_inexistente", "Esta cena não está no roteiro.");
      let pedidoId: string | null = null;
      if (cena.pedido_id !== null && cena.pedido_id !== undefined) {
        pedidoId = String(cena.pedido_id);
        if (!UUID.test(pedidoId)) throw d.erro(400, "pedido_invalido", "Pedido de vídeo inválido.");
        const { data } = await servico.from("video_pedidos").select("id, client_id").eq("id", pedidoId).maybeSingle();
        if (!data || (data as { client_id: string }).client_id !== c.client_id) throw d.erro(404, "pedido_inexistente", "Este pedido de vídeo não é deste cliente.");
      }
      cenas.push({ ordem, pedidoId, motor: String(cena.motor || "").slice(0, 60) });
    }
    let versaoId: string | null = null;
    if (temMontagem && corpo.montagem) {
      versaoId = String((corpo.montagem as Record<string, unknown>).versao_id ?? "");
      if (!UUID.test(versaoId)) throw d.erro(400, "versao_invalida", "Versão inválida.");
      const { data } = await servico.from("video_versoes").select("id, client_id").eq("id", versaoId).maybeSingle();
      if (!data || (data as { client_id: string }).client_id !== c.client_id) throw d.erro(404, "versao_inexistente", "Esta versão não é deste cliente.");
    }
    const em = agora().toISOString();
    const gravado = await gravarNoRoteiro(servico, c, temaId, (r) => {
      let novo: RoteiroDeVideo = r;
      if (cenas.length) {
        novo = {
          ...novo,
          cenas: novo.cenas.map((x) => {
            const pedida = cenas.find((p) => p.ordem === x.ordem);
            if (!pedida) return x;
            const { video: _antigo, ...resto } = x;
            return pedida.pedidoId ? { ...resto, video: { pedido_id: pedida.pedidoId, motor: pedida.motor, assinatura: assinaturaDaCena(x), em } } : resto;
          }),
        };
      }
      if (temMontagem) {
        const { montagem: _antiga, ...resto } = novo;
        novo = versaoId ? { ...resto, montagem: { versao_id: versaoId, em } } : resto;
      }
      return novo;
    });
    return d.json({ item: gravado.item, proposta: gravado.proposta, custo_usd: 0 });
  }

  const OPERACOES: Record<string, (s: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
    vozes,
    gerar,
    registrar,
  };

  /** campanha_narracao { operacao, ... } */
  async function campanhaNarracao(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
    const op = String(corpo.operacao ?? "vozes");
    const fn = OPERACOES[op];
    if (!fn) throw d.erro(400, "operacao_desconhecida", "Operação da narração desconhecida.", { aceitas: Object.keys(OPERACOES) });
    return await fn(servico, ch, corpo);
  }

  return { campanhaNarracao };
}
