"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { BridgeManager } from "../../core/BridgeManager";
import { DevToolsPanel } from "./DevToolsPanel";
import { DevToolsTrigger } from "./DevToolsTrigger";

interface DevToolsUIProps {
  // biome-ignore lint/suspicious/noExplicitAny: BridgeManager can have any schema type
  bridge: BridgeManager<any>;
  defaultOpen?: boolean;
}

export function DevToolsUI({ bridge, defaultOpen = false }: DevToolsUIProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "B") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }

      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isMounted) return null;

  return createPortal(
    <>
      <DevToolsTrigger
        isOpen={isOpen}
        onToggle={() => setIsOpen((prev) => !prev)}
      />

      {isOpen && (
        <DevToolsPanel bridge={bridge} onClose={() => setIsOpen(false)} />
      )}
    </>,
    document.body,
  );
}
