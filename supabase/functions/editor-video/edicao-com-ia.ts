/**
 * Editar com IA (frente EDT, rodada 2, 30/09/2026): as ações da editor-video
 * que o painel "Editar com IA" e o agente usam. Nada aqui grava o projeto: a
 * tela monta a edição com as skills e salva pela mesa-videos.
 *
 * - edicao_planejar { client_id, modelo_id, raciocinio?, instrucao, resumo, referencia_id, custo_maximo_usd }
 *     -> { plano, avisos, custo_usd, saldo_usd, modelo_id }. UM passo do modelo escolhido
 *     (custo antes, conferido aqui), plano limpo pelo código (modulos/plano-da-edicao.ts).
 * - momentos_avaliar { client_id, titulo, frases, virais?: boolean }
 *     -> { forca: [{ k, nota }], virais: [{ k, inicio_s, fim_s, nota, texto }] } (Jev, sem custo para o cliente).
 * - capitulos_sugerir { client_id, frases } -> { capitulos: [{ inicio_s, titulo }] } (Jev: fronteiras e título escolhido entre trechos ditos).
 * - broll_escolher { client_id, frases, acervo: [{ id, descricao }], maximo } -> { escolhas } (Jev: Choice por frase).
 * - pedido_julgar { client_id, pedido, pecas } -> { querer: { legenda: 0.12, ... } } (Jev Noul: o dono QUER a peça
 *     que ficou ambígua no pedido? Sem custo para o cliente; a negação clara é do código, pedido-do-dono.ts).
 * - rosto_rastrear { client_id, fonte, modelo_id, quadros: [{ tempo_s, jpeg_base64 }], referencia_id, custo_maximo_usd }
 *     -> { leituras: [{ t, x, y, w }], custo_usd } (modelo com imagem; pago, custo antes).
 */

import { carregarModelo, chamarTexto, deBase64, type ImagemEntrada } from "../_shared/ia-motor.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { jevPerguntar } from "../_shared/jev.ts";
import { superpoderesPara } from "../_shared/superpoderes.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { ESQUEMA_DO_PLANO, estimativaDoPlanoUsd, normalizarPlano, pedidoDoPlano, planoComPedido, sistemaDoPlano, type ResumoParaOPlano } from "./modulos/plano-da-edicao.ts";
import { lerPedidoDoDono, PECAS_DO_PEDIDO, perguntasDoPedido, receitaPeloPedido, type PecaDoPedido } from "./modulos/pedido-do-dono.ts";
import {
  candidatosDeTitulo,
  comecosDeCapitulo,
  escolherBroll,
  escolherVirais,
  ESQUEMA_DO_ROSTO,
  estimativaDoRostoUsd,
  frasesConferidas,
  itensConferidos,
  janelasCandidatas,
  leiturasDoRosto,
  notasDeForca,
  perguntasDeBroll,
  perguntasDeForca,
  perguntasDeFronteira,
  perguntasDeTitulo,
  perguntasDeViral,
  sistemaDoRosto,
  titulosEscolhidos,
} from "./modulos/julgamentos-da-edicao.ts";

export interface ApoioDaEdicao {
  servico: () => SupabaseClient;
  garantirAcesso: (ch: unknown, clientId: string) => Promise<void>;
  json: (body: unknown, status?: number) => Response;
  erro: (status: number, codigo: string, mensagem: string, extra?: Record<string, unknown>) => Error;
  userId: (ch: unknown) => string;
  auditar: (ch: unknown, ferramenta: string, input: Record<string, unknown>, sucesso: boolean) => Promise<void>;
  folego: (f: () => Promise<Response>) => Response | Promise<Response>;
  respostaDeErro: (e: unknown) => Response;
  conferirCusto: (estimativa: number, mostrado: unknown) => void;
  idDe: (v: unknown, nome: string) => string;
}

const REF_PLANO = "editor_plano";
const REF_ROSTO = "editor_rosto";
const MAX_QUADROS_DO_ROSTO = 12;
const MAX_BYTES_DO_QUADRO = 200_000;

