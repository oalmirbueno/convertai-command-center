import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Loader2, Pause, Play, Repeat, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import { chaves, type Campanha } from "./mesaV4Api";
import {
  chaveDaTrilha,
  DURACOES,
  escolherTrilhaDaCampanha,
  favoritarSom,
  gerarEfeitosDaCampanha,
  gerarTrilhasDaCampanha,
  lerTrilhaDaCampanha,
  linkParaBaixar,
  ondaPeloId,
  picosDoAudio,
  type EstadoDaTrilha,
  type ResultadoDaGeracao,
  type SomDaCampanha,
} from "./trilhaDaCampanhaApi";

/**
 * Trilha e efeitos da campanha (22/10/2026). Dono: "um seletor de músicas para
 * usar ... sem voz, e sim os sons com base no tema; isso dentro da campanha".
 * A trilha sai pela ElevenLabs Music (sempre instrumental) pelo tema e pelo tom
 * da campanha, em 15, 30 ou 60 s ou em loop para Story e Reels, 2 ou 3 opções
 * por pedido; os efeitos, pelo pacote do tema ou pedido livre. Custo antes
 * (Confirmar). Ouvir com ondinha, favoritar, baixar o MP3 e escolher a trilha
 * da campanha (briefing.trilha e Arquivos do cliente).
 */

type Pendente =
  | { tipo: "trilha"; mensagem: string; custo: number }
  | { tipo: "efeitos"; mensagem: string; custo: number; livre: string | null };

// ------------------------------------------------------------------ player

const BARRAS = 64;

