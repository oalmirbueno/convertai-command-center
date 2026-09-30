import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Calculator, ChevronDown, FilePlus2, Layers, Loader2, Paperclip, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { lerArquivosDoAgente, tamanhoLegivel } from "@/components/mesa/leituraDeArquivos";
import { useFinancePlans } from "@/hooks/useFinanceV2";
import { SERVICE_LABELS } from "@/lib/cycleDefs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import { RotuloLargo } from "@/components/sistema/BotaoComIcone";
import { useChaveDeRecolher, useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, campo, campoTexto, etiqueta, foco, juntar, lista, rolagem, texto } from "@/components/sistema/estilos";
import { gravarEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
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
  margemDosItens,
  NIVEIS_DO_PACOTE,
  normalizarPacotes,
  resumoDosPacotes,
  ROTULO_DA_UNIDADE,
  ROTULO_DO_NIVEL,
  type NivelDoPacote,
  type Pacotes,
  type ServicoDaBiblioteca,
} from "../../../supabase/functions/_shared/proposta-comercial";
import { aplicarNaLista, chamarProposta, useHoraTecnica, useLeadsDoComercial, useModelosDeProposta, useServicos, type Proposta } from "./propostaApi";
import { AvisoDeMudanca, BarraDoSalvar, ProvedorDoSalvar, useRascunhoComBase, useSecaoSuja, useSecoesSujas } from "./edicaoDaProposta";
import { rolarAte, useFocoDeChegada } from "./navegacaoDaProposta";
import BibliotecaDaAgencia, { type AbaDaBiblioteca } from "./BibliotecaDaAgencia";
import CalculadoraDaProposta from "./CalculadoraDaProposta";
import PagamentoDaProposta from "./PagamentoDaProposta";
import SeloDaProposta from "./SeloDaProposta";

/**
 * Etapa 1, Contexto: qual proposta (criar ou abrir), a reunião (notas,
 * transcrição e os arquivos lidos no navegador), o investimento pelos itens
 * (da biblioteca, do plano do Financeiro, do serviço ou livre), com a hora
 * técnica numa linha, a validade, o lead do Comercial e o pagamento. O preço
 * da proposta sai só daqui.
 *
 * Frente UXS (30/09): um Salvar só, na barra do pé ("Não salvo: Reunião,
 * Investimento"), que grava tudo num pedido e nunca apaga a seção que ainda
 * não foi salva; os anexos do cliente moram no Rascunho, perto da prévia; a
 * calculadora abre numa janela central; a lista de propostas nasce recolhida
 * (a proposta aberta fica no seletor da casca).
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

// O selo mora num arquivo próprio (o Envio usa sem baixar o Contexto); continua saindo daqui também.
export { SeloDaProposta };

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
                  <>
                    <span className={juntar(etiqueta, "ml-3 hidden shrink-0 bg-warning/15 text-warning md:inline")} title="Follow-up pronto no Envio" data-followup={f.situacao}>
                      {f.texto}
                    </span>
                    {/* No celular, só o ponto (o selo com texto não cabe). */}
                    <span className="ml-3 inline-block h-2 w-2 shrink-0 rounded-full bg-warning md:hidden" title="Follow-up pronto no Envio" data-ponto-do-followup="">
                      <span className="sr-only">Follow-up pronto no Envio</span>
                    </span>
                  </>
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

