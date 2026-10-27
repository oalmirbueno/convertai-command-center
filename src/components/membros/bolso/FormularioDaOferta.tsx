import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Target } from "lucide-react";
import { AjudaRecolhida } from "@/components/sistema";
import { erroDoBolso, salvarCampanha } from "@/lib/bolso/api";
import { avisoDeCondicoes, BRIEFING_VAZIO, faltasDoBriefing, TIPOS, type Briefing, type Campanha, type EstadoDoEstudio, type TipoDaCampanha } from "@/lib/bolso/modelo";
import { CompletarOferta } from "./RecursosCriativos";

const ETAPAS = ["Objetivo", "Produto", "Oferta", "Revisão"];
const CHAMADAS = [
  { nome: "WhatsApp", texto: "Chame no WhatsApp" },
  { nome: "Link na bio", texto: "Acesse o link na bio" },
  { nome: "Site", texto: "Compre pelo site" },
  { nome: "Agendamento", texto: "Agende seu horário" },
];

function Campo({ id, rotulo, ajuda, children }: { id: string; rotulo: string; ajuda?: string; children: ReactNode }) {
  return <div className="space-y-1.5"><label htmlFor={id} className="block text-[13px] font-medium">{rotulo}</label>{children}{ajuda && <p id={`${id}-ajuda`} className="text-[12px] text-muted-foreground">{ajuda}</p>}</div>;
}

