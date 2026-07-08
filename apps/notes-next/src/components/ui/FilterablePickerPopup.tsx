"use client"

import { Popup } from "@gravity-ui/uikit"
import { ArrowRight } from "@phosphor-icons/react"
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
} from "react"
import styles from "./FilterablePickerPopup.module.css"

export interface FilterablePickerOption {
  id: number | string
  label: string
}

export interface FilterablePickerPopupProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  placement?: ComponentProps<typeof Popup>["placement"]
  listboxAriaLabel: string
  options: FilterablePickerOption[]
  inputValue: string
  inputPlaceholder?: string
  inputDisabled?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  onInputChange: (value: string) => void
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onInputSubmit: () => void
  onSelectOption: (option: FilterablePickerOption) => void
  isOptionActive?: (option: FilterablePickerOption) => boolean
  isOptionSelected?: (option: FilterablePickerOption) => boolean
  emptyWithQueryMessage?: (query: string) => ReactNode
  emptyWithoutQueryMessage?: string | null
}

export function FilterablePickerPopup({
  anchorRef,
  open,
  onClose,
  placement = ["top-start", "top-end", "bottom-start", "bottom-end"],
  listboxAriaLabel,
  options,
  inputValue,
  inputPlaceholder = "Enter new...",
  inputDisabled = false,
  inputRef,
  onInputChange,
  onInputKeyDown,
  onInputSubmit,
  onSelectOption,
  isOptionActive,
  isOptionSelected,
  emptyWithQueryMessage,
  emptyWithoutQueryMessage = null,
}: FilterablePickerPopupProps) {
  const trimmedInputValue = inputValue.trim()
  const canSubmit = trimmedInputValue !== "" && !inputDisabled

  useEffect(() => {
    if (!open) {
      return
    }
    window.setTimeout(() => inputRef?.current?.focus(), 0)
  }, [inputRef, open])

  return (
    <Popup
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      placement={placement}
      offset={6}
      role="dialog"
    >
      <div className={styles.panel}>
        <div className={styles.options} role="listbox" aria-label={listboxAriaLabel}>
          {options.length === 0 && trimmedInputValue !== "" ? (
            <div className={styles.empty}>
              {emptyWithQueryMessage?.(trimmedInputValue) ?? (
                <>
                  Press Enter to create &quot;{trimmedInputValue}&quot;
                </>
              )}
            </div>
          ) : (
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={styles.option}
                data-active={isOptionActive?.(option) || undefined}
                onClick={() => onSelectOption(option)}
                role="option"
                aria-selected={isOptionSelected?.(option) ?? false}
              >
                {option.label}
              </button>
            ))
          )}
          {options.length === 0 && trimmedInputValue === "" && emptyWithoutQueryMessage ? (
            <div className={styles.empty}>{emptyWithoutQueryMessage}</div>
          ) : null}
        </div>
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder={inputPlaceholder}
            value={inputValue}
            disabled={inputDisabled}
            onChange={(event) => {
              onInputChange(event.currentTarget.value)
            }}
            onKeyDown={onInputKeyDown}
          />
          <button
            type="button"
            className={styles.submitButton}
            onClick={onInputSubmit}
            disabled={!canSubmit}
            aria-label="Submit"
          >
            <ArrowRight size={14} weight="regular" />
          </button>
        </div>
      </div>
    </Popup>
  )
}
