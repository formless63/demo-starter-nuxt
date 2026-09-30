// Private, fixed scripts. No arbitrary EVAL is exposed. Each script uses one physical key.
// STRLEN and GET are atomic, preventing an oversized value from being returned to the app.
export const readValue = `
if redis.call('STRLEN', KEYS[1]) > tonumber(ARGV[1]) then return redis.error_reply('value bound') end
return redis.call('GET', KEYS[1])
`
// Validate before mutation: Redis scripts do not roll back successful earlier commands.
// Initial TTL is set for new counters and existing persistent values; existing expiry is retained.
export const incrementValue = `
local raw = redis.call('GET', KEYS[1])
if raw and not string.match(raw, '^%-?%d+$') then return redis.error_reply('integer required') end
local current = raw and tonumber(raw) or 0
local amount = tonumber(ARGV[1])
local next = current + amount
if math.abs(current) > 9007199254740991 or math.abs(next) > 9007199254740991 then
  return redis.error_reply('integer bound')
end
if string.len(string.format('%.0f', next)) > tonumber(ARGV[3]) then return redis.error_reply('value size') end
local result = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('PTTL', KEYS[1]) == -1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return result
`
export const renewToken = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0
`
export const releaseToken = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`
