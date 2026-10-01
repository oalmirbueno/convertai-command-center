import { createContext, useContext, type ReactNode } from "react";
import { Check, Globe, Sparkles } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import TituloRecolhivel, { useChaveDeRecolher, useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { juntar } from "@/components/sistema/estilos";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import { classeDaFoto, proporcaoDaFoto, rotuloDoModo, type FotoDoAcervo, type ProximoPasso } from "./fotoApi";
import { objetivoDaEtapa, type ObjetivoDaFoto } from "./linhaDeProducao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";

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
 * navegação mostra a linha de produção em 5 passos (linhaDeProducao.ts):
 * 1 O que fazer, 2 Fotos, 3 Gerar, 4 Aprovar e 5 Usar. Cada etapa antiga
 * mora dentro de um passo; as ferramentas avançadas (Biblioteca, Modelos,
 * Clones, Book e Canvas) ficam em "Mais", fora do caminho.
 *
 * 27/09: Estúdio de fotos (?etapa=estudio&imagem=<id>) e Post na Agenda
 * (?etapa=agenda&task=<id>&trabalho=<id>).
 * 30/09 (frente FTL): "aprovar" (conferir e aprovar num lugar só) e os
 * rótulos em termos simples.
 */
export const ETAPAS_DA_MESA_FOTO = [
  { valor: "acervo", rotulo: "Fotos" },
  { valor: "kits", rotulo: "Produto" },
  { valor: "criar", rotulo: "O que fazer" },
  { valor: "estudio", rotulo: "Estúdio de fotos" },
  { valor: "ensaio", rotulo: "Fotos do produto" },
  { valor: "campanha", rotulo: "Foto com modelo" },
  { valor: "preparar", rotulo: "Tirar fundo e ajustes" },
  { valor: "revisar", rotulo: "Comparar com as fontes" },
  { valor: "aprovar", rotulo: "Aprovar" },
  { valor: "usar", rotulo: "Usar" },
  { valor: "agenda", rotulo: "Post na Agenda" },
  { valor: "biblioteca", rotulo: "Biblioteca" },
  { valor: "modelos", rotulo: "Modelos" },
  { valor: "clones", rotulo: "Clones" },
  { valor: "book", rotulo: "Book" },
  { valor: "canvas", rotulo: "Canvas" },
] as const;

export type EtapaDaMesaFoto = (typeof ETAPAS_DA_MESA_FOTO)[number]["valor"];

/**
 * A linha de produção (frente FTL, 30/09; dono: "a linha de produção das
 * fotos está muito confusa e difícil, facilite"): escolher o que produzir,
 * subir ou escolher as fotos, gerar, conferir e aprovar, usar. O passo 3
 * abre a ferramenta do objetivo escolhido (etapaDeGerar).
 */
export const PASSOS_PRINCIPAIS: { passo: number; etapa: EtapaDaMesaFoto; rotulo: string; dica: string; inclui: EtapaDaMesaFoto[] }[] = [
  { passo: 1, etapa: "criar", rotulo: "O que fazer", dica: "Escolha o que produzir: melhorar uma foto, fotos do produto, foto com modelo, tirar fundo ou post", inclui: ["criar"] },
  { passo: 2, etapa: "acervo", rotulo: "Fotos", dica: "Suba ou marque as fotos; o produto é identificado ali mesmo", inclui: ["acervo", "kits"] },
  { passo: 3, etapa: "estudio", rotulo: "Gerar", dica: "A ferramenta do que você escolheu: Estúdio, fotos do produto, foto com modelo ou ajustes", inclui: ["estudio", "ensaio", "campanha", "preparar"] },
  { passo: 4, etapa: "aprovar", rotulo: "Aprovar", dica: "Confira cada foto gerada e aprove ou refaça", inclui: ["aprovar", "revisar"] },
  { passo: 5, etapa: "usar", rotulo: "Usar", dica: "Post na Agenda para o cliente aprovar, Mesa, Mesa Ads ou baixar", inclui: ["usar", "agenda"] },
];

/** Ferramentas avançadas ("Mais"): à mão, recolhidas, sem disputar com a linha de produção. */
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

/** As ferramentas do passo 3 (Gerar), com o nome simples do que produzem. */
export const FORMAS_DE_CRIAR: { etapa: EtapaDaMesaFoto; rotulo: string; dica: string }[] = [
  { etapa: "estudio", rotulo: "Melhorar uma foto", dica: "Estúdio: uma foto grande e as ferramentas ao lado: luz, cor, fundo, cenário, ângulo, ampliar e o recorte do post." },
  { etapa: "ensaio", rotulo: "Fotos do produto", dica: "Várias fotos do produto: fundo de cor, lifestyle, na mão, flat lay, macro." },
  { etapa: "campanha", rotulo: "Foto com modelo", dica: "Pessoa criada pela IA usando o produto, com a pegada da marca." },
  { etapa: "preparar", rotulo: "Tirar fundo e ajustes", dica: "Ajuste fino de uma foto: fundo branco ou transparente, luz, cenário, áreas protegidas." },
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
  /**
   * Frente FTL: as marcadas que contam para a linha (existem no acervo e podem sair;
   * marcadasQueContam). Fora da página, vale `selecionadas`.
   */
  marcadas?: string[];
  abrirAgente: () => void;
  /** A etapa aberta (para a navegação de dentro de Criar). */
  etapa?: string;
  /** O próximo passo do caminho principal, sempre em destaque. */
  proximo?: ProximoPasso | null;
  /** Abre o diretor já com um pedido (atalhos das etapas). */
  pedirAoDiretor?: (mensagem: string) => void;
  /** Frente MF: abre a foto no Estúdio de fotos (ferramenta opcional já aberta). */
  abrirNoEstudio?: (imagemId: string, ferramenta?: string | null) => void;
  /** Frente MF: leva as fotos para o Post na Agenda (foto única ou carrossel). */
  prepararNaAgenda?: (imagemIds: string[]) => void;
  /** Frente FTL: o que a pessoa escolheu produzir (passo 1), guardado por cliente. */
  objetivo?: ObjetivoDaFoto | null;
  /** Frente FTL: escolhe o objetivo; `ir` leva junto para o passo das Fotos. */
  escolherObjetivo?: (o: ObjetivoDaFoto | null, ir?: boolean) => void;
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

/**
 * Bloco das etapas (sistema de design, docs/design/SISTEMA.md: "nada de caixa
 * dentro de caixa"): título curto numa linha, a explicação no "?" ao lado
 * (AjudaRecolhida), ação na linha do título e o corpo livre. Sem moldura:
 * blocos vizinhos se separam por espaço e por uma linha fina em cima.
 *
 * 28/09 (dono: "tudo recolhe"): todo bloco recolhe. Com `recolher` o título
 * vira o botão (a chave é da tela, com o cliente); sem ela, título em texto
 * ganha a chave automática do sistema (rota, cliente e título) e uma setinha
 * pequena antes do título. `recolher={false}` desliga (bloco que não pode sumir).
 */
export function Cartao({
  titulo,
  dica,
  acao,
  children,
  className = "",
  recolher,
  resumo,
  recolhidoDeInicio = false,
}: {
  titulo: ReactNode;
  /** Explicação longa: vai para o "?" ao lado do título. */
  dica?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Chave para lembrar se o bloco está recolhido; `false` não recolhe. Sem ela, título em texto recolhe pela chave automática. */
  recolher?: string | false;
  /** Linha curta que fica à vista com o bloco recolhido. */
  resumo?: ReactNode;
  /** Começa recolhido enquanto a pessoa não escolheu (bloco claramente secundário). */
  recolhidoDeInicio?: boolean;
}) {
  const chaveAutomatica = useChaveDeRecolher(titulo, recolher === false ? false : undefined);
  if (recolher) {
    return (
      <CartaoRecolhivel titulo={titulo} dica={dica} acao={acao} className={className} chave={recolher} resumo={resumo} inicial={recolhidoDeInicio}>
        {children}
      </CartaoRecolhivel>
    );
  }
  if (chaveAutomatica) {
    return (
      <CartaoComSetinha titulo={titulo} dica={dica} acao={acao} className={className} chave={chaveAutomatica} resumo={resumo} inicial={recolhidoDeInicio}>
        {children}
      </CartaoComSetinha>
    );
  }
  return (
    <section className={juntar(BLOCO, className)} data-bloco-da-etapa="">
      <CabecalhoDeSecao className="mb-2.5" nivel={3} titulo={titulo} ajuda={dica} acao={acao} />
      {children}
    </section>
  );
}

const BLOCO = "min-w-0 border-t border-border pt-4 first:border-t-0 first:pt-0";

/** Bloco com a chave automática: setinha "Recolher"/"Mostrar" antes do título (o título não vira botão). */
function CartaoComSetinha({
  titulo,
  dica,
  acao,
  children,
  className,
  chave,
  resumo,
  inicial,
}: {
  titulo: ReactNode;
  dica?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className: string;
  chave: string;
  resumo?: ReactNode;
  inicial: boolean;
}) {
  const [recolhido, setRecolhido] = useRecolhido(chave, inicial);
  return (
    <section className={juntar(BLOCO, className)} data-bloco-da-etapa="" data-recolhido={recolhido ? "sim" : "nao"}>
      <CabecalhoDeSecao
        className={recolhido ? "" : "mb-2.5"}
        nivel={3}
        titulo={titulo}
        ajuda={dica}
        acao={acao}
        recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo, modo: "icone" }}
      />
      {!recolhido && children}
    </section>
  );
}

