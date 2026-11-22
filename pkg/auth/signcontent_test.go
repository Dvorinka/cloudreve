package auth

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// getSignContent must bound the buffered body: an oversized request is
// signed over the truncated prefix, so verification fails closed instead
// of allocating the whole body.
func TestGetSignContentBodyCap(t *testing.T) {
	big := bytes.Repeat([]byte("a"), maxSignContentBodySize+1024)
	r := httptest.NewRequest(http.MethodPost, "/api/v4/file", bytes.NewReader(big))

	before := time.Now()
	_ = getSignContent(r.Context(), r)
	if time.Since(before) > 10*time.Second {
		t.Fatal("getSignContent took too long on oversized body")
	}

	// The reconstructed body is capped, not the original stream.
	restored, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored) != maxSignContentBodySize+1 {
		t.Fatalf("restored body len = %d, want %d", len(restored), maxSignContentBodySize+1)
	}
}

func TestGetSignContentSmallBodyUnchanged(t *testing.T) {
	payload := `{"name":"x"}`
	r := httptest.NewRequest(http.MethodPost, "/api/v4/file", strings.NewReader(payload))
	_ = getSignContent(r.Context(), r)
	restored, _ := io.ReadAll(r.Body)
	if string(restored) != payload {
		t.Fatalf("restored body = %q", restored)
	}
}
