package com.eighthbrain.notesandroid.app.widget

import android.content.Context
import android.content.Intent
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
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
import com.eighthbrain.notesandroid.app.model.sortedByLastUpdated
import com.eighthbrain.notesandroid.app.ui.MainActivity
import com.eighthbrain.notesandroid.app.ui.WidgetCategoryPickerActivity
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
        val repository = (context.applicationContext as NotesApplication).repository
        val snapshot = repository.readSnapshot()

        provideContent {
            WidgetContent(snapshot = snapshot)
        }
    }
}

private val widgetBackground = ColorProvider(Color(0xFF10131A))
private val widgetText = ColorProvider(Color(0xFFF5F7FB))
private val widgetTextDim = ColorProvider(Color(0x99F5F7FB))
private val noteTitleFontSize: TextUnit = 16.sp

@androidx.compose.runtime.Composable
private fun WidgetContent(snapshot: AppSnapshot) {
    val context = LocalContext.current
    val widgetState = currentState<androidx.datastore.preferences.core.Preferences>()
    val categoryFilterId = readCategoryFilterId(widgetState)
    val tagFilterId = readTagFilterId(widgetState)
    val filteredNotes =
        snapshot.notes.filter { note ->
            val matchesCategory = categoryFilterId == null || note.category.id == categoryFilterId
            val matchesTag = tagFilterId == null || note.tags.any { tag -> tag.id == tagFilterId }
            matchesCategory && matchesTag
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
            modifier =
                GlanceModifier
                    .fillMaxWidth()
                    .clickable(actionRunCallback<ToggleExpandedAction>(actionParametersOf(NoteActionKeys.noteId to note.id.toString()))),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = note.headline(),
                modifier = GlanceModifier.defaultWeight().padding(vertical = 4.dp),
                style = TextStyle(color = widgetText, fontWeight = FontWeight.Bold, fontSize = noteTitleFontSize),
                maxLines = if (expanded) 3 else 1,
            )
            if (expanded) {
                WidgetIconOnlyButton(
                    iconRes = R.drawable.ic_widget_edit,
                    contentDescription = "Edit note",
                    bordered = false,
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
            }
        }

        if (expanded) {
            Column(
                modifier = GlanceModifier.fillMaxWidth().padding(bottom = 6.dp),
            ) {
                note.descriptionBody().takeIf { it.isNotBlank() }?.let {
                    Text(
                        text = it,
                        modifier = GlanceModifier.padding(top = 2.dp),
                        style = TextStyle(color = widgetText),
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
                Text(
                    text = "Due ${formatConciseDate(note.timeDue)}",
                    modifier = GlanceModifier.padding(top = 4.dp),
                    style = TextStyle(color = widgetTextDim),
                    maxLines = 1,
                )
                Row(
                    modifier = GlanceModifier.fillMaxWidth().padding(top = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Remind ${formatConciseDate(note.timeRemind)}",
                        modifier = GlanceModifier.defaultWeight().padding(end = 4.dp),
                        style = TextStyle(color = widgetTextDim),
                        maxLines = 1,
                    )
                    WidgetIconOnlyButton(
                        iconRes = R.drawable.ic_widget_delete,
                        contentDescription = "Delete note",
                        bordered = false,
                        action =
                            actionStartActivity(
                                intent =
                                    MainActivity.createLaunchIntent(
                                        context = context,
                                        action = MainActivity.launchActionDelete,
                                        noteId = note.id,
                                    ),
                            ),
                    )
                }
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
) {
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
                .padding(if (bordered) 6.dp else 2.dp),
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
 * Used when delete is handled from [MainActivity] so list rows do not stay "expanded" for a removed id.
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
