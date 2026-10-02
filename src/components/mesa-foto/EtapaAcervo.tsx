import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode, type UIEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CheckSquare, ClipboardPaste, Eye, Filter, Link2, Loader2, Maximize2, Megaphone, MoreHorizontal, MousePointerClick, Package, PackagePlus, PackageSearch, PenTool, ScanSearch, Scissors, Search, SlidersHorizontal, Sparkles, Upload, UserRound, UsersRound, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { imagensDoColar } from "@/components/mesa/EstudioFotos";
import { useMesa } from "@/components/mesa/MesaContexto";
import { padraoPara } from "@/lib/mesa/api";
import { AprovarFoto, BotoesDeUso } from "./AcoesDeUso";
import AcoesProDaFoto from "./AcoesProDaFoto";
import { Cartao, FotoInteira, ListaCurta, MiniaturaDaFoto, SeloCurto, SeloDaFoto, useMesaFoto, Vazio } from "./Comuns";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { campo, foco, juntar, superficie } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useReservaFlutuante } from "@/components/sistema/useReservaFlutuante";
import ProdutoDasFotos from "./ProdutoDasFotos";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { importarDoLink, linkDeImagem, moverParaLado, separarComJev } from "./acervoApi";
import { LADOS_DA_FOTO, ladoDaFoto, separarFotos, type LadoDaFoto } from "./tipoDaFoto";
import GuiaDaLinha from "./GuiaDaLinha";
import { MenuDeUso, precisaAprovar, useLevarParaAsMesas } from "./UsoDaFoto";
import { gravarNaSessao } from "./sessao";
import { objetivoPorValor } from "./linhaDeProducao";
import {
  acrescentarFotos,
  classeDaFoto,
  invalidarFotos,
  lerFoto,
  partesDaLeitura,
  partesDoPreparo,
  podeTirarFundo,
  podeVirarClone,
  tirarFundo,
  rotuloDoPapel,
  rotuloDoTipo,
  subirOriginais,
  useFotos,
  useKits,
  type FotoDoAcervo,
  type KitDeFoto,
  type LeituraDaFoto,
} from "./fotoApi";

/**
 * Passo 2 da linha de produção, Fotos (30/09, frente FTL: em cima, a faixa
 * GuiaDaLinha diz o que está fazendo, o que falta e leva ao passo 3): as fotos do cliente num lugar só (o mesmo acervo que a
 * Mesa e a Mesa Ads usam). Subir em lote bem à vista (arrastar e soltar,
 * colar com Ctrl+V ou escolher), o produto identificado ali mesmo
 * (ProdutoDasFotos), grade compacta com um selo simples por foto (original,
 * tratada, gerada, aprovada) e as ações de cada foto num menu (ver grande,
 * preparar, Usar na Mesa, Mesa Ads, baixar, aprovação, Arquivos). O original
 * nunca é alterado: tudo o que muda vira derivada, com a linhagem à vista.
 *
 * 26/09 (pedido do dono): a área das fotos tem rolagem própria de verdade no
 * computador (filtros fixos em cima, grade e painel da foto rolando cada um
 * no seu lugar) e o painel da foto ficou em seções (principal, ferramentas
 * pro de ampliar e tirar fundo, mais ferramentas, sobre a foto).
 *
 * 26/09, sistema de design: a etapa organiza a própria coluna dentro da área
 * de trabalho (a região principal não rola); a grade e o painel usam
 * RegiaoRolavel (rolam por dentro só de 1024 px para cima). Tipo de foto num
 * seletor; busca, filtros, foto aberta e seleção guardados por cliente.
 */

export type FiltroDaClasse = "todas" | "original" | "derivada" | "gerada" | "aprovada";

export const FILTROS_DA_CLASSE: { valor: FiltroDaClasse; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "original", rotulo: "Originais" },
  { valor: "derivada", rotulo: "Tratadas" },
  { valor: "gerada", rotulo: "Geradas" },
  { valor: "aprovada", rotulo: "Aprovadas" },
];

const TODOS_OS_KITS = "todos";
const SEM_KIT = "sem-kit";
const POR_PAGINA = 60;

/** A foto está no kit (pela coluna kit_id ou como referência do kit). */
export function fotoNoKit(f: FotoDoAcervo, kit: KitDeFoto): boolean {
  return f.kit_id === kit.id || kit.refs.some((r) => r.imagem_id === f.id);
}

export function filtrarFotos(fotos: FotoDoAcervo[], classe: FiltroDaClasse, kitFiltro: string, kits: KitDeFoto[], busca: string): FotoDoAcervo[] {
  const termo = busca.trim().toLowerCase();
  const kit = kits.find((k) => k.id === kitFiltro) || null;
  return fotos.filter((f) => {
    if (classe === "aprovada" && !f.aprovada) return false;
    if (classe !== "todas" && classe !== "aprovada" && classeDaFoto(f) !== classe) return false;
    if (kitFiltro === SEM_KIT && kits.some((k) => fotoNoKit(f, k))) return false;
    if (kit && !fotoNoKit(f, kit)) return false;
    if (termo && `${f.nome} ${f.descricao || ""} ${f.tags.join(" ")} ${f.pasta || ""}`.toLowerCase().indexOf(termo) < 0) return false;
    return true;
  });
}

