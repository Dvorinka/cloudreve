package org.cloudreve.android.ui.files

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Android
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderZip
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Slideshow
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import org.cloudreve.android.api.FileObject

/**
 * Coarse file categories for icons and tints. Mirrors the extension groups
 * the server ships in `site/config/explorer.icons`, hardcoded so the list
 * renders before (or without) that call.
 */
enum class FileKind(val icon: ImageVector, val tint: Color) {
    FOLDER(Icons.Default.Folder, Color(0xFF8FB3E0)),
    IMAGE(Icons.Default.Image, Color(0xFFE08F8F)),
    VIDEO(Icons.Default.Videocam, Color(0xFFD98BB6)),
    AUDIO(Icons.Default.MusicNote, Color(0xFFB39DDB)),
    PDF(Icons.Default.PictureAsPdf, Color(0xFFE59A7A)),
    DOCUMENT(Icons.Default.Description, Color(0xFF8FB3E0)),
    SPREADSHEET(Icons.Default.TableChart, Color(0xFF8FCB9B)),
    PRESENTATION(Icons.Default.Slideshow, Color(0xFFE5B86A)),
    ARCHIVE(Icons.Default.FolderZip, Color(0xFFC4A77D)),
    CODE(Icons.Default.Code, Color(0xFF8ECFD6)),
    APK(Icons.Default.Android, Color(0xFF9CCC65)),
    OTHER(Icons.AutoMirrored.Filled.InsertDriveFile, Color(0xFFA6ADB7));

    companion object {
        private val byExt: Map<String, FileKind> = buildMap {
            fun put(kind: FileKind, vararg exts: String) = exts.forEach { put(it, kind) }
            put(IMAGE, "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "svg", "tiff", "tif", "psd")
            put(IMAGE, "3fr", "arw", "cr2", "cr3", "dng", "nef", "orf", "raf", "raw", "rw2")
            put(VIDEO, "mp4", "mkv", "mov", "avi", "webm", "m4v", "wmv", "flv", "mpg", "mpeg", "3gp", "ts", "m3u8", "ogv")
            put(AUDIO, "mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "wma", "aiff", "ape")
            put(PDF, "pdf")
            put(DOCUMENT, "doc", "docx", "odt", "rtf", "txt", "md", "markdown", "pages", "epub", "tex")
            put(SPREADSHEET, "xls", "xlsx", "ods", "csv", "tsv", "numbers")
            put(PRESENTATION, "ppt", "pptx", "odp", "key")
            put(ARCHIVE, "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "dmg", "img")
            put(CODE, "kt", "kts", "java", "rs", "go", "py", "js", "ts", "tsx", "jsx", "c", "h", "cpp", "hpp", "cs", "swift", "rb", "php", "sh", "zsh", "fish")
            put(CODE, "json", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "html", "htm", "css", "scss", "sql", "gradle", "lock")
            put(APK, "apk", "aab", "xapk")
        }

        fun of(file: FileObject): FileKind =
            if (file.isFolder) FOLDER else byExt[file.name.substringAfterLast('.', "").lowercase()] ?: OTHER
    }
}