function NovaProposta({ leadInicial, focar, onCriada }: { leadInicial: string | null; focar: boolean; onCriada: (id: string) => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const modelos = useModelosDeProposta();
  const leads = useLeadsDoComercial();
  const [modelo, setModelo] = useState("");
  const [lead, setLead] = useState(leadInicial || "");
  const [titulo, setTitulo] = useState("");
  const [criando, setCriando] = useState(false);
  const projeto = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (leadInicial) setLead(leadInicial);
  }, [leadInicial]);
  // Foco no Projeto só com mouse (no celular o teclado cobriria o formulário).
  useEffect(() => {
    if (!focar || !projeto.current) return;
    try {
      if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches) projeto.current.focus();
    } catch {
      /* sem matchMedia: sem foco */
    }
  }, [focar]);
  // Os leads ganhos por este cliente vêm primeiro (nada é escolhido sozinho).
  const todos = leads.data || [];
  const ganhos = todos.filter((l) => l.won_client_id === mesa.clientId);
  const ordenados = ganhos.concat(todos.filter((l) => l.won_client_id !== mesa.clientId));
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
    <div className="mb-4 space-y-3" data-nova-proposta="">
      <GrupoDeCampos colunas={3}>
        <CampoDeFormulario rotulo="Projeto">
          <input ref={projeto} value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} placeholder="Ex.: Identidade visual e redes" className={campo} />
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
            {ordenados.map((l) => (
              <option key={l.id} value={l.id}>
                {l.empresa ? `${l.empresa} (${l.nome})` : l.nome}
                {l.won_client_id === mesa.clientId ? " (ganho deste cliente)" : ""}
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

/** Reunião: notas, transcrição e os arquivos do cliente (lidos no navegador). */
function Reuniao({ proposta, modeloId }: { proposta: Proposta; modeloId: string }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const entrada = useRef<HTMLInputElement | null>(null);
  const [anexando, setAnexando] = useState(false);
  const [resumo, setResumo] = useState<string | null>(null);
  const ehTexto = (v: unknown) => typeof v === "string";
  const notas = useRascunhoComBase<string>({ chave: `mesa-proposta:notas:${proposta.id}`, chaveAntiga: `mesa-proposta:notas:${proposta.id}:${proposta.versao}`, doBanco: proposta.contexto.notas || "", versao: proposta.versao, valido: ehTexto });
  const transcricao = useRascunhoComBase<string>({ chave: `mesa-proposta:transcricao:${proposta.id}`, chaveAntiga: `mesa-proposta:transcricao:${proposta.id}:${proposta.versao}`, doBanco: proposta.contexto.transcricao || "", versao: proposta.versao, valido: ehTexto });
  const mudou = notas.sujo || transcricao.sujo;
  const materiais = proposta.contexto.materiais || [];
  const temMaterial = !!(transcricao.valor.trim() || notas.valor.trim() || materiais.length);
  const campos = () => ({ ...(notas.sujo ? { notas: notas.valor } : {}), ...(transcricao.sujo ? { transcricao: transcricao.valor } : {}) });
  const esquecer = () => {
    notas.esquecer();
    transcricao.esquecer();
  };
  useSecaoSuja("reuniao", mudou, {
    rotulo: "Reunião",
    chaves: Object.keys(campos()),
    campos,
    depois: esquecer,
    descartar: esquecer,
    manter: () => {
      notas.manter();
      transcricao.manter();
    },
  });

  const anexar = async (arquivos: FileList | null) => {
    const todos = arquivos ? (Array.prototype.slice.call(arquivos) as File[]) : [];
    if (!todos.length) return;
    setAnexando(true);
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
      setAnexando(false);
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

  const estado = [materiais.length ? `${materiais.length} arquivo(s)` : "", mudou ? "não salvo" : proposta.contexto.transcricao ? "transcrição guardada" : ""].filter(Boolean).join(" · ");
  const emConflito = notas.conflito || transcricao.conflito;
  return (
    <Secao
      titulo="Reunião"
      id="proposta-reuniao"
      divisoria
      descricao={estado || undefined}
      ajuda="Cole as notas e a transcrição da reunião de pré-briefing. O estrategista usa as palavras do cliente no desafio e só aceita número que esteja aqui, nos arquivos ou no painel. Anexar lê PDF, Word, planilha, apresentação ou texto aqui no navegador e o texto vira material da proposta (também dá para mandar pela conversa do estrategista). Salvar e resumir grava as notas antes de resumir."
      acao={
        <>
          <input ref={entrada} type="file" multiple className="hidden" onChange={(e) => void anexar(e.target.files)} accept=".txt,.md,.csv,.tsv,.json,.srt,.vtt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rtf,.html" />
          {/* Anexar grava uma versão: com nota não salva, salve antes (nada se perde). */}
          <button type="button" className={botao.secundario} onClick={() => entrada.current && entrada.current.click()} disabled={anexando || mudou} aria-label="Anexar arquivos" title={mudou ? "Salve antes de anexar" : "Anexar arquivos"}>
            {anexando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            <RotuloLargo>Anexar</RotuloLargo>
          </button>
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-4 w-4" />
                {mudou ? "Salvar e resumir" : "Resumir"}
              </>
            }
            titulo="Resumir a reunião"
            descricao={mudou ? "Grava as notas e resume: objetivo, dores, pedidos, prazos e o que falta, sem número inventado" : "Objetivo, dores, pedidos, prazos, falas do cliente e o que falta, sem número inventado"}
            variant="outline"
            disabled={!temMaterial || !modeloId}
            partes={() => [{ modeloId, tipo: "texto", tokensEntrada: 14000, tokensSaida: 1500 }]}
            executar={async () => {
              // Salvar e resumir: grava só a reunião (depois do clique do custo; sem clique, nada é gravado).
              if (mudou) {
                const d = await chamarProposta<any>("salvar", { proposta_id: proposta.id, versao_base: proposta.versao, ...campos() });
                aplicarNaLista(qc, mesa.clientId, d && d.proposta);
                esquecer();
              }
              return chamarProposta("resumir_reuniao", { proposta_id: proposta.id, modelo_id: modeloId || undefined });
            }}
            aoConcluir={(d: any) => setResumo(d && typeof d.notas === "string" ? d.notas : null)}
          />
        </>
      }
    >
      {emConflito && (
        <AvisoDeMudanca
          className="mb-2"
          onManter={() => {
            if (notas.conflito) notas.manter();
            if (transcricao.conflito) transcricao.manter();
          }}
          onVerANova={() => {
            if (notas.conflito) notas.esquecer();
            if (transcricao.conflito) transcricao.esquecer();
          }}
        />
      )}
      {resumo && (
        <div className="mb-4 min-w-0 border-l-2 border-primary pl-3" aria-label="Resumo da reunião">
          <p className={texto.rotulo}>Resumo da reunião</p>
          <pre className={juntar(texto.corpo, "mt-1 whitespace-pre-wrap font-sans [overflow-wrap:anywhere]")}>{resumo}</pre>
          <div className="mt-2 flex flex-wrap [&>*]:mb-2 [&>*]:mr-2">
            <button type="button" className={botao.secundario} onClick={() => { notas.mudar(`${notas.valor.trim() ? `${notas.valor.trim()}\n\n` : ""}Resumo da reunião:\n${resumo}`); setResumo(null); }}>
              Pôr embaixo das notas
            </button>
            <button type="button" className={botao.discreto} onClick={() => { notas.mudar(`Resumo da reunião:\n${resumo}`); setResumo(null); }}>
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
          <textarea value={notas.valor} onChange={(e) => notas.mudar(e.target.value)} className={juntar(campoTexto, "min-h-[140px]")} maxLength={20000} placeholder="O que o cliente quer, dores, prazos, orçamento que ele citou" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Transcrição da reunião">
          <textarea value={transcricao.valor} onChange={(e) => transcricao.mudar(e.target.value)} className={juntar(campoTexto, "min-h-[140px]")} maxLength={60000} placeholder="Cole aqui a transcrição" />
        </CampoDeFormulario>
      </div>
      {materiais.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria, "mt-3")} aria-label="Arquivos da reunião">
          {materiais.map((m) => (
            <li key={m.nome} className={lista.linha}>
              <Paperclip className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{m.nome}</span>
              <span className={juntar(texto.auxiliar, "ml-3 shrink-0")}>{tamanhoLegivel(m.texto.length)}</span>
              <button type="button" className={juntar(botao.icone, "ml-2")} aria-label={`Tirar ${m.nome}`} onClick={() => void remover(m.nome)} disabled={mudou} title={mudou ? "Salve antes de tirar" : undefined}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

/** "Adicionar ▾": biblioteca (com preço), plano do Financeiro, serviço sem preço, item livre e gerenciar. */
function AdicionarItem({
  servicos,
  planos,
  onServico,
  onPlano,
  onSemPreco,
  onLivre,
  onBiblioteca,
}: {
  servicos: ServicoDaBiblioteca[];
  planos: Array<{ id: string; nome: string; valor: number; mensal: boolean }>;
  onServico: (s: ServicoDaBiblioteca) => void;
  onPlano: (id: string) => string | null;
  onSemPreco: (chave: string) => string | null;
  onLivre: () => string | null;
  onBiblioteca: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  // Item novo sem preço ou sem nome: o foco vai para o campo vazio (depois de o menu fechar).
  const focarDepois = useRef<string | null>(null);
  const escolher = (fazer: () => string | null | void) => {
    const alvo = fazer();
    focarDepois.current = typeof alvo === "string" ? alvo : null;
    setAberto(false);
  };
  const item = "flex min-w-0 cursor-pointer items-center text-[13px]";
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" className={botao.secundario} aria-label="Adicionar item" aria-expanded={aberto} data-adicionar-item="">
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
          <RotuloLargo>Adicionar</RotuloLargo>
          <ChevronDown className="ml-1 hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:inline" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[calc(100vw-24px)] max-w-[360px] p-0"
        onCloseAutoFocus={(e) => {
          const alvo = focarDepois.current;
          focarDepois.current = null;
          if (!alvo) return;
          e.preventDefault();
          const el = document.querySelector(alvo) as HTMLElement | null;
          if (el) el.focus();
        }}
      >
        <Command>
          <CommandInput placeholder="Buscar serviço, plano ou item" className="h-10 text-[13px]" />
          <CommandList className={rolagem.janela}>
            <CommandEmpty className="px-3 py-4 text-center text-[12px] text-muted-foreground">Nada com esse nome.</CommandEmpty>
            {servicos.length > 0 && (
              <CommandGroup heading="Da biblioteca">
                {servicos.map((s) => (
                  <CommandItem key={s.id} value={`${s.nome} biblioteca ${s.id}`} className={item} onSelect={() => escolher(() => onServico(s))}>
                    <span className="min-w-0 flex-1 truncate">{s.nome}</span>
                    <span className="ml-2 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      {reais(s.preco)} {ROTULO_DA_UNIDADE[s.unidade]}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {planos.length > 0 && (
              <CommandGroup heading="Plano do Financeiro">
                {planos.map((p) => (
                  <CommandItem key={p.id} value={`${p.nome} plano ${p.id}`} className={item} onSelect={() => escolher(() => onPlano(p.id))}>
                    <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                    <span className="ml-2 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      {reais(p.valor)}
                      {p.mensal ? " por mês" : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Serviço sem preço">
              {Object.keys(SERVICE_LABELS).map((k) => (
                <CommandItem key={k} value={`${SERVICE_LABELS[k]} servico ${k}`} className={item} onSelect={() => escolher(() => onSemPreco(k))}>
                  {SERVICE_LABELS[k]}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Item livre">
              <CommandItem value="item livre" className={item} onSelect={() => escolher(onLivre)}>
                Item livre
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="gerenciar a biblioteca" className={item} onSelect={() => escolher(onBiblioteca)}>
                <BookOpen className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                Gerenciar a biblioteca
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Colunas do item a partir de 640 px (classes inteiras para o Tailwind gerar). */
const COLUNAS_DO_ITEM: Record<string, string> = {
  "": "sm:grid-cols-[minmax(0,1fr)_56px_110px_96px_32px]",
  h: "sm:grid-cols-[minmax(0,1fr)_56px_64px_110px_96px_32px]",
  p: "sm:grid-cols-[minmax(0,1fr)_56px_110px_96px_120px_32px]",
  hp: "sm:grid-cols-[minmax(0,1fr)_56px_64px_110px_96px_120px_32px]",
};

type Foto = { versao: number; itens: ItemDaProposta[]; validade: string; lead: string; pacotes: Pacotes };
const fotoDe = (p: Proposta): Foto => ({ versao: p.versao, itens: p.itens, validade: p.validade_ate || "", lead: p.lead_id || "", pacotes: p.pacotes });

function Investimento({ proposta, onBiblioteca, onParametros }: { proposta: Proposta; onBiblioteca: () => void; onParametros: () => void }) {
  const mesa = useMesa();
  const planos = useFinancePlans();
  const leads = useLeadsDoComercial();
  const servicos = useServicos();
  // Base da edição: a foto de quando a seção carregou ou foi salva por último.
  const [base, setBase] = useState<Foto>(() => fotoDe(proposta));
  const [itens, setItens] = useState<ItemNaTela[]>(() => proposta.itens.map(paraTela));
  const [validade, setValidade] = useState(proposta.validade_ate || "");
  const [lead, setLead] = useState(proposta.lead_id || "");
  const [pacotes, setPacotes] = useState<Pacotes>(proposta.pacotes);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [calculadora, setCalculadora] = useState(false);
  const [horasLigadas, setHorasLigadas] = useEstadoDaTela<boolean | null>(`mesa-proposta:horas:${proposta.id}`, null, { validar: (v) => v === null || typeof v === "boolean" });

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
  const invalidos = lidos.filter((i) => !i.nome || i.valor_unitario === null);
  const validos = normalizarItens(lidos.filter((i) => i.nome && i.valor_unitario !== null));
  const totais = totaisDosItens(validos);
  const pacotesNaTela = normalizarPacotes({ ...pacotes, niveis: pacotes.niveis }, validos);
  // Suja = difere da base (não da proposta de agora). Item sem nome ou sem valor também conta.
  const mudouItens = invalidos.length > 0 || JSON.stringify(validos) !== JSON.stringify(base.itens);
  const mudouValidade = validade !== base.validade;
  const mudouLead = lead !== base.lead;
  const mudouPacotes = JSON.stringify(pacotesNaTela) !== JSON.stringify(normalizarPacotes(base.pacotes, validos));
  const mudou = mudouItens || mudouValidade || mudouLead || mudouPacotes;
  const resumo = resumoDosPacotes(validos, pacotesNaTela);
  const avisos = avisosDosPacotes(validos, pacotesNaTela);

  const recarregar = (p: Proposta) => {
    setBase(fotoDe(p));
    setItens(p.itens.map(paraTela));
    setValidade(p.validade_ate || "");
    setLead(p.lead_id || "");
    setPacotes(p.pacotes);
    setTentouSalvar(false);
  };
  // Versão nova (agente, anexo, outra pessoa): a seção limpa segue o banco; a suja fica como está.
  useEffect(() => {
    if (!mudou && base.versao !== proposta.versao) recarregar(proposta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposta.id, proposta.versao, mudou]);

  // Só os campos que mudaram: trocar só o lead não manda itens nem validade (e não tira o link).
  const campos = () => {
    const c: Record<string, unknown> = {};
    if (mudouItens) c.itens = validos;
    if (mudouValidade && validade) c.validade_ate = validade;
    if (mudouLead) c.lead_id = lead || null;
    if (mudouPacotes) c.pacotes = pacotesNaTela;
    return c;
  };
  const validar = () => {
    if (!mudouItens || !invalidos.length) return true;
    setTentouSalvar(true);
    setAbertos((a) => {
      const proximo = { ...a };
      for (const i of invalidos) proximo[i.id] = true;
      return proximo;
    });
    const primeiro = invalidos[0];
    const posicao = lidos.indexOf(primeiro) + 1;
    toast.error(!primeiro.nome ? `O item ${posicao} está sem nome.` : `Falta o valor em ${primeiro.nome}.`);
    window.setTimeout(() => {
      const el = document.querySelector(`[data-item="${primeiro.id}"] [aria-invalid="true"]`) as HTMLElement | null;
      if (el) el.focus();
    }, 0);
    return false;
  };
  useSecaoSuja("investimento", mudou, {
    rotulo: "Investimento",
    chaves: Object.keys(campos()),
    campos,
    validar,
    depois: recarregar,
    descartar: () => recarregar(proposta),
  });

  const novoId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  /** Adiciona e devolve o seletor do primeiro campo vazio (para o foco). */
  const adicionar = (i: Partial<ItemNaTela>): string => {
    const id = i.id || novoId();
    setItens((l) => l.concat([{ nome: "", quantidade: "1", valor: "", recorrencia: "unico", origem: "manual", plano_id: null, servico: null, descricao: "", horas: "", biblioteca_id: null, ...i, id }]));
    setAbertos((a) => ({ ...a, [id]: true }));
    return `[data-item="${id}"] [data-campo="${i.nome ? "valor" : "nome"}"]`;
  };
  const mudarItem = (id: string, campoMudado: Partial<ItemNaTela>) => setItens((l) => l.map((x) => (x.id === id ? { ...x, ...campoMudado } : x)));
  const nivelDe = (id: string): NivelDoPacote => pacotes.niveis[id] || "essencial";

  const vivos = (servicos.data ? servicos.data.lista : []).filter((s) => !s.arquivado);
  const planosAtivos = (planos.data || []).filter((p) => p.isActive && p.currentVersion);
  const opcoesDePlano = planosAtivos.map((p) => ({ id: p.id, nome: p.name, valor: p.currentVersion!.finalAmount, mensal: p.currentVersion!.billingPeriod === "monthly" }));

  // Horas por item: a coluna aparece com a caixa marcada, ou quando um item salvo (ou da biblioteca) tem horas;
  // depois que apareceu, só some quando a pessoa desmarca.
  const horasAutomaticas = proposta.itens.some((i) => !!i.horas) || vivos.some((s) => !!s.horas) || itens.some((i) => !!i.horas);
  const horasPedidas = horasLigadas === null ? horasAutomaticas : horasLigadas;
  const horasJaApareceram = useRef(false);
  if (horasPedidas) horasJaApareceram.current = true;
  const comColunaDeHoras = horasPedidas || (horasJaApareceram.current && horasLigadas !== false);
  const colunas = COLUNAS_DO_ITEM[`${comColunaDeHoras ? "h" : ""}${pacotes.ativo ? "p" : ""}`];

  // Hora técnica numa linha (a margem dos itens salvos, como o servidor conta); a calculadora abre no centro.
  const comHoras = proposta.itens.some((i) => !!i.horas);
  const hora = useHoraTecnica(comHoras || calculadora);
  const margem = hora.data ? margemDosItens(proposta.itens, hora.data.parametros) : null;
  const linhaDaHora = mudou
    ? "Salve os itens antes de ajustar a margem"
    : !comHoras
      ? "Itens sem horas"
      : hora.data
        ? `Hora técnica: ${margem && margem.margem_pct !== null ? `margem ${margem.margem_pct}% · ` : ""}preço da hora ${reais(hora.data.preco_hora)}`
        : "Hora técnica";

  return (
    <Secao
      titulo="Investimento"
      id="proposta-investimento"
      divisoria
      descricao={`${pacotes.ativo && resumo.length ? resumo.map((p) => `${p.nome} ${textoDoTotal(p.totais)}`).join(" · ") : textoDoTotal(totais)}${mudou ? " · não salvo" : ""}`}
      ajuda="O preço da proposta sai só destes itens: da biblioteca da agência, do plano do Financeiro, de um serviço ou livre. Horas por item mostram a margem real na linha da hora técnica, e a Calculadora ajusta os preços para a margem que você quer (com prévia e Desfazer). Com os 3 pacotes ligados, cada item entra a partir de um nível: o Essencial tem o básico, o Recomendado soma o dele e o Completo tem tudo."
      acao={
        <AdicionarItem
          servicos={vivos}
          planos={opcoesDePlano}
          onServico={(s) => {
            adicionar(paraTela(itemDoServico(s, 1, novoId())));
          }}
          onPlano={(id) => {
            const p = planosAtivos.find((x) => x.id === id);
            if (!p) return null;
            const v = p.currentVersion!;
            adicionar({ nome: p.name, valor: String(v.finalAmount).replace(".", ","), recorrencia: v.billingPeriod === "monthly" ? "mensal" : "unico", origem: "plano", plano_id: p.id });
            if (v.setupFee > 0) adicionar({ nome: `Implantação ${p.name}`, valor: String(v.setupFee).replace(".", ","), recorrencia: "unico", origem: "plano", plano_id: p.id });
            return null;
          }}
          onSemPreco={(k) => adicionar({ nome: SERVICE_LABELS[k], origem: "servico", servico: k })}
          onLivre={() => adicionar({})}
          onBiblioteca={onBiblioteca}
        />
      }
    >
      <div className="mb-3 flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-4">
        <label className={juntar(texto.corpo, "inline-flex items-center")}>
          <input type="checkbox" className="mr-2" checked={pacotes.ativo} onChange={(e) => setPacotes({ ...pacotes, ativo: e.target.checked })} />
          <Layers className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Proposta com 3 pacotes
        </label>
        <label className={juntar(texto.corpo, "inline-flex items-center")}>
          <input type="checkbox" className="mr-2" checked={comColunaDeHoras} onChange={(e) => setHorasLigadas(e.target.checked)} />
          Horas por item
        </label>
      </div>
      {itens.length ? (
        <ul className="min-w-0 space-y-3" aria-label="Itens do investimento">
          {itens.map((i, n) => {
            const valor = lerValor(i.valor);
            const nomeRuim = tentouSalvar && !i.nome.trim();
            const valorRuim = valor === null && (tentouSalvar || !!i.valor);
            const aberto = !!abertos[i.id];
            // No celular, a linha resumo abre os campos (cada campo existe uma vez só no DOM).
            let lado = 0;
            const proximoLado = () => (lado++ % 2 === 0 ? "col-start-1" : "col-start-2");
            const resumoDoItem = [i.nome.trim() || `Item ${n + 1}`, valor !== null ? reais(valor) : "sem valor", i.recorrencia === "mensal" ? "Mensal" : "Única", pacotes.ativo ? pacotes.nomes[nivelDe(i.id)] || ROTULO_DO_NIVEL[nivelDe(i.id)] : ""].filter(Boolean).join(" · ");
            return (
              <li
                key={i.id}
                className="min-w-0"
                data-item={i.id}
                onFocusCapture={() => {
                  if (!aberto) setAbertos((a) => ({ ...a, [i.id]: true }));
                }}
              >
                <button
                  type="button"
                  className={juntar("flex w-full min-w-0 items-center rounded-md px-1 text-left hover:bg-muted sm:hidden", (nomeRuim || valorRuim) && "text-destructive", foco)}
                  style={{ minHeight: 44 }}
                  aria-expanded={aberto}
                  onClick={() => setAbertos((a) => ({ ...a, [i.id]: !aberto }))}
                  data-resumo-do-item=""
                >
                  <ChevronDown className={juntar("mr-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberto ? "" : "-rotate-90")} aria-hidden="true" />
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate tabular-nums")}>{resumoDoItem}</span>
                </button>
                <div className={juntar("grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] items-end gap-2", colunas, aberto ? "mt-1 sm:mt-0" : "hidden sm:grid")}>
                  <label className="col-span-2 min-w-0 sm:col-span-1">
                    <span className={texto.rotulo}>Item</span>
                    <input value={i.nome} onChange={(e) => mudarItem(i.id, { nome: e.target.value })} maxLength={120} className={juntar(campo, nomeRuim && "border-destructive")} aria-invalid={nomeRuim ? true : undefined} data-campo="nome" />
                  </label>
                  <label className={juntar("min-w-0 sm:col-start-auto", proximoLado())}>
                    <span className={texto.rotulo}>Qtd.</span>
                    <input value={i.quantidade} onChange={(e) => mudarItem(i.id, { quantidade: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" className={campo} />
                  </label>
                  {comColunaDeHoras && (
                    <label className={juntar("min-w-0 sm:col-start-auto", proximoLado())}>
                      <span className={texto.rotulo}>Horas</span>
                      <input value={i.horas} onChange={(e) => mudarItem(i.id, { horas: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" className={campo} aria-label={`Horas por unidade de ${i.nome || "item"}`} />
                    </label>
                  )}
                  <label className={juntar("min-w-0 sm:col-start-auto", proximoLado())}>
                    <span className={texto.rotulo}>Valor (R$)</span>
                    <input value={i.valor} onChange={(e) => mudarItem(i.id, { valor: e.target.value })} inputMode="decimal" aria-invalid={valorRuim ? true : undefined} className={juntar(campo, valorRuim && "border-destructive")} data-campo="valor" />
                  </label>
                  <label className={juntar("min-w-0 sm:col-start-auto", proximoLado())}>
                    <span className={texto.rotulo}>Cobrança</span>
                    <select value={i.recorrencia} onChange={(e) => mudarItem(i.id, { recorrencia: e.target.value === "mensal" ? "mensal" : "unico" })} className={campo}>
                      <option value="unico">Única</option>
                      <option value="mensal">Mensal</option>
                    </select>
                  </label>
                  {pacotes.ativo && (
                    <label className={juntar("min-w-0 sm:col-start-auto", proximoLado())}>
                      <span className={texto.rotulo}>Entra a partir</span>
                      <select value={nivelDe(i.id)} onChange={(e) => setPacotes({ ...pacotes, niveis: { ...pacotes.niveis, [i.id]: e.target.value as NivelDoPacote } })} className={campo} aria-label={`Pacote de ${i.nome || "item"}`}>
                        {NIVEIS_DO_PACOTE.map((nivel) => (
                          <option key={nivel} value={nivel}>
                            {pacotes.nomes[nivel] || ROTULO_DO_NIVEL[nivel]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {/* No celular, a lixeira fica na linha do nome; de 640 px para cima, na ponta da linha. */}
                  <button type="button" className={juntar(botao.icone, "col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto")} aria-label={`Tirar ${i.nome || "item"}`} onClick={() => setItens((l) => l.filter((x) => x.id !== i.id))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
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
                  {l.won_client_id === mesa.clientId ? " (ganho deste cliente)" : ""}
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
      <div className="mt-3 flex min-w-0 flex-wrap items-center" data-hora-tecnica="">
        <Calculator className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={juntar(texto.auxiliar, "mr-2 min-w-0 tabular-nums")}>{linhaDaHora}</span>
        <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => setCalculadora(true)} disabled={mudou} title={mudou ? "Salve os itens antes de ajustar a margem" : "Custo e preço da hora e a margem dos itens"}>
          Calculadora
        </button>
      </div>
      {calculadora && (
        <CalculadoraDaProposta
          proposta={proposta}
          aberta={calculadora}
          onAberta={setCalculadora}
          onParametros={() => {
            // Sem janela sobre janela: a calculadora fecha antes da biblioteca abrir.
            setCalculadora(false);
            onParametros();
          }}
        />
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
  nova = false,
  onNova,
  onResponder,
}: {
  proposta: Proposta | null;
  propostas: Proposta[];
  semTabela: boolean;
  leadUrl: string | null;
  onAbrir: (id: string) => void;
  /** Modelo de IA escolhido na mesa (resumo da reunião). */
  modeloId?: string;
  /** Formulário de nova proposta aberto (a mesa guarda: sobrevive à troca de proposta e de etapa). */
  nova?: boolean;
  onNova?: (aberta: boolean) => void;
  /** "Responder" de uma pergunta do estrategista: vai para o rascunho da conversa (nunca envia sozinho). */
  onResponder?: (pergunta: string) => void;
}) {
  const mesa = useMesa();
  const [biblioteca, setBiblioteca] = useState(false);
  const [aba, setAba] = useState<AbaDaBiblioteca>("servicos");
  const abrirBiblioteca = (a: AbaDaBiblioteca) => {
    setAba(a);
    setBiblioteca(true);
  };
  const { sujas, informar } = useSecoesSujas(["reuniao", "investimento", "pagamento"]);

  // Chegou pelo "Resolver" (Revisão ou Envio): abre a seção antes de montar e rola até ela.
  const focoDeChegada = useFocoDeChegada();
  const chaveDaReuniao = useChaveDeRecolher("Reunião", undefined);
  const chaveDoInvestimento = useChaveDeRecolher("Investimento", undefined);
  useState(() => {
    if (focoDeChegada === "reuniao" && chaveDaReuniao) gravarEstadoDaTela(chaveDaReuniao, false);
    if (focoDeChegada === "investimento" && chaveDoInvestimento) gravarEstadoDaTela(chaveDoInvestimento, false);
    return null;
  });
  useEffect(() => {
    if (focoDeChegada === "reuniao" || focoDeChegada === "investimento") rolarAte(`#proposta-${focoDeChegada}`);
    if (focoDeChegada === "provas") abrirBiblioteca("provas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vivas = propostas.filter((p) => !p.arquivada_em).length;
  // A lista nasce recolhida quando já há proposta (a aberta fica no seletor da casca); a escolha fica guardada.
  const [listaRecolhida, setListaRecolhida] = useRecolhido(`mesa-proposta:lista:${mesa.clientId}`, vivas > 0 && !(leadUrl && !proposta));
  const formularioForcado = !propostas.length || (!!leadUrl && !proposta);
  const mostrarFormulario = nova || formularioForcado;
  const perguntas = proposta ? proposta.contexto.perguntas || [] : [];
  const verLista = !listaRecolhida || !proposta;

  if (semTabela) return <EstadoVazio titulo="A Mesa Proposta ainda não foi ligada neste painel." descricao="Avise o administrador." />;
  return (
    <ProvedorDoSalvar value={informar}>
      <div className="min-w-0 space-y-6" data-etapa-proposta="contexto">
        <Secao
          titulo="Propostas"
          recolher={false}
          acao={
            <>
              <button type="button" className={botao.discreto} onClick={() => abrirBiblioteca("servicos")} aria-label="Biblioteca comercial">
                <BookOpen className="h-4 w-4" />
                <RotuloLargo>Biblioteca</RotuloLargo>
              </button>
              {!formularioForcado && (
                <button type="button" className={nova ? botao.discreto : botao.secundario} onClick={() => onNova && onNova(!nova)} aria-expanded={nova}>
                  <Plus className="h-4 w-4" />
                  <RotuloLargo>{nova ? "Fechar" : "Nova proposta"}</RotuloLargo>
                </button>
              )}
            </>
          }
        >
          {/* O formulário fica fora do que recolhe: recolher só esconde a lista. */}
          {mostrarFormulario && (
            <NovaProposta
              leadInicial={leadUrl}
              focar={nova}
              onCriada={(id) => {
                if (onNova) onNova(false);
                onAbrir(id);
              }}
            />
          )}
          {propostas.length > 0 && (
            <>
              {proposta && (
                <button
                  type="button"
                  onClick={() => setListaRecolhida(!listaRecolhida)}
                  aria-expanded={!listaRecolhida}
                  className={juntar("relative -left-1 flex min-w-0 max-w-full items-center rounded-md px-1 py-0.5 text-left hover:bg-muted", foco)}
                  data-recolher-lista-de-propostas=""
                >
                  <ChevronDown className={juntar("mr-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", listaRecolhida ? "-rotate-90" : "")} aria-hidden="true" />
                  <span className={juntar(texto.auxiliar, "min-w-0 truncate tabular-nums")}>
                    {listaRecolhida ? `Nº ${proposta.numero} · ${ROTULO_DO_STATUS[proposta.status_efetivo] || proposta.status_efetivo} · ${vivas} no total` : `${vivas} no total`}
                  </span>
                </button>
              )}
              {verLista && (
                <div className={proposta ? "mt-1" : ""}>
                  <ListaDePropostas propostas={propostas} abertaId={proposta ? proposta.id : null} onAbrir={onAbrir} />
                </div>
              )}
            </>
          )}
        </Secao>
        {proposta && (
          <>
            {perguntas.length > 0 && (
              <Secao titulo="O estrategista precisa saber" divisoria descricao={`${perguntas.length} pergunta(s)`}>
                <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Perguntas do estrategista">
                  {perguntas.map((p) => (
                    <li key={p} className={lista.linha}>
                      <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{p}</span>
                      {onResponder && (
                        <button type="button" className={juntar(botao.discreto, "ml-2 h-8 px-2 text-[12px]")} onClick={() => onResponder(p)} aria-label={`Responder: ${p}`}>
                          Responder
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </Secao>
            )}
            <Reuniao key={`r-${proposta.id}`} proposta={proposta} modeloId={modeloId} />
            <Investimento key={`i-${proposta.id}`} proposta={proposta} onBiblioteca={() => abrirBiblioteca("servicos")} onParametros={() => abrirBiblioteca("hora")} />
            <PagamentoDaProposta key={`p-${proposta.id}`} proposta={proposta} />
            <BarraDoSalvar proposta={proposta} sujas={sujas} />
          </>
        )}
        {biblioteca && <BibliotecaDaAgencia aberta={biblioteca} onAberta={setBiblioteca} aba={aba} onAba={setAba} />}
      </div>
    </ProvedorDoSalvar>
  );
}
