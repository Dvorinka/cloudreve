package org.cloudreve.android.data

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import org.cloudreve.android.api.ApiClient
import org.cloudreve.android.api.CreateFileRequest
import org.cloudreve.android.api.CreateUploadSessionRequest
import org.cloudreve.android.api.DeleteFileRequest
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.api.FileUrlRequest
import org.cloudreve.android.api.ListFileResponse
import org.cloudreve.android.api.MoveFileRequest
import org.cloudreve.android.api.RenameFileRequest
import org.cloudreve.android.api.RestoreFileRequest
import org.cloudreve.android.api.ShareCreateRequest
import org.cloudreve.android.api.UploadSessionResponse
import org.cloudreve.android.util.CrUri
import kotlinx.coroutines.ensureActive
import retrofit2.Response
import java.io.File

class ApiException(val code: Int, message: String) : Exception(message) {
    companion object {
        /** Server envelope code for "login required" (session expired or revoked). */
        const val CODE_LOGIN_REQUIRED = 401
        /** A file or folder with that name is already there (pkg/serializer/error.go). */
        const val CODE_OBJECT_EXISTS = 40004
        /** No file or folder at that URI (CodeParentNotExist, "Path not exist"). */
        const val CODE_PATH_NOT_EXIST = 40016
    }

    /** Server trouble or an expired session, as opposed to a verdict on one request. */
    val isTransient: Boolean get() = code in 500..599 || code == 429 || code == CODE_LOGIN_REQUIRED
}

private const val CODE_OBJECT_EXISTS = ApiException.CODE_OBJECT_EXISTS

class FileRepository(private val api: ApiClient) {

    private fun <T> Response<org.cloudreve.android.api.ApiResponse<T>>.unwrap(): T {
        if (!isSuccessful) throw ApiException(code(), "HTTP ${code()}")
        val body = body() ?: throw ApiException(-1, "Empty response")
        if (body.code != 0 || body.data == null) {
            throw ApiException(body.code, body.msg.ifEmpty { "API error ${body.code}" })
        }
        return body.data
    }

    private fun <T> Response<org.cloudreve.android.api.ApiResponse<T>>.unwrapEmpty() {
        if (!isSuccessful) throw ApiException(code(), "HTTP ${code()}")
        val body = body() ?: throw ApiException(-1, "Empty response")
        if (body.code != 0) {
            throw ApiException(body.code, body.msg.ifEmpty { "API error ${body.code}" })
        }
    }

    suspend fun list(
        uri: String,
        pageToken: String? = null,
        orderBy: String? = null,
        orderDirection: String? = null,
        pageSize: Int = 50,
    ): ListFileResponse =
        api.service().listFiles(
            uri = uri,
            pageSize = pageSize,
            nextPageToken = pageToken,
            orderBy = orderBy,
            orderDirection = orderDirection,
        ).unwrap()

    suspend fun downloadUrl(uri: String): String = signedUrl(uri, download = true)

    /** Signed URL served inline (no attachment disposition), for streaming previews. */
    suspend fun contentUrl(uri: String): String = signedUrl(uri, download = false)

    private suspend fun signedUrl(uri: String, download: Boolean): String {
        val url = api.service().fileUrls(FileUrlRequest(listOf(uri), download = download))
            .unwrap().urls.firstOrNull()?.url
            ?: throw ApiException(-1, "No URL returned for $uri")
        return reachableUrl(url)
    }

    /**
     * The server builds signed URLs from its `siteURL` setting. A siteURL of
     * `localhost` (the out-of-box default) is unreachable from any remote
     * client, so loopback URLs get their scheme+host rewritten to the address
     * the user actually connected to. Any other host is trusted — it may be a
     * CDN or a LAN-only name the client can legitimately reach.
     */
    private suspend fun reachableUrl(url: String): String {
        val parsed = runCatching { java.net.URI(url) }.getOrNull() ?: return url
        val loopback = parsed.host == null ||
            parsed.host.equals("localhost", true) ||
            parsed.host.startsWith("127.") ||
            parsed.host == "::1" || parsed.host == "0.0.0.0"
        if (!loopback) return url
        val base = runCatching { java.net.URI(api.serverBase()) }.getOrNull() ?: return url
        return java.net.URI(
            base.scheme, parsed.userInfo, base.host, base.port,
            parsed.path, parsed.query, parsed.fragment,
        ).toString()
    }

    suspend fun download(url: String) = api.service().download(url)

