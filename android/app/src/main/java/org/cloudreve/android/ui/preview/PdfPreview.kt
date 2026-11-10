package org.cloudreve.android.ui.preview

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.ui.files.FilesViewModel
import java.io.File

/**
 * Renders the PDF with the platform [PdfRenderer] after downloading it to
 * cache: one bitmap per page, rendered lazily at screen width as the user
 * scrolls. Good enough for payslips and tickets; heavy documents still
 * have "Open with another app".
 */
@Composable
fun PdfPreview(file: FileObject, viewModel: FilesViewModel, onTap: () -> Unit) {
    val (local, progress) = rememberLocalCopy(file, viewModel)
    if (local == null) {
        LoadingOverlay(progress)
        return
    }
    PdfPages(local, onTap)
}

@Composable
private fun PdfPages(local: File, onTap: () -> Unit) {
    val document = remember(local) { PdfDocument.open(local) }
    DisposableEffect(document) { onDispose { document?.close() } }
    if (document == null) {
        FullWidthError("Couldn't read this PDF")
        return
    }
    val widthPx = with(LocalDensity.current) { (LocalConfiguration.current.screenWidthDp.dp - 24.dp).roundToPx() }

    LazyColumn(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) { detectTapGestures(onTap = { onTap() }) },
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = chromeTopPadding(), bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(document.pageCount) { index ->
            val ratio = document.aspectRatio(index)
            val bitmap by produceState<Bitmap?>(initialValue = null, index, widthPx) {
                value = document.render(index, widthPx)
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(ratio)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color.White),
            ) {
                bitmap?.let {
                    Image(it.asImageBitmap(), contentDescription = "Page ${index + 1}", contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxSize())
                }
            }
        }
    }
}

/** Serialises access to PdfRenderer, which is not thread-safe. */
private class PdfDocument private constructor(
    private val fd: ParcelFileDescriptor,
    private val renderer: PdfRenderer,
) {
    private val lock = Mutex()
    val pageCount: Int get() = renderer.pageCount
    private val ratios = HashMap<Int, Float>()

    fun aspectRatio(index: Int): Float = ratios.getOrPut(index) {
        renderer.openPage(index).use { it.width.toFloat() / it.height }
    }

    suspend fun render(index: Int, widthPx: Int): Bitmap = withContext(Dispatchers.IO) {
        lock.withLock {
            renderer.openPage(index).use { page ->
                val height = (widthPx.toFloat() * page.height / page.width).toInt().coerceAtLeast(1)
                createBitmap(widthPx, height).also {
                    it.eraseColor(android.graphics.Color.WHITE)
                    page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        }
    }

    fun close() {
        renderer.close()
        fd.close()
    }

    companion object {
        fun open(file: File): PdfDocument? = runCatching {
            val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            PdfDocument(fd, PdfRenderer(fd))
        }.getOrNull()
    }
}
