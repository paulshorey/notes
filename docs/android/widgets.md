# The definitive guide to building a highly interactive Android home screen widget

**You can build roughly 80% of a CRUD to-do app's functionality entirely within a home screen widget — but the remaining 20% requires clever workarounds.** Android widgets support scrollable lists, checkbox toggling, item-specific click handling, and full database integration through `RemoteViews` and `RemoteViewsFactory`. What they cannot do natively — text input, dialogs, animations, and custom views — is achievable through transparent dialog-themed Activities launched via `PendingIntent`. Jetpack Glance (stable at v1.1.1) dramatically reduces boilerplate for all of this while producing the same underlying `RemoteViews`. This guide covers every technique, limitation, and workaround you need.

---

## Table of contents

1. [How widgets actually work (architecture overview)](#1-how-widgets-actually-work)
2. [Widget sizing: declaring a resizable 4×3 widget](#2-widget-sizing)
3. [Displaying a scrollable to-do list with RemoteViewsFactory](#3-scrollable-list)
4. [Click handling: PendingIntents, templates, and fill-in intents](#4-click-handling)
5. [Simulating accordion UI inside a widget](#5-accordion-ui)
6. [Popups, dialogs, and confirmation screens from a widget](#6-popups-and-dialogs)
7. [Forms and text input: the transparent Activity pattern](#7-forms-and-text-input)
8. [Full CRUD operations from a widget](#8-full-crud)
9. [Data synchronization between widget and main app](#9-data-synchronization)
10. [Android 12+ improvements that matter for to-do widgets](#10-android-12-improvements)
11. [Jetpack Glance: Compose-like widgets](#11-jetpack-glance)
12. [Widget-to-app deep linking with proper back stack](#12-deep-linking)
13. [The hard limitations you cannot work around](#13-hard-limitations)
14. [Workarounds and advanced techniques that bridge the gap](#14-workarounds)
15. [Recommended approach: choosing traditional vs Glance](#15-recommended-approach)
16. [Implementation plan from start to finish](#16-implementation-plan)

---

## 1. How widgets actually work

Before diving into code, understanding the architecture prevents hours of debugging. A widget is **not** a miniature Activity. It is a `BroadcastReceiver` subclass (`AppWidgetProvider`) that constructs a `RemoteViews` object — a serializable description of a view hierarchy — and hands it to the **launcher process** via `AppWidgetManager`. The launcher inflates and renders the views in its own process, not yours.

This means:
- Your app's process may not be running when the widget is visible
- You cannot reference objects, callbacks, or listeners — only `PendingIntent` for click handling
- Only a fixed allowlist of View classes is permitted (the launcher must know how to inflate them)
- Data flows one way: your app builds `RemoteViews` → launcher renders them
- Updating the widget requires rebuilding and pushing new `RemoteViews` objects

The key classes in the pipeline:

| Class | Role |
|---|---|
| `AppWidgetProvider` | BroadcastReceiver that handles lifecycle events (`onUpdate`, `onEnabled`, `onDisabled`, `onReceive`) |
| `AppWidgetManager` | System service — pushes `RemoteViews` to the launcher, triggers data refreshes |
| `RemoteViews` | Serializable view description — your only way to define UI |
| `RemoteViewsService` | Bound service that provides a `RemoteViewsFactory` for collection widgets |
| `RemoteViewsFactory` | Adapter-like class that returns individual `RemoteViews` for each list item |
| `PendingIntent` | Deferred intent — the only mechanism for handling user taps |

**Docs:** [App widgets overview](https://developer.android.com/develop/ui/views/appwidgets/overview)

---

## 2. Widget sizing

Android home screens use a grid (typically 5 columns × 4 rows on phones). Widget size is declared in an `appwidget-provider` XML metadata file. On **Android 12+**, use `targetCellWidth`/`targetCellHeight` (grid cells); on older versions, fall back to `minWidth`/`minHeight` in dp using the formula **`70 × n − 30`** where `n` is the cell count.

For a 4-column × 3-row widget: `70 × 4 − 30 = 250dp` wide, `70 × 3 − 30 = 180dp` tall. Users place widgets via long-press → Widgets picker, then long-press the placed widget to resize it within the bounds you define.

### Size reference table

| Cells | dp (formula) | Typical use |
|---|---|---|
| 1 | 40dp | Icon-only widget |
| 2 | 110dp | Minimum useful resize |
| 3 | 180dp | Default height (3 rows) |
| 4 | 250dp | Default width (4 cols) |
| 5 | 320dp | Extended layout |
| 6 | 390dp | Near-full-width |
| 7 | 460dp | Large widget |
| 8 | 530dp | Max practical resize |

> **Note:** Actual cell sizes vary significantly by device and launcher. A Pixel in portrait shows approximately 57dp per column. Samsung and custom launchers differ. The dp formula provides a reliable minimum.

### Complete appwidget-provider XML

```xml
<!-- res/xml/todo_widget_info.xml -->
<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:targetCellWidth="4"
    android:targetCellHeight="3"
    android:minWidth="250dp"
    android:minHeight="180dp"
    android:minResizeWidth="180dp"
    android:minResizeHeight="110dp"
    android:maxResizeWidth="530dp"
    android:maxResizeHeight="450dp"
    android:resizeMode="horizontal|vertical"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_todo_list"
    android:previewLayout="@layout/widget_preview"
    android:previewImage="@drawable/widget_preview_image"
    android:configure="com.example.myapp.WidgetConfigActivity"
    android:description="@string/widget_description"
    android:widgetCategory="home_screen"
    android:widgetFeatures="reconfigurable|configuration_optional" />
```

### Attribute reference

| Attribute | Purpose |
|---|---|
| `targetCellWidth/Height` | Default size in grid cells (Android 12+, takes precedence over `minWidth/Height` on newer devices) |
| `minWidth/Height` | Fallback size in dp (pre-Android 12) |
| `minResizeWidth/Height` | Smallest the user can resize to |
| `maxResizeWidth/Height` | Largest the user can resize to (Android 12+) |
| `resizeMode` | `horizontal`, `vertical`, `horizontal\|vertical`, or `none` |
| `updatePeriodMillis` | Periodic update interval in ms; minimum 1,800,000 (30 min); set to `0` to disable in favor of event-driven updates |
| `previewLayout` | Dynamic XML preview for widget picker (Android 12+) |
| `previewImage` | Static drawable preview (fallback for pre-12) |
| `configure` | Activity launched on widget placement for initial setup |
| `widgetFeatures` | `reconfigurable` allows re-config from widget menu; `configuration_optional` skips mandatory config |

### Manifest registration

```xml
<receiver android:name=".TodoWidgetProvider" android:exported="false">
    <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
    </intent-filter>
    <meta-data
        android:name="android.appwidget.provider"
        android:resource="@xml/todo_widget_info" />
</receiver>
```

### Responsive layouts (Android 12+)

Provide different layouts for different widget sizes using a size-to-layout map. The launcher automatically selects the best match when the user resizes, without waking your app:

```kotlin
val viewMapping: Map<SizeF, RemoteViews> = mapOf(
    SizeF(180f, 110f) to RemoteViews(pkg, R.layout.widget_small),
    SizeF(270f, 110f) to RemoteViews(pkg, R.layout.widget_medium),
    SizeF(270f, 280f) to RemoteViews(pkg, R.layout.widget_large)
)
val responsiveViews = RemoteViews(viewMapping)
appWidgetManager.updateAppWidget(appWidgetId, responsiveViews)
```

Alternatively, react to resize events in `onAppWidgetOptionsChanged()`:

```kotlin
override fun onAppWidgetOptionsChanged(
    context: Context, mgr: AppWidgetManager, id: Int, newOptions: Bundle
) {
    val minW = newOptions.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
    val minH = newOptions.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)
    val layoutId = when {
        minW >= 270 && minH >= 280 -> R.layout.widget_large
        minW >= 270 -> R.layout.widget_medium
        else -> R.layout.widget_small
    }
    val views = RemoteViews(context.packageName, layoutId)
    mgr.updateAppWidget(id, views)
}
```

**Docs:** [App widgets overview](https://developer.android.com/develop/ui/views/appwidgets), [Flexible widget layouts](https://developer.android.com/develop/ui/views/appwidgets/layouts), [Android 12 widget improvements](https://developer.android.com/about/versions/12/features/widgets)

---

## 3. Scrollable list with RemoteViewsFactory

Scrollable lists in widgets use **`ListView`**, `GridView`, `StackView`, or `AdapterViewFlipper` — **not** `RecyclerView`. The architecture follows a pipeline: `AppWidgetProvider.onUpdate()` → `RemoteViewsService` → `RemoteViewsFactory` → individual `RemoteViews` per list item. The factory's **`onDataSetChanged()`** runs on a binder thread, so you can safely perform synchronous Room queries there.

### Widget layout XML

```xml
<!-- res/layout/widget_todo_list.xml -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@drawable/widget_background"
    android:padding="8dp"
    android:clipToOutline="true">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:padding="8dp">

        <TextView android:id="@+id/widget_title"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:text="My To-Do List"
            android:textSize="18sp"
            android:textStyle="bold" />

        <ImageButton android:id="@+id/btn_add_todo"
            android:layout_width="40dp"
            android:layout_height="40dp"
            android:src="@drawable/ic_add"
            android:contentDescription="Add task"
            android:background="?attr/selectableItemBackgroundBorderless" />
    </LinearLayout>

    <ListView android:id="@+id/todo_list_view"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:divider="@android:color/transparent"
        android:dividerHeight="2dp"
        android:scrollbars="vertical"
        android:fadeScrollbars="true" />

    <TextView android:id="@+id/empty_view"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:gravity="center"
        android:text="No tasks yet!\nTap + to add one."
        android:textSize="14sp"
        android:textColor="?android:textColorSecondary" />
</LinearLayout>
```

### List item layout

```xml
<!-- res/layout/widget_todo_item.xml -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/todo_item_root"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:paddingHorizontal="12dp"
    android:paddingVertical="8dp"
    android:background="?attr/selectableItemBackground">

    <CheckBox android:id="@+id/todo_checkbox"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content" />

    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:orientation="vertical"
        android:layout_marginStart="8dp">

        <TextView android:id="@+id/todo_title"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:textSize="14sp"
            android:maxLines="2"
            android:ellipsize="end" />

        <TextView android:id="@+id/todo_subtitle"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:textSize="11sp"
            android:textColor="?android:textColorSecondary"
            android:maxLines="1"
            android:visibility="gone" />
    </LinearLayout>

    <ImageButton android:id="@+id/btn_edit_item"
        android:layout_width="32dp"
        android:layout_height="32dp"
        android:src="@drawable/ic_edit"
        android:contentDescription="Edit"
        android:background="?attr/selectableItemBackgroundBorderless" />

    <ImageButton android:id="@+id/btn_delete_item"
        android:layout_width="32dp"
        android:layout_height="32dp"
        android:src="@drawable/ic_delete"
        android:contentDescription="Delete"
        android:background="?attr/selectableItemBackgroundBorderless"
        android:layout_marginStart="4dp" />
</LinearLayout>
```

### RemoteViewsService

Must be declared in the manifest with `BIND_REMOTEVIEWS` permission:

```kotlin
class TodoWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return TodoRemoteViewsFactory(applicationContext, intent)
    }
}
```

```xml
<service android:name=".widget.TodoWidgetService"
    android:permission="android.permission.BIND_REMOTEVIEWS"
    android:exported="false" />
```

### RemoteViewsFactory

```kotlin
class TodoRemoteViewsFactory(
    private val context: Context,
    intent: Intent
) : RemoteViewsService.RemoteViewsFactory {

    private val appWidgetId = intent.getIntExtra(
        AppWidgetManager.EXTRA_APPWIDGET_ID,
        AppWidgetManager.INVALID_APPWIDGET_ID
    )
    private var todoItems: List<TodoItem> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        val identityToken = Binder.clearCallingIdentity()
        try {
            todoItems = TodoDatabase.getInstance(context)
                .todoDao().getAllTodosSync()
        } finally {
            Binder.restoreCallingIdentity(identityToken)
        }
    }

    override fun getViewAt(position: Int): RemoteViews {
        if (position >= todoItems.size) {
            return getLoadingView()!!
        }
        val item = todoItems[position]

        return RemoteViews(context.packageName, R.layout.widget_todo_item).apply {
            setTextViewText(R.id.todo_title, item.title)

            if (!item.description.isNullOrBlank()) {
                setViewVisibility(R.id.todo_subtitle, View.VISIBLE)
                setTextViewText(R.id.todo_subtitle, item.description)
            } else {
                setViewVisibility(R.id.todo_subtitle, View.GONE)
            }

            if (item.isCompleted) {
                setInt(R.id.todo_title, "setPaintFlags",
                    android.graphics.Paint.STRIKE_THRU_TEXT_FLAG or
                        android.graphics.Paint.ANTI_ALIAS_FLAG)
                setTextColor(R.id.todo_title,
                    context.getColor(R.color.text_completed))
            } else {
                setInt(R.id.todo_title, "setPaintFlags",
                    android.graphics.Paint.ANTI_ALIAS_FLAG)
                setTextColor(R.id.todo_title,
                    context.getColor(R.color.text_primary))
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setCompoundButtonChecked(R.id.todo_checkbox, item.isCompleted)
                val toggleFillIn = Intent().apply {
                    putExtra("ACTION_TYPE", "TOGGLE")
                    putExtra("TODO_ID", item.id)
                }
                setOnCheckedChangeResponse(
                    R.id.todo_checkbox,
                    RemoteViews.RemoteResponse.fromFillInIntent(toggleFillIn)
                )
            }

            val openFillIn = Intent().apply {
                putExtra("ACTION_TYPE", "OPEN")
                putExtra("TODO_ID", item.id)
                putExtra("TODO_TITLE", item.title)
            }
            setOnClickFillInIntent(R.id.todo_item_root, openFillIn)

            val editFillIn = Intent().apply {
                putExtra("ACTION_TYPE", "EDIT")
                putExtra("TODO_ID", item.id)
                putExtra("TODO_TITLE", item.title)
            }
            setOnClickFillInIntent(R.id.btn_edit_item, editFillIn)

            val deleteFillIn = Intent().apply {
                putExtra("ACTION_TYPE", "DELETE")
                putExtra("TODO_ID", item.id)
                putExtra("TODO_TITLE", item.title)
            }
            setOnClickFillInIntent(R.id.btn_delete_item, deleteFillIn)
        }
    }

    override fun getCount() = todoItems.size

    override fun getItemId(position: Int): Long =
        if (position < todoItems.size) todoItems[position].id else position.toLong()

    override fun hasStableIds() = true

    override fun getLoadingView(): RemoteViews = RemoteViews(
        context.packageName, R.layout.widget_todo_item
    ).apply {
        setTextViewText(R.id.todo_title, "Loading…")
    }

    override fun getViewTypeCount() = 1

    override fun onDestroy() {
        todoItems = emptyList()
    }
}
```

> **Critical detail:** Call `Binder.clearCallingIdentity()` before Room queries because the binder call originates from the launcher process.

**Docs:** [Collection widgets](https://developer.android.com/develop/ui/views/appwidgets/collections), [RemoteViewsFactory API](https://developer.android.com/reference/android/widget/RemoteViewsService.RemoteViewsFactory)

---

## 4. Click handling

Widget clicks use two mechanisms.

### Static views

```kotlin
val addIntent = Intent(context, AddTodoDialogActivity::class.java).apply {
    flags = Intent.FLAG_ACTIVITY_NEW_TASK
}
views.setOnClickPendingIntent(
    R.id.btn_add_todo,
    PendingIntent.getActivity(
        context,
        0,
        addIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
)
```

### Collection items

For collection items, use `setPendingIntentTemplate()` plus fill-in intents.

| Mechanism | Use case | PendingIntent flag |
|---|---|---|
| `setOnClickPendingIntent` | Static views | `FLAG_IMMUTABLE` |
| `setPendingIntentTemplate` + `fillInIntent` | Collection items | `FLAG_MUTABLE` |

### Complete provider pattern

```kotlin
class TodoWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_ITEM_CLICK = "com.example.ACTION_ITEM_CLICK"

        fun updateAppWidget(
            context: Context, mgr: AppWidgetManager, appWidgetId: Int
        ) {
            val serviceIntent = Intent(context, TodoWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }

            val views = RemoteViews(context.packageName, R.layout.widget_todo_list).apply {
                setRemoteAdapter(R.id.todo_list_view, serviceIntent)
                setEmptyView(R.id.todo_list_view, R.id.empty_view)
            }

            val templateIntent = Intent(context, TodoWidgetProvider::class.java).apply {
                action = ACTION_ITEM_CLICK
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            }
            val templatePI = PendingIntent.getBroadcast(
                context, appWidgetId, templateIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            views.setPendingIntentTemplate(R.id.todo_list_view, templatePI)

            val addIntent = Intent(context, AddTodoDialogActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            views.setOnClickPendingIntent(
                R.id.btn_add_todo,
                PendingIntent.getActivity(
                    context,
                    0,
                    addIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )

            mgr.updateAppWidget(appWidgetId, views)
            mgr.notifyAppWidgetViewDataChanged(appWidgetId, R.id.todo_list_view)
        }
    }
}
```

### Unique PendingIntents

PendingIntent equality ignores extras. Use unique data URIs or request codes.

```kotlin
val intent = Intent(context, TodoWidgetProvider::class.java).apply {
    action = ACTION_ITEM_CLICK
    data = Uri.parse("myapp://widget/$appWidgetId/$itemId")
}
```

### `goAsync()` pattern

```kotlin
val pendingResult = goAsync()
CoroutineScope(Dispatchers.IO).launch {
    try {
        database.todoDao().deleteById(todoId)
        refreshAllWidgets(context)
    } finally {
        pendingResult.finish()
    }
}
```

**Docs:** [PendingIntent API](https://developer.android.com/reference/android/app/PendingIntent), [Advanced widgets](https://developer.android.com/develop/ui/views/appwidgets/advanced)

---

## 5. Accordion UI

**Not natively possible, but you can approximate it.** Use a broadcast → persisted state toggle → full rebuild cycle.

1. Tap an item header.
2. Broadcast includes the item ID.
3. `onReceive()` toggles expansion in `SharedPreferences`.
4. Widget rebuilds with updated visibility.

```kotlin
override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "ACTION_TOGGLE_EXPAND") {
        val itemId = intent.getIntExtra("ITEM_ID", -1)
        val prefs = context.getSharedPreferences("widget_state", Context.MODE_PRIVATE)
        val key = "expanded_$itemId"
        prefs.edit().putBoolean(key, !prefs.getBoolean(key, false)).apply()

        val mgr = AppWidgetManager.getInstance(context)
        val ids = mgr.getAppWidgetIds(
            ComponentName(context, TodoWidgetProvider::class.java))
        ids.forEach { id -> updateAppWidget(context, mgr, id) }
    }
    super.onReceive(context, intent)
}
```

Limitations:
- No animations
- Noticeable latency
- Full rebuild required
- External state persistence required

For most note or to-do widgets, deep-linking to the main app is cleaner.

---

## 6. Popups, dialogs, and confirmation screens

Widgets cannot directly show dialogs or overlays. The standard workaround is a dialog-themed Activity.

### Dialog theme

```xml
<style name="Theme.MyApp.DialogActivity" parent="Theme.MaterialComponents.Light.Dialog">
    <item name="android:windowNoTitle">true</item>
    <item name="android:windowBackground">@android:color/transparent</item>
    <item name="android:windowIsTranslucent">true</item>
    <item name="android:windowIsFloating">true</item>
    <item name="android:backgroundDimEnabled">true</item>
    <item name="android:windowCloseOnTouchOutside">true</item>
    <item name="android:windowAnimationStyle">@android:style/Animation.Dialog</item>
</style>
```

### Manifest declaration

```xml
<activity android:name=".widget.WidgetConfirmationActivity"
    android:theme="@style/Theme.MyApp.DialogActivity"
    android:excludeFromRecents="true"
    android:noHistory="true"
    android:taskAffinity=""
    android:exported="false" />
```

### Confirmation Activity

```kotlin
class WidgetConfirmationActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_widget_confirmation)

        val itemId = intent.getLongExtra("TODO_ID", -1L)
        val itemTitle = intent.getStringExtra("TODO_TITLE") ?: "this item"

        findViewById<TextView>(R.id.tvConfirmMessage).text =
            "Delete \"$itemTitle\"?"

        findViewById<Button>(R.id.btnConfirm).setOnClickListener {
            lifecycleScope.launch(Dispatchers.IO) {
                TodoDatabase.getInstance(this@WidgetConfirmationActivity)
                    .todoDao().deleteById(itemId)
                withContext(Dispatchers.Main) {
                    TodoWidgetProvider.refreshAllWidgets(applicationContext)
                    Toast.makeText(this@WidgetConfirmationActivity,
                        "Deleted!", Toast.LENGTH_SHORT).show()
                    finish()
                }
            }
        }

        findViewById<Button>(R.id.btnCancel).setOnClickListener { finish() }
        setFinishOnTouchOutside(true)
    }
}
```

### Other feedback methods

| Method | Works from widget? | Notes |
|---|---|---|
| Toast | Yes | Trigger from receiver |
| Snackbar | No | Needs an Activity |
| Notification | Yes | Good for undo flows |
| AlertDialog | No | Use dialog-themed Activity |

---

## 7. Forms and text input

`EditText` is not supported in widgets. Use a dialog-style Activity for any text input.

```kotlin
class WidgetFormActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_widget_form)

        val itemId = intent.getLongExtra("TODO_ID", -1L)
        val isNew = (itemId == -1L)
        val prefillTitle = intent.getStringExtra("PREFILL_TITLE") ?: ""

        val etTitle = findViewById<TextInputEditText>(R.id.etTitle)
        val etDescription = findViewById<TextInputEditText>(R.id.etDescription)
        val tvHeader = findViewById<TextView>(R.id.tvFormHeader)
        val btnSave = findViewById<Button>(R.id.btnSave)

        tvHeader.text = if (isNew) "New Task" else "Edit Task"

        if (!isNew) {
            etTitle.setText(prefillTitle)
            lifecycleScope.launch(Dispatchers.IO) {
                val item = TodoDatabase.getInstance(this@WidgetFormActivity)
                    .todoDao().getById(itemId)
                withContext(Dispatchers.Main) {
                    etDescription.setText(item?.description ?: "")
                }
            }
        }

        etTitle.requestFocus()
        window.setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)

        btnSave.setOnClickListener {
            val title = etTitle.text?.toString()?.trim() ?: ""
            if (title.isEmpty()) {
                etTitle.error = "Title is required"
                return@setOnClickListener
            }
            val desc = etDescription.text?.toString()?.trim() ?: ""

            lifecycleScope.launch(Dispatchers.IO) {
                val db = TodoDatabase.getInstance(this@WidgetFormActivity)
                if (isNew) {
                    db.todoDao().insert(TodoItem(title = title, description = desc))
                } else {
                    db.todoDao().update(itemId, title, desc)
                }
                withContext(Dispatchers.Main) {
                    TodoWidgetProvider.refreshAllWidgets(applicationContext)
                    Toast.makeText(this@WidgetFormActivity,
                        if (isNew) "Task added!" else "Task updated!",
                        Toast.LENGTH_SHORT).show()
                    finish()
                }
            }
        }
    }
}
```

Other alternatives:
- voice input via `RecognizerIntent`
- notification remote input
- pre-defined option pickers

---

## 8. Full CRUD operations

### CREATE

Header button launches form Activity with a sentinel ID.

### READ

`RemoteViewsFactory.onDataSetChanged()` loads data synchronously.

### UPDATE

- simple toggles can happen directly in-widget
- text edits should open an Activity

### DELETE

- confirmation Activity is common
- notification-based undo works well for destructive actions

### Update methods

| Method | Effect | When to use |
|---|---|---|
| `updateAppWidget` | Replaces whole layout | Structural changes |
| `partiallyUpdateAppWidget` | Merges view updates | Small targeted updates |
| `notifyAppWidgetViewDataChanged` | Reloads collection data | Best for lists |

```kotlin
fun refreshTodoWidgets(context: Context) {
    val mgr = AppWidgetManager.getInstance(context)
    val ids = mgr.getAppWidgetIds(
        ComponentName(context, TodoWidgetProvider::class.java)
    )
    mgr.notifyAppWidgetViewDataChanged(ids, R.id.todo_list_view)
}
```

---

## 9. Data synchronization

Use three strategies together:

1. **Event-driven refresh** after mutations
2. **WorkManager periodic refresh** as a safety net
3. **Main app broadcasts** on critical changes

Widgets cannot directly observe `LiveData` or `Flow`; they must be refreshed by explicit update calls.

### Repository-triggered refresh

```kotlin
class TodoRepository(private val context: Context) {
    private val dao = TodoDatabase.getInstance(context).todoDao()

    suspend fun insertTodo(item: TodoItem) {
        dao.insert(item)
        refreshTodoWidgets(context)
    }
}
```

### WorkManager refresh

```kotlin
class TodoWidgetWorker(
    context: Context, params: WorkerParameters
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val context = applicationContext
        val mgr = AppWidgetManager.getInstance(context)
        val ids = mgr.getAppWidgetIds(
            ComponentName(context, TodoWidgetProvider::class.java))

        if (ids.isEmpty()) return Result.success()

        ids.forEach { id ->
            TodoWidgetProvider.updateAppWidget(context, mgr, id)
        }
        return Result.success()
    }
}
```

---

## 10. Android 12+ improvements

Android 12 added major widget upgrades:

- native `CheckBox`, `Switch`, `RadioButton`, `RadioGroup`
- `setOnCheckedChangeResponse()`
- system rounded corners
- dynamic colors
- better responsive layout support
- `RemoteCollectionItems` for smaller static lists

### Compound buttons

```kotlin
views.setCompoundButtonChecked(R.id.task_checkbox, item.isCompleted)
views.setOnCheckedChangeResponse(
    R.id.task_checkbox,
    RemoteViews.RemoteResponse.fromFillInIntent(fillInIntent)
)
```

### Rounded corners

```xml
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <corners android:radius="@android:dimen/system_app_widget_background_radius" />
    <solid android:color="?android:attr/colorSurface" />
</shape>
```

### Dynamic colors

```xml
<LinearLayout
    android:background="?android:attr/colorBackground">
    <TextView android:textColor="?android:attr/textColorPrimary" />
</LinearLayout>
```

---

## 11. Jetpack Glance

Glance is a Compose-style widget framework that still renders `RemoteViews` under the hood. It simplifies boilerplate but does not remove widget platform limitations.

### Gradle setup

```kotlin
implementation("androidx.glance:glance-appwidget:1.1.1")
implementation("androidx.glance:glance-material3:1.1.1")
```

### Example Glance widget

```kotlin
class TodoWidget : GlanceAppWidget() {
    companion object {
        val todoIdKey = ActionParameters.Key<Long>("todoId")
    }

    override val sizeMode = SizeMode.Responsive(
        setOf(
            DpSize(180.dp, 110.dp),
            DpSize(250.dp, 180.dp),
            DpSize(320.dp, 280.dp)
        )
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val todos = withContext(Dispatchers.IO) {
            TodoDatabase.getInstance(context).todoDao().getAllTodos()
        }

        provideContent {
            GlanceTheme {
                LazyColumn {
                    items(todos, key = { it.id }) { todo ->
                        Text(todo.title)
                    }
                }
            }
        }
    }
}
```

### Refreshing Glance widgets

```kotlin
TodoWidget().update(context, glanceId)
TodoWidget().updateAll(context)
```

Glance is a strong fit for modern apps, especially if your team already uses Compose.

---

## 12. Deep linking from widget to app

Use `TaskStackBuilder` or Navigation deep links so back navigation works naturally.

```kotlin
fun createDeepLinkPendingIntent(context: Context, itemId: Long): PendingIntent {
    val detailIntent = Intent(context, TodoDetailActivity::class.java).apply {
        putExtra("TODO_ID", itemId)
    }
    return TaskStackBuilder.create(context).run {
        addNextIntentWithParentStack(detailIntent)
        getPendingIntent(
            itemId.toInt(),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )!!
    }
}
```

With Navigation:

```kotlin
val pendingIntent = NavDeepLinkBuilder(context)
    .setGraph(R.navigation.nav_graph)
    .setDestination(R.id.todoDetailFragment)
    .setArguments(bundleOf("todoId" to itemId))
    .createPendingIntent()
```

Recommended mapping:

| Action | Recommended approach |
|---|---|
| Toggle checkbox | Handle in widget |
| Add new item | Dialog Activity or deep link |
| Full edit | Deep link to app |
| Delete confirm | Dialog Activity |
| View details | Deep link to app |

---

## 13. The hard limitations

These limitations are fundamental to the platform.

### Supported views

- `FrameLayout`
- `LinearLayout`
- `RelativeLayout`
- `GridLayout`
- `ListView`
- `GridView`
- `StackView`
- `ViewFlipper`
- `AdapterViewFlipper`
- `TextView`
- `ImageView`
- `ProgressBar`
- `AnalogClock`
- `TextClock`
- `Chronometer`
- `Button`
- `ImageButton`
- API 31+: `CheckBox`, `RadioButton`, `RadioGroup`, `Switch`

### Not supported

| Feature | Status | Workaround |
|---|---|---|
| `EditText` | No | Activity |
| `RecyclerView` | No | `ListView` |
| `ConstraintLayout` | No | `LinearLayout` / `RelativeLayout` |
| `ScrollView` | No | `ListView` |
| Custom Views | No | Allowed stock views only |
| Dialogs | No | Activity |
| Smooth animations | No | Instant state changes |
| Gestures / swipes | No | No workaround |

### Performance limits

- Binder payload around 1 MB
- Bitmap memory budget is limited
- Deep view hierarchies are expensive
- `updatePeriodMillis` minimum is 30 minutes
- WorkManager minimum periodic interval is 15 minutes

---

## 14. Workarounds and advanced techniques

### Configuration Activity

Use a configuration Activity during widget placement for filters or themes.

```kotlin
class WidgetConfigActivity : AppCompatActivity() {
    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)

        appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
    }
}
```

### Pin widget programmatically

```kotlin
val appWidgetManager = AppWidgetManager.getInstance(context)
if (appWidgetManager.isRequestPinAppWidgetSupported) {
    val widgetProvider = ComponentName(context, TodoWidgetProvider::class.java)
    appWidgetManager.requestPinAppWidget(widgetProvider, null, null)
}
```

### Pre-rendered bitmaps

```kotlin
fun renderProgressRing(context: Context, progress: Float): Bitmap {
    val size = 100
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 8f
    }
    canvas.drawArc(RectF(8f, 8f, size - 8f, size - 8f),
        -90f, 360f * progress, false, paint)
    return bitmap
}
```

---

## 15. Recommended approach

### Use Jetpack Glance if:

- the app already uses Compose
- you are starting fresh
- you want fewer files and less boilerplate

### Use traditional RemoteViews if:

- you need tight control over update behavior
- you are maintaining an older existing widget
- you want the lowest-level API surface

### Practical recommendation

For many productivity apps, the best balance is:
- a **read-only, high-signal widget**
- quick refresh and light state inside the widget
- deep links into the main app for text-heavy flows and richer editing

That keeps the widget dependable and avoids fighting platform constraints.

---

## 16. Implementation plan from start to finish

### Phase 1: Foundation

1. Create provider XML with sizing
2. Create widget layout
3. Create list item layout
4. Implement provider lifecycle
5. Implement data source
6. Register components in manifest
7. Test visibility in widget picker

### Phase 2: Read + Toggle

8. Wire click templates
9. Handle check toggles
10. Refresh list after changes
11. Test persistence and updates

### Phase 3: Create + Edit

12. Define dialog theme
13. Create overlay Activities
14. Wire add and edit flows
15. Refresh widgets after save

### Phase 4: Delete

16. Add delete confirmation Activity
17. Wire delete flow
18. Verify refresh behavior

### Phase 5: Polish

19. Add responsive layouts
20. Add Android 12+ styling
21. Add WorkManager refresh
22. Add preview assets
23. Add optional configuration

### Phase 6: Sync hardening

24. Refresh widgets from repository writes
25. Test app-to-widget sync
26. Test widget-to-app sync
27. Test process death and reboot cases
