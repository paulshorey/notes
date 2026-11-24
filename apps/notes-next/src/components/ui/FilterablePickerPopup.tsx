"use client"

import { Popup } from "@gravity-ui/uikit"
import { ArrowRight, X } from "@phosphor-icons/react"
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
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
  description?: string
  options?: FilterablePickerOption[]
  disabled?: boolean
  input?: {
    value: string
    placeholder: string
    ariaLabel?: string
    submitAriaLabel?: string
    submitDisabled?: boolean
    error?: string | null
    ref: RefObject<HTMLInputElement | null>
    onChange: (value: string) => void
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
    onSubmit: () => void
  }
  onSelectOption?: (option: FilterablePickerOption) => void
  /** Adds a delete button beside each option. The caller confirms and deletes. */
  onDeleteOption?: (option: FilterablePickerOption) => void
  deleteOptionAriaLabel?: (option: FilterablePickerOption) => string
  showOptionCheckboxes?: boolean
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
  description,
  options,
  disabled = false,
  input,
  onSelectOption,
  onDeleteOption,
  deleteOptionAriaLabel,
  showOptionCheckboxes = false,
  isOptionActive,
  isOptionSelected,
  emptyWithQueryMessage,
  emptyWithoutQueryMessage = null,
}: FilterablePickerPopupProps) {
  const inputRef = input?.ref
  const inputError = input?.error
  const trimmedInputValue = input?.value.trim() ?? ""
  const optionsDisabled = disabled || input?.submitDisabled
  const canSubmit = trimmedInputValue !== "" && !optionsDisabled && !inputError
  const descriptionId = useId()
  const errorId = useId()
  const selectedIndex = options && isOptionSelected ? options.findIndex(isOptionSelected) : -1

  useEffect(() => {
    if (!open) {
      return
    }
    const timeout = window.setTimeout(() => inputRef?.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [inputRef, open])

  return (
    <Popup
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      placement={placement}
      offset={6}
      initialFocus={input ? undefined : Math.max(0, selectedIndex)}
    >
      <div className={styles.panel} role="dialog" aria-label={listboxAriaLabel}>
        {description && (
          <div className={styles.description} id={descriptionId}>
            {description}
          </div>
        )}
        {(options || inputError) && (
          <div
            className={styles.options}
            role={options ? "listbox" : undefined}
            aria-label={options ? listboxAriaLabel : undefined}
            aria-describedby={options && description ? descriptionId : undefined}
            onKeyDown={input ? undefined : moveOptionFocus}
          >
            {inputError ? (
              <div className={styles.empty} id={errorId} role="alert">
                {inputError}
              </div>
            ) : options?.length === 0 && trimmedInputValue !== "" ? (
              <div className={styles.empty}>
                {emptyWithQueryMessage?.(trimmedInputValue) ?? (
                  <>Press Enter to create &quot;{trimmedInputValue}&quot;</>
                )}
              </div>
            ) : (
              options?.map((option) => {
                const selected = isOptionSelected?.(option) ?? false
                const optionButton = (
                  <button
                    key={option.id}
                    type="button"
                    className={styles.option}
                    data-active={isOptionActive?.(option) || undefined}
                    data-checked={selected || undefined}
                    disabled={optionsDisabled}
                    onClick={() => onSelectOption?.(option)}
                    role="option"
                    aria-selected={selected}
                  >
                    {showOptionCheckboxes ? (
                      <span
                        className={styles.optionCheckbox}
                        data-qa="filterable-picker-checkbox"
                        data-checked={selected || undefined}
                        aria-hidden
                      >
                        {selected ? <span className={styles.optionCheckMark} /> : null}
                      </span>
                    ) : null}
                    <span className={styles.optionLabel}>{option.label}</span>
                  </button>
                )
                if (!onDeleteOption) return optionButton
                return (
                  <div key={option.id} className={styles.optionRow}>
                    {optionButton}
                    <button
                      type="button"
                      className={styles.optionDelete}
                      disabled={optionsDisabled}
                      onClick={() => onDeleteOption(option)}
                      aria-label={deleteOptionAriaLabel?.(option) ?? `Delete ${option.label}`}
                    >
                      <X size={14} weight="regular" />
                    </button>
                  </div>
                )
              })
            )}
            {options?.length === 0 && trimmedInputValue === "" && emptyWithoutQueryMessage ? (
              <div className={styles.empty}>{emptyWithoutQueryMessage}</div>
            ) : null}
          </div>
        )}
        {input && (
          <div className={styles.inputRow}>
            <input
              ref={input.ref}
              type="text"
              className={styles.input}
              placeholder={input.placeholder}
              value={input.value}
              aria-label={input.ariaLabel}
              aria-invalid={Boolean(inputError)}
              aria-describedby={inputError ? errorId : description ? descriptionId : undefined}
              disabled={disabled}
              onChange={(event) => input.onChange(event.currentTarget.value)}
              onKeyDown={input.onKeyDown}
            />
            <button
              type="button"
              className={styles.submitButton}
              onClick={input.onSubmit}
              disabled={!canSubmit}
              aria-label={input.submitAriaLabel ?? "Submit"}
            >
              <ArrowRight size={14} weight="regular" />
            </button>
          </div>
        )}
      </div>
    </Popup>
  )
}

function moveOptionFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
  const options = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]:enabled'),
  )
  const currentIndex = options.findIndex((option) => option === event.target)
  if (currentIndex < 0) return
  const offset = event.key === "ArrowDown" ? 1 : -1
  event.preventDefault()
  options[(currentIndex + offset + options.length) % options.length]?.focus()
}
