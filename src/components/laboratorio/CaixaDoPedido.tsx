import { forwardRef, useState, type ReactNode } from "react";
import { ArrowUp, Brush, ChevronDown, Clapperboard, CreditCard, Globe, Images, ListChecks, Loader2, Megaphone, Presentation, Rocket, Route, ShoppingBag, Sparkles, SquarePen, Store, type LucideIcon } from "lucide-react";
import { botao, campoTexto, juntar, superficie } from "@/components/sistema";
import { ATALHOS_DE_PROJETO_COMPLETO } from "@/lib/laboratorio/nos";
import { CirculoDoIcone, pastelDe } from "./visual";
import { SeletorDeCliente, SeletorDeModelo, type ClienteDoLab } from "./Seletores";

/**
 * A caixa de pedido do Laboratório: a mesma na Início e no Canvas Studio
 * (barra fixa no topo do canvas). Modelo, cliente, atalhos em ícone (nome no
 * title) e enviar. Os atalhos só preenchem o pedido; os de projeto (low
 * ticket, funil, empresa) pedem o projeto inteiro, de Pesquisa a Pôr no ar.
 */

export interface AtalhoDoPedido {
  id: string;
  rotulo: string;
  icone: LucideIcon;
  pedido: string;
  /** Uma linha sobre o que sai dali (lista do painel lateral do canvas). */
  dica?: string;
}

const A: Record<string, AtalhoDoPedido> = {
  low_ticket: { id: "low_ticket", dica: "Da pesquisa ao anúncio no ar", rotulo: "Produto low ticket", icone: ShoppingBag, pedido: "Quero montar um produto low ticket do zero (pesquisa, oferta, funil, página, criativos, anúncio e pôr no ar) sobre " },
  funil: { id: "funil", dica: "Páginas, mensagens e anúncios", rotulo: "Funil de vendas", icone: Route, pedido: "Quero um funil de vendas completo (pesquisa, oferta, páginas, mensagens, criativos, anúncios e pôr no ar) para " },
  empresa: { id: "empresa", dica: "Posicionamento, logo e landing", rotulo: "Montar empresa", icone: Store, pedido: "Quero montar uma empresa do zero (pesquisa, posicionamento, logo, landing, post de lançamento e pôr no ar): " },
  carrossel: { id: "carrossel", dica: "5 lâminas com a copy", rotulo: "Carrossel", icone: Images, pedido: "Quero criar um carrossel de 5 lâminas sobre " },
  criativos: { id: "criativos", dica: "4 artes de anúncio", rotulo: "Criativos", icone: Sparkles, pedido: "Quero 4 criativos de anúncio para " },
  logo: { id: "logo", dica: "Variações para a marca", rotulo: "Logo", icone: Brush, pedido: "Quero uma logo para a marca " },
  landing: { id: "landing", dica: "Página pronta para publicar", rotulo: "Landing page", icone: Globe, pedido: "Quero uma landing page para " },
  post: { id: "post", dica: "Arte com legenda", rotulo: "Post", icone: SquarePen, pedido: "Quero um post com legenda sobre " },
  anuncio: { id: "anuncio", dica: "Títulos, texto e público", rotulo: "Anúncio", icone: Megaphone, pedido: "Quero um pacote de anúncio (títulos, texto e público) para " },
  filme: { id: "filme", dica: "Filme cinematográfico da marca", rotulo: "Filme", icone: Clapperboard, pedido: "Quero o filme cinematográfico da marca " },
  // v4 (ESPEC-LABORATORIO-v4.md): projetos completos de funil de verdade (planejar no modo projeto_completo).
  webinar: { id: "webinar", dica: "Inscrição, sala e lembretes", rotulo: "Webinar", icone: Presentation, pedido: "Quero um webinar completo (produto, oferta, inscrição, sala com a oferta no minuto, lembretes por e-mail, checkout e pôr no ar) sobre " },
  quiz: { id: "quiz", dica: "Perguntas com pontuação e CRM", rotulo: "Quiz de qualificação", icone: ListChecks, pedido: "Quero um funil com quiz de qualificação (perguntas com pontuação, faixa alta para agendar, faixa baixa para a isca, CRM e e-mails) para " },
  lancamento: { id: "lancamento", dica: "Aquecimento, CPLs e carrinho", rotulo: "Lançamento", icone: Rocket, pedido: "Quero montar um lançamento (aquecimento, captura, CPLs por e-mail e WhatsApp, carrinho aberto, checkout e recuperação) de " },
  checkout_upsell: { id: "checkout_upsell", dica: "Order bump, upsell e recuperação", rotulo: "Checkout com upsell", icone: CreditCard, pedido: "Quero um funil com checkout com upsell (página de vendas, checkout com order bump, upsell de 1 clique, downsell, obrigado e recuperação do carrinho) para " },
};

