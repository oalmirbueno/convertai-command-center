import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Loader2, Paperclip, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { lerArquivosDoAgente, tamanhoLegivel } from "@/components/mesa/leituraDeArquivos";
import { useFinancePlans } from "@/hooks/useFinanceV2";
import { SERVICE_LABELS } from "@/lib/cycleDefs";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import MenuMais from "@/components/sistema/MenuMais";
import { botao, campo, campoTexto, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import {
  dataCurta,
  lerValor,
  reais,
  ROTULO_DO_STATUS,
  textoDoTotal,
  totaisDosItens,
  type ItemDaProposta,
} from "../../../supabase/functions/_shared/proposta-modelo";
import { aplicarNaLista, chamarProposta, useLeadsDoComercial, useModelosDeProposta, type Proposta } from "./propostaApi";

/**
 * Etapa 1, Contexto: qual proposta (criar ou abrir), o material da reunião
 * (notas, transcrição e arquivos lidos no navegador), o investimento pelos
 * itens (do plano do Financeiro, do serviço ou livre), a validade e o lead
 * do Comercial. O preço da proposta sai só daqui.
 */

type ItemNaTela = { id: string; nome: string; quantidade: string; valor: string; recorrencia: "unico" | "mensal"; origem: ItemDaProposta["origem"]; plano_id: string | null; servico: string | null; descricao: string };

const paraTela = (i: ItemDaProposta): ItemNaTela => ({ id: i.id, nome: i.nome, quantidade: String(i.quantidade), valor: String(i.valor_unitario).replace(".", ","), recorrencia: i.recorrencia, origem: i.origem, plano_id: i.plano_id, servico: i.servico, descricao: i.descricao });

const TOM: Record<string, string> = {
  rascunho: "bg-muted text-muted-foreground",
  enviada: "bg-primary/10 text-primary",
  vista: "bg-primary/10 text-primary",
  aceita: "bg-success/15 text-success",
  recusada: "bg-destructive/10 text-destructive",
  expirada: "bg-warning/15 text-warning",
};

export function SeloDaProposta({ status }: { status: Proposta["status_efetivo"] }) {
  return <span className={juntar(etiqueta, TOM[status] || TOM.rascunho)}>{ROTULO_DO_STATUS[status] || status}</span>;
}

function ListaDePropostas({ propostas, abertaId, onAbrir }: { propostas: Proposta[]; abertaId: string | null; onAbrir: (id: string) => void }) {
  const [verArquivadas, setVerArquivadas] = useState(false);
  const vivas = propostas.filter((p) => verArquivadas || !p.arquivada_em);
  return (
    <>
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Propostas do cliente">
        {vivas.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onAbrir(p.id)} className={juntar(lista.linha, "w-full text-left", p.id === abertaId && lista.destaque)} aria-current={p.id === abertaId ? "true" : undefined}>
              <span className={juntar(texto.auxiliar, "mr-3 shrink-0 tabular-nums")}>{p.numero}</span>
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{p.titulo}</span>
              <span className={juntar(texto.auxiliar, "ml-3 hidden shrink-0 tabular-nums sm:inline")}>{textoDoTotal(p.totais)}</span>
              <span className="ml-3 shrink-0">
                <SeloDaProposta status={p.status_efetivo} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {propostas.some((p) => p.arquivada_em) && (
        <button type="button" className={juntar(botao.discreto, "mt-1 h-8 px-2 text-[12px]")} onClick={() => setVerArquivadas((v) => !v)}>
          {verArquivadas ? "Esconder arquivadas" : "Ver arquivadas"}
        </button>
      )}
    </>
  );
}

function NovaProposta({ leadInicial, onCriada }: { leadInicial: string | null; onCriada: (id: string) => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const modelos = useModelosDeProposta();
  const leads = useLeadsDoComercial();
  const [modelo, setModelo] = useState("");
  const [lead, setLead] = useState(leadInicial || "");
  const [titulo, setTitulo] = useState("");
  const [criando, setCriando] = useState(false);
  useEffect(() => {
    if (leadInicial) setLead(leadInicial);
  }, [leadInicial]);
  const criar = async () => {
    setCriando(true);
    try {
      const d = await chamarProposta<any>("criar", { client_id: mesa.clientId, modelo_id: modelo || undefined, lead_id: lead || undefined, titulo: titulo.trim() || undefined });
      const p = aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      if (d && d.aviso_agencia) toast.info("Dados da agência incompletos", { description: "Quem somos e provas ficam de fora até a agência cadastrar." });
      if (p) onCriada(p.id);
    } catch (e) {
      avisarErro(e, "A proposta não foi criada");
    } finally {
      setCriando(false);
    }
  };
  return (
    <div className="space-y-3" data-nova-proposta="">
      <GrupoDeCampos colunas={3}>
        <CampoDeFormulario rotulo="Projeto">
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} placeholder="Ex.: Identidade visual e redes" className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Modelo de proposta">
          <select value={modelo} onChange={(e) => setModelo(e.target.value)} className={campo}>
            <option value="">Padrão da agência</option>
            {(modelos.data || []).map((m) => (
              <option key={m.id || m.nome} value={m.id || ""}>
                {m.nome}
                {m.padrao ? " (padrão)" : ""}
              </option>
            ))}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Lead do Comercial">
          <select value={lead} onChange={(e) => setLead(e.target.value)} className={campo}>
            <option value="">Sem lead</option>
            {(leads.data || []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.empresa ? `${l.empresa} (${l.nome})` : l.nome}
              </option>
            ))}
          </select>
        </CampoDeFormulario>
      </GrupoDeCampos>
      <div className="flex justify-end">
        <button type="button" className={botao.primario} onClick={() => void criar()} disabled={criando}>
          {criando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-1.5 h-4 w-4" />}
          Criar proposta
        </button>
      </div>
    </div>
  );
}

