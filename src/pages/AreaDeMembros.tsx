import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Search,
  Settings2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { carregarCatalogo, mensagemDoErro } from "@/lib/membros/api";
import {
  buscarProdutos,
  destinoOperacional,
  podeAbrir,
  rotuloDoAcesso,
  trilhos,
  urlHttps,
  type Produto,
} from "@/lib/membros/modelo";
import LeitorDeProduto from "@/components/membros/LeitorDeProduto";
import { texto } from "@/components/sistema";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import "@/components/membros/membros.css";

export function CapaProduto({
  produto,
  destaque = false,
}: {
  produto: Produto;
  destaque?: boolean;
}) {
  const [falhou, setFalhou] = useState(false);
  const capa = urlHttps(produto.capa_url);
  return capa && !falhou ? (
    <img
      className="membros-capa"
      src={capa}
      alt={`Capa de ${produto.titulo}`}
      width={640}
      height={400}
      loading={destaque ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFalhou(true)}
    />
  ) : (
    <div className="membros-capa membros-fallback">
      <BookOpen size={32} className="text-primary mb-4" aria-hidden="true" />
      <span className="text-[12px] text-muted-foreground">
        Sem capa cadastrada
      </span>
      <span className="mt-2 text-[12px] text-muted-foreground">
        {produto.formato}
      </span>
    </div>
  );
}
export function TrilhoProdutos({
  titulo,
  produtos,
  abrir,
}: {
  titulo: string;
  produtos: Produto[];
  abrir: (p: Produto) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = `trilho-${titulo.normalize("NFD").replace(/[^a-zA-Z]/g, "")}`;
  return (
    <section aria-labelledby={`${id}-titulo`} className="min-w-0">
      <div className="flex items-center justify-between mb-3">
        <h2 id={`${id}-titulo`} className={texto.tituloSecao}>
          {titulo}
        </h2>
        <div className="flex">
          <button
            className="membros-acao text-muted-foreground"
            aria-label={`Voltar em ${titulo}`}
            aria-controls={id}
            onClick={() =>
              ref.current?.scrollBy({
                left: -(ref.current?.clientWidth || 300) * 0.8,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
              })
            }
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="membros-acao text-muted-foreground"
            aria-label={`Avançar em ${titulo}`}
            aria-controls={id}
            onClick={() =>
              ref.current?.scrollBy({
                left: (ref.current?.clientWidth || 300) * 0.8,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
              })
            }
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div id={id} className="membros-trilho" ref={ref}>
        {produtos.map((p) => (
          <button
            className="membros-cartao"
            key={p.id}
            onClick={() => abrir(p)}
            aria-label={`${p.titulo} · ${rotuloDoAcesso(p)}`}
          >
            <CapaProduto produto={p} />
            <div className="pt-3 px-1">
              <h3 className="text-[13px] leading-5 font-medium line-clamp-2">
                {p.titulo}
              </h3>
              <p className="text-[12px] leading-5 text-muted-foreground mt-1">
                {rotuloDoAcesso(p)}
              </p>
              {p.progresso > 0 && podeAbrir(p) && (
                <div
                  role="progressbar"
                  aria-label={`Progresso de ${p.titulo}`}
                  aria-valuenow={p.progresso}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1 mt-2 rounded-full bg-muted"
                >
                  <div
                    className="h-1 rounded-full bg-primary"
                    style={{
                      width: `${Math.min(100, Math.max(0, p.progresso))}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
export default function AreaDeMembros() {
  const { profile, user, logout } = useAuth();
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("");
  const [parametros, setParametros] = useSearchParams();
  const aberto = parametros.get("produto");
  const setAberto = (id: string | null) =>
    setParametros(id ? { produto: id } : {});
  const catalogo = useQuery({
    queryKey: ["membros", "catalogo", user?.id],
    queryFn: carregarCatalogo,
    retry: false,
  });
  const produtos = catalogo.data?.produtos || [];
  const encontrados = buscarProdutos(produtos, busca, categoria);
  const destaque =
    produtos.find((p) => p.destaque && podeAbrir(p)) ||
    produtos.find((p) => p.destaque) ||
    produtos.find((p) => podeAbrir(p)) ||
    produtos[0];
  const categorias = Array.from(
    new Set(produtos.map((p) => p.categoria).filter(Boolean)),
  );
  const produtoAberto = produtos.find((p) => p.id === aberto);
  return (
    <div className="membros bg-background text-foreground">
      <a
        href="#biblioteca"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:p-4"
      >
        Ir para a biblioteca
      </a>
      <header className="membros-topo">
        <div>
          <Link to="/membros" aria-label="Biblioteca Aceleriq">
            <MarcaAceleriq altura={24} />
          </Link>
          <nav
            aria-label="Navegação da biblioteca"
            className="flex items-center min-w-0 gap-1"
          >
            {profile?.role === "admin" && (
              <Link
                className="membros-acao text-muted-foreground"
                to="/membros/administrar"
                aria-label="Administrar biblioteca"
              >
                <Settings2 size={18} />
                <span className="hidden sm:inline">Administrar</span>
              </Link>
            )}
            <Link
              to={destinoOperacional(profile?.role)}
              className="membros-acao text-muted-foreground"
            >
              Painel Aceleriq
              <ArrowRight size={16} className="hidden sm:block" />
            </Link>
            <button
              className="membros-acao text-muted-foreground"
              onClick={() => void logout()}
              aria-label="Sair da conta"
            >
              <LogOut size={18} />
            </button>
          </nav>
        </div>
      </header>
      <main id="biblioteca" className="membros-conteudo space-y-8">
      {produtos.length>0 && <h1 className="sr-only">Biblioteca Aceleriq</h1>}
        {catalogo.isPending ? (
          <div
            aria-label="Carregando biblioteca"
            role="status"
            className="grid md:grid-cols-2 gap-8 motion-safe:animate-pulse"
          >
            <div className="h-48 rounded-xl bg-muted" />
            <div className="h-64 rounded-xl bg-muted" />
            <span className="sr-only">Carregando biblioteca…</span>
          </div>
        ) : catalogo.isError ? (
          <section role="alert" className="py-16 max-w-xl space-y-4">
            <h1 className={texto.tituloPagina}>
              Não conseguimos abrir sua biblioteca
            </h1>
            <p className={texto.corpo}>{mensagemDoErro(catalogo.error)}</p>
            <button
              className="membros-acao bg-primary text-primary-foreground"
              onClick={() => void catalogo.refetch()}
            >
              Tentar novamente
            </button>
            <Link className="membros-acao" to="/login?next=%2Fmembros">
              Entrar novamente
            </Link>
          </section>
        ) : !produtos.length ? (
          <section className="py-16 max-w-xl space-y-4">
            <BookOpen size={36} className="text-primary" />
            <h1 className={texto.tituloPagina}>Sua biblioteca começa aqui</h1>
            <p className={texto.corpo}>
              Ainda não há produtos disponíveis. Quando um material for
              publicado ou seu acesso for concedido, ele aparecerá aqui.
            </p>
            {profile?.role === "admin" && (
              <Link
                className="membros-acao bg-primary text-primary-foreground"
                to="/membros/administrar"
              >
                Cadastrar produto
              </Link>
            )}
          </section>
        ) : (
          <>
            {destaque && !busca && !categoria && (
              <section
                className="membros-destaque"
                aria-label="Produto em destaque"
              >
                <div className="space-y-4">
                  <p className="text-[12px] text-primary font-medium">
                    {rotuloDoAcesso(destaque)} · {destaque.formato}
                  </p>
                <h2>{destaque.titulo}</h2>
                  <p className="text-[13px] leading-6 text-muted-foreground max-w-lg line-clamp-4">
                    {destaque.descricao}
                  </p>
                  <button
                    className="membros-acao bg-primary text-primary-foreground"
                    onClick={() => setAberto(destaque.id)}
                  >
                    {podeAbrir(destaque)
                      ? "Continuar na biblioteca"
                      : "Conhecer produto"}
                    <ArrowRight size={16} />
                  </button>
                </div>
                <button
                  className="text-left rounded-xl focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setAberto(destaque.id)}
                  aria-label={`Ver ${destaque.titulo}`}
                >
                  <CapaProduto key={destaque.id} produto={destaque} destaque />
                </button>
              </section>
            )}
            <div className="flex flex-wrap gap-3 items-center">
              <label className="relative block w-full sm:max-w-sm">
                <Search
                  size={17}
                  className="absolute left-3 top-3.5 text-muted-foreground"
                />
                <span className="sr-only">Buscar produtos</span>
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar na biblioteca"
                  className="w-full h-11 pl-10 pr-3 bg-muted rounded-lg text-[13px] focus-visible:ring-2 focus-visible:ring-ring outline-none"
                />
              </label>
              {categorias.length > 1 && (
                <label>
                  <span className="sr-only">Categoria</span>
                  <select
                    className="h-11 max-w-full bg-muted rounded-lg px-3 text-[13px] focus-visible:ring-2 focus-visible:ring-ring"
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                  >
                    <option value="">Todas as categorias</option>
                    {categorias.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {catalogo.data?.pendentes.length ? (
              <p role="status" className="text-[13px] text-muted-foreground">
                Há pagamento aguardando confirmação. O acesso aparecerá aqui
                após a conferência.
              </p>
            ) : null}
            {busca || categoria ? (
              encontrados.length ? (
                <TrilhoProdutos
                  titulo="Resultados da busca"
                  produtos={encontrados}
                  abrir={(p) => setAberto(p.id)}
                />
              ) : (
                <section className="py-8">
                  <h2 className={texto.tituloSecao}>
                    Nenhum produto encontrado
                  </h2>
                  <button
                    className="membros-acao"
                    onClick={() => {
                      setBusca("");
                      setCategoria("");
                    }}
                  >
                    Limpar busca
                  </button>
                </section>
              )
            ) : (
              trilhos(produtos).map((t) => (
                <TrilhoProdutos
                  key={t.titulo}
                  titulo={t.titulo}
                  produtos={t.produtos}
                  abrir={(p) => setAberto(p.id)}
                />
              ))
            )}
          </>
        )}
      </main>
      {aberto && catalogo.isSuccess && !produtoAberto && (
        <section role="alert" className="membros-conteudo">
          <p>Este produto está indisponível.</p>
          <button className="membros-acao" onClick={() => setAberto(null)}>
            Voltar à biblioteca
          </button>
        </section>
      )}
      {produtoAberto && (
        <LeitorDeProduto
          key={produtoAberto.id}
          produto={produtoAberto}
          pendente={
            !!catalogo.data?.pendentes.some(
              (p) => p.produto_id === produtoAberto.id,
            )
          }
          fechar={() => {
            setAberto(null);
            void catalogo.refetch();
          }}
        />
      )}
    </div>
  );
}