const curto = (v: unknown, max: number) => String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

function resumoDoCorpo(v: unknown): ResumoParaOPlano {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const lista = (x: unknown) => (Array.isArray(x) ? x.map((y) => curto(y, 80)).filter(Boolean).slice(0, 20) : []);
  const n = (x: unknown) => (isFinite(Number(x)) ? Number(x) : 0);
  return {
    titulo: curto(o.titulo, 120) || "Vídeo",
    duracao_s: Math.max(0, n(o.duracao_s)),
    formato: curto(o.formato, 8) || "9:16",
    fala: curto(o.fala, 12000),
    musicas: lista(o.musicas),
    tem_onda: o.tem_onda === true,
    tem_rosto: o.tem_rosto === true,
    marca: curto(o.marca, 80) || null,
    acervo: Math.max(0, Math.round(n(o.acervo))),
  };
}

export function rotasDaEdicaoComIa(a: ApoioDaEdicao) {
  const jevOuErro = async <T>(onde: string, clientId: string, f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      registrarFalha(`editor-video: Jev não respondeu (${onde})`, e, { client_id: clientId });
      throw a.erro(503, "jev_indisponivel", "O julgamento da IA não respondeu agora. Tente de novo em instantes; o resto da edição continua.");
    }
  };

  async function planejar(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const referencia = a.idDe(corpo.referencia_id, "referencia_id");
    const modeloId = String(corpo.modelo_id || "");
    const instrucao = curto(corpo.instrucao, 1500);
    const resumo = resumoDoCorpo(corpo.resumo);
    const m = await carregarModelo(modeloId, "texto");
    const sistema = sistemaDoPlano();
    const pedido = pedidoDoPlano(instrucao, resumo);
    const raciocinio = corpo.raciocinio ? String(corpo.raciocinio) : undefined;
    // O método da casa (superpoderes) do agente de edição entra no plano, como no agente editor. Vem ANTES da
    // conta: o tamanho dele entra na estimativa (a tela soma o teto, então o mostrado cobre o conferido).
    const metodo = await superpoderesPara(a.servico(), { agente: "edicao.agente", pedido: instrucao || "editar o vídeo" });
    const estimativa = estimativaDoPlanoUsd(m.preco_entrada_1m, m.preco_saida_1m, sistema.length + pedido.length + (metodo ? metodo.tamanho + 2 : 0), !!raciocinio);
    a.conferirCusto(estimativa, corpo.custo_maximo_usd);
    return a.folego(async () => {
      try {
        const r = await chamarTexto({
          clientId,
          metodo,
          tarefa: "conversa",
          agente: "diretor_arte",
          modeloId,
          sistema,
          mensagens: [{ papel: "usuario", conteudo: pedido }],
          raciocinio,
          esquemaJson: ESQUEMA_DO_PLANO,
          referencia: { tipo: REF_PLANO, id: referencia },
          criadoPor: a.userId(ch),
        });
        // 02/10: receita calma só se o pedido pede (a profissão do cliente não escolhe edição tímida),
        // e o pedido do dono por cima do plano (o que ele negou sai antes de a tela montar).
        const bruto = r.json && typeof r.json === "object" ? { ...(r.json as Record<string, unknown>) } : {};
        bruto.receita = receitaPeloPedido(String(bruto.receita || "dinamico"), instrucao);
        const normal = normalizarPlano(bruto, { fontesDeAudio: resumo.musicas, fala: resumo.fala });
        const comPedido = planoComPedido(normal.plano, lerPedidoDoDono(instrucao));
        const plano = comPedido.plano;
        const avisos = normal.avisos.concat(comPedido.fora.map((f) => `Não entra: ${f}.`));
        await a.auditar(ch, "editor_edicao_planejar", { client_id: clientId, modelo_id: r.modeloId, receita: plano.receita }, true);
        return a.json({ plano, avisos, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, modelo_id: r.modeloId, uso_id: r.usoId || null });
      } catch (e) {
        return a.respostaDeErro(e);
      }
    });
  }

  async function momentosAvaliar(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const frases = frasesConferidas(corpo.frases);
    if (!frases.length) return a.json({ forca: [], virais: [], fonte: "regra" });
    const titulo = curto(corpo.titulo, 120);
    const querForca = corpo.forca !== false;
    const querVirais = corpo.virais === true;
    const janelas = querVirais ? janelasCandidatas(frases) : [];
    const forcaQ = querForca ? perguntasDeForca(titulo, frases) : null;
    const viralQ = janelas.length ? perguntasDeViral(titulo, janelas) : null;
    const [rf, rv] = await jevOuErro("momentos", clientId, () =>
      Promise.all([forcaQ ? jevPerguntar(forcaQ) : Promise.resolve(null), viralQ ? jevPerguntar(viralQ) : Promise.resolve(null)]),
    );
    const forca = rf ? notasDeForca(frases, rf.answers) : [];
    const virais = rv ? escolherVirais(janelas, rv.answers) : [];
    await a.auditar(ch, "editor_momentos_avaliar", { client_id: clientId, frases: frases.length, virais: virais.length }, true);
    return a.json({ forca, virais, fonte: "jev" });
  }

  async function capitulosSugerir(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const frases = frasesConferidas(corpo.frases);
    if (frases.length < 3) return a.json({ capitulos: frases.length ? [{ inicio_s: frases[0].inicio_s, titulo: "Parte 1" }] : [], fonte: "regra" });
    const minimo = Math.max(10, Math.min(120, Number(corpo.minimo_s) || 20));
    const r1 = await jevOuErro("capítulos", clientId, () => jevPerguntar(perguntasDeFronteira(frases)));
    const comecos = comecosDeCapitulo(frases, r1.answers, minimo);
    const grupos = comecos.map((c, i) => {
      const doCapitulo = frases.slice(c, i + 1 < comecos.length ? comecos[i + 1] : frases.length);
      return { frases: doCapitulo, candidatos: candidatosDeTitulo(doCapitulo) };
    });
    const q2 = perguntasDeTitulo(grupos);
    let titulos: string[];
    if (Object.keys(q2.questions).length) {
      const r2 = await jevOuErro("títulos", clientId, () => jevPerguntar(q2));
      titulos = titulosEscolhidos(grupos, r2.answers);
    } else titulos = grupos.map((_, i) => `Parte ${i + 1}`);
    const capitulos = grupos.map((g, i) => ({ inicio_s: g.frases[0].inicio_s, titulo: titulos[i] }));
    await a.auditar(ch, "editor_capitulos", { client_id: clientId, capitulos: capitulos.length }, true);
    return a.json({ capitulos, fonte: "jev" });
  }

  async function brollEscolher(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const frases = frasesConferidas(corpo.frases, 30);
    const itens = itensConferidos(corpo.acervo);
    const maximo = Math.max(0, Math.min(12, Math.round(Number(corpo.maximo) || 4)));
    if (!frases.length || !itens.length || !maximo) return a.json({ escolhas: [], fonte: "regra" });
    const r = await jevOuErro("B-roll", clientId, () => jevPerguntar(perguntasDeBroll(frases, itens)));
    const escolhas = escolherBroll(frases, itens, r.answers, maximo);
    await a.auditar(ch, "editor_broll_escolher", { client_id: clientId, frases: frases.length, itens: itens.length, escolhas: escolhas.length }, true);
    return a.json({ escolhas, fonte: "jev" });
  }

  async function pedidoJulgar(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const texto = curto(corpo.pedido, 1500);
    const pecas = (Array.isArray(corpo.pecas) ? corpo.pecas : []).map(String).filter((x): x is PecaDoPedido => (PECAS_DO_PEDIDO as readonly string[]).indexOf(x) >= 0).slice(0, PECAS_DO_PEDIDO.length);
    if (!texto || !pecas.length) return a.json({ querer: {}, fonte: "regra" });
    const r = await jevOuErro("pedido", clientId, () => jevPerguntar(perguntasDoPedido(texto, pecas)));
    const querer: Record<string, number> = {};
    pecas.forEach((p) => {
      const x = r.answers[`quer_${p}`];
      if (x && typeof x.noul === "number" && isFinite(x.noul)) querer[p] = Math.round(x.noul * 1000) / 1000;
    });
    await a.auditar(ch, "editor_pedido_julgar", { client_id: clientId, pecas: pecas.length }, true);
    return a.json({ querer, fonte: "jev" });
  }

  async function rostoRastrear(ch: unknown, corpo: Record<string, unknown>) {
    const clientId = String(corpo.client_id || "");
    await a.garantirAcesso(ch, clientId);
    const referencia = a.idDe(corpo.referencia_id, "referencia_id");
    const modeloId = String(corpo.modelo_id || "");
    const quadros = Array.isArray(corpo.quadros) ? (corpo.quadros as Record<string, unknown>[]) : [];
    if (!quadros.length) throw a.erro(400, "sem_quadros", "Nenhum quadro para ver.");
    if (quadros.length > MAX_QUADROS_DO_ROSTO) throw a.erro(413, "quadros_demais", `Até ${MAX_QUADROS_DO_ROSTO} quadros por vez.`);
    const imagens: ImagemEntrada[] = [];
    const tempos: number[] = [];
    quadros.forEach((q, k) => {
      const t = Number(q.tempo_s);
      const b64 = String(q.jpeg_base64 || "").replace(/^data:image\/[a-z]+;base64,/i, "");
      if (!isFinite(t) || t < 0 || !b64) throw a.erro(400, "quadro_invalido", `Quadro ${k + 1} sem tempo ou sem imagem.`);
      const bytes = deBase64(b64);
      if (bytes.length > MAX_BYTES_DO_QUADRO) throw a.erro(413, "quadro_grande", `Quadro ${k + 1} grande demais.`);
      imagens.push({ bytes, mime: "image/jpeg", nome: `quadro-${k + 1}.jpg` });
      tempos.push(Math.round(t * 1000) / 1000);
    });
    const m = await carregarModelo(modeloId, "texto");
    const entrada = (m.modalidades && m.modalidades.entrada) || null;
    if (entrada && entrada.indexOf("image") < 0) throw a.erro(400, "modelo_sem_imagem", "Esse modelo não vê imagem. Escolha outro.");
    const sistema = sistemaDoRosto();
    const legenda = `Fonte ${curto(corpo.fonte, 60)}. ${tempos.length} quadros, na ordem 1 a ${tempos.length}.`;
    const estimativa = estimativaDoRostoUsd(m.preco_entrada_1m, m.preco_saida_1m, imagens.length, sistema.length + legenda.length);
    a.conferirCusto(estimativa, corpo.custo_maximo_usd);
    return a.folego(async () => {
      try {
        const r = await chamarTexto({
          clientId,
          tarefa: "leitura_referencia",
          agente: "leitor",
          modeloId,
          sistema,
          mensagens: [{ papel: "usuario", conteudo: legenda, imagens }],
          esquemaJson: ESQUEMA_DO_ROSTO,
          referencia: { tipo: REF_ROSTO, id: referencia },
          criadoPor: a.userId(ch),
        });
        const leituras = leiturasDoRosto(r.json, tempos);
        await a.auditar(ch, "editor_rosto", { client_id: clientId, quadros: tempos.length, com_rosto: leituras.filter((l) => l.x !== null).length }, true);
        return a.json({ leituras, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, modelo_id: r.modeloId });
      } catch (e) {
        return a.respostaDeErro(e);
      }
    });
  }

  return {
    edicao_planejar: planejar,
    momentos_avaliar: momentosAvaliar,
    capitulos_sugerir: capitulosSugerir,
    broll_escolher: brollEscolher,
    rosto_rastrear: rostoRastrear,
    pedido_julgar: pedidoJulgar,
  };
}
