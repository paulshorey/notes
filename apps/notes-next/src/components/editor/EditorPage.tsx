import React from 'react';
import {useMarkdownEditor, MarkdownEditorView} from '@gravity-ui/markdown-editor';
import styles from "./EditorPage.module.css"

type EditorPageProps = {
  onSubmit?: (markdown: string) => void;
};

function EditorPage({ onSubmit }: EditorPageProps) {
  const editor = useMarkdownEditor({md: {html: false}});

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
