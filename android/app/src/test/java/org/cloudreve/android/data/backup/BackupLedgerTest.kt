package org.cloudreve.android.data.backup

import org.cloudreve.android.data.backup.BackupLedger.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35]) // Robolectric 4.14 tops out below targetSdk 36
class BackupLedgerTest {

    private lateinit var ledger: BackupLedger

    @Before
    fun setUp() {
        ledger = BackupLedger(RuntimeEnvironment.getApplication())
    }

    private fun item(sha: String, mediaId: Long, size: Long = 100, modified: Long = 10, state: State = State.UPLOADED) =
        BackupLedger.Item(
            sha256 = sha, mediaId = mediaId, name = "a.jpg", size = size, capturedAt = 1, dateModified = modified,
            remoteUri = "cloudreve://my/Photos/2026/01/a.jpg", remoteSize = size, state = state,
        )

    @Test
    fun `a scan row matches only when id, size and modification time agree`() {
        ledger.upsert(item("aaa", mediaId = 1, size = 100, modified = 10))
        val index = ledger.byMediaId()
        assertEquals("aaa", ledger.match(index, 1, 100, 10)?.sha256)
        assertNull("edited in place must look new", ledger.match(index, 1, 120, 11))
        assertNull("unknown id", ledger.match(index, 2, 100, 10))
    }

    @Test
    fun `an edited photo keeps both versions and matches the current one`() {
        ledger.upsert(item("old", mediaId = 1, size = 100, modified = 10))
        ledger.upsert(item("new", mediaId = 1, size = 130, modified = 20))
        val index = ledger.byMediaId()
        assertEquals("new", ledger.match(index, 1, 130, 20)?.sha256)
        assertEquals("old", ledger.match(index, 1, 100, 10)?.sha256)
    }

    @Test
    fun `the same content in two gallery rows is known under both`() {
        ledger.upsert(item("aaa", mediaId = 1))
        ledger.adopt(ledger.findByHash("aaa")!!, mediaId = 99, name = "copy.jpg", dateModified = 42)
        val index = ledger.byMediaId()
        assertEquals("aaa", ledger.match(index, 1, 100, 10)?.sha256)
        assertEquals("aaa", ledger.match(index, 99, 100, 42)?.sha256)
        assertEquals(2, ledger.inState(State.UPLOADED).size)
        assertEquals("one remote file", 1, ledger.inState(State.UPLOADED).map { it.remoteUri }.toSet().size)
    }

    @Test
    fun `forgetting a state makes those photos pending again and leaves the rest`() {
        ledger.upsert(item("ok", mediaId = 1))
        ledger.upsert(item("bad", mediaId = 2, state = State.REJECTED))
        ledger.upsert(item("gone", mediaId = 3, state = State.MISSING))
        assertEquals(1, ledger.forget(State.REJECTED))
        assertEquals(1, ledger.forget(State.MISSING))
        val index = ledger.byMediaId()
        assertEquals(State.UPLOADED, ledger.match(index, 1, 100, 10)?.state)
        assertNull(ledger.match(index, 2, 100, 10))
        assertNull(ledger.match(index, 3, 100, 10))
    }

    @Test
    fun `setState records the verification time and error`() {
        ledger.upsert(item("aaa", mediaId = 1))
        ledger.setState("aaa", State.MISSING, error = "Not on the server any more")
        val row = ledger.findByHash("aaa")!!
        assertEquals(State.MISSING, row.state)
        assertEquals("Not on the server any more", row.error)
        ledger.setState("aaa", State.UPLOADED, verifiedAt = 1234)
        assertEquals(1234L, ledger.findByHash("aaa")!!.verifiedAt)
        assertNull(ledger.findByHash("aaa")!!.error)
        assertTrue(ledger.inState(State.UPLOADED).single().sha256 == "aaa")
    }
}
