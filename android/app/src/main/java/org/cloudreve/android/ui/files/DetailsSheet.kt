package org.cloudreve.android.ui.files

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.util.CrUri
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Read-only facts about a file, laid out as label/value rows like the Files app's Info. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailsSheet(file: FileObject, thumbUrl: String?, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FileThumb(file, thumbUrl, size = 56.dp)
            Column(Modifier.padding(start = 16.dp)) {
                Text(file.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(kindLabel(file), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 8.dp))

        SelectionContainer {
            Column {
                if (!file.isFolder) DetailRow("Size", "${formatSize(file.size)} (${"%,d".format(file.size)} bytes)")
                DetailRow("Location", locationOf(file))
                DetailRow("Modified", longDate(file.updatedAt))
                DetailRow("Created", longDate(file.createdAt))
                val w = file.metadata?.get("exif:x")
                val h = file.metadata?.get("exif:y")
                if (w != null && h != null) DetailRow("Dimensions", "$w × $h")
                file.metadata?.get("stream:duration")?.let { DetailRow("Duration", it) }
                if (file.shared == true) DetailRow("Sharing", "Shared via link")
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 10.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(110.dp),
        )
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun kindLabel(file: FileObject): String {
    if (file.isFolder) return "Folder"
    val ext = file.name.substringAfterLast('.', "").uppercase()
    val kind = when (FileKind.of(file)) {
        FileKind.IMAGE -> "image"
        FileKind.VIDEO -> "video"
        FileKind.AUDIO -> "audio"
        FileKind.PDF -> "PDF document"
        FileKind.DOCUMENT -> "document"
        FileKind.SPREADSHEET -> "spreadsheet"
        FileKind.PRESENTATION -> "presentation"
        FileKind.ARCHIVE -> "archive"
        FileKind.CODE -> "source file"
        FileKind.APK -> "Android package"
        else -> "file"
    }
    return if (ext.isEmpty() || kind == "PDF document") kind.replaceFirstChar { it.uppercase() } else "$ext $kind"
}

private fun locationOf(file: FileObject): String {
    val parent = CrUri.parent(file.path).removePrefix(CrUri.MY_PREFIX).trim('/')
    return if (parent.isEmpty()) "My files" else "My files / " + java.net.URLDecoder.decode(parent, "UTF-8").replace("/", " / ")
}

private fun longDate(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(java.time.ZoneId.systemDefault())
        .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT))
}.getOrDefault(iso.ifEmpty { "—" })
