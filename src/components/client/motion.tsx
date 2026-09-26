import { MotionConfig, motion, type Variants } from "framer-motion";
import { type ReactNode } from "react";

/* ─── Shared animation variants ───
 * Só a entrada, uma vez, ao abrir a tela (docs/design/SISTEMA.md, "nada
 * pisca"): nada em loop, nada que alterne sozinho. Quem pediu menos movimento
 * no aparelho não vê o deslize (MotionConfig reducedMotion="user").
 */

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export const slideRight: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

/* ─── Wrapper components for cleaner JSX ─── */

export function StaggerContainer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className={className}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}

export function FadeUp({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={fadeUp} className={className}>
      {children}
    </motion.div>
  );
}

export function FadeScale({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={fadeScale} className={className}>
      {children}
    </motion.div>
  );
}