function Onda({ som, progresso, tocando, onPular }: { som: SomDaCampanha; progresso: number; tocando: boolean; onPular: (fracao: number) => void }) {
  const [barras, setBarras] = useState<number[]>(() => ondaPeloId(som.id, BARRAS));
  const lida = useRef(false);
  useEffect(() => {
    // A onda de verdade só quando o som toca (não baixa o áudio de toda a lista ao abrir).
    if (!tocando || lida.current || !som.link) return;
    lida.current = true;
    let vivo = true;
    void picosDoAudio(som.link, BARRAS).then((p) => {
      if (vivo && p) setBarras(p);
    });
    return () => {
      vivo = false;
    };
  }, [tocando, som.link]);
  return (
    <div
      className="flex h-7 min-w-0 cursor-pointer items-center justify-between"
      role="slider"
      aria-label={`Posição em ${som.titulo}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progresso * 100)}
      tabIndex={-1}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        if (r.width > 0) onPular(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      }}
    >
      {barras.map((b, i) => (
        <span
          key={i}
          className={juntar("inline-block w-[3px] shrink-0 rounded-full", i / barras.length < progresso ? "bg-primary" : "bg-muted-foreground/35")}
          style={{ height: `${Math.round(b * 100)}%` }}
        />
      ))}
    </div>
  );
}

const duracaoCurta = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)} s`);

function LinhaDoSom({
  som,
  tocando,
  progresso,
  ocupado,
  onTocar,
  onPular,
  onFavoritar,
  onEscolher,
}: {
  som: SomDaCampanha;
  tocando: boolean;
  progresso: number;
  ocupado: boolean;
  onTocar: () => void;
  onPular: (f: number) => void;
  onFavoritar: () => void;
  onEscolher?: () => void;
}) {
  return (
    <li className={juntar(lista.linha, "items-start")} data-som={som.id}>
      <button
        type="button"
        className={juntar(botao.icone, tocando && "text-primary")}
        onClick={onTocar}
        disabled={!som.link}
        aria-label={tocando ? `Pausar ${som.titulo}` : `Ouvir ${som.titulo}`}
        title={tocando ? "Pausar" : "Ouvir"}
      >
        {tocando ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
      </button>
      <div className="ml-2 min-w-0 flex-1">
        <div className="flex min-w-0 items-center">
          <span className={juntar(texto.corpo, "min-w-0 truncate")} title={som.titulo}>{som.titulo}</span>
          {som.escolhida && <span className={juntar(etiqueta, "ml-2 bg-primary/10 text-primary")}>na campanha</span>}
          <span className={juntar(texto.auxiliar, "ml-auto shrink-0 pl-2 tabular-nums")}>{duracaoCurta(som.duracao_s)}</span>
        </div>
        <Onda som={som} progresso={progresso} tocando={tocando} onPular={onPular} />
      </div>
      <div className="ml-1 flex shrink-0 items-center">
        <button
          type="button"
          className={juntar(botao.icone, som.favorito && "text-primary")}
          onClick={onFavoritar}
          aria-pressed={som.favorito}
          aria-label={som.favorito ? `Tirar ${som.titulo} das favoritas` : `Favoritar ${som.titulo}`}
          title={som.favorito ? "Tirar das favoritas" : "Favoritar"}
        >
          <Star className={juntar("h-4 w-4", som.favorito && "fill-current")} aria-hidden="true" />
        </button>
        {onEscolher && (
          <button
            type="button"
            className={juntar(botao.icone, som.escolhida && "text-primary")}
            onClick={onEscolher}
            disabled={ocupado}
            aria-pressed={som.escolhida}
            aria-label={som.escolhida ? `Tirar ${som.titulo} da campanha` : `Usar ${som.titulo} como trilha da campanha`}
            title={som.escolhida ? "Tirar da campanha" : "Usar como trilha da campanha"}
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
        {som.link ? (
          <a className={botao.icone} href={linkParaBaixar(som.link, som.titulo)} download aria-label={`Baixar ${som.titulo} em MP3`} title="Baixar MP3">
            <Download className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ seção

export default function CampanhaTrilha({ campanha }: { campanha: Campanha }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const chave = chaveDaTrilha(campanha.id);
  const estado = useQuery({ queryKey: chave, queryFn: () => lerTrilhaDaCampanha(campanha.id) });

  const [tema, setTema] = useState<string>("");
  const [duracao, setDuracao] = useState<number>(30);
  const [loop, setLoop] = useState(false);
  const [opcoes, setOpcoes] = useState(3);
  const [extra, setExtra] = useState("");
  const [livre, setLivre] = useState("");
  const [pacote, setPacote] = useState<string[] | null>(null);
  const [soFavoritas, setSoFavoritas] = useState(false);
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [gerando, setGerando] = useState<"trilha" | "efeitos" | null>(null);
  const [escolhendo, setEscolhendo] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const [tocandoId, setTocandoId] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(0);

  useEffect(() => () => {
    if (audio.current) audio.current.pause();
  }, []);

  const dados: EstadoDaTrilha | undefined = estado.data;
  const temaAtual = tema || (dados ? dados.tema.id : "");
  const sons = dados ? dados.sons : [];
  const filtrar = (s: SomDaCampanha) => !soFavoritas || s.favorito;
  const trilhas = sons.filter((s) => s.tipo === "trilha").filter(filtrar);
  const efeitos = sons.filter((s) => s.tipo === "efeito").filter(filtrar);
  const doPacote = dados ? dados.pacote : [];
  const marcados = pacote || doPacote.map((e) => e.id);
  const suno = dados ? dados.provedores.find((p) => p.id === "suno") : undefined;

  const trocarSons = (novos: SomDaCampanha[]) => qc.setQueryData<EstadoDaTrilha>(chave, (v) => (v ? { ...v, sons: novos } : v));

  function tocar(s: SomDaCampanha) {
    if (!s.link) return;
    if (!audio.current) {
      const a = new Audio();
      a.addEventListener("timeupdate", () => setProgresso(a.duration > 0 ? a.currentTime / a.duration : 0));
      a.addEventListener("ended", () => {
        setTocandoId(null);
        setProgresso(0);
      });
      audio.current = a;
    }
    const a = audio.current;
    if (tocandoId === s.id) {
      a.pause();
      setTocandoId(null);
      return;
    }
    a.src = s.link;
    a.loop = s.loop;
    setProgresso(0);
    setTocandoId(s.id);
    try {
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => setTocandoId(null));
    } catch {
      setTocandoId(null);
    }
  }

  function pular(s: SomDaCampanha, f: number) {
    const a = audio.current;
    if (tocandoId !== s.id || !a || !(a.duration > 0)) return;
    a.currentTime = f * a.duration;
    setProgresso(f);
  }

  async function aposGerar(r: ResultadoDaGeracao, tipo: Pendente["tipo"], livreTexto: string | null) {
    if (r.situacao === "confirmar_custo") {
      setPendente(tipo === "trilha" ? { tipo, mensagem: r.mensagem, custo: r.custo_estimado_usd } : { tipo, mensagem: r.mensagem, custo: r.custo_estimado_usd, livre: livreTexto });
      return;
    }
    setPendente(null);
    trocarSons(r.sons);
    if (r.avisos.length) toast.warning("Parte não saiu", { description: r.avisos.join(" ") });
    else toast.success(tipo === "trilha" ? "Trilhas prontas para ouvir" : "Efeitos prontos", { description: usd(r.custo_usd) });
    if (tipo === "efeitos" && livreTexto) setLivre("");
  }

  async function pedirTrilhas(confirmado: boolean) {
    setGerando("trilha");
    try {
      const r = await gerarTrilhasDaCampanha({ campanhaId: campanha.id, duracao, loop, opcoes, extra, tema: temaAtual || null, confirmado });
      await aposGerar(r, "trilha", null);
    } catch (e) {
      toast.error("A trilha não saiu", { description: textoDoErro(e) });
    } finally {
      setGerando(null);
    }
  }

  async function pedirEfeitos(confirmado: boolean, livreTexto: string | null) {
    setGerando("efeitos");
    try {
      const r = await gerarEfeitosDaCampanha({ campanhaId: campanha.id, efeitos: marcados, livre: livreTexto || undefined, tema: temaAtual || null, confirmado });
      await aposGerar(r, "efeitos", livreTexto);
    } catch (e) {
      toast.error("O efeito não saiu", { description: textoDoErro(e) });
    } finally {
      setGerando(null);
    }
  }

  async function escolher(s: SomDaCampanha) {
    setEscolhendo(s.id);
    try {
      const r = await escolherTrilhaDaCampanha(campanha.id, s.escolhida ? null : s.id);
      qc.setQueryData<EstadoDaTrilha>(chave, (v) =>
        v ? { ...v, escolhida: r.trilha, sons: v.sons.map((x) => ({ ...x, escolhida: !!r.trilha && x.id === s.id })) } : v,
      );
      void qc.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
      if (r.aviso) toast.warning("Trilha escolhida", { description: r.aviso });
      else toast.success(r.trilha ? "Trilha da campanha escolhida" : "Trilha tirada da campanha", r.trilha ? { description: "Também está em Arquivos do cliente." } : undefined);
    } catch (e) {
      toast.error("Não foi possível escolher", { description: textoDoErro(e) });
    } finally {
      setEscolhendo(null);
    }
  }

  async function favoritar(s: SomDaCampanha) {
    const novo = !s.favorito;
    trocarSons(sons.map((x) => (x.id === s.id ? { ...x, favorito: novo } : x)));
    try {
      await favoritarSom(campanha.id, s.id, novo);
    } catch (e) {
      trocarSons(sons);
      toast.error("Favorito não salvo", { description: textoDoErro(e) });
    }
  }

  const linha = (s: SomDaCampanha) => (
    <LinhaDoSom
      key={s.id}
      som={s}
      tocando={tocandoId === s.id}
      progresso={tocandoId === s.id ? progresso : 0}
      ocupado={escolhendo === s.id}
      onTocar={() => tocar(s)}
      onPular={(f) => pular(s, f)}
      onFavoritar={() => void favoritar(s)}
      onEscolher={s.tipo === "trilha" ? () => void escolher(s) : undefined}
    />
  );

  if (estado.isLoading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Lendo a trilha da campanha" />;
  if (estado.isError || !dados) {
    return (
      <p className={texto.auxiliar} role="alert">
        {textoDoErro(estado.error, "Não foi possível ler a trilha da campanha.")}
      </p>
    );
  }

  const custoDaTrilha = (dados.custos.trilha[String(duracao)] || 0) * opcoes;
  const semChave = !dados.tem_chave;

  return (
    <div className="min-w-0 space-y-5">
      {/* Escolhida, filtro e de onde vem o som. */}
      <div className="flex min-w-0 flex-wrap items-center">
        <span className={juntar(texto.rotulo, "mr-2")}>Trilha da campanha</span>
        <span className={juntar(texto.corpo, "mr-2 min-w-0 truncate")} title={dados.escolhida ? dados.escolhida.titulo : undefined}>
          {dados.escolhida ? dados.escolhida.titulo : "nenhuma escolhida"}
        </span>
        <span className="ml-auto flex shrink-0 items-center">
          <span className={juntar(texto.auxiliar, "mr-1")} title={suno && suno.motivo ? suno.motivo : undefined}>
            ElevenLabs{suno ? " · Suno desligado" : ""}
          </span>
          <button
            type="button"
            className={juntar(botao.icone, soFavoritas && "bg-muted text-foreground")}
            onClick={() => setSoFavoritas((v) => !v)}
            aria-pressed={soFavoritas}
            aria-label={soFavoritas ? "Mostrar todos os sons" : "Só as favoritas"}
            title={soFavoritas ? "Mostrar todos" : "Só as favoritas"}
          >
            <Star className={juntar("h-4 w-4", soFavoritas && "fill-current")} aria-hidden="true" />
          </button>
        </span>
      </div>

      {semChave && (
        <p className={juntar(texto.auxiliar, "text-destructive")} role="alert">
          {dados.aviso_chave || "Falta a chave da ElevenLabs no servidor."}
        </p>
      )}

      {pendente && (
        <div className="flex min-w-0 flex-wrap items-center border-y border-border py-2" role="alertdialog" aria-label="Confirmar o custo">
          <span className={juntar(texto.corpo, "mr-3 min-w-0")}>{pendente.mensagem}</span>
          <span className="ml-auto flex shrink-0 items-center">
            <button type="button" className={juntar(botao.discreto, "mr-1")} onClick={() => setPendente(null)} disabled={!!gerando}>
              Cancelar
            </button>
            <button
              type="button"
              className={botao.primario}
              disabled={!!gerando}
              onClick={() => (pendente.tipo === "trilha" ? void pedirTrilhas(true) : void pedirEfeitos(true, pendente.livre))}
            >
              {gerando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Confirmar {usd(pendente.custo)}
            </button>
          </span>
        </div>
      )}

      {/* Trilha: tema, duração, loop, opções e direção extra; sempre sem voz. */}
      <section className="min-w-0" aria-label="Trilha">
        <h3 className={juntar(texto.rotulo, "mb-2")}>Trilha sem voz · {trilhas.length}</h3>
        <div className="flex min-w-0 flex-wrap items-center">
          <select className={juntar(campo, "mb-2 mr-2 w-auto")} value={temaAtual} onChange={(e) => setTema(e.target.value)} aria-label="Tema da trilha" title="Tema da trilha">
            {dados.temas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.rotulo}
              </option>
            ))}
          </select>
          <span className="mb-2 mr-2 inline-flex shrink-0 items-center" role="group" aria-label="Duração">
            {DURACOES.map((d) => (
              <button key={d} type="button" className={juntar(botao.barra, duracao === d && "bg-muted text-foreground")} aria-pressed={duracao === d} onClick={() => setDuracao(d)}>
                {d} s
              </button>
            ))}
            <button
              type="button"
              className={juntar(botao.icone, loop && "bg-muted text-foreground")}
              aria-pressed={loop}
              onClick={() => setLoop((v) => !v)}
              aria-label="Loop para Story e Reels"
              title="Loop para Story e Reels"
            >
              <Repeat className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
          <select className={juntar(campo, "mb-2 mr-2 w-auto")} value={opcoes} onChange={(e) => setOpcoes(Number(e.target.value))} aria-label="Quantas opções" title="Quantas opções">
            <option value={2}>2 opções</option>
            <option value={3}>3 opções</option>
          </select>
          <input
            className={juntar(campo, "mb-2 mr-2 min-w-[160px] flex-1")}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            maxLength={300}
            placeholder="Direção extra (opcional)"
            aria-label="Direção extra da trilha"
          />
          <button type="button" className={juntar(botao.primario, "mb-2")} disabled={semChave || !!gerando} onClick={() => void pedirTrilhas(false)} title={`Cerca de ${usd(custoDaTrilha)}`}>
            {gerando === "trilha" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Gerar trilhas
          </button>
        </div>
        {trilhas.length ? (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Trilhas da campanha">{trilhas.map(linha)}</ul>
        ) : (
          <p className={texto.auxiliar}>{soFavoritas ? "Nenhuma trilha favorita." : "Nenhuma trilha ainda."}</p>
        )}
      </section>

      {/* Efeitos: o pacote do tema (marque os que quer) ou um pedido livre. */}
      <section className="min-w-0 border-t border-border pt-4" aria-label="Efeitos sonoros">
        <h3 className={juntar(texto.rotulo, "mb-2")}>Efeitos sonoros · {efeitos.length}</h3>
        <div className="flex min-w-0 flex-wrap items-center">
          {doPacote.map((e) => {
            const marcado = marcados.indexOf(e.id) >= 0;
            return (
              <button
                key={e.id}
                type="button"
                className={juntar(botao.barra, "mb-2 mr-1 rounded-full border border-border", marcado && "border-primary text-foreground")}
                aria-pressed={marcado}
                onClick={() => setPacote(marcado ? marcados.filter((x) => x !== e.id) : marcados.concat([e.id]))}
              >
                {e.rotulo}
              </button>
            );
          })}
          <button
            type="button"
            className={juntar(botao.secundario, "mb-2 ml-1")}
            disabled={semChave || !!gerando || !marcados.length}
            onClick={() => void pedirEfeitos(false, null)}
          >
            {gerando === "efeitos" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Gerar pacote
          </button>
        </div>
        <form
          className="mb-2 flex min-w-0 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (livre.trim().length >= 3) void pedirEfeitos(false, livre.trim());
          }}
        >
          <input
            className={juntar(campo, "mr-1 flex-1")}
            value={livre}
            onChange={(e) => setLivre(e.target.value)}
            maxLength={300}
            placeholder="Outro som (ex.: porta de loja abrindo)"
            aria-label="Pedir um efeito livre"
          />
          <button type="submit" className={botao.icone} disabled={semChave || !!gerando || livre.trim().length < 3} aria-label="Gerar este efeito" title="Gerar este efeito">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
        {efeitos.length ? (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Efeitos da campanha">{efeitos.map(linha)}</ul>
        ) : (
          <p className={texto.auxiliar}>{soFavoritas ? "Nenhum efeito favorito." : "Nenhum efeito ainda."}</p>
        )}
      </section>
    </div>
  );
}
