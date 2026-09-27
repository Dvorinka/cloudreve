package explorer

import (
	"context"
	"net/http/httptest"
	"testing"

	"fmt"

	"github.com/cloudreve/Cloudreve/v4/ent/enttest"
	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/pkg/boolset"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

var meteringSeq int

func meteringFixture(t *testing.T, dlTraffic, streamTraffic int64) (inventory.UserClient, int) {
	t.Helper()
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })

	meteringSeq++
	group := client.Group.Create().SetName("g").SetPermissions(&boolset.BooleanSet{}).SaveX(context.Background())
	owner := client.User.Create().
		SetEmail(fmt.Sprintf("owner%d@test", meteringSeq)).
		SetNick("owner").
		SetGroup(group).
		SetDlTraffic(dlTraffic).
		SetStreamTraffic(streamTraffic).
		SaveX(context.Background())
	return inventory.NewUserClient(client), owner.ID
}

func meteringGinWriter() gin.ResponseWriter {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	return ctx.Writer
}

func TestMeteringWriterChargesTransferredBytes(t *testing.T) {
	uc, ownerID := meteringFixture(t, 10<<20, -1)
	w := newMeteringWriter(context.Background(), meteringGinWriter(), uc, ownerID, false)

	// Crossing the first-chunk threshold debits eagerly.
	_, err := w.Write(make([]byte, 2<<20))
	require.NoError(t, err)
	ucUser, _ := uc.GetByID(context.Background(), ownerID)
	require.EqualValues(t, 8<<20, ucUser.DlTraffic)

	// Finish is a no-op once pending is settled — exactly what was written.
	w.Finish()
	ucUser, _ = uc.GetByID(context.Background(), ownerID)
	require.EqualValues(t, 8<<20, ucUser.DlTraffic)
	require.EqualValues(t, -1, ucUser.StreamTraffic)
}

func TestMeteringWriterStreamPool(t *testing.T) {
	uc, ownerID := meteringFixture(t, -1, 6<<20)
	w := newMeteringWriter(context.Background(), meteringGinWriter(), uc, ownerID, true)

	_, err := w.Write(make([]byte, meterChunkBytes))
	require.NoError(t, err)
	w.Finish()

	u, _ := uc.GetByID(context.Background(), ownerID)
	require.EqualValues(t, 2<<20, u.StreamTraffic)
	require.EqualValues(t, -1, u.DlTraffic)
}

func TestMeteringWriterExhaustionAborts(t *testing.T) {
	uc, ownerID := meteringFixture(t, -1, 5<<20)
	w := newMeteringWriter(context.Background(), meteringGinWriter(), uc, ownerID, true)

	// First chunk: 4MiB billed, 1MiB remains.
	_, err := w.Write(make([]byte, meterChunkBytes))
	require.NoError(t, err)

	// Second chunk cannot be covered — stream aborts.
	_, err = w.Write(make([]byte, meterChunkBytes))
	require.ErrorIs(t, err, errTrafficExhausted)

	// Writer stays dead; no further bytes accepted or billed.
	_, err = w.Write([]byte{1})
	require.ErrorIs(t, err, errTrafficExhausted)
	w.Finish()

	u, _ := uc.GetByID(context.Background(), ownerID)
	require.EqualValues(t, 1<<20, u.StreamTraffic)
}

func TestMeteringWriterFirstChunkBound(t *testing.T) {
	// Pool smaller than the first arrears threshold: the stream must abort
	// after at most meterFirstChunkBytes of unbilled delivery, even when the
	// whole file fits inside one regular chunk.
	uc, ownerID := meteringFixture(t, -1, 32<<10)
	w := newMeteringWriter(context.Background(), meteringGinWriter(), uc, ownerID, true)

	_, err := w.Write(make([]byte, meterFirstChunkBytes))
	require.ErrorIs(t, err, errTrafficExhausted)

	u, _ := uc.GetByID(context.Background(), ownerID)
	require.EqualValues(t, 32<<10, u.StreamTraffic)

	// Partial pool survives the first threshold, then Finish bills the rest.
	uc, ownerID = meteringFixture(t, -1, 100<<10)
	w = newMeteringWriter(context.Background(), meteringGinWriter(), uc, ownerID, true)
	_, err = w.Write(make([]byte, meterFirstChunkBytes))
	require.NoError(t, err)
	_, err = w.Write(make([]byte, 10<<10))
	require.NoError(t, err)
	w.Finish()

	u, _ = uc.GetByID(context.Background(), ownerID)
	require.EqualValues(t, 100<<10-74<<10, u.StreamTraffic)
}

func TestMeteringWriterUnlimitedAndHead(t *testing.T) {
	uc, ownerID := meteringFixture(t, -1, -1)
	w := newMeteringWriter(context.Background(), meteringGinWriter(), uc, ownerID, false)

	_, err := w.Write(make([]byte, meterChunkBytes*2))
	require.NoError(t, err)
	w.Finish()

	u, _ := uc.GetByID(context.Background(), ownerID)
	require.EqualValues(t, -1, u.DlTraffic)

	// HEAD path: Serve skips the body, nothing is written, nothing billed.
	w2 := newMeteringWriter(context.Background(), meteringGinWriter(), uc, ownerID, false)
	w2.Finish()
	u, _ = uc.GetByID(context.Background(), ownerID)
	require.EqualValues(t, -1, u.DlTraffic)
}
