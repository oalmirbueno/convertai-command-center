import { forwardRef, type ReactNode } from "react";
import { ArrowUp, Brush, Clapperboard, CreditCard, Globe, Images, ListChecks, Loader2, Megaphone, Presentation, Rocket, Route, ShoppingBag, Sparkles, SquarePen, Store, type LucideIcon } from "lucide-react";
import { botao, campoTexto, juntar, superficie } from "@/components/sistema";
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
}

const A: Record<string, AtalhoDoPedido> = {
  low_ticket: { id: "low_ticket", rotulo: "Produto low ticket", icone: ShoppingBag, pedido: "Quero montar um produto low ticket do zero (pesquisa, oferta, funil, página, criativos, anúncio e pôr no ar) sobre " },
  funil: { id: "funil", rotulo: "Funil de vendas", icone: Route, pedido: "Quero um funil de vendas completo (pesquisa, oferta, páginas, mensagens, criativos, anúncios e pôr no ar) para " },
  empresa: { id: "empresa", rotulo: "Montar empresa", icone: Store, pedido: "Quero montar uma empresa do zero (pesquisa, posicionamento, logo, landing, post de lançamento e pôr no ar): " },
  carrossel: { id: "carrossel", rotulo: "Carrossel", icone: Images, pedido: "Quero criar um carrossel de 5 lâminas sobre " },
  criativos: { id: "criativos", rotulo: "Criativos", icone: Sparkles, pedido: "Quero 4 criativos de anúncio para " },
  logo: { id: "logo", rotulo: "Logo", icone: Brush, pedido: "Quero uma logo para a marca " },
  landing: { id: "landing", rotulo: "Landing page", icone: Globe, pedido: "Quero uma landing page para " },
  post: { id: "post", rotulo: "Post", icone: SquarePen, pedido: "Quero um post com legenda sobre " },
  anuncio: { id: "anuncio", rotulo: "Anúncio", icone: Megaphone, pedido: "Quero um pacote de anúncio (títulos, texto e público) para " },
  filme: { id: "filme", rotulo: "Filme", icone: Clapperboard, pedido: "Quero o filme cinematográfico da marca " },
  // v4 (ESPEC-LABORATORIO-v4.md): projetos completos de funil de verdade (planejar no modo projeto_completo).
  webinar: { id: "webinar", rotulo: "Webinar", icone: Presentation, pedido: "Quero um webinar completo (produto, oferta, inscrição, sala com a oferta no minuto, lembretes por e-mail, checkout e pôr no ar) sobre " },
  quiz: { id: "quiz", rotulo: "Quiz de qualificação", icone: ListChecks, pedido: "Quero um funil com quiz de qualificação (perguntas com pontuação, faixa alta para agendar, faixa baixa para a isca, CRM e e-mails) para " },
  lancamento: { id: "lancamento", rotulo: "Lançamento", icone: Rocket, pedido: "Quero montar um lançamento (aquecimento, captura, CPLs por e-mail e WhatsApp, carrinho aberto, checkout e recuperação) de " },
  checkout_upsell: { id: "checkout_upsell", rotulo: "Checkout com upsell", icone: CreditCard, pedido: "Quero um funil com checkout com upsell (página de vendas, checkout com order bump, upsell de 1 clique, downsell, obrigado e recuperação do carrinho) para " },
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
  /** Algo a mais na linha de baixo (ex.: Desfazer a construção). */
  extra?: ReactNode;
}

const CaixaDoPedido = forwardRef<HTMLTextAreaElement, Props>(function CaixaDoPedido(p, ref) {
  const atalhos = (
    <div className={juntar("flex min-w-0 flex-wrap", p.compacta ? "items-center" : "mt-2 justify-center")} role="group" aria-label={p.compacta ? "Atalhos do Canvas Studio" : "Atalhos do pedido"}>
      {p.atalhos.map((a) => {
        const I = a.icone;
        return (
          <button key={a.id} type="button" className={juntar(botao.icone, p.compacta ? "h-8 w-8" : "m-0.5")} aria-label={a.rotulo} title={a.rotulo} data-atalho={a.id} onClick={() => p.onAtalho(a)}>
            <I className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
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
      <div className={juntar(superficie.painel, "min-w-0", p.compacta ? "px-2 py-1.5 shadow-sm" : "p-3")}>
        <textarea
          ref={ref}
          aria-label={p.rotulo}
          rows={p.compacta ? 1 : undefined}
          className={juntar(campoTexto, "resize-none border-0 bg-transparent px-1 focus-visible:ring-0 focus-visible:ring-offset-0", p.compacta ? "min-h-[36px] text-[14px]" : "min-h-[96px] text-[15px]")}
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
            {p.compacta ? <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" aria-hidden="true" /> : null}
            {p.compacta ? atalhos : null}
            {p.extra}
          </div>
          <button type="submit" className={juntar(botao.primario, "ml-2 shrink-0", p.compacta ? "h-8 w-8 px-0" : "h-9 w-9 px-0")} disabled={p.enviando || !p.valor.trim()} aria-label="Enviar o pedido" title={p.tituloDoEnviar} data-enviar-pedido="">
            {p.enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      {p.compacta ? null : atalhos}
    </form>
  );
});

export default CaixaDoPedido;
