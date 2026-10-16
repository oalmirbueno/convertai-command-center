import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { BotaoComCusto } from "../Custo";
import { SeletorDeModelo } from "../Seletores";
import { useMesa } from "../MesaContexto";
import type { DiagnosticoDoPerfil as Diagnostico, EstadoDaParte } from "../../../../supabase/functions/mesa-instagram/modulos/diagnostico-do-perfil";
import { chamarInstagram, type PerfilDaAba } from "./instagramApi";
import { modeloDaAba } from "./BioENome";

/**
 * Diagnóstico do perfil em 9 partes (12/10/2026, ig-profile-optimizer). Foto, nome, @, bio, link,
 * categoria, destaques, fixados e grade, cada uma com o estado, o porquê e como corrigir. O Jev
 * julga o texto, o código confere link e formatos, um modelo de imagem olha a foto e a grade. O
 * que a API do Instagram não mostra (destaques e fixados) vem com o que o painel sabe e "confira no app".
 */

const ESTADO: Record<EstadoDaParte, { rotulo: string; classe: string }> = {
  passa: { rotulo: "Passa", classe: "bg-success/15 text-success" },
  melhorar: { rotulo: "Melhorar", classe: "bg-warning/15 text-warning" },
  falha: { rotulo: "Falha", classe: "bg-destructive/15 text-destructive" },
  nao_lido: { rotulo: "Confira no app", classe: "bg-muted text-muted-foreground" },
};

const FONTE: Record<string, string> = { codigo: "conferido pelo painel", jev: "julgado pelo Jev", visao: "visto na imagem", painel: "o que o painel sabe" };

const quando = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

export default function DiagnosticoDoPerfil({ perfil, diagnostico, onDiagnostico }: { perfil: PerfilDaAba; diagnostico: Diagnostico | null; onDiagnostico: (d: Diagnostico) => void }) {
  const { clientId, catalogo } = useMesa();
  const padrao = useMemo(() => modeloDaAba(catalogo), [catalogo]);
  const [modeloId, setModeloId] = useState<string>("");
  useEffect(() => {
    if (!modeloId && padrao) setModeloId(padrao.id);
  }, [padrao, modeloId]);
  const partes = () => [{ modeloId: modeloId || (padrao ? padrao.id : null), tipo: "texto" as const, tokensEntrada: 12000, tokensSaida: 700 }];
  const outroPerfil = !!diagnostico && !!perfil.username && diagnostico.username !== perfil.username;

  return (
    <div className="min-w-0 space-y-3" data-diagnostico-do-perfil="">
      <div className="flex min-w-0 flex-wrap items-end [&>*]:mb-1.5 [&>*]:mr-2">
        <div className="w-full min-w-0 sm:w-[260px]">
          <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modeloId} onChange={setModeloId} rotulo="Modelo que olha as imagens" />
        </div>
        <BotaoComCusto
          rotulo={diagnostico ? "Diagnosticar de novo" : "Diagnosticar o perfil"}
          titulo="Perfil diagnosticado"
          descricao="O Jev julga bio, nome, @ e categoria; o painel confere o link e os formatos; o modelo olha a foto e os 9 primeiros posts."
          partes={partes}
          executar={() => chamarInstagram<{ diagnostico: Diagnostico; custo_usd: number }>("perfil_diagnosticar", clientId, { modelo_id: modeloId || undefined })}
          aoConcluir={(d) => d && d.diagnostico && onDiagnostico(d.diagnostico)}
          disabled={!perfil.username}
        />
      </div>

      {!diagnostico && (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          Perfil ainda não diagnosticado
          <AjudaRecolhida className="ml-1" rotulo="O que o diagnóstico confere">
            As 9 partes que quem chega ao perfil vê: foto, nome, @, bio, link, categoria, destaques, posts fixados e grade. Cada uma sai com o estado, o porquê e como corrigir.
          </AjudaRecolhida>
        </p>
      )}
      {outroPerfil && <p className="text-[12px] leading-4 text-warning">Este diagnóstico é de @{diagnostico!.username}. Diagnostique de novo para valer @{perfil.username}.</p>}

      {diagnostico && (
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center text-[12.5px] [&>*]:mr-3">
            {diagnostico.resumo.nota !== null && <span className="font-semibold tabular-nums text-foreground">Nota {diagnostico.resumo.nota}</span>}
            <span className="text-success">{diagnostico.resumo.passa} passam</span>
            <span className="text-warning">{diagnostico.resumo.melhorar} a melhorar</span>
            <span className="text-destructive">{diagnostico.resumo.falha} com falha</span>
            {diagnostico.resumo.nao_lido > 0 && <span className="text-muted-foreground">{diagnostico.resumo.nao_lido} para conferir no app</span>}
            <span className="text-muted-foreground">{quando(diagnostico.gerado_em)}</span>
          </div>
          <ul className="grid min-w-0 grid-cols-1 gap-1.5" aria-label="As 9 partes do perfil">
            {diagnostico.linhas.map((l) => (
              <li key={l.parte} className={juntar("min-w-0 rounded-md px-3 py-2", superficie.poco)} data-parte={l.parte} data-estado={l.estado}>
                <div className="flex min-w-0 items-center">
                  <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{l.rotulo}</span>
                  <span className={juntar(etiqueta, "ml-2 shrink-0", ESTADO[l.estado].classe)}>{ESTADO[l.estado].rotulo}</span>
                  <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">{FONTE[l.fonte] || ""}</span>
                </div>
                {l.detalhe && <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{l.detalhe}</p>}
                {l.como_corrigir && <p className="mt-0.5 text-[12.5px] leading-5 text-foreground [overflow-wrap:anywhere]">{l.como_corrigir}</p>}
                {l.parte === "fixados" && diagnostico.para_fixar.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {diagnostico.para_fixar.map((p, i) => (
                      <li key={i} className="flex min-w-0 items-center text-[12px] leading-4">
                        <span className="min-w-0 truncate text-muted-foreground">{p.legenda || "Post"} ({p.multiplo})</span>
                        {p.link && (
                          <a href={p.link} target="_blank" rel="noopener noreferrer" className="ml-1.5 shrink-0 text-primary" aria-label="Abrir o post no Instagram" title="Abrir o post no Instagram">
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
