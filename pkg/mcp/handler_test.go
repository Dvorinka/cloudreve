package mcp

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/stretchr/testify/require"
)

func TestParseURI(t *testing.T) {
	t.Parallel()

	uri, err := parseURI("")
	require.NoError(t, err)
	require.Equal(t, "cloudreve://my", uri.String())

	uri, err = parseURI("Documents/a.txt")
	require.NoError(t, err)
	require.Equal(t, "cloudreve://my/Documents/a.txt", uri.String())

	uri, err = parseURI("cloudreve://trash")
	require.NoError(t, err)
	require.Equal(t, "cloudreve://trash", uri.String())

	_, err = parseURI("https://example.com/a")
	require.Error(t, err)
}

func TestSearchURI(t *testing.T) {
	t.Parallel()

	uri, err := searchURI("cloudreve://my/Docs", "Report", "file")
	require.NoError(t, err)
	require.Equal(t, "cloudreve://my/Docs", uri.U.Scheme+"://"+uri.U.Host+uri.U.Path)
	require.Equal(t, "Report", uri.U.Query().Get("name"))
	require.Equal(t, "file", uri.U.Query().Get("type"))

	_, err = searchURI("", "", "")
	require.Error(t, err)
	_, err = searchURI("", "a", "symlink")
	require.Error(t, err)
}

func TestPrincipalAllow(t *testing.T) {
	t.Parallel()

	open := Principal{}
	require.NoError(t, open.allow(types.ScopeFilesWrite))

	reader := Principal{Scoped: true, Scopes: []string{types.ScopeFilesRead}}
	require.NoError(t, reader.allow(types.ScopeFilesRead))
	require.Error(t, reader.allow(types.ScopeFilesWrite))

	writer := Principal{Scoped: true, Scopes: []string{types.ScopeFilesWrite}}
	require.NoError(t, writer.allow(types.ScopeFilesRead))
	require.NoError(t, writer.allow(types.ScopeFilesWrite))
}

func TestHandlerRequiresBearerToken(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(NewHandler(staticAuth{}, listingStore{}))
	t.Cleanup(srv.Close)

	res, err := http.Post(srv.URL, "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}`))
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusUnauthorized, res.StatusCode)
	require.Contains(t, res.Header.Get("WWW-Authenticate"), "Bearer")
}

func TestHandlerListFiles(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(NewHandler(staticAuth{}, listingStore{}))
	t.Cleanup(srv.Close)

	body := `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_files","arguments":{"uri":"cloudreve://my"}}}`
	req, err := http.NewRequest(http.MethodPost, srv.URL, strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer test")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")

	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	payload, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, res.StatusCode, string(payload))
	require.Contains(t, string(payload), "notes.txt")
	require.Contains(t, string(payload), "cloudreve://my/notes.txt")
}

func TestHandlerRejectsMissingScope(t *testing.T) {
	t.Parallel()

	store := &recordingStore{}
	srv := httptest.NewServer(NewHandler(scopedAuth{}, store))
	t.Cleanup(srv.Close)

	body := `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"delete_files","arguments":{"uris":["cloudreve://my/notes.txt"]}}}`
	req, err := http.NewRequest(http.MethodPost, srv.URL, strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer test")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")

	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	payload, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, res.StatusCode, string(payload))
	require.Contains(t, string(payload), "insufficient scope")
	require.False(t, store.deleted)
}

type staticAuth struct{}

func (staticAuth) Authenticate(r *http.Request) (Principal, error) {
	if r.Header.Get("Authorization") != "Bearer test" {
		return Principal{}, errUnauthorized
	}
	return Principal{User: &ent.User{ID: 1, Email: "ada@example.com", Nick: "Ada"}}, nil
}

type scopedAuth struct{}

func (scopedAuth) Authenticate(r *http.Request) (Principal, error) {
	if r.Header.Get("Authorization") != "Bearer test" {
		return Principal{}, errUnauthorized
	}
	return Principal{
		User:   &ent.User{ID: 1, Email: "ada@example.com"},
		Scoped: true,
		Scopes: []string{types.ScopeFilesRead},
	}, nil
}

type stubStore struct{}

func (stubStore) WhoAmI(context.Context, Principal) (userInfo, error) {
	return userInfo{}, errUnauthorized
}
func (stubStore) Quota(context.Context, Principal) (quotaInfo, error) {
	return quotaInfo{}, errUnauthorized
}
func (stubStore) List(context.Context, Principal, listInput) (listOutput, error) {
	return listOutput{}, errUnauthorized
}
func (stubStore) Get(context.Context, Principal, string) (fileInfo, error) {
	return fileInfo{}, errUnauthorized
}
func (stubStore) Search(context.Context, Principal, searchInput) (listOutput, error) {
	return listOutput{}, errUnauthorized
}
func (stubStore) SearchFullText(context.Context, Principal, fullTextInput) (fullTextOutput, error) {
	return fullTextOutput{}, errUnauthorized
}
func (stubStore) Create(context.Context, Principal, string, bool) (fileInfo, error) {
	return fileInfo{}, errUnauthorized
}
func (stubStore) WriteText(context.Context, Principal, string, string) (fileInfo, error) {
	return fileInfo{}, errUnauthorized
}
func (stubStore) ReadText(context.Context, Principal, string) (textOutput, error) {
	return textOutput{}, errUnauthorized
}
func (stubStore) Rename(context.Context, Principal, string, string) (fileInfo, error) {
	return fileInfo{}, errUnauthorized
}
func (stubStore) Transfer(context.Context, Principal, []string, string, bool) error {
	return errUnauthorized
}
func (stubStore) Delete(context.Context, Principal, []string, bool) error {
	return errUnauthorized
}
func (stubStore) Restore(context.Context, Principal, []string) error { return errUnauthorized }
func (stubStore) EmptyTrash(context.Context, Principal) error        { return errUnauthorized }
func (stubStore) DownloadURL(context.Context, Principal, string) (downloadInfo, error) {
	return downloadInfo{}, errUnauthorized
}
func (stubStore) CreateShare(context.Context, Principal, shareInput) (shareInfo, error) {
	return shareInfo{}, errUnauthorized
}
func (stubStore) ListShares(context.Context, Principal, pageInput) (shareList, error) {
	return shareList{}, errUnauthorized
}
func (stubStore) DeleteShares(context.Context, Principal, []string) error {
	return errUnauthorized
}

type listingStore struct{ stubStore }

func (listingStore) List(context.Context, Principal, listInput) (listOutput, error) {
	return listOutput{
		Files: []fileInfo{{
			URI:  "cloudreve://my/notes.txt",
			Name: "notes.txt",
			Type: "file",
			Size: 12,
		}},
		Pagination: pageInfo{PageSize: 50},
	}, nil
}

type recordingStore struct {
	stubStore
	deleted bool
}

func (s *recordingStore) Delete(context.Context, Principal, []string, bool) error {
	s.deleted = true
	return nil
}