/** Início: os de projeto primeiro, depois as peças avulsas. */
export const ATALHOS_DA_INICIO: AtalhoDoPedido[] = [A.low_ticket, A.funil, A.empresa, A.webinar, A.quiz, A.lancamento, A.checkout_upsell, A.carrossel, A.criativos, A.logo, A.landing, A.post, A.anuncio, A.filme];
/** Canvas Studio (pedido do dono): Produto low ticket, Funil de vendas, Montar empresa, Carrossel, Landing, Filme; v4: Webinar, Quiz, Lançamento e Checkout com upsell. */
export const ATALHOS_DO_CANVAS: AtalhoDoPedido[] = [A.low_ticket, A.funil, A.empresa, A.webinar, A.quiz, A.lancamento, A.checkout_upsell, A.carrossel, A.landing, A.filme];

interface Props {
  valor: string;
  onMudar: (v: string) => void;
  onEnviar: () => void;
  enviando: boolean;
  modelo: string;
  onModelo: (v: string) => void;
  clienteId: string | null;
  onCliente: (id: string | null) => void;
  clientes: ClienteDoLab[];
  atalhos: AtalhoDoPedido[];
  onAtalho: (a: AtalhoDoPedido) => void;
  /** aria-label da caixa (cada lugar tem o seu nome). */
  rotulo: string;
  placeholder: string;
  tituloDoEnviar: string;
  /** Canvas Studio: mais baixa, atalhos na mesma linha dos seletores. */
  compacta?: boolean;
  /** Painel lateral do canvas (computador): caixa alta dentro do painel e os atalhos em lista, com nome e o que fazem. */
  painel?: boolean;
  /** Algo a mais na linha de baixo (ex.: Desfazer a construção). */
  extra?: ReactNode;
}

/**
 * Início (passada estrutural, 15/11/2026): à vista só os cinco atalhos mais usados numa linha; o resto fica
 * atrás da pílula "Mais", que abre ali mesmo (nenhum atalho some, só recolhe).
 */
const PRINCIPAIS_DA_INICIO = ["low_ticket", "funil", "empresa", "carrossel", "criativos"];

