// FIXTURE_STALE_TOMBSTONE: a native live build must replace these exact bytes.
self.addEventListener('activate', event => {
  event.waitUntil(self.registration.unregister())
})
