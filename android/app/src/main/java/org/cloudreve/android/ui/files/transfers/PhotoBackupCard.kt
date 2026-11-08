package org.cloudreve.android.ui.files.transfers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.cloudreve.android.data.BackupStats
import org.cloudreve.android.ui.files.formatDate
import org.cloudreve.android.util.CrUri
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * Photo backup at a glance: how much of the device's media is in the drive,
 * what is still waiting, what gave up, and when the worker last ran. Shown on
 * the home page and in Settings while backup is enabled.
 */
@Composable
fun PhotoBackupCard(
    stats: BackupStats.Stats,
    running: Boolean,
    onSyncNow: () -> Unit,
    onRetryFailed: () -> Unit,
    onOpenFolder: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onOpenFolder,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(start = 20.dp, end = 12.dp, top = 16.dp, bottom = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (stats.done) Icons.Default.CloudDone else Icons.Default.CloudUpload,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp),
                )
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text("Photo backup", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${"%,d".format(stats.synced)} of ${"%,d".format(stats.total)} backed up to ${CrUri.displayName(stats.remoteFolder)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            LinearProgressIndicator(
                progress = { stats.fraction },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp, end = 8.dp),
            )

            Text(
                statusLine(stats, running),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )

            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (stats.failed > 0) {
                    TextButton(onClick = onRetryFailed, enabled = !running) {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Retry ${stats.failed} failed")
                    }
                }
                TextButton(onClick = onSyncNow, enabled = !running) {
                    if (stats.waitingForWifi) {
                        Icon(Icons.Default.WifiOff, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                    } else {
                        Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(if (running) "Backing up…" else "Back up now")
                }
            }
        }
    }
}

private fun statusLine(s: BackupStats.Stats, running: Boolean): String {
    val parts = mutableListOf<String>()
    when {
        running -> parts += "Backing up now"
        s.pending > 0 && s.waitingForWifi -> parts += "${"%,d".format(s.pending)} waiting for Wi-Fi"
        s.pending > 0 -> parts += "${"%,d".format(s.pending)} waiting"
        s.failed == 0 -> parts += "Everything is backed up"
    }
    if (s.failed > 0) parts += "${s.failed} failed"
    if (s.lastRunAt > 0) {
        val iso = OffsetDateTime.ofInstant(Instant.ofEpochMilli(s.lastRunAt), ZoneId.systemDefault()).toString()
        parts += "Last run ${formatDate(iso)}"
    }
    return parts.joinToString(" • ")
}
