package com.eighthbrain.notesandroid.app.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.updateAll
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.currentState
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.eighthbrain.notesandroid.app.R
import com.eighthbrain.notesandroid.app.NotesApplication
import com.eighthbrain.notesandroid.app.model.AppSnapshot
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.descriptionBody
import com.eighthbrain.notesandroid.app.model.formatConciseDate
import com.eighthbrain.notesandroid.app.model.headline
import com.eighthbrain.notesandroid.app.model.isLibraryNote
import com.eighthbrain.notesandroid.app.model.sortedByLastUpdated
import com.eighthbrain.notesandroid.app.ui.MainActivity
import com.eighthbrain.notesandroid.app.ui.WidgetCategoryPickerActivity
import com.eighthbrain.notesandroid.app.ui.WidgetDeleteNoteActivity
import com.eighthbrain.notesandroid.app.ui.WidgetLoginActivity
import com.eighthbrain.notesandroid.app.ui.WidgetTagPickerActivity

class NotesHomeWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NotesHomeWidget()
}

class NotesHomeWidget : GlanceAppWidget() {
    override val stateDefinition = PreferencesGlanceStateDefinition

    override val sizeMode: SizeMode =
        SizeMode.Responsive(
            setOf(
                DpSize(250.dp, 180.dp),
                DpSize(320.dp, 250.dp),
                DpSize(320.dp, 420.dp),
            ),
        )

    override suspend fun provideGlance(
        context: Context,
        id: androidx.glance.GlanceId,
    ) {
        provideContent {
            val repository = (context.applicationContext as NotesApplication).repository
            val glanceState = currentState<androidx.datastore.preferences.core.Preferences>()
            val snapshotRevision = glanceState[widgetSnapshotRevisionKey] ?: 0L
            val snapshot by repository.snapshots.collectAsState(initial = AppSnapshot())
            androidx.compose.runtime.key(snapshotRevision, snapshot.lastSyncEpochMillis) {
                WidgetContent(snapshot = snapshot)
            }
        }
    }
}

private val widgetBackground = ColorProvider(Color(0xFF10131A))
private val widgetText = ColorProvider(Color(0xFFF5F7FB))
private val widgetTextDim = ColorProvider(Color(0x99F5F7FB))
private val noteTitleFontSize: TextUnit = 16.sp
private val noteBodyFontSize: TextUnit = 14.sp
private val noteRowButtonPadding = 4.dp
private val noteRowTitleTopPadding = 2.dp
private val noteRowTitleBottomPadding = 2.dp

/** Bumped on every repository persist so active Glance sessions recompose with fresh data. */
val widgetSnapshotRevisionKey = longPreferencesKey("widget_snapshot_revision")

/**
 * When a Glance session is already running, [GlanceAppWidget.update] / [updateAll] recompose from
 * Glance state but do not re-run [provideGlance]. Bump [widgetSnapshotRevisionKey] and call
 * [updateAll] after snapshot writes so note lists refresh (e.g. after overlay delete).
 */
suspend fun refreshWidgetsAfterSnapshotChange(
    context: Context,
    revision: Long,
) {
    val appContext = context.applicationContext
    val manager = GlanceAppWidgetManager(appContext)
    val widget = NotesHomeWidget()
    manager.getGlanceIds(NotesHomeWidget::class.java).forEach { glanceId ->
        updateAppWidgetState(appContext, glanceId) { prefs ->
            prefs[widgetSnapshotRevisionKey] = revision
        }
    }
    widget.updateAll(appContext)
}

