import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ClipboardCopy, Download, Globe, ImageOff, Loader2, Palette, Type,
} from "lucide-react";
import {
  extrairPaleta, identidadeEmTexto, textoSobre, type CorDaMarca,
} from "@/lib/identidadeVisual";

/**
 * A identidade da marca, extraída do que o Instagram realmente entrega.
 *
 * Logo, nome, bio e site vêm do perfil. As cores saem dos pixels da
 * própria logo. A TIPOGRAFIA não vem de lugar nenhum: a fonte da marca
 * vive dentro de imagens achatadas, e um "Montserrat" inventado aqui
 * seria copiado para um briefing e viraria decisão baseada num palpite.
 * Por isso ela é campo que você preenche, e a tela diz isso.
 */

export default function IdentidadeDoCliente({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [cores, setCores] = useState<CorDaMarca[]>([]);
  const [erroDaPaleta, setErroDaPaleta] = useState<string | null>(null);
  const [lendoCores, setLendoCores] = useState(false);
  const [tipografia, setTipografia] = useState("");

  const { data: ident, error, isLoading } = useQuery({
    queryKey: ["identidade-do-cliente", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_client_identity")
        .select("username, display_name, biography, website, profile_picture_url, captured_at")
        .eq("client_id", clientId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Record<string, any> | null;
    },
  });

  const logo = ident?.profile_picture_url as string | undefined;

  useEffect(() => {
    if (!logo) { setCores([]); setErroDaPaleta(null); return; }
    let cancelado = false;
    setLendoCores(true);
    setErroDaPaleta(null);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      if (cancelado) return;
      try {
        // 64×64 basta: a paleta não melhora com mais pixels, e ler a
        // imagem inteira travaria a interface por nada.
        const lado = 64;
        const canvas = document.createElement("canvas");
        canvas.width = lado; canvas.height = lado;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("sem contexto de canvas");
        ctx.drawImage(img, 0, 0, lado, lado);
        setCores(extrairPaleta(ctx.getImageData(0, 0, lado, lado).data, 6));
      } catch (e) {
        // A CDN da Meta costuma recusar CORS. Dizer isso é melhor que
        // mostrar uma paleta inventada — cor errada num briefing vira
        // arte errada.
        setErroDaPaleta(
          "O servidor da imagem não deixa o painel ler os pixels (CORS). "
          + "Baixe a logo e tire as cores dela, ou preencha à mão.",
        );
        setCores([]);
      } finally {
        setLendoCores(false);
      }
    };
    img.onerror = () => {
      if (cancelado) return;
      setErroDaPaleta("Não consegui carregar a logo para ler as cores.");
      setLendoCores(false);
    };
    img.src = logo;
    return () => { cancelado = true; };
  }, [logo]);

  const copiar = async (texto: string, oque: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${oque} copiado`);
    } catch {
      toast.error("O navegador bloqueou a cópia");
    }
  };

  const baixarLogo = () => {
    // Abre em nova aba em vez de forçar download: a CDN da Meta não manda
    // o cabeçalho que permitiria salvar direto, e um link que não baixa é
    // pior que um link que abre.
    if (logo) window.open(logo, "_blank", "noopener,noreferrer");
  };

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-secondary p-3 text-[12px] text-destructive">
        Não consegui ler a identidade: {error instanceof Error ? error.message : String(error)}.
      </div>
    );
  }
  if (isLoading) {
    return <p className="py-4 text-center text-[11px] text-muted-foreground">carregando identidade…</p>;
  }
  if (!ident) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-[12px] text-muted-foreground">
        Nenhuma identidade capturada para <strong className="text-foreground">{clientName}</strong> ainda.
        Ela vem junto com a coleta do Instagram: assim que a conta estiver conectada e o
        painel ler o perfil, logo, bio e site aparecem aqui.
      </div>
    );
  }

  const textoCompleto = identidadeEmTexto({
    nome: clientName,
    username: ident.username,
    site: ident.website,
    bio: ident.biography,
    cores,
    tipografia,
  });

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          {logo ? (
            <img
              src={logo}
              alt={`Logo de ${clientName}`}
              referrerPolicy="no-referrer"
              className="h-20 w-20 shrink-0 rounded-2xl border border-border object-cover"
            />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-secondary">
              <ImageOff className="h-6 w-6 text-muted-foreground" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-foreground">
              {ident.display_name || clientName}
            </p>
            {ident.username && (
              <p className="text-[11.5px] text-muted-foreground">@{ident.username}</p>
            )}
            {ident.website && (
              <a
                href={ident.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 break-all text-[11.5px] text-primary underline"
              >
                <Globe className="h-3 w-3 shrink-0" /> {ident.website}
              </a>
            )}
            {ident.biography && (
              <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-foreground/85">
                {ident.biography}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            {logo && (
              <button
                type="button"
                onClick={baixarLogo}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3 w-3" /> Logo
              </button>
            )}
            <button
              type="button"
              onClick={() => void copiar(textoCompleto, "Identidade")}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <ClipboardCopy className="h-3 w-3" /> Copiar tudo
            </button>
          </div>
        </div>
      </div>

      {/* AS CORES, com o peso de cada uma na imagem. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Palette className="h-3.5 w-3.5 text-primary" /> Cores da logo
          {lendoCores && <Loader2 className="h-3 w-3 animate-spin" />}
        </p>
        {erroDaPaleta ? (
          <p className="rounded-lg border border-warning/30 bg-warning/[0.06] p-2.5 text-[11.5px] text-warning">
            {erroDaPaleta}
          </p>
        ) : cores.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">
            {lendoCores ? "lendo os pixels da logo…" : "Sem logo para extrair cores."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {cores.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => void copiar(c.hex, c.hex)}
                  title={`${c.hex} · ${(c.proporcao * 100).toFixed(1)}% da imagem · clique para copiar`}
                  className="flex h-16 w-20 flex-col items-center justify-center rounded-lg border border-border transition-transform hover:scale-105"
                  style={{ background: c.hex, color: textoSobre(c.hex) }}
                >
                  <span className="font-mono text-[10.5px] font-semibold">{c.hex}</span>
                  <span className="text-[9px] opacity-80">{(c.proporcao * 100).toFixed(0)}%</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              Extraídas por frequência de pixel na logo, agrupando tons próximos —
              o número é quanto da imagem cada cor ocupa. Clique para copiar o código.
            </p>
          </>
        )}
      </div>

      {/* A TIPOGRAFIA, que ninguém consegue extrair. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Type className="h-3.5 w-3.5 text-info" /> Tipografia
        </p>
        <input
          value={tipografia}
          onChange={(e) => setTipografia(e.target.value)}
          placeholder="Ex: Poppins nos títulos, Inter no corpo"
          className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/60"
        />
        <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
          Este campo é seu de propósito. O Instagram não expõe a fonte da marca — ela
          está achatada dentro das imagens —, e um nome de fonte chutado aqui seria
          copiado para um briefing e viraria decisão de marca baseada num palpite do
          painel. Preferi deixar em branco a preencher com invenção.
        </p>
      </div>
    </div>
  );
}
