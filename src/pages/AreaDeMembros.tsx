import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";
import TituloMembros from "@/components/membros/TituloMembros";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Search,
  Settings2,
  Play,
  LockKeyhole,
  RotateCcw,
  FlaskConical,
  Trophy,
  Check,
  BookCheck,
  Home,
  Bookmark,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Wrench,
  Megaphone,
  Coins,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  carregarCatalogo,
  mensagemDoErro,
  reiniciarTeste,
} from "@/lib/membros/api";
import {
  buscarProdutos,
  destinoOperacional,
  podeAbrir,
  rotuloDoAcesso,
  trilhos,
  urlHttps,
  type Produto,
  type TesteCliente,
  type Catalogo,
} from "@/lib/membros/modelo";
import {
  carregarLista,
  favoritar,
  carregarFunil,
} from "@/lib/membros/aprendizado";
import { FocoDeEstudo, BotaoPomodoro } from "@/components/membros/FocoDeEstudo";
import ComunidadeDoCurso from "@/components/membros/ComunidadeDoCurso";
import LeitorDeProduto from "@/components/membros/LeitorDeProduto";
import FerramentasDoMembro from "@/components/membros/FerramentasDoMembro";
import EstudioBolso, { useEstadoDoBolso } from "@/components/membros/bolso/EstudioBolso";
import CreditosBolso from "@/components/membros/bolso/CreditosBolso";
import { useCatalogoFerramentas } from "@/hooks/useCatalogoFerramentas";
import { temLicencaDaFerramenta } from "@/lib/membros/ferramentas";
import { texto, AjudaRecolhida } from "@/components/sistema";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import "@/components/membros/membros.css";

type AcessoDoCartao = {
  rotulo: string;
  ferramenta: boolean;
  liberado: boolean;
  conferindo?: boolean;
};