function Reuniao({ proposta }: { proposta: Proposta }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [notas, setNotas] = useEstadoDaTela<string>(`mesa-proposta:notas:${proposta.id}:${proposta.versao}`, proposta.contexto.notas || "", { esperaMs: 300 });
  const [transcricao, setTranscricao] = useEstadoDaTela<string>(`mesa-proposta:transcricao:${proposta.id}:${proposta.versao}`, proposta.contexto.transcricao || "", { esperaMs: 300 });
  const [salvando, setSalvando] = useState(false);
  const mudou = notas !== (proposta.contexto.notas || "") || transcricao !== (proposta.contexto.transcricao || "");
  const salvar = async () => {
    setSalvando(true);
    try {
      const d = await chamarProposta<any>("salvar", { proposta_id: proposta.id, versao_base: proposta.versao, notas, transcricao });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      toast.success("Material da reunião salvo.");
    } catch (e) {
      avisarErro(e, "O material não foi salvo");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Secao
      titulo="Reunião"
      divisoria
      descricao={mudou ? "Alterações não salvas" : proposta.contexto.transcricao ? "Transcrição guardada" : undefined}
      ajuda="Cole as notas e a transcrição da reunião de pré-briefing. O estrategista usa as palavras do cliente no desafio e só aceita número que esteja aqui, nos arquivos ou no painel."
      acao={
        <button type="button" className={botao.secundario} onClick={() => void salvar()} disabled={!mudou || salvando}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      }
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <CampoDeFormulario rotulo="Notas da equipe">
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} className={juntar(campoTexto, "min-h-[140px]")} maxLength={20000} placeholder="O que o cliente quer, dores, prazos, orçamento que ele citou" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Transcrição da reunião">
          <textarea value={transcricao} onChange={(e) => setTranscricao(e.target.value)} className={juntar(campoTexto, "min-h-[140px]")} maxLength={60000} placeholder="Cole aqui a transcrição" />
        </CampoDeFormulario>
      </div>
    </Secao>
  );
}