function CartaoRecolhivel({
  titulo,
  dica,
  acao,
  children,
  className,
  chave,
  resumo,
  inicial,
}: {
  titulo: ReactNode;
  dica?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className: string;
  chave: string;
  resumo?: ReactNode;
  inicial: boolean;
}) {
  const [recolhido, setRecolhido] = useRecolhido(chave, inicial);
  return (
    <section className={juntar(BLOCO, className)} data-bloco-da-etapa="" data-recolhido={recolhido ? "sim" : "nao"}>
      <div className={juntar("flex min-w-0 flex-wrap items-center justify-between", recolhido ? "" : "mb-2.5")}>
        <div className="mr-2 flex min-w-0 flex-1 items-center">
          {/* O título continua heading (h3), como no Cartao sem recolher: quem navega por títulos acha o bloco. */}
          <h3 className="min-w-0">
            <TituloRecolhivel titulo={titulo} recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={resumo} />
          </h3>
          {dica && !recolhido && <AjudaRecolhida className="ml-1.5">{dica}</AjudaRecolhida>}
        </div>
        {acao && <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end">{acao}</div>}
      </div>
      {!recolhido && children}
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
          className="mb-0.5 mr-1 inline-flex items-center rounded-full border border-warning/50 bg-card px-1.5 py-px text-[11px] font-semibold text-warning"
          title="Referência da internet: uso interno para fidelidade, não publicar"
          data-selo="internet"
        >
          <Globe className="mr-0.5 h-2.5 w-2.5" /> {compacto ? "internet" : "da internet, uso interno"}
        </span>
      )}
      {classe === "gerada" && (
        <span
          className="mb-0.5 mr-1 inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[11px] font-semibold text-primary"
          title="Imagem gerada por IA: pode ter partes que não existem nas fotos originais"
          data-selo="gerada"
        >
          <Sparkles className="mr-0.5 h-2.5 w-2.5" /> gerada
        </span>
      )}
      {classe === "derivada" && (
        <span className="mb-0.5 mr-1 rounded-full border border-border bg-card px-1.5 py-px text-[11px] font-medium text-foreground" data-selo="derivada">
          {foto.tags && (foto.tags.indexOf("sem_fundo") >= 0 || foto.tags.indexOf("preparo:fundo_transparente") >= 0) ? "sem fundo" : "tratada"}
          {!compacto && foto.modo && !(foto.tags && foto.tags.indexOf("sem_fundo") >= 0) ? ` · ${rotuloDoModo(foto.modo)}` : ""}
        </span>
      )}
      {classe === "original" && !compacto && !foto.referencia_web && (
        <span className="mb-0.5 mr-1 rounded-full border border-border bg-card px-1.5 py-px text-[11px] text-muted-foreground" data-selo="original">
          original
        </span>
      )}
      {foto.aprovada && (
        <span className="mb-0.5 mr-1 inline-flex items-center rounded-full border border-success/40 bg-card px-1.5 py-px text-[11px] font-medium text-success" data-selo="aprovada">
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
      <span className="mb-1 inline-flex items-center rounded-full border border-warning/50 bg-card px-1.5 py-px text-[11px] font-semibold text-warning" data-selo-curto="internet" title="Referência da internet: uso interno, não publicar">
        <Globe className="mr-0.5 h-2.5 w-2.5" /> uso interno
      </span>
    );
  }
  if (foto.aprovada) {
    return (
      <span className="mb-1 inline-flex items-center rounded-full border border-success/40 bg-card px-1.5 py-px text-[11px] font-medium text-success" data-selo-curto="aprovada">
        <Check className="mr-0.5 h-2.5 w-2.5" /> aprovada
      </span>
    );
  }
  if (classe === "gerada") {
    return (
      <span className="mb-1 inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[11px] font-medium text-primary" data-selo-curto="a-aprovar" title="Gerada por IA, esperando a aprovação da equipe">
        a aprovar
      </span>
    );
  }
  return (
    <span className="mb-1 inline-flex items-center rounded-full border border-border bg-card px-1.5 py-px text-[11px] text-muted-foreground" data-selo-curto={classe}>
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
        vazio && <p className="mt-1 text-[12px] text-muted-foreground">{vazio}</p>
      )}
    </div>
  );
}

