package mcp

// File and share views returned to agents. Times are RFC3339 UTC strings so
// the generated tool schema stays a plain string.

type fileInfo struct {
	URI       string `json:"uri" jsonschema:"cloudreve URI of the file or folder."`
	Name      string `json:"name" jsonschema:"Display name."`
	Type      string `json:"type" jsonschema:"file or folder."`
	Size      int64  `json:"size" jsonschema:"Size in bytes. Folders report 0."`
	UpdatedAt string `json:"updated_at" jsonschema:"Last update time in RFC3339."`
	CreatedAt string `json:"created_at" jsonschema:"Creation time in RFC3339."`
}

type pageInfo struct {
	Page          int    `json:"page" jsonschema:"Zero-based page index."`
	PageSize      int    `json:"page_size" jsonschema:"Page size that was applied."`
	Total         int    `json:"total,omitempty" jsonschema:"Total items when the listing is offset-paginated."`
	NextPageToken string `json:"next_page_token,omitempty" jsonschema:"Pass this back as page_token to read the next page. Empty when this is the last page."`
}

type listInput struct {
	URI            string `json:"uri,omitempty" jsonschema:"Directory to list. A cloudreve URI such as cloudreve://my or cloudreve://my/Documents, or a plain path under My Files. Defaults to cloudreve://my. Use cloudreve://trash for the trash bin."`
	Page           int    `json:"page,omitempty" jsonschema:"Zero-based page index."`
	PageSize       int    `json:"page_size,omitempty" jsonschema:"Page size from 1 to 200. Defaults to 50."`
	PageToken      string `json:"page_token,omitempty" jsonschema:"Cursor returned by the previous page."`
	OrderBy        string `json:"order_by,omitempty" jsonschema:"Sort field: name, size, created_at, or updated_at."`
	OrderDirection string `json:"order_direction,omitempty" jsonschema:"asc or desc."`
}

type listOutput struct {
	Parent     *fileInfo  `json:"parent,omitempty" jsonschema:"The directory that was listed."`
	Files      []fileInfo `json:"files" jsonschema:"Children of the directory."`
	Pagination pageInfo   `json:"pagination"`
}

type searchInput struct {
	Query     string `json:"query" jsonschema:"File or folder name to search for. Matching is case-insensitive."`
	URI       string `json:"uri,omitempty" jsonschema:"Directory to search under. Defaults to cloudreve://my."`
	Type      string `json:"type,omitempty" jsonschema:"file, folder, or any. Defaults to any."`
	PageSize  int    `json:"page_size,omitempty" jsonschema:"Page size from 1 to 200. Defaults to 50."`
	PageToken string `json:"page_token,omitempty" jsonschema:"Cursor returned by the previous page."`
}

type fullTextInput struct {
	Query  string `json:"query" jsonschema:"Words to find inside file contents."`
	Offset int    `json:"offset,omitempty" jsonschema:"Number of hits to skip. Defaults to 0."`
}

type fullTextHit struct {
	File    fileInfo `json:"file"`
	Excerpt string   `json:"excerpt" jsonschema:"Short snippet around the match."`
}

type fullTextOutput struct {
	Hits  []fullTextHit `json:"hits"`
	Total int64         `json:"total" jsonschema:"Total matching documents."`
}

type pathInput struct {
	URI string `json:"uri" jsonschema:"cloudreve URI or a plain path under My Files."`
}

type writeInput struct {
	URI     string `json:"uri" jsonschema:"Destination URI, including the file name. Parent folders must already exist."`
	Content string `json:"content" jsonschema:"UTF-8 text to write. Overwrites an existing file. Maximum 1 MiB."`
}

type textOutput struct {
	File    fileInfo `json:"file"`
	Content string   `json:"content"`
}

type renameInput struct {
	URI     string `json:"uri" jsonschema:"File or folder to rename."`
	NewName string `json:"new_name" jsonschema:"New name, without a path."`
}

type transferInput struct {
	URIs        []string `json:"uris" jsonschema:"Files or folders to move or copy."`
	Destination string   `json:"destination" jsonschema:"Destination directory URI."`
}

type deleteInput struct {
	URIs      []string `json:"uris" jsonschema:"Files or folders to delete."`
	Permanent bool     `json:"permanent,omitempty" jsonschema:"When true, skip the trash and delete permanently."`
}

type restoreInput struct {
	URIs []string `json:"uris" jsonschema:"Trash URIs to restore, usually cloudreve://trash/... values from list_files."`
}

type userInfo struct {
	ID       string `json:"id" jsonschema:"Hashed user id."`
	Email    string `json:"email"`
	Nickname string `json:"nickname"`
	Group    string `json:"group" jsonschema:"Effective group name."`
	Admin    bool   `json:"admin"`
}

type quotaInfo struct {
	Used      int64 `json:"used" jsonschema:"Bytes used."`
	Total     int64 `json:"total" jsonschema:"Bytes allowed. 0 when unlimited."`
	Unlimited bool  `json:"unlimited"`
}

type downloadInfo struct {
	URL       string `json:"url" jsonschema:"Temporary URL the agent can GET to read the file bytes."`
	ExpiresAt string `json:"expires_at,omitempty" jsonschema:"RFC3339 expiry of the URL, when the storage policy sets one."`
}

type shareInput struct {
	URIs           []string `json:"uris" jsonschema:"One or more files or folders to share."`
	Private        bool     `json:"private,omitempty" jsonschema:"Require a password. A password is generated when password is empty."`
	Password       string   `json:"password,omitempty" jsonschema:"Visitor password. Implies private."`
	ExpireSeconds  int      `json:"expire_seconds,omitempty" jsonschema:"Lifetime in seconds. 0 means the share does not expire."`
	Downloads      int      `json:"downloads,omitempty" jsonschema:"Maximum downloads. 0 means unlimited."`
	PreviewOnly    bool     `json:"preview_only,omitempty" jsonschema:"Allow preview and refuse download."`
	Note           string   `json:"note,omitempty" jsonschema:"Owner note shown on My Shares. Maximum 255 characters."`
	ListedPublicly bool     `json:"listed_publicly,omitempty" jsonschema:"Include the share in the public share directory. Not allowed together with a password."`
}

type shareInfo struct {
	ID        string `json:"id" jsonschema:"Share id to pass to delete_shares."`
	URL       string `json:"url" jsonschema:"Public share URL."`
	Name      string `json:"name,omitempty" jsonschema:"Name of the shared file."`
	Password  string `json:"password,omitempty" jsonschema:"Visitor password, when the share is private."`
	ExpiresAt string `json:"expires_at,omitempty"`
	Private   bool   `json:"private"`
}

type shareList struct {
	Shares     []shareInfo `json:"shares"`
	Pagination pageInfo    `json:"pagination"`
}

type idsInput struct {
	IDs []string `json:"ids" jsonschema:"Share ids returned by list_shares or create_share."`
}

type ack struct {
	OK bool `json:"ok"`
}
