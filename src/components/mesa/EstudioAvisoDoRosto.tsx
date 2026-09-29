import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { chamarFuncao } from "@/lib/mesa/api";

/**
 * Conferência do rosto depois de gerar (frente R2): SÓ AVISO, discreto, sem
 * laço de regerar. Quando a versão usou rosto escolhido (rosto.fotos_usadas),
 * pede uma vez ao servidor (conferir_rosto: leitura por visão e Noul do Jev,
 * guardada na versão; chamar de novo não paga) e mostra o aviso só quando a
 * pessoa da arte parece outra ou a arte saiu sem ela.
 */

export type ConferenciaDoRostoNaTela = { aviso?: boolean; resumo?: string; outra_pessoa?: number | null; erro?: string | null };
export type VersaoComRosto = {
  ordem: number;
  versao: number;
  storage_path: string;
  criado_em?: string;
  verificacao?: { pendente?: boolean } | null;
  rosto?: { fotos_usadas?: unknown[] } | null;
  conferencia_rosto?: ConferenciaDoRostoNaTela | null;
};

/** Depois da conferência da lâmina (ou 3 minutos depois de nascer, se ela não veio), e só com rosto usado. */
export function deveConferirORosto(v: VersaoComRosto | null | undefined, agora: number = Date.now()): boolean {
  if (!v || !v.rosto || !Array.isArray(v.rosto.fotos_usadas) || !v.rosto.fotos_usadas.length) return false;
  if (v.conferencia_rosto) return false;
  const pendente = !!(v.verificacao && v.verificacao.pendente);
  const nasceu = v.criado_em ? Date.parse(v.criado_em) : NaN;
  return !pendente || (Number.isFinite(nasceu) && agora - nasceu > 3 * 60_000);
}

export default function EstudioAvisoDoRosto({ trabalhoId, versao }: { trabalhoId: string; versao: VersaoComRosto | null | undefined }) {
  const pedir = deveConferirORosto(versao);
  const q = useQuery({
    queryKey: ["estudio", "conferir-rosto", trabalhoId, versao ? versao.storage_path : ""],
    enabled: pedir,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const r = await chamarFuncao<{ conferencia?: ConferenciaDoRostoNaTela }>("estudio-arte", {
        acao: "conferir_rosto",
        trabalho_id: trabalhoId,
        ordem: versao!.ordem,
        versao: versao!.versao,
      });
      return (r && r.conferencia) || null;
    },
  });
  const c = (versao && versao.conferencia_rosto) || q.data || null;
  if (!c || !c.aviso) return null;
  return (
    <p className="mt-1 flex items-start text-[11.5px] leading-snug text-warning" data-aviso="rosto">
      <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {c.resumo || "Confira o rosto antes de aprovar."}
    </p>
  );
}

/**
 * Frente FS (29/09): o que falhou ao gerar ou ajustar esta versão e mudou a arte
 * (logo não lida, referência que não abriu, molde não medido, Jev fora do ar...).
 * O servidor grava em `avisos_da_geracao`; antes a lâmina saía como se tudo
 * tivesse dado certo. Só aviso, sem laço de regerar.
 */
export function avisosDaVersao(v: { avisos_da_geracao?: unknown } | null | undefined): string[] {
  const a = v && Array.isArray(v.avisos_da_geracao) ? v.avisos_da_geracao : [];
  return a.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 6);
}

export function EstudioAvisosDaGeracao({ versao }: { versao: { avisos_da_geracao?: unknown } | null | undefined }) {
  const avisos = avisosDaVersao(versao);
  if (!avisos.length) return null;
  return (
    <ul className="mt-1 space-y-0.5" data-aviso="geracao">
      {avisos.map((a, i) => (
        <li key={i} className="flex min-w-0 items-start text-[12px] leading-snug text-warning">
          <TriangleAlert className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{a}</span>
        </li>
      ))}
    </ul>
  );
}
