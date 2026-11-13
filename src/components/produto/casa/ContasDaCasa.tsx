import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, RefreshCw, UserPlus } from "lucide-react";
import { useClients } from "@/hooks/useSupabaseData";
import {
  casa,
  diaLegivel,
  diasAte,
  fraseDoErro,
  lerConfig,
  listarCobrancas,
  listarContasDaCasa,
  listarPlanos,
  mensalidadePrevista,
  reais,
  reenviarConvite,
  ROTULO_DO_ESTADO,
  type ContaNaCasa,
  type EstadoDaConta,
  type PlanoDoProduto,
} from "@/lib/produto/api";
import {
  CampoDeBusca,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  FaixaDeNumeros,
  GrupoDeCampos,
  JanelaCentral,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  lista,
  texto,
} from "@/components/sistema";

export const COR_DO_ESTADO: Record<EstadoDaConta, string> = {
  teste: "bg-muted text-muted-foreground",
  ativa: "bg-primary/10 text-primary",
  atrasada: "bg-warning/10 text-warning",
  suspensa: "bg-destructive/10 text-destructive",
  cancelada: "bg-muted text-muted-foreground",
  cortesia: "bg-primary/10 text-primary",
};

const ESTADOS_QUE_A_CASA_DEFINE: EstadoDaConta[] = ["teste", "ativa", "cortesia", "suspensa", "cancelada"];

export const chaveDasContas = ["produto", "casa", "contas"] as const;

/** A linha de situação de uma empresa, para a lista. */
export function situacaoDaConta(c: ContaNaCasa, agora = Date.now()): string {
  if (c.estado === "teste") {
    const dias = diasAte(c.teste_ate, agora);
    return c.liberada ? `teste, ${dias} ${dias === 1 ? "dia" : "dias"}` : "teste vencido";
  }
  if (c.estado === "atrasada") return c.liberada ? "atrasada, ainda com acesso" : "atrasada, sem acesso";
  if (c.estado === "cancelada" && c.liberada) return `cancelada, acesso até ${diaLegivel(c.acesso_ate)}`;
  return ROTULO_DO_ESTADO[c.estado].toLowerCase();
}

