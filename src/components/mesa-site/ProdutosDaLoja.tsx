import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListPlus, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import {
  CHECKOUTS_DA_LOJA,
  type CheckoutDaLoja,
  gatewayDoLink,
  linkDePagamento,
  normalizarLoja,
  precoDe,
  produtosDoContexto,
} from "../../../supabase/functions/mesa-site/modulos/medicao-do-site";
import { type LinhaDoSite, useSalvarSite } from "./siteApi";
import { CHAVES_DA_JORNADA, jornadaDoSite } from "./jornadaApi";
import { opcaoDaGrade } from "./PassoObjetivo";

type Linha = { id: string; nome: string; preco: string; categoria: string; descricao: string; link: string; disponivel: boolean };

const paraTela = (site: LinhaDoSite): { checkout: CheckoutDaLoja; linhas: Linha[] } => {
  const l = jornadaDoSite(site).loja;
  return {
    checkout: l.checkout,
    linhas: l.produtos.map((p) => ({ id: p.id, nome: p.nome, preco: p.preco == null ? "" : p.preco.toFixed(2).replace(".", ","), categoria: p.categoria, descricao: p.descricao, link: p.link_pagamento || "", disponivel: p.disponivel })),
  };
};

const paraSalvar = (checkout: CheckoutDaLoja, linhas: Linha[]) =>
  normalizarLoja({ checkout, produtos: linhas.map((x) => ({ id: x.id || undefined, nome: x.nome, preco: x.preco, categoria: x.categoria, descricao: x.descricao, link_pagamento: x.link, disponivel: x.disponivel })) });

/**
 * Produtos da loja virtual (25/10/2026), no passo Conferir o cliente quando o
 * objetivo é Loja virtual: o checkout (pedido pelo WhatsApp ou link de
 * pagamento do gateway que o cliente já usa) e os produtos (nome, preço,
 * categoria, link). Nada de preço inventado: sem preço, fica sob consulta. O
 * site lê de pacote.loja (carrinho, página do produto e eventos da casca).
 */