export default function FormularioDaOferta({ campanha, estado, aoSalvar, aoCancelar }: { campanha: Campanha | null; estado?: EstadoDoEstudio; aoSalvar: (id: string) => void; aoCancelar?: () => void }) {
  const [b, setB] = useState<Briefing>(campanha ? { ...BRIEFING_VAZIO, ...campanha.briefing } : BRIEFING_VAZIO);
  const [titulo, setTitulo] = useState(campanha?.titulo || "");
  const [etapa, setEtapa] = useState(0);
  const [personalizada, setPersonalizada] = useState(!!campanha?.briefing.cta && !CHAMADAS.some((c) => c.texto === campanha.briefing.cta));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const cabecalho = useRef<HTMLHeadingElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const etapaAnterior = useRef(0);
  useEffect(() => {
    if (etapaAnterior.current !== etapa) {
      if (painel.current) painel.current.scrollTop = 0;
      cabecalho.current?.focus({ preventScroll: true });
    }
    etapaAnterior.current = etapa;
  }, [etapa]);
  const mudar = (campo: keyof Briefing, valor: string) => setB((a) => ({ ...a, [campo]: valor }));
  const faltas = faltasDoBriefing(b);
  const briefingSalvo = { ...BRIEFING_VAZIO, ...campanha?.briefing };
  const rascunhoAlterado = (Object.keys(b) as (keyof Briefing)[]).some((campo) => b[campo] !== briefingSalvo[campo]);
  const aplicarSugestao = (proposta: Briefing) => {
    setB((atual) => (Object.keys(atual) as (keyof Briefing)[]).reduce((sugestao, campo) => atual[campo] !== briefingSalvo[campo] ? { ...sugestao, [campo]: atual[campo] } : sugestao, { ...BRIEFING_VAZIO, ...proposta }));
    setPersonalizada(true); setEtapa(2); setErro(null);
  };
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (etapa < ETAPAS.length - 1) { setEtapa((atual) => atual + 1); return; }
    if (!b.produto.trim()) { setErro("Diga qual produto ou serviço a campanha divulga."); setEtapa(1); return; }
    setSalvando(true);
    setErro(null);
    try {
      aoSalvar(await salvarCampanha({ id: campanha?.id, titulo, briefing: b }, campanha?.versao));
    } catch (er) {
      setErro(erroDoBolso(er));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <form className="bolso-cartao bolso-formulario bolso-assistente" onSubmit={(e) => void enviar(e)} aria-labelledby="bolso-oferta-titulo" noValidate>
      <div className="bolso-assistente-topo">
        <div className="bolso-titulo-de-bloco">
          <Target size={19} aria-hidden="true" /><h2 id="bolso-oferta-titulo">Sua campanha</h2>
          <AjudaRecolhida rotulo="Como preencher a oferta">Escreva só o que é verdade hoje. O estúdio não inventa preço, desconto, estoque, prazo, depoimento ou resultado: o que você não informar fica de fora do texto.</AjudaRecolhida>
        </div>
        <span className="bolso-assistente-contagem">{etapa + 1} de {ETAPAS.length}</span>
      </div>
      <nav className="bolso-assistente-etapas" aria-label="Preparação da campanha">
        {ETAPAS.map((nome, indice) => <button key={nome} type="button" aria-current={etapa === indice ? "step" : undefined} onClick={() => setEtapa(indice)} disabled={salvando}><span aria-hidden="true">{indice + 1}</span>{nome}</button>)}
      </nav>
      <div ref={painel} className="bolso-assistente-passo">
        <h3 ref={cabecalho} tabIndex={-1} className="bolso-assistente-titulo">{["Qual é o objetivo?", "O que você quer divulgar?", "Qual é a sua oferta?", "Tudo certo para começar?"][etapa]}</h3>
        {erro && <p role="alert" className="text-[13px] text-destructive">{erro}</p>}
        {etapa === 0 && campanha && estado && (estado.recursos_criativos?.briefing || campanha.jobs.some((job) => job.natureza === "briefing")) && <CompletarOferta campanha={campanha} estado={estado} rascunhoAlterado={rascunhoAlterado} aoCompletar={aplicarSugestao} />}
        {etapa === 0 && <fieldset className="space-y-3"><legend className="sr-only">Qual é o objetivo?</legend><div className="bolso-assistente-objetivos" role="radiogroup">{(Object.keys(TIPOS) as TipoDaCampanha[]).map((t) => <label key={t} className="bolso-opcao" data-escolhida={b.tipo === t || undefined}><input type="radio" name="bolso-tipo" value={t} checked={b.tipo === t} onChange={() => mudar("tipo", t)} className="sr-only" /><span className="bolso-opcao-marca" aria-hidden="true">{b.tipo === t && <Check size={12} />}</span><span>{TIPOS[t].nome}</span></label>)}</div></fieldset>}
        {etapa === 1 && <div className="bolso-assistente-campos">
          <Campo id="bolso-produto" rotulo="Produto ou serviço"><input id="bolso-produto" className="membros-campo" value={b.produto} onChange={(e) => mudar("produto", e.target.value)} maxLength={1500} required aria-invalid={!b.produto.trim() && !!erro} /></Campo>
          <Campo id="bolso-titulo" rotulo="Nome da campanha" ajuda="Opcional. Só para você achar depois."><input id="bolso-titulo" className="membros-campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={160} aria-describedby="bolso-titulo-ajuda" /></Campo>
          <Campo id="bolso-publico" rotulo="Para quem é esta campanha" ajuda="Vazio: usa o público da marca."><input id="bolso-publico" className="membros-campo" value={b.publico} onChange={(e) => mudar("publico", e.target.value)} maxLength={1500} aria-describedby="bolso-publico-ajuda" /></Campo>
          <Campo id="bolso-canal" rotulo="Onde vai publicar"><input id="bolso-canal" className="membros-campo" value={b.canal} onChange={(e) => mudar("canal", e.target.value)} placeholder="Instagram, WhatsApp..." maxLength={1500} /></Campo>
        </div>}
        {etapa === 2 && <div className="space-y-5">
          <div className="bolso-assistente-campos">
            <Campo id="bolso-diferencial" rotulo="Por que escolher você" ajuda="Um diferencial real, nas suas palavras."><textarea id="bolso-diferencial" className="membros-campo" rows={3} value={b.diferencial} onChange={(e) => mudar("diferencial", e.target.value)} maxLength={1500} aria-describedby="bolso-diferencial-ajuda" /></Campo>
            <Campo id="bolso-condicoes" rotulo="Condições comerciais" ajuda={avisoDeCondicoes(b) || "Aparecem como você escreveu."}><textarea id="bolso-condicoes" className="membros-campo" rows={3} value={b.condicoes} onChange={(e) => mudar("condicoes", e.target.value)} placeholder="Preço, prazo, forma de pagamento (se quiser mostrar)" maxLength={1500} aria-describedby="bolso-condicoes-ajuda" /></Campo>
          </div>
          <div className="space-y-3"><p className="text-[13px] font-medium">O que a pessoa deve fazer?</p><div className="bolso-chamadas" role="group" aria-label="Sugestões de chamada">{CHAMADAS.map((c) => <button key={c.nome} type="button" aria-pressed={!personalizada && b.cta === c.texto} onClick={() => { mudar("cta", c.texto); setPersonalizada(false); }}>{c.nome}</button>)}<button type="button" aria-pressed={personalizada} onClick={() => setPersonalizada(true)}>Personalizar</button></div>
            <Campo id="bolso-cta" rotulo={personalizada ? "Sua chamada personalizada" : "Texto da chamada"} ajuda="Este texto também orienta a chamada na arte. Você pode editar."><input id="bolso-cta" className="membros-campo" value={b.cta} onChange={(e) => { mudar("cta", e.target.value); setPersonalizada(true); }} maxLength={1500} placeholder={TIPOS[b.tipo].cta} aria-describedby="bolso-cta-ajuda" /></Campo>
          </div>
        </div>}
        {etapa === 3 && <div className="space-y-5">
          <dl className="bolso-resumo-oferta bolso-assistente-revisao">
            <div><dt>Objetivo</dt><dd>{TIPOS[b.tipo].nome}</dd></div><div><dt>Produto ou serviço</dt><dd>{b.produto || "Não informado"}</dd></div>
            <div><dt>Campanha</dt><dd>{titulo || b.produto || "Sem nome"}</dd></div><div><dt>Público</dt><dd>{b.publico || "Público da marca"}</dd></div>
            <div><dt>Diferencial</dt><dd>{b.diferencial || "Não informado"}</dd></div><div><dt>Condições</dt><dd>{b.condicoes || "Não informadas"}</dd></div>
            <div><dt>Chamada na arte</dt><dd>{b.cta || "Não definida"}</dd></div><div><dt>Canal</dt><dd>{b.canal || "Não informado"}</dd></div>
          </dl>
          {faltas.length > 0 && <p className="text-[12px] text-muted-foreground">Para um texto melhor, complete: {faltas.join(", ")}.</p>}
        </div>}
      </div>
      <div className="bolso-assistente-acoes">
        <div className="flex flex-wrap gap-2">{etapa > 0 && <button type="button" className="membros-acao border border-border" disabled={salvando} onClick={() => setEtapa((atual) => atual - 1)}><ArrowLeft size={16} aria-hidden="true" />Voltar</button>}{aoCancelar && <button type="button" className="membros-acao" disabled={salvando} onClick={aoCancelar}>Cancelar</button>}</div>
        <button type="submit" className="membros-acao bg-primary text-primary-foreground" disabled={salvando}>{salvando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : etapa === 3 ? <Check size={16} aria-hidden="true" /> : null}{etapa === 3 ? "Salvar oferta" : "Continuar"}{etapa < 3 && <ArrowRight size={16} aria-hidden="true" />}</button>
      </div>
    </form>
  );
}
