import { createContext, useContext, type ReactNode } from "react";
import { Check, Globe, Sparkles } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import { classeDaFoto, proporcaoDaFoto, rotuloDoModo, type FotoDoAcervo, type ProximoPasso } from "./fotoApi";

/**
 * Peças comuns da Mesa Foto: o contexto da página (kit, ensaio, fotos
 * selecionadas e a troca de etapa), o cartão das etapas, o selo que separa
 * original, tratada e gerada, e as molduras de foto (proporção pelo
 * padding-bottom, sem a proporção nativa do CSS, que o Safari 11 não tem).
 *
 * Regra da fotografia: nada escurece a foto para dar destaque. Selos ficam
 * em pílulas claras no canto ou embaixo da imagem, nunca em véu escuro.
 */

/**
 * Todas as telas da Mesa Foto (o valor vai no endereço: ?etapa=...). A
 * navegação mostra só o caminho principal em 3 passos (1 Fotos, 2 Criar,
 * 3 Usar) e, discretas ao lado, as ferramentas de apoio (Biblioteca, Modelos
 * e Canvas). O produto (kit) é identificado dentro de Fotos; Variações,
 * Campanha e Preparar ficam dentro de Criar; Revisar fica dentro do resultado
 * e de Usar (a tela de comparação segue em ?etapa=revisar).
 */
export const ETAPAS_DA_MESA_FOTO = [
  { valor: "acervo", rotulo: "Fotos" },
  { valor: "kits", rotulo: "Produto" },
  { valor: "criar", rotulo: "Criar" },
  { valor: "ensaio", rotulo: "Variações" },
  { valor: "campanha", rotulo: "Campanha" },
  { valor: "preparar", rotulo: "Preparar" },
  { valor: "revisar", rotulo: "Revisar" },
  { valor: "usar", rotulo: "Usar" },
  { valor: "biblioteca", rotulo: "Biblioteca" },
  { valor: "modelos", rotulo: "Modelos" },
  { valor: "clones", rotulo: "Clones" },
  { valor: "book", rotulo: "Book" },
  { valor: "canvas", rotulo: "Canvas" },
] as const;

export type EtapaDaMesaFoto = (typeof ETAPAS_DA_MESA_FOTO)[number]["valor"];

/**
 * O caminho principal (pedido do dono, 25/09: "não tem um processo mais
 * simples"): 1. Fotos do produto (com o produto identificado ali mesmo),
 * 2. Criar, 3. Usar (revisar e levar para a Mesa, a Mesa Ads, baixar ou
 * mandar ao cliente).
 */
export const PASSOS_PRINCIPAIS: { passo: number; etapa: EtapaDaMesaFoto; rotulo: string; dica: string; inclui: EtapaDaMesaFoto[] }[] = [
  { passo: 1, etapa: "acervo", rotulo: "Fotos", dica: "Fotos do produto e o produto identificado", inclui: ["acervo", "kits"] },
  { passo: 2, etapa: "criar", rotulo: "Criar", dica: "Variações, campanha ou ajuste de uma foto", inclui: ["criar", "ensaio", "campanha", "preparar"] },
  { passo: 3, etapa: "usar", rotulo: "Usar", dica: "Revisar e usar: Mesa, Mesa Ads, baixar ou aprovação", inclui: ["usar", "revisar"] },
];

/** Ferramentas de apoio: à mão, discretas, sem disputar com o caminho principal. */
export const ETAPAS_DE_APOIO: { etapa: EtapaDaMesaFoto; rotulo: string }[] = [
  { etapa: "biblioteca", rotulo: "Biblioteca" },
  { etapa: "modelos", rotulo: "Modelos" },
  { etapa: "clones", rotulo: "Clones" },
  // Estúdio do book (26/09): produto ou pessoa, arsenal de prompts, diretor, seleção e book final.
  { etapa: "book", rotulo: "Book" },
  { etapa: "canvas", rotulo: "Canvas" },
];

/**
 * Abas de Modelos e Canvas (docs/mesa-foto/MODELOS-E-CANVAS.md): hoje são
 * ferramentas de apoio (ETAPAS_DE_APOIO). Aba com disponivel false some da
 * navegação.
 */
