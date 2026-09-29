import type { ReactNode } from "react";
import { motion } from "motion/react";
import { CURVA, DURACAO, useMovimentoReduzido } from "./movimento";

/** Entrada de bloco ao aparecer na tela (sobe e aparece). Com movimento reduzido, só aparece. */
export default function Revelar({ children, atraso = 0, className }: { children: ReactNode; atraso?: number; className?: string }) {
  const reduzido = useMovimentoReduzido();
  return (
    <motion.div
      className={className}
      initial={reduzido ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: DURACAO.media, ease: CURVA.saida, delay: atraso }}
    >
      {children}
    </motion.div>
  );
}