export default function ProdutosDaLoja({ site, produtosDoCliente }: { site: LinhaDoSite; produtosDoCliente: string[] }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const salvar = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const inicial = paraTela(site);
  const [checkout, setCheckout] = useState<CheckoutDaLoja>(inicial.checkout);
  const [linhas, setLinhas] = useState<Linha[]>(inicial.linhas);
  const [gravando, setGravando] = useState(false);
  const chaveSalva = JSON.stringify(jornadaDoSite(site).loja);

  useEffect(() => {
    const t = paraTela(site);
    setCheckout(t.checkout);
    setLinhas(t.linhas);
    // Só quando o salvo muda (o que se edita aqui não volta atrás).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, chaveSalva]);

  const mudou = JSON.stringify(paraSalvar(checkout, linhas)) !== chaveSalva;
  const mudar = (i: number, v: Partial<Linha>) => setLinhas((l) => l.map((x, k) => (k === i ? { ...x, ...v } : x)));

  const gravar = async () => {
    if (gravando) return;
    setGravando(true);
    try {
      await salvar("jornada_salvar", { site_id: site.id, loja: paraSalvar(checkout, linhas) });
      void qc.invalidateQueries({ queryKey: CHAVES_DA_JORNADA.medicao(site.id) });
    } catch (e) {
      avisarErro(e, "Os produtos não foram salvos");
    } finally {
      setGravando(false);
    }
  };

  const puxarDoCliente = () => {
    const novos = produtosDoContexto(produtosDoCliente).filter((p) => !linhas.some((x) => x.nome.toLowerCase() === p.nome.toLowerCase()));
    setLinhas((l) => l.concat(novos.map((p) => ({ id: "", nome: p.nome, preco: p.preco == null ? "" : p.preco.toFixed(2).replace(".", ","), categoria: "", descricao: "", link: "", disponivel: true }))));
  };

  const ativos = linhas.filter((x) => x.nome.trim() && x.disponivel);
  const descricao = `${ativos.length} ${ativos.length === 1 ? "produto" : "produtos"}${mudou ? " · não salvo" : ""}`;

  return (
    <Secao
      titulo="Loja"
      descricao={descricao}
      ajuda="Checkout pelo WhatsApp: o carrinho do site vira uma mensagem com os itens e o total. Link de pagamento: cada produto leva ao checkout do gateway que o cliente já usa (Kiwify, Hotmart, Mercado Pago, Stripe, Asaas); no gateway, aponte a página de retorno para /obrigado/ do site, que conta a compra. Preço só o real; sem preço, sob consulta. O site lê daqui na construção e no Aplicar no site."
      recolher={false}
      acao={
        <>
          <button type="button" className={juntar(botao.icone, "mr-1")} aria-label="Trazer os produtos do cliente" title="Trazer os produtos do cliente" disabled={!produtosDoCliente.length} onClick={puxarDoCliente} data-puxar-produtos="">
            <ListPlus className="h-4 w-4" />
          </button>
          <button type="button" className={juntar(botao.icone, "mr-1")} aria-label="Novo produto" title="Novo produto" onClick={() => setLinhas((l) => l.concat([{ id: "", nome: "", preco: "", categoria: "", descricao: "", link: "", disponivel: true }]))} data-novo-produto="">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className={juntar(botao.icone, mudou ? "text-primary" : "")} aria-label="Salvar a loja" title="Salvar a loja" disabled={!mudou || gravando} onClick={() => void gravar()} data-salvar-loja="">
            {gravando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </button>
        </>
      }
      data-produtos-da-loja=""
    >
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Checkout da loja" data-checkout-da-loja="">
        {CHECKOUTS_DA_LOJA.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={checkout === c.id} className={opcaoDaGrade(checkout === c.id)} title={c.descricao} onClick={() => setCheckout(c.id)} data-checkout={c.id}>
            <span className="min-w-0 flex-1">
              <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.rotulo}</span>
              <span className={juntar(texto.auxiliar, "block truncate")}>{c.descricao}</span>
            </span>
          </button>
        ))}
      </div>

      {linhas.length ? (
        <ul className={juntar(lista.aberta, lista.divisoria, "mt-4")} data-lista-de-produtos="">
          {linhas.map((x, i) => {
            const preco = x.preco.trim() ? precoDe(x.preco) : null;
            const link = x.link.trim() ? linkDePagamento(x.link) : null;
            const gateway = gatewayDoLink(link);
            return (
              <li key={i} className="flex min-w-0 flex-wrap items-center px-2 py-2.5" data-produto={x.id || `novo-${i}`}>
                <input value={x.nome} onChange={(e) => mudar(i, { nome: e.target.value })} className={juntar(campo, "mb-2 mr-2 min-w-[180px] flex-1")} placeholder="Nome do produto" aria-label="Nome do produto" />
                <input
                  value={x.preco}
                  onChange={(e) => mudar(i, { preco: e.target.value })}
                  className={juntar(campo, "mb-2 mr-2 w-28 flex-none", x.preco.trim() && preco == null ? "border-destructive" : "")}
                  placeholder="Preço"
                  aria-label="Preço em reais"
                  title={x.preco.trim() && preco == null ? "Preço sem formato (ex.: 49,90)" : "Em reais; vazio = sob consulta"}
                  inputMode="decimal"
                />
                <input value={x.categoria} onChange={(e) => mudar(i, { categoria: e.target.value })} className={juntar(campo, "mb-2 mr-2 min-w-[120px] flex-1 sm:w-36 sm:flex-none")} placeholder="Categoria" aria-label="Categoria" />
                {checkout === "link" && (
                  <input
                    value={x.link}
                    onChange={(e) => mudar(i, { link: e.target.value })}
                    className={juntar(campo, "mb-2 mr-2 min-w-[200px] flex-1", x.link.trim() && !link ? "border-destructive" : "")}
                    placeholder="Link de pagamento (https)"
                    aria-label="Link de pagamento"
                    title={x.link.trim() && !link ? "Só endereço https" : gateway ? `Gateway: ${gateway.rotulo}` : "Link do checkout do gateway do cliente"}
                  />
                )}
                <label className={juntar(texto.auxiliar, "mb-2 mr-2 flex cursor-pointer items-center")} title="Desmarcado: fica fora da vitrine">
                  <input type="checkbox" className="mr-1.5" checked={x.disponivel} onChange={(e) => mudar(i, { disponivel: e.target.checked })} />
                  À venda
                </label>
                <button type="button" className={juntar(botao.icone, "mb-2")} aria-label={`Tirar ${x.nome || "o produto"}`} title="Tirar o produto" onClick={() => setLinhas((l) => l.filter((_, k) => k !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={juntar(texto.auxiliar, "mt-4")}>Sem produtos. Traga os do cliente ou cadastre um novo.</p>
      )}
    </Secao>
  );
}
