"use client";
import { AnimatePresence, motion } from "motion/react";

// KPI value transition (§6): old value fades up and out, new one rises in.
// 300ms, absolute-positioned exit layer → no layout shift. Honors
// prefers-reduced-motion via the page-level MotionConfig.
export default function AnimatedValue({ value, className, style }: {
  value: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className="relative inline-block overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className={`inline-block ${className ?? ""}`}
          style={style}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -12, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
