import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUpRight,
  Coins,
  Image,
  RotateCcw,
  Sparkles,
  Type,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import TituloMembros from "@/components/membros/TituloMembros";
import { erroDoBolso, lerExtrato, lerOfertas } from "@/lib/bolso/api";
import {
  dataCurta,
  ROTULO_DO_LANCAMENTO,
  situacaoDoEstudio,
} from "@/lib/bolso/modelo";
import { quantidadePossivel, reais } from "@/lib/bolso/recargas";
import { FaixaDeDemonstracao, useEstadoDoBolso } from "./EstudioBolso";

export default function CreditosBolso() {
  const { user } = useAuth();
  const estado = useEstadoDoBolso();
  const habilitado = !!user && !!estado.data?.exposto;
  const extrato = useQuery({
    queryKey: ["bolso", "extrato", user?.id],
    queryFn: () => lerExtrato(80),
    retry: false,
    enabled: habilitado,
  });
  const ofertas = useQuery({
    queryKey: ["bolso", "ofertas", user?.id],
    queryFn: lerOfertas,
    retry: false,
    enabled: habilitado && estado.data?.carteira !== "teste",
  });
  if (estado.isPending) return <p role="status">Carregando seus créditos…</p>;
  if (estado.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>{erroDoBolso(estado.error)}</p>
        <button
          type="button"
          className="membros-acao"
          onClick={() => void estado.refetch()}
        >
          <RotateCcw size={16} /> Tentar de novo
        </button>
      </div>
    );
  const e = estado.data;
  const situacao = situacaoDoEstudio(e);
  if (!e.exposto) return <p>{situacao.texto}</p>;
  const saldo = e.saldo?.disponivel || 0;
  return (
    <section
      className="bolso-creditos space-y-8"
      aria-label="Créditos e acesso"
    >
      {situacao.demonstracao && <FaixaDeDemonstracao />}
      <TituloMembros
        titulo="Seus créditos"
        principal
        icone={<Wallet size={20} aria-hidden="true" />}
      />
      <div className="bolso-carteira-destaque">
        <div>
          <span className="bolso-sobrelinha">Disponível para criar</span>
          <p className="bolso-saldo-grande">
            {saldo}
            <span>créditos{e.carteira === "teste" ? " de teste" : ""}</span>
          </p>
          <span className="bolso-carteira-reserva">
            {e.saldo?.reservado || 0} reservados em pedidos em andamento
          </span>
        </div>
        <div className="bolso-carteira-acesso">
          <span className="bolso-sobrelinha">Seu acesso</span>
          <strong>
            {e.direito
              ? e.carteira === "teste"
                ? "Demonstração"
                : "Aceleriq de Bolso"
              : "Sem acesso ativo"}
          </strong>
          <span>
            {e.direito
              ? `Até ${dataCurta(e.direito.fim)}`
              : "Seus arquivos continuam disponíveis."}
          </span>
          {e.carteira !== "teste" && (
            <a className="membros-acao" href="#recargas-bolso">
              Ver recargas <ArrowDown size={15} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
      <div className="bolso-custos-criacao" aria-label="Créditos por criação">
        <div>
          <Type size={21} aria-hidden="true" />
          <span>
            Texto de campanha
            <strong>
              {e.politica
                ? `${e.politica.tarifa_texto} crédito${e.politica.tarifa_texto === 1 ? "" : "s"}`
                : "Indisponível"}
            </strong>
          </span>
        </div>
        <div>
          <Image size={21} aria-hidden="true" />
          <span>
            Imagem do criativo
            <strong>
              {e.politica
                ? `${e.politica.tarifa_imagem} créditos`
                : "Indisponível"}
            </strong>
          </span>
        </div>
        <div>
          <Sparkles size={21} aria-hidden="true" />
          <span>
            Editar e baixar<strong>Sem gastar créditos</strong>
          </span>
        </div>
      </div>
      {!e.direito && (
        <p role="status" className="bolso-aviso">
          Seu acesso ao estúdio não está ativo. Campanhas, textos e artes que
          você já fez continuam aqui para consultar e baixar.
        </p>
      )}
      {e.carteira !== "teste" && (
        <section
          id="recargas-bolso"
          className="bolso-recargas"
          aria-labelledby="recargas-titulo"
        >
          <div className="bolso-cabecalho-secao">
            <div>
              <span className="bolso-sobrelinha">Continue criando</span>
              <h2 id="recargas-titulo">Mais ideias. Mais créditos.</h2>
            </div>
            <span className="bolso-etiqueta">Recarga avulsa</span>
          </div>
          {ofertas.isPending ? (
            <p role="status">Carregando recargas…</p>
          ) : ofertas.isError ? (
            <div role="alert" className="bolso-cartao">
              <p>Não conseguimos carregar as recargas.</p>
              <button
                type="button"
                className="membros-acao"
                onClick={() => void ofertas.refetch()}
              >
                Tentar novamente
              </button>
            </div>
          ) : !ofertas.data?.ofertas.length ? (
            <div className="bolso-recargas-vazio">
              <Coins size={30} aria-hidden="true" />
              <div>
                <h3>Recargas em breve</h3>
                <p>Os pacotes aparecerão aqui quando estiverem disponíveis.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="bolso-ofertas-grade">
                {ofertas.data.ofertas.map((o) => (
                  <article key={o.id} className="bolso-oferta">
                    <span className="bolso-sobrelinha">{o.nome}</span>
                    <h3>
                      {o.creditos}
                      <small> créditos</small>
                    </h3>
                    {o.descricao && (
                      <p className="bolso-oferta-descricao">{o.descricao}</p>
                    )}
                    <p className="bolso-oferta-preco">
                      {reais(o.preco_centavos)}
                      <span>pagamento único</span>
                    </p>
                    <ul>
                      <li>
                        <Type size={16} aria-hidden="true" /> Até{" "}
                        {quantidadePossivel(
                          o.creditos,
                          e.politica?.tarifa_texto ?? o.tarifa_texto,
                        )}{" "}
                        textos
                      </li>
                      <li>
                        <Image size={16} aria-hidden="true" /> Ou até{" "}
                        {quantidadePossivel(
                          o.creditos,
                          e.politica?.tarifa_imagem ?? o.tarifa_imagem,
                        )}{" "}
                        imagens
                      </li>
                    </ul>
                    <p className="bolso-oferta-validade">
                      Validade de até {o.validade_dias} dias, dentro do seu
                      acesso ativo.
                    </p>
                    <button
                      type="button"
                      className="membros-acao bolso-oferta-botao"
                      disabled
                    >
                      Recargas em breve{" "}
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
              <p className="bolso-nota">
                Combine textos e imagens com o mesmo saldo. A recarga adiciona
                créditos e não renova o acesso anual. As compras ainda não estão
                disponíveis.
              </p>
            </>
          )}
        </section>
      )}
      <section
        className="bolso-creditos-extrato"
        aria-labelledby="bolso-extrato-titulo"
      >
        <div className="bolso-cabecalho-secao">
          <h2 id="bolso-extrato-titulo">Seu extrato</h2>
          <span className="bolso-nota">Últimas movimentações</span>
        </div>
        <p className="bolso-nota mb-4">
          O valor aparece antes de confirmar. Se o pedido falhar, créditos ainda
          válidos voltam ao saldo. Pedidos em conferência ficam reservados até a revisão.
        </p>
        {extrato.isPending ? (
          <p role="status">Carregando o extrato…</p>
        ) : extrato.isError ? (
          <div role="alert">
            <p>{erroDoBolso(extrato.error)}</p>
            <button
              type="button"
              className="membros-acao"
              onClick={() => void extrato.refetch()}
            >
              Tentar novamente
            </button>
          </div>
        ) : !extrato.data?.length ? (
          <p className="bolso-recargas-vazio">Nenhuma movimentação ainda.</p>
        ) : (
          <ul className="bolso-lista" aria-label="Movimentações de créditos">
            {extrato.data.map((l) => (
              <li key={l.id} className="bolso-extrato-linha">
                <span className="min-w-0">
                  <strong className="block">
                    {ROTULO_DO_LANCAMENTO[l.tipo]}
                  </strong>
                  <span className="bolso-nota">
                    {l.descricao} · {dataCurta(l.criado_em)}
                    {l.carteira === "teste" ? " · teste" : ""}
                  </span>
                </span>
                <span
                  className="bolso-extrato-quantidade"
                  aria-label={`${l.delta_disponivel >= 0 ? "mais" : "menos"} ${Math.abs(l.delta_disponivel || l.quantidade)} créditos`}
                >
                  {l.tipo === "captura"
                    ? `${l.quantidade} usado${l.quantidade === 1 ? "" : "s"}`
                    : `${l.delta_disponivel > 0 ? "+" : "−"}${Math.abs(l.delta_disponivel)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