export function ZonaDeEnvio({
  compacta,
  onArquivos,
  andamento,
  destaque = false,
}: {
  compacta: boolean;
  onArquivos: (a: File[]) => void;
  andamento: string | null;
  /** "Subir fotos em lote" (o passo 1). Compacta, o botão é secundário: o primário da área é criar. */
  destaque?: boolean;
}) {
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setArrastando(false);
    const lista = e.dataTransfer && e.dataTransfer.files;
    const arquivos: File[] = [];
    if (lista) for (let i = 0; i < lista.length; i++) arquivos.push(lista[i]);
    onArquivos(arquivos);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!arrastando) setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={soltar}
      aria-label="Soltar fotos aqui"
      data-zona-de-envio=""
      className={`min-w-0 rounded-lg border border-dashed text-center transition-colors ${compacta ? "px-2 py-1" : "px-4 py-8"} ${
        arrastando ? "border-primary bg-primary/5" : "border-border bg-background"
      }`}
    >
      {andamento ? (
        <p role="status" className="inline-flex items-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {andamento}
        </p>
      ) : (
        <div className={compacta ? "flex flex-wrap items-center justify-center" : ""}>
          <p className={`flex min-w-0 items-center justify-center font-medium ${compacta ? "mr-2 text-[12px] text-muted-foreground" : "text-[14px]"}`}>
            <ClipboardPaste className="mr-1.5 h-4 w-4 shrink-0 text-primary" /> <span className="min-w-0 truncate">{compacta ? "Solte ou cole com Ctrl+V" : "Solte as fotos aqui ou cole com Ctrl+V"}</span>
          </p>
          {!compacta && (
            <p className="mt-1 text-[12px] text-muted-foreground">JPG, PNG ou WEBP, até 25 MB cada</p>
          )}
          <Button
            type="button"
            size="sm"
            variant={compacta ? "outline" : "default"}
            className={`${compacta ? "" : "mt-3"} h-8 text-[12px]`}
            onClick={() => entrada.current && entrada.current.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" /> {destaque ? "Subir fotos em lote" : "Escolher fotos"}
          </Button>
        </div>
      )}
      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        aria-label="Escolher fotos para o acervo"
        onChange={(e) => {
          const lista = e.target.files;
          const arquivos: File[] = [];
          if (lista) for (let i = 0; i < lista.length; i++) arquivos.push(lista[i]);
          e.target.value = "";
          onArquivos(arquivos);
        }}
      />
    </div>
  );
}

