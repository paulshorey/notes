import React from 'react';
import {
  useMarkdownEditor,
  MarkdownEditorView,
  type RenderPreview,
  MarkdownEditorOptions,
  MarkdownEditorPreset,
  MarkdownEditorInitialOptions,
  MarkdownEditorMarkupConfig,
  MarkdownEditorMdOptions,
  MarkdownEditorHandlers,
  MarkdownEditorExperimentalOptions,
  MarkdownEditorWysiwygConfig,
  Logger2,
} from '@gravity-ui/markdown-editor';
import styles from "./EditorPage.module.css"
import { SplitModePreview } from './SplitModePreview';

// Example: 
// https://preview.gravity-ui.com/md-editor/?path=/story/extensions-yfm--mermaid-diagram&args=initialEditor:markup;initialSplitModeEnabled:!true;renderPreviewDefined:!false;disableMarkdownItAttrs:!false&markup=Jm5ic3A7CgojIyBNZXJtYWlkIGRpYWdyYW0gKG9wdGlvbmFsIGZlYXR1cmUpCgpgYGBtZXJtYWlkCnNlcXVlbmNlRGlhZ3JhbQoJQWxpY2UtPj5Cb2I6IEhpIEJvYgoJQm9iLT4+QWxpY2U6IEhpIEFsaWNlCmBgYA==
type Options = MarkdownEditorOptions & {
  preset?: MarkdownEditorPreset;
  /** Markdown parser options */
  md?: MarkdownEditorMdOptions;
  /** Initial values */
  initial?: MarkdownEditorInitialOptions;
  handlers?: MarkdownEditorHandlers;
  experimental?: MarkdownEditorExperimentalOptions;
  /** Options for markup mode */
  markupConfig?: MarkdownEditorMarkupConfig;
  /** Options for wysiwyg mode */
  wysiwygConfig?: MarkdownEditorWysiwygConfig;
  logger?: Logger2.ILogger;
  /** Mobile view */
  mobile?: boolean;
};

type EditorPageProps = {
  onSubmit?: (markdown: string) => void;
};

function EditorPage({ onSubmit }: EditorPageProps) {
  const renderPreview = React.useCallback<RenderPreview>(
    (params) => <SplitModePreview {...params} />,
    [],
  );
  const options:Options = {
    // md: { html: false },
    initial: {
      mode: 'markup',
      // mode: 'wysiwyg', // markup
      splitModeEnabled: true,
      toolbarVisible: false
    },
    markupConfig: {
      splitMode: 'horizontal',
      renderPreview,
    },
  }
  const editor = useMarkdownEditor(options);

  React.useEffect(() => {
    function submitHandler() {
      // Serialize current content to markdown markup
      const value = editor.getValue();
      onSubmit?.(value);
    }

    editor.on('submit', submitHandler);
    return () => {
      editor.off('submit', submitHandler);
    };
  }, [onSubmit]);

  return <MarkdownEditorView stickyToolbar autofocus editor={editor} className={styles.editor} />;
}

export { EditorPage };