export const ABAS_FUTURAS: { etapa: string; rotulo: string; disponivel: boolean; depoisDe: string }[] = [
  // docs/mesa-foto/MODELOS-E-CANVAS.md: Modelos depois do Produto, Canvas depois de Criar.
  { etapa: "modelos", rotulo: "Modelos", disponivel: true, depoisDe: "kits" },
  // Clones de pessoa real com autorização (25/09; docs/mesa-foto/CLONES.md).
  { etapa: "clones", rotulo: "Clones", disponivel: true, depoisDe: "modelos" },
  // Book (26/09): precisa da migration 05 (foto_books); sem ela, a aba avisa e o resto segue.
  { etapa: "book", rotulo: "Book", disponivel: true, depoisDe: "clones" },
  { etapa: "canvas", rotulo: "Canvas", disponivel: true, depoisDe: "criar" },
];

/** As três formas de criar (passo 3). */
export const FORMAS_DE_CRIAR: { etapa: EtapaDaMesaFoto; rotulo: string; dica: string }[] = [
  { etapa: "ensaio", rotulo: "Variações", dica: "Várias fotos do produto: fundo de cor, lifestyle, na mão, flat lay, macro." },
  { etapa: "campanha", rotulo: "Campanha", dica: "Modelo sintético usando o produto, com a pegada da marca." },
  { etapa: "preparar", rotulo: "Preparar", dica: "Ajuste fino de uma foto: fundo branco, luz, cenário." },
];

export const passoDaEtapa = (etapa: string) => PASSOS_PRINCIPAIS.find((p) => (p.inclui as string[]).indexOf(etapa) >= 0) || null;

export interface MesaFotoValor {
  kitId: string | null;
  ensaioId: string | null;
  imagemId: string | null;
  escolherKit: (id: string | null) => void;
  escolherEnsaio: (id: string | null) => void;
  /** Troca de etapa levando junto o que for preciso (imagem, kit, ensaio). */
  irPara: (etapa: EtapaDaMesaFoto, extras?: { imagem?: string | null; kit?: string | null; ensaio?: string | null }) => void;
  selecionadas: string[];
  setSelecionadas: (ids: string[]) => void;
  abrirAgente: () => void;
  /** A etapa aberta (para a navegação de dentro de Criar). */
  etapa?: string;
  /** O próximo passo do caminho principal, sempre em destaque. */
  proximo?: ProximoPasso | null;
  /** Abre o diretor já com um pedido (atalhos das etapas). */
  pedirAoDiretor?: (mensagem: string) => void;
}

const Contexto = createContext<MesaFotoValor | null>(null);