function Arquivos({ proposta }: { proposta: Proposta }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const entrada = useRef<HTMLInputElement | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const materiais = proposta.contexto.materiais || [];
  const anexar = async (arquivos: FileList | null) => {
    const todos = arquivos ? (Array.prototype.slice.call(arquivos) as File[]) : [];
    if (!todos.length) return;
    setOcupado(true);
    try {
      const r = await lerArquivosDoAgente(todos, 0);
      if (r.naoLidos.length || r.imagens.length) toast.error("Alguns arquivos não foram lidos", { description: r.naoLidos.map((n) => `${n.nome}: ${n.motivo}`).slice(0, 3).join(" ") || "Imagens não entram como material." });
      if (!r.lidos.length) return;
      const d = await chamarProposta<any>("materiais_adicionar", { proposta_id: proposta.id, arquivos: r.lidos.map((a) => ({ nome: a.nome, tipo: a.tipo, texto: a.texto })) });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      toast.success(`${r.lidos.length} arquivo(s) no material da proposta.`);
    } catch (e) {
      avisarErro(e, "Os arquivos não foram guardados");
    } finally {
      setOcupado(false);
      if (entrada.current) entrada.current.value = "";
    }
  };
  const remover = async (nome: string) => {
    try {
      const d = await chamarProposta<any>("material_remover", { proposta_id: proposta.id, nome });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
    } catch (e) {
      avisarErro(e, "O arquivo não saiu");
    }
  };
  return (
    <Secao
      titulo="Arquivos"
      divisoria
      descricao={materiais.length ? `${materiais.length} no material` : undefined}
      ajuda="PDF, Word, planilha, apresentação ou texto: o texto é lido aqui no navegador e vira material da proposta. Também dá para mandar pela conversa do estrategista."
      acao={
        <>
          <input ref={entrada} type="file" multiple className="hidden" onChange={(e) => void anexar(e.target.files)} accept=".txt,.md,.csv,.tsv,.json,.srt,.vtt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rtf,.html" />
          <button type="button" className={botao.secundario} onClick={() => entrada.current && entrada.current.click()} disabled={ocupado} aria-label="Anexar arquivos">
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            <span className="ml-1.5 hidden sm:inline">Anexar</span>
          </button>
        </>
      }
    >
      {materiais.length ? (
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {materiais.map((m) => (
            <li key={m.nome} className={lista.linha}>
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{m.nome}</span>
              <span className={juntar(texto.auxiliar, "ml-3 shrink-0")}>{tamanhoLegivel(m.texto.length)}</span>
              <button type="button" className={juntar(botao.icone, "ml-2")} aria-label={`Tirar ${m.nome}`} onClick={() => void remover(m.nome)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EstadoVazio compacto titulo="Nenhum arquivo." descricao="Anexe o que o cliente mandou." />
      )}
    </Secao>
  );
}

function Investimento({ proposta }: { proposta: Proposta }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const planos = useFinancePlans();
  const leads = useLeadsDoComercial();
  const [itens, setItens] = useState<ItemNaTela[]>(() => proposta.itens.map(paraTela));
  const [validade, setValidade] = useState(proposta.validade_ate || "");
  const [lead, setLead] = useState(proposta.lead_id || "");
  const [salvando, setSalvando] = useState(false);
  // Chegou versão nova (agente, outra pessoa): a tela segue o banco.
  useEffect(() => {
    setItens(proposta.itens.map(paraTela));
    setValidade(proposta.validade_ate || "");
    setLead(proposta.lead_id || "");
  }, [proposta.id, proposta.versao]);

  const lidos = useMemo(
    () =>
      itens.map((i) => ({
        id: i.id,
        nome: i.nome.trim(),
        descricao: i.descricao,
        quantidade: Math.max(1, Math.round(Number(i.quantidade) || 1)),
        valor_unitario: lerValor(i.valor),
        recorrencia: i.recorrencia,
        origem: i.origem,
        plano_id: i.plano_id,
        servico: i.servico,
      })),
    [itens],
  );
  const invalidos = lidos.filter((i) => !i.nome || i.valor_unitario === null).length;
  const validos = lidos.filter((i) => i.nome && i.valor_unitario !== null) as ItemDaProposta[];
  const totais = totaisDosItens(validos);
  const mudou = JSON.stringify(validos) !== JSON.stringify(proposta.itens) || validade !== (proposta.validade_ate || "") || lead !== (proposta.lead_id || "");

  const novoId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const adicionar = (i: Partial<ItemNaTela>) => setItens((l) => l.concat([{ id: novoId(), nome: "", quantidade: "1", valor: "", recorrencia: "unico", origem: "manual", plano_id: null, servico: null, descricao: "", ...i }]));
  const mudar = (id: string, campoMudado: Partial<ItemNaTela>) => setItens((l) => l.map((x) => (x.id === id ? { ...x, ...campoMudado } : x)));

  const itensDoMenu = [
    ...(planos.data || [])
      .filter((p) => p.isActive && p.currentVersion)
      .map((p) => ({
        rotulo: `Plano: ${p.name}`,
        aoEscolher: () => {
          const v = p.currentVersion!;
          adicionar({ nome: p.name, valor: String(v.finalAmount).replace(".", ","), recorrencia: v.billingPeriod === "monthly" ? "mensal" : "unico", origem: "plano", plano_id: p.id });
          if (v.setupFee > 0) adicionar({ nome: `Implantação ${p.name}`, valor: String(v.setupFee).replace(".", ","), recorrencia: "unico", origem: "plano", plano_id: p.id });
        },
      })),
    ...Object.keys(SERVICE_LABELS).map((k, i) => ({ rotulo: `Serviço: ${SERVICE_LABELS[k]}`, separadorAntes: i === 0, aoEscolher: () => adicionar({ nome: SERVICE_LABELS[k], origem: "servico", servico: k }) })),
  ];

  const salvar = async () => {
    if (invalidos) {
      toast.error("Há item sem nome ou com valor inválido.");
      return;
    }
    setSalvando(true);
    try {
      const d = await chamarProposta<any>("salvar", { proposta_id: proposta.id, versao_base: proposta.versao, itens: validos, validade_ate: validade || undefined, lead_id: lead || null });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      toast.success("Investimento salvo.");
    } catch (e) {
      avisarErro(e, "O investimento não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Secao
      titulo="Investimento"
      divisoria
      descricao={`${textoDoTotal(totais)}${mudou ? " · não salvo" : ""}`}
      ajuda="O preço da proposta sai só destes itens: do plano do Financeiro, de um serviço ou livre. O estrategista escreve os intangíveis e as condições; o valor é daqui."
      acao={
        <>
          <MenuMais rotulo="Adicionar do Financeiro ou de um serviço" itens={itensDoMenu} />
          <button type="button" className={botao.secundario} onClick={() => adicionar({})} aria-label="Adicionar item livre">
            <Plus className="h-4 w-4" />
            <span className="ml-1.5 hidden sm:inline">Item</span>
          </button>
          <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={!mudou || salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      {itens.length ? (
        <ul className="min-w-0 space-y-3" aria-label="Itens do investimento">
          {itens.map((i) => {
            const valor = lerValor(i.valor);
            return (
              <li key={i.id} className="grid min-w-0 grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_72px_120px_120px_32px]">
                <label className="col-span-2 min-w-0 sm:col-span-1">
                  <span className={texto.rotulo}>Item</span>
                  <input value={i.nome} onChange={(e) => mudar(i.id, { nome: e.target.value })} maxLength={120} className={campo} />
                </label>
                <label className="min-w-0">
                  <span className={texto.rotulo}>Qtd.</span>
                  <input value={i.quantidade} onChange={(e) => mudar(i.id, { quantidade: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className={campo} />
                </label>
                <label className="min-w-0">
                  <span className={texto.rotulo}>Valor (R$)</span>
                  <input value={i.valor} onChange={(e) => mudar(i.id, { valor: e.target.value })} inputMode="decimal" aria-invalid={valor === null ? true : undefined} className={juntar(campo, valor === null && i.valor ? "border-destructive" : "")} />
                </label>
                <label className="min-w-0">
                  <span className={texto.rotulo}>Cobrança</span>
                  <select value={i.recorrencia} onChange={(e) => mudar(i.id, { recorrencia: e.target.value === "mensal" ? "mensal" : "unico" })} className={campo}>
                    <option value="unico">Única</option>
                    <option value="mensal">Mensal</option>
                  </select>
                </label>
                <button type="button" className={botao.icone} aria-label={`Tirar ${i.nome || "item"}`} onClick={() => setItens((l) => l.filter((x) => x.id !== i.id))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EstadoVazio compacto titulo="Sem itens." descricao="Adicione do Financeiro, de um serviço ou livre." />
      )}
      <div className="mt-4">
        <GrupoDeCampos colunas={2}>
          <CampoDeFormulario rotulo="Validade" apoio={validade ? `Até ${dataCurta(validade)}` : undefined}>
            <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Lead do Comercial">
            <select value={lead} onChange={(e) => setLead(e.target.value)} className={campo}>
              <option value="">Sem lead</option>
              {(leads.data || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.empresa ? `${l.empresa} (${l.nome})` : l.nome}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
        </GrupoDeCampos>
      </div>
      {totais.itens > 0 && (
        <p className={juntar(texto.auxiliar, "mt-3 tabular-nums")}>
          {totais.unico > 0 ? `Único ${reais(totais.unico)}` : ""}
          {totais.unico > 0 && totais.mensal > 0 ? " · " : ""}
          {totais.mensal > 0 ? `Mensal ${reais(totais.mensal)}` : ""}
        </p>
      )}
    </Secao>
  );
}

export default function EtapaContexto({
  proposta,
  propostas,
  semTabela,
  leadUrl,
  onAbrir,
}: {
  proposta: Proposta | null;
  propostas: Proposta[];
  semTabela: boolean;
  leadUrl: string | null;
  onAbrir: (id: string) => void;
}) {
  const [nova, setNova] = useState(false);
  const perguntas = proposta ? proposta.contexto.perguntas || [] : [];
  if (semTabela) return <EstadoVazio titulo="O banco ainda não tem as propostas." descricao="Falta aplicar a migration das propostas." />;
  return (
    <div className="min-w-0 space-y-6" data-etapa-proposta="contexto">
      <Secao
        titulo="Propostas"
        descricao={propostas.length ? `${propostas.filter((p) => !p.arquivada_em).length} deste cliente` : undefined}
        acao={
          <button type="button" className={nova || !propostas.length ? botao.discreto : botao.secundario} onClick={() => setNova((v) => !v)} aria-expanded={nova}>
            <Plus className="h-4 w-4" />
            <span className="ml-1.5 hidden sm:inline">{nova ? "Fechar" : "Nova proposta"}</span>
          </button>
        }
      >
        {(nova || !propostas.length || (!!leadUrl && !proposta)) && (
          <NovaProposta
            leadInicial={leadUrl}
            onCriada={(id) => {
              setNova(false);
              onAbrir(id);
            }}
          />
        )}
        {propostas.length > 0 && <ListaDePropostas propostas={propostas} abertaId={proposta ? proposta.id : null} onAbrir={onAbrir} />}
      </Secao>
      {proposta && (
        <>
          {perguntas.length > 0 && (
            <Secao titulo="O estrategista precisa saber" divisoria descricao={`${perguntas.length} pergunta(s)`}>
              <ul className="list-disc space-y-1 pl-5">
                {perguntas.map((p) => (
                  <li key={p} className={texto.corpo}>
                    {p}
                  </li>
                ))}
              </ul>
            </Secao>
          )}
          <Reuniao key={`r-${proposta.id}`} proposta={proposta} />
          <Arquivos proposta={proposta} />
          <Investimento key={`i-${proposta.id}`} proposta={proposta} />
        </>
      )}
    </div>
  );
}
