import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
  ListObjectsV2Command, PutObjectCommand, S3Client, UploadPartCommand,
} from '@aws-sdk/client-s3'
import type { GetObjectCommandOutput, HeadObjectCommandOutput, PutObjectCommandInput } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  createStorageKey, hasControlCharacters, normalizeStoragePrefix, resolveStorageConfig, safeHeader, safeMetadata,
  StorageError, validateStorageKey, validateTtl,
} from './config'
import type { StorageConfig } from './config'

export { createStorageKey, normalizeStoragePrefix, resolveStorageConfig, StorageError, validateStorageKey } from './config'
export type { StorageConfig, StorageErrorCode } from './config'

export type StorageOperation = 'check' | 'put' | 'get' | 'head' | 'delete' | 'list' | 'presign-upload'
  | 'presign-download' | 'multipart-create' | 'multipart-presign' | 'multipart-complete' | 'multipart-abort' | 'verify'
export type StorageOperationRunner = <T>(operation: StorageOperation, action: () => Promise<T>, bytes?: number) => Promise<T>
export interface StorageOptions extends StorageConfig {
  env?: NodeJS.ProcessEnv
  runOperation?: StorageOperationRunner
}
export interface ObjectMetadata {
  key: string
  size?: number
  etag?: string
  contentType?: string
  cacheControl?: string
  modifiedAt?: Date
  metadata: Record<string, string>
}
export interface UploadOptions {
  contentType?: string
  cacheControl?: string
  metadata?: Record<string, string>
}
export interface SignedRequest {
  url: string
  method: 'GET' | 'PUT'
  headers: Record<string, string>
  expiresIn: number
}
export interface CompletedPart { partNumber: number, etag: string }

function uploadId(value: string) {
  if (typeof value !== 'string' || !value || value.length > 2048 || hasControlCharacters(value, true)) throw new StorageError('invalid-input')
  return value
}
function partNumber(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 10000) throw new StorageError('invalid-input')
  return value
}
export function validateCompletedParts(parts: CompletedPart[]) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 10000) throw new StorageError('invalid-input')
  let previous = 0
  return parts.map((part) => {
    if (!part || typeof part !== 'object' || typeof part.etag !== 'string') throw new StorageError('invalid-input')
    const number = partNumber(part.partNumber)
    if (number <= previous || !part.etag || part.etag.length > 1024 || hasControlCharacters(part.etag, true)) throw new StorageError('invalid-input')
    previous = number
    return { PartNumber: number, ETag: part.etag }
  })
}

function metadata(key: string, output: HeadObjectCommandOutput | GetObjectCommandOutput): ObjectMetadata {
  return {
    key, size: output.ContentLength, etag: output.ETag, contentType: output.ContentType,
    cacheControl: output.CacheControl, modifiedAt: output.LastModified, metadata: safeMetadata(output.Metadata),
  }
}

