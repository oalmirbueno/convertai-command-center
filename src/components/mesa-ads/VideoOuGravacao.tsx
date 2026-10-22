import { lazy, Suspense } from "react";
import { Sparkles, Video } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import type { Angulo, CriativoAds, PlanoAds } from "./adsApi";

const VideoDoCriativo = lazy(() => import("./VideoDoCriativo"));
const GravarDoCriativo = lazy(() => import("./GravarDoCriativo"));

/**
 * Área de vídeo do criativo (Mesa Ads > Estúdio, 23/10/2026): "Gerar com IA"
 * é o gerador do Higgsfield, intocado (mesmo componente, mesmas props);
 * "Gravar nós mesmos" é o roteiro para a equipe gravar (GravarDoCriativo).
 * A escolha fica lembrada por cliente.
 */
export type ModoDoVideo = "ia" | "gravar";

const OPCOES = [
  { valor: "ia", rotulo: "Gerar com IA", icone: <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> },
  { valor: "gravar", rotulo: "Gravar nós mesmos", icone: <Video className="h-3.5 w-3.5" aria-hidden="true" /> },
];

export default function VideoOuGravacao({ criativo, referencia, plano, angulo }: { criativo: CriativoAds; referencia?: string | null; plano?: PlanoAds | null; angulo?: Angulo | null }) {
  const { clientId } = useMesa();
  const [modo, setModo] = useEstadoDaTela<ModoDoVideo>(`ads:video:modo:v1:${clientId}`, "ia");
  return (
    <div className="min-w-0 space-y-3" data-video-ou-gravacao={modo}>
      <SeletorCompacto rotulo="Como fazer o vídeo" opcoes={OPCOES} valor={modo} onEscolher={(v) => setModo(v === "gravar" ? "gravar" : "ia")} />
      <Suspense fallback={<p role="status">Abrindo…</p>}>
        {modo === "gravar"
          ? <GravarDoCriativo key={criativo.id} criativo={criativo} plano={plano} angulo={angulo} />
          : <VideoDoCriativo key={criativo.id} criativo={criativo} plano={plano} angulo={angulo} referencia={referencia} />}
      </Suspense>
    </div>
  );
}
