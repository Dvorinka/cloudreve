# 智能体 (MCP) {#agents-mcp}

Cloudreve 支持 Model Context Protocol，Cursor 等智能体可以操作用户自己的文件。端点是无状态的 Streamable HTTP：

```
POST /api/v4/mcp
```

请求需要 `Authorization: Bearer <令牌>`，并且 `Accept` 同时包含 `application/json` 和 `text/event-stream`。

## 创建令牌 {#create-a-token}

打开 **设置 → 智能体** 或 **连接 → MCP**，点击 **创建智能体令牌**。密钥只在创建时显示一次。

每人最多 10 个令牌。创建时可选有效期（最长为永久）、访问级别（读取文件、读写文件，或文件和分享），也可以限定到某个目录。令牌仅可用于 MCP 端点。编辑令牌可修改有效期和权限；在同一页面撤销，或修改账号密码后，令牌会立刻失效。页面也可以复制客户端配置：

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

`url` 使用浏览器里打开的站点地址。本地开发时用 Vite 的地址（`http://localhost:5173`），它会把 `/api` 转发到 Cloudreve。

令牌以该用户身份工作，可以读取、修改并分享其文件。请像密码一样保管。

`POST /api/v4/session/token` 签发的普通登录令牌也可以使用，过期时间跟随站点的访问令牌寿命（默认 1 小时）。OAuth 令牌调用文件工具需要 `Files.Read` 或 `Files.Write`，调用分享工具需要 `Shares.Read` 或 `Shares.Write`。Write 包含 Read。OAuth 客户端创建智能体令牌时需要同时具备这两个 Write 范围。

## 路径 {#paths}

工具使用 Cloudreve URI：

- `cloudreve://my` 与 `cloudreve://my/Documents` — 我的文件
- `cloudreve://trash` — 回收站
- `cloudreve://shared_with_me` — 分享给我的文件

没有协议的路径（例如 `/Documents`）会当作 `cloudreve://my` 下的路径。

## 工具 {#tools}

| 工具 | 作用 |
| --- | --- |
| `whoami` | 当前用户 |
| `storage_quota` | 已用与总容量 |
| `list_files` | 列出目录 |
| `get_file` | 文件或文件夹的元数据 |
| `search_files` | 在目录下按名称搜索 |
| `search_full_text` | 站点开启全文索引后搜索文件内容 |
| `read_text` | 读取不超过 256 KiB 的 UTF-8 文件 |
| `download_url` | 临时下载地址 |
| `create_folder` | 创建文件夹，URI 包含新名称 |
| `create_file` | 创建空文件，URI 包含新名称 |
| `write_text` | 写入或覆盖 UTF-8 文本，最大 1 MiB |
| `rename_file` | 重命名一个文件或文件夹 |
| `move_files` | 移动到目录 |
| `copy_files` | 复制到目录 |
| `delete_files` | 移入回收站；`permanent` 为 true 时永久删除 |
| `restore_files` | 从回收站恢复 |
| `empty_trash` | 清空回收站 |
| `list_shares` | 当前用户创建的分享 |
| `create_share` | 创建分享；私密分享同时返回密码 |
| `delete_shares` | 删除分享，id 来自 `create_share` 和 `list_shares` |

先调用 `whoami`。`read_text` 和 `write_text` 只处理较小的 UTF-8 文件，更大或二进制文件请使用 `download_url`。
