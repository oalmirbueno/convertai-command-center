import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Building2, FlaskConical, Plus, Repeat } from "lucide-react";
import { casa, diaLegivel, fraseDoErro, listarContasDaCasa, listarPlanos, reais, ROTULO_DO_ESTADO, type ContaNaCasa, type EstadoDaConta, type PlanoDoProduto } from "@/lib/produto/api";
import { Avatar, ProgressBar, StatCard, StatGrid, StatusPill } from "@/components/ds";
import {
  CampoDeBusca,
  CampoDeFormulario,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  JanelaCentral,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  foco,
  juntar,
  superficie,
  texto,
} from "@/components/sistema";
import JanelaDaEmpresa from "./JanelaDaEmpresa";
import { chaveDasContas, comMaiuscula, situacaoDaConta, tomDaConta } from "./estadoDaConta";

// Quem já importava daqui continua importando (E-mail, Entradas, testes).
export { chaveDasContas, COR_DO_ESTADO, situacaoDaConta } from "./estadoDaConta";

/**
 * As empresas que usam o produto: situação, plano, usuários e mensalidade.
 * A casa cria a empresa e, na janela de cada uma, vê o CRM como a empresa vê,
 * ajusta o que foi contratado, convida a equipe e cuida da cobrança.
 * O conteúdo do CRM de cada empresa não aparece aqui: é dela.
 */
export default function ContasDaCasa() {
  const qc = useQueryClient();
  const contas = useQuery({ queryKey: chaveDasContas, queryFn: listarContasDaCasa });
  const planos = useQuery({ queryKey: ["produto", "planos", "todos"], queryFn: () => listarPlanos(true), staleTime: 300_000 });
  const [filtro, setFiltro] = useState("todas");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const reler = () => qc.invalidateQueries({ queryKey: chaveDasContas });

  const todas = useMemo(() => contas.data || [], [contas.data]);
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todas.filter((c) => (filtro === "todas" || c.estado === filtro) && (!termo || `${c.nome} ${c.email_cobranca || ""}`.toLowerCase().indexOf(termo) >= 0));
  }, [todas, filtro, busca]);

  const pagantes = todas.filter((c) => c.estado === "ativa" || c.estado === "atrasada");
  const contar = (e: EstadoDaConta) => todas.filter((c) => c.estado === e).length;
  const contaAberta = todas.filter((c) => c.id === aberta)[0] || null;
  const nomeDoPlano = (id: string) => ((planos.data || []).filter((p) => p.id === id)[0] || { nome: id }).nome;
  const lendo = contas.isLoading;
  const ou = (v: string) => (lendo ? "…" : v);

  return (
    <div className="min-w-0 space-y-6" data-contas-da-casa="">
      <StatGrid label="Empresas no produto">
        <StatCard size="md" variant="ink" icon={<Repeat className="h-4 w-4" />} label="Receita recorrente" value={ou(reais(pagantes.reduce((s, c) => s + c.valor_mensal, 0)))} hint="por mês" />
        <StatCard size="md" icon={<Building2 className="h-4 w-4" />} label="Ativas" value={ou(String(contar("ativa")))} hint={lendo ? " " : `${pagantes.reduce((s, c) => s + (c.crm_ativo ? c.usuarios_contratados : 0), 0)} usuários pagos`} />
        <StatCard size="md" icon={<FlaskConical className="h-4 w-4" />} label="Em teste" value={ou(String(contar("teste")))} hint={lendo ? " " : `${contar("cortesia")} em cortesia`} />
        <StatCard size="md" icon={<AlertTriangle className="h-4 w-4" />} label="Em atraso" value={ou(String(contar("atrasada")))} hint={lendo ? " " : `${contar("suspensa")} suspensas`} />
      </StatGrid>

      <Secao
        titulo="Empresas"
        descricao={lendo ? undefined : `${visiveis.length} de ${todas.length}`}
        recolher={false}
        acao={
          <>
            <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar empresa" rotulo="Buscar empresa" className="mr-2 hidden w-[220px] sm:block" />
            <SeletorCompacto
              rotulo="Situação"
              modo="lista"
              opcoes={[{ valor: "todas", rotulo: "Todas", contador: todas.length }, ...(Object.keys(ROTULO_DO_ESTADO) as EstadoDaConta[]).map((e) => ({ valor: e, rotulo: ROTULO_DO_ESTADO[e], contador: contar(e) }))]}
              valor={filtro}
              onEscolher={setFiltro}
            />
            <button type="button" className={juntar(botao.primario, "ml-2 h-8")} onClick={() => setNova(true)} aria-label="Nova empresa" title="Nova empresa" data-nova-empresa="">
              <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Empresa</span>
            </button>
          </>
        }
      >
        <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar empresa" rotulo="Buscar empresa no celular" className="mb-3 sm:hidden" />
        {lendo ? (
          <ListaDeEmpresasCarregando />
        ) : contas.isError ? (
          <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void contas.refetch()}>Tentar de novo</button>} />
        ) : visiveis.length === 0 ? (
          <EstadoVazio compacto titulo={todas.length ? "Nenhuma empresa neste filtro." : "Nenhuma empresa ainda."} descricao={todas.length ? undefined : "Crie a primeira ou espere alguém abrir a conta pelo site."} />
        ) : (
          <ListaDeEmpresas contas={visiveis} nomeDoPlano={nomeDoPlano} onAbrir={setAberta} />
        )}
      </Secao>

      {contaAberta && <JanelaDaEmpresa key={contaAberta.id} conta={contaAberta} planos={planos.data || []} onFechar={() => setAberta(null)} onMudou={reler} />}
      {nova && <NovaEmpresa planos={(planos.data || []).filter((p) => p.ativo)} onFechar={() => setNova(false)} onCriada={(id) => { void reler(); setNova(false); setAberta(id); }} />}
    </div>
  );
}

