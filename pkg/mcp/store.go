package mcp

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudreve/Cloudreve/v4/application/dependency"
	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/cloudreve/Cloudreve/v4/pkg/cluster/routes"
	"github.com/cloudreve/Cloudreve/v4/pkg/filemanager/fs"
	"github.com/cloudreve/Cloudreve/v4/pkg/filemanager/manager"
	"github.com/cloudreve/Cloudreve/v4/pkg/hashid"
)

const (
	maxReadBytes  = 256 * 1024
	maxWriteBytes = 1 << 20
	maxExcerpt    = 500
	maxNote       = 255
)

// Store is the Cloudreve surface an MCP tool is allowed to touch. Every
// method runs as principal and inherits that user's group permissions.
type Store interface {
	WhoAmI(ctx context.Context, p Principal) (userInfo, error)
	Quota(ctx context.Context, p Principal) (quotaInfo, error)
	List(ctx context.Context, p Principal, in listInput) (listOutput, error)
	Get(ctx context.Context, p Principal, uri string) (fileInfo, error)
	Search(ctx context.Context, p Principal, in searchInput) (listOutput, error)
	SearchFullText(ctx context.Context, p Principal, in fullTextInput) (fullTextOutput, error)
	Create(ctx context.Context, p Principal, uri string, folder bool) (fileInfo, error)
	WriteText(ctx context.Context, p Principal, uri, content string) (fileInfo, error)
	ReadText(ctx context.Context, p Principal, uri string) (textOutput, error)
	Rename(ctx context.Context, p Principal, uri, name string) (fileInfo, error)
	Transfer(ctx context.Context, p Principal, uris []string, dst string, copy bool) error
	Delete(ctx context.Context, p Principal, uris []string, permanent bool) error
	Restore(ctx context.Context, p Principal, uris []string) error
	EmptyTrash(ctx context.Context, p Principal) error
	DownloadURL(ctx context.Context, p Principal, uri string) (downloadInfo, error)
	CreateShare(ctx context.Context, p Principal, in shareInput) (shareInfo, error)
	ListShares(ctx context.Context, p Principal, in pageInput) (shareList, error)
	DeleteShares(ctx context.Context, p Principal, ids []string) error
}

// pageInput is declared next to the share list tool. It lives here so the
// store signature can name it.
type pageInput struct {
	Page     int `json:"page,omitempty" jsonschema:"Zero-based page index."`
	PageSize int `json:"page_size,omitempty" jsonschema:"Page size from 1 to 200. Defaults to 50."`
}

type liveStore struct {
	dep dependency.Dep
}

func (s liveStore) open(p Principal) (manager.FileManager, error) {
	if p.User == nil || inventory.IsAnonymousUser(p.User) {
		return nil, fmt.Errorf("login required")
	}
	return manager.NewFileManager(s.dep, p.User), nil
}

func (s liveStore) WhoAmI(_ context.Context, p Principal) (userInfo, error) {
	if p.User == nil {
		return userInfo{}, fmt.Errorf("login required")
	}
	info := userInfo{
		ID:       hashid.EncodeUserID(s.dep.HashIDEncoder(), p.User.ID),
		Email:    p.User.Email,
		Nickname: p.User.Nick,
		Admin:    permissionEnabled(p, types.GroupPermissionIsAdmin),
	}
	if g := inventory.EffectiveGroup(p.User); g != nil {
		info.Group = g.Name
	}
	return info, nil
}

func (s liveStore) Quota(ctx context.Context, p Principal) (quotaInfo, error) {
	m, err := s.open(p)
	if err != nil {
		return quotaInfo{}, err
	}
	defer m.Recycle()

	cap, err := m.Capacity(ctx)
	if err != nil {
		return quotaInfo{}, err
	}
	return quotaInfo{Used: cap.Used, Total: cap.Total, Unlimited: cap.Total == 0}, nil
}

func (s liveStore) List(ctx context.Context, p Principal, in listInput) (listOutput, error) {
	uri, err := parseURI(in.URI)
	if err != nil {
		return listOutput{}, err
	}
	return s.listAt(ctx, p, uri, in)
}

func (s liveStore) Get(ctx context.Context, p Principal, raw string) (fileInfo, error) {
	uri, err := parseURI(raw)
	if err != nil {
		return fileInfo{}, err
	}
	m, err := s.open(p)
	if err != nil {
		return fileInfo{}, err
	}
	defer m.Recycle()

	file, err := m.Get(ctx, uri)
	if err != nil {
		return fileInfo{}, err
	}
	return fileInfoFrom(file), nil
}

