import { useAlturaQueCabe } from "@/components/sistema/AreaDeTrabalho";
import LogoNaFoto from "@/components/mesa/LogoNaFoto";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Aperture,
  CalendarPlus,
  Crop,
  Eraser,
  Images,
  Layers,
  Maximize2,
  Megaphone,
  PenTool,
  RotateCw,
  Sparkles,
  SunMedium,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Ampliar } from "@/components/mesa/Ampliar";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { padraoPara } from "@/lib/mesa/api";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { campo, foco, juntar, superficie } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { AprovarFoto } from "./AcoesDeUso";
import AcoesProDaFoto from "./AcoesProDaFoto";
import { Moldura, SeloDaFoto, useMesaFoto, Vazio } from "./Comuns";
import SeletorDeFotos from "./SeletorDeFotos";
import GaleriaDeFotos from "./GaleriaDeFotos";
import { fotoNaGaleria } from "./organizacaoDasFotos";
import { useSelecaoParaODiretor } from "./diretorApi";
import { MenuDeUso, precisaAprovar, useLevarParaAsMesas } from "./UsoDaFoto";
import {
  acrescentarFotos,
  classeDaFoto,
  ehReferenciaWeb,
  invalidarFotos,
  partesDoPreparo,
  prepararFoto,
  proporcaoDaFoto,
  useFotos,
  type FotoDoAcervo,
  type ModoDePreparo,
} from "./fotoApi";
import {
  FORMATOS_DO_POST_DE_FOTOS,
  PROPORCAO_DO_FORMATO_DE_FOTOS,
  ROTULO_DO_FORMATO_DE_FOTOS,
  formatoDoPostDeFotos,
  type FormatoDoPostDeFotos,
} from "../../../supabase/functions/_shared/post-de-fotos";

/**
 * Estúdio de fotos (pedido do dono, 27/09: "um estúdio de fotos para
 * melhorar, mudar ângulos... com ferramentas igual o do estúdio de design,
 * só que ali para fotos"). A foto grande no meio, as ferramentas organizadas
 * ao lado, antes e depois com Ver grande. Nada de motor novo: cada ferramenta
 * é uma ação que a Mesa Foto já tem.
 *
 * - Melhorar: luz e cor, limpar (Preparar) e a nitidez pelo Ampliar fiel (pro).
 * - Fundo e cenário: fundo branco, tirar fundo, novo cenário (Preparar) e o
 *   Tirar fundo (pro).
 * - Ângulo e variações: o diretor monta com o custo à vista (variações por
 *   ângulo do produto, variações desta foto).
 * - Formato do post: 4:5, 3:4 ou 1:1, com a moldura do recorte que vai ao ar
 *   desenhada por cima (linha, nunca véu escuro).
 * - Usar: Post na Agenda, Mesa, Mesa Ads, aprovar, baixar e Arquivos.
 *
 * Regras: o original não muda (tudo vira derivada nova no acervo, com o
 * custo antes); nunca escurecer a foto; referência da internet é uso
 * interno e não passa pelas ferramentas.
 */

type Vista = "depois" | "lado" | "antes";

/** A foto original da linhagem (sobe por derivada_de dentro do que está carregado). */
export function raizDaLinhagem(fotos: FotoDoAcervo[], id: string | null): FotoDoAcervo | null {
  if (!id) return null;
  const porId = new Map(fotos.map((f) => [f.id, f]));
  let atual = porId.get(id) || null;
  const visitadas = new Set<string>();
  while (atual?.derivada_de && !visitadas.has(atual.id)) {
    visitadas.add(atual.id);
    const pai = porId.get(atual.derivada_de);
    if (!pai) break;
    atual = pai;
  }
  return atual;
}

