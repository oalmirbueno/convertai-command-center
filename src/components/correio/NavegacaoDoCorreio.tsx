import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, KanbanSquare, LayoutGrid, Mail, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useProduto } from "@/hooks/useProduto";
import { useTrocaDeAcesso } from "@/components/produto/TrocaDeAcesso";
import { VOLTAR_PARA, abertoComoApp, lembrarOrigem, type OrigemDoCorreio } from "@/lib/produto/rotas-do-correio";
import { foco, juntar } from "@/components/sistema";

const PAPEIS_DO_PAINEL = ["admin", "client", "design", "traffic", "manager"];

/**
 * A saída do Correio: "voltar" para onde a pessoa veio (painel ou CRM) e "Ir para" com os outros lugares.
 * Quem está no CRM com o próprio usuário e quer o painel da empresa passa pela troca de acesso, como no CRM.
 */
export function SaidaDoCorreio() {
  const local = useLocation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const produto = useProduto();
  const troca = useTrocaDeAcesso();
  const [origem] = useState<OrigemDoCorreio | null>(() => lembrarOrigem(local.search));
  const [aberto, setAberto] = useState(false);
  const estado = produto.data;
  const temPainel = !!profile && PAPEIS_DO_PAINEL.indexOf(profile.role) >= 0;
  const painelDaEmpresa = !temPainel && !!(estado && estado.conta && estado.conta.tem_painel);
  const temCrm = !!(estado && estado.conta && estado.conta.crm_ativo && estado.eu);
  const adminDoEmail = !!(estado && estado.eu && estado.eu.papel === "admin");

  const irAoPainel = () => (temPainel ? navigate("/dashboard") : troca.abrir("painel"));
  const voltar = () => (origem === "painel" ? irAoPainel() : navigate(VOLTAR_PARA[origem || "crm"].para));
  // A equipe da Aceleriq trabalha no CRM de vendas da casa (/vendas); o CRM do produto é o dos clientes.
  const daCasa = !!profile && (profile.role === "admin" || profile.role === "manager");

  const destinos = [
    (temPainel || painelDaEmpresa) && { id: "painel", rotulo: profile && profile.role === "client" ? "Painel do cliente" : "Painel", ajuda: "Projetos, aprovações e financeiro", icone: LayoutGrid, ir: irAoPainel },
    daCasa
      ? { id: "crm", rotulo: "CRM de vendas", ajuda: "O funil da Aceleriq", icone: KanbanSquare, ir: () => navigate("/vendas/crm") }
      : temCrm && { id: "crm", rotulo: "CRM", ajuda: "Funil, agenda e equipe", icone: KanbanSquare, ir: () => navigate("/app") },
    adminDoEmail && { id: "email", rotulo: "Configurar o e-mail", ajuda: "Domínio, caixas e senhas", icone: Settings2, ir: () => navigate("/app/email") },
  ].filter(Boolean) as Array<{ id: string; rotulo: string; ajuda: string; icone: typeof Mail; ir: () => void }>;

  return (
    <>
      {origem && (
        <button type="button" onClick={voltar} className={juntar("flex h-11 shrink-0 items-center rounded-2xl bg-muted px-3 text-[14px] font-semibold hover:bg-[hsl(var(--correio-menta))]", foco)} title={`Voltar ao ${VOLTAR_PARA[origem].rotulo}`} data-voltar-do-correio={origem}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {VOLTAR_PARA[origem].rotulo}
        </button>
      )}
      {destinos.length > 0 && (
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <button type="button" className={juntar("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl hover:bg-muted", foco)} aria-label="Ir para outro lugar" title="Ir para" data-ir-para="">
              <LayoutGrid className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[280px] rounded-3xl p-2">
            <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ir para</p>
            <ul>
              {destinos.map((d) => {
                const Icone = d.icone;
                return (
                  <li key={d.id}>
                    <button type="button" onClick={() => { setAberto(false); d.ir(); }} className={juntar("flex w-full min-w-0 items-center rounded-2xl p-2.5 text-left hover:bg-muted", foco)} data-destino={d.id}>
                      <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted" aria-hidden="true"><Icone className="h-4 w-4" /></span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium">{d.rotulo}</span>
                        <span className="block truncate text-[12px] text-muted-foreground">{d.ajuda}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}
      {troca.janela}
    </>
  );
}

type PedidoDeInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** "Instalar o app": aparece quando o navegador oferece (Chrome, Edge, Samsung) e some depois de instalado. */
export function BotaoInstalarCorreio() {
  const [pedido, setPedido] = useState<PedidoDeInstalar | null>(null);
  useEffect(() => {
    if (abertoComoApp()) return;
    const guardar = (e: Event) => {
      e.preventDefault();
      setPedido(e as PedidoDeInstalar);
    };
    const instalado = () => setPedido(null);
    window.addEventListener("beforeinstallprompt", guardar);
    window.addEventListener("appinstalled", instalado);
    return () => {
      window.removeEventListener("beforeinstallprompt", guardar);
      window.removeEventListener("appinstalled", instalado);
    };
  }, []);
  if (!pedido) return null;
  const instalar = async () => {
    await pedido.prompt();
    try {
      await pedido.userChoice;
    } finally {
      setPedido(null);
    }
  };
  return (
    <button type="button" onClick={() => void instalar()} className={juntar("correio-botao-forte flex h-10 shrink-0 items-center rounded-2xl px-3.5 text-[13px] font-semibold", foco)} data-instalar-correio="">
      <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
      Instalar o app
    </button>
  );
}
