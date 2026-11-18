import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { diaLegivel, fraseDoErro, reais, ROTULO_DO_ESTADO_DO_DOMINIO, ROTULO_DO_PROVEDOR, type EstadoDoDominio, type ProvedorDeEmail } from "@/lib/produto/api";
import {
  ROTULO_DA_SAUDE,
  carregarCentral,
  diasAteODia,
  proximoVencimento,
  resumoDaCentral,
  saudeDoCliente,
  type ClienteNaCentral,
  type DominioNaCentral,
  type Gravidade,
  type Saude,
} from "@/lib/produto/email-central";
import { salvarIntegracao } from "@/lib/produto/email-pedidos";
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
  etiqueta,
  juntar,
  lista,
  texto,
} from "@/components/sistema";

export const chaveDaCentral = ["produto", "casa", "email", "central"] as const;

const COR_DA_SAUDE: Record<Saude, string> = {
  saudavel: "bg-accent-soft text-primary",
  atencao: "bg-warning-soft text-warning",
  critico: "bg-destructive/10 text-destructive",
  migrando: "bg-muted text-foreground",
  aguardando: "bg-warning-soft text-warning",
};
const COR_DO_AVISO: Record<Gravidade, string> = { critico: "bg-destructive", atencao: "bg-warning", info: "bg-muted-foreground" };
const ROTULO_DO_CORREIO: Record<DominioNaCentral["correio_provedor"], string> = { nenhum: "Sem correio no painel", zoho: "Zoho (pago)", migadu: "Migadu", imap: "Outro (IMAP)" };

const hojeEmSaoPaulo = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

/** "em 12 dias", "hoje", "há 3 dias". */
export function quando(dia: string, hoje: string): string {
  const d = diasAteODia(dia, hoje);
  if (d === null) return "";
  if (d === 0) return "hoje";
  return d > 0 ? `em ${d} ${d === 1 ? "dia" : "dias"}` : `há ${-d} ${d === -1 ? "dia" : "dias"}`;
}

type Filtro = "todos" | Saude;

/**
 * A central de e-mail da casa: todos os clientes que têm e-mail com a Aceleriq, a saúde de cada um
 * (pagamento, vencimentos, DNS, limite de caixas, pedidos parados) e o próximo vencimento. Abrir um
 * cliente mostra os avisos e deixa anotar os vencimentos e o provedor do correio.
 */
