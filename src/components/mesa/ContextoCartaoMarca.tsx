import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Library, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chamarFuncao, padraoDoContexto, type ParteDaEstimativa } from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { BotaoComCusto, avisarCustoReal } from "./Custo";
import BibliotecaDeFontes, { type PapelDaEscolha } from "./ContextoBibliotecaDeFontes";
import LogosDaMarca from "./ContextoLogos";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useMesa } from "./MesaContexto";
import {
  chaveDasFontes,
  temTexto,
  useFontesDoCliente,
  useInvalidarContexto,
  type CandidatoALogo,
  type CorDoKit,
  type KitDoContexto,
} from "./contextoDoCliente";

/**
 * Cartão Marca do Contexto: logo principal e alternativa, paleta em chips e
 * as fontes de título e texto com a amostra. Tudo pode ser trocado dali
 * mesmo; o editor completo continua em Detalhes.
 */

const ROTULO_DA_ORIGEM: Record<string, string> = { biblioteca: "biblioteca", upload: "enviada", documento: "documento" };

/**
 * Estimativa do "Sugerir automaticamente": o Jev não mora no catálogo de
 * modelos, então a conta usa o modelo do contexto com o tamanho da pergunta
 * (cerca de 40 pares de fontes com o contexto da marca). É aproximada; o custo
 * real vem na resposta.
 */
const TOKENS_DA_SUGESTAO = { entrada: 6000, saida: 100 };

export function ChipsDaPaleta({ paleta }: { paleta: CorDoKit[] }) {
  return (
    <ul className="flex min-w-0 flex-wrap">
      {paleta.map((c, i) => (
        <li
          key={`${c.hex}-${i}`}
          title={[c.nome, c.papel, c.hex].filter(Boolean).join(" · ")}
          className="mb-1.5 mr-1.5 flex min-w-0 max-w-full items-center rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2"
        >
          <span className="mr-1.5 h-5 w-5 shrink-0 rounded-full border border-border" style={{ backgroundColor: c.hex }} />
          <span className="shrink-0 font-mono text-[11px] text-foreground">{c.hex}</span>
          {temTexto(c.nome) && <span className="ml-1.5 min-w-0 truncate text-[11px] text-muted-foreground">{c.nome}</span>}
        </li>
      ))}
    </ul>
  );
}

function Subtitulo({ children, acao }: { children: string; acao?: ReactNode }) {
  return (
    <div className="mb-1.5 flex min-w-0 items-center justify-between">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</p>
      {acao}
    </div>
  );
}

