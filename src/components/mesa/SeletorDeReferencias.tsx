import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, ExternalLink, FolderTree, ImageOff, Info, Landmark, Link2, Loader2, Plus, Search, Star, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveFileUrl } from "@/lib/fileUrls";
import { textoDoErro } from "@/lib/mesa/api";
import { imagensDoWorkspace, pastasDoWorkspace, RAIZ, useArvoreDoWorkspace, type NoDoWorkspace } from "@/lib/mesa/pastas";
import {
  adicionarPin,
  ampliavelDaFonte,
  chaveDasReferenciasComDestaque,
  ehLinkDePin,
  fonteDaGlobal,
  fonteDaReferencia,
  gravarDestaque,
  ligarImagemDoWorkspace,
  limparBusca,
  ordenarPorDestaque,
  PAPEIS,
  precisaDaExterna,
  PREFIXO_GLOBAL,
  rotuloDoPapel,
  subirReferencia,
  useAtraso,
  useBancoDaAgencia,
  useGlobaisPorIds,
  useReferenciasComDestaque,
  useTagsDoBanco,
  type FonteDaImagem,
  type PapelDaReferencia,
  type ReferenciaComDestaque,
} from "@/lib/mesa/referencias";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { useMesa } from "./MesaContexto";
import { ExploradorDePastas } from "./NavegadorDePastas";

/**
 * Seletor único de referências da Mesa (pedido do dono, 23/09, noite): um só
 * lugar para escolher referências no Contexto, nas Campanhas e no Estúdio.
 *
 * Abas:
 * - Do cliente: cliente_referencias, filtro Artes da marca / Composição, as
 *   em destaque primeiro e a estrela para marcar ou desmarcar o destaque.
 * - Pastas do workspace: a mesma árvore do Workspace do cliente; a imagem
 *   escolhida entra como referência de composição.
 * - Banco da agência: referencias_globais com busca, tags e páginas.
 * - Pinterest: abre o Pinterest numa aba nova e cola o link do pin, ou sobe
 *   uma imagem do computador (entra como referência de composição).
 *
 * As abas quebram linha no painel estreito do Estúdio: com rolagem lateral a
 * aba Pinterest ficava fora da vista ("tem que colocar o Pinterest", 25/09).
 *
 * Ids escolhidos: o id da referência do cliente ou "g:" + id do banco da
 * agência. Clicar na imagem abre grande (Ampliar).
 */

export type AbaDoSeletor = "cliente" | "workspace" | "banco" | "pinterest";
/** escolher: marca ids (Campanhas, Estúdio). gerenciar: só organiza (Contexto). */
export type ModoDoSeletor = "escolher" | "gerenciar";

export interface PropsDoSeletorDeReferencias {
  /** Ids escolhidos (referência do cliente ou "g:" + id do banco da agência). */
  selecionados?: string[];
  onChange?: (ids: string[]) => void;
  /** Limite de escolhas deste uso (Campanhas 8, Estúdio 4). */
  max?: number;
  modo?: ModoDoSeletor;
  /** Abas visíveis e em que ordem. */
  abas?: AbaDoSeletor[];
  /** Aba controlada por quem usa (opcional). */
  aba?: AbaDoSeletor;
  onAba?: (aba: AbaDoSeletor) => void;
  /** Altura máxima de cada área com rolagem própria. */
  alturaMax?: string;
  /** Colunas da grade: 3 para painéis estreitos. */
  colunas?: 3 | 4 | 6;
  /** Itens por página no banco da agência. */
  porPagina?: number;
  /** Mostra também as referências desligadas (modo gerenciar). */
  mostrarInativas?: boolean;
  /** Ações extras embaixo de cada referência do cliente (modo gerenciar). */
  acoesDaReferencia?: (r: ReferenciaComDestaque) => ReactNode;
}

const ABAS: { valor: AbaDoSeletor; rotulo: string; icone: typeof Star }[] = [
  { valor: "cliente", rotulo: "Do cliente", icone: UserRound },
  { valor: "workspace", rotulo: "Pastas do workspace", icone: FolderTree },
  { valor: "banco", rotulo: "Banco da agência", icone: Landmark },
  { valor: "pinterest", rotulo: "Pinterest", icone: Link2 },
];

const GRADE: Record<3 | 4 | 6, string> = {
  3: "grid-cols-3",
  4: "grid-cols-3 sm:grid-cols-4",
  6: "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6",
};

export const PINTEREST_URL = "https://www.pinterest.com/";

// ------------------------------------------------------------------ imagem

type Etapa = "mini" | "original" | "externa";

/**
 * Miniatura com reserva: URL assinada já reduzida, depois a original e, por
 * fim, a imagem pública (url_origem). O banco da agência vai direto na
 * pública (a assinatura de "globais/" é recusada pelo bucket).
 */