export default function CentralDeEmail() {
  const qc = useQueryClient();
  const central = useQuery({ queryKey: chaveDaCentral, queryFn: carregarCentral });
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const hoje = hojeEmSaoPaulo();

  const clientes = central.data || [];
  const comSaude = useMemo(() => clientes.map((c) => ({ c, s: saudeDoCliente(c, hoje), v: proximoVencimento(c) })), [clientes, hoje]);
  const resumo = useMemo(() => resumoDaCentral(clientes, hoje), [clientes, hoje]);

  if (central.isLoading) return <Carregando linhas={6} rotulo="Carregando a central" />;
  if (central.isError) return <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void central.refetch()}>Tentar de novo</button>} />;

  const ordem: Record<Saude, number> = { critico: 0, atencao: 1, aguardando: 2, migrando: 3, saudavel: 4 };
  const termo = busca.trim().toLowerCase();
  const visiveis = comSaude
    .filter((x) => filtro === "todos" || x.s.estado === filtro)
    .filter((x) => !termo || x.c.empresa.toLowerCase().indexOf(termo) >= 0 || x.c.dominios.some((d) => d.dominio.indexOf(termo) >= 0))
    .sort((a, b) => ordem[a.s.estado] - ordem[b.s.estado] || a.c.empresa.localeCompare(b.c.empresa));
  const escolhido = comSaude.filter((x) => x.c.conta_id === aberto)[0] || null;

  return (
    <div className="min-w-0 space-y-6" data-central-de-email="">
      <FaixaDeNumeros
        rotulo="Resumo do e-mail dos clientes"
        colunas={4}
        itens={[
          { rotulo: "Clientes", valor: resumo.clientes, apoio: `${resumo.caixas} ${resumo.caixas === 1 ? "caixa" : "caixas"}` },
          { rotulo: "Precisam de você", valor: resumo.por.critico + resumo.por.atencao, apoio: `${resumo.por.critico} ${resumo.por.critico === 1 ? "crítico" : "críticos"}`, ponto: resumo.por.critico ? "perigo" : resumo.por.atencao ? "alerta" : "verde", aoClicar: () => setFiltro(resumo.por.critico ? "critico" : "atencao") },
          { rotulo: "Vencem em 30 dias", valor: resumo.vencendo, ponto: resumo.vencendo ? "alerta" : "neutro" },
          { rotulo: "Receita por mês", valor: reais(resumo.receita), apoio: resumo.custo > 0 ? `custo ${reais(resumo.custo)} · margem ${reais(resumo.margem)}` : "custo do provedor ainda não anotado" },
        ]}
      />
      <Secao
        titulo="Clientes"
        descricao={`${visiveis.length} de ${clientes.length}`}
        ajuda="Uma linha por cliente com e-mail na Aceleriq, do mais urgente para o mais tranquilo. A saúde junta pagamento, vencimento do domínio e do plano de e-mail, DNS, limite de caixas e pedidos do cliente parados. Clique no cliente para ver os avisos e anotar os vencimentos."
        acao={
          <button type="button" className={botao.icone} onClick={() => void central.refetch()} aria-label="Atualizar" title="Atualizar">
            <RefreshCw className={juntar("h-4 w-4", central.isFetching && "animate-spin")} aria-hidden="true" />
          </button>
        }
      >
        <div className="mb-3 flex min-w-0 flex-wrap items-center">
          <SeletorCompacto
            rotulo="Saúde"
            opcoes={[{ valor: "todos", rotulo: "Todos" }, ...(["critico", "atencao", "aguardando", "migrando", "saudavel"] as Saude[]).map((s) => ({ valor: s, rotulo: `${ROTULO_DA_SAUDE[s]} ${resumo.por[s]}` }))]}
            valor={filtro}
            onEscolher={(v) => setFiltro(v as Filtro)}
            listaQuandoNaoCabe
          />
          <span className="ml-auto min-w-0 pl-3">
            <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Cliente ou domínio" rotulo="Buscar cliente ou domínio" />
          </span>
        </div>
        {visiveis.length === 0 ? (
          <EstadoVazio compacto titulo={clientes.length ? "Nenhum cliente neste filtro." : "Nenhum cliente com e-mail ainda."} descricao={clientes.length ? undefined : "Eles aparecem aqui quando uma entrada é marcada como paga."} />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-clientes-da-central="">
            {visiveis.map(({ c, s, v }) => (
              <li key={c.conta_id}>
                <button type="button" className={juntar(lista.linha, "w-full flex-wrap items-start text-left")} onClick={() => setAberto(c.conta_id)} data-cliente={s.estado}>
                  <span className="min-w-0 flex-1 basis-full sm:basis-0">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>
                      {c.empresa}
                      {c.dominios[0] ? <span className="font-normal text-muted-foreground"> · {c.dominios.map((d) => d.dominio).join(", ")}</span> : null}
                    </span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>
                      {[
                        `${c.caixas}${c.caixas_contratadas ? ` de ${c.caixas_contratadas}` : ""} ${c.caixas === 1 ? "caixa" : "caixas"}${c.apelidos ? ` e ${c.apelidos} ${c.apelidos === 1 ? "apelido" : "apelidos"}` : ""}`,
                        c.dominios[0] ? ROTULO_DO_PROVEDOR[c.dominios[0].provedor as ProvedorDeEmail] || c.dominios[0].provedor : "",
                        v ? `${v.oQue} ${quando(v.dia, hoje)}` : "sem vencimento anotado",
                      ].filter(Boolean).join(" · ")}
                    </span>
                    {s.avisos[0] && (
                      <span className={juntar(texto.auxiliar, "mt-0.5 flex min-w-0 items-center")}>
                        <i className={juntar("mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full", COR_DO_AVISO[s.avisos[0].gravidade])} aria-hidden="true" />
                        <span className="truncate">{s.avisos[0].texto}{s.avisos.length > 1 ? ` (+${s.avisos.length - 1})` : ""}</span>
                      </span>
                    )}
                  </span>
                  <span className={juntar(etiqueta, "mt-1.5 sm:ml-2 sm:mt-0", COR_DA_SAUDE[s.estado])}>{ROTULO_DA_SAUDE[s.estado]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>
      {escolhido && (
        <FichaDoEmail
          cliente={escolhido.c}
          saude={escolhido.s}
          hoje={hoje}
          onFechar={() => setAberto(null)}
          aoSalvar={() => qc.invalidateQueries({ queryKey: ["produto", "casa", "email"] })}
        />
      )}
    </div>
  );
}

function FichaDoEmail({ cliente, saude, hoje, onFechar, aoSalvar }: { cliente: ClienteNaCentral; saude: { estado: Saude; avisos: Array<{ gravidade: Gravidade; texto: string }> }; hoje: string; onFechar: () => void; aoSalvar: () => Promise<unknown> }) {
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="lg"
      titulo={cliente.empresa}
      descricao={`${ROTULO_DA_SAUDE[saude.estado]} · ${cliente.caixas} ${cliente.caixas === 1 ? "caixa" : "caixas"}${cliente.caixas_sem_dono ? ` · ${cliente.caixas_sem_dono} sem pessoa definida` : ""}`}
      rodape={<Link to="/produto/email/entradas" className={botao.secundario}>Abrir entradas e migração</Link>}
    >
      <div className="min-w-0 space-y-5" data-ficha-do-email="">
        {saude.avisos.length === 0 ? (
          <p className={texto.corpo}>Tudo em dia.</p>
        ) : (
          <ul className="space-y-1.5" data-avisos-do-cliente="">
            {saude.avisos.map((a) => (
              <li key={a.texto} className="flex min-w-0 items-start">
                <i className={juntar("mr-2 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", COR_DO_AVISO[a.gravidade])} aria-hidden="true" />
                <span className={juntar(texto.corpo, "min-w-0")}>{a.texto}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          <li className={lista.linha}>
            <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Cobrança</span>
            <span className={juntar(texto.corpo, "ml-3 text-right")}>
              {cliente.cobranca
                ? `${reais(cliente.cobranca.mensal)} no extra da ficha${cliente.cobranca.proximo_vencimento ? ` · próxima ${diaLegivel(cliente.cobranca.proximo_vencimento, true)}` : ""}`
                : cliente.assinatura && cliente.assinatura.estado !== "sem"
                  ? `${reais(cliente.assinatura.valor_mensal)} na assinatura${cliente.assinatura.proximo_vencimento ? ` · próxima ${diaLegivel(cliente.assinatura.proximo_vencimento, true)}` : ""}`
                  : cliente.pedido && cliente.pedido.pago_em
                    ? `Pago em ${diaLegivel(cliente.pedido.pago_em, true)}`
                    : "Sem cobrança registrada"}
            </span>
          </li>
        </ul>
        {cliente.dominios.length === 0 ? (
          <p className={texto.auxiliar}>Ainda sem domínio: marque a entrada como paga para a migração nascer.</p>
        ) : (
          cliente.dominios.map((d) => <DominioNaFicha key={d.id} dominio={d} hoje={hoje} aoSalvar={aoSalvar} />)
        )}
      </div>
    </JanelaCentral>
  );
}

function DominioNaFicha({ dominio, hoje, aoSalvar }: { dominio: DominioNaCentral; hoje: string; aoSalvar: () => Promise<unknown> }) {
  const [f, setF] = useState({
    dominio_vence_em: dominio.dominio_vence_em || "",
    provedor_vence_em: dominio.provedor_vence_em || "",
    provedor_custo_mensal: dominio.provedor_custo_mensal == null ? "" : String(dominio.provedor_custo_mensal),
    correio_provedor: dominio.correio_provedor,
    correio_ligado: dominio.correio_ligado,
  });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    try {
      const provedor = f.correio_provedor;
      await salvarIntegracao(dominio.id, {
        dominio_vence_em: f.dominio_vence_em,
        provedor_vence_em: f.provedor_vence_em,
        provedor_custo_mensal: f.provedor_custo_mensal.replace(",", "."),
        correio_provedor: provedor,
        correio_ligado: provedor === "nenhum" ? false : f.correio_ligado,
      });
      toast.success("Salvo.");
      await aoSalvar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };
  const dns = dominio.dns_pronto === null ? "nunca conferido" : dominio.dns_pronto ? "certo" : dominio.dns_faltas ? `${dominio.dns_faltas} faltando` : "com atenção";
  return (
    <Secao
      titulo={dominio.dominio}
      descricao={[ROTULO_DO_ESTADO_DO_DOMINIO[dominio.estado as EstadoDoDominio] || dominio.estado, `DNS ${dns}`, dominio.etapas_total ? `${dominio.etapas_feitas} de ${dominio.etapas_total} etapas` : "", dominio.checado_em ? `conferido ${quando(dominio.checado_em.slice(0, 10), hoje)}` : ""].filter(Boolean).join(" · ")}
      ajuda="Anote aqui quando vence o registro do domínio e o plano de e-mail: a central avisa 45 e 30 dias antes. O custo mensal do provedor entra na margem. O correio no painel só liga depois de contratar um plano com IMAP."
    >
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Registro do domínio vence em">
          <input type="date" value={f.dominio_vence_em} onChange={(e) => setF({ ...f, dominio_vence_em: e.target.value })} className={campo} data-campo="dominio-vence" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Plano de e-mail vence em" apoio="Vazio no plano gratuito">
          <input type="date" value={f.provedor_vence_em} onChange={(e) => setF({ ...f, provedor_vence_em: e.target.value })} className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Custo do provedor por mês" apoio="Em reais, só deste domínio">
          <input value={f.provedor_custo_mensal} onChange={(e) => setF({ ...f, provedor_custo_mensal: e.target.value })} className={campo} inputMode="decimal" placeholder="0,00" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Correio no painel">
          <select value={f.correio_provedor} onChange={(e) => setF({ ...f, correio_provedor: e.target.value as DominioNaCentral["correio_provedor"] })} className={campo} data-campo="correio-provedor">
            {(Object.keys(ROTULO_DO_CORREIO) as Array<DominioNaCentral["correio_provedor"]>).map((p) => <option key={p} value={p}>{ROTULO_DO_CORREIO[p]}</option>)}
          </select>
        </CampoDeFormulario>
        {f.correio_provedor !== "nenhum" && (
          <CampoDeFormulario rotulo="Situação do correio" largo>
            <SeletorCompacto rotulo="Correio" opcoes={[{ valor: "nao", rotulo: "Desligado" }, { valor: "sim", rotulo: "Ligado" }]} valor={f.correio_ligado ? "sim" : "nao"} onEscolher={(v) => setF({ ...f, correio_ligado: v === "sim" })} />
          </CampoDeFormulario>
        )}
      </GrupoDeCampos>
      <div className="mt-3 flex justify-end">
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void salvar()} disabled={salvando} data-salvar-vencimentos="">{salvando ? "Salvando..." : "Salvar"}</button>
      </div>
    </Secao>
  );
}
