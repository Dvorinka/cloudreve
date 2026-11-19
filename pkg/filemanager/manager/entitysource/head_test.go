package entitysource

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

func TestWriteRemoteHeadFollowsRequestCancel(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(func() {
		close(release)
		srv.Close()
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodHead, "http://cloudreve.local/f", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	src := &entitySource{o: &EntitySourceOptions{Ctx: context.Background()}}

	done := make(chan struct{})
	go func() {
		src.writeRemoteHead(rec, req, srv.URL)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("HEAD probe ignored a cancelled request context")
	}
	require.Equal(t, http.StatusBadGateway, rec.Code)
}
