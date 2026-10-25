import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { pacote, type ProdutoDaLoja } from "./pacote";
import { aceitouCookies, linkDoWhatsapp, novoIdDoEvento, rastrear } from "./integracoes";

/**
 * Loja virtual da casa (Mesa Site, 25/10/2026): vitrine, página do produto,
 * carrinho e checkout, tudo pelo pacote (pacote.loja). Casca da casa: o
 * agente USA estes componentes nas seções (vitrine, hero, chamada), não
 * reescreve.
 *
 * Checkout:
 * - "whatsapp": o carrinho vira uma mensagem com os itens e o total
 *   (AddToCart e InitiateCheckout);
 * - "link": cada produto leva ao link de pagamento do gateway que o cliente
 *   já usa (Kiwify, Hotmart, Mercado Pago, Stripe, Asaas). Antes de sair, o
 *   pedido fica guardado; na volta para /obrigado/ (retorno do gateway) a
 *   casca conta o Purchase com valor e moeda, uma vez só.
 *
 * Eventos só depois do Aceitar dos cookies (src/lib/integracoes.tsx).
 * Página do produto: /produtos/#produto-<id> abre o detalhe (ViewContent).
 */

const loja = pacote.loja || null;
const MOEDA = (loja && loja.moeda) || "BRL";

/** Os produtos à venda (os indisponíveis ficam de fora da vitrine). */
export const produtosDaLoja = (categoria?: string): ProdutoDaLoja[] =>
  (loja ? loja.produtos : []).filter((p) => p.disponivel && (!categoria || (p.categoria || "Produtos") === categoria));

export const categoriasDaLoja = (): string[] => (loja ? loja.categorias : []);

export const produtoPeloId = (id: string): ProdutoDaLoja | null => (loja ? loja.produtos.find((p) => p.id === id) || null : null);

/** R$ 1.234,56 (o mesmo texto no pré-render e no navegador). */
export function emReais(n: number): string {
  const centavos = Math.round(n * 100);
  const inteiro = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const resto = String(centavos % 100);
  return `R$ ${inteiro},${resto.length < 2 ? `0${resto}` : resto}`;
}

/** Preço do produto ou "Sob consulta" (nunca preço inventado). */
export const precoDoProduto = (p: ProdutoDaLoja) => (p.preco != null ? emReais(p.preco) : "Sob consulta");

/** Endereço da página do produto (o detalhe abre por cima da vitrine). */
export const linkDoProduto = (p: ProdutoDaLoja) => `#produto-${p.id}`;

// ------------------------------------------------------------------ carrinho

type ItemDoCarrinho = { id: string; quantidade: number };
const CHAVE_DO_CARRINHO = "aceleriq-carrinho";
const CHAVE_DO_PEDIDO = "aceleriq-pedido";
const EVENTO_DO_CARRINHO = "aceleriq:carrinho";

let itensEmMemoria: ItemDoCarrinho[] | null = null;

function lerCarrinho(): ItemDoCarrinho[] {
  if (itensEmMemoria) return itensEmMemoria;
  try {
    const bruto = JSON.parse(window.localStorage.getItem(CHAVE_DO_CARRINHO) || "[]") as ItemDoCarrinho[];
    itensEmMemoria = (Array.isArray(bruto) ? bruto : []).filter((i) => i && produtoPeloId(i.id) && i.quantidade > 0).map((i) => ({ id: i.id, quantidade: Math.min(99, Math.floor(i.quantidade)) }));
  } catch {
    itensEmMemoria = [];
  }
  return itensEmMemoria;
}

function gravarCarrinho(itens: ItemDoCarrinho[]) {
  itensEmMemoria = itens;
  try {
    window.localStorage.setItem(CHAVE_DO_CARRINHO, JSON.stringify(itens));
  } catch {
    /* navegador sem armazenamento: vale nesta visita */
  }
  window.dispatchEvent(new Event(EVENTO_DO_CARRINHO));
}

const SEM_ITENS: ItemDoCarrinho[] = [];
const assinar = (f: () => void) => {
  window.addEventListener(EVENTO_DO_CARRINHO, f);
  return () => window.removeEventListener(EVENTO_DO_CARRINHO, f);
};

/** O carrinho com os produtos, a quantidade de itens e o total (null quando algum item é sob consulta). */
export function useCarrinho() {
  const itens = useSyncExternalStore(assinar, lerCarrinho, () => SEM_ITENS);
  const linhas = itens.map((i) => ({ ...i, produto: produtoPeloId(i.id)! })).filter((l) => !!l.produto);
  const quantidade = linhas.reduce((t, l) => t + l.quantidade, 0);
  const comPreco = linhas.every((l) => l.produto.preco != null);
  const total = comPreco ? linhas.reduce((t, l) => t + (l.produto.preco || 0) * l.quantidade, 0) : null;
  return { linhas, quantidade, total };
}