func (s liveStore) Search(ctx context.Context, p Principal, in searchInput) (listOutput, error) {
	uri, err := searchURI(in.URI, in.Query, in.Type)
	if err != nil {
		return listOutput{}, err
	}
	return s.listAt(ctx, p, uri, listInput{PageSize: in.PageSize, PageToken: in.PageToken})
}

func (s liveStore) SearchFullText(ctx context.Context, p Principal, in fullTextInput) (fullTextOutput, error) {
	query := strings.TrimSpace(in.Query)
	if query == "" {
		return fullTextOutput{}, fmt.Errorf("query is required")
	}
	if in.Offset < 0 {
		return fullTextOutput{}, fmt.Errorf("offset must be >= 0")
	}
	m, err := s.open(p)
	if err != nil {
		return fullTextOutput{}, err
	}
	defer m.Recycle()

	res, err := m.SearchFullText(ctx, query, in.Offset)
	if err != nil {
		return fullTextOutput{}, err
	}
	out := fullTextOutput{Hits: []fullTextHit{}, Total: res.Total}
	for _, hit := range res.Hits {
		excerpt := hit.Content
		if len(excerpt) > maxExcerpt {
			excerpt = excerpt[:maxExcerpt]
		}
		out.Hits = append(out.Hits, fullTextHit{File: fileInfoFrom(hit.File), Excerpt: excerpt})
	}
	return out, nil
}

func (s liveStore) Create(ctx context.Context, p Principal, raw string, folder bool) (fileInfo, error) {
	uri, err := parseURI(raw)
	if err != nil {
		return fileInfo{}, err
	}
	kind := types.FileTypeFile
	if folder {
		kind = types.FileTypeFolder
	}
	m, err := s.open(p)
	if err != nil {
		return fileInfo{}, err
	}
	defer m.Recycle()

	file, err := m.Create(ctx, uri, kind)
	if err != nil {
		return fileInfo{}, err
	}
	return fileInfoFrom(file), nil
}

func (s liveStore) WriteText(ctx context.Context, p Principal, raw, content string) (fileInfo, error) {
	if len(content) > maxWriteBytes {
		return fileInfo{}, fmt.Errorf("content exceeds %d bytes", maxWriteBytes)
	}
	if !utf8.ValidString(content) {
		return fileInfo{}, fmt.Errorf("content must be UTF-8 text")
	}
	uri, err := parseURI(raw)
	if err != nil {
		return fileInfo{}, err
	}
	m, err := s.open(p)
	if err != nil {
		return fileInfo{}, err
	}
	defer m.Recycle()

	reader := bytes.NewReader([]byte(content))
	file, err := m.Update(ctx, &fs.UploadRequest{
		Props: &fs.UploadProps{
			Uri:      uri,
			Size:     int64(len(content)),
			MimeType: "text/plain; charset=utf-8",
		},
		Mode:   fs.ModeOverwrite,
		File:   io.NopCloser(reader),
		Seeker: reader,
	})
	if err != nil {
		return fileInfo{}, err
	}
	return fileInfoFrom(file), nil
}

func (s liveStore) ReadText(ctx context.Context, p Principal, raw string) (textOutput, error) {
	uri, err := parseURI(raw)
	if err != nil {
		return textOutput{}, err
	}
	m, err := s.open(p)
	if err != nil {
		return textOutput{}, err
	}
	defer m.Recycle()

	file, err := m.Get(ctx, uri)
	if err != nil {
		return textOutput{}, err
	}
	if file.Type() != types.FileTypeFile {
		return textOutput{}, fmt.Errorf("uri is not a file")
	}
	if file.Size() > maxReadBytes {
		return textOutput{}, fmt.Errorf("file is %d bytes; read_text allows %d. use download_url", file.Size(), maxReadBytes)
	}
	if file.PrimaryEntityID() == 0 {
		return textOutput{File: fileInfoFrom(file), Content: ""}, nil
	}

	src, err := m.GetEntitySource(ctx, file.PrimaryEntityID())
	if err != nil {
		return textOutput{}, err
	}
	defer src.Close()

	buf, err := io.ReadAll(io.LimitReader(src, maxReadBytes+1))
	if err != nil {
		return textOutput{}, err
	}
	if len(buf) > maxReadBytes {
		return textOutput{}, fmt.Errorf("file exceeds %d bytes; use download_url", maxReadBytes)
	}
	if !utf8.Valid(buf) || bytes.IndexByte(buf, 0) >= 0 {
		return textOutput{}, fmt.Errorf("file is not UTF-8 text; use download_url")
	}
	return textOutput{File: fileInfoFrom(file), Content: string(buf)}, nil
}

