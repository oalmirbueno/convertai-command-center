import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BookOpen, CalendarClock, FileText, KanbanSquare, LayoutDashboard, LayoutGrid, LogOut, Magnet, Mail, Megaphone, Menu, Moon, Palette, Plug, Radar, Settings2, Sun, Target, UserRound, Users, Workflow, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useProduto, useRelerProduto } from "@/hooks/useProduto";
import { variaveisDaCor } from "@/lib/produto/aparencia";
import "@/components/produto/produto.css";
import { definirEscopoDoCrm, type EscopoDoCrm } from "@/lib/comercial/escopo";
import { ROTULO_DO_PAPEL, avisoDaConta, ehGestor, listarAvisos, marcarAvisosLidos, type EstadoDoProduto } from "@/lib/produto/api";
import { Carregando, EstadoDeErro, MenuMais, botao, foco, juntar, texto } from "@/components/sistema";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import { Foto } from "@/components/produto/pecas";
import InicioDoProduto from "@/components/produto/InicioDoProduto";
import PrimeirosPassos from "@/components/produto/PrimeirosPassos";
import SemAcesso from "@/components/produto/SemAcesso";
import CriarSenha from "@/components/produto/CriarSenha";

const AdminComercial = lazy(() => import("@/pages/AdminComercial"));
const EmailDoProduto = lazy(() => import("@/components/produto/EmailDoProduto"));
const ContaDoProduto = lazy(() => import("@/components/produto/ContaDoProduto"));
const EquipeDoProduto = lazy(() => import("@/components/produto/EquipeDoProduto"));
const AutomacoesDaConta = lazy(() => import("@/components/produto/AutomacoesDaConta"));
const CaptacaoDaConta = lazy(() => import("@/components/produto/CaptacaoDaConta"));
const EspacoDaConta = lazy(() => import("@/components/produto/espaco/EspacoDaConta"));

/**
 * O produto CRM e E-mail (13/11/2026): um lugar à parte do painel e da área
 * de membros, com entrada, menu e endereço próprios (/app).
 *
 * Rodada 2: o CRM ganhou menu lateral com as áreas de venda (painel, funil,
 * agenda, metas, máquina de leads) e de gestão (equipe, automações, captação,
 * espaço). O E-mail é outro produto: fica na troca do topo, com área própria,
 * sem se misturar com o CRM. O CRM é a mesma tela do Comercial da casa, lendo
 * as tabelas da empresa (src/lib/comercial/escopo.ts).
 */

type Secao = "inicio" | "crm" | "equipe" | "automacoes" | "captacao" | "espaco" | "email" | "conta";
const SECOES: Secao[] = ["inicio", "crm", "equipe", "automacoes", "captacao", "espaco", "email", "conta"];

interface ItemDoMenu {
  rotulo: string;
  para: string;
  icone: ReactNode;
  /** Trechos do endereço que deixam o item ativo. */
  ativo: (caminho: string) => boolean;
}

const I = "h-[18px] w-[18px]";