const conteudos = (linhas: Array<{ produto: ProdutoDaLoja; quantidade: number }>) => linhas.map((l) => ({ id: l.produto.id, quantity: l.quantidade, item_price: l.produto.preco || undefined }));

export function adicionarAoCarrinho(id: string, quantidade = 1) {
  const p = produtoPeloId(id);
  if (!p) return;
  const itens = lerCarrinho().slice();
  const atual = itens.find((i) => i.id === id);
  if (atual) atual.quantidade = Math.min(99, atual.quantidade + quantidade);
  else itens.push({ id, quantidade });
  gravarCarrinho(itens.map((i) => ({ ...i })));
  rastrear("AddToCart", { content_ids: [p.id], content_type: "product", content_name: p.nome, contents: [{ id: p.id, quantity: quantidade, item_price: p.preco || undefined }], value: p.preco != null ? p.preco * quantidade : undefined, currency: MOEDA });
  window.dispatchEvent(new Event("aceleriq:abrir-carrinho"));
}

export function mudarQuantidade(id: string, quantidade: number) {
  const itens = lerCarrinho()
    .map((i) => (i.id === id ? { ...i, quantidade: Math.max(0, Math.min(99, Math.floor(quantidade))) } : { ...i }))
    .filter((i) => i.quantidade > 0);
  gravarCarrinho(itens);
}

/** A mensagem do pedido no WhatsApp (o mesmo formato do painel: mesa-site/modulos/medicao-do-site.ts). */
export function mensagemDoPedido(linhas: Array<{ produto: ProdutoDaLoja; quantidade: number }>): string {
  const comPreco = linhas.every((l) => l.produto.preco != null);
  const total = linhas.reduce((t, l) => t + (l.produto.preco || 0) * l.quantidade, 0);
  return [
    "Olá! Quero fazer este pedido:",
    ...linhas.map((l) => `- ${l.quantidade}x ${l.produto.nome}${l.produto.preco != null ? ` (${emReais(l.produto.preco)})` : ""}`),
    comPreco && linhas.length ? `Total: ${emReais(total)}` : "Total: a combinar",
  ].join("\n");
}

/** Finaliza o carrinho no WhatsApp (InitiateCheckout) e esvazia. */
export function finalizarNoWhatsapp(linhas: Array<{ produto: ProdutoDaLoja; quantidade: number }>, total: number | null) {
  const link = linkDoWhatsapp(mensagemDoPedido(linhas));
  if (!link) return false;
  rastrear("InitiateCheckout", { content_ids: linhas.map((l) => l.produto.id), content_type: "product", contents: conteudos(linhas), num_items: linhas.reduce((t, l) => t + l.quantidade, 0), value: total == null ? undefined : total, currency: MOEDA });
  window.open(link, "_blank", "noopener,noreferrer");
  gravarCarrinho([]);
  return true;
}

/** Vai para o link de pagamento do produto: guarda o pedido (para o Purchase na volta) e conta InitiateCheckout. */
function irParaOPagamento(p: ProdutoDaLoja) {
  try {
    window.localStorage.setItem(CHAVE_DO_PEDIDO, JSON.stringify({ id: p.id, nome: p.nome, preco: p.preco, em: Date.now() }));
  } catch {
    /* sem armazenamento: o Purchase não sai na volta */
  }
  rastrear("InitiateCheckout", { content_ids: [p.id], content_type: "product", contents: [{ id: p.id, quantity: 1, item_price: p.preco || undefined }], num_items: 1, value: p.preco == null ? undefined : p.preco, currency: MOEDA });
}

/**
 * Na página /obrigado/ (o gateway volta para cá depois do pagamento): conta o
 * Purchase do pedido guardado, uma vez, com valor e moeda. Sem pedido
 * guardado (ou com mais de 24 h), nada sai.
 */
export function confirmarCompra(): boolean {
  if (!aceitouCookies()) return false;
  let pedido: { id: string; nome: string; preco: number | null; em: number } | null = null;
  try {
    pedido = JSON.parse(window.localStorage.getItem(CHAVE_DO_PEDIDO) || "null");
  } catch {
    pedido = null;
  }
  if (!pedido || !pedido.id || Date.now() - Number(pedido.em || 0) > 24 * 3600_000) return false;
  try {
    window.localStorage.removeItem(CHAVE_DO_PEDIDO);
  } catch {
    /* sem armazenamento */
  }
  return !!rastrear(
    "Purchase",
    { content_ids: [pedido.id], content_type: "product", contents: [{ id: pedido.id, quantity: 1, item_price: pedido.preco || undefined }], num_items: 1, value: pedido.preco || 0, currency: MOEDA },
    novoIdDoEvento("Purchase"),
  );
}

