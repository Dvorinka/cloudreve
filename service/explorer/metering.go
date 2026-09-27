package explorer

import (
	"context"
	"errors"
	"net/http"

	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/gin-gonic/gin"
)

// meterChunkBytes is the arrears granularity: the pool is debited each time
// this many bytes have actually been written, bounding both DB chatter and
// the maximum over-serve when the pool runs dry mid-stream.
const meterChunkBytes = 4 << 20

// meterFirstChunkBytes caps the unbilled head: the first debit happens once
// this many bytes have been written, so an already-nearly-empty pool can
// leak at most this much before the stream aborts.
const meterFirstChunkBytes = 64 << 10

// errTrafficExhausted aborts a metered stream when the owner's pool cannot
// cover bytes already written. Once headers are committed the only signal
// left is a truncated response body.
var errTrafficExhausted = errors.New("traffic allowance exhausted")

// meteringWriter debits the owner's traffic pool for bytes actually
// transferred. Charging happens in arrears per chunk: a Write first
// delivers the bytes, then bills them; when the pool is exhausted the next
// charge fails and the stream aborts, capping unbilled delivery at one
// chunk. Aborted and ranged responses therefore bill only what was sent.
type meteringWriter struct {
	gin.ResponseWriter
	uc      inventory.UserClient
	ownerID int
	stream  bool // true bills stream_traffic, false bills dl_traffic
	ctx     context.Context
	pending int64
	charged bool
	dead    bool
}

func newMeteringWriter(ctx context.Context, w gin.ResponseWriter, uc inventory.UserClient, ownerID int, stream bool) *meteringWriter {
	return &meteringWriter{ResponseWriter: w, uc: uc, ownerID: ownerID, stream: stream, ctx: ctx}
}

func (w *meteringWriter) Write(p []byte) (int, error) {
	if w.dead {
		return 0, errTrafficExhausted
	}
	n, err := w.ResponseWriter.Write(p)
	w.pending += int64(n)
	limit := int64(meterChunkBytes)
	if !w.charged {
		limit = meterFirstChunkBytes
	}
	if w.pending >= limit {
		if ferr := w.charge(); ferr != nil {
			if errors.Is(ferr, errTrafficExhausted) {
				w.dead = true
			}
			return n, ferr
		}
	}
	return n, err
}

// charge bills the accumulated bytes to the owner's pool. A hard error
// keeps pending so the next chunk retries; exhaustion kills the stream.
func (w *meteringWriter) charge() error {
	if w.pending == 0 {
		return nil
	}
	var (
		ok  bool
		err error
	)
	if w.stream {
		ok, err = w.uc.ConsumeStreamTraffic(w.ctx, w.ownerID, w.pending)
	} else {
		ok, err = w.uc.ConsumeDirectTraffic(w.ctx, w.ownerID, w.pending)
	}
	if err != nil {
		return err
	}
	if !ok {
		return errTrafficExhausted
	}
	w.pending = 0
	w.charged = true
	return nil
}

// Finish debits the trailing remainder once the handler returns.
func (w *meteringWriter) Finish() {
	if w.dead {
		return
	}
	_ = w.charge()
}

// Unwrap exposes the inner writer to http.ResponseController.
func (w *meteringWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
