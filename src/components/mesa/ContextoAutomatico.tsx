import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, CircleDashed, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useResolvedFileUrl } from "@/lib/fileUrls";
import { chamarFuncao, dataEHora, padraoDoContexto, TAMANHOS, textoDoErro } from "@/lib/mesa/api";
import { AvisoDeErro, BotaoComCusto, avisarCustoReal, useAvisarErro } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import type { ParteDoContexto } from "./AbaContexto";
import { TituloDeSecao } from "./Seletores";
import {
  temTexto,
  useAcervo,
  useInvalidarContexto,
  useLeituraDoContexto,
  type CorDoKit,
  type KitDoContexto,
  type LeituraDoContexto,
  type RespostaDoMontar,
  type SugestoesDoContexto,
} from "./contextoDoCliente";

interface ArquivoDoPainel {
  id: string;
  file_name: string;
  file_url: string;
  storage_bucket: string | null;
  storage_path: string | null;
}

function useArquivo(fileId: string | null) {
  return useQuery({
    queryKey: ["mesa", "arquivo", fileId],
    enabled: !!fileId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ArquivoDoPainel | null> => {
      const { data, error } = await (supabase as any)
        .from("files")
        .select("id, file_name, file_url, storage_bucket, storage_path")
        .eq("id", fileId)
        .maybeSingle();
      if (error) throw error;
      return (data as ArquivoDoPainel) || null;
    },
  });
}

function ImagemDoArquivo({ arquivo, className = "" }: { arquivo: ArquivoDoPainel; className?: string }) {
  const { url } = useResolvedFileUrl({
    fileUrl: arquivo.file_url,
    storageBucket: arquivo.storage_bucket,
    storagePath: arquivo.storage_path,
    transform: { width: 160, height: 160, resize: "contain" },
  });
  if (!url) return <div className={`animate-pulse bg-muted ${className}`} />;
  return <img src={url} alt={arquivo.file_name} loading="lazy" className={`object-contain ${className}`} />;
}

/** Miniatura de um arquivo do painel (tabela files) pelo id. */
function MiniaturaDoArquivo({ fileId, className = "" }: { fileId: string; className?: string }) {
  const arquivo = useArquivo(fileId);
  if (!arquivo.data) {
    return <div className={`bg-muted ${arquivo.isLoading ? "animate-pulse" : ""} ${className}`} />;
  }
  return <ImagemDoArquivo arquivo={arquivo.data} className={className} />;
}

function Bloco({ titulo, children, acao }: { titulo: string; children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between">
        <p className="mr-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{titulo}</p>
        {acao}
      </div>
      {children}
    </div>
  );
}

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p className="text-[15px] font-semibold text-foreground">{valor}</p>
      {detalhe && <p className="text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{detalhe}</p>}
    </div>
  );
}

