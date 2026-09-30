// Only this private test fixture exposes a storage check route.
export default defineEventHandler(async () => getStorage().checkStorage())
