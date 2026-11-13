import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Home, KanbanSquare, LayoutGrid, LogOut, Mail, BookOpen, Settings2, UserRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useProduto } from "@/hooks/useProduto";
import { definirEscopoDoCrm, type EscopoDoCrm } from "@/lib/comercial/escopo";
import { avisoDaConta, type EstadoDoProduto } from "@/lib/produto/api";
import { Carregando, EstadoDeErro, MenuMais, botao, foco, juntar, texto } from "@/components/sistema";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import InicioDoProduto from "@/components/produto/InicioDoProduto";
import PrimeirosPassos from "@/components/produto/PrimeirosPassos";
import SemAcesso from "@/components/produto/SemAcesso";
import CriarSenha from "@/components/produto/CriarSenha";

const AdminComercial = lazy(() => import("@/pages/AdminComercial"));
const EmailDoProduto = lazy(() => import("@/components/produto/EmailDoProduto"));
const ContaDoProduto = lazy(() => import("@/components/produto/ContaDoProduto"));

/**
 * O produto CRM e E-mail (13/11/2026): um lugar à parte do painel e da área
 * de membros, com entrada, menu e endereço próprios (/app).
 *
 * Três visões saem da mesma casca: quem administra a empresa vê a Conta
 * (equipe, plano e cobrança); o usuário vê o CRM e o e-mail; a casa administra
 * tudo em /produto, dentro do painel. O CRM é a mesma tela do Comercial da
 * casa, lendo as tabelas da empresa (src/lib/comercial/escopo.ts).
 */

type Secao = "inicio" | "crm" | "email" | "conta";

const SECOES: Array<{ valor: Secao; rotulo: string; icone: ReactNode; para: string }> = [
  { valor: "inicio", rotulo: "Início", icone: <Home className="h-[18px] w-[18px]" aria-hidden="true" />, para: "/app" },
  { valor: "crm", rotulo: "CRM", icone: <KanbanSquare className="h-[18px] w-[18px]" aria-hidden="true" />, para: "/app/crm" },
  { valor: "email", rotulo: "E-mail", icone: <Mail className="h-[18px] w-[18px]" aria-hidden="true" />, para: "/app/email" },
  { valor: "conta", rotulo: "Conta", icone: <Building2 className="h-[18px] w-[18px]" aria-hidden="true" />, para: "/app/conta" },
];

const ehDoComercial = (chave: readonly unknown[]) => typeof chave[0] === "string" && String(chave[0]).indexOf("comercial") === 0;