/** A raiz e todas as versões que descendem dela (mais novas primeiro, a raiz na frente). */
export function versoesDaLinhagem(fotos: FotoDoAcervo[], raiz: FotoDoAcervo | null): FotoDoAcervo[] {
  if (!raiz) return [];
  const porId = new Map(fotos.map((f) => [f.id, f]));
  const desce = (f: FotoDoAcervo) => {
    let atual: FotoDoAcervo | undefined = f;
    const visitadas = new Set<string>();
    while (atual && !visitadas.has(atual.id)) {
      visitadas.add(atual.id);
      if (atual.id === raiz.id) return true;
      atual = atual.derivada_de ? porId.get(atual.derivada_de) : undefined;
    }
    return false;
  };
  const filhas = fotos.filter((f) => f.id !== raiz.id && f.ativa !== false && desce(f)).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
  return [raiz].concat(filhas);
}

/** Recorte central que vai ao ar no formato (fração da foto), para a moldura na tela. */
export function recorteDoFormato(proporcaoDaFoto: number, formato: FormatoDoPostDeFotos): { x: number; y: number; largura: number; altura: number } {
  const alvo = PROPORCAO_DO_FORMATO_DE_FOTOS[formato];
  const p = proporcaoDaFoto > 0 && isFinite(proporcaoDaFoto) ? proporcaoDaFoto : 1;
  if (Math.abs(p - alvo) < 0.005) return { x: 0, y: 0, largura: 1, altura: 1 };
  if (p > alvo) {
    const largura = alvo / p;
    return { x: (1 - largura) / 2, y: 0, largura, altura: 1 };
  }
  const altura = p / alvo;
  return { x: 0, y: (1 - altura) / 2, largura: 1, altura };
}

/**
 * Tamanho do palco no computador (27/09, dono: "no estúdio de foto, ter scroll,
 * mais organização, está rolando completo"): a página não rola, então a foto
 * precisa caber inteira na altura que sobra. Mede a caixa do palco (resize da
 * janela e, onde existe, ResizeObserver: a lateral do diretor abre e fecha sem
 * resize). No celular devolve null e a foto segue a largura, como antes.
 */
function useTamanhoDoPalco(ref: RefObject<HTMLDivElement>): { largura: number; altura: number } | null {
  const [tamanho, setTamanho] = useState<{ largura: number; altura: number } | null>(null);
  useEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el || typeof window === "undefined" || window.innerWidth < 1024) {
        setTamanho(null);
        return;
      }
      const largura = el.clientWidth;
      const altura = el.clientHeight;
      setTamanho((antes) => (largura > 0 && altura > 0 ? (antes && antes.largura === largura && antes.altura === altura ? antes : { largura, altura }) : null));
    };
    medir();
    const primeira = window.setTimeout(medir, 60);
    window.addEventListener("resize", medir);
    const RO = (window as unknown as { ResizeObserver?: new (cb: () => void) => { observe: (el: Element) => void; disconnect: () => void } }).ResizeObserver;
    const obs = RO && ref.current ? new RO(medir) : null;
    if (obs && ref.current) obs.observe(ref.current);
    return () => {
      window.clearTimeout(primeira);
      window.removeEventListener("resize", medir);
      if (obs) obs.disconnect();
    };
  }, [ref]);
  return tamanho;
}

/** Largura da foto que cabe inteira: pela largura da coluna (dividida quando são duas) e pela altura. */
export function larguraQueCabe(palco: { largura: number; altura: number } | null, proporcao: number, quantas: number): number | null {
  if (!palco) return null;
  const p = proporcao > 0 && isFinite(proporcao) ? proporcao : 1;
  const vao = 12;
  const rotulo = 24;
  const porColuna = (palco.largura - vao * (quantas - 1)) / quantas;
  const pelaAltura = (palco.altura - rotulo) * p;
  return Math.max(48, Math.floor(Math.min(porColuna, pelaAltura)));
}

