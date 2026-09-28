import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ClipboardCopy, Download, Globe, ImageOff, Palette } from "lucide-react";
import { Carregando, EstadoDeErro, EstadoVazio, Secao, botao, campo, espaco, foco, juntar, texto } from "@/components/sistema";
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
        // mostrar uma paleta inventada: cor errada num briefing vira
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

  const copiar = async (valor: string, oque: string) => {
    try {
      await navigator.clipboard.writeText(valor);
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
      <EstadoDeErro
        titulo="Não consegui ler a identidade."
        descricao={error instanceof Error ? error.message : String(error)}
      />
    );
  }
  if (isLoading) {
    return <Carregando rotulo="Carregando identidade" linhas={3} />;
  }
  if (!ident) {
    return (
      <EstadoVazio
        icone={<ImageOff className="h-5 w-5" />}
        titulo={`Nenhuma identidade capturada para ${clientName} ainda`}
        descricao="Vem com a coleta do Instagram: logo, bio e site aparecem aqui."
      />
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
    <div className={espaco.pagina}>
      {/* O perfil: logo, nome, @, site e bio. Aberto, sem caixa (SISTEMA.md 4.1). */}
      <div className="flex min-w-0 items-start">
        {logo ? (
          <img
            src={logo}
            alt={`Logo de ${clientName}`}
            referrerPolicy="no-referrer"
            className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-muted">
            <ImageOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </span>
        )}
        <div className="ml-4 min-w-0 flex-1">
          <p className={juntar(texto.tituloSecao, "truncate")}>{ident.display_name || clientName}</p>
          {ident.username && <p className={juntar(texto.auxiliar, "truncate")}>@{ident.username}</p>}
          {ident.website && (
            <a
              href={ident.website}
              target="_blank"
              rel="noopener noreferrer"
              title={ident.website}
              className={juntar("mt-1 flex min-w-0 items-center text-[12px] text-primary underline", foco)}
            >
              <Globe className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{ident.website}</span>
            </a>
          )}
          {ident.biography && (
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-5 text-foreground/85">{ident.biography}</p>
          )}
        </div>
        <div className="ml-3 flex shrink-0 flex-col [&>*+*]:mt-1.5">
          {logo && (
            <button type="button" onClick={baixarLogo} className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")}>
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Logo
            </button>
          )}
          <button
            type="button"
            onClick={() => void copiar(textoCompleto, "Identidade")}
            className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")}
          >
            <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar tudo
          </button>
        </div>
      </div>

      {/* AS CORES, com o peso de cada uma na imagem. */}
      <Secao
        divisoria
        titulo="Cores da logo"
        descricao={lendoCores ? "Lendo os pixels da logo" : cores.length ? `${cores.length} ${cores.length === 1 ? "cor" : "cores"}` : undefined}
        ajuda="Extraídas por frequência de pixel na logo, agrupando tons próximos: o número é quanto da imagem cada cor ocupa. Clique para copiar o código."
      >
        {erroDaPaleta ? (
          <p className="flex min-w-0 items-start text-[12px] leading-5 text-warning" role="status">
            <Palette className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {erroDaPaleta}
          </p>
        ) : cores.length === 0 ? (
          <p className={texto.auxiliar}>{lendoCores ? "Lendo os pixels da logo" : "Sem logo para extrair cores."}</p>
        ) : (
          <div className="-m-0.5 flex flex-wrap [&>*]:m-0.5">
            {cores.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => void copiar(c.hex, c.hex)}
                title={`${c.hex} · ${(c.proporcao * 100).toFixed(1)}% da imagem · clique para copiar`}
                className={juntar("flex h-16 w-20 flex-col items-center justify-center rounded-md border border-border transition-transform hover:scale-105", foco)}
                style={{ background: c.hex, color: textoSobre(c.hex) }}
              >
                <span className="font-mono text-[11px] font-semibold">{c.hex}</span>
                <span className="text-[11px] opacity-80">{(c.proporcao * 100).toFixed(0)}%</span>
              </button>
            ))}
          </div>
        )}
      </Secao>

      {/* A TIPOGRAFIA, que ninguém consegue extrair: campo seu, nunca palpite. */}
      <Secao
        divisoria
        titulo="Tipografia"
        descricao={tipografia.trim() ? "Preenchida" : "Em branco"}
        ajuda="Este campo é seu de propósito. O Instagram não expõe a fonte da marca (ela está achatada dentro das imagens), e um nome de fonte chutado aqui seria copiado para um briefing e viraria decisão de marca baseada num palpite do painel. Preferi deixar em branco a preencher com invenção."
      >
        <input
          value={tipografia}
          onChange={(e) => setTipografia(e.target.value)}
          placeholder="Ex: Poppins nos títulos, Inter no corpo"
          aria-label="Tipografia da marca"
          className={juntar(campo, "max-w-xl")}
        />
      </Secao>
    </div>
  );
}