    /**
     * Streams [url] into [dest] through a `.part` sibling, reporting
     * (bytes, total) as it goes; total is -1 when the server sends no length.
     * Cooperative with coroutine cancellation between buffers.
     */
    suspend fun downloadToFile(url: String, dest: File, onProgress: (Long, Long) -> Unit = { _, _ -> }) {
        val resp = api.service().download(url)
        if (!resp.isSuccessful) throw ApiException(resp.code(), "Download failed: HTTP ${resp.code()}")
        val body = resp.body() ?: throw ApiException(-1, "Empty download")
        val total = body.contentLength()
        dest.parentFile?.mkdirs()
        val part = File(dest.path + ".part")
        try {
            body.byteStream().use { input ->
                java.io.FileOutputStream(part).use { out ->
                    val buffer = ByteArray(256 * 1024)
                    var copied = 0L
                    while (true) {
                        kotlinx.coroutines.currentCoroutineContext().ensureActive()
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                        copied += n
                        onProgress(copied, total)
                    }
                }
            }
            if (!part.renameTo(dest)) throw ApiException(-1, "Could not save ${dest.name}")
        } finally {
            part.delete()
        }
    }

    /** Resolves a thumbnail URL for the file, or null when none exists. */
    suspend fun thumbUrl(uri: String): String? =
        runCatching { api.service().thumb(uri).unwrap().url }.getOrNull()

    /**
     * Creates a share link. [expireSeconds] 0 = never; [password] empty = public.
     * Mirrors the web app's link format: the password rides along as a path
     * segment so the recipient does not have to type it.
     */
    suspend fun createShare(uri: String, password: String = "", expireSeconds: Int = 0, downloads: Int = 0): String {
        val link = api.service().createShare(
            ShareCreateRequest(uri = uri, password = password, expire = expireSeconds, downloads = downloads, isPrivate = password.isNotEmpty())
        ).unwrap()
        // PUT /share answers with the complete URL (`…/s/<id>[/<password>]`); older
        // builds of this client assumed a bare id and produced a doubled URL.
        if (link.startsWith("http")) return link
        val base = api.serverBase().trimEnd('/')
        return if (password.isEmpty()) "$base/s/$link" else "$base/s/$link/$password"
    }

    suspend fun mkdir(uri: String) {
        api.service().createFile(CreateFileRequest(uri = uri, type = "folder")).unwrapEmpty()
    }

    suspend fun rename(uri: String, newName: String) {
        api.service().renameFile(RenameFileRequest(uri = uri, newName = newName)).unwrapEmpty()
    }

    /** Moves (or copies) [uris] into the folder [dst]. */
    suspend fun move(uris: List<String>, dst: String, copy: Boolean) {
        api.service().moveFiles(MoveFileRequest(uris = uris, dst = dst, copy = copy)).unwrapEmpty()
    }

    /** Subfolders of [uri] only, for the destination picker. */
    suspend fun listFolders(uri: String): List<FileObject> =
        list(uri, orderBy = "name", orderDirection = "asc").files.filter { it.isFolder }

    suspend fun delete(uris: List<String>, permanently: Boolean = false) {
        api.service().deleteFiles(DeleteFileRequest(uris = uris, skipSoftDelete = permanently)).unwrapEmpty()
    }

    /** Puts trashed items (cloudreve://trash/… URIs) back where they came from. */
    suspend fun restore(uris: List<String>) {
        api.service().restoreFiles(RestoreFileRequest(uris)).unwrapEmpty()
    }

    suspend fun createUploadSession(
        uri: String,
        size: Long,
        lastModified: Long,
        mimeType: String,
        overwrite: Boolean = false,
        hash: String = "",
    ): UploadSessionResponse =
        api.service().createUploadSession(
            CreateUploadSessionRequest(
                uri = uri,
                size = size,
                lastModified = lastModified,
                mimeType = mimeType,
                // "version" tells the server to add a new version to the existing
                // file instead of failing with 40004; it is what the web uploader sends.
                entityType = if (overwrite) "version" else "",
                hash = hash,
            )
        ).unwrap()

    /** Creates [uri] and any missing ancestors; folders that already exist are fine. */
    suspend fun mkdirs(uri: String) {
        if (CrUri.isRoot(uri)) return
        mkdirs(CrUri.parent(uri))
        try {
            mkdir(uri)
        } catch (e: ApiException) {
            if (e.code != CODE_OBJECT_EXISTS) throw e
        }
    }

    /**
     * The file at exactly [uri], or null when there is none. One request to
     * `/file/info`; the listing API's `name` filter is a case-insensitive substring
     * match, so it is not a substitute for an exact lookup.
     */
    suspend fun stat(uri: String): FileObject? {
        val response = api.service().fileInfo(uri)
        if (response.isSuccessful) {
            val body = response.body()
            if (body != null && body.code == ApiException.CODE_PATH_NOT_EXIST) return null
        }
        return response.unwrap().takeUnless { it.isFolder }
    }

    /**
     * Every file under [rootUri], recursively, as `canonical uri -> size`. The `type=file`
     * search walks the whole subtree server-side, so this is one request per 500
     * files rather than one per folder.
     */
    suspend fun indexFiles(rootUri: String): Map<String, Long> {
        val out = HashMap<String, Long>()
        var token: String? = null
        do {
            val page = list("$rootUri?type=file", pageToken = token, pageSize = 500)
            for (f in page.files) if (!f.isFolder && f.path.isNotEmpty()) out[CrUri.canonical(f.path)] = f.size
            token = page.pagination.nextToken
        } while (!token.isNullOrEmpty())
        return out
    }

