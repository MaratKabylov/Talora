"use client";

import {
  Bold,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { richTextValueToHtml, serializeRichTextHtml } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

type RichTextEditorProps = {
  className?: string;
  defaultValue?: string | null;
  disabled?: boolean;
  id: string;
  name?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  value?: string | null;
};

type ToolbarButtonProps = {
  disabled: boolean;
  label: string;
  onPress: () => void;
  children: React.ReactNode;
};

function ToolbarButton({ children, disabled, label, onPress }: ToolbarButtonProps) {
  return (
    <button
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault();
        onPress();
      }}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  className,
  defaultValue = "",
  disabled = false,
  id,
  name,
  onChange,
  placeholder,
  value,
}: RichTextEditorProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const editorRef = useRef<HTMLDivElement>(null);
  const resolvedValue = isControlled ? (value ?? "") : internalValue;
  const lastEmittedValueRef = useRef(resolvedValue);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;

    const nextHtml = richTextValueToHtml(resolvedValue);
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }

    lastEmittedValueRef.current = serializeRichTextHtml(editor.innerHTML);
  }, [resolvedValue]);

  function emitValue() {
    const nextValue = serializeRichTextHtml(editorRef.current?.innerHTML ?? "");
    if (nextValue === lastEmittedValueRef.current) return;

    lastEmittedValueRef.current = nextValue;
    if (!isControlled) setInternalValue(nextValue);
    onChange?.(nextValue);
  }

  function command(name: string, commandValue?: string) {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(name, false, commandValue);
    emitValue();
  }

  return (
    <div className={cn("overflow-hidden rounded-md border bg-background", className)}>
      {!disabled ? (
        <div aria-label="Форматирование текста" className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 p-1" role="toolbar">
          <ToolbarButton disabled={disabled} label="Отменить" onPress={() => command("undo")}>
            <Undo2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Повторить" onPress={() => command("redo")}>
            <Redo2 className="size-4" />
          </ToolbarButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton disabled={disabled} label="Жирный" onPress={() => command("bold")}>
            <Bold className="size-4" />
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Курсив" onPress={() => command("italic")}>
            <Italic className="size-4" />
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Подчеркнутый" onPress={() => command("underline")}>
            <Underline className="size-4" />
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Зачеркнутый" onPress={() => command("strikeThrough")}>
            <Strikethrough className="size-4" />
          </ToolbarButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton disabled={disabled} label="Мелкий шрифт" onPress={() => command("fontSize", "2")}>
            <span className="text-xs">A−</span>
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Обычный шрифт" onPress={() => command("fontSize", "3")}>
            <span className="text-sm">A</span>
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Крупный шрифт" onPress={() => command("fontSize", "5")}>
            <span className="text-base">A+</span>
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Заголовок" onPress={() => command("formatBlock", "h3")}>
            <Heading2 className="size-4" />
          </ToolbarButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton disabled={disabled} label="Маркированный список" onPress={() => command("insertUnorderedList")}>
            <List className="size-4" />
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Нумерованный список" onPress={() => command("insertOrderedList")}>
            <ListOrdered className="size-4" />
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Цитата" onPress={() => command("formatBlock", "blockquote")}>
            <Quote className="size-4" />
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="Очистить форматирование" onPress={() => command("removeFormat")}>
            <RemoveFormatting className="size-4" />
          </ToolbarButton>
        </div>
      ) : null}
      <div
        aria-disabled={disabled}
        aria-label={placeholder ?? "Форматированный текст"}
        aria-multiline="true"
        className="rich-text-content rich-text-editor min-h-28 px-3 py-2 text-sm outline-none"
        contentEditable={!disabled}
        data-placeholder={placeholder}
        id={id}
        onBlur={emitValue}
        onInput={emitValue}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          emitValue();
        }}
        ref={editorRef}
        role="textbox"
        suppressContentEditableWarning
      />
      {name ? <input disabled={disabled} name={name} type="hidden" value={resolvedValue} /> : null}
    </div>
  );
}
