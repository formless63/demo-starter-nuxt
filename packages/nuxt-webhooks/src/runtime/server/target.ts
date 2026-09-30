import { BlockList, isIP } from 'node:net'
import { WebhookError } from './errors'

const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [['::', 96], ['::1', 128], ['::ffff:0:0', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]] as const) blocked.addSubnet(address, prefix, 'ipv6')

export interface WebhookTarget { url: string, secret: string }
export interface WebhookTargetPolicy {
  /** Explicit testing/operator opt-in. Never use for untrusted targets. */
  allowLocalHttp?: boolean
  /** Additional application DNS/allowlist/egress policy; must throw to reject. */
  validate?: (url: URL, signal: AbortSignal) => void | Promise<void>
}

export async function validateWebhookTarget(value: string, policy: WebhookTargetPolicy = {}, signal = new AbortController().signal) {
  if (typeof value !== 'string' || value.length > 2048) throw new WebhookError('invalid-target')
  let url: URL
  try { url = new URL(value) }
  catch { throw new WebhookError('invalid-target') }
  if (url.username || url.password || url.hash || value.includes('#')) throw new WebhookError('invalid-target')
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  const local = ['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback'].includes(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')
  const ip = isIP(hostname)
  const privateIp = ip !== 0 && blocked.check(hostname, ip === 4 ? 'ipv4' : 'ipv6')
  if (url.protocol !== 'https:' && !(policy.allowLocalHttp && url.protocol === 'http:')) throw new WebhookError('invalid-target')
  if (!policy.allowLocalHttp && (local || privateIp)) throw new WebhookError('invalid-target')
  // Pass a copy so policy cannot mutate the validated destination.
  try { await policy.validate?.(new URL(url), signal) }
  catch { throw new WebhookError('invalid-target') }
  return url
}
