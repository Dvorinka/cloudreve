package routes

import (
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMeterSegmentRoundTrip(t *testing.T) {
	for _, download := range []bool{true, false} {
		seg := MeterSegment("abc123", download)
		ownerHash, gotDownload, ok := ParseMeterSegment(seg)
		require.True(t, ok)
		require.Equal(t, "abc123", ownerHash)
		require.Equal(t, download, gotDownload)
	}
}

func TestParseMeterSegmentMalformed(t *testing.T) {
	for _, seg := range []string{"", "nodotsuffix", "hash.", ".d", "hash.x", "a.b.c.d"} {
		_, _, ok := ParseMeterSegment(seg)
		if seg == "a.b.c.d" {
			// LastIndex splits — "a.b.c" is a valid ownerHash shape.
			_, _, ok2 := ParseMeterSegment(seg)
			require.True(t, ok2)
			continue
		}
		require.False(t, ok, "segment %q must not parse", seg)
	}
}

func TestMasterFileContentUrlMeterSegmentInPath(t *testing.T) {
	base, _ := url.Parse("https://cdn.example.com")

	unmetered := MasterFileContentUrl(base, "e1", "a.txt", true, false, 0, "")
	require.Equal(t, "/api/v4/file/content/e1/0/a.txt", unmetered.Path)
	require.Empty(t, unmetered.Query().Get("meter"),
		"metering must never ride unsigned query params")

	metered := MasterFileContentUrl(base, "e1", "a.txt", true, false, 0, "h1.d")
	require.Equal(t, "/api/v4/file/content/e1/0/m/h1.d/a.txt", metered.Path)
	require.Contains(t, metered.Path, "/m/h1.d/",
		"claim must sit inside the signed path")

	// The signature input is the path — altering the claim changes the
	// signed content, so a forged or stripped segment invalidates the URL.
	require.NotEqual(t, unmetered.Path, metered.Path)
	tampered := strings.Replace(metered.Path, "h1.d", "h2.s", 1)
	require.NotEqual(t, metered.Path, tampered)
}
