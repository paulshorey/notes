"use client"

import { CaretDown } from "@phosphor-icons/react"
import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { FilterablePickerPopup, type FilterablePickerOption } from "./FilterablePickerPopup"
import styles from "./FilterablePicker.module.css"

export interface FilterablePickerProps {
  options: FilterablePickerOption[]
  selectedIds: Array<number | string>
  value: ReactNode
  triggerAriaLabel: string
  listboxAriaLabel: string
  onSelectOption: (option: FilterablePickerOption) => void | Promise<void>
  onCreateOption: (label: string) => void | Promise<void>
  triggerLabel?: string
  triggerRole?: "menuitem"
  variant?: "inline" | "header" | "menu"
  placement?: ComponentProps<typeof FilterablePickerPopup>["placement"]
  disabled?: boolean
  pending?: boolean
  closeOnSelect?: boolean
  closeOnCreate?: boolean
  excludeSelected?: boolean
  emptyWithoutQueryMessage?: string | null
  inputPlaceholder?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function FilterablePicker({
  options,
  selectedIds,
  value,
  triggerAriaLabel,
  listboxAriaLabel,
  onSelectOption,
  onCreateOption,
  triggerLabel,
  triggerRole,
  variant = "inline",
  placement,
  disabled = false,
  pending = false,
  closeOnSelect = true,
  closeOnCreate = true,
  excludeSelected = false,
  emptyWithoutQueryMessage = null,
  inputPlaceholder = "Enter new...",
  open: controlledOpen,
  onOpenChange,
}: FilterablePickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const open = controlledOpen ?? internalOpen
  const interactionDisabled = disabled || pending || submitting
  const selectedIdSet = useMemo(() => new Set(selectedIds.map((id) => String(id))), [selectedIds])
  const filteredOptions = useMemo(() => {
    const query = inputValue.trim().toLocaleLowerCase()
    return options.filter((option) => {
      if (excludeSelected && selectedIdSet.has(String(option.id))) return false
      return query === "" || option.label.trim().toLocaleLowerCase().includes(query)
    })
  }, [excludeSelected, inputValue, options, selectedIdSet])

  useEffect(() => {
    if (!open) setInputValue("")
  }, [open])

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
    if (!nextOpen) setInputValue("")
  }

  const refocusInput = () => {
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  const selectOption = (option: FilterablePickerOption) => {
    if (interactionDisabled) return
    void (async () => {
      setSubmitting(true)
      try {
        await onSelectOption(option)
        setInputValue("")
        if (closeOnSelect) setOpen(false)
        else refocusInput()
      } finally {
        setSubmitting(false)
      }
    })()
  }

  const submitInput = () => {
    const label = inputValue.trim()
    if (label === "" || interactionDisabled) return
    const normalized = label.toLocaleLowerCase()
    const matchingOption = filteredOptions.find(
      (option) => option.label.trim().toLocaleLowerCase() === normalized,
    )
    if (matchingOption) {
      selectOption(matchingOption)
      return
    }
    // An exact option excluded because it is already selected should not be
    // submitted as a duplicate. Otherwise Enter follows the list the user can
    // see, choosing its first match and creating only when there are no matches.
    if (options.some((option) => option.label.trim().toLocaleLowerCase() === normalized)) {
      return
    }
    if (filteredOptions[0]) {
      selectOption(filteredOptions[0])
      return
    }

    void (async () => {
      setSubmitting(true)
      try {
        await onCreateOption(label)
        setInputValue("")
        if (closeOnCreate) setOpen(false)
        else refocusInput()
      } finally {
        setSubmitting(false)
      }
    })()
  }

  return (
    <div className={`${styles.picker} ${styles[variant]}`}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(!open)}
        disabled={disabled || pending}
        aria-label={triggerAriaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        role={triggerRole}
      >
        {triggerLabel ? <span className={styles.triggerLabel}>{triggerLabel}</span> : null}
        <span className={styles.triggerValue}>{value}</span>
        <CaretDown size={14} weight="regular" className={styles.caret} />
      </button>

      <FilterablePickerPopup
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        placement={placement}
        listboxAriaLabel={listboxAriaLabel}
        options={filteredOptions}
        inputValue={inputValue}
        inputPlaceholder={inputPlaceholder}
        inputRef={inputRef}
        inputDisabled={interactionDisabled}
        onInputChange={(nextValue) => setInputValue(nextValue.toLocaleLowerCase())}
        onInputKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            setOpen(false)
            return
          }
          if (event.key === "Enter") {
            event.preventDefault()
            submitInput()
          }
        }}
        onInputSubmit={submitInput}
        onSelectOption={selectOption}
        isOptionActive={(option) => selectedIdSet.has(String(option.id))}
        isOptionSelected={(option) => selectedIdSet.has(String(option.id))}
        emptyWithoutQueryMessage={emptyWithoutQueryMessage}
      />
    </div>
  )
}
