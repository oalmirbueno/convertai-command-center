import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { chamarFuncao, padraoDoContexto, padraoPara, TAMANHOS, type ParteDaEstimativa } from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useMesa } from "./MesaContexto";
import { Quadrado } from "./NavegadorDePastas";
import { useReferenciasDoCliente, type ReferenciaDoCliente, type RespostaDoMontar } from "./contextoDoCliente";

/**
 * Galeria das referências do cliente no Contexto: todas as ativas, de onde
 * vierem (pasta de referências do Workspace, artes aprovadas, Pinterest,
 * envio), com o selo identidade ou técnica e um ponto nas que ainda não
 * foram lidas. O clique abre a imagem grande com a leitura como legenda.
 */

type Filtro = "todas" | "identidade" | "tecnica";

const ROTULO_DO_PAPEL: Record<ReferenciaDoCliente["papel"], string> = { identidade: "identidade", tecnica: "técnica" };
const NA_TELA = 12;
/** O servidor lê no máximo 12 referências por vez (MAX_LEITURAS_POR_VEZ). */
const LEITURAS_POR_VEZ = 12;

export function legendaDaReferencia(r: ReferenciaDoCliente): string {
  return r.leitura && r.leitura.trim() ? r.leitura.trim() : 'Ainda sem leitura. Use "Ler as pendentes" para o agente descrever a técnica desta peça.';
}

export default function GaleriaDeReferencias({
  contextoMontado,
  onGerenciar,
  aoLer,
}: {
  /** Com o contexto já montado, o "montar" só lê as pendentes (e escolhe fonte se faltar). */
  contextoMontado: boolean;
  onGerenciar?: () => void;
  aoLer?: (data: RespostaDoMontar | null) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const refs = useReferenciasDoCliente(clientId);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [todas, setTodas] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);

  const ativas = useMemo(() => (refs.data || []).filter((r) => r.ativa), [refs.data]);
  const contagem = {
    todas: ativas.length,
    identidade: ativas.filter((r) => r.papel === "identidade").length,
    tecnica: ativas.filter((r) => r.papel === "tecnica").length,
  };
  const semLeitura = ativas.filter((r) => !(r.leitura && r.leitura.trim())).length;
  const lista = filtro === "todas" ? ativas : ativas.filter((r) => r.papel === filtro);
  const visiveis = todas ? lista : lista.slice(0, NA_TELA);

  const comImagem = visiveis.filter((r) => !!r.imagem);
  const ampliaveis: ImagemAmpliavel[] = comImagem.map((r) => ({
    caminho: r.imagem!.caminho,
    bucket: r.imagem!.bucket,
    titulo: `${r.nome} · ${ROTULO_DO_PAPEL[r.papel]}`,
    legenda: legendaDaReferencia(r),
  }));

  const leitor = padraoPara(catalogo, "leitura");
  const modeloDoContexto = padraoDoContexto(catalogo);
  const partes = (): ParteDaEstimativa[] => {
    const p: ParteDaEstimativa[] = [
      {
        modeloId: leitor?.id,
        tipo: "texto",
        tokensEntrada: TAMANHOS.lerReferencia.entrada,
        tokensSaida: TAMANHOS.lerReferencia.saida,
        vezes: Math.min(semLeitura, LEITURAS_POR_VEZ),
      },
    ];
    // Sem contexto montado, o "montar" faz a montagem inteira junto.
    if (!contextoMontado) {
      p.push({ modeloId: modeloDoContexto?.id, tipo: "texto", tokensEntrada: TAMANHOS.montarContexto.entrada, tokensSaida: TAMANHOS.montarContexto.saida });
    }
    return p;
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-2.5 flex min-w-0 flex-wrap items-center">
        <div role="group" aria-label="Filtrar referências" className="mr-auto flex min-w-0 flex-wrap">
          {(["todas", "identidade", "tecnica"] as Filtro[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              aria-pressed={filtro === f}
              className={`mb-1 mr-1 rounded-full px-2.5 py-0.5 text-[11.5px] ${
                filtro === f ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "todas" ? "Todas" : f === "identidade" ? "Identidade" : "Técnica"} {contagem[f]}
            </button>
          ))}
        </div>
        {semLeitura > 0 && (
          <BotaoComCusto
            rotulo={`Ler as pendentes (${Math.min(semLeitura, LEITURAS_POR_VEZ)})`}
            titulo="Ler as referências pendentes"
            descricao="O leitor descreve a técnica de cada referência sem leitura (até 12 por vez) para o diretor de arte usar. Com o contexto já montado, nada mais é refeito; se faltar fonte, escolhe um par da biblioteca."
            variant="outline"
            className="mb-1 h-7 text-[11.5px]"
            partes={partes}
            executar={() => chamarFuncao<RespostaDoMontar>("agente-contexto", { acao: "montar", client_id: clientId })}
            aoConcluir={(data) => aoLer?.(data)}
          />
        )}
      </div>

      {refs.isError && <AvisoDeErro erro={refs.error} />}

      {refs.isLoading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Quadrado key={i}>
              <span className="block h-full w-full animate-pulse bg-muted" />
            </Quadrado>
          ))}
        </div>
      ) : lista.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-[12.5px] text-muted-foreground">
            {ativas.length
              ? "Nenhuma referência neste filtro."
              : 'Nenhuma referência ainda. Crie no Workspace uma pasta com "Referências" no nome, ou importe um pin e envie imagens em Gerenciar.'}
          </p>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {visiveis.map((r) => {
              const lida = !!(r.leitura && r.leitura.trim());
              const indice = comImagem.indexOf(r);
              return (
                <li key={r.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (indice >= 0) setAberta(indice);
                    }}
                    title={`${r.nome}${lida ? "" : " · sem leitura"}`}
                    aria-label={`Ver maior: ${r.nome}, ${ROTULO_DO_PAPEL[r.papel]}${lida ? "" : ", sem leitura"}`}
                    className="block w-full rounded-lg text-left outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <Quadrado className="border border-border">
                      {r.imagem ? (
                        <MiniaturaDoStorage bucket={r.imagem.bucket} caminho={r.imagem.caminho} alt={r.nome} className="h-full w-full" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground">sem imagem</span>
                      )}
                      <span
                        className={`absolute left-1 top-1 rounded px-1 py-px text-[9.5px] font-medium ${
                          r.papel === "identidade" ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground"
                        }`}
                      >
                        {ROTULO_DO_PAPEL[r.papel]}
                      </span>
                      {!lida && (
                        <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-warning" aria-hidden="true" />
                      )}
                    </Quadrado>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between text-[11px] text-muted-foreground">
            <span className="mb-1 mr-2 flex items-center">
              {semLeitura > 0 ? (
                <>
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
                  {semLeitura === 1 ? "1 sem leitura" : `${semLeitura} sem leitura`}
                </>
              ) : (
                "Todas lidas pelo agente"
              )}
            </span>
            <span className="mb-1 flex items-center">
              {refs.isFetching && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {lista.length > NA_TELA && (
                <button type="button" onClick={() => setTodas((v) => !v)} className="mr-3 font-medium text-foreground hover:underline">
                  {todas ? "Mostrar menos" : `Ver todas (${lista.length})`}
                </button>
              )}
              {onGerenciar && (
                <button type="button" onClick={onGerenciar} className="font-medium text-foreground hover:underline">
                  Gerenciar
                </button>
              )}
            </span>
          </div>
        </>
      )}

      <Ampliar imagens={ampliaveis} indice={aberta} onFechar={() => setAberta(null)} />
    </div>
  );
}
