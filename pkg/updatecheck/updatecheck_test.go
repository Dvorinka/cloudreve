package updatecheck

import "testing"

func TestIsNewer(t *testing.T) {
	cases := []struct {
		current, latest string
		want            bool
	}{
		{"4.19.1", "4.19.2", true},
		{"v4.19.1", "v4.19.2", true},
		{"4.19.2", "4.19.2", false},
		{"4.19.2", "4.19.1", false},
		{"4.19.2", "4.20.0", true},
		{"4.19.9", "4.20.0", true},
		{"4.19.9", "5.0.0", true},
		{"4.19.2-rc1", "4.19.2", true},
		{"4.19.2", "4.19.2-rc1", false},
		{"5.0.0", "4.99.9", false},
		{"4.19", "4.19.1", true},
	}
	for _, c := range cases {
		if got := IsNewer(c.current, c.latest); got != c.want {
			t.Errorf("IsNewer(%q, %q) = %v, want %v", c.current, c.latest, got, c.want)
		}
	}
}

func TestParseAtomReleases(t *testing.T) {
	feed := `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <updated>2026-11-19T13:51:53Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/Dvorinka/cloudreve/releases/tag/desktop-v0.3.21"/>
    <title>Cloudreve desktop-v0.3.21</title>
    <content type="html">&lt;p&gt;desktop notes&lt;/p&gt;</content>
  </entry>
  <entry>
    <updated>2026-11-19T13:26:07Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/Dvorinka/cloudreve/releases/tag/v4.23.16"/>
    <title>Cloudreve v4.23.16</title>
    <content type="html">&lt;h2&gt;What&amp;#39;s Changed&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;fix things&lt;/li&gt;&lt;/ul&gt;</content>
  </entry>
  <entry>
    <updated>2026-11-18T18:46:57Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/Dvorinka/cloudreve/releases/tag/android-v1.3.2"/>
    <title>Cloudreve android-v1.3.2</title>
    <content type="html">&lt;p&gt;android notes&lt;/p&gt;</content>
  </entry>
</feed>`

	rel, err := parseAtomReleases([]byte(feed))
	if err != nil {
		t.Fatalf("parseAtomReleases: %v", err)
	}
	if rel.Version != "4.23.16" {
		t.Errorf("Version = %q, want 4.23.16", rel.Version)
	}
	if rel.URL != "https://github.com/Dvorinka/cloudreve/releases/tag/v4.23.16" {
		t.Errorf("URL = %q", rel.URL)
	}
	if rel.PublishedAt.IsZero() {
		t.Error("PublishedAt is zero")
	}
	if rel.Notes != "What's Changed fix things" {
		t.Errorf("Notes = %q", rel.Notes)
	}
}

func TestParseAtomReleasesNone(t *testing.T) {
	feed := `<feed xmlns="http://www.w3.org/2005/Atom"><entry><link rel="alternate" href="https://github.com/Dvorinka/cloudreve/releases/tag/desktop-v1"/></entry></feed>`
	if _, err := parseAtomReleases([]byte(feed)); err == nil {
		t.Error("expected error when no server tag present")
	}
}
