"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ITEM_VIEWS, viewForPath } from "@/views/registry"
import styles from "./ViewSwitcher.module.css"

/**
 * Links to each view of the workspace's items. Moving between views keeps the
 * workspace, the open items, and any pending saves: only the main column changes.
 */
export function ViewSwitcher() {
  const active = viewForPath(usePathname())

  return (
    <nav className={styles.switcher} aria-label="Views">
      {ITEM_VIEWS.map((view) => (
        <Link
          key={view.kind}
          href={view.route}
          className={`${styles.link} ${view === active ? styles.linkActive : ""}`}
          aria-current={view === active ? "page" : undefined}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  )
}
