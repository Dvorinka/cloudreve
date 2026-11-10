package org.cloudreve.android.ui.files

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.util.CrUri

/**
 * Full-screen destination chooser for Move / Copy, drawn over the files
 * screen. Starts in the current folder, browses subfolders only, and
 * confirms with a single button that names the destination. Folders being
 * moved are greyed out so a folder cannot be dropped into itself.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolderPicker(
    title: String,
    confirmLabel: String,
    startUri: String,
    excluded: Set<String>,
    loadFolders: suspend (String) -> List<FileObject>,
    onCreateFolder: (parent: String, name: String) -> Unit,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var current by remember { mutableStateOf(startUri) }
    var folders by remember { mutableStateOf<List<FileObject>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var mkdirOpen by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }

    LaunchedEffect(current, reload) {
        folders = null
        error = null
        runCatching { loadFolders(current) }
            .onSuccess { folders = it }
            .onFailure { error = it.message }
    }

    val atRoot = CrUri.isRoot(current)
    BackHandler { if (atRoot) onDismiss() else current = CrUri.parent(current) }

    // Drawn as an overlay inside the files screen rather than a Dialog window:
    // dialog windows sit below the status bar and then overflow the Scaffold.
    Surface(Modifier.fillMaxSize()) {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = {
                            Column {
                                Text(title, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    CrUri.displayName(current),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        },
                        navigationIcon = {
                            if (atRoot) {
                                IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, contentDescription = "Cancel") }
                            } else {
                                IconButton(onClick = { current = CrUri.parent(current) }) {
                                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Up")
                                }
                            }
                        },
                        actions = {
                            IconButton(onClick = { mkdirOpen = true }) {
                                Icon(Icons.Default.CreateNewFolder, contentDescription = "New folder")
                            }
                        },
                    )
                },
                bottomBar = {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        Button(onClick = { onPick(current) }, enabled = current !in excluded) {
                            Text("$confirmLabel ${CrUri.displayName(current)}")
                        }
                    }
                },
            ) { padding ->
                Box(Modifier.fillMaxSize().padding(padding)) {
                    val list = folders
                    when {
                        error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(error ?: "", color = MaterialTheme.colorScheme.error)
                        }
                        list == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                        list.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    Icons.Outlined.FolderOpen, contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(48.dp),
                                )
                                Text(
                                    "No subfolders", color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                            }
                        }
                        else -> LazyColumn {
                            items(list, key = { it.path }) { folder ->
                                val disabled = folder.path in excluded
                                ListItem(
                                    modifier = Modifier.clickable(enabled = !disabled) { current = folder.path },
                                    headlineContent = {
                                        Text(
                                            folder.name, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                            color = if (disabled) MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                                            else MaterialTheme.colorScheme.onSurface,
                                        )
                                    },
                                    supportingContent = if (disabled) ({ Text("Being moved") }) else null,
                                    leadingContent = {
                                        Icon(
                                            Icons.Default.Folder, contentDescription = null,
                                            tint = FileKind.FOLDER.tint.copy(alpha = if (disabled) 0.4f else 1f),
                                        )
                                    },
                                )
                            }
                        }
                    }
                }
            }
    }

    if (mkdirOpen) {
        NameDialog(
            title = "New folder",
            label = "Folder name",
            confirm = "Create",
            onConfirm = { name ->
                mkdirOpen = false
                onCreateFolder(current, name)
                reload++
            },
            onDismiss = { mkdirOpen = false },
        )
    }
}