const CaixaDoPedido = forwardRef<HTMLTextAreaElement, Props>(function CaixaDoPedido(p, ref) {
  const [todos, setTodos] = useState(false);
  const principais = p.atalhos.filter((a) => PRINCIPAIS_DA_INICIO.indexOf(a.id) >= 0);
  const recolhidos = principais.length ? p.atalhos.filter((a) => PRINCIPAIS_DA_INICIO.indexOf(a.id) < 0) : [];
  const daInicio = todos || !recolhidos.length ? p.atalhos : principais;
  // Canvas Studio (compacta): ícones em fila, o nome no title. Início (v4, 15/11/2026): cada atalho é uma
  // pílula com o ícone em círculo e o NOME à vista (antes era só o ícone e ninguém sabia o que era); os de
  // projeto completo levam o círculo de tinta. No celular a fila rola de lado por dentro, numa linha só.
  const atalhos = p.painel ? (
    // Como o painel direito das referências: cada item é um círculo com o ícone, o nome e uma linha do que faz.
    <div className="mt-4 min-w-0" role="group" aria-label="Atalhos do Canvas Studio">
      <p className="mb-1 px-1 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-muted-foreground" aria-hidden="true">Começar por</p>
      {p.atalhos.map((a) => {
        const I = a.icone;
        const completo = ATALHOS_DE_PROJETO_COMPLETO.indexOf(a.id) >= 0;
        return (
          <button key={a.id} type="button" className="flex w-full min-w-0 items-center rounded-[18px] px-1.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={a.rotulo} title={completo ? `${a.rotulo}: projeto completo, do zero até pôr no ar` : a.rotulo} data-atalho={a.id} onClick={() => p.onAtalho(a)}>
            <CirculoDoIcone tamanho="md" tinta={completo} cor={completo ? undefined : pastelDe(a.id)} className="mr-3">
              <I className="h-4 w-4" />
            </CirculoDoIcone>
            <span className="min-w-0 flex-1" aria-hidden="true">
              <span className="block truncate text-[13px] font-semibold leading-[18px] text-foreground">{a.rotulo}</span>
              {a.dica ? <span className="block truncate text-[11px] leading-4 text-muted-foreground">{a.dica}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  ) : p.compacta ? (
    <div className="scrollbar-hidden flex min-w-0 items-center overflow-x-auto overscroll-x-contain max-sm:w-full sm:flex-wrap sm:overflow-visible" role="group" aria-label="Atalhos do Canvas Studio">
      {p.atalhos.map((a) => {
        const I = a.icone;
        return (
          <button key={a.id} type="button" className={juntar(botao.icone, "h-8 w-8")} aria-label={a.rotulo} title={a.rotulo} data-atalho={a.id} onClick={() => p.onAtalho(a)}>
            <I className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  ) : (
    <div className="scrollbar-hidden -mx-1 mt-5 flex min-w-0 items-center overflow-x-auto overscroll-x-contain px-1 pb-1 sm:flex-wrap sm:justify-center sm:overflow-visible" role="group" aria-label="Atalhos do pedido">
      {daInicio.map((a) => {
        const I = a.icone;
        const completo = ATALHOS_DE_PROJETO_COMPLETO.indexOf(a.id) >= 0;
        return (
          <button
            key={a.id}
            type="button"
            className="toque-compacto mb-2 mr-2 inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-full bg-card pl-1 pr-4 text-[13px] font-medium text-foreground shadow-card transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={a.rotulo}
            title={completo ? `${a.rotulo}: projeto completo, do zero até pôr no ar` : a.rotulo}
            data-atalho={a.id}
            onClick={() => p.onAtalho(a)}
          >
            <CirculoDoIcone tamanho="sm" tinta={completo} cor={completo ? undefined : pastelDe(a.id)} className="mr-2">
              <I className="h-4 w-4" />
            </CirculoDoIcone>
            {a.rotulo}
          </button>
        );
      })}
      {recolhidos.length ? (
        <button
          type="button"
          className="toque-compacto mb-2 mr-2 inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={todos}
          onClick={() => setTodos(!todos)}
          data-mais-atalhos=""
        >
          {todos ? "Menos" : `Mais ${recolhidos.length}`}
          <ChevronDown className={juntar("ml-1 h-4 w-4 transition-transform motion-reduce:transition-none", todos ? "rotate-180" : null)} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
  return (
    <form
      className="min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        p.onEnviar();
      }}
    >
      <div className={juntar("min-w-0", p.painel ? "rounded-[22px] bg-muted/60 px-3 py-2.5" : juntar(superficie.painel, p.compacta ? "rounded-[24px] px-3 py-2" : "rounded-[28px] p-4 sm:p-5"))}>
        <textarea
          ref={ref}
          aria-label={p.rotulo}
          rows={p.painel ? 3 : p.compacta ? 1 : undefined}
          className={juntar(campoTexto, "resize-none border-0 bg-transparent px-1 focus-visible:ring-0 focus-visible:ring-offset-0", p.painel ? "min-h-[84px] text-[14px] leading-5" : p.compacta ? "min-h-[36px] text-[14px] placeholder:truncate max-sm:min-h-[52px]" : "min-h-[84px] text-[15px] leading-6")}
          placeholder={p.placeholder}
          value={p.valor}
          onChange={(e) => p.onMudar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              p.onEnviar();
            }
          }}
        />
        {/* Modelo e cliente compactos à esquerda (o resto quebra só ali dentro); enviar sempre na 1ª linha, à direita. */}
        <div className={juntar("flex min-w-0 items-start", p.compacta ? "mt-1" : "mt-2")} data-linha-do-pedido="">
          <div className="flex min-w-0 flex-1 flex-wrap items-center">
            <SeletorDeModelo valor={p.modelo} onMudar={p.onModelo} />
            <span className="mx-0.5" />
            <SeletorDeCliente valor={p.clienteId} onMudar={p.onCliente} clientes={p.clientes} />
            {p.compacta && !p.painel ? <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" aria-hidden="true" /> : null}
            {p.compacta && !p.painel ? atalhos : null}
            {p.extra}
          </div>
          <button type="submit" className={juntar(botao.primario, "ml-2 shrink-0", juntar("bg-foreground px-0 text-background hover:bg-foreground/85", p.compacta ? "h-9 w-9" : "h-11 w-11"))} disabled={p.enviando || !p.valor.trim()} aria-label="Enviar o pedido" title={p.tituloDoEnviar} data-enviar-pedido="">
            {p.enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      {p.compacta && !p.painel ? null : atalhos}
    </form>
  );
});

export default CaixaDoPedido;
