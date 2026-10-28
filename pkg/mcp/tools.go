package mcp

import (
	"context"

	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const instructions = `Cloudreve file platform for the authenticated user.
Paths are cloudreve URIs: cloudreve://my, cloudreve://my/Documents, cloudreve://trash, cloudreve://shared_with_me.
A path without a scheme is treated as a path under cloudreve://my.
Call whoami first. delete_files moves items to the trash unless permanent is true.
read_text and write_text only handle small UTF-8 files; use download_url for anything else.
Share ids from create_share and list_shares are the values delete_shares accepts.
People create and revoke the bearer token under Settings → Agents or Connect → MCP.`

func registerTools(server *mcp.Server, store Store, principal Principal) {
	add(server, "whoami", "Return the authenticated user.", true, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, userInfo, error) {
			info, err := store.WhoAmI(ctx, principal)
			return nil, info, err
		})

	add(server, "storage_quota", "Return used and total storage for the authenticated user.", true, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, quotaInfo, error) {
			if err := principal.allow(types.ScopeFilesRead); err != nil {
				return nil, quotaInfo{}, err
			}
			info, err := store.Quota(ctx, principal)
			return nil, info, err
		})

	add(server, "list_files", "List a directory the user can see.", true, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in listInput) (*mcp.CallToolResult, listOutput, error) {
			if err := principal.allow(types.ScopeFilesRead); err != nil {
				return nil, listOutput{}, err
			}
			out, err := store.List(ctx, principal, in)
			return nil, out, err
		})

	add(server, "get_file", "Return metadata for one file or folder.", true, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in pathInput) (*mcp.CallToolResult, fileInfo, error) {
			if err := principal.allow(types.ScopeFilesRead); err != nil {
				return nil, fileInfo{}, err
			}
			info, err := store.Get(ctx, principal, in.URI)
			return nil, info, err
		})

	add(server, "search_files", "Search file and folder names under a directory.", true, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in searchInput) (*mcp.CallToolResult, listOutput, error) {
			if err := principal.allow(types.ScopeFilesRead); err != nil {
				return nil, listOutput{}, err
			}
			out, err := store.Search(ctx, principal, in)
			return nil, out, err
		})

	add(server, "search_full_text", "Search inside file contents. Requires the site's full-text index.", true, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in fullTextInput) (*mcp.CallToolResult, fullTextOutput, error) {
			if err := principal.allow(types.ScopeFilesRead); err != nil {
				return nil, fullTextOutput{}, err
			}
			out, err := store.SearchFullText(ctx, principal, in)
			return nil, out, err
		})

	add(server, "read_text", "Read a small UTF-8 file. Files over 256 KiB or binary files must use download_url.", true, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in pathInput) (*mcp.CallToolResult, textOutput, error) {
			if err := principal.allow(types.ScopeFilesRead); err != nil {
				return nil, textOutput{}, err
			}
			out, err := store.ReadText(ctx, principal, in.URI)
			return nil, out, err
		})

	add(server, "download_url", "Create a temporary download URL for a file.", true, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in pathInput) (*mcp.CallToolResult, downloadInfo, error) {
			if err := principal.allow(types.ScopeFilesRead); err != nil {
				return nil, downloadInfo{}, err
			}
			info, err := store.DownloadURL(ctx, principal, in.URI)
			return nil, info, err
		})

	add(server, "create_folder", "Create a folder at the given URI. The URI includes the new folder name.", false, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in pathInput) (*mcp.CallToolResult, fileInfo, error) {
			if err := principal.allow(types.ScopeFilesWrite); err != nil {
				return nil, fileInfo{}, err
			}
			info, err := store.Create(ctx, principal, in.URI, true)
			return nil, info, err
		})

	add(server, "create_file", "Create an empty file at the given URI. The URI includes the new file name.", false, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in pathInput) (*mcp.CallToolResult, fileInfo, error) {
			if err := principal.allow(types.ScopeFilesWrite); err != nil {
				return nil, fileInfo{}, err
			}
			info, err := store.Create(ctx, principal, in.URI, false)
			return nil, info, err
		})

	add(server, "write_text", "Write UTF-8 text to a file, creating it or overwriting its contents. Maximum 1 MiB.", false, true,
		func(ctx context.Context, _ *mcp.CallToolRequest, in writeInput) (*mcp.CallToolResult, fileInfo, error) {
			if err := principal.allow(types.ScopeFilesWrite); err != nil {
				return nil, fileInfo{}, err
			}
			info, err := store.WriteText(ctx, principal, in.URI, in.Content)
			return nil, info, err
		})

	add(server, "rename_file", "Rename one file or folder.", false, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in renameInput) (*mcp.CallToolResult, fileInfo, error) {
			if err := principal.allow(types.ScopeFilesWrite); err != nil {
				return nil, fileInfo{}, err
			}
			info, err := store.Rename(ctx, principal, in.URI, in.NewName)
			return nil, info, err
		})

	add(server, "move_files", "Move files or folders into a destination directory.", false, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in transferInput) (*mcp.CallToolResult, ack, error) {
			if err := principal.allow(types.ScopeFilesWrite); err != nil {
				return nil, ack{}, err
			}
			err := store.Transfer(ctx, principal, in.URIs, in.Destination, false)
			return nil, ack{OK: err == nil}, err
		})

	add(server, "copy_files", "Copy files or folders into a destination directory.", false, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in transferInput) (*mcp.CallToolResult, ack, error) {
			if err := principal.allow(types.ScopeFilesWrite); err != nil {
				return nil, ack{}, err
			}
			err := store.Transfer(ctx, principal, in.URIs, in.Destination, true)
			return nil, ack{OK: err == nil}, err
		})

	add(server, "delete_files", "Delete files or folders. Defaults to the trash. permanent=true skips the trash.", false, true,
		func(ctx context.Context, _ *mcp.CallToolRequest, in deleteInput) (*mcp.CallToolResult, ack, error) {
			if err := principal.allow(types.ScopeFilesWrite); err != nil {
				return nil, ack{}, err
			}
			err := store.Delete(ctx, principal, in.URIs, in.Permanent)
			return nil, ack{OK: err == nil}, err
		})

	add(server, "restore_files", "Restore files from the trash.", false, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in restoreInput) (*mcp.CallToolResult, ack, error) {
			if err := principal.allow(types.ScopeFilesWrite); err != nil {
				return nil, ack{}, err
			}
			err := store.Restore(ctx, principal, in.URIs)
			return nil, ack{OK: err == nil}, err
		})

	add(server, "empty_trash", "Permanently delete everything in the trash.", false, true,
		func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, ack, error) {
			if err := principal.allow(types.ScopeFilesWrite); err != nil {
				return nil, ack{}, err
			}
			err := store.EmptyTrash(ctx, principal)
			return nil, ack{OK: err == nil}, err
		})

	add(server, "list_shares", "List share links created by the authenticated user.", true, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in pageInput) (*mcp.CallToolResult, shareList, error) {
			if err := principal.allow(types.ScopeSharesRead); err != nil {
				return nil, shareList{}, err
			}
			out, err := store.ListShares(ctx, principal, in)
			return nil, out, err
		})

	add(server, "create_share", "Create a share link for one or more files. Returns the public URL and, for a private share, the password.", false, false,
		func(ctx context.Context, _ *mcp.CallToolRequest, in shareInput) (*mcp.CallToolResult, shareInfo, error) {
			if err := principal.allow(types.ScopeSharesWrite); err != nil {
				return nil, shareInfo{}, err
			}
			info, err := store.CreateShare(ctx, principal, in)
			return nil, info, err
		})

	add(server, "delete_shares", "Delete share links owned by the authenticated user.", false, true,
		func(ctx context.Context, _ *mcp.CallToolRequest, in idsInput) (*mcp.CallToolResult, ack, error) {
			if err := principal.allow(types.ScopeSharesWrite); err != nil {
				return nil, ack{}, err
			}
			err := store.DeleteShares(ctx, principal, in.IDs)
			return nil, ack{OK: err == nil}, err
		})
}

func add[In, Out any](server *mcp.Server, name, description string, readOnly, destructive bool, handler mcp.ToolHandlerFor[In, Out]) {
	closed := false
	// Only empty_trash is safe to repeat: a second call finds an empty bin.
	idempotent := name == "empty_trash"
	mcp.AddTool(server, &mcp.Tool{
		Name:        name,
		Description: description,
		Annotations: &mcp.ToolAnnotations{
			ReadOnlyHint:    readOnly,
			DestructiveHint: &destructive,
			OpenWorldHint:   &closed,
			IdempotentHint:  idempotent,
		},
	}, handler)
}