function LeituraNaTela({ leitura }: { leitura: LeituraDaFoto }) {
  const q = leitura.qualidade;
  return (
    <div className="space-y-2 rounded-md bg-muted/50 p-3" data-leitura-da-foto="">
      {leitura.descricao && <p className="text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{leitura.descricao}</p>}
      <ListaCurta titulo="Observado na foto" itens={leitura.observado} />
      {leitura.texto_lido && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">Texto lido</p>
          <p className="mt-0.5 text-[12px] [overflow-wrap:anywhere]">{leitura.texto_lido}</p>
        </div>
      )}
      {(q.nitidez || q.luz || q.enquadramento) && (
        <p className="text-[11.5px] text-muted-foreground">
          {q.nitidez && <>Nitidez: <span className="text-foreground">{q.nitidez}</span>. </>}
          {q.luz && <>Luz: <span className="text-foreground">{q.luz}</span>. </>}
          {q.enquadramento && <>Enquadramento: <span className="text-foreground">{q.enquadramento}</span>.</>}
        </p>
      )}
      {q.problemas.length > 0 && <ListaCurta titulo="Defeitos: prefira outra fonte se afetarem o assunto" itens={q.problemas} tom="alerta" />}
      {leitura.sugestao && (leitura.sugestao.tipo || leitura.sugestao.papel) && (
        <p className="text-[11.5px] text-muted-foreground">
          Sugestão: {leitura.sugestao.nome ? <span className="text-foreground">{leitura.sugestao.nome}</span> : "kit"}
          {leitura.sugestao.tipo ? ` · ${rotuloDoTipo(leitura.sugestao.tipo)}` : ""}
          {leitura.sugestao.papel ? ` · papel ${rotuloDoPapel(leitura.sugestao.papel).toLowerCase()}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * "Tirar fundo" (pedido do dono, 25/09): um clique na foto. O recorte guarda
 * os pixels originais do assunto (do gerador vem só o contorno, alinhado à
 * foto); a versão sem fundo entra no acervo como derivada, com o selo.
 */
export function BotaoTirarFundo({ foto, onPronta, rotulo = "Tirar fundo" }: { foto: FotoDoAcervo; onPronta?: (id: string) => void; rotulo?: string }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  return (
    <BotaoComCusto
      rotulo={
        <>
          <Scissors className="mr-1.5 h-3.5 w-3.5" /> {rotulo}
        </>
      }
      titulo="Fundo tirado"
      descricao="PNG sem fundo com os pixels originais do assunto (o gerador só marca o contorno). A foto original não muda: sai uma versão nova no acervo."
      variant="outline"
      className="mb-1.5 mr-1.5 h-8 text-[12px]"
      partes={() => {
        const m = padraoPara(catalogo, "imagem");
        return partesDoPreparo(m ? m.id : null, "media");
      }}
      executar={() => tirarFundo(clientId, foto.id)}
      aoConcluir={(data) => {
        if (data && data.imagem) {
          acrescentarFotos(queryClient, clientId, [data.imagem]);
          if (onPronta) onPronta(data.imagem.id);
        }
        invalidarFotos(queryClient, clientId);
        if (data && data.aviso) toast.message("Confira o recorte", { description: data.aviso });
      }}
    />
  );
}

/** Seção do painel da foto aberta: título pequeno e o conteúdo. */
function SecaoDoDetalhe({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-border pt-2.5">
      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">{titulo}</p>
      {children}
    </div>
  );
}

function DetalheDaFoto({
  foto,
  todas,
  leitura,
  onLeitura,
  onAbrir,
  onAmpliar,
  onFechar,
  naJanela = false,
}: {
  foto: FotoDoAcervo;
  todas: FotoDoAcervo[];
  leitura: LeituraDaFoto | null;
  onLeitura: (l: LeituraDaFoto) => void;
  onAbrir: (id: string) => void;
  onAmpliar: () => void;
  onFechar: () => void;
  /** Dentro da janela central: o fechar é da janela. */
  naJanela?: boolean;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErroDoLado = useAvisarErro();
  const { irPara, abrirNoEstudio, prepararNaAgenda } = useMesaFoto();
  const lado = ladoDaFoto(foto);
  const origem = foto.derivada_de ? todas.find((f) => f.id === foto.derivada_de) || null : null;
  const filhas = todas.filter((f) => f.derivada_de === foto.id);
  return (
    <section className="min-w-0 space-y-3 p-3.5" aria-label={`Foto ${foto.nome}`} data-detalhe-da-foto={foto.id}>
      <div className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold" title={foto.nome}>
            {foto.nome}
          </p>
          <div className="mt-1">
            <SeloDaFoto foto={foto} />
          </div>
        </div>
        {!naJanela && (
          <button type="button" onClick={onFechar} aria-label="Fechar o detalhe" className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <button type="button" onClick={onAmpliar} className="block w-full cursor-zoom-in" aria-label="Ver a foto grande">
        <FotoInteira foto={foto} />
      </button>
      {classeDaFoto(foto) === "gerada" && (
        <p className="rounded-md bg-primary/5 px-2.5 py-1.5 text-[11.5px] leading-snug text-foreground">
          Imagem gerada por IA. Partes que não aparecem nas fotos originais podem ter sido criadas.
        </p>
      )}
      {/* Principal: editar no Estúdio, post na Agenda, aprovar, usar (Mesa, Mesa Ads, baixar, aprovação) e ver grande. */}
      <div className="flex min-w-0 flex-wrap items-center" data-acoes-principais="">
        {abrirNoEstudio && !foto.referencia_web && (
          <Button type="button" size="sm" className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={() => abrirNoEstudio(foto.id)} title="A foto grande e as ferramentas ao lado: luz, cor, fundo, cenário, ângulo, ampliar">
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Abrir no Estúdio
          </Button>
        )}
        {prepararNaAgenda && !foto.referencia_web && (
          <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={() => prepararNaAgenda([foto.id])} title="Post na Agenda com esta foto: legenda, data e aprovação do cliente">
            <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Agenda
          </Button>
        )}
        <AprovarFoto foto={foto} />
        <MenuDeUso foto={foto} rotulo="Usar" variante="outline" className="mb-1.5 mr-1.5" />
        <Button type="button" size="sm" variant="ghost" className="mb-1.5 h-8 text-[12px]" onClick={onAmpliar}>
          <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Ver grande
        </Button>
      </div>
      <SecaoDoDetalhe titulo="Ampliar e tirar fundo (pro)">
        <AcoesProDaFoto foto={foto} onPronta={(nova) => onAbrir(nova.id)} />
      </SecaoDoDetalhe>
      <SecaoDoDetalhe titulo="Mais ferramentas">
        <div className="flex min-w-0 flex-wrap items-center">
          <BotaoComCusto
            rotulo={
              <>
                <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
                {leitura ? "Ler de novo" : "Ler foto"}
              </>
            }
            titulo="Foto lida"
            descricao="O modelo de leitura descreve o que aparece, lê o texto, avalia nitidez, luz e enquadramento e sugere o produto e o papel da foto."
            variant="outline"
            className="mb-1.5 mr-1.5 h-8 text-[12px]"
            partes={() => partesDaLeitura(catalogo)}
            executar={() => lerFoto(clientId, foto.id)}
            aoConcluir={(data) => {
              onLeitura(data as LeituraDaFoto);
              invalidarFotos(queryClient, clientId);
            }}
          />
          {!foto.referencia_web && (
            <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={() => irPara("preparar", { imagem: foto.id })}>
              <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Preparar
            </Button>
          )}
          {podeVirarClone(foto) && (
            <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={() => irPara("clones", { imagem: foto.id })} title="Mesmo rosto em outras roupas, cenários e poses (pessoa real, com autorização)">
              <UsersRound className="mr-1.5 h-3.5 w-3.5" /> Variações desta pessoa
            </Button>
          )}
          {!foto.referencia_web && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mb-1.5 mr-1.5 h-8 text-[12px]"
              data-mover-de-lado={lado === "produto" ? "modelo" : "produto"}
              onClick={() => {
                moverParaLado(queryClient, clientId, [foto.id], lado === "produto" ? "modelo" : "produto").catch((e) => avisarErroDoLado(e, "Foto não movida"));
              }}
            >
              {lado === "produto" ? <UserRound className="mr-1.5 h-3.5 w-3.5" /> : <Package className="mr-1.5 h-3.5 w-3.5" />}
              {lado === "produto" ? "É foto de modelo" : "É foto de produto"}
            </Button>
          )}
          {/* Alternativa ao "Tirar fundo (pro)": o recorte pelo gerador da casa (preparar, fundo transparente). */}
          {podeTirarFundo(foto) && <BotaoTirarFundo foto={foto} onPronta={onAbrir} rotulo="Tirar fundo (alternativa)" />}
        </div>
      </SecaoDoDetalhe>
      <SecaoDoDetalhe titulo="Sobre a foto">
        <div className="space-y-1.5 text-[12px]">
          {foto.largura && foto.altura ? (
            <p className="text-muted-foreground tabular-nums">
              {foto.largura} x {foto.altura} px
            </p>
          ) : null}
          {origem && (
            <p className="min-w-0 truncate">
              <span className="text-muted-foreground">Veio de </span>
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => onAbrir(origem.id)}>
                {origem.nome}
              </button>
            </p>
          )}
          {filhas.length > 0 && (
            <p className="text-muted-foreground">
              {filhas.length} {filhas.length === 1 ? "versão feita" : "versões feitas"} a partir desta:{" "}
              {filhas.slice(0, 4).map((f, i) => (
                <button key={f.id} type="button" className="mr-1 font-medium text-primary hover:underline" onClick={() => onAbrir(f.id)}>
                  {f.nome}
                  {i < Math.min(filhas.length, 4) - 1 ? "," : ""}
                </button>
              ))}
            </p>
          )}
          {!leitura && foto.descricao && <p className="leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{foto.descricao}</p>}
          {leitura && <LeituraNaTela leitura={leitura} />}
        </div>
      </SecaoDoDetalhe>
    </section>
  );
}

/** Sem foto aberta: o que dá para fazer, em itens curtos (antes era um parágrafo só). */
function GuiaDaArea() {
  const itens: { icone: ReactNode; texto: string }[] = [
    { icone: <MousePointerClick className="h-3.5 w-3.5" />, texto: "Toque numa foto: ela abre aqui, com a linhagem e as ferramentas." },
    { icone: <Maximize2 className="h-3.5 w-3.5" />, texto: "A lupa no canto mostra a foto grande." },
    { icone: <CheckSquare className="h-3.5 w-3.5" />, texto: "A caixinha marca várias para identificar o produto, baixar ou levar juntas." },
    { icone: <MoreHorizontal className="h-3.5 w-3.5" />, texto: "O menu leva para a Mesa, a Mesa Ads, baixar ou mandar ao cliente." },
  ];
  return (
    <div className="p-4" data-guia-das-fotos="">
      <p className="flex items-center text-[12.5px] font-medium">
        <Eye className="mr-1.5 h-4 w-4 text-primary" /> Nenhuma foto aberta
      </p>
      <ul className="mt-2.5 space-y-2">
        {itens.map((i) => (
          <li key={i.texto} className="flex min-w-0 items-start text-[12px] leading-snug text-muted-foreground">
            <span className="mr-2 mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">{i.icone}</span>
            <span className="min-w-0">{i.texto}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CartaoDaFoto({
  foto,
  marcada,
  aberta,
  onMarcar,
  onAbrir,
  onAmpliar,
}: {
  foto: FotoDoAcervo;
  marcada: boolean;
  aberta: boolean;
  onMarcar: () => void;
  onAbrir: () => void;
  onAmpliar: () => void;
}) {
  const { irPara } = useMesaFoto();
  return (
    <div
      className={`relative min-w-0 rounded-lg p-1 transition-colors ${
        aberta ? "bg-primary/[0.07] ring-1 ring-primary" : marcada ? "ring-1 ring-primary/60" : "hover:bg-muted/40"
      }`}
      data-foto={foto.id}
    >
      <div className="relative min-w-0">
        <button type="button" onClick={onAbrir} className="block w-full min-w-0 text-left" title={foto.descricao || foto.nome} aria-label={`Abrir ${foto.nome}`}>
          <MiniaturaDaFoto foto={foto} />
        </button>
        {/* Lupa: ver grande direto da grade (pílula clara, sem véu escuro na foto). */}
        <button
          type="button"
          onClick={onAmpliar}
          aria-label={`Ver grande ${foto.nome}`}
          className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>
      <p className="mt-1 truncate px-0.5 text-[11px] font-medium" title={foto.nome}>
        {foto.nome}
      </p>
      <div className="flex min-w-0 items-center justify-between px-0.5">
        <SeloCurto foto={foto} />
        <MenuDeUso
          foto={foto}
          icone
          className="mb-1"
          extras={[
            { rotulo: "Ver grande", acao: onAmpliar },
            { rotulo: "Detalhes e leitura", acao: onAbrir },
            // Abre o detalhe, onde o "Tirar fundo (pro)" mostra o custo antes.
            ...(podeTirarFundo(foto) ? [{ rotulo: "Tirar fundo", acao: onAbrir }] : []),
            ...(podeVirarClone(foto) ? [{ rotulo: "Variações desta pessoa (clone)", acao: () => irPara("clones", { imagem: foto.id }) }] : []),
            ...(foto.referencia_web ? [] : [{ rotulo: "Preparar (fundo, luz, cenário)", acao: () => irPara("preparar", { imagem: foto.id }) }]),
          ]}
        />
      </div>
      <label className="absolute right-1.5 top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border border-border bg-card shadow-sm">
        <input type="checkbox" checked={marcada} onChange={onMarcar} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label={`Selecionar ${foto.nome}`} />
      </label>
    </div>
  );
}

const CLASSES_VALIDAS = FILTROS_DA_CLASSE.map((f) => f.valor as string);
const LADOS_VALIDOS = LADOS_DA_FOTO.map((l) => l.valor as string);

/**
 * Subir, colar e trazer de um link, numa linha só (02/10, dono: "subir,
 * colar e colar link têm que ser claros"). Colar: Ctrl+V em qualquer lugar
 * da etapa ou o botão (lê a área de transferência quando o navegador deixa).
 */
function EntradaDeFotos({ lado, onArquivos, andamento, onLink }: { lado: LadoDaFoto; onArquivos: (a: File[]) => void; andamento: string | null; onLink: (url: string) => Promise<void> }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [comLink, setComLink] = useState(false);
  const [link, setLink] = useState("");
  const [trazendo, setTrazendo] = useState(false);
  const valido = linkDeImagem(link);
  const colar = async () => {
    const nav = navigator as Navigator & { clipboard?: { read?: () => Promise<{ types: string[]; getType: (t: string) => Promise<Blob> }[]> } };
    if (!nav.clipboard || typeof nav.clipboard.read !== "function") {
      toast.message("Use Ctrl+V", { description: "Copie a foto e aperte Ctrl+V aqui na tela." });
      return;
    }
    try {
      const itens = await nav.clipboard.read();
      const arquivos: File[] = [];
      for (const it of itens) {
        const tipo = it.types.find((t) => t.indexOf("image/") === 0);
        if (tipo) {
          const blob = await it.getType(tipo);
          arquivos.push(new File([blob], `colada-${Date.now()}.${tipo.split("/")[1] || "png"}`, { type: tipo }));
        }
      }
      if (arquivos.length) onArquivos(arquivos);
      else toast.message("Nenhuma foto copiada", { description: "Copie a foto (não o link) e tente de novo, ou cole o link." });
    } catch {
      toast.message("Use Ctrl+V", { description: "O navegador não deixou ler a área de transferência." });
    }
  };
  const trazer = async () => {
    if (!valido || trazendo) return;
    setTrazendo(true);
    try {
      await onLink(valido);
      setLink("");
      setComLink(false);
    } finally {
      setTrazendo(false);
    }
  };
  return (
    <div className="min-w-0" data-entrada-de-fotos={lado}>
      <div className="flex min-w-0 flex-wrap items-center">
        <Button type="button" size="sm" className="mb-1 mr-1.5 h-8 text-[12px]" disabled={!!andamento} onClick={() => entrada.current && entrada.current.click()}>
          <Upload className="mr-1.5 h-3.5 w-3.5" /> Subir fotos em lote
        </Button>
        <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8 text-[12px]" disabled={!!andamento} onClick={() => void colar()} title="Ou aperte Ctrl+V em qualquer lugar da tela">
          <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" /> Colar
        </Button>
        <Button type="button" size="sm" variant={comLink ? "default" : "outline"} className="mb-1 mr-1.5 h-8 text-[12px]" aria-expanded={comLink} onClick={() => setComLink(!comLink)}>
          <Link2 className="mr-1.5 h-3.5 w-3.5" /> Link
        </Button>
        <AjudaRecolhida className="mb-1" rotulo="Como subir fotos">
          {`Entram como fotos de ${lado === "modelo" ? "modelo" : "produto"} (a aba aberta). JPG, PNG ou WEBP, até 25 MB cada; o original fica guardado como veio. Para produto, 4 a 8 fotos: frente, três quartos, laterais, verso, detalhes e a embalagem. Para pessoa, 6 a 12 fotos recentes e autorizadas.`}
        </AjudaRecolhida>
        {andamento && (
          <span role="status" className="mb-1 ml-1 inline-flex items-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {andamento}
          </span>
        )}
      </div>
      {comLink && (
        <form
          className="mt-1 flex min-w-0 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            void trazer();
          }}
          data-link-da-foto=""
        >
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https:// link da imagem" aria-label="Link da imagem" className={juntar(campo, "h-8 text-[12.5px]")} autoFocus />
          <Button type="submit" size="sm" className="ml-1.5 h-8 shrink-0 text-[12px]" disabled={!valido || trazendo}>
            {trazendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} Trazer
          </Button>
        </form>
      )}
      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        aria-label="Escolher fotos para o acervo"
        onChange={(e) => {
          const lista = e.target.files;
          const arquivos: File[] = [];
          if (lista) for (let i = 0; i < lista.length; i++) arquivos.push(lista[i]);
          e.target.value = "";
          onArquivos(arquivos);
        }}
      />
    </div>
  );
}

/**
 * Passo 2, Fotos (02/10, dono: "Suas fotos não mostra nada, a área do
 * produto é minúscula e fica menor depois de subir; só fotos, produto e
 * modelo separados"):
 * - só fotos (tipoDaFoto.ts): artes, carrosséis, posts e logos ficam na Mesa;
 * - duas abas, Produto e Modelo, cada uma com a contagem;
 * - a grade é a área grande, com rolagem própria e carga contínua (60 por vez);
 * - o produto mora numa coluna própria, do mesmo tamanho sempre;
 * - a foto aberta abre numa janela central (não come a largura da grade).
 */
export default function EtapaAcervo() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { selecionadas, setSelecionadas, imagemId, irPara, abrirNoEstudio, prepararNaAgenda, objetivo } = useMesaFoto();
  const objetivoAberto = objetivoPorValor(objetivo || null);
  const levar = useLevarParaAsMesas();
  const fotos = useFotos(clientId);
  const kits = useKits(clientId);
  const [lado, setLado] = useEstadoDaTela<LadoDaFoto>(`mesa-foto:acervo:lado:${clientId}`, "produto", { validar: (v) => LADOS_VALIDOS.indexOf(String(v)) >= 0 });
  const [classe, setClasse] = useEstadoDaTela<FiltroDaClasse>(`mesa-foto:acervo:classe:${clientId}`, "todas", { validar: (v) => CLASSES_VALIDAS.indexOf(String(v)) >= 0 });
  const [kitFiltro, setKitFiltro] = useEstadoDaTela(`mesa-foto:acervo:produto:${clientId}`, TODOS_OS_KITS, { validar: (v) => typeof v === "string" && !!v });
  const [busca, setBusca] = useEstadoDaTela(`mesa-foto:acervo:busca:${clientId}`, "");
  const [aberta, setAberta] = useState<string | null>(imagemId);
  const [limite, setLimite] = useState(POR_PAGINA);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [separando, setSeparando] = useState(false);
  // Soltar fotos em cima da grade também sobe (na aba aberta).
  const [arrastando, setArrastando] = useState(false);
  const [leituras, setLeituras] = useState<Record<string, LeituraDaFoto>>({});
  const fimDaGrade = useRef<HTMLDivElement | null>(null);

  // Foto pedida pelo endereço (?imagem=) abre por cima.
  useEffect(() => {
    if (imagemId) setAberta(imagemId);
  }, [imagemId]);

  const brutas = useMemo(() => fotos.data || [], [fotos.data]);
  const listaDeKits = useMemo(() => kits.data || [], [kits.data]);
  // Só fotos, separadas em produto e modelo (artes, carrosséis e logos ficam fora).
  const separadas = useMemo(() => separarFotos(brutas, listaDeKits), [brutas, listaDeKits]);
  const todas = useMemo(() => separadas.produto.concat(separadas.modelo), [separadas]);
  const doLado = lado === "modelo" ? separadas.modelo : separadas.produto;
  const kitValido = kitFiltro === TODOS_OS_KITS || kitFiltro === SEM_KIT || !kits.isSuccess || listaDeKits.some((k) => k.id === kitFiltro) ? kitFiltro : TODOS_OS_KITS;
  const filtradas = useMemo(() => filtrarFotos(doLado, classe, kitValido, listaDeKits, busca), [doLado, classe, kitValido, listaDeKits, busca]);
  const visiveis = filtradas.slice(0, limite);
  const fotoAberta = aberta ? brutas.find((f) => f.id === aberta) || null : null;
  const escolhidas = useMemo(() => todas.filter((f) => selecionadas.indexOf(f.id) >= 0), [todas, selecionadas]);
  useReservaFlutuante(escolhidas.length > 0, 120);
  const contagem = useMemo(() => {
    const c = { original: 0, derivada: 0, gerada: 0, aprovada: 0 };
    for (const f of doLado) {
      c[classeDaFoto(f)]++;
      if (f.aprovada) c.aprovada++;
    }
    return c;
  }, [doLado]);

  // Trocar de aba ou de filtro volta para a primeira página.
  useEffect(() => setLimite(POR_PAGINA), [lado, classe, kitValido, busca]);

  // Carga contínua: o fim da grade apareceu (rolando a grade ou a página), carrega mais 60.
  const temMais = filtradas.length > limite;
  useEffect(() => {
    const alvo = fimDaGrade.current;
    if (!alvo || !temMais || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) setLimite((l) => l + POR_PAGINA);
    }, { rootMargin: "320px" });
    obs.observe(alvo);
    return () => obs.disconnect();
  }, [temMais, limite]);

  const enviar = async (arquivos: File[]) => {
    if (!arquivos.length || andamento) return;
    setAndamento(`Preparando ${arquivos.length} ${arquivos.length === 1 ? "foto" : "fotos"}`);
    try {
      const r = await subirOriginais(clientId, arquivos, (feitos, total) => {
        setAndamento(feitos < total ? `Subindo ${feitos} de ${total}` : "Registrando no acervo e conferindo duplicadas");
      });
      acrescentarFotos(queryClient, clientId, r.registradas);
      // A aba aberta diz o lado das fotos novas (produto ou modelo).
      if (r.registradas.length) await moverParaLado(queryClient, clientId, r.registradas.map((f) => f.id), lado).catch(() => undefined);
      invalidarFotos(queryClient, clientId);
      const n = r.registradas.length;
      if (n || r.duplicadas) {
        toast.success(n ? `${n} ${n === 1 ? "foto nova" : "fotos novas"} em ${lado === "modelo" ? "Modelo" : "Produto"}` : "Nenhuma foto nova", {
          description: r.duplicadas ? `${r.duplicadas} ${r.duplicadas === 1 ? "já estava" : "já estavam"} no acervo e não foi duplicada.` : undefined,
        });
      }
      if (r.recusadas.length) {
        toast.error(`${r.recusadas.length} ${r.recusadas.length === 1 ? "foto não entrou" : "fotos não entraram"}`, {
          description: r.recusadas
            .slice(0, 4)
            .map((x) => `${x.nome}: ${x.motivo}`)
            .join(". "),
          duration: 9000,
        });
      }
    } catch (e) {
      invalidarFotos(queryClient, clientId);
      avisarErro(e, "Fotos não registradas");
    } finally {
      setAndamento(null);
    }
  };

  const trazerDoLink = async (url: string) => {
    try {
      const r = await importarDoLink(clientId, url, lado);
      if (r.imagem) acrescentarFotos(queryClient, clientId, [r.imagem]);
      invalidarFotos(queryClient, clientId);
      toast.success(r.jaExistia ? "Esta foto já estava no acervo" : `Foto trazida para ${lado === "modelo" ? "Modelo" : "Produto"}`);
    } catch (e) {
      avisarErro(e, "Foto do link não entrou");
    }
  };

  const separarComIA = async () => {
    if (separando || !separadas.aSeparar.length) return;
    setSeparando(true);
    try {
      const r = await separarComJev(queryClient, clientId, separadas.aSeparar.slice(0, 20).map((f) => f.id));
      const mudaram = r.separadas.filter((x) => !!x.categoria).length;
      toast.success(mudaram ? `${mudaram} ${mudaram === 1 ? "foto separada" : "fotos separadas"}` : "Nada a mudar", {
        description: mudaram ? "As artes saíram das fotos; modelo e produto foram para a aba certa." : "O Jev ficou em dúvida: mova pelo menu da foto, se precisar.",
      });
    } catch (e) {
      avisarErro(e, "Separação não feita");
    } finally {
      setSeparando(false);
    }
  };

  // Ctrl+V na etapa: só quando há arquivo de imagem; texto que é link de imagem vira "trazer do link".
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;
  const linkRef = useRef(trazerDoLink);
  linkRef.current = trazerDoLink;
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA")) return;
      const imagens = imagensDoColar(e.clipboardData);
      if (imagens.length) {
        e.preventDefault();
        void enviarRef.current(imagens);
        return;
      }
      const texto = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
      const url = linkDeImagem(texto);
      if (url) {
        e.preventDefault();
        void linkRef.current(url);
      }
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, []);

  const usarNasMesas = (destino: "mesa" | "ads") => {
    const semAprovacao = escolhidas.filter((f) => precisaAprovar(f));
    const prontas = escolhidas.filter((f) => semAprovacao.indexOf(f) < 0);
    if (semAprovacao.length) {
      toast.warning(`${semAprovacao.length} ${semAprovacao.length === 1 ? "foto gerada ficou" : "fotos geradas ficaram"} de fora`, {
        description: "Foto gerada vai para as mesas depois da aprovação da equipe. Abra a foto e aprove.",
        duration: 9000,
      });
    }
    if (prontas.length) levar(destino, prontas);
  };
  const montarKit = () => {
    gravarNaSessao(clientId, "kit-com-fotos", escolhidas.map((f) => f.id));
    irPara("kits", { kit: null });
  };

  const marcar = (id: string) => setSelecionadas(selecionadas.indexOf(id) >= 0 ? selecionadas.filter((x) => x !== id) : selecionadas.concat([id]));
  const todasVisiveisMarcadas = visiveis.length > 0 && visiveis.every((f) => selecionadas.indexOf(f.id) >= 0);
  const marcarVisiveis = () => {
    if (todasVisiveisMarcadas) setSelecionadas(selecionadas.filter((id) => !visiveis.some((f) => f.id === id)));
    else {
      const novas = selecionadas.slice();
      visiveis.forEach((f) => {
        if (novas.indexOf(f.id) < 0) novas.push(f.id);
      });
      setSelecionadas(novas);
    }
  };

  const vazio = fotos.isSuccess && todas.length === 0;
  const entradaDeFotos = <EntradaDeFotos lado={lado} onArquivos={(a) => void enviar(a)} andamento={andamento} onLink={trazerDoLink} />;

  return (
    /*
     * Coluna de altura fixa no computador: em cima a faixa do passo; embaixo a área das fotos
     * (grande, com a grade rolando por dentro) e, ao lado, a coluna do produto (rolagem própria).
     * No celular tudo segue a rolagem da página.
     */
    <div className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1" data-etapa-fotos="">
      <div className="shrink-0" data-topo-das-fotos="">
        <GuiaDaLinha />
      </div>

      {fotos.isLoading && <Carregando forma="grade" linhas={8} rotulo="Lendo o acervo" />}
      {fotos.isError && <AvisoDeErro erro={fotos.error} />}

      {vazio && (
        <section className="min-w-0" aria-label="Subir as primeiras fotos" data-acervo-vazio="">
          <ZonaDeEnvio compacta={false} destaque onArquivos={(a) => void enviar(a)} andamento={andamento} />
          <div className="mt-3">{entradaDeFotos}</div>
          {separadas.fora > 0 && <p className="mt-2 text-[12px] text-muted-foreground">{separadas.fora} {separadas.fora === 1 ? "arte ficou" : "artes ficaram"} na Mesa (não são fotos).</p>}
        </section>
      )}

      {fotos.isSuccess && !vazio && (
        <div className="grid min-w-0 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)] desk:grid-cols-[minmax(0,1fr)_340px]" data-fotos-e-produto="">
          <section
            className={juntar(superficie.painel, "flex min-w-0 flex-col overflow-hidden lg:min-h-0", arrastando && "border-primary ring-1 ring-primary")}
            aria-label="Suas fotos"
            data-area-das-fotos=""
            data-zona-de-envio=""
            onDragOver={(e) => {
              if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") < 0) return;
              e.preventDefault();
              if (!arrastando) setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => {
              const lista = e.dataTransfer && e.dataTransfer.files;
              if (!lista || !lista.length) return;
              e.preventDefault();
              setArrastando(false);
              const arquivos: File[] = [];
              for (let i = 0; i < lista.length; i++) arquivos.push(lista[i]);
              void enviar(arquivos);
            }}
          >
            <div className="shrink-0 border-b border-border px-3 pb-2 pt-2.5" data-barra-das-fotos="">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-y-1">
                {/* Produto e Modelo, cada um com a contagem: só fotos, nunca artes. */}
                <div role="tablist" aria-label="Lado das fotos" className="mr-2 flex min-w-0 rounded-lg bg-muted p-0.5" data-lados-das-fotos="">
                  {LADOS_DA_FOTO.map((l) => {
                    const ativo = lado === l.valor;
                    const n = l.valor === "modelo" ? separadas.modelo.length : separadas.produto.length;
                    return (
                      <button
                        key={l.valor}
                        type="button"
                        role="tab"
                        aria-selected={ativo}
                        title={l.dica}
                        onClick={() => setLado(l.valor)}
                        className={juntar("inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium", ativo ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground", foco)}
                        data-lado={l.valor}
                      >
                        {l.valor === "modelo" ? <UserRound className="mr-1.5 h-3.5 w-3.5" /> : <Package className="mr-1.5 h-3.5 w-3.5" />}
                        {l.rotulo}
                        <span className="ml-1.5 tabular-nums text-muted-foreground">{n}</span>
                      </button>
                    );
                  })}
                </div>
                {entradaDeFotos}
              </div>
              <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-center">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, descrição ou tag" className={juntar(campo, "pl-8")} aria-label="Buscar no acervo" />
                </div>
                <Select value={kitValido} onValueChange={setKitFiltro}>
                  <SelectTrigger className="h-9 min-w-0 text-[12.5px]" aria-label="Filtrar por produto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS_OS_KITS}>Todos os produtos</SelectItem>
                    <SelectItem value={SEM_KIT}>Sem produto</SelectItem>
                    {listaDeKits.map((k) => (
                      <SelectItem key={String(k.id)} value={String(k.id)}>
                        {k.nome || "Produto sem nome"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <SeletorCompacto
                  modo="lista"
                  rotulo="Tipo de foto"
                  icone={<Filter className="h-4 w-4" />}
                  opcoes={FILTROS_DA_CLASSE.map((f) => ({ valor: f.valor, rotulo: f.rotulo, contador: f.valor === "todas" ? doLado.length : contagem[f.valor] }))}
                  valor={classe}
                  onEscolher={(v) => setClasse(v as FiltroDaClasse)}
                />
              </div>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
                <span className="mr-3 tabular-nums" data-contagem-das-fotos="">
                  {filtradas.length} {filtradas.length === 1 ? "foto" : "fotos"}
                  {escolhidas.length ? ` · ${escolhidas.length} ${escolhidas.length === 1 ? "marcada" : "marcadas"}` : ""}
                </span>
                {visiveis.length > 0 && (
                  <button type="button" className={juntar("mr-3 rounded font-medium text-primary hover:underline", foco)} onClick={marcarVisiveis}>
                    {todasVisiveisMarcadas ? "Desmarcar as visíveis" : "Selecionar as visíveis"}
                  </button>
                )}
                {separadas.aSeparar.length > 0 && (
                  <button type="button" className={juntar("mr-3 inline-flex items-center rounded font-medium text-primary hover:underline disabled:opacity-60", foco)} onClick={() => void separarComIA()} disabled={separando} data-separar-com-ia={separadas.aSeparar.length} title="O Jev olha nome, pasta e leitura das fotos sem sinal e separa produto, modelo e arte">
                    {separando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                    Separar com IA ({Math.min(20, separadas.aSeparar.length)})
                  </button>
                )}
                {separadas.fora > 0 && (
                  <span className="mr-1" data-artes-fora={separadas.fora} title="Artes, carrosséis, posts e logos ficam na Mesa (Estúdio)">
                    {separadas.fora} {separadas.fora === 1 ? "arte fora" : "artes fora"}
                  </span>
                )}
              </div>
            </div>
            <RegiaoRolavel modo="lg" sobre="cartao" memoria={`mesa-foto:acervo:grade:${clientId}:${lado}`} className="p-2" data-rolagem-das-fotos="">
              {filtradas.length === 0 ? (
                <EstadoVazio compacto titulo={doLado.length ? "Nenhuma foto com esse filtro." : lado === "modelo" ? "Nenhuma foto de modelo ainda." : "Nenhuma foto de produto ainda."} />
              ) : (
                <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 desk:grid-cols-6" data-grade-das-fotos="">
                  {visiveis.map((f) => (
                    <CartaoDaFoto
                      key={f.id}
                      foto={f}
                      marcada={selecionadas.indexOf(f.id) >= 0}
                      aberta={aberta === f.id}
                      onMarcar={() => marcar(f.id)}
                      onAbrir={() => setAberta(f.id)}
                      onAmpliar={() => setAmpliada(Math.max(0, filtradas.indexOf(f)))}
                    />
                  ))}
                </div>
              )}
              {temMais && (
                <div ref={fimDaGrade} className="mt-2" data-carregar-mais="">
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-full text-[12px]" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                    Ver mais {Math.min(POR_PAGINA, filtradas.length - limite)} de {filtradas.length - limite}
                  </Button>
                </div>
              )}
            </RegiaoRolavel>
            {escolhidas.length > 0 && (
              <div
                className="pointer-events-none fixed inset-x-0 bottom-[132px] z-30 flex justify-center px-3 md:bottom-[84px] lg:pointer-events-auto lg:static lg:z-auto lg:block lg:shrink-0 lg:border-t lg:border-border lg:px-2 lg:pt-1.5"
                data-barra-de-selecao=""
              >
                <div
                  className="pointer-events-auto flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-x-auto overscroll-contain scrollbar-hidden rounded-lg border border-border bg-card px-2 py-1.5 shadow-xl lg:rounded-none lg:border-0 lg:px-1 lg:shadow-none"
                  data-linha-da-selecao=""
                >
                  <span className="mr-1 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-primary" title={`${escolhidas.length} ${escolhidas.length === 1 ? "foto marcada" : "fotos marcadas"}`}>
                    {escolhidas.length} {escolhidas.length === 1 ? "marcada" : "marcadas"}
                  </span>
                  {prepararNaAgenda && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 shrink-0 px-2.5 text-[12px]"
                      onClick={() => prepararNaAgenda(escolhidas.filter((f) => !f.referencia_web).map((f) => f.id))}
                      aria-label="Preparar na Agenda"
                      title="Preparar na Agenda: foto única ou carrossel, com legenda, data e aprovação do cliente"
                    >
                      <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Agenda
                    </Button>
                  )}
                  {abrirNoEstudio && (
                    <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 px-2.5 text-[12px]" onClick={() => abrirNoEstudio(escolhidas[0].id)} aria-label="Estúdio" title="Abre a primeira marcada no Estúdio de fotos">
                      <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Estúdio
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 px-2.5 text-[12px]" onClick={() => usarNasMesas("mesa")} aria-label="Usar na Mesa" title="Usar na Mesa: abre o Estúdio da Mesa com estas fotos, sem subir de novo">
                    <PenTool className="mr-1.5 h-3.5 w-3.5" /> Mesa
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 px-2.5 text-[12px]" onClick={() => usarNasMesas("ads")} aria-label="Mesa Ads" title="Usar na Mesa Ads: abre o Estúdio da Mesa Ads com estas fotos">
                    <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Ads
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 px-2.5 text-[12px]" onClick={montarKit} aria-label="Montar kit" title="Montar kit: abre um kit novo em Produto com estas fotos, sem gastar IA">
                    <PackagePlus className="mr-1.5 h-3.5 w-3.5" /> Kit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 px-2.5 text-[12px]"
                    aria-label={lado === "produto" ? "Mover para Modelo" : "Mover para Produto"}
                    title={lado === "produto" ? "As marcadas são fotos de modelo" : "As marcadas são fotos de produto"}
                    onClick={() => {
                      moverParaLado(queryClient, clientId, escolhidas.map((f) => f.id), lado === "produto" ? "modelo" : "produto").catch((e) => avisarErro(e, "Fotos não movidas"));
                    }}
                    data-mover-marcadas=""
                  >
                    {lado === "produto" ? <UserRound className="mr-1.5 h-3.5 w-3.5" /> : <Package className="mr-1.5 h-3.5 w-3.5" />}
                    {lado === "produto" ? "Modelo" : "Produto"}
                  </Button>
                  <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 p-0"
                    aria-label="Identificar o produto"
                    title="Identificar o produto pelas fotos marcadas (coluna O produto)"
                    onClick={() => {
                      const alvo = document.querySelector("[data-produto-das-fotos]");
                      if (alvo && typeof (alvo as HTMLElement).scrollIntoView === "function") (alvo as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    <PackageSearch className="h-4 w-4" />
                  </Button>
                  <BotoesDeUso fotos={escolhidas} icones />
                  <button type="button" className={juntar("ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted", foco)} onClick={() => setSelecionadas([])} aria-label="Limpar" title="Desmarcar todas">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </section>
          {/* O produto numa coluna própria (dono: "a área do produto é minúscula"): mesmo tamanho antes e depois de subir. */}
          <RegiaoRolavel modo="lg" rotulo="O produto" memoria={`mesa-foto:acervo:produto:${clientId}`} classeDeFora="min-w-0" data-coluna-do-produto="">
            <ProdutoDasFotos fotos={separadas.produto} coluna recolhidoDeInicio={false} />
          </RegiaoRolavel>
        </div>
      )}

      <JanelaCentral
        aberta={!!fotoAberta}
        onFechar={() => setAberta(null)}
        titulo={fotoAberta ? fotoAberta.nome : "Foto"}
        largura="lg"
        semEspaco
        data-janela-da-foto=""
      >
        {fotoAberta && (
          <DetalheDaFoto
            key={fotoAberta.id}
            foto={fotoAberta}
            todas={brutas}
            leitura={leituras[fotoAberta.id] || null}
            onLeitura={(l) => setLeituras((m) => ({ ...m, [fotoAberta.id]: l }))}
            onAbrir={setAberta}
            onAmpliar={() => setAmpliada(Math.max(0, filtradas.indexOf(fotoAberta)))}
            onFechar={() => setAberta(null)}
            naJanela
          />
        )}
      </JanelaCentral>

      <Ampliar
        imagens={filtradas.map((f) => ({
          caminho: f.storage_path,
          bucket: f.storage_bucket || "mesa",
          titulo: f.nome,
          legenda: classeDaFoto(f) === "gerada" ? "Imagem gerada por IA" : classeDaFoto(f) === "derivada" ? "Tratada a partir de um original" : "Original",
          proporcao: f.largura && f.altura ? f.largura / f.altura : undefined,
        }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
