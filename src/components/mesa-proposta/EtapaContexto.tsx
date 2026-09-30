import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, FilePlus2, Layers, Loader2, Paperclip, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
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
  hojeEmSaoPaulo,
  lerValor,
  normalizarItens,
  reais,
  ROTULO_DO_STATUS,
  textoDoTotal,
  totaisDosItens,
  type ItemDaProposta,
} from "../../../supabase/functions/_shared/proposta-modelo";
import {
  avisosDosPacotes,
  followupDaProposta,
  itemDoServico,
  NIVEIS_DO_PACOTE,
  normalizarPacotes,
  resumoDosPacotes,
  ROTULO_DA_UNIDADE,
  ROTULO_DO_NIVEL,
  type NivelDoPacote,
  type Pacotes,
} from "../../../supabase/functions/_shared/proposta-comercial";
import { aplicarNaLista, chamarProposta, useLeadsDoComercial, useModelosDeProposta, useServicos, type Proposta } from "./propostaApi";
import AnexosDaProposta from "./AnexosDaProposta";
import BibliotecaDaAgencia, { type AbaDaBiblioteca } from "./BibliotecaDaAgencia";
import CalculadoraDaProposta from "./CalculadoraDaProposta";
import PagamentoDaProposta from "./PagamentoDaProposta";

/**
 * Etapa 1, Contexto: qual proposta (criar ou abrir), o material da reunião
 * (notas, transcrição e arquivos lidos no navegador), o investimento pelos
 * itens (do plano do Financeiro, do serviço ou livre), a validade e o lead
 * do Comercial. O preço da proposta sai só daqui.
 */

type ItemNaTela = { id: string; nome: string; quantidade: string; valor: string; recorrencia: "unico" | "mensal"; origem: ItemDaProposta["origem"]; plano_id: string | null; servico: string | null; descricao: string; horas: string; biblioteca_id: string | null };

