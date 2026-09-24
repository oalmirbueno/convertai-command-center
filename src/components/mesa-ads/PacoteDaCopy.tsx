import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Package, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import {
  baixarTexto,
  CAMPOS_DO_GESTOR,
  chamarAds,
  chavesAds,
  copiarTexto,
  CTAS_DO_META,
  LIMITE_DESCRICAO,
  LIMITE_TITULO,
  nomeDeArquivo,
  normalizarPacote,
  pacoteEmMarkdown,
  partesDoPacote,
  rotuloDoCta,
  rotuloDoEstilo,
  type CopyDoAnuncio,
  type CriativoAds,
  type PacoteDeCopy,
} from "./adsApi";
import { Andamento, BotaoCopiar, useAndamento } from "./Comuns";

/**
 * Pacote completo de copy de um criativo (copy_pacote): textos principais por
 * estilo, títulos (até 40), descrições (até 30), CTAs com o porquê, ganchos e
 * a orientação ao gestor de tráfego. Copiar item, copiar tudo, baixar .md e
 * "Enviar ao gestor de tráfego" (pacote_enviar, com tarefa opcional). "Usar"
 * leva o texto para o formulário do anúncio.
 */

/**
 * O pacote de um criativo na resposta de copy_pacote:
 * { pacotes: [{ criativo_id, pacote }], criativo (linha com copy.pacote), pendentes, falhas }.
 */
export function pacoteDaResposta(data: any, criativoId: string): PacoteDeCopy | null {
  if (!data || typeof data !== "object") return null;
  if (data.pacote) return normalizarPacote(data.pacote);
  const lista = ([] as any[]).concat(Array.isArray(data.pacotes) ? data.pacotes : [], Array.isArray(data.criativos) ? data.criativos : []);
  const achado = lista.find((c: any) => c && String(c.criativo_id || c.id) === criativoId);
  if (achado) return normalizarPacote(achado.pacote || (achado.copy && achado.copy.pacote));
  if (data.criativo && data.criativo.copy && data.criativo.copy.pacote) return normalizarPacote(data.criativo.copy.pacote);
  return null;
}

function Contagem({ atual, limite }: { atual: number; limite: number }) {
  return (
    <span className={`shrink-0 text-[10.5px] tabular-nums ${atual > limite ? "font-medium text-warning" : "text-muted-foreground"}`} aria-label={`${atual} de ${limite} caracteres`}>
      {atual}/{limite}
    </span>
  );
}

function Grupo({ titulo, children, contagem }: { titulo: string; children: ReactNode; contagem: number }) {
  if (!contagem) return null;
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
        {titulo} ({contagem})
      </p>
      {children}
    </div>
  );
}

function BotaoUsar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="h-7 shrink-0 rounded-md px-2 text-[11.5px] font-medium text-primary hover:bg-primary/10">
      Usar
    </button>
  );
}