export function CapaProduto({
  produto,
  destaque = false,
}: {
  produto: Produto;
  destaque?: boolean;
}) {
  const [falhou, setFalhou] = useState(false);
  const capa =
    urlHttps(produto.capa_url) ||
    (destaque ? "/membros/capas/boas-vindas-v2.webp" : null);
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
        {produto.categoria || "Aceleriq · Biblioteca"}
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
  lista,
  alternarLista,
  acesso,
}: {
  titulo: string;
  produtos: Produto[];
  abrir: (p: Produto) => void;
  lista?: string[];
  alternarLista?: (p: Produto) => void;
  acesso?: (p: Produto) => AcessoDoCartao;
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
        {produtos.map((p) => {
          const estado = acesso?.(p) || {
            rotulo: rotuloDoAcesso(p),
            ferramenta: false,
            liberado: podeAbrir(p),
          };
          return (
            <div className="membros-cartao-grupo" key={p.id}>
              <button
                className="membros-cartao"
                onClick={() => abrir(p)}
                aria-label={`${p.titulo} · ${estado.rotulo}`}
                disabled={estado.conferindo}
              >
                <CapaProduto produto={p} />
                <div className="pt-3 px-1">
                  <h3 className="text-[13px] leading-5 font-medium line-clamp-2">
                    {p.titulo}
                  </h3>
                  <p className="text-[12px] leading-5 text-muted-foreground mt-1">
                    {!estado.ferramenta && p.progresso === 100 ? "Concluído" : estado.rotulo}
                    {!estado.ferramenta && estado.liberado &&
                      p.materiais_total !== undefined &&
                      ` · ${p.materiais_total} materiais`}
                  </p>
                  {!estado.ferramenta && p.progresso > 0 && estado.liberado && (
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
              {alternarLista && (
                <button
                  className="membros-favoritar"
                  aria-label={`${lista?.includes(p.id) ? "Retirar" : "Adicionar"} ${p.titulo} ${lista?.includes(p.id) ? "da" : "à"} minha lista`}
                  aria-pressed={!!lista?.includes(p.id)}
                  onClick={() => alternarLista(p)}
                >
                  <Bookmark
                    size={17}
                    fill={lista?.includes(p.id) ? "currentColor" : "none"}
                  />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
function Jornada({ jornada }: { jornada: NonNullable<Catalogo["jornada"]> }) {
  const percentual = jornada.materiais
    ? Math.round((100 * jornada.concluidos) / jornada.materiais)
    : 0;
  return (
    <section className="membros-jornada" aria-label="Sua jornada">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <BookCheck size={17} className="text-primary" />
          <h2 className="text-[14px] font-semibold">Sua jornada</h2>
        </div>
        <p className="text-[12px] text-muted-foreground mt-1">
          {jornada.concluidos} de {jornada.materiais} materiais concluídos
        </p>
        <div
          className="membros-progresso mt-3"
          role="progressbar"
          aria-label="Materiais concluídos"
          aria-valuenow={percentual}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${percentual}%` }} />
        </div>
      </div>
      <div className="membros-conquistas">
        <span className={jornada.concluidos > 0 ? "conquistado" : ""}>
          <Check size={17} />
          {jornada.concluidos > 0
            ? "Primeiro passo concluído"
            : "Sua primeira conquista começa na aula"}
        </span>
        <span className={jornada.produtos_concluidos > 0 ? "conquistado" : ""}>
          <Trophy size={17} />
          {jornada.produtos_concluidos > 0
            ? `${jornada.produtos_concluidos} produto${jornada.produtos_concluidos > 1 ? "s" : ""} concluído${jornada.produtos_concluidos > 1 ? "s" : ""}`
            : "Próxima conquista: concluir um produto"}
        </span>
      </div>
    </section>
  );
}
function ControlesTeste({
  teste,
  mudar,
}: {
  teste: TesteCliente;
  mudar: (bloqueado: boolean) => void;
}) {
  const qc = useQueryClient();
  const [reiniciando, setReiniciando] = useState(false);
  const reinicioRef = useRef<HTMLDetailsElement>(null);
  const [aviso, setAviso] = useState("");
  async function reiniciar() {
    setReiniciando(true);
    setAviso("");
    try {
      await reiniciarTeste();
      await qc.invalidateQueries({ queryKey: ["membros"] });
      if (reinicioRef.current) reinicioRef.current.open = false;
      setAviso("Progresso do teste reiniciado.");
    } catch (e) {
      setAviso(mensagemDoErro(e));
    } finally {
      setReiniciando(false);
    }
  }
  return (
    <aside className="membros-teste" aria-label="Teste como cliente">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <strong className="flex items-center gap-2 text-[13px]">
          <FlaskConical size={17} className="text-primary" />
          Teste como cliente
        </strong>
        <span className="text-[12px] text-muted-foreground">
          {teste.bloqueado
            ? "Bloqueio simulado no servidor"
            : "Somente seus acessos de membro · progresso separado"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          className="membros-acao border border-border"
          aria-pressed={teste.bloqueado}
          onClick={() => mudar(!teste.bloqueado)}
        >
          <LockKeyhole size={15} />
          {teste.bloqueado ? "Voltar ao acesso liberado" : "Simular bloqueio"}
        </button>
        <details ref={reinicioRef} className="relative">
          <summary className="membros-acao cursor-pointer text-muted-foreground">
            <RotateCcw size={15} />
            Reiniciar teste
          </summary>
          <div className="membros-teste-confirmacao">
            <AjudaRecolhida rotulo="Saiba mais">
              Apaga apenas o seu progresso de teste. O acesso manual e o
              progresso dos membros são preservados.
            </AjudaRecolhida>
            <button
              className="membros-acao border border-border mt-2"
              disabled={reiniciando}
              onClick={() => {
                void reiniciar();
              }}
            >
              {reiniciando ? "Reiniciando…" : "Reiniciar progresso do teste"}
            </button>
            <button
              className="membros-acao text-muted-foreground mt-1"
              disabled={reiniciando}
              onClick={() => {
                if (reinicioRef.current) reinicioRef.current.open = false;
              }}
            >
              Cancelar
            </button>
          </div>
        </details>
        <Link
          className="membros-acao text-muted-foreground"
          to="/membros/administrar"
        >
          Sair do teste <ArrowRight size={15} />
        </Link>
      </div>
      {aviso && (
        <p role="status" className="w-full text-[12px]">
          {aviso}
        </p>
      )}
    </aside>
  );
}
export default function AreaDeMembros() {
  const { profile, user, logout } = useAuth();
  const qc = useQueryClient();
  const [secao, setSecao] = useState(() => {
    // Link direto para o estúdio (?secao=estudio | creditos).
    const pedida = new URLSearchParams(window.location.search).get("secao");
    return pedida === "estudio" || pedida === "creditos" ? pedida : "inicio";
  });
  const [recolhida, setRecolhida] = useState(false);
  const [comunidade, setComunidade] = useState("");
  const [avisoLista, setAvisoLista] = useState("");
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("");
  const [parametros, setParametros] = useSearchParams();
  const teste: TesteCliente | undefined =
    parametros.get("modo") === "cliente"
      ? { teste: true, bloqueado: parametros.get("bloqueado") === "1" }
      : undefined;
  const previa = teste ? undefined : parametros.get("visao") || undefined;
  const somenteLeitura = !!previa || !!teste;
  const ferramentas = useCatalogoFerramentas(user?.id, !somenteLeitura);
  // Aceleriq de Bolso (26/10/2026): só aparece quando o banco libera para esta conta.
  const bolso = useEstadoDoBolso(!!user && !somenteLeitura);
  const comBolso = !somenteLeitura && !!bolso.data?.exposto;
  const aberto = parametros.get("produto");
  const setAberto = (id: string | null) => {
    const proximos = new URLSearchParams(parametros);
    if (id) proximos.set("produto", id);
    else proximos.delete("produto");
    setParametros(proximos);
  };
  const catalogo = useQuery({
    queryKey: [
      "membros",
      "catalogo",
      user?.id,
      previa,
      teste?.teste,
      teste?.bloqueado,
    ],
    queryFn: () => carregarCatalogo(previa, teste),
    retry: false,
  });
  const lista = useQuery({
    queryKey: ["membros", "lista", user?.id, !!teste],
    queryFn: () => carregarLista(!!teste),
    enabled: !!user && !previa,
    retry: false,
  });
  const funil = useQuery({
    queryKey: ["membros", "funil", user?.id],
    queryFn: carregarFunil,
    enabled: !!user && !previa && !teste,
    retry: false,
  });
  const [salvandoLista, setSalvandoLista] = useState(false);
  async function alternarLista(p: Produto) {
    if (salvandoLista) return;
    setSalvandoLista(true);
    setAvisoLista("");
    try {
      await favoritar(p.id, !lista.data?.includes(p.id), !!teste);
      await qc.invalidateQueries({ queryKey: ["membros", "lista"] });
    } catch (e) {
      setAvisoLista(mensagemDoErro(e));
    } finally {
      setSalvandoLista(false);
    }
  }
  const propsLista = {
    lista: lista.data,
    alternarLista: previa ? undefined : (p: Produto) => void alternarLista(p),
    acesso: acessoDoCartao,
  };
  function crmDoProduto(id: string) {
    return !somenteLeitura && ferramentas.isSuccess
      ? ferramentas.data.find((f) => f.produto_id === id && f.motor === "crm")
      : undefined;
  }
  function acessoDoCartao(p: Produto): AcessoDoCartao {
    if (!somenteLeitura && !podeAbrir(p) && ferramentas.isPending)
      return {
        rotulo: "Conferindo acesso…",
        ferramenta: true,
        liberado: false,
        conferindo: true,
      };
    if (!somenteLeitura && !podeAbrir(p) && ferramentas.isError)
      return { rotulo: "Conferir acesso", ferramenta: true, liberado: false };
    const crm = crmDoProduto(p.id);
    if (crm) {
      const liberado = temLicencaDaFerramenta(crm);
      return {
        rotulo: liberado ? "Licença ativa" : "Sem licença ativa",
        ferramenta: true,
        liberado,
      };
    }
    return {
      rotulo: rotuloDoAcesso(p),
      ferramenta: false,
      liberado: podeAbrir(p),
    };
  }
  function abrirProduto(p: Produto) {
    if (!somenteLeitura && !ferramentas.isSuccess && !podeAbrir(p)) {
      if (ferramentas.isError) void ferramentas.refetch();
      return;
    }
    if (crmDoProduto(p.id)) {
      const proximos = new URLSearchParams(parametros);
      proximos.delete("produto");
      proximos.set("ferramenta", p.id);
      setParametros(proximos);
      return;
    }
    setAberto(p.id);
  }
  function voltarDasFerramentas() {
    const proximos = new URLSearchParams(parametros);
    proximos.delete("ferramenta");
    // Compatibilidade com links antigos que usavam o leitor de produtos.
    if (aberto && crmDoProduto(aberto)) proximos.delete("produto");
    setParametros(proximos);
    setSecao("ferramentas");
  }
  const ferramentaAberta =
    parametros.get("ferramenta") ||
    (aberto && crmDoProduto(aberto) ? aberto : null);
  const secaoAtual = ferramentaAberta ? "ferramentas" : secao;
  const produtos = catalogo.data?.produtos || [];
  const comunidades = produtos.filter(
    (p) => p.comunidade_ativa && podeAbrir(p),
  );
  const indicados = (funil.data || [])
    .filter((f) => {
      const origem = produtos.find((p) => p.id === f.produto_origem);
      return (
        origem &&
        podeAbrir(origem) &&
        (f.momento === "sempre" || origem.progresso === 100)
      );
    })
    .map((f) => produtos.find((p) => p.id === f.produto_destino))
    .filter((p): p is Produto => !!p && !podeAbrir(p));
  const encontrados = buscarProdutos(produtos, busca, categoria);
  const trilhosDaBiblioteca = trilhos(
    produtos.filter((p) => !crmDoProduto(p.id)),
  );
  for (const p of produtos.filter((p) => !!crmDoProduto(p.id))) {
    const titulo = acessoDoCartao(p).liberado
      ? "Minha biblioteca"
      : "Explorar produtos";
    const trilho = trilhosDaBiblioteca.find((t) => t.titulo === titulo);
    if (trilho) trilho.produtos.push(p);
    else trilhosDaBiblioteca.push({ titulo, produtos: [p] });
  }
  const destaque =
    produtos.find((p) => p.destaque && podeAbrir(p)) ||
    produtos.find((p) => p.destaque) ||
    produtos.find((p) => podeAbrir(p)) ||
    produtos[0];
  const categorias = Array.from(
    new Set(produtos.map((p) => p.categoria).filter(Boolean)),
  );
  const produtoAberto = produtos.find((p) => p.id === aberto);
  const acessoDestaque = destaque ? acessoDoCartao(destaque) : null;
  let acaoDestaque = "Conhecer produto";
  if (acessoDestaque?.conferindo) acaoDestaque = "Conferindo acesso…";
  else if (acessoDestaque?.ferramenta)
    acaoDestaque = acessoDestaque.liberado
      ? "Abrir ferramenta"
      : "Conferir licença";
  else if (destaque && podeAbrir(destaque))
    acaoDestaque = "Continuar na biblioteca";
  return (
    <FocoDeEstudo
      key={user?.id || "visitante"}
      usuario={user?.id || "visitante"}
      leitorAberto={!!produtoAberto && !ferramentaAberta}
    >
      <div className="membros bg-background text-foreground">
        <a
          href="#biblioteca"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:p-4"
        >
          Ir para a biblioteca
        </a>
        <header className="membros-topo">
          <div>
            <Link
              to={
                teste
                  ? `/membros?modo=cliente${teste.bloqueado ? "&bloqueado=1" : ""}`
                  : previa
                    ? `/membros?visao=${encodeURIComponent(previa)}`
                    : "/membros"
              }
              aria-label="Biblioteca Aceleriq"
            >
              <MarcaAceleriq altura={24} />
            </Link>
            <nav
              aria-label="Navegação da biblioteca"
              className="flex items-center min-w-0 gap-1"
            >
              {profile?.role === "admin" && !previa && !teste && (
                <Link
                  className="membros-acao text-muted-foreground"
                  to="/membros/administrar"
                  aria-label="Administrar biblioteca"
                >
                  <Settings2 size={18} />
                  <span className="hidden sm:inline">Administrar</span>
                </Link>
              )}
              {!teste && (
                <Link
                  to={destinoOperacional(profile?.role)}
                  className="membros-acao text-muted-foreground"
                >
                  Painel Aceleriq
                  <ArrowRight size={16} className="hidden sm:block" />
                </Link>
              )}
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
        <div
          className={`membros-biblioteca-corpo ${recolhida ? "recolhida" : ""}`}
        >
          <aside className="membros-menu" aria-label="Menu de membros">
            <button
              className="membros-acao"
              aria-label={
                recolhida
                  ? "Expandir menu de membros"
                  : "Recolher menu de membros"
              }
              onClick={() => setRecolhida((r) => !r)}
            >
              {recolhida ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
            {[
              { id: "inicio", nome: "Início", icone: Home },
              { id: "lista", nome: "Minha lista", icone: Bookmark },
              { id: "comunidade", nome: "Comunidade", icone: MessageCircle },
              { id: "ferramentas", nome: "Ferramentas", icone: Wrench },
              ...(comBolso
                ? [
                    { id: "estudio", nome: "Estúdio", icone: Megaphone },
                    { id: "creditos", nome: "Créditos e acesso", icone: Coins },
                  ]
                : []),
            ].map((i) => (
              <button
                key={i.id}
                className="membros-acao"
                title={i.nome}
                aria-label={i.nome}
                aria-current={secaoAtual === i.id ? "page" : undefined}
                onClick={() => {
                  if (ferramentaAberta) {
                    const proximos = new URLSearchParams(parametros);
                    proximos.delete("ferramenta");
                    if (aberto && crmDoProduto(aberto)) proximos.delete("produto");
                    setParametros(proximos);
                  }
                  setSecao(i.id);
                }}
              >
                <i.icone size={18} />
                <span>{i.nome}</span>
              </button>
            ))}
            <BotaoPomodoro compacto={recolhida} />
          </aside>
          <main id="biblioteca" className="membros-conteudo space-y-8">
            {secaoAtual === "estudio" && comBolso && <EstudioBolso />}
            {secaoAtual === "creditos" && comBolso && <CreditosBolso />}
            {secaoAtual === "ferramentas" && (
              <FerramentasDoMembro
                somenteLeitura={somenteLeitura}
                catalogo={ferramentas}
                produtoInicial={ferramentaAberta}
                aoVoltar={voltarDasFerramentas}
                conhecer={(id) => {
                  if (crmDoProduto(id)) {
                    setAvisoLista(
                      "Peça à administração para conferir sua licença do CRM. Seus contatos e negócios continuam guardados.",
                    );
                    return;
                  }
                  setAberto(id);
                }}
              />
            )}
            {teste && profile?.role === "admin" && (
              <ControlesTeste
                teste={teste}
                mudar={(bloqueado) => {
                  const proximos = new URLSearchParams({ modo: "cliente" });
                  if (bloqueado) proximos.set("bloqueado", "1");
                  setParametros(proximos);
                }}
              />
            )}
            {previa && (
              <aside
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-[13px]"
                aria-label="Visão do cliente"
              >
                <div>
                  <strong>
                    Visão de {catalogo.data?.pessoa?.nome || "cliente"}
                  </strong>
                  <AjudaRecolhida rotulo="Mais informações">
                    Mesma biblioteca e acessos. Esta visualização não altera o
                    progresso.
                  </AjudaRecolhida>
                </div>
                <Link
                  className="membros-acao border border-border"
                  to="/membros/administrar"
                >
                  Sair da visão do cliente
                </Link>
              </aside>
            )}
            {avisoLista && (
              <p role="alert" className="text-[13px]">
                {avisoLista}
              </p>
            )}
            {secaoAtual === "lista" && (
              <section className="space-y-5">
                <TituloMembros titulo="Minha lista" principal>
                  Use o marcador na capa para guardar o que quer assistir
                  depois. Retire da lista pelo mesmo marcador.
                </TituloMembros>
                {previa ? (
                  <p className="text-[13px]">
                    A lista pessoal fica disponível na própria conta do membro.
                  </p>
                ) : lista.isPending ? (
                  <p role="status">Carregando sua lista…</p>
                ) : lista.isError ? (
                  <p role="alert">{mensagemDoErro(lista.error)}</p>
                ) : produtos.some((p) => lista.data?.includes(p.id)) ? (
                  <TrilhoProdutos
                    titulo="Salvos para você"
                    produtos={produtos.filter((p) =>
                      lista.data?.includes(p.id),
                    )}
                    abrir={abrirProduto}
                    {...propsLista}
                  />
                ) : (
                  <div className="membros-estado-vazio">
                    <Bookmark size={19} className="text-muted-foreground" />
                    <p>Sua lista ainda está vazia.</p>
                    <button
                      className="membros-acao"
                      onClick={() => setSecao("inicio")}
                    >
                      Explorar biblioteca
                    </button>
                  </div>
                )}
              </section>
            )}
            {secaoAtual === "comunidade" && (
              <section className="space-y-5">
                <TituloMembros titulo="Comunidade" principal>
                  Escolha um produto para acompanhar as conversas e entrar nos
                  grupos disponíveis.
                </TituloMembros>
                {comunidades.length ? (
                  <>
                    <label className="block text-[12px] space-y-2 max-w-md">
                      <span className="sr-only">Comunidade do produto</span>
                      <select
                        className="w-full bg-muted p-3 rounded-lg"
                        value={comunidade || comunidades[0]?.id}
                        onChange={(e) => setComunidade(e.target.value)}
                      >
                        {comunidades.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.titulo}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ComunidadeDoCurso
                      key={comunidade || comunidades[0].id}
                      produto={comunidade || comunidades[0].id}
                      previa={previa}
                      teste={teste}
                      tituloOculto
                    />
                  </>
                ) : (
                  <div className="membros-estado-vazio">
                    <MessageCircle
                      size={19}
                      className="text-muted-foreground"
                    />
                    <p>Você ainda não tem uma comunidade liberada.</p>
                    <button
                      className="membros-acao"
                      onClick={() => setSecao("inicio")}
                    >
                      Explorar produtos
                    </button>
                  </div>
                )}
              </section>
            )}
            {!somenteLeitura && ferramentas.isError && (
              <div role="alert" className="space-y-3">
                <p>
                  Não foi possível conferir as licenças das ferramentas. Seus
                  conteúdos já liberados continuam disponíveis.
                </p>
                <button
                  className="membros-acao"
                  onClick={() => void ferramentas.refetch()}
                >
                  Conferir licenças novamente
                </button>
              </div>
            )}
            <div hidden={secaoAtual !== "inicio"} className="space-y-8">
              {produtos.length > 0 && (
                <CabecalhoDePagina
                  className="sr-only"
                  titulo={<> Biblioteca Aceleriq </>}
                />
              )}
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
                  <CabecalhoDePagina
                    titulo={<> Não conseguimos abrir sua biblioteca </>}
                  />
                  <p className={texto.corpo}>
                    {mensagemDoErro(catalogo.error)}
                  </p>
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
                  <CabecalhoDePagina
                    titulo={<> Sua biblioteca começa aqui </>}
                  />
                  <AjudaRecolhida rotulo="Saiba mais">
                    Ainda não há produtos disponíveis. Quando um material for
                    publicado ou seu acesso for concedido, ele aparecerá aqui.
                  </AjudaRecolhida>
                  {profile?.role === "admin" && !previa && !teste && (
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
                      <div className="membros-destaque-capa" aria-hidden="true">
                        <CapaProduto
                          key={destaque.id}
                          produto={destaque}
                          destaque
                        />
                      </div>
                      <div className="membros-destaque-texto space-y-4">
                        <p className="text-[12px] text-emerald-300 font-medium">
                          {acessoDestaque?.rotulo} · {destaque.formato}
                        </p>
                        <div className="flex items-center gap-2">
                          <h2>{destaque.titulo}</h2>
                          <AjudaRecolhida rotulo={`Sobre ${destaque.titulo}`}>
                            {destaque.descricao}
                          </AjudaRecolhida>
                        </div>
                        <button
                          className="membros-acao bg-primary text-primary-foreground"
                          onClick={() => abrirProduto(destaque)}
                          disabled={acessoDestaque?.conferindo}
                        >
                          {acaoDestaque}
                          {acessoDestaque?.ferramenta && acessoDestaque.liberado ? (
                            <Wrench size={16} />
                          ) : podeAbrir(destaque) && !acessoDestaque?.ferramenta ? (
                            <Play size={16} fill="currentColor" />
                          ) : (
                            <LockKeyhole size={16} />
                          )}
                        </button>
                      </div>
                    </section>
                  )}
                  {catalogo.data?.jornada && (
                    <Jornada jornada={catalogo.data.jornada} />
                  )}
                  {comBolso && !busca && !categoria && (
                    <section
                      className="bolso-entrada"
                      aria-label="Aceleriq de Bolso"
                    >
                      <div className="bolso-entrada-marca">
                        <span className="bolso-entrada-icone" aria-hidden="true"><Megaphone size={23} /></span>
                        <p className="text-[15px] font-semibold">
                          Aceleriq de Bolso
                        </p>
                      </div>
                      <button
                        className="membros-acao bg-primary text-primary-foreground"
                        onClick={() => setSecao("estudio")}
                      >
                        Abrir o estúdio
                        <ArrowRight size={16} aria-hidden="true" />
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
                    <p
                      role="status"
                      className="text-[13px] text-muted-foreground"
                    >
                      Há pagamento aguardando confirmação. O acesso aparecerá
                      aqui após a conferência.
                    </p>
                  ) : null}
                  {indicados.length > 0 && (
                    <TrilhoProdutos
                      titulo="Seu próximo passo"
                      produtos={Array.from(
                        new Map(indicados.map((p) => [p.id, p])).values(),
                      )}
                      abrir={abrirProduto}
                      {...propsLista}
                    />
                  )}
                  {busca || categoria ? (
                    encontrados.length ? (
                      <TrilhoProdutos
                        {...propsLista}
                        titulo="Resultados da busca"
                        produtos={encontrados}
                        abrir={abrirProduto}
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
                    trilhosDaBiblioteca.map((t) => (
                      <TrilhoProdutos
                        key={t.titulo}
                        {...propsLista}
                        titulo={t.titulo}
                        produtos={t.produtos}
                        abrir={abrirProduto}
                      />
                    ))
                  )}
                </>
              )}
            </div>
          </main>
        </div>
        {aberto && catalogo.isSuccess && !produtoAberto && (
          <section role="alert" className="membros-conteudo">
            <p>Este produto está indisponível.</p>
            <button className="membros-acao" onClick={() => setAberto(null)}>
              Voltar à biblioteca
            </button>
          </section>
        )}
        {produtoAberto &&
          !ferramentaAberta &&
          (somenteLeitura || ferramentas.isSuccess || podeAbrir(produtoAberto)) && (
          <LeitorDeProduto
            key={`${previa || "proprio"}-${teste?.teste}-${teste?.bloqueado}-${produtoAberto.id}`}
            previa={previa}
            teste={teste}
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
    </FocoDeEstudo>
  );
}
