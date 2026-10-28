import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy, Download, FlaskConical, Image, Loader2, Megaphone, Palette, Plus, RotateCcw, Sparkles, Target, Type, Video, X } from "lucide-react";
import FormularioDaOferta from "./FormularioDaOferta";
import VisualizadorDaArte from "./VisualizadorDaArte";
import { AjustarArte, ReferenciasDaCampanha } from "./RecursosCriativos";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { AjudaRecolhida } from "@/components/sistema";
import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";
import {
  cancelarPedido,
  erroDoBolso,
  escolherArte,
  escolherVersao,
  lerCampanha,
  lerEstado,
  lerMarca,
  listarCampanhas,
  pedir,
  pedirCriativo,
  processar,
  salvarMarca,
  salvarVersao,
  urlDaArte,
} from "@/lib/bolso/api";
import {
  dataCurta,
  EXPLICA_JOB,
  FORMATOS,
  MARCA_VAZIA,
  marcaValida,
  motivoParaNaoPedir,
  nomeDoArquivo,
  novaChave,
  ROTULO_DO_JOB,
  situacaoDoEstudio,
  TIPOS,
  type Arte,
  type Campanha,
  type ConteudoDaCampanha,
  type EstadoDoEstudio,
  type Formato,
  type Marca,
} from "@/lib/bolso/modelo";

/**
 * Estúdio do Aceleriq de Bolso (26/10/2026). Contexto da marca → oferta → campanha → texto → arte → revisão
 * → download, com histórico. O banco decide acesso, custo e saldo; a tela explica e pede confirmação do
 * consumo antes de cada pedido. Edição manual e download não usam crédito.
 */

export function FaixaDeDemonstracao() {
  return (
    <p role="status" className="bolso-demonstracao" data-bolso-demonstracao="">
      <FlaskConical size={16} aria-hidden="true" />
      <strong>DEMONSTRAÇÃO / PROVEDOR SIMULADO</strong>
      <span>Nada aqui é gerado por IA e os créditos são de teste.</span>
    </p>
  );
}

export function useEstadoDoBolso(ativo = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["bolso", "estado", user?.id], queryFn: lerEstado, enabled: ativo && !!user, retry: false, staleTime: 30_000 });
}

function Campo({ id, rotulo, ajuda, children }: { id: string; rotulo: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {rotulo}
      </label>
      {children}
      {ajuda && (
        <p id={`${id}-ajuda`} className="text-[12px] text-muted-foreground">
          {ajuda}
        </p>
      )}
    </div>
  );
}

function Erro({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {texto}
    </p>
  );
}