/** Enviar o pacote ao gestor: vira arquivo em Arquivos e, se marcado, tarefa para ele. */
export function EnvioAoGestor({ corpo, rotulo = "Enviar ao gestor de tráfego", className = "" }: { corpo: () => Record<string, unknown>; rotulo?: string; className?: string }) {
  const { clientId } = useMesa();
  const avisarErro = useAvisarErro();
  const [criarTarefa, setCriarTarefa] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setEnviando(true);
    try {
      const data = await chamarAds<any>("pacote_enviar", { client_id: clientId, ...corpo(), criar_tarefa: criarTarefa });
      const tarefa = data && data.tarefa_id;
      const aviso = data && typeof data.aviso === "string" && data.aviso ? ` ${data.aviso}` : "";
      toast.success("Pacote enviado", {
        description: `Salvo em Arquivos, em Criativos de anúncio.${tarefa ? " Tarefa aberta para o gestor de tráfego." : ""}${aviso}`,
      });
    } catch (e) {
      avisarErro(e, "Pacote não enviado");
    } finally {
      setEnviando(false);
    }
  };
  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center ${className}`}>
      <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-8" disabled={enviando} onClick={() => void enviar()}>
        {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
        {rotulo}
      </Button>
      <label className="mb-1 inline-flex items-center text-[11.5px] text-muted-foreground">
        <input type="checkbox" checked={criarTarefa} onChange={(e) => setCriarTarefa(e.target.checked)} className="mr-1.5 h-3.5 w-3.5 accent-primary" />
        criar tarefa para o gestor
      </label>
    </span>
  );
}

export default function PacoteDaCopy({
  criativo,
  nome,
  onUsar,
}: {
  criativo: CriativoAds;
  nome: string;
  onUsar: (campos: CopyDoAnuncio) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [desde, rodar] = useAndamento();
  const gravado = normalizarPacote(criativo.copy.pacote);
  const [pacote, setPacote] = useState<PacoteDeCopy | null>(gravado);
  const chaveGravada = JSON.stringify(criativo.copy.pacote || null);
  useEffect(() => {
    setPacote(normalizarPacote(criativo.copy.pacote));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criativo.id, chaveGravada]);

  const markdown = pacote ? pacoteEmMarkdown(nome, pacote) : "";

  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Pacote de copy">
      <div className="flex min-w-0 flex-wrap items-center">
        <h3 className="mb-1 mr-2 flex min-w-0 flex-1 items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Package className="mr-1.5 h-3.5 w-3.5" /> Pacote completo de copy
        </h3>
        <BotaoComCusto
          rotulo={pacote ? "Refazer pacote" : "Gerar pacote completo"}
          titulo="Pacote de copy"
          descricao="Textos principais em vários estilos, títulos, descrições, CTAs, ganchos e a orientação ao gestor. O Jev confere a política de todos os textos."
          variant={pacote ? "outline" : "default"}
          className="mb-1 h-8"
          partes={() => partesDoPacote(catalogo, 1)}
          executar={() => rodar(() => chamarAds<any>("copy_pacote", { criativo_id: criativo.id }))}
          aoConcluir={(data) => {
            const p = pacoteDaResposta(data, criativo.id);
            if (p) setPacote(p);
            void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
          }}
        />
      </div>
      <Andamento desde={desde} rotulo="Escrevendo e conferindo o pacote" />

      {!pacote && desde === null && (
        <p className="text-[12px] leading-snug text-muted-foreground">
          Gere o pacote para ter muitas variações de texto, título, descrição e botão, prontas para o gestor subir no Gerenciador.
        </p>
      )}

      {pacote && (
        <>
          <div className="flex min-w-0 flex-wrap items-center border-b border-border pb-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mb-1 mr-1 h-8"
              onClick={async () => {
                const ok = await copiarTexto(markdown);
                if (ok) toast.success("Pacote copiado");
                else toast.error("Não foi possível copiar");
              }}
            >
              Copiar tudo
            </Button>
            <Button type="button" size="sm" variant="ghost" className="mb-1 mr-2 h-8" onClick={() => baixarTexto(`${nomeDeArquivo(nome)}.md`, markdown)}>
              <Download className="mr-1 h-3.5 w-3.5" /> Baixar .md
            </Button>
            <EnvioAoGestor corpo={() => ({ criativo_ids: [criativo.id] })} />
          </div>

          <Grupo titulo="Textos principais" contagem={pacote.textos_principais.length}>
            <ul className="space-y-2">
              {pacote.textos_principais.map((t, i) => (
                <li key={i} className="min-w-0 rounded-lg border border-border bg-background p-2.5">
                  <div className="flex min-w-0 items-center">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-primary">{rotuloDoEstilo(t.estilo) || `Texto ${i + 1}`}</span>
                    <span className="mr-1 text-[10.5px] tabular-nums text-muted-foreground">{t.texto.length}</span>
                    <BotaoUsar onClick={() => onUsar(t.texto.length > 300 ? { texto_principal_longo: t.texto } : { texto_principal: t.texto })} />
                    <BotaoCopiar texto={t.texto} rotulo="Copiar texto" />
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-snug [overflow-wrap:anywhere]">{t.texto}</p>
                </li>
              ))}
            </ul>
          </Grupo>

          <Grupo titulo={`Títulos (até ${LIMITE_TITULO})`} contagem={pacote.titulos.length}>
            <ul className="divide-y divide-border rounded-lg border border-border bg-background">
              {pacote.titulos.map((t, i) => (
                <li key={i} className="flex min-w-0 items-center px-2.5 py-1.5">
                  <span className="mr-2 min-w-0 flex-1 text-[12.5px] [overflow-wrap:anywhere]">{t}</span>
                  <Contagem atual={t.length} limite={LIMITE_TITULO} />
                  <BotaoUsar onClick={() => onUsar({ titulo: t })} />
                  <BotaoCopiar texto={t} rotulo="Copiar título" />
                </li>
              ))}
            </ul>
          </Grupo>

          <Grupo titulo={`Descrições (até ${LIMITE_DESCRICAO})`} contagem={pacote.descricoes.length}>
            <ul className="divide-y divide-border rounded-lg border border-border bg-background">
              {pacote.descricoes.map((t, i) => (
                <li key={i} className="flex min-w-0 items-center px-2.5 py-1.5">
                  <span className="mr-2 min-w-0 flex-1 text-[12.5px] [overflow-wrap:anywhere]">{t}</span>
                  <Contagem atual={t.length} limite={LIMITE_DESCRICAO} />
                  <BotaoUsar onClick={() => onUsar({ descricao: t })} />
                  <BotaoCopiar texto={t} rotulo="Copiar descrição" />
                </li>
              ))}
            </ul>
          </Grupo>

          <Grupo titulo="Botões (CTA)" contagem={pacote.ctas.length}>
            <ul className="space-y-1.5">
              {pacote.ctas.map((c, i) => (
                <li key={i} className="flex min-w-0 items-start rounded-lg border border-border bg-background px-2.5 py-1.5">
                  <span className="mr-2 min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium">{rotuloDoCta(c.cta)}</span>
                    {c.porque && <span className="block text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{c.porque}</span>}
                  </span>
                  {CTAS_DO_META.some((x) => x.valor === c.cta) && <BotaoUsar onClick={() => onUsar({ cta_meta: c.cta })} />}
                </li>
              ))}
            </ul>
          </Grupo>

          <Grupo titulo="Ganchos (primeira linha)" contagem={pacote.ganchos.length}>
            <ul className="divide-y divide-border rounded-lg border border-border bg-background">
              {pacote.ganchos.map((g, i) => (
                <li key={i} className="flex min-w-0 items-center px-2.5 py-1.5">
                  <span className="mr-2 min-w-0 flex-1 text-[12.5px] [overflow-wrap:anywhere]">{g}</span>
                  <BotaoCopiar texto={g} rotulo="Copiar gancho" />
                </li>
              ))}
            </ul>
          </Grupo>

          {pacote.gestor && (
            <div className="min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Orientação ao gestor de tráfego</p>
              <dl className="mt-1.5 space-y-1.5">
                {CAMPOS_DO_GESTOR.filter((c) => pacote.gestor && pacote.gestor[c.chave]).map((c) => (
                  <div key={c.chave} className="min-w-0">
                    <dt className="text-[11px] font-medium text-foreground/80">{c.rotulo}</dt>
                    <dd className="whitespace-pre-wrap text-[12px] leading-snug [overflow-wrap:anywhere]">{pacote.gestor ? pacote.gestor[c.chave] : ""}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </>
      )}
    </section>
  );
}