// ------------------------------------------------------------------ componentes

const botaoPrimario = "inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-medium text-fundo transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/** O botão de compra do produto: link de pagamento (checkout "link") ou pôr no carrinho (checkout "whatsapp"). */
export function BotaoComprar({ produto, className, rotulo }: { produto: ProdutoDaLoja; className?: string; rotulo?: string }) {
  if (!loja) return null;
  if (loja.checkout === "link" && produto.link_pagamento) {
    return (
      <a href={produto.link_pagamento} className={className || botaoPrimario} onClick={() => irParaOPagamento(produto)} rel="noopener">
        {rotulo || "Comprar"}
      </a>
    );
  }
  if (loja.checkout === "link") {
    const w = linkDoWhatsapp(`Olá! Quero comprar: ${produto.nome}`);
    return w ? (
      <a href={w} target="_blank" rel="noopener noreferrer" className={className || botaoPrimario}>
        {rotulo || "Pedir pelo WhatsApp"}
      </a>
    ) : null;
  }
  return (
    <button type="button" className={className || botaoPrimario} onClick={() => adicionarAoCarrinho(produto.id)}>
      {rotulo || "Adicionar ao carrinho"}
    </button>
  );
}

/** Cartão do produto na vitrine: imagem (opcional, do public/), nome que abre o detalhe, preço e o botão de comprar. */
export function CartaoDoProduto({ produto, imagem, className }: { produto: ProdutoDaLoja; imagem?: { src: string; alt: string } | null; className?: string }) {
  return (
    <article className={className || "flex min-w-0 flex-col"} data-produto={produto.id}>
      {imagem ? (
        <a href={linkDoProduto(produto)} className="mb-3 block overflow-hidden rounded-xl">
          <img src={imagem.src} alt={imagem.alt} width={600} height={600} loading="lazy" className="aspect-square w-full object-cover" />
        </a>
      ) : null}
      <h3 className="text-lg font-medium">
        <a href={linkDoProduto(produto)} className="hover:underline">
          {produto.nome}
        </a>
      </h3>
      {produto.categoria ? <p className="text-sm opacity-70">{produto.categoria}</p> : null}
      <p className="mt-1 font-medium">{precoDoProduto(produto)}</p>
      <div className="mt-3">
        <BotaoComprar produto={produto} />
      </div>
    </article>
  );
}

