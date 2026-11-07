package org.cloudreve.android.ui.files.transfers

import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.cloudreve.android.work.UploadWorker

/** A picked batch with its resolved target names, waiting for a conflict decision. */
data class PendingUpload(
    val uris: List<Uri>,
    val names: List<String>,
    val parentUri: String,
    val existing: Set<String>,
) {
    val conflicts: List<String> get() = names.filter { it in existing }

    fun replace() = Resolution(uris, names, overwrite = true)

    fun keepBoth(): Resolution {
        val taken = existing.toMutableSet()
        val renamed = names.map { n -> UploadWorker.uniqueName(n, taken).also { taken += it } }
        return Resolution(uris, renamed, overwrite = false)
    }

    fun skip(): Resolution {
        val keep = names.indices.filter { names[it] !in existing }
        return Resolution(keep.map { uris[it] }, keep.map { names[it] }, overwrite = false)
    }

    data class Resolution(val uris: List<Uri>, val names: List<String>, val overwrite: Boolean)
}

/**
 * Asked once per batch before anything is queued, like Drive: the user
 * decides how every clashing name is handled instead of discovering a
 * failure in the notification afterwards.
 */
@Composable
fun UploadConflictDialog(
    pending: PendingUpload,
    onResolve: (PendingUpload.Resolution) -> Unit,
    onDismiss: () -> Unit,
) {
    val conflicts = pending.conflicts
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                if (conflicts.size == 1) "\"${conflicts.first()}\" already exists"
                else "${conflicts.size} files already exist",
            )
        },
        text = {
            Column {
                Text("Replace keeps the old copy as a previous version. Keep both uploads under a new name.")
                if (conflicts.size > 1) {
                    Text(
                        conflicts.take(5).joinToString("\n") + if (conflicts.size > 5) "\n…" else "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 6,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onResolve(pending.replace()) }) { Text("Replace") }
        },
        dismissButton = {
            TextButton(onClick = { onResolve(pending.keepBoth()) }) { Text("Keep both") }
            TextButton(onClick = { onResolve(pending.skip()) }) { Text("Skip") }
        },
    )
}
