import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cancelarPedido, enviarReferencia, erroDoBolso, lerResultadoCriativo, listarReferencias, pedirCriativo, processar, removerReferencia, urlDaArte } from "@/lib/bolso/api";
import { motivoParaNaoPedir, novaChave, type Briefing, type Campanha, type EntradaCriativa, type EstadoDoEstudio, type Formato, type NaturezaCriativa, type ReferenciaCriativa, type ResultadoCriativo } from "@/lib/bolso/modelo";

function PedidoCriativo({ campanha, estado, natureza, formato = null, entrada, rotulo, valido, aoConcluir, jobInicial = null, podeCriar = true }: { campanha: string; estado: EstadoDoEstudio; natureza: NaturezaCriativa; formato?: Formato | null; entrada: EntradaCriativa; rotulo: string; valido: boolean; aoConcluir: (resultado: ResultadoCriativo) => void; jobInicial?: string | null; podeCriar?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [chave, setChave] = useState(novaChave);
  const [enviando, setEnviando] = useState(false);
  const [job, setJob] = useState<string | null>(jobInicial);
  const [erro, setErro] = useState<string | null>(null);
  const entregue = useRef<string | null>(null);
  useEffect(() => { if (!job && jobInicial) setJob(jobInicial); }, [jobInicial, job]);
  const imagem = natureza === "imagem" || natureza === "ajuste";
  const tarifa = estado.politica ? imagem ? estado.politica.tarifa_imagem : estado.politica.tarifa_texto : null;
  const bloqueio = podeCriar ? motivoParaNaoPedir(estado, tarifa, true, imagem ? "imagem" : "texto") : "Novos pedidos deste recurso estão indisponíveis. Sua sugestão salva continua aqui.";
  const resultado = useQuery({ queryKey: ["bolso", "criativo", job, user?.id], enabled: !!job && !!user, queryFn: () => lerResultadoCriativo(job!), retry: false, refetchInterval: (q) => q.state.status === "error" ? false : !q.state.data || ["na_fila", "processando"].includes(q.state.data.estado) ? 2000 : false });
  const pendente = enviando || !!job && (!resultado.data || ["na_fila", "processando", "incerto"].includes(resultado.data.estado));
  const conferir = resultado.isError || resultado.data?.estado === "incerto";
  const cancelar = async () => {
    if (!job || resultado.data?.estado !== "na_fila" || enviando) return;
    setEnviando(true);
    try { await cancelarPedido(job); await resultado.refetch(); await qc.invalidateQueries({ queryKey: ["bolso"] }); }
    catch (er) { setErro(erroDoBolso(er)); } finally { setEnviando(false); }
  };
  useEffect(() => {
    if (!job || !resultado.data || resultado.data.estado !== "concluido" || entregue.current === job) return;
    entregue.current = job;
    aoConcluir(resultado.data);
    void qc.invalidateQueries({ queryKey: ["bolso"] });
  }, [job, resultado.data, aoConcluir, qc]);
  const confirmar = async () => {
    if (tarifa === null || !valido || bloqueio || enviando || pendente) return;
    setEnviando(true); setErro(null);
    try {
      const pedido = await pedirCriativo(campanha, natureza, formato, chave, tarifa, entrada);
      setJob(pedido.job_id); setConfirmando(false); setChave(novaChave());
      void qc.invalidateQueries({ queryKey: ["bolso", "estado"] });
      void processar(pedido.job_id).then(() => qc.invalidateQueries({ queryKey: ["bolso"] }), () => { void qc.invalidateQueries({ queryKey: ["bolso", "criativo", pedido.job_id] }); });
    } catch (er) { setErro(erroDoBolso(er)); } finally { setEnviando(false); }
  };
  return <div className="space-y-3">
    {pendente ? <p role="status" className="bolso-criativo-status">{!conferir && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{conferir ? "Pedido registrado. Confira o andamento antes de tentar outro." : "Preparando seu pedido…"}</p> : confirmando ? <div className="bolso-confirmar" role="group" aria-label="Confirmar consumo de créditos"><p>Este pedido usa <strong>{tarifa} crédito{tarifa === 1 ? "" : "s"}</strong>. Você revisa o resultado antes de usar.</p><div className="flex gap-2"><button type="button" className="membros-acao bg-primary text-primary-foreground" disabled={enviando || !valido} onClick={() => void confirmar()}><Check size={15} aria-hidden="true" />Confirmar</button><button type="button" className="membros-acao" onClick={() => setConfirmando(false)}>Voltar</button></div></div> : <button type="button" className="membros-acao border border-border" disabled={!valido || !!bloqueio} onClick={() => setConfirmando(true)}><Sparkles size={16} aria-hidden="true" />{rotulo}{tarifa !== null && <span>· {tarifa} crédito{tarifa === 1 ? "" : "s"}</span>}</button>}
    {bloqueio && <p className="text-[12px] text-muted-foreground">{bloqueio}</p>}
    {(erro || resultado.isError || resultado.data?.estado === "falhou") && <p role="alert" className="text-[12px] text-destructive">{erro || (resultado.isError ? erroDoBolso(resultado.error) : resultado.data?.erro || "Não foi possível concluir o pedido.")}</p>}
    {conferir && job && <button type="button" className="membros-acao" disabled={resultado.isFetching} onClick={() => void resultado.refetch()}>Conferir pedido</button>}
    {resultado.data?.estado === "na_fila" && <button type="button" className="membros-acao" disabled={enviando} onClick={() => void cancelar()}>Cancelar pedido</button>}
  </div>;
}

export function CompletarOferta({ campanha, estado, aoCompletar, rascunhoAlterado = false }: { campanha: Campanha; estado: EstadoDoEstudio; aoCompletar: (briefing: Briefing) => void; rascunhoAlterado?: boolean }) {
  const [ideia, setIdeia] = useState("");
  const [aviso, setAviso] = useState("");
  const [proposta, setProposta] = useState<Briefing | null>(null);
  const recuperavel = [...campanha.jobs].filter((job) => job.natureza === "briefing" && ["concluido", "na_fila", "processando", "incerto"].includes(job.estado)).sort((a, b) => b.criado_em.localeCompare(a.criado_em))[0];
  if (!estado.recursos_criativos?.briefing && !recuperavel) return null;
  return <details className="bolso-recurso-criativo" open={!!recuperavel}><summary><Sparkles size={16} aria-hidden="true" />Completar com IA{recuperavel && <span className="text-[10px] text-muted-foreground">Histórico disponível</span>}</summary><div className="space-y-3"><label className="block space-y-2 text-[13px]"><span>Conte sua ideia</span><textarea aria-label="Conte sua ideia" className="membros-campo" value={ideia} maxLength={1500} rows={3} onChange={(e) => setIdeia(e.target.value)} placeholder="O que quer divulgar, para quem e com qual condição?" /><small className="text-muted-foreground">{ideia.length}/1500 caracteres</small></label><PedidoCriativo campanha={campanha.id} estado={estado} natureza="briefing" entrada={{ ideia }} rotulo="Preparar minha oferta" valido={!!ideia.trim() && ideia.length <= 1500 && !rascunhoAlterado} jobInicial={recuperavel?.id} podeCriar={!!estado.recursos_criativos?.briefing} aoConcluir={(r) => { if (r.briefing) { setProposta(r.briefing); setAviso("Sugestão pronta. Você pode trazê-la para os campos e revisar antes de salvar."); } }} />{rascunhoAlterado && <p className="text-[12px] text-muted-foreground">Salve suas alterações antes de pedir uma nova sugestão. Ao aplicar uma sugestão salva, os campos que você editou serão mantidos.</p>}{aviso && <p role="status" className="text-[12px] text-muted-foreground">{aviso}</p>}{proposta && <div className="space-y-3"><dl className="bolso-resumo-oferta bolso-assistente-revisao">{([["Produto", proposta.produto], ["Público", proposta.publico], ["Canal", proposta.canal], ["Diferencial", proposta.diferencial], ["Condições", proposta.condicoes], ["Chamada", proposta.cta]] as const).map(([nome, valor]) => <div key={nome}><dt>{nome}</dt><dd>{valor || "Não informado"}</dd></div>)}</dl><button type="button" className="membros-acao border border-border" onClick={() => aoCompletar(proposta)}>Aplicar sugestão nos campos</button></div>}</div></details>;
}

function Referencia({ referencia, aoRemover, removendo }: { referencia: ReferenciaCriativa; aoRemover: () => void; removendo: boolean }) {
  const imagem = useQuery({ queryKey: ["bolso", "referencia-url", referencia.id], queryFn: () => urlDaArte(referencia.caminho), staleTime: 45_000, retry: false });
  return <li className="bolso-referencia"><div>{imagem.data ? <img src={imagem.data} alt={`Referência: ${referencia.nome}`} /> : <ImagePlus size={18} aria-hidden="true" />}</div><span title={referencia.nome}>{referencia.nome}</span><button type="button" className="membros-acao" disabled={removendo} onClick={aoRemover} aria-label={`Remover referência ${referencia.nome}`}><Trash2 size={15} aria-hidden="true" /></button></li>;
}

export function ReferenciasDaCampanha({ campanha, aoMudar, aoOcupar }: { campanha: string; aoMudar: (ids: string[]) => void; aoOcupar: (ocupado: boolean) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const referencias = useQuery({ queryKey: ["bolso", "referencias", campanha, user?.id], enabled: !!user, queryFn: () => listarReferencias(campanha), retry: false });
  useEffect(() => { aoMudar(referencias.data?.map((r) => r.id) || []); }, [referencias.data, aoMudar]);
  useEffect(() => { aoOcupar(ocupado || referencias.isPending || referencias.isError); }, [ocupado, referencias.isPending, referencias.isError, aoOcupar]);
  const atualizar = () => qc.invalidateQueries({ queryKey: ["bolso", "referencias", campanha] });
  const enviar = async (arquivos: File[]) => {
    if (ocupado) return;
    setOcupado(true); setErro(null);
    try { for (const arquivo of arquivos) await enviarReferencia(campanha, arquivo); await atualizar(); }
    catch (er) { setErro(erroDoBolso(er)); await atualizar(); }
    finally { setOcupado(false); }
  };
  const remover = async (id: string) => {
    setOcupado(true); setErro(null);
    try { await removerReferencia(id); await atualizar(); } catch (er) { setErro(erroDoBolso(er)); } finally { setOcupado(false); }
  };
  return <details className="bolso-recurso-criativo"><summary><ImagePlus size={16} aria-hidden="true" />Fotos e referências{referencias.data?.length ? ` (${referencias.data.length})` : ""}</summary><div className="space-y-3"><label className="bolso-referencia-envio"><span>{ocupado ? "Atualizando referências…" : "Adicionar foto do produto ou referência"}</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={ocupado || referencias.isError} onChange={(e) => { void enviar(Array.from(e.target.files || [])); e.target.value = ""; }} /></label><p className="text-[12px] text-muted-foreground">PNG, JPG ou WEBP de até 5 MB. Use imagens que você tem autorização para enviar.</p>{referencias.data && <ul className="bolso-referencias">{referencias.data.map((r) => <Referencia key={r.id} referencia={r} removendo={ocupado} aoRemover={() => void remover(r.id)} />)}</ul>}{(erro || referencias.isError) && <p role="alert" className="text-[12px] text-destructive">{erro || erroDoBolso(referencias.error)}</p>}{referencias.isError && <button type="button" className="membros-acao" onClick={() => void referencias.refetch()}>Conferir referências</button>}</div></details>;
}

export function AjustarArte({ campanha, arte, formato, estado, aoConcluir }: { campanha: string; arte: string; formato: Formato; estado: EstadoDoEstudio; aoConcluir: () => void }) {
  const [ajuste, setAjuste] = useState("");
  if (!estado.recursos_criativos?.ajuste) return null;
  return <details className="bolso-recurso-criativo"><summary><Sparkles size={15} aria-hidden="true" />Pedir ajuste</summary><div className="space-y-3"><label className="block space-y-2"><span>O que você quer mudar nesta arte?</span><textarea className="membros-campo" rows={3} maxLength={1500} value={ajuste} onChange={(e) => setAjuste(e.target.value)} /><small className="text-muted-foreground">{ajuste.length}/1500 caracteres</small></label><PedidoCriativo campanha={campanha} estado={estado} natureza="ajuste" formato={formato} entrada={{ ajuste, arte_origem: arte }} rotulo="Criar arte ajustada" valido={!!ajuste.trim() && ajuste.length <= 1500} aoConcluir={() => { setAjuste(""); aoConcluir(); }} /></div></details>;
}
