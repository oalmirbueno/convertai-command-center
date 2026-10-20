import { useQuery } from "@tanstack/react-query";
import { useState, lazy, Suspense } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { AjudaRecolhida } from "@/components/sistema";
import {
  lerVersoes,
  versionarConteudo,
  arquivoDaVersao,
  type VersaoConteudo,
} from "@/lib/membros/editorial";
import { mensagemDoErro } from "@/lib/membros/api";
const PdfSeguro = lazy(() => import("./PdfSeguro"));
export default function VersoesDoConteudo({
  material,
  agir,
}: {
  material: string;
  agir: (f: () => Promise<void>) => Promise<void>;
}) {
  const { user } = useAuth();
  const [verArquivo, setVerArquivo] = useState<VersaoConteudo | null>(null);
  const fonte = useQuery({
    queryKey: ["membros", "arquivo-versao", user?.id, material, verArquivo?.id],
    queryFn: () => arquivoDaVersao(material, verArquivo!.id),
    enabled: !!verArquivo,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const dados = useQuery({
    queryKey: ["membros", "versoes", user?.id, material],
    queryFn: () => lerVersoes(material),
    retry: false,
  });
  return (
    <>
      <details className="membros-bloco mt-5">
        <summary className="membros-acao">Revisão e versões</summary>
        <div className="space-y-3 pt-3">
          <AjudaRecolhida rotulo="Como revisar o conteúdo">
            Salvar prepara uma nova versão. Envie para revisão, confira o
            conteúdo, aprove e publique essa versão exata. A versão anterior
            continua disponível até a publicação. Versões aprovadas não podem
            ser editadas.
          </AjudaRecolhida>
          {dados.isError && (
            <p role="status">
              Não foi possível carregar o histórico.{" "}
              <button type="button" onClick={() => void dados.refetch()}>
                Tentar novamente
              </button>
            </p>
          )}
          {dados.data?.map((v) => (
            <article
              key={v.id}
              className="py-3 border-b border-border/50 space-y-2"
            >
              <div className="flex gap-3 items-center flex-wrap">
                <strong className="text-[13px]">{v.dados.titulo}</strong>
                <span className="text-[12px] text-muted-foreground">
                  {
                    {
                      rascunho: "Rascunho",
                      revisao: "Em revisão",
                      aprovado: "Aprovado",
                      publicado: "Publicado",
                    }[v.estado]
                  }{" "}
                  · {v.autor_nome} ·{" "}
                  {new Date(v.criado_em).toLocaleString("pt-BR")}
                </span>
              </div>
              <details className="text-[12px]">
                <summary className="cursor-pointer py-2">
                  Ver conteúdo desta versão
                </summary>
                <p className="whitespace-pre-wrap leading-6 break-words">
                  {v.dados.texto ||
                    "Material de arquivo. Confira o arquivo no editor antes de aprovar."}
                </p>
                {v.dados.arquivo && (
                  <button
                    type="button"
                    className="membros-acao"
                    onClick={() => setVerArquivo(v)}
                  >
                    Conferir arquivo desta versão
                  </button>
                )}
                <p>Visibilidade após publicar: {v.dados.estado}</p>
              </details>
              {v.estado !== "publicado" && (
                <button
                  type="button"
                  className="membros-acao"
                  onClick={() =>
                    void agir(async () => {
                      await versionarConteudo(
                        material,
                        v.estado === "rascunho"
                          ? "enviar_revisao"
                          : v.estado === "revisao"
                            ? "aprovar"
                            : "publicar",
                        undefined,
                        v.id,
                      );
                    })
                  }
                >
                  {
                    {
                      rascunho: "Enviar para revisão",
                      revisao: "Aprovar esta versão",
                      aprovado: "Publicar esta versão",
                    }[v.estado]
                  }
                </button>
              )}
            </article>
          ))}
        </div>
      </details>
      {verArquivo && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) setVerArquivo(null);
          }}
        >
          <DialogContent className="membros-modal overflow-auto">
            <DialogTitle>{verArquivo.dados.titulo}</DialogTitle>
            <DialogDescription className="sr-only">
              Arquivo exato desta versão para revisão.
            </DialogDescription>
            {fonte.isPending ? (
              <p role="status">Abrindo arquivo desta versão…</p>
            ) : fonte.isError ? (
              <p role="alert">{mensagemDoErro(fonte.error)}</p>
            ) : fonte.data ? (
              verArquivo.dados.tipo === "pdf" ||
              verArquivo.dados.arquivo?.toLowerCase().endsWith(".pdf") ? (
                <Suspense fallback={<p>Preparando PDF…</p>}>
                  <PdfSeguro
                    url={fonte.data}
                    titulo={verArquivo.dados.titulo}
                  />
                </Suspense>
              ) : verArquivo.dados.tipo === "video" ? (
                <video
                  src={fonte.data}
                  controls
                  className="w-full max-h-[65dvh]"
                />
              ) : verArquivo.dados.tipo === "audio" ? (
                <audio src={fonte.data} controls />
              ) : (
                <a
                  className="membros-acao"
                  href={fonte.data}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir arquivo para conferência
                </a>
              )
            ) : null}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
