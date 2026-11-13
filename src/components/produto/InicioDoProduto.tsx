import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, KanbanSquare, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { reais, type EstadoDoProduto } from "@/lib/produto/api";
import { CabecalhoDePagina, FaixaDeNumeros, Secao, foco, juntar, lista, superficie, texto } from "@/components/sistema";

const db = supabase as unknown as { from: (t: string) => any };

interface ResumoDoCrm {
  abertos: number;
  emJogo: number;
  ganhosNoMes: number;
  hoje: number;
  atrasados: number;
  semDono: number;
  temMeta: boolean;
}

/** O dia e o começo do mês em São Paulo. */
function agoraEmSaoPaulo() {
  const dia = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  return { dia, mes: `${dia.slice(0, 7)}-01` };
}

async function lerResumoDoCrm(): Promise<ResumoDoCrm> {
  const { dia, mes } = agoraEmSaoPaulo();
  const [leads, atividades, metas] = await Promise.all([
    db.from("crm_leads").select("stage, monthly_value, one_off_value, closed_at, owner_id").is("archived_at", null).limit(3000),
    db.from("crm_activities").select("due_at").is("done_at", null).lte("due_at", `${dia}T23:59:59-03:00`).limit(500),
    db.from("crm_goals").select("id").eq("period", mes).gt("target", 0).limit(1),
  ]);
  if (leads.error) throw leads.error;
  const linhas = (leads.data || []) as Array<{ stage: string; monthly_value: number; one_off_value: number; closed_at: string | null; owner_id: string | null }>;
  const abertos = linhas.filter((l) => l.stage !== "ganho" && l.stage !== "perdido");
  const compromissos = ((atividades.data || []) as Array<{ due_at: string }>).map((a) => a.due_at);
  const inicioDeHoje = new Date(`${dia}T00:00:00-03:00`).getTime();
  return {
    abertos: abertos.length,
    emJogo: abertos.reduce((s, l) => s + (Number(l.monthly_value) || 0) * 12 + (Number(l.one_off_value) || 0), 0),
    ganhosNoMes: linhas.filter((l) => l.stage === "ganho" && l.closed_at && new Date(l.closed_at).getTime() >= new Date(`${mes}T00:00:00-03:00`).getTime()).length,
    hoje: compromissos.filter((d) => new Date(d).getTime() >= inicioDeHoje).length,
    atrasados: compromissos.filter((d) => new Date(d).getTime() < inicioDeHoje).length,
    semDono: abertos.filter((l) => !l.owner_id).length,
    temMeta: !!(metas.data && metas.data.length),
  };
}

function Ferramenta({ para, icone, nome, linha, destaque }: { para: string; icone: ReactNode; nome: string; linha: string; destaque?: boolean }) {
  return (
    <Link
      to={para}
      className={juntar(superficie.painel, "group flex min-w-0 items-center p-4 transition-colors hover:border-primary/60", foco, destaque && "border-primary/50")}
      data-ferramenta={nome}
    >
      <span className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className={juntar(texto.tituloSecao, "block truncate")}>{nome}</span>
        <span className={juntar(texto.auxiliar, "block truncate")}>{linha}</span>
      </span>
      <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
    </Link>
  );
}

/**
 * A entrada do produto: as duas ferramentas em destaque, os números do CRM de
 * hoje e o que falta para a empresa tirar proveito (a lista some quando acaba).
 */
