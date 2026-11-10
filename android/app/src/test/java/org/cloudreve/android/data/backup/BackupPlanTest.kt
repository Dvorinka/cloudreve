package org.cloudreve.android.data.backup

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.ZoneId

class BackupPlanTest {

    @Test
    fun `capture time prefers EXIF and falls back to modification time`() {
        assertEquals(1_700_000_000_000L, BackupPlan.capturedAt(1_700_000_000_000L, 1_800_000_000L))
        assertEquals(1_800_000_000_000L, BackupPlan.capturedAt(0L, 1_800_000_000L))
    }

    @Test
    fun `folder follows the capture month in the local zone, not UTC`() {
        // 2026-01-31 23:30 in Berlin is 2026-01-31 22:30 UTC; both give January.
        // 2026-01-31 23:30 UTC is already 2026-02-01 00:30 in Berlin: February.
        val lateJanuaryUtc = 1_769_902_200_000L // 2026-01-31T23:30:00Z
        assertEquals("cloudreve://my/Photos/2026/02",
            BackupPlan.remoteFolder("cloudreve://my/Photos", lateJanuaryUtc, ZoneId.of("Europe/Berlin")))
        assertEquals("cloudreve://my/Photos/2026/01",
            BackupPlan.remoteFolder("cloudreve://my/Photos/", lateJanuaryUtc, ZoneId.of("UTC")))
    }

    @Test
    fun `disambiguated name keeps the extension and takes eight hash characters`() {
        val sha = "3f9a2c1b" + "0".repeat(56)
        assertEquals("IMG_0001~3f9a2c1b.jpg", BackupPlan.disambiguate("IMG_0001.jpg", sha))
        assertEquals("PXL_2026.01.01~3f9a2c1b.mp4", BackupPlan.disambiguate("PXL_2026.01.01.mp4", sha))
        assertEquals("noext~3f9a2c1b", BackupPlan.disambiguate("noext", sha))
    }

    @Test
    fun `copyAndHash copies every byte and returns the sha256`() {
        val out = ByteArrayOutputStream()
        val sha = BackupPlan.copyAndHash(ByteArrayInputStream("abc".toByteArray()), out)
        assertEquals("abc", out.toString())
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sha)
    }
}
