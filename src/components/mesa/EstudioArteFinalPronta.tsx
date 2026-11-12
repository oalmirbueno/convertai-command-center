import { useRef, useState } from "react";
import { FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import type { TrabalhoGravado } from "./estudioUtil";

/**
 * "Enviar arte final pronta" (12/11/2026). A peça foi feita fora (ex.: reserva
 * do Codex) e entra DIRETO na lâmina como nova versão, sem gastar Gerar nem
 * Preparar direção e sem chamar modelo nenhum: estudio-arte importar_arte_final,
 * que grava pelo mesmo caminho do Gerar (bucket mesa + versão em
 * estudio_trabalhos.cards). As versões anteriores ficam guardadas.
 *
 * NÃO é referência: a "Referência na hora" continua só anexando referência de
 * geração. Trabalho entregue ou em aprovação: o botão fica desligado e o
 * servidor recusa do mesmo jeito (nunca sobrescreve).
 */

export const TIPOS_DA_ARTE_FINAL = ["image/png"];
export const MAX_BYTES_DA_ARTE_FINAL = 8_000_000;

/**
 * Mesma trava do servidor (modulos/arte-final-importada.ts): entregue,
 * aprovado, agendado, arquivado ou em aprovação não ganha arte nova.
 */
export function arteFinalTravada(t: { status?: string | null; entrega_status?: string | null } | null | undefined): boolean {
  if (!t) return true;
  return ["entregue", "aprovado", "agendado", "arquivado"].includes(String(t.status || ""))
    || ["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"].includes(String(t.entrega_status || ""));
}

/** Bytes do arquivo em base64 puro (sem o prefixo "data:...;base64,"). */
export function base64DoArquivo(arquivo: Blob): Promise<string> {
  return new Promise((ok, falhou) => {
    const leitor = new FileReader();
    leitor.onerror = () => falhou(new Error("Não deu para ler o arquivo. Escolha de novo."));
    leitor.onload = () => {
      const url = String(leitor.result || "");
      const i = url.indexOf("base64,");
      if (i < 0) falhou(new Error("Não deu para ler o arquivo. Escolha de novo."));
      else ok(url.slice(i + 7));
    };
    leitor.readAsDataURL(arquivo);
  });
}

/** Recusa na hora o que o servidor recusaria (tipo e tamanho); null = pode enviar. */
export function problemaDoArquivo(arquivo: File): string | null {
  if (!TIPOS_DA_ARTE_FINAL.includes(String(arquivo.type || "").toLowerCase())) return "Use uma imagem PNG.";
  if (arquivo.size > MAX_BYTES_DA_ARTE_FINAL) return "A arte final deve ter até 8 MB.";
  if (arquivo.size < 32) return "O arquivo está vazio.";
  return null;
}

const novoPedido = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

export default function EstudioArteFinalPronta({
  trabalhoId,
  ordem,
  versaoAtual,
  bloqueado = false,
  motivoDoBloqueio,
  onGravado,
}: {
  trabalhoId: string;
  ordem: number;
  /** Maior versão da lâmina agora (0 = ainda sem arte). */
  versaoAtual: number;
  bloqueado?: boolean;
  motivoDoBloqueio?: string;
  onGravado: (r: { trabalho?: TrabalhoGravado; versao?: number }) => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const [esperando, setEsperando] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const temArte = versaoAtual > 0;
  const rotulo = temArte ? "Substituir arte final" : "Enviar arte final pronta";

  const enviar = async (arquivo: File) => {
    setEnviando(true);
    try {
      const r = await chamarFuncao<{ trabalho?: TrabalhoGravado; versao?: number; aviso?: string | null; ja_guardado?: boolean }>("estudio-arte", {
        acao: "importar_arte_final",
        trabalho_id: trabalhoId,
        ordem,
        versao_esperada: versaoAtual,
        pedido_id: novoPedido(),
        imagem_base64: await base64DoArquivo(arquivo),
      });
      onGravado(r || {});
      toast.success(`Arte final na lâmina ${ordem}${r && r.versao ? ` (v${r.versao})` : ""}`, {
        description: (r && r.aviso) || "Entrou direto na lâmina, sem gastar Gerar. A versão anterior fica guardada em Versões.",
      });
    } catch (e) {
      toast.error("A arte final não entrou na lâmina", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  const escolheu = (arquivo: File | undefined) => {
    if (campo.current) campo.current.value = "";
    if (!arquivo) return;
    if (bloqueado) {
      toast.error(motivoDoBloqueio || "Agora não dá para trocar a arte desta lâmina.");
      return;
    }
    const problema = problemaDoArquivo(arquivo);
    if (problema) {
      toast.error("Arquivo não aceito", { description: problema });
      return;
    }
    // Já tem arte: pergunta antes de trocar (a anterior não se perde, mas deixa de ser a atual).
    if (temArte) setEsperando(arquivo);
    else void enviar(arquivo);
  };

  return (
    <section
      aria-label="Arte final da lâmina"
      data-arte-final-pronta=""
      className="min-w-0 rounded-md border border-dashed border-border p-2.5"
    >
      <div className="flex min-w-0 items-center">
        <FileCheck2 className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[12px] font-medium">
          Arte final da lâmina {ordem} <span className="font-normal text-muted-foreground">(não é referência)</span>
        </p>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Use quando a arte já está pronta. Ela entra direto na lâmina, sem gastar Gerar.
      </p>
      <input
        ref={campo}
        type="file"
        accept={TIPOS_DA_ARTE_FINAL.join(",")}
        className="hidden"
        aria-label={`Arquivo da arte final da lâmina ${ordem}`}
        data-testid="arquivo-arte-final"
        onChange={(e) => escolheu(e.target.files?.[0])}
      />
      {esperando ? (
        <div className="mt-2 min-w-0 space-y-1.5" role="alertdialog" aria-label="Confirmar troca da arte final">
          <p className="text-[12px] [overflow-wrap:anywhere]">
            Trocar a arte atual da lâmina {ordem} por <span className="font-medium">{esperando.name}</span>? A atual fica guardada em Versões.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-[12px]"
              disabled={enviando}
              onClick={() => {
                const a = esperando;
                setEsperando(null);
                void enviar(a);
              }}
            >
              Sim, substituir
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-[12px]" onClick={() => setEsperando(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 h-7 px-2.5 text-[12px]"
          disabled={bloqueado || enviando}
          title={bloqueado ? motivoDoBloqueio : undefined}
          onClick={() => campo.current?.click()}
        >
          {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          {enviando ? "Enviando…" : rotulo}
        </Button>
      )}
      {bloqueado && motivoDoBloqueio ? <p className="mt-1 text-[11px] text-muted-foreground">{motivoDoBloqueio}</p> : null}
    </section>
  );
}