/** Monta o CRM com os dados da empresa e desmonta sem deixar nada para o Comercial da casa. */
function CrmDaEmpresa({ estado }: { estado: EstadoDoProduto }) {
  const qc = useQueryClient();
  const conta = estado.conta!;
  const escopo = useMemo<EscopoDoCrm>(
    () => ({
      modo: "conta",
      contaId: conta.id,
      base: "/app/crm",
      equipe: estado.equipe.filter((m) => m.estado === "ativo" && m.user_id).map((m) => ({ id: String(m.user_id), nome: m.nome || m.email || "Sem nome" })),
      limites: estado.plano ? estado.plano.limites : { maquina_buscas_mes: 0, maquina_google_maps: false, maquina_limite_por_busca: 50, privacidade_por_vendedor: false, campanhas: false },
      maquinaNoMes: estado.maquina_no_mes,
    }),
    [conta.id, estado.equipe, estado.plano, estado.maquina_no_mes],
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

export default function ProdutoApp() {
  const { secao: secaoDaUrl } = useParams<{ secao?: string }>();
  const navigate = useNavigate();
  const { user, profile, logout } = useAuth();
  const produto = useProduto();
  const estado = produto.data;

  const secao: Secao = SECOES.some((s) => s.valor === secaoDaUrl) ? (secaoDaUrl as Secao) : "inicio";
  const papelNoPainel = profile ? profile.role : "member";
  const temPainel = ["admin", "client", "design", "traffic", "manager"].indexOf(papelNoPainel) >= 0;

  const menuDaPessoa = (
    <MenuMais
      rotulo="Minha conta e outros lugares"
      itens={[
        temPainel && { rotulo: papelNoPainel === "client" ? "Painel do cliente" : "Painel da agência", icone: <LayoutGrid className="h-4 w-4" />, aoEscolher: () => navigate("/dashboard") },
        { rotulo: "Área de membros", icone: <BookOpen className="h-4 w-4" />, aoEscolher: () => navigate("/membros") },
        estado && estado.dono_da_casa && { rotulo: "Administrar o produto", icone: <Settings2 className="h-4 w-4" />, aoEscolher: () => navigate("/produto") },
        { rotulo: "Meu acesso", icone: <UserRound className="h-4 w-4" />, aoEscolher: () => navigate("/app/conta?parte=acesso"), separadorAntes: true },
        { rotulo: "Sair", icone: <LogOut className="h-4 w-4" />, aoEscolher: () => void logout() },
      ]}
    />
  );

  let corpo: ReactNode;
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
  else if (secao === "email") corpo = <Suspense fallback={<Carregando forma="aba" />}><EmailDoProduto estado={estado} /></Suspense>;
  else if (secao === "conta") corpo = <Suspense fallback={<Carregando forma="aba" />}><ContaDoProduto estado={estado} /></Suspense>;
  else corpo = <InicioDoProduto estado={estado} />;

  const aviso = estado ? avisoDaConta(estado) : null;
  const comMenu = !!(estado && estado.conta);

  return (
    <div className="min-h-screen bg-background text-foreground" data-produto-app="">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-border bg-background pt-[env(safe-area-inset-top)]" data-produto-topo="">
        <div className="mx-auto flex h-[52px] w-full max-w-[1840px] min-w-0 items-center px-4 md:px-6">
          <Link to="/app" className={juntar("mr-4 flex shrink-0 items-center rounded-md", foco)} aria-label="Início do CRM e E-mail">
            <MarcaAceleriq altura={20} />
          </Link>
          {comMenu && (
            <nav className="hidden min-w-0 flex-1 items-center md:flex" aria-label="Áreas do produto">
              {SECOES.map((s) => (
                <Link
                  key={s.valor}
                  to={s.para}
                  aria-current={secao === s.valor ? "page" : undefined}
                  className={juntar(
                    "mr-1 inline-flex h-9 shrink-0 items-center rounded-md px-3 text-[13px] font-medium transition-colors",
                    foco,
                    secao === s.valor ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="mr-2">{s.icone}</span>
                  {s.rotulo}
                </Link>
              ))}
            </nav>
          )}
          <span className="min-w-0 flex-1 md:hidden" />
          {estado && estado.conta && (
            <span className={juntar(texto.auxiliar, "mr-2 hidden min-w-0 max-w-[220px] truncate lg:block")} title={estado.conta.nome}>{estado.conta.nome}</span>
          )}
          {menuDaPessoa}
        </div>
      </header>

      <main
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] top-[calc(env(safe-area-inset-top)+52px)] mx-auto w-full max-w-[1840px] overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4 md:static md:overflow-visible md:px-6 md:pb-10 md:pt-[calc(env(safe-area-inset-top)+72px)]"
        style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
        data-produto-conteudo=""
      >
        {aviso && (
          <div className={juntar("mb-4 flex min-w-0 items-center rounded-md px-3 py-2", COR_DO_AVISO[aviso.tom])} role="status" data-aviso-da-conta={aviso.tom}>
            <p className="mr-3 min-w-0 flex-1 text-[13px] font-medium leading-5">{aviso.texto}</p>
            {aviso.acao && secao !== "conta" && (
              <Link to="/app/conta?parte=plano" className={juntar(botao.secundario, "h-8 border-current/30 text-current")}>{aviso.acao}</Link>
            )}
          </div>
        )}
        {corpo}
      </main>

      {comMenu && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Áreas do produto" data-produto-barra="">
          <ul className="grid h-14 grid-cols-4">
            {SECOES.map((s) => (
              <li key={s.valor} className="min-w-0">
                <Link
                  to={s.para}
                  aria-current={secao === s.valor ? "page" : undefined}
                  className={juntar("flex h-14 min-w-0 flex-col items-center justify-center", foco, secao === s.valor ? "text-primary" : "text-muted-foreground")}
                >
                  {s.icone}
                  <span className="mt-0.5 max-w-full truncate text-[11px] font-medium leading-4">{s.rotulo}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {user && estado && estado.conta && <CriarSenha />}
    </div>
  );
}