export function FontesDaMarca() {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const fontes = useFontesDoCliente(clientId);
  const [galeria, setGaleria] = useState<PapelDaEscolha | null>(null);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const lista = fontes.data || [];
  const modelo = padraoDoContexto(catalogo);

  const papeis: { papel: PapelDaEscolha; rotulo: string }[] = [
    { papel: "titulo", rotulo: "Título" },
    { papel: "texto", rotulo: "Texto" },
  ];
  const outras = lista.filter((f) => f.papel !== "titulo" && f.papel !== "texto");
  const comAmostra = papeis
    .map((p) => lista.find((f) => f.papel === p.papel))
    .filter((f): f is NonNullable<typeof f> => !!f && !!f.amostra_path);
  const ampliaveis: ImagemAmpliavel[] = comAmostra.map((f) => ({ caminho: f.amostra_path!, bucket: "mesa", titulo: f.nome, legenda: "Amostra da fonte" }));

  return (
    <div className="min-w-0">
      <Subtitulo
        acao={
          <button type="button" onClick={() => setGaleria("titulo")} className="inline-flex items-center text-[11.5px] font-medium text-foreground hover:underline">
            <Library className="mr-1 h-3.5 w-3.5" />
            Escolher da biblioteca
          </button>
        }
      >
        Fontes
      </Subtitulo>
      <ul className="space-y-1.5">
        {papeis.map(({ papel, rotulo }) => {
          const f = lista.find((x) => x.papel === papel);
          const indice = f ? comAmostra.indexOf(f) : -1;
          return (
            <li key={papel} className="flex min-w-0 items-center rounded-lg border border-border bg-card p-1.5">
              <button
                type="button"
                onClick={() => (indice >= 0 ? setAmpliada(indice) : setGaleria(papel))}
                className="mr-2.5 flex h-11 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white"
                aria-label={f ? `Ver a amostra de ${f.nome} maior` : `Escolher a fonte de ${rotulo.toLowerCase()}`}
                title={f ? "Ver maior" : "Escolher na biblioteca"}
              >
                {f && f.amostra_path ? (
                  <MiniaturaDoStorage bucket="mesa" caminho={f.amostra_path} alt={`Amostra de ${f.nome}`} largura={360} ajuste="contain" className="h-full w-full" />
                ) : (
                  <span className="text-[10px] text-neutral-500">{fontes.isLoading ? "..." : "sem amostra"}</span>
                )}
              </button>
              <span className="min-w-0 flex-1">
                <span className="block text-[10.5px] uppercase tracking-wider text-muted-foreground">{rotulo}</span>
                <span className={`block truncate text-[12.5px] font-medium ${f ? "text-foreground" : "text-muted-foreground"}`} title={f ? f.nome : undefined}>
                  {f ? f.nome : fontes.isLoading ? "Lendo..." : "Sem fonte"}
                </span>
              </span>
              {f && ROTULO_DA_ORIGEM[f.origem] && (
                <span className="ml-2 hidden shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground sm:inline">{ROTULO_DA_ORIGEM[f.origem]}</span>
              )}
              <Button type="button" size="sm" variant="ghost" className="ml-1 h-7 shrink-0 px-2 text-[11.5px]" onClick={() => setGaleria(papel)}>
                {f ? "Trocar" : "Escolher"}
              </Button>
            </li>
          );
        })}
      </ul>
      {outras.length > 0 && (
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
          Também: {outras.map((f) => f.nome).join(", ")}
        </p>
      )}
      {fontes.data && lista.length === 0 && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center">
          <BotaoComCusto
            rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />Sugerir automaticamente</>}
            titulo="Fontes sugeridas da biblioteca"
            descricao="O Jev escolhe um par de título e texto da biblioteca da agência pelo contexto da marca. Custa centavos; o custo real aparece ao terminar."
            variant="outline"
            className="mb-1 mr-2 h-7 text-[11.5px]"
            fecharAoConfirmar
            partes={(): ParteDaEstimativa[] => [
              { modeloId: modelo?.id, tipo: "texto", tokensEntrada: TOKENS_DA_SUGESTAO.entrada, tokensSaida: TOKENS_DA_SUGESTAO.saida },
            ]}
            executar={() => chamarFuncao<any>("agente-contexto", { acao: "fontes_da_biblioteca", client_id: clientId })}
            aoConcluir={(data) => {
              const f = data && data.fontes_escolhidas;
              avisarCustoReal(f && temTexto(f.titulo) ? `Fontes escolhidas: ${f.titulo} e ${f.texto}` : "Fontes escolhidas da biblioteca", data, atualizarCusto);
              void queryClient.invalidateQueries({ queryKey: chaveDasFontes(clientId) });
              invalidar(clientId);
            }}
          />
          <span className="mb-1 text-[11px] text-muted-foreground">ou escolha você na galeria.</span>
        </div>
      )}
      <BibliotecaDeFontes aberto={!!galeria} onOpenChange={(v) => !v && setGaleria(null)} papelInicial={galeria || undefined} />
      <Ampliar imagens={ampliaveis} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

export default function CartaoMarca({
  kit,
  candidatos,
  carregando,
  onEditar,
}: {
  kit: KitDoContexto | null | undefined;
  candidatos: CandidatoALogo[];
  carregando: boolean;
  onEditar?: () => void;
}) {
  const paleta = Array.isArray(kit?.paleta) ? kit!.paleta! : [];
  return (
    <div className="flex min-w-0 flex-1 flex-col space-y-4">
      <div className="min-w-0">
        <Subtitulo>Logo</Subtitulo>
        <LogosDaMarca kit={kit} candidatos={candidatos} compacto />
      </div>
      <div className="min-w-0">
        <Subtitulo
          acao={
            onEditar ? (
              <button type="button" onClick={onEditar} className="text-[11.5px] font-medium text-foreground hover:underline">
                Editar
              </button>
            ) : undefined
          }
        >
          Paleta
        </Subtitulo>
        {carregando && !kit ? (
          <div className="flex">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="mr-1.5 h-6 w-20 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
        ) : paleta.length ? (
          <ChipsDaPaleta paleta={paleta} />
        ) : (
          <p className="text-[12px] text-muted-foreground">Sem paleta. Edite a Marca ou conte ao agente as cores da marca.</p>
        )}
      </div>
      <FontesDaMarca />
    </div>
  );
}