/** A grade das colunas da lista, a mesma no cabeçalho e nas linhas. */
const COLUNAS = "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,176px)_112px_112px]";

/** A lista das empresas: uma linha por empresa, dentro de um cartão, com traço leve entre elas. */
export function ListaDeEmpresas({
  contas,
  nomeDoPlano,
  onAbrir,
  linhaDeApoio,
  valor,
  aoVivo,
}: {
  contas: ContaNaCasa[];
  nomeDoPlano: (id: string) => string;
  onAbrir: (id: string) => void;
  /** Troca a linha apagada embaixo do nome (a Visão geral mostra o movimento de hoje). */
  linhaDeApoio?: (c: ContaNaCasa) => string;
  /** Troca a coluna do valor (a Visão geral mostra o que está em aberto). */
  valor?: { titulo: string; de: (c: ContaNaCasa) => { valor: string; apoio?: string } };
  /** Empresas com alguém mexendo agora (bolinha verde pulsando no nome). */
  aoVivo?: (c: ContaNaCasa) => boolean;
}) {
  return (
    <div className={juntar(superficie.painel, "min-w-0 px-2 py-2 sm:px-3")} data-lista-de-contas="">
      <div className={juntar(COLUNAS, "hidden px-3 pb-2 pt-1 sm:grid")} aria-hidden="true">
        <span className={texto.rotulo}>Empresa</span>
        <span className={texto.rotulo}>Situação</span>
        <span className={texto.rotulo}>Usuários</span>
        <span className={juntar(texto.rotulo, "text-right")}>{valor ? valor.titulo : "Mensalidade"}</span>
      </div>
      <ul className="min-w-0 divide-y divide-border/50">
        {contas.map((c) => {
          const v = valor ? valor.de(c) : { valor: reais(c.valor_mensal), apoio: nomeDoPlano(c.plano_id) };
          const vivo = !!aoVivo && aoVivo(c);
          return (
            <li key={c.id}>
              <button type="button" className={juntar(COLUNAS, "w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/50", foco)} onClick={() => onAbrir(c.id)} data-conta={c.id} data-empresa-no-monitor={valor ? c.id : undefined}>
                <span className="flex min-w-0 items-center">
                  <span className="relative shrink-0">
                    <Avatar name={c.nome} size="sm" square tone={c.estado === "ativa" || c.estado === "cortesia" ? "accent" : "neutral"} />
                    {vivo && <span className="pulse-dot absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-card" aria-label="Usando agora" />}
                  </span>
                  <span className="ml-3 min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.nome}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>
                      {linhaDeApoio ? linhaDeApoio(c) : `${c.email_ativo ? `e-mail (${c.email_caixas_contratadas}) · ` : ""}${c.ultimo_uso ? `usou em ${diaLegivel(c.ultimo_uso)}` : "ainda sem uso"}`}
                    </span>
                    <span className="mt-1.5 flex min-w-0 sm:hidden">
                      <StatusPill tone={tomDaConta(c)}>{comMaiuscula(situacaoDaConta(c))}</StatusPill>
                    </span>
                  </span>
                </span>
                <span className="hidden min-w-0 sm:flex">
                  <StatusPill tone={tomDaConta(c)} plain>{comMaiuscula(situacaoDaConta(c))}</StatusPill>
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className={juntar(texto.corpo, "block tabular-nums")}>{c.usuarios_ativos} de {c.usuarios_contratados}</span>
                  <span className="mt-1 block max-w-[88px]">
                    <ProgressBar value={c.usuarios_ativos} max={Math.max(1, c.usuarios_contratados)} height={4} />
                  </span>
                </span>
                <span className="min-w-0 text-right">
                  <span className={juntar(texto.corpo, "block font-medium tabular-nums")}>{v.valor}</span>
                  {v.apoio && <span className={juntar(texto.auxiliar, "block truncate")}>{v.apoio}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** O esqueleto da lista, com a forma das linhas que vêm. */
export function ListaDeEmpresasCarregando({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className={juntar(superficie.painel, "min-w-0 px-5 py-3")} aria-busy="true" aria-label="Carregando as empresas" data-lista-carregando="">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex min-w-0 items-center py-3" style={{ opacity: 1 - i * 0.14 }}>
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-muted" />
          <span className="ml-3 min-w-0 flex-1">
            <span className="block h-3 w-2/5 animate-pulse rounded-full bg-muted" />
            <span className="mt-2 block h-2.5 w-1/4 animate-pulse rounded-full bg-muted/70" />
          </span>
          <span className="ml-4 hidden h-3 w-24 animate-pulse rounded-full bg-muted sm:block" />
          <span className="ml-4 h-3 w-16 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ nova empresa

function NovaEmpresa({ planos, onFechar, onCriada }: { planos: PlanoDoProduto[]; onFechar: () => void; onCriada: (id: string) => void }) {
  const [f, setF] = useState({ nome: "", email: "", nome_responsavel: "", documento: "", telefone: "", plano_id: planos[0] ? planos[0].id : "starter", usuarios: 1, cortesia: false, email_ativo: false, email_caixas: 0 });
  const [criando, setCriando] = useState(false);
  const criar = async () => {
    setCriando(true);
    try {
      const r = await casa.criarConta({ ...f, estado: f.cortesia ? "cortesia" : "teste" });
      toast.success(r.enviado ? "Empresa criada e convite enviado." : "Empresa criada. O convite não saiu: reenvie pela ficha.");
      onCriada(r.conta_id);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível criar a empresa."));
    } finally {
      setCriando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="md"
      titulo="Nova empresa"
      ajuda="A pessoa responsável recebe o convite por e-mail, cria a senha e passa a administrar a empresa. Em teste, o prazo é o dos Preços; em cortesia, a empresa usa sem cobrança."
      rodape={
        <button type="button" className={botao.primario} onClick={() => void criar()} disabled={criando || f.nome.trim().length < 2 || f.email.trim().length < 5} data-criar-empresa-da-casa="">
          {criando ? "Criando..." : "Criar e convidar"}
        </button>
      }
    >
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Nome da empresa" obrigatorio largo>
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={campo} maxLength={120} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="E-mail de quem administra" obrigatorio>
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Nome de quem administra">
          <input value={f.nome_responsavel} onChange={(e) => setF({ ...f, nome_responsavel: e.target.value })} className={campo} maxLength={120} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="CPF ou CNPJ">
          <input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} className={campo} inputMode="numeric" maxLength={20} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="WhatsApp">
          <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} className={campo} maxLength={20} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Plano">
          <select value={f.plano_id} onChange={(e) => setF({ ...f, plano_id: e.target.value })} className={campo}>
            {planos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {reais(p.preco_usuario)} por usuário</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Usuários">
          <input type="number" min={1} max={500} value={f.usuarios} onChange={(e) => setF({ ...f, usuarios: Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 1))) })} className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="E-mail profissional">
          <div className="flex h-9 items-center">
            <label className={juntar(texto.corpo, "mr-3 inline-flex items-center")}>
              <input type="checkbox" className="mr-1.5" checked={f.email_ativo} onChange={(e) => setF({ ...f, email_ativo: e.target.checked })} />
              Contratado
            </label>
            <input type="number" min={0} max={500} value={f.email_caixas} disabled={!f.email_ativo} onChange={(e) => setF({ ...f, email_caixas: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className={juntar(campo, "w-20")} aria-label="Caixas de e-mail" />
          </div>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Cobrança">
          <label className={juntar(texto.corpo, "inline-flex h-9 items-center")}>
            <input type="checkbox" className="mr-1.5" checked={f.cortesia} onChange={(e) => setF({ ...f, cortesia: e.target.checked })} />
            Cortesia, sem cobrança
          </label>
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
