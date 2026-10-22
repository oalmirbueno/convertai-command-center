/**
 * Trilha e efeitos da campanha no servidor (22/10/2026). Uma ação da função
 * agente-calendario, POST { acao: "campanha_trilha", operacao, campanha_id, ... },
 * sempre com o acesso ao cliente conferido:
 *
 * - estado -> { tem_chave, provedores, tema, temas, pacote, custos, sons, escolhida } (sem custo)
 * - gerar_trilha { duracao: 15|30|60, loop?, opcoes: 2|3, extra?, tema?, provedor?, confirmado? }
 *     sem `confirmado: true` responde 409 confirmar_custo com o custo (nada gasto);
 *     com ele, as opções saem em paralelo pela ElevenLabs Music, sempre instrumentais.
 * - gerar_efeitos { efeitos?: ids do pacote do tema, livre?: texto, duracao?, tema?, confirmado? }
 *     mesmo custo antes; ElevenLabs Sound Effects.
 * - escolher { som_id | null } -> vira briefing.trilha { arquivo, titulo, duracao, origem }
 *     e o MP3 vai para Arquivos do cliente (pasta Criativos, etiqueta da campanha). null tira.
 * - favoritar { som_id, favorito }
 *
 * Os sons gerados moram no Storage (bucket mesa, pasta da campanha) e na Mídia
 * do cliente (video_arquivos, tipo audio, origem.campanha_id), como a trilha da
 * Mesa Motion; a cobrança vai para a carteira do cliente pelo mesmo
 * ia_registrar_uso (chave da agência, preço de tabela). Regras puras em
 * trilha-da-campanha-regras.ts. O provedor "suno" está desligado lá.
 * Sem travessão.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { comporMusica, type Conexao, ErroDaVoz, gerarEfeito } from "../../mesa-motion/modulos/elevenlabs.ts";
import { duracaoDoMp3, MODELO_DA_MUSICA, MODELO_DOS_EFEITOS } from "../../mesa-motion/modulos/narracao.ts";
import { registrarFalha } from "../../_shared/falha-registrada.ts";
import {
  briefingComTrilha,
  type CampanhaParaOSom,
  custoDaTrilha,
  custoDosEfeitos,
  efeitoLivre,
  type EfeitoDoTema,
  opcoesValidas,
  pacoteDeEfeitos,
  pedidosDaTrilha,
  PROVEDORES_DE_TRILHA,
  provedorParaGerar,
  tabelaDeCustos,
  temaDaCampanha,
  TEMAS_SONOROS,
  trilhaDoBriefing,
  type TrilhaDoBriefing,
} from "./trilha-da-campanha-regras.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = "mesa_campanha";
const BALDE = "mesa";
const arred = (n: number) => Math.round(n * 1e6) / 1e6;

type Chamador = { userId: string; token: string; interno?: { clientId: string } };

export interface CampanhaDaTrilha {
  id: string;
  client_id: string;
  nome: string;
  pedido: string | null;
  objetivo: string | null;
  conceito: string | null;
  identidade: Record<string, unknown> | null;
  briefing?: Record<string, unknown> | null;
}

export interface DepsDaTrilha {
  erro: (status: number, codigo: string, mensagem: string, extra?: Record<string, unknown>) => Error;
  json: (body: unknown, status?: number) => Response;
  carregarCampanha: (s: SupabaseClient, id: unknown) => Promise<CampanhaDaTrilha>;
  exigirAcesso: (ch: Chamador, clientId: string) => Promise<void>;
  somarCusto: (s: SupabaseClient, id: string, clientId: string, valor: number) => Promise<void>;
  /** Confere o saldo da carteira antes de gastar (garantirSaldo do motor). */
  garantirSaldo: (clientId: string, estimativa: number) => Promise<unknown>;
  /** A chave da ElevenLabs (vazia quando não há). */
  lerChave: () => Promise<string>;
  /** Cliente com o JWT de quem chamou (o registro em Arquivos confere o acesso no banco). */
  clienteDoChamador: (token: string) => SupabaseClient;
  /** Para teste: o fetch da ElevenLabs. */
  fetchImpl?: typeof fetch;
}

