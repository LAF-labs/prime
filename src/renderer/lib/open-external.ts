import type { MouseEvent, KeyboardEvent } from "react";
import { ipc } from "@/lib/ipc";

/** Prevent default navigation and open the URL in the OS default browser via Tauri. */
export const handleExternalLinkClick = (
  e: MouseEvent<HTMLAnchorElement>,
): void => {
  e.preventDefault();
  const href = (e.currentTarget as HTMLAnchorElement).href;
  if (href) void ipc.openUrl(href);
};

/** Open the URL on Enter key press. */
export const handleExternalLinkKeyDown = (
  e: KeyboardEvent<HTMLAnchorElement>,
): void => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const href = (e.currentTarget as HTMLAnchorElement).href;
  if (href) void ipc.openUrl(href);
};
