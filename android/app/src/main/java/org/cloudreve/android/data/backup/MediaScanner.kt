package org.cloudreve.android.data.backup

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore

/**
 * One row per photo or video MediaStore knows about: ids, names, sizes and
 * dates only, no file access, so a full pass over thousands of items takes
 * tens of milliseconds and can run on every scan and every stats refresh.
 */
class MediaScanner(private val context: Context) {

    data class Row(
        val id: Long,
        val contentUri: Uri,
        val name: String,
        val size: Long,
        /** EXIF DateTimeOriginal / video creation time in epoch millis; 0 when absent. */
        val dateTaken: Long,
        /** File modification time, seconds. */
        val dateModified: Long,
        val mimeType: String?,
    ) {
        val capturedAt: Long get() = BackupPlan.capturedAt(dateTaken, dateModified)
    }

    fun scan(includeVideos: Boolean): List<Row> {
        val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
        val types = buildList {
            add(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE)
            if (includeVideos) add(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO)
        }
        val projection = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            DATE_TAKEN,
            MediaStore.Files.FileColumns.DATE_MODIFIED,
            MediaStore.Files.FileColumns.MIME_TYPE,
            @Suppress("DEPRECATION")
            MediaStore.Files.FileColumns.DATA,
        )
        val selection = "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (${types.joinToString(",") { "?" }})"
        val rows = mutableListOf<Row>()
        // MediaStore's indexer honours .nomedia, but only on its own schedule:
        // a marker dropped after indexing leaves rows visible until the next
        // scan, so directories are re-checked on disk here (once per parent).
        val nomediaDirs = HashMap<String, Boolean>()
        fun hasNomedia(data: String?): Boolean {
            val parent = data?.let { java.io.File(it).parent } ?: return false
            return nomediaDirs.getOrPut(parent) { java.io.File(parent, ".nomedia").exists() }
        }
        context.contentResolver.query(
            collection, projection, selection, types.map { it.toString() }.toTypedArray(), null,
        )?.use { c ->
            val id = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val name = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
            val size = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
            val taken = c.getColumnIndexOrThrow(DATE_TAKEN)
            val modified = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED)
            val mime = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MIME_TYPE)
            val data = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATA)
            while (c.moveToNext()) {
                if (hasNomedia(if (c.isNull(data)) null else c.getString(data))) continue
                val rowId = c.getLong(id)
                rows += Row(
                    id = rowId,
                    contentUri = ContentUris.withAppendedId(collection, rowId),
                    name = c.getString(name) ?: "media_$rowId",
                    size = c.getLong(size),
                    dateTaken = if (c.isNull(taken)) 0L else c.getLong(taken),
                    dateModified = c.getLong(modified),
                    mimeType = if (c.isNull(mime)) null else c.getString(mime),
                )
            }
        }
        return rows
    }

    private companion object {
        /** `datetaken` exists in the files table on every supported API level; the
         *  typed MediaColumns constant only arrived in 29. */
        @Suppress("DEPRECATION")
        const val DATE_TAKEN = MediaStore.Images.Media.DATE_TAKEN
    }
}
