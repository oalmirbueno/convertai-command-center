import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, RefreshCw, ScanSearch, X } from "lucide-react";
import { toast } from "sonner";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { conferirVersao, guardarEnsaio, invalidarFotos, partesDaConferencia, useEnsaios, useFotos } from "@/components/mesa-foto/fotoApi";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import { AvisoDoRascunho, CabecalhoDaEtapa, FontesDoProduto, MolduraDaFoto, RotuloLargo, SemCampanha, useMesaPublicidade } from "./Comuns";
import {
  avaliarRevisoes,
  decidirRevisao,
  FUNCOES_DAS_TOMADAS,
  podeAprovar,
  ROTULO_DA_MUDANCA,
  versoesDoEnsaio,
  type CampanhaDePublicidade,
  type RevisaoDePublicidade,
} from "./publicidadeApi";

/**
 * Passo 4: revisão com o produto antes da estética. Cada foto é comparada
 * com as fontes reais do produto pela conferência da Mesa Foto (visão). A
 * regra (regras.ts, avaliarRevisao) reprova quando muda logo, formato, cor
 * ou detalhe, mesmo bonita. O Jev só dá um aviso sobre as restrições do
 * briefing, nunca decide. Aprovar aqui aprova a versão na Mesa Foto (que
 * põe a foto no acervo); não aprova anúncio nem verba.
 */

const VEREDITO: Record<string, { rotulo: string; classe: string }> = {
  reprovada: { rotulo: "Produto mudou", classe: "bg-destructive/10 text-destructive" },
  produto_ok: { rotulo: "Produto conferido", classe: "bg-success/15 text-foreground" },
  nao_determinavel: { rotulo: "Não deu para saber", classe: "bg-warning/15 text-foreground" },
  sem_conferencia: { rotulo: "Sem conferência", classe: "bg-muted text-muted-foreground" },
};

const rotuloDaFuncao = (c: CampanhaDePublicidade, r: RevisaoDePublicidade) => {
  const t = c.tomadas.find((x) => x.foto_tomada_id === r.foto_tomada_id);
  return t ? (FUNCOES_DAS_TOMADAS.find((f) => f.id === t.funcao) || { rotulo: t.nome }).rotulo : "Foto";
};