export function ImagemDeReferencia({ fonte, alt, largura = 320, className = "" }: { fonte: FonteDaImagem | null; alt: string; largura?: number; className?: string }) {
  const bucket = fonte ? fonte.bucket : "mesa";
  const caminho = fonte ? fonte.caminho : null;
  const externa = fonte ? fonte.externa || null : null;
  const ordem = useMemo(() => {
    const o: Etapa[] = [];
    if (!fonte) return o;
    if (precisaDaExterna(fonte)) {
      o.push("externa");
      if (caminho) o.push("original");
    } else {
      if (caminho) o.push("mini", "original");
      if (externa) o.push("externa");
    }
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, caminho, externa]);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [bucket, caminho, externa]);
  const etapa: Etapa | undefined = ordem[i];
  const assinar = (etapa === "mini" || etapa === "original") && !!caminho;

  const url = useQuery({
    queryKey: ["mesa", "url", bucket, caminho, etapa === "mini" ? `mini-${largura}-cover` : "original"],
    enabled: assinar,
    staleTime: 45 * 60_000,
    gcTime: 55 * 60_000,
    retry: 0,
    queryFn: async () => {
      const c = String(caminho);
      const transform = etapa === "mini" ? { width: largura, height: largura, resize: "cover" as const, quality: 70 } : null;
      if (c.indexOf("://") > 0) return resolveFileUrl({ fileUrl: c, transform });
      const { data, error } = await (supabase.storage.from(bucket) as any).createSignedUrl(c, 3600, transform ? { transform } : undefined);
      if (error || !data?.signedUrl) throw error || new Error("Imagem indisponível");
      return String(data.signedUrl);
    },
  });
  const falhou = url.isError;
  useEffect(() => {
    if (assinar && falhou) setI((n) => n + 1);
  }, [assinar, falhou]);

  if (!etapa) {
    return (
      <span className={`flex items-center justify-center bg-muted text-muted-foreground ${className}`} role="img" aria-label={`${alt}: imagem indisponível`}>
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }
  const src = etapa === "externa" ? externa : url.data;
  if (!src) return <span className={`block animate-pulse bg-muted ${className}`} aria-hidden="true" />;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy={etapa === "externa" ? "no-referrer" : undefined}
      onError={() => setI((n) => n + 1)}
      className={`object-cover ${className}`}
    />
  );
}

/** Caixa 4:5 sem aspect-ratio (Safari 11): o padding reserva a altura. */
function Retrato({ children, marcada, className = "" }: { children: ReactNode; marcada?: boolean; className?: string }) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-lg border bg-muted transition-colors ${marcada ? "border-primary ring-1 ring-primary" : "border-border"} ${className}`}
      style={{ paddingTop: "125%" }}
    >
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}

function BotaoUsar({ marcada, bloqueada, ocupada, onClick, rotulo = "Usar" }: { marcada: boolean; bloqueada: boolean; ocupada?: boolean; onClick: () => void; rotulo?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={marcada}
      disabled={ocupada || (!marcada && bloqueada)}
      className={`mt-1 flex h-7 w-full items-center justify-center rounded-md border text-[11px] font-medium transition-colors disabled:opacity-40 ${
        marcada ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {ocupada ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : marcada ? (
        <>
          <Check className="mr-1 h-3 w-3" /> Escolhida
        </>
      ) : (
        <>
          <Plus className="mr-1 h-3 w-3" /> {rotulo}
        </>
      )}
    </button>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] leading-relaxed text-muted-foreground">{children}</p>;
}

/** Selo do papel com a explicação curta ao passar o mouse. */
export function SeloDoPapel({ papel, className = "" }: { papel: PapelDaReferencia; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={`inline-block max-w-full cursor-help truncate rounded-full px-1.5 py-px text-[10px] font-medium ${
            papel === "identidade" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
          } ${className}`}
        >
          {PAPEIS[papel].curto}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-[12px] leading-relaxed">{PAPEIS[papel].dica}</TooltipContent>
    </Tooltip>
  );
}

/** Uma linha que explica os dois papéis (com tooltip em cada um). */
export function LegendaDosPapeis() {
  return (
    <p className="flex min-w-0 flex-wrap items-center text-[11.5px] leading-relaxed text-muted-foreground">
      <Info className="mr-1 h-3.5 w-3.5 shrink-0" />
      <span className="mr-1">
        <SeloDoPapel papel="identidade" /> o estilo que a marca já usa.
      </span>
      <span>
        <SeloDoPapel papel="tecnica" /> composição de fora, copiada com as cores da marca.
      </span>
    </p>
  );
}

// ------------------------------------------------------------------ destaque

