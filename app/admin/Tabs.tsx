"use client";

import { useState } from "react";

/**
 * Client section switcher for the admin dashboard. Each child panel is passed
 * with a key + label; clicking an entry in the side menu swaps which panel is
 * shown beside it. Server-action forms live inside the panels (passed as
 * children from the server component), so all the server logic is untouched.
 */
export function Tabs({
  tabs,
  initial,
}: {
  tabs: { key: string; label: string; badge?: number; content: React.ReactNode }[];
  /** Which panel to open on. Lets a redirect back into the admin land on the
   *  tab it came from rather than the first tab. */
  initial?: string;
}) {
  const [active, setActive] = useState(
    tabs.some((t) => t.key === initial) ? initial : tabs[0]?.key,
  );
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="admin-shell">
      <nav className="admin-nav" aria-label="Dashboard sections">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              className="admin-nav-item"
              aria-current={on ? "page" : undefined}
              onClick={() => setActive(t.key)}
            >
              {t.label}
              {t.badge ? <span style={badgeStyle}>{t.badge}</span> : null}
            </button>
          );
        })}
      </nav>
      <div>{current?.content}</div>
    </div>
  );
}

const badgeStyle: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--on-accent)",
  borderRadius: "var(--radius-pill)",
  fontSize: 11,
  fontWeight: 700,
  padding: "0 6px",
  minWidth: 18,
  textAlign: "center",
};
