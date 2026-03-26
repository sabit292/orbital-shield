import React from "react";
import { cn } from "@/lib/utils";
import { motion, HTMLMotionProps } from "framer-motion";

interface PanelProps extends HTMLMotionProps<"div"> {
  title?: React.ReactNode;
  glowColor?: "cyan" | "green" | "red" | "orange" | "none";
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function Panel({
  children,
  className,
  title,
  glowColor = "cyan",
  icon,
  action,
  ...props
}: PanelProps) {
  const glowClass = {
    cyan: "box-glow-cyan border-primary/30",
    green: "box-glow-green border-success/30",
    red: "box-glow-red border-danger/30",
    orange: "shadow-[0_0_15px_rgba(255,153,0,0.15)] border-warning/30",
    none: "border-border/30 shadow-none",
  }[glowColor];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn(
        "relative bg-card/60 backdrop-blur-xl border rounded-xl overflow-hidden flex flex-col",
        glowClass,
        className
      )}
      {...props}
    >
      {/* Decorative corner brackets */}
      <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-primary/50 rounded-tl-lg pointer-events-none" />
      <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-primary/50 rounded-tr-lg pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-primary/50 rounded-bl-lg pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-primary/50 rounded-br-lg pointer-events-none" />

      {title && (
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2">
            {icon && <span className="text-primary/80">{icon}</span>}
            <h3 className="font-display text-sm tracking-widest text-primary/90 font-semibold uppercase">
              {title}
            </h3>
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      
      <div className="p-4 flex-1 flex flex-col">{children}</div>
    </motion.div>
  );
}