@androidx.compose.runtime.Composable
private fun WidgetContent(snapshot: AppSnapshot) {
    val context = LocalContext.current
    val widgetState = currentState<androidx.datastore.preferences.core.Preferences>()
    val categoryFilterId = readCategoryFilterId(widgetState)
    val tagFilterId = readTagFilterId(widgetState)
    val filteredNotes =
        snapshot.notes.filter { note ->
            note.isLibraryNote() &&
                (categoryFilterId == null || note.category.id == categoryFilterId) &&
                (tagFilterId == null || note.tags.any { tag -> tag.id == tagFilterId })
        }
    val sortedNotes = filteredNotes.sortedByLastUpdated().take(12)
    val activeCategoryLabel =
        categoryFilterId?.let { id -> snapshot.categories.firstOrNull { it.id == id }?.label }
    val activeTagLabel =
        tagFilterId?.let { id -> snapshot.tags.firstOrNull { it.id == id }?.label }

    Box(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .background(widgetBackground)
                .padding(0.dp),
        contentAlignment = Alignment.TopStart,
    ) {
        Column(modifier = GlanceModifier.fillMaxSize()) {
            if (snapshot.user == null) {
                WidgetChip(
                    text = "Sign in",
                    action = actionStartActivity(intent = Intent(context, WidgetLoginActivity::class.java)),
                )
            } else {
                WidgetToolbar(
                    context = context,
                    categoryFilterId = categoryFilterId,
                    activeCategoryLabel = activeCategoryLabel,
                    activeTagLabel = activeTagLabel,
                )
                Spacer(modifier = GlanceModifier.height(2.dp))
                LazyColumn(modifier = GlanceModifier.fillMaxSize()) {
                    items(sortedNotes, itemId = { it.id.toLong() }) { note ->
                        NoteRow(
                            note = note,
                            context = context,
                            expanded = widgetState[expandedKey(note.id)] ?: false,
                        )
                    }
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun WidgetToolbar(
    context: Context,
    categoryFilterId: Int?,
    activeCategoryLabel: String?,
    activeTagLabel: String?,
) {
    Column(modifier = GlanceModifier.fillMaxWidth().padding(horizontal = 2.dp)) {
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            WidgetToolbarButton(
                iconRes = R.drawable.ic_widget_add,
                contentDescription = "Add",
                action =
                    actionStartActivity(
                        intent =
                            MainActivity.createLaunchIntent(
                                context = context,
                                action = MainActivity.launchActionAdd,
                                categoryId = categoryFilterId,
                            ),
                    ),
            )
            Spacer(modifier = GlanceModifier.width(4.dp))
            WidgetToolbarButton(
                iconRes = R.drawable.ic_widget_search,
                contentDescription = "Search",
                action =
                    actionStartActivity(
                        intent =
                            MainActivity.createLaunchIntent(
                                context = context,
                                action = MainActivity.launchActionSearch,
                                focusSearch = true,
                            ),
                    ),
            )
            Spacer(modifier = GlanceModifier.width(4.dp))
            WidgetToolbarButton(
                iconRes = R.drawable.ic_widget_refresh,
                contentDescription = "Refresh",
                action = actionRunCallback<RefreshNotesAction>(),
            )
        }
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            WidgetFilterButton(
                label = activeCategoryLabel?.let { "Category: $it" } ?: "Category: All",
                action =
                    actionStartActivity(
                        intent = Intent(context, WidgetCategoryPickerActivity::class.java),
                    ),
                modifier = GlanceModifier.defaultWeight(),
            )
            Spacer(modifier = GlanceModifier.width(4.dp))
            WidgetFilterButton(
                label = activeTagLabel?.let { "Tag: $it" } ?: "Tag: All",
                action =
                    actionStartActivity(
                        intent = Intent(context, WidgetTagPickerActivity::class.java),
                    ),
                modifier = GlanceModifier.defaultWeight(),
            )
        }
    }
}

private fun NoteRecord.titleLine(): String {
    val raw = description?.trim() ?: ""
    if (raw.isEmpty()) return "Untitled"
    return raw.split("\n", "\r\n").first()
}

private fun NoteRecord.datesIconRes(): Int {
    val hasDue = timeDue != null
    val hasRemind = timeRemind != null
    return when {
        hasDue && hasRemind -> R.drawable.ic_widget_clock_full
        hasDue || hasRemind -> R.drawable.ic_widget_clock_half
        else -> R.drawable.ic_widget_clock_none
    }
}

@androidx.compose.runtime.Composable
private fun NoteRowActions(
    note: NoteRecord,
    context: Context,
    expanded: Boolean,
) {
    Column(modifier = GlanceModifier.padding(top = noteRowButtonPadding)) {
        WidgetIconOnlyButton(
            iconRes = note.datesIconRes(),
            contentDescription = "Dates",
            bordered = false,
            verticalPadding = noteRowButtonPadding,
            action =
                actionRunCallback<ToggleExpandedAction>(
                    actionParametersOf(NoteActionKeys.noteId to note.id.toString()),
                ),
        )
        if (expanded) {
            WidgetIconOnlyButton(
                iconRes = R.drawable.ic_widget_edit,
                contentDescription = "Edit note",
                bordered = false,
                verticalPadding = noteRowButtonPadding,
                action =
                    actionStartActivity(
                        intent =
                            MainActivity.createLaunchIntent(
                                context = context,
                                action = MainActivity.launchActionEdit,
                                noteId = note.id,
                            ),
                    ),
            )
            WidgetIconOnlyButton(
                iconRes = R.drawable.ic_widget_delete,
                contentDescription = "Delete note",
                bordered = false,
                verticalPadding = noteRowButtonPadding,
                action =
                    actionStartActivity(
                        intent =
                            Intent(context, WidgetDeleteNoteActivity::class.java).apply {
                                putExtra(WidgetDeleteNoteActivity.extraNoteId, note.id)
                            },
                    ),
            )
        }
    }
}

@androidx.compose.runtime.Composable
private fun NoteRowContent(
    note: NoteRecord,
    expanded: Boolean,
) {
    Text(
        text = if (expanded) note.titleLine() else note.headline(),
        modifier =
            GlanceModifier.padding(
                top = noteRowTitleTopPadding,
                bottom = if (expanded) 0.dp else noteRowTitleBottomPadding,
            ),
        style = TextStyle(color = widgetText, fontWeight = FontWeight.Normal, fontSize = noteTitleFontSize),
        maxLines = if (expanded) 3 else 1,
    )

    if (!expanded) {
        return
    }

    note.descriptionBody().takeIf { it.isNotBlank() }?.let {
        Text(
            text = it,
            modifier = GlanceModifier.padding(top = 2.dp),
            style = TextStyle(color = widgetTextDim, fontSize = noteBodyFontSize),
            maxLines = 4,
        )
    }
    if (note.tags.isNotEmpty()) {
        Text(
            text = note.category.label,
            modifier = GlanceModifier.padding(top = 2.dp),
            style = TextStyle(color = widgetText),
            maxLines = 1,
        )
        note.tags.forEach { cat ->
            Text(
                text = "• ${cat.label}",
                modifier = GlanceModifier.padding(top = 2.dp),
                style = TextStyle(color = widgetText),
                maxLines = 1,
            )
        }
    }
    note.timeDue?.let { due ->
        Text(
            text = "Due ${formatConciseDate(due)}",
            modifier = GlanceModifier.padding(top = 4.dp),
            style = TextStyle(color = widgetTextDim),
            maxLines = 1,
        )
    }
    note.timeRemind?.let { remind ->
        Text(
            text = "Remind ${formatConciseDate(remind)}",
            modifier = GlanceModifier.padding(top = 2.dp),
            style = TextStyle(color = widgetTextDim),
            maxLines = 1,
        )
    }
}

@androidx.compose.runtime.Composable
private fun NoteRow(
    note: NoteRecord,
    context: Context,
    expanded: Boolean,
) {
    Column(
        modifier =
            GlanceModifier
                .fillMaxWidth()
                .padding(horizontal = 2.dp, vertical = 1.dp),
    ) {
        Box(
            modifier =
                GlanceModifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(ColorProvider(Color(0x33F5F7FB))),
        ) {}
        Row(
            modifier = GlanceModifier.fillMaxWidth().padding(bottom = 6.dp),
            verticalAlignment = Alignment.Top,
        ) {
            NoteRowActions(note = note, context = context, expanded = expanded)
            Column(
                modifier =
                    GlanceModifier
                        .defaultWeight()
                        .clickable(
                            actionRunCallback<ToggleExpandedAction>(
                                actionParametersOf(NoteActionKeys.noteId to note.id.toString()),
                            ),
                        )
                        .padding(start = 4.dp, top = 4.dp, end = 2.dp),
            ) {
                NoteRowContent(note = note, expanded = expanded)
            }
        }
    }
}

private object NoteActionKeys {
    val noteId = ActionParameters.Key<String>("note_id")
}

private fun expandedKey(noteId: Int) = booleanPreferencesKey("expanded_$noteId")

val widgetCategoryFilterKey = intPreferencesKey("widget_category_filter_id")
val widgetTagFilterKey = intPreferencesKey("widget_tag_filter_id")

fun readCategoryFilterId(prefs: androidx.datastore.preferences.core.Preferences): Int? {
    return readFilterId(prefs, widgetCategoryFilterKey)
}

fun readTagFilterId(prefs: androidx.datastore.preferences.core.Preferences): Int? {
    return readFilterId(prefs, widgetTagFilterKey)
}

private fun readFilterId(
    prefs: androidx.datastore.preferences.core.Preferences,
    key: androidx.datastore.preferences.core.Preferences.Key<Int>,
): Int? {
    if (!prefs.contains(key)) {
        return null
    }
    val value = prefs[key] ?: return null
    return if (value < 0) null else value
}

@androidx.compose.runtime.Composable
private fun WidgetChip(
    text: String,
    action: Action,
) {
    Box(
        modifier =
            GlanceModifier
                .clickable(action)
                .padding(horizontal = 2.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style =
                TextStyle(
                    color = widgetText,
                    fontWeight = FontWeight.Medium,
                ),
        )
    }
}

@androidx.compose.runtime.Composable
private fun WidgetToolbarButton(
    iconRes: Int,
    contentDescription: String,
    action: Action,
) {
    Box(
        modifier =
            GlanceModifier
                .clickable(action)
                .padding(6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            provider = ImageProvider(iconRes),
            contentDescription = contentDescription,
            modifier = GlanceModifier.size(18.dp),
        )
    }
}

@androidx.compose.runtime.Composable
private fun WidgetFilterButton(
    label: String,
    action: Action,
    modifier: GlanceModifier = GlanceModifier,
) {
    Box(
        modifier =
            modifier
                .clickable(action)
                .padding(horizontal = 6.dp, vertical = 4.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            text = "▾ $label",
            style = TextStyle(color = widgetText, fontWeight = FontWeight.Medium),
            maxLines = 1,
        )
    }
}

@androidx.compose.runtime.Composable
private fun WidgetIconOnlyButton(
    iconRes: Int,
    contentDescription: String,
    bordered: Boolean = true,
    action: Action,
    verticalPadding: androidx.compose.ui.unit.Dp? = null,
) {
    val padding =
        if (bordered) {
            6.dp
        } else {
            verticalPadding ?: 2.dp
        }
    Box(
        modifier =
            GlanceModifier
                .run {
                    if (bordered) {
                        background(ImageProvider(R.drawable.widget_icon_button_background))
                    } else {
                        this
                    }
                }
                .clickable(action)
                .padding(horizontal = if (bordered) 6.dp else 2.dp, vertical = padding),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            provider = ImageProvider(iconRes),
            contentDescription = contentDescription,
            modifier = GlanceModifier.size(18.dp),
        )
    }
}

@androidx.compose.runtime.Composable
private fun SignInOnly(context: Context) {
    WidgetChip(
        text = "Sign in",
        action = actionStartActivity(intent = Intent(context, WidgetLoginActivity::class.java)),
    )
}

class RefreshNotesAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: androidx.glance.GlanceId,
        parameters: ActionParameters,
    ) {
        val repository = (context.applicationContext as NotesApplication).repository
        val snapshot = repository.readSnapshot()
        if (snapshot.user != null) {
            repository.restoreSession(refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }
}

class ToggleExpandedAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: androidx.glance.GlanceId,
        parameters: ActionParameters,
    ) {
        val noteId = parameters[NoteActionKeys.noteId]?.toIntOrNull() ?: return
        updateAppWidgetState(context, glanceId) { prefs ->
            val key = expandedKey(noteId)
            prefs[key] = !(prefs[key] ?: false)
        }
        NotesHomeWidget().update(context, glanceId)
    }
}

/**
 * Clears widget-local expanded state for [noteId] on every placed Notes home widget instance.
 */
suspend fun clearWidgetExpandedStateForNote(
    context: Context,
    noteId: Int,
) {
    val appContext = context.applicationContext
    val manager = GlanceAppWidgetManager(appContext)
    val glanceIds = manager.getGlanceIds(NotesHomeWidget::class.java)
    val key = expandedKey(noteId)
    for (glanceId in glanceIds) {
        updateAppWidgetState(appContext, glanceId) { prefs ->
            prefs[key] = false
        }
        NotesHomeWidget().update(appContext, glanceId)
    }
}

class LogoutAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: androidx.glance.GlanceId,
        parameters: ActionParameters,
    ) {
        val repository = (context.applicationContext as NotesApplication).repository
        repository.logout()
    }
}
