import { useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, ImageOff, MessageCircle, MonitorSmartphone } from "lucide-react";
import MesaDeDecisao, { type DecisaoDaMesa, type ItemDaMesa } from "@/components/decisao/MesaDeDecisao";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import { callReviewRpc, useCentralReviews } from "@/hooks/useCentralReviews";
import { chamarAviso, useAvisosDePublicacao } from "@/hooks/useAvisosDePublicacao";
import { useFotosDosClientes } from "@/hooks/useFotosDosClientes";
import { useResolvedFileUrl } from "@/lib/fileUrls";
import { centralReviewError, reviewAlerts, reviewContentComplete, reviewDecisionArgs } from "@/lib/centralReview";
import type { CentralApproval, ReviewClient, ReviewDecision, ReviewReport } from "@/lib/centralReview";
import { erroDoAviso, faseDoAviso, quando, type AvisoDePublicacao } from "@/lib/avisoDePublicacao";
import { SERVICE_LABELS } from "@/lib/cycleDefs";

/*
 * Mesa da Revisão do Ciclo (15/10/2026): o que espera a SUA decisão, um por
 * vez, num cartão grande. Rituais preparados (central_review_decide, com a
 * versão e o hash exatos) e avisos de post no ar (aviso_publicacao_decidir).
 * Aprovar não envia; o envio continua registrado à parte, com prova.
 */

const RITUAL: Record<string, string> = { rota_semana: "Rota da semana", meio_semana: "Meio da semana", prova_movimento: "Prova de movimento" };
const MAPA: Record<Exclude<DecisaoDaMesa, "adiado">, ReviewDecision> = { aprovado: "aprovado", ajuste: "alteracoes_pedidas", rejeitado: "rejeitado" };

function ImagemDoPost({ aviso }: { aviso: AvisoDePublicacao }) {
  const arq = aviso.publicacao?.arquivo ?? null;
  const { url } = useResolvedFileUrl({ fileUrl: arq?.file_url ?? null, storageBucket: arq?.storage_bucket ?? null, storagePath: arq?.storage_path ?? null });
  const video = (arq?.mime_type || "").startsWith("video/");
  if (!arq || !url) return <div className="flex aspect-[4/5] max-h-[40vh] w-full items-center md:max-h-none justify-center text-muted-foreground"><ImageOff className="h-8 w-8" aria-hidden="true" /></div>;
  return video
    ? <video src={url} muted playsInline controls preload="metadata" className="aspect-[4/5] max-h-[40vh] w-full bg-black object-contain md:max-h-none" />
    : <img src={url} alt={aviso.payload.publication?.title || "Post"} className="aspect-[4/5] max-h-[40vh] w-full object-cover md:max-h-none" loading="lazy" />;
}

