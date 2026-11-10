package org.cloudreve.android.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.viewStore by preferencesDataStore(name = "view")

enum class ViewMode { LIST, GRID }

/** Sort keys accepted by `GET /file?order_by=`. */
enum class SortBy(val apiName: String) {
    NAME("name"),
    SIZE("size"),
    UPDATED("updated_at"),
}

data class SortOrder(val by: SortBy = SortBy.NAME, val ascending: Boolean = true) {
    val apiDirection: String get() = if (ascending) "asc" else "desc"
}

data class ViewPrefs(
    val mode: ViewMode = ViewMode.LIST,
    /** Images and Videos categories read as a gallery, so they keep their own mode. */
    val galleryMode: ViewMode = ViewMode.GRID,
    val sort: SortOrder = SortOrder(),
)

/** How the file list is displayed; remembered across launches. */
class ViewSettings(private val context: Context) {

    private object Keys {
        val mode = stringPreferencesKey("mode")
        val galleryMode = stringPreferencesKey("gallery_mode")
        val sortBy = stringPreferencesKey("sort_by")
        val sortAsc = booleanPreferencesKey("sort_asc")
    }

    val prefs: Flow<ViewPrefs> = context.viewStore.data.map { p ->
        ViewPrefs(
            mode = p[Keys.mode]?.let { runCatching { ViewMode.valueOf(it) }.getOrNull() } ?: ViewMode.LIST,
            galleryMode = p[Keys.galleryMode]?.let { runCatching { ViewMode.valueOf(it) }.getOrNull() } ?: ViewMode.GRID,
            sort = SortOrder(
                by = p[Keys.sortBy]?.let { runCatching { SortBy.valueOf(it) }.getOrNull() } ?: SortBy.NAME,
                ascending = p[Keys.sortAsc] ?: true,
            ),
        )
    }

    suspend fun setMode(mode: ViewMode) {
        context.viewStore.edit { it[Keys.mode] = mode.name }
    }

    suspend fun setGalleryMode(mode: ViewMode) {
        context.viewStore.edit { it[Keys.galleryMode] = mode.name }
    }

    suspend fun setSort(sort: SortOrder) {
        context.viewStore.edit {
            it[Keys.sortBy] = sort.by.name
            it[Keys.sortAsc] = sort.ascending
        }
    }
}
