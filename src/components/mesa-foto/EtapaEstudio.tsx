import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { campo, foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { AprovarFoto } from "./AcoesDeUso";
import AcoesProDaFoto from "./AcoesProDaFoto";
import { MiniaturaDaFoto, Moldura, SeloDaFoto, useMesaFoto, Vazio } from "./Comuns";
import SeletorDeFotos from "./SeletorDeFotos";
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

const MAX_SUBIDA = 12;

/** A foto original da linhagem (sobe por derivada_de dentro do que está carregado). */
export function raizDaLinhagem(fotos: FotoDoAcervo[], id: string | null): FotoDoAcervo | null {
  if (!id) return null;
  const porId = new Map(fotos.map((f) => [f.id, f]));
  let atual = porId.get(id) || null;
  for (let i = 0; atual && atual.derivada_de && i < MAX_SUBIDA; i++) {
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
    for (let i = 0; atual && i < MAX_SUBIDA; i++) {
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

function Grupo({ titulo, icone, ajuda, destaque, id, children }: { titulo: string; icone: ReactNode; ajuda?: ReactNode; destaque?: boolean; id: string; children: ReactNode }) {
  return (
    <section
      className={juntar("min-w-0 rounded-lg border p-3 transition-colors", destaque ? "border-primary/60 bg-primary/5" : "border-border bg-card")}
      data-grupo-do-estudio={id}
      aria-label={titulo}
    >
      <div className="mb-2 flex min-w-0 items-center">
        <span className="mr-1.5 text-primary">{icone}</span>
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{titulo}</h3>
        {ajuda && <AjudaRecolhida className="ml-1">{ajuda}</AjudaRecolhida>}
      </div>
      {children}
    </section>
  );
}

/** A foto na proporção real, sem corte, com a moldura do recorte do post por cima (linha tracejada, sem véu). */
function FotoNoPalco({ foto, rotulo, formato, mostrarRecorte, velada }: { foto: FotoDoAcervo; rotulo: string; formato: FormatoDoPostDeFotos; mostrarRecorte: boolean; velada?: boolean }) {
  const p = proporcaoDaFoto(foto);
  const r = recorteDoFormato(p, formato);
  const cheio = r.largura >= 0.999 && r.altura >= 0.999;
  return (
    <div className="min-w-0">
      <p className="mb-1 flex min-w-0 items-center text-[11.5px] font-medium text-muted-foreground">
        <span className="mr-1.5 shrink-0">{rotulo}</span>
        <SeloDaFoto foto={foto} compacto />
      </p>
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
            <span className="absolute left-1 top-1 rounded-full border border-primary/40 bg-card px-1.5 py-px text-[10px] font-semibold text-primary">
              vai ao ar: {ROTULO_DO_FORMATO_DE_FOTOS[formato]}
            </span>
          </span>
        )}
      </Moldura>
    </div>
  );
}

export default function EtapaEstudio() {
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
  const [cenario, setCenario] = useEstadoDaTela(`mesa-foto:estudio:cenario:${clientId}`, "");
  const [ajuste, setAjuste] = useEstadoDaTela(`mesa-foto:estudio:ajuste:${clientId}`, "");
  const [formatoBruto, setFormato] = useEstadoDaTela<string>(`mesa-foto:estudio:formato:${clientId}`, "feed_4x5");
  const formato = formatoDoPostDeFotos(formatoBruto);
  const [mostrarRecorte, setMostrarRecorte] = useEstadoDaTela<boolean>(`mesa-foto:estudio:recorte:${clientId}`, true, { validar: (v) => typeof v === "boolean" });
  const padrao = padraoPara(catalogo, "imagem");
  const modeloId = padrao ? padrao.id : "";
  const ferramentas = useRef<HTMLDivElement>(null);

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
    if (fotos.isLoading) return <p className="text-[12.5px] text-muted-foreground">Abrindo o acervo...</p>;
    return (
      <div className="min-w-0 space-y-4" data-estudio-de-fotos="">
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
      </div>
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
          return await prepararFoto({ clientId, imagemId: atual.id, modo, areas: [], cenario: extra.cenario || "", instrucao: extra.instrucao || "" });
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

  return (
    <div className="min-w-0 space-y-4" data-estudio-de-fotos={atual.id}>
      {escolhendo && (
        <SeletorDeFotos fotos={todas.filter((f) => !ehReferenciaWeb(f))} titulo="Trocar a foto do Estúdio" multiplas={false} filtroInicial="todas" onUsar={(ids) => ids[0] && escolher(ids[0])} onFechar={() => setEscolhendo(false)} />
      )}
      <div className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Palco: a foto grande, a comparação e as versões. */}
        <div className="min-w-0 space-y-3" data-palco-do-estudio="">
          <div className="flex min-w-0 flex-wrap items-center">
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
                  <button key={o.v} type="button" aria-pressed={vista === o.v} onClick={() => setVista(o.v)} className={juntar("rounded px-2 py-1 text-[11.5px]", foco, vista === o.v ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
                    {o.r}
                  </button>
                ))}
              </div>
            )}
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 px-2 text-[12px]" onClick={() => setEscolhendo(true)}>
              <Images className="mr-1 h-3.5 w-3.5" /> Trocar foto
            </Button>
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 px-2 text-[12px]" onClick={() => setAmpliada(0)}>
              <Maximize2 className="mr-1 h-3.5 w-3.5" /> Ver grande
            </Button>
          </div>
          {daInternet && (
            <p className="rounded-md border border-warning/40 bg-card px-3 py-2 text-[12px]">Referência da internet: uso interno para o produto sair fiel. Não passa pelas ferramentas e não vai ao ar.</p>
          )}
          <div className={juntar("grid min-w-0 gap-3", temDepois && vista === "lado" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
            {temDepois && raiz && (vista === "lado" || vista === "antes") && (
              <div className={vista === "antes" ? "mx-auto w-full max-w-[720px]" : "min-w-0"}>
                <FotoNoPalco foto={raiz} rotulo="Antes (original)" formato={formato} mostrarRecorte={false} />
              </div>
            )}
            {(!temDepois || vista !== "antes") && (
              <div className={!temDepois || vista === "depois" ? "mx-auto w-full max-w-[720px]" : "min-w-0"}>
                <FotoNoPalco foto={atual} rotulo={temDepois ? "Depois" : "Foto aberta"} formato={formato} mostrarRecorte={mostrarRecorte} velada={!!trabalhando} />
                {trabalhando && (
                  <p role="status" className="mt-1 text-center text-[12px] text-muted-foreground">
                    Preparando a versão nova. O original fica como está.
                  </p>
                )}
              </div>
            )}
          </div>
          {linhagem.length > 1 && (
            <div className="min-w-0 border-t border-border pt-3" data-versoes-da-foto="">
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Versões desta foto ({linhagem.length})</p>
              <div className="flex min-w-0 flex-wrap">
                {linhagem.slice(0, 16).map((f, i) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setAtualId(f.id);
                      if (i > 0) setVista("depois");
                    }}
                    aria-pressed={f.id === atual.id}
                    title={i === 0 ? `Original: ${f.nome}` : f.nome}
                    className={juntar("mb-1.5 mr-1.5 w-16 rounded-md border p-0.5", foco, f.id === atual.id ? "border-primary" : "border-transparent hover:border-border")}
                  >
                    <MiniaturaDaFoto foto={f} />
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{i === 0 ? "original" : `versão ${linhagem.length - i}`}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Ferramentas organizadas ao lado (no celular, embaixo da foto). */}
        <div ref={ferramentas} className="min-w-0 space-y-3" data-ferramentas-do-estudio="">
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

          <Grupo id="melhorar" titulo="Melhorar" icone={<SunMedium className="h-4 w-4" />} destaque={destaque === "melhorar"} ajuda="Luz e cor sem mudar forma, texto nem rosto; limpar tira poeira e reflexo. A nitidez vem do Ampliar fiel (pro), que não redesenha a foto.">
            <div className="flex min-w-0 flex-wrap items-center">
              {preparar("luz_cor", "Luz e cor", <SunMedium className="mr-1.5 h-3.5 w-3.5" />, { instrucao: ajuste }, "default")}
              {preparar("limpar", "Limpar", <Eraser className="mr-1.5 h-3.5 w-3.5" />, { instrucao: ajuste })}
            </div>
            <CampoDeFormulario rotulo="Ajuste fino (opcional)" className="mt-1">
              <input value={ajuste} onChange={(e) => setAjuste(e.target.value)} placeholder="Ex.: tirar o reflexo da janela na tampa" className={campo} aria-label="Ajuste fino" disabled={bloqueado} />
            </CampoDeFormulario>
            {!daInternet && (
              <div className="mt-2 border-t border-border pt-2" data-grupo-do-estudio-pro="">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">Nitidez e tamanho (pro): ampliar fiel ou criativo, tirar fundo</p>
                <AcoesProDaFoto foto={atual} onPronta={(nova) => {
                  setAtualId(nova.id);
                  setVista("lado");
                }} />
              </div>
            )}
          </Grupo>

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
                <button key={f} type="button" role="radio" aria-checked={formato === f} onClick={() => setFormato(f)} className={juntar("rounded px-1.5 py-1 text-[11.5px]", foco, formato === f ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
                  {ROTULO_DO_FORMATO_DE_FOTOS[f]}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center text-[12px] text-muted-foreground">
              <input type="checkbox" checked={mostrarRecorte} onChange={(e) => setMostrarRecorte(e.target.checked)} className="mr-1.5 h-3.5 w-3.5" />
              Mostrar o recorte na foto
            </label>
          </Grupo>

          <p className="text-[11.5px] text-muted-foreground">
            Áreas protegidas e guia de estilo:{" "}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => irPara("preparar", { imagem: atual.id })}>
              ajuste fino no Preparar
            </button>
            .
          </p>
        </div>
      </div>
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
