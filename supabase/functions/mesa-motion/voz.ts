/**
 * Voz e som gerados da Mesa Motion (frente MOV, 30/09/2026): narração pela
 * ElevenLabs (Eleven v4 como padrão), voz da marca salva por cliente e marca,
 * desenho e clone de voz (clone só com autorização registrada), falas por
 * cena escritas pela IA com tags de emoção, sincronia das cenas com a
 * duração do áudio, trilha pela ElevenLabs Music, efeitos sob medida e a
 * direção de arte sugerida pelo Jev.
 *
 * A chave ELEVENLABS_API_KEY fica só no servidor. Sem ela, `voz_situacao`
 * diz o que falta e as ações pagas voltam `voz_sem_chave` com a frase.
 * Todo gasto tem o custo antes (tabela), confere o saldo da carteira do
 * cliente e é registrado em ia_usos (tarefa e agente "motion", provedor
 * "elevenlabs", chave da agência). Nada vai ao cliente nem é publicado.
 *
 * Ações (POST { acao, ... } na mesa-motion):
 *   voz_situacao { client_id, marca_id? }       vozes_biblioteca { client_id, busca?, proxima? }
 *   vozes_compartilhadas { client_id, busca?, locale?: pt-BR|pt-PT|todos, genero?, pagina? }  (Voice Library pública)
 *   voz_escolher { client_id, marca_id?, voice_id, public_owner_id?, nome, descricao?, previa_url?, padrao? }
 *   voz_padrao { voz_id }  voz_arquivar { voz_id, arquivar? }  voz_sugerir { client_id, marca_id?, filme_id?, candidatas }
 *   voz_desenhar { client_id, marca_id?, descricao, texto? }  voz_salvar_desenhada { client_id, marca_id?, generated_voice_id, nome, descricao, previa_path? }
 *   voz_clonar { client_id, marca_id?, nome, caminhos, autorizacao: { quem, como, em? }, confirma: true, remover_ruido? }
 *   falas_escrever { filme_id, modelo_id?, pedido?, substituir? }
 *   narracao_gerar { filme_id, modo: roteiro|cenas|cena, cena_id? }  narracao_casar { filme_id }  narracao_remover { filme_id, audio_id }
 *   trilha_gerar { filme_id, prompt?, duracao_s?, uid? }  efeito_gerar { filme_id, descricao, duracao_s, cena_id, t_s }  efeito_remover { filme_id, efeito_id }
 *   direcao_sugerir { filme_id }  acabamento_aplicar { filme_id, acabamento, anteriores? }  storyboard_sugerir { filme_id }
 * Sem travessão.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chamarTexto, cobrarJev, estimarComModelo, garantirSaldo, type ModeloIa } from "../_shared/ia-motor.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { superpoderesPara } from "../_shared/superpoderes.ts";
import { regrasDaMesa } from "../_shared/aprendizado-das-mesas.ts";
import { type CenaDaLinha, duracaoTotal, type LinhaDoFilme, pastaDoFilme, TAMANHOS_DO_MOTION } from "../_shared/motion-metodo.ts";
import {
  type AudioDaNarracao,
  assinarTrechos,
  assinaturaDaFala,
  assinaturaDoAudio,
  casarComANarracao,
  duracaoDoMp3,
  ESQUEMA_DAS_FALAS,
  ESTILOS_DA_VOZ,
  estimarDesenho,
  estimarEfeito,
  estimarMusica,
  estimarNarracao,
  lerAlinhamento,
  lerFalasDoModelo,
  limparFala,
  MODELO_DA_MUSICA,
  MODELO_DO_DESENHO,
  MODELO_DOS_EFEITOS,
  modeloDeVoz,
  MODELOS_DE_VOZ,
  type NarracaoDoFilme,
  narracaoDaCena,
  palavrasDoAlinhamento,
  palavrasDoTexto,
  promptDaTrilha,
  semAudiosDasCenas,
  semTags,
  SISTEMA_DAS_FALAS,
  textoParaOModelo,
  trechosDoRoteiro,
  voiceSettings,
} from "./modulos/narracao.ts";
import { adicionarVozCompartilhada, chaveDaElevenLabs, clonarVoz, comporMusica, type Conexao, desenharVoz, ErroDaVoz, falar, gerarEfeito, listarVozes, listarVozesCompartilhadas, salvarVozDesenhada } from "./modulos/elevenlabs.ts";
import { ACABAMENTOS, ehAcabamento } from "./modulos/pecas-extras.ts";

type Chamador = { userId: string; doChamador: SupabaseClient };
type Acao = (ch: Chamador, c: Record<string, unknown>) => Promise<Response>;

export interface DepsDaVoz {
  servico: () => SupabaseClient;
  json: (body: unknown, status?: number) => Response;
  erro: (status: number, codigo: string, mensagem: string, extra?: Record<string, unknown>) => Error;
  garantirAcesso: (ch: Chamador, clientId: string) => Promise<void>;
  lerFilme: (ch: Chamador, filmeId: unknown, permitirArquivado?: boolean) => Promise<LinhaDoFilme>;
  atualizarFilme: (id: string, campos: Record<string, unknown>) => Promise<LinhaDoFilme>;
  somarCusto: (f: LinhaDoFilme, custo: number, campos?: Record<string, unknown>) => Promise<LinhaDoFilme>;
  modeloDoPedido: (f: LinhaDoFilme, pedido: unknown) => Promise<ModeloIa>;
  kitDoFilme: (f: LinhaDoFilme) => Promise<{ nome: string; estilo: string | null; tom: string | null; regras: string | null }>;
  linksDoFilme: (f: LinhaDoFilme) => Promise<Record<string, string>>;
  pedirBatidas: (ch: Chamador, f: LinhaDoFilme, uid: string) => Promise<unknown>;
  auditar: (ch: Chamador, ferramenta: string, input: Record<string, unknown>, sucesso: boolean, ref?: string | null) => Promise<void>;
  /** Para teste: a chave e o fetch da ElevenLabs. */
  conexao?: () => Conexao;
  /** Para teste: a conferência do saldo da carteira (padrão: garantirSaldo do motor). */
  garantirSaldo?: (clientId: string, estimativaUsd: number) => Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOICE_ID = /^[A-Za-z0-9]{8,64}$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[–—]/g, ",").trim().slice(0, max) : "");
const arred = (n: number) => Math.round(n * 1e6) / 1e6;
const marcaDe = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
const semTabelaDasVozes = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /motion_vozes/.test(String(e.message || "")));
const AVISO_SEM_VOZES = "O banco ainda não tem a voz da marca (migration 20260930315000 pendente).";

