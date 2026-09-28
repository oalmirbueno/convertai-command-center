import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode, type UIEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CheckSquare, ClipboardPaste, Eye, Filter, Loader2, Maximize2, Megaphone, MoreHorizontal, MousePointerClick, PackagePlus, PackageSearch, PenTool, ScanSearch, Scissors, Search, SlidersHorizontal, Upload, UsersRound, Wand2, X } from "lucide-react";
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
import { campo, foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useReservaFlutuante } from "@/components/sistema/useReservaFlutuante";
import ProdutoDasFotos from "./ProdutoDasFotos";
import { MenuDeUso, precisaAprovar, useLevarParaAsMesas } from "./UsoDaFoto";
import { gravarNaSessao } from "./sessao";
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
 * Passo 1, Fotos: as fotos do cliente num lugar só (o mesmo acervo que a
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
  /** Botão principal mesmo na versão compacta (o subir em lote do passo 1). */
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
        <p role="status" className="inline-flex items-center text-[12.5px] text-muted-foreground">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {andamento}
        </p>
      ) : (
        <div className={compacta ? "flex flex-wrap items-center justify-center" : ""}>
          <p className={`flex min-w-0 items-center justify-center font-medium ${compacta ? "mr-2 text-[12px] text-muted-foreground" : "text-[14px]"}`}>
            <ClipboardPaste className="mr-1.5 h-4 w-4 shrink-0 text-primary" /> <span className="min-w-0 truncate">{compacta ? "Solte ou cole com Ctrl+V" : "Solte as fotos aqui ou cole com Ctrl+V"}</span>
          </p>
          {!compacta && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              Quantas quiser de uma vez. JPG, PNG ou WEBP até 25 MB cada. O original fica guardado como veio.
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant={compacta && !destaque ? "outline" : "default"}
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
}: {
  foto: FotoDoAcervo;
  todas: FotoDoAcervo[];
  leitura: LeituraDaFoto | null;
  onLeitura: (l: LeituraDaFoto) => void;
  onAbrir: (id: string) => void;
  onAmpliar: () => void;
  onFechar: () => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const { irPara, abrirNoEstudio, prepararNaAgenda } = useMesaFoto();
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
        <button type="button" onClick={onFechar} aria-label="Fechar o detalhe" className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
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
      className={`relative min-w-0 rounded-lg border bg-card p-1 transition-colors ${
        aberta ? "border-primary ring-1 ring-primary" : marcada ? "border-primary/60" : "border-border hover:border-primary/40"
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
      <p className="mt-1 truncate px-0.5 text-[10.5px] font-medium" title={foto.nome}>
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

export default function EtapaAcervo() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { selecionadas, setSelecionadas, imagemId, irPara, abrirNoEstudio, prepararNaAgenda } = useMesaFoto();
  const levar = useLevarParaAsMesas();
  const fotos = useFotos(clientId);
  const kits = useKits(clientId);
  // Filtros, busca e a foto aberta ficam guardados por cliente (sair e voltar mantém).
  const [classe, setClasse] = useEstadoDaTela<FiltroDaClasse>(`mesa-foto:acervo:classe:${clientId}`, "todas", { validar: (v) => CLASSES_VALIDAS.indexOf(String(v)) >= 0 });
  const [kitFiltro, setKitFiltro] = useEstadoDaTela(`mesa-foto:acervo:produto:${clientId}`, TODOS_OS_KITS, { validar: (v) => typeof v === "string" && !!v });
  const [busca, setBusca] = useEstadoDaTela(`mesa-foto:acervo:busca:${clientId}`, "");
  const [aberta, setAberta] = useEstadoDaTela<string | null>(`mesa-foto:acervo:aberta:${clientId}`, imagemId, { validar: (v) => v === null || typeof v === "string" });
  const [limite, setLimite] = useState(POR_PAGINA);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [leituras, setLeituras] = useState<Record<string, LeituraDaFoto>>({});
  const painel = useRef<HTMLDivElement | null>(null);

  // Foto pedida pelo endereço (?imagem=) abre por cima da guardada.
  useEffect(() => {
    if (imagemId) setAberta(imagemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagemId]);

  const todas = useMemo(() => fotos.data || [], [fotos.data]);
  const listaDeKits = useMemo(() => kits.data || [], [kits.data]);
  // Produto guardado que não existe mais: volta para todos.
  const kitValido = kitFiltro === TODOS_OS_KITS || kitFiltro === SEM_KIT || !kits.isSuccess || listaDeKits.some((k) => k.id === kitFiltro) ? kitFiltro : TODOS_OS_KITS;
  const filtradas = useMemo(() => filtrarFotos(todas, classe, kitValido, listaDeKits, busca), [todas, classe, kitValido, listaDeKits, busca]);
  const visiveis = filtradas.slice(0, limite);
  const fotoAberta = aberta ? todas.find((f) => f.id === aberta) || null : null;
  const escolhidas = useMemo(() => todas.filter((f) => selecionadas.indexOf(f.id) >= 0), [todas, selecionadas]);
  // Barra de seleção flutuante no celular (acima do botão do diretor): reserva o fim da página.
  useReservaFlutuante(escolhidas.length > 0, 120);
  const contagem = useMemo(() => {
    const c = { original: 0, derivada: 0, gerada: 0, aprovada: 0 };
    for (const f of todas) {
      c[classeDaFoto(f)]++;
      if (f.aprovada) c.aprovada++;
    }
    return c;
  }, [todas]);

  // Foto nova aberta: o painel do lado volta ao topo (a rolagem dele é própria).
  useEffect(() => {
    if (painel.current) painel.current.scrollTop = 0;
  }, [aberta]);

  const enviar = async (arquivos: File[]) => {
    if (!arquivos.length || andamento) return;
    setAndamento(`Preparando ${arquivos.length} ${arquivos.length === 1 ? "foto" : "fotos"}`);
    try {
      const r = await subirOriginais(clientId, arquivos, (feitos, total) => {
        setAndamento(feitos < total ? `Subindo ${feitos} de ${total}` : "Registrando no acervo e conferindo duplicadas");
      });
      acrescentarFotos(queryClient, clientId, r.registradas);
      invalidarFotos(queryClient, clientId);
      const n = r.registradas.length;
      if (n || r.duplicadas) {
        toast.success(n ? `${n} ${n === 1 ? "foto nova" : "fotos novas"} no acervo` : "Nenhuma foto nova", {
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

  // Ctrl+V na etapa: só quando há arquivo de imagem (colar texto segue normal).
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const imagens = imagensDoColar(e.clipboardData);
      if (!imagens.length) return;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA")) return;
      e.preventDefault();
      void enviarRef.current(imagens);
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, []);

  // Usar as marcadas na Mesa ou na Mesa Ads direto daqui (pedido do dono, 27/09). Foto gerada
  // só depois da aprovação da equipe, a mesma regra do passo Usar; original e tratada vão.
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
  // Montar kit: as marcadas abrem um kit novo em Produto, sem IA (o nome e os papéis ficam lá).
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
  // Rolagem da grade perto do fim: carrega mais sem botão (o botão fica para quem prefere).
  const aoRolarAGrade = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (filtradas.length > limite && el.scrollTop + el.clientHeight > el.scrollHeight - 320) setLimite((l) => l + POR_PAGINA);
  };

  const vazio = fotos.isSuccess && todas.length === 0;
  const zona = <ZonaDeEnvio compacta={!vazio && todas.length > 0} destaque onArquivos={(a) => void enviar(a)} andamento={andamento} />;

  return (
    /*
     * Passo 1 em coluna (sistema de design, 26/09): no computador a página não rola; o topo
     * (subir fotos e o produto) fica em cima e a área das fotos ocupa o resto, com a grade e o
     * painel da foto aberta rolando cada um no seu lugar (RegiaoRolavel). No celular tudo segue
     * a rolagem da página: caixa com rolagem própria prende o dedo.
     */
    <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1" data-etapa-fotos="">
      <div className={todas.length > 0 ? "min-w-0 space-y-4 pb-4 lg:max-h-[45%] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1" : "min-w-0 space-y-4 pb-4"} data-topo-das-fotos="">
        <Cartao
          titulo="Fotos do produto"
          dica="Suba as fotos que o cliente mandou: produto, embalagem, detalhes. Quantas quiser de uma vez; o produto é identificado logo abaixo. É o mesmo acervo da Mesa e da Mesa Ads."
          acao={todas.length > 0 ? zona : undefined}
          recolher={todas.length > 0 ? `mesa-foto:acervo:envio-recolhido:${clientId}` : undefined}
          resumo={`${todas.length} ${todas.length === 1 ? "foto no acervo" : "fotos no acervo"}`}
        >
          {todas.length > 0 ? (
            <p className="text-[12px] tabular-nums text-muted-foreground">
              {todas.length} {todas.length === 1 ? "foto no acervo" : "fotos no acervo"}
            </p>
          ) : (
            zona
          )}
        </Cartao>

        {todas.length > 0 && <ProdutoDasFotos fotos={todas} />}

        {fotos.isLoading && <Carregando forma="grade" linhas={8} rotulo="Lendo o acervo" />}
        {fotos.isError && <AvisoDeErro erro={fotos.error} />}
        {vazio && (
          <Vazio titulo="O acervo deste cliente está vazio">
            Para produto, 4 a 8 fotos: frente, três quartos, laterais, verso, detalhes e a embalagem em separado. Para pessoa, 6 a 12 fotos recentes e autorizadas, sem filtro de beleza. Para alimento, a porção real vista de cima, a 45 graus e de lado.
          </Vazio>
        )}
      </div>

      {todas.length > 0 && (
        <section
          className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card lg:grid lg:min-h-[240px] lg:flex-1 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)] desk:grid-cols-[minmax(0,1fr)_340px]"
          aria-label="Fotos do acervo"
          data-area-das-fotos=""
        >
          <div className="flex min-w-0 flex-col lg:min-h-0 lg:border-r lg:border-border">
            <div className="shrink-0 border-b border-border px-3 pb-2 pt-2.5" data-barra-das-fotos="">
              <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-center">
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
                        {k.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <SeletorCompacto
                  modo="lista"
                  rotulo="Tipo de foto"
                  icone={<Filter className="h-4 w-4" />}
                  opcoes={FILTROS_DA_CLASSE.map((f) => ({ valor: f.valor, rotulo: f.rotulo, contador: f.valor === "todas" ? todas.length : contagem[f.valor] }))}
                  valor={classe}
                  onEscolher={(v) => {
                    setClasse(v as FiltroDaClasse);
                    setLimite(POR_PAGINA);
                  }}
                />
              </div>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
                <span className="mr-3 tabular-nums">
                  {filtradas.length} {filtradas.length === 1 ? "foto" : "fotos"}
                  {escolhidas.length ? ` · ${escolhidas.length} ${escolhidas.length === 1 ? "marcada" : "marcadas"}` : ""}
                </span>
                {visiveis.length > 0 && (
                  <button type="button" className={juntar("rounded font-medium text-primary hover:underline", foco)} onClick={marcarVisiveis}>
                    {todasVisiveisMarcadas ? "Desmarcar as visíveis" : "Selecionar as visíveis"}
                  </button>
                )}
              </div>
            </div>
            <RegiaoRolavel modo="lg" sobre="cartao" memoria={`mesa-foto:acervo:grade:${clientId}`} onScroll={aoRolarAGrade} className="p-2" data-rolagem-das-fotos="">
              {filtradas.length === 0 ? (
                <EstadoVazio compacto titulo="Nenhuma foto com esse filtro." />
              ) : (
                <div className="grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-3 xl:grid-cols-4 desk:grid-cols-5">
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
              {filtradas.length > limite && (
                <Button type="button" size="sm" variant="ghost" className="mt-2 h-8 w-full text-[12px]" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                  Ver mais {Math.min(POR_PAGINA, filtradas.length - limite)}
                </Button>
              )}
            </RegiaoRolavel>
            {escolhidas.length > 0 && (
              /* Celular: barra flutuante acima do botão do diretor. Computador: pé da grade, sem cobrir o diretor. */
              <div
                className="pointer-events-none fixed inset-x-0 bottom-[132px] z-30 flex justify-center px-3 md:bottom-[84px] lg:pointer-events-auto lg:static lg:z-auto lg:block lg:shrink-0 lg:border-t lg:border-border lg:px-2 lg:pt-1.5"
                data-barra-de-selecao=""
              >
                {/*
                  28/09 (dono: "a barra de selecionar está toda bagunçada, não consigo ver as fotos"):
                  uma linha só. As ações de produção com texto curto (o nome inteiro fica no leitor de
                  tela e na dica); as saídas só com ícone. Se não couber, a linha rola de lado e nunca
                  cresce para cima das fotos.
                */}
                <div
                  className="pointer-events-auto flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-x-auto overscroll-contain rounded-lg border border-border bg-card px-2 py-1.5 shadow-xl lg:rounded-none lg:border-0 lg:px-1 lg:shadow-none"
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
                  <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 p-0"
                    aria-label="Identificar o produto"
                    title="Identificar o produto pelas fotos marcadas (abre o bloco O produto)"
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
          </div>
          <RegiaoRolavel
            ref={painel}
            modo="lg"
            sobre="cartao"
            rotulo="Foto aberta"
            classeDeFora="order-first border-b border-border lg:order-none lg:border-b-0"
            data-painel-da-foto=""
          >
            {fotoAberta ? (
              <DetalheDaFoto
                key={fotoAberta.id}
                foto={fotoAberta}
                todas={todas}
                leitura={leituras[fotoAberta.id] || null}
                onLeitura={(l) => setLeituras((m) => ({ ...m, [fotoAberta.id]: l }))}
                onAbrir={setAberta}
                onAmpliar={() => setAmpliada(Math.max(0, filtradas.indexOf(fotoAberta)))}
                onFechar={() => setAberta(null)}
              />
            ) : (
              <div className="hidden lg:block">
                <GuiaDaArea />
              </div>
            )}
          </RegiaoRolavel>
        </section>
      )}

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