function useAlternarDestaque(clientId: string) {
  const queryClient = useQueryClient();
  const [gravando, setGravando] = useState<Record<string, boolean>>({});
  const alternar = async (r: ReferenciaComDestaque) => {
    const chave = chaveDasReferenciasComDestaque(clientId);
    const novo = !r.destaque;
    const antes = queryClient.getQueryData<ReferenciaComDestaque[]>(chave);
    if (antes) queryClient.setQueryData(chave, ordenarPorDestaque(antes.map((x) => (x.id === r.id ? { ...x, destaque: novo } : x))));
    setGravando((g) => ({ ...g, [r.id]: true }));
    try {
      await gravarDestaque(r.id, novo);
      toast.success(novo ? "Em destaque: o diretor de arte usa sempre" : "Saiu do destaque");
    } catch (e) {
      if (antes) queryClient.setQueryData(chave, antes);
      toast.error("Destaque não salvo", { description: textoDoErro(e) });
    } finally {
      setGravando((g) => {
        const c = { ...g };
        delete c[r.id];
        return c;
      });
      void queryClient.invalidateQueries({ queryKey: ["mesa", "referencias", clientId] });
    }
  };
  return { alternar, gravando };
}

export function BotaoDestaque({ ativo, ocupado, onClick, className = "" }: { ativo: boolean; ocupado?: boolean; onClick: () => void; className?: string }) {
  const rotulo = ativo ? "Tirar do destaque" : "Marcar como destaque";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupado}
      aria-pressed={ativo}
      aria-label={rotulo}
      title={ativo ? "Em destaque: o diretor de arte usa sempre. Clique para tirar." : "Marcar como destaque: o diretor de arte usa sempre, antes das outras."}
      className={`flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition-colors ${
        ativo ? "bg-amber-400 text-white" : "bg-background/90 text-muted-foreground hover:text-amber-500"
      } ${className}`}
    >
      {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className={`h-3.5 w-3.5 ${ativo ? "fill-current" : ""}`} />}
    </button>
  );
}

// ------------------------------------------------------------------ escolhidas

