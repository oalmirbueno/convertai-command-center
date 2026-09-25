import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode, type UIEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckSquare, ClipboardPaste, Eye, Loader2, Maximize2, MoreHorizontal, MousePointerClick, PackageSearch, ScanSearch, Scissors, Search, Upload, UsersRound, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { imagensDoColar } from "@/components/mesa/EstudioFotos";
import { useMesa } from "@/components/mesa/MesaContexto";
import { padraoPara } from "@/lib/mesa/api";
import { AprovarFoto, BotoesDeUso } from "./AcoesDeUso";
import AcoesProDaFoto from "./AcoesProDaFoto";
import { Cartao, FotoInteira, ListaCurta, MiniaturaDaFoto, Pilulas, SeloCurto, SeloDaFoto, useMesaFoto, Vazio } from "./Comuns";
import ProdutoDasFotos from "./ProdutoDasFotos";
import { MenuDeUso } from "./UsoDaFoto";
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
      className={`rounded-xl border border-dashed text-center transition-colors ${compacta ? "px-3 py-3" : "px-4 py-8"} ${
        arrastando ? "border-primary bg-primary/5" : "border-border bg-background"
      }`}
    >
      {andamento ? (
        <p role="status" className="inline-flex items-center text-[12.5px] text-muted-foreground">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {andamento}
        </p>
      ) : (
        <div className={compacta ? "flex flex-wrap items-center justify-center" : ""}>
          <p className={`flex items-center justify-center font-medium ${compacta ? "mr-3 text-[12.5px]" : "text-[14px]"}`}>
            <ClipboardPaste className="mr-1.5 h-4 w-4 text-primary" /> Solte as fotos aqui ou cole com Ctrl+V
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
    <div className="space-y-2 rounded-lg border border-border bg-background p-3" data-leitura-da-foto="">
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
      <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{titulo}</p>
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
  const { irPara } = useMesaFoto();
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
        <p className="rounded-lg bg-primary/5 px-2.5 py-1.5 text-[11.5px] leading-snug text-foreground">
          Imagem gerada por IA. Partes que não aparecem nas fotos originais podem ter sido criadas.
        </p>
      )}
      {/* Principal: aprovar, usar (Mesa, Mesa Ads, baixar, aprovação) e ver grande. */}
      <div className="flex min-w-0 flex-wrap items-center" data-acoes-principais="">
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

