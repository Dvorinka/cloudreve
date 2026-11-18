import { CancelToken } from "axios";
import {
  sendCreateUploadSession,
  sendDeleteUploadSession,
  sendObsCompleteUpload,
  sendOneDriveCompleteUpload,
  sendS3LikeCompleteUpload,
  sendUploadChunk,
} from "../../../../api/api.ts";
import { UploadCredential, UploadSessionRequest } from "../../../../api/explorer.ts";
import { AppError, Response } from "../../../../api/request.ts";
import {
  CreateUploadSessionError,
  DeleteUploadSessionError,
  HTTPError,
  LocalChunkUploadError,
  ObsFinishUploadError,
  ObsJsonError,
  OneDriveChunkError,
  OneDriveFinishUploadError,
  QiniuChunkError,
  QiniuFinishUploadError,
  S3LikeChunkError,
  S3LikeFinishUploadError,
  S3LikeUploadCallbackError,
  SlaveChunkUploadError,
  UpyunUploadError,
} from "../errors";
import { OneDriveChunkResponse, OneDriveError, QiniuChunkResponse, QiniuError, QiniuFinishUploadRequest, QiniuPartsInfo, S3Part, UpyunError } from "../types";
import { Progress } from "../uploader/base";
import { ChunkInfo, ChunkProgress } from "../uploader/chunk";
import { EncryptedBlob } from "../uploader/encrypt/blob.ts";
import { OBJtoXML, request } from "../utils";

// Resolved lazily: a static edge to the redux store creates an
// initialization cycle (store -> slices -> uploader core -> store).
let storePromise: Promise<typeof import("../../../../redux/store.ts").store> | undefined;
const getStore = () => (storePromise ??= import("../../../../redux/store.ts").then((m) => m.store));

export async function createUploadSession(req: UploadSessionRequest, _cancel: CancelToken): Promise<UploadCredential> {
  try {
    return await (await getStore()).dispatch(sendCreateUploadSession(req));
  } catch (e) {
    if (e instanceof AppError) {
      throw new CreateUploadSessionError(e.response);
    }

    throw e;
  }
}

export async function deleteUploadSession(id: string, uri: string): Promise<unknown> {
  try {
    return await (await getStore()).dispatch(sendDeleteUploadSession({ id, uri }));
  } catch (e) {
    if (e instanceof AppError) {
      throw new DeleteUploadSessionError(e.response);
    }

    throw e;
  }
}

export async function localUploadChunk(
  sessionID: string,
  chunk: ChunkInfo,
  onProgress: (p: Progress) => void,
  cancel: CancelToken,
): Promise<unknown> {
  try {
    return await (await getStore()).dispatch(
      sendUploadChunk(sessionID, chunk.chunk, chunk.index, cancel, (progressEvent) => {
        onProgress({
          loaded: progressEvent.loaded,
          total: progressEvent.total,
        });
      }),
    );
  } catch (e) {
    if (e instanceof AppError) {
      throw new LocalChunkUploadError(e.response, chunk.index);
    }

    throw e;
  }
}

export async function slaveUploadChunk(
  url: string,
  credential: string,
  chunk: ChunkInfo,
  onProgress: (p: Progress) => void,
  cancel: CancelToken,
): Promise<unknown> {
  const streaming = chunk.chunk instanceof EncryptedBlob;
  const res = await request<Response<unknown>>(`${url}?chunk=${chunk.index}`, {
    method: "post",
    adapter: streaming ? "fetch" : "xhr",
    headers: {
      "content-type": "application/octet-stream",
      Authorization: credential,
      ...(streaming && { "X-Expected-Entity-Length": chunk.chunk.size?.toString() ?? "0" }),
    },
    data: streaming ? chunk.chunk.stream() : chunk.chunk,
    onUploadProgress: (progressEvent) => {
      onProgress({
        loaded: progressEvent.loaded,
        total: progressEvent.total,
      });
    },
    cancelToken: cancel,
  });

  if (res.data.code != 0) {
    throw new SlaveChunkUploadError(res.data, chunk.index);
  }

  return res.data.data;
}

