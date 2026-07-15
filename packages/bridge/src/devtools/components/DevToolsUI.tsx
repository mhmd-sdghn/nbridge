"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { BridgeManager } from "../../core/BridgeManager";
import type { HostRules } from "../../host/types";
import { DevToolsPanel } from "./DevToolsPanel";
import { DevToolsTrigger } from "./DevToolsTrigger";

interface DevToolsUIProps {
  // biome-ignore lint/suspicious/noExplicitAny: BridgeManager can have any schema type
  bridge: BridgeManager<any>;
  /**
   * Optional Host Rules engine. When provided, a "Host" tab renders the
   * resolved host state and dev override controls.
   */
  // biome-ignore lint/suspicious/noExplicitAny: the panel is agnostic to the app's capability/variant names
  host?: HostRules<any, any>;
  defaultOpen?: boolean;
}

export function DevToolsUI({
  bridge,
  host,
  defaultOpen = false,
}: DevToolsUIProps) {
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
        <DevToolsPanel
          bridge={bridge}
          host={host}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>,
    document.body,
  );
}
