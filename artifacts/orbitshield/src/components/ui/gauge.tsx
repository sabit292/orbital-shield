import React from "react";
import { motion } from "framer-motion";

interface GaugeProps {
  value: number;
  max?: number;
  title: string;
  subtitle?: string;
  color?: string;
  size?: number;
}

export function Gauge({ 
  value, 
  max = 100, 
  title, 
  subtitle,
  color = "var(--color-primary)",
  size = 140
}: GaugeProps) {
  const radius = size * 0.38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / max) * circumference;

  return (
    <div className="flex flex-col items-center justify-center p-2">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        {/* Background Circle */}
        <svg className="absolute inset-0 transform -rotate-90 w-full h-full">
          <circle
            cx="50%"
            cy="50%"
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={size * 0.06}
            className="text-white/5"
          />
          {/* Animated Foreground Circle */}
          <motion.circle
            cx="50%"
            cy="50%"
            r={radius}
            fill="transparent"
            stroke={color}
            strokeWidth={size * 0.08}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.5, ease: "easeOut" }}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        
        {/* Value Display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-3xl font-bold tracking-tighter" style={{ color, textShadow: `0 0 10px ${color}` }}>
            {value}
          </span>
          {subtitle && (
            <span className="text-[10px] font-display text-muted-foreground uppercase tracking-widest -mt-1">
              {subtitle}
            </span>
          )}
        </div>
      </div>
      
      <div className="mt-3 font-display text-xs font-semibold tracking-widest text-foreground/80 text-center">
        {title}
      </div>
    </div>
  );
}