    /**
     * Streams a local file through the upload-session flow: create session,
     * PUT/POST each chunk to its resolved URL, then call completeURL when the
     * policy requires an explicit finalize step (e.g. S3 multipart).
     */
    suspend fun uploadFile(
        localFile: File,
        remoteParentUri: String,
        remoteName: String = localFile.name,
        overwrite: Boolean = false,
        hash: String = "",
        lastModified: Long = localFile.lastModified(),
        onProgress: (sent: Long, total: Long) -> Unit = { _, _ -> },
    ): UploadSessionResponse {
        val targetUri = CrUri.join(remoteParentUri, remoteName)
        val mime = java.net.URLConnection.guessContentTypeFromName(remoteName)
            ?: "application/octet-stream"
        val session = createUploadSession(
            uri = targetUri,
            size = localFile.length(),
            lastModified = lastModified,
            mimeType = mime,
            overwrite = overwrite,
            hash = hash,
        )

        if (session.rapidUploaded) return session

        val urls = session.uploadUrls
        // Local/slave policies return no presigned URLs: chunks go to the
        // conventional POST /api/v4/file/upload/{session}/{index} endpoint and
        // the server completes the session once every chunk has landed.
        val conventional = urls.isNullOrEmpty()
        val chunkSize = if (session.chunkSize > 0) session.chunkSize else localFile.length().coerceAtLeast(1)
        val totalChunks = ((localFile.length() + chunkSize - 1) / chunkSize).toInt().coerceAtLeast(1)
        val svc = api.service()
        var sent = 0L
        localFile.inputStream().buffered().use { input ->
            val buffer = ByteArray(chunkSize.coerceAtMost(64L * 1024 * 1024).toInt())
            for (index in 0 until totalChunks) {
                val read = input.readFully(buffer)
                if (index == 0 && read == 0 && localFile.length() > 0) break
                val target = if (conventional) {
                    session_serverBase() + "/api/v4/file/upload/${session.sessionId}/$index"
                } else {
                    if (index >= urls!!.size) break
                    resolveUrl(urls[index])
                }
                val chunkStart = sent
                val body = ProgressRequestBody(buffer, read, mime.toMediaTypeOrNull()) { written ->
                    onProgress(chunkStart + written, localFile.length())
                }
                val resp = if (target.contains("/file/upload/")) {
                    svc.uploadChunk(target, body)
                } else {
                    // Presigned third-party URLs are conventionally PUT.
                    svc.uploadChunkPut(target, body)
                }
                if (!resp.isSuccessful) {
                    throw ApiException(resp.code(), "Chunk $index upload failed: HTTP ${resp.code()}")
                }
                resp.body()?.close()
                sent += read
                onProgress(sent, localFile.length())
                if (read <= 0) break
            }
        }

        if (session.completeUrl.isNotEmpty()) {
            val resp = svc.completeUpload(resolveUrl(session.completeUrl))
            if (!resp.isSuccessful) {
                throw ApiException(resp.code(), "Upload completion failed: HTTP ${resp.code()}")
            }
            resp.body()?.close()
        }
        return session
    }

    /** Fills [buffer] as far as the stream allows; `InputStream.readNBytes` needs API 33. */
    private fun java.io.InputStream.readFully(buffer: ByteArray): Int {
        var filled = 0
        while (filled < buffer.size) {
            val n = read(buffer, filled, buffer.size - filled)
            if (n < 0) break
            filled += n
        }
        return filled
    }

    /**
     * Request body over a byte range that reports bytes written as OkHttp
     * drains it, so a single large chunk still yields smooth progress.
     * Reports on every [STEP] bytes to keep callbacks cheap.
     */
    private class ProgressRequestBody(
        private val bytes: ByteArray,
        private val length: Int,
        private val mediaType: okhttp3.MediaType?,
        private val onWritten: (Long) -> Unit,
    ) : okhttp3.RequestBody() {
        override fun contentType() = mediaType
        override fun contentLength(): Long = length.toLong()
        override fun writeTo(sink: okio.BufferedSink) {
            var offset = 0
            while (offset < length) {
                val n = minOf(STEP, length - offset)
                sink.write(bytes, offset, n)
                offset += n
                onWritten(offset.toLong())
            }
        }

        private companion object {
            const val STEP = 256 * 1024
        }
    }

    private suspend fun resolveUrl(url: String): String {
        if (url.startsWith("http")) return url
        return session_serverBase() + url
    }

    private suspend fun session_serverBase(): String {
        val base = api.serverBase()
        return if (base.endsWith('/')) base.dropLast(1) else base
    }
}