export function criarVoz(d: DepsDaVoz) {
  const conexao = (): Conexao => (d.conexao ? d.conexao() : { chave: chaveDaElevenLabs((n) => Deno.env.get(n)) });
  const idDe = (v: unknown, nome: string) => {
    const s = String(v ?? "").trim();
    if (!UUID.test(s)) throw d.erro(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
    return s;
  };
  const exigirChave = () => {
    const c = conexao();
    if (!c.chave) throw new ErroDaVoz("voz_sem_chave");
    return c;
  };
  /**
   * O filme como está AGORA no banco. As ações longas (narração, trilha,
   * efeito, falas) releem antes de gravar e mesclam só o que geraram: o que
   * a equipe mudou na tela durante a geração não é sobrescrito.
   */
  const filmeAtual = (ch: Chamador, f: LinhaDoFilme) => d.lerFilme(ch, f.id, true);

  // ------------------------------------------------------------------ carteira e arquivos

  /** Registra o gasto na carteira do cliente (chave da agência). O pedido já foi feito: falha vai para o log. */
  async function cobrar(clientId: string, p: { modelo: string; caracteres: number; custo: number; ref: { tipo: string; id: string }; userId: string }): Promise<{ saldo: number | null }> {
    if (!(p.custo > 0)) return { saldo: null };
    const { data, error } = await d.servico().rpc("ia_registrar_uso", {
      _client_id: clientId,
      _tarefa: "motion",
      _agente: "motion",
      _modelo_id: `elevenlabs:${p.modelo}`,
      _provedor: "elevenlabs",
      _tokens_entrada: Math.max(0, Math.round(p.caracteres)),
      _tokens_saida: 0,
      _tokens_cache: 0,
      _imagens: 0,
      _qualidade: null,
      _custo_usd: arred(p.custo),
      _custo_fonte: "tabela",
      _referencia_tipo: p.ref.tipo,
      _referencia_id: p.ref.id,
      _criado_por: p.userId,
      _chave_origem: "agencia",
      _chave_id: null,
    });
    if (error) {
      registrarFalha("mesa-motion: uso da ElevenLabs não registrado", error, { client_id: clientId, modelo: p.modelo });
      return { saldo: null };
    }
    const l = (Array.isArray(data) ? data[0] : data) as { saldo_usd?: unknown } | null;
    return { saldo: l && isFinite(Number(l.saldo_usd)) ? Number(l.saldo_usd) : null };
  }

  async function subirAudio(caminho: string, bytes: Uint8Array) {
    const { error } = await d.servico().storage.from("mesa").upload(caminho, bytes, { contentType: "audio/mpeg", upsert: false });
    if (error) {
      registrarFalha("mesa-motion: áudio não subiu", error, { caminho });
      throw d.erro(503, "audio_nao_salvo", "O áudio foi gerado, mas não subiu para o Storage. Tente de novo.");
    }
  }

  /** O áudio vai para a Mídia do cliente (a Mesa Edição e a Mídia enxergam). Falha não derruba: fica no log. */
  async function registrarNaMidia(ch: Chamador, clientId: string, p: { nome: string; caminho: string; bytes: number; duracao_s: number; grupo: string; nota: string }): Promise<string | null> {
    const { data, error } = await d
      .servico()
      .from("video_arquivos")
      .insert({ client_id: clientId, nome: p.nome.slice(0, 120), nome_original: p.caminho.split("/").pop() || "audio.mp3", storage_bucket: "mesa", storage_path: p.caminho, tipo: "audio", mime: "audio/mpeg", bytes: p.bytes, duracao_s: p.duracao_s, grupo: p.grupo, nota: p.nota.slice(0, 600), criado_por: ch.userId })
      .select("id")
      .single();
    if (error || !data) {
      registrarFalha("mesa-motion: áudio fora da Mídia", error, { caminho: p.caminho });
      return null;
    }
    return (data as { id: string }).id;
  }

  const saldoAntes = async (clientId: string, estimativa: number) => {
    if (estimativa > 0) await (d.garantirSaldo || garantirSaldo)(clientId, estimativa);
  };

  // ------------------------------------------------------------------ vozes da marca

  async function vozesDaMarca(clientId: string, marcaId: string | null) {
    let q = d.servico().from("motion_vozes").select("id, voice_id, nome, descricao, origem, modelo, ajustes, previa_path, previa_url, padrao, criado_em").eq("client_id", clientId).is("arquivado_em", null).order("criado_em", { ascending: false }).limit(40);
    // A marca que não é a principal nunca herda a voz da outra.
    q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);
    const { data, error } = await q;
    if (semTabelaDasVozes(error)) return { vozes: [] as Record<string, unknown>[], indisponivel: true };
    if (error) throw d.erro(503, "vozes_indisponiveis", "Não foi possível ler as vozes da marca agora.");
    return { vozes: (data as Record<string, unknown>[]) || [], indisponivel: false };
  }

  async function comLinks(vozes: Record<string, unknown>[], clientId: string) {
    const caminhos = vozes.map((v) => String(v.previa_path || "")).filter((p) => p.indexOf(`${clientId}/`) === 0);
    if (!caminhos.length) return vozes;
    const { data } = await d.servico().storage.from("mesa").createSignedUrls(caminhos, 3600);
    const links: Record<string, string> = {};
    ((data || []) as Array<{ path: string | null; signedUrl: string; error: string | null }>).forEach((x) => {
      if (x.path && x.signedUrl && !x.error) links[x.path] = x.signedUrl;
    });
    return vozes.map((v) => ({ ...v, previa_link: typeof v.previa_path === "string" ? links[v.previa_path] || null : null }));
  }

  const vozSituacao: Acao = async (ch, c) => {
    const clientId = idDe(c.client_id, "client_id");
    await d.garantirAcesso(ch, clientId);
    const marcaId = marcaDe(c.marca_id);
    const lidas = await vozesDaMarca(clientId, marcaId);
    return d.json({
      tem_chave: !!conexao().chave,
      aviso_chave: conexao().chave ? null : new ErroDaVoz("voz_sem_chave").message,
      vozes: await comLinks(lidas.vozes, clientId),
      padrao: lidas.vozes.find((v) => v.padrao === true) || null,
      indisponivel: lidas.indisponivel,
      aviso: lidas.indisponivel ? AVISO_SEM_VOZES : null,
      modelos: MODELOS_DE_VOZ,
      custo_usd: 0,
    });
  };

  const vozesBiblioteca: Acao = async (ch, c) => {
    const clientId = idDe(c.client_id, "client_id");
    await d.garantirAcesso(ch, clientId);
    const r = await listarVozes(exigirChave(), { busca: limpo(c.busca, 80), proxima: typeof c.proxima === "string" ? c.proxima : null, tamanho: 30 });
    return d.json({ ...r, custo_usd: 0 });
  };

  /** A Voice Library pública da ElevenLabs em português (Brasil por padrão), com prévia. Só lista: nada entra na conta. */
  const vozesCompartilhadas: Acao = async (ch, c) => {
    const clientId = idDe(c.client_id, "client_id");
    await d.garantirAcesso(ch, clientId);
    const locale = c.locale === "pt-PT" || c.locale === "todos" ? (c.locale === "todos" ? null : "pt-PT") : "pt-BR";
    const genero = c.genero === "female" || c.genero === "male" ? String(c.genero) : null;
    const r = await listarVozesCompartilhadas(exigirChave(), { busca: limpo(c.busca, 80), idioma: "pt", locale, genero, pagina: Number(c.pagina) || 0, tamanho: 30 });
    return d.json({ ...r, custo_usd: 0 });
  };

  async function marcarPadrao(clientId: string, marcaId: string | null, vozId: string) {
    let q = d.servico().from("motion_vozes").update({ padrao: false }).eq("client_id", clientId).eq("padrao", true).is("arquivado_em", null).neq("id", vozId);
    q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);
    const { error } = await q;
    if (error) throw d.erro(503, "voz_nao_salva", "Não foi possível trocar a voz padrão agora.");
    const r = await d.servico().from("motion_vozes").update({ padrao: true }).eq("id", vozId);
    if (r.error) throw d.erro(503, "voz_nao_salva", "Não foi possível trocar a voz padrão agora.");
  }

  async function guardarVoz(ch: Chamador, clientId: string, marcaId: string | null, v: { voice_id: string; nome: string; descricao?: string | null; origem: "biblioteca" | "desenhada" | "clonada"; previa_url?: string | null; previa_path?: string | null; autorizacao?: Record<string, unknown> | null; padrao: boolean }) {
    let q = d.servico().from("motion_vozes").select("id").eq("client_id", clientId).eq("voice_id", v.voice_id).is("arquivado_em", null);
    q = marcaId ? q.eq("marca_id", marcaId) : q.is("marca_id", null);
    const achada = await q.maybeSingle();
    if (semTabelaDasVozes(achada.error)) throw d.erro(503, "banco_sem_vozes", AVISO_SEM_VOZES);
    let id = achada.data ? (achada.data as { id: string }).id : "";
    if (!id) {
      const ins = await d
        .servico()
        .from("motion_vozes")
        .insert({ client_id: clientId, marca_id: marcaId, voice_id: v.voice_id, nome: v.nome.slice(0, 80) || "Voz", descricao: v.descricao ? v.descricao.slice(0, 600) : null, origem: v.origem, previa_url: v.previa_url && /^https:\/\//.test(v.previa_url) ? v.previa_url.slice(0, 600) : null, previa_path: v.previa_path || null, autorizacao: v.autorizacao || null, criado_por: ch.userId })
        .select("id")
        .single();
      if (ins.error || !ins.data) {
        registrarFalha("mesa-motion: voz não salva", ins.error, { client_id: clientId });
        throw d.erro(503, semTabelaDasVozes(ins.error) ? "banco_sem_vozes" : "voz_nao_salva", semTabelaDasVozes(ins.error) ? AVISO_SEM_VOZES : "Não foi possível salvar a voz agora.");
      }
      id = (ins.data as { id: string }).id;
    }
    if (v.padrao) await marcarPadrao(clientId, marcaId, id);
    return id;
  }

  const vozEscolher: Acao = async (ch, c) => {
    const clientId = idDe(c.client_id, "client_id");
    await d.garantirAcesso(ch, clientId);
    let voiceId = String(c.voice_id || "");
    if (!VOICE_ID.test(voiceId)) throw d.erro(400, "voice_id_invalido", "Voz inválida.");
    const marcaId = marcaDe(c.marca_id);
    // Voz da Voice Library pública: entra na conta da agência antes (sem custo; o id na conta é o que vale).
    const dono = typeof c.public_owner_id === "string" ? c.public_owner_id : "";
    if (dono) {
      if (!/^[A-Za-z0-9]{8,80}$/.test(dono)) throw d.erro(400, "dono_invalido", "Voz da biblioteca pública inválida.");
      voiceId = await adicionarVozCompartilhada(exigirChave(), { publicOwnerId: dono, voiceId, nome: limpo(c.nome, 80) || "Voz" });
    }
    const id = await guardarVoz(ch, clientId, marcaId, { voice_id: voiceId, nome: limpo(c.nome, 80) || "Voz", descricao: limpo(c.descricao, 600) || null, origem: "biblioteca", previa_url: typeof c.previa_url === "string" ? c.previa_url : null, padrao: c.padrao !== false });
    await d.auditar(ch, "motion_voz_escolher", { client_id: clientId, voice_id: voiceId, da_biblioteca_publica: !!dono }, true, id);
    const lidas = await vozesDaMarca(clientId, marcaId);
    return d.json({ voz_id: id, voice_id: voiceId, vozes: await comLinks(lidas.vozes, clientId), custo_usd: 0 });
  };

  async function lerVozSalva(ch: Chamador, vozId: unknown) {
    const { data, error } = await d.servico().from("motion_vozes").select("id, client_id, marca_id").eq("id", idDe(vozId, "voz_id")).maybeSingle();
    if (error) throw d.erro(503, semTabelaDasVozes(error) ? "banco_sem_vozes" : "voz_indisponivel", semTabelaDasVozes(error) ? AVISO_SEM_VOZES : "Não foi possível ler a voz agora.");
    const v = data as { id: string; client_id: string; marca_id: string | null } | null;
    if (!v) throw d.erro(404, "voz_inexistente", "Voz não encontrada.");
    await d.garantirAcesso(ch, v.client_id);
    return v;
  }

  const vozPadrao: Acao = async (ch, c) => {
    const v = await lerVozSalva(ch, c.voz_id);
    await marcarPadrao(v.client_id, v.marca_id, v.id);
    const lidas = await vozesDaMarca(v.client_id, v.marca_id);
    return d.json({ vozes: await comLinks(lidas.vozes, v.client_id), custo_usd: 0 });
  };

  const vozArquivar: Acao = async (ch, c) => {
    const v = await lerVozSalva(ch, c.voz_id);
    const arquivar = c.arquivar !== false;
    const { error } = await d.servico().from("motion_vozes").update(arquivar ? { arquivado_em: new Date().toISOString(), arquivado_por: ch.userId, padrao: false } : { arquivado_em: null, arquivado_por: null }).eq("id", v.id);
    if (error) throw d.erro(503, "voz_nao_salva", arquivar ? "Não foi possível arquivar a voz agora." : "Não foi possível desarquivar a voz agora (já existe outra igual ativa?).");
    await d.auditar(ch, arquivar ? "motion_voz_arquivar" : "motion_voz_desarquivar", { client_id: v.client_id }, true, v.id);
    const lidas = await vozesDaMarca(v.client_id, v.marca_id);
    return d.json({ vozes: await comLinks(lidas.vozes, v.client_id), custo_usd: 0 });
  };

  /** O Jev escolhe, entre as vozes que a tela mostra, a que combina com a marca (julgamento, não prompt). */
  const vozSugerir: Acao = async (ch, c) => {
    const clientId = idDe(c.client_id, "client_id");
    await d.garantirAcesso(ch, clientId);
    const candidatas = (Array.isArray(c.candidatas) ? c.candidatas : [])
      .map(obj)
      .filter((v) => typeof v.voice_id === "string" && VOICE_ID.test(v.voice_id))
      .slice(0, 10);
    if (candidatas.length < 2) throw d.erro(400, "poucas_vozes", "Mostre ao menos duas vozes para o Jev comparar.");
    let marca: Record<string, unknown> = {};
    if (typeof c.filme_id === "string" && UUID.test(c.filme_id)) {
      const f = await d.lerFilme(ch, c.filme_id, true);
      if (f.client_id !== clientId) throw d.erro(403, "sem_acesso_ao_cliente", "Este filme é de outro cliente.");
      const k = await d.kitDoFilme(f);
      marca = { nome: k.nome, tom: f.brand.tom || k.tom, estilo: k.estilo, publico: f.brand.publico, essencia: f.brand.essencia, clima: f.entrevista.clima || null };
    }
    const criterios: Record<string, string> = {};
    candidatas.forEach((v) => {
      const rot = obj(v.rotulos);
      criterios[String(v.voice_id)] = `${limpo(v.nome, 60)}: ${limpo(v.descricao, 200)} ${Object.keys(rot).map((k) => `${k} ${rot[k]}`).join(", ")}`.slice(0, 300);
    });
    const resp = await jevPerguntar({
      state: { marca, uso: "narração de filme curto da marca em português do Brasil, para redes sociais e site" },
      questions: { voz: { type: "choice", instructions: "Qual destas vozes combina mais com a marca e o tom do filme para narrar em português do Brasil?", criteria: criterios } },
    });
    const cobrado = await cobrarJev(resp, { clientId, tarefa: "motion", criadoPor: ch.userId });
    const r = resp.answers.voz || {};
    return d.json({ voice_id: r.choice || null, confianca: typeof r.confidence === "number" ? r.confidence : null, probabilidades: r.probabilities || {}, custo_usd: cobrado ? cobrado.custoUsd : 0 });
  };

  const vozDesenhar: Acao = async (ch, c) => {
    const clientId = idDe(c.client_id, "client_id");
    await d.garantirAcesso(ch, clientId);
    const descricao = limpo(c.descricao, 1000);
    if (descricao.length < 20) throw d.erro(400, "descricao_curta", "Descreva a voz com mais detalhe (idade, timbre, sotaque, energia): ao menos 20 caracteres.");
    const conn = exigirChave();
    const estimativa = estimarDesenho();
    await saldoAntes(clientId, estimativa);
    const r = await desenharVoz(conn, { descricao, texto: limpo(c.texto, 1000) || null, modelo: MODELO_DO_DESENHO });
    const pasta = `${clientId}/video/motion/vozes/previas`;
    const agora = Date.now().toString(36);
    const previas: Array<{ generated_voice_id: string; path: string; url: string | null; duracao_s: number }> = [];
    for (let i = 0; i < r.previas.length; i++) {
      const p = r.previas[i];
      const caminho = `${pasta}/${agora}-${i + 1}.mp3`;
      await subirAudio(caminho, p.bytes);
      const { data } = await d.servico().storage.from("mesa").createSignedUrl(caminho, 3600);
      previas.push({ generated_voice_id: p.generated_voice_id, path: caminho, url: data ? data.signedUrl : null, duracao_s: p.duracao_s || duracaoDoMp3(p.bytes.length) });
    }
    const cobrado = await cobrar(clientId, { modelo: MODELO_DO_DESENHO, caracteres: (r.texto || "").length * r.previas.length, custo: estimativa, ref: { tipo: "motion_voz", id: clientId }, userId: ch.userId });
    return d.json({ previas, texto: r.texto, custo_usd: estimativa, saldo_usd: cobrado.saldo });
  };

  const vozSalvarDesenhada: Acao = async (ch, c) => {
    const clientId = idDe(c.client_id, "client_id");
    await d.garantirAcesso(ch, clientId);
    const gid = String(c.generated_voice_id || "");
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(gid)) throw d.erro(400, "previa_invalida", "Escolha uma das prévias.");
    const nome = limpo(c.nome, 80) || "Voz da marca";
    const descricao = limpo(c.descricao, 1000) || nome;
    const voiceId = await salvarVozDesenhada(exigirChave(), { generatedVoiceId: gid, nome, descricao });
    const previa = typeof c.previa_path === "string" && c.previa_path.indexOf(`${clientId}/`) === 0 ? c.previa_path.slice(0, 400) : null;
    const marcaId = marcaDe(c.marca_id);
    const id = await guardarVoz(ch, clientId, marcaId, { voice_id: voiceId, nome, descricao: descricao.slice(0, 600), origem: "desenhada", previa_path: previa, padrao: true });
    await d.auditar(ch, "motion_voz_desenhada", { client_id: clientId, voice_id: voiceId }, true, id);
    const lidas = await vozesDaMarca(clientId, marcaId);
    return d.json({ voz_id: id, voice_id: voiceId, vozes: await comLinks(lidas.vozes, clientId), custo_usd: 0 });
  };

  /**
   * Clone instantâneo: só com a autorização da pessoa registrada (quem, como)
   * e a confirmação da equipe. As amostras vêm da pasta do cliente no bucket
   * mesa (até 5 arquivos de áudio, 25 MB no total).
   */
  const vozClonar: Acao = async (ch, c) => {
    const clientId = idDe(c.client_id, "client_id");
    await d.garantirAcesso(ch, clientId);
    const aut = obj(c.autorizacao);
    const quem = limpo(aut.quem, 120);
    const como = limpo(aut.como, 300);
    if (c.confirma !== true || quem.length < 2 || como.length < 3) throw d.erro(422, "autorizacao_do_clone", "Clonar uma voz exige a autorização da pessoa: diga quem autorizou e como (e-mail, contrato, gravação) e confirme.");
    const caminhos = (Array.isArray(c.caminhos) ? c.caminhos : []).map((x) => String(x || "")).filter((x) => x.indexOf(`${clientId}/`) === 0 && /\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i.test(x)).slice(0, 5);
    if (!caminhos.length) throw d.erro(400, "sem_amostra", "Envie ao menos uma gravação da voz (mp3, wav, m4a, ogg, webm, aac ou flac), de 1 a 3 minutos, sem música.");
    const arquivos: Array<{ nome: string; tipo: string; bytes: Uint8Array }> = [];
    let total = 0;
    for (const caminho of caminhos) {
      const b = await d.servico().storage.from("mesa").download(caminho);
      if (b.error || !b.data) throw d.erro(502, "amostra_nao_lida", "Não foi possível ler uma das gravações agora.");
      total += b.data.size;
      if (total > 25 * 1024 * 1024) throw d.erro(413, "amostras_grandes", "As gravações passam de 25 MB juntas. Envie trechos menores.");
      arquivos.push({ nome: caminho.split("/").pop() || "amostra.mp3", tipo: b.data.type || "audio/mpeg", bytes: new Uint8Array(await b.data.arrayBuffer()) });
    }
    const nome = limpo(c.nome, 80) || "Voz clonada";
    const r = await clonarVoz(exigirChave(), { nome, descricao: limpo(c.descricao, 500), arquivos, removerRuido: c.remover_ruido === true });
    const marcaId = marcaDe(c.marca_id);
    const autorizacao = { quem, como, em: limpo(aut.em, 40) || new Date().toISOString(), registrado_por: ch.userId, amostras: caminhos };
    const id = await guardarVoz(ch, clientId, marcaId, { voice_id: r.voice_id, nome, descricao: limpo(c.descricao, 600) || null, origem: "clonada", autorizacao, padrao: true });
    await d.auditar(ch, "motion_voz_clonada", { client_id: clientId, voice_id: r.voice_id, quem, como }, true, id);
    const lidas = await vozesDaMarca(clientId, marcaId);
    return d.json({ voz_id: id, voice_id: r.voice_id, precisa_verificar: r.precisa_verificar, vozes: await comLinks(lidas.vozes, clientId), custo_usd: 0 });
  };

  // ------------------------------------------------------------------ falas com IA

  function segundosUteis(c: CenaDaLinha, n: NarracaoDoFilme) {
    return Math.max(1, Math.round((c.duracao_s - n.antes_s - n.depois_s) * 10) / 10);
  }

  function textosNaTela(c: CenaDaLinha): string[] {
    const t: string[] = [];
    Object.keys(c.params || {}).forEach((k) => {
      const v = (c.params as Record<string, unknown>)[k];
      if (typeof v === "string") t.push(v);
      else if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && t.push(x));
    });
    return t.slice(0, 8);
  }

  async function escreverFalas(ch: Chamador, f: LinhaDoFilme, p: { modeloId?: unknown; pedido?: string; substituir?: boolean }) {
    if (!f.cenas.length) throw d.erro(409, "sem_cenas", "Escolha o storyboard antes de escrever as falas.");
    const modelo = await d.modeloDoPedido(f, p.modeloId);
    const n = f.som.narracao;
    const vozModelo = modeloDeVoz(n.modelo);
    const regras = await regrasDaMesa(d.servico(), { clientId: f.client_id, mesa: "motion", marcaId: f.marca_id });
    const dados = {
      filme: { nome: f.nome, tipo: f.tipo, promessa: f.brand.promessa, tom: f.brand.tom, publico: f.brand.publico, evitar: f.brand.evitar, beats: f.brand.beats },
      PROVAS: f.brand.provas,
      TAGS: vozModelo.tags ? "sim" : "não",
      cenas: f.cenas.map((c, i) => ({ cena_id: c.id, ordem: i + 1, titulo: c.titulo, ideia: c.ideia, TEXTOS_NA_TELA: textosNaTela(c), duracao_s: c.duracao_s, SEGUNDOS_UTEIS: segundosUteis(c, n), fala_atual: n.falas[c.id] || null })),
      pedido_da_equipe: p.pedido || null,
    };
    const saida = await chamarTexto({
      clientId: f.client_id,
      tarefa: "motion",
      agente: "motion",
      modeloId: modelo.id,
      sistema: `${SISTEMA_DAS_FALAS}${regras.bloco ? `\n\n${regras.bloco}` : ""}`,
      mensagens: [{ papel: "usuario", conteudo: `DADOS:\n${JSON.stringify(dados)}` }],
      esquemaJson: ESQUEMA_DAS_FALAS,
      maxTokensSaida: 2_500,
      metodo: await superpoderesPara(d.servico(), { agente: "motion.geracao", momento: Object.keys(n.falas).length ? "ajustar" : "gerar" }),
      referencia: { tipo: "motion_filme", id: f.id },
      criadoPor: ch.userId,
    });
    const novas = lerFalasDoModelo(saida.json, f.cenas);
    if (!Object.keys(novas).length) throw d.erro(502, "falas_vazias", "O modelo não devolveu as falas. Tente de novo ou troque o modelo.");
    const atual = await filmeAtual(ch, f);
    const na = atual.som.narracao;
    const anteriores = { ...na.falas };
    const falas: Record<string, string> = { ...na.falas };
    Object.keys(novas).forEach((k) => {
      if (p.substituir || !falas[k]) falas[k] = novas[k];
    });
    const filme = await d.somarCusto(atual, saida.custoUsd, { som: { ...atual.som, narracao: { ...na, ligada: true, falas } } });
    return { filme, anteriores, custo: saida.custoUsd, saldo: saida.saldoUsd, resumo: limpo(obj(saida.json).resumo, 300) };
  }

  const falasEscrever: Acao = async (ch, c) => {
    const f = await d.lerFilme(ch, c.filme_id);
    const r = await escreverFalas(ch, f, { modeloId: c.modelo_id, pedido: limpo(c.pedido, 600), substituir: c.substituir === true });
    return d.json({ filme: r.filme, anteriores: r.anteriores, resumo: r.resumo, custo_usd: r.custo, saldo_usd: r.saldo });
  };

  /** Custo antes da escrita das falas (modelo do papel motion ou o escolhido). */
  const estimarFalas = (modelo: ModeloIa) => estimarComModelo(modelo, { tokensEntrada: TAMANHOS_DO_MOTION.falas.entrada, tokensSaida: TAMANHOS_DO_MOTION.falas.saida });

  // ------------------------------------------------------------------ narração

  type Pedaco = { cenas: CenaDaLinha[]; texto: string };

  /** Roteiro em pedaços que cabem no limite do modelo (cenas inteiras, na ordem). */
  function pedacosDoRoteiro(cenas: CenaDaLinha[], n: NarracaoDoFilme): Pedaco[] {
    const m = modeloDeVoz(n.modelo);
    const pedacos: Pedaco[] = [];
    let atual: Pedaco = { cenas: [], texto: "" };
    cenas.forEach((c) => {
      const t = textoParaOModelo(n.falas[c.id] || "", m);
      if (!t) return;
      const junto = atual.texto ? `${atual.texto}\n\n${t}` : t;
      if (junto.length > m.limite - 50 && atual.cenas.length) {
        pedacos.push(atual);
        atual = { cenas: [c], texto: t };
      } else atual = { cenas: atual.cenas.concat([c]), texto: junto };
    });
    if (atual.cenas.length) pedacos.push(atual);
    return pedacos;
  }

  async function gerarNarracao(ch: Chamador, f: LinhaDoFilme, modo: "roteiro" | "cenas" | "cena", cenaId?: string) {
    const n = f.som.narracao;
    if (!n.voz) throw d.erro(409, "sem_voz", "Escolha a voz da marca antes de gerar a narração.");
    const conn = exigirChave();
    const m = modeloDeVoz(n.modelo);
    const comFala = f.cenas.filter((c) => semTags(n.falas[c.id] || ""));
    if (!comFala.length) throw d.erro(409, "sem_falas", "Escreva as falas das cenas antes de gerar a narração.");
    let pedacos: Pedaco[];
    if (modo === "cena") {
      const c = comFala.find((x) => x.id === cenaId);
      if (!c) throw d.erro(409, "cena_sem_fala", "Esta cena não tem fala.");
      pedacos = [{ cenas: [c], texto: textoParaOModelo(n.falas[c.id], m) }];
    } else if (modo === "cenas") {
      const faltam = comFala.filter((c) => {
        const nc = narracaoDaCena(n, c.id);
        return !nc || nc.desatualizada;
      });
      if (!faltam.length) throw d.erro(409, "narracao_em_dia", "Todas as falas já têm narração em dia.");
      pedacos = faltam.map((c) => ({ cenas: [c], texto: textoParaOModelo(n.falas[c.id], m) }));
    } else pedacos = pedacosDoRoteiro(comFala, n);
    const estimativa = estimarNarracao(pedacos.map((p) => p.texto), m.id);
    await saldoAntes(f.client_id, estimativa.custo_usd);
    const novos: AudioDaNarracao[] = [];
    const avisos: string[] = [];
    let custo = 0;
    let saldo: number | null = null;
    const ordem = f.cenas.map((c) => c.id);
    for (let k = 0; k < pedacos.length; k++) {
      const p = pedacos[k];
      const ids = p.cenas.map((c) => c.id);
      const iPrimeira = ordem.indexOf(ids[0]);
      const iUltima = ordem.indexOf(ids[ids.length - 1]);
      const antes = iPrimeira > 0 ? semTags(n.falas[ordem[iPrimeira - 1]] || "") : "";
      const depois = iUltima < ordem.length - 1 ? semTags(n.falas[ordem[iUltima + 1]] || "") : "";
      let gerada: Awaited<ReturnType<typeof falar>>;
      try {
        gerada = await falar(conn, { voiceId: n.voz.voice_id, texto: p.texto, modelo: m.id, idioma: m.idioma ? "pt" : null, voiceSettings: voiceSettings(n.ajustes), anterior: antes || null, proximo: depois || null });
      } catch (e) {
        // A primeira falhou: nada foi gasto, o erro vai para a tela. Depois de alguma pronta: guarda o que saiu e avisa.
        if (!novos.length) throw e;
        registrarFalha("mesa-motion: narração parcial", e, { filme_id: f.id });
        avisos.push(`Parou na ${k + 1}ª parte: ${e instanceof Error ? e.message : "falha"}`);
        break;
      }
      const duracao = duracaoDoMp3(gerada.bytes.length);
      const palavras = palavrasDoAlinhamento(lerAlinhamento(gerada.alinhamento));
      const trechos = ids.length > 1
        ? trechosDoRoteiro(p.cenas.map((c) => ({ cena_id: c.id, texto: n.falas[c.id] || "" })), palavras, duracao)
        : [{ cena_id: ids[0], de_s: palavras.length ? Math.max(0, Math.round((palavras[0].i - 0.05) * 1000) / 1000) : 0, ate_s: palavras.length ? Math.min(duracao, Math.round((palavras[palavras.length - 1].f + 0.15) * 1000) / 1000) : duracao }];
      if (ids.length > 1 && palavras.length !== p.cenas.reduce((s, c) => s + palavrasDoTexto(n.falas[c.id] || "").length, 0)) avisos.push("O tempo de cada cena no roteiro saiu pela proporção do texto (a leitura mudou algumas palavras). Confira a sincronia.");
      const id = `n${Date.now().toString(36)}${k}`;
      const caminho = `${pastaDoFilme(f.client_id, f.id)}/narracao/${id}.mp3`;
      await subirAudio(caminho, gerada.bytes);
      const numeros = ids.map((x) => ordem.indexOf(x) + 1);
      const arquivoId = await registrarNaMidia(ch, f.client_id, { nome: `Narração ${f.nome} ${numeros.length > 1 ? `cenas ${numeros[0]} a ${numeros[numeros.length - 1]}` : `cena ${numeros[0]}`}`, caminho, bytes: gerada.bytes.length, duracao_s: duracao, grupo: "narracao", nota: `ElevenLabs ${m.rotulo}, voz ${n.voz.nome}. Mesa Motion, filme ${f.id.slice(0, 8)}.` });
      const caracteres = p.texto.length;
      const custoDoPedaco = arred((caracteres / 1000) * m.preco_1k_usd);
      const cobrado = await cobrar(f.client_id, { modelo: m.id, caracteres, custo: custoDoPedaco, ref: { tipo: "motion_filme", id: f.id }, userId: ch.userId });
      if (cobrado.saldo !== null) saldo = cobrado.saldo;
      custo += custoDoPedaco;
      novos.push({
        id,
        path: caminho,
        arquivo_id: arquivoId,
        duracao_s: duracao,
        modelo: m.id,
        voice_id: n.voz.voice_id,
        trechos: assinarTrechos(trechos, n),
        palavras,
        assinatura: ids.length > 1 ? assinaturaDoAudio(ids, n) : assinaturaDaFala(n.falas[ids[0]] || "", n),
        custo_usd: custoDoPedaco,
        em: new Date().toISOString(),
      });
    }
    const cobertas = novos.reduce((l, a) => l.concat(a.trechos.map((t) => t.cena_id)), [] as string[]);
    // Relê o filme: falas, volume e voz mudados na tela durante a geração ficam como estão (o áudio novo carrega a assinatura da fala que leu).
    const atual = await filmeAtual(ch, f);
    const na = atual.som.narracao;
    const anteriores = na.audios;
    const audios = semAudiosDasCenas(na, cobertas).concat(novos).slice(-24);
    const filme = await d.somarCusto(atual, custo, { som: { ...atual.som, narracao: { ...na, ligada: true, audios } } });
    return { filme, anteriores, custo: arred(custo), saldo, avisos, estimativa: estimativa.custo_usd };
  }

  const narracaoGerar: Acao = async (ch, c) => {
    const f = await d.lerFilme(ch, c.filme_id);
    const modo = c.modo === "cena" || c.modo === "cenas" ? c.modo : "roteiro";
    const r = await gerarNarracao(ch, f, modo, typeof c.cena_id === "string" ? c.cena_id : undefined);
    return d.json({ filme: r.filme, links: await d.linksDoFilme(r.filme), avisos: r.avisos, custo_usd: r.custo, saldo_usd: r.saldo });
  };

  async function casarNarracao(f: LinhaDoFilme) {
    const n = f.som.narracao;
    if (!n.audios.length) throw d.erro(409, "sem_narracao", "Gere a narração antes de casar as cenas com a voz.");
    const anterior = f.cenas.map((c) => ({ id: c.id, duracao_s: c.duracao_s }));
    const r = casarComANarracao(f.cenas, n, f.som.batidas);
    const filme = await d.atualizarFilme(f.id, { cenas: r.cenas });
    return { filme, anterior, avisos: r.avisos, casadas: r.casadas };
  }

  const narracaoCasar: Acao = async (ch, c) => {
    const r = await casarNarracao(await d.lerFilme(ch, c.filme_id));
    return d.json({ filme: r.filme, anterior: r.anterior, avisos: r.avisos, casadas: r.casadas, custo_usd: 0 });
  };

  const narracaoRemover: Acao = async (ch, c) => {
    const f = await d.lerFilme(ch, c.filme_id);
    const n = f.som.narracao;
    const audios = n.audios.filter((a) => a.id !== String(c.audio_id || ""));
    if (audios.length === n.audios.length) throw d.erro(404, "audio_inexistente", "Este áudio não está no filme.");
    const filme = await d.atualizarFilme(f.id, { som: { ...f.som, narracao: { ...n, audios } } });
    return d.json({ filme, custo_usd: 0 });
  };

  // ------------------------------------------------------------------ trilha e efeitos gerados

  async function gerarTrilha(ch: Chamador, f: LinhaDoFilme, p: { prompt?: string; duracao_s?: unknown; uid?: string }) {
    const conn = exigirChave();
    const pedida = Number(p.duracao_s);
    const duracao = Math.round(Math.max(10, Math.min(180, isFinite(pedida) && pedida > 0 ? pedida : duracaoTotal(f.cenas) + 1.5)));
    const kit = await d.kitDoFilme(f);
    const prompt = limpo(p.prompt, 900) || promptDaTrilha({ clima: typeof f.entrevista.clima === "string" ? f.entrevista.clima : null, tom: f.brand.tom || kit.tom, ritmo: typeof f.entrevista.ritmo === "string" ? f.entrevista.ritmo : null, duracao_s: duracao, comVoz: f.som.narracao.ligada });
    const estimativa = estimarMusica(duracao);
    await saldoAntes(f.client_id, estimativa);
    const bytes = await comporMusica({ ...conn, timeoutMs: 140_000 }, { prompt, duracao_s: duracao, modelo: MODELO_DA_MUSICA });
    const caminho = `${pastaDoFilme(f.client_id, f.id)}/trilhas/${Date.now().toString(36)}.mp3`;
    await subirAudio(caminho, bytes);
    const real = duracaoDoMp3(bytes.length) || duracao;
    const arquivoId = await registrarNaMidia(ch, f.client_id, { nome: `Trilha ${f.nome}`, caminho, bytes: bytes.length, duracao_s: real, grupo: "trilha_gerada", nota: `ElevenLabs Music (${MODELO_DA_MUSICA}), instrumental. Uso comercial conforme o plano da conta da agência. Pedido: ${prompt}` });
    const cobrado = await cobrar(f.client_id, { modelo: MODELO_DA_MUSICA, caracteres: prompt.length, custo: estimativa, ref: { tipo: "motion_filme", id: f.id }, userId: ch.userId });
    const atual = await filmeAtual(ch, f);
    const anterior = atual.som.trilha;
    let filme = await d.somarCusto(atual, estimativa, { som: { ...atual.som, trilha: { arquivo_id: arquivoId, path: caminho, nome: `Trilha gerada (${Math.round(real)} s)`, duracao_s: real }, batidas: null } });
    const avisos: string[] = [];
    try {
      await d.pedirBatidas(ch, filme, p.uid && /^[A-Za-z0-9_-]{8,80}$/.test(p.uid) ? p.uid : `trilha-${Date.now().toString(36)}`);
    } catch (e) {
      avisos.push(`As batidas não entraram na fila: ${e instanceof Error ? e.message : "falha"}`);
    }
    filme = await d.lerFilme(ch, filme.id);
    return { filme, anterior, custo: estimativa, saldo: cobrado.saldo, prompt, avisos };
  }

  const trilhaGerar: Acao = async (ch, c) => {
    const f = await d.lerFilme(ch, c.filme_id);
    const r = await gerarTrilha(ch, f, { prompt: typeof c.prompt === "string" ? c.prompt : "", duracao_s: c.duracao_s, uid: typeof c.uid === "string" ? c.uid : "" });
    return d.json({ filme: r.filme, links: await d.linksDoFilme(r.filme), anterior: r.anterior, prompt: r.prompt, avisos: r.avisos, custo_usd: r.custo, saldo_usd: r.saldo });
  };

  const efeitoGerar: Acao = async (ch, c) => {
    const f = await d.lerFilme(ch, c.filme_id);
    const descricao = limpo(c.descricao, 450);
    if (descricao.length < 4) throw d.erro(400, "descricao_curta", "Descreva o som (ex.: porta de vidro abrindo numa loja silenciosa).");
    const cena = f.cenas.find((x) => x.id === c.cena_id);
    if (!cena) throw d.erro(404, "cena_inexistente", "Escolha a cena do efeito.");
    const duracao = Math.max(0.5, Math.min(10, Number(c.duracao_s) || 2));
    const t = Math.max(0, Math.min(cena.duracao_s - 0.1, Number(c.t_s) || 0));
    const conn = exigirChave();
    const estimativa = estimarEfeito(duracao);
    await saldoAntes(f.client_id, estimativa);
    const bytes = await gerarEfeito(conn, { texto: descricao, duracao_s: duracao, modelo: MODELO_DOS_EFEITOS });
    const id = `e${Date.now().toString(36)}`;
    const caminho = `${pastaDoFilme(f.client_id, f.id)}/efeitos/${id}.mp3`;
    await subirAudio(caminho, bytes);
    await registrarNaMidia(ch, f.client_id, { nome: `Efeito ${descricao}`.slice(0, 120), caminho, bytes: bytes.length, duracao_s: duracao, grupo: "efeito", nota: `ElevenLabs efeitos (${MODELO_DOS_EFEITOS}). Mesa Motion, filme ${f.id.slice(0, 8)}.` });
    const cobrado = await cobrar(f.client_id, { modelo: MODELO_DOS_EFEITOS, caracteres: descricao.length, custo: estimativa, ref: { tipo: "motion_filme", id: f.id }, userId: ch.userId });
    const atual = await filmeAtual(ch, f);
    const lista = atual.som.efeitos_sob_medida.concat([{ id, nome: descricao.slice(0, 80), path: caminho, cena_id: cena.id, t_s: t, duracao_s: duracao }]).slice(-20);
    const filme = await d.somarCusto(atual, estimativa, { som: { ...atual.som, efeitos_sob_medida: lista } });
    return d.json({ filme, links: await d.linksDoFilme(filme), custo_usd: estimativa, saldo_usd: cobrado.saldo });
  };

  const efeitoRemover: Acao = async (ch, c) => {
    const f = await d.lerFilme(ch, c.filme_id);
    const lista = f.som.efeitos_sob_medida.filter((e) => e.id !== String(c.efeito_id || ""));
    if (lista.length === f.som.efeitos_sob_medida.length) throw d.erro(404, "efeito_inexistente", "Este efeito não está no filme.");
    const filme = await d.atualizarFilme(f.id, { som: { ...f.som, efeitos_sob_medida: lista } });
    return d.json({ filme, custo_usd: 0 });
  };

  // ------------------------------------------------------------------ direção de arte e storyboard pelo Jev

  /** O Jev escolhe acabamento, transição, ritmo e estilo da voz pela marca (só sugestão: a tela aplica com Desfazer). */
  const direcaoSugerir: Acao = async (ch, c) => {
    const f = await d.lerFilme(ch, c.filme_id);
    const kit = await d.kitDoFilme(f);
    const estado = { marca: { nome: kit.nome, estilo: kit.estilo, tom: f.brand.tom || kit.tom, regras: kit.regras, essencia: f.brand.essencia, publico: f.brand.publico, movimento: f.brand.movimento }, filme: { tipo: f.tipo, objetivo: f.entrevista.objetivo || null, clima: f.entrevista.clima || null } };
    const criterios = (l: ReadonlyArray<{ valor: string; rotulo: string; dica?: string }>) => {
      const o: Record<string, string> = {};
      l.forEach((x) => (o[x.valor] = `${x.rotulo}${x.dica ? `: ${x.dica}` : ""}`));
      return o;
    };
    const resp = await jevPerguntar({
      state: estado,
      questions: {
        acabamento: { type: "choice", instructions: "Qual acabamento visual combina mais com esta marca num filme curto em motion?", criteria: criterios(ACABAMENTOS) },
        transicao: { type: "choice", instructions: "Qual transição entre as cenas combina mais com esta marca?", criteria: { corte_na_batida: "Corte seco na batida: direto, enérgico", empurrao: "Empurrão com rastro: dinâmico, moderno", fade: "Fade suave: elegante, calmo", zoom: "Zoom de entrada: impacto, tecnologia" } },
        ritmo: { type: "choice", instructions: "Qual ritmo de edição combina mais com esta marca?", criteria: { calmo: "Calmo: planos longos", medio: "Médio", rapido: "Rápido: cortes curtos, energia" } },
        estilo_da_voz: { type: "choice", instructions: "Como a voz da narração deve soar para esta marca?", criteria: criterios(ESTILOS_DA_VOZ) },
      },
    });
    const cobrado = await cobrarJev(resp, { clientId: f.client_id, tarefa: "motion", referencia: { tipo: "motion_filme", id: f.id }, criadoPor: ch.userId });
    const a = resp.answers;
    const pega = (k: string) => (a[k] && typeof a[k].choice === "string" ? { valor: a[k].choice as string, confianca: typeof a[k].confidence === "number" ? a[k].confidence : null } : null);
    return d.json({ sugestao: { acabamento: pega("acabamento"), transicao: pega("transicao"), ritmo: pega("ritmo"), estilo_da_voz: pega("estilo_da_voz") }, custo_usd: cobrado ? cobrado.custoUsd : 0 });
  };

  /**
   * Aplica o acabamento em todas as cenas em código e na entrevista. Com
   * `anteriores` (id -> acabamento), é o Desfazer: cada cena volta ao dela.
   */
  const acabamentoAplicar: Acao = async (ch, c) => {
    const f = await d.lerFilme(ch, c.filme_id);
    const volta = obj(c.anteriores);
    const desfazendo = Object.keys(volta).length > 0;
    if (!desfazendo && !ehAcabamento(c.acabamento)) throw d.erro(400, "acabamento_invalido", "Acabamento inválido.");
    const anteriores: Record<string, string> = {};
    const cenas = f.cenas.map((x) => {
      anteriores[x.id] = x.acabamento || "limpo";
      if (x.tipo_plano !== "hf") return x;
      const alvo = desfazendo ? (typeof volta[x.id] === "string" ? String(volta[x.id]) : x.acabamento || "limpo") : String(c.acabamento);
      const y = { ...x };
      if (!alvo || alvo === "limpo" || !ehAcabamento(alvo)) delete y.acabamento;
      else y.acabamento = alvo;
      return y;
    });
    const entrevista = { ...f.entrevista, acabamento: desfazendo ? (typeof c.acabamento_anterior === "string" && ehAcabamento(c.acabamento_anterior) ? c.acabamento_anterior : f.entrevista.acabamento) : c.acabamento };
    const filme = await d.atualizarFilme(f.id, { cenas, entrevista });
    return d.json({ filme, anteriores, acabamento_anterior: typeof f.entrevista.acabamento === "string" ? f.entrevista.acabamento : "limpo", custo_usd: 0 });
  };

  /** O Jev indica qual dos 3 storyboards serve melhor à marca e ao objetivo (a equipe decide). */
  const storyboardSugerir: Acao = async (ch, c) => {
    const f = await d.lerFilme(ch, c.filme_id);
    if (f.storyboards.length < 2) throw d.erro(409, "sem_storyboards", "Gere os storyboards antes.");
    const criterios: Record<string, string> = {};
    f.storyboards.forEach((s, i) => {
      criterios[String(i)] = `${s.conceito}: ${s.resumo}. Cenas: ${s.cenas.map((x) => x.titulo).join(", ")}`.slice(0, 600);
    });
    let resp: Awaited<ReturnType<typeof jevPerguntar>>;
    try {
      resp = await jevPerguntar({
        state: { brand: { essencia: f.brand.essencia, publico: f.brand.publico, promessa: f.brand.promessa, tom: f.brand.tom, beats: f.brand.beats }, entrevista: f.entrevista, tipo: f.tipo },
        questions: { storyboard: { type: "choice", instructions: "Qual storyboard conta melhor a promessa da marca para este público, com gancho forte e fechamento claro?", criteria: criterios } },
      });
    } catch (e) {
      // Nenhum erro engolido: vai para o log e a tela mostra a frase (Poucos cliques fica com o storyboard 1 e avisa).
      registrarFalha("mesa-motion: Jev não escolheu o storyboard", e, { filme_id: f.id });
      throw d.erro(502, "jev_indisponivel", "O Jev não respondeu agora.");
    }
    const cobrado = await cobrarJev(resp, { clientId: f.client_id, tarefa: "motion", referencia: { tipo: "motion_filme", id: f.id }, criadoPor: ch.userId });
    const r = resp.answers.storyboard || {};
    const indice = Number(r.choice);
    return d.json({ indice: isFinite(indice) && f.storyboards[indice] ? indice : null, confianca: typeof r.confidence === "number" ? r.confidence : null, custo_usd: cobrado ? cobrado.custoUsd : 0 });
  };

  const acoes: Record<string, Acao> = {
    voz_situacao: vozSituacao,
    vozes_biblioteca: vozesBiblioteca,
    vozes_compartilhadas: vozesCompartilhadas,
    voz_escolher: vozEscolher,
    voz_padrao: vozPadrao,
    voz_arquivar: vozArquivar,
    voz_sugerir: vozSugerir,
    voz_desenhar: vozDesenhar,
    voz_salvar_desenhada: vozSalvarDesenhada,
    voz_clonar: vozClonar,
    falas_escrever: falasEscrever,
    narracao_gerar: narracaoGerar,
    narracao_casar: narracaoCasar,
    narracao_remover: narracaoRemover,
    trilha_gerar: trilhaGerar,
    efeito_gerar: efeitoGerar,
    efeito_remover: efeitoRemover,
    direcao_sugerir: direcaoSugerir,
    acabamento_aplicar: acabamentoAplicar,
    storyboard_sugerir: storyboardSugerir,
  };

  return { acoes, escreverFalas, gerarNarracao, casarNarracao, gerarTrilha, estimarFalas, limparFala };
}

/** Ações que chamam rede ou IA: a resposta começa na hora (a plataforma corta em 150 s). */
export const ACOES_LONGAS_DA_VOZ = ["vozes_biblioteca", "vozes_compartilhadas", "voz_escolher", "voz_sugerir", "voz_desenhar", "voz_salvar_desenhada", "voz_clonar", "falas_escrever", "narracao_gerar", "trilha_gerar", "efeito_gerar", "direcao_sugerir", "storyboard_sugerir"];