export default function MesaDaRevisao({ reports, clients, isAdmin, clientId = "" }: {
  reports: readonly ReviewReport[]; clients: readonly (ReviewClient & { avatar_url?: string | null })[]; isAdmin: boolean; clientId?: string;
}) {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const pedidos = useCentralReviews(isAdmin, null);
  const avisos = useAvisosDePublicacao(isAdmin);
  const clientesParaFoto = useMemo(() => clients.map((c) => ({ id: c.id, nome: c.company_name || c.full_name || null, avatar_url: c.avatar_url ?? null })), [clients]);
  const { fotosDe } = useFotosDosClientes(clientesParaFoto);
  const chaves = useRef(new Map<string, string>());
  const chave = (c: string) => { let k = chaves.current.get(c); if (!k) { k = crypto.randomUUID(); chaves.current.set(c, k); } return k; };
  const nomeDe = (id: string) => { const c = clients.find((x) => x.id === id); return c?.company_name || c?.full_name || "Cliente"; };
  const avatarDe = (id: string) => { const c = clientesParaFoto.find((x) => x.id === id); const nome = c?.nome || "Cliente"; return <FotoDoCliente nome={nome} fotos={c ? fotosDe(c) : null} tamanho="sm" />; };

  // Origem de cada cartão, para decidir pelo RPC certo.
  const origem = useRef(new Map<string, { tipo: "ritual"; approval: CentralApproval } | { tipo: "aviso"; aviso: AvisoDePublicacao }>());

  const itens: ItemDaMesa[] = useMemo(() => {
    const out: ItemDaMesa[] = [];
    const mapa = new Map<string, { tipo: "ritual"; approval: CentralApproval } | { tipo: "aviso"; aviso: AvisoDePublicacao }>();
    const agora = Date.now();
    // Pedidos de ritual: só o último por relatório, pendente, na versão atual do rascunho e no prazo.
    const vistos = new Set<string>();
    for (const a of pedidos.data ?? []) {
      if (vistos.has(a.report_id)) continue;
      vistos.add(a.report_id);
      if (clientId && a.client_id !== clientId) continue;
      if (!["pendente", "adiado"].includes(a.status) || a.executed_at) continue;
      if (a.valid_until && Date.parse(a.valid_until) <= agora) continue;
      const atual = reports.find((r) => r.id === a.report_id);
      if (!atual || atual.status !== "draft" || atual.review_version !== a.payload_version) continue;
      const r = a.payload.report;
      const alertas = reviewAlerts(r);
      const destino = a.payload.destination;
      const scope = a.payload.scope;
      const id = `ritual:${a.id}`;
      mapa.set(id, { tipo: "ritual", approval: a });
      out.push({
        id, tipo: `Ritual · ${RITUAL[String(r.metrics?.ritual_type ?? "")] ?? "Mensagem"}`, tomDoTipo: "primario",
        cliente: nomeDe(a.client_id), avatar: avatarDe(a.client_id), titulo: r.title,
        mensagem: r.summary || null, passo: r.next_steps || null,
        sinais: [
          { icone: destino.channel === "whatsapp" ? <MessageCircle className="h-3 w-3" /> : <MonitorSmartphone className="h-3 w-3" />, texto: destino.channel === "whatsapp" ? `WhatsApp · ${destino.recipient}` : "Portal do cliente" },
          ...(alertas.length ? [{ icone: <AlertTriangle className="h-3 w-3" />, texto: `${alertas.length} ${alertas.length === 1 ? "ponto de atenção" : "pontos de atenção"}`, tom: "aviso" as const }] : []),
          ...(a.valid_until ? [{ icone: <CalendarClock className="h-3 w-3" />, texto: `vale até ${quando(a.valid_until)}` }] : []),
        ],
        detalhes: <dl className="space-y-1.5">
          {alertas.length > 0 && <div><dt className="font-medium text-warning">Pontos de atenção</dt><dd><ul className="list-disc pl-4">{alertas.map((x, i) => <li key={i}>{x}</li>)}</ul></dd></div>}
          <div><dt className="inline font-medium text-foreground/80">Plano: </dt><dd className="inline">{scope?.plan_name || "não registrado"}{scope?.service_keys?.length ? ` · ${scope.service_keys.map((k) => SERVICE_LABELS[k] ?? k).join(" · ")}` : ""}</dd></div>
          <div><dt className="inline font-medium text-foreground/80">Base: </dt><dd className="inline">dossiê v{String(a.payload.source?.dossier_version ?? "?")} · versão {a.payload_version} do texto</dd></div>
        </dl>,
        bloqueioDeAprovar: reviewContentComplete(r) ? null : "Falta a mensagem ou o próximo passo: peça ajuste.",
        podeAjuste: true, podeRejeitar: true, rejeitarPedeMotivo: true,
      });
    }
    // Avisos de post no ar pendentes.
    for (const v of avisos.data ?? []) {
      if (clientId && v.client_id !== clientId) continue;
      if (faseDoAviso(v, agora) !== "decidir") continue;
      const post = v.payload.publication ?? {};
      const id = `aviso:${v.id}`;
      mapa.set(id, { tipo: "aviso", aviso: v });
      out.push({
        id, tipo: `Post no ar${post.platform ? ` · ${post.platform}` : ""}`, tomDoTipo: "aviso",
        cliente: nomeDe(v.client_id), avatar: avatarDe(v.client_id), titulo: post.title || "Publicação",
        midia: <ImagemDoPost aviso={v} />,
        mensagem: v.mensagem,
        sinais: [
          { icone: v.destino.channel === "whatsapp" ? <MessageCircle className="h-3 w-3" /> : <MonitorSmartphone className="h-3 w-3" />, texto: v.destino.channel === "whatsapp" ? `WhatsApp · ${v.destino.recipient}` : "Portal do cliente" },
          { icone: <CalendarClock className="h-3 w-3" />, texto: `no ar desde ${quando(post.published_at)}` },
        ],
        detalhes: post.permalink ? <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline-offset-2 hover:underline">{post.permalink}</a> : null,
        podeAjuste: true, podeRejeitar: true, rejeitarPedeMotivo: true,
      });
    }
    origem.current = mapa;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos.data, avisos.data, reports, clients, clientId, fotosDe]);

  const decidir = async (item: ItemDaMesa, decisao: DecisaoDaMesa, nota: string) => {
    const o = origem.current.get(item.id);
    if (!o || decisao === "adiado") return false;
    try {
      if (o.tipo === "ritual") {
        const d = MAPA[decisao];
        await callReviewRpc("central_review_decide", reviewDecisionArgs(o.approval, d, nota, chave(JSON.stringify(["mesa", o.approval.id, o.approval.payload_hash, d, nota]))));
        await queryClient.invalidateQueries({ queryKey: ["central-review-approvals"] });
        queryClient.invalidateQueries({ queryKey: ["aprovacoes-explicadas"] });
      } else {
        // O aviso só conhece aprovar e rejeitar: o ajuste vira rejeição com o pedido escrito (libera um aviso novo).
        const d = decisao === "aprovado" ? "aprovado" : "rejeitado";
        const comentario = decisao === "ajuste" ? `Ajuste: ${nota}` : nota;
        await chamarAviso("aviso_publicacao_decidir", { _aviso_id: o.aviso.id, _expected_payload_hash: o.aviso.payload_hash, _decision: d, _comment: comentario || null, _idempotency_key: chave(JSON.stringify(["mesa", o.aviso.id, o.aviso.payload_hash, d, comentario])) });
        await queryClient.invalidateQueries({ queryKey: ["avisos-de-publicacao"] });
      }
      toast.success(decisao === "aprovado" ? "Aprovado. Nada foi enviado ainda." : decisao === "ajuste" ? "Ajuste pedido." : "Rejeitado.");
      return true;
    } catch (e) {
      toast.error(o.tipo === "ritual" ? centralReviewError(e) : erroDoAviso(e));
      return false;
    }
  };

  if (!isAdmin) return null;
  const foco = params.get("review") ? `ritual:${params.get("review")}` : params.get("aviso") ? `aviso:${params.get("aviso")}` : null;
  return <MesaDeDecisao rotulo="Para decidir" itens={itens} onDecidir={decidir} inicialId={foco && itens.some((i) => i.id === foco) ? foco : null}
    vazio="Quando chegar um ritual ou um aviso de post para aprovar, ele aparece aqui." />;
}