function CartaoDaRevisao({ r }: { r: RevisaoDePublicidade }) {
  const { clientId } = useMesa();
  const { campanha, aplicar } = useMesaPublicidade();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [confirmo, setConfirmo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [fazendo, setFazendo] = useState<"aprovar" | "reprovar" | null>(null);
  if (!campanha) return null;
  const a = r.avaliacao;
  const v = VEREDITO[a.veredito] || VEREDITO.sem_conferencia;
  const pode = podeAprovar(a, confirmo);

  const decidir = async (decisao: "aprovar" | "reprovar") => {
    if (fazendo) return;
    setFazendo(decisao);
    try {
      const res = await decidirRevisao(campanha, { foto_tomada_id: r.foto_tomada_id, versao: r.versao, decisao, motivo: motivo.trim() || undefined, confirmo_produto: confirmo || undefined });
      aplicar(res.campanha);
      void queryClient.invalidateQueries({ queryKey: ["mesa-foto", "ensaios", clientId] });
      invalidarFotos(queryClient, clientId);
      toast.success(decisao === "aprovar" ? "Foto aprovada" : "Foto reprovada", {
        description: decisao === "aprovar" ? "Ela está no acervo e pode ir para as mesas. Anúncio e verba têm aprovação própria." : "A versão fica reprovada na Mesa Foto, com o motivo.",
      });
    } catch (e) {
      avisarErro(e, decisao === "aprovar" ? "Não aprovada" : "Não reprovada");
    } finally {
      setFazendo(null);
    }
  };

  return (
    <article className={juntar(superficie.painel, "min-w-0 p-4")} data-revisao={r.foto_tomada_id} data-veredito={a.veredito}>
      <div className="flex min-w-0 flex-wrap items-center">
        <p className="mr-2 min-w-0 truncate text-[13px] font-semibold">
          {rotuloDaFuncao(campanha, r)} <span className="font-normal text-muted-foreground">v{r.versao}</span>
        </p>
        <span className={juntar(etiqueta, "mr-1.5", v.classe)}>{v.rotulo}</span>
        {r.decisao && <span className={juntar(etiqueta, "bg-muted text-foreground")}>{r.decisao === "aprovada" ? "Aprovada" : "Reprovada"}</span>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <MolduraDaFoto caminho={r.storage_path} alt={`Foto gerada v${r.versao}`} rotulo="Gerada" />
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1")}>Fontes do produto</p>
          <FontesDaCampanha />
        </div>
      </div>
      {a.mudancas.length > 0 && <p className="mt-2 text-[12px] font-medium text-destructive">Mudou: {a.mudancas.map((m) => ROTULO_DA_MUDANCA[m]).join(", ")}.</p>}
      {a.motivos.length > 0 && (
        <ul className="mt-1 text-[12px] leading-snug text-muted-foreground">
          {a.motivos.slice(0, 4).map((m) => (
            <li key={m} className="[overflow-wrap:anywhere]">
              {m}
            </li>
          ))}
        </ul>
      )}
      {a.sem_evidencia.length > 0 && <p className="mt-1 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">Sem evidência para: {a.sem_evidencia.join(", ")}.</p>}
      {a.estetica.length > 0 && <p className="mt-1 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">Estética (depois do produto): {a.estetica.slice(0, 3).join("; ")}.</p>}
      {r.aviso_jev && r.aviso_jev.aviso && (
        <p className="mt-1 flex items-center text-[12px] text-warning" data-aviso-jev="">
          <span className="mr-1 min-w-0">
            Aviso do Jev: possível mudança numa restrição do briefing
            {r.aviso_jev.probabilidade !== null ? ` (${Math.round(r.aviso_jev.probabilidade * 100)}%)` : ""}.
          </span>
          <AjudaRecolhida rotulo="Sobre o aviso do Jev">É só aviso: olhe a foto ao lado das fontes. A decisão é da equipe.</AjudaRecolhida>
        </p>
      )}
      {r.decisao === "reprovada" && r.motivo && <p className="mt-1 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">Motivo: {r.motivo}</p>}
      {!r.decisao && (
        <div className="mt-3 border-t border-border pt-3">
          {a.veredito === "nao_determinavel" && (
            <label className="mb-2 flex items-start text-[12px]">
              <input type="checkbox" className="mr-1.5 mt-0.5" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />
              Olhei ao lado das fontes e o produto está igual.
            </label>
          )}
          <div className="flex min-w-0 items-center">
            <button type="button" className={juntar(botao.primario, "mr-2 h-8 px-3")} disabled={!pode.pode || !!fazendo} onClick={() => void decidir("aprovar")} title={pode.motivo || "Aprovar esta versão"}>
              {fazendo === "aprovar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
              Aprovar
            </button>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" maxLength={800} aria-label="Motivo da reprovação" className={juntar(campo, "mr-2 h-8 min-w-0 flex-1")} />
            <button type="button" className={juntar(botao.secundario, "h-8 px-3")} disabled={!!fazendo} onClick={() => void decidir("reprovar")}>
              {fazendo === "reprovar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1.5 h-3.5 w-3.5" />}
              Reprovar
            </button>
          </div>
          {!pode.pode && pode.motivo && <p className={juntar(texto.auxiliar, "mt-1.5 leading-5")}>{pode.motivo}</p>}
        </div>
      )}
    </article>
  );
}

function FontesDaCampanha() {
  const { clientId } = useMesa();
  const { campanha } = useMesaPublicidade();
  const fotos = useFotos(clientId);
  if (!campanha) return null;
  return <FontesDoProduto ids={campanha.produto_fontes} fotos={fotos.data || []} max={3} />;
}

export default function EtapaRevisao() {
  const { clientId, catalogo } = useMesa();
  const { campanha, banco, aplicar, irPara, pedirAoAgente } = useMesaPublicidade();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const ensaios = useEnsaios(clientId);
  const [atualizando, setAtualizando] = useState(false);
  if (!campanha) return <SemCampanha etapa="a revisão" />;
  const ensaio = campanha.ensaio_id ? (ensaios.data || []).find((e) => e.id === campanha.ensaio_id) || null : null;
  const versoes = ensaio ? versoesDoEnsaio(ensaio as unknown) : [];
  // Versões geradas ainda sem conferência com as fontes (a Mesa Foto confere, com visão).
  const semConferencia = ensaio
    ? ensaio.tomadas
        .map((t) => ({ t, v: t.versoes.length ? t.versoes[t.versoes.length - 1] : null }))
        .filter((x) => x.v && !x.v.conferencia && !x.v.aprovada && !x.v.rejeitada)
    : [];
  const revisaveis = versoes.filter((v) => v.versao > 0).length;
  const mudaram = campanha.revisoes.filter((r) => r.avaliacao.veredito === "reprovada" && !r.decisao).length;
  const aprovadas = campanha.revisoes.filter((r) => r.decisao === "aprovada").length;

  const atualizar = async () => {
    if (atualizando) return;
    setAtualizando(true);
    try {
      const r = await avaliarRevisoes(campanha);
      aplicar(r.campanha);
    } catch (e) {
      avisarErro(e, "Revisão não atualizada");
    } finally {
      setAtualizando(false);
    }
  };

  const ajuda = "Cada foto é comparada com as fontes reais do produto antes da estética. Mudou logo, formato, cor ou detalhe: reprovada, mesmo bonita. Aprovar põe a foto no acervo; não aprova anúncio nem verba.";

  if (!campanha.ensaio_id) {
    return (
      <div className="min-w-0 space-y-6" data-etapa-publicidade="revisao">
        <CabecalhoDaEtapa titulo="Revisão" ajuda={ajuda} />
        <EstadoVazio
          icone={<ScanSearch className="h-5 w-5" />}
          titulo="Peça as tomadas à Mesa Foto antes."
          acao={
            <button type="button" className={botao.secundario} onClick={() => irPara("tomadas")}>
              Ir para as tomadas
            </button>
          }
        />
      </div>
    );
  }

  const n = campanha.revisoes.length;
  return (
    <div className="min-w-0 space-y-6" data-etapa-publicidade="revisao">
      <CabecalhoDaEtapa
        titulo="Revisão"
        ajuda={ajuda}
        estado={n ? `${n} ${n === 1 ? "foto" : "fotos"} · ${aprovadas} ${aprovadas === 1 ? "aprovada" : "aprovadas"}${mudaram ? ` · ${mudaram} com o produto mudado` : ""}` : "Produto antes da estética"}
        acoes={
          <>
            {mudaram > 0 && (
              <button type="button" className={botao.secundario} onClick={() => pedirAoAgente("Reprove as fotos que mudaram o produto.")} aria-label={`Reprovar as ${mudaram} que mudaram o produto`}>
                <X className="h-3.5 w-3.5" />
                <span className="ml-1.5 sm:hidden">Reprovar {mudaram}</span>
                <RotuloLargo>Reprovar as {mudaram} que mudaram o produto</RotuloLargo>
              </button>
            )}
            <button type="button" className={botao.secundario} disabled={atualizando || !revisaveis} onClick={() => void atualizar()} aria-label="Atualizar a revisão">
              {atualizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <RotuloLargo>Atualizar a revisão</RotuloLargo>
            </button>
            {aprovadas > 0 && (
              <button type="button" className={botao.primario} onClick={() => irPara("envio")} aria-label="Seguir para o envio">
                <ArrowRight className="h-3.5 w-3.5" />
                <RotuloLargo>Seguir para o envio</RotuloLargo>
              </button>
            )}
          </>
        }
      />
      {!banco && <AvisoDoRascunho />}
      {semConferencia.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center rounded-md bg-primary/5 px-3 py-2" data-conferir="">
          <p className="mr-2 min-w-0 flex-1 text-[12.5px] font-medium">
            {semConferencia.length} {semConferencia.length === 1 ? "foto sem conferência" : "fotos sem conferência"} com as fontes
          </p>
          <AjudaRecolhida className="mr-2" rotulo="Sobre a conferência">
            A conferência é da Mesa Foto (leitura das imagens lado a lado). Sem ela, não dá para aprovar.
          </AjudaRecolhida>
          <BotaoComCusto
            rotulo={
              <>
                <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
                Conferir com as fontes
              </>
            }
            titulo="Fotos conferidas"
            className="h-8"
            partes={() => partesDaConferencia(catalogo).map((p) => ({ ...p, vezes: semConferencia.length }))}
            executar={async () => {
              let custo = 0;
              for (const x of semConferencia) {
                try {
                  const r = await conferirVersao(ensaio!.id, x.t.id, x.v!.versao);
                  custo += Number(r.custo_usd) || 0;
                  if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
                } catch (e) {
                  avisarErro(e, `Não conferida: ${x.t.nome}`);
                }
              }
              const r = await avaliarRevisoes(campanha);
              aplicar(r.campanha);
              custo += Number(r.bruto && r.bruto.custo_usd) || 0;
              return { custo_usd: custo };
            }}
          />
        </div>
      )}
      {campanha.revisoes.length ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2" data-revisoes="">
          {campanha.revisoes
            .slice()
            .sort((x, y) => (x.decisao ? 1 : 0) - (y.decisao ? 1 : 0))
            .map((r) => (
              <CartaoDaRevisao key={`${r.foto_tomada_id}:${r.versao}`} r={r} />
            ))}
        </div>
      ) : (
        <EstadoVazio
          compacto
          titulo={revisaveis ? "Fotos prontas para ler." : "Nenhuma foto gerada ainda."}
          descricao={revisaveis ? "Clique em Atualizar a revisão." : "Gere as tomadas na etapa anterior ou na Mesa Foto."}
        />
      )}
    </div>
  );
}