func (s liveStore) Rename(ctx context.Context, p Principal, raw, name string) (fileInfo, error) {
	if err := validName(name); err != nil {
		return fileInfo{}, err
	}
	uri, err := parseURI(raw)
	if err != nil {
		return fileInfo{}, err
	}
	m, err := s.open(p)
	if err != nil {
		return fileInfo{}, err
	}
	defer m.Recycle()

	file, err := m.Rename(ctx, uri, strings.TrimSpace(name))
	if err != nil {
		return fileInfo{}, err
	}
	return fileInfoFrom(file), nil
}

func (s liveStore) Transfer(ctx context.Context, p Principal, raw []string, dstRaw string, copy bool) error {
	srcs, err := parseURIs(raw)
	if err != nil {
		return err
	}
	dst, err := parseURI(dstRaw)
	if err != nil {
		return err
	}
	m, err := s.open(p)
	if err != nil {
		return err
	}
	defer m.Recycle()
	return m.MoveOrCopy(ctx, srcs, dst, copy)
}

func (s liveStore) Delete(ctx context.Context, p Principal, raw []string, permanent bool) error {
	uris, err := parseURIs(raw)
	if err != nil {
		return err
	}
	m, err := s.open(p)
	if err != nil {
		return err
	}
	defer m.Recycle()
	if permanent {
		return m.Delete(ctx, uris, fs.WithSysSkipSoftDelete(true))
	}
	return m.Delete(ctx, uris)
}

func (s liveStore) Restore(ctx context.Context, p Principal, raw []string) error {
	uris, err := parseURIs(raw)
	if err != nil {
		return err
	}
	m, err := s.open(p)
	if err != nil {
		return err
	}
	defer m.Recycle()
	return m.Restore(ctx, uris...)
}

func (s liveStore) EmptyTrash(ctx context.Context, p Principal) error {
	m, err := s.open(p)
	if err != nil {
		return err
	}
	defer m.Recycle()
	return m.EmptyTrash(ctx)
}

func (s liveStore) DownloadURL(ctx context.Context, p Principal, raw string) (downloadInfo, error) {
	uri, err := parseURI(raw)
	if err != nil {
		return downloadInfo{}, err
	}
	m, err := s.open(p)
	if err != nil {
		return downloadInfo{}, err
	}
	defer m.Recycle()

	urls, expire, err := m.GetEntityUrls(ctx, []manager.GetEntityUrlArgs{{URI: uri}})
	if err != nil {
		return downloadInfo{}, err
	}
	if len(urls) == 0 || urls[0].Url == "" {
		return downloadInfo{}, fmt.Errorf("no download url for %s", uri.String())
	}
	info := downloadInfo{URL: urls[0].Url}
	if expire != nil {
		info.ExpiresAt = expire.UTC().Format(time.RFC3339)
	}
	return info, nil
}

func (s liveStore) CreateShare(ctx context.Context, p Principal, in shareInput) (shareInfo, error) {
	if !permissionEnabled(p, types.GroupPermissionShare) {
		return shareInfo{}, fmt.Errorf("group permission denied")
	}
	if in.ListedPublicly {
		if !permissionEnabled(p, types.GroupPermissionSharePublicList) {
			return shareInfo{}, fmt.Errorf("group permission denied for public share listing")
		}
		if in.Private || strings.TrimSpace(in.Password) != "" {
			return shareInfo{}, fmt.Errorf("password-protected shares cannot be publicly listed")
		}
	}
	if in.ExpireSeconds < 0 || in.Downloads < 0 {
		return shareInfo{}, fmt.Errorf("expire_seconds and downloads must be >= 0")
	}
	if len(in.Note) > maxNote {
		return shareInfo{}, fmt.Errorf("note exceeds %d characters", maxNote)
	}
	uris, err := parseURIs(in.URIs)
	if err != nil {
		return shareInfo{}, err
	}

	var expire *time.Time
	if in.ExpireSeconds > 0 {
		t := time.Now().Add(time.Duration(in.ExpireSeconds) * time.Second)
		expire = &t
	}

	m, err := s.open(p)
	if err != nil {
		return shareInfo{}, err
	}
	defer m.Recycle()

	share, err := m.CreateOrUpdateShare(ctx, uris, &manager.CreateShareArgs{
		IsPrivate:       in.Private || strings.TrimSpace(in.Password) != "",
		Password:        in.Password,
		RemainDownloads: in.Downloads,
		Expire:          expire,
		ShareView:       true,
		PreviewOnly:     in.PreviewOnly,
		Note:            in.Note,
		ListedPublicly:  in.ListedPublicly,
	})
	if err != nil {
		return shareInfo{}, err
	}
	return shareInfoFrom(ctx, s.dep, share, true), nil
}