function itensDoCrm(estado: EstadoDoProduto): Array<{ grupo: string; itens: ItemDoMenu[] }> {
  const campanhas = !!estado.plano && estado.plano.limites.campanhas;
  const comeca = (p: string) => (c: string) => c === p || c.indexOf(`${p}/`) === 0;
  return [
    {
      grupo: "Vender",
      itens: [
        { rotulo: "Painel", para: "/app", icone: <LayoutDashboard className={I} aria-hidden="true" />, ativo: (c) => c === "/app" || c === "/app/" || c === "/app/inicio" },
        { rotulo: "Funil", para: "/app/crm/crm", icone: <KanbanSquare className={I} aria-hidden="true" />, ativo: (c) => c === "/app/crm" || comeca("/app/crm/crm")(c) },
        { rotulo: "Agenda", para: "/app/crm/agenda", icone: <CalendarClock className={I} aria-hidden="true" />, ativo: comeca("/app/crm/agenda") },
        { rotulo: "Metas", para: "/app/crm/metas", icone: <Target className={I} aria-hidden="true" />, ativo: comeca("/app/crm/metas") },
        { rotulo: "Máquina de leads", para: "/app/crm/leads", icone: <Radar className={I} aria-hidden="true" />, ativo: comeca("/app/crm/leads") },
        ...(campanhas ? [{ rotulo: "Campanhas", para: "/app/crm/campanhas", icone: <Megaphone className={I} aria-hidden="true" />, ativo: comeca("/app/crm/campanhas") }] : []),
      ],
    },
    {
      grupo: "Equipe e gestão",
      itens: [
        { rotulo: "Equipe", para: "/app/equipe", icone: <Users className={I} aria-hidden="true" />, ativo: comeca("/app/equipe") },
        { rotulo: "Automações", para: "/app/automacoes", icone: <Workflow className={I} aria-hidden="true" />, ativo: comeca("/app/automacoes") },
        { rotulo: "Captação", para: "/app/captacao", icone: <Magnet className={I} aria-hidden="true" />, ativo: comeca("/app/captacao") },
        { rotulo: "Espaço", para: "/app/espaco", icone: <FileText className={I} aria-hidden="true" />, ativo: comeca("/app/espaco") },
      ],
    },
  ];
}

const ehDoComercial = (chave: readonly unknown[]) => typeof chave[0] === "string" && String(chave[0]).indexOf("comercial") === 0;

/** Monta o CRM com os dados da empresa e desmonta sem deixar nada para o Comercial da casa. */
function CrmDaEmpresa({ estado }: { estado: EstadoDoProduto }) {
  const qc = useQueryClient();
  const conta = estado.conta!;
  const papel = estado.eu ? estado.eu.papel : "usuario";
  const meuId = (estado.equipe.filter((m) => estado.eu && m.id === estado.eu.membro_id)[0] || { user_id: null }).user_id;
  const escopo = useMemo<EscopoDoCrm>(
    () => ({
      modo: "conta",
      contaId: conta.id,
      base: "/app/crm",
      equipe: estado.equipe.filter((m) => m.estado === "ativo" && m.user_id).map((m) => ({ id: String(m.user_id), nome: m.nome || m.email || "Sem nome" })),
      limites: estado.plano ? estado.plano.limites : { maquina_buscas_mes: 0, maquina_google_maps: false, maquina_limite_por_busca: 50, privacidade_por_vendedor: false, campanhas: false },
      maquinaNoMes: estado.maquina_no_mes,
      rotulos: conta.perfil.etapas || {},
      papel,
      euId: meuId ? String(meuId) : null,
      distribuiLivre: estado.ve_tudo,
      nicho: conta.perfil.nicho || null,
    }),
    [conta.id, conta.perfil, estado.equipe, estado.plano, estado.maquina_no_mes, papel, meuId, estado.ve_tudo],
  );
  // Antes do primeiro desenho: o que estiver guardado do Comercial da casa sai, e o escopo passa a ser a empresa.
  useState(() => {
    qc.removeQueries({ predicate: (q) => ehDoComercial(q.queryKey) });
    return null;
  });
  definirEscopoDoCrm(escopo);
  useEffect(
    () => () => {
      definirEscopoDoCrm(null);
      qc.removeQueries({ predicate: (q) => ehDoComercial(q.queryKey) });
    },
    [qc],
  );
  return (
    <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo o CRM" />}>
      <AdminComercial />
    </Suspense>
  );
}

const COR_DO_AVISO = { info: "bg-primary/10 text-primary", alerta: "bg-warning/10 text-warning", perigo: "bg-destructive/10 text-destructive" } as const;

const haQuanto = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return min <= 1 ? "agora" : `há ${min} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} d`;
};

