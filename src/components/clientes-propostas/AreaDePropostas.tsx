import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, BriefcaseBusiness, Plus, TrendingUp } from "lucide-react";
import NovoClienteRapido from "@/components/clientes/NovoClienteRapido";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, etiqueta, foco, juntar, texto } from "@/components/sistema/estilos";
import { dataCurta } from "../../../supabase/functions/_shared/proposta-modelo";
import NovaProposta, { type ClienteDaEscolha, type ClienteParaCriar, type TipoDaNovaProposta } from "./NovaProposta";
import {
  enderecoDaProposta,
  filtrarCarteira,
  FILTROS_DA_CARTEIRA,
  situacaoDaLinha,
  useCriarProposta,
  usePropostasDaCarteira,
  valorDaLinha,
  type FiltroDaCarteira,
  type LinhaDaCarteira,
} from "./propostasDaCarteira";

/** Cor da etiqueta do status (o status do dia: validade vencida já vem como expirada). */
export const COR_DO_STATUS: Record<string, string> = {
  rascunho: "bg-muted text-muted-foreground",
  enviada: "bg-primary/10 text-primary",
  vista: "bg-warning/10 text-warning",
  aceita: "bg-success/10 text-success",
  recusada: "bg-destructive/10 text-destructive",
  expirada: "bg-muted text-muted-foreground",
};

const MOSTRAR = 8;