// ─── Marca ─────────────────────────────────────────────────────────────
export function FormularioDaMarca({ inicial, aoSalvar, aoCancelar }: { inicial: Marca | null; aoSalvar: (m: Marca) => void; aoCancelar?: () => void }) {
  const [m, setM] = useState<Marca>(inicial || MARCA_VAZIA);
  const [cor, setCor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const mudar = (campo: keyof Marca, valor: unknown) => setM((a) => ({ ...a, [campo]: valor }));
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalido = marcaValida(m);
    if (invalido) return setErro(invalido);
    setSalvando(true);
    setErro(null);
    try {
      aoSalvar(await salvarMarca(m));
    } catch (er) {
      setErro(erroDoBolso(er));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <form className="bolso-cartao bolso-formulario space-y-5" onSubmit={(e) => void enviar(e)} aria-labelledby="bolso-marca-titulo" noValidate>
      <div className="bolso-titulo-de-bloco">
        <Palette size={19} aria-hidden="true" />
        <h2 id="bolso-marca-titulo">Sua marca</h2>
        <AjudaRecolhida rotulo="Sobre sua marca">
          Estes dados orientam suas campanhas. Você pode atualizar sua marca quando quiser.
        </AjudaRecolhida>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="bolso-marca-nome" rotulo="Nome da marca">
          <input id="bolso-marca-nome" className="membros-campo" value={m.nome} onChange={(e) => mudar("nome", e.target.value)} maxLength={120} required aria-invalid={!m.nome.trim() && !!erro} />
        </Campo>
        <Campo id="bolso-marca-regiao" rotulo="Cidade ou região" ajuda="Opcional.">
          <input id="bolso-marca-regiao" className="membros-campo" value={m.regiao} onChange={(e) => mudar("regiao", e.target.value)} maxLength={200} aria-describedby="bolso-marca-regiao-ajuda" />
        </Campo>
      </div>
      <Campo id="bolso-marca-descricao" rotulo="O que a marca faz">
        <textarea id="bolso-marca-descricao" className="membros-campo" rows={3} value={m.descricao} onChange={(e) => mudar("descricao", e.target.value)} maxLength={1500} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="bolso-marca-publico" rotulo="Para quem vende">
          <input id="bolso-marca-publico" className="membros-campo" value={m.publico} onChange={(e) => mudar("publico", e.target.value)} maxLength={600} />
        </Campo>
        <Campo id="bolso-marca-tom" rotulo="Jeito de falar" ajuda="Ex.: acolhedor, direto, divertido.">
          <input id="bolso-marca-tom" className="membros-campo" value={m.tom} onChange={(e) => mudar("tom", e.target.value)} maxLength={300} aria-describedby="bolso-marca-tom-ajuda" />
        </Campo>
      </div>
      <Campo id="bolso-marca-cor" rotulo="Cores da marca" ajuda="Até 6 cores, no formato #RRGGBB.">
        <div className="flex flex-wrap items-center gap-2">
          {m.cores.map((c) => (
            <button key={c} type="button" className="bolso-cor" onClick={() => mudar("cores", m.cores.filter((x) => x !== c))} aria-label={`Tirar a cor ${c}`}>
              <span style={{ background: c }} aria-hidden="true" />
              {c}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
          {m.cores.length < 6 && (
            <>
              <input id="bolso-marca-cor" className="membros-campo w-32" value={cor} onChange={(e) => setCor(e.target.value)} placeholder="#16A34A" aria-describedby="bolso-marca-cor-ajuda" />
              <button
                type="button"
                className="membros-acao border border-border"
                disabled={!/^#[0-9a-fA-F]{6}$/.test(cor)}
                onClick={() => {
                  mudar("cores", Array.from(new Set([...m.cores, cor.toUpperCase()])));
                  setCor("");
                }}
              >
                Adicionar cor
              </button>
            </>
          )}
        </div>
      </Campo>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={m.direitos_confirmados} onChange={(e) => mudar("direitos_confirmados", e.target.checked)} />
        <span>Confirmo que posso usar o nome, a logo e as imagens desta marca.</span>
      </label>
      <Erro texto={erro} />
      <div className="flex flex-wrap items-center gap-3">
      {aoCancelar && <button type="button" className="membros-acao bolso-voltar border border-border" disabled={salvando} onClick={() => JSON.stringify(m) === JSON.stringify(inicial || MARCA_VAZIA) ? aoCancelar() : setConfirmarSaida(true)}><ArrowLeft size={16} aria-hidden="true" />Voltar às campanhas</button>}
      <button type="submit" className="membros-acao bg-primary text-primary-foreground" disabled={salvando}>
        {salvando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
        Salvar marca
      </button>
      </div>
      {confirmarSaida && <div className="bolso-confirmar" role="group" aria-label="Alterações da marca não salvas"><p className="text-[13px]">Sair sem salvar as alterações da marca?</p><div className="flex flex-wrap gap-2"><button type="button" className="membros-acao border border-border" onClick={aoCancelar}>Sair sem salvar</button><button type="button" className="membros-acao" onClick={() => setConfirmarSaida(false)}>Continuar editando</button></div></div>}
    </form>
  );
}

// ─── Pedidos de geração ─────────────────────────────────────────────
function BotaoDePedido({
  estado,
  campanha,
  tipo,
  formato,
  rotulo,
  aoPedir,
  referencias = [],
  aguardandoReferencias = false,
}: {
  estado: EstadoDoEstudio | undefined;
  campanha: Campanha;
  tipo: "texto" | "imagem";
  formato: Formato | null;
  rotulo: string;
  aoPedir: () => void;
  referencias?: string[];
  aguardandoReferencias?: boolean;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [chave, setChave] = useState(novaChave);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const tarifa = estado && estado.politica ? (tipo === "texto" ? estado.politica.tarifa_texto : estado.politica.tarifa_imagem) : null;
  const bloqueio = aguardandoReferencias ? "Aguarde a conferência das referências antes de pedir a arte." : motivoParaNaoPedir(estado, tarifa, !!campanha.versao_escolhida, tipo);
  const confirmar = async () => {
    if (tarifa === null || bloqueio || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const novoMotor = tipo === "texto" ? estado?.recursos_criativos?.legenda : estado?.recursos_criativos?.referencias;
      const r = novoMotor
        ? await pedirCriativo(campanha.id, tipo === "texto" ? "legenda" : "imagem", formato, chave, tarifa, tipo === "imagem" ? { referencias } : {})
        : await pedir(campanha.id, tipo, formato, chave, tarifa);
      aoPedir();
      setConfirmando(false);
      setChave(novaChave());
      // O crédito já está reservado; processar é seguro de repetir.
      void processar(r.job_id).then(aoPedir, aoPedir);
    } catch (er) {
      setErro(erroDoBolso(er));
    } finally {
      setEnviando(false);
    }
  };
  const disponivel = estado && estado.saldo ? estado.saldo.disponivel : 0;
  return (
    <div className="bolso-pedido space-y-2">
      {!confirmando ? (
        <div className={tipo === "imagem" ? "bolso-gerar-arte-linha" : undefined}>
        <button type="button" className={`membros-acao bg-primary text-primary-foreground${tipo === "imagem" ? " bolso-gerar-arte-acao" : ""}`} aria-label={tipo === "imagem" ? rotulo : undefined} title={tipo === "imagem" ? rotulo : undefined} disabled={!!bloqueio} aria-describedby={[bloqueio ? `bolso-bloqueio-${tipo}` : null, tipo === "imagem" && tarifa !== null ? "bolso-tarifa-imagem" : null].filter(Boolean).join(" ") || undefined} onClick={() => setConfirmando(true)}>
          <Sparkles size={16} aria-hidden="true" />
          {tipo === "texto" && <span className="bolso-gerar-texto-rotulo">{rotulo}</span>}
          {tipo === "texto" && tarifa !== null && <span className="opacity-80">· {tarifa} crédito{tarifa === 1 ? "" : "s"}</span>}
        </button>
        {tipo === "imagem" && tarifa !== null && <span id="bolso-tarifa-imagem" className="bolso-gerar-arte-custo">{tarifa} crédito{tarifa === 1 ? "" : "s"} por arte</span>}
        </div>
      ) : (
        <div className="bolso-confirmar" role="group" aria-label="Confirmar consumo de créditos">
          <p className="text-[13px]">
            Este pedido reserva <strong>{tarifa}</strong> crédito{tarifa === 1 ? "" : "s"} de <strong>{disponivel}</strong>
            {estado && estado.carteira === "teste" ? " (de teste)" : ""}. Se não der certo, eles voltam.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="membros-acao bg-primary text-primary-foreground" onClick={() => void confirmar()} disabled={enviando}>
              {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
              Confirmar
            </button>
            <button type="button" className="membros-acao" onClick={() => setConfirmando(false)} disabled={enviando}>
              Voltar
            </button>
          </div>
        </div>
      )}
      {bloqueio && (
        <p id={`bolso-bloqueio-${tipo}`} className="text-[12px] text-muted-foreground">
          {bloqueio}
        </p>
      )}
      <Erro texto={erro} />
    </div>
  );
}

// ─── Texto: versões e edição manual ────────────────────────────────────
function EditorDoTexto({ campanha, aoMudar }: { campanha: Campanha; aoMudar: () => void }) {
  const atual = campanha.versoes.find((v) => v.numero === campanha.versao_escolhida) || campanha.versoes[0] || null;
  const [rascunho, setRascunho] = useState<ConteudoDaCampanha>(atual ? atual.conteudo : { mensagem: "", texto: "", cta: campanha.briefing.cta || "", aplicacao: "", direcao_visual: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    if (atual) setRascunho(atual.conteudo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual ? atual.numero : 0]);
  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const n = await salvarVersao(campanha.id, rascunho);
      setAviso(`Versão ${n} guardada. Edição manual não usa crédito.`);
      aoMudar();
    } catch (er) {
      setErro(erroDoBolso(er));
    } finally {
      setSalvando(false);
    }
  };
  const mudar = (campo: keyof ConteudoDaCampanha, valor: string) => setRascunho((a) => ({ ...a, [campo]: valor }));
  const copiarLegenda = async () => {
    try {
      await navigator.clipboard.writeText(rascunho.texto);
      setAviso("Legenda copiada.");
    } catch {
      setAviso("Não foi possível copiar automaticamente. Selecione o texto da legenda para copiar.");
    }
  };
  return (
    <div className="bolso-editor-texto space-y-4">
      {campanha.versoes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Versões do texto">
          {campanha.versoes.map((v) => (
            <button
              key={v.numero}
              type="button"
              className="membros-acao border border-border"
              aria-pressed={v.numero === campanha.versao_escolhida}
              onClick={() => void escolherVersao(campanha.id, v.numero).then(aoMudar)}
              title={v.origem === "manual" ? "Escrita por você" : v.origem === "simulada" ? "Demonstração (provedor simulado)" : "Criada pelo estúdio"}
            >
              V{v.numero}
              {v.origem === "simulada" && <FlaskConical size={13} aria-label="demonstração" />}
            </button>
          ))}
        </div>
      )}
      {atual && atual.origem === "simulada" && <p className="text-[12px] text-muted-foreground">Versão de demonstração: montada só com o que você escreveu, sem IA.</p>}
      <Campo id="bolso-texto-mensagem" rotulo="Mensagem principal" ajuda="A ideia em uma frase.">
        <input id="bolso-texto-mensagem" className="membros-campo" value={rascunho.mensagem} onChange={(e) => mudar("mensagem", e.target.value)} maxLength={4000} aria-describedby="bolso-texto-mensagem-ajuda" />
      </Campo>
      <Campo id="bolso-texto-texto" rotulo="Legenda da publicação">
        <textarea id="bolso-texto-texto" className="membros-campo bolso-editor-legenda" rows={10} value={rascunho.texto} onChange={(e) => mudar("texto", e.target.value)} maxLength={4000} />
      </Campo>
      <button type="button" className="membros-acao border border-border" onClick={() => void copiarLegenda()} disabled={!rascunho.texto.trim()}><Copy size={15} aria-hidden="true" />Copiar legenda</button>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="bolso-texto-cta" rotulo="Chamada para ação">
          <input id="bolso-texto-cta" className="membros-campo" value={rascunho.cta} onChange={(e) => mudar("cta", e.target.value)} maxLength={4000} />
        </Campo>
        <Campo id="bolso-texto-aplicacao" rotulo="Onde e como usar">
          <input id="bolso-texto-aplicacao" className="membros-campo" value={rascunho.aplicacao} onChange={(e) => mudar("aplicacao", e.target.value)} maxLength={4000} />
        </Campo>
      </div>
      <Campo id="bolso-texto-visual" rotulo="Direção da arte" ajuda="Guia o pedido da arte.">
        <textarea id="bolso-texto-visual" className="membros-campo" rows={2} value={rascunho.direcao_visual} onChange={(e) => mudar("direcao_visual", e.target.value)} maxLength={4000} aria-describedby="bolso-texto-visual-ajuda" />
      </Campo>
      <Erro texto={erro} />
      {aviso && (
        <p role="status" className="text-[12px] text-muted-foreground">
          {aviso}
        </p>
      )}
      <button type="button" className="membros-acao border border-border" onClick={() => void salvar()} disabled={salvando || !rascunho.texto.trim()}>
        {salvando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
        Guardar como nova versão
      </button>
    </div>
  );
}

// ─── Arte: prévia e download ───────────────────────────────────────────
function CartaoDaArte({ arte, titulo, campanha, estado, aoMudar }: { arte: Arte; titulo: string; campanha: string; estado: EstadoDoEstudio | undefined; aoMudar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);
  useEffect(() => {
    let vivo = true;
    urlDaArte(arte.caminho)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setErro("Não foi possível abrir a prévia."));
    return () => {
      vivo = false;
    };
  }, [arte.caminho]);
  const baixar = async () => {
    setBaixando(true);
    try {
      window.location.assign(await urlDaArte(arte.caminho, nomeDoArquivo(titulo, arte.formato, arte.versao_campanha, arte.mime)));
    } catch (er) {
      setErro(erroDoBolso(er));
    } finally {
      setBaixando(false);
    }
  };
  return (
    <figure className="bolso-arte" data-escolhida={arte.escolhido || undefined}>
      <div className="bolso-arte-quadro" style={{ aspectRatio: FORMATOS[arte.formato].proporcao.replace(":", " / ") }}>
        {url ? <VisualizadorDaArte url={url} alt={`Arte ${FORMATOS[arte.formato].nome}, versão ${arte.versao_campanha} do texto`} titulo={`${titulo} · ${FORMATOS[arte.formato].nome}`} baixando={baixando} aoBaixar={() => void baixar()}><img src={url} alt={`Arte ${FORMATOS[arte.formato].nome}, versão ${arte.versao_campanha} do texto`} loading="lazy" /></VisualizadorDaArte> : <Loader2 className="animate-spin text-muted-foreground" aria-label="Carregando prévia" />}
      </div>
      <figcaption className="space-y-2 p-3 text-[12px]">
        <p>
          {FORMATOS[arte.formato].nome} · texto V{arte.versao_campanha} · {Math.round(arte.bytes / 1024)} KB
          {arte.simulado && <span className="bolso-selo">Demonstração</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="membros-acao bolso-acao-icone" aria-label="Baixar arte" title="Baixar arte" onClick={() => void baixar()} disabled={baixando}>
            {baixando ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
          </button>
          <button type="button" className="membros-acao" aria-pressed={arte.escolhido} onClick={() => void escolherArte(arte.id).then(aoMudar)}>
            <Check size={15} aria-hidden="true" />
            {arte.escolhido ? "Escolhida" : "Marcar como escolhida"}
          </button>
        </div>
        <Erro texto={erro} />
        {estado?.recursos_criativos?.ajuste && <AjustarArte campanha={campanha} arte={arte.id} formato={arte.formato} estado={estado} aoConcluir={aoMudar} />}
      </figcaption>
    </figure>
  );
}

// ─── Campanha ──────────────────────────────────────────────────────────
type Etapa = "oferta" | "texto" | "arte";

function ContextoDaCampanha({ campanha }: { campanha: Campanha }) {
  const noCelular = useIsMobile();
  const contexto = (
    <dl className="bolso-contexto-campanha">
      <div><dt>Produto ou serviço</dt><dd>{campanha.briefing.produto}</dd></div>
      <div><dt>Objetivo</dt><dd>{TIPOS[campanha.briefing.tipo].nome}</dd></div>
      {campanha.briefing.condicoes && <div><dt>Condições</dt><dd>{campanha.briefing.condicoes}</dd></div>}
    </dl>
  );
  return noCelular ? (
    <details className="bolso-contexto-recolhido">
      <summary>Contexto da oferta</summary>
      {contexto}
    </details>
  ) : contexto;
}

function TelaDaCampanha({ id, estado, aoVoltar }: { id: string; estado: EstadoDoEstudio | undefined; aoVoltar: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState<Etapa>("texto");
  const [editandoOferta, setEditandoOferta] = useState(false);
  const [referencias, setReferencias] = useState<string[]>([]);
  const [referenciasOcupadas, setReferenciasOcupadas] = useState(false);
  const formatos = (estado && estado.politica && estado.politica.formatos) || [];
  const [formato, setFormato] = useState<Formato>(formatos[0] || "feed_1x1");
  const campanha = useQuery({
    queryKey: ["bolso", "campanha", id, user?.id],
    enabled: !!user,
    queryFn: () => lerCampanha(id),
    retry: false,
    refetchInterval: (q) => {
      const c = q.state.data as Campanha | undefined;
      return c && c.jobs.some((j) => j.estado === "na_fila" || j.estado === "processando") ? 3000 : false;
    },
  });
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["bolso"] });
  };
  if (campanha.isPending) return <p role="status">Abrindo a campanha…</p>;
  if (campanha.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>{erroDoBolso(campanha.error)}</p>
        <button type="button" className="membros-acao" onClick={aoVoltar}>
          Voltar às campanhas
        </button>
      </div>
    );
  const c = campanha.data;
  const textoDaArte = c.versoes.find((v) => v.numero === c.versao_escolhida)?.conteudo;
  const semMensagemNaArte = !!textoDaArte && !textoDaArte.mensagem.trim();
  const textoLongoNaArte = !!textoDaArte && (textoDaArte.mensagem.trim().length > 80 || textoDaArte.cta.trim().length > 50);
  const andamento = c.jobs.filter((j) => j.estado === "na_fila" || j.estado === "processando" || j.estado === "incerto");
  // O banco entrega os pedidos do mais recente para o mais antigo.
  const ultimosProblemas = c.jobs.filter((j, indice, pedidos) =>
    j.estado === "falhou" && pedidos.findIndex((pedido) => pedido.tipo === j.tipo) === indice,
  );
  const etapas: { id: Etapa; nome: string; feito: boolean }[] = [
    { id: "oferta", nome: "Oferta", feito: true },
    { id: "texto", nome: "Texto", feito: c.versoes.length > 0 },
    { id: "arte", nome: "Arte", feito: c.artes.length > 0 },
  ];
  return (
    <section className="bolso-campanha" aria-labelledby="bolso-campanha-titulo">
      <div className="bolso-campanha-barra">
      <div className="bolso-campanha-navegacao">
      <button type="button" className="membros-acao bolso-voltar bolso-navegacao-voltar text-muted-foreground" aria-label="Minhas campanhas" title="Minhas campanhas" onClick={aoVoltar}>
        <ArrowLeft size={16} aria-hidden="true" />
      </button>
      <div className="bolso-campanha-topo">
        <h2 id="bolso-campanha-titulo" title={c.titulo}>
          {c.titulo}
        </h2>
        <time className="bolso-campanha-data" dateTime={c.atualizado_em} title={`Atualizada em ${dataCurta(c.atualizado_em)}`} aria-label={`Atualizada em ${dataCurta(c.atualizado_em)}`}>{dataCurta(c.atualizado_em)}</time>
      </div>
      </div>
      <nav className="bolso-etapas" aria-label="Etapas da campanha">
        {etapas.map((e, i) => (
          <button key={e.id} type="button" aria-label={e.id === "arte" ? "Arte e download" : e.nome} aria-current={etapa === e.id ? "step" : undefined} onClick={() => setEtapa(e.id)}>
            <span className="bolso-etapa-numero" aria-hidden="true">{e.feito && etapa !== e.id ? <Check size={14} /> : i + 1}</span>
            <span>{e.nome}</span>
          </button>
        ))}
      </nav>
      </div>
      {andamento.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {andamento.map((j) => (
            <li key={j.id} className="bolso-andamento">
              {j.estado === "incerto" ? null : <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
              <span>
                <strong>{j.tipo === "texto" ? "Texto" : `Arte ${j.formato ? FORMATOS[j.formato].nome : ""}`}</strong>: {ROTULO_DO_JOB[j.estado]}. {EXPLICA_JOB[j.estado]}
              </span>
              {j.estado === "na_fila" && (
                <button type="button" className="membros-acao" onClick={() => void cancelarPedido(j.id).then(atualizar)}>
                  Cancelar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {ultimosProblemas.map((j) => (
        <p key={j.id} role="status" className="text-[13px]">
          O último pedido de {j.tipo === "texto" ? "texto" : "arte"} não deu certo{j.erro ? `: ${j.erro}` : "."} {EXPLICA_JOB.falhou}
        </p>
      ))}

      {etapa === "oferta" &&
        (editandoOferta ? (
          <FormularioDaOferta campanha={c} estado={estado} aoSalvar={() => { setEditandoOferta(false); atualizar(); }} aoCancelar={() => setEditandoOferta(false)} />
        ) : (
          <div className="bolso-cartao space-y-5">
            <dl className="bolso-resumo-oferta">
              <div><dt>Objetivo</dt><dd>{TIPOS[c.briefing.tipo].nome}</dd></div>
              <div><dt>Produto ou serviço</dt><dd>{c.briefing.produto}</dd></div>
              {c.briefing.diferencial && <div><dt>Diferencial</dt><dd>{c.briefing.diferencial}</dd></div>}
              <div><dt>Condições</dt><dd>{c.briefing.condicoes || "Não informadas"}</dd></div>
              {c.briefing.cta && <div><dt>Chamada para ação</dt><dd>{c.briefing.cta}</dd></div>}
              {c.briefing.canal && <div><dt>Canal</dt><dd>{c.briefing.canal}</dd></div>}
            </dl>
            <div className="bolso-formulario-acoes">
              <button type="button" className="membros-acao border border-border" onClick={() => setEditandoOferta(true)}>Editar oferta</button>
              <button type="button" className="membros-acao bg-primary text-primary-foreground" onClick={() => setEtapa("texto")}>Continuar para o texto <ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          </div>
        ))}

      {etapa === "texto" && (
        <div className="bolso-trabalho bolso-trabalho-texto">
          <div className="bolso-cartao bolso-trabalho-controles space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold">Texto da campanha</h3>
              <AjudaRecolhida rotulo="Sobre criar o texto">
                O estúdio escreve mensagem, texto, chamada, onde usar e a direção da arte com base na sua marca e na oferta. Você revisa e pode
                editar à mão quantas vezes quiser, sem crédito.
              </AjudaRecolhida>
            </div>
            <BotaoDePedido estado={estado} campanha={c} tipo="texto" formato={null} rotulo={c.versoes.length ? "Criar outra versão" : "Criar o texto"} aoPedir={atualizar} />
            <ContextoDaCampanha campanha={c} />
            <button type="button" className="membros-acao border border-border" onClick={() => setEtapa("oferta")}>Conferir oferta <ArrowUpRight size={15} aria-hidden="true" /></button>
          </div>
          <div className="bolso-cartao bolso-trabalho-resultado">
            <div className="mb-4 flex items-center gap-2">
              <h3 className="text-[15px] font-semibold">{c.versoes.length ? "Revisar e editar" : "Ou escreva você mesmo"}</h3>
              <AjudaRecolhida rotulo="Como o texto aparece na arte">
                Para incluir texto na arte, use até 80 caracteres na mensagem principal e até 50 na chamada para ação. O texto da publicação pode ser mais longo. Versões antigas continuam editáveis.
              </AjudaRecolhida>
            </div>
            <EditorDoTexto campanha={c} aoMudar={atualizar} />
          </div>
          {!!c.versao_escolhida && <div className="bolso-proximo-passo"><button type="button" className="membros-acao border border-border" onClick={() => setEtapa("arte")}>Continuar para a arte <ArrowRight size={16} aria-hidden="true" /></button></div>}
        </div>
      )}

      {etapa === "arte" && (
        <div className="bolso-trabalho bolso-trabalho-arte">
          <div className="bolso-cartao bolso-trabalho-controles space-y-4">
            <div className="bolso-arte-barra">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold">Arte da campanha</h3>
                <AjudaRecolhida rotulo="Sobre a arte">Uma imagem estática no formato escolhido, ligada à versão do texto marcada. Você revisa, baixa e publica.</AjudaRecolhida>
              </div>
              {formatos.length > 0 ? (
                <label className="bolso-formato-inline"><span className="bolso-formato-rotulo">Formato</span><select className="membros-campo" value={formato} onChange={(e) => setFormato(e.target.value as Formato)}>{formatos.map((f) => <option key={f} value={f}>{FORMATOS[f].nome} ({FORMATOS[f].proporcao})</option>)}</select></label>
              ) : <p className="text-[12px] text-muted-foreground">Os formatos aparecem quando o seu acesso estiver ativo.</p>}
              <span className="bolso-texto-em-uso">{c.versao_escolhida ? `Texto V${c.versao_escolhida}` : "Escolha o texto antes"}</span>
              <BotaoDePedido estado={estado} campanha={c} tipo="imagem" formato={formato} rotulo="Pedir a arte" aoPedir={atualizar} referencias={referencias} aguardandoReferencias={!!estado?.recursos_criativos?.referencias && referenciasOcupadas} />
            </div>
            {textoDaArte && <details className="bolso-mensagem-em-uso"><summary>Conferir a mensagem escolhida</summary><dl className="bolso-contexto-campanha">{textoDaArte.mensagem && <div><dt>Mensagem</dt><dd>{textoDaArte.mensagem}</dd></div>}{textoDaArte.cta && <div><dt>Chamada para ação</dt><dd>{textoDaArte.cta}</dd></div>}</dl></details>}
            {estado?.recursos_criativos?.referencias && <ReferenciasDaCampanha campanha={c.id} aoMudar={setReferencias} aoOcupar={setReferenciasOcupadas} />}
            {semMensagemNaArte ? <p role="status" className="bolso-aviso">Esta versão não tem mensagem principal. A arte será criada sem texto.</p> : textoLongoNaArte && <p role="status" className="bolso-aviso">Esta versão tem textos longos. A arte será criada sem texto.</p>}
            {(semMensagemNaArte || textoLongoNaArte) && <AjudaRecolhida rotulo="Como incluir texto na arte">Use uma mensagem principal de até 80 caracteres e uma chamada para ação de até 50. Salve e escolha a nova versão antes de pedir a arte.</AjudaRecolhida>}
          </div>
          {c.artes.length ? <div className="bolso-galeria bolso-trabalho-resultado">{c.artes.map((a) => <CartaoDaArte key={a.id} arte={a} titulo={c.titulo} campanha={c.id} estado={estado} aoMudar={atualizar} />)}</div> : <div className="bolso-arte-vazia bolso-trabalho-resultado"><Image size={34} aria-hidden="true" /><p>As artes desta campanha aparecem aqui, com prévia e download.</p></div>}
        </div>
      )}
    </section>
  );
}

// ─── Entrada do estúdio ────────────────────────────────────────────────
export default function EstudioBolso({ aoConhecerServicos }: { aoConhecerServicos?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const estado = useEstadoDoBolso();
  const marca = useQuery({ queryKey: ["bolso", "marca", user?.id], queryFn: lerMarca, retry: false, enabled: !!user && !!estado.data && estado.data.exposto });
  const campanhas = useQuery({ queryKey: ["bolso", "campanhas", user?.id], queryFn: listarCampanhas, retry: false, enabled: !!user && !!marca.data });
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [editandoMarca, setEditandoMarca] = useState(false);

  if (estado.isPending) return <p role="status">Abrindo o estúdio…</p>;
  if (estado.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>{erroDoBolso(estado.error)}</p>
        <button type="button" className="membros-acao" onClick={() => void estado.refetch()}>
          <RotateCcw size={16} aria-hidden="true" />
          Tentar de novo
        </button>
      </div>
    );
  const e = estado.data;
  const situacao = situacaoDoEstudio(e);
  if (!e.exposto) return <p className="text-[13px] text-muted-foreground">{situacao.texto}</p>;

  return (
    <section className="bolso-estudio" data-bolso-estudio="" aria-label="Estúdio Aceleriq de Bolso">
      <CabecalhoDePagina className="sr-only" titulo="Aceleriq de Bolso" />
      {situacao.demonstracao && <FaixaDeDemonstracao />}
      {!situacao.podeGerar && (
        <p role="status" className="bolso-aviso">
          <strong>{situacao.titulo}.</strong> {situacao.texto}
        </p>
      )}

      {marca.isPending ? (
        <p role="status">Carregando sua marca…</p>
      ) : marca.isError ? (
        <p role="alert">{erroDoBolso(marca.error)}</p>
      ) : !marca.data || editandoMarca ? (
        <FormularioDaMarca
          inicial={marca.data}
          aoCancelar={marca.data ? () => setEditandoMarca(false) : undefined}
          aoSalvar={() => {
            setEditandoMarca(false);
            void qc.invalidateQueries({ queryKey: ["bolso"] });
          }}
        />
      ) : aberta ? (
        <TelaDaCampanha id={aberta} estado={e} aoVoltar={() => setAberta(null)} />
      ) : nova ? (
        <FormularioDaOferta
          campanha={null}
          estado={e}
          aoSalvar={(id) => {
            setNova(false);
            setAberta(id);
            void qc.invalidateQueries({ queryKey: ["bolso", "campanhas"] });
          }}
          aoCancelar={() => setNova(false)}
        />
      ) : (
        <div className="bolso-biblioteca space-y-5">
          <div className="bolso-biblioteca-topo">
            <div className="bolso-biblioteca-titulo">
              <h2>Minhas campanhas</h2>
              <AjudaRecolhida rotulo="Sobre o estúdio">
                Você prepara a campanha, revisa o texto e a arte, baixa e publica. Autoatendimento. Não é agência humana, não faz gestão de anúncios e não garante vendas. Para consultar saldo e recargas, use Créditos e acesso no menu.
              </AjudaRecolhida>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="membros-acao bolso-marca-atalho" onClick={() => setEditandoMarca(true)} aria-label={`Editar marca: ${marca.data.nome}`}>
                <Palette size={16} aria-hidden="true" /><span>{marca.data.nome}</span>
              </button>
              {!!campanhas.data?.length && <button type="button" className="membros-acao bg-primary text-primary-foreground" onClick={() => setNova(true)}>
                <Plus size={16} aria-hidden="true" />
                Nova campanha
              </button>}
            </div>
          </div>
          {campanhas.isPending ? (
            <p role="status">Carregando campanhas…</p>
          ) : campanhas.isError ? (
            <p role="alert">{erroDoBolso(campanhas.error)}</p>
          ) : campanhas.data.length === 0 ? (
            <div className="bolso-primeira-campanha">
              <div className="bolso-convite">
                <span className="bolso-convite-icone" aria-hidden="true"><Sparkles size={28} /></span>
                <h3>Sua próxima ideia<br />começa aqui.</h3>
                <button type="button" className="membros-acao bg-primary text-primary-foreground" onClick={() => setNova(true)}>
                  Criar primeira campanha <ArrowUpRight size={17} aria-hidden="true" />
                </button>
              </div>
              <div className="bolso-convite-visual">
                <img src="/membros/refino-20261027/04-capa-estudio.webp" alt="" width={1024} height={1536} loading="lazy" />
              <ol className="bolso-caminho" aria-label="Como criar sua primeira campanha">
                <li><span aria-hidden="true"><Target size={20} /></span><div><small>01</small><strong>Prepare a oferta</strong></div></li>
                <li><span aria-hidden="true"><Type size={20} /></span><div><small>02</small><strong>Encontre a mensagem</strong></div></li>
                <li><span aria-hidden="true"><Image size={20} /></span><div><small>03</small><strong>Crie e revise a arte</strong></div></li>
              </ol>
              </div>
            </div>
          ) : (
            <ul className="bolso-lista">
              {campanhas.data.map((c) => (
                <li key={c.id}>
                  <button type="button" className="bolso-linha bolso-campanha-cartao" onClick={() => setAberta(c.id)}>
                    <span className="bolso-cartao-topo">
                      <span className="bolso-campanha-icone" aria-hidden="true"><Megaphone size={22} /></span>
                      <span className="bolso-estado-campanha">{c.em_andamento > 0 ? <><Loader2 size={13} className="animate-spin" aria-hidden="true" />Em criação</> : c.artes > 0 ? "Para revisar" : c.versoes > 0 ? "Texto criado" : "Rascunho"}</span>
                      <ArrowUpRight size={18} className="bolso-cartao-seta" aria-hidden="true" />
                    </span>
                    <span className="bolso-cartao-conteudo">
                      <span className="bolso-objetivo">{TIPOS[c.tipo].nome}</span>
                      <strong>{c.titulo}</strong>
                    </span>
                    <span className="bolso-cartao-rodape">
                      <span>{c.versoes} {c.versoes === 1 ? "texto" : "textos"} · {c.artes} {c.artes === 1 ? "arte" : "artes"}</span>
                      <time dateTime={c.atualizado_em}>{dataCurta(c.atualizado_em)}</time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <aside className="bolso-em-breve" aria-label="Vídeos UGC em breve"><Video size={22} aria-hidden="true" /><strong>Vídeos UGC</strong><span>Em breve</span></aside>
          {campanhas.data && campanhas.data.some((c) => c.artes > 0) && (
            <div className="bolso-agencia">
              <p className="text-[13px]">Prefere delegar? A equipe Aceleriq também faz por você.</p>
              {e.destino_agencia ? (
                <a className="membros-acao border border-border" href={e.destino_agencia} target="_blank" rel="noopener noreferrer" onClick={aoConhecerServicos}>
                  Conhecer serviços da agência
                </a>
              ) : (
                <>
                  <button type="button" className="membros-acao border border-border" disabled aria-describedby="bolso-agencia-motivo">
                    Conhecer serviços da agência
                  </button>
                  <p id="bolso-agencia-motivo" className="w-full text-[12px] text-muted-foreground">
                    O contato da agência ainda não foi publicado aqui.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