export function MesaFotoProvider({ valor, children }: { valor: MesaFotoValor; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

const SEM_PAGINA: MesaFotoValor = {
  kitId: null,
  ensaioId: null,
  imagemId: null,
  escolherKit: () => undefined,
  escolherEnsaio: () => undefined,
  irPara: () => undefined,
  selecionadas: [],
  setSelecionadas: () => undefined,
  abrirAgente: () => undefined,
};

/** Fora da página (testes de uma etapa sozinha), vale um contexto neutro. */
export function useMesaFoto(): MesaFotoValor {
  return useContext(Contexto) || SEM_PAGINA;
}

/** Cartão das etapas: título pequeno em caixa alta, ação à direita, corpo livre. */
export function Cartao({
  titulo,
  dica,
  acao,
  children,
  className = "",
}: {
  titulo: ReactNode;
  dica?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-border bg-card p-4 ${className}`}>
      <div className="mb-3 flex min-w-0 flex-wrap items-start">
        <div className="mr-2 min-w-0 flex-1">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{titulo}</h3>
          {dica && <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{dica}</p>}
        </div>
        {acao && <div className="flex min-w-0 max-w-full flex-wrap items-center">{acao}</div>}
      </div>
      {children}
    </section>
  );
}

/** Pílula da classe da foto. Gerada sempre aparece: é imagem sintética. */
export function SeloDaFoto({
  foto,
  compacto = false,
}: {
  foto: Pick<FotoDoAcervo, "gerada" | "derivada_de" | "modo" | "aprovada"> & { referencia_web?: boolean; tags?: string[] };
  compacto?: boolean;
}) {
  const classe = classeDaFoto(foto);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center">
      {foto.referencia_web && (
        <span
          className="mb-0.5 mr-1 inline-flex items-center rounded-full border border-warning/50 bg-card px-1.5 py-px text-[10px] font-semibold text-warning"
          title="Referência da internet: uso interno para fidelidade, não publicar"
          data-selo="internet"
        >
          <Globe className="mr-0.5 h-2.5 w-2.5" /> {compacto ? "internet" : "da internet, uso interno"}
        </span>
      )}
      {classe === "gerada" && (
        <span
          className="mb-0.5 mr-1 inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[10px] font-semibold text-primary"
          title="Imagem gerada por IA: pode ter partes que não existem nas fotos originais"
          data-selo="gerada"
        >
          <Sparkles className="mr-0.5 h-2.5 w-2.5" /> gerada
        </span>
      )}
      {classe === "derivada" && (
        <span className="mb-0.5 mr-1 rounded-full border border-border bg-card px-1.5 py-px text-[10px] font-medium text-foreground" data-selo="derivada">
          {foto.tags && (foto.tags.indexOf("sem_fundo") >= 0 || foto.tags.indexOf("preparo:fundo_transparente") >= 0) ? "sem fundo" : "tratada"}
          {!compacto && foto.modo && !(foto.tags && foto.tags.indexOf("sem_fundo") >= 0) ? ` · ${rotuloDoModo(foto.modo)}` : ""}
        </span>
      )}
      {classe === "original" && !compacto && !foto.referencia_web && (
        <span className="mb-0.5 mr-1 rounded-full border border-border bg-card px-1.5 py-px text-[10px] text-muted-foreground" data-selo="original">
          original
        </span>
      )}
      {foto.aprovada && (
        <span className="mb-0.5 mr-1 inline-flex items-center rounded-full border border-success/40 bg-card px-1.5 py-px text-[10px] font-medium text-success" data-selo="aprovada">
          <Check className="mr-0.5 h-2.5 w-2.5" /> aprovada
        </span>
      )}
    </span>
  );
}

/**
 * Selo simples da foto na grade, embaixo da miniatura (a pílula "gerada" fica
 * sempre no canto da imagem): aprovada, a aprovar (gerada sem decisão),
 * tratada ou original; referência da internet sempre avisa.
 */
export function SeloCurto({ foto }: { foto: Pick<FotoDoAcervo, "gerada" | "derivada_de" | "modo" | "aprovada"> & { referencia_web?: boolean; tags?: string[] } }) {
  const classe = classeDaFoto(foto);
  if (foto.referencia_web) {
    return (
      <span className="mb-1 inline-flex items-center rounded-full border border-warning/50 bg-card px-1.5 py-px text-[10px] font-semibold text-warning" data-selo-curto="internet" title="Referência da internet: uso interno, não publicar">
        <Globe className="mr-0.5 h-2.5 w-2.5" /> uso interno
      </span>
    );
  }
  if (foto.aprovada) {
    return (
      <span className="mb-1 inline-flex items-center rounded-full border border-success/40 bg-card px-1.5 py-px text-[10px] font-medium text-success" data-selo-curto="aprovada">
        <Check className="mr-0.5 h-2.5 w-2.5" /> aprovada
      </span>
    );
  }
  if (classe === "gerada") {
    return (
      <span className="mb-1 inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[10px] font-medium text-primary" data-selo-curto="a-aprovar" title="Gerada por IA, esperando a aprovação da equipe">
        a aprovar
      </span>
    );
  }
  return (
    <span className="mb-1 inline-flex items-center rounded-full border border-border bg-card px-1.5 py-px text-[10px] text-muted-foreground" data-selo-curto={classe}>
      {classe === "derivada" ? (foto.tags && foto.tags.indexOf("sem_fundo") >= 0 ? "sem fundo" : "tratada") : "original"}
    </span>
  );
}

/** Moldura com a proporção dada (largura/altura), por padding-bottom. */
export function Moldura({ proporcao, children, className = "" }: { proporcao: number; children: ReactNode; className?: string }) {
  const p = proporcao > 0 && isFinite(proporcao) ? proporcao : 1;
  return (
    <div className={`relative w-full overflow-hidden rounded-lg bg-muted ${className}`} style={{ paddingBottom: `${Math.round((100 / p) * 100) / 100}%` }}>
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}

/** Miniatura quadrada leve (Storage reduzido), com o selo no canto em pílula clara. */
export function MiniaturaDaFoto({ foto, selo = true, className = "" }: { foto: FotoDoAcervo; selo?: boolean; className?: string }) {
  return (
    <Moldura proporcao={1} className={className}>
      <MiniaturaDoStorage bucket={foto.storage_bucket || "mesa"} caminho={foto.storage_path} alt={foto.nome} className="h-full w-full" />
      {selo && (classeDaFoto(foto) === "gerada" || foto.referencia_web) && (
        <span className="pointer-events-none absolute left-1 top-1">
          <SeloDaFoto foto={{ ...foto, aprovada: false }} compacto />
        </span>
      )}
    </Moldura>
  );
}

/** A foto inteira, na proporção real, sem corte. */
export function FotoInteira({ foto, className = "" }: { foto: FotoDoAcervo; className?: string }) {
  return (
    <Moldura proporcao={proporcaoDaFoto(foto)} className={`border border-border ${className}`}>
      <ImagemDaMesa caminho={foto.storage_path} bucket={foto.storage_bucket || "mesa"} alt={foto.nome} className="h-full w-full !object-contain" />
    </Moldura>
  );
}

/** Lista curta de textos com rótulo (observado, invariantes, lacunas). */
export function ListaCurta({ titulo, itens, vazio, tom = "normal" }: { titulo: string; itens: string[]; vazio?: string; tom?: "normal" | "alerta" }) {
  return (
    <div className="min-w-0">
      <p className={`text-[11px] font-medium ${tom === "alerta" ? "text-warning" : "text-muted-foreground"}`}>{titulo}</p>
      {itens.length ? (
        <ul className="mt-1 space-y-0.5">
          {itens.map((t) => (
            <li key={t} className="text-[12px] leading-snug [overflow-wrap:anywhere]">
              {t}
            </li>
          ))}
        </ul>
      ) : (
        vazio && <p className="mt-1 text-[11.5px] text-muted-foreground">{vazio}</p>
      )}
    </div>
  );
}

/** Estado vazio de uma etapa: frase curta e o próximo passo. */
export function Vazio({ titulo, children, acao }: { titulo: string; children?: ReactNode; acao?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
      <p className="text-[13.5px] font-medium">{titulo}</p>
      {children && <div className="mx-auto mt-1 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">{children}</div>}
      {acao && <div className="mt-3 flex flex-wrap items-center justify-center">{acao}</div>}
    </div>
  );
}

/** Grupo de botões em forma de pílula (presets, filtros). */
export function Pilulas<T extends string | number>({
  opcoes,
  valor,
  onEscolher,
  rotulo,
  className = "",
}: {
  opcoes: { valor: T; rotulo: string; dica?: string }[];
  valor: NoInfer<T> | null;
  onEscolher: (v: NoInfer<T>) => void;
  rotulo: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={`flex min-w-0 flex-wrap ${className}`}>
      {opcoes.map((o) => (
        <button
          key={String(o.valor)}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          title={o.dica}
          onClick={() => onEscolher(o.valor)}
          className={`mb-1.5 mr-1.5 h-7 max-w-full truncate rounded-full border px-2.5 text-[12px] transition-colors ${
            valor === o.valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary/50"
          }`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/**
 * Dentro do passo 3 (Criar): as três formas lado a lado, para trocar sem
 * voltar. Variações, Campanha e Preparar usam o mesmo produto (kit) aberto.
 */
export function NavDoCriar({ atual }: { atual: EtapaDaMesaFoto }) {
  const { irPara } = useMesaFoto();
  return (
    <nav aria-label="Formas de criar" className="mb-3 flex min-w-0 flex-wrap items-center" data-nav-do-criar="">
      <button type="button" onClick={() => irPara("criar")} className="mb-1 mr-2 h-7 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
        Criar
      </button>
      <span aria-hidden="true" className="mb-1 mr-2 text-[11px] text-muted-foreground/60">/</span>
      <div className="mb-1 grid min-w-0 grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5">
        {FORMAS_DE_CRIAR.map((f) => (
          <button
            key={f.etapa}
            type="button"
            onClick={() => irPara(f.etapa)}
            aria-current={atual === f.etapa ? "page" : undefined}
            title={f.dica}
            className={`min-w-0 truncate rounded-md px-2.5 py-1 text-[12px] font-medium ${atual === f.etapa ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>
    </nav>
  );
}
