import { AjudaRecolhida } from "@/components/sistema";
import { useMarcaDaMesa } from "./MesaContexto";
import { useKitDaMesa } from "./kitDaMesa";
import { useSemTipografia } from "@/lib/mesa/tipografiaDoCliente";

/**
 * Aviso do kit na referência (frente R, 26/09). Sem cor válida no kit, o modo
 * replicar usa as cores da referência (não há as do cliente para usar; decisão
 * do dono, o prompt fica como está). Frente T2 (26/09, dono: "não inventar"):
 * sem fonte no kit da marca aberta a arte NÃO é gerada (a letra nunca vem da
 * referência); o bloqueio com "Sugerir da biblioteca" fica no Estúdio
 * (EstudioSemTipografia). O link leva ao Contexto. Kit completo, ou antes de a
 * leitura chegar: nada aparece. Export antigo mantido (EstudioAvisoSemFonte).
 */
export const TEXTO_SEM_FONTE = "Cliente sem fonte no kit: a arte não é gerada.";
export const TEXTO_SEM_CORES = "Cliente sem cores no kit: usando as da referência.";

/** Igual ao servidor (hexOk): só #RRGGBB conta como cor do kit. */
export function kitSemCor(kit: { paleta?: unknown } | null | undefined): boolean {
  const paleta = kit && Array.isArray(kit.paleta) ? (kit.paleta as { hex?: unknown }[]) : [];
  return !paleta.some((p) => !!p && typeof p.hex === "string" && /^#[0-9a-f]{6}$/i.test(p.hex.trim()));
}

function Linha({ texto, clientId, ajuda }: { texto: string; clientId: string; ajuda: string }) {
  return (
    <p className="flex min-w-0 items-center text-[10.5px] leading-snug text-muted-foreground">
      <span className="min-w-0 truncate">{texto}</span>
      <a href={`/mesa?client=${encodeURIComponent(clientId)}&aba=contexto`} className="ml-1 shrink-0 text-primary underline-offset-2 hover:underline">
        Definir no Contexto
      </a>
      <AjudaRecolhida rotulo="Por que aparece este aviso">{ajuda}</AjudaRecolhida>
    </p>
  );
}

export function EstudioAvisoDoKit({ clientId }: { clientId: string }) {
  const { marca } = useMarcaDaMesa();
  // Frente MC: as cores da marca aberta (CME sem cor avisa; nunca olha a paleta da Acerbi).
  const kit = useKitDaMesa(clientId);
  // Frente T2: as fontes da marca aberta (a mesma regra do servidor).
  const semFonte = useSemTipografia(clientId, marca);
  const semCor = !kit.isLoading && !kit.isError && kitSemCor(kit.data as { paleta?: unknown } | null);
  if (!semFonte && !semCor) return null;
  return (
    <div className="min-w-0" data-aviso="kit-incompleto">
      {semFonte && (
        <Linha
          texto={TEXTO_SEM_FONTE}
          clientId={clientId}
          ajuda="O kit da marca não tem fonte e o Estúdio não inventa letra nem copia a da referência. Em Contexto, em Fontes, envie a fonte ou escolha da biblioteca; no Estúdio, Sugerir da biblioteca propõe um par para você confirmar."
        />
      )}
      {semCor && (
        <Linha
          texto={TEXTO_SEM_CORES}
          clientId={clientId}
          ajuda="O kit da marca não tem cor. Sem paleta, as cores da referência ficam. Em Contexto, na marca, monte a paleta para a arte usar as cores do cliente."
        />
      )}
    </div>
  );
}

export default EstudioAvisoDoKit;
export { EstudioAvisoDoKit as EstudioAvisoSemFonte };
