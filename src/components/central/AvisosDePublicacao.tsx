import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { chamarAviso as chamar, useAvisosDePublicacao } from "@/hooks/useAvisosDePublicacao";
import { ChevronDown } from "lucide-react";
import { AjudaRecolhida, EstadoDeErro, Secao, botao, campo, campoTexto, foco as focoDeTeclado, juntar, texto } from "@/components/sistema";
import { erroDoAviso, faseDoAviso, quando, vencido, type AvisoDePublicacao } from "@/lib/avisoDePublicacao";

/*
 * Aviso de post no ar na Revisão do Ciclo (14/10/2026). Mesmo rito dos rituais:
 * o aviso chega preparado (texto, link e destino congelados), o dono aprova ou
 * rejeita aqui ou pelo Hermes, e quem envia registra o envio com evidência.
 * Aprovar não envia. Tabela própria (aviso_publicacao), só administrador lê.
 */

/** semDecidir: a decisão fica na mesa de decisão; aqui só o envio do que foi aprovado e o histórico. */
export default function AvisosDePublicacao({ isAdmin, clientId = "", semDecidir = false }: { isAdmin: boolean; clientId?: string; semDecidir?: boolean }) {
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
  const decidirLista = semDecidir ? [] : doCliente.filter(a => faseDoAviso(a, agora) === "decidir" || a.id === foco && a.status === "pendente");
  const enviarLista = doCliente.filter(a => faseDoAviso(a, agora) === "enviar");
  const historico = doCliente.filter(a => faseDoAviso(a, agora) === "historico" && !decidirLista.includes(a) && !(semDecidir && a.status === "pendente" && !vencido(a, agora)));
  if (!query.error && decidirLista.length + enviarLista.length + historico.length === 0) return null;

  return <section aria-label="Avisos de post no ar" className="min-w-0">
    <Secao
      titulo="Avisos de post no ar"
      descricao={semDecidir ? `${enviarLista.length} aprovado${enviarLista.length === 1 ? "" : "s"} a enviar` : `${decidirLista.length} esperando decisão · ${enviarLista.length} aprovado${enviarLista.length === 1 ? "" : "s"} a enviar`}
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
  const [aberto, setAberto] = useState(focado);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(a.mensagem); toast.success("Mensagem aprovada copiada."); }
    catch { toast.error("Não foi possível copiar a mensagem."); }
  };
  const situacao = fase === "enviar" ? "Aprovado · envio não registrado" : vencido(a, agora) ? "Venceu · prepare outro aviso" : `Esperando decisão · vale até ${quando(a.valid_until)}`;
  // Linha fechada como os pedidos da revisão: título, cliente e situação; abre ao tocar.
  return <article className="min-w-0" aria-label={`Aviso de post de ${cliente}`}>
    <button type="button" aria-expanded={aberto} onClick={() => setAberto(!aberto)} className={juntar("flex w-full min-w-0 items-center px-1 py-3 text-left transition-colors hover:bg-muted/40", focoDeTeclado)}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-foreground" title={post.title}>{post.title || "Publicação"}</span>
        <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{cliente} · {post.platform || "rede"} · <span className={fase === "enviar" ? "text-primary" : vencido(a, agora) ? "text-destructive" : "text-warning"}>{situacao}</span></span>
      </span>
      <ChevronDown className={juntar("ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} aria-hidden="true" />
    </button>
    {aberto && <div className="min-w-0 space-y-3 pb-5 pl-1 pr-1 pt-1">
    <p className={texto.auxiliar}>No ar desde {quando(post.published_at)}{a.preparado_via !== "painel" ? ` · preparado por ${a.preparado_via.replace(/^agente:/, "")}` : ""}</p>
    {post.permalink && <a href={post.permalink} target="_blank" rel="noopener noreferrer" className={juntar(texto.corpo, "block truncate text-primary underline-offset-2 hover:underline")}>{post.permalink}</a>}
    <p className={juntar(texto.corpo, "max-w-[72ch] whitespace-pre-wrap")}>{a.mensagem}</p>
    <p className={texto.auxiliar}>Destino: {a.destino.channel === "portal" ? "Portal do cliente" : "WhatsApp"}{a.destino.channel === "whatsapp" ? ` · ${a.destino.recipient}` : ""}</p>
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
    </div>}
  </article>;
}
