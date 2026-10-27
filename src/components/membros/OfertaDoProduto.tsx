import { AjudaRecolhida } from "@/components/sistema";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import { urlHttps, type Produto } from "@/lib/membros/modelo";
import { capaDoProduto, capaPadraoDoProduto } from "@/lib/membros/capas";
import "./vitrine-membros.css";
export default function OfertaDoProduto({
  produto,
  pendente,
}: {
  produto: Produto;
  pendente: boolean;
}) {
  const landing = urlHttps(produto.landing_url);
  const checkout = urlHttps(produto.checkout_url);
  const [modo, setModo] = useState<"produto" | "pagina" | "checkout">(
    landing && produto.landing_embutida ? "pagina" : "produto",
  );
  const [conferindo, setConferindo] = useState(false);
  const [aviso, setAviso] = useState("");
  const qc = useQueryClient();
  const endereco =
    modo === "pagina" ? landing : modo === "checkout" ? checkout : null;
  async function conferir() {
    setConferindo(true);
    try {
      await qc.invalidateQueries({ queryKey: ["membros", "catalogo"] });
      setAviso(
        "Conferência solicitada. O conteúdo aparece aqui assim que o pagamento e o acesso forem confirmados.",
      );
    } finally {
      setConferindo(false);
    }
  }
  const comprar = checkout && produto.em_venda !== false;
  return (
    <section
      className="membros-oferta membros-oferta-refinada"
      aria-label="Oferta do produto"
    >
      {endereco ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <button className="membros-acao" onClick={() => setModo("produto")}>
              <ArrowLeft size={15} />
              Sobre o produto
            </button>
            <div className="inline-flex items-center gap-1">
              <a
                className="membros-acao text-muted-foreground"
                href={endereco}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={15} />
                Abrir em nova guia
              </a>
              <AjudaRecolhida rotulo="Sobre a página do produto">
                Se a página não abrir aqui, continue pela opção de nova guia.
              </AjudaRecolhida>
            </div>
          </div>
          <iframe
            key={endereco}
            title={
              modo === "checkout"
                ? `Checkout de ${produto.titulo}`
                : `Página de ${produto.titulo}`
            }
            src={endereco}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            allow="payment"
            className="membros-oferta-pagina"
          />
        </>
      ) : (
        <div className="membros-oferta-apresentacao">
          <div className="membros-oferta-capa">
            <img
              src={capaDoProduto(produto)}
              alt={`Capa de ${produto.titulo}`}
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(evento) => {
                const imagem = evento.currentTarget;
                if (imagem.dataset.fallback) {
                  imagem.hidden = true;
                  return;
                }
                imagem.dataset.fallback = "true";
                imagem.src = capaPadraoDoProduto(produto);
              }}
            />
          </div>
          <div>
            <span className="membros-oferta-categoria">
              <LockKeyhole size={14} />
              {produto.categoria || "Conheça seu próximo passo"}
            </span>
            <p className="membros-oferta-descricao">{produto.descricao}</p>
            {produto.condicoes && (
              <p className="membros-oferta-condicoes">{produto.condicoes}</p>
            )}
          </div>
        </div>
      )}
      <div className="membros-oferta-acoes">
        {landing &&
          modo !== "pagina" &&
          (produto.landing_embutida ? (
            <button
              className="membros-acao border border-border"
              onClick={() => setModo("pagina")}
            >
              Ver página do produto
            </button>
          ) : (
            <a
              className="membros-acao border border-border"
              href={landing}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver página do produto <ExternalLink size={14} />
            </a>
          ))}
        {pendente ? (
          <p role="status" className="text-[13px]">
            Pagamento pendente. O conteúdo será liberado após confirmação
            segura.
          </p>
        ) : comprar ? (
          produto.checkout_embutido ? (
            <button
              className="membros-acao bg-primary text-primary-foreground"
              onClick={() => setModo("checkout")}
            >
              <ShoppingBag size={16} />
              {produto.cta || "Ver oferta no checkout"}
            </button>
          ) : (
            <a
              className="membros-acao bg-primary text-primary-foreground"
              href={checkout!}
              target="_blank"
              rel="noopener noreferrer"
            >
              {produto.cta || "Ver oferta no checkout"}{" "}
              <ExternalLink size={15} />
            </a>
          )
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Conteúdo bloqueado. A compra ainda não está disponível.
          </p>
        )}
        {checkout && (
          <button
            className="membros-acao text-muted-foreground"
            disabled={conferindo}
            onClick={() => void conferir()}
          >
            <RefreshCw size={14} />
            {conferindo ? "Conferindo…" : "Já paguei, conferir acesso"}
          </button>
        )}
      </div>
      {aviso && (
        <p role="status" className="text-[12px] text-muted-foreground">
          {aviso}
        </p>
      )}
    </section>
  );
}
