package org.cloudreve.android.ui.files

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

class FormatTest {

    // Formatting follows the device locale (a German device shows "12,6 kB");
    // pin one so the expectations below are stable on any host.
    private val original = Locale.getDefault()

    @Before fun pinLocale() = Locale.setDefault(Locale.UK)
    @After fun restoreLocale() = Locale.setDefault(original)

    private val zone: ZoneId = ZoneId.systemDefault()
    private val now: Instant = ZonedDateTime.of(2026, 11, 7, 15, 0, 0, 0, zone).toInstant()
    private fun at(y: Int, mo: Int, d: Int, h: Int = 10, mi: Int = 30): String =
        ZonedDateTime.of(y, mo, d, h, mi, 0, 0, zone).toOffsetDateTime().toString()

    @Test
    fun `sizes use binary units with one decimal`() {
        assertEquals("0 B", formatSize(0))
        assertEquals("852 B", formatSize(852))
        assertEquals("12.6 kB", formatSize(12_870))
        assertEquals("60 MB", formatSize(62_914_560))
        assertEquals("1.5 GB", formatSize(1_610_612_736))
    }

    @Test
    fun `today shows the time, this year the day and month, older the full date`() {
        assertEquals("10:30", formatDate(at(2026, 11, 7), now))
        assertEquals("1 Oct", formatDate(at(2026, 10, 1), now))
        assertEquals("9 Jul 2025", formatDate(at(2025, 7, 9), now))
        assertEquals("", formatDate("not a date", now))
    }

    @Test
    fun `subtitle combines size and date and omits size for folders`() {
        assertEquals("12.6 kB • 10:30", subtitleFor(12_870, at(2026, 11, 7), isFolder = false, now = now))
        assertEquals("10:30", subtitleFor(0, at(2026, 11, 7), isFolder = true, now = now))
        assertEquals("852 B", subtitleFor(852, "", isFolder = false, now = now))
    }

    @Test
    fun `day group labels`() {
        assertEquals("Today", dayGroupLabel(at(2026, 11, 7, 1), now))
        assertEquals("Yesterday", dayGroupLabel(at(2026, 11, 6, 23, 59), now))
        assertEquals("Sat, 10 Oct", dayGroupLabel(at(2026, 10, 10), now))
        assertEquals("9 Jul 2025", dayGroupLabel(at(2025, 7, 9), now))
        assertEquals("Unknown date", dayGroupLabel("", now))
    }

    @Test
    fun `day key groups by local calendar day`() {
        assertEquals(dayKey(at(2026, 11, 7, 0, 1)), dayKey(at(2026, 11, 7, 23, 59)))
        assertEquals("", dayKey("garbage"))
    }
}
