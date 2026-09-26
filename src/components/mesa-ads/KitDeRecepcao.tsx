import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, ChevronDown, Copy, HandCoins, Loader2, MessageCircle, ShieldAlert, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta } from "@/lib/mesa/api";
import { chavesAds, normalizarPlano, type Angulo, type PlanoAds } from "./adsApi";
import {
  gerarKit,
  kitDoAngulo,
  mandarKitParaAgenda,
  partesDoKit,
  proximoDiaUtil,
  roteiroComercialEmTexto,
  tirarKitDaAgenda,
  type KitDeRecepcao as Kit,
} from "./acoesDoAgenteApi";

/**
 * Kit de recepção do ângulo (pedido do dono em 25/09: "o post é o que a gente
 * vai fazer para receber esse cliente... o post entende a parte comercial de
 * vendas... complemente ali na parte do ad"). Quem clica no anúncio olha o
 * perfil e chama na conversa: o kit deixa os dois coerentes com a promessa do
 * ângulo. Post de recepção (vai para a agenda da Mesa com confirmação),
 * ajustes do perfil e o roteiro comercial para WhatsApp ou Direct (primeira
 * resposta, qualificação, objeções do briefing, fechamento e follow-up).
 */

async function copiar(texto: string, rotulo: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${rotulo} copiado`);
  } catch {
    toast.error("Não foi possível copiar", { description: "Selecione o texto e copie à mão." });
  }
}

function Nota({ rotulo, nota }: { rotulo: string; nota: number | null }) {
  if (nota === null) return null;
  const tom = nota >= 7 ? "bg-success/10 text-success" : nota >= 5 ? "bg-warning/15 text-warning" : "bg-destructive/10 text-destructive";
  return <span className={`mb-1 mr-1.5 rounded-full px-2 py-0.5 text-[10.5px] ${tom}`}>{rotulo} {nota.toFixed(1).replace(".", ",")}</span>;
}

function Bloco({ titulo, icone, children, acao }: { titulo: string; icone: ReactNode; children: ReactNode; acao?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-background p-2.5">
      <div className="mb-1 flex min-w-0 flex-wrap items-center">
        <p className="mr-2 flex items-center text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {icone}
          {titulo}
        </p>
        {acao && <span className="ml-auto">{acao}</span>}
      </div>
      {children}
    </section>
  );
}

/** O post de recepção para a agenda da Mesa: mostra o que entra e só grava no Confirmar. */
function PostNaAgenda({ plano, angulo, kit, onPlano }: { plano: PlanoAds; angulo: Angulo; kit: Kit; onPlano: (p: PlanoAds) => void }) {
  const { clientId } = useMesa();
  const avisarErro = useAvisarErro();
  const [armado, setArmado] = useState(false);
  const [data, setData] = useState(proximoDiaUtil());
  const [fazendo, setFazendo] = useState(false);

  const aplicar = (resposta: any) => {
    if (resposta && resposta.plano) onPlano(normalizarPlano(resposta.plano));
  };

  const confirmar = async () => {
    setFazendo(true);
    try {
      const r = await mandarKitParaAgenda(plano.id, angulo.id, data);
      aplicar(r);
      setArmado(false);
      toast.success("Post de recepção na agenda", { description: `Dia ${dataCurta(data)}. A arte sai no Estúdio da Mesa, como os outros posts.` });
    } catch (e) {
      avisarErro(e, "O post não entrou na agenda");
    } finally {
      setFazendo(false);
    }
  };

  const desfazer = async () => {
    if (!kit.agenda) return;
    setFazendo(true);
    try {
      aplicar(await tirarKitDaAgenda(clientId, plano.id, angulo.id, kit.agenda.task_id));
      toast.success("Post tirado da agenda", { description: "Dá para mandar de novo quando quiser." });
    } catch (e) {
      avisarErro(e, "Não foi possível tirar da agenda");
    } finally {
      setFazendo(false);
    }
  };

  if (kit.agenda) {
    return (
      <span className="flex min-w-0 flex-wrap items-center">
        <span className="mb-1 mr-2 inline-flex items-center rounded-full bg-success/15 px-2.5 py-1 text-[11.5px]">
          <Check className="mr-1 h-3 w-3" /> Na agenda em {dataCurta(kit.agenda.data)}
        </span>
        <Button type="button" size="sm" variant="ghost" className="mb-1 h-7 text-[11.5px]" disabled={fazendo} onClick={() => void desfazer()}>
          {fazendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1 h-3.5 w-3.5" />}
          Desfazer
        </Button>
      </span>
    );
  }
  if (!armado) {
    return (
      <Button type="button" size="sm" variant="outline" className="h-7 text-[11.5px]" onClick={() => setArmado(true)}>
        <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Mandar para a agenda
      </Button>
    );
  }
  return (
    <div className="mt-1 w-full min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-2 text-[12px]" role="group" aria-label="Confirmar o post na agenda">
      <p className="[overflow-wrap:anywhere]">
        Vai entrar na agenda da Mesa: <span className="font-medium">{kit.post.titulo || `Recepção: ${angulo.nome}`}</span> ({kit.post.formato === "estatico" ? "post estático" : kit.post.formato === "reels" ? "reels" : "carrossel"}, {kit.post.roteiro.length} {kit.post.roteiro.length === 1 ? "card" : "cards"}), com a legenda e o roteiro.
      </p>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
        <label className="mb-1 mr-2 inline-flex items-center text-[11.5px] text-muted-foreground">
          <span className="mr-1.5">Dia</span>
          <Input type="date" aria-label="Dia do post de recepção" value={data} onChange={(e) => setData(e.target.value)} className="h-8 w-[150px] text-[12px]" />
        </label>
        <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" disabled={fazendo || !data} onClick={() => void confirmar()}>
          {fazendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          Confirmar
        </Button>
        <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" disabled={fazendo} onClick={() => setArmado(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** O kit na tela. */
function KitNaTela({ plano, angulo, kit, onPlano }: { plano: PlanoAds; angulo: Angulo; kit: Kit; onPlano: (p: PlanoAds) => void }) {
  const c = kit.comercial;
  const legenda = [kit.post.legenda, kit.post.cta].filter(Boolean).join("\n\n");
  return (
    <div className="min-w-0 space-y-2">
      {kit.promessa_do_anuncio && (
        <p className="text-[12.5px] leading-snug [overflow-wrap:anywhere]">
          <span className="font-medium">Promessa do anúncio:</span> {kit.promessa_do_anuncio}
        </p>
      )}
      {kit.conferencia && (
        <div className="flex min-w-0 flex-wrap items-center">
          <Nota rotulo="Post confirma a promessa" nota={kit.conferencia.post_confirma} />
          <Nota rotulo="Roteiro fiel à oferta" nota={kit.conferencia.roteiro_fiel} />
          <Nota rotulo="Política (10 é sem risco)" nota={kit.conferencia.risco_politica} />
          {kit.conferencia.alerta && (
            <span className="mb-1 inline-flex items-center text-[11px] text-warning">
              <ShieldAlert className="mr-1 h-3.5 w-3.5" /> Revise antes de usar
            </span>
          )}
          {kit.conferencia.jev_erro && <span className="mb-1 text-[11px] text-muted-foreground">O Jev não conferiu desta vez.</span>}
        </div>
      )}

      <Bloco
        titulo="Post de recepção"
        icone={<CalendarPlus className="mr-1 h-3.5 w-3.5 text-primary" />}
        acao={<PostNaAgenda plano={plano} angulo={angulo} kit={kit} onPlano={onPlano} />}
      >
        <p className="text-[12.5px] font-semibold [overflow-wrap:anywhere]">{kit.post.titulo}</p>
        {kit.post.gancho && <p className="text-[12px] text-muted-foreground [overflow-wrap:anywhere]">Gancho: {kit.post.gancho}</p>}
        {kit.post.roteiro.length > 0 && (
          <ol className="ml-4 mt-1 list-decimal space-y-0.5 text-[12px] leading-snug">
            {kit.post.roteiro.map((r) => (
              <li key={r.ordem} className="[overflow-wrap:anywhere]">
                {r.texto}
                {r.visual && <span className="text-muted-foreground"> · {r.visual}</span>}
              </li>
            ))}
          </ol>
        )}
        {legenda && (
          <div className="mt-1.5 rounded-md bg-muted/60 p-2 text-[12px] leading-snug">
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{legenda}</p>
            <button type="button" className="mt-1 inline-flex items-center text-[11.5px] font-medium text-primary hover:underline" onClick={() => void copiar(legenda, "Legenda")}>
              <Copy className="mr-1 h-3 w-3" /> Copiar legenda
            </button>
          </div>
        )}
        {kit.post.por_que_recebe && <p className="mt-1 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">Por que recebe quem veio do anúncio: {kit.post.por_que_recebe}</p>}
        {kit.perfil.length > 0 && (
          <div className="mt-1.5 text-[12px]">
            <p className="font-medium">Ajustes no perfil</p>
            <ul className="ml-4 list-disc">{kit.perfil.map((p, k) => <li key={k} className="[overflow-wrap:anywhere]">{p}</li>)}</ul>
          </div>
        )}
      </Bloco>

      <Bloco
        titulo={`Atendimento e vendas (${c.canal})`}
        icone={<MessageCircle className="mr-1 h-3.5 w-3.5 text-primary" />}
        acao={
          <button type="button" className="inline-flex items-center text-[11.5px] font-medium text-primary hover:underline" onClick={() => void copiar(roteiroComercialEmTexto(kit), "Roteiro de atendimento")}>
            <Copy className="mr-1 h-3 w-3" /> Copiar roteiro
          </button>
        }
      >
        <div className="space-y-1.5 text-[12px] leading-snug">
          {c.primeira_resposta && (
            <p className="[overflow-wrap:anywhere]">
              <span className="font-medium">1. Primeira resposta:</span> {c.primeira_resposta}
            </p>
          )}
          {c.perguntas_qualificacao.length > 0 && (
            <div>
              <p className="font-medium">2. Perguntas para qualificar (uma por vez)</p>
              <ul className="ml-4 list-disc">{c.perguntas_qualificacao.map((p, k) => <li key={k} className="[overflow-wrap:anywhere]">{p}</li>)}</ul>
            </div>
          )}
          {c.objecoes.length > 0 && (
            <div>
              <p className="font-medium">3. Objeções</p>
              <ul className="space-y-1">
                {c.objecoes.map((o, k) => (
                  <li key={k} className="min-w-0 rounded-md bg-muted/60 px-2 py-1 [overflow-wrap:anywhere]">
                    <span className="font-medium">{o.objecao}</span>
                    {o.fonte === "briefing" && <span className="ml-1.5 rounded bg-primary/10 px-1 text-[10px] text-primary">do briefing</span>}
                    <span className="block text-muted-foreground">{o.resposta}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.oferta_e_fechamento && (
            <p className="[overflow-wrap:anywhere]">
              <span className="font-medium">4. Oferta e fechamento:</span> {c.oferta_e_fechamento}
            </p>
          )}
          {c.follow_up.length > 0 && (
            <div>
              <p className="font-medium">5. Follow-up</p>
              <ul className="ml-4 list-disc">{c.follow_up.map((f, k) => <li key={k} className="[overflow-wrap:anywhere]">{f.quando ? `${f.quando}: ` : ""}{f.mensagem}</li>)}</ul>
            </div>
          )}
        </div>
      </Bloco>

      {kit.lacunas.length > 0 && (
        <p className="text-[11.5px] text-warning [overflow-wrap:anywhere]">Falta confirmar: {kit.lacunas.join("; ")}.</p>
      )}
    </div>
  );
}

/**
 * Kit de recepção de um ângulo do plano. `compacto` (Plano de teste): só o
 * botão, que abre o kit ali mesmo.
 */
export default function KitDeRecepcao({ plano, angulo, compacto = false }: { plano: PlanoAds; angulo: Angulo; compacto?: boolean }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(!compacto);
  const kit = kitDoAngulo(angulo);

  const atualizarPlano = (p: PlanoAds) => {
    queryClient.setQueryData(chavesAds.planos(clientId), (l: PlanoAds[] | undefined) => (l || []).map((x) => (x.id === p.id ? p : x)));
    void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
  };

  const botaoGerar = (
    <BotaoComCusto
      rotulo={<><HandCoins className="mr-1 h-3.5 w-3.5" /> {kit ? "Refazer o kit" : "Criar kit de recepção"}</>}
      titulo="Kit de recepção"
      descricao="O post que recebe quem veio do anúncio e o roteiro de atendimento e vendas no WhatsApp ou Direct, a partir da oferta e das objeções do briefing. O Jev confere se tudo confirma a promessa do anúncio."
      variant={kit ? "ghost" : "outline"}
      className="h-7 text-[11.5px]"
      partes={() => partesDoKit(catalogo, 1)}
      executar={() => gerarKit(plano.id, angulo.id)}
      aoConcluir={(data) => {
        atualizarCusto();
        if (data && data.plano) atualizarPlano(normalizarPlano(data.plano));
        setAberto(true);
      }}
    />
  );

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-3" aria-label={`Kit de recepção: ${angulo.nome}`}>
      <div className="flex min-w-0 flex-wrap items-center">
        <button type="button" className="mb-1 mr-2 flex min-w-0 flex-1 items-center text-left" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
          <HandCoins className="mr-1.5 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">Kit de recepção{compacto ? "" : `: ${angulo.nome}`}</span>
            <span className="block text-[11.5px] text-muted-foreground">
              {kit ? `Post de recepção e roteiro de vendas prontos${kit.agenda ? `, post na agenda em ${dataCurta(kit.agenda.data)}` : ""}.` : "O post e o atendimento que recebem quem clica neste anúncio."}
            </span>
          </span>
          {kit && <ChevronDown className={`ml-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />}
        </button>
        <span className="mb-1">{botaoGerar}</span>
      </div>
      {kit && aberto && (
        <div className="mt-2">
          <KitNaTela plano={plano} angulo={angulo} kit={kit} onPlano={atualizarPlano} />
          {compacto && (
            <button type="button" className="mt-1 inline-flex items-center text-[11.5px] text-muted-foreground hover:text-foreground" onClick={() => setAberto(false)}>
              <X className="mr-1 h-3 w-3" /> Fechar
            </button>
          )}
        </div>
      )}
    </section>
  );
}
