# `app/src/main/res`

Android resources for the Notes app and home-screen widget.

## Folder map

- `values/` - app name, widget strings, themes, and simple color tokens.
- `xml/` - widget provider metadata.
- `layout/` - static placeholder layout shown before Glance renders real widget content.
- `drawable/` - vector assets used by the widget and launcher foreground art.
- `mipmap-anydpi-v26/` - adaptive launcher icon definitions.

## File map

- `xml/notes_home_widget_info.xml` - widget size, resize behavior, preview/initial layout, and `updatePeriodMillis=0`.
- `layout/widget_loading.xml` - loading placeholder used before widget state is available.
- `values/strings.xml` - app name plus widget picker name and description.
- `values/themes.xml` - app theme and the transparent dialog theme used by widget overlay activities.
- `values/colors.xml` - launcher background color token.
- `drawable/ic_widget_*.xml` - widget toolbar/action vector icons.
- `drawable/widget_icon_button_background.xml` - bordered background used by some widget icon buttons.
- `drawable/ic_launcher_foreground.xml` - adaptive launcher foreground artwork.
- `mipmap-anydpi-v26/ic_launcher*.xml` - adaptive launcher icon definitions.

## Non-obvious rules

- Keep widget assets as Android resources; Glance widget code should not depend on Compose `ImageVector` or runtime SVG parsing.
- `widget_loading.xml` is only the initial/preview layout; the real widget UI is rendered from `NotesHomeWidget.kt`.
- If widget dimensions or behavior change, update both `notes_home_widget_info.xml` and any responsive assumptions in `NotesHomeWidget.kt`.

## Maintenance

Keep this file up to date after major changes in `app/src/main/res`. Edit it when resource folders, widget metadata, themes, or important assets change.
