import { useState } from "react";
import { Link2, Loader2, Play, Trash2, Unlink, X } from "lucide-react";
import { botao, campo, juntar, texto } from "@/components/sistema";
import { TIPOS_DE_NO, type CanvasDoLab, type NoDoLab, type TravaDoNoAr } from "@/lib/laboratorio/nos";
import type { ExecucaoDoLab } from "@/lib/laboratorio/api";
import CamposDoNo from "./CamposDoNo";
import ResultadoDoNo, { EstadoDoNo, emAndamento } from "./ResultadoDoNo";
import { IconeDoNo } from "./icones";
import BlocosSemFonte, { type ResolverBloco } from "./BlocosSemFonte";
import SeletorDeGatilho from "./SeletorDeGatilho";
import IntegracaoDeVendas from "./no/IntegracaoDeVendas";
import ConexoesDaCasa from "./no/ConexoesDaCasa";

/**
 * Inspetor do nó selecionado: os campos do tipo (texto, modelo, motor,
 * proporção, quantidade, formato de copy, operador do agente externo...),
 * as ligações (com a mensagem clara quando não pode ligar), tirar o nó e
 * o "Rodar" (que abre o custo antes).
 */

export default function Inspetor({
  canvas,
  no,
  projetoId,
  execucao,
  rodando,
  onMudarDados,
  onLigar,
  onDesligar,
  onRemover,
  onRodar,
  onGerarTudoDaBase,
  onFechar,
  avisoDeLigacao,
  onEscolherStoryboard,
  escolhendo = null,
  trava = null,
  onResolverBloco,
  clienteId = null,
  onMudarGatilho,
  antesDeChamar,
  clientes = [],
}: {
  canvas: CanvasDoLab;
  no: NoDoLab;
  projetoId: string;
  /** Cliente do projeto: o seletor de documentos abre no Workspace dele. */
  clienteId?: string | null;
  execucao: ExecucaoDoLab | undefined;
  rodando: boolean;
  /** Filme: escolher o storyboard (filme_escolher). */
  onEscolherStoryboard?: (indice: number) => void;
  escolhendo?: number | null;
  onMudarDados: (dados: Record<string, unknown>) => void;
  /** Tenta ligar; devolve o motivo quando não pode. */
  onLigar: (de: string, para: string) => string | null;
  onDesligar: (ligacaoId: string) => void;
  onRemover: () => void;
  onRodar: () => void;
  onGerarTudoDaBase: () => void;
  onFechar?: () => void;
  avisoDeLigacao: string | null;
  /** Pôr no ar: travado por bloco de prova ou número sem fonte antes dele (travaDoNoAr). */
  trava?: TravaDoNoAr | null;
  /** Fonte confirmada ou edição de um bloco sem fonte (bloco_resolver). */
  onResolverBloco?: ResolverBloco;
  /** v4: escolher o gatilho do fio que sai deste nó (vazio tira). */
  onMudarGatilho?: (ligacaoId: string, gatilho: string | null) => void;
  antesDeChamar?: () => Promise<void>;
  clientes?: Array<{ id: string; nome: string }>;
}) {
  const def = TIPOS_DE_NO[no.tipo];
  const [motivo, setMotivo] = useState<string | null>(null);
  const saidas = canvas.ligacoes.filter((l) => l.de === no.id);
  const entradas = canvas.ligacoes.filter((l) => l.para === no.id);
  const nome = (id: string) => {
    const n = canvas.nos.find((x) => x.id === id);
    return n ? `${TIPOS_DE_NO[n.tipo].rotulo} ${canvas.nos.filter((x) => x.tipo === n.tipo).indexOf(n) + 1}` : "?";
  };
  const outros = canvas.nos.filter((n) => n.id !== no.id);
  const aviso = motivo || avisoDeLigacao;

  return (
    <div className="min-w-0 space-y-3" data-inspetor={no.id}>
      <div className="flex min-w-0 items-center">
        <span className="mr-2 inline-flex shrink-0" style={{ color: def.cor }}>
          <IconeDoNo tipo={no.tipo} />
        </span>
        <h3 className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>{nome(no.id)}</h3>
        {execucao ? <EstadoDoNo status={execucao.status} /> : null}
        {onFechar && (
          <button type="button" className={juntar(botao.icone, "ml-1")} onClick={onFechar} aria-label="Fechar o inspetor" title="Fechar o inspetor">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {no.tipo === "crm" || no.tipo === "area_membros" ? <ConexoesDaCasa no={no} acoes={{ projetoId, clienteId, clientes, antesDeChamar: antesDeChamar || (() => Promise.resolve()), mudarDados: (_id, dados) => onMudarDados(dados) }} /> : null}
      <CamposDoNo no={no} projetoId={projetoId} clienteId={clienteId} onMudarDados={onMudarDados} lugar="inspetor" grande pular={no.tipo === "crm" ? ["crm_origem", "produto_crm_id"] : no.tipo === "area_membros" ? ["produto_membros_id"] : undefined} />
      {/* v4: o webhook de vendas do gateway do cliente (o checkout só mede o clique sem ele). */}
      {no.tipo === "checkout" ? <IntegracaoDeVendas clienteId={clienteId || null} gateway={String(no.dados.gateway || "")} /> : null}
      {no.tipo === "por_no_ar" ? (
        <p className={texto.auxiliar} data-regra-no-ar="" title="Aprove em Precisa de você. Verba e ativação ficam com você. Acesso a Facebook, Instagram e Google só pelo Conectar, nunca por senha.">
          Nada vai ao ar sem a sua aprovação. Anúncio sobe pausado.
        </p>
      ) : null}

      <div className="min-w-0">
        <label htmlFor="ligar-a" className={juntar(texto.rotulo, "mb-1 flex items-center")}>
          <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Ligar a
        </label>
        <select
          id="ligar-a"
          className={campo}
          value=""
          onChange={(e) => {
            const para = e.target.value;
            if (!para) return;
            const m = onLigar(no.id, para);
            setMotivo(m);
          }}
        >
          <option value="">Escolha o nó que recebe</option>
          {outros.map((n) => (
            <option key={n.id} value={n.id}>
              {nome(n.id)}
            </option>
          ))}
        </select>
        {aviso ? (
          <p role="alert" className={juntar(texto.auxiliar, "mt-1 text-warning")} data-aviso-de-ligacao="">
            {aviso}
          </p>
        ) : null}
      </div>

      {(entradas.length > 0 || saidas.length > 0) && (
        <ul className="min-w-0 space-y-1" aria-label="Ligações do nó">
          {entradas.map((l) => (
            <li key={l.id} className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
              <span className="min-w-0 flex-1 truncate">Recebe de {nome(l.de)}</span>
              <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onDesligar(l.id)} aria-label={`Desligar de ${nome(l.de)}`} title="Desligar">
                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          {saidas.map((l) => (
            <li key={l.id} className={juntar(texto.auxiliar, "min-w-0")}>
              <div className="flex min-w-0 items-center">
                <span className="min-w-0 flex-1 truncate">Manda para {nome(l.para)}</span>
                <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onDesligar(l.id)} aria-label={`Desligar de ${nome(l.para)}`} title="Desligar">
                  <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              {/* v4: o gatilho do fio do funil (página, checkout, quiz, webinar, teste A/B). */}
              {onMudarGatilho ? <SeletorDeGatilho ligacao={l} tipoDaOrigem={no.tipo} id={`gatilho-${l.id}`} onMudar={(g) => onMudarGatilho(l.id, g)} /> : null}
            </li>
          ))}
        </ul>
      )}

      {trava && trava.travado && onResolverBloco ? <BlocosSemFonte blocos={trava.blocos} motivo={trava.motivo} onResolver={onResolverBloco} /> : null}

      <ResultadoDoNo execucao={execucao} compacto={false} tipo={no.tipo} onEscolherStoryboard={onEscolherStoryboard} escolhendo={escolhendo} />
      {execucao && execucao.status === "pronto" && onResolverBloco ? (
        <BlocosSemFonte blocos={execucao.saida.rascunho_sem_fonte.map((b) => ({ ...b, no_id: no.id }))} onResolver={onResolverBloco} />
      ) : null}

      <div className="flex min-w-0 items-center border-t border-border pt-3">
        {def.roda && (
          <button type="button" className={juntar(botao.primario, "h-8 px-3")} onClick={onRodar} disabled={rodando || emAndamento(execucao && execucao.status) || !!(trava && trava.travado)} data-rodar-no={no.id} title={trava && trava.travado ? trava.motivo : no.tipo === "por_no_ar" ? "Cria o pedido de aprovação (mostra o custo antes)" : "Mostra o custo antes de rodar"}>
            {rodando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {no.tipo === "por_no_ar" ? "Pedir aprovação" : "Rodar"}
          </button>
        )}
        {no.tipo === "gravity" && (
          <button type="button" className={juntar(botao.secundario, "h-8 px-3")} onClick={onGerarTudoDaBase} disabled={rodando}>
            Gerar tudo
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className={juntar(botao.icone, "hover:text-destructive")} onClick={onRemover} aria-label="Tirar o nó do quadro" title="Tirar o nó do quadro">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
