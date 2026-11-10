package org.cloudreve.android.ui.preview

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.ui.files.FilesViewModel
import java.io.File

/** Plain text and source files: monospace, selectable, scrolls both ways. */
@Composable
fun TextPreview(file: FileObject, viewModel: FilesViewModel) {
    val (local, progress) = rememberLocalCopy(file, viewModel)
    if (local == null) {
        LoadingOverlay(progress)
        return
    }
    val text by produceState<String?>(initialValue = null, local) {
        value = withContext(Dispatchers.IO) { runCatching { readText(local) }.getOrNull() }
    }
    when (val t = text) {
        null -> LoadingOverlay(null)
        else -> SelectionContainer {
            Text(
                t,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .horizontalScroll(rememberScrollState())
                    .padding(start = 16.dp, end = 16.dp, top = chromeTopPadding(), bottom = 24.dp),
            )
        }
    }
}

private fun readText(file: File): String = file.readText().let {
    if (it.length > 200_000) it.take(200_000) + "\n\n… (truncated)" else it
}
