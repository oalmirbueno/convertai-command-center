import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronUp, Lightbulb, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro } from "@/lib/mesa/api";
import { AjudaRecolhida, botao, juntar, superficie, texto } from "@/components/sistema";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { useModeloDoEscopo } from "./ModeloDaCopyDoConteudo";
import type { Campanha, ItemProposto } from "./mesaV4Api";
import { aplicarRespostaDaCampanha } from "./campanhasApi";
import { ajustarRoteiroComAgente, criarRoteiroComAgente, opcoesDaPeca, partesDoAgenteDeRoteiro } from "./agenteDeRoteiroApi";
import type { RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import {
  CRIATIVIDADES_DO_ROTEIRO,
  DURACOES_DO_ROTEIRO,
  ESTILOS_DO_ROTEIRO,
  rotuloDaDuracao,
  type CriatividadeDoRoteiro,
  type EstiloDoRoteiro,
} from "../../../supabase/functions/agente-calendario/modulos/agente-de-roteiro";

/**
 * Agente de roteiro na peça de vídeo da campanha (23/10/2026, dono: "o agente onde eu dou a ideia do roteiro
 * e ele já faz, quantos minutos e tudo, ele fica para selecionar ali dentro mesmo ... completo com cenas ...
 * até dar sugestão, participar junto com ultra criatividade").
 *
 * - Sem roteiro (ou "Novo roteiro"): a ideia, a duração, o estilo e a criatividade; "Criar roteiro" (custo antes)
 *   traz duas versões completas, o Jev marca a recomendada e "Usar esta" grava a escolhida na peça.
 * - Com roteiro: "Pedir ao agente" ajusta o roteiro aberto (as sugestões dele viram pedido num toque); o ajuste
 *   volta como edição, para salvar ou desfazer na própria peça.
 */

export interface PropsDoAgenteDeRoteiro {
  campanha: Campanha;
  propostaId: string;
  item: ItemProposto;
  /** O roteiro aberto (com o que a pessoa editou e ainda não salvou). */
  roteiro: RoteiroDeVideo | null;
  /** A versão escolhida: a peça grava (sem custo). */
  aoEscolher: (r: RoteiroDeVideo) => Promise<void>;
  /** O ajuste do agente: a peça mostra como edição (salvar ou desfazer). */
  aoAjustar: (r: RoteiroDeVideo) => void;
}

function Opcao({ ativo, onClick, children, rotulo }: { ativo: boolean; onClick: () => void; children: ReactNode; rotulo?: string }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      aria-label={rotulo}
      onClick={onClick}
      className={juntar(botao.barra, "border", ativo ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border")}
    >
      {children}
    </button>
  );
}

export default function AgenteDeRoteiro({ campanha, item, roteiro, aoEscolher, aoAjustar }: PropsDoAgenteDeRoteiro) {
  const { clientId, catalogo } = useMesa();
  const qc = useQueryClient();
  const modeloDaCopy = useModeloDoEscopo("copy");
  const opcoes = opcoesDaPeca(item);
  const [criando, setCriando] = useState(!roteiro);
  const [ideia, setIdeia] = useState(opcoes ? opcoes.ideia : "");
  const [duracao, setDuracao] = useState(opcoes ? opcoes.duracao : roteiro ? roteiro.duracao : 30);
  const [estilo, setEstilo] = useState<EstiloDoRoteiro>(opcoes ? opcoes.estilo : "viral");
  const [criatividade, setCriatividade] = useState<CriatividadeDoRoteiro>(opcoes ? opcoes.criatividade : "ultra");
  const [aberta, setAberta] = useState<number | null>(null);
  const [verVersoes, setVerVersoes] = useState(!roteiro);
  const [pedido, setPedido] = useState("");
  const [resposta, setResposta] = useState("");
  const [escolhendo, setEscolhendo] = useState<number | null>(null);
  const tema = item.tema || "o vídeo";
  const temaId = item.tema_id || "";

  const escolher = async (k: number) => {
    if (!opcoes) return;
    setEscolhendo(k);
    try {
      await aoEscolher(opcoes.versoes[k]);
      setCriando(false);
      setVerVersoes(false);
    } catch (e) {
      toast.error("Roteiro não salvo", { description: textoDoErro(e) });
    } finally {
      setEscolhendo(null);
    }
  };

  const formulario = (
    <div className="min-w-0 space-y-2" data-agente-de-roteiro="criar">
      <Textarea
        value={ideia}
        onChange={(e) => setIdeia(e.target.value)}
        rows={3}
        placeholder="Sua ideia, do jeito que vier. Ex.: o técnico abre um PC que parece novo e acha uma floresta de poeira"
        className="text-[13px]"
        aria-label={`Ideia do roteiro de ${tema}`}
      />
      <div className="min-w-0">
        <span className={texto.rotulo}>Duração</span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Duração do vídeo">
          {DURACOES_DO_ROTEIRO.map((d) => (
            <Opcao key={d.segundos} ativo={duracao === d.segundos} onClick={() => setDuracao(d.segundos)}>{d.rotulo}</Opcao>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <span className={texto.rotulo}>Estilo</span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Estilo do roteiro">
          {ESTILOS_DO_ROTEIRO.map((e) => (
            <Opcao key={e.id} ativo={estilo === e.id} onClick={() => setEstilo(e.id)}>{e.rotulo}</Opcao>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <span className={texto.rotulo}>Criatividade</span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Criatividade do agente">
          {CRIATIVIDADES_DO_ROTEIRO.map((c) => (
            <Opcao key={c.id} ativo={criatividade === c.id} onClick={() => setCriatividade(c.id)}>
              {c.id === "ultra" && <Lightbulb className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
              {c.rotulo}
            </Opcao>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {roteiro && (
          <button type="button" className="text-[12px] text-muted-foreground hover:underline" onClick={() => setCriando(false)}>
            Cancelar
          </button>
        )}
        <BotaoComCusto
          rotulo="Criar roteiro"
          titulo="Agente de roteiro"
          descricao={`Duas versões completas de ${rotuloDaDuracao(duracao)} (cenas, câmera, fala, texto na tela, som, trilha e CTA) e a recomendada pelo Jev`}
          partes={() => partesDoAgenteDeRoteiro(catalogo, modeloDaCopy.modeloId, "criar", duracao)}
          executar={async () => {
            const res = await criarRoteiroComAgente({ campanhaId: campanha.id, temaId, ideia: ideia.trim(), duracao, estilo, criatividade, corpoDoModelo: modeloDaCopy.corpoEscolhido });
            aplicarRespostaDaCampanha(qc, clientId, res);
            setVerVersoes(true);
            setAberta(null);
            return res;
          }}
          className="h-8 px-3"
        />
      </div>
    </div>
  );

  const versoes = opcoes && verVersoes && (
    <ol className="min-w-0" aria-label={`Versões do agente para ${tema}`} data-versoes-do-agente={opcoes.versoes.length}>
      {opcoes.versoes.map((v, k) => {
        const recomendada = k === opcoes.recomendada && opcoes.versoes.length > 1;
        return (
          <li key={k} className="min-w-0 border-t border-border py-2 first:border-t-0 first:pt-0" data-versao={k + 1} data-recomendada={recomendada ? "sim" : "nao"}>
            <div className="flex min-w-0 items-start gap-2">
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1 text-[13px] font-medium">
                  <span className="truncate">{v.titulo || `Versão ${k + 1}`}</span>
                  {recomendada && (
                    <span className="inline-flex shrink-0 items-center text-[11px] font-medium text-primary" title={opcoes.porque || "O Jev recomenda"}>
                      <Star className="mr-0.5 h-3 w-3" aria-hidden="true" />
                      Recomendada
                    </span>
                  )}
                </span>
                {v.conceito && <span className="block text-[12px] leading-4 text-muted-foreground">{v.conceito}</span>}
                <span className="block text-[11px] text-muted-foreground">{v.cenas.length} cenas · {rotuloDaDuracao(v.duracao)} · gancho: {v.gancho}</span>
              </span>
              <button type="button" className={botao.icone} onClick={() => setAberta(aberta === k ? null : k)} aria-expanded={aberta === k} aria-label={`${aberta === k ? "Fechar" : "Ver"} as cenas da versão ${k + 1}`} title="Ver as cenas">
                {aberta === k ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
              </button>
              <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => void escolher(k)} disabled={escolhendo !== null} aria-label={`Usar a versão ${k + 1}`}>
                {escolhendo === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : "Usar esta"}
              </button>
            </div>
            {aberta === k && (
              <ol className="mt-2 min-w-0 space-y-1.5" aria-label={`Cenas da versão ${k + 1}`}>
                {v.cenas.map((c) => (
                  <li key={c.ordem} className="min-w-0 text-[12px] leading-4">
                    <span className="font-medium">Cena {c.ordem} · {c.segundos}s</span>
                    <span className="block text-foreground">{c.descricao}</span>
                    {c.plano && <span className="block text-muted-foreground">Câmera: {c.plano}</span>}
                    {c.fala && <span className="block">Fala: “{c.fala}”</span>}
                    {c.texto_na_tela && <span className="block text-muted-foreground">Na tela: {c.texto_na_tela}</span>}
                    {c.som && <span className="block text-muted-foreground">Som: {c.som}</span>}
                  </li>
                ))}
                {v.cta && <li className="text-[12px] leading-4"><span className="font-medium">CTA:</span> {v.cta}</li>}
                {v.trilha && <li className="text-[12px] leading-4 text-muted-foreground">Trilha: {v.trilha}</li>}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );

  const conversa = roteiro && !criando && (
    <div className="min-w-0 space-y-2" data-agente-de-roteiro="ajustar">
      {roteiro.sugestoes && roteiro.sugestoes.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1" role="group" aria-label="Sugestões do agente">
          {roteiro.sugestoes.map((s, k) => (
            <button key={k} type="button" className={juntar(botao.barra, "h-auto min-h-8 whitespace-normal border border-border py-1 text-left")} onClick={() => setPedido(s)} title="Usar como pedido ao agente">
              <Lightbulb className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <Input
          value={pedido}
          onChange={(e) => setPedido(e.target.value)}
          placeholder="Peça ao agente: mais engraçado, abertura mais forte, menos fala..."
          className="h-8 min-w-0 flex-1 text-[13px]"
          aria-label={`Pedido ao agente sobre o roteiro de ${tema}`}
        />
        <BotaoComCusto
          rotulo="Ajustar"
          titulo="Agente de roteiro"
          descricao="O agente aplica o pedido no roteiro inteiro e traz sugestões novas; o ajuste volta para você salvar ou desfazer"
          partes={() => partesDoAgenteDeRoteiro(catalogo, modeloDaCopy.modeloId, "ajustar", roteiro.duracao)}
          disabled={!pedido.trim()}
          executar={async () => {
            const res = await ajustarRoteiroComAgente({ campanhaId: campanha.id, temaId, roteiro, pedido: pedido.trim(), duracao: roteiro.duracao, criatividade, corpoDoModelo: modeloDaCopy.corpoEscolhido });
            aplicarRespostaDaCampanha(qc, clientId, res);
            if (res && res.roteiro) {
              aoAjustar(res.roteiro);
              setResposta(res.resposta || "");
              setPedido("");
            }
            return res;
          }}
          variant="outline"
          className="h-8 px-3"
        />
      </div>
      {resposta && <p className={juntar(texto.auxiliar, "whitespace-normal")} data-resposta-do-agente="">{resposta}</p>}
    </div>
  );

  return (
    <section className={juntar(superficie.poco, "min-w-0 space-y-3 p-3")} aria-label={`Agente de roteiro de ${tema}`} data-agente-de-roteiro-da-peca={temaId}>
      <div className="flex min-w-0 items-center gap-2">
        <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[13px] font-medium">Agente de roteiro</span>
        <AjudaRecolhida rotulo="Como o agente funciona">
          Dê a ideia, a duração, o estilo e a criatividade. O agente escreve duas versões completas, com cenas, câmera, fala, texto na tela, som, trilha e CTA, e o Jev marca a recomendada. Escolha uma em Usar esta. Depois, converse com ele para ajustar: as sugestões viram pedido num toque.
        </AjudaRecolhida>
        {opcoes && !verVersoes && (
          <button type="button" className={botao.barra} onClick={() => setVerVersoes(true)} aria-label="Ver as versões do agente">
            Versões ({opcoes.versoes.length})
          </button>
        )}
        {roteiro && !criando && (
          <button type="button" className={botao.barra} onClick={() => setCriando(true)}>
            Novo roteiro
          </button>
        )}
      </div>
      {criando && formulario}
      {versoes}
      {conversa}
    </section>
  );
}