/** Uma linha da lista de propostas (a mesma na área de Clientes e na ficha do cliente). */
export function LinhaDaProposta({ l, cliente, onAbrir }: { l: LinhaDaCarteira; cliente?: string; onAbrir: (l: LinhaDaCarteira) => void }) {
  return (
    <li className="min-w-0" data-linha-da-proposta={l.id}>
      <button type="button" onClick={() => onAbrir(l)} className={juntar("flex w-full min-w-0 items-center px-3 py-2.5 text-left transition-colors hover:bg-muted/30 sm:px-4", foco)} aria-label={`Abrir a proposta ${l.numero}${cliente ? ` de ${cliente}` : ""}`}>
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-center">
            <span className={juntar(texto.corpo, "min-w-0 truncate font-semibold")}>{cliente || l.titulo}</span>
            <span className={juntar(etiqueta, "ml-1.5", COR_DO_STATUS[l.status] || COR_DO_STATUS.rascunho)}>{situacaoDaLinha({ ...l, status: l.status })}</span>
            {l.upsell && <span className={juntar(etiqueta, "ml-1.5 bg-accent/15 text-foreground")}>Upsell</span>}
            {l.followup && (
              <span className={juntar(etiqueta, "ml-1.5 hidden bg-warning/10 text-warning sm:inline-flex")} title={l.followup.texto}>
                <BellRing className="mr-1 h-3 w-3" aria-hidden="true" />
                Follow-up
              </span>
            )}
          </span>
          <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>
            Nº {l.numero}
            {cliente ? ` · ${l.titulo}` : ""}
            {l.followup ? ` · ${l.followup.texto}` : ""}
          </span>
        </span>
        <span className="ml-3 hidden shrink-0 text-right sm:block">
          <span className={juntar(texto.corpo, "block tabular-nums")}>{valorDaLinha(l)}</span>
          <span className={juntar(texto.auxiliar, "block tabular-nums")}>{l.validade_ate ? `Vale até ${dataCurta(l.validade_ate)}` : "Sem validade"}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * Área "Propostas" da página de Clientes (frente PRO3, 30/09). Pedido do dono:
 * a proposta mora em Clientes (cliente novo para mandar proposta, e upsell),
 * não no seletor de mesas. Lista todas as propostas com status, valor,
 * validade, vista ou aceita e follow-up pendente, com filtro, "Nova proposta"
 * e "Upsell". Recolhe como as outras seções; `?propostas=1` (o caminho de
 * volta da Mesa Proposta) abre e rola até aqui.
 */
export default function AreaDePropostas({
  clientes,
  nomeDoCliente,
  podeCriarCliente,
  abrirNaEntrada = false,
}: {
  /** Clientes da carteira para o upsell (sem as empresas do grupo). */
  clientes: ClienteDaEscolha[];
  nomeDoCliente: (id: string) => string;
  podeCriarCliente: boolean;
  abrirNaEntrada?: boolean;
}) {
  const navigate = useNavigate();
  const raiz = useRef<HTMLElement | null>(null);
  const [recolhido, setRecolhido] = useRecolhido("clientes:propostas", true);
  const [filtro, setFiltro] = useEstadoDaTela<FiltroDaCarteira>("clientes:propostas:filtro", "abertas", { validar: (v) => FILTROS_DA_CARTEIRA.some((f) => f.valor === v) });
  const [todas, setTodas] = useState(false);
  const [janela, setJanela] = useState<{ aberta: boolean; tipo: TipoDaNovaProposta }>({ aberta: false, tipo: "nova" });
  const [novoCliente, setNovoCliente] = useState<ClienteParaCriar | null>(null);
  const carteira = usePropostasDaCarteira(!recolhido);
  const { criar } = useCriarProposta();

  useEffect(() => {
    if (!abrirNaEntrada) return;
    setRecolhido(false);
    const el = raiz.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirNaEntrada]);

  const lista = carteira.data ? carteira.data.lista : [];
  const filtradas = useMemo(() => filtrarCarteira(lista, filtro), [lista, filtro]);
  const visiveis = todas ? filtradas : filtradas.slice(0, MOSTRAR);
  const abertas = filtrarCarteira(lista, "abertas").length;
  const followups = filtrarCarteira(lista, "followup").length;
  const resumo = carteira.data ? `${abertas} em aberto${followups ? ` · ${followups} com follow-up` : ""}` : "Nova proposta e upsell";

  return (
    <section ref={raiz} id="propostas" aria-label="Propostas" className="min-w-0 scroll-mt-24" data-area-de-propostas="">
      <CabecalhoDeSecao
        className="mb-3"
        titulo="Propostas"
        descricao={resumo}
        ajuda="Proposta comercial com link e aceite. Nova proposta é para cliente novo (do lead do Comercial ou criando o cliente agora); Upsell é para quem já é cliente e nasce com o que ele já tem e os resultados reais. A proposta abre na Mesa Proposta."
        recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo }}
        acao={
          <>
            {!recolhido && (
              <SeletorCompacto rotulo="Filtrar propostas" modo="lista" opcoes={FILTROS_DA_CARTEIRA.map((f) => ({ valor: f.valor, rotulo: f.rotulo }))} valor={filtro} onEscolher={(v) => setFiltro(v as FiltroDaCarteira)} />
            )}
            <button type="button" className={botao.secundario} onClick={() => setJanela({ aberta: true, tipo: "upsell" })} aria-label="Proposta de upsell">
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1.5 hidden sm:inline">Upsell</span>
            </button>
            <button type="button" className={botao.primario} onClick={() => setJanela({ aberta: true, tipo: "nova" })} aria-label="Nova proposta">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1.5 hidden sm:inline">Nova proposta</span>
            </button>
          </>
        }
      />
      {!recolhido &&
        (carteira.isLoading ? (
          <Carregando rotulo="Lendo as propostas" linhas={3} />
        ) : carteira.isError ? (
          <EstadoDeErro
            titulo="As propostas não foram lidas."
            acao={
              <button type="button" className={botao.secundario} onClick={() => void carteira.refetch()}>
                Tentar de novo
              </button>
            }
          />
        ) : carteira.data && carteira.data.semTabela ? (
          <EstadoVazio compacto icone={<BriefcaseBusiness className="h-5 w-5" />} titulo="O banco ainda não tem as propostas." />
        ) : filtradas.length === 0 ? (
          <EstadoVazio compacto icone={<BriefcaseBusiness className="h-5 w-5" />} titulo={lista.length ? "Nenhuma proposta neste filtro." : "Nenhuma proposta ainda."} />
        ) : (
          <>
            <Painel semEspaco>
              <ul className="divide-y divide-border">
                {visiveis.map((l) => (
                  <LinhaDaProposta key={l.id} l={l} cliente={nomeDoCliente(l.client_id)} onAbrir={(x) => navigate(enderecoDaProposta(x))} />
                ))}
              </ul>
            </Painel>
            {filtradas.length > MOSTRAR && (
              <button type="button" className={juntar(botao.discreto, "mt-2")} onClick={() => setTodas(!todas)}>
                {todas ? "Mostrar menos" : `Ver as ${filtradas.length}`}
              </button>
            )}
          </>
        ))}

      <NovaProposta
        aberta={janela.aberta}
        onAberta={(v) => setJanela((j) => ({ ...j, aberta: v }))}
        tipoInicial={janela.tipo}
        clientes={clientes}
        podeCriarCliente={podeCriarCliente}
        onCriarCliente={(dados) => {
          setJanela((j) => ({ ...j, aberta: false }));
          setNovoCliente(dados);
        }}
      />
      {/* Adendo do dono (30/09): o cliente novo nasce pela janela central de cliente avulso (nada é enviado a ele). */}
      {podeCriarCliente && (
        <NovoClienteRapido
          aberto={!!novoCliente}
          onAberto={(v) => !v && setNovoCliente(null)}
          titulo="Cliente novo para a proposta"
          rotuloDoCriar="Criar e abrir a proposta"
          tipoInicial={novoCliente && novoCliente.leadId ? "lead" : "avulso"}
          inicial={novoCliente ? { nome: novoCliente.fullName, empresa: novoCliente.company, email: novoCliente.email, whatsapp: novoCliente.phone, leadId: novoCliente.leadId } : null}
          onCriado={(c) => {
            const leadId = novoCliente ? novoCliente.leadId : null;
            setNovoCliente(null);
            void criar({ clientId: c.id, leadId, tipo: "nova" });
          }}
        />
      )}
    </section>
  );
}
