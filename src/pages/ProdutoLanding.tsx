import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarClock, KanbanSquare, Mail, Radar, Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { listarPlanos, reais } from "@/lib/produto/api";
import { Carregando, botao, juntar, texto } from "@/components/sistema";
import CascaPublica from "@/components/publico/CascaPublica";
import EscolhaDePlano from "@/components/produto/EscolhaDePlano";

const O_QUE_TEM = [
  { icone: KanbanSquare, titulo: "Funil de vendas", linha: "Arraste cada negócio de etapa e veja o que está parado." },
  { icone: Building2, titulo: "Empresas e contatos", linha: "A ficha guarda a história de cada cliente." },
  { icone: CalendarClock, titulo: "Agenda e lembretes", linha: "Todo negócio aberto com o próximo passo marcado." },
  { icone: Target, titulo: "Metas do mês", linha: "O alvo e quanto já saiu, sem planilha." },
  { icone: Radar, titulo: "Máquina de leads", linha: "Busca empresas do seu nicho na cidade, com o contato." },
  { icone: Mail, titulo: "E-mail profissional", linha: "Seu nome no domínio da empresa, com a migração feita." },
];

/**
 * A página de venda do CRM (endereço /crm): o que tem, quanto custa por
 * usuário e o botão que leva ao cadastro. Quem já tem login vai direto ao produto.
 */
export default function ProdutoLanding() {
  const { user } = useAuth();
  const planos = useQuery({ queryKey: ["produto", "planos", "venda"], queryFn: () => listarPlanos(), staleTime: 300_000, retry: 1 });
  const [plano, setPlano] = useState("starter");
  const [usuarios, setUsuarios] = useState(3);
  const lista = planos.data || [];
  useEffect(() => {
    if (lista.length && !lista.some((p) => p.id === plano)) setPlano(lista[0].id);
  }, [lista, plano]);
  const escolhido = lista.filter((p) => p.id === plano)[0] || null;
  const destino = user ? "/app" : "/login?next=%2Fapp&modo=cadastro";

  return (
    <CascaPublica
      largura="larga"
      centralizar={false}
      titulo="O CRM que organiza a sua venda"
      descricao="Por usuário, por mês, sem fidelidade"
      aoLadoDaMarca={<Link to={user ? "/app" : "/login?next=%2Fapp"} className={juntar(texto.corpo, "font-medium text-primary hover:underline")}>{user ? "Abrir o CRM" : "Entrar"}</Link>}
    >
      <div className="min-w-0 space-y-8" data-pagina-de-venda="">
        <ul className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {O_QUE_TEM.map((i) => (
            <li key={i.titulo} className="flex min-w-0 items-start">
              <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <i.icone className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className={juntar(texto.tituloSecao, "block")}>{i.titulo}</span>
                <span className={juntar(texto.auxiliar, "block leading-5")}>{i.linha}</span>
              </span>
            </li>
          ))}
        </ul>

        {planos.isLoading ? (
          <Carregando linhas={3} rotulo="Carregando os planos" />
        ) : lista.length ? (
          <EscolhaDePlano planos={lista} plano={plano} usuarios={usuarios} onPlano={setPlano} onUsuarios={setUsuarios} />
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center justify-between border-t border-border pt-5">
          <p className={juntar(texto.corpo, "mb-3 mr-4 min-w-0 sm:mb-0")}>
            {escolhido ? (
              <>
                <span className={texto.numero}>{reais(escolhido.preco_usuario * usuarios)}</span>
                <span className="ml-1 text-muted-foreground">por mês para {usuarios} {usuarios === 1 ? "usuário" : "usuários"}</span>
              </>
            ) : (
              "Comece agora e convide a equipe depois."
            )}
          </p>
          <Link to={destino} className={botao.primario} data-comecar="">
            {user ? "Abrir o CRM" : "Começar o teste"}
          </Link>
        </div>
      </div>
    </CascaPublica>
  );
}
