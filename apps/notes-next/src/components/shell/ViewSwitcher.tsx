"use client"

import { usePathname, useRouter } from "next/navigation"
import { FilterablePicker } from "@/components/ui/FilterablePicker"
import { ITEM_VIEWS, viewForPath } from "@/views/registry"

const viewOptions = ITEM_VIEWS.map(({ route, kind }) => ({ id: route, label: kind }))

export function ViewSwitcher({ triggerClassName }: { triggerClassName?: string }) {
  const active = viewForPath(usePathname())
  const router = useRouter()

  return (
    <FilterablePicker
      variant="prominent"
      value={active.kind}
      triggerClassName={triggerClassName}
      caretPosition="end"
      triggerAriaLabel={`Content type, ${active.kind}`}
      listboxAriaLabel="Content types"
      options={viewOptions}
      selectedIds={[active.route]}
      onSelectOption={({ id }) => {
        if (id !== active.route) router.push(String(id))
      }}
      placement={["bottom-start", "bottom-end", "top-start", "top-end"]}
    />
  )
}
