# Agents (MCP) {#agents-mcp}

Cloudreve speaks the Model Context Protocol so an agent such as Cursor can use the signed-in user's files. The endpoint is stateless streamable HTTP:

```
POST /api/v4/mcp
```

Send `Authorization: Bearer <token>` and an `Accept` header that includes both `application/json` and `text/event-stream`.

## Create a token {#create-a-token}

Open **Settings → Agents** or **Connect → MCP**, then choose **Create agent token**. Copy the secret when it appears. It is not shown again.

Each person can hold 10 tokens. A token lasts 30 days. Revoke it on the same page, or change the account password, and it stops working immediately. The page also copies a client config:

```json
{
  "mcpServers": {
    "cloudreve": {
      "type": "http",
      "url": "https://your-site.example/api/v4/mcp",
      "headers": { "Authorization": "Bearer TOKEN" }
    }
  }
}
```

Use the site origin you actually open in the browser. In local development that is the Vite origin (`http://localhost:5173`), which proxies `/api` to Cloudreve.

A token acts as that user: it can read, change, and share their files. Treat it like a password.

An ordinary login token from `POST /api/v4/session/token` also works, and it expires on the site's access-token lifetime (one hour by default). OAuth tokens must include `Files.Read` or `Files.Write` for file tools, and `Shares.Read` or `Shares.Write` for share tools. Write includes read. Creating an agent token from an OAuth client requires both write scopes.

## Paths {#paths}

Tools take Cloudreve URIs:

- `cloudreve://my` and `cloudreve://my/Documents` — My Files
- `cloudreve://trash` — trash
- `cloudreve://shared_with_me` — files shared with the user

A path with no scheme, such as `/Documents`, is read as a path under `cloudreve://my`.

## Tools {#tools}

| Tool | What it does |
| --- | --- |
| `whoami` | The authenticated user |
| `storage_quota` | Used and total storage |
| `list_files` | List a directory |
| `get_file` | Metadata for one file or folder |
| `search_files` | Search names under a directory |
| `search_full_text` | Search file contents when the site index is enabled |
| `read_text` | Read a UTF-8 file up to 256 KiB |
| `download_url` | A temporary download URL |
| `create_folder` | Create a folder; the URI includes the new name |
| `create_file` | Create an empty file; the URI includes the new name |
| `write_text` | Create or overwrite UTF-8 text, up to 1 MiB |
| `rename_file` | Rename one file or folder |
| `move_files` | Move into a directory |
| `copy_files` | Copy into a directory |
| `delete_files` | Move to the trash, or delete permanently when `permanent` is true |
| `restore_files` | Restore from the trash |
| `empty_trash` | Permanently delete the trash |
| `list_shares` | Share links created by the user |
| `create_share` | Create a share link; a private share also returns its password |
| `delete_shares` | Delete share links; ids come from `create_share` and `list_shares` |

Call `whoami` first. `read_text` and `write_text` only handle small UTF-8 files. Use `download_url` for anything larger or binary.