export default function InicioDoProduto({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const admin = !!estado.eu && estado.eu.papel === "admin";
  const resumo = useQuery({ queryKey: ["produto", "inicio", conta.id], queryFn: lerResumoDoCrm, enabled: estado.crm, staleTime: 30_000 });
  const r = resumo.data;
  const primeiroNome = estado.eu && estado.eu.nome ? estado.eu.nome.split(" ")[0] : "";
  const ativos = estado.equipe.filter((m) => m.estado === "ativo").length;
  const lugaresLivres = Math.max(0, conta.usuarios_contratados - estado.equipe.length);

  const passos: Array<{ feito: boolean; texto: string; para: string }> = [];
  if (estado.crm && r) {
    passos.push({ feito: r.abertos + r.ganhosNoMes > 0, texto: "Cadastrar o primeiro negócio", para: "/app/crm/crm" });
    if (estado.plano && estado.plano.limites.maquina_buscas_mes > 0) passos.push({ feito: estado.maquina_no_mes > 0, texto: "Buscar empresas na Máquina de leads", para: "/app/crm/leads" });
    passos.push({ feito: r.temMeta, texto: "Definir a meta do mês", para: "/app/crm/metas" });
  }
  if (admin) {
    if (conta.usuarios_contratados > 1) passos.push({ feito: estado.equipe.length > 1, texto: "Convidar a equipe", para: "/app/conta?parte=equipe" });
    if (conta.estado === "teste") passos.push({ feito: false, texto: "Assinar para não perder o acesso", para: "/app/conta?parte=plano" });
  }
  const pendentes = passos.filter((p) => !p.feito);

  const linhaDoCrm = !estado.crm
    ? "Pausado"
    : !r
      ? "Funil, empresas, agenda e metas"
      : r.atrasados > 0
        ? `${r.atrasados} ${r.atrasados === 1 ? "compromisso atrasado" : "compromissos atrasados"}`
        : r.hoje > 0
          ? `${r.hoje} ${r.hoje === 1 ? "compromisso hoje" : "compromissos hoje"}`
          : `${r.abertos} ${r.abertos === 1 ? "negócio aberto" : "negócios abertos"}`;
  const linhaDoEmail = conta.email_ativo ? `${conta.email_caixas_contratadas} ${conta.email_caixas_contratadas === 1 ? "caixa" : "caixas"} no domínio da empresa` : "Seu nome @ sua empresa";

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6" data-inicio-do-produto="">
      <CabecalhoDePagina
        titulo={primeiroNome ? `Olá, ${primeiroNome}` : "Início"}
        descricao={`${conta.nome} · ${estado.plano ? estado.plano.nome : ""}`}
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Ferramenta para="/app/crm" icone={<KanbanSquare className="h-5 w-5" aria-hidden="true" />} nome="CRM" linha={linhaDoCrm} destaque={estado.crm} />
        <Ferramenta para="/app/email" icone={<Mail className="h-5 w-5" aria-hidden="true" />} nome="E-mail profissional" linha={linhaDoEmail} destaque={conta.email_ativo} />
      </div>

      {estado.crm && (
        <FaixaDeNumeros
          tamanho="compacto"
          apoioAoLado
          rotulo="Números do CRM"
          itens={[
            { rotulo: "Em conversa", valor: r ? String(r.abertos) : "…", apoio: "negócios abertos", para: "/app/crm/crm" },
            { rotulo: "Em jogo", valor: r ? reais(r.emJogo) : "…", apoio: "em 12 meses" },
            { rotulo: "Ganhos no mês", valor: r ? String(r.ganhosNoMes) : "…", para: "/app/crm/metas" },
            { rotulo: "Para hoje", valor: r ? String(r.hoje + r.atrasados) : "…", apoio: r && r.atrasados ? `${r.atrasados} em atraso` : "compromissos", para: "/app/crm/agenda", ponto: r && r.atrasados ? "alerta" : undefined },
          ]}
        />
      )}

      {pendentes.length > 0 && (
        <Secao titulo="Próximos passos" descricao={`${passos.length - pendentes.length} de ${passos.length} feitos`} recolher="produto:inicio:passos">
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {passos.map((p) => (
              <li key={p.texto}>
                <Link to={p.para} className={juntar(lista.linha, foco)}>
                  <span className={juntar("mr-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", p.feito ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {p.feito && <Check className="h-3 w-3" aria-hidden="true" />}
                  </span>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", p.feito && "text-muted-foreground line-through")}>{p.texto}</span>
                  {!p.feito && <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                </Link>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {estado.crm && r && r.semDono > 0 && admin && (
        <p className={texto.auxiliar}>
          {r.semDono} {r.semDono === 1 ? "negócio aberto está sem responsável" : "negócios abertos estão sem responsável"}.{" "}
          <Link to="/app/crm/crm" className="font-medium text-primary hover:underline">Distribuir</Link>
        </p>
      )}

      {admin && (
        <p className={texto.auxiliar} data-lugares-da-equipe="">
          {ativos} de {conta.usuarios_contratados} {conta.usuarios_contratados === 1 ? "usuário" : "usuários"} em uso
          {lugaresLivres > 0 ? ` · ${lugaresLivres} ${lugaresLivres === 1 ? "lugar livre" : "lugares livres"}` : ""}.{" "}
          <Link to="/app/conta?parte=equipe" className="font-medium text-primary hover:underline">Equipe</Link>
        </p>
      )}
    </div>
  );
}
