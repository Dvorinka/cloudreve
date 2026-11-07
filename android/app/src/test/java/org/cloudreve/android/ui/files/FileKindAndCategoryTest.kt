package org.cloudreve.android.ui.files

import org.cloudreve.android.api.FileObject
import org.cloudreve.android.ui.preview.PreviewKind
import org.cloudreve.android.ui.preview.previewKindOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FileKindAndCategoryTest {

    private fun file(name: String, type: Int = 0, size: Long = 1, metadata: Map<String, String>? = null) =
        FileObject(type = type, name = name, path = "cloudreve://my/$name", size = size, metadata = metadata)

    @Test
    fun `kinds follow the extension, case-insensitively, folders win`() {
        assertEquals(FileKind.IMAGE, FileKind.of(file("IMG_0001.JPG")))
        assertEquals(FileKind.PDF, FileKind.of(file("resume.pdf")))
        assertEquals(FileKind.CODE, FileKind.of(file("deploy.py")))
        assertEquals(FileKind.ARCHIVE, FileKind.of(file("firmware-update.img")))
        assertEquals(FileKind.OTHER, FileKind.of(file("dataset.bin")))
        assertEquals(FileKind.OTHER, FileKind.of(file("README")))
        assertEquals(FileKind.FOLDER, FileKind.of(file("photos.jpg", type = 1)))
    }

    @Test
    fun `thumbnails are requested until the server marks them disabled`() {
        assertTrue(file("a.jpg").mayHaveThumbnail)
        assertFalse(file("a.jpg", metadata = mapOf(FileObject.METADATA_THUMB_DISABLED to "")).mayHaveThumbnail)
        assertFalse(file("dir", type = 1).mayHaveThumbnail)
    }

    @Test
    fun `preview kinds`() {
        assertEquals(PreviewKind.IMAGE, previewKindOf(file("a.webp")))
        assertNull(previewKindOf(file("raw.cr2")))               // image kind but not a raster the viewer decodes
        assertEquals(PreviewKind.VIDEO, previewKindOf(file("clip.mkv")))
        assertEquals(PreviewKind.PDF, previewKindOf(file("doc.pdf")))
        assertEquals(PreviewKind.TEXT, previewKindOf(file("notes.md")))
        assertNull(previewKindOf(file("notes.md", size = 3L * 1024 * 1024)))  // too big for inline text
        assertNull(previewKindOf(file("slides.pptx")))
    }

    @Test
    fun `categories round-trip through their URIs`() {
        Category.entries.forEach { assertEquals(it, Category.fromUri(it.uri)) }
        assertNull(Category.fromUri("cloudreve://my/Documents"))
        assertTrue(Category.IMAGES.gallery)
        assertFalse(Category.DOCUMENTS.gallery)
    }

    @Test
    fun `trash items expose their origin`() {
        val trashed = file("x.bin", metadata = mapOf(FileObject.METADATA_RESTORE_URI to "cloudreve://my/Downloads/x.bin"))
        assertEquals("cloudreve://my/Downloads/x.bin", trashed.restoreUri)
        assertNull(file("x.bin").restoreUri)
    }
}