/** Estilo da área com rolagem própria: não passa a rolagem para a página quando chega ao fim. */
const ROLAGEM_PROPRIA = { overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" } as const;

export default function EtapaAcervo() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { selecionadas, setSelecionadas, imagemId } = useMesaFoto();
  const fotos = useFotos(clientId);
  const kits = useKits(clientId);
  const [classe, setClasse] = useState<FiltroDaClasse>("todas");
  const [kitFiltro, setKitFiltro] = useState(TODOS_OS_KITS);
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(POR_PAGINA);
  const [aberta, setAberta] = useState<string | null>(imagemId);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [leituras, setLeituras] = useState<Record<string, LeituraDaFoto>>({});
  const painel = useRef<HTMLElement | null>(null);

  const todas = useMemo(() => fotos.data || [], [fotos.data]);
  const listaDeKits = useMemo(() => kits.data || [], [kits.data]);
  const filtradas = useMemo(() => filtrarFotos(todas, classe, kitFiltro, listaDeKits, busca), [todas, classe, kitFiltro, listaDeKits, busca]);
  const visiveis = filtradas.slice(0, limite);
  const fotoAberta = aberta ? todas.find((f) => f.id === aberta) || null : null;
  const escolhidas = useMemo(() => todas.filter((f) => selecionadas.indexOf(f.id) >= 0), [todas, selecionadas]);
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

  return (
    <div className="min-w-0 space-y-4 pb-40">
      <Cartao
        titulo="1. Fotos do produto"
        dica={
          todas.length
            ? `${todas.length} ${todas.length === 1 ? "foto" : "fotos"} no acervo do cliente (o mesmo da Mesa e da Mesa Ads). Suba quantas quiser de uma vez; o produto é identificado logo abaixo.`
            : "Suba as fotos que o cliente mandou: produto, embalagem, detalhes. Mesmo acervo da Mesa e da Mesa Ads."
        }
      >
        <ZonaDeEnvio compacta={!vazio && todas.length > 0} destaque onArquivos={(a) => void enviar(a)} andamento={andamento} />
      </Cartao>

      {todas.length > 0 && <ProdutoDasFotos fotos={todas} />}

      {fotos.isLoading && (
        <p className="flex items-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo o acervo...
        </p>
      )}
      {fotos.isError && <AvisoDeErro erro={fotos.error} />}
      {vazio && (
        <Vazio titulo="O acervo deste cliente está vazio">
          Para produto, 4 a 8 fotos: frente, três quartos, laterais, verso, detalhes e a embalagem em separado. Para pessoa, 6 a 12 fotos recentes e autorizadas, sem filtro de beleza. Para alimento, a porção real vista de cima, a 45 graus e de lado.
        </Vazio>
      )}

      {todas.length > 0 && (
        /*
         * Área das fotos (pedido do dono, 26/09: "tem um scroll só para rodar as fotos, mas fica
         * rodando a página inteira"). No computador a área tem a altura da tela: a barra de filtros
         * fica fixa em cima, a grade rola sozinha e o painel da foto aberta rola sozinho do lado,
         * sem levar a página junto. No celular (tela estreita) tudo segue a rolagem da página: caixa
         * com rolagem própria prende o dedo (armadilha conhecida do painel).
         */
        <section
          className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:grid lg:h-[calc(100vh-176px)] lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_360px]"
          aria-label="Fotos do acervo"
          data-area-das-fotos=""
        >
          <div className="flex min-w-0 flex-col lg:min-h-0 lg:border-r lg:border-border">
            <div className="shrink-0 space-y-2 border-b border-border bg-card px-3 pb-1 pt-2.5" data-barra-das-fotos="">
              <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_200px] md:items-center">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, descrição ou tag" className="h-9 pl-8" aria-label="Buscar no acervo" />
                </div>
                <Select value={kitFiltro} onValueChange={setKitFiltro}>
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
              </div>
              <Pilulas
                rotulo="Filtrar por tipo de foto"
                opcoes={FILTROS_DA_CLASSE.map((f) => ({ ...f, rotulo: `${f.rotulo} · ${f.valor === "todas" ? todas.length : contagem[f.valor]}` }))}
                valor={classe}
                onEscolher={(v) => {
                  setClasse(v);
                  setLimite(POR_PAGINA);
                }}
              />
              <div className="flex min-w-0 flex-wrap items-center pb-1 text-[12px] text-muted-foreground">
                <span className="mr-3 tabular-nums">
                  {filtradas.length} {filtradas.length === 1 ? "foto" : "fotos"}
                  {escolhidas.length ? ` · ${escolhidas.length} ${escolhidas.length === 1 ? "marcada" : "marcadas"}` : ""}
                </span>
                {visiveis.length > 0 && (
                  <button type="button" className="font-medium text-primary hover:underline" onClick={marcarVisiveis}>
                    {todasVisiveisMarcadas ? "Desmarcar as visíveis" : "Selecionar as visíveis"}
                  </button>
                )}
              </div>
            </div>
            <div className={`min-w-0 p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto ${escolhidas.length ? "lg:pb-24" : ""}`} style={ROLAGEM_PROPRIA} onScroll={aoRolarAGrade} data-rolagem-das-fotos="">
              {filtradas.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-center text-[12.5px] text-muted-foreground">Nenhuma foto com esse filtro.</p>
              ) : (
                <div className="grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
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
            </div>
          </div>
          <aside
            ref={painel}
            className="order-first min-w-0 border-b border-border lg:order-none lg:min-h-0 lg:overflow-y-auto lg:border-b-0"
            style={ROLAGEM_PROPRIA}
            aria-label="Foto aberta"
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
          </aside>
        </section>
      )}

      {escolhidas.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[132px] z-30 flex justify-center px-3 md:bottom-[84px]" data-barra-de-selecao="">
          <div className="pointer-events-auto flex min-w-0 max-w-full flex-wrap items-center rounded-2xl border border-border bg-card px-3 pt-1.5 shadow-xl">
            <span className="mb-1.5 mr-2 text-[12.5px] font-semibold tabular-nums">
              {escolhidas.length} {escolhidas.length === 1 ? "selecionada" : "selecionadas"}
            </span>
            <Button
              type="button"
              size="sm"
              className="mb-1.5 mr-1.5 h-8 text-[12px]"
              onClick={() => {
                const alvo = document.querySelector("[data-produto-das-fotos]");
                if (alvo && typeof (alvo as HTMLElement).scrollIntoView === "function") (alvo as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <PackageSearch className="mr-1.5 h-3.5 w-3.5" /> Identificar o produto
            </Button>
            <BotoesDeUso fotos={escolhidas} compacto />
            <button type="button" className="mb-1.5 h-8 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-muted" onClick={() => setSelecionadas([])}>
              Limpar
            </button>
          </div>
        </div>
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