export interface SomDaCampanha {
  id: string;
  tipo: "trilha" | "efeito";
  titulo: string;
  duracao_s: number;
  favorito: boolean;
  loop: boolean;
  tema: string | null;
  caminho: string;
  link: string | null;
  escolhida: boolean;
  criado_em: string;
}

function campanhaParaOSom(c: CampanhaDaTrilha): CampanhaParaOSom {
  const b = (c.briefing && typeof c.briefing === "object" ? c.briefing : {}) as Record<string, unknown>;
  const id = (c.identidade && typeof c.identidade === "object" ? c.identidade : {}) as Record<string, unknown>;
  return {
    nome: c.nome,
    pedido: c.pedido,
    conceito: c.conceito,
    objetivo: c.objetivo,
    tipo: typeof id.tipo === "string" ? id.tipo : null,
    tom_da_campanha: typeof b.tom_da_campanha === "string" ? b.tom_da_campanha : null,
    tom: typeof b.tom === "string" ? b.tom : typeof id.tom === "string" ? id.tom : null,
  };
}

const pastaDosSons = (c: CampanhaDaTrilha) => `${c.client_id}/campanhas/${c.id}/sons`;
const nomeSeguro = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "trilha";

export function acoesDaTrilha(d: DepsDaTrilha) {
  async function campanhaComAcesso(servico: SupabaseClient, ch: Chamador, id: unknown) {
    const c = await d.carregarCampanha(servico, id);
    await d.exigirAcesso(ch, c.client_id);
    return c;
  }

  /** Erro da ElevenLabs no padrão da casa (a mensagem nunca leva a chave). */
  const traduzir = (e: unknown) => (e instanceof ErroDaVoz ? d.erro(e.status, e.codigo, e.message) : e);

  async function conexao(): Promise<Conexao> {
    const chave = await d.lerChave().catch(() => "");
    if (!chave) throw traduzir(new ErroDaVoz("voz_sem_chave"));
    return { chave, fetchImpl: d.fetchImpl };
  }

  /** Registra o gasto na carteira do cliente, como a trilha da Mesa Motion. Falha vai para o log. */
  async function cobrar(servico: SupabaseClient, c: CampanhaDaTrilha, ch: Chamador, p: { modelo: string; caracteres: number; custo: number }): Promise<number | null> {
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
      registrarFalha("trilha da campanha: uso da ElevenLabs não registrado", error, { client_id: c.client_id, campanha_id: c.id });
      return null;
    }
    const l = (Array.isArray(data) ? data[0] : data) as { saldo_usd?: unknown } | null;
    return l && isFinite(Number(l.saldo_usd)) ? Number(l.saldo_usd) : null;
  }

  async function guardarSom(servico: SupabaseClient, c: CampanhaDaTrilha, ch: Chamador, p: { bytes: Uint8Array; tipo: "trilha" | "efeito"; titulo: string; duracao: number; loop: boolean; tema: string; prompt: string; modelo: string }): Promise<string | null> {
    const caminho = `${pastaDosSons(c)}/${p.tipo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.mp3`;
    const up = await servico.storage.from(BALDE).upload(caminho, p.bytes, { contentType: "audio/mpeg", upsert: false });
    if (up.error) {
      registrarFalha("trilha da campanha: áudio não subiu", up.error, { caminho });
      return null;
    }
    const real = duracaoDoMp3(p.bytes.length) || p.duracao;
    const { data, error } = await servico
      .from("video_arquivos")
      .insert({
        client_id: c.client_id,
        nome: p.titulo.slice(0, 120),
        nome_original: caminho.split("/").pop() || "som.mp3",
        storage_bucket: BALDE,
        storage_path: caminho,
        tipo: "audio",
        mime: "audio/mpeg",
        bytes: p.bytes.length,
        duracao_s: real,
        grupo: p.tipo === "trilha" ? "trilha_gerada" : "efeito",
        nota: `ElevenLabs ${p.tipo === "trilha" ? "Music" : "efeitos"} (${p.modelo})${p.tipo === "trilha" ? ", instrumental" : ""}. Campanha ${c.nome}. Pedido: ${p.prompt}`.slice(0, 600),
        origem: { campanha_id: c.id, som: p.tipo, tema: p.tema, loop: p.loop, provedor: "elevenlabs", duracao_pedida: p.duracao },
        criado_por: ch.userId,
      })
      .select("id")
      .single();
    if (error || !data) {
      registrarFalha("trilha da campanha: som fora da Mídia", error, { caminho });
      return null;
    }
    return (data as { id: string }).id;
  }

  async function lerSons(servico: SupabaseClient, c: CampanhaDaTrilha): Promise<SomDaCampanha[]> {
    const { data, error } = await servico
      .from("video_arquivos")
      .select("id, nome, duracao_s, melhor, storage_path, origem, criado_em")
      .eq("client_id", c.client_id)
      .eq("tipo", "audio")
      .eq("estado", "ativo")
      .eq("origem->>campanha_id", c.id)
      .order("criado_em", { ascending: false })
      .limit(60);
    if (error) throw d.erro(503, "sons_indisponiveis", "Não foi possível ler os sons da campanha agora.");
    const linhas = (data ?? []) as Array<{ id: string; nome: string; duracao_s: number | null; melhor: boolean; storage_path: string; origem: Record<string, unknown> | null; criado_em: string }>;
    const escolhida = trilhaDoBriefing((c.briefing || {}).trilha);
    const caminhos = linhas.map((l) => l.storage_path).filter((p) => p.indexOf(`${c.client_id}/`) === 0);
    const links: Record<string, string> = {};
    if (caminhos.length) {
      const { data: assinados } = await servico.storage.from(BALDE).createSignedUrls(caminhos, 3600);
      ((assinados || []) as Array<{ path: string | null; signedUrl: string; error: string | null }>).forEach((x) => {
        if (x.path && x.signedUrl && !x.error) links[x.path] = x.signedUrl;
      });
    }
    return linhas.map((l) => {
      const o = l.origem || {};
      return {
        id: l.id,
        tipo: o.som === "efeito" ? "efeito" : "trilha",
        titulo: l.nome,
        duracao_s: Number(l.duracao_s) || 0,
        favorito: l.melhor === true,
        loop: o.loop === true,
        tema: typeof o.tema === "string" ? o.tema : null,
        caminho: l.storage_path,
        link: links[l.storage_path] || null,
        escolhida: !!escolhida && (escolhida.som_id === l.id || escolhida.arquivo === l.storage_path),
        criado_em: l.criado_em,
      };
    });
  }

  async function estado(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const tema = temaDaCampanha(campanhaParaOSom(c));
    const chave = await d.lerChave().catch(() => "");
    return d.json({
      tem_chave: !!chave,
      aviso_chave: chave ? null : new ErroDaVoz("voz_sem_chave").message,
      provedores: Object.values(PROVEDORES_DE_TRILHA),
      tema: { id: tema.id, rotulo: tema.rotulo },
      temas: TEMAS_SONOROS.map((t) => ({ id: t.id, rotulo: t.rotulo })),
      pacote: tema.efeitos.map((e) => ({ id: e.id, rotulo: e.rotulo, duracao_s: e.duracao_s })),
      custos: tabelaDeCustos(),
      sons: await lerSons(servico, c),
      escolhida: trilhaDoBriefing((c.briefing || {}).trilha),
      custo_usd: 0,
    });
  }

  /** Custo antes, no padrão da casa: sem `confirmado: true`, 409 com o custo e nada gasto. */
  function exigirConfirmacao(corpo: Record<string, unknown>, custo: number, oque: string) {
    if (corpo.confirmado !== true) {
      throw d.erro(409, "confirmar_custo", `${oque} custa cerca de US$ ${custo.toFixed(2).replace(".", ",")}. Confirme para continuar.`, { precisa_confirmar: true, custo_estimado_usd: custo });
    }
  }

  async function gerarTrilha(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const provedor = provedorParaGerar(corpo.provedor);
    if (!provedor.ligado) throw d.erro(409, "provedor_desligado", provedor.motivo || "Este provedor está desligado.");
    const pedidos = pedidosDaTrilha(campanhaParaOSom(c), { duracao: corpo.duracao, loop: corpo.loop, opcoes: corpo.opcoes, extra: corpo.extra, tema: corpo.tema });
    const custo = custoDaTrilha(corpo.duracao, opcoesValidas(corpo.opcoes));
    exigirConfirmacao(corpo, custo, `${pedidos.length === 2 ? "Duas trilhas" : "Três trilhas"} de ${pedidos[0].duracao_s} s`);
    const conn = await conexao();
    await d.garantirSaldo(c.client_id, custo);
    const feitos = await Promise.allSettled(pedidos.map((p) => comporMusica({ ...conn, timeoutMs: 140_000 }, { prompt: p.prompt, duracao_s: p.duracao_s, modelo: MODELO_DA_MUSICA })));
    const avisos: string[] = [];
    let gasto = 0;
    let saldo: number | null = null;
    let primeiroErro: unknown = null;
    for (let i = 0; i < feitos.length; i++) {
      const f = feitos[i];
      const p = pedidos[i];
      if (f.status === "rejected") {
        primeiroErro = primeiroErro || f.reason;
        avisos.push(`${p.rotulo} não saiu: ${f.reason instanceof Error ? f.reason.message : "falha"}`);
        continue;
      }
      const unit = arred(custo / pedidos.length);
      const s = await cobrar(servico, c, ch, { modelo: MODELO_DA_MUSICA, caracteres: p.prompt.length, custo: unit });
      if (s !== null) saldo = s;
      gasto += unit;
      const id = await guardarSom(servico, c, ch, { bytes: f.value, tipo: "trilha", titulo: p.titulo, duracao: p.duracao_s, loop: p.loop, tema: p.tema, prompt: p.prompt, modelo: MODELO_DA_MUSICA });
      if (!id) avisos.push(`${p.rotulo} foi gerada, mas não ficou guardada. Tente de novo.`);
    }
    if (!(gasto > 0) && primeiroErro) throw traduzir(primeiroErro);
    await d.somarCusto(servico, c.id, c.client_id, arred(gasto));
    return d.json({ sons: await lerSons(servico, c), pedidos: pedidos.map((p) => ({ titulo: p.titulo, prompt: p.prompt })), avisos, custo_usd: arred(gasto), saldo_usd: saldo });
  }

  async function gerarEfeitos(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const { tema, efeitos: pacote } = pacoteDeEfeitos(campanhaParaOSom(c), corpo.tema);
    let lista: EfeitoDoTema[] = [];
    const livre = efeitoLivre(corpo.livre, corpo.duracao);
    if (livre) lista = [livre];
    else {
      const ids = Array.isArray(corpo.efeitos) ? (corpo.efeitos as unknown[]).map(String) : [];
      lista = ids.length ? pacote.filter((e) => ids.indexOf(e.id) >= 0) : pacote;
    }
    if (!lista.length) throw d.erro(400, "efeito_vazio", "Escolha um efeito do pacote ou descreva o som.");
    const custo = custoDosEfeitos(lista);
    exigirConfirmacao(corpo, custo, lista.length === 1 ? "O efeito" : `O pacote de ${lista.length} efeitos`);
    const conn = await conexao();
    await d.garantirSaldo(c.client_id, custo);
    const feitos = await Promise.allSettled(lista.map((e) => gerarEfeito(conn, { texto: e.prompt, duracao_s: e.duracao_s, modelo: MODELO_DOS_EFEITOS })));
    const avisos: string[] = [];
    let gasto = 0;
    let saldo: number | null = null;
    let primeiroErro: unknown = null;
    for (let i = 0; i < feitos.length; i++) {
      const f = feitos[i];
      const e = lista[i];
      if (f.status === "rejected") {
        primeiroErro = primeiroErro || f.reason;
        avisos.push(`${e.rotulo} não saiu: ${f.reason instanceof Error ? f.reason.message : "falha"}`);
        continue;
      }
      const unit = custoDosEfeitos([e]);
      const s = await cobrar(servico, c, ch, { modelo: MODELO_DOS_EFEITOS, caracteres: e.prompt.length, custo: unit });
      if (s !== null) saldo = s;
      gasto += unit;
      const titulo = livre ? `Efeito: ${e.rotulo}` : `${e.rotulo} · ${tema.rotulo}`;
      const id = await guardarSom(servico, c, ch, { bytes: f.value, tipo: "efeito", titulo, duracao: e.duracao_s, loop: false, tema: tema.id, prompt: e.prompt, modelo: MODELO_DOS_EFEITOS });
      if (!id) avisos.push(`${e.rotulo} foi gerado, mas não ficou guardado. Tente de novo.`);
    }
    if (!(gasto > 0) && primeiroErro) throw traduzir(primeiroErro);
    await d.somarCusto(servico, c.id, c.client_id, arred(gasto));
    return d.json({ sons: await lerSons(servico, c), avisos, custo_usd: arred(gasto), saldo_usd: saldo });
  }

  /** O MP3 escolhido vai para Arquivos do cliente (pasta Criativos, etiqueta da campanha). Uma vez por som. */
  async function paraArquivos(servico: SupabaseClient, ch: Chamador, c: CampanhaDaTrilha, som: SomDaCampanha): Promise<{ file_id: string | null; aviso: string | null }> {
    const chaveIdem = `campanha-trilha:${c.id}:${som.id}`;
    const { data: existente } = await servico.from("files").select("id, client_id").eq("idempotency_key", chaveIdem).maybeSingle();
    const ja = existente as { id: string; client_id: string } | null;
    if (ja && ja.client_id === c.client_id) return { file_id: ja.id, aviso: null };
    const baixado = await servico.storage.from(BALDE).download(som.caminho);
    if (baixado.error || !baixado.data) return { file_id: null, aviso: "A trilha ficou escolhida, mas não foi para Arquivos (o áudio não abriu)." };
    const bytes = new Uint8Array(await baixado.data.arrayBuffer());
    const doChamador = d.clienteDoChamador(ch.token);
    const fileId = crypto.randomUUID();
    const nome = `${nomeSeguro(c.nome)}-${nomeSeguro(som.titulo)}`;
    const caminho = `${c.client_id}/${fileId}/v1/1-${nome}.mp3`;
    const up = await doChamador.storage.from("files").upload(caminho, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/mpeg" }), { contentType: "audio/mpeg", upsert: false });
    if (up.error) {
      registrarFalha("trilha da campanha: MP3 não subiu para Arquivos", up.error, { campanha_id: c.id });
      return { file_id: null, aviso: "A trilha ficou escolhida, mas não foi para Arquivos. Tente escolher de novo." };
    }
    const { data: registro, error } = await doChamador.rpc("create_file_record", {
      p_file: {
        id: fileId,
        client_id: c.client_id,
        file_name: `${som.titulo}.mp3`.slice(0, 160),
        file_url: `files://${caminho}`,
        file_type: "audio",
        mime_type: "audio/mpeg",
        extension: "mp3",
        storage_bucket: "files",
        storage_path: caminho,
        size_bytes: bytes.byteLength,
        folder: "criativos",
        tags: ["campanha", `campanha:${c.id}`, "trilha", "elevenlabs"],
        status: "ready",
        version: 1,
        description: `Trilha da campanha "${c.nome}". ElevenLabs Music, instrumental, sem voz. Uso comercial conforme o plano da conta da agência.`.slice(0, 1000),
        idempotency_key: chaveIdem,
      },
    });
    if (error || !registro) {
      await doChamador.storage.from("files").remove([caminho]).catch(() => {});
      registrarFalha("trilha da campanha: registro em Arquivos falhou", error, { campanha_id: c.id });
      return { file_id: null, aviso: "A trilha ficou escolhida, mas o registro em Arquivos falhou. Tente escolher de novo." };
    }
    return { file_id: (registro as { id: string }).id, aviso: null };
  }

  async function escolher(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    let trilha: TrilhaDoBriefing | null = null;
    let aviso: string | null = null;
    if (corpo.som_id !== null && corpo.som_id !== undefined && corpo.som_id !== "") {
      const sid = String(corpo.som_id);
      if (!UUID.test(sid)) throw d.erro(400, "som_invalido", "Som inválido.");
      const som = (await lerSons(servico, c)).find((s) => s.id === sid);
      if (!som) throw d.erro(404, "som_inexistente", "Este som não está na campanha.");
      if (som.tipo !== "trilha") throw d.erro(409, "som_nao_e_trilha", "Só uma trilha vira a trilha da campanha.");
      const r = await paraArquivos(servico, ch, c, som);
      aviso = r.aviso;
      trilha = trilhaDoBriefing({ arquivo: som.caminho, titulo: som.titulo, duracao: som.duracao_s, origem: "elevenlabs", som_id: som.id, file_id: r.file_id || undefined, loop: som.loop, escolhida_em: new Date().toISOString() });
    }
    // Relê na hora de gravar: o resto do briefing que mudou durante a escolha não se perde.
    const atual = await d.carregarCampanha(servico, c.id);
    const briefing = briefingComTrilha(atual.briefing, trilha);
    const { data, error } = await servico.from("mesa_campanhas").update({ briefing }).eq("id", c.id).eq("client_id", c.client_id).select("*").single();
    if (error || !data) throw d.erro(503, "trilha_nao_salva", "Não foi possível gravar a trilha na campanha. Tente de novo.");
    return d.json({ campanha: data, trilha, aviso, custo_usd: 0 });
  }

  async function favoritar(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const sid = String(corpo.som_id ?? "");
    if (!UUID.test(sid)) throw d.erro(400, "som_invalido", "Som inválido.");
    const { data, error } = await servico
      .from("video_arquivos")
      .update({ melhor: corpo.favorito === true })
      .eq("id", sid)
      .eq("client_id", c.client_id)
      .eq("origem->>campanha_id", c.id)
      .select("id")
      .maybeSingle();
    if (error) throw d.erro(503, "favorito_nao_salvo", "Não foi possível marcar agora.");
    if (!data) throw d.erro(404, "som_inexistente", "Este som não está na campanha.");
    return d.json({ som_id: sid, favorito: corpo.favorito === true, custo_usd: 0 });
  }

  const OPERACOES: Record<string, (s: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
    estado,
    gerar_trilha: async (s, ch, corpo) => {
      try {
        return await gerarTrilha(s, ch, corpo);
      } catch (e) {
        throw traduzir(e);
      }
    },
    gerar_efeitos: async (s, ch, corpo) => {
      try {
        return await gerarEfeitos(s, ch, corpo);
      } catch (e) {
        throw traduzir(e);
      }
    },
    escolher,
    favoritar,
  };

  /** campanha_trilha { operacao, ... } */
  async function campanhaTrilha(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
    const op = String(corpo.operacao ?? "estado");
    const fn = OPERACOES[op];
    if (!fn) throw d.erro(400, "operacao_desconhecida", "Operação da trilha desconhecida.", { aceitas: Object.keys(OPERACOES) });
    return await fn(servico, ch, corpo);
  }

  return { campanhaTrilha };
}