/** Vitrine: filtro por categoria (quando há mais de uma) e a grade de cartões. `imagemDoProduto` liga a foto de public/ ao produto. */
export function Vitrine({ limite, imagemDoProduto, className }: { limite?: number; imagemDoProduto?: (p: ProdutoDaLoja) => { src: string; alt: string } | null; className?: string }) {
  const [categoria, setCategoria] = useState<string>("");
  const cats = categoriasDaLoja();
  const lista = produtosDaLoja(categoria || undefined).slice(0, limite || 60);
  if (!loja) return null;
  return (
    <div className={className}>
      {cats.length > 1 ? (
        <div className="mb-6 flex flex-wrap" role="group" aria-label="Categorias">
          {["", ...cats].map((c) => (
            <button key={c || "todas"} type="button" aria-pressed={categoria === c} onClick={() => setCategoria(c)} className={`mb-2 mr-2 min-h-11 rounded-full border px-4 text-sm ${categoria === c ? "border-destaque bg-destaque text-fundo" : "border-texto/20"}`}>
              {c || "Todos"}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {lista.map((p) => (
          <CartaoDoProduto key={p.id} produto={p} imagem={imagemDoProduto ? imagemDoProduto(p) : null} />
        ))}
      </div>
    </div>
  );
}

function Janela({ aberta, aoFechar, titulo, children, lado }: { aberta: boolean; aoFechar: () => void; titulo: string; children: ReactNode; lado?: boolean }) {
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberta, aoFechar]);
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={aoFechar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className={`max-h-[90vh] w-full overflow-y-auto bg-superficie p-6 text-texto shadow-xl ${lado ? "sm:ml-auto sm:h-full sm:max-h-none sm:max-w-md" : "rounded-t-2xl sm:max-w-lg sm:rounded-2xl"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-medium">{titulo}</h2>
          <button type="button" onClick={aoFechar} className="min-h-11 min-w-11 rounded-full" aria-label="Fechar">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A página do produto: abre por #produto-<id> (link direto e compartilhável) e conta ViewContent. */
function DetalheDoProduto() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const ler = () => {
      const m = window.location.hash.match(/^#produto-([a-z0-9-]+)$/);
      setId(m && produtoPeloId(m[1]) ? m[1] : null);
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);
  const p = id ? produtoPeloId(id) : null;
  useEffect(() => {
    if (p) rastrear("ViewContent", { content_ids: [p.id], content_type: "product", content_name: p.nome, content_category: p.categoria || undefined, value: p.preco == null ? undefined : p.preco, currency: MOEDA });
  }, [p && p.id]);
  const fechar = () => {
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      window.location.hash = "";
    }
    setId(null);
  };
  return (
    <Janela aberta={!!p} aoFechar={fechar} titulo={p ? p.nome : ""}>
      {p ? (
        <div>
          {p.categoria ? <p className="text-sm opacity-70">{p.categoria}</p> : null}
          <p className="mt-2 text-2xl font-medium">{precoDoProduto(p)}</p>
          {p.descricao ? <p className="mt-4 leading-relaxed">{p.descricao}</p> : null}
          <div className="mt-6">
            <BotaoComprar produto={p} />
          </div>
        </div>
      ) : null}
    </Janela>
  );
}

/** O carrinho (checkout pelo WhatsApp): botão flutuante com a contagem e a gaveta com os itens, o total e o finalizar. */
function Carrinho() {
  const { linhas, quantidade, total } = useCarrinho();
  const [aberto, setAberto] = useState(false);
  const [aviso, setAviso] = useState("");
  useEffect(() => {
    const abrir = () => setAberto(true);
    window.addEventListener("aceleriq:abrir-carrinho", abrir);
    return () => window.removeEventListener("aceleriq:abrir-carrinho", abrir);
  }, []);
  if (!loja || loja.checkout !== "whatsapp") return null;
  return (
    <>
      {quantidade > 0 ? (
        <button type="button" onClick={() => setAberto(true)} className="fixed bottom-24 right-5 z-40 flex h-14 min-w-14 items-center justify-center rounded-full bg-destaque px-4 font-medium text-fundo shadow-lg" aria-label={`Abrir o carrinho, ${quantidade} ${quantidade === 1 ? "item" : "itens"}`}>
          Carrinho ({quantidade})
        </button>
      ) : null}
      <Janela aberta={aberto} aoFechar={() => setAberto(false)} titulo="Seu pedido" lado>
        {linhas.length ? (
          <div>
            <ul>
              {linhas.map((l) => (
                <li key={l.id} className="flex items-center justify-between border-b border-texto/10 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.produto.nome}</span>
                    <span className="block text-sm opacity-70">{precoDoProduto(l.produto)}</span>
                  </span>
                  <span className="ml-3 flex items-center">
                    <button type="button" className="min-h-11 min-w-11 rounded-full border border-texto/20" aria-label={`Tirar um ${l.produto.nome}`} onClick={() => mudarQuantidade(l.id, l.quantidade - 1)}>
                      -
                    </button>
                    <span className="mx-2 w-6 text-center" aria-live="polite">
                      {l.quantidade}
                    </span>
                    <button type="button" className="min-h-11 min-w-11 rounded-full border border-texto/20" aria-label={`Pôr mais um ${l.produto.nome}`} onClick={() => mudarQuantidade(l.id, l.quantidade + 1)}>
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex justify-between text-lg font-medium">
              <span>Total</span>
              <span>{total == null ? "A combinar" : emReais(total)}</span>
            </p>
            {aviso ? (
              <p role="alert" className="mt-3 text-sm">
                {aviso}
              </p>
            ) : null}
            <button type="button" className={`${botaoPrimario} mt-4 w-full`} onClick={() => (finalizarNoWhatsapp(linhas, total) ? setAberto(false) : setAviso("O WhatsApp da loja não está ligado. Fale com a loja pelo contato do rodapé."))}>
              Finalizar pelo WhatsApp
            </button>
          </div>
        ) : (
          <p>O carrinho está vazio.</p>
        )}
      </Janela>
    </>
  );
}

/** Na volta do pagamento (/obrigado/): conta a compra assim que houver o Aceitar dos cookies. */
function ConfirmacaoDaCompra({ caminho }: { caminho: string }) {
  useEffect(() => {
    if (!/^\/obrigado\/?$/.test(caminho)) return;
    if (confirmarCompra()) return;
    const depois = () => confirmarCompra();
    window.addEventListener("aceleriq:consentiu", depois);
    return () => window.removeEventListener("aceleriq:consentiu", depois);
  }, [caminho]);
  return null;
}

/** A camada da loja que o App põe no fim da página: carrinho, página do produto e a compra na volta do pagamento. */
export function CamadaDaLoja({ caminho = "/" }: { caminho?: string }) {
  if (!loja) return null;
  return (
    <>
      <Carrinho />
      <DetalheDoProduto />
      <ConfirmacaoDaCompra caminho={caminho} />
    </>
  );
}