export async function oneDriveUploadChunk(
  url: string,
  range: string, // if range is empty, this will be an request to query the session status
  chunk: ChunkInfo,
  onProgress: (p: Progress) => void,
  cancel: CancelToken,
): Promise<OneDriveChunkResponse> {
  const streaming = chunk.chunk instanceof EncryptedBlob;
  const res = await request<OneDriveChunkResponse>(url, {
    method: range === "" ? "get" : "put",
    adapter: streaming ? "fetch" : "xhr",
    headers: {
      "content-type": "application/octet-stream",
      ...(streaming && { "Content-Length": chunk.chunk.size?.toString() ?? "0" }),
      ...(range !== "" && { "content-range": range }),
    },
    data: streaming ? chunk.chunk.stream() : chunk.chunk,
    onUploadProgress: (progressEvent) => {
      onProgress({
        loaded: progressEvent.loaded,
        total: progressEvent.total,
      });
    },
    cancelToken: cancel,
  }).catch((e) => {
    if (e instanceof HTTPError && e.response) {
      throw new OneDriveChunkError(e.response.data as OneDriveError);
    }

    throw e;
  });

  return res.data;
}

export async function finishOneDriveUpload(sessionID: string, sessionKey: string): Promise<unknown> {
  try {
    return await (await getStore()).dispatch(sendOneDriveCompleteUpload(sessionID, sessionKey));
  } catch (e) {
    if (e instanceof AppError) {
      throw new OneDriveFinishUploadError(e.response);
    }

    throw e;
  }
}

export async function s3LikeUploadChunk(
  url: string,
  chunk: ChunkInfo,
  onProgress: (p: Progress) => void,
  cancel: CancelToken,
): Promise<string> {
  const streaming = chunk.chunk instanceof EncryptedBlob;
  const res = await request<string>(url, {
    method: "put",
    adapter: streaming ? "fetch" : "xhr",
    headers: {
      "content-type": "application/octet-stream",
    },
    data: streaming ? chunk.chunk.stream() : chunk.chunk,
    onUploadProgress: (progressEvent) => {
      onProgress({
        loaded: progressEvent.loaded,
        total: progressEvent.total,
      });
    },
    cancelToken: cancel,
    responseType: "document",
    transformResponse: undefined,
  }).catch((e) => {
    if (e instanceof HTTPError && e.response) {
      throw new S3LikeChunkError(e.response.data as Document);
    }

    throw e;
  });

  return res.headers["etag"];
}

export async function obsFinishUpload(url: string, chunks: ChunkProgress[], cancel: CancelToken): Promise<unknown> {
  const body = encodePartsXML(chunks);
  const res = await request<unknown>(url, {
    method: "post",
    cancelToken: cancel,
    transformResponse: undefined,
    data: body,
    headers: {
      "content-type": "application/octet-stream",
    },
    validateStatus: function (status) {
      return status == 200;
    },
  }).catch((e) => {
    if (e instanceof HTTPError && (e.response?.data as { message?: string })?.message) {
      throw new ObsFinishUploadError(e.response?.data as ObsJsonError);
    }

    if (e instanceof HTTPError && e.response?.data) {
      // Decode xml
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(e.response.data as string, "text/xml");
      throw new S3LikeFinishUploadError(xmlDoc);
    }

    throw e;
  });

  return res.data;
}

export async function s3LikeFinishUpload(
  url: string,
  isOss: boolean,
  chunks: ChunkProgress[],
  cancel: CancelToken,
  headers?: { [key: string]: string },
): Promise<unknown> {
  let body = "";
  if (!isOss) {
    body += encodePartsXML(chunks);
  }

  const res = await request<unknown>(url, {
    method: "post",
    cancelToken: cancel,
    responseType: "document",
    transformResponse: undefined,
    data: body,
    headers: {
      "content-type": "application/octet-stream",
      ...headers,
    },
    validateStatus: function (status) {
      return status == 200;
    },
  }).catch((e) => {
    if (e instanceof HTTPError && e.response) {
      throw new S3LikeFinishUploadError(e.response.data as Document);
    }

    throw e;
  });

  return res.data;
}