/** O sino: repasses, negócios novos para a pessoa e avisos das automações. */
function Sino({ novos, contaId }: { novos: number; contaId: string }) {
  const [aberto, setAberto] = useState(false);
  const reler = useRelerProduto();
  const avisos = useQuery({ queryKey: ["produto", "avisos", contaId], queryFn: listarAvisos, enabled: aberto });
  useEffect(() => {
    if (!aberto) return undefined;
    if (novos > 0) void marcarAvisosLidos().then(() => reler()).catch(() => undefined);
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);
  return (
    <div className="relative mr-1">
      <button type="button" className={botao.icone} onClick={() => setAberto((v) => !v)} aria-label={novos ? `Avisos, ${novos} novos` : "Avisos"} aria-expanded={aberto} title="Avisos" data-sino="">
        <Bell className="h-4 w-4" aria-hidden="true" />
        {novos > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />}
      </button>
      {aberto && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Fechar os avisos" onClick={() => setAberto(false)} />
          <div className="produto-entra absolute right-0 top-10 z-50 w-[320px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-card p-2 shadow-lg" role="dialog" aria-label="Avisos" data-avisos="">
            <p className={juntar(texto.rotulo, "px-2 pb-1 pt-1")}>Avisos</p>
            {avisos.isLoading ? (
              <Carregando linhas={3} rotulo="Carregando os avisos" />
            ) : !avisos.data || avisos.data.length === 0 ? (
              <p className={juntar(texto.auxiliar, "px-2 py-3")}>Nada por aqui. Repasses e avisos das automações aparecem neste sino.</p>
            ) : (
              <ul className="max-h-[60vh] min-w-0 overflow-y-auto">
                {avisos.data.map((a) => (
                  <li key={a.id}>
                    <Link to="/app/crm/crm" onClick={() => setAberto(false)} className={juntar("block min-w-0 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60", foco)}>
                      <span className="flex min-w-0 items-baseline">
                        <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{a.titulo}</span>
                        <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>{haQuanto(a.criado_em)}</span>
                      </span>
                      {a.texto && <span className={juntar(texto.auxiliar, "block truncate")}>{a.texto}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function ProdutoApp() {
  const { secao: secaoDaUrl } = useParams<{ secao?: string }>();
  const navigate = useNavigate();
  const local = useLocation();
  const { user, profile, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const produto = useProduto();
  const estado = produto.data;
  const [gaveta, setGaveta] = useState(false);

  const secao: Secao = SECOES.indexOf(secaoDaUrl as Secao) >= 0 ? (secaoDaUrl as Secao) : "inicio";
  const papelNoPainel = profile ? profile.role : "member";
  const temPainel = ["admin", "client", "design", "traffic", "manager"].indexOf(papelNoPainel) >= 0;
  const admin = !!(estado && estado.conta && estado.eu && estado.eu.papel === "admin");
  const gestor = !!(estado && estado.eu && ehGestor(estado.eu.papel));
  const noEmail = secao === "email";
  useEffect(() => setGaveta(false), [local.pathname, local.search]);

  const menuDaPessoa = (
    <MenuMais
      rotulo="Minha conta e outros lugares"
      itens={[
        temPainel && { rotulo: papelNoPainel === "client" ? "Painel do cliente" : "Painel da agência", icone: <LayoutGrid className="h-4 w-4" />, aoEscolher: () => navigate("/dashboard") },
        { rotulo: "Área de membros", icone: <BookOpen className="h-4 w-4" />, aoEscolher: () => navigate("/membros") },
        estado && estado.dono_da_casa && { rotulo: "Administrar o produto", icone: <Settings2 className="h-4 w-4" />, aoEscolher: () => navigate("/produto") },
        admin && { rotulo: "Conexões", icone: <Plug className="h-4 w-4" />, aoEscolher: () => navigate("/app/conta?parte=conexoes"), separadorAntes: true },
        admin && { rotulo: "Personalizar", icone: <Palette className="h-4 w-4" />, aoEscolher: () => navigate("/app/conta?parte=aparencia") },
        { rotulo: "Meu acesso", icone: <UserRound className="h-4 w-4" />, aoEscolher: () => navigate("/app/conta?parte=acesso"), separadorAntes: !admin },
        { rotulo: "Sair", icone: <LogOut className="h-4 w-4" />, aoEscolher: () => void logout() },
      ]}
    />
  );

  let corpo: ReactNode;
  const espera = <Carregando forma="aba" />;
  if (produto.isLoading) corpo = <Carregando forma="aba" rotulo="Abrindo" />;
  else if (produto.isError || !estado) {
    corpo = (
      <EstadoDeErro
        titulo="Não foi possível abrir agora."
        acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void produto.refetch()}>Tentar de novo</button>}
      />
    );
  } else if (!estado.conta) corpo = <PrimeirosPassos estado={estado} />;
  else if (secaoDaUrl === "bem-vindo") corpo = <Navigate to="/app" replace />;
  else if (secao === "crm") corpo = estado.crm ? <CrmDaEmpresa estado={estado} /> : <SemAcesso estado={estado} produto="crm" />;
  else if (secao === "email") corpo = <Suspense fallback={espera}><EmailDoProduto estado={estado} /></Suspense>;
  else if (secao === "conta") corpo = <Suspense fallback={espera}><ContaDoProduto estado={estado} /></Suspense>;
  else if (secao === "equipe") corpo = <Suspense fallback={espera}><EquipeDoProduto estado={estado} /></Suspense>;
  else if (!estado.crm && secao !== "inicio") corpo = <SemAcesso estado={estado} produto="crm" />;
  else if (secao === "automacoes") corpo = <Suspense fallback={espera}><AutomacoesDaConta estado={estado} /></Suspense>;
  else if (secao === "captacao") corpo = <Suspense fallback={espera}><CaptacaoDaConta estado={estado} /></Suspense>;
  else if (secao === "espaco") corpo = <Suspense fallback={espera}><EspacoDaConta estado={estado} /></Suspense>;
  else corpo = <InicioDoProduto estado={estado} />;

  const aviso = estado ? avisoDaConta(estado) : null;
  const comMenu = !!(estado && estado.conta);
  const comLateral = comMenu && !noEmail;
  // A personalização da empresa: cor de destaque (um tom por tema), logo e nome curto.
  const aparencia = estado && estado.conta ? estado.conta.aparencia : {};
  const cores = variaveisDaCor(aparencia.cor, theme) as CSSProperties;
  const nomeNoTopo = estado && estado.conta ? aparencia.nome_curto || estado.conta.nome : "";
  const grupos = estado && estado.conta ? itensDoCrm(estado) : [];
  const euNaEquipe = estado && estado.eu ? estado.equipe.filter((m) => m.id === estado.eu!.membro_id)[0] : null;

  const linkDoMenu = (item: ItemDoMenu) => {
    const ativo = item.ativo(local.pathname);
    return (
      <Link
        key={item.para}
        to={item.para}
        aria-current={ativo ? "page" : undefined}
        className={juntar("produto-item-do-menu flex h-9 min-w-0 items-center rounded-lg px-2.5 text-[13px] font-medium", foco, ativo ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
      >
        <span className={juntar("mr-2.5 shrink-0", ativo && "text-primary")}>{item.icone}</span>
        <span className="min-w-0 truncate">{item.rotulo}</span>
      </Link>
    );
  };

  const lateral = (
    <>
      {grupos.map((g) => (
        <div key={g.grupo} className="mb-5 min-w-0">
          <p className="mb-1.5 px-2.5 text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-muted-foreground">{g.grupo}</p>
          <div className="space-y-0.5">{g.itens.map(linkDoMenu)}</div>
        </div>
      ))}
      <div className="mt-auto min-w-0 border-t border-border pt-3">
        {linkDoMenu({ rotulo: "Configurações", para: admin ? "/app/conta?parte=plano" : "/app/conta?parte=acesso", icone: <Settings2 className={I} aria-hidden="true" />, ativo: (c) => c.indexOf("/app/conta") === 0 })}
        {estado && estado.eu && (
          <Link to="/app/equipe" className={juntar("mt-2 flex min-w-0 items-center rounded-lg px-2 py-2 transition-colors hover:bg-muted/60", foco)} data-eu-no-menu="">
            <Foto nome={estado.eu.nome || estado.eu.email} foto={euNaEquipe ? euNaEquipe.foto : null} tamanho="p" />
            <span className="ml-2.5 min-w-0 flex-1">
              <span className={juntar(texto.corpo, "block truncate font-medium")}>{estado.eu.nome || estado.eu.email}</span>
              <span className={juntar(texto.auxiliar, "block truncate")}>{estado.eu.cargo || ROTULO_DO_PAPEL[estado.eu.papel]}</span>
            </span>
          </Link>
        )}
      </div>
    </>
  );

  const troca = comMenu && (
    <div className="mr-2 flex h-8 shrink-0 items-center rounded-lg bg-muted/60 p-0.5" role="tablist" aria-label="Produtos" data-troca-de-produto="">
      {[
        { rotulo: "CRM", para: "/app", ativo: !noEmail, icone: <KanbanSquare className="h-3.5 w-3.5" aria-hidden="true" /> },
        { rotulo: "E-mail", para: "/app/email", ativo: noEmail, icone: <Mail className="h-3.5 w-3.5" aria-hidden="true" /> },
      ].map((p) => (
        <Link key={p.rotulo} to={p.para} role="tab" aria-selected={p.ativo} className={juntar("inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium transition-colors", foco, p.ativo ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          <span className="mr-1.5">{p.icone}</span>
          {p.rotulo}
        </Link>
      ))}
    </div>
  );

  const barraDeBaixo: ItemDoMenu[] = grupos.length ? [grupos[0].itens[0], grupos[0].itens[1], grupos[0].itens[2], grupos[1].itens[0]] : [];

  return (
    <div className="produto-fundo min-h-screen text-foreground" style={cores} data-produto-app="" data-cor-da-empresa={aparencia.cor || "verde"}>
      {/* Não é <header>: o tema claro do painel pinta de branco os links de "header nav", e aqui o topo é claro. */}
      <div role="banner" className="produto-vidro fixed inset-x-0 top-0 z-30 border-b border-border pt-[env(safe-area-inset-top)]" data-produto-topo="">
        <div className="flex h-[52px] w-full min-w-0 items-center px-4 md:px-5">
          <Link to="/app" className={juntar("mr-4 flex min-w-0 shrink-0 items-center rounded-md md:w-[204px]", foco)} aria-label="Início do CRM">
            {aparencia.logo ? (
              <img src={aparencia.logo} alt={nomeNoTopo} className="h-7 w-auto max-w-[140px] object-contain" data-logo-da-empresa="" />
            ) : (
              <MarcaAceleriq altura={20} className="logo-do-topo" />
            )}
          </Link>
          {troca}
          <span className="min-w-0 flex-1" />
          {nomeNoTopo && !aparencia.logo && (
            <span className={juntar(texto.auxiliar, "mr-2 hidden min-w-0 max-w-[220px] truncate lg:block")} title={nomeNoTopo}>{nomeNoTopo}</span>
          )}
          {comMenu && estado && estado.conta && estado.crm && <Sino novos={estado.avisos_novos} contaId={estado.conta.id} />}
          <button type="button" className={juntar(botao.icone, "mr-1")} onClick={toggleTheme} aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"} title={theme === "dark" ? "Tema claro" : "Tema escuro"} data-trocar-tema="">
            {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </button>
          {menuDaPessoa}
        </div>
      </div>

      {comLateral && (
        <nav className="fixed bottom-0 left-0 top-[calc(env(safe-area-inset-top)+52px)] z-20 hidden w-[232px] flex-col overflow-y-auto border-r border-border px-3 pb-3 pt-5 md:flex" aria-label="Áreas do CRM" data-produto-lateral="">
          {lateral}
        </nav>
      )}

      <main
        className={juntar(
          "fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] top-[calc(env(safe-area-inset-top)+52px)] w-full overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4 md:static md:overflow-visible md:px-7 md:pb-10 md:pt-[calc(env(safe-area-inset-top)+76px)]",
          comLateral ? "md:pl-[260px]" : "mx-auto max-w-[1320px]",
        )}
        style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
        data-produto-conteudo=""
      >
        <div className={juntar("min-w-0", comLateral && "mx-auto w-full max-w-[1560px]")}>
          {aviso && (
            <div className={juntar("mb-4 flex min-w-0 items-center rounded-lg px-3 py-2", COR_DO_AVISO[aviso.tom])} role="status" data-aviso-da-conta={aviso.tom}>
              <p className="mr-3 min-w-0 flex-1 text-[13px] font-medium leading-5">{aviso.texto}</p>
              {aviso.acao && secao !== "conta" && (
                <Link to="/app/conta?parte=plano" className={juntar(botao.secundario, "h-8 border-current/30 text-current")}>{aviso.acao}</Link>
              )}
            </div>
          )}
          <div key={estado && !estado.conta ? "primeiros-passos" : secao} className="produto-entra min-w-0">
            {corpo}
          </div>
        </div>
      </main>

      {comMenu && (
        <nav className="produto-vidro fixed inset-x-0 bottom-0 z-30 border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Áreas do produto" data-produto-barra="">
          <ul className="grid h-14 grid-cols-5">
            {barraDeBaixo.map((s) => {
              const ativo = !noEmail && s.ativo(local.pathname);
              return (
                <li key={s.para} className="min-w-0">
                  <Link to={s.para} aria-current={ativo ? "page" : undefined} className={juntar("flex h-14 min-w-0 flex-col items-center justify-center", foco, ativo ? "text-primary" : "text-muted-foreground")}>
                    {s.icone}
                    <span className="mt-0.5 max-w-full truncate text-[11px] font-medium leading-4">{s.rotulo}</span>
                  </Link>
                </li>
              );
            })}
            <li className="min-w-0">
              <button type="button" onClick={() => setGaveta(true)} className={juntar("flex h-14 w-full min-w-0 flex-col items-center justify-center text-muted-foreground", foco)} aria-label="Mais áreas" data-mais-areas="">
                <Menu className={I} aria-hidden="true" />
                <span className="mt-0.5 text-[11px] font-medium leading-4">Mais</span>
              </button>
            </li>
          </ul>
        </nav>
      )}

      {gaveta && comMenu && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-label="Todas as áreas" data-gaveta="">
          <button type="button" className="absolute inset-0 bg-black/50" aria-label="Fechar" onClick={() => setGaveta(false)} />
          <div className="produto-entra absolute inset-x-0 bottom-0 flex max-h-[86vh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-card px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3">
            <div className="mb-3 flex items-center">
              <p className={juntar(texto.tituloSecao, "flex-1")}>Todas as áreas</p>
              <button type="button" className={botao.icone} onClick={() => setGaveta(false)} aria-label="Fechar"><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            {lateral}
            <Link to="/app/email" className={juntar("mt-3 flex h-10 items-center rounded-lg border border-border px-3 text-[13px] font-medium", foco)}>
              <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
              E-mail profissional
            </Link>
          </div>
        </div>
      )}

      {user && estado && estado.conta && <CriarSenha />}
      {/* Só para o leitor de tela e os testes saberem o nível de quem está logado. */}
      {estado && estado.eu && <span className="sr-only" data-nivel-de-acesso-atual={estado.eu.papel}>{gestor ? "Gestão" : "Vendas"}</span>}
    </div>
  );
}