function Grupo({ titulo, icone, ajuda, destaque, id, children }: { titulo: string; icone: ReactNode; ajuda?: ReactNode; destaque?: boolean; id: string; children: ReactNode }) {
  const { clientId } = useMesa();
  // 28/09: cada grupo de ferramentas recolhe (lembrado por cliente); a ferramenta pedida no endereço abre o grupo dela.
  const [recolhido, setRecolhido] = useRecolhido(`mesa-foto:estudio:grupo-${id}:${clientId}`);
  useEffect(() => {
    if (destaque && recolhido) setRecolhido(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destaque]);
  return (
    <section
      // 28/09 (dono: "sem caixa dentro de caixa"): o grupo é aberto dentro do painel do Estúdio, separado por
      // uma linha fina; o pedido pelo endereço só pinta o fundo de leve.
      className={juntar("min-w-0 border-t border-border pt-3 transition-colors first:border-t-0 first:pt-0", destaque && "rounded-md bg-primary/5 px-2 pb-2")}
      data-grupo-do-estudio={id}
      data-recolhido={recolhido ? "sim" : "nao"}
      aria-label={titulo}
    >
      <div className={juntar("flex min-w-0 items-center", recolhido ? "" : "mb-2")}>
        <h3 className="min-w-0 flex-1">
          <TituloRecolhivel
            titulo={
              <span className="inline-flex min-w-0 items-center">
                <span className="mr-1.5 shrink-0 text-primary">{icone}</span>
                <span className="truncate">{titulo}</span>
              </span>
            }
            recolhido={recolhido}
            onAlternar={() => setRecolhido(!recolhido)}
            className="w-full"
          />
        </h3>
        {ajuda && !recolhido && <AjudaRecolhida className="ml-1">{ajuda}</AjudaRecolhida>}
      </div>
      {!recolhido && children}
    </section>
  );
}

/** A foto na proporção real, sem corte, com a moldura do recorte do post por cima (linha tracejada, sem véu). */
function FotoNoPalco({ foto, rotulo, formato, mostrarRecorte, velada, largura, onAmpliar }: { onAmpliar: () => void; foto: FotoDoAcervo; rotulo: string; formato: FormatoDoPostDeFotos; mostrarRecorte: boolean; velada?: boolean; largura?: number | null }) {
  const p = proporcaoDaFoto(foto);
  const r = recorteDoFormato(p, formato);
  const cheio = r.largura >= 0.999 && r.altura >= 0.999;
  return (
    <div className="mx-auto min-w-0 max-w-full" style={largura ? { width: largura } : undefined}>
      <p className="mb-1 flex min-w-0 items-center text-[12px] font-medium text-muted-foreground">
        <span className="mr-1.5 shrink-0">{rotulo}</span>
        <SeloDaFoto foto={foto} compacto />
      </p>
      <button type="button" className="block w-full cursor-zoom-in rounded focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Ampliar ${rotulo}: ${foto.nome}`} onClick={onAmpliar}>
      <Moldura proporcao={p} className="border border-border">
        <ImagemDaMesa
          caminho={foto.storage_path}
          bucket={foto.storage_bucket || "mesa"}
          alt={foto.nome}
          className={juntar("h-full w-full !object-contain transition-[filter]", velada ? "blur-md" : "")}
        />
        {mostrarRecorte && !cheio && (
          <span
            className="pointer-events-none absolute rounded-sm border-2 border-dashed border-primary"
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.largura * 100}%`, height: `${r.altura * 100}%` }}
            data-recorte-do-post={formato}
          >
            <span className="absolute left-1 top-1 rounded-full border border-primary/40 bg-card px-1.5 py-px text-[11px] font-semibold text-primary">
              vai ao ar: {ROTULO_DO_FORMATO_DE_FOTOS[formato]}
            </span>
          </span>
        )}
      </Moldura>
      </button>
    </div>
  );
}

export default function EtapaEstudio({ escopo }: { escopo?: string } = {}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const { imagemId, irPara, setSelecionadas, pedirAoDiretor, prepararNaAgenda, kitId } = useMesaFoto();
  const [params] = useSearchParams();
  const ferramentaPedida = params.get("ferramenta");
  const fotos = useFotos(clientId);
  const todas = useMemo(() => fotos.data || [], [fotos.data]);
  const levar = useLevarParaAsMesas();
  const [atualId, setAtualId] = useState<string | null>(imagemId);
  const [vista, setVista] = useState<Vista>("depois");
  const [escolhendo, setEscolhendo] = useState(false);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [trabalhando, setTrabalhando] = useState<string | null>(null);
  const [cenario, setCenario] = useEstadoDaTela(escopo ? `${escopo}:cenario` : `mesa-foto:estudio:cenario:${clientId}`, "");
  const [ajuste, setAjuste] = useEstadoDaTela(escopo ? `${escopo}:ajuste` : `mesa-foto:estudio:ajuste:${clientId}`, "");
  const [formatoBruto, setFormato] = useEstadoDaTela<string>(escopo ? `${escopo}:formato` : `mesa-foto:estudio:formato:${clientId}`, "feed_4x5");
  const formato = formatoDoPostDeFotos(formatoBruto);
  const [mostrarRecorte, setMostrarRecorte] = useEstadoDaTela<boolean>(escopo ? `${escopo}:recorte` : `mesa-foto:estudio:recorte:${clientId}`, true, { validar: (v) => typeof v === "boolean" });
  const padrao = padraoPara(catalogo, "imagem");
  const [motorEscolhido, setMotorEscolhido] = useEstadoDaTela<string>(escopo ? `${escopo}:motor` : `mesa-foto:estudio:motor:${clientId}`, "");
  const modeloId = motorEscolhido || (padrao ? padrao.id : "");
  const ferramentas = useRef<HTMLDivElement>(null);
  const areaDoPalco = useRef<HTMLDivElement>(null);
  const palco = useTamanhoDoPalco(areaDoPalco);
  const area = useAlturaQueCabe(!!atualId);

  useEffect(() => {
    if (imagemId) setAtualId(imagemId);
  }, [imagemId]);

  // Ferramenta pedida no endereço (caminho do diretor): o grupo dela aparece em destaque e à vista.
  useEffect(() => {
    if (!ferramentaPedida || !ferramentas.current) return;
    const alvo = ferramentas.current.querySelector(`[data-grupo-do-estudio="${grupoDaFerramenta(ferramentaPedida)}"]`);
    if (alvo && typeof (alvo as HTMLElement).scrollIntoView === "function") (alvo as HTMLElement).scrollIntoView({ block: "nearest" });
  }, [ferramentaPedida, atualId]);

  const atual = atualId ? todas.find((f) => f.id === atualId) || null : null;
  // O diretor trabalha na foto aberta ("melhora a luz desta", "tira o fundo") sem a equipe explicar.
  useSelecaoParaODiretor(clientId, "estudio", atual ? [atual.id] : []);
  const raiz = raizDaLinhagem(todas, atualId);
  const linhagem = versoesDaLinhagem(todas, raiz);
  const temDepois = !!atual && !!raiz && atual.id !== raiz.id;
  const destaque = ferramentaPedida ? grupoDaFerramenta(ferramentaPedida) : null;

  const escolher = (id: string) => {
    setAtualId(id);
    setEscolhendo(false);
    irPara("estudio", { imagem: id });
  };

  if (!atual) {
    if (fotos.isLoading) return <p className="text-[12px] text-muted-foreground">Abrindo o acervo...</p>;
    return (
      <RegiaoRolavel modo="lg" memoria={`mesa-foto:estudio:escolher:${clientId}`} classeDeFora="lg:min-h-0 lg:flex-1" className="min-w-0 space-y-4" data-estudio-de-fotos="">
        {fotos.isSuccess && todas.length === 0 ? (
          <Vazio
            titulo="Nenhuma foto no acervo"
            acao={
              <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => irPara("acervo")}>
                Subir fotos
              </Button>
            }
          >
            O Estúdio de fotos edita uma foto do acervo por vez. O original nunca muda.
          </Vazio>
        ) : (
          <SeletorDeFotos fotos={todas.filter((f) => !ehReferenciaWeb(f))} titulo="Qual foto abrir no Estúdio?" multiplas={false} filtroInicial="todas" onUsar={(ids) => ids[0] && escolher(ids[0])} onFechar={() => irPara("criar")} />
        )}
      </RegiaoRolavel>
    );
  }

  const daInternet = ehReferenciaWeb(atual);
  const bloqueado = daInternet || !!trabalhando;

  /** Preparar (derivada nova no acervo) a partir da versão aberta. */
  const preparar = (modo: ModoDePreparo, rotulo: string, icone: ReactNode, extra: { cenario?: string; instrucao?: string } = {}, variante: "default" | "outline" = "outline") => (
    <BotaoComCusto
      rotulo={
        <>
          {icone}
          {rotulo}
        </>
      }
      titulo={`${rotulo}: versão nova`}
      descricao="Sai uma versão nova no acervo. O original não muda e nada escurece a foto."
      variant={variante}
      className="mb-1.5 mr-1.5 h-8 text-[12px]"
      disabled={bloqueado || !modeloId || (modo === "cenario" && !(extra.cenario || "").trim())}
      partes={() => partesDoPreparo(modeloId, "alta")}
      executar={async () => {
        setTrabalhando(modo);
        try {
          return await prepararFoto({ clientId, imagemId: atual.id, modeloImagemId: modeloId, modo, areas: [], cenario: extra.cenario || "", instrucao: extra.instrucao || "" });
        } finally {
          setTrabalhando(null);
        }
      }}
      aoConcluir={(data) => {
        if (data && data.imagem) {
          acrescentarFotos(queryClient, clientId, [data.imagem]);
          setAtualId(data.imagem.id);
          setVista("lado");
        }
        invalidarFotos(queryClient, clientId);
      }}
    />
  );

  const pedir = (mensagem: string) => {
    if (!pedirAoDiretor) return;
    // A foto aberta vai marcada: o diretor trabalha nela sem a equipe explicar.
    setSelecionadas([atual.id]);
    pedirAoDiretor(mensagem);
  };

  const imagensDoAmpliar = (temDepois && raiz ? [raiz, atual] : [atual]).map((f) => ({
    caminho: f.storage_path,
    bucket: f.storage_bucket || "mesa",
    titulo: raiz && f.id === raiz.id && temDepois ? `Antes: ${f.nome}` : temDepois ? `Depois: ${f.nome}` : f.nome,
    legenda: classeDaFoto(f) === "gerada" ? "Imagem gerada por IA" : f.derivada_de ? "Versão tratada" : "Original",
    proporcao: f.largura && f.altura ? f.largura / f.altura : undefined,
  }));

  // Duas fotos lado a lado dividem a largura; cada uma cabe inteira na altura do palco.
  const ladoALado = temDepois && vista === "lado";
  const larguraAntes = raiz ? larguraQueCabe(palco, proporcaoDaFoto(raiz), ladoALado ? 2 : 1) : null;
  const larguraDepois = larguraQueCabe(palco, proporcaoDaFoto(atual), ladoALado ? 2 : 1);

  return (
    /*
     * 27/09 (dono: "no estúdio de foto, ter scroll, mais organização... deixe mais organizado e
     * alinhado"): no computador a página não rola. Um painel só: à esquerda o palco (a barra da
     * foto em cima, a foto inteira na altura que sobra, as versões numa tira embaixo) e à direita
     * as ferramentas, que rolam por dentro. No celular tudo segue a página, como antes.
     */
    <div ref={area.ref} style={area.altura ? { height: area.altura } : undefined} className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-hidden" data-estudio-de-fotos={atual.id}>
      {escolhendo && (
        <div className="mb-3 min-w-0 lg:max-h-[45%] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain">
          <SeletorDeFotos fotos={todas.filter((f) => !ehReferenciaWeb(f))} titulo="Trocar a foto do Estúdio" multiplas={false} filtroInicial="todas" onUsar={(ids) => ids[0] && escolher(ids[0])} onFechar={() => setEscolhendo(false)} />
        </div>
      )}
      <section
        className={juntar(superficie.painel, "flex min-w-0 flex-col overflow-hidden lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)] desk:grid-cols-[minmax(0,1fr)_360px]")}
        aria-label="Estúdio de fotos"
      >
        {/* Palco: a barra da foto, a foto inteira e as versões. */}
        <div className="flex min-w-0 flex-col lg:min-h-0 lg:border-r lg:border-border" data-palco-do-estudio="">
          <div className="flex min-w-0 shrink-0 flex-wrap items-center border-b border-border px-3 pb-1 pt-2" data-barra-do-palco="">
            <p className="mb-1 mr-2 min-w-0 flex-1 truncate text-[13px] font-semibold" title={atual.nome}>
              {atual.nome}
            </p>
            {temDepois && (
              <div role="group" aria-label="Como comparar" className="mb-1 mr-2 grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5">
                {(
                  [
                    { v: "depois", r: "Depois" },
                    { v: "lado", r: "Lado a lado" },
                    { v: "antes", r: "Antes" },
                  ] as { v: Vista; r: string }[]
                ).map((o) => (
                  <button key={o.v} type="button" aria-pressed={vista === o.v} onClick={() => setVista(o.v)} className={juntar("rounded px-2 py-1 text-[12px]", foco, vista === o.v ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
                    {o.r}
                  </button>
                ))}
              </div>
            )}
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 px-2 text-[12px]" onClick={() => setEscolhendo(true)}>
              <Images className="mr-1 h-3.5 w-3.5" /> Trocar foto
            </Button>
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 px-2 text-[12px]" onClick={() => setAmpliada(vista === "antes" ? 0 : imagensDoAmpliar.length - 1)}>
              <Maximize2 className="mr-1 h-3.5 w-3.5" /> Ver grande
            </Button>
          </div>
          {daInternet && (
            <p className="mx-3 mt-2 shrink-0 rounded-md border border-warning/40 px-3 py-2 text-[12px]">Referência da internet: uso interno, fora das ferramentas e fora do ar.</p>
          )}
          <div ref={areaDoPalco} className="min-w-0 p-3 lg:min-h-0 lg:flex-1 lg:overflow-hidden" data-area-da-foto="">
            <div className={juntar("grid min-w-0 gap-3", ladoALado ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1", "lg:h-full lg:content-center")}>
              {temDepois && raiz && (vista === "lado" || vista === "antes") && (
                <div className={vista === "antes" ? "mx-auto w-full max-w-[720px] lg:max-w-none" : "min-w-0"}>
                  <FotoNoPalco onAmpliar={() => setAmpliada(0)} foto={raiz} rotulo="Antes (original)" formato={formato} mostrarRecorte={false} largura={larguraAntes} />
                </div>
              )}
              {(!temDepois || vista !== "antes") && (
                <div className={!temDepois || vista === "depois" ? "mx-auto w-full max-w-[720px] lg:max-w-none" : "min-w-0"}>
                  <FotoNoPalco onAmpliar={() => setAmpliada(imagensDoAmpliar.length - 1)} foto={atual} rotulo={temDepois ? "Depois" : "Foto aberta"} formato={formato} mostrarRecorte={mostrarRecorte} velada={!!trabalhando} largura={larguraDepois} />
                  {trabalhando && (
                    <p role="status" className="mt-1 text-center text-[12px] text-muted-foreground">
                      Preparando a versão nova. O original fica como está.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="min-h-0 min-w-0 shrink-0 overflow-y-auto border-t border-border px-3 py-2 lg:max-h-44" data-versoes-da-foto="" data-tira-de-versoes="">
            <GaleriaDeFotos titulo="Versões desta foto" fotos={linhagem.map((f) => fotoNaGaleria(f, f.id === raiz?.id ? "Original" : "Versões"))}
              atualId={atual.id} onSelecionar={(id) => { escolher(id); setVista("depois"); }} onUsar={prepararNaAgenda} />
          </div>
        </div>

        {/* Ferramentas ao lado, com rolagem própria no computador (no celular, embaixo da foto). */}
        <RegiaoRolavel modo="lg" sobre="cartao" rotulo="Ferramentas do Estúdio" memoria={`mesa-foto:estudio:ferramentas:${clientId}`} classeDeFora="border-t border-border lg:border-t-0">
          <div ref={ferramentas} className="min-w-0 space-y-3 p-3" data-ferramentas-do-estudio="">
          <Grupo id="usar" titulo="Usar esta foto" icone={<CalendarPlus className="h-4 w-4" />} ajuda="Post na Agenda (foto única ou carrossel, com legenda, data e aprovação do cliente), Mesa, Mesa Ads, baixar ou Arquivos.">
            <div className="flex min-w-0 flex-wrap items-center">
              {prepararNaAgenda && (
                <Button type="button" size="sm" className="mb-1.5 mr-1.5 h-8 text-[12px]" disabled={daInternet} onClick={() => prepararNaAgenda([atual.id])}>
                  <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Preparar na Agenda
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-1.5 mr-1.5 h-8 text-[12px]"
                disabled={daInternet}
                onClick={() => (precisaAprovar(atual) ? toast.info("Aprove primeiro", { description: "Foto gerada vai para as mesas depois da aprovação da equipe." }) : levar("mesa", [atual]))}
              >
                <PenTool className="mr-1.5 h-3.5 w-3.5" /> Mesa
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-1.5 mr-1.5 h-8 text-[12px]"
                disabled={daInternet}
                onClick={() => (precisaAprovar(atual) ? toast.info("Aprove primeiro", { description: "Foto gerada vai para as mesas depois da aprovação da equipe." }) : levar("ads", [atual]))}
              >
                <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Mesa Ads
              </Button>
              {!daInternet && <AprovarFoto foto={atual} />}
              <MenuDeUso foto={atual} rotulo="Mais" variante="ghost" className="mb-1.5" />
            </div>
          </Grupo>

          <div className="px-3 pt-3"><p className="mb-1 text-[12px] font-medium">Gerador das novas versões</p><SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modeloId} onChange={setMotorEscolhido} /></div>
          <Grupo id="melhorar" titulo="Melhorar" icone={<SunMedium className="h-4 w-4" />} destaque={destaque === "melhorar"} ajuda="Luz e cor sem mudar forma, texto nem rosto; limpar tira poeira e reflexo. A nitidez vem do Ampliar fiel (pro), que não redesenha a foto.">
            <div className="flex min-w-0 flex-wrap items-center">
              {preparar("luz_cor", "Luz e cor", <SunMedium className="mr-1.5 h-3.5 w-3.5" />, { instrucao: ajuste })}
              {preparar("limpar", "Limpar", <Eraser className="mr-1.5 h-3.5 w-3.5" />, { instrucao: ajuste })}
            </div>
            <CampoDeFormulario rotulo="Ajuste fino (opcional)" className="mt-1">
              <input value={ajuste} onChange={(e) => setAjuste(e.target.value)} placeholder="Ex.: tirar o reflexo da janela na tampa" className={campo} aria-label="Ajuste fino" disabled={bloqueado} />
            </CampoDeFormulario>
            {!daInternet && (
              <div className="mt-2 border-t border-border pt-2" data-grupo-do-estudio-pro="">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">Upscale · ampliar 2x / 4x e tirar fundo</p>
                <AcoesProDaFoto foto={atual} onPronta={(nova) => {
                  setAtualId(nova.id);
                  setVista("lado");
                }} />
              </div>
            )}
          </Grupo>

          <Grupo id="logo" titulo="Logo da marca" icone={<Images className="h-4 w-4" />} destaque={destaque === "logo"}>{!daInternet && <LogoNaFoto key={atual.id} foto={atual} onPronta={(nova) => { setAtualId(nova.id); setVista("lado"); }} />}</Grupo>
          <Grupo id="fundo" titulo="Fundo e cenário" icone={<Layers className="h-4 w-4" />} destaque={destaque === "fundo" || destaque === "cenario"} ajuda="O assunto fica com os pixels originais; muda só o que está em volta.">
            <div className="flex min-w-0 flex-wrap items-center">
              {preparar("fundo_branco", "Fundo branco", <Wand2 className="mr-1.5 h-3.5 w-3.5" />)}
              {preparar("fundo_transparente", "Tirar fundo", <Crop className="mr-1.5 h-3.5 w-3.5" />)}
            </div>
            <CampoDeFormulario rotulo="Novo cenário" className="mt-1">
              <input value={cenario} onChange={(e) => setCenario(e.target.value)} placeholder="Ex.: bancada de travertino, luz de janela à tarde" className={campo} aria-label="Novo cenário" disabled={bloqueado} />
            </CampoDeFormulario>
            <div className="mt-2 flex min-w-0 flex-wrap items-center">{preparar("cenario", "Trocar cenário", <Sparkles className="mr-1.5 h-3.5 w-3.5" />, { cenario, instrucao: ajuste })}</div>
          </Grupo>

          <Grupo id="angulo" titulo="Ângulo e variações" icone={<RotateCw className="h-4 w-4" />} destaque={destaque === "angulo"} ajuda="O diretor monta com o custo à vista antes de gerar. Ângulo novo gera partes que não aparecem nas fotos: sem garantia de fidelidade, sai marcado como gerado.">
            <div className="flex min-w-0 flex-wrap items-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-1.5 mr-1.5 h-8 text-[12px]"
                disabled={bloqueado || !pedirAoDiretor}
                onClick={() => pedir(`Quero esta foto em outros ângulos (três quartos, lateral, de cima e um detalhe). ${atual.kit_id || kitId ? "Use o produto desta foto." : "Se precisar, identifique o produto antes."} Mostre o custo antes.`)}
              >
                <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Trocar ângulo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-1.5 mr-1.5 h-8 text-[12px]"
                disabled={bloqueado || !pedirAoDiretor}
                onClick={() => pedir("Faça 4 variações desta foto marcada, com cenários e luz diferentes, na pegada da marca. Mostre o custo antes.")}
              >
                <Aperture className="mr-1.5 h-3.5 w-3.5" /> 4 variações desta
              </Button>
            </div>
          </Grupo>

          <Grupo id="formato" titulo="Formato do post" icone={<Crop className="h-4 w-4" />} destaque={destaque === "formato"} ajuda="A moldura na foto mostra o recorte que vai ao ar (o centro da foto). O arquivo original não é cortado.">
            <div role="radiogroup" aria-label="Formato do post" className="grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5">
              {FORMATOS_DO_POST_DE_FOTOS.map((f) => (
                <button key={f} type="button" role="radio" aria-checked={formato === f} onClick={() => setFormato(f)} className={juntar("rounded px-1.5 py-1 text-[12px]", foco, formato === f ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
                  {ROTULO_DO_FORMATO_DE_FOTOS[f]}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center text-[12px] text-muted-foreground">
              <input type="checkbox" checked={mostrarRecorte} onChange={(e) => setMostrarRecorte(e.target.checked)} className="mr-1.5 h-3.5 w-3.5" />
              Mostrar o recorte na foto
            </label>
          </Grupo>

          <p className="text-[12px] text-muted-foreground">
            Áreas protegidas e guia de estilo:{" "}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => irPara("preparar", { imagem: atual.id })}>
              ajuste fino no Preparar
            </button>
            .
          </p>
          </div>
        </RegiaoRolavel>
      </section>
      <Ampliar imagens={imagensDoAmpliar} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

/** Ferramenta pedida no endereço vira o grupo em destaque. */
function grupoDaFerramenta(f: string): string {
  if (f === "fundo" || f === "cenario") return "fundo";
  if (f === "angulo") return "angulo";
  if (f === "formato") return "formato";
  if (f === "ampliar" || f === "melhorar") return "melhorar";
  return "usar";
}
