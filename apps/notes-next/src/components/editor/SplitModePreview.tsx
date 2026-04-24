'use client';

import React, { useEffect, useRef, useState } from 'react';
import transform from '@diplodoc/transform';
import type { RenderPreviewParams } from '@gravity-ui/markdown-editor';
import { YfmStaticView } from '@gravity-ui/markdown-editor/view';

/**
 * Renders markdown preview for markup split mode using the same YFM transform
 * pipeline as typical Gravity demos.
 */
export function SplitModePreview({ getValue, md }: RenderPreviewParams) {
  const [html, setHtml] = useState('');
  const mdRef = useRef(md);
  mdRef.current = md;

  useEffect(() => {
    let last = '';
    const sync = () => {
      const raw = getValue();
      if (raw === last) return;
      last = raw;
      const m = mdRef.current;
      try {
        const { result } = transform(raw, {
          allowHTML: m.html ?? false,
          breaks: m.breaks ?? false,
          linkify: m.linkify ?? false,
          linkifyTlds: m.linkifyTlds,
          needToSanitizeHtml: true,
        });
        setHtml(result.html);
      } catch {
        setHtml('<p></p>');
      }
    };
    sync();
    const id = setInterval(sync, 200);
    return () => clearInterval(id);
  }, [getValue]);

  return <YfmStaticView html={html} />;
}