func (s liveStore) ListShares(ctx context.Context, p Principal, in pageInput) (shareList, error) {
	if p.User == nil {
		return shareList{}, fmt.Errorf("login required")
	}
	ctx = context.WithValue(ctx, inventory.LoadShareFile{}, true)
	res, err := s.dep.ShareClient().List(ctx, &inventory.ListShareArgs{
		PaginationArgs: &inventory.PaginationArgs{
			Page:     in.Page,
			PageSize: clampPage(in.PageSize),
		},
		UserID: p.User.ID,
	})
	if err != nil {
		return shareList{}, err
	}
	out := shareList{Shares: []shareInfo{}, Pagination: pageFrom(res.PaginationResults)}
	for _, share := range res.Shares {
		out.Shares = append(out.Shares, shareInfoFrom(ctx, s.dep, share, true))
	}
	return out, nil
}

func (s liveStore) DeleteShares(ctx context.Context, p Principal, ids []string) error {
	if p.User == nil {
		return fmt.Errorf("login required")
	}
	if len(ids) == 0 {
		return fmt.Errorf("at least one share id is required")
	}
	hasher := s.dep.HashIDEncoder()
	decoded := make([]int, 0, len(ids))
	for _, raw := range ids {
		id, err := hasher.Decode(strings.TrimSpace(raw), hashid.ShareID)
		if err != nil {
			return fmt.Errorf("unknown share id %q", raw)
		}
		decoded = append(decoded, id)
	}
	return s.dep.ShareClient().DeleteBatchByUserID(ctx, p.User.ID, decoded)
}

func (s liveStore) listAt(ctx context.Context, p Principal, uri *fs.URI, in listInput) (listOutput, error) {
	m, err := s.open(p)
	if err != nil {
		return listOutput{}, err
	}
	defer m.Recycle()

	parent, res, err := m.List(ctx, uri, &manager.ListArgs{
		Page:           in.Page,
		PageSize:       clampPage(in.PageSize),
		PageToken:      in.PageToken,
		Order:          in.OrderBy,
		OrderDirection: in.OrderDirection,
	})
	if err != nil {
		return listOutput{}, err
	}
	out := listOutput{Files: []fileInfo{}}
	if parent != nil && !parent.IsNil() {
		info := fileInfoFrom(parent)
		out.Parent = &info
	}
	if res != nil {
		for _, file := range res.Files {
			out.Files = append(out.Files, fileInfoFrom(file))
		}
		out.Pagination = pageFrom(res.Pagination)
	}
	return out, nil
}

func permissionEnabled(p Principal, flag types.GroupPermission) bool {
	g := inventory.EffectiveGroup(p.User)
	if g == nil || g.Permissions == nil {
		return false
	}
	return g.Permissions.Enabled(int(flag))
}

func fileInfoFrom(file fs.File) fileInfo {
	if file == nil || file.IsNil() {
		return fileInfo{}
	}
	kind := "file"
	if file.Type() == types.FileTypeFolder {
		kind = "folder"
	}
	info := fileInfo{
		Name:      file.Name(),
		Type:      kind,
		Size:      file.Size(),
		UpdatedAt: file.UpdatedAt().UTC().Format(time.RFC3339),
		CreatedAt: file.CreatedAt().UTC().Format(time.RFC3339),
	}
	if uri := file.Uri(false); uri != nil {
		info.URI = uri.String()
	}
	return info
}

func pageFrom(p *inventory.PaginationResults) pageInfo {
	if p == nil {
		return pageInfo{}
	}
	return pageInfo{
		Page:          p.Page,
		PageSize:      p.PageSize,
		Total:         p.TotalItems,
		NextPageToken: p.NextPageToken,
	}
}

func shareInfoFrom(ctx context.Context, dep dependency.Dep, share *ent.Share, includePassword bool) shareInfo {
	info := shareInfo{
		ID:      hashid.EncodeShareID(dep.HashIDEncoder(), share.ID),
		Private: share.Password != "",
	}
	if includePassword {
		info.Password = share.Password
	}
	if share.Expires != nil {
		info.ExpiresAt = share.Expires.UTC().Format(time.RFC3339)
	}
	if share.Edges.File != nil {
		info.Name = share.Edges.File.Name
	}
	if base := dep.SettingProvider().SiteURL(ctx); base != nil {
		id := share.Slug
		if id == "" {
			id = info.ID
		}
		info.URL = routes.MasterShareUrl(base, id, "").String()
	}
	return info
}