export async function qiniuDriveUploadChunk(
  url: string,
  upToken: string,
  chunk: ChunkInfo,
  onProgress: (p: Progress) => void,
  cancel: CancelToken,
): Promise<QiniuChunkResponse> {
  const streaming = chunk.chunk instanceof EncryptedBlob;
  const res = await request<QiniuChunkResponse>(`${url}/${chunk.index + 1}`, {
    method: "put",
    adapter: streaming ? "fetch" : "xhr",
    headers: {
      "content-type": "application/octet-stream",
      authorization: "UpToken " + upToken,
    },
    data: streaming ? chunk.chunk.stream() : chunk.chunk,
    onUploadProgress: (progressEvent) => {
      onProgress({
        loaded: progressEvent.loaded,
        total: progressEvent.total,
      });
    },
    cancelToken: cancel,
  }).catch((e) => {
    if (e instanceof HTTPError && e.response) {
      throw new QiniuChunkError(e.response.data as QiniuError);
    }

    throw e;
  });

  return res.data;
}

export async function qiniuFinishUpload(
  url: string,
  upToken: string,
  chunks: ChunkProgress[],
  cancel: CancelToken,
  mimeType?: string,
): Promise<unknown> {
  const content: QiniuFinishUploadRequest = {
    mimeType,
    parts: chunks.map((chunk): QiniuPartsInfo => {
      return {
        etag: chunk.etag!,
        partNumber: chunk.index + 1,
      };
    }),
  };

  const res = await request<unknown>(`${url}`, {
    method: "post",
    headers: {
      "content-type": "application/json",
      authorization: "UpToken " + upToken,
    },
    data: content,
    cancelToken: cancel,
  }).catch((e) => {
    if (e instanceof HTTPError && e.response) {
      throw new QiniuFinishUploadError(e.response.data as QiniuError);
    }

    throw e;
  });

  return res.data;
}

export async function upyunFormUploadChunk(
  url: string,
  file: Blob,
  policy: string,
  credential: string,
  onProgress: (p: Progress) => void,
  cancel: CancelToken,
  mimeType?: string,
): Promise<unknown> {
  const bodyFormData = new FormData();
  bodyFormData.append("policy", policy);
  bodyFormData.append("authorization", credential);
  if (mimeType) {
    bodyFormData.append("content-type", mimeType);
  }
  // File must be the last element in the form
  bodyFormData.append("file", file);

  const res = await request<unknown>(`${url}`, {
    method: "post",
    headers: {
      "content-type": "multipart/form-data",
    },
    data: bodyFormData,
    onUploadProgress: (progressEvent) => {
      onProgress({
        loaded: progressEvent.loaded,
        total: progressEvent.total,
      });
    },
    cancelToken: cancel,
  }).catch((e) => {
    if (e instanceof HTTPError && e.response) {
      throw new UpyunUploadError(e.response.data as UpyunError);
    }

    throw e;
  });

  return res.data;
}

export async function s3LikeUploadCallback(sessionID: string, sessionKey: string, policyType: string): Promise<unknown> {
  try {
    return await (await getStore()).dispatch(sendS3LikeCompleteUpload(policyType, sessionID, sessionKey));
  } catch (e) {
    if (e instanceof AppError) {
      throw new S3LikeUploadCallbackError(e.response);
    }

    throw e;
  }
}

// obsUploadCallback notifies the backend after the client completes an OBS
// multipart upload — without it the server never finalizes the session
// (cloudreve/frontend#344).
export async function obsUploadCallback(sessionID: string, sessionKey: string): Promise<unknown> {
  try {
    return await (await getStore()).dispatch(sendObsCompleteUpload(sessionID, sessionKey));
  } catch (e) {
    if (e instanceof AppError) {
      throw new S3LikeUploadCallbackError(e.response);
    }

    throw e;
  }
}

const encodePartsXML = (chunks: ChunkProgress[]): string => {
  let body = "";
  body += "<CompleteMultipartUpload>";
  chunks.forEach((chunk) => {
    body += "<Part>";
    const part: S3Part = {
      PartNumber: chunk.index + 1,
      ETag: chunk.etag!,
    };
    body += OBJtoXML(part as unknown as Record<string, unknown>);
    body += "</Part>";
  });
  body += "</CompleteMultipartUpload>";
  return body;
};