/**
 * As empresas que usam o produto: situação, plano, usuários e mensalidade.
 * A casa cria a empresa, ajusta o que foi contratado e cuida da cobrança.
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

  const todas = contas.data || [];
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todas.filter((c) => (filtro === "todas" || c.estado === filtro) && (!termo || `${c.nome} ${c.email_cobranca || ""}`.toLowerCase().indexOf(termo) >= 0));
  }, [todas, filtro, busca]);

  if (contas.isLoading) return <Carregando linhas={5} rotulo="Carregando as empresas" />;
  if (contas.isError) return <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void contas.refetch()}>Tentar de novo</button>} />;

  const pagantes = todas.filter((c) => c.estado === "ativa" || c.estado === "atrasada");
  const contar = (e: EstadoDaConta) => todas.filter((c) => c.estado === e).length;
  const contaAberta = todas.filter((c) => c.id === aberta)[0] || null;

  return (
    <div className="min-w-0 space-y-5" data-contas-da-casa="">
      <FaixaDeNumeros
        tamanho="compacto"
        apoioAoLado
        rotulo="Empresas no produto"
        itens={[
          { rotulo: "Receita recorrente", valor: reais(pagantes.reduce((s, c) => s + c.valor_mensal, 0)), apoio: "por mês" },
          { rotulo: "Ativas", valor: String(contar("ativa")), apoio: `${pagantes.reduce((s, c) => s + (c.crm_ativo ? c.usuarios_contratados : 0), 0)} usuários` },
          { rotulo: "Em teste", valor: String(contar("teste")) },
          { rotulo: "Em atraso", valor: String(contar("atrasada")), ponto: contar("atrasada") ? "alerta" : undefined },
        ]}
      />
      <Secao
        titulo="Empresas"
        descricao={`${visiveis.length} de ${todas.length}`}
        acao={
          <>
            <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar empresa" rotulo="Buscar empresa" className="mr-2 hidden w-[200px] sm:block" />
            <SeletorCompacto
              rotulo="Situação"
              modo="lista"
              opcoes={[{ valor: "todas", rotulo: "Todas", contador: todas.length }, ...(Object.keys(ROTULO_DO_ESTADO) as EstadoDaConta[]).map((e) => ({ valor: e, rotulo: ROTULO_DO_ESTADO[e], contador: contar(e) }))]}
              valor={filtro}
              onEscolher={setFiltro}
            />
            <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setNova(true)} aria-label="Nova empresa" title="Nova empresa" data-nova-empresa="">
              <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
            </button>
          </>
        }
      >
        {visiveis.length === 0 ? (
          <EstadoVazio compacto titulo={todas.length ? "Nenhuma empresa neste filtro." : "Nenhuma empresa ainda."} descricao={todas.length ? undefined : "Crie a primeira ou espere alguém abrir a conta pelo site."} />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-lista-de-contas="">
            {visiveis.map((c) => (
              <li key={c.id}>
                <button type="button" className={juntar(lista.linha, "w-full text-left")} onClick={() => setAberta(c.id)} data-conta={c.id}>
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.nome}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>
                      {c.plano_id} · {c.usuarios_ativos} de {c.usuarios_contratados} usuários
                      {c.email_ativo ? ` · e-mail (${c.email_caixas_contratadas})` : ""}
                      {c.ultimo_uso ? ` · usou em ${diaLegivel(c.ultimo_uso)}` : " · ainda sem uso"}
                    </span>
                  </span>
                  <span className={juntar(etiqueta, "ml-2", COR_DO_ESTADO[c.estado])}>{situacaoDaConta(c)}</span>
                  <span className={juntar(texto.corpo, "ml-3 w-[92px] shrink-0 text-right tabular-nums")}>{reais(c.valor_mensal)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {contaAberta && <FichaDaConta key={contaAberta.id} conta={contaAberta} planos={planos.data || []} onFechar={() => setAberta(null)} onMudou={reler} />}
      {nova && <NovaEmpresa planos={(planos.data || []).filter((p) => p.ativo)} onFechar={() => setNova(false)} onCriada={(id) => { void reler(); setNova(false); setAberta(id); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ ficha

function FichaDaConta({ conta, planos, onFechar, onMudou }: { conta: ContaNaCasa; planos: PlanoDoProduto[]; onFechar: () => void; onMudou: () => Promise<unknown> }) {
  const { data: clientesBrutos } = useClients();
  const config = useQuery({ queryKey: ["produto", "config"], queryFn: lerConfig, staleTime: 300_000 });
  const cobrancas = useQuery({ queryKey: ["produto", "cobrancas", conta.id], queryFn: () => listarCobrancas(conta.id, 6) });
  const [f, setF] = useState({
    nome: conta.nome,
    documento: conta.documento || "",
    email_cobranca: conta.email_cobranca || "",
    telefone: conta.telefone || "",
    client_id: conta.client_id || "",
    plano_id: conta.plano_id,
    usuarios_contratados: conta.usuarios_contratados,
    crm_ativo: conta.crm_ativo,
    email_ativo: conta.email_ativo,
    email_caixas_contratadas: conta.email_caixas_contratadas,
    estado: conta.estado,
    teste_ate: conta.teste_ate ? conta.teste_ate.slice(0, 10) : "",
    observacao: conta.observacao || "",
  });
  const [salvando, setSalvando] = useState(false);
  const [convite, setConvite] = useState({ email: "", nome: "", admin: false });
  const [convidando, setConvidando] = useState(false);
  const [cobrando, setCobrando] = useState(false);

  const clientes = useMemo(
    () => ((clientesBrutos || []) as Array<Record<string, unknown>>).map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clientesBrutos],
  );
  const plano = planos.filter((p) => p.id === f.plano_id)[0] || null;
  const previsto = plano ? mensalidadePrevista({ plano, usuarios: f.usuarios_contratados, crm: f.crm_ativo, email: f.email_ativo, caixas: f.email_caixas_contratadas, config: config.data || null }) : null;
  const mexeNoValor = f.plano_id !== conta.plano_id || f.usuarios_contratados !== conta.usuarios_contratados || f.crm_ativo !== conta.crm_ativo || f.email_ativo !== conta.email_ativo || f.email_caixas_contratadas !== conta.email_caixas_contratadas;
  const temAssinatura = !!conta.assinatura && !!conta.assinatura.asaas_assinatura_id;

  const salvar = async () => {
    if (f.nome.trim().length < 2) return void toast.error("Diga o nome da empresa.");
    if (f.usuarios_contratados < conta.usuarios_ativos + conta.convites) return void toast.error("Há mais pessoas na equipe do que usuários contratados.");
    setSalvando(true);
    try {
      await casa.salvarConta(conta.id, {
        nome: f.nome.trim(),
        documento: f.documento.replace(/\D/g, "") || null,
        email_cobranca: f.email_cobranca.trim().toLowerCase() || null,
        telefone: f.telefone.trim() || null,
        client_id: f.client_id || null,
        plano_id: f.plano_id,
        usuarios_contratados: f.usuarios_contratados,
        crm_ativo: f.crm_ativo,
        email_ativo: f.email_ativo,
        email_caixas_contratadas: f.email_caixas_contratadas,
        estado: f.estado,
        teste_ate: f.estado === "teste" && f.teste_ate ? `${f.teste_ate}T23:59:59-03:00` : conta.teste_ate,
        ...(f.estado !== conta.estado && f.estado !== "atrasada" ? { atrasada_desde: null } : {}),
        ...(f.estado !== conta.estado && f.estado !== "cancelada" ? { acesso_ate: null } : {}),
        observacao: f.observacao.trim() || null,
      });
      // O valor novo precisa chegar ao Asaas, senão a empresa continua pagando o antigo.
      if (mexeNoValor && temAssinatura) {
        await casa.sincronizar(conta.id);
        toast.success("Salvo, e a assinatura no Asaas já está com o valor novo.");
      } else toast.success("Salvo.");
      await onMudou();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
      await onMudou();
    } finally {
      setSalvando(false);
    }
  };

  const convidar = async () => {
    setConvidando(true);
    try {
      const r = await casa.convidar({ conta_id: conta.id, email: convite.email.trim(), nome: convite.nome.trim(), papel: convite.admin ? "admin" : "usuario" });
      setConvite({ email: "", nome: "", admin: false });
      await onMudou();
      toast.success(r.enviado ? "Convite enviado." : "Pessoa adicionada. O e-mail não saiu: reenvie o convite.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível convidar."));
    } finally {
      setConvidando(false);
    }
  };

  const cobrarMigracao = async () => {
    setCobrando(true);
    try {
      const r = await casa.cobrarMigracao(conta.id);
      await cobrancas.refetch();
      if (r.link) {
        try {
          await navigator.clipboard.writeText(r.link);
          toast.success(`Cobrança de ${reais(r.valor)} criada. O link foi copiado.`);
        } catch {
          toast.success(`Cobrança de ${reais(r.valor)} criada. O link está em Cobranças.`);
        }
      } else toast.success("Cobrança criada.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível cobrar."));
    } finally {
      setCobrando(false);
    }
  };

  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="lg"
      titulo={conta.nome}
      descricao={`${situacaoDaConta(conta)} · desde ${diaLegivel(conta.criado_em, true)}`}
      ajuda="Mudar plano, usuários ou e-mail muda a mensalidade. Se a empresa já assina, o valor novo vai para o Asaas ao salvar e vale da próxima cobrança. O que a empresa cadastra no CRM é dela e não aparece aqui."
      rodape={
        <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-conta="">
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      }
    >
      <div className="min-w-0 space-y-6">
        <GrupoDeCampos titulo="Contratado">
          <CampoDeFormulario rotulo="Plano">
            <select value={f.plano_id} onChange={(e) => setF({ ...f, plano_id: e.target.value })} className={campo}>
              {planos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {reais(p.preco_usuario)} por usuário{p.ativo ? "" : " (fora de venda)"}</option>)}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Usuários" apoio={`${conta.usuarios_ativos} ativos, ${conta.convites} convidados`}>
            <input type="number" min={1} max={500} value={f.usuarios_contratados} onChange={(e) => setF({ ...f, usuarios_contratados: Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 1))) })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Ferramentas">
            <div className="flex h-9 items-center">
              <label className={juntar(texto.corpo, "mr-4 inline-flex items-center")}>
                <input type="checkbox" className="mr-1.5" checked={f.crm_ativo} onChange={(e) => setF({ ...f, crm_ativo: e.target.checked })} />
                CRM
              </label>
              <label className={juntar(texto.corpo, "inline-flex items-center")}>
                <input type="checkbox" className="mr-1.5" checked={f.email_ativo} onChange={(e) => setF({ ...f, email_ativo: e.target.checked })} />
                E-mail profissional
              </label>
            </div>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Caixas de e-mail">
            <input type="number" min={0} max={500} value={f.email_caixas_contratadas} disabled={!f.email_ativo} onChange={(e) => setF({ ...f, email_caixas_contratadas: Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0))) })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Situação" ajuda="Cortesia libera sem cobrar. Suspensa bloqueia na hora e guarda os dados. Ativa e atrasada costumam vir sozinhas do Asaas.">
            <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value as EstadoDaConta })} className={campo}>
              {(conta.estado === "atrasada" ? (["atrasada"] as EstadoDaConta[]).concat(ESTADOS_QUE_A_CASA_DEFINE) : ESTADOS_QUE_A_CASA_DEFINE).map((e) => <option key={e} value={e}>{ROTULO_DO_ESTADO[e]}</option>)}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Teste até">
            <input type="date" value={f.teste_ate} disabled={f.estado !== "teste"} onChange={(e) => setF({ ...f, teste_ate: e.target.value })} className={campo} />
          </CampoDeFormulario>
        </GrupoDeCampos>

        {previsto && (
          <p className={texto.corpo} data-mensalidade-da-conta="">
            Mensalidade: <span className="font-semibold tabular-nums">{reais(previsto.total)}</span>
            <span className="text-muted-foreground"> · {previsto.itens.map((i) => (i.quantidade > 1 ? `${i.nome} x ${i.quantidade}` : i.nome)).join(" + ") || "nada a cobrar"}</span>
            {conta.assinatura && conta.assinatura.estado !== "sem" ? (
              <span className="text-muted-foreground">
                {" "}· assinatura {conta.assinatura.estado}
                {conta.assinatura.proximo_vencimento ? `, próxima em ${diaLegivel(conta.assinatura.proximo_vencimento)}` : ""}
                {conta.assinatura.cartao_final ? `, cartão final ${conta.assinatura.cartao_final}` : ""}
              </span>
            ) : null}
          </p>
        )}

        <GrupoDeCampos titulo="Empresa">
          <CampoDeFormulario rotulo="Nome" obrigatorio>
            <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={campo} maxLength={120} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="CPF ou CNPJ" apoio="Obrigatório para cobrar">
            <input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} className={campo} inputMode="numeric" maxLength={20} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="E-mail da cobrança">
            <input type="email" value={f.email_cobranca} onChange={(e) => setF({ ...f, email_cobranca: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="WhatsApp">
            <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} className={campo} maxLength={20} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Cliente no painel" apoio="Quando a empresa também é cliente da agência">
            <select value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })} className={campo}>
              <option value="">Não é cliente do painel</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Anotação da casa" largo>
            <textarea value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} className={campoTexto} maxLength={600} />
          </CampoDeFormulario>
        </GrupoDeCampos>

        <section aria-label="Equipe da empresa">
          <h3 className={juntar(texto.tituloSecao, "mb-1")}>Equipe</h3>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {conta.equipe.map((m) => (
              <li key={m.id} className={lista.linha}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate")}>{m.nome || m.email}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{m.email}{m.entrou_em ? ` · entrou em ${diaLegivel(m.entrou_em)}` : ""}</span>
                </span>
                <span className={juntar(etiqueta, "ml-2", m.papel === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{m.papel === "admin" ? "Administra" : "Usuário"}</span>
                {m.estado === "convidado" && (
                  <button
                    type="button"
                    className={juntar(botao.icone, "ml-1")}
                    aria-label={`Reenviar o convite de ${m.email}`}
                    title="Reenviar convite"
                    onClick={() => void reenviarConvite(m.id).then((r) => (r.enviado ? toast.success("Convite reenviado.") : toast.error("O e-mail não saiu agora."))).catch((e) => toast.error(fraseDoErro(e)))}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]">
            <input type="email" value={convite.email} onChange={(e) => setConvite({ ...convite, email: e.target.value })} className={campo} placeholder="E-mail da pessoa" aria-label="E-mail da pessoa" />
            <input value={convite.nome} onChange={(e) => setConvite({ ...convite, nome: e.target.value })} className={campo} placeholder="Nome" aria-label="Nome da pessoa" />
            <label className={juntar(texto.corpo, "inline-flex h-9 items-center")}>
              <input type="checkbox" className="mr-1.5" checked={convite.admin} onChange={(e) => setConvite({ ...convite, admin: e.target.checked })} />
              Administra
            </label>
            <button type="button" className={botao.secundario} onClick={() => void convidar()} disabled={convidando || convite.email.trim().length < 5}>
              <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {convidando ? "Enviando..." : "Convidar"}
            </button>
          </div>
        </section>

        <section aria-label="Cobranças da empresa">
          <div className="mb-1 flex min-w-0 items-center">
            <h3 className={juntar(texto.tituloSecao, "min-w-0 flex-1")}>Cobranças</h3>
            <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void cobrarMigracao()} disabled={cobrando} title="Cria a cobrança avulsa da migração do e-mail no Asaas" data-cobrar-migracao="">
              {cobrando ? "Criando..." : `Cobrar a migração${config.data ? ` (${reais(config.data.email_migracao)})` : ""}`}
            </button>
          </div>
          {(cobrancas.data || []).length === 0 ? (
            <p className={texto.auxiliar}>Nenhuma cobrança ainda.</p>
          ) : (
            <ul className={juntar(lista.aberta, lista.divisoria)}>
              {(cobrancas.data || []).map((c) => (
                <li key={c.id} className={lista.linha}>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                    {c.descricao || c.tipo}
                    <span className="text-muted-foreground"> · {c.estado}{c.vencimento ? ` · vence ${diaLegivel(c.vencimento)}` : ""}</span>
                  </span>
                  <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(c.valor)}</span>
                  {c.link && <a href={c.link} target="_blank" rel="noreferrer" className={juntar(botao.discreto, "ml-1 h-8")}>Abrir</a>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </JanelaCentral>
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