const paraTela = (i: ItemDaProposta): ItemNaTela => ({
  id: i.id,
  nome: i.nome,
  quantidade: String(i.quantidade),
  valor: String(i.valor_unitario).replace(".", ","),
  recorrencia: i.recorrencia,
  origem: i.origem,
  plano_id: i.plano_id,
  servico: i.servico,
  descricao: i.descricao,
  horas: i.horas ? String(i.horas).replace(".", ",") : "",
  biblioteca_id: i.biblioteca_id || null,
});

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
  const hoje = hojeEmSaoPaulo();
  return (
    <>
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Propostas do cliente">
        {vivas.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onAbrir(p.id)} className={juntar(lista.linha, "w-full text-left", p.id === abertaId && lista.destaque)} aria-current={p.id === abertaId ? "true" : undefined}>
              <span className={juntar(texto.auxiliar, "mr-3 shrink-0 tabular-nums")}>{p.numero}</span>
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{p.titulo}</span>
              <span className={juntar(texto.auxiliar, "ml-3 hidden shrink-0 tabular-nums sm:inline")}>{textoDoTotal(p.totais)}</span>
              {(() => {
                // Lembrete de follow-up: vista sem resposta, não aberta ou vencendo (a mensagem pronta fica no Envio).
                const f = p.arquivada_em ? null : followupDaProposta(p, hoje);
                return f ? (
                  <span className={juntar(etiqueta, "ml-3 hidden shrink-0 bg-warning/15 text-warning md:inline")} title="Follow-up pronto no Envio" data-followup={f.situacao}>
                    {f.texto}
                  </span>
                ) : null;
              })()}
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

function Reuniao({ proposta, modeloId }: { proposta: Proposta; modeloId: string }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [notas, setNotas] = useEstadoDaTela<string>(`mesa-proposta:notas:${proposta.id}:${proposta.versao}`, proposta.contexto.notas || "", { esperaMs: 300 });
  const [transcricao, setTranscricao] = useEstadoDaTela<string>(`mesa-proposta:transcricao:${proposta.id}:${proposta.versao}`, proposta.contexto.transcricao || "", { esperaMs: 300 });
  const [salvando, setSalvando] = useState(false);
  const [resumo, setResumo] = useState<string | null>(null);
  const mudou = notas !== (proposta.contexto.notas || "") || transcricao !== (proposta.contexto.transcricao || "");
  const temMaterial = !!(transcricao.trim() || notas.trim() || (proposta.contexto.materiais || []).length);
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
        <>
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-4 w-4" />
                Resumir
              </>
            }
            titulo="Resumir a reunião"
            descricao="Objetivo, dores, pedidos, prazos, falas do cliente e o que falta, sem número inventado"
            variant="outline"
            disabled={!temMaterial || mudou || !modeloId}
            partes={() => [{ modeloId, tipo: "texto", tokensEntrada: 14000, tokensSaida: 1500 }]}
            executar={() => chamarProposta("resumir_reuniao", { proposta_id: proposta.id, modelo_id: modeloId || undefined })}
            aoConcluir={(d: any) => setResumo(d && typeof d.notas === "string" ? d.notas : null)}
          />
          <button type="button" className={botao.secundario} onClick={() => void salvar()} disabled={!mudou || salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      {resumo && (
        <div className="mb-4 min-w-0 border-l-2 border-primary pl-3" aria-label="Resumo da reunião">
          <p className={texto.rotulo}>Resumo da reunião</p>
          <pre className={juntar(texto.corpo, "mt-1 whitespace-pre-wrap font-sans [overflow-wrap:anywhere]")}>{resumo}</pre>
          <div className="mt-2 flex flex-wrap [&>*]:mb-2 [&>*]:mr-2">
            <button type="button" className={botao.secundario} onClick={() => { setNotas(`${notas.trim() ? `${notas.trim()}\n\n` : ""}Resumo da reunião:\n${resumo}`); setResumo(null); }}>
              Pôr embaixo das notas
            </button>
            <button type="button" className={botao.discreto} onClick={() => { setNotas(`Resumo da reunião:\n${resumo}`); setResumo(null); }}>
              Trocar as notas
            </button>
            <button type="button" className={botao.discreto} onClick={() => setResumo(null)}>
              Descartar
            </button>
          </div>
        </div>
      )}
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

function Investimento({ proposta, onBiblioteca }: { proposta: Proposta; onBiblioteca: () => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const planos = useFinancePlans();
  const leads = useLeadsDoComercial();
  const servicos = useServicos();
  const [itens, setItens] = useState<ItemNaTela[]>(() => proposta.itens.map(paraTela));
  const [validade, setValidade] = useState(proposta.validade_ate || "");
  const [lead, setLead] = useState(proposta.lead_id || "");
  const [pacotes, setPacotes] = useState<Pacotes>(proposta.pacotes);
  const [salvando, setSalvando] = useState(false);
  // Chegou versão nova (agente, outra pessoa): a tela segue o banco.
  useEffect(() => {
    setItens(proposta.itens.map(paraTela));
    setValidade(proposta.validade_ate || "");
    setLead(proposta.lead_id || "");
    setPacotes(proposta.pacotes);
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
        horas: i.horas ? Number(i.horas.replace(",", ".")) : undefined,
        biblioteca_id: i.biblioteca_id || undefined,
      })),
    [itens],
  );
  const invalidos = lidos.filter((i) => !i.nome || i.valor_unitario === null).length;
  const validos = normalizarItens(lidos.filter((i) => i.nome && i.valor_unitario !== null));
  const totais = totaisDosItens(validos);
  const pacotesNaTela = normalizarPacotes({ ...pacotes, niveis: pacotes.niveis }, validos);
  const mudouPacotes = JSON.stringify(pacotesNaTela) !== JSON.stringify(normalizarPacotes(proposta.pacotes, validos));
  const mudou = JSON.stringify(validos) !== JSON.stringify(proposta.itens) || validade !== (proposta.validade_ate || "") || lead !== (proposta.lead_id || "") || mudouPacotes;
  const resumo = resumoDosPacotes(validos, pacotesNaTela);
  const avisos = avisosDosPacotes(validos, pacotesNaTela);

  const novoId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const adicionar = (i: Partial<ItemNaTela>) => setItens((l) => l.concat([{ id: novoId(), nome: "", quantidade: "1", valor: "", recorrencia: "unico", origem: "manual", plano_id: null, servico: null, descricao: "", horas: "", biblioteca_id: null, ...i }]));
  const mudar = (id: string, campoMudado: Partial<ItemNaTela>) => setItens((l) => l.map((x) => (x.id === id ? { ...x, ...campoMudado } : x)));
  const nivelDe = (id: string): NivelDoPacote => pacotes.niveis[id] || "essencial";

  const vivos = (servicos.data ? servicos.data.lista : []).filter((s) => !s.arquivado);
  const itensDoMenu = [
    ...vivos.map((s) => ({
      rotulo: `Biblioteca: ${s.nome}`,
      dica: `${reais(s.preco)} ${ROTULO_DA_UNIDADE[s.unidade]}`,
      separadorAntes: false,
      aoEscolher: () => adicionar(paraTela(itemDoServico(s, 1, novoId()))),
    })),
    ...(planos.data || [])
      .filter((p) => p.isActive && p.currentVersion)
      .map((p, i) => ({
        rotulo: `Plano: ${p.name}`,
        separadorAntes: i === 0 && vivos.length > 0,
        aoEscolher: () => {
          const v = p.currentVersion!;
          adicionar({ nome: p.name, valor: String(v.finalAmount).replace(".", ","), recorrencia: v.billingPeriod === "monthly" ? "mensal" : "unico", origem: "plano", plano_id: p.id });
          if (v.setupFee > 0) adicionar({ nome: `Implantação ${p.name}`, valor: String(v.setupFee).replace(".", ","), recorrencia: "unico", origem: "plano", plano_id: p.id });
        },
      })),
    ...Object.keys(SERVICE_LABELS).map((k, i) => ({ rotulo: `Serviço: ${SERVICE_LABELS[k]}`, separadorAntes: i === 0, aoEscolher: () => adicionar({ nome: SERVICE_LABELS[k], origem: "servico", servico: k }) })),
    { rotulo: "Abrir a biblioteca", separadorAntes: true, aoEscolher: onBiblioteca },
  ];

  const salvar = async () => {
    if (invalidos) {
      toast.error("Há item sem nome ou com valor inválido.");
      return;
    }
    setSalvando(true);
    try {
      const d = await chamarProposta<any>("salvar", {
        proposta_id: proposta.id,
        versao_base: proposta.versao,
        itens: validos,
        validade_ate: validade || undefined,
        lead_id: lead || null,
        ...(mudouPacotes ? { pacotes: pacotesNaTela } : {}),
      });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      toast.success("Investimento salvo.");
    } catch (e) {
      avisarErro(e, "O investimento não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  const colunas = pacotes.ativo ? "sm:grid-cols-[minmax(0,1fr)_56px_64px_110px_96px_120px_32px]" : "sm:grid-cols-[minmax(0,1fr)_56px_64px_110px_96px_32px]";

  return (
    <Secao
      titulo="Investimento"
      divisoria
      descricao={`${pacotes.ativo && resumo.length ? resumo.map((p) => `${p.nome} ${textoDoTotal(p.totais)}`).join(" · ") : textoDoTotal(totais)}${mudou ? " · não salvo" : ""}`}
      ajuda="O preço da proposta sai só destes itens: da biblioteca da agência, do plano do Financeiro, de um serviço ou livre. Horas por unidade alimentam a calculadora de margem. Com os 3 pacotes ligados, cada item entra a partir de um nível: o Essencial tem o básico, o Recomendado soma o dele e o Completo tem tudo."
      acao={
        <>
          <MenuMais rotulo="Adicionar da biblioteca, do Financeiro ou de um serviço" itens={itensDoMenu} />
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
      <label className={juntar(texto.corpo, "mb-3 inline-flex items-center")}>
        <input type="checkbox" className="mr-2" checked={pacotes.ativo} onChange={(e) => setPacotes({ ...pacotes, ativo: e.target.checked })} />
        <Layers className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Proposta com 3 pacotes
      </label>
      {itens.length ? (
        <ul className="min-w-0 space-y-3" aria-label="Itens do investimento">
          {itens.map((i) => {
            const valor = lerValor(i.valor);
            return (
              <li key={i.id} className={juntar("grid min-w-0 grid-cols-2 items-end gap-2", colunas)}>
                <label className="col-span-2 min-w-0 sm:col-span-1">
                  <span className={texto.rotulo}>Item</span>
                  <input value={i.nome} onChange={(e) => mudar(i.id, { nome: e.target.value })} maxLength={120} className={campo} />
                </label>
                <label className="min-w-0">
                  <span className={texto.rotulo}>Qtd.</span>
                  <input value={i.quantidade} onChange={(e) => mudar(i.id, { quantidade: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className={campo} />
                </label>
                <label className="min-w-0">
                  <span className={texto.rotulo}>Horas</span>
                  <input value={i.horas} onChange={(e) => mudar(i.id, { horas: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" className={campo} aria-label={`Horas por unidade de ${i.nome || "item"}`} />
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
                {pacotes.ativo && (
                  <label className="min-w-0">
                    <span className={texto.rotulo}>Entra a partir</span>
                    <select value={nivelDe(i.id)} onChange={(e) => setPacotes({ ...pacotes, niveis: { ...pacotes.niveis, [i.id]: e.target.value as NivelDoPacote } })} className={campo} aria-label={`Pacote de ${i.nome || "item"}`}>
                      {NIVEIS_DO_PACOTE.map((n) => (
                        <option key={n} value={n}>
                          {pacotes.nomes[n] || ROTULO_DO_NIVEL[n]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="button" className={botao.icone} aria-label={`Tirar ${i.nome || "item"}`} onClick={() => setItens((l) => l.filter((x) => x.id !== i.id))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EstadoVazio compacto titulo="Sem itens." descricao="Adicione da biblioteca, do Financeiro ou livre." />
      )}
      {pacotes.ativo && (
        <div className="mt-4 min-w-0" data-pacotes="">
          <GrupoDeCampos colunas={3}>
            {NIVEIS_DO_PACOTE.map((n) => (
              <CampoDeFormulario key={n} rotulo={`Pacote ${ROTULO_DO_NIVEL[n]}`} apoio={resumo.length ? textoDoTotal((resumo.find((p) => p.nivel === n) || resumo[0]).totais) : undefined}>
                <input value={pacotes.nomes[n]} onChange={(e) => setPacotes({ ...pacotes, nomes: { ...pacotes.nomes, [n]: e.target.value } })} maxLength={40} className={campo} />
              </CampoDeFormulario>
            ))}
            {NIVEIS_DO_PACOTE.map((n) => (
              <CampoDeFormulario key={`d-${n}`} rotulo={`Para quem é o ${pacotes.nomes[n] || ROTULO_DO_NIVEL[n]}`}>
                <input value={pacotes.descricoes[n]} onChange={(e) => setPacotes({ ...pacotes, descricoes: { ...pacotes.descricoes, [n]: e.target.value } })} maxLength={240} className={campo} />
              </CampoDeFormulario>
            ))}
          </GrupoDeCampos>
          <CampoDeFormulario rotulo="Pacote em destaque" className="mt-3 max-w-[240px]">
            <select value={pacotes.destaque} onChange={(e) => setPacotes({ ...pacotes, destaque: e.target.value as NivelDoPacote })} className={campo}>
              {NIVEIS_DO_PACOTE.map((n) => (
                <option key={n} value={n}>
                  {pacotes.nomes[n] || ROTULO_DO_NIVEL[n]}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          {avisos.length > 0 && (
            <ul className="mt-2 list-disc pl-5" aria-label="Avisos dos pacotes">
              {avisos.map((a) => (
                <li key={a} className={juntar(texto.auxiliar, "text-warning")}>
                  {a}
                </li>
              ))}
            </ul>
          )}
        </div>
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
      {totais.itens > 0 && !pacotes.ativo && (
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
  modeloId = "",
}: {
  proposta: Proposta | null;
  propostas: Proposta[];
  semTabela: boolean;
  leadUrl: string | null;
  onAbrir: (id: string) => void;
  /** Modelo de IA escolhido na mesa (resumo da reunião). */
  modeloId?: string;
}) {
  const [nova, setNova] = useState(false);
  const [biblioteca, setBiblioteca] = useState(false);
  const [aba, setAba] = useState<AbaDaBiblioteca>("servicos");
  const abrirBiblioteca = (a: AbaDaBiblioteca) => {
    setAba(a);
    setBiblioteca(true);
  };
  const perguntas = proposta ? proposta.contexto.perguntas || [] : [];
  if (semTabela) return <EstadoVazio titulo="O banco ainda não tem as propostas." descricao="Falta aplicar a migration das propostas." />;
  return (
    <div className="min-w-0 space-y-6" data-etapa-proposta="contexto">
      <Secao
        titulo="Propostas"
        descricao={propostas.length ? `${propostas.filter((p) => !p.arquivada_em).length} deste cliente` : undefined}
        acao={
          <>
            <button type="button" className={botao.discreto} onClick={() => abrirBiblioteca("servicos")} aria-label="Biblioteca comercial">
              <BookOpen className="h-4 w-4" />
              <span className="ml-1.5 hidden sm:inline">Biblioteca</span>
            </button>
            <button type="button" className={nova || !propostas.length ? botao.discreto : botao.secundario} onClick={() => setNova((v) => !v)} aria-expanded={nova}>
              <Plus className="h-4 w-4" />
              <span className="ml-1.5 hidden sm:inline">{nova ? "Fechar" : "Nova proposta"}</span>
            </button>
          </>
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
          <Reuniao key={`r-${proposta.id}`} proposta={proposta} modeloId={modeloId} />
          <Arquivos proposta={proposta} />
          <Investimento key={`i-${proposta.id}`} proposta={proposta} onBiblioteca={() => abrirBiblioteca("servicos")} />
          <CalculadoraDaProposta key={`h-${proposta.id}`} proposta={proposta} onParametros={() => abrirBiblioteca("hora")} />
          <PagamentoDaProposta key={`p-${proposta.id}`} proposta={proposta} />
          <AnexosDaProposta proposta={proposta} />
        </>
      )}
      {biblioteca && <BibliotecaDaAgencia aberta={biblioteca} onAberta={setBiblioteca} aba={aba} onAba={setAba} />}
    </div>
  );
}
