package org.cloudreve.android.ui.files

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.util.CrUri

/** Search bar in the top-bar slot: plain text field, live results, clear button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchTopBar(
    text: String,
    onTextChange: (String) -> Unit,
    onClose: () -> Unit,
    focus: FocusRequester,
) {
    TopAppBar(
        title = {
            val style = LocalTextStyle.current.merge(MaterialTheme.typography.bodyLarge)
            BasicTextField(
                value = text,
                onValueChange = onTextChange,
                singleLine = true,
                textStyle = style.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { }),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focus),
                decorationBox = { inner ->
                    Box {
                        if (text.isEmpty()) {
                            Text("Search files", style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        inner()
                    }
                },
            )
        },
        navigationIcon = {
            IconButton(onClick = onClose) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Close search")
            }
        },
        actions = {
            if (text.isNotEmpty()) {
                IconButton(onClick = { onTextChange("") }) {
                    Icon(Icons.Default.Close, contentDescription = "Clear")
                }
            }
        },
    )
}

/**
 * Results with scope and type chips above them. The scope chip pair only
 * appears when the search was opened from inside a folder.
 */
@Composable
fun SearchResults(
    state: FilesUiState,
    viewModel: FilesViewModel,
    listState: LazyListState,
    openedFrom: String?,
    actionsFor: (FileObject) -> FileActions,
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (openedFrom != null) {
                FilterChip(
                    selected = state.searchScope != null,
                    onClick = { viewModel.setSearchScope(openedFrom) },
                    label = { Text(CrUri.fileName(openedFrom)) },
                )
                FilterChip(
                    selected = state.searchScope == null,
                    onClick = { viewModel.setSearchScope(null) },
                    label = { Text("Everywhere") },
                )
                Box(Modifier.size(8.dp))
            }
            listOf(Category.IMAGES, Category.VIDEOS, Category.AUDIO, Category.DOCUMENTS).forEach { c ->
                FilterChip(
                    selected = state.searchType == c,
                    onClick = { viewModel.setSearchType(if (state.searchType == c) null else c) },
                    label = { Text(c.label) },
                )
            }
        }

        val query = state.searchQuery.orEmpty().trim()
        when {
            query.isEmpty() -> Hint(Icons.Outlined.Search, "Type to search by file name")
            state.searchLoading && state.searchResults.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            state.searchError != null -> Hint(Icons.Outlined.SearchOff, state.searchError)
            state.searchResults.isEmpty() -> Hint(Icons.Outlined.SearchOff, "No files match \"$query\"")
            else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                items(state.searchResults, key = { it.id + it.path }) { file ->
                    val parent = CrUri.parent(file.path)
                    FileListItem(
                        file = file,
                        thumbUrl = rememberThumbUrl(viewModel, file),
                        selecting = false,
                        selected = false,
                        subtitle = "${subtitleFor(file.size, file.updatedAt, file.isFolder)} • ${if (CrUri.isRoot(parent)) "My files" else CrUri.fileName(parent)}",
                        actions = actionsFor(file),
                    )
                }
                if (state.searchLoadingMore) {
                    item {
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.Center) {
                            CircularProgressIndicator(Modifier.size(28.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Hint(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(56.dp))
            Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp))
        }
    }
}