export function createStorage(options: StorageOptions = {}) {
  let client: S3Client | undefined
  let config: ReturnType<typeof resolveStorageConfig> | undefined
  function configured() { return config ??= resolveStorageConfig(options, options.env) }
  function getS3Client() {
    return client ??= new S3Client({
      ...configured(),
      // Optional automatic CRC checksums break several S3-compatible stores. SigV4
      // still authenticates requests; applications may explicitly use the escape hatch.
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }
  async function run<T>(operation: StorageOperation, action: () => Promise<T>, bytes?: number): Promise<T> {
    const safeAction = async () => {
      try { return await action() }
      catch (error) {
        if (error instanceof StorageError) throw error
        const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
        throw new StorageError(status === 404 ? 'not-found' : 'unavailable')
      }
    }
    return options.runOperation ? options.runOperation(operation, safeAction, bytes) : safeAction()
  }
  function input(key: string) { return { Bucket: configured().bucket, Key: validateStorageKey(key) } }
  function uploadOptions(value: UploadOptions) {
    return { ContentType: safeHeader(value.contentType), CacheControl: safeHeader(value.cacheControl), Metadata: safeMetadata(value.metadata) }
  }
  function ttl(value?: number) { return validateTtl(value ?? configured().presignTtlSeconds) }
  async function signed(command: PutObjectCommand | GetObjectCommand | UploadPartCommand, method: 'GET' | 'PUT', headers: Record<string, string>, expiresIn?: number): Promise<SignedRequest> {
    const lifetime = ttl(expiresIn)
    const url = await getSignedUrl(getS3Client(), command, {
      expiresIn: lifetime, signableHeaders: new Set(Object.keys(headers)),
      unhoistableHeaders: new Set(Object.keys(headers).filter(name => name.startsWith('x-amz-'))),
    })
    return { url, method, headers, expiresIn: lifetime }
  }
  const storage = {
    getS3Client,
    close() { client?.destroy(); client = undefined },
    createKey(namespace: string) { return createStorageKey(namespace, configured().keyPrefix) },
    checkStorage() {
      return run('check', async () => {
        await getS3Client().send(new HeadBucketCommand({ Bucket: configured().bucket }))
        return { ok: true as const }
      })
    },
    putObject(key: string, body: PutObjectCommandInput['Body'], value: UploadOptions = {}) {
      const bytes = typeof body === 'string' ? Buffer.byteLength(body) : body instanceof Uint8Array ? body.byteLength : undefined
      return run('put', async () => {
        const result = await getS3Client().send(new PutObjectCommand({ ...input(key), ...uploadOptions(value), Body: body }))
        return { key, etag: result.ETag }
      }, bytes)
    },
    getObject(key: string) {
      return run('get', async () => {
        const result = await getS3Client().send(new GetObjectCommand(input(key)))
        if (!result.Body) throw new StorageError('unavailable')
        return { ...metadata(key, result), body: result.Body }
      })
    },
    headObject(key: string) {
      return run('head', async () => metadata(key, await getS3Client().send(new HeadObjectCommand(input(key)))))
    },
    deleteObject(key: string) {
      return run('delete', async () => { await getS3Client().send(new DeleteObjectCommand(input(key))) })
    },
    listObjects(value: { prefix?: string, maxResults?: number, continuationToken?: string } = {}) {
      return run('list', async () => {
        const max = value.maxResults ?? 100
        if (!Number.isInteger(max) || max < 1 || max > 1000
          || (value.continuationToken && (value.continuationToken.length > 8192 || hasControlCharacters(value.continuationToken)))) throw new StorageError('invalid-input')
        const prefix = value.prefix ? normalizeStoragePrefix(value.prefix) + (value.prefix.endsWith('/') ? '/' : '') : undefined
        const result = await getS3Client().send(new ListObjectsV2Command({ Bucket: configured().bucket, Prefix: prefix, MaxKeys: max, ContinuationToken: value.continuationToken }))
        return {
          objects: (result.Contents ?? []).map(object => ({ key: object.Key!, size: object.Size, etag: object.ETag, modifiedAt: object.LastModified })),
          continuationToken: result.NextContinuationToken, truncated: Boolean(result.IsTruncated),
        }
      })
    },
    presignUpload(key: string, value: UploadOptions & { expiresIn?: number } = {}) {
      return run('presign-upload', async () => {
        const upload = uploadOptions(value)
        const headers: Record<string, string> = {}
        if (upload.ContentType) headers['content-type'] = upload.ContentType
        if (upload.CacheControl) headers['cache-control'] = upload.CacheControl
        for (const [name, content] of Object.entries(upload.Metadata)) headers[`x-amz-meta-${name}`] = content
        return signed(new PutObjectCommand({ ...input(key), ...upload }), 'PUT', headers, value.expiresIn)
      })
    },
    presignDownload(key: string, expiresIn?: number) {
      return run('presign-download', () => signed(new GetObjectCommand(input(key)), 'GET', {}, expiresIn))
    },
    createMultipartUpload(key: string, value: UploadOptions = {}) {
      return run('multipart-create', async () => {
        const result = await getS3Client().send(new CreateMultipartUploadCommand({ ...input(key), ...uploadOptions(value) }))
        if (!result.UploadId) throw new StorageError('unavailable')
        return { uploadId: uploadId(result.UploadId) }
      })
    },
    presignMultipartPart(key: string, id: string, part: number, expiresIn?: number) {
      return run('multipart-presign', () => signed(new UploadPartCommand({ ...input(key), UploadId: uploadId(id), PartNumber: partNumber(part) }), 'PUT', {}, expiresIn))
    },
    completeMultipartUpload(key: string, id: string, parts: CompletedPart[]) {
      return run('multipart-complete', async () => {
        const result = await getS3Client().send(new CompleteMultipartUploadCommand({ ...input(key), UploadId: uploadId(id), MultipartUpload: { Parts: validateCompletedParts(parts) } }))
        return { key, etag: result.ETag }
      })
    },
    abortMultipartUpload(key: string, id: string) {
      return run('multipart-abort', async () => { await getS3Client().send(new AbortMultipartUploadCommand({ ...input(key), UploadId: uploadId(id) })) })
    },
    verifyUploadedObject(key: string, policy: { maxBytes: number, contentType?: string, metadata?: Record<string, string>, deleteOnFailure?: boolean }) {
      return run('verify', async () => {
        if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 0) throw new StorageError('invalid-input')
        safeHeader(policy.contentType)
        const expected = safeMetadata(policy.metadata)
        const object = await storage.headObject(key)
        if (object.size === undefined || object.size > policy.maxBytes
          || (policy.contentType !== undefined && object.contentType !== policy.contentType)
          || Object.entries(expected).some(([name, value]) => object.metadata[name] !== value)) {
          if (policy.deleteOnFailure) await storage.deleteObject(key)
          throw new StorageError('verification-failed')
        }
        return object
      })
    },
  }
  return storage
}
export type Storage = ReturnType<typeof createStorage>
let singleton: Storage | undefined
export function getStorage() { return singleton ??= createStorage() }
export function closeStorage() { singleton?.close(); singleton = undefined }
