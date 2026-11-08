package org.cloudreve.android.data.backup

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The pure decisions of photo backup: where a photo goes, what it is called
 * when its name is taken, and what counts as its capture time. Kept free of
 * Android so they can be unit-tested.
 */
object BackupPlan {

    private val folderFormat = DateTimeFormatter.ofPattern("yyyy/MM")

    /**
     * Capture time: EXIF / container date when MediaStore has it, else the file's
     * modification time (screenshots, messaging apps, stripped EXIF). Never the
     * upload time: a first sync of ten years of photos must not land in one month.
     */
    fun capturedAt(dateTakenMs: Long, dateModifiedSec: Long): Long =
        if (dateTakenMs > 0) dateTakenMs else dateModifiedSec * 1000

    /** `root/yyyy/MM` in the given zone, so a photo at 23:30 on the 31st stays in its month. */
    fun remoteFolder(root: String, capturedAtMs: Long, zone: ZoneId): String =
        root.trimEnd('/') + "/" + folderFormat.format(Instant.ofEpochMilli(capturedAtMs).atZone(zone))

    /** `IMG_0001.jpg` taken by a different file becomes `IMG_0001~3f9a2c1b.jpg`. */
    fun disambiguate(name: String, sha256: String): String {
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        return "$stem~${sha256.take(8)}$ext"
    }

    /** Copies [input] to [out] and returns the SHA-256 hex of everything copied. */
    fun copyAndHash(input: InputStream, out: OutputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(256 * 1024)
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            digest.update(buffer, 0, n)
            out.write(buffer, 0, n)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun sha256Of(file: File): String =
        file.inputStream().use { copyAndHash(it, Discard) }

    /** `OutputStream.nullOutputStream()` needs API 33. */
    private object Discard : OutputStream() {
        override fun write(b: Int) = Unit
        override fun write(b: ByteArray, off: Int, len: Int) = Unit
    }
}