function Bolinhas({ paleta }: { paleta: CorDoKit[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
      {paleta.map((c, i) => (
        <li key={`${c.hex}-${i}`} className="flex min-w-0 items-center rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2">
          <span className="mr-1.5 h-5 w-5 shrink-0 rounded-full border border-border" style={{ backgroundColor: c.hex }} title={c.nome || c.hex} />
          <span className="font-mono text-[11px] text-foreground">{c.hex}</span>
          {temTexto(c.nome) && <span className="ml-1.5 truncate text-[11px] text-muted-foreground">{c.nome}</span>}
        </li>
      ))}
    </ul>
  );
}

const ROTULO_PAPEL_DA_FONTE: Record<string, string> = { titulo: "Título", texto: "Texto" };

type SituacaoDoItem = "feito" | "parcial" | "falta";

interface ItemDoChecklist {
  chave: string;
  rotulo: string;
  situacao: SituacaoDoItem;
  detalhe: string;
  parte: ParteDoContexto | null;
}

/**
 * O que o contexto do cliente já tem e o que falta. Recalcula a cada leitura
 * (a aba relê depois de cada mudança), então os itens vão sendo marcados
 * conforme a equipe e o agente preenchem.
 */
function montarChecklist(dados: LeituraDoContexto, acervo: { ativas: number; semDescricao: number } | null): ItemDoChecklist[] {
  const kit = dados.kit;
  const paleta = Array.isArray(kit?.paleta) ? kit!.paleta! : [];
  const refs = dados.encontrado.referencias;
  const docs = dados.encontrado.documentos;
  const temLogo = !!(kit && (kit.logo_path || kit.logo_file_id));
  const itens: ItemDoChecklist[] = [
    {
      chave: "logo",
      rotulo: "Logo",
      situacao: temLogo ? (kit && (kit.logo_alt_path || kit.logo_alt_file_id) ? "feito" : "parcial") : "falta",
      detalhe: temLogo ? (kit && (kit.logo_alt_path || kit.logo_alt_file_id) ? "Principal e alternativa definidas." : "Falta a logo alternativa.") : "Escolha a logo em qualquer pasta.",
      parte: "marca",
    },
    {
      chave: "paleta",
      rotulo: "Paleta",
      situacao: paleta.length >= 2 ? "feito" : paleta.length === 1 ? "parcial" : "falta",
      detalhe: paleta.length ? `${paleta.length} ${paleta.length === 1 ? "cor" : "cores"}.` : "Nenhuma cor definida.",
      parte: "marca",
    },
    {
      chave: "fontes",
      rotulo: "Fontes",
      situacao: dados.fontes.length >= 2 ? "feito" : dados.fontes.length === 1 ? "parcial" : "falta",
      detalhe: dados.fontes.length ? dados.fontes.map((f) => f.nome).join(", ") : "Sem fonte de título e de texto.",
      parte: "fontes",
    },
    {
      chave: "estilo",
      rotulo: "Estilo visual",
      situacao: temTexto(kit?.estilo) ? "feito" : "falta",
      detalhe: temTexto(kit?.estilo) ? "Descrito." : "Como a marca se parece.",
      parte: "marca",
    },
    {
      chave: "regras",
      rotulo: "Regras",
      situacao: temTexto(kit?.regras) ? "feito" : "falta",
      detalhe: temTexto(kit?.regras) ? "Definidas." : "O que fazer e o que nunca fazer.",
      parte: "marca",
    },
    {
      chave: "referencias",
      rotulo: "Referências lidas",
      situacao: refs.total === 0 ? "falta" : refs.sem_leitura === 0 ? "feito" : "parcial",
      detalhe: refs.total === 0 ? "Nenhuma referência ativa." : `${refs.total - refs.sem_leitura} de ${refs.total} lidas.`,
      parte: "referencias",
    },
    {
      chave: "imagens",
      rotulo: "Imagens do acervo",
      situacao: !acervo || acervo.ativas === 0 ? "falta" : acervo.semDescricao === 0 ? "feito" : "parcial",
      detalhe: !acervo
        ? "Lendo o acervo..."
        : acervo.ativas === 0
          ? "Traga as fotos reais do cliente."
          : acervo.semDescricao
            ? `${acervo.ativas} fotos, ${acervo.semDescricao} sem organizar.`
            : `${acervo.ativas} fotos organizadas.`,
      parte: "imagens",
    },
    {
      chave: "documentos",
      rotulo: "Documentos",
      situacao: docs.length === 0 ? "falta" : docs.some((d) => d.prioridade) ? "feito" : "parcial",
      detalhe: docs.length === 0 ? "Envie a identidade em Arquivos." : `${docs.length} lido(s), ${docs.filter((d) => d.prioridade).length} de identidade.`,
      parte: null,
    },
  ];
  return itens;
}

function Checklist({ itens, onIrPara }: { itens: ItemDoChecklist[]; onIrPara?: (p: ParteDoContexto) => void }) {
  const pontos = itens.reduce((t, i) => t + (i.situacao === "feito" ? 1 : i.situacao === "parcial" ? 0.5 : 0), 0);
  const pct = itens.length ? Math.round((pontos / itens.length) * 100) : 0;
  const feitos = itens.filter((i) => i.situacao === "feito").length;
  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-medium">Completude do contexto</p>
          <p className="text-[13px] font-semibold tabular-nums">{pct}%</p>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">{feitos} de {itens.length} completos. A lista se atualiza conforme o contexto é preenchido.</p>
      </div>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {itens.map((i) => {
          const clicavel = !!(i.parte && onIrPara && i.situacao !== "feito");
          const conteudo = (
            <>
              <span
                className={`mr-2.5 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  i.situacao === "feito"
                    ? "bg-success text-white"
                    : i.situacao === "parcial"
                      ? "border border-primary text-primary"
                      : "border border-border text-muted-foreground"
                }`}
              >
                {i.situacao === "feito" ? <Check className="h-3 w-3" /> : i.situacao === "parcial" ? <CircleDashed className="h-3 w-3" /> : <Circle className="h-2 w-2" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[12.5px] font-medium ${i.situacao === "feito" ? "text-muted-foreground" : "text-foreground"}`}>
                  {i.rotulo}
                </span>
                <span className="block text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{i.detalhe}</span>
              </span>
              {clicavel && <ArrowRight className="ml-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </>
          );
          const classe = `flex w-full min-w-0 items-start rounded-lg border px-2.5 py-2 text-left ${
            i.situacao === "feito" ? "border-border bg-muted" : "border-border bg-card"
          }`;
          return (
            <li key={i.chave} className="min-w-0">
              {clicavel ? (
                <button type="button" onClick={() => onIrPara!(i.parte!)} className={`${classe} hover:border-primary/60`}>
                  {conteudo}
                </button>
              ) : (
                <div className={classe}>{conteudo}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Painel do que o painel já tem deste cliente, sem custo de IA. */
function PainelEncontrado({
  dados,
  onUsarLogo,
  gravandoLogo,
  onFontesDaBiblioteca,
  escolhendoFontes,
  onIrPara,
}: {
  dados: LeituraDoContexto;
  onUsarLogo: (origem: "arquivo" | "workspace", id: string) => void;
  gravandoLogo: string | null;
  onFontesDaBiblioteca: () => void;
  escolhendoFontes: boolean;
  onIrPara?: (p: ParteDoContexto) => void;
}) {
  const { kit, encontrado, fontes, candidatos_a_logo } = dados;
  const { clientId } = useMesa();
  const acervo = useAcervo(clientId);
  const paleta = Array.isArray(kit?.paleta) ? kit!.paleta! : [];
  const docs = encontrado.documentos;
  const refs = encontrado.referencias;
  const logoPath = kit?.logo_path || null;
  const logoId = logoPath ? null : kit?.logo_file_id || null;
  const logo = useArquivo(logoId);
  const [verTodosDocs, setVerTodosDocs] = useState(false);
  const docsVisiveis = verTodosDocs ? docs : docs.slice(0, 6);

  const resumoAcervo = acervo.data
    ? {
        ativas: acervo.data.filter((i) => i.ativa).length,
        semDescricao: acervo.data.filter((i) => i.ativa && !(i.descricao && i.descricao.trim())).length,
      }
    : acervo.isError
      ? { ativas: 0, semDescricao: 0 }
      : null;
  const checklist = montarChecklist(dados, resumoAcervo);

  const lacunas: string[] = [];
  for (const l of dados.lacunas.concat(Array.isArray(kit?.contexto?.lacunas) ? kit!.contexto!.lacunas! : [])) {
    if (temTexto(l) && lacunas.indexOf(l) < 0) lacunas.push(l);
  }

  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-3.5">
      <Checklist itens={checklist} onIrPara={onIrPara} />

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-4 sm:grid-cols-4">
        <Numero rotulo="Documentos" valor={docs.length} detalhe={docs.length ? `${docs.filter((d) => d.prioridade).length} de identidade` : "nenhum em Arquivos"} />
        <Numero rotulo="Dossiê" valor={encontrado.tem_dossie ? "Sim" : "Não"} />
        <Numero rotulo="Artes aprovadas" valor={encontrado.artes_aprovadas} />
        <Numero
          rotulo="Referências"
          valor={refs.total}
          detalhe={
            refs.total
              ? `${refs.identidade} identidade, ${refs.tecnica} técnica${refs.sem_leitura ? `, ${refs.sem_leitura} sem leitura` : ""}`
              : "nenhuma ativa"
          }
        />
      </div>
      {encontrado.sincronizadas_agora > 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          {encontrado.sincronizadas_agora === 1 ? "1 referência nova entrou agora" : `${encontrado.sincronizadas_agora} referências novas entraram agora`} das pastas de referência e das artes aprovadas.
        </p>
      )}

      {docs.length > 0 && (
        <Bloco titulo="Documentos lidos">
          <ul className="space-y-1">
            {docsVisiveis.map((d) => (
              <li key={d.file_id} className="flex min-w-0 items-center text-[12.5px]">
                <FileText className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={d.nome}>{d.nome}</span>
                {d.prioridade && <span className="ml-2 shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">identidade</span>}
              </li>
            ))}
          </ul>
          {docs.length > 6 && (
            <button type="button" onClick={() => setVerTodosDocs((v) => !v)} className="text-[11.5px] text-muted-foreground hover:text-foreground">
              {verTodosDocs ? "Mostrar menos" : `Ver mais ${docs.length - 6}`}
            </button>
          )}
        </Bloco>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Bloco titulo="Paleta">
          {paleta.length ? <Bolinhas paleta={paleta} /> : <p className="text-[12px] text-muted-foreground">Ainda sem paleta.</p>}
        </Bloco>

        <Bloco
          titulo="Fontes"
          acao={
            fontes.length === 0 ? (
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={onFontesDaBiblioteca} disabled={escolhendoFontes}>
                {escolhendoFontes && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Escolher da biblioteca
              </Button>
            ) : undefined
          }
        >
          {fontes.length ? (
            <ul className="flex flex-wrap">
              {fontes.map((f, i) => (
                <li key={`${f.nome}-${i}`} className="mb-1.5 mr-1.5 min-w-0 rounded-full border border-border bg-card px-2.5 py-0.5 text-[12px] [overflow-wrap:anywhere]">
                  <span className="text-muted-foreground">{ROTULO_PAPEL_DA_FONTE[f.papel] || f.papel}: </span>
                  {f.nome}
                  {f.origem === "biblioteca" && <span className="text-muted-foreground"> (biblioteca)</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-muted-foreground">Sem fonte definida.</p>
          )}
        </Bloco>
      </div>

      <Bloco
        titulo="Logo"
        acao={
          onIrPara ? (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => onIrPara("marca")}>
              {logoPath || logoId ? "Trocar" : "Escolher de qualquer pasta"}
            </Button>
          ) : undefined
        }
      >
        {logoPath || logoId ? (
          <div className="flex min-w-0 items-center">
            <div className="mr-3 h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
              {logoPath ? (
                <ImagemDaMesa caminho={logoPath} alt="Logo" className="h-12 w-12 !object-contain p-1" />
              ) : (
                <MiniaturaDoArquivo fileId={logoId!} className="h-12 w-12" />
              )}
            </div>
            <div className="min-w-0">
              <p className="flex items-center text-[12.5px] font-medium">
                <Check className="mr-1 h-3.5 w-3.5 text-primary" /> Logo definida
              </p>
              <p className="truncate text-[11.5px] text-muted-foreground">
                {logoPath ? "Guardada na marca do cliente." : logo.data?.file_name || (logo.isLoading ? "carregando..." : "arquivo escolhido")}
              </p>
            </div>
          </div>
        ) : candidatos_a_logo.length ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {candidatos_a_logo.slice(0, 6).map((c) => (
              <li key={`${c.origem}-${c.id}`} className="flex min-w-0 items-center rounded-lg border border-border bg-card p-2">
                {c.origem === "arquivo" ? (
                  <MiniaturaDoArquivo fileId={c.id} className="mr-2.5 h-10 w-10 shrink-0 rounded-md" />
                ) : (
                  <span className="mr-2.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-[9.5px] text-muted-foreground">Workspace</span>
                )}
                <span className="min-w-0 flex-1 truncate text-[12px]" title={c.nome}>{c.nome}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-2 h-7 shrink-0 px-2 text-[11.5px]"
                  onClick={() => onUsarLogo(c.origem, c.id)}
                  disabled={!!gravandoLogo}
                >
                  {gravandoLogo === c.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Usar como logo
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">Nenhum arquivo com "logo" no nome. Escolha a logo em qualquer pasta pela Marca.</p>
        )}
      </Bloco>

      {lacunas.length > 0 && (
        <Bloco titulo="O agente ainda aponta">
          <ul className="space-y-1">
            {lacunas.map((l) => (
              <li key={l} className="flex min-w-0 items-start text-[12.5px] leading-relaxed">
                <Circle className="mr-2 mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{l}</span>
              </li>
            ))}
          </ul>
        </Bloco>
      )}
    </section>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <div className="text-[12.5px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** O contexto que o estrategista e o diretor de arte usam. */
function ContextoConsolidadoCard({ kit }: { kit: KitDoContexto | null }) {
  const c = kit?.contexto || null;
  const diferenciais = (Array.isArray(c?.diferenciais) ? c!.diferenciais! : []).filter(temTexto);
  const fontesLidas = (Array.isArray(c?.fontes_lidas) ? c!.fontes_lidas! : []).filter(temTexto);
  const tipo = c?.tipografia || null;
  const temTipografia = !!tipo && (temTexto(tipo.titulo) || temTexto(tipo.texto) || temTexto(tipo.observacao));
  const curtos: [string, string | null | undefined][] = [
    ["Negócio", c?.negocio],
    ["Público", c?.publico],
    ["Oferta", c?.oferta],
    ["Tom de voz", c?.tom_de_voz],
  ];
  const algum =
    curtos.some(([, v]) => temTexto(v)) || diferenciais.length > 0 || temTipografia || temTexto(c?.logo?.descricao) || temTexto(kit?.estilo) || temTexto(kit?.regras);

  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between">
        <p className="mr-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Contexto consolidado</p>
        {kit?.contexto_atualizado_em && <p className="text-[11px] text-muted-foreground">montado {dataEHora(kit.contexto_atualizado_em)}</p>}
      </div>
      {!algum ? (
        <p className="text-[12.5px] text-muted-foreground">Ainda não há contexto montado para este cliente.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {curtos.filter(([, v]) => temTexto(v)).map(([rotulo, v]) => (
              <Campo key={rotulo} rotulo={rotulo}>{v}</Campo>
            ))}
          </div>
          {diferenciais.length > 0 && (
            <Campo rotulo="Diferenciais">
              <ul className="list-disc space-y-0.5 pl-4">
                {diferenciais.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </Campo>
          )}
          {temTipografia && (
            <Campo rotulo="Tipografia citada">
              {temTexto(tipo!.titulo) && <p>Título: {tipo!.titulo}</p>}
              {temTexto(tipo!.texto) && <p>Texto: {tipo!.texto}</p>}
              {temTexto(tipo!.observacao) && <p className="text-muted-foreground">{tipo!.observacao}</p>}
            </Campo>
          )}
          {temTexto(c?.logo?.descricao) && <Campo rotulo="Logo">{c!.logo!.descricao}</Campo>}
          {temTexto(kit?.estilo) && (
            <Campo rotulo="Estilo visual"><p className="whitespace-pre-wrap">{kit!.estilo}</p></Campo>
          )}
          {temTexto(kit?.regras) && (
            <Campo rotulo="Regras"><p className="whitespace-pre-wrap">{kit!.regras}</p></Campo>
          )}
        </div>
      )}
      {fontesLidas.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center border-t border-border pt-2.5">
          <span className="mb-1 mr-1.5 text-[11px] text-muted-foreground">Lido de:</span>
          {fontesLidas.map((f) => (
            <span key={f} className="mb-1 mr-1.5 min-w-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{f}</span>
          ))}
        </div>
      )}
    </section>
  );
}

/** Sugestões do montar para campos que a equipe já tinha preenchido. */
function SugestoesPendentes({
  sugestoes,
  kit,
  aplicando,
  onAplicar,
  onIgnorar,
}: {
  sugestoes: SugestoesDoContexto;
  kit: KitDoContexto | null;
  aplicando: string | null;
  onAplicar: (campo: keyof SugestoesDoContexto) => void;
  onIgnorar: (campo: keyof SugestoesDoContexto) => void;
}) {
  const campos = (["paleta", "estilo", "regras"] as (keyof SugestoesDoContexto)[]).filter((k) => sugestoes[k] !== undefined);
  if (!campos.length) return null;
  const rotulos: Record<string, string> = { paleta: "Paleta", estilo: "Estilo visual", regras: "Regras" };
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-primary/50 bg-card p-3.5">
      <div>
        <p className="flex items-center text-[12.5px] font-medium"><Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" /> Sugestões do agente</p>
        <p className="text-[11.5px] text-muted-foreground">A equipe já tinha preenchido estes campos, então o agente não trocou nada. Aplique o que fizer sentido.</p>
      </div>
      <ul className="space-y-2.5">
        {campos.map((campo) => (
          <li key={campo} className="min-w-0 space-y-2 rounded-lg border border-border bg-muted p-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{rotulos[campo]}</p>
            {campo === "paleta" ? (
              <div className="space-y-1.5">
                <Bolinhas paleta={sugestoes.paleta || []} />
                {Array.isArray(kit?.paleta) && kit!.paleta!.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">Hoje: {kit!.paleta!.map((c) => c.hex).join(", ")}</p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{String(sugestoes[campo] || "")}</p>
                {temTexto(campo === "estilo" ? kit?.estilo : kit?.regras) && (
                  <p className="line-clamp-2 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    Hoje: {campo === "estilo" ? kit?.estilo : kit?.regras}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap justify-end">
              <Button type="button" size="sm" variant="ghost" className="mr-2 h-7 text-[11.5px]" onClick={() => onIgnorar(campo)} disabled={aplicando === campo}>
                Ignorar
              </Button>
              <Button type="button" size="sm" className="h-7 text-[11.5px]" onClick={() => onAplicar(campo)} disabled={!!aplicando}>
                {aplicando === campo && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Aplicar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Coluna principal da aba Contexto: lê sozinha o que o cliente já tem,
 * monta o contexto uma vez quando nunca foi montado e mostra o resultado.
 */
export default function ContextoAutomatico({ onIrPara }: { onIrPara?: (parte: ParteDoContexto) => void } = {}) {
  const { clientId, clientName, catalogo, atualizarCusto, userId } = useMesa();
  const queryClient = useQueryClient();
  const leitura = useLeituraDoContexto(clientId);
  const invalidar = useInvalidarContexto();
  const avisarErro = useAvisarErro();
  const montados = useRef<Record<string, boolean>>({});
  const [montandoPara, setMontandoPara] = useState<string | null>(null);
  const [erroDoMontar, setErroDoMontar] = useState<{ clientId: string; erro: unknown } | null>(null);
  const [sugestoesPorCliente, setSugestoesPorCliente] = useState<Record<string, SugestoesDoContexto>>({});
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [gravandoLogo, setGravandoLogo] = useState<string | null>(null);
  const [escolhendoFontes, setEscolhendoFontes] = useState(false);

  const dados = leitura.data;
  const kit = dados?.kit || null;
  const sugestoes = sugestoesPorCliente[clientId] || {};
  const montando = montandoPara === clientId;
  const temMaterial = !!dados && (dados.encontrado.documentos.length > 0 || dados.encontrado.tem_dossie || dados.encontrado.artes_aprovadas > 0);

  const depoisDeMontar = (alvo: string, data: RespostaDoMontar | null) => {
    const s = (data && data.sugestoes) || {};
    const limpas: SugestoesDoContexto = {};
    if (Array.isArray(s.paleta) && s.paleta.length) limpas.paleta = s.paleta;
    if (temTexto(s.estilo)) limpas.estilo = s.estilo;
    if (temTexto(s.regras)) limpas.regras = s.regras;
    setSugestoesPorCliente((p) => ({ ...p, [alvo]: limpas }));
    const f = data && data.fontes_escolhidas;
    if (f && temTexto(f.titulo)) {
      toast.success("Fontes escolhidas da biblioteca", {
        description: `Título: ${f.titulo}. Texto: ${f.texto}.${temTexto(f.porque) ? ` ${f.porque}` : ""}`,
      });
    }
    invalidar(alvo);
  };

  const montarSozinho = async (alvo: string) => {
    setMontandoPara(alvo);
    setErroDoMontar(null);
    try {
      const data = await chamarFuncao<RespostaDoMontar>("agente-contexto", { acao: "montar", client_id: alvo });
      avisarCustoReal("Contexto montado com o que o cliente já tem", data, atualizarCusto);
      depoisDeMontar(alvo, data);
    } catch (e) {
      setErroDoMontar({ clientId: alvo, erro: e });
    } finally {
      setMontandoPara((atual) => (atual === alvo ? null : atual));
    }
  };

  // Contexto nunca montado e há material: monta sozinho, uma vez por cliente.
  useEffect(() => {
    if (!dados || !clientId) return;
    if (dados.kit && dados.kit.contexto_atualizado_em) return;
    if (montados.current[clientId]) return;
    if (!temMaterial) return;
    montados.current[clientId] = true;
    void montarSozinho(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, clientId]);

  // Referências novas entraram na leitura: a lista de detalhe precisa ver.
  useEffect(() => {
    if (dados && dados.encontrado.sincronizadas_agora > 0) {
      void queryClient.invalidateQueries({ queryKey: ["mesa", "referencias", clientId] });
    }
  }, [dados, clientId, queryClient]);

  const gravarNoKit = async (patch: Record<string, unknown>) => {
    const { error } = await (supabase as any)
      .from("cliente_kit_marca")
      .upsert({ client_id: clientId, ...patch, atualizado_por: userId }, { onConflict: "client_id" });
    if (error) throw error;
  };

  // A logo vai para a marca do cliente pelo agente de contexto (sem custo),
  // venha de Arquivos ou do Workspace.
  const usarComoLogo = async (origem: "arquivo" | "workspace", id: string) => {
    setGravandoLogo(id);
    try {
      await chamarFuncao("agente-contexto", { acao: "definir_logo", client_id: clientId, origem, id, alternativa: false });
      toast.success("Logo definida");
      invalidar(clientId);
    } catch (e) {
      avisarErro(e, "Logo não definida");
    } finally {
      setGravandoLogo(null);
    }
  };

  const tirarSugestao = (alvo: string, campo: keyof SugestoesDoContexto) =>
    setSugestoesPorCliente((p) => {
      const atual = { ...(p[alvo] || {}) };
      delete atual[campo];
      return { ...p, [alvo]: atual };
    });

  const aplicarSugestao = async (campo: keyof SugestoesDoContexto) => {
    const alvo = clientId;
    setAplicando(campo);
    try {
      await gravarNoKit({ [campo]: sugestoes[campo] });
      tirarSugestao(alvo, campo);
      toast.success("Sugestão aplicada");
      invalidar(alvo);
    } catch (e) {
      toast.error("Sugestão não aplicada", { description: textoDoErro(e) });
    } finally {
      setAplicando(null);
    }
  };

  const fontesDaBiblioteca = async () => {
    const alvo = clientId;
    setEscolhendoFontes(true);
    try {
      const data = await chamarFuncao<any>("agente-contexto", { acao: "fontes_da_biblioteca", client_id: alvo });
      avisarCustoReal("Fontes escolhidas da biblioteca", data, atualizarCusto);
      invalidar(alvo);
    } catch (e) {
      avisarErro(e, "Fontes não escolhidas");
    } finally {
      setEscolhendoFontes(false);
    }
  };

  const modeloDoContexto = padraoDoContexto(catalogo);

  return (
    <div className="min-w-0 space-y-4">
      <TituloDeSecao
        acao={
          <div className="flex items-center">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mr-1.5 h-8 w-8 p-0"
              onClick={() => void leitura.refetch()}
              disabled={leitura.isFetching}
              aria-label="Ler de novo"
              title="Ler de novo (sem custo)"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${leitura.isFetching ? "animate-spin" : ""}`} />
            </Button>
            <BotaoComCusto
              rotulo={kit?.contexto_atualizado_em ? "Atualizar contexto" : "Montar contexto"}
              titulo={kit?.contexto_atualizado_em ? "Atualizar o contexto" : "Montar o contexto"}
              descricao="A montagem automática roda só na primeira vez. Aqui o agente lê de novo os documentos, o dossiê, as artes aprovadas e as referências sem leitura. O que a equipe já preencheu não é trocado: vira sugestão."
              variant="outline"
              className="h-8 text-[12px]"
              disabled={!dados || montando}
              partes={() => [
                { modeloId: modeloDoContexto?.id, tipo: "texto", tokensEntrada: TAMANHOS.montarContexto.entrada, tokensSaida: TAMANHOS.montarContexto.saida },
              ]}
              executar={() => chamarFuncao<RespostaDoMontar>("agente-contexto", { acao: "montar", client_id: clientId })}
              aoConcluir={(data) => depoisDeMontar(clientId, data)}
            />
          </div>
        }
      >
        O que a Mesa já encontrou{clientName ? ` de ${clientName}` : ""}
      </TituloDeSecao>

      {montando && (
        <p className="flex items-center rounded-xl border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 shrink-0 animate-spin" />
          Montando o contexto a partir do que o cliente já tem...
        </p>
      )}
      {erroDoMontar && erroDoMontar.clientId === clientId && <AvisoDeErro erro={erroDoMontar.erro} />}

      {leitura.isLoading && (
        <div className="flex items-center rounded-xl border border-border bg-card px-3 py-3 text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          Lendo o que o painel já tem deste cliente...
        </div>
      )}
      {leitura.isError && (
        <div className="space-y-2">
          <AvisoDeErro erro={leitura.error} />
          <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => void leitura.refetch()}>
            Tentar de novo
          </Button>
        </div>
      )}

      {dados && (
        <>
          <PainelEncontrado
            dados={dados}
            onUsarLogo={(origem, id) => void usarComoLogo(origem, id)}
            gravandoLogo={gravandoLogo}
            onFontesDaBiblioteca={() => void fontesDaBiblioteca()}
            escolhendoFontes={escolhendoFontes}
            onIrPara={onIrPara}
          />
          {!temMaterial && !kit?.contexto_atualizado_em && (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Ainda não há documentos, dossiê nem artes aprovadas deste cliente no painel. Envie a identidade em Arquivos ou conte ao agente de contexto o que já sabe da marca.
            </p>
          )}
          <SugestoesPendentes
            sugestoes={sugestoes}
            kit={kit}
            aplicando={aplicando}
            onAplicar={(campo) => void aplicarSugestao(campo)}
            onIgnorar={(campo) => tirarSugestao(clientId, campo)}
          />
          <ContextoConsolidadoCard kit={kit} />
        </>
      )}
    </div>
  );
}