/** Miniaturas das escolhidas (clicar abre grande; o X tira). Resolve cliente e banco da agência. */
export function MiniaturasEscolhidas({ ids, onTirar, vazio, colunas = 8 }: { ids: string[]; onTirar?: (id: string) => void; vazio?: string; colunas?: 5 | 8 }) {
  const { clientId } = useMesa();
  const refs = useReferenciasComDestaque(clientId, ids.some((id) => id.indexOf(PREFIXO_GLOBAL) !== 0));
  const globais = useGlobaisPorIds(ids);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  if (!ids.length) return vazio ? <p className="text-[12px] text-muted-foreground">{vazio}</p> : null;
  const itens = ids.map((id) => {
    if (id.indexOf(PREFIXO_GLOBAL) === 0) {
      const g = (globais.data || []).find((x) => x.id === id.slice(PREFIXO_GLOBAL.length));
      return { id, nome: (g && g.titulo) || "Banco da agência", fonte: g ? fonteDaGlobal(g) : null, legenda: g ? g.leitura : null };
    }
    const r = (refs.data || []).find((x) => x.id === id);
    return { id, nome: r ? `${r.nome} · ${rotuloDoPapel(r.papel)}` : "Do cliente", fonte: r ? fonteDaReferencia(r) : null, legenda: r ? r.leitura : null };
  });
  const ampliaveis: ImagemAmpliavel[] = [];
  const indiceNoAmpliar: number[] = [];
  for (const it of itens) {
    const a = ampliavelDaFonte(it.fonte);
    indiceNoAmpliar.push(a ? ampliaveis.length : -1);
    if (a) ampliaveis.push({ ...a, titulo: it.nome, legenda: it.legenda || undefined });
  }
  return (
    <>
      <ul className={`grid gap-1.5 ${colunas === 5 ? "grid-cols-5" : "grid-cols-4 sm:grid-cols-8"}`}>
        {itens.map((it, i) => (
          <li key={it.id} className="relative min-w-0">
            <button
              type="button"
              onClick={() => {
                if (indiceNoAmpliar[i] >= 0) setAmpliada(indiceNoAmpliar[i]);
              }}
              className="block w-full cursor-zoom-in"
              aria-label={`${it.nome}: ver grande`}
              title={it.nome}
            >
              <Retrato>
                <ImagemDeReferencia fonte={it.fonte} alt={it.nome} largura={200} className="h-full w-full" />
              </Retrato>
            </button>
            {onTirar && (
              <button
                type="button"
                onClick={() => onTirar(it.id)}
                aria-label="Tirar esta referência"
                title="Tirar"
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm hover:text-destructive"
              >
                <span aria-hidden="true" className="text-[12px] leading-none">×</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <Ampliar imagens={ampliaveis} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </>
  );
}

// ------------------------------------------------------------------ seletor

export default function SeletorDeReferencias({
  selecionados = [],
  onChange,
  max = 8,
  modo = "escolher",
  abas,
  aba: abaControlada,
  onAba,
  // Altura fixa, sem a função min do CSS: o Chrome 64 e o Safari 11 ignoravam a altura e a lista não rolava.
  alturaMax = "560px",
  colunas = 4,
  porPagina = 24,
  mostrarInativas = false,
  acoesDaReferencia,
}: PropsDoSeletorDeReferencias) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const escolher = modo === "escolher";
  const visiveis = abas && abas.length ? abas : escolher ? ABAS.map((a) => a.valor) : (["cliente", "workspace", "pinterest"] as AbaDoSeletor[]);
  const [abaInterna, setAbaInterna] = useState<AbaDoSeletor>(visiveis[0]);
  const aba = abaControlada && visiveis.indexOf(abaControlada) >= 0 ? abaControlada : abaInterna;
  const irPara = (a: AbaDoSeletor) => {
    setAbaInterna(a);
    if (onAba) onAba(a);
  };

  const refs = useReferenciasComDestaque(clientId);
  const destaque = useAlternarDestaque(clientId);
  const [ampliada, setAmpliada] = useState<{ lista: ImagemAmpliavel[]; indice: number } | null>(null);
  const cheio = selecionados.length >= max;
  const grade = GRADE[colunas];

  const alternar = (id: string) => {
    if (!onChange) return;
    if (selecionados.indexOf(id) >= 0) onChange(selecionados.filter((x) => x !== id));
    else if (cheio) toast.error(`Até ${max} referências aqui. Tire uma para escolher outra.`);
    else onChange(selecionados.concat([id]));
  };
  const incluir = (id: string) => {
    if (!onChange || selecionados.indexOf(id) >= 0) return;
    if (cheio) {
      toast.info(`Guardada nas referências do cliente. O limite aqui é ${max}.`);
      return;
    }
    onChange(selecionados.concat([id]));
  };
  const atualizarRefs = () => void queryClient.invalidateQueries({ queryKey: ["mesa", "referencias", clientId] });

  const ampliar = (lista: { fonte: FonteDaImagem | null; titulo: string; legenda?: string | null }[], indice: number) => {
    const saida: ImagemAmpliavel[] = [];
    let alvo = -1;
    lista.forEach((l, i) => {
      const a = ampliavelDaFonte(l.fonte);
      if (!a) return;
      if (i === indice) alvo = saida.length;
      saida.push({ ...a, titulo: l.titulo, legenda: l.legenda || undefined });
    });
    if (alvo >= 0) setAmpliada({ lista: saida, indice: alvo });
  };

  const todas = refs.data || [];
  const doCliente = mostrarInativas ? todas : todas.filter((r) => r.ativa);

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-end border-b border-border">
        <div role="tablist" aria-label="Onde escolher as referências" className="-mb-px flex min-w-0 flex-1 flex-wrap">
          {ABAS.filter((a) => visiveis.indexOf(a.valor) >= 0).map((a) => {
            const Icone = a.icone;
            const n = a.valor === "cliente" ? doCliente.length : null;
            return (
              <button
                key={a.valor}
                type="button"
                role="tab"
                aria-selected={aba === a.valor}
                onClick={() => irPara(a.valor)}
                className={`mr-3 flex h-9 shrink-0 items-center whitespace-nowrap border-b-2 text-[12.5px] transition-colors ${
                  aba === a.valor ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icone className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                {a.rotulo}
                {n !== null && refs.data ? <span className="ml-1 text-muted-foreground">({n})</span> : null}
              </button>
            );
          })}
        </div>
        {escolher && (
          <span className="mb-2 ml-2 shrink-0 text-[11.5px] tabular-nums text-muted-foreground" aria-live="polite">
            {selecionados.length} de {max}
          </span>
        )}
      </div>

      <div role="tabpanel" className="min-w-0">
        {aba === "cliente" && (
          <AbaDoCliente
            lista={doCliente}
            carregando={refs.isLoading}
            erro={refs.isError ? textoDoErro(refs.error) : null}
            grade={grade}
            alturaMax={alturaMax}
            escolher={escolher}
            selecionados={selecionados}
            cheio={cheio}
            onAlternar={alternar}
            onDestaque={(r) => void destaque.alternar(r)}
            gravandoDestaque={destaque.gravando}
            onAmpliar={ampliar}
            acoes={acoesDaReferencia}
            onIrParaWorkspace={visiveis.indexOf("workspace") >= 0 ? () => irPara("workspace") : undefined}
          />
        )}
        {aba === "workspace" && (
          <AbaDoWorkspace
            clientId={clientId}
            refs={todas}
            grade={grade}
            semArvore={colunas === 3}
            alturaMax={alturaMax}
            escolher={escolher}
            selecionados={selecionados}
            cheio={cheio}
            onAlternar={alternar}
            onIncluir={incluir}
            onMudou={atualizarRefs}
            onAmpliar={ampliar}
          />
        )}
        {aba === "banco" && (
          <AbaDoBanco
            grade={grade}
            alturaMax={alturaMax}
            porPagina={porPagina}
            escolher={escolher}
            selecionados={selecionados}
            cheio={cheio}
            onAlternar={alternar}
            onAmpliar={ampliar}
          />
        )}
        {aba === "pinterest" && (
          <AbaDoPinterest
            clientId={clientId}
            pins={doCliente.filter((r) => r.origem === "pinterest" || r.origem === "upload")}
            grade={grade}
            alturaMax={alturaMax}
            escolher={escolher}
            selecionados={selecionados}
            cheio={cheio}
            onAlternar={alternar}
            onIncluir={incluir}
            onMudou={atualizarRefs}
            onAmpliar={ampliar}
          />
        )}
      </div>

      <Ampliar imagens={ampliada ? ampliada.lista : []} indice={ampliada ? ampliada.indice : null} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

type Ampliador = (lista: { fonte: FonteDaImagem | null; titulo: string; legenda?: string | null }[], indice: number) => void;

// ------------------------------------------------------------------ aba: do cliente

type FiltroDoPapel = "todas" | PapelDaReferencia;

function CartaoDaReferencia({
  r,
  escolher,
  marcada,
  bloqueada,
  onAlternar,
  onDestaque,
  gravandoDestaque,
  onAmpliar,
  acoes,
}: {
  r: ReferenciaComDestaque;
  escolher: boolean;
  marcada: boolean;
  bloqueada: boolean;
  onAlternar: () => void;
  onDestaque: () => void;
  gravandoDestaque: boolean;
  onAmpliar: () => void;
  acoes?: ReactNode;
}) {
  const lida = !!(r.leitura && r.leitura.trim());
  return (
    <li className={`min-w-0 ${r.ativa ? "" : "opacity-60"}`}>
      <Retrato marcada={marcada}>
        <button
          type="button"
          onClick={onAmpliar}
          className="absolute inset-0 block h-full w-full cursor-zoom-in"
          aria-label={`Ver maior: ${r.nome}, ${rotuloDoPapel(r.papel)}${lida ? "" : ", sem leitura"}`}
          title={lida ? r.leitura || r.nome : `${r.nome} (sem leitura ainda)`}
        >
          <ImagemDeReferencia fonte={fonteDaReferencia(r)} alt={r.nome} className="h-full w-full" />
        </button>
        <BotaoDestaque ativo={r.destaque} ocupado={gravandoDestaque} onClick={onDestaque} className="absolute left-1 top-1" />
        {!lida && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-warning" title="Sem leitura" aria-hidden="true" />}
      </Retrato>
      <div className="mt-1 flex min-w-0 items-center">
        <SeloDoPapel papel={r.papel} />
      </div>
      {escolher && <BotaoUsar marcada={marcada} bloqueada={bloqueada} onClick={onAlternar} />}
      {acoes}
    </li>
  );
}

function AbaDoCliente({
  lista,
  carregando,
  erro,
  grade,
  alturaMax,
  escolher,
  selecionados,
  cheio,
  onAlternar,
  onDestaque,
  gravandoDestaque,
  onAmpliar,
  acoes,
  onIrParaWorkspace,
}: {
  lista: ReferenciaComDestaque[];
  carregando: boolean;
  erro: string | null;
  grade: string;
  alturaMax: string;
  escolher: boolean;
  selecionados: string[];
  cheio: boolean;
  onAlternar: (id: string) => void;
  onDestaque: (r: ReferenciaComDestaque) => void;
  gravandoDestaque: Record<string, boolean>;
  onAmpliar: Ampliador;
  acoes?: (r: ReferenciaComDestaque) => ReactNode;
  onIrParaWorkspace?: () => void;
}) {
  const [filtro, setFiltro] = useState<FiltroDoPapel>("todas");
  const contagem: Record<FiltroDoPapel, number> = {
    todas: lista.length,
    identidade: lista.filter((r) => r.papel === "identidade").length,
    tecnica: lista.filter((r) => r.papel === "tecnica").length,
  };
  const filtradas = filtro === "todas" ? lista : lista.filter((r) => r.papel === filtro);
  const emDestaque = filtradas.filter((r) => r.destaque).length;
  const paraAmpliar = filtradas.map((r) => ({ fonte: fonteDaReferencia(r), titulo: `${r.nome} · ${PAPEIS[r.papel].curto}`, legenda: r.leitura }));

  return (
    <div className="min-w-0 space-y-2.5">
      <div role="group" aria-label="Filtrar por papel" className="flex min-w-0 flex-wrap items-center">
        {(["todas", "identidade", "tecnica"] as FiltroDoPapel[]).map((f) => {
          const botao = (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              aria-pressed={filtro === f}
              className={`mb-1 mr-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors ${
                filtro === f ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "todas" ? "Todas" : PAPEIS[f].rotulo} {contagem[f]}
            </button>
          );
          if (f === "todas") return botao;
          return (
            <Tooltip key={f}>
              <TooltipTrigger asChild>{botao}</TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-[12px] leading-relaxed">{PAPEIS[f].dica}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <LegendaDosPapeis />
      {emDestaque > 0 && (
        <p className="flex items-center text-[11.5px] text-muted-foreground">
          <Star className="mr-1 h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          {emDestaque === 1 ? "1 em destaque, primeiro na lista. O diretor de arte usa sempre." : `${emDestaque} em destaque, primeiro na lista. O diretor de arte usa sempre.`}
        </p>
      )}

      <div className="min-w-0 overflow-y-auto pr-0.5" style={{ maxHeight: alturaMax }}>
        {carregando && (
          <p className="flex items-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo as referências...
          </p>
        )}
        {erro && <p className="rounded-lg bg-destructive/10 p-2.5 text-[12px]">{erro}</p>}
        {!carregando && !erro && filtradas.length === 0 && (
          <Aviso>
            {lista.length ? "Nenhuma referência neste filtro." : "O cliente ainda não tem referências. Escolha nas pastas do workspace ou cole um pin do Pinterest."}
            {onIrParaWorkspace && !lista.length && (
              <button type="button" onClick={onIrParaWorkspace} className="mt-1 block w-full font-medium text-foreground hover:underline">
                Abrir as pastas do workspace
              </button>
            )}
          </Aviso>
        )}
        <ul className={`grid gap-2 ${grade}`}>
          {filtradas.map((r, i) => (
            <CartaoDaReferencia
              key={r.id}
              r={r}
              escolher={escolher}
              marcada={selecionados.indexOf(r.id) >= 0}
              bloqueada={cheio}
              onAlternar={() => onAlternar(r.id)}
              onDestaque={() => onDestaque(r)}
              gravandoDestaque={!!gravandoDestaque[r.id]}
              onAmpliar={() => onAmpliar(paraAmpliar, i)}
              acoes={acoes ? acoes(r) : undefined}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ aba: workspace

function AbaDoWorkspace({
  clientId,
  refs,
  grade,
  semArvore,
  alturaMax,
  escolher,
  selecionados,
  cheio,
  onAlternar,
  onIncluir,
  onMudou,
  onAmpliar,
}: {
  clientId: string;
  refs: ReferenciaComDestaque[];
  grade: string;
  semArvore: boolean;
  alturaMax: string;
  escolher: boolean;
  selecionados: string[];
  cheio: boolean;
  onAlternar: (id: string) => void;
  onIncluir: (id: string) => void;
  onMudou: () => void;
  onAmpliar: Ampliador;
}) {
  const nos = useArvoreDoWorkspace(clientId);
  const [ligando, setLigando] = useState<Record<string, boolean>>({});
  const todos = nos.data || [];
  const imagens = imagensDoWorkspace(todos);
  const refDoNo: Record<string, ReferenciaComDestaque> = {};
  for (const r of refs) if (r.workspace_node_id) refDoNo[r.workspace_node_id] = r;

  const usar = async (n: NoDoWorkspace) => {
    const ja = refDoNo[n.id];
    if (ja && ja.ativa) {
      if (escolher) onAlternar(ja.id);
      return;
    }
    if (escolher && cheio) {
      toast.error("Limite de referências atingido. Tire uma para escolher outra.");
      return;
    }
    setLigando((l) => ({ ...l, [n.id]: true }));
    try {
      const id = await ligarImagemDoWorkspace(clientId, n.id, "tecnica");
      onMudou();
      if (escolher) onIncluir(id);
      else toast.success("Entrou nas referências de composição do cliente");
    } catch (e) {
      toast.error("Não foi possível usar esta imagem", { description: textoDoErro(e) });
    } finally {
      setLigando((l) => {
        const c = { ...l };
        delete c[n.id];
        return c;
      });
    }
  };

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        As mesmas pastas do Workspace do cliente. Abra a pasta e escolha: a imagem entra como {PAPEIS.tecnica.rotulo.toLowerCase()}.
      </p>
      <ExploradorDePastas<NoDoWorkspace>
        pastas={pastasDoWorkspace(todos)}
        itens={imagens}
        pastaDoItem={(n) => n.parent_id || RAIZ}
        carregando={nos.isLoading}
        erro={nos.isError ? "Não foi possível ler o Workspace." : null}
        vazio={nos.data && imagens.length === 0 ? "Nenhuma imagem no Workspace deste cliente." : "Nenhuma imagem nesta pasta."}
        alturaMax={alturaMax}
        semArvore={semArvore}
        renderizarItens={(lista) => {
          const paraAmpliar = lista.map((n) => ({ fonte: { bucket: "workspace", caminho: n.storage_path }, titulo: n.name }));
          return (
            <ul className={`grid gap-2 ${grade}`}>
              {lista.map((n, i) => {
                const ref = refDoNo[n.id];
                const emUso = !!ref && ref.ativa;
                const marcada = !!ref && selecionados.indexOf(ref.id) >= 0;
                return (
                  <li key={n.id} className="min-w-0">
                    <Retrato marcada={marcada}>
                      <button type="button" onClick={() => onAmpliar(paraAmpliar, i)} className="absolute inset-0 block h-full w-full cursor-zoom-in" aria-label={`Ver maior: ${n.name}`} title={n.name}>
                        <ImagemDeReferencia fonte={{ bucket: "workspace", caminho: n.storage_path }} alt={n.name} className="h-full w-full" />
                      </button>
                      {ref && ref.destaque && (
                        <span className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-white shadow-sm" title="Em destaque">
                          <Star className="h-3.5 w-3.5 fill-current" />
                        </span>
                      )}
                    </Retrato>
                    <p className="mt-1 flex min-w-0 items-center text-[10.5px] text-muted-foreground">
                      {emUso ? <SeloDoPapel papel={ref.papel} className="mr-1 shrink-0" /> : null}
                      <span className="min-w-0 truncate">{n.name}</span>
                    </p>
                    {escolher ? (
                      <BotaoUsar marcada={marcada} bloqueada={cheio} ocupada={!!ligando[n.id]} onClick={() => void usar(n)} />
                    ) : emUso ? (
                      <p className="mt-1 flex h-7 items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground">
                        <Check className="mr-1 h-3 w-3" /> Já é referência
                      </p>
                    ) : (
                      <BotaoUsar marcada={false} bloqueada={false} ocupada={!!ligando[n.id]} onClick={() => void usar(n)} rotulo="Usar como referência" />
                    )}
                  </li>
                );
              })}
            </ul>
          );
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ aba: banco da agência

function AbaDoBanco({
  grade,
  alturaMax,
  porPagina,
  escolher,
  selecionados,
  cheio,
  onAlternar,
  onAmpliar,
}: {
  grade: string;
  alturaMax: string;
  porPagina: number;
  escolher: boolean;
  selecionados: string[];
  cheio: boolean;
  onAlternar: (id: string) => void;
  onAmpliar: Ampliador;
}) {
  const [busca, setBusca] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const buscaAtrasada = useAtraso(limparBusca(busca), 350);
  useEffect(() => setPagina(0), [buscaAtrasada, tag]);
  const banco = useBancoDaAgencia({ busca: buscaAtrasada, tag, pagina, porPagina, ativo: true });
  const tags = useTagsDoBanco(true);
  const lista = banco.data ? banco.data.lista : [];
  const total = banco.data ? banco.data.total : 0;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const paraAmpliar = lista.map((g) => ({ fonte: fonteDaGlobal(g), titulo: g.titulo || "Banco da agência", legenda: g.leitura }));

  return (
    <div className="min-w-0 space-y-2.5">
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        As referências do quadro do Pinterest da agência, já lidas pela IA. Busque pela técnica (ex.: tipografia, recorte, colagem).
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no título, na leitura ou nas tags" aria-label="Buscar no banco da agência" className="h-9 pl-8 text-[12.5px]" />
      </div>
      {(tags.data || []).length > 0 && (
        <div className="flex max-h-[4.5rem] flex-wrap overflow-y-auto">
          {(tags.data || []).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTag(tag === t ? null : t)}
              aria-pressed={tag === t}
              className={`mb-1.5 mr-1.5 max-w-full truncate rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                tag === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="min-w-0 overflow-y-auto pr-0.5" style={{ maxHeight: alturaMax }}>
        {banco.isLoading && (
          <p className="flex items-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Buscando...
          </p>
        )}
        {banco.isError && <p className="rounded-lg bg-destructive/10 p-2.5 text-[12px]">{textoDoErro(banco.error)}</p>}
        {banco.data && lista.length === 0 && <Aviso>Nada encontrado com essa busca.</Aviso>}
        <ul className={`grid gap-2 ${grade} ${banco.isFetching && !banco.isLoading ? "opacity-70" : ""}`}>
          {lista.map((g, i) => {
            const id = PREFIXO_GLOBAL + g.id;
            const marcada = selecionados.indexOf(id) >= 0;
            return (
              <li key={g.id} className="min-w-0">
                <Retrato marcada={marcada}>
                  <button
                    type="button"
                    onClick={() => onAmpliar(paraAmpliar, i)}
                    className="absolute inset-0 block h-full w-full cursor-zoom-in"
                    aria-label={`Ver maior: ${g.titulo || "referência do banco"}`}
                    title={g.leitura || g.titulo || ""}
                  >
                    <ImagemDeReferencia fonte={fonteDaGlobal(g)} alt={g.titulo || "Referência do banco da agência"} className="h-full w-full" />
                  </button>
                </Retrato>
                {g.titulo && <p className="mt-1 truncate text-[10.5px] text-muted-foreground">{g.titulo}</p>}
                {escolher && <BotaoUsar marcada={marcada} bloqueada={cheio} onClick={() => onAlternar(id)} />}
              </li>
            );
          })}
        </ul>
      </div>
      {total > porPagina && (
        <div className="flex items-center justify-between">
          <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(0, p - 1))} aria-label="Página anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            Página {pagina + 1} de {paginas} · {total.toLocaleString("pt-BR")}
          </span>
          <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ aba: pinterest

function AbaDoPinterest({
  clientId,
  pins,
  grade,
  alturaMax,
  escolher,
  selecionados,
  cheio,
  onAlternar,
  onIncluir,
  onMudou,
  onAmpliar,
}: {
  clientId: string;
  pins: ReferenciaComDestaque[];
  grade: string;
  alturaMax: string;
  escolher: boolean;
  selecionados: string[];
  cheio: boolean;
  onAlternar: (id: string) => void;
  onIncluir: (id: string) => void;
  onMudou: () => void;
  onAmpliar: Ampliador;
}) {
  const [link, setLink] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const subir = async (lista: FileList | null) => {
    const arquivos: File[] = [];
    if (lista) for (let i = 0; i < lista.length; i++) arquivos.push(lista[i]);
    if (!arquivos.length) return;
    setSubindo(true);
    try {
      // Uma por vez: a escolha que segue usa a lista de escolhidas desta tela.
      const id = await subirReferencia(clientId, arquivos[0]);
      onMudou();
      if (escolher) onIncluir(id);
      toast.success("Imagem guardada como referência de composição", { description: "A leitura por IA acontece no \"Ler as pendentes\" do Contexto." });
    } catch (erro) {
      toast.error("Imagem não enviada", { description: textoDoErro(erro) });
    } finally {
      setSubindo(false);
    }
  };
  const paraAmpliar = pins.map((r) => ({ fonte: fonteDaReferencia(r), titulo: `${r.nome} · ${PAPEIS[r.papel].curto}`, legenda: r.leitura }));

  const adicionar = async (e: FormEvent) => {
    e.preventDefault();
    const url = link.trim();
    if (!ehLinkDePin(url)) {
      toast.error("Cole o link completo do pin (https://br.pinterest.com/pin/... ou https://pin.it/...).");
      return;
    }
    setEnviando(true);
    try {
      const r = await adicionarPin(clientId, url);
      toast.success(r.jaExistia ? "Esse pin já estava nas referências" : "Pin adicionado como referência de composição", {
        description: "A leitura por IA acontece no \"Ler as pendentes\" do Contexto.",
      });
      setLink("");
      onMudou();
      if (escolher) onIncluir(r.id);
    } catch (erro) {
      toast.error("Pin não adicionado", { description: textoDoErro(erro) });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Abra o Pinterest, escolha o pin, copie o link (Compartilhar, Copiar link) e cole aqui. Ele entra como {PAPEIS.tecnica.rotulo.toLowerCase()}.
        </p>
        <div className="mt-2.5 flex min-w-0 flex-wrap items-center">
          <a
            href={PINTEREST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-2 mr-2 inline-flex h-9 shrink-0 items-center rounded-md border border-border bg-background px-3 text-[12.5px] font-medium text-foreground transition-colors hover:border-primary/50"
          >
            Abrir o Pinterest <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </a>
          <form onSubmit={(e) => void adicionar(e)} className="mb-2 flex min-w-0 flex-1 basis-64">
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Colar link de pin" aria-label="Link do pin" className="h-9 min-w-0 flex-1 text-[12.5px]" />
            <Button type="submit" size="sm" className="ml-2 h-9 shrink-0" disabled={!link.trim() || enviando}>
              {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              Adicionar
            </Button>
          </form>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center border-t border-border pt-2.5">
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-9 shrink-0" disabled={subindo} onClick={() => arquivo.current && arquivo.current.click()}>
            {subindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Subir imagem
          </Button>
          <span className="mb-1 min-w-0 text-[11.5px] text-muted-foreground">Print ou arquivo do computador (JPG, PNG ou WEBP).</span>
          <input
            ref={arquivo}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-label="Subir imagem de referência"
            onChange={(e) => {
              const lista = e.target.files;
              void subir(lista).then(() => {
                if (arquivo.current) arquivo.current.value = "";
              });
            }}
          />
        </div>
      </div>

      {pins.length > 0 && (
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Pins e imagens enviadas ({pins.length})</p>
          <div className="min-w-0 overflow-y-auto pr-0.5" style={{ maxHeight: alturaMax }}>
            <ul className={`grid gap-2 ${grade}`}>
              {pins.map((r, i) => {
                const marcada = selecionados.indexOf(r.id) >= 0;
                return (
                  <li key={r.id} className="min-w-0">
                    <Retrato marcada={marcada}>
                      <button type="button" onClick={() => onAmpliar(paraAmpliar, i)} className="absolute inset-0 block h-full w-full cursor-zoom-in" aria-label={`Ver maior: ${r.nome}`}>
                        <ImagemDeReferencia fonte={fonteDaReferencia(r)} alt={r.nome} className="h-full w-full" />
                      </button>
                    </Retrato>
                    {escolher && <BotaoUsar marcada={marcada} bloqueada={cheio} onClick={() => onAlternar(r.id)} />}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