/** Estado vazio de uma etapa (EstadoVazio do sistema): frase curta, uma linha e o próximo passo. */
export function Vazio({ titulo, children, acao, icone }: { titulo: string; children?: ReactNode; acao?: ReactNode; icone?: ReactNode }) {
  return (
    <EstadoVazio
      className="py-8"
      icone={icone}
      titulo={titulo}
      descricao={children ? <span className="block [overflow-wrap:anywhere]">{children}</span> : undefined}
      acao={acao ? <div className="flex flex-wrap items-center justify-center">{acao}</div> : undefined}
    />
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
 * Dentro do passo 3 (Gerar): a ferramenta aberta num seletor só, com o nome
 * simples do que ela produz (antes eram 4 abas com o nome da ferramenta).
 * Trocar aqui troca também o objetivo guardado.
 */
export function NavDoCriar({ atual, className = "" }: { atual: EtapaDaMesaFoto; className?: string }) {
  const { irPara, escolherObjetivo } = useMesaFoto();
  // 28/09 (dono: "seletor pequeno não ganha linha própria"): mora na barra do kit e do ensaio, no cabeçalho da mesa.
  return (
    <nav aria-label="Formas de criar" className={juntar("flex min-w-0 flex-wrap items-center", className)} data-nav-do-criar="">
      <SeletorCompacto
        modo="lista"
        rotulo="Gerando"
        opcoes={FORMAS_DE_CRIAR.map((f) => ({ valor: f.etapa, rotulo: f.rotulo, descricao: f.dica }))}
        valor={atual}
        onEscolher={(v) => {
          const o = objetivoDaEtapa(v);
          if (o && escolherObjetivo) escolherObjetivo(o);
          irPara(v as EtapaDaMesaFoto);
        }}
        className="h-7 text-[12px]"
      />
    </nav>
  );
}
