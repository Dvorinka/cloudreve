package entitysource

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProbePresignedHeadTranslatesRangeAndRejectsForbidden(t *testing.T) {
	var gotMethod, gotRange string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotRange = r.Header.Get("Range")
		switch r.URL.Path {
		case "/partial":
			w.Header().Set("Content-Range", "bytes 0-0/4096")
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("x"))
		case "/full":
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Length", "80")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("full-body-that-must-not-be-required"))
		case "/empty":
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		default:
			w.WriteHeader(http.StatusForbidden)
		}
	}))
	t.Cleanup(srv.Close)

	status, length, ctype, err := probePresignedHead(context.Background(), srv.Client(), srv.URL+"/partial")
	require.NoError(t, err)
	require.Equal(t, http.MethodGet, gotMethod)
	require.Equal(t, "bytes=0-0", gotRange)
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, int64(4096), length)
	require.Equal(t, "text/plain", ctype)

	status, length, _, err = probePresignedHead(context.Background(), srv.Client(), srv.URL+"/full")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, int64(80), length)

	status, length, _, err = probePresignedHead(context.Background(), srv.Client(), srv.URL+"/missing")
	require.NoError(t, err)
	require.Equal(t, http.StatusForbidden, status)
	require.Equal(t, int64(-1), length)

	status, length, _, err = probePresignedHead(context.Background(), srv.Client(), srv.URL+"/empty")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, int64(0), length)
}
