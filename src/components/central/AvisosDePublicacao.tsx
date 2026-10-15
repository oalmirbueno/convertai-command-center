import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AjudaRecolhida, EstadoDeErro, Secao, botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import { erroDoAviso, faseDoAviso, quando, vencido, type AvisoDePublicacao } from "@/lib/avisoDePublicacao";

/*
 * Aviso de post no ar na Revisão do Ciclo (14/10/2026). Mesmo rito dos rituais:
 * o aviso chega preparado (texto, link e destino congelados), o dono aprova ou
 * rejeita aqui ou pelo Hermes, e quem envia registra o envio com evidência.
 * Aprovar não envia. Tabela própria (aviso_publicacao), só administrador lê.
 */

type Reply<T> = { data: T | null; error: { message: string } | null };
const banco = supabase as unknown as {
  from: (t: "aviso_publicacao") => { select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<Reply<AvisoDePublicacao[]>> } } };
  rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<Reply<unknown>>;
};

function useAvisosDePublicacao(ativo: boolean) {
  return useQuery({
    queryKey: ["avisos-de-publicacao"], enabled: ativo, refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await banco.from("aviso_publicacao")
        .select("*, client:profiles!aviso_publicacao_client_id_fkey(company_name,full_name)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

async function chamar(nome: string, args: Record<string, unknown>) {
  const { data, error } = await banco.rpc(nome, args);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("O servidor não confirmou a operação. Atualize antes de tentar de novo.");
  return data;
}

export default function AvisosDePublicacao({ isAdmin, clientId = "" }: { isAdmin: boolean; clientId?: string }) {
  const [params] = useSearchParams();
  const foco = params.get("aviso");
  const queryClient = useQueryClient();
  const query = useAvisosDePublicacao(isAdmin);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const chaves = useRef(new Map<string, string>());
  const chave = (comando: string) => { let k = chaves.current.get(comando); if (!k) { k = crypto.randomUUID(); chaves.current.set(comando, k); } return k; };
  const rodar = async (id: string, acao: () => Promise<unknown>, sucesso: string) => {
    if (ocupado) return false;
    setOcupado(id);
    try { await acao(); await queryClient.invalidateQueries({ queryKey: ["avisos-de-publicacao"] }); toast.success(sucesso); return true; }
    catch (e) { toast.error(erroDoAviso(e)); return false; }
    finally { setOcupado(null); }
  };
  const decidir = (a: AvisoDePublicacao, decisao: "aprovado" | "rejeitado", comentario: string) => rodar(a.id, () => chamar("aviso_publicacao_decidir", {
    _aviso_id: a.id, _expected_payload_hash: a.payload_hash, _decision: decisao, _comment: comentario.trim() || null,
    _idempotency_key: chave(JSON.stringify(["decidir", a.id, a.payload_hash, decisao, comentario.trim()])),
  }), decisao === "aprovado" ? "Aviso aprovado. Nada foi enviado." : "Aviso rejeitado.");
  const marcarEnviado = (a: AvisoDePublicacao, evidencia: string) => rodar(a.id, () => chamar("aviso_publicacao_marcar_enviado", {
    _aviso_id: a.id, _evidence: evidencia.trim(), _idempotency_key: chave(JSON.stringify(["enviado", a.id, evidencia.trim()])),
  }), "Envio registrado.");

  if (!isAdmin) return null;
  // Front publicado antes da migration: a tabela ainda não existe e a seção simplesmente não aparece.
  if (query.error && /PGRST205|42P01|does not exist|schema cache/i.test(query.error.message)) return null;
  const agora = Date.now();
  const doCliente = (query.data ?? []).filter(a => !clientId || a.client_id === clientId);
  const decidirLista = doCliente.filter(a => faseDoAviso(a, agora) === "decidir" || a.id === foco && a.status === "pendente");
  const enviarLista = doCliente.filter(a => faseDoAviso(a, agora) === "enviar");
  const historico = doCliente.filter(a => faseDoAviso(a, agora) === "historico" && !decidirLista.includes(a));
  if (!query.error && decidirLista.length + enviarLista.length + historico.length === 0) return null;

  return <section aria-label="Avisos de post no ar" className="min-w-0">
    <Secao
      titulo="Avisos de post no ar"
      descricao={`${decidirLista.length} esperando decisão · ${enviarLista.length} aprovado${enviarLista.length === 1 ? "" : "s"} a enviar`}
      ajuda={<>Quando um post vai ao ar, a equipe ou o Hermes prepara uma mensagem curta para o cliente com o link. Aqui você confere o post, o texto e o destino e aprova ou rejeita. Aprovar não envia: quem enviar registra o envio com a evidência. O Hermes vê e faz o mesmo pelo MCP.</>}
    >
      {query.error && <EstadoDeErro titulo="Não foi possível carregar os avisos." descricao={query.error.message} className="mb-3" />}
      {(decidirLista.length > 0 || enviarLista.length > 0) && <div className="divide-y divide-border border-y border-border">
        {[...decidirLista, ...enviarLista].map(a => <LinhaDoAviso key={`${a.id}:${a.status}:${a.executed_at ?? ""}`} aviso={a} focado={a.id === foco} ocupado={ocupado === a.id} travado={!!ocupado} agora={agora} onDecidir={decidir} onEnviado={marcarEnviado} />)}
      </div>}
      {historico.length > 0 && <details className="mt-3 text-[13px]"><summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">Últimos 7 dias ({historico.length})</summary>
        <ul className="mt-2 space-y-1.5">{historico.map(a => <li key={a.id} className={juntar(texto.auxiliar, "min-w-0")}>
          <span className="font-medium text-foreground">{a.client?.company_name || a.client?.full_name || "Cliente"}</span> · {a.payload.publication?.title || "publicação"} · {a.executed_at ? `enviado ${quando(a.executed_at)}: ${a.execution_evidence ?? ""}` : a.status === "rejeitado" ? `rejeitado: ${a.decision_note ?? ""}` : a.status === "expirado" || vencido(a, agora) ? "venceu sem decisão" : a.status}
        </li>)}</ul>
      </details>}
    </Secao>
  </section>;
}

function LinhaDoAviso({ aviso: a, focado, ocupado, travado, agora, onDecidir, onEnviado }: {
  aviso: AvisoDePublicacao; focado: boolean; ocupado: boolean; travado: boolean; agora: number;
  onDecidir: (a: AvisoDePublicacao, d: "aprovado" | "rejeitado", c: string) => Promise<boolean>;
  onEnviado: (a: AvisoDePublicacao, e: string) => Promise<boolean>;
}) {
  const [conferido, setConferido] = useState(false);
  const [comentario, setComentario] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const post = a.payload.publication ?? {};
  const cliente = a.client?.company_name || a.client?.full_name || "Cliente";
  const fase = faseDoAviso(a, agora);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(a.mensagem); toast.success("Mensagem aprovada copiada."); }
    catch { toast.error("Não foi possível copiar a mensagem."); }
  };
  return <article className={juntar("min-w-0 space-y-3 py-4", focado && "rounded-md bg-primary/5 px-3")} aria-label={`Aviso de post de ${cliente}`}>
    <header className="min-w-0">
      <p className={juntar(texto.auxiliar, "truncate")}>{cliente} · {post.platform || "rede"} · no ar desde {quando(post.published_at)}{a.preparado_via !== "painel" ? ` · preparado por ${a.preparado_via.replace(/^agente:/, "")}` : ""}</p>
      <h3 className={juntar(texto.tituloSecao, "mt-1 min-w-0 truncate")} title={post.title}>{post.title || "Publicação"}</h3>
      <p className={juntar("mt-0.5 text-[12px] font-medium", fase === "enviar" ? "text-primary" : vencido(a, agora) ? "text-destructive" : "text-warning")}>
        {fase === "enviar" ? "Aprovado · envio não registrado" : vencido(a, agora) ? "Venceu · prepare outro aviso" : `Esperando decisão · vale até ${quando(a.valid_until)}`}
      </p>
    </header>
    {post.permalink && <a href={post.permalink} target="_blank" rel="noopener noreferrer" className={juntar(texto.corpo, "block truncate text-primary underline-offset-2 hover:underline")}>{post.permalink}</a>}
    <p className={juntar(texto.corpo, "whitespace-pre-wrap")}>{a.mensagem}</p>
    <p className={texto.corpo}><strong className="font-medium">Destino congelado:</strong> {a.destino.channel === "portal" ? "Portal do cliente" : "WhatsApp"}{a.destino.channel === "whatsapp" ? ` · ${a.destino.recipient}` : ""}</p>
    {fase === "decidir" && <div className="space-y-2">
      <label className="flex items-start text-[13px]"><input type="checkbox" checked={conferido} onChange={e => setConferido(e.target.checked)} className="mr-2 mt-0.5 h-4 w-4 shrink-0 accent-primary" />Conferi o post, o link, o texto e o destino.</label>
      <label className={juntar(texto.rotulo, "block")}>Motivo (para rejeitar)<textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={2} maxLength={4000} className={juntar(campoTexto, "mt-1.5 min-h-[60px]")} /></label>
      <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
        <button type="button" disabled={travado || !conferido} onClick={() => void onDecidir(a, "aprovado", comentario)} className={botao.primario}>{ocupado ? "Registrando…" : "Aprovar aviso"}</button>
        <button type="button" disabled={travado || !comentario.trim()} onClick={() => void onDecidir(a, "rejeitado", comentario)} className={botao.secundario}>Rejeitar</button>
        <AjudaRecolhida rotulo="O que acontece ao aprovar">Aprovar só libera o envio. Quem enviar (você ou o Hermes) registra aqui com a evidência.</AjudaRecolhida>
      </div>
    </div>}
    {fase === "enviar" && <div className="space-y-2">
      <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
        <button type="button" onClick={() => void copiar()} className={botao.secundario}>Copiar mensagem aprovada</button>
        {a.destino.channel === "whatsapp" && <a href={`https://wa.me/?text=${encodeURIComponent(a.mensagem)}`} target="_blank" rel="noopener noreferrer" className={botao.secundario}>Abrir no WhatsApp</a>}
      </div>
      <div className="flex min-w-0 flex-col sm:flex-row sm:items-end">
        <label className={juntar(texto.rotulo, "block min-w-0 flex-1")}>Evidência do envio<input value={evidencia} onChange={e => setEvidencia(e.target.value)} placeholder="Ex.: enviado no grupo do cliente hoje às 10h15" className={juntar(campo, "mt-1.5")} /></label>
        <button type="button" disabled={travado || evidencia.trim().length < 3} onClick={() => void onEnviado(a, evidencia)} className={juntar(botao.primario, "mt-2 sm:ml-2 sm:mt-0")}>{ocupado ? "Registrando…" : "Marcar como enviado"}</button>
      </div>
    </div>}
  </article>;
}
