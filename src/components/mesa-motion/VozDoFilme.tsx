import { useEffect, useRef, useState } from "react";
import { AudioLines, Loader2, Mic, Sparkles, Timer, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { PreencherComIA } from "@/components/sistema";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import {
  duracaoEstimadaDaFala,
  ESTILOS_DA_VOZ,
  type EstiloDaVoz,
  estimarNarracao,
  lerNarracao,
  modeloDeVoz,
  MODELOS_DE_VOZ,
  type NarracaoDoFilme,
  narracaoDaCena,
  semTags,
  TAGS_DE_EMOCAO,
} from "../../../supabase/functions/mesa-motion/modulos/narracao";
import { ModeloDaAcao, useModeloDaAcao } from "./FilmeAberto";
import JanelaDasVozes from "./JanelaDasVozes";
import { normalizarFilme } from "../../../supabase/functions/_shared/motion-metodo";
import { chamarMotion, type Filme, useGuardarFilme } from "./motionApi";
import { previaDaVoz, trechoDoAudio, useSituacaoDaVoz, type VozSalva } from "./vozApi";

/**
 * Narração do filme pela ElevenLabs (frente MOV, etapa Voz e som): a voz da
 * marca (salva por cliente e marca), o modelo (Eleven v4 é o padrão), o
 * estilo e a velocidade; a fala de cada cena com as tags de emoção e o
 * tempo estimado contra o tempo da cena; a narração do roteiro inteiro numa
 * leitura (mais natural) ou só das cenas que faltam, sempre com o custo
 * antes; e "Encaixar as cenas na voz" com Desfazer. Sem a chave no servidor,
 * a seção diz o que falta e nada que gasta fica clicável.
 */

type Modo = "roteiro" | "cenas";
type Duracao = { id: string; duracao_s: number };

export default function VozDoFilme({ filme, links }: { filme: Filme; links: Record<string, string> }) {
  const { clientId, atualizarCusto, saldoUsd } = useMesa();
  const { marca } = useMarcaDaMesa();
  const marcaId = marca ? marca.id : null;
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const situacao = useSituacaoDaVoz(clientId, marcaId);
  const { modelo: modeloDeTexto } = useModeloDaAcao("falas");
  const n = filme.som.narracao;
  const [falas, setFalas] = useState<Record<string, string>>(n.falas);
  const [indo, setIndo] = useState<string | null>(null);
  const [janelaVozes, setJanelaVozes] = useState(false);
  const [confirmar, setConfirmar] = useState<null | { modo: Modo | "cena"; cenaId?: string }>(null);
  const [modo, setModo] = useState<Modo>("roteiro");
  const [substituir, setSubstituir] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const campos = useRef<Record<string, HTMLTextAreaElement | null>>({});
  useEffect(() => setFalas(n.falas), [n.falas]);

  const temChave = !!(situacao.data && situacao.data.tem_chave);
  const vozes = situacao.data ? situacao.data.vozes : [];
  const m = modeloDeVoz(n.modelo);

  const salvar = async (nova: NarracaoDoFilme): Promise<boolean> => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, som: { ...filme.som, narracao: nova } });
      guardar(d.filme);
      return true;
    } catch (e) {
      avisarErro(e, "A narração não foi salva");
      return false;
    }
  };
  const mudar = (parcial: Partial<NarracaoDoFilme>) => void salvar(lerNarracao({ ...n, falas, ...parcial }));

  // Sem voz no filme e com a voz padrão da marca: já vem escolhida (a pessoa troca quando quiser).
  const padrao = situacao.data ? situacao.data.padrao : null;
  useEffect(() => {
    if (!n.voz && padrao && n.ligada) mudar({ voz: { voice_id: padrao.voice_id, nome: padrao.nome, origem: padrao.origem } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padrao ? padrao.voice_id : null, n.ligada]);

  const usarVoz = (v: Pick<VozSalva, "voice_id" | "nome" | "origem">) => mudar({ ligada: true, voz: { voice_id: v.voice_id, nome: v.nome, origem: v.origem } });

  const salvarFala = (cenaId: string, valor: string) => {
    const novas = { ...falas, [cenaId]: valor };
    setFalas(novas);
    if ((n.falas[cenaId] || "") !== valor) void salvar(lerNarracao({ ...n, falas: novas }));
  };

  const porTag = (cenaId: string, tag: string) => {
    const atual = falas[cenaId] || "";
    const el = campos.current[cenaId];
    const pos = el && typeof el.selectionStart === "number" ? el.selectionStart : 0;
    const novo = `${atual.slice(0, pos)}${pos > 0 && atual.charAt(pos - 1) !== " " ? " " : ""}${tag} ${atual.slice(pos)}`.replace(/\s+/g, " ").trim();
    salvarFala(cenaId, novo);
  };

  const escreverFalas = async () => {
    setIndo("falas");
    try {
      const d = await chamarMotion<{ filme: Filme; anteriores: Record<string, string>; custo_usd: number; resumo: string }>("falas_escrever", { filme_id: filme.id, modelo_id: modeloDeTexto ? modeloDeTexto.id : undefined, substituir });
      guardar(d.filme);
      atualizarCusto();
      const anteriores = d.anteriores || {};
      toast.success("Falas escritas", {
        description: `${d.resumo ? `${d.resumo} ` : ""}Custo real: ${usd(d.custo_usd)}.`,
        duration: 15000,
        action: {
          label: "Desfazer",
          onClick: () => {
            const lido = normalizarFilme(d.filme);
            void salvar(lerNarracao({ ...(lido ? lido.som.narracao : n), falas: anteriores }));
          },
        },
      });
    } catch (e) {
      avisarErro(e, "As falas não foram escritas");
    } finally {
      setIndo(null);
    }
  };

  const comFala = filme.cenas.filter((c) => semTags(falas[c.id] || ""));
  const faltam = comFala.filter((c) => {
    const nc = narracaoDaCena(n, c.id);
    return !nc || nc.desatualizada;
  });
  const alvoDoModo = (q: Modo | "cena", cenaId?: string) => (q === "cena" ? comFala.filter((c) => c.id === cenaId) : q === "cenas" ? faltam : comFala);
  const estimativa = (q: Modo | "cena", cenaId?: string) => estimarNarracao(alvoDoModo(q, cenaId).map((c) => falas[c.id] || ""), n.modelo);

  const gerar = async (q: Modo | "cena", cenaId?: string) => {
    setConfirmar(null);
    setIndo(q === "cena" ? `cena:${cenaId}` : "narracao");
    try {
      const d = await chamarMotion<{ filme: Filme; links: Record<string, string>; custo_usd: number; avisos: string[] }>("narracao_gerar", { filme_id: filme.id, modo: q, cena_id: cenaId });
      guardar(d.filme, d.links);
      atualizarCusto();
      setAvisos(d.avisos || []);
      toast.success("Narração pronta", { description: `Custo real: ${usd(d.custo_usd)}. Agora encaixe as cenas na voz.` });
    } catch (e) {
      avisarErro(e, "A narração não foi gerada");
    } finally {
      setIndo(null);
    }
  };

  const desfazerCasar = async (anterior: Duracao[], casadas: Duracao[]) => {
    try {
      const d = await chamarMotion<{ filme: Filme; voltaram: number }>("ritmo_desfazer", { filme_id: filme.id, anterior, casadas });
      guardar(d.filme);
      toast.success(d.voltaram ? "As durações de antes voltaram" : "Nada voltou: as cenas mudaram depois");
    } catch (e) {
      avisarErro(e, "Não deu para desfazer");
    }
  };

  const casar = async () => {
    setIndo("casar");
    try {
      const d = await chamarMotion<{ filme: Filme; anterior: Duracao[]; avisos: string[]; casadas: number }>("narracao_casar", { filme_id: filme.id });
      guardar(d.filme);
      const casadas = (d.filme && Array.isArray(d.filme.cenas) ? d.filme.cenas : []).map((c) => ({ id: c.id, duracao_s: c.duracao_s }));
      setAvisos(d.avisos || []);
      toast.success(`${d.casadas} ${d.casadas === 1 ? "cena encaixada" : "cenas encaixadas"} na voz`, { duration: 15000, action: { label: "Desfazer", onClick: () => void desfazerCasar(d.anterior, casadas) } });
    } catch (e) {
      avisarErro(e, "As cenas não foram encaixadas");
    } finally {
      setIndo(null);
    }
  };

  const est = confirmar ? estimativa(confirmar.modo, confirmar.cenaId) : null;
  const descricao = !n.ligada ? "Desligada: o filme sai só com trilha e efeitos" : n.voz ? `${n.voz.nome} · ${m.rotulo}` : "Escolha a voz";
  const semChave = situacao.data && !situacao.data.tem_chave;

  return (
    <Secao
      titulo="Narração"
      descricao={descricao}
      recolher="mesa-motion:narracao"
      ajuda="A voz da marca lê a fala de cada cena pela ElevenLabs. O Eleven v4 (28/09/2026) é o padrão: o mais expressivo, entende as tags de emoção entre colchetes ([warmly], [excited], [pause]) e é o melhor em português do Brasil. Gere o roteiro inteiro numa leitura só (a entonação liga uma cena na outra) e depois encaixe a duração das cenas no tempo da fala. Custo pelo preço de tabela, antes de gastar, na carteira do cliente."
      acao={
        <SeletorCompacto
          opcoes={[
            { valor: "sim", rotulo: "Com narração" },
            { valor: "nao", rotulo: "Sem" },
          ]}
          valor={n.ligada ? "sim" : "nao"}
          onEscolher={(v) => mudar({ ligada: v === "sim" })}
          rotulo="Narração do filme"
        />
      }
      data-voz-do-filme=""
    >
      {semChave && (
        <p className={juntar(texto.auxiliar, "mb-3 text-warning")} data-sem-chave="" role="status">
          {situacao.data!.aviso_chave}
        </p>
      )}
      {situacao.data && situacao.data.indisponivel && <p className={juntar(texto.auxiliar, "mb-3 text-warning")}>{situacao.data.aviso}</p>}
      {n.ligada && (
        <div className="min-w-0 space-y-5">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="min-w-0">
              <span className={texto.rotulo}>Voz</span>
              <div className="flex min-w-0 items-center">
                <select
                  className={juntar(campo, "mr-2 min-w-0 flex-1")}
                  value={n.voz ? n.voz.voice_id : ""}
                  onChange={(e) => {
                    const v = vozes.find((x) => x.voice_id === e.target.value);
                    if (v) usarVoz(v);
                  }}
                  aria-label="Voz da narração"
                >
                  <option value="">{vozes.length ? "Escolha a voz" : "Nenhuma voz da marca"}</option>
                  {n.voz && !vozes.some((x) => x.voice_id === n.voz!.voice_id) && <option value={n.voz.voice_id}>{n.voz.nome}</option>}
                  {vozes.map((v) => (
                    <option key={v.id} value={v.voice_id}>
                      {v.nome}
                      {v.padrao ? " (padrão da marca)" : ""}
                    </option>
                  ))}
                </select>
                <button type="button" className={juntar(botao.secundario, "shrink-0")} onClick={() => setJanelaVozes(true)} disabled={!!semChave && !vozes.length} data-abrir-vozes="">
                  <Mic className="mr-1 h-3.5 w-3.5" />
                  Vozes
                </button>
              </div>
            </div>
            <label className="min-w-0">
              <span className={texto.rotulo}>Modelo de voz</span>
              <select className={campo} value={n.modelo} onChange={(e) => mudar({ modelo: e.target.value })} aria-label="Modelo de voz" title={m.dica}>
                {MODELOS_DE_VOZ.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.rotulo} · {usd(x.preco_1k_usd)} por mil caracteres
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className={texto.rotulo}>Estilo</span>
              <select className={campo} value={n.ajustes.estilo} onChange={(e) => mudar({ ajustes: { ...n.ajustes, estilo: e.target.value as EstiloDaVoz } })} aria-label="Estilo da voz">
                {ESTILOS_DA_VOZ.map((x) => (
                  <option key={x.valor} value={x.valor}>
                    {x.rotulo}: {x.dica.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className={texto.rotulo}>Velocidade ({n.ajustes.velocidade.toFixed(2).replace(".", ",")}x)</span>
              <input type="range" min={0.7} max={1.2} step={0.05} value={n.ajustes.velocidade} onChange={(e) => mudar({ ajustes: { ...n.ajustes, velocidade: Number(e.target.value) } })} className="w-full" aria-label="Velocidade da voz" />
            </label>
          </div>
          {n.voz && vozes.find((x) => x.voice_id === n.voz!.voice_id) && previaDaVoz(vozes.find((x) => x.voice_id === n.voz!.voice_id)!) && (
            <audio controls preload="none" className="h-8 w-full max-w-[320px]" src={previaDaVoz(vozes.find((x) => x.voice_id === n.voz!.voice_id)!) || undefined} aria-label="Prévia da voz" />
          )}

          <div className="min-w-0">
            <div className="mb-2 flex min-w-0 flex-wrap items-end justify-between">
              <span className={juntar(texto.tituloSecao, "mb-2 mr-3")}>Falas por cena</span>
              <div className="-m-1 flex min-w-0 flex-wrap items-end">
                <div className="m-1 min-w-0">
                  <ModeloDaAcao chave="falas" alvo="falas" />
                </div>
                <label className={juntar(texto.auxiliar, "m-1 mb-3 flex items-center")}>
                  <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={substituir} onChange={(e) => setSubstituir(e.target.checked)} />
                  Substituir as que já têm
                </label>
                <button type="button" className={juntar(botao.secundario, "m-1 mb-2")} onClick={() => void escreverFalas()} disabled={indo === "falas" || !filme.cenas.length} data-escrever-falas="">
                  {indo === "falas" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                  Escrever as falas com IA
                </button>
              </div>
            </div>
            {!filme.cenas.length && <p className={texto.auxiliar}>Escolha o storyboard para ter as cenas.</p>}
            <ul className={juntar(lista.aberta, lista.divisoria)}>
              {filme.cenas.map((c, i) => {
                const fala = falas[c.id] || "";
                const segundos = duracaoEstimadaDaFala(fala, n.ajustes.velocidade);
                const uteis = Math.max(1, Math.round((c.duracao_s - n.antes_s - n.depois_s) * 10) / 10);
                const nc = narracaoDaCena(n, c.id);
                const url = nc ? links[nc.audio.path] : null;
                return (
                  <li key={c.id} className="min-w-0 px-2 py-3" data-fala-da-cena={c.id}>
                    <div className="mb-1 flex min-w-0 items-center justify-between">
                      <span className={juntar(texto.rotulo, "min-w-0 truncate")}>
                        Cena {i + 1} · {c.titulo} · {c.duracao_s} s
                      </span>
                      <span className="flex shrink-0 items-center">
                        {fala && (
                          <span className={juntar(texto.etiqueta, "mr-2", segundos > uteis ? "text-warning" : "text-muted-foreground")} title="Tempo estimado da fala contra o tempo útil da cena">
                            ~{segundos} s de {uteis} s
                          </span>
                        )}
                        <PreencherComIA
                          papel="motion"
                          clientId={clientId}
                          marcaId={marcaId}
                          compacto
                          campos={[{ chave: c.id, rotulo: `Fala da cena ${i + 1}`, tipo: "texto_longo", valorAtual: fala, maximo: Math.round(uteis * 15), dica: `Locução para o ouvido, cabe em ${uteis} s (cerca de 15 caracteres por segundo). ${m.tags ? "No máximo uma tag de emoção em inglês entre colchetes no começo." : "Sem tags entre colchetes."} Número e depoimento só das provas com fonte.` }]}
                          contexto={`Filme "${filme.nome}". Cena ${i + 1}: ${c.titulo}. Ideia: ${c.ideia || "-"}. Promessa: ${filme.brand.promessa || "-"}. Tom: ${filme.brand.tom || "-"}.`}
                          onAplicar={(v) => salvarFala(c.id, String(v[c.id] ?? ""))}
                          onDesfazer={(v) => salvarFala(c.id, String(v[c.id] ?? ""))}
                        />
                      </span>
                    </div>
                    <textarea
                      ref={(el) => (campos.current[c.id] = el)}
                      className={juntar(campoTexto, "min-h-[56px]")}
                      value={fala}
                      maxLength={1200}
                      placeholder="O que a voz diz nesta cena (vazio = cena sem fala)"
                      onChange={(e) => setFalas({ ...falas, [c.id]: e.target.value })}
                      onBlur={(e) => salvarFala(c.id, e.target.value)}
                      aria-label={`Fala da cena ${i + 1}`}
                    />
                    <div className="mt-1 flex min-w-0 flex-wrap items-center">
                      {m.tags &&
                        TAGS_DE_EMOCAO.slice(0, 8).map((t) => (
                          <button key={t.tag} type="button" className={juntar(botao.discreto, "mb-1 mr-1 h-7 px-2 text-[12px]")} onClick={() => porTag(c.id, t.tag)} title={`Pôr ${t.tag} onde está o cursor`}>
                            {t.rotulo}
                          </button>
                        ))}
                    </div>
                    {nc && (
                      <div className="mt-1 flex min-w-0 flex-wrap items-center">
                        {url ? <audio controls preload="none" className="mb-1 mr-2 h-8 w-full max-w-[320px]" src={trechoDoAudio(url, nc.trecho.de_s, nc.trecho.ate_s)} aria-label={`Narração da cena ${i + 1}`} /> : null}
                        <span className={juntar(texto.etiqueta, nc.desatualizada ? "text-warning" : "text-muted-foreground")}>
                          {Math.round((nc.trecho.ate_s - nc.trecho.de_s) * 10) / 10} s de voz{nc.desatualizada ? " · a fala mudou: gere de novo" : ""}
                        </span>
                      </div>
                    )}
                    {fala && temChave && n.voz && (!nc || nc.desatualizada) && (
                      <button type="button" className={juntar(botao.discreto, "mt-1 h-8")} onClick={() => setConfirmar({ modo: "cena", cenaId: c.id })} disabled={!!indo} data-gerar-voz-da-cena={c.id}>
                        {indo === `cena:${c.id}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <AudioLines className="mr-1 h-3.5 w-3.5" />}
                        Gerar a voz desta cena · {usd(estimativa("cena", c.id).custo_usd)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="-m-1 flex min-w-0 flex-wrap items-center" data-acoes-da-narracao="">
            <div className="m-1">
              <SeletorCompacto
                opcoes={[
                  { valor: "roteiro", rotulo: "Roteiro inteiro" },
                  { valor: "cenas", rotulo: `Só as que faltam (${faltam.length})` },
                ]}
                valor={modo}
                onEscolher={(v) => setModo(v as Modo)}
                rotulo="O que narrar"
              />
            </div>
            <button type="button" className={juntar(botao.primario, "m-1")} onClick={() => setConfirmar({ modo })} disabled={!temChave || !n.voz || !comFala.length || !!indo || (modo === "cenas" && !faltam.length)} data-gerar-narracao="">
              {indo === "narracao" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
              Gerar a narração · {usd(estimativa(modo).custo_usd)}
            </button>
            <button type="button" className={juntar(botao.secundario, "m-1")} onClick={() => void casar()} disabled={!n.audios.length || !!indo} data-encaixar-na-voz="">
              {indo === "casar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Timer className="mr-1 h-3.5 w-3.5" />}
              Encaixar as cenas na voz
            </button>
          </div>
          {!temChave && situacao.data && <p className={texto.auxiliar}>Sem a chave: escolha o modelo e escreva as falas; a voz sai depois.</p>}
          {avisos.map((a) => (
            <p key={a} className={juntar(texto.auxiliar, "text-warning")}>
              {a}
            </p>
          ))}
        </div>
      )}

      <JanelaDasVozes aberta={janelaVozes} onFechar={() => setJanelaVozes(false)} filme={filme} temChave={temChave} onUsar={(v) => usarVoz(v)} />

      <JanelaCentral
        aberta={!!confirmar}
        onMudar={(v) => !v && setConfirmar(null)}
        titulo="Gerar a narração"
        icone={<AudioLines className="h-4 w-4" />}
        largura="sm"
        descricaoOculta="Confirme o custo da narração"
        rodape={
          <div className="flex min-w-0 justify-end">
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button type="button" className={botao.primario} onClick={() => confirmar && void gerar(confirmar.modo, confirmar.cenaId)} data-confirmar-narracao="">
              Gerar · {est ? usd(est.custo_usd) : ""}
            </button>
          </div>
        }
      >
        {confirmar && est && (
          <div className="min-w-0 space-y-2">
            <p className={texto.corpo}>
              {confirmar.modo === "cena" ? "Uma cena" : confirmar.modo === "cenas" ? `${alvoDoModo("cenas").length} cenas, uma por vez` : `${alvoDoModo("roteiro").length} cenas numa leitura só`} na voz {n.voz ? n.voz.nome : ""}, modelo {m.rotulo}.
            </p>
            <p className={texto.auxiliar}>
              {est.caracteres} caracteres × {usd(m.preco_1k_usd)} por mil = {usd(est.custo_usd)} (preço de tabela). Saldo da carteira: {saldoUsd === null ? "lendo" : usd(saldoUsd)}.
            </p>
            {saldoUsd !== null && saldoUsd < est.custo_usd && <p className={juntar(texto.auxiliar, "text-warning")}>O saldo não cobre: recarregue a carteira antes.</p>}
          </div>
        )}
      </JanelaCentral>
    </Secao>
  );
}
